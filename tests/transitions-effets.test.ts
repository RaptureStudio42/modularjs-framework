// Transitions = effets : `@in=*fly(…)`, `@out=*fade`, `@transition=*slide` déclenchent un effet sur le
// cycle de vie de la balise (son entrée, sa sortie, par un {if}/{for}/{key}) ; posé directement,
// un effet de transition se joue à l'arrivée à l'écran (`on: view`), suit le défilement
// (`on: scroll`) ou se joue dès l'apparition (`on: load`). Les réglages s'écrivent comme ceux de
// tout effet (durées `2s`, directions en mots ou en angles), vérifiés à la compilation ; l'ancienne
// écriture (`@in.fly={ y: 200 }`) est refusée avec la nouvelle. happy-dom n'a ni `animate()` ni
// d'intersection réelle : un faux `animate` enregistre chaque animation, un faux observateur dit
// quand la balise entre à l'écran.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'

const COMPOSANTS: Record<string, string> = {
  'tx-vole': '<script>\n$vu = false\n</script>\n{if $vu}<p class="v" @in=*fly(up, distance: 200, duration: 2s) @out=*fade(300ms)>vole</p>{end}',
  'tx-sym': '<script>\n$vu = false\n</script>\n{if $vu}<p class="s" @transition.global=*slide(x, duration: 250ms)>glisse</p>{end}',
  'tx-jeu': '<script>\n$vu = false\n</script>\n{if $vu}<p class="j" @in=*scramble(speed: 10) @out=*scramble(speed: 40)>ABC</p>{end}',
  'tx-vue': '<p class="w" *fade(600ms, on: view)>vue</p>\n<p class="l" *scale(.5, on: load, origin: top-left)>charge</p>',
  'tx-defile': '<p class="d" *iris(on: scroll, range: 0 1000px)>défile</p>',
  'tx-liste': "<script>\n$items = [{ id: 1, nom: 'a' }, { id: 2, nom: 'b' }]\n</script>\n<ul>{for item in $items by id}<li @transition=*crossfade(key: item.id)>{item.nom}</li>{end}</ul>",
  'tx-maison': "<script>\nµanim.create 'tourne', css: (t) -> { transform: \"rotate(#{t * 90}deg)\" }\n$vu = false\n</script>\n{if $vu}<p class=\"m\" @in=*tourne(duration: 8s)>maison</p>{end}",
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

async function construire(nom: string, fichiers: Record<string, string>) {
  const root   = mjsTmp(nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [f, src] of Object.entries(fichiers)) writeFileSync(join(srcDir, f + '.mjs'), src)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  await bundler.close()
  return { stats, outDir }
}

describe('transitions = effets : @in=*…, @out=*…, @transition=*…', function () {
  this.timeout(60000)
  let window: any
  let animateAvant: any
  // chaque animation lancée : la balise, ses images clés, ses options ; finie au bout de sa durée
  // (réduite à 5 ms), en pause si on la met en pause
  const anims: any[] = []
  // les observateurs d'intersection posés : on les déclenche à la main
  const vus: any[] = []

  before(async () => {
    const { stats, outDir } = await construire('transitions-effets', COMPOSANTS)
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    // le cœur d'abord, puis les animations, puis les composants
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    animateAvant = window.Element.prototype.animate
    window.Element.prototype.animate = function (keyframes: any, opts: any) {
      let fin: any
      const a: any = {
        el: this, keyframes, opts, paused: false, currentTime: 0, playState: 'running',
        finished: new Promise((r) => { fin = r }),
        effect: { getComputedTiming: () => ({ progress: a.done ? 1 : 0 }) },
        cancel() { a.cancelled = true; fin(a) },
        pause() { a.paused = true; a.playState = 'paused' },
        play() { a.paused = false },
        finish() { a.done = true; fin(a) },
      }
      anims.push(a)
      const d = typeof opts === 'number' ? opts : (opts?.duration ?? 0)
      setTimeout(() => { if (!a.paused && !a.cancelled) { a.done = true; fin(a) } }, Math.min(5, d))
      return a
    }
    window.IntersectionObserver = class {
      cb: any; els: any[] = []
      constructor(cb: any) { this.cb = cb; vus.push(this) }
      observe(el: any) { this.els.push(el) }
      unobserve() {}
      disconnect() { this.els = [] }
      entre(oui = true) { this.cb(this.els.map((el: any) => ({ target: el, isIntersecting: oui, intersectionRatio: oui ? 1 : 0 }))) }
    }
    window.eval(`${code}\nglobalThis.µ = µ;`)
  })

  after(async () => {
    if (animateAvant === undefined) delete window?.Element?.prototype?.animate
    else if (window) window.Element.prototype.animate = animateAvant
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  async function monter(tag: string) {
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const comp = window.document.querySelector(tag)
    await attendre(() => !!comp._shadow)
    await new Promise((r) => setTimeout(r, 20))
    return comp
  }

  const de = (el: any) => anims.filter((a) => a.el === el && a.keyframes.length > 2)

  it('@in=*fly(up, distance: 200, duration: 2s) : la balise entre en montant de 200 px, en 2 s', async () => {
    const comp = await monter('mjs-tx-vole')
    comp._set('vu', true)
    await attendre(() => !!comp._shadow.querySelector('.v') && de(comp._shadow.querySelector('.v')).length > 0)
    const a = de(comp._shadow.querySelector('.v'))[0]
    assert.ok(a, 'une animation d\'entrée')
    assert.equal(a.opts.duration, 2000)
    assert.match(String(a.keyframes[0].transform), /translate\(0px, 200px\)/)
    assert.equal(Number(a.keyframes[0].opacity), 0)
  })

  it('@out=*fade(300ms) : la balise reste le temps de son fondu, puis s\'en va', async () => {
    const comp = await monter('mjs-tx-vole')
    comp._set('vu', true)
    await attendre(() => !!comp._shadow.querySelector('.v'))
    const v = comp._shadow.querySelector('.v')
    // la balise ne se referme qu'une fois entrée : son vol (2 s, réduit à 5 ms par le faux `animate`) est fini.
    // Refermée avant que l'entrée soit lancée, elle part tout de suite sans jouer son fondu, et le test attendrait
    // en vain : on attend l'état, jamais une durée
    await attendre(() => de(v).some((a) => a.opts.duration === 2000 && a.done), 10000)
    assert.ok(de(v).some((a) => a.opts.duration === 2000 && a.done), 'l\'entrée est finie avant de refermer')
    comp._set('vu', false)
    // attente large : sous la charge de la suite complète, le fondu a déjà mis plus de 3 s à partir
    await attendre(() => de(v).some((a) => a.opts.duration === 300), 10000)
    const sortie = de(v).find((a) => a.opts.duration === 300)
    assert.ok(sortie, 'un fondu de sortie de 300 ms')
    assert.equal(Number(sortie.keyframes[0].opacity), 1)
    assert.equal(Number(sortie.keyframes[sortie.keyframes.length - 1].opacity), 0)
    await attendre(() => !comp._shadow.querySelector('.v'), 10000)
    assertAbsent(comp._shadow.querySelector('.v'), 'la balise sortie est retirée')
  })

  it('@transition.global=*slide(x) : le modificateur .global se pose sur la directive, l\'effet joue', async () => {
    const comp = await monter('mjs-tx-sym')
    comp._set('vu', true)
    await attendre(() => !!comp._shadow.querySelector('.s') && de(comp._shadow.querySelector('.s')).length > 0)
    const a = de(comp._shadow.querySelector('.s'))[0]
    assert.equal(a.opts.duration, 250)
    assert.ok('width' in a.keyframes[0], 'slide(x) anime la largeur')
  })

  it('@in=*scramble : un effet qui se joue, joué à l\'entrée de la balise', async () => {
    const comp = await monter('mjs-tx-jeu')
    comp._set('vu', true)
    await attendre(() => !!comp._shadow.querySelector('.j[mjs-fx~="scramble"]'))
    assert.ok(comp._shadow.querySelector('.j[mjs-fx~="scramble"]'))
  })

  it('@out=*scramble(speed: 40) : la balise reste le temps du brouillage (5 lettres × 40 ms), puis s\'en va', async () => {
    const comp = await monter('mjs-tx-jeu')
    comp._set('vu', true)
    await attendre(() => !!comp._shadow.querySelector('.j'))
    await new Promise((r) => setTimeout(r, 30))
    const t0 = Date.now()
    comp._set('vu', false)
    await attendre(() => !comp._shadow.querySelector('.j'), 3000)
    const d = Date.now() - t0
    assertAbsent(comp._shadow.querySelector('.j'), 'la balise sortie est retirée')
    assert.ok(d >= 150, `partie après ${d} ms, avant la fin du brouillage`)
  })

  it('*fade(on: view) : cachée tant qu\'elle n\'est pas à l\'écran, puis fondue ; *scale(on: load) : tout de suite, depuis son coin', async () => {
    const avant = vus.length
    const comp = await monter('mjs-tx-vue')
    const w = comp._shadow.querySelector('.w')
    const tenue = anims.find((a) => a.el === w)
    assert.ok(tenue, 'la balise est tenue dans son état de départ')
    assert.equal(Number(tenue.keyframes[0].opacity), 0)
    assert.equal(de(w).length, 0, 'rien ne joue avant l\'arrivée à l\'écran')
    const io = vus.slice(avant).find((o: any) => o.els.includes(w))
    io.entre(true)
    await attendre(() => de(w).length > 0)
    assert.equal(de(w)[0].opts.duration, 600)
    const l = comp._shadow.querySelector('.l')
    await attendre(() => de(l).length > 0)
    assert.equal(de(l)[0].keyframes[0].transformOrigin, '0% 0%')
  })

  it('*iris(on: scroll, range: 0 1000px) : l\'animation suit le défilement de la page', async () => {
    const comp = await monter('mjs-tx-defile')
    const d = comp._shadow.querySelector('.d')
    await attendre(() => de(d).length > 0)
    const a = de(d)[0]
    assert.ok(a.paused, 'en pause : le défilement la pilote')
    Object.defineProperty(window, 'scrollY', { value: 500, configurable: true })
    window.dispatchEvent(new window.Event('scroll'))
    await attendre(() => a.currentTime > 0)
    assert.equal(Math.round(a.currentTime / a.opts.duration * 100), 50)
  })

  it('*crossfade(key: item.id) : une variable de la boucle comme réglage', async () => {
    const comp = await monter('mjs-tx-liste')
    assert.equal(comp._shadow.querySelectorAll('li').length, 2)
  })

  it('@in=*tourne : une transition créée par µanim.create, avec ses réglages', async () => {
    const comp = await monter('mjs-tx-maison')
    comp._set('vu', true)
    await attendre(() => !!comp._shadow.querySelector('.m') && de(comp._shadow.querySelector('.m')).length > 0)
    const a = de(comp._shadow.querySelector('.m'))[0]
    assert.equal(a.opts.duration, 8000)
    assert.match(String(a.keyframes[a.keyframes.length - 1].transform), /rotate\(90deg\)/)
  })

  it('refusé à la compilation, avec la bonne écriture : l\'ancienne forme, un effet continu, un déclencheur dans @in, une faute de nom', async () => {
    const cas: Array<[string, RegExp]> = [
      ['{if $x}<p @in.fly={ y: 200 }>x</p>{end}', /@in\.fly[\s\S]*@in=\*fly/],
      ['{if $x}<p @transition.fade>x</p>{end}', /@transition\.fade[\s\S]*@transition=\*fade/],
      ['{if $x}<p @in=*neon>x</p>{end}', /@in=\*neon[\s\S]*continu/],
      ['{if $x}<p @in=*fade(on: view)>x</p>{end}', /on[\s\S]*@in/],
      ['{if $x}<p @in=*fdae>x</p>{end}', /\*fade/],
      ['<p *crossfade(key: 1)>x</p>', /\*crossfade[\s\S]*@transition/],
    ]
    for (const [src, attendu] of cas) {
      const { stats } = await construire('transitions-refus', { 'tx-refus': '<script>\n$x = true\n</script>\n' + src })
      const msgs = stats.errors.map((e: any) => e.message).join('\n')
      assert.match(msgs, attendu, src)
    }
  })
})
