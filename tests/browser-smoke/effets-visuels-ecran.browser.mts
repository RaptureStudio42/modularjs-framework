// BANC navigateur RÉEL d'effets visuels dont le défaut ne se voit qu'à l'écran (Chromium + Firefox,
// via playwright) — hors de `npm test` (extension `.mts`). happy-dom ne calcule ni mise en page, ni
// animation, ni arbre d'accessibilité. Cas joués, en build de dev puis de prod :
//   - *marquee(direction: up) : les lignes défilent d'une copie entière par tour (elles montaient de
//     quelques pixels puis revenaient d'un coup) ; avec une marge intérieure, le tour reste d'une copie
//     (saut de la moitié des marges à chaque tour) ; sur une balise en ligne, le défilé reste dans sa
//     balise (il passait sur le texte d'avant) ;
//   - *shine sur un lien (en ligne) : au repos, la bande du reflet ne se voit pas à côté du lien ;
//   - *pixels(on: view) : les carreaux se remplissent un à un (la première notification du
//     ResizeObserver les recréait tous, déjà pleins) ;
//   - *particles(on: hover) : le réseau et la neige ne bougent que pendant le survol ; la couleur du
//     réseau tenue par une variable suit dans le canevas ;
//   - « réduire les animations » : *ripple ne laisse pas ses gouttes derrière lui, *stagger(unit: word)
//     n'anime plus ses mots ;
//   - *split : le texte n'est lu qu'une fois (les deux moitiés recopiées entraient dans le nom
//     accessible) ;
//   - *zoom sur la balise elle-même : au repos, rien n'est rogné (l'anneau de focus se voit) ; pendant
//     le zoom, le surplus reste rogné, la découpe partie du bord ; sur un texte à enfants en ligne, le
//     texte grossit, du `scale` écrit dans la page — le défaut de l'effet n'y change rien (seuls ses
//     enfants, qui ne se transforment pas, étaient visés) ;
//   - *parallax dans un conteneur qui défile : la couche glisse à son rythme (elle n'écoutait que la
//     fenêtre) ; sur une balise en ligne aussi ;
//   - *particles(speed: 0) : des particules immobiles à leur place (réseau vide, neige entassée) ; les
//     clics du réseau n'ajoutent pas des points sans fin ;
//   - *longshadow : la couleur lue dans la balise, transparence comprise ; rien de recalculé hors de
//     l'écran ; en « réduire les animations », une ombre fixe sans lampe ;
//   - *magnet : un retour rapide au centre ne décale pas la balise ;
//   - *ripple, *smoke, *spotlight sur une balise à bordure épaisse ou mise à l'échelle : l'onde, la
//     fumée et la lumière partent du point du pointeur (la fumée naît par un arrondi au hasard à chaque
//     image : le pointeur bouge jusqu'à la première bouffée).
// La page d'essai est écrite à la volée, compilée par bin/mjs en dev puis en prod. Shadow DOM fermé :
// accès par la propriété interne `_shadow`, comme partout dans tests/.

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
const HOST           = 'mjs-visuels'
const TEXT_SCALE     = 1.15

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.map': 'application/json',
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

