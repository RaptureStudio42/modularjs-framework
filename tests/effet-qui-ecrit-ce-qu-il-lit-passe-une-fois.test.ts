// Un `µeffect` dont tout ce qu'il lit est ce qu'il écrit en cumulant — directement (`$$k = $$k + 1`) ou par un
// dérivé (`$$n = $e`, `$e = $$n + 1`) — passe une fois au montage, puis ne repart plus sur un rendu sans rapport.
//
// Défaut : une écriture qui cumule n'est pas une dépendance ; toutes les lectures de ces effets sortaient donc de la
// liste compilée, qui restait vide — et le runtime relance à CHAQUE mise à jour du composant un effet sans
// dépendance connue. L'effet passait 10 000 fois au montage (garde-fou), puis encore 10 000 fois à chaque écriture
// sans rapport (un bouton qui change une autre variable).
//
// Correctif : la liste d'un tel effet ne porte que la marque '!', qu'aucune écriture ne signale : il passe au
// montage, puis seulement quand une autre de ses dépendances change. Un effet qui ne lit rien de réactif garde sa
// liste vide. L'avertissement « µeffect qui LIT et ÉCRIT » couvre aussi une variable lue par un dérivé.

import assert from 'node:assert/strict'
import * as acorn from 'acorn'
import * as walk from 'acorn-walk'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { annotateEffectDeps } from '../src/generator/effect-deps.js'
import { transpile } from '../src/transpiler/index.js'
import { createHarness } from '../src/testing/index.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

// les dépendances du premier `µ.effect(fn, [...])` rencontré, triées
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
  'ecrit-direct': [
    '<script>',
    '$$wk = 0',
    '$autre = 0',
    'µeffect ->',
    '  globalThis.__ecritDirect = (globalThis.__ecritDirect ?? 0) + 1',
    '  $$wk = $$wk + 1',
    '  return',
    '</script>',
    '<p class="v">{$$wk}</p>',
    '<button class="b" @click={$autre += 1}>{$autre}</button>',
    '<button class="s" @click={$$wm += 1}>{$$wm}</button>',
  ].join('\n'),
  'ecrit-derive': [
    '<script>',
    '$$wn = 0',
    '$e = $$wn + 1',
    '$autre = 0',
    'µeffect ->',
    '  globalThis.__ecritDerive = (globalThis.__ecritDerive ?? 0) + 1',
    '  $$wn = $e',
    '  return',
    '</script>',
    '<p class="v">{$$wn}</p>',
    '<button class="b" @click={$autre += 1}>{$autre}</button>',
    '<button class="s" @click={$$wm += 1}>{$$wm}</button>',
  ].join('\n'),
  'cumul-prix': [
    '<script>',
    '$$wt = 0',
    '$prix = 2',
    '$autre = 0',
    'µeffect ->',
    '  globalThis.__cumulPrix = (globalThis.__cumulPrix ?? 0) + 1',
    '  $$wt = $$wt + $prix',
    '  return',
    '</script>',
    '<p class="v">{$$wt}</p>',
    '<button class="b" @click={$autre += 1}>{$autre}</button>',
    '<button class="p" @click={$prix = 5}>{$prix}</button>',
  ].join('\n'),
}

function projet(etiquette: string, config: Record<string, unknown>): string {
  const root = mjsTmp('effet-ecrit-ce-qu-il-lit-' + etiquette)
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', ...config }))
  for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(root, 'src', `${nom}.mjs`), source + '\n')
  return root
}

const pause = (ms = 40) => new Promise(r => setTimeout(r, ms))

// avertissements de compilation d'un composant
async function avertissements(script: string): Promise<string> {
  const vus: string[] = []
  const avant = console.warn
  console.warn = (...a: any[]) => { vus.push(a.join(' ')) }
  try { await transpile(`<script>\n${script}\n</script>\n<p>{$x}</p>\n`, { moduleName: 'avert' }) }
  finally { console.warn = avant }
  return vus.join('\n')
}

