// Un composant sous `@i18n`, ou dont le script appelle µimport, garde sa carte de source : avant, la zone du
// script était repérée dans le fichier produit par son texte d'avant ces réécritures (clés préfixées, appel
// µimport réécrit), le texte n'était plus retrouvé et la carte était abandonnée sans un mot.

import assert from 'node:assert/strict'
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping'
import { transpile } from '../src/transpiler/index.js'

// ligne (1 = première) et colonne du premier `needle` dans `text`
function position(text: string, needle: string): { line: number, column: number } {
  const idx = text.indexOf(needle)
  assert.ok(idx >= 0, `« ${needle} » introuvable`)
  const avant = text.slice(0, idx)
  return { line: avant.split('\n').length, column: idx - (avant.lastIndexOf('\n') + 1) }
}

describe('carte de source — composant sous @i18n ou avec µimport', function () {
  this.timeout(30000)

  it('témoin sans @i18n : carte présente', async () => {
    const r = await transpile("<script>\n$a = µt('titre')\n$b = 2\n</script>\n<p>{$a}{$b}</p>", { moduleName: 'carte' })
    assert.ok(r.sourceMap)
  })

  it('@i18n : carte présente, la ligne de `$b = 2827` retrouvée (ligne 4 du fichier)', async () => {
    const r = await transpile("@i18n 'sec'\n<script>\n$a = µt('titre')\n$b = 2827\n</script>\n<p>{$a}{$b}</p>", { moduleName: 'carte' })
    assert.match(r.output, /'sec\.titre'/)
    assert.ok(r.sourceMap, 'carte absente sous @i18n')
    const origine = originalPositionFor(new TraceMap(JSON.parse(r.sourceMap!)), position(r.output, '2827'))
    assert.equal(origine.line, 4)
  })

  it('µimport dans le script : carte présente', async () => {
    const r = await transpile("<script>\ncharger = -> µimport('./outil.js')\n$b = 2827\n</script>\n<p>{$b}</p>", { moduleName: 'carte' })
    assert.match(r.output, /µ\._mjs_import\(/)
    assert.ok(r.sourceMap, 'carte absente avec µimport')
    const origine = originalPositionFor(new TraceMap(JSON.parse(r.sourceMap!)), position(r.output, '2827'))
    assert.equal(origine.line, 3)
  })
})
