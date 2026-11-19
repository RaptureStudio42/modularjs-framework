// transpiler/index — orchestrateur du cycle .mjs → JS bundlé.
// Port de la V1 Ruby, transpiler.rb (parse_and_analyze + inject_template).
//
// Pipeline :
//   1. Lit le fichier source .mjs
//   2. Extrait directives racines (@css, @display, @persist, @import)
//   3. Sépare sections : <script module>, <script>, <style>, HTML
//   4. Préprocesse HTML (transmutation auto-fermée, @noajax, etc.)
//   5. Compile script via language adapter → JS standard
//   6. Tokenize ($ sugar) → JS final
//   7. Analyzer AST → state, computed, modifiedCode (auto-derive `_mjs_c`)
//   8. Generator HTML : surgical_html + updates + events + inlines
//   9. Inject template avec toutes les substitutions
//
// Pas de daemon Node externe : tout en process. Le CSS du `<style>` (Sass, SCSS ou CSS) est compilé par compileCss (css.ts) ;
// la minification du JS produit revient au bundler.

import { readFileSync } from 'node:fs'
import { basename, relative, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import * as acorn from 'acorn'
import * as walk from 'acorn-walk'

import { compileVars, checkSprings, compileAjaxTypes, compileAjaxCall, checkAjaxVerbNames, ajaxOptionsOnTree, ajaxPlacesAsText, type AjaxVerbName, type AjaxRewrite, type RuleAst } from './var-types.js'
import { MU_HOOKS, MU_LAYOUT_OUT, MU_T_CALL_BODY, MU_T_CALL_RE, refreshShapeError, rewriteMuImportAst, expressionEnd, storeComputedKeyError, selfWriteError, SELF_WRITE_VAR, SELF_WRITE_MODULE_STATE } from '../sigils.js'
import { skipQuotedSpan } from '../quoted-span.js'
import { parseVtValue } from '../bundler/config.js'
import { classesCitedBy, classImport } from '../bundler/class-files.js'
import { extractDirectives, buildPersistCode, readImportDirectives, importsInElementText } from './directives.js'
import { extractSections, findScriptMatches, findStyleMatches } from './sections.js'
import { jsTemplate, autoloaderLine } from './template.js'
import { compileCss } from './css.js'
import { rewriteFontSizes, type FontSizeSettings } from './font-size.js'
import { rewriteStyleVars, wrapThemeBlock, type ThemeVar } from './style-vars.js'
import { processIncludes, processGlobalMacros, newIncludeAccumulator, citeLine, type LinePlace, type SetupOrigin } from './macros.js'
import { writtenColumn, byteColumn, likeness } from '../reader/positions.js'
import { lintSplitRune, maskNonCode } from './split-rune.js'
import { findConstReassignment } from './const-reassign.js'
import { tokenize } from '../lexer/index.js'
import { compilePreparedScript, prepareScript } from '../reader/script.js'
import { compile as compileHtml } from '../generator/index.js'
import { sizeCss } from '../generator/attributes/index.js'
import type { EventRoute, FineList } from '../generator/state.js'
import type { LinkSeen, ProjectTagSeen, TagRef, MixedLine } from '../parser/index.js'
import { Scanner, extractBalanced, expandLayoutBlocks, readBraces } from '../parser/index.js'
import { SIGN, SIGN_RE, written, wordRe } from '../parser/mjs-words.js'
import { generateCreateFnBody } from '../generator/paths.js'
import { closeSelfClosedComponents, readFields, codeTree, unknownRead } from '../generator/compile.js'
import { readFile, traverse } from '../reader/index.js'
import { Analyzer, collectStoreReads } from '../analyzer/index.js'
import { getAdapter, type SupportedLang } from '../languages/index.js'
import { ParamReadOtherwiseError } from '../languages/civet-params.js'
import { passDeclarations, type PassDeclarations } from '../languages/civet-declarations.js'
import { transformReactiveWritesMapped } from '../generator/transform-reactive.js'
import { applyPathTrackingMapped, simpleState, refuseStoreSelfWrites, stateAliases } from '../generator/path-tracker.js'
import { annotateEffectDepsMapped } from '../generator/effect-deps.js'
import { rebindDetachedThisMapped } from '../generator/this-rebinding.js'
import { batchLoopWritesMapped } from '../generator/loop-batch.js'
import { pseudoClashWarnings } from '../effects/pseudo-clash.js'
import { settingWarnings } from '../effects/setting-warnings.js'
import { lintReservedSymbolNames } from '../generator/reserved-symbols.js'
import { storeArgsToRawJsLint, inlineHandlerLines } from '../generator/store-args.js'
import { state as generatorState, withState } from '../generator/state.js'
import { setProjectEffects, withProjectEffects, sockAbsent, type ProjectEffect } from '../effects/catalog.js'
import { resolveEffectImages } from './effect-images.js'
import { checkA11y } from './a11y.js'
import { checkUjsForm } from './ujs-form.js'
import { warnUnreachableCode } from './unreachable.js'
import { rejectRawTimers, rootNames } from './timers.js'
import { withComponentNames } from '../generator/utils.js'
import { changingNames } from '../analyzer/derived-reads.js'
import { classifyDerived, chosenDerived, RAW_WRITE, type ClassifiedDerived } from '../analyzer/derived-classes.js'
import { typedLine, printDiagnostic, type LintToggles } from '../diagnostics.js'
import { t, type MsgKey } from '../messages/index.js'
import { maskHtmlComments as maskCommentsInHtml, readHtmlComment, createMaskTable, nextMatch, replaceBlocks } from '../mask.js'
import { decode, encode } from '@jridgewell/sourcemap-codec'
import { chainSourceMaps, shiftGeneratedPosition, finalizeSourceMap, chainOverMap } from './source-map-chain.js'
import { MASK_STRINGS_AND_COMMENTS_RE, lintSingletonConsume, lintImportDollarName, lintEffectTopLevel, lintEffectHandler, lintEffectOldName, lintEmitInModule, lintOnUrlChangeLegacy, parseModuleAst, lintUndeclaredTopLevelAssignment, collectInstanceProps, collectHandlerInstanceProps, lintElementPropertyAtConstruction, sourceLineOf, lintNoRawImport, INLINE_ARROW_CIVET_RE, checkInlineHandlers, lintHandlerSelfRefDeclaration, lintHandlerBareMethod, checkHandlerReferences, maskDocBlocks, maskStringsAndComments } from './lint.js'
import { browserGlobals, warnAboutLocals } from './handler-globals.js'
import { applyCivetDialectSugar, singletonsDeclares, applyMjsSugarToScript, writesInFunctions } from './sugar.js'
import { collectBuildChecks, scriptRoutes, scriptRouteTargets, templateViews, type BuildChecks, type I18nKeySeen } from './build-checks.js'
import { loadSites } from './load-sites.js'
import { awaitDerived } from './await-derived.js'
import { unescapeMu } from './mu-escapes.js'

// ----------------------------------------------------------------------------
// shiftSourceMapLines — décale une carte v3 (JSON stringifié) d'un
// nombre CONSTANT de lignes source, pour retomber sur la vraie ligne du `.mjs`
// (offset = ligne de début du bloc `<script>`/`<script module>`, `sections.ts`).
// `decode`/`encode` travaillent en entiers ABSOLUS (la lib redélimite les deltas
// VLQ elle-même) : ajouter l'offset au champ `sourceLine` de chaque segment suffit.
// ----------------------------------------------------------------------------
export function shiftSourceMapLines(mapJson: string, lineOffset: number, noPlace = 0): string {
  if (lineOffset === 0 && noPlace === 0) return mapJson
  const raw = JSON.parse(mapJson)
  const decoded = decode(raw.mappings ?? '')
  // `noPlace` : premières lignes du texte compilé ajoutées par le compilateur, sans ligne d'origine
  const shifted = decoded.map(line => line.map(seg => seg.length >= 4
    ? (seg[2] < noPlace ? [seg[0]] : [seg[0], seg[1], seg[2] + lineOffset, seg[3], ...seg.slice(4)]) as typeof seg
    : seg))
  raw.mappings = encode(shifted)
  return JSON.stringify(raw)
}

// une position dans son fichier : `main.mjs`, ou le chemin d'un partiel depuis le dossier du composant (`_bas.mjs`)
interface CitedPosition { file: string; line: number; column: number }

// remapAdapterErrorLine — un adaptateur de langage qui échoue (Civet, CoffeeScript, TypeScript, JavaScript, et le sucre ou le
// lexeur de MJS : message `<fileName>:<ligne>:<colonne> …`) rend une position du texte qu'on lui a donné, jamais celle du
// `.mjs` : `situer` la ramène au fichier où le code est écrit (cf. locateInBlock) et le message cite
// `fichier.mjs:ligne:colonne`. esbuild (TypeScript) compte ses colonnes en octets à partir de 0 (`…:3:10: ERROR`). Motif reconnu
// SEULEMENT : un adaptateur qui ne porte aucune position dans son message le laisse intact, une ligne sans place (code ajouté
// par MJS : persistance, macros) aussi.
// `directives` : la directive `@import` de chaque import posé en tête du texte compilé (le rang `i` à la ligne `i + 1`), sa
// ligne dans le fichier (`fichier`) et son texte ; une faute sur l'un de ces imports est citée à la ligne de sa directive, et
// un nom refusé à sa colonne dans la directive
function remapAdapterErrorLine(err: unknown, fileName: string, locate: (line: number, column: number, bytes?: boolean) => CitedPosition | null, directives: readonly { line: number; text: string }[] = [], file = fileName): Error {
  const original = err instanceof Error ? err : new Error(String(err))
  const escaped  = fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m        = new RegExp(`${escaped}:(\\d+):(\\d+)(?=(: ERROR\\b)?)`).exec(original.message)
  if (!m) return original
  const directive = directives[Number(m[1]) - 1]
  const name      = (original as { forbiddenName?: string }).forbiddenName
  const place     = directive ? null : locate(Number(m[1]), Number(m[2]), m[3] !== undefined)
  if (!directive && !place) return original
  const column = directive && name ? directive.text.search(new RegExp(`(?<![\\w$@])${name}(?![\\w$])`)) + 1 : 0
  const cite   = place ? `${place.file}:${place.line}:${place.column}` : `${file}:${directive!.line}:${column || 1}`
  return new Error(original.message.replace(m[0], cite), { cause: original })
}

// un bloc de code donné à l'adaptateur (le `<script>` ou le `<script module>`) : `avant` lignes sans place (imports posés en
// tête), le code écrit du composant (`ecrit`, à partir de la ligne `premiere` du fichier, dont `source` rend les lignes
// telles qu'écrites), puis, après les lignes de `mergedBefore` (le bloc avant les partiels), le script de chaque partiel versé
// (`morceaux`), chacun sous sa ligne de titre, à partir de la ligne `places[k].line` de son fichier ; le reste
// (persistance, macros) n'a pas de place. Une ligne blanche du code lu (la dernière, close par la balise fermante) n'a rien
// d'écrit avant elle : sa colonne est la première. Les textes sont gardés tels quels et découpés sur le seul chemin d'une
// faute : une construction sans faute ne paie rien
interface PouredBlock { before: number; written: string; first: number; file: string; source: () => string[]; mergedBefore: string; pieces: string[]; places: Array<{ file: string; line: number }>; baseDir: string; macros?: PouredMacros }

// les gestionnaires des balises du langage (`<@window @resize={…}>`) versés au script après `avant` (son texte d'alors) : la
// place de chacune de leurs lignes écrites (cf. processGlobalMacros), retrouvée dans le gabarit (`places`, `premiere`, `ou`) ; `fin` :
// le dernier signe de `avant` (cf. scriptEnd)
interface PouredMacros { before: string; origins: Array<SetupOrigin | undefined>; places: LinePlace[] | undefined; first: number; where: WhereWritten; end: () => ScriptEnd | null }

// le dernier signe du code versé au script avant les lignes des balises du langage : sa place dans le fichier qui l'écrit, ce que sa
// ligne écrit jusqu'à lui (`texte`), et s'il est un opérateur (`ouverte` : la ligne qui suit s'y colle)
interface ScriptEnd extends CitedPosition { text: string; open: boolean }

// une ligne de code qui s'arrête sur un opérateur, une virgule ou un mot qui attend la suite : jamais `x++`, une flèche (`g = ->`, une
// fonction vide), `a?` ni `a!`
const OPEN_END_RE = /(?:(?<![+-])[+-]|[*/%=<&|^~,\\:]|(?<![-=])>|(?<![\w$])(?:and|or|not|is|isnt|in|of|instanceof|new|typeof|delete|void|await|yield|throw|extends|then|else))$/

// la définition d'un gestionnaire versée au script par une balise du langage (cf. processGlobalMacros) : `@_gl_0 = (e, _mjs_el) =>`
const MERGED_DEFINITION_RE = /^@(_glb?_[0-9a-z]+) = \(e, _mjs_el\) =>$/

// où relire le texte écrit d'une faute : le fichier du composant (`fichier`, son nom tel qu'écrit, `menu.page.mjs`), ses
// lignes telles qu'écrites et le dossier d'où se lisent ses partiels
interface WhereWritten { file: string; lines: () => string[]; baseDir: string }

// les lignes d'un fichier telles que le compilateur les lit (marque d'ordre et fins de ligne `\r\n` retirées)
function fileLines(path: string): string[] {
  try {
    const text = readFileSync(path, 'utf-8')
    return (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).replace(/\r\n?/g, '\n').split('\n')
  }
  catch {
    return []
  }
}

// la place dans son fichier de la ligne de rang `i` (à partir de 0) d'un bloc donné à l'adaptateur, et son texte écrit
function lineOrigin(i: number, block: PouredBlock): { file: string; line: number; text: () => string } | null {
  const written = block.written.split('\n')
  const k       = i - block.before
  if (k >= 0 && k < written.length) return { file: block.file, line: block.first + k, text: () => (written[k].trim() === '' ? '' : block.source()[block.first - 1 + k] ?? '') }
  let s = block.mergedBefore.split('\n').length
  for (let p = 0; p < block.pieces.length; p++) {
    const n     = block.pieces[p].split('\n').length
    const place = block.places[p]
    if (place && i > s && i < s + n) return { file: relative(block.baseDir, place.file), line: place.line + i - s - 1, text: () => (block.pieces[p].split('\n')[i - s].trim() === '' ? '' : fileLines(place.file)[place.line + i - s - 2] ?? '') }
    s += n
  }
  return null
}

// locateInBlock — une position (ligne, colonne) du texte donné à l'adaptateur (`texte`, le sucre de MJS appliqué) ramenée au
// fichier où le code est écrit : même rang de ligne dans le bloc (le sucre garde le nombre de lignes), colonne retrouvée en
// alignant la ligne donnée sur la ligne écrite (cf. writtenColumn : retrait commun, raccourcis `$x` → `$.x`, `x .= …`, `µ$$X`
// réécrit) ; `octets` : la colonne d'esbuild, en octets à partir de 0
function locateInBlock(text: string, block: PouredBlock): (line: number, column: number, bytes?: boolean) => CitedPosition | null {
  return (line, column, bytes = false) => {
    const origin   = lineOrigin(line - 1, block)
    const dataLine = text.split('\n')[line - 1] ?? ''
    const read     = bytes ? byteColumn(dataLine, column) : column
    if (!origin) return block.macros ? mergedHandlerPlace(line - 1, dataLine, read, block.macros) : null
    return { file: origin.file, line: origin.line, column: writtenColumn(dataLine, origin.text(), read) }
  }
}

// la ligne de rang `i` du bloc, versée par un gestionnaire d'une balise du langage : sa colonne retrouvée sur la ligne écrite du
// corps, puis sa place dans le gabarit, ramenée au fichier qui l'écrit (partiel compris) ; null hors de ces lignes. Une ligne que le
// compilateur écrit après les corps : un gestionnaire est resté ouvert, la faute est citée à son `}` — le premier dont une
// parenthèse, un crochet ou une accolade reste ouvert (la faute vient plus loin), sinon celui qui finit juste au-dessus d'elle
function mergedHandlerPlace(i: number, dataLine: string, column: number, m: PouredMacros): CitedPosition | null {
  const k = i - m.before.split('\n').length
  const o = m.origins[k]
  if (!o && k > 0) {
    const written = (x: SetupOrigin | undefined): x is SetupOrigin => x !== undefined && x.html.slice(x.at, x.at + x.body.length) === x.body
    const open    = m.origins.slice(0, k).find((x) => written(x) && staysOpen(x.body)) ?? (written(m.origins[k - 1]) ? m.origins[k - 1] : undefined)
    if (open) return placeInTemplate(open.html, open.at + open.body.length, m.places, m.first, m.where)
  }
  // une ligne que le compilateur écrit, sans gestionnaire resté ouvert avant elle : le code versé avant les balises du langage s'arrête
  // sur un opérateur, la faute est citée à son dernier signe
  if (!o) {
    const end = k >= 0 ? m.end() : null
    return end?.open ? { file: end.file, line: end.line, column: end.column } : null
  }
  if (o.html.slice(o.at, o.at + o.body.length) !== o.body) return null
  const lines = o.body.split('\n')
  const start = o.at + lines.slice(0, o.row).reduce((n, x) => n + x.length + 1, 0)
  return placeInTemplate(o.html, start + writtenColumn(dataLine, lines[o.row] ?? '', column) - 1, m.places, m.first, m.where)
}

// locateFault — une faute du sucre ou du lexeur de MJS (`main.script:5:6 [ModularJS] …`) cite déjà la ligne du fichier, et sa
// colonne dans le texte lu (`texte`) : ramenée au fichier où le code est écrit comme celle de l'adaptateur
function locateFault<T>(read: () => T, fileName: string, text: string, block: PouredBlock): T {
  try {
    return read()
  }
  catch (e) {
    // l'état de module `µ$$x` écrit avec sa propre valeur, lu `$x` (pré-passe 0-bis) : la colonne alignée tombe sur son premier `$`,
    // la faute cite son `µ`
    const state = (e as { cause?: { mjsSelfWriteKind?: number } })?.cause?.mjsSelfWriteKind === SELF_WRITE_MODULE_STATE
    throw remapAdapterErrorLine(e, fileName, (line, column) => {
      const place = locateInBlock(text, block)(line - block.first + block.before + 1, column)
      return place && state && place.file === block.file && block.source()[place.line - 1]?.[place.column - 2] === 'µ' ? { ...place, column: place.column - 1 } : place
    })
  }
}

// la place dans son fichier d'un indice du HTML où les partiels sont versés (`places`, cf. processIncludes) : le composant (son
// HTML commence à la ligne `premiere`) ou le partiel qui écrit cette ligne ; `cite` : la ligne telle qu'un message la cite. La
// colonne se retrouve sur la ligne écrite (le HTML lu a pu être réécrit : `µ$$X`, alias du symbole)
function placeInTemplate(html: string, hint: number, places: LinePlace[] | undefined, first: number, where: WhereWritten): CitedPosition & { cite: number | string } {
  const before = html.slice(0, hint)
  const rank   = before.split('\n').length - 1
  const start  = before.lastIndexOf('\n') + 1
  const end    = html.indexOf('\n', start)
  // le morceau de la ligne qui porte l'indice (cf. LinePlace.suite) : celui qui l'ouvre, ou un texte posé après un partiel
  const rest = places?.[rank]?.rest ?? []
  let n      = 0
  while (n < rest.length && rest[n].at <= hint - start) n++
  const run          = n > 0 ? rest[n - 1] : null
  const place        = run ?? places?.[rank]
  const line         = place ? place.line : first + rank
  const from         = run ? run.at : 0
  const columnOffset = run ? run.column - 1 : 0
  const written      = (place?.file ? fileLines(resolve(where.baseDir, place.file)) : where.lines())[line - 1]
  const read         = html.slice(start + from, n < rest.length ? start + rest[n].at : end < 0 ? html.length : end)
  const k            = hint - start - from + 1
  return { file: place?.file ?? where.file, line, column: written === undefined ? columnOffset + k : columnOffset + writtenColumn(read, written.slice(columnOffset), k), cite: place?.file ? t('transpiler.partial-line', { line: line, file: place.file }) : line }
}

// l'indice du texte écrit d'une expression ou d'un gestionnaire dans le HTML (commentaires masqués), à une place de code : juste
// après une accolade (`{…}`, `@click={…}`), la tête d'une attente (`{await …}`, `{await.keep …}`) ou d'une condition (`{if …}`, `{elsif …}`)
// et juste avant la fermante
// (`{f(1)}` n'est pas `{f(}`) ; -1 quand on ne le retrouve pas
function afterBrace(html: string, text: string): number {
  const mask   = maskCommentsInHtml(html)
  const closes = /\s*\}/y
  const whole  = (k: number): boolean => {
    closes.lastIndex = k + text.length
    return /\{\s*(?:(?:await(?:\.keep)?|if|elsif)\s+)?$/.test(mask.slice(Math.max(0, k - 20), k)) && closes.test(mask)
  }
  let k = text ? mask.indexOf(text) : -1
  while (k >= 0 && !whole(k)) k = mask.indexOf(text, k + 1)
  return k
}

// une expression du gabarit que Civet refuse (`main.expr:1:6`, position dans `(expression)`) : ramenée au fichier où elle est
// écrite, partiel compris — son texte écrit retrouvé dans le HTML, la ligne et la colonne de Civet retrouvées sur ce texte
function locateExpression(e: any, html: string, places: LinePlace[] | undefined, first: number, moduleName: string, where: WhereWritten): unknown {
  const m = new RegExp(`${moduleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.expr:(\\d+):(\\d+)`).exec(String(e.message))
  const k = m ? afterBrace(html, String(e.writtenExpression)) : -1
  // un refus du générateur qui ne se retrouve pas à une place sûre : son repère (`main.expr:1:2`) n'est la place de rien, retiré
  if (m && k < 0 && e.loneLandmark) e.message = String(e.message).replace(m[0] + ' — ', '')
  if (!m || k < 0) return e
  const written  = String(e.writtenExpression)
  const head     = /^\s*/.exec(written)![0].length
  const lines    = written.slice(head).split('\n')
  const l        = Number(m[1])
  const compiled = String(e.compiledExpression).split('\n')[l - 1] ?? ''
  // la parenthèse ajoutée autour de l'expression ouvre sa première ligne
  const column = l === 1 ? writtenColumn(compiled.slice(1), lines[0], Number(m[2]) - 1) : writtenColumn(compiled, lines[l - 1] ?? '', Number(m[2]))
  const place  = placeInTemplate(html, k + head + lines.slice(0, l - 1).reduce((n, x) => n + x.length + 1, 0) + column - 1, places, first, where)
  e.message    = String(e.message).replace(m[0], `${place.file}:${place.line}:${place.column}`)
  return e
}

// un guillemet jamais refermé dans un attribut, refusé par le parseur à sa place dans le texte qu'il lit (`mjsQuote`) :
// le lecteur relit le HTML où les partiels sont versés, y retrouve ce guillemet (le seul qu'il suit jusqu'au bout), et le
// message cite le fichier où il est écrit, sa ligne et sa colonne ; introuvable, le message reste tel quel
function locateQuote(e: any, html: string, places: LinePlace[] | undefined, first: number, where: WhereWritten): unknown {
  const g = readFile(html, { template: true, dialect: e.mjsQuote.dialect }).diagnostics.find((d) => d.quote !== undefined)?.quote
  if (g === undefined || html[g.start] !== e.mjsQuote.quote) return e
  const place = placeInTemplate(html, g.start, places, first, where)
  e.message   = t('parser.quote-not-closed', { ...e.mjsQuote.vars, file: place.file, line: place.line, column: place.column })
  return e
}

// une faute d'effet écrite dans un partiel (`*titre : effet inconnu`) : le générateur la situe sur la ligne du composant qui
// verse le partiel ; la ligne du partiel qui écrit cet effet, avec son fichier, est écrite dans le message quand elle est la
// seule (le bundler ne cherche ensuite la ligne d'un effet que dans le texte du composant)
function partialEffect(e: any, html: string, places: LinePlace[] | undefined): unknown {
  const host = Number(e?.mjsLine ?? e?.cause?.mjsLine)
  const head = /\[ModularJS\] \*([A-Za-z][\w-]*(?:\.[\w.-]*)?)(?:\([^)\n]*\))?/.exec(String(e?.message ?? ''))
  if (!places || !head) return e
  const pattern = new RegExp(`\\*${head[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w.-])`)
  const lines   = maskCommentsInHtml(html).split('\n')
  const seen    = places.filter((p, k) => p.file !== null && p.host === host && pattern.test(lines[k] ?? ''))
  if (seen.length !== 1) return e
  const end = head.index + head[0].length
  e.message = e.message.slice(0, end) + t('bundler.transpile-msg.effect-line', { line: t('transpiler.partial-line', { line: seen[0].line, file: seen[0].file }) }) + e.message.slice(end)
  return e
}

// un code dont une parenthèse, un crochet ou une accolade reste ouvert (chaînes, commentaires et regex mis à part)
function staysOpen(code: string): boolean {
  let n = 0
  for (const c of maskNonCode(code)) {
    if (c === '(' || c === '[' || c === '{') n++
    else if (c === ')' || c === ']' || c === '}') n--
  }
  return n > 0
}

// une faute de Civet dans le lot des gestionnaires (`main.inlines:L:C`) : la ligne fautive retrouvée dans le texte écrit d'un
// gestionnaire (celle qui lui ressemble le plus), ce texte retrouvé dans le HTML juste après son accolade, la colonne de Civet
// retrouvée sur la ligne écrite ; null quand on ne le retrouve pas (le message garde la position du lot)
function locateHandler(message: string, batch: string, sources: string[], html: string, places: LinePlace[] | undefined, first: number, moduleName: string, where: WhereWritten): { message: string; cite: number | string; line?: string; source: string } | null {
  const m = new RegExp(`${moduleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.inlines:(\\d+):(\\d+)`).exec(message)
  if (!m) return null
  const batchLines = batch.split('\n')
  const near       = (faultyLine: string): { score: number; source: string; rank: number } => {
    let best = { score: 0.5, source: '', rank: -1 }
    for (const source of sources) {
      source.split('\n').forEach((line, rank) => {
        const score = likeness(faultyLine, line)
        if (score > best.score) best = { score, source, rank }
      })
    }
    return best
  }
  const faultyLine = batchLines[Number(m[1]) - 1] ?? ''
  let best         = near(faultyLine)
  // repérée sur l'enveloppe du lot (sa fermeture `]`, la fin du texte) : un gestionnaire est resté ouvert, la faute est citée à
  // son `}` ; le premier dont une parenthèse, un crochet ou une accolade reste ouvert (Civet y a versé les suivants), sinon
  // celui qui précède la faute
  if (best.rank < 0 && /^(?:\]|@_mjs_inline = \[)?$/.test(faultyLine.trim())) {
    const open = sources.find((s) => staysOpen(s))
    if (open !== undefined) best = { score: 1, source: open, rank: 0 }
    for (let r = Number(m[1]) - 2; r >= 0 && best.rank < 0; r--) best = near(batchLines[r])
    const place = best.rank < 0 ? null : handlerBrace(html, best.source, places, first, where)
    if (place === null) return null
    return { message: message.replace(m[0], `${place.file}:${place.line}:${place.column}`), cite: place.cite, line: best.source.trimEnd().split('\n').pop(), source: best.source }
  }
  const k = best.rank < 0 ? -1 : afterBrace(html, best.source)
  if (k < 0) return null
  const lines  = best.source.split('\n')
  const column = writtenColumn(faultyLine, lines[best.rank], Number(m[2]))
  const place  = placeInTemplate(html, k + lines.slice(0, best.rank).reduce((n, x) => n + x.length + 1, 0) + column - 1, places, first, where)
  return { message: message.replace(m[0], `${place.file}:${place.line}:${place.column}`), cite: place.cite, source: best.source }
}

// une faute de Civet ou de CoffeeScript dans un rappel de transition (`@introend={…}`), compilé seul (`main.inlines:L:C`, position dans
// son texte compilé, cf. callbackFault), ou le nom refusé par une garde (position dans son texte écrit) : citée à sa place dans le
// fichier comme celle d'un gestionnaire (cf. locateHandler) ; introuvable ou sans position (`main.inlines`), à la ligne de son attribut
function locateCallback(e: any, html: string, places: LinePlace[] | undefined, first: number, moduleName: string, where: WhereWritten): unknown {
  const r       = e.transitionCallback
  const located = locateHandler(String(e.message), r.batch, [r.written], html, places, first, moduleName, where)
  e.message     = located ? located.message : String(e.message).replace(new RegExp(`${moduleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.inlines(?::\\d+:\\d+)?`), `${where.file}:${r.line ?? '?'}`)
  return e
}

// chaque ligne du HTML où les partiels sont versés (`html`), telle que le parseur la cite (cf. ParseDiag.lineCites) : celle du
// composant ou du partiel qui l'écrit ; faite de morceaux de plusieurs fichiers, son texte et la ligne de chaque morceau
function parserCites(places: LinePlace[], first: number, html: string): Array<number | string | MixedLine> {
  const lines = places.some((p) => p.rest) ? html.split('\n') : []
  return places.map((p, k) => (p.rest?.some((r) => r.file !== p.file) ? { host: p.host, text: lines[k] ?? '', pieces: [{ at: 0, cite: citeLine([p], first, 0) }, ...p.rest.map((r) => ({ at: r.at, cite: citeLine([r], first, 0) }))] } : citeLine(places, first, k)))
}

// l'accolade qui ferme le gestionnaire écrit `source` (retrouvé dans le HTML juste après son accolade ouvrante) : sa place dans le
// fichier qui l'écrit, partiel compris ; null quand on ne le retrouve pas
function handlerBrace(html: string, source: string, places: LinePlace[] | undefined, first: number, where: WhereWritten): (CitedPosition & { cite: number | string }) | null {
  const k = afterBrace(html, source)
  if (k < 0) return null
  const end = k + source.length
  return placeInTemplate(html, end + /^\s*/.exec(html.slice(end))![0].length, places, first, where)
}

// le nombre de gestionnaires d'un lot compilé : les éléments du tableau `this._mjs_inline = […]`, ou les `this._mjs_inline[i] = …` d'un
// lot compilé par groupes (cf. groupSource) — moins que de gestionnaires écrits, l'un d'eux est resté ouvert et a avalé le suivant
function compiledHandlers(ast: any): number {
  let n = 0
  for (const stmt of ast?.body ?? []) {
    const a      = stmt.type === 'ExpressionStatement' ? stmt.expression : null
    const target = a?.type === 'AssignmentExpression' && a.left?.type === 'MemberExpression' ? (a.left.computed ? a.left.object : a.left) : null
    if (target?.type !== 'MemberExpression' || target.object?.type !== 'ThisExpression' || target.property?.name !== '_mjs_inline') continue
    if (a.left.computed) n++
    else if (a.right?.type === 'ArrayExpression') n += a.right.elements.length
  }
  return n
}

// le refus d'un gestionnaire resté ouvert, que le code qui le suit complète sans erreur de Civet : cité à son `}`, avec la fin de son
// corps
function handlerStaysOpen(place: CitedPosition, body: string): Error {
  return new Error(t('transpiler.handler-left-open', { position: `${place.file}:${place.line}:${place.column}`, end: body.trimEnd().split('\n').pop()!.trim() }))
}

// le dernier signe du code versé au script avant les lignes des balises du langage (`avant` : le <script> du composant, celui d'un
// partiel), chaînes et commentaires mis à part ; null quand sa ligne n'a pas de place dans un fichier
function scriptEnd(before: string, lang: string, block: PouredBlock): ScriptEnd | null {
  const read = maskNonCode(before, lang).split('\n')
  let i      = read.length - 1
  while (i >= 0 && read[i].trim() === '') i--
  const origin = i < 0 ? null : lineOrigin(i, block)
  if (!origin) return null
  const written = origin.text()
  const code    = maskNonCode(written, lang).trimEnd().length
  const column  = code > 0 ? code : written.trimEnd().length
  return { file: origin.file, line: origin.line, column, text: written.slice(0, column).trim(), open: OPEN_END_RE.test(read[i].trimEnd()) }
}

// la première ligne que les balises du langage versent au script (`setup`, cf. processGlobalMacros) prise par le code écrit avant elle,
// resté ouvert sur un opérateur (`a +`) : elle n'ouvre plus une instruction du script compilé (`js`, `corps` : la racine de son arbre),
// et ce qu'elle pose est perdu sans erreur. Vu sur ce qu'elle pose : la définition d'un gestionnaire (`@_gl_0 = (e, _mjs_el) =>`),
// absente de la racine ; la valeur de départ d'une liaison (`$y = window.scrollY`), qui n'est plus l'instruction posée juste avant le
// gestionnaire de la liaison ; un reffet (`µeffect =>`, classe de <@body>, <@head>…), appelé ailleurs qu'en tête d'une instruction ; la
// limite de réessai d'un <@failed> (`@_mjs_failedRetry = 3`), absente de la racine
function swallowedFirstLine(js: string, body: any[], setup: string): boolean {
  const [, first = '', next = ''] = setup.split('\n')
  const limit = /^@(_mjs_failedRetry) = /.exec(first)
  if (limit) return !body.some((s) => s.type === 'ExpressionStatement' && s.expression?.type === 'AssignmentExpression' && s.expression.left?.object?.type === 'ThisExpression' && s.expression.left.property?.name === limit[1])
  const definition = (fn: string): number => body.findIndex((s) => {
    const a = s.type === 'ExpressionStatement' ? s.expression : null
    return a?.type === 'AssignmentExpression' && a.left?.object?.type === 'ThisExpression' && a.left.property?.name === fn && /FunctionExpression$/.test(a.right?.type ?? '')
  })
  const handler = MERGED_DEFINITION_RE.exec(first)
  if (handler) return definition(handler[1]) < 0
  const binding = / = (?:window|navigator)\.\w+$/.test(first) ? MERGED_DEFINITION_RE.exec(next) : null
  if (binding) {
    const k = definition(binding[1])
    const a = body[k - 1]?.type === 'ExpressionStatement' ? body[k - 1].expression : null
    return k > 0 && !(a?.type === 'AssignmentExpression' && a.right?.type === 'MemberExpression' && a.right.object?.type === 'Identifier')
  }
  // l'appel du reffet (`µ._glCl(…)`) : dans l'instruction qui le pose (`µ.effect(() => …)`), ou dans la dernière du code écrit avant lui,
  // après le reffet vidé
  const internal = first === 'µeffect =>' ? /^ {2}(µ\.\w+\()/.exec(next) : null
  const k       = internal ? js.indexOf(internal[1]) : -1
  const s       = k < 0 ? undefined : body.find((x) => x.start <= k && k < x.end)
  return s !== undefined && !js.startsWith('µ.effect(', s.start) && js.lastIndexOf('µ.effect(', k) > s.start
}

// `$$[k]` refusé dans une expression ou un gestionnaire du gabarit (storeComputedKeyError, sigils.ts), sans sa ligne : le premier `$$[`
// écrit dans le code du gabarit (entre accolades, commentaires masqués ; le texte d'un paragraphe n'est pas du code, ni la propriété
// `$$` d'un objet, ni une chaîne `'…'`/`"…"` qui le cite) la donne, partiel compris, avec la clé telle qu'elle est écrite (un gestionnaire
// est lu réécrit : `$k` y est `$.k`). Une chaîne de CoffeeScript qui porte du code (`"#{$$[k]}"`) : cherché ensuite sans sauter les
// chaînes ; introuvable, le message reste tel quel
function locateComputedKey(e: any, html: string, places: LinePlace[] | undefined, first: number, where: WhereWritten): unknown {
  if (/^\S+:\d+:\d+ /.test(String(e.message))) return e
  const mask = maskCommentsInHtml(html)
  for (const skip of [true, false]) {
    let n = 0
    for (let k = 0; k < mask.length; k++) {
      const before = mask[k - 1] ?? ''
      if (mask[k] === '{') n++
      else if (mask[k] === '}') n = Math.max(0, n - 1)
      else if (skip && n > 0 && (mask[k] === "'" || mask[k] === '"')) k = skipQuotedSpan(mask, k) - 1
      // précédé d'un point, la propriété `$$` d'un objet (`o.$$[0]`) ; de deux, un étalement (`{...$$[k]}`), refusé comme par le lecteur
      else if (n > 0 && mask.startsWith('$$[', k) && !/[\w$]/.test(before) && (before !== '.' || mask[k - 2] === '.')) {
        const place = placeInTemplate(html, k, places, first, where)
        e.message   = `${place.file}:${place.line}:${place.column} ${storeComputedKeyError(mask, k + 3).message}`
        return e
      }
    }
  }
  return e
}

// la fin de l'écriture `$x = $x` que cite un refus : parenthèses fermées, puis `;`, `,`, une fermante, la fin du texte ou un mot de
// suite (`if`, `unless`…), comme le lecteur la lit (lexer/index.ts, selfWriteAt) — jamais `$x = $x + 1`, `$x = $x or 0`, `$x = $x.n`
const SELF_ASSIGN_END = '(?:\\s*\\))*(?=\\s*(?:[;,)\\]}]|$)|[ \\t]+(?:if|unless|else|for|while|until|then|when)(?![\\w$]))'

// la fin d'une écriture `$x = $x` que le lecteur n'a pas lue (`$x = $x as T`, `$x = $x!`, écrite sur deux lignes) : tout, sauf une
// suite qui en fait une autre expression (point, opérateur, appel, indice, `and`, `or`…)
const FREE_SELF_ASSIGNMENT_END = '(?![ \\t]*(?:[.?[(+\\-*/%&|^<>=,`]|!=|(?:and|or|is|isnt|in|of|instanceof|not)(?![\\w$])))'

// `$d = $d` d'une valeur dérivée, que l'analyse connaît (`computed`) : le refus dit d'écrire `µrefresh` sur la variable qu'elle lit
// (cf. selfWriteError, sigils.ts)
function derivedSelfAssignment(e: any, computed: Record<string, unknown>): any {
  return e?.mjsSelfWriteKind === SELF_WRITE_VAR && !e.mjsSelfWriteDerived && computed[e.mjsSelfWriteName] !== undefined ? Object.assign(selfWriteError(SELF_WRITE_VAR, e.mjsSelfWriteName, false, true), { mjsAt: e.mjsAt }) : e
}

// `$x = $x`, `$$x = $$x` du <script> qu'une forme cache au lecteur (`$x = $x as T`, `$x = $x!`, écrit sur deux lignes), refusé par les
// passes d'écriture sans sa place (selfWriteError, sigils.ts) : sa ligne vient de la carte du script (`ligne`), sa colonne de la
// première écriture de cette forme dans le script écrit (`ecrit`, à partir de la ligne `premiere` du fichier), à partir de cette
// ligne ; sans ligne ni écriture trouvée, le message reste tel quel
function locateScriptSelfAssignment(e: any, line: number | null | undefined, written: string, first: number, file: string): unknown {
  if (!line || line < first || /^\S+:\d+:\d+ /.test(String(e.message))) return e
  const shape      = new RegExp(`${e.mjsSelfWrite}${FREE_SELF_ASSIGNMENT_END}`, 'g')
  shape.lastIndex  = written.split('\n').slice(0, line - first).reduce((n, l) => n + l.length + 1, 0)
  const foundMatch = shape.exec(written)
  if (!foundMatch) return e
  const before = written.slice(0, foundMatch.index)
  e.message    = `${file}:${first + (before.match(/\n/g)?.length ?? 0)}:${foundMatch.index - before.lastIndexOf('\n')} ${e.message}`
  return e
}

// `$x = $x`, `$$x = $$x` refusé dans un gestionnaire du gabarit (selfWriteError, sigils.ts), sans sa ligne : la première écriture
// de cette forme dans le code du gabarit (entre accolades, commentaires masqués, chaînes sautées) la donne, partiel
// compris ; introuvable, le message reste tel quel
function locateSelfAssignment(e: any, html: string, places: LinePlace[] | undefined, first: number, where: WhereWritten): unknown {
  if (/^\S+:\d+:\d+ /.test(String(e.message))) return e
  const mask  = maskCommentsInHtml(html)
  const shape = new RegExp(`${e.mjsSelfWrite}${SELF_ASSIGN_END}`, 'y')
  let n       = 0
  for (let k = 0; k < mask.length; k++) {
    if (mask[k] === '{') n++
    else if (mask[k] === '}') n = Math.max(0, n - 1)
    else if (n > 0 && (mask[k] === "'" || mask[k] === '"')) k = skipQuotedSpan(mask, k) - 1
    else if (n > 0 && (shape.lastIndex = k, shape.test(mask))) {
      const place = placeInTemplate(html, k, places, first, where)
      e.message   = `${place.file}:${place.line}:${place.column} ${e.message}`
      return e
    }
  }
  return e
}

// `µfailed` mal écrit dans le gabarit, refusé par le générateur, qui ne connaît pas sa ligne : la forme écrite (`µfailed $r`), cherchée dans
// le HTML où les partiels sont versés, commentaires masqués ; le message cite son fichier et sa ligne seulement si elle s'y lit une fois
// (deux fois : laquelle ?), sinon il reste sans place
function locateBadFailed(e: any, html: string, places: LinePlace[] | undefined, first: number, where: WhereWritten): unknown {
  const written = String(e.failedMalformed)
  const read    = [...maskCommentsInHtml(html).matchAll(new RegExp('(?<![\\w.µ$])' + written.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w$])', 'g'))]
  if (read.length !== 1) return e
  const place = placeInTemplate(html, read[0].index!, places, first, where)
  return new Error(t('lexer.failed-misspelled', { written: written, file: place.file, line: place.line }))
}

// withTemplateLine — une expression du gabarit dont Civet lit un paramètre autrement (`{$l.map((x, readonly) -> x)}`) est
// refusée par le générateur, qui ne connaît pas sa ligne : elle est cherchée au texte écrit de l'expression dans le gabarit
// du fichier (`gabarit` commence à la ligne `firstLine`), commentaires masqués, à une place d'expression seulement (juste
// après l'accolade d'un `{…}` ou d'une valeur d'attribut) : le même texte recopié dans un paragraphe, un `<pre>` ou un
// commentaire n'est pas l'expression. Absente du fichier qui inclut un partiel : elle vient du partiel, le message le dit,
// sans citer une ligne de l'hôte
function withTemplateLine<T>(build: () => T, template: string, firstLine: number, moduleName: string, includedHtml: string, places: LinePlace[] | undefined, where: WhereWritten): T {
  try {
    return build()
  }
  catch (e) {
    // une expression que Civet refuse, une faute d'effet écrite dans un partiel : citées à leur place dans leur fichier
    if ((e as any)?.writtenExpression !== undefined) throw locateExpression(e, includedHtml, places, firstLine, moduleName, where)
    if ((e as any)?.failedMalformed !== undefined) throw locateBadFailed(e, includedHtml, places, firstLine, where)
    if ((e as any)?.mjsComputedKey) throw locateComputedKey(e, includedHtml, places, firstLine, where)
    if ((e as any)?.mjsQuote) throw locateQuote(e, includedHtml, places, firstLine, where)
    if ((e as any)?.transitionCallback) throw locateCallback(e, includedHtml, places, firstLine, moduleName, where)
    if (Number((e as any)?.mjsLine ?? (e as any)?.cause?.mjsLine) > 0) throw partialEffect(e, includedHtml, places)
    if (!(e instanceof ParamReadOtherwiseError) || e.expression === undefined) throw e
    const mask = maskCommentsInHtml(template)
    let k      = mask.indexOf(e.expression)
    while (k >= 0 && !/\{\s*$/.test(mask.slice(Math.max(0, k - 20), k))) k = mask.indexOf(e.expression, k + 1)
    throw new ParamReadOtherwiseError(e.param, where.file, e.js, k < 0 ? null : firstLine + (mask.slice(0, k).match(/\n/g)?.length ?? 0), null, k < 0 && /<@include\b/.test(mask))
  }
}

// parseScriptAst — parse PARTAGÉ par detectRouterAware/detectRoutesReassignment/
// detectDuplicateHook ci-dessous (`sourceType: 'script'` accepte top-level `this`, return, etc. —
// adapté au body de classe/fonction qu'est jsInitBase) : PERF, mesuré — les 3 détections tournaient
// chacune leur PROPRE acorn.parse() sur EXACTEMENT le même texte dans le cas courant (aucun bloc
// <routes>, jsInitBase inchangé entre les trois appels, cf. leurs appelants plus bas) — jusqu'à 55 %
// du temps des 3 détections gagnés en microbenchmark (petit script) en ne parsant qu'une fois. `null`
// → parse déjà tenté et a échoué (repli regex direct, aucune re-tentative) ; `undefined` (le
// paramètre `preAst` de chaque fonction, pas ici) → la fonction parse elle-même.
function parseScriptAst(js: string): acorn.Node | null {
  try {
    return acorn.parse(js, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowReturnOutsideFunction: true,
    })
  } catch {
    return null
  }
}

// ============================================================================
// detectRouterAware : walk AST (insensible aux strings, commentaires, template
// literals) sur `jsInitBase` (script compilé en JS) qui cherche soit :
//   - `this.routes = {...}` (déclarer @routes = vouloir router, même sans
//     hook µurlChange : sinon les <@view> ne s'injectent jamais) ;
//   - `this._mjs_hook('urlChange', fn)`, forme compilée de la rune
//     `µurlChange (path, params) -> …` (cf. lexer §3.8c-pré) — SEULE voie qui
//     pose réellement `_mjs_hooks.urlChange`, consultée par mjs_router.ts
//     (initComponent/navigate).
// La forme V1 (`@onUrlChange = ->` / `this.onUrlChange = ...`, propriété nue
// jamais lue par le routeur) est délibérément absente de cette détection —
// cf. lintOnUrlChangeLegacy pour l'avertissement compile-time qui oriente un
// dev l'écrivant encore vers la rune.
//
// Si le parse échoue (rare — code post-Coffee bien formé), fallback regex.
// `preAst` (optionnel, cf. parseScriptAst) : AST déjà parsé à réutiliser — `undefined` → parse ici,
// `null` → parse déjà tenté et échoué en amont (repli regex direct, mêmes sémantiques qu'avant).
// ============================================================================
function detectRouterAware(jsInitBase: string, preAst?: acorn.Node | null): boolean {
  const ast = preAst !== undefined ? preAst : parseScriptAst(jsInitBase)
  if (!ast) {
    return /\bthis\.routes\b/.test(jsInitBase) || /\b(?:this|_mjsThis)\._mjs_hook\(\s*['"]urlChange['"]/.test(jsInitBase)
  }
  let found = false
  walk.simple(ast, {
    MemberExpression(node: any) {
      // `this.routes = {...}` — accès pointé OU calculé (`this['routes']`), même
      // JS valide, contournait sinon la détection ET la garde `.page.mjs` (voir aussi
      // detectRoutesReassignment plus bas, même piège) :
      // `this[\`routes\`]` (backtick SANS expression, TemplateLiteral et non Literal en AST)
      // contournait encore les deux — même chaîne figée, juste un autre nœud.
      if (
        node.object?.type === 'ThisExpression' &&
        (node.property?.type === 'Identifier' && node.property.name === 'routes' || node.computed === true && node.property?.type === 'Literal' && node.property.value === 'routes' || node.computed === true && node.property?.type === 'TemplateLiteral' && node.property.expressions.length === 0 && node.property.quasis[0]?.value?.cooked === 'routes')
      ) {
        found = true
      }
    },
    CallExpression(node: any) {
      // `_mjsThis._mjs_hook('urlChange', fn)` (la rune `µurlChange`), ou `this._mjs_hook(…)`.
      if (
        node.callee?.type === 'MemberExpression' &&
        (node.callee.object?.type === 'ThisExpression' || node.callee.object?.type === 'Identifier' && node.callee.object.name === '_mjsThis') &&
        node.callee.property?.type === 'Identifier' &&
        node.callee.property.name === '_mjs_hook' &&
        node.arguments?.[0]?.type === 'Literal' &&
        node.arguments[0].value === 'urlChange'
      ) {
        found = true
      }
    },
  })
  return found
}

// ============================================================================
// detectRoutesReassignment : walk AST — vrai si le <script> (compilé, jsInitBase
// AVANT injection du bloc <routes>) RÉASSIGNE `this.routes` (`@routes = …`) —
// une AssignmentExpression dont le membre gauche EST `this.routes` (pas
// `this.routes['x'] = …`/`this.routes.x = …`, mutation légitime de la table posée
// par le bloc <routes>). Même parse acorn (parseScriptAst), même repli regex que
// detectRouterAware. `preAst` : mêmes sémantiques que detectRouterAware ci-dessus.
// ============================================================================
function detectRoutesReassignment(jsInitBase: string, preAst?: acorn.Node | null): boolean {
  const ast = preAst !== undefined ? preAst : parseScriptAst(jsInitBase)
  if (!ast) {
    return /\bthis\.routes\s*=[^=]/.test(jsInitBase)
  }
  let found = false
  walk.simple(ast, {
    AssignmentExpression(node: any) {
      const left = node.left
      // accès pointé OU calculé (`this['routes'] = …`) — même piège que
      // detectRouterAware plus haut. `this[\`routes\`] = …` (backtick sans expression),
      // même correctif que ci-dessus.
      if (
        left?.type === 'MemberExpression' &&
        left.object?.type === 'ThisExpression' &&
        (left.property?.type === 'Identifier' && left.property.name === 'routes' || left.computed === true && left.property?.type === 'Literal' && left.property.value === 'routes' || left.computed === true && left.property?.type === 'TemplateLiteral' && left.property.expressions.length === 0 && left.property.quasis[0]?.value?.cooked === 'routes')
      ) {
        found = true
      }
    },
  })
  return found
}

// ============================================================================
// detectDuplicateHook : compte les émissions `_mjs_hook('<nom>', …)` par nom de
// hook (liste réelle des hooks : MU_HOOKS, sigils.ts) dans le script déjà compilé — rend le PREMIER
// nom vu deux fois, ou null. Motif littéral émis par le compilateur lui-même (pas les runes source
// `µmount`/`µawake`/… : à ce stade, jsInitBase est du JS post-tokenize).
// L'ancien scan TEXTUEL (regex sur jsInitBase, ci-dessus)
// comptait AUSSI une simple CHAÎNE contenant `_mjs_hook('mount', 1)` (ex. message de démo/debug
// dans le <script>) : faux positif, build légitime refusé. Compte désormais par AST — walk.full
// sur les CallExpression dont le callee est `_mjs_hook` (Identifier) ou `<x>._mjs_hook`
// (MemberExpression, propriété `_mjs_hook` — forme réellement émise : `this._mjs_hook('mount', fn)`,
// cf. detectRouterAware plus haut) avec un 1er argument Literal chaîne parmi MU_HOOKS. Mêmes
// `sourceType`/`allowReturnOutsideFunction` que detectRouterAware/detectRoutesReassignment
// ci-dessus (parseScriptAst), sur le MÊME jsInitBase (repli regex identique à l'ancien
// comportement si le parse échoue, rare — jamais de silence total). `preAst` : mêmes
// sémantiques que detectRouterAware ci-dessus.
// Hors compte : les poses ENCHAÎNÉES de <@window>/<@document>/<@body>/<@html>/<@head>
// (processGlobalMacros, macros.ts) — `((_mjs_prevAwake = @_mjs_hooks?.awake) => @_mjs_hook 'awake', …)()`,
// ajoutées APRÈS le <script> : elles reprennent le µawake/µsleep du composant et le rappellent,
// rien n'est écrasé. Les compter refusait tout composant qui écrivait µawake à côté d'un
// <@window>, alors qu'il n'y avait qu'un seul µawake.
// ============================================================================
// nom du paramètre qui garde le hook précédent dans une pose enchaînée (macros.ts)
const chainParamName = (hook: string): string => `_mjs_prev${hook[0].toUpperCase()}${hook.slice(1)}`

function detectDuplicateHook(jsInitBase: string, preAst?: acorn.Node | null): string | null {
  const countFromText = (): string | null => {
    const counts = new Map<string, number>()
    for (const m of jsInitBase.matchAll(new RegExp(`_mjs_hook\\(\\s*'(${MU_HOOKS})'`, 'g'))) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1)
    for (const [name, n] of counts) {
      const chained = jsInitBase.split(`(${chainParamName(name)} = `).length - 1
      if (n - chained > 1) return name
    }
    return null
  }
  const ast = preAst !== undefined ? preAst : parseScriptAst(jsInitBase)
  if (!ast) {
    return countFromText()
  }
  const hookNames = new Set(MU_HOOKS.split('|'))
  const counts = new Map<string, number>()
  // une pose dans une fonction dont un paramètre s'appelle `_mjs_prev<Hook>` est enchaînée
  const isChained = (hook: string, ancestors: any[]): boolean => ancestors.some((a: any) =>
    (a.type === 'ArrowFunctionExpression' || a.type === 'FunctionExpression')
    && (a.params ?? []).some((p: any) => (p.type === 'AssignmentPattern' ? p.left : p)?.name === chainParamName(hook)))
  walk.fullAncestor(ast, (node: any, _st: unknown, ancestors: any[]) => {
    if (node.type !== 'CallExpression') return
    const callee = node.callee
    const isHookCallee = callee?.type === 'Identifier' && callee.name === '_mjs_hook'
      || callee?.type === 'MemberExpression' && callee.property?.type === 'Identifier' && callee.property.name === '_mjs_hook'
    if (!isHookCallee) return
    const arg0 = node.arguments?.[0]
    if (arg0?.type !== 'Literal' || typeof arg0.value !== 'string' || !hookNames.has(arg0.value)) return
    if (isChained(arg0.value, ancestors)) return
    counts.set(arg0.value, (counts.get(arg0.value) ?? 0) + 1)
  })
  for (const [name, n] of counts) if (n > 1) return name
  return null
}

export interface TranspileOpts {
  /** Si non précisé, déduit du fichier source. */
  moduleName?: string
  /** @internal la construction (transpile-msg.ts : `mjs build`, `mjs dev`) voit tous les fichiers : une transition hors bibliothèque écrite avec un
   *  réglage sans nom (`*toupie(down)`) y est relevée dans `unnamedSettingAnimations` et jugée en fin de tour (nom inconnu, ou créé par µanim.create) ;
   *  sans elle, transpile() la refuse (`transitions.custom-positional`), comme compileSingle */
  deferUnnamedSettings?: boolean
  /** règles nommées des fichiers `*.types.mjs` du projet (bundler, compileTypesFiles) : un nom cité
   *  dans le `<vars>` du composant est remplacé par sa définition, au build. */
  typeDefs?: Record<string, RuleAst>
  /** classes globales de l'appli (nom → chemin depuis sourceDir) : une source qui en cite une l'importe */
  classes?: Record<string, string>
  /** effets des fichiers `*.effects.mjs` du projet (bundler, compileEffectsFiles) : un effet réglé
   *  se résout à la compilation, un effet CSS part avec le composant qui le pose. */
  effectDefs?: Record<string, ProjectEffect>
  /** texte de chaque règle dans le code émis, pour les messages de développement — `false` en
   *  production (défaut `true`). */
  typesText?: boolean | 'names'
  /** avertissements du développement dans le code émis : une attache (`@attach`) qui rend autre chose qu'une fonction, une prop
   *  à sens unique que l'enfant écrit lui-même (mjs_debug.ts les dit) — `true` en développement seulement (défaut `false`) :
   *  le code de production n'en porte rien. */
  devWarnings?: boolean
  /** construction qui peut rendre côté serveur (cf. Bundler.rendersOnServer) : la route de la liaison d'un champ porte la marque 4, que le
   *  cœur lit pour donner à sa variable ce qui a été tapé dans la page du serveur avant le démarrage (`<server-input>`, mjs_element.ts) ;
   *  absent ou `false` (défaut), le code produit est le même */
  serverRendered?: boolean
  /** les chargements qui montrent un squelette d'eux-mêmes (`effects.skeleton` de mjs.config.json ;
   *  défaut `['await']`) — ici, `await` : un {await} sans branche d'attente */
  skeleton?: string[]
  /** *guard d'office sur un champ lié à une variable typée (`effects.guard` de mjs.config.json ;
   *  défaut `true`, `false` : gardé sans effet ni bulle ; `{ delay }` : la pause, lue au runtime) */
  guard?: boolean | { delay?: number | string }
  /** les stores typés dans le `<vars>` d'un composant du projet (bundler) : un champ lié à l'un d'eux
   *  reçoit *guard d'office, même quand la règle est posée par un autre composant */
  typedStores?: string[]
  /** les modèles en fichier des composants (`carte.compacte.mjs`), cf. ParseDiag.models */
  models?: { dev?: Record<string, string[]>, core?: Record<string, string[]> }
  /** classement des valeurs dérivées, « précise » ou « horloge » (analyzer/derived-classes.ts), rendu dans
   *  `TranspileData.derivees` pour `mjs check --derived` — sans lui (défaut `false`), rien n'est calculé et le code
   *  produit est le même */
  derived?: boolean
  /** avec `derived` : les méthodes du composant (`@m = ->`) qu'une valeur dérivée appelle sont suivies comme les
   *  fonctions du `<script>` — mesure d'une autre règle, jamais posée par le bundler (défaut `false` : une valeur qui
   *  appelle une méthode est à l'horloge) */
  derivedMethods?: boolean
  /** valeurs calculées précises (option d'appli `derived: "precise"`, mjs.config.json) : les sources des valeurs que le compilateur prouve
   *  précises sont posées sur leur enveloppe (analyzer/derived-classes.ts) et l'écho d'une liaison `!{}` est marqué (generator/attributes) ;
   *  absent ou `false` (défaut), le code produit est celui de la règle de l'horloge */
  derivedPrecise?: boolean
  /** un composant redessiné par un état partagé fait passer tous ses reffets (cœur bâti sans le choix des reffets, cf. Bundler.reffetsAll) :
   *  le relevé ne pose aucune marque de doute sur `µ.effect(…)` (generator/effect-deps.ts) */
  reffetsAll?: boolean
  /** objets de l'état (option d'appli `proxy`, mjs.config.json) : `false`, ils sont rangés sans enveloppe — `++`, `--`, les affectations
   *  composées ou logiques et les cibles d'un motif sur un chemin de l'état local (`$o.n++`, `$o.a += 1`, `$o.b ||= 5`) s'écrivent par
   *  `µ._mjs_deepSet`, comme `$o.a = v` (generator/path-tracker.ts) ; absent ou `true` (défaut), le code produit est le même */
  proxy?: boolean
  /** taille du texte adaptée à l'écran (option d'appli `responsiveFontSize`, mjs.config.json, cf. transpiler/font-size) : chaque
   *  `font-size` en px au-dessus du seuil, dans le `<style>` et les déclinaisons, devient `var(--mjs-fs-<valeur>)` ; absent = coupé
   *  (un module du cœur n'en reçoit jamais) */
  responsiveFontSize?: FontSizeSettings
  /** pages d'une table de routes (option d'appli `routes.preload`, mjs.config.json) : 'on' toutes demandées au montage du composant
   *  qui porte la table, 'idle' (défaut) confiées au routeur qui les charge au repos après l'affichage, 'off' chacune à sa première visite */
  routesPreload?: 'on' | 'idle' | 'off'
  /** Langage par défaut pour <script> sans `lang=`. */
  defaultScriptLang?: SupportedLang
  /** Grammaire du gabarit : `'civet'`, la seule (défaut) ; `'js'`, l'ancienne grammaire, est refusée (le gabarit se lit toujours en
   * Civet). */
  templateLang?: 'civet'
  /** Vars `$xxx` externes (ex: importées) à exclure du store local. */
  externalVars?: string[]
  /** Répertoire d'injection (chemin de sortie pour `_mjs_dir`). */
  dirInject?: string
  /** Répertoire du fichier source — utilisé pour résoudre `<@include partial>`. */
  baseDir?: string
  /**
   * Racine du tree source (`mjs.config.json` `sourceDir`). Permet à
   * `<@include name>` de fallback sur `<sourceDir>/shared/_<name>.mjs` si
   * le partial n'existe pas localement.
   */
  sourceDir?: string
  /**
   * Résout UN asset logique en chemin web. Si fourni, transpile remplacera
   * `µasset('foo')` / `µ.asset('foo')` par le path résolu AVANT compilation
   * langage — Coffee/Civet/TS ne voient jamais l'appel, juste un literal.
   */
  resolveAsset?: (logicalPath: string) => Promise<string>
  /** `µimage('x'[, largeurs])` déjà résolu côté master : le TEXTE EXACT de
   *  l'appel → l'objet JSON. Le worker n'a pas le disque, et il faut lire l'en-tête du
   *  fichier pour ses dimensions natives. Substitué APRÈS l'inlining des `<@include>`,
   *  au même endroit que `µasset` — un `µimage` qui ne vit que dans un partial est donc
   *  traité comme les autres. */
  preResolvedImages?: Record<string, string>
  /**
   * Tag custom-element alias additionnel à enregistrer (ex: `mjs-snippets-card`
   * en plus du tag principal `mjs-tuto-snippets-card`). Permet aux components
   * d'être référencés sans le préfixe parent dir.
   */
  aliasTag?: string
  /**
   * Sigil d'API tapé par le dev : `'µ'` (défaut) ou `'mjs'` (fallback ASCII
   * clavier non-AZERTY). En `'mjs'`, `mjs.X`/`mjs$X`/`mjs$$X` sont normalisés en
   * `µ.X`/`µ$X`/`µ$$X` avant tout le reste. Le séparateur (`.`/`$`) est
   * obligatoire — pas de forme courte collée.
   */
  sigil?: 'µ' | 'mjs'
  /**
   * Alias ASCII pour les sigils contexte/partagé (clavier sans `§`). Opt-in,
   * `false` par défaut. Quand `true` : `__context.X` → `§X` (contexte) et
   * `__shared.X` → `§§X` (partagé global), normalisés AVANT tout le reste.
   * `§`/`§§` restent les formes canoniques. (Le store, lui, s'écrit déjà en
   * ASCII : `$$X`/`µ$$X` — pas besoin d'alias mot.)
   */
  contextAlias?: boolean
  /**
   * Lint « trop de variables d'état » : au-delà de N `$x` distinctes dans UN
   * composant, un AVERTISSEMENT de compilation (jamais bloquant) oriente vers
   * le découpage en sous-composants. `0` désactive. Défaut : 40.
   */
  maxStateVars?: number
  /**
   * Lint d'accessibilité (a11y) — sept contrôles ciblés (image sans alt, iframe
   * sans title, tabindex positif, @click non interactif, bouton/lien sans nom
   * accessible, champ de saisie sans étiquette), cf. transpiler/a11y.ts. Simple
   * AVERTISSEMENT de compilation, jamais bloquant. Défaut : `true` (activé) ;
   * `false` désactive tout le contrôle (`lint.a11y` dans `mjs.config.json`).
   */
  a11y?: boolean
  /**
   * Lint « <form> sans action ni méthode » (ujsForm) — le pont UJS (cf.
   * src/runtime/mjs_ujs.ts, µ._mjs_ujsShadowAttach) intercepte TOUT <form>, même
   * sans rien à envoyer ; avertit quand ni action, ni @method/mjs-method, ni
   * @noUJS ne sont posés, cf. transpiler/ujs-form.ts. Simple AVERTISSEMENT de
   * compilation, jamais bloquant. Défaut : `true` (activé) ; `false` désactive
   * tout le contrôle (`lint.ujsForm` dans `mjs.config.json`).
   */
  ujsForm?: boolean
  /**
   * Coupe individuellement les DEUX autres types d'avertissement que ce fichier émet — `include`
   * (`<@include>` sans baseDir) et `routes` (`@routes` qui réassigne un bloc `<routes>`) —
   * cf. src/diagnostics.ts pour la table complète des types et leur gravité. `a11y`/
   * `maxStateVars`/`ujsForm` ci-dessus restent gérés par leur PROPRE champ, jamais par ce bag.
   */
  lint?: LintToggles
  /**
   * Le terminal accepte-t-il la couleur, calculé UNE FOIS par le thread principal
   * (`resolveColorsEnabled`, src/diagnostics.ts) puis transmis ici : un thread de travail
   * n'est jamais un terminal, il ne redétermine jamais ça lui-même. Défaut `false` — un
   * appelant isolé de `transpile()` (test, outillage) n'a pas besoin de couleur.
   */
  colorsEnabled?: boolean
  /**
   * Préfixe des variables de thème : `$$brand` (dans un `<style>` ou un `<theme>`)
   * compile en `var(--<varPrefix>-brand)`. Défaut `'mjs'`, réglable dans
   * `mjs.config.json`. UN SEUL préfixe pour tout le monde — jamais de préfixe
   * dérivé du nom du module (ce qui est déclaré
   * cascade dans toute la descendance et reste surchargeable, comme en CSS).
   */
  varPrefix?: string
  /**
   * `true`/`false` = le fichier compilé se nomme
   * (ou pas) `<nom>.page.mjs`, déduit par le BUNDLER du VRAI nom de fichier (jamais
   * reconstruit ici : `TranspileOpts` n'a pas de champ nom de fichier, cf. `moduleName`
   * déjà amputé de `.mjs`/`.page`). `false` ACTIVE la garde : un module qui porte un
   * bloc `<routes>`, la directive `@routes` ou une balise `<@view>` devient un refus de
   * compilation. `undefined` (transpile()/transpileFile() appelés directement — tests,
   * outillage) laisse la garde INACTIVE : aucune régression pour un appelant qui ignore
   * cette option.
   */
  isPageModule?: boolean
  /** le nom du fichier compilé tel qu'écrit (`accueil.page.mjs`, `carte.compacte.mjs`), cité par les positions des fautes ;
   *  `<moduleName>.mjs` à défaut */
  sourceFileName?: string
}

// ----------------------------------------------------------------------------
// normalizeContextAlias — réécrit les alias ASCII contexte/partagé en `§`/`§§`.
// `__shared.foo` → `§§foo`, `__context.foo` → `§foo` (get ET set, car les deux
// commencent par `§foo`). Reconnu en accès propriété, précédé d'une frontière
// de mot (`foo__context` n'est jamais touché). Opt-in (off par défaut).
// ----------------------------------------------------------------------------
export function normalizeContextAlias(src: string, enabled?: boolean): string {
  if (!src || !enabled) return src
  return src
    .replace(/(?<![\w$])__shared\.([a-zA-Z_]\w*)/g, '§§$1')
    .replace(/(?<![\w$])__context\.([a-zA-Z_]\w*)/g, '§$1')
}

// ----------------------------------------------------------------------------
// normalizeSigilAlias — réécrit l'alias ASCII du sigil (`mjs`) en `µ`.
//
// Reconnu UNIQUEMENT suivi d'un séparateur de sigil (`.`, `$`) et précédé
// d'une frontière de mot : `mjs.effect` → `µ.effect`, `mjs$count` → `µ$count`,
// `mjs$$store` → `µ$$store`. Jamais collé à une lettre, donc `mjsonp`/`formjs`
// etc. ne sont JAMAIS touchés. `µ` reste le sigil canonique interne.
// ----------------------------------------------------------------------------
const SIGIL_ALIASES: Record<string, RegExp> = {
  mjs: /(?<![\w$])mjs(?=[.$])/g,
}
export function normalizeSigilAlias(src: string, sigil?: string): string {
  if (!src || !sigil || sigil === 'µ') return src
  const re = SIGIL_ALIASES[sigil]
  return re ? src.replace(re, 'µ') : src
}

// L'alias s'écrit pour `µ` dans le CODE seul, jamais dans ce qui s'affiche ou se lit tel quel : avant, `mjs.dev`
// devenait `µ.dev` dans le texte, les liens, `<pre>`, les chaînes du script, et `.mjs.actif` devenait `.µ.actif`
// dans la feuille de style (règle perdue).

// le code (script, expression `{…}`, ligne `@import`) : alias hors chaînes, commentaires et regex, l'intérieur des
// interpolations compris (vue maskNonCode, même longueur)
export function sigilAliasCode(src: string, sigil: string, lang = 'civet'): string {
  const re = SIGIL_ALIASES[sigil]
  if (!re || !src.includes(sigil)) return src
  const view = maskNonCode(src, lang)
  return src.replace(re, (m: string, pos: number) => view.startsWith(m, pos) ? 'µ' : m)
}

// un appel d'asset ou d'image écrit en clair dans un attribut (`<img src="mjs.asset('x.png')">`) : la résolution des
// assets le cherche dans tout le HTML, il garde l'alias
const ALIAS_PLAIN_CALL_RE = /(?<![\w$])mjs(?=\.(?:asset|image)\s*\()/g

// le HTML et les directives : alias dans les expressions `{…}` et les directives `@import` (débuts de ligne donnés par la
// lecture partagée, comptés depuis le début du fichier : `decalage` est celui de ce morceau) ; le texte, les attributs,
// `<pre>`, les commentaires HTML restent tels qu'écrits
function sigilAliasHtml(html: string, sigil: string, directives: Set<number>, offset: number): string {
  if (!SIGIL_ALIASES[sigil] || !html.includes(sigil)) return html
  let out     = ''
  let text    = ''
  const clear = () => { if (text) { out += text.replace(ALIAS_PLAIN_CALL_RE, 'µ'); text = '' } }
  const n     = html.length
  // accolades sans fin rendues par finExpression : relire depuis l'une d'elles ne se refermerait pas davantage (même mémoire que
  // scanTagClose : un gabarit aux accolades non refermées coûtait un temps quadratique)
  const noEnd = new Set<number>()
  let i = 0
  while (i < n) {
    if (directives.has(offset + i)) {
      clear()
      const nl  = html.indexOf('\n', i)
      const end = nl < 0 ? n : nl + 1
      out += sigilAliasCode(html.slice(i, end), sigil)
      i = end
      continue
    }
    if (html.startsWith('<!--', i)) {
      const comment = readHtmlComment(html, i)
      if (comment !== null) {
        clear()
        out += html.slice(i, comment.end)
        i = comment.end
        continue
      }
    }
    if (html[i] === '{' && !noEnd.has(i)) {
      const end = expressionEnd(html, i, noEnd)
      if (end > 0) {
        clear()
        out += sigilAliasCode(html.slice(i, end), sigil)
        i = end
        continue
      }
    }
    text += html[i]
    i++
  }
  clear()
  return out
}

// la source entière : chaque <script> par sigilAliasCode, le HTML et les directives par sigilAliasHtml ; <style> et
// <theme> (`.mjs.actif` y est un sélecteur) et <vars> (une règle n'a pas de rune : `'mjs.fr'` ne devient pas
// `'µ.fr'`) tels qu'écrits. Sections trouvées comme extractSections et extractDirectives les trouvent
function sigilAliasOutsideVars(src: string, sigil?: string, defaultLang = 'civet'): string {
  if (!src || !sigil || sigil === 'µ' || !SIGIL_ALIASES[sigil] || !src.includes(sigil)) return src
  const zones: Array<{ start: number; end: number; lang: string | null }> = []
  const { moduleScripts, scripts } = findScriptMatches(src)
  for (const m of [...moduleScripts, ...scripts]) {
    const idx   = m.indices!
    const body  = idx[idx.length - 1]
    const attrs = src.slice(idx[0][0], body[0])
    zones.push({ start: body[0], end: body[1], lang: /lang[ \t]*=[ \t]*['"]([^'"]+)['"]/.exec(attrs)?.[1] ?? defaultLang })
  }
  const styles = findStyleMatches(src, [...moduleScripts, ...scripts])
  for (const m of styles.matches) zones.push({ start: m.indices![0][0], end: m.indices![0][1], lang: null })
  for (const m of styles.maskedView.matchAll(/^[ \t]*<theme\b[^>]*>[\s\S]*?<\/theme>/gmd)) zones.push({ start: m.indices![0][0], end: m.indices![0][1], lang: null })
  for (const m of src.matchAll(/^[ \t]*<vars\b[^>]*>[\s\S]*?<\/vars>/gmd)) zones.push({ start: m.indices![0][0], end: m.indices![0][1], lang: null })
  zones.sort((a, b) => a.start - b.start)
  const directives = new Set(readImportDirectives(src).map(d => d.index))
  let out          = ''
  let last         = 0
  for (const z of zones) {
    if (z.start < last) continue
    out += sigilAliasHtml(src.slice(last, z.start), sigil, directives, last)
    out += z.lang === null ? src.slice(z.start, z.end) : sigilAliasCode(src.slice(z.start, z.end), sigil, z.lang)
    last = z.end
  }
  return out + sigilAliasHtml(src.slice(last), sigil, directives, last)
}

export interface TranspileData {
  /** carte de source v3 (JSON stringifié) du `<script>` composant, déjà
   * décalée sur la vraie ligne du `.mjs`. `undefined` si le compilateur du langage choisi
   * n'en produit pas, ou si la section est vide. Couvre seulement la compilation langage
   * — pas les 5 passes de génération qui suivent. */
  scriptSourceMap?: string
  /** Idem pour `<script module>`. */
  moduleSourceMap?: string
  moduleName: string
  className: string
  tagName: string
  /** Registre de présence des state vars (`_mjs_var_bits = { x: 1, y: 1 }`).
   * V2 : ce n'est plus un bitmask mais juste un dict de présence — conservé
   * pour rétrocompat avec les stores universels qui font `_mjs_var_bits[k] !== undefined`. */
  varBitsStr: string
  /** Closure transitive des deps des computeds (`_mjs_computedDeps = { "c": ["a","b"] }`).
   * Entrées non vides seulement — consommée par µ.effect (mjs_runes.ts) pour étendre
   * staticVars aux RACINES d'un computed chaîné. */
  computedDepsStr: string
  passiveEvents: string[]
  /** HTML final compilé (avec marqueurs mjs) — observable de débogage/test.
   *  (Le walk legacy extractPaths qui produisait l'ancienne variante a été
   *  retiré ; ce champ expose désormais directement le HTML à marqueurs.) */
  surgicalHtml: string
  /** Body JS de la fonction `__create_X()`. Construit le DOM impérativement
   * et retourne `{ fragment, refs }` où `refs` = pointeurs directs aux nodes. */
  createFnBody: string
  /** Vue sans nœud repéré (`refs` vide : ni nœud réactif, ni événement, ni bloc) : `_mjs_evt_ids` vaut alors 0 (cf. `injectTemplate`). */
  noRefs?: boolean
  // Valeur : id numérique simple, [id, flags] (modificateurs .once/.propagate…),
  // ou LISTE de [id, flags] quand plusieurs handlers partagent le couple
  // (événement, nœud) — liaison two-way + directive `@événement`.
  events: Record<string, Record<string, EventRoute>>
  structUpdates: string[]
  transUpdates: string[]
  /** Code source des effets indexés par varName : `{ var: '[() => { ... }, ...]' }`.
   * Sera émis comme `_mjsThis._mjs_effectsByVar = { ... }`. */
  effectsByVarStr: string
  /** Liste de tous les effects en un seul tableau JS : `[() => {...}, ...]`.
   * Sera émis comme `_mjsThis._mjs_effectsAll = [...]` et exécuté au mount initial. */
  effectsAllStr: string
  /** mise à jour fine : la ligne qui pose `_mjsThis._mjs_fine = { … }` dans `init`, juste après `_mjs_effectsAll` (cf. tableFine),
   * vide sans table */
  fineLine?: string
  /** liaisons two-way vers un composant enfant (root), rejouées
   * SYNCHRONEMENT dans `init()` juste après `_mjs_effectsAll`, avant tout
   * connectedCallback — cf. state.initialPropBinds. Code brut joint (chaque
   * entrée est déjà un bloc `{ ... }` complet). */
  initialPropBindsStr: string
  /** Vars qui pilotent les blocs structurels. Émise comme un object
   * `{ "var1": 1, "var2": 1, ... }` pour lookup O(1) côté runtime.
   * Si vide ET pas de struct → `_mjs_renderStruct` n'est jamais ré-appelé hors mount. */
  structVarsStr: string
  /** Statisation $$ — ligne `_mjsThis._mjs_storeKeys = [...]` (clés NUES du
   * store universel mentionnées par ce composant, + '*' si structurel) ;
   * chaîne VIDE si le composant ne touche pas au store (pas de subscription). */
  storeKeysLine: string
  /** Statisation $$ — ligne module-level `µ._storeDeclare([...])`, exécutée
   * UNE fois au chargement (pas par instance) ; chaîne VIDE si aucune clé $$. */
  storeDeclareLine: string
  /** types — lignes module-level collées après `storeDeclareLine` : la table des règles des
   *  variables et props (`const _mjs_T_<Classe> = {…};`) et celle des stores
   *  (`µ._mjs_storeTypes({…});`) ; chaîne VIDE sans bloc `<vars>` (sortie inchangée). */
  typesDecl: string
  /** types — ligne d'instance collée après `stateMethodClashLine` : `this._mjs_types = …;`,
   *  posée avant le script (la valeur de départ passe la règle) ; chaîne VIDE sinon. */
  typesLine: string
  /** réglage `proxy: false` : ligne d'instance `this._mjs_otherNames = { sel: ['rows'] };`, les variables que le script ou un gestionnaire
   *  fait autres noms d'une autre (`$sel = $rows[i]`, cf. stateAliases) ; chaîne VIDE sinon, et toujours avec l'enveloppe */
  aliasLine: string
  /** types — texte canonique de la règle de chaque store déclaré dans le `<vars>` : le build
   *  refuse deux règles différentes pour le même store. */
  storeTypes: Record<string, string>
  /** types — le `<vars>` cite une règle nommée : le composant dépend des fichiers `*.types.mjs`. */
  usesNamedTypes: boolean
  /** le composant pose un effet de l'appli : il dépend des fichiers `*.effects.mjs`. */
  usesProjectEffects: boolean
  /** collision état/méthode homonymes : ligne d'instance collée en fin
   * de `this._mjs_var_bits = […];` (jamais de retour à la ligne avant), qui liste
   * les noms `$x`/`@x` homonymes pour que le runtime épargne la MÉTHODE au
   * salvage pré-upgrade (mjs_element.ts) ; chaîne VIDE si aucune collision. */
  stateMethodClashLine: string
  /** i18n — ligne d'instance `_mjsThis._mjs_i18n = [section, mode];` (émise
   *  seulement si @i18n OU le JS final contient `µ.t(`) ; chaîne VIDE sinon
   *  (zéro coût pour les modules sans i18n). Un module à plusieurs sections
   *  (`@i18n 'a' 'b'`) y ajoute un 3e élément, la liste des sections en plus. */
  i18nLine: string
  jsModule: string
  jsInitBase: string
  baseCss: string
  /** variables de thème DÉCLARÉES par les blocs `<theme>` du composant (registre du build). */
  themeVars: ThemeVar[]
  /** ce que le composant lit et écrit pour les contrôles de construction propUnknown, routeUnknown et i18nKeyUnknown,
   *  croisés par le bundler une fois le projet compilé (cf. transpiler/build-checks.ts) */
  checks?: BuildChecks
  /** variables de thème LUES (`$$x`) dans le `<style>` et les `<theme>` — sert à repérer une faute de frappe. */
  varsRead: string[]
  /** Noms des variantes déclarées (`<theme name="gold">`) — active `theme="gold"` sur l'instance. */
  themeVariants: string[]
  /** CSS de chaque déclinaison (`<style name="bandeau">`), par nom — écrit en fichier frère par le build. */
  layoutCss: Record<string, string>
  /** tailles du texte rendues adaptables (`41.5`…), sans doublon, rangées : le build pose leurs variables sur :root (cf. transpiler/font-size) */
  fontSizes: string[]
  /** le composant lit µlayout : sa prop `layout` choisit aussi le style nommé (cf. mjs_element.ts, `_set`) */
  layoutRune?: boolean
  sharedCssNames: string[]
  moduleDisplay: string
  modulePreload: string | null
  /** `@formAssociated` (cf. directives.ts) : la ligne du socle du formulaire avant l'enregistrement de la balise. */
  moduleFormAssociated?: boolean
  moduleViewTransition: string | null
  moduleViewTransitionPriority: number
  hasDynamicSlots: boolean
  /** Animations détectées dans `@transition.X / @in.X / @out.X`. */
  usedAnimations: string[]
  /** @internal ceux de usedAnimations écrits avec un réglage sans nom (`*nom(down)`), relevés pour la seule construction
   *  (cf. TranspileOpts.deferUnnamedSettings), qui les juge en fin de tour */
  unnamedSettingAnimations: string[]
  /** `true` si le composant déclare AU MOINS un `@transition/@in/@out/@attach/@this=!/@flip`.
   * Si `false`, `_mjs_destroyNodeAndChildren` bypass le walk DFS (gain replace1k / clear1k). */
  hasDestroyHooks: boolean
  /** `true` si le composant déclare AU MOINS un `@flip` → pose `static
   * _mjs_hasFlip = true`, qui ACTIVE le wrapper FLIP de `_mjs_reconcileList`.
   * Sans ce flag, `@flip` était inerte (bug : `_has_flip` jamais posé). */
  hasFlip: boolean
  /** Chemins absolus des partials inlinés via `<@include …>`. Le bundler s'en
   * sert pour reverse-mapper "partial → parents" et déclencher la recompile
   * des parents quand le partial change. */
  includedPartials: string[]
  /** diagnostics de `processIncludes`
   * (partial introuvable, <@include> circulaire) : avant, uniquement un
   * `console.error` DANS LE WORKER, jamais remonté dans `stats.errors` du
   * bundler (build vert malgré un composant réellement incomplet). Le
   * bundler pousse chaque entrée dans `stats.errors`. */
  macroErrors: string[]
  /** Références `<@nom>`/`<mjs-nom>`/`<mjs-core-nom>` (notation
   * unique, `<@mjs-nom>` est une erreur de migration) collectées par le
   * parseur (resolveTagName, parser/index.ts) ; le bundler les résout par
   * file APRÈS le manifeste complet (post-passe de compile()) — jamais
   * résolues ici, un seul fichier ne connaît pas les autres. */
  tagRefs: TagRef[]
  /** un composant/partial
   * avec un 2e `<script>` (hors `module`) ou un 2e `<style>` voyait ce
   * contenu SILENCIEUSEMENT jeté (`extractSections` ne gardait que le
   * PREMIER de chaque, sans le moindre signal) — perte de code identique au
   * motif dominant (build vert malgré un composant incomplet). */
  sectionWarnings: string[]
  /** Tag alias additionnel (ex `mjs-snippets-card` pour file `tuto-snippets-card.mjs`). */
  aliasTag?: string
  /** Dépendances DIRECTES de balises du gabarit (cf. collectDirectComponentDeps,
   * generator/compile.ts) — noms bruts, pas encore résolus contre le manifeste. */
  componentDeps: string[]
  /** classement des valeurs dérivées du `<script>`, dans l'ordre où elles sont écrites — seulement avec
   *  `TranspileOpts.derived` */
  derivedClasses?: ClassifiedDerived[]
}

// ----------------------------------------------------------------------------
// replaceMagicAssets — remplace `µasset('X')` / `µ.asset('X')` par un string
// literal du path web résolu, AVANT compilation langage. Le compilateur ne
// voit donc qu'un literal, pas un appel de fonction inconnu.
// `lang` fourni (<script>/<script module>) : ne résout la forme NUE (sans guillemet collé) que si
// elle tombe sur du texte encore VISIBLE sur la vue masquée (maskNonCode, MÊME longueur) — un
// `µasset(...)` simplement CITÉ dans une chaîne/un commentaire (exemple de log affiché) est, lui,
// blanchi avec le reste de sa chaîne englobante, donc jamais retrouvé. La forme AUTO-QUOTÉE
// (guillemet collé des deux côtés, `"µasset('x')"`) reste résolue SANS cette garde — c'est la
// forme émise par le compilateur lui-même pour `@import` (spécificateur ES, forcément une chaîne),
// une vraie chaîne de bout en bout, jamais autrement retrouvable sur la vue masquée (le guillemet
// adjacent, lui aussi, y est blanchi). `lang` absent (HTML) : un exemple de doc `<pre>/<code>`
// montrant `µasset('...')` en TEXTE n'est pas un vrai appel — masqué en BLOC (maskDocBlocks,
// stash+restore, même outil que preprocessHtml), le reste du HTML (attribut direct compris, ex.
// `<img src="µasset('x.png')">`) continue de tourner normalement.
// ----------------------------------------------------------------------------
const ASSET_CALL_RE = /(['"]?)(?:µasset|µ\.asset)\(['"](.+?)['"]\)\1/g

async function applyAssetReplacements(
  text: string,
  matches: RegExpMatchArray[],
  resolveAsset: (path: string) => Promise<string>
): Promise<string> {
  // un chemin qui porte `#{…}` (guillemets doubles de Civet et de CoffeeScript) est un nom calculé, jamais un fichier de ce nom, et un
  // chemin qui porte son guillemet d'ouverture enjambe une concaténation (`µasset('a/' + n + '.mp3')`) : la construction lit le premier
  // en motif sur le code compilé, comme la seconde ; un appel lu sur un autre objet (`globalThis.µ.asset('x')`) n'est pas la rune : la
  // construction le refuse (cf. resolveAssetPatterns, bundler/index.ts)
  matches = matches.filter(m => !m[2].includes('#{') && !m[2].includes(m[0][m[0].indexOf('(') + 1]) && (m[1] !== '' || !/[\w$.]/.test(text[m.index! - 1] ?? '')))
  if (matches.length === 0) return text
  const replacements = await Promise.all(matches.map(async (m) => {
    const [full, quote, logicalPath] = m
    const webPath = await resolveAsset(logicalPath)
    const to = quote ? `${quote}${webPath}${quote}` : `'${webPath}'`
    return { from: full, to }
  }))
  let out = text
  // chaque appel retenu remplacé À SA PLACE, du dernier au premier (les positions d'avant restent justes) : un
  // `.replace(texte)` visait la PREMIÈRE occurrence du texte — le même appel cité plus haut dans un commentaire ou une
  // chaîne recevait l'adresse, l'appel réel restait non résolu. `to` est inséré tel quel (un `$` du chemin ne compte pas)
  for (let k = matches.length - 1; k >= 0; k--) {
    const at = matches[k].index!
    out = out.slice(0, at) + replacements[k].to + out.slice(at + replacements[k].from.length)
  }
  return out
}

// les feuilles de style du composant : même remplacement que le HTML, sans le masquage des blocs de doc (`<pre>` et `<code>` n'existent pas
// en CSS) et avec les alias ASCII (`mjs.asset`), que l'alias de sigil ne réécrit pas dans un style — en SASS le `.` préfixe une classe
const STYLE_ASSET_CALL_RE = /(['"]?)(?:µasset|µ\.asset|mjsasset|mjs\.asset)\(['"](.+?)['"]\)\1/g

async function replaceStyleAssets(text: string, resolveAsset: (path: string) => Promise<string>): Promise<string> {
  return applyAssetReplacements(text, [...text.matchAll(STYLE_ASSET_CALL_RE)], resolveAsset)
}

async function replaceMagicAssets(
  text: string,
  resolveAsset: (path: string) => Promise<string>,
  lang?: string
): Promise<string> {
  if (lang === undefined) {
    const { masked, restore } = maskDocBlocks(text)
    return restore(await applyAssetReplacements(masked, [...masked.matchAll(ASSET_CALL_RE)], resolveAsset))
  }

  // Forme AUTO-QUOTÉE (guillemet COLLÉ des deux côtés, `"µasset('x')"`, `group1` non vide) :
  // TOUJOURS résolue, sans garde — c'est la forme émise par le compilateur lui-même pour
  // `@import` (spécificateur ES obligatoirement une chaîne, cf. dir.pendingAutoImports plus
  // bas) : une vraie chaîne de A à Z, indiscernable d'un exemple de doc SAUF par cette adjacence
  // stricte, et de toute façon jamais retrouvable sur la vue masquée (maskNonCode blanchit le
  // guillemet adjacent tout autant que le reste d'une chaîne). Forme NUE (`group1` vide) : ne
  // résoudre que si sa position tombe sur du texte encore VISIBLE sur la vue masquée — sinon
  // c'est une simple mention à l'intérieur d'une AUTRE chaîne/un commentaire.
  const masked = maskNonCode(text, lang)
  const matches: RegExpMatchArray[] = []
  for (const m of text.matchAll(ASSET_CALL_RE)) {
    if (m[1] || masked.slice(m.index!, m.index! + m[0].length).trim() !== '') matches.push(m)
  }
  return applyAssetReplacements(text, matches, resolveAsset)
}

// ----------------------------------------------------------------------------
// replaceMagicImages — remplace `µimage('X'[, 480, 960])` par le littéral OBJET
// résolu au build (`{"src":"…","srcset":"…","width":1920,"height":800}`). Le
// compilateur ne voit donc qu'un objet, jamais un appel de fonction inconnu.
// Indexé par le TEXTE EXACT de l'appel : deux appels au même fichier avec des
// largeurs différentes sont deux entrées distinctes.
// ----------------------------------------------------------------------------
function replaceMagicImages(text: string, images?: Record<string, string>): string {
  if (!images) return text
  let out = text
  for (const [call, json] of Object.entries(images)) out = out.split(call).join(json)
  return out
}

// lints du script (lint.ts) : réexportés ici pour le bundler, la CLI et les tests
export { lintSingletonConsume, lintImportDollarName, lintEffectTopLevel, lintEffectOldName, lintEmitInModule, lintOnUrlChangeLegacy, parseModuleAst, lintUndeclaredTopLevelAssignment, sourceLineOf, lintNoRawImport }

// lintSplitRune (split-rune.ts) — rune séparée de son symbole par un espace ou un retour à la ligne : réexportée
// ici avec les règles sœurs ; rangée à part pour être lue aussi par macros.ts (script des partiels) sans cycle
export { lintSplitRune }

// ----------------------------------------------------------------------------
// collectTopLevelDeclarations — les noms déclarés au NIVEAU RACINE d'un module compilé,
// séparés par nature : `binding` (let/var/function/class, réaffectables) ou `const`.
// Source d'autorité pour savoir ce qu'un handler inline voit par closure — l'AST du JS
// ÉMIS, jamais le texte source (un `nom = …` dans un commentaire ou une chaîne n'y est pas).
// ----------------------------------------------------------------------------
function collectTopLevelDeclarations(ast: acorn.Node | null, nature: 'binding' | 'const'): string[] {
  if (!ast) return []
  const out: string[] = []
  const push = (pat: any): void => {
    if (!pat) return
    switch (pat.type) {
      case 'Identifier':          out.push(pat.name); break
      case 'ObjectPattern':       for (const p of pat.properties ?? []) push(p.value ?? p.argument); break
      case 'ArrayPattern':        for (const el of pat.elements ?? []) push(el); break
      case 'AssignmentPattern':   push(pat.left); break
      case 'RestElement':         push(pat.argument); break
    }
  }
  for (const rawNode of ((ast as any).body ?? []) as any[]) {
    // `export let x = …`/`export const x = …`/
    //    `export function f(){}` : la déclaration réelle vit dans `node.declaration`,
    //    ignorée jusqu'ici → un module qui EXPORTE une var la perdait de la collecte
    //    (moduleVars comme moduleTopVars) → un handler `@click={x = 3}` déclarait un
    //    `x` LOCAL homonyme au lieu d'écrire la var exportée du module — écriture
    //    perdue en silence.
    const node = rawNode.type === 'ExportNamedDeclaration' && rawNode.declaration ? rawNode.declaration : rawNode
    if (node.type === 'VariableDeclaration') {
      if ((node.kind === 'const') !== (nature === 'const')) continue
      for (const d of node.declarations ?? []) push(d.id)
    }
    else if (nature === 'binding' && (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') && node.id) {
      out.push(node.id.name)
    }
  }
  return out
}

// noms qu'un `import` pose au premier niveau d'une section compilée (`import { fmt } from …`,
// `import * as u from …`, `import d from …`) — visibles des gestionnaires par closure
function collectImportNames(ast: acorn.Node | null): string[] {
  const out: string[] = []
  for (const node of ((ast as any)?.body ?? []) as any[]) {
    if (node.type !== 'ImportDeclaration') continue
    for (const s of node.specifiers ?? []) if (s.local?.name) out.push(s.local.name)
  }
  return out
}

// ----------------------------------------------------------------------------
// maskStaticHtmlText —
// gèle le texte HTML STATIQUE d'un template (hors `<script>…</script>`, hors
// lignes `@import` — réécrites par CETTE MÊME passe 0-bis, cf. transpile()
// plus bas —, hors sites `{…}` d'interpolation) avant la réécriture µ$$X→$X.
// PARITÉ avec le mécanisme historique : le générateur n'exécute JAMAIS aucun
// sigil sur le texte statique d'un nœud (`case 'text': return node.content`,
// generator/compile.ts — vérifié sur pièce, témoin compilé avec §§X en texte
// nu : survit littéralement) — seul un site `{…}` extrait passe par
// cleanJsExpr/tokenize. Un `µ$$X` écrit en toutes lettres dans un paragraphe
// de doc/tuto (hors <code>, déjà couvert par maskDocBlocks) ne doit donc NI
// throw NI être réécrit : seul un usage RÉEL (`<script>`, `{…}`) est concerné.
// Comptage d'accolades conscient des chaînes imbriquées (même garde que
// interpolateSigils, lexer/index.ts) : `{foo('}')}` reste UNE seule expression
// LIVE, jamais coupée au faux `}` de la chaîne. Détection `<script>`/`@import`
// volontairement simple (non-greedy, même rigueur que maskDocBlocks pour
// <pre>/<code>) : un `</script>` littéral DANS une chaîne du script est un
// piège déjà connu et traité ailleurs, plus rigoureusement (extractSections,
// vue masquée + `m.indices`) — hors périmètre de cette passe amont.
// ----------------------------------------------------------------------------
function maskStaticHtmlText(src: string): { masked: string; restore: (s: string) => string } {
  // débuts de ligne des directives `@import`, donnés par la lecture partagée
  const directives         = new Set(readImportDirectives(src).map(d => d.index))
  const { stash, restore } = createMaskTable(src, 'MJSHTML')
  let out = ''
  let buf = ''
  const flush = () => { if (buf) { out += stash(buf); buf = '' } }
  const n = src.length
  let i = 0
  while (i < n) {
    // directive `@import` : directive de compilateur (pas du texte affiché), la
    // MÊME réécriture 0-bis y opère (gère `default µ$$x`/listes `a, µ$$b`) → LIVE ; une
    // ligne `@import` du texte d'un élément reste du texte, gelée comme lui
    if (directives.has(i)) {
      flush()
      const nl = src.indexOf('\n', i)
      const end = nl === -1 ? n : nl + 1
      out += src.slice(i, end)
      i = end
      continue
    }
    // `<script …>…</script>` (module ou non) : CODE, jamais du texte affiché → LIVE.
    if (src[i] === '<' && /^<script\b/.test(src.slice(i, i + 8))) {
      flush()
      const closeAt = src.indexOf('</script>', i)
      const end = closeAt === -1 ? n : closeAt + '</script>'.length
      out += src.slice(i, end)
      i = end
      continue
    }
    // `{…}` d'interpolation : site RÉEL de template → LIVE (fin lue par finExpression : chaînes, commentaires
    // et regex compris, cf. header) ; jamais refermée, tout le reste
    if (src[i] === '{') {
      flush()
      const end = expressionEnd(src, i)
      const j = end < 0 ? n : end
      out += src.slice(i, j)
      i = j
      continue
    }
    buf += src[i]
    i += 1
  }
  flush()
  return { masked: out, restore }
}

// sucres du script (sugar.ts) : réexportés ici pour le bundler, la CLI et les tests
export { applyCivetDialectSugar, singletonsDeclares, applyMjsSugarToScript, writesInFunctions }

// ----------------------------------------------------------------------------
// escapeVtAttrValue — échappe une valeur VERBATIM `@viewTransition` (nom, ou
// `nom={ options }`) avant de la poser dans un attribut HTML statique
// (`data-mjs-vt="…"`). `"` (délimiteur de l'attribut) ET `{`/`}` (sinon le
// pipeline générique d'attributs statiques la prendrait pour une INTERPOLATION
// JS, cf. generator/attributes/index.ts `rawVal.includes('{')`) sont réécrits
// en entités HTML — décodées automatiquement par le navigateur à
// `getAttribute()`, donc invisibles au runtime (µ._mjs_vtParse reçoit le texte réel).
// ----------------------------------------------------------------------------
function escapeVtAttrValue(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/\{/g, '&#123;').replace(/\}/g, '&#125;')
}

// ----------------------------------------------------------------------------
// extractBraceBody — depuis l'index JUSTE APRÈS un `{` ouvrant déjà consommé (ex. après le
// marqueur littéral `@confirm={`), renvoie le corps jusqu'à l'accolade fermante APPARIÉE + l'index
// de celle-ci (`end: -1` si jamais refermée). DÉLÈGUE à `extractBalanced` (src/parser/index.ts) —
// le scanner du PARSER, déjà exact sur les chaînes `'…'`/`"…"` (échappement respecté), les gabarits
// `` `…` `` (`${…}` imbriqués compris), les commentaires `//`/`/* */` ET les littéraux regex.
// Remplace un scanner maison (ex-`skipTemplate`, RETIRÉ) qui ne connaissait PAS les regex : un `/`
// qui FERME une regex, immédiatement suivi d'un `*` (ex. `/a*/*$n`), était pris pour l'ouverture
// d'un `/* … */` — plus aucun `*/` ne le refermait, tout le reste du fichier avalé (`end: -1`), le
// marqueur `@title=`/`@confirm=` restait intact et retombait sur le pipeline générique d'attributs :
// `@title`/`@confirm` interprétés comme un ÉCOUTEUR d'événement DOM (confirmé par
// exécution : `mjs-title` absent de `_mjs_cloneTpl`, `_mjs_bindEvents({"title":{"e1":0}})` câblé à la
// place). Un guillemet DANS une regex (`/'/`) avait le même effet (pris pour l'ouverture d'une
// vraie chaîne, jamais refermée). Deux scanners pour la même grammaire = dérive garantie (cf.
// sigils.ts, en tête de fichier) — source UNIQUE désormais. Contrat INCHANGÉ : `end: -1` si jamais
// refermé (le parser HTML en amont le dira, comme avant).
// ----------------------------------------------------------------------------
function extractBraceBody(str: string, start: number): { body: string; end: number } {
  const scanner = new Scanner(str)
  scanner.pos    = start
  try {
    const body = extractBalanced(scanner, '}')
    return { body, end: scanner.pos - 1 }                      // pos est juste APRÈS le `}` apparié
  }
  catch {
    return { body: str.slice(start), end: -1 }                 // jamais refermé : contrat inchangé, le parser HTML en amont le dira
  }
}

// ----------------------------------------------------------------------------
// scanQuoted — depuis un guillemet ouvrant `'`/`"` (str[i]), avance jusqu'au guillemet fermant
// APPARIÉ en respectant l'échappement `\\` (saute le caractère suivant, même patron
// qu'extractBraceBody ci-dessus) et rend le contenu DÉS-ÉCHAPPÉ (`\'` → `'`, `\"` → `"`, `\\` → `\`,
// le reste littéral) plus l'index du guillemet fermant (`content`/`end`), ou `null` si jamais
// refermée. Cœur du correctif : les mini-parseurs @confirm/@title
// (`[^']*`/`(?:(?!\1)[\s\S])*`) s'arrêtaient à la 1re apostrophe MÊME ÉCHAPPÉE — exactement le style
// imposé au projet (apostrophe française `\'`) — corrompant l'attribut (forme chaîne) ou
// rejetant à tort la forme objet.
// ----------------------------------------------------------------------------
function scanQuoted(str: string, i: number): { content: string; end: number } | null {
  const quote = str[i]
  let content = ''
  let j = i + 1
  while (j < str.length) {
    const ch = str[j]
    if (ch === '\\') {
      const next = str[j + 1]
      content += (next === "'" || next === '"' || next === '\\') ? next : ch + (next ?? '')
      j += 2
      continue
    }
    if (ch === quote) return { content, end: j }
    content += ch
    j++
  }
  return null
}

// scanTranslatedCall — depuis `str[i]`, reconnaît un appel de la traduction COMPLET (`µt(…)`, `µ.t(…)` ou une forme optionnelle,
// `µt?.(…)`, `µt?(…)`, `µ.t?.(…)`, `µ?.t(…)`, `µ?.t?.(…)` : TRANSLATED_CALL_HEAD_RE ; parenthèses appariées,
// chaînes/gabarits/regex respectés, via extractBalanced) qui termine la valeur d'une clé : suivi de la
// fin du texte ou d'une virgule, rien d'autre (`µt('a') + 'b'` refusé). Rend l'expression telle
// qu'écrite (réécrite ensuite par le pipeline comme dans un gabarit, préfixe de la section compris) et l'index juste après
// la parenthèse fermante, ou `null` : une variable, une concaténation, un autre appel restent refusés.
const TRANSLATED_CALL_HEAD_RE = /(?:µt|µ\??\.t)(?:\?\.?)?\(/y
// la même clé écrite sans parenthèses (`µt 'clé'`, `µ.t "clé"`) : la chaîne seule, rendue avec ses parenthèses (`µt('clé')`) ; ce qui suit
// la virgule est le réglage suivant de la forme objet, jamais un paramètre (une clé à paramètres y garde ses parenthèses)
const TRANSLATED_BARE_HEAD_RE = /(µt|µ\??\.t)[ \t]+(?=['"])/y
function scanTranslatedCall(str: string, i: number): { expr: string; end: number } | null {
  TRANSLATED_CALL_HEAD_RE.lastIndex = i
  const head = TRANSLATED_CALL_HEAD_RE.exec(str)
  if (!head) return scanBareTranslatedCall(str, i)
  const scanner = new Scanner(str)
  scanner.pos = i + head[0].length
  try {
    const body = extractBalanced(scanner, ')')
    const end  = scanner.pos
    if (!/^\s*(?:,|$)/.test(str.slice(end))) return null
    return { expr: `${head[0]}${body})`, end }
  }
  catch {
    return null
  }
}

function scanBareTranslatedCall(str: string, i: number): { expr: string; end: number } | null {
  TRANSLATED_BARE_HEAD_RE.lastIndex = i
  const head = TRANSLATED_BARE_HEAD_RE.exec(str)
  if (!head) return null
  const start = i + head[0].length
  const key   = scanQuoted(str, start)
  if (!key) return null
  const end = key.end + 1
  if (!/^\s*(?:,|$)/.test(str.slice(end))) return null
  return { expr: `${head[1]}(${str.slice(start, end)})`, end }
}

// clampRaw — borne un extrait de source à une longueur d'affichage raisonnable pour un message
// d'erreur (une chaîne @confirm/@title non refermée traînerait sinon TOUT le reste du fichier).
function clampRaw(s: string): string {
  return s.length > 80 ? s.slice(0, 80) + '…' : s
}

// replaceBraceDirective — scanne `html` pour chaque occurrence LITTÉRALE de `marker` (ex.
// `@confirm={`) précédée d'une frontière `\B` (même garde que l'ancien `/\B@confirm=\{.../` : un
// `@` collé à un identifiant, `foo@confirm=`, reste du texte brut), extrait le corps via
// extractBraceBody puis délègue au callback `build` (peut throw — se propage, comme un callback de
// `.replace()`). Remplace un `.replace(/…\{([^{}]*)\}/g, …)` là où le corps peut légitimement
// porter des accolades dans une chaîne.
function replaceBraceDirective(html: string, marker: string, build: (raw: string) => string): string {
  if (!html.includes(marker)) return html
  let out = ''
  let i = 0
  while (i < html.length) {
    const idx = html.indexOf(marker, i)
    if (idx === -1) { out += html.slice(i); break }
    const before = html[idx - 1]
    if (before !== undefined && /\w/.test(before)) {
      // \B — pas une frontière de mot : @ collé à un identifiant = texte littéral, pas une directive
      out += html.slice(i, idx + 1)
      i = idx + 1
      continue
    }
    out += html.slice(i, idx)
    const { body, end } = extractBraceBody(html, idx + marker.length)
    if (end === -1) { out += html.slice(idx, idx + marker.length); i = idx + marker.length; continue }
    out += build(body)
    i = end + 1
  }
  return out
}

// scanTagClose — depuis une position DÉJÀ DANS une
// balise ouvrante (juste après le nom ou un attribut), avance jusqu'au `>` qui la referme
// VRAIMENT — un `"`/`'` rencontré en chemin ouvre une valeur d'attribut, masque tout `>` qu'elle
// contient jusqu'à son guillemet fermant. Rend -1 si la balise ne se referme jamais. Primitive
// PARTAGÉE : preprocessHtml (masquage des commentaires — un `<!--` DANS une balise n'ouvre jamais
// de commentaire, cf. maskHtmlComments plus bas) et replaceQuotedDirective juste en dessous
// (« même balise » entre deux occurrences d'un marqueur, au lieu du `.includes('>')` trompé par un
// `>` littéral dans la valeur d'un AUTRE attribut).
// Accolades sans fin de `unendedText` (rendues par finExpression) : une balise suivante qui retombe sur l'une d'elles
// sait d'avance qu'elle ne se referme pas, sans relire tout le reste du texte (un gabarit en cours de frappe, aux
// accolades non refermées, coûtait un temps quadratique)
let unendedText = ''
let noEnd       = new Set<number>()

function scanTagClose(html: string, from: number): number {
  // même texte dans une autre chaîne (un masque qui n'y a rien changé) : le relevé reste, et la chaîne retenue devient
  // celle-ci, que les appels suivants reconnaissent sans relire tout le texte (une relecture par balise coûtait un temps
  // quadratique sur des milliers de balises)
  if (html !== unendedText) noEnd = new Set()
  unendedText = html
  let quote: string | null = null
  for (let i = from; i < html.length; i++) {
    const ch = html[i]
    if (quote) { if (ch === quote) quote = null; continue }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    // une expression `{…}` (valeur d'attribut, raccourci) se lit d'un bloc (finExpression) : un guillemet ou un `>` qu'elle
    // contient (`{$s.replace(/"/g, '').length > 0}`) n'ouvre pas de valeur et ne ferme pas la balise ; jamais refermée, lecture d'avant
    if (ch === '{' && !noEnd.has(i)) {
      const end = expressionEnd(html, i, noEnd)
      if (end > 0) { i = end - 1; continue }
    }
    if (ch === '>') return i
  }
  return -1
}

// tagNameBefore — nom de la balise ouvrante la plus proche AVANT `pos` (remonte
// jusqu'au dernier `<`) — sert SEULEMENT à NOMMER la balise dans un message d'erreur de directive
// dupliquée, pas une vraie résolution DOM.
function tagNameBefore(html: string, pos: number): string {
  const lt = html.lastIndexOf('<', pos)
  const m = lt === -1 ? null : /^<\/?([a-zA-Z][a-zA-Z0-9_-]*)/.exec(html.slice(lt))
  return m ? m[1] : '?'
}

// replaceQuotedDirective — même rôle que replaceBraceDirective juste au-dessus, mais pour un
// marqueur SANS accolade (ex. `@confirm=`) immédiatement suivi d'un guillemet `'`/`"` — sinon (ex.
// `@confirm={`, une autre forme) `marker` est laissé INTACT, traité ailleurs. Extraction de la
// valeur via scanQuoted (respecte `\\`, dé-échappe `\'`/`\"`/`\\`) puis délégation au callback
// `build` (peut throw). `onUnterminated` REND l'erreur si le guillemet ne se referme jamais — sinon
// la valeur happerait tout le reste du document (plus de silence possible sur ce cas).
// Deux occurrences DE CE MÊME marqueur sans un `>` entre les deux (donc sur la MÊME
// balise ouvrante) → erreur : seule la 1ʳᵉ survivrait au DOM (attribut HTML dupliqué), la 2ᵉ,
// écrite par le dev, serait silencieusement ignorée.
function replaceQuotedDirective(html: string, marker: string, build: (value: string) => string, onUnterminated: (raw: string) => never): string {
  if (!html.includes(marker)) return html
  let out = ''
  let i = 0
  let lastEnd = -1 // fin du DERNIER remplacement réussi de CE marqueur
  while (i < html.length) {
    const idx = html.indexOf(marker, i)
    if (idx === -1) { out += html.slice(i); break }
    const before = html[idx - 1]
    if (before !== undefined && /\w/.test(before)) {
      // \B — pas une frontière de mot : @ collé à un identifiant = texte littéral, pas une directive
      out += html.slice(i, idx + 1)
      i = idx + 1
      continue
    }
    const qi = idx + marker.length
    if (html[qi] !== "'" && html[qi] !== '"') {
      // pas un guillemet juste après le marqueur (ex. @confirm={) : pas cette forme, on laisse passer
      out += html.slice(i, qi)
      i = qi
      continue
    }
    const scanned = scanQuoted(html, qi)
    if (!scanned) onUnterminated(clampRaw(html.slice(qi)))
    // « même balise » déterminé par scanTagClose (guillemets
    // respectés), pas par `.slice(lastEnd, idx).includes('>')` : un AUTRE attribut de la même balise
    // dont la VALEUR contient `>` (ex. `data-x=">"`) trompait l'ancien test, laissant passer deux
    // occurrences du marqueur sans erreur. `tagClose === -1` (balise jamais refermée) ou APRÈS `idx`
    // ⇒ toujours la même balise ouvrante.
    const tagClose = lastEnd === -1 ? -1 : scanTagClose(html, lastEnd)
    if (lastEnd !== -1 && (tagClose === -1 || tagClose > idx)) {
      throw new Error(t('transpiler.directive-duplicate', { directive: marker.replace(/=$/, ''), tag: tagNameBefore(html, idx) }))
    }
    out += html.slice(i, idx)
    out += build(scanned.content)
    lastEnd = scanned.end + 1
    i = scanned.end + 1
  }
  return out
}

// replaceDoubleBraceDirective — variante de replaceBraceDirective pour la forme `marker{{expr}}`
// DEUX accolades ouvrantes ACCOLÉES (`{{`, sans espace) après
// `marker` (ex. `@title=`) déclenchent cette forme ; un simple `{` (ou `{ {` espacé, cf. bandeau
// plus bas) laisse tout INTACT, traité ailleurs (forme simple). Le corps est cherché par
// extractBraceBody EN CONSOMMANT LES DEUX accolades ouvrantes avant l'appel : sa notion de
// « balance 0 » (calibrée sur UNE seule accolade déjà ouverte) tombe alors sur la PREMIÈRE des
// deux fermantes attendues — la SECONDE est vérifiée juste après, immédiatement adjacente
// (symétrique de l'ouvrante) ; son absence, comme un corps jamais refermé du tout (`end: -1`),
// lève `catalogKey` — jamais un silence, jamais un corps tronqué.
//
// une TROISIÈME accolade ACCOLÉE
// (`{{{`, voire davantage) compilait SANS ERREUR : `extractBraceBody`, appelée juste après les
// deux premières, voit la troisième comme un `{` NESTÉ dans le corps (balance rééquilibrée par
// la PREMIÈRE des N fermantes plutôt que la dernière) — le surplus glisse tel quel dans le corps,
// devient un OBJET LITTÉRAL (`{{ expr }}` → corps `{ expr }`) au lieu de l'expression attendue.
// Au runtime, ce n'est jamais visible à la compilation : `String({…})` affiche "[object Object]"
// dans la bulle. `{{{` n'est ni la forme texte (une accolade) ni la forme HTML (deux exactement)
// — refusé ICI, avant tout appel à extractBraceBody, dès que la 3e accolade est vue : la MÊME
// garde attrape aussi `{{{{` (quatre) et plus, un seul caractère à regarder suffit.
function replaceDoubleBraceDirective(html: string, marker: string, attrName: string, catalogKey: MsgKey, tripleCatalogKey: MsgKey): string {
  const open = marker + '{{'
  if (!html.includes(open)) return html
  let out = ''
  let i = 0
  while (i < html.length) {
    const idx = html.indexOf(open, i)
    if (idx === -1) { out += html.slice(i); break }
    const before = html[idx - 1]
    if (before !== undefined && /\w/.test(before)) {
      // \B — pas une frontière de mot : @ collé à un identifiant = texte littéral, pas une directive
      out += html.slice(i, idx + 1)
      i = idx + 1
      continue
    }
    out += html.slice(i, idx)
    if (html[idx + open.length] === '{') throw new Error(t(tripleCatalogKey, { excerpt: clampRaw(html.slice(idx, idx + 20)) }))
    const { body, end } = extractBraceBody(html, idx + open.length)
    if (end === -1 || html[end + 1] !== '}') throw new Error(t(catalogKey, { raw: clampRaw(body) }))
    out += `${attrName}={${body}}`
    i = end + 2
  }
  return out
}

// ----------------------------------------------------------------------------
// preprocessHtml — transformations HTML pré-parser (port partiel transpiler.rb)
// ----------------------------------------------------------------------------
// maskHtmlComments — remplace la regex
// `/<!--[\s\S]*?-->/g` (ci-dessous, preprocessHtml) par un scanner qui ne reconnaît `<!--` comme
// départ de commentaire QUE HORS BALISE. L'ancienne regex démarrait un commentaire DANS une valeur
// d'attribut (ex. `<div title="<!--">`) et avalait tout jusqu'au PROCHAIN `-->` réel, une directive
// légitime comprise (`<a @confirm="A">` perdue, miscompilée). Ici, DANS une balise (`<nom …>`), on
// saute directement à son vrai `>` (scanTagClose, guillemets respectés) sans jamais y chercher de
// commentaire. Un commentaire jamais refermé n'est PAS masqué (même sort que l'ancienne regex, qui
// ne matchait pas non plus sans `-->`) — le texte continue d'être scanné normalement ensuite.
// Avec `block` (`pre` ou `code`), le passage masque ces blocs à la place des commentaires, qu'il saute
// sans les masquer : un `<pre>` ou un `<code>` cité dans un commentaire n'ouvre rien ; un bloc reste
// cherché partout, valeur d'attribut comprise, et se ferme au premier `</pre>` / `</code>`, comme le
// faisait sa regex ; fins de balise, fermetures et fins de commentaire se cherchent en avançant seulement (blockEnds,
// readHtmlComment) : ce passage lit le texte en temps linéaire, constructions jamais fermées comprises (`<!--` sans fin,
// `<pre x` sans `>`, `<code>` sans `</code>`). Un passage qui n'a rien à lire ne parcourt pas le texte : sans son ouverture
// (`<pre`, `<code`, `<!--`), il le rend tel quel ; sans commentaire, les blocs se lisent d'ouverture en ouverture
// (replaceBlocks, mêmes bornes, chaque `<` y étant comme ici un départ de bloc possible) ; ailleurs, le texte entre deux `<`
// se recopie d'un coup, jamais caractère à caractère
function maskHtmlComments(html: string, mask: (m: string) => string, block: 'pre' | 'code' | null = null): string {
  if (block !== null && !BLOCK_OPENING[block].test(html)) return html
  if (!html.includes('<!--')) return block === null ? html : replaceBlocks(html, [block], mask)
  const blockEnd = block === null ? (_at: number) => -1 : blockEnds(html, block)
  let noClose    = html.length   // à partir d'ici, plus aucun commentaire ne se referme
  let out        = ''
  let i          = 0
  while (i < html.length) {
    const end = blockEnd(i)
    if (end !== -1) {
      out += mask(html.slice(i, end))
      i = end
      continue
    }
    if (html.startsWith('<!--', i)) {
      const comment = i < noClose ? readHtmlComment(html, i) : null
      if (comment === null) { noClose = Math.min(noClose, i); out += html.slice(i, i + 4); i += 4; continue }
      out += block === null ? mask(html.slice(i, comment.end)) : html.slice(i, comment.end)
      i = comment.end
      continue
    }
    if (html[i] === '<' && /[a-zA-Z/]/.test(html[i + 1] ?? '')) {
      const close = scanTagClose(html, i + 1)
      let stop    = close === -1 ? html.length : close + 1
      // un bloc ouvert dans la balise (valeur d'attribut) se masque à son départ
      for (let at = html.indexOf('<', i + 1); at !== -1 && at < stop; at = html.indexOf('<', at + 1)) if (blockEnd(at) !== -1) stop = at
      out += html.slice(i, stop)
      i = stop
      continue
    }
    // texte jusqu'au `<` suivant : rien d'autre n'y ouvre un bloc, un commentaire ni une balise
    const next = html.indexOf('<', i + 1)
    const stop = next === -1 ? html.length : next
    out += html.slice(i, stop)
    i = stop
  }
  return out
}

// ouverture d'un bloc `<pre>` ou `<code>`, cherchée avant tout passage de blocs
const BLOCK_OPENING = { pre: /<pre\b/i, code: /<code\b/i }

// fin du bloc `<pre>` ou `<code>` ouvert à une position (-1 sans bloc), au premier `</pre>` / `</code>` qui suit sa balise
// ouvrante ; fin de balise et fermeture se cherchent en avançant seulement (nextMatch) : une balise sans `>` ou un bloc
// jamais fermé ne relance pas la recherche jusqu'à la fin à chaque ouverture
function blockEnds(html: string, block: 'pre' | 'code'): (at: number) => number {
  const opening = new RegExp(`<${block}\\b`, 'iy')
  const tagEnd  = nextMatch(html, />/g)
  const closing = nextMatch(html, new RegExp(`</${block}>`, 'gi'))
  return (at: number): number => {
    if (html[at] !== '<') return -1
    opening.lastIndex = at
    if (!opening.test(html)) return -1
    const gt    = tagEnd(at + block.length + 1)
    const close = gt === null ? null : closing(gt.index + 1)
    return close === null ? -1 : close.index + block.length + 3
  }
}

// maskAttrQuotes — même principe que maskHtmlComments juste au-dessus (scanTagClose, guillemets
// respectés) : neutralise le CONTENU des valeurs d'attribut de chaque VRAIE balise (délimiteurs
// gardés, longueur inchangée). Sert à la vérification d'isométrie mjs-* juste en dessous — sans
// ça, un texte `</mjs-carte>` posé DANS un attribut (`title="voir </mjs-carte> pour plus"`)
// comptait comme une VRAIE fermeture au même titre qu'un `</mjs-carte>` réel : un composant
// pourtant équilibré se faisait rejeter (message mensonger, « Fermetures » gonflées).
function maskAttrQuotes(html: string): string {
  let out = ''
  let i = 0
  while (i < html.length) {
    if (html[i] === '<' && /[a-zA-Z/]/.test(html[i + 1] ?? '')) {
      const close = scanTagClose(html, i + 1)
      const end = close === -1 ? html.length : close + 1
      out += html.slice(i, end).replace(/"[^"]*"|'[^']*'/g, (m) => m[0] + m.slice(1, -1).replace(/[^\n]/g, ' ') + m[0])
      i = end
      continue
    }
    out += html[i]
    i++
  }
  return out
}

// maskInterpolations — empile chaque bloc `{…}` d'interpolation de TEXTE (jamais une balise
// entière, cf. le branchement scanTagClose ci-dessous) dans codeMasks, AVANT les réécritures de
// directives plus bas : un exemple de doc affiché EN TOUTES LETTRES dans une chaîne de texte —
// `{'…@preload="hover"…'}` — n'est pas un VRAI attribut du balisage. Sans ce masquage, les regex
// `\B@xxx=…` plus bas le réécrivaient quand même (texte affiché corrompu) ou le REFUSAIENT à tort
// (`{'…@callback={foo}…'}`, forme montrée en contre-exemple). Une VRAIE balise est copiée
// VERBATIM (jamais masquée ICI) : la valeur d'une directive à accolades (`@confirm={ text: … }`,
// `@viewTransition.cube={ dir: left }`) est elle-même un `{…}`, mais À L'INTÉRIEUR d'une balise —
// la masquer aurait caché la directive à la regex censée la traiter, pas seulement la prose.
// Fin de l'interpolation lue par finExpression (même aide que maskStaticHtmlText plus haut) : un `}`
// littéral dans une chaîne (`{'a}'}`) ne la referme jamais trop tôt, un guillemet dans une regex
// (`{ $t.replace(/"/g, '') }`) n'ouvre pas une chaîne qui masquerait tout le reste du HTML.
function maskInterpolations(html: string, mask: (m: string) => string): string {
  let out = ''
  let i = 0
  const n = html.length
  while (i < n) {
    // `@` en plus de `[a-zA-Z/]` (contrairement à maskHtmlComments/maskAttrQuotes plus haut) :
    // une balise-macro <@view .../<@include …> porte elle aussi des directives à accolades
    // (`<@view main @viewTransition.cube={ dir: left }>`) — l'exclure aurait masqué CETTE
    // accolade-là comme du texte, cachant la directive à la regex censée la traiter.
    if (html[i] === '<' && /[a-zA-Z/@]/.test(html[i + 1] ?? '')) {
      const close = scanTagClose(html, i + 1)
      const end = close === -1 ? n : close + 1
      out += html.slice(i, end)
      i = end
      continue
    }
    if (html[i] === '{') {
      const end = expressionEnd(html, i)
      const j = end < 0 ? n : end
      out += mask(html.slice(i, j))
      i = j
      continue
    }
    out += html[i]
    i++
  }
  return out
}

function preprocessHtml(html: string, moduleName: string, dialect: boolean): string {
  let out = html

  // Auto-fermeture mjs-* : <mjs-foo /> → <mjs-foo></mjs-foo> (un `>` entre guillemets ou dans une expression ne coupe pas la balise)
  out = closeSelfClosedComponents(out)

  // Vérification d'isométrie (open vs close) — comptée sur une vue où les valeurs d'attribut
  // (maskAttrQuotes) ET les interpolations de TEXTE (maskInterpolations, définie plus bas) sont
  // neutralisées : un texte `</mjs-carte>` DANS un attribut OU cité dans une interpolation
  // (`{'exemple : </mjs-carte> en trop'}`, prose affichée) n'est jamais une vraie fermeture. Une
  // VRAIE balise reste copiée verbatim par maskInterpolations (jamais masquée) : un vrai
  // déséquilibre continue d'être détecté.
  const isoView = maskInterpolations(maskAttrQuotes(out), (m) => m.replace(/[^\n]/g, ' '))
  const tags = new Set<string>()
  isoView.replace(/<(mjs-[a-zA-Z0-9_-]+)[^>]*>/g, (_m, t) => { tags.add(t); return _m })
  for (const tag of tags) {
    const openRe = new RegExp(`<${tag}(?:\\s+[^>]*?)?>`, 'g')
    const closeRe = new RegExp(`</${tag}>`, 'g')
    const opens = (isoView.match(openRe) ?? []).length
    const closes = (isoView.match(closeRe) ?? []).length
    if (opens !== closes) {
      throw new Error(t('transpiler.structural-imbalance', { moduleName, tag, opens, closes }))
    }
  }

  // Directives d'attribut (`@noUJS`, `@preload`) → attributs HTML. On MASQUE
  // d'abord les blocs <pre>/<code> ET les commentaires HTML <!-- --> : un tuto/doc
  // qui AFFICHE `@preload="on"` dans un exemple de code, ou une forme refusée dans un commentaire
  // purement documentaire, ne doit pas faire échouer la compilation du reste.
  // On masque AUSSI les expressions `{…}` (texte ou attribut) : les directives ci-dessous ne
  // sont réécrites QUE dans du vrai balisage, jamais dans une chaîne de code (maskInterpolations,
  // même raison que <pre>/<code>/commentaires juste au-dessus).
  // blocs <pre>, puis <code>, puis commentaires, comme toujours (un `<pre>` ouvert dans un `<code>` l'emporte sur lui), les deux
  // premiers passages sautant les commentaires : un `<pre>` cité dans un commentaire n'ouvre rien ; jetons et remise : createMaskTable
  const codeMasks = createMaskTable(out, 'CM')
  for (const block of ['pre', 'code', null] as const) out = maskHtmlComments(out, codeMasks.stash, block)
  out = maskInterpolations(out, codeMasks.stash)

  // les mots de MJS lus sur le texte (liens, formulaires, navigation) : dans les balises du gabarit seulement (inTags, tagWords) — un
  // `:title=` du texte, un `:disabled` d'une feuille de style ou d'une chaîne n'est jamais un mot
  out = inTags(out, dialect, tagWords)
  return codeMasks.restore(out)
}

// chaque balise ouvrante du gabarit, lue dans son arbre (une balise-macro `<@view …>` comprise), passée à `fn` de son `<` à son
// `>`, le texte entre elles laissé tel quel : une balise écrite dans le texte d'un <textarea> ou d'un <title>, dans une valeur
// d'attribut ou dans un bloc masqué n'est qu'un texte. L'arbre est lu même quand il signale une faute (le parseur refuse
// ensuite le gabarit, avec son message) ; une balise que l'arbre ne referme jamais (sa lecture s'y arrête) est passée à `fn`
// jusqu'à la fin du texte : un mot qui y reste ouvert (la chaîne d'un `:confirm`, les accolades d'un `:title={{…}}`) garde
// son message
function inTags(html: string, dialect: boolean, fn: (tag: string) => string): string {
  const tree = readFile(html, { template: true, dialect })
  const tags: Array<{ start: number, end: number }> = []
  traverse(tree, (n) => {
    if (n.kind === 'tag') tags.push({ start: n.start, end: n.openingEnd })
  })
  tags.sort((a, b) => a.start - b.start)
  const last = tree.diagnostics[tree.diagnostics.length - 1]
  const open = last && html[last.start] === '<' && /[a-zA-Z@]/.test(html[last.start + 1] ?? '') && !tags.some((tag) => tag.start === last.start) ? last.start : -1
  let out = ''
  let pos = 0
  for (const tag of tags) {
    out += html.slice(pos, tag.start) + fn(html.slice(tag.start, tag.end))
    pos  = tag.end
  }
  return open >= pos ? out + html.slice(pos, open) + fn(html.slice(open)) : out + html.slice(pos)
}

// les mots de MJS lus sur le texte d'UNE balise, avant le lecteur (directives d'attribut → attributs HTML) ; une balise sans le signe des
// mots ni `@vt` passe telle quelle
function tagWords(out: string): string {
  if (!out.includes(SIGN) && !out.includes('@vt')) return out
  // :noUJS="valeur" → REFUSÉ, même politique que :permanent juste plus bas : la
  // directive est NUE par nature (elle désactive l'interception pour la balise entière, rien à
  // préciser) — une valeur qui traîne serait un bogue muet (attribut mjs-no-ujs='valeur' posé au
  // lieu du marqueur nu attendu). GARDE testée AVANT la forme nue, même piège de capture que
  // :permanent (sinon `="valeur"` traînerait tel quel après mjs-no-ujs).
  out = out.replace(wordRe('no-?ujs', String.raw`=("[^"]*"|'[^']*'|[^\s/>]*)`, 'gi'), (_m, value) => {
    throw new Error(t('transpiler.no-ujs-value-refused', { value: value }))
  })
  // :noUJS → mjs-no-ujs (casse insensible, tiret optionnel : :noUJS/@noUjs/:noujs/:no-ujs)
  out = out.replace(wordRe('no-?ujs', String.raw`(?=[\s/>]|$)`, 'gi'), 'mjs-no-ujs')

  // :permanent → mjs-permanent, forme NUE seulement, casse
  // insensible (même politique que :no-ujs juste au-dessus). Le runtime (µ._mjs_navTransplantPermanents,
  // mjs_ujs.ts, LECTURE SEULE ici) apparie un élément permanent entre deux navigations PAR SON
  // `id` — jamais par une valeur portée par la directive elle-même : `:permanent="nom"` n'aurait
  // donc RIEN à faire de ce nom, un silence qui laisserait croire à tort à une clé d'appariement.
  // Plutôt qu'ignorer la valeur en silence, ERREUR explicite qui renvoie vers `id` — GARDE testée
  // AVANT la forme nue (sinon la forme nue matcherait le `:permanent` de `:permanent="nom"`
  // en laissant `="nom"` traîner tel quel dans le HTML, même piège que :callback/:flash plus bas).
  out = out.replace(wordRe('permanent', String.raw`=("[^"]*"|'[^']*'|[^\s/>]*)`, 'gi'), (_m, value) => {
    throw new Error(t('transpiler.permanent-value-refused', { value: value }))
  })
  out = out.replace(wordRe('permanent', String.raw`(?=[\s/>]|$)`, 'gi'), 'mjs-permanent')

  // :preload="on" (sur un <a>, niveau 3) → attribut data-mjs-preload lu au runtime.
  // Valeurs : on|hover|off (guillemets simples/doubles ou nus) ; `eager` refusé
  out = out.replace(wordRe('preload', String.raw`=(["']?)eager\1`), () => {
    throw new Error(t('transpiler.preload-eager-renamed', { where: `attribut ${written('preload')} d'un lien` }))
  })
  out = out.replace(wordRe('preload', String.raw`=(["']?)(on|hover|off)\1`), 'data-mjs-preload="$2"')

  // :method="delete" (sur un <a>, UJS) → attribut mjs-method lu au runtime.
  // Verbe LIBRE (pas un vocabulaire fixe comme :preload) : la validation
  // (delete/post/put/patch, verbe inconnu → warning + navigation normale) est
  // DÉLIBÉRÉMENT côté runtime (mjs_ujs.ts) — le compilateur convertit tel quel.
  out = out.replace(wordRe('method', String.raw`=(["']?)([a-zA-Z]+)\1`), 'mjs-method="$2"')

  // :confirm="Vraiment supprimer ?" (sur <a>/<form>/<button>) → attribut
  // mjs-confirm lu au runtime (window.confirm avant toute interception). Message LIBRE : échappé
  // via escapeVtAttrValue (quotes ET accolades — une accolade LITTÉRALE dans le message ferait
  // sinon prendre l'attribut pour une interpolation JS par le pipeline générique d'attributs, même
  // piège que mjs-title/data-mjs-vt, cf. son bandeau plus haut) — même traitement que la forme
  // chaîne de :title juste plus bas. Extraction par replaceQuotedDirective/scanQuoted —
  // PAS une regex `(?:(?!\1)[\s\S])*` : une apostrophe française échappée (`\'`) dans
  // le message coupait l'attribut au milieu (HTML corrompu, silencieux) avant ce correctif ; une
  // chaîne jamais refermée est maintenant une ERREUR de compile explicite, plus un pass-through muet.
  out = replaceQuotedDirective(out, `${written('confirm')}=`, (msg) => `mjs-confirm="${escapeVtAttrValue(msg)}"`, (raw) => {
    throw new Error(t('transpiler.confirm-object-invalid', { raw }))
  })

  // :confirm={ text: '…', ok: '…', cancel: '…' } (forme OBJET) → MÊME attribut mjs-confirm,
  // mais en JSON STRICT (le runtime distingue à la lecture selon que la valeur commence par '{', cf.
  // µ.confirm, mjs_ujs.ts). Littéral STATIQUE SEULEMENT : clés PARMI text/ok/cancel, valeurs chaîne
  // entre guillemets simples OU doubles séparées par des virgules — aucune expression/variable pour
  // CES clés (mini-grammaire fermée, pas du JS évalué, même esprit que parseVtValue). `escapeVtAttrValue`
  // (définie juste au-dessus, PAS spécifique à :viewTransition malgré son nom) : le JSON produit
  // commence PAR `{` — sans échapper aussi les accolades (pas seulement les guillemets), le pipeline
  // générique d'attributs le prendrait pour une INTERPOLATION JS (même piège que data-mjs-vt, cf.
  // son bandeau). La forme chaîne juste au-dessus reste INCHANGÉE. Extraction du corps par
  // extractBraceBody/replaceBraceDirective (ci-dessus) — PAS un simple `[^{}]*` : une accolade
  // LITTÉRALE dans une valeur (`text: 'a{b'`) doit rester DANS la chaîne, pas fermer prématurément
  // l'extraction. Valeur de chaque clé lue via scanQuoted — PAS
  // `(?:'([^']*)'|"([^"]*)")` : une apostrophe échappée (`\'`) dans la valeur arrêtait la
  // capture en plein milieu, rejetant à tort tout l'objet en confirm-objet-invalide.
  //
  // :confirm={maVar}/{a || b}/{f()} (forme EXPRESSION) — MÊME
  // disambiguation que :title={...} juste plus bas (`/^[a-zA-Z_$][\w$]*\s*:/`) : un hash d'options
  // porte toujours au moins une `clé:` en tête ; tout le reste PASSE-PLAT en mjs-confirm={expr},
  // rendu RÉACTIF par le pipeline générique d'attributs (aucune intervention nécessaire ici, même
  // mécanisme que `title={$expr}` natif) — le runtime (µ._mjs_ujsOnClick/OnSubmit, mjs_ujs.ts, LECTURE
  // SEULE ici) relit `getAttribute('mjs-confirm')` à CHAQUE clic : la valeur suit donc la variable
  // d'un clic à l'autre, jamais figée à celle du montage.
  out = replaceBraceDirective(out, `${written('confirm')}={`, (raw) => {
    const trimmed = raw.trim()
    if (!/^[a-zA-Z_$][\w$]*\s*:/.test(trimmed)) return `mjs-confirm={${raw}}`
    const obj: Record<string, string> = {}
    const parts: string[] = []
    let translated = false
    let rest = trimmed
    while (rest.length > 0) {
      const keyM = rest.match(/^(text|ok|cancel)\s*:\s*/)
      const vi = keyM ? keyM[0].length : -1
      const call = keyM ? scanTranslatedCall(rest, vi) : null
      const scanned = keyM && !call && (rest[vi] === "'" || rest[vi] === '"') ? scanQuoted(rest, vi) : null
      if (!keyM || (!scanned && !call)) throw new Error(t('transpiler.confirm-object-invalid', { raw }))
      if (call) {
        translated = true
        parts.push(`${keyM[1]}: ${call.expr}`)
        rest = rest.slice(call.end).replace(/^\s*,?\s*/, '')
        continue
      }
      obj[keyM[1]] = scanned!.content
      parts.push(`${keyM[1]}: ${JSON.stringify(scanned!.content)}`)
      rest = rest.slice(scanned!.end + 1).replace(/^\s*,?\s*/, '')
    }
    // au moins un µt(…) : attribut dynamique qui fabrique le même JSON, refait à chaque changement de langue
    if (translated) return `mjs-confirm={JSON.stringify({ ${parts.join(', ')} })}`
    return `mjs-confirm="${escapeVtAttrValue(JSON.stringify(obj))}"`
  })

  // :callback="nomMethode" (sur <a>/<form>/<button>) → attribut mjs-callback lu au runtime
  // (mjs_ujs.ts, µ._mjs_navRunCallback — SUCCÈS de navigation seulement). GARDE anti-piège : la forme
  // accolades :callback={…} est une ERREUR de compile explicite — sans elle, le repli générique du
  // pipeline d'attributs en ferait un écouteur DOM fantôme sur un événement 'callback' inexistant.
  // Nom validé ICI (identifiant simple [A-Za-z_$][\w$]*) : même message d'erreur pour les deux pièges.
  out = out.replace(wordRe('callback', String.raw`=(\{[^}]*\}?)`), (_m, raw) => {
    throw new Error(t('transpiler.callback-name-expected', { value: raw }))
  })
  out = out.replace(wordRe('callback', String.raw`=(["'])([^"']*)\1`), (_m, _q, name) => {
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) {
      throw new Error(t('transpiler.callback-name-expected', { value: `"${name}"` }))
    }
    return `mjs-callback="${name}"`
  })

  // :flash="popup"/"console"/"silent" (sur <a>/<form>/<button>) → attribut mjs-flash lu au
  // runtime (mjs_ujs.ts, µ._mjs_navFlashPolicy — politique par élément du veilleur flash/error).
  // Vocabulaire FERMÉ (contrairement à :method, verbe libre) : SEULES ces 3 valeurs. GARDE anti-piège
  // (même patron que :callback juste au-dessus) : la forme accolades :flash={…} ET toute valeur hors
  // énumération sont des ERREURS de compile explicites — sans elles, le repli générique du pipeline
  // d'attributs en ferait un écouteur DOM fantôme sur un événement 'flash' inexistant.
  out = out.replace(wordRe('flash', String.raw`=(\{[^}]*\}?)`), (_m, raw) => {
    throw new Error(t('transpiler.flash-value-invalid', { value: raw }))
  })
  out = out.replace(wordRe('flash', String.raw`=(["'])([^"']*)\1`), (_m, _q, val) => {
    if (val !== 'popup' && val !== 'console' && val !== 'silent') {
      throw new Error(t('transpiler.flash-value-invalid', { value: `"${val}"` }))
    }
    return `mjs-flash="${val}"`
  })

  // :title="texte" (sur N'IMPORTE QUELLE balise) → attribut mjs-title lu au runtime
  // (mjs_title.ts, module CŒUR). Comme :confirm : échappé via escapeVtAttrValue (quotes ET
  // accolades — sinon le pipeline générique d'attributs prendrait une accolade littérale du texte
  // pour une interpolation JS, même piège que data-mjs-vt/mjs-confirm objet, cf. bandeau plus haut).
  // Extraction par replaceQuotedDirective/scanQuoted, même correctif et même
  // raison que la forme chaîne de :confirm plus haut (apostrophe échappée `\'`).
  out = replaceQuotedDirective(out, `${written('title')}=`, (msg) => `mjs-title="${escapeVtAttrValue(msg)}"`, (raw) => {
    throw new Error(t('transpiler.title-object-invalid', { raw }))
  })

  // :title={{ expr }} — FORME HTML : DEUX accolades ouvrantes
  // ACCOLÉES juste après `:title=` (SANS espace) → HTML brut, corps = EXPRESSION (jamais un objet
  // d'options, contrairement à la forme simple juste plus bas) — même convention que `{{expr}}`
  // en interpolation de texte (HTML brut) vs `{expr}` (échappé), cf. docs/07-bindings.md. Attribut
  // DISTINCT `mjs-title-html` (jamais `mjs-title`) → passe-plat réactif par le pipeline générique
  // d'attributs, même mécanisme que `mjs-title={expr}` juste plus bas. Un objet littéral en tête
  // reste écrivable dans la forme SIMPLE en glissant un ESPACE entre les deux accolades
  // (`:title={ { text: '…' } }`, cas rare) : cette forme-ci ne matche PAS ici
  // (replaceDoubleBraceDirective exige les deux accolades ACCOLÉES), elle retombe intacte sur
  // replaceBraceDirective juste après. SÉCURITÉ : porte ouverte volontaire, comme `{{expr}}` en
  // interpolation — aucune désinfection ici, ne l'alimente jamais avec une saisie non maîtrisée
  // (cf. mjs_title.ts, volet runtime).
  out = replaceDoubleBraceDirective(out, `${written('title')}=`, 'mjs-title-html', 'transpiler.title-html-not-closed', 'transpiler.title-html-triple-brace')

  // :title={...} — DEUX formes distinguées par leur CONTENU (rien à voir avec :confirm, qui n'a
  // pas de forme expression) :
  //   - objet littéral STATIQUE (une clé RECONNUE en tête, ex. `text: '…'`) → validé strictement
  //     (text obligatoire, delay/dur nombres, side top/bottom, transition fade/slide — clé
  //     inconnue ou valeur non littérale REJETÉES) puis émis en DEUX attributs : mjs-title="<text>"
  //     (texte, relu à chaque apparition côté runtime) + mjs-title-conf="<JSON>" (le reste des
  //     clés, SEULEMENT si au moins une est fournie).
  //   - expression généraliste (pas de `clé:` en tête) → PASSE-PLAT en mjs-title={expr} tel quel :
  //     le pipeline générique d'attributs (parser/generator) le reconnaît tout seul comme
  //     dynamique et le rend RÉACTIF, aucune intervention nécessaire ici (même mécanisme générique
  //     que `title={$expr}` natif, cf. tests/parser.test.ts).
  // Extraction du corps par extractBraceBody/replaceBraceDirective (ci-dessus, même raison que
  // :confirm={...} un peu plus haut) — PAS un simple `[^{}]*`. Valeur de chaque clé CHAÎNE lue via
  // scanQuoted — PAS `(?:'([^']*)'|"([^"]*)")` : une apostrophe/un guillemet
  // échappés (`\'`/`\"`) dans la valeur arrêtait la capture en plein milieu, rejetant à tort
  // tout l'objet en title-objet-invalide (delay/dur restent la seule forme NOMBRE, inchangée).
  out = replaceBraceDirective(out, `${written('title')}={`, (raw) => {
    const trimmed = raw.trim()
    if (!/^[a-zA-Z_$][\w$]*\s*:/.test(trimmed)) return `mjs-title={${raw}}`
    const conf: Record<string, string | number> = {}
    let text: string | undefined
    let textCall: string | undefined
    let rest = trimmed
    while (rest.length > 0) {
      const keyM = rest.match(/^(text|delay|side|dur|transition)\s*:\s*/)
      if (!keyM) throw new Error(t('transpiler.title-object-invalid', { raw }))
      const key = keyM[1]
      const vi = keyM[0].length
      // text: µt(…) : seul appel accepté, et seulement pour cette clé (les réglages restent littéraux)
      const call = key === 'text' ? scanTranslatedCall(rest, vi) : null
      if (call) {
        textCall = call.expr
        rest = rest.slice(call.end).replace(/^\s*,?\s*/, '')
        continue
      }
      let str: string | undefined
      let num: string | undefined
      if (rest[vi] === "'" || rest[vi] === '"') {
        const scanned = scanQuoted(rest, vi)
        if (!scanned) throw new Error(t('transpiler.title-object-invalid', { raw }))
        str = scanned.content
        rest = rest.slice(scanned.end + 1).replace(/^\s*,?\s*/, '')
      } else {
        const numM = rest.slice(vi).match(/^-?\d+(?:\.\d+)?/)
        if (!numM) throw new Error(t('transpiler.title-object-invalid', { raw }))
        num = numM[0]
        rest = rest.slice(vi + numM[0].length).replace(/^\s*,?\s*/, '')
      }
      if (key === 'text') {
        if (str === undefined) throw new Error(t('transpiler.title-object-invalid', { raw }))
        text = str
      } else if (key === 'delay' || key === 'dur') {
        if (num === undefined) throw new Error(t('transpiler.title-object-invalid', { raw }))
        conf[key] = Number(num)
      } else {
        if (str === undefined) throw new Error(t('transpiler.title-object-invalid', { raw }))
        if (key === 'side' && str !== 'top' && str !== 'bottom') throw new Error(t('transpiler.title-object-invalid', { raw }))
        if (key === 'transition' && str !== 'fade' && str !== 'slide') throw new Error(t('transpiler.title-object-invalid', { raw }))
        conf[key] = str
      }
    }
    if (text === undefined && textCall === undefined) throw new Error(t('transpiler.title-object-invalid', { raw }))
    let attrs = textCall !== undefined ? `mjs-title={${textCall}}` : `mjs-title="${escapeVtAttrValue(text!)}"`
    if (Object.keys(conf).length > 0) attrs += ` mjs-title-conf="${escapeVtAttrValue(JSON.stringify(conf))}"`
    return attrs
  })

  // Syntaxe OBJET :viewTransition.<nom>={ direction, duration, priority }
  // (alias @vt RETIRÉ ici — reste capturé à la racine du fichier pour le
  // message, directives.ts, et sur <a :pageTransition="…">, mécanisme UJS
  // distinct plus bas), calquée sur :transition.fly={ y: 200, duration: 2000 } — mini-
  // grammaire TEXTE (parseVtValue, bundler/config.ts), PAS du JS évalué (clés
  // LONGUES ou COURTES — dir/dur/p —, mixables). Sur <@view …> (niveau 3) →
  // attribut data-mjs-vt (chaîne VERBATIM `<nom>` ou `<nom>={...}`, relue au
  // runtime par µ._mjs_vtParse), +data-mjs-vt-p si l'option `priority:`/`p:` est
  // présente (canal séparé EXISTANT, résolution runtime
  // _mjs_vtWinner/_mjs_vtResolveWithPriority INCHANGÉE).
  // Formes rejetées (erreurs de migration) : on/off explicites, le suffixe
  // `:direction` dans le nom, l'ancienne forme VALEUR STATIQUE
  // :viewTransition="nom" (guillemets ou non). La forme NUE — SEULE, sans nom
  // — n'a plus d'effet propre sur une <@view> : elle n'existe plus qu'à la racine d'un module
  // (directives.ts, forme 'on' inchangée là-bas).
  out = out.replace(
    new RegExp(String.raw`(<@view\b[^>]*?)[ \t]+` + SIGN_RE + String.raw`(viewTransition)(\.[a-zA-Z][a-zA-Z0-9:_-]*(?:[ \t]*=[ \t]*\{[^}]*\})?|=(?:"[^"]*"|'[^']*'|[^\s>]*))?(?=[\s/>])`, 'g'),
    (_m, pre, directive, rest) => {
      const label = `${SIGN}${directive}`
      if (rest === undefined) {
        throw new Error(t('transpiler.viewtransition-bare-on-view', { label }))
      }

      if (rest[0] === '.') {
        const dm = rest.match(/^\.([a-zA-Z][a-zA-Z0-9-]*(?::(?:left|right|up|down))?)(?:[ \t]*=[ \t]*\{([^}]*)\})?$/)
        if (!dm) {
          throw new Error(t('transpiler.viewtransition-shape-invalid-on-view', { label, rest }))
        }
        const nameAndDir: string = dm[1]
        const optsRaw: string | undefined = dm[2]
        const base = nameAndDir.split(':')[0]
        if (base === 'off') throw new Error(t('transpiler.vt-off-does-not-exist', { label }))
        if (base === 'on') throw new Error(t('transpiler.vt-on-implicit', { label }))
        // Le suffixe `:direction` n'existe plus, la SEULE façon
        // d'orienter est la clé d'option (`${label}.cube={ dir: left }`).
        if (nameAndDir.includes(':')) {
          throw new Error(t('transpiler.vt-direction-no-longer-in-name', { label, example: `${label}.cube={ dir: left }` }))
        }
        const verbatim = optsRaw !== undefined ? `${nameAndDir}={${optsRaw}}` : nameAndDir
        const parsed = parseVtValue(verbatim)
        // Cast explicite : strictNullChecks:false (tsconfig du projet) désactive le
        // narrowing natif des unions discriminées — cf. le même commentaire dans config.ts.
        if (!parsed.ok) throw new Error(t('transpiler.viewtransition-error-parsing-on-view', { label, nameAndDir, error: (parsed as { ok: false; error: string }).error }))
        // PAS de contrôle de la base — cf. le commentaire jumeau dans sections.ts : la parité avec
        // `<style :viewTransition…>` tient, mais sur la TOLÉRANCE, pas sur le refus.
        const okParsed = parsed as { ok: true; value: { priority: number | null } }
        // Entités HTML sur `{`/`}` (PAS de littéral `{` dans l'attribut généré) :
        // le pipeline générique d'attributs traite TOUTE valeur statique contenant
        // un `{` littéral comme une INTERPOLATION JS (rawVal.includes('{') →
        // interpolation(env), generator/attributes/index.ts) — `turn:right={
        // priority: 3 }` finirait évalué comme un objet JS (`[object Object]`),
        // et `duration: 600ms` casserait carrément la compilation (`600ms` n'est
        // pas un token JS valide). Décodées automatiquement par le navigateur à
        // `getAttribute()` (entités HTML standard) — µ._mjs_vtParse reçoit le VRAI texte.
        let attrs = ` data-mjs-vt="${escapeVtAttrValue(verbatim)}"`
        if (okParsed.value.priority != null) attrs += ` data-mjs-vt-p="${okParsed.value.priority}"`
        return pre + attrs
      }

      // Ancienne forme `=...` (guillemets ou non) — détecte on/off d'abord.
      const em = (rest as string).match(/^=(?:"([^"]*)"|'([^']*)'|([^\s>]*))$/)
      const val = (em ? (em[1] ?? em[2] ?? em[3]) : '') ?? ''
      const nameOnly = val.trim().split(/\s+/)[0] || ''
      if (nameOnly === 'off') throw new Error(t('transpiler.vt-off-does-not-exist', { label }))
      if (nameOnly === 'on') throw new Error(t('transpiler.vt-on-implicit', { label }))
      throw new Error(t('transpiler.viewtransition-old-shape-view', { label, val, nameOnly }))
    },
  )

  // @vt sur <a> N'EXISTE PLUS : renommé :pageTransition, seule orthographe du
  // mécanisme (nom long à part entière, pas un alias) — erreur d'orientation
  // AVANT le remplacement ci-dessous, sur le modèle de
  // transpiler.viewtransition-root-forbidden.
  out = out.replace(/\B@vt=(["']?)([a-zA-Z][a-zA-Z0-9-]*(?::(?:left|right|up|down))?)\1/g, (_m, q: string, val: string) => {
    throw new Error(t('transpiler.vt-renamed-pagetransition', { line: `@vt=${q}${val}${q}`, replacement: `${written('pageTransition')}=${q}${val}${q}` }))
  })

  // :pageTransition="nom|on|off|nom={ direction: …, duration: … }" (sur un <a>, transition de
  // PAGE niveau UJS — même famille que :method/:confirm ci-dessus) → attribut mjs-vt lu au
  // runtime (mjs_ujs.ts, µ._mjs_vtResolvePage). DISTINCT de :viewTransition (niveau <@view>/composant,
  // juste au-dessus) : une page n'a pas de "vue routée". Mécanisme SÉPARÉ — :pageTransition="off"/
  // "on" restent des mots réservés PROPRES à ce mécanisme (µ._mjs_vtResolvePage les lit
  // explicitement), DISTINCT du refus on/off des 4 autres positions (vt-off-nexiste-pas/
  // vt-on-implicite, qui NE s'appliquent PAS ici). L'attribut HTML produit (mjs-vt) NE CHANGE
  // PAS : contrat interne au compilateur/runtime, seule la syntaxe auteur s'élargit.
  //
  // La syntaxe OBJET `nom={ direction: …, duration: … }` (MÊME mini-grammaire que
  // <@view>/<style> ci-dessus, parseVtValue) s'ajoute au nom simple déjà accepté ; le suffixe
  // `:direction` dans le nom devient une erreur, MÊME clé de message que les 4 autres positions
  // (vt-direction-plus-dans-nom) mais un EXEMPLE PROPRE : un
  // lien n'a pas de forme à point (`:pageTransition.cube={...}` n'existe pas), sa vraie forme est
  // une CHAÎNE (`:pageTransition="cube={ dir: left }"`) — reprendre l'exemple à point des 4 autres
  // positions était trompeur. `priority`/`p` REFUSÉ : la cascade d'un lien
  // n'a que 2 niveaux (lien > config, µ._mjs_vtResolvePage) — aucun arbitrage départ/arrivée à
  // départager ici (_mjs_vtWinner/_mjs_vtResolveWithPriority sont réservés au routeur, mjs_router.ts) :
  // l'option serait syntaxiquement acceptée par µ._mjs_vtParse au runtime mais resterait MORTE
  // (jamais lue par _mjs_vtWrapSwap/_mjs_vtApplyPreset/_mjs_vtCurtainRun) — plutôt qu'un piège silencieux,
  // une erreur de build explicite.
  out = out.replace(
    wordRe('pageTransition', String.raw`=(?:"([^"]*)"|'([^']*)'|([a-zA-Z][a-zA-Z0-9-]*(?::(?:left|right|up|down))?))(?=[\s/>])`),
    (_m, dq, sq, bare) => {
      const label = written('pageTransition')
      const val   = dq ?? sq ?? bare ?? ''
      if (val === 'on' || val === 'off') return `mjs-vt="${val}"`
      const fm = val.match(/^([a-zA-Z][a-zA-Z0-9-]*(?::(?:left|right|up|down))?)(?:[ \t]*=[ \t]*\{([^}]*)\})?$/)
      if (!fm) throw new Error(t('transpiler.pagetransition-shape-invalid', { label, val }))
      const nameAndDir: string = fm[1]
      const optsRaw: string | undefined = fm[2]
      if (nameAndDir.includes(':')) throw new Error(t('transpiler.vt-direction-no-longer-in-name', { label, example: `${label}="cube={ dir: left }"` }))
      const verbatim = optsRaw !== undefined ? `${nameAndDir}={${optsRaw}}` : nameAndDir
      const parsed = parseVtValue(verbatim)
      // cast explicite : strictNullChecks:false (tsconfig du projet) désactive le narrowing natif
      // des unions discriminées — même piège que les autres call-sites, cf. leurs commentaires.
      if (!parsed.ok) throw new Error(t('transpiler.pagetransition-error-parsing', { label, value: verbatim, error: (parsed as { ok: false; error: string }).error }))
      const okParsed = parsed as { ok: true; value: { priority: number | null } }
      if (okParsed.value.priority != null) throw new Error(t('transpiler.pagetransition-priority-no-effect', { label, value: verbatim }))
      return `mjs-vt="${escapeVtAttrValue(verbatim)}"`
    },
  )

  // :viewTransition sur une balise ORDINAIRE (pas <@view>, déjà consommé
  // ci-dessus) — grammaire EXHAUSTIVE, 3 formes seulement :
  //   - :viewTransition.<nomMorph> (point, SANS valeur — nomMorph PAS limité à
  //     la bibliothèque de préréglages) → nom de morph STATIQUE, raccourci
  //     compilé vers :style.view-transition-name="<nomMorph>".
  //   - :viewTransition.<nomMorph>={...} (point + options) → ERREUR : les
  //     options (direction/duration/priority) n'ont de sens qu'aux niveaux de
  //     NAVIGATION (config/module/<@view>), pas sur un simple nom de morph.
  //   - :viewTransition="nom" / ='nom' / =nom (ancienne forme VALEUR STATIQUE,
  //     SANS accolade) → ERREUR de migration.
  // L'étiquette CALCULÉE (:viewTransition={expr}) et l'étiquette CONDITIONNELLE
  // (:viewTransition{cond}="nom") sont REFUSÉES : :style.view-transition-name
  // couvre déjà ces deux cas nativement (attribut de style natif), sans
  // grammaire dédiée à entretenir en double.
  out = out.replace(
    wordRe('viewTransition', String.raw`\{([^}]*)\}[ \t]*=(?:"([^"]*)"|'([^']*)'|([^\s/>]*))`),
    (_m, cond, dq, sq, bare) => {
      const val = dq ?? sq ?? bare ?? ''
      throw new Error(t('transpiler.viewtransition-label-conditional-forbidden', { cond, val }))
    },
  )
  out = out.replace(
    wordRe('viewTransition', String.raw`[ \t]*=[ \t]*\{([^}]*)\}`),
    (_m, expr) => {
      throw new Error(t('transpiler.viewtransition-label-computed-forbidden', { expr }))
    },
  )
  out = out.replace(
    wordRe('viewTransition', String.raw`\.([a-zA-Z][a-zA-Z0-9:_-]*)([ \t]*=[ \t]*\{[^}]*\})?(?=[\s/>])`),
    (_m, morphName, opts) => {
      if (opts) {
        throw new Error(t('transpiler.viewtransition-morph-options-forbidden', { morphName }))
      }
      // ⚠ FAMILLE « GARDE MUETTE » — le `:` est capturé EXPRÈS pour pouvoir être
      // refusé. La classe de caractères l'excluait : la regex entière échouait sur
      // `:viewTransition.cube:left`, l'attribut n'était donc ni traduit ni signalé — le même
      // silence qu'on vient de fermer sur `<style>` et `<@view>`. Un nom de morph devient un
      // `view-transition-name` CSS, un custom-ident où le `:` n'a pas cours : le navigateur
      // jetterait la déclaration sans un mot. Même message qu'aux deux niveaux de navigation.
      if (morphName.includes(':')) {
        throw new Error(t('transpiler.vt-direction-no-longer-in-name', { label: written('viewTransition'), example: `${written('viewTransition')}.cube={ dir: left }` }))
      }
      return `${written('style')}.view-transition-name="${morphName}"`
    },
  )
  out = out.replace(
    wordRe('viewTransition', String.raw`[ \t]*=[ \t]*(?:"([^"]*)"|'([^']*)'|([^\s>]*))(?=[\s/>])`),
    (_m, dq, sq, bare) => {
      const val = dq ?? sq ?? bare ?? ''
      throw new Error(t('transpiler.viewtransition-old-shape', { val }))
    },
  )

  return out
}

// ----------------------------------------------------------------------------
// classifyUpdates — sépare struct / transition (V2).
//
// V2 — les autres updates (texte, attributs, liaisons) passent par le dispatch
// direct `effectsByVar` côté template, jamais par un render monolithique : ils
// ne sont pas gardés ici. Seuls struct + trans alimentent `_mjs_renderStruct`.
// ----------------------------------------------------------------------------
function classifyUpdates(updates: string[]): {
  struct: string[]
  trans: string[]
} {
  const struct: string[] = []
  const trans: string[]  = []
  for (const u of updates) {
    // `_mjs_td` = code généré par `@attach` : on l'inclut dans struct pour qu'il soit
    // repassé à chaque re-rendu d'un bloc parent (`{if}`/`{key}`/`{for}`) — un nœud
    // recréé (nouveau ref) reçoit son attache ; une balise déjà attachée sur la même
    // connexion (`_mjs_att`) est sautée, cf. bindingAttach (generator/attributes).
    // `µ._mjs_fx(` (effet `*nom`) : même besoin, même rangement ; le moteur ignore une
    // seconde pose sur le même nœud
    if (/_mjs_updIf|_mjs_updFor|_mjs_updAwait|_mjs_updKey|_updElement|_mjs_td|µ\._mjs_fx\(/.test(u)) struct.push(u)
    else if (/_mjs_intro|_mjs_outro/.test(u)) trans.push(u)
  }
  return { struct, trans }
}

// ----------------------------------------------------------------------------
// i18n — réécriture COMPILE-TIME des clés `µ.t(...)` (sucre `µt` déjà pointé
// par le lexer/generator à ce stade, cf. sigils.ts MU_SHORT_GLOBALS). Deux
// directives (directives.ts) pilotent la réécriture :
//   - @i18n 'section'         → préfixe les clés RELATIVES ('clé' → 'section.clé')
//   - @i18nPlaceholder <mode> → ajoute <mode> en 3e argument LITTÉRAL
// Un chemin ABSOLU (1er caractère `/`) n'est JAMAIS préfixé, section ou pas.
// 1er argument GABARIT (backtick, clé CALCULÉE) : jamais préfixé par la
// section (chemin absolu de fait) mais un `/` de tête est RETIRÉ, comme pour un littéral.
// 1er argument VARIABLE (identifiant, concat…) : appel laissé intact — seule une clé écrite EN
// DUR ou un gabarit peuvent être réécrits ici. Dans tous les cas, les arguments SUIVANTS (vars,
// etc.) sont rescannés RÉCURSIVEMENT par cette même fonction : un `µ.t(...)` niché y est
// préfixé/dépouillé/doté de son mode exactement comme un appel racine.
// ----------------------------------------------------------------------------

// Reconnaît un littéral '...'/"..." SIMPLE (pas de guillemet non échappé au
// milieu, donc pas de concat `'a' + 'b'`) — renvoie le quote utilisé + le
// contenu BRUT (guillemets exclus, échappements laissés tels quels).
function parseStringLiteralArg(raw: string): { quote: string; content: string } | null {
  const s = raw.trim()
  if (s.length < 2) return null
  const quote = s[0]
  if ((quote !== '"' && quote !== "'") || s[s.length - 1] !== quote) return null
  let i = 1
  while (i < s.length - 1) {
    if (s[i] === '\\') { i += 2; continue }
    if (s[i] === quote) return null
    i++
  }
  return { quote, content: s.slice(1, -1) }
}

// avance au-delà d'un gabarit (backtick) COMPLET à partir de `s[i] === '\`'`,
// interpolation(s) `${…}` comprises — y compris un backtick RÉ-imbriqué dans une interpolation
// (`${`inner`}`), à n'importe quelle profondeur (appel récursif sur lui-même). Guillemets
// simples/doubles internes à l'interpolation sautés (avec échappements) ; une virgule ou une
// parenthèse n'y a aucun effet particulier. Rend l'index JUSTE APRÈS le backtick fermant.
// Jamais refermé (gabarit invalide) : rend `-1`, NON PLUS `s.length` — les
// deux cas (« fermé au tout dernier caractère » et « jamais refermé ») étaient confondus sous la
// même valeur, `parseTemplateLiteralArg('\`/x')` rendait à tort `{ content: '/' }` au lieu de `null`.
// L'appel récursif interne (backtick ré-imbriqué jamais refermé) retombe sur `s.length` pour
// continuer à consommer jusqu'à la fin (comportement inchangé) ; pareil chez les appelants
// (parseTemplateLiteralArg → null automatiquement, `-1` n'égalant jamais `s.length` ;
// splitTopLevelArgs → adapté pour retomber sur `.length`).
export function skipTemplateLiteral(s: string, i: number): number {
  i++
  while (i < s.length) {
    if (s[i] === '\\') { i += 2; continue }
    if (s[i] === '`') return i + 1
    if (s[i] === '$' && s[i + 1] === '{') {
      i += 2
      let depth = 1
      while (i < s.length && depth > 0) {
        const c = s[i]
        if (c === '"' || c === "'") {
          i = skipQuotedSpan(s, i)
          continue
        }
        if (c === '`') {
          const end = skipTemplateLiteral(s, i)
          i = end === -1 ? s.length : end
          continue
        }
        if (c === '{') depth++
        else if (c === '}') depth--
        i++
      }
      continue
    }
    i++
  }
  return -1
}

// reconnaît un gabarit (backtick) en 1er argument d'un µ.t(...) : clé
// CALCULÉE ('`section.${x}`'), jamais préfixée par la section (chemin absolu de fait) mais un
// `/` de tête doit pouvoir être détecté puis retiré par l'appelant. Délègue
// à skipTemplateLiteral (au lieu d'un simple scan « 1er backtick non échappé ») : une
// interpolation `${…}` qui contient elle-même un gabarit (backtick imbriqué) est désormais
// reconnue comme gabarit ENTIER, pas invalidée au 1er backtick rencontré.
// Jamais refermé : skipTemplateLiteral rend `-1`, jamais égal à `s.length`
// (avant, `s.length` valait pour les deux cas, un gabarit non refermé était pris pour un gabarit
// ENTIER, `parseTemplateLiteralArg('\`/x')` rendait `{ content: '/' }` au lieu de `null`).
export function parseTemplateLiteralArg(raw: string): { content: string } | null {
  const s = raw.trim()
  if (s.length < 2) return null
  if (s[0] !== '`') return null
  const end = skipTemplateLiteral(s, 0)
  if (end !== s.length) return null
  return { content: s.slice(1, -1) }
}

// Découpe les arguments de plus haut niveau d'un appel (respecte chaînes et
// parenthèses/accolades/crochets imbriqués — même patron que les walkers
// d'interpolation du generator, cf. generator/utils.ts mapCodeSegments).
// Branche backtick à part, déléguée à skipTemplateLiteral : un gabarit
// dont l'interpolation contient elle-même un backtick (`${`inner`}`) est avalé ENTIER, ne
// coupe plus faussement les arguments suivants (l'ancien scan « jusqu'au prochain backtick »
// s'arrêtait au backtick imbriqué).
function splitTopLevelArgs(raw: string): string[] {
  const args: string[] = []
  let depth = 0
  let cur = ''
  let i = 0
  while (i < raw.length) {
    const ch = raw[i]
    if (ch === '`') {
      // `-1` (jamais refermé) : consomme jusqu'à la fin, comme avant.
      const end = skipTemplateLiteral(raw, i)
      const j = end === -1 ? raw.length : end
      cur += raw.slice(i, j)
      i = j
      continue
    }
    if (ch === '"' || ch === "'") {
      const end = skipQuotedSpan(raw, i)
      cur += raw.slice(i, end)
      i = end
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') depth--
    if (ch === ',' && depth === 0) { args.push(cur); cur = ''; i++; continue }
    cur += ch
    i++
  }
  if (cur.trim() !== '' || args.length > 0) args.push(cur)
  return args
}

// Scan caractère par caractère des appels de la traduction (MU_T_CALL_RE, sigils.ts : `µ.t(` et ses formes optionnelles, même réécriture,
// forme écrite gardée), balance-aware (chaînes + parenthèses
// imbriquées) — trouve la parenthèse fermante RÉELLE de chaque appel, jamais
// un `)` interne à un objet `vars` ou une chaîne.
function applyI18nPrefixing(code: string, section: string | null, mode: string | null, more: readonly string[] = [], seen?: I18nKeySeen[]): string {
  if (!MU_T_CALL_RE.test(code)) return code
  // le marqueur était cherché par `indexOf` sur
  //    `code` BRUT : une chaîne JS qui MENTIONNE `µ.t('clé')` (texte d'aide, log) était prise
  //    pour un vrai appel et voyait sa « clé » préfixée par la section, à l'intérieur même de
  //    la chaîne. Copie masquée longueur-identique (même régime que lintEffectTopLevel) —
  //    chaînes/commentaires réduits à des blancs qui PRÉSERVENT les `\n` — utilisée UNIQUEMENT
  //    pour TROUVER l'index d'un `µ.t(` réel (un marqueur à l'intérieur d'une chaîne masquée
  //    n'y est plus littéralement présent) ; le scan des parenthèses/arguments qui suit reste
  //    sur `code` ORIGINAL, inchangé — l'argument du VRAI appel est lui-même une chaîne, donc
  //    masqué dans la copie, mais jamais dans `code`.
  // vue du code à longueur égale (maskNonCode, src/mask.ts) : chaînes, commentaires, expressions régulières et texte figé des gabarits
  //    littéraux blanchis d'une seule lecture, le code de leurs `${…}` laissé lisible — seul moyen d'y retrouver un vrai `µ.t(`. Deux
  //    passes séparées (guillemets et commentaires, puis gabarits) lisaient le `//` d'une adresse écrite dans un gabarit littéral
  //    (`\`https://…/${$.id}\``) comme un commentaire : la fin de la ligne était masquée, son accent grave fermant aussi, et les
  //    `µ.t(` qui suivaient n'étaient plus préfixés par la section
  const masked = maskNonCode(code, 'js')
  // appels cherchés sur la copie masquée, garde (`fooµ.t(`) vérifiée sur le code lui-même
  const calls = new RegExp(MU_T_CALL_BODY, 'g')
  const guard = new RegExp(MU_T_CALL_RE.source, 'uy')
  let out = ''
  let i = 0
  while (i < code.length) {
    calls.lastIndex = i
    const found     = calls.exec(masked)
    if (!found) { out += code.slice(i); break }
    const idx = found.index
    guard.lastIndex = idx
    if (!guard.test(code)) { out += code.slice(i, idx + 1); i = idx + 1; continue }
    const marker = code.slice(idx, idx + found[0].length)
    out += code.slice(i, idx)
    let depth = 1
    let j = idx + marker.length
    while (j < code.length && depth > 0) {
      const ch = code[j]
      if (ch === '"' || ch === "'") {
        j = skipQuotedSpan(code, j)
        continue
      }
      if (ch === '`') {
        // délègue à skipTemplateLiteral : l'ancien scan « jusqu'au prochain
        // backtick » sortait au milieu du gabarit sur un backtick LITTÉRAL interne à une chaîne
        // de l'interpolation (ex. `µt(\`/x.${ "a\`b" }\`, { n: 1 })`) — parenthèse fermante
        // surnuméraire ensuite, code généré invalide. Jamais refermé (-1, cas déjà intercepté en
        // amont par la garde CHAÎNE NON FERMÉE) : consomme jusqu'à la fin, comme les autres usages.
        const end = skipTemplateLiteral(code, j)
        j = end === -1 ? code.length : end
        continue
      }
      if (ch === '(') depth++
      else if (ch === ')') { depth--; if (depth === 0) break }
      j++
    }
    const argsRaw = code.slice(idx + marker.length, j)
    const args = splitTopLevelArgs(argsRaw)
    const lit = parseStringLiteralArg(args[0] ?? '')
    if (!lit) {
      // clé CALCULÉE (gabarit) : jamais préfixée, mais un `/` de tête est
      // retiré comme pour un littéral. Clé VARIABLE (ni littéral ni gabarit) : 1er argument
      // laissé tel quel. Dans les deux cas, les arguments suivants sont rescannés (µ.t niché).
      const tpl = parseTemplateLiteralArg(args[0] ?? '')
      const first = (tpl && tpl.content.startsWith('/')) ? '`' + tpl.content.slice(1) + '`' : (args[0] ?? '').trim()
      const rest  = args.slice(1).map(a => applyI18nPrefixing(a.trim(), section, mode, more, seen))
      out += marker + [first, ...rest].join(', ') + ')'
    }
    else {
      const isAbsolute = lit.content.startsWith('/')
      const key = isAbsolute ? lit.content.slice(1) : (section ? `${section}.${lit.content}` : lit.content)
      const rest = args.slice(1).map(a => applyI18nPrefixing(a.trim(), section, mode, more, seen))
      // la clé telle que le dictionnaire la porte (échappements retirés), et ses autres sections (cf. plus bas)
      if (seen) {
        const raw = (k: string) => k.replace(/\\(.)/g, '$1')
        seen.push({ key: raw(key), ...(section && !isAbsolute && more.length > 0 ? { alts: more.map(s => raw(`${s}.${lit.content}`)) } : {}), written: lit.content })
      }
      let newArgs = [`${lit.quote}${key}${lit.quote}`]
      if (mode) {
        newArgs.push(rest[0] ?? 'undefined')
        newArgs.push(`'${mode}'`)
      }
      else {
        newArgs = newArgs.concat(rest)
      }
      // sections en plus du module : la clé relative se cherche aussi chez elles, dans l'ordre écrit (4e argument de µ.t)
      if (section && !isAbsolute && more.length > 0) {
        newArgs = newArgs.slice(0, 3)
        while (newArgs.length < 3) newArgs.push('undefined')
        newArgs.push(`[${more.map(s => `${lit.quote}${s}.${lit.content}${lit.quote}`).join(', ')}]`)
      }
      out += marker + newArgs.join(', ') + ')'
    }
    i = j + 1
  }
  return out
}

// ----------------------------------------------------------------------------
// buildClassName — Mjs + module.split('-').capitalize.join
// ----------------------------------------------------------------------------
function buildClassName(moduleName: string): string {
  const cleaned = moduleName.replace(/[^a-zA-Z0-9]/g, '-')
  const parts = cleaned.split('-').filter(s => s.length > 0)
  return 'Mjs' + parts.map(p => p[0].toUpperCase() + p.slice(1)).join('')
}

// ----------------------------------------------------------------------------
// cssTrapWarnings — pièges Shadow DOM dans le CSS COMPILÉ d'un composant.
// Le CSS compilé part en `adoptedStyleSheets` du SHADOW ROOT au runtime (cf.
// runtime/mjs_element.ts) : une feuille CONSTRUITE (`new CSSStyleSheet()` +
// `replaceSync`). Un `@font-face` là-dedans n'enregistre JAMAIS la police
// (limite navigateur, aucune erreur ni au build ni au runtime) ; un `@import`
// y est carrément IGNORÉ (interdit dans les feuilles construites). Piège
// 100% silencieux sans ce scan. Warnings NON-FATALS (le build continue) —
// l'idiome correct : <@head><style>@font-face { … src: url(µasset('…')) }
// </style></@head> (injecté dans document.head, hors Shadow DOM).
// ----------------------------------------------------------------------------
export function cssTrapWarnings(css: string, lint?: LintToggles): string[] {
  const warnings: string[] = []
  if (/@font-face\b/.test(css)) {
    const w = typedLine('cssTrap', t('transpiler.css-trap-fontface'), lint)
    if (w !== null) warnings.push(w)
  }
  // Les @import SASS sont résolus À LA COMPILATION (jamais présents dans le
  // CSS compilé) — un @import qui survit ici est forcément du CSS pur
  // explicite, aucun faux positif possible.
  if (/@import\b/.test(css)) {
    const w = typedLine('cssTrap', t('transpiler.css-trap-import'), lint)
    if (w !== null) warnings.push(w)
  }
  return warnings
}

// réglage `proxy: false` : la ligne d'instance des autres noms d'une variable (cf. stateAliases), vide quand aucune n'en a
function aliasLineOf(alias: Record<string, string[]>): string {
  return Object.keys(alias).length > 0 ? `\n    this._mjs_otherNames = ${JSON.stringify(alias)};` : ''
}

// ----------------------------------------------------------------------------
// serializeComputedDeps — closure transitive des computeds pour `_mjs_computedDeps`.
// Entrées non vides seulement — un computed
// sans dépendance n'apporte rien à µ.effect côté runtime.
// ----------------------------------------------------------------------------
function serializeComputedDeps(analyzer: Analyzer | null | undefined): string {
  if (!analyzer) return '{}'
  const parts: string[] = []
  for (const [k, deps] of Object.entries(analyzer.computedDeps)) {
    if (deps.length > 0) parts.push(`${JSON.stringify(k)}: ${JSON.stringify(deps)}`)
  }
  return parts.length > 0 ? `{ ${parts.join(', ')} }` : '{}'
}

// les valeurs des attributs des balises, hors accolades : `<p title="$layout">`, `class='a $x'`, `title=$layout`
// lisent une variable sans accolades ; le texte entre les balises, lui, n'en lit aucune. La fin d'une balise
// se lit comme ailleurs : guillemets reconnus, accolades comptées
function attributeValues(html: string): string {
  const values: string[] = []
  const re = /<[A-Za-z@][^\s>\/]*/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    let i = m.index + m[0].length
    let depth = 0
    let quote = ''
    let from = -1
    for (; i < html.length; i++) {
      const c = html[i]
      if (quote) {
        if (c === quote) { values.push(html.slice(from, i)); quote = '' }
      }
      else if (depth > 0) {
        if (c === '{') depth++
        else if (c === '}') depth--
      }
      else if (c === '{') depth++
      else if (c === '>') break
      else if (c === '=') {
        let j = i + 1
        while (j < html.length && /\s/.test(html[j])) j++
        if (html[j] === '"' || html[j] === "'") { quote = html[j]; from = j + 1; i = j }
        else if (html[j] !== '{') {
          const raw = /^[^\s>"'{]+/.exec(html.slice(j))
          if (raw) { values.push(raw[0]); i = j + raw[0].length - 1 }
        }
      }
    }
    re.lastIndex = i
  }
  return values.join('\n')
}

// le code du HTML d'un composant : le contenu de ses accolades (interpolations, blocs, valeurs
// d'attributs, gestionnaires), sans le texte autour — `<p>La rune µlayout…</p>` ne lit rien. Une
// accolade jamais refermée n'est pas lue (le parseur la signale plus loin, à sa ligne) : la lecture
// reprend juste après elle
function templateCode(html: string): string {
  const braces = readBraces(html)
  const parts: string[] = []
  let at = html.indexOf('{')
  while (at !== -1) {
    const read = braces.get(at)
    let next   = at + 1
    if (read) {
      parts.push(read.body)
      next = read.end
    }
    // sinon accolade seule : rien à lire, cf. plus haut
    at = html.indexOf('{', next)
  }
  return parts.join('\n')
}

// le même HTML, les chaînes et commentaires du code des accolades blanchis (même longueur, lignes gardées) : un nom
// écrit dans un texte (`@log('alert')`) n'est pas une citation de ce nom. Une accolade jamais refermée est laissée telle quelle
function blankBraceStrings(html: string, lang: string): string {
  const braces = readBraces(html)
  let out      = ''
  let from     = 0
  let at       = html.indexOf('{')
  while (at !== -1) {
    const read = braces.get(at)
    let next   = at + 1
    if (read) {
      out += html.slice(from, at + 1) + maskNonCode(html.slice(at + 1, read.end - 1), lang)
      from = read.end - 1
      next = read.end
    }
    // sinon accolade seule : rien à blanchir
    at = html.indexOf('{', next)
  }
  return out + html.slice(from)
}

// les noms de modèles que le script compare à µlayout, lus sur l'AST du JS compilé (µlayout y est
// devenu `$.layout || 'default'`, quel que soit le langage) : `=== 'x'` (et `==`, `!==`, `!=`),
// `switch µlayout` et ses `case`, `['x', 'y'].includes(µlayout)` (ou `.indexOf`) — un commentaire
// ou une chaîne qui les cite ne compte pas
function layoutNamesInScript(ast: acorn.Node | null): string[] {
  const names: string[] = []
  if (!ast) return names
  const isLayout = (n: any): boolean => n?.type === 'LogicalExpression' && n.operator === '||' && n.left?.type === 'MemberExpression' && !n.left.computed && n.left.object?.type === 'Identifier' && n.left.object.name === '$' && n.left.property?.name === 'layout' && n.right?.type === 'Literal' && n.right.value === 'default'
  const text     = (n: any): string | null => n?.type === 'Literal' && typeof n.value === 'string' ? n.value : null
  const add      = (n: any): void => { const s = text(n); if (s !== null) names.push(s) }
  walk.simple(ast, {
    BinaryExpression(n: any) {
      if (!['===', '==', '!==', '!='].includes(n.operator)) return
      if (isLayout(n.left)) add(n.right)
      else if (isLayout(n.right)) add(n.left)
    },
    SwitchStatement(n: any) {
      if (isLayout(n.discriminant)) for (const c of n.cases) add(c.test)
    },
    CallExpression(n: any) {
      const callee = n.callee
      if (callee?.type === 'MemberExpression' && !callee.computed && ['includes', 'indexOf'].includes(callee.property?.name) && callee.object?.type === 'ArrayExpression' && isLayout(n.arguments[0])) for (const e of callee.object.elements) add(e)
    },
  })
  return names
}

// wrapModuleError — préfixe `err.message` du nom du module (build
// multi-fichiers : savoir LEQUEL des composants a échoué), SAUF s'il y figure déjà (~25 erreurs de
// preprocessHtml le portent déjà via `moduleName` en interpolation, cf. desequilibre-structurel ;
// ne jamais préfixer deux fois) ou si `moduleName` est inconnu (`transpile()`/`transpileFile()`
// appelés sans l'option — message inchangé, aucune régression pour un appelant qui l'ignore).
// `cause` conserve l'erreur/la stack d'origine (même idiome que mjs-ws/transport-ws.ts).
// L'ancien `!message.includes(moduleName)` sautait le
// préfixe dès qu'une LETTRE de moduleName se retrouvait par hasard dans le message (ex.
// moduleName='a', présent dans n'importe quel mot français) : faux négatif, jamais préfixé.
// Restreint à une mention DÉJÀ QUOTÉE (`'` immédiatement suivi de moduleName) — motif qui couvre
// À LA FOIS le préfixe que CETTE fonction pose elle-même (`'${moduleName}' : …`, relu si
// transpile() puis transpileFile() l'appellent tous les deux) ET les messages qui citent déjà le
// fichier entre quotes sans repasser par ici (ex. transpiler.page-marker-missing :
// `'${moduleName}.mjs' utilise…`) — sans exiger de guillemet fermant immédiat, absent de cette
// 2e forme.
function wrapModuleError(err: unknown, moduleName: string | undefined): never {
  const original = err instanceof Error ? err : new Error(String(err))
  if (moduleName && !original.message.includes(`'${moduleName}`)) {
    throw new Error(t('transpiler.error-in-module', { moduleName, message: original.message }), { cause: original })
  }
  throw original
}

// ----------------------------------------------------------------------------
// transpileImpl — transpilation complète depuis content brut .mjs (corps réel, jamais appelé
// directement hors de ce fichier — cf. `transpile()` plus bas, l'enveloppe publique qui préfixe
// les erreurs du nom de module).
// ----------------------------------------------------------------------------
// mots du langage et fonctions du navigateur qu'une fléchée à paramètre nu (`nom => …`) peut suivre sans piège (cf. transpileImpl)
const WORDS_BEFORE_ARROW = new Set(['async', 'await', 'return', 'yield', 'then', 'else', 'do', 'and', 'or', 'not', 'is', 'isnt', 'in', 'of', 'new', 'typeof', 'void', 'delete', 'throw', 'case', 'when', 'unless', 'if', 'loop', 'until', 'while'])
const BROWSER_FUNCTIONS  = new Set(['requestAnimationFrame', 'requestIdleCallback', 'alert', 'confirm', 'prompt', 'matchMedia', 'getComputedStyle', 'open', 'print', 'scrollTo', 'scrollBy', 'postMessage', 'addEventListener', 'removeEventListener', 'dispatchEvent'])

async function transpileImpl(
  source: string,
  opts: TranspileOpts = {}
): Promise<{ data: TranspileData; output: string; sourceMap?: string }> {
  const moduleName = opts.moduleName ?? 'inline'
  // le fichier tel qu'écrit : les contrôles de construction y retrouvent la ligne d'une clé µt
  const writtenSource = source
  // où une faute relit son texte écrit (cf. WhereWritten) : ses lignes découpées sur le seul chemin d'une faute, marque d'ordre et
  // `\r\n` retirés comme plus bas, avant les alias et la réécriture de `µ$$X`
  let writtenLines: string[] | null = null
  const whereWritten: WhereWritten = { file: opts.sourceFileName ?? `${moduleName}.mjs`, lines: () => (writtenLines ??= writtenSource.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')), baseDir: opts.baseDir ?? '' }
  // calculé UNE fois, en tête — transmis tel quel aux adapters de langage et aux modules
  // profonds (analyzer/parser/generator) qui tournent dans CE même appel, jamais recalculé.
  const colorsEnabled = opts.colorsEnabled ?? false
  // dirInject : préfixe URL public des assets. Le bundler passe explicitement
  // `${urlPrefix}/`. Pour usage standalone (sans bundler), default à `/modularjs/`.
  const dirInject = opts.dirInject ?? '/modularjs/'
  // le gabarit se lit en Civet : l'ancienne grammaire « js », passée par programme, est refusée comme dans mjs.config.json
  if ((opts.templateLang as string | undefined) === 'js') throw new Error(t('bundler.config.template-js-removed', { key: '[ModularJS] templateLang' }))

  // fins de ligne normalisées à
  //    l'entrée, AVANT tout le reste : le sucre mono-ligne (`k = (a, b) ->`) ne s'appliquait
  //    plus du tout sur un fichier CRLF, et toute la suite du pipeline est bâtie sur
  //    des regex `^`/`$`/`\n` (moduleVars, extractSections, lints…) qui tiennent pour acquis
  //    UNE fin de ligne LF. CR seul (vieux Mac) traité pareil. La sortie est en LF pour tous.
  //    La marque BOM d'un fichier UTF-8 retirée au même endroit : laissée en tête, elle cachait la directive de la
  //    première ligne (`@i18n 'sec'` ignoré en silence)
  source = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')

  // -1. Alias ASCII sigil/contexte — DOIT tourner AVANT le lint singleton et
  //    extractDirectives : sinon `@import mjs$$X` (sigil ASCII) ou
  //    `@import __shared.X` (alias contexte) ne sont jamais reconnus, leur
  //    forme canonique (`µ$$X`/`§§X`) n'existant pas encore à ce stade. Un
  //    `@import __shared.X` devient ainsi `@import §§X`, qui claque en erreur
  //    de migration juste en dessous — VOULU : l'alias ASCII du singleton
  //    importé est `mjs$$`, `__shared` reste réservé au contexte. Idempotent :
  //    les mêmes passes retournent plus bas (script.raw/moduleSection.raw/html)
  //    pour couvrir aussi le texte injecté ENSUITE par <@include>/macros (pas
  //    encore inliné ici).
  source = sigilAliasOutsideVars(source, opts.sigil, opts.defaultScriptLang ?? 'civet')
  source = normalizeContextAlias(source, opts.contextAlias)

  // 0. Lint singleton : `@import µ$$X` est la SEULE forme d'import — toute
  //    ancienne écriture `@import §§X` → erreur de migration ; toute
  //    consommation `$X`/`$$X`/`§§X` (au lieu de `µ$$X`) dans le source du dev
  //    → erreur claire. Retourne les noms importés (`singletonImports`),
  //    réutilisés juste en dessous par la pré-passe 0-bis (µ$$X → $X). Chaque
  //    bloc <script> se lit dans son langage : `#{…}` n'interpole pas en JS/TS.
  const singletonImports = lintSingletonConsume(source, opts.defaultScriptLang ?? 'civet')

  // 0-avant-bis. Lint @import $X (dollar simple, sans µ$) — un nom importé ne porte jamais `$`
  //    seul, un singleton s'importe et se consomme UNIQUEMENT par `µ$$X` (docs/14-stores.md).
  //    ICI, AVANT la pré-passe 0-bis juste en dessous (µ$$X → $X) : sur le source ENCORE
  //    ORIGINAL, un `µ$$counter` reste distinguable d'un `$counter` tapé à la main.
  lintImportDollarName(source)

  // 0-bis. Sigil store `µ$$X` : alias lexical de `µ$X` (déclaration) / `$X` (lecture).
  //    Appliqué AVANT toute autre passe pour que les bindings template
  //    `{µ$$count.value}` et le script soient tous reconnus.
  //    - `export µ$$X = expr` → `export µ$X = expr` (route vers le sucre store
  //      universel existant qui crée le proxy via `µ.state(expr)`).
  //    - Toute autre occurrence `µ$$X` (lignes `@import` comprises, gère
  //      `default µ$$x`/listes `a, µ$$b` — même passe, un nom importé y est
  //      TOUJOURS dans `singletonImports` par construction) : SI `X` a été
  //      importé (`singletonImports`, cf. ci-dessus) → `$X` (câblage
  //      identique à l'ancien `§§` importé, retombe sur le pipeline @import
  //      existant, regex directives.ts, ajout à externalReactives) ; SINON →
  //      erreur `singleton-sans-import` (ferme le trou « µ$$Inconnu glisse en
  //      $Inconnu en silence » : avant, la réécriture était inconditionnelle).
  //
  //    NB : dans `String.replace`, `$$` est échappé en `$` littéral, `$N` est
  //    la capture group. Pour produire `$<capture>` on écrit `$$$N`.
  //    Les blocs de doc (`<pre>`/`<code>`/commentaires) sont masqués : un tuto
  //    qui AFFICHE `µ$$X` ne doit pas être réécrit comme du code exécuté.
  //    `maskDocBlocks`
  //    seul ne couvrait NI les chaînes/commentaires JS du <script> (une chaîne/
  //    un commentaire qui MENTIONNE `µ$$X` en exemple était réécrit en silence
  //    ou faisait throw `singleton-sans-import` à tort, faute d'usage réel) NI
  //    le texte HTML statique hors `{…}` (même throw intempestif — PARITÉ avec
  //    l'ancien mécanisme §§ : le générateur n'exécute jamais de sigil sur le
  //    texte d'un nœud, `case 'text'` de generator/compile.ts, vérifié sur
  //    pièce). Composition de 3 masques réversibles, du plus large au plus
  //    fin : blocs de doc → texte HTML statique (hors <script>/@import/{…}) →
  //    chaînes/commentaires JS (partout, y compris dans un `{…}` live) ; la
  //    réécriture n'opère plus que sur ce qui reste EXPOSÉ ; restauration dans
  //    l'ordre inverse, texte masqué RENDU À L'IDENTIQUE (µ$$X littéral compris).
  {
    const { masked: noDoc, restore: restoreDoc } = maskDocBlocks(source)
    const { masked: withoutStaticHtml, restore: restoreStaticHtml } = maskStaticHtmlText(noDoc)
    const { masked: withoutStringsAndComments, restore: restoreStringsAndComments } = maskStringsAndComments(withoutStaticHtml)
    const rewritten = withoutStringsAndComments
      .replace(/^([ \t]*)export[ \t]+µ\$\$([a-zA-Z0-9_]+)([ \t]*=)/gm, '$1export µ$$$2$3')
      .replace(/µ\$\$([a-zA-Z0-9_]+)/g, (_m: string, name: string) => {
        if (singletonImports.has(name)) return '$' + name
        throw new Error(t('transpiler.singleton-no-import', { name: name }))
      })
    source = restoreDoc(restoreStaticHtml(restoreStringsAndComments(rewritten)))
  }

  // 1. Directives + nettoyage
  const dir = extractDirectives(source)
  const content = dir.cleaned
  // classes globales citées (`µNom`, `µ.Nom`, gabarit compris) : un import statique de chacune, en tête du module, comme un `@import`
  for (const name of classesCitedBy(source, opts.classes ?? {})) {
    dir.pendingAutoImports.push(classImport(opts.classes![name]))
    dir.importDirectives.push({ line: 1, text: `µ${name}` })
  }

  // 2. Sections
  const sections = extractSections(content, {
    defaultScriptLang: opts.defaultScriptLang ?? 'civet',
  })
  const { module: moduleSection, script, style, layouts, routes: routesSections } = sections
  let html = sections.html
  // le script tel qu'écrit, avant ce qui s'y ajoute (partiels, persistance) : ses lignes sont celles du fichier
  const writtenScript = script.raw
  const writtenModule = moduleSection.raw

  // 2-quater. Types et valeurs permises — un <types> n'a pas sa place dans un composant (fichier
  //    *.types.mjs) ; le <vars> est lu tout de suite, ses fautes sortent avant tout le reste, et
  //    ses règles sont émises plus bas, avec la classe (data.typesDecl/typesLine)
  if (sections.types.length > 0) throw new Error(t('transpiler.types-in-component', { line: sections.types[0].startLine }))
  if (sections.effects.length > 0) throw new Error(t('transpiler.effects-in-component', { line: sections.effects[0].startLine }))
  // un composant sans HTML (script ou style seuls, un commentaire) ne rend rien
  if (replaceBlocks(html, ['<!--'], () => '').trim() === '') {
    const empty = typedLine('emptyComponent', t('transpiler.component-no-html', { moduleName }), opts.lint)
    if (empty !== null) sections.warnings.push(empty)
  }
  // `@formAssociated` écrit plus d'une fois : la directive n'a qu'un sens, la compilation passe et un avertissement le dit
  if (dir.moduleFormAssociatedTwice) sections.warnings.push(t('transpiler.form-associated-multiple-times', { moduleName }))
  // une directive lisible écrite dans le texte d'un élément s'affiche telle quelle : un avertissement le dit, à sa ligne du fichier
  for (const at of importsInElementText(source)) sections.warnings.push(t('transpiler.import-in-text', { moduleName, line: source.slice(0, at).split('\n').length }))
  const varRules = compileVars(sections.vars, opts.typeDefs ?? {}, opts.typesText ?? true)
  checkSprings(varRules, [
    { text: moduleSection.raw, startLine: moduleSection.startLine, code: true },
    { text: script.raw, startLine: script.startLine, code: true },
    { text: html, startLine: sections.htmlStartLine, code: false },
  ])
  // `type: Reward[]` d'un appel µajax : la règle nommée, compilée, contrôlera la réponse à son arrivée ; la forme appelable
  // `µajax '/url', options` devient µ._mjs_ajax, un GET dont la promesse rend le corps
  // un `type: Nom` de verbe n'est une donnée que si le fichier lie `Nom` : lu sur l'arbre du code compilé, en fin de compilation
  const toBind: AjaxVerbName[] = []
  // les réécritures de la forme appelable, par bloc : un `µajax` réécrit dans un texte est cité à sa place (cf. ajaxPlacesAsText)
  const ajaxRewrites: AjaxRewrite[] = []
  for (const [block, name] of [[moduleSection, '<script module>'], [script, '<script>']] as const) {
    const ajax = compileAjaxTypes(block.raw, opts.typeDefs ?? {}, opts.typesText ?? true, block.startLine, opts.moduleName ? `mjs-${opts.moduleName.toLowerCase()}` : undefined, name, true)
    block.raw = compileAjaxCall(ajax.code, ajaxRewrites, block.startLine, !/^(?:js|ts)$/.test(block.lang ?? ''), block.lang === 'coffee')
    if (ajax.used) varRules.usesNamedTypes = true
    toBind.push(...ajax.toBind)
  }

  // 2-bis. Lint µeffect/µinspect hors top-level — sur le SOURCE du dev tout
  //    juste extrait (post-dedent, AVANT les appends persist/macros/includes
  //    qui génèrent leurs propres µeffect, légitimes). Copie normalisée
  //    `mjs.effect`→`µ.effect` pour le SCAN seulement (l'alias sigil n'est
  //    appliqué au vrai source qu'à l'étape 4-bis).
  lintEffectTopLevel(normalizeSigilAlias(script.raw, opts.sigil), false, script.startLine, script.lang)
  lintEffectTopLevel(normalizeSigilAlias(moduleSection.raw, opts.sigil), true, moduleSection.startLine, moduleSection.lang)

  // 2-bis-bis. Lint µemit dans <script module> : aucune
  //    instance de composant dans le module, `_mjsThis` n'y existe pas. Même
  //    copie normalisée que ci-dessus, <script> composant hors périmètre
  //    (µemit y reste légitime à toute profondeur, cf. lintEmitInModule).
  lintEmitInModule(normalizeSigilAlias(moduleSection.raw, opts.sigil), moduleSection.startLine)

  // 2-bis-ter. Rune séparée de son symbole (`µ` puis `.setContext(…)` à la ligne suivante) : refusée sur le
  //    source brut du dev, alias `mjs` reconnu par la règle elle-même, numéro recalé sur la ligne du `.mjs`.
  //    Le script des partiels est vu par processIncludes (étape 4a), les modules importés par le bundler.
  lintSplitRune(script.raw, '<script>', { sigil: opts.sigil, firstLine: script.startLine, lang: script.lang })
  lintSplitRune(moduleSection.raw, '<script module>', { sigil: opts.sigil, firstLine: moduleSection.startLine, lang: moduleSection.lang })

  // 2-ter. Garde-fou V1 `@onUrlChange = ` — AVERTISSEMENT (jamais bloquant),
  //    scanné sur le <script> composant seul (le hook de route n'a de sens que
  //    sur une INSTANCE ; <script module> n'a pas de `this` de composant).
  lintOnUrlChangeLegacy(script.raw, moduleName, opts.lint, colorsEnabled, script.startLine)

  // 3. Auto-imports : injectés en haut du module
  if (dir.pendingAutoImports.length > 0) {
    moduleSection.raw = dir.pendingAutoImports.join('\n') + '\n' + moduleSection.raw
  }

  // 4. Persistance : append au script user — du Civet, refusé sous un script JavaScript, TypeScript ou CoffeeScript, où il
  // sortait en erreur de syntaxe sur du code que l'auteur n'a pas écrit
  const persistCode = buildPersistCode(moduleName, dir.persistLocalVars, dir.persistSessionVars)
  if (persistCode && (script.lang === 'js' || script.lang === 'ts' || script.lang === 'coffee')) throw new Error(t('transpiler.persist-script-civet', { lang: script.lang }))
  if (persistCode) script.raw = script.raw + persistCode

  // 4a. <@include partial> + <@window/document/body/head> — EN PREMIER,
  //     avant alias/µasset : le contenu d'un partial inclus doit lui aussi
  //     passer par l'alias sigil et la résolution µasset, sinon un
  //     `µasset(...)` DANS le partial reste littéral (régression vécue : logo
  //     de _header.mjs jamais résolu → 404, figé en `&#39;` après le passage
  //     par le générateur HTML).
  const includeAcc = newIncludeAccumulator()
  // les blocs `{? nom}` du composant, développés AVANT d'y verser les partiels : une faute y est citée à
  // sa ligne du fichier, pas décalée de la hauteur des partiels (ceux des partiels, plus bas)
  html = expandLayoutBlocks(html, sections.htmlStartLine)
  // le HTML du composant lui-même, avant les partiels : ses lignes sont celles du fichier
  const hostHtml = html
  html = processIncludes(html, opts.baseDir, includeAcc, opts.sourceDir, { sigil: opts.sigil, scriptLang: script.lang, moduleLang: moduleSection.lang, firstLine: sections.htmlStartLine }, opts.lint)
  // la table des lignes du HTML où des partiels sont versés, chacun nommé par son chemin depuis le dossier du composant
  // (aucune sans partiel) : une faute écrite dans un partiel cite sa ligne dans ce partiel, une faute écrite après lui la
  // ligne du composant (cf. citeLine)
  const toRelative   = (file: string | null): string | null => (file === null ? null : relative(opts.baseDir ?? '', file))
  const places       = includeAcc.places?.some((p) => p.file !== null || p.rest) ? includeAcc.places.map((p) => (p.file === null && !p.rest ? p : { ...p, file: toRelative(p.file), ...(p.rest && { rest: p.rest.map((r) => ({ ...r, file: toRelative(r.file) })) }) })) : undefined
  const citeHtmlLine = (k: number): number | string => citeLine(places, sections.htmlStartLine, k)
  const includedHtml = html
  // Append partial scripts/styles/modules au parent
  // la place dans son fichier de chaque ligne du script et du `<script module>` donnés à l'adaptateur (cf. lineOrigin) : une
  // faute de Civet, de CoffeeScript, de TypeScript ou du lexeur y est citée `fichier.mjs:ligne:colonne`
  const scriptBlock: PouredBlock = { before: 0, written: writtenScript, first: script.startLine, file: whereWritten.file, source: whereWritten.lines, mergedBefore: script.raw, pieces: includeAcc.script, places: includeAcc.scriptPlaces ?? [], baseDir: whereWritten.baseDir }
  const moduleBlock: PouredBlock = { before: dir.pendingAutoImports.length, written: writtenModule, first: moduleSection.startLine, file: whereWritten.file, source: whereWritten.lines, mergedBefore: moduleSection.raw, pieces: includeAcc.module, places: includeAcc.modulePlaces ?? [], baseDir: whereWritten.baseDir }
  if (includeAcc.script.length > 0) script.raw += '\n' + includeAcc.script.join('\n')
  if (includeAcc.module.length > 0) moduleSection.raw += '\n' + includeAcc.module.join('\n')
  // neutralise tout octet NUL PRÉ-EXISTANT du style hôte AVANT d'apposer les marqueurs
  // \x00MJSSTYLE des partiels (macros.ts fait pareil côté partiel) : un NUL n'est jamais un
  // caractère UTILE en CSS/SASS (la tokenisation CSS remplace U+0000 par U+FFFD) — par
  // construction, les seuls NUL du texte fusionné sont donc NOS marqueurs (cf. transpiler/css.ts)
  if (style.raw.includes('\x00')) style.raw = style.raw.replace(/\x00/g, '')
  if (includeAcc.css.length > 0) style.raw += '\n' + includeAcc.css.join('\n')

  // 4b. Sigil ASCII (fallback clavier non-AZERTY) : `mjs.X` → `µ.X` etc.,
  //     APRÈS les includes (leur contenu en bénéficie aussi), AVANT
  //     résolution µasset/sucre µ/lexer. `µ` reste canonique. Dans le code seul : chaînes, commentaires,
  //     texte et attributs du HTML gardent `mjs.` tel qu'écrit (sigilAliasCode, sigilAliasHtml).
  if (opts.sigil && opts.sigil !== 'µ') {
    script.raw        = sigilAliasCode(script.raw, opts.sigil, script.lang)
    moduleSection.raw = sigilAliasCode(moduleSection.raw, opts.sigil, moduleSection.lang)
    html              = sigilAliasHtml(html, opts.sigil, new Set(readImportDirectives(html).map(d => d.index)), 0)
    // PAS `style.raw` : en SASS le `.` préfixe une CLASSE ; aliaser
    // `mjs`→`µ` y transformerait un sélecteur `.mjs.active` en `.µ.active`
    // (mort). Le style DYNAMIQUE passe par `--var={}`/@style dans le template,
    // jamais par une API `mjs.*` dans la feuille — rien à aliaser côté <style>.
  }
  // 4c. Alias ASCII contexte/partagé (`__context.X`/`__shared.X`), opt-in.
  if (opts.contextAlias) {
    script.raw        = normalizeContextAlias(script.raw, true)
    moduleSection.raw = normalizeContextAlias(moduleSection.raw, true)
    html              = normalizeContextAlias(html, true)
  }
  // 4c-bis. µeffect écrit dans un gestionnaire du gabarit (`@click={…}`, balises globales comprises, partiels versés compris), sigil déjà
  //     normalisé : refusé à la construction comme dans une méthode du script, sauf directement dans une racine µeffect.root (cf.
  //     lintEffectHandler) ; la faute cite la ligne de l'attribut, dans son partiel s'il y est écrit
  if (html.includes('effect')) {
    traverse(readFile(html, { template: true, dialect: true }), (n) => {
      if (n.kind !== 'tag') return
      for (const a of n.attrs) if (a.kind === 'gesture' && a.code && a.name) lintEffectHandler(html.slice(a.code.start, a.code.end), a.name, citeHtmlLine(html.slice(0, a.start).split('\n').length - 1))
    })
  }

  // 4d. Résolution µasset() APRÈS les includes (leurs `µasset(...)` en
  //     dépendent désormais aussi) et AVANT compilation langage. Coffee/
  //     Civet/TS verront juste un string literal, pas un appel inconnu.
  if (opts.resolveAsset) {
    script.raw         = await replaceMagicAssets(script.raw, opts.resolveAsset, script.lang)
    moduleSection.raw  = await replaceMagicAssets(moduleSection.raw, opts.resolveAsset, moduleSection.lang)
    // un chemin local écrit en clair dans un réglage d'image d'un effet (`*behind('photo.jpg')`) devient l'appel
    // `µimage('photo.jpg')` que le bundler a résolu (preResolveAssets), remplacé ci-dessous comme les autres ; `µasset('photo.jpg')`
    // pour un réglage dont l'effet ne lit que l'adresse : avant le remplacement des µasset, qui le résout
    if (opts.preResolvedImages) html = resolveEffectImages(html)
    html               = await replaceMagicAssets(html, opts.resolveAsset)
    // les feuilles du composant (`<style>` et ses déclinaisons nommées) : leur texte est du CSS, du SCSS ou du SASS que la compilation des
    // styles, plus bas, change en chaîne de CSS — l'appel `µasset('x.woff2')` n'y serait plus retrouvé par personne. Remplacé ici, dans la
    // source, par l'adresse que le bundler a résolue (celle des dossiers de assetDirs comprise) ; un fichier introuvable reste le repère
    // d'asset manquant, que le bundler refuse
    style.raw          = await replaceStyleAssets(style.raw, opts.resolveAsset)
    for (const ly of layouts) ly.raw = await replaceStyleAssets(ly.raw, opts.resolveAsset)
    script.raw         = replaceMagicImages(script.raw, opts.preResolvedImages)
    moduleSection.raw  = replaceMagicImages(moduleSection.raw, opts.preResolvedImages)
    html               = replaceMagicImages(html, opts.preResolvedImages)
  }

  // `{? timer}` → `{if (µlayout is 'timer')}` des partiels inclus : avant tout ce qui lit le HTML
  // (µlayout, modèles connus) ; ceux du composant sont déjà développés (cf. processIncludes)
  html = expandLayoutBlocks(html, sections.htmlStartLine)
  // une balise du langage écrite dans un partiel est citée à sa ligne du partiel (table des lignes)
  // le code des balises globales est compilé par la langue du script qui le reçoit, ou à part dans celle des gestionnaires (cf. separateGlobals)
  const macros = processGlobalMacros(html, { firstLine: sections.htmlStartLine, sigil: opts.sigil, places, dialect: true, civet: script.lang === 'js' || script.lang === 'ts' || script.lang === 'civet' })
  html = macros.html
  // le code des balises globales (`<@window>`, `<@document>`, `<@body>`…) est écrit dans la langue des gestionnaires : un script Civet ou
  // CoffeeScript le reçoit tel quel, un script JavaScript ou TypeScript ne le lirait pas — compilé à part, comme eux, après le script
  const separateGlobals = script.lang === 'js' || script.lang === 'ts' ? macros.setup + macros.teardown : ''
  // une faute de Civet dans un gestionnaire de ces balises, versé au script : citée à sa place dans le gabarit (cf. PouredMacros)
  // le code versé avant ces lignes (le <script>, ceux des partiels) : son dernier signe, cherché sur le seul chemin d'une faute
  const scriptBeforeMacros = script.raw
  const endBeforeMacros    = (): ScriptEnd | null => scriptEnd(scriptBeforeMacros, script.lang, scriptBlock)
  if (!separateGlobals && macros.setup) scriptBlock.macros = { before: script.raw, origins: macros.setupOrigins, places, first: sections.htmlStartLine, where: whereWritten, end: endBeforeMacros }
  if (!separateGlobals && macros.setup) script.raw += macros.setup
  if (!separateGlobals && macros.teardown) script.raw += macros.teardown

  // 5. Préprocesse HTML
  const hasDynamicSlots = html.includes('<@slot')
  html = preprocessHtml(html, moduleName, true)

  // 6. External vars (combinées : opts + @import)
  const externalVars = Array.from(new Set([
    ...(opts.externalVars ?? []),
    ...Array.from(dir.externalReactives),
  ]))

  // 7. Pipeline pré-compilation : sucre µ + tokenize ($xxx → $.xxx).
  //    L'ordre est critique : le lexer doit tourner AVANT la compilation langage,
  //    sinon Coffee transforme `$count = 0` en `var $count = 0;` qui devient
  //    `var $.count = 0;` après tokenize — JS invalide. Le lexer opère sur
  //    du texte, peu importe le langage source.
  const scriptAdapter = getAdapter(script.lang)
  const moduleAdapter = getAdapter(moduleSection.lang)

  // <script module> compilé ICI, AVANT le
  //    <script> composant : `modulePrep`/`moduleCompiled` ne dépendent QUE de
  //    `moduleSection.raw`, jamais de `scriptPrep`. Nécessaire pour lire `moduleVars`
  //    sur l'AST du JS RÉELLEMENT ÉMIS plutôt que sur un scan textuel ligne à ligne :
  //    l'ancien scan voyait un `nom = …` en colonne 0 DANS un bloc `###…###`/`/* */`/
  //    chaîne multi-lignes comme une vraie var module, empêchant l'auto-déclaration de
  //    l'homonyme dans le <script> (ReferenceError au montage, prouvé par le test rouge).
  // noms que la passe de déclaration pose elle-même (`x .= undefined`) : le contrôle des noms de variable ne les compte pas ;
  // chaque déclaration qu'elle pose (ligne, noms) est vérifiée par l'arbre de Civet
  // un script de composant n'a plus de commentaire (removeComments) : sous la lecture par l'arbre, le sucre n'en lit
  // aucun ; repris (un `#` que la compilation lit comme du code), il est relu du début, ses commentaires lus par l'arbre
  const rereadSugar = (declares: Set<string>, pass: PassDeclarations, sugar: () => string) => (): string => {
    declares.clear()
    pass.inPlace.clear()
    pass.hoisted.clear()
    pass.states.clear()
    return sugar()
  }
  const declaresModule = new Set<string>()
  const modulePass     = passDeclarations()
  const moduleReading  = { externalVars, moduleMode: true, fileName: `${moduleName}.module`, firstLine: moduleSection.startLine - dir.pendingAutoImports.length, lang: moduleSection.lang }
  const moduleSugarOf  = (comments: 'removed' | 'read') => applyMjsSugarToScript(moduleSection.raw, moduleSection.lang, undefined, '<script module>', moduleSection.startLine - dir.pendingAutoImports.length, declaresModule, modulePass, false, comments)
  const moduleSugar    = moduleSection.raw ? locateFault(() => moduleSugarOf('removed'), `${moduleName}.module`, moduleSection.raw, moduleBlock) : ''
  const moduleRead     = moduleSection.raw ? locateFault(() => prepareScript(moduleSugar, moduleReading), `${moduleName}.module`, moduleSugar, moduleBlock) : { text: '', tweak: null }
  const modulePrep     = moduleRead.text
  // même remap qu'au <script> composant (cf.
  // scriptCompiled plus bas) : une erreur Civet DANS <script module> citait une position relative
  // au texte COMPILÉ (`modulePrep`), jamais à la ligne réelle du `.mjs` — remapAdapterErrorLine
  // n'enveloppait alors QUE `scriptAdapter.compileToJs`. Décalage `moduleSection.startLine`, le
  // même que `shiftSourceMapLines(moduleCompiled.map, moduleSection.startLine - 1)` plus bas
  // (succès) applique déjà à la carte de source de ce bloc.
  // le texte donné en dernier à l'adaptateur (une reprise le relit) : les positions de son erreur sont les siennes
  let moduleSeen = ''
  let moduleCompiled: { code: string, map?: string }
  if (modulePrep) {
    try {
      moduleCompiled = await compilePreparedScript(moduleRead, moduleSugar, moduleReading, (text, tweak) => moduleAdapter.compileToJs(moduleSeen = text, { fileName: `${moduleName}.module`, lint: opts.lint, colorsEnabled, variableNames: true, mjsDeclaredNames: declaresModule, declareAssignments: true, passDeclarations: modulePass, knownNames: tweak?.names, treeFixup: tweak ?? undefined }), rereadSugar(declaresModule, modulePass, () => moduleSugarOf('read')))
      // `µ$X = …` dans le corps d'une fonction : une écriture (writesInFunctions)
      moduleCompiled = { ...moduleCompiled, code: writesInFunctions(moduleCompiled.code) }
    }
    catch (e) {
      throw remapAdapterErrorLine(e, `${moduleName}.module`, locateInBlock(moduleSeen, moduleBlock), dir.importDirectives, whereWritten.file)
    }
  }
  else {
    moduleCompiled = { code: '' }
  }
  let moduleJs = moduleCompiled.code
  // une seule analyse du JS compilé, partagée par les contrôles qui suivent (constantes, symboles réservés, déclarations…)
  const moduleAst = parseModuleAst(moduleJs, true)
  // défaut de Civet sur une flèche en ligne (INLINE_ARROW_CIVET_RE, `f = => x = if a then 'b' else 'c'`) : le JavaScript
  // du bloc ne s'analyse pas, la page mourait au chargement — même refus que pour le <script> (cf. plus bas)
  if (moduleJs && !moduleAst) {
    let position: RegExpExecArray | null = null
    try { acorn.parse(moduleJs, { ecmaVersion: 'latest', sourceType: 'module' }) }
    catch (e: any) { position = /\((\d+):\d+\)$/.exec(String(e?.message ?? '')) }
    const producedLine = position ? moduleJs.split('\n')[Number(position[1]) - 1] ?? '' : ''
    if (INLINE_ARROW_CIVET_RE.test(producedLine)) throw new Error(t('transpiler.script-arrow-inline', { moduleName, line: Number(position![1]), excerpt: producedLine.trim().slice(0, 160), section: '<script module>' }))
  }
  // même contrôle des constantes `:=` que pour le `<script>` (cf. plus bas), sur le JS du bloc
  // `<script module>` juste compilé : une constante réaffectée dans le bloc lui-même
  const moduleConstReassign = findConstReassignment(moduleJs, [], moduleAst)
  if (moduleConstReassign) {
    throw new Error(t('transpiler.civet-reassignment-constant', { name: moduleConstReassign.name, line: moduleConstReassign.line, code: true }))
  }
  // Vars top-level du `<script module>` partagé : le `<script>` composant peut les
  // lire/réassigner sans qu'elles soient re-déclarées localement (sinon TDZ). Repli
  // textuel (ancien comportement) SEULEMENT si l'AST ne parse pas (sortie langage
  // exotique) — l'AST reste la source d'autorité, cf. collectTopLevelDeclarations.
  const moduleVars = moduleAst
    ? [...collectTopLevelDeclarations(moduleAst, 'binding'), ...collectTopLevelDeclarations(moduleAst, 'const')]
    : (() => {
        const out: string[] = []
        if (moduleSection.raw) {
          for (const rawLine of moduleSection.raw.split('\n')) {
            // Indentation zéro UNIQUEMENT : une assignation locale DANS une fonction
            // du module (indentée) n'est pas une var module — la collecter empêchait
            // l'auto-déclaration d'une homonyme dans le <script> composant
            // (assignation nue → ReferenceError au runtime).
            if (/^\s/.test(rawLine)) continue
            const m = rawLine.match(/^(?:export\s+)?([a-zA-Z_]\w*)\s*(?:[:.]=|\?=|=(?!=))/)
            if (m) out.push(m[1])
          }
        }
        return out
      })()
  const declaresScript = new Set<string>()
  const scriptPass     = passDeclarations()
  const scriptReading  = { externalVars, fileName: `${moduleName}.script`, firstLine: script.startLine, lang: script.lang }
  const scriptSugarOf  = (comments: 'removed' | 'read') => applyMjsSugarToScript(script.raw, script.lang, moduleVars, '<script>', script.startLine, declaresScript, scriptPass, true, comments)
  const scriptSugar    = script.raw ? locateFault(() => scriptSugarOf('removed'), `${moduleName}.script`, script.raw, scriptBlock) : ''
  const scriptRead     = script.raw ? locateFault(() => prepareScript(scriptSugar, scriptReading), `${moduleName}.script`, scriptSugar, scriptBlock) : { text: '', tweak: null }
  const scriptPrep     = scriptRead.text

  // 8. Compile via language adapter → JS standard
  // carte de source du compilateur, décalée de l'offset de ligne du bloc
  //    `<script>`/`<script module>` dans le `.mjs` (sections.ts, `startLine`). Décalage
  //    CONSTANT (dedent conserve le nombre de lignes) : shiftSourceMapLines() suffit, pas
  //    besoin d'un composeur générique. Ne couvre QUE cette passe.
  // En cas d'ÉCHEC (pas seulement de succès), la position `<fichier>:<ligne>:<col>`
  // que l'adaptateur (Civet) rend est relative au texte COMPILÉ (`scriptPrep`, dédenté), dont la
  // ligne 1 tombe sur `script.startLine` du `.mjs` réel — jamais sur sa propre ligne 1. Même
  // décalage QUE `shiftSourceMapLines` juste en dessous (succès), appliqué ICI au MESSAGE
  // (remapAdapterErrorLine, plus haut) avant de relancer.
  let scriptSeen = ''
  let scriptCompiled: { code: string, map?: string }
  if (scriptPrep) {
    try {
      scriptCompiled = await compilePreparedScript(scriptRead, scriptSugar, scriptReading, (text, tweak) => scriptAdapter.compileToJs(scriptSeen = text, { fileName: `${moduleName}.script`, lint: opts.lint, colorsEnabled, variableNames: true, inComponent: true, mjsDeclaredNames: declaresScript, declareAssignments: true, knownNames: tweak ? [...moduleVars, ...tweak.names] : moduleVars, passDeclarations: scriptPass, treeFixup: tweak ?? undefined }), rereadSugar(declaresScript, scriptPass, () => scriptSugarOf('read')))
      // `µ$X = …` dans le corps d'une fonction : une écriture (writesInFunctions)
      scriptCompiled = { ...scriptCompiled, code: writesInFunctions(scriptCompiled.code) }
    }
    catch (e) {
      throw remapAdapterErrorLine(e, `${moduleName}.script`, locateInBlock(scriptSeen, scriptBlock))
    }
  }
  else {
    scriptCompiled = { code: '' }
  }
  // balises globales d'un script JavaScript ou TypeScript (cf. separateGlobals) : leurs gestionnaires voient les noms du script et du
  // `<script module>`, qui ne sont pas redéclarés (une écriture garde la variable du script), puis leur JavaScript suit celui du script
  if (separateGlobals) {
    const read  = parseModuleAst(scriptCompiled.code)
    const known = [...moduleVars, ...collectTopLevelDeclarations(read, 'binding'), ...collectTopLevelDeclarations(read, 'const')]
    const text  = tokenize(applyMjsSugarToScript(separateGlobals, 'civet', known, '<script> (handlers)'), { externalVars })
    let js: string
    try {
      js = (await getAdapter('civet').compileToJs(text, { fileName: `${moduleName}.globals`, lint: opts.lint, colorsEnabled })).code
    }
    catch (e) {
      // une faute dans le code d'une balise globale : citée à sa place dans le gabarit, comme dans un script Civet (cf. mergedHandlerPlace)
      throw remapAdapterErrorLine(e, `${moduleName}.globals`, (line, column) => mergedHandlerPlace(line - 1, text.split('\n')[line - 1] ?? '', column, { before: '', origins: macros.setupOrigins, places, first: sections.htmlStartLine, where: whereWritten, end: () => null }))
    }
    scriptCompiled = { ...scriptCompiled, code: `${scriptCompiled.code}\n${js}` }
  }
  const scriptJs = scriptCompiled.code
  // réaffectation d'un identifiant lié par `:=` (const) : contrôle par résolution de portée
  // EXACTE sur le JS que Civet vient de produire, juste avant toute réécriture propre à
  // ModularJS ($x/µ/path-tracking/this-rebinding — jamais vues ici, donc jamais de faux positif
  // sur du code généré par le framework). applyMjsSugarToScript (plus haut, sur la source Civet)
  // a déjà refusé ce qu'il peut voir À LA MÊME PORTÉE avec la ligne SOURCE réelle — gardé tel
  // quel, meilleur numéro de ligne pour ce qu'il couvre. Ce contrôle-ci ferme ce qui lui échappe
  // (bloc indenté, fonction imbriquée sans homonyme local) : la ligne citée est alors celle du
  // JS compilé, jamais de la source Civet — dit explicitement dans le message (`code: true`).
  // Les constantes du `<script module>` sont visibles du `<script>` (qui s'exécute dans leur
  // portée) : les réaffecter depuis le `<script>` plante de même, sauf homonyme local.
  // 7-bis/7-ter. Lints AST. PERF : chaque section est analysée UNE fois (parseModuleAst, avec les positions de ligne)
  // et l'AST partagé par tous les contrôles : constantes, symboles réservés, déclarations, imports, analyseur
  const scriptAst = parseModuleAst(scriptJs, true)
  // un <script> qui s'arrête au milieu d'une expression (`a +`) prend la première ligne que <@failed>, <@window>, <@document> ou <@body> lui
  // versent
  // (cf. swallowedFirstLine) : le script se compile sans faute, et ce qu'elle pose est perdu. Refusé, cité au dernier signe du script ;
  // un script JavaScript ou TypeScript ne les reçoit pas (cf. separateGlobals)
  if (scriptAst && !separateGlobals && macros.setup && swallowedFirstLine(scriptJs, (scriptAst as any).body, macros.setup)) {
    const end = endBeforeMacros()
    throw new Error(t('transpiler.script-left-open', { position: end ? `${end.file}:${end.line}:${end.column}` : whereWritten.file, end: end?.text ?? '' }))
  }
  // un gestionnaire de <@window>, <@document> ou <@body> resté ouvert sur un opérateur (`@resize={$x = 1 +}`) avale la ligne qui
  // le referme dans le script (`@_gl_0 = µ._mjs_sigFree(@_gl_0)`) : le script se compile sans faute, et le gestionnaire ne fait
  // pas ce qui est écrit. Refusé, cité à son `}`
  if (scriptAst && macros.setupHandlers.length > 0) {
    const closed = new Set<string>()
    for (const stmt of (scriptAst as any).body) {
      const a = stmt.type === 'ExpressionStatement' ? stmt.expression : null
      if (a?.type === 'AssignmentExpression' && a.left?.object?.type === 'ThisExpression' && a.right?.type === 'CallExpression' && a.right.callee?.property?.name === '_mjs_sigFree') closed.add(a.left.property?.name)
    }
    const swallows = macros.setupHandlers.find((h) => !closed.has(h.fn) && h.origin.html.slice(h.origin.at, h.origin.at + h.origin.body.length) === h.origin.body)
    if (swallows) throw handlerStaysOpen(placeInTemplate(swallows.origin.html, swallows.origin.at + swallows.origin.body.length, places, sections.htmlStartLine, whereWritten), swallows.origin.body)
  }
  const constReassign = findConstReassignment(scriptJs, collectTopLevelDeclarations(moduleAst, 'const'), scriptAst)
  if (constReassign) {
    throw new Error(t('transpiler.civet-reassignment-constant', { name: constReassign.name, line: constReassign.line, code: true }))
  }
  // garde symboles réservés, cf. generator/reserved-symbols.ts
  lintReservedSymbolNames(moduleJs, moduleName, '<script module>', moduleAst)
  const scriptSourceMap  = scriptCompiled.map  ? shiftSourceMapLines(scriptCompiled.map, script.startLine - 1) : undefined
  // les lignes d'import ajoutées devant le bloc (`@import`) n'ont pas de place dans le fichier : leurs segments perdent leur position
  const moduleSourceMap  = moduleCompiled.map  ? shiftSourceMapLines(moduleCompiled.map, moduleSection.startLine - 1 - dir.pendingAutoImports.length, dir.pendingAutoImports.length) : undefined


  // Noms top-level du `<script>` et du `<script module>`, lus sur l'AST du JS COMPILÉ et
  // JAMAIS sur le texte source : ce sont exactement les identifiants qui existeront dans le
  // corps de fonction portant aussi `this._mjs_inline = [...]`, donc ceux qu'un handler voit
  // par closure. Une collecte textuelle (ligne à ligne, indentation zéro) ramassait un
  // `docVar = …` posé DANS un commentaire `###…###` ou une chaîne multi-ligne : le nom
  // n'existait nulle part dans le JS émis, et le handler qui l'écrivait partait en
  // « ReferenceError » au premier clic. Les `const` sont collectés À PART, du `<script>` comme du
  // `<script module>` : les prédéclarer aussi évite l'écriture silencieusement perdue, mais leur
  // réaffectation depuis un handler est refusée au build (contrôle du JavaScript compilé des
  // gestionnaires) plutôt que laissée exploser en « Assignment to constant ».
  const scriptVars   = collectTopLevelDeclarations(scriptAst, 'binding')
  const scriptConsts = collectTopLevelDeclarations(scriptAst, 'const')
  const moduleConsts = collectTopLevelDeclarations(moduleAst, 'const')
  const moduleTopVars = [...collectTopLevelDeclarations(moduleAst, 'binding'), ...collectTopLevelDeclarations(moduleAst, 'const')]

  // cf. lintImportDollarName et lintUndeclaredTopLevelAssignment.
  // On seed AUSSI `moduleVars` : une réassignation top-level d'une var
  // du <script module> dans le <script> composant (`current = audio`, motif
  // « compteur d'instances » hérité de Svelte module-context) est LÉGITIME et ne
  // doit pas être flaggée « nom jamais déclaré » (la var vit dans le module).
  // garde symboles réservés AVANT ce lint : sinon `$ = 3` est d'abord signalé
  // « nom jamais déclaré », message qui conseille `$ := …` — lequel échoue à son tour sur la garde
  lintReservedSymbolNames(scriptJs, moduleName, '<script>', scriptAst)
  lintUndeclaredTopLevelAssignment(scriptJs, script.lang, [...externalVars, ...moduleVars], scriptAst)
  lintUndeclaredTopLevelAssignment(moduleJs, moduleSection.lang, externalVars, moduleAst)
  // `@title = …` en tête du <script> : la balise du composant, pas une donnée (cf. la fonction)
  // la ligne du .mjs d'une position du JS compilé : citée seulement quand la carte de source dit vrai — le sucre
  // n'a pas ajouté de ligne au script (déclaration de `µ$x`, variable hissée en tête) et la position est dans le
  // script écrit, pas dans ce qu'on lui a versé après (partiels, persistance, macros)
  const scriptKeepsLines = scriptPrep.split('\n').length === script.raw.split('\n').length
  const lastWrittenLine  = script.startLine - 1 + writtenScript.split('\n').length
  const scriptLineOf     = (offset: number): number | null => {
    const line = scriptKeepsLines ? sourceLineOf(scriptJs, scriptSourceMap, offset) : null
    return line !== null && line <= lastWrittenLine ? line : null
  }
  lintElementPropertyAtConstruction(scriptAst, moduleName, opts.lint, colorsEnabled, scriptLineOf)
  // setTimeout / setInterval du <script> : refusés, µevery / µafter à la place (cf. timers.ts) ; libres, les noms que
  // le composant déclare hors de l'AST lu : son <script module> et ses `@import` (posés en tête du module), la racine du
  // <script> pour le gabarit et les gestionnaires
  const componentNames = [...rootNames(moduleAst), ...rootNames(scriptAst)]
  rejectRawTimers(scriptAst, scriptLineOf, moduleName, false, componentNames)
  // code qui suit un `return`, un `throw`, un `break` ou un `continue` dans le même bloc (cf. unreachable.ts) :
  // le <script> et le <script module>, chacun à sa ligne du .mjs — imports ajoutés devant le bloc exclus
  warnUnreachableCode(scriptAst, scriptLineOf, `${moduleName}.mjs`, opts.lint, colorsEnabled)
  const moduleKeepsLines = modulePrep.split('\n').length === moduleSection.raw.split('\n').length
  const lastModuleLine   = moduleSection.startLine - 1 + moduleSection.raw.split('\n').length - dir.pendingAutoImports.length
  warnUnreachableCode(moduleAst, offset => {
    const line = moduleKeepsLines ? sourceLineOf(moduleCompiled.code, moduleSourceMap, offset) : null
    return line !== null && line <= lastModuleLine ? line : null
  }, `${moduleName}.mjs`, opts.lint, colorsEnabled)
  // une fonction d'un module .js copié tel quel qui écrit dans le magasin `$$x` reçu en argument (cf. generator/store-args.ts) :
  // le <script> et le <script module> ici, les gestionnaires et les expressions du HTML plus bas
  const scanStoreArgs = storeArgsToRawJsLint(dir.pendingAutoImports, moduleName, opts.lint, colorsEnabled, opts.sourceDir)
  scanStoreArgs(scriptJs, scriptLineOf)
  scanStoreArgs(moduleJs)
  // un effet en direct de <@document> sans connexion écrite la prend dans `@sock` : le script, ou un
  // gestionnaire du HTML, doit le poser
  const htmlWithoutComments = maskCommentsInHtml(html)
  const codeHtml = templateCode(htmlWithoutComments)
  // une fléchée à paramètre nu (`v => v * 2`) : Civet la lit comme un appel de `v` (`v(() => v * 2)`), sans faute ; refusée quand rien ne
  // fournit `v` (ni un script du composant, ni une variable du gabarit, ni une fonction globale) : l'appel lèverait à coup sûr
  for (const m of maskNonCode(codeHtml, 'civet').matchAll(/(?<![\w$@µ§&#.])([A-Za-z_]\w*)[ \t]+=>/g)) {
    const name = m[1]
    const word = `(?<![\\w$@µ§&#.])${name}(?![\\w$])`
    if (WORDS_BEFORE_ARROW.has(name) || BROWSER_FUNCTIONS.has(name) || typeof (globalThis as any)[name] === 'function') continue
    if (new RegExp(word).test(`${script.raw}\n${moduleSection.raw}`) || new RegExp(`\\{\\s*(?:for|const|then|success|error|catch)\\b[^}\\n]*${word}`).test(html)) continue
    const where = html.search(new RegExp(`${word}[ \\t]+=>`))
    throw new Error(t('transpiler.arrow-param-bare', { moduleName, line: String(citeHtmlLine(html.slice(0, Math.max(where, 0)).split('\n').length - 1)), name: name }))
  }
  const instanceProps = [...new Set([...collectInstanceProps(scriptAst), ...collectHandlerInstanceProps(codeHtml, 'civet')])]
  if (macros.docSock.length > 0 && !instanceProps.includes('sock')) throw new Error(sockAbsent(macros.docSock[0]))

  // Lint import ES classique interdit — cf. lintNoRawImport.
  // moduleJs peut légitimement commencer par dir.pendingAutoImports.length
  // imports RÉELS (résolution @import, cf. "3. Auto-imports" plus haut).
  lintNoRawImport(scriptJs, '<script>', 0, scriptAst)
  lintNoRawImport(moduleJs, '<script module>', dir.pendingAutoImports.length, moduleAst)

  // voie AST (post-Civet) : ferme le trou du gabarit (µimport niché
  // dans une interpolation ${…}/#{…}) pour le <script module> — remplace
  // l'ancienne réécriture par scanner (rewriteMuImport, retirée
  // d'applyMjsSugarToScript ci-dessus). `jsInitBase` (le <script> composant)
  // reçoit la même passe plus bas, une fois ses propres transformations
  // terminées (cf. section 11).
  moduleJs = rewriteMuImportAst(moduleJs, '<script module>')
  // `$$x = $$x` : refusé, comme dans le script et le fichier d'un magasin (cf. refuseStoreSelfWrites)
  refuseStoreSelfWrites(moduleJs)
  // un reffet au premier niveau du `<script module>` appartient au module du composant, comme celui d'un module .civet ou .coffee : il naît
  // à l'import du composant, entre ces deux appels (runtime/mjs_effect.ts), vit avec la page, et le module exécuté de nouveau (rechargement
  // à chaud) nettoie d'abord ceux de sa vie d'avant ; les clés `$$x` qu'il lit sont relevées comme ailleurs. L'ouverture suit les `import`,
  // sur leur ligne, la fermeture vient après la dernière : chaque ligne du module garde sa place (carte de source)
  if (/µ\.effect\b/.test(moduleJs)) {
    let opens = 0
    try {
      for (const n of (acorn.parse(moduleJs, { ecmaVersion: 'latest', sourceType: 'module' }) as any).body) if (n.type === 'ImportDeclaration') opens = n.end
    }
    catch { /* le module refusé plus loin dit lui-même sa faute */ }
    const annotated = annotateEffectDepsMapped(moduleJs, undefined, undefined, false, false, false, opts.reffetsAll === true).code
    moduleJs = `${annotated.slice(0, opens)}; µ._mjs_magOpen(${JSON.stringify(moduleName + ' <script module>')}); ${annotated.slice(opens)}\nµ._mjs_magClose();\n`
  }

  // 9. Analyzer (script du composant) — créé même sans script, pour que les
  // composants qui ne déclarent rien dans `<script>` mais lisent `$x` /
  // `$foo` directement depuis le template (props auto-déclarées) soient
  // tout de même analysés et leurs `_mjs_var_bits` correctement remplis.
  let analyzer: Analyzer
  try {
    // variables du `<script module>` que le module change lui-même : jamais une donnée sûre pour une valeur dérivée (sans
    // lecture du module, aucune ne l'est)
    const changing = moduleAst ? changingNames(moduleAst, moduleVars) : null
    // valeurs précises avec l'option `derived: "precise"` seulement ; écriture de l'état qui contourne MJS dans le composant : aucune
    // valeur précise (derived-classes.ts)
    analyzer = new Analyzer(scriptJs ?? '', externalVars, opts.lint, colorsEnabled, scriptAst, changing ? moduleVars.filter((v) => !changing.has(v)) : [], RAW_WRITE.test(writtenSource), opts.derivedPrecise === true, { moduleName, first: 1, lines: whereWritten.lines(), lang: script.lang, wholeFile: true })
  }
  catch (e: any) {
    // défaut de Civet sur une flèche en ligne (INLINE_ARROW_CIVET_RE, `f = => x = if a then 'b' else 'c'`) : le JavaScript produit
    // ne s'analyse pas et acorn parle d'autre chose (« The keyword 'let' is reserved », « Unexpected token »). Signature lue sur la
    // ligne qu'acorn désigne (`(ligne:colonne)` en fin de message) : message de cette forme, avec les deux écritures qui passent
    const position     = /\((\d+):\d+\)$/.exec(String(e?.message ?? ''))
    const producedLine = position ? (scriptJs ?? '').split('\n')[Number(position[1]) - 1] ?? '' : ''
    if (INLINE_ARROW_CIVET_RE.test(producedLine)) {
      throw new Error(t('transpiler.script-arrow-inline', { moduleName, line: Number(position![1]), excerpt: producedLine.trim().slice(0, 160) }))
    }
    // `#nom` hors d'une classe (`#console.log x`, ligne mise en commentaire sans espace) : Civet le lit comme un nom privé, acorn le refuse
    // sans dire ni le fichier ni la règle ; message avec la ligne du .mjs où le nom est écrit et la forme d'un commentaire (`#` puis une espace)
    const privateFieldRe = /Private field '#([A-Za-z_$][\w$]*)'/.exec(String(e?.message ?? ''))
    if (privateFieldRe) {
      const k = script.raw.split('\n').findIndex((l) => new RegExp(`(?<![\\w$.@])#${privateFieldRe[1].replace(/\$/g, '\\$')}(?![\\w$])`).test(l))
      throw new Error(t('transpiler.hash-sign-glued-name-private', { moduleName, name: privateFieldRe[1], line: k < 0 ? '' : script.startLine + k }))
    }
    // Piste ciblée (bug Civet amont) : un objet 100 % spread en position
    // `else` d'un if/then/else inline (`x = if $c then {...$a} else {...$b}`)
    // compile en JS invalide (`else {ref = ...b}`) — l'erreur atterrit ICI,
    // très en aval de la vraie faute, avec un message acorn brut et cryptique
    // (« [analyzer] parse error: … », cf. analyzer/index.ts). Hint ajouté
    // SEULEMENT si le motif est présent dans la source Civet du <script> —
    // jamais de faux positif sur une autre cause de parse error.
    const spreadElseHint = /else\s*\{\s*\.\.\./.test(script.raw)
      ? t('transpiler.hint-spread-else-civet')
      : ''
    // même piste, second motif PROUVÉ hors MJS : une flèche FINE `->`
    // dont le corps-objet contient un spread (`(x) -> { ...x, k: v }`) compile
    // en JS invalide côté Civet (`return ...x,({k: v})`) — la flèche grasse
    // `=>` ou des parenthèses explicites `-> ({ ... })` contournent. Même
    // garde : hint apposé SEULEMENT si le motif est dans la source, jamais de
    // faux positif sur une autre cause de parse error. Les deux hints se
    // cumulent si les deux motifs sont présents.
    const spreadFatArrowHint = /->\s*\{[^{}]*\.\.\./s.test(script.raw)
      ? t('transpiler.hint-spread-arrow-thin-civet')
      : ''
    throw new Error(`${e.message}${spreadElseHint}${spreadFatArrowHint}`)
  }
  analyzer.autoDeclareFromTemplate(html)

  // µlayout — le modèle choisi : la prop `layout`, déclarée ici même si seul le script la lit ; un
  // composant qui a sa propre variable `$layout` ne peut pas s'en servir (les deux se confondraient).
  // Lu dans le code seulement : le script tel que le lexer l'a réécrit (son compilateur, TypeScript
  // par exemple, reformate ensuite la réécriture), et le code entre accolades du HTML ; chaînes et
  // commentaires ne comptent pas pour l'homonymie. Le raccourci d'un attribut (`title="$layout"`, hors
  // accolades) lit la variable aussi ; le texte entre les balises n'en lit aucune
  const muLayout = scriptPrep.includes(MU_LAYOUT_OUT) || /(?<![\w.µ])µlayout(?![\w])/.test(codeHtml)
  const SAME_NAME_RE = /(?<![\w.$])\$layout(?![\w])/
  if (muLayout && SAME_NAME_RE.test(maskNonCode(script.raw, script.lang) + '\n' + maskNonCode(codeHtml, 'civet') + '\n' + attributeValues(htmlWithoutComments))) {
    // la ligne de la variable quand elle est dans le script écrit ; ailleurs (partiel inclus, HTML aux
    // blocs développés), sa position ne se relie plus au fichier
    const written = SAME_NAME_RE.exec(maskNonCode(writtenScript, script.lang))
    throw new Error(t('transpiler.mu-layout-same-name', { moduleName, line: written ? script.startLine + (writtenScript.slice(0, written.index).match(/\n/g)?.length ?? 0) : '' }))
  }
  if (muLayout) analyzer.autoDeclareFromTemplate('{$layout}')

  // collision état/méthode homonymes.
  // `$x` (état) et `@x` (méthode) occupent la MÊME propriété de l'instance.
  // Détection ICI (pas dans analyze()) : autoDeclareFromTemplate tourne APRÈS
  // analyze(), un état déclaré SEULEMENT par le template (jamais écrit dans
  // <script>) n'existait pas encore au moment où analyze() aurait pu le voir
  // — analyzer.stateVars, lui, est DÉFINITIF (post auto-déclaration) ici.
  //
  // cause réelle isolée : PAS cette collision en soi, mais
  // le salvage pré-upgrade de connectedCallback (mjs_element.ts) qui verse la
  // méthode homonyme dans l'état puis la supprime. Le runtime épargne
  // désormais les clés fonction listées ci-dessous : on ne refuse plus la
  // compilation, on transmet juste la liste triée au gabarit.
  const stateMethodCollisions = analyzer.stateVars.filter(v => analyzer.methodNames.has(v)).sort()
  const stateMethodClashLine = stateMethodCollisions.length === 0
    ? ''
    : `\n    this._mjs_state_methods = ${JSON.stringify(Object.fromEntries(stateMethodCollisions.map(n => [n, 1])))};`

  // Lint « trop de variables d'état » — un composant qui
  // déclare des dizaines de `$x` est un écran-monolithe à découper (étalonnage
  // réel : modules sains 5-20 vars, monolithe pathologique vu à 182). Simple
  // AVERTISSEMENT, jamais bloquant : rien d'incorrect à l'exécution, c'est un
  // signal d'architecture. `stateVars` = l'ensemble DÉFINITIF post-analyse +
  // auto-déclaration template (état + dérivés, hors vars importées). Seuil
  // `lint.maxStateVars` (mjs.config.json), 0 = désactivé, défaut 40. Un module du
  // cœur arrive ici à 0 (bundler, compileMjsCold) : jamais signalé à l'appli.
  const maxStateVars = opts.maxStateVars ?? 40
  if (maxStateVars > 0 && analyzer.stateVars.length > maxStateVars) {
    printDiagnostic(typedLine('maxStateVars', t('transpiler.too-many-variables-state', { moduleName, n: analyzer.stateVars.length, threshold: maxStateVars }))!, colorsEnabled)
  }

  // Lint « accessibilité » (a11y) — sept contrôles ciblés (image
  // sans alt, iframe sans title, tabindex positif, @click non interactif,
  // bouton/lien sans nom accessible, champ de saisie sans étiquette), cf.
  // transpiler/a11y.ts. Simple AVERTISSEMENT, jamais bloquant, même famille que
  // maxStateVars ci-dessus. Activé par DÉFAUT — `lint.a11y: false` coupe tout.
  // Étiquette `[lint.a11y]` posée ICI (une fois par ligne, pas par composant) : remplace
  // l'ancien rappel « pour couper ce contrôle » répété à chaque composant.
  if (opts.a11y ?? true) {
    for (const msg of checkA11y(html, moduleName, citeHtmlLine, true)) printDiagnostic(typedLine('a11y', msg)!, colorsEnabled)
  }

  // Lint « <form> sans action ni méthode » (ujsForm —
  // le contrat « UJS intercepte TOUT <form> » reste entier, mais avec un
  // avertissement), cf. transpiler/ujs-form.ts. Même famille que le lint a11y
  // ci-dessus : simple AVERTISSEMENT, jamais bloquant. Activé par DÉFAUT —
  // `lint.ujsForm: false` coupe tout.
  if (opts.ujsForm ?? true) {
    for (const msg of checkUjsForm(html, moduleName, citeHtmlLine, true)) printDiagnostic(typedLine('ujsForm', msg)!, colorsEnabled)
  }

  // les noms que le <script>, le <script module> et les imports fournissent aux gestionnaires (cf. checkHandlerReferences)
  const importedNames = new Set([...collectImportNames(scriptAst), ...collectImportNames(moduleAst)])
  const handlerNames  = new Set([...moduleTopVars, ...scriptVars, ...scriptConsts, ...moduleVars, ...externalVars, ...importedNames])
  // 10. Generator HTML — V2 retourne aussi `effectsByVar` (Map varName → codes).
  // les balises des composants du projet, relevées par le parseur pour le contrôle propUnknown (cf. transpiler/build-checks.ts)
  const projectTags: ProjectTagSeen[] = []
  // les liens `#/…` des éléments `<a>`, relevés par le parseur pour le contrôle routeUnknown
  const linksSeen: LinkSeen[] = []
  // `structVars` permet au runtime de skip `_mjs_renderStruct` quand
  // une mutation ne touche pas un bloc structurel.
  const [surgicalHtmlWithMarkers, updates, events, inlines, effectsByVar, structVars, mountOnlyEffects, passiveEvents, tagRefs, templateLocals, initialPropBinds, componentDeps, inlineLocals, propVars] = withComponentNames(componentNames, () => withTemplateLine(() => compileHtml(html, {
    analyzer,
    externalVars,
    handlerScope: handlerNames,
    handlerConsts: [...scriptConsts, ...moduleConsts],
    scriptLang: script.lang,
    startScript: script.raw,
    moduleName,
    lint: opts.lint,
    colorsEnabled,
    autoSkeleton: !opts.skeleton || opts.skeleton.includes('await'),
    models: opts.models,
    guarded: [...varRules.names.map(n => '$' + n), ...new Set([...varRules.storeNames, ...(opts.typedStores ?? [])].map(n => '$$' + n))],
    guardSilent: opts.guard === false,
    instanceProps,
    firstLine: sections.htmlStartLine,
    hostLines: places?.map((p) => p.host),
    // une ligne faite de morceaux de plusieurs fichiers (texte du composant après un `<@include>`, partiel versé en milieu de
    // ligne) : chaque morceau cité dans son fichier, d'après sa place dans la ligne (cf. MixedLine)
    lineCites: places && parserCites(places, sections.htmlStartLine, includedHtml),
    devWarnings: opts.devWarnings === true,
    serverRendered: opts.serverRendered === true,
    derivedPrecise: opts.derivedPrecise === true,
    proxy: opts.proxy,
    projectTags,
    links: linksSeen,
  }), hostHtml, sections.htmlStartLine, moduleName, includedHtml, places, whereWritten))

  // `<@view name>` réellement transformé en `<metamjs-view id="name">` par le
  // generator (generator/compile.ts, preprocess()) : lire le résultat plutôt que re-greper
  // `html` évite de dupliquer/désynchroniser le motif reconnu (attributs css/data-mjs-vt/
  // data-mjs-vt-p) — la balise SURVIT telle quelle dans le HTML chirurgical, c'est elle que
  // le routeur cherche par querySelector au runtime (cf. mjs_router.ts). Réutilisé par la
  // garde .page.mjs, plus bas après detectRouterAware.
  const hasView = surgicalHtmlWithMarkers.includes('<metamjs-view')

  // On génère __create_X(): {fragment, refs} qui construit le DOM
  // impérativement. Le walk legacy extractPaths (debug,
  // consommé NULLE PART en aval — vérifié) a été retiré du chemin de prod :
  // un parcours HTML complet redondant par fichier, qui hébergeait en plus
  // une boucle infinie sur un `<` littéral en texte.
  // `compactPaths` : le DOM racine du composant est construit UNE fois par instance — ses accès
  // aux nœuds s'écrivent `µ._p(_f,2,0)` et ses marqueurs `µ._tm(…)` (runtime mjs_dom.ts) dès que
  // c'est plus court. Les gabarits de ligne d'un `{for}`, eux, gardent leurs chaînes directes
  // (cf. compileFor, generator/compile.ts).
  const createFnBody = generateCreateFnBody(surgicalHtmlWithMarkers, { compactPaths: true })
  const { struct, trans } = classifyUpdates(updates)

  // Build des chaînes pour le template V2.
  //
  // Stratégie : on émet d'abord un tableau `const _e = [() => {...}, ...]`
  // contenant TOUS les codes d'effects uniques. Puis `_mjs_effectsByVar` et
  // `_mjs_effectsAll` référencent ces fonctions par index — zéro duplication de
  // code source. L'array `_e` est émis en tête de JS_INIT (vu par closure).
  const allEffectCodes: string[] = []
  const codeToFnIdx = new Map<string, number>()
  const ensureCode = (code: string): number => {
    let idx = codeToFnIdx.get(code)
    if (idx === undefined) {
      idx = allEffectCodes.length
      codeToFnIdx.set(code, idx)
      allEffectCodes.push(code)
    }
    return idx
  }

  const effectsByVarObjParts: string[] = []
  for (const [varName, codes] of effectsByVar) {
    const indices = codes.map(c => ensureCode(c))
    const arr = indices.map(i => `_mjs_eff[${i}]`).join(', ')
    effectsByVarObjParts.push(`"${varName}": [${arr}]`)
  }
  // Effects sans var réactive (`{name}` non-réactif, ex: const locale `:=`) :
  // doivent tourner UNE FOIS au mount initial via _mjs_effectsAll, sans alias dans
  // _mjs_effectsByVar (jamais re-fired).
  const mountOnlyIndices: number[] = []
  for (const code of mountOnlyEffects ?? []) {
    mountOnlyIndices.push(ensureCode(code))
  }

  // Émet l'index des vars qui pilotent _mjs_renderStruct. Object lookup
  // est O(1). Si la struct est vide, on émet `null` pour signaler au runtime
  // de skip totalement _mjs_renderStruct (pas d'allocation).
  // Une var qui pose une prop sur un composant enfant y figure aussi, avec la valeur 2 : aucun bloc à redessiner (tout lecteur
  // compare à 1), mais la file des boucles la laisse passer à chaque écriture (`_mjs_invalidate`, mjs_element.ts) — la prop est de
  // l'état de l'enfant, une méthode de l'enfant appelée dans la boucle lit la valeur du tour. Sans bloc ni prop d'enfant : `null`
  const structEntries = struct.length === 0 ? [] : [...structVars].map(v => `"${v}":1`)
  for (const v of propVars) if (struct.length === 0 || !structVars.has(v)) structEntries.push(`"${v}":2`)
  const structVarsStr = structEntries.length === 0 ? 'null' : `{${structEntries.join(',')}}`

  // `µ._storeDeclare([...])` module-level (créé les accesseurs manquants,
  // idempotent) : TOUTES les clés $$ mentionnées par le module, lectures ET
  // écritures — un scan textuel du JS déjà compilé (post toutes réécritures
  // $$/deep-set/µread-µwrite) est plus robuste qu'un traçage site-par-site :
  // couvre uniformément lectures (`µ.store.x`), écritures top-level (idem,
  // accesseur), écritures profondes (`µ._mjs_storeDeepSet/'Call/'Delete('x', …)`),
  // suppressions (`µ._mjs_storeDelete('x')`) et accès bruts (`µ._mjs_storeRaw.x`, `µ._mjs_storeRawWrite.x`).
  // Fait à l'assemblage FINAL (jsInitWithEffects + tous les codes d'effects +
  // struct/trans) donc après TOUTES les passes de réécriture du pipeline.

  // Wrappe chaque code d'effect en `() => { code }`. Le tableau est exposé
  // sous le nom `_mjs_eff` (déclaré en tête du JS_INIT).
  const effectsArrayDecl = `const _mjs_eff = [${allEffectCodes.map(c => `() => { ${c} }`).join(', ')}];`
  const effectsAllStr = `_mjs_eff`
  const effectsByVarStr = `{${effectsByVarObjParts.join(', ')}}`

  // 11. JS init : modifiedCode du script + inlines
  //     On supprime le Proxy en transformant les écritures `$.x = y`
  //     en `µ._set(this, 'x', y)` (et computed wrappers en _mjs_setComputed).
  // Chaque passe rend AUSSI sa carte (cf. generator/pass-map.ts) : elles
  // sont accumulées dans l'ordre d'application, puis recomposées avec la carte du
  // compilateur de langage juste avant l'assemblage (source-map-chain.ts).
  const passMaps: (string | undefined)[] = []
  // `$x = $x`, `$$x = $$x` qu'une forme cache au lecteur, refusé par ces passes sans sa place : la valeur dérivée dit sa propre
  // écriture, la ligne vient de la carte du script, comme les avis plus bas (cf. locateScriptSelfAssignment)
  const scriptReject = (e: any, code: string): unknown => {
    if (!e?.mjsSelfWrite) return e
    const l = lineOf(code, e.mjsAt ?? 0)
    const line = scriptLineOf(lineStart(scriptJs, l)) ?? (scriptKeepsLines && !scriptSourceMap && script.startLine - 1 + l <= lastWrittenLine ? script.startLine - 1 + l : undefined)
    return locateScriptSelfAssignment(derivedSelfAssignment(e, analyzer?.computedDeps ?? {}), line, writtenScript, script.startLine, whereWritten.file)
  }
  const inputP1 = analyzer?.modifiedCode ?? scriptJs
  let _p1: ReturnType<typeof transformReactiveWritesMapped>
  try {
    _p1 = transformReactiveWritesMapped(inputP1)
  }
  catch (e) {
    throw scriptReject(e, inputP1)
  }
  passMaps.push(_p1.map)
  let jsInitBase = _p1.code
  // Path-tracking compile-time pour mutations profondes.
  // Doit s'appliquer APRÈS transformReactiveWrites (qui gère les top-level
  // $.x = y) — applyPathTracking ne traite que les depth >= 2.
  let _p2: ReturnType<typeof applyPathTrackingMapped>
  try {
    _p2 = applyPathTrackingMapped(jsInitBase, { withoutProxy: opts.proxy === false })
  }
  catch (e) {
    throw scriptReject(e, jsInitBase)
  }
  // réglage `proxy: false` : les écritures de l'état que le compilateur ne voit pas, à leur ligne du .mjs (les passes gardent les
  // lignes du script, cf. scriptLineOf ; un script en JavaScript n'a pas de carte : sa ligne est celle du texte écrit). Posées après la
  // lecture des gestionnaires, qui disent quelles variables restent simples (cf. simpleState)
  const noProxyNotices: { root: string, text: string }[] = []
  for (const a of _p2.notice ?? []) {
    const l = lineOf(jsInitBase, a.at)
    const line = scriptLineOf(lineStart(scriptJs, l)) ?? (scriptKeepsLines && !scriptSourceMap && script.startLine - 1 + l <= lastWrittenLine ? script.startLine - 1 + l : undefined)
    noProxyNotices.push({ root: a.root, text: t('transpiler.write-invisible-no-proxy', { moduleName, line: line, shape: a.shape, name: a.name, root: a.root }) })
  }
  passMaps.push(_p2.map)
  jsInitBase = _p2.code
  // précalcule les deps de chaque
  // µ.effect(callback) en AST, AVANT minification (cf. effect-deps.ts pour le
  // pourquoi : le scan runtime fn.toString() de mjs_runes.ts est cassé dès que
  // `$` est renommé par le minifieur). Doit s'appliquer APRÈS les 2 passes
  // ci-dessus (les $.x déjà réécrites en _mjs_deepSet/_mjs_deepCall ne doivent pas
  // être vues comme des lectures — même portée que l'ancien scan).
  // `analyzer.methodReads` : un `µeffect` qui APPELLE une méthode
  // (`this.fmt()`) hérite des lectures de CETTE méthode dans ses deps
  // précalculées, cf. effect-deps.ts. `analyzer.computedDeps` : un dérivé fondé sur une clé du store que
  // l'effet écrit y cède la place à ses racines (même fichier).
  // une racine µeffect.root ouverte dans un gestionnaire du gabarit appartient au composant (passe des gestionnaires, plus bas) : ses
  // reffets appellent aussi les fonctions du script (`lireY = -> $y`), dont les lectures sont alors notées pour le graphe des signaux,
  // même quand le script n'a aucun reffet à lui
  const templateRoots = inlines.some((c) => /(?<![\w$.])µ\.?effect\s*\.\s*root(?![\w$])/.test(c.toString()))
  const _p3 = annotateEffectDepsMapped(jsInitBase, analyzer.methodReads, analyzer.computedDeps, true, false, templateRoots, opts.reffetsAll === true)
  passMaps.push(_p3.map)
  jsInitBase = _p3.code
  // Correctif automatique `this` perdu (cf. this-rebinding.ts) — une flèche
  // fine (`->`) top-level NUE (pas une vraie méthode `@nom = -> ...`, pas une
  // `=>`) qui touche `this.x` (`@x`) ou `this._mjs_getRCtx`/`_mjs_setRCtx`/
  // `_mjs_getContext` (§/§§) et se fait appeler sans receveur (gabarit, alias,
  // imbrication) plantait silencieusement. Généralise `@@x` (déjà sûr,
  // `_mjsThis` capturé inconditionnellement dans init()) à TOUT accès `this.`
  // détecté à risque via l'AST — plus besoin que le dev le sache. Ordre : sans
  // importance vis-à-vis des 3 passes ci-dessus (nœuds ciblés disjoints des
  // `$.x`/`µ.effect(...)` qu'elles traitent), mais doit rester APRÈS elles pour
  // ne jamais réanalyser un JS qu'elles auraient encore à modifier.
  const _p4 = rebindDetachedThisMapped(jsInitBase)
  passMaps.push(_p4.map)
  jsInitBase = _p4.code
  // rendus d'une boucle regroupés (cf. loop-batch.ts) : une boucle qui écrit l'état ne redessine qu'à sa sortie. APRÈS
  // les quatre passes ci-dessus : elle reconnaît les écritures aux appels qu'elles ont posés
  const _p5 = batchLoopWritesMapped(jsInitBase)
  passMaps.push(_p5.map)
  jsInitBase = _p5.code
  // Ancre de la zone cartographiée : le texte du `<script>` DANS SON ÉTAT
  // de sortie des 4 passes. Tout ce qui s'y ajoute ensuite (tableau d'effets en tête,
  // gestionnaires inline en queue) est hors carte — on retrouve donc la position finale
  // en cherchant CETTE ancre dans le fichier produit, pas `jsInitBase` qui aura grossi.
  const mappedScriptAnchor = jsInitBase

  // Hook dupliqué — `_mjs_hook('mount', fn)` posé deux fois pour le MÊME nom de
  // hook (`µmount ->` écrit deux fois dans le <script>, idem µawake/µsleep/µdestroy/µfailed/
  // µurlChange) : au runtime, `_mjs_hooks[name] = fn` est un slot UNIQUE (mjs_element.ts,
  // `_mjs_hook`) — le second écrase le premier, SANS la moindre erreur ni avertissement. Détecté
  // ICI, sur le script déjà compilé (jsInitBase), AVANT tout ajout de bloc <routes>/router-aware
  // (qui n'émettent jamais `_mjs_hook`, sans incidence sur le compte).
  //
  // PERF (mesuré) : `sharedInitAst` parse jsInitBase UNE fois, réutilisé par detectDuplicateHook
  // ET detectRoutesReassignment juste en dessous — les deux lisent EXACTEMENT le même texte (rien
  // ne le modifie entre les deux appels). Pas réutilisable pour detectRouterAware, plus bas : si un
  // bloc <routes> existe, jsInitBase est PRÉFIXÉ avant cet appel-là (`this.routes = {...}` posé en
  // tête) — cet AST-ci serait alors périmé pour lui (repassé `undefined`, il re-parse).
  const sharedInitAst = parseScriptAst(jsInitBase)
  const dupHook = detectDuplicateHook(jsInitBase, sharedInitAst)
  if (dupHook) throw new Error(t('transpiler.hook-duplicate', { moduleName, hook: dupHook }))

  // Bloc(s) <routes target="…"> — table de routes FIXES, POSÉE en tête du JS d'init,
  // AVANT tout code issu du <script> : `detectRouterAware` (plus bas) doit voir
  // `this.routes` posé pour marquer le composant router-aware, et le script doit
  // pouvoir COMPLÉTER la table déjà posée (`@routes['cible']['/x'] = 'composant'`).
  // Si le script RÉASSIGNE `this.routes` (`@routes = …`), son assignation passe APRÈS celle du
  // bloc et remplace donc la table posée. Ce n'est PAS une erreur —
  // écraser tout ou partie de la table déclarative reste le droit du développeur. On le SIGNALE
  // (avertissement de compilation, non fatal), parce que l'écrasement est silencieux sinon.
  // Vérifié sur `jsInitBase` AVANT l'injection (sinon l'injection elle-même se
  // détecterait comme une réassignation).
  // Calculé ICI, inconditionnellement (avant, seulement si un bloc <routes> existait
  // déjà) : c'est la SEULE lecture de « le <script> du dev écrit-il @routes = … » qui ne soit
  // jamais polluée par l'injection du bloc juste en dessous (elle-même une affectation
  // `this.routes`, qui ferait sinon passer TOUT bloc <routes> pour une directive @routes).
  // Réutilisé par la garde .page.mjs, plus bas après detectRouterAware.
  const hasRoutesDirective = detectRoutesReassignment(jsInitBase, sharedInitAst)
  // les chemins que le script donne à `@routes` en toutes lettres ; `null` : il calcule la table, la construction ne sait pas quels liens elle
  // prend. Un relevé qui lève ne fait jamais échouer la compilation : la table compte alors pour calculée
  let routesScript: string[] | null = null
  // les vues que le script donne à `@routes` en toutes lettres : la construction refuse une route dont la vue n'existe nulle part
  let routeTargetsScript: string[] = []
  try {
    routesScript       = scriptRoutes(jsInitBase, sharedInitAst)
    routeTargetsScript = scriptRouteTargets(sharedInitAst)
  }
  catch {
    // relevé impossible : le contrôle des liens se tait
  }
  if (routesSections.length > 0) {
    if (hasRoutesDirective) {
      const routesWarning = typedLine('routes', t('transpiler.routes-script-reassigned'), opts.lint)
      if (routesWarning !== null) sections.warnings.push(routesWarning)
    }
    const routesObjParts = routesSections.map(rs => {
      const entriesStr = rs.entries.map(([path, comp]) => `${JSON.stringify(path)}: ${JSON.stringify(comp)}`).join(', ')
      return `${JSON.stringify(rs.target)}: {${entriesStr}}`
    })
    jsInitBase = `this.routes = {${routesObjParts.join(', ')}};\n${jsInitBase}`
  }

  // Statisation $$ — clés du store universel LUES par ce composant : union des
  // clés préfixées '$$x'/'$$*' qui ont atterri dans `effectsByVar` (templates),
  // `structVars` (if/for/key/await/attributs) ET désormais le <script> lui-même
  // (collectStoreReads, analyzer/index.ts : scan
  // LECTURE-SEULE dédié). Un `µeffect -> $$rt...` jamais mentionné
  // par le gabarit n'émettait AUCUNE ligne `_mjs_storeKeys` : `_mjs_storeSubscribe`
  // n'était jamais posé, `_mjs_storeNotifyKey` ne trouvait personne, l'effet ne
  // repartait JAMAIS sur écriture de la clé — panne muette totale. Dépréfixées
  // ('$$x'→'x', '$$*'→'*'). C'est exactement l'ensemble « ce composant doit se
  // réabonner à ces clés store » — un composant qui n'ÉCRIT que dans le store
  // (jamais ne LIT) n'a besoin d'aucune subscription (rien à invalider chez lui).
  //
  // Placé ICI (déplacé du calcul initial de structVarsStr plus haut) : le scan
  // du <script> exige `jsInitBase` dans son état FINAL de <script> — APRÈS
  // transformReactiveWrites/applyPathTracking/annotateEffectDeps/
  // rebindDetachedThis (les 4 passes juste au-dessus), AVANT que le router-aware
  // append et les handlers inline (assemblés à part, plus bas) n'y ajoutent du
  // code hors du périmètre visé ici (« les $$x lus dans le <script> »).
  const storeKeysSet = new Set<string>()
  for (const k of effectsByVar.keys()) if (k.startsWith('$$')) storeKeysSet.add(k.slice(2))
  for (const k of structVars) if (k.startsWith('$$')) storeKeysSet.add(k.slice(2))
  for (const k of collectStoreReads(jsInitBase)) storeKeysSet.add(k)
  const storeKeysLine = storeKeysSet.size === 0
    ? ''
    : `_mjsThis._mjs_storeKeys = ${JSON.stringify([...storeKeysSet])};`

  // Détection router-aware : si le script pose la rune `µurlChange (path, params) ->`
  // (compilée en `this._mjs_hook('urlChange', fn)`) et/ou déclare `@routes`, le
  // composant doit être enregistré dans µ.Router pour recevoir les notifications
  // de path. Marqué via this._mjs_is_router_aware.
  //
  // Analyse AST sur le JS post-compile (jsInitBase) plutôt que regex sur le
  // source Coffee/Civet : insensible aux strings, commentaires, template
  // literals. Cf. detectRouterAware pour le détail des deux motifs cherchés.
  // `sharedInitAst` réutilisable SEULEMENT si aucun bloc <routes> n'a préfixé jsInitBase
  // juste au-dessus (sinon perimé, cf. son bandeau) : `undefined` dans ce cas → re-parse.
  if (detectRouterAware(jsInitBase, routesSections.length > 0 ? undefined : sharedInitAst)) {
    jsInitBase += '\nthis._mjs_is_router_aware = true;'
    // Pages de la table (VALEURS du map `@routes`, ex. '/': 'home-page'), selon `routes.preload` : la page que le
    // routeur monte dans l'outlet <@view> est vue par le guetteur de l'ombre du composant (`subtree`), et le routeur la
    // demande aussi lui-même (bloc `routes-idle` de mjs_router.ts) ; les autres partent d'avance. 'on' : toutes
    // demandées au montage du composant, plus l'appel à liste vide ; 'idle' (défaut) : leur liste confiée au routeur, qui les
    // charge au repos après l'affichage ; 'off' : liste vide (rien d'avance) ; dans tous les modes, l'appel livre au cœur la
    // demande par le routeur, l'attente de la page suivante et la reprise d'un fichier raté (mjs_router.ts, mjs_autoloader.ts)
    const _mode           = opts.routesPreload ?? 'idle'
    let _idle: string[]   = []
    // la table lue à partir de son affectation quand le script en a une : une lecture écrite plus haut (`if (this.routes[p]) …`)
    // ne prend pas sa place, ni l'accolade qui suit cette lecture
    const _assign         = jsInitBase.search(/this\.routes\s*=[^=]/)
    const _ri             = _assign >= 0 ? _assign : jsInitBase.indexOf('this.routes')
    if (_ri >= 0) {
      const _open = jsInitBase.indexOf('{', _ri)
      if (_open >= 0) {
        let _depth = 0, _end = _open
        for (let _k = _open; _k < jsInitBase.length; _k++) {
          if (jsInitBase[_k] === '{') _depth++
          else if (jsInitBase[_k] === '}') { _depth--; if (_depth === 0) { _end = _k; break } }
        }
        const _comps = new Set<string>()
        for (const _m of jsInitBase.slice(_open, _end + 1).matchAll(/:\s*['"]([a-z][a-z0-9-]*)['"]/g)) {
          _comps.add(_m[1])
        }
        if (_mode === 'on') for (const _c of _comps) jsInitBase += `\nµ.Autoloader?.load?.('mjs-${_c}');`
        else _idle = _mode === 'off' ? [] : [..._comps]
      }
      jsInitBase += `\nµ._mjs_routesIdle?.(${JSON.stringify(_idle)});`
    }
  }

  // Un module qui déclare l'une des trois formes de
  // routage (bloc <routes>, directive @routes, balise <@view>) doit porter le marqueur
  // `.page.mjs` (cf. bundler/index.ts, isPageFile/pageAwareBaseName) : hors d'un tel fichier,
  // ces trois formes sont un refus de compilation. Placé ICI, après detectRouterAware ET après
  // la transformation <@view> (compileHtml plus haut) : les trois détections sont connues.
  // Priorité d'affichage si plusieurs formes coexistent (message singulier, cf. spec) : bloc,
  // puis directive, puis vue — ordre naturel du pipeline. `µurlChange` SEUL (sans aucune des
  // trois formes) N'EST PAS une forme visée par la règle : un composant peut y réagir (fil
  // d'Ariane, titre, analytics) sans être lui-même un module de page. `opts.isPageModule` vient
  // du bundler, déduit du VRAI nom de fichier (jamais reconstruit ici, cf. TranspileOpts) —
  // `undefined` (transpile()/transpileFile() appelés directement, tests, outillage) laisse la
  // garde INACTIVE : aucune régression pour un appelant qui ignore cette option.
  if (opts.isPageModule === false) {
    const shape = routesSections.length > 0 ? t('transpiler.page-shape-block-routes')
      : hasRoutesDirective ? t('transpiler.page-shape-directive-routes')
      : hasView ? t('transpiler.page-shape-view')
      : null
    // `moduleName` vient de
    // `pageAwareBaseName` (bundler/index.ts), qui ne retire le marqueur QUE s'il est écrit en
    // minuscules (comme `.theme`, sensible à la casse). Un fichier `x.PAGE.mjs` garde donc
    // `.PAGE` intact dans `moduleName` : une suggestion qui se contentait d'ajouter `.page.mjs`
    // au bout produisait un remède absurde (`x.PAGE.page.mjs`, la casse fautive PLUS un second
    // marqueur). On retire ici tout suffixe `.page` résiduel, n'importe quelle casse, un ou
    // plusieurs à la suite — copie fidèle de `canonicalPageBaseName` (bundler/index.ts) : même
    // règle, dupliquée à dessein (bundler/index.ts importe déjà ce module pour `transpile()`, un
    // import en sens inverse bouclerait le cycle pour trois lignes pures).
    let cleaned = moduleName
    while (/\.page$/i.test(cleaned)) cleaned = cleaned.replace(/\.page$/i, '')
    const suggestion = `${cleaned}.page.mjs`
    if (shape) throw new Error(t('transpiler.page-marker-missing', { moduleName, suggestion, shape: shape }))
  }

  // méthode du composant citée nue par un gestionnaire (cf. lintHandlerBareMethod) : ce que les
  // gestionnaires voient par closure — noms du `<script>`, du `<script module>` et leurs imports.
  // Ceux de <@window>/<@document>/<@body>/<@html> vivent dans le <script> compilé (`this._gl_x =
  // (e, _mjs_el) => …`, macros.ts) : même contrôle, gestionnaire par gestionnaire
  const visibleNames = analyzer.methodNames.size > 0
    ? new Set([...moduleTopVars, ...scriptVars, ...scriptConsts, ...collectImportNames(scriptAst), ...collectImportNames(moduleAst)])
    : null
  const bareMethodsSaid = new Set<string>()
  // la ligne citée du premier gestionnaire du HTML qui cite `nom` (`@click=nom`, `@click={ …nom… }`), partiels versés
  // compris (cf. citeHtmlLine : « 3 de _bas.mjs » dans un partiel) ; '' quand on ne le retrouve pas
  const htmlForLines = blankBraceStrings(maskCommentsInHtml(includedHtml), 'civet')
  const handlerLine = (name: string): number | string => {
    const id = name.replace(/\$/g, '\\$')
    const m  = new RegExp(`@[\\w.:-]+\\s*=\\s*(?:\\{[^}]*(?<![\\w$.@])${id}(?![\\w$])|${id}(?![\\w$]))`).exec(htmlForLines)
    return m ? citeHtmlLine(htmlForLines.slice(0, m.index).match(/\n/g)?.length ?? 0) : ''
  }
  // référence de gestionnaire faite d'un nom seul (`@click=nom`, `@click={nom}`, `@click=@nom`), dans le gabarit, dans le
  // fallback d'un <@failed> et sur les balises globales, dont le nom n'existe pas : refusée (cf. checkHandlerReferences), toutes les fautes du fichier d'un
  // coup, sans quoi le bouton est mort et la construction verte
  const handlerRefs = [...generatorState.handlerRefs, ...macros.handlerRefs]
  if (handlerRefs.length > 0) {
    checkHandlerReferences(handlerRefs, handlerNames, { imported: importedNames, module: new Set([...moduleTopVars, ...moduleVars]) }, new Set([...analyzer.methodNames, ...collectInstanceProps(scriptAst)]), moduleName)
  }
  if (visibleNames) {
    for (const stmt of ((scriptAst as any)?.body ?? []) as any[]) {
      const affect = stmt.type === 'ExpressionStatement' ? stmt.expression : null
      const target = affect?.type === 'AssignmentExpression' ? affect.left : null
      if (target?.type !== 'MemberExpression' || target.object?.type !== 'ThisExpression' || !/^_gl_/.test(target.property?.name ?? '')) continue
      if (affect.right?.type === 'ArrowFunctionExpression') lintHandlerBareMethod(scriptJs.slice(affect.right.start, affect.right.end), analyzer.methodNames, visibleNames, moduleName, bareMethodsSaid, opts.lint, colorsEnabled, handlerLine)
    }
  }

  // JS des gestionnaires du gabarit, pour le classement des valeurs dérivées (`opts.derived`) : ce qu'ils écrivent
  let handlersJs = ''
  // les mêmes, écritures de l'état réécrites (`µ._set(…)`) : qui écrit quoi (cf. simpleState)
  let writtenHandlers = ''
  // un gestionnaire écrit que Civet ne lit pas (vraie faute de syntaxe) : sa faute, dite sur le texte écrit, passe après les refus qui la
  // précèdent (nom seul, cf. checkHandlerReferences), à la place du lot des gestionnaires qui la disait
  const writtenFault = generatorState.inlineFaults.find((f) => f !== null)
  if (writtenFault) throw locateExpression(writtenFault, includedHtml, places, sections.htmlStartLine, moduleName, whereWritten)
  if (inlines.length > 0) {
    // Grammaire des handlers inline (`@click={…}`) : le generator émet un squelette Coffee-like (postfix if, if/then/else,
    // and/or/not/is…), compilé en Civet ci-dessous.
    // 'js' → repli historique, compilation Coffee brute, INCHANGÉE.
    //
    // Pas de `_mjsThis = @` ici : le template outer définit déjà
    // `const _mjsThis = this` accessible par closure. Une déclaration ici
    // créerait un `var _mjsThis` qui shadow le const outer (hoisted),
    // rendant undefined tous les µ._set(_mjsThis, ...) plus haut.
    const chunksInline = inlines.map(c => {
      const code = c.toString().trim()
      if (!code) return '  (e, _mjs_el) -> null'
      return code.split('\n').map(l => `  ${l}`).join('\n')
    })
    const inlinesSrc = '@_mjs_inline = [\n' + chunksInline.join('\n') + '\n]\n'

    // les noms du `<script module>` et du `<script>` que le batch peut voir par closure, et les
    // constantes de ces deux scripts — retirés des listes PAR GESTIONNAIRE, à hauteur des seuls
    // noms que le gabarit met VRAIMENT en portée de ce gestionnaire (variable et index d'un
    // `{for}` englobant, argument de branche `{await}`, `{const}` du bloc courant, cf.
    // `inlineLocals`). Ceux-là DOIVENT rester locaux : le squelette de reconstruction les
    // réassigne en tête de handler, et le `{const}` comme l'argument de branche n'existent pas
    // du tout dans son corps. Le retrait était GLOBAL au composant : un gestionnaire situé
    // AILLEURS subissait le même sort, Civet y déclarait une copie locale (`let number = 5`) et
    // l'écriture était silencieusement perdue — sans un mot, ni au build ni au clic. Même fuite
    // pour le contrôle de constance : un nom de gabarit sortait de la liste contrôlée, une `:=`
    // homonyme n'était plus refusée.
    const basePredeclared = [...moduleTopVars, ...scriptVars, ...scriptConsts]
    // une globale du navigateur qu'un gestionnaire affecte (`location = '#x'`, `onresize = f`) n'y est pas déclarée : son affectation agit,
    // sauf dans un gestionnaire à qui le gabarit donne ce nom (variable d'un `{for location in $l}` qui l'entoure)
    const pageGlobals = browserGlobals(inlinesSrc)
    const baseConsts = [...scriptConsts, ...moduleConsts]
    // les groupes se bâtissent sur les listes EFFECTIVES, pas sur les noms de gabarit : deux
    // gestionnaires qui ne divergent pas (aucun homonyme du `<script>`) ne compilent qu'une
    // fois — un composant sans collision garde donc UN groupe, et une sortie identique
    // `gabarit` : union des noms du gabarit en portée des gestionnaires du groupe — leur copie,
    // recréée en tête de gestionnaire, ne se réaffecte pas (cf. checkInlineHandlers)
    const groups = new Map<string, { predeclared: string[]; consts: string[]; indices: number[]; template: Set<string> }>()
    for (let i = 0; i < inlines.length; i++) {
      // filet : un gestionnaire sans locaux enregistrés retombe sur l'union globale
      // (l'ancien filtre), jamais sur « aucun local » — cela prédéclarerait la variable d'un
      // `{for}` et lui ferait écrire la var du `<script>` au lieu de l'item reconstruit
      const locals = new Set(i < inlineLocals.length ? inlineLocals[i] : templateLocals)
      const predeclared = [...basePredeclared, ...pageGlobals].filter(name => !locals.has(name))
      const consts = baseConsts.filter(name => !locals.has(name))
      const key = JSON.stringify([predeclared, consts])
      let group = groups.get(key)
      if (!group) {
        group = { predeclared, consts, indices: [], template: new Set() }
        groups.set(key, group)
      }
      group.indices.push(i)
      for (const name of locals) group.template.add(name)
    }
    const groupList = Array.from(groups.values())

    /** source d'un groupe — un seul groupe : le batch d'origine, inchangé. Plusieurs groupes
     * (un nom du gabarit recouvre un nom du `<script>`, donc des listes divergentes) : une
     * compilation par groupe et une écriture par INDEX dans `_mjs_inline` — l'index reste la
     * clé d'événement du tableau global, l'ordre de `inlines` est conservé. */
    const groupSource = (group: { predeclared: string[]; consts: string[]; indices: number[] }, first: boolean): string => {
      if (groupList.length === 1) return inlinesSrc
      const reset = first ? 'this._mjs_inline = []\n' : ''
      return reset + group.indices.map(i => {
        const lines = chunksInline[i].split('\n')
        // corps dé-indenté de 2 : la ligne d'affectation porte la flèche, le corps reste
        // strictement plus indenté qu'elle (Civet/Coffee lisent l'indentation)
        const body = lines.slice(1).map(l => l.slice(2)).join('\n')
        return `this._mjs_inline[${i}] = ${lines[0].trim()}\n${body}\n`
      }).join('')
    }

    const outputs: string[] = []
    // un `$$[k]` d'un gestionnaire, refusé par le lecteur sans sa ligne : situé dans le gabarit (cf. locateComputedKey)
    const readHandlers = (text: string): string => {
      try {
        return tokenize(text, { externalVars })
      }
      catch (e: any) {
        throw e?.mjsComputedKey ? locateComputedKey(e, includedHtml, places, sections.htmlStartLine, whereWritten) : e
      }
    }
    // la faute de Civet dans `lu`, le texte d'un lot de gestionnaires donné à l'adaptateur, ramenée au gestionnaire écrit parmi
    // `sources` (cf. locateHandler)
    const batchFailure = (err: any, read: string, sources: string[]): Error => {
      // Erreur orientante : le civet ParseError expose `.line` (1-indexé,
      // relatif à `lu` — exactement le texte qu'on vient de lui
      // soumettre, donc AUCUNE conversion d'offset nécessaire) — best-effort
      // seulement (le parser peut caler plus loin que la vraie faute quand il
      // tente de récupérer). On ajoute un indice ciblé quand un ternaire
      // COLLÉ (`a?b:c`, hors chaînes) traîne dans le batch : signature du
      // piège le plus fréquent (Coffee l'acceptait — silencieusement FAUX,
      // cf. tests — Civet le rejette).
      // la position du lot ramenée au gestionnaire écrit (cf. locateHandler)
      const located = locateHandler(String(err?.message ?? err), read, sources, includedHtml, places, sections.htmlStartLine, moduleName, whereWritten)
      const civetMsg = located?.message ?? err?.message ?? String(err)
      const lineNo = typeof err?.line === 'number' ? err.line : null
      const faultyLine = lineNo != null ? read.split('\n')[lineNo - 1] : null
      const lineHint = faultyLine != null
        ? t('transpiler.hint-line-civet', { line: located?.cite ?? lineNo, badLine: (located?.line ?? faultyLine).trim() })
        : ''
      // Filler NON-blanc (pas des espaces) : les branches d'un ternaire collé
      // sont typiquement des chaînes (`a?'x':'y'`) — un masquage espace-à-espace
      // ferait disparaître le caractère juste après le `?` (le guillemet),
      // rendant le motif `\?[^\s?.:]` aveugle à sa propre cible.
      const codeOnly = read.replace(MASK_STRINGS_AND_COMMENTS_RE, (m: string) => 'x'.repeat(m.length))
      const gluedTernaryHint = /\?[^\s?.:]/.test(codeOnly)
        ? t('generator.hint-ternary-glued')
        : ''
      return new Error(t('transpiler.handler-inline-failed-civet', { moduleName, lineHint, civetMsg, gluedTernaryHint }))
    }
    // le premier gestionnaire d'un groupe, avant celui de rang `avant` (tous sans lui), qui ne se compile pas seul (sa faute, citée à sa
    // place) ou qui avale un gestionnaire vide posé après lui (resté ouvert, refusé à son `}`) ; null quand chacun se compile seul. Sur le
    // seul chemin d'une faute : un lot qui échoue, qui compile en JavaScript illisible ou qui compte moins de gestionnaires qu'écrits — la
    // faute est celle du premier qui la porte, pas celle du voisin qu'il a pris
    const faulty = async (group: { predeclared: string[]; indices: number[] }, before = Infinity): Promise<unknown> => {
      const adapter = getAdapter('civet')
      const read    = (body: string): string => readHandlers(applyMjsSugarToScript(`@_mjs_inline = [\n${body}\n]\n`, 'civet', group.predeclared, '<script> (handlers)'))
      for (const i of group.indices) {
        if (i >= before) break
        const alone = read(chunksInline[i])
        let jsOnly: string
        try {
          jsOnly = (await adapter.compileToJs(alone, { fileName: `${moduleName}.inlines`, lint: opts.lint, colorsEnabled })).code
        }
        catch (err: any) {
          if (err instanceof ParamReadOtherwiseError) return err
          return batchFailure(err, alone, [generatorState.inlineSources[i]])
        }
        // seul, il compile en JavaScript illisible : la faute est la sienne, dite par le contrôle du groupe (cf. checkGroup)
        if (parseModuleAst(jsOnly) === null) return null
        let swallows = true
        try {
          swallows = compiledHandlers(parseModuleAst((await adapter.compileToJs(read(`${chunksInline[i]}\n  (e, _mjs_el) -> null`), { fileName: `${moduleName}.inlines`, lint: opts.lint, colorsEnabled })).code)) < 2
        }
        catch {
          // suivi d'un gestionnaire vide, il ne se compile plus : resté ouvert
        }
        const place = swallows ? handlerBrace(includedHtml, generatorState.inlineSources[i], places, sections.htmlStartLine, whereWritten) : null
        if (place) return handlerStaysOpen(place, generatorState.inlineSources[i])
      }
      return null
    }
    // le rang du gestionnaire où le lot `lu` situe sa faute (cf. locateHandler) : ceux d'avant lui peuvent l'avoir prise
    // (`{$k ?}` suivi d'un autre) ; Infinity quand il ne le dit pas
    const rankCite = (err: any, read: string): number => {
      const source = locateHandler(String(err?.message ?? err), read, generatorState.inlineSources, includedHtml, places, sections.htmlStartLine, moduleName, whereWritten)?.source
      const i      = source === undefined ? -1 : generatorState.inlineSources.indexOf(source)
      return i < 0 ? Infinity : i
    }
    // les contrôles du JavaScript d'un groupe (cf. checkInlineHandlers) ; illisible, il vient d'un gestionnaire resté ouvert qui
    // a pris son voisin : refusé à sa place (cf. fautif)
    const checkGroup = async (js: string, group: typeof groupList[number]): Promise<void> => {
      try {
        checkInlineHandlers(js, group.consts, moduleName, group.template)
      }
      catch (err) {
        throw (parseModuleAst(js) === null ? await faulty(group) : null) ?? err
      }
    }
    for (let k = 0; k < groupList.length; k++) {
      const group = groupList[k]
      const groupInlinesSrc = groupSource(group, k === 0)
      let groupInlinesJs: string
      // `applyMjsSugarToScript(…, 'civet')` sait déjà déclarer les vars nues
      // (`nom = expr` → `nom .= expr`, Pass 4 plus haut) pour une cible
      // non-Coffee, exactement comme pour un `<script>` civet classique — le
      // squelette du generator (assignations brutes `__idx_0 = …`, `item = …`)
      // n'a donc rien de spécifique à faire pour se déclarer proprement ici.
      const civetAdapter = getAdapter('civet')
      const inlinesProcessed = readHandlers(applyMjsSugarToScript(groupInlinesSrc, 'civet', group.predeclared, '<script> (handlers)'))
      lintHandlerSelfRefDeclaration(inlinesProcessed, moduleName)
      try {
        groupInlinesJs = (await civetAdapter.compileToJs(inlinesProcessed, {
          fileName: `${moduleName}.inlines`, lint: opts.lint, colorsEnabled, declareAssignments: true, knownNames: [...(group.predeclared ?? [])],
        })).code
      }
      catch (err: any) {
        // paramètre lu autrement par Civet : cité à la ligne du .mjs de la balise qui porte le gestionnaire
        if (err instanceof ParamReadOtherwiseError) {
          const batch = parseModuleAst(err.js)
          throw new ParamReadOtherwiseError(err.param, `${moduleName}.mjs`, err.js, batch ? inlineHandlerLines(generatorState.inlineLines)(err.param.offset, batch) : null, null)
        }
        throw (await faulty(group, rankCite(err, inlinesProcessed))) ?? batchFailure(err, inlinesProcessed, generatorState.inlineSources)
      }
      await checkGroup(groupInlinesJs, group)
      // en développement : une variable du gestionnaire dont le nom existe déjà dans la page le dit au clic
      outputs.push(opts.devWarnings ? warnAboutLocals(groupInlinesJs, generatorState.inlineSources, (i) => new Set(i < inlineLocals.length ? inlineLocals[i] : templateLocals), (name) => t('transpiler.handler-page-variable', { moduleName, name: name })) : groupInlinesJs)
    }
    // un seul groupe : le texte du batch d'origine, tel quel ; plusieurs : les blocs compilés
    // à part, recollés dans l'ordre des index (cf. groupSource)
    const inlinesJs = outputs.join('\n')
    handlersJs      = inlinesJs
    // même pipeline que le <script>, rebindDetachedThis COMPRISE — ferme
    // l'écart : la passe n'était câblée que sur jsInitBase, jamais sur les
    // handlers inline (assemblés à part ici) — une `function(){…}` explicite
    // dans un `@click={…}`, appelée détachée ou passée en callback anonyme, y
    // perdait son `this` pareillement (TypeError avalée par le dispatch
    // d'event DOM → clic silencieusement sans effet)
    // (les cartes de ces passes-ci ne sont pas chaînées : le bloc est APPENDÉ après la
    //  zone cartographiée du <script>, il n'a pas de source .mjs propre à pointer)
    // garde symboles réservés, cf. generator/reserved-symbols.ts
    lintReservedSymbolNames(inlinesJs, moduleName, '<script> (handlers)')
    // méthode du composant citée nue par un gestionnaire inline (cf. visibleNames plus haut)
    if (visibleNames) lintHandlerBareMethod(inlinesJs, analyzer.methodNames, visibleNames, moduleName, bareMethodsSaid, opts.lint, colorsEnabled, handlerLine)
    scanStoreArgs(inlinesJs, inlineHandlerLines(generatorState.inlineLines))
    // code mort dans un gestionnaire (cf. unreachable.ts) : à la ligne de la balise qui le porte — pas de
    // lecture du JavaScript quand `lint.unreachable` est coupé
    const inlinesAst = opts.lint?.unreachable === false ? null : parseModuleAst(inlinesJs)
    const handlerAt  = inlineHandlerLines(generatorState.inlineLines)
    // setTimeout / setInterval d'un gestionnaire : même refus, à la ligne de la balise qui le porte
    const timersAst = inlinesAst ?? parseModuleAst(inlinesJs)
    // un gestionnaire resté ouvert sur un opérateur (`@click={$x = 1 +}`) avale le suivant : le lot se compile sans faute, avec un
    // gestionnaire de moins, et chacun reçoit le code d'un autre. Compilés un à un (cf. fautif) : le premier qui échoue seul est refusé
    // comme le dernier du lot l'est (cf. locateHandler) ; celui qui se compile seul mais avale un gestionnaire vide posé après lui,
    // refusé à son `}`
    if (compiledHandlers(timersAst) < inlines.length) {
      for (const group of groupList) {
        const fault = await faulty(group)
        if (fault) throw fault
      }
    }
    rejectRawTimers(timersAst, offset => handlerAt(offset, timersAst!), moduleName, true, componentNames)
    warnUnreachableCode(inlinesAst, offset => handlerAt(offset, inlinesAst!), `${moduleName}.mjs`, opts.lint, colorsEnabled)
    // `$x = $x`, `$$x = $$x` d'un gestionnaire, refusé par ces passes sans sa ligne : situé dans le gabarit (cf. locateSelfAssignment)
    let writtenInlines: string
    let trackedInlines: ReturnType<typeof applyPathTrackingMapped>
    try {
      writtenInlines = transformReactiveWritesMapped(inlinesJs).code
      trackedInlines = applyPathTrackingMapped(writtenInlines, { withoutProxy: opts.proxy === false })
    }
    catch (e: any) {
      throw e?.mjsSelfWrite ? locateSelfAssignment(derivedSelfAssignment(e, analyzer?.computedDeps ?? {}), includedHtml, places, sections.htmlStartLine, whereWritten) : e
    }
    writtenHandlers = writtenInlines
    // réglage `proxy: false` : même avertissement, à la ligne de la balise qui porte le gestionnaire
    for (const a of trackedInlines.notice ?? []) noProxyNotices.push({ root: a.root, text: t('transpiler.write-invisible-no-proxy', { moduleName, line: handlerAt(lineStart(inlinesJs, lineOf(writtenInlines, a.at)), timersAst!) ?? undefined, shape: a.shape, name: a.name, root: a.root }) })
    jsInitBase += '\n' + batchLoopWritesMapped(rebindDetachedThisMapped(annotateEffectDepsMapped(trackedInlines.code, analyzer.methodReads, analyzer.computedDeps, false, true, false, opts.reffetsAll === true).code).code).code
  }
  // élément d'une boucle `{for}` sur une liste calculée, écrit par un gestionnaire : à la ligne de la balise (une fois)
  for (const b of new Map(generatorState.loopNotice.map((b) => [`${b.inline} ${b.name}`, b])).values()) {
    noProxyNotices.push({ root: b.root, text: t('transpiler.write-invisible-no-proxy', { moduleName, line: generatorState.inlineLines[b.inline], shape: 1, name: b.name, root: b.root }) })
  }
  // rappel de transition (`@introend`…) : à la ligne de la balise qui le porte (une fois)
  for (const r of new Map(generatorState.callbackNotice.map((r) => [`${r.line} ${r.shape} ${r.name} ${r.root}`, r])).values()) {
    noProxyNotices.push({ root: r.root, text: t('transpiler.write-invisible-no-proxy', { moduleName, line: r.line, shape: r.shape, name: r.name, root: r.root }) })
  }
  // une variable que le compilateur SAIT simple n'avertit pas : type chaîne, nombre ou booléen du <vars>, ou valeur simple à chaque
  // écriture du script et des gestionnaires (cf. simpleState) — sauf liée dans les deux sens (`=!{$x}`), qui peut recevoir autre chose
  if (noProxyNotices.length > 0) {
    const simpleNames = new Set([...varRules.simpleNames, ...simpleState([_p1.code, writtenHandlers])])
    for (const a of noProxyNotices) {
      const name  = a.root.slice(1)
      const bound = !varRules.simpleNames.includes(name) && new RegExp(`=!\\{\\s*\\$${name}(?![\\w$])`).test(sections.html ?? '')
      // un même avertissement à la même ligne (élément d'une boucle `{for}` relevé par le gabarit et par la passe des gestionnaires) : une fois
      if ((!simpleNames.has(name) || bound) && !sections.warnings.includes(a.text)) sections.warnings.push(a.text)
    }
  }

  // voie AST (post-Civet) : ferme le trou du gabarit (µimport niché
  // dans une interpolation ${…}/#{…}, y compris un template IMBRIQUÉ — un
  // simple CallExpression pour acorn, quelle que soit la profondeur) pour le
  // <script> composant — remplace l'ancienne réécriture par scanner
  // (rewriteMuImport, retirée d'applyMjsSugarToScript). APRÈS la DERNIÈRE
  // mutation de `jsInitBase` (rebind des handlers inline juste au-dessus,
  // router-aware plus haut) — AVANT jsInitWithEffects/jsInitI18n, qui le
  // dérivent tous deux.
  jsInitBase = rewriteMuImportAst(jsInitBase, '<script>')

  // mise à jour fine : la table des variables lues champ par champ ; les listes retenues passent à leur fermeture gardée par les
  // masques (cf. tableFine). Après la dernière écriture du script et des gestionnaires, avant que la passe de structure ne soit lue
  const fine = tableFine(jsInitBase, struct, trans, effectsByVar, codeToFnIdx, generatorState.fineLists, propVars)
  if (fine.struct !== struct) struct.splice(0, struct.length, ...fine.struct)

  // `µderived $x = expr, $a` que le composant écrit : la table de ses dépendances nommées, posée en tête de `init` (avant toute
  // valeur dérivée et tout gestionnaire), lue à l'écriture par le runtime (`_mjs_computedSrc`, mjs_element.ts) — le choix tient
  // jusqu'à l'écriture de l'une d'elles. Aucune `µderived` écrite : rien n'est ajouté, le code produit ne change pas
  const chosen = analyzer && analyzer.derivedCandidates.some((k) => k.named) ? chosenDerived(scriptAst, analyzer.derivedCandidates, handlersJs) : null
  if (chosen) jsInitBase = `this._mjs_computedSrc = ${chosen};\n${jsInitBase}`

  // 12. Métadonnées class / tag.
  //
  // V2 — plus de `parentClass` Int/BigInt : `µ.Element` est la base unique
  // (plus de bitmask, plus de limite 31 vars). Le runtime utilise
  // `_mjs_effectsByVar[k]` directement, sans dépendre du nombre de state vars.
  const className = buildClassName(moduleName)
  const tagName = `mjs-${moduleName.toLowerCase()}`

  // Auto-déclaration des refs DOM `@this=!{nom}` à variable NUE (cf.
  // `state.refVars`) : on hisse `let nom;` tout en tête de `init` (avant
  // `_mjs_eff` et le script) pour celles que le script ne déclare pas déjà.
  // Sans ça, le binding `nom = node` + la lecture `nom.x` dans le script
  // référencent une variable jamais déclarée → ReferenceError. Dédup : on ne
  // déclare pas si une `let/var/const nom` existe déjà dans le JS du script.
  // Le nom n'a pas à suivre IMMÉDIATEMENT `let/var/const` : Coffee émet
  // ses déclarations GROUPÉES et triées alpha (`var a, zcanvas;`) ; exiger
  // `\s+nom` juste après le mot-clé ratait `zcanvas` (2ᵉ du groupe) → `let
  // zcanvas;` hoisté au-dessus d'un `var a, zcanvas;` = « already declared » au
  // chargement. On tolère donc une LISTE `[^;=\n]*` entre le mot-clé et le nom,
  // MAIS bornée à `=`/`;`/`\n` : ça reste côté GAUCHE de l'affectation — un
  // `let context = canvas.getContext()` (canvas à DROITE du `=`) ne fait donc
  // toujours pas un faux positif (le `[^;=]` s'arrête au `=`).
  // les noms que la racine du script déclare, lus sur son arbre (cf. rootNames : `var` d'un bloc compris) — le texte du script,
  // lui, porte aussi ses chaînes et les variables de ses fonctions : `'let the champ rest'` ou un `champ` local passaient pour la
  // déclaration, la référence n'était pas déclarée et son premier rendu levait « champ is not defined »
  const declaredAtRoot = new Set(rootNames(scriptAst))
  const refDecls = Array.from(generatorState.refVars)
    .filter(name => !declaredAtRoot.has(name))
    .map(name => `let ${name};`)
  const refDeclsStr = refDecls.length ? refDecls.join(' ') + '\n' : ''

  // Injecte la déclaration `const _mjs_eff = [...]` en tête du jsInitBase.
  // Toutes les arrow functions y vivent ; `_mjs_effectsByVar` et `_mjs_effectsAll`
  // référencent les indices.
  const jsInitWithEffects = `${refDeclsStr}${effectsArrayDecl}\n${jsInitBase}`

  // Statisation $$ — `µ._storeDeclare([...])` module-level : scan du JS FINAL
  // (post toutes les réécritures $$/deep-set/µread-µwrite) pour les clés $$
  // que ce module lit par l'accesseur (`µ.store.x`, `µ._mjs_storeRaw.x`), ou écrit par `µwrite $$x, v`
  // (`µ._mjs_storeRawWrite.x`, qui ne déclare pas la clé, à la différence de `µ._storeSet`). Une
  // écriture pure n'a pas à y figurer : `µ._storeSet` déclare lui-même la clé
  // qui lui manque, et une écriture, un appel ou une suppression en profondeur
  // (`µ._mjs_storeDeepSet`…) ne font rien sans valeur à la racine — déclarée
  // ou non. '*' si le module énumère le store
  // BRUT quelque part (Object.keys(µ.store), for…in, spread) — même clé que
  // '$$*' côté effectsByVar/structVars, mais `_storeDeclare` n'a rien à en
  // faire hors registre de présence (l'accesseur '*' n'existe pas, ignoré
  // silencieusement côté runtime — cf. doute signalé au rapport). `µ` échappé (`\u00B5.store.x`) lu comme `µ`.
  const storeDeclareScan = unescapeMu(`${jsInitWithEffects}\n${allEffectCodes.join('\n')}\n${struct.join('\n')}\n${trans.join('\n')}`)
  scanStoreArgs([...allEffectCodes, ...struct, ...trans])
  const storeDeclareKeys = new Set<string>()
  for (const m of storeDeclareScan.matchAll(/µ\.store\.([a-zA-Z_$][\w$]*)/g)) storeDeclareKeys.add(m[1])
  for (const m of storeDeclareScan.matchAll(/µ\._mjs_storeRaw(?:Write)?\.([a-zA-Z_$][\w$]*)/g)) storeDeclareKeys.add(m[1])
  const storeDeclareLine = storeDeclareKeys.size === 0
    ? ''
    : `µ._storeDeclare(${JSON.stringify([...storeDeclareKeys])});`

  // i18n — réécriture compile-time des clés `µ.t(...)` (cf. applyI18nPrefixing
  // plus haut) : mêmes zones que storeDeclareScan ci-dessus (script+handlers+
  // effets, blocs structurels, transitions), cette fois RÉÉCRITES et non plus
  // seulement scannées. `_mjs_i18n` émis si le module a @i18n OU appelle µ.t(
  // (post-réécriture — la présence du marqueur survit toujours à la réécriture).
  const i18nSection = dir.moduleI18nSection
  const i18nMore = dir.moduleI18nExtraSections
  const i18nMode = dir.moduleI18nPlaceholder
  const i18nFx   = dir.moduleI18nPlaceholderFx
  // les clés écrites en dur, relevées au passage pour le contrôle i18nKeyUnknown (cf. transpiler/build-checks.ts)
  const i18nKeysSeen: I18nKeySeen[] = []
  const jsInitI18n = applyI18nPrefixing(jsInitWithEffects, i18nSection, i18nMode, i18nMore, i18nKeysSeen)
  const structI18n = struct.map(u => applyI18nPrefixing(u, i18nSection, i18nMode, i18nMore, i18nKeysSeen))
  const transI18n = trans.map(u => applyI18nPrefixing(u, i18nSection, i18nMode, i18nMore, i18nKeysSeen))
  // même réécriture i18n que struct/trans ci-dessus (une liaison
  // two-way vers un enfant peut très bien vivre sous @i18n, cf. le repro).
  const initialPropBindsI18n = initialPropBinds.map(u => applyI18nPrefixing(u, i18nSection, i18nMode, i18nMore, i18nKeysSeen))
  // le <script module> aussi : la section vaut pour toutes les clés du composant ; préfixé avant le relevé des contrôles, qui lit ses clés
  const moduleJsI18n = applyI18nPrefixing(moduleJs, i18nSection, i18nMode, i18nMore, i18nKeysSeen)
  const hasI18nCalls = MU_T_CALL_RE.test(jsInitI18n) ||
    structI18n.some(u => MU_T_CALL_RE.test(u)) ||
    transI18n.some(u => MU_T_CALL_RE.test(u))
  // la ligne d'instance : [section, mode, sections en plus, réglages de l'effet d'attente] — un élément n'est écrit que si un autre le suit
  const i18nInstance: unknown[] = [i18nSection, i18nMode]
  if (i18nMore.length > 0 || i18nFx) i18nInstance.push(i18nMore.length > 0 ? i18nMore : null)
  if (i18nFx) i18nInstance.push(i18nFx)
  const i18nLine = (i18nSection !== null || hasI18nCalls)
    ? `_mjsThis._mjs_i18n = ${JSON.stringify(i18nInstance)};`
    : ''

  // Piège Shadow DOM (@font-face/@import silencieusement inertes en
  // adoptedStyleSheets, cf. cssTrapWarnings) : scanné sur le CSS déjà
  // COMPILÉ (pas le SASS source) pour ne jamais se faire piéger par un
  // @import SASS (résolu ici même, jamais présent dans le résultat).
  // THÈMES + passe `$$` — un `$$brand` devient `var(--<varPrefix>-brand)`
  // partout dans un contexte de style, et chaque bloc `<theme>` devient un paquet de
  // custom properties posé sur l'hôte. Deux points non négociables :
  //   · la passe tourne AVANT dart-sass (`$$x` ne parse pas en SASS) ;
  //   · le sélecteur est DOUBLE — `:where(:host, mjs-x)` matche dans le shadow (`:host`)
  //     ET dans le document en mode `mjs-light` (le tag), la liste indulgente de
  //     `:where()` ignorant l'item invalide de chaque côté (vérifié sur FF + Chromium).
  // Déclarer une variable de thème dans le bloc de base FIGE cette variable pour le composant et
  // toute sa descendance : une déclaration posée sur l'élément bat toujours une valeur héritée.
  const varPrefix = opts.varPrefix ?? 'mjs'
  const themeVars: ThemeVar[] = []
  const varsRead: string[] = []
  // `$x` ADOSSÉ à `$$x` — un `$$x` du <theme> de BASE expose aussi son
  // nom au SASS : si un <style> lit `$x` sans l'avoir déclaré lui-même, on lui pose la valeur en
  // préambule. C'est ce qui manquait aux trois pièges muets (`@each`, `@if`, fonctions
  // de couleur) : ce que le build doit parcourir ou comparer redevient une donnée du build.
  //   · valeur figée à la DÉCLARATION du bloc de base — une surcharge d'exécution (thème nommé,
  //     `&.chaud`, thème de document) ne la change pas ; ça reste `$$x` pour ce qui doit vivre ;
  //   · seul le bloc SANS nom nourrit le préambule (une variante ne vaut que quand elle est active) ;
  //   · une variable déclarée dans le <style> lui-même garde TOUJOURS la main, on ne la double pas ;
  //   · rien d'émis quand le nom n'est pas lu — pas de variable SASS fabriquée pour rien.
  const themeLiterals = new Map<string, string>()
  // taille du texte en px rendue adaptable à l'écran (cf. transpiler/font-size) : les `<theme>`, le `<style>` et ses déclinaisons
  const fontSizes = new Set<string>()
  const fluidText = (css: string): string => {
    if (!opts.responsiveFontSize) return css
    const r = rewriteFontSizes(css, opts.responsiveFontSize)
    for (const v of r.sizes) fontSizes.add(v)
    return r.css
  }
  let themeCss = ''
  for (const th of sections.themes) {
    const sel = th.name === ''
      ? `:where(:host, ${tagName})`
      : `:where(:host([theme='${th.name}']), ${tagName}[theme='${th.name}'])`
    const rw = rewriteStyleVars(th.raw, { prefix: varPrefix })
    for (const d of rw.declared) themeVars.push({ name: d.name, variant: th.name, line: d.line, doc: d.doc })
    // rootDecl et NON declared : une déclaration posée sous un sélecteur du <theme> (`&.chaud`)
    // est une surcharge CONDITIONNELLE — la figer au build donnerait la couleur de la variante à
    // tout le monde, en silence (défaut connu)
    if (th.name === '') for (const d of rw.rootDecl) if (d.value !== '') themeLiterals.set(d.name, d.value)
    for (const r of rw.read) if (!varsRead.includes(r)) varsRead.push(r)
    themeCss += fluidText(compileCss(wrapThemeBlock(sel, rw.code, th.lang), th.lang))   // un bloc = un lang, jamais mélangés
  }
  // syntaxe unifiée : `$$x: valeur` en tête de ligne SURCHARGE ici aussi (émis en `--mjs-x`),
  // le préfixe n'est plus à écrire à la main — les déclarations d'un <style> partent au
  // registre par le scan du CSS compilé (bundler, scanDeclaredVars), pas par cette liste
  const styleRw = rewriteStyleVars(style.raw, { prefix: varPrefix })
  if (styleRw.rootDecl.length > 0) throw new Error(t('transpiler.variable-root-no-selector', { name: styleRw.rootDecl[0].name, line: styleRw.rootDecl[0].line, block: '<style>' }))
  if (styleRw.misplaced.length > 0) throw new Error(t('transpiler.variable-mid-line', { name: styleRw.misplaced[0].name, line: styleRw.misplaced[0].line, block: '<style>' }))
  for (const r of styleRw.read) if (!varsRead.includes(r)) varsRead.push(r)
  // préambule SASS des `$x` adossés (cf. themeLiterals plus haut) : une ligne par nom, en tête du
  // bloc — SASS exige la déclaration AVANT l'usage, et la syntaxe indentée refuse deux instructions
  // sur une ligne. Le CSS pur n'a pas de variables de build : rien n'y est injecté
  // `@use`/`@forward`/`@charset` doivent rester en TÊTE de feuille (dart-sass : « @use rules must be
  // written before any other rules ») : le préambule se glisse APRÈS eux, jamais devant
  const afterHeader = (code: string): number => {
    const lines = code.split('\n')
    let cut = 0
    for (let n = 0; n < lines.length; n++) {
      const l = lines[n].trim()
      if (l === '' || l.startsWith('//') || l.startsWith('/*')) continue
      if (/^@(use|forward|charset)\b/.test(l)) { cut = n + 1; continue }
      break
    }
    return cut
  }
  const withSassPreamble = (rw: { code: string, sassRead: string[], sassDeclared: string[] }, lang: 'css' | 'sass' | 'scss'): string => {
    if (lang === 'css') return rw.code
    const names = rw.sassRead.filter(n => themeLiterals.has(n) && !rw.sassDeclared.includes(n))
    if (names.length === 0) return rw.code
    const preamble = names.map(n => `$${n}: ${themeLiterals.get(n)}${lang === 'scss' ? ';' : ''}`)
    const lines = rw.code.split('\n')
    lines.splice(afterHeader(rw.code), 0, ...preamble)
    return lines.join('\n')
  }
  // une balise qui porte `hidden` est cachée, comme une balise HTML : le `:host{display}` posé à tout composant (cf. injectTemplate) passait
  // devant la règle du navigateur. Un composant qui déclare une prop `hidden` (sans la casse, comme l'attribut) la garde pour lui :
  // `<@@chart hidden>` masque des séries, pas le graphique. `hidden="until-found"` reste au navigateur, comme sur une balise HTML : il cache le contenu
  // sans retirer la balise de la page, et sa recherche le trouve et le révèle. Dans le style de base, que le rechargement du CSS à chaud reprend tel quel
  const hiddenCss = Object.keys(analyzer?.varBitsDict ?? {}).some((v) => v.toLowerCase() === 'hidden') ? '' : ':host([hidden]:not([hidden=until-found i])){display:none}'
  // `@offscreen` (generator/attributes) : une règle par place réservée, dans le style de base — l'ombre, le mode léger, le rendu serveur et le
  // rechargement du CSS à chaud la reçoivent avec lui ; aucune sans `@offscreen`
  const offscreenCss = [...generatorState.offscreen].map((size) => `[mjs-offscreen="${size}"]{content-visibility:auto;contain-intrinsic-size:auto ${size}}`).join('')
  // `@size` (generator/attributes, cf. sizeCss) : une règle par place gardée, au même endroit ; aucune sans `@size`
  const sizesCss     = sizeCss(generatorState.sizes)
  const baseCss      = themeCss + hiddenCss + offscreenCss + sizesCss + fluidText(compileCss(withSassPreamble(styleRw, style.lang), style.lang))

  // DÉCLINAISONS (`<style name="bandeau">`) — compilées comme le style de base, mais SORTIES
  // du composant : le build les écrit dans un fichier frère que le runtime ne va chercher que
  // si un `layout="bandeau"` apparaît. C'est là que le chargement à la demande a du sens — une
  // déclinaison de forme pèse des kilo-octets de règles, là où une déclinaison de couleurs
  // tient dans quelques variables de thème embarquées.
  const layoutCss: Record<string, string> = {}
  for (const ly of layouts) {
    const rw = rewriteStyleVars(ly.raw, { prefix: varPrefix })
    if (rw.rootDecl.length > 0) throw new Error(t('transpiler.variable-root-no-selector', { name: rw.rootDecl[0].name, line: rw.rootDecl[0].line, block: `<style name="${ly.name}">` }))
    if (rw.misplaced.length > 0) throw new Error(t('transpiler.variable-mid-line', { name: rw.misplaced[0].name, line: rw.misplaced[0].line, block: `<style name="${ly.name}">` }))
    for (const r of rw.read) if (!varsRead.includes(r)) varsRead.push(r)
    layoutCss[ly.name] = fluidText(compileCss(withSassPreamble(rw, ly.lang), ly.lang))
  }
  // les modèles du HTML seul : chaque nom comparé à µlayout (`µlayout is 'timer'`, `'timer' == µlayout`,
  // `switch µlayout` et ses `when`, `['mini', 'micro'].includes(µlayout)`) — connus comme un style nommé,
  // mais sans style à charger (valeur vide : ni fichier ni requête). Le script est lu sur son AST, le
  // HTML sur le code de ses accolades
  if (muLayout) {
    const found = layoutNamesInScript(scriptAst)
    const cmp   = `(?:===?|!==?|\\bisnt\\b|\\bis\\s+not\\b|\\bis\\b)`
    const re    = new RegExp(`µlayout\\s*${cmp}\\s*(['"])([A-Za-z][\\w-]*)\\1|(['"])([A-Za-z][\\w-]*)\\3\\s*${cmp}\\s*µlayout|\\[([^\\[\\]]*)\\]\\s*\\.\\s*(?:includes|indexOf)\\s*\\(\\s*µlayout\\s*\\)`, 'g')
    let mc: RegExpExecArray | null
    while ((mc = re.exec(codeHtml)) !== null) {
      if (mc[5] === undefined) found.push(mc[2] ?? mc[4])
      else for (const m of mc[5].matchAll(/(['"])([A-Za-z][\w-]*)\1/g)) found.push(m[2])
    }
    for (const name of found) {
      if (/^[A-Za-z][\w-]*$/.test(name) && name !== 'default' && !(name in layoutCss)) layoutCss[name] = ''
    }
  }
  const cssWarnings = cssTrapWarnings(baseCss, opts.lint)

  // relevé des contrôles de construction (attributs lus et visés, balises du projet, clés µt, liens et routes), croisé par le bundler ;
  // les partiels inclus en font partie (leur gabarit est dans `html`, leur style dans `style.raw`)
  // un relevé qui lève ne fait jamais échouer la compilation : le composant n'est pas contrôlé, ni les liens du projet (cf. runBuildChecks)
  let checks: BuildChecks | undefined
  try {
    checks = collectBuildChecks({
      source:        writtenSource,
      texts:        [...includeAcc.script, ...includeAcc.module],
      html,
      hostHtml,
      htmlStartLine: sections.htmlStartLine,
      script:        { code: writtenScript, line: script.startLine },
      moduleCode:    moduleSection.raw,
      styles:        [style.raw, ...layouts.map(l => l.raw)],
      stateVars:     analyzer?.stateVars ?? [],
      tags:          projectTags,
      links:         linksSeen,
      keys:          i18nKeysSeen,
      routes:        routesSections.flatMap(rs => rs.entries.map(([path]) => path)),
      scriptRoutes:  routesScript,
      scriptRouteTargets: routeTargetsScript,
      views:         templateViews(html),
      routeTargets:  routesSections.map(rs => ({ name: rs.target, line: rs.line ?? 1 })),
    })
  }
  catch {
    // relevé impossible : rien n'est croisé pour ce composant
  }

  const data: TranspileData = {
    scriptSourceMap,
    moduleSourceMap,
    moduleName,
    className,
    tagName,
    varBitsStr: analyzer?.toJsDict() ?? '{}',
    computedDepsStr: serializeComputedDeps(analyzer),
    createFnBody: createFnBody.body,
    noRefs: createFnBody.refIds.length === 0,
    events,
    passiveEvents,
    surgicalHtml: surgicalHtmlWithMarkers,
    structUpdates: structI18n,
    transUpdates: transI18n,
    effectsByVarStr,
    effectsAllStr,
    fineLine: fine.line || undefined,
    initialPropBindsStr: initialPropBindsI18n.join('\n'),
    structVarsStr,
    storeKeysLine,
    storeDeclareLine,
    typesDecl: (varRules.vars.length > 0 ? `\nconst _mjs_T_${className} = {${varRules.vars.join(',')}};` : '') + (varRules.stores.length > 0 ? `\nµ._mjs_storeTypes({${varRules.stores.join(',')}});` : ''),
    typesLine: varRules.vars.length > 0 ? `\n    this._mjs_types = _mjs_T_${className};` : '',
    aliasLine: opts.proxy === false ? aliasLineOf(stateAliases([_p1.code, writtenHandlers])) : '',
    storeTypes: varRules.storeTypes,
    usesNamedTypes: varRules.usesNamedTypes,
    usesProjectEffects: generatorState.usesProjectEffects || macros.usesProjectEffects,
    stateMethodClashLine,
    i18nLine,
    jsModule: moduleJsI18n,
    jsInitBase: jsInitI18n,
    baseCss,
    themeVars,
    varsRead,
    checks,
    themeVariants: sections.themes.map(th => th.name).filter(n => n !== ''),
    layoutCss,
    fontSizes: [...fontSizes].sort((a, b) => Number(a) - Number(b)),
    layoutRune: muLayout,
    sharedCssNames: sections.style.sharedCssNames,
    moduleDisplay: sections.style.moduleDisplay,
    modulePreload: dir.modulePreload,
    moduleFormAssociated: dir.moduleFormAssociated,
    moduleViewTransition: sections.style.moduleViewTransition,
    moduleViewTransitionPriority: sections.style.moduleViewTransitionPriority,
    hasDynamicSlots,
    usedAnimations: Array.from(generatorState.usedAnimations),
    unnamedSettingAnimations: Array.from(generatorState.unnamedSettingAnimations),
    // un `{for}` imbriqué coupe aussi le mode direct de la réconciliation (cf. compileFor), sans toucher à la pose initiale des lignes
    hasDestroyHooks: generatorState.hasDestroyHooks || generatorState.hasNestedFor,
    hasFlip: generatorState.hasFlip,
    includedPartials: [...includeAcc.resolved, ...(includeAcc.absents ?? [])],
    macroErrors: [...includeAcc.errors, ...macros.errors],
    tagRefs: [...tagRefs, ...macros.tagRefs],
    sectionWarnings: [...sections.warnings, ...includeAcc.warnings, ...cssWarnings, ...macros.warnings, ...pseudoClashWarnings(html, opts.lint), ...settingWarnings(html, opts.lint)],
    aliasTag: opts.aliasTag,
    componentDeps,
  }

  const output = injectTemplate(data, dirInject)

  // Carte de source du fichier produit. Trois recollages successifs :
  //   1. `chainSourceMaps` compose la carte du compilateur de langage (déjà décalée
  //      sur la ligne du bloc `<script>` dans le `.mjs`) avec celles des 4 passes ;
  //   2. `shiftGeneratedPosition` la déplace là où `jsInitBase` a réellement atterri
  //      dans le squelette de classe — position LUE dans le texte produit, jamais
  //      recalculée à la main (le squelette peut changer sans casser la carte) ;
  //   3. `finalizeSourceMap` nomme la source et y embarque le `.mjs` d'origine (jamais
  //      servi au navigateur : sans son contenu embarqué, la carte serait inutilisable).
  // Hors périmètre assumé : le `<script module>` (code de MODULE, hors de la classe) et
  // les gestionnaires inline, appendés après la zone cartographiée.
  let sourceMap: string | undefined
  const chained = chainSourceMaps(scriptSourceMap, passMaps)
  if (chained && mappedScriptAnchor.length > 8) {
    let idx = output.indexOf(mappedScriptAnchor)
    // sous @i18n ou avec µimport, le script est encore réécrit après la prise de l'ancre (clés préfixées, appel µimport) :
    // l'ancre passe par les mêmes réécritures (ses lignes ne bougent pas, la carte reste juste à la ligne) ; une ancre
    // toujours introuvable laisse le composant sans carte, comme avant
    if (idx < 0) {
      try {
        idx = output.indexOf(applyI18nPrefixing(rewriteMuImportAst(mappedScriptAnchor, '<script>'), i18nSection, i18nMode, i18nMore))
      }
      catch {
        idx = -1
      }
    }
    if (idx >= 0) {
      const before  = output.slice(0, idx)
      const genLine = before.split('\n').length - 1
      const genCol  = idx - (before.lastIndexOf('\n') + 1)
      sourceMap = finalizeSourceMap(shiftGeneratedPosition(chained, genLine, genCol), `${moduleName}.mjs`, `${moduleName}.js`, content)
    }
  }
  // `µrefresh($x)` (µ._mjs_refresh, sigils.ts), du script comme des gestionnaires, sur le texte fini : une variable `$` que le
  // composant déclare ; ni une valeur dérivée (elle se refait d'elle-même), ni un nom qu'il ne déclare pas (le signal ne
  // toucherait rien), ni un singleton importé (`µrefresh(µ$$x)`, lu `$x` depuis la pré-passe 0-bis) : refusé par le message de
  // la forme, qui dit quoi écrire
  if (analyzer) {
    for (const m of output.matchAll(/µ\._mjs_refresh\(_mjsThis, (['"])([A-Za-z_$][\w$]*)\1\)/g)) {
      const name = m[2]
      if (analyzer.computedDeps[name] !== undefined) {
        throw new Error(t('transpiler.rune-refresh-derived', { name: name, shape: `µrefresh($${name})` }))
      }
      if (!analyzer.stateVars.includes(name)) throw externalVars.includes(`$${name}`) ? refreshShapeError() : new Error(t('transpiler.rune-refresh-unknown', { name: name }))
    }
  }
  // le repère de chaque appel de µload (cf. load-sites.ts), posé sur le texte fini : la carte se recompose par-dessus
  const sitesLoad = loadSites(output, moduleName)
  if (sitesLoad.map && sourceMap) sourceMap = chainOverMap(sitesLoad.map, sourceMap)
  // la valeur dérivée qui attend (cf. await-derived.ts), posée sur le même texte ; ses refus citent leur ligne du fichier tel qu'écrit,
  // gabarit compris, et leur conseil suit la langue du script
  const sites = awaitDerived(sitesLoad.code, moduleName, opts.devWarnings === true, { moduleName, first: 1, lines: whereWritten.lines(), lang: script.lang, wholeFile: true }, script.lang, generatorState.boundFields, generatorState.awaitBlocks)
  if (sites.map && sourceMap) sourceMap = chainOverMap(sites.map, sourceMap)

  // classement des valeurs dérivées (`mjs check --derived`), seulement sur demande : le code produit n'en dépend pas
  if (opts.derived) {
    data.derivedClasses = classifyDerived({ script: scriptAst, module: moduleAst, candidates: analyzer.derivedCandidates, moduleVars, externalVars, imports: collectImportNames(moduleAst), handlers: handlersJs, refs: [...generatorState.refVars], trackMethods: opts.derivedMethods === true, raw: RAW_WRITE.test(writtenSource) })
  }

  // les options de la forme appelable lues sur l'arbre du code compilé (cf. ajaxOptionsOnTree) ; sur le même arbre, un `µajax`
  // réécrit dans un texte (regex étendue sur plusieurs lignes, chaîne écrite dans une interpolation) : averti à sa place, le code
  // produit ne change pas
  const asText = ajaxRewrites.length > 0 ? [] as number[] : undefined
  const code   = ajaxOptionsOnTree(sites.code, asText)
  if (asText && asText.length > 0) {
    for (const position of ajaxPlacesAsText(sites.code, asText, ajaxRewrites, whereWritten.file, whereWritten.lines, o => sourceLineOf(sites.code, sourceMap, o))) {
      const w = typedLine('syntax', t('types.ajax-written-in-a-text', { position }), opts.lint)
      if (w !== null) data.sectionWarnings.push(w)
    }
  }
  checkAjaxVerbNames(code, toBind)
  return { data, output: code, sourceMap }
}

// ----------------------------------------------------------------------------
// transpile — enveloppe publique de transpileImpl : toute erreur du pipeline est
// préfixée du nom du module avant de remonter, cf. wrapModuleError plus haut.
// ----------------------------------------------------------------------------
// mise à jour fine, champ par champ : une variable dont un champ est écrit par un chemin compilé (`µ._mjs_deepSet(_mjsThis, ["o",
// "f7"], v)` ; pour une variable lue par une liste, le champ d'un élément, `["data", i, "label"]`) et dont TOUS les lecteurs du gabarit
// lisent des champs nommés reçoit sa table : `r` pour ses listes (id, champ → masque, cf. FineList), `f` pour ses liaisons (champ →
// fonctions de `_mjs_eff`, les mêmes que celles de `_mjs_effectsByVar`, aucune copie). Refus, la variable garde le chemin ordinaire :
// liaison qui lit la variable entière, ne la cite pas (valeur dérivée dépliée) ou appelle ce que l'analyse ne suit pas (cf. readFields) ;
// prop d'enfant ; lecture par la passe de structure ou une transition ailleurs qu'en itérable d'une liste qui a ses masques (`{if
// $data[0]}`, ligne qui lit sa liste, liste dans une autre liste) ; valeur dérivée, reffet ou `µinspect` qui la lit. Une lecture
// inconnue (valeur dérivée ou reffet aux lectures non notées, clé calculée, liaison `*`) : aucune table. Rend la ligne posée dans
// `init` (vide sans table) et la passe de structure, où les listes retenues ont leur fermeture gardée. Lu sur les arbres des codes
function tableFine(init: string, struct: string[], trans: string[], effectsByVar: Map<string, string[]>, idx: Map<string, number>, lists: FineList[], propVars: Set<string>): { line: string, struct: string[] } {
  const nothing = { line: '', struct }
  // aucune écriture compilée d'un chemin : rien à lire
  if (!init.includes('µ._mjs_deep') || effectsByVar.has('*')) return nothing
  const ast = codeTree(init)
  if (!ast) return nothing
  // plus long chemin compilé écrit, par variable ; variables lues par une valeur dérivée, un reffet, `µinspect`
  const written = new Map<string, number>()
  const others  = new Set<string>()
  let unknown   = false
  const names   = (a: any): void => {
    if (a?.type !== 'ArrayExpression') {
      unknown = true
      return
    }
    for (const e of a.elements) {
      if (e?.type === 'Literal' && typeof e.value === 'string' && e.value !== '*') others.add(e.value)
      else unknown = true
    }
  }
  walk.simple(ast, {
    CallExpression(n: any) {
      const f = n.callee
      if (f.type !== 'MemberExpression' || f.computed || f.object.type !== 'Identifier' || f.object.name !== 'µ') return
      const [a0, a1] = n.arguments
      const name = f.property.name
      if (name === '_mjs_deepSet' || name === '_mjs_deepCall' || name === '_mjs_deepDelete') {
        if (a0?.type === 'Identifier' && a0.name === '_mjsThis' && a1?.type === 'ArrayExpression' && a1.elements[0]?.type === 'Literal' && typeof a1.elements[0].value === 'string') written.set(a1.elements[0].value, Math.max(written.get(a1.elements[0].value) ?? 0, a1.elements.length))
      }
      // valeur dérivée : ses sources quand elle est précise (quatrième argument), sinon toute écriture la périme
      else if (name === '_mjs_setComputed') names(n.arguments[3])
      else if (name === 'effect') names(a1)
      else if (name === 'inspect') {
        if (a0?.type === 'Literal' && typeof a0.value === 'string') others.add(a0.value)
        else unknown = true
      }
    },
  })
  if (unknown || written.size === 0) return nothing
  // lectures de la passe de structure et des transitions : `$.v` itérable d'une liste (`this._mjs_updFor('for3', $.v, …)`) ou ailleurs
  const iterables = new Map<string, Set<string>>()
  const elsewhere = new Set<string>()
  for (const code of [...struct, ...trans]) {
    const a = codeTree(code)
    if (!a || unknownRead(code)) return nothing
    walk.fullAncestor(a, (n: any, _st: any, anc: any[]) => {
      const p = anc[anc.length - 2]
      if (n.type === 'MemberExpression' && !n.computed && n.property.name === '_state') unknown = true
      if (n.type !== 'Identifier' || n.name !== '$') return
      if (!p || p.type !== 'MemberExpression' || p.object !== n || p.computed && !(p.property.type === 'Literal' && typeof p.property.value === 'string')) {
        unknown = true
        return
      }
      const v = p.computed ? p.property.value : p.property.name
      const g = anc[anc.length - 3]
      const list = g && g.type === 'CallExpression' && g.arguments[1] === p && g.arguments[0]?.type === 'Literal' && g.callee.type === 'MemberExpression' && g.callee.object.type === 'ThisExpression' && !g.callee.computed && g.callee.property.name === '_mjs_updFor'
      if (list) (iterables.get(v) ?? iterables.set(v, new Set()).get(v)!).add(g.arguments[0].value)
      else elsewhere.add(v)
    })
  }
  if (unknown) return nothing
  let output = struct
  const parts: string[] = []
  for (const [v, length] of written) {
    const theirs = lists.filter((l) => l.v === v)
    if (length < (theirs.length > 0 ? 3 : 2) || others.has(v) || propVars.has(v) || elsewhere.has(v)) continue
    if ([...(iterables.get(v) ?? [])].some((id) => !theirs.some((l) => l.id === id))) continue
    // chaque liste : ses masques, et sa fermeture présente une fois dans la passe de structure
    const r: string[] = []
    let next = output
    for (const l of theirs) {
      const res = l.fine()
      if (!res || next.reduce((count, c) => count + c.split(l.plain).length - 1, 0) !== 1) break
      next = next.map((c) => c.includes(l.plain) ? c.replace(l.plain, () => res.code) : c)
      r.push(`['${l.id}', ${JSON.stringify(res.table)}]`)
    }
    if (r.length !== theirs.length) continue
    // liaisons de la variable, dans leur ordre, avec les champs qu'elles lisent ; celle qui lit sous un champ (`profond`) repasse à
    // l'écriture de tout champ : elle rejoint la liste de chacun et `d`, celle d'un champ qu'aucune liaison ne lit directement
    const reads: [string, Set<string>, boolean][] = []
    let tracked = true
    for (const c of effectsByVar.get(v) ?? []) {
      const read = readFields(c, { state: v })
      if (!read || read.fields.size === 0) {
        tracked = false
        break
      }
      reads.push([`_mjs_eff[${idx.get(c)}]`, read.fields, read.deep])
    }
    const f = new Map<string, string[]>()
    for (const [, fields] of reads) for (const field of fields) f.set(field, [])
    for (const [name, fields, deep] of reads) for (const [field, a] of f) if (deep || fields.has(field)) a.push(name)
    const d = reads.filter((l) => l[2]).map((l) => l[0])
    if (!tracked || r.length === 0 && f.size === 0) continue
    output = next
    const fs = [...f].map(([k, a]) => `${JSON.stringify(k)}: [${a.join(', ')}]`).join(', ')
    parts.push(`${JSON.stringify(v)}: {${[r.length ? `r: [${r.join(', ')}]` : '', f.size ? `f: {${fs}}` : '', d.length ? `d: [${d.join(', ')}]` : ''].filter(Boolean).join(', ')}}`)
  }
  return parts.length ? { line: `\n      _mjsThis._mjs_fine = {${parts.join(', ')}};`, struct: output } : nothing
}

export async function transpile(
  source: string,
  opts: TranspileOpts = {}
): Promise<{ data: TranspileData; output: string; sourceMap?: string }> {
  // les effets de l'appli, lus par le catalogue pendant cette compilation
  setProjectEffects(opts.effectDefs)
  // un état du générateur et des effets de l'appli propres à cet appel : deux compilations lancées en même temps
  // (Promise.all, serveur qui compile à la demande) ne se prennent ni transitions, ni références, ni effets
  return withState(() => withProjectEffects(opts.effectDefs ?? {}, async () => {
    try {
      generatorState.deferUnnamedSettings = opts.deferUnnamedSettings === true
      return await transpileImpl(source, opts)
    }
    catch (err) {
      wrapModuleError(err, opts.moduleName)
    }
  }))
}

// ----------------------------------------------------------------------------
// transpileFile — variante qui lit depuis un path. `moduleName` calculé AVANT le try :
// sert aussi à préfixer une erreur de LECTURE du fichier (readFileSync), qui ne passe jamais par
// transpile()/wrapModuleError puisqu'elle survient avant tout appel à transpile().
// ----------------------------------------------------------------------------
export async function transpileFile(
  filePath: string,
  opts: Omit<TranspileOpts, 'moduleName' | 'baseDir'> = {}
): Promise<{ data: TranspileData; output: string; sourceMap?: string }> {
  const moduleName = basename(filePath, '.mjs')
  try {
    const { dirname } = await import('node:path')
    const content = readFileSync(filePath, 'utf-8')
    return await transpile(content, { ...opts, moduleName, baseDir: dirname(filePath) })
  }
  catch (err) {
    wrapModuleError(err, moduleName)
  }
}

// ----------------------------------------------------------------------------
// injectTemplate — slot le template avec les substitutions
// ----------------------------------------------------------------------------
export function injectTemplate(data: TranspileData, dirInject: string): string {
  // échappement pour insertion dans un littéral JS simple OU double-guillemet :
  // `data.moduleName`/`data.tagName` dérivent du nom de fichier (jamais garantis « propres » — un
  // dépôt partagé, un upload, une génération dynamique de composant les contrôlent potentiellement),
  // et atterrissent tels quels dans PLUSIEURS littéraux du squelette (jsInit ci-dessous
  // et [[TAG_NAME]] plus bas) sans quoi un `'`/`"` casse la chaîne et exécute la suite comme du JS
  // réel. `\`` et `${` NE sont PAS couverts (jamais utilisé dans un template literal, cf. escapeTpl
  // pour ce cas) — seulement les guillemets simple/double, l'antislash, et les retours à la ligne
  // (LF/CR + U+2028/U+2029, invalides dans un littéral avant ES2019).
  const escapeJsString = (s: string): string =>
    s.replace(/\\/g, '\\\\').replace(/'/g, '\\\'').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

  // dossier et nom posés AVANT le code du composant : un `layout` écrit dans son script les lit aussitôt
  let jsInit = `µ.activeComponent = this;\n    this._mjs_dir = '${escapeJsString(dirInject)}';\n    this._mjs_modName = '${escapeJsString(data.moduleName)}';\n    ${data.jsInitBase}`
  if (data.sharedCssNames.length > 0) {
    jsInit += `\n    this._mjs_sharedCss = ${JSON.stringify(data.sharedCssNames)};`
  }
  // Déclinaisons déclarées : sert au runtime à refuser un `layout="typo"` SANS aller sur le
  // réseau, et à nommer les noms connus dans le message. Émis seulement s'il y en a — un
  // composant sans déclinaison garde le comportement d'avant (tentative de chargement d'un
  // fichier CSS déposé à la main, encore possible).
  // La VALEUR est l'empreinte du CSS de la déclinaison : le fichier écrit par le build porte
  // un nom stable (`<module>.<nom>.css`, seul nom que le runtime sait construire), donc c'est
  // `?v=<empreinte>` qui casse le cache du navigateur quand la déclinaison change.
  const layoutNames = Object.keys(data.layoutCss)
  if (layoutNames.length > 0) {
    const stamps: Record<string, string> = {}
    for (const n of layoutNames) stamps[n] = data.layoutCss[n] ? createHash('md5').update(data.layoutCss[n]).digest('hex').slice(0, 8) : ''
    jsInit += `\n    this._mjs_layouts = ${JSON.stringify(stamps)};`
  }
  if (data.layoutRune) jsInit += `\n    this._mjs_lay = 1;`
  jsInit += `\n    µ.activeComponent = null;`

  let eventsCode = ''
  if (Object.keys(data.events).length > 0) {
    // 2ᵉ argument optionnel : liste des types d'events à enregistrer en
    // listener `passive` (touch/wheel sans preventDefault → scroll fluide).
    const passiveArg = data.passiveEvents && data.passiveEvents.length > 0
      ? `, ${JSON.stringify(data.passiveEvents)}`
      : ''
    eventsCode = `this._mjs_bindEvents(${JSON.stringify(data.events)}${passiveArg});`
  }

  // Optim #7 — Pré-calcul du Set des ids "avec listener" pour `_mjs_registerRefs`.
  // Tous les ids référencés par AU MOINS un event → on les met dans le Set
  // statique de la classe. Les autres (binding pur sans event) sont skippés.
  const __evtIdsSet = new Set<string>()
  for (const evt of Object.keys(data.events)) {
    for (const id of Object.keys(data.events[evt])) __evtIdsSet.add(id)
  }
  // une vue sans aucun nœud repéré (ni nœud réactif, ni événement, ni bloc) porte 0 au lieu de null : en `ssr:markers`, le serveur n'y écrit aucun repère, et
  // le client sait ainsi qu'elle se reprend telle que le serveur l'a écrite (mjs_hydrate.ts) au lieu d'être rebâtie avec tous ses composants enfants
  const evtIdsCode = __evtIdsSet.size > 0
    ? `new Set(${JSON.stringify([...__evtIdsSet])})`
    : data.noRefs ? '0' : 'null'

  // :host{display:X} prefix (cf. V1)
  const displayPrefix = `:host{display:${data.moduleDisplay}}`
  const scopedCss = displayPrefix + (data.baseCss ?? '')

  // Échappement template literal : \, `, ${
  const escapeTpl = (s: string): string =>
    s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')

  // Substitution en UNE passe via table de correspondance. Deux pièges évités :
  // 1) la forme FONCTION neutralise les motifs `$$`/`$&`/`$'`/`` $` `` de
  //    String.replace — avant, un simple `'prix en $'` dans le code utilisateur
  //    coupait la chaîne générée et y recopiait un pan du squelette ;
  // 2) la passe UNIQUE garantit qu'un token littéral (`"[[HAS_FLIP]]"`) présent
  //    dans le code utilisateur déjà inséré n'est jamais re-substitué (les
  //    valeurs de remplacement ne sont pas re-scannées).
  const slots: Record<string, string> = {
    '[[CLASS]]': data.className,
    '[[TAG_NAME]]': escapeJsString(data.tagName),
    '[[VAR_BITS]]': data.varBitsStr,
    '[[COMPUTED_DEPS]]': data.computedDepsStr,
    '[[BASE_CSS]]': escapeTpl(scopedCss),
    '[[CREATE_FN_BODY]]': data.createFnBody,
    '[[EVENTS]]': eventsCode,
    '[[EVT_IDS]]': evtIdsCode,
    '[[UPDATES_STRUCTURE]]': data.structUpdates.join('\n            '),
    '[[UPDATES_TRANSITIONS]]': data.transUpdates.join('\n            '),
    '[[EFFECTS_BY_VAR]]': data.effectsByVarStr,
    '[[EFFECTS_ALL]]': data.effectsAllStr,
    '[[FINE_LINE]]': data.fineLine ?? '',
    '[[INITIAL_PROP_BINDS]]': data.initialPropBindsStr,
    // composant qui livre des props aux composants de sa racine (`_mjs_kb`, generator/compile.ts) : posé dans une page déjà là, il garde
    // son contenu hors de la page jusqu'à la fin de la reprise de ses props (`_mjs_mount`, mjs_element.ts) ; rien d'écrit sans lui
    '[[KIDS_ARG]]': /\b_mjs_kb = /.test(data.initialPropBindsStr) ? ', 1' : '',
    '[[STRUCT_VARS]]': data.structVarsStr,
    '[[STORE_KEYS_LINE]]': data.storeKeysLine,
    '[[STORE_DECLARE_LINE]]': data.storeDeclareLine,
    '[[TYPES_DECL]]': data.typesDecl ?? '',
    '[[TYPES_LINE]]': data.typesLine ?? '',
    '[[ALIAS_LINE]]': data.aliasLine ?? '',
    '[[STATE_METHOD_CLASH_LINE]]': data.stateMethodClashLine,
    '[[I18N_LINE]]': data.i18nLine,
    '[[JS_INIT]]': jsInit,
    '[[PRELOAD]]': data.modulePreload ? JSON.stringify(data.modulePreload) : 'undefined',
    '[[VIEWTRANSITION]]': data.moduleViewTransition ? JSON.stringify(data.moduleViewTransition) : 'undefined',
    '[[VIEWTRANSITION_PRIORITY]]': String(data.moduleViewTransitionPriority ?? 1),
    // slots indexés : drapeau + appel émis SEULEMENT si le composant écrit `<@slot` — sans lui,
    // `_mjs_injectSlots` (mjs_slots.ts) ne faisait rien, et c'est cet appel littéral que la détection
    // du cœur cherche (bundler/features.ts, clé `slots`)
    '[[AUTOLOADER_LINE]]': '',
    '[[DYNAMIC_SLOTS_LINE]]': data.hasDynamicSlots ? '\n\n    this._mjs_has_dynamic_slots = true;\n    this._mjs_injectSlots();' : '',
    '[[NO_DESTROY_HOOKS]]': data.hasDestroyHooks ? 'false' : 'true',
    '[[HAS_FLIP]]': data.hasFlip ? 'true' : 'false',
    // `@formAssociated` : la classe passe par le socle du formulaire (mjs_form_associated.ts) AVANT son enregistrement — le navigateur lit
    // `formAssociated` et les rappels du formulaire au moment de `customElements.define`. C'est cet appel littéral que la détection du cœur
    // cherche (bundler/features.ts, clé `form_associated`) ; sans la directive, rien n'est écrit et le fichier n'entre pas au cœur
    '[[FORM_ASSOCIATED_LINE]]': data.moduleFormAssociated ? `µ._mjs_formClass(${data.className});\n` : '',
  }
  // guetteur de balises `mjs-*` : seulement si le code émis peut en faire apparaître (cf. autoloaderLine)
  slots['[[AUTOLOADER_LINE]]'] = autoloaderLine(
    ['[[CREATE_FN_BODY]]', '[[EVENTS]]', '[[UPDATES_STRUCTURE]]', '[[UPDATES_TRANSITIONS]]', '[[EFFECTS_BY_VAR]]', '[[EFFECTS_ALL]]', '[[INITIAL_PROP_BINDS]]', '[[JS_INIT]]'].map((k) => slots[k]).concat(data.jsModule ?? ''),
    data.hasDynamicSlots || data.hasDestroyHooks
  )

  // Tokens TOUS ancrés `[[…]]` (le `TAG_NAME` nu, non ancré, aurait été
  // remplacé PARTOUT dans le squelette : fragile à l'évolution du template).
  // Chiffres admis dans le nom (`[[I18N_LINE]]`) — AUCUN autre token existant n'en contient, extension sans risque.
  let final = jsTemplate.replace(/\[\[[A-Z0-9_]+\]\]/g, (tok) => slots[tok] ?? tok)

  // export default + URL.import.meta
  final = final.replace(
    new RegExp(`class\\s+${data.className}`),
    `export default class ${data.className}`
  )

  let result = `import { µ } from µ.asset('mjs_core.js');\n\n`
  if (data.jsModule) result += data.jsModule + '\n\n'
  result += final

  // Tag alias : sub-class anonymous, un constructeur ne pouvant être enregistré que sous une seule balise (customElements.define).
  // Ex pour file `tuto-snippets-card.mjs` : enregistre aussi `mjs-snippets-card`
  // pour que le user puisse écrire `<mjs-snippets-card>` dans son template.
  // `data.aliasTag` atterrit tel quel dans DEUX littéraux JS
  // double-guillemet ci-dessous, même piège que [[TAG_NAME]] plus haut :
  // même `escapeJsString`, jamais dupliquée (closure déjà en scope de cette fonction).
  // L'enregistrement lui-même vit dans une brique du cœur (`µ._al`, runtime mjs_alias.ts, jointe aux
  // seuls projets qui écrivent un alias — c'est CET appel que la détection cherche, cf.
  // bundler/features.ts, clé `alias`) :
  // le test est le même pour tous les composants, il était recopié dans chacun — 189 octets par
  // fichier, 657 fois sur le site de doc. Ce que ce fichier-ci porte encore : ses trois
  // arguments. `µ` est le nom sous lequel le module importe le cœur (ligne `import { µ }`
  // ci-dessus) — le symbole configuré (`sigil: 'mjs'`) est réécrit en `µ` bien avant, et un
  // raccourcisseur qui renomme l'import renomme aussi cet appel (même liaison de module).
  // L'alias n'est enregistré QUE si le manifeste porte sa clé (le tag sans le préfixe `mjs-`,
  // cf. mjs_autoloader.ts). Deux composants qui se disputent le même alias l'EMPOISONNENT au
  // build (bundler/index.ts, claimShortName) : la clé quitte le manifeste, mais la balise
  // restait enregistrée par le premier module chargé — absente du manifeste, elle passait au
  // runtime pour un composant tiers, et les props posées dessus devenaient des propriétés
  // propres qui masquent les méthodes du prototype en production. Manifeste absent (harnais,
  // rendu serveur) : rien à consulter, on enregistre comme avant.
  if (data.aliasTag && data.aliasTag !== data.tagName) {
    const aliasTagSafe = escapeJsString(data.aliasTag)
    const aliasKeySafe = escapeJsString(data.aliasTag.replace(/^mjs-/, ''))
    result += `\nµ._al("${aliasTagSafe}", "${aliasKeySafe}", ${data.className});\n`
  }

  return result
}

// ligne (1 pour la première) d'une position d'un code, et position du premier caractère écrit d'une ligne : les passes de réécriture
// gardent les lignes de ce qu'elles reçoivent, une position de leur code se retrouve ainsi dans le code d'avant elles
function lineOf(code: string, at: number): number {
  return code.slice(0, at).split('\n').length
}
function lineStart(code: string, line: number): number {
  let p = 0
  for (let i = 1; i < line; i++) {
    const end = code.indexOf('\n', p)
    if (end < 0) break
    p = end + 1
  }
  while (code[p] === ' ' || code[p] === '\t') p++
  return p
}
