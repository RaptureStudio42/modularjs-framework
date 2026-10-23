// Ce que le compilateur ajoute au script (déclaration d'une variable affectée dans une branche, déclaration de
// l'état partagé `µ$x`, effet de `µdebug`, export d'un `µ$x`) prend place sur une ligne existante : avant, chaque
// ajout poussait une ligne neuve, et les erreurs du compilateur comme la carte de source pointaient la ligne
// d'après celle de la faute.

import assert from 'node:assert/strict'
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping'
import { transpile } from '../src/transpiler/index.js'

async function erreur(src: string): Promise<string> {
  try {
    await transpile(src, { moduleName: 'sonde' })
  }
  catch (e: any) {
    return String(e.message)
  }
  return 'compilé sans erreur'
}

// ligne (1 = première) et colonne du premier `needle` dans `text`
function position(text: string, needle: string): { line: number, column: number } {
  const idx = text.indexOf(needle)
  assert.ok(idx >= 0, `« ${needle} » introuvable`)
  const avant = text.slice(0, idx)
  return { line: avant.split('\n').length, column: idx - (avant.lastIndexOf('\n') + 1) }
}

describe('sucre du script — aucune ligne ajoutée, positions justes', function () {
  this.timeout(30000)

  // la faute (`$b = (2 ]`) est ligne 5 du fichier dans tous les cas
  const cas: Array<[string, string]> = [
    ['témoin (rien d\'ajouté)', 'y := 1\n'],
    ['variable affectée dans une branche (déclarée plus haut)', 'if true\n  y = 1'],
    ['état partagé µ$n (déclaration de µ_state)', 'µ$n = 0\n'],
    ['µdebug (effet de trois lignes)', '$n = 0\nµdebug $n'],
    ['variable d\'une fonction affectée après then', 'f = ->\n  if $c then y = 1'],
  ]
  for (const [nom, corps] of cas) {
    it(`${nom} : l'erreur cite la ligne 5`, async () => {
      const message = await erreur(`<p>a</p>\n<script>\n${corps}\n$b = (2 ]\n</script>`)
      assert.match(message, /sonde\.script:5:10\b/, message.slice(0, 200))
    })
  }

  it('export µ$x dans <script module> : l\'erreur cite la ligne 4', async () => {
    const message = await erreur('<p>a</p>\n<script module>\nexport µ$total = 0\n$b = (2 ]\n</script>')
    assert.match(message, /sonde\.module:4:\d+\b/, message.slice(0, 200))
  })

  for (const [nom, corps] of [['variable affectée dans une branche', 'if true\n  y = 1'], ['état partagé µ$n', 'µ$n = 0\n']]) {
    it(`${nom} : la carte de source ramène « 42 » à la ligne 5`, async () => {
      const r = await transpile(`<p>a</p>\n<script>\n${corps}\n$zz = 42\n</script>\n<p>{$zz}</p>`, { moduleName: 'sonde' })
      assert.ok(r.sourceMap, 'carte absente')
      const ici = position(r.output, '42)')
      const origine = originalPositionFor(new TraceMap(JSON.parse(r.sourceMap!)), ici)
      assert.equal(origine.line, 5)
    })
  }

  it('dans une fonction, la déclaration se pose devant la première ligne du corps', async () => {
    const r = await transpile('<script>\nf = ->\n  if $c\n    y = 1\n  y\n</script>\n<p>{f()}</p>', { moduleName: 'sonde' })
    assert.match(r.output, /let y = undefined; if \(/)
  })
})
