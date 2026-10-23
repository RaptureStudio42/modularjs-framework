// Paquets CARTE DE CHALEUR et SUIVRE (mjs-ws/heatmap.ts, follow.ts) face à un visiteur qui ne joue pas
// le jeu — de vrais clients µ.socket (MemoryTransport) :
//   - l'adresse gardée est celle de la page, sans requête, ni ancre, ni identifiants (seule la route
//     `#/…` du routeur reste) : pas de jeton sur la page d'admin, pas une « page » par visite ;
//   - une connexion sans en-tête Origin (un script, pas un navigateur) ne remplit pas la carte ;
//   - la mémoire a des bornes : pages, zones par page, points en tout (les plus anciens partent) ;
//   - une page aux milliers de zones ne casse ni la carte, ni le pont, ni le fichier ;
//   - la dernière position d'un cours ne sert pas au premier arrivé du cours suivant.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsWs, heatmapPackage, followPackage } from '../src/mjs-ws/index.js'
import { cleanPoint } from '../src/mjs-ws/heatmap.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const ICI       = dirname(fileURLToPath(import.meta.url))
const socketSrc = readFileSync(join(ICI, '../src/runtime/mjs_socket.ts'), 'utf8')
const tick      = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

function makeClient(transport: MemoryTransport, origin?: string): any {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols, origin }) }
  const µ: any = { state: (o: any) => ({ ...o }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', socketSrc)(µ)
  return µ
}

async function demarrer(pkgs: any[]) {
  const transport = new MemoryTransport()
  const app = mjsWs({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, onLog: () => {} })
  for (const p of pkgs) app.use(p)
  await app.listen()
  return { transport, app }
}

async function visiteur(transport: MemoryTransport, url: string, origin?: string, qui: any = { id: 'v', name: 'V' }) {
  const µ = makeClient(transport, origin)
  const s = µ.socket(url, { auth: () => qui, reconnect: { enabled: false } })
  s.connect()
  await tick(5)
  return s
}

const point = (url: string, zones: any[] = [['document', 0.5, 0.5, 100, 100]]) => ({ url, ev: 'click', z: zones })

describe('mjs-ws — la carte de chaleur et le suivi, bornés', () => {
  it('l\'adresse gardée : la page et sa route, sans requête, ancre ni identifiants', () => {
    assert.equal(cleanPoint(point('https://site.fr/tarifs?email=a@b.fr&utm_source=x#ancre'))?.url, 'https://site.fr/tarifs')
    assert.equal(cleanPoint(point('https://site.fr/#/produits/12?tri=prix'))?.url, 'https://site.fr/#/produits/12')
    assert.equal(cleanPoint(point('https://moi:secret@site.fr/p#access_token=abc'))?.url, 'https://site.fr/p')
  })

  it('une connexion sans Origin (un script, pas un navigateur) ne remplit pas la carte', async () => {
    const { transport, app } = await demarrer([heatmapPackage({ origins: ['https://site.fr'] })])
    const s = await visiteur(transport, 'memory://h1')
    s.send('heatmap:point', point('https://evil.example/phish'))
    const n = await visiteur(transport, 'memory://h2', 'https://site.fr')
    n.send('heatmap:point', point('https://site.fr/'))
    await tick(10)
    assert.deepEqual((app as any).heatmap().pages.map((p: any) => p.url), ['https://site.fr/'])
    await app.stop()
  })

  it('les plafonds par défaut : un million de points, 1 000 pages, 64 zones par page — chacun réglable', () => {
    assert.deepEqual((heatmapPackage({ origins: ['https://site.fr'] }) as any)._limits, { maxPoints: 1_000_000, maxPages: 1000, maxZones: 64 })
    assert.deepEqual((heatmapPackage({ origins: ['https://site.fr'], maxPoints: 5, maxPages: 2, maxZones: 3 }) as any)._limits, { maxPoints: 5, maxPages: 2, maxZones: 3 })
  })

  it('la mémoire a des bornes : pages, zones par page, points en tout — les plus anciens partent', async () => {
    let maintenant = 1_000_000
    const { transport, app } = await demarrer([heatmapPackage({ origins: ['https://site.fr'], maxPages: 2, maxZones: 3, maxPoints: 10, now: () => maintenant, rateLimit: { rate: 1000, burst: 1000 } })])
    const s = await visiteur(transport, 'memory://h3', 'https://site.fr')
    s.send('heatmap:point', point('https://site.fr/a'))
    s.send('heatmap:point', point('https://site.fr/b'))
    s.send('heatmap:point', point('https://site.fr/c'))
    s.send('heatmap:point', point('https://site.fr/a', [['document', 0.1, 0.1, 100, 100], ['z1', 0.1, 0.1, 10, 10], ['z2', 0.1, 0.1, 10, 10], ['z3', 0.1, 0.1, 10, 10]]))
    await tick(10)
    const snap = (app as any).heatmap()
    // au plafond, la page la moins récente part : /c a pris la place de /a, puis /a celle de /b
    assert.deepEqual(snap.pages.map((p: any) => p.url).sort(), ['https://site.fr/a', 'https://site.fr/c'], 'deux pages au plus, les plus récentes')
    const a = snap.pages.find((p: any) => p.url === 'https://site.fr/a')
    assert.equal(a.zones.length, 3, 'trois zones au plus par page : ' + a.zones.map((z: any) => z.zone))
    for (let i = 0; i < 12; i++) {
      maintenant += 1000
      s.send('heatmap:point', point('https://site.fr/b', [['document', i / 100, 0.5, 100, 100]]))
      await tick(1)
    }
    await tick(10)
    const apres = (app as any).heatmap()
    const total = apres.pages.reduce((n: number, p: any) => n + p.zones.reduce((m: number, z: any) => m + z.n, 0), 0)
    assert.ok(total <= 10, 'dix points au plus : ' + total)
    const b = apres.pages.find((p: any) => p.url === 'https://site.fr/b').zones[0]
    assert.deepEqual(b.pts[b.pts.length - 1], [0.11, 0.5], 'le plus récent est gardé')
    await app.stop()
  })

  it('une page aux milliers de zones, sans zone document : la carte se lit quand même', async () => {
    const pkg = heatmapPackage({ origins: ['https://site.fr'], maxZones: 200_000 })
    const { app } = await demarrer([pkg])
    const zones = new Map()
    for (let i = 0; i < 130_000; i++) zones.set('click z' + i, { zone: 'z' + i, ev: 'click', w: 1, h: 1, pts: [[0.5, 0.5]], ts: [Date.now()], head: 0 })
    ;(pkg as any)._pages.set('https://site.fr/cible', zones)
    const snap = (app as any).heatmap()
    assert.equal(snap.pages[0].n, 1)
    await app.stop()
  })

  it('la dernière position d\'un salon vidé ne sert pas au premier arrivé suivant', async () => {
    const { transport, app } = await demarrer([followPackage({ canLead: () => true })])
    const prof = await visiteur(transport, 'memory://f1', undefined, { id: 'p', name: 'Prof' })
    const salon = prof.room('follow:cours')
    await tick(5)
    prof.send('follow:at', { room: 'cours', a: [7, 1], y: 0.5 })
    await tick(5)
    salon.leave()
    await tick(5)
    const eleve = await visiteur(transport, 'memory://f2', undefined, { id: 'e', name: 'Élève' })
    eleve.room('follow:cours')
    await tick(5)
    assert.equal(await eleve.request('follow:last', { room: 'cours' }), null)
    await app.stop()
  })
})
