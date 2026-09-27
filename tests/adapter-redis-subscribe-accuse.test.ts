// adapter-redis.ts::RedisConnection._onValue — les accusés SUBSCRIBE/UNSUBSCRIBE (push array
// ['subscribe'|'unsubscribe', canal, compte]) étaient ignorés SANS jamais dépiler _pending : la
// PendingReply posée par send(['SUBSCRIBE', canal]) restait à jamais non réglée, _pending
// grossissait d'une entrée à CHAQUE abonnement pour toute la durée de vie de la connexion. Les
// accusés dépilent désormais _pending (FIFO, même commande).
import assert from 'node:assert/strict'
import { RedisAdapter } from '../src/mjs-ws/adapter-redis.js'

describe('adapter-redis — les accusés subscribe/unsubscribe dépilent _pending (aucune fuite)', () => {
  it('a. un accusé subscribe consomme la PendingReply correspondante — _pending revient à 0', () => {
    const adapter = new RedisAdapter({ url: 'redis://x/0', onLog: () => {} })
    ;(adapter as any)._sub._ready  = true
    ;(adapter as any)._sub._socket = { write() {}, destroy() {}, on() {} }

    adapter.subscribe('notifs', () => {})
    assert.equal((adapter as any)._sub._pending.length, 1, 'send(SUBSCRIBE) enfile bien une PendingReply')

    ;(adapter as any)._sub._onValue(['subscribe', 'notifs', 1])
    assert.equal((adapter as any)._sub._pending.length, 0, 'accusé dépilé — plus aucune fuite')
  })

  it('b. plusieurs abonnements successifs, chacun accusé → _pending reste borné, jamais cumulatif', () => {
    const adapter = new RedisAdapter({ url: 'redis://x/0', onLog: () => {} })
    ;(adapter as any)._sub._ready  = true
    ;(adapter as any)._sub._socket = { write() {}, destroy() {}, on() {} }

    for (const canal of ['a', 'b', 'c', 'd', 'e']) {
      adapter.subscribe(canal, () => {})
      assert.equal((adapter as any)._sub._pending.length, 1)
      ;(adapter as any)._sub._onValue(['subscribe', canal, 1])
      assert.equal((adapter as any)._sub._pending.length, 0, `canal ${canal} — aucune accumulation après 5 abonnements successifs`)
    }
  })

  it('c. un accusé unsubscribe dépile également', () => {
    const adapter = new RedisAdapter({ url: 'redis://x/0', onLog: () => {} })
    const sub: any = (adapter as any)._sub
    sub._ready  = true
    sub._socket = { write() {}, destroy() {}, on() {} }

    sub.send(['UNSUBSCRIBE', 'notifs'])
    assert.equal(sub._pending.length, 1)
    sub._onValue(['unsubscribe', 'notifs', 0])
    assert.equal(sub._pending.length, 0, 'unsubscribe dépile comme subscribe')
  })

  it('d. un push "message" (non sollicité) ne touche PAS _pending — seuls subscribe/unsubscribe dépilent', () => {
    const adapter = new RedisAdapter({ url: 'redis://x/0', onLog: () => {} })
    ;(adapter as any)._sub._ready  = true
    ;(adapter as any)._sub._socket = { write() {}, destroy() {}, on() {} }

    adapter.subscribe('notifs', () => {})
    assert.equal((adapter as any)._sub._pending.length, 1)
    ;(adapter as any)._sub._onValue(['message', 'notifs', JSON.stringify({ origin: 'autre', payload: 1 })])
    assert.equal((adapter as any)._sub._pending.length, 1, 'un push "message" reste indépendant de la PendingReply du subscribe en cours')
  })
})
