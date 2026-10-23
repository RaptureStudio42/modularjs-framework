// Un clic sur du contenu projeté par un slot ne doit jouer que les gestionnaires du composant qui a
// écrit ce contenu — jamais un gestionnaire sans rapport du composant qui l'affiche. Défaut garanti
// absent : le routeur d'événements du composant hôte partait de la cible, un nœud de l'AUTRE
// composant, et lisait ses identifiants de routage — numérotés par composant (`e1`, `e2`…), ils
// tombaient sur ceux de l'hôte : le clic sur le bouton projeté déclenchait aussi le bouton `autre`.
// Garde : les gestionnaires propres de l'hôte répondent toujours.
// Chromium et pas happy-dom : happy-dom ne présente pas au shadow root de l'hôte la cible projetée
// comme le fait un vrai navigateur, le défaut n'y apparaît pas.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function chromiumPresent(): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright.chromium.executablePath())
  } catch {
    return false
  }
}

const SOURCES: Record<string, string> = {
  'carte.mjs': '<script>\n$d = 0\n</script>\n<button class="autre" @click={$d++}>autre</button>\n<div class="cadre"><@slot/></div>\n<p class="d">{$d}</p>\n',
  'page.mjs': '<script>\n$a = 0\n</script>\n<@carte><button class="projete" @click={$a++}>projeté</button></@carte>\n<p class="a">{$a}</p>\n'
}

describe('clic sur un contenu projeté par slot (Chromium réel) — seul son propre gestionnaire joue', function () {
  this.timeout(60000)
  let present = false
  let script  = ''

  before(async function () {
    present = await chromiumPresent()
    if (!present) {
      console.log('  ℹ️  Chromium non installé, test des clics projetés sauté. Activer : `npx playwright install chromium`')
      return
    }
    const root   = mjsTmp('clic-projete')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const ordre = [...files.filter((f) => f.startsWith('mjs_')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
    script = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })

  after(async () => { await terminateSharedWorkerPool() })

  it('bouton projeté : son gestionnaire joue, celui du bouton `autre` de l\'hôte non ; le bouton `autre` répond toujours', async function () {
    if (!present) { this.skip(); return }
    const { chromium } = await import('playwright')
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage()
      await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body><mjs-page></mjs-page><script>${script}</script></body></html>`, { waitUntil: 'load' })
      await page.waitForFunction(() => !!(document.querySelector('mjs-page') as any)?._shadow?.querySelector('mjs-carte')?._shadow?.querySelector('.autre'))
      const lire = () => page.evaluate(() => {
        const pageMjs: any = document.querySelector('mjs-page')
        const carte: any   = pageMjs._shadow.querySelector('mjs-carte')
        return { a: pageMjs._shadow.querySelector('.a').textContent, d: carte._shadow.querySelector('.d').textContent }
      })
      // le cas n'a de sens que si les deux boutons partagent un identifiant de routage
      const memeId = await page.evaluate(() => {
        const carte: any = (document.querySelector('mjs-page') as any)._shadow.querySelector('mjs-carte')
        return JSON.stringify(carte.querySelector('.projete')._mjs_ids) === JSON.stringify(carte._shadow.querySelector('.autre')._mjs_ids)
      })
      assert.equal(memeId, true, 'précondition : le bouton projeté et le bouton `autre` portent le même identifiant de routage')

      await page.evaluate(() => { (document.querySelector('mjs-page') as any)._shadow.querySelector('mjs-carte .projete').click() })
      await page.waitForTimeout(50)
      assert.deepEqual(await lire(), { a: '1', d: '0' }, 'clic projeté : seul le gestionnaire du composant qui l\'a écrit joue')

      await page.evaluate(() => { (document.querySelector('mjs-page') as any)._shadow.querySelector('mjs-carte')._shadow.querySelector('.autre').click() })
      await page.waitForTimeout(50)
      assert.deepEqual(await lire(), { a: '1', d: '1' }, 'le bouton propre de l\'hôte répond toujours')
    } finally {
      await browser.close()
    }
  })
})
