// *magnet et *dock s'ajoutent au translate et au scale que la feuille donne à la balise À CHAQUE INSTANT, pas à une valeur relevée une
// fois à la pose (Chromium réel : happy-dom ne calcule ni `translate`, ni `scale`, ni `:hover`) :
// - une classe échangée après la pose (un panneau qui glisse en place, des icônes qui grandissent) : la balise suit ;
// - un `:hover` de l'auteur (`hover:-translate-y-0.5`, `hover:scale-110` de Tailwind 4) : l'aimant tire encore la balise soulevée, et
//   l'icône sous la souris reste la plus grosse de la rangée ;
// - la transition de l'auteur reste la sienne ; retirés, ni animation ni marque laissées.
// Les effets sont posés par le moteur sur des balises de la page (µ._mjs_fx) ; la souris est la vraie (survol réel) ; un seul Chromium.

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

const STYLE = 'html,body{margin:0;font:16px sans-serif}'
  + '.m{position:absolute;left:200px;top:100px;width:80px;height:40px;background:#c00;border:0;padding:0}'
  + '.t-off{translate:0 200px}.t-on{translate:0 0}.hov:hover{translate:0 -4px}.lent{transition:background-color .2s}'
  + '.row{position:absolute;left:100px;top:500px;display:flex;gap:10px}.row>b{display:block;width:40px;height:40px;background:#888}'
  + '.s8{scale:.8}.s12{scale:1.2}.row2>b:hover{scale:1.1}'

