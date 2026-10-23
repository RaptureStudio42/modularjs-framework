// Un identifiant ou un nom venu du serveur qui porte le nom d'une propriété héritée (`toString`, `constructor`,
// `__proto__`…) ne trouve plus rien d'hérité dans les tables du client temps réel : un accusé de réception d'id `toString`
// levait une erreur, un message de discussion d'id `constructor` passait pour déjà vu, une poussée de partie pour une
// partie nommée `__proto__` écrivait dans `Object.prototype`, une invitation d'id `constructor` n'expirait jamais, une
// entité nommée `toString` cassait le lissage. Ces noms sont désormais des noms comme les autres.
// Faux WebSocket : les trames du serveur sont jouées à la main.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const lire = (f: string): string => readFileSync(join(__dirname, '../src/runtime/' + f), 'utf8')
// mjs_chat, mjs_game et mjs_lobby s'accrochent à MjsSocket : un seul new Function pour les quatre
const CLIENT = ['mjs_socket.ts', 'mjs_chat.ts', 'mjs_game.ts', 'mjs_lobby.ts'].map(lire).join('\n')
const SMOOTH = lire('mjs_smooth.ts')
const HERITES = ['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf']

class FauxWS {
  static tous: FauxWS[] = []
  url: string; readyState = 0; envoyes: any[] = []
  onopen: any; onmessage: any; onclose: any; onerror: any
  constructor(url: string) { this.url = url; FauxWS.tous.push(this) }
  send(data: string) { this.envoyes.push(JSON.parse(data)) }
  close() { this.readyState = 3 }
  ouvrir() { this.readyState = 1; this.onopen && this.onopen({}) }
  recevoir(obj: any) { this.onmessage && this.onmessage({ data: JSON.stringify(obj) }) }
}

const avant   = (globalThis as any).WebSocket
const dernier = (): FauxWS => FauxWS.tous[FauxWS.tous.length - 1]
const aFermer: (() => void)[] = []

// erreurs relevées par µ.error (un écouteur qui lève est rattrapé et signalé là)
function connecter(url: string): { s: any, ws: FauxWS, erreurs: string[] } {
  const erreurs: string[] = []
  const µ: any = { state: (i: any) => ({ ...i }), warn() {}, log() {} }
  µ.error = (...a: any[]) => { erreurs.push(a.map(String).join(' ')) }
  µ._mjs_logger = () => null
  µ._mjs_txt = (k: string, v: any, fr: string) => fr
  ;(globalThis as any).WebSocket = FauxWS
  new Function('µ', CLIENT)(µ)
  const s = µ.socket(url, { reconnect: { enabled: false } })
  aFermer.push(() => s.destroy())
  s.connect()
  const ws = dernier()
  ws.ouvrir()
  ws.recevoir({ t: 'µ:welcome', p: {} })
  return { s, ws, erreurs }
}

// objets du langage qu'une table ordinaire aurait rendus pour ces noms : aucun ne doit prendre un champ du client
const CIBLES: any[] = [Object.prototype, Object, Object.prototype.toString, Object.prototype.hasOwnProperty, Object.prototype.valueOf]
const champsPoses = (): string[] => CIBLES.flatMap(c => Object.getOwnPropertyNames(c).filter(k => k.startsWith('_mjs_')))
const nettoyer = (): void => { for (const c of CIBLES) for (const k of Object.getOwnPropertyNames(c)) if (k.startsWith('_mjs_')) delete c[k] }
const attendre = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

