// Option `trustProxy` : X-Real-IP et X-Forwarded-For, venus d'un proxy de confiance, qui ne désignent pas le même
// visiteur. Un proxy n'écrit souvent que l'un des deux et laisse passer l'autre tel que le visiteur l'a envoyé :
// nginx avec la seule ligne `proxy_set_header X-Real-IP $remote_addr` (le X-Forwarded-For du visiteur passe tel
// quel), HAProxy avec `option forwardfor` ou un répartiteur AWS ALB (le X-Real-IP du visiteur passe tel quel). Dans
// aucun des deux cas l'en-tête forgé ne doit donner au visiteur l'adresse de son choix (contourner le plafond par
// adresse ou la mise au banc, faire bannir quelqu'un d'autre) : quand les deux en-têtes se contredisent, la connexion
// porte l'adresse du proxy, et un avertissement part une seule fois pour tout le processus. Deux en-têtes cohérents
// (nginx complet), ou un CDN de confiance devant nginx, donnent toujours le visiteur réel.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { connect, createServer } from 'node:net'
import type { AddressInfo, Server, Socket } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import WebSocket from 'ws'
import { mjsWs } from '../src/mjs-ws/index.js'
import type { MjsWsApp, MjsWsRemoteInfo } from '../src/mjs-ws/index.js'
import { WsTransport } from '../src/mjs-ws/transport-ws.js'
import { resolveTrustProxy, visitorAddress } from '../src/mjs-ws/trust-proxy.js'
import { setMessagesLang, t } from '../src/messages/index.js'

type Headers = Record<string, string | string[] | undefined>

const ROOT    = join(dirname(fileURLToPath(import.meta.url)), '..')
const VISITOR = '203.0.113.10'
const FORGED  = '198.51.100.77'

const via = (trust: unknown, peer: string | undefined, headers: Headers): string | undefined => visitorAddress(peer, headers, resolveTrustProxy(trust))

// l'avertissement des en-têtes contradictoires part sur la console : réduit au silence le temps d'un groupe de tests
function silenceWarnings(): void {
  const original = console.warn
  before(() => { console.warn = () => {} })
  after(() => { console.warn = original })
}

