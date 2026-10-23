// l'ancien nom d'un effet fondu dans un autre donne une écriture qui rend la même chose AVEC ses réglages : `*shimmer(speed: 1s)` boucle chaque
// seconde (`duration` et `every`), `*wiggle(duration: 1s)` se repose trois fois sa durée, une image ou un motif tenus par une variable gardent
// leur réglage (`image:`, `pattern:`), le rayon de *lens devient le diamètre `spot`. « Le même rendu » ne se dit que sans réglage ; un réglage
// sans traduction est nommé. L'ancien préréglage `*typing.typewriter` donne d'abord `*cycle.typewriter`. Chaque entrée de la table est
// parcourue : l'écriture proposée se compile, et règle ce que réglait l'ancien effet.

import assert from 'node:assert/strict'
import { parseEffect, setProjectEffects } from '../src/effects/catalog.js'
import { resolveProjectEffects } from '../src/effects/project.js'
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

// l'écriture proposée par le message (`écrivez *shine.shimmer(duration: 1s, every: 1s)`)
const proposee = (message: string) => /(?:écrivez|write) (\*[\w.]+(?:\([^)]*\))?)/.exec(message)?.[1] ?? ''

// l'écriture proposée, compilée avec les alias livrés : ses réglages fixes (ceux de l'alias, puis les siens)
function regle(ecriture: string): Record<string, unknown> {
  const m = /^\*([\w.]+)(?:\(([^)]*)\))?$/.exec(ecriture)!
  return parseEffect(m[1], m[2] ?? '').fixed
}

describe('effets fondus : l\'ancien nom, réglages traduits', () => {
  before(() => setProjectEffects(resolveProjectEffects([])))
  after(() => setProjectEffects({}))
  afterEach(() => setMessagesLang('fr'))

  it('*shimmer(speed: 1s) : le reflet repasse chaque seconde (duration et every)', () => {
    const m = erreur('shimmer', 'speed: 1s')
    assert.equal(proposee(m), '*shine.shimmer(duration: 1s, every: 1s)', m)
    assert.doesNotMatch(m, /même rendu/)
    const f = regle(proposee(m))
    assert.equal(f.duration, '1s')
    assert.equal(f.every, '1s')
  })

  it('*wiggle(duration: 1s) : le balancement, puis trois fois sa durée de repos', () => {
    assert.equal(proposee(erreur('wiggle', 'duration: 1s')), '*attention.wiggle(duration: 1s, every: 3s)')
    assert.equal(proposee(erreur('wiggle', '20, duration: 300ms')), '*attention.wiggle(angle: 20, duration: 300ms, every: 900ms)')
  })

  it('*knockout($photo) et *texture($motif) : la variable garde son réglage', () => {
    assert.equal(proposee(erreur('knockout', '$photo')), '*gradient.knockout(image: $photo)')
    assert.equal(proposee(erreur('texture', '$motif')), '*gradient.texture(pattern: $motif)')
    const k = parseEffect('gradient.knockout', 'image: $photo')
    assert.equal(k.dynamic.image, '$photo')
    assert.equal(parseEffect('gradient.texture', 'pattern: $motif').dynamic.pattern, '$motif')
  })

  it('*lens(150) : le rayon devient le diamètre, le double', () => {
    assert.equal(proposee(erreur('lens', '150')), '*filter.lens(spot: 300)')
    assert.equal(proposee(erreur('lens', 'size: 50, blur: 4')), '*filter.lens(spot: 100, blur: 4)')
  })

  it('« le même rendu » sans réglage seulement ; la correspondance des réglages est dite', () => {
    const nu = erreur('shimmer')
    assert.match(nu, /écrivez \*shine\.shimmer, qui donne le même rendu/)
    assert.match(nu, /speed: v → duration: v, every: v · color → ink · shine → color/)
    assert.doesNotMatch(erreur('shimmer', 'color: #999'), /même rendu/)
  })

  it('un réglage sans traduction est nommé', () => {
    assert.match(erreur('wiggle', 'duration: $d'), /Sans équivalent direct dans \*attention\.wiggle[^:]*: duration: \$d\./)
    assert.match(erreur('lens', 'size: $r'), /Sans équivalent direct dans \*filter\.lens[^:]*: size: \$r\./)
    assert.match(erreur('aurora', 'nuit: 3'), /: nuit: 3\./)
  })

  it('*typing.typewriter : *cycle.typewriter d\'abord, pas le cadre', () => {
    assert.match(erreur('typing.typewriter'), /écrivez \*cycle\.typewriter, qui donne le même rendu/)
    assert.equal(proposee(erreur('typing.typewriter', 'words: [Bonjour, Salut]')), '*cycle.typewriter(words: [Bonjour, Salut])')
    assert.equal(proposee(erreur('typing', '[Coder.], style: type, speed: 2s')), '*cycle.typewriter(words: [Coder.], speed: 2s)')
    assert.equal(proposee(erreur('typing', 'style: frame')), '*cycle.frame')
    assert.equal(proposee(erreur('typing', 'style: $s')), '*cycle.frame(style: $s)')
  })

  // chaque ancien effet, chaque ancien préréglage livré : l'écriture proposée se compile et règle ce que réglait l'ancien
  const TABLE: Array<[string, string, string, Record<string, unknown>]> = [
    ['knockout', '', '*gradient.knockout', { angle: 90, size: 200, speed: '15s', direction: 'left' }],
    ['texture', 'waves', '*gradient.texture(pattern: waves)', { pattern: 'waves', speed: '6s', angle: 45 }],
    ['aurora', '[#f00, #00f], speed: 9s', '*mesh.aurora(colors: [#f00, #00f], speed: 9s)', { drift: 'sweep', colors: ['#f00', '#00f'], speed: '9s', blur: 40 }],
    ['shimmer', '3s, color: #999, shine: #ff0', '*shine.shimmer(duration: 3s, every: 3s, ink: #999, color: #ff0)', { where: 'text', duration: '3s', every: '3s', ink: '#999', color: '#ff0' }],
    ['wiggle', '', '*attention.wiggle', { style: 'wiggle', duration: '500ms', every: '1.5s', on: 'hover' }],
    ['typing', '', '*cycle.frame', { style: 'frame', speed: '3s' }],
    ['typing.typewriter', '', '*cycle.typewriter', { style: 'type', speed: '3s' }],
    ['lens', '', '*filter.lens', { style: 'none', spot: 200, ring: true }],
  ]
  for (const [nom, raw, attendue, reglages] of TABLE) {
    it(`*${nom}${raw ? `(${raw})` : ''} → ${attendue}, qui se compile`, () => {
      const m = erreur(nom, raw)
      assert.match(m, new RegExp(`^\\[ModularJS\\] \\*${nom.replace('.', '\\.')} n'existe plus`), m)
      assert.equal(proposee(m), attendue, m)
      const f = regle(attendue)
      for (const [k, v] of Object.entries(reglages)) assert.deepEqual(f[k], v, `${attendue} : ${k}`)
    })
  }

  it('en anglais : la même écriture, sans « same » quand un réglage est écrit', () => {
    setMessagesLang('en')
    const m = erreur('shimmer', 'speed: 1s')
    assert.equal(proposee(m), '*shine.shimmer(duration: 1s, every: 1s)', m)
    assert.doesNotMatch(m, /renders the same|réglage|écrivez/)
    assert.match(erreur('wiggle', 'duration: $d'), /No direct equivalent in \*attention\.wiggle[^:]*: duration: \$d\./)
  })
})
