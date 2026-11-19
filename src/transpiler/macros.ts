// transpiler/macros — port de <@include name> et <@window/document/body/head>
// (features V1 manquantes en V2 standard).
//
// <@include name>            → inline un partial `_<name>.mjs`. Résolution :
//                              1. local : `<baseDir>/_<name>.mjs`
//                              2. fallback : `<sourceDir>/shared/_<name>.mjs`
// <@include ../path/name>    → chemin relatif STRICT (pas de fallback). Permet
//                              de pointer un partial dans un autre dossier sans
//                              ambiguïté ; si introuvable → erreur explicite.
// Slash final (`<@include name/>`) interdit : erreur de compilation —
// voir processIncludes.
// <@window @event={...}>     → bind global event sur window/document/body/head
//                              (attache au réveil, teardown auto chaîné sur le
//                              hook sleep via l'API interne _mjs_hook)

import { readFileSync, existsSync, realpathSync } from 'node:fs'
import { join, dirname, resolve, basename, isAbsolute, sep, relative } from 'node:path'
import { extractSections, braceEnds, attrValueMask, type SectionsResult } from './sections.js'
import { maskHtmlComments, maskNonCode, createMaskTable, readHtmlComment } from '../mask.js'
import { dedent } from '../generator/state.js'
import { alignsOnFirstLine, unlessFollowedBySemicolon } from '../generator/utils.js'
import { t } from '../messages/index.js'
import { SIGN, SIGN_RE, written } from '../parser/mjs-words.js'
import { typedLine, type LintToggles } from '../diagnostics.js'
import { asciiLower, findMacroTagEnd } from './macro-tag.js'
import { lintSplitRune } from './split-rune.js'
import { parseEffect, effectSpec, removedEffectError } from '../effects/catalog.js'
import { aliasExample } from '../effects/aliases-mjs.js'
import { settingsComment } from '../effects/settings-comment.js'
import { AT_RESERVED_NAMES, expandLayoutBlocks, extractBalanced, readBracesBackward, resolveTagName, Scanner, LINE_CARRIER_OPEN, LINE_CARRIER_RE, type TagRef, type TagRefAttrs } from '../parser/index.js'
import { BROWSER_FUNCTIONS, DECLARABLE_KEYWORDS, HANDLER_REFERENCE_RE, LANGUAGE_KEYWORDS, type HandlerReference } from '../handler-reference.js'
import { readFile, traverse, type TagAttr, type Tag, type Span, type File } from '../reader/index.js'
import { OUTSIDE_MARKUP, imgTagsInBlock } from './img-tag.js'
import { tagsOf, readComponent, nameOf, valueOf } from './template-tree.js'

export interface IncludeAccumulator {
  /** CSS partials inlinés (concaténé au <style> du parent). */
  css: string[]
  /** Sections <script> partials (concaténées au <script> du parent). */
  script: string[]
  /** Sections <script module> partials. */
  module: string[]
  /** Cache : nom de partial → résolu (évite double-include). */
  resolved: Set<string>
  /** partiels locaux absents qu'un partiel de shared/ remplace : dépendances de l'unité */
  absents?: Set<string>
  /** Clés en cours d'expansion (garde anti-<@include> circulaire). */
  expanding?: Set<string>
  /** partial introuvable / <@include>
   * circulaire : jusqu'ici seulement un `console.error` DANS LE WORKER
   * (transpile() tourne dans un worker_threads séparé, cf. bundler/worker.ts)
   * — le message atteint bien le terminal (stdout/stderr hérité), mais
   * jamais `stats.errors`/`stats.warnings` du bundler : `mjs build` continue
   * de rapporter un succès (exit 0), un pipeline CI qui ne grep pas les logs
   * bruts (juste le code de sortie) ne voit JAMAIS le problème — alors qu'un
   * `<@include>` manquant laisse le composant réellement INCOMPLET. Accumulé
   * ici et propagé via `TranspileData.macroErrors` jusqu'au bundler. */
  errors: string[]
  /** un partial avec un 2e
   * `<script>`/`<style>` voyait ce contenu silencieusement jeté par
   * `extractSections` (seul le 1er de chaque catégorie était gardé). Non
   * fatal (contrairement à `errors`) : propagé via `TranspileData.sectionWarnings`. */
  warnings: string[]
  /** PERF — cache readFileSync+extractSections par path résolu (durée de
   * vie = un transpile) : un même partial inclus N fois n'est lu/parsé qu'UNE
   * fois (avant : N lectures disque + N re-parses + N warnings dupliqués). */
  htmlCache: Map<string, SectionsResult>
  /** la table des lignes du HTML rendu par processIncludes (index k : sa ligne k) : une erreur trouvée dans ce HTML cite
   * la ligne du composant, ou sa ligne dans le partiel qui l'écrit, avec son fichier */
  places?: LinePlace[]
  /** le fichier de chaque partiel dont le script (`script`, `module`, même rang) est versé, et la ligne où ce script commence :
   *  une faute de Civet y est citée à sa ligne dans le partiel */
  scriptPlaces?: Array<{ file: string; line: number }>
  modulePlaces?: Array<{ file: string; line: number }>
  /** le dossier du composant (cf. processIncludes) : un message cite un partiel par son chemin depuis lui */
  root?: string
}

// la place d'une ligne du HTML où les partiels sont versés : le fichier qui l'écrit (null : le composant ; sinon le chemin
// du partiel), sa ligne dans ce fichier, et la ligne du composant qui la porte ou qui verse son partiel ; `suite` : les
// morceaux posés plus loin sur la même ligne (le texte du composant qui reprend après un `<@include>`, un partiel versé au
// milieu d'une ligne), chacun à son indice `at` dans la ligne, avec sa place et sa colonne dans la ligne écrite
export interface LinePlace { file: string | null; line: number; host: number; rest?: LineRun[] }
export interface LineRun { at: number; file: string | null; line: number; host: number; column: number }

// un HTML et sa table des lignes
interface Placed { html: string; places: LinePlace[] }

export function newIncludeAccumulator(): IncludeAccumulator {
  return { css: [], script: [], module: [], resolved: new Set(), errors: [], warnings: [], htmlCache: new Map() }
}

// la ligne k (0 : la première) d'un HTML où des partiels sont versés, citée : sa ligne du composant, ou sa ligne dans le
// partiel qui l'écrit, avec son fichier ; hors de la table (aucun partiel lu), la ligne comptée depuis `firstLine`
export function citeLine(places: LinePlace[] | undefined, firstLine: number, k: number): number | string {
  const place = places?.[k]
  if (!place) return firstLine + k
  return place.file === null ? place.line : t('transpiler.partial-line', { line: place.line, file: place.file })
}

// ----------------------------------------------------------------------------
// processIncludes : remplace <@include name> dans le HTML par le template
// du partial, et accumule css/script/module dans `acc`.
// ----------------------------------------------------------------------------
// Les balises `<@include …>` sont lues dans l'arbre du gabarit (readIncludes, plus bas) : jamais dans une valeur
// d'attribut ni une chaîne d'expression. La forme accepte soit un nom simple (`header`, `nav-bar`), soit un chemin
// relatif (`../shared/header`, `./sub/foo`). Les deux formes restent
// distinguables : présence de `/` ou `.` au début → chemin relatif strict.
// La forme documentée est SANS slash final (`<@include header>`) : groupe 1
// (nom/chemin) capturé en PARESSEUX, groupe 2 capture À PART un éventuel `/`
// final — ce slash traînant est rejeté par
// processIncludes (erreur de compilation) au lieu d'être avalé dans le nom.
// bundler/index.ts (preResolveAssets) descend dans les <@include> AVANT l'envoi au worker, avec la même lecture
// (includeTargets) et la même résolution (resolvePartial ci-dessous) que l'inlining réel.

// assertPartialUnder — confinement <@include> : un `../` répété dans un
// chemin relatif STRICT résolvait n'importe où sur le disque, sans garde — `<@include
// ../../../etc/passwd>` inlinait tel quel le contenu d'un fichier hors sourceDir dans le
// composant compilé (prouvé : SECRET-CONTENT-HORS retrouvé dans le bundle émis). Même
// confinement à double étage que `assertRealUnder` côté bundler (bundler/index.ts) : LEXICAL
// d'abord (le `..` peut sortir sans qu'aucun symlink n'existe), puis RÉEL par realpathSync si
// le fichier existe (un lien posé DANS sourceDir peut pointer dehors).
function assertPartialUnder(abs: string, sourceDir: string, rawTarget: string): void {
  const root = resolve(sourceDir)
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error(t('transpiler.include-outside-root', { target: rawTarget, path: abs }))
  }
  if (existsSync(abs)) {
    const realAbs = realpathSync(abs)
    const realRoot = realpathSync(root)
    if (realAbs !== realRoot && !realAbs.startsWith(realRoot + sep)) {
      throw new Error(t('transpiler.include-outside-root', { target: rawTarget, path: realAbs }))
    }
  }
}

export function resolvePartial(
  rawTarget: string,
  baseDir: string,
  sourceDir: string | undefined
): { path: string; key: string } | null {
  const isRelative = rawTarget.includes('/') || rawTarget.startsWith('.')
  if (isRelative) {
    // Chemin relatif STRICT : pas de fallback. Le `_` du préfixe est ajouté
    // au dernier segment seulement (`shared/header` → `shared/_header.mjs`).
    const dir = dirname(rawTarget)
    const name = basename(rawTarget)
    const rel = dir === '.' ? `_${name}.mjs` : `${dir}/_${name}.mjs`
    const abs = isAbsolute(rel) ? rel : resolve(baseDir, rel)
    // confinement à sourceDir (EB) : seulement si connu — un appelant sans sourceDir
    // (transpile() isolé, hors bundler) garde l'ancien comportement, non exposé au disque public.
    if (sourceDir) assertPartialUnder(abs, sourceDir, rawTarget)
    if (!existsSync(abs)) return null
    return { path: abs, key: abs }
  }
  // Nom simple : local d'abord, puis fallback `<sourceDir>/shared/`.
  const local = join(baseDir, `_${rawTarget}.mjs`)
  // même confinement que le chemin relatif : un lien posé dans les sources ne fait pas inclure un fichier du dehors
  if (existsSync(local)) { if (sourceDir) assertPartialUnder(local, sourceDir, rawTarget); return { path: local, key: local } }
  if (sourceDir) {
    const shared = join(sourceDir, 'shared', `_${rawTarget}.mjs`)
    if (existsSync(shared)) { assertPartialUnder(shared, sourceDir, rawTarget); return { path: shared, key: shared } }
  }
  return null
}

export function processIncludes(
  html: string,
  baseDir: string | undefined,
  acc: IncludeAccumulator,
  sourceDir?: string,
  // `firstLine` : la ligne du fichier où commence `html` (1 par défaut), première ligne de la table des lignes (acc.places)
  lint: { sigil?: string, scriptLang?: string, moduleLang?: string, firstLine?: number } = {},
  // coupe individuellement l'avertissement `[lint.include]` ci-dessous (mjs.config.json
  // `lint.include`) — SANS RAPPORT avec `lint` ci-dessus (sigil/langue des sections incluses)
  lintTypes?: LintToggles
): string {
  acc.root     = baseDir
  const placed = includeInto(html, baseDir, acc, sourceDir, lint, lintTypes, null, lint.firstLine ?? 1)
  acc.places   = placed.places
  return placed.html
}

// processIncludes sur un HTML écrit dans `file` (null : le composant) à partir de sa ligne `firstLine` : le HTML rendu et
// sa table des lignes, les partiels versés à toute profondeur
function includeInto(
  html: string,
  baseDir: string | undefined,
  acc: IncludeAccumulator,
  sourceDir: string | undefined,
  lint: { sigil?: string, scriptLang?: string, moduleLang?: string },
  lintTypes: LintToggles | undefined,
  file: string | null,
  firstLine: number
): Placed {
  if (!baseDir) {
    // Sans baseDir on ne peut pas trouver les fichiers partials → retiré, mais SIGNALÉ
    // (avant : strip totalement silencieux, cf. plus haut).
    return replaceIncludes(html, true, acc.errors, file, firstLine, (target) => {
      const w = typedLine('include', t('transpiler.include-no-basedir', { target }), lintTypes)
      if (w !== null) acc.warnings.push(w)
      return ''
    })
  }
  // PERF — lit+parse un partial UNE seule fois par transpile (cache par
  // path résolu). Un partial inclus N fois ne refait pas N readFileSync +
  // N extractSections. `acc.htmlCache` est fourni par newIncludeAccumulator ;
  // fallback défensif pour un accumulateur construit à la main.
  const cache = acc.htmlCache ?? (acc.htmlCache = new Map())
  // DURCI — un doublon de section (2e <script>/<script module>/<style>)
  // lève désormais une ERREUR depuis extractSections (avant : simple warning, qui
  // gagnait son contexte via le `acc.warnings.push(...)` préfixé plus bas). Un
  // throw brut, lui, ne nommerait que le composant PARENT (celui que le bundler
  // compile), jamais le partial fautif — re-throw préfixé du `<@include ${target}>`
  // pour restaurer la même précision (couvre aussi un readFileSync qui échoue).
  const getSections = (partialPath: string, target: string): SectionsResult => {
    let s = cache.get(partialPath)
    if (!s) {
      try {
        // fins de ligne `\r\n` ramenées à `\n`, comme celles du composant (transpile) : le script et le gabarit du partiel se lisent,
        // et ses fautes se situent, sur les lignes du fichier
        s = extractSections(readFileSync(partialPath, 'utf-8').replace(/\r\n?/g, '\n'))
        if (s.vars || s.types.length > 0 || s.effects.length > 0) throw new Error(t('transpiler.include-vars'))
        // les blocs `{? nom}` du partiel, vérifiés ici : une faute y est citée à sa ligne du partiel, avec son chemin depuis le
        // dossier du composant ; le HTML recollé dans le composant n'a plus les lignes du fichier (le résultat n'est pas gardé)
        const file = relative(acc.root ?? baseDir, partialPath)
        expandLayoutBlocks(s.html, s.htmlStartLine, (line) => t('transpiler.partial-line', { line: line, file: file }))
      } catch (e: any) {
        throw new Error(`<@include ${target}> : ${e?.message ?? e}`)
      }
      cache.set(partialPath, s)
    }
    return s
  }
  return replaceIncludes(html, true, acc.errors, file, firstLine, (target, selfClose) => {
    // slash final interdit, même canal d'erreur que partial introuvable
    if (selfClose === '/' || target.endsWith('/')) {
      const clean = target.replace(/\/+$/, '')
      const msg = t('transpiler.include-slash-final-forbidden', { target, selfClose, clean })
      // eslint-disable-next-line no-console
      console.error(`[ModularJS] ❌ ${msg}`)
      acc.errors.push(msg)
      return ''
    }
    const resolved = resolvePartial(target, baseDir, sourceDir)
    if (!resolved) {
      const msg = t('transpiler.include-partial-not-found', { target, baseDir })
      // eslint-disable-next-line no-console
      console.error(`[ModularJS] ❌ ${msg}`)
      acc.errors.push(msg)
      return ''
    }
    const { path: partialPath, key } = resolved
    // partiel pris dans shared/ : un partiel local du même nom, absent aujourd'hui, le remplacerait — il compte dans les dépendances
    if (!target.includes('/') && !target.startsWith('.') && dirname(partialPath) !== resolve(baseDir)) (acc.absents ??= new Set<string>()).add(join(baseDir, `_${target}.mjs`))
    const label = basename(target)

    if (acc.resolved.has(key)) {
      // Déjà inliné ailleurs — on ré-inclut le HTML (pas les assets), MAIS en
      // résolvant aussi SES <@include> imbriqués : avant, ils restaient BRUTS
      // dans le DOM final (tag <@include> inconnu, silencieux). Garde
      // anti-cycle : A→B→A s'arrête avec une erreur claire au lieu de boucler.
      if (acc.expanding?.has(key)) {
        const msg = t('transpiler.include-circular', { target })
        // eslint-disable-next-line no-console
        console.error(`[ModularJS] ❌ ${msg}`)
        acc.errors.push(msg)
        return ''
      }
      // Sections en cache ; on ne re-pousse PAS les warnings du partial (déjà
      // signalés à sa 1ʳᵉ inclusion — évite les doublons).
      const sections = getSections(partialPath, target)
      acc.expanding = acc.expanding ?? new Set()
      acc.expanding.add(key)
      try {
        return includeInto(sections.html, dirname(partialPath), acc, sourceDir, lint, lintTypes, partialPath, sections.htmlStartLine)
      } finally {
        acc.expanding.delete(key)
      }
    }
    acc.resolved.add(key)

    const sections = getSections(partialPath, target)
    for (const w of sections.warnings) acc.warnings.push(`<@include ${target}> : ${w}`)
    // rune séparée de son symbole dans le script du partiel : même refus que dans le composant hôte (cf.
    // split-rune.ts), situé sur la ligne du fichier partiel ; lu dans la langue du script hôte, qui le reçoit et
    // le compile, pas dans celle que le partiel déclare ou hérite par défaut
    lintSplitRune(sections.script.raw, `${basename(partialPath)} <script>`, { sigil: lint.sigil, firstLine: sections.script.startLine, lang: lint.scriptLang ?? sections.script.lang })
    lintSplitRune(sections.module.raw, `${basename(partialPath)} <script module>`, { sigil: lint.sigil, firstLine: sections.module.startLine, lang: lint.moduleLang ?? sections.module.lang })

    if (sections.style.raw.trim() !== '') {
      // balise le bloc avec le lang RÉEL du
      // partial (sections.style.lang, déjà résolu par extractSections : son
      // lang= propre, ou le défaut projet si absent — même résolution qu'un
      // composant normal, rien de réinventé ici). AVANT : texte brut nu,
      // fusionné plus loin (transpiler/index.ts) avec le SEUL lang de l'hôte
      // → un partiel `lang="css"` dans un hôte SASS indenté (le défaut)
      // faisait échouer TOUT le build (« Expected newline »). compileCss
      // (transpiler/css.ts) déballe ce balisage et compile CE bloc avec CE
      // lang si le lang de l'hôte diffère — fusion consciente au lieu d'une
      // concaténation de sources hétérogènes compilées avec un lang unique.
      // `\x00…\x00` : NUL pré-existants neutralisés À
      // L'ENTRÉE (ici côté partial, transpiler/index.ts côté hôte) → par
      // construction les SEULS `\x00` du texte fusionné sont NOS marqueurs.
      // Jamais un caractère utile en CSS/SASS (la tokenisation CSS remplace
      // U+0000 par U+FFFD) : le strip est sémantiquement sans perte.
      // `acc.css` reste un `string[]` ordinaire, aucun contrat à changer
      // côté transpileur.
      const cleanStyle = sections.style.raw.includes('\x00') ? sections.style.raw.replace(/\x00/g, '') : sections.style.raw
      acc.css.push(`\x00MJSSTYLE:${sections.style.lang}\x00/* --- Partial: ${label} --- */\n${cleanStyle}\x00MJSENDSTYLE\x00`)
    }
    // la ligne qui nomme le partiel en tête de son script, versé à celui de l'hôte après le retrait des commentaires
    // (removeComments) : écrite dans le commentaire du langage de l'hôte, `#` en CoffeeScript et `//` ailleurs (ce que
    // le balayeur des commentaires fait d'un `#`) ; un `#` y serait du code (`.length`) pour la lecture du script par
    // l'arbre, qui n'attend aucun commentaire dans le script d'un composant
    const header = (lang: string | undefined, name: string): string => `${lang === 'coffee' ? '#' : '//'} --- ${name}: ${label} ---`
    if (sections.module.raw.trim() !== '') {
      acc.module.push(`${header(lint.moduleLang, 'Partial Module')}\n${dedentCode(sections.module.raw, lint.moduleLang ?? sections.module.lang)}`)
      acc.modulePlaces ??= []
      acc.modulePlaces.push({ file: partialPath, line: sections.module.startLine })
    }
    if (sections.script.raw.trim() !== '') {
      acc.script.push(`${header(lint.scriptLang, 'Partial')}\n${dedentCode(sections.script.raw, lint.scriptLang ?? sections.script.lang)}`)
      acc.scriptPlaces ??= []
      acc.scriptPlaces.push({ file: partialPath, line: sections.script.startLine })
    }

    // Récursion : un partial peut lui-même <@include …>
    return includeInto(sections.html, dirname(partialPath), acc, sourceDir, lint, lintTypes, partialPath, sections.htmlStartLine)
  })
}

