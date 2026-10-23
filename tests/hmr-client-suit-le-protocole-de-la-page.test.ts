// Le client de rechargement à chaud ouvrait toujours `ws://…` : une page servie en https (par un tunnel, par exemple) se voyait
// refuser cette connexion (contenu mixte), et le rechargement ne venait jamais. Il suit maintenant le protocole de la page :
// `wss:` sous https, `ws:` sinon.

import assert from 'node:assert/strict'
import vm from 'node:vm'
import { hmrClientSnippet } from '../src/server/hmr.js'

function adresseOuverte(protocol: string): string {
  const ouvertes: string[] = []
  class FauxWebSocket {
    constructor(url: string) { ouvertes.push(url) }
    addEventListener(): void {}
    close(): void {}
  }
  const neutre: any = new Proxy(function () {}, { get: (_c, p) => (p === Symbol.toPrimitive ? () => '' : neutre), apply: () => neutre, construct: () => neutre })
  const ctx: any = { location: { protocol, host: 'tunnel.test', reload() {} }, WebSocket: FauxWebSocket, console: { log() {}, warn() {}, error() {}, info() {} }, document: neutre, setTimeout: () => 0, clearTimeout() {} }
  ctx.window = ctx
  vm.runInNewContext(hmrClientSnippet('ws://127.0.0.1:1234/__mjs_hmr'), ctx)
  return ouvertes[0]
}

describe('client de rechargement à chaud — protocole de la page', () => {
  it('page en https : wss://', () => {
    assert.equal(adresseOuverte('https:'), 'wss://127.0.0.1:1234/__mjs_hmr')
  })

  it('page en http : ws://, comme avant', () => {
    assert.equal(adresseOuverte('http:'), 'ws://127.0.0.1:1234/__mjs_hmr')
  })
})
