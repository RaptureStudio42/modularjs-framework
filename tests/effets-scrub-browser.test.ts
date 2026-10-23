// *scrub dans Chromium et Firefox réels (une vraie mise en page, un vrai décodage) : une vidéo qui suit le défilement
// d'une section collante (son temps courant, en pause, muette, rendue au retrait), une suite d'images dans
// un <canvas> (l'image dessinée suit le défilement, à la taille de la balise × la densité, au plus 2), la
// même dans une <img> au survol, une adresse data: dans une liste écrite telle quelle, une toile sans taille
// CSS qui ne grossit pas à chaque mesure, et le repos : aucune image d'animation en attente, aucun écouteur
// de défilement quand la balise est loin de la vue. Loin de la vue, une vidéo ne charge ni ne cherche rien
// (un vrai serveur local compte les octets que le navigateur tire : pas plus que la même balise sans l'effet,
// aucun avec preload="none"), et une suite d'images est lâchée, puis rechargée au retour.
// La vidéo d'essai est fabriquée par ffmpeg (VP8, toutes les images clés) ; sans lui, ses tests sont sautés.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import type { ServerResponse } from 'node:http'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
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

const AVEC_FFMPEG = spawnSync('ffmpeg', ['-version']).status === 0
const N           = 12
const SCENE       = '\n.scene\n  height: 300px\n  overflow: auto\n.longue\n  height: 1500px\n.cible\n  position: sticky\n  top: 0\n  display: block\n  width: 100%\n  height: 300px\n'
// une vidéo 6 000 px sous l'écran, 1 000 px de page derrière elle (de quoi l'amener au milieu de l'écran)
const LOIN        = '\n.espace\n  height: 6000px\n.cible\n  display: block\n  width: 640px\n  height: 360px\n.fin\n  height: 1000px\n'
// une adresse data: sans parenthèse ni guillemet, comme la donne la démonstration
const rect = (couleur: string) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='80' height='50'><rect width='80' height='50' fill='${couleur}'/></svg>`).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())

const SOURCES: Record<string, string> = {
  'scrub-video.mjs':    `<div class="scene"><section class="longue"><video class="cible" muted playsinline *scrub(smooth: 0)></video></section></div>\n<style>${SCENE}</style>\n`,
  'scrub-video-nue.mjs': `<div class="scene"><section class="longue"><video class="cible" *scrub(smooth: 0)></video></section></div>\n<style>${SCENE}</style>\n`,
  'scrub-images.mjs':   `<div class="scene"><section class="longue"><canvas class="cible" *scrub(frames: 'f-###.svg', count: ${N}, smooth: 0)></canvas></section></div>\n<style>${SCENE}</style>\n`,
  'scrub-survol.mjs':   `<img class="survol" alt="essai" src="f-001.svg" *scrub(frames: 'f-###.svg', count: ${N}, on: hover, smooth: 0)>\n<style>\n.survol\n  display: block\n  width: 600px\n  height: 340px\n</style>\n`,
  'scrub-sans-css.mjs': `<canvas class="nu" *scrub(frames: 'f-###.svg', count: 3)></canvas>\n`,
  'scrub-fixes.mjs':    `<canvas class="cible" *scrub(images: ['${rect('red')}', '${rect('blue')}'], smooth: 0)></canvas>\n<style>\n.cible\n  display: block\n  width: 200px\n  height: 100px\n</style>\n`,
  'scrub-retrait.mjs':  '<script>\n$on = true\n</script>\n{if $on}<video class="cible" *scrub(smooth: 0)></video>{end}\n<button class="t" @click={$on = !$on}>t</button>\n',
  // une balise 4 000 px sous l'écran : loin de la vue
  'scrub-loin.mjs':     `<div class="espace"></div>\n<div class="scene"><section class="longue"><canvas class="cible" *scrub(frames: 'f-###.svg', count: ${N}, smooth: 0)></canvas></section></div>\n<style>${SCENE}.espace\n  height: 4000px\n</style>\n`,
  // la suite à l'écran au départ, 4 000 px de page derrière elle : on s'en éloigne, puis on revient
  'scrub-va-et-vient.mjs': `<div class="scene"><section class="longue"><canvas class="cible" *scrub(frames: 'f-###.svg', count: ${N}, smooth: 0)></canvas></section></div>\n<div class="espace"></div>\n<style>${SCENE}.espace\n  height: 4000px\n</style>\n`,
  // la vidéo du serveur, 6 000 px sous l'écran : avec l'effet, sans l'effet (le témoin), avec l'effet et preload="none" (retirable)
  'scrub-video-loin.mjs':       `<div class="espace"></div>\n<video class="cible" muted playsinline src="/essai.webm" *scrub(smooth: 0)></video>\n<div class="fin"></div>\n<style>${LOIN}</style>\n`,
  'scrub-video-loin-sans.mjs':  `<div class="espace"></div>\n<video class="cible" muted playsinline src="/essai.webm"></video>\n<div class="fin"></div>\n<style>${LOIN}</style>\n`,
  'scrub-video-loin-aucun.mjs': `<script>\n$on = true\n</script>\n<div class="espace"></div>\n{if $on}<video class="cible" muted playsinline preload="none" src="/essai.webm" *scrub(smooth: 0)></video>{end}\n<button class="t" @click={$on = !$on}>t</button>\n<div class="fin"></div>\n<style>${LOIN}</style>\n`
}

// l'image n de la suite : un disque blanc qui traverse un fond sombre, de gauche à droite
const SVG = (n: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="135"><rect width="240" height="135" fill="#102030"/><circle cx="${20 + 200 * (n - 1) / (N - 1)}" cy="67" r="20" fill="#fff"/></svg>`

// ce que la page compte : les images d'animation en attente, les écouteurs de défilement de la fenêtre
const COMPTEURS = () => {
  const w = window as any
  w.__raf = new Set()
  const ra = w.requestAnimationFrame.bind(w)
  const ca = w.cancelAnimationFrame.bind(w)
  w.__dans = 0
  w.requestAnimationFrame = (f: any) => { const h = ra((t: number) => { w.__raf.delete(h); w.__dans++; try { return f(t) } finally { w.__dans-- } }); w.__raf.add(h); return h }
  w.cancelAnimationFrame = (h: number) => { w.__raf.delete(h); return ca(h) }
  w.__scroll = new Set()
  const ae = w.addEventListener.bind(w)
  const re = w.removeEventListener.bind(w)
  w.addEventListener = (t: string, f: any, o: any) => { if (t === 'scroll') w.__scroll.add(f); return ae(t, f, o) }
  w.removeEventListener = (t: string, f: any, o: any) => { if (t === 'scroll') w.__scroll.delete(f); return re(t, f, o) }
  // les lectures de mise en page faites DANS une image d'animation (derrière l'écriture d'un effet, chacune force un recalcul de style) et les
  // styles calculés demandés, comptés tant que `__mesure` est vrai
  w.__mesure = false
  w.__lect = 0
  w.__calc = 0
  const lecture = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function (this: any) { if (w.__dans && w.__mesure) w.__lect++; return lecture.call(this) }
  const calcule = w.getComputedStyle.bind(w)
  w.getComputedStyle = (...a: any[]) => { if (w.__mesure) w.__calc++; return (calcule as any)(...a) }
}

