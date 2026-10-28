// sock.chat et sock.lobby ouverts dans un composant ne lui étaient pas rattachés : un composant détruit sans close() laissait ses
// minuteries tourner (frappe, expirations d'invitations et d'annonces) et sa poignée enregistrée sur la connexion (salon rejoint
// de nouveau à chaque reconnexion). Ils suivent désormais le composant actif au moment de l'appel, comme µevery : sa destruction
// ferme la discussion et le hall (salon quitté, minuteries coupées), son retour dans la page les rouvre (salon rejoint de
// nouveau, expirations reposées). Fermés par l'appli, ils le restent ; ouverts hors composant, rien ne change. Une partie
// (sock.game) ne suit pas le composant : elle vit jusqu'à leave() ou la fin de la partie, comme ouverte hors composant.
// Faux WebSocket, pour voir exactement ce que le client envoie ; le composant est réduit à ses deux files (destruction,
// montage), celles de mjs_lifecycle.ts.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const lire = (f: string): string => readFileSync(join(__dirname, '../src/runtime/' + f), 'utf8')
// concaténés comme le fait le bundler : la connexion d'abord, puis discussion, hall et partie
const SRC = ['mjs_socket.ts', 'mjs_chat.ts', 'mjs_lobby.ts', 'mjs_game.ts'].map(lire).join('\n')

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

const avant   = (globalThis as any).WebSocket
const dernier = (): FauxWS => FauxWS.tous[FauxWS.tous.length - 1]
const attendre = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

let actif: any = null
function dans<T>(comp: any, fn: () => T): T { actif = comp; try { return fn() } finally { actif = null } }

function composant(): any {
  return {
    _mjs_destroy_cbs: null as any,
    _mjs_mount_cbs: null as any,
    _mjs_onDestroy(fn: () => void) { (this._mjs_destroy_cbs ||= []).push(fn); return fn },
    detruire() { const cbs = this._mjs_destroy_cbs || []; this._mjs_destroy_cbs = null; for (const f of cbs) f() },
    monter() { const cbs = this._mjs_mount_cbs || []; this._mjs_mount_cbs = null; for (const f of cbs) f.call(this) },
  }
}

function connecter(url: string): { s: any, ws: FauxWS } {
  const µ: any = { state: (i: any) => ({ ...i }), error() {}, warn() {}, log() {} }
  Object.defineProperty(µ, 'activeComponent', { get: () => actif })
  ;(globalThis as any).WebSocket = FauxWS
  new Function('µ', SRC)(µ)
  const s = µ.socket(url, { reconnect: { backoff: [0], jitter: 0 } })
  s.connect()
  const ws = dernier()
  ws.ouvrir()
  ws.recevoir({ t: 'µ:welcome', p: {} })
  return { s, ws }
}

async function reconnecter(): Promise<FauxWS> {
  dernier().couper()
  await attendre(10)
  const ws = dernier()
  ws.ouvrir()
  ws.recevoir({ t: 'µ:welcome', p: {} })
  return ws
}

const envoyes = (ws: FauxWS, type: string): any[] => ws.envoyes.filter(m => m.t === type)
const departs = (ws: FauxWS, salon: string): number => ws.envoyes.filter(m => m.t === 'µ:leave' && m.p.room === salon).length
const entrees = (ws: FauxWS, salon: string): number => ws.envoyes.filter(m => m.t === 'µ:join' && m.p.room === salon).length

// répond à la dernière requête de ce type, puis laisse passer ses rappels
async function repondre(ws: FauxWS, type: string, p: any): Promise<void> {
  const r = envoyes(ws, type).pop()
  ws.recevoir({ t: 'µ:ack', id: r.id, p })
  await attendre(0)
}

const SIEGE = { game: 'g1', seat: 0, view: { grille: [] }, phase: 'jeu', turn: '1', seq: 1, code: null }

