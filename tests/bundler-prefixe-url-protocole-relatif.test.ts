// `urlPrefix` passé à l'API : une adresse protocole-relative (`//cdn.example.com/m`, la forme sans schéma des CDN) désigne
// un autre hôte et reste telle quelle, seuls ses slashs finaux tombent. Elle devenait `/cdn.example.com/m`, une adresse du
// site lui-même : 404 pour chaque fichier. Des slashs que ne suit aucun hôte se réduisent toujours

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

describe('préfixe des URL : adresse protocole-relative par l\'API', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('"//cdn.example.com/m/" garde son // et perd son slash final', () => {
    const b = new Bundler({ sourceDir: mjsTmp('prefixe-pr-src'), outputDir: mjsTmp('prefixe-pr-out'), urlPrefix: '//cdn.example.com/m/' })
    assert.equal(b.urlPrefix, '//cdn.example.com/m')
  })

  it('le manifeste publie //cdn.example.com/m/a-xxxxx.js', async () => {
    const root = mjsTmp('prefixe-pr')
    const src  = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'a.mjs'), '<p>a</p>\n')
    const b = new Bundler({ sourceDir: src, outputDir: join(root, 'out'), manifestPath: join(root, 'out', 'bundle.js'), urlPrefix: '//cdn.example.com/m' })
    try {
      const s = await b.compile()
      assert.equal(s.errors.length, 0, s.errors.map(e => e.message).join('\n'))
      assert.match(s.manifest.a, /^\/\/cdn\.example\.com\/m\/a-[0-9a-z]{5}\.js$/)
    }
    finally {
      await b.close()
    }
  })

  it('des slashs sans hôte derrière se réduisent : "//" et "/" sans préfixe, "///m/" → "/m"', () => {
    for (const [prefixe, attendu] of [['//', ''], ['/', ''], ['///m/', '/m']]) {
      const b = new Bundler({ sourceDir: mjsTmp('prefixe-pr-src'), outputDir: mjsTmp('prefixe-pr-out'), urlPrefix: prefixe })
      assert.equal(b.urlPrefix, attendu, prefixe)
    }
  })
})
