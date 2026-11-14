// le gabarit lu par l'arbre unique : chaque accolade finit là où l'ancienne lecture la referme (extractBalanced), lue
// depuis le même caractère qu'elle (après `{`, `{{`, le mot d'un bloc et ses blancs, `{const nom =`, `{...`) : regex,
// chaînes, commentaires `#`, `###`, `//` et `/* */` compris, dans une expression, une tête de bloc, une branche, un HTML
// calculé ou un attribut ; et les pièges du gabarit (blocs, balises, textes, fautes) lus de même par les deux lectures

import { strict as assert } from 'node:assert'
import { parse, type TagRef } from '../src/parser/index.js'
import { transpile } from '../src/transpiler/index.js'
import { commeFigee } from './helpers/lecture-figee.js'

const R = String.raw

interface Lu { arbre?: unknown, refs?: TagRef[], erreur?: string, console: string[] }

// une lecture du gabarit, ses messages de console retenus
function lire(html: string): Lu {
  const garde = { log: console.log, warn: console.warn, error: console.error }
  const messages: string[] = []
  console.log = console.warn = console.error = (...x: unknown[]) => { messages.push(x.map(String).join(' ')) }
  try {
    const refs: TagRef[] = []
    return { arbre: parse(html, refs), refs, console: messages }
  }
  catch (e) {
    return { erreur: (e as Error).message, console: messages }
  }
  finally {
    Object.assign(console, garde)
  }
}

// le gabarit lu par l'arbre : la lecture figée (le même arbre de Node, les mêmes références, la même erreur, les mêmes messages)
function comparer(html: string): void {
  commeFigee(html, lire(html))
}

