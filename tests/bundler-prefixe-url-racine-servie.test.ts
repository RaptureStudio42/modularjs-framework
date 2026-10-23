// Préfixe des URL du manifeste : un dossier de sortie qui EST la racine servie (`public`, `/var/www/app/public`) ne
// préfixe rien, et `urlPrefix: '/'` passé à l'API se normalise comme dans mjs.config.json (jamais `//a-xxxxx.js`, qui
// désignerait un autre hôte).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, deriveUrlPrefix, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

describe('préfixe des URL : racine servie et "/"', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('un dossier de sortie qui finit par public ne préfixe rien', () => {
    assert.equal(deriveUrlPrefix('public'), '')
    assert.equal(deriveUrlPrefix('public/'), '')
    assert.equal(deriveUrlPrefix('/var/www/app/public'), '')
    assert.equal(deriveUrlPrefix('public/modularjs'), '/modularjs')
    assert.equal(deriveUrlPrefix('/var/www/app/public/assets/x'), '/assets/x')
  })

  it('urlPrefix "/" donne des URL /a-xxxxx.js', async () => {
    const root = mjsTmp('prefixe-racine')
    const src = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'a.mjs'), '<p>a</p>\n')
    const b = new Bundler({ sourceDir: src, outputDir: join(root, 'out'), manifestPath: join(root, 'out', 'bundle.js'), urlPrefix: '/' })
    assert.equal(b.urlPrefix, '')
    const s = await b.compile()
    assert.equal(s.errors.length, 0, s.errors.map(e => e.message).join('\n'))
    assert.match(s.manifest.a, /^\/a-[0-9a-z]{5}\.js$/)
  })

  it('une adresse absolue garde son // et perd son slash final', () => {
    const b = new Bundler({ sourceDir: mjsTmp('prefixe-cdn-src'), outputDir: mjsTmp('prefixe-cdn-out'), urlPrefix: 'https://cdn.example.test/m/' })
    assert.equal(b.urlPrefix, 'https://cdn.example.test/m')
  })
})