// la page nue du moteur de défilement (µ._mjs_fxScroll, que partagent *scrub, *gallery, *stagger, *goo et *path) : une page de 3 000 px, un conteneur `.pan` de
// 400 × 300 qui défile dès que son contenu `#r` est plus haut que lui, la balise `.cible` de 100 px dedans (`.decale` et `.loin` la poussent vers le bas) ;
// `.section` (2 000 px) porte une balise `.collee` (collante en haut) ; `.rail` défile en largeur, `.rail2` est un second rail à poser dedans
const FEUILLE = 'html,body{margin:0}.long{height:3000px}.cale{height:500px}.pan{position:absolute;left:100px;top:200px;width:400px;height:300px;overflow:auto}.plat{position:static;margin-left:100px}.demi{height:50vh}.cible{height:100px}.court{height:100px}.tiers{height:300px}.haut{height:2000px}.decale{margin-top:900px}.loin{margin-top:800px}.droite{left:550px}.rail{position:absolute;left:100px;top:200px;width:300px;height:150px;overflow-x:auto;overflow-y:hidden}.large{width:2000px;height:100px}.section{height:2000px}.collee{position:sticky;top:0}.rail2{width:500px;height:100px;overflow-x:auto;overflow-y:hidden}.vaste{width:1500px;height:100px}'

// l'horloge de la page n'avance que d'une image d'animation à l'autre (16 ms) : un geste continu se compte en images, pas en millisecondes d'une machine chargée ;
// `__img(n)` attend n images d'animation, `__ps` garde les progressions annoncées, `__pas(geste)` fait le geste, attend deux images et rend la dernière progression
const HORLOGE = () => {
  const w = window as any
  let t   = 1e6
  let vue = -1
  Date.now = () => t
  const ra = w.requestAnimationFrame.bind(w)
  w.requestAnimationFrame = (f: any) => ra((x: number) => { if (x !== vue) { vue = x; t += 16 } return f(x) })
  w.__img = (n: number) => new Promise<void>((ok) => { let k = 0; const pas = () => { if (++k >= n) ok(); else w.requestAnimationFrame(pas) }; w.requestAnimationFrame(pas) })
  w.__ps  = []
  w.__pas = async (geste: () => void) => { geste(); await w.__img(2); return w.__ps[w.__ps.length - 1] }
  // les styles calculés demandés (chaque recherche du conteneur en demande un par ancêtre)
  w.__calc = 0
  const calcule = w.getComputedStyle.bind(w)
  w.getComputedStyle = (...a: any[]) => { w.__calc++; return (calcule as any)(...a) }
}

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms))

// relit une valeur jusqu'à ce qu'elle vérifie `bon`, ou que le délai passe : rend la dernière lue
async function attend<T>(lire: () => Promise<T>, bon: (v: T) => boolean, ms = 3000): Promise<T> {
  const fin = Date.now() + ms
  let v = await lire()
  while (!bon(v) && Date.now() < fin) {
    await attendre(50)
    v = await lire()
  }
  return v
}

// ce que la page compte des images : celles qu'elle a fabriquées (`made`) et, par des références faibles relevées après gc(), celles qui vivent encore
const IMAGES = () => {
  const w = window as any
  const Image0 = w.Image
  w.__img = { made: 0, refs: [] as any[] }
  w.Image = function (...a: any[]) {
    const im = new Image0(...a)
    w.__img.made++
    w.__img.refs.push(new WeakRef(im))
    return im
  }
  w.Image.prototype = Image0.prototype
}

// compte les écritures de currentTime (chacune lance une recherche, donc une lecture du fichier)
const ECRITURES = () => {
  const w = window as any
  w.__ecrit = 0
  const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime') as PropertyDescriptor
  Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', { get() { return d.get!.call(this) }, set(v: number) { w.__ecrit++; d.set!.call(this, v) }, configurable: true })
}

// attend que `res` ait vidé son tampon (ou que le navigateur ait coupé), sans laisser d'écouteur derrière lui
const vidange = (res: ServerResponse) => new Promise<void>((ok) => {
  const fin = () => { res.off('drain', fin); res.off('close', fin); ok() }
  res.once('drain', fin)
  res.once('close', fin)
})

// un serveur local : la page à `/`, la vidéo à `/essai.webm` (Range compris) envoyée par morceaux de 64 Ko, au plus DEBIT octets par
// seconde, en attendant que le navigateur lise (contre-pression) : `lus` = ce que le navigateur a vraiment tiré de chaque requête
const DEBIT   = 3 * 1024 * 1024
const MORCEAU = 65536
async function serveur(page: string, video: Buffer) {
  const requetes: Array<{ plage: string, lus: number }> = []
  const srv = createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(page)
      return
    }
    if (req.url !== '/essai.webm') {
      res.writeHead(404)
      res.end()
      return
    }
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
    const a = m && m[1] !== '' ? Number(m[1]) : 0
    const b = m && m[2] !== '' ? Math.min(Number(m[2]), video.length - 1) : video.length - 1
    const r = { plage: req.headers.range ?? '', lus: 0 }
    requetes.push(r)
    res.writeHead(m ? 206 : 200, { 'content-type': 'video/webm', 'accept-ranges': 'bytes', 'content-length': b - a + 1, ...(m ? { 'content-range': `bytes ${a}-${b}/${video.length}` } : {}) })
    ;(async () => {
      for (let o = a; o <= b && !res.destroyed; o += MORCEAU) {
        const morceau = video.subarray(o, Math.min(o + MORCEAU, b + 1))
        if (!res.write(morceau)) await vidange(res)
        r.lus += morceau.length
        await attendre(morceau.length / DEBIT * 1000)
      }
      res.end()
    })().catch(() => {})
  })
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok))
  return {
    port:     (srv.address() as { port: number }).port,
    requetes: requetes,
    octets:   () => requetes.reduce((somme, r) => somme + r.lus, 0),
    ferme:    () => new Promise<void>((ok) => { srv.closeAllConnections(); srv.close(() => ok()) })
  }
}

