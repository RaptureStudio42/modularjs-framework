// `mjs dev` sans bloc `render` sert la racine du projet. Y sortaient encore tout `.json` posé à la racine même (`secrets.json`,
// `credentials.json`) et les entrées serveur dont le nom ne porte pas `.server.` : `ws.js` et `serveur.js` (cherchées par `mjs ws`
// et `mjs serveur`), le `server.mjs` d'une appli Node, et une entrée déclarée dans la configuration (`ws.entry`, `serveur.entry`,
// `render.entry`) sous un autre nom. Refusés comme les autres secrets (404), par le chemin demandé comme par le chemin réel.
// Reste servi ce que la page charge : la page, un script client à la racine, feuilles, médias, JSON rangé dans un dossier, sorties
// du build (traductions comprises).

import assert from 'node:assert/strict'
import { request } from 'node:http'
import { mkdirSync, writeFileSync, symlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { StaticServer, isBrowserResource } from '../src/server/index.js'

function get(port: number, path: string): Promise<{ status: number, body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET', headers: { host: `127.0.0.1:${port}` } }, (res) => {
      let body = ''
      res.setEncoding('utf-8')
      res.on('data', (c) => { body += c })
      res.on('end', () => resolve({ status: res.statusCode!, body }))
    })
    req.on('error', reject)
    req.end()
  })
}

// entrées déclarées sous un autre nom : rangées dans un dossier quelconque, ou à la racine
const CONFIG  = { ws: { entry: 'lib/temps-reel.mjs' }, serveur: { entry: './partie.js' }, render: { entry: 'outils/pages.mjs' } } as any
const REFUSES = ['/secrets.json', '/credentials.json', '/package.json', '/mjs.config.json', '/server.mjs', '/server.js', '/ws.js', '/serveur.js', '/lib/temps-reel.mjs', '/partie.js', '/outils/pages.mjs']
const SERVIS  = ['/app.js', '/public/styles/base.css', '/public/favicon.png', '/public/donnees/villes.json', '/public/ws.js', '/lib/carte.mjs', '/dist/assets/i18n/fr/accueil.json']

describe('mjs dev — racine du projet : ni JSON à la racine même, ni entrée serveur', () => {
  let server: InstanceType<typeof StaticServer>, port: number

  before(async function () {
    this.timeout(15000)
    const root   = mjsTmp('dev-racine-entrees')
    const ecrire = (p: string, texte: string): void => {
      mkdirSync(dirname(join(root, p)), { recursive: true })
      writeFileSync(join(root, p), texte)
    }
    ecrire('index.html', '<!doctype html><html><body>Accueil</body></html>')
    for (const p of REFUSES) ecrire(p, 'SECRET')
    for (const p of SERVIS) ecrire(p, 'contenu-public')
    ecrire('dist/assets/bundle.js', 'contenu-public')
    // liens posés dans la racine : le chemin demandé est anodin, le chemin réel ne l'est pas
    symlinkSync(join(root, 'lib', 'temps-reel.mjs'), join(root, 'public', 'lien-vers-entree.mjs'))
    symlinkSync(join(root, 'secrets.json'), join(root, 'public', 'lien-vers-secrets.json'))
    server = new StaticServer({ rootDir: join(root, 'dist', 'assets'), pathPrefix: '/assets', port: 0, host: '127.0.0.1', projectRoot: root, configDir: root, config: CONFIG })
    await server.start()
    port = (server.server!.address() as any).port
  })

  after(async () => { await server.stop() })

  it('JSON à la racine, configuration, entrées serveur par défaut ou déclarées, liens vers elles : 404', async () => {
    const sortis: string[] = []
    for (const p of [...REFUSES, '/public/lien-vers-entree.mjs', '/public/lien-vers-secrets.json']) {
      const r = await get(port, p)
      if (r.status !== 404 || /SECRET/.test(r.body)) sortis.push(`${p} → ${r.status}`)
    }
    assert.deepEqual(sortis, [])
  })

  it('la page, un script client à la racine, feuilles, médias, JSON rangé dans un dossier, sorties du build : 200', async () => {
    const page = await get(port, '/')
    assert.equal(page.status, 200)
    assert.match(page.body, /Accueil/)
    const refuses: string[] = []
    for (const p of [...SERVIS, '/assets/bundle.js', '/assets/i18n/fr/accueil.json']) {
      const r = await get(port, p)
      if (r.status !== 200 || r.body !== 'contenu-public') refuses.push(`${p} → ${r.status}`)
    }
    assert.deepEqual(refuses, [])
  })
})

describe('garde de la racine du projet — JSON et entrées serveur posés à la racine même', () => {
  const seg = (p: string): string[] => p.split('/').filter(Boolean)

  it('à la racine : tout JSON et les entrées serveur refusés, quelle que soit leur écriture', () => {
    const noms = ['/secrets.json', '/Secrets.JSON', '/credentials.json.', '/manifest.json', '/ws.js', '/WS.JS', '/serveur.js', '/server.mjs', '/Server.MJS', '/server.js', '/ws.js ']
    assert.deepEqual(noms.filter(p => isBrowserResource(seg(p))), [])
  })

  it('dans un dossier, ou sous un autre nom : servis comme avant', () => {
    const noms = ['/index.html', '/app.js', '/main.mjs', '/sw.js', '/websocket.js', '/public/donnees.json', '/public/ws.js', '/i18n/fr/accueil.json']
    assert.deepEqual(noms.filter(p => !isBrowserResource(seg(p))), [])
  })
})
