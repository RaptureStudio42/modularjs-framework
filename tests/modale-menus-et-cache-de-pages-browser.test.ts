// µ.modal, les menus de MJS et le cache de pages, Chromium, Firefox et WebKit réels, construction de développement et de production :
// - une liste de <@@select>, une bulle `@title` et un menu de <@@chart> ouverts dans la page (la couche du dessus du navigateur, devant
//   tout `z-index`) se ferment à l'ouverture ; la modale fermée, le focus revient à leur bouton ; dans la modale, la liste d'un
//   <@@select> s'ouvre et se choisit, la bulle d'un `mjs-title` se voit ; Échap ferme d'abord le menu de MJS ouvert (le menu d'un
//   <@@chart>), son focus rendu à son bouton, la modale restant ouverte ; une bulle visible ne la retient pas ;
// - une navigation qui part la modale ouverte, puis Précédent : la page revient avec son toast, sans calque ;
// - la page derrière la modale reste telle quelle, comme sans modale : ce qui s'affiche devant le calque (un popover dans un en-tête
//   collant, un `<dialog>` ou un popover ouverts pendant la modale, un bandeau montré pendant ou déjà là, un élément flex au très haut
//   `z-index` sans `position`) reçoit le clic sans fermer la modale ni perdre la saisie, et rien n'y devient inerte.
// Les couleurs du fond (bleu) et de la bulle (rouge) sont lues sur l'écran : une capture d'un pixel. La construction est servie
// comme en vrai (le manifeste chargé en module) ; en production, `µ` n'est pas sur `window` : la scène l'y pose pour le test

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
import { inflateSync } from 'node:zlib'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const MOTEURS = ['chromium', 'firefox', 'webkit'] as const
const MODES   = ['dev', 'prod'] as const

const CINQ = ['Un', 'Deux', 'Trois', 'Quatre', 'Cinq'].map((t, i) => `<@@option value="${i + 1}">${t}</@@option>`).join('')

// tout à gauche de la fenêtre : la boîte de la modale, centrée, n'en couvre rien
const SCENE = `<script>
  window.__mu = µ
  $rows   = [{ id: 'a', x: '2026-09-01', poids: 72 }, { id: 'b', x: '2026-09-03', poids: 73 }, { id: 'c', x: '2026-09-05', poids: 71 }]
  $series = [{ key: 'poids', name: 'Poids', unit: 'kg' }]
</script>

<button id="dehors" type="button">dehors</button>
<input id="champ" type="text" aria-label="Champ">
<@@select class="s-page" aria-label="Liste de la page">${CINQ}</@@select>
<button class="t-page" type="button" :title="Bulle de la page">T</button>
<@@chart class="c-page" rows={$rows} series={$series} toolbar="shapes"></@@chart>

<style>
  :host
    display: block

  #dehors, #champ, .s-page, .t-page, .c-page
    position: absolute
    left: 10px

  #dehors
    top: 10px

  #champ
    top: 50px

  .s-page
    top: 90px
    width: 160px

  .t-page
    top: 380px

  .c-page
    top: 470px
    width: 260px
</style>
`

// le contenu de la modale : une liste et une bulle, en HTML brut ; la place laissée sous la liste la garde dans la boîte
const DANS = '<mjs-core-select class="s-mod" aria-label="Liste de la modale"><mjs-core-option value="1">Un</mjs-core-option><mjs-core-option value="2">Deux</mjs-core-option><mjs-core-option value="3">Trois</mjs-core-option></mjs-core-select> <button class="t-mod" type="button" mjs-title="Bulle de la modale">?</button><div class="place"></div>'

const OUTILS = `
window.__o = (el) => el._shadow || el.shadowRoot
window.__h = () => __o(document.querySelector('mjs-scene'))
window.__q = (sel) => __h().querySelector(sel)
window.__c = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width } }
window.__actif = () => { let a = document.activeElement; while (a && __o(a) && __o(a) !== a && __o(a).activeElement) a = __o(a).activeElement; return a }
window.__nom = (a) => !a ? 'null' : a.id ? '#' + a.id : a === document.body ? 'body' : (typeof a.className === 'string' && a.className ? '.' + a.className.trim().split(/\\s+/).pop() : a.nodeName.toLowerCase())
window.__fond = () => document.querySelector('.mjs-modal-backdrop')
window.__bulle = (racine) => [...racine.querySelectorAll('.mjs-title')].find((b) => b.classList.contains('mjs-title-visible')) || null
window.__images = () => new Promise((f) => requestAnimationFrame(() => requestAnimationFrame(f)))
window.__dort = (ms) => new Promise((f) => setTimeout(f, ms))
window.__inertes = () => [...document.querySelectorAll('[inert]')].map((e) => __nom(e)).join(',')
window.__charges = 0
document.addEventListener('mjs:load', () => { window.__charges++ })
`

