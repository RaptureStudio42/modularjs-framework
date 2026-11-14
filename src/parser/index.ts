// parser HTML — port consolidé de la V1 Ruby, parser_html.rb
// + sous-modules (parser_html/{dom,attributes,flow,parser_utils}.rb, node.rb)
//
// Port à l'identique. Output AST identique à V1.

import { t } from '../messages/index.js'
import { SIGN, SIGN_RE, wordOf, oldWordOf, colonWriting, wordList, strayModifier, wordForm, shownName } from './mjs-words.js'
import { aliasExample } from '../effects/aliases-mjs.js'
import { unknownEffectError } from '../effects/catalog.js'
import { settingsComment } from '../effects/settings-comment.js'
import { RESERVED_SYMBOL_NAMES } from '../generator/reserved-symbols.js'
import { ouvreUneRegex, regexEnArgument, scanRegexLiteral, PORTEE_OUVRE_UNE_REGEX } from '../sigils.js'
import { typedLine, printDiagnostic, type LintToggles } from '../diagnostics.js'
import { lireFichier, type Balise as BaliseLue, type Bloc as BlocLue, type Branche as BrancheLue, type Expression as ExpressionLue, type Noeud as NoeudLu } from '../reader/index.js'

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
   *  (cf. LigneMelee) ; les lignes posées sur les nœuds restent celles du composant */
  lineCites?: Array<number | string | LigneMelee>
  /** reçoit les balises des composants du PROJET que le gabarit écrit (cf. ProjectTagSeen), pour le contrôle propUnknown du build */
  projectTags?: ProjectTagSeen[]
  /** reçoit les liens `#/…` des éléments `<a>` que le gabarit écrit (cf. LinkSeen), pour le contrôle routeUnknown du build */
  links?: LinkSeen[]
}

/** une ligne faite de morceaux de plusieurs fichiers (texte du composant après un `<@include>`, partiel versé en milieu de ligne) :
 *  son texte quand ses morceaux ont été posés, et la ligne citée de chacun à partir de son indice dans ce texte ; lue autrement
 *  depuis (réécrite par un passage d'avant le parseur), elle est citée à la ligne du composant qui la porte (`host`) */
export interface LigneMelee { host: number; texte: string; morceaux: Array<{ at: number; cite: number | string }> }

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
// (`raccourci-dev`), `<@@x>` un module de la bibliothèque CŒUR (`raccourci-coeur`,
// balise `mjs-core-x`) ; l'ancienne forme `<@mjs-x>` est une ERREUR DE MIGRATION.
// `balise-nue` : une balise au nom d'élément personnalisé écrite sans `mjs-` ni `@` (`<enfant-simple>`), laissée telle
// quelle — le bundler avertit si un composant du projet porte ce nom (jamais enregistrée, elle resterait vide)
export type TagRefKind = 'raccourci-dev' | 'raccourci-coeur' | 'raccourci-mjs-retire' | 'litteral-dev' | 'litteral-coeur' | 'balise-nue'

export interface TagRef {
  name: string
  kind: TagRefKind
  // variants — valeur LITTÉRALE d'un `layout="…"`/`template="…"` posé sur CETTE
  // balise précise (posée par ouvreBalise, après resolveTagName ET parseAttrs). Absent si
  // l'attribut est absent, dynamique (`layout={expr}`, non vérifiable au build) ou booléen.
  layoutLiteral?: string
  // module CŒUR seulement (`raccourci-coeur`, `litteral-coeur`) : ce que CETTE balise écrit. Le bundler
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
  kind: 'raccourci-dev' | 'litteral-dev'
  // les noms des attributs écrits, tels qu'écrits, et la présence d'un étalement `{...obj}`
  names: string[]
  spread: boolean
  line: number
  texte: string
  // combien de fois `texte` paraît dans le texte lu avant cette balise, et en tout
  rang: number
  total: number
  // un modèle en fichier choisi à l'exécution (`layout={$vue}`) : les modèles de la base, qui reçoivent chacun ces attributs
  modeles?: string[]
}

// un lien `href="#/…"` d'un élément `<a>`, écrit en dur, relevé pour le contrôle routeUnknown du build : sa valeur, sa ligne dans le texte
// lu, et de quoi le retrouver dans le fichier quand le HTML compilé n'en a plus les lignes (cf. ProjectTagSeen)
export interface LinkSeen {
  href: string
  line: number
  texte: string
  rang: number
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
  // `{await.keep expr}` : pendant une relecture, la branche {success} affichée reste et se met à jour sur place (cf. AWAIT_GARDE) ; posé
  // seulement quand le bloc l'écrit, par les deux lectures du gabarit
  keep?: boolean
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
  // (attributes/index.ts:198/1456/1615 : `const __k = ${keyExpr}`, `__fns`, `__f0`,
  // `__f`). Un item {for} ainsi nommé produisait `const __k = __k.id` → TDZ
  // silencieux (liste vidée, erreur avalée par _mjs_reconcileList). Réservés comme
  // __idx/__nodes/__built (même famille de temporaires internes).
  '__k', '__fns', '__f0', '__f'
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
  // (`s.replace /'/g, 'X'`, regexEnArgument) ; jamais en JavaScript, où `a /2 + b /4` divise
  dialecte: boolean
  // la ligne du composant de chaque ligne de `str` quand des partiels y sont versés (cf. ParseDiag.hostLines), lue par `lineAt`
  hostLines: number[] | null
  // la ligne telle qu'un message la cite (cf. ParseDiag.lineCites), lue par `citeAt`
  cites: Array<number | string | LigneMelee> | null

  constructor(str: string, firstLine = 1, dialecte = false, hostLines: number[] | null = null, cites: Array<number | string | LigneMelee> | null = null) {
    this.str = str
    this.pos = 0
    this.last = null
    this.firstLine = firstLine
    this.dialecte = dialecte
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
// ouvreUneRegex — DÉPLACÉE dans sigils.ts : l'heuristique (regex après un
// signe/mot-clé/début, division après une valeur) est désormais PARTAGÉE avec le lexer
// (scanInertAt + règle 3.1a) et le générateur (mapCodeSegments), qui ignoraient jusque-là
// les littéraux regex (`/§/` levait la garde « § nu », `/µTotal/` sortait réécrit). Import
// en tête de fichier ; comportement inchangé ici.

// consomme un commentaire (`//` jusqu'au saut de ligne, `/* */` jusqu'au terminateur) — le `/`
// ouvrant est DÉJÀ consommé par l'appelant. `stopChar` = le délimiteur fermant de l'expression qui
// contient le commentaire : un commentaire de LIGNE s'y arrête aussi, sans le consommer.
function avaleCommentaire(scanner: Scanner, bloc: boolean, stopChar?: string): string {
  let res = ''
  while (!scanner.eos()) {
    // La forme NATURELLE d'un attribut tient sur UNE ligne : dans `{$x // texte}`, le
    // `}` est la fin de l'EXPRESSION, jamais du commentaire. Sans cet arrêt il partait dans le
    // commentaire, l'expression n'était jamais refermée, et la garde « non fermée » levait
    // sur du code qui compilait la veille. Le délimiteur n'est PAS consommé : l'appelant le relit
    // et décrémente son compteur d'équilibrage lui-même.
    if (!bloc && stopChar !== undefined && scanner.peek(1) === stopChar) break
    const c = scanner.getch()!
    res += c
    if (!bloc && c === '\n') break
    if (bloc && c === '*' && scanner.peek(1) === '/') { res += scanner.getch()!; break }
  }
  return res
}

// consomme une regex littérale et ses drapeaux — le `/` ouvrant est DÉJÀ consommé. Une classe
// `[…]` protège le `/` (`/[/'"]/`), un `\` échappe le caractère suivant, et les accolades d'un
// quantificateur (`/a{2,3}/`) ne comptent donc plus dans l'équilibrage.
// Sœur de `scanRegexLiteral` (sigils.ts, MÊME heuristique de fond) : coexistent plutôt que
// fusionnées — celle-ci avance un `Scanner` à position mutable, l'autre rend un index sur
// une chaîne brute (lexer/générateur, qui n'ont pas de Scanner).
function avaleRegex(scanner: Scanner): string {
  let res = ''
  let classe = false
  while (!scanner.eos()) {
    const c = scanner.getch()!
    res += c
    if (c === '\\') { const suivant = scanner.getch(); if (suivant !== undefined) res += suivant; continue }
    if (c === '[') { classe = true; continue }
    if (c === ']') { classe = false; continue }
    if (c === '/' && !classe) break
  }
  const drapeaux = scanner.scan(/[a-z]*/)                 // gimsuyvd
  return res + (drapeaux ?? '')
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
  let diese = false

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
        const corps = extractBalanced(scanner, '}', settings)
        res += '${' + corps + '}'
        continue
      }
      // `"…#{…}…"` : l'interpolation est traversée d'un bloc, comme au lexeur (scanDoubleQuoteAt) — ses guillemets et ses accolades sont
      // les siens (`{"#{"}"}#{$x}"}`). Jamais refermée sur sa ligne, elle reste du texte, lu comme avant
      if (stringChar === '"' && ch === '#' && scanner.peek(1) === '{') {
        const avant = scanner.pos
        scanner.getch()                                        // consomme le `{`
        try {
          const corps = extractBalanced(scanner, '}', settings)
          if (!corps.includes('\n')) {
            res += '#{' + corps + '}'
            continue
          }
        }
        catch {
          // pas d'interpolation refermée : le `#` est un caractère de la chaîne
        }
        scanner.pos = avant
      }
      res += ch
      if (ch === stringChar) { inString = false; stringChar = null }
      continue
    }

