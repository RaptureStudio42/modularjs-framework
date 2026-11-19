// reader/types — les nœuds de l'arbre unique d'un fichier .mjs
// chaque nœud porte `debut` et `fin` : indices dans la source normalisée du fichier (BOM retiré, fins de ligne en
// `\n`), en unités UTF-16 comme les chaînes JavaScript ; ligne et colonne s'en déduisent (reader/positions.ts)

import type { Comment, Program } from 'acorn'
import type { TraceMap } from '@jridgewell/trace-mapping'

export interface Span {
  start: number
  end: number
}

// une faute de lecture, à sa place dans le fichier
export interface Diagnostic {
  message: string
  start: number
  line: number
  column: number
  position: string                      // `fichier:ligne:colonne`
  // une balise jamais terminée parce que le guillemet d'une valeur n'est jamais refermé : ce guillemet et le début de son attribut
  quote?: { start: number, attr: number }
}

// ---------------------------------------------------------------- le code (lu par Civet, puis acorn)

// script : un bloc <script> ou un module entier ; expression : `{…}` du gabarit, valeur d'attribut, tête de bloc ;
// gestionnaire : la valeur `{…}` d'un geste (`@click={…}`), des instructions
export type ModeCode = 'script' | 'expression' | 'handler'

// un texte du code, séparé du code exactement : sa valeur (raccourcis rendus dans leur écriture) et l'indice du
// fichier où il s'ouvre (guillemet, barre de la regex, dièse ou barre du commentaire) ; null quand la carte de
// Civet ne le situe pas
export interface CodeText {
  kind: 'string' | 'regex' | 'template' | 'comment'
  value: string
  start: number | null
}

// un nom du code qui porte un raccourci de MJS (`$x`, `§x`, `@@x`, `#x`, `&id`, `µx`), dans son écriture
export interface CodeName {
  name: string
  start: number | null
}

// une directive écrite dans un script (`@import …`, `@i18n …`, `@persist …`, `@preload …` en tête de ligne)
export interface CodeDirective {
  name: string
  start: number | null
}

// ce qu'il faut pour ramener une position du JavaScript produit au fichier : la carte de Civet et, par ligne du
// morceau donné à Civet, l'indice du fichier qui tombe sous sa colonne 0 (null : ligne ajoutée par le lecteur)
export interface CodeMap {
  bases: (number | null)[]
  trace: TraceMap
}

// dans un gabarit lu pour le compilateur (option `gabarit` du lecteur), le code est découpé sans être compilé : `js`,
// `ast`, `carte` et `erreur` restent nuls, la compilation du générateur le lit ensuite
export interface Code extends Span {
  kind: 'code'
  mode: ModeCode
  js: string | null
  ast: Program | null                   // arbre ESTree tel qu'acorn le rend ; partagé par le cache : une passe ne le modifie pas
  comments: Comment[]
  texts: CodeText[]
  names: CodeName[]
  directives: CodeDirective[]
  error: { message: string, start: number } | null
  map: CodeMap | null
}

// ---------------------------------------------------------------- le gabarit et les sections

export type TagShape = 'html' | 'project' | 'core' | 'core-literal' | 'mjs' | 'reserved'

export type AttrValue = 'text' | 'code' | 'raw' | 'bare' | 'effect'

// un attribut d'une balise ouvrante
// attribut : `nom`, `nom="texte {…}"`, `nom={…}`, `nom={{…}}` (HTML calculé), `nom=valeur` ; geste : `@click={…}` ;
// effet : `*nom.alias(réglages)` (réglages : du texte, jamais du code) ; classe : `:class{…}=…`, `:style.prop{…}=…` ;
// etalement : `{...x}` ; expression : `{…}` posé seul dans la balise
export interface TagAttr extends Span {
  kind: 'attribute' | 'gesture' | 'effect' | 'class' | 'spread' | 'expression'
  name: string | null
  value: AttrValue | null
  code: Code | null
  interpolations: (Span & { code: Code | null })[]
  settings: Span | null
}

export interface File extends Span {
  kind: 'file'
  path: string
  source: string
  lineStarts: number[]
  children: Node[]
  codes: Code[]                         // tous les morceaux de code du fichier, dans l'ordre de lecture
  diagnostics: Diagnostic[]
}

// directive de racine, en tête de ligne, hors de tout élément (`@import …`, `@i18n …`, `@css …`, `@display …`)
export interface Directive extends Span {
  kind: 'directive'
  name: string
}

export interface Script extends Span {
  kind: 'script'
  lang: string
  module: boolean
  attrs: string
  body: Span
  code: Code | null
  unread: string | null                  // raison quand le corps n'est pas lu (langue sans lecteur)
}

// corps : du texte CSS ou Sass (son `@import` est une règle CSS, jamais une directive)
export interface Style extends Span {
  kind: 'style'
  lang: string
  attrs: string
  body: Span
}

// <theme>, <routes>, <vars>, <types>, <effects> : le corps, lu plus tard par la petite grammaire de chacune
export interface Section extends Span {
  kind: 'section'
  name: string
  attrs: string
  body: Span
}

export interface Tag extends Span {
  kind: 'tag'
  name: string
  shape: TagShape
  attrs: TagAttr[]
  children: Node[]
  selfClosing: boolean
  empty: boolean                         // balise raccourci jamais refermée : rendue vide, son contenu revient au parent
  openingEnd: number                   // l'indice qui suit le `>` de la balise ouvrante
  closedByAncestor: number | null       // début de la fermante d'un ancêtre qui l'a refermée (`<li>`, `<p>`, `<@slot>` sans fermante)
  emptiedAt: number | null                 // rendue vide : début de la fermante d'un ancêtre ou du jeton (`{end}`, une branche) qui l'a rendue vide, longueur du texte à sa fin
}

export interface TextNode extends Span {
  kind: 'text'
}

export interface HtmlComment extends Span {
  kind: 'htmlComment'
}

// `{…}` du gabarit ; brut : `{{…}}`, HTML calculé
export interface Expression extends Span {
  kind: 'expression'
  raw: boolean
  code: Code | null
}

export interface Branch {
  kind: 'then' | 'elsif' | 'else' | 'success' | 'error'
  start: number
  head: Span                         // le dedans des accolades qui l'ouvrent (`elsif $b`, `success val` ; la tête du bloc pour `alors`)
  children: Node[]
  code: Code | null                     // la condition d'un {elsif}
}

// {if}, {? disposition}, {for x, i in liste by clé}, {await promesse *skeleton(…)}, {key …}, {const nom = …}
export interface Block extends Span {
  kind: 'block'
  name: string
  disposition: string | null
  variables: string | null              // les noms d'un {for}
  branches: Branch[]
  code: Code | null                     // la tête : condition, liste, promesse, clé de {key}, valeur de {const}
  key: Code | null                      // la clé `by …` / `key=…` d'un {for}
  head: Span                         // le dedans des accolades de la tête (`if $a`, `for x in $l by id`)
}

export interface Spread extends Span {
  kind: 'spread'
  code: Code | null
}

export type Node = File | Directive | Script | Style | Section | Tag | TextNode | HtmlComment | Expression | Block | Spread
