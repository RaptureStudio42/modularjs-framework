// les préréglages livrés retirés avant la 3.0 (trop proches d'un voisin, ou d'un seul réglage) et les styles retirés de *loader donnent
// leur remplaçant, comme les effets fondus : `*focus.blur_others` → `*focus`, `*loader(arc)` → `style: neon`, `*peel.bottom_left` →
// `*peel(corner: bottom-left)`. La palette `aurora` de *mesh s'appelle maintenant `boreal`, et `*mesh.aurora` est l'ancien effet *aurora,
// pas cette palette : le message le dit. Chaque écriture proposée se compile.

import assert from 'node:assert/strict'
import { parseEffect, setProjectEffects } from '../src/effects/catalog.js'
import { resolveProjectEffects, parseEffectsBlock } from '../src/effects/project.js'
import { transpile } from '../src/transpiler/index.js'
import { setMessagesLang } from '../src/messages/index.js'

const RETIRES: Array<[string, string]> = [
  ['focus.blur_others', '*focus'],
  ['physics.soft_fall', '*physics'],
  ['physics.bouncy_fall', '*physics(mode: fall, bounce: .65, friction: .2)'],
  ['behind.soft_depth', '*behind(depth: 14)'],
  ['velocity.skew', '*velocity(style: skew, max: 9)'],
  ['parallax.forest', '*parallax(origin: page, speed: .5, smooth: .08)'],
  ['tilt.slow_follow', '*tilt(follow: 250ms)'],
  ['pointer.disc', '*pointer(style: disc, color: #fff, size: 64, blend: difference, grow: 2)'],
  ['pointer.sharp_circle', '*pointer(style: lens, outside: true, filter: blur, size: 200, grow: 1.25)'],
  ['sticky.floating_bar', '*sticky(top: 12)'],
  ['backlight.vivid_glow', '*backlight(blur: 40, opacity: .7, saturate: 2, size: 1.15)'],
  ['loader.arc', '*loader(style: neon)'],
  ['loader.swirl', '*loader(style: galaxy)'],
  ['fly.button_veil', '*fly(on: hover, direction: up, distance: 30, duration: 300ms, delay: 80ms)'],
  ['sprite.pixel_six_frames', '*sprite(frames: 6, speed: 800ms, pixel: true)'],
  ['sprite.grid_eight_frames', '*sprite(frames: 8, columns: 4, speed: 900ms)'],
  ['fluid.pure_black', '*fluid(background: #000)'],
  ['pixelate.sharpen', '*pixelate(on: view, duration: 2000ms, easing: linear)'],
  ['gallery.coverflow', '*gallery(style: coverflow, on: scroll, loop: true)'],
  ['spotlight.blue_veil', '*spotlight(where: veil, color: #0a1a3a, fill: .8, size: 120, soft: 240, on: always, smooth: .3)'],
  ['lift.purple_glow', '*lift(color: rgba(192,96,255,.95), blur: 48)'],
  ['travel.path', '*travel(zone: 40% 65%)'],
  ['peel.bottom_left', '*peel(corner: bottom-left)'],
]

const erreur = (nom: string, raw = ''): string => {
  try {
    parseEffect(nom, raw)
  }
  catch (e) {
    return (e as Error).message
  }
  return ''
}

describe('préréglages et styles retirés : le message donne le remplaçant', () => {
  before(() => setProjectEffects(resolveProjectEffects([])))
  after(() => setProjectEffects({}))
  afterEach(() => setMessagesLang('fr'))

  for (const [nom, ecriture] of RETIRES) {
    it(`*${nom} → ${ecriture}, qui se compile`, () => {
      const m = erreur(nom)
      assert.ok(m.includes(`*${nom} : aucun alias de ce nom pour *${nom.split('.')[0]} — il a été retiré de la bibliothèque : écrivez à la place ${ecriture}.`), m)
      const e = /^\*([\w]+)(?:\(([\s\S]*)\))?$/.exec(ecriture)!
      // un préréglage ne porte pas la cible propre à une page (`to` de *travel) : elle s'écrit à la pose
      assert.doesNotThrow(() => parseEffect(e[1], e[2] ?? '', [], true), ecriture)
      // la même écriture, cible d'un effet du fichier d'effets
      const problems: Error[] = []
      resolveProjectEffects([parseEffectsBlock('*titre = ' + ecriture, 1, '/x/app.effects.mjs', problems)], () => {}, problems)
      assert.deepEqual(problems.map(p => p.message), [], ecriture)
    })
  }

  it('*loader(arc) et *loader(swirl) : le style qui fait le même dessin, et les styles permis', () => {
    for (const [ancien, nouveau] of [['arc', 'neon'], ['swirl', 'galaxy']]) {
      for (const raw of [ancien, 'style: ' + ancien]) {
        const m = erreur('loader', raw)
        assert.ok(m.includes(`*loader : style = ${ancien} n'existe plus — écrivez style: ${nouveau} (le même dessin)`), m)
        assert.match(m, /permis : 'dots' \| 'steps'/)
      }
    }
  })

  it('*mesh(aurora) : la palette s\'appelle boreal, et *mesh.aurora est l\'ancien effet *aurora', () => {
    const m = erreur('mesh', 'aurora')
    assert.ok(m.includes('*mesh : style = aurora n\'existe plus — écrivez style: boreal'), m)
    assert.match(m, /la palette aurora s'appelle maintenant boreal/)
    assert.match(m, /\*mesh\.aurora est l'ancien effet \*aurora, pas cette palette/)
    assert.equal(parseEffect('mesh', 'style: boreal').fixed.style, 'boreal')
  })

  it('sur une balise, et sur <@document> : le même message', async () => {
    await assert.rejects(transpile('<div *focus.blur_others>x</div>', { moduleName: 'retire-balise' }), /écrivez à la place \*focus\./)
    const { data } = await transpile('<@document *loader.arc></@document>\n<p>x</p>\n', { moduleName: 'retire-doc' })
    assert.ok(data.macroErrors.some((e: string) => e.includes('écrivez à la place *loader(style: neon)')), JSON.stringify(data.macroErrors))
  })

  it('un alias de l\'appli du même nom l\'emporte', () => {
    const appli = resolveProjectEffects([parseEffectsBlock('*focus.blur_others = *focus(blur: 3)', 1, '/x/app.effects.mjs')])
    setProjectEffects(appli)
    try {
      assert.equal(parseEffect('focus.blur_others', '').fixed.blur, 3)
    }
    finally {
      setProjectEffects(resolveProjectEffects([]))
    }
  })

  it('en anglais', () => {
    setMessagesLang('en')
    assert.match(erreur('loader.arc'), /\*loader\.arc: no alias of that name for \*loader — it was removed from the library: write \*loader\(style: neon\) instead\./)
    assert.match(erreur('mesh', 'aurora'), /style = aurora no longer exists — write style: boreal \(the aurora palette is now called boreal; \*mesh\.aurora is the former \*aurora effect, not this palette\)/)
  })
})