describe('*scrub (navigateur réel) — vidéo, suite d\'images, survol, repos', function () {
  this.timeout(240000)
  let script = ''
  let video  = ''
  let gros   = Buffer.alloc(0)

  before(async function () {
    if (!(await navigateurPresent('chromium')) && !(await navigateurPresent('firefox')) && !(await navigateurPresent('webkit'))) return
    const root   = mjsTmp('effets-scrub')
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
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    if (AVEC_FFMPEG) {
      const f = join(root, 'essai.webm')
      const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=4:size=160x90:rate=25', '-c:v', 'libvpx', '-g', '1', '-b:v', '300k', '-pix_fmt', 'yuv420p', f])
      assert.equal(r.status, 0, String(r.stderr))
      video = 'data:video/webm;base64,' + readFileSync(f).toString('base64')
      // celle du serveur : 640 × 360, 4 s, un peu de bruit pour peser plusieurs Mo (sans preload, le navigateur n'en lit que le début)
      const g  = join(root, 'gros.webm')
      const rg = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=4:size=640x360:rate=25,noise=alls=8:allf=t', '-c:v', 'libvpx', '-g', '1', '-crf', '8', '-b:v', '8M', '-deadline', 'realtime', '-cpu-used', '8', '-pix_fmt', 'yuv420p', g])
      assert.equal(rg.status, 0, String(rg.stderr))
      gros = readFileSync(g)
      assert.ok(gros.length > 2 * 1024 * 1024, `la vidéo du serveur pèse ${gros.length} octets`)
    }
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(nom, function () {
    let present = false
    let browser: any = null

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) {
        console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
        return
      }
      const playwright = await import('playwright')
      browser = await playwright[nom].launch(nom === 'chromium' ? { args: ['--js-flags=--expose-gc'] } : {})
    })

    after(async () => { if (browser) await browser.close() })

    // la page d'un composant, à une vraie adresse ; les images de la suite sont servies par la page elle-même
    async function avec<T>(tag: string, fn: (page: any) => Promise<T>, opts: any = {}, init?: () => void): Promise<T> {
      const page = await browser.newPage({ viewport: { width: 1000, height: 800 }, ...opts })
      try {
        await page.addInitScript(COMPTEURS)
        if (init) await page.addInitScript(init)
        await page.route('http://t.test/**', (route: any) => {
          const url = route.request().url()
          const m   = /\/f-(\d+)\.svg$/.exec(url)
          if (m) return route.fulfill({ contentType: 'image/svg+xml', body: SVG(Number(m[1])) })
          if (url !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction((t: string) => !!(document.querySelector(t) as any)?._shadow?.querySelector('[mjs-fx]'), tag)
        return await fn(page)
      }
      finally {
        await page.close()
      }
    }

    // la page d'un composant servie par un vrai serveur local, qui sert aussi la vidéo d'essai et compte ce que le navigateur en tire
    async function avecServeur<T>(tag: string, fn: (page: any, srv: Awaited<ReturnType<typeof serveur>>) => Promise<T>): Promise<T> {
      const srv  = await serveur(`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>`, gros)
      const page = await browser.newPage({ viewport: { width: 1000, height: 800 } })
      try {
        await page.addInitScript(ECRITURES)
        await page.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: 'load' })
        await page.waitForFunction((t: string) => !!(document.querySelector(t) as any)?._shadow?.querySelector('video'), tag)
        return await fn(page, srv)
      }
      finally {
        await page.close()
        await srv.ferme()
      }
    }

    // la même vidéo, nue (sans l'effet), en `preload="auto"` : ce navigateur sait-il la charger ici ? WebKit sous Linux accumule un média `auto` servi en HTTP
    // dans un fichier de /var/tmp ; dossier en lecture seule (bac à sable), la vidéo n'a ni durée ni lecture (MediaError 4), effet ou pas
    const nueChargeEnAuto = (page: any) => page.evaluate(() => new Promise<{ ok: boolean, erreur: string }>((fin) => {
      const nue = document.createElement('video')
      nue.muted   = true
      nue.preload = 'auto'
      nue.addEventListener('loadedmetadata', () => fin({ ok: true, erreur: '' }))
      nue.addEventListener('error', () => fin({ ok: false, erreur: nue.error ? `MediaError ${nue.error.code} : ${nue.error.message}` : 'erreur' }))
      setTimeout(() => fin({ ok: nue.readyState >= 1, erreur: 'aucune durée au bout de 6 s' }), 6000)
      nue.src = '/essai.webm'
    }))

    const dans = (page: any, tag: string, sel: string, code: string, arg?: any) => page.evaluate(([t, s, c, a]: any[]) => {
      const el = (document.querySelector(t) as any)._shadow.querySelector(s)
      return new Function('el', 'arg', 'return ' + c)(el, a)
    }, [tag, sel, code, arg])
    const defile = (page: any, tag: string, y: number) => dans(page, tag, '.scene', '(el.scrollTop = arg, 0)', y)
    // l'image que montre la toile : le disque blanc de la rangée du milieu → son rang dans la suite (-1 : rien de dessiné)
    const rang = (page: any, tag: string) => page.evaluate((t: string) => {
      const cv  = (document.querySelector(t) as any)._shadow.querySelector('canvas')
      const ctx = cv.getContext('2d', { willReadFrequently: true })
      const W = cv.width
      const H = cv.height
      const row = ctx.getImageData(0, Math.round(H / 2), W, 1).data
      let lo = -1
      let hi = -1
      for (let x = 0; x < W; x++) {
        if (row[x * 4] > 215 && row[x * 4 + 1] > 215 && row[x * 4 + 2] > 215) {
          if (lo < 0) lo = x
          hi = x
        }
      }
      if (lo < 0) return -1
      const k = Math.max(W / 240, H / 135)
      const X = (lo + hi) / 2 / k + (240 - W / k) / 2
      return Math.round((X - 20) / 200 * 11) || 0
    }, tag)

    it('vidéo : son temps courant suit la traversée de la section collante, en pause et muette ; un lancement est remis en pause', async function () {
      if (!present || !AVEC_FFMPEG) return this.skip()
      await avec('mjs-scrub-video', async (page) => {
        await dans(page, 'mjs-scrub-video', 'video', '(el.src = arg, 0)', video)
        await page.waitForFunction(() => { const v: any = (document.querySelector('mjs-scrub-video') as any)._shadow.querySelector('video'); return v.readyState >= 1 })
        const lire = () => dans(page, 'mjs-scrub-video', 'video', '({ t: el.currentTime, dur: el.duration, muted: el.muted, paused: el.paused, preload: el.preload, seeking: el.seeking })')
        // la balise est à l'écran : preload passe à auto dès que l'observateur la dit près de la vue
        const v0 = await attend(lire, (x: any) => x.preload === 'auto')
        assert.ok(Math.abs(v0.dur - 4) < 0.1, `durée ${v0.dur}`)
        assert.deepEqual([v0.muted, v0.paused, v0.preload], [true, true, 'auto'])
        // la section fait 1 500 px, la scène 300 : la course est de 1 200 px
        for (const [p, attendu] of [[0.5, 2], [1, 3.99], [0.25, 1], [0, 0]] as Array<[number, number]>) {
          await defile(page, 'mjs-scrub-video', p * 1200)
          const v = await attend(lire, (x: any) => Math.abs(x.t - attendu) < 0.06 && !x.seeking)
          assert.ok(Math.abs(v.t - attendu) < 0.06, `p = ${p} : temps ${v.t}, attendu ${attendu}`)
        }
        // un lancement (commandes, autoplay) est aussitôt remis en pause
        await dans(page, 'mjs-scrub-video', 'video', 'el.play().catch(function() {})')
        await attendre(150)
        assert.equal((await lire()).paused, true)
      })
    })

    it('vidéo sans muted : muette le temps de l\'effet, et tout est rendu au retrait ({if} refermé)', async function () {
      if (!present || !AVEC_FFMPEG) return this.skip()
      await avec('mjs-scrub-retrait', async (page) => {
        // la balise est à l'écran : preload passe à auto dès que l'observateur la dit près de la vue
        await page.waitForFunction(() => (document.querySelector('mjs-scrub-retrait') as any)._shadow.querySelector('video').getAttribute('preload') === 'auto')
        const etat = await page.evaluate(() => {
          const v: any = (document.querySelector('mjs-scrub-retrait') as any)._shadow.querySelector('video')
          ;(window as any).__v = v
          return { muted: v.muted, attrMuted: v.hasAttribute('muted'), preload: v.getAttribute('preload'), fx: v.getAttribute('mjs-fx') }
        })
        assert.deepEqual(etat, { muted: true, attrMuted: true, preload: 'auto', fx: 'scrub' })
        await dans(page, 'mjs-scrub-retrait', '.t', 'el.click()')
        await page.waitForFunction(() => !(document.querySelector('mjs-scrub-retrait') as any)._shadow.querySelector('video'))
        const apres = await page.evaluate(() => {
          const v = (window as any).__v
          return { muted: v.muted, attrMuted: v.hasAttribute('muted'), preload: v.getAttribute('preload'), marques: v.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx')), style: v.getAttribute('style') }
        })
        assert.deepEqual(apres, { muted: false, attrMuted: false, preload: null, marques: [], style: null })
      })
    })

    it('canvas : l\'image dessinée suit le défilement (début, milieu, fin, retour) ; le suivi n\'est écouté que près de la vue', async function () {
      if (!present) return this.skip()
      await avec('mjs-scrub-images', async (page) => {
        const r0 = await attend(() => rang(page, 'mjs-scrub-images'), (v: number) => v === 0)
        assert.equal(r0, 0, 'la première image, dès qu\'elle est décodée')
        for (const [p, attendu] of [[0.5, 6], [1, 11], [0.25, 3], [0, 0]] as Array<[number, number]>) {
          await defile(page, 'mjs-scrub-images', p * 1200)
          const r = await attend(() => rang(page, 'mjs-scrub-images'), (v: number) => v === attendu)
          assert.equal(r, attendu, `p = ${p}`)
        }
      })
    })

    it('défilement : les lectures de mise en page précèdent les écritures (aucune dans une image d\'animation), le conteneur est cherché une fois par geste', async function () {
      if (!present) return this.skip()
      await avec('mjs-scrub-images', async (page) => {
        await attendre(300)
        await page.evaluate(() => {
          const w = window as any
          // l'horloge de la page avance de 16 ms par image d'animation : un geste continu se compte en images, pas en millisecondes d'une machine chargée
          let t = Date.now() + 10000
          let vue = -1
          Date.now = () => t
          const ra = w.requestAnimationFrame
          w.requestAnimationFrame = (f: any) => ra.call(w, (x: number) => { if (x !== vue) { vue = x; t += 16 } return f(x) })
          w.__lect = 0
          w.__calc = 0
          w.__mesure = true
        })
        // trente pas de 20 px de la scène, deux images d'animation entre chacun : un geste continu (jamais 100 ms sans défiler)
        for (let i = 1; i <= 30; i++) {
          await defile(page, 'mjs-scrub-images', 20 * i)
          await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
        }
        const m = await page.evaluate(() => { const w = window as any; w.__mesure = false; return { lect: w.__lect, calc: w.__calc } })
        assert.equal(m.lect, 0, 'les lectures de mise en page se font dans l\'événement de défilement, avant que les images d\'animation n\'écrivent : ' + m.lect + ' dans une image d\'animation')
        assert.ok(m.calc <= 8, 'le conteneur et la balise collante sont cherchés au début du geste, pas à chaque image : ' + m.calc + ' styles calculés en 30 pas')
      })
    })

    // une page nue qui porte le moteur : l'horloge ne bouge que d'une image d'animation à l'autre (HORLOGE), la sonde pose la balise
    async function moteur<T>(fn: (page: any) => Promise<T>): Promise<T> {
      const page = await browser.newPage({ viewport: { width: 800, height: 700 } })
      try {
        await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${FEUILLE}</style></head><body><div id="racine"></div><script>${script}</script></body></html>`, { waitUntil: 'load' })
        await page.evaluate(HORLOGE)
        return await fn(page)
      }
      finally {
        await page.close()
      }
    }

    // la progression se compte contre le conteneur qui défile autour de la balise, pas contre la fenêtre : la valeur est ce que ces tests vérifient (les gardes de lectures
    // ne voient que des comptes), chacun pour une façon différente de découvrir le conteneur
    for (const ombre of [false, true]) {
      it('défilement : un conteneur qui devient défilable après la dernière lecture est cherché dès qu\'il défile, même dans un geste continu' + (ombre ? ' (balise dans un shadow root)' : ''), async function () {
        if (!present) return this.skip()
        const vals = await moteur((page) => page.evaluate(async (ombre: boolean) => {
          const w = window as any
          document.getElementById('racine')!.innerHTML = '<div class="long"></div><div class="pan" id="p"><div id="r" class="court">' + (ombre ? '<div id="h"></div>' : '<div class="cible" id="c"></div>') + '</div></div>'
          let c = document.getElementById('c') as any
          const h = document.getElementById('h') as any
          if (ombre) {
            const sh = h.attachShadow({ mode: 'open' })
            sh.innerHTML = '<style>.cible{height:100px}</style><div class="cible" id="c"></div>'
            c = sh.getElementById('c')
          }
          const p   = document.getElementById('p') as any
          const off = w.µ._mjs_fxScroll(c, (v: number) => w.__ps.push(v))
          await w.__img(2)
          // le conteneur devient défilable (sa feuille arrive, son contenu grandit) deux images après la première lecture, et on le fait défiler aussitôt : jamais 100 ms sans lecture
          document.getElementById('r')!.className = 'haut'
          ;(ombre ? h : c).className = ombre ? 'decale' : 'cible decale'
          const res: number[] = []
          for (const y of [100, 300, 500, 700, 900, 1000]) res.push(await w.__pas(() => { p.scrollTop = y }))
          off()
          return res
        }, ombre))
        // le conteneur est à 200 px du haut de la fenêtre, 300 px de haut ; la balise (100 px) est à 900 px du haut du contenu : sous le conteneur (0) jusqu'à 600 px
        // défilés, à mi-course à 700, sortie (1) à 800 ; contre la fenêtre (700 px de haut) on lirait 0,25 à 500 et 0,75 à 700
        assert.deepEqual(vals, [0, 0, 0, 0.5, 1, 1], 'la progression se compte contre le conteneur, trouvé quand son défilement l\'annonce : ' + JSON.stringify(vals))
      })
    }

    it('défilement : un conteneur qui devient défilable pendant un geste de la page est cherché quand il se met à défiler', async function () {
      if (!present) return this.skip()
      const vals = await moteur((page) => page.evaluate(async () => {
        const w = window as any
        document.getElementById('racine')!.innerHTML = '<div class="long"><div class="cale"></div><div class="pan plat" id="p"><div id="r" class="court"><div class="cible" id="c"></div></div></div></div>'
        const c   = document.getElementById('c') as any
        const p   = document.getElementById('p') as any
        const off = w.µ._mjs_fxScroll(c, (v: number) => w.__ps.push(v))
        await w.__img(2)
        await w.__pas(() => window.scrollTo(0, 100))
        document.getElementById('r')!.className = 'haut'
        c.className = 'cible loin'
        // la page défile encore, jamais 100 ms sans lecture : le conteneur n'a pas encore bougé, rien ne dit qu'il défile
        for (const y of [150, 200, 250, 300]) await w.__pas(() => window.scrollTo(0, y))
        const res: number[] = []
        for (const s of [100, 300, 500, 600, 700]) res.push(await w.__pas(() => { p.scrollTop = s }))
        off()
        return res
      }))
      // la page est à 300 px : le conteneur, à 200 px du haut de la fenêtre, est à 200 px aussi ; la balise est à 800 px du haut du contenu : 0 jusqu'à 500 px défilés,
      // 0,5 à 600, 1 à 700 ; contre la fenêtre on lirait 0,5 à 500 et 0,75 à 600
      assert.deepEqual(vals, [0, 0, 0, 0.5, 1], 'la progression se compte contre le conteneur : ' + JSON.stringify(vals))
    })

    it('défilement : un conteneur devenu défilable est cherché au geste de la page qui suit une pause de plus de 100 ms', async function () {
      if (!present) return this.skip()
      const vals = await moteur((page) => page.evaluate(async () => {
        const w = window as any
        document.getElementById('racine')!.innerHTML = '<div class="long"><div class="cale"></div><div class="pan plat" id="p"><div id="r" class="court"><div class="cible" id="c"></div></div></div></div>'
        const off = w.µ._mjs_fxScroll(document.getElementById('c'), (v: number) => w.__ps.push(v))
        await w.__img(2)
        const avant = w.__ps[w.__ps.length - 1]
        document.getElementById('r')!.className = 'haut'
        // 19 images de 16 ms : plus de 100 ms sans lecture, puis la page défile (l'événement vient du document, il ne dit rien du conteneur)
        await w.__img(19)
        const apres = await w.__pas(() => window.scrollTo(0, 100))
        off()
        return [avant, apres]
      }))
      // avant : le conteneur n'est pas défilable, la balise est à 500 px dans une fenêtre de 700 px (0,5) ; après : la balise, en haut du conteneur, est tout entière dans
      // le conteneur (1) ; contre la fenêtre on lirait 0,75
      assert.deepEqual(vals, [0.5, 1], 'après une pause, la progression se compte contre le conteneur devenu défilable : ' + JSON.stringify(vals))
    })

    it('défilement : un redimensionnement fait chercher le conteneur de nouveau, même dans les 100 ms qui suivent une lecture', async function () {
      if (!present) return this.skip()
      const vals = await moteur(async (page) => {
        await page.evaluate(() => {
          const w = window as any
          document.getElementById('racine')!.innerHTML = '<div class="long"></div><div class="pan demi" id="p"><div id="r" class="tiers"><div class="cible" id="c"></div></div></div>'
          w.__off = w.µ._mjs_fxScroll(document.getElementById('c'), (v: number) => w.__ps.push(v))
          return w.__img(2)
        })
        const avant = await page.evaluate(() => { const w = window as any; return w.__ps[w.__ps.length - 1] })
        // le conteneur (la moitié de la fenêtre, 350 px) tient son contenu de 300 px ; à 400 px de fenêtre il ne mesure plus que 200 px et défile
        await page.setViewportSize({ width: 800, height: 400 })
        const apres = await page.evaluate(async () => { const w = window as any; await w.__img(2); const v = w.__ps[w.__ps.length - 1]; w.__off(); return v })
        return [avant, apres]
      })
      // la balise est en haut du conteneur : contre la fenêtre de 700 px elle est tout entière visible (1) ; à 400 px, contre le conteneur (200 px de haut) elle l'est encore (1),
      // contre la fenêtre on lirait 0,8
      assert.deepEqual(vals, [1, 1], 'la progression se compte contre le conteneur devenu défilable au redimensionnement : ' + JSON.stringify(vals))
    })

    it('défilement : la page et un conteneur qui défilent dans la même image se lisent après les deux, le conteneur est cherché', async function () {
      if (!present) return this.skip()
      const vals = await moteur((page) => page.evaluate(async () => {
        const w = window as any
        document.getElementById('racine')!.innerHTML = '<div class="long"><div class="cale"></div><div class="pan plat" id="p"><div id="r" class="court"><div class="cible" id="c"></div></div></div></div>'
        const c   = document.getElementById('c') as any
        const p   = document.getElementById('p') as any
        const off = w.µ._mjs_fxScroll(c, (v: number) => w.__ps.push(v))
        await w.__img(2)
        document.getElementById('r')!.className = 'haut'
        c.className = 'cible loin'
        // les deux événements de défilement partent dans la même image (un lien vers une ancre dans un conteneur fait cela) : le premier annonce la page
        const res = await w.__pas(() => { window.scrollTo(0, 300); p.scrollTop = 600 })
        off()
        return res
      }))
      // la page est à 300 px, le conteneur à 600 : la balise est à 400 px du haut de la fenêtre, le conteneur occupe de 200 à 500 : 0,5 ; contre la fenêtre on lirait 0,75
      assert.equal(vals, 0.5, 'les deux défilements sont lus ensemble, contre le conteneur : ' + vals)
    })

    it('défilement : un élément qui défile sans être un ancêtre de la balise ne fait pas chercher le conteneur', async function () {
      if (!present) return this.skip()
      const m = await moteur((page) => page.evaluate(async () => {
        const w = window as any
        document.getElementById('racine')!.innerHTML = '<div class="long"></div><div class="pan" id="p"><div class="haut"><div class="cible" id="c"></div></div></div><div class="pan droite" id="u"><div class="haut"></div></div>'
        const u = document.getElementById('u') as any
        const off = w.µ._mjs_fxScroll(document.getElementById('c'), (v: number) => w.__ps.push(v))
        await w.__img(2)
        w.__calc = 0
        // vingt pas d'un autre conteneur (le voisin), un geste continu : la balise n'est pas dedans, le conteneur de la balise est déjà connu
        for (let i = 1; i <= 20; i++) await w.__pas(() => { u.scrollTop = 20 * i })
        const calc = w.__calc
        // et le conteneur de la balise, lui, est connu : vingt pas de lui ne cherchent rien non plus
        w.__calc = 0
        for (let i = 1; i <= 20; i++) await w.__pas(() => { (document.getElementById('p') as any).scrollTop = 20 * i })
        const calc2 = w.__calc
        off()
        return { calc, calc2 }
      }))
      assert.deepEqual(m, { calc: 0, calc2: 0 }, 'aucun style calculé en vingt pas du voisin comme en vingt pas du conteneur connu : ' + JSON.stringify(m))
    })

    it('défilement : un ancêtre qui défile sans jamais être le conteneur (défilement en largeur seul) ne fait chercher qu\'une fois, pas à chaque événement', async function () {
      if (!present) return this.skip()
      const calc = await moteur((page) => page.evaluate(async () => {
        const w = window as any
        document.getElementById('racine')!.innerHTML = '<div class="long"></div><div class="rail" id="r"><div class="large"><div class="cible" id="c"></div></div></div>'
        const r   = document.getElementById('r') as any
        const off = w.µ._mjs_fxScroll(document.getElementById('c'), (v: number) => w.__ps.push(v))
        await w.__img(2)
        w.__calc = 0
        // vingt pas en largeur : l'ancêtre défile mais rien ne défile en hauteur, il n'est jamais le conteneur ; une recherche (un style calculé par ancêtre) au premier pas, aucune ensuite
        for (let i = 1; i <= 20; i++) await w.__pas(() => { r.scrollLeft = 20 * i })
        const res = w.__calc
        off()
        return res
      }))
      assert.ok(calc > 0 && calc <= 8, 'une seule recherche pour vingt pas du même ancêtre, pas une par événement : ' + calc + ' styles calculés')
    })

    it('défilement : deux ancêtres imbriqués qui défilent en largeur dans la même image ne font chercher qu\'une fois chacun, pas à chaque événement', async function () {
      if (!present) return this.skip()
      const calc = await moteur((page) => page.evaluate(async () => {
        const w = window as any
        document.getElementById('racine')!.innerHTML = '<div class="long"></div><div class="rail" id="r1"><div class="large"><div class="rail2" id="r2"><div class="vaste"><div class="cible" id="c"></div></div></div></div></div>'
        const r1  = document.getElementById('r1') as any
        const r2  = document.getElementById('r2') as any
        const off = w.µ._mjs_fxScroll(document.getElementById('c'), (v: number) => w.__ps.push(v))
        await w.__img(2)
        w.__calc = 0
        // vingt pas où les deux rails défilent ensemble : aucun n'est le conteneur ; chacun fait chercher à son premier événement, aucun ensuite (huit ancêtres : huit styles calculés par recherche)
        for (let i = 1; i <= 20; i++) await w.__pas(() => { r1.scrollLeft = 10 * i; r2.scrollLeft = 10 * i })
        const res = w.__calc
        off()
        return res
      }))
      assert.ok(calc > 0 && calc <= 16, 'deux recherches pour vingt pas des deux mêmes ancêtres, pas une par événement : ' + calc + ' styles calculés')
    })

    it('défilement : une balise qui cesse d\'être collante n\'est plus lue sur sa section, dès le geste qui suit une pause de plus de 100 ms', async function () {
      if (!present) return this.skip()
      const vals = await moteur((page) => page.evaluate(async () => {
        const w = window as any
        document.getElementById('racine')!.innerHTML = '<div class="section"><div class="cale"></div><div class="cible collee" id="c"></div></div><div class="long"></div>'
        const c   = document.getElementById('c') as any
        const off = w.µ._mjs_fxScroll(c, (v: number) => w.__ps.push(v))
        await w.__img(2)
        // collée en haut de sa section de 2 000 px (700 px de fenêtre) : la progression est celle de la section, 650 px défilés sur une course de 1 300 px
        const collee = await w.__pas(() => window.scrollTo(0, 650))
        c.className = 'cible'
        // plus de 100 ms sans défiler : le geste suivant cherche de nouveau la balise collante, il n'y en a plus
        await w.__img(19)
        const libre = await w.__pas(() => window.scrollTo(0, 100))
        off()
        return [collee, libre]
      }))
      // la balise, à 500 px du haut de la page, est à 400 px du haut de la fenêtre à 100 px défilés : (700 - 400) / (350 + 50) = 0,75 ; lue sur sa section on lirait 100 / 1 300 = 0,077
      assert.deepEqual(vals, [0.5, 0.75], 'la balise redevenue ordinaire se lit contre la fenêtre : ' + JSON.stringify(vals))
    })

    it('défilement : une balise devenue collante est lue sur sa section au geste qui suit une pause de plus de 100 ms', async function () {
      if (!present) return this.skip()
      const vals = await moteur((page) => page.evaluate(async () => {
        const w = window as any
        document.getElementById('racine')!.innerHTML = '<div class="section"><div class="cale"></div><div class="cible" id="c"></div></div><div class="long"></div>'
        const c   = document.getElementById('c') as any
        const off = w.µ._mjs_fxScroll(c, (v: number) => w.__ps.push(v))
        await w.__img(2)
        await w.__pas(() => window.scrollTo(0, 50))
        // une feuille arrive : la balise devient collante ; la page ne s'arrête pas pour autant de défiler
        c.className = 'cible collee'
        await w.__img(19)
        const res = await w.__pas(() => window.scrollTo(0, 650))
        off()
        return res
      }))
      // lue sur sa section de 2 000 px : 650 px défilés sur une course de 1 300 px ; collée en haut de la fenêtre, contre la fenêtre on lirait 1
      assert.equal(vals, 0.5, 'la balise collante se lit sur sa section : ' + vals)
    })

    it('retrait : off() annule l\'image d\'animation demandée, rien n\'est appelé après lui', async function () {
      if (!present) return this.skip()
      const n = await moteur((page) => page.evaluate(async () => {
        const w = window as any
        document.getElementById('racine')!.innerHTML = '<div class="long"><div class="cible" id="c"></div></div>'
        const off = w.µ._mjs_fxScroll(document.getElementById('c'), (v: number) => w.__ps.push(v))
        // la première lecture attend l'image d'animation : retiré avant elle, l'effet ne doit rien appeler
        off()
        await w.__img(3)
        return w.__ps.length
      }))
      assert.equal(n, 0, 'l\'image demandée à la pose est annulée par off() : ' + n + ' appel(s) après le retrait')
    })

    it('retrait : off() rend l\'écouteur de redimensionnement', async function () {
      if (!present) return this.skip()
      const n = await moteur((page) => page.evaluate(async () => {
        const w = window as any
        document.getElementById('racine')!.innerHTML = '<div class="long"><div class="cible" id="c"></div></div>'
        const off = w.µ._mjs_fxScroll(document.getElementById('c'), (v: number) => w.__ps.push(v))
        await w.__img(2)
        off()
        const avant = w.__ps.length
        window.dispatchEvent(new Event('resize'))
        await w.__img(3)
        return w.__ps.length - avant
      }))
      assert.equal(n, 0, 'un redimensionnement après off() ne rappelle rien : ' + n + ' appel(s)')
    })

    it('retrait : off() rend l\'écouteur de défilement de la fenêtre', async function () {
      if (!present) return this.skip()
      const res = await moteur((page) => page.evaluate(async () => {
        const w = window as any
        document.getElementById('racine')!.innerHTML = '<div class="long"><div class="cible" id="c"></div></div>'
        const off = w.µ._mjs_fxScroll(document.getElementById('c'), (v: number) => w.__ps.push(v))
        await w.__img(2)
        // pendant la pose, un défilement de la fenêtre appelle bien l'effet (le témoin : sans lui le test ne prouve rien)
        const pose = w.__ps.length
        window.scrollTo(0, 150)
        await w.__img(3)
        const pendant = w.__ps.length - pose
        off()
        const avant = w.__ps.length
        window.scrollTo(0, 400)
        await w.__img(3)
        return { pendant, apres: w.__ps.length - avant }
      }))
      assert.ok(res.pendant > 0, 'le défilement de la fenêtre pendant la pose appelle l\'effet : ' + res.pendant + ' appel(s)')
      assert.equal(res.apres, 0, 'un défilement de la fenêtre après off() ne rappelle rien : ' + res.apres + ' appel(s)')
    })

    for (const ombre of [false, true]) {
      it('retrait : off() rend les écouteurs des racines, le défilement du conteneur n\'appelle plus rien' + (ombre ? ' (balise dans un shadow root)' : ''), async function () {
        if (!present) return this.skip()
        const n = await moteur((page) => page.evaluate(async (ombre: boolean) => {
          const w = window as any
          const pan = '<div class="pan" id="p"><div class="haut"><div class="cible" id="c"></div></div></div>'
          let racine: any = document
          if (ombre) {
            document.getElementById('racine')!.innerHTML = '<div class="long"></div><div id="h"></div>'
            racine = document.getElementById('h')!.attachShadow({ mode: 'open' })
            racine.innerHTML = '<style>.pan{position:absolute;left:100px;top:200px;width:400px;height:300px;overflow:auto}.haut{height:2000px}.cible{height:100px}</style>' + pan
          }
          else document.getElementById('racine')!.innerHTML = '<div class="long"></div>' + pan
          const off = w.µ._mjs_fxScroll(racine.getElementById('c'), (v: number) => w.__ps.push(v))
          await w.__img(2)
          off()
          const avant = w.__ps.length
          racine.getElementById('p').scrollTop = 100
          await w.__img(3)
          return w.__ps.length - avant
        }, ombre))
        assert.equal(n, 0, 'le défilement du conteneur après off() ne rappelle rien : ' + n + ' appel(s)')
      })
    }

    it('canvas : la toile a la taille de la balise × la densité de l\'écran, au plus 2', async function () {
      if (!present) return this.skip()
      for (const [dpr, attendu] of [[1, 1], [2, 2], [3, 2]] as Array<[number, number]>) {
        await avec('mjs-scrub-images', async (page) => {
          await attend(() => rang(page, 'mjs-scrub-images'), (v: number) => v === 0)
          const t = await dans(page, 'mjs-scrub-images', 'canvas', '({ w: el.width, h: el.height, cw: el.clientWidth, ch: el.clientHeight })')
          assert.equal(t.w, Math.round(t.cw * attendu), `densité ${dpr}`)
          assert.equal(t.h, Math.round(t.ch * attendu), `densité ${dpr}`)
        }, { deviceScaleFactor: dpr })
      }
    })

    it('survol : l\'image suit la souris de gauche à droite de la balise ; l\'adresse d\'origine est rendue au retrait', async function () {
      if (!present) return this.skip()
      await avec('mjs-scrub-survol', async (page) => {
        const b = await dans(page, 'mjs-scrub-survol', 'img', '(function(r) { return { x: r.left, y: r.top + r.height / 2, w: r.width } })(el.getBoundingClientRect())')
        const src = () => dans(page, 'mjs-scrub-survol', 'img', '(/f-(\\d+)\\.svg/.exec(el.src) || [])[1]')
        assert.equal(await src(), '001', 'avant le survol : l\'image d\'origine')
        for (const [f, attendu] of [[0.02, '001'], [0.5, '007'], [0.98, '012'], [0.25, '004']] as Array<[number, string]>) {
          await page.mouse.move(b.x + b.w * f, b.y, { steps: 3 })
          const s = await attend(src, (v: string) => v === attendu)
          assert.equal(s, attendu, `souris à ${f * 100} %`)
        }
      })
    })

    it('une liste d\'adresses data: écrite telle quelle dans la balise se compile et se dessine', async function () {
      if (!present) return this.skip()
      await avec('mjs-scrub-fixes', async (page) => {
        const px = () => page.evaluate(() => {
          const cv = (document.querySelector('mjs-scrub-fixes') as any)._shadow.querySelector('canvas')
          const d = cv.getContext('2d', { willReadFrequently: true }).getImageData(cv.width >> 1, cv.height >> 1, 1, 1).data
          return [d[0], d[1], d[2], d[3]]
        })
        // une balise qui n'est pas collante a parcouru toute sa course quand elle passe le milieu de l'écran : tout en haut
        // de la page, c'est la dernière image, la bleue
        const p = await attend(px, (v: number[]) => v[2] === 255 && v[3] === 255)
        assert.deepEqual(p, [0, 0, 255, 255], 'la dernière image est bleue')
      })
    })

    it('une toile sans taille CSS, sur un écran de densité 2, garde sa taille : elle ne grossit pas à chaque mesure', async function () {
      if (!present) return this.skip()
      await avec('mjs-scrub-sans-css', async (page) => {
        await attendre(500)
        const lire = () => dans(page, 'mjs-scrub-sans-css', 'canvas', '({ w: el.width, h: el.height, cw: el.clientWidth, ch: el.clientHeight, st: el.getAttribute("style") })')
        const a = await lire()
        await attendre(700)
        const b = await lire()
        assert.deepEqual(b, a, 'rien ne bouge d\'une mesure à l\'autre')
        assert.deepEqual([a.cw, a.ch], [300, 150], 'la taille qu\'elle avait avant l\'effet')
        assert.deepEqual([a.w, a.h], [600, 300], 'le bitmap suit la densité')
      }, { deviceScaleFactor: 2 })
    })

    it('au repos : aucune image d\'animation en attente ; le défilement n\'est écouté que quand la balise est près de la vue', async function () {
      if (!present) return this.skip()
      await avec('mjs-scrub-loin', async (page) => {
        const compte = () => page.evaluate(() => ({ raf: (window as any).__raf.size, defilement: (window as any).__scroll.size }))
        await attendre(500)
        assert.deepEqual(await compte(), { raf: 0, defilement: 0 }, 'la balise est à 4 000 px : rien n\'est écouté, rien ne tourne')
        const chargees = await page.evaluate(() => performance.getEntriesByType('resource').filter((e) => /\/f-\d+\.svg/.test(e.name)).length)
        assert.equal(chargees, 0, 'et aucune image n\'est demandée')
        await page.evaluate(() => window.scrollTo(0, 3500))
        const pres = await attend(compte, (v: any) => v.defilement > 0)
        assert.ok(pres.defilement >= 1, 'près de la vue : le défilement est écouté')
        await attend(() => rang(page, 'mjs-scrub-loin'), (v: number) => v === 0)
        await dans(page, 'mjs-scrub-loin', '.scene', '(el.scrollTop = 600, 0)')
        await attend(() => rang(page, 'mjs-scrub-loin'), (v: number) => v === 6)
        await attendre(400)
        assert.equal((await compte()).raf, 0, 'défilement fini : plus aucune image d\'animation')
        await page.evaluate(() => window.scrollTo(0, 0))
        const loin = await attend(compte, (v: any) => v.defilement === 0)
        assert.equal(loin.defilement, 0, 'de nouveau loin : plus d\'écouteur de défilement')
      })
    })

    it('vidéo loin de la vue : pas une requête ni un octet de plus que la même balise sans l\'effet, et le preload de l\'auteur reste en place', async function () {
      if (!present || !AVEC_FFMPEG) return this.skip()
      const mesure = (tag: string) => avecServeur(tag, async (page, srv) => {
        await attendre(2000)
        const preload = await page.evaluate((t: string) => (document.querySelector(t) as any)._shadow.querySelector('video').getAttribute('preload'), tag)
        return { requetes: srv.requetes.length, octets: srv.octets(), preload, ecrit: await page.evaluate(() => (window as any).__ecrit) }
      })
      const temoin = await mesure('mjs-scrub-video-loin-sans')
      const scrub  = await mesure('mjs-scrub-video-loin')
      assert.ok(temoin.octets > 0, 'le témoin (la même balise sans l\'effet) lit bien le début du fichier')
      assert.ok(scrub.requetes <= temoin.requetes, `requêtes : ${scrub.requetes} avec l'effet (${scrub.octets} octets), ${temoin.requetes} sans (${temoin.octets} octets)`)
      // la lecture du début varie de quelques centaines de Ko d'un essai à l'autre ; tirer le fichier entier (plus de 3 Mo) la dépasse de loin
      assert.ok(scrub.octets <= temoin.octets + 1024 * 1024, `octets lus : ${scrub.octets} avec l'effet, ${temoin.octets} sans (fichier de ${gros.length})`)
      assert.equal(scrub.preload, null, 'le preload n\'est pas touché')
      assert.equal(scrub.ecrit, 0, 'et aucune recherche : currentTime n\'est pas écrit')
    })

    it('vidéo avec preload="none" : aucune requête tant qu\'elle est loin ; à l\'approche preload passe à auto, elle charge et son temps suit le défilement ; le preload de l\'auteur est rendu au retrait', async function () {
      if (!present || !AVEC_FFMPEG) return this.skip()
      const tag = 'mjs-scrub-video-loin-aucun'
      await avecServeur(tag, async (page, srv) => {
        await page.evaluate((t: string) => { (window as any).__v = (document.querySelector(t) as any)._shadow.querySelector('video') }, tag)
        const lire = () => page.evaluate(() => { const v = (window as any).__v; return { preload: v.getAttribute('preload'), t: v.currentTime, paused: v.paused, ready: v.readyState } })
        await attendre(1500)
        const loin = await lire()
        assert.deepEqual([loin.preload, loin.ready, srv.requetes.length, await page.evaluate(() => (window as any).__ecrit)], ['none', 0, 0, 0], 'loin : le preload de l\'auteur, rien de chargé, aucune requête, aucune recherche')
        // son milieu au milieu de l'écran : la fin de la vidéo
        await page.evaluate(() => window.scrollTo(0, 5780))
        const v = await attend(lire, (x: any) => x.preload === 'auto' && Math.abs(x.t - 3.99) < 0.06, 8000)
        assert.equal(v.preload, 'auto', 'à l\'approche : auto')
        // un temps qui ne suit pas alors que la même vidéo nue n'a pas de durée non plus : le navigateur ne charge pas ce média ici, l'effet n'y est pour rien (test sauté, pas validé)
        if (!(Math.abs(v.t - 3.99) < 0.06)) {
          const nue = await nueChargeEnAuto(page)
          if (!nue.ok) {
            console.log(`  ℹ️  ${nom} : la vidéo nue en preload="auto" n'a pas de durée non plus (${nue.erreur}), le temps ne peut pas être éprouvé ici, test sauté`)
            return this.skip()
          }
        }
        assert.ok(Math.abs(v.t - 3.99) < 0.06, `temps ${v.t}, attendu 3.99`)
        assert.equal(v.paused, true)
        assert.ok(srv.requetes.length > 0, 'la vidéo a été demandée')
        assert.ok(await page.evaluate(() => (window as any).__ecrit) >= 1, 'et cherchée')
        await dans(page, tag, '.t', 'el.click()')
        await page.waitForFunction((t: string) => !(document.querySelector(t) as any)._shadow.querySelector('video'), tag)
        assert.equal(await page.evaluate(() => (window as any).__v.getAttribute('preload')), 'none', 'rendu au retrait')
      })
    })

    it('suite d\'images : lâchée quand la balise s\'éloigne (plus aucune image vivante), rechargée à son retour', async function () {
      if (!present) return this.skip()
      const tag = 'mjs-scrub-va-et-vient'
      await avec(tag, async (page) => {
        const compte = () => page.evaluate(() => ({ faites: (window as any).__img.made, defilement: (window as any).__scroll.size }))
        const vivantes = () => page.evaluate(async () => {
          const w = window as any
          for (let i = 0; i < 4; i++) {
            w.gc()
            await new Promise((r) => setTimeout(r, 100))
          }
          return w.__img.refs.filter((r: any) => r.deref()).length
        })
        const rangEn = (n: number) => attend(() => rang(page, tag), (v: number) => v === n)
        assert.equal(await rangEn(0), 0)
        const pleine = await attend(compte, (v: any) => v.faites === N)
        assert.equal(pleine.faites, N, 'près de la vue : toute la suite est demandée')
        // à mi-course, puis loin
        await defile(page, tag, 600)
        assert.equal(await rangEn(6), 6)
        await page.evaluate(() => window.scrollTo(0, 3500))
        await attend(compte, (v: any) => v.defilement === 0)
        // gc() n'existe que dans Chromium (lancé avec --expose-gc) ; ailleurs, c'est le rechargement ci-dessous qui prouve le lâcher
        if (await page.evaluate(() => typeof (window as any).gc === 'function')) {
          assert.equal(await vivantes(), 0, 'loin de la vue : plus aucune image de la suite ne vit')
        }
        // le retour : toute la suite est redemandée, la toile montre toujours l'image où l'on est
        await page.evaluate(() => window.scrollTo(0, 0))
        const retour = await attend(compte, (v: any) => v.faites === 2 * N)
        assert.equal(retour.faites, 2 * N, 'de retour près de la vue : toute la suite est redemandée')
        assert.equal(await rangEn(6), 6)
      }, {}, IMAGES)
    })
  })
})
