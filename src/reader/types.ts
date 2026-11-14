// reader/types — les nœuds de l'arbre unique d'un fichier .mjs
// chaque nœud porte `debut` et `fin` : indices dans la source normalisée du fichier (BOM retiré, fins de ligne en
// `\n`), en unités UTF-16 comme les chaînes JavaScript ; ligne et colonne s'en déduisent (reader/positions.ts)

import type { Comment, Program } from 'acorn'
import type { TraceMap } from '@jridgewell/trace-mapping'

export interface Etendue {
  debut: number
  fin: number
}

// une faute de lecture, à sa place dans le fichier
export interface Diagnostic {
  message: string
  debut: number
  ligne: number
  colonne: number
  position: string                      // `fichier:ligne:colonne`
  // une balise jamais terminée parce que le guillemet d'une valeur n'est jamais refermé : ce guillemet et le début de son attribut
  guillemet?: { debut: number, attribut: number }
}

// ---------------------------------------------------------------- le code (lu par Civet, puis acorn)

// script : un bloc <script> ou un module entier ; expression : `{…}` du gabarit, valeur d'attribut, tête de bloc ;
// gestionnaire : la valeur `{…}` d'un geste (`@click={…}`), des instructions
export type ModeCode = 'script' | 'expression' | 'gestionnaire'

// un texte du code, séparé du code exactement : sa valeur (raccourcis rendus dans leur écriture) et l'indice du
// fichier où il s'ouvre (guillemet, barre de la regex, dièse ou barre du commentaire) ; null quand la carte de
// Civet ne le situe pas
export interface TexteDuCode {
  sorte: 'chaine' | 'regex' | 'gabarit' | 'commentaire'
  valeur: string
  debut: number | null
}

// un nom du code qui porte un raccourci de MJS (`$x`, `§x`, `@@x`, `#x`, `&id`, `µx`), dans son écriture
export interface NomDuCode {
  nom: string
  debut: number | null
}

// une directive écrite dans un script (`@import …`, `@i18n …`, `@persist …`, `@preload …` en tête de ligne)
export interface DirectiveDuCode {
  nom: string
  debut: number | null
}

// ce qu'il faut pour ramener une position du JavaScript produit au fichier : la carte de Civet et, par ligne du
// morceau donné à Civet, l'indice du fichier qui tombe sous sa colonne 0 (null : ligne ajoutée par le lecteur)
export interface CarteDuCode {
  bases: (number | null)[]
  trace: TraceMap
}

// dans un gabarit lu pour le compilateur (option `gabarit` du lecteur), le code est découpé sans être compilé : `js`,
// `ast`, `carte` et `erreur` restent nuls, la compilation du générateur le lit ensuite
export interface Code extends Etendue {
  sorte: 'code'
  mode: ModeCode
  js: string | null
  ast: Program | null                   // arbre ESTree tel qu'acorn le rend ; partagé par le cache : une passe ne le modifie pas
  commentaires: Comment[]
  textes: TexteDuCode[]
  noms: NomDuCode[]
  directives: DirectiveDuCode[]
  erreur: { message: string, debut: number } | null
  carte: CarteDuCode | null
}

// ---------------------------------------------------------------- le gabarit et les sections

export type FormeBalise = 'html' | 'projet' | 'coeur' | 'coeur-litteral' | 'mjs' | 'reservee'

export type ValeurAttribut = 'texte' | 'code' | 'brut' | 'nue' | 'effet'

// un attribut d'une balise ouvrante
// attribut : `nom`, `nom="texte {…}"`, `nom={…}`, `nom={{…}}` (HTML calculé), `nom=valeur` ; geste : `@click={…}` ;
// effet : `*nom.alias(réglages)` (réglages : du texte, jamais du code) ; classe : `:class{…}=…`, `:style.prop{…}=…` ;
// etalement : `{...x}` ; expression : `{…}` posé seul dans la balise
export interface AttributDeBalise extends Etendue {
  sorte: 'attribut' | 'geste' | 'effet' | 'classe' | 'etalement' | 'expression'
  nom: string | null
  valeur: ValeurAttribut | null
  code: Code | null
  interpolations: (Etendue & { code: Code | null })[]
  reglages: Etendue | null
}

export interface Fichier extends Etendue {
  sorte: 'fichier'
  chemin: string
  source: string
  debutsDeLigne: number[]
  enfants: Noeud[]
  codes: Code[]                         // tous les morceaux de code du fichier, dans l'ordre de lecture
  diagnostics: Diagnostic[]
}

// directive de racine, en tête de ligne, hors de tout élément (`@import …`, `@i18n …`, `@css …`, `@display …`)
export interface Directive extends Etendue {
  sorte: 'directive'
  nom: string
}

export interface Script extends Etendue {
  sorte: 'script'
  langue: string
  module: boolean
  attributs: string
  corps: Etendue
  code: Code | null
  nonLu: string | null                  // raison quand le corps n'est pas lu (langue sans lecteur)
}

// corps : du texte CSS ou Sass (son `@import` est une règle CSS, jamais une directive)
export interface Style extends Etendue {
  sorte: 'style'
  langue: string
  attributs: string
  corps: Etendue
}

// <theme>, <routes>, <vars>, <types>, <effects> : le corps, lu plus tard par la petite grammaire de chacune
export interface Section extends Etendue {
  sorte: 'section'
  nom: string
  attributs: string
  corps: Etendue
}

export interface Balise extends Etendue {
  sorte: 'balise'
  nom: string
  forme: FormeBalise
  attributs: AttributDeBalise[]
  enfants: Noeud[]
  autoFermante: boolean
  vide: boolean                         // balise raccourci jamais refermée : rendue vide, son contenu revient au parent
  finOuvrante: number                   // l'indice qui suit le `>` de la balise ouvrante
  fermeeParAncetre: number | null       // début de la fermante d'un ancêtre qui l'a refermée (`<li>`, `<p>`, `<@slot>` sans fermante)
  videeA: number | null                 // rendue vide : début de la fermante d'un ancêtre ou du jeton (`{end}`, une branche) qui l'a rendue vide, longueur du texte à sa fin
}

export interface Texte extends Etendue {
  sorte: 'texte'
}

export interface CommentaireHtml extends Etendue {
  sorte: 'commentaireHtml'
}

// `{…}` du gabarit ; brut : `{{…}}`, HTML calculé
export interface Expression extends Etendue {
  sorte: 'expression'
  brut: boolean
  code: Code | null
}

export interface Branche {
  sorte: 'alors' | 'elsif' | 'else' | 'success' | 'error'
  debut: number
  tete: Etendue                         // le dedans des accolades qui l'ouvrent (`elsif $b`, `success val` ; la tête du bloc pour `alors`)
  enfants: Noeud[]
  code: Code | null                     // la condition d'un {elsif}
}

// {if}, {? disposition}, {for x, i in liste by clé}, {await promesse *skeleton(…)}, {key …}, {const nom = …}
export interface Bloc extends Etendue {
  sorte: 'bloc'
  nom: string
  disposition: string | null
  variables: string | null              // les noms d'un {for}
  branches: Branche[]
  code: Code | null                     // la tête : condition, liste, promesse, clé de {key}, valeur de {const}
  cle: Code | null                      // la clé `by …` / `key=…` d'un {for}
  tete: Etendue                         // le dedans des accolades de la tête (`if $a`, `for x in $l by id`)
}

export interface Etalement extends Etendue {
  sorte: 'etalement'
  code: Code | null
}

export type Noeud = Fichier | Directive | Script | Style | Section | Balise | Texte | CommentaireHtml | Expression | Bloc | Etalement
