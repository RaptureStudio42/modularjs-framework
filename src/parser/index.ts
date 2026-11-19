// parser HTML — port consolidé de la V1 Ruby, parser_html.rb
// + sous-modules (parser_html/{dom,attributes,flow,parser_utils}.rb, node.rb)
//
// Port à l'identique. Output AST identique à V1.

import { FaultFix } from '../fault-fix.js'
import { t } from '../messages/index.js'
import { SIGN, SIGN_RE, wordOf, oldWordOf, colonWriting, wordList, strayModifier, wordForm, shownName } from './mjs-words.js'
import { aliasExample } from '../effects/aliases-mjs.js'
import { unknownEffectError } from '../effects/catalog.js'
import { settingsComment } from '../effects/settings-comment.js'
import { RESERVED_SYMBOL_NAMES } from '../generator/reserved-symbols.js'
import { opensRegex, regexInArgument, scanRegexLiteral, SCOPE_OPENS_REGEX } from '../sigils.js'
import { typedLine, printDiagnostic, type LintToggles } from '../diagnostics.js'
import { readFile, type Tag as ReaderTag, type Block as ReaderBlock, type Branch as ReaderBranch, type Expression as ReaderExpression, type Node as ReaderNode } from '../reader/index.js'

/** coupure/couleur transmises PAR APPEL — jamais un état partagé entre deux parses
 *  concurrentes, cf. src/diagnostics.ts. */
export interface ParseDiag {
  lint?: LintToggles
  colorsEnabled?: boolean
  /** un {await} sans branche d'attente prend le squelette de sa branche {success} (défaut : oui ;
   *  non si la clé `effects.skeleton` de mjs.config.json ne cite pas `await`) */
  autoSkeleton?: boolean
  /** les modèles en fichier de chaque composant (`carte.compacte.mjs` → `{ carte: ['compacte'] }`),
   *  ceux du projet (`dev`) et ceux de la bibliothèque cœur (`core`) : `<@carte layout="compacte">`
   *  devient `<mjs-carte--compacte>` */
  models?: { dev?: Record<string, string[]>, core?: Record<string, string[]> }
  /** les variables typées (`$age`, `$$volume`) dont un champ lié (`<input value=!{$age}>`) reçoit
   *  *guard d'office */
  guarded?: string[]
  /** le *guard d'office sans spectacle (`silent: true`) : la clé `effects.guard` de mjs.config.json
   *  vaut false */
  guardSilent?: boolean
  /** la ligne du fichier où commence le HTML (1 par défaut) : le HTML d'un composant est rogné en tête, ses lignes
   *  vides ne comptent plus. Ajoutée à toutes les lignes que le parseur cite (erreurs, avertissements) et pose sur
   *  ses nœuds (`Node.line`) : ce sont celles du fichier */
  firstLine?: number
  /** la ligne du composant de chaque ligne du HTML (index 0 : sa première) quand des partiels y sont versés (cf.
   *  processIncludes) : celle qui la porte, ou celle du `<@include>` qui verse son partiel, jamais une ligne du HTML
   *  recollé ; remplace `firstLine` pour les lignes de la table */
  hostLines?: number[]
  /** la ligne telle qu'un message la cite, pour chaque ligne du HTML (même index que `hostLines`) : celle du composant, ou
   *  « 2 de _haut.mjs » pour une ligne écrite dans un partiel, ou celle de chaque morceau d'une ligne faite de plusieurs fichiers
   *  (cf. MixedLine) ; les lignes posées sur les nœuds restent celles du composant */
  lineCites?: Array<number | string | MixedLine>
  /** reçoit les balises des composants du PROJET que le gabarit écrit (cf. ProjectTagSeen), pour le contrôle propUnknown du build */
  projectTags?: ProjectTagSeen[]
  /** reçoit les liens `#/…` des éléments `<a>` que le gabarit écrit (cf. LinkSeen), pour le contrôle routeUnknown du build */
  links?: LinkSeen[]
}

/** une ligne faite de morceaux de plusieurs fichiers (texte du composant après un `<@include>`, partiel versé en milieu de ligne) :
 *  son texte quand ses morceaux ont été posés, et la ligne citée de chacun à partir de son indice dans ce texte ; lue autrement
 *  depuis (réécrite par un passage d'avant le parseur), elle est citée à la ligne du composant qui la porte (`host`) */
export interface MixedLine { host: number; text: string; pieces: Array<{ at: number; cite: number | string }> }

export type NodeType = 'root' | 'tag' | 'text' | 'expr' | 'if' | 'for' | 'await' | 'key' | 'const'

export type AttrType = 'static' | 'dynamic' | 'boolean' | 'spread'

export interface Attr {
  type: AttrType
  name?: string
  val?: string
  expr?: string
  // la ligne d'un attribut `@…` (gestionnaire d'événement) dans le fichier, citée par ses erreurs
  line?: number
}

// référence à un composant repérée pendant le parsing (raccourci `@x` ou `@@x`,
// ou balise littérale `mjs-x`/`mjs-core-x` écrite à la main dans le gabarit).
// Collectée par `resolveTagName` ci-dessous, consommée par la post-passe de
// validation du bundler (bundler/index.ts, APRÈS le manifeste complet) —
// jamais résolue ICI, le parseur ne connaît pas les autres fichiers.
// Deux espaces de noms séparés : `<@x>` désigne un composant du PROJET
// (`shortcut-dev`), `<@@x>` un module de la bibliothèque CŒUR (`shortcut-core`,
// balise `mjs-core-x`) ; l'ancienne forme `<@mjs-x>` est une ERREUR DE MIGRATION.
// `bare-tag` : une balise au nom d'élément personnalisé écrite sans `mjs-` ni `@` (`<enfant-simple>`), laissée telle
// quelle — le bundler avertit si un composant du projet porte ce nom (jamais enregistrée, elle resterait vide)
export type TagRefKind = 'shortcut-dev' | 'shortcut-core' | 'shortcut-mjs-removed' | 'literal-dev' | 'literal-core' | 'bare-tag'

export interface TagRef {
  name: string
  kind: TagRefKind
  // variants — valeur LITTÉRALE d'un `layout="…"`/`template="…"` posé sur CETTE
  // balise précise (posée par openTag, après resolveTagName ET parseAttrs). Absent si
  // l'attribut est absent, dynamique (`layout={expr}`, non vérifiable au build) ou booléen.
  layoutLiteral?: string
  // module CŒUR seulement (`shortcut-core`, `literal-core`) : ce que CETTE balise écrit. Le bundler
  // y lit si un attribut est posé quelque part dans l'appli (Bundler.coreAttrWritten). Absent des
  // références au projet : leurs attributs ne choisissent rien, le contrôle propUnknown les reçoit à part (ParseDiag.projectTags)
  attrs?: TagRefAttrs
}

// une balise d'un composant du PROJET (`<@fiche>`, `<mjs-fiche>`), relevée pour le contrôle propUnknown du build : ce qu'elle écrit,
// sa ligne dans le texte lu, et de quoi la retrouver dans le fichier quand le HTML compilé n'en a plus les lignes (partiel inclus,
// bloc retiré) : son texte, du `<` à la fin de ses attributs, et son rang parmi les occurrences de ce texte
export interface ProjectTagSeen {
  // le composant visé, modèle en fichier écrit en dur compris (`carte--compacte`)
  name: string
  kind: 'shortcut-dev' | 'literal-dev'
  // les noms des attributs écrits, tels qu'écrits, et la présence d'un étalement `{...obj}`
  names: string[]
  spread: boolean
  line: number
  text: string
  // combien de fois `texte` paraît dans le texte lu avant cette balise, et en tout
  rank: number
  total: number
  // un modèle en fichier choisi à l'exécution (`layout={$vue}`) : les modèles de la base, qui reçoivent chacun ces attributs
  models?: string[]
}

// un lien `href="#/…"` d'un élément `<a>`, écrit en dur, relevé pour le contrôle routeUnknown du build : sa valeur, sa ligne dans le texte
// lu, et de quoi le retrouver dans le fichier quand le HTML compilé n'en a plus les lignes (cf. ProjectTagSeen)
export interface LinkSeen {
  href: string
  line: number
  text: string
  rank: number
  total: number
}

// ce que la balise d'un module cœur écrit : les NOMS de ses attributs, tels qu'écrits, quelle que soit la forme de la
// valeur (`other`, `other="42"`, `other={$x}`, `other=!{$x}`), et la présence d'un étalement `{...p}` — ce qu'il pose
// ne se sait pas au build
export interface TagRefAttrs {
  names: string[]
  spread: boolean
  // le TEXTE écrit de chaque attribut, nom en minuscules : la valeur entre guillemets ou nue (`toolbar="bold italic"`), `''` quand l'attribut est écrit sans valeur
  // (`answer`), `null` quand le build ne peut pas la lire (valeur calculée `{…}`, texte interpolé). Absent d'une référence relevée avant son ajout
  texts?: Record<string, string | null>
  // l'expression écrite de chaque attribut calculé (`series={[…]}`), nom en minuscules, présente seulement quand la balise en écrit un :
  // le build y lit ce qui est écrit en dur dans l'expression (les couleurs des séries de <@@chart>, ses lignes écrites)
  exprs?: Record<string, string>
}

export interface Branch {
  type?: 'pending' | 'success' | 'error'
  arg?: string
  expr?: string | null
  children: Node[]
}

export class Node {
  type: NodeType
  name: string | null = null
  children: Node[] = []
  attrs: Attr[] = []
  expr: string | null = null
  item: string | null = null
  index: string | null = null
  iterable: string | null = null
  key: string | null = null
  content: string | null = null
  branches: Branch[] = []
  _is_raw?: boolean
  // `{await.keep expr}` : pendant une relecture, la branche {success} affichée reste et se met à jour sur place (cf. AWAIT_KEEP) ; posé
  // seulement quand le bloc l'écrit, par les deux lectures du gabarit
  keep?: boolean
  // la tête d'un {await} telle qu'écrite, quand un effet en a été retiré (`$fiche *skeleton`, cf. skeletonSettings) : le refus d'un bloc sur une
  // valeur qui attend la cite ainsi (transpiler/await-derived.ts) ; absente, `expr`
  written?: string
  line?: number  // ligne d'origine dans le fichier (tag/text/expr, cf. ParseDiag.firstLine) — lue par hoistFillBlocks et par le générateur pour leurs messages
  cite?: string  // la ligne telle qu'un message la cite quand elle est écrite dans un partiel (« 2 de _haut.mjs », cf. ParseDiag.lineCites) ; absente, `line`

  constructor(type: NodeType) {
    this.type = type
  }
}

// directive bloc de slot (`<@fill nom>…</@fill>`) : toute occurrence du mot passe par CETTE
// constante. Cf. hoistFillBlocks plus bas.
export const FILL_DIRECTIVE = 'fill'
const FILL_TAG_NAME = `@${FILL_DIRECTIVE}`

const VOID_TAGS = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
                   'link', 'meta', 'param', 'source', 'track', 'wbr']

