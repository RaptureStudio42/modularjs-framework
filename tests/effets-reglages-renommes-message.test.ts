// Les réglages renommés de la V3 (`*cursors(show: …)`, `*count(thousands: …)`, `*underline(from: …)`)
// disaient « réglage inconnu » sans nommer le remplaçant ; `*drop`, retiré de la bibliothèque, passait
// pour une faute de frappe. Le message dit maintenant ce qu'il faut écrire à la place, ou que l'effet a
// été retiré — en français et en anglais. Un réglage inconnu qui n'a jamais existé ne reçoit pas de piste.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { parseEffect } from '../src/effects/catalog.js'
import { setMessagesLang } from '../src/messages/index.js'

const message = (nom: string, reglages: string): string => {
  try { parseEffect(nom, reglages) } catch (e) { return (e as Error).message }
  assert.fail(`*${nom}(${reglages}) aurait dû être refusé`)
}

describe('réglages renommés : le message dit quoi écrire', () => {
  afterEach(() => setMessagesLang('fr'))

  const renommes: Array<[string, string, string, string]> = [
    ['cursors', 'show', 'both', 'cursor, selection, focus'],
    ['count', 'thousands', '1', 'separator'],
    ['underline', 'from', 'left', 'origin'],
  ]
  for (const [effet, ancien, valeur, nouveau] of renommes) {
    it(`*${effet}(${ancien}: …) : « inconnu » et ${nouveau}`, () => {
      const texte = message(effet, `${ancien}: ${valeur}`)
      assert.match(texte, new RegExp(`réglage « ${ancien} » inconnu`))
      assert.ok(texte.includes(`« ${ancien} » a été remplacé — à la place : ${nouveau}.`), texte)
    })

    it(`*${effet}(${ancien}: …) en anglais`, () => {
      setMessagesLang('en')
      const texte = message(effet, `${ancien}: ${valeur}`)
      assert.ok(texte.includes(`"${ancien}" was replaced — use instead: ${nouveau}.`), texte)
    })
  }

  it('sur une balise HTML, la même piste', async () => {
    await assert.rejects(transpile('<p *count(thousands: 1)>5</p>', { moduleName: 'fx-renomme' }), (e: Error) => e.message.includes('« thousands » a été remplacé — à la place : separator.'))
    await assert.rejects(transpile('<p *underline(from: left)>5</p>', { moduleName: 'fx-renomme' }), (e: Error) => e.message.includes('« from » a été remplacé — à la place : origin.'))
  })

  it('un réglage inconnu qui n\'a jamais existé : pas de piste', () => {
    for (const [effet, faux] of [['cursors', 'bogus'], ['count', 'thousand'], ['underline', 'to']]) {
      const texte = message(effet, `${faux}: 1`)
      assert.match(texte, /réglage « [a-z]+ » inconnu/)
      assert.doesNotMatch(texte, /a été remplacé/)
    }
  })

  it('un réglage renommé d\'un autre effet n\'est pas confondu (`from` de *path, `show` ailleurs)', () => {
    assert.deepEqual(parseEffect('path', "from: '#t'").fixed, { from: '#t' })
    assert.doesNotMatch(message('count', 'show: 1'), /a été remplacé/)
  })
})

describe('*drop : un effet retiré de la bibliothèque', () => {
  afterEach(() => setMessagesLang('fr'))

  it('inconnu, mais le message dit qu\'il a été retiré, et ne le propose pas', async () => {
    await assert.rejects(transpile('<div *drop>x</div>', { moduleName: 'fx-retire' }), (e: Error) => {
      assert.match(e.message, /\*drop : effet inconnu/)
      assert.match(e.message, /retiré de la bibliothèque/)
      assert.ok(!/\*drop,/.test(e.message.split('disponibles')[1]), e.message)
      return true
    })
  })

  it('en anglais', () => {
    setMessagesLang('en')
    assert.match(message('drop', ''), /\*drop[^]*removed from the library/)
  })

  it('un effet inconnu ordinaire ne dit pas « retiré »', () => {
    assert.doesNotMatch(message('fdae', ''), /retiré/)
  })
})
