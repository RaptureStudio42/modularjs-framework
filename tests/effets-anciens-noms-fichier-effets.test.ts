// dans un fichier d'effets de l'appli (`*.effects.mjs`), un effet fondu dans un autre avant la 3.0 donne son remplaçant, comme sur une
// balise : `*titre = *lens(150)`, `*titre = *typing.typewriter`, un alias rattaché à l'ancien effet (`*shimmer.lent = *shimmer(speed: 4s)`).
// Un alias ne s'écrit pas en cible d'un effet du fichier : le message y donne l'écriture complète, réglages traduits, et cette écriture,
// remise dans le fichier, se construit.

import assert from 'node:assert/strict'
import { parseEffectsBlock, resolveProjectEffects } from '../src/effects/project.js'
import { setMessagesLang } from '../src/messages/index.js'

// les fautes du fichier, une par ligne fautive (la lecture va au bout)
function fautes(src: string): string[] {
  const problems: Error[] = []
  const parts = parseEffectsBlock(src, 1, '/x/app.effects.mjs', problems)
  resolveProjectEffects([parts], () => {}, problems)
  return problems.map(p => p.message)
}

// l'écriture que propose le message : ce qui suit « écrivez » / « write », jusqu'à la virgule qui la clôt
const proposee = (message: string) => /(?:écrivez|write) (\*[\w.]+(?:\([^)]*\))?)/.exec(message)?.[1] ?? ''

describe('fichier d\'effets : un ancien nom donne son remplaçant', () => {
  afterEach(() => setMessagesLang('fr'))

  it('*titre = *lens(150) : *filter, la loupe réglée, le rayon devenu diamètre', () => {
    const [m] = fautes('*titre = *lens(150)')
    assert.match(m, /^\[ModularJS\] app\.effects\.mjs \(ligne 1\) : \*lens n'existe plus/, m)
    assert.ok(m.includes('écrivez *filter(style: none, blur: 10, spot: 300, soft: 0, smooth: 1, ring: true, near: true, parallax: .04)'), m)
    assert.doesNotMatch(m, /ni un effet de la bibliothèque/)
  })

  it('*titre = *shimmer(3s) : le reflet, sa durée et sa pause', () => {
    const [m] = fautes('*titre = *shimmer(3s)')
    assert.ok(m.includes('*shine(where: text, color: #fff, direction: 100, width: 50, duration: 3s, on: always, every: 3s)'), m)
  })

  it('*titre = *typing.typewriter : la machine à écrire de *cycle, pas le cadre', () => {
    const [m] = fautes('*titre = *typing.typewriter')
    assert.match(m, /\*typing\.typewriter n'existe plus/, m)
    assert.ok(m.includes('écrivez *cycle(style: type, speed: 3s), qui donne le même rendu'), m)
    assert.doesNotMatch(m, /attendu : \*nom = \*effet/)
  })

  it('*shimmer.lent = *shimmer(speed: 4s) : l\'alias se rattache à *shine, réglages traduits', () => {
    const [m] = fautes('*shimmer.lent = *shimmer(speed: 4s)')
    assert.ok(m.includes('*shimmer n\'existe plus : il fait désormais partie de *shine ; écrivez *shine.lent = *shine(where: text, color: #fff, direction: 100, width: 50, duration: 4s, on: always, every: 4s).'), m)
    assert.doesNotMatch(m, /\*shimmer étant un effet de la bibliothèque/)
  })

  it('*knockout.mien = *gradient(…) : l\'alias se rattache à *gradient, la cible reste', () => {
    const [m] = fautes('*knockout.mien = *gradient(colors: [red, blue])')
    assert.ok(m.includes('écrivez *gradient.mien = *gradient(colors: [red, blue]).'), m)
  })

  it('l\'écriture proposée, remise dans le fichier, se construit sans faute', () => {
    for (const src of ['*titre = *lens(150)', '*titre = *shimmer(3s)', '*titre = *typing.typewriter', '*titre = *wiggle(duration: 1s)', '*titre = *knockout(size: 300)', '*titre = *texture(dots)', '*titre = *aurora([#f00, #00f])']) {
      const [m] = fautes(src)
      const ecrit = proposee(m)
      assert.match(ecrit, /^\*[\w-]+(?:\(|$)/, src + ' → ' + m)
      assert.deepEqual(fautes('*titre = ' + ecrit), [], src + ' → ' + ecrit)
    }
    const [alias] = fautes('*shimmer.lent = *shimmer(speed: 4s)')
    const ligne   = /écrivez (\*shine\.lent = \*shine\([^)]*\))/.exec(alias)![1]
    assert.deepEqual(fautes(ligne), [], ligne)
  })

  it('un effet de l\'appli qui reprend un ancien nom se construit toujours', () => {
    assert.deepEqual(fautes('*aurora(c: red) =\n  color: $c\n*titre = *aurora(blue)'), [])
  })

  it('en anglais : le même remplaçant', () => {
    setMessagesLang('en')
    const [m] = fautes('*titre = *lens(150)')
    assert.match(m, /^\[ModularJS\] app\.effects\.mjs \(line 1\): \*lens no longer exists/, m)
    assert.ok(m.includes('write *filter(style: none, blur: 10, spot: 300,'), m)
    const [a] = fautes('*shimmer.lent = *shimmer(speed: 4s)')
    assert.ok(a.includes('it is now part of *shine; write *shine.lent = *shine('), a)
  })
})