describe('sock.chat / sock.lobby rattachés au composant qui les ouvre, sock.game non', () => {
  let effaces: Set<any>
  const vraiClear = globalThis.clearTimeout

  beforeEach(() => {
    FauxWS.tous = []
    actif = null
    effaces = new Set()
    ;(globalThis as any).clearTimeout = (id: any) => { effaces.add(id); return vraiClear(id) }
  })

  afterEach(() => { (globalThis as any).clearTimeout = vraiClear })
  after(() => { (globalThis as any).WebSocket = avant })

  it('discussion : la destruction quitte le salon et coupe les frappes, le retour la rouvre', async () => {
    const { s, ws } = connecter('wss://discussion')
    const comp  = composant()
    const salon = dans(comp, () => s.chat('general'))
    await repondre(ws, 'chat:me', { id: '1', name: 'Zora' })
    const h = s._mjs_chats[0]
    ws.recevoir({ t: 'chat:typing', p: { room: 'general', from: { id: '2', name: 'Theo' } } })
    assert.deepEqual(salon.typingUsers, ['Theo'])
    const frappe = h._mjs_typers['2'].timer
    comp.detruire()
    assert.equal(departs(ws, 'chat:general'), 1, 'le salon est quitté à la destruction du composant')
    assert.equal(s._mjs_chats.length, 0, 'la connexion ne suit plus la poignée')
    assert.ok(effaces.has(frappe), 'la minuterie de frappe est coupée')
    assert.deepEqual(salon.typingUsers, [], 'plus personne n\'écrit')
    const ws2 = await reconnecter()
    assert.equal(entrees(ws2, 'chat:general'), 0, 'le salon n\'est plus rejoint à la reconnexion')
    assert.equal(envoyes(ws2, 'chat:me').length, 0)
    comp.monter()
    assert.equal(entrees(ws2, 'chat:general'), 1, 'au retour du composant, le salon est rejoint de nouveau')
    assert.equal(envoyes(ws2, 'chat:me').length, 1, 'et l\'identité redemandée')
    ws2.recevoir({ t: 'chat:message', p: { room: 'general', id: 'm1', ts: 1, from: { id: '2', name: 'Theo' }, text: 'revenu' } })
    assert.deepEqual(salon.messages.map((m: any) => m.text), ['revenu'], 'la discussion rouverte reçoit les messages')
    comp.detruire()
    assert.equal(departs(ws2, 'chat:general'), 1, 'détruit de nouveau : fermée de nouveau')
    s.destroy()
  })

  it('hall : la destruction le quitte et coupe ses expirations, le retour le rouvre et les repose', async () => {
    const { s, ws } = connecter('wss://hall')
    const comp = composant()
    const hall = dans(comp, () => s.lobby())
    await repondre(ws, 'lobby:enter', { me: { id: '1', name: 'Zora' }, members: [] })
    const h = s._mjs_lobbies[0]
    const de = { id: '2', name: 'Theo' }
    ws.recevoir({ t: 'lobby:invitation', p: { hall: 'hall', id: 'i1', from: de, note: 'viens', expiresAt: Date.now() + 40 } })
    ws.recevoir({ t: 'lobby:listing', p: { hall: 'hall', id: 'a1', from: de, title: 'Partie', expiresAt: Date.now() + 60000 } })
    const invitation = h._mjs_inviteTimers.i1, annonce = h._mjs_listingTimers.a1
    comp.detruire()
    assert.equal(departs(ws, 'lobby:hall'), 1, 'le hall est quitté à la destruction du composant')
    assert.equal(s._mjs_lobbies.length, 0, 'la connexion ne suit plus la poignée')
    assert.ok(effaces.has(invitation) && effaces.has(annonce), 'les expirations sont coupées')
    await attendre(60)
    assert.deepEqual(hall.invitations.map((i: any) => i.id), ['i1'], 'fermé, plus rien ne tourne pour lui')
    comp.monter()
    assert.equal(entrees(ws, 'lobby:hall'), 2, 'au retour du composant, le hall est rejoint de nouveau')
    assert.equal(envoyes(ws, 'lobby:enter').length, 2, 'et l\'entrée redemandée')
    await attendre(5)
    assert.deepEqual(hall.invitations, [], 'l\'invitation échue pendant la fermeture tombe à la réouverture')
    assert.deepEqual(hall.listings.map((a: any) => a.id), ['a1'], 'l\'annonce encore valable reste')
    assert.ok(h._mjs_listingTimers.a1 && h._mjs_listingTimers.a1 !== annonce, 'son expiration est reposée')
    comp.detruire()
    s.destroy()
  })

  it('hall : une entrée encore sans réponse à la fermeture est redemandée à la réouverture, après le retour dans le hall', () => {
    const { s, ws } = connecter('wss://hall-entree-en-route')
    const comp = composant()
    dans(comp, () => s.lobby())
    comp.detruire()
    comp.monter()
    const ordre = ws.envoyes.filter(m => m.t === 'lobby:enter' || m.t === 'µ:join' || m.t === 'µ:leave').map(m => m.t)
    assert.deepEqual(ordre, ['µ:join', 'lobby:enter', 'µ:leave', 'µ:join', 'lobby:enter'], 'l\'entrée d\'avant le départ ne vaut plus')
    s.destroy()
  })

  it('partie assise : ni la destruction ni le retour du composant n\'y touchent, elle vit jusqu\'à leave()', async () => {
    const { s, ws } = connecter('wss://partie-assise')
    const comp   = composant()
    const partie = dans(comp, () => s.game('morpion'))
    let evenements = 0
    partie.on('state', () => { evenements++ })
    await repondre(ws, 'µgame:play', SIEGE)
    assert.equal(partie.state.status, 'playing')
    comp.detruire()
    assert.equal(partie.state.status, 'playing', 'pas quittée')
    assert.equal(envoyes(ws, 'µgame:leave').length, 0, 'le siège reste au serveur')
    ws.recevoir({ t: 'µgame:state', p: { game: 'g1', view: { grille: [1] }, phase: 'jeu', turn: '2', seq: 2 } })
    assert.equal(evenements, 1, 'ses événements arrivent encore')
    assert.equal(partie.state.seq, 2, 'son store est encore mis à jour')
    const ws2 = await reconnecter()
    // page sans µ.lockstep : elle ne lit pas d'instantané, elle n'en déclare pas (`snapshots`)
    assert.deepEqual(envoyes(ws2, 'µgame:resync').map(m => m.p), [{ game: 'g1' }], 'reprise à la reconnexion')
    comp.monter()
    assert.equal(envoyes(ws2, 'µgame:play').length, 0, 'le retour du composant ne la relance pas')
    assert.equal(partie.state.gameId, 'g1')
    partie.leave()
    assert.deepEqual(envoyes(ws2, 'µgame:leave').map(m => m.p), [{ game: 'g1' }], 'leave() reste le départ')
    s.destroy()
  })

  it('partie en file : la destruction ne rend pas le ticket, la reconnexion la remet en file comme hors composant', async () => {
    const { s, ws } = connecter('wss://partie-file')
    const comp   = composant()
    const partie = dans(comp, () => s.game('morpion'))
    await repondre(ws, 'µgame:play', { queue: 2 })
    comp.detruire()
    assert.equal(envoyes(ws, 'µgame:leave').length, 0, 'le ticket reste au serveur')
    assert.equal(partie.state.status, 'waiting')
    assert.equal(partie.state.queue, 2)
    const ws2 = await reconnecter()
    assert.equal(envoyes(ws2, 'µgame:play').length, 1, 'la file est rejouée pour elle')
    comp.monter()
    assert.equal(envoyes(ws2, 'µgame:play').length, 1, 'le retour du composant n\'ajoute rien')
    s.destroy()
  })

  it('µgame:play encore sans réponse quand le composant part et revient : sa réponse l\'assoit, rien d\'autre ne part', async () => {
    const { s, ws } = connecter('wss://partie-en-route')
    const comp    = composant()
    const partie  = dans(comp, () => s.game('morpion', { code: 'ABCDE' }))
    const premier = envoyes(ws, 'µgame:play')[0]
    comp.detruire()
    comp.monter()
    assert.equal(partie.state.status, 'waiting')
    ws.recevoir({ t: 'µ:ack', id: premier.id, p: { ...SIEGE, game: 'g9', code: 'ABCDE' } })
    await attendre(0)
    const ordre = ws.envoyes.filter(m => m.t === 'µgame:leave' || m.t === 'µgame:play').map(m => m.t + ' ' + JSON.stringify(m.p))
    assert.deepEqual(ordre, ['µgame:play {"type":"morpion","code":"ABCDE"}'], 'ni départ, ni second µgame:play')
    assert.equal(partie.state.status, 'playing', 'la réponse du premier appel l\'assoit')
    assert.equal(partie.state.gameId, 'g9')
    s.destroy()
  })

  it('reprise encore sans réponse quand le composant part et revient : elle s\'applique, la poignée garde sa partie', async () => {
    const { s, ws } = connecter('wss://reprise-en-route')
    const comp   = composant()
    const partie = dans(comp, () => s.game('morpion'))
    await repondre(ws, 'µgame:play', SIEGE)
    const ws2 = await reconnecter()
    const reprise = envoyes(ws2, 'µgame:resync')[0]
    assert.ok(reprise, 'la partie assise demande sa reprise')
    comp.detruire()
    comp.monter()
    ws2.recevoir({ t: 'µ:ack', id: reprise.id, p: { ...SIEGE, seq: 5 } })
    await attendre(0)
    assert.equal(partie.state.gameId, 'g1', 'la reprise est appliquée')
    assert.equal(partie.state.status, 'playing')
    assert.equal(partie.state.seq, 5)
    assert.equal(s._mjs_games.g1, partie)
    assert.equal(envoyes(ws2, 'µgame:play').length, 0, 'aucun nouvel appel')
    s.destroy()
  })

  it('fermés par l\'appli, ils le restent : ni la destruction ni le retour du composant n\'y touchent', async () => {
    const { s, ws } = connecter('wss://fermes')
    const comp   = composant()
    const salon  = dans(comp, () => s.chat('general'))
    const hall   = dans(comp, () => s.lobby())
    const partie = dans(comp, () => s.game('morpion'))
    await repondre(ws, 'µgame:play', SIEGE)
    salon.close(); hall.close(); partie.leave()
    const nombre = ws.envoyes.length
    comp.detruire()
    comp.monter()
    assert.equal(ws.envoyes.length, nombre, 'rien ne part')
    assert.equal(partie.state.status, 'left')
    assert.equal(s._mjs_chats.length + s._mjs_lobbies.length + s._mjs_gamesPending.length, 0)
    s.destroy()
  })

  it('partie finie pendant l\'absence du composant : le retour ne la relance pas, le résultat reste', async () => {
    const { s, ws } = connecter('wss://finie-pendant-absence')
    const comp   = composant()
    const partie = dans(comp, () => s.game('morpion'))
    await repondre(ws, 'µgame:play', SIEGE)
    comp.detruire()
    ws.recevoir({ t: 'µgame:end', p: { game: 'g1', result: { gagnant: 0 } } })
    assert.equal(partie.state.status, 'finished', 'la fin arrive même composant parti')
    const nombre = ws.envoyes.length
    comp.monter()
    assert.equal(ws.envoyes.length, nombre, 'rien ne part')
    assert.equal(partie.state.status, 'finished')
    assert.deepEqual(partie.state.result, { gagnant: 0 }, 'le résultat reste affiché')
    s.destroy()
  })

  it('partie finie à la destruction : rien à rendre, rien à relancer', async () => {
    const { s, ws } = connecter('wss://finie')
    const comp   = composant()
    const partie = dans(comp, () => s.game('morpion'))
    await repondre(ws, 'µgame:play', SIEGE)
    ws.recevoir({ t: 'µgame:end', p: { game: 'g1', result: { gagnant: 0 } } })
    assert.equal(partie.state.status, 'finished')
    const nombre = ws.envoyes.length
    comp.detruire()
    comp.monter()
    assert.equal(ws.envoyes.length, nombre, 'rien ne part')
    assert.equal(partie.state.status, 'finished', 'le résultat reste affiché')
    s.destroy()
  })

  it('ouverts hors composant : rien ne change', async () => {
    const { s, ws } = connecter('wss://hors-composant')
    const autre = composant()
    s.chat('general'); s.lobby(); s.game('morpion')
    dans(autre, () => s.room('ailleurs'))
    autre.detruire()
    autre.monter()
    assert.equal(departs(ws, 'chat:general') + departs(ws, 'lobby:hall'), 0)
    assert.equal(envoyes(ws, 'µgame:leave').length, 0)
    assert.equal(s._mjs_chats.length + s._mjs_lobbies.length + s._mjs_gamesPending.length, 3, 'toujours suivis par la connexion')
    s.destroy()
  })
})
