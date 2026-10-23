// Dans Chromium réel, ce que happy-dom ne sait pas montrer :
// - modale : sélectionner le texte d'un champ à la souris et relâcher sur le fond ne la ferme pas (le clic, que Chromium envoie
//   au fond, ne ferme que si l'appui y était aussi) ; un clic simple sur le fond la ferme toujours ;
// - toast : une icône « <svg… » suivie de HTML, ou porteuse de gestionnaires, n'exécute aucun code ;
// - transitions de vue : le fantôme de la couche de lévitation ne monte pas une seconde fois les composants de l'élément qu'il
//   recopie, ni au départ ni à l'arrivée ;
// - rideaux bars et blocks : sous une CSP stricte (style-src 'self', µ._csp), les bandes et les tuiles gardent leur cascade,
//   sans violation de la politique ;
// - @flip : Chromium refuse bien (TypeError) une courbe qui n'est pas une valeur CSS et une durée négative, ce que
//   flip-courbe-ou-duree-refusee.test.ts rattrape.
// Le runtime est chargé tel quel dans la page, comme les tests navigateur voisins.

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const lire = (f: string): string => readFileSync(join(__dirname, '..', 'src', 'runtime', f), 'utf-8')
const sansEsm = (s: string): string => s.replace(/^\s*import\s+[^;]+;\s*$/gm, '').replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
const SCRIPT = `${sansEsm(lire('mjs_init.ts'))}\n${lire('mjs_page_cache.ts')}\n${lire('mjs_modal.ts')}\n${lire('mjs_vt_presets.ts')}\nglobalThis.µ = µ;`
const ORIGINE = 'http://mjs.test'
const PAGE = '<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body></body></html>'
const CSP = "style-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'"

