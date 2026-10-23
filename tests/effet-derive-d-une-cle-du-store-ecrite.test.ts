// Un `µeffect` qui lit un DÉRIVÉ calculé d'une clé du store (`$e = $$n + 1`) et qui écrit cette clé
// (`$$n = $e if $$go`) doit suivre la même règle que s'il lisait la clé elle-même.
//
// Défaut : le runtime ajoute à l'enregistrement les racines d'un dérivé lu aux dépendances de l'effet
// (`_mjs_computedDeps`, `e` → `$$n`), sans la marque `!` ni l'exclusion que la compilation pose sur une
// clé écrite par l'effet. L'effet repartait donc sur sa propre écriture : une écriture qui cumule par
// le dérivé (`$$n = $e`) passait jusqu'au garde-fou (10 000 passages, « Boucle réactive détectée »),
// alors que la forme directe `$$n = $$n + 1` ne passe qu'une fois.
//
// Correctif : un dérivé fondé sur une clé que l'effet écrit cède la place, dans la liste des
// dépendances, à ses racines ; la clé y suit la règle d'une lecture directe — marquée `!` (écriture hors
// effet seulement) si l'écriture ne cumule pas, hors des dépendances si elle cumule, la valeur écrite
// lisant le dérivé comptant comme une lecture de la clé.

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
  // la forme exacte du défaut : cumul par le dérivé
  'cumul-derive': [
    '<script>',
    '$$dn = 0',
    '$e = $$dn + 1',
    'µeffect ->',
    '  globalThis.__cumulDerive = (globalThis.__cumulDerive ?? 0) + 1',
    '  $$dn = $e if $$dgo',
    '  return',
    '</script>',
    '<p class="n">{$$dn}</p>',
  ].join('\n'),
  // témoin : la forme directe passe une fois
  'cumul-direct': [
    '<script>',
    '$$dm = 0',
    'µeffect ->',
    '  globalThis.__cumulDirect = (globalThis.__cumulDirect ?? 0) + 1',
    '  $$dm = $$dm + 1 if $$dgo',
    '  return',
    '</script>',
    '<p class="m">{$$dm}</p>',
  ].join('\n'),
  // bornage par le dérivé : relancé par le bouton, pas par sa propre écriture
  'borne-derive': [
    '<script>',
    '$$dv = 5',
    '$d = $$dv * 2',
    'µeffect ->',
    '  globalThis.__borneDerive = (globalThis.__borneDerive ?? 0) + 1',
    '  $$dv = 5 if $d > 10',
    '  return',
    '$go = -> $$dv = 50',
    '</script>',
    '<p class="v">{$$dv} {$d}</p>',
    '<button class="g" @click={$go()}>go</button>',
  ].join('\n'),
  // deux exemplaires qui cumulent par le dérivé : un cumul chacun, sans se relancer l'un l'autre
  'cumul-actif': [
    '<script>',
    '$$dc = 0',
    '$suivant = $$dc + 1',
    'µeffect ->',
    '  globalThis.__cumulActif = (globalThis.__cumulActif ?? 0) + 1',
    '  $$dc = $suivant if $$dactif',
    '  return',
    '</script>',
    '<p class="c">{$$dc}</p>',
  ].join('\n'),
}

function projet(etiquette: string, config: Record<string, unknown>): string {
  const root = mjsTmp('effet-derive-cle-ecrite-' + etiquette)
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', ...config }))
  for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(root, 'src', `${nom}.mjs`), source + '\n')
  return root
}

const pause = (ms = 40) => new Promise(r => setTimeout(r, ms))

describe('µeffect — un dérivé calculé d\'une clé du store que l\'effet écrit suit la règle de la clé', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  describe('liste des dépendances (annotateEffectDeps)', () => {
    it('cumul par le dérivé (`$$n = $e`, `$e = $$n + 1`) : le dérivé cède la place à ses racines, la clé reste hors des dépendances', () => {
      assert.deepEqual(depsOf(annotateEffectDeps('µ.effect(function() { if (µ.store.go) { return µ._storeSet("n", $.e) } })', {}, { e: [ '$$n' ] })), [ '$$go' ])
    })

    it('bornage par le dérivé (`$$v = 5 if $d > 10`) : la clé devient une dépendance marquée `!`', () => {
      assert.deepEqual(depsOf(annotateEffectDeps('µ.effect(function() { if ($.d > 10) { return µ._storeSet("v", 5) } })', {}, { d: [ '$$v' ] })), [ '$$v!' ])
    })

    it('dérivé de dérivé : les racines finales seulement, les autres racines gardées telles quelles', () => {
      const derives = { b: [ '$$n', 'a' ], c: [ 'b', '$$n', 'a' ] }
      assert.deepEqual(depsOf(annotateEffectDeps('µ.effect(function() { if (µ.store.go) { return µ._storeSet("n", $.c) } })', {}, derives)), [ '$$go', 'a' ])
    })

    it('témoins : dérivé fondé sur une autre clé, ou sans liste des dérivés : liste inchangée', () => {
      assert.deepEqual(depsOf(annotateEffectDeps('µ.effect(function() { if (µ.store.go) { return µ._storeSet("n", $.e) } })', {}, { e: [ '$$m' ] })), [ '$$go', 'e' ])
      assert.deepEqual(depsOf(annotateEffectDeps('µ.effect(function() { if (µ.store.go) { return µ._storeSet("n", $.e) } })')), [ '$$go', 'e' ])
    })
  })

  for (const [etiquette, config] of [['dev', {}], ['minifie', { minify: true }]] as const) {
    describe(`exécution (${etiquette})`, () => {
      let app: any
      before(async () => { app = await createHarness({ root: projet(etiquette, config) }) })
      after(async () => { await app?.destroy() })

      it('cumul par le dérivé : une seule écriture, comme la forme directe, aucune boucle', async () => {
        const a = await app.mount('cumul-derive')
        const b = await app.mount('cumul-direct')
        try {
          assert.equal(app.window.__cumulDerive, 1, 'une fois au montage')
          app.window.µ.store.dgo = true
          await pause(200)
          assert.equal(b.text('.m'), '1', 'témoin direct')
          assert.equal(a.text('.n'), '1', 'cumul par le dérivé')
          assert.equal(app.window.__cumulDerive, 2, 'relancé par $$dgo seulement')
        }
        finally {
          a.destroy()
          b.destroy()
        }
      })

      it('bornage par le dérivé : `$$dv = 50` posé par un bouton est ramené à 5, l\'effet ne repart pas sur sa propre écriture', async () => {
        const c = await app.mount('borne-derive')
        try {
          assert.equal(c.text('.v'), '5 10')
          assert.equal(app.window.__borneDerive, 1, 'une fois au montage')
          await c.click('.g')
          await pause()
          assert.equal(c.text('.v'), '5 10')
          assert.equal(app.window.__borneDerive, 2, 'relancé par le bouton, pas par sa propre écriture de 5')
        }
        finally {
          c.destroy()
        }
      })

      it('deux exemplaires qui cumulent par le dérivé : un cumul chacun, sans se relancer l\'un l\'autre', async () => {
        const a = await app.mount('cumul-actif')
        const b = await app.mount('cumul-actif')
        try {
          assert.equal(app.window.__cumulActif, 2, 'une fois chacun au montage')
          app.window.µ.store.dactif = true
          await pause(200)
          assert.equal(a.text('.c'), '2')
          assert.equal(app.window.__cumulActif, 4, 'une fois chacun sur $$dactif')
        }
        finally {
          a.destroy()
          b.destroy()
        }
      })
    })
  }
})
