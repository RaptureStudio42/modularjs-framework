// Un coup asynchrone qui ne se règle jamais ne bloque plus l'onglet qui l'a joué. MJS-WS traite les trames d'une connexion une par
// une, et la requête du coup attendait sa fin : tout ce que cet onglet envoyait ensuite (coups, resync, départ) restait sans réponse
// — pour toujours sans battement de cœur. Passé limits.moveWaitMs, la requête du coup reçoit une erreur (le coup, lui, continue sur
// le serveur) et l'onglet répond de nouveau ; un nouveau coup du joueur reçoit un refus clair tant que le coup bloqué n'est pas
// réglé. Un coup qui se règle avant ce délai garde sa réponse.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

function makeMu(): any {
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', clientSrc)(µ)
  return µ
}

async function connecter(transport: MemoryTransport, id: string): Promise<any> {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  const sock = makeMu().socket('memory://' + id, { auth: () => ({ id }), reconnect: { enabled: false } })
  sock.connect()
  await tick()
  return sock
}

const issue = (p: Promise<any>) => p.then((x: any) => 'acquitté ' + JSON.stringify(x?.result ?? null), (e: any) => 'refusé : ' + String(e?.message ?? e))

describe('MJS-Server — coup asynchrone sans réponse : le même onglet est libéré après limits.moveWaitMs', function() {
  this.timeout(10000)

  it('sans battement de cœur : la requête du coup bloqué reçoit une erreur à l échéance, le coup suivant du même onglet un refus clair', async () => {
    const transport = new MemoryTransport()
    const app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, limits: { rate: 1000, burst: 1000 }, onLog: () => {} })
    await app.listen()
    app.game('lent', { seats: 1, code: true, limits: { moveWaitMs: 300 }, state: () => ({ n: 0 }), view: (g: any) => g.state,
      moves: { bloque: () => new Promise(() => {}), joue: (g: any) => { g.state.n++ } } })
    const a = await connecter(transport, 'a')
    const r = await a.request('µgame:play', { type: 'lent', code: true })
    const t0 = Date.now()
    const bloque = await Promise.race([issue(a.request('µgame:move', { game: r.game, move: 'bloque' })), tick(1500).then(() => 'sans réponse après 1,5 s')])
    const delai = Date.now() - t0
    assert.match(bloque, /^refusé : votre coup 'bloque' est resté sans réponse pendant 300 ms/)
    assert.ok(delai >= 250, 'réponse trop tôt : ' + delai + ' ms')
    const suivant = await Promise.race([issue(a.request('µgame:move', { game: r.game, move: 'joue' })), tick(1500).then(() => 'sans réponse après 1,5 s')])
    assert.equal(suivant, 'refusé : votre coup précédent est encore en cours')
    const vue = await a.request('µgame:resync', { game: r.game })
    assert.equal(vue.view.n, 0)
    await app.stop()
  })

  it('un coup asynchrone réglé avant le délai garde sa réponse : sa valeur, ou l erreur de son rejet', async () => {
    const transport = new MemoryTransport()
    const app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, limits: { rate: 1000, burst: 1000 }, onLog: () => {} })
    await app.listen()
    app.game('vif', { seats: 1, code: true, limits: { moveWaitMs: 300 }, state: () => ({}), moves: {
      vite: async () => { await tick(20); return 42 },
      rate: async () => { await tick(20); throw new Error('paiement refusé') },
    } })
    const a = await connecter(transport, 'a')
    const r = await a.request('µgame:play', { type: 'vif', code: true })
    assert.equal(await issue(a.request('µgame:move', { game: r.game, move: 'vite' })), 'acquitté 42')
    assert.equal(await issue(a.request('µgame:move', { game: r.game, move: 'rate' })), 'refusé : paiement refusé')
    await app.stop()
  })
})
