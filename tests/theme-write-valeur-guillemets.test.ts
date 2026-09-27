// atelier de thème, écriture dans le source : le lecteur de valeur d'une déclaration `$$nom: …`
// s'arrêtait au premier `;` rencontré, même à l'intérieur d'une chaîne CSS — `$$accent: "red;blue"`
// était lue `"red` et la réécriture produisait une ligne malformée (`$$accent: #fff;blue"`). Une
// chaîne entre guillemets est recopiée telle quelle, son `;` n'est jamais une fin de déclaration.

import assert from 'node:assert/strict'
import { findThemeDecls, rewriteThemeValue } from '../src/server/theme-write.js'

describe('atelier de thème — valeur entre guillemets contenant « ; »', () => {
  it('la valeur lue est la chaîne entière, guillemets compris', () => {
    const source = '<theme>\n  $$accent: "red;blue"\n</theme>\n'
    const decls  = findThemeDecls(source, 'accent', 'mjs')
    assert.equal(decls.length, 1)
    assert.equal(decls[0].value, '"red;blue"')
  })

  it('la réécriture remplace toute la valeur et laisse une ligne bien formée', () => {
    const source  = '<theme>\n  $$accent: "red;blue"\n</theme>\n'
    const outcome = rewriteThemeValue(source, 'accent', 'mjs', '#fff')
    assert.equal(outcome.ok, true, JSON.stringify(outcome))
    assert.match(outcome.source, /\$\$accent: #fff\n/)
    assert.ok(!outcome.source.includes('blue"'), outcome.source)
  })

  it('même chose avec des guillemets simples et un point-virgule final', () => {
    const source  = "<theme>\n  $$accent: 'a;b';\n</theme>\n"
    const outcome = rewriteThemeValue(source, 'accent', 'mjs', '#000')
    assert.equal(outcome.ok, true, JSON.stringify(outcome))
    assert.match(outcome.source, /\$\$accent: #000;\n/)
  })
})
