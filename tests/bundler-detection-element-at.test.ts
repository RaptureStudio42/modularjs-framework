// mjs_element_at.ts (µ.elementAt et µ._mjs_elementAt : l'élément le plus profond sous un point de la fenêtre),
// détaché de mjs_element.ts : seuls le code d'un projet qui écrit `µ.elementAt(` et les trois effets en direct
// qui s'en servent (*follow, *heatmap, *cursors) l'appellent. Absent d'un build qui n'a aucun des quatre,
// présent et fonctionnel sinon ; faits inconnus (API directe) : gardé.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const MARK = 'µ._mjs_elementAt = function'

async function construire(nom: string, conf: any, source: string): Promise<{ sortie: string }> {
  const root = mjsTmp('detect-element-at-' + nom)
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

const ECRIT   = '<script>\n$n = 0\n</script>\n<p aria-label="a" role="button" tabindex="0" @click={µ.elementAt(e.clientX, e.clientY)}>{$n}</p>'
const SANS    = '<script>\n$n = 0\n</script>\n<p>{$n}</p>'
// les effets en direct prennent leur connexion dans `@sock`
const SOCK    = '<script>\n@sock = µsocket \'wss://x.fr/ws\'\n</script>\n'
const EFFETS: Record<string, string> = {
  follow:  SOCK + '<div *follow(lead: true, cursor: none, selection: false, focus: false)><p>x</p></div>',
  cursors: SOCK + '<div *cursors(cursor: normal, selection: false, focus: false)><p>x</p></div>',
  heatmap: SOCK + '<@document *heatmap></@document>\n<p>x</p>'
}

describe('mjs_element_at.ts — détaché du cœur, build RÉEL', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('aucun appel : ABSENT (ni µ.elementAt ni µ._mjs_elementAt)', async () => {
    const { sortie } = await construire('nu', { runtime: 'core' }, SANS)
    assert.equal(sortie.includes(MARK), false)
    assert.equal(sortie.includes('µ.elementAt = function'), false)
  })

  it('composant qui écrit µ.elementAt(…) : PRÉSENT, découpé comme en un fichier', async () => {
    for (const js of [undefined, 'bundle']) {
      const { sortie } = await construire('ecrit-' + js, { runtime: 'core', js }, ECRIT)
      assert.ok(sortie.includes(MARK), 'js: ' + js)
      assert.ok(sortie.includes('µ.elementAt = function'), 'js: ' + js)
    }
  })

  for (const [effet, source] of Object.entries(EFFETS)) {
    it(`*${effet} écrit : PRÉSENT, découpé comme en un fichier (le fichier de l'effet l'appelle)`, async () => {
      for (const js of [undefined, 'bundle']) {
        const { sortie } = await construire(effet + '-' + js, { runtime: 'core', js }, source)
        assert.ok(sortie.includes(MARK), 'js: ' + js)
      }
    })
  }

  it('runtime: [\'element_at\'] : PRÉSENT sans appel écrit', async () => {
    const { sortie } = await construire('force', { runtime: ['element_at'] }, SANS)
    assert.ok(sortie.includes(MARK))
  })

  it('runtime non précisé (tous les modules) : PRÉSENT avec un appel, découpé comme en un fichier ; ABSENT sans', async () => {
    for (const js of [undefined, 'bundle']) {
      const avec = await construire('tous-ecrit-' + js, { js }, ECRIT)
      assert.ok(avec.sortie.includes(MARK), 'js: ' + js)
      const sans = await construire('tous-nu-' + js, { js }, SANS)
      assert.equal(sans.sortie.includes(MARK), false, 'js: ' + js)
    }
  })

  describe('API directe (resolveRuntimeFiles)', () => {
    it('faits inconnus : gardé', () => {
      assert.ok(new Bundler({ runtime: 'core' } as any).resolveRuntimeFiles().files.includes('mjs_element_at.ts'))
    })

    it('faits connus sans signal : absent, en core comme en all', () => {
      for (const runtime of ['core', 'all']) {
        assert.equal(new Bundler({ runtime } as any).resolveRuntimeFiles(new Set()).files.includes('mjs_element_at.ts'), false, runtime)
      }
    })

    for (const signal of ['element_at', 'fx_follow', 'fx_heatmap', 'fx_cursors']) {
      it(`le signal ${signal} le rend, en core comme en all`, () => {
        for (const runtime of ['core', 'all']) {
          assert.ok(new Bundler({ runtime } as any).resolveRuntimeFiles(new Set([signal])).files.includes('mjs_element_at.ts'), runtime)
        }
      })
    }

    for (const effet of ['fx_follow', 'fx_heatmap', 'fx_cursors']) {
      it(`${effet} demandé par la configuration (runtime: ['${effet}']) le rend`, () => {
        assert.ok(new Bundler({ runtime: [effet] } as any).resolveRuntimeFiles(new Set()).files.includes('mjs_element_at.ts'))
      })
    }
  })
})
