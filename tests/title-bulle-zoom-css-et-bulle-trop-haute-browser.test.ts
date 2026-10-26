// `@title` : la bulle reste contre son élément sous un `zoom` CSS, et dans la fenêtre quand elle est plus haute que la place disponible.
// Sous `html { zoom: 1.5 }`, ou dans un conteneur zoomé autour d'un composant à ombre, elle partait environ 1,5 fois plus loin, en bas à
// droite, et sortait de la fenêtre près du bord droit : ses coordonnées, mesurées sur l'écran, étaient posées telles quelles en `top` et
// `left`, que le navigateur multiplie par le zoom. Une bulle plus haute que la place des deux côtés de son élément sortait par le bas, même
// quand le haut avait bien plus de place : le côté préféré trop court faisait passer de l'autre côté sans comparer les deux, et rien ne
// bornait `top`. Désormais, quand aucun côté ne suffit, le côté qui a le plus de place gagne et la bulle est ramenée dans la fenêtre, à
// 8 px du bord ; plus haute que la fenêtre entière, sa hauteur est bornée à la fenêtre moins 2 × 8 px. Composant à ombre et composant léger
// (`mjs-light`), Chromium, Firefox et WebKit réels, en développement et en production

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const MOTEURS = ['chromium', 'firefox', 'webkit'] as const
const BUILDS  = ['dev', 'prod'] as const
type Build    = typeof BUILDS[number]

// environ 720 px de haut sur 280 px de large : plus haute que la place des deux côtés d'un élément, dans une fenêtre de 800 px
const LONG    = 'Très longue bulle. '.repeat(90).trim()
// plus haute que la fenêtre entière
const IMMENSE = 'Bulle immense, plus haute que la fenêtre. '.repeat(120).trim()

const TEXTES: Record<string, string> = {
  '.centre': 'Bulle du centre',
  '.droite': 'Contre le bord droit, la bulle glisse vers le centre sans sortir de la fenêtre',
  '.long-haut': LONG,
  '.long-bas': LONG,
  '.long-prefere-bas': LONG,
  '.long-prefere-bas-en-bas': LONG,
  '.immense': IMMENSE
}

const SOURCE = `<button class="centre" type="button" @title={ text: '${TEXTES['.centre']}', delay: 0 }>C</button>
<button class="droite" type="button" @title={ text: '${TEXTES['.droite']}', delay: 0 }>D</button>
<button class="long-haut" type="button" @title={ text: '${LONG}', delay: 0 }>H</button>
<button class="long-bas" type="button" @title={ text: '${LONG}', delay: 0 }>B</button>
<button class="long-prefere-bas" type="button" @title={ text: '${LONG}', delay: 0, side: 'bottom' }>P</button>
<button class="long-prefere-bas-en-bas" type="button" @title={ text: '${LONG}', delay: 0, side: 'bottom' }>Q</button>
<button class="immense" type="button" @title={ text: '${IMMENSE}', delay: 0 }>I</button>

<style>
  :host
    display: block
    padding: 300px 0 0 200px

  button
    width: 32px
    height: 32px

  .droite, .long-haut, .long-bas, .long-prefere-bas, .long-prefere-bas-en-bas, .immense
    position: fixed

  .droite
    top: 400px
    right: 0

  .long-haut
    top: 600px
    left: 232px

  .long-bas
    top: 150px
    left: 600px

  .long-prefere-bas
    top: 600px
    left: 800px

  .long-prefere-bas-en-bas
    top: 150px
    left: 1000px

  .immense
    top: 300px
    left: 500px
</style>
`

// la page autour du composant : sans zoom, `html` zoomé, ou un conteneur zoomé autour de la balise
const VARIANTES = [
  { nom: 'sans zoom', style: '', avant: '', apres: '' },
  { nom: 'zoom CSS 1,5 sur <html>', style: 'html { zoom: 1.5 }', avant: '', apres: '' },
  { nom: 'zoom CSS 1,5 sur un conteneur', style: '.zoom { zoom: 1.5 }', avant: '<div class="zoom">', apres: '</div>' }
] as const

