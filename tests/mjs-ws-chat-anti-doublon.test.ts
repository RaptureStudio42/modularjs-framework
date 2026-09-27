// Tests de l'option anti-doublon du paquet CHAT (src/mjs-ws/chat.ts, opts.duplicates) — MÊME
// technique que tests/mjs-ws-chat.test.ts (vrai client µ.socket, MemoryTransport,
// app.use(chatPackage(...))) : le client ici reste le socket BRUT (s.on/s.send).
//
// Couvre : option absente (comportement actuel STRICTEMENT inchangé), activée (`true` → fenêtre
// 30 000 ms implicite, objet → `within` personnalisée), normalisation (casse/espaces internes),
// portée (par salon, par identité), articulation avec onMessage (un refus n'enregistre jamais),
// mémoire bornée (salon vidé, entrée expirée) — même balayage opportuniste que
// buckets/lastTypingAt/mutedUntil.
//
// `s.room(prefixe + salon)` est appelé AVANT tout chat:send dans chaque test — chatPackage exige
// l'adhésion au salon MJS-WS bas niveau (µ:join) AVANT toute action chat (cf. mjs-ws-chat.test.ts).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsWs, chatPackage } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsWsApp, MjsWsOptions } from '../src/mjs-ws/index.js'
import type { MjsWsChatOptions } from '../src/mjs-ws/chat.js'
import type { MjsPackage } from '../src/mjs-ws/packages.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

// même stub minimal que tests/mjs-ws-chat.test.ts — µ.state non réactif (simple copie) : ces
// tests portent sur le PROTOCOLE serveur, pas sur la réactivité MJS.
function makeMu(): any {
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', clientSrc)(µ)
  return µ
}

function makeClient(transport: MemoryTransport): any {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  return makeMu()
}

// débit LARGEMENT ouvert par défaut — ces tests portent sur l'anti-doublon, jamais sur le seau à
// jetons (déjà couvert par mjs-ws-chat.test.ts) : neutralise chat-rate pour enchaîner plusieurs
// envois sans attendre le refill.
async function startApp(chatOpts: MjsWsChatOptions = {}, wsOpts: MjsWsOptions = {}): Promise<{ transport: MemoryTransport; app: MjsWsApp; pkg: MjsPackage }> {
  const transport = new MemoryTransport()
  const app = mjsWs({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, onLog: () => {}, ...wsOpts })
  const pkg = chatPackage({ rateLimit: { rate: 1000, burst: 1000 }, ...chatOpts })
  app.use(pkg)
  await app.listen()
  return { transport, app, pkg }
}

function connect(transport: MemoryTransport, url: string, identity: unknown): any {
  const s = makeClient(transport).socket(url, { auth: () => identity, reconnect: { enabled: false } })
  s.connect()
  return s
}

// rejoint le salon MJS-WS bas niveau (µ:join) — préalable à toute action chat
function joinRoom(s: any, room: string, prefix = 'chat:'): void {
  s.room(prefix + room)
}

// mémoire bornée — fait franchir le seuil de balayage GLOBAL du paquet (SWEEP_EVERY_N_ACTIONS =
// 50, chat.ts) : connecte un client-BRUIT dédié dans un salon dédié et y enchaîne 80 chat:typing
// (jamais journalisée — juste compter comme « une action chat »), marge volontaire au-delà du
// seuil réel. N'affecte jamais le salon/l'identité sous test — le balayage déclenché est GLOBAL.
async function triggerGlobalSweep(transport: MemoryTransport): Promise<void> {
  const s = connect(transport, 'memory://bruit-balayage-doublon', { id: 'bruit' })
  joinRoom(s, 'bruit-balayage-doublon')
  await tick()
  for (let i = 0; i < 80; i++) s.send('chat:typing', { room: 'bruit-balayage-doublon' })
  await tick()
  s.destroy()
  await tick()
}

const zora = { id: '1', name: 'Zora' }
const theo = { id: '2', name: 'Theo' }