// le script d'un partiel sans son retrait commun, mesuré sur ses lignes de code seulement : une ligne qui commence dans une
// chaîne (gabarit `…`, chaîne sur deux lignes, bloc """) ou un commentaire n'en est pas une, et ne perd que le retrait commun
// de toutes les lignes, comme avant (le texte d'une chaîne ne change pas). Versé après le script du composant, un script
// resté en retrait continuerait sa dernière instruction (`$n = 1` devenait l'appel `1(…)`)
function dedentCode(src: string, lang: string | undefined): string {
  const code    = maskNonCode(src, lang)
  const lines   = src.split('\n')
  const ducode  = lines.map(() => false)
  let margin    = Infinity
  let at        = 0
  lines.forEach((l, i) => {
    const k = l.search(/\S/)
    if (k >= 0 && code[at + k] !== ' ') {
      ducode[i] = true
      margin    = Math.min(margin, k)
    }
    at += l.length + 1
  })
  if (margin === Infinity || margin === 0) return dedent(src)
  const common = Math.min(...lines.filter((l) => l.trim() !== '').map((l) => l.search(/\S/)))
  return lines.map((l, i) => l.slice(Math.min(ducode[i] ? margin : common, l.search(/\S|$/)))).join('\n')
}

// la forme stricte d'une balise `<@include …>` lue dans l'arbre : le chemin (paresseux), puis un éventuel slash final,
// refusé par processIncludes
const INCLUDE_FORM = /^<@include\s+([./\w-]+?)\s*(\/?)>$/i

// les `<@include …>` d'un HTML de composant ou de partiel, lus dans son arbre (partiels pas encore versés) : chaque
// balise `<@include…>` (`<@include-x>` aussi, mal formée ; `<@includex>` non), et le texte d'une telle balise dans un
// <textarea> ou un <title>, où le partiel versé devient du texte ; jamais une valeur d'attribut ni une chaîne
// d'expression (les commentaires HTML sont déjà retirés par extractSections) ; `dialecte` : gabarit en Civet ou en
// CoffeeScript, où une regex se passe sans parenthèses (comme pour le parseur)
function readIncludes(html: string, dialect: boolean): Array<{ start: number, end: number }> {
  const found: Array<{ start: number, end: number }> = []
  traverse(readFile(html, { template: true, partial: true, dialect }), (n) => {
    if (n.kind === 'tag' && /^@include\b/i.test(n.name)) found.push({ start: n.start, end: n.openingEnd })
    else if (n.kind === 'text' && /^<@include\b/i.test(html.slice(n.start, n.end))) found.push({ start: n.start, end: n.end })
  })
  return found
}

// les chemins des `<@include chemin>` d'un gabarit, lus dans son arbre comme processIncludes les lit (slash final compris)
export function includeTargets(html: string, dialect: boolean): string[] {
  const targets: string[] = []
  for (const { start, end } of readIncludes(html, dialect)) {
    const m = INCLUDE_FORM.exec(html.slice(start, end))
    if (m) targets.push(m[1])
  }
  return targets
}

// remplace chaque `<@include chemin>` de l'arbre par `build(chemin, slash final)` ; une balise mal formée reste telle
// quelle, signalée une fois le texte rendu, son extrait lu à sa place dans ce texte. Rend aussi la table des lignes du
// texte rendu : une ligne a la place du texte qui l'ouvre (celui de `html`, écrit dans `file` à partir de sa ligne
// `firstLine`, ou celui d'un partiel versé, dont la ligne du composant devient celle de son `<@include>`)
function replaceIncludes(html: string, dialect: boolean, errors: string[], file: string | null, firstLine: number, build: (target: string, selfClose: string) => string | Placed): Placed {
  const malformed: number[]     = []
  const places: LinePlace[]     = []
  const own = (k: number): LinePlace => ({ file, line: firstLine + k, host: firstLine + k })
  let out  = ''
  let pos  = 0
  let line = 0
  // pose un morceau de texte, la place de sa ligne j donnée par `of` : sa première ligne continue celle qui est ouverte, où
  // elle note où elle commence (indice dans la ligne, colonne `column` dans la ligne écrite), une ligne vide en fin de
  // morceau reste ouverte au suivant
  const put = (text: string, of: (j: number) => LinePlace, column = 1): void => {
    if (text === '') return
    const lines = text.split('\n')
    if (out === '' || out.endsWith('\n')) places.push(of(0))
    else {
      const open                = places[places.length - 1]
      const at                  = out.length - out.lastIndexOf('\n') - 1
      const first               = of(0)
      places[places.length - 1] = { ...open, rest: [...(open.rest ?? []), { at, file: first.file, line: first.line, host: first.host, column }, ...(first.rest ?? []).map((r) => ({ ...r, at: r.at + at }))] }
    }
    const last = text.endsWith('\n') ? lines.length - 1 : lines.length
    for (let j = 1; j < last; j++) places.push(of(j))
    out += text
  }
  // un morceau de `html` (de `from` à `to`), ses lignes comptées depuis la ligne `line` de `html`
  const putOwn = (from: number, to: number): void => {
    const first = line
    put(html.slice(from, to), (j) => own(first + j), from - html.lastIndexOf('\n', from - 1))
    line += countNewlines(html.slice(from, to))
  }
  for (const { start, end } of readIncludes(html, dialect)) {
    const m = INCLUDE_FORM.exec(html.slice(start, end))
    putOwn(pos, start)
    if (m) {
      const built = build(m[1], m[2])
      const host  = own(line).host
      if (typeof built === 'string') put(built, () => own(line))
      else put(built.html, (j) => ({ ...built.places[j], host }))
      line += countNewlines(html.slice(start, end))
    }
    else {
      malformed.push(out.length)
      putOwn(start, end)
    }
    pos = end
  }
  putOwn(pos, html.length)
  if (out === '' || out.endsWith('\n')) places.push(own(line))
  for (const at of malformed) reportMalformedInclude(errors, out, at)
  return { html: out, places }
}

// reportMalformedInclude — une balise <@include qui ne correspond pas à la forme stricte
// <@include chemin> (attributs, chemin absent, chevrons manquants) restait
// du texte INERTE dans la page, sans un mot (`<@include foo
// titre="a">` traversait tel quel jusqu'au HTML rendu, silence total).
// Appelée par replaceIncludes, une fois le texte rendu (le slash final interdit a son propre canal
// d'erreur). Même dédoublonnage par texte EXACT que reportUnclosedMacroTag
// (macros.ts) : un même message n'est donné qu'une fois.
function reportMalformedInclude(errors: string[], html: string, idx: number): void {
  const excerpt = Array.from(html.slice(idx, idx + 120)).slice(0, 60).join('').replace(/\n/g, ' ')
  const msg = t('transpiler.include-malformed', { excerpt: excerpt })
  if (errors.includes(msg)) return
  // eslint-disable-next-line no-console
  console.error(`[ModularJS] ❌ ${msg}`)
  errors.push(msg)
}

// ----------------------------------------------------------------------------
// processGlobalMacros : strip <@window @event={...}> etc. du HTML et retourne
// le code Coffee à appender au <script> pour bind/unbind les listeners.
// ----------------------------------------------------------------------------
export interface GlobalMacrosResult {
  /** HTML nettoyé des macros. */
  html: string
  /** Code Coffee de setup (à appender au <script>). */
  setup: string
  /** Code Coffee de teardown (chaîné sur le hook sleep via _mjs_hook). */
  teardown: string
  /** Erreurs de compile des liaisons class/style (@class{…}/@style.prop/--var/
   * class=/style= hors <@body>/<@html>, style inline statique, interpolation
   * dans class= …) — même canal que les erreurs de <@include>, fusionné dans
   * `TranspileData.macroErrors` ; le bundler fait déjà échouer le build si
   * non vide (bundler/index.ts). */
  errors: string[]
  /** Avertissements (non fatals) : un `<script>` exécutable écrit dans <@head>, que le navigateur n'exécutera jamais —
   * versés dans `TranspileData.sectionWarnings`, comme ceux des sections. */
  warnings: string[]
  /** les effets en direct de <@document> qui prennent leur connexion dans `@sock` (aucune écrite) : le
   * <script> du composant doit le poser — vérifié par le transpileur, une fois le script compilé */
  docSock: string[]
  /** un alias d'effet de l'appli (`*ripple.rouge`) posé sur <@document> : le composant dépend du fichier qui le déclare */
  usesProjectEffects: boolean
  /** les gestionnaires faits d'un nom seul dans le fallback d'un <@failed> et sur les balises globales (`@click=nom`), vérifiés par le transpileur une fois
   * les noms du <script> connus (cf. checkHandlerReferences) */
  handlerRefs: HandlerReference[]
  /** les balises du fallback d'un <@failed>, nommées comme partout ailleurs (cf. fallbackTags) : des références aux modules cœur et
   *  aux composants, que le gabarit compilé ne relève pas (ce fallback ne passe pas par lui), versées à celles du composant pour que la
   *  construction livre les modules et vérifie les composants */
  tagRefs: TagRef[]
  /** d'où vient chaque ligne de `setup` (même rang que ses lignes, la première après le saut de ligne de tête) écrite par
   *  l'auteur, celle du corps d'un gestionnaire (`<@window @resize={…}>`) : une faute de Civet y est citée à sa place */
  setupOrigins: Array<SetupOrigin | undefined>
  /** chaque gestionnaire écrit entre accolades : le nom de sa fonction dans le script (`_gl_0`) et la place de son corps — resté
   *  ouvert (`@resize={$x = 1 +}`), il avale la ligne qui le referme dans le script, refusé par le transpileur */
  setupHandlers: Array<{ fn: string; origin: SetupOrigin }>
}

// une ligne du corps d'un gestionnaire versé au script : le HTML lu (`html`, ses lignes celles du HTML reçu), l'indice où le
// corps écrit (`body`) y commence, et le rang de la ligne dans ce corps
export interface SetupOrigin { html: string; at: number; body: string; row: number }

// les effets qui se posent sur <@document> : ceux de toute la page (la souris, la langue, les autres visiteurs)
const DOC_EFFECTS = ['ripple', 'lang', 'cursors', 'offline', 'react', 'follow', 'heatmap', 'pointer', 'spotlight']

const TARGETS: Record<string, string> = {
  window:   'window',
  document: 'document',
  body:     'document.body',
  html:     'document.documentElement',
  head:     'document.head',
}

// Propriétés de `window` LIABLES en deux-sens via `prop=!{$var}` sur <@window>
// (équivalent des `bind:scrollY` / `bind:innerWidth` / … de <svelte:window>).
//   read   : expression de lecture (valeur initiale + à chaque event)
//   events : événements window qui rafraîchissent la liaison
//   write  : (scroll seulement) statement Civet qui POUSSE la var vers window
//            quand elle change (liaison réellement two-way). Gardé par un test
//            d'égalité → scroll programmatique OK, pas de boucle sur le scroll
//            utilisateur (scrollTo à la position courante = no-op).
const WINDOW_BINDABLE: Record<string, { read: string; events: string[]; write?: (v: string) => string }> = {
  scrollX:          { read: 'window.scrollX', events: ['scroll'], write: v => `if window.scrollX != (${v}) then window.scrollTo(${v}, window.scrollY)` },
  scrollY:          { read: 'window.scrollY', events: ['scroll'], write: v => `if window.scrollY != (${v}) then window.scrollTo(window.scrollX, ${v})` },
  innerWidth:       { read: 'window.innerWidth', events: ['resize'] },
  innerHeight:      { read: 'window.innerHeight', events: ['resize'] },
  outerWidth:       { read: 'window.outerWidth', events: ['resize'] },
  outerHeight:      { read: 'window.outerHeight', events: ['resize'] },
  devicePixelRatio: { read: 'window.devicePixelRatio', events: ['resize'] },
  online:           { read: 'navigator.onLine', events: ['online', 'offline'] },
}

// Échappe une portion HTML LITTÉRALE pour l'émettre en chaîne Civet simple-quote.
// On utilise des simple-quotes pour que les guillemets HTML (`href="…"`) ne
// nécessitent AUCUN échappement, et on concatène les expressions à part.
function quoteHeadLiteral(str: string): string {
  // sauts de ligne RÉELS → séquence d'échappement `\n` (littéral Civet à guillemets simples :
  // `'a\nb'` reste un VRAI saut de ligne une fois ÉVALUÉ) — AVANT, `\s+` → ' ' les écrasait, et
  // un commentaire `//` juste avant avalait la ligne suivante (silencieux). Tabulations et
  // espaces multiples restent réduits à un seul espace (comportement conservé pour le reste).
  const esc = str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r\n|\r|\n/g, '\\n').replace(/[ \t]+/g, ' ')
  return `'${esc}'`
}

// États rendus par tagPositions. ST_TAG, ST_BARE et ST_TAG_NAME sont les trois positions où une
// interpolation est REFUSÉE ; ST_AUTOQUOTE est la seule que le compilateur enveloppe de guillemets
// (cf. buildHeadInjection).
const ST_TEXT      = 0   // hors balise
const ST_TAG       = 1   // structure d'une balise : nom, nom d'attribut, blancs, `=`, guillemets, `>`
const ST_QUOTED    = 2   // intérieur d'une valeur d'attribut entre guillemets
const ST_COMMENT   = 3   // commentaire `<!-- -->`
const ST_TAG_NAME  = 4   // expression en position de NOM DE BALISE (`<{$tag}>`)
const ST_BARE      = 5   // intérieur d'une valeur d'attribut NUE (sans guillemets)
const ST_AUTOQUOTE = 6   // expression qui EST la valeur (premier caractère non blank après le `=`)

// Blanc au sens HTML5 (espace, tabulation, saut de ligne, saut de page, retour chariot) — et RIEN
// d'autre : `\s` en JavaScript y ajoute l'espace insécable, le BOM et U+2028, que le tokeniseur d'un
// navigateur traite comme des caractères ORDINAIRES. Les confondre faisait lire `a=\u00a0"{$x}"` comme
// une valeur quotée là où le navigateur commence une valeur NUE à l'insécable.
function isHtmlSpace(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\f' || c === '\r'
}

// la lecture sans accolade intérieure, gardée pour une interpolation qui ne se referme pas (cf. headInterpolationAt)
const HEAD_EXPR_FLAT = /\{\{([^{}]+)\}\}|\{([^{}]+)\}/y

// une interpolation lue : de son accolade ouvrante (`at`) à juste après sa dernière fermante (`end`) ; `raw` pour `{{…}}`
interface HeadInterp {
  at: number
  end: number
  raw: boolean
  body: string
}

// la lecture d'une accolade : son contenu et la position qui suit sa fermante, `null` si elle ne se referme pas
type BraceReader = (at: number) => { body: string; end: number } | null

// les accolades de `str`, lues à la demande comme dans le reste du gabarit (extractBalanced). À la première qui ne se referme pas, le texte
// est relu une fois de la dernière accolade à la première (readBracesBackward, la lecture du reste du gabarit quand une accolade reste
// ouverte), et chaque accolade y est connue : chaque accolade seule relisait tout le reste du texte (temps quadratique, des secondes pour
// quelques milliers)
function braceReader(str: string): BraceReader {
  const scanner = new Scanner(str)
  let all: Map<number, { body: string; end: number } | null> | null = null
  return (at) => {
    if (all) return all.get(at) ?? null
    scanner.pos = at + 1
    try {
      const body = extractBalanced(scanner, '}')
      return { body, end: scanner.pos }
    }
    catch {
      all = readBracesBackward(str)
      return null
    }
  }
}

// l'interpolation `{…}` ou `{{…}}` qui s'ouvre en `at` de `str`, lue par `lue` comme dans le reste du gabarit (extractBalanced : accolades
// imbriquées, chaînes, commentaires, regex) : `<title>{µt('k', { n: 1 })}</title>` est UNE expression ; lue jusqu'à la première accolade
// fermante, elle laissait `{µt('k', ` en texte et rendait l'objet seul (`[object Object]`), et une chaîne qui contient `}` cassait la
// construction. `{{…}}` est essayé d'abord et demande ses deux accolades fermantes, comme dans le gabarit (sinon le `{…}` intérieur était
// pris seul et les deux accolades extérieures restaient en texte). Une lecture qui ne se referme pas (accolade ou chaîne jamais fermée)
// garde la lecture sans accolade intérieure : une faute de frappe y fait toujours échouer la construction, une accolade seule reste du
// texte. `null` : aucune interpolation en `at`
function headInterpolationAt(read: BraceReader, str: string, at: number): HeadInterp | null {
  if (str.startsWith('{{', at)) {
    const inside = read(at + 1)
    if (inside && str[inside.end] === '}') return { at, end: inside.end + 1, raw: true, body: inside.body }
  }
  const readResult = read(at)
  if (readResult) return { at, end: readResult.end, raw: false, body: readResult.body }
  HEAD_EXPR_FLAT.lastIndex = at
  const m = HEAD_EXPR_FLAT.exec(str)
  if (!m) return null
  return { at, end: at + m[0].length, raw: m[1] !== undefined, body: m[1] ?? m[2] }
}

// les interpolations d'un commentaire HTML, dont le texte va de `start` à `end` dans `str` : lues dans ce texte seul. Une accolade du
// commentaire ne lit jamais au-delà de lui (`<!-- a { --><title>{$n}</title><!-- } -->`, lue jusqu'au commentaire suivant, avalait le
// titre et cassait la construction) ; une interpolation qu'il contient en entier se lit comme ailleurs
function commentInterps(str: string, start: number, end: number, interps: HeadInterp[]): void {
  const text = str.slice(start, end)
  const read = braceReader(text)
  let at = text.indexOf('{')
  while (at !== -1) {
    const m = headInterpolationAt(read, text, at)
    if (m) interps.push({ at: start + m.at, end: start + m.end, raw: m.raw, body: m.body })
    at = text.indexOf('{', m ? m.end : at + 1)
  }
}

