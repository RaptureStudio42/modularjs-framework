// un alias livré retiré avant la 3.0, écrit avec ses propres réglages (`*pointer.disc(size: 32)`) : l'écriture que propose le message les
// garde, par-dessus ceux de l'ancien alias — la taille écrite reste 32, pas les 64 de l'alias ; une valeur sans nom va au réglage principal
// de l'effet (`*travel.path(hero)` → `to: hero`), et l'écriture se construit. Sur une balise, sur <@document>, dans le fichier d'effets
// (`*titre = *pointer.disc(size: 32)`), en français et en anglais.

import assert from 'node:assert/strict'
import { parseEffect, setProjectEffects } from '../src/effects/catalog.js'
import { resolveProjectEffects, parseEffectsBlock } from '../src/effects/project.js'
import { transpile } from '../src/transpiler/index.js'
import { setMessagesLang } from '../src/messages/index.js'

const erreur = (nom: string, raw = ''): string => {
  try {
    parseEffect(nom, raw)
  }
  catch (e) {
    return (e as Error).message
  }
  return ''
}

// l'écriture proposée par le message, puis compilée telle quelle
const proposee = (m: string): string => /(?:à la place|write) (\*[\w-]+(?:\((?:[^()]|\([^)]*\))*\))?)/.exec(m)?.[1] ?? ''
const construite = (ecriture: string) => {
  const e = /^\*([\w-]+)(?:\(([\s\S]*)\))?$/.exec(ecriture)!
  return parseEffect(e[1], e[2] ?? '')
}

const CAS: Array<[string, string, string]> = [
  ['pointer.disc', 'size: 32', '*pointer(style: disc, color: #fff, size: 32, blend: difference, grow: 2)'],
  ['loader.arc', 'size: 40', '*loader(style: neon, size: 40)'],
  ['travel.path', 'hero', '*travel(zone: 40% 65%, to: hero)'],
  ['focus.blur_others', 'grow: 1.5', '*focus(grow: 1.5)'],
  ['lift.purple_glow', 'blur: 20, height: 6', '*lift(color: rgba(192,96,255,.95), blur: 20, height: 6)'],
]

describe('alias retirés écrits avec leurs réglages : le message les garde, l\'écriture se construit', () => {
  before(() => setProjectEffects(resolveProjectEffects([])))
  after(() => setProjectEffects({}))
  afterEach(() => setMessagesLang('fr'))

  for (const [nom, raw, ecriture] of CAS) {
    it(`*${nom}(${raw}) → ${ecriture}`, () => {
      const m = erreur(nom, raw)
      assert.ok(m.includes(`*${nom} : aucun alias de ce nom pour *${nom.split('.')[0]} — il a été retiré de la bibliothèque : écrivez à la place ${ecriture}.`), m)
      assert.doesNotThrow(() => construite(proposee(m)), proposee(m))
    })
  }

  it('écrit sans réglage : l\'écriture de l\'ancien alias, telle quelle', () => {
    assert.ok(erreur('pointer.disc').includes('écrivez à la place *pointer(style: disc, color: #fff, size: 64, blend: difference, grow: 2).'))
    assert.ok(erreur('focus.blur_others').includes('écrivez à la place *focus.'))
  })

  it('sur une balise et sur <@document> : les réglages écrits restent', async () => {
    await assert.rejects(transpile('<div *pointer.disc(size: 32)>x</div>', { moduleName: 'retire-reglages-balise' }), /écrivez à la place \*pointer\(style: disc, color: #fff, size: 32, blend: difference, grow: 2\)\./)
    const { data } = await transpile('<@document *pointer.disc(size: 32)></@document>\n<p>x</p>\n', { moduleName: 'retire-reglages-doc' })
    assert.ok(data.macroErrors.some((e: string) => e.includes('écrivez à la place *pointer(style: disc, color: #fff, size: 32, blend: difference, grow: 2).')), JSON.stringify(data.macroErrors))
  })

  it('dans le fichier d\'effets : `*titre = *pointer.disc(size: 32)` garde la taille écrite', () => {
    const problems: Error[] = []
    resolveProjectEffects([parseEffectsBlock('*titre = *pointer.disc(size: 32)', 1, '/x/app.effects.mjs', problems)], () => {}, problems)
    const m = problems.map(p => p.message).join('\n')
    assert.ok(m.includes('*pointer(style: disc, color: #fff, size: 32, blend: difference, grow: 2)'), m)
  })

  it('en anglais', () => {
    setMessagesLang('en')
    const m = erreur('travel.path', 'hero')
    assert.ok(m.includes('*travel.path: no alias of that name for *travel — it was removed from the library: write *travel(zone: 40% 65%, to: hero) instead.'), m)
    assert.doesNotThrow(() => construite(proposee(m)), proposee(m))
  })
})
