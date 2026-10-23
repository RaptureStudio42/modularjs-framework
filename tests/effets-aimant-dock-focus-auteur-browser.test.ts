// ce que l'auteur a écrit reste sous les petits effets, dans Chromium réel (happy-dom ne calcule ni `translate`, ni `scale`, ni transition) :
// - *magnet compose avec la propriété `translate` de l'auteur (un badge centré par `translate: -50% -50%`, ce qu'écrit Tailwind 4) :
//   centré au repos, tiré vers la souris à partir de là, rendu tel quel au retrait ; repris en plein retour, il ne se tire pas vers un faux centre ;
// - les icônes d'un *dock gardent leur `scale` et leur `translate` (une icône réduite à .8 le reste au repos, grossit à partir de .8) ;
// - *focus : une carte déplacée d'un groupe à l'autre garde la transition de l'effet et sa marque, dans les deux sens, jusqu'au retrait.
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

const EFFETS = ['magnet', 'dock', 'focus']

const STYLE = 'html,body{margin:0;font:16px sans-serif}'
  + '.wrap{position:relative;width:300px;height:100px;margin:20px;background:#eee}'
  + '.badge{position:absolute;left:50%;top:50%;translate:-50% -50%;width:60px;height:30px;background:#c00}'
  + '.rangee{display:flex;width:300px;margin:60px 20px}.rangee>b{display:block;width:40px;height:40px;background:#888;flex:none}'
  + '.ico{scale:.8}.haut{translate:0 -6px}'
  + '.col{display:flex;gap:10px;margin:10px 0}.col>div{width:80px;height:40px;background:#ddd}'