// tagPositions : suit les états du tokeniseur HTML5 dans une balise — nom (de balise ou
// d'attribut) → après `=` (espaces admis) → valeur QUOTÉE (seulement si le premier caractère non
// blanc après le `=` est un guillemet) ou valeur NUE. Dans une valeur nue, TOUT caractère reste
// LITTÉRAL jusqu'au premier espace ou `>` — `"`, `'`, `=` et `<` compris (HTML5,
// unexpected-character-in-unquoted-attribute-value) : c'est ce qui fait que `a=b=" {$x}"` donne au
// navigateur la valeur `b="` puis un ATTRIBUT de plus par mot suivant, et non la valeur protégée
// qu'on croit lire. Un `<` suivi d'une interpolation ouvre une balise à nom calculé (ST_TAG_NAME,
// refusée) ; suivi d'autre chose qu'une lettre, `/` ou `!`, il reste du texte. Un commentaire
// s'ouvre sur `<!--` et se ferme sur `-->` ou `--!>`, ou AUSSITÔT sur `<!-->`/`<!--->` (HTML5) : ne
// connaître que `-->` classait tout le reste du bloc en commentaire, balises fautives comprises.
//
// Les expressions `{…}`/`{{…}}` (lues par headInterpolationAt) sont sautées d'un bloc et prennent l'état courant, sauf celle qui est
// le PREMIER caractère non blanc après le `=` d'un attribut : elle EST la valeur, le compilateur
// l'enveloppe de guillemets à l'émission (ST_AUTOQUOTE) — ce qui la suit dans la même valeur nue,
// lui, reste ST_BARE. Dans une valeur DÉJÀ quotée, une expression reste ST_QUOTED : `µ._esc` y
// neutralise le guillemet, aucun guillemet n'est ajouté (en ajouter derrière le premier `=` venu —
// un paramètre d'URL, un `k=v` — FERMAIT la valeur au navigateur et rendait la donnée maîtresse de
// la balise).
//
// `attr` : pour chaque caractère d'une valeur d'attribut, l'index où commence le token de
// l'attribut (son nom) — de quoi citer `attr=valeur` en entier dans un message, sans le redeviner.
//
// `interps` : les interpolations lues, de gauche à droite, celles des commentaires comprises (cf. commentInterps) — l'émission
// (buildHeadInjection) les reprend telles quelles, sans relire le texte.
function tagPositions(str: string): { state: Uint8Array; attr: Int32Array; interps: HeadInterp[] } {
  const state                 = new Uint8Array(str.length)
  const attr                  = new Int32Array(str.length).fill(-1)
  const read                  = braceReader(str)
  const interps: HeadInterp[] = []
  let tag                     = false
  // 'elname' (nom de l'élément) | 'tagname' (nom de l'élément CALCULÉ) | 'name' (avant/dans/après un
  // nom d'attribut) | 'value' (après le `=`) | 'bare' | 'quoted'
  let mode      = 'name'
  let quote     = ''
  let token     = -1      // début du nom d'attribut courant, -1 si aucun n'est en cours
  let afterName = false   // un nom d'attribut a été lu PUIS clos par un blank (son `=` reste ouvreur)
  let i         = 0
  while (i < str.length) {
    const c = str[i]
    if (c === '{') {
      const m = headInterpolationAt(read, str, i)
      if (m) {
        const stop = m.end
        if (tag) {
          if (mode === 'quoted') state.fill(ST_QUOTED, i, stop)
          else if (mode === 'tagname' || mode === 'elname') {
            // `<{$tag}>` comme `<meta={$x}>` : la donnée fabriquerait le nom de l'élément
            state.fill(ST_TAG_NAME, i, stop)
            if (mode === 'tagname') mode = 'name'
          }
          else if (mode === 'value' || mode === 'bare') {
            // en mode 'value', aucun caractère de valeur n'est encore passé : l'expression EST la
            // valeur, le compilateur la met entre guillemets
            state.fill(mode === 'value' ? ST_AUTOQUOTE : ST_BARE, i, stop)
            attr.fill(token, i, stop)
            mode = 'bare'
          }
          else state.fill(ST_TAG, i, stop)
        }
        interps.push(m)
        i = stop
        continue
      }
    }
    if (!tag) {
      if (str.startsWith('<!--', i)) {
        // `<!-->` et `<!--->` se ferment aussitôt ; sinon la fin est `-->` ou `--!>`
        let stop: number
        if (str.startsWith('<!-->', i)) stop = i + 5
        else if (str.startsWith('<!--->', i)) stop = i + 6
        else {
          const end = /--!?>/g
          end.lastIndex = i + 4
          const m = end.exec(str)
          stop = m ? m.index + m[0].length : str.length
          commentInterps(str, i + 4, m ? m.index : str.length, interps)
        }
        state.fill(ST_COMMENT, i, stop)
        i = stop
        continue
      }
      // `<{expr}` : la donnée fabriquerait le nom de la balise et tout ce qui le suit
      if (c === '<' && str[i + 1] === '{' && headInterpolationAt(read, str, i + 1)) {
        tag      = true
        mode     = 'tagname'
        state[i] = ST_TAG
        i++
        continue
      }
      if (c === '<' && /[A-Za-z!/]/.test(str[i + 1] ?? '')) {
        tag      = true
        // une lettre ouvre le NOM de l'élément (où un `=` n'a aucun sens spécial, HTML5 tag-name
        // state) ; `<!`/`</` gardent le traitement historique
        mode      = /[A-Za-z]/.test(str[i + 1]) ? 'elname' : 'name'
        token     = -1
        afterName = false
        state[i]  = ST_TAG
      }
      i++
      continue
    }
    if (mode === 'quoted') {
      // le guillemet FERMANT appartient à la structure, le contenu de la valeur vaut ST_QUOTED
      if (c === quote) {
        state[i]  = ST_TAG
        quote     = ''
        mode      = 'name'
        token     = -1        // l'attribut est complet : le `=` suivant n'aurait plus de nom devant lui
        afterName = false
      }
      else {
        state[i] = ST_QUOTED
        attr[i]  = token
      }
      i++
      continue
    }
    if (mode === 'bare') {
      if (isHtmlSpace(c)) {
        state[i]  = ST_TAG
        mode      = 'name'
        token     = -1
        afterName = false
      }
      else if (c === '>') {
        state[i]  = ST_TAG
        tag       = false
        mode      = 'name'
        token     = -1
        afterName = false
      }
      else {
        state[i] = ST_BARE
        attr[i]  = token
      }
      i++
      continue
    }
    if (mode === 'elname') {
      state[i] = ST_TAG
      if (c === '>') {
        tag       = false
        mode      = 'name'
        token     = -1
        afterName = false
      }
      else if (isHtmlSpace(c) || c === '/') {
        mode      = 'name'
        token     = -1
        afterName = false
      }
      i++
      continue
    }
    if (mode === 'value') {
      state[i] = ST_TAG
      if (isHtmlSpace(c)) { i++; continue }
      if (c === '"' || c === "'") {
        quote = c
        mode  = 'quoted'
      }
      else if (c === '>') {
        tag       = false
        mode      = 'name'
        token     = -1
        afterName = false
      }
      else {
        state[i] = ST_BARE
        attr[i]  = token
        mode     = 'bare'
      }
      i++
      continue
    }
    state[i] = ST_TAG
    if (c === '>') {
      tag       = false
      mode      = 'name'
      token     = -1
      afterName = false
    }
    else if (isHtmlSpace(c)) {
      if (token >= 0) afterName = true       // `a = "x"` : le nom reste l'attribut de ce `=`
    }
    else if (c === '=' && token >= 0) {
      mode      = 'value'
      afterName = false
    }
    else if (c === '/') {                   // HTML5 self-closing-start-tag : aucun nom ne court plus
      token     = -1
      afterName = false
    }
    else if (token === -1 || afterName) {    // début d'un NOUVEAU nom — un `=` sans nom devant lui en fait partie
      token     = i
      afterName = false
    }
    i++
  }
  return { state, attr, interps }
}

// countNewlines — nombre de `\n` dans une chaîne, pour situer une faute à la ligne du .mjs
function countNewlines(str: string): number {
  let n = 0
  for (let i = 0; i < str.length; i++) if (str.charCodeAt(i) === 10) n++
  return n
}

// faultyTag — la balise ENTIÈRE qui porte la faute (`<meta {$x}>`) : du `<` de tête (structure,
// donc jamais un `<` littéral niché dans une valeur) au `>` qui la referme, interpolations sautées
// d'un bloc (un `>` dans une accolade ne ferme rien). Un second `<` de structure arrête la citation
// avant lui : sans `>` à elle (`<{$b}</title>`), la « balise » s'arrêterait sinon à celui de la
// balise SUIVANTE, et le message montrerait un morceau qui n'existe pas.
function faultyTag(s: string, state: Uint8Array, start: number, end: number): string {
  let open = start
  while (open > 0 && !(s[open] === '<' && state[open] === ST_TAG)) open--
  const expr = /\{\{[^{}]+\}\}|\{[^{}]+\}/y
  let close  = end
  while (close < s.length) {
    if (s[close] === '{') {
      expr.lastIndex = close
      const m = expr.exec(s)
      if (m) { close += m[0].length; continue }
    }
    if (s[close] === '>' && state[close] === ST_TAG) { close++; break }
    if (s[close] === '<' && (state[close] === ST_TAG || state[close] === ST_TEXT)) break
    close++
  }
  return s.slice(open, close)
}

// unaliasSigil — remet dans le message le symbole que l'AUTEUR a tapé : le HTML arrive ici déjà
// normalisé (`mjs.` / `mjs$` → `µ.` / `µ$`, cf. normalizeSigilAlias), et citer `{µ$slug}` à qui a
// écrit `{mjs$slug}` envoie chercher une faute qui n'est pas dans son fichier. Inverse EXACT de
// l'alias : seul un `µ` suivi de `.` ou `$` est réécrit.
function unaliasSigil(txt: string, sigil?: string): string {
  return sigil && sigil !== 'µ' ? txt.replace(/µ(?=[.$])/g, sigil) : txt
}

// reportBareInterpolation — relève UNE interpolation écrite dans une balise, ailleurs que dans une
// valeur entre guillemets. Trois fautes, trois messages : (a) intérieur d'une valeur NUE
// (`href=https://x/{$slug}`) → la forme correcte est la valeur entière entre guillemets ; (b)
// position de nom d'attribut (`<meta {$x}>`) → il faut nommer l'attribut ; (c) position de nom de
// balise (`<{$tag}>`) → la balise s'écrit en clair. Forme et correction sont reconstruites sur le
// texte D'ORIGINE (avant la réécriture `={…}` → `="{…}"`), avec le symbole de l'auteur : un message
// ne montre jamais un état intermédiaire du compilateur.
//
// La ligne citée est celle du .mjs : `lineOf` des `\n` qui précèdent la faute dans le
// contenu RESTAURÉ (un <style>/<script> masqué tient sur une ligne, ses sauts de ligne
// manqueraient). Dans un `<@include>`, le partial est déjà inliné quand ce contrôle tourne : la
// table des lignes (cf. processIncludes) cite alors sa ligne dans le partiel, avec son fichier.
function reportBareInterpolation(s: string, state: Uint8Array, attr: Int32Array, start: number, end: number, restore: (str: string) => string, macro: 'head' | 'failed', errors: string[], lineOf: (k: number) => number | string, sigil?: string): void {
  const line = lineOf(countNewlines(restore(s.slice(0, start))))
  const text = (raw: string): string => unaliasSigil(restore(raw), sigil)
  if (state[start] === ST_TAG_NAME) {
    errors.push(t('transpiler.head-interpolation-position-tag', { macro, line: line, shape: text(faultyTag(s, state, start, end)) }))
    return
  }
  const token = state[start] === ST_BARE ? attr[start] : -1
  if (token >= 0) {
    // valeur NUE : elle court jusqu'au premier espace ou `>`, interpolations comprises
    let stop = end
    while (stop < s.length && (state[stop] === ST_BARE || state[stop] === ST_AUTOQUOTE)) stop++
    const eq  = s.indexOf('=', token)
    let start = eq + 1
    while (start < stop && /\s/.test(s[start])) start++
    const name = s.slice(token, eq)
    // guillemets de la valeur échappés : la correction proposée doit être du HTML valide
    const value = text(s.slice(start, stop)).replace(/"/g, '&quot;')
    errors.push(t('transpiler.head-attr-interpolation-no-quotes', { macro, line: line, shape: text(s.slice(token, stop)), correction: `${text(name)}="${value}"` }))
    return
  }
  errors.push(t('transpiler.head-interpolation-position-attribute', { macro, line: line, shape: text(faultyTag(s, state, start, end)) }))
}

// buildHeadInjection : transforme le HTML enfant d'un <@head> en EXPRESSION
// Civet qui produit la chaîne HTML à injecter, avec interpolations réactives.
//   <link rel="stylesheet" href={themeCss[$selected]}>
//   → '<link rel="stylesheet" href="' + (themeCss[$selected]) + '">'
// Les `{expr}` (texte) et `attr={expr}` (binding) deviennent des `(expr)`
// concaténés ; lus dans un µeffect, leurs `$x` rendent l'injection réactive.
// Chaque expression se lit comme dans le reste du gabarit (cf. headInterpolationAt) : accolades
// imbriquées (`{µt('k', { n: 1 })}`), chaînes et commentaires compris ; une accolade écrite dans un
// commentaire HTML ne lit jamais au-delà de lui (cf. commentInterps) ; une interpolation vide ne rend rien.
//
// Une interpolation écrite dans une balise, ailleurs que dans une valeur entre guillemets, est une
// FAUTE relevée dans `errors` : `µ._esc` échappe `<`, `>`, `"`, `'` et `&`, jamais l'espace ni le
// `=`, donc une valeur NUE (`href=https://x/{$slug}`), une expression à la place d'un attribut
// (`<meta {$x}>`) ou un nom de balise calculé (`<{$tag}>`) laissent une donnée d'ailleurs AJOUTER un
// attribut, voire fabriquer l'élément entier (`x onload=alert(1)`). Les positions sont celles du
// tokeniseur HTML5 (cf. tagPositions) : un `"` dans une valeur nue est un caractère littéral, il ne
// protège rien. Une faute par interpolation, toutes relevées (jamais de throw : le scan du fichier
// continue, le bundler fait échouer la construction) ; l'expression rendue reste valide, elle n'a
// plus d'importance dès que `errors` a grossi.
//
// Reste licite : `attr={expr}` / `attr={{expr}}` en valeur d'attribut (le compilateur met CETTE
// valeur entre guillemets), toute valeur entre guillemets simples ou doubles, et l'interpolation en
// texte, dans un commentaire ou dans le contenu d'un `<style>`/`<script>` (masqué, jamais interpolé).
//
// REFUS et ÉMISSION lisent le MÊME texte, aux positions d'UNE SEULE passe du tokeniseur : les
// guillemets d'une valeur auto-quotée sont posés à l'émission, jamais par une réécriture du source.
// Une réécriture globale `={…}` → `="{…}"` ne voyait pas l'état : le `=` d'un paramètre d'URL DANS
// une valeur déjà quotée (`href="…?p={$x}"`) déclenchait l'ajout, le guillemet injecté FERMAIT la
// valeur au navigateur, et la donnée reprenait la main sur la balise ; en texte (`<title>a={$x}`),
// elle inventait des guillemets et faisait perdre le HTML brut de `{{…}}`.
// `lineOf(k)` = ligne citée de la ligne k de `content` (0 : sa première) ; `sigil` = symbole du projet (message seul).
// Rend l'expression du HTML et `brut` : vrai quand un `{{…}}` d'auteur en texte y mêle du HTML brut, qui ne passe jamais par la
// politique Trusted Types `mjs` du cœur (seul le HTML fait du gabarit et de valeurs échappées y a droit)
function buildHeadInjection(written: string, macro: 'head' | 'failed', errors: string[], lineOf: (k: number) => number | string, sigil?: string): { html: string, raw: boolean } {
  // les commentaires qui gardent les lignes d'un bloc retiré (cf. keepLines) n'entrent pas dans le HTML injecté : il reste celui du bloc sans eux
  // (un commentaire écrit par l'auteur y reste)
  const content = written.replace(LINE_CARRIER_RE, '')
  // `<style>`/`<script>` ont leur PROPRE syntaxe à accolades (règles CSS, JS) :
  // les masquer AVANT le scan d'interpolation ci-dessous, sinon un `@font-face
  // { … }` est pris pour UNE SEULE expression réactive géante (`{([^{}]+)}`
  // avale tout le corps de la règle) → Civet invalide (`µ._esc(font-family: …)`,
  // syntaxe cassée, ParseError). Restauré tel quel dans les morceaux littéraux et le corps des interpolations :
  // figé, cohérent avec µasset('…') (résolu au BUILD, jamais réactif) —
  // <style>/<script> n'ont jamais supporté l'interpolation `{$x}` dans <@head>,
  // aucune régression de feature.
  // jetons à sceau, remise au point fixe (createMaskTable) : un NUL écrit par l'auteur reste tel quel
  const { stash, restore } = createMaskTable(content, 'MJSHEADLIT')
  // le CONTENU seul : la balise ouvrante se lit comme les autres (`<script src={$cdn}>` reçoit son adresse, au lieu
  // de partir avec le texte `{$cdn}`)
  const premasked = content.replace(/(<(style|script)\b[^>]*>)([\s\S]*?)(<\/\2>)/gi, (_m, open: string, _name: string, inner: string, close: string) => `${open}${stash(inner)}${close}`)

  const { state, attr, interps } = tagPositions(premasked)
  const parts: string[]          = []
  let raw                        = false
  let last                       = 0
  let prefix                     = ''   // guillemet fermant d'une valeur auto-quotée, à coller en tête du prochain littéral
  // les interpolations que tagPositions a lues, de gauche à droite : une accolade qu'il n'a pas prise reste du texte
  for (const m of interps) {
    const stateAt = state[m.at]
    if (stateAt === ST_TAG || stateAt === ST_BARE || stateAt === ST_TAG_NAME) {
      reportBareInterpolation(premasked, state, attr, m.at, m.end, restore, macro, errors, lineOf, sigil)
    }
    const literal = prefix + premasked.slice(last, m.at)
    prefix = ''
    // µ._esc : ces valeurs partent en innerHTML (head vivant / fallback de
    // boundary). Sans échappement, `<@head><title>{$titre}</title></@head>`
    // avec un titre venu du serveur contenant `</title><img onerror=…>`
    // exécutait du code (XSS). Svelte échappe <svelte:head> ; nous aussi.
    // `{{expr}}` HORS balise est la demande EXPLICITE de HTML brut : jamais échappé, comme
    // partout ailleurs ; DANS une balise (valeur d'attribut) il reste échappé comme `{expr}`.
    // Une interpolation vide (`{}`, `{ }`, `{{}}`) ne rend rien, comme dans le reste du gabarit : `µ._esc()` affichait « undefined »
    const value = restore(m.body).trim()
    if (stateAt === ST_AUTOQUOTE) {
      // l'expression EST la valeur : on l'entoure de guillemets ICI, à l'émission
      parts.push(quoteHeadLiteral(restore(literal + '"')))
      if (value) parts.push(`µ._esc(${value})`)
      prefix = '"'
    }
    else {
      if (literal) parts.push(quoteHeadLiteral(restore(literal)))
      if (value && m.raw && stateAt === ST_TEXT) { parts.push(`String(${value})`); raw = true }
      else if (value) parts.push(`µ._esc(${value})`)
    }
    last = m.end
  }
  const queue = prefix + premasked.slice(last)
  if (queue) parts.push(quoteHeadLiteral(restore(queue)))
  return { html: parts.length ? parts.join(' + ') : "''", raw }
}

// `<script>` que le navigateur exécuterait, d'après les attributs de sa balise ouvrante : type absent ou vide, JavaScript,
// module, importmap, speculationrules. Tout autre type (application/ld+json…) est une donnée ; un type calculé
// (`type={…}`) n'est connu qu'à l'exécution, rien n'est dit
function headScriptRuns(attrs: string): boolean {
  const m = /(?:^|\s)type\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attrs)
  if (!m) return true
  const type = (m[1] ?? m[2] ?? m[3]).trim().toLowerCase()
  if (type.includes('{')) return false
  return /^(|module|importmap|speculationrules|(text|application)\/(x-)?(java|ec)script|text\/(jscript|livescript|javascript1\.[0-5]))$/.test(type)
}

