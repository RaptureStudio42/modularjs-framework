// `@style.<prop>{condition}={valeur}` : la valeur calculée, écrite entre accolades sans guillemets, se lit en entier, espaces et guillemets compris.
// Le découpage d'une valeur non quotée s'arrêtait au premier blanc : `@style.color{$on}={$on ? 'red' : 'blue'}` donnait la valeur `{$on` et des attributs parasites
// (`red`, `:`, `blue`), sans un mot, y compris à la racine du composant. Elle donne maintenant la même construction que l'écriture entre guillemets (`="{…}"`).
// Les formes qui marchaient sont inchangées : `@style.color={…}`, `@style.bg{$a}="red"`, `'red'`, `red`, `@class{…}="x"`, la valeur mêlée de texte (`{$n}px`).
// `@class{condition}` avec une condition qui contient des espaces et des guillemets se construit comme avant.

import assert from 'node:assert/strict'
import { parse } from '../src/parser/index.js'
import { transpile } from '../src/transpiler/index.js'

// les attributs lus pour une balise `<div …>`
const attrs = (ecrit: string): any[] => parse(`<div ${ecrit}>x</div>`).children[0].attrs

// le composant entier, sans la carte de source
async function sortie(balise: string, nom: string): Promise<string> {
  const source = ['<script>', '  $on = true', '  $c = \'red\'', '  $n = 3', '  $big = true', '  $w = 4', '  $a = \'x\'', '  $b = true', '  f = (o) -> o.k', '</script>', balise, ''].join('\n')
  const { output } = await transpile(source, { moduleName: nom })
  return output.replace(/\/\/# sourceMappingURL=.*$/m, '')
}

describe('@style.<prop>{condition}={valeur} : la valeur entre accolades se lit en entier', () => {
  describe('ce que lit le parseur', () => {
    const CALCULEES: Array<[string, string, string]> = [
      ['espaces et guillemets simples',                  '@style.color{$on}={$on ? \'red\' : \'blue\'}',          '{$on ? \'red\' : \'blue\'}'],
      ['espaces et guillemets doubles',                  '@style.color{$on}={$on ? "red" : "blue"}',              '{$on ? "red" : "blue"}'],
      ['des espaces seuls',                              '@style.color{$on}={$a === 1 ? $c : $a}',                '{$a === 1 ? $c : $a}'],
      ['une accolade dans une chaîne',                   '@style.color{$on}={$on ? \'}\' : \'{\'}',               '{$on ? \'}\' : \'{\'}'],
      ['un objet littéral imbriqué',                     '@style.color{$on}={f({k: $w}) + \'x\'}',                '{f({k: $w}) + \'x\'}'],
      ['des espaces au bord des accolades',              '@style.color{$on}={ $c }',                              '{ $c }'],
      ['sur plusieurs lignes',                           '@style.color{$on}={$on\n    ? \'red\'\n    : \'blue\'}', '{$on\n    ? \'red\'\n    : \'blue\'}'],
      ['une valeur mêlée de texte après les accolades',  '@style.width{$big}={$n + 1}px',                          '{$n + 1}px'],
      ['du texte avant, puis les accolades',             '@style.width{$big}=calc({$n * 2}px+1em)',               'calc({$n * 2}px+1em)']
    ]

    for (const [titre, ecrit, valeur] of CALCULEES) {
      it(`${titre} : une seule valeur, aucun attribut parasite`, () => {
        const nom = /^@style\.[\w-]+\{[^}]*\}/.exec(ecrit)![0]
        assert.deepEqual(attrs(ecrit), [{ type: 'static', name: nom, val: valeur }])
      })
    }

    it('la même lecture que l\'écriture entre guillemets', () => {
      assert.deepEqual(attrs('@style.color{$on}={$on ? \'red\' : \'blue\'}'), attrs('@style.color{$on}="{$on ? \'red\' : \'blue\'}"'))
      assert.deepEqual(attrs('@style.width{$big}={$n + 1}px'), attrs('@style.width{$big}="{$n + 1}px"'))
    })

    it('les attributs qui suivent restent lus, avant comme après', () => {
      assert.deepEqual(attrs('class="a" @style.color{$on}={$on ? \'red\' : \'blue\'} title="t" id=z'), [
        { type: 'static', name: 'class', val: 'a' },
        { type: 'static', name: '@style.color{$on}', val: '{$on ? \'red\' : \'blue\'}' },
        { type: 'static', name: 'title', val: 't' },
        { type: 'static', name: 'id', val: 'z' }
      ])
    })

    it('une balise auto-fermante : la valeur s\'arrête avant `/>`', () => {
      const img = parse('<img @style.color{$on}={$on ? \'red\' : \'blue\'}/>').children[0]
      assert.deepEqual(img.attrs, [{ type: 'static', name: '@style.color{$on}', val: '{$on ? \'red\' : \'blue\'}' }])
    })

    it('une valeur qui n\'est jamais refermée : une erreur de construction, plus des attributs parasites', () => {
      assert.throws(() => parse('<div @style.color{$on}={$on ? \'red\'>x</div>'), /NON FERMÉE/)
      assert.throws(() => parse('<div @style.color{$on}={$on ? red>x</div>'), /NON FERMÉE/)
    })

    it('le même attribut écrit deux fois : refusé comme avant', () => {
      assert.throws(() => parse('<div @style.color{$on}={$c} @style.color{$on}={$a === 1 ? $c : $a}>x</div>'), /dupliqu/i)
    })
  })

  describe('les formes qui marchaient sont lues comme avant', () => {
    const INCHANGEES: Array<[string, any[]]> = [
      ['@style.color={$on}',                                [{ type: 'dynamic', name: '@style.color', expr: '$on' }]],
      ['@style.color={$on ? \'red\' : \'blue\'}',           [{ type: 'dynamic', name: '@style.color', expr: '$on ? \'red\' : \'blue\'' }]],
      ['@style.bg{$a}="red"',                               [{ type: 'static', name: '@style.bg{$a}', val: 'red' }]],
      ['@style.bg{$a}=\'red\'',                             [{ type: 'static', name: '@style.bg{$a}', val: 'red' }]],
      ['@style.bg{$a}=red',                                 [{ type: 'static', name: '@style.bg{$a}', val: 'red' }]],
      ['@style.width{$big}="{$n}px"',                       [{ type: 'static', name: '@style.width{$big}', val: '{$n}px' }]],
      ['@style.width{$big}={$n}px',                         [{ type: 'static', name: '@style.width{$big}', val: '{$n}px' }]],
      ['@style.color{$on}={$c}',                            [{ type: 'static', name: '@style.color{$on}', val: '{$c}' }]],
      ['@style.color{$on}="{$on ? \'red\' : \'blue\'}"',    [{ type: 'static', name: '@style.color{$on}', val: '{$on ? \'red\' : \'blue\'}' }]],
      ['@style.x{$a}',                                      [{ type: 'boolean', name: '@style.x{$a}' }]],
      ['@class{$f}="flipped"',                              [{ type: 'static', name: '@class{$f}', val: 'flipped' }]],
      ['@class{$f}=\'flipped\'',                            [{ type: 'static', name: '@class{$f}', val: 'flipped' }]],
      ['@class{$f}=flipped',                                [{ type: 'static', name: '@class{$f}', val: 'flipped' }]],
      ['@class{$f}="b c"',                                  [{ type: 'static', name: '@class{$f}', val: 'b c' }]],
      ['@class{$a}',                                        [{ type: 'boolean', name: '@class{$a}' }]],
      ['@class{$a === \'x\' and $b}="on"',                  [{ type: 'static', name: '@class{$a === \'x\' and $b}', val: 'on' }]],
      ['@class{$a === "x" ? $b : false}="on"',              [{ type: 'static', name: '@class{$a === "x" ? $b : false}', val: 'on' }]],
      ['@style.color{$a === "x" ? $b : false}="red"',       [{ type: 'static', name: '@style.color{$a === "x" ? $b : false}', val: 'red' }]],
      ['@style.color{$on}={$c} title="t"',                  [{ type: 'static', name: '@style.color{$on}', val: '{$c}' }, { type: 'static', name: 'title', val: 't' }]]
    ]

    for (const [ecrit, attendu] of INCHANGEES) {
      it(ecrit.replace(/\n/g, ' '), () => {
        assert.deepEqual(attrs(ecrit), attendu)
      })
    }
  })

  describe('le composant construit', () => {
    it('la valeur calculée donne la même sortie que l\'écriture entre guillemets', async () => {
      const sansGuillemets = await sortie('<div class="a" @style.color{$on}={$on ? \'red\' : \'blue\'}>x</div>', 'valeur-calculee')
      const avecGuillemets = await sortie('<div class="a" @style.color{$on}="{$on ? \'red\' : \'blue\'}">x</div>', 'valeur-calculee')
      assert.equal(sansGuillemets, avecGuillemets)
    })

    it('le gabarit n\'a aucun attribut parasite et le style lit la valeur entière', async () => {
      const code = await sortie('<div class="a" @style.color{$on}={$on ? \'red\' : "blue"}>x</div>', 'sans-parasite')
      assert.match(code, /_mjs_cloneTpl\("<div class='a'>x<\/div>"\)/)
      assert.match(code, /const _mjs_v = \(\$\.on \? 'red' : "blue"\);/)
      assert.doesNotMatch(code, /red : blue|{\$on/)
    })

    it('la valeur mêlée de texte, avec des espaces dans les accolades, se construit en gabarit', async () => {
      const code = await sortie('<div class="a" @style.width{$big}={$n + 1}px>x</div>', 'melee')
      assert.match(code, /_mjs_cloneTpl\("<div class='a'>x<\/div>"\)/)
      assert.match(code, /\$\.n \+ 1/)
    })

    it('@class{condition} avec des espaces et des guillemets : la condition est lue en entier, aucun attribut parasite', async () => {
      const code = await sortie('<div class="a" @class{$a === \'x\' and $b}="on">x</div>', 'classe-espaces')
      assert.match(code, /_mjs_cloneTpl\("<div class='a'>x<\/div>"\)/)
      assert.match(code, /const _mjs_tv = !!\(\$\.a === 'x' && \$\.b\);/)
      const doubles = await sortie('<div class="a" @class{$a === "x" ? $b : false}="on">x</div>', 'classe-doubles')
      assert.match(doubles, /_mjs_cloneTpl\("<div class='a'>x<\/div>"\)/)
      assert.match(doubles, /const _mjs_tv = !!\(\$\.a === "x" \? \$\.b : false\);/)
    })

    it('@style.<prop>{condition}="valeur" avec une condition à espaces et guillemets : lue en entier', async () => {
      const code = await sortie('<div class="a" @style.color{$a === "x" ? $b : false}="red">x</div>', 'style-espaces')
      assert.match(code, /_mjs_cloneTpl\("<div class='a'>x<\/div>"\)/)
      assert.match(code, /if \(!!\(\$\.a === "x" \? \$\.b : false\)\)/)
    })
  })
})
