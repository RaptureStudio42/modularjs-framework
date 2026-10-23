// heatmapPackage({ file }) : la sauvegarde de chaque minute rend la main au serveur pendant qu'elle
// écrit — au plafond par défaut (1 million de points), l'écrire d'un seul trait gelait le serveur temps réel
// plus de 200 ms à chaque fois (toutes ses connexions avec lui). Le fichier écrit est le même ; à
// l'arrêt, l'écriture d'un seul trait reprend la main, et celle de fond, abandonnée, ne laisse rien.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsWs, heatmapPackage } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { mjsTmp } from './helpers/tmp.js'

const ICI       = dirname(fileURLToPath(import.meta.url))
const socketSrc = readFileSync(join(ICI, '../src/runtime/mjs_socket.ts'), 'utf8')
const tick      = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

async function demarrer(file: string) {
  const transport = new MemoryTransport()
  const pkg = heatmapPackage({ file, saveEvery: 3_600_000, origins: ['https://site.fr'] })
  const app = mjsWs({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, onLog: () => {} })
  app.use(pkg)
  await app.listen()
  // un point de plus, venu d'une page : la carte a du nouveau à écrire
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols, origin: 'https://site.fr' }) }
  const µ: any = { state: (o: any) => ({ ...o }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', socketSrc)(µ)
  const s = µ.socket('memory://carte', { auth: () => ({ id: 'v', name: 'V' }), reconnect: { enabled: false } })
  s.connect()
  await tick(5)
  s.send('heatmap:point', { url: 'https://site.fr/', ev: 'click', z: [['document', 0.5, 0.5, 100, 100]] })
  await tick(20)
  return { app, pkg, s }
}

function carteDe(n: number): string {
  const maintenant = Date.now()
  const pts: number[][] = []
  const ts: number[] = []
  for (let i = 0; i < n; i++) { pts.push([0.25, 0.75]); ts.push(maintenant - n + i) }
  return JSON.stringify({ v: 1, pages: [{ url: 'https://site.fr/', n, zones: [{ zone: 'document', ev: 'click', n, w: 100, h: 100, pts, ts }] }] })
}

describe('heatmapPackage — la sauvegarde rend la main', function () {
  this.timeout(60000)

  it('300 000 points : le serveur a la main pendant l\'écriture de fond, et le fichier est le même', async () => {
    const dir  = mjsTmp('heatmap-sauvegarde-morcelee')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'carte.json')
    writeFileSync(file, carteDe(300_000))
    const { app, pkg, s } = await demarrer(file)
    let tours = 0
    let fini  = false
    const tourne = () => { tours++; if (!fini) setImmediate(tourne) }
    setImmediate(tourne)
    await (pkg as any)._saveLater()
    fini = true
    assert.ok(tours >= 10, `${tours} tours rendus au serveur pendant l'écriture`)
    assert.equal(readFileSync(file, 'utf8'), JSON.stringify({ v: 1, pages: (app as any).heatmap().pages }))
    s.destroy()
    await app.stop()
  })

  it('l\'arrêt pendant une écriture de fond : le fichier est complet, aucun fichier temporaire ne reste', async () => {
    const dir  = mjsTmp('heatmap-sauvegarde-arret')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'carte.json')
    writeFileSync(file, carteDe(100_000))
    const { app, pkg, s } = await demarrer(file)
    const attendu = JSON.stringify({ v: 1, pages: (app as any).heatmap().pages })
    const fond = (pkg as any)._saveLater()
    s.destroy()
    await app.stop()
    await fond
    await tick(50)
    assert.equal(readFileSync(file, 'utf8'), attendu)
    assert.deepEqual(readdirSync(dir), ['carte.json'])
  })
})
