// `export µ$x = …` d'un `<script module lang="js">` ou `lang="ts"` se construit, sur une ligne ou sur plusieurs : `µ_state.x ??= µ.state(…); export var $x = µ_state.x;`
// (`?=` et `export $x =`, l'écriture de CoffeeScript, ne sont pas du JavaScript : la construction tombait sur une faute de syntaxe),
// avec ou sans `;` en fin de ligne, un commentaire de fin de ligne gardé après ; CoffeeScript garde la sienne

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { applyMjsSugarToScript } from '../src/transpiler/sugar.js'

describe('export µ$x = … dans un script JavaScript ou TypeScript', () => {
  for (const lang of ['js', 'ts']) {
    for (const ligne of ['export µ$m = { a: 1 };', 'export µ$m = { a: 1 }', 'export µ$m = { a: 1 }; // départ']) {
      it(`<script module lang="${lang}"> : ${ligne}`, async () => {
        const r = await transpile(`<script module lang="${lang}">\n${ligne}\nexport const a = µ$m.a;\n</script>\n<script lang="${lang}">\n$n = a;\n</script>\n<p>{$n}</p>\n`, { moduleName: 'export-' + lang })
        assert.match(r.output, /µ_state\.m \?\?= µ\.state\(\{ a: 1 \}\);/)
        assert.match(r.output, lang === 'js' ? /; export var \$m = µ_state\.m;/ : /var \$m = µ_state\.m;/)
      })
    }
    it(`<script module lang="${lang}"> : la valeur sur plusieurs lignes, lue aussi par le <script> du composant`, async () => {
      const r = await transpile(`<script module lang="${lang}">\nexport µ$m = {\n  a: 1, // champ\n  b: [1,\n    2]\n}; // départ\nexport const a = µ$m.a;\n</script>\n<script lang="${lang}">\n$n = a + µ$m.b.length;\n</script>\n<p>{$n}</p>\n`, { moduleName: 'export-multi-' + lang })
      assert.match(r.output, /µ_state\.m \?\?= µ\.state\(\{\n/)
      assert.match(r.output, lang === 'js' ? /\}\); export var \$m = µ_state\.m;/ : /var \$m = µ_state\.m;/)
      assert.equal((r.output.match(/let µ_state = /g) || []).length, 1, r.output)
    })
    it(`<script module lang="${lang}"> : un magasin \`export µ$$s = {\` sur plusieurs lignes`, async () => {
      const r = await transpile(`<script module lang="${lang}">\nexport µ$$s = {\n  a: 1\n};\n</script>\n<p>x</p>\n`, { moduleName: 'magasin-multi-' + lang })
      assert.match(r.output, /µ_state\.s \?\?= µ\.state\(\{\n  a: 1\n\}\);/)
    })
  }

  it('CoffeeScript garde `?=` et `export $m =`', () => {
    assert.match(applyMjsSugarToScript('export µ$m = 1', 'coffee'), /µ_state\.m \?= µ\.state\(1\); export \$m = µ_state\.m/)
  })
})
