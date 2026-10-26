// Un composant qui déclare ses propres µawake et µsleep ET pose un écouteur de fenêtre (`<@window @pointerdown={…}>`) se construit,
// en Civet comme en CoffeeScript, en développement comme en production : le `<@window>` enchaîne ses poses derrière les crochets du
// composant au lieu d'en déclarer un second (« déclare µawake deux fois », vu dans une appli réelle). Au montage, le réveil du composant
// et l'écouteur tournent ; déplacé (retiré puis remis), le sommeil puis le réveil rejouent, et l'écouteur reste posé une seule fois ;
// retiré, l'écouteur part

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const BALISE = 'mjs-humeur-fenetre'
const source = (lang: string) => `<script${lang === 'coffee' ? ' lang="coffee"' : ''}>
  $taps = 0
  woke  = false
  @away = (e) -> $taps++
  µawake ->
    window.__reveils = (window.__reveils or 0) + 1
    if woke
      window.__retours = (window.__retours or 0) + 1
    else
      woke = true
  µsleep ->
    window.__sommeils = (window.__sommeils or 0) + 1
</script>
<@window @pointerdown={@away(e)}>
<p class="t">{$taps}</p>
`

async function construire(prefixe: string, src: string, prod: boolean): Promise<string> {
  const root = mjsTmp(prefixe), srcDir = join(root, 'src'), outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'humeur-fenetre.mjs'), src)
  const opts: any = prod ? { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env: 'prod', js: 'bundle' } : { sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') }
  const bundler = new Bundler(opts)
  const stats = await bundler.compile()
  await bundler.close()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [], 'la construction passe')
  if (prod) return readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
  const rang = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b))
  return files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('<@window> et les µawake / µsleep du composant, dans le même composant', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const lang of ['civet', 'coffee']) {
    for (const mode of ['dev', 'prod']) {
      it(`${lang === 'civet' ? 'Civet' : 'CoffeeScript'}, ${mode === 'dev' ? 'développement' : 'production'} : la construction passe, le réveil, le sommeil et l'écouteur tournent`, async () => {
        const code = await construire(`window-awake-${lang}-${mode}`, source(lang), mode === 'prod')
        const window: any = new Window({ url: 'http://localhost/' })
        try {
          window.eval(code)
          window.document.body.innerHTML = `<${BALISE}></${BALISE}>`
          const c = window.document.querySelector(BALISE)
          const texte = () => c._shadow?.querySelector('.t')?.textContent
          await attendre(() => texte() === '0')
          assert.deepEqual([window.__reveils, window.__retours], [1, undefined], 'au montage : le réveil du composant, une fois')
          window.dispatchEvent(new window.Event('pointerdown'))
          await attendre(() => texte() === '1')
          assert.equal(texte(), '1', 'l\'écouteur de <@window>')
          c.remove()
          window.document.body.appendChild(c)
          await attendre(() => window.__reveils === 2)
          assert.deepEqual([window.__sommeils, window.__reveils, window.__retours], [1, 2, 1], 'déplacé : le sommeil, puis le réveil du composant')
          window.dispatchEvent(new window.Event('pointerdown'))
          await attendre(() => texte() !== '1')
          assert.equal(texte(), '2', 'après le déplacement, l\'écouteur est posé une seule fois')
          c.remove()
          await attendre(() => window.__sommeils === 2)
          window.dispatchEvent(new window.Event('pointerdown'))
          await new Promise((r) => setTimeout(r, 30))
          assert.equal(texte(), '2', 'retiré : l\'écouteur part avec le composant')
        }
        finally { await window.happyDOM.close() }
      })
    }
  }
})
