// *physics dans Chromium, Firefox et WebKit réels : une vraie mise en page est nécessaire (happy-dom ne mesure
// rien). Les enfants du conteneur tombent, se saisissent à la souris, flottent, pendent à leur fil ; la boucle
// s'arrête quand tout dort ; le retrait ne laisse rien ; « réduire les animations » fige la mise en page.
// WebKit n'est présent que si PLAYWRIGHT_BROWSERS_PATH le donne (le test est alors sauté).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
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

const etiquettes = (n: number) => Array.from({ length: n }, (_, i) => `<span>E${i}</span>`).join('')
// un bac de 420 × 300 px aux étiquettes de 90 × 32 px, un lien parmi elles
const SCENE = '\n.bac\n  width: 420px\n  height: 300px\n  overflow: hidden\n  background: #222\n  span, a\n    display: inline-block\n    box-sizing: border-box\n    width: 90px\n    height: 32px\n    margin: 4px\n    border-radius: 8px\n    background: #829cf1\n    color: #000\n    text-align: center\n    line-height: 32px\n'

const SOURCES: Record<string, string> = {
  'fall.mjs':      `<div class="bac" *physics>${etiquettes(6)}<a class="lien" href="#lien">Lien</a></div>\n<style>${SCENE}</style>\n`,
  // des corps qui portent un descendant (un <b> qui les remplit) : la souris touche le <b>, c'est le corps qui se saisit
  'imbrique.mjs':  `<div class="bac" *physics><span><b>E0</b></span><span><b>E1</b></span><span><b>E2</b></span></div>\n<style>${SCENE}  b\n    display: block\n    height: 100%\n</style>\n`,
  'clic.mjs':      `<div class="bac" *physics(on: click)>${etiquettes(6)}</div>\n<style>${SCENE}</style>\n`,
  'vide.mjs':      '<div class="vide" *physics(on: load)><span>a</span><span>b</span></div>\n<style>\n.vide\n  height: 0\n  width: 200px\n</style>\n',
  'flottant.mjs':  '<div class="cap" *physics(float, push: 200)><div>Un</div><div>Deux</div></div>\n<style>\n.cap\n  width: 420px\n  height: 240px\n  display: flex\n  flex-direction: column\n  align-items: center\n  justify-content: center\n  gap: 16px\n  div\n    width: 300px\n    height: 50px\n    border-radius: 999px\n    background: #55c773\n</style>\n',
  'pendu.mjs':     '<div class="cord" *physics(hang, length: 90, color: #ff0000)><b>A</b><b>B</b><b>C</b></div>\n<style>\n.cord\n  width: 420px\n  height: 300px\n  padding-top: 120px\n  box-sizing: border-box\n  display: flex\n  justify-content: center\n  gap: 14px\n  b\n    display: block\n    width: 80px\n    height: 80px\n    border-radius: 10px\n    background: #f5ba66\n</style>\n',
  'retrait.mjs':   `<script>\n$on = true\n</script>\n{if $on}\n<div class="bac" *physics>${etiquettes(5)}</div>\n{end}\n<button class="t" @click={$on = !$on}>t</button>\n<style>${SCENE}</style>\n`,
  'beaucoup.mjs':  `<div class="bac" *physics>${etiquettes(70)}</div>\n<style>\n.bac\n  width: 900px\n  height: 900px\n  span\n    display: inline-block\n    width: 60px\n    height: 20px\n    margin: 2px\n    background: #829cf1\n</style>\n`,
  // aucun enfant ; une liste qu'on vide puis qu'on remplit
  'zero.mjs':      '<div class="z" *physics></div>\n<style>\n.z\n  width: 200px\n  height: 100px\n  background: #222\n</style>\n',
  'liste.mjs':     `<script>\n$items = [{id: 1}, {id: 2}, {id: 3}, {id: 4}]\n$next = 5\n</script>\n<div class="bac" *physics>{for it in $items by id}<span>{it.id}</span>{end}</div>\n<button class="plus" @click={$items = $items.concat([{id: $next}]); $next = $next + 1}>+</button>\n<button class="vider" @click={$items = []}>0</button>\n<style>${SCENE}</style>\n`,
  // des enfants tournés (rotate, transform) ou agrandis (scale) : un bac large, chacun tombe droit sur le sol
  'penche.mjs':    '<div class="large" *physics><span class="r1">A</span><span class="r2">B</span><span class="r3">C</span><span>D</span></div>\n<style>\n.large\n  width: 900px\n  height: 300px\n  overflow: hidden\n  background: #222\n  span\n    display: inline-block\n    box-sizing: border-box\n    width: 90px\n    height: 32px\n    margin: 4px\n    border-radius: 8px\n    background: #829cf1\n  .r1\n    rotate: -12deg\n  .r2\n    scale: 1.5\n  .r3\n    transform: rotate(5deg)\n</style>\n',
  // un ancêtre réduit : l'échelle ne change pas la mise en page des enfants
  'ancetre.mjs':   `<div class="enveloppe"><div class="bac" *physics>${etiquettes(6)}</div></div>\n<style>\n.enveloppe\n  transform: scale(0.8)\n  transform-origin: 0 0\n  width: 420px${SCENE}</style>\n`,
  // 6 étiquettes dans un bac de 80 × 80 px : elles ne tiennent pas
  'serre.mjs':     `<div class="bac" *physics>${etiquettes(6)}</div>\n<style>\n.bac\n  width: 80px\n  height: 80px\n  overflow: hidden\n  background: #222\n  span\n    display: inline-block\n    box-sizing: border-box\n    width: 60px\n    height: 30px\n    margin: 2px\n    border-radius: 4px\n    background: #829cf1\n</style>\n`,
  // un bac loin sous la fenêtre
  'loin.mjs':      `<div class="haut"></div>\n<div class="bac" *physics(on: load)>${etiquettes(6)}</div>\n<style>\n.haut\n  height: 2400px${SCENE}</style>\n`
}
// pendu décalé de 0,75 px : le bord d'un fil droit tombe sur une limite de pixel
SOURCES['pendu-frac.mjs'] = SOURCES['pendu.mjs'].replace('.cord\n  width: 420px', '.cord\n  margin-left: 0.75px\n  width: 420px')
// pendu sans fil (strength: 0)
SOURCES['sans-fil.mjs'] = SOURCES['pendu.mjs'].replace('*physics(hang, length: 90, color: #ff0000)', '*physics(hang, length: 90, strength: 0)')
// le même bac avec douze étiquettes (six peuvent se ranger d'elles-mêmes au bout de quelques secondes, selon la mise en page : douze
// ne se calment jamais), qui ne part qu'au premier clic : le test tient l'horloge de la page avant de cliquer
const plein = (reglages: string) => SOURCES['serre.mjs'].replace(etiquettes(6), etiquettes(12)).replace('*physics', `*physics(on: click${reglages})`)
SOURCES['plein-court.mjs'] = plein(', sleep: 2s')
SOURCES['plein-libre.mjs'] = plein(', sleep: 0')
SOURCES['plein-clic.mjs']  = plein('')

// un pendu de trois corps de 60 × 30 px (une marge de 110 px au-dessus, un cadre, un contour, une ombre, des coins arrondis) mis en forme par une règle de l'auteur qui
// vise leur balise (`span`, `i`) ou toutes les balises du bac (`*`) : elle atteint aussi le calque et les fils, s'ils ne s'en défendent pas. Le témoin donne les mêmes
// styles aux mêmes corps par une classe, hors d'atteinte du calque et des fils : les deux doivent se peindre pareil
const STYLE_CORPS = '    display: inline-block\n    width: 60px\n    height: 30px\n    margin: 110px 14px 0\n    padding: 3px\n    border: 2px solid #6a4a1a\n    border-radius: 15px\n    box-shadow: 0 6px 12px rgba(0, 0, 0, 0.45)\n    outline: 2px dashed #c00\n    background: #f5ba66\n'
const corpsDuPendu = (balise: string, classe = '') => ['A', 'B', 'C'].map((t) => `<${balise}${classe}>${t}</${balise}>`).join('')
const pendu = (balise: string, regle: string, classe = '', plus = '') => `<div class="bac" *physics(hang, on: load)>${corpsDuPendu(balise, classe)}</div>\n<style>\n.bac\n  width: 300px\n  height: 260px\n  margin: 20px\n  ${regle}\n${STYLE_CORPS}${plus}</style>\n`
// (une règle par balise ajoute l'opacité et un flou : ce que la feuille de l'effet ne fixe pas, seule la balise du calque et des fils en protège)
const PLUS_BALISE = '    opacity: 0.4\n    filter: blur(1px)\n'
for (const [nom, balise, regle, plus] of [['span', 'span', 'span', PLUS_BALISE], ['i', 'i', 'i', PLUS_BALISE], ['etoile', 'b', '*', '']]) {
  SOURCES[`pendu-${nom}.mjs`]  = pendu(balise, regle, '', plus)
  SOURCES[`temoin-${nom}.mjs`] = pendu(balise, '.corps', ' class="corps"', plus)
}
// une règle par identifiant (plus précise que la feuille de l'effet) sur tout ce qui n'est pas un corps (les corps ont leur classe) : elle ne touche que le calque et les fils, et leur donne
// tout ce qu'une feuille d'auteur peut donner (position, décalages, transformations, taille mini, rognage…) ; une autre anime tout ce que le bac contient
// (les fils suivraient leur corps avec retard)
const PLUS_FORT = '    position: relative\n    top: 12px\n    left: 9px\n    right: 4px\n    translate: 7px 9px\n    rotate: 4deg\n    scale: 1.1\n    transform: scale(2)\n    transform-origin: 100% 100%\n    min-width: 40px\n    min-height: 40px\n    overflow: hidden\n'
SOURCES['pendu-fort.mjs']       = `<div class="bac" id="bac" *physics(hang, on: load)>${corpsDuPendu('b', ' class="corps"')}</div>\n<style>\n.bac\n  width: 300px\n  height: 260px\n  margin: 20px\n  .corps\n${STYLE_CORPS}#bac :not(.corps)\n${(STYLE_CORPS + PLUS_FORT).replace(/^ {2}/gm, '')}</style>\n`
SOURCES['pendu-transition.mjs'] = pendu('b', '*', '', '    transition: transform 5s linear\n')
// un pendu au bord gauche du bac, qu'on peut tirer vers la gauche (le bac est décalé de 200 px : la souris a de la place)
SOURCES['pendu-bord.mjs'] = '<div class="bord" *physics(hang, length: 90)><b>A</b><b>B</b></div>\n<style>\n.bord\n  margin-left: 200px\n  width: 420px\n  height: 300px\n  padding-top: 120px\n  box-sizing: border-box\n  display: flex\n  justify-content: flex-start\n  gap: 14px\n  b\n    display: block\n    width: 80px\n    height: 80px\n    border-radius: 10px\n    background: #f5ba66\n</style>\n'
// un corps lâché dans un bac étroit, sans rebond ; en rangée, pour qu'un corps de plus arrive à côté du premier
SOURCES['rebond.mjs'] = '<div class="bac" *physics(on: click, bounce: 0)><span>A</span></div>\n<style>\n.bac\n  width: 120px\n  height: 400px\n  overflow: hidden\n  background: #222\n  display: flex\n  align-items: flex-start\n  span\n    display: block\n    width: 40px\n    height: 40px\n    border-radius: 8px\n    background: #829cf1\n</style>\n'

