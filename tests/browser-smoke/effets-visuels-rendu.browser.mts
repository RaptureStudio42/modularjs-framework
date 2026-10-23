// BANC navigateur RÉEL du rendu des effets visuels (Chromium + Firefox, via playwright) — hors de
// `npm test`. happy-dom ne calcule ni style ni mise en page : une règle écrite depuis l'hôte qui ne
// voit pas le calque posé dans son shadow root, une balise en ligne que ResizeObserver ne voit jamais
// changer, un filtre SVG introuvable depuis un shadow root, une animation coupée par « réduire les
// animations » qui ne finit jamais, une transformation sans effet sur une boîte en ligne n'y existent
// pas. Cas joués, en build de dev puis de prod :
//   - *annotate sur un composant : le tracé se voit (il restait masqué pour toujours) ;
//   - *annotate sur un mot en ligne : redessiné quand la taille du texte change ;
//   - *gauge(style: ring) sur un composant : l'anneau (le remplissage « fill » s'affichait) ;
//   - *goo(drip) sur un composant : le filtre liquide s'applique à sa flaque ;
//   - *grid(trail) avec « réduire les animations » : les cases allumées s'éteignent ;
//   - *kenburns sur une <picture> : l'image avance ;
//   - *border(animate, speed) : les couleurs tournent à la vitesse donnée ;
//   - *attention(on: always) avec une attente plus longue que la pause : l'appel se joue ;
//   - *glitch sur un mot en ligne : le mot tremble (seules ses copies bougeaient) ;
//   - *border(gradient) autour d'un avatar rond (arrondi en %) : le halo reste rond ;
//   - *goo(drip) sur un bouton arrondi : la flaque suit l'arrondi ;
//   - *filter(duotone) avec une couleur oklch() : l'ombre prend cette couleur (elle devenait noire) ;
//   - *mesh.aurora dans une balise arrondie : le flou ne déborde pas dans les coins ;
//   - *autosize sous un ancêtre réduit (scale) : la boîte glisse vers sa vraie taille ;
//   - *delta dans une police qui arrive après la pose (servie lentement) : la place réservée au
//     nombre suit la police ;
//   - *dock : la souris immobile, la cloche ne change pas d'un mouvement à l'autre (les boîtes
//     mesurées l'étaient transformées par le mouvement d'avant) ;
//   - *grid(lines, fade: down) et *beam : des traits sans case sous un masque, des faisceaux flous
//     qui prennent leur place ;
//   - *annotate sur un composant chargé à la demande, arrivé APRÈS la pose de l'effet (son fichier
//     servi en retard) : le tracé, posé à son arrivée dans le composant, se voit (il tombait dans la
//     balise, sous le shadow root qu'elle prend à sa mise à niveau : jamais affiché).
// La page d'essai est écrite à la volée, compilée par bin/mjs en dev puis en prod.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, createReadStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, firefox } from 'playwright'
import { assertDistFrais } from '../helpers/dist-frais.js'
import { mjsTmp } from '../helpers/tmp.js'

const __dirname      = dirname(fileURLToPath(import.meta.url))
const MODULARJS_ROOT = join(__dirname, '..', '..')
const BIN_MJS        = join(MODULARJS_ROOT, 'bin', 'mjs')
const HOST           = 'mjs-rendu'
// une police système, servie lentement au banc sous un autre nom (absente : le cas est sauté)
const POLICE         = '/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.map': 'application/json', '.svg': 'image/svg+xml', '.ttf': 'font/ttf',
}

function freePort(): Promise<number> {
  return new Promise((ok, ko) => {
    const srv = createServer()
    srv.on('error', ko)
    srv.listen(0, '127.0.0.1', () => {
      const a = srv.address()
      const p = a && typeof a === 'object' ? a.port : 0
      srv.close(() => ok(p))
    })
  })
}

