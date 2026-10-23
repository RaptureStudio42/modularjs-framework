// Option `trustProxy` : la CHAÎNE réelle. Un vrai serveur (transport `ws`, socket TCP) derrière un faux proxy
// local qui fait ce que nginx fait avec `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for` : la
// socket du serveur ne voit que 127.0.0.1, l'adresse du visiteur n'arrive que dans les en-têtes. Sans l'option,
// tous les visiteurs portent la même adresse et les bornes par adresse deviennent globales (dix codes de partie
// faux d'un visiteur verrouillent tout le monde) ; avec elle, chaque visiteur a son adresse, et un en-tête forgé
// par le visiteur ne lui donne pas celle de son choix. Le transport uWebSockets.js passe par un faux module (aucun
// paquet natif). Les fonctions pures sont dans tests/mjs-ws-trust-proxy.test.ts.

import assert from 'node:assert/strict'
import { connect, createServer } from 'node:net'
import type { AddressInfo, Server, Socket } from 'node:net'
import WebSocket from 'ws'
import { mjsServer } from '../src/mjs-server/index.js'
import type { MjsServerApp, MjsServerOptions } from '../src/mjs-server/index.js'
import { mjsWs, resolveTransport, DEFAULT_LIMITS, MemoryTransport } from '../src/mjs-ws/index.js'
import type { MjsWsRemoteInfo } from '../src/mjs-ws/index.js'
import { WsTransport } from '../src/mjs-ws/transport-ws.js'
import { UwsTransport } from '../src/mjs-ws/transport-uws.js'
import type { UwsModule } from '../src/mjs-ws/transport-uws.js'
import { setMessagesLang, t } from '../src/messages/index.js'

// ============================================================================================
// le faux proxy : un relais TCP qui réécrit la requête d'upgrade comme le fait nginx
// ============================================================================================

interface ProxyHeaders {
  xff: boolean      // X-Forwarded-For complété de l'adresse vue ($proxy_add_x_forwarded_for)
  realIp: boolean   // X-Real-IP posé, celui du visiteur éventuel remplacé ($remote_addr)
}

interface FakeProxy {
  port: number
  /** l'adresse que le proxy voit pour son client (le $remote_addr de nginx), à poser avant chaque connexion */
  visitor: string
  close(): Promise<void>
}

function rewriteHead(head: string, visitor: string, set: ProxyHeaders): string {
  const [requestLine, ...lines] = head.split('\r\n')
  const previous = lines.filter(line => /^x-forwarded-for:/i.test(line)).map(line => line.replace(/^x-forwarded-for:\s*/i, ''))
  const kept     = lines.filter(line => !(set.realIp && /^x-real-ip:/i.test(line)) && !(set.xff && /^x-forwarded-for:/i.test(line)))
  if (set.realIp) kept.push('X-Real-IP: ' + visitor)
  if (set.xff) kept.push('X-Forwarded-For: ' + [...previous, visitor].join(', '))
  return [requestLine, ...kept].join('\r\n')
}

function launchFakeProxy(target: number, set: ProxyHeaders = { xff: true, realIp: true }): Promise<FakeProxy> {
  const sockets = new Set<Socket>()
  const proxy: FakeProxy = { port: 0, visitor: '203.0.113.1', close: async () => {} }
  const server: Server = createServer((incoming) => {
    const visitor  = proxy.visitor
    const outgoing = connect(target, '127.0.0.1')
    sockets.add(incoming)
    sockets.add(outgoing)
    let buffered = Buffer.alloc(0)
    let relayed  = false
    incoming.on('data', (chunk) => {
      if (relayed) { outgoing.write(chunk); return }
      buffered = Buffer.concat([buffered, chunk])
      const end = buffered.indexOf('\r\n\r\n')
      if (end < 0) return
      relayed = true
      const head = rewriteHead(buffered.subarray(0, end).toString('latin1'), visitor, set)
      outgoing.write(Buffer.concat([Buffer.from(head + '\r\n\r\n', 'latin1'), buffered.subarray(end + 4)]))
    })
    outgoing.on('data', (chunk) => incoming.write(chunk))
    incoming.on('close', () => { outgoing.destroy(); sockets.delete(incoming) })
    outgoing.on('close', () => { incoming.destroy(); sockets.delete(outgoing) })
    incoming.on('error', () => {})
    outgoing.on('error', () => {})
  })
  proxy.close = () => new Promise<void>((resolve) => {
    for (const socket of sockets) socket.destroy()
    server.close(() => resolve())
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      proxy.port = (server.address() as AddressInfo).port
      resolve(proxy)
    })
  })
}

