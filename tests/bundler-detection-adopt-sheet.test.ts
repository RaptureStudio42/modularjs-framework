// mjs_adopt_sheet.ts (µ.adoptSheet : coller une feuille de style dans l'ombre d'un composant), détaché du cœur :
// seul le code d'un projet qui écrit `adoptSheet` l'appelle. Absent d'un build qui ne l'écrit pas, À L'OCTET PRÈS
// (la sortie est celle d'un runtime qui n'a jamais eu le fichier), présent et fonctionnel sinon ; faits inconnus
// (API directe) : gardé. Un nom fabriqué à l'exécution (`µ['adopt' + 'Sheet']`), que la construction ne voit pas, se
// demande par `runtime: ['adopt_sheet']`.

import assert from 'node:assert/strict'
import { cpSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transpile } from '../src/transpiler/index.js'
import { scanCompiledFeatures } from '../src/bundler/features.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const ICI  = dirname(fileURLToPath(import.meta.url))
const MARK = 'µ.adoptSheet = function'

// le même dossier runtime que le framework, privé du fichier de l'outil : le runtime d'avant l'outil
function runtimeSansOutil(): string {
  const dir = join(mjsTmp('adopt-sheet-runtime'), 'runtime')
  cpSync(join(ICI, '..', 'src', 'runtime'), dir, { recursive: true, filter: (s) => !s.endsWith('mjs_adopt_sheet.ts') })
  assert.equal(existsSync(join(dir, 'mjs_adopt_sheet.ts')), false)
  return dir
}

type Sortie = { texte: string, fichiers: Map<string, string> }

async function construire(nom: string, conf: any, source: string): Promise<Sortie> {
  const root   = mjsTmp('detect-adopt-sheet-' + nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hote.mjs'), source + '\n')
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), ...conf } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  // tout le JavaScript émis : le cœur (construction découpée) comme le fichier unique (`js: 'bundle'`)
  const fichiers = new Map<string, string>()
  for (const f of readdirSync(outDir).filter((n) => n.endsWith('.js'))) fichiers.set(f, readFileSync(join(outDir, f), 'utf-8'))
  try { fichiers.set('bundle.js', readFileSync(join(root, 'bundle.js'), 'utf-8')) } catch { /* pas de fichier unique */ }
  // le tableau des libellés du manifeste (`µ._runtimeLabels = …`) est une donnée, pas le code de l'outil : il porte, pour toute
  // appli, la clé et le texte de l'avertissement que l'outil écrit, et ces deux-là nomment `adoptSheet`
  const sansLibelles = (t: string) => t.split('\n').filter((l) => !l.trim().startsWith('µ._runtimeLabels =')).join('\n')
  return { texte: [...fichiers.values()].map(sansLibelles).join('\n'), fichiers }
}

const ECRIT = '<script>\n@adopt = (sheet) -> µ.adoptSheet(@, sheet)\n</script>\n<p>x</p>'
const SANS  = '<script>\n$n = 0\n</script>\n<p>{$n}</p>'

