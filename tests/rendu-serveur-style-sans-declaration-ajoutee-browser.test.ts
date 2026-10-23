// Chromium réel : une page rendue par le serveur (moteur happy-dom) puis reçue par le navigateur, et la même page rendue dans le navigateur.
// Une valeur venue d'une donnée, liée à une variable CSS (`--x={…}`), à une propriété (`@style.color={…}`) ou à la pastille de <@@color>,
// qui tente d'ajouter une déclaration (`red; background-image: url(…)`) ne fait partir aucune requête vers le site qu'elle nomme.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer, stripEsm } from '../src/server/renderToString.js'

const HOTE = `<script>
  $v = 'red; background-image: url(http://pisteur.invalid/p.png)'
</script>
<span class="var" --x={$v}>variable</span>
<span class="prop" @style.color={$v}>propriété</span>
<@@color class="pastille" value={$v}></@@color>
`

// le fond calculé de chaque pièce, ombres traversées
const FONDS = `(() => {
  const out = []
  const walk = (r) => { for (const el of r.querySelectorAll('*')) { if (el.matches('.var, .prop, .swatch')) out.push(el.className.split(' ')[0] + ':' + getComputedStyle(el).backgroundImage); const r2 = el._shadow || el.shadowRoot; if (r2 && r2 !== el) walk(r2) } }
  walk(document)
  return out
})()`

describe('rendu serveur puis navigateur — une valeur de style hostile ne fait partir aucune requête (chromium réel)', function () {
  this.timeout(150000)
  let present = false
  let browser: any
  let ssr = ''
  let script = ''

  before(async () => {
    const playwright = await import('playwright')
    present = existsSync(playwright.chromium.executablePath())
    if (!present) return
    const root = mjsTmp('ssr-style-navigateur')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'hote.mjs'), HOTE)
    const renderer = await createSSRRenderer({ sourceDir: join(root, 'src'), bundlerOpts: { runtime: ['hydrate'] } } as any)
    try {
      ssr = (await renderer.renderToString('mjs-hote', { ssrMode: 'markers' } as any)).html
    } finally {
      await renderer.close()
    }
    const outDir  = join(root, 'out')
    const bundler = new Bundler({ sourceDir: join(root, 'src'), outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const ordre = [...files.filter((f) => f.startsWith('mjs_core')), ...files.filter((f) => f.startsWith('mjs_') && !f.startsWith('mjs_core')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
    script = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    browser = await playwright.chromium.launch({ args: ['--no-proxy-server'] })
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  const ouvrir = async (corps: string, pret: string) => {
    const page = await browser.newPage()
    const requetes: string[] = []
    page.on('request', (r: any) => { if (!r.url().startsWith('http://localhost/')) requetes.push(r.url()) })
    await page.route('http://pisteur.invalid/**', (route: any) => route.fulfill({ status: 200, contentType: 'image/png', body: '' }))
    await page.route('http://localhost/**', (route: any) => route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${corps}</body></html>` }))
    await page.goto('http://localhost/page', { waitUntil: 'load' })
    await page.waitForFunction(pret)
    await page.waitForTimeout(500)
    const fonds = await page.evaluate(FONDS)
    await page.close()
    return { requetes, fonds }
  }

  it('la page du serveur, reçue sans script : aucune requête, aucune image de fond', async function () {
    if (!present) { this.skip(); return }
    assert.match(ssr, /shadowrootmode/, 'préalable : la page est rendue par le serveur')
    const vu = await ouvrir(ssr, `(() => { const h = document.querySelector('mjs-hote'); return !!(h && h.shadowRoot && h.shadowRoot.querySelector('.var') && h.shadowRoot.querySelector('mjs-core-color')) })()`)
    assert.deepEqual(vu.requetes, [])
    assert.equal(vu.fonds.length, 3, 'les trois pièces sont là : ' + vu.fonds.join(', '))
    assert.ok(vu.fonds.every((f: string) => f.endsWith(':none')), vu.fonds.join(', '))
  })

  it('la même page rendue dans le navigateur : aucune requête, aucune image de fond', async function () {
    if (!present) { this.skip(); return }
    const vu = await ouvrir(`<mjs-hote></mjs-hote><script>${script.replace(/<\/script/gi, '<\\/script')}</script>`, `!!document.querySelector('mjs-hote')?._shadow?.querySelector('.pastille')?._shadow?.querySelector('.swatch')`)
    assert.deepEqual(vu.requetes, [])
    assert.equal(vu.fonds.length, 3, 'les trois pièces sont là : ' + vu.fonds.join(', '))
    assert.ok(vu.fonds.every((f: string) => f.endsWith(':none')), vu.fonds.join(', '))
  })
})
