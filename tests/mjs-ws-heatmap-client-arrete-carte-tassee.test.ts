// carte de chaleur servie en flux par le pont (GET /heatmap.json) : un client qui cesse de lire gardait la carte « en
// lecture » sans fin — tant qu'il restait là, les tableaux de points ne se tassaient plus (les points expirés oubliés, jamais
// libérés : la mémoire suivait l'arrivée des points au lieu du plafond `maxPoints`), et rien ne coupait sa réponse. Le
// tassement n'attend plus aucune lecture (la réponse en cours garde les points de son instant), et un client qui ne lit
// plus rien pendant 30 s voit sa réponse coupée
import assert from 'node:assert/strict'
import { get } from 'node:http'
import type { IncomingMessage } from 'node:http'
import { mjsWs, heatmapPackage } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const attendre = (ms: number): Promise<void> => new Promise(ok => setTimeout(ok, ms))

describe('MJS-WS — pont : un client de la carte qui ne lit plus', function () {
  this.timeout(120000)
  let app: any
  let pkg: any
  let port = 0
  const horloge = { t: Date.now() }

  before(async () => {
    app = mjsWs({
      transport: new MemoryTransport(), heartbeat: 0,
      onLog: (_l, message, meta: any) => { if (meta?.port && /pont universel|universal bridge/.test(message)) port = meta.port },
      bridge: { port: 0, secret: 'secret-de-test-carte-client-arrete-0123456789' },
    })
    pkg = heatmapPackage({ origins: ['https://site.test'], onLog: () => {}, now: () => horloge.t, maxAge: 1, unit: 'minute' })
    app.use(pkg)
    await app.listen()
  })

  // 1 000 pages de 1 000 points (3 000 sur la page 0), tous de l'heure de l'horloge : une cinquantaine de Mo de JSON
  function remplir(): void {
    pkg._pages.clear()
    for (let p = 0; p < 1000; p++) {
      const pts: Array<[number, number]> = []
      const ts: number[] = []
      const n = p === 0 ? 3000 : 1000
      for (let i = 0; i < n; i++) { pts.push([(i % 97) / 97, p / 1000]); ts.push(horloge.t) }
      pkg._pages.set('https://site.test/page-' + p, new Map([['click document', { zone: 'document', ev: 'click', w: 1280, h: 4000, pts, ts, head: 0 }]]))
    }
  }

  after(async () => {
    await app?.stop()
  })

  it('pendant qu\'il ne lit plus, les points expirés sont tassés ; sa réponse garde les points de son instant', async () => {
    remplir()
    const res = await new Promise<IncomingMessage>((ok, ko) => get({ host: '127.0.0.1', port, path: '/heatmap.json', headers: { host: '127.0.0.1' } }, ok).on('error', ko))
    res.pause()
    let carte: any
    try {
      await attendre(1500)
      // la vie continue : 2 000 points neufs sur la page 0, puis ses 3 000 anciens expirent
      const z0 = pkg._pages.get('https://site.test/page-0').get('click document')
      horloge.t += 2 * 60000
      for (let i = 0; i < 2000; i++) { z0.pts.push([0.5, 0.5]); z0.ts.push(horloge.t) }
      app.heatmap()
      assert.equal(z0.head, 0, 'points expirés tassés malgré le client arrêté')
      assert.equal(z0.ts.length, 2000)
      assert.equal(z0.pts.length, 2000)
      const morceaux: Buffer[] = []
      res.on('data', (b: Buffer) => morceaux.push(b))
      await new Promise<void>(ok => { res.on('end', ok); res.resume() })
      carte = JSON.parse(Buffer.concat(morceaux).toString('utf8'))
    }
    finally {
      // un échec ne laisse pas une réponse en attente : l'arrêt du serveur l'attendrait
      if (!res.complete) res.destroy()
    }
    const page0 = carte.pages.find((p: any) => p.url === 'https://site.test/page-0')
    assert.equal(page0.zones[0].n, 3000)
    assert.equal(page0.zones[0].pts.length, 3000, 'les points de l\'instant de la requête, intacts')
    assert.equal(page0.zones[0].ts.length, 3000)
  })

  it('un client qui ne lit plus rien pendant 30 s : sa réponse est coupée', async () => {
    // le délai de 30 s ramené à 300 ms pour le test
    remplir()
    const armer = globalThis.setTimeout
    ;(globalThis as any).setTimeout = (fn: any, ms: any, ...args: any[]) => armer(fn, ms === 30000 ? 300 : ms, ...args)
    let res: IncomingMessage
    try {
      res = await new Promise<IncomingMessage>((ok, ko) => get({ host: '127.0.0.1', port, path: '/heatmap.json', headers: { host: '127.0.0.1' } }, ok).on('error', ko))
      res.pause()
      await attendre(2000)
    }
    finally {
      globalThis.setTimeout = armer
    }
    res.on('error', () => {})
    res.on('data', () => {})
    await new Promise<void>(ok => { res.on('close', ok); res.resume() })
    assert.equal(res.complete, false, 'la réponse d\'un client arrêté est coupée, jamais tenue sans fin')
  })
})