// la page d'essai : un cas par effet, deux composants qui portent des effets
function ecrireFixture(dir: string): void {
  mkdirSync(join(dir, 'composants'), { recursive: true })
  writeFileSync(join(dir, 'mjs.config.json'), JSON.stringify({ sourceDir: 'composants', outputDir: 'sortie', manifestPath: 'sortie/bundle.js', defaultScriptLang: 'civet' }))
  writeFileSync(join(dir, 'index.html'), '<!DOCTYPE html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n<title>MJS — rendu des effets</title>\n<style>html,body{margin:0;background:#fff;color:#111;font-family:sans-serif}@font-face{font-family:"Chiffres lents";src:url(lente.ttf)}</style>\n</head>\n<body>\n<mjs-rendu></mjs-rendu>\n<script type="module" src="bundle.js"></script>\n</body>\n</html>\n')
  if (existsSync(POLICE)) copyFileSync(POLICE, join(dir, 'lente.ttf'))
  writeFileSync(join(dir, 'photo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="#3a6"/><circle cx="100" cy="60" r="40" fill="#fc3"/></svg>\n')
  // les cas n'apparaissent qu'une fois les deux composants définis (bouton #montrer, pressé par le
  // banc) ; un effet posé sur un composant pas encore chargé a son cas à part, en fin de page : la
  // balise #tardive, affichée d'emblée, dont le fichier est servi en retard
  writeFileSync(join(dir, 'composants', 'rendu.mjs'), [
    '<script>',
    '  $pret = false',
    '  $plus = false',
    '</script>',
    '',
    '<div hidden><@carte></@carte><@jauge></@jauge></div>',
    '<button id="montrer" @click={$pret = true}>Montrer</button>',
    '{if $pret}',
    '<@carte id="annote-carte" *annotate(on: load, duration: 200ms)></@carte>',
    '<p id="phrase" class="phrase">Voici un <span id="mot" *annotate(on: load, duration: 0s)>mot important</span> dans une phrase.</p>',
    '<@jauge id="jauge" *gauge(style: ring, direction: up, value: 50, duration: 0s)></@jauge>',
    '<@carte id="goo-carte" *goo(drip, color: #f00, on: hover)></@carte>',
    '<div id="grille" class="grille" *grid(trail, size: 20)></div>',
    '<figure id="kb" class="kb" *kenburns(zoom: 2, duration: 1s)><picture><img id="kb-img" src="photo.svg" alt="photo" width="200" height="120"></picture></figure>',
    '<div id="bord" class="bord" *border(animate: true, speed: 1s)>Bord</div>',
    '<button id="appel" class="appel" *attention(on: always, delay: 1s, every: 500ms, duration: 300ms)>Appel</button>',
    '<p class="titre">Un <span id="glitch-mot" *glitch(on: click, burst: 1s)>mot</span> qui glitche</p>',
    '<div id="rond" class="rond" *border>Rond</div>',
    '<button id="goo-bouton" class="goo-bouton" *goo(drip, on: hover)>Goo</button>',
    '<img id="duo" src="photo.svg" alt="duo" width="100" height="60" *filter(duotone, colors: [oklch(0.5 0.2 30), #ffd1e8])>',
    '<div id="aurore" class="aurore" *mesh.aurora(colors: [#f00, #f00, #f00, #f00, #f00, #f00], opacity: 1)></div>',
    '<div class="moitie"><div id="auto" *autosize><p class="ligne">Un</p>{if $plus}<p class="ligne">Deux</p><p class="ligne">Trois</p>{end}</div></div>',
    '<button id="plus" @click={$plus = true}>Plus</button>',
    '<span id="ecart" class="ecart" *delta>12480</span>',
    '<nav id="dock" class="dock" *dock><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></nav>',
    '{end}',
    '<@tardive id="tardive" *annotate(on: load, duration: 0s, width: 6, color: #f00)></@tardive>',
    '<div id="traits" class="scene-fx" *grid(lines, size: 20, color: #f00, fade: down)></div>',
    '<div id="faisceaux" class="scene-fx" *beam(#0ff, opacity: .5, duration: 300ms, delay: 0s)></div>',
    '',
    '<style>',
    '  .phrase',
    '    width: 600px',
    '    font-size: 16px',
    '  .grille',
    '    width: 200px',
    '    height: 120px',
    '  .kb',
    '    width: 200px',
    '    height: 120px',
    '    margin: 20px 0',
    '  .bord',
    '    width: 160px',
    '    margin: 40px',
    '  .rond',
    '    width: 200px',
    '    height: 200px',
    '    margin: 40px',
    '    border-radius: 50%',
    '  .goo-bouton',
    '    border-radius: 20px',
    '    background: #36c',
    '    color: #fff',
    '    padding: 10px 20px',
    '  .aurore',
    '    width: 300px',
    '    height: 160px',
    '    margin: 20px',
    '    border-radius: 40px',
    '  .moitie',
    '    transform: scale(.5)',
    '    transform-origin: 0 0',
    '  .ligne',
    '    margin: 0',
    '    height: 30px',
    '  .ecart',
    '    font-family: "Chiffres lents", monospace',
    '    font-size: 20px',
    '  .dock',
    '    display: flex',
    '    margin: 60px 40px',
    '  .scene-fx',
    '    width: 300px',
    '    height: 160px',
    '    margin: 20px',
    '    background: #000',
    '  .dock i',
    '    display: block',
    '    width: 48px',
    '    height: 48px',
    '    background: #888',
    '</style>',
  ].join('\n'))
  writeFileSync(join(dir, 'composants', 'carte.mjs'), '<p class="dedans">Contenu de la carte</p>\n\n<style>\n  :host\n    display: block\n    width: 220px\n    margin: 30px\n  .dedans\n    margin: 0\n    padding: 8px 0\n</style>\n')
  writeFileSync(join(dir, 'composants', 'jauge.mjs'), '<p class="dedans">50</p>\n\n<style>\n  :host\n    display: block\n    width: 80px\n    height: 80px\n  .dedans\n    margin: 0\n</style>\n')
  writeFileSync(join(dir, 'composants', 'tardive.mjs'), '<p class="dedans">Composant arrivé en retard</p>\n\n<style>\n  :host\n    display: block\n    width: 220px\n    margin: 30px\n  .dedans\n    margin: 0\n    padding: 8px 0\n</style>\n')
}

function serveDir(dir: string, port: number): Promise<any> {
  const server = createServer((req, res) => {
    const url  = new URL(req.url || '/', 'http://x')
    const rel  = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '')
    const file = join(dir, rel)
    if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile()) { res.statusCode = 404; res.end('absent'); return }
    res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream')
    res.setHeader('Cache-Control', 'no-store')
    // la police et le composant #tardive arrivent après la pose des effets
    if (file.endsWith('lente.ttf') || /[\\/]tardive[-.][^\\/]*\.js$/.test(file)) setTimeout(() => createReadStream(file).pipe(res), 1200)
    else createReadStream(file).pipe(res)
  })
  return new Promise((ok, ko) => {
    server.on('error', ko)
    server.listen(port, '127.0.0.1', () => ok(server))
  })
}

