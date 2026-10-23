// µ.socket(url, opts) sur une adresse déjà tenue : la comparaison de deux `auth` ne lève jamais (un getter qui
// lève, un Proxy dont `ownKeys` lève, une chaîne de 20 000 niveaux : « différent », donc l'avertissement prudent) ;
// deux dates se comparent par leur instant, deux `Map` et deux `Set` par leur contenu, les clés symboles comptent,
// `NaN` est égal à `NaN` ; un tableau n'est jamais égal à un objet, une clé `undefined` n'est pas une clé, un
// objet partagé deux fois (cas en diamant) n'est pas pris pour un cycle.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { poserMessages } from './helpers/messages-stub.js'

const ICI       = dirname(fileURLToPath(import.meta.url))
const socketSrc = readFileSync(join(ICI, '../src/runtime/mjs_socket.ts'), 'utf8')

describe('µ.socket — comparaison robuste de deux `auth`', () => {
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

  // deux appels à la même adresse : combien d'avertissements, et jamais d'exception
  const comparer = (a: any, b: any) => {
    const url = 'wss://rob/' + (++n)
    avertissements.length = 0
    assert.doesNotThrow(() => { µ.socket(url, { auth: a }); µ.socket(url, { auth: b }) }, 'jamais d\'exception')
    return avertissements.length
  }

  it('un getter qui lève : pas d\'exception, un avertissement', () => {
    const piege = () => ({ get x() { throw new Error('getter') } })
    assert.equal(comparer(piege(), piege()), 1)
  })

  it('un Proxy dont ownKeys lève : pas d\'exception, un avertissement', () => {
    const piege = () => new Proxy({}, { ownKeys() { throw new Error('ownKeys') } })
    assert.equal(comparer(piege(), piege()), 1)
  })

  it('une chaîne de 20 000 niveaux : pas d\'exception, un avertissement', () => {
    const chaine = () => { let o: any = { fin: 1 }; for (let i = 0; i < 20000; i++) o = { o }; return o }
    assert.equal(comparer(chaine(), chaine()), 1)
  })

  it('deux dates : égales par leur instant, différentes sinon', () => {
    assert.equal(comparer({ d: new Date(1000) }, { d: new Date(1000) }), 0, 'même instant')
    assert.equal(comparer({ d: new Date(1000) }, { d: new Date(2000) }), 1, 'autre instant')
  })

  it('deux Map et deux Set : par leur contenu', () => {
    assert.equal(comparer({ m: new Map([['a', 1]]) }, { m: new Map([['a', 1]]) }), 0, 'Map égales')
    assert.equal(comparer({ m: new Map([['a', 1]]) }, { m: new Map([['a', 2]]) }), 1, 'Map différentes')
    assert.equal(comparer({ s: new Set([1, 2]) }, { s: new Set([1, 2]) }), 0, 'Set égaux')
    assert.equal(comparer({ s: new Set([1, 2]) }, { s: new Set([1, 3]) }), 1, 'Set différents')
  })

  it('les clés symboles comptent', () => {
    const k = Symbol('k')
    assert.equal(comparer({ [k]: 1 }, { [k]: 2 }), 1, 'valeurs différentes')
    assert.equal(comparer({ [k]: 1 }, { [k]: 1 }), 0, 'valeurs égales')
  })

  it('NaN est égal à NaN', () => {
    assert.equal(comparer({ x: NaN }, { x: NaN }), 0)
  })

  it('un tableau n\'est jamais égal à un objet', () => {
    assert.equal(comparer({ x: [] }, { x: {} }), 1)
    assert.equal(comparer({ x: [] }, { x: { length: 0 } }), 1, 'un objet qui a la longueur d\'un tableau vide')
  })

  it('une clé undefined n\'est pas une clé', () => {
    assert.equal(comparer({ a: 1, b: undefined }, { a: 1 }), 0)
  })

  it('un objet partagé deux fois (diamant) n\'est pas un cycle', () => {
    const p = { id: 1 }
    const q = { id: 1 }
    assert.equal(comparer({ x: p, y: p }, { x: q, y: q }), 0)
  })

  it('un objet circulaire n\'est égal qu\'à lui-même', () => {
    const c1: any = { a: 1 }; c1.moi = c1
    const c2: any = { a: 1 }; c2.moi = c2
    assert.equal(comparer(c1, c2), 1)
  })
})
