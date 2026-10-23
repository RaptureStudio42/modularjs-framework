// *heatmap : le réglage qui s'écrit sans son nom est `on`, l'événement capté — `*heatmap(mousemove)`
// veut dire `*heatmap(on: mousemove)` ; la connexion passe par `sock`, l'adresse par `server` (nommés).

import assert from 'node:assert/strict'
import { parseEffect, EFFECTS } from '../src/effects/catalog.js'

describe('*heatmap — le réglage principal : on', () => {
  it('*heatmap(mousemove) = *heatmap(on: mousemove)', () => {
    assert.equal(EFFECTS.heatmap.main, 'on')
    assert.deepEqual(parseEffect('heatmap', 'mousemove').fixed, { on: 'mousemove' })
    assert.deepEqual(parseEffect('heatmap', "dblclick, server: 'wss://x.fr/ws'").fixed, { on: 'dblclick', server: 'wss://x.fr/ws' })
  })

  it('une adresse s\'écrit avec son nom', () => {
    assert.deepEqual(parseEffect('heatmap', "server: 'wss://x.fr/ws'").fixed, { server: 'wss://x.fr/ws' })
  })
})
