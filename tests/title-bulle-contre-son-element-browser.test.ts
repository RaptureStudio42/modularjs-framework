// `@title` : la bulle s'ouvre contre son élément — centrée 8 px au-dessus, en dessous quand la place manque en haut, au-dessus quand
// `side: 'bottom'` en manque en bas, glissée vers l'intérieur contre un bord, jamais hors de la fenêtre. Elle s'ouvrait loin (environ
// 460 px trop à droite et 250 px trop bas, fenêtre de 1280 × 800) : popover fermé, donc en `display: none`, elle se mesurait avant
// d'être affichée (0 × 0) ; la feuille native de `[popover]` (`inset: 0`, `margin: auto`) la tirait vers le centre de la fenêtre ; et
// une bulle réutilisée se mesurait encore à son ancienne place, où la largeur disponible peut la plier sur plusieurs lignes.
// Survol et focus, composant à ombre (la bulle naît dans son ombre) et composant léger (`mjs-light`, la bulle commune de la page),
// aucune image au mauvais endroit pendant l'apparition. Chromium, Firefox et WebKit réels, en développement et en production

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const MOTEURS = ['chromium', 'firefox', 'webkit'] as const
const BUILDS  = ['dev', 'prod'] as const
type Build    = typeof BUILDS[number]

// l'icône du constat d'origine, telle quelle, et des boutons posés contre les bords de la fenêtre
const SOURCE = `<script>
  $note = 4
</script>

<button class="icone" type="button" @title="4/5 · Plutôt bien">★ {$note}</button>
<button class="haut" type="button" @title="Trop près du haut, en dessous">H</button>
<button class="bas" type="button" @title={ text: 'Trop près du bas, au-dessus', side: 'bottom' }>B</button>
<button class="gauche" type="button" @title="Contre le bord gauche, la bulle glisse vers le centre sans sortir de la fenêtre">G</button>
<button class="droite" type="button" @title="Contre le bord droit, la bulle glisse vers le centre sans sortir de la fenêtre">D</button>
<button class="court" type="button" @title="C">C</button>

<style>
  :host
    display: block
    padding: 300px 0 0 200px

  .icone
    width: 32px
    height: 32px

  .haut, .bas, .gauche, .droite, .court
    position: fixed
    width: 32px
    height: 32px

  .haut
    top: 12px
    left: 600px

  .bas
    bottom: 12px
    left: 600px

  .gauche
    top: 500px
    left: 0

  .droite
    top: 500px
    right: 0

  .court
    top: 650px
    right: 0
</style>
`

const TEXTES: Record<string, string> = {
  '.icone': '4/5 · Plutôt bien',
  '.haut': 'Trop près du haut, en dessous',
  '.bas': 'Trop près du bas, au-dessus',
  '.gauche': 'Contre le bord gauche, la bulle glisse vers le centre sans sortir de la fenêtre',
  '.droite': 'Contre le bord droit, la bulle glisse vers le centre sans sortir de la fenêtre',
  '.court': 'C'
}

// tolérance des arrondis au demi-pixel
const PRES = 1

// dans la page : la racine du composant (son ombre, ou la balise elle-même en léger), la bulle visible, la mesure de l'élément et de
// sa bulle, et le relevé, image par image, de la place de la bulle dès qu'elle est affichée
const OUTILS = `
window.__racine = () => { const h = document.querySelector('mjs-bulle-pres'); return h && h._shadow }
window.__ombre = () => { const h = document.querySelector('mjs-bulle-pres'); return h && h._shadow && h._shadow !== h ? h._shadow : null }
window.__bulles = () => [...(window.__ombre() ? window.__ombre().querySelectorAll('.mjs-title') : []), ...document.querySelectorAll('.mjs-title')]
window.__bulle = () => window.__bulles().find((b) => b.classList.contains('mjs-title-visible')) || null
window.__centre = (sel) => { const r = window.__racine().querySelector(sel).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } }
window.__mesure = (sel) => {
  const b = window.__bulle()
  if (!b) return null
  const e = window.__racine().querySelector(sel).getBoundingClientRect(), q = b.getBoundingClientRect(), o = window.__ombre()
  return {
    el: { l: e.left, t: e.top, r: e.right, b: e.bottom },
    bulle: { l: q.left, t: q.top, r: q.right, b: q.bottom },
    cote: b.getAttribute('data-mjs-title-side'),
    texte: b.textContent,
    lieu: o && b.parentNode === o ? 'ombre' : b.parentNode === document.body ? 'page' : 'ailleurs',
    vw: document.documentElement.clientWidth,
    vh: document.documentElement.clientHeight
  }
}
window.__images = null
window.__filmer = () => {
  window.__images = []
  const pas = () => {
    if (!window.__images) return
    for (const b of window.__bulles()) {
      if (getComputedStyle(b).display === 'none') continue
      const q = b.getBoundingClientRect()
      window.__images.push({ l: q.left, t: q.top, opacite: getComputedStyle(b).opacity })
    }
    requestAnimationFrame(pas)
  }
  requestAnimationFrame(pas)
}
window.__couper = () => { const r = window.__images; window.__images = null; return r }
`