// les balises du langage que le repli d'un <@failed> ne peut pas porter : il part tel quel par innerHTML, une seule fois, après
// l'erreur, hors du gabarit compilé qui les fait agir (écouteurs globaux, en-tête, frontière, vue du routeur, emplacement, remplissage) ;
// `<@include>` y est déjà versé par sa passe, `<@element>` et `<@module>` y sont refusés par les leurs, qui tournent avant celle du
// repli (cf. fallbackDynamicTags)
const FALLBACK_LANGUAGE_TAGS = new Set(AT_RESERVED_NAMES.filter(n => n !== 'include' && n !== 'element' && n !== 'module'))

// une fermante de balise raccourcie (`</@carte>`, `</@@progress>`), lue comme le lecteur lit une fermante ; un jeton de bloc qui
// n'ouvre rien, que le lecteur signale quand aucun bloc ne l'attend (`{end}`, `{else}`, `{elsif …}`) — pas `{success …}` ni
// `{error …}`, qu'il signale hors d'un `{await}` : un repli n'en porte jamais, c'est l'expression d'un paramètre ainsi nommé
const SHORTCUT_CLOSE_RE = /<\/(@[a-zA-Z0-9\-@]+)\s*>/y
const BLOCK_TOKEN_RE    = /\{(end|else|elsif)(?=[\s}])/y

// le repli tel que le lecteur le lit, même longueur : une tête d'accolade faite d'un mot de branche qu'un repli ne porte jamais
// (`{error …}`, `{success …}` : il n'a pas d'`{await}`) ou d'un nom de ses paramètres (`<@failed end>` puis `{end}`, `{key …}`) y
// est l'expression qu'elle est, sa première lettre en capitale : lue comme un jeton de bloc, elle rendait vide la balise raccourcie
// ouverte autour d'elle (`<@carte>{error || 'x'}</@carte>` : contenu hors de la balise, fermante orpheline)
const PARAM_TOKEN_RE = /\{(error|success|end|elsif|key)(?=[\s}])/g
function fallbackReading(block: string, params: string[]): string {
  return block.replace(PARAM_TOKEN_RE, (m: string, word: string) => (word === 'error' || word === 'success' || params.includes(word) ? `{${word[0].toUpperCase()}${word.slice(1)}` : m))
}

// les exemples d'un repli lu (cf. fallbackTags) : <pre>, <code>, le texte d'un <textarea> ou d'un <title>, un script, un style ;
// une balise ou une fermante y est citée, jamais refusée ni rendue
const FALLBACK_EXAMPLE_TAGS = new Set(['pre', 'code', 'textarea', 'title'])
function fallbackExamples(tree: File): Array<[number, number]> {
  const out: Array<[number, number]> = []
  traverse(tree, (n) => {
    if (n.kind === 'script' || n.kind === 'style' || (n.kind === 'tag' && FALLBACK_EXAMPLE_TAGS.has(nameOf(n)))) out.push([n.start, n.end])
  })
  return out
}

// les replis des <@failed> de `text` (ceux que lit replacePairedTag), chacun lu comme fallbackTags le lit : la place de chaque balise
// <@element> ou <@module> qui y agirait (`live`), et leurs exemples. Les passes de ces deux balises tournent avant celle du repli
// (cf. processGlobalMacros)
function fallbackDynamicTags(text: string, dialect: boolean): { live: Set<number>, examples: Array<[number, number]> } {
  const live = new Set<number>()
  const examples: Array<[number, number]> = []
  for (const n of macroTags(text, 'failed', dialect).tags) {
    const close = n.end - '</@failed>'.length
    if (n.selfClosing || n.closedByAncestor !== null || asciiLower(text.slice(close, n.end)) !== '</@failed>') continue
    const shift = n.openingEnd - '<@failed>'.length
    const tree  = readComponent(`<@failed>${text.slice(n.openingEnd, close)}</@failed>`)
    for (const b of tagsOf(tree.children, OUTSIDE_MARKUP)) if (/^@(element|module)$/i.test(b.name)) live.add(b.start + shift)
    for (const [start, end] of fallbackExamples(tree)) examples.push([start + shift, end + shift])
  }
  return { live, examples }
}

// la fermante d'une balise dynamique (`close` : `</@element>`, `</@module>`) devient `</div>`, comme son ouvrante, sauf citée dans
// l'exemple d'un repli, où son ouvrante reste telle qu'écrite (cf. fallbackDynamicTags) ; un texte sans <@failed> n'est pas relu
function closeDynamicTags(text: string, close: RegExp, dialect: boolean): string {
  if (!asciiLower(text).includes('<@failed')) return text.replace(close, '</div>')
  const { examples } = fallbackDynamicTags(text, dialect)
  return text.replace(close, (m: string, at: number) => (examples.some(([start, end]) => start < at && at < end) ? m : '</div>'))
}

// les attributs écrits sur la balise d'un module cœur, relevés comme ceux du gabarit (cf. TagRefAttrs) : leurs noms, un étalement,
// le texte en clair de chacun (vide quand il est écrit sans valeur, null quand il est calculé) ; `source` : le texte où `b` a été lue
function coreTagAttrs(source: string, b: Tag): TagRefAttrs {
  const written = b.attrs.filter(a => a.name !== null)
  const texts   = written.map(a => {
    const v = valueOf(source, a)
    return [a.name!.toLowerCase(), a.value === null ? '' : v === undefined || /[{}&]/.test(v) ? null : v]
  })
  return { names: written.map(a => a.name!), spread: b.attrs.some(a => a.kind === 'spread'), texts: Object.fromEntries(texts) }
}

// fallbackTags — le contenu d'un bloc <@failed>, tel qu'écrit entre ses balises, que le compilateur du gabarit ne lit pas (son repli
// part tel quel par innerHTML) : chaque balise y est nommée comme dans le gabarit (resolveTagName). Une balise raccourcie devient
// celle de son module cœur (`<@@nom>` → `<mjs-core-nom`) ou de son composant (`<@nom>` → `<mjs-nom`), en minuscules comme le navigateur
// la lit, ses attributs tels qu'écrits ; sa fermante écrite ne change que de nom (ce qui suit jusqu'au `>` reste : un saut de ligne écrit
// là garde les lignes du repli, où ses fautes sont citées) ; auto-fermée ou jamais refermée, elle est refermée aussitôt après elle
// (sans fermante, le navigateur rangerait dans la balise tout ce qui la suit), refermée par la fermante d'un ancêtre, là. Chaque
// référence, raccourcie ou littérale (`<mjs-core-nom>`), rejoint `tagRefs` : la construction livre le module cœur et vérifie le
// composant, comme pour le gabarit. Une balise du langage que le repli ne peut pas porter est refusée à sa ligne (`lineOf`, cf.
// compileFailedBlock) ; un exemple dans <pre> ou <code>, un script ou un style restent tels qu'écrits. Un bloc ({if}, {for}…), ou un
// jeton de bloc que rien n'ouvre (`{end}`), y est refusé de même, où qu'il soit hors d'un script ou d'un style : seules les expressions
// `{…}` du repli sont calculées (cf. buildHeadInjection), jamais un bloc. Restent des expressions, que le repli calculait juste : une
// expression en ligne (`{if err then 'a' else 'b'}`, `{for x in l then x}`), un `{key …}` ou un `{await …}` que rien ne referme
// (l'appel d'un nom, `{key k}`), un jeton fait d'un nom de ses paramètres (`params` : `<@failed end>` puis `{end}`). Une fermante
// `</@…>` qui ne ferme aucune ouvrante, autre casse que la sienne comprise (`<@Carte>…</@carte>`), est refusée comme le gabarit la
// refuse, hors d'un exemple (cf. fallbackExamples) : le lecteur la signale à sa place (pas celle du bloc lui-même, qu'un jeton de bloc
// laisse sans ouvrante : le lecteur y rend vide le <@failed>, balise en `@`). Les refus sont rendus dans l'ordre du texte
function fallbackTags(content: string, errors: string[], lineOf: (k: number) => number | string, tagRefs: TagRef[], params: string[]): string {
  // le bloc lu : ses positions, sa balise ouvrante et sa fermante, que rien ne touche ; `trimmed` : là où commence le contenu rogné
  const block                                  = `<@failed>${content}</@failed>`
  const trimmed                                = '<@failed>'.length + content.length - content.trimStart().length
  const tree                                   = readComponent(fallbackReading(block, params))
  const lineAt                                 = (at: number): string => String(lineOf(countNewlines(block.slice(trimmed, at))))
  const edits: Array<[number, number, string]> = []
  const faults: Array<[number, string]>        = []
  for (const b of tagsOf(tree.children, OUTSIDE_MARKUP)) {
    if (b.start === 0) continue   // <@failed> lui-même
    if (/^@[^@]/.test(b.name) && FALLBACK_LANGUAGE_TAGS.has(nameOf(b).slice(1))) {
      faults.push([b.start, t('transpiler.failed-language-tag', { name: b.name, line: lineAt(b.start) })])
      continue
    }
    const before = tagRefs.length
    const name   = resolveTagName(b.name, tagRefs).toLowerCase()
    const ref    = tagRefs[before]
    if (ref && (ref.kind === 'shortcut-core' || ref.kind === 'literal-core')) ref.attrs = coreTagAttrs(block, b)
    if (b.name[0] !== '@' || name[0] === '@') continue
    const closeAt = b.empty ? b.openingEnd : b.closedByAncestor
    edits.push([b.start, b.start + 1 + b.name.length, `<${name}`])
    if (b.selfClosing) edits.push([b.openingEnd - 2, b.openingEnd, `></${name}>`])
    else if (closeAt !== null) edits.push([closeAt, closeAt, `</${name}>`])
    else {
      const at = block.lastIndexOf('</', b.end - 1)
      edits.push([at, at + /^<\/[^\s/>]*/.exec(block.slice(at))![0].length, `</${name}`])
    }
  }
  // un jeton de bloc sans bloc, en `at`, sauf le nom d'un paramètre ; une expression lue comme un bloc garde ses `{else}`, `{elsif …}` et
  // son `{end}` sans bloc
  const token = (word: string, at: number): void => {
    if (!params.includes(word)) faults.push([at, t('transpiler.failed-block', { block: word, line: lineAt(at) })])
  }
  traverse(tree, (n) => {
    if (n.kind !== 'block') return
    const closed     = n.end - '{end}'.length > n.head.end && block.startsWith('{end}', n.end - '{end}'.length)
    const expression = n.name === 'if' || n.name === 'for' ? /\bthen\b/.test(maskNonCode(block.slice(n.head.start, n.head.end))) : (n.name === 'key' || n.name === 'await') && !closed
    if (!expression) faults.push([n.start, t('transpiler.failed-block', { block: n.name, line: lineAt(n.start) })])
    else {
      for (const br of n.branches) if (br.kind === 'else' || br.kind === 'elsif') token(br.kind, br.start)
      if (closed) token('end', n.end - '{end}'.length)
    }
  })
  const examples = fallbackExamples(tree)
  const own      = block.length - '</@failed>'.length
  for (const d of tree.diagnostics) {
    BLOCK_TOKEN_RE.lastIndex    = d.start
    SHORTCUT_CLOSE_RE.lastIndex = d.start
    const word                  = BLOCK_TOKEN_RE.exec(block)
    const close                 = SHORTCUT_CLOSE_RE.exec(block)
    if (word) token(word[1], d.start)
    else if (close && d.start < own && !examples.some(([start, end]) => start < d.start && d.start < end)) faults.push([d.start, t('parser.tag-closing-orphan', { name: close[1], line: lineAt(d.start) })])
  }
  for (const [, msg] of faults.sort((a, b) => a[0] - b[0])) errors.push(msg)
  // à la même place, une fermante ajoutée passe avant ce qui y commence : la balise qui suit, ou la fermante renommée de l'ancêtre
  // qui l'a refermée (`<@carte><@@progress></@carte>`, où le renommage l'aurait sautée)
  edits.sort((a, b) => a[0] - b[0] || (a[1] - a[0]) - (b[1] - b[0]))
  let out = ''
  let pos = 0
  for (const [start, end, text] of edits) {
    out += block.slice(pos, start) + text
    pos  = end
  }
  out += block.slice(pos)
  return out.slice('<@failed>'.length, -'</@failed>'.length)
}