describe('trustProxy : X-Real-IP et X-Forwarded-For qui se contredisent', () => {
  silenceWarnings()

  it('nginx qui ne pose que X-Real-IP, X-Forwarded-For forgé par le visiteur : jamais l\'adresse forgée, l\'adresse du proxy', () => {
    for (const forged of [FORGED, '10.0.0.1', '127.0.0.1', `${FORGED}, 10.9.9.9`, `10.9.9.9, ${FORGED}`]) {
      const address = via('loopback', '127.0.0.1', { 'x-real-ip': VISITOR, 'x-forwarded-for': forged })
      assert.notEqual(address, FORGED, `X-Forwarded-For ${forged}`)
      assert.equal(address, '127.0.0.1', `X-Forwarded-For ${forged}`)
    }
    assert.equal(via(['10.0.0.0/8'], '10.0.0.5', { 'x-real-ip': VISITOR, 'x-forwarded-for': FORGED }), '10.0.0.5')
  })

  it('HAProxy (option forwardfor) ou AWS ALB, qui ne posent que X-Forwarded-For, X-Real-IP forgé : jamais l\'adresse forgée, l\'adresse du proxy', () => {
    // le proxy ajoute l'adresse qu'il voit à droite de X-Forwarded-For (HAProxy en ligne d'en-tête à part, ALB dans la même)
    const chains: Array<string | string[]> = [VISITOR, `10.9.9.9, ${VISITOR}`, ['10.9.9.9', VISITOR], `${FORGED}, ${VISITOR}`]
    for (const chain of chains) {
      const address = via('loopback', '127.0.0.1', { 'x-real-ip': FORGED, 'x-forwarded-for': chain })
      assert.notEqual(address, FORGED, `X-Forwarded-For ${JSON.stringify(chain)}`)
      assert.equal(address, '127.0.0.1', `X-Forwarded-For ${JSON.stringify(chain)}`)
    }
    assert.equal(via(['10.0.0.0/8'], '10.0.0.5', { 'x-real-ip': FORGED, 'x-forwarded-for': VISITOR }), '10.0.0.5')
    assert.equal(via('loopback', '127.0.0.1', { 'x-real-ip': '2001:db8::77', 'x-forwarded-for': '2001:db8::10' }), '127.0.0.1', 'en IPv6 aussi')
  })

  it('HAProxy ou ALB : sans X-Real-IP, ou avec un X-Real-IP qui dit la même chose, le visiteur', () => {
    assert.equal(via('loopback', '127.0.0.1', { 'x-forwarded-for': `${FORGED}, ${VISITOR}` }), VISITOR)
    assert.equal(via('loopback', '127.0.0.1', { 'x-real-ip': VISITOR, 'x-forwarded-for': `${FORGED}, ${VISITOR}` }), VISITOR)
    assert.equal(via('loopback', '127.0.0.1', { 'x-real-ip': 'garbage', 'x-forwarded-for': VISITOR }), VISITOR, 'X-Real-IP illisible : comme absent')
    assert.equal(via('loopback', '127.0.0.1', { 'x-real-ip': '127.0.0.1', 'x-forwarded-for': VISITOR }), VISITOR, 'X-Real-IP qui nomme un proxy de confiance : X-Forwarded-For')
  })

  it('X-Forwarded-For présent mais illisible ne confirme pas X-Real-IP : l\'adresse du proxy', () => {
    for (const chain of ['garbage', 'unknown', `${VISITOR}:4711`, `${VISITOR},`]) {
      assert.equal(via('loopback', '127.0.0.1', { 'x-real-ip': VISITOR, 'x-forwarded-for': chain }), '127.0.0.1', `X-Forwarded-For ${chain}`)
    }
  })

  it('nginx complet (les deux en-têtes posés, cohérents) : le visiteur, même avec des en-têtes forgés par lui', () => {
    assert.equal(via('loopback', '127.0.0.1', { 'x-real-ip': VISITOR, 'x-forwarded-for': VISITOR }), VISITOR)
    assert.equal(via('loopback', '127.0.0.1', { 'x-real-ip': VISITOR, 'x-forwarded-for': `${FORGED}, ${VISITOR}` }), VISITOR)
    assert.equal(via('loopback', '127.0.0.1', { 'x-real-ip': VISITOR, 'x-forwarded-for': `127.0.0.1, 10.9.9.9, ${VISITOR}` }), VISITOR)
    assert.equal(via('loopback', '127.0.0.1', { 'x-real-ip': '2001:DB8::1', 'x-forwarded-for': '2001:db8:0:0:0:0:0:1' }), '2001:db8::1', 'deux écritures de la même adresse IPv6 sont cohérentes')
    assert.equal(via('loopback', '127.0.0.1', { 'x-real-ip': VISITOR, 'x-forwarded-for': `::ffff:${VISITOR}` }), VISITOR, 'IPv4 mappée : la même adresse')
    assert.equal(via('loopback', '127.0.0.1', { 'x-real-ip': VISITOR }), VISITOR, 'sans X-Forwarded-For : X-Real-IP')
  })

  it('CDN de confiance devant nginx : le visiteur réel', () => {
    const list = ['127.0.0.1', '192.0.2.0/24']
    // nginx sans module real_ip : X-Real-IP vaut l'adresse du CDN, de confiance, et l'on remonte X-Forwarded-For
    assert.equal(via(list, '127.0.0.1', { 'x-real-ip': '192.0.2.5', 'x-forwarded-for': `${VISITOR}, 192.0.2.5` }), VISITOR)
    assert.equal(via(list, '127.0.0.1', { 'x-real-ip': '192.0.2.5', 'x-forwarded-for': `${FORGED}, ${VISITOR}, 192.0.2.5` }), VISITOR)
    // nginx avec real_ip : X-Real-IP vaut déjà le visiteur, X-Forwarded-For le confirme une fois le CDN sauté
    assert.equal(via(list, '127.0.0.1', { 'x-real-ip': VISITOR, 'x-forwarded-for': `${FORGED}, ${VISITOR}, 192.0.2.5` }), VISITOR)
    // nginx qui ne pose que X-Real-IP derrière le CDN : X-Forwarded-For est celui du CDN
    assert.equal(via(list, '127.0.0.1', { 'x-real-ip': '192.0.2.5', 'x-forwarded-for': `${FORGED}, ${VISITOR}` }), VISITOR)
  })

  it('X-Real-IP qui nomme un proxy de confiance, sans X-Forwarded-For : l\'adresse du pair', () => {
    assert.equal(via(['127.0.0.1', '192.0.2.0/24'], '127.0.0.1', { 'x-real-ip': '192.0.2.5' }), '127.0.0.1')
    assert.equal(via(['10.0.0.0/8'], '10.0.0.5', { 'x-real-ip': '10.9.9.9' }), '10.0.0.5', 'jamais une adresse de la plage au choix du visiteur')
  })
})

// ============================================================================================
// la chaîne réelle : un vrai serveur (transport `ws`) derrière un faux proxy, des deux façons
// ============================================================================================

// ce que le faux proxy écrit : 'x-real-ip' = nginx qui ne pose que X-Real-IP ; 'forwardfor' = HAProxy `option
// forwardfor` (une ligne X-Forwarded-For de plus) ; 'complet' = nginx avec les deux lignes
type ProxyKind = 'x-real-ip' | 'forwardfor' | 'complet'

