// *chromatic — le décalage rouge et bleu : le filtre SVG posé et retiré, les réglages lus, l'écart qui grandit au survol, les refus de compilation.

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
  'fx-decalage':         '<div class="a" *chromatic>x</div>',
  'fx-decalage-regles':  '<div class="a" *chromatic(0, grow: 20, angle: 0, mode: cmy, duration: 40ms, on: hover)>x</div>',
  'fx-decalage-toujours': '<div class="a" *chromatic(6, grow: 30, duration: 0ms, on: always)>x</div>',
  'fx-decalage-image':   '<img class="a" *chromatic src="a.png" alt="a">',
  'fx-decalage-double':  '<div class="a" *chromatic *liquid>x</div>',
  'fx-decalage-fusion':  '<img class="a" src="a.png" alt="" *filter(grayscale) *chromatic *liquid *blend(multiply, color: #808080)>',
  'fx-decalage-enfant':  '<p class="c">dedans</p>',
  'fx-decalage-compo':   '<@fx-decalage-enfant class="a" *chromatic></@fx-decalage-enfant>',
  'fx-decalage-retrait': '<script>\n$on = true\n</script>\n{if $on}<div class="a" *chromatic>x</div>{end}\n<button class="t" @click={$on = !$on}>t</button>',
}

const compiler = async (html: string) => (await transpile(html, { moduleName: 'fx-essai' })).output

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms))

