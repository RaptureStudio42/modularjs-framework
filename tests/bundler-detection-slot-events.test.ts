// mjs_slot_events.ts (µ.Element.prototype._mjs_slotEntry et _mjs_slotOf : clic et survol du contenu glissé
// dans un composant), détaché de mjs_element.ts : seul un composant dont le gabarit écrit un `<slot>` peut
// recevoir du contenu glissé, donc voir arriver un événement né hors de son arbre. Absent d'un build où
// aucun gabarit n'écrit de `<slot>`, présent et fonctionnel sinon ; faits inconnus (API directe) : gardé.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const MARK = 'µ.Element.prototype._mjs_slotEntry = function'

async function construire(nom: string, conf: any, source: string): Promise<{ sortie: string }> {
  const root = mjsTmp('detect-slot-events-' + nom)
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

const AVEC_SLOT = '<script>\n$n = 0\n</script>\n<div aria-label="a" role="button" tabindex="0" @click={$n++}><slot></slot></div>'
const SANS_SLOT = '<script>\n$n = 0\n</script>\n<div aria-label="a" role="button" tabindex="0" @click={$n++}>{$n}</div>'

describe('mjs_slot_events.ts — détaché du cœur, build RÉEL', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('composant sans <slot> : ABSENT', async () => {
    const { sortie } = await construire('nu', { runtime: 'core' }, SANS_SLOT)
    assert.equal(sortie.includes(MARK), false)
    assert.equal(sortie.includes('µ.Element.prototype._mjs_slotOf = function'), false)
  })

  it('composant qui écrit un <slot> : PRÉSENT, découpé comme en un fichier', async () => {
    for (const js of [undefined, 'bundle']) {
      const { sortie } = await construire('slot-' + js, { runtime: 'core', js }, AVEC_SLOT)
      assert.ok(sortie.includes(MARK), 'js: ' + js)
      assert.ok(sortie.includes('µ.Element.prototype._mjs_slotOf = function'), 'js: ' + js)
    }
  })

  it('runtime: [\'slot_events\'] : PRÉSENT sans <slot> écrit', async () => {
    const { sortie } = await construire('force', { runtime: ['slot_events'] }, SANS_SLOT)
    assert.ok(sortie.includes(MARK))
  })

  it('runtime non précisé (tous les modules) : PRÉSENT avec un <slot>, découpé comme en un fichier ; ABSENT sans', async () => {
    for (const js of [undefined, 'bundle']) {
      const avec = await construire('tous-slot-' + js, { js }, AVEC_SLOT)
      assert.ok(avec.sortie.includes(MARK), 'js: ' + js)
      const sans = await construire('tous-nu-' + js, { js }, SANS_SLOT)
      assert.equal(sans.sortie.includes(MARK), false, 'js: ' + js)
    }
  })

  describe('API directe (resolveRuntimeFiles)', () => {
    it('faits inconnus : gardé', () => {
      assert.ok(new Bundler({ runtime: 'core' } as any).resolveRuntimeFiles().files.includes('mjs_slot_events.ts'))
    })

    it('faits connus sans signal : absent, en core comme en all', () => {
      for (const runtime of ['core', 'all']) {
        assert.equal(new Bundler({ runtime } as any).resolveRuntimeFiles(new Set()).files.includes('mjs_slot_events.ts'), false, runtime)
      }
    })

    it('le signal slot_events le rend, en core comme en all ; il suit mjs_element.ts', () => {
      for (const runtime of ['core', 'all']) {
        const { files } = new Bundler({ runtime } as any).resolveRuntimeFiles(new Set(['slot_events']))
        assert.ok(files.includes('mjs_slot_events.ts'), runtime)
        assert.ok(files.indexOf('mjs_slot_events.ts') > files.indexOf('mjs_element.ts'), runtime)
      }
    })
  })
})
