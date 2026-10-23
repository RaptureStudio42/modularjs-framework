// Deux poignées du même salon sur une même connexion (une discussion et un autre composant qui écoute ce salon, deux
// halls du même nom, un effet en direct et l'appli) : fermer l'une envoyait `µ:leave` et retirait toutes les écoutes du
// salon, celles de l'autre comprises — l'autre restait ouverte mais sourde, et le salon n'était plus rejoint à la
// reconnexion. Le salon compte désormais ses poignées : chaque départ ne retire que les écoutes de sa poignée, `µ:leave`
// et la purge (flux, présence, rappel d'exclusion) n'arrivent qu'au départ de la dernière. Un salon perdu entre-temps
// (exclusion par le serveur) repart à zéro : une poignée d'avant ne décompte plus le salon rejoint de nouveau.
// Faux WebSocket, pour voir exactement ce que le client envoie.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const lire = (f: string): string => readFileSync(join(__dirname, '../src/runtime/' + f), 'utf8')
// concaténés comme le fait le bundler : la connexion d'abord, la discussion et le hall ensuite
const SRC = lire('mjs_socket.ts') + '\n' + lire('mjs_chat.ts') + '\n' + lire('mjs_lobby.ts')

class FauxWS {
  static tous: FauxWS[] = []
  url: string; readyState = 0; envoyes: any[] = []
  onopen: any; onmessage: any; onclose: any; onerror: any
  constructor(url: string) { this.url = url; FauxWS.tous.push(this) }
  send(data: string) { this.envoyes.push(JSON.parse(data)) }
  close() { this.readyState = 3 }
  ouvrir() { this.readyState = 1; this.onopen && this.onopen({}) }
  recevoir(obj: any) { this.onmessage && this.onmessage({ data: JSON.stringify(obj) }) }
  couper() { this.readyState = 3; this.onclose && this.onclose({ code: 1006 }) }
}

const avant = (globalThis as any).WebSocket
const dernier = (): FauxWS => FauxWS.tous[FauxWS.tous.length - 1]
const attendre = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

function connecter(url: string): { µ: any, s: any, ws: FauxWS } {
  const µ: any = { state: (i: any) => ({ ...i }), error() {}, warn() {}, log() {} }
  ;(globalThis as any).WebSocket = FauxWS
  new Function('µ', SRC)(µ)
  const s = µ.socket(url, { reconnect: { backoff: [0], jitter: 0 } })
  s.connect()
  const ws = dernier()
  ws.ouvrir()
  ws.recevoir({ t: 'µ:welcome', p: {} })
  return { µ, s, ws }
}

const departs = (ws: FauxWS, salon: string): number => ws.envoyes.filter(m => m.t === 'µ:leave' && m.p.room === salon).length
const entrees = (ws: FauxWS, salon: string): number => ws.envoyes.filter(m => m.t === 'µ:join' && m.p.room === salon).length

// coupure puis retour : le fil neuf, après son accueil
async function reconnecter(): Promise<FauxWS> {
  dernier().couper()
  await attendre(10)
  const ws = dernier()
  ws.ouvrir()
  ws.recevoir({ t: 'µ:welcome', p: {} })
  return ws
}