const BLEU  = '0,0,255'
const ROUGE = '255,0,0'

const construits = new Map<string, Promise<string>>()

// une construction par mode, partagée par les trois moteurs : le dossier de sortie, servi sous /out
function construire(mode: string): Promise<string> {
  if (!construits.has(mode)) {
    construits.set(mode, (async () => {
      const root   = mjsTmp('modale-menus-' + mode)
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'scene.mjs'), SCENE)
      // le test appelle µ.modal depuis son propre code, hors des sources compilées : 'all' rend le cœur complet
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', runtime: 'all', env: mode } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      return outDir
    })())
  }
  return construits.get(mode)!
}

const TYPES: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json' }

// la couleur d'un pixel de l'écran, lue sur une capture PNG d'un pixel (pour une seule ligne, chaque filtre rend l'octet brut)
async function pixel(page: any, x: number, y: number): Promise<string> {
  const buf: Buffer = await page.screenshot({ clip: { x: Math.round(x), y: Math.round(y), width: 1, height: 1 } })
  const idat: Buffer[] = []
  for (let o = 8; o < buf.length;) {
    const n = buf.readUInt32BE(o)
    if (buf.toString('ascii', o + 4, o + 8) === 'IDAT') idat.push(buf.subarray(o + 8, o + 8 + n))
    o += 12 + n
  }
  const brut = inflateSync(Buffer.concat(idat))
  return [brut[1], brut[2], brut[3]].join(',')
}

// la tête des pages servies : le cœur construit, les couleurs lues sur l'écran, ce qui s'affiche devant le calque (tout à gauche ou
// en bas à droite : la boîte de la modale, centrée, n'en couvre rien)
const TETE = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><script type="module" src="/out/bundle.js"></script><style>html,body{margin:0}:root{--mjs-modal-backdrop:rgb(0,0,255);--mjs-title-bg:rgb(255,0,0)}#t-corps{position:absolute;left:10px;top:640px}#ailleurs{position:absolute;left:300px;top:10px}#jetable{position:absolute;left:300px;top:60px}.loin{height:3000px}.place{height:160px}#entete{position:sticky;top:0;z-index:10;height:40px}#pn{position:fixed;inset:auto;left:20px;top:60px;width:200px;height:100px;margin:0}#po{position:fixed;inset:auto;left:10px;top:10px;width:200px;height:80px;margin:0}.bandeau{position:fixed;right:0;bottom:0;width:300px;height:80px;z-index:2147483647;background:rgb(255,0,0)}.bandeau button{margin:20px}#cookies{display:none}#cookies.vu{display:block}#fx{display:flex}#fzi{z-index:2147483647;width:200px;height:60px}</style></head>`

const PAGE = `${TETE}<body><mjs-scene></mjs-scene><button id="t-corps" type="button" mjs-title="Bulle du corps">C</button><div id="ailleurs" inert><button id="ferme" type="button">fermé</button></div><input id="jetable" type="search" value="abc" aria-label="jetable"><div class="loin"></div></body></html>`