// ============================================================================================
// le serveur réel et ses visiteurs
// ============================================================================================

interface Running {
  app: MjsServerApp
  port: number
  /** l'adresse retenue pour chaque connexion (`meta.address`, lue dans `auth`), dans l'ordre des hello */
  seen: Array<string | undefined>
  /** les avertissements du journal du serveur */
  warnings: string[]
}

// le port que le noyau a donné au transport `ws` construit par mjsServer() (port: 0, jamais tiré au sort) :
// relu juste après le start() de l'instance qui démarre
async function launch(opts: MjsServerOptions = {}): Promise<Running> {
  const seen: Array<string | undefined> = []
  const warnings: string[]               = []
  const baseStart                        = WsTransport.prototype.start
  let port                               = 0
  WsTransport.prototype.start = async function(this: WsTransport) {
    await baseStart.call(this)
    port = (this as unknown as { _wss: { address(): AddressInfo } })._wss.address().port
  }
  const app = mjsServer({
    port:      0,
    host:      '127.0.0.1',
    heartbeat: 0,
    auth:      (hello: { auth?: unknown }, meta: MjsWsRemoteInfo) => { seen.push(meta.address); return hello.auth },
    onLog:     (level, message) => { if (level === 'warn') warnings.push(message) },
    ...opts,
  })
  app.game('compteur', { seats: 2, code: true, state: () => ({ n: 0 }), moves: { inc: (game: { state: { n: number } }) => { game.state.n++ } } })
  try { await app.listen() }
  finally { WsTransport.prototype.start = baseStart }
  return { app, port, seen, warnings }
}

const opened: WebSocket[] = []
let lastId                = 0

