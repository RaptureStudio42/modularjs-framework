// modules cœur editor et toolbar (<@@editor toolbar>, <@@toolbar tools>) : la liste d'outils se donne en texte (« bold italic »)
// ou en tableau (['bold', 'italic'], la forme naturelle d'un script) ; le tableau donnait une barre sans aucun bouton, sans un mot.
// Un tableau garde les règles du texte : séparateur « | », nom inconnu ignoré avec un avertissement, tableau vide = outils par défaut.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { attendre, pause } from './helpers/coeur-monter.js'

const HOTE = [
  '<script>',
  '  $outils = [\'bold\', \'italic\']',
  '  $avecSep = [\'underline\', \'|\', \'link\', \'gras\']',
  '  $vide = []',
  '  $barre = [\'ul\', \'ol\']',
  '</script>',
  '<@@editor class="e1" name="a" toolbar={$outils} value="<p>un</p>"></@@editor>',
  '<@@editor class="e2" name="b" toolbar={$avecSep} value="<p>deux</p>"></@@editor>',
  '<@@editor class="e3" name="c" toolbar={$vide} value="<p>trois</p>"></@@editor>',
  '<@@toolbar class="t" tools={$barre}></@@toolbar>',
].join('\n')

// comme l'aide des modules cœur, mais les avertissements aussi sont relevés
async function monter(): Promise<{ window: any, hote: any, notes: string[] }> {
  const root   = mjsTmp('barre-tableau')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hote.mjs'), HOTE)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const code  = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))].map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  window.eval(`${code}\nglobalThis.µ = µ;\nglobalThis.__notes = [];\nµ.error = µ.warn = function(...a) { globalThis.__notes.push(a.map(String).join(' ')); };`)
  window.document.body.innerHTML = '<mjs-hote></mjs-hote>'
  const hote = window.document.querySelector('mjs-hote')
  await attendre(() => !!hote._shadow?.querySelector('.t')?._shadow && !!hote._shadow?.querySelector('.e3')?._shadow?.querySelector('.bar')?._shadow)
  await pause(150)
  return { window, hote, notes: window.eval('globalThis.__notes') }
}

describe('mjs-core editor et toolbar — liste d\'outils en tableau', function () {
  this.timeout(60000)
  let window: any
  let hote: any
  let notes: string[]
  before(async () => { ({ window, hote, notes } = await monter()) })
  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  // les boutons d'une barre, et ses séparateurs (« | »), dans l'ordre
  const outils = (barre: any): string => barre?._shadow ? Array.from(barre._shadow.querySelectorAll('button.btn, .sep')).map((b: any) => b.classList.contains('sep') ? '|' : b.dataset.tool).join(' ') : '(pas de barre)'
  const deEditeur = (c: string): string => outils(hote._shadow.querySelector('.' + c)._shadow.querySelector('.bar'))

  it('<@@editor toolbar={[\'bold\', \'italic\']}> : la barre a ces deux boutons', () => {
    assert.equal(deEditeur('e1'), 'bold italic')
  })

  it('un tableau garde les règles du texte : séparateur, nom inconnu ignoré et signalé une fois', () => {
    assert.equal(deEditeur('e2'), 'underline | link')
    assert.equal(notes.filter((n) => n.includes('« gras »')).length, 1, notes.join(' | '))
  })

  it('un tableau vide donne les outils par défaut, comme un texte vide', () => {
    assert.equal(deEditeur('e3').split(' ').filter((n) => n !== '|').length, 14, deEditeur('e3'))
  })

  it('<@@toolbar tools={[\'ul\', \'ol\']}> : la barre séparée accepte aussi un tableau', () => {
    assert.equal(outils(hote._shadow.querySelector('.t')), 'ul ol')
  })
})
