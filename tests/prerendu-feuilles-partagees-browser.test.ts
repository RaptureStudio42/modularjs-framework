// Prérendu, dans un Chromium réel — la page a la même géométrie avant et après le démarrage du
// JavaScript.
//
// Le saut mesuré : sur le site, /doc passait de 1 580 à 1 984 px de haut et /tuto de 1 228 à 900 px
// quand le JavaScript démarrait. Cause : le HTML prérendu ne portait pas les feuilles partagées que
// le composant déclare par `@css` ; sans JavaScript le panneau latéral prenait toute la largeur
// (1 400 px) et le contenu se calait sous lui, puis tout se remettait en place à l'adoption des
// feuilles. Le composant de ce test reproduit cette disposition : une entête, un panneau FIXE et un
// contenu décalé, le tout mis en page par deux feuilles partagées.
//
// Le test charge le fragment prérendu avec les scripts du cœur BLOQUÉS (la page reste telle que le
// serveur l'a écrite), relève la position et la taille de trois éléments du composant, puis recharge
// avec les scripts permis et relève les mêmes trois éléments une fois le composant monté. Il garde
// aussi qu'une fois monté, la racine d'ombre ne garde plus la feuille prérendue (les feuilles sont
// adoptées, pas dupliquées). Chromium absent : le test est sauté.

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { mjsTmp, sweepRegistered } from './helpers/tmp.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'

after(() => sweepRegistered())

interface Boite { x: number; y: number; w: number; h: number }
interface Mesure { entete: Boite; menu: Boite; contenu: Boite; hauteur: number; feuillesDansRacine: number; adoptees: number }

const SELECTEURS = { entete: '.entete', menu: '.menu', contenu: '.contenu' }

function fixture(): { root: string; srcDir: string; stylesDir: string; outDir: string } {
  const root      = mjsTmp('prerendu-partagees-nav')
  const srcDir    = join(root, 'src')
  const stylesDir = join(root, 'styles')
  const outDir    = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  mkdirSync(stylesDir, { recursive: true })
  writeFileSync(join(stylesDir, 'shared-entete.css'), '.entete { height: 60px; background: #333 }\n')
  writeFileSync(join(stylesDir, 'shared-menu.css'), '.menu { position: fixed; top: 60px; left: 0; width: 280px; height: 300px; background: #444 }\n')
  writeFileSync(join(srcDir, 'panneau.mjs'), [
    '<header class="entete">ENTETE</header>',
    '<aside class="menu">MENU</aside>',
    '<main class="contenu"><p>CONTENU</p></main>',
    '<style @css="shared-entete shared-menu">',
    '  :host',
    '    display: block',
    '  .contenu',
    '    margin-left: 280px',
    '    min-height: 500px',
    '</style>',
    '',
  ].join('\n'))
  return { root, srcDir, stylesDir, outDir }
}

