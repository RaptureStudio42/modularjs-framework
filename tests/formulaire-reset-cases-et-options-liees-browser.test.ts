// `checked={…}` et `selected={…}` liés : dans la page, l'attribut dit l'état du PREMIER rendu — celui
// auquel `form.reset()` revient. Défaut garanti absent : l'attribut témoin du HTML restait sur chaque
// case et chaque option, quelle que soit la valeur ; un bouton « réinitialiser » cochait les cases
// décochées et choisissait la dernière option, et `option[selected]` les trouvait toutes.
// Gardes : la liste suit toujours l'état, même après un choix à la main ; l'attribut, lui, ne bouge plus
// après le premier rendu (c'est la valeur par défaut du formulaire).
// Chromium : l'état « modifié par l'utilisateur » d'une case et d'une option n'existe que là.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const PAGE = '<script>\n$jeux = [{id: \'a\', nom: \'A\'}, {id: \'b\', nom: \'B\'}, {id: \'c\', nom: \'C\'}]\n$choisi = \'b\'\n$ok = false\n$oui = true\n</script>\n<form class="f">\n<select class="s" aria-label="jeu">\n  {for j in $jeux by id}\n    <option value={j.id} selected={j.id is $choisi ? true : null}>{j.nom}</option>\n  {end}\n</select>\n<input class="c" type="checkbox" aria-label="ok" checked={$ok}>\n<input class="d" type="checkbox" aria-label="oui" checked={$oui}>\n</form>\n'

describe('formulaire lié : form.reset() revient à l\'état du premier rendu (Chromium réel)', function () {
  this.timeout(90000)
  let present = false
  let browser: any
  let script = ''

  before(async () => {
    try {
      const playwright = await import('playwright')
      present = existsSync(playwright.chromium.executablePath())
      if (!present) return
      const root   = mjsTmp('reset-lie')
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'page.mjs'), PAGE)
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
      const order = [...files.filter((f) => f.startsWith('mjs_core')), ...files.filter((f) => f.startsWith('mjs_') && !f.startsWith('mjs_core')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
      script  = order.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
      browser = await playwright.chromium.launch()
    } catch { present = false }
  })
  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('une seule option porte selected, la case décochée ne porte pas checked, et reset() y revient', async function () {
    if (!present) { this.skip(); return }
    const page = await browser.newPage()
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body><mjs-page></mjs-page><script>${script}</script></body></html>`, { waitUntil: 'load' })
    await page.waitForFunction(() => !!(document.querySelector('mjs-page') as any)?._shadow?.querySelector('option'))
    const read = () => page.evaluate(() => {
      const sh: any = (document.querySelector('mjs-page') as any)._shadow
      const s = sh.querySelector('.s')
      return { valeur: s.value, marques: Array.from(sh.querySelectorAll('option[selected]')).map((o: any) => o.value).join(','), ok: sh.querySelector('.c').checked, okMarque: sh.querySelector('.c').hasAttribute('checked'), oui: sh.querySelector('.d').checked, ouiMarque: sh.querySelector('.d').hasAttribute('checked') }
    })
    assert.deepEqual(await read(), { valeur: 'b', marques: 'b', ok: false, okMarque: false, oui: true, ouiMarque: true }, 'premier rendu')
    await page.evaluate(() => { const p: any = document.querySelector('mjs-page'); p._set('choisi', 'c'); p._set('ok', true); p._set('oui', false) })
    await page.waitForTimeout(80)
    assert.deepEqual(await read(), { valeur: 'c', marques: 'b', ok: true, okMarque: false, oui: false, ouiMarque: true }, 'l\'état change : la liste et les cases suivent, la valeur de départ reste')
    await page.evaluate(() => (document.querySelector('mjs-page') as any)._shadow.querySelector('.f').reset())
    const apres = await read()
    assert.deepEqual({ valeur: apres.valeur, ok: apres.ok, oui: apres.oui }, { valeur: 'b', ok: false, oui: true }, 'reset() : retour au premier rendu')
    await page.close()
  })
})