for (const nom of MOTEURS) for (const mode of MODES) describe(`µ.modal, les menus de MJS et le cache de pages (${nom} réel, construction ${mode})`, function () {
  this.timeout(240000)
  let present = false
  let browser: any
  let sortie = ''
  let page: any
  let erreurs: string[] = []

  const lire  = (corps: string) => page.evaluate(`(async () => { ${corps} })()`)
  const pret  = (expr: string) => page.waitForFunction(`(() => { return ${expr} })()`, null, { timeout: 10000 })
  // l'élément amené en vue d'abord : chaque cas ne dépend que de ce qu'il vérifie
  const clic  = async (expr: string) => {
    const c = await lire(`const el = (${expr}); el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]`)
    await page.mouse.click(c[0], c[1])
  }
  // la modale ouverte, son fondu fini
  const poser = async (opts: string) => {
    await lire(`window.__r = undefined; µ.modal.fire(${opts}).then((r) => { window.__r = r }); await __images()`)
    await page.waitForTimeout(250)
  }

  before(async () => {
    const playwright: any = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) return
    sortie  = await construire(mode)
    browser = await playwright[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
  })

  beforeEach(async function () {
    if (!present) { this.skip(); return }
    erreurs = []
    page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
    await page.addInitScript(OUTILS)
    page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e).slice(0, 200)))
    await page.route('http://modale.test/**', (route: any) => {
      const chemin = new URL(route.request().url()).pathname
      if (!chemin.startsWith('/out/')) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE })
      const fichier = join(sortie, chemin.slice(5))
      if (!existsSync(fichier)) return route.fulfill({ status: 404, body: '' })
      return route.fulfill({ status: 200, contentType: TYPES[extname(fichier)] ?? 'application/octet-stream', body: readFileSync(fichier) })
    })
    await page.goto('http://modale.test/')
    await page.waitForFunction(`(() => { const h = document.querySelector('mjs-scene'); const r = h && __o(h); const c = r && r.querySelector('.c-page'); return !!window.__mu && !!customElements.get('mjs-core-select') && !!c && !!__o(c) && !!__o(c).querySelector('button.pick') })()`, null, { timeout: 15000 })
    await page.waitForTimeout(200)
    await page.evaluate(`window.µ = window.µ || window.__mu; µ.config.title = { delay: 30 }`)
  })

  afterEach(async function () {
    if (!present || !page) return
    await page.close()
    page = null
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page')
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('une liste de <@@select>, une bulle `@title` et un menu de <@@chart> ouverts dans la page se ferment à l\'ouverture ; la modale fermée, le focus revient à leur bouton', async function () {
    const b = await lire(`return __c(__o(__q('.s-page')).querySelector('.select-btn'))`)
    await page.mouse.click(b.x, b.y)
    await pret(`!!__o(__q('.s-page')).querySelector('.select-panel')`)
    await lire(`await __images()`)
    const l = await lire(`return __c(__o(__q('.s-page')).querySelector('.select-panel'))`)
    assert.notEqual(await pixel(page, l.x, l.y), BLEU, 'la liste se voit')
    await poser(`{ title: 'Fenêtre', text: 'Texte' }`)
    assert.deepEqual({ ouverte: await lire(`return !!__o(__q('.s-page')).querySelector('.select-panel')`), px: await pixel(page, l.x, l.y) }, { ouverte: false, px: BLEU }, 'la liste fermée, le fond à sa place')
    await page.keyboard.press('Escape')
    await pret(`!!window.__r && !__fond()`)
    assert.equal(await lire(`return __actif().classList.contains('select-btn')`), true, 'le focus revient au bouton de la liste')
    const t = await lire(`return __c(__q('.t-page'))`)
    await page.mouse.move(t.x, t.y)
    await pret(`!!__bulle(__h())`)
    await poser(`{ title: 'Fenêtre', text: 'Texte' }`)
    assert.equal(await lire(`return !!__bulle(__h())`), false, 'la bulle fermée')
    await page.keyboard.press('Escape')
    await pret(`!!window.__r && !__fond()`)
    await page.mouse.move(600, 20)
    const k = await lire(`return __c(__o(__q('.c-page')).querySelector('button.pick'))`)
    await page.mouse.click(k.x, k.y)
    await pret(`(() => { const m = __o(__q('.c-page')).querySelector('.menu'); return !!m && !m.classList.contains('wait') })()`)
    await lire(`await __images()`)
    const m = await lire(`return __c(__o(__q('.c-page')).querySelector('.menu'))`)
    assert.notEqual(await pixel(page, m.x, m.y), BLEU, 'le menu se voit')
    await poser(`{ title: 'Fenêtre', text: 'Texte' }`)
    const k2 = await lire(`return __c(document.querySelector('.mjs-modal-box'))`)
    assert.ok(m.x < k2.l || m.x > k2.r || m.y < k2.t || m.y > k2.b, `le milieu du menu est hors de la boîte : ${JSON.stringify({ m, boite: k2 })}`)
    assert.deepEqual({ ouvert: await lire(`return !!__o(__q('.c-page')).querySelector('.menu')`), px: await pixel(page, m.x, m.y) }, { ouvert: false, px: BLEU }, 'le menu fermé, le fond à sa place')
    await page.keyboard.press('Escape')
    await pret(`!!window.__r && !__fond()`)
    assert.equal(await lire(`return __nom(__actif())`), '.pick', 'le focus revient au bouton du menu')
  })

  it('dans la modale : la liste d\'un <@@select> s\'ouvre et se choisit ; la bulle d\'un mjs-title se voit, même après une bulle du document ouverte avant la modale', async function () {
    const c = await lire(`return __c(document.getElementById('t-corps'))`)
    await page.mouse.move(c.x, c.y)
    await pret(`!!__bulle(document)`)
    await poser(`{ title: 'Choix', html: ${JSON.stringify(DANS)}, showCancelButton: true }`)
    await pret(`!!__o(document.querySelector('.mjs-modal-box .s-mod')).querySelector('.select-btn')`)
    const b = await lire(`return __c(__o(document.querySelector('.mjs-modal-box .s-mod')).querySelector('.select-btn'))`)
    await page.mouse.click(b.x, b.y)
    await pret(`__o(document.querySelector('.mjs-modal-box .s-mod')).querySelectorAll('.select-option').length === 3`)
    await lire(`await __images()`)
    const o      = await lire(`return __c(__o(document.querySelector('.mjs-modal-box .s-mod')).querySelectorAll('.select-option')[2])`)
    const dessus = await lire(`const e = __o(document.querySelector('.mjs-modal-box .s-mod')).elementFromPoint(${o.x}, ${o.y}); return e && e.closest('.select-option') ? e.closest('.select-option').textContent.trim() : String(e && (e.className || e.nodeName))`)
    assert.equal(dessus, 'Trois', 'l\'option se voit : rien ne la couvre')
    await page.mouse.click(o.x, o.y)
    await pret(`__o(document.querySelector('.mjs-modal-box .s-mod')).querySelector('.select-btn').textContent.includes('Trois')`)
    const t = await lire(`return __c(document.querySelector('.mjs-modal-box .t-mod'))`)
    await page.mouse.move(t.x, t.y)
    await pret(`(() => { const b = __bulle(document); return !!b && b.textContent === 'Bulle de la modale' })()`)
    await page.waitForTimeout(300)
    const q = await lire(`return __c(__bulle(document))`)
    assert.equal(await pixel(page, q.l + 3, q.y), ROUGE, 'la bulle de la modale se voit')
    assert.equal(await lire(`return __fond() !== null && window.__r === undefined`), true, 'la modale reste ouverte')
  })

  it('la modale ouverte, Échap ferme d\'abord le menu de MJS ouvert (le menu d\'un <@@chart>), son focus rendu à son bouton, la modale restant ouverte ; une bulle `@title` visible ne la retient pas', async function () {
    await poser(`{ title: 'Choix', html: ${JSON.stringify(DANS)}, showCancelButton: true }`)
    // le menu ouvert au clavier : le piège de la modale ne guette que Tab
    await lire(`__o(__q('.c-page')).querySelector('button.pick').focus()`)
    await page.keyboard.press('ArrowDown')
    await pret(`(() => { const m = __o(__q('.c-page')).querySelector('.menu'); return !!m && !m.classList.contains('wait') })()`)
    await page.keyboard.press('Escape')
    await lire(`await __images()`)
    assert.deepEqual(await lire(`return { menu: !!__o(__q('.c-page')).querySelector('.menu'), ouverte: !!__fond() && window.__r === undefined, focus: __nom(__actif()) }`), { menu: false, ouverte: true, focus: '.pick' })
    const t = await lire(`return __c(document.querySelector('.mjs-modal-box .t-mod'))`)
    await page.mouse.move(t.x, t.y)
    await pret(`(() => { const b = __bulle(document); return !!b && b.textContent === 'Bulle de la modale' })()`)
    await page.keyboard.press('Escape')
    await pret(`!!window.__r && !__fond()`)
    assert.equal(await lire(`return window.__r.dismiss`), 'esc', 'la bulle visible : Échap ferme la modale')
  })

  it('ce qui s\'affiche devant la modale répond comme sans elle : popover dans un en-tête collant, `<dialog>` ou popover ouverts pendant, bandeau montré pendant ou déjà là, élément flex au très haut `z-index` ; la modale reste ouverte avec sa saisie, rien d\'inerte', async function () {
    // chaque appui : l'élément posé, la modale ouverte et la saisie tapée, l'élément montré s'il l'est pendant, puis un clic sur son bouton
    const essai = async (html: string, bouton: string, pendant = '') => {
      await lire(`document.body.insertAdjacentHTML('afterbegin', ${JSON.stringify(html)}); window.__clics = 0; document.getElementById('${bouton}').addEventListener('click', () => { window.__clics++ })`)
      await lire(`const p = document.getElementById('pn'); if (p) p.showPopover()`)
      await poser(`{ title: 'Saisie', input: 'text', showCancelButton: true }`)
      await page.keyboard.type('abc')
      if (pendant) await lire(`${pendant}; await __images()`)
      await clic(`document.getElementById('${bouton}')`)
      await page.waitForTimeout(250)
      const r = await lire(`return { clics: window.__clics, ouverte: !!__fond() && window.__r === undefined, saisie: (document.querySelector('.mjs-modal-input') || {}).value ?? null, inertes: __inertes() }`)
      await lire(`const d = document.querySelector('dialog[open]'); if (d) d.close(); µ.modal.close(); await __images(); document.body.firstElementChild.remove()`)
      return r
    }
    const vivant = { clics: 1, ouverte: true, saisie: 'abc', inertes: '#ailleurs' }
    const r      = {
      entete: await essai('<header id="entete"><button type="button">h</button><div id="pn" popover="auto"><button id="pnb" type="button">supprimer</button></div></header>', 'pnb'),
      dialog: await essai('<dialog id="dp"><p>Session</p><button id="dpb" type="button" onclick="this.parentNode.close()">rester</button></dialog>', 'dpb', `document.getElementById('dp').showModal()`),
      popover: await essai('<div id="po" popover="manual"><button id="pob" type="button">po</button></div>', 'pob', `document.getElementById('po').showPopover()`),
      bandeau: await essai('<div id="cookies" class="bandeau"><button id="cookiesb" type="button">Accepter</button></div>', 'cookiesb', `document.getElementById('cookies').classList.add('vu')`),
      deja: await essai('<div id="deja" class="bandeau"><button id="dejab" type="button">Accepter</button></div>', 'dejab'),
      flex: await essai('<div id="fx"><div id="fzi"><button id="fzb" type="button">fz</button></div></div>', 'fzb')
    }
    assert.deepEqual(r, { entete: vivant, dialog: vivant, popover: vivant, bandeau: vivant, deja: vivant, flex: vivant })
  })

  it('une navigation qui part la modale ouverte, puis Précédent : la page revient avec son toast, sans calque, la pile telle qu\'avant', async function () {
    await lire(`µ.modal.notify('collant', { duration: 0 }); await __dort(500)`)
    const pile  = `const p = document.querySelector('.mjs-toasts'); return { pile: p ? [...p.attributes].map((a) => a.name).sort().join(',') : null, toasts: document.querySelectorAll('.mjs-toast').length }`
    const avant = await lire(pile)
    await poser(`{ title: 'N', html: '<a id="aller" href="/page2">aller</a>' }`)
    await lire(`window.__charges = 0`)
    await clic(`document.getElementById('aller')`)
    await page.waitForFunction(`window.__charges >= 1 && location.pathname === '/page2'`, null, { timeout: 10000 })
    await page.waitForTimeout(300)
    assert.equal(await lire(`return window.__r && window.__r.dismiss`), 'close', 'fermée à l\'arrivée de la page')
    await lire(`window.__charges = 0; history.back()`)
    await page.waitForFunction(`location.pathname === '/' && window.__charges >= 1`, null, { timeout: 10000 })
    await page.waitForTimeout(400)
    const retour = await lire(`const h = document.elementFromPoint(500, 690); return { calques: document.querySelectorAll('.mjs-modal-backdrop').length, boites: document.querySelectorAll('.mjs-modal-box').length, inertes: __inertes(), dessus: __nom(h) }`)
    assert.deepEqual(retour, { calques: 0, boites: 0, inertes: '#ailleurs', dessus: '.loin' })
    assert.deepEqual(await lire(pile), avant, 'la pile revient telle qu\'avant, avec son toast')
    await lire(`µ.modal.notify('apres', { duration: 0 }); await __dort(300)`)
    assert.equal(await lire(`return document.querySelectorAll('.mjs-toast').length`), 2, 'la pile resservie au toast suivant')
  })
})
