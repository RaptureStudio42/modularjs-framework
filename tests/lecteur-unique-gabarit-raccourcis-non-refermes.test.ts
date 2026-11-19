// une balise raccourci jamais refermée, lue par l'arbre unique, est rendue vide là où finit son parent. Quand l'ancienne
// lecture lui comptait une fermante citée plus loin (dans un <textarea>, un <title>, une section <![CDATA[, ou celle
// d'un raccourci du même nom), l'utilisateur en est averti : rendue vide à la fermante d'un ancêtre, l'avertissement de
// l'ancienne lecture, même texte, même ligne, même ordre ; rendue vide avant un {end}, une branche ou la fin du gabarit,
// là où l'ancienne lecture refusait le gabarit, un avertissement du même type. Les têtes {key} et {elsif} qui commencent
// par une regex sont lues comme le compilateur les lit ; un gabarit que l'arbre lit sans faute mais dont un bloc est
// refusé reçoit le message de l'ancienne lecture ; un attribut refusé dans la suite d'une balise raccourci refermée plus
// loin, que la sonde de l'ancienne lecture refuse à cette balise, reçoit ce même refus de l'arbre, sans relecture

import { strict as assert } from 'node:assert'
import { parse, type Node, type ParseDiag, type TagRef } from '../src/parser/index.js'
import { commeFigee } from './helpers/lecture-figee.js'
import { t } from '../src/messages/index.js'
import { transpile } from '../src/transpiler/index.js'

const R = String.raw

interface Lu { arbre?: Node, refs?: TagRef[], erreur?: string, console: string[] }

// une lecture du gabarit, ses messages de console retenus, la raison de la relecture par l'ancienne lecture
function lire(html: string, diag: ParseDiag = {}): Lu {
  const garde = { log: console.log, warn: console.warn, error: console.error }
  const messages: string[] = []
  console.log = console.warn = console.error = (...x: unknown[]) => { messages.push(x.map(String).join(' ')) }
  try {
    const refs: TagRef[] = []
    const arbre = parse(html, refs, diag)
    return { arbre, refs, console: messages }
  }
  catch (e) {
    return { erreur: (e as Error).message, console: messages }
  }
  finally {
    Object.assign(console, garde)
  }
}

// l'arbre de Node en une ligne : `nom(enfants)`, un texte entre guillemets, un bloc `{sorte|branche|branche}`
function rendu(n: Node): string {
  const liste = (l: Node[]): string => l.map(rendu).join(',')
  if (n.type === 'text') return JSON.stringify(n.content)
  if (n.type === 'expr') return `{${n.expr}}`
  if (n.branches.length > 0) return `{${n.type}|${n.branches.map((b) => liste(b.children)).join('|')}}`
  return `${n.name ?? n.type}(${liste(n.children)})`
}

// l'avertissement d'une balise raccourci rendue vide avant un jeton de bloc (ou la fin du gabarit, jeton vide)
const avantJeton = (attendu: string, ligneOuverture: number, jeton = '', ligne = 0): string => `${t('parser.shorthand-not-closed', { expected: attendu, openLine: ligneOuverture, token: jeton, line: ligne })} [lint.syntax]`

// rendue vide à la fermante d'un ancêtre : l'ancienne lecture la gardait ouverte jusque-là et avertissait ; l'arbre
// la rend vide (le contenu reste au parent), avec ses avertissements à elle, dans son ordre
const A_LA_FERMANTE: [string, string][] = [
  ['<div><@x>a</div><title></@x></title>', 'root(div(mjs-x(),"a"),title("</@x>"))'],
  ['<svg><@x>a</svg><svg><![CDATA[</@x>]]></svg>', 'root(svg(mjs-x(),"a"),svg("<![CDATA[</@x>]]>"))'],
  ['<div><@x>a</div><textarea></@x></textarea>', 'root(div(mjs-x(),"a"),textarea("</@x>"))'],
  ['<svg><@x>a<![CDATA[</@x>]]></svg>', 'root(svg(mjs-x(),"a","<![CDATA[</@x>]]>"))'],
  ['<p><@x><title></@x></title></p>', 'root(p(mjs-x(),title("</@x>")))'],
  ['<li><@x><textarea></@x></textarea></li>', 'root(li(mjs-x(),textarea("</@x>")))'],
  ['<span><svg><@@chart><![CDATA[</@@chart>]]></span>', 'root(span(svg(mjs-core-chart(),"<![CDATA[</@@chart>]]>")))'],
  ['<section><@@chart>a</section><title></@@chart></title>', 'root(section(mjs-core-chart(),"a"),title("</@@chart>"))'],
  ['<div><@x>a</div><textarea></mjs-x></textarea>', 'root(div(mjs-x(),"a"),textarea("</mjs-x>"))'],
  ['<div><@x><span>a</div><title></@x></title>', 'root(div(mjs-x(),span("a")),title("</@x>"))'],
  ['<div><@y><b><@x>t</div><title></@x></@y></title>', 'root(div(mjs-y(),b(mjs-x(),"t")),title("</@x>","</@y>"))'],
  ['<div><@y>a<@x>b</div><title></@x></@y></title>', 'root(div(mjs-y(),"a",mjs-x(),"b"),title("</@x>","</@y>"))'],
  ['<div>\n  <@x a="1">\n    a\n</div>\n<title>\n  </@x>\n</title>\n', 'root(div("\\n  ",mjs-x(),"\\n    a\\n"),"\\n",title("\\n  ","</@x>","\\n"))'],
]

