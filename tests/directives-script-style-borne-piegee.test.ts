// transpiler/directives — la borne <script>…</script>/<style>…</style> (scriptInertMask, et le
// masquage en bloc de <style>) était cherchée par une regex paresseuse sur le texte NON masqué :
// un `</script>`/`</style>` LITTÉRAL affiché avant la vraie fermeture (chaîne, gabarit,
// commentaire) refermait la zone trop tôt, et tout ce qui suivait ressortait hors masque — une
// directive citée en exemple plus loin dans le même bloc se réactivait et disparaissait du texte.
// Même remède que sections.ts (cf. directives-script-style-inerte.test.ts pour le cas de base,
// déjà couvert) : la borne se cherche sur une vue masquée, jamais sur le texte réel.

import assert from 'node:assert/strict'
import { extractDirectives } from '../src/transpiler/directives.js'

describe('scriptInertMask — un </script> littéral AVANT la vraie fermeture ne raccourcit pas la zone masquée', () => {
  it('</script> dans un gabarit (backtick), @persist cité DANS le gabarit reste inerte', () => {
    const src = [
      '<script>',
      '  docText := `</script>',
      '  @persist $faux',
      '  `',
      '  console.log(docText)',
      '</script>',
      '<p>{docText}</p>',
      '',
    ].join('\n')
    const { cleaned, persistLocalVars } = extractDirectives(src)
    assert.deepEqual(persistLocalVars, [], `persistLocalVars : ${JSON.stringify(persistLocalVars)}`)
    assert.equal(cleaned, src)
  })

  it('</script> dans un commentaire de bloc /* … */, @preload cité juste après (toujours DANS le commentaire) reste inerte', () => {
    const src = [
      '<script>',
      '  /* exemple : </script>',
      '  @preload hover',
      '  */',
      '  $x = 1',
      '</script>',
      '<p>{$x}</p>',
      '',
    ].join('\n')
    const { cleaned, modulePreload } = extractDirectives(src)
    assert.equal(modulePreload, null)
    assert.equal(cleaned, src)
  })

  it('</script> dans un commentaire de ligne //, @i18n cité sur la MÊME ligne reste inerte', () => {
    const src = [
      '<script>',
      "  // </script> @i18n 'faux'",
      '  $x = 1',
      '</script>',
      '<p>{$x}</p>',
      '',
    ].join('\n')
    const { cleaned, moduleI18nSection } = extractDirectives(src)
    assert.equal(moduleI18nSection, null)
    assert.equal(cleaned, src)
  })

  it('</SCRIPT> en majuscules : même protection qu\'en minuscules', () => {
    const src = [
      '<SCRIPT>',
      '  $doc = "</SCRIPT>"',
      '  docText := `',
      "  @import Faux 'dehors.civet'",
      '  `',
      '</SCRIPT>',
      '<p>{$doc}{docText}</p>',
      '',
    ].join('\n')
    const { cleaned, pendingAutoImports } = extractDirectives(src)
    assert.equal(pendingAutoImports.length, 0, `pendingAutoImports : ${JSON.stringify(pendingAutoImports)}`)
    assert.equal(cleaned, src)
  })

  it('deux <script>, piège dans le PREMIER (gabarit) : le faux import reste inerte, le vrai (second script) est vu', () => {
    const src = [
      '<script module>',
      '  $doc = "</script>"',
      '  docText := `',
      "  @import Faux 'dehors.civet'",
      '  `',
      '</script>',
      '<script>',
      "  @import Vrai 'dedans.civet'",
      '</script>',
      '<p>{$doc}{docText}</p>',
      '',
    ].join('\n')
    const { pendingAutoImports } = extractDirectives(src)
    assert.equal(pendingAutoImports.length, 1, `pendingAutoImports : ${JSON.stringify(pendingAutoImports)}`)
    assert.match(pendingAutoImports[0], /dedans\.civet/)
  })
})

describe('maskStyleBlocks — un </style> littéral AVANT la vraie fermeture ne raccourcit pas le bloc masqué', () => {
  it('content: "</style>" en CSS, @persist cité plus loin dans le MÊME <style> reste inerte (bloc entier masqué)', () => {
    const src = [
      '<style>',
      '.a::after { content: "</style>"; }',
      '@persist $faux',
      '.b { color: red; }',
      '</style>',
      '<p>x</p>',
      '',
    ].join('\n')
    const { cleaned, persistLocalVars } = extractDirectives(src)
    assert.deepEqual(persistLocalVars, [], `persistLocalVars : ${JSON.stringify(persistLocalVars)}`)
    assert.equal(cleaned, src)
  })

  it('</STYLE> en majuscules : même protection qu\'en minuscules', () => {
    const src = [
      '<STYLE>',
      '.a::after { content: "</STYLE>"; }',
      '@preload hover',
      '</STYLE>',
      '<p>x</p>',
      '',
    ].join('\n')
    const { cleaned, modulePreload } = extractDirectives(src)
    assert.equal(modulePreload, null)
    assert.equal(cleaned, src)
  })

  it('deux <style> (name distinct), piège dans le PREMIER : le SECOND ressort intact', () => {
    const src = [
      '<style>',
      '.a::after { content: "</style>"; }',
      '@persist $faux',
      '</style>',
      '<style name="sombre">',
      '.b { color: black; }',
      '</style>',
      '<p>x</p>',
      '',
    ].join('\n')
    const { cleaned, persistLocalVars } = extractDirectives(src)
    assert.deepEqual(persistLocalVars, [], `persistLocalVars : ${JSON.stringify(persistLocalVars)}`)
    assert.equal(cleaned, src)
  })
})

