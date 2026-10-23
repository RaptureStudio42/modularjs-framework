// `mjs dev` répond à `app.localhost` (tout sous-domaine de `localhost`, toujours en boucle locale) et au nom de la machine, mais
// l'origine d'une page servie sous ces noms n'était pas admise : le rechargement à chaud se fermait aussitôt (`1008 Origin not
// allowed`), et le formulaire d'une page passée par un proxy local qui réécrit Host répondait 403. Une origine de la boucle locale
// (localhost et ses sous-domaines, 127.0.0.1, [::1], sur tout port) est locale ; le nom de la machine, `<nom>.local` et les adresses du
// réseau n'en sont pas — dans Host, ils prouvent que la requête arrive ici, dans une origine pas que la page vient d'ici : une page
// servie sous ces noms est admise de même origine (Host identique). Le rechargement et les formulaires lisent la même garde

import assert from 'node:assert/strict'
import { request } from 'node:http'
import os, { hostname } from 'node:os'
import { syncBuiltinESMExports } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import WebSocket from 'ws'
import * as hmr from '../src/server/hmr.js'
import { StaticServer } from '../src/server/index.js'
import { startRenderServer } from '../src/server/render-server.js'
import { createServeEntry } from '../src/server/serve-entry.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

after(async () => { await terminateSharedWorkerPool() })

const MACHINE = hostname().toLowerCase()
const COURT   = MACHINE.split('.')[0]
// une machine nommée `localhost` (certains conteneurs) a un nom de la boucle locale : rien à montrer sur ses noms
const MACHINE_EN_BOUCLE = MACHINE === 'localhost' || MACHINE.endsWith('.localhost')

const FIXTURE = `export default {
  actions: {
    '/p/:id': (params, body, req) -> { redirect: "/p/#{params.id}" }
  }
}
`

// projet minimal avec une action `.server.mjs` (même fixture que les tests du pipeline d'actions)
function projet() {
  const root = mjsTmp('origine-locale')
  mkdirSync(join(root, 'src'), { recursive: true })
  mkdirSync(join(root, 'out'), { recursive: true })
  writeFileSync(join(root, 'src', 'home.mjs'), '<h1>Salut</h1>')
  writeFileSync(join(root, 'out', 'manifest.js'), 'µ.paths = {};\nµ.version = "abcd1234";\n')
  writeFileSync(join(root, 'serve.server.mjs'), FIXTURE)
  const config: any = { sourceDir: 'src', outputDir: 'out', manifestPath: 'out/manifest.js', render: { routes: { '/p/:id': { component: 'mjs-page', mode: 'csr' as const } } } }
  return { root, config }
}

// `mjs dev` câblé comme cli.ts : rechargement à chaud actif, entrée serveur branchée ; `host` : l'écoute (`dev.host`)
async function dev(host = '127.0.0.1') {
  const { root, config } = projet()
  const entry  = await createServeEntry(config, root)
  const server = new StaticServer({ rootDir: join(root, 'out'), port: 0, host, hmr: true, config, configDir: root, manifestPath: join(root, 'out', 'manifest.js'), entry: entry ?? undefined })
  await server.start()
  const port = (server.server!.address() as any).port
  return { port, close: async () => { await server.stop(); entry?.close() } }
}

