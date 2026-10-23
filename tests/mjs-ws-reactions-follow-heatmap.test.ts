// Paquets RÉACTIONS, SUIVRE, CARTE DE CHALEUR (mjs-ws/reactions.ts, follow.ts, heatmap.ts) contre de
// vrais clients µ.socket (MemoryTransport) — même patron que tests/mjs-ws-cursors.test.ts : ce qu'un
// visiteur envoie arrive aux autres membres du salon (jamais à lui-même), avec l'identité résolue
// par le serveur ; tout champ reçu est vérifié ; au-delà du débit, ignoré. La carte de chaleur se lit
// par `app.heatmap()` et sur le pont (GET /heatmap.json, GET /heatmap — sans signature en local).
// `file` : les points gardés dans un fichier, sauvegardé chaque minute et à l'arrêt, relu au démarrage
// (l'arrêt par signal est prouvé dans un vrai process enfant, tests/heatmap-file-signal.test.ts).

import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsWs, reactionsPackage, followPackage, heatmapPackage } from '../src/mjs-ws/index.js'
import { cleanEmoji } from '../src/mjs-ws/reactions.js'
import { cleanSpot } from '../src/mjs-ws/follow.js'
import { cleanPoint } from '../src/mjs-ws/heatmap.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { mjsTmp } from './helpers/tmp.js'

const ICI       = dirname(fileURLToPath(import.meta.url))
const socketSrc = readFileSync(join(ICI, '../src/runtime/mjs_socket.ts'), 'utf8')
const tick      = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

