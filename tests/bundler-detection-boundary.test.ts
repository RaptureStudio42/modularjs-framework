// mjs_boundary.ts (µ.Element.prototype._mjs_boundaryEvents et _mjs_routeBoundary : entrée et sortie de survol
// `@pointerenter`/`@pointerleave`/`@mouseenter`/`@mouseleave`), détaché de mjs_element.ts : seul un gabarit qui
// écrit l'un de ces quatre événements en a besoin (le routeur y est branché par le gabarit compilé). Absent d'un
// build qui n'en écrit aucun, présent et fonctionnel sinon ; faits inconnus (API directe) : gardé. Un composant
// monté SANS la brique ne lève rien : l'événement passe par le routeur ordinaire, comme un événement fabriqué.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const MARK = 'µ.Element.prototype._mjs_routeBoundary = function'

async function construire(nom: string, conf: any, source: string): Promise<{ sortie: string; outDir: string }> {
  const root = mjsTmp('detect-boundary-' + nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hote.mjs'), source + '\n')
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), ...conf } as any)
  const stats = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  // tout le JavaScript émis : le cœur (construction découpée) comme le fichier unique (`js: 'bundle'`)
  const fichiers = readdirSync(outDir).filter((f) => f.endsWith('.js')).map((f) => join(outDir, f))
  fichiers.push(join(root, 'bundle.js'))
  const sortie = fichiers.map((f) => { try { return readFileSync(f, 'utf-8') } catch { return '' } }).join('\n')
  return { sortie, outDir }
}

const AVEC_SURVOL = '<script>\n$n = 0\n</script>\n<div class="z" aria-label="a" role="button" tabindex="0" @mouseenter={$n++} @click={$n++}>{$n}</div>'
const SANS_SURVOL = '<script>\n$n = 0\n</script>\n<div class="z" aria-label="a" role="button" tabindex="0" @click={$n++}>{$n}</div>'

describe('mjs_boundary.ts — détaché du cœur, build RÉEL', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('composant sans événement de survol : ABSENT', async () => {
    const { sortie } = await construire('nu', { runtime: 'core' }, SANS_SURVOL)
    assert.equal(sortie.includes(MARK), false)
    assert.equal(sortie.includes('_mjs_boundaryEvents ='), false)
  })

  it('composant qui écrit @mouseenter : PRÉSENT, découpé comme en un fichier', async () => {
    for (const js of [undefined, 'bundle']) {
      const { sortie } = await construire('survol-' + js, { runtime: 'core', js }, AVEC_SURVOL)
      assert.ok(sortie.includes(MARK), 'js: ' + js)
      assert.ok(sortie.includes('_mjs_boundaryEvents ='), 'js: ' + js)
    }
  })

  it('runtime: [\'boundary\'] : PRÉSENT sans événement de survol écrit', async () => {
    const { sortie } = await construire('force', { runtime: ['boundary'] }, SANS_SURVOL)
    assert.ok(sortie.includes(MARK))
  })

  it('runtime non précisé (tous les modules) : PRÉSENT avec un événement de survol, découpé comme en un fichier ; ABSENT sans', async () => {
    for (const js of [undefined, 'bundle']) {
      const avec = await construire('tous-survol-' + js, { js }, AVEC_SURVOL)
      assert.ok(avec.sortie.includes(MARK), 'js: ' + js)
      const sans = await construire('tous-nu-' + js, { js }, SANS_SURVOL)
      assert.equal(sans.sortie.includes(MARK), false, 'js: ' + js)
    }
  })

  it('composant monté SANS la brique : rien ne lève, un événement fabriqué atteint le gestionnaire', async () => {
    // le cœur d'un build sans événement de survol (sans la brique) et le composant d'un build qui en écrit
    const sans = (await construire('sans-brique-coeur', { runtime: 'core' }, SANS_SURVOL)).outDir
    const avec = (await construire('sans-brique-hote', { runtime: 'core' }, AVEC_SURVOL)).outDir
    const coeur = readdirSync(sans).filter((f) => f.endsWith('.js') && f.startsWith('mjs_')).map((f) => join(sans, f))
    const fichiersHote = readdirSync(avec).filter((f) => f.endsWith('.js') && !f.startsWith('mjs_')).map((f) => join(avec, f))
    const code = [...coeur, ...fichiersHote].map((f) => stripEsm(readFileSync(f, 'utf-8'))).join('\n')
    assert.equal(code.includes(MARK), false)
    const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
    const erreurs: string[] = []
    window.addEventListener('error', (e: any) => erreurs.push(String(e.message || e.error)))
    window.eval(`${code}\nglobalThis.µ = µ;`)
    window.document.body.innerHTML = '<mjs-hote></mjs-hote>'
    const hote = window.document.querySelector('mjs-hote')
    const fin = Date.now() + 3000
    while (!hote._shadow && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
    await new Promise((r) => setTimeout(r, 120))
    assert.ok(hote._shadow, 'composant monté')
    hote._shadow.querySelector('.z').dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: true, composed: true }))
    await new Promise((r) => setTimeout(r, 60))
    assert.equal(erreurs.length, 0, erreurs.join('\n'))
    assert.equal(hote._shadow.querySelector('.z').textContent.trim(), '1')
  })

  describe('API directe (resolveRuntimeFiles)', () => {
    it('faits inconnus : gardé', () => {
      assert.ok(new Bundler({ runtime: 'core' } as any).resolveRuntimeFiles().files.includes('mjs_boundary.ts'))
    })

    it('faits connus sans signal : absent, en core comme en all', () => {
      for (const runtime of ['core', 'all']) {
        assert.equal(new Bundler({ runtime } as any).resolveRuntimeFiles(new Set()).files.includes('mjs_boundary.ts'), false, runtime)
      }
    })

    it('le signal boundary le rend, en core comme en all ; il suit mjs_element.ts', () => {
      for (const runtime of ['core', 'all']) {
        const { files } = new Bundler({ runtime } as any).resolveRuntimeFiles(new Set(['boundary']))
        assert.ok(files.includes('mjs_boundary.ts'), runtime)
        assert.ok(files.indexOf('mjs_boundary.ts') > files.indexOf('mjs_element.ts'), runtime)
      }
    })
  })
})
