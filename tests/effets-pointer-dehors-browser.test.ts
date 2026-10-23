// *pointer(lens, outside: true) dans Chromium et Firefox réels : le filtre s'applique PARTOUT SAUF dans le disque, qui reste
// net et suit la souris. Les pixels se lisent sur une capture, sur un fond de rayures rouges et bleues de 4 px : une rayure
// nette est un rouge ou un bleu pur, une rayure floutée un mélange (127, 0, 127). Ce qu'on prouve : avant la souris la page
// est nette, puis loin de la souris le flou, sous la souris le net ; une page sans l'effet donne la même capture qu'avant
// le geste ; le trou suit la souris ; sur une balise le flou reste dans la balise, sur <@document> il couvre la page ; le
// bord du trou est adouci ; le disque grossit sur ce qui se clique et se resserre à l'appui (le rayon du trou, lu et vu) ;
// la page qui défile sous une souris immobile garde le trou sous la souris ; rien ne tourne au repos ; `outside` tenu par
// une variable se pose et se défait sans reste ; sans `outside` rien ne change (la lentille floute SOUS la souris, la page
// reste nette) ; « réduire les animations » ; un écran sans souris. Firefox : sa capture d'écran de Playwright ne peint pas
// `backdrop-filter` (le chemin de capture n'a pas de compositeur) : il est lancé avec un écran virtuel (Xvfb) et ses pixels
// se lisent sur l'écran (ImageMagick `import`) ; sans ces deux outils, ses tests sont sautés.

import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { LECTURES } from './helpers/lectures-images.js'