// compileFailedBlock : compile le contenu d'un <@failed args>…</@failed> en une
// fonction-builder DOM. Le fallback d'une error boundary est rendu APRÈS le
// crash (le pipeline réactif est éteint), donc on produit du DOM STATIQUE avec
// les `@event=…` câblés en listeners DIRECTS (pas de délégation, pas de
// réactivité — inutile ici). Les `{expr}` (texte/attrs) sont évalués une fois,
// avec les args (`err`, `reset`) en portée. Retourne les lignes de SETUP
// (constantes de réessai, posées une fois par construction) + le head de
// fonction + les lignes de corps (Civet).
//
// `retry="N"` (défaut 1) borne
// le nombre de réessais automatiques : sans limite, `reset()` (µ._mjs_resetComponent,
// mjs_runes.ts, appelé depuis _mjs_catchError, mjs_element.ts) remonte une instance
// FRAÎCHE du même composant — sur une erreur DÉTERMINISTE, construction → erreur
// → reset → construction tournait sans fin. `retry` est un attribut key=value,
// PAS un nom de callback (`err`/`reset` restent des tokens NUS) : on l'isole
// AVANT de construire la liste d'arguments, sinon `paramsRaw.split(/\s+/)`
// l'aurait pris pour un 3ᵉ paramètre positionnel de la fonction fallback.
//
// `errors`/`lineOf`/`sigil` : transmis à buildHeadInjection pour le refus de l'interpolation
// hors guillemets (cf. son bandeau). `lineOf(k)` = ligne citée de la ligne k du contenu TRIMMÉ.
function compileFailedBlock(paramsRaw: string, content: string, errors: string[], lineOf: (k: number) => number | string, sigil?: string, refs: HandlerReference[] = [], tagRefs: TagRef[] = []): { setup: string[]; head: string; body: string[] } {
  const tokens = paramsRaw.trim().split(/\s+/).filter(Boolean)
  const args: string[] = []
  let retryLimit = 1
  for (const tok of tokens) {
    const retryMatch = tok.match(/^retry=(["']?)(-?\d+)\1$/)
    if (retryMatch) {
      retryLimit = parseInt(retryMatch[2], 10)
      if (!Number.isInteger(retryLimit) || retryLimit < 0) throw new Error(t('transpiler.failed-retry-invalid', { value: tok }))
      continue
    }
    args.push(tok)
  }
  const argStr = args.length ? args.join(', ') : 'err, reset'
  const params = args.length ? args : ['err', 'reset']
  const wires: string[] = []
  let evN = 0
  // Extrait `@event={body}` (accolades ÉQUILIBRÉES) ou `@event=ref` → marqueur
  // + listener direct. L'ancien regex `\{([^{}]*)\}` interdisait toute
  // accolade dans le corps : `@click={reset({hard:true})}` produisait
  // `addEventListener('click', {reset: reset({hard:true})})` (2ᵉ arg = OBJET
  // littéral, pas de handleEvent → bouton du fallback d'error-boundary MORT,
  // sans erreur de compilation). On scanne à profondeur équilibrée (jumeau exact
  // du comptage à accolades équilibrées de parseListeners). Markup malformé (`{` non fermé, ou `@x=` sans
  // valeur) → laissé tel quel, comme l'ancien regex.
  // une balise raccourcie y est celle de son module cœur ou de son composant, comme partout ailleurs, et chaque balise une référence
  // du composant (innerHTML posait la balise telle qu'écrite : le navigateur affichait son texte) ; `before` : les erreurs d'avant ce repli
  const before = errors.length
  const src    = fallbackTags(content, errors, lineOf, tagRefs, params).trim()
  let marked = ''
  let last = 0
  const startRe = /@([\w-]+)((?:\.[\w:-]*)*)=/g
  let fm: RegExpExecArray | null
  while ((fm = startRe.exec(src)) !== null) {
    const ev = fm[1]
    const valPos = fm.index + fm[0].length      // juste après le `=`
    let handler: string
    let consumedEnd: number
    if (src[valPos] === '{') {
      let k = valPos + 1, depth = 1, body = ''
      while (k < src.length && depth > 0) {
        const c = src[k]
        if (c === '{') depth++
        else if (c === '}') { depth--; if (depth === 0) break }
        body += c
        k++
      }
      if (depth !== 0) { startRe.lastIndex = valPos; continue }   // `{` non fermé : ignoré
      handler = `(event) => (${body.trim()})`
      consumedEnd = k + 1                          // après la `}`
    } else {
      let k = valPos
      while (k < src.length && !/[\s>]/.test(src[k])) k++
      if (k === valPos) { startRe.lastIndex = valPos; continue }  // pas de valeur : ignoré
      handler = src.slice(valPos, k)
      consumedEnd = k
    }
    // gestionnaire fait d'un nom seul (`@click=nom`, `@click={nom}`, `@click=@nom`) : vérifié par le transpileur avec les
    // noms du <script> (cf. checkHandlerReferences). Une méthode du composant est appelée avec lui pour `this`, comme partout
    // (passée telle quelle à addEventListener, elle recevait la balise) ; une fonction du navigateur que les paramètres ne
    // masquent pas, sans la balise pour `this` (elle lèverait « Illegal invocation ») ; un mot du langage que Civet
    // ne prend pas pour un nom (`if`), refusé par le transpileur, n'est pas émis (Civet s'arrêterait avant lui, sur une erreur
    // illisible) ; `on`, `yes`… (cf. DECLARABLE_KEYWORDS) vont tels quels : déclarés, ils sont appelés, sinon refusés
    const braces    = src[valPos] === '{'
    const reference = HANDLER_REFERENCE_RE.exec(braces ? src.slice(valPos + 1, consumedEnd - 1).trim() : handler)
    if (reference) {
      const cited = lineOf(src.slice(0, fm.index).match(/\n/g)?.length ?? 0)
      refs.push({ name: reference[2], method: reference[1] === '@', attr: `@${ev}${fm[2]}`, braces, line: typeof cited === 'number' ? cited : undefined, place: typeof cited === 'string' ? cited : undefined, scope: params })
      // entre accolades comme sans, le nom va tel quel à addEventListener, qui l'appelle (`(event) => (reset)` le rendait sans l'appeler)
      const name = reference[2]
      const own  = reference[1] === '' && !params.includes(name)
      handler = reference[1] === '@' ? `(event) => @${name}(event)` : own && LANGUAGE_KEYWORDS.has(name) && !DECLARABLE_KEYWORDS.has(name) ? 'null' : own && BROWSER_FUNCTIONS.has(name) ? `(event) => ${name}(event)` : name
    }
    // un modificateur (`@click.once=…`) n'est pas posé ici, où l'écouteur va en direct sur la balise, hors du routeur délégué :
    // refusé avec sa ligne (l'attribut restait sans effet, le bouton muet) ; un nom seul pour valeur est relevé plus haut, comme sans lui
    if (fm[2]) {
      const msg = t('transpiler.failed-modifier-not-handled', { evt: ev, suffix: fm[2].slice(1), line: String(lineOf(src.slice(0, fm.index).match(/\n/g)?.length ?? 0)) })
      // eslint-disable-next-line no-console
      console.error(`[ModularJS] ❌ ${msg}`)
      errors.push(msg)
      startRe.lastIndex = consumedEnd
      continue
    }
    const marker = `data-mjsfe-${evN}`
    wires.push(`_mjs_e${evN} = _mjs_d.querySelector('[${marker}]')`)
    wires.push(`_mjs_e${evN}?.removeAttribute('${marker}')`)
    wires.push(`_mjs_e${evN}?.addEventListener('${ev}', ${handler})`)
    evN++
    marked += src.slice(last, fm.index) + marker
    last = consumedEnd
    startRe.lastIndex = consumedEnd
  }
  marked += src.slice(last)
  const { html: htmlExpr, raw } = buildHeadInjection(marked, 'failed', errors, lineOf, sigil)
  // un repli refusé (la construction échoue sur ses fautes) n'émet que son <div> vide : un bloc y donnait un code que Civet ne lit
  // pas (`µ._esc(if err)`), et l'erreur de Civet, levée avant les refus, les cachait
  const refused = errors.length > before
  // `_mjs_failedRetry`/`_mjs_failedRetryMsg` : posés en SETUP (constructeur, une
  // fois par instance) — PAS dans `body` (le corps du fallback, qui ne tourne
  // qu'AU CRASH) : `_mjs_catchError` doit lire la limite AVANT même d'appeler
  // `_mjs_fallback`, pour construire (ou pas) un `reset` qui fonctionne.
  return {
    setup: [
      `@_mjs_failedRetry = ${retryLimit}`,
      `@_mjs_failedRetryMsg = ${JSON.stringify(t('transpiler.failed-boundary-retry-exhausted', { limit: retryLimit }))}`,
    ],
    head: `@_mjs_fallback = (${argStr}) =>`,
    body: refused ? [`_mjs_d = document.createElement('div')`, `_mjs_d`] : [`_mjs_d = document.createElement('div')`, `_mjs_d.innerHTML = ${raw ? htmlExpr : `µ._mjs_th(${htmlExpr})`}`, ...wires, `_mjs_d`],
  }
}

// reportUnclosedMacroTag — une balise du langage reconnue que l'arbre du gabarit ne referme jamais (une accolade, une
// parenthèse de réglages ou un guillemet jamais refermés dans ses attributs) : erreur de construction, le HTML reste tel
// quel. `extrait` = 60 premiers points de code de la balise (depuis `<@`, découpe par `Array.from` : une paire de
// substituts à cheval sur la coupe n'y laisse pas un substitut isolé), sauts de ligne aplatis en espace. Dédoublonnée par
// son texte : <@head> passe par `replacePairedTag` (forme contenu) puis par la boucle TARGETS (forme écouteur), la même
// balise y serait signalée deux fois, et `bundler/index.ts` joint `macroErrors` dans un seul throw
// unclosedSettings — une balise du langage que l'arbre ne referme jamais parce que les réglages d'un de ses effets ne le sont pas
// (`<@document *ripple(color: red>`, une apostrophe dans `*ripple(color: 'red)`) : le conseil propre aux réglages, avec la ligne
// de l'effet, plutôt que la balise ou l'expression non fermée ; null quand les réglages se referment (la faute est ailleurs)
function unclosedSettings(html: string, at: number, macro: string, cite: (k: number) => number | string): string | null {
  const end        = html.indexOf('>', at)
  const effect     = /\s\*([A-Za-z][\w-]*(?:\.[\w.-]*)?)\(/g
  effect.lastIndex = at
  const m          = effect.exec(html)
  if (!m || (end >= 0 && m.index > end)) return null
  let open   = 1
  let inText = ''
  for (let i = m.index + m[0].length; i < html.length; i++) {
    const c = html[i]
    if (inText) {
      if (c === '\\') i++
      else if (c === inText) inText = ''
    }
    else if (c === '"' || c === "'") inText = c
    else if (c === '(') open++
    else if (c === ')' && --open === 0) return null
  }
  const line = cite(html.slice(0, m.index + 1).split('\n').length - 1)
  return t(inText === '"' ? 'effects.quote-open' : inText ? 'effects.text-open' : 'effects.paren', { name: m[1], tag: macro, line: line })
}

function reportUnclosedMacroTag(errors: string[], macro: string, html: string, idx: number): void {
  const excerpt = Array.from(html.slice(idx, idx + 120)).slice(0, 60).join('').replace(/\n/g, ' ')
  const msg = t('transpiler.macro-tag-not-closed', { macro, excerpt: excerpt })
  if (errors.includes(msg)) return    // déjà signalée (2e passe replacePairedTag/TARGETS sur <@head>)
  // eslint-disable-next-line no-console
  console.error(`[ModularJS] ❌ ${msg}`)
  errors.push(msg)
}

// un attribut d'une balise du langage tel que l'arbre du gabarit le lit, sa place prise dans le texte de ses attributs
interface MacroAttr extends Span {
  kind: TagAttr['kind']
  name: string | null
  value: TagAttr['value']
  settings: Span | null
}

// le texte des attributs d'une balise du langage, de la fin de son nom à son `>` (le `/` d'une auto-fermeture compris), et
// ses attributs
interface MacroAttrs {
  text: string
  attrs: MacroAttr[]
}

function macroAttrs(html: string, tag: Tag, from: number): MacroAttrs {
  const place = (e: Span): Span => ({ start: e.start - from, end: e.end - from })
  return {
    text:  html.slice(from, tag.openingEnd - 1),
    attrs: tag.attrs.map((a) => ({ kind: a.kind, name: a.name, value: a.value, ...place(a), settings: a.settings && place(a.settings) }))
  }
}

// retire du texte des attributs les morceaux donnés (rangés, disjoints) : un attribut qui y tombe part, les autres suivent
// leur place dans le texte qui reste
function cutAttrs(view: MacroAttrs, cuts: Array<[number, number]>): MacroAttrs {
  if (cuts.length === 0) return view
  let text = ''
  let last = 0
  for (const [from, to] of cuts) {
    text += view.text.slice(last, from)
    last  = to
  }
  text += view.text.slice(last)
  const shift = (at: number): number => cuts.reduce((k, [from, to]) => (to <= at ? k - (to - from) : k), at)
  const attrs = view.attrs
    .filter((a) => cuts.every(([from, to]) => a.end <= from || a.start >= to))
    .map((a) => ({ ...a, start: shift(a.start), end: shift(a.end), settings: a.settings && { start: shift(a.settings.start), end: shift(a.settings.end) } }))
  return { text, attrs }
}

// effets `*nom(…)` écrits sur une balise du langage (`<@window>`, `<@element>`…) : retirés des attributs et signalés — un
// effet se pose sur une balise HTML ou un composant. `keep(nom, réglages)`, si fourni, reçoit l'effet à la place du refus
// (les effets de souris de `<@document>`). Ce sont les effets que l'arbre du gabarit lit parmi les attributs, jamais dans
// une valeur ni dans une accolade ; une étoile collée à ce qui précède n'est pas un effet. Une parenthèse séparée du nom par
// un blanc (`*ripple (color: red)`) est refusée comme sur une balise HTML, ses réglages seraient perdus : l'arbre ne les lui
// donne pas, ils sont lus ici jusqu'à leur parenthèse fermante (un texte resté ouvert, une apostrophe dans un mot ou un
// guillemet double, est dit comme tel, pas comme une parenthèse oubliée). `lineAt(position)` donne la ligne du .mjs d'une
// position des attributs, null quand elle n'est pas celle du fichier du composant. Sur une balise qui ne garde aucun effet
// (`<@window>`), l'espace et l'effet qui ne s'y pose pas sont dits tous les deux
function stripEffects(source: MacroAttrs, macro: string, errors: string[], keep: ((name: string, raw: string) => void) | undefined, lineAt: (offset: number) => number | string | null): MacroAttrs {
  const view  = withoutSize(source, macro, errors)
  const attrs = view.text
  const cuts: Array<[number, number]> = []
  for (const a of view.attrs) {
    // l'étoile d'un effet, ou celle d'un point sans nom d'effet (`*.rouge`, que l'arbre lit comme un attribut `.rouge`)
    const i = a.kind === 'effect' ? a.start : a.name?.startsWith('.') && attrs[a.start - 1] === '*' ? a.start - 1 : -1
    if (i < 0 || i < (cuts.length > 0 ? cuts[cuts.length - 1][1] : 0) || (i > 0 && !/\s/.test(attrs[i - 1]))) continue
    const name = a.kind === 'effect' ? a.name ?? '' : ''
    if (!name) {
      // une étoile et un point, sans nom d'effet entre eux (`*.rouge`) : l'effet manque, il ne reste pas parmi les attributs
      const bare = /^\*(\.[\w.-]*)/.exec(attrs.slice(i))
      if (!bare) continue
      errors.push(t('effects.point-no-effect', { point: bare[1], line: lineAt(i) ?? '' }))
      cuts.push([i, i + bare[0].length])
      continue
    }
    let end = i + 1 + name.length
    // la parenthèse détachée est lue comme les autres : ses réglages ne restent pas parmi les attributs
    const blank    = a.settings ? null : /^\s+(?=\()/.exec(attrs.slice(end))
    let raw        = ''
    let note       = ''
    const settings = a.settings !== null || blank !== null
    if (a.settings) {
      // réglages lus par l'arbre, comme sur une balise : une parenthèse dans un texte (`color: ')'`) ne compte pas
      raw = attrs.slice(a.settings.start, a.settings.end)
      end = a.settings.end + 1
      // un commentaire dans les réglages se lirait comme une valeur : refusé, avec sa ligne
      const found = settingsComment(raw)
      if (found) note = t('effects.comment', { name, line: lineAt(a.settings.start + found.at) ?? '', comment: found.text })
    }
    else if (blank) {
      end += blank[0].length
      const from = end + 1
      let open   = 0
      let inText = ''
      let closed = false
      for (; end < attrs.length; end++) {
        const c = attrs[end]
        if (inText) {
          if (c === '\\') end++
          else if (c === inText) inText = ''
        }
        else if (c === '"' || c === "'") inText = c
        else if (c === '(') open++
        else if (c === ')' && --open === 0) { end++; closed = true; break }
      }
      if (!closed) {
        errors.push(t(inText === '"' ? 'effects.quote-open' : inText ? 'effects.text-open' : 'effects.paren', { name, tag: macro, line: lineAt(from) ?? '' }))
        end = attrs.length
      }
      raw = closed ? attrs.slice(from, end - 1) : attrs.slice(from)
    }
    // un point derrière l'effet n'est le nom d'aucun alias (`*ripple .rouge`, `*ripple.rouge(size: 30).x`) : dit comme sur une balise
    const stray = (settings ? /^(\s*)(\.[\w.-]*)/ : /^(\s+)(\.[\w.-]*)/).exec(attrs.slice(end))
    // un effet inconnu est refusé d'abord, par son nom (`*rippel .rouge`) : son point ne dit rien
    const dot   = stray && (effectSpec(name) || effectSpec(name.split('.')[0])) ? stray : null
    const gone  = removedEffectError(name, raw)
    if (gone) errors.push(gone)
    else {
      if (blank) errors.push(t('effects.space', { name, line: lineAt(i) ?? '' }))
      if (dot) errors.push(t(settings ? 'effects.point-settings' : 'effects.point-space', { name, blank: dot[1] ? ' ' : '', point: dot[2], example: aliasExample(name.split('.')[0]), line: lineAt(i) ?? '' }))
      if (!keep) errors.push(t('effects.tag-special', { name, tag: macro }))
      else if (!blank && !dot) {
        if (note) errors.push(note)
        else keep(name, raw)
      }
    }
    if (stray) end += stray[0].length
    cuts.push([i, end])
  }
  return cutAttrs(view, cuts)
}

// un bloc du langage retiré du gabarit (`<@head>…</@head>`, `<@failed>…</@failed>`, une balise `<@window …>` écrite sur
// plusieurs lignes), ou remplacé par une balise plus courte (`<@element $tag` sur plusieurs lignes), y laisse ses sauts de ligne
// dans un commentaire HTML marqué comme le sien (cf. LINE_CARRIER_OPEN), après ce qui le remplace, que le parseur compte et que la sortie ignore : ce qui suit garde la ligne
// du fichier dans les messages (une faute écrite après un `<@head>` de 3 lignes se disait 3 lignes plus haut). Là où un
// commentaire se verrait, il est ôté sans changer les lignes : par le parseur (texte d'un `<textarea>` ou d'un `<title>`, valeur
// d'attribut, cf. LINE_CARRIER_RE) et par buildHeadInjection (`<@head>`, fallback d'un `<@failed>`)
function keepLines(replacement: string, removed: string): string {
  const lost = countNewlines(removed) - countNewlines(replacement)
  return lost > 0 ? `${replacement}${LINE_CARRIER_OPEN}${'\n'.repeat(lost)}-->` : replacement
}

// les commentaires HTML du gabarit qui citent une balise du langage, retirés avec leur texte, leurs lignes gardées (keepLines) ; chacun
// lu comme le navigateur le lit, hors des balises et hors des expressions `{ … }` du texte (lues comme au retrait des commentaires,
// finsAccolades) : un `<!--` écrit dans une valeur d'attribut ou dans une expression n'en ouvre aucun (il retirait tout le texte
// jusqu'au `-->` d'une autre valeur ou d'une autre expression, un <@head> compris) ; un `<!--` jamais refermé ne retire rien ; une
// accolade jamais refermée n'est qu'un signe ; le texte d'un <textarea> ou d'un <title> n'est pas lu
const TAG_RE = /<\/?@{0,2}[a-zA-Z][\w:.-]*/y

function withoutCommentedMacros(html: string): string {
  if (!html.includes('<!--')) return html
  const sign = /[<{]/g
  const ends = new Map<number, number>()
  let out    = ''
  let cur    = 0
  let i      = 0
  for (;;) {
    sign.lastIndex = i
    const s = sign.exec(html)
    if (s === null) break
    i = s.index
    if (html[i] === '{') {
      if (!ends.has(i)) braceEnds(html, i, ends)
      const e = ends.get(i)!
      i = e === -1 ? i + 1 : e
      continue
    }
    if (html.startsWith('<!--', i)) {
      const read = readHtmlComment(html, i)
      if (read === null) break
      if (/<@\w/.test(html.slice(i, read.end))) {
        out += html.slice(cur, i) + keepLines('', html.slice(i, read.end))
        cur  = read.end
      }
      i = read.end
      continue
    }
    TAG_RE.lastIndex = i
    const name = TAG_RE.exec(html)
    const end = name === null ? -1 : findMacroTagEnd(html, i + name[0].length)
    // le texte d'un <textarea> ou d'un <title>, où le navigateur ne lit aucun commentaire : sauté jusqu'à sa fermante, il reste tel
    // qu'écrit, comme au retrait des commentaires (sections.ts) ; le parseur retire celui du <title> d'un dessin
    const raw = end !== -1 && /^<(?:textarea|title)$/i.test(name![0]) ? asciiLower(html).indexOf(`</${asciiLower(name![0].slice(1))}`, end + 1) : -1
    i = raw !== -1 ? raw : end === -1 ? i + 1 : end + 1
  }
  return cur === 0 ? html : out + html.slice(cur)
}

// une ligne qui commence par une balise (`<p>`, `</div>`, `<@head>`, `<!--`), comme la lisait la garde d'avant l'arbre
// (macro-tag.ts, looksLikeOpenTag) : jamais un `<` de comparaison au milieu d'une ligne de code
const LINE_STARTS_TAG = /\n[ \t]*<[a-zA-Z/@!]/

// une accolade ou une parenthèse d'attribut que l'auteur n'a pas refermée sur la balise du langage avale le HTML qui suit,
// jusqu'à la première `}` ou `)` qui lui répond plus loin : l'arbre referme alors la balise, et son gestionnaire, sa
// condition ou ses réglages sont faits de balises (un gestionnaire ainsi compilé tombait sur une erreur de Civet sans ligne
// du .mjs, une condition de classe effaçait le HTML avalé sans un mot). Un attribut où une ligne commence par une balise,
// hors chaînes, regex et commentaires du langage du gabarit (`dialecte` : Civet ou CoffeeScript, sinon JavaScript ; une chaîne
// sur plusieurs lignes, un heredoc qui écrit du HTML restent permis), dit cette balise jamais refermée
function swallowsHtml(html: string, tag: Tag, dialect: boolean): boolean {
  return tag.attrs.some((a) => LINE_STARTS_TAG.test(maskNonCode(html.slice(a.start, a.end), dialect ? 'civet' : 'js')))
}

// les balises `<@name …>` du gabarit, lues dans son arbre (une lecture, seulement si le nom y paraît), dans l'ordre : écrite
// dans une valeur d'attribut, une chaîne d'expression ou le texte d'un <textarea> ou d'un <title>, ce n'est qu'un texte.
// L'arbre est lu même quand il signale une faute ailleurs (le parseur refuse ensuite le gabarit, avec son message) ;
// `unclosed` : le début de chaque telle balise jamais refermée, dans l'ordre — celle où la lecture de l'arbre s'arrête, et
// chacune dont un attribut avale le HTML qui suit (cf. swallowsHtml) ; laissées telles quelles, le parseur les refuse
// ensuite avec leur ligne
function macroTags(html: string, name: string, dialect: boolean): { tags: Tag[], unclosed: number[] } {
  const needle = `<@${name}`
  const lower  = asciiLower(html)
  if(!lower.includes(needle)) return { tags: [], unclosed: [] }
  const tree               = readFile(html, { template: true, dialect })
  const tags: Tag[]        = []
  const unclosed: number[] = []
  traverse(tree, (n) => {
    if(n.kind !== 'tag' || asciiLower(n.name) !== needle.slice(1)) return
    if(swallowsHtml(html, n, dialect)) unclosed.push(n.start)
    else tags.push(n)
  })
  tags.sort((a, b) => a.start - b.start)
  const fault = tree.diagnostics.find((d) => lower.startsWith(needle, d.start) && !tags.some((n) => n.start === d.start) && !unclosed.includes(d.start))
  if(fault) unclosed.push(fault.start)
  return { tags, unclosed: unclosed.sort((a, b) => a - b) }
}

// `:size` garde la place d'un composant de l'appli (generator/attributes, cf. bindingSize) : sur une balise du langage, refusé comme sur une
// balise HTML et retiré de ses attributs — jamais lu comme l'écoute d'un événement « size », ni laissé dans le code émis (`<@element>` y
// passe ses attributs) ; le signe des mots de MJS n'ouvre aucun mot collé à ce qui précède
function withoutSize(view: MacroAttrs, macro: string, errors: string[]): MacroAttrs {
  const size = view.attrs.find((a) => a.name === written('size') && (a.start === 0 || /\s/.test(view.text[a.start - 1])))
  if (!size) return view
  errors.push(t('generator.size-component', { name: written('size'), tag: `@${macro}` }))
  return cutAttrs(view, [[size.start, size.end]])
}

// replaceOpenTag — remplace chaque balise ouvrante `<@name …>` du gabarit (insensible à la casse, cf. macroTags) par
// `cb(attrs, wholeTag, lineAt, names, at)` : `attrs`, ses attributs, effets et `:size` retirés (cf. stripEffects) ; `wholeTag`,
// la balise entière (pour un éventuel retour « inchangé ») ; `names()`, les noms de ses attributs en `@` tels qu'écrits,
// avec leur place depuis `<@` (la ligne d'un écouteur) ; `at`, sa place dans `html`. Le caractère qui suit le nom est un blanc, `/` ou `>` (`/` et `>`
// collés compris : `<@element>` reçoit des attributs vides et rapporte `element-variable-attendue`, `<@element/>` tombe sous
// la garde « auto-fermeture interdite »), ou la fin du texte hors `requireLeadingSpace` (<@element>/<@module>, contenu
// requis) ; sinon ce n'est pas la macro visée (`<@windowx>` reste intact). Une telle balise que l'arbre ne referme jamais
// est signalée (`macro-balise-non-fermee`) et laissée telle quelle
function replaceOpenTag(
  html: string,
  name: string,
  requireLeadingSpace: boolean,
  errors: string[],
  cb: (attrs: MacroAttrs, wholeTag: string, lineAt: (offset: number) => number | string | null, names: () => Array<{ name: string; at: number; start: number }>, at: number) => string,
  keep: ((name: string, raw: string, line: () => number | string | null) => void) | undefined,
  cite: (k: number) => number | string,
  dialect: boolean
): string {
  const { tags, unclosed } = macroTags(html, name, dialect)
  const nameLength = name.length + 2
  const boundaryOk = (at: number): boolean => {
    const boundary = html[at + nameLength]
    return boundary === undefined ? !requireLeadingSpace : /[\s/>]/.test(boundary)
  }
  let out = ''
  let pos = 0
  for (const n of tags) {
    if (!boundaryOk(n.start)) continue
    const nameEnd = n.start + nameLength
    const tag     = html.slice(n.start, n.openingEnd)
    const lineAt  = effectLineAt(html, nameEnd, cite)
    const names   = (): Array<{ name: string; at: number; start: number }> => n.attrs.flatMap((a) => (a.name?.startsWith('@') ? [{ name: a.name, at: a.start - n.start, start: a.start }] : []))
    out          += html.slice(pos, n.start) + keepLines(cb(stripEffects(macroAttrs(html, n, nameEnd), name, errors, keep && ((nm, r) => keep(nm, r, () => lineAt(0))), lineAt), tag, lineAt, names, n.start), tag)
    pos           = n.openingEnd
  }
  for(const at of unclosed) {
    if(!boundaryOk(at)) continue
    const tip = unclosedSettings(html, at, name, cite)
    if(tip) throw new Error(tip)
    reportUnclosedMacroTag(errors, name, html, at)
  }
  return out + html.slice(pos)
}

// la ligne citée d'une position des attributs d'une balise du langage (`offset` : depuis `from`, la fin de son nom dans le
// HTML lu) : ce HTML garde ses lignes d'un remplacement à l'autre (cf. keepLines), sa ligne k se cite par `cite`
function effectLineAt(html: string, from: number, cite: (k: number) => number | string): (offset: number) => number | string {
  let base: number | undefined
  return (offset: number): number | string => {
    base ??= countNewlines(html.slice(0, from))
    return cite(base + countNewlines(html.slice(from, from + offset)))
  }
}

// replacePairedTag — remplace chaque bloc `<@name attrs>…contenu…</@name>` du gabarit (cf. macroTags) par `cb(attrs,
// content, at)`, `at` : la place du contenu. `onSelfClose(attrs)`, si fourni, capte une forme `<@name …/>` sans chercher de
// contenu. Un bloc que l'arbre ne referme pas par sa propre fermante `</@name>` (jamais refermé, refermé par un ancêtre) est
// laissé intact, comme le reste ; une balise ouvrante jamais refermée est signalée comme dans replaceOpenTag
function replacePairedTag(
  html: string,
  name: string,
  errors: string[],
  cb: (attrs: MacroAttrs, content: string, at: number) => string,
  onSelfClose: ((attrs: string) => string) | undefined,
  cite: (k: number) => number | string,
  dialect: boolean
): string {
  const { tags, unclosed } = macroTags(html, name, dialect)
  const nameLength         = name.length + 2
  const closeNeedle        = `</@${name}>`
  const boundaryOk         = (at: number): boolean => html[at + nameLength] === undefined || /[\s/>]/.test(html[at + nameLength])
  let out                  = ''
  let pos                  = 0
  for (const n of tags) {
    if (n.start < pos || !boundaryOk(n.start)) continue
    const nameEnd = n.start + nameLength
    const attrs   = stripEffects(macroAttrs(html, n, nameEnd), name, errors, undefined, effectLineAt(html, nameEnd, cite))
    if (onSelfClose && attrs.text.endsWith('/')) {
      out += html.slice(pos, n.start) + keepLines(onSelfClose(attrs.text.slice(0, -1)), html.slice(n.start, n.openingEnd))
      pos = n.openingEnd
      continue
    }
    const close = n.end - closeNeedle.length
    if (n.selfClosing || n.closedByAncestor !== null || asciiLower(html.slice(close, n.end)) !== closeNeedle) continue
    out += html.slice(pos, n.start) + keepLines(cb(attrs, html.slice(n.openingEnd, close), n.openingEnd), html.slice(n.start, n.end))
    pos = n.end
  }
  for(const at of unclosed) {
    if(!boundaryOk(at)) continue
    const tip = unclosedSettings(html, at, name, cite)
    if(tip) throw new Error(tip)
    reportUnclosedMacroTag(errors, name, html, at)
  }
  return out + html.slice(pos)
}

export function processGlobalMacros(html: string, opts: { firstLine?: number; sigil?: 'µ' | 'mjs'; places?: LinePlace[]; dialect?: boolean; civet?: boolean } = {}): GlobalMacrosResult {
  // ligne du .mjs où commence CE html (section HTML, cf. extractSections().htmlStartLine) : sert à
  // citer un numéro de ligne juste dans les erreurs de <@head>/<@failed>. 1 par défaut. `sigil` =
  // symbole du projet, pour rendre dans ces mêmes messages le `mjs.`/`mjs$` tapé par l'auteur (le
  // HTML arrive ici normalisé en `µ`). `civet` : le code des gestionnaires de ces balises est compilé par Civet (sinon CoffeeScript)
  const firstLine = opts.firstLine ?? 1
  const sigil     = opts.sigil
  const setupLines: string[] = []
  const setupOrigins: Array<SetupOrigin | undefined> = []
  const setupHandlers: Array<{ fn: string; origin: SetupOrigin }> = []
  // Lignes d'ATTACHE (addEventListener) — rejouées à CHAQUE @awake, et
  // détachées à CHAQUE sleep (teardownLines) : cycle symétrique qui survit
  // aux hibernations (pageCache, déplacement DOM) sans fuir. Les DÉFINITIONS
  // de handlers (@_gl_x = …), elles, restent dans setupLines (init, une fois).
  const attachLines: string[] = []
  const teardownLines: string[] = []
  // Erreurs de compile des liaisons class/style (cf. parseStyling plus bas).
  const errors: string[] = []
  const warnings: string[] = []
  // les gestionnaires faits d'un nom seul dans le fallback d'un <@failed> et sur les balises globales, vérifiés par le transpileur
  const handlerRefs: HandlerReference[] = []
  // les balises du fallback d'un <@failed> (cf. GlobalMacrosResult.tagRefs)
  const tagRefs: TagRef[] = []

  // la ligne k du HTML reçu, citée (cf. citeLine) : la table des lignes des partiels versés (`places`, cf. processIncludes),
  // une ligne du composant comptée depuis `firstLine` sans elle. Chaque bloc retiré ou remplacé y laisse ses lignes (cf.
  // keepLines) : une position du texte que lit un passage a la ligne qu'elle avait dans le HTML reçu
  const cite = (k: number): number | string => citeLine(opts.places, firstLine, k)

  // les lignes citées du contenu (TRIMMÉ) d'un bloc <@head>/<@failed>, sa première comptée à sa place (`at`) dans le texte
  // que lit le passage ; contenu vide → première ligne de la section
  const contentLines = (at: number, content: string): ((k: number) => number | string) => {
    const lead  = content.length - content.trimStart().length
    const first = content.trim() ? countNewlines(cleaned.slice(0, at + lead)) : 0
    return (k: number) => cite(first + k)
  }

  // Généralisation de la règle <@include nom/> (slash
  // final interdit, cf. processIncludes ci-dessus) à
  // <@element>/<@module>/<@failed> : ces 3 macros à CONTENU n'ont jamais eu de
  // forme auto-fermée valide (contrairement à <@window>/<@document>/<@body>/
  // <@html>, 100% auto-fermées en usage réel, ou à <@slot/> — idiome légitime
  // — NI touchées ici). <@head> ÉCARTÉ malgré la demande initiale :
  // il est AUSSI une cible d'écouteur global (clé de TARGETS, plus bas) et
  // <@head @event={...} /> auto-fermé y est un DEUXIÈME usage 100% légitime
  // et déjà testé — cf. le commentaire dédié au site § 1 ci-dessous. Même
  // diagnostic « soft » que <@include> : console.error + accumulation dans
  // `errors` (PAS de throw synchrone, pour laisser le scan du reste du
  // fichier continuer) — le caller (transpiler/index.ts → data.macroErrors →
  // bundler/index.ts) fait échouer le build.
  const reportSelfCloseForbidden = (macro: string): string => {
    const msg = t('transpiler.macro-self-closing-forbidden', { macro })
    // eslint-disable-next-line no-console
    console.error(`[ModularJS] ❌ ${msg}`)
    errors.push(msg)
    return ''
  }

  let cleaned = html
  let counter = 0

  // Neutralise les commentaires HTML qui contiennent une pseudo-directive
  // `<@…>` (ex. un commentaire explicatif citant `<@failed>`), sinon les regex
  // de macros ci-dessous matcheraient À L'INTÉRIEUR du commentaire. Les
  // commentaires normaux (sans `<@`) sont préservés.
  cleaned = withoutCommentedMacros(cleaned)

  // Parse les @event={handler} d'un tag macro → addEventListener/removeEventListener : les attributs en `@` que l'arbre du
  // gabarit lit sur la balise (`view.attrs`), jamais un `@x` écrit dans une valeur (`title="@foo"`, `scrollY=!{@y}`,
  // `@scroll=@resize`) ni dans le corps d'un gestionnaire (`@sizes.push …`). Le nom d'un événement prend le deux-points :
  // les événements du framework sont namespacés (`mjs:load`, `mjs:before-visit`, cf. µ._mjs_navEmit, mjs_ujs.ts). Un nom
  // suivi d'un point porte un modificateur (`@scroll.passive`), jamais lu comme l'événement d'un de ses préfixes
  const parseListeners = (view: MacroAttrs, targetJs: string, lineOf?: (ev: string, wanted: boolean) => { line: number | undefined; start: number } | undefined, lineOfName?: (name: string) => number | string | null | undefined) => {
    const attrs = view.text
    // Forme ABRÉGÉE (`@nom` seul, sans `={…}`) sur un nom à deux-points :
    // REFUSÉE. Elle synthétise un appel à la méthode HOMONYME de l'événement
    // (`mjs:load(e)`), que Civet compile sans broncher en bare-hash
    // (`{mjs: load(e)}`) — un objet jeté, un appel vers une fonction globale
    // `load` inexistante, et surtout AUCUNE erreur : le silence exact qu'on
    // refuse. Diagnostic « soft » (console.error + accumulation dans `errors`,
    // le build échoue plus haut) comme les autres erreurs de ce fichier.
    const refuseShorthandColon = (ev: string): boolean => {
      if (!ev.includes(':')) return false
      const msg = t('generator.event-colon-shorthand', { evt: ev })
      // eslint-disable-next-line no-console
      console.error(`[ModularJS] ❌ ${msg}`)
      errors.push(msg)
      return true
    }
    // GARDE MODIFICATEUR SUR MACRO — un `@evt.suffixe` était IGNORÉ, en silence : `<@window @resize.emit.sized={…}>` compilait
    // vert et n'émettait jamais rien. Même diagnostic « soft » que le reste du fichier (console.error + `errors`, le build
    // échoue plus haut). Appelé APRÈS `parseStyling`, qui a déjà retiré `:class{…}`/`:style.x`/`--var`
    for (const a of view.attrs) {
      const mm = a.name === null ? null : /^@([\w:-]+)\.([\w:.-]*)/.exec(a.name)
      if (!mm) continue
      const msg = t('generator.macro-modifier-not-handled', { evt: mm[1], suffix: mm[2] || '', line: lineOfName?.(a.name ?? '') ?? '' })
      // eslint-disable-next-line no-console
      console.error(`[ModularJS] ❌ ${msg}`)
      errors.push(msg)
      // un nom seul pour valeur (`@resize.once=nom`, `={nom}`, `=@nom`) suit la règle de tout gestionnaire, avec la ligne de
      // l'attribut (cf. checkHandlerReferences) : le modificateur est refusé, le nom absent l'est aussi
      const end = a.start + mm[0].length
      if (attrs[end] === '=') {
        const braces = attrs[end + 1] === '{'
        const start  = braces ? end + 2 : end + 1
        let k        = braces ? a.end - 1 : start
        while (!braces && k < attrs.length && !/[\s>/]/.test(attrs[k])) k++
        const reference = k > start ? HANDLER_REFERENCE_RE.exec(attrs.slice(start, k).trim()) : null
        if (reference) handlerRefs.push({ name: reference[2], method: reference[1] === '@', attr: `@${mm[1]}.${mm[2]}`, braces, line: lineOf?.(`${mm[1]}.${mm[2]}`, true)?.line })
      }
    }

    for (const a of view.attrs) {
      const m = a.name === null ? null : /^@[\w:-]+/.exec(a.name)
      if (!m || a.name?.[m[0].length] === '.') continue
      const ev    = m[0].slice(1)
      const after = a.start + m[0].length
      // Forme abrégée : pas de `={...}` → handler = fonction du nom de l'event.
      let handler: string
      // Corps BRUT (avant tout trim) — conservé pour l'émission multi-lignes
      // ci-dessous ; `null` pour la forme abrégée (pas de corps littéral).
      let rawBody: string | null = null
      if (attrs[after] === '=' && attrs[after + 1] === '{') {
        // le corps tel que l'arbre le lit, accolades équilibrées : un `}` dans le gestionnaire (`@keydown={handle({key:1})}`) ou
        // dans une de ses chaînes (`@keydown={f('}')}`) ne le coupe pas
        rawBody = attrs.slice(after + 2, a.end - 1)
        handler = rawBody.trim()
      }
      else if (attrs[after] === '=' && attrs[after + 1] !== '!') {
        // `@event=ref` SANS accolades (`@resize=onResize`) : référence de fonction, lue jusqu'au prochain espace/`>`/`/`
        // (auto-fermeture `/>`) ; l'auto-appel des identifiants nus (plus bas) la rend `onResize(e)`. Exclut `=!{…}`
        // (liaison two-way `prop=!{$var}`, gérée par parseBindings)
        let k = after + 1
        while (k < attrs.length && !/[\s>/]/.test(attrs[k])) k++
        const ref = attrs.slice(after + 1, k)
        if (ref) handler = ref
        else {
          if (refuseShorthandColon(ev)) continue
          handler = `${ev}(e)`
        }
      }
      else {
        if (refuseShorthandColon(ev)) continue
        handler = `${ev}(e)`
      }
      // Source à émettre : par défaut le corps BRUT multi-lignes (préserve le
      // nesting) ; retombe sur `handler` (single-line) pour la forme abrégée
      // sans accolades.
      let emitSource = rawBody ?? handler
      // Auto-appel si le handler est une RÉFÉRENCE de fonction nue (cf. élément).
      // (`handler` = version whole-string-trim : une référence nue tient
      // toujours sur une seule ligne, donc ce test ne peut JAMAIS matcher un
      // corps multi-lignes structuré — seul le cas bare-reference single-line
      // est concerné.) Si le test matche, la réécriture doit devenir la
      // source d'émission : `rawBody` (non modifié) serait sinon émis SANS
      // le `(e)` ajouté ici → référence nue jamais appelée (régression vécue
      // en écrivant le fix ci-dessous, verrouillée par le test dédié).
      // un nom seul (`@keydown=nom`, `@keydown={nom}`, `@keydown=@nom`) : même contrôle que sur un élément, avec la ligne de
      // l'attribut (cf. checkHandlerReferences, transpiler/lint)
      const reference = HANDLER_REFERENCE_RE.exec(handler)
      // la place de chaque écouteur est relevée (un même événement écrit deux fois se suit, même quand le premier est entre
      // accolades), sa ligne n'est calculée que pour un nom seul
      const listener = lineOf?.(ev, reference !== null)
      const line     = listener?.line
      if (reference) handlerRefs.push({ name: reference[2], method: reference[1] === '@', attr: `@${ev}`, braces: rawBody !== null, line })
      // un mot du langage que Civet ne prend pas pour un nom (`if`), refusé par le transpileur, n'est pas émis : Civet s'arrêterait
      // avant lui, sur une erreur illisible ; `on`, `yes`… (cf. DECLARABLE_KEYWORDS) vont tels quels, déclarés ou refusés
      if (reference?.[1] === '' && LANGUAGE_KEYWORDS.has(reference[2]) && !DECLARABLE_KEYWORDS.has(reference[2])) handler = 'undefined'
      if (/^@{0,2}[a-zA-Z_][\w$.]*$/.test(handler)) {
        handler = `${handler}(e)`
        emitSource = handler
      }
      const fnId = `gl_${(counter++).toString(36)}`
      setupLines.push(`@_${fnId} = (e, _mjs_el) =>`)
      // Émission avec `dedent` + réindentation UNIFORME — PAS un `.trim()`
      // PAR LIGNE (bug d'origine) — pour préserver la structure d'un handler
      // multi-lignes (`if…\n  $x = …`). Un `.trim()` par ligne ramenait
      // TOUTES les lignes au même niveau : en Civet/Coffee (sensible à
      // l'indentation), le `if` se retrouvait avec un corps VIDE et la ligne
      // suivante s'exécutait INCONDITIONNELLEMENT juste après, sans la
      // moindre erreur de compilation (corruption silencieuse de la logique
      // utilisateur). Même algorithme que le chemin inline des éléments
      // (generator/attributes/index.ts, `dedent(...).split('\n')`).
      //
      // On dédente `emitSource` (le corps BRUT quand il existe, AVANT le
      // `.trim()` whole-string qui a produit `handler`), puis on ne retire
      // que les lignes VIDES en tête/fin — sans jamais toucher à
      // l'indentation relative des lignes gardées. Nécessaire : `.trim()` sur
      // toute la chaîne ampute SEULEMENT la 1ʳᵉ ligne de son indentation (elle
      // colle au début du body) ; si on dédentait APRÈS ce trim, deux lignes
      // sœurs à indentation ÉGALE dans la source (`$a = 1\n  $b = 2`, toutes
      // deux à 2 espaces à l'origine) ressortiraient à des niveaux DIFFÉRENTS
      // (0 puis 2) — nouvelle corruption, cette fois sur des instructions qui
      // n'ont pas de lien de nesting. Dédenter le corps brut évite ce piège
      // dans les deux sens.
      // compilé par Civet : ses `x unless c; y`, que Civet compile en JavaScript invalide, réécrits sans changer de ligne
      const aligned      = dedent(alignsOnFirstLine(emitSource))
      const dedentedBody = (opts.civet ? unlessFollowedBySemicolon(aligned) : aligned).split('\n')
      let head           = 0
      while (dedentedBody.length > 0 && dedentedBody[0].trim() === '') {
        dedentedBody.shift()
        head++
      }
      while (dedentedBody.length > 0 && dedentedBody[dedentedBody.length - 1].trim() === '') dedentedBody.pop()
      const bodyLines = dedentedBody.length > 0 ? dedentedBody : [handler]
      // le corps tel qu'écrit, lu après le `={` de son attribut : chaque ligne versée note sa place (cf. setupOrigins)
      const bodyAt = listener && rawBody !== null && emitSource === rawBody && dedentedBody.length > 0 ? listener.start + m[0].length + 2 : -1
      for (const [j, line] of bodyLines.entries()) {
        if (bodyAt >= 0) setupOrigins[setupLines.length] = { html: cleaned, at: bodyAt, body: rawBody!, row: head + j }
        setupLines.push(`  ${line}`)
      }
      if (bodyAt >= 0) setupHandlers.push({ fn: `_${fnId}`, origin: { html: cleaned, at: bodyAt, body: rawBody!, row: head } })
      // le gestionnaire tourne hors du calcul en cours (runtime/mjs_signals.ts) : déclenché pendant le passage d'un reffet, de ce composant ou
      // d'un autre, ses lectures sont les siennes ; un cœur sans graphe des signaux le laisse tel quel (runtime/mjs_element.ts)
      setupLines.push(`@_${fnId} = µ._mjs_sigFree(@_${fnId})`)
      attachLines.push(`${targetJs}.addEventListener('${ev}', @_${fnId})`)
      teardownLines.push(`${targetJs}.removeEventListener('${ev}', @_${fnId})`)
    }
  }

  // Parse les LIAISONS `prop=!{$var}` d'un <@window> → liaison réactive auto sur
  // une propriété de window (scrollY, innerWidth…). Équivalent des bind:* de
  // <svelte:window>. Réservé à <@window> (comme Svelte).
  //   <@window scrollY=!{$y} innerWidth=!{$w} />
  const parseBindings = (attrs: string, macro: string) => {
    const bindRe = /\b([a-zA-Z]\w*)=!\{([^}]+)\}/g
    let m: RegExpExecArray | null
    // ailleurs que sur <@window>, une liaison ne lie rien : refusée, jamais jetée sans un mot
    if (macro !== 'window') {
      while ((m = bindRe.exec(attrs)) !== null) {
        const msg = t('transpiler.binding-reserved-window', { macro, prop: m[1], bindable: Object.keys(WINDOW_BINDABLE).join(', ') })
        // eslint-disable-next-line no-console
        console.error(`[ModularJS] ❌ ${msg}`)
        errors.push(msg)
      }
      return
    }
    while ((m = bindRe.exec(attrs)) !== null) {
      const prop = m[1]
      const varExpr = m[2].trim()           // ex. `$y`
      // lookup par hasOwnProperty : `WINDOW_BINDABLE[prop]` nu rendait une
      // fonction TRUTHY pour un nom hérité de Object.prototype (`constructor`, `toString`,
      // `hasOwnProperty`…), contournant le garde `!def` ci-dessous — `def.events` (undefined sur
      // cette fonction native) faisait alors planter le `for…of` plus bas avec un TypeError NON
      // rattrapé au lieu du message propre.
      const def = Object.prototype.hasOwnProperty.call(WINDOW_BINDABLE, prop) ? WINDOW_BINDABLE[prop] : undefined
      if (!def) {
        // erreur de construction : une faute de frappe (`scrolY`) laissait la liaison morte, construction verte
        const msg = t('transpiler.window-property-not-bindable', { prop, bindable: Object.keys(WINDOW_BINDABLE).join(', ') })
        // eslint-disable-next-line no-console
        console.error(`[ModularJS] ❌ ${msg}`)
        errors.push(msg)
        continue
      }
      // 1. valeur initiale (au setup, une fois)
      setupLines.push(`${varExpr} = ${def.read}`)
      // 2. handler de rafraîchissement + attache/détache symétrique (awake/sleep)
      const fnId = `glb_${(counter++).toString(36)}`
      setupLines.push(`@_${fnId} = (e, _mjs_el) =>`)
      setupLines.push(`  ${varExpr} = ${def.read}`)
      for (const ev of def.events) {
        attachLines.push(`window.addEventListener('${ev}', @_${fnId})`)
        teardownLines.push(`window.removeEventListener('${ev}', @_${fnId})`)
      }
      // 3. two-way (scroll seulement) : un µeffect pousse la var vers window.
      if (def.write) {
        setupLines.push('µeffect =>')
        setupLines.push(`  ${def.write(varExpr)}`)
      }
    }
  }

  // Scanne un bloc { … } à profondeur ÉQUILIBRÉE à partir de l'indice JUSTE
  // APRÈS l'accolade ouvrante (même technique que dans parseListeners, pour
  // capter des accolades/parenthèses imbriquées dans une condition/expression).
  // Retourne le corps et l'indice JUSTE APRÈS la '}' fermante.
  const scanBraces = (s: string, start: number): { body: string; end: number } => {
    let k = start, depth = 1, body = ''
    while (k < s.length && depth > 0) {
      const c = s[k]
      if (c === '{') depth++
      else if (c === '}') { depth--; if (depth === 0) break }
      body += c
      k++
    }
    return { body, end: k + 1 }
  }

  // Parse + retire les liaisons class/style d'une macro globale, lues parmi les attributs que l'arbre du gabarit lit sur la
  // balise (jamais dans une valeur ni dans le corps d'un gestionnaire) :
  //   :class{cond}="a b" | :style.prop={expr} | --var={expr} | class="a b" | style="…"
  // RÉSERVÉES à <@body>/<@html> (macro === 'body' || 'html') : sur les autres cibles (window/document/head), toute forme
  // détectée devient une ERREUR de compile — jamais un codegen silencieux, ni laissée filer vers `parseListeners`. D'où
  // l'appel à cette fonction AVANT `parseListeners`, quelle que soit la cible, et le retour des attributs RESTANTS (les
  // formes reconnues sont toujours retirées, même quand c'est une erreur). Chaque forme est lue à son tour, dans cet ordre
  // (celui du code émis) ; une forme mal écrite (`:class{c}` sans valeur entre guillemets doubles collée) reste telle quelle
  const parseStyling = (view: MacroAttrs, macro: string, targetJs: string): MacroAttrs => {
    const allowed = macro === 'body' || macro === 'html'
    const s       = view.text
    const used    = new Set<MacroAttr>()
    // la valeur entre guillemets doubles collée à `at` (un `=` y est : le nom de l'attribut ou sa condition finit là), jusqu'à
    // la fin de l'attribut : son texte, null sinon
    const quoted = (a: MacroAttr, at: number): string | null => (a.value === 'text' && s[at] === '=' && s[at + 1] === '"' && a.end > at + 2 && s[a.end - 1] === '"' ? s.slice(at + 2, a.end - 1) : null)
    // la valeur entre accolades collée au nom : son dedans, null sinon
    const braced = (a: MacroAttr, name: string): string | null => {
      const at = a.start + name.length
      return (a.value === 'code' || a.value === 'raw') && s[at] === '=' && s[at + 1] === '{' ? s.slice(at + 2, a.end - 1) : null
    }
    // les attributs d'une forme, dans l'ordre où ils sont écrits : `read` rend sa valeur, null pour une autre forme
    const each = <T>(read: (a: MacroAttr, name: string) => T | null, visit: (value: T) => void): void => {
      for (const a of view.attrs) {
        const value = used.has(a) || a.name === null ? null : read(a, a.name)
        if (value === null) continue
        used.add(a)
        if (allowed) visit(value)
      }
    }
    const styleProp = new RegExp('^' + SIGN_RE + String.raw`style\.([\w-]+)$`)

    // 1. :class{cond}="a b" — la condition entre accolades, les classes entre guillemets doubles collés à elle
    each((a, name) => {
      if (a.kind !== 'class' || name !== `${SIGN}class`) return null
      const open    = s.lastIndexOf('"', a.end - 2)
      const classes = open > a.start && s[open - 2] === '}' ? quoted(a, open - 1) : null
      return classes === null ? null : { cond: s.slice(a.start + name.length + 1, open - 2), classes: classes.split(/\s+/).filter(Boolean) }
    }, ({ cond, classes }) => {
      setupLines.push('µeffect =>')
      // classe en chaîne échappée : une apostrophe (`bg-[url('/a.png')]`) refermait sinon la chaîne produite
      for (const cls of classes) setupLines.push(`  µ._glCl(@, ${targetJs}, ${quoteHeadLiteral(cls)}, !!(${cond.trim()}))`)
      for (const cls of classes) teardownLines.push(`µ._glCl(@, ${targetJs}, ${quoteHeadLiteral(cls)}, false)`)
    })

    // 2. :style.<prop>={expr} — prop kebab-case, expr entre accolades
    each((a, name) => {
      const prop = styleProp.exec(name)?.[1]
      const expr = prop ? braced(a, name) : null
      return expr === null ? null : { prop, expr }
    }, ({ prop, expr }) => {
      setupLines.push('µeffect =>')
      setupLines.push(`  µ._glSt(@, ${targetJs}, '${prop}', (${expr.trim()}))`)
      teardownLines.push(`µ._glSt(@, ${targetJs}, '${prop}', null)`)
    })

    // 3. --<var>={expr} — même mécanique que 2, prop émise = '--<var>'
    each((a, rawName) => {
      const name = /^--([a-zA-Z_][\w-]*)$/.exec(rawName)?.[1]
      const expr = name ? braced(a, rawName) : null
      return expr === null ? null : { name, expr }
    }, ({ name, expr }) => {
      setupLines.push('µeffect =>')
      setupLines.push(`  µ._glSt(@, ${targetJs}, '--${name}', (${expr.trim()}))`)
      teardownLines.push(`µ._glSt(@, ${targetJs}, '--${name}', null)`)
    })

    // 4. class="a b" statique : un nom qui finit par `class` derrière un signe (`:class="a"`) ou seul
    each((a, name) => (/(?:^|\W)class$/.test(name) ? quoted(a, a.start + name.length) : null), (raw) => {
      if (raw.includes('{')) {
        errors.push(t('transpiler.macro-class-interpolation-not-supported', { macro }))
        return
      }
      const classes = raw.split(/\s+/).filter(Boolean)
      for (const cls of classes) attachLines.push(`µ._glCl(@, ${targetJs}, ${quoteHeadLiteral(cls)}, true)`)
      for (const cls of classes) teardownLines.push(`µ._glCl(@, ${targetJs}, ${quoteHeadLiteral(cls)}, false)`)
    })

    // 5. style="…" statique → TOUJOURS une erreur (règle MJS zéro-CSS-inline), y compris sur <@body>/<@html> où les 4 formes
    //    précédentes sont valides
    each((a, name) => (/(?:^|\W)style$/.test(name) ? quoted(a, a.start + name.length) : null), () => {
      errors.push(t('transpiler.macro-style-inline-forbidden', { macro }))
    })

    if (!allowed && used.size > 0) {
      errors.push(t('transpiler.macro-class-not-supported-target', { macro }))
    }

    return { text: s, attrs: view.attrs.filter((a) => !used.has(a)) }
  }

  // Attribut `accept="a b"` de <@element>/<@module> :
  // liste LITTÉRALE de noms de balises (statique, insensible à la casse du NOM `accept` comme
  // des valeurs), TOUJOURS retirée des attributs rendus (jamais un vrai attribut DOM). Émise en
  // 4ᵉ argument de µ._updDynEl/µ._updModule (runtime déjà en place, cf. mjs_runes.ts
  // µ._mjs_dynTagsRefuses) : PRÉSENT, ce 4ᵉ argument devient côté runtime une liste FERMÉE —
  // seuls les noms qu'il contient sont créés, pool ou pas.
  // Absente → { accept: null } (appel runtime à 3 arguments, byte-identique à l'ancien).
  // Invalide (vide, dynamique `accept={…}`, nom hors `[a-zA-Z][\w-]*`) → erreur de compile ET
  // quand même retirée (jamais laissée fuiter sur l'élément) ; `accept: null` en retour, comme
  // absente. Doublons tolérés (dédoublonnés, insensible à la casse).
  const TAG_NAME_RE = /^[a-zA-Z][\w-]*$/
  // stripOneAccept — extrait UNE occurrence d'`accept=…` (guillemets ou accolades), sans juger
  // de sa validité ; extractAcceptAttr ci-dessous l'appelle EN BOUCLE pour purger un doublon
  // (`.exec()` seul ne prenait que la 1ʳᵉ occurrence, la 2ᵉ fuyait telle quelle dans le HTML rendu).
  const stripOneAccept = (s: string): { rest: string; value: string | null; dynamic: boolean } => {
    const m = /(?<=^|\s)accept\s*=\s*/i.exec(s)
    if (!m) return { rest: s, value: null, dynamic: false }
    let wsStart = m.index
    while (wsStart > 0 && /\s/.test(s[wsStart - 1])) wsStart--
    const eqEnd = m.index + m[0].length
    const delim = s[eqEnd]
    let value: string | null = null, spanEnd = eqEnd, dynamic = false
    if (delim === '"' || delim === '\'') {
      const close = s.indexOf(delim, eqEnd + 1)
      if (close !== -1) { value = s.slice(eqEnd + 1, close); spanEnd = close + 1 }
    } else if (delim === '{') {
      const { body, end } = scanBraces(s, eqEnd + 1)
      value = body.trim()
      spanEnd = end
      dynamic = true
    }
    if (value === null) return { rest: s, value: null, dynamic: false }    // délimiteur absent/non reconnu : pas notre affaire
    const rest = (s.slice(0, wsStart) + s.slice(spanEnd)).trim()
    return { rest, value, dynamic }
  }
  const extractAcceptAttr = (attrs: string): { rest: string; accept: string[] | null } => {
    const first = stripOneAccept(attrs)
    if (first.value === null) return { rest: attrs, accept: null }
    const value = first.value, dynamic = first.dynamic, rest1 = first.rest
    // `accept` DUPLIQUÉ (`accept="a" accept="b"`) :
    // purge TOUTES les occurrences restantes (au cas où il y en aurait plus de deux) ; deux ou
    // plus = erreur, valeur citée = la 2ᵉ occurrence.
    const second = stripOneAccept(rest1)
    if (second.value !== null) {
      let rest = second.rest
      let extra = stripOneAccept(rest)
      while (extra.value !== null) { rest = extra.rest; extra = stripOneAccept(rest) }
      errors.push(t('transpiler.element-accept-invalid', { value: second.value }))
      return { rest, accept: null }
    }
    const names = value.split(/\s+/).filter(Boolean)
    if (dynamic || names.length === 0 || !names.every(n => TAG_NAME_RE.test(n))) {
      errors.push(t('transpiler.element-accept-invalid', { value: value }))
      return { rest: rest1, accept: null }
    }
    return { rest: rest1, accept: [...new Set(names.map(n => n.toLowerCase()))] }
  }

  // La variable de balise (1ʳᵉ valeur après le nom
  // de macro) doit venir AVANT les attributs : `<@element accept="iframe" $tag>` faisait avaler
  // `accept="iframe"` comme EXPRESSION de balise (compile en `µ._updDynEl(@, '0', (accept="iframe"))`)
  // et laissait `$tag` fuir tel quel dans le HTML rendu, SANS erreur — même défaut avec n'importe
  // quel attribut en tête (`title="x"`). `nom=valeur`/`nom={…}` en 1ʳᵉ position = un attribut,
  // jamais une expression de balise valide (qui commence par `$`, un identifiant seul, une
  // parenthèse…) : erreur de build, rien émis en setup.
  const ATTR_LIKE_RE = /^[A-Za-z_][\w-]*=/
  // Un attribut BOOLÉEN sans `=` en tête (`<@element hidden $tag>`)
  // échappait à ATTR_LIKE_RE (qui exige un `=`) : `hidden` ressemble à un identifiant nu ORDINAIRE
  // (aucun `$`/`{`/guillemet/µ/@ devant), avalé tel quel comme expression de balise, `$tag` fuyait
  // en HTML sans erreur. `<@element tag>` seul (rien après) reste licite (variable de module
  // possible) : la détection ne regarde le token nu qu'EN PRÉSENCE d'un token plus loin qui, lui,
  // ressemble bien à une variable — cf. site d'appel.
  const BARE_IDENT_RE = /^[A-Za-z_][\w-]*$/
  const reportExpectedVariable = (macro: string, wholeTag: string): string => {
    const excerpt = Array.from(wholeTag).slice(0, 60).join('').replace(/\n/g, ' ')
    const msg = t('transpiler.element-variable-expected', { macro, excerpt: excerpt })
    // eslint-disable-next-line no-console
    console.error(`[ModularJS] ❌ ${msg}`)
    errors.push(msg)
    return ''
  }
  // 1ʳᵉ valeur COMMENÇANT par `{` (`<@element {a || 'div'}>`) :
  // aucune forme entre accolades n'est documentée (docs/15 : « le tag EST la variable », calcul dans
  // une dérivée `$tag = …`). `extrait` = le token `{…}` COMPLET via scanBraces (jamais tronqué au 1er
  // espace interne, contrairement à l'ancien découpage `raw.search(/\s/)` qui laissait le reste fuir
  // en HTML sans erreur — cf. site d'appel).
  const reportForbiddenExpression = (macro: string, excerpt: string): string => {
    const msg = t('transpiler.element-expression-forbidden', { macro, excerpt: excerpt })
    // eslint-disable-next-line no-console
    console.error(`[ModularJS] ❌ ${msg}`)
    errors.push(msg)
    return ''
  }

  // une balise <@element> ou <@module> (`at` : sa place dans `text`, le HTML que lit sa passe) écrite dans le repli d'un <@failed>,
  // que sa passe lit avant celle du repli (elle la recevait faite en un <div> muet, balise jamais créée, ou vide, composant jamais
  // monté, sans un mot) : refusée à sa ligne comme les autres balises du langage (cf. FALLBACK_LANGUAGE_TAGS), une ouvrante `<div>`
  // face à sa fermante ; citée dans un exemple, gardée telle qu'écrite ; null hors d'un repli (cf. fallbackDynamicTags). Les replis
  // de `text` ne sont lus qu'à la première de ces balises
  const dynamicTagInFallback = (text: string): ((at: number, wholeTag: string, line: number | string | null) => string | null) => {
    let read: { live: Set<number>, examples: Array<[number, number]> } | undefined
    return (at, wholeTag, line) => {
      read ??= fallbackDynamicTags(text, opts.dialect === true)
      if (read.examples.some(([start, end]) => start < at && at < end)) return wholeTag
      if (!read.live.has(at)) return null
      errors.push(t('transpiler.failed-language-tag', { name: /^<(@[\w-]+)/.exec(wholeTag)![1], line: String(line) }))
      return '<div>'
    }
  }

  // 0. <@element $var …attrs…>enfants</@element> → BALISE DYNAMIQUE
  //    (équivalent de <svelte:element>). Le tag est la VARIABLE/expression (1ʳᵉ
  //    valeur après `@element`) : `<@element $tag>`. Pas d'attribut `tag=` à
  //    apprendre, et pas de tag en string en dur (autant écrire la balise
  //    directement). On rend un placeholder <div mjs-el="N"> avec les enfants
  //    (rendus normalement, réactifs) ; un µeffect appelle µ._updDynEl(@, 'N',
  //    (EXPR)) qui swappe le vrai tag au mount + à chaque changement (déplace
  //    les enfants, copie les attrs). `</@element>` → `</div>`. Attributs HTML
  //    statiques optionnels après le tag ; attrs et événements réactifs suivis à travers le remplacement de nœud (resync `_mjs_nodes`/`_mjs_ev`, cf. mjs_runes.ts).
  let elCounter = 0
  const elementInFallback = dynamicTagInFallback(cleaned)
  cleaned = replaceOpenTag(cleaned, 'element', true, errors, (attrs, wholeTag, lineAt, _names, at) => {
    // dans le repli d'un <@failed> : refusée, une ouvrante `<div>` face à la fermante `</div>` (cf. le cas `raw` vide plus bas), ou
    // citée dans un exemple, telle qu'écrite
    const inFallback = elementInFallback(at, wholeTag, lineAt(0))
    if (inFallback !== null) return inFallback
    // le texte des attributs (cf. replaceOpenTag), trimé
    const rawBody = attrs.text.trim()
    // Auto-fermeture interdite (rejet explicite, à la
    // place du STRIP SILENCIEUX d'origine `.replace(/\/+$/, '')`, cf. header
    // de fonction).
    if (/\/+$/.test(rawBody)) return reportSelfCloseForbidden('element')
    const raw = rawBody
    // `raw` VIDE (`<@element>` seul, ou `<@element :size="…">` dont `:size` est retiré, cf. withoutSize) : refusé, et une ouvrante
    // `<div>` face à la fermante `</div>` (remplacement global juste après cette fonction) — sans elle, la fermante orpheline faisait
    // échouer la lecture du gabarit par-dessus le refus
    if (!raw) {
      reportExpectedVariable('element', wholeTag)
      return '<div>'
    }
    // 1ʳᵉ valeur À ACCOLADES (`<@element {a || 'div'}>`) : erreur explicite, extrait
    // = le token `{…}` complet (scanBraces), AVANT le découpage au 1er espace ci-dessous (qui
    // tronquait sinon l'expression et laissait son reste fuir en HTML).
    if (raw[0] === '{') { const { end } = scanBraces(raw, 1); return reportForbiddenExpression('element', raw.slice(0, end)) }
    // tag = la variable/expression (1ʳᵉ valeur, sans espace) ; le reste = attrs.
    const i = raw.search(/\s/)
    const tagExpr = i < 0 ? raw : raw.slice(0, i)
    const afterTag = i < 0 ? '' : raw.slice(i + 1).trim()
    if (ATTR_LIKE_RE.test(tagExpr) || (BARE_IDENT_RE.test(tagExpr) && /(^|\s)[$\{]/.test(afterTag))) return reportExpectedVariable('element', wholeTag)
    const { rest, accept } = extractAcceptAttr(afterTag)
    const key = String(elCounter++)    // `=>` (fat arrow) pour que `@` = le composant (l'IIFE est .call(this) ;
    // les effets du générateur capturent `this` pareil). Un `->` aurait `this`
    // = l'objet effet → `@._shadow` undefined.
    setupLines.push('µeffect =>')
    // `accept` en 4ᵉ argument SEULEMENT s'il est présent et valide ;
    // sinon appel à 3 arguments, inchangé (byte-identique aux composants sans `accept`).
    setupLines.push(`  µ._updDynEl(@, '${key}', (${tagExpr})${accept ? `, [${accept.map(a => `'${a}'`).join(', ')}]` : ''})`)
    return `<div mjs-el="${key}"${rest ? ' ' + rest : ''}>`
  }, undefined, cite, opts.dialect === true)
  cleaned = closeDynamicTags(cleaned, /<\/@element>/gi, opts.dialect === true)

  // 0a. <@module $comp …attrs…>enfants</@module> → COMPOSANT DYNAMIQUE
  //     (équivalent de <svelte:component this={X}>). `$comp` (1ʳᵉ valeur) désigne
  //     le composant à monter : soit un NOM de tag (chaîne kebab d'un custom
  //     element MJS défini, le cas idiomatique), soit une CLASSE/constructeur.
  //     µ._updModule, appelé par le générateur dans la portée du nœud, instancie le
  //     COMPOSANT (createElement pour un tag, `new` best-effort pour une classe),
  //     déplace les enfants (light DOM → slots), pose les props dynamiques en valeurs
  //     typées, et re-monte si $comp change. `</@module>` → `</div>`.
  let modCounter = 0
  const moduleInFallback = dynamicTagInFallback(cleaned)
  cleaned = replaceOpenTag(cleaned, 'module', true, errors, (attrs, wholeTag, lineAt, _names, at) => {
    // dans le repli d'un <@failed> : cf. commentaire jumeau sur <@element> ci-dessus
    const inFallback = moduleInFallback(at, wholeTag, lineAt(0))
    if (inFallback !== null) return inFallback
    // cf. commentaire jumeau sur <@element> ci-dessus.
    const rawBody = attrs.text.trim()
    // Même rejet explicite que <@element> ci-dessus.
    if (/\/+$/.test(rawBody)) return reportSelfCloseForbidden('module')
    const raw = rawBody
    // cf. commentaire jumeau sur <@element> ci-dessus.
    if (!raw) return reportExpectedVariable('module', wholeTag)
    // cf. commentaire jumeau sur <@element> ci-dessus.
    if (raw[0] === '{') { const { end } = scanBraces(raw, 1); return reportForbiddenExpression('module', raw.slice(0, end)) }
    // comp = la variable/expression (1ʳᵉ valeur, sans espace) ; le reste = attrs.
    const i = raw.search(/\s/)
    const compExpr = i < 0 ? raw : raw.slice(0, i)
    const afterComp = i < 0 ? '' : raw.slice(i + 1).trim()
    if (ATTR_LIKE_RE.test(compExpr) || (BARE_IDENT_RE.test(compExpr) && /(^|\s)[$\{]/.test(afterComp))) return reportExpectedVariable('module', wholeTag)
    const { rest, accept } = extractAcceptAttr(afterComp)
    const key = String(modCounter++)
    // pas d'effet posé ici : l'expression du composant et les props dynamiques sont évaluées par le
    // générateur dans la portée du nœud (ligne de `{for}`, branche `{if}`), cf. bindingModule
    // (generator/attributes/index.ts). `accept` voyage en attribut fixe `mjs-accept`, retiré du rendu.
    return `<div mjs-mod="${key}" mjs-comp={${compExpr}}${accept ? ` mjs-accept="${accept.join(' ')}"` : ''}${rest ? ' ' + rest : ''}>`
  }, undefined, cite, opts.dialect === true)
  cleaned = closeDynamicTags(cleaned, /<\/@module>/gi, opts.dialect === true)

  // 0b. <@failed args>…</@failed> → FALLBACK d'error boundary (équivalent du
  //     snippet `failed` de svelte:boundary). Compilé en builder DOM statique
  //     (`@_mjs_fallback`), rendu par `_mjs_catchError` au crash. Les `@click=reset`
  //     y sont de vrais listeners ; pas de marqueur `mjs-reset`.
  //
  // Auto-fermeture interdite. La regex PRINCIPALE
  // ci-dessous exige déjà une fermeture explicite `</@failed>` : un
  // `<@failed/>` (ou `<@failed err reset/>`) ne la matche JAMAIS et
  // retomberait NON TRAITÉ sur le parser générique (tag custom `@failed`
  // inconnu) sans ce pré-scan dédié, en amont.
  cleaned = replacePairedTag(
    cleaned,
    'failed',
    errors,
    (params, content, at) => {
      const { setup, head, body } = compileFailedBlock(params.text, content, errors, contentLines(at, content), sigil, handlerRefs, tagRefs)
      for (const l of setup) setupLines.push(l)
      setupLines.push(head)
      for (const l of body) setupLines.push(`  ${l}`)
      return ''
    },
    () => reportSelfCloseForbidden('failed'),
    cite,
    opts.dialect === true
  )

  // 1. <@head>…contenu…</@head> → INJECTION de contenu dans document.head,
  //    réactive (équivalent de <svelte:head>). Le contenu est rendu dans un
  //    µeffect : ses `$x` re-déclenchent l'injection (µ._setHead réconcilie).
  //
  // ÉCART vs la demande initiale — <@head> N'EST PAS ajouté au
  // garde-fou auto-fermeture ci-dessous (contrairement à <@element>/<@module>/
  // <@failed>) : DÉCOUVERTE en écrivant les tests — `head` est AUSSI une clé de
  // TARGETS (juste plus bas, boucle "2. Macros « écouteurs »"), donc
  // <@head @event={...} /> est un DEUXIÈME usage 100% légitime et déjà testé
  // (`processGlobalMacros` — même famille que <@window>/<@document>/<@body>/
  // <@html>, PAS celle d'<@include>/<@failed>). `<@head/>` bare NE tombe donc
  // JAMAIS non traité sur le parser générique (contrairement à ce qu'on
  // pensait) : la boucle TARGETS l'absorbe déjà comme un écouteur (vide =
  // no-op silencieux, exactement comme `<@window/>` bare) — rejeter cette
  // forme casserait un mécanisme qui marche. Un rejet CIBLÉ (uniquement pour
  // l'usage « injection de contenu », qu'aucun texte ne permet de distinguer
  // syntaxiquement d'un « listener vide ») a été jugé trop fragile pour la
  // valeur qu'il apporte.
  cleaned = replacePairedTag(cleaned, 'head', errors, (attrs, content, at) => {
    // parseStyling AVANT parseListeners (même raison que la boucle TARGETS
    // ci-dessous) : <@head> ne supporte pas les liaisons class/style → erreur.
    parseBindings(attrs.text, 'head')
    const styled = parseStyling(attrs, 'head', 'document.head')
    parseListeners(styled, 'document.head')
    const inner = content.trim()
    if (inner) {      // `=>` pour que `@` = le composant (réconciliation + teardown corrects).
      const lines = contentLines(at, content)
      // un `<script>` exécutable posé ici part dans le <head> par innerHTML : le navigateur ne l'exécute jamais. Averti,
      // jamais refusé (un script de données, JSON-LD, y a sa place). Seule une vraie balise compte : la recherche se fait
      // hors commentaires et hors valeurs d'attribut (même longueur), ses attributs se relisent dans le texte écrit
      const view = attrValueMask(maskHtmlComments(inner))
      for (const m of view.matchAll(/<script\b[^>]*>/gi)) {
        const attrs = inner.slice(m.index + '<script'.length, m.index + m[0].length - 1)
        if (headScriptRuns(attrs)) warnings.push(t('transpiler.head-script-inert', { line: lines(countNewlines(inner.slice(0, m.index))) }))
      }
      // une <@@img> n'a pas sa place dans l'en-tête du document, qui ne s'affiche jamais : refusée à sa ligne (elle y partait en
      // texte, l'image copiée pour rien)
      for (const tag of imgTagsInBlock(content, 'head')) errors.push(t('transpiler.head-image', { line: lines(countNewlines(content.slice(content.length - content.trimStart().length, tag.start))) }))
      setupLines.push('µeffect =>')
      const head = buildHeadInjection(inner, 'head', errors, lines, sigil)
      setupLines.push(`  µ._setHead(@, ${head.html}${head.raw ? ', true' : ''})`)
      teardownLines.push('µ._clearHead(@)')
    }
    return ''
  }, undefined, cite, opts.dialect === true)

  // Effets de toute la page sur <@document> (la souris : `*ripple` ; la langue : `*lang` ;
  // les autres visiteurs : `*cursors`) : posés sur la racine du document à chaque réveil, retirés à
  // chaque sommeil — valeurs fixes seulement (aucun nœud du gabarit pour suivre une variable), sauf la
  // connexion d'un effet en direct : sa variable (`sock: $$sock`, suivie), sinon `@sock` du composant ;
  // tout autre effet y est refusé, avec la liste de ceux qui y vont
  let docFx = 0
  let docProject = false
  const docSock: string[] = []
  // une valeur dans le code du <script> : en chaîne JSON, sans symbole que le lexer prendrait pour une variable
  const asCode = (v: unknown): string => JSON.stringify(v).replace(/\$/g, '\\u0024').replace(/@/g, '\\u0040')
  const keepDocEffect = (name: string, raw: string): void => {
    // `*ripple.rouge` : un alias se pose là où l'effet qu'il règle se pose, c'est cet effet qui part sur la page
    const effect = name.split('.')[0]
    if (!DOC_EFFECTS.includes(effect)) {
      errors.push(t('effects.document', { name, list: DOC_EFFECTS.map(n => '*' + n).join(', ') }))
      return
    }
    let parsed
    try {
      parsed = parseEffect(name, raw)
    }
    catch (e) {
      errors.push((e as Error).message)
      return
    }
    if (Object.keys(parsed.dynamic).some(k => k !== 'sock')) {
      errors.push(t('effects.document-variable', { name }))
      return
    }
    // *spotlight ne va sur la page qu'en voile : le halo et le liseré dessinent dans la balise, ils n'ont rien à faire sur <html>
    if (effect === 'spotlight' && parsed.fixed.where !== 'veil') {
      errors.push(t('effects.document', { name, list: DOC_EFFECTS.filter(n => n !== effect).map(n => '*' + n).join(', ') }))
      return
    }
    const key    = `_mjs_fxDoc${docFx++}`
    if (name !== effect) docProject = true
    const written = parsed.dynamic.sock
    const sock    = written ?? (effectSpec(name)?.settings.sock && !('server' in parsed.fixed) ? '@sock' : null)
    if (!sock) {
      attachLines.push(`@${key} = µ._mjs_fx(@, document.documentElement, ${JSON.stringify(effect)}, ${JSON.stringify(parsed.fixed)})`)
      teardownLines.push(`@${key}?()`)
      return
    }
    if (!written) docSock.push(effect)
    const rule = asCode({ sock: ['v', written ?? '', t('effects.rule-connection')] })
    attachLines.push(`@${key} = µ._mjs_fx(@, document.documentElement, ${JSON.stringify(effect)}, ${JSON.stringify(parsed.fixed)}, { sock: ${sock} }, ${rule})`)
    teardownLines.push(`@${key}?()`)
    // une connexion rangée plus tard dans sa variable (un store rempli à la connexion de l'utilisateur) :
    // l'effet s'y rebranche
    if (written) {
      setupLines.push('µeffect =>')
      setupLines.push(`  µ._mjs_fxSet(document.documentElement, ${JSON.stringify(effect)}, { sock: ${sock} }, ${rule})`)
    }
  }

  // la faute d'un alias pointé (`*ripple.rouge`) sur <@document> cite la ligne de sa balise, juste après le nom de l'alias, comme sur une
  // balise HTML ; `line` n'est demandée que si une faute vient d'être posée. Les fautes d'un effet sans alias gardent leur texte
  const keepDocLine = (name: string, raw: string, line: () => number | null): void => {
    const before = errors.length
    keepDocEffect(name, raw)
    const start = `[ModularJS] *${name}`
    for (let i = before; i < errors.length; i++) {
      const lineNo = name.includes('.') && errors[i].startsWith(start) ? line() : null
      if (lineNo !== null) errors[i] = start + t('bundler.transpile-msg.effect-line', { line: String(lineNo) }) + errors[i].slice(start.length)
    }
  }

  // 2. Macros « écouteurs » (window/document/body/html + <@head/> résiduels sans contenu).
  for (const macro of Object.keys(TARGETS)) {
    const targetJs = TARGETS[macro]
    // Open tag avec attributs : <@window @click={...}>
    cleaned = replaceOpenTag(cleaned, macro, false, errors, (attrs, _tag, lineAt, names) => {
      parseBindings(attrs.text, macro)
      // parseStyling AVANT parseListeners : le strip des formes @class{…}/
      // @style.prop/--var DOIT arriver avant, sinon @class{…} reste matché par
      // parseListeners comme un écouteur fantôme de l'événement « class ».
      const styled = parseStyling(attrs, macro, targetJs)
      // la ligne d'un écouteur dans le fichier, cherchée parmi les attributs de la balise telle qu'écrite, par leur nom entier
      // (`@scroll` n'est ni le début de `@scrollend`, ni le texte « @scroll » d'un gestionnaire, ni la valeur `@scroll` d'un autre
      // attribut) ; chaque écouteur avance le curseur de son événement (un même événement écrit deux fois se suit), la ligne n'est
      // calculée que pour un gestionnaire fait d'un nom seul (`wanted`)
      let written: Array<{ name: string; at: number; start: number }> | undefined
      const next: Record<string, number> = {}
      parseListeners(styled, targetJs, (ev, wanted) => {
        written ??= names()
        const i = written.findIndex((a, k) => a.name === `@${ev}` && k >= (next[ev] ?? 0))
        if (i === -1) return undefined
        next[ev] = i + 1
        // un gestionnaire écrit dans un partiel ne garde pas de ligne : sa vérification cite celles du composant
        const line = wanted ? lineAt(written[i].at - macro.length - 2) : null
        return { line: typeof line === 'number' ? line : undefined, start: written[i].start }
      }, (name) => {
        // la ligne d'un attribut refusé (modificateur), dans le partiel qui l'écrit compris
        const writtenAttr = (written ??= names()).find((a) => a.name === name)
        return writtenAttr ? lineAt(writtenAttr.at - macro.length - 2) : undefined
      })
      return ''
    }, macro === 'document' ? keepDocLine : undefined, cite, opts.dialect === true)
    // Close tag : </@window>
    const closeRe = new RegExp(`</@${macro}>`, 'gi')
    cleaned = cleaned.replace(closeRe, '')
  }

  let setup = ''
  let teardown = ''
  if (setupLines.length > 0 || attachLines.length > 0) {
    setup = '\n' + setupLines.join('\n')
    if (attachLines.length > 0) {
      // Attache à CHAQUE réveil (hook awake, toute connexion au DOM).
      // addEventListener déduplique un même (cible, type, handler) →
      // ré-attache idempotente. IIFE Civet `((p = …) => …)()` — PAS `do (p) =>`,
      // qui compile en un do-block `{ (p) => {…} }` (flèche JAMAIS appelée) →
      // le hook n'était jamais réassigné → AUCUN listener <@window>/<@document>/
      // <@body> ne s'attachait (keydown/scroll/resize inertes). Le `)()` final
      // l'invoque. Chaînage via l'API interne `_mjs_hook` (map `_mjs_hooks`).
      setup += '\n' +
        '((_mjs_prevAwake = @_mjs_hooks?.awake) =>\n' +
        '  @_mjs_hook \'awake\', =>\n' +
        attachLines.map(l => `    ${l}`).join('\n') + '\n' +
        '    _mjs_prevAwake?()\n' +
        ')()\n'
    }
  }
  if (teardownLines.length > 0) {
    // Détache à CHAQUE mise en sommeil (hook sleep) — avant, le teardown était
    // chaîné sur le hook destroy… que le runtime n'invoquait JAMAIS : chaque
    // <@window> laissait son listener sur window à vie (fuite + handler tirant
    // sur un composant démonté). Le couple awake/sleep est symétrique et survit
    // aux hibernations (pageCache) ; les nœuds <@head> sont retirés au sleep et
    // ré-injectés au réveil par leur µeffect (re-run au mount). Chaînage via
    // l'API interne `_mjs_hook` (map `_mjs_hooks`).
    teardown = '\n' +
      '((_mjs_prevSleep = @_mjs_hooks?.sleep) =>\n' +
      '  @_mjs_hook \'sleep\', =>\n' +
      teardownLines.map(l => `    ${l}`).join('\n') + '\n' +
      '    _mjs_prevSleep?()\n' +
      ')()\n'
  }

  return { html: cleaned, setup, teardown, errors, warnings, docSock, usesProjectEffects: docProject, handlerRefs, tagRefs, setupOrigins, setupHandlers }
}