function rewriteHead(head: string, visitor: string, kind: ProxyKind): string {
  const [requestLine, ...lines] = head.split('\r\n')
  const previous = lines.filter(line => /^x-forwarded-for:/i.test(line)).map(line => line.replace(/^x-forwarded-for:\s*/i, ''))
  if (kind === 'forwardfor') return [requestLine, ...lines, 'X-Forwarded-For: ' + visitor].join('\r\n')
  const kept = lines.filter(line => !/^x-real-ip:/i.test(line) && !(kind === 'complet' && /^x-forwarded-for:/i.test(line)))
  kept.push('X-Real-IP: ' + visitor)
  if (kind === 'complet') kept.push('X-Forwarded-For: ' + [...previous, visitor].join(', '))
  return [requestLine, ...kept].join('\r\n')
}

function launchProxy(target: number, visitor: string, kind: ProxyKind): Promise<{ port: number; close(): Promise<void> }> {
  const sockets = new Set<Socket>()
  const server: Server = createServer((incoming) => {
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
      const head = rewriteHead(buffered.subarray(0, end).toString('latin1'), visitor, kind)
      outgoing.write(Buffer.concat([Buffer.from(head + '\r\n\r\n', 'latin1'), buffered.subarray(end + 4)]))
    })
    outgoing.on('data', (chunk) => incoming.write(chunk))
    incoming.on('close', () => { outgoing.destroy(); sockets.delete(incoming) })
    outgoing.on('close', () => { incoming.destroy(); sockets.delete(outgoing) })
    incoming.on('error', () => {})
    outgoing.on('error', () => {})
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      port:  (server.address() as AddressInfo).port,
      close: () => new Promise<void>((done) => { for (const socket of sockets) socket.destroy(); server.close(() => done()) }),
    }))
  })
}

// un serveur réel sur un port donné par le système ; `seen` reçoit l'adresse retenue à chaque hello
async function launch(): Promise<{ app: MjsWsApp; port: number; seen: Array<string | undefined> }> {
  const seen: Array<string | undefined> = []
  const baseStart                        = WsTransport.prototype.start
  let port                               = 0
  WsTransport.prototype.start = async function(this: WsTransport) {
    await baseStart.call(this)
    port = (this as unknown as { _wss: { address(): AddressInfo } })._wss.address().port
  }
  const app = mjsWs({ port: 0, host: '127.0.0.1', heartbeat: 0, trustProxy: 'loopback', auth: (_hello: unknown, meta: MjsWsRemoteInfo) => { seen.push(meta.address); return {} }, onLog: () => {} })
  try { await app.listen() }
  finally { WsTransport.prototype.start = baseStart }
  return { app, port, seen }
}

