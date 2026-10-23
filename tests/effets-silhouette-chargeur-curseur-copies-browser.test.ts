// Quatre effets lus dans Chromium :
// - *skeleton dit que le contenu est en route (`aria-busy`) aussi sur la balise d'un composant dont le code arrive (sa silhouette
//   posée par µ._mjs_skelShow) et autour de la zone d'un `{await … *skeleton}` ; retiré quand la silhouette part ;
// - *loader posé sur un bouton lui laisse son rôle de bouton (avant : `role="status"` l'écrasait) ; le chargement se dit par une
//   région à lui, dans son dessin ;
// - *pointer(hide) d'une zone dans une boîte de dialogue modale cache le curseur sur ses liens, même quand <@document> porte aussi
//   `*pointer(hide)` (avant : la boîte, couche du dessus de la page, le rendait) ; un lien de la boîte hors de la zone le garde ;
// - les copies de *marquee perdent les gestionnaires en ligne du SVG (`onbegin`, `onend`, `onrepeat` d'une animation), comme
//   `onclick` : la copie ne relance pas le code de l'auteur.

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
    const props = (n.properties || []).filter((p: any) => ['busy', 'live'].includes(p.name)).map((p: any) => p.name + '=' + p.value.value).join(',')
    return [`${n.role?.value}${n.name?.value ? ' "' + n.name.value + '"' : ''}${props ? ' [' + props + ']' : ''}` + (enfants.length ? ' {' + enfants.join(' | ') + '}' : '')]
  }
  return racine ? ligne(racine).join(' | ') : 'absent'
}

const ATTENTE = '<script lang="coffee">\n$p = new Promise (resolve) -> window.finAttente = resolve\n</script>\n<div class="wrap">\n{await $p *skeleton}\n{success v}\n  <p class="ok">{v}</p>\n{end}\n</div>\n'

const PAGE = '<button id="bt">Envoyer</button><button id="bt2" aria-label="Envoyer le panier">→</button>'
  + '<dialog id="dl"><div id="z"><a id="lz" href="#x">dans la zone</a></div><a id="lh" href="#y">hors de la zone</a></dialog>'
  + '<div id="mq" style="width:400px"><span>Logo <svg width="10" height="10"><rect width="10" height="10"><animate onbegin="window.nb = (window.nb || 0) + 1" onend="void 0" onrepeat="void 0" attributeName="x" from="0" to="1" dur="1s"></animate></rect></svg> <b onclick="void 0" online="oui">fin</b></span></div>'