    // hors chaîne, un `#` ouvre un commentaire Coffee/Civet jusqu'à la fin de la ligne (sauf `#nom`, champ
    // privé ou symbole, et `#{`) : ses guillemets n'ouvrent pas de chaîne — une apostrophe (`# c'est tout`)
    // faisait refuser la construction, « chaîne non fermée » ; ses accolades comptent comme avant. Jamais
    // dans les réglages d'un effet, où `#fff` est une couleur
    if (diese) {
      if (ch === '\n') diese = false
      if (ch === openChar) balance += 1
      else if (ch === closeChar) { balance -= 1; if (balance === 0) break }
      res += ch
      continue
    }
    if (ch === '#' && !settings && !/[a-zA-Z_{]/.test(scanner.peek(1) ?? '')) { diese = true; res += ch; continue }

    // hors chaîne : un `/` peut ouvrir un commentaire ou une regex — sans ça, un guillemet dedans
    // (`/['"]/g`, `/* isn't */`) ouvrait une chaîne FANTÔME qui ne se refermait jamais et avalait
    // tout le document (panne muette avant la garde, faux refus après elle)
    if (ch === '/') {
      const suivant = scanner.peek(1)
      if (suivant === '/' || suivant === '*') { res += ch + avaleCommentaire(scanner, suivant === '*', closeChar); continue }
      // en Civet et en CoffeeScript, une regex passée sans parenthèses (`s.replace /'/g, 'X'`) en est une aussi, si elle se referme sur sa ligne
      const barre = scanner.pos - 1
      if (!settings && (ouvreUneRegex(res) || (scanner.dialecte && regexEnArgument(scanner.str, barre) && scanRegexLiteral(scanner.str, barre) !== -1))) { res += ch + avaleRegex(scanner); continue }
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
  if (inString) throw new Error(t('parser.chaine-non-fermee', { ligne: citeAt(scanner, startPos), quote: stringChar ?? '', extrait: apercuExpr(res) }))
  if (balance !== 0) throw new Error(t('parser.delimiteur-non-ferme', { ligne: citeAt(scanner, startPos), ouvrant: openChar, fermant: closeChar, extrait: apercuExpr(res) }))

  return sansPorteurDeLignes(res)
}

// le porteur de lignes d'un bloc ou d'un commentaire retiré (cf. LINE_CARRIER_RE) n'appartient pas au code : ôté du code lu, il
// reste compté par le lecteur, qui l'a passé (une chaîne d'interpolation qui citait une balise dans un commentaire l'affichait)
function sansPorteurDeLignes(code: string): string {
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
// construit), c'est la lecture la moins chère. À la première qui ne se referme pas, le texte est lu d'un coup par lireAccoladesALEnvers
export function lireAccolades(html: string): Map<number, { corps: string, fin: number } | null> {
  const dansLOrdre = new Map<number, { corps: string, fin: number } | null>()
  const lecteur    = new Scanner(html)
  for (let at = html.indexOf('{'); at !== -1; at = html.indexOf('{', lecteur.pos)) {
    lecteur.pos = at + 1
    try {
      dansLOrdre.set(at, { corps: extractBalanced(lecteur, '}'), fin: lecteur.pos })
    }
    catch {
      return lireAccoladesALEnvers(html)
    }
  }
  return dansLOrdre
}

// chaque accolade du texte, celles qui sont dans une autre comprises, lue comme extractBalanced la lirait seule (closeChar `}`, hors
// réglages d'effet), en temps linéaire. Une accolade jamais refermée lit jusqu'à la fin du texte : lue seule, chacune relisait tout le
// reste (temps quadratique, des secondes pour quelques milliers). Ici les accolades sont lues de la dernière à la première, et une lecture
// s'arrête dès qu'elle arrive là où une lecture déjà faite est passée dans le même état : elle en reprend la suite.
// - La suite connue d'une position du texte, lue hors chaîne et hors commentaire : la position de la `}` qui fait redescendre d'un niveau
//   (`chute`), dans un commentaire `#` ou non, ou jamais (-1). Elle vaut quel que soit le niveau de la lecture qui y arrive.
// - Une seule décision dépend de l'endroit où la lecture a commencé : le `/` qui suit la `)` d'une condition (`if (…) /x/`, sigils.ts,
//   apresCondition) ouvre une regex seulement si la lecture a commencé avant la `(`. Une suite qui a vu une telle décision ne vaut que
//   pour une lecture ouverte après cette `(` (`seuil`) ; une autre lecture relit ce texte elle-même.
// - Chaînes, commentaires `/* */` et `//`, regex : sautés d'un bloc par des tables lues une fois, de droite à gauche ; les `${…}` et
//   `#{…}` d'une chaîne reprennent la lecture de leur accolade, déjà faite ; la fin d'une chaîne reprise à l'un d'eux est retenue.
// - Commentaire `#` : ses accolades comptent, rien d'autre n'y est lu ; la `}` qui fait redescendre d'un niveau se lit sur le solde des
//   accolades, sans relire la ligne.
// tests/accolades-lecture-a-l-envers-identique.test.ts compare chaque accolade à la lecture d'extractBalanced
export function lireAccoladesALEnvers(html: string): Map<number, { corps: string, fin: number } | null> {
  const n = html.length
  // fin d'un commentaire `/* */` dont l'étoile est au plus tôt en i : le premier `*/` à partir de i, ou -1
  const etoileBarre = new Int32Array(n + 2).fill(-1)
  // fin d'un commentaire `//` lu à partir de i : la première `}` (laissée à l'expression) ou le premier saut de ligne (compris)
  const finLigne    = new Int32Array(n + 2).fill(n)
  const sautDeLigne = new Int32Array(n + 2).fill(n)
  // le corps d'une regex lu à partir de i, hors d'une classe `[…]` ou dedans : position qui suit sa barre fermante, ou n
  const regexHors   = new Int32Array(n + 2).fill(n)
  const regexDans   = new Int32Array(n + 2).fill(n)
  // fin des lettres minuscules qui commencent en i (les drapeaux d'une regex)
  const lettres     = new Int32Array(n + 2).fill(n)
  // prochain évènement d'une chaîne lue à partir de i, échappements sautés : son guillemet, `${` (gabarit), `#{` (guillemets doubles), ou n
  const evtSimple   = new Int32Array(n + 2).fill(n)
  const evtDouble   = new Int32Array(n + 2).fill(n)
  const evtGabarit  = new Int32Array(n + 2).fill(n)
  for (let i = n - 1; i >= 0; i--) {
    const c    = html[i]
    const saut = Math.min(i + 2, n)
    etoileBarre[i] = c === '*' && html[i + 1] === '/' ? i : etoileBarre[i + 1]
    finLigne[i]    = c === '}' || c === '\n' ? i : finLigne[i + 1]
    sautDeLigne[i] = c === '\n' ? i : sautDeLigne[i + 1]
    lettres[i]     = c >= 'a' && c <= 'z' ? lettres[i + 1] : i
    if (c === '\\') {
      regexHors[i]  = regexHors[saut]
      regexDans[i]  = regexDans[saut]
      evtSimple[i]  = evtSimple[saut]
      evtDouble[i]  = evtDouble[saut]
      evtGabarit[i] = evtGabarit[saut]
      continue
    }
    regexHors[i]  = c === '/' ? i + 1 : c === '[' ? regexDans[i + 1] : regexHors[i + 1]
    regexDans[i]  = c === ']' ? regexHors[i + 1] : regexDans[i + 1]
    evtSimple[i]  = c === '\'' ? i : evtSimple[i + 1]
    evtDouble[i]  = c === '"' || (c === '#' && html[i + 1] === '{') ? i : evtDouble[i + 1]
    evtGabarit[i] = c === '`' || (c === '$' && html[i + 1] === '{') ? i : evtGabarit[i + 1]
  }
  // solde des accolades avant i (`{` +1, `}` -1), et premier j > i où il vaut un de moins : la `}` en j - 1 referme le niveau ouvert en i
  const solde  = new Int32Array(n + 1)
  for (let i = 0; i < n; i++) solde[i + 1] = solde[i] + (html[i] === '{' ? 1 : html[i] === '}' ? -1 : 0)
  const baisse  = new Int32Array(n + 1)
  const dernier = new Int32Array(2 * n + 3).fill(-1)
  for (let i = n; i >= 0; i--) {
    baisse[i] = dernier[solde[i] + n]
    dernier[solde[i] + n + 1] = i
  }
  // la suite connue de chaque position (-2 : inconnue), la fin retenue d'une chaîne reprise à un évènement (-2 : inconnue)
  const chute      = new Int32Array(n + 1).fill(-2)
  const chuteDiese = new Uint8Array(n + 1)
  const seuil      = new Int32Array(n + 1)
  const finChaine  = new Int32Array(n + 1).fill(-2)
  const evts       = new Int32Array(n + 1)
  // positions en attente de leur suite, de la plus ancienne à la plus récente, avec leur niveau ; -1 : un seuil vu depuis (sa valeur)
  const attente = new Int32Array(2 * n + 4)
  const niveaux = new Int32Array(2 * n + 4)
  let haut = 0

  const seuiller = (s: number): void => {
    if (s < 0) return
    if (haut > 0 && attente[haut - 1] === -1) niveaux[haut - 1] = Math.max(niveaux[haut - 1], s)
    else {
      attente[haut] = -1
      niveaux[haut] = s
      haut++
    }
  }
  // les positions en attente au niveau `niveau` (toutes pour -1) reçoivent leur suite, et les seuils vus depuis chacune
  const resoudre = (niveau: number, f: number, diese: number): void => {
    let s = -1
    while (haut > 0) {
      const p = attente[haut - 1]
      if (p === -1) s = Math.max(s, niveaux[haut - 1])
      else if (niveau !== -1 && niveaux[haut - 1] !== niveau) break
      else {
        chute[p]      = f
        chuteDiese[p] = diese
        seuil[p]      = s
      }
      haut--
    }
    seuiller(s)
  }
  // la `(` de la condition dont la `)` précède le `/` en p (blancs sautés), lue comme apresCondition ; introuvable, la lecture elle-même
  const ouvrante = (p: number, debut: number): number => {
    let j = p
    while (j > 0 && /\s/.test(html[j - 1])) j--
    let profondeur = 0
    for (let k = j - 1; k >= Math.max(0, j - PORTEE_OUVRE_UNE_REGEX); k--) {
      if (html[k] === ')') profondeur++
      else if (html[k] === '(' && --profondeur === 0) return k
    }
    return debut
  }
  // une chaîne lue à partir de `depuis` : la position qui suit son guillemet fermant, -1 si elle ne se ferme pas
  const chaine = (depuis: number, guillemet: string): number => {
    const evt = guillemet === '\'' ? evtSimple : guillemet === '"' ? evtDouble : evtGabarit
    let x   = evt[depuis]
    let vus = 0
    let fin = -1
    for (;;) {
      if (x >= n) break
      if (html[x] === guillemet) {
        fin = x + 1
        break
      }
      if (finChaine[x] !== -2) {
        fin = finChaine[x]
        break
      }
      evts[vus++] = x
      // la lecture de l'accolade en x + 1, déjà faite (elle suit le début de la lecture en cours)
      const f = chute[x + 2]
      if (guillemet === '`') {
        if (f === -1) break
        x = evt[f + 1]
      }
      // `#{…}` refermé sur sa ligne : traversé d'un bloc ; sinon le `#` est un caractère de la chaîne
      else x = f !== -1 && sautDeLigne[x + 2] >= f ? evt[f + 1] : evt[x + 1]
    }
    for (let i = 0; i < vus; i++) finChaine[evts[i]] = fin
    return fin
  }
  // les suites connues enchaînées, par sauts doublés : après une suite connue (sa `}` hors d'un commentaire `#`), la lecture reprend juste
  // après elle ; `sauts[j - 1][q]` est la position atteinte après 2^j suites montées depuis q (-2 : pas encore établie), `seuilsSaut` le
  // plus haut seuil traversé. Tables posées à la demande, seulement pour une lecture qui a des niveaux à redescendre sans position en attente
  // (beaucoup d'accolades comptées dans un commentaire `#`) ; seul un saut établi est retenu : une suite connue plus tard allonge la chaîne
  const sauts: Int32Array[]      = []
  const seuilsSaut: Int32Array[] = []
  const seuilDuSaut = (j: number, q: number): number => j === 0 ? seuil[q] : seuilsSaut[j - 1][q]
  const saut = (j: number, q: number): number => {
    if (j === 0) return chute[q] >= 0 && chuteDiese[q] === 0 ? chute[q] + 1 : -1
    while (sauts.length < j) {
      sauts.push(new Int32Array(n + 1).fill(-2))
      seuilsSaut.push(new Int32Array(n + 1))
    }
    const t = sauts[j - 1]
    if (t[q] !== -2) return t[q]
    const m = saut(j - 1, q)
    if (m === -1) return -1
    const r = saut(j - 1, m)
    if (r === -1) return -1
    t[q] = r
    seuilsSaut[j - 1][q] = Math.max(seuilDuSaut(j - 1, q), seuilDuSaut(j - 1, m))
    return r
  }
  // de la position q, au plus `k` suites montées, chacune valable pour une lecture ouverte en `debut` : la position atteinte et le nombre
  // de suites montées ; les seuils traversés rejoignent la lecture
  let montees = 0
  const monter = (q: number, k: number, debut: number): number => {
    let s = -1
    montees = 0
    for (let j = 31 - Math.clz32(k); j >= 0; j--) {
      if (montees + (1 << j) > k) continue
      const r = saut(j, q)
      if (r === -1 || !(debut > seuilDuSaut(j, q))) continue
      s = Math.max(s, seuilDuSaut(j, q))
      q = r
      montees += 1 << j
    }
    seuiller(s)
    return q
  }
  // la lecture de l'accolade en `debut` : la position de sa `}` fermante, -1 si elle ne se referme jamais
  const lire = (debut: number): number => {
    haut = 0
    let p      = debut + 1
    let niveau = 1
    let diese  = false
    const echec = (): number => {
      resoudre(-1, -1, 0)
      return -1
    }
    for (;;) {
      if (diese) {
        // commentaire `#` jusqu'au saut de ligne compris : ses accolades comptent, rien d'autre n'y est lu
        const eol = sautDeLigne[p]
        let depuis = p
        for (let j = baisse[depuis]; j !== -1 && j <= eol; j = baisse[depuis]) {
          resoudre(niveau, j - 1, 1)
          if (--niveau === 0) return j - 1
          depuis = j
        }
        if (eol >= n) return echec()
        niveau += solde[eol + 1] - solde[depuis]
        p     = eol + 1
        diese = false
        continue
      }
      // chaque position lue est inscrite, la fin du texte comprise : la lecture d'une accolade (sa première position) sert aux `${…}` et
      // `#{…}` qui la reprennent
      const suite = chute[p]
      if (suite === -2) {
        attente[haut] = p
        niveaux[haut] = niveau
        haut++
      }
      // une lecture déjà faite est passée ici dans le même état : sa suite, si elle vaut pour une lecture ouverte en `debut`
      else if (debut > seuil[p]) {
        // les niveaux au-dessus de la dernière position en attente redescendent sans rien donner à personne : montés d'un coup le long
        // des suites connues (une lecture qui a compté beaucoup d'accolades dans un commentaire `#`)
        const libres = niveau - niveaux[attente[haut - 1] === -1 ? haut - 2 : haut - 1]
        if (libres > 1) {
          const q = monter(p, libres, debut)
          if (montees > 0) {
            niveau -= montees
            p = q
            continue
          }
        }
        seuiller(seuil[p])
        if (suite === -1) return echec()
        const dansDiese = chuteDiese[p]
        resoudre(niveau, suite, dansDiese)
        if (--niveau === 0) return suite
        p     = suite + 1
        diese = dansDiese === 1
        continue
      }
      if (p >= n) return echec()
      const c = html[p]
      if (c === '#' && !/[a-zA-Z_{]/.test(html[p + 1] ?? '')) {
        diese = true
        p++
        continue
      }
      if (c === '/') {
        const suivant = html[p + 1]
        if (suivant === '/') {
          const f = finLigne[p + 2]
          p = f < n && html[f] === '\n' ? f + 1 : f
          continue
        }
        if (suivant === '*') {
          const f = etoileBarre[p + 1]
          p = f === -1 ? n : f + 2
          continue
        }
        const regex = ouvreUneRegex(html.slice(debut + 1, p))
        // jugée sur la parenthèse d'une condition ouverte avant la lecture : une lecture ouverte avant cette `(` y lirait une regex
        if (!regex && ouvreUneRegex(html.slice(0, p))) seuiller(ouvrante(p, debut))
        p = regex ? lettres[regexHors[p + 1]] : p + 1
        continue
      }
      if (c === '\'' || c === '"' || c === '`') {
        p = chaine(p + 1, c)
        if (p === -1) return echec()
        continue
      }
      if (c === '{') niveau++
      else if (c === '}') {
        resoudre(niveau, p, 0)
        if (--niveau === 0) return p
      }
      p++
    }
  }

  const lues = new Map<number, { corps: string, fin: number } | null>()
  for (let at = html.lastIndexOf('{'); at !== -1; at = at === 0 ? -1 : html.lastIndexOf('{', at - 1)) {
    const f = lire(at)
    lues.set(at, f === -1 ? null : { corps: html.slice(at + 1, f), fin: f + 1 })
  }
  return lues
}

// aperçu du texte avalé pour le message d'erreur : une ligne, borné
function apercuExpr(res: string): string {
  const plat = res.replace(/\s+/g, ' ').trim()
  return plat.length > 60 ? `${plat.slice(0, 60)}…` : plat
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
  const debut = lo === 0 ? 0 : lineOffsets(scanner)[lo - 1] + 1
  if (!scanner.str.startsWith(cite.texte, debut) || (scanner.str[debut + cite.texte.length] ?? '\n') !== '\n') return cite.host
  let k = 0
  while (k + 1 < cite.morceaux.length && cite.morceaux[k + 1].at <= pos - debut) k++
  return cite.morceaux[k].cite
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
  if (RESERVED_SYMBOL_NAMES.has(clean)) throw new Error(t('parser.symbole-reserve-template', { ligne: line, nom: clean, kind }))
  if (!RESERVED_TEMPLATE_NAMES.includes(clean) && !RESERVED_PREFIX_RE.test(clean)) return
  const altMap: Record<string, string> = {
    'el': 'item', 'e': 'evt', 'dirty': 'flag', 'this': 'self'
  }
  const alt = altMap[clean] ?? `${clean}_`
  throw new Error(t('parser.nom-reserve', { ligne: line, bloc: kind, nom: clean, alt, listeNoms: RESERVED_TEMPLATE_NAMES.join(', ') }))
}

// la forme développée d'un bloc de modèle `{? a, b}` (cf. expandLayoutBlocks)
const LAYOUT_BLOCK_EXPR = /^\(µlayout is '[A-Za-z][\w-]*'(?: or µlayout is '[A-Za-z][\w-]*')*\)$/

// chaque jeton de branche, tel que les messages le citent : écrit hors de son bloc (`{else}` dans un `{for}`, `{success}`
// dans un `{if}`…), il est refusé (cf. refuserLeJeton, dans lireParLArbre)
const JETONS_DE_BRANCHE: Record<string, string> = { else: '{else}', elsif: '{elsif …}', success: '{success …}', error: '{error …}' }
function raiseUnclosedBlock(kind: string, expr: string, line: number | string): never {
  // un bloc de modèle se cite tel qu'écrit : `{? a, b}`, jamais `{if (µlayout is 'a' or …)}`
  if (kind === 'if' && LAYOUT_BLOCK_EXPR.test(expr)) {
    kind = '?'
    expr = [...expr.matchAll(/'([^']*)'/g)].map(m => m[1]).join(', ')
  }
  let hint = ''
  switch (kind) {
    case 'if':
      hint = t('parser.astuce-if-ternaire')
      break
    case '?':
      hint = t('parser.astuce-bloc-modele-end')
      break
    case 'for':
      hint = t('parser.astuce-for-end')
      break
    case 'await':
      hint = t('parser.astuce-await-end')
      break
    case 'key':
      hint = t('parser.astuce-key-end')
      break
  }
  throw new Error(t('parser.bloc-non-ferme', { kind, expr, ligne: line, astuce: hint }))
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
  throw new Error(t(settings ? 'effets.point-reglages' : 'effets.point-espace', { nom: name, blanc: m[1] ? ' ' : '', point: m[2], exemple: aliasExample(name.split('.')[0]), ligne: currentCite(scanner) }))
}

// un effet écrit sans réglages collés : rien à lire — sauf une parenthèse séparée de son nom par un
// blanc (`*neon (#0ff)`), refusée : ses réglages étaient perdus et versés en attributs parasites ; ni un point séparé de lui par un blanc
function detachedSettings(scanner: Scanner, name: string, transition = false): string {
  if (scanner.check(/\s+\(/)) throw new Error(t('effets.espace', { nom: name, ligne: currentCite(scanner) }))
  strayDot(scanner, name, false, transition)
  return ''
}

// les réglages d'un effet (`*nom(…)`, `@in=*nom(…)`), l'ouvrante déjà lue, sans commentaire : il se lirait comme une valeur et ferait perdre les
// réglages qui le suivent. Le message cite la ligne du commentaire
function readEffectSettings(scanner: Scanner, name: string): string {
  const from     = scanner.pos
  const settings = extractSettings(scanner)
  const found    = settingsComment(settings)
  if (found) throw new Error(t('effets.commentaire', { nom: name, ligne: citeAt(scanner, from + found.at), commentaire: found.text }))
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
  throw new Error(t('parser.mot-arobase-retire', { ecrit: value === '' ? name : `${name}=${value}`, juste: colonWriting(name, value === '' ? null : value), evenement: name.slice(1).split(/[.{]/)[0], ligne: line }))
}

// un mot de MJS suivi d'un modificateur d'événement (`:size.propagate={f}`, `@size.propagate={f}` dans l'ancienne écriture) : refusé,
// jamais lu comme l'écoute de l'événement du même nom (strayModifier, mjs-words.ts) ; le message rappelle la forme du mot et renvoie à µmount
function refuseStrayModifier(name: string, word: string, modificateur: string, written: string, line: number | string): never {
  const value = written.replace(/^\s*=\s*/, '')
  throw new Error(t('parser.mot-modificateur-evenement', { ecrit: value === '' ? name : `${name}=${value}`, mot: word, forme: wordForm(word), modificateur, ligne: line }))
}

// un nom écrit avec le signe des mots de MJS qui n'en est pas un (`:titre="x"`, habitude de Vue) : refusé, avec la liste des mots et la
// liaison de MJS d'un attribut ou d'une prop (`titre={x}`) ; `written` : ce qui suit le nom
function refuseUnknownWord(name: string, written: string, line: number | string): never {
  const value  = written.replace(/^\s*=\s*/, '')
  const nom    = name.slice(SIGN.length)
  const brut   = /^(["'])([\s\S]*)\1$/.exec(value)
  const liaison = value === '' ? nom : value.startsWith('{') ? `${nom}=${value}` : `${nom}={${brut ? brut[2] : value}}`
  throw new Error(t('parser.mot-inconnu', { ecrit: value === '' ? name : `${name}=${value}`, nom, liste: wordList(), liaison, ligne: line }))
}

function parseAttrs(scanner: Scanner, node: Node): void {
  // filet générique anti-duplication : un NOM d'attribut vu deux fois sur
  // CETTE balise → erreur. Comparaison telle quelle (casse conservée, la casse est traitée
  // ailleurs) ; `@class{cond}`/`@style.prop{cond}` incluent la condition dans le nom (construit
  // plus bas), deux conditions différentes ne collisionnent donc jamais. Complète (ne remplace
  // pas) transpiler.directive-dupliquee (preprocessHtml, transpiler/index.ts) qui ne voit que
  // SES marqueurs `@…=` reconnus — celui-ci voit la liste d'attributs déjà parsée, quelle que
  // soit la forme d'origine (y compris un attribut déjà réécrit type mjs-confirm).
  const seenAttrNames = new Set<string>()
  const checkAttrDuplicate = (name: string): void => {
    if (seenAttrNames.has(name)) throw new Error(t('parser.attribut-duplique', { attribut: name, tag: node.name, ligne: currentCite(scanner) }))
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
        throw new Error(t('parser.attribut-nu-non-supporte', { expr: expr.trim(), ligne: line, tag: node.name }))
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
      if (scanner.check(/\s*=/)) throw new Error(t('effets.egal', { nom: name.slice(1), ligne: currentCite(scanner) }))
      node.attrs.push({ type: 'static', name, val })
      continue
    }

    // une étoile et un point, sans nom d'effet entre eux (`*.net`) : l'effet manque, et ce n'est pas un attribut
    if (scanner.scan(/\*(\.[\w.-]*)/)) throw new Error(t('effets.point-sans-effet', { point: scanner.group(1), ligne: currentCite(scanner) }))

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
          const effet = scanner.group(1)!
          const written  = scanner.scan(/\(/)
          const reglages = written ? readEffectSettings(scanner, effet) : detachedSettings(scanner, effet, true)
          if (written) strayDot(scanner, effet, true, true)
          node.attrs.push({ type: 'static', name, val: `*${effet}(${reglages})` })
          if (stray) refuseStrayModifier(written, word!.word, stray, scanner.str.slice(from, scanner.pos), citeAt(scanner, from))
          if (!word && oldWordOf(name)) refuseOldWord(name, scanner.str.slice(from, scanner.pos), citeAt(scanner, from))
          continue
        }
        if (scanner.scan(/\{/)) {
          const val = extractBalanced(scanner, '}')
          node.attrs.push({ type: 'dynamic', name, expr: val.replace(LINE_CARRIER_RE, ''), ...at })
        } else if (scanner.scan(/"([^"]*)"/)) {
          node.attrs.push({ type: 'static', name, val: sansEffetEntreGuillemets(name, scanner.group(1)!.replace(LINE_CARRIER_RE, '')), ...at })
        } else if (scanner.scan(/'([^']*)'/)) {
          node.attrs.push({ type: 'static', name, val: sansEffetEntreGuillemets(name, scanner.group(1)!.replace(LINE_CARRIER_RE, '')), ...at })
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
        node.attrs.push({ type: 'boolean', name })
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
    throw new Error(t('parser.attribut-signe-inconnu', { attribut: written, signe: [...written][0], tag: node.name, ligne: currentCite(scanner) }))
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
let texteSeul: string | null = null
// `{? timer}` — un détail du HTML propre à un modèle (layout), écrit court : réécrit en
// `{if (µlayout is 'timer')}` avant tout le reste (la prop `layout`, les modèles connus, le lexer le
// voient comme écrit à la main ; les lignes ne bougent pas). Dans le bloc, un autre `{? chrono}` est
// la branche suivante (`{elsif …}`) ; `{else}`, les autres modèles ; plusieurs noms, séparés par des
// virgules ; `default` : sans layout. Un `{? …}` dans un autre bloc ({if}, {for}…) en ouvre un nouveau ;
// un bloc jamais refermé dans ce texte lève ici, à sa ligne (`firstLine` : celle du texte dans son fichier) —
// chaque fichier passe ici avant d'être recollé, la faute d'un partiel inclus est citée dans le partiel, avec son fichier
// (`cite` : la ligne du fichier telle qu'un message la cite, « 2 de _haut.mjs »)
export function expandLayoutBlocks(html: string, firstLine = 1, cite: (ligne: number) => number | string = (ligne) => ligne): string {
  if (!html.includes('{?')) return html
  const pile: Array<{ kind: string, noms?: string[], index?: number }> = []
  const re = /<!--(?:-?>|[\s\S]*?--!?>)|\{(if|for|await(?:\.keep)?|key)\s|\{end\}|\{\?([^}]*)\}/g
  let out = ''
  let i = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    if (m[0].startsWith('<!--')) continue
    if (m[1]) {
      pile.push({ kind: m[1] })
      continue
    }
    if (m[0] === '{end}') {
      pile.pop()
      continue
    }
    const noms = m[2].split(',').map(x => x.trim())
    if (noms.some(x => !/^[A-Za-z][\w-]*$/.test(x))) {
      const ligne = cite(firstLine + (html.slice(0, m.index).match(/\n/g)?.length ?? 0))
      throw new Error(t('parser.bloc-modele-nom', { ecrit: m[0], ligne }))
    }
    // entre parenthèses : la forme développée se reconnaît pour être citée telle qu'écrite (cf.
    // raiseUnclosedBlock) ; les retours à la ligne d'un `{? a,\n b}` restent dans l'expression, que le
    // parseur rogne — les lignes qui suivent ne bougent pas
    const cond  = '(' + noms.map(x => `µlayout is '${x}'`).join(' or ') + ')'
    const sauts = m[0].replace(/[^\n]/g, '')
    const suite = pile[pile.length - 1]?.kind === 'layout'
    if (!suite) pile.push({ kind: 'layout', noms, index: m.index })
    out += html.slice(i, m.index) + (suite ? `{elsif ${cond}${sauts}}` : `{if ${cond}${sauts}}`)
    i = m.index + m[0].length
  }
  // le dernier bloc resté ouvert est un bloc de modèle : cité tel qu'écrit, à sa première ouverture ; un {if} ou
  // un {for} resté ouvert, lui, est dit par le parseur
  const openBlock = pile[pile.length - 1]
  if (openBlock?.kind === 'layout') raiseUnclosedBlock('?', openBlock.noms!.join(', '), cite(firstLine + (html.slice(0, openBlock.index).match(/\n/g)?.length ?? 0)))
  return out + html.slice(i)
}

// les modèles en fichier de l'analyse en cours (cf. ParseDiag.models)
let fileModels: { dev: Record<string, string[]>, core: Record<string, string[]> } = { dev: {}, core: {} }

// les balises du projet de l'analyse en cours (cf. ParseDiag.projectTags), et les positions de chaque texte de balise dans le texte lu
let projectTags: ProjectTagSeen[] | null = null
let textesVus                            = new Map<string, number[]>()
// les liens `<a href="#/…">` de l'analyse en cours (cf. ParseDiag.links)
let liensVus: LinkSeen[] | null = null

// les positions de `texte` dans `str`, le texte lu, cherchées une fois par analyse
function positionsDe(str: string, texte: string): number[] {
  let vues = textesVus.get(texte)
  if (!vues) {
    vues = []
    for (let i = str.indexOf(texte); i !== -1; i = str.indexOf(texte, i + 1)) vues.push(i)
    textesVus.set(texte, vues)
  }
  return vues
}

// les variables typées dont un champ lié se garde de lui-même (cf. ParseDiag.guarded), et comment
let guarded     = new Set<string>()
let guardSilent = false
const GUARD_FIELDS = new Set(['input', 'textarea', 'select'])
const GUARD_BIND   = /^!(?:\.\w+)?\{\s*(\$\$?[A-Za-z_]\w*)\s*\}$/

// `{await $profil *skeleton(réglages)}` : l'attente prend la forme du contenu à venir (cf. poseSkeleton) ; rend les
// réglages (`''` sans réglages), null sans *skeleton
function skeletonDe(node: Node): string | null {
  const sk = /^([\s\S]*?)\s+\*skeleton(?:\(([\s\S]*)\))?$/.exec(node.expr ?? '')
  if (sk) node.expr = sk[1].trim()
  return sk ? sk[2] ?? '' : null
}

// `{await.keep expr}` : l'option s'écrit sur le mot du bloc, hors de l'expression — aucune expression ne change de sens (un mot écrit
// après elle se lirait comme un appel ou un opérande : `{await load keep}` est `load(keep)`), et `{await.keep …}` ne se construisait pas
// avant (bloc inconnu, ses branches orphelines). Lue telle quelle par l'arbre (src/reader)
const AWAIT_GARDE = /^\{?await\.keep\s/

// la tête d'un `{await` qui n'ouvre pas de bloc : une option inconnue sur le mot du bloc (`{await.kep …}`, `{await.KEEP …}` : la seule est
// `keep`) ou le bloc écrit sans expression (`{await}`, `{await.keep}`), refusés avec leur message ; l'accolade se lisait sinon comme un texte
// (`await Promise.kep(…)`), et les branches qui la suivent comme des jetons orphelins. `debut` : ce qui suit l'accolade ouvrante
function refuseTeteAwait(debut: string, ligne: number | string): void {
  const option = /^await\.([^\s}]*)/.exec(debut)
  if (option && option[1] !== 'keep') throw new Error(t('parser.await-option-inconnue', { mot: option[1], ligne }))
  const seul = /^(await(?:\.keep)?)\s*(?:\}|$)/.exec(debut)
  if (seul) throw new Error(t('parser.await-sans-expression', { ecrit: seul[1], exemple: `${seul[1]} charger($id)`, ligne }))
}

// l'expression d'un {await} lue, son squelette retiré : vide, ou oubliée devant `*skeleton` (`{await *skeleton}` se compilait en silence en
// une fonction, `a => a*skeleton`), elle est refusée avec son message. `*skeleton` finit la tête : une expression écrite après lui et ses
// réglages (`{await *skeleton $p}`) passe devant lui dans l'exemple (`{await $p *skeleton}`)
function refuseAwaitSansExpression(node: Node, ligne: number | string): void {
  const expr = node.expr ?? ''
  if (expr !== '' && !/^\*skeleton(?![\w$-])/.test(expr)) return
  const mot       = node.keep ? 'await.keep' : 'await'
  const squelette = expr.slice(0, finSkeleton(expr))
  const apres     = expr.slice(squelette.length).trim()
  const exemple   = `${mot} ${apres || 'charger($id)'}${squelette ? ' ' + squelette : ''}`
  throw new Error(t('parser.await-sans-expression', { ecrit: expr === '' ? mot : `${mot} ${expr}`, exemple, ligne }))
}

// fin de `*skeleton` et de ses réglages en tête de `expr` (0 sans squelette) : parenthèses lues au niveau, chaînes sautées
function finSkeleton(expr: string): number {
  if (!expr.startsWith('*skeleton')) return 0
  let i = '*skeleton'.length
  if (expr[i] !== '(') return i
  let profondeur = 0
  while (i < expr.length) {
    const c = expr[i]
    if (c === '"' || c === "'" || c === '`') {
      const fin = expr.indexOf(c, i + 1)
      i = fin < 0 ? expr.length : fin + 1
      continue
    }
    if (c === '(') profondeur++
    else if (c === ')' && --profondeur === 0) return i + 1
    i++
  }
  return i
}

// le squelette d'un {await} lu en entier : celui qui est écrit ; sans branche d'attente écrite, celui de {success},
// d'office — jamais en SVG ni en MathML. `startCite` : sa ligne telle que ses messages la citent (partiel compris, cf. citeAt)
function finAwait(node: Node, skeleton: string | null, startLine: number, startCite: number | string): void {
  if (skeleton !== null) {
    if (foreignTag) throw new Error(t('parser.squelette-svg', { balise: foreignTag, ligne: startCite }))
    poseSkeleton(node, skeleton, startLine, startCite)
  }
  else if (autoSkeleton && !foreignTag && node.branches.some(b => b.type === 'success') && !node.branches[0].children.some(c => c.type !== 'text' || (c.content ?? '').trim() !== '')) poseSkeleton(node, '', startLine, startCite)
}

// la tête d'un {for} lue : `item in liste`, `index, item in liste`, `… by champ` ; refusée avec son message, qui cite `startCite`
// (partiel compris, cf. citeAt)
function noeudFor(expr: string, startLine: number, startCite: number | string): Node {
  // µ admis dans la classe de caractères (au même titre que $) : un item/index
  // ainsi nommé matche la syntaxe et passe par rejectReservedName ci-dessous, plutôt que de
  // tomber dans le message de syntaxe générique
  // `[\s\S]` : un parcours écrit sur plusieurs lignes (`$items.filter((i) ->⏎ i.ok)`) passe, comme un `{if}`
  const m = expr.match(/^(?:([a-zA-Z0-9_$µ]+)\s*,\s*)?([a-zA-Z0-9_$µ]+)\s+in\s+([\s\S]+?)(?:\s+by\s+([a-zA-Z0-9_$µ]+))?$/)
  if (!m) {
    // Avant ce throw, un `{for}` non reconnu était avalé SANS erreur : aucun
    // nœud poussé, et son `{end}` fermait le bloc PARENT → template mutilé
    // en silence. Cas typique : `{for x of arr}` (habitude JS).
    const hint = /\s+of\s+/.test(expr) ? t('parser.for-astuce-in-pas-of') : ''
    throw new Error(t('parser.for-syntaxe-invalide', { expr, ligne: startCite, astuceOf: hint }))
  }
  // `by` attend le nom d'un champ de l'élément : `by x.id` restait collé au parcours (« $l by x.id ») et la
  // construction échouait plus loin, sur un message de Civet sans rapport
  const byChemin = m[4] ? null : /\s+by\s+([a-zA-Z_$µ][\w$µ]*(?:\.[a-zA-Z_$µ][\w$µ]*)+)\s*$/.exec(m[3])
  if (byChemin) {
    const reste = byChemin[1].startsWith(m[2] + '.') ? byChemin[1].slice(m[2].length + 1) : ''
    throw new Error(t('parser.for-by-chemin', { expr, cle: byChemin[1], champ: /^[\w$µ]+$/.test(reste) ? reste : 'id', ligne: startCite }))
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
    throw new Error(t('parser.for-item-index-homonyme', { item: node.item, index: node.index, ligne: startCite }))
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
  const [base, ...suite] = name.split('.')
  return base + suite.filter(m => m === 'global' || m === 'shared').map(m => '.' + m).join('')
}

// une transition entre guillemets (`:in="*fly(up)"`, `:out='*fade'`) : un effet s'écrit sans eux —
// une seule écriture, `:in=*fly(up)` (`:in.global="*fly"` donne `:in.global=*fly` : le modificateur reste) ; `name` : le nom interne (`@in`)
function sansEffetEntreGuillemets(name: string, val: string): string {
  if (/^@(?:in|out|transition)(?:\.\w+)*$/.test(name) && /^\s*\*[A-Za-z]/.test(val)) throw new Error(t('transitions.guillemets', { directive: shownName(transitionDirective(name)), effet: val.trim() }))
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
  const pleins = nodes.filter(n => !(n.type === 'text' && !(n.content ?? '').trim()) && n.type !== 'const')
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
      const seul = pleins.length === 1 && !!parent
      out.push(skelBar(parent && SKEL_TITLE.test(parent) ? 'title' : seul && SKEL_LINES.has(parent!) ? 'lines' : seul && SKEL_WIDE.has(parent!) ? 'l' : 'm', n.line))
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
  const racine = parse(template, undefined, { firstLine })
  return skelSerialize(skeletonOf(racine.children, null)).replace(/>\s+</g, '><').trim()
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
    const barre = n.name === 'i' && n.attrs.length === 1 && n.attrs[0].name === 'mjs-skel' ? SKEL_KINDS.indexOf(n.attrs[0].val ?? '') : -1
    if (barre >= 0) {
      parts.push(String(barre + 1))
      continue
    }
    const image = n.name === 'img' && n.attrs[n.attrs.length - 1]?.name === 'mjs-skel'
    let attrs   = image ? n.attrs.slice(0, -1) : n.attrs
    let tete    = n.name
    // la classe en tête, à la façon d'un sélecteur (`li.message`), quand ses noms s'y prêtent
    if (attrs[0]?.name === 'class' && attrs[0].type === 'static' && SKEL_CLASS.test(attrs[0].val ?? '')) {
      tete += '.' + attrs[0].val!.split(' ').join('.')
      attrs = attrs.slice(1)
    }
    tete += attrs.map(a => a.type === 'boolean' ? ' ' + a.name : ' ' + a.name + '="' + skelEsc(a.val ?? '') + '"').join('')
    tete  = tete.replace(/\[/g, '&#91;').replace(/\]/g, '&#93;')
    parts.push(image ? tete + '>' : SKEL_VOID.has(n.name) ? tete + '/>' : tete + '>' + skelRepeat(skelParts(n.children)) + ')')
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
export function componentSkeleton(template: string, firstLine = 1): { forme: string, attente: boolean } {
  const racine = parse(template, undefined, { firstLine })
  return { forme: skelRepeat(skelParts(skeletonOf(racine.children, null))).replace(/\)+$/, ''), attente: skelWaits(racine.children) }
}

function poseSkeleton(node: Node, settings: string, line: number, cite: number | string): void {
  const pending = node.branches.find(b => b.type === 'pending')!
  const success = node.branches.find(b => b.type === 'success')
  if (pending.children.some(c => c.type !== 'text' || (c.content ?? '').trim() !== '')) throw new Error(t('parser.squelette-attente-ecrite', { ligne: cite }))
  if (!success) throw new Error(t('parser.squelette-sans-success', { ligne: cite }))
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
// `raccourci-mjs-retire`, name = le nom SANS le préfixe `mjs-` ; l'émission
// (`mjs-<nom>`) n'a plus d'importance, le build échouera à la post-passe. Une
// balise littérale `mjs-nom`/`mjs-core-nom` (sans `@`, écrite à la main) est
// aussi enregistrée, SANS réécriture (déjà sous sa forme finale).
// Exportée : le repli d'un <@failed>, que ce parseur ne lit pas, nomme ses balises par elle (macros.ts, fallbackTags)
export function resolveTagName(rawName: string, tagRefs?: TagRef[]): string {
  if (rawName === '@view') return 'metamjs-view'
  if (rawName === '@slot') return 'slot'

  if (rawName.startsWith('@@')) {
    const nom = rawName.slice(2)
    tagRefs?.push({ name: nom, kind: 'raccourci-coeur' })
    return `mjs-core-${nom}`
  }

  if (rawName.startsWith('@')) {
    const bare = rawName.slice(1)
    if (AT_RESERVED_NAMES.includes(bare)) return rawName  // réservée échappée aux macros → intacte
    if (bare.startsWith('mjs-')) {
      const nom = bare.slice('mjs-'.length)
      tagRefs?.push({ name: nom, kind: 'raccourci-mjs-retire' })
      return `mjs-${nom}`
    }
    tagRefs?.push({ name: bare, kind: 'raccourci-dev' })
    return `mjs-${bare}`
  }

  const lower = rawName.toLowerCase()
  if (lower.startsWith('mjs-core-')) {
    tagRefs?.push({ name: rawName.slice('mjs-core-'.length), kind: 'litteral-coeur' })
  } else if (lower.startsWith('mjs-')) {
    tagRefs?.push({ name: rawName.slice('mjs-'.length), kind: 'litteral-dev' })
  }
  return rawName
}

// sonde SANS consommation : la balise raccourci ouverte va-t-elle un jour se
// refermer (comptage équilibré du même nom, profondeur initiale 1, ouvrantes <@x/<mjs-x
// vs fermantes </@x>/</mjs-x>) ? Position sauvegardée puis restaurée — rejoue le
// sous-ensemble tag-scanning d'ouvreBalise/parseAttrs sur le SCANNER RÉEL plutôt qu'un
// regex naïf sur une sous-chaîne : une valeur d'attribut piégeuse (`title="a > b"`) ne
// fausse pas le comptage, et une occurrence AUTOFERMANTE du même nom ne compte pas comme
// une ouverture en attente (net zéro). Limite assumée : une
// mention du nom dans un texte/commentaire quelconque (pas un vrai tag) peut fausser le
// comptage — pas un vrai parseur XML, jamais prétendu l'être ailleurs dans ce fichier.
function willClose(scanner: Scanner, resolvedName: string): boolean {
  const savedPos = scanner.pos
  // aucune fermante qui se résoudrait en ce nom plus loin (`</mjs-x`, `</@mjs-x`, `</@x`, `</@@x`) : le parcours
  // ne trouverait rien — sans ce pré-test, chaque raccourci nu relisait tout le reste du gabarit (temps quadratique)
  if (!formesFermantes(resolvedName).some(f => scanner.str.indexOf(f, savedPos) >= 0)) return false
  let depth = 1
  let found = false
  while (!scanner.eos()) {
    const pas = pasDeLaSonde(scanner)
    if (pas === 'abandon') break
    if (pas === 'fermante' && nomDuPas === resolvedName) {
      depth--
      if (depth === 0) {
        found = true
        break
      }
    }
    else if (pas === 'ouvrante' && nomDuPas === resolvedName) depth++
  }
  scanner.pos = savedPos
  return found
}

// les débuts de fermante écrits qui se résolvent en ce nom (`</mjs-x`, `</@mjs-x`, `</@x`, `</@@x`)
function formesFermantes(resolvedName: string): string[] {
  const formes = ['</' + resolvedName, '</@' + resolvedName]
  if (resolvedName.startsWith('mjs-')) formes.push('</@' + resolvedName.slice(4))
  if (resolvedName.startsWith('mjs-core-')) formes.push('</@@' + resolvedName.slice(9))
  return formes
}

// le nom résolu de la dernière fermante ou ouvrante lue par pasDeLaSonde
let nomDuPas = ''

// un pas de la sonde depuis la position du scanner : 'fermante', ou 'ouvrante' quand elle compte (ni auto-fermante,
// ouverture et fermeture dans le même jeton, ni balise vide), son nom résolu dans nomDuPas ; 'texte' pour le reste — un
// commentaire et une expression `{…}` ne portent aucune balise (`{$n<3 ? …}`, `<!-- <div a a> -->`) ; 'abandon' sur une
// expression mal fermée ou une balise malformée (abandon prudent, void par défaut côté appelant), ou un pas sans progrès
function pasDeLaSonde(scanner: Scanner): 'fermante' | 'ouvrante' | 'texte' | 'abandon' {
  const posBefore = scanner.pos
  if (scanner.scan(/<!--(?:-?>|[\s\S]*?--!?>)/)) return 'texte'
  if (scanner.scan(/\{/)) {
    try {
      extractBalanced(scanner, '}')
    }
    catch {
      return 'abandon'
    }
    return 'texte'
  }
  let pas: 'fermante' | 'ouvrante' | 'texte' = 'texte'
  if (scanner.scan(/<\/([a-zA-Z0-9\-@]+)\s*>/)) {
    nomDuPas = resolveTagName(scanner.group(1)!)
    pas      = 'fermante'
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
        nomDuPas = name2
        pas      = 'ouvrante'
      }
    }
  }
  else if (!scanner.scan(/[^<{]+/)) scanner.getch()
  // garde anti-boucle infinie
  return scanner.pos === posBefore ? 'abandon' : pas
}

// la réponse de willClose pour chaque balise raccourci de `departs` (la position qui suit son `>` et son nom résolu,
// dans l'ordre du texte), en un seul balayage du gabarit. Le balayage de willClose ne dépend que de la position d'où il
// part : une balise où passe le balayage en cours y entre sans relire la suite, et sa fermante est la première fermante
// de son nom qui ramène le compte de ce nom (ouvrantes moins fermantes) en dessous de ce qu'il valait juste après elle ;
// une balise que le balayage enjambe (une expression lue d'un autre départ) est sondée seule. Une balise que la sonde ne
// lit pas (attribut refusé) l'arrête, comme une balise malformée ; `refus`, quand il est donné, reçoit le premier départ
// dont willClose lèverait là (le gabarit est alors refusé à ce départ, de ce message : refusDeLaSonde), -1 sinon. Lu dans
// le dialecte du gabarit, comme willClose (une regex passée sans parenthèses en Civet ou en CoffeeScript, `f /"/`, est une
// division en JavaScript : la sonde y lirait une chaîne jamais refermée, ou y cacherait une balise)
export function fermeturesAVenir(texte: string, departs: { pos: number, nom: string }[], dialecte: boolean, refus?: { k: number }): boolean[] {
  const trouve   = departs.map(() => false)
  if (refus !== undefined) refus.k = -1
  // la dernière fermante écrite de chaque nom : le pré-test de willClose, sans relire la suite pour chaque balise
  const derniere = new Map<string, number>()
  for (const d of departs) if (!derniere.has(d.nom)) derniere.set(d.nom, Math.max(...formesFermantes(d.nom).map((f) => texte.lastIndexOf(f))))
  const scanner = new Scanner(texte, 1, dialecte)
  const compte  = new Map<string, number>()
  const attente = new Map<string, { k: number, compte: number }[]>()
  let enAttente = 0
  let actif     = false
  const arreter = (): void => {
    attente.clear()
    enAttente = 0
    actif     = false
  }
  // une sonde qui lève (attribut refusé) : willClose lève aussi, le gabarit est refusé à cette balise
  const leve = (k: number): void => {
    if (refus !== undefined && (refus.k < 0 || k < refus.k)) refus.k = k
  }
  const avancer = (): void => {
    let pas: ReturnType<typeof pasDeLaSonde> = 'abandon'
    if (!scanner.eos()) {
      try {
        pas = pasDeLaSonde(scanner)
      }
      catch {
        for (const pile of attente.values()) for (const p of pile) leve(p.k)
        pas = 'abandon'
      }
    }
    if (pas === 'abandon') return arreter()
    if (pas === 'texte' || !derniere.has(nomDuPas)) return
    const c = (compte.get(nomDuPas) ?? 0) + (pas === 'ouvrante' ? 1 : -1)
    compte.set(nomDuPas, c)
    const pile = attente.get(nomDuPas)
    if (pas === 'fermante' && pile !== undefined && pile.length > 0 && pile[pile.length - 1].compte - 1 === c) {
      trouve[pile.pop()!.k] = true
      enAttente--
    }
  }
  departs.forEach((d, k) => {
    if (derniere.get(d.nom)! < d.pos) return
    while (enAttente > 0 && actif && scanner.pos < d.pos) avancer()
    if (enAttente > 0 && actif && scanner.pos > d.pos) {
      const seul = new Scanner(texte, 1, dialecte)
      seul.pos = d.pos
      try {
        trouve[k] = willClose(seul, d.nom)
      }
      catch {
        trouve[k] = false
        leve(k)
      }
      return
    }
    // rien en attente, ou le balayage arrêté : un nouveau balayage part de cette balise
    if (enAttente === 0 || !actif) {
      arreter()
      compte.clear()
      scanner.pos = d.pos
      actif       = true
    }
    const pile = attente.get(d.nom) ?? []
    pile.push({ k, compte: compte.get(d.nom) ?? 0 })
    attente.set(d.nom, pile)
    enAttente++
  })
  while (enAttente > 0 && actif) avancer()
  return trouve
}

// une balise ouvrante dont le nom vient d'être lu (`<nom`) : nom résolu, attributs (parseAttrs), *guard d'office, références
// et modèles en fichier, premiers attributs de <@view> et de <@slot> ; le scanner s'arrête avant la fin de la balise
// (`>` ou `/>`). Appelée par la lecture par l'arbre (lireParLArbre), et par refuserLeJeton pour une balise jamais terminée
function ouvreBalise(scanner: Scanner, rawName: string, tagRefs?: TagRef[]): { node: Node & { name: string }, tagLine: number, tagCite: number | string, choix: ModelChoice | null, nomResolu: string } {
  const node = new Node('tag')
  const tagLine = currentLine(scanner)
  const tagCite = currentCite(scanner)
  node.line = tagLine
  if (typeof tagCite === 'string') node.cite = tagCite
  // le `<` de la balise (le scanner vient de lire `<` et son nom)
  const debut = scanner.pos - rawName.length - 1

  // variants — longueur AVANT resolveTagName : si une référence vient d'être
  // empilée (balise composant, pas une réservée), on lui pose la valeur littérale de
  // layout=/template= une fois les attributs connus (pose APRÈS parseAttrs, ci-dessous).
  const tagRefsLenBefore = tagRefs?.length ?? 0
  // un modèle en fichier choisi par une valeur calculée : posé plus bas, lu par pushTag
  let choix: ModelChoice | null = null
  node.name = resolveTagName(rawName, tagRefs)
  // le nom qui referme la balise (un modèle en fichier renomme `node.name` juste en dessous)
  const nomResolu = node.name

  parseAttrs(scanner, node)
  const finAttrs = scanner.pos

  // un lien `<a href="#/…">` écrit en dur ; une valeur qui calcule ou porte une entité, un étalement, un gestionnaire qui peut retenir le
  // clic : rien (cf. ParseDiag.links)
  if (liensVus && rawName.toLowerCase() === 'a') {
    const href = node.attrs.find(a => a.type === 'static' && a.name?.toLowerCase() === 'href')?.val ?? ''
    if (href.startsWith('#/') && !/[{}&]/.test(href) && !node.attrs.some(a => a.type === 'spread' || /^(?:@(?!class\{|style\.)|on)/i.test(a.name ?? ''))) {
      const texte = scanner.str.slice(debut, finAttrs)
      const vues  = positionsDe(scanner.str, texte)
      liensVus.push({ href, line: tagLine, texte, rang: vues.indexOf(debut), total: vues.length })
    }
  }

  // *guard d'office : un champ lié à une variable typée (`<input value=!{$age}>`) le reçoit comme
  // s'il était écrit — un *guard écrit garde ses réglages ; `effects.guard: false` le rend muet (la
  // frappe reste à l'abri, la valeur ramenée à la sortie, sans effet ni bulle)
  if (guarded.size > 0 && GUARD_FIELDS.has(node.name)) {
    const lien = node.attrs.find(a => a.name === 'value' && GUARD_BIND.test(a.val ?? ''))
    if (lien && guarded.has(GUARD_BIND.exec(lien.val!)![1])) {
      // la liaison se sait typée, même sous un *guard écrit : une liste à choix multiples y écrit null sans choix sous une règle de
      // liste qui l'accepte (generator/attributes)
      (lien as { typed?: boolean }).typed = true
      if (!node.attrs.some(a => a.name === '*guard')) node.attrs.push({ type: 'static', name: '*guard', val: guardSilent ? 'silent: true' : '' })
    }
  }

  // <@@select> lié à une variable typée : la balise reçoit `typed`, et le module donne à un nombre l'option qui l'écrit autrement
  // (`02` pour 2), comme une liste native ; liée à une variable libre, elle reste telle quelle
  if (guarded.size > 0 && node.name === 'mjs-core-select') {
    const lien = node.attrs.find(a => a.name === 'value' && GUARD_BIND.test(a.val ?? ''))
    if (lien && guarded.has(GUARD_BIND.exec(lien.val!)![1]) && !node.attrs.some(a => a.name === 'typed')) node.attrs.push({ type: 'static', name: 'typed', val: 'true' })
  }

  if (tagRefs && tagRefs.length > tagRefsLenBefore) {
    const ref        = tagRefs[tagRefs.length - 1]
    const layoutAttr = node.attrs.find(a => a.type === 'static' && (a.name === 'layout' || a.name === 'template'))
    if (layoutAttr) ref.layoutLiteral = layoutAttr.val
    // un modèle dans son propre fichier (`carte.compacte.mjs`) : la balise devient la sienne,
    // choisie en dur seulement (une valeur calculée ne peut pas changer de composant)
    const coeur   = ref.kind === 'raccourci-coeur' || ref.kind === 'litteral-coeur'
    const modeles = (coeur ? fileModels.core : fileModels.dev)[ref.name.toLowerCase()]
    // un module cœur : les attributs écrits sur la balise, relevés avant que le choix d'un modèle en fichier ne retire `layout` (les références de modèle ci-dessous les reprennent)
    if (coeur) {
      const exprs = attrExprs(node.attrs)
      ref.attrs = { names: node.attrs.flatMap(a => a.name ? [a.name] : []), spread: node.attrs.some(a => a.type === 'spread'), texts: attrTexts(node.attrs), ...(exprs ? { exprs } : {}) }
    }
    // une balise du projet : ses attributs écrits, relevés comme ceux d'un module cœur avant que le choix d'un modèle ne retire `layout`
    const ecrits = projectTags && !coeur ? node.attrs.flatMap(a => a.name ? [a.name] : []) : null
    if (modeles) {
      const calcule = node.attrs.find(a => (a.name === 'layout' || a.name === 'template') && (a.type === 'dynamic' || (a.type === 'static' && /[{}]/.test(a.val ?? ''))))
      // choisi par une valeur calculée (`layout={$vue}`) : le compilateur écrit le {if} — la balise
      // de chaque modèle, sinon le composant de base (cf. pushTag) ; chaque modèle entre au bundle
      if (calcule && calcule.type === 'dynamic') {
        choix = { expr: calcule.expr ?? '', attr: calcule, modeles }
        for (const x of modeles) tagRefs!.push({ ...ref, name: `${ref.name}--${x}`, layoutLiteral: undefined })
      }
      else if (calcule) throw new Error(t('parser.modele-fichier-calcule', { tag: rawName, nom: ref.name, modeles: modeles.join(', '), premier: modeles[0], ligne: tagCite }))
      if (layoutAttr && modeles.includes(layoutAttr.val ?? '')) {
        node.name         = `${node.name}--${layoutAttr.val}`
        node.attrs        = node.attrs.filter(a => a !== layoutAttr)
        ref.name          = `${ref.name}--${layoutAttr.val}`
        ref.layoutLiteral = undefined
      }
    }
    // son nom final connu (modèle écrit en dur compris), la balise du projet et son texte, pour la retrouver dans le fichier
    if (projectTags && ecrits && (ref.kind === 'raccourci-dev' || ref.kind === 'litteral-dev')) {
      const texte = scanner.str.slice(debut, finAttrs)
      const vues  = positionsDe(scanner.str, texte)
      projectTags.push({ name: ref.name, kind: ref.kind, names: ecrits, spread: node.attrs.some(a => a.type === 'spread'), line: tagLine, texte, rang: vues.indexOf(debut), total: vues.length, ...(choix ? { modeles: choix.modeles } : {}) })
    }
  }
  // balise nue au nom d'élément personnalisé : relevée APRÈS le bloc ci-dessus (ni `layout`, ni modèle, ni attributs),
  // jamais réécrite
  else if (tagRefs && rawName[0] !== '@' && rawName.includes('-')) {
    tagRefs.push({ name: rawName, kind: 'balise-nue' })
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
  return { node: node as Node & { name: string }, tagLine, tagCite, choix, nomResolu }
}

// un modèle en fichier choisi par une valeur calculée (`layout={$vue}`) : l'expression, l'attribut qui
// la porte, les modèles du composant
interface ModelChoice { expr: string, attr: Attr, modeles: string[] }

// pose une balise ; un modèle en fichier choisi par une valeur calculée devient un {if} : la balise du
// modèle dans chaque branche (sans l'attribut `layout`), le composant de base à la fin (avec, pour ses
// styles nommés et µlayout) — reposée quand la valeur change
function pushTag(container: Node[], node: Node, choix: ModelChoice | null): void {
  if (!choix) {
    container.push(node)
    return
  }
  const si = new Node('if')
  si.line  = node.line
  for (const x of choix.modeles) {
    const copie = cloneNode(node)
    copie.name  = `${node.name}--${x}`
    copie.attrs = copie.attrs.filter((a, k) => node.attrs[k] !== choix.attr)
    si.branches.push({ expr: `(${choix.expr}) is '${x}'`, children: [copie] })
  }
  si.branches.push({ expr: null, children: [node] })
  container.push(si)
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
// un `<` qui n'ouvre rien reste du texte (cf. textes, dans lireParLArbre)
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
// « un seul nom » (parser.fill-un-seul-nom) — jamais consommé ailleurs.
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
  const ligne = fillNode.cite ?? fillNode.line ?? 0
  const first = fillNode.attrs[0]

  if (!first) {
    throw new Error(t('parser.fill-sans-nom', { directive: FILL_DIRECTIVE, ligne }))
  }
  // seul `attrs[0]` était lu : un nom en trop (`<@fill x y>`) ou un attribut de
  // plus (`<@fill x class="foo">`, `<@fill x {...$rest}>`) posait quand même `slot="x"` et
  // perdait le reste SANS UN MOT.
  if (fillNode.attrs.length > 1) {
    const extrait = fillNode.attrs.map(describeFillAttr).join(' ')
    throw new Error(t('parser.fill-un-seul-nom', { directive: FILL_DIRECTIVE, ligne, extrait }))
  }
  if (first.type === 'dynamic') {
    throw new Error(t('parser.fill-nom-dynamique', { directive: FILL_DIRECTIVE, expr: first.expr ?? '', ligne }))
  }
  if (first.type !== 'boolean') {
    throw new Error(t('parser.fill-sans-nom', { directive: FILL_DIRECTIVE, ligne }))
  }

  const nom = first.name ?? ''
  stampSlot(fillNode.children, nom)
  return fillNode.children
}

// stampSlot — pose `slot=nom` sur chaque `tag` de `children` (composant `<@x>` compris — déjà
// résolu en `tag` à ce stade du pipeline). TRAVERSE {if}/{for}/{await}/{key} pour atteindre leurs
// propres `tag` (chaque branche, chaque itération de boucle). Retire le texte blanc en silence ;
// refuse texte non blanc, `expr`, bloc imbriqué et tag déjà porteur de `slot=`.
function stampSlot(children: Node[], nom: string): void {
  for (let i = 0; i < children.length; i++) {
    const node = children[i]
    const ligne = node.cite ?? node.line ?? 0

    if (node.type === 'text') {
      // un commentaire HTML `<!-- … -->` SEUL (rien d'autre autour) est du blanc au
      // même titre qu'un espace : retiré, jamais refusé « texte nu ».
      const sansCommentaires = (node.content ?? '').replace(/<!--(?:-?>|[\s\S]*?--!?>)/g, '')
      if (sansCommentaires.trim() === '') { children.splice(i, 1); i -= 1; continue }
      throw new Error(t('parser.fill-texte-nu', { directive: FILL_DIRECTIVE, nom, ligne }))
    }

    if (node.type === 'expr') {
      throw new Error(t('parser.fill-texte-nu', { directive: FILL_DIRECTIVE, nom, ligne }))
    }

    if (node.type === 'tag') {
      if (node.name === FILL_TAG_NAME) {
        throw new Error(t('parser.fill-imbrique', { directive: FILL_DIRECTIVE, nom, ligne }))
      }
      if (node.attrs.some(a => a.name === 'slot')) {
        throw new Error(t('parser.fill-slot-deja-pose', { directive: FILL_DIRECTIVE, nom, tag: node.name, ligne }))
      }
      node.attrs.push({ type: 'static', name: 'slot', val: nom })
      continue
    }

    if (node.type === 'for' || node.type === 'key') {
      stampSlot(node.children, nom)
    } else if (node.type === 'if' || node.type === 'await') {
      for (const branch of node.branches) stampSlot(branch.children, nom)
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
export function pileDebordee(e: unknown): boolean {
  return (e instanceof RangeError && /call stack/i.test(e.message))
    || (e instanceof SyntaxError && /maximum call stack size exceeded|stack overflow/i.test(e.message))
}

// ============================================================================
// Lecture par l'arbre unique
// ============================================================================
// le gabarit est lu par le lecteur unique (src/reader, option `gabarit`) ; lireParLArbre en rend au générateur l'arbre de
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
// la fin du gabarit, un avertissement du même type (et un refus plus loin est celui de ce jeton : refusDeLaSonde)

// l'arbre lit ce gabarit autrement que le générateur ne l'attend (une balise, un bloc ou un texte qui ne finit pas au même
// endroit) : refusé, de l'erreur fatale de lecture, à l'endroit atteint
class Desaccord extends Error {}

// un guillemet ouvert dans la valeur d'un attribut et jamais refermé : le lecteur, comme le navigateur, lit tout le reste
// du gabarit comme cette valeur. Refusé à la place du guillemet (ligne et colonne du texte lu), avec l'attribut et la
// balise ; le transpileur ramène cette place au fichier où le guillemet est écrit, partiel compris (`mjsGuillemet`)
function guillemetJamaisReferme(scanner: Scanner, g: { debut: number, attribut: number }, tag: string, dialecte: boolean): Error {
  const texte = scanner.str
  const vars  = { guillemet: texte[g.debut], attribut: texte.slice(g.attribut, g.debut).replace(/\s*=\s*$/, ''), tag, ligne: citeAt(scanner, g.debut), colonne: g.debut - texte.lastIndexOf('\n', g.debut - 1) }
  return Object.assign(new Error(t('parser.guillemet-non-referme', vars)), { mjsGuillemet: { vars, dialecte } })
}

// une balise ou un bloc ouvert autour de ce qui est lu : son nom (résolu pour une balise), sa ligne, l'expression d'un bloc
// (citée s'il n'est jamais refermé), le silence d'une balise refermée par la fermante d'un ancêtre (fermeture implicite du
// HTML, `<@slot>`), et où il commence dans le gabarit
interface Ouvert { sorte: 'balise' | 'bloc', nom: string, ligne: number | string, expr: string, silencieuse: boolean, debut: number }

// une balise ou un bloc lu commence-t-il en `pos` ? Une pile de listes plutôt qu'un appel par niveau
function noeudOuvrantA(enfants: NoeudLu[], pos: number): boolean {
  const pile: NoeudLu[][] = [enfants]
  while (pile.length > 0) {
    for (const n of pile.pop()!) {
      if (n.sorte !== 'balise' && n.sorte !== 'bloc') continue
      if (n.debut === pos) return true
      if (n.sorte === 'balise') pile.push(n.enfants)
      else for (const b of n.branches) pile.push(b.enfants)
    }
  }
  return false
}

// les balises raccourci (`<@x>`, `<@@x>`) écrites sans `/>` d'une liste de nœuds lus et de leurs descendants, dans
// l'ordre du texte ; une pile de listes plutôt qu'un appel par niveau
function releverRaccourcisNus(enfants: NoeudLu[]): BaliseLue[] {
  const nues: BaliseLue[] = []
  const pile: { liste: NoeudLu[], k: number }[] = [{ liste: enfants, k: 0 }]
  while (pile.length > 0) {
    const haut = pile[pile.length - 1]
    if (haut.k >= haut.liste.length) {
      pile.pop()
      continue
    }
    const n = haut.liste[haut.k++]
    if (n.sorte === 'balise') {
      if (!n.autoFermante && (n.forme === 'projet' || n.forme === 'coeur')) nues.push(n)
      if (n.enfants.length > 0) pile.push({ liste: n.enfants, k: 0 })
    }
    else if (n.sorte === 'bloc') for (let b = n.branches.length - 1; b >= 0; b--) pile.push({ liste: n.branches[b].enfants, k: 0 })
  }
  return nues
}

function lireParLArbre(texte: string, tagRefs: TagRef[] | undefined, diag: ParseDiag): Node {
  // la regex passée sans parenthèses d'un gabarit (Civet) : lue comme une regex
  const dialecte = true
  const arbre    = lireFichier(texte, { gabarit: true, dialecte })
  const scanner  = new Scanner(texte, diag.firstLine ?? 1, dialecte, diag.hostLines ?? null, diag.lineCites ?? null)
  const avertissements: string[] = []
  const ligneA = (pos: number): number => lineAt(scanner, pos)
  const citeA  = (pos: number): number | string => citeAt(scanner, pos)
  // un texte ou une expression écrits dans un partiel : leur ligne telle qu'un message la cite (cf. Node.cite, lue par
  // hoistFillBlocks) ; rien à chercher sans partiel versé
  const citerLeNoeud = (node: Node, pos: number): void => {
    if (scanner.cites === null) return
    const cite = citeA(pos)
    if (typeof cite === 'string') node.cite = cite
  }
  // la première faute de lecture, refusée quand la lecture l'atteint : à la fin du contenu de la balise ou du bloc qu'elle
  // désigne (jamais refermés, ou un bloc que la fermante d'un ancêtre traverse : `auNoeud`), ou au jeton qu'elle désigne
  // (accolade, commentaire ou section <![CDATA[ jamais refermés, fermante ou jeton de bloc de trop, balise ouvrante sans
  // `>`…), après tout ce qui le précède
  const premiere = arbre.diagnostics[0]
  let faute = premiere === undefined ? null : { pos: premiere.debut, auNoeud: noeudOuvrantA(arbre.enfants, premiere.debut) }
  // cette faute est une balise jamais terminée parce qu'un guillemet de ses attributs n'est jamais refermé : ce guillemet
  const guillemetSansFin = premiere?.guillemet
  const auJeton = (pos: number): boolean => faute !== null && !faute.auNoeud && pos >= faute.pos
  // les balises et les blocs ouverts autour de ce qui est lu, du plus extérieur au plus intérieur
  const ouverts: Ouvert[] = []
  // le début de ce qui est lu en dernier : où la lecture s'arrête sur un refus, une pile épuisée ou un désaccord
  let atteint = 0
  // la dernière fermante refusée (refuserLeJeton) : sa position, et le nombre d'avertissements relevés avant les siens
  let fermanteA     = -1
  let avantFermante = 0
  // l'avertissement d'un jeton de bloc de trop à la toute fin du gabarit, accepté : donné après tous les autres
  let jetonFinal: string | null = null
  // les balises raccourci écrites sans `/>`, dans l'ordre du texte, relevées une fois, sans récursion (un gabarit
  // imbriqué sur des milliers de niveaux épuise la pile de versNodes : refusé avec son message)
  let nues: BaliseLue[] | null = null
  const raccourcisNus = (): BaliseLue[] => nues ??= releverRaccourcisNus(arbre.enfants)
  // les balises raccourci rendues vides dont la sonde compte une fermante plus loin (lint.syntax coupé : rien à signaler)
  const averties = new Set<BaliseLue>()
  if (diag.lint?.syntax !== false) {
    const vides = raccourcisNus().filter((b) => b.vide)
    if (vides.length > 0) {
      fermeturesAVenir(texte, vides.map((b) => ({ pos: b.finOuvrante, nom: resolveTagName(b.nom) })), dialecte).forEach((refermee, k) => {
        if (refermee) averties.add(vides[k])
      })
    }
  }
  // le nombre d'avertissements relevés quand chaque balise raccourci écrite sans `/>` est lue
  const avertisAvant = new Map<BaliseLue, number>()
  const root = new Node('root')
  try {
    versNodes(arbre.enfants, root.children, texte.length)
    // une faute que la lecture n'a pas atteinte : l'arbre et le générateur ne lisent pas le gabarit de la même façon
    if (faute !== null) throw new Desaccord(`faute non atteinte, ligne ${ligneA(faute.pos)}`)
    // un jeton de bloc de trop accepté à la fin : la sonde d'une balise raccourci rendue vide avant lui, qui compte sa
    // fermante plus loin, le refuse à ce jeton (balise jamais refermée)
    if (jetonFinal !== null) {
      const accepte = new Error()
      const refus   = refusDeLaSonde(accepte)
      if (refus.erreur !== accepte) throw refus.erreur
      avertissements.push(jetonFinal)
    }
    hoistFillBlocks(root)
  }
  catch (e) {
    if (pileDebordee(e)) {
      for (const ligne of avertissements) printDiagnostic(ligne, diag.colorsEnabled ?? false)
      throw new Error(t('parser.imbrication-trop-profonde', { ligne: citeA(atteint) }))
    }
    const refus = refusDeLaSonde(e instanceof Desaccord ? new Error(t('parser.erreur-fatale', { extrait: JSON.stringify(texte.slice(atteint, atteint + 80)) })) : e)
    for (const ligne of avertissements.slice(0, refus.donnes)) printDiagnostic(ligne, diag.colorsEnabled ?? false)
    throw refus.erreur
  }
  for (const ligne of avertissements) printDiagnostic(ligne, diag.colorsEnabled ?? false)
  return root

  // l'arbre refuse le gabarit (erreur e, lue en `atteint`) : rend le refus, et combien de ces avertissements le précèdent.
  // Les balises raccourci écrites sans `/>` que la lecture a atteintes sont sondées dans l'ordre du texte (willClose) :
  // la sonde de l'une d'elles qui lit un attribut refusé dans la suite refuse le gabarit à cette balise, de ce message,
  // après les avertissements relevés jusqu'à elle ; une balise rendue vide avant un {end}, une branche ou la fin du
  // gabarit, dont la sonde compte une fermante plus loin, le refuse à ce jeton (balise jamais refermée, jeton hors de son
  // bloc) quand l'arbre le refuse plus loin. Sinon, le refus de l'arbre, après tous les avertissements
  function refusDeLaSonde(e: unknown): { donnes: number, erreur: unknown } {
    const toutes = raccourcisNus()
    if (toutes.length === 0) return { donnes: avertissements.length, erreur: e }
    const refus     = { k: -1 }
    const refermees = fermeturesAVenir(texte, toutes.map((b) => ({ pos: b.finOuvrante, nom: resolveTagName(b.nom) })), dialecte, refus)
    for (let k = 0; k < toutes.length && avertisAvant.has(toutes[k]); k++) {
      const b      = toutes[k]
      const donnes = avertisAvant.get(b)!
      if (k === refus.k) {
        const sonde = new Scanner(texte, diag.firstLine ?? 1, dialecte, diag.hostLines ?? null, diag.lineCites ?? null)
        sonde.pos = b.finOuvrante
        try {
          willClose(sonde, resolveTagName(b.nom))
        }
        catch (x) {
          return { donnes, erreur: x }
        }
      }
      // refermée plus loin selon la sonde, rendue vide par l'arbre avant un {end}, une branche ou la fin du gabarit (une
      // fermante d'ancêtre la referme avec son avertissement ; `{success}` et `{error}` sans nom y sont des valeurs)
      // une fermante de trop écrite DANS la balise, rendue vide plus loin (à un jeton de bloc) : ouverte pour le compilateur à
      // cette fermante, qui l'annonce par l'avertissement d'une fermeture mal appariée avant son refus
      const a      = b.videeA ?? texte.length
      const dedans = b.vide && b.finOuvrante <= atteint && atteint < a && fermanteA === atteint
      if (!refermees[k] || !b.vide || (!dedans && (a > atteint || /^(?:<\/|\{(?:success|error)\})/.test(texte.slice(a, a + 10))))) continue
      const nom = resolveTagName(b.nom)
      if (!dedans && a >= texte.length) return { donnes, erreur: new Error(t('parser.balise-non-fermee', { nom, ligne: citeA(b.debut) })) }
      const ouverte: Ouvert = { sorte: 'balise', nom, ligne: citeA(b.debut), expr: '', silencieuse: false, debut: b.debut }
      if (dedans) {
        // les balises et les blocs ouverts autour de cette fermante restent : la balise raccourci prend sa place parmi eux (ouverte
        // avant ceux qui la suivent), et les avertissements de la fermante sont refaits, les siens compris
        const place = ouverts.findIndex((o) => o.debut > b.debut)
        ouverts.splice(place < 0 ? ouverts.length : place, 0, ouverte)
        avertissements.length = avantFermante
      }
      else {
        ouverts.length        = 0
        avertissements.length = donnes
        ouverts.push(ouverte)
      }
      try {
        refuserLeJeton(dedans ? atteint : a)
      }
      catch (x) {
        return { donnes: avertissements.length, erreur: x }
      }
    }
    return { donnes: avertissements.length, erreur: e }
  }

  // le jeton fautif en p, lu comme le compilateur le lit, refusé de son message : une fermante qui ne ferme aucune balise
  // ouverte referme chaque balise ouverte (avertissement d'une fermeture mal appariée, sauf fermeture implicite), jusqu'au
  // premier bloc ouvert, jamais refermé, ou jusqu'à la racine, où elle est orpheline ; un {end} ou une branche de trop
  // (`{else}`, `{elsif …}`, `{success …}`, `{error …}`) dit la balise ouverte jamais refermée, est hors du bloc ouvert, ou
  // orphelin à la racine — à la toute fin du gabarit, accepté avec un avertissement
  function refuserLeJeton(p: number): void {
    atteint = p
    const lu = new Scanner(texte, diag.firstLine ?? 1, dialecte, diag.hostLines ?? null, diag.lineCites ?? null)
    lu.pos = p
    const ligne    = currentCite(lu)
    const fermante = lu.rest().match(/^<\/([a-zA-Z0-9\-@]+)\s*>/)
    if (fermante) {
      fermanteA     = p
      avantFermante = avertissements.length
      for (let k = ouverts.length - 1; k >= 0; k--) {
        const o = ouverts[k]
        if (o.sorte === 'bloc') raiseUnclosedBlock(o.nom, o.expr, o.ligne)
        if (o.silencieuse) continue
        const line = typedLine('syntax', t('parser.fermeture-mal-appariee', { attendu: o.nom, trouve: fermante[1], ligneOuverture: o.ligne, ligneFermeture: ligne }), diag.lint)
        if (line !== null) avertissements.push(line)
      }
      throw new Error(t('parser.balise-fermante-orpheline', { nom: fermante[1], ligne }))
    }
    if (lu.check(/<!--/)) throw new Error(t('parser.commentaire-non-ferme', { ligne }))
    if (lu.check(/<!\[CDATA\[/)) throw new Error(t('parser.cdata-non-fermee', { ligne }))
    if (lu.scan(/<(@@?[a-zA-Z0-9-]+|[a-zA-Z][a-zA-Z0-9-]*)/) !== null) {
      // une balise ouvrante jamais terminée par `>` : un guillemet de ses attributs jamais refermé est refusé à sa place ;
      // sinon ses attributs sont lus d'abord (un attribut refusé lève son message)
      const rawName = lu.group(1)!
      if (guillemetSansFin !== undefined && p === premiere!.debut) throw guillemetJamaisReferme(scanner, guillemetSansFin, rawName, dialecte)
      ouvreBalise(lu, rawName, tagRefs)
      throw new Error(t('parser.balise-ouvrante-non-terminee', { nom: rawName, ligne }))
    }
    const jeton = lireJeton(lu, p, ligne)
    const o     = ouverts[ouverts.length - 1]
    const vars  = { jeton: JETONS_DE_BRANCHE[jeton] ?? '{end}', ligne: currentCite(lu) }
    if (o === undefined && lu.eos()) {
      jetonFinal = typedLine('syntax', t('parser.jeton-flux-orphelin-fin', vars), diag.lint)
      faute      = null
      return
    }
    if (o === undefined) throw new Error(t('parser.jeton-flux-orphelin', vars))
    if (o.sorte === 'balise' && jeton === 'end') throw new Error(t('parser.balise-non-fermee', { nom: o.nom, ligne: o.ligne }))
    throw new Error(t('parser.jeton-flux-hors-bloc', { jeton: vars.jeton, bloc: o.sorte === 'balise' ? `<${o.nom}>` : `{${o.nom}}`, ligneBloc: o.ligne, ligne: vars.ligne }))
  }

  // le `{…}` écrit en p, lu comme le compilateur le lit : le nom d'un jeton de bloc (`end`, `else`, `elsif`, `success`,
  // `error`), lu jusqu'à son `}` ; toute autre accolade lève son refus (jamais refermée, `{{…}` refermé d'une seule
  // accolade, `{const …}` sans nom, tête de `{await` refusée), ou l'erreur fatale de lecture (`{...x}` hors d'une balise)
  function lireJeton(lu: Scanner, p: number, ligne: number | string): string {
    if (lu.str.startsWith('{await', p) && !/^\{await(?:\.keep)?\s/.test(lu.str.slice(p, p + 12))) refuseTeteAwait(lu.str.slice(p + 1), ligne)
    if (lu.scan(/\{(success|error|elsif)\s+/) !== null) {
      const jeton      = lu.group(1)!
      const ligneJeton = currentCite(lu)
      const arg        = extractBalanced(lu, '}').trim()
      if (jeton !== 'elsif') rejectReservedName(jeton, arg, ligneJeton)
      return jeton
    }
    if (lu.scan(/\{(else|end)\}/) !== null) return lu.group(1)!
    if (lu.scan(/\{const\s+/) !== null && lu.scan(/[a-zA-Z_$][a-zA-Z0-9_$]*\s*=(?![=>])\s*/) === null) throw new Error(t('parser.const-syntaxe-invalide', { ligne: currentCite(lu) }))
    const brut = lu.pos === p && lu.scan(/\{\{/) !== null
    if (lu.pos === p) lu.scan(/\{(?:await(?:\.keep)?|if|key|for)\s+|\{(?!\.\.\.)/)
    if (lu.pos > p) {
      extractBalanced(lu, '}')
      if (brut && lu.scan(/\}/) === null) throw new Error(t('parser.html-brut-mal-ferme', { ligne }))
    }
    throw new Error(t('parser.erreur-fatale', { extrait: JSON.stringify(lu.str.slice(p, p + 80)) }))
  }

  // les nœuds lus, dans l'ordre ; des textes qui se suivent forment un seul texte, découpé en suites de caractères. Une
  // balise raccourci rendue vide est signalée après ce qui la suit dans la liste (le contenu qu'une fermante comptée plus loin lui
  // donnerait), la dernière d'abord : l'ordre où la sonde les refermerait
  // `finDuContenu` : la fin du contenu qui porte ces nœuds ; une faute au jeton est refusée avant le premier nœud qui la
  // suit, ou à la fin de ce contenu quand elle y est
  function versNodes(enfants: NoeudLu[], container: Node[], finDuContenu: number): void {
    const differes: string[] = []
    for (let k = 0; k < enfants.length; k++) {
      const n = enfants[k]
      if (auJeton(n.debut)) refuserLeJeton(faute!.pos)
      atteint = n.debut
      if (n.sorte === 'texte') {
        let fin = n.fin
        while (k + 1 < enfants.length && enfants[k + 1].sorte === 'texte' && enfants[k + 1].debut === fin && !auJeton(fin)) fin = enfants[++k].fin
        textes(n.debut, fin, container)
      }
      else if (n.sorte === 'expression') expression(n, container)
      else if (n.sorte === 'bloc') bloc(n, container, finDuContenu)
      else if (n.sorte === 'balise') balise(n, container, differes)
      else if (n.sorte !== 'commentaireHtml') throw new Desaccord(`${n.sorte} dans un gabarit, ligne ${ligneA(n.debut)}`)
    }
    if (faute !== null && !faute.auNoeud && faute.pos < finDuContenu) refuserLeJeton(faute.pos)
    for (let k = differes.length - 1; k >= 0; k--) avertissements.push(differes[k])
  }

  // une balise raccourci rendue vide dont la sonde compte une fermante plus loin : rendue vide à la fermante d'un ancêtre,
  // l'avertissement d'une fermeture mal appariée ; avant un {end}, une branche ou la fin du gabarit
  function signalerVide(n: BaliseLue, nomResolu: string, tagLine: number | string): string | null {
    const a        = n.videeA ?? texte.length
    const fermante = scanner.str.slice(a).match(/^<\/([a-zA-Z0-9\-@]+)\s*>/)
    if (fermante) return typedLine('syntax', t('parser.fermeture-mal-appariee', { attendu: nomResolu, trouve: fermante[1], ligneOuverture: tagLine, ligneFermeture: citeA(a) }), diag.lint)
    const branche = /^\{(else|elsif|success|error)\b/.exec(scanner.str.slice(a, a + 10))
    const jeton   = a >= texte.length ? '' : branche ? JETONS_DE_BRANCHE[branche[1]] : '{end}'
    return typedLine('syntax', t('parser.raccourci-non-referme', { attendu: nomResolu, ligneOuverture: tagLine, jeton, ligne: citeA(a) }), diag.lint)
  }

  // désaccord de lecture dans un texte, en p : l'erreur fatale cite le gabarit à partir de là, où le compilateur bute, pas depuis
  // le début du texte (`"<@"`, pas `"\t<@"`)
  function butee(p: number, message: string): Desaccord {
    atteint = p
    return new Desaccord(message)
  }

  // un texte, en nœuds : une suite de caractères (TEXT_RUN_RE) ; dans un <textarea> ou un
  // <title>, chaque balise et chaque commentaire écrits dedans ; dans un <svg> ou un <math>, chaque <![CDATA[…]]>
  function textes(debut: number, fin: number, container: Node[]): void {
    scanner.pos = debut
    while (scanner.pos < fin) {
      const p    = scanner.pos
      const node = new Node('text')
      if (texteSeul !== null && scanner.check(/<!--/)) {
        const lu = scanner.scan(/<!--(?:-?>|[\s\S]*?--!?>)/)
        // la marque des lignes gardées (LINE_CARRIER_RE), seule dans son commentaire : aucun texte, comme hors d'un <textarea>
        if (lu !== null && lu.replace(LINE_CARRIER_RE, '') === '') {
          if (scanner.pos > fin) throw butee(p, `texte plus long que celui de l'arbre, ligne ${ligneA(p)}`)
          continue
        }
        if (lu === null || lu.toLowerCase().includes('</' + texteSeul)) scanner.pos = p + 4
        node.content = scanner.str.slice(p, scanner.pos)
        node.line    = ligneA(p)
      }
      else if (texteSeul !== null && scanner.check(/<\/?[a-zA-Z@]/) && !scanner.check(new RegExp(`</${texteSeul}[\\s/>]`, 'i'))) {
        node.line    = ligneA(p)
        node.content = scanner.scan(/<\/?[^<>]*>?/)!
      }
      else if (foreignTag !== null && scanner.check(/<!\[CDATA\[/)) {
        const e = scanner.str.indexOf(']]>', p + 9)
        if (e === -1) throw butee(p, `<![CDATA[ jamais refermée, ligne ${ligneA(p)}`)
        node.content = scanner.str.slice(p, e + 3)
        node.line    = ligneA(p)
        scanner.pos  = e + 3
      }
      else {
        const txt = scanner.scan(foreignTag === null ? TEXT_RUN_RE : TEXT_RUN_FOREIGN_RE)
        if (txt === null || txt === '') throw butee(p, `texte lu autrement, ligne ${ligneA(p)}`)
        const ecritA = p + txt.match(/^\s*/)![0].length
        node.content = txt
        node.line    = ligneA(ecritA)
        citerLeNoeud(node, ecritA)
      }
      if (scanner.pos > fin) throw butee(p, `texte plus long que celui de l'arbre, ligne ${ligneA(p)}`)
      container.push(node)
    }
  }

  // `{…}` et `{{…}}` (HTML calculé) : l'expression telle qu'écrite, rognée
  function expression(n: ExpressionLue, container: Node[]): void {
    const ouvre     = n.brut ? 2 : 1
    const startLine = ligneA(n.debut + ouvre)
    const ecrit     = scanner.str.slice(n.debut + ouvre, n.fin - ouvre)
    const content   = sansPorteurDeLignes(ecrit)
    if (!n.brut && /^\/(?:if|for|each|await|key)$/.test(content)) throw new Error(t('parser.fermeture-bloc-slash', { ecrit: `{${content}}`, ligne: citeA(n.debut) }))
    if (!n.brut && ecrit.startsWith('await')) refuseTeteAwait(ecrit, citeA(n.debut + ouvre))
    const node = new Node('expr')
    node.expr = content.trim()
    if (!n.brut && /^else\s*if\b/.test(node.expr)) throw new Error(t('parser.else-if-non-supporte', { expr: node.expr, ligne: citeA(n.debut + ouvre) }))
    node._is_raw = n.brut
    node.line    = startLine
    citerLeNoeud(node, n.debut + ouvre)
    container.push(node)
  }

  // le dedans d'une branche après son mot (`elsif $b` → `$b`)
  function apresMot(b: BrancheLue, mot: string): string {
    const tete = scanner.str.slice(b.tete.debut, b.tete.fin)
    const m    = new RegExp(`^${mot}\\s+`).exec(tete)
    if (!m) throw new Desaccord(`branche {${tete.slice(0, 20)}}, ligne ${ligneA(b.debut)}`)
    return sansPorteurDeLignes(tete.slice(m[0].length))
  }

  // le nom de la valeur d'une branche {success val} ou {error e} ; `''` sans nom
  function argDeBranche(b: BrancheLue): string {
    const tete = scanner.str.slice(b.tete.debut, b.tete.fin)
    const m    = /^(?:success|error)\s+/.exec(tete)
    if (!m) return ''
    const arg = sansPorteurDeLignes(tete.slice(m[0].length)).trim()
    rejectReservedName(b.sorte, arg, citeA(b.tete.debut + m[0].length))
    return arg
  }

  // {if}, {await}, {for}, {key}, {const} : la tête lue comme le compilateur la lit, les branches dans l'ordre écrit
  // `fin` : la fin du contenu de son parent, celle d'un bloc jamais refermé ou traversé par la fermante d'un ancêtre
  function bloc(n: BlocLue, container: Node[], fin: number): void {
    const tete = scanner.str.slice(n.tete.debut, n.tete.fin)
    const mot  = /^(if|for|await(?:\.keep)?|key|const)\s+/.exec(tete)
    if (!mot || mot[1].replace('.keep', '') !== n.nom || n.disposition !== null) throw new Desaccord(`bloc {${tete.slice(0, 20)}}, ligne ${ligneA(n.debut)}`)
    const startLine = ligneA(n.tete.debut + mot[0].length)
    const startCite = citeA(n.tete.debut + mot[0].length)
    const expr      = sansPorteurDeLignes(tete.slice(mot[0].length))
    const [alors, ...suite] = n.branches
    const finDuBloc  = n.fin > n.tete.fin + 1 ? n.fin : fin
    const finBranche = (k: number): number => n.branches[k + 1]?.debut ?? finDuBloc
    if (n.nom === 'if') {
      const node = new Node('if')
      node.line = startLine
      let currentBranch: Branch = { expr: expr.trim(), children: [] }
      node.branches.push(currentBranch)
      ouverts.push({ sorte: 'bloc', nom: 'if', ligne: startCite, expr: expr.trim(), silencieuse: false, debut: n.debut })
      versNodes(alors.enfants, currentBranch.children, finBranche(0))
      suite.forEach((b, k) => {
        atteint       = b.debut
        currentBranch = b.sorte === 'elsif' ? { expr: apresMot(b, 'elsif').trim(), children: [] } : { expr: null, children: [] }
        node.branches.push(currentBranch)
        versNodes(b.enfants, currentBranch.children, finBranche(k + 1))
      })
      refermer(n, finDuBloc)
      container.push(node)
    }
    else if (n.nom === 'await') {
      const node = new Node('await')
      node.line = startLine
      if (typeof startCite === 'string') node.cite = startCite
      if (AWAIT_GARDE.test(tete)) node.keep = true
      node.expr = expr.trim()
      const skeleton = skeletonDe(node)
      refuseAwaitSansExpression(node, startCite)
      let currentBranch: Branch = { type: 'pending', children: [] }
      node.branches.push(currentBranch)
      ouverts.push({ sorte: 'bloc', nom: 'await', ligne: startCite, expr: node.expr, silencieuse: false, debut: n.debut })
      versNodes(alors.enfants, currentBranch.children, finBranche(0))
      suite.forEach((b, k) => {
        atteint       = b.debut
        currentBranch = { type: b.sorte === 'error' ? 'error' : 'success', arg: argDeBranche(b), children: [] }
        node.branches.push(currentBranch)
        versNodes(b.enfants, currentBranch.children, finBranche(k + 1))
      })
      refermer(n, finDuBloc)
      finAwait(node, skeleton, startLine, startCite)
      container.push(node)
    }
    else if (n.nom === 'for') {
      const node = noeudFor(expr.trim(), startLine, startCite)
      ouverts.push({ sorte: 'bloc', nom: 'for', ligne: startCite, expr: expr.trim(), silencieuse: false, debut: n.debut })
      versNodes(alors.enfants, node.children, finBranche(0))
      refermer(n, finDuBloc)
      container.push(node)
    }
    else if (n.nom === 'key') {
      const node = new Node('key')
      node.line = startLine
      node.expr = expr.trim()
      ouverts.push({ sorte: 'bloc', nom: 'key', ligne: startCite, expr: node.expr, silencieuse: false, debut: n.debut })
      versNodes(alors.enfants, node.children, finBranche(0))
      refermer(n, finDuBloc)
      container.push(node)
    }
    else {
      // `{const nom = valeur}` : le nom précède le premier `=` qui n'est ni `==` ni `=>`
      const c = /^([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=(?![=>])\s*/.exec(expr)
      if (!c) throw new Error(t('parser.const-syntaxe-invalide', { ligne: startCite }))
      const node = new Node('const')
      node.line = startLine
      node.name = c[1].trim()
      node.expr = expr.slice(c[0].length).trim()
      rejectReservedName('const', node.name, startCite)
      if (node.expr === '') throw new Error(t('parser.const-expression-vide', { nom: node.name, ligne: startCite }))
      container.push(node)
    }
  }

  // la fin du contenu d'un bloc : il n'est plus ouvert ; jamais refermé (ou traversé par la fermante d'un ancêtre),
  // refusé là, après tout son contenu
  function refermer(n: BlocLue, finDuBloc: number): void {
    const o = ouverts.pop()!
    if (faute === null || !faute.auNoeud || faute.pos !== n.debut) return
    atteint = finDuBloc
    raiseUnclosedBlock(o.nom, o.expr, o.ligne)
  }

  // une balise : ses attributs lus par parseAttrs (ouvreBalise) jusqu'à la fin que donne l'arbre ; vide (sans fermante,
  // balise raccourci ou `<@slot>` final) ou avec son contenu
  function balise(n: BaliseLue, container: Node[], differes: string[]): void {
    if (!n.autoFermante && (n.forme === 'projet' || n.forme === 'coeur')) avertisAvant.set(n, avertissements.length)
    scanner.pos = n.debut
    if (scanner.scan(/<(@@?[a-zA-Z0-9-]+|[a-zA-Z][a-zA-Z0-9-]*)/) === null || scanner.group(1) !== n.nom) throw new Desaccord(`balise <${n.nom}>, ligne ${ligneA(n.debut)}`)
    const rawName = n.nom
    const { node, tagLine, tagCite, choix, nomResolu } = ouvreBalise(scanner, rawName, tagRefs)
    const ailleurs = (): Desaccord => new Desaccord(`la balise <${rawName}> ne finit pas au même endroit, ligne ${tagLine}`)
    if (scanner.scan(/\s*\/>/) !== null) {
      if (!n.autoFermante || scanner.pos !== n.finOuvrante) throw ailleurs()
      if (rawName === '@view') throw new Error(t('parser.view-auto-fermeture-interdite', { nom: node.attrs[0]?.val ?? '', ligne: tagCite }))
      pushTag(container, node, choix)
      return
    }
    const lower  = node.name.toLowerCase()
    const isVoid = VOID_TAGS.includes(lower)
    if (scanner.scan(/\s*>/) === null || n.autoFermante || scanner.pos !== n.finOuvrante || isVoid !== VOID_TAGS.includes(rawName.toLowerCase())) throw ailleurs()
    if (isVoid || n.vide) {
      if (n.enfants.length > 0) throw ailleurs()
      const signal = averties.has(n) ? signalerVide(n, nomResolu, tagCite) : null
      if (signal !== null) differes.push(signal)
      pushTag(container, node, choix)
      return
    }
    const enclosing  = foreignTag
    const texteAvant = texteSeul
    if (lower === 'svg' || lower === 'math') foreignTag = lower
    else if (lower === 'foreignobject') foreignTag = null
    if (texteSeul === null && foreignTag === null && (lower === 'textarea' || lower === 'title')) texteSeul = lower
    ouverts.push({ sorte: 'balise', nom: nomResolu, ligne: tagCite, expr: '', silencieuse: IMPLICIT_CLOSE_TAGS.has(lower) || rawName === '@slot', debut: n.debut })
    try {
      versNodes(n.enfants, node.children, n.fin)
    }
    finally {
      foreignTag = enclosing
      texteSeul  = texteAvant
    }
    ouverts.pop()
    // jamais refermée : refusée à la fin de son contenu, la plus profonde d'abord
    if (faute !== null && faute.auNoeud && faute.pos === n.debut) {
      atteint = n.fin
      throw new Error(t('parser.balise-non-fermee', { nom: nomResolu, ligne: tagCite }))
    }
    // refermée par la fermante d'un ancêtre : l'avertissement d'une fermeture mal appariée, sauf fermeture implicite du HTML
    // (`<li>`, `<p>`…) et `<@slot>`, dont la fermante est facultative
    if (n.fermeeParAncetre !== null && !IMPLICIT_CLOSE_TAGS.has(lower) && rawName !== '@slot') {
      scanner.pos = n.fermeeParAncetre
      const m    = scanner.rest().match(/^<\/([a-zA-Z0-9\-@]+)\s*>/)
      const line = typedLine('syntax', t('parser.fermeture-mal-appariee', { attendu: nomResolu, trouve: m ? m[1] : '?', ligneOuverture: tagCite, ligneFermeture: currentCite(scanner) }), diag.lint)
      if (line !== null) avertissements.push(line)
    }
    pushTag(container, node, choix)
  }
}

export function parse(html: string, tagRefs?: TagRef[], diagRecu: ParseDiag = {}): Node {
  // avec la ligne du fichier où le HTML commence (`firstLine`), les lignes blanches rognées en tête (une balise du langage
  // retirée de la première ligne y laisse la sienne) restent comptées : la première ligne lue garde celle du fichier ; un
  // texte analysé seul compte ses lignes depuis sa première ligne écrite
  const rognees   = diagRecu.firstLine === undefined ? 0 : /^\s*/.exec(html)![0].split('\n').length - 1
  const diag      = rognees === 0 ? diagRecu : { ...diagRecu, firstLine: (diagRecu.firstLine ?? 1) + rognees, hostLines: diagRecu.hostLines?.slice(rognees), lineCites: diagRecu.lineCites?.slice(rognees) }
  const firstLine = diag.firstLine ?? 1
  const texte     = expandLayoutBlocks(html.trim(), firstLine).trim()
  autoSkeleton = diag.autoSkeleton !== false
  foreignTag   = null
  texteSeul    = null
  fileModels   = { dev: diag.models?.dev ?? {}, core: diag.models?.core ?? {} }
  guarded      = new Set(diag.guarded ?? [])
  guardSilent  = diag.guardSilent === true
  projectTags  = diag.projectTags ?? null
  liensVus     = diag.links ?? null
  textesVus    = new Map()
  return lireParLArbre(texte, tagRefs, diag)
}
