// module cœur radio (<@@radio>) : un bouton monté plus tard, quand la variable liée avait déjà changé, gardait ce
// choix-là en photo ; la remise à zéro du formulaire donnait alors le dernier choix de la page ou le choix de
// départ, selon l'ordre des écouteurs (le bouton monté en dernier écrivait en dernier). Le groupe revient au
// choix de son premier rendu, celui du bouton monté le premier, et chaque bouton se coche d'après lui.
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
  <@@radio id="r1" name="z" value="a" group=!{$z}>A</@@radio>
  <@@radio id="r2" name="z" value="b" group=!{$z}>B</@@radio>
  <@@radio id="r3" name="z" value="c" group=!{$z}>C</@@radio>
  {if $more}<@@radio id="r4" name="z" value="d" group=!{$z}>D</@@radio>{end}
  <button type="reset" id="raz">reset</button>
</form>
<p id="val">{$z}</p>
`

let compile: Promise<string> | null = null

// le script de la page (cœur, modules, hôte), compilé une fois pour les deux navigateurs
function script(): Promise<string> {
  compile ??= (async () => {
    const root   = mjsTmp('radio-reset-monte-tard')
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

for (const nom of ['chromium', 'firefox'] as const) describe(`radio : form.reset() d'un groupe dont un bouton est monté tard (${nom} réel)`, function () {
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

  it('un quatrième bouton monté quand la page avait choisi c : après un autre choix, la remise rend b, pas c', async function () {
    if (!present) { this.skip(); return }
    assert.equal(await valeur(), 'b', 'départ')
    assert.equal(await coches(), 'a=non b=oui c=non')
    await page.evaluate(`document.querySelector('mjs-hote')._set('z', 'c')`)
    await attendre()
    await page.evaluate(`document.querySelector('mjs-hote')._set('more', true)`)
    await attendre()
    assert.equal(await coches(), 'a=non b=non c=oui d=non', 'la page a choisi c, puis un quatrième bouton est monté')
    await choisir('r2')
    await attendre()
    assert.equal(await valeur(), 'b', 'préalable : l\'utilisateur a choisi b')
    await remettre()
    await attendre()
    assert.equal(await valeur(), 'b', 'la variable revient au choix du premier rendu, pas au choix de la page quand le quatrième bouton a été monté')
    assert.equal(await coches(), 'a=non b=oui c=non d=non', 'seul le bouton du premier choix est coché')
    await remettre()
    await attendre()
    assert.equal(await valeur(), 'b', 'une seconde remise donne la même chose')
  })

  it('le bouton monté tard, choisi par l\'utilisateur, est décoché par la remise : le groupe revient au premier choix', async function () {
    if (!present) { this.skip(); return }
    await choisir('r4')
    await attendre()
    assert.equal(await valeur(), 'd', 'préalable : l\'utilisateur a choisi d')
    await remettre()
    await attendre()
    assert.equal(await valeur(), 'b')
    assert.equal(await coches(), 'a=non b=oui c=non d=non')
  })
})
