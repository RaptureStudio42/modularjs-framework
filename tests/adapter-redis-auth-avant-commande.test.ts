// adapter-redis.ts::RedisConnection — avec un mot de passe configuré, une commande envoyée via
// send() juste après connect() (cas RedisAdapter.start() : this._cmd.connect() suivi de
// this._cmd.send(['PING'])) partait AVANT AUTH : le socket existait déjà, _raw() écrivait
// immédiatement. Le serveur Redis répond en FIFO — la 1re réponse (NOAUTH) revenait donc au PING
// plutôt qu'à AUTH, et start() rejetait contre un serveur pourtant correctement configuré.
// send() attend désormais que AUTH/SELECT aient réussi avant d'écrire quoi que ce soit sur le fil.
import assert from 'node:assert/strict'
import { RedisConnection, RedisAdapter, encodeCommand, RespError } from '../src/mjs-ws/adapter-redis.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

describe('adapter-redis — send() attend AUTH/SELECT avant d\'écrire (mot de passe configuré)', () => {
  it('a. PING retenu tant que AUTH n\'a pas été confirmé ; écrit seulement APRÈS, jamais avant', async () => {
    const writes: string[] = []
    const fakeSocket: any = { write: (data: string) => { writes.push(data) }, destroy() {}, on() {} }
    const cmd = new RedisConnection({ host: 'x', port: 1, password: 'secret', role: 'command', onLog: () => {}, onConnected: () => {} })
    ;(cmd as any)._socket = fakeSocket   // simule un socket TCP déjà ouvert, sans net.connect réel

    const pingPromise = cmd.send(['PING'])   // reproduit RedisAdapter.start() : connect() suivi immédiatement de send(['PING'])
    assert.equal(writes.length, 0, 'send() ne physique aucune écriture avant AUTH — PING RETENU')

    void (cmd as any)._onSocketConnected()   // callback 'connect' réel — émet AUTH
    assert.equal(writes.length, 1, 'AUTH écrit — SEULE commande sur le fil à ce stade')
    assert.equal(writes[0], encodeCommand(['AUTH', 'secret']))

    assert.equal(writes.length, 1, 'PING TOUJOURS retenu — AUTH pas encore confirmé par le serveur')

    ;(cmd as any)._onValue('OK')   // réponse Redis à AUTH
    await tick()
    assert.equal(writes.length, 2, 'PING écrit SEULEMENT une fois AUTH confirmé — plus jamais avant')
    assert.equal(writes[1], encodeCommand(['PING']))

    ;(cmd as any)._onValue('PONG')
    assert.equal(await pingPromise, 'PONG', 'la promesse de send() résout normalement une fois débloquée')
  })

  it('b. AUTH puis SELECT précèdent TOUJOURS le PING quand une base est configurée', async () => {
    const writes: string[] = []
    const fakeSocket: any = { write: (data: string) => { writes.push(data) }, destroy() {}, on() {} }
    const cmd = new RedisConnection({ host: 'x', port: 1, password: 'secret', db: 3, role: 'command', onLog: () => {}, onConnected: () => {} })
    ;(cmd as any)._socket = fakeSocket

    const pingPromise = cmd.send(['PING'])
    void (cmd as any)._onSocketConnected()
    assert.equal(writes[0], encodeCommand(['AUTH', 'secret']))
    ;(cmd as any)._onValue('OK')   // AUTH confirmé
    await tick()
    assert.equal(writes[1], encodeCommand(['SELECT', '3']), 'SELECT écrit juste après AUTH')
    assert.equal(writes.length, 2, 'PING encore retenu — SELECT pas encore confirmé')

    ;(cmd as any)._onValue('OK')   // SELECT confirmé
    await tick()
    assert.equal(writes.length, 3, 'PING écrit seulement après AUTH ET SELECT')
    assert.equal(writes[2], encodeCommand(['PING']))

    ;(cmd as any)._onValue('PONG')
    await pingPromise
  })

  it('c. sans mot de passe ni base, une commande part dès la connexion établie (aucune régression)', async () => {
    const writes: string[] = []
    const fakeSocket: any = { write: (data: string) => { writes.push(data) }, destroy() {}, on() {} }
    const cmd = new RedisConnection({ host: 'x', port: 1, role: 'command', onLog: () => {}, onConnected: () => {} })
    ;(cmd as any)._socket = fakeSocket

    const pingPromise = cmd.send(['PING'])
    assert.equal(writes.length, 0, 'toujours retenu tant que _onSocketConnected n\'a pas tourné')
    void (cmd as any)._onSocketConnected()   // ni AUTH ni SELECT à envoyer — _ready passe direct à true
    // aucun AWAIT réel dans _onSocketConnected ici (branches AUTH/SELECT sautées) — la résolution
    // du waiter reste une PROMESSE (.then() toujours en microtask, même déjà résolue) : un tick
    // est nécessaire avant que le PING, lui, ne s'écrive réellement sur le fil.
    await tick()
    assert.equal(writes.length, 1, 'PING écrit dès que la connexion est prête, sans attente superflue')
    assert.equal(writes[0], encodeCommand(['PING']))

    ;(cmd as any)._onValue('PONG')
    await pingPromise
  })
})

