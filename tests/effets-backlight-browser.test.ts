// *backlight dans Chromium réel : des pixels d'une capture. La lueur déborde de l'image, aux couleurs de l'image (une balise sans
// effet reste noire autour), la balise passe par-dessus son double, le survol l'allume puis l'éteint, une balise à image de
// fond et le changement d'image sont suivis, le double ne capte pas les clics, il se recale quand la balise change de taille
// ou de place, une image paresseuse n'est pas appelée avant elle, rien ne tourne au repos, `legend: true` garde le texte voisin net (le parent isolé,
// le parent rendu tel quel au retrait), le retrait ne laisse rien.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { deuxImages } from './helpers/images-navigateur.js'
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

const svg = (corps: string) => 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">' + corps + '</svg>').replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29')
const ROUGE = svg('<rect width="100" height="100" fill="#ff0000"/>')
const BLEU  = svg('<rect width="100" height="100" fill="#0000ff"/>')
// une image de 200 × 120 (la largeur d'une légende), pour une lueur qui couvre toute la légende
const LARGE = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="#ff3300"/></svg>').replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29')
const DEUX  = svg('<rect width="50" height="100" fill="#ff0000"/><rect x="50" width="50" height="100" fill="#0000ff"/>')

const REGLES = 'blur: 20, y: 0, size: 1.5'
const SOURCES: Record<string, string> = {
  'fb-backlight.mjs': [
    `<div class="cadre"><img class="t" src="${ROUGE}" alt=""></div>`,
    `<div class="cadre"><img class="h" *backlight(${REGLES}) src="${ROUGE}" alt=""></div>`,
    `<div class="cadre"><img class="v" *backlight(${REGLES}, on: hover, duration: 100ms) src="${ROUGE}" alt=""></div>`,
    `<div class="cadre"><div class="f" *backlight(${REGLES})></div></div>`,
    `<div class="cadre"><img class="d" *backlight(${REGLES}) src="${DEUX}" alt=""></div>`,
    `<div class="cadre"><img class="m" *backlight(${REGLES}) src="${ROUGE}" alt=""><img class="n" src="${BLEU}" alt=""></div>`
  ].join('\n') + `\n<style>\nbody\n  margin: 0\n.cadre\n  position: relative\n  display: grid\n  place-items: center\n  width: 300px\n  height: 220px\n  background: #000\nimg, .f\n  display: block\n  width: 100px\n  height: 100px\n.f\n  background: url("${ROUGE}") center / 100% 100%\n.n\n  display: none\n</style>\n`,
  'fb-backlight-loin.mjs': `<div class="espace"></div>\n<img class="l" loading="lazy" *backlight(on: view, duration: 100ms) src="/rouge.svg" alt="">\n<style>\n.espace\n  height: 6000px\nimg\n  display: block\n  width: 100px\n  height: 100px\n</style>\n`,
  // le texte voisin : une légende blanche juste sous l'image, dans un parent à fond opaque ; l'effet sans rien d'autre (classe e), le témoin sans effet
  // (classe t), le texte voisin positionné (classe g), la légende loin de l'image (classe p), `legend: true` sans rien d'autre (classe l), `legend: true` dans un parent sans boîte (`display: contents`, classe c)
  'fb-backlight-legende.mjs': [
    `<figure class="carte"><img class="e" *backlight src="${LARGE}" alt=""><figcaption class="cap cap-e">LEGENDE</figcaption></figure>`,
    `<figure class="carte"><img class="t" src="${LARGE}" alt=""><figcaption class="cap cap-t">LEGENDE</figcaption></figure>`,
    `<figure class="carte"><img class="g" *backlight src="${LARGE}" alt=""><figcaption class="cap cap-g">LEGENDE</figcaption></figure>`,
    `<figure class="carte"><img class="p" *backlight src="${LARGE}" alt=""><figcaption class="cap cap-p">LEGENDE</figcaption></figure>`,
    `<figure class="carte"><img class="l" *backlight(legend: true) src="${LARGE}" alt=""><figcaption class="cap cap-l">LEGENDE</figcaption></figure>`,
    `<figure class="carte"><div class="vide"><img class="c" *backlight(legend: true) src="${LARGE}" alt=""></div><figcaption class="cap cap-c">LEGENDE</figcaption></figure>`
  ].join('\n') + `\n<style>\nbody\n  margin: 0\n.carte\n  width: 260px\n  margin: 0 0 20px 20px\n  padding: 20px\n  background: #101820\nimg\n  display: block\n  width: 200px\n  height: 120px\n.cap\n  margin-top: 8px\n  font: 900 40px sans-serif\n  color: #fff\n.cap-g\n  position: relative\n.cap-p\n  margin-top: 120px\n.vide\n  display: contents\n</style>\n`,
  // `legend: true` : le parent (la figure) reste quand la balise s'en va : il doit être rendu tel quel
  'fb-backlight-legende-retrait.mjs': `<script>\n$on = true\n</script>\n<figure class="cadre"><figcaption class="cap">texte</figcaption>{if $on}<img class="r" *backlight(legend: true) src="${ROUGE}" alt="">{end}</figure>\n<button class="t" @click={$on = !$on}>t</button>\n<style>\n.cadre\n  width: 300px\n  height: 220px\n  margin: 0\nimg\n  display: block\n  width: 100px\n  height: 100px\n</style>\n`,
  'fb-backlight-retrait.mjs': `<script>\n$on = true\n</script>\n{if $on}<div class="cadre"><img class="r" *backlight(on: hover) src="${ROUGE}" alt=""></div>{end}\n<button class="t" @click={$on = !$on}>t</button>\n<style>\n.cadre\n  position: relative\n  width: 300px\n  height: 220px\nimg\n  display: block\n  width: 100px\n  height: 100px\n</style>\n`
}

