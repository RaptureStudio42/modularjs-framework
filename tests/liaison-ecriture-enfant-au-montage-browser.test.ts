// Une prop écrite par l'enfant pendant son `µmount` doit tenir — prop reçue en attribut
// (`<mjs-x valeur="5">`) comme prop liée dans les deux sens (`valeur=!{$x}`), qui remonte alors au
// parent. Défaut garanti absent : l'enfant relisait TOUS ses attributs à la moindre mutation
// d'attribut, dont le retrait de `mjs-loading` juste après le premier rendu ; l'attribut, simple
// reflet de la valeur de départ, écrasait l'écriture du montage. La liaison deux sens y passe quand
// l'enfant est défini APRÈS le parent (chargement différé, cas courant) : le parent n'a alors pu
// poser qu'un attribut. Garde : un attribut que l'on change vraiment est toujours relu.
// Chromium et pas happy-dom : seul un vrai navigateur laisse l'enfant non encore défini au moment
// où le parent pose sa liaison.

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

// l'ordre alphabétique des fichiers compilés fixe l'ordre des définitions : `boite` (parent) avant
// `zenfant` (enfant) — le parent se monte avec un enfant encore inconnu
const SOURCES: Record<string, string> = {
  'zenfant.mjs': '<script>\n$valeur ?= 0\nµmount ->\n  $valeur = 42\n</script>\n<p class="v">{$valeur}</p>\n',
  'boite.mjs': '<script>\n$x = 1\n</script>\n<@zenfant valeur=!{$x}/>\n<p class="x">{$x}</p>\n'
}

describe('prop écrite par l\'enfant pendant son µmount (Chromium réel) — l\'écriture tient', function () {
  this.timeout(60000)
  let present = false
  let script  = ''

  before(async function () {
    present = await chromiumPresent()
    if (!present) {
      console.log('  ℹ️  Chromium non installé, test des écritures au montage sauté. Activer : `npx playwright install chromium`')
      return
    }
    const root   = mjsTmp('liaison-montage')
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

  it('attribut de départ, liaison deux sens vers un enfant défini après le parent : 42 tient et remonte ; un vrai changement d\'attribut est relu', async function () {
    if (!present) { this.skip(); return }
    const { chromium } = await import('playwright')
    const corps   = '<mjs-boite></mjs-boite><mjs-zenfant class="statique" valeur="5"></mjs-zenfant>'
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage()
      await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body>${corps}<script>${script}</script></body></html>`, { waitUntil: 'load' })
      await page.waitForTimeout(250)
      const lire = () => page.evaluate(() => {
        const boite: any    = document.querySelector('mjs-boite')
        const lie: any      = boite._shadow.querySelector('mjs-zenfant')
        const statique: any = document.querySelector('mjs-zenfant.statique')
        return {
          parent:   boite._shadow.querySelector('.x').textContent,
          lie:      lie._shadow.querySelector('.v').textContent,
          statique: statique._shadow.querySelector('.v').textContent
        }
      })
      assert.deepEqual(await lire(), { parent: '42', lie: '42', statique: '42' }, 'l\'écriture du µmount tient chez l\'enfant, et remonte au parent par la liaison')

      await page.evaluate(() => { document.querySelector('mjs-zenfant.statique')!.classList.add('autre') })
      await page.waitForTimeout(50)
      assert.equal((await lire()).statique, '42', 'un autre attribut qui change ne ramène pas l\'ancienne valeur')

      await page.evaluate(() => { document.querySelector('mjs-zenfant.statique')!.setAttribute('valeur', '7') })
      await page.waitForTimeout(50)
      assert.equal((await lire()).statique, '7', 'l\'attribut changé pour de bon est relu')
    } finally {
      await browser.close()
    }
  })
})