// l'arbre construit là où l'ancienne lecture refuse le gabarit, les avertissements de l'ancienne lecture donnés avant
// son refus : le raccourci de même nom imbriqué, rendu vide à la fermante de son parent
const MEME_NOM_A_LA_FERMANTE: [string, string] = ['<@y><div><@y>t</div></@y>', 'root(mjs-y(div(mjs-y(),"t")))']

// rendue vide avant un {end}, une branche ou la fin du gabarit : l'ancienne lecture refusait le gabarit (balise non
// fermée, jeton hors de son bloc) ; l'arbre le construit, la balise vide, et avertit
const AVANT_UN_JETON: [string, string, string[]][] = [
  ['<@x>a<title></@x></title>', 'root(mjs-x(),"a",title("</@x>"))', [avantJeton('mjs-x', 1)]],
  ['<@carte><textarea></@carte></textarea>', 'root(mjs-carte(),textarea("</@carte>"))', [avantJeton('mjs-carte', 1)]],
  ['<@x><title></@x></title><p>{await $p}{end}</p>', 'root(mjs-x(),title("</@x>"),p({await|}))', [avantJeton('mjs-x', 1)]],
  ['{if $a}<@x>t{end}<title></@x></title>', 'root({if|mjs-x(),"t"},title("</@x>"))', [avantJeton('mjs-x', 1, '{end}', 1)]],
  ['{if $a}<@x>t{else}u{end}<textarea></@x></textarea>', 'root({if|mjs-x(),"t"|"u"},textarea("</@x>"))', [avantJeton('mjs-x', 1, '{else}', 1)]],
  ['{await $p}<@x><title></@x></title>{success }{end}', 'root({await|mjs-x(),title("</@x>")|})', [avantJeton('mjs-x', 1, '{success …}', 1)]],
  ['{if $a}<@y>{if $b}<@y>t{end}</@y>{end}', 'root({if|mjs-y({if|mjs-y(),"t"})})', [avantJeton('mjs-y', 1, '{end}', 1)]],
  ['{if $a}\n  <@x>\n  t\n{end}\n<title></@x></title>', 'root({if|"\\n  ",mjs-x(),"\\n  t\\n"},"\\n",title("</@x>"))', [avantJeton('mjs-x', 2, '{end}', 4)]],
]

// l'ancienne lecture la rendait vide aussi (aucune fermante comptée) : ni avertissement ni écart
const SANS_FERMANTE_COMPTEE: string[] = [
  '<div>\n  <@carte titre="a">\n    <p>{$a}</p>\n  <@carte titre="b">\n    <p>{$b}</p>\n  </@carte>\n</div>\n',
  '<div><@x a="1">t</div><@x>u</@x>',
  '<div><@x>a</div><!-- </@x> -->',
  '<div><@x>a</div><p title="</@x>">b</p>',
  '<div><@x>a</div><p>{\'</@x>\'}</p>',
  '<div><@icone nom="a">texte qui suit</div><span>b</span>',
  '{if $a}<@icone>{else}<@icone2>dehors{end}',
  '<div><@slot>a</div><title></@slot></title>',
]

