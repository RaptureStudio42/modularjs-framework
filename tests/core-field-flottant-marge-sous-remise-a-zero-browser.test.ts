// module cœur field (<@@field layout="float">) dans Chromium réel, sous la remise à zéro que le composant adopte (`* { margin: 0; padding: 0 }`,
// la feuille mjs_reset du dossier des feuilles partagées, posée dans chaque racine d'ombre) : la case touchée puis vide garde sa marge intérieure
// (20px 10px 20px 60px), l'icône et le libellé restent DANS la case et ne chevauchent pas le message d'erreur. Un ::slotted() perd devant toute
// règle normale de l'arbre où vit la case (spec CSS Scoping) : sans protection, la case tombait à 22 px et l'icône et le libellé passaient dessous,
// sur le message. Témoin : la même page sans remise à zéro

import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { write } from './helpers/construction-cache.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'

const CHAMP = `<vars>
  $nom  string 3..20
</vars>

<script>
  $form = µform(@)
</script>

<form :noUJS>
  <@@field layout="float" label="Nom" icon="☺">
    <input name="nom" value=!{$nom}>
  </@@field>
</form>

<style>
  :host
    display: block
    width: 420px
    padding: 40px 30px 30px 50px
</style>
`
const RESET = '*\n  margin: 0\n  padding: 0\n'

// le projet construit, avec ou sans la remise à zéro dans ses feuilles partagées : le dossier de sortie
async function construire(reset: boolean): Promise<string> {
  const root = mjsTmp('field-flottant-' + (reset ? 'reset' : 'temoin'))
  write(join(root, 'mjs.config.json'), `${JSON.stringify({ sourceDir: 'app', outputDir: 'out', manifestPath: 'out/bundle.js', urlPrefix: '/out', stylesheetsDir: 'app/styles' }, null, 2)}\n`)
  write(join(root, 'app/champ-flottant.mjs'), CHAMP)
  if (reset) write(join(root, 'app/styles/mjs_reset.sass'), RESET)
  const found   = findConfig(root)!
  const bundler = new Bundler(resolveBundlerOpts(found.config, found.configDir) as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return join(root, 'out')
}

// la page servie, un clic dans la case puis Tab (touchée, vide) : sa marge, l'icône et le libellé par rapport à la case, le message
async function relever(outDir: string): Promise<any> {
  const playwright: any = await import('playwright')
  const browser = await playwright.chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 600, height: 400 } })
    const logs: string[] = []
    page.on('pageerror', (e: any) => logs.push('PAGEERROR: ' + String(e).slice(0, 300)))
    await page.route('http://essai.local/**', async (route: any) => {
      const chemin = new URL(route.request().url()).pathname
      if (!chemin.startsWith('/out/')) {
        await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html lang="fr"><head><meta charset="utf-8"><script type="module" src="/out/bundle.js"></script></head><body><mjs-champ-flottant></mjs-champ-flottant></body></html>' })
        return
      }
      const fichier = join(outDir, normalize(chemin.slice(5)))
      if (!fichier.startsWith(outDir) || !existsSync(fichier) || !statSync(fichier).isFile()) { await route.fulfill({ status: 404, body: '' }); return }
      await route.fulfill({ status: 200, contentType: fichier.endsWith('.js') ? 'text/javascript' : fichier.endsWith('.css') ? 'text/css' : 'application/json', body: readFileSync(fichier) })
    })
    await page.goto('http://essai.local/')
    await page.waitForFunction(`(() => { const h = document.querySelector('mjs-champ-flottant'); const s = h && (h._shadow || h.shadowRoot); const f = s && s.querySelector('mjs-core-field'); return !!(f && (f._shadow || f.shadowRoot)?.querySelector('.icon')) })()`, null, { timeout: 60000 })
    const ombre = `document.querySelector('mjs-champ-flottant')._shadow || document.querySelector('mjs-champ-flottant').shadowRoot`
    await (await page.evaluateHandle(`(${ombre}).querySelector('input')`)).asElement().click()
    await page.keyboard.press('Tab')
    await page.waitForFunction(`(() => { const f = (${ombre}).querySelector('mjs-core-field'); return !!(f._shadow || f.shadowRoot).querySelector('.error') })()`, null, { timeout: 10000 })
    // les transitions du libellé et de l'icône (.25s) finies
    await page.waitForTimeout(600)
    const vu = await page.evaluate(`(() => {
      const s  = ${ombre}
      const f  = s.querySelector('mjs-core-field')
      const fs = f._shadow || f.shadowRoot
      const i  = s.querySelector('input')
      const rg = document.createRange()
      rg.selectNodeContents(fs.querySelector('.float-label'))
      const ri = i.getBoundingClientRect()
      const rc = fs.querySelector('.icon').getBoundingClientRect()
      const rt = rg.getBoundingClientRect()
      const re = fs.querySelector('.error').getBoundingClientRect()
      const dedans = (r) => r.top >= ri.top - 0.5 && r.bottom <= ri.bottom + 0.5
      const sur    = (a, b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top)
      return { marge: getComputedStyle(i).padding, iconeDansLaCase: dedans(rc), libelleDansLaCase: dedans(rt), chevaucheLeMessage: sur(rc, re) || sur(rt, re), message: fs.querySelector('.error').textContent.trim() !== '' }
    })()`)
    return { vu, erreurs: logs }
  }
  finally {
    await browser.close()
  }
}

describe('mjs-core-field — le modèle flottant garde sa géométrie sous une remise à zéro de la page (chromium réel)', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  const attendu = { marge: '20px 10px 20px 60px', iconeDansLaCase: true, libelleDansLaCase: true, chevaucheLeMessage: false, message: true }

  it('remise à zéro adoptée (* { margin: 0; padding: 0 }) : la case touchée puis vide garde sa marge, l\'icône et le libellé restent dedans, loin du message', async function () {
    const playwright: any = await import('playwright')
    if (!existsSync(playwright.chromium.executablePath())) { this.skip(); return }
    const { vu, erreurs } = await relever(await construire(true))
    assert.deepEqual(vu, attendu)
    assert.deepEqual(erreurs, [])
  })

  it('témoin sans remise à zéro : la même case, la même géométrie', async function () {
    const playwright: any = await import('playwright')
    if (!existsSync(playwright.chromium.executablePath())) { this.skip(); return }
    const { vu, erreurs } = await relever(await construire(false))
    assert.deepEqual(vu, attendu)
    assert.deepEqual(erreurs, [])
  })
})
