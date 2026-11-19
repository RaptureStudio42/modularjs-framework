// La forme nue d'un gestionnaire (`<button @pointerdown>`) dont le <script> ne déclare que la méthode `@pointerdown` : au
// clic, la méthode est appelée avec l'événement, dans un vrai navigateur (Chromium, Firefox, WebKit). Elle appelait une
// fonction `pointerdown` qui n'existe pas : rien ne se passait, « pointerdown is not defined » en console.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

async function moteur(nom: string): Promise<any> {
  try {
    return (await import('playwright') as any)[nom]
  }
  catch {
    return (await import('@playwright/test' as string) as any)[nom]
  }
}

describe('forme nue `@pointerdown` avec la seule méthode `@pointerdown` : le clic l\'appelle (navigateur)', function () {
  this.timeout(180000)

  let code = ''

  before(async () => {
    const root   = mjsTmp('forme-nue-methode-seule')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'nue.mjs'), '<script>\n$n = 0\n$type = \'\'\n@pointerdown = (e) ->\n  $n++\n  $type = e.type\n</script>\n<button @pointerdown>{$n} {$type}</button>\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    await terminateSharedWorkerPool()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    code = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  })

  for (const nom of ['chromium', 'firefox', 'webkit']) {
    it(`${nom} : deux clics, la méthode reçoit l'événement`, async () => {
      const browser = await (await moteur(nom)).launch()
      try {
        const page    = await browser.newPage()
        const erreurs = [] as string[]
        page.on('pageerror', (e: Error) => erreurs.push(e.message))
        await page.setContent('<!doctype html><html><body></body></html>')
        await page.addScriptTag({ content: code + '\nglobalThis.µ = µ;' })
        await page.evaluate(() => { document.body.innerHTML = '<mjs-nue></mjs-nue>' })
        await page.waitForFunction(() => (document.querySelector('mjs-nue') as any)?._shadow?.querySelector('button') != null)
        // vrai clic de souris au centre du bouton (l'ombre du composant est fermée aux sélecteurs de la page)
        const centre = await page.evaluate(() => { const r = (document.querySelector('mjs-nue') as any)._shadow.querySelector('button').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
        await page.mouse.click(centre.x, centre.y)
        await page.mouse.click(centre.x, centre.y)
        await page.waitForFunction(() => ((document.querySelector('mjs-nue') as any)?._shadow?.querySelector('button')?.textContent ?? '').startsWith('2'), null, { timeout: 5000 })
        const texte = await page.evaluate(() => (document.querySelector('mjs-nue') as any)._shadow.querySelector('button').textContent)
        assert.equal(texte.trim(), '2 pointerdown')
        assert.deepEqual(erreurs, [])
      }
      finally {
        await browser.close()
      }
    })
  }
})
