// Quatre effets dans Chromium réel, ce que happy-dom ne montre pas (animations CSS, couche du dessus, mise en page, défilement) :
// - *path : la mesure du tracé, refaite au redimensionnement de la fenêtre ou du parent, ne relance pas l'animation du parcours —
//   la balise continue son chemin, sans sauter au départ ;
// - *pointer(hide: true) : dans une boîte de dialogue modale (la couche du dessus, que nul z-index ne dépasse : le disque n'y
//   paraît pas), le curseur du système reste visible et le disque s'éteint ; ailleurs dans la zone, le curseur reste caché ;
// - *count : la place réservée au nombre ne réduit jamais la largeur minimale que la feuille de l'auteur donne à la balise ;
// - *pointer(lens, outside: true) sur un panneau qui défile : le voile reste sur le panneau visible.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
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

const SOURCES: Record<string, string> = {
  'essai-parcours.mjs': [
    '<div class="cadre">',
    '  <i class="b" *path(d: wave, duration: 4s)></i>',
    '</div>',
    '<style>',
    '.cadre',
    '  position: relative',
    '  width: 290px',
    '  height: 160px',
    '.b',
    '  display: block',
    '  width: 10px',
    '  height: 10px',
    '  background: #000',
    '</style>',
    ''
  ].join('\n'),
  'essai-curseur.mjs': [
    '<section class="z" *pointer(hide: true, smooth: 1)>',
    '  <p class="hors">Zone</p>',
    '  <dialog class="d"><p class="dedans">Boîte</p></dialog>',
    '</section>',
    '<style>',
    '.z',
    '  width: 600px',
    '  height: 300px',
    '.hors',
    '  margin: 0',
    '  height: 100px',
    '.dedans',
    '  width: 200px',
    '  height: 100px',
    '</style>',
    ''
  ].join('\n'),
  'essai-compteur.mjs': [
    '<b class="n" *count(on: load, duration: 0s)>42</b>',
    '<style>',
    '.n',
    '  display: inline-block',
    '  min-width: 6em',
    '  font-size: 16px',
    '</style>',
    ''
  ].join('\n'),
  'essai-voile.mjs': [
    '<div class="p" *pointer(lens, outside: true, size: 100, smooth: 1)>',
    '  <div class="long"></div>',
    '</div>',
    '<style>',
    '.p',
    '  width: 300px',
    '  height: 200px',
    '  overflow: auto',
    '.long',
    '  height: 1000px',
    '</style>',
    ''
  ].join('\n')
}

