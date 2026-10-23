// petits effets dans Chromium réel (happy-dom ne calcule ni transition, ni nom accessible, ni ligne de temps du
// défilement, ni ce que la souris touche) :
// - *dock et *zoom ne prennent pas pour un enfant le calque d'un autre effet posé sur la même balise ;
// - *magnet et les icônes d'un *dock gardent le transform de l'auteur ;
// - la transition de l'auteur reste sous *lift et ses voisins, et sous *focus, où une carte *lift glisse encore ;
//   *focus(grow) : la carte que la souris quitte reste au-dessus de sa voisine le temps de rétrécir ;
// - *smoke : au plus 300 bouffées vivantes, aucune sous « réduire les animations » ;
// - *glitch : ses copies du texte restent hors du nom accessible ; chaque barre de *scrollprogress a un nom ;
// - *scrollprogress sur une balise qui ne défile pas reste vide, et un lissage tenu par une variable s'applique ;
// - *lang ne coupe pas un émoji de `chars` en deux.
// Les effets sont posés par le moteur sur des balises de la page (µ._mjs_fx) ; un seul Chromium.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function chromiumPresent(): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright.chromium.executablePath())
  } catch {
    return false
  }
}

// les effets du banc : leur code part avec le composant qui les écrit
const EFFETS = ['dock', 'zoom', 'peel', 'mesh', 'ripple', 'focus', 'lift', 'stack', 'iso', 'extrude', 'clay', 'neon', 'highlight', 'outline', 'cycle', 'magnet', 'smoke', 'glitch', 'scrollprogress', 'lang']

const STYLE = 'html,body{margin:0;font:16px sans-serif}'
  + '.carte{transition:background-color .3s}'
  + '.tourne{transform:rotate(45deg)}'
  + '.rangee{display:flex;width:300px;margin:20px 0}.rangee>div{width:40px;height:40px;flex:none}'
  + '.cartes{display:flex;margin:40px}.cartes>div{width:100px;height:100px;background:#ccc}'

const F = 'filter, opacity, scale'

