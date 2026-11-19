// le gabarit lu par le lecteur unique (src/reader) : l'adaptateur rend au générateur le même arbre de Node que
// l'ancienne lecture, avec les mêmes lignes, les mêmes références de balises, les mêmes messages ; une balise
// raccourci non refermée est rendue vide à la fermeture de son parent, en une seule lecture

import { strict as assert } from 'node:assert'
import { parse, type ParseDiag, type TagRef } from '../src/parser/index.js'
import { commeFigee } from './helpers/lecture-figee.js'
import { readFile, traverse, type Node } from '../src/reader/index.js'

interface Lu { arbre?: unknown, refs?: TagRef[], erreur?: string, console: string[] }

// une lecture du gabarit, ses messages de console retenus
function lire(html: string, diag: ParseDiag = {}): Lu {
  const garde = { log: console.log, warn: console.warn, error: console.error }
  const messages: string[] = []
  console.log = console.warn = console.error = (...x: unknown[]) => { messages.push(x.map(String).join(' ')) }
  try {
    const refs: TagRef[] = []
    return { arbre: parse(html, refs, diag), refs, console: messages }
  }
  catch (e) {
    return { erreur: (e as Error).message, console: messages }
  }
  finally {
    Object.assign(console, garde)
  }
}

// le gabarit lu par l'arbre : la lecture figée
function comparer(html: string, diag: ParseDiag = {}): void {
  commeFigee([html, diag], lire(html, diag))
}

const BIEN_FORMES: string[] = [
  '<div class="carte">Bonjour {$nom} !</div>',
  '<ul>\n  <li>un</li>\n  <li>{$deux}</li>\n</ul>\n<p>fin</p>',
  'texte seul, avec un < isolé, <- une flèche et {$n}<5 ans',
  '<br><img src="a.png" alt=x/><input value=!{$age} disabled><hr/>',
  '<!-- note -->a<!-- deux -->b<!---->c<!-->d',
  '<!DOCTYPE html><?xml version="1.0"?><div>x</div>',
  '<@carte titre="a">\n  <p>dedans</p>\n</@carte>\n<@@chart series={[1, 2]} other/>',
  '<div><@icone nom="a">texte qui suit</div><span>b</span>',
  '<div><@icone nom="a"><@bulle>x</@bulle>y</div>',
  '<mjs-carte></mjs-carte><mjs-core-gauge value={$v}></mjs-core-gauge><mon-element></mon-element>',
  '<@carte>a</mjs-carte><@@gauge>b</mjs-core-gauge>',
  '<ul><li>a<li>b</ul><table><tr><td>1<td>2</table>',
  '<div><@slot>repli</div>',
  '<div class="x"><@slot titre/></div>\n<@slot>',
  '<@slot {i}/><@view principale></@view>',
  '<textarea>a <b x={$v}>gras</b> <!-- pas un commentaire --> {$t} </textarea><title>T <i>it</i></title>',
  '<textarea><!-- </textarea>',
  '<textarea>avant<!--mjs-keep-lines\n\n-->après</textarea><title>t<!--mjs-keep-lines\n-->u</title><textarea><!--mjs-keep-lines\n--> x</textarea>',
  '<p>{`x<!--mjs-keep-lines\n-->y`}</p><p>{{ "a<!--mjs-keep-lines\n-->b" }}</p>{if $a == "<!--mjs-keep-lines\n-->"}a{elsif $b == "<!--mjs-keep-lines\n\n-->"}b{end}{for x in f("<!--mjs-keep-lines\n-->")}{x}{end}{key $k + "<!--mjs-keep-lines\n-->"}k{end}{const c = "<!--mjs-keep-lines\n-->"}{c}{await $p("<!--mjs-keep-lines\n-->")}{success v}{v}{end}',
  '<svg viewBox="0 0 10 10"><title>titre <b>svg</b></title><![CDATA[ a < b {c} ]]><foreignObject><textarea><i>t</i></textarea></foreignObject></svg>',
  '{if $a}\n  a\n{elsif $b}\n  b\n{else}\n  c\n{end}',
  '{if $a}<@icone>{else}<@icone2>dehors{end}',
  '{for item in $liste by id}<li>{item.nom}</li>{end}{for i, x in $l}{i}{x}{end}{for index in $l}{index}{end}',
  '{for p in $items.filter((i) ->\n  i.ok)}<b>{p}</b>{end}',
  '{await $p}{success}<div><h2>{$titre}</h2><p>{$texte}</p></div>{end}',
  '{await.keep $p *skeleton(lines: 2)}{success}<p>{$x}</p>{end}',
  '{await.keep\n  charger($id)}<p>{µpending}</p>{success v}{v}{end}',
  '<div>{success}{error}</div>{key $id}<b>{$id}</b>{end}',
  '{if $a}{success}{end}',
  '{const total = $a + $b}<p>{total}</p>{const o = {a: 1}}{o.a}',
  '{{ $html }}<div>{{$brut}}</div>{}{ }',
  '<div *fade *glow(color: hsl(210 50% 20% / .4), size: 3) *filter.net(blur: 3)>x</div>',
  '<p :in=*fly(up, duration: 2s) :out=*fade @click={$n += 1} :class{$on}="actif" :style.color{$on}=red :style.width{$big}={$n}px>x</p>',
  '<a href="/x?a=1&b={$b}" title=\'t "q"\' data-user_id="3" {...$props}>lien</a>',
  '<div title="a > b" data-x={$a > $b ? "<" : ">"}>x</div>',
  '<p>{$s.replace(/\'/g, \'\')}</p><p>{"#{$a}"}</p><p>{`${$b}`}</p>',
  '<p>{$x # note}</p><p>{$y // note}</p>',
]

