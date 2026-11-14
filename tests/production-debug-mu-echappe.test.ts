// production : la ligne `µ.debug = …` part du code envoyé, que `µ` y soit écrit en clair ou échappé
// (`\u00B5`, `\u00b5`, `\u{B5}`, `\u{b5}`, `\u{00B5}`) ; une appli Civet garde
// la même sortie, le développement garde la ligne

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { minifyJs } from '../src/bundler/minify.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const FORMES = ['\\u00B5', '\\u00b5', '\\u{B5}', '\\u{b5}', '\\u{00B5}']
const lire   = (d: string): string => readdirSync(d, { withFileTypes: true }).map((f) => f.isDirectory() ? lire(join(d, f.name)) : (f.name.endsWith('.js') ? readFileSync(join(d, f.name), 'utf-8') : '')).join('\n')

describe('production : la ligne `µ.debug = …` part, µ échappé compris', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const forme of FORMES) {
    it(`\`${forme}.debug = true\` seul sur sa ligne part, comme en clair`, async () => {
      const source = `${forme}.debug = true\nif (${forme}.debug) { console.log('DBG_X') }\nexport const garde = 1\n`
      const sortie = (await minifyJs(source, { force: true })).code
      assert.doesNotMatch(sortie, /debug|DBG_X/, sortie)
      assert.match(sortie, /garde/, sortie)
      assert.equal(sortie, (await minifyJs(source.split(forme).join('µ'), { force: true })).code)
    })
  }

  it('la même ligne écrite dans un gabarit de texte reste', async () => {
    const sortie = (await minifyJs('export const guide = `\n\\u00B5.debug = true\n`\n', { force: true })).code
    assert.match(sortie, /\.debug = true/, sortie)
  })

  it('développement : la ligne reste', async () => {
    const sortie = (await minifyJs('\\u00B5.debug = true\nexport const garde = 1\n', { force: true, dev: true })).code
    assert.match(sortie, /debug\s*=\s*(?:!0|true)/, sortie)
  })

  const scripts: [string, string][] = [
    ['TypeScript', `<script lang="ts">\n  $q = 'a'\n  µ.debug = true\n  if (µ.debug) { console.log('DBG_X') }\n</script>`],
    ['Civet', `<script>\n  $q = 'a'\n  µ.debug = true\n  if µ.debug then console.log 'DBG_X'\n</script>`],
  ]
  for (const [nom, script] of scripts) {
    it(`appli en production, script ${nom} : ni la ligne \`µ.debug = true\` ni le bloc qu'elle garde`, async () => {
      const racine = mjsTmp('debug-production-' + nom)
      const src    = join(racine, 'src')
      const out    = join(racine, 'out')
      mkdirSync(src, { recursive: true })
      writeFileSync(join(src, 'tdebug.mjs'), `${script}\n<b>{$q}</b>\n`)
      const bundler = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), env: 'prod', js: 'split', urlPrefix: '/out' } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      assert.deepEqual(stats.errors.map((e: any) => e.message), [])
      const js = lire(out)
      assert.match(js, /tdebug|Tdebug/i, 'composant absent de la sortie')
      assert.doesNotMatch(js, /DBG_X|\.debug\s*=\s*(?:!0|true)/, js.split('\n').filter((l) => /debug/.test(l)).join('\n').slice(0, 400))
    })
  }
})
