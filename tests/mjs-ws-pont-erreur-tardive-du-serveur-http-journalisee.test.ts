// Pont : une erreur du serveur HTTP après le démarrage (accept qui échoue quand les fichiers ouverts sont épuisés) part
// au journal, la seconde comme la première — l'écouteur du démarrage avalait la première en silence, et la seconde,
// sans écouteur, levait et faisait tomber le processus
import assert from 'node:assert/strict'
import http from 'node:http'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { t } from '../src/messages/index.js'

const SECRET = 'secret-de-pont-assez-long-pour-les-essais-0123456789'

describe('MJS-WS — pont : erreur tardive du serveur HTTP', () => {
  it('deux erreurs après le démarrage partent au journal, aucune ne lève', async () => {
    const servers: http.Server[] = []
    const listen = http.Server.prototype.listen
    http.Server.prototype.listen = function(this: http.Server, ...args: unknown[]) { servers.push(this); return (listen as any).apply(this, args) } as any
    const errors: string[] = []
    const app = mjsWs({ transport: new MemoryTransport(), heartbeat: 0, bridge: { port: 0, host: '127.0.0.1', secret: SECRET }, onLog: (level, message) => { if (level === 'error') errors.push(message) } })
    try { await app.listen() }
    finally { http.Server.prototype.listen = listen }
    const thrown: unknown[] = []
    for (const n of [1, 2]) {
      try { servers[0]?.emit('error', Object.assign(new Error('accept EMFILE ' + n), { code: 'EMFILE' })) }
      catch (err) { thrown.push(err) }
    }
    await app.stop()
    assert.equal(servers.length, 1, 'serveur HTTP du pont')
    assert.deepEqual(thrown.map(String), [], 'erreur tardive levée')
    assert.equal(errors.filter(m => m === t('ws.bridge.error-server-http')).length, 2, 'erreurs tardives au journal')
  })
})
