// une ligne `µ$x = …` d'un `<script lang="js">` ou `lang="ts"` se construit, comme en Civet : la déclaration y est écrite en `??=`
// (`?=`, l'opérateur de Civet et de CoffeeScript, n'existe pas en JavaScript : la construction tombait sur une faute de syntaxe), avec
// ou sans `;` en fin de ligne ; CoffeeScript garde son `?=` ; la valeur de départ passe par `µ._mjs_univVal` (un objet devient un
// état, un nombre reste un nombre), celle d'un magasin (`export µ$x`) par `µ.state`

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { applyMjsSugarToScript } from '../src/transpiler/sugar.js'

describe('µ$x déclaré dans un script JavaScript ou TypeScript', () => {
  for (const lang of ['js', 'ts']) {
    for (const ligne of ['µ$x = 0', 'µ$x = 0;', 'µ$x = { n: 1 };']) {
      it(`<script lang="${lang}"> : ${ligne}`, async () => {
        const r = await transpile(`<script lang="${lang}">\n${ligne}\n@plus = function() { µ$x++; };\n</script>\n<button @click={@plus()}>+</button>\n`, { moduleName: 'univ-' + lang })
        assert.match(r.output, /µ_state\.x \?\?= µ\._mjs_univVal\((?:0|\{ n: 1 \})\);?/)
        assert.match(r.output, /µ_state\.x\+\+/)
      })
    }
  }

  it('CoffeeScript garde `?=` ; un magasin garde `µ.state`', () => {
    assert.match(applyMjsSugarToScript('µ$x = 0', 'coffee'), /µ_state\.x \?= µ\._mjs_univVal\(0\)/)
    assert.match(applyMjsSugarToScript('export µ$m = 1', 'coffee'), /µ_state\.m \?= µ\.state\(1\)/)
  })
})
