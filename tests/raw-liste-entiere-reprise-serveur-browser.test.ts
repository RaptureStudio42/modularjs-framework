// `µraw(liste, true)` après la reprise d'un rendu serveur (repères ; Chromium, Firefox, WebKit) : le serveur rend la liste marquée d'un
// coup, les lignes reprises gardent leur objet, et la liste qui repasse les saute sans chercher la marque d'aucune ; une ligne écrite
// sur place garde son texte, un objet remplacé par un neuf se voit, lui seul

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { createSSRRenderer, stripEsm } from '../src/server/renderToString.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const LIST = [
  '<script lang="js">',
  '  $data = µ.raw([{ id: 1, label: \'a\' }, { id: 2, label: \'b\' }, { id: 3, label: \'c\' }], true);',
  '  @rows   = function() { return $data; };',
  '  @review = function() { $data = µ.raw($data.slice(), true); };',
  '  @rename = function() { $data = µ.raw($data.map((r) => r.id === 2 ? { id: 2, label: \'N\' } : r), true); };',
  '</script>',
  '<ul>{for row in $data by id}<li>{row.label}</li>{end}</ul>',
].join('\n')

describe('µraw(liste, true) — après la reprise d\'un rendu serveur (trois moteurs)', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('le serveur rend la liste ; reprises, ses lignes sont sautées sans recherche, et un objet remplacé se voit', async () => {
    const root   = mjsTmp('raw-liste-reprise')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'liste.mjs'), LIST)
    const renderer = await createSSRRenderer({ sourceDir: srcDir, outputDir: outDir, bundlerOpts: { runtime: ['hydrate', 'rare_runes'] } })
    const { html, hydrateScript } = await renderer.renderToString('mjs-liste', { ssrMode: 'markers' })
    await renderer.close()
    for (const label of ['a', 'b', 'c']) assert.ok(html.includes(`>${label}<`), `le serveur n'a pas rendu la ligne « ${label} »`)
    const files  = readdirSync(outDir).filter((f) => f.endsWith('.js') && f !== 'bundle.js')
    const order  = [...files.filter((f) => f.startsWith('mjs_')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
    const bundle = order.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    const playwright: any = await import('playwright')
    for (const engine of ['chromium', 'firefox', 'webkit']) {
      const browser = await playwright[engine].launch(engine === 'chromium' ? { args: ['--no-proxy-server'] } : {})
      try {
        const page = await browser.newPage()
        const errors: string[] = []
        page.on('pageerror', (e: any) => errors.push(String(e)))
        await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body>${html}${hydrateScript}<script>${bundle}</script></body></html>`, { waitUntil: 'networkidle' })
        await page.waitForFunction(() => (document.querySelector('mjs-liste') as any)?._mjs_hydrated === true)
        const seen = await page.evaluate(async () => {
          const el    = document.querySelector('mjs-liste') as any
          const core  = (globalThis as any).µ
          const texts = () => Array.from(el.shadowRoot.querySelectorAll('li')).map((x: any) => x.textContent)
          const wait  = () => new Promise((r) => setTimeout(r, 30))
          // marques cherchées pour autre chose qu'une liste : celle d'une ligne
          let sought  = 0
          const has   = core._mjs_rawSet.has
          core._mjs_rawSet.has = function(x: any) { if (!Array.isArray(x)) sought++; return has.call(this, x) }
          const out: any = { woken: texts(), noted: !!core._mjs_rawRows?.has(el.rows()) }
          el.rows()[0].label = 'A'
          el.review()
          await wait()
          out.reviewed = texts()
          el.rename()
          await wait()
          out.renamed = texts()
          out.sought  = sought
          return out
        })
        assert.deepEqual(seen, { woken: ['a', 'b', 'c'], noted: true, reviewed: ['a', 'b', 'c'], renamed: ['a', 'N', 'c'], sought: 0 }, engine)
        assert.deepEqual(errors, [], engine)
      }
      finally {
        await browser.close()
      }
    }
  })
})