describe('le gabarit lu par l\'arbre unique : le même arbre de Node que l\'ancienne lecture', () => {
  // un gabarit bien formé n'est pas refusé ; sa lecture est celle qui est figée
  for (const html of BIEN_FORMES) {
    it(`lu par l'arbre : ${JSON.stringify(html.slice(0, 70))}`, () => {
      const lu = lire(html)
      assert.equal(lu.erreur, undefined, 'refusé')
      commeFigee([html, {}], lu)
    })
  }

  it('modèles en fichier, *guard d\'office, lignes du fichier : même arbre', () => {
    const diag: ParseDiag = { models: { dev: { carte: ['compacte'] }, core: {} }, guarded: ['$age'], guardSilent: true, firstLine: 7 }
    comparer('<@carte layout="compacte">a</@carte>\n<@carte layout={$vue}/>\n<input value=!{$age}>', diag)
  })

  it('une balise refermée par la fermante d\'un ancêtre : le même avertissement', () => {
    const lu = lire('<div><span>a</div>')
    assert.ok(lu.console.some((l) => l.includes('span')), 'avertissement de fermeture mal appariée')
    comparer('<div><span>a</div>')
  })

  const FAUTES: string[] = [
    '<div>',
    '<div class="x"',
    '</div>',
    '{if $a}a',
    '{if $a}<div>{else}</div>{end}',
    '{for x of $l}{x}{end}',
    '{for el in $l}{el}{end}',
    '{for x in $l by x.id}{x}{end}',
    '{const 1 = 2}',
    '{const a = }',
    '{else if $x}',
    '{/if}',
    '{{ $x }',
    '{...$p}',
    '<div a a></div>',
    '<div {$cls}></div>',
    '<!-- ouvert',
    '<@view principale/>',
    '{end}',
    '<svg>{await $p *skeleton}x{success}y{end}</svg>',
    '{await.kep $p}x{success v}y{end}',
    '<p>{await.KEEP $p}</p>',
    '{await.keep}x{success}y{end}',
    '{await}',
    '{await }x{end}',
    '{await *skeleton}{success v}{v}{end}',
    '{await.keep *skeleton(lines: 2)}{success v}{v}{end}',
    '<div *fade (x)>a</div>',
    // refusés : `e` est un nom réservé ; un squelette et une branche d'attente déjà écrite
    '{await $promesse}attente{success val}ok {val}{error e}raté {e}{end}',
    '{await $p *skeleton(lines: 3)}<p>attente</p>{success}<p>{$x}</p>{end}',
    '{await.keep chercher($q, µsignal)}attente{success v}<b>{v}</b>{error e}{e}{end}',
  ]
  for (const html of FAUTES) {
    it(`faute : le même message, ${JSON.stringify(html)}`, () => {
      const arbre = lire(html)
      assert.ok(arbre.erreur !== undefined || arbre.console.length > 0, 'refusé ou averti')
      commeFigee(html, arbre)
    })
  }

  it('une balise raccourci dont la fermante n\'est citée que dans un <textarea> : rendue vide, sans relire la suite', () => {
    const html = '<@carte><textarea></@carte></textarea>'
    const lu = lire(html)
    assert.equal(lu.erreur, undefined)
    const racine = lu.arbre as { children: { name: string | null, children: unknown[] }[] }
    assert.deepEqual(racine.children.map((n) => [n.name, n.children.length]), [['mjs-carte', 0], ['textarea', 1]])
  })

  it('le lecteur lit les blocs comme le compilateur : le mot du bloc collé à l\'accolade, `{else}` et `{end}` écrits seuls', () => {
    const f = readFile('{ if $a}a{end }{else }<p>{success}</p>', { template: true })
    const sortes: string[] = []
    traverse(f, (n: Node) => { sortes.push(n.kind) })
    assert.deepEqual(sortes, ['file', 'expression', 'text', 'expression', 'expression', 'tag', 'expression'])
    assert.deepEqual(f.diagnostics, [])
  })

  it('le gabarit seul : ni section ni directive, et son code découpé sans être compilé', () => {
    const f = readFile('<style>a { color: red }</style>\n@import x\n<p>{$a}</p>', { template: true })
    const sortes: string[] = []
    traverse(f, (n: Node) => { sortes.push(n.kind) })
    assert.ok(!sortes.includes('style') && !sortes.includes('directive'), sortes.join(' '))
    assert.ok(f.codes.length > 0 && f.codes.every((c) => c.js === null && c.error === null))
  })
})
