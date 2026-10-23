// Une expression régulière juste après un mot de Civet — `if`, `unless`, `and`, `or`, `not`, `then`,
// `when`, `while`, `until`, `is`, `isnt` — ou après `throw` : c'est une regex, pas une division. Avant,
// une apostrophe qu'elle contenait (`/[\s,']/`) ouvrait une fausse chaîne qui avalait les lignes
// suivantes : `x isnt ''` plus bas n'était plus converti (ReferenceError: isnt is not defined).

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

const APRES = "@args = (liste) ->\n  liste.filter (x) -> x isnt ''\n"

describe('<script> — une regex après un mot de Civet', () => {
  const cas = [
    "@f = (v) ->\n  v = 1 if /[\\s,']/.test(v)\n  v\n",
    "@f = (v) -> 1 unless /a'/.test(v)\n",
    "@f = (v) -> v? and /a'/.test(v)\n",
    "@f = (v) -> v or /'/.test(v)\n",
    "@f = (v) -> not /'/.test(v)\n",
    "@f = (v) -> if v then /'/.test(v) else false\n",
    "@f = (v) -> v is /'/.test(v)\n",
  ]
  for (const ecrit of cas) {
    it(JSON.stringify(ecrit.split('\n').find((l) => l.includes('/'))!.trim()), async () => {
      const r: any = await transpile(`<script>\n${ecrit}${APRES}</script>\n<b>{@args([])}</b>\n`, { moduleName: 'regex-mot' })
      const ligne = String(r.output).split('\n').find((l) => l.includes('liste.filter')) ?? ''
      assert.ok(!/isnt/.test(ligne) && /!== ''/.test(ligne), ligne.trim())
    })
  }

  it('une division après un nom reste une division', async () => {
    const r: any = await transpile("<script>\n$a = 8\n@f = (b) -> $a / 2 / b\n</script>\n<b>{@f(2)}</b>\n", { moduleName: 'regex-mot-division' })
    assert.ok(/\/ 2 \/ b/.test(String(r.output)), 'la division')
  })
})
