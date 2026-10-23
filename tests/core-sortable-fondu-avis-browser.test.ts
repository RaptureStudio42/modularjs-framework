// `<@@sortable>` en développement : le fondu des lignes (la ligne qui sort d'une liste avec une transition, que la page fait voler) reste toujours dans
// le module, mais quand aucune page de l'appli n'écrit de transition et qu'une ligne quitte pourtant sa liste avec une sortie (posée par un script), le module
// le dit, une seule fois : en production, ce fondu ne serait pas envoyé. Une page qui écrit une transition ne reçoit aucun avertissement, et son fondu marche.
// Vrai clavier, vrai navigateur (Chromium), build de développement.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function navigateurPresent(): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright.chromium.executablePath())
  } catch {
    return false
  }
}

const STYLE = `<style>
  :host
    display: block
  .cols
    display: flex
    gap: 60px
  .la
    width: 220px
  .lb
    width: 220px
  .ligne
    box-sizing: border-box
    height: 40px
    margin-bottom: 6px
    padding: 0 10px
    border: 1px solid #999
    background: #fff
    line-height: 38px
</style>`

// une sortie de 300 ms posée par un script sur chaque ligne, sans qu'aucune page ne l'écrive
const PAR_SCRIPT = `<script>
  $a = [{ id: 1, titre: 'A1' }, { id: 2, titre: 'A2' }, { id: 3, titre: 'A3' }]
  $b = [{ id: 4, titre: 'B1' }, { id: 5, titre: 'B2' }]
  ids = (l)-> l.map((x)-> x.id).join(',')
  poser = (el)->
    el._mjs_outro = -> new Promise((r)-> setTimeout(r, 300))
    return
</script>
<div class="cols">
  <@@sortable class="la" value=!{$a} group="g">
    {for et in $a by id}
      <div class="ligne" data-id={et.id} @attach.once={poser(_node)}>{et.titre}</div>
    {end}
  </@@sortable>
  <@@sortable class="lb" value=!{$b} group="g">
    {for et in $b by id}
      <div class="ligne" data-id={et.id} @attach.once={poser(_node)}>{et.titre}</div>
    {end}
  </@@sortable>
</div>
<p class="ordre">{ids($a)}|{ids($b)}</p>
${STYLE}
`

// la même page, la transition écrite par la page
const PAR_PAGE = `<script>
  $a = [{ id: 1, titre: 'A1' }, { id: 2, titre: 'A2' }, { id: 3, titre: 'A3' }]
  $b = [{ id: 4, titre: 'B1' }, { id: 5, titre: 'B2' }]
  ids = (l)-> l.map((x)-> x.id).join(',')
</script>
<div class="cols">
  <@@sortable class="la" value=!{$a} group="g">
    {for et in $a by id}
      <div class="ligne" data-id={et.id} @transition=*crossfade(key: et.id)>{et.titre}</div>
    {end}
  </@@sortable>
  <@@sortable class="lb" value=!{$b} group="g">
    {for et in $b by id}
      <div class="ligne" data-id={et.id} @transition=*crossfade(key: et.id)>{et.titre}</div>
    {end}
  </@@sortable>
</div>
<p class="ordre">{ids($a)}|{ids($b)}</p>
${STYLE}
`

