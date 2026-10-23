// *marquee dans Chromium, Firefox et WebKit réels : le défilé des enfants, tiré à la main, entraîné par le défilement, en nappe.
// WebKit n'est joué que s'il est installé (sinon ses tests sont sautés).
//   - un texte seul défile comme avant (calque, piste de deux copies, animation CSS) ;
//   - des enfants : les vrais restent dans une piste, des copies (des miroirs hors de la lecture d'écran) couvrent la balise plus un tour, aucun trou ni saut à la couture ;
//   - drag : la piste suit la main, un clic de moins de 5 px reste un clic, l'élan s'éteint, rien ne tourne au repos ;
//   - on: scroll et reverse : la piste avance de tours entiers avec le défilement de la boîte, recule quand on remonte ; hors écran, rien n'écoute ;
//   - axis: both : une nappe sans trou, tirée dans les deux sens ;
//   - « réduire les animations » : ni dérive ni élan, la main et le défilement restent ;
//   - off() rend les enfants à leur place sans rien laisser ; off.set suit speed, reverse et gap sans reposer l'effet ;
//   - une liste qui se remplit après la pose : la balise passe du texte aux enfants, et les copies suivent.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { deuxImages, poseDeuxImages } from './helpers/images-navigateur.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function navigateurPresent(nom: 'chromium' | 'firefox' | 'webkit'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const GIF = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='

const SOURCES: Record<string, string> = {
  'vm-page.mjs': [
    '<script>',
    '$items = [1, 2]',
    '$autres = []',
    '$vides = []',
    '$clics = 0',
    '</script>',
    '<div class="texte" *marquee(speed: 4s)>Salut</div>',
    '<div class="logos" *marquee(drag: true, speed: 4s, gap: 20)>',
    '  <div class="logo" id="premier">L1</div>',
    '  <div class="logo">L2</div>',
    '  <div class="logo">L3</div>',
    '  <div class="logo">L4</div>',
    '  <div class="logo">L5</div>',
    '</div>',
    '<div class="clic" *marquee(drag: true, speed: 600s, gap: 20)>',
    '  <button class="logo bouton" id="bouton" @click={$clics = $clics + 1}>B</button>',
    '  <div class="logo">L2</div>',
    '  <div class="logo">L3</div>',
    `  <img class="photo" id="photo" src="${GIF}" alt="a" width="60" height="40">`,
    '</div>',
    '<span class="n">{$clics}</span>',
    '<div class="survol" *marquee(on: hover, speed: 4s, gap: 20)><div class="logo">A</div><div class="logo">B</div><div class="logo">C</div></div>',
    '<div class="pause" *marquee(pause: true, speed: 4s, gap: 20)><div class="logo">A</div><div class="logo">B</div><div class="logo">C</div></div>',
    '<div class="simple" *marquee(speed: 4s, gap: 20)><div class="logo">A</div><div class="logo">B</div><div class="logo">C</div></div>',
    '<div class="colonne" *marquee(direction: up, drag: true, speed: 600s, gap: 10)><div class="bloc">1</div><div class="bloc">2</div><div class="bloc">3</div></div>',
    '<div class="scene">',
    '  <div class="cols">',
    '    <div class="c1" *marquee(direction: up, on: scroll, speed: 10s, gap: 10)><div class="bloc">1</div><div class="bloc">2</div><div class="bloc">3</div><div class="bloc">4</div></div>',
    '    <div class="c2" *marquee(direction: up, on: scroll, reverse: true, speed: 10s, gap: 10)><div class="bloc">5</div><div class="bloc">6</div><div class="bloc">7</div><div class="bloc">8</div></div>',
    '  </div>',
    '  <div class="espace"></div>',
    '</div>',
    '<div class="nappe" *marquee(axis: both, gap: 10)>',
    '  <div class="poster">1</div><div class="poster">2</div><div class="poster">3</div><div class="poster">4</div>',
    '  <div class="poster">5</div><div class="poster">6</div><div class="poster">7</div><div class="poster">8</div>',
    '</div>',
    '<div class="liste" *marquee(drag: true, speed: 600s, gap: 10)>{for i in $items}<div class="it">{i}</div>{end}</div>',
    '<button class="plus" @click={$items = [...$items, $items.length + 1]}>+</button>',
    '<button class="moins" @click={$items = $items.slice(0, -1)}>-</button>',
    '<div class="bascule" *marquee(speed: 4s)>{for i in $autres}<div class="it">{i}</div>{end}</div>',
    '<button class="remplir" @click={$autres = [1, 2, 3]}>remplir</button>',
    '<button class="vider" @click={$autres = []}>vider</button>',
    '<div class="cale"></div>',
    '<div class="hscene">',
    '  <div class="hcols"><div class="hcol" *marquee(direction: up, on: scroll, speed: 10s, gap: 10)><div class="bloc">1</div><div class="bloc">2</div><div class="bloc">3</div></div></div>',
    '  <div class="espace"></div>',
    '</div>',
    '<div class="hlogos" *marquee(speed: 4s, gap: 20)><div class="logo">A</div><div class="logo">B</div><div class="logo">C</div></div>',
    '<div class="droite" *marquee(drag: true, direction: right, speed: 4s, gap: 20)><div class="logo">1</div><div class="logo">2</div><div class="logo">3</div><div class="logo">4</div><div class="logo">5</div></div>',
    '<div class="large" *marquee(drag: true, speed: 4s, gap: 20)><div class="logo">1</div><div class="logo">2</div><div class="logo">3</div><div class="logo">4</div><div class="logo">5</div></div>',
    '<div class="haute" *marquee(direction: up, drag: true, speed: 4s, gap: 10)><div class="fin">1</div><div class="fin">2</div><div class="fin">3</div></div>',
    '<p class="melange" *marquee(speed: 4s)>Un texte avec <b>du gras</b> dedans</p>',
    '<p class="balises" *marquee(speed: 4s)>Un <a href="#x">lien</a>, du <i>style</i><br>et <code>du code</code> avec <em>emphase</em> <strong>forte</strong> et <span>un span</span></p>',
    '<p class="melange-main" *marquee(drag: true, speed: 600s)>Un texte avec <b>du gras</b> dedans</p>',
    '<p class="seul" *marquee(speed: 4s)><b>Un titre en gras</b></p>',
    '<div class="vide" *marquee(drag: true, speed: 4s, gap: 20)></div>',
    '<div class="vide-colonne" *marquee(direction: up, drag: true, speed: 4s, gap: 10)></div>',
    '<div class="vide-nappe" *marquee(axis: both, gap: 10)></div>',
    '<div class="rempli" *marquee(drag: true, speed: 600s, gap: 10)>{for i in $vides}<div class="it">{i}</div>{end}</div>',
    '<div class="cache"><div class="cachee" *marquee(drag: true, speed: 600s, gap: 20)><div class="logo">1</div><div class="logo">2</div><div class="logo">3</div></div></div>',
    '<div class="defile-main" *marquee(on: scroll, drag: true, speed: 10s, gap: 20)><div class="logo">1</div><div class="logo">2</div><div class="logo">3</div></div>',
    '<button class="garnir" @click={$vides = [1, 2, 3]}>garnir</button>',
    '<button class="vider2" @click={$vides = []}>vider</button>',
    '<style>',
    ':host',
    '  display: block',
    'div',
    '  box-sizing: border-box',
    '.texte',
    '  width: 300px',
    '  height: 30px',
    '.logos',
    '  width: 400px',
    '.clic',
    '  width: 400px',
    '.survol',
    '  width: 400px',
    '.pause',
    '  width: 400px',
    '.simple',
    '  width: 400px',
    '.logo',
    '  width: 100px',
    '  height: 40px',
    '.photo',
    '  width: 60px',
    '  height: 40px',
    '.colonne',
    '  width: 120px',
    '  height: 300px',
    '.scene',
    '  width: 300px',
    '  height: 300px',
    '  overflow-y: auto',
    '.cols',
    '  position: sticky',
    '  top: 0',
    '  display: flex',
    '  gap: 20px',
    '  height: 300px',
    '.c1',
    '  width: 120px',
    '  height: 300px',
    '.c2',
    '  width: 120px',
    '  height: 300px',
    '.bloc',
    '  width: 120px',
    '  height: 100px',
    '.nappe',
    '  width: 480px',
    '  height: 320px',
    '.poster',
    '  width: 90px',
    '  height: 130px',
    '.liste',
    '  width: 300px',
    '.it',
    '  width: 40px',
    '  height: 30px',
    '.bascule',
    '  width: 300px',
    '.cale',
    '  height: 1600px',
    '.hscene',
    '  width: 300px',
    '  height: 200px',
    '  overflow-y: auto',
    '.hcols',
    '  position: sticky',
    '  top: 0',
    '  height: 200px',
    '.hcol',
    '  width: 120px',
    '  height: 200px',
    '.hlogos',
    '  width: 300px',
    '.espace',
    '  height: 1200px',
    '.droite',
    '  width: 400px',
    '.large',
    '  width: 600px',
    '.haute',
    '  width: 100px',
    '  height: 150px',
    '.fin',
    '  width: 100px',
    '  height: 40px',
    '.melange, .balises, .melange-main, .seul',
    '  width: 300px',
    '  margin: 0',
    '.vide',
    '  width: 400px',
    '  height: 40px',
    '.vide-colonne',
    '  width: 100px',
    '  height: 150px',
    '.vide-nappe',
    '  width: 300px',
    '  height: 200px',
    '.rempli',
    '  width: 300px',
    '.cache',
    '  display: none',
    '.cachee',
    '  width: 400px',
    '.defile-main',
    '  width: 400px',
    '</style>',
    ''
  ].join('\n')
}

