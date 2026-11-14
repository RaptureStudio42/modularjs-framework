// La page du journal `/__mjs/errors` (et celle du thème) se compile à la volée et partage le cœur de l'application. Sous
// `"proxy": false`, ce cœur ne porte pas l'enveloppe : un `µproxy $x.y` écrit dans une de ces pages appellerait une aide absente.
// Aujourd'hui aucune ne l'écrit, et le script servi n'appelle pas cette aide : ce test garde cet état, pour qu'une visionneuse
// qui s'en servirait un jour soit vue ici avant d'atteindre une appli sans enveloppe.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { getViewerScript, JOURNAL_VIEWER, THEME_VIEWER } from '../src/server/viewer-page.js'

const ICI = dirname(fileURLToPath(import.meta.url))

describe('page du journal sous "proxy": false : aucun `µproxy`', function () {
  this.timeout(60000)
  let manifeste = ''

  before(async () => {
    const root   = mjsTmp('journal-sans-proxy')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hop.mjs'), '<script>\n$t = \'ok\'\n</script>\n<p>{$t}</p>\n')
    manifeste     = join(root, 'out', 'bundle.js')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: manifeste, proxy: false } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const spec of [JOURNAL_VIEWER, THEME_VIEWER]) {
    it(`${spec.fileName} : la source n'écrit pas \`µproxy\`, le script servi n'appelle pas l'aide de l'enveloppe`, async () => {
      const source = readFileSync(join(ICI, '..', 'src', 'server', spec.fileName), 'utf8')
      assert.doesNotMatch(source, /µ\.?proxy\b/, 'aucun `µproxy` dans la source de la visionneuse')
      const script = await getViewerScript(manifeste, spec)
      assert.ok(script.length > 0, 'la visionneuse se compile')
      assert.doesNotMatch(script, /_mjs_makeDeepProxy/, 'le script servi n\'appelle pas l\'aide de `µproxy`')
    })
  }
})