// regex, chaînes et commentaires dans chaque sorte de région de code : un gabarit que l'ancienne lecture construit,
// l'arbre le lit lui-même, sans relecture ; un gabarit qu'elle refuse, le même message
const REGEX_ET_COMMENTAIRES: string[] = [
  // expressions
  R`<p>{$s.replace(/\}/g, '')}</p>`,
  R`<p>{$s.replace(/}/g, '')}</p><p>{$t}</p>`,
  `<p>{$t.replace(/"/g, "'")}</p><b title='a'>{$u}</b>`,
  R`<p>{$s.split(/{/).length}</p><p>{$t}</p>`,
  `<p>{$s.match(/a'b/) ? 1 : 2}</p><p>l'été}</p>`,
  R`<p>{$s.split(/[}\]]/).length}</p>`,
  R`<p>{$s.split(/\//).join('}')}</p>`,
  R`<p>{$s.match(/a{2}}/g)}</p>`,
  R`<p>{!/}/.test($s)}</p>`,
  R`<p>{$a and /}/.test($s)}</p>`,
  R`<p>{$a ? /}/.source : '}'}</p>`,
  R`<p>{$s.replace(/a/g, (m) -> m.replace(/}/, ''))}</p>`,
  R`<p>{(-> return /}/)()}</p>`,
  R`<p>{typeof /}/}</p>`,
  '<p>{`${$s.replace(/}/g, \'\')}`}</p>',
  R`<p>{"#{$s.replace(/}/g, '')}"}</p>`,
  '<p>{$s.match(///}///)}</p>',
  R`<p>{$a / 2} et {$b / 3}</p>`,
  R`<p>{$a / 2 + '}'}</p>`,
  R`<p>{f($a) / 2 / 3}</p>`,
  R`<p>{$i++ / 2}</p>`,
  // commentaires
  R`<p>{$a ### } ### + 1}</p>`,
  R`<p>{$a ### { ### + 1}</p><p>{$b}</p>`,
  '<p>{$a # ouvre {\n}</p>\n<p>{$b}</p>',
  `<p>{$n #! c'est le total}</p><p title='x'>{$m}</p>`,
  '<p>{$a # fin }</p>',
  "<p>{$a // c'est\n}</p>",
  R`<p>{$a /* } */ + 1}</p>`,
  R`<p>{$a /* ' */ + 1}</p><p title='x'>{$b}</p>`,
  // chaînes
  '<p>{`a}b`}</p><p>{`x${$y}z`}</p>',
  R`<p>{"#{"}"}#{$x}"}</p>`,
  R`<p>{'c:\\'}</p><p>{'it\'s'}</p><p>{$b}</p>`,
  R`<p>{"a#b"}</p><p>{$o.#prive}</p>`,
  // têtes de bloc et branches : la lecture commence après le mot du bloc et ses blancs, comme celle du compilateur
  R`{if /}/.test($s)}oui{end}`,
  R`{if  /}/.test($s)}oui{end}`,
  R`{if $code.match(/^\d+}$/)}<b>code</b>{else}<i>autre</i>{end}`,
  R`{if $a}a{elsif /}/.test($s)}b{else}c{end}`,
  R`{if ($a) /}/.test($s)}x{end}`,
  R`{if $a ### } ###}x{end}`,
  R`{for x in $l.filter((y) -> /}/.test(y))}<i>{x}</i>{end}`,
  R`<ul>{for m in $txt.split(/[{}]+/)}<li>{m}</li>{end}</ul>`,
  R`{for x in $l.filter((y) -> /}/.test(y)) by id}<i>{x}</i>{end}`,
  R`{for x in /}/.exec($s)}{x}{end}`,
  R`{await $p.then((t) -> t.replace(/}/, ''))}…{success v}{v}{end}`,
  R`{await $p.then((x) -> x.replace(/\}$/, ''))}…{success v}{v}{end}`,
  R`{key /}/.test($s)}x{end}`,
  `{key $m['}']}<b>x</b>{end}`,
  R`{for x in $l}{const y = x.replace(/}/, '')}{y}{end}`,
  R`{const r = /}/}{r.source}`,
  R`{if $a}{/if}`,
  // HTML calculé, texte d'un <textarea>
  R`<div>{{ $h.replace(/}/g, '') }}</div>`,
  R`<textarea>{$s.replace(/}/g, '')}</textarea>`,
  // attributs
  R`<p title={$s.replace(/}/g, '')}>x</p>`,
  R`<p title={{ $h.replace(/}/g, '') }}>x</p>`,
  R`<p :class{/}/.test($s)}="on">x</p>`,
  R`<p :style.color{/}/.test($s)}=red>x</p>`,
  R`<p :style.width{$big}={$n.replace(/}/, '')}px>x</p>`,
  R`<p data-x={$a.match(/>/) ? 1 : 0}>x</p>`,
  R`<a {...$p.filter((x) -> /}/.test(x))}>x</a>`,
  R`<button @click={ $v = $v.replace /}/g, '' }>x</button>`,
  R`<button @click={ $v = $v.replace(/'/g, '') }>x</button>`,
  `<div *glow(color: '#fff', text: "}")>x</div>`,
  R`<div *glow(color: hsl(210 50% 20% / .4))>x</div>`,
  R`<p :in=*fly(y: /}/)>x</p>`,
]

