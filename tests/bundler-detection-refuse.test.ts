// mjs_refuse.ts (µ._mjs_refuse, µ._mjs_refuseRetablir : champ nombre lié dont la saisie est refusée),
// détaché de mjs_init.ts : seul le gestionnaire de saisie d'un champ `value=!{$x}` dont le type peut être
// `number` l'appelle (generator/attributes/index.ts). Absent d'un build qui n'écrit aucun champ de ce genre,
// présent et fonctionnel sinon ; faits inconnus (API directe) : gardé.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const MARK = 'µ._mjs_refuse = function'

async function construire(nom: string, conf: any, source: string): Promise<{ sortie: string }> {
  const root = mjsTmp('detect-refuse-' + nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hote.mjs'), source + '\n')
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), ...conf } as any)
  const stats = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  // tout le JavaScript émis : le cœur (construction découpée) comme le fichier unique (`js: 'bundle'`)
  const fichiers = readdirSync(outDir).filter((f) => f.endsWith('.js')).map((f) => join(outDir, f))
  fichiers.push(join(root, 'bundle.js'))
  const sortie = fichiers.map((f) => { try { return readFileSync(f, 'utf-8') } catch { return '' } }).join('\n')
  return { sortie }
}

const NOMBRE   = '<script>\n$n = 0\n</script>\n<input type="number" value=!{$n}>'
const TEXTE    = '<script>\n$s = \'\'\n</script>\n<input type="text" value=!{$s}>'
const DYNAMIQUE = '<script>\n$t = \'number\'\n$n = 0\n</script>\n<input type={$t} value=!{$n}>'
const CASE     = '<script>\n$ok = false\n</script>\n<input type="checkbox" checked=!{$ok}>'

describe('mjs_refuse.ts — détaché du cœur, build RÉEL', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('composant sans champ lié : ABSENT', async () => {
    const { sortie } = await construire('nu', { runtime: 'core' }, '<p>x</p>')
    assert.equal(sortie.includes(MARK), false)
  })

  it('champ texte lié (type fixe, pas number) : ABSENT', async () => {
    const { sortie } = await construire('texte', { runtime: 'core' }, TEXTE)
    assert.equal(sortie.includes(MARK), false)
  })

  it('case à cocher liée : ABSENT', async () => {
    const { sortie } = await construire('case', { runtime: 'core' }, CASE)
    assert.equal(sortie.includes(MARK), false)
  })

  it('champ nombre lié : PRÉSENT (découpé et en un fichier)', async () => {
    for (const js of [undefined, 'bundle']) {
      const { sortie } = await construire('nombre-' + js, { runtime: 'core', js }, NOMBRE)
      assert.ok(sortie.includes(MARK), 'js: ' + js)
      assert.ok(sortie.includes('µ._mjs_refuseRetablir = function'), 'js: ' + js)
    }
  })

  it('champ dont le type est une variable : PRÉSENT (il peut valoir number)', async () => {
    const { sortie } = await construire('dynamique', { runtime: 'core' }, DYNAMIQUE)
    assert.ok(sortie.includes(MARK))
  })

  it('runtime: [\'refuse\'] : PRÉSENT sans champ qui l\'écrive', async () => {
    const { sortie } = await construire('force', { runtime: ['refuse'] }, '<p>x</p>')
    assert.ok(sortie.includes(MARK))
  })

  it('runtime non précisé (tous les modules) : PRÉSENT avec un champ nombre, découpé comme en un fichier ; ABSENT sans', async () => {
    for (const js of [undefined, 'bundle']) {
      const avec = await construire('tous-nombre-' + js, { js }, NOMBRE)
      assert.ok(avec.sortie.includes(MARK), 'js: ' + js)
      const sans = await construire('tous-nu-' + js, { js }, TEXTE)
      assert.equal(sans.sortie.includes(MARK), false, 'js: ' + js)
    }
  })

  describe('API directe (resolveRuntimeFiles)', () => {
    it('faits inconnus : gardé', () => {
      assert.ok(new Bundler({ runtime: 'core' } as any).resolveRuntimeFiles().files.includes('mjs_refuse.ts'))
    })

    it('faits connus sans signal : absent, en core comme en all', () => {
      for (const runtime of ['core', 'all']) {
        assert.equal(new Bundler({ runtime } as any).resolveRuntimeFiles(new Set()).files.includes('mjs_refuse.ts'), false, runtime)
      }
    })

    it('le signal refuse le rend, en core comme en all ; il est dans le cœur de l\'API directe en all', () => {
      for (const runtime of ['core', 'all']) {
        assert.ok(new Bundler({ runtime } as any).resolveRuntimeFiles(new Set(['refuse'])).files.includes('mjs_refuse.ts'), runtime)
      }
      assert.ok(new Bundler({ runtime: 'all' } as any).resolveRuntimeFiles().files.includes('mjs_refuse.ts'))
    })
  })
})
