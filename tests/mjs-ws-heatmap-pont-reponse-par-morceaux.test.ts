// Pont universel : GET /heatmap.json et GET /heatmap servent la carte de chaleur par morceaux, la main rendue au
// serveur temps réel entre deux — d'un seul trait, la carte entière était copiée puis sérialisée en une fois : au
// plafond par défaut (un million de points), 54,7 Mo de JSON et la boucle gelée 0,6 à 0,7 s par requête, route sans
// signature en local. Les octets servis restent ceux d'avant (JSON.stringify de app.heatmap(), et la même page).
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { mjsWs, heatmapPackage, renderHeatmapPage } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { mjsTmp } from './helpers/tmp.js'

function carteDe(n: number): string {
  const maintenant = Date.now()
  const pts: number[][] = []
  const ts: number[] = []
  for (let i = 0; i < n; i++) { pts.push([0.25, 0.75]); ts.push(maintenant - n + i) }
  return JSON.stringify({ v: 1, pages: [
    { url: 'https://site.fr/', n, zones: [{ zone: 'document', ev: 'click', n, w: 100, h: 100, pts, ts }] },
    { url: 'https://site.fr/</script><b>', n: 2, zones: [{ zone: 'document', ev: 'click', n: 2, w: 100, h: 100, pts: [[0.5, 0.5], [0.1, 0.9]], ts: [maintenant - 2, maintenant - 1] }] }
  ] })
}

// un texte compté : un JSON.stringify appelé depuis le serveur temps réel (src/mjs-ws/ : le pont et la carte), lu sur la pile
// d'appel. Le reste du process ne compte pas : une fenêtre happy-dom laissée par un fichier de tests précédent, où un effet tourne
// encore, en fait des dizaines de milliers par seconde
const parLeServeur = (): boolean => /[\\/]src[\\/]mjs-ws[\\/]/.test(new Error().stack ?? '')

// pendant `quoi` : le plus long texte rendu par un seul JSON.stringify du serveur, leur nombre, et le plus long écart entre deux tours de boucle
async function pendant<T>(quoi: () => Promise<T>): Promise<{ valeur: T, plusLongTexte: number, serialisations: number, plusLongGel: number }> {
  const stringify = JSON.stringify
  let plusLongTexte  = 0
  let serialisations = 0
  ;(JSON as any).stringify = function (...args: any[]) {
    const s = (stringify as any).apply(JSON, args)
    if (parLeServeur()) {
      serialisations++
      if (typeof s === 'string' && s.length > plusLongTexte) plusLongTexte = s.length
    }
    return s
  }
  let plusLongGel = 0
  let avant = performance.now()
  let fini = false
  const tour = (): void => {
    const maintenant = performance.now()
    plusLongGel = Math.max(plusLongGel, maintenant - avant)
    avant = maintenant
    if (!fini) setImmediate(tour)
  }
  setImmediate(tour)
  try {
    const valeur = await quoi()
    return { valeur, plusLongTexte, serialisations, plusLongGel }
  }
  finally {
    fini = true
    ;(JSON as any).stringify = stringify
  }
}

describe('MJS-WS — pont : la carte de chaleur servie par morceaux', function () {
  this.timeout(120000)

  it('300 000 points : GET /heatmap.json et GET /heatmap ne sérialisent jamais la carte d\'un seul trait, et servent les mêmes octets', async () => {
    const dir = mjsTmp('heatmap-pont-morceaux')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'carte.json')
    writeFileSync(file, carteDe(300_000))
    const transport = new MemoryTransport()
    let port = 0
    const app = mjsWs({
      transport, heartbeat: 0,
      onLog: (_l, message, meta: any) => { if (meta?.port && /pont universel|universal bridge/.test(message)) port = meta.port },
      bridge: { port: 0, secret: 'secret-de-test-pont-morceaux-123' }
    })
    app.use(heatmapPackage({ origins: ['https://site.fr'], file, saveEvery: 3_600_000, onLog: () => {} }))
    await app.listen()
    try {
      const attenduJson = JSON.stringify((app as any).heatmap())
      const attenduPage = renderHeatmapPage((app as any).heatmap())
      const json = await pendant(async () => {
        const r = await fetch('http://127.0.0.1:' + port + '/heatmap.json')
        return { status: r.status, type: r.headers.get('content-type'), corps: await r.text() }
      })
      const page = await pendant(async () => {
        const r = await fetch('http://127.0.0.1:' + port + '/heatmap')
        return { status: r.status, type: r.headers.get('content-type'), corps: await r.text() }
      })
      console.log('      /heatmap.json : ' + (json.valeur.corps.length / 1e6).toFixed(1) + ' Mo · plus long texte sérialisé d\'un trait : ' + json.plusLongTexte + ' · plus long gel : ' + json.plusLongGel.toFixed(1) + ' ms')
      console.log('      /heatmap      : ' + (page.valeur.corps.length / 1e6).toFixed(1) + ' Mo · plus long texte sérialisé d\'un trait : ' + page.plusLongTexte + ' · plus long gel : ' + page.plusLongGel.toFixed(1) + ' ms')
      assert.equal(json.valeur.status, 200)
      assert.equal(json.valeur.type, 'application/json; charset=utf-8')
      assert.ok(json.valeur.corps === attenduJson, 'les octets de JSON.stringify(app.heatmap())')
      assert.equal(page.valeur.status, 200)
      assert.equal(page.valeur.type, 'text/html; charset=utf-8')
      assert.ok(page.valeur.corps === attenduPage, 'la même page qu\'avant')
      assert.ok(!page.valeur.corps.includes('</script><b>'), 'une adresse relue du fichier reste échappée dans la page')
      assert.ok(json.serialisations > 0, 'JSON : aucune sérialisation du serveur comptée, le compte ne la voit plus')
      assert.ok(page.serialisations > 0, 'page : aucune sérialisation du serveur comptée, le compte ne la voit plus')
      assert.ok(json.plusLongTexte <= 1_000_000, 'JSON : un texte de ' + json.plusLongTexte + ' caractères sérialisé d\'un trait')
      assert.ok(page.plusLongTexte <= 1_000_000, 'page : un texte de ' + page.plusLongTexte + ' caractères sérialisé d\'un trait')
    }
    finally {
      await app.stop()
    }
  })
})