describe('mjs_adopt_sheet.ts — détaché du cœur, build RÉEL', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('aucun appel : ABSENT (ni µ.adoptSheet ni le tableau de feuilles que la balise tient)', async () => {
    const { texte } = await construire('nu', { runtime: 'core' }, SANS)
    assert.equal(texte.includes(MARK), false)
    assert.equal(texte.includes('adoptSheet'), false)
    assert.equal(texte.includes('_mjs_adopted'), false)
  })

  it('composant qui écrit µ.adoptSheet(…) : PRÉSENT, découpé comme en un fichier', async () => {
    for (const js of [undefined, 'bundle']) {
      for (const runtime of ['core', 'all', undefined]) {
        const { texte } = await construire('ecrit-' + js + '-' + runtime, { runtime, js }, ECRIT)
        assert.ok(texte.includes(MARK), 'js: ' + js + ', runtime: ' + runtime)
      }
    }
  })

  it('runtime: [\'adopt_sheet\'] : PRÉSENT sans appel écrit (un nom fabriqué à l\'exécution, que la construction ne voit pas)', async () => {
    const { texte } = await construire('force', { runtime: ['adopt_sheet'] }, SANS)
    assert.ok(texte.includes(MARK))
  })

  it('runtime non précisé (tous les modules) : ABSENT sans appel', async () => {
    for (const js of [undefined, 'bundle']) {
      const sans = await construire('tous-nu-' + js, { js }, SANS)
      assert.equal(sans.texte.includes(MARK), false, 'js: ' + js)
    }
  })

  it('sans appel, la sortie est identique à l\'octet à celle d\'un runtime qui n\'a pas le fichier, en développement comme en production', async () => {
    const dir = runtimeSansOutil()
    for (const conf of [{ runtime: 'core' }, { runtime: 'all' }, {}, { js: 'bundle' }, { env: 'dev' }, { env: 'prod' }, { env: 'prod', js: 'bundle' }]) {
      const avec = await construire('octet-avec', conf, SANS)
      const sans = await construire('octet-sans', { ...conf, runtimeDir: dir }, SANS)
      assert.deepEqual([...avec.fichiers.keys()].sort(), [...sans.fichiers.keys()].sort(), 'mêmes fichiers (noms hachés compris) : ' + JSON.stringify(conf))
      for (const [nom, texte] of avec.fichiers) assert.equal(texte, sans.fichiers.get(nom), nom + ' : ' + JSON.stringify(conf))
    }
  })

  describe('API directe (resolveRuntimeFiles)', () => {
    it('faits inconnus : gardé', () => {
      assert.ok(new Bundler({ runtime: 'core' } as any).resolveRuntimeFiles().files.includes('mjs_adopt_sheet.ts'))
    })

    it('faits connus sans signal : absent, en core comme en all', () => {
      for (const runtime of ['core', 'all']) {
        assert.equal(new Bundler({ runtime } as any).resolveRuntimeFiles(new Set()).files.includes('mjs_adopt_sheet.ts'), false, runtime)
      }
    })

    it('le signal adopt_sheet le rend, en core comme en all', () => {
      for (const runtime of ['core', 'all']) {
        assert.ok(new Bundler({ runtime } as any).resolveRuntimeFiles(new Set(['adopt_sheet'])).files.includes('mjs_adopt_sheet.ts'), runtime)
      }
    })

    it('demandé par la configuration (runtime: [\'adopt_sheet\']) : rendu sans signal', () => {
      assert.ok(new Bundler({ runtime: ['adopt_sheet'] } as any).resolveRuntimeFiles(new Set()).files.includes('mjs_adopt_sheet.ts'))
    })
  })
})

describe('scanCompiledFeatures() — le signal "adopt_sheet"', function () {
  this.timeout(30000)

  async function scanOf(src: string, moduleName: string): Promise<Set<string>> {
    const { output, data } = await transpile(src, { moduleName })
    return scanCompiledFeatures(output, data)
  }

  it('µ.adoptSheet(el, feuille) écrit : "adopt_sheet" présent ; composant sans : absent', async () => {
    const avec = await scanOf('<script lang="coffee">\n@go = (el, css) -> µ.adoptSheet(el, css)\n</script>\n<p>y</p>\n', 'as1')
    assert.ok(avec.has('adopt_sheet'))
    const sans = await scanOf('<script lang="coffee">\n@go = (e) -> e.clientX\n</script>\n<p>y</p>\n', 'as2')
    assert.equal(sans.has('adopt_sheet'), false)
  })

  it('µ[\'adoptSheet\'](…) ou { adoptSheet } = µ : "adopt_sheet" présent aussi (jamais de faux négatif)', async () => {
    const crochets = await scanOf('<script lang="coffee">\n@go = (el, css) -> µ[\'adoptSheet\'](el, css)\n</script>\n<p>y</p>\n', 'as3')
    assert.ok(crochets.has('adopt_sheet'))
    const extrait = await scanOf('<script lang="coffee">\n@go = (el, css) ->\n  { adoptSheet } = µ\n  adoptSheet(el, css)\n</script>\n<p>y</p>\n', 'as4')
    assert.ok(extrait.has('adopt_sheet'))
  })

  it('le mot d\'un autre nom (adoptSheetCount, readoptSheets) ne compte pas', async () => {
    const autre = await scanOf('<script lang="coffee">\n@adoptSheetCount = 3\n@go = -> @readoptSheets = 1\n</script>\n<p>{@adoptSheetCount}</p>\n', 'as5')
    assert.equal(autre.has('adopt_sheet'), false)
  })
})
