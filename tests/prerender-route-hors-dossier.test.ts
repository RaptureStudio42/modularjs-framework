// Le prérendu écrit chaque page sous `render.outDir`, à un chemin tiré de la clé de route
// (`/blog` → `blog.html`). Une clé avec un segment `..` (`/../../x`) faisait écrire le fragment HORS
// de ce dossier — et, sur un échec de rendu, supprimer un fichier de même nom hors du dossier. Une
// telle clé (segment `..`, barre inverse, chemin absolu) est une erreur de configuration ; appelé
// directement sans validation, le prérendu n'écrit rien hors du dossier.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { findConfig } from '../src/bundler/config.js'
import { prerenderPages } from '../src/server/prerender.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

function projet(cle: string): string {
  const root = mjsTmp('prerender-hors-dossier')
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ render: { outDir: 'pages', routes: { [cle]: { component: 'mjs-page', mode: 'prerender' } } } }))
  return root
}

describe('render.routes — une clé de route qui sortirait du dossier du prérendu', function () {
  after(async () => { await terminateSharedWorkerPool() })

  for (const cle of ['/../hors', '/a/../../hors', '/..', '/a\\..\\..\\hors', '/a\\b', 'C:/hors', '/C:\\hors']) {
    it(`clé ${JSON.stringify(cle)} : erreur de configuration claire`, () => {
      assert.throws(() => findConfig(projet(cle)), (e: any) => e.message.includes(`render.routes['${cle}']`) && /\.\./.test(e.message))
    })
  }

  for (const cle of ['/', '/blog', '/a/b', '/notes/a..b', '/docs/*', '/blog/:id', '/sitemap.xml']) {
    it(`clé ${JSON.stringify(cle)} : acceptée`, () => {
      assert.ok(findConfig(projet(cle)))
    })
  }

  it('prérendu appelé sans validation : rien n\'est écrit hors du dossier, la route est signalée en échec', async function () {
    this.timeout(60000)
    const root = mjsTmp('prerender-hors-dossier-direct')
    const dossier = join(root, 'projet')
    mkdirSync(join(dossier, 'src'), { recursive: true })
    writeFileSync(join(dossier, 'src', 'page.mjs'), '<p class="ok">page</p>\n')
    const config: any = { sourceDir: 'src', outputDir: 'out', render: { outDir: 'pages', engine: 'happy-dom', routes: { '/../../hors-du-projet': { component: 'mjs-page', mode: 'prerender' } } } }
    const rapport = await prerenderPages(config, dossier)
    assert.equal(existsSync(join(root, 'hors-du-projet.html')), false, 'aucun fichier hors du dossier du prérendu')
    assert.deepEqual(rapport.generated, [])
    assert.ok(rapport.skipped.some(s => s.fatal && s.url === '/../../hors-du-projet'), JSON.stringify(rapport.skipped))
  })
})
