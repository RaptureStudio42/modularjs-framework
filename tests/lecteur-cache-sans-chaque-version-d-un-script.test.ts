// `mjs dev` relit à chaque reconstruction le fichier d'un composant qui cite une balise du cœur (`<@@editor>`) : le lecteur gardait
// dans son cache des compilations le script entier de chaque version lue (une entrée neuve par version, la mémoire de `mjs dev`
// grandissait à chaque reconstruction) ; un script se relit sans rejoindre le cache, les expressions du gabarit y restent. Vraie
// construction par le même Bundler, reconstruit trois fois ; des compilations comptées, aucun temps
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { codeCounters, readFile } from '../src/reader/index.js'
import { mjsTmp } from './helpers/tmp.js'

const page = (version: number): string => `<script>\n$compte = 0\nversion = ${version}\ndoubler = (x) -> x * 2 + version\n</script>\n<form>\n  <label for="corps">Corps {$compte}</label>\n  <@@editor id="corps" name="corps"></@@editor>\n</form>\n`

describe('lecteur : le cache des compilations ne garde pas chaque version d\'un script relu', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  it('après trois reconstructions par le Bundler de `mjs dev`, relire la première version recompile son script', async () => {
    const root = mjsTmp('cache-scripts')
    const src  = join(root, 'src')
    const out  = join(root, 'public')
    mkdirSync(src, { recursive: true })
    const garde = { log: console.log, warn: console.warn }
    const b     = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), env: 'dev' } as any)
    try {
      console.log = console.warn = () => {}
      for (let version = 0; version <= 3; version++) {
        writeFileSync(join(src, 'page.mjs'), page(version))
        const stats = await b.compile()
        assert.deepEqual(stats.errors, [], `version ${version} : construction refusée`)
      }
    }
    finally {
      Object.assign(console, garde)
      await b.close()
    }
    const avant = codeCounters.compilations
    const lu    = readFile(page(1), { file: join(src, 'page.mjs') })
    assert.deepEqual(lu.diagnostics, [])
    assert.ok(codeCounters.compilations > avant, 'le script de la version 1 est encore dans le cache du lecteur : chaque version relue d\'un script y reste')
  })
})