// le corpus piégé : blocs, balises, textes, fautes (une balise raccourci non refermée rendue vide à la fermeture de son
// parent, quand l'ancienne lecture lui comptait une fermante citée dans un <textarea>, est à part, plus bas)
const deep = (n: number, o: string, c: string, milieu = 'x'): string => o.repeat(n) + milieu + c.repeat(n)
let lignes = ''
for (let k = 0; k < 400; k++) lignes += `<tr class="r${k % 7}"><td>{$l[${k}].a}</td><td title="t${k}">{if $l[${k}].b}<b>oui</b>{else}<i>non</i>{end}</td><td><@icone nom="i${k}"></td></tr>\n`
const PIEGES: Record<string, string> = {
  b01_modele_dans_modele: '{? compact}\n  <p>c</p>\n  {if $x}{? large}L{end}{end}\n{? grand}\n  G\n{else}\n  autre\n{end}',
  b02_modele_imbrique_div: '{? compact}\n<div>{? grand}<b>G</b>{else}<i>p</i>{end}</div>\n{end}',
  b03_if_profond_300: deep(300, '{if $a}', '{end}'),
  b04_div_profond_300: deep(300, '<div>', '</div>'),
  b05_mixte_profond_200: deep(200, '<div>{if $a}<@x>', '</@x>{end}</div>'),
  b06_div_profond_4000: deep(4000, '<div>', '</div>'),
  b07_if_profond_4000: deep(4000, '{if $a}', '{end}'),
  b08_for_by: '{for i, x in $l by id}<b>{i}{x.nom}</b>{end}\n{for x in $l  by  id }<i>{x}</i>{end}\n{for x in $l.sort((a, b) -> a.by - b.by) by key}{x}{end}',
  b09_for_by_seul: '{for x in $l by}{x}{end}',
  b10_for_by_ligne: '{for x in $l\n  by id}{x}{end}',
  b11_await_complet: '{await $p}\n  <p>attente</p>\n{success v}\n  {await v.suite}<i>…</i>{success w}{w}{error f}{f}{end}\n{error e}\n  <b>{e.message}</b>\n{end}',
  b12_await_raccourci: '{await $p}<@x>y{success}z{error}e{end}',
  b13_await_erreur_avant: '{await $p}a{error e}{e}{success v}{v}{end}',
  b14_await_erreur_seule: '{await $p}{error e}E{end}',
  b15_await_destructure: '{await $p}{success {a, b}}{a}{b}{end}',
  b16_await_double_success: '{await $p}{success}a{success}b{end}',
  b17_await_success_dans_div: '{await $p}<div>{success}</div>{success}x{end}',
  b18_await_success_dans_if: '{await $p}{if $a}{error}{end}{success}y{end}',
  b19_await_squelette_fo: '<svg><foreignObject>{await $p *skeleton(lines: 2)}{success}<p>{$x}</p>{end}</foreignObject></svg>',
  b20_key_const: `<div>{const x = {a: '}'}}{x.a}{key $id}<b>{x}</b>{end}</div>`,
  b21_blancs_mots: '{if  $a}a{end}{if\t$b}b{end}{if\n$c}c{end}',
  b22_else_espace: '{if $a}a{else }b{end}',
  b23_end_espace: '{if $a}a{end }{end}',
  b24_end_majuscule: '{if $a}a{End}{end}',
  b25_elsif_colle: '{if $a}a{elsif$b}b{end}',
  b26_slash_if: '{if $a}a{/if}',
  b27_fin_en_trop: '{if $x}a{end}{end}',
  b28_jeton_branche_balise: '{if $a}<div>{else}</div>{end}',
  b29_success_hors_await: '<p>{success} {error}</p>',
  b30_modele_virgule_ligne: '{? a,\n b}x{end}',
  c01_elsif_apres_else: '{if $a}a{else}b{elsif $c}c{end}',
  c02_double_else: '{if $a}a{else}b{else}c{end}',
  c03_await_noms: '{await $p}<p>…</p>{success val}<b>{val}</b>{error err}<i>{err.message}</i>{end}',
  c04_await_erreur_avant: '{await $p}a{error err}{err}{success val}{val}{end}',
  c05_await_erreur_seule: '{await $p}{error err}E{end}',
  c06_await_imbrique: '{await $p}{success val}{await val.x}…{success w}{w}{error f}{f}{end}{error err}{err}{end}',
  c07_success_nomme_dans_div: '{await $p}<div>{success val}</div>{end}',
  c08_success_apres_raccourci: '{await $p}<@x>y{success val}{val}{end}',
  t01_raccourci_parent: '<div><@x>a</div><@x>b</@x>',
  t02_raccourci_eof: '<p>z</p><@x>a',
  t03_raccourci_dans_raccourci: '<@x><@y>a</@x>',
  t04_raccourci_commentaire: '<@x>a<!-- </@x> -->',
  t06_raccourci_expression: `<@x>{"</@x>"}`,
  t07_raccourci_attribut: '<div><@x>a</div><b title="</@x>">b</b>',
  t08_head_failed: '<@head><title>T {$t}</title><meta name="a" content={$c}></@head>\n<@failed><p>raté</p></@failed>\n<p>x</p>',
  t09_head_non_ferme_div: '<div><@head>x</div>',
  t10_macros: '<@window @resize={$w = 1}/>\n<@body class="x"/>\n<@document @keydown={$k = 1}/>\n<p>x</p>',
  t11_include: '<div><@include part></div>\n{if $a}<@include part>{end}',
  t12_include_imbrique: '<@include partdeux>',
  t13_commentaire_attribut: '<div <!-- c --> class="a">x</div>',
  t14_commentaire_attribut_chevron: '<div class="a" <!-- x>y --> >z</div>',
  t15_commentaires_bizarres: '<p>a<!--->b<!-->c<!-- x --!>d<!-- a > b -->e</p>',
  t16_textarea_casse: '<TEXTAREA>{$v} <b>x</b></TEXTAREA><textarea></textarea >',
  t17_textarea_bloc: '<textarea>{if $a}x{else}<i>y</i>{end}</textarea>',
  t18_textarea_raccourci: '<textarea><@x>t</textarea>',
  t19_title_fermante_cassee: '<title>a</title</title>',
  t20_script_inline: '<div><script>if (a < b) { x() }</script></div>',
  t21_style_inline: '<div><style>.a{color:red}</style></div>',
  t22_script_template: '<div><script type="text/template"><div>{$x}</div></script></div>',
  t23_cdata_hors_svg: '<div><![CDATA[ a {$b} ]]></div>',
  t24_cdata_svg: '<svg><![CDATA[ a < b {c} ]]><title><![CDATA[ t ]]></title></svg>',
  t25_cdata_svg_non_ferme: '<svg><![CDATA[ a </svg>',
  t26_casse_div: '<DIV>x</DIV>',
  t27_casse_mixte: '<Div>x</div>',
  t28_casse_enfant: '<div><SPAN>a</div>',
  t29_svg_majuscule: '<SVG><TITLE>t <b>b</b></TITLE></SVG>',
  t30_foreignobject_bas: '<svg><foreignobject><title><b>x</b></title></foreignobject></svg>',
  t31_raccourci_casse: '<@Carte>a</@carte>',
  t32_sans_guillemets: '<a href=/x?a=1&b=2 title=a>b</a><input value=a/b><div class=a{$b}c>z</div>',
  t33_attribut_vide: '<div x=>a</div><div x= "a">b</div><div x=a\'b>c</div>',
  t34_entites: '<p>&lt;&#123;&#x7D;&amp;{$x}&nbsp;&{$y};</p>',
  t35_unicode: '<p title="😀">😀 {$x + "👍"} 👨‍👩‍👧</p><p dir="rtl">שלום {$x} עולם</p><p>𝓪𝓫 µ {$µ}</p>',
  t36_separateurs: '<p>a\u2028b {$x}\u2029c</p><p>{"\u2028"}</p>',
  t37_crlf: '<div>\r\n  {if $a}\r\n    <p>{$b}</p>\r\n  {else}\r\n    <i>x</i>\r\n  {end}\r\n  {for x in $l}\r\n    {x}\r\n  {end}\r\n</div>\r\n',
  t38_cr_seul: '<div>\r{if $a}a\r{end}\r</div>',
  t39_bom: '\ufeff<div>{$a}</div>',
  t40_vide: '',
  t41_blancs: '   \n\n  \t ',
  t42_commentaire_seul: '<!-- rien -->',
  t43_slot: '<div><@slot>  </div><@slot name="a">repli</@slot>\n<@slot> <!-- </slot> -->',
  t44_slot_raccourci: '<@x><@slot>a</@x>',
  t45_implicites: '<p>a<p>b</div><select><option>a<option>b</select><dl><dt>a<dd>b</dl>',
  t46_fermantes_espaces: '<div>a</div ><p>b</p\n><i>c</ i>',
  t47_view: '<@view a></@view><@view b></metamjs-view>',
  t49_lettres_deguisement: '<p>\u0219 \u021b ꞉ {$x}</p>',
  t50_texte_mention_balise: '<p>utilisez &lt;@x&gt; puis </p><@x>a</p>',
  t51_raccourci_puis_fermante_ailleurs: '<section><@x>a</section><div></@x></div>',
  e01_else_orphelin: '<p>a</p>\n{else}\n<p>b</p>',
  e02_elsif_dans_for: '{for x in $l}{elsif $a}{end}',
  e03_html_brut_mal_ferme: '<p>\n{{ $x }\n</p>',
  e04_ouvrante_eof: '<p>a</p>\n<div class="x"',
  e05_fermante_orpheline: '<div>\n  <p>a</p>\n</span>\n</div>',
  e06_commentaire_ouvert: '<p>a</p>\n<!-- ouvert\n<p>b</p>',
  e07_for_of: '<ul>\n{for x of $l}<li>{x}</li>{end}\n</ul>',
  e08_const_vide: '<p>\n{const a = }\n</p>',
  e09_else_if: '{if $a}a\n{else if $b}b{end}',
  e10_view_auto: '<div>\n<@view a/>\n</div>',
  e11_for_reserve: '{for µ in $l}{µ}{end}',
  e12_success_reserve: '{await $p}{success µ}{µ}{end}',
  e13_await_ouvert: '<p>\n{await $p}\n<i>a</i>',
  e14_modele_nom: '{? 1bad}x{end}',
  e15_modele_ouvert: '<p>a</p>\n{? a}x',
  e16_accolade_ouverte: '<p>a</p>\n<p>{$a + 1</p>',
  e17_chaine_ouverte: "<p>\n{'abc}\n</p>",
  e18_mal_imbrique: '{if $a}<div>{end}</div>',
  e19_avertissement_puis_erreur: '<div><span>a</div>\n<p>{else if $x}</p>',
  e20_imbrique_non_ferme: '<div>\n<section>\n<p>a</p>\n</div>',
  e21_script_puis_erreur: '<script>\n$a = 1\n$b = 2\n</script>\n\n<div>\n  <p>{else if $x}</p>\n</div>',
  e22_script_puis_ouvrante: '<script>\n$a = 1\n</script>\n<div>\n<span>\n',
  e23_crlf_erreur: '<div>\r\n<p>\r\n{else if $x}\r\n</p>\r\n</div>',
  e24_etalement_texte: '<p>{...$props}</p>',
  e25_for_homonyme: '{for x, x in $l}{x}{end}',
  e26_by_chemin: '{for x in $l by x.id}{x}{end}',
  e27_cdata_svg_ouvert_ligne: '<svg>\n<g>\n<![CDATA[ a\n</g>\n</svg>',
  e28_const_mal_nomme: '<p>{const 1a = 2}</p>',
  e29_const_double_egal: '<p>{const a == 2}</p>',
  g01_gros_400_lignes: `<table>\n${lignes}</table>`,
  g03_raccourcis_avec_fermante_finale: `<div>${'<@x a="1">t '.repeat(300)}</div></@x>`,
}

