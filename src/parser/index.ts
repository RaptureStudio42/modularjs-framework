// parser HTML — port consolidé de la V1 Ruby, parser_html.rb
// + sous-modules (parser_html/{dom,attributes,flow,parser_utils}.rb, node.rb)
//
// Port à l'identique. Output AST identique à V1.

import { t } from '../messages/index.js'
import { aliasExample } from '../effects/aliases-mjs.js'
import { unknownEffectError } from '../effects/catalog.js'
import { settingsComment } from '../effects/settings-comment.js'
import { RESERVED_SYMBOL_NAMES } from '../generator/reserved-symbols.js'
import { ouvreUneRegex } from '../sigils.js'
import { typedLine, printDiagnostic, type LintToggles } from '../diagnostics.js'

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
}

export type NodeType = 'root' | 'tag' | 'text' | 'expr' | 'if' | 'for' | 'await' | 'key' | 'const'

export type AttrType = 'static' | 'dynamic' | 'boolean' | 'spread'

export interface Attr {
  type: AttrType
  name?: string
  val?: string
  expr?: string
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
  // balise précise (posée par parseDom, après resolveTagName ET parseAttrs). Absent si
  // l'attribut est absent, dynamique (`layout={expr}`, non vérifiable au build) ou booléen.
  layoutLiteral?: string
  // module CŒUR seulement (`raccourci-coeur`, `litteral-coeur`) : ce que CETTE balise écrit. Le bundler
  // y lit si un attribut est posé quelque part dans l'appli (Bundler.coreAttrWritten). Absent des
  // références au projet : leurs attributs n'intéressent personne au build.
  attrs?: TagRefAttrs
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
  line?: number  // ligne d'origine dans le fichier (tag/text/expr, cf. ParseDiag.firstLine) — lue par hoistFillBlocks et par le générateur pour leurs messages

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
// « fermeture mal appariée » (parseDom, cas `close_tag`) pour ne PAS avertir sur ces cas connus.
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

  constructor(str: string, firstLine = 1) {
    this.str = str
    this.pos = 0
    this.last = null
    this.firstLine = firstLine
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
// `echecs` : positions d'accolades ouvrantes dont la lecture ne se referme jamais (connues de l'appelant) ; la lecture qui en compte une
// s'arrête et lève aussitôt, elle ne se refermerait pas non plus
export function extractBalanced(scanner: Scanner, closeChar: string, settings = false, echecs?: Set<number>): string {
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
        const corps = extractBalanced(scanner, '}', settings, echecs)
        res += '${' + corps + '}'
        continue
      }
      // `"…#{…}…"` : l'interpolation est traversée d'un bloc, comme au lexeur (scanDoubleQuoteAt) — ses guillemets et ses accolades sont
      // les siens (`{"#{"}"}#{$x}"}`). Jamais refermée sur sa ligne, elle reste du texte, lu comme avant
      if (stringChar === '"' && ch === '#' && scanner.peek(1) === '{') {
        const avant = scanner.pos
        scanner.getch()                                        // consomme le `{`
        try {
          const corps = extractBalanced(scanner, '}', settings, echecs)
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
      if (!settings && ouvreUneRegex(res)) { res += ch + avaleRegex(scanner); continue }
    }

    if (ch === '"' || ch === "'" || ch === '`') { inString = true; stringChar = ch; res += ch; continue }
    if (ch === openChar) {
      balance += 1
      if (echecs !== undefined && echecs.has(scanner.pos - 1)) break
    }
    else if (ch === closeChar) { balance -= 1; if (balance === 0) break }
    res += ch
  }

  // Sortie par FIN DE FICHIER = délimiteur jamais refermé. Sans cette garde l'expression
  // avalait tout le HTML suivant et le composant compilait « AVEC SUCCÈS » sur un template VIDE :
  // le nœud entier disparaissait sans un mot (mesuré sur `@flip={…'ab\}`, `@style.color={'ab\}`,
  // `title={'ab\}`, `@class{'ab\}` — 0 erreur, `_mjs_cloneTpl("")`). Une compilation verte qui rend
  // du vide est le pire signal possible : on lève, en situant l'OUVERTURE.
  if (inString) throw new Error(t('parser.chaine-non-fermee', { ligne: lineAt(scanner, startPos), quote: stringChar ?? '', extrait: apercuExpr(res) }))
  if (balance !== 0) throw new Error(t('parser.delimiteur-non-ferme', { ligne: lineAt(scanner, startPos), ouvrant: openChar, fermant: closeChar, extrait: apercuExpr(res) }))

  return res
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
  return lo + scanner.firstLine
}

function currentLine(scanner: Scanner): number {
  return lineAt(scanner, scanner.pos)
}

// familles de temporaires SUFFIXÉS réellement émis par le générateur
// (`__arr_0`/`__idx_1` du {for}, `_nref_*`/`_c_*` de compile.ts, tout `_mjs_*`) :
// la liste `RESERVED_TEMPLATE_NAMES` ne protège que des noms EXACTS, un item de
// boucle `__arr_0` collisionnerait sans que rien ne l'attrape.
const RESERVED_PREFIX_RE = /^(?:__arr_|__idx_|_nref_|_mjs_|_c_)/

function rejectReservedName(kind: string, name: string | null | undefined, line: number): void {
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

// jeton de branche qui n'appartient pas au bloc en cours (`{else}` dans un `{for}`, `{success}` dans un `{if}`…) :
// sans ce refus il disparaissait, et son contenu se fondait dans le bloc (« vide » après chaque élément d'un `{for}`)
const JETONS_DE_BRANCHE: Record<string, string> = { else: '{else}', elsif: '{elsif …}', success: '{success …}', error: '{error …}' }
function refuseJetonEtranger(res: string | undefined, bloc: string, ligneBloc: number, scanner: Scanner): void {
  if (res !== undefined && Object.prototype.hasOwnProperty.call(JETONS_DE_BRANCHE, res)) {
    throw new Error(t('parser.jeton-flux-hors-bloc', { jeton: JETONS_DE_BRANCHE[res], bloc, ligneBloc, ligne: currentLine(scanner) }))
  }
}

function raiseUnclosedBlock(kind: string, expr: string, line: number): never {
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
  throw new Error(t(settings ? 'effets.point-reglages' : 'effets.point-espace', { nom: name, blanc: m[1] ? ' ' : '', point: m[2], exemple: aliasExample(name.split('.')[0]), ligne: currentLine(scanner) }))
}

// un effet écrit sans réglages collés : rien à lire — sauf une parenthèse séparée de son nom par un
// blanc (`*neon (#0ff)`), refusée : ses réglages étaient perdus et versés en attributs parasites ; ni un point séparé de lui par un blanc
function detachedSettings(scanner: Scanner, name: string, transition = false): string {
  if (scanner.check(/\s+\(/)) throw new Error(t('effets.espace', { nom: name, ligne: currentLine(scanner) }))
  strayDot(scanner, name, false, transition)
  return ''
}

// les réglages d'un effet (`*nom(…)`, `@in=*nom(…)`), l'ouvrante déjà lue, sans commentaire : il se lirait comme une valeur et ferait perdre les
// réglages qui le suivent. Le message cite la ligne du commentaire
function readEffectSettings(scanner: Scanner, name: string): string {
  const from     = scanner.pos
  const settings = extractSettings(scanner)
  const found    = settingsComment(settings)
  if (found) throw new Error(t('effets.commentaire', { nom: name, ligne: lineAt(scanner, from + found.at), commentaire: found.text }))
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
    if (seenAttrNames.has(name)) throw new Error(t('parser.attribut-duplique', { attribut: name, tag: node.name, ligne: currentLine(scanner) }))
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
        const line = currentLine(scanner)
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
      if (scanner.check(/\s*=/)) throw new Error(t('effets.egal', { nom: name.slice(1), ligne: currentLine(scanner) }))
      node.attrs.push({ type: 'static', name, val })
      continue
    }

    // une étoile et un point, sans nom d'effet entre eux (`*.net`) : l'effet manque, et ce n'est pas un attribut
    if (scanner.scan(/\*(\.[\w.-]*)/)) throw new Error(t('effets.point-sans-effet', { point: scanner.group(1), ligne: currentLine(scanner) }))

    if (scanner.scan(/@(class|style\.[a-zA-Z0-9\-]+)\{/)) {
      const prefix = scanner.group(1)!
      const expr = extractBalanced(scanner, '}')
      const name = `@${prefix}{${expr}}`
      checkAttrDuplicate(name)

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
      continue
    }

    // `_` ajouté au charset des noms d'attribut : sans lui, le scan
    // s'arrêtait au `_`, `data-user_id="3"` devenait `data-user` + `id="3"`
    // (l'`id` NATIF de l'élément écrasé) ; l'underscore est valide en HTML et
    // imposé par la convention snake_case maison (`data-` compris).
    if (scanner.scan(/([a-zA-Z0-9:@\-\._]+)/)) {
      const name = scanner.group(1)!
      checkAttrDuplicate(name)
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
          continue
        }
        if (scanner.scan(/\{/)) {
          const val = extractBalanced(scanner, '}')
          node.attrs.push({ type: 'dynamic', name, expr: val })
        } else if (scanner.scan(/"([^"]*)"/)) {
          node.attrs.push({ type: 'static', name, val: sansEffetEntreGuillemets(name, scanner.group(1)!) })
        } else if (scanner.scan(/'([^']*)'/)) {
          node.attrs.push({ type: 'static', name, val: sansEffetEntreGuillemets(name, scanner.group(1)!) })
        } else if (scanner.scan(/((?:[^\s>\/]|\/(?!>))+)/)) {
          // une valeur non quotée s'arrêtait à `>` mais avalait le `/`
          // d'un `/>` : `<img src=x/>` → val `"x/"`. On exclut le seul `/`
          // IMMÉDIATEMENT suivi de `>` (auto-fermeture) ; un `/` interne (URL
          // `http://…`) reste dans la valeur.
          node.attrs.push({ type: 'static', name, val: scanner.group(1) })
        }
      } else if (!name.startsWith('@') && !(node.name ?? '').includes('-') && node.name !== 'slot' && node.name !== FILL_TAG_NAME && MJS_NATIVE_BOOLEAN_ATTRS.has(name)) {
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
      continue
    }

    scanner.getch()
  }
}

