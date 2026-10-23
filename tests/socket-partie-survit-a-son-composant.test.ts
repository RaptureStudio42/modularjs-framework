// une partie (sock.game) ouverte dans un composant n'est pas rattachée à ce composant : elle vit jusqu'à leave() ou la fin de la
// partie, que le composant disparaisse ou revienne. Relancée comme un nouvel appel au retour du composant, elle cassait les
// parties privées (le créateur recevait une table neuve et un code neuf, ses invités étaient renvoyés, l'ancien code ne menait
// plus nulle part) et une partie finie pendant l'absence repartait d'elle-même en file publique, appariée à un inconnu.
// Vrai MJS-Server sur un transport en mémoire, vrai client (mjs_socket.ts + mjs_game.ts) ; le composant est réduit à ses deux
// files (destruction, montage), celles de mjs_lifecycle.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = ['mjs_socket.ts', 'mjs_game.ts'].map(f => readFileSync(join(__dirname, '../src/runtime/' + f), 'utf8')).join('\n')

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

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

function client(transport: MemoryTransport, id: string): any {
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {}, _mjs_txt: (_k: any, _v: any, d: string) => d, _mjs_msg: (_k: any, _v: any, d: string) => d }
  Object.defineProperty(µ, 'activeComponent', { get: () => actif })
  const FauxWebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  new Function('µ', 'WebSocket', clientSrc)(µ, FauxWebSocket)
  return µ.socket('memory://' + id, { auth: () => ({ id }), reconnect: { enabled: false } })
}

async function serveur(): Promise<{ app: any, transport: MemoryTransport }> {
  const transport = new MemoryTransport()
  const app: any = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, limits: { rate: 1000, burst: 1000 }, onLog: () => {} } as any)
  await app.listen()
  app.game('salon', { seats: 3, code: true, state: () => ({}), moves: { rien: () => {} } })
  app.game('duel', { seats: 2, state: () => ({}), moves: { fin: (g: any) => { g.end({ gagnant: 1 }) } } })
  return { app, transport }
}

describe('sock.game — une partie ouverte dans un composant survit à sa disparition et à son retour', function() {
  this.timeout(10000)

  it('partie privée : le créateur qui revient garde sa table et son code, son invité reste assis, le code accueille encore', async () => {
    const { app, transport } = await serveur()
    const sa = client(transport, 'a'), sb = client(transport, 'b'), sc = client(transport, 'c')
    const comp   = composant()
    const partie = dans(comp, () => sa.game('salon', { code: true }))
    await tick(50)
    const code = partie.state.code, jeu = partie.state.gameId
    assert.ok(code && jeu, 'table créée')
    const fins: any[] = []
    const invite = sb.game('salon', { code })
    invite.on('end', (p: any) => { fins.push(p.result) })
    await tick(50)
    assert.equal(invite.state.status, 'playing')
    comp.detruire()
    await tick(50)
    comp.monter()
    await tick(100)
    assert.equal(partie.state.code, code, 'même code')
    assert.equal(partie.state.gameId, jeu, 'même table')
    assert.equal(partie.state.status, 'playing')
    assert.deepEqual(fins, [], 'l\'invité n\'est pas renvoyé')
    assert.equal(invite.state.status, 'playing')
    const second = sc.game('salon', { code })
    await tick(50)
    assert.equal(second.state.status, 'playing', 'l\'ancien code mène toujours à la table')
    assert.equal(second.state.gameId, jeu)
    await app.stop()
  })

  it('partie finie pendant l\'absence du composant : le résultat reste, rien n\'est relancé, le joueur suivant attend en file', async () => {
    const { app, transport } = await serveur()
    const sd = client(transport, 'd'), se = client(transport, 'e'), sf = client(transport, 'f')
    const comp   = composant()
    const partie = dans(comp, () => sd.game('duel'))
    await tick(30)
    const adverse = se.game('duel')
    await tick(80)
    assert.equal(partie.state.status, 'playing')
    comp.detruire()
    await tick(30)
    await adverse.move('fin', {})
    await tick(80)
    assert.equal(partie.state.status, 'finished', 'la fin arrive même composant parti')
    comp.monter()
    await tick(150)
    assert.equal(partie.state.status, 'finished', 'pas relancée')
    assert.deepEqual(partie.state.result, { gagnant: 1 }, 'résultat gardé')
    const suivant = sf.game('duel')
    await tick(80)
    assert.equal(suivant.state.status, 'waiting', 'le joueur suivant n\'est apparié à personne')
    assert.equal(suivant.state.queue, 1)
    await app.stop()
  })
})
