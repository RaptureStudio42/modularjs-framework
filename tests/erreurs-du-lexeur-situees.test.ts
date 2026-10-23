// Les erreurs du lexeur (µwrite ancienne forme, § nu, µread malformé, `&$x`, `$x :=`, `@mount ->`, µderived,
// µlayout) ne disaient ni la ligne ni la colonne de la faute. Elles portent désormais `<fichier>:<ligne>:<colonne>`,
// comme une erreur du compilateur Civet, ligne comptée dans le `.mjs` ; un appel direct du lexeur, sans fichier,
// garde le message seul.

import assert from 'node:assert/strict'
import { tokenize } from '../src/lexer/index.js'
import { transpile } from '../src/transpiler/index.js'

async function message(source: string): Promise<string> {
  try {
    await transpile(source, { moduleName: 'pos' })
  }
  catch (e: any) {
    return String(e.message)
  }
  return assert.fail('construction acceptée')
}

const FAUTES: Array<[string, string, number]> = [
  ['µwrite ancienne forme', '  µwrite $x = 1', 3],
  ['§ nu', '  y = § + 1', 7],
  ['µread malformé', '  y = µread x', 7],
  ['&$x', '  y = &$x', 7],
  ['$x :=', '  $x := 1', 3],
  ['@mount ->', '  @mount ->', 3],
  ['µderived dépendance invalide', '  µderived $d = 1, a', 3],
  ['µlayout écrit', "  µlayout = 'x'", 3],
]

describe('erreurs du lexeur situées', function () {
  this.timeout(30000)

  for (const [nom, ligne, colonne] of FAUTES) {
    it(`${nom} : ligne 5, colonne ${colonne} du fichier`, async () => {
      const m = await message(['<script>', '$x = 0', '', 'if true', ligne, '</script>', '<p>x</p>'].join('\n'))
      assert.match(m, new RegExp(`^'pos' : pos\\.script:5:${colonne} \\[ModularJS\\]`))
    })
  }

  it('une chaîne sur plusieurs lignes avant la faute ne décale pas la ligne', async () => {
    const m = await message(['<script>', '$t = """', '  a', '  b', '"""', 'µderived $d = 1, a', '</script>', '<p>x</p>'].join('\n'))
    assert.match(m, /pos\.script:6:1 \[ModularJS\]/)
  })

  // la colonne se compte, comme pour Civet, sur le texte compilé : `y = …` au niveau du module y devient `y .= …`
  it('dans <script module>, la ligne du fichier', async () => {
    const m = await message(['<p>x</p>', '<script module>', 'a = 1', 'y = &$x', '</script>', '<script>', '$n = 0', '</script>'].join('\n'))
    assert.match(m, /pos\.module:4:\d+ \[ModularJS\]/)
  })

  it('le lexeur appelé seul, sans fichier, garde le message seul', () => {
    assert.throws(() => tokenize('µwrite $x = 1'), (e: any) => /^\[ModularJS\]/.test(e.message))
  })
})