type Fichiers = Map<string, Buffer>
let construit: Promise<Record<Build, Fichiers>> | null = null

// le build de développement et celui de production, chacun servi fichier par fichier sous son préfixe, une fois pour les trois moteurs
function construire(): Promise<Record<Build, Fichiers>> {
  construit ??= (async () => {
    const root   = mjsTmp('title-bulle-contre')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'bulle-pres.mjs'), SOURCE)
    const sortie = {} as Record<Build, Fichiers>
    for (const build of BUILDS) {
      const outDir  = join(root, build)
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/' + build, js: 'split', env: build } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      const fichiers: Fichiers = new Map()
      for (const f of readdirSync(outDir)) if (/\.(js|json)$/.test(f)) fichiers.set(f, readFileSync(join(outDir, f)))
      sortie[build] = fichiers
    }
    return sortie
  })()
  return construit
}

type Mesure = { el: any, bulle: any, cote: string, texte: string, lieu: string, vw: number, vh: number }

const voir = (m: Mesure) => JSON.stringify(m)

function dansLaFenetre(m: Mesure) {
  assert.ok(m.bulle.l >= -PRES && m.bulle.t >= -PRES && m.bulle.r <= m.vw + PRES && m.bulle.b <= m.vh + PRES, `la bulle reste dans la fenêtre : ${voir(m)}`)
}
function auDessus(m: Mesure) {
  assert.equal(m.cote, 'top', `côté haut : ${voir(m)}`)
  assert.ok(Math.abs(m.bulle.b - (m.el.t - 8)) <= PRES, `8 px au-dessus de l'élément : ${voir(m)}`)
}
function enDessous(m: Mesure) {
  assert.equal(m.cote, 'bottom', `côté bas : ${voir(m)}`)
  assert.ok(Math.abs(m.bulle.t - (m.el.b + 8)) <= PRES, `8 px sous l'élément : ${voir(m)}`)
}
function centree(m: Mesure) {
  assert.ok(Math.abs((m.bulle.l + m.bulle.r) / 2 - (m.el.l + m.el.r) / 2) <= PRES, `centrée sur l'élément : ${voir(m)}`)
}
// glissée contre un bord : la bulle couvre encore le milieu de son élément
function auDroit(m: Mesure) {
  const milieu = (m.el.l + m.el.r) / 2
  assert.ok(m.bulle.l <= milieu && milieu <= m.bulle.r, `au droit de son élément : ${voir(m)}`)
}

