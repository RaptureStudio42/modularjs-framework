// *follow et *cursors : le réglage qui s'écrit sans son nom est `sock`, la connexion — `*follow($$sock)`
// veut dire `*follow(sock: $$sock)`. Une adresse s'écrit avec son nom (`server: 'wss://…'`) : sans nom,
// l'erreur le dit. Sans connexion du tout, l'erreur du build donne l'écriture courte.

import assert from 'node:assert/strict'
import { parseEffect, defaultSock, EFFECTS } from '../src/effects/catalog.js'

describe('*follow, *cursors — le réglage principal : sock', () => {
  for (const nom of ['follow', 'cursors']) {
    it(`*${nom}($$sock) = *${nom}(sock: $$sock)`, () => {
      assert.equal(EFFECTS[nom].main, 'sock')
      const court = parseEffect(nom, '$$sock')
      assert.deepEqual(court.dynamic, { sock: '$$sock' })
      assert.deepEqual(court, parseEffect(nom, 'sock: $$sock'))
      assert.deepEqual(parseEffect(nom, '@sock').dynamic, { sock: '@sock' })
    })

    it(`*${nom}('wss://…') : une adresse s'écrit avec son nom`, () => {
      assert.throws(() => parseEffect(nom, "'wss://x.fr/ws'"), /server: 'wss:\/\/…'/)
      assert.deepEqual(parseEffect(nom, "server: 'wss://x.fr/ws'").fixed, { server: 'wss://x.fr/ws' })
    })

    it(`*${nom} sans connexion : l'erreur du build donne l'écriture courte`, () => {
      assert.throws(() => defaultSock(nom, nom, parseEffect(nom, ''), false), new RegExp(`\\*${nom}\\(\\$\\$sock\\)`))
    })
  }

  it('*follow($$sock, lead: $prof) : les autres réglages se nomment', () => {
    assert.deepEqual(parseEffect('follow', '$$sock, lead: $prof').dynamic, { sock: '$$sock', lead: '$prof' })
  })

  it('*react et *heatmap gardent le leur : la connexion s\'y nomme', () => {
    assert.equal(EFFECTS.react.main, 'emoji')
    assert.equal(EFFECTS.heatmap.main, 'on')
    assert.throws(() => defaultSock('heatmap', 'heatmap', parseEffect('heatmap', ''), false), /\*heatmap\(sock: \$\$sock\)/)
  })
})
