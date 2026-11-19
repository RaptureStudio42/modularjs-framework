// Un texte de la console choisit sa phrase en comparant une de ses variables à une valeur (`reason === 'shape'`, `nature === 'core'`) :
// cette valeur doit être une de celles que le code passe au texte. Un nom changé d'un seul côté (le code passe `'shape'`, le texte
// compare à `'forme'`) ne casse rien de visible : la branche n'est jamais prise et le texte dit autre chose, sans bruit. Chaque valeur
// comparée dans `messages/fr.ts` et `messages/en.ts` est donc cherchée, écrite entre guillemets, dans le reste de `src/`

import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import ts from 'typescript'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))

// le code de src/, sans les deux tables des messages
function codeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return codeFiles(p)
    return /\.(?:ts|mjs)$/.test(f) && !/^messages\/(?:fr|en)\.ts$/.test(p.slice(SRC.length)) ? [p] : []
  })
}

// un fichier .ts sans ses commentaires : une valeur citée dans un commentaire ne prouve pas que le code la passe
export function withoutComments(text: string): string {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text)
  let out = ''
  for (let k = scanner.scan(); k !== ts.SyntaxKind.EndOfFileToken; k = scanner.scan()) {
    if (k === ts.SyntaxKind.SingleLineCommentTrivia || k === ts.SyntaxKind.MultiLineCommentTrivia) out += ' '
    else out += scanner.getTokenText()
  }
  return out
}

describe('messages: every value a text compares a variable to is a value the code passes', function () {
  const code = codeFiles(SRC).map((p) => p.endsWith('.ts') ? withoutComments(readFileSync(p, 'utf-8')) : readFileSync(p, 'utf-8')).join('\n')

  it('a value cited only in a comment does not count', () => {
    assert.equal(withoutComments("const a = 1 // 'gabarit'\n/* 'gabarit' */ const b = 'template'").includes("'gabarit'"), false)
    assert.equal(withoutComments("const b = 'template'").includes("'template'"), true)
  })

  for (const lang of ['fr', 'en']) {
    it(`messages/${lang}.ts: no compared value is missing from the code`, () => {
      const table   = readFileSync(join(SRC, 'messages', lang + '.ts'), 'utf-8')
      const values  = new Set([...table.matchAll(/\b[a-zA-Z_]+ [!=]== '([a-zA-Z0-9_-]+)'/g)].map((m) => m[1]))
      const missing = [...values].filter((v) => !code.includes(`'${v}'`))
      assert.ok(values.size > 10, `comparaisons trouvées : ${values.size}`)
      assert.deepEqual(missing, [])
    })
  }
})
