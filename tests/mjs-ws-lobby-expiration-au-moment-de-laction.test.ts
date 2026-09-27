// lobby.ts — l'expiration d'une invitation/annonce doit être vérifiée AU MOMENT de l'action
// (lobby:reply/lobby:join), pas seulement au balayage opportuniste (jusqu'à 50 actions de délai,
// cf. docs/28-lobby.md §9) : une invitation/annonce déjà expirée ne doit plus jamais être acceptable.
// Même technique que tests/mjs-ws-lobby.test.ts (vrai client µ.socket, MemoryTransport).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsWs, lobbyPackage } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsWsApp, MjsWsOptions } from '../src/mjs-ws/index.js'
import type { MjsWsLobbyOptions } from '../src/mjs-ws/lobby.js'
import type { MjsPackage } from '../src/mjs-ws/packages.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

function makeMu(): any {
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', clientSrc)(µ)
  return µ
}
function makeClient(transport: MemoryTransport): any {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  return makeMu()
}
async function startApp(lobbyOpts: MjsWsLobbyOptions = {}, wsOpts: MjsWsOptions = {}): Promise<{ transport: MemoryTransport; app: MjsWsApp; pkg: MjsPackage }> {
  const transport = new MemoryTransport()
  const app = mjsWs({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, onLog: () => {}, ...wsOpts })
  const pkg = lobbyPackage({ onLog: () => {}, ...lobbyOpts })
  app.use(pkg)
  await app.listen()
  return { transport, app, pkg }
}
function connect(transport: MemoryTransport, url: string, identity: unknown): any {
  const s = makeClient(transport).socket(url, { auth: () => identity, reconnect: { enabled: false } })
  s.connect()
  return s
}
function joinHall(s: any, hall = 'hall', prefixe = 'lobby:'): void { s.room(prefixe + hall) }
async function entrer(s: any, hall?: string): Promise<any> { return s.request('lobby:enter', hall === undefined ? {} : { hall }) }

const zora = { id: '1', name: 'Zora' }
const theo = { id: '2', name: 'Theo' }

describe('MJS-WS — lobby.ts, expiration vérifiée AU MOMENT de l\'action', () => {
  it('lobby:reply sur une invitation déjà expirée (avant le balayage) → lobby-invitation-unknown, jamais acceptée', async () => {
    const { transport, app, pkg } = await startApp()
    const sZ = connect(transport, 'memory://exp1z', zora)
    const sT = connect(transport, 'memory://exp1t', theo)
    joinHall(sZ); joinHall(sT); await tick()
    await entrer(sZ); await entrer(sT)

    const recuInvT: any[] = []
    sT.on('lobby:invitation', (p: any) => recuInvT.push(p))
    sZ.send('lobby:invite', { identityId: theo.id })
    await tick()
    assert.ok(recuInvT.length > 0, 'invitation reçue par Theo')
    const invitationId = recuInvT[0].id

    // expire l'invitation DIRECTEMENT (introspection TEST-ONLY, cf. tête de lobby.ts) — bien AVANT
    // les 50 actions du balayage opportuniste
    const invMap = (pkg as any)._invitations.get('lobby:hall')
    invMap.get(invitationId).expireAt = Date.now() - 1000

    let repliedSeenByZora: any = null
    sZ.on('lobby:replied', (p: any) => { repliedSeenByZora = p })
    sT.send('lobby:reply', { id: invitationId, accepted: true })
    await tick(30)

    assert.equal(sT.lastError?.message, 'lobby-invitation-unknown', 'expirée → même code que « inconnue », pas d\'acceptation')
    assert.equal(repliedSeenByZora, null, 'Zora ne reçoit JAMAIS lobby:replied pour une invitation expirée')

    sZ.destroy(); sT.destroy(); await app.stop()
  })

  it('lobby:join sur une annonce déjà expirée (avant le balayage) → lobby-listing-unknown, jamais rejointe', async () => {
    const { transport, app, pkg } = await startApp()
    const sZ = connect(transport, 'memory://exp2z', zora)
    const sT = connect(transport, 'memory://exp2t', theo)
    joinHall(sZ); joinHall(sT); await tick()
    await entrer(sZ); await entrer(sT)

    const recuAnnT: any[] = []
    sT.on('lobby:listing', (p: any) => recuAnnT.push(p))
    sZ.send('lobby:advertise', { title: 'Table de Zora' })
    await tick()
    assert.ok(recuAnnT.length > 0, 'annonce reçue par Theo')
    const listingId = recuAnnT[0].id

    const listMap = (pkg as any)._listings.get('lobby:hall')
    listMap.get(listingId).expireAt = Date.now() - 1000

    let applicantSeenByZora: any = null
    sZ.on('lobby:applicant', (p: any) => { applicantSeenByZora = p })
    sT.send('lobby:join', { id: listingId })
    await tick(30)

    assert.equal(sT.lastError?.message, 'lobby-listing-unknown', 'annonce expirée → refusée, pas de rejoindre')
    assert.equal(applicantSeenByZora, null, 'Zora ne reçoit JAMAIS lobby:applicant pour une annonce expirée')

    sZ.destroy(); sT.destroy(); await app.stop()
  })

  it('lobby:withdraw sur sa PROPRE annonce déjà expirée (avant le balayage) → lobby-listing-unknown, jamais retirée', async () => {
    const { transport, app, pkg } = await startApp()
    const sZ = connect(transport, 'memory://exp3z', zora)
    joinHall(sZ); await tick()
    await entrer(sZ)

    sZ.send('lobby:advertise', { title: 'Table de Zora' })
    await tick()
    const listMap = (pkg as any)._listings.get('lobby:hall')
    const listingId = Array.from(listMap.keys())[0] as string
    assert.ok(listingId, 'annonce créée')
    listMap.get(listingId).expireAt = Date.now() - 1000   // déjà expirée

    let withdrawn: any = null
    sZ.on('lobby:withdrawn', (p: any) => { withdrawn = p })
    sZ.send('lobby:withdraw', {})
    await tick(30)

    assert.equal(sZ.lastError?.message, 'lobby-listing-unknown', 'expirée → même code que « inconnue », pas de retrait')
    assert.equal(withdrawn, null, 'aucun lobby:withdrawn n\'est diffusé pour une annonce déjà expirée')

    sZ.destroy(); await app.stop()
  })
})
