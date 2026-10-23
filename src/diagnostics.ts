// diagnostics — source UNIQUE des types d'avertissement du build (`lint.<type>`), de leur
// gravité et des couleurs terminal. Racine `src/` (à côté de sigils.ts/mask.ts) : importé par
// config (validation + doc), bundler (émission), transpiler (émission, sites qui tournent en
// thread de travail) et cli (impression). Un type ajouté, retiré ou dont la gravité change ne se
// touche qu'ICI — config.ts (KNOWN_LINT_KEYS), le rapport final et docs/32 en dérivent.
//
// `stats.warnings` (bundler/index.ts) reste du TEXTE SANS couleur (tests et outils le lisent) :
// seule l'ÉTIQUETTE `[lint.<type>]` s'y ajoute, à l'émission. La couleur ne s'ajoute qu'à
// l'IMPRESSION terminal (paintDiagnostic/paintError), jamais avant.

/** un type par avertissement de build, coupable via `"lint": { "<type>": false }`. */
export type LintType =
  | 'a11y'
  | 'ujsForm'
  | 'maxStateVars'
  | 'themeShared'
  | 'themeUnknown'
  | 'runtimeHint'
  | 'runtimeModule'
  | 'i18n'
  | 'cssSplit'
  | 'cssTrap'
  | 'collision'
  | 'tagAlias'
  | 'animation'
  | 'componentFailure'
  | 'precache'
  | 'prerender'
  | 'image'
  | 'require'
  | 'include'
  | 'routes'
  | 'syntax'
  | 'reactivity'
  | 'naming'
  | 'events'
  | 'legacy'
  | 'config'
  | 'emptyComponent'

/** gravité d'un TYPE lint — jamais 'error' : une erreur de build fait échouer `mjs build`, elle
 *  n'est ni typée ni coupable (cf. paintError ci-dessous, pour ELLE seule). */
export type LintSeverity = 'warning' | 'info'

/** réglages `lint` résolus (mjs.config.json → resolveBundlerOpts) : clé absente ou `true` =
 *  actif (défaut), `false` = coupé. `maxStateVars` reste un entier à part (cf. LintConfig,
 *  bundler/config.ts) — MÊME forme ici, pour accepter `config.lint` tel quel (un seul bag,
 *  jamais un sous-ensemble reconstruit à la main). `emptyComponent` accepte aussi `'error'` :
 *  l'avertissement devient une erreur de build (bundler, fin de compile). */
export type LintToggles = Partial<Record<Exclude<LintType, 'maxStateVars' | 'emptyComponent'>, boolean>> & { maxStateVars?: number, emptyComponent?: boolean | 'error' }

/** gravité de chaque type — le tableau des types de docs/32-cli-et-configuration.md en dérive. */
export const LINT_SEVERITY: Record<LintType, LintSeverity> = {
  a11y:             'warning',
  ujsForm:          'warning',
  maxStateVars:     'info',
  themeShared:      'info',
  themeUnknown:     'warning',
  runtimeHint:      'info',
  runtimeModule:    'warning',
  i18n:             'warning',
  cssSplit:         'info',
  cssTrap:          'warning',
  collision:        'warning',
  tagAlias:         'warning',
  animation:        'warning',
  componentFailure: 'warning',
  precache:         'warning',
  prerender:        'warning',
  image:            'warning',
  require:          'warning',
  include:          'warning',
  routes:           'warning',
  syntax:           'warning',
  reactivity:       'warning',
  naming:           'warning',
  events:           'warning',
  legacy:           'warning',
  config:           'warning',
  emptyComponent:   'warning',
}

/** ordre de déclaration ci-dessus — une seule liste, consultée par la validation de config ET
 *  par tout ce qui doit énumérer les types (doc, rapport). */
export const LINT_TYPES = Object.keys(LINT_SEVERITY) as LintType[]

// un type explicitement à `false` coupe — absent ou `true` reste actif (défaut)
function lintTypeEnabled(lint: LintToggles | undefined, type: LintType): boolean {
  return lint?.[type] !== false
}