describe('*magnet et *dock (Chromium réel) — le translate et le scale de l\'auteur suivis en direct', function () {
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
    const root   = mjsTmp('effets-aimant-dock-auteur-en-direct')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fx-banc.mjs'), '<div *magnet>x</div>\n<div *dock>x</div>\n')
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

  // une page où `html` est posé dans la zone ; `fn` s'y exécute, la page est refermée ensuite
  async function avec<T>(html: string, fn: (page: any) => Promise<T>): Promise<T> {
    const ctx  = await browser.newContext({ viewport: { width: 1000, height: 800 } })
    const page = await ctx.newPage()
    const erreurs: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e)))
    try {
      await page.route('http://t.test/**', (route: any) => {
        if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body><div id="zone">${html}</div><script>${script}</script></body></html>` })
      })
      await page.goto('http://t.test/', { waitUntil: 'load' })
      const r = await fn(page)
      assert.deepEqual(erreurs, [])
      return r
    }
    finally {
      await ctx.close()
    }
  }

  const poser = (page: any, quoi: Array<[string, string]>) => page.evaluate((quoi: Array<[string, string]>) => {
    for (const [id, nom] of quoi) (window as any).µ._mjs_fx(null, document.getElementById(id), nom, {})
  }, quoi)

  it('*magnet : une classe échangée après la pose déplace la balise, l\'aimant ne la fige pas à son ancienne place', async () => {
    const r: any = await avec('<button class="m t-off lent" id="sw">sw</button>', async (page) => {
      await poser(page, [['sw', 'magnet']])
      await page.waitForTimeout(400)
      const haut = () => page.evaluate(() => Math.round(document.getElementById('sw')!.getBoundingClientRect().top))
      const out: any = { avant: await haut(), transition: await page.evaluate(() => getComputedStyle(document.getElementById('sw')!).transitionProperty) }
      await page.evaluate(() => document.getElementById('sw')!.classList.replace('t-off', 't-on'))
      await page.waitForTimeout(400)
      out.apres = await haut()
      await page.evaluate(() => (window as any).µ._mjs_fxClear(document.getElementById('sw')))
      out.retrait = await page.evaluate(() => { const e = document.getElementById('sw')!; return { animations: e.getAnimations().length, haut: Math.round(e.getBoundingClientRect().top), marques: e.getAttributeNames().filter((n) => n.startsWith('mjs-fx')) } })
      return out
    })
    assert.equal(r.avant, 300, `posé : la balise est à la place que lui donne sa classe (100 + 200) — ${JSON.stringify(r)}`)
    assert.equal(r.apres, 100, `la classe échangée la remet à 100, l'aimant posé ou non — ${JSON.stringify(r)}`)
    assert.equal(r.transition, 'background-color', `la transition de l'auteur reste la sienne — ${JSON.stringify(r)}`)
    assert.deepEqual(r.retrait, { animations: 0, haut: 100, marques: [] }, `retiré : ni animation ni marque — ${JSON.stringify(r)}`)
  })

  it('*dock : des icônes qui changent de classe après la pose prennent leur nouveau scale', async () => {
    const r: any = await avec('<div class="row" id="r1"><b class="s8">1</b><b class="s8">2</b><b class="s8">3</b></div>', async (page) => {
      await poser(page, [['r1', 'dock']])
      await page.waitForTimeout(400)
      const echelles = () => page.evaluate(() => Array.from(document.querySelectorAll('#r1>b')).map((b) => getComputedStyle(b).scale))
      const out: any = { avant: await echelles() }
      await page.evaluate(() => document.querySelectorAll('#r1>b').forEach((b) => b.classList.replace('s8', 's12')))
      await page.waitForTimeout(400)
      out.apres = await echelles()
      return out
    })
    assert.deepEqual(r.avant, ['0.8', '0.8', '0.8'], `posé : le scale de l'auteur — ${JSON.stringify(r)}`)
    assert.deepEqual(r.apres, ['1.2', '1.2', '1.2'], `la classe échangée donne son scale aux icônes — ${JSON.stringify(r)}`)
  })

  it('*magnet sous un :hover de l\'auteur : la balise soulevée de 4 px est encore tirée vers la souris', async () => {
    const r: any = await avec('<button class="m hov" id="hv" style="left:200px;top:400px">hv</button>', async (page) => {
      await poser(page, [['hv', 'magnet']])
      await page.waitForTimeout(400)
      const b0 = await page.evaluate(() => document.getElementById('hv')!.getBoundingClientRect().toJSON())
      // la souris entre au milieu de la balise soulevée (16 px sous son haut de repos), puis file vers son bord droit
      await page.mouse.move(b0.left + 40, b0.top + 16)
      await page.waitForTimeout(100)
      await page.mouse.move(b0.left + 75, b0.top + 16, { steps: 5 })
      await page.waitForTimeout(500)
      const out: any = await page.evaluate((b0: any) => { const b = document.getElementById('hv')!.getBoundingClientRect(); return { dx: Math.round(b.left - b0.left), dy: Math.round(b.top - b0.top) } }, b0)
      await page.mouse.move(5, 790)
      await page.waitForTimeout(600)
      out.sortie = await page.evaluate((b0: any) => { const e = document.getElementById('hv')!; const b = e.getBoundingClientRect(); return { dx: Math.round(b.left - b0.left), dy: Math.round(b.top - b0.top), animations: e.getAnimations().length } }, b0)
      return out
    })
    assert.ok(r.dx >= 15 && r.dx <= 19, `tirée vers la droite (7/8 de strength, 20 px : 17,5 px) — ${JSON.stringify(r)}`)
    assert.equal(r.dy, -4, `soulevée de 4 px par le :hover de l'auteur — ${JSON.stringify(r)}`)
    assert.deepEqual(r.sortie, { dx: 0, dy: 0, animations: 0 }, `la souris partie : à sa place, sans animation laissée — ${JSON.stringify(r)}`)
  })

  it('*dock sous un :hover de l\'auteur (scale 1.1) : l\'icône sous la souris est la plus grosse de la rangée', async () => {
    const r: any = await avec('<div class="row row2" id="r2" style="top:650px"><b>1</b><b>2</b><b>3</b></div>', async (page) => {
      await poser(page, [['r2', 'dock']])
      await page.waitForTimeout(400)
      const ic = await page.evaluate(() => { const b = document.querySelectorAll('#r2>b')[1].getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } })
      await page.mouse.move(ic.x - 30, ic.y)
      await page.waitForTimeout(100)
      await page.mouse.move(ic.x, ic.y, { steps: 5 })
      await page.waitForTimeout(500)
      const out: any = { survol: await page.evaluate(() => Array.from(document.querySelectorAll('#r2>b')).map((b) => Math.round(b.getBoundingClientRect().width))) }
      await page.evaluate(() => (window as any).µ._mjs_fxClear(document.getElementById('r2')))
      out.retrait = await page.evaluate(() => Array.from(document.querySelectorAll('#r2>b')).map((b) => b.getAnimations().length + (b.getAttribute('style') || '') + b.getAttributeNames().filter((n) => n.startsWith('mjs-fx')).join(' ')))
      return out
    })
    const [a, b, c] = r.survol
    assert.ok(b > a && b > c, `l'icône survolée grossit le plus (1,6 × 1,1) — ${JSON.stringify(r)}`)
    assert.ok(Math.abs(b - 70) <= 1, `40 px × 1,6 × 1,1 = 70 px — ${JSON.stringify(r)}`)
    assert.deepEqual(r.retrait, ['0', '0', '0'], `retiré : ni animation, ni variable, ni marque sur les icônes — ${JSON.stringify(r)}`)
  })
})