// ouvre une connexion et attend le verdict du serveur : 'accepted' (µ:welcome reçu) ou le code de fermeture
function connectVisitor(port: number, id: string, headers: Record<string, string> = {}): Promise<{ ws: WebSocket; verdict: 'accepted' | number }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`, { headers })
    opened.push(ws)
    ws.once('error', reject)
    ws.once('open', () => ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1, auth: { id } } })))
    ws.on('message', (data) => { if (JSON.parse(data.toString()).t === 'µ:welcome') resolve({ ws, verdict: 'accepted' }) })
    ws.once('close', (code) => resolve({ ws, verdict: code }))
  })
}

// une requête applicative et son µ:ack : { p } en succès, { e: true, p } en erreur
function request(ws: WebSocket, type: string, p: unknown): Promise<{ e?: boolean; p: unknown }> {
  const id = ++lastId
  return new Promise((resolve, reject) => {
    const onClose   = () => reject(new Error('connexion fermée avant la réponse'))
    const onMessage = (data: WebSocket.RawData) => {
      const frame = JSON.parse(data.toString())
      if (frame.t !== 'µ:ack' || frame.id !== id) return
      ws.off('message', onMessage)
      ws.off('close', onClose)
      resolve(frame)
    }
    ws.on('message', onMessage)
    ws.on('close', onClose)
    ws.send(JSON.stringify({ t: type, id, p }))
  })
}

const wrongCode = (ws: WebSocket, i: number) => request(ws, 'µgame:play', { type: 'compteur', code: 'FAUX' + i })

// dix codes faux : les dix premiers restent un « code inconnu », le onzième déclenche le verrou
async function lockOut(ws: WebSocket): Promise<void> {
  for (let i = 0; i < 10; i++) assert.match(String((await wrongCode(ws, i)).p), /code inconnu/i, `tentative ${i + 1}/10`)
  assert.match(String((await wrongCode(ws, 10)).p), /trop de tentatives/i, 'la 11e tentative déclenche le verrou')
}

// un serveur réel, un faux proxy devant, et tout refermé à la fin quoi qu'il arrive
async function inChain(opts: MjsServerOptions, body: (ctx: { proxy: FakeProxy; run: Running }) => Promise<void>, set?: ProxyHeaders): Promise<void> {
  const run   = await launch(opts)
  const proxy = await launchFakeProxy(run.port, set)
  try { await body({ proxy, run }) }
  finally {
    for (const ws of opened.splice(0)) ws.terminate()
    await proxy.close()
    await run.app.stop()
  }
}

describe('trustProxy : serveur réel derrière un faux proxy local (X-Forwarded-For posé comme nginx)', function () {
  this.timeout(20000)

  afterEach(() => setMessagesLang('fr'))

  it('sans l\'option : tous les visiteurs portent l\'adresse du proxy, le verrou des codes faux devient global (comportement d\'avant)', async () => {
    await inChain({}, async ({ proxy, run }) => {
      proxy.visitor = '203.0.113.10'
      const a = await connectVisitor(proxy.port, 'a')
      await lockOut(a.ws)
      proxy.visitor = '203.0.113.20'
      const b = await connectVisitor(proxy.port, 'b')
      assert.match(String((await wrongCode(b.ws, 0)).p), /trop de tentatives/i, 'B porte la même adresse que A pour le serveur : verrouillé aussi')
      assert.deepEqual(run.seen, ['127.0.0.1', '127.0.0.1'])
    })
  })

  it('avec trustProxy: \'loopback\' : dix codes faux d\'un visiteur ne bloquent pas un autre visiteur, et le verrou reste sur le premier', async () => {
    await inChain({ trustProxy: 'loopback' }, async ({ proxy, run }) => {
      proxy.visitor = '203.0.113.10'
      const a = await connectVisitor(proxy.port, 'a')
      await lockOut(a.ws)
      proxy.visitor = '203.0.113.20'
      const b = await connectVisitor(proxy.port, 'b')
      assert.match(String((await wrongCode(b.ws, 0)).p), /code inconnu/i, 'B n\'est pas verrouillé par les erreurs de A')
      proxy.visitor = '203.0.113.10'
      const again = await connectVisitor(proxy.port, 'a-bis')
      assert.match(String((await wrongCode(again.ws, 0)).p), /trop de tentatives/i, 'A, revenu par une autre connexion, est toujours verrouillé')
      assert.deepEqual(run.seen, ['203.0.113.10', '203.0.113.20', '203.0.113.10'])
    })
  })

  it('sans l\'option : maxConnectionsPerIp est un plafond global derrière le proxy (comportement d\'avant)', async () => {
    await inChain({ limits: { maxConnectionsPerIp: 2 } }, async ({ proxy }) => {
      proxy.visitor = '203.0.113.10'
      assert.equal((await connectVisitor(proxy.port, 'a1')).verdict, 'accepted')
      assert.equal((await connectVisitor(proxy.port, 'a2')).verdict, 'accepted')
      proxy.visitor = '203.0.113.20'
      assert.equal((await connectVisitor(proxy.port, 'b1')).verdict, 1013, 'B compte avec A : le plafond de 2 est déjà atteint')
    })
  })

  it('avec trustProxy: \'loopback\' : maxConnectionsPerIp compte par visiteur', async () => {
    await inChain({ trustProxy: 'loopback', limits: { maxConnectionsPerIp: 2 } }, async ({ proxy }) => {
      proxy.visitor = '203.0.113.10'
      assert.equal((await connectVisitor(proxy.port, 'a1')).verdict, 'accepted')
      assert.equal((await connectVisitor(proxy.port, 'a2')).verdict, 'accepted')
      assert.equal((await connectVisitor(proxy.port, 'a3')).verdict, 1013, 'le troisième onglet du même visiteur est refusé')
      proxy.visitor = '203.0.113.20'
      assert.equal((await connectVisitor(proxy.port, 'b1')).verdict, 'accepted', 'un autre visiteur a son propre compte')
    })
  })

  it('un en-tête forgé par le visiteur ne lui donne pas l\'adresse de son choix : le proxy ajoute la vraie à droite', async () => {
    await inChain({ trustProxy: 'loopback' }, async ({ proxy, run }) => {
      proxy.visitor = '203.0.113.10'
      await connectVisitor(proxy.port, 'a', { 'X-Forwarded-For': '10.9.9.9' })
      await connectVisitor(proxy.port, 'b', { 'X-Forwarded-For': '127.0.0.1, 10.9.9.9', 'X-Real-IP': '10.8.8.8' })
      assert.deepEqual(run.seen, ['203.0.113.10', '203.0.113.10'])
    })
  })

  it('un pair qui n\'est pas dans la liste : ses en-têtes sont ignorés ; dans la liste : crus', async () => {
    await inChain({ trustProxy: ['10.0.0.0/8'] }, async ({ proxy, run }) => {
      proxy.visitor = '203.0.113.10'
      await connectVisitor(proxy.port, 'a')
      assert.deepEqual(run.seen, ['127.0.0.1'], 'le proxy est en 127.0.0.1, la liste ne parle que de 10.0.0.0/8')
    })
    await inChain({ trustProxy: ['10.0.0.0/8', '127.0.0.1'] }, async ({ proxy, run }) => {
      proxy.visitor = '203.0.113.10'
      await connectVisitor(proxy.port, 'a')
      assert.deepEqual(run.seen, ['203.0.113.10'])
    })
  })

  it('un proxy qui ne pose que X-Real-IP : c\'est le visiteur', async () => {
    await inChain({ trustProxy: 'loopback' }, async ({ proxy, run }) => {
      proxy.visitor = '203.0.113.10'
      await connectVisitor(proxy.port, 'a')
      assert.deepEqual(run.seen, ['203.0.113.10'])
    }, { xff: false, realIp: true })
  })

  it('une connexion directe sans en-tête de proxy garde l\'adresse de la socket, option réglée ou non', async () => {
    await inChain({ trustProxy: 'loopback' }, async ({ run }) => {
      await connectVisitor(run.port, 'directe')
      assert.deepEqual(run.seen, ['127.0.0.1'])
    })
  })

  it('une adresse IPv6 du visiteur arrive telle que le système l\'écrit', async () => {
    await inChain({ trustProxy: 'loopback' }, async ({ proxy, run }) => {
      proxy.visitor = '2001:0DB8:0:0:0:0:0:1'
      await connectVisitor(proxy.port, 'a')
      proxy.visitor = '::ffff:203.0.113.30'
      await connectVisitor(proxy.port, 'b')
      assert.deepEqual(run.seen, ['2001:db8::1', '203.0.113.30'])
    })
  })
})

describe('trustProxy : l\'avertissement « derrière un proxy sans réglage », au journal du serveur', function () {
  this.timeout(20000)

  afterEach(() => setMessagesLang('fr'))

  const hints = (run: Running): string[] => run.warnings.filter(message => message === t('ws.trust-proxy.proxy-sans-reglage'))

  it('option absente : un seul avertissement, malgré plusieurs connexions derrière le proxy', async () => {
    await inChain({}, async ({ proxy, run }) => {
      await connectVisitor(proxy.port, 'a')
      await connectVisitor(proxy.port, 'b')
      await connectVisitor(proxy.port, 'c')
      assert.equal(hints(run).length, 1)
      assert.match(hints(run)[0], /trustProxy: 'loopback'/)
    })
  })

  it('le texte est en français puis en anglais, selon la langue du projet', async () => {
    const texts: string[] = []
    for (const lang of ['fr', 'en'] as const) {
      setMessagesLang(lang)
      await inChain({}, async ({ proxy, run }) => {
        await connectVisitor(proxy.port, 'a')
        assert.equal(hints(run).length, 1, lang)
        texts.push(hints(run)[0])
      })
    }
    assert.notEqual(texts[0], texts[1])
    assert.match(texts[0], /vous semblez/i)
    assert.match(texts[1], /you appear/i)
    for (const text of texts) assert.match(text, /trustProxy: 'loopback'/)
  })

  it('aucun avertissement : sans en-tête de proxy (connexion directe), ni quand l\'option est réglée (loopback, liste, ou false)', async () => {
    await inChain({}, async ({ run }) => {
      await connectVisitor(run.port, 'directe')
      assert.equal(hints(run).length, 0, 'une connexion directe n\'a pas d\'en-tête de proxy')
    })
    for (const trustProxy of ['loopback', ['10.0.0.0/8'], false] as const) {
      await inChain({ trustProxy: trustProxy as MjsServerOptions['trustProxy'] }, async ({ proxy, run }) => {
        await connectVisitor(proxy.port, 'a')
        assert.equal(hints(run).length, 0, `trustProxy ${JSON.stringify(trustProxy)}`)
      })
    }
  })
})

describe('trustProxy : valeur refusée à la construction, quel que soit le transport', () => {
  afterEach(() => setMessagesLang('fr'))

  it('true est refusé par mjsWs() et par mjsServer(), même avec un transport en mémoire', () => {
    for (const build of [() => mjsWs({ transport: new MemoryTransport(), trustProxy: true as never }), () => mjsServer({ transport: new MemoryTransport(), trustProxy: true as never })]) {
      assert.throws(build, (err: Error) => err.message.includes('\'loopback\'') && err.message.includes('[\'10.0.0.0/8\', \'192.168.1.5\']'))
    }
  })

  it('une liste fautive est refusée, une liste valable passe, avec un transport en mémoire (qui ignore l\'option)', () => {
    assert.throws(() => mjsWs({ transport: new MemoryTransport(), trustProxy: ['10.0.0.0/33'] }), /10\.0\.0\.0\/33/)
    assert.doesNotThrow(() => mjsWs({ transport: new MemoryTransport(), trustProxy: ['10.0.0.0/8'] }))
    assert.doesNotThrow(() => mjsWs({ transport: new MemoryTransport(), trustProxy: 'loopback' }))
    assert.doesNotThrow(() => mjsWs({ transport: new MemoryTransport(), trustProxy: false }))
  })

  it('resolveTransport() transmet l\'option aux deux transports intégrés', () => {
    const ws  = resolveTransport('ws', undefined, undefined, DEFAULT_LIMITS, { trustProxy: 'loopback' })
    const uws = resolveTransport('uws', undefined, undefined, DEFAULT_LIMITS, { trustProxy: ['10.0.0.0/8'] })
    assert.ok(ws instanceof WsTransport)
    assert.ok(uws instanceof UwsTransport)
    assert.equal((ws as unknown as { _opts: { trustProxy: unknown } })._opts.trustProxy, 'loopback')
    assert.deepEqual((uws as unknown as { _opts: { trustProxy: unknown } })._opts.trustProxy, ['10.0.0.0/8'])
  })
})

// ============================================================================================
// le transport uWebSockets.js, sur un faux module : même règle que `ws`
// ============================================================================================

interface FakeUws extends UwsModule {
  /** une demande d'upgrade vue par le transport : l'adresse du pair en texte (comme le vrai uWS), les en-têtes de la requête */
  remoteInfoOf(peer: string, headers?: Record<string, string>): MjsWsRemoteInfo
}

function fakeUws(): FakeUws {
  let behavior: { upgrade(res: unknown, req: unknown, context: unknown): void } | null = null
  const app = {
    ws(_pattern: string, b: typeof behavior) { behavior = b; return app },
    listen(...args: unknown[]) { const done = args[args.length - 1] as (token: unknown) => void; queueMicrotask(() => done({ token: true })); return app },
  }
  return {
    App: () => app as never,
    us_listen_socket_close: () => {},
    remoteInfoOf(peer, headers = {}) {
      let userData: { remoteInfo: MjsWsRemoteInfo } | null = null
      const req = { getHeader: (key: string) => headers[key] ?? '', forEach: (cb: (key: string, value: string) => void) => { for (const key of Object.keys(headers)) cb(key, headers[key]) } }
      const res = { upgrade: (data: { remoteInfo: MjsWsRemoteInfo }) => { userData = data }, getRemoteAddressAsText: () => new TextEncoder().encode(peer).buffer }
      behavior!.upgrade(res, req, {})
      return userData!.remoteInfo
    },
  }
}

describe('trustProxy : le transport uWebSockets.js (faux module)', () => {
  const xff = { 'x-forwarded-for': '203.0.113.7' }

  it('sans l\'option : l\'adresse de la socket, comme avant (en-têtes ignorés, socket unix sans adresse)', async () => {
    const uws = fakeUws()
    await new UwsTransport({ uwsModule: uws, port: 1 }).start()
    assert.equal(uws.remoteInfoOf('127.0.0.1', xff).address, '127.0.0.1')
    assert.equal(uws.remoteInfoOf('::ffff:10.1.2.3', xff).address, '10.1.2.3')
    assert.equal(uws.remoteInfoOf('', xff).address, undefined)
  })

  it('trustProxy: \'loopback\' : pair de boucle (même sous la forme développée d\'uWS) ou socket unix, le visiteur vient des en-têtes', async () => {
    const uws = fakeUws()
    await new UwsTransport({ uwsModule: uws, port: 1, trustProxy: 'loopback' }).start()
    assert.equal(uws.remoteInfoOf('127.0.0.1', xff).address, '203.0.113.7')
    assert.equal(uws.remoteInfoOf('0:0:0:0:0:0:0:1', xff).address, '203.0.113.7', 'forme développée de ::1')
    assert.equal(uws.remoteInfoOf('0:0:0:0:0:ffff:7f00:1', xff).address, '203.0.113.7', 'forme développée de 127.0.0.1 mappée')
    assert.equal(uws.remoteInfoOf('', xff).address, '203.0.113.7', 'socket unix : aucune adresse, un proxy local par nature')
    assert.equal(uws.remoteInfoOf('203.0.113.9', xff).address, '203.0.113.9', 'pair distant : en-têtes ignorés')
    assert.equal(uws.remoteInfoOf('127.0.0.1').address, '127.0.0.1', 'sans en-tête de proxy : le pair')
  })

  it('une liste : seul un pair de la liste est cru', async () => {
    const uws = fakeUws()
    await new UwsTransport({ uwsModule: uws, port: 1, trustProxy: ['10.0.0.0/8'] }).start()
    assert.equal(uws.remoteInfoOf('10.0.0.5', xff).address, '203.0.113.7')
    assert.equal(uws.remoteInfoOf('127.0.0.1', xff).address, '127.0.0.1')
    assert.equal(uws.remoteInfoOf('', xff).address, undefined, 'une socket unix n\'est pas dans une liste')
  })

  it('l\'avertisseur est appelé une fois quand des en-têtes de proxy arrivent d\'un pair de boucle sans option', async () => {
    let calls = 0
    const uws = fakeUws()
    await new UwsTransport({ uwsModule: uws, port: 1, onProxyHeaders: () => { calls++ } }).start()
    uws.remoteInfoOf('203.0.113.9', xff)
    assert.equal(calls, 0, 'pair distant')
    uws.remoteInfoOf('', xff)
    uws.remoteInfoOf('127.0.0.1', xff)
    assert.equal(calls, 1)
  })
})