// maskStyleBlocks cherchait sa borne sur une vue Civet (maskInertSameLength) : un `#` NON suivi
// d'une lettre y est un commentaire jusqu'à fin de ligne (lexer/index.ts, IDENT_START_RE) — une
// couleur hexadécimale CSS (`#123`) sur la ligne de `</style>` effaçait cette fermeture dans la
// vue, la recherche sautait au `</style>` du bloc SUIVANT et fusionnait les deux, avalant tout ce
// qui les sépare. Même famille pour `url(https://…)` SANS guillemets : son `//` est aussi lu comme
// un commentaire par ce même masqueur Civet. Remède : bornes cherchées sur LA MÊME vue que
// sections.ts (findScriptMatches/findStyleMatches, masqueur CSS/SASS dédié, jamais de règle `#`).
describe('maskStyleBlocks — bornes CSS/SASS (mêmes que sections.ts), pas la vue Civet', () => {
  it('couleur hexadécimale sur la ligne de </style>, DEUX <style> : le @persist RACINE entre les deux reste actif', () => {
    const src = [
      '<style>.a{color:#123}</style>',
      '@persist $rootVar',
      '<style>',
      '.b{color:red}',
      '</style>',
      '<p>x</p>',
      '',
    ].join('\n')
    const { cleaned, persistLocalVars } = extractDirectives(src)
    assert.deepEqual(persistLocalVars, [{ var: '$rootVar', suffix: null }], `persistLocalVars : ${JSON.stringify(persistLocalVars)}`)
    // @persist RACINE actif : retiré du texte nettoyé (comportement normal d'une directive
    // réellement consommée) ; les deux <style> survivent intacts, aucun des deux avalé.
    assert.doesNotMatch(cleaned, /@persist/)
    assert.match(cleaned, /<style>\.a\{color:#123\}<\/style>/)
    assert.match(cleaned, /\.b\{color:red\}/)
  })

  it('couleur hexadécimale sur la ligne de </style>, UN SEUL <style> : rien ne fuit après le bloc', () => {
    const src = [
      '<style>.a{color:#123}</style>',
      '@persist $after',
      '',
    ].join('\n')
    const { persistLocalVars } = extractDirectives(src)
    assert.deepEqual(persistLocalVars, [{ var: '$after', suffix: null }], `persistLocalVars : ${JSON.stringify(persistLocalVars)}`)
  })

  it('url(https://…) SANS guillemets sur la ligne de </style>, DEUX <style> : le @persist RACINE entre les deux reste actif', () => {
    const src = [
      '<style>',
      '.a { background: url(https://example.com/img.png); }</style>',
      '@persist $rootVar',
      '<style>',
      '.b{color:red}',
      '</style>',
      '<p>x</p>',
      '',
    ].join('\n')
    const { cleaned, persistLocalVars } = extractDirectives(src)
    assert.deepEqual(persistLocalVars, [{ var: '$rootVar', suffix: null }], `persistLocalVars : ${JSON.stringify(persistLocalVars)}`)
    assert.doesNotMatch(cleaned, /@persist/)
    assert.match(cleaned, /url\(https:\/\/example\.com\/img\.png\)/)
    assert.match(cleaned, /\.b\{color:red\}/)
  })
})

// casse dépareillée du mot-clé `module` : le bloc ne doit être compté qu'UNE fois (compté deux
// fois, la vue masquée devenait plus longue que le texte et décalait toutes les positions)
describe('<script MODULE> (casse dépareillée) : les directives racine qui suivent restent lues', () => {
  it('<script MODULE> puis @persist racine : la directive est lue', () => {
    const src = ['<script MODULE>', '  export $$x = 1', '</script>', '@persist $after', '<p>x</p>', ''].join('\n')
    const { persistLocalVars } = extractDirectives(src)
    assert.deepEqual(persistLocalVars, [{ var: '$after', suffix: null }])
  })

  it('<script Module> puis @preload racine : la directive est lue', () => {
    const src = ['<script Module>', '  export $$x = 1', '</script>', '@preload hover', '<p>x</p>', ''].join('\n')
    assert.equal(extractDirectives(src).modulePreload, 'hover')
  })

  it('<script MODULE> puis <script> avec un @import écrit en code : l\'import est vu', () => {
    const src = ['<script MODULE>', '  export $$x = 1', '</script>', '<script>', "  @import Vrai 'dedans.civet'", '</script>', '<p>x</p>', ''].join('\n')
    assert.equal(extractDirectives(src).pendingAutoImports.length, 1)
  })
})
