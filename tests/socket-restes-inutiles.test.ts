// µ.socket — rien d'inutile ne reste :
//   - aucun drapeau d'effet que personne ne lit (`_mjs_byFx`) sur une connexion créée, reprise ou ouverte
//     par un effet ;
//   - créer une connexion ne réveille pas les effets en attente : seule l'ouverture d'une connexion le fait
//     (une connexion neuve ne change rien à celle qu'un effet attend) ;
//   - la case d'un envoi regroupé (`coalesce`, `key`) est libérée une fois le message parti : un salon
//     visité de plus ne laisse pas une case de plus à vie ;
//   - la case d'un envoi différé (`debounce`, `key`) de même : libérée une fois le message parti, gardée
//     tant qu'il attend (un lien saturé).

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const ICI       = dirname(fileURLToPath(import.meta.url))
const socketSrc = readFileSync(join(ICI, '../src/runtime/mjs_socket.ts'), 'utf8')
const tick      = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

function makeClient(transport: MemoryTransport): any {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  const µ: any = { state: (o: any) => ({ ...o }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', socketSrc)(µ)
  return µ
}

describe('µ.socket — rien d\'inutile ne reste', () => {
  it('une connexion créée, reprise par un second appel, ou ouverte par un effet (server) ne porte aucun drapeau d\'effet', async () => {
    const transport = new MemoryTransport()
    const app       = mjsWs({ transport, heartbeat: 0, onLog: () => {} } as any)
    await app.listen()
    const µ = makeClient(transport)
    const a = µ.socket('memory://drapeau', { reconnect: { enabled: false } })
    const b = µ.socket('memory://drapeau')
    assert.ok(a === b, 'le même objet, repris')
    assert.equal('_mjs_byFx' in a, false, 'créée puis reprise')
    const liens: any[] = []
    const stop = µ._mjs_fxSock(undefined, 'memory://drapeau-effet', 'msg', (k: any) => {
      liens.push(k)
      return () => {}
    })
    assert.equal('_mjs_byFx' in liens[0], false, 'ouverte par un effet')
    stop()
    a.destroy()
    a.destroy()
    await app.stop()
  })

  it('créer une connexion ne réveille pas les effets en attente ; son ouverture, si', async () => {
    const transport = new MemoryTransport()
    const app       = mjsWs({ transport, heartbeat: 0, onLog: () => {} } as any)
    await app.listen()
    const µ = makeClient(transport)
    const reveils: number[] = []
    const reel = µ._mjs_sockWake
    µ._mjs_sockWake = () => { reveils.push(1); reel() }
    const s = µ.socket('memory://reveil', { reconnect: { enabled: false } })
    assert.equal(reveils.length, 0, 'rien à la création')
    s.connect()
    await tick(30)
    assert.equal(s.state, 'open')
    assert.ok(reveils.length >= 1, 'l\'ouverture réveille')
    s.destroy()
    await app.stop()
  })

  it('un effet qui attend qu\'une connexion à `auth` s\'ouvre s\'y branche à son ouverture, pas à la création d\'une autre', async () => {
    const transport = new MemoryTransport()
    const app       = mjsWs({ transport, heartbeat: 0, onLog: () => {} } as any)
    await app.listen()
    const µ        = makeClient(transport)
    const attendue = µ.socket('memory://attendue', { auth: () => ({ id: 'a' }), reconnect: { enabled: false } })
    const liens: any[] = []
    const stop = µ._mjs_fxSock(attendue, undefined, 'msg', (k: any) => {
      liens.push(k)
      return () => {}
    })
    const autre = µ.socket('memory://autre-creee', { reconnect: { enabled: false } })
    await tick(10)
    assert.equal(liens.length, 0, 'une autre connexion créée ne la fait pas attendre moins')
    attendue.connect()
    await tick(30)
    assert.equal(liens.length, 1, 'ouverte : l\'effet s\'y branche')
    stop()
    attendue.destroy()
    autre.destroy()
    await app.stop()
  })

  it('l\'envoi regroupé d\'un salon parti ne laisse pas sa case : une case par envoi en attente, aucune au repos', async () => {
    const transport = new MemoryTransport()
    const app       = mjsWs({ transport, heartbeat: 0, onLog: () => {} } as any)
    await app.listen()
    const µ = makeClient(transport)
    µ._fxConf = { rate: 100 }
    const s = µ.socket('memory://cases', { reconnect: { enabled: false } })
    s.connect()
    await tick(30)
    const pages = ['/a', '/b', '/c', '/d']
    for (const p of pages) s.send('cursors:move', { room: p, p: null }, { coalesce: 5, volatile: true, key: p })
    assert.equal(Object.keys(s._mjs_coalesce).length, pages.length, 'une case par salon, le temps que le message parte')
    await tick(80)
    assert.deepEqual(Object.keys(s._mjs_coalesce), [], 'une fois partis, plus aucune case')
    // et la case se refait quand le salon envoie de nouveau
    s.send('cursors:move', { room: '/a', p: null }, { coalesce: 5, volatile: true, key: '/a' })
    assert.equal(Object.keys(s._mjs_coalesce).length, 1)
    await tick(80)
    assert.deepEqual(Object.keys(s._mjs_coalesce), [])
    s.destroy()
    await app.stop()
  })

  it('un envoi regroupé retenu (la part des effets épuisée, un lien saturé) garde sa case et sa dernière valeur, puis part', async () => {
    const transport = new MemoryTransport()
    const vus: any[] = []
    const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} } as any)
    app.on('pos', (p: any) => { vus.push(p.n) })
    await app.listen()
    const µ = makeClient(transport)
    µ._fxConf = { rate: 1 }
    const s = µ.socket('memory://retenu', { reconnect: { enabled: false } })
    s.connect()
    await tick(30)
    // un premier envoi qui vide le seau (1 par seconde), puis deux de plus : le second remplace le premier
    s.send('pos', { n: 1 }, { coalesce: 5, volatile: true })
    await tick(30)
    s.send('pos', { n: 2 }, { coalesce: 5, volatile: true })
    s.send('pos', { n: 3 }, { coalesce: 5, volatile: true })
    await tick(30)
    assert.deepEqual(vus, [1], 'la part est épuisée : le reste attend')
    assert.equal(Object.keys(s._mjs_coalesce).length, 1, 'sa case est gardée tant qu\'il attend')
    await tick(1200)
    assert.deepEqual(vus, [1, 3], 'la dernière valeur part, pas la précédente')
    assert.deepEqual(Object.keys(s._mjs_coalesce), [], 'puis la case est libérée')
    s.destroy()
    await app.stop()
  })

  it('l\'envoi différé (`debounce`, `key`) d\'un salon parti ne laisse pas sa case : une case par envoi en attente, aucune au repos', async () => {
    const transport = new MemoryTransport()
    const vus: string[] = []
    const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} } as any)
    app.on('cursors:move', (p: any) => { vus.push(p.room) })
    await app.listen()
    const µ = makeClient(transport)
    µ._fxConf = { rate: 100 }
    const s = µ.socket('memory://cases-differees', { reconnect: { enabled: false } })
    s.connect()
    await tick(30)
    const pages = ['/a', '/b', '/c', '/d']
    for (const p of pages) s.send('cursors:move', { room: p, p: null }, { debounce: 5, volatile: true, key: p })
    assert.equal(Object.keys(s._mjs_debounce).length, pages.length, 'une case par salon, le temps que le message parte')
    await tick(80)
    assert.deepEqual([...vus].sort(), pages, 'chaque message est parti')
    assert.deepEqual(Object.keys(s._mjs_debounce), [], 'une fois partis, plus aucune case')
    // et la case se refait quand le salon envoie de nouveau
    s.send('cursors:move', { room: '/a', p: null }, { debounce: 5, volatile: true, key: '/a' })
    assert.equal(Object.keys(s._mjs_debounce).length, 1)
    await tick(80)
    assert.equal(vus.filter((r) => r === '/a').length, 2, 'le second message du salon est parti aussi')
    assert.deepEqual(Object.keys(s._mjs_debounce), [])
    s.destroy()
    await app.stop()
  })

  it('un envoi différé retenu (un lien saturé) garde sa case et sa dernière valeur, puis part et la libère', async () => {
    const transport = new MemoryTransport()
    const vus: number[] = []
    const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} } as any)
    app.on('pos', (p: any) => { vus.push(p.n) })
    await app.listen()
    const µ = makeClient(transport)
    const s = µ.socket('memory://differe-retenu', { reconnect: { enabled: false } })
    s.connect()
    await tick(30)
    s._mjs_ws.bufferedAmount = 100000
    s.send('pos', { n: 1 }, { debounce: 5, volatile: true, key: 'k' })
    s.send('pos', { n: 2 }, { debounce: 5, volatile: true, key: 'k' })
    await tick(60)
    assert.deepEqual(vus, [], 'le lien est saturé : rien ne part')
    assert.equal(Object.keys(s._mjs_debounce).length, 1, 'sa case est gardée tant qu\'il attend')
    s._mjs_ws.bufferedAmount = 0
    await tick(60)
    assert.deepEqual(vus, [2], 'la dernière valeur part, pas la précédente')
    assert.deepEqual(Object.keys(s._mjs_debounce), [], 'puis la case est libérée')
    s.destroy()
    await app.stop()
  })
})