describe('effets — silhouette, chargeur sur un bouton, curseur caché dans une boîte, copies sans gestionnaire SVG (Chromium)', function () {
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
    const root   = mjsTmp('effets-silhouette-chargeur-curseur-copies')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fx-vq-banc.mjs'), '<span *loader></span>\n<div *skeleton></div>\n<div *pointer(hide: true)></div>\n<div *marquee>x</div>\n')
    writeFileSync(join(srcDir, 'fx-vq-attente.mjs'), ATTENTE)
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

  it('*skeleton sur la balise d\'un composant dont le code arrive : `aria-busy` le temps de la silhouette', async () => {
    const vu = await page.evaluate(() => {
      const µ = (window as any).µ
      µ._skels = Object.assign(µ._skels || {}, { 'vq-arrive': '<i mjs-skel="m"></i>', 'vq-ecrit': '<i mjs-skel="s"></i>' })
      const a = document.createElement('mjs-vq-arrive')
      const b = document.createElement('mjs-vq-ecrit')
      b.setAttribute('aria-busy', 'false')
      document.body.append(a, b)
      const offA = µ._mjs_fx(null, a, 'skeleton', {})
      µ._mjs_fx(null, b, 'skeleton', {})
      const pose = [a.getAttribute('aria-busy'), !!a.querySelector('[mjs-skel-zone]'), b.getAttribute('aria-busy')]
      offA()
      const retire = [a.getAttribute('aria-busy'), !!a.querySelector('[mjs-skel-zone]')]
      // le code du composant arrive : µ._def retire la silhouette (µ._mjs_skelOff)
      const c = document.createElement('mjs-vq-arrive')
      document.body.append(c)
      µ._mjs_fx(null, c, 'skeleton', {})
      const avant = c.getAttribute('aria-busy')
      µ._mjs_skelOff('mjs-vq-arrive')
      µ._mjs_skelOff('mjs-vq-ecrit')
      return { pose, retire, avant, arrive: c.getAttribute('aria-busy'), ecrit: b.getAttribute('aria-busy') }
    })
    assert.deepEqual(vu, { pose: ['true', true, 'false'], retire: [null, false], avant: 'true', arrive: null, ecrit: 'false' })
  })

  it('*skeleton d\'un `{await}` : la balise autour de la zone est occupée (`aria-busy`) jusqu\'au contenu', async () => {
    await page.evaluate(() => { document.body.append(document.createElement('mjs-fx-vq-attente')) })
    await page.waitForFunction(() => !!(document.querySelector('mjs-fx-vq-attente') as any)?._shadow?.querySelector('[mjs-skel-zone]'))
    const pendant = await page.evaluate(() => (document.querySelector('mjs-fx-vq-attente') as any)._shadow.querySelector('.wrap').getAttribute('aria-busy'))
    assert.equal(pendant, 'true', 'la zone d\'attente : la balise qui la contient est occupée')
    await page.evaluate(() => (window as any).finAttente('arrivé'))
    await page.waitForFunction(() => !!(document.querySelector('mjs-fx-vq-attente') as any)._shadow.querySelector('.ok'))
    await page.waitForTimeout(100)
    const apres = await page.evaluate(() => { const w = (document.querySelector('mjs-fx-vq-attente') as any)._shadow.querySelector('.wrap'); return [w.getAttribute('aria-busy'), !!w.querySelector('[mjs-skel-zone]')] })
    assert.deepEqual(apres, [null, false], 'le contenu arrivé, plus rien d\'occupé')
  })

  it('*loader sur un bouton : il reste un bouton, le chargement se dit par une région du dessin ; rendu au retrait', async () => {
    const aLaPose = await page.evaluate(() => {
      const µ = (window as any).µ
      const w = window as any
      w.offB = µ._mjs_fx(null, document.getElementById('bt'), 'loader', {})
      µ._mjs_fx(null, document.getElementById('bt2'), 'loader', {})
      return [document.getElementById('bt')!.getAttribute('role'), document.getElementById('bt2')!.getAttribute('role')]
    })
    assert.deepEqual(aLaPose, [null, null], 'aucun rôle posé sur un bouton')
    await page.waitForTimeout(300)
    const lu = await arbre(cdp, '#bt')
    assert.match(lu, /^button "Envoyer/, lu)
    assert.match(lu, /status \[live=polite\] \{StaticText "Chargement"\}/, lu)
    const lu2 = await arbre(cdp, '#bt2')
    assert.match(lu2, /^button "Envoyer le panier"/, lu2)
    assert.match(lu2, /status \[live=polite\] \{StaticText "Chargement"\}/, 'le libellé du bouton reste son nom, pas le texte du chargement : ' + lu2)
    const rendu = await page.evaluate(() => { (window as any).offB(); const b = document.getElementById('bt')!; return [b.getAttribute('role'), b.innerHTML] })
    assert.deepEqual(rendu, [null, 'Envoyer'])
  })

  it('*pointer(hide) d\'une zone dans une boîte modale, avec <@document *pointer(hide)> : curseur caché sur les liens de la zone', async () => {
    const vu = await page.evaluate(() => {
      const µ = (window as any).µ
      const dl = document.getElementById('dl') as HTMLDialogElement
      dl.showModal()
      µ._mjs_fx(null, document.documentElement, 'pointer', { hide: true })
      µ._mjs_fx(null, document.getElementById('z'), 'pointer', { hide: true })
      const c = (id: string) => getComputedStyle(document.getElementById(id)!).cursor
      return { zone: c('z'), lienZone: c('lz'), lienHors: c('lh') }
    })
    assert.deepEqual(vu, { zone: 'none', lienZone: 'none', lienHors: 'pointer' })
  })

  it('*marquee : les copies perdent `onbegin`, `onend`, `onrepeat` (SVG) comme `onclick` ; `online` reste', async () => {
    const vu = await page.evaluate(async () => {
      const µ = (window as any).µ
      µ._mjs_fx(null, document.getElementById('mq'), 'marquee', {})
      await new Promise((r) => setTimeout(r, 300))
      const copies = Array.from(document.querySelectorAll('#mq [mjs-fx-marquee-copy]'))
      const attrs = (sel: string) => copies.flatMap((c) => Array.from(c.querySelectorAll(sel)).flatMap((e) => e.getAttributeNames()))
      return { copies: copies.length > 0, anim: [...new Set(attrs('animate'))].sort(), b: [...new Set(attrs('b'))].sort(), original: document.querySelector('#mq animate')!.hasAttribute('onbegin') }
    })
    // la copie est inerte : ses balises gardent les attributs de l'original, sans gestionnaire en ligne
    assert.deepEqual(vu, { copies: true, anim: ['attributeName', 'dur', 'from', 'to'], b: ['online'], original: true })
  })
})
