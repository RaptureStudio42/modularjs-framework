// le repli render.routes existant (server/index.ts:483-495, render-server.ts:322-355)
// couvrait TOUT chemin manquant sous pathPrefix, extension ou pas — un asset RÉELLEMENT jamais
// produit ('/modularjs/inexistant.js', <script src> cassé) recevait 200 text/html (le shell CSR,
// cf. render-request.ts:230-232 « URL non déclarée → le back sert le shell », hors périmètre : la
// distinction se pose AVANT d'appeler ce handler, pas dedans). Fix, sur les DEUX serveurs : un
// chemin dont le dernier segment porte une extension et qui n'existe pas → 404 direct ; sans
// extension (page probable), ou requête X-MJS-Nav (fiche JSON de nav) → repli rendu inchangé.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { etape } from './helpers/attendre.js'
import { StaticServer } from '../src/server/index.js'
import { createRenderHandler } from '../src/server/render-request.js'
import { createServeEntry } from '../src/server/serve-entry.js'
import { startRenderServer } from '../src/server/render-server.js'
import { terminateSharedWorkerPool, MARQUE_SORTIE } from '../src/bundler/index.js'

after(async () => { await terminateSharedWorkerPool() })

function setup() {
  const root   = mjsTmp('prefix-asset-404')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(srcDir, 'home.mjs'), '<h1>Accueil</h1>')
  // manifeste d'une construction précédente, avec la marque des sorties : le rendu le remplace en recompilant (un fichier que ModularJS n'a pas produit ne l'est jamais)
  writeFileSync(join(outDir, 'manifest.js'), `${MARQUE_SORTIE}\nµ.paths = {};\nµ.version = "abcd1234";\n`)
  const config: any = {
    sourceDir: 'src', outputDir: 'out', manifestPath: 'out/manifest.js',
    render: {
      default: 'ssr',
      routes: {
        '/':              { component: 'mjs-home', mode: 'ssr' },
        // route déclarée dont l'URL vit SOUS le pathPrefix par défaut ('/modularjs')
        '/modularjs/faq': { component: 'mjs-home', mode: 'ssr' },
      },
    },
  }
  return { root, outDir, config }
}

describe('assets sous pathPrefix : extension + fichier absent → 404, jamais le shell', function () {
  // une réponse ne prend que quelques millisecondes une fois les moteurs de rendu créés ; sous charge, un rendu peut
  // dépasser les 2 s par défaut de mocha sans que rien ne soit en défaut
  this.timeout(30000)
  let root: string, outDir: string, config: any
  let dev: StaticServer
  let devPort: number
  let serve: Awaited<ReturnType<typeof startRenderServer>>
  let renderHandler: Awaited<ReturnType<typeof createRenderHandler>>
  let entry: Awaited<ReturnType<typeof createServeEntry>>

  // borné par ses étapes, chacune attendue pour de vrai et nommée dans l'erreur si elle n'aboutit pas, jamais par un
  // chiffre global (20 s ne suffisaient pas toujours sous charge)
  before(async function () {
    this.timeout(0)
    ;({ root, outDir, config } = setup())
    renderHandler = await etape('création du rendu à la demande', createRenderHandler(config, root))
    entry = await etape('création de l\'entrée de mjs serve', createServeEntry(config, root))
    dev = new StaticServer({
      rootDir: outDir, port: 0, host: '127.0.0.1',
      config, configDir: root, manifestPath: join(outDir, 'manifest.js'),
      renderHandle: renderHandler.handle, entry,
    })
    await etape('démarrage de mjs dev', dev.start())
    devPort = (dev.server!.address() as any).port
    serve = await etape('démarrage de mjs serve', startRenderServer(config, root, { port: 0 }))
    // chaque serveur crée son moteur de rendu à sa première requête (compilation du projet, plusieurs secondes sous
    // charge) : amorcé ici sur la route racine, hors des URL vérifiées, chaque test ne mesure plus que sa réponse
    for (const [nom, port] of [['mjs dev', devPort], ['mjs serve', serve.port]] as const) {
      const res = await etape(`premier rendu de ${nom}`, fetch(`http://127.0.0.1:${port}/`))
      assert.equal(res.status, 200, `${nom} : la route racine doit se rendre`)
    }
  })

  after(async () => {
    await dev.stop()
    entry.close()
    await renderHandler.close()
    await serve.close()
  })

  it('mjs dev — /modularjs/inexistant.js (asset jamais produit) → 404, jamais 200 text/html', async () => {
    const res = await fetch(`http://127.0.0.1:${devPort}/modularjs/inexistant.js`)
    assert.equal(res.status, 404)
  })

  it('mjs serve — /modularjs/inexistant.js (asset jamais produit) → 404, jamais 200 text/html', async () => {
    const res = await fetch(`http://127.0.0.1:${serve.port}/modularjs/inexistant.js`)
    assert.equal(res.status, 404)
  })

  it('mjs dev — /modularjs/faq (route déclarée, pas de fichier) → 200 (non-régression)', async () => {
    const res = await fetch(`http://127.0.0.1:${devPort}/modularjs/faq`)
    assert.equal(res.status, 200)
  })

  it('mjs serve — /modularjs/faq (route déclarée, pas de fichier) → 200 (non-régression)', async () => {
    const res = await fetch(`http://127.0.0.1:${serve.port}/modularjs/faq`)
    assert.equal(res.status, 200)
  })

  it('mjs dev — /modularjs/inexistant.js AVEC X-MJS-Nav → repli rendu quand même (fiche JSON 404, module null : route non déclarée)', async () => {
    const res = await fetch(`http://127.0.0.1:${devPort}/modularjs/inexistant.js`, { headers: { 'X-MJS-Nav': '1' } })
    assert.equal(res.status, 404)
    assert.match(res.headers.get('content-type') || '', /json/)
    const body = await res.json() as any
    assert.equal(body.module, null)
  })

  it('mjs serve — /modularjs/inexistant.js AVEC X-MJS-Nav → repli rendu quand même (fiche JSON 404, module null)', async () => {
    const res = await fetch(`http://127.0.0.1:${serve.port}/modularjs/inexistant.js`, { headers: { 'X-MJS-Nav': '1' } })
    assert.equal(res.status, 404)
    assert.match(res.headers.get('content-type') || '', /json/)
    const body = await res.json() as any
    assert.equal(body.module, null)
  })

  it("mjs dev — /modularjs/faq.html (extension, pas de fichier, route non déclarée telle quelle) → 404 (décision : une extension reste un chemin d'asset)", async () => {
    const res = await fetch(`http://127.0.0.1:${devPort}/modularjs/faq.html`)
    assert.equal(res.status, 404)
  })

  it('mjs serve — /modularjs/faq.html → 404, même décision', async () => {
    const res = await fetch(`http://127.0.0.1:${serve.port}/modularjs/faq.html`)
    assert.equal(res.status, 404)
  })
})