let compilation: Promise<string> | null = null
function compile(): Promise<string> {
  compilation ??= (async () => {
    const root   = mjsTmp('effets-path-pointer-count-browser')
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

describe('*path, *pointer, *count (Chromium réel) : animation gardée, couche du dessus, largeur de l\'auteur, panneau qui défile', function () {
  this.timeout(300000)
  let present = false
  let script  = ''
  let browser: any = null

  before(async function () {
    present = await chromiumPresent()
    if (!present) {
      console.log('  ℹ️  Chromium indisponible, tests sautés')
      return
    }
    script = await compile()
    const { chromium } = await import('playwright')
    browser = await chromium.launch({ args: ['--no-sandbox'] })
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  async function ouvre(tag: string) {
    const contexte = await browser.newContext({ viewport: { width: 800, height: 600 } })
    const page     = await contexte.newPage()
    const erreurs: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e)))
    await page.route('http://t.test/**', (route: any) => {
      if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
    })
    await page.goto('http://t.test/', { waitUntil: 'load' })
    await page.waitForFunction((t: string) => ((document.querySelector(t) as any)?._shadow?.childElementCount ?? 0) > 0, tag)
    // n images d'animation : ce qu'une mesure demandée par un avis (fenêtre, observateur de taille) attend pour être faite
    const images = (n: number) => page.evaluate((k: number) => new Promise<void>((ok) => {
      const pas = () => (--k <= 0 ? ok() : requestAnimationFrame(pas))
      requestAnimationFrame(pas)
    }), n)
    return { page, contexte, erreurs, images }
  }

  it('*path : redimensionner la fenêtre ou le parent ne relance pas le parcours, la balise continue son chemin', async function () {
    if (!present) return this.skip()
    const { page, contexte, erreurs, images } = await ouvre('mjs-essai-parcours')
    const lis = () => page.evaluate(() => {
      const b = (document.querySelector('mjs-essai-parcours') as any)._shadow.querySelector('.b')
      const a = b.getAnimations()
      const w = window as any
      w.__vues ??= []
      for (const x of a) if (!w.__vues.includes(x)) w.__vues.push(x)
      return { n: a.length, t: a.length ? a[0].currentTime : null, vues: w.__vues.length }
    })
    await page.waitForTimeout(1200)
    const depart = await lis()
    await page.setViewportSize({ width: 820, height: 600 })
    await images(4)
    const fenetre = await lis()
    await page.evaluate(() => { (document.querySelector('mjs-essai-parcours') as any)._shadow.querySelector('.cadre').style.width = '400px' })
    await images(4)
    const parent = await lis()
    await contexte.close()
    assert.deepEqual(erreurs, [])
    assert.equal(depart.n, 1, 'une animation de parcours')
    assert.ok(depart.t > 500, 'parcours en route : ' + JSON.stringify(depart))
    assert.ok(fenetre.t >= depart.t, `fenêtre redimensionnée : le parcours est reparti (${depart.t} → ${fenetre.t} ms)`)
    assert.ok(parent.t >= fenetre.t, `parent élargi : le parcours est reparti (${fenetre.t} → ${parent.t} ms)`)
    assert.equal(parent.vues, 1, 'une seule animation vue du début à la fin')
  })

  it('*pointer(hide: true) : dans une boîte de dialogue modale le curseur du système reste visible et le disque s\'éteint ; une zone hors composant aussi', async function () {
    if (!present) return this.skip()
    const { page, contexte, erreurs, images } = await ouvre('mjs-essai-curseur')
    // la même zone hors composant (la feuille du document cache le curseur, pas celle d'une racine d'ombre), sous la première
    await page.evaluate(() => {
      const z = document.createElement('section')
      z.className = 'z2'
      z.style.cssText = 'width:600px;height:200px'
      z.innerHTML = '<p class="hors2" style="margin:0;height:100px">Zone</p><dialog class="d2"><p class="dedans2" style="width:200px;height:100px">Boîte</p></dialog>'
      document.body.appendChild(z)
      ;(window as any).µ._mjs_fx(null, z, 'pointer', { hide: true, smooth: 1 })
    })
    const etat = (racine: boolean, hors: string, dedans: string) => page.evaluate(({ racine, hors, dedans }: any) => {
      const r: any = racine ? (document.querySelector('mjs-essai-curseur') as any)._shadow : document
      const calques = [...document.querySelectorAll('[mjs-fx-pointer-layer]')]
      return { hors: getComputedStyle(r.querySelector(hors)).cursor, dedans: getComputedStyle(r.querySelector(dedans)).cursor, allumes: calques.filter((c) => c.hasAttribute('mjs-fx-pointer-on')).length }
    }, { racine, hors, dedans })
    const centre = (racine: boolean, sel: string) => page.evaluate(({ racine, sel }: any) => {
      const r: any = racine ? (document.querySelector('mjs-essai-curseur') as any)._shadow : document
      const b = r.querySelector(sel).getBoundingClientRect()
      return [b.left + b.width / 2, b.top + b.height / 2]
    }, { racine, sel })
    const vu: any = {}
    for (const [racine, hors, dlg, dedans] of [[true, '.hors', '.d', '.dedans'], [false, '.hors2', '.d2', '.dedans2']] as Array<[boolean, string, string, string]>) {
      const nom = racine ? 'composant' : 'page'
      const [hx, hy] = await centre(racine, hors)
      await page.mouse.move(hx, hy)
      await page.mouse.move(hx + 3, hy + 2)
      await images(3)
      vu[nom + ' zone'] = await etat(racine, hors, dedans)
      await page.evaluate(({ racine, dlg }: any) => {
        const r: any = racine ? (document.querySelector('mjs-essai-curseur') as any)._shadow : document
        r.querySelector(dlg).showModal()
      }, { racine, dlg })
      const [dx, dy] = await centre(racine, dedans)
      await page.mouse.move(dx, dy)
      await page.mouse.move(dx + 3, dy + 2)
      await images(3)
      vu[nom + ' boîte'] = await etat(racine, hors, dedans)
      await page.evaluate(({ racine, dlg }: any) => {
        const r: any = racine ? (document.querySelector('mjs-essai-curseur') as any)._shadow : document
        r.querySelector(dlg).close()
      }, { racine, dlg })
      await page.mouse.move(5, 590)
      await images(2)
    }
    await contexte.close()
    assert.deepEqual(erreurs, [])
    assert.equal(vu['composant zone'].hors, 'none', 'curseur caché dans la zone : ' + JSON.stringify(vu))
    assert.equal(vu['composant zone'].allumes, 1, 'disque allumé dans la zone : ' + JSON.stringify(vu))
    assert.notEqual(vu['composant boîte'].dedans, 'none', 'curseur du système dans la boîte : ' + JSON.stringify(vu))
    assert.equal(vu['composant boîte'].allumes, 0, 'disque éteint dans la boîte : ' + JSON.stringify(vu))
    assert.equal(vu['page zone'].hors, 'none', 'curseur caché dans la zone hors composant : ' + JSON.stringify(vu))
    assert.notEqual(vu['page boîte'].dedans, 'none', 'curseur du système dans la boîte hors composant : ' + JSON.stringify(vu))
    assert.equal(vu['page boîte'].allumes, 0, 'disque éteint dans la boîte hors composant : ' + JSON.stringify(vu))
  })

  it('*count : la largeur minimale de la feuille de l\'auteur (6em) est gardée', async function () {
    if (!present) return this.skip()
    const { page, contexte, erreurs, images } = await ouvre('mjs-essai-compteur')
    await page.waitForTimeout(300)
    await images(3)
    const largeur = await page.evaluate(() => (document.querySelector('mjs-essai-compteur') as any)._shadow.querySelector('.n').getBoundingClientRect().width)
    await contexte.close()
    assert.deepEqual(erreurs, [])
    assert.ok(largeur >= 96, 'largeur de la balise : ' + largeur + ' px (min-width: 6em = 96 px)')
  })

  it('*pointer(lens, outside: true) sur un panneau qui défile : le voile reste sur le panneau visible', async function () {
    if (!present) return this.skip()
    const { page, contexte, erreurs, images } = await ouvre('mjs-essai-voile')
    const boites = () => page.evaluate(() => {
      const p = (document.querySelector('mjs-essai-voile') as any)._shadow.querySelector('.p')
      const v = p.querySelector('[mjs-fx-layer="pointer"]')
      const a = p.getBoundingClientRect()
      const b = v.getBoundingClientRect()
      return { panneau: [Math.round(a.top), Math.round(a.bottom)], voile: [Math.round(b.top), Math.round(b.bottom)], defilement: p.scrollTop }
    })
    await page.mouse.move(150, 100)
    await page.mouse.move(152, 102)
    await images(3)
    await page.evaluate(() => { (document.querySelector('mjs-essai-voile') as any)._shadow.querySelector('.p').scrollTop = 500 })
    await images(4)
    const vu = await boites()
    await contexte.close()
    assert.deepEqual(erreurs, [])
    assert.equal(vu.defilement, 500)
    assert.deepEqual(vu.voile, vu.panneau, 'voile et panneau : ' + JSON.stringify(vu))
  })
})
