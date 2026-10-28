// Ce que ce test garantit : l'aide qui tait un chargement coupé par le départ de la page (`µ._mjs_loading`,
// `µ._mjs_loadFailed`, ses écouteurs de `pagehide`, `pageshow` et de navigation) n'entre au cœur que si un chargeur du cœur
// s'en sert : le chargeur des composants (`µ.Autoloader`), celui des langues, des effets, des feuilles à la demande, des
// variantes de mise en page. Une appli en fichier unique qui ne charge rien d'autre ne la paie plus (environ 770 octets en production) ; une appli
// qui charge quelque chose la garde, à l'identique.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

// le fichier unique passe par esbuild, qui écrit les chaînes entre guillemets doubles
const AIDE = [/µ\._mjs_loading = function/, /µ\._mjs_loadFailed = function/, /addEventListener\(["']pagehide["']/]

const COMPTEUR = '<script>\n$n = 0\nplus = -> $n++\n</script>\n<button @click={plus()}>{$n}</button>\n'

async function construire(reglages: Record<string, unknown>, i18n = false): Promise<string> {
  const root   = mjsTmp('aide-de-depart')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'compteur.mjs'), COMPTEUR)
  if (i18n) {
    mkdirSync(join(srcDir, 'i18n'), { recursive: true })
    writeFileSync(join(srcDir, 'i18n', 'fr.yml'), 'titre: Titre\n')
    writeFileSync(join(srcDir, 'titre.mjs'), '<h1>{µt(\'titre\')}</h1>\n')
  }
  const manifestPath = join(root, 'bundle.js')
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath, runtime: 'core', env: 'dev', ...(i18n ? { i18n: { default: 'fr' } } : {}), ...reglages } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  if (reglages.js === 'bundle') return readFileSync(manifestPath, 'utf-8')
  const coeur = readdirSync(outDir).find(f => /^mjs_core-.+\.js$/.test(f))
  assert.ok(coeur, 'mjs_core-*.js doit exister')
  return readFileSync(join(outDir, coeur!), 'utf-8')
}

const presents = (code: string): string[] => AIDE.filter(m => m.test(code)).map(String)
const TOUTE    = AIDE.map(String)

describe('cœur — l\'aide de départ de page seulement avec un chargeur', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('fichier unique sans chargeur : l\'aide n\'est pas livrée', async () => {
    assert.deepEqual(presents(await construire({ js: 'bundle' })), [])
  })

  it('fichier unique avec le chargeur des langues : l\'aide est livrée', async () => {
    assert.deepEqual(presents(await construire({ js: 'bundle', runtime: ['i18n'] }, true)), TOUTE)
  })

  it('fichier unique avec le chargeur des composants demandé : l\'aide est livrée', async () => {
    assert.deepEqual(presents(await construire({ js: 'bundle', runtime: ['autoloader'] })), TOUTE)
  })

  it('fichiers séparés (le chargeur des composants est au cœur) : l\'aide est livrée', async () => {
    assert.deepEqual(presents(await construire({ js: 'split' })), TOUTE)
  })
})
