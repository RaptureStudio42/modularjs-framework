// rendu par requête dans un back hôte (`createRenderHandler` : l'hôte pose le corps rendu dans SA page, sans la tête du
// serveur) : le corps d'une page ssr définit chaque variable de taille du texte qu'il lit, avant l'arrivée du script ;
// `"responsiveFontSize": false` le laisse sans variable ni bloc

import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { build, write } from './helpers/construction-cache.js'
import { findConfig } from '../src/bundler/config.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createRenderHandler } from '../src/server/render-request.js'

function projet(prefix: string, reglage?: unknown): string {
  const root = mjsTmp(prefix)
  const conf = { sourceDir: 'app', outputDir: 'public/m', manifestPath: 'public/m/bundle.js', urlPrefix: '/m', render: { default: 'ssr', routes: { '/': { component: 'mjs-ma-page' } } }, ...(reglage === undefined ? {} : { responsiveFontSize: reglage }) }
  write(join(root, 'mjs.config.json'), `${JSON.stringify(conf, null, 2)}\n`)
  write(join(root, 'app/ma-page.mjs'), '<h1 class="t">Titre</h1>\n<p class="p">petit</p>\n<style>\n  .t\n    font-size: 41.5px\n  .p\n    font-size: 12px\n</style>\n')
  return root
}

// l'appli bâtie, puis le corps que le gestionnaire rend pour `/`
async function corps(root: string): Promise<string> {
  const run = build(root, ['--prod'])
  assert.equal(run.status, 0, run.out)
  const found   = findConfig(root)!
  const handler = await createRenderHandler(found.config, found.configDir)
  try {
    const r = await handler.handle('/')
    assert.equal(r.kind, 'ssr', JSON.stringify(r))
    return r.body
  } finally {
    await handler.close()
  }
}

describe('rendu par requête — tailles du texte dans le corps rendu', function () {
  this.timeout(280_000)
  after(async () => { await terminateSharedWorkerPool() })

  it('chaque variable de taille lue par le corps y est définie', async () => {
    const body = await corps(projet('requete-taille'))
    const lues = [...new Set([...body.matchAll(/var\((--mjs-fs-[\w]+)\)/g)].map(m => m[1]))]
    assert.deepEqual(lues, ['--mjs-fs-41_5'], body)
    for (const nom of lues) assert.ok(body.includes(`${nom}:calc(`) && body.includes(`${nom}:2.59375rem`), `${nom} lue sans être définie dans le corps\n${body}`)
  })

  it('"responsiveFontSize": false — ni variable ni bloc', async () => {
    const body = await corps(projet('requete-taille-coupee', false))
    assert.ok(!body.includes('--mjs-fs-'), body)
    assert.match(body, /font-size:\s*41\.5px/)
  })
})
