// Effets de l'appli — un fichier `*.effects.mjs`, bloc <effects> : un effet de la bibliothèque réglé
// une fois pour toutes (`*titre = *scramble(20, on: click)`, réglages de la pose par-dessus, chaînes
// d'effets réglés), ou un effet CSS à soi (`*halo(color: #0ff) =` puis ses déclarations, `$réglage`,
// `@keyframes`) ; posés sur une balise ou sur son cycle de vie (`@in=*entree`, `@out=*halo`). Chaque
// faute arrête le build avec la raison.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'

const EFFETS = [
  '<effects>',
  '  *titre = *scramble(20, on: click, order: left)',
  '  *entree = *fly(up, distance: 30px, duration: 250ms)',
  '  *titre-lent = *titre(speed: 80)',
  '  *halo(color: #0ff, size: 12px) =',
  '    box-shadow: 0 0 $size $color',
  '  *battement(scale: 1.2) =',
  '    @keyframes',
  '      50%',
  '        transform: scale($scale)',
  '</effects>',
].join('\n')

const COMPOSANTS: Record<string, string> = {
  'fx-alias': '<p class="a" *titre>ABC</p>\n<p class="b" *titre(on: load)>DEF</p>\n<p class="c" *titre-lent>GHI</p>',
  'fx-css': '<button class="h" *halo(#f0f, on: hover)>H</button>\n<span class="bt" *battement>♥</span>',
  'fx-vie': '<script>\n$vu = false\n</script>\n{if $vu}<p class="v" @in=*entree @out=*halo(size: 20px)>V</p>{end}',
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
  for (const [f, src] of Object.entries(fichiers)) writeFileSync(join(srcDir, f), src)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  await bundler.close()
  return { stats, outDir }
}

