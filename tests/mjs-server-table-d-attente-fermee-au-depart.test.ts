// Une table jamais complète (partie par code qui attend ses invités) dont le dernier joueur connecté s'en va — créateur refusé par
// hooks.onJoin, onglet rechargé ou fermé, µgame:leave — est fermée tout de suite : son code est oublié et elle ne compte plus pour la
// borne des parties privées de son créateur. De même une partie dont plus aucun siège n'est occupé (tous partis), file publique
// comprise : personne ne peut plus y revenir. Avant, ces tables vides vivaient emptyTtl (60 s par défaut) : cinq refus de onJoin, ou
// une page rechargée cinq fois, bloquaient la création suivante ; une connexion qui enchaînait play/leave dans la file publique
// gardait autant de parties qu'elle en demandait. emptyTtl ne garde plus que les parties commencées dont des joueurs déconnectés
// peuvent revenir.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsServerApp } from '../src/mjs-server/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

function makeMu(): any {
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', clientSrc)(µ)
  return µ
}

async function startApp(): Promise<{ transport: MemoryTransport; app: MjsServerApp }> {
  const transport = new MemoryTransport()
  const app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, limits: { rate: 1000, burst: 1000 }, onLog: () => {} })
  await app.listen()
  return { transport, app }
}

async function connecter(transport: MemoryTransport, id: string): Promise<any> {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  const sock = makeMu().socket('memory://' + id, { auth: () => ({ id }), reconnect: { enabled: false } })
  sock.connect()
  await tick()
  return sock
}

const raison = (e: any) => String(e?.message ?? e)

/** issue d'une demande : « créée », ou le message du refus */
function issue(p: Promise<any>): Promise<string> {
  return p.then(() => 'créée', (e: any) => 'refusée : ' + raison(e))
}

