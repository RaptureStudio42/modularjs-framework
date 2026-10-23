// µeffect sous un `if` ou un `for` de premier niveau, refusé à tort (« imbriqué ») quand la condition tenait sur deux lignes
// (`if (a &&` puis `    b) {`) ou qu'une regex à accolade (`/\{/`, `/[{]/`) se trouvait plus haut : chaque accolade était
// jugée sur le texte de sa seule ligne, et celles des regex comptaient. À l'inverse, une regex `/}/` dans un corps de fonction
// sans retrait refermait l'accolade de la fonction et le µeffect passait, puis restait ignoré à l'exécution. L'accolade est
// désormais jugée sur l'instruction qu'elle ouvre, regex écartées ; le corps d'une fonction reste refusé quel que soit le retrait

import assert from 'node:assert/strict'
import { transpile, lintEffectTopLevel } from '../src/transpiler/index.js'

const composant = (lang: string, code: string): string => `<p>{$n}</p>\n<script lang="${lang}">\n${code}\n</script>`

describe('µeffect sous un bloc de contrôle : condition sur plusieurs lignes, regex à accolade', () => {
  const acceptes: [string, string, string][] = [
    ['if (c) { d\'une ligne', 'js', 'let c = true\n$n = 0\nif (c) {\n  µeffect(() => console.log($n))\n}'],
    ['condition sur deux lignes', 'js', 'let a = true, b = true\n$n = 0\nif (a &&\n    b) {\n  µeffect(() => console.log($n))\n}'],
    ['for sur deux lignes', 'js', 'const xs = [1]\n$n = 0\nfor (const x of\n       xs) {\n  µeffect(() => console.log($n, x))\n}'],
    ['suite de la condition moins en retrait que le corps', 'js', 'let a = true, b = true\n$n = 0\nif (a &&\n  b) {\n    µeffect(() => console.log($n))\n}'],
    ['regex /\\{/ plus haut', 'js', 'const OUVRE = /\\{/g\n$n = 0\nif (OUVRE) {\n  µeffect(() => console.log($n))\n}'],
    ['regex /[{]/ plus haut', 'js', 'const re = /[{]/\n$n = 0\nif (re) {\n  µeffect(() => console.log($n))\n}'],
    ['} else {', 'js', 'let c = false\n$n = 0\nif (c) {\n  c = true\n} else {\n  µeffect(() => console.log($n))\n}'],
    ['coffee : if après une regex /\\{/', 'coffee', 'OUVRE = /\\{/g\n$n = 0\nif OUVRE\n  µeffect -> console.log $n'],
    ['gabarit à accolade plus haut', 'js', 'const t = `{`\n$n = 0\nif (t) {\n  µeffect(() => console.log($n))\n}'],
  ]
  for (const [nom, lang, code] of acceptes) {
    it(`accepté : ${nom}`, async () => {
      await assert.doesNotReject(transpile(composant(lang, code), { moduleName: 'effet-structure' }))
    })
  }

  it('refusé : corps de fonction sans retrait, sous un if', async () => {
    await assert.rejects(transpile(composant('js', 'let c = true\n$n = 0\nfunction plusTard() {\nif (c) {\n  µeffect(() => console.log($n))\n}\n}'), { moduleName: 'effet-structure' }), /imbriqué/)
  })

  it('refusé : corps de fonction sans retrait, regex /}/ dans le corps', async () => {
    await assert.rejects(transpile(composant('js', 'let c = true\n$n = 0\nfunction plusTard() {\nconst r = /}/\nif (c) {\n  µeffect(() => console.log($n))\n}\n}'), { moduleName: 'effet-structure' }), /imbriqué/)
  })

  it('accepté : après une classe à champ privé lu dans une ligne (`this.#n }`)', () => {
    assert.doesNotThrow(() => lintEffectTopLevel('class A {\n  #n = 0\n  get x() { return this.#n }\n}\nµeffect(() => 1)'))
    assert.doesNotThrow(() => lintEffectTopLevel('class A {\n  #n = 0\n  get x() { return this.#n }\n}\nif (c) {\n  µeffect(() => 1)\n}'))
    assert.throws(() => lintEffectTopLevel('class A {\n  get x() { return this.#n }\n  m() {\n    µeffect(() => 1)\n  }\n}'), /imbriqué \(ligne 4/)
  })

  it('refusé : corps de fonction, quel que soit le retrait', () => {
    assert.throws(() => lintEffectTopLevel('function f() {\nµeffect(() => 1)\n}'), /imbriqué \(ligne 2/)
    assert.throws(() => lintEffectTopLevel('function f() { µeffect(() => 1) }'), /imbriqué \(ligne 1/)
    assert.throws(() => lintEffectTopLevel('xs.forEach(function (x) {\nµinspect(x)\n})'), /imbriqué \(ligne 2/)
    assert.throws(() => lintEffectTopLevel('if (a &&\n    b) {\n  setTimeout(() => {\n    µeffect(() => 1)\n  })\n}'), /imbriqué \(ligne 4/)
  })
})