function ecrireFixture(dir: string): void {
  mkdirSync(join(dir, 'composants'), { recursive: true })
  writeFileSync(join(dir, 'mjs.config.json'), JSON.stringify({ sourceDir: 'composants', outputDir: 'sortie', manifestPath: 'sortie/bundle.js', defaultScriptLang: 'civet' }))
  writeFileSync(join(dir, 'index.html'), '<!DOCTYPE html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n<title>MJS — effets visuels à l\'écran</title>\n<style>html,body{margin:0;background:#fff;color:#111;font-family:sans-serif}</style>\n</head>\n<body>\n<mjs-visuels></mjs-visuels>\n<script type="module" src="bundle.js"></script>\n</body>\n</html>\n')
  writeFileSync(join(dir, 'composants', 'visuels.mjs'), [
    '<script>',
    '  $pixels = false',
    '  $couleur = "#ff0000"',
    '</script>',
    '',
    '<section class="cas">',
    '  <div id="defile-haut" class="bande" *marquee(direction: up, speed: 4s)>Nouvelles du jour</div>',
    '  <div id="defile-haut-marge" class="bande marge" *marquee(direction: up, speed: 4s)>Nouvelles du jour</div>',
    '  <div id="defile-marge" class="bande marge" *marquee(speed: 4s)>Nouvelles du jour</div>',
    '  <p id="phrase-defile" class="phrase">Avant <span id="defile-ligne" *marquee(speed: 4s)>Dernières nouvelles</span> après la balise, du texte qui continue.</p>',
    '  <p class="phrase sombre"><a id="reflet" href="#reflet" *shine>un lien assez long</a> puis du texte.</p>',
    '  <button id="montre-carreaux" @click={$pixels = true}>carreaux</button>',
    '  {if $pixels}<div id="carreaux" class="carte" *pixels(on: view)>Carte</div>{end}',
    '  <div id="reseau-survol" class="fond" *particles(network, on: hover)></div>',
    '  <div id="neige-survol" class="fond" *particles(snow, on: hover)></div>',
    '  <div id="reseau-couleur" class="fond" *particles(network, links: 0, color: $couleur)></div>',
    '  <button id="passe-vert" @click={$couleur = "#00ff00"}>vert</button>',
    '  <button id="onde" class="bouton" *ripple>Onde</button>',
    '  <p id="mots" class="mots" *stagger(unit: word, on: click)>Un deux trois quatre</p>',
    '  <h2 id="moities" *split>Bonjour</h2>',
    '  <p class="zone-zoom"><button id="zoom" class="anneau" *zoom>Valider</button></p>',
    '  <div id="panneau" class="panneau"><div class="vide"></div><div id="couche" class="couche" *parallax>couche</div><div class="vide"></div></div>',
    '  <div id="panneau-page" class="panneau"><div class="vide"></div><div id="couche-page" class="couche" *parallax(origin: page)>couche</div><div class="vide"></div></div>',
    '  <p class="phrase">Du texte et <span id="couche-ligne" *parallax>une couche en ligne</span> qui glisse.</p>',
    '  <p id="zoom-texte" class="phrase" *zoom(duration: 0s, scale: '+ TEXT_SCALE +')>Du texte <b id="zoom-gras">gras</b> ici</p>',
    '  <div id="reseau-fige" class="fond" *particles(network, speed: 0)></div>',
    '  <div id="neige-figee" class="fond" *particles(snow, speed: 0)></div>',
    '  <div id="reseau-clics" class="fond" *particles(network, links: 0)></div>',
    '  <div class="rouge"><h3 id="ombre-couleur" *longshadow(color: currentColor, follow: fixed)>Ombre</h3></div>',
    '  <h3 id="ombre-alpha" *longshadow(color: #0000ff33, follow: fixed)>Ombre</h3>',
    '  <p class="zone-aimant"><button id="aimant" class="bouton" *magnet>Aimant</button></p>',
    '  <button id="onde-bord" class="bouton bord" *ripple>Onde</button>',
    '  <div id="fumee-bord" class="fond bord" *smoke></div>',
    '  <div id="lampe-bord" class="fond bord" *spotlight></div>',
    '  <div class="zone-demi"><div id="lampe-demi" class="fond demi" *spotlight></div></div>',
    '  <div class="espace-bas"></div>',
    '  <h3 id="ombre-suit" *longshadow(light: true)>Ombre</h3>',
    '</section>',
    '',
    '<style>',
    '  .cas',
    '    display: block',
    '    padding: 20px',
    '  .bande',
    '    width: 300px',
    '    margin: 10px 0',
    '    font: 16px/24px sans-serif',
    '  .marge',
    '    padding: 10px 20px',
    '  .phrase',
    '    width: 700px',
    '    font: 16px/24px sans-serif',
    '  .sombre',
    '    background: #000',
    '    color: #fff',
    '    padding: 20px 20px 20px 260px',
    '  .sombre a',
    '    color: #fff',
    '  .carte',
    '    width: 300px',
    '    height: 200px',
    '    background: #eee',
    '  .fond',
    '    width: 300px',
    '    height: 200px',
    '    margin: 10px 0',
    '    background: #000',
    '  .bouton',
    '    width: 200px',
    '    height: 60px',
    '  .mots',
    '    font: 16px/24px sans-serif',
    '  .zone-zoom',
    '    padding: 30px',
    '  .anneau',
    '    outline: 4px solid #f00',
    '    outline-offset: 4px',
    '  .panneau',
    '    height: 300px',
    '    overflow: auto',
    '    margin: 10px 0',
    '  .vide',
    '    height: 600px',
    '  .couche',
    '    height: 100px',
    '    background: #09f',
    '  .rouge',
    '    color: rgb(255, 0, 0)',
    '  .zone-aimant',
    '    padding: 60px',
    '  .bord',
    '    border: 20px solid #888',
    '  .zone-demi',
    '    padding: 20px',
    '  .demi',
    '    scale: 0.5',
    '    transform-origin: 0 0',
    '  .espace-bas',
    '    height: 2000px',
    '</style>',
  ].join('\n'))
}

function serveDir(dir: string, port: number): Promise<any> {
  const server = createServer((req, res) => {
    const url  = new URL(req.url || '/', 'http://x')
    const rel  = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '')
    const file = join(dir, rel)
    if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile()) { res.statusCode = 404; res.end('absent'); return }
    res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream')
    res.setHeader('Cache-Control', 'no-store')
    createReadStream(file).pipe(res)
  })
  return new Promise((ok, ko) => {
    server.on('error', ko)
    server.listen(port, '127.0.0.1', () => ok(server))
  })
}

