// Carte de chaleur (heatmap.ts) — `GET /heatmap.json` et `GET /heatmap` copiaient d'abord tous les points de la carte
// d'un seul trait (au plafond par défaut, 1 million de points) avant de la servir par morceaux : la boucle du serveur
// temps réel restait gelée des dizaines de millisecondes à chaque requête. Les points se lisent maintenant morceau par
// morceau dans la carte vivante, sans copie préalable ; pendant une lecture, la carte ne tasse pas ses tableaux (les
// points expirés partent quand même), pour que chaque morceau lu reste celui de l'instant de la requête.
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { mjsWs, heatmapPackage } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsWsApp } from '../src/mjs-ws/index.js'

const pause = (): Promise<void> => new Promise(ok => setImmediate(ok))

async function demarrer(horloge?: () => number): Promise<{ app: MjsWsApp; pkg: any }> {
  const app = mjsWs({ transport: new MemoryTransport(), heartbeat: 0, onLog: () => {} })
  const pkg: any = heatmapPackage({ origins: ['https://site.test'], onLog: () => {}, ...(horloge ? { now: horloge } : {}) })
  app.use(pkg)
  await app.listen()
  return { app, pkg }
}

describe('MJS-WS — carte de chaleur : servie sans copie préalable de la carte', function () {
  this.timeout(60000)

  it('1 million de points (plafond par défaut) : l’appel ne tient plus la boucle le temps d’une copie complète', async () => {
    const { app, pkg } = await demarrer()
    try {
      const now = Date.now()
      for (let p = 0; p < 1000; p++) {
        const pts: Array<[number, number]> = []
        const ts: number[] = []
        for (let i = 0; i < 1000; i++) { pts.push([i / 1000, p / 1000]); ts.push(now - 1000 + i) }
        pkg._pages.set('https://site.test/page-' + p, new Map([['click document', { zone: 'document', ev: 'click', w: 1280, h: 4000, pts, ts, head: 0 }]]))
      }
      const attendu = JSON.stringify({ pages: (app as any).heatmap().pages })
      // le temps de l'appel, avant qu'il ne rende la main, comparé à celui d'une copie complète de la carte
      // (app.heatmap()) mesurée juste avant : le meilleur de trois essais chacun, à chaud
      const copies: number[] = []
      const appels: number[] = []
      for (let essai = 0; essai < 3; essai++) {
        let t0 = performance.now()
        ;(app as any).heatmap()
        copies.push(performance.now() - t0)
        t0 = performance.now()
        const prom = (app as any)._heatmapPieces(false)
        appels.push(performance.now() - t0)
        const morceaux: string[] = await prom
        if (essai === 0) assert.equal(morceaux.join(''), attendu, 'même JSON qu’avant, octet pour octet')
      }
      const copie = Math.min(...copies)
      const appel = Math.min(...appels)
      console.log('      copie complète :', copies.map(ms => ms.toFixed(1) + ' ms').join(' · '), '— appel synchrone :', appels.map(ms => ms.toFixed(1) + ' ms').join(' · '))
      assert.ok(appel < copie / 2, `l’appel tient la boucle ${appel.toFixed(1)} ms, une copie complète de la carte ${copie.toFixed(1)} ms : il la copie encore`)
    } finally {
      await app.stop()
    }
  })

  it('une lecture en cours ne voit ni décalage ni doublon quand des points expirent et arrivent pendant qu’elle lit', async () => {
    let horloge = 1_000_000_000_000
    const t0    = horloge
    const { app, pkg } = await demarrer(() => horloge)
    try {
      const pts: Array<[number, number]> = []
      const ts: number[] = []
      for (let i = 0; i < 100000; i++) { pts.push([i, i]); ts.push(t0 + i) }
      const zone = { zone: 'document', ev: 'click', w: 1280, h: 4000, pts, ts, head: 0 }
      pkg._pages.set('https://site.test/', new Map([['click document', zone]]))
      const prom = (app as any)._heatmapPieces(false)
      await pause()
      // pendant la lecture : 60 000 points expirent (balayage de app.heatmap()), 10 points arrivent
      horloge = t0 + 7 * 86400000 + 60000
      ;(app as any).heatmap()
      for (let i = 0; i < 10; i++) { zone.pts.push([-1, -1]); zone.ts.push(horloge) }
      const lu = JSON.parse((await prom).join(''))
      const z  = lu.pages[0].zones[0]
      assert.equal(z.n, 100000, 'le compte de l’instant de la requête')
      assert.equal(z.ts.length, 100000)
      assert.equal(z.pts.length, 100000)
      for (let i = 0; i < 100000; i++) {
        if (z.ts[i] !== t0 + i || z.pts[i][0] !== i) assert.fail(`point ${i} décalé : ts ${z.ts[i]}, pts ${JSON.stringify(z.pts[i])}`)
      }
      // la lecture finie, la carte se tasse à nouveau et ne garde que les points vivants
      ;(app as any).heatmap()
      const apres = (app as any).heatmap().pages[0].zones[0]
      assert.equal(apres.n, 40010)
      assert.equal(apres.ts[0], t0 + 60000)
      assert.ok(zone.head <= 1024, 'tableaux tassés après la lecture (tête ' + zone.head + ')')
    } finally {
      await app.stop()
    }
  })
})