// une visite : ouverture, hello, attente du verdict (µ:welcome ou fermeture), puis fermeture
function visit(port: number, headers: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`, { headers })
    ws.once('error', reject)
    ws.once('open', () => ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1 } })))
    ws.on('message', (data) => { if (JSON.parse(data.toString()).t === 'µ:welcome') { ws.terminate(); resolve() } })
    ws.once('close', () => resolve())
  })
}

// les adresses retenues pour une suite de visites, derrière un proxy de ce genre
async function seenBehind(kind: ProxyKind, visits: Array<Record<string, string>>): Promise<Array<string | undefined>> {
  const run   = await launch()
  const proxy = await launchProxy(run.port, VISITOR, kind)
  try {
    for (const headers of visits) await visit(proxy.port, headers)
    return run.seen
  }
  finally {
    await proxy.close()
    await run.app.stop()
  }
}

describe('trustProxy : serveur réel derrière un proxy qui n\'écrit qu\'un des deux en-têtes', function () {
  this.timeout(20000)
  silenceWarnings()

  it('HAProxy ou ALB (X-Forwarded-For seul) : un X-Real-IP forgé ne donne jamais l\'adresse forgée', async () => {
    const seen = await seenBehind('forwardfor', [{}, { 'X-Real-IP': FORGED }, { 'X-Real-IP': FORGED, 'X-Forwarded-For': FORGED }, { 'X-Real-IP': VISITOR }])
    assert.ok(!seen.includes(FORGED), JSON.stringify(seen))
    assert.deepEqual(seen, [VISITOR, '127.0.0.1', '127.0.0.1', VISITOR])
  })

  it('nginx qui ne pose que X-Real-IP : un X-Forwarded-For forgé ne donne jamais l\'adresse forgée', async () => {
    const seen = await seenBehind('x-real-ip', [{}, { 'X-Forwarded-For': FORGED }, { 'X-Forwarded-For': `10.0.0.1, ${FORGED}` }])
    assert.ok(!seen.includes(FORGED), JSON.stringify(seen))
    assert.deepEqual(seen, [VISITOR, '127.0.0.1', '127.0.0.1'])
  })

  it('nginx complet : le visiteur, quels que soient les en-têtes qu\'il écrit', async () => {
    const seen = await seenBehind('complet', [{}, { 'X-Forwarded-For': FORGED }, { 'X-Forwarded-For': FORGED, 'X-Real-IP': FORGED }])
    assert.deepEqual(seen, [VISITOR, VISITOR, VISITOR])
  })
})

// ============================================================================================
// l'avertissement : une seule fois pour tout le processus, en français ou en anglais
// ============================================================================================

// un processus neuf (l'avertissement n'y est pas encore parti) : les adresses retenues et les avertissements reçus
function freshProcess(lang: 'fr' | 'en', warn: 'collect' | 'throw'): { warnings: string[]; before: number; seen: unknown[] } {
  const trustProxy = pathToFileURL(join(ROOT, 'src/mjs-ws/trust-proxy.ts')).href
  const messages   = pathToFileURL(join(ROOT, 'src/messages/index.ts')).href
  const code       = [
    `const { resolveTrustProxy, visitorAddress } = await import(${JSON.stringify(trustProxy)})`,
    `const { setMessagesLang } = await import(${JSON.stringify(messages)})`,
    `setMessagesLang(${JSON.stringify(lang)})`,
    'const warnings = []',
    warn === 'throw' ? 'console.warn = () => { throw new Error("journal cassé") }' : 'console.warn = (...args) => { warnings.push(args.join(" ")) }',
    'const trusted = resolveTrustProxy("loopback")',
    'const seen    = []',
    `seen.push(visitorAddress("127.0.0.1", { "x-real-ip": "${VISITOR}", "x-forwarded-for": "${FORGED}, ${VISITOR}" }, trusted))`,
    `seen.push(visitorAddress("127.0.0.1", { "x-real-ip": "${VISITOR}" }, trusted))`,
    `seen.push(visitorAddress("127.0.0.1", { "x-forwarded-for": "${VISITOR}" }, trusted))`,
    'const before = warnings.length',
    `seen.push(visitorAddress("127.0.0.1", { "x-real-ip": "${FORGED}", "x-forwarded-for": "${VISITOR}" }, trusted))`,
    `seen.push(visitorAddress("127.0.0.1", { "x-real-ip": "${VISITOR}", "x-forwarded-for": "${FORGED}" }, trusted))`,
    `seen.push(visitorAddress("127.0.0.1", { "x-real-ip": "${VISITOR}", "x-forwarded-for": "garbage" }, trusted))`,
    'process.stdout.write(JSON.stringify({ warnings, before, seen }))',
  ].join('\n')
  const run = spawnSync(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '-e', code], { cwd: ROOT, encoding: 'utf8', timeout: 20000 })
  assert.equal(run.status, 0, run.stderr)
  return JSON.parse(run.stdout)
}

describe('trustProxy : l\'avertissement des en-têtes contradictoires', function () {
  this.timeout(30000)

  afterEach(() => setMessagesLang('fr'))

  it('un seul avertissement pour tout le processus, et aucun tant que les en-têtes sont cohérents', () => {
    setMessagesLang('fr')
    const out = freshProcess('fr', 'collect')
    assert.equal(out.before, 0, 'en-têtes cohérents : rien à signaler')
    assert.deepEqual(out.warnings, [t('ws.trust-proxy.en-tetes-contradictoires')])
    assert.deepEqual(out.seen, [VISITOR, VISITOR, VISITOR, '127.0.0.1', '127.0.0.1', '127.0.0.1'])
  })

  it('le texte suit la langue du projet : français, puis anglais', () => {
    const texts: string[] = []
    for (const lang of ['fr', 'en'] as const) {
      setMessagesLang(lang)
      const out = freshProcess(lang, 'collect')
      assert.deepEqual(out.warnings, [t('ws.trust-proxy.en-tetes-contradictoires')], lang)
      assert.match(out.warnings[0], /X-Real-IP/, lang)
      assert.match(out.warnings[0], /X-Forwarded-For/, lang)
      texts.push(out.warnings[0])
    }
    assert.notEqual(texts[0], texts[1], 'deux textes distincts')
    assert.match(texts[0], /votre proxy/)
    assert.match(texts[1], /your proxy/)
  })

  it('une console qui lève ne casse jamais la résolution de l\'adresse', () => {
    const out = freshProcess('fr', 'throw')
    assert.deepEqual(out.seen, [VISITOR, VISITOR, VISITOR, '127.0.0.1', '127.0.0.1', '127.0.0.1'])
  })
})