// sert la coquille puis out/ tel quel
async function servir(root: string, outDir: string, html: string): Promise<{ url: string; server: Server }> {
  const server = createServer((req, res) => {
    const chemin = decodeURIComponent((req.url ?? '/').split('?')[0])
    if(chemin === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(html)
      return
    }
    const fichier = join(root, normalize(chemin))
    if(!fichier.startsWith(outDir) || !existsSync(fichier) || !statSync(fichier).isFile()) {
      res.writeHead(404)
      res.end()
      return
    }
    res.writeHead(200, { 'content-type': extname(fichier) === '.js' ? 'text/javascript; charset=utf-8' : extname(fichier) === '.css' ? 'text/css; charset=utf-8' : 'application/octet-stream' })
    res.end(readFileSync(fichier))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  return { url: `http://127.0.0.1:${(server.address() as any).port}/`, server }
}

// position et taille arrondies de chaque sélecteur, dans l'ombre du composant
function mesurer(sels: Record<string, string>): Mesure {
  const hote: any = document.querySelector('mjs-panneau')
  const racine    = hote.shadowRoot
  const boite     = (s: string): Boite => {
    const r = racine.querySelector(s).getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
  }
  return {
    entete: boite(sels.entete),
    menu: boite(sels.menu),
    contenu: boite(sels.contenu),
    hauteur: document.documentElement.scrollHeight,
    feuillesDansRacine: racine.querySelectorAll('style, link').length,
    adoptees: racine.adoptedStyleSheets.length,
  }
}

async function chromiumDisponible(): Promise<any> {
  try {
    const playwright = await import('playwright')
    if(!existsSync(playwright.chromium.executablePath())) return null
    return await playwright.chromium.launch()
  }
  catch {
    return null
  }
}

describe('prérendu — même géométrie avant et après le démarrage du JavaScript', function () {
  this.timeout(120000)
  let browser: any = null

  before(async function () {
    this.timeout(30000)
    browser = await chromiumDisponible()
    if(!browser) console.log('  ℹ️  Chromium non installé : montages sautés. Activer : `npx playwright install chromium`')
  })

  after(async () => {
    if(browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('entête, panneau fixe et contenu : mêmes position et taille scripts bloqués puis scripts lancés ; la feuille prérendue n\'est pas dupliquée', async function () {
    if(!browser) this.skip()
    const p        = fixture()
    const renderer = await createSSRRenderer({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: join(p.outDir, 'bundle.js'), stylesheetsDir: p.stylesDir, bundlerOpts: { urlPrefix: '/out' } })
    let res
    try {
      res = await renderer.renderToString('mjs-panneau')
    }
    finally {
      await renderer.close()
    }
    const html = `<!doctype html><html><head><meta charset="utf-8">${res.sharedScript}<script type="module" src="/out/bundle.js"></script></head><body>${res.html}</body></html>`
    const { url, server } = await servir(p.root, p.outDir, html)
    const contexte = await browser.newContext({ viewport: { width: 1000, height: 700 } })
    try {
      // scripts bloqués : la page est celle du serveur, rien ne l'adopte
      const bloquee = await contexte.newPage()
      await bloquee.route('**/out/**', (route: any) => route.abort())
      await bloquee.goto(url)
      const avant: Mesure = await bloquee.evaluate(mesurer, SELECTEURS)
      await bloquee.close()

      // scripts lancés : attendre que le composant soit monté (feuilles adoptées)
      const lancee = await contexte.newPage()
      const erreurs: string[] = []
      lancee.on('pageerror', (e: Error) => erreurs.push(e.message))
      await lancee.goto(url)
      await lancee.waitForFunction(() => {
        const h: any = document.querySelector('mjs-panneau')
        return !!customElements.get('mjs-panneau') && h && h.shadowRoot && h.shadowRoot.adoptedStyleSheets.length > 0
      }, null, { timeout: 15000 })
      await lancee.waitForTimeout(300)
      const apres: Mesure = await lancee.evaluate(mesurer, SELECTEURS)

      assert.deepEqual(erreurs, [], 'aucune erreur de page')
      assert.equal(avant.menu.w, 280, `scripts bloqués, le panneau fixe doit déjà faire 280 px de large — relevé : ${JSON.stringify(avant)}`)
      assert.deepEqual(avant.entete, apres.entete, 'entête : même boîte avant et après le démarrage')
      assert.deepEqual(avant.menu, apres.menu, 'panneau fixe : même boîte avant et après le démarrage')
      assert.deepEqual(avant.contenu, apres.contenu, 'contenu : même boîte avant et après le démarrage')
      assert.equal(avant.hauteur, apres.hauteur, 'hauteur du document : la même avant et après le démarrage')
      assert.equal(apres.feuillesDansRacine, 0, 'monté, la racine ne garde aucune feuille prérendue : les feuilles sont adoptées une seule fois')
      assert.ok(apres.adoptees >= 3, `les trois feuilles (deux partagées + la propre) sont adoptées — relevé : ${apres.adoptees}`)
    }
    finally {
      await contexte.close()
      await new Promise(resolve => server.close(() => resolve(null)))
    }
  })
})

// Feuilles LIÉES (page à nombreuses racines), thème et `@import`, dans un Chromium réel. Quand une
// feuille partagée est répétée par trop de racines, le prérendu la sort en `<link>` vers un seul
// fichier au lieu de la recopier : il faut prouver que la page ne change pas de géométrie pour
// autant (la racine d'ombre n'est peinte qu'avec sa feuille), que le navigateur ne demande le
// fichier qu'UNE fois pour 300 racines, et que le thème et le `@import` d'une feuille partagée
// donnent la même mise en page avant et après le démarrage du JavaScript.
describe('prérendu — feuilles liées, thème et @import : même géométrie avant et après le démarrage', function () {
  this.timeout(180000)
  let browser: any = null

  before(async function () {
    this.timeout(30000)
    browser = await chromiumDisponible()
  })

  after(async () => {
    if(browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  const grosse = (): string => {
    let css = ''
    for(let i = 0; css.length < 30000; i++) css += `.regle-${i} { color: #${(100000 + i).toString(16).slice(0, 6)}; margin: ${i % 40}px }\n`
    return css + '.boite { width: 123px; height: 31px; margin-left: 17px; display: block }\n'
  }

  // rend `tag`, charge la page scripts bloqués (seul le JavaScript est refusé) puis lancée, et rend
  // les deux relevés, les requêtes de feuilles de la page bloquée et les 404
  async function comparer(projet: ReturnType<typeof fixture>, tag: string, monte: string, releve: () => any): Promise<{ avant: any; apres: any; html: string; css: string[]; erreurs404: string[] }> {
    const renderer = await createSSRRenderer({ sourceDir: projet.srcDir, outputDir: projet.outDir, manifestPath: join(projet.outDir, 'bundle.js'), stylesheetsDir: projet.stylesDir, bundlerOpts: { urlPrefix: '/out' } })
    let res
    try {
      res = await renderer.renderToString(tag)
    }
    finally {
      await renderer.close()
    }
    const html = `<!doctype html><html><head><meta charset="utf-8">${res.sharedScript}<script type="module" src="/out/bundle.js"></script></head><body>${res.html}</body></html>`
    const { url, server } = await servir(projet.root, projet.outDir, html)
    const contexte = await browser.newContext({ viewport: { width: 1000, height: 700 } })
    try {
      const bloquee = await contexte.newPage()
      const css: string[] = []
      const erreurs404: string[] = []
      await bloquee.route('**/*.js', (route: any) => route.abort())
      bloquee.on('request', (r: any) => { if(r.url().endsWith('.css')) css.push(r.url()) })
      bloquee.on('response', (r: any) => { if(r.status() === 404) erreurs404.push(r.url()) })
      await bloquee.goto(url, { waitUntil: 'load' })
      const avant = await bloquee.evaluate(releve)
      await bloquee.close()
      const lancee = await contexte.newPage()
      // les racines que le client crée sont fermées : ouvertes ici pour que le test puisse les lire
      await lancee.addInitScript(() => { const o = Element.prototype.attachShadow; Element.prototype.attachShadow = function (init: any) { return o.call(this, Object.assign({}, init, { mode: 'open' })) } })
      const erreursPage: string[] = []
      lancee.on('pageerror', (e: Error) => erreursPage.push(e.message))
      lancee.on('console', (m: any) => { if(m.type() === 'error' || m.type() === 'warning') erreursPage.push(m.text().slice(0, 200)) })
      await lancee.goto(url)
      try {
        await lancee.waitForFunction(monte, null, { timeout: 30000 })
      }
      catch {
        const etat = await lancee.evaluate(() => { const h: any = document.querySelector('mjs-liste'); const c: any[] = h && h.shadowRoot ? Array.from(h.shadowRoot.querySelectorAll('mjs-carte')) : []; return { n: c.length, montees: c.filter(x => x.shadowRoot && x.shadowRoot.adoptedStyleSheets.length > 0).length, defini: !!customElements.get('mjs-carte'), liste: h && h.shadowRoot ? h.shadowRoot.adoptedStyleSheets.length : -1, c0: c[0] && c[0].shadowRoot ? c[0].shadowRoot.innerHTML.slice(0, 200) : null, upg: c[0] ? c[0].matches(':defined') : null } })
        throw new Error(`montage incomplet : ${JSON.stringify(etat)} — erreurs de page : ${erreursPage.slice(0, 5).join(' | ')}`)
      }
      await lancee.waitForTimeout(500)
      const apres = await lancee.evaluate(releve)
      return { avant, apres, html: res.html, css, erreurs404 }
    }
    finally {
      await contexte.close()
      await new Promise(resolve => server.close(() => resolve(null)))
    }
  }

  it('300 composants et une feuille de 30 Ko : feuille liée, demandée une fois, mêmes boîtes avant et après', async function () {
    if(!browser) this.skip()
    const p = fixture()
    writeFileSync(join(p.stylesDir, 'grosse.css'), grosse())
    writeFileSync(join(p.srcDir, 'carte.mjs'), '<span class="boite">B</span>\n<style @css="grosse">\n  :host\n    display: block\n</style>\n')
    writeFileSync(join(p.srcDir, 'liste.mjs'), '<section>\n' + '<@carte></@carte>\n'.repeat(300) + '</section>\n')
    const releve = () => {
      const cartes = Array.from((document.querySelector('mjs-liste') as any).shadowRoot.querySelectorAll('mjs-carte')) as any[]
      const boites = cartes.map(c => { const r = c.shadowRoot.querySelector('.boite').getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(',') })
      return { n: cartes.length, boites, hauteur: document.documentElement.scrollHeight }
    }
    const monte = () => {
      const h: any = document.querySelector('mjs-liste')
      const cartes: any[] = h && h.shadowRoot ? Array.from(h.shadowRoot.querySelectorAll('mjs-carte')) : []
      return !!customElements.get('mjs-carte') && cartes.length === 300 && cartes.every(c => c.shadowRoot && c.shadowRoot.adoptedStyleSheets.length > 0)
    }
    const r = await comparer(p, 'mjs-liste', monte as any, releve)
    // cœur complet ici : la feuille du thème (liée aussi) s'ajoute à celle de 30 Ko, soit deux liens d'environ 85 octets par racine
    assert.ok(r.html.length < 110000, `HTML de ${r.html.length} octets`)
    assert.equal(r.avant.n, 300)
    assert.equal(r.avant.boites[0].split(',')[2], '123', `la feuille liée s'applique à la page prérendue — relevé : ${r.avant.boites[0]}`)
    assert.deepEqual(r.avant, r.apres, 'mêmes positions, tailles et hauteur de page, scripts bloqués puis lancés')
    assert.equal(new Set(r.css).size, 2, `deux fichiers de feuille, la feuille de 30 Ko et celle du thème — demandés : ${r.css}`)
    assert.equal(r.css.length, 2, 'chacun demandé une seule fois pour 300 racines')
    assert.deepEqual(r.erreurs404, [])
  })

  it('thème : mêmes boîtes avant et après le démarrage (les variables du thème sont déjà dans la racine)', async function () {
    if(!browser) this.skip()
    const p = fixture()
    writeFileSync(join(p.srcDir, 'sombre.theme.mjs'), '<theme>\n  $$gapv: 77px\n</theme>\n')
    writeFileSync(join(p.srcDir, 'fiche.mjs'), '<div theme="sombre" class="enveloppe"><div class="cible">C</div></div>\n<style>\n  :host\n    display: block\n  .cible\n    width: $$gapv\n    height: 20px\n</style>\n')
    const releve = () => {
      const r = (document.querySelector('mjs-fiche') as any).shadowRoot.querySelector('.cible').getBoundingClientRect()
      return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]
    }
    const monte = () => { const h: any = document.querySelector('mjs-fiche'); return !!customElements.get('mjs-fiche') && !!h && h.shadowRoot.adoptedStyleSheets.length > 0 }
    const r = await comparer(p, 'mjs-fiche', monte as any, releve)
    assert.equal(r.avant[2], 77, `scripts bloqués, la variable du thème est déjà appliquée — relevé : ${r.avant}`)
    assert.deepEqual(r.avant, r.apres)
  })

  it('@import dans une feuille partagée : aucune requête perdue (404), mêmes boîtes avant et après', async function () {
    if(!browser) this.skip()
    const p = fixture()
    writeFileSync(join(p.stylesDir, 'avec-import.css'), '@import url("shared-menu.css");\n.cible { width: 321px; height: 20px; display: block }\n')
    writeFileSync(join(p.srcDir, 'fiche.mjs'), '<div class="cible">C</div>\n<style @css="avec-import">\n  :host\n    display: block\n</style>\n')
    const releve = () => {
      const r = (document.querySelector('mjs-fiche') as any).shadowRoot.querySelector('.cible').getBoundingClientRect()
      return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]
    }
    const monte = () => { const h: any = document.querySelector('mjs-fiche'); return !!customElements.get('mjs-fiche') && !!h && h.shadowRoot.adoptedStyleSheets.length > 0 }
    const r = await comparer(p, 'mjs-fiche', monte as any, releve)
    assert.deepEqual(r.erreurs404, [], 'le @import n\'a déclenché aucune requête')
    assert.equal(r.avant[2], 321)
    assert.deepEqual(r.avant, r.apres)
  })
})
