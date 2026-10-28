// Un serveur MJS-WS encode en binaire tout message dont il déclare le schéma (`app.schema`), sans regarder ce que la page sait
// lire ; l'écran l'écoute par `sock.on` sans rien déclarer (le serveur pousse ses schémas). Sans le module 'schema' au cœur, la
// trame ne peut pas être lue : elle reste ignorée, mais un avertissement le dit, une seule fois, avec quoi écrire. Avec le
// module, le message arrive décodé, sans un mot. VRAI serveur MJS-WS (MemoryTransport) + VRAI client (mjs_socket.ts, avec ou
// sans mjs_schema.ts, concaténés dans l'ordre du cœur), même patron que tests/socket-schema.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsWsApp } from '../src/mjs-ws/index.js'
import { poserMessages } from './helpers/messages-stub.js'

const ici       = dirname(fileURLToPath(import.meta.url))
const socketSrc = readFileSync(join(ici, '../src/runtime/mjs_socket.ts'), 'utf8')
const schemaSrc = readFileSync(join(ici, '../src/runtime/mjs_schema.ts'), 'utf8')

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

// un cœur neuf par client (le « déjà dit » est celui de son cœur), ses avertissements relevés
function client(transport: MemoryTransport, avecSchema: boolean): { µ: any, avertis: string[] } {
  const avertis: string[] = []
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, log: () => {}, warn: (...a: any[]) => avertis.push(a.map(String).join(' ')) }
  poserMessages(µ)
  new Function('µ', avecSchema ? socketSrc + '\n' + schemaSrc : socketSrc)(µ)
  return { µ, avertis }
}

// le serveur de la partie : un schéma déclaré de son côté seulement
async function serveur(): Promise<{ transport: MemoryTransport; app: MjsWsApp }> {
  const transport = new MemoryTransport()
  const app       = mjsWs({ transport, heartbeat: 0 })
  app.schema('echecs.move', { n: 'u16', h: 'u32' })
  await app.listen()
  return { transport, app }
}

// connecte l'écran, qui écoute les coups ; rend ce qu'il reçoit et ce que le navigateur a vu passer
async function ecran(transport: MemoryTransport, avecSchema: boolean, url: string): Promise<{ avertis: string[], coups: any[], trames: any[] }> {
  const { µ, avertis } = client(transport, avecSchema)
  const coups: any[]  = []
  const trames: any[] = []
  const sock = µ.socket(url, { auth: () => ({ id: url }), reconnect: { enabled: false } })
  sock.on('echecs.move', (p: any) => coups.push(p))
  sock.connect()
  await tick()
  const recevoir = sock._mjs_ws.onmessage.bind(sock._mjs_ws)
  sock._mjs_ws.onmessage = (ev: any) => { trames.push(ev.data); recevoir(ev) }
  return { avertis, coups, trames }
}

describe('µ.socket — une trame binaire sans le module schema', () => {
  it('ignorée, et dite une seule fois : le module manquant et quoi écrire dans mjs.config.json', async () => {
    const { transport, app } = await serveur()
    const vu = await ecran(transport, false, 'memory://partie-sans-schema')
    const joueur = Array.from(app.clients)[0]
    app.send(joueur, 'echecs.move', { n: 7, h: 42 })
    app.send(joueur, 'echecs.move', { n: 8, h: 43 })
    await tick()
    assert.equal(vu.trames.length, 2)
    assert.ok(vu.trames.every(d => typeof d !== 'string'), 'le serveur encode en binaire : ' + vu.trames.map(d => typeof d).join(', '))
    assert.equal(vu.coups.length, 0, 'sans le module, la trame ne peut pas être lue')
    const dits = vu.avertis.filter(a => a.includes('binaire'))
    assert.equal(dits.length, 1, 'AVANT : la trame était jetée sans un mot ; un seul avertissement pour deux trames attendu : ' + JSON.stringify(vu.avertis))
    assert.match(dits[0], /'schema'/)
    assert.match(dits[0], /"runtime"/)
    assert.match(dits[0], /mjs\.config\.json/)
    assert.match(dits[0], /ajoutez/i, 'au vouvoiement, il dit quoi faire')
    await app.stop()
  })

  it('avec le module schema, le coup arrive décodé et rien n\'est dit', async () => {
    const { transport, app } = await serveur()
    const vu = await ecran(transport, true, 'memory://partie-avec-schema')
    app.send(Array.from(app.clients)[0], 'echecs.move', { n: 7, h: 42 })
    await tick()
    assert.equal(vu.trames.length, 1)
    assert.deepEqual(vu.coups, [{ n: 7, h: 42 }])
    assert.deepEqual(vu.avertis, [])
    await app.stop()
  })
})
