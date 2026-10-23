// Les expressions de gabarit `{…}` et de script gardent leur lecture des barres obliques : une barre en position d'expression ouvre une
// regex (au début, après `(`, `,`, `=`, `:`, `[`, `!`, `&&`, `?`, `{`, `%`, `return`, `typeof`), ailleurs elle divise (après `)`, `]`, `}`, un nombre,
// un identifiant). Seuls les réglages d'un effet (`*nom(…)`, effets-couleurs-barre.test.ts) ne cherchent aucune regex : ce fichier garde le reste.
// Chaque regex porte une apostrophe (gabarit) ou un `$a` (script) : mal lue, l'apostrophe ouvrirait un texte que rien ne referme et le `$a` serait
// réécrit en état. Chaque expression de gabarit est suivie d'une seconde sur la même ligne : une division lue comme une regex l'avalerait.
// Le code attendu est celui que le compilateur émettait avant que les réglages d'effet ne cessent de chercher une regex.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

const ENTETE = "<script>\n$a = 7\n$b = 3\n$s = 'x'\n$y = 5\n$z = 1\n</script>\n"

// [nom, expression écrite entre accolades, ligne émise qui la porte]
const GABARIT = [
  ['modulo', '$a % 2', 'const _mjs_eff = [() => { this._mjs_updText(\'t1\', $.a % 2); }, () => { this._mjs_updText(\'t2\', $.z); }];'],
  ['divisions', '$a / $b / 2', 'const _mjs_eff = [() => { this._mjs_updText(\'t1\', $.a / $.b / 2); }, () => { this._mjs_updText(\'t2\', $.z); }];'],
  ['regex-debut', '/\'/.test($s)', 'const _mjs_eff = [() => { this._mjs_updText(\'t1\', (/\'/.test($.s))); }, () => { this._mjs_updText(\'t2\', $.z); }];'],
  ['regex-apres-pc', '$y % /\'/.source.length', 'const _mjs_eff = [() => { this._mjs_updText(\'t1\', ($.y % /\'/.source.length)); }, () => { this._mjs_updText(\'t2\', $.z); }];'],
  ['regex-apres-paren', 'String(/\'/.source)', 'const _mjs_eff = [() => { this._mjs_updText(\'t2\', $.z); }, () => { this._mjs_updText(\'t1\', (String(/\'/.source))); }];'],
  ['regex-apres-virg', 'Math.max(1, /\'/.source.length)', 'const _mjs_eff = [() => { this._mjs_updText(\'t2\', $.z); }, () => { this._mjs_updText(\'t1\', (Math.max(1, /\'/.source.length))); }];'],
  ['regex-apres-egal', '(r = /\'/).source', 'const _mjs_eff = [() => { this._mjs_updText(\'t2\', $.z); }, () => { this._mjs_updText(\'t1\', ((r = /\'/).source)); }];'],
  ['regex-apres-2pts', '$a ? $b : /\'/.source', 'const _mjs_eff = [() => { this._mjs_updText(\'t1\', ($.a ? $.b : /\'/.source)); }, () => { this._mjs_updText(\'t2\', $.z); }];'],
  ['regex-apres-interr', '$a ? /\'/.source : \'x\'', 'const _mjs_eff = [() => { this._mjs_updText(\'t1\', ($.a ? /\'/.source : \'x\')); }, () => { this._mjs_updText(\'t2\', $.z); }];'],
  ['regex-apres-crochet', '[/\'/][0].source', 'const _mjs_eff = [() => { this._mjs_updText(\'t2\', $.z); }, () => { this._mjs_updText(\'t1\', ([/\'/][0].source)); }];'],
  ['regex-apres-non', '!/\'/.test($s)', 'const _mjs_eff = [() => { this._mjs_updText(\'t1\', (!/\'/.test($.s))); }, () => { this._mjs_updText(\'t2\', $.z); }];'],
  ['regex-apres-et', '$a && /\'/.test($s)', 'const _mjs_eff = [() => { this._mjs_updText(\'t1\', ($.a && /\'/.test($.s))); }, () => { this._mjs_updText(\'t2\', $.z); }];'],
  ['regex-apres-accolade', '(() => { /\'/.test($s) })()', 'const _mjs_eff = [() => { this._mjs_updText(\'t1\', ((() =>( { test: /\'/.test($.s) }))())); }, () => { this._mjs_updText(\'t2\', $.z); }];'],
  ['division-apres-accolade', '({k: 4}).k / 2', 'const _mjs_eff = [() => { this._mjs_updText(\'t2\', $.z); }, () => { this._mjs_updText(\'t1\', ({k: 4}).k / 2); }];'],
  ['regex-apres-return', '(() => { return /\'/.test($s) })()', 'const _mjs_eff = [() => { this._mjs_updText(\'t1\', ((() => { return /\'/.test($.s) })())); }, () => { this._mjs_updText(\'t2\', $.z); }];'],
  ['regex-apres-typeof', 'typeof /\'/', 'const _mjs_eff = [() => { this._mjs_updText(\'t2\', $.z); }, () => { this._mjs_updText(\'t1\', (typeof /\'/)); }];'],
  ['division-apres-paren', '($a + $b) / 2', 'const _mjs_eff = [() => { this._mjs_updText(\'t1\', ($.a + $.b) / 2); }, () => { this._mjs_updText(\'t2\', $.z); }];'],
  ['division-apres-crochet', '[4][0] / 2', 'const _mjs_eff = [() => { this._mjs_updText(\'t2\', $.z); }, () => { this._mjs_updText(\'t1\', [4][0] / 2); }];'],
  ['division-apres-nombre', '10 / 2', 'const _mjs_eff = [() => { this._mjs_updText(\'t2\', $.z); }, () => { this._mjs_updText(\'t1\', 10 / 2); }];'],
  ['division-apres-ident', 'Math.PI / 2', 'const _mjs_eff = [() => { this._mjs_updText(\'t2\', $.z); }, () => { this._mjs_updText(\'t1\', Math.PI / 2); }];']
]

