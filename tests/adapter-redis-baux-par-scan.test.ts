// Les baux de vie des processus se listent par SCAN, lot après lot, et plus par KEYS : KEYS parcourt toute la
// base d'un bloc et fige Redis pendant ce temps, toutes les 3 s et pour chaque processus — sur un Redis partagé
// (sessions Rails, Sidekiq…), un coût proportionnel à TOUTES les clés de la base, pas aux quelques baux.
import assert from 'node:assert/strict'
import { RedisAdapter } from '../src/mjs-ws/index.js'
import { fauxRedis } from './helpers/faux-redis.js'

describe('mjs-ws/adapter-redis — listLeases parcourt la base par SCAN, jamais par KEYS', () => {
  it('plusieurs lots : toutes les clés du préfixe, chacune une fois, sans aucun KEYS', async () => {
    const cles  = ['mjs-ws:proc:a', 'sessions:42', 'mjs-ws:proc:b', 'mjs-ws:proc:a', 'sidekiq:file', 'mjs-ws:proc:c']
    const redis = await fauxRedis({ cles, pageScan: 2 })
    const adapter = new RedisAdapter({ url: redis.url })
    try {
      await adapter.start()
      const baux = await adapter.listLeases('mjs-ws:proc:')
      assert.deepEqual([...baux].sort(), ['mjs-ws:proc:a', 'mjs-ws:proc:b', 'mjs-ws:proc:c'])
      const noms = redis.commandes.map(c => c[0])
      assert.ok(!noms.includes('KEYS'), 'KEYS jamais envoyé : ' + noms.join(' '))
      const scans = redis.commandes.filter(c => c[0] === 'SCAN')
      assert.equal(scans.length, 3, 'un SCAN par lot, jusqu\'au curseur 0')
      for (const scan of scans) assert.ok(scan.join(' ').includes('MATCH mjs-ws:proc:*'), scan.join(' '))
    } finally {
      await adapter.stop()
      await redis.fermer()
    }
  })

  it('aucun bail : liste vide', async () => {
    const redis = await fauxRedis({ cles: ['autre:1'] })
    const adapter = new RedisAdapter({ url: redis.url })
    try {
      await adapter.start()
      assert.deepEqual(await adapter.listLeases('mjs-ws:proc:'), [])
    } finally {
      await adapter.stop()
      await redis.fermer()
    }
  })
})