describe('balise raccourci jamais refermée, lue par l\'arbre : rendue vide, et l\'utilisateur averti quand l\'ancienne lecture comptait une fermante', () => {
  for (const [html, attendu] of A_LA_FERMANTE) {
    it(`à la fermante d'un ancêtre, l'avertissement de l'ancienne lecture : ${JSON.stringify(html)}`, () => {
      const arbre = lire(html)
      assert.ok(arbre.console.length > 0 && arbre.console.every((l) => l.endsWith('[lint.syntax]')), arbre.console.join('\n'))
      assert.equal(arbre.erreur, undefined)
      assert.equal(rendu(arbre.arbre!), attendu)
      commeFigee(html, arbre)
    })
  }

  it('lint.syntax coupé : ni l\'une ni l\'autre lecture n\'avertit', () => {
    const diag: ParseDiag = { lint: { syntax: false } }
    for (const [html] of A_LA_FERMANTE) {
      assert.deepEqual(lire(html, diag).console, [], html)
    }
    assert.deepEqual(lire(AVANT_UN_JETON[0][0], diag).console, [])
  })

  it(`raccourci de même nom imbriqué : l'arbre construit, avec l'avertissement que l'ancienne lecture donnait avant de refuser : ${JSON.stringify(MEME_NOM_A_LA_FERMANTE[0])}`, () => {
    const [html, attendu] = MEME_NOM_A_LA_FERMANTE
    const arbre = lire(html)
    assert.equal(arbre.erreur, undefined)
    assert.equal(rendu(arbre.arbre!), attendu)
    commeFigee(html, arbre)
  })

  for (const [html, attendu, avertissements] of AVANT_UN_JETON) {
    it(`avant un {end}, une branche ou la fin du gabarit : construit, rendue vide, averti : ${JSON.stringify(html)}`, () => {
      const arbre = lire(html)
      assert.equal(arbre.erreur, undefined)
      assert.equal(rendu(arbre.arbre!), attendu)
      assert.deepEqual(arbre.console, avertissements)
    })
  }

  for (const html of SANS_FERMANTE_COMPTEE) {
    it(`aucune fermante comptée par l'ancienne lecture : la même lecture, sans avertissement : ${JSON.stringify(html.slice(0, 60))}`, () => {
      const arbre = lire(html)
      assert.deepEqual(arbre.console, [])
      commeFigee(html, arbre)
    })
  }
})

describe('une ouvrante ou une tête de bloc que l\'ancienne lecture comptait mal : la balise refermée, comme écrite', () => {
  // l'ancienne lecture comptait l'ouvrante citée dans le texte d'un <textarea>, d'un <title> ou d'une section
  // <![CDATA[ et refusait la fermante qui suit (fermante orpheline) ; l'arbre referme la balise
  const CITEES: [string, string][] = [
    ['<@x>a<textarea><@x></textarea></@x>', 'root(mjs-x("a",textarea("<@x>")))'],
    ['<@x>a<title><@x></title></@x>', 'root(mjs-x("a",title("<@x>")))'],
    ['<@x>a<svg><![CDATA[<@x>]]></svg></@x>', 'root(mjs-x("a",svg("<![CDATA[<@x>]]>")))'],
  ]
  for (const [html, attendu] of CITEES) {
    it(`ouvrante citée dans un texte : ${JSON.stringify(html)}`, () => {
      const arbre = lire(html)
      assert.equal(arbre.erreur, undefined)
      assert.equal(rendu(arbre.arbre!), attendu)
      assert.deepEqual(arbre.console, [])
    })
  }

  // le `/` d'une tête {key} ou {elsif} : dans un gabarit en Civet, après un nom suivi d'une espace, la barre ouvre une regex — les
  // deux lectures la lisent comme le compilateur, la regex gardée et la balise refermée
  const TETES: [string, string][] = [
    [R`<@x>{key /{/.test($s)}a{end}</@x>`, R`/{/.test($.s)`],
    [R`<@x>{if $a}a{elsif /{/.test($s)}b{end}</@x>`, R`/{/.test($.s)`],
    [R`<@x>{key />/.test($s)}a{end}</@x>`, R`/>/.test($.s)`],
  ]
  for (const [html, regex] of TETES) {
    it(`tête à regex dans une balise raccourci, compilée : ${JSON.stringify(html)}`, async () => {
      const r = await transpile(html, { moduleName: 'tete-regex', defaultScriptLang: 'civet', templateLang: 'civet', devWarnings: false })
      assert.ok(r.output.includes('<mjs-x><!--$--><!--$--></mjs-x>'), 'le bloc reste dans la balise raccourci')
      assert.ok(r.output.includes(regex), `la regex de la tête est perdue : ${regex}`)
      assert.ok(!r.output.includes('(a,b) => a/b'), 'la tête est lue comme une division')
    })
  }
})

