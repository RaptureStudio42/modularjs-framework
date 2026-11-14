// cli/check-json — `mjs check --json` (et l'outil `compile_component` de `mjs mcp`) : les erreurs et les avertissements du
// compilateur rendus en objets, pour un assistant d'IA ou un outil. Les messages restent ceux du terminal : le compilateur
// les écrit en texte (fichier et ligne dans la phrase, étiquette `[lint.<type>]` en fin de ligne), ce module les relit.
// Chaque champ qu'il ne sait pas tirer du texte vaut `null` — jamais une ligne ou un fichier deviné : `message` garde
// toujours le texte entier (d'une exception, son message seul : la pile reste au terminal, sans `--json`). Pendant la
// vérification, la console et les deux flux sont capturés (la sortie standard ne porte que le document JSON) ; le document
// part à la sortie du processus, refus avant compilation compris, en entier même dans un tube

import { existsSync, readdirSync, statSync, realpathSync, writeSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { format } from 'node:util'
import { isClassFile, isModuleFile } from '../bundler/class-files.js'
import { isEffectsFile } from '../bundler/effects-files.js'
import { isThemeFile } from '../bundler/themes.js'
import { isTypesFile } from '../bundler/types-files.js'
import { LINT_SEVERITY, type LintType } from '../diagnostics.js'

export interface Diagnostic {
  severity: 'error' | 'warning' | 'info'
  /** le `<type>` de l'étiquette `[lint.<type>]`, `null` sans étiquette (toute erreur) */
  type:     string | null
  /** relatif à la racine du projet, séparateur `/` */
  file:     string | null
  line:     number | null
  column:   number | null
  message:  string
  /** ce qu'il faut écrire, quand le message le dit */
  fix:      string | null
}

export interface DiagnosticContext {
  root:  string
  /** nom de composant → fichier absolu (`null` : deux fichiers pour ce nom) */
  files: Map<string, string | null>
}

export interface CapturedLine { stream: 'out' | 'err', text: string }

const ANSI_RE    = /\x1b\[[0-9;]*m/g
const LABEL_RE   = /\s*\[lint\.([A-Za-z0-9]+)\]\s*$/
const PATH_RE    = /^\[bundler\] (.+?\.(?:mjs|civet|coffee|sass|scss|css|json|ts|js|ya?ml)) ?: ([\s\S]*)$/
const DECOR_RE   = /^(?:\s+|\[(?:bundler|ModularJS)\]|⚠️|⚠|❌|🚨|ℹ️)+/u
const MODULE_RE  = /^'([^'\n]+)' : /
const NAME_RE    = /^([A-Za-z0-9_][\w.-]*)(?: \((?:ligne|line) \d+\))? ?: /
const ABS_RE     = /(?<![\w.-])(\/[^\s'"«»()`,;]+\.(?:mjs|civet|coffee|sass|scss|css))(?::(\d+)(?::(\d+))?)?/
const POSITION_RE = /(?:^|[\s'"«(])((?:\.{1,2}\/)?(?:[\w.-]+\/)*[\w.-]+\.mjs):(\d+):(\d+)\b/
const LINE_RE    = /\b(?:[Ll]igne|[Ll]ine) (\d+)/
const PARTIAL_RE = /\b(?:[Ll]igne|[Ll]ine) (\d+) (?:de|of) ((?:\.{1,2}\/)?(?:[\w.-]+\/)*[\w.-]+\.mjs)\b/
const COL_RE     = /\b(?:colonne|column) (\d+)/
const GUESS_RE   = /(?:vouliez-vous (?:écrire|dire)|did you mean(?: to write)?) [«“"] ?([^»”"\n]+?) ?[»”"]/i
const TIP_RE     = /👉 (?:Astuce|Tip) ?: ([\s\S]+)$/
const VERB_RE    = /(?:^|— |; |: |\. |\n)((?:écrivez|ajoutez|utilisez|remplacez|retirez|fermez|déclarez|renommez|mettez|placez|passez|lancez|corrigez|supprimez|gardez|déplacez|importez|write|add|use|replace|remove|close|declare|rename|put|place|pass|run|fix|delete|keep|move|import)\b[^\n]*?)(?:\.(?=\s|$)|$)/imu

function rel(root: string, file: string): string {
  return relative(root, file).split(sep).join('/')
}

// « ce qu'il faut écrire » : le mot proposé, l'astuce, ou la proposition qui commence par un verbe à l'impératif
function fixOf(message: string): string | null {
  const guess = GUESS_RE.exec(message)
  if (guess) return guess[1].trim()
  const tip = TIP_RE.exec(message)
  if (tip) return tip[1].replace(/\s+/g, ' ').trim()
  const verb = VERB_RE.exec(message)
  return verb ? verb[1].trim() : null
}

// le fichier d'un partiel cité par son chemin depuis le dossier du composant qui le verse
function partialFile(file: string | null, path: string, ctx: DiagnosticContext): string | null {
  if (file !== null) return resolve(dirname(file), path)
  const found = new Set([...ctx.files.values()].flatMap((f) => (f === null ? [] : [resolve(dirname(f), path)])).filter((f) => existsSync(f)))
  return found.size === 1 ? [...found][0] : null
}

/** une ligne du compilateur (erreur ou avertissement) en objet */
export function toDiagnostic(raw: string, severity: 'error' | 'warning', ctx: DiagnosticContext): Diagnostic {
  let text    = raw.replace(ANSI_RE, '').trim()
  let type    = null as string | null
  const label = LABEL_RE.exec(text)
  if (label) {
    type = label[1]
    text = text.slice(0, label.index).trimEnd()
  }
  let file       = null as string | null
  let line       = null as number | null
  let column     = null as number | null
  const withPath = PATH_RE.exec(text)
  if (withPath) {
    file = resolve(ctx.root, withPath[1])
    text = withPath[2].trim()
  }
  text = text.replace(DECOR_RE, '')
  const module = MODULE_RE.exec(text)
  if (module) {
    file ??= ctx.files.get(module[1]) ?? null
    text   = text.slice(module[0].length).replace(DECOR_RE, '')
  }
  if (file === null) {
    const name = NAME_RE.exec(text)
    if (name) file = ctx.files.get(name[1]) ?? null
  }
  if (file === null) {
    const abs = ABS_RE.exec(text)
    if (abs) {
      file = abs[1]
      if (abs[2]) line = Number(abs[2])
      if (abs[3]) column = Number(abs[3])
    }
  }
  // `menu.mjs:3:1`, `_bas.mjs:3:5` : la position d'une faute du code, dans le composant ou dans le partiel qu'il inclut (chemin
  // depuis le dossier du composant)
  const position = POSITION_RE.exec(text)
  if (position && file !== null) {
    if (position[1] !== basename(file)) file = resolve(dirname(file), position[1])
    line   = Number(position[2])
    column = Number(position[3])
  }
  else if (line === null) {
    // « ligne 2 de _haut.mjs » : une ligne écrite dans un partiel, son chemin pris depuis le dossier du composant ; composant
    // inconnu, depuis celui des composants qui seul a ce partiel
    const simple  = LINE_RE.exec(text)
    const partial = PARTIAL_RE.exec(text)
    const l       = partial !== null && (simple === null || simple.index >= partial.index) ? partial : simple
    if (l !== null && l === partial) file = partialFile(file, partial[2], ctx)
    if (l) line = Number(l[1])
    const c = COL_RE.exec(text)
    if (c && line !== null) column = Number(c[1])
  }
  const level = type !== null && severity === 'warning' ? (LINT_SEVERITY[type as LintType] ?? 'warning') : severity
  return { severity: level, type, file: file === null ? null : rel(ctx.root, file), line, column, message: text, fix: fixOf(text) }
}

/** les fichiers que nomme une ligne du compilateur, en chemins absolus : celui qui la porte (`[bundler] chemin : …`) et celui de la
 *  position qu'elle cite quand c'en est un autre (`sous/_bloc.mjs:3:1` : un partiel, son chemin pris depuis le dossier du premier) */
export function filesOf(raw: string, root: string): string[] {
  const withPath = PATH_RE.exec(raw.replace(ANSI_RE, '').trim())
  if (withPath === null) return []
  const file     = resolve(root, withPath[1])
  const position = POSITION_RE.exec(withPath[2])
  return position === null || position[1] === basename(file) ? [file] : [file, resolve(dirname(file), position[1])]
}

// un modèle en fichier : `carte.compacte.mjs` (ou `carte.compacte.page.mjs`) est le modèle « compacte » du composant `carte`, et son
// composant s'appelle `carte--compacte`. Même règle de nom que la construction (bundler/index.ts : MODEL_FILE_NAME_RE,
// collectFileModels), après ce qu'elle trie avant les composants : thème, règles, effets, classe globale, module de script
const MODEL_FILE_RE = /^([a-z][a-z0-9-]*)\.([a-z][a-z0-9-]*)$/

/** le modèle en fichier que nomme `nom` (`carte.compacte.mjs` : composant `carte`, modèle `compacte`), `null` pour tout autre */
export function fileModel(nom: string): { base: string, model: string } | null {
  if (isThemeFile(nom) || isTypesFile(nom) || isEffectsFile(nom) || isClassFile(nom) || isModuleFile(nom)) return null
  const m = MODEL_FILE_RE.exec(basename(nom, '.mjs').replace(/\.page$/, ''))
  return m !== null && m[2] !== 'page' ? { base: m[1], model: m[2] } : null
}

/** les composants sous `sourceDir` : nom → fichier ; un nom porté par deux fichiers vaut `null`. Le nom est celui que donne la
 *  construction : le fichier sans `.mjs` ni `.page`, et `carte--compacte` pour le modèle en fichier `carte.compacte.mjs` — sauf
 *  un modèle nommé « default » ou sans son composant, que la construction refuse. Les autres fichiers dont le nom garde un point
 *  (`*.theme.mjs`, `*.types.mjs`, `*.effects.mjs`, `Nom.class.mjs`, `*.civet.mjs`…) ne sont pas des composants. Même parcours
 *  que le constructeur : liens suivis, cycles fermés, fichiers cachés et `node_modules` sautés */
export function componentFiles(sourceDir: string): Map<string, string | null> {
  const out  = new Map<string, string | null>()
  const base = new Map<string, string>()
  const pile = [sourceDir]
  const vus  = new Set<string>()
  while (pile.length > 0) {
    const dir = pile.pop()!
    let reel: string
    try { reel = realpathSync(dir) } catch { continue }
    if (vus.has(reel)) continue
    vus.add(reel)
    let noms: string[]
    try { noms = readdirSync(dir) } catch { continue }
    for (const nom of noms.sort()) {
      if (nom.startsWith('.') || nom === 'node_modules') continue
      const chemin   = join(dir, nom)
      let estDossier = false
      try { estDossier = statSync(chemin).isDirectory() } catch { continue }
      if (estDossier) { pile.push(chemin); continue }
      if (!nom.endsWith('.mjs')) continue
      const model = fileModel(nom)
      const name  = model !== null ? `${model.base}--${model.model}` : basename(nom, '.mjs').replace(/\.page$/, '')
      if (name === '' || name.includes('.') || model?.model === 'default') continue
      if (model !== null) base.set(name, model.base)
      out.set(name, out.has(name) ? null : chemin)
    }
  }
  // un modèle sans son composant n'est pas un composant du projet
  for (const [name, composant] of base) if (!out.has(composant)) out.delete(name)
  return out
}

// ce qu'une écriture sur un flux du processus porte, en texte
function textOf(chunk: unknown): string {
  return typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf-8')
}

/** capture la console et les deux flux du processus ; `restore()` rend les originaux */
export function captureOutput(): { lines: CapturedLine[], restore: () => void } {
  const lines = [] as CapturedLine[]
  const saved = { log: console.log, info: console.info, debug: console.debug, warn: console.warn, error: console.error, out: process.stdout.write, err: process.stderr.write }
  // une exception donne son message, pas sa pile (`format` les écrirait toutes deux)
  const texte = (a: unknown) => (a instanceof Error ? (a.name === 'Error' ? a.message : `${a.name}: ${a.message}`) : a)
  const push  = (stream: 'out' | 'err') => (...args: unknown[]) => { lines.push({ stream, text: format(...args.map(texte)) }) }
  const write = (stream: 'out' | 'err') => ((chunk: unknown, ...rest: unknown[]) => {
    lines.push({ stream, text: textOf(chunk) })
    const done = rest.find((r) => typeof r === 'function') as (() => void) | undefined
    if (done) done()
    return true
  }) as typeof process.stdout.write
  console.log   = push('out')
  console.info  = push('out')
  console.debug = push('out')
  console.warn  = push('err')
  console.error = push('err')
  process.stdout.write = write('out')
  process.stderr.write = write('err')
  return {
    lines,
    restore: () => {
      Object.assign(console, { log: saved.log, info: saved.info, debug: saved.debug, warn: saved.warn, error: saved.error })
      process.stdout.write = saved.out
      process.stderr.write = saved.err
    },
  }
}

// une ligne capturée est un avertissement quand elle porte une étiquette ou commence par ⚠️ (décor `[bundler]` admis)
function isWarningLine(text: string): boolean {
  const clean = text.replace(ANSI_RE, '').trim()
  return LABEL_RE.test(clean) || /^(?:\[(?:bundler|ModularJS)\]\s*)*⚠/u.test(clean)
}

// une écriture sur la sortie d'erreur qui donne une entrée d'avertissement : le document de `--json` et le bilan du terminal
// comptent les mêmes
const NO_PROJECT: DiagnosticContext = { root: sep, files: new Map() }
function givesWarning(text: string): boolean {
  return isWarningLine(text) && toDiagnostic(text, 'warning', NO_PROJECT).message !== ''
}

/** les erreurs et les avertissements d'une vérification, en objets : autant d'entrées que le terminal écrit de lignes. Le
 *  résultat de la compilation (`extra`) en donne une par erreur et par avertissement de son bilan — la même faute dans trois
 *  fichiers, trois entrées. Chaque avertissement écrit sur la sortie d'erreur pendant la compilation (ceux que le bilan ne
 *  reprend pas : accessibilité, formulaires…) en donne une de plus, deux quand il est écrit deux fois (deux champs sans
 *  étiquette sur une même ligne). Sans résultat (refus avant compilation), les autres lignes de la sortie d'erreur sont les
 *  erreurs, une seule fois chacune (même message, même fichier et même ligne quand les deux les donnent) */
export function diagnosticsOf(captured: CapturedLine[], ctx: DiagnosticContext, extra: { errors?: string[], warnings?: string[] } = {}): { errors: Diagnostic[], warnings: Diagnostic[] } {
  const errors   = [] as Diagnostic[]
  const warnings = [] as Diagnostic[]
  const meme     = (a: Diagnostic, b: Diagnostic) => a.message === b.message && (a.file === b.file || a.file === null || b.file === null) && (a.line === b.line || a.line === null || b.line === null)
  const add      = (raw: string, severity: 'error' | 'warning', unique = false) => {
    const d     = toDiagnostic(raw, severity, ctx)
    const liste = severity === 'error' ? errors : warnings
    if (d.message === '' || (unique && liste.some((x) => meme(x, d)))) return
    liste.push(d)
  }
  for (const e of extra.errors ?? []) add(e, 'error')
  for (const w of extra.warnings ?? []) add(w, 'warning')
  for (const c of captured) {
    if (c.stream !== 'err') continue
    if (isWarningLine(c.text)) add(c.text, 'warning')
    else if (extra.errors === undefined) add(c.text, 'error', true)
  }
  return { errors, warnings }
}

/** compte les avertissements écrits sur la sortie d'erreur, sans rien retenir ni changer à ce qui s'écrit : le bilan du
 *  terminal annonce ainsi le nombre d'entrées que rend `mjs check --json`. Une écriture compte pour un avertissement au plus,
 *  comme une ligne capturée — un `console.warn`, ou la ligne d'un fil d'exécution, arrive en une écriture */
export function countWarningLines(): { count: () => number, stop: () => void } {
  const original = process.stderr.write
  let n          = 0
  const tee      = ((chunk: unknown, ...rest: unknown[]) => {
    if (givesWarning(textOf(chunk))) n++
    return original.call(process.stderr, chunk as string, ...(rest as []))
  }) as typeof process.stderr.write
  process.stderr.write = tee
  return { count: () => n, stop: () => { if (process.stderr.write === tee) process.stderr.write = original } }
}

// tout le texte, même dans un tube : `writeSync` peut n'en écrire qu'une partie (tube plein, sortie non bloquante) — on
// reprend où il s'est arrêté, le temps que le lecteur vide le tube ; un lecteur parti (EPIPE) arrête l'écriture
function writeAllSync(fd: number, text: string): void {
  const buf   = Buffer.from(text, 'utf-8')
  const pause = new Int32Array(new SharedArrayBuffer(4))
  let fait    = 0
  while (fait < buf.length) {
    try { fait += writeSync(fd, buf, fait, buf.length - fait) }
    catch (e: any) {
      if (e?.code === 'EPIPE') return
      if (e?.code !== 'EAGAIN') throw e
      Atomics.wait(pause, 0, 0, 2)
    }
  }
}

export interface CheckResult {
  components: string[]
  errors:     string[]
  warnings:   string[]
  derived?:   { file: string, name: string, class: string, reasons: { code: string, name: string, by?: string }[] }[]
}

/** `mjs check --json` : capture posée tout de suite, document écrit à la sortie du processus (un `process.exit` d'une
 *  garde avant compilation compris) — `setResult` le remplit avec le résultat de la compilation quand elle a eu lieu */
export function startCheckJson(version: string | null): { setProject: (root: string, sourceDir: string) => void, setResult: (r: CheckResult) => void } {
  const capture = captureOutput()
  let root      = process.cwd()
  let sourceDir = null as string | null
  let result    = null as CheckResult | null
  let written   = false
  process.once('exit', (code) => {
    if (written) return
    written = true
    capture.restore()
    const ctx   = { root, files: sourceDir === null ? new Map<string, string | null>() : componentFiles(sourceDir) }
    const diags = diagnosticsOf(capture.lines, ctx, result === null ? {} : { errors: result.errors, warnings: result.warnings })
    // échec sans un mot sur la sortie d'erreur : dit quand même, jamais un « ok » faux
    if (code !== 0 && diags.errors.length === 0) diags.errors.push({ severity: 'error', type: null, file: null, line: null, column: null, message: `mjs check : code ${code}`, fix: null })
    // `components` : les composants du projet seulement — le manifeste porte aussi les classes globales, les modules de script et les alias courts
    const report: Record<string, unknown> = { format: 1, mjs: version, ok: code === 0 && diags.errors.length === 0, root, components: (result?.components ?? []).filter((c) => ctx.files.has(c) && !c.startsWith('_')), errors: diags.errors, warnings: diags.warnings }
    if (result?.derived) report.derived = result.derived
    writeAllSync(1, JSON.stringify(report, null, 2) + '\n')
  })
  return {
    setProject: (r, s) => { root = r; sourceDir = s },
    setResult:  (r) => { result = r },
  }
}
