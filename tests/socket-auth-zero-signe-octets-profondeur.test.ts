// µ.socket(url, opts) sur une adresse déjà tenue : la comparaison de deux `auth` distingue `0` de `-0` dans un
// tableau ordinaire comme dans un tableau typé ; `NaN` reste égal à lui-même ; la limite de profondeur (64
// niveaux d'objets) accepte la dernière imbrication permise et refuse la suivante.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { poserMessages } from './helpers/messages-stub.js'

const ICI       = dirname(fileURLToPath(import.meta.url))
const socketSrc = readFileSync(join(ICI, '../src/runtime/mjs_socket.ts'), 'utf8')

describe('µ.socket — `auth` : zéro signé, octets, profondeur', () => {
  let avertissements: string[]
  let µ: any
  let n: number

  beforeEach(() => {
    avertissements = []
    n = 0
    µ = { state: (o: any) => ({ ...o }), error: () => {}, warn: (...a: any[]) => { avertissements.push(a.map(String).join(' ')) }, log: () => {} }
    poserMessages(µ)
    new Function('µ', socketSrc)(µ)
  })

  afterEach(() => {
    Object.values(µ._mjs_sockets).forEach((s: any) => { try { s.destroy() } catch { /* connexion posée à la main */ } })
  })

  const comparer = (a: any, b: any) => {
    const url = 'wss://zero/' + (++n)
    avertissements.length = 0
    assert.doesNotThrow(() => { µ.socket(url, { auth: a }); µ.socket(url, { auth: b }) }, 'jamais d\'exception')
    return avertissements.length
  }

  it('[0] et [-0] dans un tableau ordinaire : différents, comme dans un tableau typé', () => {
    assert.equal(comparer([0], [-0]), 1, 'tableau ordinaire')
    assert.equal(comparer({ a: [0] }, { a: [-0] }), 1, 'tableau dans un objet')
    assert.equal(comparer(new Float64Array([0]), new Float64Array([-0])), 1, 'tableau typé')
    assert.equal(comparer([0], [0]), 0, 'deux zéros pareils restent égaux')
    assert.equal(comparer([-0], [-0]), 0, 'deux zéros négatifs aussi')
  })

  it('un tableau typé de NaN est égal à lui-même', () => {
    assert.equal(comparer(new Float64Array([NaN]), new Float64Array([NaN])), 0)
    assert.equal(comparer([NaN], [NaN]), 0)
  })

  it('la limite de profondeur : la dernière imbrication permise passe, la suivante est refusée', () => {
    const chaine = (k: number) => { let o: any = { fin: 1 }; for (let i = 0; i < k; i++) o = { o }; return o }
    assert.equal(comparer(chaine(63), chaine(63)), 0, '64 niveaux d\'objets')
    assert.equal(comparer(chaine(64), chaine(64)), 1, '65 niveaux d\'objets')
  })
})