// tolérance des arrondis au demi-pixel
const PRES = 1

const OUTILS = `
window.__racine = () => { const h = document.querySelector('mjs-bulle-zoom'); return h && h._shadow }
window.__ombre = () => { const h = document.querySelector('mjs-bulle-zoom'); return h && h._shadow && h._shadow !== h ? h._shadow : null }
window.__bulles = () => [...(window.__ombre() ? window.__ombre().querySelectorAll('.mjs-title') : []), ...document.querySelectorAll('.mjs-title')]
window.__bulle = () => window.__bulles().find((b) => b.classList.contains('mjs-title-visible')) || null
window.__centre = (sel) => { const r = window.__racine().querySelector(sel).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } }
window.__mesure = (sel) => {
  const b = window.__bulle()
  if (!b) return null
  const e = window.__racine().querySelector(sel).getBoundingClientRect(), q = b.getBoundingClientRect()
  return {
    el: { l: e.left, t: e.top, r: e.right, b: e.bottom },
    bulle: { l: q.left, t: q.top, r: q.right, b: q.bottom },
    cote: b.getAttribute('data-mjs-title-side'),
    vw: document.documentElement.clientWidth,
    vh: document.documentElement.clientHeight
  }
}
`

type Fichiers = Map<string, Buffer>
let construit: Promise<Record<Build, Fichiers>> | null = null