for (const nom of MOTEURS) describe(`@title : la bulle s'ouvre contre son élément (${nom} réel)`, function () {
  this.timeout(240000)
  let present = false
  let browser: any
  let page: any
  let fait: Record<Build, Fichiers>
  let contenu = ''
  const erreurs: string[] = []

  before(async () => {
    const playwright: any = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) return
    fait    = await construire()
    browser = await playwright[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
    page    = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await page.addInitScript('window.__name = (f) => f')
    await page.addInitScript(OUTILS)
    page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e).slice(0, 200)))
    page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push('console : ' + m.text().slice(0, 200)) })
    await page.route('http://bulle.test/**', async (route: any) => {
      const url = new URL(route.request().url())
      const [, build, ...reste] = url.pathname.split('/')
      if (build === 'dev' || build === 'prod') {
        const corps = fait[build].get(reste.join('/'))
        if (!corps) { await route.fulfill({ status: 404, body: '' }); return }
        await route.fulfill({ status: 200, contentType: url.pathname.endsWith('.json') ? 'application/json' : 'text/javascript', body: corps })
        return
      }
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: contenu })
    })
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  // la bulle visible porte le texte attendu
  async function attendreBulle(sel: string): Promise<Mesure> {
    await page.waitForFunction(`(() => { const b = window.__bulle(); return !!b && b.textContent === ${JSON.stringify(TEXTES[sel])} })()`, null, { timeout: 5000 })
    const m: Mesure = await page.evaluate(`window.__mesure(${JSON.stringify(sel)})`)
    assert.ok(m, 'une bulle visible')
    return m
  }
  async function survoler(sel: string): Promise<Mesure> {
    const c = await page.evaluate(`window.__centre(${JSON.stringify(sel)})`)
    await page.mouse.move(c.x, c.y)
    return attendreBulle(sel)
  }
  async function focaliser(sel: string): Promise<Mesure> {
    await page.evaluate(`window.__racine().querySelector(${JSON.stringify(sel)}).focus()`)
    return attendreBulle(sel)
  }
  // souris sur un coin vide, focus rendu : plus aucune bulle
  async function quitter() {
    await page.mouse.move(1100, 790)
    await page.evaluate(`(() => { const o = window.__ombre(), a = (o && o.activeElement) || document.activeElement; if (a && a !== document.body && a.blur) a.blur() })()`)
    await page.waitForFunction('!window.__bulle()', null, { timeout: 5000 })
  }

  for (const build of BUILDS) for (const mode of ['ombre', 'leger'] as const) describe(`${build === 'dev' ? 'développement' : 'production'}, composant ${mode === 'ombre' ? 'à ombre' : 'léger (mjs-light)'}`, function () {
    const lieu = mode === 'ombre' ? 'ombre' : 'page'

    before(async function () {
      if (!present) this.skip()
      contenu = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-bulle-pres${mode === 'leger' ? ' mjs-light' : ''}></mjs-bulle-pres><script type="module" src="/${build}/bundle.js"></script></body></html>`
      erreurs.length = 0
      await page.goto('http://bulle.test/page', { waitUntil: 'load' })
      await page.waitForFunction(`(() => { const h = document.querySelector('mjs-bulle-pres'); return !!h && h.matches(':defined') && !!h._shadow && !!h._shadow.querySelector('.court') })()`, null, { timeout: 30000 })
      assert.equal(await page.evaluate('!!window.__ombre()'), mode === 'ombre', mode === 'ombre' ? 'le composant a son ombre' : 'le composant léger n\'a pas d\'ombre')
      await page.mouse.move(1100, 790)
    })

    beforeEach(async function () {
      if (!present) this.skip()
      await quitter()
    })

    it('survol de l\'icône : centrée 8 px au-dessus, à sa place dès la première image', async function () {
      await page.evaluate('window.__filmer()')
      const m = await survoler('.icone')
      await page.waitForTimeout(300)
      const images: any[] = await page.evaluate('window.__couper()')
      assert.equal(m.lieu, lieu, `la bulle naît ${lieu === 'ombre' ? 'dans l\'ombre du composant' : 'dans la page'} : ${voir(m)}`)
      auDessus(m)
      centree(m)
      dansLaFenetre(m)
      assert.ok(images.length > 0, 'des images relevées pendant l\'apparition')
      for (const i of images) assert.ok(Math.abs(i.l - m.bulle.l) <= PRES && Math.abs(i.t - m.bulle.t) <= PRES, `aucune image au mauvais endroit : ${JSON.stringify(i)} contre ${voir(m)}`)
    })

    it('focus de l\'icône : centrée 8 px au-dessus', async function () {
      const m = await focaliser('.icone')
      auDessus(m)
      centree(m)
      dansLaFenetre(m)
    })

    it('trop près du haut de la fenêtre : en dessous, 8 px sous l\'élément', async function () {
      const m = await survoler('.haut')
      enDessous(m)
      centree(m)
      dansLaFenetre(m)
    })

    it('`side: \'bottom\'` trop près du bas de la fenêtre : au-dessus, 8 px au-dessus de l\'élément', async function () {
      const m = await survoler('.bas')
      auDessus(m)
      centree(m)
      dansLaFenetre(m)
    })

    it('contre les bords gauche et droit : la bulle glisse vers l\'intérieur, au droit de son élément, jamais hors de la fenêtre', async function () {
      const g = await focaliser('.gauche')
      auDessus(g)
      auDroit(g)
      dansLaFenetre(g)
      await quitter()
      const d = await survoler('.droite')
      auDessus(d)
      auDroit(d)
      dansLaFenetre(d)
    })

    it('après une bulle étroite contre le bord droit, la bulle de l\'icône, plus longue, reste centrée 8 px au-dessus', async function () {
      await survoler('.court')
      const m = await survoler('.icone')
      auDessus(m)
      centree(m)
      dansLaFenetre(m)
    })

    it('aucune erreur dans la page pendant ces ouvertures', () => {
      assert.deepEqual(erreurs, [])
    })
  })
})
