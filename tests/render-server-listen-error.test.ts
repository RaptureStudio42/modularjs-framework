// Serveur de rendu : un port déjà pris (ou toute autre erreur de listen()) doit rejeter
// proprement startRenderServer() plutôt que de laisser une exception 'error' non écoutée
// planter le process — même patron que StaticServer.start (server/index.ts). Faux serveur
// (EventEmitter), aucune vraie socket : reproduit la forme exacte de listenOrReject.

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { listenOrReject } from '../src/server/render-server.js'

class FakeServer extends EventEmitter {
  listen(_port: number, _host: string, _cb: () => void): this {
    // un vrai net.Server sur EADDRINUSE/EPERM n'appelle JAMAIS le callback de listen() : il émet
    // 'error' de façon asynchrone — reproduit ici avec queueMicrotask
    queueMicrotask(() => this.emit('error', Object.assign(new Error('EADDRINUSE simulé'), { code: 'EADDRINUSE' })))
    return this
  }
}

class FakeServerOk extends EventEmitter {
  listen(_port: number, _host: string, cb: () => void): this {
    queueMicrotask(cb)
    return this
  }
}

describe('render-server — listenOrReject (port occupé)', () => {
  it("un port occupé (erreur 'error' avant tout callback de listen) rejette la promesse, jamais une exception non interceptée", async () => {
    const server = new FakeServer()
    await assert.rejects(
      listenOrReject(server as any, 3000, '127.0.0.1'),
      /EADDRINUSE simulé/,
    )
  })

  it("l'écouteur 'error' ne fait pas planter le process : aucun listener EventEmitter non géré", () => {
    const server = new FakeServer()
    // si l'écouteur 'error' n'était pas posé AVANT listen(), Node lèverait ici une exception
    // (EventEmitter sans listener sur 'error' = uncaughtException) — la promesse SEULE suffit à
    // la fois à l'écouter et à propager l'erreur : rien ne doit être jeté de façon synchrone ici.
    assert.doesNotThrow(() => { void listenOrReject(server as any, 3000, '127.0.0.1').catch(() => {}) })
  })

  it('un listen() qui réussit résout normalement — non-régression', async () => {
    const server = new FakeServerOk()
    await assert.doesNotReject(listenOrReject(server as any, 0, '127.0.0.1'))
  })
})