describe('MJS-WS — paquet CHAT — anti-doublon (chat.ts, opts.duplicates)', () => {

  describe('option absente (défaut) — comportement actuel STRICTEMENT inchangé', () => {
    it('a. même texte envoyé deux fois — deux diffusions, jamais de chat-duplicate', async () => {
      const { transport, app } = await startApp()
      const s = connect(transport, 'memory://ad-a', zora)
      const received: any[] = []
      s.on('chat:message', (p: any) => received.push(p))
      joinRoom(s, 'general'); await tick()
      s.send('chat:send', { room: 'general', text: 'salut à tous' })
      await tick()
      s.send('chat:send', { room: 'general', text: 'salut à tous' })
      await tick()
      assert.equal(received.length, 2, "désactivé par défaut — l'option n'existait pas avant, rien ne change")
      assert.equal(s.lastError, null)
      s.destroy(); await app.stop()
    })
  })

  describe('duplicates: true — fenêtre 30 000 ms implicite', () => {
    it('b. même texte deux fois de suite — un seul diffusé, le second chat-duplicate', async () => {
      const { transport, app } = await startApp({ duplicates: true })
      const s = connect(transport, 'memory://ad-b', zora)
      const received: any[] = []
      s.on('chat:message', (p: any) => received.push(p))
      joinRoom(s, 'general'); await tick()
      s.send('chat:send', { room: 'general', text: 'salut à tous' })
      await tick()
      s.send('chat:send', { room: 'general', text: 'salut à tous' })
      await tick()
      assert.equal(received.length, 1, 'un seul diffusé')
      assert.equal(s.lastError.message, 'chat-duplicate')
      s.destroy(); await app.stop()
    })

    it('c. variantes de casse/espaces internes — même texte normalisé, refusées', async () => {
      const { transport, app } = await startApp({ duplicates: true })
      const s = connect(transport, 'memory://ad-c', zora)
      const received: any[] = []
      s.on('chat:message', (p: any) => received.push(p))
      joinRoom(s, 'general'); await tick()
      s.send('chat:send', { room: 'general', text: 'Salut  à Tous' })
      await tick()
      s.send('chat:send', { room: 'general', text: 'salut à tous' })
      await tick()
      assert.equal(received.length, 1, 'casse et espaces internes ignorés — même texte')
      assert.equal(s.lastError.message, 'chat-duplicate')
      s.destroy(); await app.stop()
    })

    it('d. texte différent — accepté', async () => {
      const { transport, app } = await startApp({ duplicates: true })
      const s = connect(transport, 'memory://ad-d1', zora)
      const received: any[] = []
      s.on('chat:message', (p: any) => received.push(p))
      joinRoom(s, 'general'); await tick()
      s.send('chat:send', { room: 'general', text: 'salut à tous' })
      await tick()
      s.send('chat:send', { room: 'general', text: 'autre chose' })
      await tick()
      assert.equal(received.length, 2, 'texte différent — jamais un doublon')
      s.destroy(); await app.stop()
    })

    it('d. même texte dans un AUTRE salon — accepté (portée par salon)', async () => {
      const { transport, app } = await startApp({ duplicates: true })
      const s = connect(transport, 'memory://ad-d2', zora)
      const received: any[] = []
      s.on('chat:message', (p: any) => received.push(p))
      joinRoom(s, 'general'); joinRoom(s, 'random'); await tick()
      s.send('chat:send', { room: 'general', text: 'salut à tous' })
      await tick()
      s.send('chat:send', { room: 'random', text: 'salut à tous' })
      await tick()
      assert.equal(received.length, 2, 'salon différent — chaque salon a SA propre mémoire')
      s.destroy(); await app.stop()
    })

    it('d. même texte par une AUTRE identité — accepté (portée par identité)', async () => {
      const { transport, app } = await startApp({ duplicates: true })
      const sZ = connect(transport, 'memory://ad-d3z', zora)
      const sT = connect(transport, 'memory://ad-d3t', theo)
      const recu: any[] = []   // les deux sockets sont dans le MÊME salon (broadcast) — un seul relevé suffit
      sZ.on('chat:message', (p: any) => recu.push(p))
      joinRoom(sZ, 'general'); joinRoom(sT, 'general'); await tick()
      sZ.send('chat:send', { room: 'general', text: 'salut à tous' })
      await tick()
      sT.send('chat:send', { room: 'general', text: 'salut à tous' })
      await tick()
      assert.equal(recu.length, 2, 'les deux diffusions ont eu lieu — identité différente, jamais un doublon')
      assert.equal(recu.filter((m: any) => m.from.id === theo.id).length, 1, "le message de Theo n'a PAS été refusé — Zora et Theo ont chacun LEUR mémoire")
      sZ.destroy(); sT.destroy(); await app.stop()
    })
  })

  describe('fenêtre personnalisée — { within }', () => {
    it('e. fenêtre courte (50 ms) — le même texte repasse une fois la fenêtre écoulée', async () => {
      const { transport, app } = await startApp({ duplicates: { within: 50 } })
      const s = connect(transport, 'memory://ad-e', zora)
      const received: any[] = []
      s.on('chat:message', (p: any) => received.push(p))
      joinRoom(s, 'general'); await tick()
      s.send('chat:send', { room: 'general', text: 'salut à tous' })
      await tick()
      s.send('chat:send', { room: 'general', text: 'salut à tous' })
      await tick()
      assert.equal(received.length, 1, 'dans la fenêtre — refusé')
      assert.equal(s.lastError.message, 'chat-duplicate')
      await tick(80)   // fenêtre (50 ms) largement écoulée
      s.send('chat:send', { room: 'general', text: 'salut à tous' })
      await tick()
      assert.equal(received.length, 2, 'fenêtre écoulée — repasse')
      s.destroy(); await app.stop()
    })
  })

  describe('articulation avec onMessage — un doublon ne déclenche jamais onMessage', () => {
    it('f. message refusé par onMessage (retour false) — jamais enregistré, repasse une fois onMessage acceptant', async () => {
      let allow = false
      const { transport, app } = await startApp({ duplicates: true, onMessage: () => (allow ? undefined : false) })
      const s = connect(transport, 'memory://ad-f', zora)
      const received: any[] = []
      s.on('chat:message', (p: any) => received.push(p))
      joinRoom(s, 'general'); await tick()
      s.send('chat:send', { room: 'general', text: 'salut à tous' })
      await tick()
      assert.deepEqual(received, [])
      assert.equal(s.lastError.message, 'chat-denied', 'refusé par onMessage — PAS un doublon')
      allow = true
      s.send('chat:send', { room: 'general', text: 'salut à tous' })
      await tick()
      assert.equal(received.length, 1, "le MÊME texte passe — le refus précédent n'a rien enregistré")
      s.destroy(); await app.stop()
    })

    // deux onglets du même compte ne partagent pas la file d'attente d'une connexion : pendant qu'un
    // onMessage asynchrone réfléchit, l'autre onglet passait le contrôle avec le même texte
    it('f2. deux onglets du même compte, onMessage asynchrone : un seul des deux messages identiques passe', async () => {
      const { transport, app } = await startApp({ duplicates: true, onMessage: async () => { await tick(30) } })
      const a = connect(transport, 'memory://ad-f2a', zora)
      const b = connect(transport, 'memory://ad-f2b', zora)
      const received: any[] = []
      a.on('chat:message', (p: any) => received.push(p))
      joinRoom(a, 'general'); joinRoom(b, 'general'); await tick()
      a.send('chat:send', { room: 'general', text: 'salut à tous' })
      b.send('chat:send', { room: 'general', text: 'salut à tous' })
      await tick(100)
      assert.equal(received.length, 1, 'le doublon envoyé par le 2e onglet est refusé')
      assert.equal(b.lastError?.message, 'chat-duplicate')
      a.destroy(); b.destroy(); await app.stop()
    })

    it('f3. onMessage asynchrone qui lève : le texte n’est pas retenu, il repasse ensuite', async () => {
      let allow = false
      const { transport, app } = await startApp({ duplicates: true, onMessage: async () => { await tick(10); if (!allow) throw new Error('non') } })
      const s = connect(transport, 'memory://ad-f3', zora)
      const received: any[] = []
      s.on('chat:message', (p: any) => received.push(p))
      joinRoom(s, 'general'); await tick()
      s.send('chat:send', { room: 'general', text: 'salut à tous' })
      await tick(40)
      assert.equal(s.lastError.message, 'chat-denied')
      allow = true
      s.send('chat:send', { room: 'general', text: 'salut à tous' })
      await tick(40)
      assert.equal(received.length, 1)
      s.destroy(); await app.stop()
    })
  })

  describe('mémoire bornée — purge opportuniste (même mécanisme que buckets/lastTypingAt/mutedUntil)', () => {
    it('g1. salon vidé — sous-map entièrement réclamée par le balayage global', async () => {
      const { transport, app, pkg } = await startApp({ duplicates: true })
      const s = connect(transport, 'memory://ad-g1', zora)
      joinRoom(s, 'general'); await tick()
      s.send('chat:send', { room: 'general', text: 'salut à tous' })
      await tick()
      assert.equal((pkg as any)._duplicates.has('chat:general'), true, "l'entrée est bien enregistrée")
      s.destroy(); await tick()
      assert.equal(app.room('chat:general').size, 0, 'salon bien vidé (0 membre)')

      await triggerGlobalSweep(transport)   // franchit le seuil — balayage GLOBAL déclenché

      assert.equal((pkg as any)._duplicates.has('chat:general'), false, 'sous-map du salon vidé RÉCLAMÉE par le balayage')
      await app.stop()
    })

    it('g2. entrée expirée — balayée même si le salon reste peuplé (pas un effet du vidage)', async () => {
      const { transport, app, pkg } = await startApp({ duplicates: { within: 30 } })
      const s = connect(transport, 'memory://ad-g2', zora)
      joinRoom(s, 'general'); await tick()
      s.send('chat:send', { room: 'general', text: 'salut à tous' })
      await tick()
      assert.equal((pkg as any)._duplicates.get('chat:general')?.get(zora.id)?.has('salut à tous'), true, "l'entrée est bien enregistrée")
      await tick(60)   // fenêtre (30 ms) écoulée — mais PERSONNE ne re-consulte cette entrée entre-temps

      await triggerGlobalSweep(transport)   // salon 'general' reste peuplé (s toujours connecté) — seule l'expiration agit

      assert.equal(app.room('chat:general').size, 1, "salon toujours peuplé — ce n'est PAS le vidage qui a purgé")
      assert.equal((pkg as any)._duplicates.get('chat:general'), undefined, 'entrée expirée balayée PROACTIVEMENT, même sans jamais être re-consultée')
      s.destroy(); await app.stop()
    })
  })
})
