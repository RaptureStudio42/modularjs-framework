// `mjs dev` sert les sorties du build sous `urlPrefix` depuis `outputDir`. Quand `outputDir` est la racine du projet elle-même
// (`"outputDir": "."`), ce dossier porte aussi les secrets de l'appli : `secrets.json`, `ws.js`, `.env`, `config/`… sortaient alors
// par `/modularjs/…` (ou par n'importe quel chemin avec un `urlPrefix` vide) sans la garde que la racine du projet applique ailleurs.
// Même garde ici ; un dossier de sortie dédié (`public/modularjs`, `app/assets/builds`) reste servi comme avant, JSON compris.

import assert from 'node:assert/strict'
import { request } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { StaticServer } from '../src/server/index.js'

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

const SECRETS  = ['secrets.json', 'ws.js', 'server.mjs', '.env', 'config/database.yml', 'package.json', 'Gemfile', 'server/index.js', 'lib/temps-reel.mjs']
const SORTIES  = ['mjs_core-hymif.js', 'accueil-4f2a1.css', 'i18n/fr/accueil.json', 'public/logo.png']
const CONFIG   = { ws: { entry: 'lib/temps-reel.mjs' } } as any

function projet(nom: string): string {
  const root   = mjsTmp(nom)
  const ecrire = (p: string, texte: string): void => {
    mkdirSync(dirname(join(root, p)), { recursive: true })
    writeFileSync(join(root, p), texte)
  }
  for (const p of SECRETS) ecrire(p, 'SECRET')
  for (const p of SORTIES) ecrire(p, 'sortie')
  for (const d of ['public/modularjs', 'app/assets/builds']) {
    ecrire(`${d}/manifest.json`, 'sortie')
    ecrire(`${d}/mjs_core-hymif.js`, 'sortie')
  }
  return root
}

async function servir(rootDir: string, pathPrefix: string, root: string, chemins: string[]): Promise<string[]> {
  const server = new StaticServer({ rootDir, pathPrefix, port: 0, host: '127.0.0.1', projectRoot: root, configDir: root, config: CONFIG })
  await server.start()
  const port = (server.server!.address() as any).port
  const vus: string[] = []
  try {
    for (const p of chemins) {
      const r = await get(port, p)
      vus.push(`${p} → ${r.status}${/SECRET/.test(r.body) ? ' SECRET' : ''}`)
    }
  }
  finally { await server.stop() }
  return vus
}

describe('mjs dev — sorties du build servies depuis la racine du projet', function () {
  this.timeout(15000)

  it('outputDir "." et urlPrefix /modularjs : secrets refusés (404), sorties servies', async () => {
    const root = projet('dev-sorties-racine-prefixe')
    const vus  = await servir(root, '/modularjs', root, [...SECRETS, ...SORTIES].map(p => '/modularjs/' + p))
    assert.deepEqual(vus, [...SECRETS.map(p => `/modularjs/${p} → 404`), ...SORTIES.map(p => `/modularjs/${p} → 200`)])
  })

  it('outputDir "." et urlPrefix vide : secrets refusés (404), sorties servies', async () => {
    const root = projet('dev-sorties-racine-sans-prefixe')
    const vus  = await servir(root, '', root, [...SECRETS, ...SORTIES].map(p => '/' + p))
    assert.deepEqual(vus, [...SECRETS.map(p => `/${p} → 404`), ...SORTIES.map(p => `/${p} → 200`)])
  })

  it('dossier de sortie dédié : servi comme avant, JSON à sa racine compris', async () => {
    const root = projet('dev-sorties-dossier-dedie')
    const vus  = [
      ...await servir(join(root, 'public/modularjs'), '/modularjs', root, ['/modularjs/manifest.json', '/modularjs/mjs_core-hymif.js']),
      ...await servir(join(root, 'app/assets/builds'), '/assets', root, ['/assets/manifest.json', '/assets/mjs_core-hymif.js']),
    ]
    assert.deepEqual(vus, ['/modularjs/manifest.json → 200', '/modularjs/mjs_core-hymif.js → 200', '/assets/manifest.json → 200', '/assets/mjs_core-hymif.js → 200'])
  })
})