describe('un gabarit que l\'arbre lit sans faute et dont un bloc est refusé : le message de l\'ancienne lecture', () => {
  it('un {success} lu dans une balise raccourci que l\'ancienne lecture gardait ouverte : son refus, pas celui du nom réservé', () => {
    const html  = '{await $p}<@@chart><p></p><title></@@chart></title>{success }{error e}{end}'
    const arbre = lire(html)
    assert.ok(arbre.erreur !== undefined && arbre.erreur.includes('JETON HORS DE SON BLOC'), arbre.erreur)
    commeFigee(html, arbre)
  })

  for (const html of ['{for el in $l}{el}{end}', '{await $p}a{success this}b{end}', '{const µx = 1}', '<div><@x>a</div><p>{for el in $l}{el}{end}</p>']) {
    it(`refusé par les deux lectures sur le même arbre : le même message, sans relecture, ${JSON.stringify(html)}`, () => {
      const arbre = lire(html)
      commeFigee(html, arbre)
    })
  }

  // l'ancienne lecture sonde la suite d'une balise raccourci écrite sans `/>` pour y chercher sa fermante, et refuse le
  // gabarit dès cette sonde, au premier attribut refusé qu'elle y lit ; l'arbre, qui referme la balise plus loin, refuse
  // ce même attribut en le lisant : le même message, sans les avertissements de ce qu'il a lu entre les deux
  const REFUS_DE_LA_SONDE: string[] = [
    '<@y>\n<nav>\n<a @class{$x}="active">t</a>\n</nav>\n</@y>',
    '<div><span></div>\n<@y><a @class{$x}="b">t</a></@y>',
    '<@y><div><span></div><a @class{$x}="b">t</a></@y>',
    '<p>a</p>\n<@@chart>\n  <@y>\n    <a @this=!{f}>t</a>\n  </@y>\n</@@chart>',
  ]
  for (const html of REFUS_DE_LA_SONDE) {
    it(`attribut refusé dans une balise raccourci refermée plus loin : le refus de la sonde de l'ancienne lecture, sans relecture, ${JSON.stringify(html)}`, () => {
      const arbre = lire(html)
      commeFigee(html, arbre)
    })
  }

  it('un autre refus lu par l\'arbre avant l\'attribut que la sonde refuse : le message de l\'ancienne lecture', () => {
    const html  = '<@y>{const µx = 1}<a @class{$x}="b">t</a></@y>'
    const arbre = lire(html)
    assert.ok(arbre.erreur !== undefined && arbre.erreur.includes('@class'), arbre.erreur)
    commeFigee(html, arbre)
  })

  // la sonde des balises raccourci lit dans le dialecte du gabarit, comme l'ancienne lecture : en Civet, `f /"/` passe une
  // regex ; lue en JavaScript, c'est une division suivie d'une chaîne, qui cache l'attribut refusé ou ne se referme pas
  it('une regex passée sans parenthèses avant l\'attribut que la sonde refuse : le refus de l\'ancienne lecture, sans avertissement de plus', () => {
    const html  = '<@y><div><span></div>{f /"/}<a @class{$x}="b">t</a>{"}"}</@y>'
    const arbre = lire(html)
    assert.ok(arbre.erreur !== undefined && arbre.erreur.includes('@class'), arbre.erreur)
    assert.deepStrictEqual(arbre.console, [])
    commeFigee(html, arbre)
  })

  it('une regex passée sans parenthèses dans une balise raccourci rendue vide : l\'avertissement de l\'ancienne lecture', () => {
    const html  = '<div><@x>{f /"/}</div><title></@x></title>'
    const arbre = lire(html)
    assert.equal(arbre.console.length, 1, arbre.console.join('\n'))
    commeFigee(html, arbre)
    assert.equal(rendu(arbre.arbre!), 'root(div(mjs-x(),{f /"/}),title("</@x>"))')
  })

  // l'arbre refuse avant la première balise raccourci dont la sonde refuserait la suite : l'ancienne lecture n'atteint
  // jamais cette balise et refuse au même endroit
  for (const html of ['<p>\n<a @this=!{f}>t</a>\n</p>\n<@y>\n<b @this=!{g}>u</b>\n</@y>', '<div><span></div>\n<a @class{$x}="b">t</a>\n<@y><a @class{$z}="c">t</a></@y>']) {
    it(`un attribut refusé avant la balise raccourci dont la sonde refuse plus loin : le refus des deux, sans relecture, ${JSON.stringify(html)}`, () => {
      const arbre = lire(html)
      commeFigee(html, arbre)
    })
  }
})
