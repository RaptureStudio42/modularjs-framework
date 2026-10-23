// `mjs serve` servait les fichiers du build sans aucun en-tête de cache : le navigateur retéléchargeait
// à chaque navigation des fichiers pourtant nommés par leur contenu (le cœur pèse plus d'un Mo).
// Un nom qui porte l'empreinte du build (`<base>-<5 caractères base 36>.<ext>`, cf.
// bundler/fingerprint.ts, ou `<base>-<8 hexadécimaux>.<ext>`, début du md5 du contenu — l'une et l'autre vérifiées sur le contenu) ne
// change jamais de contenu : cache d'un an, immuable. Tout autre fichier : `no-cache` (revalidé à chaque fois). Même règle que `mjs dev`.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { mjsTmp } from './helpers/tmp.js'
import { startRenderServer } from '../src/server/render-server.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

describe('mjs serve — en-tête de cache des fichiers du build', function () {
  after(async () => { await terminateSharedWorkerPool() })

  it('nom empreint : cache d\'un an immuable ; nom ordinaire : no-cache', async function () {
    this.timeout(60000)
    const root = mjsTmp('serve-cache')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'page.mjs'), '<p class="ok">page rendue</p>\n')
    const config: any = { sourceDir: 'src', outputDir: 'out', render: { routes: { '/page': { component: 'mjs-page', mode: 'csr' } } } }
    const serveur = await startRenderServer(config, root, { port: 0, host: '127.0.0.1', env: 'prod' })
    try {
      // une sortie à 8 hexadécimaux porte le début du md5 de son contenu
      const feuille = 'feuille-' + createHash('md5').update('.feuille{}').digest('hex').slice(0, 8) + '.css'
      const fichiers: Record<string, string> = {
        'mjs_core-41jbg.js': 'public, max-age=31536000, immutable',
        [feuille]: 'public, max-age=31536000, immutable',
        'main-style.css': 'no-cache',
        'donnees.json': 'no-cache',
        'mjs_core-41jbg.js.map': 'no-cache',
      }
      mkdirSync(join(root, 'out'), { recursive: true })
      // le cœur et la feuille portent la vraie empreinte de leur contenu : seule celle-là vaut un cache d'un an
      for (const nom of Object.keys(fichiers)) writeFileSync(join(root, 'out', nom), nom === 'mjs_core-41jbg.js' ? '/* cœur */' : nom === feuille ? '.feuille{}' : '/* ' + nom + ' */')
      for (const [nom, attendu] of Object.entries(fichiers)) {
        const res = await fetch(`http://127.0.0.1:${serveur.port}/${nom}`)
        assert.equal(res.status, 200, nom)
        assert.equal(res.headers.get('cache-control'), attendu, nom)
        await res.text()
      }
    } finally {
      await serveur.close()
    }
  })
})
