// µon délégué (`µon 'click', '.item', …`) — la recherche de l'élément visé remonte depuis la cible du clic, et ne doit jamais sortir
// du composant. Depuis un contenu glissé dans un <slot>, elle remontait jusque dans la page : le gestionnaire du composant recevait
// un `.item` de la page qui l'entoure. Le contenu glissé qui porte lui-même la classe reste visé (il est dans l'hôte). Lu dans un
// navigateur réel : happy-dom ne donne pas le chemin complet de l'événement à travers le <slot>.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const DELEG = `<script>
  µon 'click', '.item', (e, t) -> globalThis.__vise = t.className
</script>
<div class="item mien">à moi</div><slot></slot>
`

describe('µon délégué — ne remonte jamais au-delà de l\'hôte du composant', function () {
  this.timeout(80000)
  let navigateur: any

  after(async () => {
    await navigateur?.close()
    await terminateSharedWorkerPool()
  })

  it('clic dans le contenu glissé, sur le contenu glissé visé, et dans l\'ombre', async function () {
    const playwright = await import('playwright')
    if (!existsSync(playwright.chromium.executablePath())) this.skip()
    const root   = mjsTmp('on-delegue-borne')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'deleg.mjs'), DELEG)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
    const code  = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    navigateur  = await playwright.chromium.launch({ args: ['--no-proxy-server'] })
    const page  = await navigateur.newPage()
    const erreurs: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(e.message))
    await page.setContent('<!doctype html><html><body><div class="item dehors"><mjs-deleg><span class="glisse">glissé</span><span class="item dedans">glissé visé</span></mjs-deleg></div></body></html>')
    await page.addScriptTag({ content: code + '\nglobalThis.µ = µ;' })
    await page.waitForFunction(() => { const d: any = document.querySelector('mjs-deleg'); return !!d && !!d._shadow && !!d._shadow.querySelector('.mien') })
    const vu = await page.evaluate(() => {
      const w: any = window
      const cliquer = (n: any) => { w.__vise = null; n.click(); return w.__vise }
      const d: any  = document.querySelector('mjs-deleg')
      return {
        glisse: cliquer(document.querySelector('span.glisse')),
        dedans: cliquer(document.querySelector('span.dedans')),
        ombre:  cliquer(d._shadow.querySelector('.mien'))
      }
    })
    assert.deepEqual(vu, { glisse: null, dedans: 'item dedans', ombre: 'item mien' })
    assert.deepEqual(erreurs, [])
  })
})