describe('MJS-Server — table d attente fermée au départ de son dernier joueur', function() {
  this.timeout(20000)

  for (const forme of ['throw', 'Promise rejetée']) {
    it('créateur refusé cinq fois par hooks.onJoin (' + forme + ') : sa 6e demande, admise, crée bien sa partie', async () => {
      const { transport, app } = await startApp()
      let refuser = true
      app.game('payant', { seats: 2, code: true, state: () => ({}), moves: {},
        hooks: { onJoin: () => { if (!refuser) return undefined; if (forme === 'throw') throw new Error('solde insuffisant'); return Promise.reject(new Error('solde insuffisant')) } } })
      const a = await connecter(transport, 'a')
      for (let i = 0; i < 5; i++) await assert.rejects(a.request('µgame:play', { type: 'payant', code: true }))
      refuser = false
      assert.equal(await issue(a.request('µgame:play', { type: 'payant', code: true })), 'créée')
      await app.stop()
    })
  }

  it('page rechargée six fois (une connexion par chargement, qui crée sa table) : chaque création passe, la table précédente est fermée', async () => {
    const { transport, app } = await startApp()
    app.game('duo', { seats: 2, code: true, state: () => ({}), moves: {} })
    const issues: string[] = []
    const codes: string[] = []
    for (let i = 0; i < 6; i++) {
      const a = await connecter(transport, 'a')
      issues.push(await a.request('µgame:play', { type: 'duo', code: true }).then((r: any) => { codes.push(r.code); return 'créée' }, (e: any) => 'refusée : ' + raison(e)))
      a.close()
      await tick(10)
    }
    assert.deepEqual(issues, ['créée', 'créée', 'créée', 'créée', 'créée', 'créée'])
    const b = await connecter(transport, 'b')
    await assert.rejects(b.request('µgame:play', { type: 'duo', code: codes[0] }), /code inconnu/)
    await app.stop()
  })

  it('le créateur quitte sa table d attente (µgame:leave) : elle est fermée, son code ne mène plus nulle part', async () => {
    const { transport, app } = await startApp()
    app.game('duo', { seats: 2, code: true, state: () => ({}), moves: {} })
    const a = await connecter(transport, 'a')
    const b = await connecter(transport, 'b')
    const r = await a.request('µgame:play', { type: 'duo', code: true })
    await a.request('µgame:leave', { game: r.game })
    await assert.rejects(b.request('µgame:play', { type: 'duo', code: r.code }), /code inconnu/)
    await app.stop()
  })

  it('file publique, jeu à une place : une connexion qui enchaîne 40 play/leave ne laisse aucune partie derrière elle', async () => {
    const { transport, app } = await startApp()
    app.game('solo-file', { seats: 1, state: () => ({}), moves: {} })
    const a = await connecter(transport, 'a')
    const encoreLa: string[] = []
    for (let i = 0; i < 40; i++) {
      const r = await a.request('µgame:play', { type: 'solo-file' })
      await a.request('µgame:leave', { game: r.game })
      const apres = await a.request('µgame:resync', { game: r.game }).then(() => 'resync accepté', (e: any) => raison(e))
      if (!/partie introuvable/.test(apres)) encoreLa.push(r.game + ' : ' + apres)
    }
    assert.deepEqual(encoreLa, [])
    await app.stop()
  })

  it('partie par code à une place créée puis quittée en boucle : aucune ne reste derrière', async () => {
    const { transport, app } = await startApp()
    app.game('solo', { seats: 1, code: true, state: () => ({}), moves: {} })
    const a = await connecter(transport, 'a')
    const encoreLa: string[] = []
    for (let i = 0; i < 12; i++) {
      const r = await a.request('µgame:play', { type: 'solo', code: true })
      await a.request('µgame:leave', { game: r.game })
      const apres = await a.request('µgame:resync', { game: r.game }).then(() => 'resync accepté', (e: any) => raison(e))
      if (!/partie introuvable/.test(apres)) encoreLa.push(r.game + ' : ' + apres)
    }
    assert.deepEqual(encoreLa, [])
    await app.stop()
  })

  it('table d attente à trois places : tant qu un joueur assis y reste connecté, le départ des autres ne la ferme pas', async () => {
    const { transport, app } = await startApp()
    app.game('trio', { seats: 3, code: true, state: () => ({}), moves: {} })
    const a = await connecter(transport, 'a')
    const b = await connecter(transport, 'b')
    const c = await connecter(transport, 'c')
    const r = await a.request('µgame:play', { type: 'trio', code: true })
    await b.request('µgame:play', { type: 'trio', code: r.code })
    a.close()
    await tick(10)
    const entree = await c.request('µgame:play', { type: 'trio', code: r.code })
    assert.equal(entree.game, r.game)
    await app.stop()
  })

  it('partie commencée dont tous les joueurs se déconnectent : elle reste emptyTtl, le joueur qui revient retrouve son siège', async () => {
    const { transport, app } = await startApp()
    app.game('duo', { seats: 2, code: true, state: () => ({}), moves: {} })
    const a = await connecter(transport, 'a')
    const b = await connecter(transport, 'b')
    const r = await a.request('µgame:play', { type: 'duo', code: true })
    await b.request('µgame:play', { type: 'duo', code: r.code })
    a.close()
    b.close()
    await tick(10)
    const a2 = await connecter(transport, 'a')
    const retour = await a2.request('µgame:resync', { game: r.game })
    assert.equal(retour.seat, 0)
    await app.stop()
  })

  it('file publique à deux places : l un part, l autre se déconnecte — la partie l attend, il retrouve son siège', async () => {
    const { transport, app } = await startApp()
    app.game('duel', { seats: 2, state: () => ({}), moves: {} })
    const a = await connecter(transport, 'a')
    const b = await connecter(transport, 'b')
    await a.request('µgame:play', { type: 'duel' })
    const r = await b.request('µgame:play', { type: 'duel' })
    await a.request('µgame:leave', { game: r.game })
    b.close()
    await tick(10)
    const b2 = await connecter(transport, 'b')
    const retour = await b2.request('µgame:resync', { game: r.game })
    assert.equal(retour.seat, r.seat)
    await app.stop()
  })
})