describe('modale, icône de toast, fantôme de lévitation, rideaux sous CSP et @flip (Chromium réel)', function () {
  this.timeout(120000)
  let browser: any
  let page: any
  const refus: string[] = []

  before(async function () {
    const playwright = await import('playwright')
    if (!existsSync(playwright.chromium.executablePath())) { this.skip() }
    browser = await playwright.chromium.launch({ args: ['--no-proxy-server'] })
    page    = await browser.newPage({ viewport: { width: 900, height: 700 } })
    page.setDefaultTimeout(10000)
    page.on('console', (m: any) => { if (/Content Security Policy|Refused/i.test(m.text())) { refus.push(m.text().slice(0, 160)) } })
    await page.route(`${ORIGINE}/**`, (r: any) => {
      const csp = r.request().url().includes('/csp')
      r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', headers: csp ? { 'Content-Security-Policy': CSP } : {}, body: PAGE })
    })
  })

  after(async () => { if (browser) { await browser.close() } })

  const ouvrir = async (chemin = '/'): Promise<void> => {
    await page.goto(ORIGINE + chemin)
    await page.evaluate(SCRIPT)
  }

  it('modale : texte du champ sélectionné à la souris puis relâché sur le fond, elle reste ouverte ; un clic sur le fond la ferme', async function () {
    await ouvrir()
    await page.evaluate(`window.__r = 'ouverte'; void µ.modal.fire({ title: 'Votre nom', input: 'text', inputValue: 'Jean-Baptiste Dupont' }).then((r) => { window.__r = 'fermée:' + r.dismiss }); 0`)
    const p = await page.evaluate(`(() => { const b = document.querySelector('.mjs-modal-input').getBoundingClientRect(); return { x: b.x + b.width - 5, y: b.y + b.height / 2 } })()`)
    await page.mouse.move(p.x, p.y)
    await page.mouse.down()
    await page.mouse.move(20, p.y, { steps: 10 })
    await page.mouse.move(10, 10, { steps: 5 })
    await page.mouse.up()
    await page.waitForTimeout(100)
    assert.equal(await page.evaluate('window.__r'), 'ouverte', 'un glisser parti du champ ne ferme pas la modale')
    await page.mouse.click(10, 10)
    await page.waitForTimeout(100)
    assert.equal(await page.evaluate('window.__r'), 'fermée:backdrop', 'un clic sur le fond la ferme')
  })

  it('toast : une icône « <svg… » suivie de HTML ou porteuse de gestionnaires n\'exécute aucun code', async function () {
    await ouvrir()
    await page.evaluate(`
      µ.modal.notify('Bob vous écrit', { icon: '<svg></svg><img src="x" onerror="window.__pwn = 1">' });
      µ.modal.notify('Alice vous écrit', { icon: '<svg onload="window.__pwn = 2" viewBox="0 0 10 10"><desc><img src="x" onerror="window.__pwn = 3"></desc><foreignObject><img src="x" onerror="window.__pwn = 4"></foreignObject><rect width="10" height="10"/></svg>' });
      0`)
    await page.waitForTimeout(300)
    assert.equal(await page.evaluate('window.__pwn'), undefined, 'aucun code ne s\'exécute depuis opts.icon')
    assert.equal(await page.evaluate(`document.querySelectorAll('.mjs-toast-icon img, .mjs-toast-icon foreignObject').length`), 0, 'ni image ni foreignObject glissés dans les icônes')
    assert.equal(await page.evaluate(`document.querySelectorAll('.mjs-toast-icon rect').length`), 1, 'le dessin du SVG nettoyé reste')
  })

  it('lévitation : le fantôme ne monte pas une seconde fois les composants de l\'élément nommé', async function () {
    await ouvrir()
    const n = await page.evaluate(`(() => {
      window.__montes = 0
      customElements.define('x-compteur', class extends HTMLElement { connectedCallback() { window.__montes++ } })
      document.body.innerHTML = '<div id="carte" style="width:200px;height:80px"><p>titre</p><x-compteur style="display:block;width:50px;height:20px"></x-compteur></div>'
      document.getElementById('carte').style.viewTransitionName = 'carte'
      const avant = window.__montes
      const etat = µ._mjs_vtHoistStart()
      const pendant = window.__montes
      const couche = document.getElementById('mjs-vt-hoist')
      const fantome = { balises: couche ? couche.querySelectorAll('x-compteur').length : -1, texte: couche ? couche.textContent : '' }
      µ._mjs_vtHoistSwap(etat)
      const arrivee = window.__montes
      return { avant, pendant, arrivee, fantome, leves: etat ? etat.hidden.length : 0 }
    })()`)
    assert.equal(n.leves, 1, 'l\'élément nommé est levé')
    assert.equal(n.pendant, n.avant, 'aucun montage au départ')
    assert.equal(n.arrivee, n.avant, 'aucun montage à l\'arrivée')
    assert.equal(n.fantome.balises, 0, 'le fantôme ne porte pas de composant')
    assert.ok(n.fantome.texte.includes('titre'), 'le reste du contenu est recopié')
  })

  it('rideaux bars et blocks sous CSP stricte (µ._csp) : même cascade que sans CSP, aucune violation', async function () {
    const delais = (nom: string): Promise<string> => page.evaluate(`(() => { µ._mjs_vtCurtainRun('${nom}', function () {}); return Array.from(document.querySelectorAll('#mjs-vt-curtain > i')).map((b) => getComputedStyle(b).animationDelay).join(',') })()`)
    const libre: string[] = []
    const sous: string[] = []
    for (const nom of ['bars', 'blocks']) {
      await ouvrir('/')
      libre.push(await delais(nom))
      await ouvrir('/csp')
      await page.evaluate('µ._csp = true')
      sous.push(await delais(nom))
    }
    assert.equal(libre[0], '0s,0.045s,0.09s,0.135s,0.18s,0.225s,0.27s,0.315s', 'cascade des bandes')
    assert.ok(libre[1].split(',').includes('0.32s'), 'cascade des tuiles (diagonale 0 à 8)')
    assert.deepEqual(sous, libre, 'même cascade sous CSP')
    assert.deepEqual(refus, [], 'aucune violation de la politique')
  })

  it('@flip : Chromium refuse une courbe qui n\'est pas CSS et une durée négative', async function () {
    await ouvrir()
    const r = await page.evaluate(`(() => {
      const d = document.body.appendChild(document.createElement('div'))
      const essai = (o) => { try { d.animate([{ opacity: 0 }, { opacity: 1 }], o); return 'acceptée' } catch (e) { return e.name } }
      return [essai({ duration: 200, easing: 'elasticOut' }), essai({ duration: -100, easing: 'linear' }), essai({ duration: 200, easing: 'cubic-bezier(0.25, 1, 0.5, 1)' })]
    })()`)
    assert.deepEqual(r, ['TypeError', 'TypeError', 'acceptée'])
  })
})