// dans la page : la balise d'une classe, sa piste, ses copies, son décalage ; les images dessinées par la page ; les rendez-vous d'image demandés
const HOTE = [
  'window.__raf = 0; const r0 = window.requestAnimationFrame; window.requestAnimationFrame = function(f) { window.__raf++; return r0.call(window, f) }',
  'window.__h = (c) => document.querySelector("mjs-vm-page")._shadow.querySelector("." + c);',
  'window.__run = (c) => window.__h(c).querySelector(":scope > [mjs-fx-marquee-run]");',
  'window.__tr = (c) => { const t = window.__run(c).style.translate.split(" ").map(parseFloat); return { x: t[0] || 0, y: t[1] || 0 } };',
  'window.__tour = (c) => parseFloat(window.__run(c).style.getPropertyValue("--mjs-fx-marquee-tour"));',
  'window.__copies = (c) => Array.from(window.__run(c).querySelectorAll(":scope > [mjs-fx-marquee-copy]"));',
  // le plus grand vide, dans l\'axe demandé, entre les éléments `sel` que la balise montre (la balise elle-même rogne)
  'window.__trous = (c, sel, axe) => { const h = window.__h(c); const b = h.getBoundingClientRect(); const lo = axe === "x" ? b.left : b.top; const hi = axe === "x" ? b.right : b.bottom;',
  '  const bords = Array.from(h.querySelectorAll(sel)).map((e) => { const r = e.getBoundingClientRect(); return axe === "x" ? [r.left, r.right, r.top, r.bottom] : [r.top, r.bottom, r.left, r.right] })',
  '    .filter((r) => r[1] > lo && r[0] < hi && r[3] > (axe === "x" ? b.top : b.left) && r[2] < (axe === "x" ? b.bottom : b.right)).sort((p, q) => p[0] - q[0]);',
  '  let pos = lo; let plus = 0; for (const r of bords) { plus = Math.max(plus, r[0] - pos); pos = Math.max(pos, r[1]) } return Math.max(plus, hi - pos) };',
  // les clics qui arrivent jusqu'à la fenêtre, en remontée : un clic avalé par la balise n'y arrive pas
  'window.__clics = 0; window.addEventListener("click", () => { window.__clics++ });',
  // les écouteurs que la page a posés sur la fenêtre et pas encore retirés : [type, fonction, capture]
  '(() => { const ajoute = window.addEventListener; const retire = window.removeEventListener; window.__ecoute = [];',
  '  window.addEventListener = function(t, f, o) { window.__ecoute.push([t, f, !!(o && (o === true || o.capture))]); return ajoute.apply(this, arguments) };',
  '  window.removeEventListener = function(t, f, o) { const c = !!(o && (o === true || o.capture)); const i = window.__ecoute.findIndex((x) => x[0] === t && x[1] === f && x[2] === c); if (i >= 0) window.__ecoute.splice(i, 1); return retire.apply(this, arguments) } })();'
].join('\n')

// dans la page : tout ce qui lit la mise en page ou le défilement DANS une image d'animation (requestAnimationFrame) est noté dans `__lect`
// (un défilement lu là force un recalcul de style dès qu'une écriture d'une piste voisine l'a précédé)
const LECTURES_DANS_IMAGE = [
  '(() => { const w = window; w.__lect = []; let dedans = 0; const r0 = w.requestAnimationFrame;',
  '  w.requestAnimationFrame = function(f) { return r0.call(w, function(t) { dedans++; try { return f(t) } finally { dedans-- } }) };',
  '  const compte = (cible, nom) => { const d = Object.getOwnPropertyDescriptor(cible, nom); if (!d || !d.get) return;',
  '    Object.defineProperty(cible, nom, { configurable: true, enumerable: d.enumerable, set: d.set, get() { if (dedans) w.__lect.push(nom); return d.get.call(this) } }) };',
  '  for (const n of ["scrollTop", "scrollLeft", "scrollWidth", "scrollHeight", "clientWidth", "clientHeight", "clientTop", "clientLeft"]) compte(Element.prototype, n);',
  '  for (const n of ["offsetWidth", "offsetHeight", "offsetTop", "offsetLeft"]) compte(HTMLElement.prototype, n);',
  '  for (const n of ["pageYOffset", "pageXOffset", "scrollY", "scrollX"]) compte(w, n);',
  '  for (const n of ["getBoundingClientRect", "getClientRects"]) { const o = Element.prototype[n]; Element.prototype[n] = function() { if (dedans) w.__lect.push(n); return o.apply(this, arguments) } }',
  '  const g = w.getComputedStyle; w.getComputedStyle = function() { if (dedans) w.__lect.push("getComputedStyle"); return g.apply(w, arguments) } })()'
].join('\n')

