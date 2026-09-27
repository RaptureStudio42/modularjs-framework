// Un `µeffect` qui LIT une clé du store (`$$x`) doit se relancer quand cette clé change.
//
// Défaut : `annotateEffectDeps` ne listait que les `$.x` locaux. `$$desires` (compilé
// `µ.store.desires`) n'entrait jamais dans la liste des dépendances, qu'il soit lu en clair
// dans le corps, dans une fonction plate ou dans une méthode appelée. Dès que l'effet lisait
// AUSSI une variable locale, sa liste n'était plus vide, le filet « aucune dépendance connue →
// relance à chaque mutation » se désactivait, et l'écriture de la clé n'atteignait plus
// l'effet : la liste du gabarit suivait, l'effet de bord (canvas, bibliothèque externe) restait
// figé. Seul, sans lecture locale, il se relançait… à CHAQUE mutation, y compris celles qu'il
// provoquait lui-même : `$$compte += 1 if $$actif` tournait en boucle.
//
// Correctif : une lecture `µ.store.x` (directe, dans une fonction plate ou une méthode, suivies
// transitivement) devient la dépendance '$$x' ; une clé que l'effet ÉCRIT lui-même (`_storeSet`,
// écritures profondes, suppression — dans le corps, une fonction plate ou une méthode) n'en est
// jamais une, pour qu'il ne se relance pas sur sa propre écriture. Les écritures ne sont pas lues
// dans `methodReads` : l'analyseur y range aussi les CIBLES d'écriture (`$$panier = null` y
// compte comme une lecture), d'où un parcours du corps de la méthode déjà réécrit.

import assert from 'node:assert/strict'
import * as acorn from 'acorn'
import * as walk from 'acorn-walk'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { annotateEffectDeps } from '../src/generator/effect-deps.js'
import { transpile } from '../src/transpiler/index.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

// les dépendances du PREMIER `µ.effect(fn, [...])` rencontré, triées
function depsOf(js: string): string[] {
  const ast = acorn.parse(js, { ecmaVersion: 'latest', sourceType: 'module' })
  let deps: string[] | null = null
  walk.simple(ast, {
    CallExpression(n: any) {
      if (deps) return
      const c = n.callee
      if (c?.type !== 'MemberExpression' || c.object?.name !== 'µ' || c.property?.name !== 'effect') return
      const liste = n.arguments[1]
      if (liste?.type === 'ArrayExpression') deps = liste.elements.map((e: any) => e.value)
    },
  })
  assert.ok(deps, `aucun µ.effect(fn, [...]) annoté dans :\n${js}`)
  return [...deps!].sort()
}

const stripEsm = (s: string) => s
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
  .replace(/\bexport\s+default\s+/g, '')
  .replace(/\bexport\s+/g, '')
  .replace(/import\.meta\.url/g, "'http://localhost/'")

async function monter(nom: string, source: string) {
  const root   = mjsTmp('effect-store')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, `${nom}.mjs`), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir)
  const coeur = files.find((f: string) => /^mjs_core-/.test(f))!
  const comp  = files.find((f: string) => new RegExp(`^${nom}-`).test(f))!
  const win: any = new Window({ url: 'http://localhost/' })
  win.eval(`${stripEsm(readFileSync(join(outDir, coeur), 'utf-8'))}\nglobalThis.µ = µ;\n${stripEsm(readFileSync(join(outDir, comp), 'utf-8'))}`)
  win.document.body.innerHTML = `<mjs-${nom}></mjs-${nom}>`
  await new Promise(r => setTimeout(r, 80))
  return { win, el: win.document.body.firstElementChild }
}

const pause = (ms = 60) => new Promise(r => setTimeout(r, ms))

