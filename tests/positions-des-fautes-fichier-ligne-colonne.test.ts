// toute faute de construction cite le fichier où elle est écrite, sa ligne et, quand on l'a, sa colonne : `main.mjs:6:10`,
// « ligne 2 de _haut.mjs » pour un partiel, « (ligne 6) » pour une balise du composant. Les fautes de Civet, de CoffeeScript,
// de TypeScript et d'acorn (script, `<script module>`, expression, gestionnaire, script d'un partiel) sont ramenées au
// fichier par la correspondance du texte compilé avec le texte écrit, ligne et colonne, et non par un décalage constant.
// La colonne attendue d'une faute de Civet est celle où Civet s'arrête quand le même code est écrit seul, ramenée au
// fichier. Chaque cas passe par le chemin du bundler (transpileFromMsg), celui des messages de la construction

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { transpileFromMsg } from '../src/bundler/transpile-msg.js'
import { mjsTmp } from './helpers/tmp.js'

const J  = (...l: string[]) => l.join('\n') + '\n'
const JR = (...l: string[]) => l.join('\r\n') + '\r\n'

// `principal` : le fichier compilé (`main.mjs` à défaut) ; `opts` : ce que le bundler passe en plus (nom du fichier écrit, alias)
interface Cas { id: string, fichiers: Record<string, string>, attendu: string, motif?: RegExp, conseil?: RegExp, principal?: string, opts?: Record<string, unknown> }

const BAS    = J('<p>a</p>', '<p>b</p>', '<p>c</p>')
const SCRIPT = J('<script>', '$x = 1', '$k = 0', '</script>')
const LONG   = 'a'.repeat(2100)
const BOITE  = "@import µ$$Boite 'stores/boite.module.civet.mjs'"

