// Test de régression : `resolveMagicAssets` (src/bundler/index.ts) résolvait TOUT `µasset(...)`
// trouvé dans le texte, y compris un appel cité en simple EXEMPLE à l'intérieur d'un gabarit
// compilé en chaîne (`export helpText = \`...µasset('logo.png')...\``, doc/tuto d'un module) —
// le texte affiché sortait donc réécrit avec un chemin haché inventé, au lieu de rester
// verbatim.
//
// Fix : seuls les appels situés dans du CODE (repérés sur une vue masquée — chaînes/gabarits/
// commentaires blanchis, même longueur) sont résolus ; l'argument est relu dans le texte RÉEL.
// La forme à guillemet EXTÉRIEUR (`"µasset('…')"`, émise par le compilateur lui-même pour
// `@import`) reste résolue sans cette garde, comme avant — jamais un texte d'exemple.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

describe('bundler — resolveMagicAssets : un µasset() cité en exemple dans un gabarit reste verbatim', function () {
  this.timeout(15000)
  after(async () => { await terminateSharedWorkerPool() })

  async function setup() {
    const root = mjsTmp('resolve-assets-exemple')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'icon.svg'), '<svg></svg>')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out') })
    mkdirSync(bundler.outputDir, { recursive: true })
    return bundler
  }

  it('un appel RÉEL top-level est résolu (comportement inchangé)', async () => {
    const bundler = await setup()
    const result = await bundler.resolveMagicAssets(`path = µasset('icon.svg')`)
    assert.match(result, /^path = '\/out\/icon-[a-f0-9]{8}\.svg'$/, result)
    await bundler.close()
  })

  it('un µasset(...) cité DANS un gabarit multiligne (texte de doc exporté) n\'est PAS résolu', async () => {
    const bundler = await setup()
    const source = [
      'export const helpText = `',
      'Pour référencer une icône : µasset(\'icon.svg\')',
      '`',
    ].join('\n')
    const result = await bundler.resolveMagicAssets(source)
    assert.equal(result, source, 'le texte du gabarit doit sortir strictement inchangé')
    await bundler.close()
  })

  it('un appel réel ET un exemple dans un gabarit, dans le MÊME texte : seul le réel change', async () => {
    const bundler = await setup()
    const source = [
      'export const aide = `voir µasset(\'fantome.png\')`',
      'const reel = µasset(\'icon.svg\')',
    ].join('\n')
    const result = await bundler.resolveMagicAssets(source)
    assert.match(result, /aide = `voir µasset\('fantome\.png'\)`/, 'le texte du gabarit reste verbatim')
    assert.match(result, /reel = '\/out\/icon-[a-f0-9]{8}\.svg'/, 'le VRAI appel doit être résolu')
    await bundler.close()
  })

  it('la forme à guillemet extérieur ("µasset(\'…\')"), émise par le compilateur, reste résolue', async () => {
    const bundler = await setup()
    const result = await bundler.resolveMagicAssets(`x = "µasset('icon.svg')"`)
    assert.doesNotMatch(result, /µasset\(/, 'la forme à guillemet extérieur doit toujours se résoudre, comme avant ce correctif')
    await bundler.close()
  })
})
