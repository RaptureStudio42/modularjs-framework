// les préréglages qui remplacent les effets fondus rendent l'ancien effet par défaut : *mesh.aurora (une image deux fois plus grande
// que la balise, aux taches rondes, qui glisse d'un bord à l'autre sous un flou de 40 px), *shine.shimmer (le reflet dans les lettres,
// en boucle, le texte gris), *attention.wiggle (le balancement autour du centre, en boucle pendant le survol). Le pixel près est vérifié
// au navigateur ; ici, ce qui le fait : les réglages émis, les valeurs posées, les images clés.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANTS: Record<string, string> = {
  'fx-pre-aurore':   '<div class="a" *mesh.aurora>x</div>',
  'fx-pre-reflet':   '<p class="a" *shine.shimmer>Chargement</p>',
  'fx-pre-cloche':   '<button class="a" *attention.wiggle>c</button>',
  'fx-pre-boucle':   '<button class="a" *attention(style: wiggle, duration: 40ms, every: 40ms, on: hover)>c</button>',
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms))

describe('préréglages des effets fondus : le rendu de l\'ancien effet', function () {
  this.timeout(60000)
  let window: any
  let bundle = ''

  before(async () => {
    const root   = mjsTmp('effets-fusionnes-prereglages')
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
    bundle = code
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  async function monter(tag: string) {
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const comp = window.document.querySelector(tag)
    await attendre(() => !!comp._shadow?.querySelector('.a'))
    await pause()
    return comp._shadow.querySelector('.a')
  }

  it('les réglages émis : ceux de l\'ancien effet par défaut', () => {
    assert.ok(bundle.includes('"mesh", {"drift":"sweep","colors":["#8a2be2","#4682b4"],"background":"transparent","size":30,"opacity":0.6,"blur":40}'))
    assert.ok(bundle.includes('"shine", {"where":"text","color":"#fff","direction":100,"width":50,"duration":"2.2s","on":"always","every":"2.2s"}'))
    assert.ok(bundle.includes('"attention", {"style":"wiggle","duration":"500ms","on":"hover","every":"1.5s"}'))
  })

  it('*mesh.aurora : deux taches rondes à 10 % 20 % et 90 % 80 %, effacées à 30 %, sous un flou de 40 px, sans fond ni tache qui dérive', async () => {
    const el    = await monter('mjs-fx-pre-aurore')
    const layer = el.querySelector('[mjs-fx-layer="mesh"]')
    const field = layer.querySelector('u')
    assert.ok(layer.hasAttribute('mjs-fx-mesh-sweep'))
    assert.equal(layer.querySelectorAll('i').length, 0, 'aucune tache qui dérive seule')
    assert.equal(field.style.getPropertyValue('--mjs-fx-mesh-sweep'), 'radial-gradient(circle at 10% 20%,#8a2be2,transparent var(--mjs-mesh-size,60%)),radial-gradient(circle at 90% 80%,#4682b4,transparent var(--mjs-mesh-size,60%))')
    assert.equal(el.style.getPropertyValue('--mjs-mesh-size'), '30%')
    assert.equal(el.style.getPropertyValue('--mjs-mesh-blur'), '40px')
    assert.equal(el.style.getPropertyValue('--mjs-mesh-opacity'), '0.6')
    assert.equal(el.style.getPropertyValue('--mjs-mesh-background'), 'transparent')
    const css = window.µ._mjs_fxDefs.mesh.css
    assert.ok(css.includes('@keyframes mjs-fx-mesh-sweep{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}'))
    assert.ok(css.includes('[mjs-fx-layer="mesh"][mjs-fx-mesh-sweep] u{inset:0;background:var(--mjs-fx-mesh-sweep);background-size:200% 200%;filter:blur(var(--mjs-mesh-blur,60px));clip-path:inset(0 round var(--mjs-fx-mesh-r,0));animation:var(--mjs-fx-mesh-go,mjs-fx-mesh-sweep) var(--mjs-mesh-speed,20s) linear 0s'))
  })

  it('*shine.shimmer : le reflet dans les lettres, de 148,5 % 67,4 % à -48,5 % 32,6 %, la bande de 40 % à 60 % de l\'image, en boucle', async () => {
    const el = await monter('mjs-fx-pre-reflet')
    assert.ok(el.hasAttribute('mjs-fx-shine-text'))
    assert.equal(el.style.getPropertyValue('--mjs-fx-shine-a'), '100deg')
    assert.equal(el.style.getPropertyValue('--mjs-fx-shine-from'), '148.5% 67.4%')
    assert.equal(el.style.getPropertyValue('--mjs-fx-shine-to'), '-48.5% 32.6%')
    assert.equal(el.style.getPropertyValue('--mjs-shine-width'), '50%')
    assert.equal(el.style.getPropertyValue('--mjs-shine-duration'), '2.2s')
    assert.equal(el.style.getPropertyValue('--mjs-shine-color'), '#fff')
    assert.equal(el.style.getPropertyValue('position'), '', 'la balise ne change pas de place')
    assert.ok((el.getAttribute('mjs-fx-play') ?? '').split(' ').includes('shine'), 'le premier passage part tout de suite')
    const css = window.µ._mjs_fxDefs.shine.css
    assert.ok(css.includes('transparent calc(50% - var(--mjs-shine-width,30%) / 5)'))
    assert.ok(css.includes('linear-gradient(var(--mjs-shine-ink,#6e7681),var(--mjs-shine-ink,#6e7681));background-repeat:no-repeat;background-size:250% 250%,100% 100%'))
    assert.ok(css.includes('{animation:mjs-fx-shine-text var(--mjs-shine-duration,700ms) linear both}'))
  })

  it('*attention.wiggle : les images clés du balancement, au repos tant que la souris n\'est pas dessus, coupé quand elle sort', async () => {
    const el = await monter('mjs-fx-pre-cloche')
    assert.equal(el.getAttribute('mjs-fx-attention-style'), 'wiggle')
    assert.ok(window.µ._mjs_fxDefs.attention.css.includes('@keyframes mjs-fx-attention-wiggle{0%{transform:none}24%{transform:rotate(calc(-1 * var(--mjs-attention-angle,12deg)))}48%{transform:rotate(calc(.8 * var(--mjs-attention-angle,12deg)))}72%{transform:rotate(calc(-.5 * var(--mjs-attention-angle,12deg)))}100%{transform:rotate(0)}}'))
    const joue = () => (el.getAttribute('mjs-fx-play') ?? '').split(' ').includes('attention')
    assert.equal(joue(), false, 'au repos')
    el.dispatchEvent(new window.PointerEvent('pointerenter'))
    assert.equal(joue(), true, 'la souris arrive : il se balance')
    el.dispatchEvent(new window.PointerEvent('pointerleave'))
    assert.equal(joue(), false, 'elle sort : la balise revient au repos')
  })

  it('*attention(on: hover, every) : l\'appel se répète pendant le survol, puis s\'arrête', async () => {
    const el = await monter('mjs-fx-pre-boucle')
    let poses = 0
    const mo = new window.MutationObserver(() => { if ((el.getAttribute('mjs-fx-play') ?? '').includes('attention')) poses++ })
    mo.observe(el, { attributes: true, attributeFilter: ['mjs-fx-play'] })
    el.dispatchEvent(new window.PointerEvent('pointerenter'))
    await attendre(() => poses >= 3, 2000)
    assert.ok(poses >= 3, 'rejoué pendant le survol : ' + poses)
    el.dispatchEvent(new window.PointerEvent('pointerleave'))
    await pause(30)
    const fin = poses
    await pause(200)
    assert.equal(poses, fin, 'la souris partie, plus aucun appel')
    mo.disconnect()
  })
})