describe('adapter-redis — un AUTH/SELECT REFUSÉ débloque immédiatement les commandes en attente', () => {
  it('a. AUTH refusée (mauvais mot de passe) → send() en attente REJETTE tout de suite, socket fermée', async () => {
    const writes: string[] = []
    let destroyed = false
    const fakeSocket: any = { write: (data: string) => { writes.push(data) }, destroy: () => { destroyed = true }, on() {} }
    const cmd = new RedisConnection({ host: 'x', port: 1, password: 'mauvais-mdp', role: 'command', onLog: () => {}, onConnected: () => {} })
    ;(cmd as any)._socket = fakeSocket

    // reproduit RedisAdapter.start() : connect() suivi immédiatement de send(['PING'])
    let settled: { status: string; message?: string } | null = null
    const pingPromise = cmd.send(['PING']).then(
      () => { settled = { status: 'resolved' } },
      (e: Error) => { settled = { status: 'rejected', message: e.message } },
    )

    void (cmd as any)._onSocketConnected()
    assert.equal(writes.length, 1, 'AUTH écrit')

    ;(cmd as any)._onValue(new RespError('WRONGPASS invalid username-password pair'))   // le serveur refuse AUTH
    await tick(20)

    assert.ok(settled, 'send() ne doit JAMAIS rester en suspens pour toujours sur un AUTH refusé')
    assert.equal((settled as any).status, 'rejected', 'PING rejeté, jamais résolu ni oublié')
    assert.match((settled as any).message, /auth|mot de passe|WRONGPASS/i, 'message clair — pas juste "connexion perdue" générique')
    assert.equal((cmd as any)._readyWaiters.length, 0, 'aucune attente oubliée après le rejet')
    assert.ok(destroyed, 'la socket est fermée — laisse le cycle de reconnexion habituel (_onClose/backoff) prendre le relais')

    await pingPromise
    cmd.stop()
  })

  it('b. SELECT refusé (base inexistante) → même déblocage immédiat, PING jamais oublié', async () => {
    const writes: string[] = []
    let destroyed = false
    const fakeSocket: any = { write: (data: string) => { writes.push(data) }, destroy: () => { destroyed = true }, on() {} }
    const cmd = new RedisConnection({ host: 'x', port: 1, db: 99, role: 'command', onLog: () => {}, onConnected: () => {} })
    ;(cmd as any)._socket = fakeSocket

    let settled: { status: string; message?: string } | null = null
    const pingPromise = cmd.send(['PING']).then(
      () => { settled = { status: 'resolved' } },
      (e: Error) => { settled = { status: 'rejected', message: e.message } },
    )

    void (cmd as any)._onSocketConnected()
    assert.equal(writes[0], encodeCommand(['SELECT', '99']))

    ;(cmd as any)._onValue(new RespError('ERR DB index is out of range'))   // le serveur refuse SELECT
    await tick(20)

    assert.ok(settled, 'send() ne doit jamais rester bloqué sur un SELECT refusé')
    assert.equal((settled as any).status, 'rejected')
    assert.equal((cmd as any)._readyWaiters.length, 0)
    assert.ok(destroyed, 'la socket est fermée aussi sur un SELECT refusé')

    await pingPromise
    cmd.stop()
  })

  it("c. start() (RedisAdapter) rejette bien — plus de promesse pendante indéfiniment", async () => {
    const adapter: any = new RedisAdapter({ url: 'redis://:mauvais-mdp@x:1', onLog: () => {} })
    // court-circuite toute connexion réseau réelle sur les DEUX connexions internes — même
    // technique que les tests ci-dessus (fakeSocket), appliquée via connect() plutôt que _socket
    // direct : start() appelle connect() lui-même, avant même le 1er send()
    const fakeCmd: any = { write() {}, destroy() {}, on() {} }
    const fakeSub: any = { write() {}, destroy() {}, on() {} }
    adapter._cmd.connect = () => { adapter._cmd._socket = fakeCmd }
    adapter._sub.connect = () => { adapter._sub._socket = fakeSub }

    let settled: { status: string; message?: string } | null = null
    const startPromise = adapter.start().then(
      () => { settled = { status: 'resolved' } },
      (e: Error) => { settled = { status: 'rejected', message: e.message } },
    )
    await tick()   // laisse start() appeler connect() puis se suspendre sur send(['PING'])
    void adapter._cmd._onSocketConnected()   // callback 'connect' réel — émet AUTH avec le mauvais mot de passe
    adapter._cmd._onValue(new RespError('WRONGPASS invalid username-password pair'))
    await startPromise.catch(() => {})

    assert.ok(settled, 'start() ne doit jamais rester en suspens pour toujours')
    assert.equal((settled as any).status, 'rejected', 'start() rejette — plus d\'échec silencieux et permanent')
    assert.match((settled as any).message ?? '', /auth|mot de passe|WRONGPASS/i)

    await adapter.stop()
  })
})
