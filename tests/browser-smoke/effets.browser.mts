// BANC navigateur RÉEL des effets et des modules cœur dont le défaut ne se voit qu'à l'écran
// (Chromium + Firefox + WebKit quand il est installé, via playwright, PAS @playwright/test) — hors de `npm test` (extension
// `.mts`, cf. smoke.browser.mts), lancé par `npm run test:browser`. happy-dom ne calcule aucune mise
// en page : un nombre qui passe à la ligne, une poussière restée sur place au défilement, une icône
// hors de son anneau n'y existent pas. Cas joués, en build de dev puis de prod :
//   - *count avec un séparateur, un suffixe : le nombre tient sur une ligne, dans sa balise, sans
//     mordre sur le texte qui suit (la balise ne gardait que la largeur du nombre brut `12480`) ;
//   - *dissolve : la poussière suit le texte quand la page défile (elle restait à sa place à
//     l'écran) ;
//   - *stagger(on: scroll, zone: …) : la bande de l'écran où l'effet se joue ; sans `zone`, la
//     course d'origine (du bas de l'écran au milieu) ;
//   - <@@menu> rond, comme sa démo : les icônes au milieu de l'anneau blanc, la première à gauche,
//     cerclées au survol, cachées SUR PLACE à la fermeture ;
//   - <@@menu layout="drawer"> et <@@tabs layout="curve"> fermés : les icônes seules, les libellés
//     hors du bord.
//
// Shadow DOM fermé (mjs_element.ts) : accès par la propriété interne `_shadow`, comme partout dans
// tests/. Serveur statique minimal maison, comme transitions.browser.mts.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, rmSync, copyFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, firefox, webkit } from 'playwright'
import { assertDistFrais } from '../helpers/dist-frais.js'

// Chromium et Firefox toujours ; WebKit quand il est installé (`npx playwright install webkit`)
const MOTEURS        = [chromium, firefox, ...(existsSync(webkit.executablePath()) ? [webkit] : [])]
const __dirname      = dirname(fileURLToPath(import.meta.url))
const MODULARJS_ROOT = join(__dirname, '..', '..')
const FIXTURE_DIR    = join(__dirname, 'fixture-effets')
const OUT_DIR        = join(FIXTURE_DIR, 'sortie')
const BIN_MJS        = join(MODULARJS_ROOT, 'bin', 'mjs')
const HOST           = 'mjs-effets-cas'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.map': 'application/json',
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const srv = createServer()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = addr && typeof addr === 'object' ? addr.port : 0
      srv.close(() => resolvePort(port))
    })
  })
}

// serveur statique minimal sur FIXTURE_DIR — `/sortie/index.html`, `/sortie/bundle.js`, fichiers hachés
function serveFixture(port: number): Promise<any> {
  const server = createServer((req, res) => {
    const url  = new URL(req.url || '/', 'http://x')
    const rel  = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '')
    const file = join(FIXTURE_DIR, rel)
    if (!file.startsWith(FIXTURE_DIR) || !existsSync(file) || !statSync(file).isFile()) { res.statusCode = 404; res.end('absent'); return }
    res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream')
    res.setHeader('Cache-Control', 'no-store')
    createReadStream(file).pipe(res)
  })
  return new Promise((resolveSrv, reject) => {
    server.on('error', reject)
    server.listen(port, '127.0.0.1', () => resolveSrv(server))
  })
}

function buildFixture(mode: 'dev' | 'prod'): void {
  rmSync(OUT_DIR, { recursive: true, force: true })
  const r = spawnSync(process.execPath, [BIN_MJS, 'build', '--root', FIXTURE_DIR, mode === 'prod' ? '--prod' : '--dev'], { encoding: 'utf-8', timeout: 120000 })
  assert.equal(r.status, 0, `mjs build --${mode} en échec :\n${r.stdout}\n${r.stderr}`)
  assert.ok(existsSync(join(OUT_DIR, 'bundle.js')), `bundle.js absent après mjs build --${mode}`)
  mkdirSync(OUT_DIR, { recursive: true })
  copyFileSync(join(FIXTURE_DIR, 'index.html'), join(OUT_DIR, 'index.html'))
}

