// µ.socket(url, opts) sur une adresse déjà tenue : comment deux `auth` se comparent. `null`, `undefined` et
// l'absence d'`auth` disent la même chose (aucune identité) ; deux objets se comparent par leurs clés, quel que
// soit l'ordre ; deux fonctions ne se comparent que par référence (le même objet fonction, sinon la console
// avertit, par prudence : deux fermetures de même code peuvent porter deux identités) ; une identité qui tombe à
// « aucune » est dite aussi ; un appel sans option, ou sans clé `auth`, ne demande rien ; jamais d'exception,
// même sur une connexion posée à la main sans `opts` ni registre d'avertissements.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { poserMessages } from './helpers/messages-stub.js'

const ICI       = dirname(fileURLToPath(import.meta.url))
const socketSrc = readFileSync(join(ICI, '../src/runtime/mjs_socket.ts'), 'utf8')

describe('µ.socket — comparaison de deux `auth` à la même adresse', () => {
  let avertissements: string[]
  let µ: any

  beforeEach(() => {
    avertissements = []
    µ = { state: (o: any) => ({ ...o }), error: () => {}, warn: (...a: any[]) => { avertissements.push(a.map(String).join(' ')) }, log: () => {} }
    poserMessages(µ)
    new Function('µ', socketSrc)(µ)
  })

  afterEach(() => {
    Object.values(µ._mjs_sockets).forEach((s: any) => { try { s.destroy() } catch { /* connexion posée à la main */ } })
  })

  it('null, undefined et absent sont la même chose : aucun avertissement', () => {
    µ.socket('wss://cmp/vide')
    µ.socket('wss://cmp/vide', { auth: null })
    µ.socket('wss://cmp/vide', { auth: undefined })
    µ.socket('wss://cmp/vide-null', { auth: null })
    µ.socket('wss://cmp/vide-null')
    µ.socket('wss://cmp/vide-null', { auth: undefined })
    µ.socket('wss://cmp/vide-null', { auth: null })
    assert.deepEqual(avertissements, [], JSON.stringify(avertissements))
  })

  it('deux objets aux mêmes clés dans un autre ordre (jusque dans les objets imbriqués) : aucun avertissement', () => {
    µ.socket('wss://cmp/ordre', { auth: { a: 1, b: { x: [1, 2], y: 'z' } } })
    µ.socket('wss://cmp/ordre', { auth: { b: { y: 'z', x: [1, 2] }, a: 1 } })
    assert.deepEqual(avertissements, [], JSON.stringify(avertissements))
  })

  it('deux objets aux valeurs différentes (même imbriquées, ou un tableau dans un autre ordre) : un avertissement', () => {
    µ.socket('wss://cmp/diff', { auth: { a: 1, b: { x: 1 } } })
    µ.socket('wss://cmp/diff', { auth: { a: 1, b: { x: 2 } } })
    assert.equal(avertissements.length, 1, 'valeur imbriquée')
    avertissements.length = 0
    µ.socket('wss://cmp/tab', { auth: { r: [1, 2] } })
    µ.socket('wss://cmp/tab', { auth: { r: [2, 1] } })
    assert.equal(avertissements.length, 1, 'tableau')
  })

  it('la même fonction (même référence) : aucun avertissement ; deux fonctions distinctes, même de même code : un avertissement', () => {
    const auth = () => ({ id: 'alice' })
    µ.socket('wss://cmp/fn', { auth })
    µ.socket('wss://cmp/fn', { auth })
    assert.deepEqual(avertissements, [], 'la même référence')
    µ.socket('wss://cmp/fn', { auth: () => ({ id: 'alice' }) })
    assert.equal(avertissements.length, 1, 'une autre référence, même code')
  })

  it('deux fermetures de même code aux valeurs capturées différentes : un avertissement', () => {
    const faire = (token: string) => ({ auth: () => ({ token }) })
    µ.socket('wss://cmp/closure', faire('alice'))
    µ.socket('wss://cmp/closure', faire('bob'))
    assert.equal(avertissements.length, 1, JSON.stringify(avertissements))
  })

  it('un objet puis une fonction (ou l\'inverse), même équivalents : un avertissement', () => {
    µ.socket('wss://cmp/obj-fn', { auth: { id: 1 } })
    µ.socket('wss://cmp/obj-fn', { auth: () => ({ id: 1 }) })
    assert.equal(avertissements.length, 1, 'objet puis fonction')
    avertissements.length = 0
    µ.socket('wss://cmp/fn-obj', { auth: () => ({ id: 1 }) })
    µ.socket('wss://cmp/fn-obj', { auth: { id: 1 } })
    assert.equal(avertissements.length, 1, 'fonction puis objet')
  })

  it('une identité qui tombe à « aucune » (auth: undefined ou null écrit) : un avertissement ; sans option ou sans clé auth : rien', () => {
    µ.socket('wss://cmp/chute', { auth: () => 1 })
    µ.socket('wss://cmp/chute')
    µ.socket('wss://cmp/chute', {})
    µ.socket('wss://cmp/chute', { reconnect: { enabled: false } })
    assert.deepEqual(avertissements, [], 'un appel qui ne demande aucune identité ne dit rien')
    µ.socket('wss://cmp/chute', { auth: undefined })
    assert.equal(avertissements.length, 1, 'auth: undefined écrit')
    avertissements.length = 0
    µ.socket('wss://cmp/chute-null', { auth: { id: 1 } })
    µ.socket('wss://cmp/chute-null', { auth: null })
    assert.equal(avertissements.length, 1, 'auth: null écrit')
  })

  it('jamais d\'exception : connexion sans `opts`, sans registre d\'avertissements, objet circulaire', () => {
    µ._mjs_sockets['wss://cmp/sans-opts'] = { _mjs_refs: 1 }
    assert.doesNotThrow(() => µ.socket('wss://cmp/sans-opts', { auth: () => 2 }), 'sans opts ni registre')
    assert.equal(avertissements.length, 1, 'une identité demandée à une connexion qui n\'en a pas : dite')
    avertissements.length = 0
    µ._mjs_sockets['wss://cmp/sans-registre'] = { opts: { auth: () => 1 }, _mjs_refs: 1 }
    assert.doesNotThrow(() => µ.socket('wss://cmp/sans-registre', { auth: () => 2 }), 'sans registre')
    assert.equal(avertissements.length, 1)
    avertissements.length = 0
    const a: any = { t: 1 }; a.moi = a
    const b: any = { t: 1 }; b.moi = b
    µ.socket('wss://cmp/cycle', { auth: a })
    assert.doesNotThrow(() => µ.socket('wss://cmp/cycle', { auth: b }), 'objets circulaires')
    assert.equal(avertissements.length, 1, 'deux objets circulaires : prudence, avertissement')
  })

  it('un seul avertissement par connexion, même si les autres `auth` reviennent', () => {
    µ.socket('wss://cmp/une-fois', { auth: () => 1 })
    µ.socket('wss://cmp/une-fois', { auth: () => 2 })
    µ.socket('wss://cmp/une-fois', { auth: () => 3 })
    assert.equal(avertissements.length, 1)
  })
})