const cas: Cas[] = [
  // gabarit : balise non fermée (le parseur)
  { id: 'g01-milieu', fichiers: { 'main.mjs': J('<p>a</p>', '<div><span>x</div>', '<p>b</p>') }, attendu: 'main.mjs:2' },
  { id: 'g02-macro-en-ligne-1', fichiers: { 'main.mjs': J('<@window @resize={f()} />', '<div><span>x</div>') }, attendu: 'main.mjs:2' },
  { id: 'g03-apres-head', fichiers: { 'main.mjs': J('<@head>', '<title>t</title>', '</@head>', '<div><span>x</div>') }, attendu: 'main.mjs:4' },
  { id: 'g04-apres-style', fichiers: { 'main.mjs': J('<style>', 'p { color: red }', '</style>', '<div><span>x</div>') }, attendu: 'main.mjs:4' },
  { id: 'g05-apres-partiel', fichiers: { 'main.mjs': J('<@include bas>', '<div><span>x</div>'), '_bas.mjs': BAS }, attendu: 'main.mjs:2' },
  { id: 'g08-crlf', fichiers: { 'main.mjs': JR('<p>a</p>', '<p>b</p>', '<div><span>x</div>') }, attendu: 'main.mjs:3' },
  // expressions du gabarit
  { id: 'e01-ligne-1', fichiers: { 'main.mjs': J('<p>{1 + * 2}</p>') }, attendu: 'main.mjs:1:9' },
  { id: 'e02-apres-script', fichiers: { 'main.mjs': SCRIPT + J('<p>a</p>', '<p>{$x + * 2}</p>') }, attendu: 'main.mjs:6:10' },
  { id: 'e03-avale-le-html', fichiers: { 'main.mjs': SCRIPT + J('<p>{$x</p>', '<p>b</p>', '<p>}</p>') }, attendu: 'main.mjs:5:11' },
  { id: 'e04-sur-deux-lignes', fichiers: { 'main.mjs': J('<p>a</p>', '<p>{[', '  1,', '  2 +', ']}</p>') }, attendu: 'main.mjs:5:1' },
  { id: 'e05-attribut', fichiers: { 'main.mjs': SCRIPT + J('<p class={$x + * 2}>a</p>') }, attendu: 'main.mjs:5:16' },
  { id: 'e06-apres-head', fichiers: { 'main.mjs': J('<@head>', '<title>t</title>', '</@head>', '<p>{1 + * 2}</p>') }, attendu: 'main.mjs:4:9' },
  { id: 'e07-dans-partiel', fichiers: { 'main.mjs': J('<p>0</p>', '<@include e>'), '_e.mjs': J('<p>a</p>', '<p>{1 + * 2}</p>') }, attendu: '_e.mjs:2:9' },
  { id: 'e08-apres-partiel', fichiers: { 'main.mjs': J('<@include bas>', '<p>{1 + * 2}</p>'), '_bas.mjs': BAS }, attendu: 'main.mjs:2:9' },
  { id: 'e09-tabulation', fichiers: { 'main.mjs': J('<div>', '\t<p>{1 + * 2}</p>', '</div>') }, attendu: 'main.mjs:2:10' },
  { id: 'e10-crlf', fichiers: { 'main.mjs': JR('<p>a</p>', '<p>{1 + * 2}</p>') }, attendu: 'main.mjs:2:9' },
  { id: 'e11-derniere-ligne', fichiers: { 'main.mjs': SCRIPT + J('<p>a</p>', '<p>b</p>') + '<p>{$x + * 2}</p>' }, attendu: 'main.mjs:7:10' },
  // gestionnaires
  { id: 'h01-une-ligne', fichiers: { 'main.mjs': SCRIPT + J('<button @click={$x = * 2}>b</button>') }, attendu: 'main.mjs:5:22' },
  { id: 'h02-deuxieme-ligne', fichiers: { 'main.mjs': SCRIPT + J('<button @click={', '  a = 1', '  b = )', '}>b</button>') }, attendu: 'main.mjs:7:7' },
  { id: 'h03-dans-partiel', fichiers: { 'main.mjs': SCRIPT + J('<@include h>'), '_h.mjs': J('<p>h</p>', '<button @click={$x = * 2}>b</button>') }, attendu: '_h.mjs:2:22' },
  { id: 'h04-apres-head', fichiers: { 'main.mjs': SCRIPT + J('<@head>', '<title>t</title>', '</@head>', '<button @click={$x = * 2}>b</button>') }, attendu: 'main.mjs:8:22' },
  // macros et effets
  { id: 'k01-modificateur-macro', fichiers: { 'main.mjs': SCRIPT + J('<p>a</p>', '<@window @resize.once={$k++} />') }, attendu: 'main.mjs:6' },
  { id: 'k02-modificateur-macro-partiel', fichiers: { 'main.mjs': SCRIPT + J('<p>0</p>', '<@include w>'), '_w.mjs': J('<p>w</p>', '<@window @resize.once={$k++} />') }, attendu: '_w.mjs:2' },
  { id: 'f01-effet-inconnu', fichiers: { 'main.mjs': J('<p>a</p>', '<p *titre>b</p>') }, attendu: 'main.mjs:2' },
  { id: 'f02-effet-inconnu-partiel', fichiers: { 'main.mjs': J('<p>0</p>', '<@include effet>'), '_effet.mjs': J('<p>a</p>', '<p *titre>b</p>') }, attendu: '_effet.mjs:2' },
  { id: 'f03-effet-partiel-imbrique', fichiers: { 'main.mjs': J('<@include relais>'), '_relais.mjs': J('<p>r</p>', '<@include effet>'), '_effet.mjs': J('<p>a</p>', '<p>b</p>', '<p *titre>c</p>') }, attendu: '_effet.mjs:3' },
  { id: 'f04-document-parenthese', fichiers: { 'main.mjs': J('<p>a</p>', '<@document *ripple(color: red>', '<p>x</p>') }, attendu: 'main.mjs:2', conseil: /ajoutez le \) de fin/ },
  { id: 'f05-document-guillemet', fichiers: { 'main.mjs': J('<p>a</p>', '<@document *ripple(color: \'red)></@document>', '<p>x</p>') }, attendu: 'main.mjs:2', conseil: /apostrophe/ },
  // <script> (Civet par défaut)
  { id: 's01-ligne-2', fichiers: { 'main.mjs': J('<script>', 'x = )', '</script>', '<p>x</p>') }, attendu: 'main.mjs:2:5' },
  { id: 's02-retrait', fichiers: { 'main.mjs': J('<script>', '  a = 1', '  b = )', '  c = 3', '</script>', '<p>x</p>') }, attendu: 'main.mjs:3:7' },
  { id: 's03-apres-style', fichiers: { 'main.mjs': J('<style>', 'p { color: red }', '</style>', '<script>', 'a = 1', 'b = )', '</script>', '<p>x</p>') }, attendu: 'main.mjs:6:5' },
  { id: 's04-derniere-ligne', fichiers: { 'main.mjs': J('<script>', 'a = 1', 'b = 2', 'c = )', '</script>', '<p>x</p>') }, attendu: 'main.mjs:4:5' },
  { id: 's05-raccourcis-avant', fichiers: { 'main.mjs': J('<script>', '$a = 1', '$b = 2', '$a = $b + )', '</script>', '<p>{$a}</p>') }, attendu: 'main.mjs:4:11' },
  { id: 's06-tabulation', fichiers: { 'main.mjs': J('<script>', '\ta = 1', '\tb = )', '</script>', '<p>x</p>') }, attendu: 'main.mjs:3:6' },
  { id: 's07-crlf', fichiers: { 'main.mjs': JR('<script>', 'a = 1', 'b = )', '</script>', '<p>x</p>') }, attendu: 'main.mjs:3:5' },
  { id: 's08-apres-rune', fichiers: { 'main.mjs': J('<script>', '$n = 1', 'µmount ->', '  $n = 2', 'b = )', '</script>', '<p>{$n}</p>') }, attendu: 'main.mjs:5:5' },
  { id: 's09-apres-magasin', fichiers: { 'main.mjs': J('<script>', '$$panier = []', 'µ$total = 0', 'b = )', '</script>', '<p>x</p>') }, attendu: 'main.mjs:4:5' },
  { id: 's10-script-du-partiel', fichiers: { 'main.mjs': J('<script>', '$n = 1', '</script>', '<p>{$n}</p>', '<@include ps>'), '_ps.mjs': J('<script>', 'a = 1', 'b = )', '</script>', '<p>p</p>') }, attendu: '_ps.mjs:3:5' },
  { id: 's11-coffee', fichiers: { 'main.mjs': J('<script lang="coffee">', 'a = 1', 'b = )', '</script>', '<p>x</p>') }, attendu: 'main.mjs:3:5' },
  { id: 's12-js', fichiers: { 'main.mjs': J('<script lang="js">', 'const a = 1', 'const b = )', '</script>', '<p>x</p>') }, attendu: 'main.mjs:3:11' },
  { id: 's13-ts', fichiers: { 'main.mjs': J('<script lang="ts">', 'const a: number = 1', 'const b = )', '</script>', '<p>x</p>') }, attendu: 'main.mjs:3:11' },
  { id: 's14-esperluette-amp', fichiers: { 'main.mjs': J('<script>', 'a = 1', 'w = &amp;', '</script>', '<p>x</p>') }, attendu: 'main.mjs:3:9' },
  // <script module>
  { id: 'm01-module', fichiers: { 'main.mjs': J('<script module>', 'a = 1', 'b = )', '</script>', '<p>x</p>') }, attendu: 'main.mjs:3:5' },
  { id: 'm02-module-apres-script', fichiers: { 'main.mjs': J('<script>', 'a = 1', '</script>', '<script module>', '  m = 1', '  n = )', '</script>', '<p>x</p>') }, attendu: 'main.mjs:6:7' },
  { id: 'm03-module-apres-import', fichiers: { 'main.mjs': J('@import { f } from \'./f.js\'', '<script module>', 'a = f()', 'b = )', '</script>', '<p>x</p>'), 'f.js': 'export const f = () => 1\n' }, attendu: 'main.mjs:4:5' },
  // avertissements
  { id: 'w01-img-apres-style', fichiers: { 'main.mjs': J('<style>', 'p { color: red }', '</style>', '<img src="a.png">') }, attendu: 'main.mjs:4', motif: /alt/ },
  { id: 'w02-img-dans-partiel', fichiers: { 'main.mjs': J('<p>0</p>', '<@include img>'), '_img.mjs': J('<p>a</p>', '<img src="a.png">') }, attendu: '_img.mjs:2', motif: /alt/ },
  { id: 'w03-inatteignable-retrait', fichiers: { 'main.mjs': J('<script>', '  f = ->', '    return 1', '    x = 2', '  f()', '</script>', '<p>a</p>') }, attendu: 'main.mjs:4', motif: /return|atteint/ },
  // ligne de plus de 2 000 caractères : seule la partie réécrite s'aligne, la colonne reste celle de la faute
  { id: 'l01-ligne-longue-js', fichiers: { 'main.mjs': J('<script lang="js">', `const x = ) + "${LONG}"`, '</script>', '<p>x</p>') }, attendu: 'main.mjs:2:11' },
  { id: 'l02-ligne-longue-civet', fichiers: { 'main.mjs': J('<script>', `f(1 + ) + "${LONG}"`, '</script>', '<p>x</p>') }, attendu: 'main.mjs:2:7' },
  { id: 'l03-ligne-longue-sucre', fichiers: { 'main.mjs': J('<script>', '$x = 1', `$y = "${LONG}" + )`, '</script>', '<p>{$y}</p>') }, attendu: 'main.mjs:3:2111' },
  // un singleton importé (`µ$$Boite`, lu `$Boite`) ou l'alias `mjs` avant la faute : la colonne de la ligne écrite
  { id: 'u01-singleton-script', fichiers: { 'main.mjs': J(BOITE, '<script>', 'x = µ$$Boite.a + µ$$Boite.a + )', '</script>', '<p>x</p>') }, attendu: 'main.mjs:3:31' },
  { id: 'u02-singleton-gabarit', fichiers: { 'main.mjs': J(BOITE, '<p>{µ$$Boite.a + * 2}</p>') }, attendu: 'main.mjs:2:18' },
  { id: 'u03-singleton-gestionnaire', fichiers: { 'main.mjs': J(BOITE, '<button @click={µ$$Boite.a = * 2}>b</button>') }, attendu: 'main.mjs:2:30' },
  { id: 'u04-alias-mjs', opts: { sigil: 'mjs' }, fichiers: { 'main.mjs': J('<script>', 'x = mjs.a + mjs.b + )', '</script>', '<p>x</p>') }, attendu: 'main.mjs:2:21' },
  // esbuild compte en octets : un accent avant la faute ne la décale pas
  { id: 'v01-ts-accents', fichiers: { 'main.mjs': J('<script lang="ts">', 'const s: string = "éé" + )', '</script>', '<p>x</p>') }, attendu: 'main.mjs:2:26' },
  // une expression plus longue écrite avant, qui commence pareil, n'est pas l'expression fautive
  { id: 'p01-prefixe-commun', fichiers: { 'main.mjs': J('<script>', 'f = (x) -> x', '</script>', '<p>{f(1)}</p>', '<p>{f(}</p>') }, attendu: 'main.mjs:5:7' },
  // le nom du fichier tel qu'écrit : une page, un modèle
  { id: 'n01-page', principal: 'accueil.page.mjs', opts: { moduleName: 'accueil', isPageModule: true, sourceFileName: 'accueil.page.mjs' }, fichiers: { 'accueil.page.mjs': J('<p>a</p>', '<script>', 'x = 1', 'b = )', '</script>') }, attendu: 'accueil.page.mjs:4:5' },
  { id: 'n02-modele', principal: 'carte.compacte.mjs', opts: { moduleName: 'carte--compacte', sourceFileName: 'carte.compacte.mjs' }, fichiers: { 'carte.compacte.mjs': J('<p>{1 + * 2}</p>') }, attendu: 'carte.compacte.mjs:1:9' },
  { id: 'w04-inatteignable-apres-rune', fichiers: { 'main.mjs': J('<script>', '$$panier = []', 'µ$total = 0', 'f = ->', '  return 1', '  x = 2', 'f()', '</script>', '<p>a</p>') }, attendu: 'main.mjs:6', motif: /return|atteint/ },
  // du code écrit sur la ligne d'un `<@include>`, après lui : il est au composant, pas au partiel
  { id: 'i01-expression-apres-include', fichiers: { 'main.mjs': J('<@include bas><p>{1 + * 2}</p>'), '_bas.mjs': J('<p>b</p>') }, attendu: 'main.mjs:1:23' },
  { id: 'i02-gestionnaire-apres-include', fichiers: { 'main.mjs': SCRIPT + J('<@include bas><button @click={$x = * 2}>b</button>'), '_bas.mjs': J('<p>b</p>') }, attendu: 'main.mjs:5:36' },
  { id: 'i03-deux-includes-puis-expression', fichiers: { 'main.mjs': J('<p>0</p>', '<@include bas><@include bas><p>{1 + * 2}</p>'), '_bas.mjs': J('<p>b</p>') }, attendu: 'main.mjs:2:37' },
  { id: 'i04-expression-avant-include', fichiers: { 'main.mjs': J('<p>{1 + * 2}</p><@include bas>'), '_bas.mjs': J('<p>b</p>') }, attendu: 'main.mjs:1:9' },
  // un gestionnaire laissé ouvert, que Civet refuse à la fin de son texte écrit : cité à la fin du gestionnaire écrit (son `}` quand
  // il ferme la même ligne)
  { id: 'h05-ouvert-operateur-final', fichiers: { 'main.mjs': SCRIPT + J('<p>a</p>', '<button @click={$x = 1 +}>b</button>') }, attendu: 'main.mjs:6:25' },
  { id: 'h06-ouvert-crochet', fichiers: { 'main.mjs': SCRIPT + J('<p>a</p>', '<button @click={$x = [1, 2}>b</button>') }, attendu: 'main.mjs:6:27' },
  { id: 'h07-ouvert-sur-deux-lignes', fichiers: { 'main.mjs': SCRIPT + J('<button @click={', '  a = 1', '  b = 2 +', '}>b</button>') }, attendu: 'main.mjs:7:10' },
  { id: 'h09-premier-de-deux-ouvert', fichiers: { 'main.mjs': SCRIPT + J('<button @click={f([1, 2}>a</button>', '<button @click={g()}>b</button>') }, attendu: 'main.mjs:5:24' },
  { id: 'h10-ouvert-parmi-trois', fichiers: { 'main.mjs': SCRIPT + J('<button @click={f(1,}>a</button>', '<button @click={g()}>b</button>', '<button @click={h()}>c</button>') }, attendu: 'main.mjs:5:21' },
  { id: 'h08-ouvert-dans-partiel', fichiers: { 'main.mjs': SCRIPT + J('<@include h>'), '_h.mjs': J('<p>h</p>', '<button @click={$x = 1 +}>b</button>') }, attendu: '_h.mjs:2:25' },
  // un gestionnaire d'une balise du langage (`<@window>`, `<@document>`), versé au script
  { id: 'k03-fenetre', fichiers: { 'main.mjs': SCRIPT + J('<p>a</p>', '<@window @resize={$x = * 2} />') }, attendu: 'main.mjs:6:24' },
  { id: 'k04-fenetre-dans-partiel', fichiers: { 'main.mjs': SCRIPT + J('<p>a</p>', '<@include w>'), '_w.mjs': J('<p>w</p>', '<@window @resize={$x = * 2} />') }, attendu: '_w.mjs:2:24' },
  { id: 'k05-fenetre-sur-deux-lignes', fichiers: { 'main.mjs': SCRIPT + J('<@window @keydown={', '  a = 1', '  b = )', '} />') }, attendu: 'main.mjs:7:7' },
  { id: 'k06-document', fichiers: { 'main.mjs': SCRIPT + J('<@document @click={$x = * 2} />') }, attendu: 'main.mjs:5:25' },
  // ligne longue réécrite des deux côtés de la faute, ou après elle seulement
  { id: 'l04-ligne-longue-sucre-des-deux-cotes', fichiers: { 'main.mjs': J('<script>', '$a = 1', `$b = $a + "${LONG}" + ) + $a`, '</script>', '<p>{$b}</p>') }, attendu: 'main.mjs:3:2116' },
  { id: 'l05-ligne-longue-sucre-apres', fichiers: { 'main.mjs': J('<script>', '$a = 1', `$b = "${LONG}" + ) + $a`, '</script>', '<p>{$b}</p>') }, attendu: 'main.mjs:3:2111' },
  // la colonne compte en unités UTF-16 (un emoji en vaut deux), un contexte `§x` ne la décale pas, un `<pre>` porte des expressions
  { id: 'v02-ts-emoji', fichiers: { 'main.mjs': J('<script lang="ts">', 'const s = "😀" + )', '</script>', '<p>x</p>') }, attendu: 'main.mjs:2:18' },
  { id: 'u05-contexte-gabarit', fichiers: { 'main.mjs': J('<p>{§theme + * 2}</p>') }, attendu: 'main.mjs:1:14' },
  { id: 'e12-pre-avant', fichiers: { 'main.mjs': J('<pre>{1 + * 2}</pre>', '<p>{1 + * 2}</p>') }, attendu: 'main.mjs:1:11' },
  // le parseur, sur une balise écrite dans un partiel : sa ligne dans le partiel
  { id: 'g06-dans-partiel', fichiers: { 'main.mjs': J('<p>0</p>', '<@include haut>'), '_haut.mjs': J('<p>a</p>', '<div><span>x</div>') }, attendu: '_haut.mjs:2' },
  { id: 'g07-partiel-imbrique', fichiers: { 'main.mjs': J('<@include relais>'), '_relais.mjs': J('<p>r</p>', '<@include haut>'), '_haut.mjs': J('<p>a</p>', '<div><span>x</div>') }, attendu: '_haut.mjs:2' },
  { id: 'g09-bloc-non-ferme-dans-partiel', fichiers: { 'main.mjs': J('<p>0</p>', '<@include pi>'), '_pi.mjs': J('<p>a</p>', '{if $x}', '<p>b</p>') }, attendu: '_pi.mjs:2' },
  // une ligne faite du partiel et du composant (texte écrit après le `<@include>`) : le parseur la cite à la ligne du composant
  { id: 'g11-composant-apres-include', fichiers: { 'main.mjs': J('<@include haut><div><span>x</div>'), '_haut.mjs': J('<p>a</p>') }, attendu: 'main.mjs:1', motif: /<span>/ },
  { id: 'g12-composant-apres-include-partiel-sans-fin', fichiers: { 'main.mjs': J('<@include haut><div><span>x</div>'), '_haut.mjs': '<p>a</p>' }, attendu: 'main.mjs:1', motif: /<span>/ },
  { id: 'g13-composant-apres-partiel-imbrique', fichiers: { 'main.mjs': J('<@include relais><div><span>x</div>'), '_relais.mjs': J('<p>r</p>', '<@include haut>'), '_haut.mjs': J('<p>a</p>') }, attendu: 'main.mjs:1', motif: /<span>/ },
  { id: 'g10-reglages-non-fermes-dans-partiel', fichiers: { 'main.mjs': J('<p>0</p>', '<p>1</p>', '<p>2</p>', '<@include pr>'), '_pr.mjs': J('<p>a</p>', '<p>b</p>', '<p *ripple(color: red>c</p>') }, attendu: '_pr.mjs:3' },
]