for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
describe(`*backlight (${nom} réel) — des pixels`, function () {
  this.timeout(120000)
  let present = false
  let script  = ''

  before(async function () {
    present = await navigateurPresent(nom)
    if (!present) {
      console.log(`  ℹ️  ${nom} non installé, test de *backlight sauté. Activer : \`npx playwright install ${nom}\``)
      return
    }
    const root   = mjsTmp('effets-backlight-browser-' + nom)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [n, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, n), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })

  after(async () => { await terminateSharedWorkerPool() })

  const lancer = async () => (await import('playwright'))[nom].launch(nom === 'chromium' ? { args: ['--no-sandbox'] } : {})

  async function ouvre(browser: any, tag: string, classe: string, opts: { calm?: boolean } = {}) {
    const page    = await browser.newPage({ viewport: { width: 700, height: 1800 }, reducedMotion: opts.calm ? 'reduce' : 'no-preference' })
    const journal = { erreurs: [] as string[] }
    page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') journal.erreurs.push(m.text()) })
    page.on('pageerror', (e: any) => journal.erreurs.push(String(e)))
    await page.route('http://t.test/**', (route: any) => {
      const url = route.request().url()
      if (url === 'http://t.test/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#000}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
      return route.fulfill({ status: 404, body: '' })
    })
    await page.goto('http://t.test/', { waitUntil: 'load' })
    await page.waitForFunction(([t, c]: string[]) => !!(document.querySelector(t) as any)?._shadow?.querySelector('.' + c), [tag, classe])
    await page.waitForTimeout(500)
    return { page, journal }
  }

  // le rectangle d'une balise de la page (dans le shadow root du composant)
  const boite = (page: any, tag: string, classe: string) => page.evaluate(([t, c]: string[]) => {
    const r = (document.querySelector(t) as any)._shadow.querySelector('.' + c).getBoundingClientRect()
    return { x: r.left, y: r.top, w: r.width, h: r.height }
  }, [tag, classe])

  // la couleur de chaque point demandé, lue sur une capture
  async function pixels(page: any, points: number[][]): Promise<number[][]> {
    const png = (await page.screenshot()).toString('base64')
    return page.evaluate(async ([b64, ps]: [string, number[][]]) => {
      const im = new Image()
      im.src = 'data:image/png;base64,' + b64
      await im.decode()
      const c = document.createElement('canvas')
      c.width  = im.width
      c.height = im.height
      const x = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
      x.drawImage(im, 0, 0)
      return ps.map(([px, py]) => Array.from(x.getImageData(px, py, 1, 1).data).slice(0, 3))
    }, [png, points])
  }

  // dans chaque rectangle, le nombre de pixels blancs (les trois canaux au-dessus de 235) : le texte blanc, sans le voile coloré de la lueur
  async function blancs(page: any, zones: Array<{ x: number, y: number, w: number, h: number }>): Promise<number[]> {
    const png = (await page.screenshot()).toString('base64')
    return page.evaluate(async ([b64, zs]: [string, Array<{ x: number, y: number, w: number, h: number }>]) => {
      const im = new Image()
      im.src = 'data:image/png;base64,' + b64
      await im.decode()
      const c = document.createElement('canvas')
      c.width  = im.width
      c.height = im.height
      const x = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
      x.drawImage(im, 0, 0)
      return zs.map((z) => {
        const d = x.getImageData(Math.round(z.x), Math.round(z.y), Math.round(z.w), Math.round(z.h)).data
        let n = 0
        for (let i = 0; i < d.length; i += 4) if (d[i] > 235 && d[i + 1] > 235 && d[i + 2] > 235) n++
        return n
      })
    }, [png, zones])
  }

  // un point à 15 px sous la balise : dans la lueur (la copie agrandie déborde de 25 px), hors de l'image
  const sous = (b: { x: number, y: number, w: number, h: number }) => [Math.round(b.x + b.w / 2), Math.round(b.y + b.h + 15)]
  const rouge = (p: number[]) => p[0] >= 70 && p[1] <= 30 && p[2] <= 30
  const bleu  = (p: number[]) => p[2] >= 70 && p[0] <= 30 && p[1] <= 30
  const noir  = (p: number[]) => p[0] <= 4 && p[1] <= 4 && p[2] <= 4

  it('la lueur déborde de l\'image, aux couleurs de l\'image ; une image sans effet reste noire autour ; la balise reste par-dessus', async function () {
    if (!present) return this.skip()
    const browser = await lancer()
    try {
      const { page, journal } = await ouvre(browser, 'mjs-fb-backlight', 'h')
      const t = await boite(page, 'mjs-fb-backlight', 't')
      const h = await boite(page, 'mjs-fb-backlight', 'h')
      const f = await boite(page, 'mjs-fb-backlight', 'f')
      const d = await boite(page, 'mjs-fb-backlight', 'd')
      const [pt, ph, pf, pd1, pd2] = await pixels(page, [sous(t), sous(h), sous(f), [Math.round(d.x + d.w / 2 - 3), Math.round(d.y + d.h / 2)], [Math.round(d.x + d.w / 2 + 3), Math.round(d.y + d.h / 2)]])
      assert.ok(noir(pt), 'sans effet : noir autour de l\'image — ' + pt)
      assert.ok(rouge(ph), 'avec *backlight : de la lueur rouge sous l\'image — ' + ph)
      assert.ok(rouge(pf), 'sur une balise à image de fond — ' + pf)
      // l'image à deux couleurs : la balise est par-dessus son double, ses pixels sont les siens (ni mélange avec le flou)
      assert.ok(pd1[0] >= 250 && pd1[1] <= 4 && pd1[2] <= 4, 'à gauche du milieu : le rouge de l\'image, pur — ' + pd1)
      assert.ok(pd2[2] >= 250 && pd2[0] <= 4 && pd2[1] <= 4, 'à droite du milieu : le bleu de l\'image, pur — ' + pd2)
      const etat = await page.evaluate(() => {
        const sh = (document.querySelector('mjs-fb-backlight') as any)._shadow
        const img = sh.querySelector('.h')
        const l = img.previousElementSibling
        const cs = getComputedStyle(l)
        return { position: getComputedStyle(img).position, kind: l.getAttribute('mjs-fx-layer'), aria: l.getAttribute('aria-hidden'), filtre: cs.filter, opacite: cs.opacity, evenements: cs.pointerEvents, transform: cs.transform }
      })
      assert.equal(etat.position, 'relative')
      assert.equal(etat.kind, 'backlight')
      assert.equal(etat.aria, 'true')
      assert.equal(etat.filtre, 'blur(20px) saturate(1.4)')
      assert.equal(etat.opacite, '0.8')
      assert.equal(etat.evenements, 'none')
      assert.equal(etat.transform, 'matrix(1.5, 0, 0, 1.5, 0, 0)', 'size: 1.5, y: 0')
      assert.deepEqual(journal.erreurs, [])
    } finally {
      await browser.close()
    }
  })

  it('chaque réglage visuel, changé en route, agit sur le style calculé du double', async function () {
    if (!present) return this.skip()
    const browser = await lancer()
    try {
      const { page } = await ouvre(browser, 'mjs-fb-backlight', 'h')
      const lu = await page.evaluate(async () => {
        const img = (document.querySelector('mjs-fb-backlight') as any)._shadow.querySelector('.h') as any
        const cs  = getComputedStyle(img.previousElementSibling)
        const hot = img._mjs_fxOff.backlight._hot
        const sortie: Record<string, string> = {}
        hot('blur', 80)
        hot('saturate', 3)
        sortie.filtre = cs.filter
        hot('opacity', 0.4)
        // l'opacité se transitionne (300 ms) et le fondu n'avance qu'avec les images : on guette la valeur d'arrivée, image après image, avec une limite large (jamais une durée à attendre, qui tombe sous charge)
        const fin = Date.now() + 30000
        while (cs.opacity !== '0.4' && Date.now() < fin) await new Promise((r) => requestAnimationFrame(r))
        sortie.opacite = cs.opacity
        hot('size', 1.7)
        hot('x', -30)
        hot('y', 40)
        sortie.transform = cs.transform
        hot('duration', '1s')
        sortie.duree = cs.transitionDuration
        return sortie
      })
      assert.deepEqual(lu, { filtre: 'blur(80px) saturate(3)', opacite: '0.4', transform: 'matrix(1.7, 0, 0, 1.7, -30, 40)', duree: '1s' })
    } finally {
      await browser.close()
    }
  })

  it('le double ne capte pas les clics : un clic dans la lueur tombe sur ce qui est dessous, le survol de la lueur n\'allume rien', async function () {
    if (!present) return this.skip()
    const browser = await lancer()
    try {
      const { page } = await ouvre(browser, 'mjs-fb-backlight', 'h')
      const h = await boite(page, 'mjs-fb-backlight', 'h')
      const [x, y] = sous(h)
      const touche = await page.evaluate(([px, py]: number[]) => {
        const top = (document.querySelector('mjs-fb-backlight') as any)._shadow.elementFromPoint(px, py)
        return { couche: top.hasAttribute('mjs-fx-layer'), classe: top.className }
      }, [x, y])
      assert.equal(touche.couche, false)
      assert.equal(touche.classe, 'cadre')
      // le survol de la lueur seule n'allume pas un halo `on: hover`
      const v = await boite(page, 'mjs-fb-backlight', 'v')
      await page.mouse.move(v.x + v.w / 2, v.y + v.h + 15)
      await page.waitForTimeout(300)
      const o = await page.evaluate(() => getComputedStyle((document.querySelector('mjs-fb-backlight') as any)._shadow.querySelector('.v').previousElementSibling).opacity)
      assert.equal(o, '0')
    } finally {
      await browser.close()
    }
  })

  it('on: hover — éteint au repos, allumé pendant le survol de l\'image, éteint à la sortie', async function () {
    if (!present) return this.skip()
    const browser = await lancer()
    try {
      const { page } = await ouvre(browser, 'mjs-fb-backlight', 'v')
      const v = await boite(page, 'mjs-fb-backlight', 'v')
      const p = sous(v)
      assert.ok(noir((await pixels(page, [p]))[0]), 'au repos : noir')
      await page.mouse.move(v.x + v.w / 2, v.y + v.h / 2)
      await page.waitForTimeout(400)
      assert.ok(rouge((await pixels(page, [p]))[0]), 'au survol : la lueur')
      await page.mouse.move(5, 5)
      await page.waitForTimeout(400)
      assert.ok(noir((await pixels(page, [p]))[0]), 'à la sortie : éteint')
    } finally {
      await browser.close()
    }
  })

  it('le changement d\'image (src, fond) est suivi ; la boîte suit la taille et la place de la balise', async function () {
    if (!present) return this.skip()
    const browser = await lancer()
    try {
      const { page } = await ouvre(browser, 'mjs-fb-backlight', 'h')
      const h = await boite(page, 'mjs-fb-backlight', 'h')
      const f = await boite(page, 'mjs-fb-backlight', 'f')
      await page.evaluate((bleu: string) => {
        const sh = (document.querySelector('mjs-fb-backlight') as any)._shadow
        sh.querySelector('.h').src = bleu
        sh.querySelector('.f').style.backgroundImage = 'url("' + bleu + '")'
      }, BLEU)
      await page.waitForTimeout(500)
      const [ph, pf] = await pixels(page, [sous(h), sous(f)])
      assert.ok(bleu(ph), 'le `src` change : la lueur devient bleue — ' + ph)
      assert.ok(bleu(pf), 'le fond change : la lueur devient bleue — ' + pf)
      // un fond à deux images dont le dégradé a des parenthèses imbriquées : le double prend la taille de la photo (la seconde), pas celle du dégradé
      const cadrage = await page.evaluate(async (url: string) => {
        const fond = (document.querySelector('mjs-fb-backlight') as any)._shadow.querySelector('.f') as HTMLElement
        fond.style.backgroundImage = 'linear-gradient(rgba(0, 0, 0, .5), rgba(0, 0, 0, .5)), url("' + url + '")'
        fond.style.backgroundSize = 'auto, 50% 50%'
        await new Promise((r) => setTimeout(r, 200))
        const l = fond.previousElementSibling as HTMLElement
        return { taille: l.style.getPropertyValue('--mjs-fx-backlight-fit'), image: l.style.getPropertyValue('--mjs-fx-backlight-src').slice(0, 24) }
      }, BLEU)
      assert.deepEqual(cadrage, { taille: '50% 50%', image: 'url("data:image/svg+xml,' })
      // la balise grandit, le double suit (la copie est agrandie de 1,5)
      await page.evaluate(() => { ((document.querySelector('mjs-fb-backlight') as any)._shadow.querySelector('.h') as HTMLElement).style.width = '160px' })
      await page.waitForTimeout(300)
      // le double suit la balise quand l'observateur de taille répond, à l'image qui suit : WebKit sous charge peut rester des secondes sans en dessiner
      await deuxImages(page)
      const l = await page.evaluate(() => {
        const r = ((document.querySelector('mjs-fb-backlight') as any)._shadow.querySelector('.h').previousElementSibling as HTMLElement).getBoundingClientRect()
        return { w: r.width, h: r.height }
      })
      assert.ok(Math.abs(l.w - 240) <= 1 && Math.abs(l.h - 150) <= 1, 'le double fait 1,5 fois la nouvelle boîte — ' + JSON.stringify(l))
      // la balise change de place dans son parent : le double la suit (même rang, même boîte)
      const suit = await page.evaluate(async () => {
        const sh  = (document.querySelector('mjs-fb-backlight') as any)._shadow
        const m   = sh.querySelector('.m')
        const sib = m.previousElementSibling
        m.parentNode.appendChild(m)
        await new Promise((r) => setTimeout(r, 200))
        return { avant: sib.getAttribute('mjs-fx-layer'), juste: m.previousElementSibling.getAttribute('mjs-fx-layer') }
      })
      assert.equal(suit.juste, 'backlight', 'le double revient juste avant sa balise')
    } finally {
      await browser.close()
    }
  })

  it('une image paresseuse n\'est pas appelée par le double avant la balise, ni appelée deux fois ; on: view allume à l\'arrivée à l\'écran', async function () {
    if (!present) return this.skip()
    // un vrai serveur, avec un en-tête de cache (une page interceptée par Playwright n'a pas de cache : la seconde demande y serait comptée à tort)
    const { createServer } = await import('node:http')
    let appels = 0
    const serveur = createServer((req, res) => {
      if (req.url === '/') {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end(`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#000}</style></head><body><mjs-fb-backlight-loin></mjs-fb-backlight-loin><script>${script}</script></body></html>`)
      }
      else if (req.url === '/rouge.svg') {
        appels++
        res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'max-age=3600' })
        res.end('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#f00"/></svg>')
      }
      else {
        res.writeHead(404)
        res.end()
      }
    })
    await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok))
    const browser = await lancer()
    try {
      const page = await browser.newPage({ viewport: { width: 700, height: 1800 } })
      await page.goto('http://127.0.0.1:' + (serveur.address() as any).port + '/', { waitUntil: 'load' })
      await page.waitForFunction(() => !!(document.querySelector('mjs-fb-backlight-loin') as any)?._shadow?.querySelector('.l'))
      await page.waitForTimeout(500)
      const lit = () => page.evaluate(() => {
        const l = (document.querySelector('mjs-fb-backlight-loin') as any)._shadow.querySelector('.l').previousElementSibling
        return { src: l.style.getPropertyValue('--mjs-fx-backlight-src'), opacite: getComputedStyle(l).opacity }
      })
      assert.equal(appels, 0, 'rien n\'est demandé tant que l\'image est loin')
      assert.deepEqual(await lit(), { src: '', opacite: '0' })
      await page.evaluate(() => { (document.querySelector('mjs-fb-backlight-loin') as any)._shadow.querySelector('.l').scrollIntoView() })
      await page.waitForFunction(() => (document.querySelector('mjs-fb-backlight-loin') as any)._shadow.querySelector('.l').complete)
      await page.waitForTimeout(500)
      const apres = await lit()
      assert.match(apres.src, /^url\("http:\/\/127\.0\.0\.1:\d+\/rouge\.svg"\)$/)
      assert.equal(apres.opacite, '0.8', 'on: view — allumé')
      assert.equal(appels, 1, 'l\'image n\'est demandée qu\'une fois : le double réutilise celle de la balise')
    } finally {
      await browser.close()
      serveur.close()
    }
  })

  it('« réduire les animations » : le halo apparaît sans fondu ; rien ne tourne au repos (aucun requestAnimationFrame)', async function () {
    if (!present) return this.skip()
    const browser = await lancer()
    try {
      const calme = await ouvre(browser, 'mjs-fb-backlight', 'v', { calm: true })
      const d = await calme.page.evaluate(() => getComputedStyle((document.querySelector('mjs-fb-backlight') as any)._shadow.querySelector('.v').previousElementSibling).transitionDuration)
      assert.equal(d, '0s')
      const normal = await ouvre(browser, 'mjs-fb-backlight', 'v')
      const d2 = await normal.page.evaluate(() => getComputedStyle((document.querySelector('mjs-fb-backlight') as any)._shadow.querySelector('.v').previousElementSibling).transitionDuration)
      assert.equal(d2, '0.1s')
      const n = await normal.page.evaluate(async () => {
        let k = 0
        const o = window.requestAnimationFrame
        window.requestAnimationFrame = function(f) { k++; return o.call(window, f) }
        await new Promise((r) => setTimeout(r, 600))
        window.requestAnimationFrame = o
        return k
      })
      assert.equal(n, 0, 'aucune image demandée au repos')
    } finally {
      await browser.close()
    }
  })

  it('le texte voisin sous l\'image : la lueur passe par-dessus (limite sans legend) ; `legend: true`, `position: relative` sur ce texte, ou de la place sous l\'image, le garde net', async function () {
    if (!present) return this.skip()
    const browser = await lancer()
    try {
      const { page, journal } = await ouvre(browser, 'mjs-fb-backlight-legende', 'e')
      // les trois doubles sont posés et mesurés (un état attendu, pas une durée)
      await page.waitForFunction(() => {
        const sh = (document.querySelector('mjs-fb-backlight-legende') as any)._shadow
        return ['e', 'g', 'p', 'l', 'c'].every((k) => {
          const l = sh.querySelector('.' + k).previousElementSibling as HTMLElement
          return l.getAttribute('mjs-fx-layer') === 'backlight' && l.style.getPropertyValue('--mjs-fx-backlight-src') !== '' && l.style.getPropertyValue('--mjs-fx-backlight-w') === '200px'
        })
      }, null, { timeout: 30000 })
      const zones = []
      for (const k of ['cap-e', 'cap-t', 'cap-g', 'cap-p', 'cap-l', 'cap-c']) zones.push(await boite(page, 'mjs-fb-backlight-legende', k))
      const [lave, temoin, relatif, loin, legende, contenu] = await blancs(page, zones)
      assert.ok(temoin > 1000, 'le témoin montre sa légende blanche — ' + temoin)
      assert.ok(lave < temoin * 0.5, 'sans geste, le double (un élément positionné) se peint par-dessus le texte non positionné du parent — ' + lave + ' pixels blancs contre ' + temoin)
      assert.ok(relatif >= temoin * 0.95, '`position: relative` sur le texte voisin : il repasse devant le double — ' + relatif + ' contre ' + temoin)
      assert.ok(loin >= temoin * 0.95, 'de la place sous l\'image : la lueur n\'atteint pas le texte — ' + loin + ' contre ' + temoin)
      assert.ok(legende >= temoin * 0.95, '`legend: true` : le texte voisin reste devant la lueur, sans rien écrire sur lui — ' + legende + ' contre ' + temoin)
      assert.ok(contenu >= temoin * 0.95, '`legend: true` dans un parent sans boîte (display: contents) : on isole le premier ancêtre qui en a une — ' + contenu + ' contre ' + temoin)
      assert.deepEqual(journal.erreurs, [])
    } finally {
      await browser.close()
    }
  })

  it('legend: true — la lueur reste derrière l\'image et autour d\'elle, le parent est isolé ; sans legend le parent n\'est pas touché', async function () {
    if (!present) return this.skip()
    const browser = await lancer()
    try {
      const { page, journal } = await ouvre(browser, 'mjs-fb-backlight-legende', 'e')
      await page.waitForFunction(() => {
        const sh = (document.querySelector('mjs-fb-backlight-legende') as any)._shadow
        return ['e', 'l'].every((k) => {
          const l = sh.querySelector('.' + k).previousElementSibling as HTMLElement
          return l.getAttribute('mjs-fx-layer') === 'backlight' && l.style.getPropertyValue('--mjs-fx-backlight-src') !== '' && l.style.getPropertyValue('--mjs-fx-backlight-w') === '200px'
        })
      }, null, { timeout: 30000 })
      const e = await boite(page, 'mjs-fb-backlight-legende', 'e')
      const l = await boite(page, 'mjs-fb-backlight-legende', 'l')
      const t = await boite(page, 'mjs-fb-backlight-legende', 't')
      // à gauche de l'image, dans la marge de la carte (20 px) : la lueur ; au centre de l'image : l'image elle-même, devant la lueur
      const points = [e, l, t].flatMap((b) => [[Math.round(b.x - 8), Math.round(b.y + 60)], [Math.round(b.x + 100), Math.round(b.y + 60)]])
      const [gE, cE, gL, cL, gT, cT] = await pixels(page, points)
      const proche = (a: number[], b: number[], tol: number) => a.every((v, i) => Math.abs(v - b[i]) <= tol)
      assert.ok(proche(gT, [16, 24, 32], 3), 'le témoin : le fond de la carte, sans lueur — ' + gT)
      assert.ok(gE[0] - gT[0] > 40, 'sans legend, la lueur se voit dans la marge — ' + gE + ' contre ' + gT)
      assert.ok(proche(gL, gE, 12), 'avec legend, la même lueur se voit dans la marge, au-dessus du fond du parent — ' + gL + ' contre ' + gE)
      assert.ok(proche(cT, [255, 51, 0], 2) && proche(cL, cT, 2) && proche(cE, cT, 2), 'l\'image reste devant la lueur : ses couleurs sont celles du témoin — ' + cL + ' / ' + cE + ' / ' + cT)
      const parents = await page.evaluate(() => {
        const sh = (document.querySelector('mjs-fb-backlight-legende') as any)._shadow
        const lire = (f: HTMLElement) => ({ isolation: getComputedStyle(f).isolation, style: f.getAttribute('style') })
        const parent = (k: string) => sh.querySelector('.' + k).parentElement as HTMLElement
        return { e: lire(parent('e')), l: lire(parent('l')), t: lire(parent('t')), vide: lire(parent('c')), figure: lire(parent('c').parentElement as HTMLElement) }
      })
      assert.deepEqual(parents, { e: { isolation: 'auto', style: null }, l: { isolation: 'isolate', style: 'isolation: isolate;' }, t: { isolation: 'auto', style: null }, vide: { isolation: 'auto', style: null }, figure: { isolation: 'isolate', style: 'isolation: isolate;' } }, 'seul le parent de legend: true est isolé (sans boîte : son ancêtre)')
      assert.deepEqual(journal.erreurs, [])
    } finally {
      await browser.close()
    }
  })

  it('legend: true — le retrait rend le parent tel quel : plus d\'isolation, plus d\'attribut style, plus de double', async function () {
    if (!present) return this.skip()
    const browser = await lancer()
    try {
      const { page, journal } = await ouvre(browser, 'mjs-fb-backlight-legende-retrait', 'r')
      const lire = () => page.evaluate(() => {
        const sh = (document.querySelector('mjs-fb-backlight-legende-retrait') as any)._shadow
        const f = sh.querySelector('.cadre') as HTMLElement
        return { isolation: getComputedStyle(f).isolation, style: f.getAttribute('style'), couches: sh.querySelectorAll('[mjs-fx-layer]').length }
      })
      assert.deepEqual(await lire(), { isolation: 'isolate', style: 'isolation: isolate;', couches: 1 })
      await page.evaluate(async () => {
        const sh = (document.querySelector('mjs-fb-backlight-legende-retrait') as any)._shadow
        sh.querySelector('.t').click()
        const fin = Date.now() + 30000
        while (sh.querySelector('.r') && Date.now() < fin) await new Promise((r) => requestAnimationFrame(r))
      })
      assert.deepEqual(await lire(), { isolation: 'auto', style: null, couches: 0 })
      assert.deepEqual(journal.erreurs, [])
    } finally {
      await browser.close()
    }
  })

  it('le retrait ({if} refermé) : le double, la marque, les variables et la position sont rendus', async function () {
    if (!present) return this.skip()
    const browser = await lancer()
    try {
      const { page, journal } = await ouvre(browser, 'mjs-fb-backlight-retrait', 'r')
      const avant = await page.evaluate(() => {
        const sh = (document.querySelector('mjs-fb-backlight-retrait') as any)._shadow
        return { couches: sh.querySelectorAll('[mjs-fx-layer]').length, marque: sh.querySelector('.r').getAttribute('mjs-fx') }
      })
      assert.deepEqual(avant, { couches: 1, marque: 'backlight' })
      const apres = await page.evaluate(async () => {
        const sh  = (document.querySelector('mjs-fb-backlight-retrait') as any)._shadow
        const img = sh.querySelector('.r')
        sh.querySelector('.t').click()
        await new Promise((r) => setTimeout(r, 200))
        return { couches: sh.querySelectorAll('[mjs-fx-layer]').length, attrs: img.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx')), style: img.getAttribute('style') || '', ouverte: !!sh.querySelector('.r') }
      })
      assert.deepEqual(apres, { couches: 0, attrs: [], style: '', ouverte: false })
      assert.deepEqual(journal.erreurs, [])
    } finally {
      await browser.close()
    }
  })
})
}
