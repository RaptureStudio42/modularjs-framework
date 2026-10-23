// le cookie de la visionneuse du journal n'avait `Secure` qu'en TLS direct : derrière un proxy TLS (nginx, le cas courant de
// `mjs serve`), il partait sans, même avec `journal.trustProxy` réglé. Un proxy de confiance qui annonce `X-Forwarded-Proto: https`
// vaut maintenant TLS ; un autre pair, ou sans `journal.trustProxy`, l'en-tête n'est pas lu

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { StaticServer } from '../src/server/index.js'
import { createJournal } from '../src/server/journal.js'
import { startRenderServer } from '../src/server/render-server.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

function projet(trustProxy: unknown): { root: string, config: any } {
  const root = mjsTmp('visionneuse-secure')
  mkdirSync(join(root, 'src'), { recursive: true })
  mkdirSync(join(root, 'out'), { recursive: true })
  writeFileSync(join(root, 'src', 'home.mjs'), '<h1>Salut</h1>')
  writeFileSync(join(root, 'out', 'manifest.js'), "const µCore = '/mjs_core-test1234.js';\nµ.paths = {};\nµ.version = \"abcd1234\";\n")
  const config: any = { sourceDir: 'src', outputDir: 'out', manifestPath: 'out/manifest.js', journal: { viewer: 'JETON-123', ...(trustProxy === undefined ? {} : { trustProxy }) }, render: { routes: { '/': { component: 'mjs-home', mode: 'csr' } } } }
  return { root, config }
}

async function cookie(port: number, proto?: string): Promise<string> {
  const r = await fetch(`http://127.0.0.1:${port}/__mjs/errors?token=JETON-123`, { headers: proto ? { 'x-forwarded-proto': proto } : {} })
  assert.equal(r.status, 200)
  await r.text()
  return r.headers.get('set-cookie') ?? ''
}

describe('visionneuse du journal — cookie Secure derrière un proxy de confiance', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('mjs dev', async () => {
    for (const [trustProxy, proto, secure] of [['loopback', 'https', true], ['loopback', 'http', false], [undefined, 'https', false], [['203.0.113.9'], 'https', false]] as const) {
      const { root, config } = projet(trustProxy)
      const journal = createJournal({ dir: join(root, 'log') })
      const srv = new StaticServer({ rootDir: join(root, 'out'), pathPrefix: '/modularjs', port: 0, host: '127.0.0.1', manifestPath: join(root, 'out', 'manifest.js'), config, configDir: root, journal })
      await srv.start()
      try {
        const c = await cookie((srv.server!.address() as any).port, proto)
        assert.match(c, /^mjs-journal=/)
        assert.equal(/; Secure/.test(c), secure, `${JSON.stringify(trustProxy)} ${proto} : ${c}`)
      } finally {
        await srv.stop()
        journal.close()
      }
    }
  })

  it('mjs serve', async () => {
    for (const [trustProxy, proto, secure] of [['loopback', 'https', true], [undefined, 'https', false]] as const) {
      const { root, config } = projet(trustProxy)
      const serveur = await startRenderServer(config, root, { port: 0, host: '127.0.0.1', env: 'prod' })
      try {
        const c = await cookie(serveur.port, proto)
        assert.match(c, /^mjs-journal=/)
        assert.equal(/; Secure/.test(c), secure, `${JSON.stringify(trustProxy)} ${proto} : ${c}`)
      } finally {
        await serveur.close()
      }
    }
  })
})
