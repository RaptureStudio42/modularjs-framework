// `mjs dev` sans bloc `render` sert la racine du projet. Une liste d'extensions PERMISES y refusait
// des fichiers que le navigateur charge : modules `.mjs` (pdf.js n'est livré qu'ainsi), sous-titres
// `.vtt`, données `.csv`/`.md`, modèles 3D `.glb`/`.gltf`, sons `.m4a`/`.aac`/`.flac`/`.opus`,
// vidéos `.mov`/`.m4v`/`.ogv` : 404 au lieu de 200. La garde refuse désormais les SECRETS (sources,
// configuration, clés, journaux, bases) et sert le reste.
// Sur un disque insensible à la casse (macOS, Windows), `/Config/default.json` ou `/Mjs.config.json`
// atteignaient le vrai fichier : les noms se comparent sans la casse, sans les points et espaces de
// fin que Windows ignore, et le chemin réel du fichier passe la même garde.

import assert from 'node:assert/strict'
import { request } from 'node:http'
import { mkdirSync, writeFileSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import * as serveur from '../src/server/index.js'

const { StaticServer } = serveur
const isBrowserResource = (segments: string[]): boolean => serveur.isBrowserResource(segments)

function get(port: number, path: string): Promise<{ status: number, body: string, type: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET', headers: { host: `127.0.0.1:${port}` } }, (res) => {
      let body = ''
      res.setEncoding('utf-8')
      res.on('data', (c) => { body += c })
      res.on('end', () => resolve({ status: res.statusCode!, body, type: String(res.headers['content-type'] ?? '') }))
    })
    req.on('error', reject)
    req.end()
  })
}

const SERVIS = ['/public/vendor/lib.mjs', '/public/sous-titres.vtt', '/docs/guide.md', '/public/donnees.csv', '/public/modele.glb', '/public/modele.gltf', '/public/son.m4a', '/public/son.aac', '/public/son.flac', '/public/son.opus', '/public/video.mov', '/public/video.m4v', '/public/video.ogv']
const SECRETS = ['/config/master.key', '/config/default.json', '/serve.server.mjs', '/mjs.config.json', '/app/page.mjs', '/server/base.mjs', '/lib/modele.rb', '/Gemfile', '/database.yml', '/cle.pem', '/log/development.log', '/db/dev.sqlite3', '/index.php.bak', '/public/alias.json']

describe('mjs dev — racine du projet : ce que le navigateur charge sort, les secrets jamais', () => {
  let server: InstanceType<typeof StaticServer>, port: number

  before(async function () {
    this.timeout(15000)
    const root = mjsTmp('dev-racine-navigateur')
    for (const d of ['config', 'log', 'db', 'public/vendor', 'docs', 'app', 'server', 'lib', 'out']) mkdirSync(join(root, d), { recursive: true })
    writeFileSync(join(root, 'index.html'), '<!doctype html><html><body>Accueil</body></html>')
    for (const p of SERVIS) writeFileSync(join(root, p), 'contenu-public')
    for (const p of SECRETS.filter(s => s !== '/public/alias.json')) writeFileSync(join(root, p), 'SECRET')
    // lien posé DANS la racine vers un dossier privé : le chemin demandé est anodin, le chemin réel ne l'est pas
    symlinkSync(join(root, 'config', 'default.json'), join(root, 'public', 'alias.json'))
    server = new StaticServer({ rootDir: join(root, 'out'), pathPrefix: '/modularjs', port: 0, host: '127.0.0.1', projectRoot: root })
    await server.start()
    port = (server.server!.address() as any).port
  })

  after(async () => { await server.stop() })

  it('modules, sous-titres, données, modèles 3D, sons et vidéos : 200', async () => {
    for (const p of SERVIS) {
      const r = await get(port, p)
      assert.equal(r.status, 200, p)
      assert.equal(r.body, 'contenu-public', p)
    }
  })

  it('types annoncés : `.mjs` en JavaScript, `.vtt` en text/vtt (exigé par `<track>`)', async () => {
    assert.match((await get(port, '/public/vendor/lib.mjs')).type, /^application\/javascript/)
    assert.match((await get(port, '/public/sous-titres.vtt')).type, /^text\/vtt/)
  })

  it('clés, configuration, sources serveur, journaux, bases, sauvegardes, lien vers config/ : 404', async () => {
    for (const p of SECRETS) {
      const r = await get(port, p)
      assert.equal(r.status, 404, p)
      assert.doesNotMatch(r.body, /SECRET/, p)
    }
  })
})

describe('garde de la racine du projet — noms comparés comme les voit le système de fichiers', () => {
  const seg = (p: string): string[] => p.split('/').filter(Boolean)

  it('casse ignorée : dossiers et fichiers privés refusés quelle que soit leur écriture', () => {
    for (const p of ['/Config/default.json', '/CONFIG/database.js', '/Storage/x.json', '/Log/a.json', '/Node_Modules/x/index.js', '/Mjs.config.json', '/MJS.CONFIG.JSON', '/Package.JSON', '/TSConfig.json', '/Serve.Server.MJS', '/App/page.mjs', '/Cle.PEM']) {
      assert.equal(isBrowserResource(seg(p)), false, p)
    }
  })

  it('points et espaces de fin (ignorés par Windows), flux NTFS, noms courts 8.3, antislash : refusés', () => {
    for (const p of ['/config./default.json', '/config /default.json', '/mjs.config.json.', '/mjs.config.json ', '/master.key.', '/mjs.config.json::$DATA', '/MJSCON~1.JSO', '/config\\routes.js', '/notes.txt~']) {
      assert.equal(isBrowserResource(seg(p)), false, JSON.stringify(p))
    }
  })

  it('toute extension annoncée par la table des types est servie (hors dossier privé)', () => {
    for (const ext of Object.keys(serveur.MIME_TYPES)) {
      assert.equal(isBrowserResource(['public', 'fichier' + ext]), true, ext)
    }
    assert.equal(isBrowserResource(['index.html']), true)
  })
})
