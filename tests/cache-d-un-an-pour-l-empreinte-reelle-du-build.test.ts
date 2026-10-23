// `mjs serve` et `mjs dev` mettent en cache pour un an (immutable) les fichiers nommés par leur contenu. L'empreinte courte du
// build (5 caractères base 36) n'était reconnue que si elle contenait un chiffre : `mjs_core-hymif.js` repartait en `no-cache`
// (environ un fichier empreint sur cinq), et un nom d'auteur à chiffre qui lui ressemble (`photo-2024a.jpg`) passait pour
// immuable. L'empreinte courte est maintenant vérifiée sur le contenu même du fichier (sans la ligne `sourceMappingURL` que le
// build ajoute après l'avoir calculée) : cache d'un an exactement pour les fichiers du build, `no-cache` pour tout le reste. L'empreinte
// à 8 hexadécimaux (images, fichiers copiés) se vérifie de même : le début du md5 du contenu.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { startRenderServer } from '../src/server/render-server.js'
import { StaticServer } from '../src/server/index.js'
import { shortFingerprint } from '../src/bundler/fingerprint.js'
import { mjsTmp, sweepRegistered } from './helpers/tmp.js'

after(() => sweepRegistered())

// un contenu dont l'empreinte courte ne porte aucun chiffre, comme `hymif`
function contenuSansChiffre(): { contenu: string, court: string } {
  for (let i = 0; ; i++) {
    const contenu = `export const coeur = ${i}\n`
    const court   = shortFingerprint(contenu)
    if (/^[a-z]{5}$/.test(court)) return { contenu, court }
  }
}

function projet(): { root: string, outDir: string, noms: Record<string, string> } {
  const root   = mjsTmp('cache-empreinte')
  const outDir = join(root, 'out')
  mkdirSync(join(root, 'src'), { recursive: true })
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(root, 'src', 'home.mjs'), '<h1>Salut</h1>')
  writeFileSync(join(outDir, 'manifest.js'), "const µCore = '/mjs_core-test1234.js';\nµ.paths = {};\n")
  const { contenu, court } = contenuSansChiffre()
  const app     = 'export const app = 1\n'
  const appNom  = `app-${shortFingerprint(app)}.js`
  const noms    = { coeur: `mjs_core-${court}.js`, carte: appNom, image: `logo-${createHash('md5').update('png').digest('hex').slice(0, 8)}.png`, auteur: 'main-style.css', photo: 'photo-2024a.jpg' }
  writeFileSync(join(outDir, noms.coeur), contenu)
  writeFileSync(join(outDir, appNom), `${app}\n//# sourceMappingURL=${appNom}.map\n`)
  writeFileSync(join(outDir, appNom + '.map'), '{}')
  writeFileSync(join(outDir, noms.image), 'png')
  writeFileSync(join(outDir, noms.auteur), 'body{}')
  writeFileSync(join(outDir, noms.photo), 'jpg')
  return { root, outDir, noms }
}

async function caches(base: string, noms: Record<string, string>): Promise<Record<string, string | null>> {
  const vus: Record<string, string | null> = {}
  for (const [cle, nom] of Object.entries({ ...noms, carteMap: noms.carte + '.map' })) vus[cle] = (await fetch(base + nom)).headers.get('cache-control')
  return vus
}

const ATTENDU = { coeur: 'public, max-age=31536000, immutable', carte: 'public, max-age=31536000, immutable', image: 'public, max-age=31536000, immutable', auteur: 'no-cache', photo: 'no-cache', carteMap: 'no-cache' }

describe('cache d\'un an : l\'empreinte réelle du build, rien d\'autre', function () {
  this.timeout(20000)

  it('mjs serve', async () => {
    const { root, noms } = projet()
    const config: any = { sourceDir: 'src', outputDir: 'out', manifestPath: 'out/manifest.js', render: { routes: { '/': { component: 'mjs-home', mode: 'csr' } } } }
    const running = await startRenderServer(config, root, { port: 0 })
    try { assert.deepEqual(await caches(`http://127.0.0.1:${running.port}/`, noms), ATTENDU) }
    finally { await running.close() }
  })

  it('mjs dev', async () => {
    const { outDir, noms } = projet()
    const server = new StaticServer({ rootDir: outDir, pathPrefix: '/modularjs', port: 0, host: '127.0.0.1' })
    await server.start()
    try { assert.deepEqual(await caches(`http://127.0.0.1:${(server.server!.address() as any).port}/modularjs/`, noms), ATTENDU) }
    finally { await server.stop() }
  })
})
