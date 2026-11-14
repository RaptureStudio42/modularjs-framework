// mise à jour fine après la reprise d'un rendu serveur (repères, Chromium, Firefox, WebKit) : les lignes reprises gardent leur objet et leur fermeture,
// l'écriture d'un champ ne rappelle que la ligne qui le montre, avec le masque du champ, et l'écran est celui de la variable entière prévenue

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { createSSRRenderer, stripEsm } from '../src/server/renderToString.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const LISTE = [
  '<script lang="js">',
  '  $data = [{ id: 1, label: \'a\' }, { id: 2, label: \'b\' }, { id: 3, label: \'c\' }];',
  '  @ecrire = function() { $data[1].label += \'!\'; };',
  '</script>',
  '<ul>{for row in $data by id}<li>{row.label}</li>{end}</ul>',
].join('\n')

describe('mise à jour fine — après la reprise d\'un rendu serveur (trois moteurs)', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('la ligne reprise est rappelée seule, avec le masque du champ écrit', async () => {
    const root   = mjsTmp('fine-reprise')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'liste.mjs'), LISTE)
    const renderer = await createSSRRenderer({ sourceDir: srcDir, outputDir: outDir, bundlerOpts: { runtime: ['hydrate'] } })
    const { html, hydrateScript } = await renderer.renderToString('mjs-liste', { ssrMode: 'markers' })
    await renderer.close()
    const files  = readdirSync(outDir).filter((f) => f.endsWith('.js') && f !== 'bundle.js')
    const ordre  = [...files.filter((f) => f.startsWith('mjs_')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
    const bundle = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    const playwright: any = await import('playwright')
    for (const moteur of ['chromium', 'firefox', 'webkit']) {
      const browser = await playwright[moteur].launch(moteur === 'chromium' ? { args: ['--no-proxy-server'] } : {})
      try {
        const page = await browser.newPage()
        const erreurs: string[] = []
        page.on('pageerror', (e: any) => erreurs.push(String(e)))
        await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body>${html}${hydrateScript}<script>${bundle}</script></body></html>`, { waitUntil: 'networkidle' })
        await page.waitForFunction(() => (document.querySelector('mjs-liste') as any)?._mjs_hydrated === true)
        const res = await page.evaluate(async () => {
          const el = document.querySelector('mjs-liste') as any
          const vus: any[] = []
          for (const cache of Object.values(el._mjs_list_cache) as any[]) {
            for (const en of cache.values()) {
              const f = en._mjs_updFn
              en._mjs_updFn = (it: any, ix: any, m?: number) => { vus.push([ix, m]); return f(it, ix, m) }
            }
          }
          el.ecrire()
          await new Promise((r) => setTimeout(r, 30))
          return { textes: Array.from(el.shadowRoot.querySelectorAll('li')).map((x: any) => x.textContent), vus, table: !!el._mjs_fine }
        })
        assert.deepEqual(res.textes, ['a', 'b!', 'c'], moteur)
        assert.ok(res.table, `table posée (${moteur})`)
        assert.deepEqual(res.vus, [[1, 1]], moteur)
        assert.deepEqual(erreurs, [], moteur)
      }
      finally {
        await browser.close()
      }
    }
  })
})
