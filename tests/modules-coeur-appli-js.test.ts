// un projet réglé sur une autre langue que le Civet (`defaultScriptLang` à 'js', 'coffee' ou 'ts', gabarit en écriture `js`) emploie les
// modules du cœur comme un projet Civet : chaque module se compile dans la langue de son fichier, jamais dans celle du projet. Build
// RÉEL (Bundler) de tous les modules de src/core-modules, en développement et en production : aucune erreur, chaque module dans la
// sortie, et le code de chaque module identique à celui du même projet écrit en Civet

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

type Env = 'dev' | 'prod'

interface Construit {
  erreurs: string[]
  // code compilé de chaque module du cœur, par nom de module, sans la ligne de sa carte de code
  modules: Map<string, string>
}

// les modules du cœur, tirés du dossier : un module ajouté entre dans le test sans y toucher
const DOSSIER_MODULES = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'core-modules')
const MODULES         = readdirSync(DOSSIER_MODULES).filter((f) => f.endsWith('.mjs') && !f.startsWith('_')).map((f) => f.slice(0, -4)).sort()

// les réglages de langue d'un projet qui n'écrit pas tout en Civet
const LANGUES: Array<[string, Record<string, string>]> = [
  ['js', { defaultScriptLang: 'js' }],
  ['coffee', { defaultScriptLang: 'coffee' }],
  ['ts', { defaultScriptLang: 'ts' }]
]

// une page par module, chacune avec son script dans la langue du projet
async function construire(nom: string, langues: Record<string, string>, env: Env): Promise<Construit> {
  const root   = mjsTmp(`modules-coeur-appli-${nom.replace(/\W+/g, '-')}-${env}`)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const m of MODULES) writeFileSync(join(srcDir, `hote-${m}.mjs`), `<script>\n  $v = 1\n</script>\n<@@${m}></@@${m}>\n`)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/dist', ...langues, ...(env === 'prod' ? { env: 'prod' } : {}) } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  const modules = new Map<string, string>()
  for (const f of readdirSync(outDir)) {
    const m = /^core-([a-z]+)-[a-z0-9]+\.js$/.exec(f)
    if (m) modules.set(m[1], readFileSync(join(outDir, f), 'utf-8').replace(/\n\/\/# sourceMappingURL=.*\s*$/, ''))
  }
  return { erreurs: stats.errors.map((e: any) => String(e.message).split('\n')[0]), modules }
}

describe('modules du cœur dans un projet réglé sur une autre langue que le Civet — chaque module se compile dans la langue de son fichier', function () {
  this.timeout(240000)
  after(async () => { await terminateSharedWorkerPool() })

  it('la liste des modules est tirée du dossier src/core-modules', () => {
    assert.ok(MODULES.length >= 20, `modules trouvés : ${MODULES.join(', ')}`)
    for (const m of ['switch', 'select', 'number', 'tabs', 'editor', 'chart']) assert.ok(MODULES.includes(m), `<@@${m}> manque à la liste`)
  })

  for (const env of ['dev', 'prod'] as Env[]) {
    describe(`build de ${env === 'dev' ? 'développement' : 'production'}`, () => {
      let civet: Construit

      before(async () => {
        civet = await construire('civet', {}, env)
        assert.deepEqual(civet.erreurs, [], 'le projet Civet de référence se construit')
        assert.deepEqual([...civet.modules.keys()].sort(), MODULES, 'le projet Civet de référence a chaque module dans sa sortie')
      })

      for (const [nom, langues] of LANGUES) {
        it(`projet ${nom} : aucune erreur, chaque module dans la sortie, le même code que dans un projet Civet`, async () => {
          const projet = await construire(nom, langues, env)
          assert.deepEqual(projet.erreurs, [], `projet ${nom} : aucune erreur de construction`)
          assert.deepEqual([...projet.modules.keys()].sort(), MODULES, `projet ${nom} : chaque module du cœur a son fichier dans la sortie`)
          const differents = MODULES.filter((m) => projet.modules.get(m) !== civet.modules.get(m))
          assert.deepEqual(differents, [], `projet ${nom} : ces modules ne sortent pas le même code que dans un projet Civet`)
        })
      }
    })
  }
})
