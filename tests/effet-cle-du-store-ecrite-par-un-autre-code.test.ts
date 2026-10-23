// Un `µeffect` qui LIT et ÉCRIT une même clé du store (`µeffect -> $$v = $max if $$v > $max`) doit se
// relancer quand du code hors effet écrit cette clé — un bouton, un gestionnaire, une minuterie, une
// réponse réseau —, jamais sur sa propre écriture ni sur celle d'un autre effet.
//
// Défaut : pour qu'il ne se relance pas sur sa propre écriture, toute clé écrite par l'effet était
// retirée de ses dépendances à la compilation. Il ne réagissait donc plus du tout à cette clé : le
// bornage ne corrigeait pas `$$v = 50` posé par un bouton, l'écran restait à 50.
//
// Correctif : la clé écrite pendant le passage synchrone de l'effet reste une dépendance, marquée `!` dans
// la liste (`'$$v!'`) : le store ne la signale que pour une écriture faite hors de tout effet. Deux effets
// qui écrivent la même clé ne se relancent donc jamais l'un l'autre par elle (deux exemplaires qui
// alignent la clé sur leur propre valeur se relançaient sans fin) : entre effets, la dernière écriture
// gagne et chacun passe une fois, comme en 2.5.0. Une écriture qui CUMULE (`$$n += 1`, `$$n++`, une bascule,
// `Math.min($$v, …)`, `push`) garde la règle d'avant (clé hors des dépendances) : deux effets qui cumulent sur la
// même clé, deux exemplaires d'un même compteur, se relanceraient l'un l'autre sans fin. Une écriture qui arrive
// plus tard (rappel, minuterie, promesse, écouteur, fonction passée comme valeur, code qui suit un `await`) laisse
// la clé dans les dépendances quand l'effet la lit pendant son passage ; lue seulement par ce code différé, elle en
// sort. Les variables locales (`$x`) gardent leur règle : un effet qui écrit une variable locale qu'il lit se relance.

import assert from 'node:assert/strict'
import * as acorn from 'acorn'
import * as walk from 'acorn-walk'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { annotateEffectDeps } from '../src/generator/effect-deps.js'
import { createHarness } from '../src/testing/index.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
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

const SOURCES: Record<string, string> = {
  // la forme exacte du constat : un bouton écrit 50, le bornage ramène à 10
  'borne-v': [
    '<script>',
    '$$v = 5',
    '$max = 10',
    'globalThis.__bornages = 0',
    'µeffect ->',
    '  globalThis.__bornages += 1',
    '  $$v = $max if $$v > $max',
    '$go = -> $$v = 50',
    '</script>',
    '<p class="v">{$$v}</p>',
    '<button class="g" @click={$go()}>go</button>',
  ].join('\n'),
  // l'effet d'un AUTRE composant écrit la clé bornée
  'source-v': [
    '<script>',
    'µeffect ->',
    '  $$v = $$base * 10 if $$base',
    '  return',
    '</script>',
    '<p class="b">{$$base}</p>',
  ].join('\n'),
  'compteur-actif': [
    '<script>',
    '$$compte = 0',
    'µeffect ->',
    '  globalThis.__passages = (globalThis.__passages ?? 0) + 1',
    '  $$compte += 1 if $$actif',
    '  return',
    '</script>',
    '<p class="c">{$$compte}</p>',
  ].join('\n'),
  // deux effets du même composant écrivent la même clé (borne haute, borne basse)
  'deux-bornes': [
    '<script>',
    '$$w = 5',
    'globalThis.__deux = 0',
    'µeffect ->',
    '  globalThis.__deux += 1',
    '  $$w = 10 if $$w > 10',
    '  return',
    'µeffect ->',
    '  globalThis.__deux += 1',
    '  $$w = 0 if $$w < 0',
    '  return',
    '</script>',
    '<p class="w">{$$w}</p>',
  ].join('\n'),
  'apres-await': [
    '<script>',
    'globalThis.__asyn = 0',
    'µeffect ->',
    '  globalThis.__asyn += 1',
    '  if $$go',
    '    await Promise.resolve()',
    '    $$n = ($$n ?? 0) + 1',
    '  return',
    '</script>',
    '<p class="n">{$$n ?? 0}</p>',
  ].join('\n'),
  'local-converge': [
    '<script>',
    '$i = 0',
    'µeffect ->',
    '  $i += 1 if $i < 3',
    '  return',
    '</script>',
    '<p class="i">{$i}</p>',
  ].join('\n'),
}

