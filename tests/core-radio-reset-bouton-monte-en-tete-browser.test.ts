// module cœur radio (<@@radio>) : le choix de départ d'un groupe lié est celui du bouton monté le PREMIER, pas
// celui du premier bouton dans la page. Un bouton monté tard et placé EN TÊTE du groupe, quand la variable avait
// déjà changé, a pris ce choix-là en photo : la remise à zéro du formulaire doit ignorer cette photo.
// Chromium et Firefox réels : le formulaire, les boutons et le bouton « reset » sont ceux du navigateur.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const PAGE = `<script>
  $z    = 'b'
  $more = false
</script>
<form id="f" @noUJS>
  {if $more}<@@radio id="r4" name="z" value="d" group=!{$z}>D</@@radio>{end}
  <@@radio id="r1" name="z" value="a" group=!{$z}>A</@@radio>
  <@@radio id="r2" name="z" value="b" group=!{$z}>B</@@radio>
  <@@radio id="r3" name="z" value="c" group=!{$z}>C</@@radio>
  <button type="reset" id="raz">reset</button>
</form>
<p id="val">{$z}</p>
`

let compile: Promise<string> | null = null

// le script de la page (cœur, modules, hôte), compilé une fois pour les deux navigateurs
function script(): Promise<string> {
  compile ??= (async () => {
    const root   = mjsTmp('radio-reset-monte-en-tete')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), PAGE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const ordre = [...files.filter((f) => f.startsWith('mjs_core')), ...files.filter((f) => f.startsWith('mjs_') && !f.startsWith('mjs_core')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
    return ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })()
  return compile
}

for (const nom of ['chromium', 'firefox'] as const) describe(`radio : form.reset() d'un groupe dont un bouton est monté tard, en tête (${nom} réel)`, function () {
  this.timeout(180000)
  let present = false
  let browser: any
  let page: any

  const valeur   = async () => await page.evaluate(`__q('#val').textContent`)
  const coches   = async () => await page.evaluate(`[...__q('#f').querySelectorAll('mjs-core-radio')].map((r) => r._state.value + '=' + (r._shadow.querySelector('input.native').checked ? 'oui' : 'non')).join(' ')`)
  const attendre = () => page.waitForTimeout(400)
  const choisir  = (id: string) => page.evaluate(`__q('#${id}')._shadow.querySelector('input.native').click()`)
  const remettre = () => page.evaluate(`__q('#raz').click()`)

  before(async () => {
    try {
      const playwright = await import('playwright')
      present = existsSync(playwright[nom].executablePath())
      if (!present) return
      const code = await script()
      browser = await playwright[nom].launch()
      page    = await browser.newPage({ viewport: { width: 900, height: 700 } })
      await page.addInitScript('window.__name = (f) => f')
      await page.setContent(`<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-hote></mjs-hote><script>${code}</script></body></html>`, { waitUntil: 'load' })
      await page.waitForFunction(() => !!(document.querySelector('mjs-hote') as any)?._shadow?.querySelector('#r3')?._shadow?.querySelector('input.native'))
      await page.evaluate(`window.__q = (s) => document.querySelector('mjs-hote')._shadow.querySelector(s)`)
      await page.waitForTimeout(500)
    } catch (e) { present = false; throw e }
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('un bouton monté tard en tête, quand la page avait choisi c : la remise rend b (le premier monté), pas c', async function () {
    if (!present) { this.skip(); return }
    assert.equal(await coches(), 'a=non b=oui c=non')
    await page.evaluate(`document.querySelector('mjs-hote')._set('z', 'c')`)
    await attendre()
    await page.evaluate(`document.querySelector('mjs-hote')._set('more', true)`)
    await attendre()
    assert.equal(await coches(), 'd=non a=non b=non c=oui', 'le bouton d est monté tard, placé avant a')
    await choisir('r2')
    await attendre()
    assert.equal(await valeur(), 'b', 'préalable : l\'utilisateur a choisi b')
    await remettre()
    await attendre()
    assert.equal(await valeur(), 'b', 'le départ est celui du premier bouton monté, pas du premier dans la page')
    assert.equal(await coches(), 'd=non a=non b=oui c=non')
  })
})
