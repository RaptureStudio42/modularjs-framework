// Lecture du gabarit par le parseur : six fautes qui passaient sans un mot ou cassaient la construction.
//   - un jeton de flux étranger au bloc (`{else}` dans un `{for}`, un `{await}` ou un `{key}`, `{success}`
//     dans un `{if}`) disparaissait et son contenu se fondait dans le bloc : « vide » après chaque élément
//   - le contenu d'un raccourci `<@x>` était mal sondé : `{$n<3 ? …}` lu comme une balise `<3`, un bout
//     de gabarit en commentaire lu comme des balises
//   - un texte qui commence par `<` suivi d'un chiffre ou d'un tiret (`<- Retour`, `<5 ans`) était lu
//     comme une balise
//   - chaque raccourci nu `<@icone>` relisait tout le reste du gabarit : temps quadratique
//   - un `{for}` écrit sur plusieurs lignes était refusé, `by x.id` échouait plus loin sur un message
//     de Civet sans rapport
//   - une balise ouvrante coupée en fin de gabarit (`>` oublié) disparaissait sans erreur

import assert from 'node:assert/strict'
import { parse } from '../src/parser/index.js'

function enfants(n: any): string[] {
  return (n.children ?? []).map((c: any) => c.type === 'text' ? 'text:' + c.content : c.type === 'tag' ? 'tag:' + c.name : c.type)
}

describe('parseur — jeton de flux hors de son bloc : erreur claire, jamais avalé', () => {
  it('{else} dans un {for} lève et nomme le jeton et le bloc', () => {
    assert.throws(() => parse('{for x in $l}\n<p>{x}</p>\n{else}\n<p>vide</p>\n{end}'), (e: any) => /\{else\}/.test(e.message) && /\{for\}/.test(e.message) && /ligne 3/.test(e.message))
  })

  it('{else} dans un {for} à clé lève aussi', () => {
    assert.throws(() => parse('{for x in $l by id}<p>{x.n}</p>{else}<p>vide</p>{end}'), /\{else\}/)
  })

  it('{else} dans un {await} lève', () => {
    assert.throws(() => parse('{await $p}<p>attente</p>{else}<p>autre</p>{end}'), (e: any) => /\{else\}/.test(e.message) && /\{await\}/.test(e.message))
  })

  it('{else} dans un {key} lève', () => {
    assert.throws(() => parse('{key $k}<p>a</p>{else}<p>b</p>{end}'), (e: any) => /\{else\}/.test(e.message) && /\{key\}/.test(e.message))
  })

  it('{success x} dans un {if} lève', () => {
    assert.throws(() => parse('{if $a}<p>a</p>{success x}<p>b</p>{end}'), (e: any) => /\{success/.test(e.message) && /\{if\}/.test(e.message))
  })

  it('{else} dans une balise nomme le jeton, plus « balise non fermée »', () => {
    assert.throws(() => parse('<div>{else}</div>'), (e: any) => /\{else\}/.test(e.message) && /<div>/.test(e.message) && !/NON FERMÉE/.test(e.message))
  })

  it('témoins : les branches attendues restent acceptées', () => {
    assert.doesNotThrow(() => parse('{if $a}<p>a</p>{elsif $b}<p>b</p>{else}<p>c</p>{end}'))
    assert.doesNotThrow(() => parse('{await $p}<p>…</p>{success v}<p>{v}</p>{error err}<p>{err}</p>{end}'))
    assert.doesNotThrow(() => parse('{await $p}<p>…</p>{success}<p>ok</p>{error}<p>ko</p>{end}'))
    assert.doesNotThrow(() => parse('{for x in $l}{if x}<p>{x}</p>{else}<p>rien</p>{end}{end}'))
  })
})

describe('parseur — contenu d\'un raccourci <@x> : expressions et commentaires sautés par la sonde', () => {
  it('{$n<3 ? …} sans espaces dans un raccourci se construit', () => {
    const root = parse("<@carte>{$n<3 ? 'peu' : 'beaucoup'}</@carte>")
    assert.equal(root.children.length, 1)
    assert.deepEqual(enfants(root.children[0]), ['expr'])
  })

  it('un bout de gabarit en commentaire dans un raccourci se construit', () => {
    const root = parse('<@carte><!-- <div a a></div> --><p>x</p></@carte>')
    assert.equal(root.children.length, 1)
    assert.ok(enfants(root.children[0]).includes('tag:p'))
  })

  it('témoin : un raccourci nu reste vide, ses frères restent au niveau du parent', () => {
    const root = parse('<ul><li><@icon name="a"> texte</li></ul>')
    const li = root.children[0].children[0]
    assert.deepEqual(enfants(li).map(s => s.replace(/^tag:.*/, 'tag')), ['tag', 'text: texte'])
  })
})

describe('parseur — `<` suivi d\'un chiffre ou d\'un tiret : du texte, comme dans le navigateur', () => {
  it('<a href="/"><- Retour</a>', () => {
    const root = parse('<a href="/"><- Retour</a>')
    assert.deepEqual(enfants(root.children[0]), ['text:<- Retour'])
  })

  it('<p>{$n}<5 ans</p>', () => {
    const root = parse('<p>{$n}<5 ans</p>')
    assert.equal(root.children.length, 1)
    assert.deepEqual(enfants(root.children[0]), ['expr', 'text:<5 ans'])
  })
})

describe('parseur — raccourcis nus nombreux : temps linéaire', function () {
  this.timeout(120000)
  it('1 200 raccourcis nus se lisent en moins de 2,5 s', () => {
    const lignes = Array.from({ length: 1200 }, () => '<li><@icon name="a"> texte</li>').join('\n')
    const debut = Date.now()
    parse(`<ul>\n${lignes}\n</ul>`)
    const ms = Date.now() - debut
    assert.ok(ms < 2500, `${ms} ms`)
  })
})

describe('parseur — {for} sur plusieurs lignes et clé `by`', () => {
  it('un parcours écrit sur plusieurs lignes est accepté', () => {
    const root = parse('{for x in $items.filter((i) ->\n    i.ok)}\n<p>{x}</p>\n{end}')
    const f = root.children[0]
    assert.equal(f.type, 'for')
    assert.equal(f.item, 'x')
    assert.match(f.iterable, /^\$items\.filter\(\(i\) ->\s+i\.ok\)$/)
  })

  it('une liste littérale sur plusieurs lignes est acceptée', () => {
    const root = parse('{for x in [\n  1,\n  2\n]}<p>{x}</p>{end}')
    assert.equal(root.children[0].type, 'for')
  })

  it('by x.id lève un message qui dit d\'écrire by id', () => {
    assert.throws(() => parse('{for x in $l by x.id}<p>{x}</p>{end}'), (e: any) => /by x\.id/.test(e.message) && /by id/.test(e.message))
  })

  it('témoin : by id garde sa clé', () => {
    const f = parse('{for x in $l by id}<p>{x}</p>{end}').children[0]
    assert.equal(f.key, 'id')
    assert.equal(f.iterable, '$l')
  })
})

describe('parseur — balise ouvrante coupée en fin de gabarit', () => {
  it('<div class="x" sans > en dernière ligne lève et nomme la balise', () => {
    assert.throws(() => parse('<p>a</p>\n<div class="x"'), (e: any) => /<div/.test(e.message) && /ligne 2/.test(e.message))
  })

  it('témoin : la même balise refermée se construit', () => {
    assert.doesNotThrow(() => parse('<p>a</p>\n<div class="x"></div>'))
  })
})