async function construire(nom: string, source: string): Promise<{ root: string, script: string }> {
  const root   = mjsTmp(`sortable-fondu-avis-${nom}`)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'pa-page.mjs'), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  return { root, script: [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;\n' + libellesDuManifeste(join(root, 'bundle.js')) }
}

const TAG = 'mjs-pa-page'

describe('<@@sortable> en développement — l\'avertissement du fondu des lignes (Chromium réel)', function () {
  this.timeout(240000)
  let present = false
  let browser: any = null
  let parScript = { root: '', script: '' }
  let parPage   = { root: '', script: '' }

  before(async function () {
    present = await navigateurPresent()
    if (!present) {
      console.log('  ℹ️  chromium non installé, test de l\'avertissement du fondu sauté')
      return
    }
    parScript = await construire('script', PAR_SCRIPT)
    parPage   = await construire('page', PAR_PAGE)
    browser   = await (await import('playwright')).chromium.launch()
  })

  after(async () => {
    await browser?.close()
    await terminateSharedWorkerPool()
  })

  async function essai(build: { script: string }, fn: (page: any, avis: string[]) => Promise<void>) {
    const context = await browser.newContext({ viewport: { width: 800, height: 600 } })
    try {
      const page = await context.newPage()
      page.setDefaultTimeout(5000)
      const erreurs: string[] = []
      const avis: string[] = []
      page.on('pageerror', (e: any) => erreurs.push(String(e)))
      page.on('console', (m: any) => { if (m.type() === 'warning') avis.push(m.text()) })
      await page.route('http://t.test/**', (route: any) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body style="margin:0"><${TAG}></${TAG}><script>${build.script}</script></body></html>` }))
      await page.goto('http://t.test/', { waitUntil: 'load' })
      await page.waitForFunction((t: string) => { const ls = (document.querySelector(t) as any)?._shadow?.querySelectorAll('mjs-core-sortable'); return !!ls && ls.length >= 2 && [...ls].every((l: any) => l._shadow?.querySelector('slot')) }, TAG)
      await page.waitForTimeout(250)
      await fn(page, avis)
      assert.deepEqual(erreurs, [], 'aucune erreur de page')
    } finally {
      await context.close()
    }
  }

  const focaliser = (page: any, q: string) => page.evaluate(([t, s]: string[]) => (document.querySelector(t) as any)._shadow.querySelector(s).focus(), [TAG, q])
  const touche    = async (page: any, ...ts: string[]) => { for (const k of ts) { await page.keyboard.press(k); await page.waitForTimeout(200) } }
  const ordre     = (page: any) => page.evaluate((t: string) => (document.querySelector(t) as any)._shadow.querySelector('p.ordre').textContent as string, TAG)
  const duFondu   = (avis: string[]) => avis.filter((a) => a.includes('une ligne quitte sa liste avec une transition'))

  it('aucune page n\'écrit de transition et une ligne sort avec une sortie posée par un script : un avertissement, une seule fois', async function () {
    if (!present) return this.skip()
    await essai(parScript, async (page, avis) => {
      assert.deepEqual(duFondu(avis), [], 'rien tant qu\'aucune ligne ne quitte sa liste')
      await focaliser(page, '.ligne[data-id="1"]')
      await touche(page, ' ', 'ArrowRight', ' ')
      await page.waitForTimeout(900)
      assert.match(await ordre(page), /^2,3\|.*\b1\b/, 'la ligne a changé de liste')
      assert.equal(duFondu(avis).length, 1, avis.join(' | '))
      assert.match(duFondu(avis)[0], /^\[ModularJS\] <@@sortable> : une ligne quitte sa liste avec une transition, mais aucune page de l'application n'écrit de transition/)
      assert.match(duFondu(avis)[0], /Écrivez/)
      await focaliser(page, '.lb .ligne[data-id="1"]')
      await touche(page, ' ', 'ArrowLeft', ' ')
      await page.waitForTimeout(900)
      assert.match(await ordre(page), /^[\d,]*\b1\b[\d,]*\|/, 'la ligne est repartie')
      assert.equal(duFondu(avis).length, 1, 'une seule fois, même pour un second déplacement')
    })
  })

  it('la page écrit la transition : le fondu marche, aucun avertissement', async function () {
    if (!present) return this.skip()
    await essai(parPage, async (page, avis) => {
      await focaliser(page, '.ligne[data-id="1"]')
      await touche(page, ' ', 'ArrowRight', ' ')
      await page.waitForTimeout(900)
      assert.match(await ordre(page), /^2,3\|.*\b1\b/, 'la ligne a changé de liste')
      assert.deepEqual(duFondu(avis), [], avis.join(' | '))
      assert.deepEqual(avis.filter((a) => a.includes('aucune page de l\'application')), [])
    })
  })
})
