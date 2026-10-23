// Un `µeffect` qui lit une clé du store pendant son passage et ne l'écrit que plus tard (minuterie, promesse, code qui
// suit un `await`) repart quand la clé change : le message qui s'efface tout seul
// (`if $$toast then setTimeout (-> $$toast = null), 50`) disparaît de nouveau.
//
// Défaut : une clé écrite après coup sortait de la liste des dépendances, même lue pendant le passage. L'effet passait
// au montage, puis plus jamais : le message posé par un bouton restait affiché pour toujours, sans erreur.
//
// Règle : une clé lue pendant le passage synchrone de l'effet (hors rappel, minuterie, et hors du code qui suit un
// `await`) reste une dépendance, même s'il l'écrit plus tard ; une lecture faite dans ce code différé ne compte pas ;
// une écriture du passage qui cumule (`$$vus += 1`) ne fait toujours pas de la clé une dépendance.

import assert from 'node:assert/strict'
import * as acorn from 'acorn'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { transpile } from '../src/transpiler/index.js'
import { createHarness } from '../src/testing/index.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

// dépendances du premier `µ.effect(fn, [...])` du composant compilé, triées
async function deps(script: string): Promise<string[]> {
  const js = (await transpile(`<script>\n${script}\n</script>\n<p>{$$toast}</p>\n`, { moduleName: 'liste' })).output
  const i  = js.indexOf('µ.effect(')
  assert.ok(i >= 0, `aucun µ.effect dans :\n${js}`)
  const liste = (acorn.parseExpressionAt(js, i, { ecmaVersion: 'latest' }) as any).arguments[1]
  assert.equal(liste?.type, 'ArrayExpression', `µ.effect sans liste dans :\n${js}`)
  return liste.elements.map((e: any) => e.value).sort()
}

const TOAST = [
  '<script>',
  'µeffect ->',
  '  globalThis.__passages = (globalThis.__passages ?? 0) + 1',
  '  if $$toast',
  '    setTimeout (-> $$toast = null), 50',
  '</script>',
  '<p class="p">{$$toast}</p>',
  '<button class="go" @click={-> $$toast = \'enregistré\'}>go</button>',
].join('\n')

const SAUVEGARDE = [
  '<script>',
  '$$sauvees = 0',
  'µeffect ->',
  '  if $$sale',
  '    await Promise.resolve()',
  '    $$sale = false',
  '    $$sauvees += 1',
  '</script>',
  '<p class="p">{$$sauvees}</p>',
  '<button class="go" @click={-> $$sale = true}>go</button>',
].join('\n')

function projet(etiquette: string, config: Record<string, unknown>): string {
  const root = mjsTmp('effet-cle-lue-puis-ecrite-plus-tard-' + etiquette)
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', ...config }))
  writeFileSync(join(root, 'src', 'toast-efface.mjs'), TOAST + '\n')
  writeFileSync(join(root, 'src', 'sauvegarde-drapeau.mjs'), SAUVEGARDE + '\n')
  return root
}

const pause = (ms = 40) => new Promise(r => setTimeout(r, ms))

describe('µeffect — une clé lue pendant le passage, écrite plus tard, reste une dépendance', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  describe('liste des dépendances', () => {
    it('écrite dans une minuterie (`if $$toast then setTimeout (-> $$toast = null), 50`)', async () => {
      assert.deepEqual(await deps('µeffect ->\n  if $$toast\n    setTimeout (-> $$toast = null), 50'), [ '$$toast' ])
    })

    it('écrite dans une promesse (`Promise.resolve().then -> $$sale = false`)', async () => {
      assert.deepEqual(await deps('µeffect ->\n  if $$sale\n    Promise.resolve().then -> $$sale = false'), [ '$$sale' ])
    })

    it('lue avant un `await`, écrite après', async () => {
      assert.deepEqual(await deps('µeffect ->\n  if $$sale\n    await Promise.resolve()\n    $$sale = false'), [ '$$sale' ])
      assert.deepEqual(await deps('µeffect ->\n  r = await fetch($$url)\n  $$url = null'), [ '$$url' ])
    })

    it('avec une variable locale lue à côté : les deux', async () => {
      assert.deepEqual(await deps('$x = 1\nµeffect ->\n  if $$toast and $x\n    setTimeout (-> $$toast = null), 50'), [ '$$toast', 'x' ])
    })

    it('témoins : lue seulement dans le code différé, ou écrite en cumulant pendant le passage, la marque \'!\' seule', async () => {
      assert.deepEqual(await deps('µeffect ->\n  setInterval (-> $$tick = $$tick + 1), 1000'), [ '!' ])
      assert.deepEqual(await deps('µeffect ->\n  $$k = $$k + 1'), [ '!' ])
      assert.deepEqual(await deps('µeffect ->\n  $$vus += 1\n  setTimeout (-> $$vus = 0), 50'), [ '!' ])
      assert.deepEqual(await deps('µeffect ->\n  $$n = $$n + 1\n  await Promise.resolve()'), [ '!' ])
      assert.deepEqual(await deps('µeffect ->\n  await Promise.resolve()\n  $$m = $$m + 1'), [ '!' ])
    })
  })

  for (const [etiquette, config] of [['dev', {}], ['minifie', { minify: true }]] as const) {
    describe(`exécution (${etiquette})`, () => {
      let app: any
      before(async () => { app = await createHarness({ root: projet(etiquette, config) }) })
      after(async () => { await app?.destroy() })

      it('le message posé par un bouton s\'efface tout seul, à chaque fois', async () => {
        app.window.__passages = 0
        const c = await app.mount('toast-efface')
        try {
          await pause()
          assert.equal(c.text('.p'), '')
          for (let i = 0; i < 2; i++) {
            await c.click('.go')
            await pause(10)
            assert.equal(c.text('.p'), 'enregistré', `affiché après le clic ${i + 1}`)
            await pause(150)
            assert.equal(c.text('.p'), '', `effacé après le clic ${i + 1}`)
          }
          assert.ok(app.window.__passages <= 5, `passages : ${app.window.__passages}`)
        }
        finally { c.destroy() }
      })

      it('la sauvegarde par drapeau, avec un `await`, repart à chaque drapeau posé', async () => {
        const c = await app.mount('sauvegarde-drapeau')
        try {
          await pause()
          for (let i = 1; i <= 2; i++) {
            await c.click('.go')
            await pause()
            assert.equal(c.text('.p'), String(i), `sauvegarde ${i}`)
          }
        }
        finally { c.destroy() }
      })
    })
  }
})
