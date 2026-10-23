// Une identité que JSON refuse (un BigInt, comme les colonnes BigInt que rend Prisma, ou un objet cyclique d'ORM)
// faisait tomber tout le processus dès la première connexion quand un webhook `connect` était configuré : la
// sérialisation du webhook levait hors de tout try, rejet de promesse jamais géré. Désormais le webhook est
// abandonné, le journal le dit en erreur, le processus reste debout et les webhooks suivants partent.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { sansChute } from './helpers/sans-chute-processus.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

async function attendre(pred: () => boolean, ms = 4000): Promise<void> {
  const debut = Date.now()
  while (!pred()) {
    if (Date.now() - debut > ms) throw new Error('attente expirée')
    await tick(5)
  }
}

// back de webhooks minimal : garde les corps reçus
async function demarrerBack(): Promise<{ port: number; recus: any[]; fermer: () => Promise<void> }> {
  const recus: any[] = []
  const serveur = createServer((req, res) => {
    let corps = ''
    req.on('data', (c) => { corps += c })
    req.on('end', () => { recus.push(JSON.parse(corps)); res.end('ok') })
  })
  await new Promise<void>(r => serveur.listen(0, '127.0.0.1', () => r()))
  return { port: (serveur.address() as AddressInfo).port, recus, fermer: () => new Promise<void>(r => serveur.close(() => r())) }
}

// client brut : hello, attend le µ:welcome
async function connecter(transport: MemoryTransport, auth: string): Promise<void> {
  const s: any = transport.connect({})
  const trames: any[] = []
  s.onmessage = (ev: any) => { trames.push(JSON.parse(ev.data)) }
  await tick()
  s.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1, auth } }))
  await attendre(() => trames.some(f => f.t === 'µ:welcome'))
}

const CAS: Array<[string, () => unknown]> = [
  ['un BigInt', () => ({ id: 'u1', compte: 12345678901234567890n })],
  ['un objet cyclique', () => { const id: any = { id: 'u1' }; id.moi = id; return id }],
]

describe('MJS-WS — pont : identité non sérialisable et webhook connect', function () {
  this.timeout(10000)

  for (const [cas, fautive] of CAS) {
    it(`identité avec ${cas} : processus debout, webhook abandonné avec une erreur au journal, le suivant part`, async () => {
      await sansChute(async () => {
        const back = await demarrerBack()
        const journal: Array<{ level: string; message: string; meta?: any }> = []
        const transport = new MemoryTransport()
        const app = mjsWs({
          transport, heartbeat: 0,
          auth: (h: any) => (h.auth === 'fautif' ? fautive() : { id: 'u2' }),
          onLog: (level, message, meta) => { journal.push({ level, message, meta }) },
          bridge: { port: 0, secret: 'secret-de-test-webhook-identite', rateLimit: false, webhooks: { url: 'http://127.0.0.1:'+ back.port +'/hook', events: ['connect'] } },
        })
        await app.listen()
        try {
          await connecter(transport, 'fautif')
          await tick(50)
          await connecter(transport, 'sain')
          await attendre(() => back.recus.length >= 1)
          await tick(50)
          assert.equal(back.recus.length, 1, 'seul le webhook de l\'identité saine part')
          assert.equal(back.recus[0].client.identity.id, 'u2')
          const erreurs = journal.filter(l => l.level === 'error' && l.meta?.event === 'connect')
          assert.equal(erreurs.length, 1, 'une erreur au journal pour le webhook abandonné : '+ JSON.stringify(journal.map(l => l.level +' '+ l.message)))
          assert.equal(app.stats().pont.webhooksAbandonnes, 1)
        } finally {
          await app.stop()
          await back.fermer()
        }
      })
    })
  }
})
