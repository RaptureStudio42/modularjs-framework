// cli/server-entry — chargeur d'entry PARTAGÉ pour `mjs ws`/`mjs server` (cli/ws.ts,
// cli/server.ts) et `mjs serve` (server/serve-entry.ts). Une entry `.server.mjs` est un
// VRAI fichier MJS — compilée (MÊME dialecte Civet que le <script> des composants,
// applyCivetDialectSugar, src/transpiler/index.ts, SOURCE UNIQUE) vers un fichier réel sur
// disque, plus une URL `data:` (limite historique — imports relatifs/paquets nus impossibles
// sans dossier de référence, cf. l'ancienne doc docs/23-mjs-ws.md §13.2). Une entry `.civet`
// BRUTE reste un fichier ordinaire (AUCUNE pré-passe, AUCUN `@import`) — MÊME mécanique de
// fichier réel + cache-busting, juste sans dialecte ni grammaire.
//
// Cache — `serverCacheDir()` : `<root>/node_modules/.cache/mjs/server/` si `<root>/node_modules`
// existe et que ce dossier s'écrit (Node résout un paquet npm NU depuis ce dossier, en remontant l'arbre —
// l'algorithme de résolution de Node cherche un `node_modules` à CHAQUE niveau ancêtre, et ce dossier de
// cache vit justement SOUS celui du projet) ; sinon (absent, en lecture seule) repli `os.tmpdir()`, MÊME
// précédent que `findCacheDir` (bundler/worker-pool.ts), où chaque projet a son sous-dossier sous des liens
// `node_modules` vers ceux que Node visiterait depuis `<root>` (`projectTmpDir`). Rien ne s'écrit ailleurs —
// jamais dans le `node_modules` d'un dossier parent. Un `package.json`
// `{"type":"module"}` y est déposé une fois : sans lui, Node ≥ 22 lit un `.js` sans extension
// `.mjs` comme CommonJS (piège vérifié, cf. tests/module-civet-imports.test.ts).
//
// Grammaire `@import` — SEULE directive qui a un sens hors DOM dans
// un fichier serveur : `@i18n`/`@routes`/`@display`/`@css`/`@lang`… → erreur explicite
// (`cli.entry-directive-forbidden`). MÊME lecture que les composants
// (readImportDirectives de transpiler/directives.ts : formes, refus et messages) — cible
// `https?://` laissée telle quelle ; cible avec préfixe `./`/`../`/`/`/`file:`, OU sans préfixe
// mais qui EXISTE réellement à côté de l'entry ou sous --root (forme composant
// `utils/helpers.civet`), résolue et compilée récursivement si `.civet`/`.mjs` (« c'est du MJS ») ou `.coffee`,
// importée telle quelle si `.js`/`.cjs`/`.json` ; sinon spécificateur NU laissé à Node (`node:fs`, un
// paquet npm AVEC ou SANS sous-chemin/`@scope` — `modularjs-framework/ws`, `@scope/pkg/sub` — cherché dans
// `<root>/node_modules` puis dans celui de chaque dossier parent, cf. cache ci-dessus). Un `/` dans le spécificateur ne
// suffit plus à le prendre pour un chemin (cf. `looksLikePath` ci-dessous) — seule une cible SANS
// préfixe qui finit par `.civet`/`.coffee`/`.mjs` ET n'existe nulle part est encore une erreur forcée (« cible
// introuvable » plutôt qu'un repli silencieux, forcément un fichier voulu). Un `import … from`
// NATIF (hors `@import`) est une ERREUR de compilation, clés cli.entry-*,
// import(variable) permis — `lintNoRawImport` (transpiler/index.ts), MÊME garde que <script>/
// <script module>, avec ses clés catalogue propres (entry serveur) substituées via son 5e paramètre.

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, accessSync, constants, statSync, readlinkSync, symlinkSync } from 'node:fs'
import { privateTmpDir } from './private-tmp-dir.js'
import { dirname, join, resolve, extname, relative, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { t } from '../messages/index.js'
import { writeFileAtomicAlways } from '../bundler/outputs.js'
import { findConstReassignment } from '../transpiler/const-reassign.js'
import { readImportDirectives, importNames, importClause, importDollarName, DIRECTIVE_LINE_RE } from '../transpiler/directives.js'
import type { CompileResult } from '../languages/index.js'
import { passDeclarations } from '../languages/civet-declarations.js'
import { textMask } from '../reader/zones.js'
import { opensHashBlock } from '../lexer/index.js'

// traces d'erreur sur les lignes SOURCE (Civet), pas sur le JS généré dans le cache — une
// exception levée depuis un `setup()`/`serve()` d'entry pointe alors le `.server.mjs`/`.civet` de
// l'appli, jamais le fichier haché sous `node_modules/.cache/mjs/server/`
process.setSourceMapsEnabled(true)

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

let importCounter = 0

// --- dossier de cache ---------------------------------------------------------

/** `<root>/node_modules/.cache/mjs/server/` si `<root>/node_modules` existe et que ce dossier s'écrit,
 *  sinon repli `os.tmpdir()` (MÊME précédent que `findCacheDir`, bundler/worker-pool.ts) : un
 *  `node_modules` en lecture seule ne casse rien, et rien ne s'écrit hors du projet ni du dossier
 *  temporaire. Pose (une fois) le `package.json` `{"type":"module"}` qui fait lire les `.js` du dossier
 *  comme de l'ESM. */
export function serverCacheDir(root: string): string {
  const nm = join(root, 'node_modules')
  if (existsSync(nm)) {
    const dir = join(nm, '.cache', 'mjs', 'server')
    try {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      accessSync(dir, constants.W_OK)
      return withModulePackage(dir)
    } catch {
      // en lecture seule (droits, disque monté en lecture) : repli sur le dossier temporaire
    }
  }
  const dir = join(tmpdir(), `mjs-server-cache-${process.getuid?.() ?? 'nouid'}`)
  sharedTmpCacheDir(dir)
  return withModulePackage(dir)
}

// pose une fois le `package.json` `{"type":"module"}` du dossier de cache, et rend ce dossier
function withModulePackage(dir: string): string {
  const pkg = join(dir, 'package.json')
  if (!existsSync(pkg)) writeFileSync(pkg, '{"type":"module"}\n')
  return dir
}

// repli du dossier temporaire : Node n'y trouverait pas les paquets du projet. Chaque projet y a son sous-dossier
// (haché sur `root`), où un lien `node_modules` mène à chaque dossier `node_modules` que Node visiterait depuis un
// fichier de `root` — le sien, puis celui de chaque parent —, un niveau de dossier par lien, dans le même ordre : un
// import nu reste nu, Node le résout lui-même (ses conditions, celles de NODE_OPTIONS, et une seule instance d'un
// paquet, le lien menant au vrai dossier — sauf sous `--preserve-symlinks`, où le paquet vu par le lien et celui vu
// depuis le projet font deux instances). Rien n'est résolu ici, rien n'est écrit dans ces `node_modules`
function projectTmpDir(shared: string, root: string): string {
  const abs   = resolve(root)
  const chain = [] as string[]
  for (let d = abs; ; d = dirname(d)) {
    const nm = join(d, 'node_modules')
    if (basename(d) !== 'node_modules' && isDirectory(nm)) chain.push(nm)
    if (dirname(d) === d) break
  }
  let dir = join(shared, createHash('md5').update(abs).digest('hex'))
  for (let i = chain.length - 1; i >= 0; i--) {
    mkdirSync(dir, { recursive: true })
    linkTo(join(dir, 'node_modules'), chain[i])
    if (i > 0) dir = join(dir, 'n')
  }
  mkdirSync(dir, { recursive: true })
  return withModulePackage(dir)
}

function isDirectory(path: string): boolean {
  try { return statSync(path).isDirectory() } catch { return false }
}

// pose (ou corrige) le lien `link` vers `target` par un lien temporaire renommé : jamais d'instant sans lien pour un
// import concurrent ; un échec laisse Node dire au chargement le paquet qu'il ne trouve pas
function linkTo(link: string, target: string): void {
  try { if (readlinkSync(link) === target) return } catch { /* absent, ou pas un lien */ }
  const tmp = `${link}.${process.pid}.${Date.now()}.tmp`
  try {
    symlinkSync(target, tmp, 'junction')
    renameSync(tmp, link)
  } catch {
    try { unlinkSync(tmp) } catch { /* best-effort */ }
  }
}

// dossier de cache sous le dossier temporaire COMMUN de la machine : son nom est prévisible, un
// autre utilisateur peut le créer d'avance et y déposer le code que le serveur importe. Créé en
// 0700 ; s'il existe déjà, ce doit être un vrai dossier (pas un lien) à nous, que les AUTRES ne
// peuvent pas écrire — sinon refus. Le groupe ne compte pas : un umask 002 (défaut Debian, Ubuntu,
// groupe privé de l'utilisateur) laisse les anciens dossiers en 775. Un dossier à nous ouvert au
// groupe ou lisible par les autres est refermé en 0700.
function sharedTmpCacheDir(dir: string): void {
  if (!privateTmpDir(dir)) throw new Error(t('cli.entry-cache-not-safe', { dir }))
}

// écriture atomique par l'aide commune (bundler/outputs.ts) : temporaire unique puis renameSync, jamais de fichier tronqué visible par un
// import concurrent (2 process qui rechargent la même entry en même temps), aucun temporaire laissé sur un disque plein. Un échec n'est
// toléré que si le fichier porte déjà le contenu voulu (l'autre process a gagné) : son nom vient du chemin de la source, pas du contenu
function writeAtomic(file: string, content: string): void {
  try {
    writeFileAtomicAlways(file, content)
  } catch (err) {
    if (!existsSync(file) || readFileSync(file, 'utf8') !== content) throw err
  }
}

// dépose le JS compilé (+ sa carte de source si fournie) dans le cache, sous un nom haché sur le
// chemin ABSOLU de la source (pas de collision entre projets) — rend une URL `file://` cache-bustée
// (`?v=n`, compteur PARTAGÉ par ce module : chaque appel garantit une URL neuve, même contenu
// byte-identique, cf. le même besoin que `importCompiledJs` côté data: URL). Dans le repli du dossier temporaire, le
// sous-dossier du projet (`projectTmpDir`).
function writeCacheFile(sourceAbsPath: string, root: string, code: string, map: string | undefined): string {
  const shared   = serverCacheDir(root)
  const cacheDir = shared === join(root, 'node_modules', '.cache', 'mjs', 'server') ? shared : projectTmpDir(shared, root)
  const hash     = createHash('md5').update(sourceAbsPath).digest('hex')
  const outFile  = join(cacheDir, `${hash}.js`)
  let finalCode  = code
  if (map) {
    writeAtomic(`${outFile}.map`, map)
    finalCode = `${code}\n//# sourceMappingURL=${basename(outFile)}.map\n`
  }
  writeAtomic(outFile, finalCode)
  return `${pathToFileURL(outFile).href}?v=${++importCounter}`
}

// --- markup de composant (garde-fou .server.mjs/.mjs) -------------------------

// détecte du markup de composant (<template>, <style>, ou une balise HTML en tête de fichier)
// dans un fichier `.server.mjs`/`.mjs` — un fichier serveur n'est PAS un composant .mjs (pas de
// template/DOM), juste du Civet/JS (`export default { setup(app) { … } }`). Cherche une balise EN
// DÉBUT DE LIGNE (jamais dans un commentaire/une string qui en parlerait) ; retourne l'indice
// trouvé (pour le message d'erreur) ou `null` si le fichier est un script Civet ordinaire.
export function findComponentMarkupHint(source: string): string | null {
  const tag = source.match(/^[ \t]*<(template|style)\b/im)
  if (tag) return `<${tag[1].toLowerCase()}>`
  const withoutLeadingBlanks = source.replace(/^(?:[ \t]*(?:\/\/[^\n]*|#[^\n]*)?\n)*/, '')
  const head = withoutLeadingBlanks.match(/^[ \t]*<([a-zA-Z][\w-]*)/)
  return head ? `<${head[1]}>` : null
}

// --- grammaire @import ---------------------------------------------------------

// lecture des directives : celle des composants et des modules (readImportDirectives, transpiler/directives.ts) —
// mêmes formes, mêmes refus, mêmes messages ; ici sur un texte dont les chaînes et commentaires sont masqués (un
// fichier serveur n'est que du code)

// ressemble à un CHEMIN DE PROJET (donc une cible ABSENTE mérite une erreur, pas un repli
// silencieux vers Node) — SOIT un préfixe explicite (`./`, `../`, `/`, `file:`), SOIT (sans ce
// préfixe) une extension de module `.civet`/`.coffee`/`.mjs` (forme `utils/helpers.civet`, forcément un
// fichier VOULU, jamais un sous-chemin de paquet npm). Un `/` seul ne suffit plus —
// `modularjs-framework/ws`, `@scope/pkg/sub` ont un `/` mais NI préfixe NI extension composant, donc
// spécificateur NU laissé à Node (l'ancien test `spec.includes('/')` les prenait à tort pour une
// cible de projet, cf. docs/23-mjs-ws.md §13.2).
function looksLikePath(spec: string): boolean {
  return /^(?:\.\.?\/|\/|file:)/.test(spec) || /\.(civet|coffee|mjs)$/.test(spec)
}

interface ServerCompileCtx {
  /** pile des chemins ABSOLUS en cours de compilation — détection de cycle par DFS classique */
  visiting: string[]
  /** URL déjà rendue pour chaque fichier dans CE chargement : un module importé par deux fichiers
   *  (diamant) n'est chargé qu'une fois, son état (magasin, cache, pool) reste partagé */
  compiled: Map<string, string>
}

function newCtx(): ServerCompileCtx {
  return { visiting: [], compiled: new Map() }
}

// résout UNE cible @import : URL http(s) telle quelle ; fichier du projet (préfixé `./`/`../`/`/`/
// `file:`, OU sans préfixe mais présent à côté de l'entry ou sous --root, forme composant) compilé
// récursivement si `.civet`/`.mjs` (« c'est du MJS »), importé tel quel si `.js`/`.cjs`/`.json`
// (attribut `with { type: 'json' }` ajouté par l'appelant, extractServerImports ci-dessous) ; sinon
// spécificateur NU laissé à Node (paquet npm AVEC ou SANS sous-chemin/`@scope`, `node:*`)
// — ERREUR si la cible ressemble à un chemin de projet (looksLikePath) sans exister nulle part
// (évite un `Cannot find module './x'` cryptique côté Node).
async function resolveImportTarget(targetPath: string, fromAbsPath: string, root: string, ctx: ServerCompileCtx): Promise<string> {
  if (/^https?:\/\//.test(targetPath)) return targetPath

  const nearEntry   = resolve(dirname(fromAbsPath), targetPath)
  const nearRoot    = resolve(root, targetPath)
  const projectFile = existsSync(nearEntry) ? nearEntry : (existsSync(nearRoot) ? nearRoot : null)

  if (projectFile === null) {
    if (looksLikePath(targetPath)) throw new Error(t('cli.entry-import-not-found', { entryPath: fromAbsPath, target: targetPath }))
    return targetPath   // spécificateur nu — résolution Node normale ('node:*', paquet npm du projet, cf. cache ci-dessus)
  }

  const ext = extname(projectFile)
  // une bibliothèque `.civet` / `.coffee` : compilée par son seul langage (cf. compileRawCivetFile) ; un module MJS (`.civet.mjs`…), par MJS
  if (ext === '.civet' || ext === '.coffee') return compileRawCivetFile(projectFile, root, true)
  if (ext === '.mjs') return compileServerFile(projectFile, root, ctx)
  let url = ctx.compiled.get(projectFile)
  if (url === undefined) {
    url = `${pathToFileURL(projectFile).href}?v=${++importCounter}`
    ctx.compiled.set(projectFile, url)
  }
  return url
}

// --- masquage commentaires/chaînes ---------------------------------------------

// scanQuotedWithInterp — avance depuis l'ouverture d'une chaîne (`quote` = "'", '"', "'''" ou
// '"""') jusqu'à sa fermeture, en sautant tout `#{…}`/`${…}` imbriqué (interpolation Civet dans
// une chaîne, gabarit JS dans un `` ` ``) sans se faire piéger par un guillemet PORTÉ PAR
// l'expression elle-même (même souci que maskStaticHtmlText, transpiler/index.ts, sur `{…}`).
function scanQuotedWithInterp(src: string, start: number, quote: string, interp: string): number {
  const n    = src.length
  const qlen = quote.length
  let i      = start + qlen
  while (i < n) {
    if (src[i] === '\\') { i += 2; continue }
    if (src.slice(i, i + qlen) === quote) return i + qlen
    if (src.slice(i, i + interp.length) === interp) {
      i += interp.length
      let depth = 1
      while (i < n && depth > 0) {
        if (src[i] === '\\') { i += 2; continue }
        if (src[i] === "'" || src[i] === '"' || src[i] === '`') { i = skipNestedQuote(src, i); continue }
        if (src[i] === '{') depth++
        else if (src[i] === '}') depth--
        i++
      }
      continue
    }
    i++
  }
  return n
}

// skipNestedQuote — chaîne SIMPLE (sans interpolation récursive) pour une expression `#{…}`/
// `${…}` qui contiendrait elle-même un guillemet : une seule profondeur suffit ici, la détection
// de directive n'a besoin que de ne pas se faire abuser par une fermeture prématurée.
function skipNestedQuote(src: string, start: number): number {
  const quote = src[start]
  const n     = src.length
  let i       = start + 1
  while (i < n) {
    if (src[i] === '\\') { i += 2; continue }
    if (src[i] === quote) return i + 1
    i++
  }
  return n
}

// maskCommentsAndStrings (correctif faux positif) : rend une copie de `src` où chaque
// commentaire (`#…`, `###…###`, `//…`, `/*…*/` — le dialecte Civet accepte les deux familles) et
// chaque chaîne (`'…'`, `"…"` avec `#{…}` imbriqué, `'''…'''`/`"""…"""`, gabarit `` `…` `` avec
// `${…}` imbriqué) est REMPLACÉE PAR DES ESPACES DE MÊME LONGUEUR (les `\n` internes restent des
// `\n` : mêmes lignes, mêmes offsets que `src`) — un commentaire JSDoc (`### … @param x … ###`) ou
// une chaîne multi-lignes dont une ligne commence par `@foo` ne doit jamais ressembler à une
// directive. Sert UNIQUEMENT à la détection (lecture partagée des `@import`, « autre directive ») :
// le texte réel transmis au compilateur reste toujours `src`/`cleaned`, jamais ce masque. La lecture
// partagée n'y regarde que l'`@` d'une directive : sa cible entre guillemets peut y être blanchie.
function maskCommentsAndStrings(src: string): string {
  const n     = src.length
  let out     = ''
  const blank = (from: number, to: number): void => { for (let k = from; k < to; k++) out += src[k] === '\n' ? '\n' : ' ' }
  let i       = 0
  while (i < n) {
    const three = src.slice(i, i + 3)
    if (three === "'''" || three === '"""') { const stop = scanQuotedWithInterp(src, i, three, '#{'); blank(i, stop); i = stop; continue }
    if (opensHashBlock(src, i)) { const end = src.indexOf('###', i + 3); const stop = end === -1 ? n : end + 3; blank(i, stop); i = stop; continue }
    const two = src.slice(i, i + 2)
    if (two === '//') { const end = src.indexOf('\n', i); const stop = end === -1 ? n : end; blank(i, stop); i = stop; continue }
    if (two === '/*') { const end = src.indexOf('*/', i + 2); const stop = end === -1 ? n : end + 2; blank(i, stop); i = stop; continue }
    if (src[i] === '#') { const end = src.indexOf('\n', i); const stop = end === -1 ? n : end; blank(i, stop); i = stop; continue }
    if (src[i] === "'" || src[i] === '"') { const stop = scanQuotedWithInterp(src, i, src[i], '#{'); blank(i, stop); i = stop; continue }
    if (src[i] === '`') { const stop = scanQuotedWithInterp(src, i, '`', '${'); blank(i, stop); i = stop; continue }
    out += src[i]
    i++
  }
  return out
}

// le source d'un fichier serveur, ses textes blanchis (chaînes, heredocs, gabarits, regex, commentaires), lu par l'arbre
// (reader/zones.ts) dans la langue de son compilateur, une fois par fichier : le guillemet, le `###` ou l'accent grave d'une
// regex n'ouvre aucun texte, une ligne d'une regex étendue `///…///` n'est pas du code. Le masque fait main ci-dessus repasse
// sur ce masque : un commentaire que Civet efface avec un type (interface, alias, type littéral) ou un bloc `###` jamais
// refermé n'est pas dans l'arbre. Un fichier que l'arbre ne lit pas, ou pas sûrement (faute de syntaxe, lettre réservée,
// chaîne `"…#{…"` du dialecte passée à la ligne, `###` resté au code hors Civet nu), comme toute panne du lecteur (pile
// débordée par une expression de milliers de termes…), n'a que le masque fait main, et son compilateur dit ce qui ne va pas.
// `dialecte` : compileServerFile, où un fichier qui n'est pas en CoffeeScript passe par le dialecte de MJS (un `####` n'y
// commente que sa ligne) ; hors du dialecte, un `.civet` brut est lu en Civet nu (`#` y est du code). Une ligne que le masque fait main seul
// fait commencer par une directive dont l'arobase est du code pour l'arbre (hors de tout texte) reprend la vue de ce masque :
// la directive y est refusée comme sans l'arbre, même quand l'arbre lit autrement ce qui la précède (`### a ### @css 'a.css'`
// d'un `.civet` brut, où `###` est du code). Une directive que le masque fait main refusait reste donc refusée, sauf si
// l'arbre la place dans un texte ; hors Civet nu, l'arbre n'est cru que s'il lit les blocs `###` comme CoffeeScript et le
// dialecte, qui les referment au premier `###` qui suit, même en milieu de ligne (`### aide = 1`) : un `###` qu'il laisse au
// code dit le contraire, sa lecture n'est pas sûre, comme en CoffeeScript une regex que son lexeur ne lit pas de même (`2 /b`
// y divise). Le source arrive sans marque d'ordre des octets (retirée à la lecture du fichier)
function withoutTexts(src: string, absPath: string, dialect = false): string {
  const coffee             = /\.coffee(?:\.mjs)?$/.test(absPath)
  let tree: string | null = null
  try { tree = textMask(src, coffee ? 'coffee' : dialect ? 'civet' : 'civet-bare', dialect && !coffee) } catch { /* panne du lecteur : le masque fait main seul */ }
  let mask = maskCommentsAndStrings(tree ?? src)
  if (tree !== null) {
    const alone = maskCommentsAndStrings(src)
    for (const m of alone.matchAll(/^[ \t]*@(?:import|css|routes|i18n|display|lang)/gm)) {
      const p = m.index + m[0].indexOf('@')
      if (tree[p] !== '@') continue
      let end = p
      while (end < alone.length && alone[end] !== '\n' && alone[end] !== '\r') end++
      mask = mask.slice(0, m.index) + alone.slice(m.index, end) + mask.slice(end)
    }
  }
  return mask
}

// `fichier:ligne` d'une directive refusée ; `text` a les lignes du fichier (une ligne @import retirée y laisse son saut de
// ligne), comptées comme dans un éditeur : `\r\n`, `\r` seul ou `\n`
function withLine(file: string, text: string, index: number): string {
  return `${file}:${lineAt(text, index)}`
}

// numéro de la ligne (à partir de 1) où tombe `index` dans `text`, même compte que withLine
function lineAt(text: string, index: number): number {
  return text.slice(0, index).split(/\r\n?|\n/).length
}

// retire les lignes @import du source (en partant de la FIN pour ne jamais décaler les indices
// des matches précédents), résout chaque cible, rend les clauses `import` natives à préfixer + le
// source nettoyé. Toute AUTRE directive en colonne 0 (hors @import) → erreur explicite : seule
// @import a un sens hors DOM (cf. commentaire de tête du fichier). `mask` : le source, ses textes blanchis (withoutTexts),
// dont les lignes @import retirées partent aussi : le source nettoyé n'est pas relu
async function extractServerImports(src: string, mask: string, absPath: string, root: string, ctx: ServerCompileCtx): Promise<{ cleaned: string, importClauses: string[] }> {
  // chaînes et commentaires masqués ; mêmes refus et mêmes messages que dans un composant (plusieurs lignes, virgule,
  // accolades après `default`, cible vide ou douteuse) — la cible s'insère ici dans un SIMPLE guillemet, jamais
  // interpolée, mais une cible `x#{1+1}y` serait un import mort : refusée de même. Un nom en µ ou § reste tel quel
  const readDirectives      = readImportDirectives(src, mask)
  // un singleton (`µ$$x`) vit dans la page : une entrée serveur n'en a pas, la directive est refusée avec cette raison
  const singleton = readDirectives.find(d => d.names.includes('µ$$'))
  if (singleton) throw new Error(t('cli.entry-import-singleton', { entryPath: absPath, line: singleton.text.trim() }))
  const directives              = readDirectives.filter(d => !/[µ§]/.test(d.names))
  const importClauses: string[] = []
  let cleaned                   = src
  let cleanMask                 = mask
  for (let i = directives.length - 1; i >= 0; i--) {
    const d             = directives[i]
    const dollar        = importDollarName(d)
    // un nom en `$x` : refusé comme dans un composant (un singleton s'importe et se consomme par `µ$$x`)
    if (dollar) throw new Error(t('transpiler.import-name-dollar', { name: dollar, base: dollar.slice(1) }))
    const names          = importNames(d)
    const fromSpecifier = await resolveImportTarget(d.target, absPath, root, ctx)
    // Node ≥ 20.10 exige l'attribut `with { type: 'json' }` sur un `import` statique
    // ciblant du `.json` (assertion d'import), sinon `ERR_IMPORT_ATTRIBUTE_MISSING` au chargement
    // — extension prise sur la cible ÉCRITE, jamais sur `fromSpecifier` (une cible
    // `.civet`/`.coffee`/`.mjs` compilée finit toujours en `.js`, jamais en `.json`)
    const attrs = d.target.endsWith('.json') ? ` with { type: 'json' }` : ''
    importClauses.unshift(importClause(d, names, `'${fromSpecifier}'${attrs}`))
    cleaned   = cleaned.slice(0, d.index) + cleaned.slice(d.index + d.text.length)
    cleanMask = cleanMask.slice(0, d.index) + cleanMask.slice(d.index + d.text.length)
  }
  // seules les directives CONNUES sont refusées : `@n = 0`, `@n++` (this.n) sont du Civet ordinaire,
  // comme une propriété suivie d'un mot-opérateur (`@lang or "fr"`, `@display if @display?`)
  const otherDirective = cleanMask.match(/^[ \t]*(@(?:import|css|routes|i18nPlaceholder|i18n|display|lang))(?=[ \t]+(?!(?:or|and|xor|not|is|isnt|in|of|instanceof|if|unless|then|else|for|while|until|when|by|as|satisfies)\b)[^\s=+\-*\/%&|^<>!?.,;:)\]}]|[ \t]*$)/m)
  // `@import` qu'aucune lecture ne reconnaît (`@import nom` sans chemin…) : la ligne est citée, jamais « seule @import est admise »
  if (otherDirective?.[1] === '@import') throw new Error(t('cli.entry-import-unreadable', { entryPath: withLine(absPath, cleaned, otherDirective.index ?? 0), line: cleaned.slice(otherDirective.index ?? 0).split('\n')[0].trim() }))
  if (otherDirective) throw new Error(t('cli.entry-directive-forbidden', { entryPath: withLine(absPath, cleaned, otherDirective.index ?? 0), directive: otherDirective[1] }))
  return { cleaned, importClauses }
}

// --- compilation --------------------------------------------------------------

// constante Civet (`:=` → `const`) réaffectée, même depuis une fonction imbriquée ou une boucle :
// refusée à la compilation, comme pour un composant, plutôt qu'un TypeError au chargement du
// serveur (portées exactes, cf. transpiler/const-reassign.ts)
function rejectReassignedConstant(js: string): void {
  const constant = findConstReassignment(js)
  if (constant) throw new Error(t('transpiler.civet-reassignment-constant', { name: constant.name, line: constant.line, code: true }))
}

// compile un fichier `.server.mjs`/`.mjs` — MÊME dialecte Civet que le <script> des composants
// (applyCivetDialectSugar, SOURCE UNIQUE) + grammaire @import ci-dessus. Appelée pour l'entry ET
// récursivement pour chaque dépendance `.civet`/`.mjs` qu'elle @import (AUCUNE transformation de
// symbole réactif $x/@x/§/µ-runes : un fichier serveur n'a ni réactivité ni DOM). Détection de
// cycle par la pile `ctx.visiting` (DFS classique) — `ctx` frais par défaut, PARTAGÉ explicitement
// entre l'appel racine et ses dépendances (cf. `resolveImportTarget` ci-dessus).
export async function compileServerFile(absPath: string, root: string, ctx: ServerCompileCtx = newCtx()): Promise<string> {
  const already = ctx.compiled.get(absPath)
  if (already !== undefined) return already
  if (ctx.visiting.includes(absPath)) {
    const chain = [...ctx.visiting, absPath].map(p => relative(root, p) || p).join(' → ')
    throw new Error(t('cli.entry-import-cycle', { entryPath: absPath, chain }))
  }
  ctx.visiting.push(absPath)
  try {
    // une marque d'ordre des octets en tête (U+FEFF, Notepad, PowerShell) retirée avant toute lecture, comme dans
    // compileRawCivetFile : une directive @import juste sur la première ligne est lue comme sans elle, au contrôle comme à
    // la compilation
    const source = readFileSync(absPath, 'utf8').replace(/^\uFEFF/, '')
    const mask = withoutTexts(source, absPath, true)
    if (extname(absPath) === '.mjs') {
      // chaînes et commentaires masqués : un gabarit de courriel `"""<style>…"""` n'est pas du markup
      const hint = findComponentMarkupHint(mask)
      if (hint) throw new Error(t('cli.ws.entry-markup-component', { entryPath: absPath, hint }))
    }
    const { cleaned, importClauses } = await extractServerImports(source, mask, absPath, root, ctx)
    const withImports                = importClauses.length > 0 ? `${importClauses.join('\n')}\n${cleaned}` : cleaned
    const { applyCivetDialectSugar, lintNoRawImport } = await import('../transpiler/index.js')
    const { getAdapter }                              = await import('../languages/index.js')
    let result: CompileResult
    try {
      const pass = passDeclarations()
      // un module .coffee importé se compile en CoffeeScript, hors du dialecte Civet
      result      = /\.coffee(?:\.mjs)?$/.test(absPath)
        ? await getAdapter('coffee').compileToJs(withImports, { fileName: absPath, bare: true })
        : await getAdapter('civet').compileToJs(applyCivetDialectSugar(withImports, 'civet', undefined, 1, undefined, pass), { fileName: absPath, declareAssignments: true, passDeclarations: pass })
      rejectReassignedConstant(result.code)
    } catch (err) {
      // paramètre lu autrement par Civet : les imports placés devant décalent les lignes du texte compilé
      const { ParamReadOtherwiseError } = await import('../languages/civet-params.js')
      const addedLines                 = importClauses.length > 0 ? importClauses.join('\n').split('\n').length : 0
      const error                         = err instanceof ParamReadOtherwiseError && err.param.line !== null ? new ParamReadOtherwiseError(err.param, absPath, err.js, err.param.line - addedLines) : err
      throw new Error(t('cli.ws.error-compilation', { entryPath: absPath, error: errText(error) }))
    }
    lintNoRawImport(result.code, relative(root, absPath) || absPath, importClauses.length, undefined, { static: 'cli.entry-import-native-forbidden', dynamic: 'cli.entry-import-dynamic-forbidden', reexport: 'cli.entry-reexport-forbidden' })
    const url = writeCacheFile(absPath, root, result.code, result.map)
    ctx.compiled.set(absPath, url)
    return url
  } finally {
    ctx.visiting.pop()
  }
}

// compile un entry `.civet` BRUT (variante documentée, §13.3 docs/23-mjs-ws.md) — AUCUNE
// pré-passe (ni dialecte, ni @import) : un fichier ordinaire, cf. tête de
// fichier — juste le compilateur Civet nu, MÊME fichier réel + cache-busting que compileServerFile.
// une directive MJS reste toutefois REFUSÉE explicitement (cf. juste en
// dessous), plutôt que de compiler en silence vers un appel de méthode ordinaire.
// `bibliotheque` : un `.civet` / `.coffee` importé par une entrée serveur, compilé par son seul langage — une directive y dit de le nommer `nom.civet.mjs`
export async function compileRawCivetFile(absPath: string, root: string, library = false): Promise<string> {
  // un BOM UTF-8 (U+FEFF) en tête de fichier
  // (PowerShell `Out-File`/Notepad sous Windows, MÊME cause que sections.ts:282) n'est ni un
  // espace ni un `@` : la garde `^[ \t]*@…` juste en dessous ne le voit pas, la directive file
  // jusqu'au compilateur Civet nu qui échoue avec un ParseError illisible, sans jamais citer
  // `@import` ni l'entry. Retiré ICI, choke point unique AVANT le test ET la compilation —
  // `readFileSync(...,'utf8')` ne le retire pas (Node standard).
  const source = readFileSync(absPath, 'utf8').replace(/^\uFEFF/, '')
  // une entry .civet BRUTE n'a AUCUNE directive MJS : Civet compile quand même
  // `@import a './a.civet'` en `this.import(a("./a.civet"))` (appel de méthode ordinaire, `@import`
  // lu comme décorateur+identifiant), erreur seulement au runtime et sans rapport avec la vraie
  // cause — refusé ICI, avant toute tentative de compilation. Masquage commentaires/chaînes d'abord
  // (même garde que extractServerImports plus haut) : un `# @import x '...'` affiché en exemple ne
  // doit jamais déclencher ce refus.
  // même règle que extractServerImports : une propriété suivie d'un mot-opérateur (`@lang or "fr"`) ou d'un opérateur est du Civet ordinaire
  const directiveMatch = withoutTexts(source, absPath).match(DIRECTIVE_LINE_RE)
  if (directiveMatch && library) {
    // une bibliothèque : le refus de la construction, par ses fonctions (bundler/index.ts) — toutes ses directives, chacune à sa ligne,
    // dans l'ordre du fichier ; chargées seulement quand le fichier est refusé
    const lang                                  = absPath.endsWith('.coffee') ? 'coffee' : 'civet'
    const { extractDirectives }                 = await import('../transpiler/directives.js')
    const { libraryDirectives, libraryRefusal } = await import('../bundler/index.js')
    const patterns                              = libraryDirectives(source, extractDirectives(source, lang).cleaned, lang)
    throw libraryRefusal(absPath, patterns.length > 0 ? patterns : [{ kind: 'directive', line: lineAt(source, directiveMatch.index ?? 0), detail: directiveMatch[0].trim() }], false, lang)
  }
  if (directiveMatch) throw new Error(t('cli.entry-civet-raw-directive', { entryPath: withLine(absPath, source, directiveMatch.index ?? 0), directive: `@${directiveMatch[1]}` }))
  const { getAdapter } = await import('../languages/index.js')
  let result: CompileResult
  try {
    result = absPath.endsWith('.coffee') ? await getAdapter('coffee').compileToJs(source, { fileName: absPath, bare: true }) : await getAdapter('civet').compileToJs(source, { fileName: absPath })
    rejectReassignedConstant(result.code)
  } catch (err) {
    throw new Error(t('cli.ws.error-compilation-civet', { entryPath: absPath, error: errText(err) }))
  }
  return writeCacheFile(absPath, root, result.code, result.map)
}
