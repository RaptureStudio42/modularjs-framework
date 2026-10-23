// *liquid — l'image qui se tord comme de l'eau : le filtre SVG posé et retiré, les réglages lus, le passage du repos à l'actif, les refus de compilation.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'

const COMPOSANTS: Record<string, string> = {
  'fx-liquide':         '<div class="a" *liquid>x</div>',
  'fx-liquide-regles':  '<div class="a" *liquid(80, rest: 0, frequency: 0.05, octaves: 4, seed: 7, animate: false, duration: 40ms, on: hover)>x</div>',
  'fx-liquide-toujours': '<div class="a" *liquid(60, rest: 0, animate: false, duration: 0ms, on: always)>x</div>',
  'fx-liquide-image':   '<img class="a" *liquid src="a.png" alt="a">',
  'fx-liquide-double':  '<div class="a" *liquid *filter(sepia)>x</div>',
  'fx-liquide-enfant':  '<p class="c">dedans</p>',
  'fx-liquide-compo':   '<@fx-liquide-enfant class="a" *liquid></@fx-liquide-enfant>',
  'fx-liquide-retrait': '<script>\n$on = true\n</script>\n{if $on}<div class="a" *liquid>x</div>{end}\n<button class="t" @click={$on = !$on}>t</button>',
}

const compiler = async (html: string) => (await transpile(html, { moduleName: 'fx-essai' })).output

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms))

describe('effets — *liquid', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('effets-image-liquide')
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
    return comp
  }

  const filtre = (comp: any) => comp._shadow.querySelector('svg[mjs-fx-liquid-svg]')
  const echelle = (comp: any) => parseFloat(filtre(comp).querySelector('feDisplacementMap').getAttribute('scale'))

  it('*liquid : un filtre SVG dans la même racine que la balise, relié à elle ; au repos, 12 % de la force', async () => {
    const comp = await monter('mjs-fx-liquide')
    const el   = comp._shadow.querySelector('.a')
    const svg  = filtre(comp)
    assert.ok(svg, 'le filtre SVG')
    assert.equal(svg.getAttribute('aria-hidden'), 'true')
    const f = svg.querySelector('filter')
    assert.match(f.getAttribute('id'), /^mjs-fx-liquid-\d+$/)
    assert.equal(el.style.getPropertyValue('--mjs-fx-liquid-filter'), `url(#${f.getAttribute('id')})`)
    assert.ok(el.hasAttribute('mjs-fx-liquid-on'), 'le filtre est actif (4,8 px au repos)')
    assert.ok(Math.abs(echelle(comp) - 4.8) < 0.01, `échelle au repos : ${echelle(comp)}`)
    assert.equal(svg.querySelector('feTurbulence').getAttribute('numOctaves'), '2')
    assert.equal(svg.querySelector('feTurbulence').getAttribute('seed'), '2')
    assert.equal(el.children.length, 0, 'rien n\'est ajouté dans la balise')
  })

  it('le CSS : le filtre n\'est posé que pendant la déformation', () => {
    const css = window.µ._mjs_fxDefs.liquid.css
    assert.match(css, /\[mjs-fx-liquid-on\]\{filter:var\(--mjs-fx-liquid-filter,none\)\}/)
  })

  it('*liquid(80, rest: 0, …) : image nette au repos (filtre retiré), puis la force monte au survol et retombe', async () => {
    const comp = await monter('mjs-fx-liquide-regles')
    const el   = comp._shadow.querySelector('.a')
    const f    = filtre(comp)
    assert.ok(!el.hasAttribute('mjs-fx-liquid-on'), 'rien au repos avec rest: 0')
    assert.equal(el.style.getPropertyValue('--mjs-fx-liquid-filter'), '')
    assert.equal(f.querySelector('feTurbulence').getAttribute('numOctaves'), '4')
    assert.equal(f.querySelector('feTurbulence').getAttribute('seed'), '7')
    assert.equal(f.querySelector('feTurbulence').getAttribute('baseFrequency'), '0.05 0.08')
    el.dispatchEvent(new window.Event('pointerenter'))
    await attendre(() => echelle(comp) > 70)
    assert.ok(echelle(comp) > 70 && echelle(comp) <= 80, `échelle au survol : ${echelle(comp)}`)
    assert.ok(el.hasAttribute('mjs-fx-liquid-on'))
    el.dispatchEvent(new window.Event('pointerleave'))
    await attendre(() => !el.hasAttribute('mjs-fx-liquid-on'))
    assert.ok(!el.hasAttribute('mjs-fx-liquid-on'), 'nette de nouveau')
  })

  it('on: always : actif tout de suite, à la force pleine', async () => {
    const comp = await monter('mjs-fx-liquide-toujours')
    const el   = comp._shadow.querySelector('.a')
    await attendre(() => echelle(comp) === 60)
    assert.equal(echelle(comp), 60)
    assert.ok(el.hasAttribute('mjs-fx-liquid-on'))
  })

  it('sur une image : le filtre marche, rien n\'est ajouté dans la balise', async () => {
    const comp = await monter('mjs-fx-liquide-image')
    const el   = comp._shadow.querySelector('.a')
    assert.ok(filtre(comp))
    assert.ok(el.hasAttribute('mjs-fx-liquid-on'))
  })

  it('sur un composant : le filtre est posé sur la balise du composant', async () => {
    const comp = await monter('mjs-fx-liquide-compo')
    const host = comp._shadow.querySelector('.a')
    assert.ok(host, 'le composant enfant')
    assert.ok(host.hasAttribute('mjs-fx-liquid-on'))
    assert.ok(filtre(comp), 'le filtre est dans la racine du parent')
  })

  it('*liquid *filter sur la même balise : un seul avertissement, qui dit de les séparer', async () => {
    const dits: string[] = []
    const avant = window.µ.warn
    window.µ.warn = (m: string) => { dits.push(String(m)) }
    try {
      await monter('mjs-fx-liquide-double')
      await pause(40)
    } finally {
      window.µ.warn = avant
    }
    const mes = dits.filter((m) => m.includes('*liquid'))
    assert.equal(mes.length, 1, dits.join(' | '))
    assert.match(mes[0], /propriété CSS filter/)
    assert.match(mes[0], /balise englobante/)
    assert.match(mes[0], /Posez/)
  })

  it('strength: 500 est refusé, rest: 2 aussi, un réglage inconnu aussi', async () => {
    await assert.rejects(compiler('<div *liquid(strength: 500)>x</div>'), /\*liquid : strength = 500 — permis : int 0\.\.200/)
    await assert.rejects(compiler('<div *liquid(rest: 2)>x</div>'), /\*liquid : rest = 2 — permis : float 0\.\.1/)
    await assert.rejects(compiler('<div *liquid(vagues: 2)>x</div>'), /\*liquid/)
    await compiler('<div *liquid(200, rest: 1, frequency: 0.2, octaves: 5, seed: 999, on: click)>x</div>')
  })

  it('le retrait enlève le filtre, la marque et la variable', async () => {
    const comp = await monter('mjs-fx-liquide-retrait')
    const el   = comp._shadow.querySelector('.a')
    assert.ok(filtre(comp), 'filtre posé')
    comp._shadow.querySelector('.t').click()
    await attendre(() => !comp._shadow.querySelector('.a'))
    await pause(50)
    assertAbsent(comp._shadow.querySelector('svg'), 'svg resté')
    assert.ok(!el.hasAttribute('mjs-fx-liquid-on'))
    assert.equal(el.style.getPropertyValue('--mjs-fx-liquid-filter'), '')
  })
})
