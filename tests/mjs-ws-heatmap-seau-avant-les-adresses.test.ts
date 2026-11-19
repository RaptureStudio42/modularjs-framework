// Paquet CARTE DE CHALEUR (src/mjs-ws/heatmap.ts) — deux comptes :
// - le seau d'abord : une trame de 50 points jugeait ses 50 adresses avant de consulter le seau, et un point écarté (adresse d'une
//   autre origine) ne prenait aucun jeton : un script en envoyait sans fin, 50 adresses jugées par trame. Chaque point prend son
//   jeton avant d'être jugé ; une trame refusée ne juge plus aucune adresse ;
// - au plafond de pages (`maxPages`), les points de la page la moins récente sont perdus : `onPoint` les a gardés.
// Clients bruts sur MemoryTransport, horloge pilotée (Date.now) ; les adresses jugées se comptent aux URL construites.
import assert from 'node:assert/strict'
import { mjsWs, heatmapPackage } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const ORIGINE = 'https://site.test'
const vraiNow = Date.now
let maintenant = vraiNow()

let idRequete = 0
async function page(transport: MemoryTransport) {
  const s: any = transport.connect({ origin: ORIGINE })
  const attentes = new Map<number, () => void>()
  let accueil = () => {}
  const accueilli = new Promise<void>(ok => { accueil = ok })
  s.onmessage = (ev: any) => { const m = JSON.parse(ev.data); if (m.t === 'µ:welcome') accueil(); if (m.t === 'µ:ack') attentes.get(m.id)?.() }
  await new Promise(r => setImmediate(r))
  s.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1 } }))
  await accueilli
  return {
    envoyer(t: string, p?: unknown) { s.send(JSON.stringify({ t, p })) },
    sync() { const id = ++idRequete; return new Promise<void>(ok => { attentes.set(id, ok); s.send(JSON.stringify({ t: 'ping', id })) }) }
  }
}

describe('MJS-WS — carte de chaleur : le seau avant les adresses, onPoint au plafond', function () {
  this.timeout(30000)
  beforeEach(() => { maintenant = vraiNow(); Date.now = () => maintenant })
  afterEach(() => { Date.now = vraiNow })

  it('une trame refusée par le seau ne juge aucune adresse, même faite de points écartés', async () => {
    const transport = new MemoryTransport()
    const app = mjsWs({ transport, heartbeat: 0, ban: false, onLog: () => {} })
    app.use(heatmapPackage({ origins: [ORIGINE], onLog: () => {} }))
    app.serve('ping', () => 1)
    await app.listen()
    const VraieURL = globalThis.URL
    let jugees = 0
    try {
      const script = await page(transport)
      globalThis.URL = class extends VraieURL { constructor(u: string | URL, b?: string | URL) { super(u, b); jugees++ } } as any
      const parTrame: number[] = []
      for (let k = 0; k < 5; k++) {
        const avant = jugees
        script.envoyer('heatmap:point', { pts: Array.from({ length: 50 }, (_, i) => ({ url: `https://ailleurs.test/p-${k}-${i}`, z: [['document', 0.1, 0.1, 100, 100]] })) })
        await script.sync()
        parTrame.push(jugees - avant)
      }
      globalThis.URL = VraieURL
      console.log(`      adresses jugées par trame de 50 points écartés : ${JSON.stringify(parTrame)}`)
      assert.ok(parTrame[0] > 0, 'les adresses de la première trame sont jugées')
      assert.ok(parTrame[0] <= 20, 'un jeton par point, 20 jetons au départ')
      assert.deepEqual(parTrame.slice(1), [0, 0, 0, 0], 'seau vide : aucune adresse jugée')
    } finally {
      globalThis.URL = VraieURL
      await app.stop()
    }
  })

  it('au plafond, les points de la page la moins récente sont perdus : onPoint les a gardés', async () => {
    const transport = new MemoryTransport()
    const app = mjsWs({ transport, heartbeat: 0, ban: false, onLog: () => {} })
    const recus: string[] = []
    app.use(heatmapPackage({ origins: [ORIGINE], maxPages: 50, onLog: () => {}, onPoint: (pt: any) => { recus.push(pt.url) } }))
    app.serve('ping', () => 1)
    await app.listen()
    try {
      const visiteur = await page(transport)
      for (let i = 0; i < 5; i++) { maintenant += 1000; visiteur.envoyer('heatmap:point', { url: ORIGINE + '/accueil', z: [['document', 0.5, 0.5, 1280, 3000]] }) }
      await visiteur.sync()
      const vraie = (carte: any) => carte.pages.find((p: any) => p.url === ORIGINE + '/accueil')?.n ?? 0
      const avant = vraie((app as any).heatmap())
      for (let c = 0; c < 3; c++) {
        maintenant += 1000
        const script = await page(transport)
        script.envoyer('heatmap:point', { pts: Array.from({ length: 20 }, (_, i) => ({ url: `${ORIGINE}/page-${c}-${i}`, z: [['document', 0.1, 0.1, 100, 100]] })) })
        await script.sync()
      }
      const carte = (app as any).heatmap()
      const gardes = recus.filter(u => u === ORIGINE + '/accueil').length
      console.log(`      vraie page : ${avant} points avant, ${vraie(carte)} après ${carte.pages.length} pages ; onPoint en a reçu ${gardes}`)
      assert.equal(avant, 5)
      assert.equal(carte.pages.length, 50, 'plafond de pages tenu')
      assert.equal(vraie(carte), 0, 'la page la moins récente est partie, ses points avec')
      assert.equal(gardes, 5, 'onPoint a reçu chaque point de la vraie page')
    } finally {
      await app.stop()
    }
  })
})
