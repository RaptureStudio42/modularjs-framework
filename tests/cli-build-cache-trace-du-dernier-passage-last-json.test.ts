// `mjs build --cache` : la trace du dernier passage (ce qu'était la clé, pour dire ce qui a changé) s'appelle `last.json`, et
// `last-render.json` pour la construction d'un moteur de rendu ; le dossier du cache ne garde rien d'autre que les clés, `files/`
// et cette trace

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler } from '../src/bundler/index.js'

const MJS    = fileURLToPath(new URL('../bin/mjs', import.meta.url))
const CONFIG = '{ "sourceDir": "app/modularjs", "outputDir": "public/modularjs", "manifestPath": "public/modularjs/bundle.js" }\n'

describe('mjs build --cache : trace du dernier passage', function () {
  this.timeout(180_000)

  it('la trace s\'appelle last.json, seule à côté des clés et de files/', function () {
    const root = mjsTmp('cache-trace')
    mkdirSync(join(root, 'app/modularjs'), { recursive: true })
    mkdirSync(join(root, 'node_modules'))
    writeFileSync(join(root, 'mjs.config.json'), CONFIG)
    writeFileSync(join(root, 'app/modularjs/accueil.mjs'), '<h1>accueil</h1>\n')
    const done = spawnSync(process.execPath, [MJS, 'build', '--root', root, '--cache'], { encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1' } })
    assert.equal(done.status, 0, `${done.stdout}\n${done.stderr}`)
    const others = readdirSync(join(root, 'node_modules/.cache/mjs/build')).filter((f) => !/^[0-9a-f]{16}\.json$/.test(f) && f !== 'files')
    assert.deepEqual(others, ['last.json'])
  })

  it('construction d\'un moteur de rendu : sa trace s\'appelle last-render.json', function () {
    const root  = mjsTmp('cache-trace-rendu')
    const trace = (serverRender: boolean): string => (new Bundler({ sourceDir: join(root, 'src'), outputDir: join(root, 'out'), manifestPath: join(root, 'out/bundle.js'), urlPrefix: '/out', serverRender } as any) as any).diskCacheTrace()
    assert.equal(trace(true), 'last-render.json')
    assert.equal(trace(false), 'last.json')
  })
})