// la position citée : `x.mjs:L:C` (fautes du code), « ligne L de x.mjs » (partiel), « ligne L » (composant)
function positionDe(m: string): string | null {
  const p = /\b([\w./-]+\.mjs):(\d+)(?::(\d+))?/.exec(m)
  if (p) return `${p[1]}:${p[2]}${p[3] ? ':' + p[3] : ''}`
  const d = /ligne (\d+) de ([\w./-]+\.mjs)/.exec(m)
  if (d) return `${d[2]}:${d[1]}`
  const l = /\bligne (\d+)/.exec(m)
  return l ? `main.mjs:${l[1]}` : null
}

// les messages d'une construction : l'erreur levée d'abord, puis la console et les erreurs des macros
async function messages(c: Cas): Promise<string[]> {
  const dir = mjsTmp(`positions-${c.id}`)
  mkdirSync(dir, { recursive: true })
  for (const [nom, texte] of Object.entries(c.fichiers)) writeFileSync(join(dir, nom), texte)
  const vus: string[] = []
  const orig = { warn: console.warn, error: console.error, log: console.log }
  console.warn = console.error = console.log = (...a: unknown[]) => { vus.push(a.map(String).join(' ')) }
  try {
    const r = await transpileFromMsg({ type: 'transpile', id: 1, content: c.fichiers[c.principal ?? 'main.mjs'], moduleName: 'main', baseDir: dir, sourceDir: dir, preResolvedAssets: {}, ...c.opts } as any)
    for (const m of r?.data?.macroErrors ?? []) vus.push(String(m))
    return vus
  }
  catch (e: any) {
    return [String(e?.message ?? e), ...vus]
  }
  finally {
    Object.assign(console, orig)
  }
}

describe('une faute de construction cite son fichier, sa ligne et sa colonne', function () {
  this.timeout(120000)

  for (const c of cas) {
    it(`${c.id} : ${c.attendu}`, async () => {
      const vus     = (await messages(c)).map(m => m.replace(/\x1b\[[0-9;]*m/g, '')).filter(m => !c.motif || c.motif.test(m))
      const message = vus.find(m => positionDe(m)) ?? vus[0] ?? ''
      assert.equal(positionDe(message), c.attendu, message.slice(0, 400))
      if (c.conseil) assert.match(message, c.conseil, message.slice(0, 400))
    })
  }
})
