// `@import` d'un fichier qui existe, mais hors du dossier des sources : le refus dit que le fichier est en dehors des dossiers
// où la construction cherche — il disait « fichier absent du disque », cité « via µasset() », alors que le fichier existe et
// qu'il est cité par `@import` ; un fichier vraiment absent garde le refus « introuvable »
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

// construit `cl.mjs` sous `src/`, avec `dehors.js` posé à côté de `src/` : les messages d'erreur de la construction
async function refus(source: string): Promise<string> {
  const root   = mjsTmp('import-dehors')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(root, 'dehors.js'), 'export const lire = () => 1\n')
  writeFileSync(join(srcDir, 'cl.mjs'), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  await bundler.close()
  return stats.errors.map((e: any) => e.message).join('\n')
}

describe('@import hors des sources : le refus dit la vraie raison', function () {
  this.timeout(120_000)
  after(async () => { await terminateSharedWorkerPool() })

  it('un fichier présent hors de src est refusé comme hors des dossiers, pas comme absent', async () => {
    const message = await refus("@import { lire } '../dehors.js'\n<script>\n$n = lire()\n</script>\n<p>{$n}</p>\n")
    assert.match(message, /'\.\.\/dehors\.js' existe, mais en dehors des dossiers/)
    assert.doesNotMatch(message, /fichier absent/)
  })

  it('un fichier vraiment absent garde le refus « introuvable »', async () => {
    const message = await refus("@import { lire } '../absent.js'\n<script>\n$n = lire()\n</script>\n<p>{$n}</p>\n")
    assert.match(message, /Asset introuvable : '\.\.\/absent\.js'/)
  })
})