// balises dont la balise de FIN est optionnelle en HTML5 (WHATWG « optional tags ») : leur
// absence explicite, comblée par la fermeture d'un ANCÊTRE, est un balisage légitime, pas une
// faute — contrairement à <span>/<div>/etc, qui n'ont pas cette règle. Utilisé par le garde-fou
// « fermeture mal appariée » (balise refermée par la fermante d'un ancêtre) pour ne PAS avertir sur ces cas connus.
// html/head/body/colgroup (fermeture ET/OU ouverture optionnelles, cas structurels à part) restent
// hors de cette liste : déjà réservés ailleurs dans MJS (AT_RESERVED_NAMES).
const IMPLICIT_CLOSE_TAGS = new Set(['p', 'li', 'dt', 'dd', 'rt', 'rp', 'optgroup', 'option',
                                      'caption', 'colgroup', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th'])

const RESERVED_TEMPLATE_NAMES = [
  // `el` et `e` : les noms que le gabarit donne à l'élément et à l'évènement d'un gestionnaire
  'el', 'e', 'dirty', 'this', 'arguments',
  '__nodes', '__idx',
  // identifiants émis par le tplFn d'un {for} : un item/index ainsi nommé
  // collisionnerait avec le code généré (redéclaration / clash de paramètre).
  //
  // `__arr` retiré (0 émission nulle part dans src/, hors
  // sa propre entrée ici — vérifié via `rg -a`, résistant aux fichiers
  // signalés binaires par un `grep` classique). `__built`/`_item`, EUX,
  // restent bien réservés : ils avaient été signalés à tort comme fantômes
  // — une recherche grep standard les MANQUE dans generator/compile.ts, qui
  // contient des octets NUL littéraux (marqueurs `maskDocBlocks` ailleurs
  // dans le fichier) faisant classer tout le fichier comme binaire. Ils sont
  // en réalité activement émis (generator/compile.ts, runtime/mjs_element.ts)
  // — les retirer aurait RÉOUVERT une collision silencieuse.
  'updateFn', '__built', 'refs', 'fragment', '_mjsThis', '_item', '_f',
  // temps internes du chemin des BINDINGS FILTRÉS
  // (attributes/index.ts : `const __k = ${keyExpr}`, `const __fe = …` l'entrée de l'index filtré, `__fns`, `__f0`,
  // `__f`). Un item {for} ainsi nommé produisait `const __k = __k.id` → TDZ
  // silencieux (liste vidée, erreur avalée par _mjs_reconcileList). Réservés comme
  // __idx/__nodes/__built (même famille de temporaires internes).
  '__k', '__fe', '__fns', '__f0', '__f'
  // NB — `v`/`startNode`/`endNode`/`cfn` (tueurs confirmés) ne sont PAS ajoutés ici : le fix
  // choisi est de renommer les temporaires internes en `_mjs_*`
  // (generator/compile.ts : compileIf/compileKey), pas d'interdire ces noms
  // au dev — ils sont désormais des choix d'item PARFAITEMENT valides.
  // Vérifié runtime : tests/reserved-names-collision.test.ts.
]

// ============================================================================
// StringScanner — port minimal du StringScanner Ruby
// ============================================================================
// PERF — `scan`/`check` recompilaient `new RegExp('^(?:'+src+')')`
// à CHAQUE appel (~182 k constructions pour parser 100 Ko : `new RegExp(string)`
// n'est PAS mise en cache par V8). On mémoïse l'ancrée par `source\0flags` :
// ~20 motifs constants + quelques dizaines de fermetures dynamiques de tag.
const ANCHOR_CACHE = new Map<string, RegExp>()
function anchored(re: RegExp): RegExp {
  const key = re.source + '\0' + re.flags
  let a = ANCHOR_CACHE.get(key)
  if (a === undefined) {
    let src = re.source
    if (src.startsWith('^')) src = src.slice(1)
    a = new RegExp('^(?:' + src + ')', re.flags.replace('g', ''))
    ANCHOR_CACHE.set(key, a)
  }
  return a
}

export class Scanner {
  str: string
  pos: number
  last: RegExpExecArray | null
  // la ligne du fichier où commence `str` (1 par défaut) : `lineAt` compte à partir d'elle
  firstLine: number
  // cache paresseux des offsets de saut de ligne, UN par instance : `str`
  // ne change jamais après construction (cf. `lineAt` plus bas, seul lecteur).
  _lineOffsets: number[] | null = null
  // le code lu est du Civet ou du CoffeeScript (gabarit en Civet, le défaut) : une regex s'y passe aussi sans parenthèses
  // (`s.replace /'/g, 'X'`, regexInArgument) ; jamais en JavaScript, où `a /2 + b /4` divise
  dialect: boolean
  // la ligne du composant de chaque ligne de `str` quand des partiels y sont versés (cf. ParseDiag.hostLines), lue par `lineAt`
  hostLines: number[] | null
  // la ligne telle qu'un message la cite (cf. ParseDiag.lineCites), lue par `citeAt`
  cites: Array<number | string | MixedLine> | null

  constructor(str: string, firstLine = 1, dialect = false, hostLines: number[] | null = null, cites: Array<number | string | MixedLine> | null = null) {
    this.str = str
    this.pos = 0
    this.last = null
    this.firstLine = firstLine
    this.dialect = dialect
    this.hostLines = hostLines
    this.cites = cites
  }

  eos(): boolean { return this.pos >= this.str.length }
  rest(): string { return this.str.slice(this.pos) }
  peek(n: number): string { return this.str.slice(this.pos, this.pos + n) }

  getch(): string | undefined {
    const c = this.str[this.pos]
    if (c !== undefined) this.pos += 1
    return c
  }

  scan(re: RegExp): string | null {
    const m = anchored(re).exec(this.rest())
    if (!m) return null
    this.last = m
    this.pos += m[0].length
    return m[0]
  }

  check(re: RegExp): boolean {
    return anchored(re).test(this.rest())
  }

  group(n: number): string | undefined {
    return this.last?.[n]
  }
}

// ============================================================================
// Helpers
// ============================================================================
// opensRegex — DÉPLACÉE dans sigils.ts : l'heuristique (regex après un
// signe/mot-clé/début, division après une valeur) est désormais PARTAGÉE avec le lexer
// (scanInertAt + règle 3.1a) et le générateur (mapCodeSegments), qui ignoraient jusque-là
// les littéraux regex (`/§/` levait la garde « § nu », `/µTotal/` sortait réécrit). Import
// en tête de fichier ; comportement inchangé ici.

// consomme un commentaire (`//` jusqu'au saut de ligne, `/* */` jusqu'au terminateur) — le `/`
// ouvrant est DÉJÀ consommé par l'appelant. `stopChar` = le délimiteur fermant de l'expression qui
// contient le commentaire : un commentaire de LIGNE s'y arrête aussi, sans le consommer.
function swallowComment(scanner: Scanner, block: boolean, stopChar?: string): string {
  let res = ''
  while (!scanner.eos()) {
    // La forme NATURELLE d'un attribut tient sur UNE ligne : dans `{$x // texte}`, le
    // `}` est la fin de l'EXPRESSION, jamais du commentaire. Sans cet arrêt il partait dans le
    // commentaire, l'expression n'était jamais refermée, et la garde « non fermée » levait
    // sur du code qui compilait la veille. Le délimiteur n'est PAS consommé : l'appelant le relit
    // et décrémente son compteur d'équilibrage lui-même.
    if (!block && stopChar !== undefined && scanner.peek(1) === stopChar) break
    const c = scanner.getch()!
    res += c
    if (!block && c === '\n') break
    if (block && c === '*' && scanner.peek(1) === '/') { res += scanner.getch()!; break }
  }
  return res
}

// consomme une regex littérale et ses drapeaux — le `/` ouvrant est DÉJÀ consommé. Une classe
// `[…]` protège le `/` (`/[/'"]/`), un `\` échappe le caractère suivant, et les accolades d'un
// quantificateur (`/a{2,3}/`) ne comptent donc plus dans l'équilibrage.
// Sœur de `scanRegexLiteral` (sigils.ts, MÊME heuristique de fond) : coexistent plutôt que
// fusionnées — celle-ci avance un `Scanner` à position mutable, l'autre rend un index sur
// une chaîne brute (lexer/générateur, qui n'ont pas de Scanner).
function swallowRegex(scanner: Scanner): string {
  let res = ''
  let cls = false
  while (!scanner.eos()) {
    const c = scanner.getch()!
    res += c
    if (c === '\\') { const next = scanner.getch(); if (next !== undefined) res += next; continue }
    if (c === '[') { cls = true; continue }
    if (c === ']') { cls = false; continue }
    if (c === '/' && !cls) break
  }
  const flags = scanner.scan(/[a-z]*/)                 // gimsuyvd
  return res + (flags ?? '')
}

// `settings` : les réglages d'un effet (`*nom(…)`, `@in=*nom(…)`) — du CSS, des mots, des listes, jamais du JavaScript : une barre
// oblique n'y ouvre jamais une regex (`hsl(210 50% 20% / .4)`, `calc(100% / 2)`, `url(/a.png)`) ; chaînes et commentaires y sont lus comme ailleurs.
export function extractBalanced(scanner: Scanner, closeChar: string, settings = false): string {
  const openChar  = closeChar === '}' ? '{' : '('
  const startPos  = scanner.pos                             // position de l'OUVERTURE (convertie en ligne SEULEMENT si on lève)
  let balance = 1
  let res = ''
  let inString = false
  let stringChar: string | null = null
  // L'échappement `\` SAUTE le caractère suivant (au lieu du test
  // rétrospectif `res[-1] !== '\\'`, faux dès qu'un `\\` LITTÉRAL précède la
  // quote : `'c:\\'` était jugé non fermé → tout le HTML suivant avalé).
  let skipNext = false
  // dans un commentaire `#` (jusqu'à la fin de la ligne) : cf. plus bas
  let hash = false

  while (!scanner.eos()) {
    const ch = scanner.getch()
    if (ch === undefined) break

    if (inString) {
      // échappement d'ABORD : un `\$` juste avant `${` reste un `$` littéral, pas une interpolation
      if (skipNext) { skipNext = false; res += ch; continue }
      if (ch === '\\') { skipNext = true; res += ch; continue }
      // un backtick est une CHAÎNE OPAQUE pour ce scanner : sans ce garde-fou, le
      // premier AUTRE backtick croisé (même niché dans une chaîne `'…'` À L'INTÉRIEUR d'un `${…}`,
      // ex. `` `a${ 'x`y' }b` ``) refermait la chaîne au mauvais endroit → fausse « chaîne non
      // fermée ». Remède : `${` ouvre une récursion sur CE MÊME scanner (chaîne/regex/commentaire
      // dans l'interpolation gérés pareil qu'au premier niveau), `}` la referme.
      if (stringChar === '`' && ch === '$' && scanner.peek(1) === '{') {
        scanner.getch()                                        // consomme le `{`
        const body = extractBalanced(scanner, '}', settings)
        res += '${' + body + '}'
        continue
      }
      // `"…#{…}…"` : l'interpolation est traversée d'un bloc, comme au lexeur (scanDoubleQuoteAt) — ses guillemets et ses accolades sont
      // les siens (`{"#{"}"}#{$x}"}`). Jamais refermée sur sa ligne, elle reste du texte, lu comme avant
      if (stringChar === '"' && ch === '#' && scanner.peek(1) === '{') {
        const before = scanner.pos
        scanner.getch()                                        // consomme le `{`
        try {
          const body = extractBalanced(scanner, '}', settings)
          if (!body.includes('\n')) {
            res += '#{' + body + '}'
            continue
          }
        }
        catch {
          // pas d'interpolation refermée : le `#` est un caractère de la chaîne
        }
        scanner.pos = before
      }
      res += ch
      if (ch === stringChar) { inString = false; stringChar = null }
      continue
    }

    // hors chaîne, un `#` ouvre un commentaire Coffee/Civet jusqu'à la fin de la ligne (sauf `#nom`, champ
    // privé ou symbole, et `#{`) : ses guillemets n'ouvrent pas de chaîne — une apostrophe (`# c'est tout`)
    // faisait refuser la construction, « chaîne non fermée » ; ses accolades comptent comme avant. Jamais
    // dans les réglages d'un effet, où `#fff` est une couleur
    if (hash) {
      if (ch === '\n') hash = false
      if (ch === openChar) balance += 1
      else if (ch === closeChar) { balance -= 1; if (balance === 0) break }
      res += ch
      continue
    }
    if (ch === '#' && !settings && !/[a-zA-Z_{]/.test(scanner.peek(1) ?? '')) { hash = true; res += ch; continue }

    // hors chaîne : un `/` peut ouvrir un commentaire ou une regex — sans ça, un guillemet dedans
    // (`/['"]/g`, `/* isn't */`) ouvrait une chaîne FANTÔME qui ne se refermait jamais et avalait
    // tout le document (panne muette avant la garde, faux refus après elle)
    if (ch === '/') {
      const next = scanner.peek(1)
      if (next === '/' || next === '*') { res += ch + swallowComment(scanner, next === '*', closeChar); continue }
      // en Civet et en CoffeeScript, une regex passée sans parenthèses (`s.replace /'/g, 'X'`) en est une aussi, si elle se referme sur sa ligne
      const bar = scanner.pos - 1
      if (!settings && (opensRegex(res) || (scanner.dialect && regexInArgument(scanner.str, bar) && scanRegexLiteral(scanner.str, bar) !== -1))) { res += ch + swallowRegex(scanner); continue }
    }

    if (ch === '"' || ch === "'" || ch === '`') { inString = true; stringChar = ch; res += ch; continue }
    if (ch === openChar) balance += 1
    else if (ch === closeChar) { balance -= 1; if (balance === 0) break }
    res += ch
  }

  // Sortie par FIN DE FICHIER = délimiteur jamais refermé. Sans cette garde l'expression
  // avalait tout le HTML suivant et le composant compilait « AVEC SUCCÈS » sur un template VIDE :
  // le nœud entier disparaissait sans un mot (mesuré sur `@flip={…'ab\}`, `@style.color={'ab\}`,
  // `title={'ab\}`, `@class{'ab\}` — 0 erreur, `_mjs_cloneTpl("")`). Une compilation verte qui rend
  // du vide est le pire signal possible : on lève, en situant l'OUVERTURE.
  if (inString) throw new Error(t('parser.string-not-closed', { line: citeAt(scanner, startPos), quote: stringChar ?? '', excerpt: exprPreview(res) }))
  if (balance !== 0) throw new Error(t('parser.delimiter-not-closed', { line: citeAt(scanner, startPos), opening: openChar, closing: closeChar, excerpt: exprPreview(res) }))

  return withoutLineCarriers(res)
}

// le porteur de lignes d'un bloc ou d'un commentaire retiré (cf. LINE_CARRIER_RE) n'appartient pas au code : ôté du code lu, il
// reste compté par le lecteur, qui l'a passé (une chaîne d'interpolation qui citait une balise dans un commentaire l'affichait)
function withoutLineCarriers(code: string): string {
  return code.includes(LINE_CARRIER_OPEN) ? code.replace(LINE_CARRIER_RE, '') : code
}

// les réglages d'un effet (`*nom(…)`, `@in=*nom(…)`), l'ouvrante déjà lue : lus d'abord sans regex (une barre oblique n'en ouvre jamais) ; si cette lecture échoue
// (expression ou chaîne non fermée), relus à l'ancienne façon, regex reconnues : ce qui se construisait avant se construit encore (`images: [/img/*.png]`,
// `$a.replace(/'/g, '')`, que le catalogue refuse ensuite à sa façon). Quand la première lecture réussit, elle l'emporte : c'est elle qui corrige la couleur à barre
// oblique et la lecture de travers. Si les deux échouent, l'erreur est celle de la première
export function extractSettings(scanner: Scanner): string {
  const start = scanner.pos
  try {
    return extractBalanced(scanner, ')', true)
  }
  catch (first) {
    scanner.pos = start
    try {
      return extractBalanced(scanner, ')')
    }
    catch {
      throw first
    }
  }
}

// chaque accolade du HTML lue par extractBalanced : son contenu et la position qui suit sa fermante, `null` si elle ne se referme
// jamais. Lues dans l'ordre, chacune reprenant après la précédente : tant qu'aucune accolade ne reste ouverte (tout gabarit qui se
// construit), c'est la lecture la moins chère. À la première qui ne se referme pas, le texte est lu d'un coup par readBracesBackward
export function readBraces(html: string): Map<number, { body: string, end: number } | null> {
  const inOrder = new Map<number, { body: string, end: number } | null>()
  const reader  = new Scanner(html)
  for (let at = html.indexOf('{'); at !== -1; at = html.indexOf('{', reader.pos)) {
    reader.pos = at + 1
    try {
      inOrder.set(at, { body: extractBalanced(reader, '}'), end: reader.pos })
    }
    catch {
      return readBracesBackward(html)
    }
  }
  return inOrder
}

// chaque accolade du texte, celles qui sont dans une autre comprises, lue comme extractBalanced la lirait seule (closeChar `}`, hors
// réglages d'effet), en temps linéaire. Une accolade jamais refermée lit jusqu'à la fin du texte : lue seule, chacune relisait tout le
// reste (temps quadratique, des secondes pour quelques milliers). Ici les accolades sont lues de la dernière à la première, et une lecture
// s'arrête dès qu'elle arrive là où une lecture déjà faite est passée dans le même état : elle en reprend la suite.
// - La suite connue d'une position du texte, lue hors chaîne et hors commentaire : la position de la `}` qui fait redescendre d'un niveau
//   (`fall`), dans un commentaire `#` ou non, ou jamais (-1). Elle vaut quel que soit le niveau de la lecture qui y arrive.
// - Une seule décision dépend de l'endroit où la lecture a commencé : le `/` qui suit la `)` d'une condition (`if (…) /x/`, sigils.ts,
//   afterCondition) ouvre une regex seulement si la lecture a commencé avant la `(`. Une suite qui a vu une telle décision ne vaut que
//   pour une lecture ouverte après cette `(` (`seuil`) ; une autre lecture relit ce texte elle-même.
// - Chaînes, commentaires `/* */` et `//`, regex : sautés d'un bloc par des tables lues une fois, de droite à gauche ; les `${…}` et
//   `#{…}` d'une chaîne reprennent la lecture de leur accolade, déjà faite ; la fin d'une chaîne reprise à l'un d'eux est retenue.
// - Commentaire `#` : ses accolades comptent, rien d'autre n'y est lu ; la `}` qui fait redescendre d'un niveau se lit sur le solde des
//   accolades, sans relire la ligne.
// tests/accolades-lecture-a-l-envers-identique.test.ts compare chaque accolade à la lecture d'extractBalanced
export function readBracesBackward(html: string): Map<number, { body: string, end: number } | null> {
  const n = html.length
  // fin d'un commentaire `/* */` dont l'étoile est au plus tôt en i : le premier `*/` à partir de i, ou -1
  const starSlash = new Int32Array(n + 2).fill(-1)
  // fin d'un commentaire `//` lu à partir de i : la première `}` (laissée à l'expression) ou le premier saut de ligne (compris)
  const lineEnd = new Int32Array(n + 2).fill(n)
  const newline = new Int32Array(n + 2).fill(n)
  // le corps d'une regex lu à partir de i, hors d'une classe `[…]` ou dedans : position qui suit sa barre fermante, ou n
  const regexOutside = new Int32Array(n + 2).fill(n)
  const regexInside  = new Int32Array(n + 2).fill(n)
  // fin des lettres minuscules qui commencent en i (les drapeaux d'une regex)
  const letters     = new Int32Array(n + 2).fill(n)
  // prochain évènement d'une chaîne lue à partir de i, échappements sautés : son guillemet, `${` (gabarit), `#{` (guillemets doubles), ou n
  const evtSimple   = new Int32Array(n + 2).fill(n)
  const evtDouble   = new Int32Array(n + 2).fill(n)
  const evtTemplate = new Int32Array(n + 2).fill(n)
  for (let i = n - 1; i >= 0; i--) {
    const c      = html[i]
    const jump   = Math.min(i + 2, n)
    starSlash[i] = c === '*' && html[i + 1] === '/' ? i : starSlash[i + 1]
    lineEnd[i]   = c === '}' || c === '\n' ? i : lineEnd[i + 1]
    newline[i]   = c === '\n' ? i : newline[i + 1]
    letters[i]   = c >= 'a' && c <= 'z' ? letters[i + 1] : i
    if (c === '\\') {
      regexOutside[i] = regexOutside[jump]
      regexInside[i]  = regexInside[jump]
      evtSimple[i]    = evtSimple[jump]
      evtDouble[i]    = evtDouble[jump]
      evtTemplate[i]  = evtTemplate[jump]
      continue
    }
    regexOutside[i] = c === '/' ? i + 1 : c === '[' ? regexInside[i + 1] : regexOutside[i + 1]
    regexInside[i]  = c === ']' ? regexOutside[i + 1] : regexInside[i + 1]
    evtSimple[i]    = c === '\'' ? i : evtSimple[i + 1]
    evtDouble[i]    = c === '"' || (c === '#' && html[i + 1] === '{') ? i : evtDouble[i + 1]
    evtTemplate[i]  = c === '`' || (c === '$' && html[i + 1] === '{') ? i : evtTemplate[i + 1]
  }
  // solde des accolades avant i (`{` +1, `}` -1), et premier j > i où il vaut un de moins : la `}` en j - 1 referme le niveau ouvert en i
  const balance  = new Int32Array(n + 1)
  for (let i = 0; i < n; i++) balance[i + 1] = balance[i] + (html[i] === '{' ? 1 : html[i] === '}' ? -1 : 0)
  const drop = new Int32Array(n + 1)
  const last = new Int32Array(2 * n + 3).fill(-1)
  for (let i = n; i >= 0; i--) {
    drop[i] = last[balance[i] + n]
    last[balance[i] + n + 1] = i
  }
  // la suite connue de chaque position (-2 : inconnue), la fin retenue d'une chaîne reprise à un évènement (-2 : inconnue)
  const fall       = new Int32Array(n + 1).fill(-2)
  const fallInHash = new Uint8Array(n + 1)
  const threshold  = new Int32Array(n + 1)
  const stringEnd  = new Int32Array(n + 1).fill(-2)
  const evts       = new Int32Array(n + 1)
  // positions en attente de leur suite, de la plus ancienne à la plus récente, avec leur niveau ; -1 : un seuil vu depuis (sa valeur)
  const wait = new Int32Array(2 * n + 4)
  const levels = new Int32Array(2 * n + 4)
  let top = 0

  const seuiller = (s: number): void => {
    if (s < 0) return
    if (top > 0 && wait[top - 1] === -1) levels[top - 1] = Math.max(levels[top - 1], s)
    else {
      wait[top]   = -1
      levels[top] = s
      top++
    }
  }
  // les positions en attente au niveau `niveau` (toutes pour -1) reçoivent leur suite, et les seuils vus depuis chacune
  const resolve = (level: number, f: number, hash: number): void => {
    let s = -1
    while (top > 0) {
      const p = wait[top - 1]
      if (p === -1) s = Math.max(s, levels[top - 1])
      else if (level !== -1 && levels[top - 1] !== level) break
      else {
        fall[p]       = f
        fallInHash[p] = hash
        threshold[p]  = s
      }
      top--
    }
    seuiller(s)
  }
  // la `(` de la condition dont la `)` précède le `/` en p (blancs sautés), lue comme afterCondition ; introuvable, la lecture elle-même
  const opening = (p: number, start: number): number => {
    let j = p
    while (j > 0 && /\s/.test(html[j - 1])) j--
    let depth = 0
    for (let k = j - 1; k >= Math.max(0, j - SCOPE_OPENS_REGEX); k--) {
      if (html[k] === ')') depth++
      else if (html[k] === '(' && --depth === 0) return k
    }
    return start
  }
  // une chaîne lue à partir de `depuis` : la position qui suit son guillemet fermant, -1 si elle ne se ferme pas
  const str = (from: number, quote: string): number => {
    const evt = quote === '\'' ? evtSimple : quote === '"' ? evtDouble : evtTemplate
    let x     = evt[from]
    let seen  = 0
    let end   = -1
    for (;;) {
      if (x >= n) break
      if (html[x] === quote) {
        end = x + 1
        break
      }
      if (stringEnd[x] !== -2) {
        end = stringEnd[x]
        break
      }
      evts[seen++] = x
      // la lecture de l'accolade en x + 1, déjà faite (elle suit le début de la lecture en cours)
      const f = fall[x + 2]
      if (quote === '`') {
        if (f === -1) break
        x = evt[f + 1]
      }
      // `#{…}` refermé sur sa ligne : traversé d'un bloc ; sinon le `#` est un caractère de la chaîne
      else x = f !== -1 && newline[x + 2] >= f ? evt[f + 1] : evt[x + 1]
    }
    for (let i = 0; i < seen; i++) stringEnd[evts[i]] = end
    return end
  }
  // les suites connues enchaînées, par sauts doublés : après une suite connue (sa `}` hors d'un commentaire `#`), la lecture reprend juste
  // après elle ; `sauts[j - 1][q]` est la position atteinte après 2^j suites montées depuis q (-2 : pas encore établie), `jumpThresholds` le
  // plus haut seuil traversé. Tables posées à la demande, seulement pour une lecture qui a des niveaux à redescendre sans position en attente
  // (beaucoup d'accolades comptées dans un commentaire `#`) ; seul un saut établi est retenu : une suite connue plus tard allonge la chaîne
  const jumps: Int32Array[]          = []
  const jumpThresholds: Int32Array[] = []
  const jumpThreshold                = (j: number, q: number): number => j === 0 ? threshold[q] : jumpThresholds[j - 1][q]
  const jump                         = (j: number, q: number): number => {
    if (j === 0) return fall[q] >= 0 && fallInHash[q] === 0 ? fall[q] + 1 : -1
    while (jumps.length < j) {
      jumps.push(new Int32Array(n + 1).fill(-2))
      jumpThresholds.push(new Int32Array(n + 1))
    }
    const t = jumps[j - 1]
    if (t[q] !== -2) return t[q]
    const m = jump(j - 1, q)
    if (m === -1) return -1
    const r = jump(j - 1, m)
    if (r === -1) return -1
    t[q] = r
    jumpThresholds[j - 1][q] = Math.max(jumpThreshold(j - 1, q), jumpThreshold(j - 1, m))
    return r
  }
  // de la position q, au plus `k` suites montées, chacune valable pour une lecture ouverte en `debut` : la position atteinte et le nombre
  // de suites montées ; les seuils traversés rejoignent la lecture
  let climbs = 0
  const climb = (q: number, k: number, start: number): number => {
    let s = -1
    climbs = 0
    for (let j = 31 - Math.clz32(k); j >= 0; j--) {
      if (climbs + (1 << j) > k) continue
      const r = jump(j, q)
      if (r === -1 || !(start > jumpThreshold(j, q))) continue
      s = Math.max(s, jumpThreshold(j, q))
      q = r
      climbs += 1 << j
    }
    seuiller(s)
    return q
  }
  // la lecture de l'accolade en `debut` : la position de sa `}` fermante, -1 si elle ne se referme jamais
  const read = (start: number): number => {
    top           = 0
    let p         = start + 1
    let level     = 1
    let hash      = false
    const failure = (): number => {
      resolve(-1, -1, 0)
      return -1
    }
    for (;;) {
      if (hash) {
        // commentaire `#` jusqu'au saut de ligne compris : ses accolades comptent, rien d'autre n'y est lu
        const eol = newline[p]
        let from = p
        for (let j = drop[from]; j !== -1 && j <= eol; j = drop[from]) {
          resolve(level, j - 1, 1)
          if (--level === 0) return j - 1
          from = j
        }
        if (eol >= n) return failure()
        level += balance[eol + 1] - balance[from]
        p      = eol + 1
        hash   = false
        continue
      }
      // chaque position lue est inscrite, la fin du texte comprise : la lecture d'une accolade (sa première position) sert aux `${…}` et
      // `#{…}` qui la reprennent
      const rest = fall[p]
      if (rest === -2) {
        wait[top]   = p
        levels[top] = level
        top++
      }
      // une lecture déjà faite est passée ici dans le même état : sa suite, si elle vaut pour une lecture ouverte en `debut`
      else if (start > threshold[p]) {
        // les niveaux au-dessus de la dernière position en attente redescendent sans rien donner à personne : montés d'un coup le long
        // des suites connues (une lecture qui a compté beaucoup d'accolades dans un commentaire `#`)
        const free = level - levels[wait[top - 1] === -1 ? top - 2 : top - 1]
        if (free > 1) {
          const q = climb(p, free, start)
          if (climbs > 0) {
            level -= climbs
            p = q
            continue
          }
        }
        seuiller(threshold[p])
        if (rest === -1) return failure()
        const inHash = fallInHash[p]
        resolve(level, rest, inHash)
        if (--level === 0) return rest
        p    = rest + 1
        hash = inHash === 1
        continue
      }
      if (p >= n) return failure()
      const c = html[p]
      if (c === '#' && !/[a-zA-Z_{]/.test(html[p + 1] ?? '')) {
        hash = true
        p++
        continue
      }
      if (c === '/') {
        const next = html[p + 1]
        if (next === '/') {
          const f = lineEnd[p + 2]
          p = f < n && html[f] === '\n' ? f + 1 : f
          continue
        }
        if (next === '*') {
          const f = starSlash[p + 1]
          p = f === -1 ? n : f + 2
          continue
        }
        const regex = opensRegex(html.slice(start + 1, p))
        // jugée sur la parenthèse d'une condition ouverte avant la lecture : une lecture ouverte avant cette `(` y lirait une regex
        if (!regex && opensRegex(html.slice(0, p))) seuiller(opening(p, start))
        p = regex ? letters[regexOutside[p + 1]] : p + 1
        continue
      }
      if (c === '\'' || c === '"' || c === '`') {
        p = str(p + 1, c)
        if (p === -1) return failure()
        continue
      }
      if (c === '{') level++
      else if (c === '}') {
        resolve(level, p, 0)
        if (--level === 0) return p
      }
      p++
    }
  }

  const readItems = new Map<number, { body: string, end: number } | null>()
  for (let at = html.lastIndexOf('{'); at !== -1; at = at === 0 ? -1 : html.lastIndexOf('{', at - 1)) {
    const f = read(at)
    readItems.set(at, f === -1 ? null : { body: html.slice(at + 1, f), end: f + 1 })
  }
  return readItems
}

// aperçu du texte avalé pour le message d'erreur : une ligne, borné
function exprPreview(res: string): string {
  const flat = res.replace(/\s+/g, ' ').trim()
  return flat.length > 60 ? `${flat.slice(0, 60)}…` : flat
}

// `str.slice(0, pos).match(/\n/g)` était O(n) par appel, appelé pour
// CHAQUE nœud : quadratique sur un HTML volumineux. Remède : les offsets de `\n` sont indexés UNE
// fois par `Scanner` (paresseux, au premier appel), puis une recherche dichotomique donne le
// numéro de ligne — même résultat que l'ancienne formule (`\r\n` inclus : seul le `\n` compte
// dans les deux, le `\r` n'a jamais eu d'effet).
function lineOffsets(scanner: Scanner): number[] {
  if (scanner._lineOffsets === null) {
    const offsets: number[] = []
    const str = scanner.str
    for (let i = 0; i < str.length; i++) if (str.charCodeAt(i) === 10) offsets.push(i)
    scanner._lineOffsets = offsets
  }
  return scanner._lineOffsets
}

// la ligne du FICHIER : le HTML d'un composant est rogné en tête avant d'être analysé, `scanner.firstLine` dit
// où il commence (1 pour un texte analysé seul)
function lineAt(scanner: Scanner, pos: number): number {
  const lo = lineIndex(scanner, pos)
  return scanner.hostLines?.[lo] ?? lo + scanner.firstLine
}

// la ligne telle qu'un message la cite : celle du fichier, ou « 2 de _haut.mjs » pour une ligne écrite dans un partiel ; sur une
// ligne faite de plusieurs fichiers, celle du morceau qui porte `pos`
function citeAt(scanner: Scanner, pos: number): number | string {
  const lo   = lineIndex(scanner, pos)
  const cite = scanner.cites?.[lo]
  if (typeof cite !== 'object') return cite ?? scanner.hostLines?.[lo] ?? lo + scanner.firstLine
  const start = lo === 0 ? 0 : lineOffsets(scanner)[lo - 1] + 1
  if (!scanner.str.startsWith(cite.text, start) || (scanner.str[start + cite.text.length] ?? '\n') !== '\n') return cite.host
  let k = 0
  while (k + 1 < cite.pieces.length && cite.pieces[k + 1].at <= pos - start) k++
  return cite.pieces[k].cite
}

function currentCite(scanner: Scanner): number | string {
  return citeAt(scanner, scanner.pos)
}

// le rang (à partir de 0) de la ligne qui contient `pos`
function lineIndex(scanner: Scanner, pos: number): number {
  const offsets = lineOffsets(scanner)
  // recherche du premier offset >= pos (borne inférieure) : sa position dans le
  // tableau EST le nombre de sauts de ligne strictement avant `pos`
  let lo = 0
  let hi = offsets.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (offsets[mid] < pos) lo = mid + 1
    else hi = mid
  }
  return lo
}

function currentLine(scanner: Scanner): number {
  return lineAt(scanner, scanner.pos)
}

// familles de temporaires SUFFIXÉS réellement émis par le générateur
// (`__arr_0`/`__idx_1` du {for}, `_nref_*`/`_c_*` de compile.ts, tout `_mjs_*`) :
// la liste `RESERVED_TEMPLATE_NAMES` ne protège que des noms EXACTS, un item de
// boucle `__arr_0` collisionnerait sans que rien ne l'attrape.
const RESERVED_PREFIX_RE = /^(?:__arr_|__idx_|_nref_|_mjs_|_c_)/

function rejectReservedName(kind: string, name: string | null | undefined, line: number | string): void {
  const clean = (name ?? '').toString().trim()
  if (clean === '') return
  // une liaison de TEMPLATE ($, $$, µ : item/index de {for}, nom de {const},
  // arg de {success}/{error}) colle avec les symboles du framework, même famille que la garde du
  // JS déjà compilé (generator/reserved-symbols.ts) — liste PARTAGÉE, jamais redite ici
  if (RESERVED_SYMBOL_NAMES.has(clean)) throw new Error(t('parser.symbol-reserved-template', { line, name: clean, kind }))
  if (!RESERVED_TEMPLATE_NAMES.includes(clean) && !RESERVED_PREFIX_RE.test(clean)) return
  const altMap: Record<string, string> = {
    'el': 'item', 'e': 'evt', 'dirty': 'flag', 'this': 'self'
  }
  const alt = altMap[clean] ?? `${clean}_`
  throw new Error(t('parser.name-reserved', { line, block: kind, name: clean, alt, nameList: RESERVED_TEMPLATE_NAMES.join(', ') }))
}

// la forme développée d'un bloc de modèle `{? a, b}` (cf. expandLayoutBlocks)
const LAYOUT_BLOCK_EXPR = /^\(µlayout is '[A-Za-z][\w-]*'(?: or µlayout is '[A-Za-z][\w-]*')*\)$/

// chaque jeton de branche, tel que les messages le citent : écrit hors de son bloc (`{else}` dans un `{for}`, `{success}`
// dans un `{if}`…), il est refusé (cf. refuseToken, dans readViaTree)
const BRANCH_TOKENS: Record<string, string> = { else: '{else}', elsif: '{elsif …}', success: '{success …}', error: '{error …}' }
function raiseUnclosedBlock(kind: string, expr: string, line: number | string): never {
  // un bloc de modèle se cite tel qu'écrit : `{? a, b}`, jamais `{if (µlayout is 'a' or …)}`
  if (kind === 'if' && LAYOUT_BLOCK_EXPR.test(expr)) {
    kind = '?'
    expr = [...expr.matchAll(/'([^']*)'/g)].map(m => m[1]).join(', ')
  }
  let hint = ''
  switch (kind) {
    case 'if':
      hint = t('parser.tip-if-ternary')
      break
    case '?':
      hint = t('parser.tip-block-layout-end')
      break
    case 'for':
      hint = t('parser.tip-for-end')
      break
    case 'await':
      hint = t('parser.tip-await-end')
      break
    case 'key':
      hint = t('parser.tip-key-end')
      break
  }
  throw new Error(t('parser.block-not-closed', { kind, expr, line, tip: hint }))
}

// ============================================================================
// Attributes parser
// ============================================================================
// Attributs HTML5 réellement booléens (présence = true, valeur ignorée) — cf. WHATWG "Boolean
// attributes". Utilisé UNIQUEMENT pour un attribut NU (pas de `=`) : réécrit en
// {type:'dynamic', expr:'true'} (même chemin de génération que `disabled={expr}`) au lieu de
// {type:'boolean'} (marqueur inerte). Liste NEUVE, à ne pas confondre avec MJS_BOOLEAN_PROPS
// (exportée par generator/attributes/index.ts, importée par generator/compile.ts) : cette dernière décide
// property-vs-attribute pour LE CODEGEN d'un attribut déjà dynamique/two-way — un problème
// différent, ne pas y toucher, ne pas essayer de les fusionner.
const MJS_NATIVE_BOOLEAN_ATTRS = new Set([
  'allowfullscreen', 'async', 'autofocus', 'autoplay', 'checked', 'controls',
  'default', 'defer', 'disabled', 'formnovalidate', 'hidden', 'inert',
  'ismap', 'itemscope', 'loop', 'multiple', 'muted', 'nomodule', 'novalidate',
  'open', 'playsinline', 'readonly', 'required', 'reversed', 'selected',
])

// un point derrière un effet n'est le nom d'aucun alias, et un attribut ne commence pas par un point : séparé de l'effet par un blanc
// (`*filter .net`) ou collé à ses réglages (`*filter.net(blur: 3).x`), il est refusé — l'alias se colle à son effet, avant les réglages. Un
// point qui n'a pas un effet pour voisin n'est pas lu ici. Un effet inconnu (`*fadee .x`) n'est pas repris sur son point : la pose le refuse
// d'abord, par son nom (`transition` : sur @in / @out, seul un nom proche d'un effet connu l'est)
function strayDot(scanner: Scanner, name: string, settings: boolean, transition = false): void {
  const m = (settings ? /^(\s*)(\.[\w.-]*)/ : /^(\s+)(\.[\w.-]*)/).exec(scanner.rest())
  if (!m || unknownEffectError(name, transition)) return
  throw new Error(t(settings ? 'effects.point-settings' : 'effects.point-space', { name, blank: m[1] ? ' ' : '', point: m[2], example: aliasExample(name.split('.')[0]), line: currentCite(scanner) }))
}

// un effet écrit sans réglages collés : rien à lire — sauf une parenthèse séparée de son nom par un
// blanc (`*neon (#0ff)`), refusée : ses réglages étaient perdus et versés en attributs parasites ; ni un point séparé de lui par un blanc
function detachedSettings(scanner: Scanner, name: string, transition = false): string {
  if (scanner.check(/\s+\(/)) throw new Error(t('effects.space', { name, line: currentCite(scanner) }))
  strayDot(scanner, name, false, transition)
  return ''
}

// les réglages d'un effet (`*nom(…)`, `@in=*nom(…)`), l'ouvrante déjà lue, sans commentaire : il se lirait comme une valeur et ferait perdre les
// réglages qui le suivent. Le message cite la ligne du commentaire
function readEffectSettings(scanner: Scanner, name: string): string {
  const from     = scanner.pos
  const settings = extractSettings(scanner)
  const found    = settingsComment(settings)
  if (found) throw new Error(t('effects.comment', { name, line: citeAt(scanner, from + found.at), comment: found.text }))
  return settings
}

// la valeur non quotée d'un style conditionnel (`@style.color{$on}=red`, `@style.width{$big}={$n}px`, `@style.color{$on}={$on ? 'red' : 'blue'}`) : un groupe
// `{…}` se lit équilibré, comme ailleurs — espaces et guillemets compris, une accolade dans une chaîne n'y ferme rien —, le reste s'arrête au premier blanc ou à `>` ;
// le `/` d'un `/>` n'en fait pas partie (un `/` interne, d'une URL, si)
function readUnquotedValue(scanner: Scanner): string {
  let val = ''
  while (true) {
    if (scanner.scan(/\{/)) val += '{' + extractBalanced(scanner, '}') + '}'
    else if (scanner.scan(/((?:[^\s>\/{]|\/(?!>))+)/)) val += scanner.group(1)
    else break
  }
  return val
}

// `:class{…}` et `:style.x{…}` (ou l'ancienne écriture en `@`, refusée) : le signe, le mot, puis la condition entre accolades
const CONDITIONAL_RE = new RegExp('(@|' + SIGN_RE + String.raw`)(class|style\.[a-zA-Z0-9\-]+)\{`)

// l'ancienne écriture d'un mot de MJS sur une balise (`@size="320x48"`, `@lightDom`, `@open={$o}`) : refusée, jamais lue en silence comme
// l'écoute d'un événement de ce nom, la nouvelle écriture dans le message (mjs-words.ts). `written` : ce qui suit le nom (`="320x48"`, ou rien)
function refuseOldWord(name: string, written: string, line: number | string): never {
  const value = written.replace(/^\s*=\s*/, '')
  const hit   = oldWordOf(name)!
  const stray = strayModifier(hit.word, hit.rest)
  if (stray) refuseStrayModifier(name, hit.word, stray, written, line)
  // `mjs check` corrige le signe, et lui seul, puis relit le fichier (cf. FaultFix)
  throw FaultFix.attach(new Error(t('parser.word-at-sign-removed', { written: value === '' ? name : `${name}=${value}`, correct: colonWriting(name, value === '' ? null : value), event: name.slice(1).split(/[.{]/)[0], line })), name + written, ':' + name.slice(1) + written, line)
}

// un mot de MJS suivi d'un modificateur d'événement (`:size.propagate={f}`, `@size.propagate={f}` dans l'ancienne écriture) : refusé,
// jamais lu comme l'écoute de l'événement du même nom (strayModifier, mjs-words.ts) ; le message rappelle la forme du mot et renvoie à µmount
function refuseStrayModifier(name: string, word: string, modifier: string, written: string, line: number | string): never {
  const value = written.replace(/^\s*=\s*/, '')
  throw new Error(t('parser.word-modifier-event', { written: value === '' ? name : `${name}=${value}`, word, shape: wordForm(word), modifier: modifier, line }))
}

// un nom écrit avec le signe des mots de MJS qui n'en est pas un (`:titre="x"`, habitude de Vue) : refusé, avec la liste des mots et la
// liaison de MJS d'un attribut ou d'une prop (`titre={x}`) ; `written` : ce qui suit le nom
function refuseUnknownWord(name: string, written: string, line: number | string): never {
  const value    = written.replace(/^\s*=\s*/, '')
  const bareName = name.slice(SIGN.length)
  const raw      = /^(["'])([\s\S]*)\1$/.exec(value)
  const binding  = value === '' ? bareName : value.startsWith('{') ? `${bareName}=${value}` : `${bareName}={${raw ? raw[2] : value}}`
  throw new Error(t('parser.word-unknown', { written: value === '' ? name : `${name}=${value}`, name: bareName, list: wordList(), binding: binding, line }))
}

function parseAttrs(scanner: Scanner, node: Node): void {
  // filet générique anti-duplication : un NOM d'attribut vu deux fois sur
  // CETTE balise → erreur. Comparaison telle quelle (casse conservée, la casse est traitée
  // ailleurs) ; `@class{cond}`/`@style.prop{cond}` incluent la condition dans le nom (construit
  // plus bas), deux conditions différentes ne collisionnent donc jamais. Complète (ne remplace
  // pas) transpiler.directive-duplicate (preprocessHtml, transpiler/index.ts) qui ne voit que
  // SES marqueurs `@…=` reconnus — celui-ci voit la liste d'attributs déjà parsée, quelle que
  // soit la forme d'origine (y compris un attribut déjà réécrit type mjs-confirm).
  const seenAttrNames = new Set<string>()
  const checkAttrDuplicate = (name: string): void => {
    if (seenAttrNames.has(name)) throw new Error(t('parser.attribute-duplicate', { attribute: name, tag: node.name, line: currentCite(scanner) }))
    seenAttrNames.add(name)
  }

  while (true) {
    if (scanner.eos() || scanner.check(/\s*\/?>/)) break
    scanner.scan(/\s+/)

    if (scanner.scan(/\{(?:\.\.\.)/)) {
      const expr = extractBalanced(scanner, '}')
      node.attrs.push({ type: 'spread', expr: expr.trim() })
      continue
    }

    // Token `{expr}` nu (sans `...`, sans `name=` devant) — attribut dynamique
    // anonyme. Seul `<@slot {expr}>` le consomme (nom de slot évalué), et la
    // directive bloc de slot (FILL_TAG_NAME) — nom dynamique accepté ICI, rejeté
    // ensuite par hoistFillBlocks (nom LITTÉRAL exigé, message dédié).
    // Sur tout autre tag il était SILENCIEUSEMENT jeté (le générateur l'ignore) :
    // un `<div {$cls}>` (habitude Svelte, où `{cls}` ≡ `cls={cls}`) perdait son
    // attribut sans trace → erreur claire plutôt que perte muette.
    if (scanner.check(/\{/)) {
      scanner.scan(/\{/)
      const expr = extractBalanced(scanner, '}')
      if (node.name !== 'slot' && node.name !== FILL_TAG_NAME) {
        const line = currentCite(scanner)
        throw new Error(t('parser.attribute-bare-not-supported', { expr: expr.trim(), line, tag: node.name }))
      }
      node.attrs.push({ type: 'dynamic', expr: expr.trim() })
      continue
    }

    // effet `*nom` ou `*nom(réglages)` : les réglages restent bruts ici, le générateur les
    // vérifie et les convertit (effects/catalog.ts) ; un nom en majuscules y devient un effet
    // inconnu, jamais un attribut. Le nom pointé d'un alias se lit en entier, mal formé compris
    // (`*filter.`, `*filter..x`, `*filter.net.x`) : le générateur dit alors ce qui est écrit, au lieu
    // de laisser un attribut parasite (`.`, `.x`) et de perdre les réglages en silence
    if (scanner.scan(/\*([A-Za-z][\w-]*(?:\.[\w.-]*)?)/)) {
      const name = `*${scanner.group(1)}`
      checkAttrDuplicate(name)
      const written = scanner.scan(/\(/)
      const val     = written ? readEffectSettings(scanner, name.slice(1)) : detachedSettings(scanner, name.slice(1))
      if (written) strayDot(scanner, name.slice(1), true)
      if (scanner.check(/\s*=/)) throw new Error(t('effects.equal', { name: name.slice(1), line: currentCite(scanner) }))
      node.attrs.push({ type: 'static', name, val })
      continue
    }

    // une étoile et un point, sans nom d'effet entre eux (`*.net`) : l'effet manque, et ce n'est pas un attribut
    if (scanner.scan(/\*(\.[\w.-]*)/)) throw new Error(t('effects.point-no-effect', { point: scanner.group(1), line: currentCite(scanner) }))

    // `:class{…}=` et `:style.x{…}=` : un mot de MJS, la condition entre accolades puis la valeur ; l'ancienne écriture `@class{…}=` est
    // refusée, la nouvelle dans le message (refuseOldWord)
    if (scanner.scan(CONDITIONAL_RE)) {
      const sigil  = scanner.group(1)!
      const prefix = scanner.group(2)!
      const line   = currentCite(scanner)
      const expr   = extractBalanced(scanner, '}')
      const name   = `@${prefix}{${expr}}`
      checkAttrDuplicate(`${sigil}${prefix}{${expr}}`)
      const from   = scanner.pos

      if (scanner.scan(/\s*=\s*/)) {
        if (scanner.scan(/"([^"]*)"/)) {
          node.attrs.push({ type: 'static', name, val: scanner.group(1) })
        } else if (scanner.scan(/'([^']*)'/)) {
          node.attrs.push({ type: 'static', name, val: scanner.group(1) })
        } else if (prefix !== 'class') {
          // la valeur non quotée d'un style : voir readUnquotedValue (un groupe `{…}` se lit en entier, espaces et guillemets compris)
          const val = readUnquotedValue(scanner)
          if (val !== '') node.attrs.push({ type: 'static', name, val })
        } else if (scanner.scan(/((?:[^\s>\/]|\/(?!>))+)/)) {
          // le nom d'une classe est littéral : seule la valeur d'un style se calcule. Une valeur non quotée s'arrêtait à `>` mais avalait le `/`
          // d'un `/>` : `<img src=x/>` → val `"x/"`. On exclut le seul `/` IMMÉDIATEMENT suivi de `>` (auto-fermeture) ; un `/` interne (URL
          // `http://…`) reste dans la valeur.
          node.attrs.push({ type: 'static', name, val: scanner.group(1) })
        }
      } else {
        node.attrs.push({ type: 'boolean', name })
      }
      if (sigil === '@') refuseOldWord(name, scanner.str.slice(from, scanner.pos), line)
      continue
    }

    // `_` ajouté au charset des noms d'attribut : sans lui, le scan
    // s'arrêtait au `_`, `data-user_id="3"` devenait `data-user` + `id="3"`
    // (l'`id` NATIF de l'élément écrasé) ; l'underscore est valide en HTML et
    // imposé par la convention snake_case maison (`data-` compris).
    if (scanner.scan(/([a-zA-Z0-9:@\-\._]+)/)) {
      const written = scanner.group(1)!
      checkAttrDuplicate(written)
      // un mot de MJS `:mot` (mjs-words.ts) : le générateur reçoit l'attribut `@mot` qu'il traite depuis toujours ; un signe au milieu d'un nom
      // (`xlink:href`) reste un attribut ordinaire, un `:nom` qui n'est pas un mot est refusé (refuseUnknownWord, la valeur lue d'abord)
      const word  = wordOf(written)
      const stray = word ? strayModifier(word.word, word.rest) : null
      const name  = word ? `@${word.entry.inner}${word.rest}` : written
      const from = scanner.pos
      // la ligne d'un attribut `@…`, juste même quand la balise s'écrit sur plusieurs lignes
      const at = name.startsWith('@') || written.startsWith(SIGN) ? { line: currentLine(scanner) } : null
      if (scanner.scan(/\s*=\s*/)) {
        // une transition, effet déclenché par le cycle de vie : `@in=*fly(up, duration: 2s)` — la
        // valeur est l'effet et ses réglages bruts, vérifiés par le générateur (effects/catalog.ts) ; le nom d'un alias
        // d'effet (`@in=*fade.lent`) s'écrit avec son point, comme sur une balise
        if (/^@(?:in|out|transition)(?:\.\w+)*$/.test(name) && scanner.scan(/\*([A-Za-z][\w-]*(?:\.[\w.-]*)?)/)) {
          const effect   = scanner.group(1)!
          const written  = scanner.scan(/\(/)
          const settings = written ? readEffectSettings(scanner, effect) : detachedSettings(scanner, effect, true)
          if (written) strayDot(scanner, effect, true, true)
          node.attrs.push({ type: 'static', name, val: `*${effect}(${settings})` })
          if (stray) refuseStrayModifier(written, word!.word, stray, scanner.str.slice(from, scanner.pos), citeAt(scanner, from))
          if (!word && oldWordOf(name)) refuseOldWord(name, scanner.str.slice(from, scanner.pos), citeAt(scanner, from))
          continue
        }
        if (scanner.scan(/\{/)) {
          const val = extractBalanced(scanner, '}')
          node.attrs.push({ type: 'dynamic', name, expr: val.replace(LINE_CARRIER_RE, ''), ...at })
        } else if (scanner.scan(/"([^"]*)"/)) {
          node.attrs.push({ type: 'static', name, val: noQuotedEffect(name, scanner.group(1)!.replace(LINE_CARRIER_RE, '')), ...at })
        } else if (scanner.scan(/'([^']*)'/)) {
          node.attrs.push({ type: 'static', name, val: noQuotedEffect(name, scanner.group(1)!.replace(LINE_CARRIER_RE, '')), ...at })
        } else if (scanner.scan(/((?:[^\s>\/]|\/(?!>))+)/)) {
          // une valeur non quotée s'arrêtait à `>` mais avalait le `/`
          // d'un `/>` : `<img src=x/>` → val `"x/"`. On exclut le seul `/`
          // IMMÉDIATEMENT suivi de `>` (auto-fermeture) ; un `/` interne (URL
          // `http://…`) reste dans la valeur.
          node.attrs.push({ type: 'static', name, val: scanner.group(1), ...at })
        }
      } else if (!name.startsWith('@') && !written.startsWith(SIGN) && !(node.name ?? '').includes('-') && node.name !== 'slot' && node.name !== FILL_TAG_NAME && MJS_NATIVE_BOOLEAN_ATTRS.has(name)) {
        // Attribut HTML5 booléen nu (`<input disabled>`, `<ol reversed>`…) — pas de `@` (laisse
        // `<details @open>` intact, chemin existant), pas sur `<@slot>` NI `<@fill>`
        // (leur 1er attribut nu a déjà un sens réservé — nom de
        // slot ; `default` est à la fois booléen HTML5 valide et nom de slot plausible, cf.
        // `<@slot default>` ET `<@fill default>`). Réécrit en dynamique littéral `true` → même
        // chemin de génération que `disabled={expr}`.
        // Tag À TIRET EXCLU (composant MJS, `<@view>` → `metamjs-view`, web component tiers) :
        // le générateur y route tout attribut dynamique vers `node._set(nom, v)` / `node[nom]=v`
        // (dynamic(), generator/attributes/index.ts `isWc`) au lieu de l'écrire dans le
        // template — `<mjs-enfant hidden>` perdait alors son attribut et n'était PLUS caché.
        // Sur ces tags l'attribut nu reste donc `type:'boolean'`, écrit littéralement.
        node.attrs.push({ type: 'dynamic', name, expr: 'true' })
      } else {
        // sa ligne, comme un attribut à valeur : le refus d'une forme nue (`@clic` sans valeur) cite celle de l'attribut
        node.attrs.push({ type: 'boolean', name, ...at })
      }
      // l'ancienne écriture d'un mot de MJS (`@size="320x48"`, `@lightDom`, `@open={$o}`) : refusée (refuseOldWord)
      if (written.startsWith(SIGN) && !word) refuseUnknownWord(written, scanner.str.slice(from, scanner.pos), citeAt(scanner, from))
      if (stray) refuseStrayModifier(written, word!.word, stray, scanner.str.slice(from, scanner.pos), citeAt(scanner, from))
      if (!word && oldWordOf(name)) refuseOldWord(name, scanner.str.slice(from, scanner.pos), citeAt(scanner, from))
      continue
    }

    // un signe que rien ne lit ici était jeté sans rien dire : `<div $foo="1">` (de même `#foo`, `étiquette`, une virgule ou un guillemet perdu
    // entre deux attributs) sortait `<div foo="1">`, la faute de frappe passait inaperçue. Les espaces et retours à la ligne sont lus en tête de
    // boucle : ce qui arrive ici n'est jamais un séparateur, la construction s'arrête sur l'attribut tel qu'il est écrit (jusqu'au blanc, au `=`,
    // au `>` ou au `/>`)
    if (scanner.eos()) break
    const written = scanner.rest().match(/^[\s\S](?:[^\s=>\/]|\/(?!>))*/)![0]
    throw new Error(t('parser.attribute-sign-unknown', { attribute: written, sign: [...written][0], tag: node.name, line: currentCite(scanner) }))
  }
}

// ============================================================================
// Flow parser ({if} {for} {await} {key})
// ============================================================================
// le squelette d'office des {await} de l'analyse en cours (cf. ParseDiag.autoSkeleton)
let autoSkeleton = true
// la balise de contenu étranger qui entoure la position courante (`svg`, `math`), null en HTML — un
// <foreignObject> rouvre du HTML, comme au générateur : la zone du squelette (un <div> et ses barres)
// n'a pas sa place ailleurs qu'en HTML
let foreignTag: string | null = null
// dans le contenu d'un `<textarea>` ou d'un `<title>` HTML (pas celui d'un dessin) : le navigateur y lit du texte, un `<!--`
// n'y ouvre aucun commentaire
let loneText: string | null = null
// `{? timer}` — un détail du HTML propre à un modèle (layout), écrit court : réécrit en
// `{if (µlayout is 'timer')}` avant tout le reste (la prop `layout`, les modèles connus, le lexer le
// voient comme écrit à la main ; les lignes ne bougent pas). Dans le bloc, un autre `{? chrono}` est
// la branche suivante (`{elsif …}`) ; `{else}`, les autres modèles ; plusieurs noms, séparés par des
// virgules ; `default` : sans layout. Un `{? …}` dans un autre bloc ({if}, {for}…) en ouvre un nouveau ;
// un bloc jamais refermé dans ce texte lève ici, à sa ligne (`firstLine` : celle du texte dans son fichier) —
// chaque fichier passe ici avant d'être recollé, la faute d'un partiel inclus est citée dans le partiel, avec son fichier
// (`cite` : la ligne du fichier telle qu'un message la cite, « 2 de _haut.mjs »)
export function expandLayoutBlocks(html: string, firstLine = 1, cite: (line: number) => number | string = (line) => line): string {
  if (!html.includes('{?')) return html
  const stack: Array<{ kind: string, names?: string[], index?: number }> = []
  const re = /<!--(?:-?>|[\s\S]*?--!?>)|\{(if|for|await(?:\.keep)?|key)\s|\{end\}|\{\?([^}]*)\}/g
  let out = ''
  let i = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    if (m[0].startsWith('<!--')) continue
    if (m[1]) {
      stack.push({ kind: m[1] })
      continue
    }
    if (m[0] === '{end}') {
      stack.pop()
      continue
    }
    const names = m[2].split(',').map(x => x.trim())
    if (names.some(x => !/^[A-Za-z][\w-]*$/.test(x))) {
      const line = cite(firstLine + (html.slice(0, m.index).match(/\n/g)?.length ?? 0))
      throw new Error(t('parser.block-layout-name', { written: m[0], line: line }))
    }
    // entre parenthèses : la forme développée se reconnaît pour être citée telle qu'écrite (cf.
    // raiseUnclosedBlock) ; les retours à la ligne d'un `{? a,\n b}` restent dans l'expression, que le
    // parseur rogne — les lignes qui suivent ne bougent pas
    const cond  = '(' + names.map(x => `µlayout is '${x}'`).join(' or ') + ')'
    const jumps = m[0].replace(/[^\n]/g, '')
    const rest  = stack[stack.length - 1]?.kind === 'layout'
    if (!rest) stack.push({ kind: 'layout', names, index: m.index })
    out += html.slice(i, m.index) + (rest ? `{elsif ${cond}${jumps}}` : `{if ${cond}${jumps}}`)
    i = m.index + m[0].length
  }
  // le dernier bloc resté ouvert est un bloc de modèle : cité tel qu'écrit, à sa première ouverture ; un {if} ou
  // un {for} resté ouvert, lui, est dit par le parseur
  const openBlock = stack[stack.length - 1]
  if (openBlock?.kind === 'layout') raiseUnclosedBlock('?', openBlock.names!.join(', '), cite(firstLine + (html.slice(0, openBlock.index).match(/\n/g)?.length ?? 0)))
  return out + html.slice(i)
}

// les modèles en fichier de l'analyse en cours (cf. ParseDiag.models)
let fileModels: { dev: Record<string, string[]>, core: Record<string, string[]> } = { dev: {}, core: {} }

// les balises du projet de l'analyse en cours (cf. ParseDiag.projectTags), et les positions de chaque texte de balise dans le texte lu
let projectTags: ProjectTagSeen[] | null = null
let seenTexts                            = new Map<string, number[]>()
// les liens `<a href="#/…">` de l'analyse en cours (cf. ParseDiag.links)
let seenLinks: LinkSeen[] | null = null

// les positions de `texte` dans `str`, le texte lu, cherchées une fois par analyse
function positionsOf(str: string, text: string): number[] {
  let seen = seenTexts.get(text)
  if (!seen) {
    seen = []
    for (let i = str.indexOf(text); i !== -1; i = str.indexOf(text, i + 1)) seen.push(i)
    seenTexts.set(text, seen)
  }
  return seen
}

// les variables typées dont un champ lié se garde de lui-même (cf. ParseDiag.guarded), et comment
let guarded     = new Set<string>()
let guardSilent = false
const GUARD_FIELDS = new Set(['input', 'textarea', 'select'])
const GUARD_BIND   = /^!(?:\.\w+)?\{\s*(\$\$?[A-Za-z_]\w*)\s*\}$/

// `{await $profil *skeleton(réglages)}` : l'attente prend la forme du contenu à venir (cf. placeSkeleton) ; rend les
// réglages (`''` sans réglages), null sans *skeleton
function skeletonSettings(node: Node): string | null {
  const sk = /^([\s\S]*?)\s+\*skeleton(?:\(([\s\S]*)\))?$/.exec(node.expr ?? '')
  if (sk) node.expr = sk[1].trim()
  return sk ? sk[2] ?? '' : null
}

// `{await.keep expr}` : l'option s'écrit sur le mot du bloc, hors de l'expression — aucune expression ne change de sens (un mot écrit
// après elle se lirait comme un appel ou un opérande : `{await load keep}` est `load(keep)`), et `{await.keep …}` ne se construisait pas
// avant (bloc inconnu, ses branches orphelines). Lue telle quelle par l'arbre (src/reader)
const AWAIT_KEEP = /^\{?await\.keep\s/

// la tête d'un `{await` qui n'ouvre pas de bloc : une option inconnue sur le mot du bloc (`{await.kep …}`, `{await.KEEP …}` : la seule est
// `keep`) ou le bloc écrit sans expression (`{await}`, `{await.keep}`), refusés avec leur message ; l'accolade se lisait sinon comme un texte
// (`await Promise.kep(…)`), et les branches qui la suivent comme des jetons orphelins. `debut` : ce qui suit l'accolade ouvrante
function refuseAwaitHead(start: string, line: number | string): void {
  const option = /^await\.([^\s}]*)/.exec(start)
  if (option && option[1] !== 'keep') throw new Error(t('parser.await-option-unknown', { word: option[1], line: line }))
  const alone = /^(await(?:\.keep)?)\s*(?:\}|$)/.exec(start)
  if (alone) throw new Error(t('parser.await-no-expression', { written: alone[1], example: `${alone[1]} charger($id)`, line: line }))
}

// l'expression d'un {await} lue, son squelette retiré : vide, ou oubliée devant `*skeleton` (`{await *skeleton}` se compilait en silence en
// une fonction, `a => a*skeleton`), elle est refusée avec son message. `*skeleton` finit la tête : une expression écrite après lui et ses
// réglages (`{await *skeleton $p}`) passe devant lui dans l'exemple (`{await $p *skeleton}`)
function refuseAwaitWithoutExpression(node: Node, line: number | string): void {
  const expr = node.expr ?? ''
  if (expr !== '' && !/^\*skeleton(?![\w$-])/.test(expr)) return
  const word     = node.keep ? 'await.keep' : 'await'
  const skeleton = expr.slice(0, skeletonEnd(expr))
  const after    = expr.slice(skeleton.length).trim()
  const example  = `${word} ${after || 'charger($id)'}${skeleton ? ' ' + skeleton : ''}`
  throw new Error(t('parser.await-no-expression', { written: expr === '' ? word : `${word} ${expr}`, example: example, line: line }))
}

// fin de `*skeleton` et de ses réglages en tête de `expr` (0 sans squelette) : parenthèses lues au niveau, chaînes sautées
function skeletonEnd(expr: string): number {
  if (!expr.startsWith('*skeleton')) return 0
  let i = '*skeleton'.length
  if (expr[i] !== '(') return i
  let depth = 0
  while (i < expr.length) {
    const c = expr[i]
    if (c === '"' || c === "'" || c === '`') {
      const end = expr.indexOf(c, i + 1)
      i = end < 0 ? expr.length : end + 1
      continue
    }
    if (c === '(') depth++
    else if (c === ')' && --depth === 0) return i + 1
    i++
  }
  return i
}

// le squelette d'un {await} lu en entier : celui qui est écrit ; sans branche d'attente écrite, celui de {success},
// d'office — jamais en SVG ni en MathML. `startCite` : sa ligne telle que ses messages la citent (partiel compris, cf. citeAt)
function awaitEnd(node: Node, skeleton: string | null, startLine: number, startCite: number | string): void {
  if (skeleton !== null) {
    if (foreignTag) throw new Error(t('parser.skeleton-svg', { tag: foreignTag, line: startCite }))
    placeSkeleton(node, skeleton, startLine, startCite)
  }
  else if (autoSkeleton && !foreignTag && node.branches.some(b => b.type === 'success') && !node.branches[0].children.some(c => c.type !== 'text' || (c.content ?? '').trim() !== '')) placeSkeleton(node, '', startLine, startCite)
}

// la tête d'un {for} lue : `item in liste`, `index, item in liste`, `… by champ` ; refusée avec son message, qui cite `startCite`
// (partiel compris, cf. citeAt)
function forNode(expr: string, startLine: number, startCite: number | string): Node {
  // µ admis dans la classe de caractères (au même titre que $) : un item/index
  // ainsi nommé matche la syntaxe et passe par rejectReservedName ci-dessous, plutôt que de
  // tomber dans le message de syntaxe générique
  // `[\s\S]` : un parcours écrit sur plusieurs lignes (`$items.filter((i) ->⏎ i.ok)`) passe, comme un `{if}`
  const m = expr.match(/^(?:([a-zA-Z0-9_$µ]+)\s*,\s*)?([a-zA-Z0-9_$µ]+)\s+in\s+([\s\S]+?)(?:\s+by\s+([a-zA-Z0-9_$µ]+))?$/)
  if (!m) {
    // Avant ce throw, un `{for}` non reconnu était avalé SANS erreur : aucun
    // nœud poussé, et son `{end}` fermait le bloc PARENT → template mutilé
    // en silence. Cas typique : `{for x of arr}` (habitude JS).
    const hint = /\s+of\s+/.test(expr) ? t('parser.for-tip-in-not-of') : ''
    throw new Error(t('parser.for-syntax-invalid', { expr, line: startCite, tipOf: hint }))
  }
  // `by` attend le nom d'un champ de l'élément : `by x.id` restait collé au parcours (« $l by x.id ») et la
  // construction échouait plus loin, sur un message de Civet sans rapport
  const byPath = m[4] ? null : /\s+by\s+([a-zA-Z_$µ][\w$µ]*(?:\.[a-zA-Z_$µ][\w$µ]*)+)\s*$/.exec(m[3])
  if (byPath) {
    const rest = byPath[1].startsWith(m[2] + '.') ? byPath[1].slice(m[2].length + 1) : ''
    throw new Error(t('parser.for-by-path', { expr, key: byPath[1], field: /^[\w$µ]+$/.test(rest) ? rest : 'id', line: startCite }))
  }
  const node = new Node('for')
  node.line = startLine  // la ligne du mot-clé {for} lui-même, comme pour {await} (cf. compileAwait, generator/compile.ts)
  // Si l'ITEM s'appelle `index` (sans index explicite), le compteur
  // implicite prend un nom interne — sinon le générateur émettrait
  // `(index, index) =>` : paramètres dupliqués = SyntaxError en module ES.
  node.index = m[1] ?? (m[2] === 'index' ? '_mjs_i' : 'index')
  node.item = m[2]
  node.iterable = m[3].trim()
  node.key = m[4] ?? null
  rejectReservedName('for', node.item, startCite)
  if (m[1]) rejectReservedName('for', node.index, startCite)
  // item et index homonymes : `{for x, x in …}` émettrait `(x, x) =>`
  // (clash de paramètres = SyntaxError). Rejet avec message clair.
  if (m[1] && node.item === node.index) {
    throw new Error(t('parser.for-item-index-same-name', { item: node.item, index: node.index, line: startCite }))
  }
  return node
}

// ============================================================================
// Squelette d'attente — `{await $profil *skeleton}` : pendant l'attente, la forme du contenu à venir,
// tirée de la branche {success} au build. Les balises restent (leur classe, leur style : la mise en
// page tient) ; chaque texte ou valeur devient une barre qui scintille (courte, moyenne, longue ; un
// titre ; trois lignes pour une valeur seule dans un paragraphe, une barre longue seule dans un bloc
// ou une case) ; une image garde sa boîte ; un
// composant devient un bloc ; un {for}, trois fois son contenu ; un {if}, sa première branche. Le
// tout dans une zone sans boîte (`mjs-skel-zone`) qui porte l'effet *skeleton et ses réglages
// (couleurs, vitesse, arrondi — runtime/mjs_fx_skeleton.ts).
// ============================================================================
const SKEL_KEEP  = /^(class|style|role|width|height|colspan|rowspan|data-[\w-]+)$/
const SKEL_MEDIA = new Set(['picture', 'video', 'canvas', 'svg', 'iframe', 'object', 'embed', 'audio'])
const SKEL_FIELD = new Set(['input', 'textarea', 'select'])
// la directive d'une transition à proposer à la place de l'ancienne écriture : son nom et ses modificateurs
// `.global` / `.shared`, dans l'ordre où ils sont écrits ; le nom d'une ancienne animation (`@in.fly.shared`
// → `@in.shared`) ne reste pas
export function transitionDirective(name: string): string {
  const [base, ...rest] = name.split('.')
  return base + rest.filter(m => m === 'global' || m === 'shared').map(m => '.' + m).join('')
}

// une transition entre guillemets (`:in="*fly(up)"`, `:out='*fade'`) : un effet s'écrit sans eux —
// une seule écriture, `:in=*fly(up)` (`:in.global="*fly"` donne `:in.global=*fly` : le modificateur reste) ; `name` : le nom interne (`@in`)
function noQuotedEffect(name: string, val: string): string {
  if (/^@(?:in|out|transition)(?:\.\w+)*$/.test(name) && /^\s*\*[A-Za-z]/.test(val)) throw new Error(t('transitions.quotes', { directive: shownName(transitionDirective(name)), effect: val.trim() }))
  return val
}

const SKEL_LINES = new Set(['p', 'dd', 'blockquote', 'figcaption'])
const SKEL_WIDE  = new Set(['div', 'li', 'td', 'th', 'section', 'article', 'dt'])
const SKEL_TITLE = /^h[1-6]$/

function skelBar(kind: string, line?: number): Node {
  const i = new Node('tag')
  i.name  = 'i'
  i.line  = line
  i.attrs = [{ type: 'static', name: 'mjs-skel', val: kind }]
  if (kind === 'lines') for (let k = 0; k < 3; k++) i.children.push(skelBar('line', line))
  return i
}

function skeletonOf(nodes: Node[], parent: string | null): Node[] {
  const out: Node[] = []
  const nonEmpty = nodes.filter(n => !(n.type === 'text' && !(n.content ?? '').trim()) && n.type !== 'const')
  for (const n of nodes) {
    if (n.type === 'text') {
      const txt = (n.content ?? '').trim()
      if (txt) out.push(skelBar(txt.length <= 6 ? 's' : txt.length <= 24 ? 'm' : 'l', n.line))
      else {
        const w = new Node('text')
        w.content = n.content
        out.push(w)
      }
    }
    else if (n.type === 'expr') {
      const alone = nonEmpty.length === 1 && !!parent
      out.push(skelBar(parent && SKEL_TITLE.test(parent) ? 'title' : alone && SKEL_LINES.has(parent!) ? 'lines' : alone && SKEL_WIDE.has(parent!) ? 'l' : 'm', n.line))
    }
    else if (n.type === 'tag') {
      const name = n.name ?? ''
      if (name.includes('-') || name.startsWith('@')) out.push(skelBar('block', n.line))
      else if (SKEL_FIELD.has(name)) out.push(skelBar('m', n.line))
      else if (SKEL_MEDIA.has(name)) out.push(skelBar('media', n.line))
      else {
        const c = new Node('tag')
        c.name  = name
        c.line  = n.line
        // les attributs FIXES seulement : une valeur mêlée d'interpolation (`class="a {d.c}"`) lit la
        // valeur à venir, absente pendant l'attente
        c.attrs = n.attrs.filter(a => (a.type === 'boolean' || (a.type === 'static' && !/[{}]/.test(a.val ?? ''))) && !!a.name && SKEL_KEEP.test(a.name)).map(a => ({ ...a }))
        // une image garde sa boîte (sa classe la dimensionne), sans ce qu'elle montre
        if (name === 'img') c.attrs.push({ type: 'static', name: 'mjs-skel', val: 'media' })
        else c.children = skeletonOf(n.children, name)
        out.push(c)
      }
    }
    else if (n.type === 'if') out.push(...skeletonOf(n.branches[0]?.children ?? [], parent))
    else if (n.type === 'for') for (let k = 0; k < 3; k++) out.push(...skeletonOf(n.children, parent))
    else if (n.type === 'await') out.push(...skeletonOf((n.branches.find(b => b.type === 'success') ?? n.branches[0])?.children ?? [], parent))
    else if (n.type === 'key') out.push(...skeletonOf(n.children, parent))
  }
  return out
}

const SKEL_VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
const skelEsc   = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
function skelSerialize(nodes: Node[]): string {
  let out = ''
  for (const n of nodes) {
    if (n.type === 'text') out += skelEsc(n.content ?? '')
    else if (n.type === 'tag' && n.name) {
      const attrs = n.attrs.map(a => a.type === 'boolean' ? ' ' + a.name : ' ' + a.name + '="' + skelEsc(a.val ?? '') + '"').join('')
      out += SKEL_VOID.has(n.name) ? `<${n.name}${attrs}>` : `<${n.name}${attrs}>${skelSerialize(n.children)}</${n.name}>`
    }
  }
  return out
}

/** la silhouette d'un gabarit de composant, en HTML (le squelette d'un composant dont le code arrive,
 *  rangé au manifeste par le build) : les balises et leurs attributs fixes, une barre par texte, les
 *  composants en blocs — cf. skeletonOf */
export function skeletonHtml(template: string, firstLine = 1): string {
  const root = parse(template, undefined, { firstLine })
  return skelSerialize(skeletonOf(root.children, null)).replace(/>\s+</g, '><').trim()
}

// la silhouette au manifeste, en forme compacte : le HTML de skeletonHtml une fois remis en balises par la page
// (runtime/mjs_fx_skeleton.ts, _mjsSkelHtml), sans chevrons ni fermetures écrites — une barre est un chiffre (son
// rang dans SKEL_KINDS, à partir de 1), une balise `nom.classe attributs>` (`nom/>` une balise vide, `img…>` une
// image et sa boîte), sa fermeture `)`, tues en fin de chaîne ; trois fois de suite la même suite (un {for})
// s'écrit `[suite]` ; `[` et `]` d'une valeur, `&#91;` et `&#93;`. Les blancs entre balises ne restent pas (cf. skeletonHtml)
const SKEL_KINDS = ['s', 'm', 'l', 'title', 'lines', 'block', 'media']
const SKEL_CLASS = /^[^\s."<>&\[\]\/]+(?: [^\s."<>&\[\]\/]+)*$/
function skelParts(nodes: Node[]): string[] {
  const parts: string[] = []
  for (const n of nodes) {
    if (n.type !== 'tag' || !n.name) continue
    const bar = n.name === 'i' && n.attrs.length === 1 && n.attrs[0].name === 'mjs-skel' ? SKEL_KINDS.indexOf(n.attrs[0].val ?? '') : -1
    if (bar >= 0) {
      parts.push(String(bar + 1))
      continue
    }
    const image = n.name === 'img' && n.attrs[n.attrs.length - 1]?.name === 'mjs-skel'
    let attrs   = image ? n.attrs.slice(0, -1) : n.attrs
    let head    = n.name
    // la classe en tête, à la façon d'un sélecteur (`li.message`), quand ses noms s'y prêtent
    if (attrs[0]?.name === 'class' && attrs[0].type === 'static' && SKEL_CLASS.test(attrs[0].val ?? '')) {
      head += '.' + attrs[0].val!.split(' ').join('.')
      attrs = attrs.slice(1)
    }
    head += attrs.map(a => a.type === 'boolean' ? ' ' + a.name : ' ' + a.name + '="' + skelEsc(a.val ?? '') + '"').join('')
    head  = head.replace(/\[/g, '&#91;').replace(/\]/g, '&#93;')
    parts.push(image ? head + '>' : SKEL_VOID.has(n.name) ? head + '/>' : head + '>' + skelRepeat(skelParts(n.children)) + ')')
  }
  return parts
}

// trois fois de suite la même suite de nœuds : `[suite]`, la plus longue d'abord, elle-même réduite
function skelRepeat(parts: string[]): string {
  let out = ''
  for (let i = 0; i < parts.length;) {
    let k = Math.floor((parts.length - i) / 3)
    for (; k > 0; k--) {
      const a = parts.slice(i, i + k).join('')
      if (a.length > 1 && a === parts.slice(i + k, i + 2 * k).join('') && a === parts.slice(i + 2 * k, i + 3 * k).join('')) break
    }
    if (k > 0) {
      out += '[' + skelRepeat(parts.slice(i, i + k)) + ']'
      i   += 3 * k
    }
    else out += parts[i++]
  }
  return out
}

// un contenu attendu quelque part dans le gabarit : un {await}, dans une balise ou une branche
function skelWaits(nodes: Node[]): boolean {
  return nodes.some(n => n.type === 'await' || skelWaits(n.children) || n.branches.some(b => skelWaits(b.children)))
}

/** la silhouette d'un gabarit de composant pour le manifeste : sa forme compacte (vide : pas de silhouette) et s'il
 *  attend un contenu — sans {await}, il est rendu dès que son code arrive (cf. componentSkeletons, bundler) */
export function componentSkeleton(template: string, firstLine = 1): { shape: string, wait: boolean } {
  const root = parse(template, undefined, { firstLine })
  return { shape: skelRepeat(skelParts(skeletonOf(root.children, null))).replace(/\)+$/, ''), wait: skelWaits(root.children) }
}

function placeSkeleton(node: Node, settings: string, line: number, cite: number | string): void {
  const pending = node.branches.find(b => b.type === 'pending')!
  const success = node.branches.find(b => b.type === 'success')
  if (pending.children.some(c => c.type !== 'text' || (c.content ?? '').trim() !== '')) throw new Error(t('parser.skeleton-pending-written', { line: cite }))
  if (!success) throw new Error(t('parser.skeleton-no-success', { line: cite }))
  const zone = new Node('tag')
  zone.name  = 'div'
  zone.line  = line
  zone.attrs = [{ type: 'boolean', name: 'mjs-skel-zone' }, { type: 'static', name: 'aria-hidden', val: 'true' }, { type: 'static', name: '*skeleton', val: settings }]
  zone.children = skeletonOf(success.children, null)
  pending.children = [zone]
}

// ============================================================================
// DOM parser
// ============================================================================
// les 12 balises réservées (include/slot/head/body/html/document/
// window/element/module/failed/view/FILL_DIRECTIVE) sont normalement consommées
// EN AMONT (macros.ts, processIncludes, ou la regex `preprocess` de
// generator/compile.ts pour @view) avant que le HTML n'atteigne ce parseur. Si
// l'une d'elles l'atteint quand même (@view/@slot en usage direct courant, ou
// un cas non couvert par les regex macro), on la laisse INTACTE — comportement
// historique préservé, jamais réécrite en raccourci composant. La
// directive bloc de slot (FILL_DIRECTIVE) suit EXACTEMENT le même chemin :
// `</@…>` obligatoire (jamais la forme nue, ni `mjs-…`) — voir
// hoistFillBlocks plus bas, qui la déplie APRÈS coup.
// Exportée : réutilisée par bundler/index.ts (resolveTagShortcuts) — mêmes 12
// noms pour les gardes de post-passe (fichier projet nommé comme une réservée)
// et l'union de suggestion levenshtein, source unique.
export const AT_RESERVED_NAMES = ['include', 'slot', 'head', 'body', 'html', 'document',
                                   'window', 'element', 'module', 'failed', 'view', FILL_DIRECTIVE]

// le texte écrit de chaque attribut d'une référence à un module cœur (cf. TagRefAttrs.texts) ; un attribut écrit sans valeur est le texte vide
function attrTexts(attrs: Attr[]): Record<string, string | null> {
  return Object.fromEntries(attrs.flatMap(a => a.name ? [[a.name.toLowerCase(), a.type === 'boolean' ? '' : a.type === 'static' && !/[{}&]/.test(a.val ?? '') ? (a.val ?? '') : null]] : []))
}

// l'expression des attributs calculés (`nom={…}`), nom en minuscules ; null quand la balise n'en écrit aucun
function attrExprs(attrs: Attr[]): Record<string, string> | null {
  const out = attrs.flatMap(a => a.name && a.type === 'dynamic' && typeof a.expr === 'string' ? [[a.name.toLowerCase(), a.expr]] : [])
  return out.length ? Object.fromEntries(out) : null
}

// resolveTagName — réécrit `<@nom>` en `<mjs-nom>` (raccourci-dev, un composant du
// PROJET) et `<@@nom>` en `<mjs-core-nom>` (raccourci-coeur, un module de la
// bibliothèque cœur), en enregistrant
// chaque référence dans `tagRefs` (push, pas de retour — la post-passe du
// bundler résout APRÈS avoir vu tous les fichiers). `<@mjs-nom>` (ancienne
// notation dédiée au cœur, RETIRÉE) est une ERREUR DE MIGRATION — kind
// `shortcut-mjs-removed`, name = le nom SANS le préfixe `mjs-` ; l'émission
// (`mjs-<nom>`) n'a plus d'importance, le build échouera à la post-passe. Une
// balise littérale `mjs-nom`/`mjs-core-nom` (sans `@`, écrite à la main) est
// aussi enregistrée, SANS réécriture (déjà sous sa forme finale).
// Exportée : le repli d'un <@failed>, que ce parseur ne lit pas, nomme ses balises par elle (macros.ts, fallbackTags)
export function resolveTagName(rawName: string, tagRefs?: TagRef[]): string {
  if (rawName === '@view') return 'metamjs-view'
  if (rawName === '@slot') return 'slot'

  if (rawName.startsWith('@@')) {
    const name = rawName.slice(2)
    tagRefs?.push({ name: name, kind: 'shortcut-core' })
    return `mjs-core-${name}`
  }

  if (rawName.startsWith('@')) {
    const bare = rawName.slice(1)
    if (AT_RESERVED_NAMES.includes(bare)) return rawName  // réservée échappée aux macros → intacte
    if (bare.startsWith('mjs-')) {
      const name = bare.slice('mjs-'.length)
      tagRefs?.push({ name: name, kind: 'shortcut-mjs-removed' })
      return `mjs-${name}`
    }
    tagRefs?.push({ name: bare, kind: 'shortcut-dev' })
    return `mjs-${bare}`
  }

  const lower = rawName.toLowerCase()
  if (lower.startsWith('mjs-core-')) {
    tagRefs?.push({ name: rawName.slice('mjs-core-'.length), kind: 'literal-core' })
  } else if (lower.startsWith('mjs-')) {
    tagRefs?.push({ name: rawName.slice('mjs-'.length), kind: 'literal-dev' })
  }
  return rawName
}

// sonde SANS consommation : la balise raccourci ouverte va-t-elle un jour se
// refermer (comptage équilibré du même nom, profondeur initiale 1, ouvrantes <@x/<mjs-x
// vs fermantes </@x>/</mjs-x>) ? Position sauvegardée puis restaurée — rejoue le
// sous-ensemble tag-scanning d'openTag/parseAttrs sur le SCANNER RÉEL plutôt qu'un
// regex naïf sur une sous-chaîne : une valeur d'attribut piégeuse (`title="a > b"`) ne
// fausse pas le comptage, et une occurrence AUTOFERMANTE du même nom ne compte pas comme
// une ouverture en attente (net zéro). Limite assumée : une
// mention du nom dans un texte/commentaire quelconque (pas un vrai tag) peut fausser le
// comptage — pas un vrai parseur XML, jamais prétendu l'être ailleurs dans ce fichier.
function willClose(scanner: Scanner, resolvedName: string): boolean {
  const savedPos = scanner.pos
  // aucune fermante qui se résoudrait en ce nom plus loin (`</mjs-x`, `</@mjs-x`, `</@x`, `</@@x`) : le parcours
  // ne trouverait rien — sans ce pré-test, chaque raccourci nu relisait tout le reste du gabarit (temps quadratique)
  if (!closingShapes(resolvedName).some(f => scanner.str.indexOf(f, savedPos) >= 0)) return false
  let depth = 1
  let found = false
  while (!scanner.eos()) {
    const step = probeStep(scanner)
    if (step === 'abandon') break
    if (step === 'closing' && stepName === resolvedName) {
      depth--
      if (depth === 0) {
        found = true
        break
      }
    }
    else if (step === 'opening' && stepName === resolvedName) depth++
  }
  scanner.pos = savedPos
  return found
}

// les débuts de fermante écrits qui se résolvent en ce nom (`</mjs-x`, `</@mjs-x`, `</@x`, `</@@x`)
function closingShapes(resolvedName: string): string[] {
  const forms = ['</' + resolvedName, '</@' + resolvedName]
  if (resolvedName.startsWith('mjs-')) forms.push('</@' + resolvedName.slice(4))
  if (resolvedName.startsWith('mjs-core-')) forms.push('</@@' + resolvedName.slice(9))
  return forms
}

// le nom résolu de la dernière fermante ou ouvrante lue par probeStep
let stepName = ''

// un pas de la sonde depuis la position du scanner : 'fermante', ou 'ouvrante' quand elle compte (ni auto-fermante,
// ouverture et fermeture dans le même jeton, ni balise vide), son nom résolu dans stepName ; 'texte' pour le reste — un
// commentaire et une expression `{…}` ne portent aucune balise (`{$n<3 ? …}`, `<!-- <div a a> -->`) ; 'abandon' sur une
// expression mal fermée ou une balise malformée (abandon prudent, void par défaut côté appelant), ou un pas sans progrès
function probeStep(scanner: Scanner): 'closing' | 'opening' | 'text' | 'abandon' {
  const posBefore = scanner.pos
  if (scanner.scan(/<!--(?:-?>|[\s\S]*?--!?>)/)) return 'text'
  if (scanner.scan(/\{/)) {
    try {
      extractBalanced(scanner, '}')
    }
    catch {
      return 'abandon'
    }
    return 'text'
  }
  let step: 'closing' | 'opening' | 'text' = 'text'
  if (scanner.scan(/<\/([a-zA-Z0-9\-@]+)\s*>/)) {
    stepName = resolveTagName(scanner.group(1)!)
    step     = 'closing'
  }
  else if (scanner.scan(/<(@@?[a-zA-Z0-9-]+|[a-zA-Z][a-zA-Z0-9-]*)/)) {
    const name2 = resolveTagName(scanner.group(1)!)
    const tmp   = new Node('tag')
    tmp.name = name2
    parseAttrs(scanner, tmp)
    if (scanner.scan(/\s*\/>/) === null) {
      if (VOID_TAGS.includes(name2.toLowerCase())) scanner.scan(/\s*>/)
      else if (scanner.scan(/\s*>/) === null) return 'abandon'
      else {
        stepName = name2
        step     = 'opening'
      }
    }
  }
  else if (!scanner.scan(/[^<{]+/)) scanner.getch()
  // garde anti-boucle infinie
  return scanner.pos === posBefore ? 'abandon' : step
}

// la réponse de willClose pour chaque balise raccourci de `starts` (la position qui suit son `>` et son nom résolu,
// dans l'ordre du texte), en un seul balayage du gabarit. Le balayage de willClose ne dépend que de la position d'où il
// part : une balise où passe le balayage en cours y entre sans relire la suite, et sa fermante est la première fermante
// de son nom qui ramène le compte de ce nom (ouvrantes moins fermantes) en dessous de ce qu'il valait juste après elle ;
// une balise que le balayage enjambe (une expression lue d'un autre départ) est sondée seule. Une balise que la sonde ne
// lit pas (attribut refusé) l'arrête, comme une balise malformée ; `refus`, quand il est donné, reçoit le premier départ
// dont willClose lèverait là (le gabarit est alors refusé à ce départ, de ce message : probeRefusal), -1 sinon. Lu dans
// le dialecte du gabarit, comme willClose (une regex passée sans parenthèses en Civet ou en CoffeeScript, `f /"/`, est une
// division en JavaScript : la sonde y lirait une chaîne jamais refermée, ou y cacherait une balise)
export function upcomingClosings(text: string, starts: { pos: number, name: string }[], dialect: boolean, reject?: { k: number }): boolean[] {
  const found   = starts.map(() => false)
  if (reject !== undefined) reject.k = -1
  // la dernière fermante écrite de chaque nom : le pré-test de willClose, sans relire la suite pour chaque balise
  const last = new Map<string, number>()
  for (const d of starts) if (!last.has(d.name)) last.set(d.name, Math.max(...closingShapes(d.name).map((f) => text.lastIndexOf(f))))
  const scanner = new Scanner(text, 1, dialect)
  const count   = new Map<string, number>()
  const wait    = new Map<string, { k: number, count: number }[]>()
  let waiting   = 0
  let active    = false
  const halt    = (): void => {
    wait.clear()
    waiting = 0
    active  = false
  }
  // une sonde qui lève (attribut refusé) : willClose lève aussi, le gabarit est refusé à cette balise
  const raise = (k: number): void => {
    if (reject !== undefined && (reject.k < 0 || k < reject.k)) reject.k = k
  }
  const advance = (): void => {
    let step: ReturnType<typeof probeStep> = 'abandon'
    if (!scanner.eos()) {
      try {
        step = probeStep(scanner)
      }
      catch {
        for (const stack of wait.values()) for (const p of stack) raise(p.k)
        step = 'abandon'
      }
    }
    if (step === 'abandon') return halt()
    if (step === 'text' || !last.has(stepName)) return
    const c = (count.get(stepName) ?? 0) + (step === 'opening' ? 1 : -1)
    count.set(stepName, c)
    const stack = wait.get(stepName)
    if (step === 'closing' && stack !== undefined && stack.length > 0 && stack[stack.length - 1].count - 1 === c) {
      found[stack.pop()!.k] = true
      waiting--
    }
  }
  starts.forEach((d, k) => {
    if (last.get(d.name)! < d.pos) return
    while (waiting > 0 && active && scanner.pos < d.pos) advance()
    if (waiting > 0 && active && scanner.pos > d.pos) {
      const alone = new Scanner(text, 1, dialect)
      alone.pos = d.pos
      try {
        found[k] = willClose(alone, d.name)
      }
      catch {
        found[k] = false
        raise(k)
      }
      return
    }
    // rien en attente, ou le balayage arrêté : un nouveau balayage part de cette balise
    if (waiting === 0 || !active) {
      halt()
      count.clear()
      scanner.pos = d.pos
      active      = true
    }
    const stack = wait.get(d.name) ?? []
    stack.push({ k, count: count.get(d.name) ?? 0 })
    wait.set(d.name, stack)
    waiting++
  })
  while (waiting > 0 && active) advance()
  return found
}

// une balise ouvrante dont le nom vient d'être lu (`<nom`) : nom résolu, attributs (parseAttrs), *guard d'office, références
// et modèles en fichier, premiers attributs de <@view> et de <@slot> ; le scanner s'arrête avant la fin de la balise
// (`>` ou `/>`). Appelée par la lecture par l'arbre (readViaTree), et par refuseToken pour une balise jamais terminée
function openTag(scanner: Scanner, rawName: string, tagRefs?: TagRef[]): { node: Node & { name: string }, tagLine: number, tagCite: number | string, choice: ModelChoice | null, resolvedName: string } {
  const node = new Node('tag')
  const tagLine = currentLine(scanner)
  const tagCite = currentCite(scanner)
  node.line = tagLine
  if (typeof tagCite === 'string') node.cite = tagCite
  // le `<` de la balise (le scanner vient de lire `<` et son nom)
  const start = scanner.pos - rawName.length - 1

  // variants — longueur AVANT resolveTagName : si une référence vient d'être
  // empilée (balise composant, pas une réservée), on lui pose la valeur littérale de
  // layout=/template= une fois les attributs connus (pose APRÈS parseAttrs, ci-dessous).
  const tagRefsLenBefore = tagRefs?.length ?? 0
  // un modèle en fichier choisi par une valeur calculée : posé plus bas, lu par pushTag
  let choice: ModelChoice | null = null
  node.name = resolveTagName(rawName, tagRefs)
  // le nom qui referme la balise (un modèle en fichier renomme `node.name` juste en dessous)
  const resolvedName = node.name

  parseAttrs(scanner, node)
  const attrsEnd = scanner.pos

  // un lien `<a href="#/…">` écrit en dur ; une valeur qui calcule ou porte une entité, un étalement, un gestionnaire qui peut retenir le
  // clic : rien (cf. ParseDiag.links)
  if (seenLinks && rawName.toLowerCase() === 'a') {
    const href = node.attrs.find(a => a.type === 'static' && a.name?.toLowerCase() === 'href')?.val ?? ''
    if (href.startsWith('#/') && !/[{}&]/.test(href) && !node.attrs.some(a => a.type === 'spread' || /^(?:@(?!class\{|style\.)|on)/i.test(a.name ?? ''))) {
      const text = scanner.str.slice(start, attrsEnd)
      const seen = positionsOf(scanner.str, text)
      seenLinks.push({ href, line: tagLine, text: text, rank: seen.indexOf(start), total: seen.length })
    }
  }

  // *guard d'office : un champ lié à une variable typée (`<input value=!{$age}>`) le reçoit comme
  // s'il était écrit — un *guard écrit garde ses réglages ; `effects.guard: false` le rend muet (la
  // frappe reste à l'abri, la valeur ramenée à la sortie, sans effet ni bulle)
  if (guarded.size > 0 && GUARD_FIELDS.has(node.name)) {
    const link = node.attrs.find(a => a.name === 'value' && GUARD_BIND.test(a.val ?? ''))
    if (link && guarded.has(GUARD_BIND.exec(link.val!)![1])) {
      // la liaison se sait typée, même sous un *guard écrit : une liste à choix multiples y écrit null sans choix sous une règle de
      // liste qui l'accepte (generator/attributes)
      (link as { typed?: boolean }).typed = true
      if (!node.attrs.some(a => a.name === '*guard')) node.attrs.push({ type: 'static', name: '*guard', val: guardSilent ? 'silent: true' : '' })
    }
  }

  // <@@select> lié à une variable typée : la balise reçoit `typed`, et le module donne à un nombre l'option qui l'écrit autrement
  // (`02` pour 2), comme une liste native ; liée à une variable libre, elle reste telle quelle
  if (guarded.size > 0 && node.name === 'mjs-core-select') {
    const link = node.attrs.find(a => a.name === 'value' && GUARD_BIND.test(a.val ?? ''))
    if (link && guarded.has(GUARD_BIND.exec(link.val!)![1]) && !node.attrs.some(a => a.name === 'typed')) node.attrs.push({ type: 'static', name: 'typed', val: 'true' })
  }

  if (tagRefs && tagRefs.length > tagRefsLenBefore) {
    const ref        = tagRefs[tagRefs.length - 1]
    const layoutAttr = node.attrs.find(a => a.type === 'static' && (a.name === 'layout' || a.name === 'template'))
    if (layoutAttr) ref.layoutLiteral = layoutAttr.val
    // un modèle dans son propre fichier (`carte.compacte.mjs`) : la balise devient la sienne,
    // choisie en dur seulement (une valeur calculée ne peut pas changer de composant)
    const core   = ref.kind === 'shortcut-core' || ref.kind === 'literal-core'
    const models = (core ? fileModels.core : fileModels.dev)[ref.name.toLowerCase()]
    // un module cœur : les attributs écrits sur la balise, relevés avant que le choix d'un modèle en fichier ne retire `layout` (les références de modèle ci-dessous les reprennent)
    if (core) {
      const exprs = attrExprs(node.attrs)
      ref.attrs = { names: node.attrs.flatMap(a => a.name ? [a.name] : []), spread: node.attrs.some(a => a.type === 'spread'), texts: attrTexts(node.attrs), ...(exprs ? { exprs } : {}) }
    }
    // une balise du projet : ses attributs écrits, relevés comme ceux d'un module cœur avant que le choix d'un modèle ne retire `layout`
    const written = projectTags && !core ? node.attrs.flatMap(a => a.name ? [a.name] : []) : null
    if (models) {
      const computed = node.attrs.find(a => (a.name === 'layout' || a.name === 'template') && (a.type === 'dynamic' || (a.type === 'static' && /[{}]/.test(a.val ?? ''))))
      // choisi par une valeur calculée (`layout={$vue}`) : le compilateur écrit le {if} — la balise
      // de chaque modèle, sinon le composant de base (cf. pushTag) ; chaque modèle entre au bundle
      if (computed && computed.type === 'dynamic') {
        choice = { expr: computed.expr ?? '', attr: computed, models }
        for (const x of models) tagRefs!.push({ ...ref, name: `${ref.name}--${x}`, layoutLiteral: undefined })
      }
      else if (computed) throw new Error(t('parser.layout-file-computed', { tag: rawName, name: ref.name, layouts: models.join(', '), first: models[0], line: tagCite }))
      if (layoutAttr && models.includes(layoutAttr.val ?? '')) {
        node.name         = `${node.name}--${layoutAttr.val}`
        node.attrs        = node.attrs.filter(a => a !== layoutAttr)
        ref.name          = `${ref.name}--${layoutAttr.val}`
        ref.layoutLiteral = undefined
      }
    }
    // son nom final connu (modèle écrit en dur compris), la balise du projet et son texte, pour la retrouver dans le fichier
    if (projectTags && written && (ref.kind === 'shortcut-dev' || ref.kind === 'literal-dev')) {
      const text = scanner.str.slice(start, attrsEnd)
      const seen = positionsOf(scanner.str, text)
      projectTags.push({ name: ref.name, kind: ref.kind, names: written, spread: node.attrs.some(a => a.type === 'spread'), line: tagLine, text: text, rank: seen.indexOf(start), total: seen.length, ...(choice ? { models: choice.models } : {}) })
    }
  }
  // balise nue au nom d'élément personnalisé : relevée APRÈS le bloc ci-dessus (ni `layout`, ni modèle, ni attributs),
  // jamais réécrite
  else if (tagRefs && rawName[0] !== '@' && rawName.includes('-')) {
    tagRefs.push({ name: rawName, kind: 'bare-tag' })
  }

  if (rawName === '@view') {
    const first = node.attrs[0]
    if (first?.type === 'boolean') {
      const idName = first.name
      first.type = 'static'
      first.name = 'id'
      first.val = idName
    }
  }

  if (rawName === '@slot') {
    const first = node.attrs[0]
    if (first) {
      if (first.type === 'boolean') {
        // `<@slot title>` → `<slot name="title">`. Un identifiant nu est
        // TOUJOURS un nom de slot littéral — même s'il coïncide avec une
        // variable de boucle englobante. Le côté light DOM matche en écrivant
        // `slot="title"` sur l'enfant (idiome Web Components standard).
        const idName = first.name ?? ''
        first.type = 'static'
        first.name = 'name'
        first.val = idName
      } else if (first.type === 'dynamic') {
        // `<@slot {i}>` → `<slot name="{i}">`. Les accolades signalent une
        // expression évaluée (interpolation, cohérent avec `{$x}` partout en
        // MJS) → nom de slot dynamique. C'est le régime « slots indexés »
        // d'un `{for}` : `{for i, t in $tabs} <@slot {i}/> {end}`.
        const exprVal = first.expr ?? ''
        first.type = 'static'
        first.name = 'name'
        first.val = `{${exprVal}}`
      }
    }
  }
  return { node: node as Node & { name: string }, tagLine, tagCite, choice, resolvedName }
}

// un modèle en fichier choisi par une valeur calculée (`layout={$vue}`) : l'expression, l'attribut qui
// la porte, les modèles du composant
interface ModelChoice { expr: string, attr: Attr, models: string[] }

// pose une balise ; un modèle en fichier choisi par une valeur calculée devient un {if} : la balise du
// modèle dans chaque branche (sans l'attribut `layout`), le composant de base à la fin (avec, pour ses
// styles nommés et µlayout) — reposée quand la valeur change
function pushTag(container: Node[], node: Node, choice: ModelChoice | null): void {
  if (!choice) {
    container.push(node)
    return
  }
  const ifNode = new Node('if')
  ifNode.line  = node.line
  for (const x of choice.models) {
    const copy = cloneNode(node)
    copy.name  = `${node.name}--${x}`
    copy.attrs = copy.attrs.filter((a, k) => node.attrs[k] !== choice.attr)
    ifNode.branches.push({ expr: `(${choice.expr}) is '${x}'`, children: [copy] })
  }
  ifNode.branches.push({ expr: null, children: [node] })
  container.push(ifNode)
}

function cloneNode(n: Node): Node {
  const c = new Node(n.type)
  Object.assign(c, n)
  c.attrs    = n.attrs.map(a => ({ ...a }))
  c.children = n.children.map(cloneNode)
  c.branches = n.branches.map(b => ({ ...b, children: b.children.map(cloneNode) }))
  return c
}

// le commentaire que le passage des balises du langage laisse à la place d'un bloc retiré, pour garder ses lignes (cf. keepLines,
// transpiler/macros) : `<!--mjs-keep-lines`, puis rien que des sauts de ligne, puis `-->`, une marque que le framework seul écrit.
// Ôté là où un commentaire se verrait (le texte d'un `<textarea>` ou d'un `<title>`, une valeur d'attribut) : la sortie est celle
// du gabarit sans lui, et les lignes restent comptées, sur la source entière ; un commentaire écrit par l'auteur, même fait de
// sauts de ligne seuls, reste tel qu'écrit
export const LINE_CARRIER_OPEN = '<!--mjs-keep-lines'
export const LINE_CARRIER_RE   = /<!--mjs-keep-lines\n+-->/g

// un texte : une suite de caractères qui n'ouvre ni balise (`<tag`, `</tag`, `<@…`), ni commentaire (`<!--`), ni accolade ;
// un `<` qui n'ouvre rien reste du texte (cf. textes, dans readViaTree)
const TEXT_RUN_RE = /(?:[^{<]|<(?!\/?[a-zA-Z@]|!--))+/
// dans un <svg> ou un <math>, le texte s'arrête aussi à un `<![CDATA[`, un texte jusqu'à son `]]>`
const TEXT_RUN_FOREIGN_RE = /(?:[^{<]|<(?!\/?[a-zA-Z@]|!--|!\[CDATA\[))+/

// ============================================================================
// Fill blocks (bloc de slot) — passe après parse()
// ============================================================================
// sucre de COMPILATION, aucun changement du générateur ni du
// runtime : `<@fill nom>…</@fill>` (FILL_DIRECTIVE) se déplie en SES PROPRES ENFANTS, chacun
// porteur de `slot="nom"` (même attribut que l'idiome natif `slot="x"` posé à la main). Une fois
// cette passe tournée, le nœud `@fill` a disparu de l'arbre — tout le pipeline aval (generator,
// bundler) ne voit que des `tag` ordinaires.
//
// Choix : PASSE À PART (hoistFillBlocks), pas une branche de plus dans la lecture des balises, qui gère
// déjà l'ouverture/fermeture/void d'un tag générique — la directive, réservée (AT_RESERVED_NAMES),
// suit CE chemin SANS la moindre modification (fermante `</@…>` obligatoire, comme @window/@head).
// Toute la sémantique propre au bloc (nom littéral, traversée des blocs {if}/{for}/{await}/{key},
// erreurs) reste isolée ICI, sur l'arbre déjà construit — testable seule, sans toucher au parseur
// de balises. Appelée une seule fois par `parse()`, juste avant qu'il rende son arbre : SEUL point
// de production qui construit cet arbre (generator/compile.ts, un seul appel à `parse()`).
export function hoistFillBlocks(root: Node): void {
  hoistChildren(root.children)
}

function hoistChildren(children: Node[]): void {
  for (let i = 0; i < children.length; i++) {
    const node = children[i]

    if (node.type === 'tag' && node.name === FILL_TAG_NAME) {
      const replacement = expandFillBlock(node)
      children.splice(i, 1, ...replacement)
      i -= 1  // reprend AU MÊME index : les enfants substitués prennent la place du nœud retiré
      continue
    }

    if (node.type === 'tag' || node.type === 'for' || node.type === 'key') {
      hoistChildren(node.children)
    } else if (node.type === 'if' || node.type === 'await') {
      for (const branch of node.branches) hoistChildren(branch.children)
    }
  }
}

// describeFillAttr — rend un attribut de `<@fill …>` TEL QU'ÉCRIT, pour le message d'erreur
// « un seul nom » (parser.fill-single-name) — jamais consommé ailleurs.
function describeFillAttr(a: Attr): string {
  if (a.type === 'static') return `${a.name}="${a.val}"`
  if (a.type === 'dynamic') return a.name ? `${a.name}={${a.expr}}` : `{${a.expr}}`
  if (a.type === 'spread') return `{...${a.expr}}`
  return a.name ?? ''
}

// expandFillBlock — valide le NOM (littéral, obligatoire, SEUL) puis déplie `fillNode` en ses
// propres enfants, chacun stampé `slot=`. Le nœud `@fill` lui-même ne survit jamais à cette
// fonction.
function expandFillBlock(fillNode: Node): Node[] {
  const line  = fillNode.cite ?? fillNode.line ?? 0
  const first = fillNode.attrs[0]

  if (!first) {
    throw new Error(t('parser.fill-no-name', { directive: FILL_DIRECTIVE, line: line }))
  }
  // seul `attrs[0]` était lu : un nom en trop (`<@fill x y>`) ou un attribut de
  // plus (`<@fill x class="foo">`, `<@fill x {...$rest}>`) posait quand même `slot="x"` et
  // perdait le reste SANS UN MOT.
  if (fillNode.attrs.length > 1) {
    const excerpt = fillNode.attrs.map(describeFillAttr).join(' ')
    throw new Error(t('parser.fill-single-name', { directive: FILL_DIRECTIVE, line: line, excerpt: excerpt }))
  }
  if (first.type === 'dynamic') {
    throw new Error(t('parser.fill-name-dynamic', { directive: FILL_DIRECTIVE, expr: first.expr ?? '', line: line }))
  }
  if (first.type !== 'boolean') {
    throw new Error(t('parser.fill-no-name', { directive: FILL_DIRECTIVE, line: line }))
  }

  const name = first.name ?? ''
  stampSlot(fillNode.children, name)
  return fillNode.children
}

// stampSlot — pose `slot=nom` sur chaque `tag` de `children` (composant `<@x>` compris — déjà
// résolu en `tag` à ce stade du pipeline). TRAVERSE {if}/{for}/{await}/{key} pour atteindre leurs
// propres `tag` (chaque branche, chaque itération de boucle). Retire le texte blanc en silence ;
// refuse texte non blanc, `expr`, bloc imbriqué et tag déjà porteur de `slot=`.
function stampSlot(children: Node[], name: string): void {
  for (let i = 0; i < children.length; i++) {
    const node = children[i]
    const line = node.cite ?? node.line ?? 0

    if (node.type === 'text') {
      // un commentaire HTML `<!-- … -->` SEUL (rien d'autre autour) est du blanc au
      // même titre qu'un espace : retiré, jamais refusé « texte nu ».
      const noComments = (node.content ?? '').replace(/<!--(?:-?>|[\s\S]*?--!?>)/g, '')
      if (noComments.trim() === '') { children.splice(i, 1); i -= 1; continue }
      throw new Error(t('parser.fill-text-bare', { directive: FILL_DIRECTIVE, name: name, line: line }))
    }

    if (node.type === 'expr') {
      throw new Error(t('parser.fill-text-bare', { directive: FILL_DIRECTIVE, name: name, line: line }))
    }

    if (node.type === 'tag') {
      if (node.name === FILL_TAG_NAME) {
        throw new Error(t('parser.fill-nested', { directive: FILL_DIRECTIVE, line: line }))
      }
      if (node.attrs.some(a => a.name === 'slot')) {
        throw new Error(t('parser.fill-slot-already-set', { directive: FILL_DIRECTIVE, name: name, tag: node.name, line: line }))
      }
      node.attrs.push({ type: 'static', name: 'slot', val: name })
      continue
    }

    if (node.type === 'for' || node.type === 'key') {
      stampSlot(node.children, name)
    } else if (node.type === 'if' || node.type === 'await') {
      for (const branch of node.branches) stampSlot(branch.children, name)
    }
    // 'const' — déclaration pure, aucun enfant à parcourir
  }
}

// ============================================================================
// Entrypoint
// ============================================================================
// pile d'appels épuisée : un gabarit imbriqué sur des milliers de niveaux (balises dans des balises, blocs
// dans des blocs), l'analyse et la génération descendant d'un appel par niveau ; quand la pile s'épuise pendant que le
// moteur compile une expression régulière, le même débordement arrive en SyntaxError « Invalid regular expression … »,
// suivi de « Maximum call stack size exceeded » ou de « Stack overflow » selon l'étape de la compilation
export function stackOverflow(e: unknown): boolean {
  return (e instanceof RangeError && /call stack/i.test(e.message))
    || (e instanceof SyntaxError && /maximum call stack size exceeded|stack overflow/i.test(e.message))
}

// ============================================================================
// Lecture par l'arbre unique
// ============================================================================
// le gabarit est lu par le lecteur unique (src/reader, option `gabarit`) ; readViaTree en rend au générateur l'arbre de
// Node, avec ses lignes et ses messages. Le lecteur dit où chaque balise, chaque bloc, chaque accolade et chaque texte
// commence et finit — une accolade finit là où extractBalanced la referme (regex, chaînes et commentaires compris) —, et
// quelle balise raccourci reste vide : jamais refermée, elle est rendue vide à la fermeture de son parent, en une seule
// lecture. Les attributs d'une balise restent lus par parseAttrs, à la place que donne l'arbre. Un gabarit que le lecteur
// lit avec une faute (balise, bloc, commentaire ou accolade jamais refermés, fermante ou jeton de bloc de trop…) est
// refusé là où sa lecture atteint la faute, après tout ce qui la précède, du message complet de sa sorte ; un {end} ou une
// branche de trop à la toute fin du gabarit est accepté, avec un avertissement. La sonde d'une balise raccourci écrite
// sans `/>` (willClose) cherche sa fermante dans la suite : quand elle y lit un attribut refusé, le gabarit est refusé à
// cette balise, de ce message ; quand elle compte une fermante que l'arbre ne lit pas (citée dans un <textarea>, un
// <title>, une section <![CDATA[, ou celle d'un raccourci du même nom : willClose), la balise rendue vide est signalée :
// à la fermante d'un ancêtre, l'avertissement d'une fermeture mal appariée, à sa place ; avant un {end}, une branche ou
// la fin du gabarit, un avertissement du même type (et un refus plus loin est celui de ce jeton : probeRefusal)

// l'arbre lit ce gabarit autrement que le générateur ne l'attend (une balise, un bloc ou un texte qui ne finit pas au même
// endroit) : refusé, de l'erreur fatale de lecture, à l'endroit atteint
class Mismatch extends Error {}

// un guillemet ouvert dans la valeur d'un attribut et jamais refermé : le lecteur, comme le navigateur, lit tout le reste
// du gabarit comme cette valeur. Refusé à la place du guillemet (ligne et colonne du texte lu), avec l'attribut et la
// balise ; le transpileur ramène cette place au fichier où le guillemet est écrit, partiel compris (`mjsQuote`)
function unclosedQuote(scanner: Scanner, g: { start: number, attr: number }, tag: string, dialect: boolean): Error {
  const text = scanner.str
  const vars = { quote: text[g.start], attribute: text.slice(g.attr, g.start).replace(/\s*=\s*$/, ''), tag, line: citeAt(scanner, g.start), column: g.start - text.lastIndexOf('\n', g.start - 1) }
  return Object.assign(new Error(t('parser.quote-not-closed', vars)), { mjsQuote: { vars, dialect, quote: vars.quote } })
}

// une balise ou un bloc ouvert autour de ce qui est lu : son nom (résolu pour une balise), sa ligne, l'expression d'un bloc
// (citée s'il n'est jamais refermé), le silence d'une balise refermée par la fermante d'un ancêtre (fermeture implicite du
// HTML, `<@slot>`), et où il commence dans le gabarit
interface Open { kind: 'tag' | 'block', name: string, line: number | string, expr: string, silent: boolean, start: number }

// une balise ou un bloc lu commence-t-il en `pos` ? Une pile de listes plutôt qu'un appel par niveau
function nodeOpensAt(children: ReaderNode[], pos: number): boolean {
  const stack: ReaderNode[][] = [children]
  while (stack.length > 0) {
    for (const n of stack.pop()!) {
      if (n.kind !== 'tag' && n.kind !== 'block') continue
      if (n.start === pos) return true
      if (n.kind === 'tag') stack.push(n.children)
      else for (const b of n.branches) stack.push(b.children)
    }
  }
  return false
}

// les balises raccourci (`<@x>`, `<@@x>`) écrites sans `/>` d'une liste de nœuds lus et de leurs descendants, dans
// l'ordre du texte ; une pile de listes plutôt qu'un appel par niveau
function collectBareShorthands(children: ReaderNode[]): ReaderTag[] {
  const bare: ReaderTag[] = []
  const stack: { list: ReaderNode[], k: number }[] = [{ list: children, k: 0 }]
  while (stack.length > 0) {
    const top = stack[stack.length - 1]
    if (top.k >= top.list.length) {
      stack.pop()
      continue
    }
    const n = top.list[top.k++]
    if (n.kind === 'tag') {
      if (!n.selfClosing && (n.shape === 'project' || n.shape === 'core')) bare.push(n)
      if (n.children.length > 0) stack.push({ list: n.children, k: 0 })
    }
    else if (n.kind === 'block') for (let b = n.branches.length - 1; b >= 0; b--) stack.push({ list: n.branches[b].children, k: 0 })
  }
  return bare
}

function readViaTree(text: string, tagRefs: TagRef[] | undefined, diag: ParseDiag): Node {
  // la regex passée sans parenthèses d'un gabarit (Civet) : lue comme une regex
  const dialect            = true
  const tree               = readFile(text, { template: true, dialect })
  const scanner            = new Scanner(text, diag.firstLine ?? 1, dialect, diag.hostLines ?? null, diag.lineCites ?? null)
  const warnings: string[] = []
  const lineOf             = (pos: number): number => lineAt(scanner, pos)
  const citeOf             = (pos: number): number | string => citeAt(scanner, pos)
  // un texte ou une expression écrits dans un partiel : leur ligne telle qu'un message la cite (cf. Node.cite, lue par
  // hoistFillBlocks) ; rien à chercher sans partiel versé
  const citeNode = (node: Node, pos: number): void => {
    if (scanner.cites === null) return
    const cite = citeOf(pos)
    if (typeof cite === 'string') node.cite = cite
  }
  // la première faute de lecture, refusée quand la lecture l'atteint : à la fin du contenu de la balise ou du bloc qu'elle
  // désigne (jamais refermés, ou un bloc que la fermante d'un ancêtre traverse : `atNode`), ou au jeton qu'elle désigne
  // (accolade, commentaire ou section <![CDATA[ jamais refermés, fermante ou jeton de bloc de trop, balise ouvrante sans
  // `>`…), après tout ce qui le précède
  const first = tree.diagnostics[0]
  let fault = first === undefined ? null : { pos: first.start, atNode: nodeOpensAt(tree.children, first.start) }
  // cette faute est une balise jamais terminée parce qu'un guillemet de ses attributs n'est jamais refermé : ce guillemet
  const endlessQuote = first?.quote
  const atToken = (pos: number): boolean => fault !== null && !fault.atNode && pos >= fault.pos
  // les balises et les blocs ouverts autour de ce qui est lu, du plus extérieur au plus intérieur
  const open: Open[] = []
  // le début de ce qui est lu en dernier : où la lecture s'arrête sur un refus, une pile épuisée ou un désaccord
  let reached = 0
  // la dernière fermante refusée (refuseToken) : sa position, et le nombre d'avertissements relevés avant les siens
  let closingAt     = -1
  let beforeClosing = 0
  // l'avertissement d'un jeton de bloc de trop à la toute fin du gabarit, accepté : donné après tous les autres
  let finalToken: string | null = null
  // les balises raccourci écrites sans `/>`, dans l'ordre du texte, relevées une fois, sans récursion (un gabarit
  // imbriqué sur des milliers de niveaux épuise la pile de toNodes : refusé avec son message)
  let bare: ReaderTag[] | null = null
  const bareShorthands = (): ReaderTag[] => bare ??= collectBareShorthands(tree.children)
  // les balises raccourci rendues vides dont la sonde compte une fermante plus loin (lint.syntax coupé : rien à signaler)
  const warned = new Set<ReaderTag>()
  if (diag.lint?.syntax !== false) {
    const empty = bareShorthands().filter((b) => b.empty)
    if (empty.length > 0) {
      upcomingClosings(text, empty.map((b) => ({ pos: b.openingEnd, name: resolveTagName(b.name) })), dialect).forEach((isClosed, k) => {
        if (isClosed) warned.add(empty[k])
      })
    }
  }
  // le nombre d'avertissements relevés quand chaque balise raccourci écrite sans `/>` est lue
  const warnedBefore = new Map<ReaderTag, number>()
  const root = new Node('root')
  try {
    toNodes(tree.children, root.children, text.length)
    // une faute que la lecture n'a pas atteinte : l'arbre et le générateur ne lisent pas le gabarit de la même façon
    if (fault !== null) throw new Mismatch(`faute non atteinte, ligne ${lineOf(fault.pos)}`)
    // un jeton de bloc de trop accepté à la fin : la sonde d'une balise raccourci rendue vide avant lui, qui compte sa
    // fermante plus loin, le refuse à ce jeton (balise jamais refermée)
    if (finalToken !== null) {
      const accepts = new Error()
      const reject  = probeRefusal(accepts)
      if (reject.error !== accepts) throw reject.error
      warnings.push(finalToken)
    }
    hoistFillBlocks(root)
  }
  catch (e) {
    if (stackOverflow(e)) {
      for (const line of warnings) printDiagnostic(line, diag.colorsEnabled ?? false)
      throw new Error(t('parser.nesting-too-deep', { line: citeOf(reached) }))
    }
    const reject = probeRefusal(e instanceof Mismatch ? new Error(t('parser.error-fatal', { excerpt: JSON.stringify(text.slice(reached, reached + 80)) })) : e)
    for (const line of warnings.slice(0, reject.given)) printDiagnostic(line, diag.colorsEnabled ?? false)
    throw reject.error
  }
  for (const line of warnings) printDiagnostic(line, diag.colorsEnabled ?? false)
  return root

  // l'arbre refuse le gabarit (erreur e, lue en `reached`) : rend le refus, et combien de ces avertissements le précèdent.
  // Les balises raccourci écrites sans `/>` que la lecture a atteintes sont sondées dans l'ordre du texte (willClose) :
  // la sonde de l'une d'elles qui lit un attribut refusé dans la suite refuse le gabarit à cette balise, de ce message,
  // après les avertissements relevés jusqu'à elle ; une balise rendue vide avant un {end}, une branche ou la fin du
  // gabarit, dont la sonde compte une fermante plus loin, le refuse à ce jeton (balise jamais refermée, jeton hors de son
  // bloc) quand l'arbre le refuse plus loin. Sinon, le refus de l'arbre, après tous les avertissements
  function probeRefusal(e: unknown): { given: number, error: unknown } {
    const all = bareShorthands()
    if (all.length === 0) return { given: warnings.length, error: e }
    const reject = { k: -1 }
    const closed = upcomingClosings(text, all.map((b) => ({ pos: b.openingEnd, name: resolveTagName(b.name) })), dialect, reject)
    for (let k = 0; k < all.length && warnedBefore.has(all[k]); k++) {
      const b     = all[k]
      const given = warnedBefore.get(b)!
      if (k === reject.k) {
        const probe = new Scanner(text, diag.firstLine ?? 1, dialect, diag.hostLines ?? null, diag.lineCites ?? null)
        probe.pos = b.openingEnd
        try {
          willClose(probe, resolveTagName(b.name))
        }
        catch (x) {
          return { given, error: x }
        }
      }
      // refermée plus loin selon la sonde, rendue vide par l'arbre avant un {end}, une branche ou la fin du gabarit (une
      // fermante d'ancêtre la referme avec son avertissement ; `{success}` et `{error}` sans nom y sont des valeurs)
      // une fermante de trop écrite DANS la balise, rendue vide plus loin (à un jeton de bloc) : ouverte pour le compilateur à
      // cette fermante, qui l'annonce par l'avertissement d'une fermeture mal appariée avant son refus
      const a      = b.emptiedAt ?? text.length
      const inside = b.empty && b.openingEnd <= reached && reached < a && closingAt === reached
      if (!closed[k] || !b.empty || (!inside && (a > reached || /^(?:<\/|\{(?:success|error)\})/.test(text.slice(a, a + 10))))) continue
      const name = resolveTagName(b.name)
      if (!inside && a >= text.length) return { given, error: new Error(t('parser.tag-not-closed', { name: name, line: citeOf(b.start) })) }
      const openEntry: Open = { kind: 'tag', name, line: citeOf(b.start), expr: '', silent: false, start: b.start }
      if (inside) {
        // les balises et les blocs ouverts autour de cette fermante restent : la balise raccourci prend sa place parmi eux (ouverte
        // avant ceux qui la suivent), et les avertissements de la fermante sont refaits, les siens compris
        const place = open.findIndex((o) => o.start > b.start)
        open.splice(place < 0 ? open.length : place, 0, openEntry)
        warnings.length = beforeClosing
      }
      else {
        open.length     = 0
        warnings.length = given
        open.push(openEntry)
      }
      try {
        refuseToken(inside ? reached : a)
      }
      catch (x) {
        return { given: warnings.length, error: x }
      }
    }
    return { given: warnings.length, error: e }
  }

  // le jeton fautif en p, lu comme le compilateur le lit, refusé de son message : une fermante qui ne ferme aucune balise
  // ouverte referme chaque balise ouverte (avertissement d'une fermeture mal appariée, sauf fermeture implicite), jusqu'au
  // premier bloc ouvert, jamais refermé, ou jusqu'à la racine, où elle est orpheline ; un {end} ou une branche de trop
  // (`{else}`, `{elsif …}`, `{success …}`, `{error …}`) dit la balise ouverte jamais refermée, est hors du bloc ouvert, ou
  // orphelin à la racine — à la toute fin du gabarit, accepté avec un avertissement
  function refuseToken(p: number): void {
    reached         = p
    const read      = new Scanner(text, diag.firstLine ?? 1, dialect, diag.hostLines ?? null, diag.lineCites ?? null)
    read.pos        = p
    const citedLine = currentCite(read)
    const closing   = read.rest().match(/^<\/([a-zA-Z0-9\-@]+)\s*>/)
    if (closing) {
      closingAt     = p
      beforeClosing = warnings.length
      for (let k = open.length - 1; k >= 0; k--) {
        const o = open[k]
        if (o.kind === 'block') raiseUnclosedBlock(o.name, o.expr, o.line)
        if (o.silent) continue
        const line = typedLine('syntax', t('parser.closing-mismatched', { expected: o.name, found: closing[1], openLine: o.line, closeLine: citedLine }), diag.lint)
        if (line !== null) warnings.push(line)
      }
      throw new Error(t('parser.tag-closing-orphan', { name: closing[1], line: citedLine }))
    }
    if (read.check(/<!--/)) throw new Error(t('parser.comment-not-closed', { line: citedLine }))
    if (read.check(/<!\[CDATA\[/)) throw new Error(t('parser.cdata-not-closed', { line: citedLine }))
    if (read.scan(/<(@@?[a-zA-Z0-9-]+|[a-zA-Z][a-zA-Z0-9-]*)/) !== null) {
      // une balise ouvrante jamais terminée par `>` : un guillemet de ses attributs jamais refermé est refusé à sa place ;
      // sinon ses attributs sont lus d'abord (un attribut refusé lève son message)
      const rawName = read.group(1)!
      if (endlessQuote !== undefined && p === first!.start) throw unclosedQuote(scanner, endlessQuote, rawName, dialect)
      openTag(read, rawName, tagRefs)
      throw new Error(t('parser.tag-opening-not-finished', { name: rawName, line: citedLine }))
    }
    const token = readToken(read, p, citedLine)
    const o     = open[open.length - 1]
    const vars  = { token: BRANCH_TOKENS[token] ?? '{end}', line: currentCite(read) }
    if (o === undefined && read.eos()) {
      finalToken = typedLine('syntax', t('parser.flow-token-orphan-end', vars), diag.lint)
      fault      = null
      return
    }
    if (o === undefined) throw new Error(t('parser.flow-token-orphan', vars))
    if (o.kind === 'tag' && token === 'end') throw new Error(t('parser.tag-not-closed', { name: o.name, line: o.line }))
    throw new Error(t('parser.flow-token-outside-block', { token: vars.token, block: o.kind === 'tag' ? `<${o.name}>` : `{${o.name}}`, blockLine: o.line, line: vars.line }))
  }

  // le `{…}` écrit en p, lu comme le compilateur le lit : le nom d'un jeton de bloc (`end`, `else`, `elsif`, `success`,
  // `error`), lu jusqu'à son `}` ; toute autre accolade lève son refus (jamais refermée, `{{…}` refermé d'une seule
  // accolade, `{const …}` sans nom, tête de `{await` refusée), ou l'erreur fatale de lecture (`{...x}` hors d'une balise)
  function readToken(read: Scanner, p: number, line: number | string): string {
    if (read.str.startsWith('{await', p) && !/^\{await(?:\.keep)?\s/.test(read.str.slice(p, p + 12))) refuseAwaitHead(read.str.slice(p + 1), line)
    if (read.scan(/\{(success|error|elsif)\s+/) !== null) {
      const token     = read.group(1)!
      const tokenLine = currentCite(read)
      const arg       = extractBalanced(read, '}').trim()
      if (token !== 'elsif') rejectReservedName(token, arg, tokenLine)
      return token
    }
    if (read.scan(/\{(else|end)\}/) !== null) return read.group(1)!
    if (read.scan(/\{const\s+/) !== null && read.scan(/[a-zA-Z_$][a-zA-Z0-9_$]*\s*=(?![=>])\s*/) === null) throw new Error(t('parser.const-syntax-invalid', { line: currentCite(read) }))
    const raw = read.pos === p && read.scan(/\{\{/) !== null
    if (read.pos === p) read.scan(/\{(?:await(?:\.keep)?|if|key|for)\s+|\{(?!\.\.\.)/)
    if (read.pos > p) {
      extractBalanced(read, '}')
      if (raw && read.scan(/\}/) === null) throw new Error(t('parser.html-raw-badly-closed', { line: line }))
    }
    throw new Error(t('parser.error-fatal', { excerpt: JSON.stringify(read.str.slice(p, p + 80)) }))
  }

  // les nœuds lus, dans l'ordre ; des textes qui se suivent forment un seul texte, découpé en suites de caractères. Une
  // balise raccourci rendue vide est signalée après ce qui la suit dans la liste (le contenu qu'une fermante comptée plus loin lui
  // donnerait), la dernière d'abord : l'ordre où la sonde les refermerait
  // `contentEnd` : la fin du contenu qui porte ces nœuds ; une faute au jeton est refusée avant le premier nœud qui la
  // suit, ou à la fin de ce contenu quand elle y est
  function toNodes(children: ReaderNode[], container: Node[], contentEnd: number): void {
    const deferred: string[] = []
    for (let k = 0; k < children.length; k++) {
      const n = children[k]
      if (atToken(n.start)) refuseToken(fault!.pos)
      reached = n.start
      if (n.kind === 'text') {
        let end = n.end
        while (k + 1 < children.length && children[k + 1].kind === 'text' && children[k + 1].start === end && !atToken(end)) end = children[++k].end
        texts(n.start, end, container)
      }
      else if (n.kind === 'expression') expression(n, container)
      else if (n.kind === 'block') block(n, container, contentEnd)
      else if (n.kind === 'tag') tag(n, container, deferred)
      else if (n.kind !== 'htmlComment') throw new Mismatch(`${n.kind} dans un gabarit, ligne ${lineOf(n.start)}`)
    }
    if (fault !== null && !fault.atNode && fault.pos < contentEnd) refuseToken(fault.pos)
    for (let k = deferred.length - 1; k >= 0; k--) warnings.push(deferred[k])
  }

  // une balise raccourci rendue vide dont la sonde compte une fermante plus loin : rendue vide à la fermante d'un ancêtre,
  // l'avertissement d'une fermeture mal appariée ; avant un {end}, une branche ou la fin du gabarit
  function reportEmpty(n: ReaderTag, resolvedName: string, tagLine: number | string): string | null {
    const a       = n.emptiedAt ?? text.length
    const closing = scanner.str.slice(a).match(/^<\/([a-zA-Z0-9\-@]+)\s*>/)
    if (closing) return typedLine('syntax', t('parser.closing-mismatched', { expected: resolvedName, found: closing[1], openLine: tagLine, closeLine: citeOf(a) }), diag.lint)
    const branch = /^\{(else|elsif|success|error)\b/.exec(scanner.str.slice(a, a + 10))
    const token  = a >= text.length ? '' : branch ? BRANCH_TOKENS[branch[1]] : '{end}'
    return typedLine('syntax', t('parser.shorthand-not-closed', { expected: resolvedName, openLine: tagLine, token: token, line: citeOf(a) }), diag.lint)
  }

  // désaccord de lecture dans un texte, en p : l'erreur fatale cite le gabarit à partir de là, où le compilateur bute, pas depuis
  // le début du texte (`"<@"`, pas `"\t<@"`)
  function stopAt(p: number, message: string): Mismatch {
    reached = p
    return new Mismatch(message)
  }

  // un texte, en nœuds : une suite de caractères (TEXT_RUN_RE) ; dans un <textarea> ou un
  // <title>, chaque balise et chaque commentaire écrits dedans ; dans un <svg> ou un <math>, chaque <![CDATA[…]]>
  function texts(start: number, end: number, container: Node[]): void {
    scanner.pos = start
    while (scanner.pos < end) {
      const p    = scanner.pos
      const node = new Node('text')
      if (loneText !== null && scanner.check(/<!--/)) {
        const read = scanner.scan(/<!--(?:-?>|[\s\S]*?--!?>)/)
        // la marque des lignes gardées (LINE_CARRIER_RE), seule dans son commentaire : aucun texte, comme hors d'un <textarea>
        if (read !== null && read.replace(LINE_CARRIER_RE, '') === '') {
          if (scanner.pos > end) throw stopAt(p, `texte plus long que celui de l'arbre, ligne ${lineOf(p)}`)
          continue
        }
        if (read === null || read.toLowerCase().includes('</' + loneText)) scanner.pos = p + 4
        node.content = scanner.str.slice(p, scanner.pos)
        node.line    = lineOf(p)
      }
      else if (loneText !== null && scanner.check(/<\/?[a-zA-Z@]/) && !scanner.check(new RegExp(`</${loneText}[\\s/>]`, 'i'))) {
        node.line    = lineOf(p)
        node.content = scanner.scan(/<\/?[^<>]*>?/)!
      }
      else if (foreignTag !== null && scanner.check(/<!\[CDATA\[/)) {
        const e = scanner.str.indexOf(']]>', p + 9)
        if (e === -1) throw stopAt(p, `<![CDATA[ jamais refermée, ligne ${lineOf(p)}`)
        node.content = scanner.str.slice(p, e + 3)
        node.line    = lineOf(p)
        scanner.pos  = e + 3
      }
      else {
        const txt = scanner.scan(foreignTag === null ? TEXT_RUN_RE : TEXT_RUN_FOREIGN_RE)
        if (txt === null || txt === '') throw stopAt(p, `texte lu autrement, ligne ${lineOf(p)}`)
        const writtenAt = p + txt.match(/^\s*/)![0].length
        node.content    = txt
        node.line       = lineOf(writtenAt)
        citeNode(node, writtenAt)
      }
      if (scanner.pos > end) throw stopAt(p, `texte plus long que celui de l'arbre, ligne ${lineOf(p)}`)
      container.push(node)
    }
  }

  // `{…}` et `{{…}}` (HTML calculé) : l'expression telle qu'écrite, rognée
  function expression(n: ReaderExpression, container: Node[]): void {
    const opens     = n.raw ? 2 : 1
    const startLine = lineOf(n.start + opens)
    const written   = scanner.str.slice(n.start + opens, n.end - opens)
    const content   = withoutLineCarriers(written)
    if (!n.raw && /^\/(?:if|for|each|await|key)$/.test(content)) throw new Error(t('parser.closing-block-slash', { written: `{${content}}`, line: citeOf(n.start) }))
    if (!n.raw && written.startsWith('await')) refuseAwaitHead(written, citeOf(n.start + opens))
    const node = new Node('expr')
    node.expr = content.trim()
    if (!n.raw && /^else\s*if\b/.test(node.expr)) throw new Error(t('parser.else-if-not-supported', { expr: node.expr, line: citeOf(n.start + opens) }))
    node._is_raw = n.raw
    node.line    = startLine
    citeNode(node, n.start + opens)
    container.push(node)
  }

  // le dedans d'une branche après son mot (`elsif $b` → `$b`)
  function afterWord(b: ReaderBranch, word: string): string {
    const head = scanner.str.slice(b.head.start, b.head.end)
    const m    = new RegExp(`^${word}\\s+`).exec(head)
    if (!m) throw new Mismatch(`branche {${head.slice(0, 20)}}, ligne ${lineOf(b.start)}`)
    return withoutLineCarriers(head.slice(m[0].length))
  }

  // le nom de la valeur d'une branche {success val} ou {error e} ; `''` sans nom
  function branchArg(b: ReaderBranch): string {
    const head = scanner.str.slice(b.head.start, b.head.end)
    const m    = /^(?:success|error)\s+/.exec(head)
    if (!m) return ''
    const arg = withoutLineCarriers(head.slice(m[0].length)).trim()
    rejectReservedName(b.kind, arg, citeOf(b.head.start + m[0].length))
    return arg
  }

  // {if}, {await}, {for}, {key}, {const} : la tête lue comme le compilateur la lit, les branches dans l'ordre écrit
  // `fin` : la fin du contenu de son parent, celle d'un bloc jamais refermé ou traversé par la fermante d'un ancêtre
  function block(n: ReaderBlock, container: Node[], end: number): void {
    const head = scanner.str.slice(n.head.start, n.head.end)
    const word = /^(if|for|await(?:\.keep)?|key|const)\s+/.exec(head)
    if (!word || word[1].replace('.keep', '') !== n.name || n.disposition !== null) throw new Mismatch(`bloc {${head.slice(0, 20)}}, ligne ${lineOf(n.start)}`)
    const startLine       = lineOf(n.head.start + word[0].length)
    const startCite       = citeOf(n.head.start + word[0].length)
    const expr            = withoutLineCarriers(head.slice(word[0].length))
    const [then, ...rest] = n.branches
    const blockEnd        = n.end > n.head.end + 1 ? n.end : end
    const branchEnd       = (k: number): number => n.branches[k + 1]?.start ?? blockEnd
    if (n.name === 'if') {
      const node = new Node('if')
      node.line = startLine
      let currentBranch: Branch = { expr: expr.trim(), children: [] }
      node.branches.push(currentBranch)
      open.push({ kind: 'block', name: 'if', line: startCite, expr: expr.trim(), silent: false, start: n.start })
      toNodes(then.children, currentBranch.children, branchEnd(0))
      rest.forEach((b, k) => {
        reached       = b.start
        currentBranch = b.kind === 'elsif' ? { expr: afterWord(b, 'elsif').trim(), children: [] } : { expr: null, children: [] }
        node.branches.push(currentBranch)
        toNodes(b.children, currentBranch.children, branchEnd(k + 1))
      })
      closeBlock(n, blockEnd)
      container.push(node)
    }
    else if (n.name === 'await') {
      const node = new Node('await')
      node.line = startLine
      if (typeof startCite === 'string') node.cite = startCite
      if (AWAIT_KEEP.test(head)) node.keep = true
      node.expr         = expr.trim()
      const writtenHead = node.expr
      const skeleton    = skeletonSettings(node)
      if (skeleton !== null) node.written = writtenHead
      refuseAwaitWithoutExpression(node, startCite)
      let currentBranch: Branch = { type: 'pending', children: [] }
      node.branches.push(currentBranch)
      open.push({ kind: 'block', name: 'await', line: startCite, expr: node.expr, silent: false, start: n.start })
      toNodes(then.children, currentBranch.children, branchEnd(0))
      rest.forEach((b, k) => {
        reached       = b.start
        currentBranch = { type: b.kind === 'error' ? 'error' : 'success', arg: branchArg(b), children: [] }
        node.branches.push(currentBranch)
        toNodes(b.children, currentBranch.children, branchEnd(k + 1))
      })
      closeBlock(n, blockEnd)
      awaitEnd(node, skeleton, startLine, startCite)
      container.push(node)
    }
    else if (n.name === 'for') {
      const node = forNode(expr.trim(), startLine, startCite)
      open.push({ kind: 'block', name: 'for', line: startCite, expr: expr.trim(), silent: false, start: n.start })
      toNodes(then.children, node.children, branchEnd(0))
      closeBlock(n, blockEnd)
      container.push(node)
    }
    else if (n.name === 'key') {
      const node = new Node('key')
      node.line = startLine
      node.expr = expr.trim()
      open.push({ kind: 'block', name: 'key', line: startCite, expr: node.expr, silent: false, start: n.start })
      toNodes(then.children, node.children, branchEnd(0))
      closeBlock(n, blockEnd)
      container.push(node)
    }
    else {
      // `{const nom = valeur}` : le nom précède le premier `=` qui n'est ni `==` ni `=>`
      const c = /^([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=(?![=>])\s*/.exec(expr)
      if (!c) throw new Error(t('parser.const-syntax-invalid', { line: startCite }))
      const node = new Node('const')
      node.line = startLine
      node.name = c[1].trim()
      node.expr = expr.slice(c[0].length).trim()
      rejectReservedName('const', node.name, startCite)
      if (node.expr === '') throw new Error(t('parser.const-expression-empty', { name: node.name, line: startCite }))
      container.push(node)
    }
  }

  // la fin du contenu d'un bloc : il n'est plus ouvert ; jamais refermé (ou traversé par la fermante d'un ancêtre),
  // refusé là, après tout son contenu
  function closeBlock(n: ReaderBlock, blockEnd: number): void {
    const o = open.pop()!
    if (fault === null || !fault.atNode || fault.pos !== n.start) return
    reached = blockEnd
    raiseUnclosedBlock(o.name, o.expr, o.line)
  }

  // une balise : ses attributs lus par parseAttrs (openTag) jusqu'à la fin que donne l'arbre ; vide (sans fermante,
  // balise raccourci ou `<@slot>` final) ou avec son contenu
  function tag(n: ReaderTag, container: Node[], deferred: string[]): void {
    if (!n.selfClosing && (n.shape === 'project' || n.shape === 'core')) warnedBefore.set(n, warnings.length)
    scanner.pos = n.start
    if (scanner.scan(/<(@@?[a-zA-Z0-9-]+|[a-zA-Z][a-zA-Z0-9-]*)/) === null || scanner.group(1) !== n.name) throw new Mismatch(`balise <${n.name}>, ligne ${lineOf(n.start)}`)
    const rawName = n.name
    const { node, tagLine, tagCite, choice, resolvedName } = openTag(scanner, rawName, tagRefs)
    const elsewhere = (): Mismatch => new Mismatch(`la balise <${rawName}> ne finit pas au même endroit, ligne ${tagLine}`)
    if (scanner.scan(/\s*\/>/) !== null) {
      if (!n.selfClosing || scanner.pos !== n.openingEnd) throw elsewhere()
      if (rawName === '@view') throw new Error(t('parser.view-self-closing-forbidden', { name: node.attrs[0]?.val ?? '', line: tagCite }))
      pushTag(container, node, choice)
      return
    }
    const lower  = node.name.toLowerCase()
    const isVoid = VOID_TAGS.includes(lower)
    if (scanner.scan(/\s*>/) === null || n.selfClosing || scanner.pos !== n.openingEnd || isVoid !== VOID_TAGS.includes(rawName.toLowerCase())) throw elsewhere()
    if (isVoid || n.empty) {
      if (n.children.length > 0) throw elsewhere()
      const signal = warned.has(n) ? reportEmpty(n, resolvedName, tagCite) : null
      if (signal !== null) deferred.push(signal)
      pushTag(container, node, choice)
      return
    }
    const enclosing  = foreignTag
    const textBefore = loneText
    if (lower === 'svg' || lower === 'math') foreignTag = lower
    else if (lower === 'foreignobject') foreignTag = null
    if (loneText === null && foreignTag === null && (lower === 'textarea' || lower === 'title')) loneText = lower
    open.push({ kind: 'tag', name: resolvedName, line: tagCite, expr: '', silent: IMPLICIT_CLOSE_TAGS.has(lower) || rawName === '@slot', start: n.start })
    try {
      toNodes(n.children, node.children, n.end)
    }
    finally {
      foreignTag = enclosing
      loneText   = textBefore
    }
    open.pop()
    // jamais refermée : refusée à la fin de son contenu, la plus profonde d'abord
    if (fault !== null && fault.atNode && fault.pos === n.start) {
      reached = n.end
      throw new Error(t('parser.tag-not-closed', { name: resolvedName, line: tagCite }))
    }
    // refermée par la fermante d'un ancêtre : l'avertissement d'une fermeture mal appariée, sauf fermeture implicite du HTML
    // (`<li>`, `<p>`…) et `<@slot>`, dont la fermante est facultative
    if (n.closedByAncestor !== null && !IMPLICIT_CLOSE_TAGS.has(lower) && rawName !== '@slot') {
      scanner.pos = n.closedByAncestor
      const m     = scanner.rest().match(/^<\/([a-zA-Z0-9\-@]+)\s*>/)
      const line  = typedLine('syntax', t('parser.closing-mismatched', { expected: resolvedName, found: m ? m[1] : '?', openLine: tagCite, closeLine: currentCite(scanner) }), diag.lint)
      if (line !== null) warnings.push(line)
    }
    pushTag(container, node, choice)
  }
}

export function parse(html: string, tagRefs?: TagRef[], receivedDiag: ParseDiag = {}): Node {
  // avec la ligne du fichier où le HTML commence (`firstLine`), les lignes blanches rognées en tête (une balise du langage
  // retirée de la première ligne y laisse la sienne) restent comptées : la première ligne lue garde celle du fichier ; un
  // texte analysé seul compte ses lignes depuis sa première ligne écrite
  const trimmedLines = receivedDiag.firstLine === undefined ? 0 : /^\s*/.exec(html)![0].split('\n').length - 1
  const diag         = trimmedLines === 0 ? receivedDiag : { ...receivedDiag, firstLine: (receivedDiag.firstLine ?? 1) + trimmedLines, hostLines: receivedDiag.hostLines?.slice(trimmedLines), lineCites: receivedDiag.lineCites?.slice(trimmedLines) }
  const firstLine    = diag.firstLine ?? 1
  const text         = expandLayoutBlocks(html.trim(), firstLine).trim()
  autoSkeleton       = diag.autoSkeleton !== false
  foreignTag         = null
  loneText           = null
  fileModels         = { dev: diag.models?.dev ?? {}, core: diag.models?.core ?? {} }
  guarded            = new Set(diag.guarded ?? [])
  guardSilent        = diag.guardSilent === true
  projectTags        = diag.projectTags ?? null
  seenLinks          = diag.links ?? null
  seenTexts          = new Map()
  return readViaTree(text, tagRefs, diag)
}
