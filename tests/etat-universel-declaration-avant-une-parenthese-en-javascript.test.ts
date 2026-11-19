// la ligne qui pose l'état universel (`let µ_state = (µ._mjs_univ ??= µ.state({}))`) dans un `<script lang="js">` ou `lang="ts"`
// finit par `;` : sans lui, une première instruction qui commence par `(` ou `[` se collait à elle, et l'état était appelé comme
// une fonction

import assert from 'node:assert/strict'
import { parse } from 'acorn'
import { applyMjsSugarToScript } from '../src/transpiler/sugar.js'

describe('µ$x : la déclaration de l\'état universel ne se colle pas à la ligne qui suit', () => {
  for (const lang of ['js', 'ts']) {
    for (const tete of ['(function () { globalThis.__t = 1 })()', '[1, 2].forEach((v) => { globalThis.__t = v })']) {
      it(`<script lang="${lang}"> qui commence par « ${tete.slice(0, 12)}… »`, () => {
        const sortie = applyMjsSugarToScript(`${tete}\nµ$n = 1\n`, lang)
        assert.match(sortie, /let µ_state = \(µ\._mjs_univ \?\?= µ\.state\(\{\}\)\);/, sortie)
        const arbre: any = parse(sortie, { ecmaVersion: 'latest', sourceType: 'module' })
        const decl = arbre.body.find((n: any) => n.type === 'VariableDeclaration' && n.declarations[0].id.name === 'µ_state')
        assert.ok(decl, sortie)
        assert.notEqual(decl.declarations[0].init.type, 'CallExpression', sortie)
      })
    }
  }
})
