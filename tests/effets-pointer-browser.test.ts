// *pointer dans Chromium réel : ce qui se voit — les couleurs sous le curseur (disque en différence, anneau, point,
// lentilles noir et blanc, inversée, floue, fusion normale), le grossissement sur ce qui se clique et l'appui (au défaut
// et écrits : `grow` et `press` règlent la taille que le disque prend vraiment), le retard
// puis l'arrêt de la boucle (rien ne tourne au repos : ni image, ni minuterie), le curseur du système caché jusque dans
// les composants à ombre fermée (sauf sur un champ de saisie), le disque qui s'efface hors de sa zone et de la fenêtre,
// le retrait sans reste, un écran sans souris, « réduire les animations ». Les pixels se lisent sur une capture.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function navigateurPresent(nom: 'chromium' | 'webkit'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

// huit scènes de 300 × 100 aux couleurs unies : ce qu'on lit sous le curseur se calcule
const SCENES = [
  '<div class="s s0" *pointer(disc)><a class="a" href="#x" data-pointer="Voir" aria-label="Voir"></a></div>',
  '<div class="s s1" *pointer(ring, size: 40)></div>',
  '<div class="s s2" *pointer(dot, size: 40)></div>',
  '<div class="s s3" *pointer(lens, filter: grayscale, size: 60)></div>',
  '<div class="s s4" *pointer(lens, filter: invert, size: 60)></div>',
  '<div class="s s5" *pointer(disc, color: #ffff00, blend: normal, size: 20)></div>',
  '<div class="s s6" *pointer(lens, filter: blur, size: 80)></div>',
  '<div class="theme"><div class="s s7" *pointer(disc, blend: normal, size: 20)></div></div>',
  '<style>',
  '.s',
  '  position: relative',
  '  width: 300px',
  '  height: 100px',
  '  background: #336699',
  '.s3',
  '  background: #ff0000',
  '.s5',
  '  background: #0000ff',
  '.s6',
  '  background: linear-gradient(90deg, #ff0000 50%, #0000ff 50%)',
  '.theme',
  '  --mjs-pointer-color: #ffff00',
  '.a',
  '  position: absolute',
  '  right: 10px',
  '  top: 30px',
  '  width: 60px',
  '  height: 30px',
  '  background: #000',
  '</style>',
  ''
].join('\n')

// une scène dont le disque a une taille, un grossissement et un appui écrits (aucun n'est celui du défaut : 36, 2,2 et 0,8)
const TAILLES = [
  '<div class="s" *pointer(disc, size: 40, grow: 4, press: .5)><a class="a" href="#x" data-pointer="Voir" aria-label="Voir"></a></div>',
  '<style>',
  '.s',
  '  position: relative',
  '  width: 300px',
  '  height: 100px',
  '  background: #336699',
  '.a',
  '  position: absolute',
  '  right: 10px',
  '  top: 30px',
  '  width: 60px',
  '  height: 30px',
  '  background: #000',
  '</style>',
  ''
].join('\n')

// un composant à ombre fermée, avec son bouton qui pose son propre `cursor`
const CARTE = '<div class="in"><button class="bt" data-pointer="Ouvrir">Un bouton</button><a class="al" href="#y">Un lien</a></div>\n<style>\n.in\n  display: grid\n  gap: 12px\n  padding: 12px\n.bt, .al\n  cursor: pointer\n</style>\n'

const PAGE = [
  '<@document *pointer(dot, hide: true, size: 40)></@document>',
  '<main class="m">',
  '  <a class="l" href="#x">Un lien du document</a>',
  '  <input class="c" type="text" value="un champ" aria-label="champ">',
  '  <div class="e" contenteditable="true">Un texte à modifier</div>',
  '  <@pt-carte class="k"></@pt-carte>',
  '  <p class="p">Du texte simple</p>',
  '</main>',
  '<style>',
  '.m',
  '  display: grid',
  '  gap: 20px',
  '  padding: 40px',
  '  width: 420px',
  '  font: 18px system-ui, sans-serif',
  '</style>',
  ''
].join('\n')

const RETRAIT = [
  '<script>',
  '$on = true',
  '</script>',
  '{if $on}<div class="z" *pointer(ring, hide: true)><@pt-carte></@pt-carte></div>{end}',
  '<button class="t" @click={$on = !$on}>t</button>',
  '<style>',
  '.z',
  '  width: 300px',
  '  height: 120px',
  '  background: #336699',
  '</style>',
  ''
].join('\n')

