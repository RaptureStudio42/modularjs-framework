// Un message mal formé publié sur un canal Redis de l'adaptateur (autre appli qui partage le Redis, outil
// d'admin, version voisine pendant une mise à jour) est ignoré avec un avertissement regroupé : aucun
// processus ne s'arrête. Avant, un seul message sans `except` levait dans l'écouteur du socket et faisait
// tomber chaque processus abonné, tout le groupe d'un coup.
import assert from 'node:assert/strict'
import { mjsWs, RedisAdapter } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { fauxRedis } from './helpers/faux-redis.js'
import { sansChute } from './helpers/sans-chute-processus.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))
const message = (payload: unknown): string => JSON.stringify({ origin: 'un-autre-processus', payload })

describe('MJS-WS — adaptateur Redis : un message mal formé ne fait tomber aucun processus', () => {
  it('messages de forme inattendue sur chaque canal : ignorés, le processus reste debout et sert toujours', async () => {
    const redis    = await fauxRedis()
    const journal: Array<[string, string]> = []
    const transport = new MemoryTransport()
    const app = mjsWs({ transport, heartbeat: 0, adapter: { redis: redis.url }, antiEntropy: false, onLog: (niveau, msg) => journal.push([niveau, msg]) })
    try {
      await sansChute(async () => {
        await app.listen()
        await tick(50)
        assert.ok(redis.abonnes.length > 0, 'abonné aux canaux')
        const ws = transport.connect({ url: 'ws://visiteur/' })
        const recu: any[] = []
        ws.onmessage = (ev: any) => recu.push(JSON.parse(ev.data))
        await tick()
        ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1, resub: [], rooms: [] } }))
        await tick()

        redis.pousser('mjs-ws:broadcast', message({ type: 'annonce', p: 1 }))                    // sans `except`
        redis.pousser('mjs-ws:room:send', message({ room: 'salon', type: 'x', p: 1, except: 'a' }))
        redis.pousser('mjs-ws:room:kick', message({ room: 42, target: null }))
        redis.pousser('mjs-ws:identity:kick', message({ identityId: { id: 1 } }))
        redis.pousser('mjs-ws:ban', message({ cle: 7, duree: 'demain' }))
        redis.pousser('mjs-ws:send', message({ client: 5, type: null }))
        redis.pousser('mjs-ws:stream', message({ name: 'flux', seq: 1, p: { op: 'reset', values: null } }))
        redis.pousser('mjs-ws:stream', message({ name: 'flux', seq: 'deux', p: null }))
        redis.pousser('mjs-ws:presence', message({ room: 3, op: 'boum', id: null }))
        redis.pousser('mjs-ws:broadcast', 'pas du JSON')
        redis.pousser('mjs-ws:broadcast', message(null))
        await tick(60)

        redis.pousser('mjs-ws:broadcast', message({ type: 'annonce', p: 2, except: [] }))
        await tick(60)
        assert.deepEqual(recu.filter(f => f.t === 'annonce').map(f => f.p), [2], 'un message bien formé passe toujours')
      })
      const avertis = journal.filter(([niveau]) => niveau === 'warn').map(([, msg]) => msg).join('\n')
      for (const canal of ['broadcast', 'room:send', 'room:kick', 'identity:kick', 'ban', 'send', 'stream', 'presence']) {
        assert.ok(avertis.includes(`mjs-ws:${canal}`), `avertissement pour le canal mjs-ws:${canal}`)
      }
    } finally {
      await app.stop()
      await redis.fermer()
    }
  })

  it('un rappel d\'abonnement qui lève : rattrapé, un seul avertissement pour une rafale', async () => {
    const redis = await fauxRedis()
    const journal: string[] = []
    const adapter = new RedisAdapter({ url: redis.url, onLog: (niveau, msg) => { if (niveau === 'warn') journal.push(msg) } })
    let appels = 0
    adapter.subscribe('canal-fragile', () => { appels++; throw new TypeError('boum') })
    try {
      await sansChute(async () => {
        await adapter.start()
        await tick(50)
        for (let i = 0; i < 5; i++) redis.pousser('canal-fragile', message({ i }))
        await tick(60)
      })
      assert.equal(appels, 5, 'chaque message est bien remis au rappel')
      const surLeCanal = journal.filter(msg => msg.includes('canal-fragile'))
      assert.equal(surLeCanal.length, 1, 'un seul avertissement pour la rafale : ' + surLeCanal.join(' | '))
      assert.match(surLeCanal[0], /boum/)
    } finally {
      await adapter.stop()
      await redis.fermer()
    }
  })
})