describe('client temps réel — un nom venu du serveur au nom d\'une propriété héritée', () => {
  beforeEach(() => { FauxWS.tous = [] })
  // objets du langage remis en état, puis poignées et connexions fermées, même si un test échoue
  afterEach(() => {
    nettoyer()
    const ratees: unknown[] = []
    while (aFermer.length) { try { aFermer.pop()!() } catch (e) { ratees.push(e) } }
    assert.deepEqual(ratees, [], 'fermetures sans erreur')
  })
  after(() => { (globalThis as any).WebSocket = avant })

  it('µ:ack d\'un tel id : ignoré, sans erreur ; la vraie requête aboutit', async () => {
    const { s, ws } = connecter('wss://noms/ack')
    const r = s.request('question', {})
    const id = dernier().envoyes[dernier().envoyes.length - 1].id
    for (const faux of HERITES) assert.doesNotThrow(() => ws.recevoir({ t: 'µ:ack', id: faux, p: {} }), faux)
    ws.recevoir({ t: 'µ:ack', id, p: { ok: true } })
    assert.deepEqual(await r, { ok: true })
  })

  it('discussion : des messages de ces ids s\'affichent et se retirent ; leurs auteurs apparaissent en train d\'écrire', () => {
    const { s, ws, erreurs } = connecter('wss://noms/discussion')
    const salon = s.chat('general')
    aFermer.push(() => salon.close())
    HERITES.forEach((id, i) => ws.recevoir({ t: 'chat:message', p: { room: 'general', id, ts: i + 1, from: { id: 'u', name: 'U' }, text: id } }))
    assert.deepEqual(salon.messages.map((m: any) => m.id), HERITES, 'tous affichés')
    ws.recevoir({ t: 'chat:removed', p: { room: 'general', id: 'toString' } })
    assert.deepEqual(salon.messages.map((m: any) => m.id), HERITES.filter(id => id !== 'toString'), 'retiré')
    // retiré avant d'arriver : jamais affiché
    ws.recevoir({ t: 'chat:removed', p: { room: 'general', id: 'isPrototypeOf' } })
    ws.recevoir({ t: 'chat:message', p: { room: 'general', id: 'isPrototypeOf', ts: 9, from: { id: 'u', name: 'U' }, text: 'x' } })
    assert.equal(salon.messages.some((m: any) => m.id === 'isPrototypeOf'), false)
    for (const id of HERITES) ws.recevoir({ t: 'chat:typing', p: { room: 'general', from: { id, name: 'N-' + id } } })
    assert.deepEqual([...salon.typingUsers].sort(), HERITES.map(id => 'N-' + id).sort())
    assert.deepEqual(erreurs, [])
  })

  it('partie : une poussée pour une partie inconnue de ce nom ne touche à rien', () => {
    const { s, ws, erreurs } = connecter('wss://noms/partie-inconnue')
    s.game('echecs')
    for (const game of HERITES) {
      for (const t of ['µgame:state', 'µgame:seat', 'µgame:event', 'µgame:end', 'µgame:left', 'µgame:orders']) {
        ws.recevoir({ t, p: { game, seats: ['a'], result: { gagnant: 'a' }, seq: 2, ops: [], tick: 1, orders: [] } })
      }
    }
    assert.deepEqual(champsPoses(), [], 'aucun objet du langage n\'a pris de champ de partie')
    assert.deepEqual(erreurs, [], 'aucune erreur')
  })

  it('partie : une partie assise sous un tel nom reçoit ses poussées', async () => {
    for (const nom of HERITES) {
      const { s, ws, erreurs } = connecter('wss://noms/partie-' + nom)
      const g = s.game('echecs')
      const play = ws.envoyes.find(f => f.t === 'µgame:play')
      ws.recevoir({ t: 'µ:ack', id: play.id, p: { game: nom, seat: 0, view: { n: 0 }, phase: 'jeu', turn: 0, seq: 1 } })
      await attendre(0)   // la réponse de µgame:play passe par une promesse
      assert.equal(g.state.status, 'playing', nom)
      ws.recevoir({ t: 'µgame:seat', p: { game: nom, seats: ['a', 'b'] } })
      assert.deepEqual(g.state.seats, ['a', 'b'], nom + ' : roster reçu')
      ws.recevoir({ t: 'µgame:end', p: { game: nom, result: { gagnant: 'a' } } })
      assert.equal(g.state.status, 'finished', nom + ' : fin reçue')
      assert.deepEqual(g.state.result, { gagnant: 'a' })
      assert.deepEqual(champsPoses(), [], nom)
      assert.deepEqual(erreurs, [], nom)
    }
  })

  it('hall : une invitation ou une annonce de ces ids expire et se retire comme les autres', async () => {
    const { s, ws } = connecter('wss://noms/hall')
    const hall = s.lobby('h')
    aFermer.push(() => hall.close())
    const bientot = Date.now() + 15
    for (const id of HERITES) {
      ws.recevoir({ t: 'lobby:invitation', p: { hall: 'h', id, from: { id: 'x' }, expiresAt: bientot } })
      ws.recevoir({ t: 'lobby:listing', p: { hall: 'h', id, from: { id: 'x' }, title: id, expiresAt: bientot } })
    }
    assert.deepEqual(hall.invitations.map((i: any) => i.id), HERITES)
    assert.deepEqual(hall.listings.map((i: any) => i.id), HERITES)
    for (const id of HERITES.slice(0, 3)) ws.recevoir({ t: 'lobby:withdrawn', p: { hall: 'h', id } })
    assert.deepEqual(hall.listings.map((i: any) => i.id), HERITES.slice(3), 'annonces retirées')
    await attendre(60)
    assert.deepEqual(hall.invitations, [], 'invitations échues')
    assert.deepEqual(hall.listings, [], 'annonces échues')
  })

  it('lissage : des entités de ces noms se lissent comme les autres', () => {
    let tache: any = null
    const µ: any = { state: (i: any) => ({ ...i }), warn() {}, _mjs_logger: () => null, _mjs_txt: (_k: string, _v: any, fr: string) => fr, Ticker: { _mjs_tasks: new Set<any>(), add: (t: any) => { tache = t } } }
    new Function('µ', SMOOTH)(µ)
    // `constructor` et `__proto__` : le magasin de sortie, un état réactif (µ.state), les refuse lui-même — joué avec le vrai
    // runtime dans reseau-noms-pieges-controles-une-fois-par-l-etat.test.ts (ici, un faux état sans pièges)
    const noms = HERITES.filter(n => n !== '__proto__' && n !== 'constructor').concat(['a'])
    const source: any = {}
    for (const n of noms) source[n] = { x: 0 }
    const out = µ.smooth(source, { delay: 0 })
    assert.doesNotThrow(() => tache._mjs_step(0))
    for (const n of noms) source[n] = { x: 10 }
    assert.doesNotThrow(() => tache._mjs_step(100))
    for (const n of noms) assert.deepEqual(out[n], { x: 10 }, n)
    out.dispose()
  })
})