describe('µeffect — une clé du store lue devient une dépendance, jamais celle qu\'il écrit', function () {
  this.timeout(40000)
  after(async () => { await terminateSharedWorkerPool() })

  describe('liste des dépendances (annotateEffectDeps)', () => {
    it('lecture directe à côté d\'une variable locale : "$$desires" ET "revele"', () => {
      const out = annotateEffectDeps('µ.effect(function() { return console.log(µ.store.desires, $.revele) })')
      assert.deepEqual(depsOf(out), [ '$$desires', 'revele' ])
    })

    it('lecture directe seule : "$$desires" (et non plus une liste vide qui relançait à chaque mutation)', () => {
      const out = annotateEffectDeps('µ.effect(function() { return console.log(µ.store.desires) })')
      assert.deepEqual(depsOf(out), [ '$$desires' ])
    })

    it('lecture dans une fonction plate du module : suivie comme une variable locale', () => {
      const out = annotateEffectDeps('let helper = function() { return µ.store.x }\nµ.effect(function() { return helper() })')
      assert.deepEqual(depsOf(out), [ '$$x' ])
    })

    it('lecture dans une méthode appelée (this.lit()) : le corps de la méthode est parcouru', () => {
      const js = 'this.lit = function() { return µ.store.desires.length }\nµ.effect(function() { return console.log(this.lit(), $.r) })'
      const out = annotateEffectDeps(js, { lit: [ '$$desires' ] })
      assert.deepEqual(depsOf(out), [ '$$desires', 'r' ])
    })

    it('méthode qui ÉCRIT la clé : jamais une dépendance, même quand l\'analyseur la range en lecture', () => {
      const js = 'this.vide = function() { return µ._storeSet("panier", null) }\nµ.effect(function() { if ($.r) { return this.vide() } })'
      const out = annotateEffectDeps(js, { vide: [ '$$panier' ] })
      assert.deepEqual(depsOf(out), [ 'r' ])
    })

    it('`$$compte += $r` (lecture ET écriture de la même clé) : "compte" exclue, pas de boucle', () => {
      const out = annotateEffectDeps('µ.effect(function() { return µ._storeSet("compte", µ.store.compte + ($.r)) })')
      assert.deepEqual(depsOf(out), [ 'r' ])
    })

    it('`$$compte++` : "compte" exclue', () => {
      const out = annotateEffectDeps('µ.effect(function() { if ($.r) { return ((_v) => (µ._storeSet("compte", (+_v) + 1), +_v))(µ.store.compte) } })')
      assert.deepEqual(depsOf(out), [ 'r' ])
    })

    it('écritures profondes et suppression (`$$reglages.theme = …`, `$$liste.push(…)`, `delete $$vieux`) : aucune dépendance', () => {
      const js = 'µ.effect(function() { µ._mjs_storeDeepSet("reglages", ["theme"], $.r); µ._mjs_storeDeepCall("liste", [], \'push\', [$.r]); return µ._mjs_storeDelete("vieux") })'
      assert.deepEqual(depsOf(annotateEffectDeps(js)), [ 'r' ])
    })

    it('lit deux clés, en écrit une troisième : les deux lues seulement', () => {
      const out = annotateEffectDeps('µ.effect(function() { return µ._storeSet("total", µ.store.a + µ.store.b) })')
      assert.deepEqual(depsOf(out), [ '$$a', '$$b' ])
    })

    it('`µ.store` parcouru en entier (Object.keys) : "$$*", comme dans le gabarit', () => {
      const out = annotateEffectDeps('µ.effect(function() { return Object.keys(µ.store).length + $.r })')
      assert.deepEqual(depsOf(out), [ '$$*', 'r' ])
    })

    it('accès brut `µread $$x` (µ._mjs_storeRaw.x) : toujours sans dépendance, par construction', () => {
      const out = annotateEffectDeps('µ.effect(function() { return µ._mjs_storeRaw.x + $.r })')
      assert.deepEqual(depsOf(out), [ 'r' ])
    })

    it('bout en bout via transpile : `µeffect -> console.log($$desires, $revele)` annoté des deux', async () => {
      const src = '<script lang="coffee">\n$revele = null\nµeffect -> console.log($$desires, $revele)\n</script>\n<p>{$$desires.length}</p>'
      const { output } = await transpile(src, { moduleName: 'effetstorett' })
      const m = output.match(/µ\.effect\(function\(\) \{[\s\S]*?\},\s*(\[[^\]]*\])\)/)
      assert.ok(m, `µ.effect annoté introuvable dans :\n${output}`)
      assert.deepEqual(JSON.parse(m![1]).sort(), [ '$$desires', 'revele' ])
    })
  })

  describe('exécution (composant compilé, monté)', () => {
    it('une écriture de la clé depuis l\'extérieur relance l\'effet une fois, même s\'il lit aussi une variable locale', async () => {
      const { win, el } = await monter('effetstorea', [
        '<script lang="coffee">',
        '$r = 1',
        'µeffect ->',
        '  window.__runs = (window.__runs or 0) + 1',
        '  window.__vu = [($$desires or []).length, $r]',
        '  return',
        '</script>',
        '<p>x</p>',
      ].join('\n'))
      assert.equal(win.__runs, 1, 'une fois au montage')
      win.µ.store.desires = [ 1, 2 ]
      await pause()
      assert.equal(win.__runs, 2, 'la clé écrite relance l\'effet')
      assert.equal(JSON.stringify(win.__vu), '[2,1]')
      win.µ.store.desires = [ 1, 2, 3 ]
      await pause()
      assert.equal(win.__runs, 3, 'une relance par écriture')
      el._set('r', 2)
      await pause()
      assert.equal(win.__runs, 4, 'la variable locale relance toujours')
      assert.equal(JSON.stringify(win.__vu), '[3,2]')
      win.close?.()
    })

    it('`$$compte += 1 if $$actif` : une écriture de $$actif = un seul passage, l\'effet ne se relance pas sur sa propre écriture', async () => {
      const { win } = await monter('effetstoreb', [
        '<script lang="coffee">',
        '$$compte = 0',
        'µeffect ->',
        '  window.__passages = (window.__passages or 0) + 1',
        '  $$compte += 1 if $$actif',
        '  return',
        '</script>',
        '<p>x</p>',
      ].join('\n'))
      assert.equal(win.__passages, 1)
      win.µ.store.actif = true
      await pause(120)
      assert.equal(win.__passages, 2, 'un passage de plus, pas une boucle')
      assert.equal(win.µ.store.compte, 1)
      win.close?.()
    })

    // le gabarit lit $$panier : le composant est abonné à la clé que la méthode écrit — c'est ce qui
    // relançait l'effet (sans dépendance connue, relancé à chaque mutation) après chaque écriture
    it('un effet qui appelle une méthode ÉCRIVANT le store ne se relance pas sur cette écriture', async () => {
      const { win } = await monter('effetstorec', [
        '<script lang="coffee">',
        '$$declencheur = 0',
        '@vide = -> $$panier = []',
        'µeffect ->',
        '  window.__vides = (window.__vides or 0) + 1',
        '  @@vide() if $$declencheur',
        '  return',
        '</script>',
        '<p>{($$panier or []).length}</p>',
      ].join('\n'))
      assert.equal(win.__vides, 1)
      win.µ.store.declencheur = 1
      await pause(120)
      assert.equal(win.__vides, 2, 'relancé par $$declencheur, jamais par $$panier qu\'il écrit')
      assert.equal(win.µ.store.panier.length, 0)
      win.close?.()
    })
  })
})
