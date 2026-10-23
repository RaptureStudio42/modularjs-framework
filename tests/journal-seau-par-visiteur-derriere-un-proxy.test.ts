// Le seau à jetons de POST /__mjs/errors est tenu par adresse. Derrière un proxy inverse (nginx), toutes les requêtes
// arrivent de l'adresse du proxy : tous les visiteurs se partageaient le même seau (10 d'un coup, puis 0,5 par seconde).
// `journal.trustProxy` reprend le réglage `trustProxy` de MJS-WS (mêmes valeurs, mêmes refus) : l'adresse du visiteur est
// lue dans X-Forwarded-For quand le pair est un proxy de confiance. Sans réglage, l'adresse de la socket, comme avant :
// un X-Forwarded-For envoyé par le visiteur lui-même ne compte pas.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { startRenderServer } from '../src/server/render-server.js'
import { StaticServer } from '../src/server/index.js'
import { createJournal } from '../src/server/journal.js'
import { findConfig } from '../src/bundler/config.js'
import { mjsTmp, sweepRegistered } from './helpers/tmp.js'

after(() => sweepRegistered())

function projet(journal: Record<string, unknown>) {
  const root   = mjsTmp('journal-seau-proxy')
  const outDir = join(root, 'out')
  mkdirSync(join(root, 'src'), { recursive: true })
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(root, 'src', 'home.mjs'), '<h1>Salut</h1>')
  writeFileSync(join(outDir, 'manifest.js'), "const µCore = '/mjs_core-test1234.js';\nµ.paths = {};\nµ.version = \"abcd1234\";\n")
  const config: any = { sourceDir: 'src', outputDir: 'out', manifestPath: 'out/manifest.js', journal, render: { routes: { '/': { component: 'mjs-home', mode: 'csr' } } } }
  return { root, outDir, config }
}

async function rafale(port: number, visiteurs: boolean): Promise<number[]> {
  const statuts: number[] = []
  for (let i = 0; i < 14; i++) {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (visiteurs) headers['x-forwarded-for'] = `203.0.113.${i + 1}`
    const res = await fetch(`http://127.0.0.1:${port}/__mjs/errors`, { method: 'POST', headers, body: JSON.stringify({ message: 'rafale' + i, url: '/' + i }) })
    statuts.push(res.status)
  }
  return statuts
}

describe('journal — seau de POST /__mjs/errors par visiteur derrière un proxy', function () {
  this.timeout(20000)

  it('mjs serve, trustProxy "loopback" : 14 visiteurs derrière le proxy local, aucun 429', async () => {
    const { root, config } = projet({ client: true, trustProxy: 'loopback' })
    const running = await startRenderServer(config, root, { port: 0 })
    try { assert.ok((await rafale(running.port, true)).every(s => s === 204)) }
    finally { await running.close() }
  })

  it('mjs dev, trustProxy "loopback" : 14 visiteurs derrière le proxy local, aucun 429', async () => {
    const { root, outDir, config } = projet({ client: true, trustProxy: 'loopback' })
    const server = new StaticServer({ rootDir: outDir, pathPrefix: '/modularjs', port: 0, host: '127.0.0.1', config, configDir: root, journal: createJournal({ dir: join(root, 'log') }) })
    await server.start()
    try {
      const statuts = await rafale((server.server!.address() as any).port, true)
      assert.ok(statuts.every(s => s === 204), statuts.join(','))
    }
    finally { await server.stop() }
  })

  it('sans trustProxy : X-Forwarded-For ignoré, même seau pour tous (429 au-delà de 10)', async () => {
    const { root, config } = projet({ client: true })
    const running = await startRenderServer(config, root, { port: 0 })
    try { assert.ok((await rafale(running.port, true)).slice(10).includes(429)) }
    finally { await running.close() }
  })

  it('configuration : "loopback" et une liste acceptés, true refusé', () => {
    const essai = (trustProxy: unknown): void => {
      const root = mjsTmp('journal-seau-cfg')
      writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ journal: { trustProxy } }))
      findConfig(root)
    }
    essai('loopback')
    essai(['10.0.0.0/8'])
    assert.throws(() => essai(true), /journal\.trustProxy/)
  })
})
