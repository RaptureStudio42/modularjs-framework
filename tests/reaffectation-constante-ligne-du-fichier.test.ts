// Le refus d'une constante `:=` réaffectée cite la ligne du fichier .mjs, comme les erreurs du compilateur Civet :
// avant, le numéro était compté depuis la balise <script> (« ligne 3 » pour une faute écrite ligne 5).

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

// deux lignes de HTML, puis le <script> (ligne 3) : la réaffectation fautive est ligne 5 du fichier
const composant = (script: string) => `<p>a</p>\n<p>b</p>\n<script>\n${script}\n</script>`

describe('constante réaffectée — la ligne citée est celle du fichier', () => {
  const cas: Array<[string, string, string]> = [
    ['affectation simple', 'x := 1\nx = 2', 'x'],
    ['affectation composée', 'x := 1\nx += 2', 'x'],
    ['motif de déstructuration', '[a, b] := [1, 2]\n[a, c] = [3, 4]', 'a'],
    ['affectation après then', 'x := 1\nif $c then x = 2', 'x'],
  ]
  for (const [nom, script, variable] of cas) {
    it(`${nom} : « ligne 5 »`, async () => {
      await assert.rejects(transpile(composant(script), { moduleName: 'ligne' }), (err: Error) => {
        assert.match(err.message, new RegExp(`réaffectation de « ${variable} » \\(ligne 5\\)`))
        return true
      })
    })
  }

  it('<script> en tête de fichier : la ligne 3 du fichier reste « ligne 3 »', async () => {
    await assert.rejects(transpile('<script>\nx := 1\nx = 2\n</script>\n<p>a</p>', { moduleName: 'ligne' }), /réaffectation de « x » \(ligne 3\)/)
  })
})