describe('petits effets (Chromium réel) — calques voisins, transform et transition de l\'auteur, accessibilité, fumée bornée', function () {
  this.timeout(240000)
  let present = false
  let script  = ''
  let browser: any = null

  before(async function () {
    present = await chromiumPresent()
    if (!present) {
      console.log('  ℹ️  chromium non installé, test sauté. Activer : `npx playwright install chromium`')
      return
    }
    const root   = mjsTmp('effets-calques-transitions-accessibilite')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fx-banc.mjs'), EFFETS.map((e) => `<div *${e}>x</div>`).join('\n') + '\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    const playwright = await import('playwright')
    browser = await playwright.chromium.launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  beforeEach(function () { if (!present) this.skip() })

  // une page vide (une zone, de quoi défiler) où le moteur pose les effets ; `fn` s'y exécute, la page est refermée ensuite
  async function avec<T>(fn: (page: any, ctx: any) => Promise<T>, options: any = {}): Promise<T> {
    const ctx  = await browser.newContext({ viewport: { width: 900, height: 700 }, ...options })
    const page = await ctx.newPage()
    const erreurs: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e)))
    try {
      await page.route('http://t.test/**', (route: any) => {
        if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body><div id="zone"></div><div style="height:3000px"></div><script>${script}</script></body></html>` })
      })
      await page.goto('http://t.test/', { waitUntil: 'load' })
      const r = await fn(page, ctx)
      assert.deepEqual(erreurs, [])
      return r
    }
    finally {
      await ctx.close()
    }
  }

  it('*dock : le calque d\'un autre effet n\'est pas une icône — la rangée ne glisse pas, le calque ne grossit pas', async () => {
    const r: any = await avec((page) => page.evaluate(async () => {
      const µ    = (window as any).µ
      const zone = document.getElementById('zone')!
      const rangee = () => {
        zone.insertAdjacentHTML('beforeend', '<div class="rangee">' + '<div>1</div>'.repeat(5) + '</div>')
        return zone.lastElementChild as HTMLElement
      }
      // la souris à 100 px du bord gauche : le décalage de chaque icône, et ce que reçoit le calque
      const mesure = async (el: HTMLElement) => {
        const b  = el.getBoundingClientRect()
        const ev = { bubbles: true, clientX: b.left + 100, clientY: b.top + 20, pointerType: 'mouse' }
        el.dispatchEvent(new PointerEvent('pointerenter', { ...ev, bubbles: false }))
        el.dispatchEvent(new PointerEvent('pointermove', ev))
        await new Promise((f) => setTimeout(f, 30))
        const icones = Array.from(el.children).filter((c) => !c.hasAttribute('mjs-fx-layer')) as HTMLElement[]
        const calque = el.querySelector('[mjs-fx-layer]') as HTMLElement | null
        return { t: icones.map((c) => c.style.getPropertyValue('--mjs-fx-dock-t')).join(' '), calque: calque ? { nom: calque.getAttribute('mjs-fx-layer'), s: calque.style.getPropertyValue('--mjs-fx-dock-s'), scale: getComputedStyle(calque).scale } : null }
      }
      const seul   = rangee()
      µ._mjs_fx(null, seul, 'dock', {})
      const maille = rangee()
      µ._mjs_fx(null, maille, 'mesh', {})
      µ._mjs_fx(null, maille, 'dock', {})
      const onde   = rangee()
      µ._mjs_fx(null, onde, 'dock', {})
      µ._mjs_fx(null, onde, 'ripple', {})
      const bo = onde.getBoundingClientRect()
      onde.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: bo.left + 5, clientY: bo.top + 5 }))
      return { seul: await mesure(seul), maille: await mesure(maille), onde: await mesure(onde) }
    }))
    assert.equal(r.seul.t.split(' ').filter(Boolean).length, 5, `la rangée seule : 5 icônes placées — ${JSON.stringify(r.seul)}`)
    for (const k of ['maille', 'onde']) {
      assert.ok(r[k].calque, `${k} : le calque de l'autre effet est posé — ${JSON.stringify(r[k])}`)
      assert.equal(r[k].t, r.seul.t, `${k} : les icônes se placent comme sans calque — ${JSON.stringify(r[k])}`)
      assert.equal(r[k].calque.s, '', `${k} : le calque n'est pas agrandi — ${JSON.stringify(r[k].calque)}`)
    }
  })

  it('*zoom (cadre) : le calque de *peel posé sur la même balise ne grossit pas avec la photo', async () => {
    const r: any = await avec(async (page) => {
      await page.evaluate(() => {
        const µ = (window as any).µ
        document.getElementById('zone')!.insertAdjacentHTML('beforeend', '<figure id="fig" style="width:300px;height:200px;margin:20px"><div style="width:300px;height:200px;background:#4af">photo</div></figure>')
        const f = document.getElementById('fig')!
        µ._mjs_fx(null, f, 'peel', {})
        µ._mjs_fx(null, f, 'zoom', {})
      })
      const b = await page.evaluate(() => document.getElementById('fig')!.getBoundingClientRect().toJSON())
      await page.mouse.move(b.left + 150, b.top + 100)
      await page.waitForTimeout(800)
      return page.evaluate(() => {
        const f = document.getElementById('fig')!
        return { cadre: !f.hasAttribute('mjs-fx-zoom-self'), photo: getComputedStyle(f.querySelector('div')!).scale, peel: getComputedStyle(f.querySelector('[mjs-fx-layer="peel"]')!).scale }
      })
    })
    assert.ok(r.cadre, `le zoom agit en cadre (sur les enfants) — ${JSON.stringify(r)}`)
    assert.match(r.photo, /^1\.\d+$/, `la photo grossit (propriété scale, qui s'ajoute à son transform) — ${JSON.stringify(r)}`)
    assert.equal(r.peel, 'none', `le coin de *peel garde sa taille — ${JSON.stringify(r)}`)
  })

  it('*magnet et les icônes d\'un *dock gardent le transform de l\'auteur ; l\'aimant suit encore la souris', async () => {
    const r: any = await avec((page) => page.evaluate(async () => {
      const µ    = (window as any).µ
      const zone = document.getElementById('zone')!
      zone.insertAdjacentHTML('beforeend', '<button class="tourne" id="fab" style="margin:40px">+</button><div class="rangee" id="dk"><div>1</div><div class="tourne">2</div><div>3</div></div>')
      const b      = document.getElementById('fab')!
      const icone  = document.getElementById('dk')!.children[1] as HTMLElement
      const avant  = getComputedStyle(b).transform
      const iavant = getComputedStyle(icone).transform
      µ._mjs_fx(null, b, 'magnet', {})
      µ._mjs_fx(null, document.getElementById('dk'), 'dock', {})
      // lu après la transition de retour (300 ms) : au repos
      await new Promise((f) => setTimeout(f, 600))
      const repos  = getComputedStyle(b).transform
      const irepos = getComputedStyle(icone).transform
      const box = b.getBoundingClientRect()
      b.dispatchEvent(new PointerEvent('pointerenter', { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 }))
      b.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: box.right, clientY: box.top + box.height / 2 }))
      await new Promise((f) => setTimeout(f, 400))
      return { avant, repos, iavant, irepos, suivi: getComputedStyle(b).translate, tourneEnSuivant: getComputedStyle(b).transform }
    }))
    assert.equal(r.repos, r.avant, `*magnet au repos : la rotation de l'auteur reste — ${JSON.stringify(r)}`)
    assert.equal(r.irepos, r.iavant, `*dock au repos : l'icône tournée le reste — ${JSON.stringify(r)}`)
    assert.match(r.suivi, /^20px/, `l'aimant glisse vers la souris (au bord : strength, 20 px) — ${JSON.stringify(r)}`)
    assert.equal(r.tourneEnSuivant, r.avant, `en suivant la souris, la balise garde sa rotation — ${JSON.stringify(r)}`)
  })

  it('la transition de l\'auteur reste sous *lift et ses voisins, la leur s\'y ajoute ; tout est rendu au retrait', async () => {
    const r: any = await avec((page) => page.evaluate(() => {
      const µ    = (window as any).µ
      const zone = document.getElementById('zone')!
      const cas: [string, string, any][] = [
        ['lift', '<button class="carte">acheter</button>', {}],
        ['stack', '<div class="carte">pile</div>', {}],
        ['iso', '<div class="carte">cube</div>', {}],
        ['extrude', '<h2 class="carte">Relief</h2>', {}],
        ['clay', '<div class="carte">pâte</div>', {}],
        ['neon', '<h2 class="carte">Néon</h2>', {}],
        ['zoom', '<p class="carte">texte</p>', {}],
        ['highlight', '<span class="carte">surligné</span>', {}],
        ['outline', '<h2 class="carte">Contour</h2>', {}],
        ['cycle', '<span class="carte">sites</span>', { words: ['applis', 'logos'] }]
      ]
      const out: any = {}
      for (const [nom, html, s] of cas) {
        zone.insertAdjacentHTML('beforeend', html)
        const el = zone.lastElementChild as HTMLElement
        µ._mjs_fx(null, el, nom, s)
        const pose = getComputedStyle(el).transitionProperty
        µ._mjs_fxClear(el)
        out[nom] = { pose, retrait: getComputedStyle(el).transitionProperty, marque: el.hasAttribute('mjs-fx-tr'), style: el.getAttribute('style') || '' }
      }
      return out
    }))
    const siens: Record<string, string> = { lift: 'transform, box-shadow', stack: 'transform, box-shadow', iso: 'transform, box-shadow', extrude: 'transform, text-shadow', clay: 'background, box-shadow, border-radius', neon: 'text-shadow, box-shadow, color', zoom: 'scale, clip-path', highlight: 'background-size', outline: 'background-size', cycle: 'width' }
    for (const [nom, props] of Object.entries(siens)) {
      assert.equal(r[nom].pose, 'background-color, ' + props, `*${nom} : la transition de l'auteur, puis la sienne — ${JSON.stringify(r[nom])}`)
      assert.equal(r[nom].retrait, 'background-color', `*${nom} retiré : la transition de l'auteur seule — ${JSON.stringify(r[nom])}`)
      assert.ok(!r[nom].marque && !/--mjs-fx-tr/.test(r[nom].style), `*${nom} retiré : ni marque ni variable laissées — ${JSON.stringify(r[nom])}`)
    }
  })

  it('*focus garde la transition propre de chaque carte (l\'auteur, un *lift posé avant ou après), y compris d\'une carte ajoutée ensuite', async () => {
    const r: any = await avec((page) => page.evaluate(() => {
      const µ    = (window as any).µ
      const zone = document.getElementById('zone')!
      const grille = (id: string) => {
        zone.insertAdjacentHTML('beforeend', `<div id="${id}"><div class="carte">a</div><div class="carte">b</div><div>c</div></div>`)
        return document.getElementById(id)!
      }
      const tp = (el: Element) => getComputedStyle(el).transitionProperty
      const g1 = grille('g1')
      µ._mjs_fx(null, g1.children[1], 'lift', {})
      µ._mjs_fx(null, g1, 'focus', {})
      const g2 = grille('g2')
      µ._mjs_fx(null, g2, 'focus', {})
      µ._mjs_fx(null, g2.children[1], 'lift', {})
      g2.insertAdjacentHTML('beforeend', '<div class="carte">d</div>')
      return new Promise((fin) => setTimeout(() => {
        const out: any = { avant: Array.from(g1.children).map(tp), apres: Array.from(g2.children).map(tp) }
        µ._mjs_fxClear(g2)
        out.retrait = Array.from(g2.children).map(tp)
        out.marques = Array.from(g2.children).map((c) => c.hasAttribute('mjs-fx-tr'))
        fin(out)
      }, 50))
    }))
    const tri = (s: string) => s.split(', ').sort().join(', ')
    for (const k of ['avant', 'apres']) {
      assert.equal(r[k][0], 'background-color, ' + F, `${k} : la carte de l'auteur garde sa transition — ${JSON.stringify(r[k])}`)
      assert.equal(tri(r[k][1]), tri('background-color, transform, box-shadow, ' + F), `${k} : la carte *lift glisse encore — ${JSON.stringify(r[k])}`)
      assert.equal(r[k][2], F, `${k} : une carte sans transition prend celle de l'effet — ${JSON.stringify(r[k])}`)
    }
    assert.equal(r.apres[3], 'background-color, ' + F, `la carte ajoutée après la pose aussi — ${JSON.stringify(r.apres)}`)
    assert.deepEqual(r.retrait, ['background-color', 'background-color, transform, box-shadow', 'all', 'background-color'], `*focus retiré : chaque carte retrouve la sienne — ${JSON.stringify(r.retrait)}`)
    assert.deepEqual(r.marques, [false, true, false, false], `*focus retiré : seule la carte *lift garde sa marque — ${JSON.stringify(r.marques)}`)
  })

  it('*focus(grow) : la carte que la souris quitte reste au-dessus de sa voisine le temps de rétrécir', async () => {
    const r: any = await avec(async (page) => {
      await page.evaluate(() => {
        document.getElementById('zone')!.insertAdjacentHTML('beforeend', '<div class="cartes" id="ca"><div id="c1">1</div><div id="c2">2</div><div id="c3">3</div></div>')
        ;(window as any).µ._mjs_fx(null, document.getElementById('ca'), 'focus', { grow: 1.5, blur: 0, duration: '1s' })
      })
      const b = await page.evaluate(() => document.getElementById('c1')!.getBoundingClientRect().toJSON())
      // ce qui est dessus à 10 px à droite de la carte 1 (dans son débord agrandi, sur la carte 2)
      const lire = () => page.evaluate((b: any) => {
        const c1  = document.getElementById('c1')!
        const hit = document.elementFromPoint(b.left + 110, b.top + 50)
        return { scale: getComputedStyle(c1).scale, z: getComputedStyle(c1).zIndex, dessus: hit && hit.id }
      }, b)
      await page.mouse.move(b.left + 50, b.top + 50)
      await page.waitForTimeout(1300)
      const grand = await lire()
      await page.mouse.move(b.left + 250, b.top + 50)
      await page.waitForTimeout(120)
      const retour = await lire()
      await page.waitForTimeout(1400)
      const fin = await lire()
      return { grand, retour, fin }
    })
    assert.equal(r.grand.dessus, 'c1', `survolée et agrandie, la carte 1 passe au-dessus de la 2 — ${JSON.stringify(r)}`)
    assert.ok(parseFloat(r.retour.scale) > 1.2, `la carte 1 rétrécit encore — ${JSON.stringify(r)}`)
    assert.equal(r.retour.dessus, 'c1', `en rétrécissant, la carte 1 reste au-dessus de la 2 — ${JSON.stringify(r)}`)
    assert.equal(r.fin.z, 'auto', `revenue à sa taille, elle n'a plus de z-index — ${JSON.stringify(r)}`)
  })

  it('*smoke : au plus 300 bouffées vivantes, même à count: 100 ; aucune sous « réduire les animations »', async () => {
    const jouer = (page: any) => page.evaluate(async () => {
      const µ = (window as any).µ
      document.getElementById('zone')!.insertAdjacentHTML('beforeend', '<div id="sm" style="width:300px;height:200px;background:#222">fumée</div>')
      const el = document.getElementById('sm')!
      µ._mjs_fx(null, el, 'smoke', { count: 100 })
      const b = el.getBoundingClientRect()
      let max = 0
      let n   = 0
      const t = performance.now()
      while (performance.now() - t < 1000) {
        await new Promise((f) => requestAnimationFrame(f))
        n++
        el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: b.left + 20 + (n * 7) % 260, clientY: b.top + 100, pointerType: 'mouse' }))
        max = Math.max(max, el.querySelectorAll('[mjs-fx-layer="smoke"] i').length)
      }
      return { max, images: n }
    })
    const vif = await avec(jouer)
    assert.ok(vif.max > 0, `la fumée naît sous la souris — ${JSON.stringify(vif)}`)
    assert.ok(vif.max <= 300, `au plus 300 bouffées vivantes — ${JSON.stringify(vif)}`)
    const calme = await avec(jouer, { reducedMotion: 'reduce' })
    assert.equal(calme.max, 0, `« réduire les animations » : aucune bouffée fabriquée — ${JSON.stringify(calme)}`)
  })

  it('lecteur d\'écran : *glitch ne fait pas lire ses copies du texte, chaque barre de *scrollprogress a un nom', async () => {
    const r: any = await avec(async (page, ctx) => {
      await page.evaluate(() => {
        const µ = (window as any).µ
        document.getElementById('zone')!.insertAdjacentHTML('beforeend', '<h1 id="t-glitch">Titre</h1><h2>Témoin</h2><div id="t-prog" style="height:80px;overflow:auto"><div style="height:400px">x</div></div><article id="t-art" style="height:200px">article</article>')
        µ._mjs_fx(null, document.getElementById('t-glitch'), 'glitch', { every: 0 })
        µ._mjs_fx(null, document.getElementById('t-prog'), 'scrollprogress', {})
        µ._mjs_fx(null, document.getElementById('t-art'), 'scrollprogress', { source: 'page' })
      })
      await page.waitForTimeout(150)
      const glitch = await page.evaluate(() => document.getElementById('t-glitch')!.hasAttribute('mjs-fx-glitch-burst'))
      const cdp    = await ctx.newCDPSession(page)
      const arbre  = await cdp.send('Accessibility.getFullAXTree')
      const noeuds = arbre.nodes.filter((n: any) => n.role && (n.role.value === 'heading' || n.role.value === 'progressbar')).map((n: any) => ({ role: n.role.value, nom: n.name ? n.name.value : '' }))
      return { glitch, noeuds }
    })
    assert.ok(r.glitch, 'la salve de *glitch est en cours (every: 0)')
    assert.deepEqual(r.noeuds.filter((n: any) => n.role === 'heading').map((n: any) => n.nom), ['Titre', 'Témoin'], `le titre se lit une fois — ${JSON.stringify(r.noeuds)}`)
    const barres = r.noeuds.filter((n: any) => n.role === 'progressbar')
    assert.equal(barres.length, 2, `deux barres — ${JSON.stringify(r.noeuds)}`)
    for (const b of barres) assert.ok(['Progression de la lecture', 'Reading progress'].includes(b.nom), `la barre dit ce qu'elle mesure — ${JSON.stringify(b)}`)
  })

  it('*scrollprogress : vide sur une balise qui ne défile pas, même avec la ligne de temps du navigateur ; un lissage tenu par une variable s\'applique', async () => {
    const r: any = await avec((page) => page.evaluate(async () => {
      const µ    = (window as any).µ
      const zone = document.getElementById('zone')!
      zone.insertAdjacentHTML('beforeend', '<article id="art" style="height:200px">article sans débordement</article><div id="vif" style="height:80px;overflow:auto"><div style="height:400px">x</div></div>')
      const calque = (el: Element) => el.querySelector('[mjs-fx-layer="scrollprogress"]') as HTMLElement
      const art = document.getElementById('art')!
      µ._mjs_fx(null, art, 'scrollprogress', {})
      window.scrollTo(0, 1500)
      await new Promise((f) => setTimeout(f, 150))
      const out: any = { natif: calque(art).hasAttribute('mjs-fx-scrollprogress-native'), barre: getComputedStyle(calque(art).querySelector('i')!).transform }
      window.scrollTo(0, 0)
      const vif = document.getElementById('vif')!
      µ._mjs_fx(null, vif, 'scrollprogress', { duration: '0s' })
      out.vifNatifAvant = calque(vif).hasAttribute('mjs-fx-scrollprogress-native')
      µ._mjs_fxSet(vif, 'scrollprogress', { duration: '600ms' })
      out.vifNatif      = calque(vif).hasAttribute('mjs-fx-scrollprogress-native')
      out.vifTransition = getComputedStyle(calque(vif).querySelector('i')!).transition
      vif.scrollTop = 160
      await new Promise((f) => setTimeout(f, 150))
      out.vifPart = calque(vif).style.getPropertyValue('--mjs-fx-scrollprogress-p')
      return out
    }))
    assert.equal(r.barre, 'matrix(0, 0, 0, 1, 0, 0)', `la page défile, pas la balise : barre vide — ${JSON.stringify(r)}`)
    assert.equal(r.natif, false, `pas de ligne de temps native sur une balise qui ne défile pas — ${JSON.stringify(r)}`)
    assert.equal(r.vifNatifAvant, true, `posée à 0s sur une balise qui défile : la ligne de temps native — ${JSON.stringify(r)}`)
    assert.equal(r.vifNatif, false, `la durée passe à 600ms : la barre quitte la ligne de temps native — ${JSON.stringify(r)}`)
    assert.equal(r.vifTransition, 'transform 0.6s linear', `et se lisse — ${JSON.stringify(r)}`)
    assert.equal(r.vifPart, '0.5', `elle suit le défilement de la balise (160 px sur 320) — ${JSON.stringify(r)}`)
  })

  it('*lang : des émoji dans `chars` ne sont jamais coupés en deux pendant le brouillage', async () => {
    const r: any = await avec((page) => page.evaluate(async () => {
      const µ    = (window as any).µ
      const seul = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
      document.getElementById('zone')!.insertAdjacentHTML('beforeend', '<p id="lg">Bonjour tout le monde</p>')
      const el = document.getElementById('lg')!
      µ._mjs_fx(null, el, 'lang', { chars: '🎲🎯', duration: '3s' })
      if (!µ._mjs_i18nComps) µ._mjs_i18nComps = new Set()
      µ._mjs_i18nComps.add(el)
      µ._mjs_i18nSwapHooks.forEach((h: any) => h('en', 'fr'))
      ;(el.firstChild as Text).data = 'Hello everybody here'
      await new Promise((f) => setTimeout(f, 0))
      const vus = [(el.firstChild as Text).data]
      for (let i = 0; i < 5; i++) {
        await new Promise((f) => requestAnimationFrame(f))
        vus.push((el.firstChild as Text).data)
      }
      return { vus, coupe: vus.some((t) => seul.test(t)), brouille: vus[0] !== 'Hello everybody here' }
    }))
    assert.ok(r.brouille, `le texte se brouille — ${JSON.stringify(r.vus)}`)
    assert.equal(r.coupe, false, `aucun demi-caractère à l'écran — ${JSON.stringify(r.vus)}`)
  })
})
