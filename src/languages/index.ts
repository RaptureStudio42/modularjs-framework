// Dispatcher de langages — pour les .mjs côté utilisateur.
//
// Le user déclare `<script lang="…">` (ou laisse vide pour fallback config).
// Chaque adapter compile son input vers du **JS standard** que le lexer
// ModularJS post-traite ensuite avec le sucre `$/§/§§/@@/@x`.

import type { LintToggles } from '../diagnostics.js'
import type { PassDeclarations } from './civet-declarations.js'

export type SupportedLang = 'civet' | 'coffee' | 'ts' | 'js'

export interface CompileSourceOpts {
  fileName?: string
  bare?: boolean
  /** réglages des avertissements typés (src/diagnostics.ts). Reçu par TOUS les adapters, même s'ils n'en émettent
   *  aucun : un paramètre PAR APPEL, jamais un état partagé entre deux compilations concurrentes. */
  lint?: LintToggles
  /** le terminal accepte-t-il la couleur — calculé une fois par le thread principal, cf.
   *  resolveColorsEnabled (src/diagnostics.ts). */
  colorsEnabled?: boolean
  /** refuse une variable nommée `eval`, `undefined`, d'un mot réservé… (Civet seulement) : le `<script>` et le
   *  `<script module>` d'un composant, jamais une expression du gabarit. */
  variableNames?: boolean
  /** noms que la passe de déclaration de ModularJS déclare elle-même au-dessus d'une branche (`x .= undefined`) : cette
   *  déclaration n'est pas comptée par le contrôle des noms ; l'affectation du script l'est, à sa ligne. */
  mjsDeclaredNames?: ReadonlySet<string>
  /** déclare un nom qu'une affectation lie sans déclaration (`o =` suivi de la valeur à la ligne d'après, affectation dans
   *  une expression), lu dans l'arbre de Civet, comme la passe de déclaration de ModularJS déclare la forme sur une ligne
   *  (Civet seulement). */
  declareAssignments?: boolean
  /** noms déclarés hors du script (variables du `<script module>` pour le `<script>`) : jamais redéclarés. */
  knownNames?: readonly string[]
  /** texte posé ensuite dans une fonction du composant (son `<script>`), où `this` désigne le composant : gardé tel quel, sans
   *  conversion de module (sous `format: 'esm'`, esbuild lisait un `this` du premier niveau comme l'objet `exports` d'un module
   *  CommonJS et posait un `export default` au milieu du composant) (TypeScript seulement). */
  inComponent?: boolean
  /** déclarations que la passe de déclaration de ModularJS a posées (ligne, noms) : l'arbre de Civet défait celles qu'il
   *  contredit (champ de classe, bloc `do`, première affectation plus haut) (Civet seulement). */
  passDeclarations?: PassDeclarations
  /** raccourcis de ModularJS posés dans l'arbre de Civet (reader/script.ts, prepareScript) : `verifier` sur la première
   *  lecture, `retoucher` juste avant la génération, qui rend le texte auquel la carte de source se rapporte ; `relire`
   *  rend l'erreur à lancer quand Civet refuse la première lecture (Civet seulement). */
  treeFixup?: { check: (ast: unknown, text: string) => void, fixup: (ast: unknown, text: string) => string, reread: (e: unknown) => Error }
}

/** Retour d'un adapter : le JS, plus sa carte de source v3 (JSON stringifié) si le
 * compilateur sait en produire une. `map` absent = pas de carte pour ce langage/appel
 * (ex. adapter `js`, pur passe-plat). */
export interface CompileResult {
  code: string
  map?: string
}

export interface LanguageAdapter {
  name: SupportedLang
  /** Source originale → JS standard (pas encore traité par lexer ModularJS) */
  compileToJs(source: string, opts?: CompileSourceOpts): CompileResult | Promise<CompileResult>
}

import { civetAdapter } from './civet.js'
import { coffeeAdapter } from './coffee.js'
import { tsAdapter } from './typescript.js'
import { jsAdapter } from './javascript.js'
import { t } from '../messages/index.js'

export const adapters: Record<SupportedLang, LanguageAdapter> = {
  civet: civetAdapter,
  coffee: coffeeAdapter,
  ts: tsAdapter,
  js: jsAdapter,
}

/** Récupère l'adapter pour un langage. Throws si inconnu. */
export function getAdapter(lang: SupportedLang | string): LanguageAdapter {
  const a = adapters[lang as SupportedLang]
  if (!a) {
    throw new Error(t('languages.language-unknown', { lang, supported: Object.keys(adapters).join(', ') }))
  }
  return a
}

/** Auto-détection du langage : priorité = lang attribut → config projet → default 'civet' */
export function resolveLang(scriptLangAttr: string | null, projectDefault?: SupportedLang): SupportedLang {
  if (scriptLangAttr) return scriptLangAttr as SupportedLang
  if (projectDefault) return projectDefault
  return 'civet'
}