describe('banc navigateur réel : effets et modules cœur à l\'écran (dev + prod)', function () {
  this.timeout(600000)

  let server: any = null
  let port = 0

  before(async function () {
    assertDistFrais(MODULARJS_ROOT)
    port   = await freePort()
    server = await serveFixture(port)
  })

  after(async function () {
    if (server) await new Promise<void>((r) => server.close(() => r()))
    rmSync(OUT_DIR, { recursive: true, force: true })
  })

  for (const mode of ['dev', 'prod'] as const) {
    describe(`build ${mode}`, function () {
      before(function () { buildFixture(mode) })

      for (const engine of MOTEURS) {
        describe(`moteur ${engine.name()}`, function () {
          let browser: any = null
          let page: any = null
          const consoleIssues: string[] = []

          before(async function () {
            browser = await engine.launch()
            page    = await browser.newPage({ viewport: { width: 1280, height: 720 } })
            await page.addInitScript(() => { (window as any).__root = (el: any) => el._shadow || el.shadowRoot })
            page.on('console', (m: any) => { if (m.type() === 'error') consoleIssues.push(`[${engine.name()}/${mode}] console.error: ${m.text()}`) })
            page.on('pageerror', (e: any) => { consoleIssues.push(`[${engine.name()}/${mode}] pageerror: ${e.message}`) })
            await page.goto(`http://127.0.0.1:${port}/sortie/index.html`, { waitUntil: 'load' })
            await page.waitForFunction((host: string) => {
              const el: any = document.querySelector(host)
              const sh = el && (el._shadow || el.shadowRoot)
              const m: any = sh && sh.querySelector('#rond')
              return !!(m && (m._shadow || m.shadowRoot) && sh.querySelector('#compte-tiret [mjs-fx-layer]'))
            }, HOST, { timeout: 30000 })
          })

          after(async function () {
            if (browser) await browser.close()
          })

          const pause = (ms: number) => page.waitForTimeout(ms)
          const attendre = async (pred: () => Promise<boolean>, ms: number, quoi: string) => {
            const fin = Date.now() + ms
            while (Date.now() < fin) { if (await pred()) return; await page.waitForTimeout(40) }
            assert.fail(`délai dépassé (${ms} ms) : ${quoi}`)
          }
          const enHaut = async () => {
            await page.mouse.move(1, 1)
            await page.evaluate(() => window.scrollTo(0, 0))
            await pause(80)
          }

          it('*count : séparateur et suffixe — le nombre sur une ligne, dans sa balise, sans mordre sur la suite', async function () {
            await enHaut()
            const textes = () => page.evaluate((host: string) => {
              const sh: any = (window as any).__root(document.querySelector(host))
              return ['#compte-tiret', '#compte-suffixe', '#compte-ligne'].map((s) => sh.querySelector(s + ' [mjs-fx-layer="text"]')?.textContent).join('|')
            }, HOST)
            await attendre(async () => (await textes()) === '12-480|12.480 €|12-480 €', 3000, 'les nombres comptés jusqu\'à 12480')
            const m = await page.evaluate((host: string) => {
              const sh: any = (window as any).__root(document.querySelector(host))
              const out: any = {}
              for (const id of ['compte-tiret', 'compte-suffixe', 'compte-ligne']) {
                const el    = sh.querySelector('#' + id)
                const l     = el.querySelector('[mjs-fx-layer="text"]')
                const r     = document.createRange()
                r.selectNodeContents(l)
                const t     = r.getBoundingClientRect()
                const b     = el.getBoundingClientRect()
                const cs    = getComputedStyle(el)
                const lines = new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size
                out[id] = { texte: l.textContent, lines, left: t.left, right: t.right, boxLeft: b.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft), boxRight: b.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight) }
              }
              const suite = sh.querySelector('#phrase').lastChild
              const r2    = document.createRange()
              r2.setStart(suite, 1)
              r2.setEnd(suite, suite.length)
              out.suite = r2.getBoundingClientRect().left
              return out
            }, HOST)
            for (const id of ['compte-tiret', 'compte-suffixe', 'compte-ligne']) {
              const x = m[id]
              assert.equal(x.lines, 1, `${id} : « ${x.texte} » s'affiche sur ${x.lines} lignes`)
              assert.ok(x.left >= x.boxLeft - 0.5 && x.right <= x.boxRight + 0.5, `${id} : « ${x.texte} » (${x.left.toFixed(1)} → ${x.right.toFixed(1)}) déborde de sa balise (${x.boxLeft.toFixed(1)} → ${x.boxRight.toFixed(1)})`)
            }
            assert.ok(m.suite >= m['compte-ligne'].right - 0.5, `le nombre (fin ${m['compte-ligne'].right.toFixed(1)}) mord sur « clients » (début ${m.suite.toFixed(1)})`)
          })

          it('*dissolve : la poussière suit le texte quand la page défile', async function () {
            await enHaut()
            // le milieu vertical des pixels de poussière peints, et celui de la balise, à l'écran
            const mesure = () => page.evaluate((host: string) => {
              const sh: any = (window as any).__root(document.querySelector(host))
              const el      = sh.querySelector('#poussiere')
              const c: any  = document.querySelector('canvas[mjs-fx-dissolve-dust]')
              const r       = el.getBoundingClientRect()
              if (!c) return { n: 0, dust: 0, el: r.top + r.height / 2 }
              const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
              let n = 0
              let sy = 0
              for (let i = 3; i < px.length; i += 4) {
                if (px[i] === 0) continue
                n++
                sy += Math.floor((i >> 2) / c.width)
              }
              return { n, dust: n ? sy / n : 0, el: r.top + r.height / 2 }
            }, HOST)
            await attendre(async () => (await mesure()).n > 300, 4000, 'de la poussière peinte')
            const avant = await mesure()
            await page.evaluate(() => window.scrollBy(0, 150))
            await pause(120)
            const apres = await mesure()
            const dEl   = apres.el - avant.el
            const dDust = apres.dust - avant.dust
            assert.ok(Math.abs(dEl + 150) < 2, `la page n'a pas défilé de 150 px (balise : ${dEl.toFixed(1)})`)
            assert.ok(Math.abs(dDust - dEl) < 40, `poussière restée sur place : la balise a bougé de ${dEl.toFixed(1)} px, la poussière de ${dDust.toFixed(1)} px`)
          })

          it('<@@menu> rond : ouvert, les icônes au milieu de l\'anneau blanc, la première à gauche, cerclées au survol ; fermé, cachées sur place', async function () {
            await enHaut()
            const geo = () => page.evaluate((host: string) => {
              const sh: any = (window as any).__root(document.querySelector(host))
              const m       = sh.querySelector('#rond')
              const t       = (window as any).__root(m).querySelector('.toggle')
              const tr      = t.getBoundingClientRect()
              const cx      = tr.left + tr.width / 2
              const cy      = tr.top + tr.height / 2
              const spreads = [...getComputedStyle(t).boxShadow.matchAll(/(-?[\d.]+)px (-?[\d.]+)px (-?[\d.]+)px (-?[\d.]+)px/g)].map((x) => Number(x[4]))
              const items   = [...m.children].map((a: any) => {
                const r = a.getBoundingClientRect()
                return { x: r.left + r.width / 2 - cx, y: r.top + r.height / 2 - cy, px: r.left + r.width / 2, py: r.top + r.height / 2, visibility: getComputedStyle(a).visibility }
              })
              // le rayon du bouton par sa largeur de mise en page : ouvert, il est tourné de 315°, et sa
              // boîte à l'écran grandit d'autant
              return { radius: t.offsetWidth / 2, spreads, items }
            }, HOST)
            const bascule = () => page.evaluate((host: string) => {
              const sh: any = (window as any).__root(document.querySelector(host))
              ;(window as any).__root(sh.querySelector('#rond')).querySelector('.toggle').click()
            }, HOST)
            await bascule()
            await pause(800)
            const ouvert = await geo()
            assert.equal(ouvert.spreads.length, 2, `deux anneaux attendus dans l'ombre du bouton : ${JSON.stringify(ouvert.spreads)}`)
            // l'anneau blanc va du bord de l'anneau sombre au sien : son milieu, depuis le centre
            const milieu = ouvert.radius + (ouvert.spreads[0] + ouvert.spreads[1]) / 2
            const dist   = ouvert.items.map((i: any) => Math.hypot(i.x, i.y))
            for (const [k, d] of dist.entries()) assert.ok(Math.abs(d - milieu) <= 1.5, `icône ${k} à ${d.toFixed(1)} px du centre, l'anneau blanc a son milieu à ${milieu.toFixed(1)} px`)
            assert.ok(ouvert.items[0].x < 0 && Math.abs(ouvert.items[0].y) < 2, `la première icône doit être à gauche du bouton (${ouvert.items[0].x.toFixed(1)}, ${ouvert.items[0].y.toFixed(1)})`)
            await page.mouse.move(ouvert.items[1].px, ouvert.items[1].py)
            await pause(100)
            const bord = await page.evaluate((host: string) => {
              const sh: any = (window as any).__root(document.querySelector(host))
              return getComputedStyle(sh.querySelector('#rond').children[1]).borderTopWidth
            }, HOST)
            assert.equal(bord, '2px', 'l\'icône survolée est cerclée de 2 px, comme dans la démo')
            await page.mouse.move(1, 1)
            await bascule()
            await pause(800)
            const ferme = await geo()
            for (const [k, i] of ferme.items.entries()) {
              assert.ok(Math.abs(Math.hypot(i.x, i.y) - milieu) <= 1.5, `fermé, l'icône ${k} doit rester à sa place (à ${Math.hypot(i.x, i.y).toFixed(1)} px du centre au lieu de ${milieu.toFixed(1)})`)
              assert.equal(i.visibility, 'hidden', `fermé, l'icône ${k} doit être cachée`)
            }
          })

          it('<@@menu layout="drawer"> : fermé, les icônes seules ; ouvert, les libellés', async function () {
            await enHaut()
            const tiroir = () => page.evaluate((host: string) => {
              const sh: any = (window as any).__root(document.querySelector(host))
              const m       = sh.querySelector('#tiroir')
              const p       = (window as any).__root(m).querySelector('.panel').getBoundingClientRect()
              const items   = [...m.children].map((a: any) => {
                const r = document.createRange()
                r.selectNodeContents(a.lastChild)
                const t = r.getBoundingClientRect()
                const b = a.querySelector('b')
                const i = b ? b.getBoundingClientRect() : null
                return { texte: a.lastChild.textContent, left: t.left, right: t.right, icon: i ? i.left + i.width / 2 : null }
              })
              return { left: p.left, right: p.right, items }
            }, HOST)
            const ferme = await tiroir()
            assert.ok(Math.abs(ferme.right - ferme.left - 80) < 1, `fermé, le tiroir fait 80 px (${(ferme.right - ferme.left).toFixed(1)})`)
            for (const i of ferme.items) assert.ok(i.left >= ferme.right - 0.5, `fermé, le libellé « ${i.texte} » se voit (début ${i.left.toFixed(1)}, bord ${ferme.right.toFixed(1)})`)
            const icone = ferme.items[2].icon
            assert.ok(Math.abs(icone - (ferme.left + 40)) <= 4, `l'icône (<b>) centrée dans sa pastille de 60 px : ${(icone - ferme.left).toFixed(1)} px du bord au lieu de 40`)
            await page.evaluate((host: string) => {
              const sh: any = (window as any).__root(document.querySelector(host))
              ;(window as any).__root(sh.querySelector('#tiroir')).querySelector('.tab').click()
            }, HOST)
            await pause(800)
            const ouvert = await tiroir()
            for (const i of ouvert.items) assert.ok(i.right <= ouvert.right + 0.5 && i.left >= ouvert.left, `ouvert, le libellé « ${i.texte} » doit se voir en entier`)
          })

          it('<@@tabs layout="curve"> au repos : les icônes seules', async function () {
            await enHaut()
            const m = await page.evaluate((host: string) => {
              const sh: any = (window as any).__root(document.querySelector(host))
              const t       = sh.querySelector('#courbe')
              const box     = (window as any).__root(t).querySelector('.tabs').getBoundingClientRect()
              return { right: box.right, items: [...t.children].map((a: any) => {
                const r = document.createRange()
                r.selectNodeContents(a.lastChild)
                return { texte: a.lastChild.textContent, left: r.getBoundingClientRect().left }
              }) }
            }, HOST)
            for (const i of m.items) assert.ok(i.left >= m.right - 0.5, `au repos, le libellé « ${i.texte} » se voit (début ${i.left.toFixed(1)}, bord ${m.right.toFixed(1)})`)
          })

          it('*stagger(on: scroll, zone: 60% 40%) : rien quand le haut de la balise est à 70 % de l\'écran, la moitié à 50 %, tout à 35 %', async function () {
            await enHaut()
            const place = (id: string, frac: number) => page.evaluate(([host, id, frac]: [string, string, number]) => {
              const sh: any = (window as any).__root(document.querySelector(host))
              window.scrollBy(0, sh.querySelector('#' + id).getBoundingClientRect().top - frac * window.innerHeight)
            }, [HOST, id, frac])
            const mots = (id: string) => page.evaluate(([host, id]: [string, string]) => {
              const sh: any = (window as any).__root(document.querySelector(host))
              const el      = sh.querySelector('#' + id)
              return { p: Number(el.querySelector('[mjs-fx-word]').style.getPropertyValue('--mjs-fx-stagger-p')), vus: [...el.querySelectorAll('[mjs-fx-word]')].map((w: any) => Number(getComputedStyle(w).opacity)) }
            }, [HOST, id])
            await place('mots-zone', 0.7)
            await pause(120)
            let e = await mots('mots-zone')
            assert.equal(e.p, 0, `à 70 % : avancée ${e.p}`)
            assert.ok(e.vus.every((o: number) => o < 0.05), `à 70 %, aucun mot ne doit se voir : ${e.vus}`)
            await place('mots-zone', 0.5)
            await pause(120)
            e = await mots('mots-zone')
            assert.ok(Math.abs(e.p - 0.5) < 0.02, `à 50 % : avancée ${e.p}, 0.5 attendu`)
            await place('mots-zone', 0.35)
            await pause(120)
            e = await mots('mots-zone')
            assert.equal(e.p, 1, `à 35 % : avancée ${e.p}`)
            assert.ok(e.vus.every((o: number) => o > 0.95), `à 35 %, tous les mots doivent se voir : ${e.vus}`)
          })

          it('*stagger(on: scroll) sans zone : du bas de l\'écran au milieu, comme avant', async function () {
            await enHaut()
            const etat = (frac: number) => page.evaluate(([host, frac]: [string, number]) => {
              const sh: any = (window as any).__root(document.querySelector(host))
              const el      = sh.querySelector('#mots-defaut')
              const r       = el.getBoundingClientRect()
              window.scrollBy(0, r.top + r.height / 2 - frac * window.innerHeight)
              return new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok(Number(el.querySelector('[mjs-fx-word]').style.getPropertyValue('--mjs-fx-stagger-p'))))))
            }, [HOST, frac])
            // l'avancée est arrondie au millième et le défilement tombe où le moteur le pose (WebKit : 0.999 pour un pixel de moins) : tout est arrivé à un millième près
            assert.ok(Math.abs(await etat(0.5) - 1) < 0.005, 'le milieu de la balise au milieu de l\'écran : tout est arrivé')
            const bas = await etat(1.02)
            assert.ok(bas < 0.1, `la balise à peine entrée par le bas : avancée ${bas}`)
          })

          it('*cycle (cadre) : hors du cadre, le mot ne se dessine pas ; `outside: hollow` le montre en creux, `outside: visible` plein', async function () {
            await enHaut()
            const m = await page.evaluate((host: string) => {
              const sh: any = (window as any).__root(document.querySelector(host))
              const vu      = (id: string) => {
                const cs: any = getComputedStyle(sh.querySelector('#' + id + ' [mjs-fx-cycle-word]'))
                return { contour: cs.webkitTextStrokeWidth, plein: cs.webkitTextFillColor }
              }
              return { cadre: vu('cadre'), creux: vu('creux'), plein: vu('plein') }
            }, HOST)
            assert.equal(m.cadre.contour, '0px', 'hidden (défaut), le mot hors du cadre n\'a pas de contour')
            assert.equal(m.cadre.plein, 'rgba(0, 0, 0, 0)', 'hidden (défaut), le mot hors du cadre est transparent')
            assert.equal(m.creux.contour, '1px', 'hollow : le mot en creux, contour de 1 px')
            assert.equal(m.plein.contour, '0px', 'visible : pas de contour')
            assert.notEqual(m.plein.plein, 'rgba(0, 0, 0, 0)', 'visible : le mot plein, hors du cadre aussi')
          })

          it('*stagger au défilement, texte collé dans une section (le « Text Reveal » de Magic UI) : un mot après l\'autre, ceux à venir en gris, le texte reste en place', async function () {
            await enHaut()
            // la section défile de `dy` au-delà du haut de l'écran
            const aller = (dy: number) => page.evaluate(([host, dy]: [string, number]) => {
              const sh: any = (window as any).__root(document.querySelector(host))
              window.scrollBy(0, sh.querySelector('#lecture').getBoundingClientRect().top + dy)
              return new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)))
            }, [HOST, dy])
            const etat = () => page.evaluate((host: string) => {
              const sh: any = (window as any).__root(document.querySelector(host))
              const el      = sh.querySelector('#lu')
              return { top: el.getBoundingClientRect().top, p: Number(el.querySelector('[mjs-fx-word]').style.getPropertyValue('--mjs-fx-stagger-p')), vus: [...el.querySelectorAll('[mjs-fx-word]')].map((w: any) => Math.round(Number(getComputedStyle(w).opacity) * 100) / 100) }
            }, HOST)
            await aller(0)
            let e = await etat()
            assert.equal(e.p, 0, `section en haut de l'écran : avancée ${e.p}`)
            assert.ok(e.vus.every((o: number) => Math.abs(o - 0.2) < 0.03), `avant la traversée, tous les mots en gris (0.2) : ${e.vus}`)
            await aller(360)
            e = await etat()
            assert.ok(Math.abs(e.p - 0.5) < 0.02, `à mi-traversée : avancée ${e.p}, 0.5 attendu`)
            assert.ok(Math.abs(e.top) < 1, `le texte collé reste en haut de l'écran (${e.top.toFixed(1)} px)`)
            assert.ok(e.vus[0] > 0.95 && e.vus[1] > 0.9, `à mi-traversée, les deux premiers mots allumés : ${e.vus}`)
            assert.ok(e.vus[2] < 0.25 && e.vus[3] < 0.25, `à mi-traversée, les deux derniers encore gris : ${e.vus}`)
            await aller(720)
            e = await etat()
            assert.equal(e.p, 1, `section traversée : avancée ${e.p}`)
            assert.ok(e.vus.every((o: number) => o > 0.95), `section traversée, tous les mots allumés : ${e.vus}`)
          })

          it('{await … *skeleton} : les barres de l\'attente ont une taille et scintillent', async function () {
            await enHaut()
            const m = await page.evaluate((host: string) => {
              const sh: any = (window as any).__root(document.querySelector(host))
              const vu      = (sel: string) => {
                const el: any = sh.querySelector('#attente ' + sel)
                const r       = el.getBoundingClientRect()
                return { w: Math.round(r.width), h: Math.round(r.height), anim: getComputedStyle(el).animationName }
              }
              return { titre: vu('h3.nom > [mjs-skel]'), lignes: vu('p.bio > [mjs-skel="lines"]'), ligne: vu('p.bio [mjs-skel="line"]') }
            }, HOST)
            assert.ok(m.titre.w > 100 && m.titre.h > 10, `la barre du titre : ${JSON.stringify(m.titre)}`)
            assert.equal(m.titre.anim, 'mjs-fx-skeleton')
            assert.ok(m.lignes.h > 3 * m.ligne.h, `trois lignes empilées, sans se chevaucher : ${JSON.stringify(m)}`)
            assert.equal(m.lignes.anim, 'none', 'le groupe de lignes ne scintille pas lui-même')
          })

          it('thème en cercle : un clic qui change le thème passe par une transition de vue, puis la rend', async function () {
            await enHaut()
            const vt = await page.evaluate(() => typeof (document as any).startViewTransition === 'function')
            const avant = await page.evaluate(() => document.documentElement.dataset.mjsTheme)
            await page.evaluate((host: string) => {
              const sh: any = (window as any).__root(document.querySelector(host))
              sh.querySelector('#bascule-theme').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true, clientX: 30, clientY: 30 }))
              sh.querySelector('#bascule-theme').click()
            }, HOST)
            const pendant = await page.evaluate(() => document.documentElement.hasAttribute('mjs-theme-circle'))
            await attendre(async () => !(await page.evaluate(() => document.documentElement.hasAttribute('mjs-theme-circle'))), 3000, 'la fin du cercle')
            const apres = await page.evaluate(() => document.documentElement.dataset.mjsTheme)
            assert.notEqual(apres, avant, 'le thème a changé')
            if (vt) assert.ok(pendant, 'le cercle se joue (transition de vue)')
          })

          it('effets de texte sur une balise qui centre son texte (grille, flex, bouton, case de tableau) : les lettres restent à la place du texte', async function () {
            await enHaut()
            const m = await page.evaluate((host: string) => {
              const sh: any = (window as any).__root(document.querySelector(host))
              const milieu  = (r: any) => ({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) })
              const mesure  = (id: string) => {
                const el: any = sh.querySelector('#' + id)
                el.scrollIntoView({ block: 'center' })
                const brut: any[] = [...el.childNodes].filter((n: any) => n.nodeType === 3 && n.data.trim())
                const r0 = document.createRange()
                r0.setStartBefore(brut[0])
                r0.setEndAfter(brut[brut.length - 1])
                const r1 = document.createRange()
                r1.selectNodeContents(el.querySelector('[mjs-fx-layer="text"]'))
                return { texte: milieu(r0.getBoundingClientRect()), calque: milieu(r1.getBoundingClientRect()) }
              }
              const coupe: any = sh.querySelector('#centre-coupe')
              const avant: any = getComputedStyle(coupe, '::before')
              return {
                cas:   { grille: mesure('centre-grille'), flex: mesure('centre-flex'), bouton: mesure('centre-bouton'), caseTableau: mesure('centre-case') },
                coupe: { gauche: parseFloat(avant.marginLeft), droite: parseFloat(avant.marginRight), haut: parseFloat(avant.marginTop), bas: parseFloat(avant.marginBottom) },
              }
            }, HOST)
            for (const [nom, v] of Object.entries(m.cas) as any) {
              assert.ok(Math.abs(v.texte.x - v.calque.x) <= 3 && Math.abs(v.texte.y - v.calque.y) <= 3, `${nom} : le texte au milieu ${JSON.stringify(v.texte)}, les lettres de l'effet ${JSON.stringify(v.calque)}`)
            }
            const c = m.coupe
            assert.ok(c.gauche > 20 && Math.abs(c.gauche - c.droite) <= 1 && c.haut > 20 && Math.abs(c.haut - c.bas) <= 1, `*split : ses deux moitiés centrées comme le texte (marges ${JSON.stringify(c)})`)
          })

          it('*goo(merge) : deux formes à 40 px l\'une de l\'autre se soudent — le milieu de l\'écart est de leur couleur, comme la démo', async function () {
            await enHaut()
            const box = await page.evaluate((host: string) => {
              const sh: any = (window as any).__root(document.querySelector(host))
              const el: any = sh.querySelector('#liquide')
              el.scrollIntoView({ block: 'center' })
              const a = sh.querySelector('.g1').getBoundingClientRect()
              const b = sh.querySelector('.g2').getBoundingClientRect()
              return { x: Math.round((a.right + b.left) / 2), y: Math.round(a.top + a.height / 2) }
            }, HOST)
            await pause(150)
            const png = await page.screenshot({ clip: { x: box.x - 2, y: box.y - 2, width: 5, height: 5 } })
            const rvb = await page.evaluate(async (b64: string) => {
              const img = new Image()
              img.src   = 'data:image/png;base64,' + b64
              await img.decode()
              const c   = document.createElement('canvas')
              c.width   = img.width
              c.height  = img.height
              const ctx: any = c.getContext('2d')
              ctx.drawImage(img, 0, 0)
              return Array.from(ctx.getImageData(Math.floor(img.width / 2), Math.floor(img.height / 2), 1, 1).data)
            }, png.toString('base64'))
            assert.ok(rvb[0] > 150 && rvb[1] < 90, `au milieu de l'écart, la couleur des formes (#e11d48) — vu : rgb(${rvb.slice(0, 3).join(', ')})`)
          })

          it('*delta(fx: *scramble) : l\'effet donné rejoué à CHAQUE changement du nombre (un sur deux se perdait)', async function () {
            await enHaut()
            const vus: string[] = []
            for (let i = 0; i < 4; i++) {
              await page.evaluate((host: string) => {
                const sh: any = (window as any).__root(document.querySelector(host))
                sh.querySelector('#delta-plus').click()
              }, HOST)
              await pause(350)
              vus.push(await page.evaluate((host: string) => {
                const sh: any = (window as any).__root(document.querySelector(host))
                const v: any  = sh.querySelector('#delta-fx [mjs-fx-delta-val]')
                return (v && v.getAttribute('mjs-fx')) || '(rien)'
              }, HOST))
            }
            assert.deepEqual(vus, ['scramble', 'scramble', 'scramble', 'scramble'], `l'effet sur le nombre, changement après changement : ${vus.join(', ')}`)
          })

          it('*gauge : la barre remplit la part de la valeur dans sa plage (42 sur 0 à 100)', async function () {
            await enHaut()
            const m = await page.evaluate((host: string) => {
              const sh: any = (window as any).__root(document.querySelector(host))
              const el: any = sh.querySelector('#jauge')
              el.scrollIntoView({ block: 'center' })
              const boite = el.querySelector('[mjs-fx-layer="gauge"]').getBoundingClientRect()
              const barre = el.querySelector('[mjs-fx-layer="gauge"] i').getBoundingClientRect()
              return { part: barre.width / boite.width, gauche: barre.left - boite.left }
            }, HOST)
            assert.ok(Math.abs(m.part - 0.42) < 0.01 && Math.abs(m.gauche) < 1, `la barre : ${JSON.stringify(m)}`)
          })

          it('*guard : hors de sa plage à la sortie du champ, la valeur y est ramenée, et la bulle dit ce qui est permis, sous le champ', async function () {
            await enHaut()
            const m = await page.evaluate(async (host: string) => {
              const sh: any = (window as any).__root(document.querySelector(host))
              const f: any  = sh.querySelector('#garde')
              f.scrollIntoView({ block: 'center' })
              f.focus()
              f.value = '300'
              f.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
              f.dispatchEvent(new Event('change', { bubbles: true }))
              // la bulle arrive en glissant (180 ms), le champ tremble (450 ms)
              await new Promise((r) => setTimeout(r, 600))
              const b: any = sh.querySelector('#garde + [mjs-fx-guard-tip]')
              const rf = f.getBoundingClientRect()
              const rb = b.getBoundingClientRect()
              const n: any = sh.querySelector('#garde-natif')
              n.value = '9'
              n.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
              n.dispatchEvent(new Event('change', { bubbles: true }))
              const bn: any = sh.querySelector('#garde-natif + [mjs-fx-guard-tip]')
              return { valeur: f.value, texte: b.textContent, ecart: rb.top - rf.bottom, gauche: rb.left - rf.left, natif: n.value, natifTexte: bn ? bn.textContent : null }
            }, HOST)
            assert.equal(m.valeur, '120')
            assert.equal(m.texte, 'de 18 à 120')
            assert.ok(Math.abs(m.ecart - 6) < 1.5 && Math.abs(m.gauche) < 1.5, `la bulle sous le champ : ${JSON.stringify(m)}`)
            assert.equal(m.natif, '5', 'sans <vars> : les bornes du champ (min, max) font la règle')
            assert.ok(m.natifTexte && m.natifTexte.length > 3, `la bulle dit le message du navigateur : ${m.natifTexte}`)
          })

          it('*offline : le réseau coupé, la zone se voile (grise) et le bandeau arrive à son bord ; rétabli, tout part', async function () {
            await enHaut()
            await page.evaluate((host: string) => (window as any).__root(document.querySelector(host)).querySelector('#hors').scrollIntoView({ block: 'center' }), HOST)
            await page.context().setOffline(true)
            await attendre(async () => await page.evaluate((host: string) => !!(window as any).__root(document.querySelector(host)).querySelector('#hors [mjs-fx-offline-band][mjs-fx-offline-in]'), HOST), 3000, 'le bandeau')
            await pause(500)
            const m = await page.evaluate((host: string) => {
              const z: any = (window as any).__root(document.querySelector(host)).querySelector('#hors')
              const b: any = z.querySelector('[mjs-fx-offline-band]')
              const v: any = z.querySelector('[mjs-fx-offline-veil]')
              const rz = z.getBoundingClientRect()
              const rb = b.getBoundingClientRect()
              return { bord: Math.round(rb.top - rz.top), large: Math.round(rb.width - rz.width), haut: Math.round(rb.height), texte: b.textContent, voile: getComputedStyle(v).backdropFilter }
            }, HOST)
            await page.context().setOffline(false)
            // Chromium sans écran : le retour du réseau émulé ne rend ni navigator.onLine ni l'événement
            // `online` (limite de l'émulation, vue le 29/09) — la page le reçoit alors comme d'un vrai réseau
            await pause(200)
            await page.evaluate(() => {
              if (navigator.onLine) return
              Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true })
              window.dispatchEvent(new Event('online'))
            })
            await attendre(async () => await page.evaluate((host: string) => !(window as any).__root(document.querySelector(host)).querySelector('#hors [mjs-fx-offline-band]'), HOST), 3000, 'le bandeau parti')
            assert.deepEqual([m.bord, m.large, m.haut], [0, 0, 40], `le bandeau au bord haut de la zone (par défaut), de sa largeur, 40 px : ${JSON.stringify(m)}`)
            assert.equal(m.texte, 'Hors ligne')
            assert.equal(m.voile, 'grayscale(0.8)')
          })

          it('aucune erreur console ni pageerror pendant tout le banc', function () {
            assert.deepEqual(consoleIssues, [])
          })
        })
      }
    })
  }
})