describe('µ.socket — un salon tenu par plusieurs poignées', () => {
  beforeEach(() => { FauxWS.tous = [] })
  after(() => { (globalThis as any).WebSocket = avant })

  it('deux room() du même salon : le départ de l\'une garde le salon et les écoutes de l\'autre', () => {
    const { s, ws } = connecter('wss://deux-salons')
    const a = s.room('partie'), b = s.room('partie')
    const vusA: any[] = [], vusB: any[] = []
    a.on('coup', (p: any) => vusA.push(p))
    b.on('coup', (p: any) => vusB.push(p))
    a.leave()
    assert.equal(departs(ws, 'partie'), 0, 'aucun µ:leave tant qu\'une autre poignée tient le salon')
    ws.recevoir({ t: 'partie/coup', p: { i: 1 } })
    assert.deepEqual(vusB, [{ i: 1 }], 'l\'autre poignée entend toujours le salon')
    assert.deepEqual(vusA, [], 'la poignée partie n\'entend plus rien')
    b.leave()
    assert.equal(departs(ws, 'partie'), 1, 'la dernière poignée quitte le salon')
    ws.recevoir({ t: 'partie/coup', p: { i: 2 } })
    assert.deepEqual(vusB, [{ i: 1 }], 'plus rien après le départ de la dernière')
    s.destroy()
  })

  it('un départ répété ne décompte qu\'une fois', () => {
    const { s, ws } = connecter('wss://depart-repete')
    const a = s.room('partie'), b = s.room('partie')
    a.leave()
    a.leave()
    assert.equal(departs(ws, 'partie'), 0, 'le second départ de la même poignée ne compte pas pour l\'autre')
    b.leave()
    b.leave()
    assert.equal(departs(ws, 'partie'), 1)
    s.destroy()
  })

  it('une discussion et un autre composant sur le même salon : fermer la discussion ne coupe pas l\'autre', async () => {
    const { s, ws } = connecter('wss://discussion-et-zone')
    const salon = s.chat('general')
    const zone  = s.room('chat:general')
    const sondages: any[] = []
    zone.on('sondage', (p: any) => sondages.push(p))
    salon.close()
    assert.equal(departs(ws, 'chat:general'), 0, 'fermer la discussion ne quitte pas le salon que l\'autre tient')
    ws.recevoir({ t: 'chat:general/sondage', p: { q: 'pizza ?' } })
    assert.deepEqual(sondages, [{ q: 'pizza ?' }], 'l\'autre composant entend toujours le salon')
    const ws2 = await reconnecter()
    assert.equal(entrees(ws2, 'chat:general'), 1, 'le salon est rejoint de nouveau à la reconnexion')
    zone.leave()
    assert.equal(departs(ws2, 'chat:general'), 1, 'quitté au départ du dernier')
    s.destroy()
  })

  it('deux halls du même nom : fermer l\'un garde l\'autre dans le hall', async () => {
    const { s, ws } = connecter('wss://deux-halls')
    const h1 = s.lobby('vip'), h2 = s.lobby('vip')
    h1.close()
    assert.equal(departs(ws, 'lobby:vip'), 0)
    ws.recevoir({ t: 'lobby:member', p: { hall: 'vip', id: '7', name: 'Zora', status: 'free' } })
    assert.deepEqual(h2.members.map((m: any) => m.id), ['7'], 'le hall qui reste suit toujours les membres')
    const ws2 = await reconnecter()
    assert.equal(entrees(ws2, 'lobby:vip'), 1, 'le hall est rejoint de nouveau à la reconnexion')
    h2.close()
    assert.equal(departs(ws2, 'lobby:vip'), 1)
    s.destroy()
  })

  it('flux et présence du salon restent tant qu\'une poignée le tient, purgés au départ de la dernière', () => {
    const { s } = connecter('wss://flux-presence')
    const a = s.room('partie'), b = s.room('partie')
    const flux = a.stream('pos')
    b.presence()
    a.leave()
    assert.ok('partie/pos' in s._mjs_streams, 'le flux, partagé, reste à la poignée qui tient le salon')
    assert.equal(b.stream('pos'), flux, 'c\'est le même flux')
    assert.ok('partie' in s._mjs_presence)
    b.leave()
    assert.equal('partie/pos' in s._mjs_streams, false)
    assert.equal('partie' in s._mjs_presence, false)
    s.destroy()
  })

  it('rappel d\'exclusion : le départ d\'une poignée ne retire que le sien', () => {
    const { s, ws } = connecter('wss://exclusion-rappel')
    const a = s.room('partie'), b = s.room('partie')
    const exclus: string[] = []
    a.onLeft(() => exclus.push('a'))
    const c = s.room('autre')
    c.onLeft(() => exclus.push('c'))
    b.onLeft(() => exclus.push('b'))
    a.leave()
    ws.recevoir({ t: 'µ:left', p: { room: 'partie', reason: 'kick' } })
    assert.deepEqual(exclus, ['b'], 'la poignée restante est prévenue de son exclusion')
    s.destroy()
  })

  it('après une exclusion, une poignée d\'avant ne décompte pas le salon rejoint de nouveau', () => {
    const { s, ws } = connecter('wss://exclusion-retour')
    const a = s.room('partie')
    ws.recevoir({ t: 'µ:left', p: { room: 'partie', reason: 'kick' } })
    const nouvelle = s.room('partie')
    assert.equal(entrees(ws, 'partie'), 2, 'le salon est rejoint de nouveau')
    a.leave()
    assert.equal(departs(ws, 'partie'), 0, 'la poignée d\'avant l\'exclusion ne fait pas quitter la nouvelle')
    nouvelle.leave()
    assert.equal(departs(ws, 'partie'), 1)
    s.destroy()
  })

  it('effet en direct et appli sur le même salon : le départ des effets garde l\'appli dans le salon', () => {
    const { µ, s, ws } = connecter('wss://effet-et-appli')
    const appli = s.room('follow:/')
    const z1 = µ._mjs_fxRoom(s, 'follow:/'), z2 = µ._mjs_fxRoom(s, 'follow:/')
    z1.leave()
    assert.equal(departs(ws, 'follow:/'), 0, 'un effet tient encore le salon')
    z2.leave()
    assert.equal(departs(ws, 'follow:/'), 0, 'l\'appli tient encore le salon')
    appli.leave()
    assert.equal(departs(ws, 'follow:/'), 1)
    s.destroy()
  })
})