async function navigateurPresent(nom: 'chromium' | 'firefox'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

// un écran virtuel pour Firefox : le numéro d'écran est choisi par Xvfb lui-même (`-displayfd`), rien n'est deviné
async function ecranVirtuel(): Promise<{ display: string, arret: () => void } | null> {
  try {
    execFileSync('import', ['-version'], { stdio: 'ignore' })
    const x = spawn('Xvfb', ['-displayfd', '3', '-screen', '0', '1280x1024x24', '-nolisten', 'tcp'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe'] })
    const numero = await new Promise<string>((ok, ko) => {
      let texte = ''
      const delai = setTimeout(() => ko(new Error('Xvfb : pas de numéro d\'écran')), 20000)
      x.stdio[3]!.on('data', (d: Buffer) => {
        texte += d.toString()
        if (texte.includes('\n')) {
          clearTimeout(delai)
          ok(texte.trim())
        }
      })
      x.on('error', ko)
      x.on('exit', () => ko(new Error('Xvfb est parti')))
    })
    return { display: ':' + numero, arret: () => { x.kill() } }
  } catch {
    return null
  }
}

// des rayures verticales rouges et bleues de 4 px : nettes, un rouge ou un bleu pur ; floutées, un mélange
const RAYURES = 'repeating-linear-gradient(90deg, #f00 0, #f00 4px, #00f 4px, #00f 8px)'

// la scène d'une balise : un fond rayé de 480 × 380, la balise de 400 × 300 posée à (20, 20), bordée de 10 px et arrondie (le voile en prend le repère et l'arrondi),
// un lien à data-pointer (page 310..410 × 130..230)
const scene = (fx: string, lien = true, style = '') => [
  '<div class="fond">',
  `  <div class="s" ${fx}>${lien ? '<a class="k" href="#x" data-pointer="Voir" aria-label="Voir"></a>' : ''}</div>`,
  '</div>',
  '<style>',
  '.fond',
  '  width: 440px',
  '  height: 340px',
  '  padding: 20px',
  `  background: ${RAYURES}`,
  '.s',
  '  position: relative',
  '  box-sizing: border-box',
  '  width: 400px',
  '  height: 300px',
  '  border: 10px solid #123',
  '  border-radius: 40px',
  `  background: ${RAYURES}`,
  '.k',
  '  position: absolute',
  '  left: 280px',
  '  top: 100px',
  '  width: 100px',
  '  height: 100px',
  style,
  '</style>',
  ''
].join('\n')

const REGLAGES = 'lens, outside: true, filter: blur, size: 100, grow: 2, press: .5, smooth: 1'

const SOURCES: Record<string, string> = {
  'pt-do-balise.mjs':  scene(`*pointer(${REGLAGES})`),
  'pt-do-sans.mjs':    scene('', true),
  'pt-do-normal.mjs':  scene('*pointer(lens, filter: blur, size: 100, grow: 2, press: .5, smooth: 1)'),
  'pt-do-faux.mjs':    scene('*pointer(lens, outside: false, filter: blur, size: 100, grow: 2, press: .5, smooth: 1)'),
  'pt-do-gris.mjs':    scene('*pointer(lens, outside: true, size: 100, smooth: 1)'),
  'pt-do-disque.mjs':  scene('*pointer(disc, outside: true, size: 100, smooth: 1)'),
  'pt-do-variable.mjs': [
    '<script>',
    '$dehors = true',
    '</script>',
    '<div class="fond">',
    '  <div class="s" *pointer(lens, outside: $dehors, filter: blur, size: 100, smooth: 1)></div>',
    '</div>',
    '<button class="b" @click={$dehors = !$dehors}>b</button>',
    '<style>',
    '.fond',
    '  width: 440px',
    '  height: 340px',
    '  padding: 20px',
    `  background: ${RAYURES}`,
    '.s',
    '  width: 400px',
    '  height: 300px',
    `  background: ${RAYURES}`,
    '</style>',
    ''
  ].join('\n'),
  'pt-do-page.mjs': [
    '<@document *pointer(lens, outside: true, filter: blur, size: 100, smooth: 1)></@document>',
    '<div class="plein"></div>',
    '<style>',
    '.plein',
    '  width: 800px',
    '  height: 700px',
    `  background: ${RAYURES}`,
    '</style>',
    ''
  ].join('\n'),
  'pt-do-defile.mjs': [
    '<div class="haut">',
    '  <div class="s" *pointer(lens, outside: true, filter: blur, size: 100, smooth: 1)></div>',
    '</div>',
    '<style>',
    '.haut',
    '  height: 2000px',
    '.s',
    '  position: relative',
    '  width: 400px',
    '  height: 1500px',
    `  background: ${RAYURES}`,
    '</style>',
    ''
  ].join('\n')
}

// compte les images d'animation, les minuteries, les intervalles demandés depuis le chargement, et les écouteurs de défilement ou de redimensionnement posés (moins ceux retirés)
const COMPTE = `(() => {
  window.__n = { raf: 0, to: 0, iv: 0, sc: 0 }
  const add = EventTarget.prototype.addEventListener
  const rem = EventTarget.prototype.removeEventListener
  EventTarget.prototype.addEventListener = function (t, ...a) {
    if (t === 'scroll' || t === 'resize') {
      window.__n.sc++
      // l'outil de surveillance retire ses écouteurs par un AbortSignal, sans removeEventListener : l'annulation du signal les défait
      const sg = a[1] && a[1].signal
      if (sg) sg.addEventListener('abort', () => { window.__n.sc-- })
    }
    return add.call(this, t, ...a)
  }
  EventTarget.prototype.removeEventListener = function (t, ...a) { if (t === 'scroll' || t === 'resize') window.__n.sc--; return rem.call(this, t, ...a) }
  const raf = window.requestAnimationFrame
  window.requestAnimationFrame = (f) => { window.__n.raf++; return raf.call(window, f) }
  const to = window.setTimeout
  window.setTimeout = function (...a) { window.__n.to++; return to.apply(window, a) }
  const iv = window.setInterval
  window.setInterval = function (...a) { window.__n.iv++; return iv.apply(window, a) }
})()`

type Pixel = number[]

// une rayure nette : un rouge ou un bleu pur ; une rayure floutée : un mélange des deux
const net   = (p: Pixel) => (p[0] >= 245 && p[2] <= 10) || (p[2] >= 245 && p[0] <= 10)
const flou  = (p: Pixel) => Math.abs(p[0] - 127) < 30 && Math.abs(p[2] - 127) < 30 && p[1] < 10

let compilation: Promise<string> | null = null
function compile(): Promise<string> {
  compilation ??= (async () => {
    const root   = mjsTmp('effets-pointer-dehors-browser')
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
    return [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })()
  return compilation
}

for (const nom of ['chromium', 'firefox'] as const) {
  describe(`*pointer(lens, outside) (${nom} réel)`, function () {
    this.timeout(300000)
    let present = false
    let script  = ''
    let browser: any = null
    let ecran: { display: string, arret: () => void } | null = null

    before(async function () {
      present = await navigateurPresent(nom)
      if (present && nom === 'firefox') {
        ecran = await ecranVirtuel()
        if (!ecran) present = false
      }
      if (!present) {
        console.log(`  ℹ️  ${nom} indisponible (${nom === 'firefox' ? 'ni Firefox, ni Xvfb et ImageMagick' : 'non installé'}), test de *pointer(outside) sauté`)
        return
      }
      script = await compile()
      const { chromium, firefox } = await import('playwright')
      browser = nom === 'chromium'
        ? await chromium.launch({ args: ['--no-sandbox', '--enable-unsafe-swiftshader'] })
        : await firefox.launch({ headless: false, env: { ...process.env, DISPLAY: ecran!.display } })
    })

    after(async () => {
      if (browser) await browser.close()
      if (ecran) ecran.arret()
      await terminateSharedWorkerPool()
    })

    // une page du composant `tag` ; `pixels(points)` lit les pixels d'UNE capture : Chromium la fait lui-même, Firefox la prend sur l'écran
    async function ouvre(tag: string, options: any = {}) {
      const contexte = await browser.newContext({ viewport: { width: 800, height: 700 }, ...options })
      const page     = await contexte.newPage()
      const erreurs: string[] = []
      page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') erreurs.push(m.text()) })
      page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e)))
      await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => true }))
      await page.addInitScript(COMPTE)
      await page.route('http://t.test/**', (route: any) => {
        if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
      })
      await page.goto('http://t.test/', { waitUntil: 'load' })
      await page.waitForFunction((t: string) => ((document.querySelector(t) as any)?._shadow?.childElementCount ?? 0) > 0, tag)
      await page.waitForTimeout(300)
      const capture = async (): Promise<Buffer> => {
        if (nom === 'chromium') return page.screenshot()
        const o = await page.evaluate(() => ({ x: (window as any).mozInnerScreenX, y: (window as any).mozInnerScreenY }))
        return execFileSync('import', ['-window', 'root', '-crop', `800x700+${Math.round(o.x)}+${Math.round(o.y)}`, '+repage', 'png:-'], { maxBuffer: 64 * 1024 * 1024, env: { ...process.env, DISPLAY: ecran!.display } })
      }
      const pixels = async (points: Array<[number, number]>): Promise<Pixel[]> => {
        const png = await capture()
        return page.evaluate(async ({ b64, pts }: any) => {
          const image = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob())
          const ctx   = new OffscreenCanvas(image.width, image.height).getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D
          ctx.drawImage(image, 0, 0)
          return pts.map(([x, y]: number[]) => Array.from(ctx.getImageData(x, y, 1, 1).data).slice(0, 3))
        }, { b64: png.toString('base64'), pts: points }) as Promise<Pixel[]>
      }
      const un = async (x: number, y: number) => (await pixels([[x, y]]))[0]
      // le voile (le calque percé) et son rayon de trou, tels que le navigateur les calcule
      const voile = () => page.evaluate((t: string) => {
        const racine = (document.querySelector(t) as any)._shadow
        const v = (document.querySelector('[mjs-fx-layer="pointer"]') || racine.querySelector('[mjs-fx-layer="pointer"]')) as HTMLElement | null
        if (!v) return null
        const c = getComputedStyle(v)
        return { rayon: parseFloat(c.getPropertyValue('--mjs-fx-pointer-r')), arrondi: c.borderTopLeftRadius, opacite: c.opacity, visibilite: c.visibility, position: c.position, duree: c.transitionDuration, attrs: v.getAttributeNames().filter((n) => n.startsWith('mjs-fx-pointer-')), parent: v.parentElement ? v.parentElement.localName + '.' + v.parentElement.className : '' }
      }, tag)
      // attend que le disque ait rejoint la souris ; s'il y a un voile, qu'il soit allumé et que son trou ait la taille attendue (la transition est jouée) ; puis laisse le navigateur peindre
      const pret = async (rayon: number) => {
        await page.waitForFunction(() => !document.querySelector('[mjs-fx-pointer-layer][mjs-fx-pointer-live]'), null, { timeout: 15000 })
        const existe = await page.evaluate((t: string) => !!(document.querySelector('[mjs-fx-layer="pointer"]') || (document.querySelector(t) as any)._shadow.querySelector('[mjs-fx-layer="pointer"]')), tag)
        if (existe) {
          await page.waitForFunction(({ t, r }: any) => {
            const racine = (document.querySelector(t) as any)._shadow
            const v = (document.querySelector('[mjs-fx-layer="pointer"]') || racine.querySelector('[mjs-fx-layer="pointer"]')) as HTMLElement | null
            if (!v) return false
            const c = getComputedStyle(v)
            return c.opacity === '1' && Math.abs(parseFloat(c.getPropertyValue('--mjs-fx-pointer-r')) - r) < 0.6
          }, { t: tag, r: rayon }, { timeout: 15000 })
        }
        await page.waitForTimeout(nom === 'firefox' ? 600 : 350)
      }
      const compteurs = () => page.evaluate(() => ({ ...(window as any).__n }))
      return { page, contexte, erreurs, pixels, un, voile, pret, compteurs }
    }

    // les trois positions de la souris sur la scène d'une balise : A en bas à gauche du lien (hors du lien), L au centre du lien
    const A: [number, number] = [150, 170]
    const L: [number, number] = [350, 170]

    it('loin de la souris la balise est floue, sous la souris elle est nette ; avant la souris, comme sans l\'effet ; la page autour de la balise reste nette ; le trou suit la souris', async function () {
      if (!present) return this.skip()
      const sans = await ouvre('mjs-pt-do-sans')
      await sans.page.mouse.move(150, 170, { steps: 3 })
      await sans.page.waitForTimeout(300)
      const ref = await sans.pixels([[225, 170], [60, 60], [450, 200], [200, 350]])
      assert.ok(ref.every(net), 'la page sans l\'effet : nette partout, ' + JSON.stringify(ref))
      await sans.contexte.close()
      const { page, contexte, pixels, voile, pret, erreurs } = await ouvre('mjs-pt-do-balise')
      const points: Array<[number, number]> = [[225, 170], [60, 60], [450, 200], [200, 350], [150, 170], [350, 250]]
      // avant la souris : la même capture que la page sans l'effet, le voile n'existe que caché
      const avant = await pixels(points)
      assert.ok(avant.every(net), 'avant la souris : nette partout, ' + JSON.stringify(avant))
      const v0 = await voile()
      assert.ok(v0 === null || v0.visibilite === 'hidden', 'le voile, s\'il existe, est caché tant que la souris n\'est pas venue')
      // la souris entre dans la balise
      await page.mouse.move(A[0] - 40, A[1], { steps: 3 })
      await page.mouse.move(A[0], A[1], { steps: 3 })
      await pret(50)
      const [loin, coin, bord, bas, sous, plusLoin] = await pixels(points)
      assert.ok(flou(loin), 'à 75 px de la souris : floue (rayon 50), ' + loin)
      assert.ok(flou(coin), 'dans le coin de la balise : floue, ' + coin)
      assert.ok(flou(plusLoin), 'loin de la souris : floue, ' + plusLoin)
      assert.ok(net(sous), 'sous la souris : nette, ' + sous)
      assert.ok(net(bord) && net(bas), 'autour de la balise (le fond de la page) : net, ' + bord + ' ' + bas)
      // le trou suit la souris : il quitte A, il arrive en B
      await page.mouse.move(350, 250, { steps: 5 })
      await pret(50)
      const [ancien, nouveau, aussi] = await pixels([[150, 170], [350, 250], [225, 170]])
      assert.ok(flou(ancien), 'l\'ancienne place du trou est floue, ' + ancien)
      assert.ok(net(nouveau), 'sa nouvelle place est nette, ' + nouveau)
      assert.ok(flou(aussi), 'le reste est flou, ' + aussi)
      const v1 = await voile()
      assert.ok(v1, 'le voile existe, dans la balise')
      assert.equal(v1!.arrondi, '40px', 'le voile prend l\'arrondi de la balise')
      assert.deepEqual(erreurs, [], 'aucune erreur ni avertissement de console')
      await contexte.close()
    })

    it('aucune lecture de mise en page dans les images d\'animation : la boîte de la balise se lit à l\'entrée de la souris, sa bordure avec elle', async function () {
      if (!present) return this.skip()
      const { page, contexte } = await ouvre('mjs-pt-do-balise')
      await page.evaluate(LECTURES)
      await page.mouse.move(A[0] - 40, A[1], { steps: 3 })
      for (let i = 0; i < 20; i++) {
        await page.mouse.move(A[0] + i * 9, A[1] + (i % 5) * 6)
        await page.waitForTimeout(20)
      }
      // pas de waitForFunction ici : il interroge la page à chaque image et ses lectures compteraient
      await page.waitForTimeout(1200)
      const bilan = await page.evaluate(() => (window as any).__lectures)
      // la garde voit les images, et le voile est bien posé (sans quoi zéro lecture ne prouverait rien)
      assert.ok(bilan.images >= 8, `images d'animation vues : ${bilan.images}`)
      assert.ok(await page.evaluate(() => !!(document.querySelector('[mjs-fx-layer="pointer"]') || (document.querySelector('mjs-pt-do-balise') as any)._shadow.querySelector('[mjs-fx-layer="pointer"]'))), 'le voile est posé')
      assert.equal(bilan.lectures, 0, `lectures de mise en page dans les images d'animation : ${JSON.stringify(bilan.vues)}`)
      await contexte.close()
    })

    it('le bord du trou est adouci : net à l\'intérieur, flou à l\'extérieur, un mélange sur le rayon', async function () {
      if (!present) return this.skip()
      const { page, contexte, pixels, pret } = await ouvre('mjs-pt-do-balise')
      await page.mouse.move(A[0] - 40, A[1], { steps: 3 })
      await page.mouse.move(A[0], A[1], { steps: 3 })
      await pret(50)
      // sur la rangée de la souris, à 42, 50 et 58 px, à droite puis à gauche (la balise a une bordure de 10 px : le trou est dans le repère de son intérieur) :
      // le motif revient tous les 8 px, les trois points ont donc la même rayure ; net : rouge ou bleu pur (écart 255), flou : écart nul
      const [dedans, bord, dehors, gauche, gaucheDehors] = await pixels([[A[0] + 42, A[1]], [A[0] + 50, A[1]], [A[0] + 58, A[1]], [A[0] - 42, A[1]], [A[0] - 58, A[1]]])
      const ecart = (p: Pixel) => Math.abs(p[0] - p[2])
      assert.ok(net(dedans) && net(gauche), 'à 42 px, de chaque côté : net, ' + dedans + ' ' + gauche)
      assert.ok(flou(dehors) && flou(gaucheDehors), 'à 58 px, de chaque côté : flou, ' + dehors + ' ' + gaucheDehors)
      assert.ok(ecart(bord) > 60 && ecart(bord) < 235, 'sur le rayon : entre le net et le flou, ' + bord)
      // au-dessus et au-dessous de la souris : la bordure du haut est déduite aussi (un trou décalé de 10 px vers le bas ne tient plus)
      const [haut, hautDehors, bas, basDehors] = await pixels([[A[0], A[1] - 42], [A[0], A[1] - 58], [A[0], A[1] + 42], [A[0], A[1] + 58]])
      assert.ok(net(haut) && net(bas), 'à 42 px, au-dessus et au-dessous : net, ' + haut + ' ' + bas)
      assert.ok(flou(hautDehors) && flou(basDehors), 'à 58 px, au-dessus et au-dessous : flou, ' + hautDehors + ' ' + basDehors)
      await contexte.close()
    })

    it('le disque grossit sur ce qui se clique (grow), se resserre à l\'appui (press) : le rayon du trou, lu et vu', async function () {
      if (!present) return this.skip()
      const { page, contexte, pixels, voile, pret } = await ouvre('mjs-pt-do-balise')
      // au repos : size 100, rayon 50 ; à 75 px de la souris, flou
      await page.mouse.move(A[0] - 40, A[1], { steps: 3 })
      await page.mouse.move(A[0], A[1], { steps: 3 })
      await pret(50)
      let [p75, p35] = await pixels([[A[0] + 75, A[1]], [A[0] + 35, A[1]]])
      assert.ok(flou(p75) && net(p35), 'au repos : à 75 px flou, à 35 px net, ' + p75 + ' ' + p35)
      // sur le lien (grow 2) : rayon 100, le même point à 75 px est dans le trou
      await page.mouse.move(L[0], L[1], { steps: 6 })
      await pret(100)
      ;[p75] = await pixels([[L[0] - 75, L[1]]])
      assert.ok(net(p75), 'sur le lien : le trou grossit (rayon 100), à 75 px net, ' + p75)
      assert.ok((await voile())!.attrs.includes('mjs-fx-pointer-hot'))
      // appuyé sur le lien (press 0,5) : rayon 50
      await page.mouse.down()
      await pret(50)
      ;[p75] = await pixels([[L[0] - 75, L[1]]])
      assert.ok(flou(p75), 'appuyé sur le lien : rayon 50, à 75 px flou, ' + p75)
      assert.ok((await voile())!.attrs.includes('mjs-fx-pointer-down'))
      await page.mouse.up()
      await pret(100)
      ;[p75] = await pixels([[L[0] - 75, L[1]]])
      assert.ok(net(p75), 'relâché : rayon 100, ' + p75)
      // appuyé sur un fond nu : rayon 25 (50 × 0,5), à 35 px flou
      await page.mouse.move(A[0], A[1], { steps: 6 })
      await pret(50)
      await page.mouse.down()
      await pret(25)
      ;[p35] = await pixels([[A[0] + 35, A[1]]])
      assert.ok(flou(p35), 'appuyé sur un fond nu : rayon 25, à 35 px flou, ' + p35)
      await page.mouse.up()
      await contexte.close()
    })

    it('sur <@document> le filtre couvre toute la page, sauf le disque sous la souris', async function () {
      if (!present) return this.skip()
      const { page, contexte, pixels, voile, pret } = await ouvre('mjs-pt-do-page')
      const points: Array<[number, number]> = [[400, 350], [700, 650], [30, 30], [770, 20], [30, 680], [400, 150]]
      assert.ok((await pixels(points)).every(net), 'avant la souris : nette partout')
      await page.mouse.move(360, 350, { steps: 3 })
      await page.mouse.move(400, 350, { steps: 3 })
      await pret(50)
      const [sous, ...loin] = await pixels(points)
      assert.ok(net(sous), 'sous la souris : net, ' + sous)
      assert.ok(loin.every(flou), 'les quatre coins et le haut de la page : flous, ' + JSON.stringify(loin))
      const v = (await voile())!
      assert.equal(v.position, 'fixed', 'un calque fixe qui couvre la fenêtre')
      assert.equal(v.parent.split('.')[0], 'body')
      assert.equal(v.arrondi, '0px', 'la fenêtre n\'est pas arrondie')
      await page.mouse.move(100, 500, { steps: 5 })
      await pret(50)
      const [ancien, neuf, loin2] = await pixels([[400, 350], [100, 500], [700, 100]])
      assert.ok(flou(ancien) && net(neuf) && flou(loin2), 'le trou a suivi la souris : ' + ancien + ' ' + neuf + ' ' + loin2)
      await contexte.close()
    })

    it('la page qui défile sous une souris immobile : le trou reste sous la souris', async function () {
      if (!present) return this.skip()
      const { page, contexte, pixels, pret } = await ouvre('mjs-pt-do-defile')
      await page.mouse.move(180, 280, { steps: 3 })
      await page.mouse.move(220, 300, { steps: 3 })
      await pret(50)
      let [sous, haut, bas] = await pixels([[220, 300], [220, 190], [220, 410]])
      assert.ok(net(sous) && flou(haut) && flou(bas), 'avant le défilement : ' + sous + ' ' + haut + ' ' + bas)
      await page.evaluate(() => window.scrollBy(0, 100))
      await page.waitForFunction(() => window.scrollY >= 99)
      await page.waitForTimeout(nom === 'firefox' ? 500 : 250)
      ;[sous, haut, bas] = await pixels([[220, 300], [220, 190], [220, 410]])
      assert.ok(net(sous), 'après le défilement, la souris n\'a pas bougé : le trou est toujours dessous, ' + sous)
      assert.ok(flou(haut) && flou(bas), 'et le reste est flou, ' + haut + ' ' + bas)
      await contexte.close()
    })

    it('sans outside rien ne change : la lentille floute sous la souris, la page reste nette ; ni voile, ni marque ; outside: false et outside absent donnent la même chose ; les autres styles l\'ignorent', async function () {
      if (!present) return this.skip()
      for (const tag of ['mjs-pt-do-normal', 'mjs-pt-do-faux']) {
        const { page, contexte, pixels, voile } = await ouvre(tag)
        await page.mouse.move(A[0] - 40, A[1], { steps: 3 })
        await page.mouse.move(A[0], A[1], { steps: 3 })
        await page.waitForFunction(() => !document.querySelector('[mjs-fx-pointer-layer][mjs-fx-pointer-live]'), null, { timeout: 15000 })
        await page.waitForTimeout(nom === 'firefox' ? 600 : 400)
        const [sous, loin, bord] = await pixels([[A[0], A[1]], [A[0] + 150, A[1]], [450, 200]])
        assert.ok(flou(sous), tag + ' : sous la souris, la lentille floute, ' + sous)
        assert.ok(net(loin) && net(bord), tag + ' : loin de la souris, la page reste nette, ' + loin + ' ' + bord)
        assert.equal(await voile(), null, tag + ' : aucun voile')
        const marques = await page.evaluate(() => (document.querySelector('[mjs-fx-pointer-layer]') as Element).getAttributeNames().filter((n) => n.startsWith('mjs-fx-pointer-')))
        assert.ok(!marques.includes('mjs-fx-pointer-out'), tag + ' : le calque ne porte pas la marque du filtre inverse')
        assert.equal(await page.evaluate(() => document.querySelectorAll('[mjs-fx-pointer-layer] > *').length), 1, tag + ' : le calque garde son seul disque')
        await contexte.close()
      }
      // un disque (style disc) ignore `outside` : aucun voile, la page reste nette
      const d = await ouvre('mjs-pt-do-disque')
      await d.page.mouse.move(A[0], A[1], { steps: 3 })
      await d.page.waitForTimeout(500)
      assert.equal(await d.voile(), null, 'disc : aucun voile')
      assert.ok(net(await d.un(A[0] + 150, A[1])), 'disc : la page reste nette')
      await d.contexte.close()
    })

    it('le filtre se règle : sans `filter`, tout est gris sauf le disque (grayscale par défaut)', async function () {
      if (!present) return this.skip()
      const { page, contexte, un, pret } = await ouvre('mjs-pt-do-gris')
      await page.mouse.move(A[0] - 40, A[1], { steps: 3 })
      await page.mouse.move(A[0], A[1], { steps: 3 })
      await pret(50)
      const loin = await un(A[0] + 150, A[1])
      const sous = await un(A[0], A[1])
      assert.ok(Math.abs(loin[0] - loin[1]) < 6 && Math.abs(loin[1] - loin[2]) < 6, 'loin de la souris : un gris, ' + loin)
      assert.ok(net(sous), 'sous la souris : les couleurs du fond, ' + sous)
      await contexte.close()
    })

    it('rien ne tourne au repos : le trou rejoint la souris, puis plus aucune image ni minuterie ; la boucle repart au mouvement suivant', async function () {
      if (!present) return this.skip()
      const { page, contexte, pret, compteurs, voile, un } = await ouvre('mjs-pt-do-balise', {})
      const base = await compteurs()
      await page.mouse.move(A[0] - 40, A[1], { steps: 3 })
      await page.mouse.move(A[0], A[1], { steps: 3 })
      await pret(50)
      assert.ok(flou(await un(A[0] + 150, A[1])), 'le filtre inverse est là')
      await page.waitForTimeout(400)
      const avant = await compteurs()
      await page.waitForTimeout(1500)
      assert.deepEqual(await compteurs(), avant, 'au repos : ni image, ni minuterie, ni intervalle')
      assert.ok((await voile())!.attrs.includes('mjs-fx-pointer-on'))
      // la surveillance du défilement n'existe que pendant le survol : posée à l'entrée, retirée à la sortie
      assert.ok(avant.sc > base.sc, 'souris dans la balise : des écouteurs de défilement ' + avant.sc + ' / ' + base.sc)
      await page.mouse.move(650, 100, { steps: 4 })
      await page.waitForTimeout(400)
      assert.equal((await compteurs()).sc, base.sc, 'souris sortie : plus un seul écouteur de défilement de plus qu\'avant')
      await contexte.close()
    })

    it('outside tenu par une variable : posé et défait sans reste (voile, marque, position de la balise)', async function () {
      if (!present) return this.skip()
      const { page, contexte, un, pret, voile, compteurs } = await ouvre('mjs-pt-do-variable')
      const base = await compteurs()
      const etat = () => page.evaluate(() => {
        const racine = (document.querySelector('mjs-pt-do-variable') as any)._shadow
        const s = racine.querySelector('.s') as HTMLElement
        return { voiles: document.querySelectorAll('[mjs-fx-layer="pointer"]').length + racine.querySelectorAll('[mjs-fx-layer="pointer"]').length, calques: document.querySelectorAll('[mjs-fx-pointer-layer]').length, dehors: document.querySelectorAll('[mjs-fx-pointer-layer][mjs-fx-pointer-out]').length, position: s.style.position, style: s.getAttribute('style') || '' }
      })
      const e0 = await etat()
      assert.deepEqual([e0.voiles, e0.calques, e0.dehors], [1, 1, 1], 'posé : un voile, un calque')
      assert.equal(e0.position, 'relative', 'une balise sans position en reçoit une le temps du filtre inverse')
      await page.mouse.move(A[0] - 40, A[1], { steps: 3 })
      await page.mouse.move(A[0], A[1], { steps: 3 })
      await pret(50)
      assert.ok(flou(await un(A[0] + 150, A[1])), 'le filtre inverse est là')
      assert.ok((await compteurs()).sc > base.sc, 'la surveillance du défilement est posée')
      await page.evaluate(() => (document.querySelector('mjs-pt-do-variable') as any)._shadow.querySelector('.b').click())
      await page.waitForFunction(() => {
        const racine = (document.querySelector('mjs-pt-do-variable') as any)._shadow
        return document.querySelectorAll('[mjs-fx-layer="pointer"]').length + racine.querySelectorAll('[mjs-fx-layer="pointer"]').length === 0
      }, null, { timeout: 15000 })
      const e1 = await etat()
      assert.deepEqual([e1.voiles, e1.calques, e1.dehors], [0, 1, 0], 'défait : plus de voile, la lentille ordinaire est reposée, une seule fois')
      assert.equal(e1.position, '', 'la position de la balise est rendue')
      assert.equal((await compteurs()).sc, base.sc, 'la surveillance du défilement est retirée avec le voile')
      assert.ok(!/position/.test(e1.style), 'aucune trace sur la balise : ' + e1.style)
      assert.equal(await voile(), null)
      await page.mouse.move(A[0] - 30, A[1] + 5, { steps: 3 })
      await page.mouse.move(A[0], A[1], { steps: 3 })
      await page.waitForTimeout(nom === 'firefox' ? 700 : 500)
      assert.ok(net(await un(A[0] + 150, A[1])), 'sans outside : la page loin de la souris est nette')
      // et retour : posé de nouveau, un seul voile
      await page.evaluate(() => (document.querySelector('mjs-pt-do-variable') as any)._shadow.querySelector('.b').click())
      await page.waitForFunction(() => document.querySelectorAll('[mjs-fx-pointer-layer][mjs-fx-pointer-out]').length === 1, null, { timeout: 15000 })
      assert.deepEqual((await etat()).voiles, 1)
      await contexte.close()
    })

    it('« réduire les animations » : le trou colle à la souris et change de taille sans transition', async function () {
      if (!present) return this.skip()
      const { page, contexte, un, voile, pret } = await ouvre('mjs-pt-do-balise', { reducedMotion: 'reduce' })
      await page.mouse.move(A[0] - 40, A[1], { steps: 3 })
      await page.mouse.move(A[0], A[1], { steps: 3 })
      await pret(50)
      await page.mouse.move(350, 250)
      await page.waitForTimeout(nom === 'firefox' ? 500 : 250)
      assert.ok(net(await un(350, 250)) && flou(await un(150, 170)), 'collé à la souris : le trou est déjà sous elle, et plus à l\'ancienne place')
      const v = (await voile())!
      assert.equal(v.duree.split(',').every((d: string) => d.trim() === '0s'), true, 'aucune transition : ' + v.duree)
      await contexte.close()
    })

    it('un écran sans souris (hover: none) : ni voile, ni calque', async function () {
      if (!present) return this.skip()
      if (nom === 'firefox') return this.skip()
      const { page, contexte } = await ouvre('mjs-pt-do-balise', { hasTouch: true, isMobile: true, viewport: { width: 400, height: 800 } })
      assert.equal(await page.evaluate(() => matchMedia('(hover: none)').matches), true, 'l\'émulation dit bien « pas de survol »')
      assert.equal(await page.evaluate(() => document.querySelectorAll('[mjs-fx-pointer-layer]').length + ((document.querySelector('mjs-pt-do-balise') as any)._shadow.querySelectorAll('[mjs-fx-layer="pointer"]').length)), 0)
      await contexte.close()
    })
  })
}