describe('effets — *chromatic', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('effets-decalage-des-couleurs')
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

  const filtre = (comp: any) => comp._shadow.querySelector('svg[mjs-fx-chromatic-svg]')
  const decalages = (comp: any) => Array.from(filtre(comp).querySelectorAll('feOffset')).map((o: any) => [parseFloat(o.getAttribute('dx')), parseFloat(o.getAttribute('dy'))])

  it('*chromatic : un filtre SVG dans la même racine, un canal par feColorMatrix, mêlés par screen ; écart de 4 px au repos', async () => {
    const comp = await monter('mjs-fx-decalage')
    const el   = comp._shadow.querySelector('.a')
    const svg  = filtre(comp)
    assert.ok(svg, 'le filtre SVG')
    assert.equal(svg.getAttribute('aria-hidden'), 'true')
    const f = svg.querySelector('filter')
    assert.equal(f.querySelectorAll('feColorMatrix').length, 3)
    assert.equal(f.querySelectorAll('feBlend').length, 2)
    assert.equal(f.querySelector('feBlend').getAttribute('mode'), 'screen')
    assert.equal(el.style.getPropertyValue('--mjs-fx-chromatic-filter'), `url(#${f.getAttribute('id')})`)
    assert.ok(el.hasAttribute('mjs-fx-chromatic-on'))
    // rouge à gauche, bleu à droite (angle 90 = horizontal)
    assert.deepEqual(decalages(comp), [[-4, 0], [4, 0]])
    assert.equal(el.children.length, 0, 'rien n\'est ajouté dans la balise')
  })

  it('le CSS : le filtre n\'est posé que pendant le décalage', () => {
    assert.match(window.µ._mjs_fxDefs.chromatic.css, /\[mjs-fx-chromatic-on\]\{filter:var\(--mjs-fx-chromatic-filter,none\)\}/)
  })

  it('*chromatic(0, grow: 20, angle: 0, mode: cmy, …) : rien au repos ; au survol l\'écart passe à 20 px, vers le haut et le bas ; mode cmy en lighten', async () => {
    const comp = await monter('mjs-fx-decalage-regles')
    const el   = comp._shadow.querySelector('.a')
    assert.ok(!el.hasAttribute('mjs-fx-chromatic-on'), 'écart nul : pas de filtre')
    assert.equal(filtre(comp).querySelector('feBlend').getAttribute('mode'), 'lighten')
    el.dispatchEvent(new window.Event('pointerenter'))
    await attendre(() => decalages(comp)[0][1] !== 0 && Math.abs(decalages(comp)[1][1]) > 19)
    const [a, c] = decalages(comp)
    assert.ok(Math.abs(a[0]) < 0.01 && a[1] > 19 && a[1] <= 20, `premier canal : ${a}`)
    assert.ok(Math.abs(c[1] + a[1]) < 0.01, `les deux canaux de part et d'autre : ${a} ${c}`)
    assert.ok(el.hasAttribute('mjs-fx-chromatic-on'))
    el.dispatchEvent(new window.Event('pointerleave'))
    await attendre(() => !el.hasAttribute('mjs-fx-chromatic-on'))
    assert.ok(!el.hasAttribute('mjs-fx-chromatic-on'))
  })

  it('on: always : l\'écart actif tout de suite', async () => {
    const comp = await monter('mjs-fx-decalage-toujours')
    await attendre(() => decalages(comp)[1][0] === 30)
    assert.deepEqual(decalages(comp), [[-30, 0], [30, 0]])
  })

  it('sur une image : le filtre marche', async () => {
    const comp = await monter('mjs-fx-decalage-image')
    assert.ok(filtre(comp))
    assert.ok(comp._shadow.querySelector('.a').hasAttribute('mjs-fx-chromatic-on'))
  })

  it('sur un composant : le filtre est posé sur la balise du composant', async () => {
    const comp = await monter('mjs-fx-decalage-compo')
    assert.ok(comp._shadow.querySelector('.a').hasAttribute('mjs-fx-chromatic-on'))
    assert.ok(filtre(comp))
  })

  it('*chromatic *liquid sur la même balise : un seul avertissement, qui dit de les séparer', async () => {
    const dits: string[] = []
    const avant = window.µ.warn
    window.µ.warn = (m: string) => { dits.push(String(m)) }
    try {
      await monter('mjs-fx-decalage-double')
      await pause(40)
    } finally {
      window.µ.warn = avant
    }
    const mes = dits.filter((m) => m.includes('porte déjà un autre effet à filtre'))
    assert.equal(mes.length, 1, dits.join(' | '))
    assert.match(mes[0], /balise englobante/)
  })

  it('avec *blend sur la même <img>, les filtres se cumulent : aucun avertissement de *chromatic ni de *liquid', async () => {
    const dits: string[] = []
    const avant = window.µ.warn
    window.µ.warn = (m: string) => { dits.push(String(m)) }
    try {
      await monter('mjs-fx-decalage-fusion')
      await pause(40)
    } finally {
      window.µ.warn = avant
    }
    assert.deepEqual(dits.filter((m) => m.includes('porte déjà un autre effet à filtre')), [])
  })

  it('gap: 90 est refusé, mode: lab aussi, un réglage inconnu aussi', async () => {
    await assert.rejects(compiler('<div *chromatic(gap: 90)>x</div>'), /\*chromatic : gap = 90 — permis : float 0\.\.40/)
    await assert.rejects(compiler('<div *chromatic(mode: lab)>x</div>'), /\*chromatic : mode = lab — permis/)
    await assert.rejects(compiler('<div *chromatic(bruit: 2)>x</div>'), /\*chromatic/)
    await compiler('<div *chromatic(40, grow: 80, angle: 45, mode: cmy, animate: true, speed: 1s, duration: 100ms, on: click)>x</div>')
  })

  it('le retrait enlève le filtre, la marque et la variable', async () => {
    const comp = await monter('mjs-fx-decalage-retrait')
    const el   = comp._shadow.querySelector('.a')
    assert.ok(filtre(comp), 'filtre posé')
    comp._shadow.querySelector('.t').click()
    await attendre(() => !comp._shadow.querySelector('.a'))
    await pause(50)
    assertAbsent(comp._shadow.querySelector('svg'), 'svg resté')
    assert.ok(!el.hasAttribute('mjs-fx-chromatic-on'))
    assert.equal(el.style.getPropertyValue('--mjs-fx-chromatic-filter'), '')
  })
})
