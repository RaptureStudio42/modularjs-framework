// Gabarit imbriqué sur des milliers de niveaux (balises dans des balises, `{if}` dans des `{if}`) :
// l'analyse et la génération descendent d'un appel par niveau, la pile d'appels finit par déborder
// et la construction s'arrêtait sur « RangeError: Maximum call stack size exceeded », sans dire où.
// Le message doit désormais nommer le problème et donner la ligne ; le fichier est cité par le
// constructeur, comme pour toute erreur de composant.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from '../src/parser/index.js'
import { compile } from '../src/generator/index.js'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const balises = (n: number): string => '<p>a</p>\n' + '<div>\n'.repeat(n) + 'x' + '</div>'.repeat(n)
const blocs = (n: number): string => '{if $a}\n'.repeat(n) + 'x' + '{end}'.repeat(n)

const messageClair = (e: any): boolean => {
  assert.ok(!(e instanceof RangeError), 'pas de RangeError brute : ' + e?.message)
  assert.match(e.message, /imbrication trop profonde/i)
  assert.match(e.message, /ligne \d+/)
  return true
}

describe('imbrication trop profonde : message clair, avec la ligne', function () {
  this.timeout(120000)

  it('analyse : 20 000 balises imbriquées', () => {
    assert.throws(() => parse(balises(20000), []), messageClair)
  })

  it('génération : 1 500 `{if}` imbriqués (l\'analyse passe, la génération déborde)', () => {
    assert.doesNotThrow(() => parse(blocs(1500), []))
    assert.throws(() => compile(blocs(1500), {}), messageClair)
  })

  it('une imbrication ordinaire se construit toujours', () => {
    assert.doesNotThrow(() => compile(blocs(50), {}))
    assert.doesNotThrow(() => parse(balises(500), []))
  })

  it('construction d\'un projet : le fichier ET la ligne sont cités', async () => {
    const root = mjsTmp('imbrication')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'tres-profond.mjs'), '<script>\n$a = 1\n</script>\n' + blocs(1500))
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
    let message = ''
    let app: any
    try {
      app = await createHarness({ root })
    }
    catch (e: any) {
      message = String(e?.message ?? e)
    }
    finally {
      if (app) await app.destroy()
    }
    assert.match(message, /tres-profond\.mjs/)
    assert.match(message, /imbrication trop profonde/i)
    assert.match(message, /ligne \d+/)
  })
})
