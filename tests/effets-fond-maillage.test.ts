// *mesh — un fond de grandes taches de couleur floues qui dérivent lentement : le calque et ses
// taches, les palettes, chaque réglage lu, les durées premières entre elles, la souris, les refus de
// compilation, le composant, le retrait.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'

const STYLES = ['boreal', 'sunset', 'ocean', 'neon', 'candy', 'forest']

const COMPOSANTS: Record<string, string> = {
  'fx-maille':          '<div class="a" *mesh>x</div>',
  'fx-maille-regles':   '<div class="a" *mesh(colors: [#f00, #0f0], count: 3, background: #123456, size: 40, blur: 30, speed: 12s, opacity: .5)>x</div>',
  'fx-maille-huit':     '<div class="a" *mesh(count: 8)>x</div>',
  'fx-maille-souris':   '<div class="a" *mesh(mouse: true)>x</div>',
  'fx-maille-survol':   '<div class="a" *mesh(on: hover)>x</div>',
  'fx-maille-carte':    '<@fx-maille-corps class="b" *mesh(sunset)></@fx-maille-corps>',
  'fx-maille-corps':    '<p>dedans</p>',
  'fx-maille-retrait':  '<script>\n$on = true\n</script>\n{if $on}<div class="a" *mesh(mouse: true)>x</div>{end}\n<button class="t" @click={$on = !$on}>t</button>',
}
for (const s of STYLES) COMPOSANTS['fx-maille-' + s] = `<div class="a" *mesh(${s})>x</div>`

const compiler = async (html: string) => (await transpile(html, { moduleName: 'fx-essai' })).output

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms))

