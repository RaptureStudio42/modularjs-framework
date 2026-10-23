// <@@select aria-labelledby> : les deux gardes qui évitent de refaire la mise en place des guets doivent laisser
// passer ce qui a vraiment changé. (1) la racine guettée en profondeur tant qu'une étiquette manque, puis, l'étiquette
// arrivée directement sous cette racine, guettée sur ses seuls enfants : même liste de cibles, autre mode.
// (2) une étiquette retirée de `aria-labelledby` : la liste des cibles raccourcit, ses premiers éléments restent les
// mêmes, et le parent de l'étiquette retirée ne doit plus être guetté.
// Chromium et Firefox réels.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const PAGES = {
  seule: `<@@select id="tard" name="t" aria-labelledby="e1"><@@option value="x">X</@@option></@@select>
`,
  deux: `<@@select id="tard" name="t" aria-labelledby="la lb"><@@option value="x">X</@@option></@@select>
<div id="grand"><section id="p1"><span id="la">A</span></section><section id="p2"><span id="lb">B</span></section></div>
`
}

const compiles: Record<string, Promise<string>> = {}

// le script de la page (cœur, modules, hôte), compilé une fois par page pour les deux navigateurs
function script(cle: keyof typeof PAGES): Promise<string> {
  compiles[cle] ??= (async () => {
    const root   = mjsTmp(`select-guets-garde-${cle}`)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), PAGES[cle])
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const ordre = [...files.filter((f) => f.startsWith('mjs_core')), ...files.filter((f) => f.startsWith('mjs_') && !f.startsWith('mjs_core')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
    return ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })()
  return compiles[cle]
}

for (const nom of ['chromium', 'firefox'] as const) describe(`<@@select aria-labelledby> : gardes de la mise en place des guets (${nom} réel)`, function () {
  this.timeout(180000)
  let present = false
  let browser: any
  let page: any

  // ouvre la page, attend le bouton de la liste, puis journalise chaque `observe` (cible, sous-arbre ou non)
  const ouvre = async (cle: keyof typeof PAGES) => {
    const playwright = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) return
    const code = await script(cle)
    browser = await playwright[nom].launch()
    page    = await browser.newPage({ viewport: { width: 900, height: 700 } })
    await page.addInitScript('window.__name = (f) => f')
    await page.setContent(`<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-hote></mjs-hote><script>${code}</script></body></html>`, { waitUntil: 'load' })
    await page.waitForFunction(() => !!(document.querySelector('mjs-hote') as any)?._shadow?.querySelector('#tard')?._shadow?.querySelector('.select-btn'))
    await page.waitForTimeout(500)
    await page.evaluate(`(() => { const O = MutationObserver.prototype.observe; window.__obs = []; MutationObserver.prototype.observe = function (n, o) { window.__obs.push((n.id || (n.nodeType === 11 ? 'racine' : n.nodeName)) + (o && o.subtree ? ' (sous-arbre)' : '')); return O.call(this, n, o) } })()`)
  }

  const etiquettes = async () => JSON.parse(await page.evaluate(`JSON.stringify((document.querySelector('mjs-hote')._shadow.querySelector('#tard')._shadow.querySelector('.select-btn').ariaLabelledByElements || []).map((e) => e.id))`))

  afterEach(async () => {
    if (browser) await browser.close()
    browser = null
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('l\'étiquette arrive sous la racine guettée en profondeur : la racine n\'est plus guettée que sur ses enfants', async function () {
    try { await ouvre('seule') }
    catch (e) { present = false; throw e }
    if (!present) { this.skip(); return }
    await page.evaluate(`(() => { const s = document.createElement('span'); s.id = 'e1'; document.querySelector('mjs-hote')._shadow.appendChild(s) })()`)
    await page.waitForTimeout(300)
    assert.deepEqual(await etiquettes(), ['e1'], 'l\'étiquette est trouvée')
    const obs = await page.evaluate('window.__obs')
    assert.ok(obs.includes('racine'), `la racine est observée de nouveau, sans sous-arbre : ${JSON.stringify(obs)}`)
  })

  it('une étiquette retirée de la liste : la liste des guets raccourcie est refaite, son parent n\'est plus guetté', async function () {
    try { await ouvre('deux') }
    catch (e) { present = false; throw e }
    if (!present) { this.skip(); return }
    assert.deepEqual(await etiquettes(), ['la', 'lb'], 'au départ')
    await page.evaluate(`(() => { const r = document.querySelector('mjs-hote')._shadow; r.querySelector('#tard').setAttribute('aria-labelledby', 'la') })()`)
    await page.waitForTimeout(300)
    assert.deepEqual(await etiquettes(), ['la'], 'seule l\'étiquette citée reste')
    const obs = await page.evaluate('window.__obs')
    assert.deepEqual([...new Set(obs)], ['p1', 'grand', 'racine'], 'les guets sont refaits sur les seuls parents restants')
  })
})
