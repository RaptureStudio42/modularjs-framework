// Pont universel : GET /heatmap.json et GET /heatmap écrivent la carte de chaleur au fil de sa sérialisation — chaque morceau
// part dès qu'il est prêt, et un client qui lit lentement fait attendre la sérialisation (la vidange du flux) : la carte entière
// n'est jamais gardée en texte dans la mémoire du serveur temps réel (au plafond par défaut, un million de points, 54,7 Mo de
// JSON tenus d'un coup, et autant pour la page d'admin échappée, nourrissaient le ramasse-miettes). Les octets servis restent
// ceux d'avant (JSON.stringify de app.heatmap(), et la même page).
import assert from 'node:assert/strict'
import { get } from 'node:http'
import type { IncomingMessage } from 'node:http'
import { mjsWs, heatmapPackage, renderHeatmapPage } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const attendre = (ms: number): Promise<void> => new Promise(ok => setTimeout(ok, ms))

// une sérialisation de la carte : un JSON.stringify appelé depuis src/mjs-ws/heatmap.ts, lu sur la pile d'appel. Le reste du process ne
// compte pas : dans une liste de fichiers de tests, une fenêtre happy-dom laissée par un fichier précédent, où un effet tourne encore,
// appelle JSON.stringify des dizaines de milliers de fois par seconde (CSSStyleDeclaration.setProperty) ; compté, il faisait rougir ce test
const parLaCarte = (): boolean => /[\\/]mjs-ws[\\/]heatmap\.ts:\d/.test(new Error().stack ?? '')

describe('MJS-WS — pont : la carte de chaleur écrite en flux', function () {
  this.timeout(120000)
  let app: any
  let port = 0

  before(async () => {
    app = mjsWs({
      transport: new MemoryTransport(), heartbeat: 0,
      onLog: (_l, message, meta: any) => { if (meta?.port && /pont universel|universal bridge/.test(message)) port = meta.port },
      bridge: { port: 0, secret: 'secret-de-test-pont-en-flux-0123456789' }
    })
    const pkg: any = heatmapPackage({ origins: ['https://site.test'], onLog: () => {} })
    app.use(pkg)
    await app.listen()
    const maintenant = Date.now()
    for (let p = 0; p < 1000; p++) {
      const pts: Array<[number, number]> = []
      const ts: number[] = []
      for (let i = 0; i < 1000; i++) { pts.push([(i % 97) / 97, p / 1000]); ts.push(maintenant - 1000 + i) }
      pkg._pages.set('https://site.test/page-' + p + (p === 7 ? '/</script><b>' : ''), new Map([['click document', { zone: 'document', ev: 'click', w: 1280, h: 4000, pts, ts, head: 0 }]]))
    }
  })

  after(async () => {
    await app?.stop()
  })

  // la requête, avec le compte des JSON.stringify faits par la carte (parLaCarte) : à l'arrivée des en-têtes, après `pause` ms d'un client qui
  // ne lit plus, et en tout
  async function requete(chemin: string, pause: number): Promise<{ corps: string, aEntetes: number, aPause: number, total: number, type: string | undefined }> {
    const stringify = JSON.stringify
    let appels = 0
    ;(JSON as any).stringify = function (...args: any[]) {
      if (parLaCarte()) appels++
      return (stringify as any).apply(JSON, args)
    }
    try {
      const res = await new Promise<IncomingMessage>((ok, ko) => get('http://127.0.0.1:' + port + chemin, ok).on('error', ko))
      const aEntetes = appels
      res.pause()
      await attendre(pause)
      const aPause = appels
      const morceaux: Buffer[] = []
      res.on('data', (b: Buffer) => morceaux.push(b))
      await new Promise<void>(ok => { res.on('end', ok); res.resume() })
      return { corps: Buffer.concat(morceaux).toString('utf8'), aEntetes, aPause, total: appels, type: res.headers['content-type'] }
    }
    finally {
      ;(JSON as any).stringify = stringify
    }
  }

  it('GET /heatmap.json : les en-têtes et les premiers octets partent avant la fin de la sérialisation, un client qui ne lit plus la fait attendre', async () => {
    const attendu = JSON.stringify(app.heatmap())
    const r = await requete('/heatmap.json', 600)
    console.log('      /heatmap.json : ' + (r.corps.length / 1e6).toFixed(1) + ' Mo · sérialisations : ' + r.aEntetes + ' aux en-têtes, ' + r.aPause + ' après 600 ms sans lecture, ' + r.total + ' en tout')
    assert.equal(r.type, 'application/json; charset=utf-8')
    assert.ok(r.corps === attendu, 'les octets de JSON.stringify(app.heatmap())')
    assert.ok(r.aEntetes * 2 < r.total, 'les en-têtes partent après ' + r.aEntetes + ' sérialisations sur ' + r.total + ' : la carte est sérialisée avant d\'être écrite')
    assert.ok(r.aPause * 10 < r.total * 9, 'un client qui ne lit plus : ' + r.aPause + ' sérialisations sur ' + r.total + ' faites quand même — la carte s\'entasse en mémoire')
  })

  it('GET /heatmap : la page d\'admin aussi, échappée morceau par morceau, les mêmes octets qu\'avant', async () => {
    const attendu = renderHeatmapPage(app.heatmap())
    const r = await requete('/heatmap', 600)
    console.log('      /heatmap      : ' + (r.corps.length / 1e6).toFixed(1) + ' Mo · sérialisations : ' + r.aEntetes + ' aux en-têtes, ' + r.aPause + ' après 600 ms sans lecture, ' + r.total + ' en tout')
    assert.equal(r.type, 'text/html; charset=utf-8')
    assert.ok(r.corps === attendu, 'la même page qu\'avant')
    assert.ok(!r.corps.includes('</script><b>'), 'une adresse reste échappée dans la page')
    assert.ok(r.aEntetes * 2 < r.total, 'les en-têtes partent après ' + r.aEntetes + ' sérialisations sur ' + r.total)
    assert.ok(r.aPause * 10 < r.total * 9, 'un client qui ne lit plus : ' + r.aPause + ' sérialisations sur ' + r.total + ' faites quand même')
  })

  it('un client qui part en cours de route : la sérialisation s\'arrête, le pont sert encore la requête suivante', async () => {
    const stringify = JSON.stringify
    let appels = 0
    ;(JSON as any).stringify = function (...args: any[]) {
      if (parLaCarte()) appels++
      return (stringify as any).apply(JSON, args)
    }
    let total = 0
    try {
      await new Promise<void>((ok, ko) => {
        const req = get('http://127.0.0.1:' + port + '/heatmap.json', res => {
          res.once('data', () => { req.destroy(); ok() })
        })
        req.on('error', () => {})
        setTimeout(() => ko(new Error('aucune donnée reçue')), 60000)
      })
      await attendre(1000)
      total = appels
    }
    finally {
      ;(JSON as any).stringify = stringify
    }
    console.log('      client parti : ' + total + ' sérialisations après son départ (4 000 pour toute la carte)')
    assert.ok(total > 0, 'aucune sérialisation de la carte comptée : le compte ne la voit plus')
    assert.ok(total < 1500, total + ' sérialisations : la carte continue d\'être écrite pour un client parti')
    const res = await new Promise<IncomingMessage>((ok, ko) => get('http://127.0.0.1:' + port + '/heatmap.json', ok).on('error', ko))
    res.resume()
    await new Promise<void>(ok => res.on('end', ok))
    assert.equal(res.statusCode, 200)
  })
})
