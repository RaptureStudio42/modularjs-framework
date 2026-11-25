// Le garde-fou ESM (`[bundler/esm-check]`, cf. bundler-esm-check.test.ts) relit par acorn chaque JS écrit. Un texte qu'esbuild vient de
// rendre et que rien n'a retouché depuis n'est plus relu : writeHashed() reçoit ce texte en témoin et ne saute le contrôle que s'il écrit
// exactement ce texte-là. Un texte retouché après esbuild (repères remplacés dans un composant, échappements du passage à un octet)
// n'est plus son propre témoin : il est relu, sauf quand le passage à un octet vient de le lire lui-même en module (cf.
// controle-esm-texte-deja-lu-par-le-passage-a-un-octet.test.ts). Un composant n'a jamais de témoin : esbuild laisse passer une expression régulière invalide (`/a{2,1}/`) que le navigateur refuse
// (dans le script d'un composant, l'analyse du compilateur l'arrête déjà, le contrôle ESM reste le filet de ce qu'elle ne lit pas).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

// les fichiers relus par le contrôle ESM de ce bundler, dans l'ordre
function watchEsmCheck(bundler: Bundler): string[] {
  const seen: string[] = []
  const check          = (bundler as any).assertValidEsm.bind(bundler)
  ;(bundler as any).assertValidEsm = (content: string, filename: string) => {
    seen.push(filename)
    return check(content, filename)
  }
  return seen
}

function prodBundler(prefix: string) {
  const root   = mjsTmp(prefix)
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  mkdirSync(join(root, 'out'), { recursive: true })
  return { srcDir, bundler: new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js'), env: 'prod' }) }
}

describe('contrôle ESM : un texte rendu par esbuild et écrit tel quel n\'est pas relu', function () {
  this.timeout(30000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('writeHashed : le texte d\'esbuild écrit à l\'identique n\'est pas relu ; un texte retouché ou sans témoin, si', function () {
    const { bundler } = prodBundler('esm-temoin')
    const seen        = watchEsmCheck(bundler)
    const code        = 'export const a = 1;\n'
    bundler.writeHashed('tel-quel', '.js', code, undefined, code)
    bundler.writeHashed('retouche', '.js', code + 'export const b = 2;\n', undefined, code)
    bundler.writeHashed('sans-temoin', '.js', code)
    assert.deepEqual(seen, ['retouche.js', 'sans-temoin.js'])
  })

  it('writeHashed : un texte invalide qui n\'est pas celui d\'esbuild lève toujours `[bundler/esm-check]`', function () {
    const { bundler } = prodBundler('esm-temoin-invalide')
    assert.throws(() => bundler.writeHashed('probe', '.js', 'const a = foo())\n', undefined, 'const a = foo()\n'), /\[bundler\/esm-check\]/)
  })

  it('production : un texte d\'esbuild réécrit par le passage à un octet n\'est plus son propre témoin ; lu en script seulement, il est relu', function () {
    const { bundler } = prodBundler('esm-temoin-un-octet')
    const seen        = watchEsmCheck(bundler)
    // assez long pour que l'échappement reste sous le plafond de poids du passage à un octet (2 %) ; `with` : lisible en script seulement
    const code        = 'var a = "l’été";\nwith ({}) {}\nvar b = "' + 'x'.repeat(400) + '";\n'
    assert.throws(() => bundler.writeHashed('large', '.js', code, undefined, code), /\[bundler\/esm-check\]/)
    assert.deepEqual(seen, ['large.js'])
  })

  it('construction de production : le cœur sorti d\'esbuild n\'est pas relu, chaque composant l\'est (repères remplacés)', async function () {
    const { srcDir, bundler } = prodBundler('esm-temoin-construction')
    writeFileSync(join(srcDir, 'carte-a.mjs'), '<script>\n$n = 1\n</script>\n<p>{$n}</p>\n')
    writeFileSync(join(srcDir, 'carte-b.mjs'), '<script>\n$m = 2\n</script>\n<p>{$m}</p>\n')
    const seen  = watchEsmCheck(bundler)
    const stats = await bundler.compile()
    await bundler.close()
    assert.deepEqual(stats.errors, [])
    assert.ok(seen.includes('carte-a.js') && seen.includes('carte-b.js'), seen.join(', '))
    assert.ok(!seen.includes('mjs_core.js'), seen.join(', '))
  })

  it('construction de production : une expression régulière invalide dans un composant arrête toujours la construction', async function () {
    const { srcDir, bundler } = prodBundler('esm-temoin-regex')
    writeFileSync(join(srcDir, 'regle.mjs'), '<script>\n$ok = /a{2,1}/.test("aa")\n</script>\n<p>{$ok}</p>\n')
    const stats = await bundler.compile()
    await bundler.close()
    assert.ok(stats.errors.length > 0, 'construction verte malgré /a{2,1}/, que le navigateur refuse')
  })
})
