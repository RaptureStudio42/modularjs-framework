// µ.socket(url, opts) — une connexion à cette adresse existe déjà, avec une autre identité (`auth`) : la même
// connexion revient (elle est unique par adresse), sous sa première identité — et la console le dit, une fois,
// au lieu de se taire. Pas d'avertissement quand rien ne change : un appel sans option (on reprend la
// connexion de l'appli), le même `auth` (la même référence), la même valeur, une autre option qui n'est pas
// l'identité. Deux fonctions distinctes avertissent, même de même code : la comparaison fine est dans
// socket-auth-comparaison.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { poserMessages } from './helpers/messages-stub.js'

const ICI       = dirname(fileURLToPath(import.meta.url))
const socketSrc = readFileSync(join(ICI, '../src/runtime/mjs_socket.ts'), 'utf8')

describe('µ.socket — une adresse déjà tenue, avec un autre `auth`', () => {
  let avertissements: string[]
  let µ: any

  beforeEach(() => {
    avertissements = []
    µ = { state: (o: any) => ({ ...o }), error: () => {}, warn: (...a: any[]) => { avertissements.push(a.map(String).join(' ')) }, log: () => {} }
    poserMessages(µ)
    new Function('µ', socketSrc)(µ)
  })

  afterEach(() => {
    Object.values(µ._mjs_sockets).forEach((s: any) => s.destroy())
  })

  it('un `auth` différent (une autre fonction, un autre code) : la même connexion revient, sous sa première identité, et la console le dit', () => {
    const alice = µ.socket('wss://autre/auth', { auth: () => ({ id: 'alice' }) })
    const bob   = µ.socket('wss://autre/auth', { auth: () => ({ id: 'bob' }) })
    assert.ok(alice === bob, 'la même connexion : elle est unique par adresse')
    assert.equal(avertissements.length, 1, 'un avertissement : ' + JSON.stringify(avertissements))
    assert.match(avertissements[0], /wss:\/\/autre\/auth/, 'il nomme l\'adresse')
    assert.match(avertissements[0], /première identité/, 'il dit sous quelle identité la connexion revient')
    assert.match(avertissements[0], /destroy\(\)/, 'il dit quoi faire')
    assert.equal(alice.opts.auth().id, 'alice', 'et la connexion garde bien son auth d\'origine')
  })

  it('l\'avertissement n\'est dit qu\'une fois par connexion, même si l\'autre `auth` revient', () => {
    µ.socket('wss://autre/une-fois', { auth: () => ({ id: 'alice' }) })
    µ.socket('wss://autre/une-fois', { auth: () => ({ id: 'bob' }) })
    µ.socket('wss://autre/une-fois', { auth: () => ({ id: 'carol' }) })
    assert.equal(avertissements.length, 1)
  })

  it('un `auth` donné à une adresse tenue sans `auth`, ou deux valeurs différentes (pas des fonctions) : avertissement aussi', () => {
    µ.socket('wss://autre/sans', {})
    µ.socket('wss://autre/sans', { auth: () => ({ id: 'bob' }) })
    assert.equal(avertissements.length, 1, 'sans auth au départ, un auth ensuite')
    avertissements.length = 0
    µ.socket('wss://autre/valeur', { auth: { token: 'a' } })
    µ.socket('wss://autre/valeur', { auth: { token: 'b' } })
    assert.equal(avertissements.length, 1, 'deux valeurs qui diffèrent')
  })

  it('rien à dire quand l\'identité ne change pas : sans option, le même auth, la même valeur, une autre option', () => {
    const auth = () => ({ id: 'alice' })
    const a    = µ.socket('wss://autre/pareil', { auth })
    µ.socket('wss://autre/pareil')
    µ.socket('wss://autre/pareil', { auth })
    µ.socket('wss://autre/pareil', { reconnect: { enabled: false } })
    assert.deepEqual(avertissements, [], 'aucun avertissement : ' + JSON.stringify(avertissements))
    assert.equal(a._mjs_refs, 4, 'chaque appel retient la connexion')
    µ.socket('wss://autre/pareil-valeur', { auth: { token: 'a' } })
    µ.socket('wss://autre/pareil-valeur', { auth: { token: 'a' } })
    assert.deepEqual(avertissements, [], 'la même valeur écrite deux fois')
  })

  it('la connexion détruite puis rouverte sous un autre `auth` : une connexion neuve, aucun avertissement', () => {
    const alice = µ.socket('wss://autre/rouverte', { auth: () => ({ id: 'alice' }) })
    alice.destroy()
    const bob = µ.socket('wss://autre/rouverte', { auth: () => ({ id: 'bob' }) })
    assert.ok(alice !== bob, 'une connexion neuve')
    assert.deepEqual(avertissements, [])
  })

  it('la connexion propre d\'un effet (`server`) n\'est pas concernée : elle n\'est jamais celle de l\'appli', () => {
    µ.socket('wss://autre/propre', { auth: () => ({ id: 'alice' }) })
    const stop = µ._mjs_fxSock(undefined, 'wss://autre/propre', 'msg', () => () => {})
    stop()
    assert.deepEqual(avertissements, [])
  })
})
