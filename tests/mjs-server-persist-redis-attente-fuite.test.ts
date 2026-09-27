// Régression — persist-redis.ts (RedisPersistAdapter._awaitConnection) : une attente de connexion
// qui EXPIRE (Redis indisponible) doit retirer son rappel de la file interne `_ready`, sinon chaque
// attente expirée y laisse une fermeture (closure) pour toujours — accumulation mémoire tant que
// Redis reste injoignable, jamais purgée avant la prochaine connexion réussie.
import assert from 'node:assert/strict'
import { RedisPersistAdapter } from '../src/mjs-server/index.js'

describe('mjs-server/persist-redis — _awaitConnection : pas de fuite du rappel au délai expiré', () => {
  it('20 attentes qui expirent toutes (connexion jamais prête) ne laissent AUCUN rappel accumulé dans _ready', async () => {
    const adapter = new RedisPersistAdapter({ host: '127.0.0.1', port: 1, onLog: () => {} }) as any
    // faux client RESP qui ne se connecte JAMAIS — aucune vraie socket ouverte
    adapter._conn = { ready: false, connect() {}, send() { return Promise.resolve([]) }, stop() {} }

    const résultats = await Promise.all(Array.from({ length: 20 }, () => adapter._awaitConnection(20)))
    assert.ok(résultats.every((r: boolean) => r === false), 'sanity : les 20 attentes expirent bien (connexion jamais prête)')
    assert.equal(adapter._ready.length, 0, 'aucun rappel ne doit rester dans _ready après expiration — chacun se retire lui-même')
  })

  it('une attente qui expire PUIS une connexion réussie plus tard ne rejoue pas le rappel déjà expiré', async () => {
    const adapter = new RedisPersistAdapter({ host: '127.0.0.1', port: 1, onLog: () => {} }) as any
    let appelsWake = 0
    adapter._conn = { ready: false, connect() {}, send() { return Promise.resolve([]) }, stop() {} }

    const résultat = await adapter._awaitConnection(10)
    assert.equal(résultat, false, 'sanity : expire (connexion jamais prête)')
    assert.equal(adapter._ready.length, 0, 'le rappel expiré a été retiré')

    // simule une connexion RÉUSSIE après coup (onConnected du constructeur) — ne doit rien avoir à
    // rejouer, la file est déjà vide
    adapter._conn.ready = true
    const queue = adapter._ready.splice(0)
    for (const wake of queue) { appelsWake++; wake() }
    assert.equal(appelsWake, 0, "aucun rappel obsolète ne doit être rejoué — celui de l'attente expirée est déjà parti")
  })
})