// ============================================================================
// Flow parser ({if} {for} {await} {key})
// ============================================================================
let currentBranchArg: string | null = null
let currentElsifExpr: string | null = null
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
// chaque fichier passe ici avant d'être recollé, la faute d'un partiel inclus est citée dans le partiel
export function expandLayoutBlocks(html: string, firstLine = 1): string {
  if (!html.includes('{?')) return html
  const pile: Array<{ kind: string, noms?: string[], index?: number }> = []
  const re = /<!--(?:-?>|[\s\S]*?--!?>)|\{(if|for|await|key)\s|\{end\}|\{\?([^}]*)\}/g
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
      const ligne = firstLine + (html.slice(0, m.index).match(/\n/g)?.length ?? 0)
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
  if (openBlock?.kind === 'layout') raiseUnclosedBlock('?', openBlock.noms!.join(', '), firstLine + (html.slice(0, openBlock.index).match(/\n/g)?.length ?? 0))
  return out + html.slice(i)
}

// les modèles en fichier de l'analyse en cours (cf. ParseDiag.models)
let fileModels: { dev: Record<string, string[]>, core: Record<string, string[]> } = { dev: {}, core: {} }

// les variables typées dont un champ lié se garde de lui-même (cf. ParseDiag.guarded), et comment
let guarded     = new Set<string>()
let guardSilent = false
const GUARD_FIELDS = new Set(['input', 'textarea', 'select'])
const GUARD_BIND   = /^!(?:\.\w+)?\{\s*(\$\$?[A-Za-z_]\w*)\s*\}$/

// `inAwait` : vrai pour les enfants lus directement au niveau des branches d'un `{await}` (attente, `{success}`, `{error}`), faux plus bas — dans une balise, un `{if}`, un `{for}`
// ou un `{key}` de la branche — comme hors de tout `{await}` : c'est lui qui dit que `{success}` / `{error}` sans nom ouvrent une branche (cf. parseFlow)
type ChildrenParser = (container: Node[], inAwait?: boolean) => string | undefined

