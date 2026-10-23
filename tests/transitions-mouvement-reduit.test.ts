// « Réduire les animations » demandé par le système : une transition posée sur le cycle de vie
// (`@in=*fly`, `@out=*fade`, `@transition=*slide`, une transition créée par `µanim.create`) ne joue
// pas — la balise entre et sort tout de suite, comme une transition posée directement, qui le
// respectait déjà. happy-dom n'a ni `animate()` ni préférence système : un faux `animate` enregistre
// chaque animation, un faux `matchMedia` dit la préférence.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANTS: Record<string, string> = {
  'calme-vole': '<script>\n$vu = false\n</script>\n{if $vu}<p class="v" @in=*fly(up, distance: 200, duration: 2s) @out=*fade(300ms)>vole</p>{end}',
  'calme-glisse': '<script>\n$vu = false\n</script>\n{if $vu}<p class="s" @transition=*slide(x, duration: 250ms)>glisse</p>{end}',
  'calme-maison': "<script>\nµanim.create 'tourne', css: (t) -> { transform: \"rotate(#{t * 90}deg)\" }\n$vu = false\n</script>\n{if $vu}<p class=\"m\" @in=*tourne(duration: 8s)>maison</p>{end}",
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('transitions du cycle de vie : « réduire les animations » respecté', function () {
  this.timeout(60000)
  let window: any
  let animateAvant: any
  let reduit = true
  const anims: any[] = []

  before(async () => {
    const root   = mjsTmp('transitions-calmes')
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
    animateAvant = window.Element.prototype.animate
    window.Element.prototype.animate = function (keyframes: any, opts: any) {
      let fin: any
      const a: any = {
        el: this, keyframes, opts, currentTime: 0,
        finished: new Promise((r) => { fin = r }),
        effect: { getComputedTiming: () => ({ progress: a.done ? 1 : 0 }) },
        cancel() { a.cancelled = true; fin(a) },
        pause() {}, play() {}, finish() { a.done = true; fin(a) },
      }
      anims.push(a)
      const d = typeof opts === 'number' ? opts : (opts?.duration ?? 0)
      setTimeout(() => { if (!a.cancelled) { a.done = true; fin(a) } }, Math.min(5, d))
      return a
    }
    window.matchMedia = (q: string) => ({ media: q, matches: reduit && /prefers-reduced-motion:\s*reduce/.test(q), addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
    window.eval(`${code}\nglobalThis.µ = µ;`)
  })

  after(async () => {
    if (animateAvant === undefined) delete window?.Element?.prototype?.animate
    else if (window) window.Element.prototype.animate = animateAvant
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  // entrée puis sortie d'une balise ; rend les animations jouées sur elle (hors tenue de départ)
  async function allerRetour(tag: string, sel: string) {
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const comp = window.document.querySelector(tag)
    await attendre(() => !!comp._shadow)
    await new Promise((r) => setTimeout(r, 20))
    anims.length = 0
    comp._set('vu', true)
    await attendre(() => !!comp._shadow.querySelector(sel))
    const el = comp._shadow.querySelector(sel)
    await new Promise((r) => setTimeout(r, 60))
    comp._set('vu', false)
    await attendre(() => !comp._shadow.querySelector(sel))
    const parti = !comp._shadow.querySelector(sel)
    return { parti, jouees: anims.filter((a) => a.el === el && a.keyframes.length > 2).length }
  }

  it('mouvement réduit : @in=*fly, @out=*fade — aucune animation, la balise entre et sort', async () => {
    reduit = true
    const r = await allerRetour('mjs-calme-vole', '.v')
    assert.deepEqual(r, { parti: true, jouees: 0 })
  })

  it('mouvement réduit : @transition=*slide — aucune animation', async () => {
    reduit = true
    const r = await allerRetour('mjs-calme-glisse', '.s')
    assert.deepEqual(r, { parti: true, jouees: 0 })
  })

  it('mouvement réduit : une transition créée par µanim.create — aucune animation', async () => {
    reduit = true
    const r = await allerRetour('mjs-calme-maison', '.m')
    assert.deepEqual(r, { parti: true, jouees: 0 })
  })

  it('sans préférence : les mêmes transitions jouent', async () => {
    reduit = false
    const vole   = await allerRetour('mjs-calme-vole', '.v')
    const glisse = await allerRetour('mjs-calme-glisse', '.s')
    const maison = await allerRetour('mjs-calme-maison', '.m')
    assert.ok(vole.jouees >= 2, 'fly puis fade : ' + vole.jouees)
    assert.ok(glisse.jouees >= 2, 'slide aller et retour : ' + glisse.jouees)
    assert.ok(maison.jouees >= 1, 'transition maison : ' + maison.jouees)
  })
})