/** ligne d'avertissement étiquetée `[lint.<type>]`, texte BRUT (jamais de couleur — cf.
 *  paintDiagnostic) — `null` si ce type est coupé par `lint.<type>: false`. `lint` omis (a11y,
 *  ujsForm, maxStateVars : déjà gatés par leur propre réglage dédié, cf. transpiler/index.ts)
 *  → toujours étiqueté, jamais coupé ici. */
export function typedLine(type: LintType, message: string, lint?: LintToggles): string | null {
  if (!lintTypeEnabled(lint, type)) return null
  return `${message} [lint.${type}]`
}

const RESET = '\x1b[0m'
const DIM   = '\x1b[2m'
const SEVERITY_COLOR: Record<'error' | LintSeverity, string> = {
  error:   '\x1b[31m',
  warning: '\x1b[33m',
  info:    '\x1b[36m',
}

// capture le corps + l'étiquette `[lint.type]` en fin de ligne (espace insécable exclu, une
// étiquette est toujours posée par typedLine ci-dessus, jamais tapée à la main ailleurs)
const LABELLED_LINE_RE = /^([\s\S]*) (\[lint\.([a-zA-Z0-9]+)\])$/

/**
 * Colore une ligne DÉJÀ FORMÉE (label compris) pour le terminal — corps selon la gravité du
 * type, étiquette grisée. Une ligne sans étiquette reconnue (message interne ou fatal, jamais
 * typé) ressort TELLE QUELLE, jamais colorée au hasard. `colorsEnabled` vient de
 * `resolveColorsEnabled()` ci-dessous, calculé UNE fois dans le thread principal.
 */
export function paintDiagnostic(line: string, colorsEnabled: boolean): string {
  if (!colorsEnabled) return line
  const m = LABELLED_LINE_RE.exec(line)
  if (!m) return line
  const severity = LINT_SEVERITY[m[3] as LintType]
  if (!severity) return line
  return `${SEVERITY_COLOR[severity]}${m[1]}${RESET} ${DIM}${m[2]}${RESET}`
}

// lignes étiquetées imprimées par CE thread — chaque thread de travail a son propre compte, que
// transpileFromMsg (bundler/transpile-msg.ts) rend au thread principal avec son résultat : la CLI
// sait ainsi s'il faut sa ligne d'aide, même quand seuls des threads de travail ont parlé
let printedTyped = 0

/** Imprime une ligne d'avertissement (colorée si le terminal l'accepte) et compte les lignes
 *  étiquetées — le seul chemin d'impression des avertissements typés. */
export function printDiagnostic(line: string, colorsEnabled: boolean): void {
  console.warn(paintDiagnostic(line, colorsEnabled))
  if (LABELLED_LINE_RE.test(line)) printedTyped++
}

/** Nombre de lignes étiquetées imprimées par ce thread depuis son démarrage. */
export function printedTypedLines(): number {
  return printedTyped
}

/** message d'ERREUR de build (celles qui font échouer `mjs build`) — jamais typé/coupable,
 *  coloré en rouge à l'impression seulement (cli.ts, boucle `stats.errors`). */
export function paintError(message: string, colorsEnabled: boolean): string {
  return colorsEnabled ? `${SEVERITY_COLOR.error}${message}${RESET}` : message
}

/**
 * Calcule UNE fois si le terminal accepte la couleur — thread PRINCIPAL seulement (un thread de
 * travail n'est jamais un terminal), le résultat voyage ensuite par les options (bundler →
 * transpiler, cf. leurs TranspileOpts/BundlerOpts respectifs). Mêmes règles que la console de
 * Node : `FORCE_COLOR` tranche d'abord, dans les deux sens (vide, `1`, `2`, `3`, `true` allument,
 * toute autre valeur — `0`, `false` — éteint) ; sinon `NO_COLOR` non vide et `TERM=dumb`
 * éteignent ; sinon `isTTY`. Paramètres injectables pour les tests (jamais de lecture directe de
 * `process.env` en dehors du défaut).
 */
export function resolveColorsEnabled(env: NodeJS.ProcessEnv = process.env, isTTY: boolean = !!process.stderr.isTTY): boolean {
  if (env.FORCE_COLOR !== undefined) return ['', '1', '2', '3', 'true'].includes(env.FORCE_COLOR)
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false
  if (env.TERM === 'dumb') return false
  return isTTY
}
