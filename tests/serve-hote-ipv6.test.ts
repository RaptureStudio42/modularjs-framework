// `mjs serve` sur un hôte IPv6 (`dev.host: '::1'` ou `'::'`) : l'adresse de chaque requête se
// reconstruisait par `new URL(chemin, 'http://' + hôte)` — sans crochets, `http://::1` est une adresse
// invalide, et CHAQUE requête répondait 500. Une adresse IPv6 s'écrit entre crochets dans une URL.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { startRenderServer } from '../src/server/render-server.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

function projet(): string {
  const root = mjsTmp('serve-ipv6')
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'page.mjs'), '<p class="ok">page rendue</p>\n')
  return root
}

const config = (): any => ({ sourceDir: 'src', outputDir: 'out', render: { routes: { '/page': { component: 'mjs-page', mode: 'csr' } } } })

describe('mjs serve — hôte IPv6 : chaque requête répond', function () {
  after(async () => { await terminateSharedWorkerPool() })

  for (const hote of ['::1', '::']) {
    it(`hôte ${hote} : GET /page répond 200`, async function () {
      this.timeout(60000)
      let serveur: any
      try {
        serveur = await startRenderServer(config(), projet(), { port: 0, host: hote })
      }
      catch (e: any) {
        // machine sans IPv6 : rien à vérifier ici
        if (/EADDRNOTAVAIL|EAFNOSUPPORT/.test(String(e && (e.code || e.message)))) { this.skip(); return }
        throw e
      }
      try {
        const res = await fetch(`http://[::1]:${serveur.port}/page`)
        assert.equal(res.status, 200, await res.text())
      } finally {
        await serveur.close()
      }
    })
  }
})