// compte les images d'animation, les minuteries et les intervalles demandés depuis le chargement
const COMPTE = `(() => {
  window.__n = { raf: 0, to: 0, iv: 0 }
  const raf = window.requestAnimationFrame
  window.requestAnimationFrame = (f) => { window.__n.raf++; return raf.call(window, f) }
  const to = window.setTimeout
  window.setTimeout = function (...a) { window.__n.to++; return to.apply(window, a) }
  const iv = window.setInterval
  window.setInterval = function (...a) { window.__n.iv++; return iv.apply(window, a) }
})()`

// Chromium, et WebKit quand il est installé
for (const nom of ['chromium', 'webkit'] as const) describe(`*pointer (${nom} réel)`, function () {
  this.timeout(240000)
  let present = false
  let script  = ''

  before(async function () {
    present = await navigateurPresent(nom)
    if (!present) {
      console.log(`  ℹ️  ${nom} non installé, test de *pointer sauté. Activer : \`npx playwright install ${nom}\``)
      return
    }
    const root   = mjsTmp('effets-pointer-browser')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'pt-scenes.mjs'), SCENES)
    writeFileSync(join(srcDir, 'pt-tailles.mjs'), TAILLES)
    writeFileSync(join(srcDir, 'pt-carte.mjs'), CARTE)
    writeFileSync(join(srcDir, 'pt-page.mjs'), PAGE)
    writeFileSync(join(srcDir, 'pt-retrait.mjs'), RETRAIT)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })

  after(async () => { await terminateSharedWorkerPool() })

  let browser: any
  before(async function () {
    if (!present) return
    const playwright = await import('playwright')
    browser = await playwright[nom].launch(nom === 'chromium' ? { args: ['--no-sandbox', '--enable-unsafe-swiftshader'] } : {})
  })
  after(async () => { await browser?.close() })

  async function ouvre(tag: string, options: any = {}) {
    const contexte = await browser.newContext({ viewport: { width: 800, height: 800 }, ...options })
    const page     = await contexte.newPage()
    await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => true }))
    await page.addInitScript(COMPTE)
    await page.route('http://t.test/**', (route: any) => {
      if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
    })
    await page.goto('http://t.test/', { waitUntil: 'load' })
    await page.waitForFunction((t: string) => ((document.querySelector(t) as any)?._shadow?.childElementCount ?? 0) > 0, tag)
    await page.waitForTimeout(300)
    // un pixel de la capture : un carré de 81 px autour du point (un flou a besoin de voisins : sur un seul pixel, il ne mêle rien),
    // décodé par le navigateur lui-même
    const pixel = async (x: number, y: number) => {
      const px = Math.floor(x)
      const py = Math.floor(y)
      const x0 = Math.max(0, px - 40)
      const y0 = Math.max(0, py - 40)
      const png = await page.screenshot({ clip: { x: x0, y: y0, width: 81, height: 81 } })
      return page.evaluate(async ({ b64, dx, dy }: any) => {
        const image = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob())
        const ctx   = new OffscreenCanvas(image.width, image.height).getContext('2d') as OffscreenCanvasRenderingContext2D
        ctx.drawImage(image, 0, 0)
        return Array.from(ctx.getImageData(dx, dy, 1, 1).data).slice(0, 3)
      }, { b64: png.toString('base64'), dx: px - x0, dy: py - y0 }) as Promise<number[]>
    }
    // le centre d'une balise du composant (`>` : dans le composant imbriqué)
    const centre = (sel: string) => page.evaluate(({ t, s }: any) => {
      const dedans = s.startsWith('>')
      const racine = (document.querySelector(t) as any)._shadow
      const n      = dedans ? racine.querySelector('mjs-pt-carte')._shadow.querySelector(s.slice(1)) : racine.querySelector(s)
      const r      = n.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, left: r.x, top: r.y }
    }, { t: tag, s: sel })
    const curseur = (sel: string) => page.evaluate(({ t, s }: any) => {
      const dedans = s.startsWith('>')
      const racine = (document.querySelector(t) as any)._shadow
      const n      = dedans ? racine.querySelector('mjs-pt-carte')._shadow.querySelector(s.slice(1)) : racine.querySelector(s)
      return getComputedStyle(n).cursor
    }, { t: tag, s: sel })
    // l'état du premier calque encore là : ses marques, la boîte et la position du disque, le mot
    const etat = () => page.evaluate(() => {
      const l = document.querySelector('[mjs-fx-pointer-layer]')
      if (!l) return null
      const i = l.querySelector('i') as HTMLElement
      const r = i.getBoundingClientRect()
      return { attrs: l.getAttributeNames().filter((n) => n.startsWith('mjs-fx-pointer-')), couches: document.querySelectorAll('[mjs-fx-pointer-layer]').length, largeur: r.width, cx: r.x + r.width / 2, cy: r.y + r.height / 2, translate: i.style.translate, mot: (l.querySelector('b') as HTMLElement).textContent, opacite: getComputedStyle(i).opacity, willChange: getComputedStyle(i).willChange, duree: getComputedStyle(i).transitionDuration, z: getComputedStyle(i).zIndex }
    })
    const compteurs = () => page.evaluate(() => ({ ...(window as any).__n }))
    return { page, contexte, pixel, centre, curseur, etat, compteurs }
  }

  const proche = (pixel: number[], attendu: number[], marge = 4) => assert.ok(pixel.every((c, i) => Math.abs(c - attendu[i]) <= marge), `pixel ${pixel} attendu ${attendu} (± ${marge})`)

  it('les couleurs sous le curseur : disque en différence, anneau, point, lentilles, fusion normale ; le disque s\'efface hors de sa zone', async function () {
    if (!present) return this.skip()
    const { page, contexte, pixel, centre, etat } = await ouvre('mjs-pt-scenes')
    const fond = [51, 102, 153]
    const inverse = [204, 153, 102]
    const sur = async (n: number) => {
      const c = await centre('.s' + n)
      await page.mouse.move(c.x - 30, c.y, { steps: 3 })
      await page.mouse.move(c.x, c.y, { steps: 3 })
      // le disque a rejoint la souris (la boucle est finie) et le fondu est joué : les pixels se lisent alors
      await page.waitForFunction(() => !document.querySelector('[mjs-fx-pointer-layer][mjs-fx-pointer-live]'), null, { timeout: 15000 })
      await page.waitForTimeout(350)
      return c
    }
    // disque blanc en différence : tout ce qu'il recouvre est inversé
    let c = await sur(0)
    proche(await pixel(c.x, c.y), inverse)
    assert.equal((await etat())!.couches, 8, 'un calque par balise')
    // anneau : le dessous au centre, l'inversion sur l'anneau
    c = await sur(1)
    proche(await pixel(c.x, c.y), fond)
    proche(await pixel(c.x + 18, c.y), inverse)
    // point et anneau
    c = await sur(2)
    proche(await pixel(c.x, c.y), inverse)
    proche(await pixel(c.x + 18, c.y), inverse)
    proche(await pixel(c.x + 10, c.y), fond)
    // lentilles : noir et blanc (le rouge pur a pour luminance 54), inversion, flou sur une arête. La capture d'écran du WebKit de Playwright ne peint pas
    // `backdrop-filter` (mesuré sur une page nue : l'écart-type du fond est le même dans et hors du filtre, alors que le style calculé est bien blur(6px)) :
    // les lentilles ne s'y lisent pas, le test s'y arrête après le reste, sauté et non validé
    const lentilles = nom !== 'webkit'
    if (lentilles) {
      c = await sur(3)
      proche(await pixel(c.x, c.y), [54, 54, 54])
      proche(await pixel(c.x + 60, c.y), [255, 0, 0])
      c = await sur(4)
      proche(await pixel(c.x, c.y), inverse)
      c = await sur(5)
      proche(await pixel(c.x, c.y), [255, 255, 0])
      c = await sur(6)
      const flou = await pixel(c.x - 3, c.y)
      assert.ok(flou[2] > 15 && flou[0] < 245, `le flou mêle le rouge et le bleu de l'arête : ${flou}`)
      proche(await pixel(c.x - 100, c.y), [255, 0, 0], 2)
    }
    // la couleur d'un thème posé autour de la balise (le calque n'est pas dans la balise : l'effet la lit à la pose)
    c = await sur(7)
    proche(await pixel(c.x, c.y), [255, 255, 0])
    // hors de la zone : le disque s'efface, la couleur du dessous revient
    await page.mouse.move(500, c.y, { steps: 4 })
    await page.waitForTimeout(500)
    assert.equal(await page.evaluate(() => document.querySelectorAll('[mjs-fx-pointer-layer][mjs-fx-pointer-on]').length), 0, 'aucun calque visible')
    await contexte.close()
    if (!lentilles) {
      console.log(`  ℹ️  ${nom} : la capture d'écran de ce moteur (Playwright) ne peint pas backdrop-filter, les lentilles (noir et blanc, inversion, flou) ne sont pas vérifiées, test sauté`)
      this.skip()
    }
  })

  it('sur ce qui se clique le disque grossit et montre son mot ; l\'appui le réduit ; un fond nu le rend à sa taille', async function () {
    if (!present) return this.skip()
    const { page, contexte, centre, etat } = await ouvre('mjs-pt-scenes')
    const s = await centre('.s0')
    await page.mouse.move(s.x - 60, s.y, { steps: 3 })
    await page.waitForTimeout(500)
    let e = (await etat())!
    assert.ok(Math.abs(e.largeur - 36) < 1, 'au repos : 36 px, ' + e.largeur)
    assert.equal(e.z, '2147483000', 'au-dessus de tout, par défaut')
    assert.ok(!e.attrs.includes('mjs-fx-pointer-hot'))
    const lien = await centre('.a')
    await page.mouse.move(lien.x, lien.y, { steps: 4 })
    await page.waitForTimeout(600)
    e = (await etat())!
    assert.ok(e.attrs.includes('mjs-fx-pointer-hot'))
    assert.ok(e.attrs.includes('mjs-fx-pointer-word'))
    assert.equal(e.mot, 'Voir')
    assert.ok(Math.abs(e.largeur - 36 * 2.2) < 1.5, 'grossi 2,2 fois : ' + e.largeur)
    await page.mouse.down()
    await page.waitForTimeout(500)
    e = (await etat())!
    assert.ok(e.attrs.includes('mjs-fx-pointer-down'))
    assert.ok(Math.abs(e.largeur - 36 * 2.2 * 0.8) < 1.5, 'appuyé : ' + e.largeur)
    await page.mouse.up()
    await page.waitForTimeout(500)
    e = (await etat())!
    assert.ok(Math.abs(e.largeur - 36 * 2.2) < 1.5, 'relâché : ' + e.largeur)
    await page.mouse.move(s.x - 60, s.y, { steps: 4 })
    await page.waitForTimeout(600)
    e = (await etat())!
    assert.ok(Math.abs(e.largeur - 36) < 1, 'rendu à sa taille : ' + e.largeur)
    assert.equal(e.mot, '')
    await contexte.close()
  })

  it('grow et press écrits règlent la taille que prend le disque : au repos size, sur ce qui se clique size × grow, appuyé size × press (× grow sur ce qui se clique)', async function () {
    if (!present) return this.skip()
    const { page, contexte, centre, etat } = await ouvre('mjs-pt-tailles')
    // la largeur du disque, une fois la transition de taille jouée (attendue : lue jusqu'à ce qu'elle la rejoigne)
    const largeur = async (attendue: number) => {
      await page.waitForFunction((cible: number) => {
        const i = document.querySelector('[mjs-fx-pointer-layer] > i') as HTMLElement | null
        return !!i && Math.abs(i.getBoundingClientRect().width - cible) < 1
      }, attendue, { timeout: 4000 }).catch(() => {})
      return (await etat())!.largeur
    }
    const s = await centre('.s')
    await page.mouse.move(s.x - 100, s.y, { steps: 3 })
    assert.ok(Math.abs(await largeur(40) - 40) < 1, 'au repos : 40 px (size écrit), pas 36')
    // l'appui sur un fond nu : la taille de repos fois press
    await page.mouse.down()
    let l = await largeur(20)
    assert.ok(Math.abs(l - 20) < 1.5, 'appuyé sur un fond nu : 40 × 0,5 = 20 px (press écrit, pas 0,8), ' + l)
    await page.mouse.up()
    assert.ok(Math.abs(await largeur(40) - 40) < 1, 'relâché : 40 px')
    // sur ce qui se clique : la taille de repos fois grow
    const lien = await centre('.a')
    await page.mouse.move(lien.x, lien.y, { steps: 4 })
    assert.ok((await etat())!.attrs.includes('mjs-fx-pointer-hot'))
    l = await largeur(160)
    assert.ok(Math.abs(l - 160) < 1.5, 'sur le lien : 40 × 4 = 160 px (grow écrit, pas 2,2), ' + l)
    // appuyé sur ce qui se clique : grow et press ensemble
    await page.mouse.down()
    l = await largeur(80)
    assert.ok(Math.abs(l - 80) < 1.5, 'appuyé sur le lien : 40 × 4 × 0,5 = 80 px, ' + l)
    await page.mouse.up()
    l = await largeur(160)
    assert.ok(Math.abs(l - 160) < 1.5, 'relâché : 160 px, ' + l)
    await page.mouse.move(s.x - 100, s.y, { steps: 4 })
    assert.ok(Math.abs(await largeur(40) - 40) < 1, 'rendu à sa taille de repos : 40 px')
    await contexte.close()
  })

  it('le retard, puis plus rien : une seule boucle qui s\'arrête, aucune image ni minuterie au repos', async function () {
    if (!present) return this.skip()
    const { page, contexte, centre, etat, compteurs } = await ouvre('mjs-pt-scenes')
    const s = await centre('.s0')
    await page.mouse.move(s.left + 20, s.y)
    await page.waitForTimeout(300)
    let e = (await etat())!
    assert.ok(Math.abs(e.cx - (s.left + 20)) < 0.6, 'apparu sous la souris : ' + e.cx)
    assert.ok(!e.attrs.includes('mjs-fx-pointer-live'))
    // un grand écart d'un coup : le disque est en retard, la couche est posée pendant le trajet
    await page.mouse.move(s.left + 250, s.y)
    await page.waitForTimeout(50)
    e = (await etat())!
    assert.ok(e.cx > s.left + 20 && e.cx < s.left + 250, 'en route : ' + e.cx)
    assert.ok(e.attrs.includes('mjs-fx-pointer-live'))
    assert.equal(e.willChange, 'translate')
    await page.waitForFunction(() => !(document.querySelector('[mjs-fx-pointer-layer]') as Element).hasAttribute('mjs-fx-pointer-live'), null, { timeout: 15000 })
    e = (await etat())!
    assert.ok(Math.abs(e.cx - (s.left + 250)) < 0.2, 'arrivé : ' + e.cx)
    assert.ok(!e.attrs.includes('mjs-fx-pointer-live'))
    assert.equal(e.willChange, 'auto', 'la couche est rendue')
    const avant = await compteurs()
    const place = e.translate
    await page.waitForTimeout(1500)
    const apres = await compteurs()
    assert.deepEqual(apres, avant, 'au repos : ni image, ni minuterie, ni intervalle')
    assert.equal((await etat())!.translate, place)
    await contexte.close()
  })

  it('<@document> : le curseur du système est caché partout — jusque dans un composant à ombre fermée qui pose son `cursor` —, sauf sur un champ ; le disque s\'efface quand la souris quitte la fenêtre', async function () {
    if (!present) return this.skip()
    const { page, contexte, centre, curseur, etat } = await ouvre('mjs-pt-page')
    assert.ok(await page.evaluate(() => document.documentElement.hasAttribute('mjs-fx-pointer-hide')))
    const va = async (sel: string) => {
      const c = await centre(sel)
      await page.mouse.move(c.x, c.y, { steps: 4 })
      await page.waitForTimeout(600)
    }
    await va('.l')
    assert.equal(await curseur('.l'), 'none', 'un lien du document')
    assert.ok((await etat())!.attrs.includes('mjs-fx-pointer-hot'))
    await va('.c')
    // `text` dans Chromium ; WebKit laisse `auto` à un champ de saisie (le curseur en I y est celui du navigateur) : ce qui compte est que l'effet ne le cache pas
    assert.ok(['text', 'auto'].includes(await curseur('.c')), 'un champ de saisie garde le sien (ni caché, ni remplacé)')
    assert.ok((await etat())!.attrs.includes('mjs-fx-pointer-hot'), 'et le disque grossit dessus')
    await va('.e')
    assert.notEqual(await curseur('.e'), 'none', 'un texte éditable garde son curseur')
    await va('.p')
    assert.equal(await curseur('.p'), 'none')
    assert.ok(!(await etat())!.attrs.includes('mjs-fx-pointer-hot'))
    await va('>.bt')
    assert.equal(await curseur('>.bt'), 'none', 'le bouton du composant, malgré son cursor: pointer')
    let e = (await etat())!
    assert.ok(e.attrs.includes('mjs-fx-pointer-hot'), 'la balise survolée se lit dans l\'ombre fermée')
    assert.equal(e.mot, 'Ouvrir')
    await va('>.al')
    assert.equal(await curseur('>.al'), 'none')
    assert.equal((await etat())!.mot, '', 'un lien sans data-pointer : pas de mot')
    await page.mouse.move(-5, 300, { steps: 3 })
    await page.waitForTimeout(500)
    e = (await etat())!
    assert.ok(!e.attrs.includes('mjs-fx-pointer-on'), 'la souris a quitté la fenêtre')
    assert.equal(Number(e.opacite), 0)
    await contexte.close()
  })

  it('le retrait : le calque, la marque et la feuille posée dans les ombres traversées partent ; plus rien n\'écoute ni ne tourne', async function () {
    if (!present) return this.skip()
    const { page, contexte, centre, compteurs } = await ouvre('mjs-pt-retrait')
    // la racine de la carte est gardée : elle reste lisible une fois la balise retirée
    const feuilles = () => page.evaluate(() => {
      const w = window as any
      w.__ombre = w.__ombre || (document.querySelector('mjs-pt-retrait') as any)._shadow.querySelector('mjs-pt-carte')._shadow
      return w.__ombre.adoptedStyleSheets.length
    })
    const avant = await feuilles()
    const bouton = await centre('>.bt')
    await page.mouse.move(bouton.x, bouton.y, { steps: 4 })
    await page.waitForTimeout(600)
    assert.equal(await feuilles(), avant + 1, 'une feuille « sans curseur » dans l\'ombre traversée')
    assert.equal(await page.evaluate(() => document.querySelectorAll('[mjs-fx-pointer-layer]').length), 1)
    const t = await centre('.t')
    await page.mouse.move(t.x, t.y, { steps: 4 })
    await page.evaluate(() => (document.querySelector('mjs-pt-retrait') as any)._shadow.querySelector('.t').click())
    await page.waitForFunction(() => !(document.querySelector('mjs-pt-retrait') as any)._shadow.querySelector('.z'))
    await page.waitForTimeout(300)
    assert.equal(await page.evaluate(() => document.querySelectorAll('[mjs-fx-pointer-layer]').length), 0, 'le calque est parti')
    assert.equal(await feuilles(), avant, 'la feuille posée dans l\'ombre traversée est retirée')
    const n0 = await compteurs()
    await page.mouse.move(100, 400, { steps: 5 })
    await page.mouse.move(120, 420, { steps: 5 })
    await page.mouse.down()
    await page.mouse.up()
    await page.waitForTimeout(600)
    const n1 = await compteurs()
    assert.equal(n1.raf, n0.raf, 'plus aucune image demandée par la souris')
    // remise : l'effet repart, une fois
    await page.evaluate(() => (document.querySelector('mjs-pt-retrait') as any)._shadow.querySelector('.t').click())
    await page.waitForFunction(() => !!(document.querySelector('mjs-pt-retrait') as any)._shadow.querySelector('.z'))
    await page.waitForTimeout(300)
    assert.equal(await page.evaluate(() => document.querySelectorAll('[mjs-fx-pointer-layer]').length), 1)
    await contexte.close()
  })

  it('un écran sans souris (hover: none) : rien n\'est posé', async function () {
    if (!present) return this.skip()
    const { page, contexte } = await ouvre('mjs-pt-scenes', { hasTouch: true, isMobile: true, viewport: { width: 400, height: 800 } })
    assert.equal(await page.evaluate(() => matchMedia('(hover: none)').matches), true, 'l\'émulation dit bien « pas de survol »')
    assert.equal(await page.evaluate(() => document.querySelectorAll('[mjs-fx-pointer-layer]').length), 0)
    await contexte.close()
  })

  it('« réduire les animations » : le disque suit sans retard, sans transition', async function () {
    if (!present) return this.skip()
    const { page, contexte, centre, etat } = await ouvre('mjs-pt-scenes', { reducedMotion: 'reduce' })
    const s = await centre('.s0')
    await page.mouse.move(s.left + 20, s.y)
    await page.waitForTimeout(300)
    await page.mouse.move(s.left + 250, s.y)
    await page.waitForTimeout(120)
    const e = (await etat())!
    assert.ok(Math.abs(e.cx - (s.left + 250)) < 0.2, 'collé à la souris : ' + e.cx)
    assert.equal(e.duree.split(',').every((d: string) => d.trim() === '0s'), true, 'aucune transition : ' + e.duree)
    await contexte.close()
  })
})