describe('banc navigateur réel : le rendu des effets visuels (dev + prod)', function () {
  this.timeout(600000)

  let dir = ''
  let server: any = null
  let port = 0

  before(async function () {
    assertDistFrais(MODULARJS_ROOT)
    dir  = mjsTmp('banc-rendu')
    port = await freePort()
    ecrireFixture(dir)
    server = await serveDir(dir, port)
  })

  after(async function () {
    if (server) await new Promise<void>((r) => server.close(() => r()))
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  for (const mode of ['dev', 'prod'] as const) {
    describe(`build ${mode}`, function () {
      before(function () {
        rmSync(join(dir, 'sortie'), { recursive: true, force: true })
        const r = spawnSync(process.execPath, [BIN_MJS, 'build', '--root', dir, mode === 'prod' ? '--prod' : '--dev'], { encoding: 'utf-8', timeout: 120000 })
        assert.equal(r.status, 0, `mjs build --${mode} en échec :\n${r.stdout}\n${r.stderr}`)
        copyFileSync(join(dir, 'index.html'), join(dir, 'sortie', 'index.html'))
        copyFileSync(join(dir, 'photo.svg'), join(dir, 'sortie', 'photo.svg'))
        if (existsSync(join(dir, 'lente.ttf'))) copyFileSync(join(dir, 'lente.ttf'), join(dir, 'sortie', 'lente.ttf'))
      })

      for (const engine of [chromium, firefox]) {
        describe(`moteur ${engine.name()}`, function () {
          let browser: any = null
          let page: any = null
          const issues: string[] = []

          before(async function () {
            browser = await engine.launch()
            page    = await browser.newPage({ viewport: { width: 1000, height: 800 } })
            await page.addInitScript(() => {
              const w: any = window
              w.__root = (el: any) => el._shadow || el.shadowRoot
              w.__cas  = (id: string) => w.__root(document.querySelector('mjs-rendu')).querySelector('#' + id)
            })
            page.on('console', (m: any) => { if (m.type() === 'error') issues.push(`[${engine.name()}/${mode}] console.error: ${m.text()}`) })
            page.on('pageerror', (e: any) => { issues.push(`[${engine.name()}/${mode}] pageerror: ${e.message}`) })
            await page.goto(`http://127.0.0.1:${port}/sortie/index.html`, { waitUntil: 'load' })
            await page.waitForFunction(() => !!(customElements.get('mjs-carte') && customElements.get('mjs-jauge') && (window as any).__cas('montrer')), null, { timeout: 30000 })
            await page.evaluate(() => (window as any).__cas('montrer').click())
            await page.waitForFunction(() => {
              const w: any = window
              const el: any = document.querySelector('mjs-rendu')
              const sh = el && w.__root(el)
              const c: any = sh && sh.querySelector('#annote-carte')
              const j: any = sh && sh.querySelector('#jauge')
              return !!(c && w.__root(c) && w.__root(c).querySelector('[mjs-fx-layer="annotate"] path') && j && w.__root(j) && w.__root(j).querySelector('[mjs-fx-layer="gauge"]'))
            }, null, { timeout: 30000 })
          })

          after(async function () {
            if (browser) await browser.close()
          })

          // la couleur d'un point de l'écran (capture de 5 × 5 px autour de lui, lue au milieu)
          const pixel = async (x: number, y: number) => {
            const png = await page.screenshot({ clip: { x: x - 2, y: y - 2, width: 5, height: 5 } })
            return page.evaluate(async (b64: string) => {
              const img = new Image()
              img.src   = 'data:image/png;base64,' + b64
              await img.decode()
              const c   = document.createElement('canvas')
              c.width   = img.width
              c.height  = img.height
              const ctx: any = c.getContext('2d')
              ctx.drawImage(img, 0, 0)
              return Array.from(ctx.getImageData(Math.floor(img.width / 2), Math.floor(img.height / 2), 1, 1).data).slice(0, 3) as number[]
            }, png.toString('base64'))
          }

          it('*annotate sur un composant : le tracé, dessiné dans le composant, se voit une fois tracé', async function () {
            await page.waitForTimeout(400)
            const vu = await page.evaluate(() => {
              const w: any = window
              const c: any = w.__cas('annote-carte')
              const traits: any[] = Array.from(w.__root(c).querySelectorAll('[mjs-fx-layer="annotate"] path'))
              return { fini: c.hasAttribute('mjs-fx-annotate-done'), decalages: traits.map((p) => getComputedStyle(p).strokeDashoffset) }
            })
            assert.ok(vu.fini, 'le tracé est fini (attribut posé)')
            assert.ok(vu.decalages.length > 0 && vu.decalages.every((d: string) => parseFloat(d) === 0), `chaque trait entièrement tracé (stroke-dashoffset 0) — vu : ${vu.decalages.join(', ')}`)
          })

          it('*annotate sur un mot en ligne : redessiné quand la taille du texte change', async function () {
            const mesure = () => page.evaluate(() => {
              const w: any = window
              const m: any = w.__cas('mot')
              const svg: any = m.querySelector('[mjs-fx-layer="annotate"]')
              return { mot: m.getBoundingClientRect().width, calque: parseFloat(svg.getAttribute('width')) }
            })
            const avant = await mesure()
            assert.ok(Math.abs(avant.calque - (avant.mot + 20)) <= 2, `à la pose, le calque suit le mot : ${JSON.stringify(avant)}`)
            await page.evaluate(() => { (window as any).__cas('phrase').style.fontSize = '40px' })
            await page.waitForTimeout(400)
            const apres = await mesure()
            assert.ok(apres.mot > avant.mot * 2, `le mot a grandi : ${JSON.stringify(apres)}`)
            assert.ok(Math.abs(apres.calque - (apres.mot + 20)) <= 2, `le calque a suivi le mot : avant ${JSON.stringify(avant)}, après ${JSON.stringify(apres)}`)
          })

          it('*gauge(style: ring) sur un composant : un anneau, pas le remplissage', async function () {
            const vu = await page.evaluate(() => {
              const w: any = window
              const l: any = w.__root(w.__cas('jauge')).querySelector('[mjs-fx-layer="gauge"]')
              return { arrondi: getComputedStyle(l).borderRadius, fond: getComputedStyle(l).backgroundImage, barre: getComputedStyle(l.querySelector('i')).display }
            })
            assert.equal(vu.arrondi, '50%', 'un anneau rond')
            assert.match(vu.fond, /conic-gradient/, 'la part de la valeur, en arc')
            assert.equal(vu.barre, 'none', 'pas la barre du remplissage')
          })

          it('*goo(drip) sur un composant : le filtre liquide s\'applique à la flaque (elle déborde de la balise, fondue)', async function () {
            const r = await page.evaluate(() => {
              const w: any = window
              const c: any = w.__cas('goo-carte')
              c.scrollIntoView({ block: 'center' })
              const b = c.getBoundingClientRect()
              return { x: Math.round(b.left - 4), y: Math.round(b.top + b.height / 2) }
            })
            await page.mouse.move(990, 790)
            await page.waitForTimeout(150)
            const rvb = await pixel(r.x, r.y)
            assert.ok(rvb[0] > 200 && rvb[1] < 80 && rvb[2] < 80, `à 4 px du bord, la flaque floutée puis durcie par le filtre — vu : rgb(${rvb.join(', ')})`)
          })

          it('*grid(trail) avec « réduire les animations » : les cases allumées au passage s\'éteignent', async function () {
            await page.emulateMedia({ reducedMotion: 'reduce' })
            try {
              const r = await page.evaluate(() => {
                const w: any = window
                const g: any = w.__cas('grille')
                g.scrollIntoView({ block: 'center' })
                const b = g.getBoundingClientRect()
                return { x0: b.left + 5, x1: b.right - 5, y: b.top + b.height / 2 }
              })
              const allumees = () => page.evaluate(() => (window as any).__cas('grille').querySelectorAll('[mjs-fx-layer="grid"] i[mjs-fx-on]').length)
              await page.mouse.move(r.x0, r.y)
              await page.mouse.move(r.x1, r.y, { steps: 12 })
              await page.waitForTimeout(100)
              const n = await allumees()
              assert.ok(n >= 5, `le geste allume des cases : ${n}`)
              await page.mouse.move(990, 790)
              await page.waitForTimeout(4700)
              assert.equal(await allumees(), 0, 'toutes éteintes, sans bouger')
            }
            finally {
              await page.emulateMedia({ reducedMotion: 'no-preference' })
            }
          })

          it('*kenburns sur une <picture> : l\'image dedans avance en zoomant', async function () {
            await page.evaluate(() => (window as any).__cas('kb').scrollIntoView({ block: 'center' }))
            let plus = 0
            for (let i = 0; i < 22; i++) {
              const l = await page.evaluate(() => (window as any).__cas('kb-img').getBoundingClientRect().width)
              plus = Math.max(plus, l)
              await page.waitForTimeout(100)
            }
            assert.ok(plus > 260, `l'image grandit jusqu'au zoom 2 (200 px au départ) — largeur la plus grande vue : ${plus}`)
          })

          it('*border(animate, speed: 1s) : les couleurs font leur tour en 1 s', async function () {
            const vu = await page.evaluate(() => {
              const b: any = (window as any).__cas('bord')
              return { liseré: getComputedStyle(b, '::after').animationDuration, halo: getComputedStyle(b, '::before').animationDuration }
            })
            assert.deepEqual(vu, { liseré: '1s', halo: '1s' })
          })

          it('*attention(on: always) : une attente (1 s) plus longue que la pause (500 ms) n\'empêche pas l\'appel', async function () {
            const n = await page.evaluate(async () => {
              const a: any = (window as any).__cas('appel')
              let vus = 0
              const f = () => { vus++ }
              a.addEventListener('animationstart', f)
              await new Promise((r) => setTimeout(r, 3000))
              a.removeEventListener('animationstart', f)
              return vus
            })
            assert.ok(n >= 2, `des appels joués en 3 s : ${n}`)
          })

          it('*glitch sur un mot en ligne : pendant la salve, le mot lui-même tremble', async function () {
            const xs = await page.evaluate(async () => {
              const m: any = (window as any).__cas('glitch-mot')
              m.scrollIntoView({ block: 'center' })
              m.click()
              const vus: number[] = []
              for (let i = 0; i < 20; i++) {
                vus.push(Math.round(m.getBoundingClientRect().left * 10) / 10)
                await new Promise((r) => setTimeout(r, 20))
              }
              return { display: getComputedStyle(m).display, places: Array.from(new Set(vus)).length }
            })
            assert.equal(xs.display, 'inline-block', 'le mot passe en inline-block le temps de l\'effet')
            assert.ok(xs.places >= 3, `la balise bouge pendant la salve : ${xs.places} places vues`)
          })

          it('*border(gradient) autour d\'un avatar rond (arrondi 50 %) : le halo reste rond', async function () {
            const r = await page.evaluate(() => {
              const b: any = (window as any).__cas('rond')
              return { halo: parseFloat(getComputedStyle(b, '::before').borderTopLeftRadius), largeur: b.offsetWidth }
            })
            assert.ok(Math.abs(r.halo - (r.largeur / 2 + 30)) <= 1, `l'arrondi du halo : la moitié de la balise plus son débord (30 px) — vu : ${JSON.stringify(r)}`)
          })

          it('*goo(drip) sur un bouton arrondi : la flaque suit l\'arrondi', async function () {
            const r = await page.evaluate(() => {
              const b: any = (window as any).__cas('goo-bouton')
              return getComputedStyle(b.querySelector('[mjs-fx-layer="goo"] b')).borderTopLeftRadius
            })
            assert.equal(r, '20px')
          })

          it('*filter(duotone) avec une couleur oklch() : l\'ombre prend cette couleur, pas le noir', async function () {
            // le filtre SVG est celui que désigne la propriété `filter` de l'image : son id appartient au moteur, il change avec lui
            const v = await page.evaluate(() => {
              const w: any  = window
              const sh: any = w.__root(document.querySelector('mjs-rendu'))
              const id      = /url\(#([\w-]+)\)/.exec(w.__cas('duo').style.getPropertyValue('--mjs-fx-filter-value'))?.[1]
              const f: any  = id ? sh.querySelector('filter#' + id) : null
              return f ? ['R', 'G', 'B'].map((k) => f.querySelector('feFunc' + k).getAttribute('tableValues')) : null
            })
            assert.ok(v, 'le filtre duotone de l\'image (celui que désigne --mjs-fx-filter-value)')
            const ombre = v!.map((t: string) => parseFloat(t.split(' ')[0]))
            assert.ok(ombre[0] > 0.4 && ombre[1] < 0.4 && ombre[2] < 0.4, `l'ombre est rouge (oklch(0.5 0.2 30)) — vu : ${v!.join(' | ')}`)
          })

          it('*mesh.aurora dans une balise arrondie : le coin, hors de l\'arrondi, reste de la couleur de la page', async function () {
            const r = await page.evaluate(() => {
              const a: any = (window as any).__cas('aurore')
              a.scrollIntoView({ block: 'center' })
              const b = a.getBoundingClientRect()
              return { x: Math.round(b.left + 3), y: Math.round(b.top + 3), mx: Math.round(b.left + b.width / 2), my: Math.round(b.top + b.height / 2) }
            })
            await page.mouse.move(990, 790)
            await page.waitForTimeout(100)
            const milieu = await pixel(r.mx, r.my)
            assert.ok(milieu[0] > 200 && milieu[1] < 150, `l'aurore rouge au milieu — vu : rgb(${milieu.join(', ')})`)
            const coin = await pixel(r.x, r.y)
            assert.ok(coin.every((c: number) => c >= 245), `à 3 px du coin, hors de l'arrondi : blanc — vu : rgb(${coin.join(', ')})`)
          })

          it('*autosize sous un ancêtre réduit de moitié : la boîte glisse de sa vraie hauteur à sa vraie hauteur', async function () {
            const r = await page.evaluate(async () => {
              const w: any = window
              const a: any = w.__cas('auto')
              const avant = a.offsetHeight
              w.__cas('plus').click()
              await new Promise((ok) => setTimeout(ok, 0))
              const anim: any = a.getAnimations()[0]
              const images = anim ? anim.effect.getKeyframes().map((k: any) => k.height) : []
              if (anim) anim.finish()
              return { avant, apres: a.offsetHeight, images }
            })
            assert.equal(JSON.stringify(r.images), JSON.stringify([r.avant + 'px', r.apres + 'px']), `les images clés en hauteur de mise en page — ${JSON.stringify(r)}`)
          })

          it('*delta dans une police arrivée après la pose : la place réservée au nombre suit la police', async function () {
            if (!existsSync(POLICE)) this.skip()
            const r = await page.evaluate(async () => {
              const fin = Date.now() + 10000
              while (!document.fonts.check('20px "Chiffres lents"') && Date.now() < fin) await new Promise((ok) => setTimeout(ok, 50))
              await new Promise((ok) => setTimeout(ok, 150))
              const e: any = (window as any).__cas('ecart')
              const v: any = e.querySelector('[mjs-fx-delta-val]').firstChild
              const rg = document.createRange()
              rg.selectNodeContents(v)
              const w = rg.getBoundingClientRect().width
              // la même chose dans la police de repli : la police arrivée change bien la largeur
              const t: any = document.createElement('span')
              t.style.font = '20px monospace'
              t.textContent = v.nodeValue
              document.body.appendChild(t)
              const repli = t.getBoundingClientRect().width
              t.remove()
              return { arrivee: document.fonts.check('20px "Chiffres lents"'), largeur: w, repli, reserve: e.style.minWidth, attendu: (Math.ceil(w) / 20).toFixed(4) + 'em' }
            })
            assert.ok(r.arrivee, 'la police est arrivée')
            assert.ok(Math.abs(r.largeur - r.repli) > 3, `la police change la largeur du nombre : ${JSON.stringify(r)}`)
            assert.ok(/em$/.test(r.reserve) && Math.abs(parseFloat(r.reserve) - parseFloat(r.attendu)) < 0.01, `la place réservée, mesurée dans la police arrivée : ${JSON.stringify(r)}`)
          })

          it('*dock : la souris au milieu d\'une icône, ses voisines grossissent selon la cloche, et pas moins au mouvement suivant', async function () {
            const r = await page.evaluate(() => {
              const d: any = (window as any).__cas('dock')
              d.scrollIntoView({ block: 'center' })
              const b = d.children[4].getBoundingClientRect()
              return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
            })
            const voisines = () => page.evaluate(() => {
              const d: any = (window as any).__cas('dock')
              return [3, 5].map((i) => parseFloat(d.children[i].style.getPropertyValue('--mjs-fx-dock-s')))
            })
            await page.mouse.move(r.x, r.y - 200)
            await page.mouse.move(r.x, r.y)
            await page.waitForTimeout(300)
            const une = await voisines()
            await page.mouse.move(r.x + 1, r.y)
            await page.waitForTimeout(300)
            await page.mouse.move(r.x, r.y)
            await page.waitForTimeout(100)
            const trois = await voisines()
            await page.mouse.move(990, 790)
            // la cloche : à 48 px (une icône) de la souris, portée 140 px, agrandissement 1,6 → 1,442
            for (const v of une.concat(trois)) assert.ok(Math.abs(v - 1.442) <= 0.02, `les voisines à 1,442 : au 1er mouvement ${une}, au 3e ${trois}`)
          })

          it('*annotate sur un composant chargé à la demande, arrivé après la pose : le tracé, posé dans le composant à son arrivée, se voit', async function () {
            // la page n'attend pas le composant : son fichier arrive 1,2 s après la pose de l'effet
            await page.waitForFunction(() => !!customElements.get('mjs-tardive'), null, { timeout: 30000 })
            await page.waitForTimeout(400)
            const vu = await page.evaluate(() => {
              const w: any = window
              const t: any = w.__cas('tardive')
              t.scrollIntoView({ block: 'center' })
              const sh: any = w.__root(t)
              const b = t.getBoundingClientRect()
              return { balise: Array.from(t.children).filter((c: any) => c.hasAttribute('mjs-fx-layer')).length, composant: sh ? sh.querySelectorAll('[mjs-fx-layer="annotate"] path').length : 0, x: Math.round(b.left + b.width / 2), y: Math.round(b.bottom + 2) }
            })
            assert.equal(vu.balise, 0, 'aucun calque dans la balise elle-même, où il ne se verrait pas')
            assert.ok(vu.composant > 0, `le tracé dans le composant — traits vus : ${vu.composant}`)
            const rvb = await pixel(vu.x, vu.y)
            assert.ok(rvb[0] > 200 && rvb[1] < 80 && rvb[2] < 80, `le trait rouge sous le composant se voit — vu : rgb(${rvb.join(', ')})`)
          })

          it('*grid(lines, fade: down) : des traits sans case, sous un masque en dégradé ; *beam : les faisceaux flous prennent leur place', async function () {
            await page.evaluate(() => (window as any).__cas('traits').scrollIntoView({ block: 'center' }))
            await page.waitForTimeout(1200)
            const v = await page.evaluate(() => {
              const w: any = window
              const t: any = w.__cas('traits').querySelector('[mjs-fx-layer="grid"]')
              const f: any = w.__cas('faisceaux').querySelector('[mjs-fx-layer="beam"]')
              const ct = getComputedStyle(t)
              const bs = Array.from(f.querySelectorAll('i')).map((i: any) => { const c = getComputedStyle(i); return { opacite: parseFloat(c.opacity), flou: c.filter, forme: c.transform } })
              return { cases: t.querySelectorAll('i').length, fond: ct.backgroundSize, image: ct.backgroundImage, masque: ct.maskImage || (ct as any).webkitMaskImage, bs }
            })
            assert.equal(v.cases, 0, 'aucune case — vu : ' + JSON.stringify(v))
            assert.equal(v.fond.split(',')[0], '20px 20px', 'taille des traits — vu : ' + JSON.stringify(v))
            assert.ok(/linear-gradient/.test(v.image), `les traits en dégradés — vu : ${v.image}`)
            assert.ok(/linear-gradient/.test(v.masque), `le masque du fondu — vu : ${v.masque}`)
            assert.equal(v.bs.length, 2, 'deux faisceaux — vu : ' + JSON.stringify(v))
            for (const b of v.bs) {
              assert.ok(Math.abs(b.opacite - 0.5) < 0.02, `faisceau à l'opacité demandée — vu : ${b.opacite}`)
              assert.ok(/blur\(70px\)/.test(b.flou), `faisceau flou — vu : ${b.flou}`)
              assert.notEqual(b.forme, 'none', 'faisceau incliné')
            }
          })

          it('aucune erreur console ni pageerror', function () {
            assert.deepEqual(issues, [])
          })
        })
      }
    })
  }
})
