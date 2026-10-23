// Accessibilité de quatre effets, lue dans l'arbre d'accessibilité de Chromium (CDP), pas à l'œil :
// *flipcard ne se dit pas bouton : sa commande « Retourner la carte » l'est, pressée ou non (`aria-pressed`), et le contenu de la
// carte reste lisible hors de tout bouton (le titre du recto, le lien du verso) ; un rôle écrit par l'auteur est gardé. *cycle fait entendre tous ses mots, une seule fois.
// *loader annonce « Chargement » par le CONTENU de sa région `status` (une région vivante dit ce qui change en elle, pas son
// nom), écrit une image après la pose de la région ; un libellé de l'auteur est dit à sa place. *skeleton dit que le contenu
// est en route (`aria-busy`) le temps de ses barres. Au retrait, chaque balise retrouve ses attributs.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
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

// le sous-arbre d'accessibilité d'une balise, en une ligne : rôle "nom" [propriétés] {enfants} ; les nœuds ignorés sont traversés
async function arbre(cdp: any, sel: string): Promise<string> {
  const { result } = await cdp.send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(sel)})` })
  const { node } = await cdp.send('DOM.describeNode', { objectId: result.objectId })
  const { nodes } = await cdp.send('Accessibility.getFullAXTree')
  const parId = new Map(nodes.map((n: any) => [n.nodeId, n]))
  const racine = nodes.find((n: any) => n.backendDOMNodeId === node.backendNodeId)
  const ligne = (n: any): string[] => {
    if (!n || n.role?.value === 'InlineTextBox') return []
    const enfants = (n.childIds || []).flatMap((id: string) => ligne(parId.get(id)))
    if (n.ignored) return enfants
    const props = (n.properties || []).filter((p: any) => ['pressed', 'busy', 'live'].includes(p.name)).map((p: any) => p.name + '=' + p.value.value).join(',')
    return [`${n.role?.value}${n.name?.value ? ' "' + n.name.value + '"' : ''}${props ? ' [' + props + ']' : ''}` + (enfants.length ? ' {' + enfants.join(' | ') + '}' : '')]
  }
  return racine ? ligne(racine).join(' | ') : 'absent'
}

const CARTE = (id: string, attr = '') => `<div id="${id}" ${attr} style="width:300px;height:90px"><div><h3>Titre recto</h3></div><div><p>Verso <a href="#x">en savoir plus</a></p></div></div>`
const PAGE  = CARTE('fc') + CARTE('fh') + CARTE('fg', 'role="group" aria-label="Offre"') + CARTE('fv')
  + '<p id="pc">Nous créons des <span id="cy">sites</span></p><span id="ld"></span><span id="ld2" aria-label="Envoi du panier"></span><div id="sk" style="width:200px"></div>'

describe('effets — accessibilité lue dans l\'arbre de Chromium (*flipcard, *cycle, *loader, *skeleton)', function () {
  this.timeout(240000)
  let present = false
  let script  = ''
  let browser: any = null
  let ctx: any = null
  let page: any = null
  let cdp: any = null

  before(async function () {
    present = await chromiumPresent()
    if (!present) {
      console.log('  ℹ️  chromium non installé, test sauté. Activer : `npx playwright install chromium`')
      return
    }
    const root   = mjsTmp('effets-accessibilite-carte-chargement')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fx-banc.mjs'), '<div *flipcard(on: click)><div>r</div><div>v</div></div>\n<span *cycle([b, c])>a</span>\n<span *loader></span>\n<div *skeleton></div>\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    const libelles = /µ\._runtimeLabels = (\{[\s\S]*?\});\n/.exec(readFileSync(join(root, 'bundle.js'), 'utf-8'))
    if (libelles) script += ` µ._runtimeLabels = ${libelles[1]};`
    const playwright = await import('playwright')
    browser = await playwright.chromium.launch({ args: ['--no-proxy-server'] })
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  beforeEach(async function () {
    if (!present) return this.skip()
    ctx  = await browser.newContext({ viewport: { width: 900, height: 900 } })
    page = await ctx.newPage()
    await page.route('http://t.test/**', (route: any) => {
      if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${PAGE}<script>${script}</script></body></html>` })
    })
    await page.goto('http://t.test/', { waitUntil: 'load' })
    cdp = await ctx.newCDPSession(page)
    await cdp.send('Accessibility.enable')
  })

  afterEach(async () => {
    if (ctx) await ctx.close()
    ctx = null
  })

  it('*flipcard au clavier : sa commande est le bouton, `aria-pressed` suit la face ; titre et lien lisibles hors d\'un bouton ; rôle écrit gardé ; rendu au retrait', async () => {
    await page.evaluate(() => {
      const µ = (window as any).µ
      const w = window as any
      w.offC = µ._mjs_fx(null, document.getElementById('fc'), 'flipcard', { on: 'click', duration: '0s' })
      µ._mjs_fx(null, document.getElementById('fh'), 'flipcard', { on: 'hover', duration: '0s' })
      µ._mjs_fx(null, document.getElementById('fg'), 'flipcard', { on: 'click', duration: '0s' })
      µ._mjs_fx(null, document.getElementById('fv'), 'flipcard', { on: 'view', duration: '0s' })
    })
    await page.waitForTimeout(300)
    const recto = await arbre(cdp, '#fc')
    assert.doesNotMatch(recto, /^button/, recto)
    assert.match(recto, /button "Retourner la carte" \[pressed=false\]/, recto)
    assert.match(recto, /heading "Titre recto"/, recto)
    const survol = await arbre(cdp, '#fh')
    assert.doesNotMatch(survol, /^button/, survol)
    assert.match(survol, /button "Retourner la carte" \[pressed=false\]/, survol)
    await page.focus('#fc > [mjs-fx-flipcard-turn]')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(200)
    const verso = await arbre(cdp, '#fc')
    assert.doesNotMatch(verso, /^button/, verso)
    assert.match(verso, /button "Retourner la carte" \[pressed=true\]/, verso)
    assert.match(verso, /paragraph \{StaticText "Verso " \| link "en savoir plus"/, verso)
    const ecrit = await page.evaluate(() => { const g = document.getElementById('fg')!; return [g.getAttribute('role'), g.getAttribute('aria-pressed')] })
    assert.deepEqual(ecrit, ['group', null], 'un rôle écrit par l\'auteur est gardé, sans état de bouton')
    const vue = await page.evaluate(() => { const v = document.getElementById('fv')!; return [v.getAttribute('role'), v.getAttribute('aria-pressed'), v.getAttribute('tabindex')] })
    assert.deepEqual(vue, [null, null, null], '`on: view` : la carte ne s\'atteint pas au clavier, aucun rôle')
    const rendu = await page.evaluate(() => { (window as any).offC(); const c = document.getElementById('fc')!; return [c.getAttribute('role'), c.getAttribute('aria-pressed'), c.querySelector('[mjs-fx-flipcard-turn]') ? 'commande' : null] })
    assert.deepEqual(rendu, [null, null, null])
  })

  it('*cycle : tous les mots, une seule fois (le calque animé reste muet)', async () => {
    await page.evaluate(() => { (window as any).µ._mjs_fx(null, document.getElementById('cy'), 'cycle', { words: ['applis', 'logos'] }) })
    await page.waitForTimeout(300)
    const lu = await arbre(cdp, '#pc')
    assert.match(lu, /StaticText "Nous créons des " \| generic \{StaticText "sites" \| StaticText ", applis, logos"\}/, lu)
    assert.equal(lu.split('applis').length - 1, 1, lu)
  })

  it('*loader : la région `status` reçoit son texte une image après sa pose ; le libellé de l\'auteur est dit ; rendu au retrait', async () => {
    const aLaPose = await page.evaluate(() => {
      const µ = (window as any).µ
      const w = window as any
      w.offL = µ._mjs_fx(null, document.getElementById('ld'), 'loader', {})
      µ._mjs_fx(null, document.getElementById('ld2'), 'loader', {})
      const l = document.getElementById('ld')!
      return [l.getAttribute('role'), (l.textContent || '').trim()]
    })
    assert.deepEqual(aLaPose, ['status', ''], 'la région est posée vide : son texte arrive ensuite, et se dit')
    await page.waitForTimeout(300)
    const lu = await arbre(cdp, '#ld')
    assert.match(lu, /^status \[live=polite\] \{StaticText "Chargement"\}$/, lu)
    const lu2 = await arbre(cdp, '#ld2')
    assert.match(lu2, /^status "Envoi du panier" \[live=polite\] \{StaticText "Envoi du panier"\}$/, lu2)
    const rendu = await page.evaluate(() => { (window as any).offL(); const l = document.getElementById('ld')!; return [l.getAttribute('role'), l.getAttribute('aria-label'), l.innerHTML] })
    assert.deepEqual(rendu, [null, null, ''])
  })

  it('*skeleton : `aria-busy` le temps des barres, retiré avec elles', async () => {
    await page.evaluate(() => { (window as any).offS = (window as any).µ._mjs_fx(null, document.getElementById('sk'), 'skeleton', {}) })
    await page.waitForTimeout(200)
    const lu = await arbre(cdp, '#sk')
    assert.match(lu, /^generic \[busy=(?:true|1)\]$/, lu)
    const rendu = await page.evaluate(() => { (window as any).offS(); const s = document.getElementById('sk')!; return [s.getAttribute('aria-busy'), s.innerHTML] })
    assert.deepEqual(rendu, [null, ''])
  })
})