function makeClient(transport: MemoryTransport, origin?: string): any {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols, origin }) }
  const µ: any = { state: (o: any) => ({ ...o }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', socketSrc)(µ)
  return µ
}

async function demarrer(pkgs: any[], extra: any = {}) {
  const transport = new MemoryTransport()
  let bridgePort  = 0
  const app = mjsWs({
    transport, heartbeat: 0, auth: (hello: any) => hello.auth, ...extra,
    onLog: (_l: string, message: string, meta: any) => { if (meta && typeof meta.port === 'number' && /pont universel en écoute/.test(message)) bridgePort = meta.port },
  })
  for (const p of pkgs) app.use(p)
  await app.listen()
  return { transport, app, port: () => bridgePort }
}

const zora = { id: '1', name: 'Zora' }
const theo = { id: '2', name: 'Theo' }

async function visiteur(transport: MemoryTransport, qui: any, url: string, salon: string, type: string, origin?: string) {
  const µ   = makeClient(transport, origin)
  const s   = µ.socket(url, { auth: () => qui, reconnect: { enabled: false } })
  const vus: any[] = []
  if (type) s.on(type, (p: any) => vus.push(p))
  if (salon) s.room(salon)
  else s.connect()
  await tick(5)
  return { s, vus }
}

describe('mjs-ws — paquet RÉACTIONS', () => {
  it('un émoji envoyé arrive aux autres membres du salon, avec l\'identité de l\'envoyeur ; jamais à lui-même', async () => {
    const { transport, app } = await demarrer([reactionsPackage()])
    const a = await visiteur(transport, zora, 'memory://ra', 'reactions:live', 'reactions:send')
    const b = await visiteur(transport, theo, 'memory://rb', 'reactions:live', 'reactions:send')
    a.s.send('reactions:send', { room: 'live', e: '❤' })
    await tick(5)
    assert.deepEqual(b.vus, [{ room: 'live', e: '❤', from: { id: '1', name: 'Zora' } }])
    assert.deepEqual(a.vus, [])
    await app.stop()
  })

  it('un émoji : un texte court, sans balise ; `emojis` restreint la liste ; au-delà du débit, ignoré', async () => {
    assert.equal(cleanEmoji('🎉'), '🎉')
    assert.equal(cleanEmoji('<img src=x>'), null)
    assert.equal(cleanEmoji('x'.repeat(17)), null)
    assert.equal(cleanEmoji('🎉', ['❤']), null)
    const { transport, app } = await demarrer([reactionsPackage({ rateLimit: { rate: 1, burst: 2 } })])
    const a = await visiteur(transport, zora, 'memory://ra2', 'reactions:live', 'reactions:send')
    const b = await visiteur(transport, theo, 'memory://rb2', 'reactions:live', 'reactions:send')
    for (let i = 0; i < 5; i++) a.s.send('reactions:send', { room: 'live', e: '👍' })
    a.s.send('reactions:send', { room: 'live', e: '<b>' })
    await tick(5)
    assert.equal(b.vus.length, 2)
    await app.stop()
  })
})

describe('mjs-ws — paquet SUIVRE', () => {
  it('la position du présentateur arrive au public ; un retardataire la demande en arrivant', async () => {
    const { transport, app } = await demarrer([followPackage({ canLead: () => true })])
    const lead   = await visiteur(transport, zora, 'memory://fa', 'follow:cours', 'follow:at')
    const public1 = await visiteur(transport, theo, 'memory://fb', 'follow:cours', 'follow:at')
    lead.s.send('follow:at', { room: 'cours', a: [0, 3, -1, 2], y: 0.25 })
    await tick(5)
    assert.deepEqual(public1.vus, [{ room: 'cours', a: [0, 3, -1, 2], y: 0.25, from: { id: '1', name: 'Zora' } }])
    const tard = await visiteur(transport, { id: '3', name: 'Ada' }, 'memory://fc', 'follow:cours', '')
    assert.deepEqual(await tard.s.request('follow:last', { room: 'cours' }), { a: [0, 3, -1, 2], y: 0.25 })
    await app.stop()
  })

  it('canLead : qui ne mène pas n\'est pas suivi ; une position mal formée ne passe pas', async () => {
    assert.equal(cleanSpot({ a: [0, 'div'], y: 0 }), null)
    assert.equal(cleanSpot({ a: [0], y: 2 }), null)
    assert.deepEqual(cleanSpot({ a: [1], y: 0.5, evil: 1 }), { a: [1], y: 0.5 })
    // le haut de l'écran dans l'espace qui précède la balise : un peu au-dessus d'elle
    assert.deepEqual(cleanSpot({ a: [1], y: -0.25 }), { a: [1], y: -0.25 })
    assert.equal(cleanSpot({ a: [1], y: -1.5 }), null)
    const { transport, app } = await demarrer([followPackage({ canLead: (c: any) => c.identity?.id === '1' })])
    const lead = await visiteur(transport, zora, 'memory://fa2', 'follow:cours', 'follow:at')
    const eleve = await visiteur(transport, theo, 'memory://fb2', 'follow:cours', 'follow:at')
    eleve.s.send('follow:at', { room: 'cours', a: [9], y: 0 })
    await tick(5)
    assert.deepEqual(lead.vus, [], 'l\'élève ne mène pas')
    await app.stop()
  })
})

describe('mjs-ws — paquet SUIVRE : la souris de celui qui mène', () => {
  it('follow:cursor : la souris et la sélection de celui qui mène arrivent aux autres, nettoyées, avec son nom ; qui ne peut pas mener ne passe pas', async () => {
    const { transport, app } = await demarrer([followPackage({ canLead: (c: any) => c.identity?.name === 'Zora' })])
    const a = await visiteur(transport, zora, 'memory://fc', 'follow:/cours', 'follow:cursor')
    const b = await visiteur(transport, theo, 'memory://fc', 'follow:/cours', 'follow:cursor')
    a.s.send('follow:cursor', { room: '/cours', p: { a: [1, 2], x: 0.5, y: 0.25 }, t: null, evil: 1 })
    b.s.send('follow:cursor', { room: '/cours', p: { a: [0], x: 0.1, y: 0.1 }, t: null })
    await tick(10)
    assert.equal(b.vus.length, 1, JSON.stringify(b.vus))
    assert.deepEqual(b.vus[0].from, { id: '1', name: 'Zora' })
    assert.deepEqual(b.vus[0].p, { a: [1, 2], x: 0.5, y: 0.25 })
    assert.equal('evil' in b.vus[0], false)
    assert.equal(a.vus.length, 0, 'Théo ne mène pas : rien n\'arrive chez Zora')
    await app.stop()
  })

  it('follow:cursor : la balise active (f) et le compte des clics (c) de celui qui mène passent aussi, nettoyés', async () => {
    const { transport, app } = await demarrer([followPackage({ canLead: () => true })])
    const a = await visiteur(transport, zora, 'memory://fd', 'follow:/cours', 'follow:cursor')
    const b = await visiteur(transport, theo, 'memory://fd', 'follow:/cours', 'follow:cursor')
    a.s.send('follow:cursor', { room: '/cours', p: null, t: null, f: [0, -1, 2], c: 3 })
    await tick(10)
    a.s.send('follow:cursor', { room: '/cours', p: null, t: null, f: ['x'], c: -1 })
    await tick(10)
    assert.equal(b.vus.length, 2, JSON.stringify(b.vus))
    assert.deepEqual(b.vus[0].f, [0, -1, 2], 'le chemin de la balise active')
    assert.equal(b.vus[0].c, 3, 'le compte des clics')
    assert.equal(b.vus[1].f, null, 'un chemin mal formé ne passe pas')
    assert.equal(b.vus[1].c, 0, 'un compte mal formé retombe à 0')
    await app.stop()
  })
})

describe('mjs-ws — paquet CARTE DE CHALEUR', () => {
  it('les points s\'accumulent par page (son adresse, sans requête), par zone et par événement ; le pont en montre la carte', async () => {
    const { transport, app, port } = await demarrer([heatmapPackage({ origins: ['https://site.fr'] })], { bridge: { port: 0, secret: 'secret-de-test-1234567890' } })
    const a = await visiteur(transport, zora, 'memory://ha', '', '', 'https://site.fr')
    a.s.send('heatmap:point', { url: 'https://site.fr/tarifs?x=1', ev: 'click', z: [['document', 0.5, 0.25, 1280, 3000], ['mjs-offre', 0.1, 0.9, 400, 200]] })
    a.s.send('heatmap:point', { url: 'https://site.fr/tarifs?x=1', ev: 'click', z: [['document', 0.6, 0.3, 1280, 3000]] })
    a.s.send('heatmap:point', { url: 'https://site.fr/tarifs?x=1', ev: 'mousemove', z: [['document', 0.2, 0.2, 1280, 3000]] })
    // une autre origine que celle de la page connectée : refusé
    a.s.send('heatmap:point', { url: 'https://ailleurs.fr/', ev: 'click', z: [['document', 0.5, 0.5, 100, 100]] })
    await tick(5)
    const snap = (app as any).heatmap()
    assert.equal(snap.pages.length, 1)
    assert.equal(snap.pages[0].url, 'https://site.fr/tarifs', 'sans la requête')
    const zone = (nom: string, ev: string) => snap.pages[0].zones.find((z: any) => z.zone === nom && z.ev === ev)
    assert.deepEqual([zone('document', 'click').n, zone('document', 'click').pts, zone('document', 'click').w, zone('document', 'click').h], [2, [[0.5, 0.25], [0.6, 0.3]], 1280, 3000])
    assert.deepEqual([zone('mjs-offre', 'click').n, zone('mjs-offre', 'click').pts], [1, [[0.1, 0.9]]])
    assert.deepEqual(zone('document', 'mousemove').pts, [[0.2, 0.2]], 'un autre événement : une autre carte')
    const json = await (await fetch('http://127.0.0.1:' + port() + '/heatmap.json')).json()
    assert.deepEqual(json, snap)
    const page = await (await fetch('http://127.0.0.1:' + port() + '/heatmap')).text()
    assert.match(page, /Carte de chaleur/)
    assert.match(page, /https:\/\/site\.fr\/tarifs/)
    await app.stop()
  })

  it('l\'âge efface (maxAge + unit), sans plafond en deçà de celui de sécurité ; une unité inconnue est refusée', async () => {
    let maintenant = 1_000_000
    const { transport, app } = await demarrer([heatmapPackage({ origins: ['https://site.fr'], maxAge: 2, unit: 'minute', now: () => maintenant, rateLimit: { rate: 100, burst: 100 } })])
    const a = await visiteur(transport, zora, 'memory://hb', '', '', 'https://site.fr')
    for (let i = 0; i < 30; i++) a.s.send('heatmap:point', { url: 'https://site.fr/', ev: 'click', z: [['document', i / 100, 0.5, 100, 100]] })
    await tick(5)
    maintenant += 60_000
    a.s.send('heatmap:point', { url: 'https://site.fr/', ev: 'click', z: [['document', 0.9, 0.9, 100, 100]] })
    await tick(5)
    assert.equal((app as any).heatmap().pages[0].zones[0].n, 31, 'tout est gardé, sans plafond')
    maintenant += 90_000
    const snap = (app as any).heatmap()
    assert.deepEqual(snap.pages[0].zones[0].pts, [[0.9, 0.9]], 'plus de deux minutes : effacé')
    maintenant += 3 * 60_000
    assert.deepEqual((app as any).heatmap().pages, [], 'une page sans point : partie')
    await app.stop()
    assert.throws(() => heatmapPackage({ maxAge: 3, unit: 'lune' as any }), /unit/)
    assert.throws(() => heatmapPackage({ maxAge: 0 }), /maxAge/)
  })

  it('exclude : les points d\'une IP ou d\'un compte ne sont pas pris (à la capture) ; chaque point garde son heure ; la page d\'admin a son curseur « les N plus récents »', async () => {
    let maintenant = 5_000_000
    const { transport, app, port } = await demarrer([heatmapPackage({ origins: ['https://site.fr'], exclude: { ips: ['9.9.9.9'], accounts: ['2'] }, now: () => maintenant })], { bridge: { port: 0, secret: 'secret-de-test-1234567890' } })
    const µ1 = makeClient(transport, 'https://site.fr')
    const a  = µ1.socket('memory://hx', { auth: () => zora, reconnect: { enabled: false } })
    a.connect()
    const µ2 = makeClient(transport, 'https://site.fr')
    const b  = µ2.socket('memory://hx', { auth: () => theo, reconnect: { enabled: false } })
    b.connect()
    ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols, origin: 'https://site.fr', headers: { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' } }) }
    const µ3 = { state: (o: any) => ({ ...o }), error: () => {}, warn: () => {}, log: () => {} } as any
    new Function('µ', socketSrc)(µ3)
    const c  = µ3.socket('memory://hx', { auth: () => ({ id: '3', name: 'Moi' }), reconnect: { enabled: false } })
    c.connect()
    await tick(5)
    a.send('heatmap:point', { url: 'https://site.fr/', ev: 'click', z: [['document', 0.1, 0.1, 100, 100]] })
    await tick(5)
    maintenant += 1000
    a.send('heatmap:point', { url: 'https://site.fr/', ev: 'click', z: [['document', 0.2, 0.2, 100, 100]] })
    b.send('heatmap:point', { url: 'https://site.fr/', ev: 'click', z: [['document', 0.8, 0.8, 100, 100]] })
    c.send('heatmap:point', { url: 'https://site.fr/', ev: 'click', z: [['document', 0.9, 0.9, 100, 100]] })
    await tick(10)
    const zone = (app as any).heatmap().pages[0].zones[0]
    assert.deepEqual(zone.pts, [[0.1, 0.1], [0.2, 0.2]], 'le compte 2 et l\'IP 9.9.9.9 ne comptent pas')
    assert.deepEqual(zone.ts, [5_000_000, 5_001_000], 'l\'heure de chaque point')
    const page = await (await fetch('http://127.0.0.1:' + port() + '/heatmap')).text()
    assert.match(page, /id="recents"/)
    await app.stop()
  })

  const POINT = { url: 'https://site.fr/', ev: 'click', z: [['document', 0.5, 0.25, 1280, 3000], ['mjs-offre', 0.1, 0.9, 400, 200]] }

  it('file : les points sont écrits dans le fichier à l\'arrêt, et relus au démarrage — leur page, leur zone, leur heure', async () => {
    const file = join(mjsTmp('heatmap-fichier'), 'donnees', 'heatmap.json')
    const un   = await demarrer([heatmapPackage({ origins: ['https://site.fr'], file, now: () => 7_000_000 })])
    const a    = await visiteur(un.transport, zora, 'memory://hf1', '', '', 'https://site.fr')
    a.s.send('heatmap:point', POINT)
    await tick(5)
    assert.equal(existsSync(file), false, 'rien d\'écrit avant la minute ou l\'arrêt')
    await un.app.stop()
    const lu = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(lu.pages[0].url, 'https://site.fr/', 'écrit à l\'arrêt (le dossier créé au besoin)')
    const deux = await demarrer([heatmapPackage({ origins: ['https://site.fr'], file, now: () => 7_500_000 })])
    const snap = (deux.app as any).heatmap()
    const zone = (nom: string) => snap.pages[0].zones.find((z: any) => z.zone === nom)
    assert.deepEqual([zone('document').pts, zone('document').ts, zone('document').w, zone('document').h], [[[0.5, 0.25]], [7_000_000], 1280, 3000], 'relu au démarrage')
    assert.deepEqual(zone('mjs-offre').pts, [[0.1, 0.9]])
    const b = await visiteur(deux.transport, theo, 'memory://hf2', '', '', 'https://site.fr')
    b.s.send('heatmap:point', POINT)
    await tick(5)
    assert.equal((deux.app as any).heatmap().pages[0].zones.find((z: any) => z.zone === 'document').n, 2, 'les nouveaux s\'ajoutent aux anciens')
    await deux.app.stop()
  })

  it('file : sauvegardé tout seul (saveEvery, une minute par défaut), seulement quand il y a du nouveau', async () => {
    const file = join(mjsTmp('heatmap-minute'), 'heatmap.json')
    const { transport, app } = await demarrer([heatmapPackage({ origins: ['https://site.fr'], file, saveEvery: 40 })])
    const a = await visiteur(transport, zora, 'memory://hf3', '', '', 'https://site.fr')
    a.s.send('heatmap:point', POINT)
    await tick(150)
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).pages[0].zones.length, 2, 'écrit sans attendre l\'arrêt')
    const avant = statSync(file).mtimeMs
    await tick(150)
    assert.equal(statSync(file).mtimeMs, avant, 'rien de nouveau : pas réécrit')
    await app.stop()
    assert.throws(() => heatmapPackage({ file: '' }), /file/)
    assert.throws(() => heatmapPackage({ file: 'a.json', saveEvery: 0 }), /saveEvery/)
  })

  it('file : au démarrage, les points trop vieux (maxAge) ne reviennent pas', async () => {
    const file = join(mjsTmp('heatmap-age'), 'heatmap.json')
    const un   = await demarrer([heatmapPackage({ origins: ['https://site.fr'], file, maxAge: 1, unit: 'hour', now: () => 1_000_000 })])
    const a    = await visiteur(un.transport, zora, 'memory://hf4', '', '', 'https://site.fr')
    a.s.send('heatmap:point', POINT)
    await tick(5)
    await un.app.stop()
    const deux = await demarrer([heatmapPackage({ origins: ['https://site.fr'], file, maxAge: 1, unit: 'hour', now: () => 1_000_000 + 2 * 3_600_000 })])
    assert.deepEqual((deux.app as any).heatmap().pages, [])
    await deux.app.stop()
  })

  it('file : un fichier illisible est mis de côté (renommé, jamais écrasé) et le dit ; le serveur démarre quand même', async () => {
    const dir  = mjsTmp('heatmap-abime')
    const file = join(dir, 'heatmap.json')
    writeFileSync(file, '{ pas du json')
    const journal: string[] = []
    const { transport, app } = await demarrer([heatmapPackage({ origins: ['https://site.fr'], file, onLog: (niveau: string, message: string) => journal.push(niveau + ' ' + message) })])
    const mis = readdirSync(dir).find((f) => f.startsWith('heatmap.json.bad-'))
    assert.ok(mis, 'le fichier illisible, renommé')
    assert.equal(readFileSync(join(dir, mis!), 'utf8'), '{ pas du json', 'intact')
    assert.ok(journal.some((l) => l.startsWith('error') && l.includes(mis!)), 'une erreur qui dit où il est')
    assert.deepEqual((app as any).heatmap().pages, [])
    const a = await visiteur(transport, zora, 'memory://hf5', '', '', 'https://site.fr')
    a.s.send('heatmap:point', POINT)
    await tick(5)
    await app.stop()
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).pages.length, 1, 'un fichier neuf, lisible')
  })

  it('un point : une adresse http(s), un événement, des zones nommées, des fractions — rien d\'autre ; sans le paquet, le pont répond 404', async () => {
    assert.equal(cleanPoint({ url: 'javascript:alert(1)', z: [['document', 0, 0, 1, 1]] }), null)
    assert.equal(cleanPoint({ url: 'https://a.fr/', z: [['<b>', 0, 0, 1, 1]] }), null)
    assert.equal(cleanPoint({ url: 'https://a.fr/', z: [['document', 2, 0, 1, 1]] }), null)
    assert.equal(cleanPoint({ url: 'https://a.fr/', ev: '<script>', z: [['document', 0.5, 0.5, 1, 1]] }), null)
    assert.deepEqual(cleanPoint({ url: 'https://a.fr/p', z: [['document', 0.5, 0.5, 10, 10]], evil: 1 }), { url: 'https://a.fr/p', ev: 'click', z: [['document', 0.5, 0.5, 10, 10]] })
    assert.deepEqual(cleanPoint({ url: 'https://a.fr/p', ev: 'pointermove', z: [['document', 0.5, 0.5, 10, 10]] })?.ev, 'pointermove')
    const { app, port } = await demarrer([], { bridge: { port: 0, secret: 'secret-de-test-1234567890' } })
    assert.equal((await fetch('http://127.0.0.1:' + port() + '/heatmap.json')).status, 404)
    await app.stop()
  })
})