describe('*marquee : enfants, main, défilement, nappe (navigateurs réels)', function () {
  this.timeout(240000)
  let scripts = ''
  let construit = false

  before(async function () {
    const root   = mjsTmp('effets-marquee-browser')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const ordre = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b))
    const lis   = (f: string) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))
    scripts   = ordre.filter((f) => rang(f) < 2).map(lis).join('\n') + '\nµ._fxConf = { lite: "off" };\n' + ordre.filter((f) => rang(f) === 2).map(lis).join('\n') + '\nglobalThis.µ = µ;'
    construit = true
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
    describe(nom, function () {
      let present = false
      let browser: any = null

      before(async function () {
        present = await navigateurPresent(nom)
        if (!present) {
          console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
          return
        }
        browser = await (await import('playwright'))[nom].launch()
      })

      after(async () => { if (browser) await browser.close() })

      // la page du composant, servie à une vraie adresse ; `reduit` : « réduire les animations » demandé par le système
      async function ouvre(reduit = false) {
        assert.ok(construit, 'la construction a échoué')
        const page = await browser.newPage({ viewport: { width: 800, height: 1300 }, reducedMotion: reduit ? 'reduce' : 'no-preference' })
        await page.addInitScript(HOTE)
        // `window.deuxImages()` : l'attente de deux images dessinées, pour un parcours évalué d'un bloc dans la page
        await poseDeuxImages(page)
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body><mjs-vm-page></mjs-vm-page><script>${scripts}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(() => !!(document.querySelector('mjs-vm-page') as any)?._shadow?.querySelector('.logos > [mjs-fx-marquee-run]'))
        await page.waitForTimeout(250)
        return page
      }

      async function essai(reduit: boolean, fn: (page: any) => Promise<void>) {
        const page = await ouvre(reduit)
        try {
          await fn(page)
        } finally {
          await page.close()
        }
      }

      // le centre de ce que la balise montre d'un élément (la balise rogne) ; sans sélecteur, celui de la balise
      const centre = (page: any, classe: string, sel = '') => page.evaluate(([c, s]: string[]) => {
        const h: any = (window as any).__h(c)
        const e: any = s ? h.querySelector(s) : h
        const r = e.getBoundingClientRect()
        const b = h.getBoundingClientRect()
        const l = Math.max(r.left, b.left)
        const t = Math.max(r.top, b.top)
        const w = Math.min(r.right, b.right) - l
        const hh = Math.min(r.bottom, b.bottom) - t
        return { x: l + w / 2, y: t + hh / 2, l, t, w, h: hh }
      }, [classe, sel])

      // un geste : la souris descend en (x, y), glisse de (dx, dy) en `pas` mouvements, attend `attente` ms (au-delà de 90 ms : pas d'élan), remonte
      async function tire(page: any, x: number, y: number, dx: number, dy: number, pas = 8, attente = 150) {
        await page.mouse.move(x, y)
        await page.mouse.down()
        await page.mouse.move(x + dx, y + dy, { steps: pas })
        await page.waitForTimeout(attente)
        await page.mouse.up()
        await page.waitForTimeout(60)
      }

      const dans = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol

      it('un texte seul défile comme avant : le calque, la piste de deux copies, l\'animation CSS — pas de piste d\'enfants', async function () {
        if (!present) { this.skip(); return }
        await essai(false, async (page) => {
          const etat = () => page.evaluate(() => {
            const h = (window as any).__h('texte')
            const piste = h.querySelector('[mjs-fx-marquee-track]')
            return {
              attrs: h.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx-marquee')),
              copies: piste ? piste.children.length : -1,
              anims: piste ? piste.getAnimations().length : -1,
              nom: piste ? (piste.getAnimations()[0] as any).animationName : '',
              piste: !!h.querySelector(':scope > [mjs-fx-marquee-run]'),
              gauche: piste ? piste.children[0].getBoundingClientRect().left : 0,
              calque: !!h.querySelector('[mjs-fx-layer="text"]')
            }
          })
          const a = await etat()
          await page.waitForTimeout(300)
          const b = await etat()
          assert.deepEqual(a.attrs, [], 'aucune marque de piste d\'enfants sur un texte seul')
          assert.equal(a.copies, 2, 'deux copies du texte')
          assert.equal(a.anims, 1, 'l\'animation CSS d\'aujourd\'hui')
          assert.equal(a.nom, 'mjs-fx-marquee', 'celle d\'aujourd\'hui, pas celle des enfants')
          assert.equal(a.piste, false, 'pas de piste d\'enfants')
          assert.ok(a.calque, 'le calque de texte est posé')
          assert.notEqual(b.gauche, a.gauche, 'le texte défile')
        })
      })

      it('des enfants : les vrais restent dans la piste, les copies ne sont ni inertes ni cachées à la lecture d\'écran et couvrent la balise plus un tour (un de plus quand la main s\'ajoute à la dérive)', async function () {
        if (!present) { this.skip(); return }
        await essai(false, async (page) => {
          const r = await page.evaluate(() => {
            const w: any = window
            const h = w.__h('logos')
            const run = w.__run('logos')
            const orig = Array.from(run.children).filter((c: any) => !c.hasAttribute('mjs-fx-marquee-copy')) as any[]
            const copies = w.__copies('logos')
            const tour = w.__tour('logos')
            const premiers = copies.length > 0 ? Array.from(copies[0].children) as any[] : []
            return {
              enfantsDeLaBalise: Array.from(h.children).filter((c: any) => !c.hasAttribute('mjs-fx-layer')).length,
              originaux: orig.map((c) => c.textContent),
              id: orig[0].id,
              nbCopies: copies.length,
              attendu: Math.ceil(h.clientWidth / tour) + 1,
              tour,
              ouvertes: copies.every((c: any) => !c.hasAttribute('aria-hidden') && !c.hasAttribute('inert') && c.getAttribute('mjs-fx-marquee-copy') === ''),
              sansId: copies.every((c: any) => c.querySelectorAll('[id]').length === 0),
              sansMarque: copies.every((c: any) => c.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx') && a !== 'mjs-fx-marquee-copy').length === 0 && Array.from(c.querySelectorAll('*')).every((e: any) => e.getAttributeNames().every((a: string) => !a.startsWith('mjs-fx')))),
              textes: premiers.map((c) => c.textContent),
              largeur: run.getBoundingClientRect().width,
              attrs: h.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx-marquee')).sort()
            }
          })
          assert.equal(r.enfantsDeLaBalise, 1, 'la balise ne porte plus que la piste')
          assert.deepEqual(r.originaux, ['L1', 'L2', 'L3', 'L4', 'L5'], 'les vrais enfants, dans l\'ordre')
          assert.equal(r.id, 'premier', 'l\'original garde son identifiant')
          assert.equal(r.nbCopies, r.attendu, 'ce qu\'il faut pour couvrir : la main s\'ajoute à la dérive, la piste va jusqu\'à deux tours')
          assert.equal(r.nbCopies, 2)
          assert.equal(r.tour, 5 * 100 + 4 * 20 + 20, 'un tour : le contenu plus l\'espace')
          assert.ok(r.ouvertes, 'ni aria-hidden ni inert')
          assert.ok(r.sansId, 'sans identifiant')
          assert.ok(r.sansMarque, 'sans marque d\'effet')
          assert.deepEqual(r.textes, ['L1', 'L2', 'L3', 'L4', 'L5'], 'la copie recopie les enfants')
          assert.equal(r.largeur, 5 * 100 + 4 * 20, 'la piste a la largeur des enfants')
          assert.deepEqual(r.attrs, ['mjs-fx-marquee-drag', 'mjs-fx-marquee-drive', 'mjs-fx-marquee-strip'])
        })
      })

      it('les images des copies gardent leur chargement et leur texte alternatif, sans l\'identifiant de l\'original', async function () {
        if (!present) { this.skip(); return }
        await essai(false, async (page) => {
          const r = await page.evaluate(() => {
            const w: any = window
            const copie = w.__copies('clic')[0].querySelector('img')
            const orig = w.__h('clic').querySelector('#photo')
            return { copie: [copie.getAttribute('loading'), copie.getAttribute('alt'), copie.id], orig: [orig.getAttribute('loading'), orig.getAttribute('alt'), orig.id] }
          })
          assert.deepEqual(r.copie, [null, 'a', ''])
          assert.deepEqual(r.orig, [null, 'a', 'photo'])
        })
      })

      it('drag : la piste suit la main, sans trou ni saut à la couture, et l\'élan s\'éteint', async function () {
        if (!present) { this.skip(); return }
        await essai(false, async (page) => {
          const c = await centre(page, 'clic')
          const tour = await page.evaluate(() => (window as any).__tour('clic'))
          const marque = () => page.evaluate(() => (window as any).__h('clic').querySelector('.logo:nth-child(2)').getBoundingClientRect().left)
          const avant = await marque()
          await tire(page, c.x, c.y, -120, 0)
          const t1 = await page.evaluate(() => (window as any).__tr('clic'))
          assert.ok(dans(t1.x, -115, 3), `la piste suit la main (moins le seuil de 5 px) : ${t1.x}`)
          assert.equal(t1.y, 0, 'pas de mouvement vertical sur une ligne')
          // plusieurs distances, dont une qui passe la couture : jamais un trou plus grand que l'espace
          for (const dx of [-300, -130, 250, 590, -190]) {
            await tire(page, c.x, c.y, dx, 0, 12)
            const t = await page.evaluate(() => (window as any).__tr('clic'))
            assert.ok(t.x <= 0 && t.x > -tour, `ramenée dans ]-tour, 0] : ${t.x}`)
            const trou = await page.evaluate(() => (window as any).__trous('clic', '.logo, .photo', 'x'))
            assert.ok(trou <= 20 + 1, `aucun trou à la couture (déplacement ${dx}) : ${trou} px`)
          }
          // un tour entier plus le seuil : la même image, au même endroit
          const base = await marque()
          await tire(page, c.x, c.y, tour + 5, 0, 20)
          const apres = await marque()
          const reste = ((apres - base) % tour + tour) % tour
          assert.ok(reste < 1.5 || reste > tour - 1.5, `un tour entier ramène l'image à sa place : écart ${reste}`)
          assert.ok(Number.isFinite(avant))
        })
      })

      it('drag : un clic de moins de 5 px reste un clic sur l\'enfant visé ; un geste n\'en fait pas un', async function () {
        if (!present) { this.skip(); return }
        await essai(false, async (page) => {
          const lire = () => page.evaluate(() => (window as any).__h('n').textContent)
          assert.equal(await lire(), '0')
          const b = await centre(page, 'clic', '#bouton')
          await page.mouse.move(b.x, b.y)
          await page.mouse.down()
          await page.mouse.move(b.x + 3, b.y, { steps: 3 })
          await page.mouse.up()
          await page.waitForTimeout(80)
          assert.equal(await lire(), '1', 'un clic avec 3 px de glissement est un clic')
          const tenu = await page.evaluate(() => (window as any).__h('clic').hasAttribute('mjs-fx-marquee-held'))
          assert.equal(tenu, false)
          const b2 = await centre(page, 'clic', '#bouton')
          await page.mouse.move(b2.x, b2.y)
          await page.mouse.down()
          await page.mouse.move(b2.x - 40, b2.y, { steps: 6 })
          await page.waitForTimeout(150)
          await page.mouse.up()
          await page.waitForTimeout(80)
          assert.equal(await lire(), '1', 'un geste de 40 px ne clique pas l\'enfant')
          // et le clic d'après, sans geste, passe de nouveau
          const b3 = await centre(page, 'clic', '#bouton')
          await page.mouse.click(b3.x, b3.y)
          await page.waitForTimeout(80)
          assert.equal(await lire(), '2')
        })
      })

      it('drag : l\'élan continue la main puis s\'éteint ; la boucle et will-change s\'arrêtent d\'eux-mêmes', async function () {
        if (!present) { this.skip(); return }
        await essai(false, async (page) => {
          const c = await centre(page, 'clic')
          // un geste vif, relâché sans attendre : l'élan prend le relais. L'effet retire l'élan si la main reste plus de 90 ms
          // entre le dernier mouvement et le lâcher (mesure faite sur l'horodatage des évènements, comme lui) : sous forte charge
          // le test peut être retardé à ce moment-là, alors le geste n'est plus celui qu'il croit. Le dernier pas et le lâcher
          // partent donc dans le même envoi, l'écart réel est mesuré, et un geste trop lent est refait (3 essais au plus).
          await page.evaluate(() => {
            const w: any = window
            w.__main = { pas: 0, up: 0 }
            window.addEventListener('pointermove', (e) => { w.__main.pas = e.timeStamp }, true)
            window.addEventListener('pointerup', (e) => { w.__main.up = e.timeStamp }, true)
          })
          let repos = 0
          const reposes: number[] = []
          for (let tentative = 0; tentative < 3; tentative++) {
            await page.mouse.move(c.x, c.y)
            await page.mouse.down()
            await page.mouse.move(c.x - 90, c.y, { steps: 9 })
            await Promise.all([page.mouse.move(c.x - 100, c.y), page.mouse.up()])
            repos = await page.evaluate(() => { const m = (window as any).__main; return Math.round(m.up - m.pas) })
            reposes.push(repos)
            if (repos <= 90) break
            await deuxImages(page)
          }
          assert.ok(repos <= 90, `le geste n'a pas pu être tenu : la main est restée plus de 90 ms avant de lâcher (${reposes.join(', ')} ms), l'effet retire alors l'élan à dessein — machine trop chargée`)
          // WebKit ne recalcule la piste qu'en dessinant une image : chaque lecture suit deux images dessinées
          await deuxImages(page)
          const t0 = await page.evaluate(() => (window as any).__tr('clic').x)
          await deuxImages(page)
          const t1 = await page.evaluate(() => (window as any).__tr('clic').x)
          assert.notEqual(t1, t0, `l'élan prolonge le geste (main restée ${repos} ms avant de lâcher)`)
          assert.ok(await page.evaluate(() => (window as any).__run('clic').style.willChange === 'translate'), 'will-change posé pendant le mouvement')
          // plus rien ne bouge : deux lectures espacées sont égales, will-change est rendu, plus aucun rendez-vous d'image n'est demandé
          // l'attente se compte en images dessinées, pas en secondes : l'élan perd 5 % par image (× 0,95), il est donc fini au bout
          // de 140 images au plus (vitesse de départ de 66 px par image au maximum, seuil de 0,05) ; plafond à 300, le double
          const images = await page.evaluate(async () => {
            const w: any = window
            let n = 0
            while (w.__run('clic').style.willChange !== '' && n < 300) { await new Promise((ok) => requestAnimationFrame(ok)); n++ }
            return n
          })
          assert.ok(images < 300, `l'élan s'éteint : will-change rendu après ${images} images dessinées`)
          assert.equal(await page.evaluate(() => (window as any).__run('clic').style.willChange), '', 'will-change rendu')
          const a = await page.evaluate(() => ({ tr: (window as any).__tr('clic').x, raf: (window as any).__raf }))
          await page.waitForTimeout(700)
          const b = await page.evaluate(() => ({ tr: (window as any).__tr('clic').x, raf: (window as any).__raf }))
          assert.equal(b.tr, a.tr, 'la piste est immobile')
          assert.equal(b.raf, a.raf, 'aucun requestAnimationFrame au repos')
        })
      })

      it('sans rien pour la commander, la dérive reste l\'animation CSS de la piste (au compositeur), `translate` n\'est pas écrit', async function () {
        if (!present) { this.skip(); return }
        await essai(false, async (page) => {
          const r = await page.evaluate(() => {
            const run = (window as any).__run('simple')
            const a = run.getAnimations()
            return { n: a.length, nom: a[0]?.animationName, etat: a[0]?.playState, translate: run.style.translate, will: run.style.willChange }
          })
          assert.equal(r.n, 1)
          assert.equal(r.nom, 'mjs-fx-marquee-run')
          assert.equal(r.etat, 'running')
          assert.equal(r.translate, '', 'aucune écriture de translate au repos')
          assert.equal(r.will, '')
        })
      })

      it('drag avec la dérive : la dérive s\'arrête pendant le geste et reprend ensuite', async function () {
        if (!present) { this.skip(); return }
        await essai(false, async (page) => {
          const c = await centre(page, 'logos')
          const etat = () => page.evaluate(() => (window as any).__run('logos').getAnimations()[0].playState)
          assert.equal(await etat(), 'running')
          await page.mouse.move(c.x, c.y)
          await page.mouse.down()
          await page.mouse.move(c.x - 60, c.y, { steps: 6 })
          await page.waitForTimeout(100)
          assert.equal(await etat(), 'paused', 'la dérive se tait pendant que la main tient la piste')
          await page.mouse.up()
          await page.waitForTimeout(100)
          assert.equal(await etat(), 'running', 'elle reprend son allure')
        })
      })

      it('on: scroll : la piste avance de tours entiers avec le défilement de la boîte, recule quand on remonte ; reverse va dans l\'autre sens', async function () {
        if (!present) { this.skip(); return }
        await essai(false, async (page) => {
          const tour = await page.evaluate(() => (window as any).__tour('c1'))
          assert.equal(tour, 4 * 100 + 3 * 10 + 10)
          const defile = (v: number) => page.evaluate((y: number) => { (window as any).__h('scene').scrollTop = y }, v)
          const lire = () => page.evaluate(() => ({ a: (window as any).__tr('c1'), b: (window as any).__tr('c2') }))
          // un tour pour 100 px par seconde de speed : 10s = 1 000 px
          const sur = (y: number, signe: number) => { const m = (signe * y / 1000 * tour) % tour; return m > 0 ? m - tour : m }
          const zero = await lire()
          assert.deepEqual([zero.a.y, zero.b.y], [0, 0])
          for (const y of [400, 1100, 250, 0]) {
            await defile(y)
            await page.waitForTimeout(120)
            const t = await lire()
            assert.ok(dans(t.a.y, sur(y, -1), 0.6), `colonne montante à ${y} : ${t.a.y} au lieu de ${sur(y, -1)}`)
            assert.ok(dans(t.b.y, sur(y, 1), 0.6), `colonne reverse à ${y} : ${t.b.y} au lieu de ${sur(y, 1)}`)
            assert.equal(t.a.x, 0, 'aucun mouvement de côté')
          }
          // la direction up : les deux colonnes vont dans des sens contraires
          await defile(300)
          await page.waitForTimeout(120)
          const t = await lire()
          assert.ok(t.a.y < 0 && t.a.y > -tour, 'la piste monte avec la page')
          assert.ok(t.b.y !== t.a.y, 'reverse : l\'autre sens')
          // aucune dérive CSS, et aucun trou dans la colonne
          assert.equal(await page.evaluate(() => (window as any).__run('c1').getAnimations().length), 0)
          assert.ok(await page.evaluate(() => (window as any).__trous('c1', '.bloc', 'y')) <= 11)
          assert.ok(await page.evaluate(() => (window as any).__trous('c2', '.bloc', 'y')) <= 11)
        })
      })

      it('on: scroll hors écran : rien n\'écoute le défilement ; revenue à l\'écran, la piste se relit', async function () {
        if (!present) { this.skip(); return }
        await essai(false, async (page) => {
          await page.waitForTimeout(300)
          const avant = await page.evaluate(() => (window as any).__tr('hcol').y)
          await page.evaluate(() => { (window as any).__h('hscene').scrollTop = 300 })
          await page.waitForTimeout(250)
          const pendant = await page.evaluate(() => (window as any).__tr('hcol').y)
          assert.equal(pendant, avant, 'hors écran, la piste ne bouge pas')
          const raf = await page.evaluate(() => (window as any).__raf)
          await page.waitForTimeout(300)
          assert.equal(await page.evaluate(() => (window as any).__raf), raf, 'et aucun rendez-vous n\'est demandé')
          await page.evaluate(() => (window as any).__h('hscene').scrollIntoView())
          await page.waitForTimeout(300)
          // la page a défilé pour l'amener : sa part compte, avec celle de la boîte (300 px)
          const page0 = await page.evaluate(() => window.scrollY)
          assert.ok(page0 > 1000, `la page a défilé : ${page0}`)
          const tour = await page.evaluate(() => (window as any).__tour('hcol'))
          const apres = await page.evaluate(() => (window as any).__tr('hcol').y)
          const m = (-(page0 + 300) / 1000 * tour) % tour
          assert.ok(dans(apres, m, 1) || dans(apres, m - tour, 1), `de nouveau à l'écran : ${apres} au lieu de ${m}`)
        })
      })

      it('hors écran, la dérive CSS est suspendue (mjs-fx-marquee-away) ; à l\'écran elle court', async function () {
        if (!present) { this.skip(); return }
        await essai(false, async (page) => {
          await page.waitForTimeout(300)
          // l'observateur de visibilité répond à l'image qui suit : WebKit sous charge peut rester des secondes sans en dessiner, et le relevé fait entre-temps rend l'état d'avant (le défilé encore suspendu après l'arrivée à l'écran)
          const etat = async () => { await deuxImages(page); return page.evaluate(() => { const h = (window as any).__h('hlogos'); return { away: h.hasAttribute('mjs-fx-marquee-away'), jeu: (window as any).__run('hlogos').getAnimations()[0].playState } }) }
          assert.deepEqual(await etat(), { away: true, jeu: 'paused' })
          await page.evaluate(() => (window as any).__h('hlogos').scrollIntoView())
          await page.waitForTimeout(300)
          assert.deepEqual(await etat(), { away: false, jeu: 'running' })
        })
      })

      it('axis: both : une nappe sans trou, tirée dans les deux sens, dont le tour est la largeur des lignes', async function () {
        if (!present) { this.skip(); return }
        await essai(false, async (page) => {
          const r = await page.evaluate(() => {
            const w: any = window
            const h = w.__h('nappe')
            return { attrs: h.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx-marquee')).sort(), largeur: w.__run('nappe').style.width, copies: w.__copies('nappe').length, anims: w.__run('nappe').getAnimations().length, touch: getComputedStyle(h).touchAction, tour: w.__tour('nappe') }
          })
          assert.deepEqual(r.attrs, ['mjs-fx-marquee-axis', 'mjs-fx-marquee-drag', 'mjs-fx-marquee-drive', 'mjs-fx-marquee-still', 'mjs-fx-marquee-strip'], 'drag mis d\'office, pas de dérive')
          assert.equal(r.largeur, '390px', 'quatre affiches par ligne : la largeur des lignes, pas celle de la balise')
          assert.equal(r.tour, 400)
          assert.equal(r.copies, 8, 'trois fois trois, moins l\'original')
          assert.equal(r.anims, 0)
          assert.equal(r.touch, 'none')
          const c = await centre(page, 'nappe')
          for (const [dx, dy] of [[-120, -90], [300, 40], [-50, 200], [-380, -260]]) {
            await tire(page, c.x, c.y, dx, dy, 12)
            const t = await page.evaluate(() => (window as any).__tr('nappe'))
            assert.ok(t.x <= 0 && t.x > -400 && t.y <= 0 && t.y > -280, `ramenée dans le tour : ${t.x}, ${t.y}`)
            assert.ok(await page.evaluate(() => (window as any).__trous('nappe', '.poster', 'x')) <= 10 + 1, `aucun trou à l'horizontale (${dx}, ${dy})`)
            assert.ok(await page.evaluate(() => (window as any).__trous('nappe', '.poster', 'y')) <= 10 + 1, `aucun trou à la verticale (${dx}, ${dy})`)
          }
          await page.mouse.move(c.x, c.y)
          const avant = await page.evaluate(() => (window as any).__tr('nappe'))
          await tire(page, c.x, c.y, -60, -45, 6)
          const apres = await page.evaluate(() => (window as any).__tr('nappe'))
          assert.notEqual(apres.x, avant.x, 'tirée de côté')
          assert.notEqual(apres.y, avant.y, 'et en hauteur')
        })
      })

      it('on: hover : au repos la piste ne défile pas, au survol oui ; pause : le survol arrête la dérive', async function () {
        if (!present) { this.skip(); return }
        await essai(false, async (page) => {
          const jeu = (c: string) => page.evaluate((cl: string) => (window as any).__run(cl).getAnimations().length, c)
          assert.equal(await jeu('survol'), 0, 'au repos : rien')
          const s = await centre(page, 'survol')
          await page.mouse.move(s.x, s.y)
          await page.waitForTimeout(150)
          assert.equal(await jeu('survol'), 1, 'au survol : la dérive')
          await page.mouse.move(790, 5)
          await page.waitForTimeout(150)
          assert.equal(await jeu('survol'), 0, 'le pointeur parti : rien')
          const p = await centre(page, 'pause')
          assert.equal(await page.evaluate(() => (window as any).__run('pause').getAnimations()[0].playState), 'running')
          await page.mouse.move(p.x, p.y)
          await page.waitForTimeout(150)
          assert.equal(await page.evaluate(() => (window as any).__run('pause').getAnimations()[0].playState), 'paused', 'le survol arrête la dérive')
        })
      })

      it('« réduire les animations » : ni dérive ni élan ; les copies d\'une piste sans main sont cachées, celles d\'une piste tirée restent ; la main et le défilement restent', async function () {
        if (!present) { this.skip(); return }
        await essai(true, async (page) => {
          const r = await page.evaluate(() => {
            const w: any = window
            const aff = (c: string) => w.__copies(c).map((x: any) => getComputedStyle(x).display)
            return { simple: { anims: w.__run('simple').getAnimations().length, copies: aff('simple') }, logos: { anims: w.__run('logos').getAnimations().length, copies: aff('logos') }, texte: w.__h('texte').querySelector('[mjs-fx-marquee-track]').getAnimations().length }
          })
          assert.equal(r.simple.anims, 0, 'pas de dérive')
          assert.ok(r.simple.copies.length >= 1 && r.simple.copies.every((d: string) => d === 'none'), `les copies d'une piste que rien ne commande sont cachées : ${r.simple.copies}`)
          assert.equal(r.logos.anims, 0, 'pas de dérive même tirable')
          assert.ok(r.logos.copies.length >= 1 && r.logos.copies.every((d: string) => d === 'flex'), `mais les copies d'une piste tirée bouchent la couture : ${r.logos.copies}`)
          assert.equal(r.texte, 0, 'le texte seul, comme avant')
          // la main : la piste suit, et ne garde aucun élan
          const c = await centre(page, 'clic')
          await page.mouse.move(c.x, c.y)
          await page.mouse.down()
          await page.mouse.move(c.x - 100, c.y, { steps: 10 })
          await page.mouse.up()
          // la piste est posée à l'image qui suit le geste, que le navigateur donne plus ou moins tôt (WebKit remet les pas d'un coup) : on attend la condition, au plus 15 s
          const lit = () => page.evaluate(() => (window as any).__tr('clic').x)
          let t0 = await lit()
          for (let i = 0; i < 600 && !dans(t0, -95, 3); i++) {
            await page.waitForTimeout(25)
            t0 = await lit()
          }
          await page.waitForTimeout(300)
          const t1 = await lit()
          assert.ok(dans(t0, -95, 3), `la main reste : ${t0}`)
          assert.equal(t1, t0, 'aucun élan')
          // le défilement
          await page.evaluate(() => { (window as any).__h('scene').scrollTop = 400 })
          await page.waitForTimeout(150)
          assert.ok((await page.evaluate(() => (window as any).__tr('c1').y)) < -100, 'le défilement entraîne la piste')
        })
      })

      it('off() : les enfants reprennent leur place, sans marque, sans variable, sans piste ni copie ; plus rien n\'écoute', async function () {
        if (!present) { this.skip(); return }
        await essai(false, async (page) => {
          const noms = await page.evaluate(() => {
            const w: any = window
            const classes = ['logos', 'c1', 'nappe']
            // les vrais enfants, relevés dans la piste avant le retrait (les copies n'en font pas partie)
            const avant = classes.map((c) => Array.from(w.__run(c).children).filter((e: any) => !e.hasAttribute('mjs-fx-marquee-copy')).filter((e: any) => e.nodeType === 1))
            for (const c of classes) w.__h(c)._mjs_fxOff.marquee()
            const apres = classes.map((c) => Array.from(w.__h(c).children).filter((e: any) => !e.hasAttribute('mjs-fx-layer')))
            const restes = (c: string) => w.__h(c).getAttributeNames().filter((a: string) => a.startsWith('mjs-fx') || (a === 'style' && w.__h(c).getAttribute('style') !== ''))
            return {
              memes: classes.map((_c, i) => apres[i].length === avant[i].length && apres[i].every((e: any, j: number) => e === avant[i][j])),
              nombres: apres.map((l) => l.length),
              restes: classes.map(restes),
              pistes: classes.map((c) => w.__h(c).querySelectorAll('[mjs-fx-marquee-run], [mjs-fx-marquee-copy]').length),
              off: classes.map((c) => w.__h(c)._mjs_fxOff ?? null)
            }
          })
          assert.deepEqual(noms.memes, [true, true, true], 'les mêmes nœuds, dans le même ordre, redevenus enfants de la balise')
          assert.deepEqual(noms.nombres, [5, 4, 8])
          assert.deepEqual(noms.restes, [[], [], []], 'ni attribut mjs-fx, ni style')
          assert.deepEqual(noms.pistes, [0, 0, 0])
          assert.deepEqual(noms.off, [null, null, null])
          // plus rien n'écoute : tirer ou défiler ne pose plus rien
          const c = await centre(page, 'logos')
          await tire(page, c.x, c.y, -100, 0)
          await page.evaluate(() => { (window as any).__h('scene').scrollTop = 400 })
          await page.waitForTimeout(200)
          const r = await page.evaluate(() => { const w: any = window; return ['logos', 'c1', 'nappe'].map((cl: string) => w.__h(cl).querySelectorAll('[style]').length) })
          assert.deepEqual(r, [0, 0, 0])
        })
      })

      it('off.set : reverse, speed et gap sont suivis sans reposer l\'effet ; direction ou drag le reposent', async function () {
        if (!present) { this.skip(); return }
        await essai(false, async (page) => {
          // chaque réglage se lit à l'image qui suit (défilement livré, rendez-vous d'image, taille relue) : WebKit sous charge peut rester des secondes sans en dessiner, et une pause de 120 ms lit la page d'avant — on attend deux images dessinées, pas une durée
          const r = await page.evaluate(async () => {
            const w: any = window
            const el = w.__h('c1')
            const off = el._mjs_fxOff.marquee
            const run = w.__run('c1')
            const set = (d: any) => (window as any).µ._mjs_fxSet(el, 'marquee', d)
            w.__h('scene').scrollTop = 300
            await w.deuxImages()
            const tour = w.__tour('c1')
            const a = w.__tr('c1').y
            set({ reverse: true })
            await w.deuxImages()
            const b = w.__tr('c1').y
            set({ reverse: false })
            set({ speed: '5s' })
            await w.deuxImages()
            const c = w.__tr('c1').y
            set({ speed: '10s', gap: 30 })
            await w.deuxImages()
            const tour2 = w.__tour('c1')
            const memePiste = el._mjs_fxOff.marquee === off && w.__run('c1') === run
            set({ drag: true })
            await w.deuxImages()
            const repose = el._mjs_fxOff.marquee !== off && el.hasAttribute('mjs-fx-marquee-drag')
            return { tour, a, b, c, tour2, memePiste, repose }
          })
          const m = (v: number, t: number) => { const x = v % t; return x > 0 ? x - t : x }
          assert.ok(dans(r.a, m(-0.3 * r.tour, r.tour), 0.6), `à 300 px : ${r.a}`)
          assert.ok(dans(r.b, m(0.3 * r.tour, r.tour), 0.6), `reverse suivi : ${r.b}`)
          assert.ok(dans(r.c, m(-0.6 * r.tour, r.tour), 0.6), `speed suivi (5s : deux fois plus de tour pour le même défilement) : ${r.c}`)
          assert.equal(r.tour2, 4 * 100 + 3 * 30 + 30, 'gap suivi : le tour est relu')
          assert.ok(r.memePiste, 'la piste et l\'effet sont les mêmes : rien n\'a été reposé')
          assert.ok(r.repose, 'drag est un réglage qui repose l\'effet')
        })
      })

      it('une liste qui se remplit après la pose : le texte passe aux enfants, les copies suivent les ajouts et les retraits', async function () {
        if (!present) { this.skip(); return }
        await essai(false, async (page) => {
          const etat = (c: string) => page.evaluate((cl: string) => {
            const w: any = window
            const h = w.__h(cl)
            const run = h.querySelector(':scope > [mjs-fx-marquee-run]')
            return {
              piste: !!run,
              texte: !!h.querySelector('[mjs-fx-marquee-track]'),
              originaux: run ? Array.from(run.querySelectorAll(':scope > .it')).map((e: any) => e.textContent) : [],
              copies: run ? w.__copies(cl).map((x: any) => Array.from(x.querySelectorAll('.it')).map((e: any) => e.textContent).join('')) : [],
              dehors: Array.from(h.children).filter((e: any) => e.classList.contains('it')).length,
              type: h.getAttribute('mjs-fx-marquee-strip')
            }
          }, c)
          // une liste à enfants dès la pose
          let l = await etat('liste')
          assert.ok(l.piste)
          assert.deepEqual(l.originaux, ['1', '2'])
          assert.ok(l.copies.length >= 1 && l.copies.every((x: string) => x === '12'))
          await page.evaluate(() => (window as any).__h('plus').click())
          await page.waitForTimeout(300)
          l = await etat('liste')
          assert.deepEqual(l.originaux, ['1', '2', '3'], 'l\'ajout entre dans la piste')
          assert.equal(l.dehors, 0, 'aucun enfant hors de la piste')
          assert.ok(l.copies.length >= 1 && l.copies.every((x: string) => x === '123'), `les copies suivent l'ajout : ${l.copies.join(' ')}`)
          await page.evaluate(() => (window as any).__h('moins').click())
          await page.evaluate(() => (window as any).__h('moins').click())
          await page.waitForTimeout(300)
          l = await etat('liste')
          assert.deepEqual(l.originaux, ['1'])
          assert.ok(l.copies.every((x: string) => x === '1'), `et le retrait : ${l.copies.join(' ')}`)
          // une balise vide à la pose : le texte d'abord, les enfants quand ils arrivent, puis le texte de nouveau
          let b = await etat('bascule')
          assert.deepEqual([b.piste, b.texte], [false, true], 'vide : le texte seul, comme avant')
          await page.evaluate(() => (window as any).__h('remplir').click())
          await page.waitForTimeout(400)
          b = await etat('bascule')
          assert.deepEqual([b.piste, b.texte], [true, false], 'des enfants : la piste')
          assert.deepEqual(b.originaux, ['1', '2', '3'])
          assert.equal(b.type, 'kids')
          await page.evaluate(() => (window as any).__h('vider').click())
          await page.waitForTimeout(400)
          b = await etat('bascule')
          assert.deepEqual([b.piste, b.texte], [false, true], 'vidée : le texte reprend le calque')
        })
      })

      it('une colonne tirée (direction: up, drag) : la main la déplace en hauteur seulement, touch-action laisse passer le défilement de côté', async function () {
        if (!present) { this.skip(); return }
        await essai(false, async (page) => {
          const touch = await page.evaluate(() => { const w: any = window; return { colonne: getComputedStyle(w.__h('colonne')).touchAction, ligne: getComputedStyle(w.__h('logos')).touchAction, souris: getComputedStyle(w.__h('colonne')).cursor } })
          assert.deepEqual(touch, { colonne: 'pan-x', ligne: 'pan-y', souris: 'grab' })
          const c = await centre(page, 'colonne')
          await tire(page, c.x, c.y - 100, 17, 90, 9)
          const t = await page.evaluate(() => (window as any).__tr('colonne'))
          assert.equal(t.x, 0, 'pas de mouvement de côté sur une colonne')
          assert.ok(dans(t.y, 85, 3) || dans(t.y, 85 - 330, 3), `la colonne suit la main (moins le seuil) : ${t.y}`)
          assert.ok(await page.evaluate(() => (window as any).__trous('colonne', '.bloc', 'y')) <= 10 + 1, 'aucun trou dans la colonne')
        })
      })

      it('un changement de taille du contenu ou de la balise relit le tour et refait les copies, sans rien reposer', async function () {
        if (!present) { this.skip(); return }
        await essai(false, async (page) => {
          const lire = () => page.evaluate(() => { const w: any = window; return { tour: w.__tour('simple'), copies: w.__copies('simple').length, meme: w.__h('simple')._mjs_fxOff.marquee } && { tour: w.__tour('simple'), copies: w.__copies('simple').length } })
          const a = await lire()
          assert.deepEqual(a, { tour: 3 * 100 + 2 * 20 + 20, copies: 2 })
          // un enfant grandit : le tour est relu (aucun nœud n'a bougé, c'est l'observateur de taille)
          await page.evaluate(() => { (window as any).__h('simple').querySelector('.logo').style.width = '200px' })
          await page.waitForTimeout(200)
          assert.deepEqual(await lire(), { tour: 200 + 100 + 100 + 2 * 20 + 20, copies: 1 })
          // la balise grandit : il faut plus de copies pour la couvrir
          await page.evaluate(() => { (window as any).__h('simple').style.width = '1300px' })
          await page.waitForTimeout(200)
          assert.deepEqual(await lire(), { tour: 460, copies: 3 })
          await page.evaluate(() => { (window as any).__h('simple').style.width = '300px' })
          await page.waitForTimeout(200)
          assert.deepEqual(await lire(), { tour: 460, copies: 1 })
        })
      })

      it('drag avec la dérive qui tourne : jamais de vide à la couture, quelle que soit la main et l\'instant de la dérive (ligne, ligne vers la droite, boîte large, colonne)', async function () {
        if (!present) { this.skip(); return }
        await essai(false, async (page) => {
          // la main s'ajoute à la dérive : la piste va jusqu'à deux tours ; +15 amène la main à -tour+10, le pire départ pour la dérive
          const cas = [
            { c: 'logos', sel: '.logo', axe: 'x', gap: 20 },
            { c: 'droite', sel: '.logo', axe: 'x', gap: 20 },
            { c: 'large', sel: '.logo', axe: 'x', gap: 20 },
            { c: 'haute', sel: '.fin', axe: 'y', gap: 10 }
          ]
          for (const k of cas) {
            await page.evaluate((cl: string) => (window as any).__h(cl).scrollIntoView({ block: 'center' }), k.c)
            await page.waitForTimeout(150)
            const c = await centre(page, k.c)
            for (const d of [15, -250, 330, -505]) {
              await tire(page, c.x, c.y, k.axe === 'x' ? d : 0, k.axe === 'x' ? 0 : d, 12)
              for (const t of [0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 3900]) {
                await page.evaluate(([cl, ms]: any[]) => { const a = (window as any).__run(cl).getAnimations()[0]; a.pause(); a.currentTime = ms }, [k.c, t])
                const trou = await page.evaluate(([cl, sel, axe]: string[]) => (window as any).__trous(cl, sel, axe), [k.c, k.sel, k.axe])
                assert.ok(trou <= k.gap + 1, `${k.c} : un vide de ${trou} px (main ${d}, dérive à ${t} ms) au lieu de ${k.gap} au plus`)
              }
            }
          }
        })
      })

      it('un texte avec des balises en ligne garde le calque, la piste de deux copies et l\'animation d\'avant : pas de piste d\'enfants', async function () {
        if (!present) { this.skip(); return }
        await essai(false, async (page) => {
          const r = await page.evaluate(() => {
            const w: any = window
            return ['melange', 'balises'].map((c) => {
              const h     = w.__h(c)
              const piste = h.querySelector('[mjs-fx-marquee-track]')
              return {
                // hors écran la dérive est suspendue (mjs-fx-marquee-away) : ce n'est pas une marque de la piste d'enfants
                attrs: h.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx-marquee') && a !== 'mjs-fx-marquee-away'),
                calque: !!h.querySelector(':scope > [mjs-fx-layer="text"]'),
                run: !!h.querySelector(':scope > [mjs-fx-marquee-run]'),
                copies: piste ? piste.children.length : -1,
                nom: piste && piste.getAnimations()[0] ? (piste.getAnimations()[0] as any).animationName : '',
                noeuds: Array.from(h.childNodes).filter((n: any) => !(n.nodeType === 1 && n.hasAttribute('mjs-fx-layer'))).map((n: any) => n.nodeType === 1 ? n.localName : '#texte'),
                texte: piste ? piste.children[0].textContent : ''
              }
            })
          })
          const [melange, balises] = r
          assert.deepEqual(melange.attrs, [], 'aucune marque de piste d\'enfants')
          assert.ok(melange.calque, 'le calque de texte est posé')
          assert.equal(melange.run, false, 'pas de piste d\'enfants')
          assert.equal(melange.copies, 2, 'deux copies du texte')
          assert.equal(melange.nom, 'mjs-fx-marquee', 'l\'animation d\'avant, pas celle des enfants')
          assert.deepEqual(melange.noeuds, ['#texte', 'b', '#texte'], 'les nœuds de la balise ne bougent pas')
          assert.equal(melange.texte, 'Un texte avec du gras dedans')
          assert.deepEqual(balises.attrs, [])
          assert.ok(balises.calque && !balises.run)
          assert.equal(balises.copies, 2)
          assert.equal(balises.nom, 'mjs-fx-marquee')
          assert.deepEqual(balises.noeuds, ['#texte', 'a', '#texte', 'i', 'br', '#texte', 'code', '#texte', 'em', '#texte', 'strong', '#texte', 'span'], 'a, i, br, code, em, strong, span : un texte à balises en ligne reste un texte')
        })
      })

      // la piste (ou le calque) d'une balise : le type de la piste, si elle est posée, si le calque de texte l'est
      const etatPiste = (page: any, c: string) => page.evaluate((cl: string) => {
        const h = (window as any).__h(cl)
        return { type: h.getAttribute('mjs-fx-marquee-strip'), run: !!h.querySelector(':scope > [mjs-fx-marquee-run]'), calque: !!h.querySelector(':scope > [mjs-fx-layer="text"]') }
      }, c)

      it('la piste des enfants s\'ouvre pour des éléments seuls, ou quand drag le demande ; un texte à balises en ligne tiré à la main passe par la piste', async function () {
        if (!present) { this.skip(); return }
        await essai(false, async (page) => {
          assert.deepEqual(await etatPiste(page, 'seul'), { type: 'kids', run: true, calque: false }, 'que des éléments pour enfants : la piste')
          assert.deepEqual(await etatPiste(page, 'simple'), { type: 'kids', run: true, calque: false })
          assert.deepEqual(await etatPiste(page, 'melange-main'), { type: 'text', run: true, calque: false }, 'un texte à balises en ligne, tiré à la main : la main demande la piste')
        })
      })

      it('une balise en ligne qui arrive dans un texte après la pose : c\'est toujours un texte, le calque reste ; du texte nu parmi des éléments : un texte', async function () {
        if (!present) { this.skip(); return }
        await essai(false, async (page) => {
          const etat = (c: string) => etatPiste(page, c)
          // le calque d'avant : celui-là même reste (seul son contenu se refait), il n'est pas défait puis reposé
          await page.evaluate(() => { const w: any = window; w.__calque = w.__h('texte').querySelector(':scope > [mjs-fx-layer="text"]') })
          await page.evaluate(() => (window as any).__h('texte').insertAdjacentHTML('beforeend', ' et <b>du gras</b>'))
          await page.waitForTimeout(300)
          assert.deepEqual(await etat('texte'), { type: null, run: false, calque: true }, 'le texte garde son calque')
          assert.ok(await page.evaluate(() => { const w: any = window; return w.__calque.isConnected && w.__calque === w.__h('texte').querySelector(':scope > [mjs-fx-layer="text"]') }), 'le même calque : il n\'est ni défait ni reposé')
          const t = await page.evaluate(() => (window as any).__h('texte').querySelector('[mjs-fx-marquee-track]').children[0].textContent)
          assert.equal(t, 'Salut et du gras', 'le calque suit le texte')
          // des éléments seuls dans la piste, un texte nu qui arrive : le texte reprend le calque
          await page.evaluate(() => (window as any).__h('remplir').click())
          await page.waitForTimeout(300)
          assert.deepEqual(await etat('bascule'), { type: 'kids', run: true, calque: false })
          await page.evaluate(() => (window as any).__run('bascule').appendChild(document.createTextNode('du texte')))
          await page.waitForTimeout(300)
          assert.deepEqual(await etat('bascule'), { type: null, run: false, calque: true }, 'du texte nu parmi les éléments : un texte')
        })
      })

      it('un commentaire parmi des éléments n\'est pas du texte : la piste reste, et les copies ne le recopient pas', async function () {
        if (!present) { this.skip(); return }
        await essai(false, async (page) => {
          await page.evaluate(() => (window as any).__run('simple').appendChild(document.createComment('note')))
          await page.waitForTimeout(300)
          assert.deepEqual(await etatPiste(page, 'simple'), { type: 'kids', run: true, calque: false }, 'un commentaire parmi les éléments : la piste reste')
          const recopies = await page.evaluate(() => ((window as any).__copies('simple') as any[]).filter((x: any) => Array.from(x.childNodes).some((n: any) => n.nodeType === 8)).length)
          assert.equal(recopies, 0, 'et les copies ne recopient pas le commentaire')
        })
      })

      it('une balise vide, ou une liste vide, tirée à la main : rien à défiler, aucune copie n\'est posée ; les enfants qui arrivent ont leurs copies', async function () {
        if (!present) { this.skip(); return }
        await essai(false, async (page) => {
          const copies = (c: string) => page.evaluate((cl: string) => ((window as any).__copies(cl) as any[]).map((x: any) => x.querySelectorAll('.it').length), c)
          for (const c of ['vide', 'vide-colonne', 'vide-nappe', 'rempli']) assert.deepEqual(await copies(c), [], `rien à défiler dans ${c} : aucune copie`)
          await page.evaluate(() => (window as any).__h('garnir').click())
          await page.waitForTimeout(400)
          const l = await copies('rempli')
          assert.ok(l.length >= 1 && l.every((n: number) => n === 3), `les enfants qui arrivent sont recopiés : ${l}`)
          await page.evaluate(() => (window as any).__h('vider2').click())
          await page.waitForTimeout(400)
          assert.deepEqual(await copies('rempli'), [], 'la liste vidée : les copies repartent')
        })
      })

      it('une balise cachée (display: none) n\'a rien à couvrir : aucune copie ; montrée, elle reçoit ce qu\'il faut', async function () {
        if (!present) { this.skip(); return }
        await essai(false, async (page) => {
          const etat = () => page.evaluate(() => { const w: any = window; return { copies: w.__copies('cachee').length, tour: w.__tour('cachee'), attendu: Math.ceil(w.__h('cachee').clientWidth / w.__tour('cachee')) + 1 } })
          const a    = await etat()
          assert.equal(a.copies, 0, 'cachée : sans taille, rien à couvrir')
          await page.evaluate(() => { (window as any).__h('cachee').parentElement.style.display = 'block' })
          await page.waitForTimeout(400)
          const b = await etat()
          assert.equal(b.tour, 3 * 100 + 3 * 20, 'montrée : le tour est relu')
          assert.equal(b.copies, b.attendu, 'et les copies couvrent la balise : un tour de plus avec la main et la dérive')
          assert.equal(b.copies, 3)
        })
      })

      it('drag avec on: scroll : rien ne dérive, la main seule ramène la piste dans un tour — ce qu\'il faut pour couvrir, pas un tour de plus', async function () {
        if (!present) { this.skip(); return }
        await essai(false, async (page) => {
          await page.evaluate(() => (window as any).__h('defile-main').scrollIntoView({ block: 'center' }))
          await page.waitForTimeout(300)
          const etat = () => page.evaluate(() => { const w: any = window; return { copies: w.__copies('defile-main').length, tour: w.__tour('defile-main'), attendu: Math.ceil(w.__h('defile-main').clientWidth / w.__tour('defile-main')), anims: w.__run('defile-main').getAnimations().length } })
          const a    = await etat()
          assert.equal(a.tour, 3 * 100 + 3 * 20)
          assert.equal(a.anims, 0, 'au défilement, la piste n\'a pas de dérive')
          assert.equal(a.copies, a.attendu, 'ce qu\'il faut pour couvrir, pas plus : la main seule va jusqu\'à un tour')
          assert.equal(a.copies, 2)
          const c = await centre(page, 'defile-main')
          for (const d of [-505, 330]) {
            await tire(page, c.x, c.y, d, 0, 12)
            const trou = await page.evaluate(() => (window as any).__trous('defile-main', '.logo', 'x'))
            assert.ok(trou <= 20 + 1, `un vide de ${trou} px après un geste de ${d} px`)
          }
        })
      })

      it('drag : le clic qui suit un geste est avalé par la balise (rien ne le voit plus haut) ; un clic sans geste, avant comme après, passe', async function () {
        if (!present) { this.skip(); return }
        await essai(false, async (page) => {
          const clics = () => page.evaluate(() => (window as any).__clics)
          const c     = await centre(page, 'logos')
          await page.mouse.click(c.x, c.y)
          await page.waitForTimeout(80)
          assert.equal(await clics(), 1, 'un clic sans geste arrive jusqu\'à la fenêtre')
          await tire(page, c.x, c.y, -60, 0, 6)
          await page.waitForTimeout(80)
          assert.equal(await clics(), 1, 'le clic qui suit un geste est avalé')
          await page.mouse.click(c.x, c.y)
          await page.waitForTimeout(80)
          assert.equal(await clics(), 2, 'et le clic d\'après, sans geste, passe de nouveau')
        })
      })

      it('off() pendant un geste : les écouteurs posés sur la fenêtre pour le geste sont retirés, la piste retirée ne bouge plus', async function () {
        if (!present) { this.skip(); return }
        await essai(false, async (page) => {
          // les écouteurs de geste de la fenêtre, comptés par type (la page en a d'autres, posés avant et hors de la balise)
          const gestes = () => page.evaluate(() => { const n: any = {}; for (const x of (window as any).__ecoute as any[]) { if (/^(pointermove|pointerup|pointercancel|lostpointercapture)$/.test(x[0])) n[x[0]] = (n[x[0]] || 0) + 1 } return n })
          const c      = await centre(page, 'clic')
          const repos  = await gestes()
          await page.mouse.move(c.x, c.y)
          await page.mouse.down()
          await page.mouse.move(c.x - 60, c.y, { steps: 6 })
          const tenu = await gestes()
          for (const t of ['pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) assert.equal(tenu[t] || 0, (repos[t] || 0) + 1, `pendant le geste : ${t} posé par la balise`)
          // la balise se défait, la main tient encore
          const avant = await page.evaluate(() => { const w: any = window; const run = w.__run('clic'); w.__garde = run; w.__h('clic')._mjs_fxOff.marquee(); return run.style.translate })
          assert.deepEqual(await gestes(), repos, 'le retrait rend ce que le geste avait posé')
          await page.mouse.move(c.x - 140, c.y, { steps: 6 })
          await page.mouse.up()
          await page.waitForTimeout(200)
          const apres = await page.evaluate(() => { const w: any = window; return { translate: w.__garde.style.translate, marques: w.__h('clic').getAttributeNames().filter((a: string) => a.startsWith('mjs-fx') || (a === 'style' && w.__h('clic').getAttribute('style') !== '')) } })
          assert.equal(apres.translate, avant, 'la piste retirée ne bouge plus')
          assert.deepEqual(apres.marques, [], 'rien n\'est reposé sur la balise')
          assert.deepEqual(await gestes(), repos)
        })
      })

      it('on: scroll : le défilement se lit à l\'évènement de défilement, jamais dans une image d\'animation (deux colonnes voisines ne se forcent pas un recalcul de style)', async function () {
        if (!present) { this.skip(); return }
        await essai(false, async (page) => {
          await page.evaluate(LECTURES_DANS_IMAGE)
          for (const y of [60, 140, 220, 300, 380, 300, 200, 100, 0]) {
            await page.evaluate((v: number) => {
              (window as any).__h('scene').scrollTop = v
              return new Promise<void>((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok())))
            }, y)
          }
          await page.waitForTimeout(150)
          const lectures = await page.evaluate(() => (window as any).__lect)
          assert.deepEqual(lectures, [], `lectures dans les images d'animation : ${lectures.join(', ')}`)
          // la piste a bien suivi : revenue en haut, elle est revenue à zéro
          const t = await page.evaluate(() => (window as any).__tr('c1'))
          assert.deepEqual([t.x, t.y], [0, 0], 'revenue en haut du défilement, la piste est revenue à sa place')
        })
      })

      it('on: scroll : le défilement de la PAGE entraîne la piste, et sa position se lit au plus une fois par évènement (le document la reçoit en capture, la fenêtre n\'écoute pas)', async function () {
        if (!present) { this.skip(); return }
        await essai(false, async (page) => {
          await page.evaluate(() => (window as any).__h('hscene').scrollIntoView())
          // un tour pour 1 000 px de défilement (`speed: 10s`), la colonne monte quand la page descend et redescend quand elle remonte : la place que la page donne à la piste
          const tour = await page.evaluate(() => (window as any).__tour('hcol'))
          const sur  = (haut: number) => { const m = (-haut / 1000 * tour) % tour; return m > 0 ? m - tour : m }
          const suit = (haut: number) => page.waitForFunction(([y]: number[]) => Math.abs((window as any).__tr('hcol').y - y) <= 0.6, [sur(haut)], { timeout: 30000 }).then(() => true, () => false)
          // la balise écoute quand sa piste a pris cette place (état observable, pas un délai ; une place à zéro ne prouverait rien : la piste y est avant d'écouter)
          const depart = await page.evaluate(() => window.scrollY)
          assert.ok(Math.abs(sur(depart)) > 1, `la place de départ n'est pas zéro : ${sur(depart)}`)
          assert.ok(await suit(depart), `la piste a pris la place que la page lui donne (${sur(depart)}) : ${await page.evaluate(() => (window as any).__tr('hcol').y)}`)
          // la position de la page lue PENDANT le traitement d'un évènement de défilement, par évènement (`window.event` : l'évènement en cours, et rien hors de lui)
          await page.evaluate(() => {
            const w: any = window
            // les autres balises qui suivent le défilement (deux colonnes, la bande tirée) sont retirées : chacune lit la position une fois, la garde compte celles de `hcol` seule
            for (const c of ['c1', 'c2', 'defile-main']) w.__h(c)._mjs_fxOff.marquee()
            w.__lues = new Map()
            w.__evs  = 0
            const d = Object.getOwnPropertyDescriptor(w, 'pageYOffset') as PropertyDescriptor
            Object.defineProperty(w, 'pageYOffset', { configurable: true, enumerable: d.enumerable, set: d.set, get() { const e = w.event; if (e && e.type === 'scroll') w.__lues.set(e, (w.__lues.get(e) || 0) + 1); return (d.get as () => number).call(this) } })
            w.addEventListener('scroll', () => { w.__evs++ })
          })
          // la page remonte par pas de 30 px (arrivée en bas de page, elle ne peut plus descendre), chaque pas laisse passer deux images
          for (let i = 0; i < 6; i++) await page.evaluate(() => { window.scrollBy(0, -30); return new Promise<void>((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok()))) })
          const fait = await page.evaluate(() => window.scrollY)
          assert.ok(depart - fait >= 150, `la page a défilé : ${fait - depart} px`)
          assert.ok(await suit(fait), `la piste a suivi la page : ${await page.evaluate(() => (window as any).__tr('hcol').y)} au lieu de ${sur(fait)}`)
          const r = await page.evaluate(() => { const w: any = window; return { evs: w.__evs, lues: [...w.__lues.values()] as number[] } })
          assert.ok(r.evs >= 4, `la page a défilé : ${r.evs} évènements`)
          // la garde n'est pas muette : la piste a bien lu la position pendant des évènements de défilement
          assert.ok(r.lues.length >= 4, `la piste a lu la position pendant ${r.lues.length} évènements sur ${r.evs}`)
          assert.ok(Math.max(...r.lues) <= 1, `la position de la page est lue ${Math.max(...r.lues)} fois dans un même évènement (lectures par évènement : ${r.lues.join(', ')})`)
        })
      })

      it('on: scroll : à l\'arrivée la piste prend sa place sans être promue (aucun will-change) ; seul un défilement la promeut', async function () {
        if (!present) { this.skip(); return }
        await essai(false, async (page) => {
          // l'observateur de visibilité a répondu pour la scène du bas : elle est hors écran, la marque de suspension est posée (avant son premier avis, que la charge retarde,
          // la balise se croit à l'écran : un défilement la promeut alors déjà, et son arrivée n'en est pas une)
          await page.waitForFunction(() => (window as any).__h('hcol').hasAttribute('mjs-fx-marquee-away'), undefined, { timeout: 30000 })
          // la scène du bas est hors écran : rien n'est posé ; la page la ramène à l'écran, la piste se relit et se pose d'un coup
          // les valeurs de will-change sont relevées dès avant l'arrivée : une promotion, même brève, ne passe pas entre deux lectures
          await page.evaluate(() => {
            const w: any = window
            const piste  = w.__run('hcol')
            w.__arrivee  = []
            new MutationObserver(() => { const v = piste.style.willChange; if (w.__arrivee[w.__arrivee.length - 1] !== v) w.__arrivee.push(v) }).observe(piste, { attributes: true, attributeFilter: ['style'] })
            w.__h('hscene').scrollIntoView()
          })
          // la piste a pris sa place quand la balise est à l'écran et sa translation n'est plus nulle : un état observable, pas un délai (l'observateur de visibilité répond
          // après la mise en page, et son premier avis vient tard sur une machine chargée)
          const prise = await page.waitForFunction(() => { const w: any = window; return !w.__h('hcol').hasAttribute('mjs-fx-marquee-away') && w.__tr('hcol').y < 0 }, undefined, { timeout: 30000 }).then(() => true, () => false)
          const tr = await page.evaluate(() => (window as any).__tr('hcol').y)
          assert.ok(prise, `la piste a pris la place que le défilement de la page lui donne : ${tr}`)
          // six images de plus (de l'ordre des 100 ms que laissait l'attente fixe) : une promotion demandée à l'arrivée aurait eu lieu
          await page.evaluate(() => new Promise<void>((ok) => { let n = 6; const f: FrameRequestCallback = () => (--n ? requestAnimationFrame(f) : ok()); requestAnimationFrame(f) }))
          assert.equal(await page.evaluate(() => (window as any).__run('hcol').style.willChange), '', 'arrivée sans mouvement : pas de calque promu pour rien')
          assert.deepEqual((await page.evaluate(() => (window as any).__arrivee)).filter((v: string) => v !== ''), [], 'arrivée sans mouvement : will-change n\'a jamais été posé')
          // un défilement de la boîte la promeut, puis elle est rendue : les valeurs de will-change sont relevées au fil de l'eau (un navigateur qui livre
          // l'évènement une image plus tard, ou une machine chargée, ne fait pas manquer la fenêtre où il est posé)
          await page.evaluate(() => {
            const w: any = window
            const piste  = w.__run('hcol')
            w.__wc       = []
            new MutationObserver(() => { const v = piste.style.willChange; if (w.__wc[w.__wc.length - 1] !== v) w.__wc.push(v) }).observe(piste, { attributes: true, attributeFilter: ['style'] })
            w.__h('hscene').scrollTop = 200
          })
          const posee = await page.waitForFunction(() => (window as any).__wc.includes('translate'), undefined, { timeout: 15000 }).then(() => true, () => false)
          assert.ok(posee, 'en mouvement : will-change posé')
          await page.waitForFunction(() => (window as any).__run('hcol').style.willChange === '', undefined, { timeout: 15000 })
        })
      })

      it('texte seul : hors écran la dérive CSS est suspendue, à l\'écran elle court (le calque comme la piste des enfants) ; le retrait ne laisse rien', async function () {
        if (!present) { this.skip(); return }
        await essai(false, async (page) => {
          await page.waitForTimeout(300)
          const etat = () => page.evaluate(() => {
            const h = (window as any).__h('melange')
            const anims = Array.from(h.querySelectorAll('[mjs-fx-marquee-track], [mjs-fx-marquee-track] > span + span')).flatMap((p: any) => p.getAnimations().map((a: any) => a.playState))
            return { away: h.hasAttribute('mjs-fx-marquee-away'), anims }
          })
          // l'observateur de visibilité répond après la mise en page : on attend sa réponse (une machine chargée la retarde)
          await page.waitForFunction(() => (window as any).__h('melange').hasAttribute('mjs-fx-marquee-away'), undefined, { timeout: 30000 })
          assert.deepEqual(await etat(), { away: true, anims: ['paused', 'paused'] }, 'hors écran : la piste et sa seconde copie sont suspendues')
          // le retrait d'un texte resté hors écran (`balises`, pour garder `melange` en vie) : la marque de suspension part avec le calque
          await page.waitForFunction(() => (window as any).__h('balises').hasAttribute('mjs-fx-marquee-away'), undefined, { timeout: 30000 })
          const retrait = await page.evaluate(() => {
            const h: any = (window as any).__h('balises')
            const avant  = h.hasAttribute('mjs-fx-marquee-away')
            h._mjs_fxOff.marquee()
            return { avant, calque: h.querySelectorAll('[mjs-fx-layer], [mjs-fx-marquee-track]').length, marques: h.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx') || (a === 'style' && h.getAttribute('style') !== '')) }
          })
          assert.deepEqual(retrait, { avant: true, calque: 0, marques: [] }, 'le retrait ne laisse rien sur la balise : ni calque, ni marque (celle de la suspension comprise), ni style')
          await page.evaluate(() => (window as any).__h('melange').scrollIntoView())
          await page.waitForFunction(() => !(window as any).__h('melange').hasAttribute('mjs-fx-marquee-away'), undefined, { timeout: 30000 })
          assert.deepEqual(await etat(), { away: false, anims: ['running', 'running'] }, 'à l\'écran : elles courent')
        })
      })

      it('nappe : ce que le geste promeut retombe quand l\'élan est fini (will-change rendu, plus aucun calque de la piste ni de ses copies)', async function () {
        if (nom !== 'chromium' || !present) { this.skip(); return }
        await essai(false, async (page) => {
          // les calques de Chromium (domaine LayerTree) qui portent la piste ou une copie de la nappe ; la sonde se prouve d'abord sur un cas connu : pendant le geste il y en a
          const cdp = await page.context().newCDPSession(page)
          const compte = async (): Promise<number> => {
            let calques: any[] | null = null
            cdp.on('LayerTree.layerTreeDidChange', (ev: any) => { calques = ev.layers || calques })
            await cdp.send('LayerTree.enable')
            await page.evaluate(() => { const d = document.createElement('div'); d.id = '__sonde'; d.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:1px;background:#fff'; document.body.appendChild(d) })
            for (let i = 0; i < 20 && !calques; i++) await page.waitForTimeout(100)
            await page.waitForTimeout(150)
            await cdp.send('DOM.enable')
            let n = 0
            for (const l of calques ?? []) {
              if (!l.backendNodeId || !l.drawsContent) continue
              const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: l.backendNodeId })
              const r = await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: 'function() { return !!this.closest && !!this.closest(".nappe") && (this.hasAttribute("mjs-fx-marquee-run") || this.hasAttribute("mjs-fx-marquee-copy")) }', returnByValue: true })
              if (r.result.value) n++
            }
            await page.evaluate(() => document.getElementById('__sonde')?.remove())
            await cdp.send('LayerTree.disable')
            return n
          }
          assert.equal(await compte(), 0, 'au repos : aucun calque de la nappe')
          const c = await centre(page, 'nappe')
          await page.mouse.move(c.x, c.y)
          await page.mouse.down()
          await page.mouse.move(c.x - 120, c.y + 40, { steps: 8 })
          await page.waitForTimeout(100)
          assert.equal(await page.evaluate(() => (window as any).__run('nappe').style.willChange), 'translate', 'pendant le geste : will-change posé')
          assert.ok(await compte() >= 1, 'pendant le geste : la piste est un calque (la sonde voit ce qu\'elle doit voir)')
          await page.mouse.up()
          await page.waitForFunction(() => (window as any).__run('nappe').style.willChange === '', undefined, { timeout: 15000 })
          await page.waitForTimeout(300)
          assert.equal(await compte(), 0, 'élan fini : plus aucun calque de la nappe')
        })
      })

      it('aucune erreur de page, et la mesure ne boucle pas (observateur de taille)', async function () {
        if (!present) { this.skip(); return }
        const page = await browser.newPage({ viewport: { width: 800, height: 900 } })
        const erreurs: string[] = []
        page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e)))
        page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push(m.text()) })
        await page.addInitScript(HOTE)
        await page.route('http://t.test/**', (route: any) => route.request().url() !== 'http://t.test/' ? route.fulfill({ status: 404, body: '' }) : route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><mjs-vm-page></mjs-vm-page><script>${scripts}</script></body></html>` }))
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(() => !!(document.querySelector('mjs-vm-page') as any)?._shadow?.querySelector('.logos > [mjs-fx-marquee-run]'))
        await page.setViewportSize({ width: 500, height: 900 })
        await page.waitForTimeout(300)
        await page.setViewportSize({ width: 900, height: 700 })
        await page.waitForTimeout(300)
        await page.close()
        assert.deepEqual(erreurs, [])
      })
    })
  }
})