describe('banc navigateur réel : effets visuels à l\'écran — défilé, reflet, carreaux, particules, mouvement réduit, moitiés, zoom, parallaxe, ombre, aimant, point du pointeur (dev + prod)', function () {
  this.timeout(600000)

  let dir = ''
  let server: any = null
  let port = 0

  before(async function () {
    assertDistFrais(MODULARJS_ROOT)
    dir  = mjsTmp('banc-visuels')
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
      })

      for (const engine of [chromium, firefox]) {
        describe(`moteur ${engine.name()}`, function () {
          let browser: any = null
          let page: any = null
          const issues: string[] = []
          const url = () => `http://127.0.0.1:${port}/sortie/index.html`

          const ouvrir = async (ouvert: boolean, reduit = false) => {
            const p = await browser.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: reduit ? 'reduce' : 'no-preference' })
            await p.addInitScript(() => { (window as any).__root = (el: any) => el._shadow || el.shadowRoot })
            // racines ouvertes : l'arbre d'accessibilité de playwright ne traverse pas une racine fermée
            if (ouvert) await p.addInitScript(() => {
              const attache = Element.prototype.attachShadow
              Element.prototype.attachShadow = function (init: any) { return attache.call(this, Object.assign({}, init, { mode: 'open' })) }
            })
            p.on('console', (m: any) => { if (m.type() === 'error') issues.push(`[${engine.name()}/${mode}] console.error: ${m.text()}`) })
            p.on('pageerror', (e: any) => { issues.push(`[${engine.name()}/${mode}] pageerror: ${e.message}`) })
            await p.goto(url(), { waitUntil: 'load' })
            await p.waitForFunction((host: string) => {
              const el: any = document.querySelector(host)
              const sh = el && (el._shadow || el.shadowRoot)
              return !!(sh && sh.querySelector('#defile-haut [mjs-fx-layer]') && sh.querySelector('#reseau-couleur canvas'))
            }, HOST, { timeout: 30000 })
            return p
          }

          before(async function () {
            browser = await engine.launch()
            page    = await ouvrir(false)
          })

          after(async function () {
            if (browser) await browser.close()
          })

          beforeEach(async function () {
            await page.emulateMedia({ reducedMotion: 'no-preference' })
            await page.mouse.move(1, 1)
          })

          const pause = (ms: number) => page.waitForTimeout(ms)
          // amène une balise du composant au milieu de l'écran ; rend sa boîte
          const montrer = async (sel: string) => {
            const r = await page.evaluate(({ host, sel }: any) => {
              const el: any = (window as any).__root(document.querySelector(host)).querySelector(sel)
              el.scrollIntoView({ block: 'center' })
              const b = el.getBoundingClientRect()
              return { x: b.left, y: b.top, w: b.width, h: b.height }
            }, { host: HOST, sel })
            await pause(80)
            return r
          }
          // une feuille ajoutée au composant le temps d'une comparaison ; rend de quoi la retirer
          const feuille = (css: string) => page.evaluate(({ host, css }: any) => {
            const sh: any = (window as any).__root(document.querySelector(host))
            const f: any  = new CSSStyleSheet()
            f.replaceSync(css)
            f._mjs_keep = true
            sh.adoptedStyleSheets = sh.adoptedStyleSheets.concat([f])
            ;(window as any).__retire = () => { sh.adoptedStyleSheets = sh.adoptedStyleSheets.filter((x: any) => x !== f) }
          }, { host: HOST, css })
          const retirerFeuille = () => page.evaluate(() => (window as any).__retire())
          // un tour de *marquee, animation arrêtée : la place de la première copie au départ et à
          // mi-tour, celle de la seconde à la fin du tour (relatives à la balise, sur l'axe du défilé)
          const tour = (sel: string, axe: 'x' | 'y') => page.evaluate(({ host, sel, axe }: any) => {
            const el: any = (window as any).__root(document.querySelector(host)).querySelector(sel)
            const txt     = 'Nouvelles du jour'
            const copies  = Array.from(el.querySelectorAll('[mjs-fx-layer="text"] span')).filter((s: any) => s.children.length === 0 && s.textContent.trim() === txt) as any[]
            const anims   = el.getAnimations({ subtree: true })
            const pos     = (n: any) => {
              const b = n.getBoundingClientRect()
              const e = el.getBoundingClientRect()
              return axe === 'y' ? b.top - e.top : b.left - e.left
            }
            if (copies.length !== 2 || anims.length === 0) return { copies: copies.length, anims: anims.length }
            const d  = anims[0].effect.getComputedTiming().duration
            const at = (t: number) => anims.forEach((a: any) => { a.pause(); a.currentTime = t })
            at(0)
            const depart = pos(copies[0])
            const pas    = pos(copies[1]) - depart
            at(d / 2)
            const milieu = Math.abs(pos(copies[0]) - depart)
            at(d - 1)
            const fin = pos(copies[1])
            anims.forEach((a: any) => a.play())
            return { copies: copies.length, anims: anims.length, depart: Math.round(depart * 10) / 10, fin: Math.round(fin * 10) / 10, milieu: Math.round(milieu), pas: Math.round(pas) }
          }, { host: HOST, sel, axe })

          it('*marquee(direction: up) : les lignes défilent d\'une copie entière par tour — la seconde copie finit là où la première partait', async function () {
            await montrer('#defile-haut')
            const r = await tour('#defile-haut', 'y')
            assert.equal(r.copies, 2, JSON.stringify(r))
            assert.ok(r.pas > 24, `une copie plus l'écart plus bas : ${JSON.stringify(r)}`)
            assert.ok(Math.abs(r.milieu - r.pas / 2) <= 2, `à mi-tour, la moitié d'une copie : ${JSON.stringify(r)}`)
            assert.ok(Math.abs(r.fin - r.depart) <= 1, `la boucle se referme sans saut : ${JSON.stringify(r)}`)
          })

          it('*marquee avec une marge intérieure : le tour vaut une copie, horizontal comme vertical — aucun saut à la boucle', async function () {
            await montrer('#defile-marge')
            const x = await tour('#defile-marge', 'x')
            assert.equal(x.copies, 2, JSON.stringify(x))
            assert.ok(Math.abs(x.depart - 20) <= 1, `le texte part de la marge intérieure, comme le texte de la balise : ${JSON.stringify(x)}`)
            assert.ok(Math.abs(x.fin - x.depart) <= 1, `horizontal, la boucle se referme sans saut : ${JSON.stringify(x)}`)
            await montrer('#defile-haut-marge')
            const y = await tour('#defile-haut-marge', 'y')
            assert.ok(Math.abs(y.depart - 10) <= 1, `vertical, le texte part de la marge du haut : ${JSON.stringify(y)}`)
            assert.ok(Math.abs(y.fin - y.depart) <= 1, `vertical, la boucle se referme sans saut : ${JSON.stringify(y)}`)
          })

          it('*marquee sur une balise en ligne : le défilé reste dans sa balise, il ne passe pas sur le texte d\'avant', async function () {
            await montrer('#defile-ligne')
            const zone = await page.evaluate((host: string) => {
              const sh: any = (window as any).__root(document.querySelector(host))
              const b = sh.querySelector('#defile-ligne').getBoundingClientRect()
              const p = sh.querySelector('#phrase-defile').getBoundingClientRect()
              return { x: Math.ceil(p.left), y: Math.floor(b.top), width: Math.floor(b.left - p.left) - 2, height: Math.ceil(b.height) }
            }, HOST)
            const cliche = async (part: number) => {
              await page.evaluate(({ host, part }: any) => {
                const el: any = (window as any).__root(document.querySelector(host)).querySelector('#defile-ligne')
                el.getAnimations({ subtree: true }).forEach((a: any) => { a.pause(); a.currentTime = a.effect.getComputedTiming().duration * part })
              }, { host: HOST, part })
              await pause(50)
              return page.screenshot({ clip: zone })
            }
            const depart = await cliche(0)
            const milieu = await cliche(0.3)
            await page.evaluate((host: string) => (window as any).__root(document.querySelector(host)).querySelector('#defile-ligne').getAnimations({ subtree: true }).forEach((a: any) => a.play()), HOST)
            assert.ok(depart.equals(milieu), 'le texte d\'avant la balise est le même au départ et en plein défilé')
          })

          it('*shine sur un lien (balise en ligne) : au repos, la bande du reflet ne se voit pas à côté du lien', async function () {
            const r = await montrer('#reflet')
            const zone = { x: Math.max(0, Math.floor(r.x - r.w * 1.4)), y: Math.floor(r.y) - 4, width: Math.floor(r.w * 1.4) - 2, height: Math.ceil(r.h) + 8 }
            const avec = await page.screenshot({ clip: zone })
            await feuille('[mjs-fx~="shine"]::after{display:none !important}')
            await pause(50)
            const sans = await page.screenshot({ clip: zone })
            await retirerFeuille()
            assert.ok(avec.equals(sans), 'à gauche du lien, rien du reflet au repos')
          })

          it('*pixels(on: view) : les carreaux se remplissent un à un — pas recréés d\'un coup, déjà pleins, peu après la pose', async function () {
            await page.evaluate((host: string) => {
              const b: any = (window as any).__root(document.querySelector(host)).querySelector('#montre-carreaux')
              b.scrollIntoView({ block: 'start' })
              b.click()
            }, HOST)
            await page.waitForFunction((host: string) => !!(window as any).__root(document.querySelector(host)).querySelector('#carreaux [mjs-fx-layer="pixels"] i'), HOST, { timeout: 5000 })
            await page.evaluate((host: string) => { (window as any).__tuile = (window as any).__root(document.querySelector(host)).querySelector('#carreaux [mjs-fx-layer="pixels"] i') }, HOST)
            await pause(400)
            const r = await page.evaluate((host: string) => {
              const c: any = (window as any).__root(document.querySelector(host)).querySelector('#carreaux')
              const tuiles = Array.from(c.querySelectorAll('[mjs-fx-layer="pixels"] i')) as any[]
              return { active: (c.getAttribute('mjs-fx-on') || '').includes('pixels'), total: tuiles.length, pleines: tuiles.filter((t) => parseFloat(getComputedStyle(t).opacity) > 0.99).length, premiere: (window as any).__tuile.isConnected }
            }, HOST)
            assert.ok(r.active, `l'effet est actif (à l'écran) : ${JSON.stringify(r)}`)
            assert.ok(r.premiere, `les carreaux ne sont pas recréés : ${JSON.stringify(r)}`)
            assert.ok(r.pleines < r.total / 2, `à 400 ms, le remplissage est en cours, pas fini : ${JSON.stringify(r)}`)
          })

          it('*particles(on: hover) : au repos le réseau et la neige ne bougent pas, ils s\'animent au survol', async function () {
            const r = await montrer('#reseau-survol')
            const image = () => page.evaluate((host: string) => (window as any).__root(document.querySelector(host)).querySelector('#reseau-survol canvas').toDataURL(), HOST)
            const a = await image()
            await pause(300)
            const b = await image()
            assert.ok(a === b, 'le réseau ne bouge pas sans survol')
            await page.mouse.move(r.x + r.w / 2, r.y + r.h / 2)
            await pause(300)
            const c = await image()
            assert.ok(c !== b, 'il s\'anime au survol')
            await page.mouse.move(1, 1)
            const n = await montrer('#neige-survol')
            const flocon = () => page.evaluate((host: string) => {
              const i: any = (window as any).__root(document.querySelector(host)).querySelector('#neige-survol [mjs-fx-layer="particles"] i')
              const b = i.getBoundingClientRect()
              return Math.round(b.left) + ',' + Math.round(b.top)
            }, HOST)
            const f1 = await flocon()
            await pause(300)
            const f2 = await flocon()
            assert.equal(f2, f1, 'la neige ne tombe pas sans survol')
            await page.mouse.move(n.x + n.w / 2, n.y + n.h / 2)
            await pause(300)
            const f3 = await flocon()
            assert.notEqual(f3, f2, 'elle tombe au survol')
          })

          it('*particles(network) : la couleur tenue par une variable suit dans le canevas', async function () {
            await montrer('#reseau-couleur')
            await page.evaluate((host: string) => (window as any).__root(document.querySelector(host)).querySelector('#passe-vert').click(), HOST)
            await pause(300)
            const r = await page.evaluate((host: string) => {
              const cv: any = (window as any).__root(document.querySelector(host)).querySelector('#reseau-couleur canvas')
              const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
              let rouge = 0
              let vert  = 0
              for (let i = 0; i < d.length; i += 4) {
                if (d[i + 3] === 0) continue
                if (d[i] > d[i + 1]) rouge++
                else if (d[i + 1] > d[i]) vert++
              }
              return { rouge, vert }
            }, HOST)
            assert.ok(r.vert > 0 && r.rouge === 0, `les points passent au vert : ${JSON.stringify(r)}`)
          })

          it('« réduire les animations » : *ripple ne laisse aucune goutte derrière lui', async function () {
            await montrer('#onde')
            await page.emulateMedia({ reducedMotion: 'reduce' })
            await page.evaluate((host: string) => {
              const b: any = (window as any).__root(document.querySelector(host)).querySelector('#onde')
              const r = b.getBoundingClientRect()
              for (let i = 0; i < 10; i++) b.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left + 20, clientY: r.top + 20, bubbles: true }))
            }, HOST)
            await pause(1000)
            const n = await page.evaluate((host: string) => (window as any).__root(document.querySelector(host)).querySelectorAll('#onde [mjs-fx-drop]').length, HOST)
            assert.equal(n, 0, 'aucune goutte restée dans la balise')
          })

          it('« réduire les animations » : *stagger(unit: word) n\'anime pas ses mots', async function () {
            await montrer('#mots')
            await page.emulateMedia({ reducedMotion: 'reduce' })
            const r = await page.evaluate((host: string) => {
              const m: any = (window as any).__root(document.querySelector(host)).querySelector('#mots')
              m.click()
              const mots = Array.from(m.querySelectorAll('[mjs-fx-word]')) as any[]
              return { joue: (m.getAttribute('mjs-fx-play') || '').includes('stagger'), mots: mots.length, animations: mots.reduce((n, w) => n + w.getAnimations().length, 0) }
            }, HOST)
            assert.ok(r.joue && r.mots === 4, JSON.stringify(r))
            assert.equal(r.animations, 0, `aucun mot animé : ${JSON.stringify(r)}`)
          })

          it('*split : le texte n\'est lu qu\'une fois — les moitiés recopiées n\'entrent pas dans le nom accessible', async function () {
            if (engine.name() === 'chromium') {
              const cdp = await page.context().newCDPSession(page)
              const { nodes } = await cdp.send('Accessibility.getFullAXTree')
              const titres = nodes.filter((n: any) => n.role && n.role.value === 'heading').map((n: any) => n.name && n.name.value).filter((t: string) => /Bonjour/.test(t || ''))
              await cdp.detach()
              assert.deepEqual(titres, ['Bonjour'], 'arbre d\'accessibilité natif de Chromium')
            }
            const p2 = await ouvrir(true)
            const vu = await p2.locator('#moities').ariaSnapshot()
            await p2.close()
            assert.equal(vu, '- heading "Bonjour" [level=2]')
          })

          it('*zoom sur la balise elle-même : au repos rien n\'est rogné (l\'anneau de focus se voit), pendant le zoom le surplus reste rogné', async function () {
            const r = await montrer('#zoom')
            const zone = { x: Math.floor(r.x) - 12, y: Math.floor(r.y) - 12, width: Math.ceil(r.w) + 24, height: Math.ceil(r.h) + 24 }
            const clip = () => page.evaluate((host: string) => getComputedStyle((window as any).__root(document.querySelector(host)).querySelector('#zoom')).clipPath, HOST)
            assert.equal(await clip(), 'none', 'au repos, aucune découpe')
            const avec = await page.screenshot({ clip: zone })
            await feuille('[mjs-fx~="zoom"]{clip-path:none !important}')
            await pause(50)
            const sans = await page.screenshot({ clip: zone })
            await retirerFeuille()
            assert.ok(avec.equals(sans), 'l\'anneau autour du bouton se voit en entier')
            await page.mouse.move(r.x + r.w / 2, r.y + r.h / 2)
            await pause(100)
            const debut = await clip()
            assert.notEqual(debut, 'none', 'dès le début du zoom, le surplus est rogné')
            await pause(600)
            const fin = await clip()
            assert.notEqual(fin, 'none', 'zoom fini : le surplus est rogné')
            assert.notEqual(debut, fin, `la découpe part du bord (inset(0)) et grandit avec le zoom : ${debut} → ${fin}`)
            await page.mouse.move(1, 1)
            await pause(900)
            assert.equal(await clip(), 'none', 'revenu au repos : plus de découpe')
          })

          for (const [sel, panneau, quoi] of [['#couche', '#panneau', 'origin: view'], ['#couche-page', '#panneau-page', 'origin: page']]) {
            it(`*parallax(${quoi}) dans un conteneur qui défile : la couche glisse à la moitié du défilement`, async function () {
              await montrer(panneau)
              const haut = () => page.evaluate(({ host, sel }: any) => (window as any).__root(document.querySelector(host)).querySelector(sel).getBoundingClientRect().top, { host: HOST, sel })
              await page.evaluate(({ host, panneau }: any) => { (window as any).__root(document.querySelector(host)).querySelector(panneau).scrollTop = 200 }, { host: HOST, panneau })
              await pause(150)
              const a = await haut()
              await page.evaluate(({ host, panneau }: any) => { (window as any).__root(document.querySelector(host)).querySelector(panneau).scrollTop = 300 }, { host: HOST, panneau })
              await pause(150)
              const b = await haut()
              assert.ok(Math.abs((b - a) + 50) <= 2, `défilé de 100 px, la couche monte de 50 px (vitesse 0.5) : ${Math.round(b - a)} px`)
            })
          }

          it('*parallax sur une balise en ligne : elle glisse aussi (une balise en ligne ne se déplace pas telle quelle)', async function () {
            await montrer('#couche-ligne')
            const haut = () => page.evaluate((host: string) => (window as any).__root(document.querySelector(host)).querySelector('#couche-ligne').getBoundingClientRect().top, HOST)
            const a = await haut()
            await page.evaluate(() => window.scrollBy(0, 100))
            await pause(150)
            const b = await haut()
            assert.ok(Math.abs((b - a) + 50) <= 2, `page défilée de 100 px, la couche monte de 50 px : ${Math.round(b - a)} px`)
          })

          it('*zoom sur un texte dont les enfants sont en ligne : le texte grossit (la balise elle-même)', async function () {
            const r = await montrer('#zoom-texte')
            const large = () => page.evaluate((host: string) => (window as any).__root(document.querySelector(host)).querySelector('#zoom-gras').getBoundingClientRect().width, HOST)
            const a = await large()
            await page.mouse.move(r.x + 5, r.y + r.h / 2)
            await pause(150)
            const b = await large()
            await page.mouse.move(1, 1)
            assert.ok(Math.abs(b / a - TEXT_SCALE) < 0.03, `le mot en gras grossit de ${TEXT_SCALE} : ${a.toFixed(1)} → ${b.toFixed(1)} px`)
          })

          it('*particles(speed: 0) : des particules immobiles à leur place — le réseau se dessine, la neige n\'est pas entassée dans un coin', async function () {
            await montrer('#reseau-fige')
            const dessin = await page.evaluate((host: string) => {
              const cv: any = (window as any).__root(document.querySelector(host)).querySelector('#reseau-fige canvas')
              const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
              let n = 0
              for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++
              return n
            }, HOST)
            assert.ok(dessin > 0, `le réseau est dessiné : ${dessin} pixels`)
            await montrer('#neige-figee')
            const places = () => page.evaluate((host: string) => {
              const el: any = (window as any).__root(document.querySelector(host)).querySelector('#neige-figee')
              const r = el.getBoundingClientRect()
              return (Array.from(el.querySelectorAll('[mjs-fx-layer="particles"] i')) as any[]).map((i) => {
                const b = i.getBoundingClientRect()
                return Math.round(b.left - r.left) + ',' + Math.round(b.top - r.top)
              })
            }, HOST)
            const p1 = await places()
            await pause(200)
            const p2 = await places()
            assert.ok(new Set(p1).size > 10, `des flocons répandus : ${new Set(p1).size} places distinctes sur ${p1.length}`)
            assert.deepEqual(p2, p1, 'et immobiles')
          })

          it('*particles(network) : chaque clic ajoute des points, mais pas sans fin — au plus le double de ceux de la balise', async function () {
            await montrer('#reseau-clics')
            // les points dessinés en une image (un arc par point, les fils sont coupés : links: 0)
            const points = () => page.evaluate(async (host: string) => {
              const cv: any  = (window as any).__root(document.querySelector(host)).querySelector('#reseau-clics canvas')
              const ctx: any = cv.getContext('2d')
              if (!ctx.__arc) {
                ctx.__arc = ctx.arc
                ctx.arc   = function (...a: any[]) { ctx.__n++; return ctx.__arc.apply(this, a) }
              }
              await new Promise((ok) => requestAnimationFrame(() => ok(0)))
              ctx.__n = 0
              await new Promise((ok) => requestAnimationFrame(() => ok(0)))
              return ctx.__n
            }, HOST)
            const a = await points()
            await page.evaluate((host: string) => {
              const el: any = (window as any).__root(document.querySelector(host)).querySelector('#reseau-clics')
              const b = el.getBoundingClientRect()
              for (let i = 0; i < 100; i++) el.dispatchEvent(new MouseEvent('click', { clientX: b.left + 50, clientY: b.top + 50, bubbles: true }))
            }, HOST)
            const b = await points()
            assert.ok(a > 0 && b > a, `des points ajoutés : ${a} → ${b}`)
            assert.ok(b <= 2 * a, `cent clics : ${a} points avant, ${b} après`)
          })

          it('*longshadow : la couleur se lit dans la balise (currentColor) et garde sa transparence', async function () {
            const ombre = (sel: string) => page.evaluate(({ host, sel }: any) => ((window as any).__root(document.querySelector(host)).querySelector(sel).style.getPropertyValue('--mjs-fx-longshadow') || '').split(/,(?![^(]*\))/)[0].trim(), { host: HOST, sel })
            const c = await ombre('#ombre-couleur')
            assert.match(c, /rgba\(255,\s*0,\s*0,\s*1(\.0+)?\)$/, `currentColor : la couleur de la balise (rouge) — ${c}`)
            const a = await ombre('#ombre-alpha')
            assert.match(a, /rgba\(0,\s*0,\s*255,\s*0?\.20*\)$/, `#0000ff33 : la transparence gardée (0.2) — ${a}`)
          })

          it('*longshadow hors de l\'écran : rien n\'est recalculé quand la souris bouge ; revenue à l\'écran, l\'ombre suit', async function () {
            await page.evaluate(() => window.scrollTo(0, 0))
            await pause(150)
            await page.evaluate((host: string) => {
              const l: any = (window as any).__root(document.querySelector(host)).querySelector('#ombre-suit')
              ;(window as any).__ecritures = 0
              ;(window as any).__mo = new MutationObserver((m) => { (window as any).__ecritures += m.length })
              ;(window as any).__mo.observe(l, { attributes: true, attributeFilter: ['style'] })
            }, HOST)
            for (let i = 0; i < 20; i++) {
              await page.mouse.move(100 + i * 10, 100 + i * 5)
              await pause(20)
            }
            const hors = await page.evaluate(() => (window as any).__ecritures)
            await montrer('#ombre-suit')
            await page.evaluate(() => { (window as any).__ecritures = 0 })
            for (let i = 0; i < 5; i++) {
              await page.mouse.move(200 + i * 30, 300 + i * 10)
              await pause(30)
            }
            const dedans = await page.evaluate(() => {
              (window as any).__mo.disconnect()
              return (window as any).__ecritures
            })
            assert.equal(hors, 0, 'hors de l\'écran : aucune écriture de style')
            assert.ok(dedans > 0, 'à l\'écran : l\'ombre suit la souris')
          })

          it('« réduire les animations » : *longshadow ne suit pas la souris — une ombre fixe dès la pose, sans lampe', async function () {
            const p2 = await ouvrir(false, true)
            const lire = () => p2.evaluate((host: string) => (window as any).__root(document.querySelector(host)).querySelector('#ombre-suit').style.getPropertyValue('--mjs-fx-longshadow'), HOST)
            const a = await lire()
            await p2.evaluate((host: string) => (window as any).__root(document.querySelector(host)).querySelector('#ombre-suit').scrollIntoView({ block: 'center' }), HOST)
            for (let i = 0; i < 5; i++) {
              await p2.mouse.move(100 + i * 40, 200 + i * 20)
              await p2.waitForTimeout(30)
            }
            const b = await lire()
            const lampes = await p2.evaluate(() => document.querySelectorAll('[mjs-fx-longshadow-light]').length)
            await p2.close()
            assert.ok(a.length > 0, 'une ombre fixe dès la pose')
            assert.equal(b, a, 'elle ne suit pas la souris')
            assert.equal(lampes, 0, 'sans lampe')
          })

          it('*magnet : sortie puis retour rapide au centre — aucun déplacement (la place de repos n\'est pas mesurée pendant le retour)', async function () {
            const r = await montrer('#aimant')
            await page.mouse.move(r.x + 5, r.y + r.h / 2)
            await page.mouse.move(r.x + 2, r.y + r.h / 2)
            await pause(150)
            await page.mouse.move(r.x - 40, r.y + r.h / 2)
            await pause(60)
            await page.mouse.move(r.x + r.w / 2, r.y + r.h / 2)
            await pause(20)
            const x = await page.evaluate((host: string) => (window as any).__root(document.querySelector(host)).querySelector('#aimant').style.getPropertyValue('--mjs-fx-magnet-x'), HOST)
            await page.mouse.move(1, 1)
            assert.ok(Math.abs(parseFloat(x)) < 1, `au centre : ${x}`)
          })

          it('balise à bordure épaisse ou mise à l\'échelle : l\'onde (*ripple), la fumée (*smoke) et la lumière (*spotlight) partent du point du pointeur', async function () {
            await montrer('#onde-bord')
            const onde = await page.evaluate((host: string) => {
              const b: any = (window as any).__root(document.querySelector(host)).querySelector('#onde-bord')
              const r = b.getBoundingClientRect()
              const x = r.left + 60
              const y = r.top + 50
              b.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true }))
              const d: any = Array.from(b.querySelectorAll('[mjs-fx-drop]')).pop()
              d.getAnimations().forEach((a: any) => { a.pause(); a.currentTime = 0 })
              const g = d.getBoundingClientRect()
              return [Math.round(g.left + g.width / 2 - x), Math.round(g.top + g.height / 2 - y)]
            }, HOST)
            assert.deepEqual(onde, [0, 0], 'le centre de l\'onde sous le pointeur')
            await montrer('#fumee-bord')
            const fumee = await page.evaluate(async (host: string) => {
              const f: any = (window as any).__root(document.querySelector(host)).querySelector('#fumee-bord')
              const r = f.getBoundingClientRect()
              const x = r.left + 60
              const y = r.top + 50
              // chaque image fait naître les bouffées par un arrondi au hasard : l'une peut n'en faire naître aucune — le pointeur bouge jusqu'à la première
              let p: any = null
              for (let i = 0; i < 60 && !p; i++) {
                f.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }))
                await new Promise((ok) => requestAnimationFrame(() => ok(0)))
                await new Promise((ok) => requestAnimationFrame(() => ok(0)))
                p = f.querySelector('[mjs-fx-layer="smoke"] i')
              }
              if (!p) return null
              p.getAnimations().forEach((a: any) => { a.pause(); a.currentTime = 0 })
              const g = p.getBoundingClientRect()
              return [Math.round(g.left + g.width / 2 - x), Math.round(g.top + g.height / 2 - y)]
            }, HOST)
            assert.deepEqual(fumee, [0, 0], 'la fumée naît sous le pointeur')
            await montrer('#lampe-bord')
            const lampe = (sel: string, fx: number, fy: number) => page.evaluate(({ host, sel, fx, fy }: any) => {
              const s: any = (window as any).__root(document.querySelector(host)).querySelector(sel)
              const r = s.getBoundingClientRect()
              s.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + fx, clientY: r.top + fy, bubbles: true }))
              return [s.style.getPropertyValue('--mjs-fx-spot-x'), s.style.getPropertyValue('--mjs-fx-spot-y')]
            }, { host: HOST, sel, fx, fy })
            assert.deepEqual(await lampe('#lampe-bord', 60, 50), ['40.0px', '30.0px'], 'la lumière sous le pointeur, bordure de 20 px déduite')
            await montrer('#lampe-demi')
            assert.deepEqual(await lampe('#lampe-demi', 50, 25), ['100.0px', '50.0px'], 'la lumière sous le pointeur, balise réduite de moitié')
          })

          it('aucune erreur console ni pageerror', function () {
            assert.deepEqual(issues, [])
          })
        })
      }
    })
  }
})
