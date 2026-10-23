// mjs_clone.ts (µ.clone, la rune µclone : copier un composant avec son état), hors du cœur : seul le code d'un projet qui écrit `clone` l'appelle.
// Absent d'un build qui ne l'écrit pas, À L'OCTET PRÈS (la sortie est celle d'un runtime qui n'a jamais eu le fichier), présent sinon — rune
// Civet, forme JavaScript `µ.clone(`, sigil ASCII `mjs.clone` ; faits inconnus (API directe) : gardé. Un nom fabriqué à l'exécution
// (`µ['clo' + 'ne']`), que la construction ne voit pas, se demande par `runtime: ['clone']`.

import assert from 'node:assert/strict'
import { cpSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transpile } from '../src/transpiler/index.js'
import { scanCompiledFeatures } from '../src/bundler/features.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const ICI  = dirname(fileURLToPath(import.meta.url))
const MARK = 'µ.clone = function'

// le même dossier runtime que le framework, privé du fichier de la rune : le runtime d'avant la rune
function runtimeSansRune(): string {
  const dir = join(mjsTmp('clone-runtime'), 'runtime')
  cpSync(join(ICI, '..', 'src', 'runtime'), dir, { recursive: true, filter: (s) => !s.endsWith('mjs_clone.ts') })
  assert.equal(existsSync(join(dir, 'mjs_clone.ts')), false)
  return dir
}

type Sortie = { texte: string, fichiers: Map<string, string> }

async function construire(nom: string, conf: any, source: string): Promise<Sortie> {
  const root   = mjsTmp('detect-clone-' + nom)
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
  return { texte: [...fichiers.values()].join('\n'), fichiers }
}

const RUNE   = '<script>\n@copier = (el) -> µclone el\n</script>\n<p>x</p>'
const JS     = '<script lang="js">\nthis.copier = (el) => µ.clone(el);\n</script>\n<p>x</p>'
const SANS   = '<script>\n$n = 0\n@copie = (el) -> el.cloneNode(true)\n@double = (o) -> structuredClone(o)\n</script>\n<p>{$n}</p>'

describe('mjs_clone.ts — hors du cœur, build RÉEL', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  it('aucun appel (cloneNode, structuredClone écrits) : ABSENT', async () => {
    for (const runtime of ['core', 'all', undefined]) {
      const { texte } = await construire('nu-' + runtime, { runtime }, SANS)
      assert.equal(texte.includes(MARK), false, 'runtime: ' + runtime)
    }
  })

  it('rune µclone (Civet) ou µ.clone(…) (JavaScript) écrite : PRÉSENT, découpé comme en un fichier', async () => {
    for (const [forme, source] of [['rune', RUNE], ['js', JS]]) {
      for (const js of [undefined, 'bundle']) {
        for (const runtime of ['core', 'all', undefined]) {
          const { texte } = await construire(forme + '-' + js + '-' + runtime, { runtime, js }, source)
          assert.ok(texte.includes(MARK), forme + ', js: ' + js + ', runtime: ' + runtime)
        }
      }
    }
  })

  it('sigil ASCII (`"sigil": "mjs"`) : mjs.clone(…) écrit : PRÉSENT', async () => {
    const { texte } = await construire('sigil', { runtime: 'core', sigil: 'mjs' }, '<script>\n@copier = (el) -> mjs.clone(el)\n</script>\n<p>x</p>')
    assert.ok(texte.includes(MARK))
  })

  it('runtime: [\'clone\'] : PRÉSENT sans appel écrit (un nom fabriqué à l\'exécution, que la construction ne voit pas)', async () => {
    const { texte } = await construire('force', { runtime: ['clone'] }, SANS)
    assert.ok(texte.includes(MARK))
  })

  it('sans appel, la sortie est identique à l\'octet à celle d\'un runtime qui n\'a pas le fichier, en développement comme en production', async () => {
    const dir = runtimeSansRune()
    for (const conf of [{ runtime: 'core' }, { runtime: 'all' }, {}, { js: 'bundle' }, { env: 'dev' }, { env: 'prod' }, { env: 'prod', js: 'bundle' }]) {
      const avec = await construire('octet-avec', conf, SANS)
      const sans = await construire('octet-sans', { ...conf, runtimeDir: dir }, SANS)
      assert.deepEqual([...avec.fichiers.keys()].sort(), [...sans.fichiers.keys()].sort(), 'mêmes fichiers (noms hachés compris) : ' + JSON.stringify(conf))
      for (const [nom, texte] of avec.fichiers) assert.equal(texte, sans.fichiers.get(nom), nom + ' : ' + JSON.stringify(conf))
    }
  })

  describe('API directe (resolveRuntimeFiles)', () => {
    it('faits inconnus : gardé', () => {
      assert.ok(new Bundler({ runtime: 'core' } as any).resolveRuntimeFiles().files.includes('mjs_clone.ts'))
    })

    it('faits connus sans signal : absent, en core comme en all', () => {
      for (const runtime of ['core', 'all']) {
        assert.equal(new Bundler({ runtime } as any).resolveRuntimeFiles(new Set()).files.includes('mjs_clone.ts'), false, runtime)
      }
    })

    it('le signal clone le rend, en core comme en all', () => {
      for (const runtime of ['core', 'all']) {
        assert.ok(new Bundler({ runtime } as any).resolveRuntimeFiles(new Set(['clone'])).files.includes('mjs_clone.ts'), runtime)
      }
    })

    it('demandé par la configuration (runtime: [\'clone\']) : rendu sans signal', () => {
      assert.ok(new Bundler({ runtime: ['clone'] } as any).resolveRuntimeFiles(new Set()).files.includes('mjs_clone.ts'))
    })
  })
})

describe('scanCompiledFeatures() — le signal "clone"', function () {
  this.timeout(30000)

  async function scanOf(src: string, moduleName: string): Promise<Set<string>> {
    const { output, data } = await transpile(src, { moduleName })
    return scanCompiledFeatures(output, data)
  }

  it('µclone el, µ.clone(el), µ[\'clone\'](el), { clone } = µ : "clone" présent (jamais de faux négatif)', async () => {
    const sources = [
      '<script>\n@go = (el) -> µclone el\n</script>\n<p>y</p>\n',
      '<script lang="coffee">\n@go = (el) -> µ.clone(el)\n</script>\n<p>y</p>\n',
      '<script lang="coffee">\n@go = (el) -> µ[\'clone\'](el)\n</script>\n<p>y</p>\n',
      '<script lang="coffee">\n@go = (el) ->\n  { clone } = µ\n  clone(el)\n</script>\n<p>y</p>\n',
      '<script>\n$n = 0\n</script>\n<button @click={@@_shadow.append(µclone @@_shadow.querySelector(\'p\'))}>+</button>\n<p>y</p>\n'
    ]
    for (const [i, src] of sources.entries()) assert.ok((await scanOf(src, 'cl' + i)).has('clone'), src)
  })

  it('cloneNode, structuredClone, un mot qui contient clone (cloneable, reclone) : "clone" absent', async () => {
    const autre = await scanOf('<script lang="coffee">\n@cloneable = 3\n@go = (el) -> el.cloneNode(true)\n@d = (o) -> structuredClone(o)\n@r = -> @reclone = 1\n</script>\n<p>{@cloneable}</p>\n', 'cl9')
    assert.equal(autre.has('clone'), false)
  })
})
