// Le fichier d'effets d'une appli : `visible` (la part de la balise qui doit être à l'écran pour `on: view`) est un réglage que tout effet a
// déjà, comme `on` ou `duration` — il ne se déclare pas. Déclaré, il passait sans un mot, puis chaque pose qui le réglait était lue comme la
// part visible : le réglage de l'effet ne se réglait jamais

import assert from 'node:assert/strict'
import { parseEffectsBlock, resolveProjectEffects } from '../src/effects/project.js'
import { setMessagesLang } from '../src/messages/index.js'

function fautes(source: string): string[] {
  const problems: Error[] = []
  resolveProjectEffects([parseEffectsBlock(source, 1, '/x/app.effects.mjs', problems)], undefined, problems)
  return problems.map(p => p.message)
}

describe('fichier d\'effets : `visible` ne se déclare pas', () => {
  afterEach(() => setMessagesLang('fr'))

  it('un effet CSS qui déclare `visible` est refusé, avec la liste des réglages que tout effet a déjà', () => {
    const f = fautes('*voile(visible: 1) =\n  opacity: $visible')
    assert.equal(f.length, 1, f.join('\n'))
    assert.match(f[0], /\*voile — « visible » est un réglage que tout effet a déjà \(on, duration, delay, easing, once, range, visible\) : ne le déclarez pas/)
  })

  it('en anglais aussi', () => {
    setMessagesLang('en')
    const f = fautes('*voile(visible: 1) =\n  opacity: $visible')
    assert.equal(f.length, 1, f.join('\n'))
    assert.match(f[0], /\*voile — "visible" is a setting every effect already has \(on, duration, delay, easing, once, range, visible\)/)
  })

  it('contraste : un autre nom se déclare sans faute', () => {
    assert.deepEqual(fautes('*voile(part: 1) =\n  opacity: $part'), [])
  })
})
