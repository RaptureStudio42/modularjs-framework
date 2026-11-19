// le corps qu'envoie le veilleur d'erreurs du navigateur (mjs_journal.ts) est lu par les deux serveurs qui le reçoivent, `mjs serve`
// (server/render-server.ts) et `mjs dev` (server/index.ts) : chaque champ porte le même nom des deux côtés, la pile d'appels envoyée
// arrive au journal, et une erreur répétée ne part qu'une fois. Chaque côté testé contre son propre corps écrit à la main ne voit
// pas un champ renommé d'un seul côté : ici, le corps est celui que le cœur bâti envoie vraiment

import assert from 'node:assert/strict'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { startRenderServer } from '../src/server/render-server.js'
import { StaticServer } from '../src/server/index.js'
import { createJournal } from '../src/server/journal.js'
import { mjsTmp, sweepRegistered } from './helpers/tmp.js'

after(() => sweepRegistered())
after(async () => { await terminateSharedWorkerPool() })

const stripEsm = (s: string) => s
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
  .replace(/\bexport\s+default\s+/g, '')
  .replace(/\bexport\s+/g, '')
  .replace(/import\.meta\.url/g, "'http://localhost/'")

// le cœur bâti avec le module du journal, puis les corps que son veilleur envoie pour la même erreur levée deux fois (pile témoin)
async function browserBodies(): Promise<string[]> {
  const root   = mjsTmp('journal-body')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'placeholder.mjs'), '<script>\n$x = 0\n</script>\n<div>ph</div>')
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), runtime: ['journal'] })
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const core        = readdirSync(outDir).find((f) => /^mjs_core-/.test(f))!
  const window: any = new Window({ url: 'http://localhost/page' })
  window.eval(`${stripEsm(readFileSync(join(outDir, core), 'utf-8'))}\nglobalThis.µ = µ;`)
  window.µ.config.journal = true
  const blobs = [] as any[]
  window.navigator.sendBeacon = (_url: string, blob: any) => { blobs.push(blob); return true }
  for (let i = 0; i < 2; i++) {
    const error = new window.Error('boom client')
    error.stack = 'Error: boom client\n    at traceWitness (page.js:1:1)'
    window.dispatchEvent(new window.ErrorEvent('error', { message: 'boom client', error }))
  }
  return Promise.all(blobs.map((b) => b.text()))
}

function project(): { root: string, config: any } {
  const root = mjsTmp('journal-body-server')
  mkdirSync(join(root, 'src'), { recursive: true })
  mkdirSync(join(root, 'out'), { recursive: true })
  writeFileSync(join(root, 'src', 'home.mjs'), '<h1>Salut</h1>')
  writeFileSync(join(root, 'out', 'manifest.js'), "const µCore = '/mjs_core-test1234.js';\nµ.paths = {};\nµ.version = \"abcd1234\";\n")
  const config: any = { sourceDir: 'src', outputDir: 'out', manifestPath: 'out/manifest.js', render: { routes: { '/': { component: 'mjs-home', mode: 'csr' as const } } }, journal: { client: true } }
  return { root, config }
}

async function postThenRead(port: number, body: string | undefined): Promise<any[]> {
  const res = await fetch(`http://127.0.0.1:${port}/__mjs/errors`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ?? '' })
  assert.equal(res.status, 204, 'le corps envoyé par le navigateur est refusé')
  return (await fetch(`http://127.0.0.1:${port}/__mjs/errors.json`)).json()
}

describe('journal : le corps envoyé par le navigateur est lu par mjs serve et par mjs dev', function () {
  this.timeout(60000)

  let bodies: string[]
  before(async () => { bodies = await browserBodies() })

  it('le veilleur envoie une erreur levée deux fois, une seule fois', () => {
    assert.equal(bodies.length, 1, 'nombre d\'envois du veilleur')
  })

  it('mjs serve garde la pile d\'appels que le navigateur envoie', async () => {
    const { root, config } = project()
    const running          = await startRenderServer(config, root, { port: 0 })
    try {
      const entries = await postThenRead(running.port, bodies[0])
      assert.equal(entries.length, 1)
      assert.match(JSON.stringify(entries[0]), /traceWitness/, 'la pile d\'appels envoyée manque au journal')
    }
    finally {
      await running.close()
    }
  })

  it('mjs dev garde la pile d\'appels que le navigateur envoie', async () => {
    const { root, config } = project()
    const journal          = createJournal({ dir: join(root, 'log') })
    const server           = new StaticServer({ rootDir: join(root, 'out'), port: 0, host: '127.0.0.1', journal, config, configDir: root, manifestPath: join(root, 'out', 'manifest.js') } as any)
    await server.start()
    try {
      const entries = await postThenRead((server.server!.address() as any).port, bodies[0])
      assert.equal(entries.length, 1)
      assert.match(JSON.stringify(entries[0]), /traceWitness/, 'la pile d\'appels envoyée manque au journal')
    }
    finally {
      await server.stop()
    }
  })
})