// le build de développement et celui de production, chacun servi fichier par fichier sous son préfixe, une fois pour les trois moteurs
function construire(): Promise<Record<Build, Fichiers>> {
  construit ??= (async () => {
    const root   = mjsTmp('title-bulle-zoom')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'bulle-zoom.mjs'), SOURCE)
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

type Mesure = { el: any, bulle: any, cote: string, vw: number, vh: number }

const voir = (m: Mesure) => JSON.stringify(m)

function dansLaFenetre(m: Mesure) {
  assert.ok(m.bulle.l >= -PRES && m.bulle.t >= -PRES && m.bulle.r <= m.vw + PRES && m.bulle.b <= m.vh + PRES, `la bulle reste dans la fenêtre : ${voir(m)}`)
}
function auDessus(m: Mesure) {
  assert.equal(m.cote, 'top', `côté haut : ${voir(m)}`)
  assert.ok(Math.abs(m.bulle.b - (m.el.t - 8)) <= PRES, `8 px au-dessus de l'élément : ${voir(m)}`)
}
function centree(m: Mesure) {
  assert.ok(Math.abs((m.bulle.l + m.bulle.r) / 2 - (m.el.l + m.el.r) / 2) <= PRES, `centrée sur l'élément : ${voir(m)}`)
}
// glissée contre un bord : la bulle couvre encore le milieu de son élément, à 8 px du bord
function glisseeAuDroit(m: Mesure) {
  const milieu = (m.el.l + m.el.r) / 2
  assert.ok(m.bulle.l <= milieu && milieu <= m.bulle.r, `au droit de son élément : ${voir(m)}`)
  assert.ok(Math.abs(m.bulle.r - (m.vw - 8)) <= PRES, `8 px du bord droit : ${voir(m)}`)
}
function contreLeHaut(m: Mesure) {
  assert.ok(Math.abs(m.bulle.t - 8) <= PRES, `ramenée à 8 px du haut de la fenêtre : ${voir(m)}`)
}
function contreLeBas(m: Mesure) {
  assert.ok(Math.abs(m.bulle.b - (m.vh - 8)) <= PRES, `ramenée à 8 px du bas de la fenêtre : ${voir(m)}`)
}

for (const nom of MOTEURS) describe(`@title : zoom CSS et bulle plus haute que la place disponible (${nom} réel)`, function () {
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

  async function survoler(sel: string): Promise<Mesure> {
    const c = await page.evaluate(`window.__centre(${JSON.stringify(sel)})`)
    await page.mouse.move(c.x, c.y)
    await page.waitForFunction(`(() => { const b = window.__bulle(); return !!b && b.textContent === ${JSON.stringify(TEXTES[sel])} })()`, null, { timeout: 5000 })
    const m: Mesure = await page.evaluate(`window.__mesure(${JSON.stringify(sel)})`)
    assert.ok(m, 'une bulle visible')
    return m
  }
  // souris sur un coin vide : plus aucune bulle
  async function quitter() {
    await page.mouse.move(1100, 790)
    await page.waitForFunction('!window.__bulle()', null, { timeout: 5000 })
  }

  for (const build of BUILDS) for (const mode of ['ombre', 'leger'] as const) for (const v of VARIANTES) describe(`${build === 'dev' ? 'développement' : 'production'}, composant ${mode === 'ombre' ? 'à ombre' : 'léger (mjs-light)'}, ${v.nom}`, function () {
    before(async function () {
      if (!present) this.skip()
      contenu = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>body { margin: 0 } ${v.style}</style></head><body>${v.avant}<mjs-bulle-zoom${mode === 'leger' ? ' mjs-light' : ''}></mjs-bulle-zoom>${v.apres}<script type="module" src="/${build}/bundle.js"></script></body></html>`
      erreurs.length = 0
      await page.goto('http://bulle.test/page', { waitUntil: 'load' })
      await page.waitForFunction(`(() => { const h = document.querySelector('mjs-bulle-zoom'); return !!h && h.matches(':defined') && !!h._shadow && !!h._shadow.querySelector('.immense') })()`, null, { timeout: 30000 })
      assert.equal(await page.evaluate('!!window.__ombre()'), mode === 'ombre', mode === 'ombre' ? 'le composant a son ombre' : 'le composant léger n\'a pas d\'ombre')
      await page.mouse.move(1100, 790)
    })

    beforeEach(async function () {
      if (!present) this.skip()
      await quitter()
    })

    it('l\'élément du centre : centrée 8 px au-dessus', async function () {
      const m = await survoler('.centre')
      auDessus(m)
      centree(m)
      dansLaFenetre(m)
    })

    it('contre le bord droit : 8 px au-dessus, glissée vers l\'intérieur, au droit de son élément', async function () {
      const m = await survoler('.droite')
      auDessus(m)
      glisseeAuDroit(m)
      dansLaFenetre(m)
    })

    it('plus haute que la fenêtre entière : hauteur bornée à la fenêtre moins 2 × 8 px, dans la fenêtre', async function () {
      const m = await survoler('.immense')
      contreLeHaut(m)
      contreLeBas(m)
      dansLaFenetre(m)
    })

    if (v.nom === 'sans zoom') {
      it('plus haute que la place des deux côtés, plus de place en haut : au-dessus, ramenée dans la fenêtre', async function () {
        const m = await survoler('.long-haut')
        assert.equal(m.cote, 'top', `le côté qui a le plus de place : ${voir(m)}`)
        contreLeHaut(m)
        centree(m)
        dansLaFenetre(m)
      })

      it('plus haute que la place des deux côtés, plus de place en bas : en dessous, ramenée dans la fenêtre', async function () {
        const m = await survoler('.long-bas')
        assert.equal(m.cote, 'bottom', `le côté qui a le plus de place : ${voir(m)}`)
        contreLeBas(m)
        centree(m)
        dansLaFenetre(m)
      })

      it('`side: \'bottom\'` plus haute que la place des deux côtés, plus de place en haut : au-dessus, ramenée dans la fenêtre', async function () {
        const m = await survoler('.long-prefere-bas')
        assert.equal(m.cote, 'top', `le côté qui a le plus de place : ${voir(m)}`)
        contreLeHaut(m)
        centree(m)
        dansLaFenetre(m)
      })

      it('`side: \'bottom\'` plus haute que la place des deux côtés, plus de place en bas : en dessous, ramenée dans la fenêtre', async function () {
        const m = await survoler('.long-prefere-bas-en-bas')
        assert.equal(m.cote, 'bottom', `le côté qui a le plus de place : ${voir(m)}`)
        contreLeBas(m)
        centree(m)
        dansLaFenetre(m)
      })
    }

    it('aucune erreur dans la page pendant ces ouvertures', () => {
      assert.deepEqual(erreurs, [])
    })
  })
})