function parseFlow(scanner: Scanner, container: Node[], parseChildren: ChildrenParser, inAwait = false): boolean | string {
  if (scanner.scan(/\{await\s+/)) {
    const startLine = currentLine(scanner)
    const node = new Node('await')
    node.line = startLine  // même geste que tag/expr : posée sur LE NŒUD lui-même, plus de nearestLine côté générateur
    node.expr = extractBalanced(scanner, '}').trim()
    // `{await $profil *skeleton(réglages)}` : l'attente prend la forme du contenu à venir (cf. poseSkeleton)
    const sk = /^([\s\S]*?)\s+\*skeleton(?:\(([\s\S]*)\))?$/.exec(node.expr)
    const skeleton = sk ? sk[2] ?? '' : null
    if (sk) node.expr = sk[1].trim()
    let currentBranch: Branch = { type: 'pending', children: [] }
    node.branches.push(currentBranch)
    let sawEnd = false
    while (!scanner.eos()) {
      const posBefore = scanner.pos
      const res = parseChildren(currentBranch.children, true)
      if (res === 'success') {
        currentBranch = { type: 'success', arg: currentBranchArg ?? undefined, children: [] }
        node.branches.push(currentBranch)
      } else if (res === 'error') {
        currentBranch = { type: 'error', arg: currentBranchArg ?? undefined, children: [] }
        node.branches.push(currentBranch)
      } else if (res === 'end') {
        sawEnd = true
        break
      } else refuseJetonEtranger(res, '{await}', startLine, scanner)
      // garde-fou anti-boucle infinie : une fermante orpheline dans le
      // bloc (`{await …}</div>{end}`) fait remonter `'close_tag'` SANS consommer
      // → `scanner.pos` fige. Toute non-progression = bloc non fermé.
      if (scanner.pos === posBefore) break
    }
    if (!sawEnd) raiseUnclosedBlock('await', node.expr, startLine)
    if (skeleton !== null) {
      if (foreignTag) throw new Error(t('parser.squelette-svg', { balise: foreignTag, ligne: startLine }))
      poseSkeleton(node, skeleton, startLine)
    }
    // sans branche d'attente écrite : le squelette de {success}, d'office — jamais en SVG ni en MathML
    else if (autoSkeleton && !foreignTag && node.branches.some(b => b.type === 'success') && !node.branches[0].children.some(c => c.type !== 'text' || (c.content ?? '').trim() !== '')) poseSkeleton(node, '', startLine)
    container.push(node)
    return true
  }

  if (scanner.scan(/\{success\s+/)) {
    const line = currentLine(scanner)
    currentBranchArg = extractBalanced(scanner, '}').trim()
    rejectReservedName('success', currentBranchArg, line)
    return 'success'
  }

  if (scanner.scan(/\{error\s+/)) {
    const line = currentLine(scanner)
    currentBranchArg = extractBalanced(scanner, '}').trim()
    rejectReservedName('error', currentBranchArg, line)
    return 'error'
  }

  // `{success}` et `{error}` collés, sans nom : au niveau des branches d'un `{await}` ils ouvrent la branche, sans valeur nommée, comme `{success }` ;
  // ailleurs ils restent l'affichage d'une variable de ce nom (parseDom)
  if (inAwait && scanner.scan(/\{(success|error)\}/)) {
    currentBranchArg = ''
    return scanner.group(1)!
  }

  if (scanner.scan(/\{if\s+/)) {
    const startLine = currentLine(scanner)
    const node = new Node('if')
    node.line = startLine  // cf. commentaire jumeau sur {await} ci-dessus
    const firstExpr = extractBalanced(scanner, '}').trim()
    let currentBranch: Branch = { expr: firstExpr, children: [] }
    node.branches.push(currentBranch)
    let sawEnd = false
    while (!scanner.eos()) {
      const posBefore = scanner.pos
      const res = parseChildren(currentBranch.children)
      if (res === 'elsif') {
        currentBranch = { expr: currentElsifExpr, children: [] }
        node.branches.push(currentBranch)
      } else if (res === 'else') {
        currentBranch = { expr: null, children: [] }
        node.branches.push(currentBranch)
      } else if (res === 'end') {
        sawEnd = true
        break
      } else refuseJetonEtranger(res, '{if}', startLine, scanner)
      // voir {await} : une fermante orpheline (`{if $x}</div>{end}`)
      // remontait `'close_tag'` sans avancer → boucle infinie 100 % CPU.
      if (scanner.pos === posBefore) break
    }
    if (!sawEnd) raiseUnclosedBlock('if', firstExpr, startLine)
    container.push(node)
    return true
  }

  if (scanner.scan(/\{elsif\s+/)) {
    currentElsifExpr = extractBalanced(scanner, '}').trim()
    return 'elsif'
  }

  if (scanner.scan(/\{else\}/)) return 'else'
  if (scanner.scan(/\{end\}/)) return 'end'
  // `{/if}`, `{/for}`… (fermeture d'autres outils) : un bloc se ferme par `{end}` — lu comme une expression, le `/` y ouvrait
  // une regex qui avalait la suite du HTML, et l'erreur parlait d'une « expression non fermée », loin de la faute
  if (scanner.check(/\{\/(?:if|for|each|await|key)\}/)) {
    const ligne = currentLine(scanner)
    throw new Error(t('parser.fermeture-bloc-slash', { ecrit: scanner.scan(/\{\/\w+\}/), ligne }))
  }

  // `{key}` aligné sur `{if}` : (a) l'expr passe par `extractBalanced`
  // (l'ancien `\{key\s+(.+?)\}` tronquait `{key f({a:1})}` au 1er `}`), (b) le
  // `{end}` est désormais EXIGÉ (un `{key}` non fermé absorbait la suite en
  // silence et volait le `{end}` d'un bloc parent), (c) même garde anti-boucle
  // contre une fermante orpheline dans le corps.
  if (scanner.scan(/\{key\s+/)) {
    const startLine = currentLine(scanner)
    const node = new Node('key')
    node.line = startLine  // cf. commentaire jumeau sur {await} plus haut
    node.expr = extractBalanced(scanner, '}').trim()
    let sawEnd = false
    while (!scanner.eos()) {
      const posBefore = scanner.pos
      const res = parseChildren(node.children)
      if (res === 'end') { sawEnd = true; break }
      refuseJetonEtranger(res, '{key}', startLine, scanner)
      if (scanner.pos === posBefore) break
    }
    if (!sawEnd) raiseUnclosedBlock('key', node.expr, startLine)
    container.push(node)
    return true
  }

  // `{const NOM = EXPR}` — déclaration de constante LOCALE (≡ `{@const}` Svelte).
  // Ne crée AUCUN nœud texte : juste une liaison réutilisable dans les
  // interpolations SUIVANTES du même bloc (cas principal : un `{for}`). On lit
  // le nom puis l'expression via extractBalanced (gère les `}` dans strings /
  // accolades imbriquées de l'EXPR, ex: `{const o = {a: 1}}`).
  if (scanner.scan(/\{const\s+/)) {
    const line = currentLine(scanner)
    // Le nom doit précéder le PREMIER `=` qui n'est ni `==`/`=>` etc.
    if (!scanner.scan(/([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=(?![=>])\s*/)) {
      throw new Error(t('parser.const-syntaxe-invalide', { ligne: line }))
    }
    const node = new Node('const')
    node.line = line  // cf. commentaire jumeau sur {await} plus haut
    node.name = scanner.group(1)!.trim()
    node.expr = extractBalanced(scanner, '}').trim()
    rejectReservedName('const', node.name, line)
    if (node.expr === '') {
      throw new Error(t('parser.const-expression-vide', { nom: node.name, ligne: line }))
    }
    container.push(node)
    return true
  }

  if (scanner.scan(/\{for\s+/)) {
    const startLine = currentLine(scanner)
    const expr = extractBalanced(scanner, '}').trim()
    // µ admis dans la classe de caractères (au même titre que $) : un item/index
    // ainsi nommé matche la syntaxe et passe par rejectReservedName ci-dessous, plutôt que de
    // tomber dans le message de syntaxe générique
    // `[\s\S]` : un parcours écrit sur plusieurs lignes (`$items.filter((i) ->⏎ i.ok)`) passe, comme un `{if}`
    const m = expr.match(/^(?:([a-zA-Z0-9_$µ]+)\s*,\s*)?([a-zA-Z0-9_$µ]+)\s+in\s+([\s\S]+?)(?:\s+by\s+([a-zA-Z0-9_$µ]+))?$/)
    if (m) {
      // `by` attend le nom d'un champ de l'élément : `by x.id` restait collé au parcours (« $l by x.id ») et la
      // construction échouait plus loin, sur un message de Civet sans rapport
      const byChemin = m[4] ? null : /\s+by\s+([a-zA-Z_$µ][\w$µ]*(?:\.[a-zA-Z_$µ][\w$µ]*)+)\s*$/.exec(m[3])
      if (byChemin) {
        const reste = byChemin[1].startsWith(m[2] + '.') ? byChemin[1].slice(m[2].length + 1) : ''
        throw new Error(t('parser.for-by-chemin', { expr, cle: byChemin[1], champ: /^[\w$µ]+$/.test(reste) ? reste : 'id', ligne: startLine }))
      }
      const node = new Node('for')
      node.line = startLine  // cf. commentaire jumeau sur {await} plus haut
      // Si l'ITEM s'appelle `index` (sans index explicite), le compteur
      // implicite prend un nom interne — sinon le générateur émettrait
      // `(index, index) =>` : paramètres dupliqués = SyntaxError en module ES.
      node.index = m[1] ?? (m[2] === 'index' ? '_mjs_i' : 'index')
      node.item = m[2]
      node.iterable = m[3].trim()
      node.key = m[4] ?? null
      rejectReservedName('for', node.item, startLine)
      if (m[1]) rejectReservedName('for', node.index, startLine)
      // item et index homonymes : `{for x, x in …}` émettrait `(x, x) =>`
      // (clash de paramètres = SyntaxError). Rejet avec message clair.
      if (m[1] && node.item === node.index) {
        throw new Error(t('parser.for-item-index-homonyme', { item: node.item, index: node.index, ligne: startLine }))
      }
      let sawEnd = false
      while (!scanner.eos()) {
        const posBefore = scanner.pos
        const res = parseChildren(node.children)
        if (res === 'end') { sawEnd = true; break }
        refuseJetonEtranger(res, '{for}', startLine, scanner)
        // fermante orpheline dans le {for} : `'close_tag'` sans progrès.
        if (scanner.pos === posBefore) break
      }
      if (!sawEnd) raiseUnclosedBlock('for', expr, startLine)
      container.push(node)
    } else {
      // Avant ce throw, un `{for}` non reconnu était avalé SANS erreur : aucun
      // nœud poussé, et son `{end}` fermait le bloc PARENT → template mutilé
      // en silence. Cas typique : `{for x of arr}` (habitude JS).
      const hint = /\s+of\s+/.test(expr) ? t('parser.for-astuce-in-pas-of') : ''
      throw new Error(t('parser.for-syntaxe-invalide', { expr, ligne: startLine, astuceOf: hint }))
    }
    return true
  }

  return false
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

// une transition entre guillemets (`@in="*fly(up)"`, `@out='*fade'`) : un effet s'écrit sans eux —
// une seule écriture, `@in=*fly(up)` (`@in.global="*fly"` donne `@in.global=*fly` : le modificateur reste)
function sansEffetEntreGuillemets(name: string, val: string): string {
  if (/^@(?:in|out|transition)(?:\.\w+)*$/.test(name) && /^\s*\*[A-Za-z]/.test(val)) throw new Error(t('transitions.guillemets', { directive: transitionDirective(name), effet: val.trim() }))
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

function poseSkeleton(node: Node, settings: string, line: number): void {
  const pending = node.branches.find(b => b.type === 'pending')!
  const success = node.branches.find(b => b.type === 'success')
  if (pending.children.some(c => c.type !== 'text' || (c.content ?? '').trim() !== '')) throw new Error(t('parser.squelette-attente-ecrite', { ligne: line }))
  if (!success) throw new Error(t('parser.squelette-sans-success', { ligne: line }))
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
function resolveTagName(rawName: string, tagRefs?: TagRef[]): string {
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
// sous-ensemble tag-scanning de parseDom/parseAttrs sur le SCANNER RÉEL plutôt qu'un
// regex naïf sur une sous-chaîne : une valeur d'attribut piégeuse (`title="a > b"`) ne
// fausse pas le comptage, et une occurrence AUTOFERMANTE du même nom ne compte pas comme
// une ouverture en attente (net zéro). Limite assumée : une
// mention du nom dans un texte/commentaire quelconque (pas un vrai tag) peut fausser le
// comptage — pas un vrai parseur XML, jamais prétendu l'être ailleurs dans ce fichier.
function willClose(scanner: Scanner, resolvedName: string): boolean {
  const savedPos = scanner.pos
  // aucune fermante qui se résoudrait en ce nom plus loin (`</mjs-x`, `</@mjs-x`, `</@x`, `</@@x`) : le parcours
  // ne trouverait rien — sans ce pré-test, chaque raccourci nu relisait tout le reste du gabarit (temps quadratique)
  const formes = ['</' + resolvedName, '</@' + resolvedName]
  if (resolvedName.startsWith('mjs-')) formes.push('</@' + resolvedName.slice(4))
  if (resolvedName.startsWith('mjs-core-')) formes.push('</@@' + resolvedName.slice(9))
  if (!formes.some(f => scanner.str.indexOf(f, savedPos) >= 0)) return false
  let depth = 1
  let found = false
  while (!scanner.eos()) {
    const posBefore = scanner.pos
    // un commentaire et une expression `{…}` ne portent aucune balise (`{$n<3 ? …}`, `<!-- <div a a> -->`) ;
    // expression mal fermée : abandon prudent, comme une balise malformée
    if (scanner.scan(/<!--(?:-?>|[\s\S]*?--!?>)/)) continue
    if (scanner.scan(/\{/)) {
      try { extractBalanced(scanner, '}') }
      catch { break }
      continue
    }
    if (scanner.scan(/<\/([a-zA-Z0-9\-@]+)\s*>/)) {
      if (resolveTagName(scanner.group(1)!) === resolvedName) {
        depth -= 1
        if (depth === 0) { found = true; break }
      }
    } else if (scanner.scan(/<(@@?[a-zA-Z0-9-]+|[a-zA-Z][a-zA-Z0-9-]*)/)) {
      const name2 = resolveTagName(scanner.group(1)!)
      const tmp = new Node('tag')
      tmp.name = name2
      parseAttrs(scanner, tmp)
      if (scanner.scan(/\s*\/>/)) {
        // auto-fermante : ouverture+fermeture dans le même token, net zéro
      } else if (VOID_TAGS.includes(name2.toLowerCase())) {
        scanner.scan(/\s*>/)
      } else if (scanner.scan(/\s*>/)) {
        if (name2 === resolvedName) depth += 1
      } else {
        break  // tag malformée : abandon prudent (void par défaut côté appelant)
      }
    } else if (!scanner.scan(/[^<{]+/)) {
      scanner.getch()
    }
    if (scanner.pos === posBefore) break  // garde anti-boucle infinie
  }
  scanner.pos = savedPos
  return found
}

function parseDom(scanner: Scanner, container: Node[], parseChildren: ChildrenParser, tagRefs?: TagRef[], diag: ParseDiag = {}): boolean | string {
  // dans un <textarea> ou un <title> HTML, le navigateur ne lit que du texte jusqu'à sa fermante : une balise écrite
  // dedans (`<b x={$v}>`, `</b>`) est un texte, gardé tel qu'écrit (sa valeur `{…}` n'est pas lue), sans élément ni liaison
  if (texteSeul !== null && scanner.check(/<\/?[a-zA-Z@]/) && !scanner.check(new RegExp(`</${texteSeul}[\\s/>]`, 'i'))) {
    const node = new Node('text')
    node.line    = currentLine(scanner)
    node.content = scanner.scan(/<\/?[^<>]*>?/)!
    container.push(node)
    return true
  }

  // `\s*` avant `>` : le pré-check refusait tout blanc (`</div >`) alors
  // que la consommation en aval (ligne ~512) le tolère → progression nulle →
  // « ERREUR DE PARSING FATALE » cryptique. On aligne les deux.
  if (scanner.check(/<\/[a-zA-Z0-9\-@]+\s*>/)) return 'close_tag'

  if (scanner.scan(/\{\{/)) {
    const startLine = currentLine(scanner)
    const node = new Node('expr')
    const content = extractBalanced(scanner, '}')
    // `{{ expr }}` (HTML brut) exige DEUX accolades fermantes : extractBalanced ne consomme que
    // la PREMIÈRE. Le retour de ce second `scan` était ignoré — `{{value}` (une seule fermante,
    // jamais une forme documentée) compilait quand même en HTML brut, sur un contenu tronqué.
    if (!scanner.scan(/\}/)) {
      throw new Error(t('parser.html-brut-mal-ferme', { ligne: startLine }))
    }
    node.expr = content.trim()
    node._is_raw = true
    node.line = startLine
    container.push(node)
    return true
  }

  if (scanner.scan(/\{(?!\.\.\.)/)) {
    const startLine = currentLine(scanner)
    const node = new Node('expr')
    const content = extractBalanced(scanner, '}')
    node.expr = content.trim()
    // Piège classique (habitude JSX/Svelte) : `{else if cond}` ne matche NI
    // `{elsif ...}` NI `{else}` (tous deux stricts, cf. parseFlow ci-dessus) →
    // tombe ICI comme une expression quelconque, part côté Civet TEL QUEL et
    // explose sur une erreur cryptique (parle d'imports/exports), très loin
    // du vrai problème — composant entier tombé.
    // `\s+` laissait passer la variante SANS espace `{elseif
    // cond}` (habitude PHP/Vue tout aussi courante) : NI erreur dédiée NI
    // erreur Civet, le composant compilait EN SILENCE (sonde : 0 erreur), pire
    // que le cas déjà couvert — l'échec se serait déplacé au RUNTIME (appel
    // Civet implicite `elseif(cond)` vers une fonction inexistante). `\s*`
    // (zéro-ou-plus) couvre les deux graphies ; `\b` après `if` protège
    // toujours un identifiant légitime du type `{elseIfCount}` (bloc majuscule
    // ou soudé sans césure sur "if" isolé — cf. tests).
    if (/^else\s*if\b/.test(node.expr)) {
      throw new Error(t('parser.else-if-non-supporte', { expr: node.expr, ligne: startLine }))
    }
    node._is_raw = false
    node.line = startLine
    container.push(node)
    return true
  }

  // un nom de balise ordinaire commence par une lettre : `<- Retour`, `{$n}<5 ans` sont du texte (TEXT_RUN_RE), comme
  // dans le navigateur
  if (scanner.scan(/<(@@?[a-zA-Z0-9-]+|[a-zA-Z][a-zA-Z0-9-]*)/)) {
    const node = new Node('tag')
    const rawName = scanner.group(1)!
    const tagLine = currentLine(scanner)
    node.line = tagLine

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

    // *guard d'office : un champ lié à une variable typée (`<input value=!{$age}>`) le reçoit comme
    // s'il était écrit — un *guard écrit garde ses réglages ; `effects.guard: false` le rend muet (la
    // frappe reste à l'abri, la valeur ramenée à la sortie, sans effet ni bulle)
    if (guarded.size > 0 && GUARD_FIELDS.has(node.name) && !node.attrs.some(a => a.name === '*guard')) {
      const lien = node.attrs.find(a => a.name === 'value' && GUARD_BIND.test(a.val ?? ''))
      if (lien && guarded.has(GUARD_BIND.exec(lien.val!)![1])) node.attrs.push({ type: 'static', name: '*guard', val: guardSilent ? 'silent: true' : '' })
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
      if (modeles) {
        const calcule = node.attrs.find(a => (a.name === 'layout' || a.name === 'template') && (a.type === 'dynamic' || (a.type === 'static' && /[{}]/.test(a.val ?? ''))))
        // choisi par une valeur calculée (`layout={$vue}`) : le compilateur écrit le {if} — la balise
        // de chaque modèle, sinon le composant de base (cf. pushTag) ; chaque modèle entre au bundle
        if (calcule && calcule.type === 'dynamic') {
          choix = { expr: calcule.expr ?? '', attr: calcule, modeles }
          for (const x of modeles) tagRefs!.push({ ...ref, name: `${ref.name}--${x}`, layoutLiteral: undefined })
        }
        else if (calcule) throw new Error(t('parser.modele-fichier-calcule', { tag: rawName, nom: ref.name, modeles: modeles.join(', '), premier: modeles[0], ligne: tagLine }))
        if (layoutAttr && modeles.includes(layoutAttr.val ?? '')) {
          node.name         = `${node.name}--${layoutAttr.val}`
          node.attrs        = node.attrs.filter(a => a !== layoutAttr)
          ref.name          = `${ref.name}--${layoutAttr.val}`
          ref.layoutLiteral = undefined
        }
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

    // Note : metamjs-view n'est PAS void. Le preprocess émet
    // <metamjs-view ...></metamjs-view> (paire complète), donc le parser
    // doit lire le </metamjs-view> qui suit, sinon le closing tag est
    // interprété comme orphelin et termine prématurément le parent.
    const isVoid = VOID_TAGS.includes(node.name.toLowerCase())

    if (scanner.scan(/\s*\/>/)) {
      // généralisation de la règle <@include nom/>
      // (slash final interdit, macros.ts) à <@view> : une vue reçoit TOUJOURS
      // son contenu du routeur, une auto-fermeture n'a jamais été une forme
      // valide (contrairement à <@window>/<@document>/<@body>/<@html>, 100%
      // auto-fermées en usage réel, ou à <@slot/> — idiome légitime sans
      // contenu de repli — NI touchées ici : seul `@view` est concerné).
      if (rawName === '@view') {
        throw new Error(t('parser.view-auto-fermeture-interdite', { nom: node.attrs[0]?.val ?? '', ligne: tagLine }))
      }
      pushTag(container, node, choix)
    } else if (isVoid) {
      scanner.scan(/\s*>/)
      pushTag(container, node, choix)
    } else if (scanner.scan(/\s*>/)) {
      // forme NUE d'un raccourci `<@x>` ou `<@@x>` (hors 12 réservées) SANS fermante
      // à venir (comptage équilibré, willClose ci-dessus) : VOID, comme
      // l'autofermant — aucun enfant avalé, les frères suivants restent au
      // niveau du PARENT (ni parseChildren, ni recherche d'un `</x>`).
      const isShortcutTag = rawName.startsWith('@') && !AT_RESERVED_NAMES.includes(rawName.slice(1))
      if (isShortcutTag && !willClose(scanner, nomResolu)) {
        pushTag(container, node, choix)
        return true
      }
      // MÊME carve-out que ci-dessus pour `<@slot …>`, exclu de
      // `isShortcutTag` puisque 'slot' est une réservée (AT_RESERVED_NAMES l.665) : nu et SANS
      // rien d'autre que du blanc jusqu'à EOF (jamais de `</@slot>`/`</slot>` à venir), c'est le
      // même idiome void que `<@slot/>` — documenté (docs/13-contexte.md, tuto-grille.mjs) et
      // cassé par le garde-fou balise-non-fermee, qui ne distinguait pas @slot des autres
      // réservées. `<@slot>` PORTEUR de repli (`<@slot>texte`) reste soumis à l'erreur juste en
      // dessous : le HTML impose une fermante pour délimiter où le repli s'arrête.
      if (rawName === '@slot' && scanner.check(/(?:\s|<!--(?:-?>|[\s\S]*?--!?>))*$/) && !willClose(scanner, nomResolu)) {   // blanc OU commentaire (padding des sections retirées) jusqu'à EOF
        pushTag(container, node, choix)
        return true
      }
      // entrer dans un <svg>/<math> ou un <foreignObject> change le contenu des enfants, jusqu'à la fermante
      const lower     = node.name.toLowerCase()
      const enclosing = foreignTag
      const texteAvant = texteSeul
      if (lower === 'svg' || lower === 'math') foreignTag = lower
      else if (lower === 'foreignobject') foreignTag = null
      if (texteSeul === null && foreignTag === null && (lower === 'textarea' || lower === 'title')) texteSeul = lower
      let res: string | undefined
      try {
        res = parseChildren(node.children)
      }
      finally {
        foreignTag = enclosing
        texteSeul  = texteAvant
      }
      if (res === 'close_tag') {
        const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const escapedRaw = escapeRegex(rawName)
        const escapedNew = escapeRegex(nomResolu)
        const consumed = scanner.scan(new RegExp(`<\\/(?:${escapedRaw}|${escapedNew})\\s*>`))
        // la fermante rencontrée ne correspond PAS à ce tag (sinon `consumed` ne serait pas
        // null) : ni consommée ni signalée — elle remonte telle quelle vers l'ancêtre qui,
        // lui, la refermera peut-être correctement (cas `<div><span></div>` : le </div>
        // remonte du <span> vers le <div>). AVERTISSEMENT ici (jamais une erreur, cf.
        // parser.fermeture-mal-appariee), sauf fermeture implicite HTML5 légitime.
        // `<@slot>` : fermante `</@slot>` facultative (docs/12-snippets.md), sa fermeture par un
        // ancêtre (`<div><@slot></div>`) est l'idiome documenté, pas une faute
        if (consumed === null && !IMPLICIT_CLOSE_TAGS.has(node.name.toLowerCase()) && rawName !== '@slot') {
          const m = scanner.rest().match(/^<\/([a-zA-Z0-9\-@]+)\s*>/)
          const line = typedLine('syntax', t('parser.fermeture-mal-appariee', {
            attendu: nomResolu, trouve: m ? m[1] : '?', ligneOuverture: tagLine, ligneFermeture: currentLine(scanner)
          }), diag.lint)
          if (line !== null) printDiagnostic(line, diag.colorsEnabled ?? false)
        }
      } else {
        // un jeton de branche (`<div>{else}</div>`) remonte jusqu'ici : il est nommé, plutôt qu'une balise dite
        // non fermée
        refuseJetonEtranger(res, `<${nomResolu}>`, tagLine, scanner)
        // reste 'end' ou `undefined` (fin de boucle sur `scanner.eos()`, cf. sa propre implémentation dans
        // `parse()`) : ce `else` est donc le cas EOF-sans-fermante. Avant ce garde-fou, `container.push`
        // suivait tel quel — la balise ouvrante partait avec TOUT LE RESTE DU DOCUMENT comme
        // descendants, sans un mot (même famille que parser.balise-fermante-orpheline, le cas
        // SYMÉTRIQUE : fermante sans ouvrante). Lève ICI, au niveau le plus PROFOND (cette balise
        // est la première dont le `parseChildren` local touche l'EOF) : la pile d'appel remonte
        // sans que les balises ouvrantes ENGLOBANTES n'aient la moindre chance de lever à leur
        // tour — le message cite donc naturellement la balise la plus profonde non fermée.
        throw new Error(t('parser.balise-non-fermee', { nom: nomResolu, ligne: tagLine }))
      }
      pushTag(container, node, choix)
    } else {
      // ni `/>` ni `>` : balise ouvrante jamais terminée (`<div class="x"` en dernière ligne, `>` oublié) — elle
      // disparaissait sans un mot
      throw new Error(t('parser.balise-ouvrante-non-terminee', { nom: rawName, ligne: tagLine }))
    }
    return true
  }

  return false
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

// parseComment — commentaire HTML `<!-- … -->` : bloc INERTE, consommé SANS produire de
// nœud (ni texte ni expr). Sans ce garde-fou, `<!--` retombait sur
// parseText (un `<` non suivi d'un tag/fermante reste du texte, cf. TEXT_RUN_RE) : le
// contenu s'affichait dans le DOM, marqueurs compris, et une `{` dedans ouvrait une VRAIE
// expression compilée. Multi-lignes : rien à compter à la main, `currentLine`/`lineAt`
// lisent `scanner.pos` sur la source ENTIÈRE (offsets déjà indexés, cf. lineOffsets).
//
// Dans un `<textarea>` ou un `<title>` HTML, le navigateur ne lit aucun commentaire : `<!-- … -->` y est un texte, gardé tel
// qu'écrit (une valeur `{…}` n'y est pas lue, comme dans un commentaire), jusqu'au `-->` sans dépasser la fermante de la
// balise ; un `<!--` sans fin y est un texte de quatre caractères
function parseComment(scanner: Scanner, container: Node[]): boolean {
  if (!scanner.check(/<!--/)) return false
  const startLine = currentLine(scanner)
  const debut     = scanner.pos
  const lu        = scanner.scan(/<!--(?:-?>|[\s\S]*?--!?>)/)
  if (texteSeul !== null) {
    if (lu === null || lu.toLowerCase().includes('</' + texteSeul)) scanner.pos = debut + 4
    const node = new Node('text')
    node.content = scanner.str.slice(debut, scanner.pos)
    node.line    = startLine
    container.push(node)
    return true
  }
  if (lu) return true
  throw new Error(t('parser.commentaire-non-ferme', { ligne: startLine }))
}

// `<![CDATA[…]]>` dans un `<svg>` ou un `<math>` : un texte pour le navigateur, jusqu'au `]]>` — un `<` n'y ouvre aucune
// balise, une accolade aucune valeur. Il part tel qu'écrit dans le gabarit, refermé ; sans `]]>`, il avalerait toute la
// suite du composant : refusé
function parseCdata(scanner: Scanner, container: Node[]): boolean {
  if (foreignTag === null || !scanner.check(/<!\[CDATA\[/)) return false
  const startLine = currentLine(scanner)
  const fin       = scanner.str.indexOf(']]>', scanner.pos + 9)
  if (fin === -1) throw new Error(t('parser.cdata-non-fermee', { ligne: startLine }))
  const node = new Node('text')
  node.content = scanner.str.slice(scanner.pos, fin + 3)
  node.line    = startLine
  container.push(node)
  scanner.pos = fin + 3
  return true
}

// le texte est la majorité du volume d'un template ; l'ancienne boucle
// le consommait caractère par caractère (un `getch()` + un `check()` — donc, avant
// le cache d'ancrage, une compilation de regex — PAR caractère). Un seul scan sticky
// équivalent supprime N allocations. Un `<` reste du texte SAUF s'il ouvre une
// balise (`<tag`, `</tag`, `<@…`) — négation EXACTE de l'ancien stop `<\/?[a-zA-Z@]`.
// `!--` AJOUTÉ à la négation : sans lui, un `<!--` précédé du moindre
// texte (donc jamais en toute première position, seul cas où `parseComment` l'attrapait
// AVANT que ce run ne démarre) se faisait avaler tel quel PAR CE RUN — `parseComment`
// n'avait alors plus jamais la main dessus, un `<!--` non refermé ne levait rien.
const TEXT_RUN_RE = /(?:[^{<]|<(?!\/?[a-zA-Z@]|!--))+/
// dans un <svg> ou un <math>, le texte s'arrête aussi à un `<![CDATA[` (cf. parseCdata)
const TEXT_RUN_FOREIGN_RE = /(?:[^{<]|<(?!\/?[a-zA-Z@]|!--|!\[CDATA\[))+/

function parseText(scanner: Scanner, container: Node[]): boolean {
  const startPos = scanner.pos
  const txt = scanner.scan(foreignTag === null ? TEXT_RUN_RE : TEXT_RUN_FOREIGN_RE)
  if (txt !== null && txt !== '') {
    const node = new Node('text')
    node.content = txt
    // le run avale le `\n` + l'indentation qui précèdent le texte VISIBLE : la
    // ligne du nœud est celle de son PREMIER caractère non blanc, pas celle d'AVANT ce blanc de
    // tête (sinon, en code indenté réel, un message d'erreur pointe la ligne PRÉCÉDENTE).
    const blanc = txt.match(/^\s*/)![0].length
    node.line = lineAt(scanner, startPos + blanc)
    container.push(node)
    return true
  }
  return false
}

// ============================================================================
// Fill blocks (bloc de slot) — passe après parse()
// ============================================================================
// sucre de COMPILATION, aucun changement du générateur ni du
// runtime : `<@fill nom>…</@fill>` (FILL_DIRECTIVE) se déplie en SES PROPRES ENFANTS, chacun
// porteur de `slot="nom"` (même attribut que l'idiome natif `slot="x"` posé à la main). Une fois
// cette passe tournée, le nœud `@fill` a disparu de l'arbre — tout le pipeline aval (generator,
// bundler) ne voit que des `tag` ordinaires.
//
// Choix : PASSE À PART (hoistFillBlocks), pas une branche de plus dans parseDom. parseDom gère
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
  const ligne = fillNode.line ?? 0
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
    const ligne = node.line ?? 0

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
// dans des blocs), l'analyse et la génération descendant d'un appel par niveau
export function pileDebordee(e: unknown): boolean {
  return e instanceof RangeError && /call stack/i.test(e.message)
}

export function parse(html: string, tagRefs?: TagRef[], diag: ParseDiag = {}): Node {
  const firstLine = diag.firstLine ?? 1
  const scanner   = new Scanner(expandLayoutBlocks(html.trim(), firstLine).trim(), firstLine)
  autoSkeleton = diag.autoSkeleton !== false
  foreignTag   = null
  texteSeul    = null
  fileModels   = { dev: diag.models?.dev ?? {}, core: diag.models?.core ?? {} }
  guarded      = new Set(diag.guarded ?? [])
  guardSilent  = diag.guardSilent === true

  const parseChildren: ChildrenParser = (container: Node[], inAwait = false) => {
    while (!scanner.eos()) {
      const posBefore = scanner.pos
      const status = parseFlow(scanner, container, parseChildren, inAwait) ||
                     parseComment(scanner, container) ||
                     parseCdata(scanner, container) ||
                     parseDom(scanner, container, parseChildren, tagRefs, diag) ||
                     parseText(scanner, container)
      if (typeof status === 'string') return status
      if (scanner.pos === posBefore) {
        const extrait = JSON.stringify(scanner.peek(80))
        throw new Error(t('parser.erreur-fatale', { extrait }))
      }
    }
    return undefined
  }

  const root = new Node('root')
  let res: string | undefined
  try {
    res = parseChildren(root.children)
  }
  catch (e) {
    // un appel par niveau d'imbrication : pile épuisée, la ligne où l'analyse s'est arrêtée
    if (pileDebordee(e)) throw new Error(t('parser.imbrication-trop-profonde', { ligne: currentLine(scanner) }))
    throw e
  }
  // une fermante orpheline au NIVEAU RACINE faisait remonter
  // `'close_tag'` que `parse()` IGNORAIT : tout ce qui suivait la fermante
  // disparaissait du composant en silence (motif « build vert, markup perdu »).
  // La fermante n'est jamais consommée par un parent → `scanner` est encore
  // dessus. On nomme la balise (consommation locale) pour un message parlant.
  if (res === 'close_tag' && !scanner.eos()) {
    const line = currentLine(scanner)
    const m = scanner.rest().match(/^<\/([a-zA-Z0-9\-@]+)\s*>/)
    const name = m ? m[1] : '?'
    throw new Error(t('parser.balise-fermante-orpheline', { nom: name, ligne: line }))
  }
  // MÊME famille que la fermante HTML orpheline ci-dessus : un jeton de flux en trop à la racine
  // (aucun {if}/{for}/{await}/{key} ouvrant) fait remonter son statut ('end', 'else', 'elsif',
  // 'success', 'error') que `parse()` ignorait aussi — tout ce qui suivait disparaissait. Le jeton
  // est déjà CONSOMMÉ (contrairement à close_tag) : `currentLine` après coup pointe sur sa ligne.
  // En toute fin de document, rien n'est perdu : avertissement seulement (bloc mal imbriqué, ex.
  // `{if $x}…{end}{end}`), jamais une erreur qui casserait un composant qui marche.
  const FLOW_TOKENS: Record<string, string> = { end: '{end}', else: '{else}', elsif: '{elsif …}', success: '{success …}', error: '{error …}' }
  if (typeof res === 'string' && FLOW_TOKENS[res]) {
    const vars = { jeton: FLOW_TOKENS[res], ligne: currentLine(scanner) }
    if (!scanner.eos()) throw new Error(t('parser.jeton-flux-orphelin', vars))
    const line = typedLine('syntax', t('parser.jeton-flux-orphelin-fin', vars), diag.lint)
    if (line !== null) printDiagnostic(line, diag.colorsEnabled ?? false)
  }
  hoistFillBlocks(root)
  return root
}