describe('petits effets (Chromium réel) — le translate, le scale et la transition de l\'auteur restent', function () {
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
    const root   = mjsTmp('effets-aimant-dock-focus-auteur')
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

  // une page vide (une zone) où le moteur pose les effets ; `fn` s'y exécute, la page est refermée ensuite
  async function avec<T>(fn: (page: any) => Promise<T>, options: any = {}): Promise<T> {
    const ctx  = await browser.newContext({ viewport: { width: 900, height: 700 }, ...options })
    const page = await ctx.newPage()
    const erreurs: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e)))
    try {
      await page.route('http://t.test/**', (route: any) => {
        if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body><div id="zone"></div><script>${script}</script></body></html>` })
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

  // le badge, sa place dans son cadre et son translate calculé, au repos, tiré, repris en plein retour, puis retiré
  const aimant = (page: any) => page.evaluate(async () => {
    const µ     = (window as any).µ
    const pause = (ms: number) => new Promise((f) => setTimeout(f, ms))
    document.getElementById('zone')!.insertAdjacentHTML('beforeend', '<div class="wrap" id="w"><div class="badge" id="bd">!</div></div>')
    const w  = document.getElementById('w')!
    const bd = document.getElementById('bd')!
    const etat = () => {
      const b = bd.getBoundingClientRect()
      const o = w.getBoundingClientRect()
      return { place: [Math.round(b.left - o.left), Math.round(b.top - o.top)], translate: getComputedStyle(bd).translate }
    }
    const out: any = { avant: etat() }
    µ._mjs_fx(null, bd, 'magnet', {})
    await pause(600)
    out.repos = etat()
    // la souris entre au centre et touche le bord droit : l'aimant tire de strength (20 px) vers la droite
    const r0 = bd.getBoundingClientRect()
    const cx = r0.left + r0.width / 2
    const cy = r0.top + r0.height / 2
    bd.dispatchEvent(new PointerEvent('pointerenter', { clientX: cx, clientY: cy }))
    bd.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r0.right, clientY: cy }))
    await pause(400)
    out.tire = etat()
    // elle part, puis revient au centre de repos pendant le retour (300 ms) : la balise n'est pas tirée
    bd.dispatchEvent(new PointerEvent('pointerleave', { clientX: r0.right + 50, clientY: cy }))
    await pause(80)
    bd.dispatchEvent(new PointerEvent('pointerenter', { clientX: cx, clientY: cy }))
    bd.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: cx, clientY: cy }))
    out.reprise = bd.style.getPropertyValue('--mjs-fx-magnet-x')
    bd.dispatchEvent(new PointerEvent('pointerleave', { clientX: r0.right + 50, clientY: cy }))
    await pause(600)
    µ._mjs_fxClear(bd)
    out.retrait = { ...etat(), style: bd.getAttribute('style') || '', attributs: bd.getAttributeNames().filter((n) => n.startsWith('mjs-fx')) }
    return out
  })

  it('*magnet compose avec le translate de l\'auteur : centré au repos, tiré à partir de là, rendu au retrait', async () => {
    const r: any = await avec(aimant)
    assert.deepEqual(r.avant.place, [120, 35], `avant l'effet, le badge est centré — ${JSON.stringify(r)}`)
    assert.deepEqual(r.repos.place, [120, 35], `*magnet au repos : le badge reste centré — ${JSON.stringify(r)}`)
    assert.deepEqual(r.tire.place, [140, 35], `la souris au bord droit tire le badge de 20 px à partir de sa place — ${JSON.stringify(r)}`)
    assert.ok(Math.abs(parseFloat(r.reprise || '0')) < 2, `repris en plein retour, la souris au centre de repos ne le tire pas — ${JSON.stringify(r)}`)
    assert.deepEqual(r.retrait.place, [120, 35], `*magnet retiré : le badge est centré — ${JSON.stringify(r)}`)
    assert.equal(r.retrait.translate, '-50% -50%', `*magnet retiré : le translate de l'auteur — ${JSON.stringify(r)}`)
    assert.ok(!/--mjs-fx-magnet/.test(r.retrait.style) && r.retrait.attributs.length === 0, `*magnet retiré : ni variable ni marque laissées — ${JSON.stringify(r.retrait)}`)
  })

  it('*magnet sous « réduire les animations » : le badge garde le translate de l\'auteur', async () => {
    const r: any = await avec(aimant, { reducedMotion: 'reduce' })
    assert.deepEqual(r.repos.place, [120, 35], `au repos — ${JSON.stringify(r)}`)
    assert.deepEqual(r.tire.place, [120, 35], `la souris ne le déplace pas — ${JSON.stringify(r)}`)
  })

  it('les icônes d\'un *dock gardent leur scale et leur translate : au repos, en grossissant, au retrait', async () => {
    const r: any = await avec((page) => page.evaluate(async () => {
      const µ     = (window as any).µ
      const pause = (ms: number) => new Promise((f) => setTimeout(f, ms))
      document.getElementById('zone')!.insertAdjacentHTML('beforeend', '<div class="rangee" id="dk"><b class="ico">1</b><b class="ico haut">2</b><b>3</b></div>')
      const dk = document.getElementById('dk')!
      const ic = Array.from(dk.children) as HTMLElement[]
      const etat = () => ic.map((c) => getComputedStyle(c).scale + ' | ' + getComputedStyle(c).translate)
      const out: any = { avant: etat() }
      µ._mjs_fx(null, dk, 'dock', {})
      await pause(400)
      out.repos = etat()
      // la souris sur la première icône : elle grossit de scale (1.6), à partir de .8
      const b = ic[0].getBoundingClientRect()
      dk.dispatchEvent(new PointerEvent('pointerenter', { clientX: b.left + 20, clientY: b.top + 20 }))
      dk.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: b.left + 20, clientY: b.top + 20 }))
      await pause(400)
      out.survol = getComputedStyle(ic[0]).scale
      dk.dispatchEvent(new PointerEvent('pointerleave', { clientX: 5, clientY: 690 }))
      await pause(400)
      out.sortie = etat()
      µ._mjs_fxClear(dk)
      out.retrait = etat()
      out.restes = ic.map((c) => (c.getAttribute('style') || '') + c.getAttributeNames().filter((n) => n.startsWith('mjs-fx')).join(' '))
      return out
    }))
    const auteur = ['0.8 | none', '0.8 | 0px -6px', 'none | none']
    assert.deepEqual(r.avant, auteur, `avant l'effet — ${JSON.stringify(r)}`)
    for (const k of ['repos', 'sortie']) {
      assert.equal(parseFloat(r[k][0]), 0.8, `${k} : l'icône réduite le reste — ${JSON.stringify(r[k])}`)
      assert.equal(parseFloat(r[k][1]), 0.8, `${k} : la deuxième aussi — ${JSON.stringify(r[k])}`)
      assert.match(r[k][1], / \| 0px -6px$/, `${k} : son translate reste — ${JSON.stringify(r[k])}`)
    }
    assert.ok(Math.abs(parseFloat(r.survol) - 1.28) < 0.02, `sous la souris, l'icône grossit de 1.6 à partir de .8 (1.28) — ${JSON.stringify(r)}`)
    assert.deepEqual(r.retrait, auteur, `*dock retiré : le scale et le translate de l'auteur — ${JSON.stringify(r)}`)
    assert.deepEqual(r.restes, ['', '', ''], `*dock retiré : ni variable ni marque laissées sur les icônes — ${JSON.stringify(r.restes)}`)
  })

  it('*focus : une carte déplacée d\'un groupe à l\'autre garde la transition de l\'effet et sa marque, dans les deux sens', async () => {
    const r: any = await avec((page) => page.evaluate(async () => {
      const µ     = (window as any).µ
      const pause = (ms: number) => new Promise((f) => setTimeout(f, ms))
      const zone  = document.getElementById('zone')!
      zone.insertAdjacentHTML('beforeend', '<div class="col" id="ga"><div>a1</div></div><div class="col" id="gb"><div>b1</div><div id="bouge">b2</div></div>')
      const A = document.getElementById('ga')!
      const B = document.getElementById('gb')!
      // A posé avant B : l'observateur de A voit l'arrivée avant que celui de B ne voie le départ
      µ._mjs_fx(null, A, 'focus', {})
      µ._mjs_fx(null, B, 'focus', {})
      const c    = document.getElementById('bouge')!
      const lire = (el: Element) => ({ marque: el.hasAttribute('mjs-fx-tr'), tp: getComputedStyle(el).transitionProperty })
      const out: any = { avant: lire(c) }
      A.appendChild(c)
      await pause(50)
      out.versA = lire(c)
      const c2 = A.children[0]
      B.appendChild(c2)
      await pause(50)
      out.versB = lire(c2)
      µ._mjs_fxClear(A)
      out.retraitA = lire(c)
      out.resteB = lire(c2)
      return out
    }))
    const F = 'filter, opacity, scale'
    assert.deepEqual(r.avant, { marque: true, tp: F }, `avant le déplacement — ${JSON.stringify(r)}`)
    assert.deepEqual(r.versA, { marque: true, tp: F }, `une carte du second groupe déplacée dans le premier garde la transition — ${JSON.stringify(r)}`)
    assert.deepEqual(r.versB, { marque: true, tp: F }, `une carte du premier déplacée dans le second aussi — ${JSON.stringify(r)}`)
    assert.deepEqual(r.retraitA, { marque: false, tp: 'all' }, `le premier groupe retiré : sa carte venue du second est rendue — ${JSON.stringify(r)}`)
    assert.deepEqual(r.resteB, { marque: true, tp: F }, `le second groupe garde la sienne — ${JSON.stringify(r)}`)
  })
})