describe('µeffect — un effet qui ne lit que ce qu\'il écrit en cumulant passe une fois', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  describe('liste des dépendances (annotateEffectDeps)', () => {
    it('forme directe (`$$k = $$k + 1`) : la seule marque \'!\', jamais une liste vide', () => {
      assert.deepEqual(depsOf(annotateEffectDeps('µ.effect(function() { return µ._storeSet("k", µ.store.k + 1) })')), [ '!' ])
    })

    it('par un dérivé (`$$n = $e`, `$e = $$n + 1`) : la seule marque \'!\'', () => {
      assert.deepEqual(depsOf(annotateEffectDeps('µ.effect(function() { return µ._storeSet("n", $.e) })', {}, { e: [ '$$n' ] })), [ '!' ])
    })

    it('cumul avec une autre lecture (`$$total = $$total + $prix`) : cette lecture seule', () => {
      assert.deepEqual(depsOf(annotateEffectDeps('µ.effect(function() { return µ._storeSet("t", µ.store.t + $.prix) })')), [ 'prix' ])
    })

    it('témoins : un effet qui ne lit rien de réactif garde sa liste vide', () => {
      assert.deepEqual(depsOf(annotateEffectDeps('µ.effect(function() { console.log(1) })')), [])
      assert.deepEqual(depsOf(annotateEffectDeps('µ.effect(function() { µ._storeSet("k", 5) })')), [])
    })
  })

  describe('avertissement « µeffect qui LIT et ÉCRIT »', () => {
    it('une variable lue par un dérivé et écrite par l\'effet est signalée, comme la forme directe', async () => {
      const derive = await avertissements('$x = 0\n$n = 0\n$e = $n + 1\nµeffect ->\n  $n = $e')
      assert.match(derive, /µeffect[^\n]*\$n\b/)
      const direct = await avertissements('$x = 0\n$k = 0\nµeffect ->\n  $k = $k + 1')
      assert.match(direct, /µeffect[^\n]*\$k\b/)
    })

    it('témoin : un dérivé d\'une autre variable n\'est pas signalé', async () => {
      const autre = await avertissements('$x = 0\n$n = 0\n$m = 0\n$e = $m + 1\nµeffect ->\n  $n = $e')
      assert.doesNotMatch(autre, /µeffect[^\n]*\$n\b/)
    })
  })

  for (const [etiquette, config] of [['dev', {}], ['minifie', { minify: true }]] as const) {
    describe(`exécution (${etiquette})`, () => {
      let app: any
      before(async () => { app = await createHarness({ root: projet(etiquette, config) }) })
      after(async () => { await app?.destroy() })

      for (const [nom, compteur] of [['ecrit-direct', '__ecritDirect'], ['ecrit-derive', '__ecritDerive']] as const) {
        it(`${nom} : une passe au montage, aucune après trois clics sans rapport`, async () => {
          app.window[compteur] = 0
          const c = await app.mount(nom)
          try {
            await pause()
            assert.equal(app.window[compteur], 1, 'une fois au montage')
            assert.equal(c.text('.v'), '1')
            for (let i = 0; i < 3; i++) await c.click('.b')
            await c.click('.s')
            await pause()
            assert.equal(c.text('.b'), '3', 'les clics ont bien rendu le composant')
            assert.equal(app.window[compteur], 1, 'pas relancé par un rendu sans rapport')
            assert.equal(c.text('.v'), '1')
          }
          finally { c.destroy() }
        })
      }

      it('`$$total = $$total + $prix` : repart quand `$prix` change, et seulement alors', async () => {
        app.window.__cumulPrix = 0
        const c = await app.mount('cumul-prix')
        try {
          await pause()
          assert.equal(app.window.__cumulPrix, 1, 'une fois au montage')
          assert.equal(c.text('.v'), '2')
          for (let i = 0; i < 3; i++) await c.click('.b')
          await pause()
          assert.equal(app.window.__cumulPrix, 1, 'pas relancé par un rendu sans rapport')
          await c.click('.p')
          await pause()
          assert.equal(app.window.__cumulPrix, 2, 'relancé par $prix')
          assert.equal(c.text('.v'), '7')
          await c.click('.b')
          await pause()
          assert.equal(app.window.__cumulPrix, 2)
        }
        finally { c.destroy() }
      })
    })
  }
})