// ce que la page compte : les images d'animation en attente (`__raf`) et demandées (`__rafAppels`)
const COMPTEURS = () => {
  const w = window as any
  w.__raf = new Set()
  w.__rafAppels = 0
  const ra = w.requestAnimationFrame.bind(w)
  const ca = w.cancelAnimationFrame.bind(w)
  w.requestAnimationFrame = (f: any) => { w.__rafAppels++; const h = ra((t: number) => { w.__raf.delete(h); return f(t) }); w.__raf.add(h); return h }
  w.cancelAnimationFrame = (h: number) => { w.__raf.delete(h); return ca(h) }
}

// ce que la page compte en plus : les lectures de boîte (`__lectures`) — getBoundingClientRect, getComputedStyle,
// tailles (offset et client) ; zéro attendu au repos
const LECTURES = () => {
  const w = window as any
  w.__lectures = { gbcr: 0, gcs: 0, taille: 0 }
  const gb = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function (this: any) { w.__lectures.gbcr++; return gb.call(this) }
  const gs = w.getComputedStyle.bind(w)
  w.getComputedStyle = (...a: any[]) => { w.__lectures.gcs++; return gs(...a) }
  const lis: Array<[any, string]> = [[HTMLElement.prototype, 'offsetWidth'], [HTMLElement.prototype, 'offsetHeight'], [Element.prototype, 'clientWidth'], [Element.prototype, 'clientHeight']]
  for (const [proto, p] of lis) {
    const d = Object.getOwnPropertyDescriptor(proto, p)
    if (d && d.get) Object.defineProperty(proto, p, { get: function (this: any) { w.__lectures.taille++; return (d.get as any).call(this) }, configurable: true })
  }
}

// ce que la page garde d'ouvert : écouteurs (`__ouverts`), observateurs (`__observes`), minuteries (`__minuteries`, avec
// le texte de leur fonction) ; un effet retiré doit tout rendre
const TEMOINS = () => {
  const w = window as any
  w.__ouverts = []
  w.__observes = []
  w.__minuteries = new Map()
  const capte    = (o: any) => typeof o === 'boolean' ? o : !!(o && o.capture)
  const ajoute   = EventTarget.prototype.addEventListener
  const retire   = EventTarget.prototype.removeEventListener
  EventTarget.prototype.addEventListener = function (this: any, type: string, f: any, o?: any) {
    if (f && !w.__ouverts.some((e: any) => e.cible === this && e.type === type && e.f === f && e.capture === capte(o))) w.__ouverts.push({ cible: this, type: type, f: f, capture: capte(o) })
    return ajoute.call(this, type, f, o)
  }
  EventTarget.prototype.removeEventListener = function (this: any, type: string, f: any, o?: any) {
    w.__ouverts = w.__ouverts.filter((e: any) => !(e.cible === this && e.type === type && e.f === f && e.capture === capte(o)))
    return retire.call(this, type, f, o)
  }
  for (const nom of ['MutationObserver', 'ResizeObserver', 'IntersectionObserver']) {
    const P          = w[nom].prototype
    const observe    = P.observe
    const disconnect = P.disconnect
    const unobserve  = P.unobserve
    P.observe    = function (this: any, cible: any, o?: any) { w.__observes.push({ nom: nom, obs: this, cible: cible }); return observe.call(this, cible, o) }
    P.disconnect = function (this: any) { w.__observes = w.__observes.filter((e: any) => e.obs !== this); return disconnect.call(this) }
    if (unobserve) P.unobserve = function (this: any, cible: any) { w.__observes = w.__observes.filter((e: any) => !(e.obs === this && e.cible === cible)); return unobserve.call(this, cible) }
  }
  const poser  = w.setTimeout.bind(w)
  const annule = w.clearTimeout.bind(w)
  w.setTimeout = (f: any, ms?: number, ...a: any[]) => {
    const id = poser(() => { w.__minuteries.delete(id); return typeof f === 'function' ? f(...a) : undefined }, ms)
    w.__minuteries.set(id, String(f))
    return id
  }
  w.clearTimeout = (id: any) => { w.__minuteries.delete(id); return annule(id) }
}

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms))

// attend qu'une condition soit vraie (sondée toutes les 25 ms, au plus `delai`) : le rythme d'un navigateur ne se suppose pas. WebKit remet les pas
// de la souris d'un coup et donne la première image d'animation après un repos bien plus tard que Chromium : un délai fixe y lâche le corps trop tôt
const jusqua = async (condition: () => Promise<boolean>, message: string, delai = 15000) => {
  const fin = Date.now() + delai
  while (!(await condition())) {
    assert.ok(Date.now() < fin, message)
    await attendre(25)
  }
}

// les erreurs que la fenêtre reçoit (dont « ResizeObserver loop completed with undelivered notifications. » : Playwright ne la remonte qu'avec WebKit)
const ERREURS = () => {
  const w = window as any
  w.__erreurs = []
  w.addEventListener('error', (e: any) => w.__erreurs.push(String(e.message)))
}

// les boîtes du conteneur et de ses enfants, leurs styles de mouvement, les marques posées
const ETAT = ([tag, sel]: [string, string]) => {
  const c  = (document.querySelector(tag) as any)._shadow.querySelector(sel)
  const cr = c.getBoundingClientRect()
  const kids = Array.from(c.children).filter((k: any) => !k.hasAttribute('mjs-fx-layer')).map((k: any) => {
    const r = k.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, l: r.left, t: r.top, r: r.right, b: r.bottom, translate: k.style.translate, rotate: k.style.rotate, will: getComputedStyle(k).willChange, touch: getComputedStyle(k).touchAction, marque: k.hasAttribute('mjs-fx-physics-body') }
  })
  return { box: { l: cr.left, t: cr.top, r: cr.right, b: cr.bottom }, kids: kids, run: c.hasAttribute('mjs-fx-physics-run'), held: c.hasAttribute('mjs-fx-physics-held'), drag: c.hasAttribute('mjs-fx-physics-drag'), position: getComputedStyle(c).position, style: c.getAttribute('style') }
}

const decale = (k: any) => parseFloat(String(k.translate || '0 0').split(' ')[1]) || 0

// dont chaque bout d'un fil dépasse du segment accroche - point d'attache (l'aire d'un bout arrondi d'un trait de 1,5 px)
const BOUT = 1.5 * Math.PI / 8