describe('effets — *mesh', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('effets-fond-maillage')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, src] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), src)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  async function monter(tag: string, sel = '.a') {
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const comp = window.document.querySelector(tag)
    await attendre(() => !!comp._shadow?.querySelector(sel))
    await pause()
    return comp._shadow.querySelector(sel)
  }

  const calque = (el: any) => (el._shadow || el).querySelector('[mjs-fx-layer="mesh"]')
  const taches = (el: any) => Array.from(calque(el).querySelectorAll('i')) as any[]
  const v = (n: any, nom: string) => n.style.getPropertyValue(nom)

  it('*mesh : un calque au fond de la balise, avec 5 taches, la palette boreal', async () => {
    const el = await monter('mjs-fx-maille')
    const c  = calque(el)
    assert.ok(c, 'le calque')
    assert.equal(c.getAttribute('aria-hidden'), 'true')
    assert.ok(el.firstChild === c, 'premier enfant de la balise')
    assert.equal(taches(el).length, 5)
    assert.equal(v(c, '--mjs-fx-mesh-bg'), '#06121f')
    assert.deepEqual(taches(el).map((t) => v(t, '--mjs-fx-mesh-c')), ['#00e5a0', '#1f6feb', '#7c4dff', '#00b8d4', '#39ff88'])
  })

  for (const s of STYLES) {
    it(`*mesh(${s}) : une palette de 6 couleurs, la première en fond`, async () => {
      const el = await monter('mjs-fx-maille-' + s)
      const bg = v(calque(el), '--mjs-fx-mesh-bg')
      assert.match(bg, /^#[0-9a-f]{6}$/i)
      assert.equal(new Set(taches(el).map((t) => v(t, '--mjs-fx-mesh-c'))).size, 5, 'cinq couleurs de taches distinctes')
      for (const t of taches(el)) assert.match(v(t, '--mjs-fx-mesh-c'), /^#[0-9a-f]{6}$/i)
    })
  }

  it('les six palettes sont différentes', async () => {
    const fonds = new Set<string>()
    for (const s of STYLES) fonds.add(v(calque(await monter('mjs-fx-maille-' + s)), '--mjs-fx-mesh-bg'))
    assert.equal(fonds.size, 6)
  })

  it('*mesh(colors, count: 3, background, size, blur, speed, opacity) : chaque réglage lu', async () => {
    const el = await monter('mjs-fx-maille-regles')
    assert.deepEqual(taches(el).map((t) => v(t, '--mjs-fx-mesh-c')), ['#f00', '#0f0', '#f00'], 'les couleurs à soi remplacent la palette, en boucle')
    assert.equal(v(el, '--mjs-mesh-background'), '#123456')
    assert.equal(v(el, '--mjs-mesh-size'), '40%')
    assert.equal(v(el, '--mjs-mesh-blur'), '30px')
    assert.equal(v(el, '--mjs-mesh-speed'), '12s')
    assert.equal(v(el, '--mjs-mesh-opacity'), '0.5')
  })

  it('sans `background`, le fond est celui de la palette même avec des couleurs à soi', async () => {
    const el = await monter('mjs-fx-maille-regles')
    assert.equal(v(calque(el), '--mjs-fx-mesh-bg'), '#06121f')
  })

  it('count: 8 : huit taches, et chacune dérive sur ses deux axes avec une durée première, toutes différentes', async () => {
    const el  = await monter('mjs-fx-maille-huit')
    const ts  = taches(el)
    assert.equal(ts.length, 8)
    const premier = (n: number) => { for (let d = 2; d * d <= n; d++) if (n % d === 0) return false; return n > 1 }
    const durees: number[] = []
    for (const t of ts) {
      const b = t.firstElementChild
      durees.push(+v(b, '--mjs-fx-mesh-px'), +v(b, '--mjs-fx-mesh-py'))
    }
    assert.equal(durees.length, 16)
    assert.ok(durees.every(premier), 'des nombres premiers : ' + durees.join(','))
    assert.equal(new Set(durees).size, 16, 'jamais deux durées égales : les trajectoires ne se répètent pas à l\'œil')
  })

  it('aucune boucle JavaScript sans `mouse` : requestAnimationFrame n\'est jamais appelé', async () => {
    let appels = 0
    const vrai = window.requestAnimationFrame
    window.requestAnimationFrame = (f: any) => { appels++; return vrai.call(window, f) }
    try {
      const el = await monter('mjs-fx-maille')
      await pause(60)
      // l'effet est bien posé (sans calque, zéro appel ne prouverait rien)
      assert.ok(taches(el).length > 0, 'les taches du fond sont posées')
      assert.equal(appels, 0)
    } finally { window.requestAnimationFrame = vrai }
  })

  it('*mesh(mouse: true) : les taches s\'écartent de la souris, puis reviennent quand elle part', async () => {
    const el = await monter('mjs-fx-maille-souris')
    const c  = calque(el)
    c.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 200, right: 400, bottom: 200 })
    const ts = taches(el)
    assert.equal(v(ts[0], '--mjs-fx-mesh-ox'), '', 'au repos, aucune tache poussée')
    el.dispatchEvent(new window.PointerEvent('pointermove', { clientX: 200, clientY: 100 }))
    const poussees = ts.filter((t) => v(t, '--mjs-fx-mesh-ox') !== '' && parseFloat(v(t, '--mjs-fx-mesh-ox')) !== 0)
    assert.ok(poussees.length > 0, 'au moins une tache écartée')
    for (const t of ts) assert.match(v(t, '--mjs-fx-mesh-ox') + ' ' + v(t, '--mjs-fx-mesh-oy'), /^-?[\d.]+px -?[\d.]+px$/)
    el.dispatchEvent(new window.PointerEvent('pointerleave'))
    for (const t of ts) assert.equal(parseFloat(v(t, '--mjs-fx-mesh-ox')), 0)
  })

  it('sans `mouse`, la souris ne pousse rien', async () => {
    const el = await monter('mjs-fx-maille')
    el.dispatchEvent(new window.PointerEvent('pointermove', { clientX: 200, clientY: 100 }))
    const ts = taches(el)
    assert.ok(ts.length > 0, 'les taches du fond sont posées')
    for (const t of ts) assert.equal(v(t, '--mjs-fx-mesh-ox'), '')
  })

  it('*mesh(on: hover) : la dérive est coupée au repos, relancée au survol', async () => {
    const el = await monter('mjs-fx-maille-survol')
    assert.equal(v(el, '--mjs-fx-mesh-go'), 'none')
    el.dispatchEvent(new window.PointerEvent('pointerenter'))
    assert.equal(v(el, '--mjs-fx-mesh-go'), '')
  })

  it('le CSS : taches floues sous le contenu, dérive sur deux axes, rien d\'animé si on réduit les animations', () => {
    const css = window.µ._mjs_fxDefs.mesh.css
    assert.match(css, /\[mjs-fx~="mesh"\]\{isolation:isolate\}/)
    assert.match(css, /filter:blur\(var\(--mjs-mesh-blur,60px\)\)/)
    assert.match(css, /opacity:var\(--mjs-mesh-opacity,1\)/)
    assert.match(css, /@keyframes mjs-fx-mesh-x\{/)
    assert.match(css, /@keyframes mjs-fx-mesh-y\{/)
    assert.match(css, /var\(--mjs-mesh-speed,20s\)/)
    assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{[^@]*animation:none/)
    // ses taches floues qui dérivent coûtent autant que l'ancien *aurora, qui était lourd : suivi par les effets économes, arrêté en économe
    assert.equal(window.µ._mjs_fxDefs.mesh.heavy, true)
  })

  it('posé sur un composant : le calque est dans le shadow de l\'hôte, sous son contenu', async () => {
    const hote = await monter('mjs-fx-maille-carte', '.b')
    const c    = hote._shadow.querySelector('[mjs-fx-layer="mesh"]')
    assert.ok(c, 'calque dans le shadow')
    assert.ok(hote._shadow.firstChild === c, 'le calque est le premier enfant du shadow')
    assert.equal(c.querySelectorAll('i').length, 5)
    assert.equal(c.querySelector('i').getAttribute('style').includes('--mjs-fx-mesh-c'), true)
    assert.equal(v(c, '--mjs-fx-mesh-bg'), '#1a0b1e')
  })

  it('count: 9, count: 1, une palette inconnue, opacity: 2, blur: 300, size: 5 sont refusés à la compilation', async () => {
    await assert.rejects(compiler('<div *mesh(count: 9)>x</div>'), /\*mesh : count = 9 — permis : int 2\.\.8/)
    await assert.rejects(compiler('<div *mesh(count: 1)>x</div>'), /\*mesh : count = 1 — permis : int 2\.\.8/)
    await assert.rejects(compiler('<div *mesh(arc-en-ciel)>x</div>'), /\*mesh : style/)
    await assert.rejects(compiler('<div *mesh(opacity: 2)>x</div>'), /\*mesh : opacity = 2 — permis : float 0\.\.1/)
    await assert.rejects(compiler('<div *mesh(blur: 300)>x</div>'), /\*mesh : blur = 300 — permis : int 0\.\.200/)
    await assert.rejects(compiler('<div *mesh(size: 5)>x</div>'), /\*mesh : size = 5 — permis : int 10\.\.150/)
    await compiler('<div *mesh(forest, count: 8, size: 150, blur: 0)>x</div>')
  })

  it('*mesh sur une image est refusé : l\'effet dessine dans la balise', async () => {
    await assert.rejects(compiler('<img *mesh src="a.png" alt="a">'), /\*mesh[\s\S]*dessine à l'intérieur/)
  })

  it('le retrait de l\'effet enlève le calque, les écouteurs et les variables', async () => {
    const comp = window.document.body.appendChild(window.document.createElement('mjs-fx-maille-retrait'))
    await attendre(() => !!comp._shadow?.querySelector('.a'))
    await pause()
    const el = comp._shadow.querySelector('.a')
    assert.ok(calque(el), 'calque posé')
    comp._shadow.querySelector('.t').click()
    await attendre(() => !comp._shadow.querySelector('.a'))
    await pause(50)
    assertAbsent(el.querySelector('[mjs-fx-layer]'), 'calque resté')
    assert.equal(el.getAttribute('mjs-fx'), null)
    assert.equal(el.getAttribute('style') || '', '')
    el.dispatchEvent(new window.PointerEvent('pointermove', { clientX: 10, clientY: 10 }))
    assert.equal(el.getAttribute('style') || '', '', 'l\'écouteur de la souris est parti')
  })
})