// [nom, ligne du script, ligne émise]
const SCRIPT = [
  ['s-regex-apres-pc', 'x = $y % /$a/.source.length', 'let x = $.y % /$a/.source.length'],
  ['s-divisions', 'x = $y / $a / 2', 'let x = $.y / $.a / 2'],
  ['s-regex-apres-paren', 'x = String(/$a/.source)', 'let x = String(/$a/.source)'],
  ['s-regex-apres-virg', 'x = [1, /$a/.source]', 'let x = [1, /$a/.source]'],
  ['s-regex-apres-egal', 'x = /$a/.source', 'let x = /$a/.source'],
  ['s-regex-apres-return', 'f := () => { return /$a/.source }', 'const f = () => { return /$a/.source }'],
  ['s-regex-apres-typeof', 'x = typeof /$a/', 'let x = typeof /$a/']
]

const lignes = (code: string) => code.split('\n').map((l) => l.trim())

describe('expressions de gabarit : lecture des barres obliques inchangée', () => {
  for (const [nom, expr, attendu] of GABARIT) {
    it(nom + ' : {' + expr + '}', async () => {
      const { output } = await transpile(`${ENTETE}<p>{${expr}}</p><i>{$z}</i>\n`, { moduleName: 'barre-expressions' })
      assert.ok(lignes(output).includes(attendu), 'ligne absente : ' + attendu)
    })
  }
})

describe('expressions de script : lecture des barres obliques inchangée', () => {
  for (const [nom, ligne, attendu] of SCRIPT) {
    it(nom + ' : ' + ligne, async () => {
      const { output } = await transpile(`<script>\n$a = 7\n$y = 5\n${ligne}\n</script>\n<p>{$a}</p>\n`, { moduleName: 'barre-expressions' })
      assert.ok(lignes(output).includes(attendu), 'ligne absente : ' + attendu)
    })
  }
})

describe('une balise à effet qui porte une couleur à barre oblique ne change pas la lecture des expressions voisines', () => {
  it('la regex après un pourcentage, la division et la regex qui suivent la balise restent lues comme avant', async () => {
    const source = ENTETE + '<div *fluid(background: hsl(210 50% 20% / .4))>{$y % /\'/.source.length}</div><p>{$a / $b / 2}</p><p>{/\'/.test($s)}</p>\n'
    const { output } = await transpile(source, { moduleName: 'barre-expressions' })
    assert.ok(output.includes('"fluid", {"background":"hsl(210 50% 20% / .4)"}'), 'la pose de la balise est absente')
    assert.ok(output.includes('($.y % /\'/.source.length)'), 'la regex après % n\'est plus vue')
    assert.ok(output.includes('$.a / $.b / 2'), 'la division a changé')
    assert.ok(output.includes('(/\'/.test($.s))'), 'la regex du début d\'expression a changé')
  })
})
