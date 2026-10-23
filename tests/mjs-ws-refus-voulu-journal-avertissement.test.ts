// MJS-WS : une MjsWsError levée par un serve() ou un on() est un refus VOULU par l'application (« ce n'est pas votre tour »), fait pour le
// client. Elle était journalisée en ERREUR, avec sa pile, à chaque refus : le journal se remplissait d'alarmes qui n'en sont pas. Elle part
// en avertissement, sa phrase dans le message, sans pile ; une vraie erreur interne reste une erreur, avec sa pile

import assert from 'node:assert/strict'
import { mjsWs, MjsWsError } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

interface Ligne { level: string; message: string; meta: any }

async function demarrer() {
  const journal: Ligne[] = []
  const transport = new MemoryTransport()
  const app       = mjsWs({ transport, heartbeat: 0, auth: (h: any) => h.auth, onLog: (level: string, message: string, meta: any) => { journal.push({ level, message, meta }) } })
  app.serve('phrase', () => { throw new MjsWsError('ce n’est pas votre tour') })
  app.serve('panne', () => { throw new TypeError('lecture de undefined') })
  app.on('note', () => { throw new MjsWsError('note refusée') })
  await app.listen()
  const ws     = transport.connect({ url: 'memory://refus' })
  const trames: any[] = []
  ws.onmessage = (ev: any) => trames.push(JSON.parse(ev.data))
  await tick()
  ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1, auth: { id: 'joueur' } } }))
  await tick(10)
  let numero = 0
  const requete = async (type: string): Promise<any> => {
    const id = ++numero
    ws.send(JSON.stringify({ t: type, p: {}, id }))
    for (let i = 0; i < 200; i++) {
      const ack = trames.find(f => f.t === 'µ:ack' && f.id === id)
      if (ack) return ack
      await tick(5)
    }
    throw new Error('accusé jamais reçu pour ' + type)
  }
  return { app, journal, ws, requete }
}

const lignesDe = (journal: Ligne[], type: string) => journal.filter(l => l.message.includes(`('${type}')`))

describe('MJS-WS — un refus voulu (MjsWsError) est journalisé en avertissement, sans pile', () => {
  it('serve() : avertissement, la phrase du refus dans le message, aucune pile', async () => {
    const { app, journal, requete } = await demarrer()
    try {
      const ack = await requete('phrase')
      assert.equal(ack.e, true)
      const lignes = lignesDe(journal, 'phrase')
      assert.deepEqual(lignes.map(l => l.level), ['warn'], JSON.stringify(journal))
      assert.ok(lignes[0].message.includes('ce n’est pas votre tour'), lignes[0].message)
      assert.ok(!JSON.stringify(lignes[0].meta ?? null).includes('    at '), 'aucune pile')
      assert.ok(!(lignes[0].meta && lignes[0].meta.err), 'aucune erreur jointe')
    }
    finally { await app.stop() }
  })

  it('on() : avertissement aussi', async () => {
    const { app, journal, ws } = await demarrer()
    try {
      ws.send(JSON.stringify({ t: 'note', p: {} }))
      for (let i = 0; i < 100 && lignesDe(journal, 'note').length === 0; i++) await tick(5)
      assert.deepEqual(lignesDe(journal, 'note').map(l => l.level), ['warn'], JSON.stringify(journal))
    }
    finally { await app.stop() }
  })

  it('une vraie erreur interne reste une erreur, avec sa pile', async () => {
    const { app, journal, requete } = await demarrer()
    try {
      await requete('panne')
      const lignes = lignesDe(journal, 'panne')
      assert.deepEqual(lignes.map(l => l.level), ['error'])
      assert.ok(lignes[0].meta?.err instanceof Error && typeof lignes[0].meta.err.stack === 'string')
    }
    finally { await app.stop() }
  })
})