describe('le gabarit lu par l\'arbre unique : regex, chaînes et commentaires d\'une région de code lus comme l\'ancienne lecture', () => {
  for (const html of REGEX_ET_COMMENTAIRES) {
    it(`même lecture : ${JSON.stringify(html.slice(0, 80))}`, () => {
      comparer(html)
    })
  }

  // les gabarits qui se construisaient faux sans erreur : la condition est la regex écrite, jamais une division
  for (const html of [R`{if /}/.test($s)}oui{end}`, R`{if $a}a{elsif /}/.test($s)}b{else}c{end}`, R`{key /}/.test($s)}x{end}`]) {
    it(`compilé comme par l'ancienne lecture, la regex gardée : ${JSON.stringify(html)}`, async () => {
      const r      = await transpile(html, { moduleName: 'regex-tete', defaultScriptLang: 'civet', templateLang: 'civet', devWarnings: false })
      const sortie = JSON.stringify({ output: r.output, data: r.data, sourceMap: r.sourceMap ?? null })
      assert.ok(sortie.includes('/}/.test($.s)'), 'la regex de la tête est perdue')
      assert.ok(!sortie.includes('(a,b) => a/b'), 'la tête est lue comme une division')
    })
  }
})

describe('le corpus piégé du gabarit : la même lecture par l\'arbre et par l\'ancienne lecture', () => {
  for (const [nom, html] of Object.entries(PIEGES)) {
    it(`même lecture : ${nom}`, () => { comparer(html) })
  }

  it('une balise raccourci dont la fermante n\'est citée que dans un <textarea> plus loin : rendue vide à la fermeture de son parent', () => {
    const html   = '<div><@x>a</div><textarea></@x></textarea>'
    const lu     = lire(html)
    assert.equal(lu.erreur, undefined)
    const racine = lu.arbre as { children: { name: string | null, content?: string, children: { name: string | null, content?: string, children: unknown[] }[] }[] }
    assert.deepEqual(racine.children[0].children.map((n) => [n.name ?? n.content, n.children.length]), [['mjs-x', 0], ['a', 0]])
  })
})
