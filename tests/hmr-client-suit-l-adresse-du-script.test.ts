// derrière un tunnel https qui réécrit l'en-tête Host en `localhost`, le client de rechargement ouvrait `wss://localhost:<port>` : il
// composait son adresse avec le Host reçu par le serveur, et sa connexion ne passait jamais par le tunnel. Chargé par `<script src>`,
// il vise l'origine d'où il vient (`wss:` si elle est en https, `ws:` sinon), chemin `/__mjs_hmr` ; écrit en ligne (sans src), il garde
// l'adresse fournie par le serveur, au protocole de la page, comme avant

import assert from 'node:assert/strict'
import { request } from 'node:http'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import { StaticServer } from '../src/server/index.js'
import { hmrClientSnippet } from '../src/server/hmr.js'
import { mjsTmp } from './helpers/tmp.js'

// adresse que le client ouvre dans la page `page`, chargé depuis `src` ('' : écrit en ligne)
function adresseOuverte(script: string, page: string, src: string): string {
  const ouvertes: string[] = []
  class FauxWebSocket {
    constructor(url: string) { ouvertes.push(url) }
    addEventListener(): void {}
    close(): void {}
  }
  const neutre: any = new Proxy(function () {}, { get: (_c, p) => (p === Symbol.toPrimitive ? () => '' : neutre), apply: () => neutre, construct: () => neutre })
  const document    = new Proxy({}, { get: (_c, p) => (p === 'currentScript' ? { src } : neutre) })
  const u           = new URL(page)
  const ctx: any    = { location: { protocol: u.protocol, host: u.host, reload() {} }, URL, WebSocket: FauxWebSocket, console: { log() {}, warn() {}, error() {}, info() {} }, document, setTimeout: () => 0, clearTimeout() {} }
  ctx.window = ctx
  vm.runInNewContext(script, ctx)
  return ouvertes[0]
}

describe('client de rechargement à chaud — l\'adresse d\'où le script est chargé', () => {
  let srv: StaticServer
  let port = 0

  // script tel que `mjs dev` le sert à une requête dont l'en-tête Host vaut `host`
  const scriptServi = (host: string): Promise<string> => new Promise((ok, ko) => {
    const r = request({ host: '127.0.0.1', port, path: '/__mjs_hmr/client.js', headers: { host } }, (x) => {
      let corps = ''
      x.setEncoding('utf-8')
      x.on('data', (c) => { corps += c })
      x.on('end', () => (x.statusCode === 200 ? ok(corps) : ko(new Error(x.statusCode + ' ' + corps))))
    })
    r.on('error', ko)
    r.end()
  })

  before(async () => {
    const root = mjsTmp('hmr-adresse-du-script')
    mkdirSync(join(root, 'out'))
    srv = new StaticServer({ rootDir: join(root, 'out'), pathPrefix: '/modularjs', port: 0, host: '127.0.0.1', hmr: true, projectRoot: root, configDir: root, config: { dev: { allowedHosts: ['abc.ngrok-free.app'] } } as any })
    await srv.start()
    port = (srv.server!.address() as any).port
  })

  after(async () => { await srv.stop() })

  it('servi sous https://abc.ngrok-free.app avec Host réécrit en localhost : wss://abc.ngrok-free.app/__mjs_hmr', async () => {
    const script = await scriptServi('localhost:' + port)
    assert.equal(adresseOuverte(script, 'https://abc.ngrok-free.app/', 'https://abc.ngrok-free.app/__mjs_hmr/client.js'), 'wss://abc.ngrok-free.app/__mjs_hmr')
  })

  it('servi en local : rien ne change', async () => {
    const script = await scriptServi('localhost:' + port)
    assert.equal(adresseOuverte(script, `http://localhost:${port}/`, `http://localhost:${port}/__mjs_hmr/client.js`), `ws://localhost:${port}/__mjs_hmr`)
    const parTunnel = await scriptServi('abc.ngrok-free.app')
    assert.equal(adresseOuverte(parTunnel, 'https://abc.ngrok-free.app/', 'https://abc.ngrok-free.app/__mjs_hmr/client.js'), 'wss://abc.ngrok-free.app/__mjs_hmr')
  })

  it('écrit en ligne (sans src) : l\'adresse fournie par le serveur, au protocole de la page, comme avant', () => {
    const script = hmrClientSnippet('ws://localhost:3939/__mjs_hmr')
    assert.equal(adresseOuverte(script, 'https://abc.ngrok-free.app/', ''), 'wss://localhost:3939/__mjs_hmr')
    assert.equal(adresseOuverte(script, 'http://localhost:3939/', ''), 'ws://localhost:3939/__mjs_hmr')
  })

  it('chargé depuis une autre origine que la page : l\'origine du script, à son protocole', () => {
    const script = hmrClientSnippet('ws://127.0.0.1:3939/__mjs_hmr')
    assert.equal(adresseOuverte(script, 'http://localhost:3000/', 'http://127.0.0.1:3939/__mjs_hmr/client.js'), 'ws://127.0.0.1:3939/__mjs_hmr')
    assert.equal(adresseOuverte(script, 'https://app.exemple.test/', 'http://127.0.0.1:3939/__mjs_hmr/client.js'), 'ws://127.0.0.1:3939/__mjs_hmr')
  })
})
