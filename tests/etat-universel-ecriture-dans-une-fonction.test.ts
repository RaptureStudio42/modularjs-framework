// `µ$x = …` seul sur sa ligne dans le corps d'une fonction (méthode, flèche, rappel, `µeffect`, `µafter`) est une écriture, lue sur
// l'arbre du code compilé, en Civet, CoffeeScript, JavaScript et TypeScript, dans le `<script>` comme dans le `<script module>` : elle
// était lue comme une déclaration, sans effet quand la valeur est là ; une ligne du niveau du script reste une déclaration, quelle que
// soit sa forme (sous un `if`, un `for`, un `try`, dans un bloc, un bloc `do` de Civet, script tout en retrait, tabulation, suite de ligne
// moins en retrait), comme une ligne d'une fonction appelée là où elle est écrite (`(() => { … })()`, `do ->` et liste en compréhension
// de CoffeeScript)

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

const compile = async (lang: string, script: string, module = false): Promise<string> => (await transpile(`<script${module ? ' module' : ''}${lang === 'civet' ? '' : ` lang="${lang}"`}>\n${script}\n</script>\n${module ? '<script>\n$n = 1\n</script>\n' : ''}<p>x</p>\n`, { moduleName: 'ecrit-' + lang })).output
const echappe = (v: string): string => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// la valeur `v` de `µ$x` posée par une déclaration (`??=`, ou la garde de CoffeeScript), ou par une écriture
const declare = (out: string, v: string): boolean => new RegExp(`µ_state\\.x \\?\\?= µ\\._mjs_univVal\\(${echappe(v)}\\)|µ_state\\.x == null\\) \\{\\s*µ_state\\.x = µ\\._mjs_univVal\\(${echappe(v)}\\)|µ_state\\.x != null \\? µ_state\\.x : µ_state\\.x = µ\\._mjs_univVal\\(${echappe(v)}\\)`).test(out)
const ecrit   = (out: string, v: string): boolean => !declare(out, v) && out.includes(`µ_state.x = µ._mjs_univVal(${v})`)

describe('µ$x = … dans le corps d\'une fonction : une écriture ; au niveau du script : une déclaration', () => {
  const CAS: [string, string, string, string[], string[]][] = [
    ['civet', 'script', 'µ$x = 0\n@raz = ->\n  µ$x = 10\n@fin = ->\n  µ$x = 11\n  1\n@rappel = ->\n  [1].forEach (v) ->\n    µ$x = 20 + v\n@fleche = =>\n  µ$x = 30\nµeffect ->\n  µ$x = 31\nµafter 10, ->\n  µ$x = 32\nif true\n  µ$x = 40\ntry\n  µ$x = 41\ncatch e\n  µ$x = 42\nfor i in [1..2]\n  µ$x = 43\ndo\n  µ$x = 44', ['10', '11', '20 + v', '30', '31', '32'], ['0', '40', '41', '42', '43', '44']],
    ['coffee', 'script', 'µ$x = 0\n@raz = ->\n  µ$x = 10\n@fin = ->\n  µ$x = 11\n  1\n@rappel = ->\n  [1].forEach (v) ->\n    µ$x = 20 + v\nif true\n  µ$x = 40\nr = for i in [1..2]\n  µ$x = 45\ndo ->\n  µ$x = 47', ['10', '11', '20 + v'], ['0', '40', '45', '47']],
    ['js', 'script', 'µ$x = 0;\n@raz = function() {\n  µ$x = 10;\n};\n@fleche = () => {\n  [1].forEach((v) => {\n    µ$x = 20 + v;\n  });\n};\nµeffect(() => {\n  µ$x = 31;\n});\nif (true) {\n  µ$x = 40;\n}\ntry {\n  µ$x = 41;\n}\ncatch (e) {\n  µ$x = 42;\n}\nfor (const i of [1]) {\n  µ$x = 43;\n}\n(() => {\n  µ$x = 44;\n})();\n{\n  µ$x = 46;\n}', ['10', '20 + v', '31'], ['0', '40', '41', '42', '43', '44', '46']],
    ['js', 'script tout en retrait, tabulation, suite de ligne', '    µ$x = 0;\n    const t = "a" +\n"b";\n    if (t) {\n\t  µ$x = 40;\n    }\n    @raz = function() {\n\t  µ$x = 10;\n    };', ['10'], ['0', '40']],
    ['ts', 'script', 'µ$x = 0;\n@raz = function(): void {\n  µ$x = 10;\n};\n@fleche = (): void => {\n  [1].forEach((v: number) => {\n    µ$x = 20 + v;\n  });\n};\nif (true) {\n  µ$x = 40;\n}', ['10', '20 + v'], ['0', '40']],
    ['civet', 'module', 'µ$x = 0\nexport raz = ->\n  µ$x = 10\nif true\n  µ$x = 40', ['10'], ['0', '40']],
    ['js', 'module', 'µ$x = 0;\nexport function raz() {\n  µ$x = 10;\n}\nif (true) {\n  µ$x = 40;\n}', ['10'], ['0', '40']]
  ]
  for (const [lang, nom, script, ecritures, declarations] of CAS) {
    it(`${lang}, ${nom} : le corps d'une fonction écrit, le niveau du script déclare`, async () => {
      const out = await compile(lang, script, nom === 'module')
      for (const v of ecritures) assert.ok(ecrit(out, v), `écriture de ${v} absente :\n${out}`)
      for (const v of declarations) assert.ok(declare(out, v), `déclaration de ${v} absente :\n${out}`)
    })
  }
})
