// `@click=nom` (ou `@click={nom}`) qui nomme une fonction du navigateur l'appelle sans la balise pour `this` : `alert`,
// `confirm` et `prompt` ouvrent leur boîte, `print`, `getSelection`, `focus`, `stop` et `scrollTo` passent sans erreur,
// Une fonction qui lève quand elle reçoit l'événement (`requestIdleCallback`) n'est plus de la liste : elle est refusée à la construction.
// Appelées avec la balise pour `this`, elles levaient toutes « Illegal invocation » au clic, sans rien faire. Une
// fonction du <script> qui porte le nom d'une fonction du navigateur reste celle du <script>. Chromium réel

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

async function chromium(): Promise<any> {
  try {
    return (await import('playwright')).chromium
  }
  catch {
    return (await import('@playwright/test' as string)).chromium
  }
}

const NOMS = ['alert', 'confirm', 'prompt', 'print', 'getSelection', 'focus', 'stop', 'scrollTo']

describe('gestionnaire — une fonction du navigateur nommée par `@click=nom` (Chromium)', function () {
  this.timeout(120000)

  it('appelée sans la balise pour `this` : aucune « Illegal invocation », les boîtes s\'ouvrent ; un homonyme du <script> reste le sien', async () => {
    const root   = mjsTmp('gestionnaire-fonction-du-navigateur')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    const boutons = NOMS.map((nom) => `<button class="${nom}" @click=${nom}>${nom}</button>\n<button class="${nom}-acc" @click={${nom}}>${nom}</button>`).join('\n')
    writeFileSync(join(srcDir, 'nav.mjs'), `<script>\n$n = 0\n</script>\n${boutons}\n<p class="r">{$n}</p>\n`)
    writeFileSync(join(srcDir, 'homonyme.mjs'), '<script>\n$n = 0\nstop = -> $n++\n</script>\n<button class="stop" @click=stop>stop</button>\n<p class="r">{$n}</p>\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    await terminateSharedWorkerPool()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    const browser = await (await chromium()).launch()
    try {
      const page    = await browser.newPage()
      const erreurs = [] as string[]
      const boites  = [] as string[]
      page.on('pageerror', (e: Error) => erreurs.push(e.message))
      page.on('dialog', (d: any) => {
        boites.push(d.type())
        d.dismiss().catch(() => {})
      })
      await page.setContent('<!doctype html><html><body></body></html>')
      await page.addScriptTag({ content: code + '\nglobalThis.µ = µ;' })
      await page.evaluate(() => { document.body.innerHTML = '<mjs-nav></mjs-nav><mjs-homonyme></mjs-homonyme>' })
      await page.waitForFunction(() => (document.querySelector('mjs-homonyme') as any)?._shadow?.querySelector('.r')?.textContent === '0')
      const vus = {} as Record<string, string>
      for (const nom of NOMS) {
        for (const classe of [nom, `${nom}-acc`]) {
          erreurs.length = 0
          await page.evaluate((c: string) => (document.querySelector('mjs-nav') as any)._shadow.querySelector(`.${c}`).click(), classe)
          await page.waitForTimeout(50)
          vus[classe] = erreurs.join(' | ')
        }
      }
      for (const [classe, vu] of Object.entries(vus)) {
        assert.doesNotMatch(vu, /Illegal invocation/, classe)
        assert.equal(vu, '', classe)
      }
      assert.deepEqual(boites, ['alert', 'alert', 'confirm', 'confirm', 'prompt', 'prompt'])
      erreurs.length = 0
      await page.evaluate(() => (document.querySelector('mjs-homonyme') as any)._shadow.querySelector('.stop').click())
      await page.waitForFunction(() => (document.querySelector('mjs-homonyme') as any)._shadow.querySelector('.r').textContent === '1')
      assert.deepEqual(erreurs, [])
    }
    finally {
      await browser.close()
    }
  })
})