function projet(etiquette: string, config: Record<string, unknown>): string {
  const root = mjsTmp('effet-cle-ecrite-' + etiquette)
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', ...config }))
  for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(root, 'src', `${nom}.mjs`), source + '\n')
  return root
}

const pause = (ms = 40) => new Promise(r => setTimeout(r, ms))

describe('µeffect — une clé du store qu\'il écrit le relance quand un autre code l\'écrit, jamais sur sa propre écriture', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  describe('liste des dépendances (annotateEffectDeps)', () => {
    it('lue et écrite dans le corps de l\'effet, sans cumuler (valeur fixe, champ, suppression) : la clé reste une dépendance, marquée `!` (écriture hors effet seulement)', () => {
      assert.deepEqual(depsOf(annotateEffectDeps('µ.effect(function() { if (µ.store.v > $.max) { return µ._storeSet("v", $.max) } })')), [ '$$v!', 'max' ])
      assert.deepEqual(depsOf(annotateEffectDeps('µ.effect(function() { if (µ.store.o) { return µ._mjs_storeDeepSet("o", ["c"], 1) } })')), [ '$$o!' ])
      assert.deepEqual(depsOf(annotateEffectDeps('µ.effect(function() { if (µ.store.d) { return µ._mjs_storeDelete("d") } })')), [ '$$d!' ])
      // témoin : lue sans être écrite, la clé reste une dépendance ordinaire
      assert.deepEqual(depsOf(annotateEffectDeps('µ.effect(function() { if (µ.store.v > 1) { return µ._storeSet("w", 1) } })')), [ '$$v' ])
    })

    it('écriture qui CUMULE (`+=`, `++`, bascule, `Math.min($$v…)`, champ cumulé, `push`) : la clé reste hors des dépendances', () => {
      const formes = [
        'µ._storeSet("v", µ.store.v + (1))',
        'µ._storeSet("v", (+µ.store.v) + 1)',
        '((_v) => (µ._storeSet("v", (+_v) + 1), +_v))(µ.store.v)',
        'µ._storeSet("v", !µ.store.v)',
        'µ._storeSet("v", Math.min(µ.store.v, 10))',
        'µ._mjs_storeDeepSet("v", ["c"], µ.store.v.c + (1))',
        'µ._mjs_storeDeepCall("v", [], \'push\', [µ.store.v.length])',
      ]
      for (const f of formes) assert.deepEqual(depsOf(annotateEffectDeps(`µ.effect(function() { if ($.r) { return ${f} } })`)), [ 'r' ], f)
    })

    it('écrite dans une méthode ou une fonction du script APPELÉE par l\'effet : la clé reste une dépendance, marquée `!`', () => {
      const methode = 'this.borne = function() { if (µ.store.v > $.max) { return µ._storeSet("v", $.max) } }\nµ.effect(function() { return this.borne() })'
      assert.deepEqual(depsOf(annotateEffectDeps(methode, { borne: [ '$$v', 'max' ] })), [ '$$v!', 'max' ])
      const plate = 'let borne = function() { if (µ.store.v > 10) { return µ._storeSet("v", 10) } }\nµ.effect(function() { return borne() })'
      assert.deepEqual(depsOf(annotateEffectDeps(plate)), [ '$$v!' ])
    })

    it('écrite dans un rappel (minuterie) : la clé reste hors des dépendances', () => {
      const out = annotateEffectDeps('µ.effect(function() { if (µ.store.go) { return setTimeout(() => µ._storeSet("n", µ.store.n + 1), 0) } })')
      assert.deepEqual(depsOf(out), [ '$$go' ])
    })

    it('écrite dans un effet `async` : la clé reste hors des dépendances', () => {
      const out = annotateEffectDeps('µ.effect(async function() { if (µ.store.go) { await null; return µ._storeSet("n", µ.store.n + 1) } })')
      assert.deepEqual(depsOf(out), [ '$$go' ])
    })

    it('fonction du script passée comme valeur (`setTimeout(borne)`) : la clé reste hors des dépendances ; appelée aussi pendant le passage, elle en est une, marquée `!`', () => {
      const fn = 'let borne = function() { if (µ.store.v > 10) { return µ._storeSet("v", 10) } }\n'
      assert.deepEqual(depsOf(annotateEffectDeps(fn + 'µ.effect(function() { if ($.r) { return setTimeout(borne, 0) } })')), [ 'r' ])
      assert.deepEqual(depsOf(annotateEffectDeps(fn + 'µ.effect(function() { borne(); if ($.r) { return setTimeout(borne, 0) } })')), [ '$$v!', 'r' ])
    })
  })

  for (const [etiquette, config] of [['dev', {}], ['minifie', { minify: true }]] as const) {
    describe(`exécution (${etiquette})`, () => {
      let app: any
      before(async () => { app = await createHarness({ root: projet(etiquette, config) }) })
      after(async () => { await app?.destroy() })
      // `destroy()` du harnais appelle `µ._mjs_rm`, renommé dans un build minifié : la balise est alors retirée à la main
      const retirer = (c: any) => { if (etiquette === 'minifie') c.el.remove(); else c.destroy() }

      it('bornage : `$$v = 50` posé par un bouton est ramené à 10, l\'effet ne repart pas sur sa propre écriture', async () => {
        const c = await app.mount('borne-v')
        try {
          assert.equal(c.text('.v'), '5')
          assert.equal(app.window.__bornages, 1, 'une fois au montage')
          await c.click('.g')
          await pause()
          assert.equal(c.text('.v'), '10')
          assert.equal(app.window.__bornages, 2, 'relancé par le bouton, pas par sa propre écriture de 10')
        }
        finally {
          retirer(c)
        }
      })

      it('la clé écrite par l\'effet d\'un autre composant ne relance pas le bornage : entre effets, la dernière écriture gagne', async () => {
        const borne  = await app.mount('borne-v')
        const source = await app.mount('source-v')
        try {
          app.window.__bornages = 0
          app.µ.store.base = 7
          await pause()
          assert.equal(borne.text('.v'), '70', 'l\'écriture de 70 par l\'autre effet reste, l\'écran la montre')
          assert.equal(app.µ.store.v, 70)
          assert.equal(app.window.__bornages, 0, 'le bornage ne repart pas sur l\'écriture d\'un autre effet')
        }
        finally {
          retirer(source)
          retirer(borne)
        }
      })

      it('`$$compte += 1 if $$actif` dans deux exemplaires du composant : un cumul chacun, sans se relancer l\'un l\'autre', async () => {
        app.window.__passages = 0
        const a = await app.mount('compteur-actif')
        const b = await app.mount('compteur-actif')
        try {
          assert.equal(app.window.__passages, 2, 'une fois au montage chacun')
          app.µ.store.actif = true
          await pause(120)
          assert.equal(app.µ.store.compte, 2, 'un cumul par exemplaire, pas une boucle')
          assert.equal(app.window.__passages, 4)
          app.µ.store.compte = 10
          await pause(120)
          assert.equal(app.window.__passages, 4, 'une clé cumulée n\'est pas une dépendance : règle inchangée')
          assert.equal(a.text('.c'), '10')
        }
        finally {
          retirer(b)
          retirer(a)
        }
      })

      it('deux effets qui écrivent la même clé (borne haute, borne basse) : chacun repart sur l\'écriture hors effet, aucun sur celle de l\'autre', async () => {
        const c = await app.mount('deux-bornes')
        try {
          app.µ.store.w = 50
          await pause(120)
          assert.equal(c.text('.w'), '10')
          app.µ.store.w = -5
          await pause(120)
          assert.equal(c.text('.w'), '0')
          assert.ok(app.window.__deux < 20, `passages bornés (${app.window.__deux})`)
        }
        finally {
          retirer(c)
        }
      })

      it('écriture après un `await` : une seule écriture, aucune boucle (la clé n\'est pas une dépendance)', async () => {
        const c = await app.mount('apres-await')
        try {
          assert.equal(app.window.__asyn, 1)
          app.µ.store.go = 1
          await pause(120)
          assert.equal(app.window.__asyn, 2)
          assert.equal(app.µ.store.n, 1)
          assert.equal(c.text('.n'), '1')
        }
        finally {
          retirer(c)
        }
      })

      it('variable locale `$i += 1 if $i < 3` : règle inchangée, l\'effet se relance sur sa propre écriture jusqu\'à 3', async () => {
        const c = await app.mount('local-converge')
        try {
          await pause()
          assert.equal(c.text('.i'), '3')
        }
        finally {
          retirer(c)
        }
      })
    })
  }
})
