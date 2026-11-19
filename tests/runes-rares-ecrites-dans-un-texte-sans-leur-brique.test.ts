// production minifiée : `µ.raw` ou `µ.snap` écrits dans une chaîne, un gabarit littéral ou le texte du HTML n'emmènent pas la brique des
// runes rares (mêmes octets qu'une appli témoin qui écrit `ü` à la place de `µ`) ; `${µ.raw(x)}` dans un gabarit l'emmène
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const js = (corps: string, gabarit = '<p class="etat">ok</p>') => `<script lang="js">\n${corps}\n</script>\n${gabarit}\n`
const TEXTES: Array<[string, (m: string) => string]> = [
  ['chaîne', (m) => js(`  window.__s = 'voir ${m}.raw ici'`)],
  ['gabarit littéral', (m) => js('  window.__s = `' + m + '.snap`')],
  ['texte du HTML', (m) => js("  window.__s = 'rien'", `<p class="etat">${m}.snap et ${m}.raw</p>`)],
]

async function octets(source: string): Promise<number> {
  const root   = mjsTmp('runes-rares-octets')
  const srcDir = join(root, 'src')
  const out    = join(root, 'dist', 'assets')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'texte.mjs'), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: out, manifestPath: join(out, 'bundle.js'), urlPrefix: '/assets', js: 'bundle', env: 'prod', minify: true } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [])
  return readdirSync(out).filter((f) => f.endsWith('.js')).reduce((n, f) => n + readFileSync(join(out, f)).length, 0)
}

describe('µ.raw et µ.snap écrits dans un texte : pas de brique des runes rares', function () {
  this.timeout(280000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const [nom, source] of TEXTES) it(`${nom} : autant d'octets que le témoin`, async () => {
    assert.equal(await octets(source('µ')), await octets(source('ü')))
  })

  it('${µ.raw(x)} dans un gabarit : la brique entre', async () => {
    const avec = await octets(js('  window.__s = `${µ.raw(window.__l)}`'))
    const sans = await octets(js('  window.__s = `${ü.raw(window.__l)}`'))
    assert.ok(avec > sans, `avec ${avec} o, témoin ${sans} o`)
  })
})