describe('effets de l\'appli : le fichier *.effects.mjs', function () {
  this.timeout(60000)
  let window: any
  let animateAvant: any
  const anims: any[] = []

  before(async () => {
    const fichiers: Record<string, string> = { 'app.effects.mjs': EFFETS }
    for (const [nom, src] of Object.entries(COMPOSANTS)) fichiers[nom + '.mjs'] = src
    const { stats, outDir } = await construire('effets-fichier', fichiers)
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    animateAvant = window.Element.prototype.animate
    window.Element.prototype.animate = function (keyframes: any, opts: any) {
      let fin: any
      const a: any = { el: this, keyframes, opts, finished: new Promise((r) => { fin = r }), effect: { getComputedTiming: () => ({ progress: 1 }) }, cancel() { fin(a) }, pause() {}, play() {} }
      anims.push(a)
      setTimeout(() => fin(a), 5)
      return a
    }
    window.eval(`${code}\nglobalThis.µ = µ;`)
  })

  after(async () => {
    // happy-dom partage la classe Element entre ses fenêtres : rendre `animate` aux fichiers suivants
    if (animateAvant === undefined) delete window.Element.prototype.animate
    else window.Element.prototype.animate = animateAvant
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  async function monter(tag: string, sel?: string) {
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const comp = window.document.querySelector(tag)
    await attendre(() => !!comp._shadow && (!sel || !!comp._shadow.querySelector(sel)))
    await new Promise((r) => setTimeout(r, 20))
    return comp
  }

  it('un effet réglé : c\'est l\'effet de la bibliothèque qui se pose, avec ses réglages ; ceux de la pose l\'emportent', async () => {
    const comp = await monter('mjs-fx-alias', '.c')
    const a = comp._shadow.querySelector('.a')
    assert.equal(a.getAttribute('mjs-fx'), 'scramble')
    assert.deepEqual({ ...a._mjs_fxOff.scramble._s }, { speed: 20, on: 'click', order: 'left' })
    assert.equal(comp._shadow.querySelector('.b')._mjs_fxOff.scramble._s.on, 'load')
    assert.deepEqual({ ...comp._shadow.querySelector('.c')._mjs_fxOff.scramble._s }, { speed: 80, on: 'click', order: 'left' }, 'un effet réglé d\'un effet réglé')
  })

  it('un effet CSS : sa feuille (réglages en variables, repliées sur leur défaut), son état au survol ; @keyframes en fait une animation', async () => {
    const comp = await monter('mjs-fx-css', '.bt')
    const h = comp._shadow.querySelector('.h')
    assert.equal(h.getAttribute('mjs-fx'), 'halo')
    assert.equal(h.style.getPropertyValue('--mjs-halo-color'), '#f0f')
    const regles = comp._shadow.adoptedStyleSheets.flatMap((f: any) => [...f.cssRules].map((r: any) => r.cssText)).join('\n')
    assert.match(regles, /mjs-fx-on~="halo"/)
    assert.match(regles, /box-shadow:\s*0 0 var\(--mjs-halo-size,\s*12px\) var\(--mjs-halo-color,\s*#0ff\)/)
    assert.match(regles, /mjs-fx-battement/)
    assert.equal(h.getAttribute('mjs-fx-on'), null, 'éteint au repos')
    h.dispatchEvent(new window.PointerEvent('pointerenter', { bubbles: true }))
    assert.equal(h.getAttribute('mjs-fx-on'), 'halo')
  })

  it('sur le cycle de vie : @in=*entree (un *fly réglé), @out=*halo (l\'effet CSS est l\'état de sortie)', async () => {
    const c = await monter('mjs-fx-vie')
    c._set('vu', true)
    await attendre(() => !!c._shadow.querySelector('.v') && anims.some((a) => a.el === c._shadow.querySelector('.v') && a.keyframes.length > 2))
    const v = c._shadow.querySelector('.v')
    const entree = anims.find((a) => a.el === v && a.keyframes.length > 2)
    assert.equal(entree.opts.duration, 250)
    assert.match(String(entree.keyframes[0].transform), /translate\(0px, 30px\)/)
    c._set('vu', false)
    await attendre(() => anims.some((a) => a.el === v && a.keyframes.length === 1))
    const sortie = anims.find((a) => a.el === v && a.keyframes.length === 1)
    assert.equal(sortie.keyframes[0].offset, 1)
    assert.equal(sortie.keyframes[0].boxShadow, '0 0 20px #0ff')
    await attendre(() => !c._shadow.querySelector('.v'))
    assertAbsent(c._shadow.querySelector('.v'), 'la balise sortie est retirée')
  })

  it('un effet réglé de *shared sans sa clé : la clé se donne à la pose ; sans elle, refusé', async () => {
    const ok = await construire('effets-fichier-partage', { 'a.effects.mjs': '<effects>\n  *photo = *shared(group: photo)\n  *une = *shared(42)\n</effects>', 'comp.mjs': '<script>\n$p = { id: 7 }\n</script>\n<img src="a.png" alt="" *photo($p.id)>\n<img src="b.png" alt="" *une>' })
    assert.equal(ok.stats.errors.length, 0, ok.stats.errors.map((e: any) => e.message).join('\n'))
    const ko = await construire('effets-fichier-partage-sans', { 'a.effects.mjs': '<effects>\n  *photo = *shared(group: photo)\n</effects>', 'comp.mjs': '<img src="a.png" alt="" *photo>' })
    assert.match(ko.stats.errors.map((e: any) => e.message).join('\n'), /\*photo \(ligne 1\) : la clé manque — \*photo\(p\.id\)/)
  })

  it('refusé au build, avec la raison', async () => {
    const cas: Array<[Record<string, string>, RegExp]> = [
      [{ 'a.effects.mjs': '<effects>\n  *neon = *fade\n</effects>' }, /\*neon est déjà un effet de la bibliothèque/],
      [{ 'a.effects.mjs': '<effects>\n  *x = *inconnu\n</effects>' }, /\*x = \*inconnu — \*inconnu n'est ni/],
      [{ 'a.effects.mjs': '<effects>\n  *y(a: 1px) =\n    width: $b\n</effects>' }, /\$b n'est pas un réglage/],
      [{ 'a.effects.mjs': '<effects>\n  *z = *fade(duration: $d)\n</effects>' }, /une valeur fixe seulement/],
      [{ 'a.effects.mjs': '<effects>\n  *a = *b\n  *b = *a\n</effects>' }, /en rond/],
      [{ 'a.effects.mjs': '<effects>\n  *t = *fade\n</effects>', 'b.effects.mjs': '<effects>\n  *t = *fly\n</effects>' }, /\*t est défini deux fois/],
      [{ 'a.effects.mjs': '<effects>\n  *h(on: hover) =\n    color: red\n</effects>' }, /« on » est un réglage que tout effet a déjà/],
      [{ 'a.effects.mjs': '<effects>\n  *t = *fade\n</effects>\n<p>x</p>' }, /ne contient que son bloc <effects>/],
      [{ 'comp.mjs': '<effects>\n  *t = *fade\n</effects>\n<p>x</p>' }, /un bloc <effects> dans un composant/],
      [{ 'a.effects.mjs': '<effects>\n  *titre = *scramble(20)\n</effects>', 'comp.mjs': '<p *titre(vitesse: 3)>x</p>' }, /réglage « vitesse » inconnu/],
    ]
    for (const [fichiers, attendu] of cas) {
      const { stats } = await construire('effets-fichier-refus', fichiers)
      const msgs = stats.errors.map((e: any) => e.message).join('\n')
      assert.match(msgs, attendu, JSON.stringify(fichiers))
    }
  })
})
