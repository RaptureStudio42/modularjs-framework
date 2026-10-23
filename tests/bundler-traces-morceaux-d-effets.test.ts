// un morceau d'effet (`mjs_fx_<nom>-<empreinte>.js`, construction en fichiers séparés) est du texte du runtime comme le
// cœur : ses traces `µ.log` partent du code envoyé en production quand le niveau de console coupe `log`
//
// `pure` ne vaut que pour un nom global, et dans un morceau `µ` est une liaison importée du cœur : seul le réécrivain
// des traces du runtime (option runtimeSource de minifyJs) les retire. Aucun effet du framework n'écrit de trace
// aujourd'hui ; le test fait écrire une trace repérable à un effet d'un runtime d'essai, copie de celui du framework
// (option `runtimeDir`), et regarde le fichier du morceau : la trace y est en développement et au niveau 'log', elle n'y
// est plus aux niveaux qui la coupent. Une trace de l'appli, elle, n'est pas du runtime : elle reste

import assert from 'node:assert/strict'
import { cpSync, mkdirSync, writeFileSync, readFileSync, readdirSync, appendFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const RUNTIME_DIR = join(dirname(fileURLToPath(import.meta.url)), '../src/runtime')
const TRACE       = 'trace-du-morceau-d-effet-xyz'
const TRACE_APPLI = 'trace-de-l-appli-xyz'

// la carte écrit *neon : le morceau mjs_fx_neon-<empreinte>.js ; son script écrit sa propre trace
const CARTE = `<script>\nµ.log('${TRACE_APPLI}')\n</script>\n<h1 class="t" *neon(#f0f)>titre</h1>\n`

let runtimeEssai = ''

async function construire(opts: Record<string, unknown>): Promise<{ morceau: string, carte: string }> {
  const root   = mjsTmp('traces-morceaux')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'carte.mjs'), CARTE)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), runtimeDir: runtimeEssai, ...opts } as any)
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  await bundler.close()
  const fichiers = readdirSync(outDir)
  const nom      = (re: RegExp) => { const f = fichiers.find((x) => re.test(x)); assert.ok(f, `${re} attendu parmi ${fichiers.join(' ')}`); return readFileSync(join(outDir, f!), 'utf-8') }
  return { morceau: nom(/^mjs_fx_neon-[0-9a-z]{5}\.js$/), carte: nom(/^carte-[0-9a-z]{5}\.js$/) }
}

describe('traces d\'un morceau d\'effet — le niveau de console de production les coupe comme celles du cœur', function () {
  this.timeout(240000)

  before(() => {
    runtimeEssai = join(mjsTmp('traces-morceaux-runtime'), 'runtime')
    cpSync(RUNTIME_DIR, runtimeEssai, { recursive: true })
    appendFileSync(join(runtimeEssai, 'mjs_fx_neon.ts'), `\nµ.log('${TRACE}');\n`)
  })
  after(async () => { await terminateSharedWorkerPool() })

  for (const niveau of [undefined, 'warn', 'error', 'silent']) {
    it(`production, niveau ${niveau ?? 'par défaut'} : la trace du morceau est retirée, celle de l'appli reste`, async () => {
      const { morceau, carte } = await construire({ env: 'prod', ...(niveau ? { logLevel: niveau } : {}) })
      assert.equal(morceau.includes(TRACE), false, 'la trace du morceau est partie')
      assert.equal(morceau.includes('MJS_TRACE'), false)
      assert.equal(carte.includes(TRACE_APPLI), true, 'le code de l\'appli n\'est pas du runtime : sa trace reste')
    })
  }

  it('production, niveau log : la trace du morceau reste', async () => {
    const { morceau } = await construire({ env: 'prod', logLevel: 'log' })
    assert.equal(morceau.includes(TRACE), true)
    assert.equal(morceau.includes('MJS_TRACE'), false)
  })

  it('développement : la trace du morceau reste, comme celles du cœur', async () => {
    const { morceau } = await construire({ env: 'dev' })
    assert.equal(morceau.includes(TRACE), true)
  })

  it('développement minifié : le niveau de production ne retire rien', async () => {
    const { morceau } = await construire({ env: 'dev', minify: true })
    assert.equal(morceau.includes(TRACE), true)
  })
})