describe('*physics (navigateurs réels) — chute, saisie, ressort, fil, retrait, mouvement réduit', function () {
  this.timeout(240000)
  let script = ''

  before(async function () {
    if (!(await navigateurPresent('chromium')) && !(await navigateurPresent('firefox')) && !(await navigateurPresent('webkit'))) return
    const root   = mjsTmp('effets-physics')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    // le cœur d'abord, puis les animations, puis les composants
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
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
        const playwright = await import('playwright')
        browser = await playwright[nom].launch()
      })

      after(async () => { if (browser) await browser.close() })

      // la page d'un composant, à une vraie adresse ; `fn` s'y exécute, la page est refermée ensuite
      async function avec<T>(tag: string, fn: (page: any) => Promise<T>, calme = false, outils: Array<() => void> = [], horloge = false): Promise<T> {
        const page = await browser.newPage({ viewport: { width: 1000, height: 800 } })
        try {
          if (calme) await page.emulateMedia({ reducedMotion: 'reduce' })
          // l'horloge de la page simulée (avant les compteurs, qui enveloppent ses images d'animation) : `page.clock.runFor` fait passer le temps
          if (horloge) await page.clock.install()
          await page.addInitScript(COMPTEURS)
          for (const outil of outils) await page.addInitScript(outil)
          await page.route('http://t.test/**', (route: any) => {
            if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
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

      const etat = (page: any, tag: string, sel: string): Promise<any> => page.evaluate(ETAT, [tag, sel])

      // attend que le mouvement soit fini : la marque de boucle retirée alors que les enfants ont bougé
      const auRepos = (page: any, tag: string, sel: string, bougé = true, delai = 30000) => page.waitForFunction(([t, s, b]: [string, string, boolean]) => {
        const c = (document.querySelector(t) as any)._shadow.querySelector(s)
        const kids = Array.from(c.children).filter((k: any) => !k.hasAttribute('mjs-fx-layer')) as any[]
        return !c.hasAttribute('mjs-fx-physics-run') && (!b || kids.some((k) => k.style.translate !== ''))
      }, [tag, sel, bougé], { timeout: delai })

      // la mise en page de l'effet est faite : chaque enfant porte la marque de corps (avec leurs fils pour hang). Elle se refait à l'image qui suit le premier
      // rappel de l'observateur de taille, que le navigateur donne plus ou moins tôt (WebKit : bien après Chromium) : ce qu'on lit à la pose l'attend
      const corpsPoses = (page: any, tag: string, sel: string) => page.waitForFunction(([t, s]: [string, string]) => {
        const kids = Array.from((document.querySelector(t) as any)._shadow.querySelector(s).children).filter((k: any) => !k.hasAttribute('mjs-fx-layer')) as any[]
        return kids.length > 0 && kids.every((k) => k.hasAttribute('mjs-fx-physics-body'))
      }, [tag, sel])

      // le centre d'un enfant, la souris dessus
      const centre = async (page: any, tag: string, sel: string, n: number) => {
        const e = await etat(page, tag, sel)
        return { x: e.kids[n].x, y: e.kids[n].y }
      }

      it('fall : les enfants tombent au fond du conteneur et y restent, la boucle s\'arrête (zéro image demandée au repos), will-change seulement pendant le mouvement', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-fall', async (page) => {
          await page.waitForFunction(() => { const c = (document.querySelector('mjs-fall') as any)._shadow.querySelector('.bac'); return c.hasAttribute('mjs-fx-physics-run') })
          const en_route = await etat(page, 'mjs-fall', '.bac')
          assert.ok(/translate/.test(en_route.kids[0].will), `will-change pendant le mouvement : « ${en_route.kids[0].will} »`)
          await auRepos(page, 'mjs-fall', '.bac')
          const e = await etat(page, 'mjs-fall', '.bac')
          assert.ok(e.kids.filter((k: any) => decale(k) > 20).length >= 5, 'la plupart des enfants sont tombés')
          assert.ok(Math.max(...e.kids.map((k: any) => k.b)) > e.box.b - 6, 'une étiquette repose sur le sol')
          // la boîte d'un enfant penché garde ses coins droits : à quatre pixels près (le coin d'un rayon de 8 px dépasse de 3,3 px)
          for (const k of e.kids) assert.ok(k.l > e.box.l - 4 && k.r < e.box.r + 4 && k.b < e.box.b + 4 && k.t > e.box.t - 4, `un enfant sort du conteneur : ${JSON.stringify([k.l, k.t, k.r, k.b])}`)
          assert.equal(e.kids[0].will, 'auto', 'will-change retiré au repos')
          await page.evaluate(() => { (window as any).__rafAppels = 0 })
          await attendre(1500)
          const r = await page.evaluate(() => ({ attente: (window as any).__raf.size, appels: (window as any).__rafAppels }))
          assert.deepEqual(r, { attente: 0, appels: 0 }, 'une image d\'animation tourne au repos')
        })
      })

      it('la mise en page ne se refait pas dans le rappel du ResizeObserver : aucune erreur « ResizeObserver loop » à la pose (fall, float, hang), et les corps sont posés', async function () {
        if (!present) { this.skip(); return }
        for (const [tag, sel] of [['mjs-fall', '.bac'], ['mjs-flottant', '.cap'], ['mjs-pendu', '.cord']]) {
          await avec(tag, async (page) => {
            await corpsPoses(page, tag, sel)
            // deux images de plus : le navigateur signale l'erreur à l'image où le rappel a écrit, pas avant
            await page.evaluate(() => new Promise((fin) => requestAnimationFrame(() => requestAnimationFrame(() => fin(0)))))
            assert.deepEqual(await page.evaluate(() => (window as any).__erreurs), [], `${tag} : la page a signalé des erreurs`)
          }, false, [ERREURS])
        }
      })

      it('un clic sans déplacement atteint le lien ; un glissé de plus de 5 px déplace le corps sans activer le lien', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-fall', async (page) => {
          await auRepos(page, 'mjs-fall', '.bac')
          const lien = await centre(page, 'mjs-fall', '.bac', 6)
          await page.mouse.click(lien.x, lien.y)
          assert.equal(await page.evaluate(() => location.hash), '#lien', 'le clic simple doit suivre le lien')
          await page.evaluate(() => history.replaceState(null, '', location.pathname))
          const a = await centre(page, 'mjs-fall', '.bac', 6)
          await page.mouse.move(a.x, a.y)
          await page.mouse.down()
          await page.mouse.move(a.x + 3, a.y, { steps: 2 })
          await page.mouse.up()
          assert.equal(await page.evaluate(() => location.hash), '#lien', 'moins de 5 px : encore un clic')
          await page.evaluate(() => history.replaceState(null, '', location.pathname))
          await auRepos(page, 'mjs-fall', '.bac')
          const b = await centre(page, 'mjs-fall', '.bac', 6)
          await page.mouse.move(b.x, b.y)
          await page.mouse.down()
          await page.mouse.move(b.x + 120, b.y - 100, { steps: 10 })
          // le corps saisi rejoint le pointeur avant le lâcher : sans cela, la souris serait relâchée avant que la boucle ait avancé d'un pas (WebKit remet les dix pas d'un coup)
          await jusqua(async () => {
            const e = await etat(page, 'mjs-fall', '.bac')
            return e.held && Math.hypot(e.kids[6].x - (b.x + 120), e.kids[6].y - (b.y - 100)) < 40
          }, 'le lien saisi ne rejoint pas le pointeur')
          await page.mouse.up()
          await attendre(60)
          assert.equal(await page.evaluate(() => location.hash), '', 'après un glissé, le lien n\'est pas activé')
          const c = await centre(page, 'mjs-fall', '.bac', 6)
          assert.ok(Math.hypot(c.x - b.x, c.y - b.y) > 20, 'le corps glissé a bougé')
        })
      })

      it('saisir : le corps suit le pointeur, touch-action: none et la marque de saisie seulement pendant le geste, la boucle repart puis s\'arrête', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-fall', async (page) => {
          await auRepos(page, 'mjs-fall', '.bac')
          const avant = await etat(page, 'mjs-fall', '.bac')
          assert.equal(avant.kids[2].touch, 'auto')
          const p = { x: avant.kids[2].x, y: avant.kids[2].y }
          await page.mouse.move(p.x, p.y)
          await page.mouse.down()
          await page.mouse.move(p.x + 90, p.y - 120, { steps: 12 })
          await attendre(400)
          const tenu = await etat(page, 'mjs-fall', '.bac')
          assert.equal(tenu.held, true, 'marque de saisie')
          assert.equal(tenu.run, true, 'la boucle tourne pendant la saisie')
          assert.equal(tenu.kids[2].touch, 'none', 'touch-action: none sur le corps saisi')
          assert.ok(Math.hypot(tenu.kids[2].x - (p.x + 90), tenu.kids[2].y - (p.y - 120)) < 30, `le corps suit le pointeur (${Math.round(tenu.kids[2].x)}, ${Math.round(tenu.kids[2].y)})`)
          assert.equal(tenu.kids[0].touch, 'auto', 'les autres corps gardent le défilement tactile')
          await page.mouse.up()
          await auRepos(page, 'mjs-fall', '.bac')
          const fin = await etat(page, 'mjs-fall', '.bac')
          assert.equal(fin.held, false)
          assert.equal(fin.kids[2].touch, 'auto')
          assert.ok(fin.kids[2].y > tenu.kids[2].y + 20, 'lâché, le corps retombe')
        })
      })

      it('saisir par un descendant : la souris touche le <b> d\'un corps, c\'est ce corps qui se saisit ; le fond du conteneur ne saisit rien', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-imbrique', async (page) => {
          await auRepos(page, 'mjs-imbrique', '.bac')
          const avant = await etat(page, 'mjs-imbrique', '.bac')
          const sous = (x: number, y: number) => page.evaluate(([px, py]: number[]) => ((document.querySelector('mjs-imbrique') as any)._shadow.elementFromPoint(px, py) as any).localName, [x, y])
          const p = { x: avant.kids[1].x, y: avant.kids[1].y }
          assert.equal(await sous(p.x, p.y), 'b', 'le pointeur est sur le descendant du corps, pas sur le corps')
          await page.mouse.move(p.x, p.y)
          await page.mouse.down()
          await page.mouse.move(p.x + 60, p.y - 90, { steps: 10 })
          await attendre(300)
          const tenu = await etat(page, 'mjs-imbrique', '.bac')
          assert.equal(tenu.held, true, 'marque de saisie')
          assert.equal(tenu.kids[1].touch, 'none', 'le corps qui porte le <b> touché est celui qui est saisi')
          assert.equal(tenu.kids[0].touch, 'auto', 'les autres corps ne sont pas saisis')
          assert.equal(tenu.kids[2].touch, 'auto', 'les autres corps ne sont pas saisis')
          await page.mouse.up()
          await auRepos(page, 'mjs-imbrique', '.bac')
          // le fond du conteneur, en haut à gauche (les corps sont tombés au sol) : la remontée sort du conteneur, aucun corps n'est saisi
          const repos = await etat(page, 'mjs-imbrique', '.bac')
          const f = { x: repos.box.l + 10, y: repos.box.t + 10 }
          assert.equal(await sous(f.x, f.y), 'div', 'le pointeur est sur le conteneur lui-même')
          await page.mouse.move(f.x, f.y)
          await page.mouse.down()
          await page.mouse.move(f.x + 40, f.y + 30, { steps: 6 })
          await attendre(300)
          const fond = await etat(page, 'mjs-imbrique', '.bac')
          assert.equal(fond.held, false, 'rien n\'est saisi')
          assert.ok(fond.kids.every((k: any) => k.touch === 'auto'), 'aucun corps ne prend le geste')
          await page.mouse.up()
        })
      })

      it('float : rien ne tourne avant un geste ; la souris bouscule les capsules, elles reviennent à leur place et la boucle s\'arrête', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-flottant', async (page) => {
          await corpsPoses(page, 'mjs-flottant', '.cap')
          await page.evaluate(() => { (window as any).__rafAppels = 0 })
          await attendre(700)
          const calme = await page.evaluate(() => ({ attente: (window as any).__raf.size, appels: (window as any).__rafAppels }))
          assert.deepEqual(calme, { attente: 0, appels: 0 }, 'float tourne sans qu\'on y touche')
          const e0 = await etat(page, 'mjs-flottant', '.cap')
          assert.ok(e0.kids.every((k: any) => k.translate === ''), 'les capsules sont à leur place de mise en page')
          const un = e0.kids[0]
          await page.mouse.move(un.x - 200, un.y)
          for (let i = 1; i <= 12; i++) await page.mouse.move(un.x - 200 + i * 33, un.y + 4, { steps: 2 })
          await attendre(150)
          const poussees = await etat(page, 'mjs-flottant', '.cap')
          const ecart = Math.max(...poussees.kids.map((k: any, i: number) => Math.hypot(k.x - e0.kids[i].x, k.y - e0.kids[i].y)))
          assert.ok(ecart > 12, `la souris doit bousculer une capsule (${ecart.toFixed(1)} px)`)
          await page.mouse.move(990, 790)
          await auRepos(page, 'mjs-flottant', '.cap')
          const fin = await etat(page, 'mjs-flottant', '.cap')
          for (let i = 0; i < fin.kids.length; i++) assert.ok(Math.hypot(fin.kids[i].x - e0.kids[i].x, fin.kids[i].y - e0.kids[i].y) < 1.5, `la capsule ${i} est revenue à sa place`)
        })
      })

      it('hang : un seul calque de fils (une balise sans taille, sans souris, derrière les corps), un fil par corps, déplacé quand le corps bouge ; les enfants gardent leur rang', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-pendu', async (page) => {
          await corpsPoses(page, 'mjs-pendu', '.cord')
          // un fil est une balise d'1 px de côté, couchée par une matrice : sa ligne médiane va de (0,5 ; 0) à (0,5 ; 1) dans la balise ;
          // le trait dépasse de BOUT à chaque bout du segment accroche - point d'attache, qu'on retrouve ici
          const lignes = () => page.evaluate((bout: number) => {
            const c = (document.querySelector('mjs-pendu') as any)._shadow.querySelector('.cord')
            const calque = c.querySelector('[mjs-fx-layer="physics"]')
            const fils = Array.from(calque.children) as any[]
            return {
              n: c.querySelectorAll('[mjs-fx-layer="physics"]').length, tag: calque.localName, pe: getComputedStyle(calque).pointerEvents, z: getComputedStyle(calque).zIndex,
              dernier: c.lastElementChild === calque, premier: c.firstElementChild.localName,
              fils: fils.map((f: any) => {
                const m  = new DOMMatrix(getComputedStyle(f).transform)
                const d  = m.transformPoint({ x: 0.5, y: 0 })
                const h  = m.transformPoint({ x: 0.5, y: 1 })
                const lg = Math.hypot(h.x - d.x, h.y - d.y)
                const ux = (h.x - d.x) / lg
                const uy = (h.y - d.y) / lg
                return { tag: f.localName, x1: d.x + bout * ux, y1: d.y + bout * uy, x2: h.x - bout * ux, y2: h.y - bout * uy, epaisseur: Math.hypot(m.a, m.b), couleur: getComputedStyle(f).backgroundColor, svg: f.closest('svg') !== null }
              })
            }
          }, BOUT)
          const l0 = await lignes()
          assert.equal(l0.n, 1, 'un seul calque')
          assert.equal(l0.tag, 'mjsfxlayer', 'le calque est une balise à lui (ni un <svg>, ni un <span> qu\'une règle de l\'auteur atteint par son type)')
          assert.equal(l0.pe, 'none')
          assert.equal(l0.z, '-1', 'derrière les corps')
          assert.equal(l0.dernier, true)
          assert.equal(l0.premier, 'b', 'le calque ne prend pas le rang du premier enfant')
          assert.equal(l0.fils.length, 3)
          for (const f of l0.fils) {
            assert.equal(f.tag, 'mjsfxcord', 'le fil est une balise à lui (pas un <i>)')
            assert.equal(f.svg, false)
            assert.equal(f.couleur, 'rgb(255, 0, 0)', 'la couleur des fils (color)')
            assert.ok(Math.abs(f.epaisseur - 1.5) < 0.01, `l'épaisseur du trait : ${f.epaisseur}`)
          }
          // au repos : le fil va de son point d'accroche (90 px au-dessus du corps) au haut du corps
          const e0 = await etat(page, 'mjs-pendu', '.cord')
          for (let i = 0; i < 3; i++) {
            assert.ok(Math.abs(l0.fils[i].x2 - (e0.kids[i].x - e0.box.l)) < 1.5, `le fil ${i} descend au milieu de son corps`)
            assert.ok(Math.abs(l0.fils[i].y2 - (e0.kids[i].t - e0.box.t)) < 1.5, `le fil ${i} s'arrête au haut de son corps`)
            assert.ok(Math.abs((l0.fils[i].y2 - l0.fils[i].y1) - 90) < 1.5, `le fil ${i} mesure 90 px`)
            assert.ok(Math.abs(l0.fils[i].x1 - l0.fils[i].x2) < 1.5, `le fil ${i} est droit`)
          }
          // la raideur, la longueur et la pesanteur d'un pendu repartent de la mise en page (les fils en dépendent) ; le rebond se suit
          const suivis = await page.evaluate(() => { const o = (document.querySelector('mjs-pendu') as any)._shadow.querySelector('.cord')._mjs_fxOff.physics; return [o._hot('length', 60), o._hot('strength', 0.5), o._hot('gravity', 2), o._hot('bounce', 0.2)] })
          assert.deepEqual(suivis, [false, false, false, undefined])
          // on tire le corps du milieu : son fil suit, de l'accroche (qui ne bouge pas) au haut du corps
          const m = e0.kids[1]
          await page.mouse.move(m.x, m.y)
          await page.mouse.down()
          await page.mouse.move(m.x + 80, m.y - 20, { steps: 8 })
          await attendre(300)
          const l1 = await lignes()
          assert.ok(Math.abs(l1.fils[1].x2 - l0.fils[1].x2) > 20, 'le fil suit le corps tiré')
          assert.ok(Math.abs(l1.fils[1].x1 - l0.fils[1].x1) < 0.01 && Math.abs(l1.fils[1].y1 - l0.fils[1].y1) < 0.01, 'l\'accroche ne bouge pas')
          const e1 = await etat(page, 'mjs-pendu', '.cord')
          // le fil finit au milieu du haut du corps, à la moitié de sa hauteur (40 px) du centre, quel que soit l'angle du corps
          assert.ok(Math.abs(Math.hypot(l1.fils[1].x2 - (e1.kids[1].x - e1.box.l), l1.fils[1].y2 - (e1.kids[1].y - e1.box.t)) - 40) < 1.5, 'le fil tiré finit au haut de son corps')
          await page.mouse.up()
        })
      })

      // ----- hang : le dessin des fils ne coûte ni mise en page ni peinture par image -----

      // tire un corps en continu (la souris tourne autour de (x, y)) jusqu'à ce que la page ait demandé `images` images d'animation :
      // on compte des images, pas des millisecondes (la machine peut être lente)
      const tourne = async (page: any, x: number, y: number, images: number) => {
        const depart = await page.evaluate(() => (window as any).__rafAppels)
        for (let i = 0; i < 4000; i++) {
          if ((await page.evaluate(() => (window as any).__rafAppels)) - depart >= images) return
          await page.mouse.move(x + 70 * Math.cos(i / 5), y + 40 * Math.sin(i / 5))
          await attendre(8)
        }
        throw new Error(`moins de ${images} images d'animation demandées`)
      }

      // saisit le corps du milieu du pendu et le tire un peu : la simulation tourne, le corps est tenu
      const saisitLeMilieu = async (page: any) => {
        await corpsPoses(page, 'mjs-pendu', '.cord')
        const m = (await etat(page, 'mjs-pendu', '.cord')).kids[1]
        await page.mouse.move(m.x, m.y)
        await page.mouse.down()
        await page.mouse.move(m.x + 60, m.y - 30, { steps: 6 })
        return { x: m.x + 60, y: m.y - 30 }
      }

      it('hang : pendant la simulation, le dessin des fils n\'écrit que le style (transform) des fils et des corps : aucun <svg>, aucun attribut réécrit', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-pendu', async (page) => {
          const p = await saisitLeMilieu(page)
          await tourne(page, p.x, p.y, 10)
          // tout ce qui s'écrit dans le conteneur pendant au moins 40 images
          await page.evaluate(() => {
            const w = window as any
            const c = (document.querySelector('mjs-pendu') as any)._shadow.querySelector('.cord')
            w.__ecrit = []
            w.__obs = new MutationObserver((l: any[]) => { for (const r of l) w.__ecrit.push([r.target.localName, r.type === 'attributes' ? r.attributeName : r.type]) })
            w.__obs.observe(c, { attributes: true, subtree: true, childList: true })
          })
          await tourne(page, p.x, p.y, 40)
          await attendre(50)
          const r = await page.evaluate(() => {
            const w = window as any
            const c = (document.querySelector('mjs-pendu') as any)._shadow.querySelector('.cord')
            w.__obs.disconnect()
            const fils = Array.from(c.querySelectorAll('[mjs-fx-layer] > *')) as any[]
            return { svg: c.querySelectorAll('svg').length, ecrit: w.__ecrit as string[][], fils: fils.length, styles: fils.map((f: any) => Array.from(f.style).join()) }
          })
          assert.equal(r.svg, 0, 'un <svg> dessine encore les fils')
          assert.ok(r.ecrit.length >= 40, `la simulation n\'a rien écrit (${r.ecrit.length} écritures)`)
          const autres = r.ecrit.filter(([, quoi]) => quoi !== 'style')
          assert.deepEqual(autres, [], 'des attributs (hors style) sont réécrits pendant la simulation')
          assert.equal(r.fils, 3, 'un élément par fil')
          assert.deepEqual(r.styles, ['transform', 'transform', 'transform'], 'un fil n\'est déplacé que par transform')
          await page.mouse.up()
        })
      })

      it('hang : aucune mise en page par image pendant la simulation (Chromium, compteur de mises en page)', async function () {
        if (!present || nom !== 'chromium') { this.skip(); return }
        await avec('mjs-pendu', async (page) => {
          const cdp = await page.context().newCDPSession(page)
          await cdp.send('Performance.enable')
          const mises = async () => ((await cdp.send('Performance.getMetrics')).metrics.find((x: any) => x.name === 'LayoutCount') || {}).value
          const p = await saisitLeMilieu(page)
          await tourne(page, p.x, p.y, 10)
          const avant = await mises()
          await tourne(page, p.x, p.y, 40)
          const apres = await mises()
          assert.ok(apres - avant <= 4, `${apres - avant} mises en page pendant 40 images d'animation (attendu : aucune)`)
          await page.mouse.up()
        })
      })

      // l'encre d'un fil droit : la couverture du trait (en px, 1,5 attendu) lue sur une capture, par ligne ; un trait calé sur des pixels
      // entiers en donnerait 1 ou 2. L'écart du canal vert au fond (le premier pixel de la capture) : le fil du test est rouge sur fond blanc,
      // et noir ou blanc selon la palette en contraste forcé
      const encre = async (page: any, x: number) => {
        const png = await page.screenshot({ clip: { x: x - 6, y: 50, width: 12, height: 40 } })
        return page.evaluate(async (b64: string) => {
          const img = new Image()
          img.src = 'data:image/png;base64,' + b64
          await img.decode()
          const c = document.createElement('canvas')
          c.width  = img.width
          c.height = img.height
          const g = c.getContext('2d') as CanvasRenderingContext2D
          g.drawImage(img, 0, 0)
          const d = g.getImageData(0, 0, c.width, c.height).data
          let somme = 0
          for (let i = 0; i < d.length; i += 4) somme += Math.abs(d[i + 1] - d[1]) / 255
          return somme / c.height
        }, png.toString('base64'))
      }

      it('hang : un fil droit garde son épaisseur de 1,5 px, au repos comme en mouvement (il n\'est jamais calé sur des pixels entiers, 1 ou 2 px)', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-pendu-frac', async (page) => {
          await corpsPoses(page, 'mjs-pendu-frac', '.cord')
          const e0 = await etat(page, 'mjs-pendu-frac', '.cord')
          const repos = await encre(page, e0.kids[0].x)
          assert.ok(Math.abs(repos - 1.5) < 0.2, `épaisseur du fil au repos : ${repos.toFixed(2)} px`)
          // on tire le corps du milieu : la simulation tourne, les fils sont des calques ; le premier fil reste droit
          const m = e0.kids[1]
          await page.mouse.move(m.x, m.y)
          await page.mouse.down()
          await page.mouse.move(m.x + 60, m.y - 30, { steps: 6 })
          await attendre(200)
          assert.equal((await etat(page, 'mjs-pendu-frac', '.cord')).run, true, 'la simulation ne tourne pas')
          const tenu = await encre(page, e0.kids[0].x)
          assert.ok(Math.abs(tenu - 1.5) < 0.2, `épaisseur du fil pendant le mouvement : ${tenu.toFixed(2)} px`)
          await page.mouse.up()
        })
      })

      // le gain de la passe « carte graphique » : un fil est un calque composé (will-change: transform) pendant la simulation, et seulement pendant
      // elle. Sans cela chaque image retrame les fils dans le document (mesuré : 38 tuiles contre 1 104 pour 150 images sur les lettres pendues) ;
      // gardé en permanence, un calque de plus par fil reste en mémoire au repos
      it('hang : les fils sont des calques composés (will-change: transform) pendant la simulation, et seulement pendant elle', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-pendu', async (page) => {
          const will = () => page.evaluate(() => Array.from((document.querySelector('mjs-pendu') as any)._shadow.querySelectorAll('.cord [mjs-fx-layer] > *')).map((f: any) => getComputedStyle(f).willChange))
          await corpsPoses(page, 'mjs-pendu', '.cord')
          assert.deepEqual(await will(), ['auto', 'auto', 'auto'], 'des fils sont déjà des calques au repos, avant tout geste')
          const p = await saisitLeMilieu(page)
          await tourne(page, p.x, p.y, 10)
          assert.deepEqual(await will(), ['transform', 'transform', 'transform'], 'les fils ne sont pas des calques pendant la simulation : chaque image les retrame')
          await page.mouse.up()
          await auRepos(page, 'mjs-pendu', '.cord')
          assert.deepEqual(await will(), ['auto', 'auto', 'auto'], 'des fils restent des calques une fois la simulation finie')
        })
      })

      it('contraste forcé (forced-colors: active) : les fils de hang restent visibles, au repos comme en mouvement (un arrière-plan y est remplacé par la couleur du fond)', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-pendu', async (page) => {
          await corpsPoses(page, 'mjs-pendu', '.cord')
          const e0 = await etat(page, 'mjs-pendu', '.cord')
          const normal = await encre(page, e0.kids[0].x)
          assert.ok(Math.abs(normal - 1.5) < 0.2, `épaisseur du fil hors contraste forcé : ${normal.toFixed(2)} px`)
          await page.emulateMedia({ forcedColors: 'active' })
          assert.equal(await page.evaluate(() => matchMedia('(forced-colors: active)').matches), true, 'le contraste forcé n\'est pas émulé')
          const repos = await encre(page, e0.kids[0].x)
          assert.ok(Math.abs(repos - 1.5) < 0.2, `fil au repos en contraste forcé : ${repos.toFixed(2)} px d'encre par ligne (0 : le fil a disparu)`)
          // on tire le corps du milieu : la simulation tourne, les fils sont des calques
          const m = e0.kids[1]
          await page.mouse.move(m.x, m.y)
          await page.mouse.down()
          await page.mouse.move(m.x + 60, m.y - 30, { steps: 6 })
          await attendre(200)
          assert.equal((await etat(page, 'mjs-pendu', '.cord')).run, true, 'la simulation ne tourne pas')
          const tenu = await encre(page, e0.kids[0].x)
          assert.ok(Math.abs(tenu - 1.5) < 0.2, `fil en mouvement en contraste forcé : ${tenu.toFixed(2)} px d'encre par ligne (0 : le fil a disparu)`)
          await page.mouse.up()
        })
      })

      // ----- le calque et les fils ne se laissent pas atteindre par la CSS de l'auteur -----

      // où sont le calque et les fils par rapport à la boîte de remplissage du bac (l'origine des corps) : le calque, les deux bouts de chaque fil (sans le
      // dépassement de BOUT) lus dans sa matrice, l'écart entre sa boîte vue par le navigateur et sa matrice (nul si la mise en page ne le déplace pas), et le
      // centre et le haut de chaque corps
      const attaches = (page: any, tag: string) => page.evaluate(([t, bout]: [string, number]) => {
        const c  = (document.querySelector(t) as any)._shadow.querySelector('.bac')
        const cb = c.getBoundingClientRect()
        const ox = cb.left + c.clientLeft
        const oy = cb.top + c.clientTop
        const calque = c.querySelector('[mjs-fx-layer="physics"]')
        const lb = calque.getBoundingClientRect()
        const corps = (Array.from(c.children) as any[]).filter((k) => !k.hasAttribute('mjs-fx-layer')).map((k) => {
          const r = k.getBoundingClientRect()
          return { cx: r.left + r.width / 2 - ox, cy: r.top + r.height / 2 - oy, haut: r.top - oy }
        })
        const fils = (Array.from(calque.children) as any[]).map((f) => {
          const m  = new DOMMatrix(getComputedStyle(f).transform)
          const d  = m.transformPoint({ x: 0.5, y: 0 })
          const h  = m.transformPoint({ x: 0.5, y: 1 })
          const lg = Math.hypot(h.x - d.x, h.y - d.y)
          const ux = (h.x - d.x) / lg
          const uy = (h.y - d.y) / lg
          const x1 = d.x + bout * ux
          const y1 = d.y + bout * uy
          const x2 = h.x - bout * ux
          const y2 = h.y - bout * uy
          const r  = f.getBoundingClientRect()
          return { x1: x1, y1: y1, x2: x2, y2: y2, desaccord: Math.hypot(r.left + r.width / 2 - ox - (x1 + x2) / 2, r.top + r.height / 2 - oy - (y1 + y2) / 2) }
        })
        return { calque: { x: lb.left - ox, y: lb.top - oy, w: lb.width, h: lb.height }, corps: corps, fils: fils }
      }, [tag, BOUT])

      // le nombre de pixels qui diffèrent entre deux captures (PNG), lu dans la page
      const pixelsDifferents = (page: any, a: Buffer, b: Buffer) => page.evaluate(async ([pa, pb]: string[]) => {
        const lit = async (b64: string) => {
          const img = new Image()
          img.src = 'data:image/png;base64,' + b64
          await img.decode()
          const c = document.createElement('canvas')
          c.width  = img.width
          c.height = img.height
          const g = c.getContext('2d') as CanvasRenderingContext2D
          g.drawImage(img, 0, 0)
          return g.getImageData(0, 0, c.width, c.height)
        }
        const x = await lit(pa)
        const y = await lit(pb)
        if (x.width !== y.width || x.height !== y.height) return -1
        let n = 0
        for (let i = 0; i < x.data.length; i += 4) if (x.data[i] !== y.data[i] || x.data[i + 1] !== y.data[i + 1] || x.data[i + 2] !== y.data[i + 2]) n++
        return n
      }, [a.toString('base64'), b.toString('base64')])

      for (const [regle, scene, temoin] of [
        ['.bac span', 'mjs-pendu-span', 'mjs-temoin-span'],
        ['.bac i', 'mjs-pendu-i', 'mjs-temoin-i'],
        ['.bac *', 'mjs-pendu-etoile', 'mjs-temoin-etoile'],
        ['#bac :not(.corps) (plus précise que la feuille de l\'effet, hors des corps)', 'mjs-pendu-fort', 'mjs-temoin-etoile'],
        ['.bac * { transition: transform 5s }', 'mjs-pendu-transition', 'mjs-temoin-etoile']
      ]) {
        it(`hang : une règle de l'auteur sur « ${regle} » (marge, cadre, contour, ombre, coins) n'atteint ni le calque ni les fils : ils restent accrochés aux corps et se peignent, au pixel, comme avec une règle sur une classe`, async function () {
          if (!present) { this.skip(); return }
          const cadre = { x: 0, y: 0, width: 360, height: 320 }
          const fils  = (t: string) => (document.querySelector(t) as any)._shadow.querySelector('[mjs-fx-layer="physics"] > *')
          let vue: Buffer | null = null
          await avec(scene, async (page) => {
            await page.waitForFunction(fils, scene)
            const r = await attaches(page, scene)
            assert.ok(Math.abs(r.calque.x) < 0.01 && Math.abs(r.calque.y) < 0.01, `le calque est décalé de (${r.calque.x.toFixed(1)}, ${r.calque.y.toFixed(1)}) px par rapport au bac`)
            assert.deepEqual([r.calque.w, r.calque.h], [0, 0], 'le calque a pris une taille')
            assert.equal(r.fils.length, 3, 'un fil par corps')
            for (let i = 0; i < 3; i++) {
              const f = r.fils[i]
              const k = r.corps[i]
              assert.ok(f.desaccord < 0.5, `le fil ${i} n'est pas où sa matrice le met : ${f.desaccord.toFixed(1)} px d'écart`)
              assert.ok(Math.abs(f.x2 - k.cx) < 1.5 && Math.abs(f.y2 - k.haut) < 1.5, `le fil ${i} ne finit pas au haut de son corps : (${f.x2.toFixed(1)}, ${f.y2.toFixed(1)}) contre (${k.cx.toFixed(1)}, ${k.haut.toFixed(1)})`)
              assert.ok(Math.abs(f.x1 - k.cx) < 1.5 && Math.abs(f.y2 - f.y1 - 100) < 1.5, `le fil ${i} n'est pas droit, de 100 px de long`)
            }
            vue = await page.screenshot({ clip: cadre })
            // on tire le corps du milieu : les fils suivent, à 20 px (la moitié de la hauteur d'un corps, cadre compris) du centre de leur corps
            const m = (await etat(page, scene, '.bac')).kids[1]
            await page.mouse.move(m.x, m.y)
            await page.mouse.down()
            await page.mouse.move(m.x + 60, m.y - 30, { steps: 6 })
            // le corps tiré a suivi le pointeur : la condition, pas un délai (WebKit remet les pas d'un coup et donne la première image bien plus tard)
            await jusqua(async () => Math.abs((await attaches(page, scene)).fils[1].x2 - r.fils[1].x2) > 20, 'le corps tiré ne rejoint pas le pointeur')
            const t = await attaches(page, scene)
            for (let i = 0; i < 3; i++) {
              assert.ok(t.fils[i].desaccord < 0.5, `en mouvement, le fil ${i} n'est pas où sa matrice le met : ${t.fils[i].desaccord.toFixed(1)} px d'écart`)
              assert.ok(Math.abs(Math.hypot(t.fils[i].x2 - t.corps[i].cx, t.fils[i].y2 - t.corps[i].cy) - 20) < 1.5, `en mouvement, le fil ${i} ne tient plus à son corps`)
              assert.ok(Math.abs(t.fils[i].x1 - r.fils[i].x1) < 0.01 && Math.abs(t.fils[i].y1 - r.fils[i].y1) < 0.01, `l'accroche du fil ${i} a bougé`)
            }
            assert.ok(Math.abs(t.fils[1].x2 - r.fils[1].x2) > 20, 'le fil du corps tiré le suit')
            await page.mouse.up()
          })
          await avec(temoin, async (page) => {
            await page.waitForFunction(fils, temoin)
            const ecart = await pixelsDifferents(page, vue as Buffer, await page.screenshot({ clip: cadre }))
            assert.equal(ecart, 0, `${ecart} pixels diffèrent du même bac dont la règle vise les corps par une classe (-1 : captures de tailles différentes)`)
          })
        })
      }

      it('retrait ({if} refermé) : plus de translate, rotate, touch-action, marque, calque ni position posée sur les enfants et le conteneur', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-retrait', async (page) => {
          await auRepos(page, 'mjs-retrait', '.bac')
          const p = await centre(page, 'mjs-retrait', '.bac', 1)
          await page.mouse.move(p.x, p.y)
          await page.mouse.down()
          await page.mouse.move(p.x + 40, p.y - 40, { steps: 5 })
          const reste = await page.evaluate(() => {
            const c = (document.querySelector('mjs-retrait') as any)._shadow.querySelector('.bac')
            ;(window as any).__c = c
            ;(window as any).__kids = Array.from(c.children)
            return c.getAttribute('mjs-fx')
          })
          assert.equal(reste, 'physics')
          // le retrait en pleine saisie
          await page.evaluate(() => (document.querySelector('mjs-retrait') as any)._shadow.querySelector('.t').click())
          await page.waitForFunction(() => !(document.querySelector('mjs-retrait') as any)._shadow.querySelector('.bac'))
          const apres = await page.evaluate(() => {
            const c = (window as any).__c
            const w = window as any
            return {
              attrs: c.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx')),
              style: c.getAttribute('style'),
              enfants: w.__kids.map((k: any) => ({ translate: k.style.translate, rotate: k.style.rotate, touch: k.style.touchAction, attrs: k.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx')), display: k.style.display })),
              calque: c.querySelectorAll('[mjs-fx-layer]').length
            }
          })
          assert.deepEqual(apres.attrs, [])
          assert.ok(!apres.style || !/position/.test(apres.style), `position restée : ${apres.style}`)
          assert.equal(apres.calque, 0)
          for (const k of apres.enfants) assert.deepEqual(k, { translate: '', rotate: '', touch: '', attrs: [], display: '' })
          await page.mouse.up()
        })
      })

      it('on: click : rien ne bouge avant le premier clic, la chute part au clic', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-clic', async (page) => {
          await attendre(600)
          const avant = await etat(page, 'mjs-clic', '.bac')
          assert.ok(avant.kids.every((k: any) => k.translate === ''), 'les enfants bougent avant le clic')
          assert.equal(avant.run, false)
          // un clic dans le conteneur, à côté des étiquettes
          await page.mouse.click(avant.box.r - 20, avant.box.b - 20)
          await page.waitForFunction(() => (document.querySelector('mjs-clic') as any)._shadow.querySelector('.bac').hasAttribute('mjs-fx-physics-run'))
          await auRepos(page, 'mjs-clic', '.bac')
          const apres = await etat(page, 'mjs-clic', '.bac')
          assert.ok(apres.kids.filter((k: any) => decale(k) > 20).length >= 4, 'les enfants sont tombés après le clic')
        })
      })

      it('un conteneur sans hauteur : un seul avertissement, qui dit quoi faire', async function () {
        if (!present) { this.skip(); return }
        const page = await browser.newPage({ viewport: { width: 1000, height: 800 } })
        const dits: string[] = []
        page.on('console', (m: any) => { if (m.type() === 'warning') dits.push(m.text()) })
        try {
          await page.route('http://t.test/**', (route: any) => {
            if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
            return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><mjs-vide></mjs-vide><script>${script}</script></body></html>` })
          })
          await page.goto('http://t.test/', { waitUntil: 'load' })
          await attendre(1500)
          const hauteur = dits.filter((m) => /\*physics/.test(m) && /hauteur/.test(m))
          assert.equal(hauteur.length, 1, `avertissements : ${JSON.stringify(dits)}`)
          assert.match(hauteur[0], /Donnez-lui une hauteur/)
        }
        finally {
          await page.close()
        }
      })

      it('« réduire les animations » : rien ne bouge, les enfants restent à leur place de mise en page', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-fall', async (page) => {
          await attendre(1200)
          const e = await etat(page, 'mjs-fall', '.bac')
          assert.ok(e.kids.every((k: any) => k.translate === '' && k.rotate === ''), 'des enfants ont bougé')
          assert.equal(e.run, false)
          // le cœur peut demander une image au démarrage ; ensuite plus aucune : l'effet ne tourne pas
          const r1 = await page.evaluate(() => (window as any).__rafAppels)
          await attendre(600)
          const r2 = await page.evaluate(() => ({ appels: (window as any).__rafAppels, attente: (window as any).__raf.size }))
          assert.deepEqual(r2, { appels: r1, attente: 0 }, 'une image d\'animation continue de tourner')
        }, true)
      })

      it('le conteneur change de taille : la simulation repart de la mise en page, vers le nouveau sol', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-fall', async (page) => {
          await auRepos(page, 'mjs-fall', '.bac')
          await page.evaluate(() => { (document.querySelector('mjs-fall') as any)._shadow.querySelector('.bac').style.height = '520px' })
          await page.waitForFunction(() => { const c = (document.querySelector('mjs-fall') as any)._shadow.querySelector('.bac'); return c.hasAttribute('mjs-fx-physics-run') })
          await auRepos(page, 'mjs-fall', '.bac')
          const e = await etat(page, 'mjs-fall', '.bac')
          assert.ok(Math.abs(e.box.b - e.box.t - 520) < 1)
          assert.ok(Math.max(...e.kids.map((k: any) => k.b)) > e.box.b - 6, 'les étiquettes reposent sur le nouveau sol')
          assert.ok(Math.max(...e.kids.map((k: any) => k.b)) <= e.box.b + 4, 'une étiquette dépasse le nouveau sol')
        })
      })

      it('off.set : la pesanteur, le rebond, le frottement, les bords, la portée et la saisie se suivent sans reposer l\'effet ; mode, spin et on repartent', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-fall', async (page) => {
          await auRepos(page, 'mjs-fall', '.bac')
          const rendu = await page.evaluate(() => {
            const c = (document.querySelector('mjs-fall') as any)._shadow.querySelector('.bac')
            const o = c._mjs_fxOff.physics
            return { mode: o._hot('mode', 'float'), spin: o._hot('spin', false), on: o._hot('on', 'load'), inconnu: o._hot('color', '#f00'), gravite: o._hot('gravity', -1), rebond: o._hot('bounce', 0.9), frottement: o._hot('friction', 0.1), bords: o._hot('walls', 'all'), portee: o._hot('push', 50), force: o._hot('strength', 0.5), longueur: o._hot('length', 50) }
          })
          assert.equal(rendu.mode, false)
          assert.equal(rendu.spin, false)
          assert.equal(rendu.on, false)
          for (const k of ['gravite', 'rebond', 'frottement', 'bords', 'portee', 'force', 'longueur']) assert.equal((rendu as any)[k], undefined, `${k} se suit sans repartir`)
          // la pesanteur négative fait monter la pile contre le plafond
          await page.waitForFunction(() => { const c = (document.querySelector('mjs-fall') as any)._shadow.querySelector('.bac'); return c.hasAttribute('mjs-fx-physics-run') })
          await auRepos(page, 'mjs-fall', '.bac')
          const haut = await etat(page, 'mjs-fall', '.bac')
          assert.ok(Math.min(...haut.kids.map((k: any) => k.t)) < haut.box.t + 4, 'la pile est montée au plafond')
          // la saisie retirée : on ne saisit plus
          await page.evaluate(() => { (document.querySelector('mjs-fall') as any)._shadow.querySelector('.bac')._mjs_fxOff.physics._hot('drag', false) })
          const sans = await etat(page, 'mjs-fall', '.bac')
          assert.equal(sans.drag, false, 'la marque de saisie est retirée')
          const p = { x: sans.kids[2].x, y: sans.kids[2].y }
          await page.mouse.move(p.x, p.y)
          await page.mouse.down()
          await page.mouse.move(p.x + 60, p.y + 60, { steps: 6 })
          await attendre(200)
          const apres = await etat(page, 'mjs-fall', '.bac')
          assert.equal(apres.held, false, 'rien n\'est saisi')
          assert.equal(apres.run, false)
          await page.mouse.up()
        })
      })

      it('au-delà de 60 corps, les corps de trop restent fixes : leur mise en page ne bouge pas', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-beaucoup', async (page) => {
          await auRepos(page, 'mjs-beaucoup', '.bac')
          const e = await etat(page, 'mjs-beaucoup', '.bac')
          assert.equal(e.kids.length, 70)
          assert.ok(e.kids.slice(0, 60).some((k: any) => k.translate !== ''), 'les 60 premiers tombent')
          assert.ok(e.kids.slice(60).every((k: any) => k.translate === ''), 'les 10 derniers restent fixes')
        })
      })

      // ----- la boucle ne tourne jamais pour rien -----

      // les lectures de boîte de la page pendant deux secondes, une fois la pose faite
      const lectures = async (page: any) => {
        await attendre(1200)
        await page.evaluate(() => { (window as any).__lectures = { gbcr: 0, gcs: 0, taille: 0 } })
        await attendre(2000)
        return page.evaluate(() => (window as any).__lectures)
      }

      // les images d'animation demandées et en attente pendant deux secondes
      const images = async (page: any) => {
        await page.evaluate(() => { (window as any).__rafAppels = 0 })
        await attendre(2000)
        return page.evaluate(() => ({ attente: (window as any).__raf.size, appels: (window as any).__rafAppels }))
      }

      it('zéro enfant : aucune image d\'animation demandée, pas de marque de boucle (la boucle ne tourne pas à vide)', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-zero', async (page) => {
          await attendre(800)
          assert.deepEqual(await images(page), { attente: 0, appels: 0 }, 'une image d\'animation tourne alors qu\'il n\'y a aucun enfant')
          assert.equal((await etat(page, 'mjs-zero', '.z')).run, false, 'la marque de boucle est posée sans enfant')
        })
      })

      it('une liste vidée : la boucle s\'arrête avec le dernier enfant et repart quand un enfant arrive', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-liste', async (page) => {
          const bouton = (nom: string) => page.evaluate((n: string) => (document.querySelector('mjs-liste') as any)._shadow.querySelector(n).click(), nom)
          await auRepos(page, 'mjs-liste', '.bac')
          await bouton('.vider')
          await page.waitForFunction(() => (document.querySelector('mjs-liste') as any)._shadow.querySelector('.bac').children.length === 0)
          await attendre(600)
          assert.deepEqual(await images(page), { attente: 0, appels: 0 }, 'une image d\'animation tourne alors que la liste est vide')
          assert.equal((await etat(page, 'mjs-liste', '.bac')).run, false)
          // un enfant arrive : la chute repart
          await bouton('.plus')
          await page.waitForFunction(() => (document.querySelector('mjs-liste') as any)._shadow.querySelector('.bac').hasAttribute('mjs-fx-physics-run'))
          await auRepos(page, 'mjs-liste', '.bac')
          const e = await etat(page, 'mjs-liste', '.bac')
          assert.equal(e.kids.length, 1)
          assert.ok(decale(e.kids[0]) > 20, 'le nouvel enfant est tombé')
        })
      })

      it('enfants tournés ou agrandis (rotate, scale, transform) : la mise en page n\'est pas relue en boucle, chaque corps tombe droit sur le sol et dort', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-penche', async (page) => {
          assert.deepEqual(await lectures(page), { gbcr: 0, gcs: 0, taille: 0 }, 'la mise en page est relue au repos')
          await auRepos(page, 'mjs-penche', '.large')
          // la forme d'un corps est sa boîte de mise en page : posé sur le sol, son bas touche le sol, quoi qu'il porte
          const bas = await page.evaluate(() => {
            const c = (document.querySelector('mjs-penche') as any)._shadow.querySelector('.large')
            return Array.from(c.children).map((k: any) => k.offsetTop + k.offsetHeight + (parseFloat(String(k.style.translate || '0 0').split(' ')[1]) || 0) - c.clientHeight)
          })
          assert.equal(bas.length, 4)
          for (let i = 0; i < bas.length; i++) assert.ok(bas[i] > -2.5 && bas[i] < 2, `l'enfant ${i} repose à ${bas[i].toFixed(1)} px de la limite du sol`)
        }, false, [LECTURES])
      })

      it('conteneur sous un ancêtre réduit (transform: scale) : la mise en page n\'est pas relue en boucle, les corps tombent et dorment', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-ancetre', async (page) => {
          assert.deepEqual(await lectures(page), { gbcr: 0, gcs: 0, taille: 0 }, 'la mise en page est relue au repos')
          await auRepos(page, 'mjs-ancetre', '.bac')
          assert.deepEqual(await images(page), { attente: 0, appels: 0 }, 'une image d\'animation tourne au repos')
        }, false, [LECTURES])
      })

      it('conteneur trop petit pour ses enfants : le monde se fige au bout de la borne (30 s sans geste), puis plus aucune image', async function () {
        if (!present) { this.skip(); return }
        // l'horloge de la page est simulée : les 30 s de la borne passent en un instant
        await avec('mjs-serre', async (page) => {
          await page.waitForFunction(() => (document.querySelector('mjs-serre') as any)._shadow.querySelector('.bac').hasAttribute('mjs-fx-physics-run'))
          await page.clock.runFor(25000)
          assert.equal((await etat(page, 'mjs-serre', '.bac')).run, true, 'ils se sont calmés avant la borne : le bac n\'est pas trop petit pour ce test')
          await page.clock.runFor(10000)
          const e = await etat(page, 'mjs-serre', '.bac')
          assert.equal(e.run, false, 'le monde ne s\'est pas figé 35 s après le départ')
          assert.equal(e.kids.length, 6)
          await page.evaluate(() => { (window as any).__rafAppels = 0 })
          await page.clock.runFor(2000)
          const r = await page.evaluate(() => ({ attente: (window as any).__raf.size, appels: (window as any).__rafAppels }))
          assert.deepEqual(r, { attente: 0, appels: 0 }, 'une image d\'animation tourne alors que le monde est figé')
        }, false, [], true)
      })

      // ----- sleep : le délai de la borne est un réglage -----

      // l'horloge de la page est TENUE par le test : après `tenir`, rien ne passe que par `page.clock.runFor`, et le monde (parti au
      // premier clic) a l'âge que l'horloge lui donne, quelle que soit la vitesse de la machine
      const tenir = async (page: any, tag: string) => {
        await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 60000)
        const e = await etat(page, tag, '.bac')
        await page.mouse.click(e.box.l + 40, e.box.t + 40)
        assert.equal((await etat(page, tag, '.bac')).run, true, 'le premier clic n\'a pas fait partir le monde')
      }
      const enMarche = async (page: any, tag: string) => (await etat(page, tag, '.bac')).run
      // un réglage rendu par la variable, comme le fait le moteur d'effets : `undefined` = suivi sans repartir, `false` = l'effet repart
      const regle = (page: any, tag: string, k: string, v: any) => page.evaluate(([t, cle, val]: [string, string, any]) => (document.querySelector(t) as any)._shadow.querySelector('.bac')._mjs_fxOff.physics._hot(cle, val), [tag, k, v])
      const imagesDemandees = (page: any) => page.evaluate(() => ({ attente: (window as any).__raf.size, appels: (window as any).__rafAppels }))

      it('sleep: 2s : le bac trop petit se fige 2 s après son départ, sans geste, pas avant ; plus aucune image n\'est demandée', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-plein-court', async (page) => {
          await tenir(page, 'mjs-plein-court')
          // l'horloge est bien tenue : 2,5 s réelles (plus que le délai) ne font pas vieillir le monde
          await attendre(2500)
          assert.equal(await enMarche(page, 'mjs-plein-court'), true, 'l\'horloge de la page n\'est pas tenue : le monde a vieilli pendant l\'attente')
          await page.clock.runFor(1000)
          assert.equal(await enMarche(page, 'mjs-plein-court'), true, 'le monde s\'est figé avant son délai de 2 s')
          await page.clock.runFor(2500)
          const e = await etat(page, 'mjs-plein-court', '.bac')
          assert.equal(e.run, false, 'le monde ne s\'est pas figé 3,5 s après son départ, avec sleep: 2s')
          assert.equal(e.kids.length, 12)
          await page.evaluate(() => { (window as any).__rafAppels = 0 })
          await page.clock.runFor(2000)
          assert.deepEqual(await imagesDemandees(page), { attente: 0, appels: 0 }, 'une image d\'animation tourne alors que le monde est figé')
        }, false, [], true)
      })

      it('sleep: 0 : le bac trop petit ne se fige jamais (encore en mouvement après les 30 s du défaut), une image reste demandée', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-plein-libre', async (page) => {
          await tenir(page, 'mjs-plein-libre')
          await page.clock.runFor(40000)
          assert.equal(await enMarche(page, 'mjs-plein-libre'), true, 'le monde s\'est figé 40 s après son départ, avec sleep: 0')
          assert.equal((await imagesDemandees(page)).attente, 1, 'la boucle ne tourne plus')
        }, false, [], true)
      })

      it('off.set : sleep se suit sans repartir ; un délai plus court posé en route compte depuis ce moment, 0 lève la borne, une variable effacée rend les 30 s', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-plein-clic', async (page) => {
          await tenir(page, 'mjs-plein-clic')
          await page.clock.runFor(1000)
          assert.equal(await regle(page, 'mjs-plein-clic', 'sleep', '4s'), undefined, 'sleep repart de la mise en page au lieu de se suivre')
          await page.clock.runFor(2500)
          assert.equal(await enMarche(page, 'mjs-plein-clic'), true, 'le délai posé en route est compté depuis le départ, pas depuis le changement')
          await page.clock.runFor(2500)
          assert.equal(await enMarche(page, 'mjs-plein-clic'), false, 'le délai de 4 s posé en route n\'est pas suivi : 5 s après le changement, le monde tourne encore')
          // le réglage qui change est un geste : le monde repart ; 0 lève la borne
          assert.equal(await regle(page, 'mjs-plein-clic', 'sleep', '0'), undefined)
          assert.equal(await enMarche(page, 'mjs-plein-clic'), true, 'le changement de réglage n\'a pas réveillé le monde')
          await page.clock.runFor(35000)
          assert.equal(await enMarche(page, 'mjs-plein-clic'), true, 'le monde s\'est figé 35 s après sleep: 0 posé en route')
          // la variable effacée : retour au délai par défaut, compté depuis ce moment
          assert.equal(await regle(page, 'mjs-plein-clic', 'sleep', undefined), undefined)
          await page.clock.runFor(25000)
          assert.equal(await enMarche(page, 'mjs-plein-clic'), true, 'la variable effacée n\'a pas rendu les 30 s : figé après 25 s')
          await page.clock.runFor(10000)
          assert.equal(await enMarche(page, 'mjs-plein-clic'), false, 'la variable effacée n\'a pas rendu les 30 s : encore en mouvement après 35 s')
        }, false, [], true)
      })

      // ----- un réglage posé en route survit à la remise en page (un enfant qui arrive relit la mise en page et refait le monde) -----

      const ajoute = (page: any, tag: string, sel: string, balise: string) => page.evaluate(([t, s, b]: string[]) => { (document.querySelector(t) as any)._shadow.querySelector(s).appendChild(document.createElement(b)) }, [tag, sel, balise])

      it('off.set : sleep posé en route survit à une remise en page (un enfant arrive : le bac se fige 4 s plus tard, pas au délai de la pose)', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-plein-clic', async (page) => {
          await tenir(page, 'mjs-plein-clic')
          await page.clock.runFor(500)
          assert.ok((await etat(page, 'mjs-plein-clic', '.bac')).kids.some((k: any) => k.translate !== ''), 'les corps n\'ont pas bougé : la simulation ne tourne pas')
          assert.equal(await regle(page, 'mjs-plein-clic', 'sleep', '4s'), undefined)
          await ajoute(page, 'mjs-plein-clic', '.bac', 'span')
          await page.waitForFunction(() => Array.from((document.querySelector('mjs-plein-clic') as any)._shadow.querySelector('.bac').children).every((k: any) => k.style.translate === ''))
          await page.clock.runFor(2500)
          assert.equal(await enMarche(page, 'mjs-plein-clic'), true, 'le monde refait s\'est figé avant les 4 s')
          await page.clock.runFor(2500)
          assert.equal(await enMarche(page, 'mjs-plein-clic'), false, 'le délai de 4 s posé en route est perdu à la remise en page : 5 s après, le monde tourne encore')
        }, false, [], true)
      })

      it('off.set : la pesanteur posée en route survit à une remise en page (la pile reste au plafond)', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-fall', async (page) => {
          await auRepos(page, 'mjs-fall', '.bac')
          assert.equal(await regle(page, 'mjs-fall', 'gravity', -1), undefined)
          await page.waitForFunction(() => (document.querySelector('mjs-fall') as any)._shadow.querySelector('.bac').hasAttribute('mjs-fx-physics-run'))
          await auRepos(page, 'mjs-fall', '.bac')
          const haut = await etat(page, 'mjs-fall', '.bac')
          assert.ok(Math.min(...haut.kids.map((k: any) => k.t)) < haut.box.t + 4, 'la pile n\'est pas montée au plafond')
          // un enfant arrive : la simulation repart de la mise en page, avec la pesanteur posée en route
          await ajoute(page, 'mjs-fall', '.bac', 'span')
          await page.waitForFunction(() => (document.querySelector('mjs-fall') as any)._shadow.querySelector('.bac').hasAttribute('mjs-fx-physics-run'))
          await auRepos(page, 'mjs-fall', '.bac')
          const apres = await etat(page, 'mjs-fall', '.bac')
          assert.ok(Math.min(...apres.kids.map((k: any) => k.t)) < apres.box.t + 4, 'la pesanteur posée en route est perdue à la remise en page : la pile est retombée')
          assert.ok(Math.max(...apres.kids.map((k: any) => k.b)) < apres.box.b - 100, 'des corps sont tombés au fond malgré la pesanteur posée en route')
        })
      })

      it('off.set : la portée de la souris (push) posée en route survit à une remise en page (float)', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-flottant', async (page) => {
          assert.equal(await page.evaluate(() => (document.querySelector('mjs-flottant') as any)._shadow.querySelector('.cap')._mjs_fxOff.physics._hot('push', 0)), undefined)
          await ajoute(page, 'mjs-flottant', '.cap', 'div')
          const e0 = await etat(page, 'mjs-flottant', '.cap')
          const un = e0.kids[0]
          await page.mouse.move(un.x - 200, un.y)
          for (let i = 1; i <= 12; i++) await page.mouse.move(un.x - 200 + i * 33, un.y + 4, { steps: 2 })
          await attendre(150)
          const apres = await etat(page, 'mjs-flottant', '.cap')
          assert.ok(apres.kids.every((k: any) => k.translate === ''), 'la portée posée en route est perdue à la remise en page : la souris bouscule les capsules')
        })
      })

      // chaque enfant a repris sa marque : la remise en page d'un enfant arrivé est faite (le calque des fils, lui, n'a pas de marque)
      const remisEnPage = (page: any, tag: string, sel: string) => page.waitForFunction(([t, s]: [string, string]) => Array.from((document.querySelector(t) as any)._shadow.querySelector(s).children).every((k: any) => k.hasAttribute('mjs-fx-layer') || k.hasAttribute('mjs-fx-physics-body')), [tag, sel])

      it('off.set : la raideur (strength) posée en route survit à une remise en page (float : sans ressort, la capsule bousculée ne revient pas à sa place)', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-flottant', async (page) => {
          assert.equal(await page.evaluate(() => (document.querySelector('mjs-flottant') as any)._shadow.querySelector('.cap')._mjs_fxOff.physics._hot('strength', 0)), undefined)
          await ajoute(page, 'mjs-flottant', '.cap', 'div')
          await remisEnPage(page, 'mjs-flottant', '.cap')
          const e0 = await etat(page, 'mjs-flottant', '.cap')
          const un = e0.kids[0]
          await page.mouse.move(un.x - 200, un.y)
          for (let i = 1; i <= 12; i++) await page.mouse.move(un.x - 200 + i * 33, un.y + 4, { steps: 2 })
          await attendre(150)
          await page.mouse.move(990, 790)
          await auRepos(page, 'mjs-flottant', '.cap')
          const fin = await etat(page, 'mjs-flottant', '.cap')
          const ecart = Math.max(...fin.kids.map((k: any, i: number) => Math.hypot(k.x - e0.kids[i].x, k.y - e0.kids[i].y)))
          assert.ok(ecart > 5, `la raideur posée en route est perdue à la remise en page : le ressort a ramené la capsule bousculée à ${ecart.toFixed(1)} px de sa place`)
        })
      })

      it('off.set : les bords (walls) posés en route survivent à une remise en page (hang : sans bords, le pendu tiré vers la gauche sort du bac)', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-pendu-bord', async (page) => {
          assert.equal(await page.evaluate(() => (document.querySelector('mjs-pendu-bord') as any)._shadow.querySelector('.bord')._mjs_fxOff.physics._hot('walls', 'none')), undefined)
          await ajoute(page, 'mjs-pendu-bord', '.bord', 'b')
          await remisEnPage(page, 'mjs-pendu-bord', '.bord')
          const a = (await etat(page, 'mjs-pendu-bord', '.bord')).kids[0]
          await page.mouse.move(a.x, a.y)
          await page.mouse.down()
          await page.mouse.move(a.x - 140, a.y + 30, { steps: 12 })
          await attendre(500)
          const tenu = await etat(page, 'mjs-pendu-bord', '.bord')
          assert.ok(tenu.kids[0].x < tenu.box.l, `les bords posés en route sont perdus à la remise en page : le pendu tiré reste dans le bac (centre à ${(tenu.kids[0].x - tenu.box.l).toFixed(0)} px du bord gauche)`)
          await page.mouse.up()
        })
      })

      it('off.set : le rebond (bounce) posé en route survit à une remise en page (fall : le corps lâché rebondit encore, il ne se pose pas)', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-rebond', async (page) => {
          await tenir(page, 'mjs-rebond')
          assert.equal(await regle(page, 'mjs-rebond', 'bounce', 0.9), undefined)
          await ajoute(page, 'mjs-rebond', '.bac', 'span')
          await remisEnPage(page, 'mjs-rebond', '.bac')
          // le corps repart du haut du bac (360 px de chute, 0,85 s) ; sans rebond il est posé après une seconde, avec 0,9 il remonte de près de 300 px
          await page.clock.runFor(1200)
          let haut = 0
          for (let i = 0; i < 20; i++) {
            await page.clock.runFor(100)
            const e = await etat(page, 'mjs-rebond', '.bac')
            haut = Math.max(haut, e.box.b - e.kids[0].b)
          }
          assert.ok(haut > 60, `le rebond posé en route est perdu à la remise en page : le corps ne remonte jamais de plus de ${haut.toFixed(1)} px`)
        }, false, [], true)
      })

      // ----- les réglages et les gardes que les tests laissaient passer -----

      it('hang avec strength: 0 : pas de fil, les corps tombent comme en fall', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-sans-fil', async (page) => {
          await auRepos(page, 'mjs-sans-fil', '.cord')
          const lignes = await page.evaluate(() => (document.querySelector('mjs-sans-fil') as any)._shadow.querySelectorAll('.cord [mjs-fx-layer] > *').length)
          assert.equal(lignes, 0, 'des fils sont tendus avec strength: 0')
          const e = await etat(page, 'mjs-sans-fil', '.cord')
          assert.ok(e.kids.every((k: any) => decale(k) > 20), 'les corps sans fil sont tombés')
        })
      })

      it('hors écran : rien ne bouge tant que le conteneur est loin de la fenêtre ; la boucle s\'arrête quand il repart, reprend à son retour', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-loin', async (page) => {
          const marque     = () => (document.querySelector('mjs-loin') as any)._shadow.querySelector('.bac').hasAttribute('mjs-fx-physics-run')
          const sansMarque = () => !(document.querySelector('mjs-loin') as any)._shadow.querySelector('.bac').hasAttribute('mjs-fx-physics-run')
          await attendre(1000)
          const loin = await etat(page, 'mjs-loin', '.bac')
          assert.ok(loin.kids.every((k: any) => k.translate === ''), 'des enfants ont bougé hors écran')
          assert.equal(loin.run, false)
          assert.deepEqual(await images(page), { attente: 0, appels: 0 }, 'une image d\'animation tourne hors écran')
          // il arrive à l'écran : la chute part
          await page.evaluate(() => window.scrollTo(0, 2300))
          await page.waitForFunction(marque)
          // il repart avant la fin : la boucle s'arrête, les corps restent où ils sont
          await page.evaluate(() => window.scrollTo(0, 0))
          await page.waitForFunction(sansMarque, null, { timeout: 5000 }).catch(() => {})
          const fige = await etat(page, 'mjs-loin', '.bac')
          assert.equal(fige.run, false, 'la boucle tourne alors que le conteneur est reparti')
          await attendre(600)
          const apres = await etat(page, 'mjs-loin', '.bac')
          assert.deepEqual(apres.kids.map((k: any) => k.translate), fige.kids.map((k: any) => k.translate), 'des corps bougent hors écran')
          // de retour, il va au bout : la boucle reprend quand l'observateur d'écran le dit (plus ou moins vite selon le navigateur), puis elle s'arrête
          await page.evaluate(() => window.scrollTo(0, 2300))
          await page.waitForFunction(marque, null, { timeout: 15000 })
          await auRepos(page, 'mjs-loin', '.bac')
          assert.ok((await etat(page, 'mjs-loin', '.bac')).kids.filter((k: any) => decale(k) > 20).length >= 5, 'les enfants sont tombés au retour')
        })
      })

      it('onglet caché : la boucle s\'arrête, les corps restent où ils sont, elle repart quand l\'onglet revient', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-fall', async (page) => {
          await page.waitForFunction(() => (document.querySelector('mjs-fall') as any)._shadow.querySelector('.bac').hasAttribute('mjs-fx-physics-run'))
          const cache = (oui: boolean) => page.evaluate((o: boolean) => {
            if (o) Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
            else delete (document as any).hidden
            document.dispatchEvent(new Event('visibilitychange'))
          }, oui)
          await cache(true)
          await attendre(300)
          const a = await etat(page, 'mjs-fall', '.bac')
          assert.equal(a.run, false, 'la boucle tourne dans un onglet caché')
          await attendre(600)
          const b = await etat(page, 'mjs-fall', '.bac')
          assert.deepEqual(b.kids.map((k: any) => k.translate), a.kids.map((k: any) => k.translate), 'des corps bougent dans un onglet caché')
          await cache(false)
          await auRepos(page, 'mjs-fall', '.bac')
          assert.ok((await etat(page, 'mjs-fall', '.bac')).kids.filter((k: any) => decale(k) > 20).length >= 5, 'les enfants sont tombés au retour de l\'onglet')
        })
      })

      // ----- le retrait rend tout ce que l'effet a ouvert (l'appel du retrait lui-même, sans passer par un bloc {if}) -----

      it('retrait : l\'écouteur visibilitychange posé sur le document est retiré', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-fall', async (page) => {
          const n = await page.evaluate(() => {
            const w = window as any
            const nb = () => w.__ouverts.filter((e: any) => e.cible === document && e.type === 'visibilitychange').length
            const c = (document.querySelector('mjs-fall') as any)._shadow.querySelector('.bac')
            const avant = nb()
            c._mjs_fxOff.physics()
            return { avant: avant, apres: nb() }
          })
          assert.equal(n.avant - n.apres, 1, `écouteurs visibilitychange du document : ${n.avant} avant le retrait, ${n.apres} après`)
        }, false, [TEMOINS])
      })

      it('retrait : les observateurs des enfants, des tailles et de l\'écran sont débranchés', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-fall', async (page) => {
          await corpsPoses(page, 'mjs-fall', '.bac')
          const r = await page.evaluate(() => {
            const w = window as any
            const c = (document.querySelector('mjs-fall') as any)._shadow.querySelector('.bac')
            const nb = (nom: string) => w.__observes.filter((e: any) => e.nom === nom && (e.cible === c || e.cible.parentNode === c)).length
            const avant = { mo: nb('MutationObserver'), ro: nb('ResizeObserver'), io: nb('IntersectionObserver') }
            c._mjs_fxOff.physics()
            return { avant: avant, apres: { mo: nb('MutationObserver'), ro: nb('ResizeObserver'), io: nb('IntersectionObserver') } }
          })
          assert.deepEqual(r.avant, { mo: 1, ro: 8, io: 1 }, 'ce que l\'effet observe')
          assert.deepEqual(r.apres, { mo: 0, ro: 0, io: 0 }, 'des observateurs restent branchés après le retrait')
        }, false, [TEMOINS])
      })

      it('retrait : les écouteurs du conteneur sont retirés', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-fall', async (page) => {
          const r = await page.evaluate(() => {
            const w = window as any
            const c = (document.querySelector('mjs-fall') as any)._shadow.querySelector('.bac')
            const TYPES = ['pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture', 'pointermove', 'dragstart', 'pointerenter', 'pointerleave']
            const nb = () => w.__ouverts.filter((e: any) => e.cible === c && TYPES.includes(e.type)).length
            const avant = nb()
            c._mjs_fxOff.physics()
            return { avant: avant, apres: nb() }
          })
          assert.deepEqual(r, { avant: 8, apres: 0 }, 'écouteurs du conteneur avant et après le retrait')
        }, false, [TEMOINS])
      })

      it('retrait avant la fin du délai de l\'avertissement : la minuterie est annulée', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-clic', async (page) => {
          const r = await page.evaluate(() => {
            const w = window as any
            const c = (document.querySelector('mjs-clic') as any)._shadow.querySelector('.bac')
            const attente = () => Array.from(w.__minuteries.values()).filter((s: any) => /physicsHeight/.test(s)).length
            c.click()
            const avant = attente()
            c._mjs_fxOff.physics()
            return { avant: avant, apres: attente() }
          })
          assert.deepEqual(r, { avant: 1, apres: 0 }, 'minuteries de l\'avertissement avant et après le retrait')
        }, false, [TEMOINS])
      })

      // la remise en page d'un changement de taille se fait à l'image suivante, hors du rappel de l'observateur : si l'effet part entre les deux, l'image en attente doit partir avec lui
      it('retrait entre l\'avis de taille et l\'image de remise en page : l\'image en attente est annulée', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-fall', async (page) => {
          await corpsPoses(page, 'mjs-fall', '.bac')
          await auRepos(page, 'mjs-fall', '.bac')
          const r = await page.evaluate(() => new Promise<any>((fin) => {
            const w = window as any
            const c = (document.querySelector('mjs-fall') as any)._shadow.querySelector('.bac')
            // l'observateur de la page, posé après celui de l'effet : dans la même livraison, il reçoit l'avis juste après lui
            const mien = new ResizeObserver(() => {
              mien.disconnect()
              const attente = w.__raf.size
              c._mjs_fxOff.physics()
              fin({ attente: attente, apres: w.__raf.size })
            })
            mien.observe(c)
            c.style.height = '520px'
          }))
          assert.deepEqual(r, { attente: 1, apres: 0 }, 'images d\'animation en attente : celle de la remise en page avant le retrait, aucune après')
        })
      })
    })
  }
})
