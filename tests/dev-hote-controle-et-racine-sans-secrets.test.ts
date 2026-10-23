// `mjs dev` sans bloc `render` servait tout le dossier du projet : `config/master.key`,
// `log/…` (le journal d'erreurs, même quand sa page est fermée), les `.server.mjs` (secrets du
// serveur), `mjs.config.json`… Et il répondait quel que soit l'en-tête Host : une page web
// quelconque pouvait tout lire par rebinding DNS (son nom de domaine qui bascule vers 127.0.0.1).
// Désormais : seules les ressources qu'un navigateur doit charger sortent de la racine du projet,
// et une requête dont l'hôte n'est pas celui du serveur de développement est refusée (403).

import assert from 'node:assert/strict'
import { request } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { StaticServer } from '../src/server/index.js'

function get(port: number, path: string, host: string, adresse = '127.0.0.1'): Promise<{ status: number, body: string, headers: any }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: adresse, port, path, method: 'GET', headers: { host } }, (res) => {
      let body = ''
      res.setEncoding('utf-8')
      res.on('data', (c) => { body += c })
      res.on('end', () => resolve({ status: res.statusCode!, body, headers: res.headers }))
    })
    req.on('error', reject)
    req.end()
  })
}

describe('mjs dev — hôte contrôlé, racine du projet sans secrets', () => {
  let server: StaticServer, port: number, root: string

  before(async function () {
    this.timeout(15000)
    root = mjsTmp('dev-hote-racine')
    for (const d of ['config', 'log', 'public', 'out', 'app']) mkdirSync(join(root, d), { recursive: true })
    writeFileSync(join(root, 'index.html'), '<!doctype html><html><body>Accueil</body></html>')
    writeFileSync(join(root, 'public', 'style.css'), 'body{}')
    writeFileSync(join(root, 'public', 'donnees.json'), '{"ok":true}')
    writeFileSync(join(root, 'config', 'master.key'), 'CLE-SECRETE')
    writeFileSync(join(root, 'config', 'routes.js'), 'secret')
    writeFileSync(join(root, 'log', 'mjs-errors-client.ndjson'), '{"message":"jeton"}')
    writeFileSync(join(root, 'log', 'journal.json'), '{"message":"jeton"}')
    writeFileSync(join(root, 'serve.server.mjs'), "SECRET = 'sk_live'")
    writeFileSync(join(root, 'app', 'page.mjs'), '<p>source</p>')
    writeFileSync(join(root, 'mjs.config.json'), '{}')
    writeFileSync(join(root, 'package.json'), '{}')
    writeFileSync(join(root, 'database.yml'), 'password: x')
    writeFileSync(join(root, 'out', 'mjs_core-41jbg.js'), '/* cœur */')
    writeFileSync(join(root, 'out', 'mjs_core-41jbg.js.map'), '{}')
    server = new StaticServer({ rootDir: join(root, 'out'), pathPrefix: '/modularjs', port: 0, host: '127.0.0.1', projectRoot: root })
    await server.start()
    port = (server.server!.address() as any).port
  })

  after(async () => { await server.stop() })

  it('ressources du navigateur servies : page, feuille, données', async () => {
    const h = `127.0.0.1:${port}`
    assert.equal((await get(port, '/', h)).status, 200)
    assert.equal((await get(port, '/public/style.css', h)).status, 200)
    assert.equal((await get(port, '/public/donnees.json', h)).status, 200)
  })

  it('jamais servis : clés, journal, sources serveur, configuration', async () => {
    const h = `localhost:${port}`
    for (const p of ['/config/master.key', '/config/routes.js', '/log/mjs-errors-client.ndjson', '/log/journal.json', '/serve.server.mjs', '/app/page.mjs', '/mjs.config.json', '/package.json', '/database.yml']) {
      const r = await get(port, p, h)
      assert.equal(r.status, 404, p)
      assert.doesNotMatch(r.body, /SECRETE|jeton|sk_live|password|source/, p)
    }
  })

  it('hôte étranger (rebinding DNS) : 403 sur toutes les routes', async () => {
    for (const p of ['/', '/public/style.css', '/modularjs/mjs_core-41jbg.js', '/__mjs_hmr/client.js']) {
      const r = await get(port, p, `attaquant.example:${port}`)
      assert.equal(r.status, 403, p)
    }
  })

  it('hôtes locaux acceptés : localhost, 127.0.0.1, [::1]', async () => {
    for (const h of [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`, 'localhost']) {
      assert.equal((await get(port, '/', h)).status, 200, h)
    }
  })

  it('une carte .map garde no-cache même nommée avec une empreinte', async () => {
    const h = `127.0.0.1:${port}`
    assert.equal((await get(port, '/modularjs/mjs_core-41jbg.js', h)).headers['cache-control'], 'public, max-age=31536000, immutable')
    assert.equal((await get(port, '/modularjs/mjs_core-41jbg.js.map', h)).headers['cache-control'], 'no-cache')
  })
})

describe('mjs dev — hôte IPv6 et rechargement à chaud', () => {
  it('serveur sur ::1 : client de rechargement avec une adresse valide, page du journal sans plantage', async function () {
    this.timeout(15000)
    const root = mjsTmp('dev-hote-v6')
    mkdirSync(join(root, 'out'), { recursive: true })
    const journal: any = { list: () => [], purge() {}, record() {} }
    const server = new StaticServer({ rootDir: join(root, 'out'), port: 0, host: '::1', hmr: true, journal, config: { journal: { viewer: true } } as any })
    try {
      await server.start()
    } catch (e: any) {
      if (e && e.code === 'EADDRNOTAVAIL') this.skip()
      throw e
    }
    try {
      const port = (server.server!.address() as any).port
      const r = await get(port, '/__mjs_hmr/client.js', `[::1]:${port}`, '::1')
      assert.equal(r.status, 200)
      // l'adresse écrite dans le client (son protocole suit ensuite celui de la page : wss: sous https)
      const m = r.body.match(/new WebSocket\(.*?'(wss?:\/\/[^']+)'/)
      assert.ok(m, 'adresse du WebSocket introuvable')
      assert.doesNotThrow(() => new URL(m![1]), m![1])
      assert.equal(new URL(m![1]).host, `[::1]:${port}`)
      const j = await get(port, '/__mjs/errors.json', `[::1]:${port}`, '::1')
      assert.equal(j.status, 200)
    } finally {
      await server.stop()
    }
  })

  it('client de rechargement : l\'adresse suit l\'hôte de la requête (téléphone sur le réseau local)', async function () {
    this.timeout(15000)
    const { createDevHostCheck } = await import('../src/server/hmr.js')
    const verif = createDevHostCheck('0.0.0.0', ['192.168.1.20'])
    assert.equal(verif('192.168.1.20:3939'), true)
    assert.equal(verif('attaquant.example:3939'), false)
    assert.equal(verif(undefined), false)
    const local = createDevHostCheck('127.0.0.1')
    assert.equal(local('192.168.1.20:3939'), false)
    assert.equal(local('localhost:3939'), true)
  })

  it('WebSocket : une page du réseau local est acceptée seulement si le serveur écoute sur le réseau local', async function () {
    const { isAcceptedHmrOrigin } = await import('../src/server/hmr.js')
    assert.equal(isAcceptedHmrOrigin('http://192.168.1.20:3939', '192.168.1.20:3939', '0.0.0.0'), true)
    assert.equal(isAcceptedHmrOrigin('http://192.168.1.20:3939', '192.168.1.20:3939', '127.0.0.1'), false)
    assert.equal(isAcceptedHmrOrigin('http://attaquant.example:3939', '192.168.1.20:3939', '0.0.0.0'), false)
    assert.equal(isAcceptedHmrOrigin('http://localhost:5173', 'localhost:3939', '127.0.0.1'), true)
  })
})
