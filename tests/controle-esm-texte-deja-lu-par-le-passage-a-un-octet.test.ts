// Le passage à un octet (cf. one-byte.ts) lit avec acorn le texte d'un fichier JS de production qui porte un caractère au-delà de U+00FF,
// en module d'abord, et relit le texte qu'il rend quand il l'a réécrit. Quand le texte écrit est celui qu'il a lu en module, avec les
// options du contrôle ESM (ecmaVersion 'latest', sourceType 'module' ; ses autres options ne changent rien à ce qui est accepté en
// module), le contrôle ne le relit pas : une analyse de ce texte au lieu de deux. Lu en script seulement, ou pas lu du tout, il est relu.

import assert from 'node:assert/strict'
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { oneByteSource } from '../src/bundler/one-byte.js'

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
  const outDir = join(root, 'out')
  mkdirSync(join(root, 'src'), { recursive: true })
  mkdirSync(outDir, { recursive: true })
  return { outDir, bundler: new Bundler({ sourceDir: join(root, 'src'), outputDir: outDir, manifestPath: join(root, 'bundle.js'), env: 'prod' }) }
}

// assez long pour que l'échappement reste sous le plafond de poids du passage à un octet (2 %)
const LONG = 'x'.repeat(400)

describe('contrôle ESM : un texte déjà lu en module par le passage à un octet n\'est pas relu', function () {
  this.timeout(30000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('texte réécrit par le passage puis relu par lui en module : le contrôle ESM ne l\'analyse pas une seconde fois', function () {
    const code                = `export const a = "l’été";\nexport const b = "${LONG}";\n`
    const { outDir, bundler } = prodBundler('esm-un-octet-lu')
    const seen                = watchEsmCheck(bundler)
    bundler.writeHashed('lu', '.js', code)
    const written = readFileSync(join(outDir, readdirSync(outDir).find(f => f.startsWith('lu-'))!), 'utf-8')
    assert.ok(written.includes('\\u2019'), written)
    assert.deepEqual(seen, [], 'le texte écrit, déjà lu en module par le passage à un octet, est analysé une seconde fois')
    assert.equal(oneByteSource(code).readAsModule, true)
  })

  it('texte lu en script seulement : relu, et le contrôle lève toujours `[bundler/esm-check]`', function () {
    const code        = `with ({}) { var a = "l’été" }\nvar b = "${LONG}"\n`
    const { bundler } = prodBundler('esm-un-octet-script')
    assert.notEqual(oneByteSource(code).readAsModule, true)
    assert.throws(() => bundler.writeHashed('script', '.js', code), /\[bundler\/esm-check\]/)
  })

  it('texte sans caractère large, que le passage ne lit pas : relu', function () {
    const { bundler } = prodBundler('esm-un-octet-etroit')
    const seen        = watchEsmCheck(bundler)
    bundler.writeHashed('etroit', '.js', 'export const a = 1;\n')
    assert.deepEqual(seen, ['etroit.js'])
  })
})
