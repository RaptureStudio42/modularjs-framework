// tampon de positions passées du serveur de jeu (createHistory, compensation de latence) : l'instantané d'un tick se range par
// `push`, nom anglais de la méthode ; l'ancien nom français `pousser` n'existe plus
import assert from 'node:assert/strict'
import { createHistory } from '../src/mjs-server/history.js'

describe('createHistory — `push` range l\'instantané d\'un tick', () => {
  it('push puis rewind rend la position rangée, à l\'abri des changements de l\'objet d\'origine', () => {
    const history   = createHistory(3)
    const positions = { a: { x: 1, y: 2 } }
    history.push(1, 1000, positions)
    positions.a.x = 99
    assert.deepEqual(history.rewind(1000, (p, meta) => ({ p, gap: meta.gap })), { p: { a: { x: 1, y: 2 } }, gap: 0 })
  })

  it('les méthodes du tampon : push, rewind, _clear — plus de `pousser`', () => {
    const history = createHistory(2)
    assert.deepEqual(Object.keys(history), ['push', 'rewind', '_clear'])
    assert.equal('pousser' in history, false)
  })
})