function connecter(port: number, host: string, origin: string): Promise<string> {
  return new Promise((ok) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/__mjs_hmr`, { headers: { host, origin } })
    ws.on('message', (m) => { ok(String(m)); ws.close() })
    ws.on('close', (code, raison) => ok(`fermé ${code} ${String(raison)}`))
    ws.on('error', (e) => ok('erreur ' + e.message))
  })
}

function envoyer(port: number, host: string, origin: string): Promise<{ status: number, body: string }> {
  return new Promise((ok, ko) => {
    const r = request({ host: '127.0.0.1', port, path: '/p/42', method: 'POST', headers: { host, origin, 'content-type': 'application/x-www-form-urlencoded' } }, (x) => {
      let body = ''
      x.setEncoding('utf-8')
      x.on('data', (c) => { body += c })
      x.on('end', () => ok({ status: x.statusCode!, body }))
    })
    r.on('error', ko)
    r.end('name=ok')
  })
}

describe('mjs dev — l\'origine d\'une page de la boucle locale est locale, celle du nom de la machine de même origine seulement', () => {
  it('app.localhost, tout sous-domaine de localhost, 127.0.0.1, [::1] : origine locale sur tout port, Host gardé ou réécrit', () => {
    assert.equal(hmr.isAcceptedHmrOrigin('http://app.localhost:3939', 'app.localhost:3939', '127.0.0.1'), true)
    assert.equal(hmr.isAcceptedHmrOrigin('http://a.b.localhost:5173', 'localhost:3939', '127.0.0.1'), true)
    assert.equal(hmr.isAcceptedHmrOrigin('https://app.localhost', 'localhost:3939', '127.0.0.1'), true)
    assert.equal(hmr.isAcceptedHmrOrigin('http://localhost:5173', 'localhost:3939', '127.0.0.1'), true)
    assert.equal(hmr.isAcceptedHmrOrigin('http://127.0.0.1:8080', 'localhost:3939', '127.0.0.1'), true)
    assert.equal(hmr.isAcceptedHmrOrigin('http://[::1]:5173', 'localhost:3939', '127.0.0.1'), true)
  })

  it('le nom de la machine, <nom>.local, une adresse du réseau : admis de même origine (Host identique), jamais comme origine locale', function () {
    if (MACHINE_EN_BOUCLE) this.skip()
    assert.equal(hmr.isAcceptedHmrOrigin(`http://${MACHINE}:3939`, `${MACHINE}:3939`, '127.0.0.1'), true)
    assert.equal(hmr.isAcceptedHmrOrigin(`http://${COURT}.local:3939`, `${COURT}.local:3939`, '127.0.0.1'), true)
    assert.equal(hmr.isAcceptedHmrOrigin(`http://${MACHINE}:5173`, 'localhost:3939', '127.0.0.1'), false)
    assert.equal(hmr.isAcceptedHmrOrigin(`http://${COURT}.local:3939`, 'localhost:3939', '127.0.0.1'), false)
    assert.equal(hmr.isAcceptedHmrOrigin('http://192.168.1.20:8080', 'localhost:3939', '0.0.0.0'), false)
    assert.equal(hmr.isAcceptedHmrOrigin('http://192.168.1.20:8080', '192.168.1.20:3939', '0.0.0.0'), false)
  })

  it('une origine étrangère reste refusée, même proche d\'un nom de la machine', () => {
    assert.equal(hmr.isAcceptedHmrOrigin('http://evil.example', 'app.localhost:3939', '127.0.0.1'), false)
    assert.equal(hmr.isAcceptedHmrOrigin('http://localhost.evil.example', 'localhost:3939', '127.0.0.1'), false)
    assert.equal(hmr.isAcceptedHmrOrigin('http://app.localhost.evil.example', 'localhost:3939', '127.0.0.1'), false)
    assert.equal(hmr.isAcceptedHmrOrigin('http://evillocalhost', 'localhost:3939', '127.0.0.1'), false)
    assert.equal(hmr.isAcceptedHmrOrigin(`http://${MACHINE}.evil.example`, 'localhost:3939', '127.0.0.1'), false)
    assert.equal(hmr.isAcceptedHmrOrigin('ftp://app.localhost', 'localhost:3939', '127.0.0.1'), false)
    assert.equal(hmr.isAcceptedHmrOrigin('null', 'localhost:3939', '127.0.0.1'), false)
    assert.equal(hmr.isAcceptedHmrOrigin('http://192.168.1.20:3939', '192.168.1.20:3939', '127.0.0.1'), false)
  })

  it('formulaires : la garde d\'origine de mjs dev tient pour locales les origines de la boucle locale, le nom de la machine de même origine seulement', function () {
    if (MACHINE_EN_BOUCLE) this.skip()
    const garde = hmr.createDevOriginCheck(undefined, '127.0.0.1')
    assert.equal(garde('http://app.localhost', 'localhost:3939'), true)
    assert.equal(garde('http://localhost:5173', 'localhost:3939'), true)
    assert.equal(garde(`http://${MACHINE}:3939`, `${MACHINE}:3939`), true)
    assert.equal(garde(`http://${MACHINE}:5173`, 'localhost:3939'), false)
    assert.equal(garde(`http://${COURT}.local:5173`, 'localhost:3939'), false)
    assert.equal(garde('http://evil.example', 'localhost:3939'), false)
    assert.equal(garde('http://localhost.evil.example', 'localhost:3939'), false)
  })

  it('mjs dev sous http://app.localhost : rechargement connecté, formulaire 303 ; une page étrangère refusée', async function () {
    this.timeout(20000)
    const srv = await dev()
    try {
      const host = 'app.localhost:' + srv.port
      assert.equal(await connecter(srv.port, host, 'http://' + host), '{"type":"connected"}')
      assert.equal((await envoyer(srv.port, host, 'http://' + host)).status, 303)
      assert.equal(await connecter(srv.port, host, 'http://evil.example'), 'fermé 1008 Origin not allowed')
      assert.deepEqual(await envoyer(srv.port, host, 'http://evil.example'), { status: 403, body: 'Forbidden' })
    } finally {
      await srv.close()
    }
  })

  it('mjs dev derrière un proxy local sous app.localhost qui réécrit Host : rechargement connecté, formulaire 303 ; une page sous le nom de la machine, refusée', async function () {
    this.timeout(20000)
    const srv = await dev()
    try {
      assert.equal(await connecter(srv.port, 'localhost:' + srv.port, 'http://app.localhost'), '{"type":"connected"}')
      assert.equal((await envoyer(srv.port, 'localhost:' + srv.port, 'http://app.localhost')).status, 303)
      if (!MACHINE_EN_BOUCLE) {
        assert.equal(await connecter(srv.port, 'localhost:' + srv.port, `http://${MACHINE}:5173`), 'fermé 1008 Origin not allowed')
        assert.deepEqual(await envoyer(srv.port, 'localhost:' + srv.port, `http://${MACHINE}:5173`), { status: 403, body: 'Forbidden' })
      }
    } finally {
      await srv.close()
    }
  })

  it('mjs dev sous le nom de la machine : la page de même origine est admise, au rechargement comme au formulaire', async function () {
    this.timeout(20000)
    const srv = await dev()
    try {
      const host = MACHINE + ':' + srv.port
      assert.equal(await connecter(srv.port, host, 'http://' + host), '{"type":"connected"}')
      assert.equal((await envoyer(srv.port, host, 'http://' + host)).status, 303)
    } finally {
      await srv.close()
    }
  })

  it('après un changement de réseau, le rechargement et les formulaires rendent le même verdict : une adresse du réseau n\'est pas une origine locale', async function () {
    this.timeout(20000)
    const srv     = await dev('0.0.0.0')
    const vraies  = os.networkInterfaces
    const adresse = { address: '10.99.0.7', netmask: '255.0.0.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: false, cidr: '10.99.0.7/8' }
    try {
      // une interface apparue après le démarrage (wifi rejoint, VPN), vue par toute lecture de node:os
      Object.assign(os, { networkInterfaces: () => ({ ...vraies(), essai: [adresse] }) })
      syncBuiltinESMExports()
      const host = 'localhost:' + srv.port
      assert.equal(await connecter(srv.port, host, 'http://10.99.0.7:8080'), 'fermé 1008 Origin not allowed')
      assert.deepEqual(await envoyer(srv.port, host, 'http://10.99.0.7:8080'), { status: 403, body: 'Forbidden' })
    } finally {
      Object.assign(os, { networkInterfaces: vraies })
      syncBuiltinESMExports()
      await srv.close()
    }
  })

  it('mjs serve : inchangé, la garde d\'origine des formulaires reste le same-origin', async function () {
    this.timeout(20000)
    const { root, config } = projet()
    const running = await startRenderServer(config, root, { port: 0 })
    try {
      assert.deepEqual(await envoyer(running.port, 'localhost:' + running.port, 'http://app.localhost'), { status: 403, body: 'Forbidden' })
    } finally {
      await running.close()
    }
  })
})
