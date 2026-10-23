// une forme `/…/` d'un <vars> dont un antislash précède un retour à la ligne (ou un retour chariot) est
// acceptée par `new RegExp` au build : elle était émise en littéral regex coupé par la fin de ligne, un JS
// invalide dont l'erreur tombait dans le fichier produit, loin du <vars>

import assert from 'node:assert/strict'
import { compileVars } from '../src/transpiler/var-types.js'

function regexDe(v: unknown): RegExp | null {
  if (v instanceof RegExp) return v
  if (v && typeof v === 'object') {
    for (const x of Object.values(v)) {
      const r = regexDe(x)
      if (r) return r
    }
  }
  return null
}

describe('<vars> — forme regex avec un antislash en fin de ligne', () => {
  for (const [nom, raw, texte] of [
    ['retour à la ligne', '$x { a: string /a\\\nb/ }', 'a\nb'],
    ['retour chariot', '$x string /a\\\rb/', 'a\rb'],
    ['témoin sur une ligne', '$x string /^a+$/', 'aaa'],
  ]) {
    it(`${nom} : le JS émis se lit et la forme vaut celle du build`, () => {
      const c = compileVars({ raw, startLine: 2 }, {}, true)
      const code = `({${c.vars.join(',')}})`
      const regles = new Function('return ' + code)()
      const re = regexDe(regles)
      assert.ok(re, code)
      assert.ok(re!.test(texte), `${re} sur ${JSON.stringify(texte)}`)
    })
  }
})
