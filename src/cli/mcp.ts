// cli/mcp — `mjs mcp` : serveur MCP (Model Context Protocol) en stdio, pour les assistants d'IA qui écrivent une appli MJS.
// Écrit à la main, sans le SDK officiel (aucune dépendance de plus) : JSON-RPC 2.0, un message par ligne sur l'entrée et la
// sortie standard — `initialize`, `ping`, `tools/list`, `tools/call`, les notifications sans réponse. La sortie standard ne
// porte QUE le protocole : tout ce que le compilateur ou la console y écriraient part sur la sortie d'erreur. Les messages
// sont traités un par un, dans l'ordre (la compilation d'un composant capture la console, deux à la fois se mêleraient).
// Outils : chercher dans la doc du paquet installé, lire une page (ou une section), compiler un composant (mêmes objets que
// `mjs check --json`), lire le journal d'erreurs d'un `mjs dev` en cours (`/__mjs/errors.json`), lister les composants et
// les routes ; rien n'est écrit sur le disque. Gardes : une recherche est bornée (mots, caractères) ; un lien qui mène hors
// du projet ou de la doc n'est pas suivi ; le jeton du journal ne part que vers le `mjs dev` du projet, sur la boucle locale,
// jamais par un mandataire ; le journal rendu est borné, et ses textes, que n'importe quelle page peut écrire, sont marqués
// comme des données ; un fichier qui n'est pas un composant n'est pas compilé comme s'il en était un

import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { get } from 'node:http'
import type { LookupFunction } from 'node:net'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createInterface } from 'node:readline'
import { Bundler } from '../bundler/index.js'
import { findConfig, resolveBundlerOpts, type MjsConfig } from '../bundler/config.js'
import { isClassFile, isModuleFile } from '../bundler/class-files.js'
import { isEffectsFile } from '../bundler/effects-files.js'
import { isThemeFile } from '../bundler/themes.js'
import { isTypesFile } from '../bundler/types-files.js'
import { t, type MsgKey } from '../messages/index.js'
import { captureOutput, componentFiles, diagnosticsOf, fileModel, type Diagnostic } from './check-json.js'
import { ownDocsDir } from './package-files.js'
import { resolveServeurEntryPath } from './server.js'
import { resolveEntryPath } from './ws.js'

/** versions du protocole comprises, la plus récente d'abord — une version inconnue reçoit la première */
export const MCP_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']

const PAGE_MAX = 60000

// le journal d'erreurs rendu à l'assistant : borné, en nombre d'entrées comme en longueur de chaque texte
const ENTRIES_DEFAULT = 20
const ENTRIES_MAX     = 50
const MESSAGE_MAX     = 500
const STACK_LINES_MAX = 6
const STACK_MAX       = 600
const URL_MAX         = 300

// une recherche coûte un passage sur toute la doc par mot, et les requêtes passent une par une : bornée
const QUERY_MAX = 500
const TERMS_MAX = 20

/** l'entrée fermée, ce qui a déjà été reçu a encore ce délai pour être servi, puis le serveur s'arrête */
const CLOSE_GRACE_MS = 1000

interface ToolResult { content: { type: 'text', text: string }[], structuredContent?: Record<string, unknown>, isError?: boolean }

interface Tool {
  name:        string
  description: MsgKey
  properties:  Record<string, { type: string, description: MsgKey }>
  required?:   string[]
  run:         (args: Record<string, unknown>, ctx: McpContext) => Promise<ToolResult>
}

interface McpContext { root: string, version: string | null }

function ok(structured: Record<string, unknown>, text?: string): ToolResult {
  return { content: [{ type: 'text', text: text ?? JSON.stringify(structured, null, 2) }], structuredContent: structured }
}

function fail(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true }
}

function rel(root: string, file: string): string {
  return relative(root, file).split(sep).join('/')
}

// le chemin réel (liens suivis) est-il sous `racine`, déjà réelle ? un lien cassé ou illisible : non
function inside(racine: string, chemin: string): boolean {
  let reel: string
  try { reel = realpathSync(chemin) } catch { return false }
  const r = relative(racine, reel)
  return r !== '' && r !== '..' && !r.startsWith('..' + sep) && !isAbsolute(r)
}

// sans accents ni casse : « éléments » se trouve en tapant « elements »
function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

// le projet, relu à chaque appel : la config peut changer pendant que le serveur tourne
function project(root: string): { root: string, config: MjsConfig | null, opts: ReturnType<typeof resolveBundlerOpts> | null, sourceDir: string } {
  const found = findConfig(root)
  const opts  = found ? resolveBundlerOpts(found.config, found.configDir) : null
  const base  = found?.configDir ?? root
  return { root: base, config: found?.config ?? null, opts, sourceDir: opts?.sourceDir ?? resolve(base, 'app/modularjs') }
}

// ---------------------------------------------------------------------------------------------------------------------
// DOC
// ---------------------------------------------------------------------------------------------------------------------

/** les pages de la doc : les `*.md` et `llms*.txt` du dossier — un lien qui mène hors du dossier n'en est pas une */
export function docPages(dir: string): string[] {
  const reel = realpathSync(dir)
  return readdirSync(dir).filter((f) => (f.endsWith('.md') || /^llms.*\.txt$/.test(f)) && inside(reel, join(dir, f))).sort()
}

interface Heading { level: number, text: string, line: number }

// titres d'une page, hors blocs de code (un `# commentaire` de shell n'en est pas un)
function headings(lines: string[]): Heading[] {
  const out = [] as Heading[]
  let code  = false
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) code = !code
    else if (!code) {
      const m = /^(#{1,6}) (.+)$/.exec(l)
      if (m) out.push({ level: m[1].length, text: m[2].trim(), line: i + 1 })
    }
  })
  return out
}

function resolvePage(dir: string, asked: string): string | null {
  const pages = docPages(dir)
  const nom   = basename(asked.trim())
  if (pages.includes(nom)) return nom
  if (pages.includes(nom + '.md')) return nom + '.md'
  const debut = pages.filter((p) => p.startsWith(nom + '-') || p.startsWith(nom + '.'))
  return debut.length === 1 ? debut[0] : null
}

async function searchDocs(args: Record<string, unknown>): Promise<ToolResult> {
  const dir   = ownDocsDir()
  const query = typeof args.query === 'string' ? args.query.trim() : ''
  if (dir === null) return fail(t('cli.mcp.doc-absente'))
  if (query === '') return fail(t('cli.mcp.parametre-manquant', { nom: 'query' }))
  if (query.length > QUERY_MAX) return fail(t('cli.mcp.recherche-trop-longue', { nb: query.length, max: QUERY_MAX }))
  const limit = Math.min(50, Math.max(1, Number.isInteger(args.limit) ? (args.limit as number) : 10))
  const terms = [...new Set(fold(query).split(/\s+/).filter(Boolean))]
  // des accents seuls ne laissent aucun mot une fois pliés
  if (terms.length === 0) return fail(t('cli.mcp.parametre-manquant', { nom: 'query' }))
  if (terms.length > TERMS_MAX) return fail(t('cli.mcp.recherche-trop-de-mots', { nb: terms.length, max: TERMS_MAX }))
  const found = [] as { page: string, title: string, section: string, line: number, excerpt: string, hits: number }[]
  for (const page of docPages(dir)) {
    const lines = readFileSync(join(dir, page), 'utf-8').split('\n')
    const heads = headings(lines)
    const title = heads[0]?.text ?? page
    // une section va d'un titre au suivant ; le début de page, avant tout titre, compte pour la page
    const bornes = [{ text: title, line: 1 }, ...heads.slice(1)]
    bornes.forEach((h, i) => {
      const fin     = i + 1 < bornes.length ? bornes[i + 1].line - 1 : lines.length
      const morceau = lines.slice(h.line - 1, fin)
      const plie    = morceau.map(fold)
      if (!terms.every((term) => plie.some((l) => l.includes(term)))) return
      const hits  = plie.reduce((n, l) => n + terms.reduce((m, term) => m + l.split(term).length - 1, 0), 0)
      const index = plie.findIndex((l) => l.includes(terms[0]))
      found.push({ page, title, section: h.text, line: h.line + index, excerpt: morceau[index].trim().slice(0, 240), hits })
    })
  }
  found.sort((a, b) => b.hits - a.hits || (a.page < b.page ? -1 : a.page > b.page ? 1 : a.line - b.line))
  const results = found.slice(0, limit)
  const text    = results.length === 0 ? t('cli.mcp.recherche-vide', { query }) : results.map((r) => `${r.page}:${r.line} · ${r.section}\n   ${r.excerpt}`).join('\n')
  return ok({ query, results }, text)
}

async function readDoc(args: Record<string, unknown>): Promise<ToolResult> {
  const dir = ownDocsDir()
  if (dir === null) return fail(t('cli.mcp.doc-absente'))
  const page = typeof args.page === 'string' ? resolvePage(dir, args.page) : null
  if (page === null) return fail(t('cli.mcp.page-inconnue', { page: String(args.page ?? ''), pages: docPages(dir).join(', ') }))
  const text  = readFileSync(join(dir, page), 'utf-8')
  const lines = text.split('\n')
  const heads = headings(lines)
  if (typeof args.section === 'string' && args.section.trim() !== '') {
    const cherche = fold(args.section.trim())
    const h       = heads.find((x) => fold(x.text).includes(cherche))
    if (!h) return fail(t('cli.mcp.section-inconnue', { page, section: args.section, sections: heads.map((x) => x.text).join(' · ') }))
    const suite   = heads.find((x) => x.line > h.line && x.level <= h.level)
    const fin     = suite ? suite.line - 1 : lines.length
    const morceau = lines.slice(h.line - 1, fin).join('\n').trimEnd()
    if (morceau.length <= PAGE_MAX) return ok({ page, section: h.text, line: h.line, truncated: false }, morceau)
    // plus longue que le plafond (le titre de la page prend la page entière) : coupée comme une page, ses sous-sections listées
    const coupe = morceau.lastIndexOf('\n', PAGE_MAX)
    const sous  = heads.filter((x) => x.line > h.line && x.line <= fin && x.level === h.level + 1).map((x) => x.text).join(' · ')
    return ok({ page, section: h.text, line: h.line, truncated: true }, morceau.slice(0, coupe > 0 ? coupe : PAGE_MAX) + '\n\n' + t('cli.mcp.section-tronquee', { page, section: h.text, sections: sous }))
  }
  if (text.length <= PAGE_MAX) return ok({ page, truncated: false }, text)
  const coupe = text.lastIndexOf('\n', PAGE_MAX)
  const reste = heads.filter((x) => x.level === 2).map((x) => x.text).join(' · ')
  return ok({ page, truncated: true }, text.slice(0, coupe) + '\n\n' + t('cli.mcp.page-tronquee', { page, sections: reste }))
}

// ---------------------------------------------------------------------------------------------------------------------
// COMPILATION
// ---------------------------------------------------------------------------------------------------------------------

function filesEndingWith(dir: string, suffix: string): string[] {
  const out  = [] as string[]
  const pile = [dir]
  while (pile.length > 0) {
    const d = pile.pop()!
    let entries: import('node:fs').Dirent[]
    try { entries = readdirSync(d, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue
      if (e.isDirectory()) pile.push(join(d, e.name))
      else if (e.name.endsWith(suffix)) out.push(join(d, e.name))
    }
  }
  return out.sort()
}

// `chemin` est-il sous `dossier` (lui-même exclu), à lire les deux chemins tels qu'ils sont écrits ?
function under(dossier: string, chemin: string): boolean {
  const r = relative(dossier, chemin)
  return r !== '' && r !== '..' && !r.startsWith('..' + sep) && !isAbsolute(r)
}

// le fichier que charge une commande serveur du projet, trouvé comme la commande le trouve : `mjs ws` (cli/ws.ts,
// resolveEntryPath : `ws.entry` de mjs.config.json, à défaut ws.server.mjs, server/ws.server.mjs, ws.js…), `mjs serveur`
// (cli/server.ts, resolveServeurEntryPath : `serveur.entry`, à défaut serveur.server.mjs…), `mjs serve` et `mjs dev`
// (server/serve-entry.ts : `render.entry`) — la commande et son champ, `null` pour tout autre fichier
function serverEntry(file: string, p: ReturnType<typeof project>): { commande: string, champ: string } | null {
  const est   = (entry: () => string | undefined): boolean => {
    try {
      const e = entry()
      return e !== undefined && resolve(e) === file
    }
    catch { return false }
  }
  const rendu = (p.config?.render as unknown as { entry?: string } | undefined)?.entry
  if (est(() => resolveEntryPath(p.root, undefined, p.config?.ws?.entry))) return { commande: 'ws', champ: 'ws.entry' }
  if (est(() => resolveServeurEntryPath(p.root, undefined, p.config?.serveur?.entry))) return { commande: 'serveur', champ: 'serveur.entry' }
  if (est(() => (rendu === undefined ? undefined : resolve(p.root, rendu)))) return { commande: 'serve', champ: 'render.entry' }
  return null
}

// ce qu'est un fichier qui n'est pas un composant, `null` pour un composant. D'abord ce que la construction ne lit pas : un
// fichier serveur (`*.server.mjs` HORS du dossier source — elle ne lit que ce dossier ; ces fichiers sont compilés par `mjs ws`,
// `mjs serveur` et `mjs serve`, cf. cli/server-entry.ts), le fichier que charge une de ces commandes (`entry`, cf. serverEntry),
// un fichier sans l'extension `.mjs` ; puis son propre tri (bundler/index.ts, compile). Une page `nom.page.mjs` et un modèle en
// fichier `carte.compacte.mjs` sont des composants ; SOUS le dossier source (`inSource`), `carte.server.mjs` est pour elle le
// modèle « server » de `carte` (collectFileModels), compilé comme tel. Une source donnée sans fichier n'a pas de place : nommée
// `*.server`, elle reste un fichier serveur
function notComponent(nom: string, inSource: boolean, entry: boolean): 'autre' | 'module' | 'classe' | 'regles' | 'effets' | 'theme' | 'serveur' | 'entree' | 'partiel' | null {
  if (nom.endsWith('.server.mjs') && !inSource) return 'serveur'
  if (entry) return 'entree'
  if (!nom.endsWith('.mjs')) return 'autre'
  if (isModuleFile(nom)) return 'module'
  if (isClassFile(nom)) return 'classe'
  if (isTypesFile(nom)) return 'regles'
  if (isEffectsFile(nom)) return 'effets'
  if (isThemeFile(nom)) return 'theme'
  return nom.startsWith('_') ? 'partiel' : null
}

async function compileComponent(args: Record<string, unknown>, ctx: McpContext): Promise<ToolResult> {
  const p = project(ctx.root)
  let source: string
  let file = null as string | null
  if (typeof args.file === 'string' && args.file.trim() !== '') {
    file = resolve(p.root, args.file)
    const chemin = relative(p.root, file)
    if (chemin === '..' || chemin.startsWith('..' + sep) || isAbsolute(chemin)) return fail(t('cli.mcp.fichier-hors-projet', { fichier: args.file, racine: p.root }))
    if (!existsSync(file)) return fail(t('cli.mcp.fichier-introuvable', { fichier: args.file }))
    // un lien du projet qui mène dehors n'est pas suivi : le fichier réel doit être sous la racine réelle
    if (!inside(realpathSync(p.root), file)) return fail(t('cli.mcp.lien-hors-projet', { fichier: args.file, racine: p.root }))
    source = readFileSync(file, 'utf-8')
  }
  else if (typeof args.source === 'string') source = args.source
  else return fail(t('cli.mcp.parametre-manquant', { nom: 'file / source' }))
  const name     = file !== null ? basename(file, '.mjs').replace(/\.page$/, '') : (typeof args.name === 'string' && args.name !== '' ? args.name : 'component')
  const fileName = file !== null ? basename(file) : name + '.mjs'
  // module de script, classe globale, règles, effets, thème, partiel, fichier serveur, fichier sans `.mjs` : la construction les
  // traite autrement, ou pas du tout — compilé ici comme un composant, un tel fichier rendrait un résultat faux (« ok » sur une
  // faute, conseil de le renommer)
  const entree   = file !== null ? serverEntry(file, p) : null
  const sous     = file !== null && under(p.sourceDir, file)
  const genre    = notComponent(fileName, sous, entree !== null)
  if (genre !== null) return fail(t('cli.mcp.pas-un-composant', { fichier: file !== null ? String(args.file) : fileName, genre, commande: entree?.commande ?? '', champ: entree?.champ ?? '' }))
  // un modèle en fichier n'en est un que sous le dossier source (une source donnée sans fichier y est comptée) : ailleurs, la
  // construction ne lit rien, un nom à point n'y dit rien
  const model    = file === null || sous ? fileModel(fileName) : null
  const opts     = p.opts
  const bundler  = new Bundler({ sourceDir: p.sourceDir, defaultScriptLang: opts?.defaultScriptLang, templateLang: opts?.templateLang, sigil: opts?.sigil, contextAlias: opts?.contextAlias, varPrefix: opts?.varPrefix, defaultTheme: opts?.defaultTheme, maxStateVars: opts?.maxStateVars, a11y: opts?.a11y, ujsForm: opts?.ujsForm, lint: opts?.lint, types: opts?.types, derivedMode: opts?.derivedMode, routesPreload: opts?.routesPreload, blocksPreload: opts?.blocksPreload, proxy: opts?.proxy, responsiveFontSize: opts?.responsiveFontSize, collections: opts?.collections, effects: opts?.effects, colorsEnabled: false, env: 'dev' })
  const files    = componentFiles(p.sourceDir)
  if (file !== null) files.set(model !== null ? `${model.base}--${model.model}` : name, file)
  const detail   = (d: string) => t('bundler.index.erreur-fichier-detail', { fichier: file ?? fileName, detail: d })
  const capture  = captureOutput()
  const errors   = [] as string[]
  const warnings = [] as string[]
  // les deux fautes que la construction trouve à un modèle en fichier (bundler/index.ts, collectFileModels) : nommé « default », ou
  // sans son composant dans le projet
  if (model?.model === 'default') errors.push(detail(t('bundler.modele-default', { fichier: fileName })))
  else if (model !== null && !files.has(model.base)) errors.push(detail(t('bundler.modele-sans-composant', { fichier: fileName, base: model.base })))
  try {
    // les règles et les effets du projet, lus comme le fait la construction : un effet de l'appli n'est pas une faute
    bundler.compileTypesFiles(filesEndingWith(p.sourceDir, '.types.mjs'))
    for (const e of bundler.compileEffectsFiles(filesEndingWith(p.sourceDir, '.effects.mjs'))) errors.push(e.message)
    await bundler.compileSingle(source, { fileName, warnings, filePath: file ?? undefined })
  }
  catch (e: any) {
    errors.push(e?.message ?? String(e))
  }
  finally {
    capture.restore()
    await bundler.close()
  }
  // les avertissements du fichier, nommés comme ceux de la construction (stats.warnings, que lit mjs check --json)
  const diags = diagnosticsOf(capture.lines, { root: p.root, files }, { errors, warnings: warnings.map((w) => detail(w)) })
  // une source sans fichier : ses objets ne nomment pas de fichier
  const sans  = (d: Diagnostic) => (file === null ? { ...d, file: null } : d)
  return ok({ ok: diags.errors.length === 0, errors: diags.errors.map(sans), warnings: diags.warnings.map(sans) })
}

// ---------------------------------------------------------------------------------------------------------------------
// ERREURS DE LA PAGE, COMPOSANTS, ROUTES
// ---------------------------------------------------------------------------------------------------------------------

// le jeton du journal (« journal.viewer ») protège aussi celui de la production : il ne quitte jamais cet ordinateur
const LOOPBACK = ['127.0.0.1', '::1', 'localhost']

function loopbackHost(host: string): string | null {
  const h = host.trim().toLowerCase().replace(/^\[(.*)\]$/, '$1')
  return LOOPBACK.includes(h) ? h : null
}

// « localhost » sans passer par le DNS : la boucle locale, en IPv4 puis en IPv6
const loopbackLookup: LookupFunction = (_host, opts, done) => {
  const famille  = opts.family === 6 || opts.family === 'IPv6' ? 6 : opts.family === 4 || opts.family === 'IPv4' ? 4 : 0
  const adresses = [{ address: '127.0.0.1', family: 4 }, { address: '::1', family: 6 }].filter((a) => famille === 0 || a.family === famille)
  if (opts.all) done(null, adresses)
  else done(null, adresses[0].address, adresses[0].family)
}

function fetchJson(host: string, port: number, path: string): Promise<{ status: number, body: string }> {
  return new Promise((ok, ko) => {
    // node:http et pas fetch, avec un agent à soi (`agent: false`) : l'agent commun suit HTTP_PROXY dès que NODE_USE_ENV_PROXY est
    // posé — jamais de mandataire entre l'outil et le serveur local, le jeton du journal ne lui est pas confié
    const req = get({ host, port, path, agent: false, timeout: 5000, ...(host === 'localhost' ? { lookup: loopbackLookup } : {}) }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (d) => { body += d })
      res.on('end', () => ok({ status: res.statusCode ?? 0, body }))
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', ko)
  })
}

interface PageError { source: 'server' | 'client', message: string, pile: string, url: string, version: string | null, n: number, premier: number | null, dernier: number | null }

// les données du journal en JSON, les fins de ligne que JSON laisse telles quelles dans une chaîne (codes 0x85, 0x2028 et 0x2029)
// écrites en échappement : une page n'y pose pas de fin de ligne, et les données relues redonnent son texte, caractère pour caractère
const LINE_ENDS_RE = new RegExp('[' + String.fromCharCode(0x85, 0x2028, 0x2029) + ']', 'g')
function dataJson(v: unknown): string {
  return JSON.stringify(v, null, 2).replace(LINE_ENDS_RE, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
}

// un texte du journal, coupé à `max` caractères (« … » dit la coupe)
function cut(v: unknown, max: number): string {
  const s = typeof v === 'string' ? v : ''
  return s.length > max ? s.slice(0, max) + '…' : s
}

// les entrées du journal telles qu'elles sont rendues : les champs connus seulement, chaque texte borné, la pile réduite à ses
// premières lignes ; deux entrées devenues identiques n'en font qu'une, leurs occurrences ajoutées
function boundedEntries(entries: unknown[]): PageError[] {
  const out = new Map<string, PageError>()
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  for (const e of entries) {
    if (e === null || typeof e !== 'object' || Array.isArray(e)) continue
    const x    = e as Record<string, unknown>
    const pile = typeof x.pile === 'string' ? x.pile.split('\n') : []
    const d    = { source: x.source === 'server' ? 'server' : 'client', message: cut(x.message, MESSAGE_MAX), pile: cut(pile.slice(0, STACK_LINES_MAX).join('\n') + (pile.length > STACK_LINES_MAX ? '\n…' : ''), STACK_MAX), url: cut(x.url, URL_MAX), version: typeof x.version === 'string' ? cut(x.version, 32) : null, n: Math.max(1, num(x.n) ?? 1), premier: num(x.premier), dernier: num(x.dernier) } as PageError
    const cle  = JSON.stringify([d.source, d.message, d.pile, d.url])
    const deja = out.get(cle)
    if (deja === undefined) {
      out.set(cle, d)
      continue
    }
    deja.n      += d.n
    deja.premier = deja.premier === null || d.premier === null ? deja.premier ?? d.premier : Math.min(deja.premier, d.premier)
    deja.dernier = deja.dernier === null || d.dernier === null ? deja.dernier ?? d.dernier : Math.max(deja.dernier, d.dernier)
  }
  return [...out.values()]
}

async function pageErrors(args: Record<string, unknown>, ctx: McpContext): Promise<ToolResult> {
  const p          = project(ctx.root)
  const portProjet = p.opts?.devPort ?? 3939
  // un mjs dev qui écoute sur toutes les interfaces se joint par la boucle locale
  const ecoute     = p.opts?.devHost ?? '127.0.0.1'
  const demande    = typeof args.host === 'string' && args.host.trim() !== '' ? args.host : ecoute === '0.0.0.0' ? '127.0.0.1' : ecoute === '::' ? '::1' : ecoute
  const host       = loopbackHost(demande)
  if (host === null) return fail(t('cli.mcp.hote-refuse', { hote: demande }))
  const port       = Number.isInteger(args.port) ? (args.port as number) : portProjet
  const viewer     = p.config?.journal?.viewer
  // le jeton ne part que vers le port du projet : un autre port n'est pas demandé du tout
  if (typeof viewer === 'string' && port !== portProjet) return fail(t('cli.mcp.jeton-autre-port', { port, portProjet }))
  const path       = '/__mjs/errors.json' + (typeof viewer === 'string' ? '?token=' + encodeURIComponent(viewer) : '')
  const url        = `http://${host.includes(':') ? `[${host}]` : host}:${port}/__mjs/errors.json`
  let r: { status: number, body: string }
  try { r = await fetchJson(host, port, path) }
  catch { return fail(t('cli.mcp.dev-absent', { url })) }
  if (r.status !== 200) return fail(t('cli.mcp.journal-ferme', { url, statut: r.status }))
  let entries: unknown
  try { entries = JSON.parse(r.body) } catch { return fail(t('cli.mcp.journal-illisible', { url })) }
  const toutes  = boundedEntries(Array.isArray(entries) ? entries : [])
  if (toutes.length === 0) return ok({ url, total: 0, truncated: false, entries: [] }, t('cli.mcp.journal-vide', { url }))
  const limit   = Math.min(ENTRIES_MAX, Math.max(1, Number.isInteger(args.limit) ? (args.limit as number) : ENTRIES_DEFAULT))
  const rendues = toutes.slice(0, limit)
  const avis    = t('cli.mcp.journal-avis')
  // ce que la page a écrit au journal est rendu comme des données : l'avis d'abord, puis deux lignes à un identifiant tiré au sort,
  // qu'aucune page ne peut écrire d'avance pour faire croire que les données sont finies
  const texte   = t('cli.mcp.journal-texte', { url, nb: rendues.length, total: toutes.length, max: ENTRIES_MAX, avis, id: randomBytes(6).toString('hex'), donnees: dataJson(rendues) })
  return ok({ url, total: toutes.length, truncated: rendues.length < toutes.length, notice: avis, entries: rendues }, texte)
}

async function listComponents(_args: Record<string, unknown>, ctx: McpContext): Promise<ToolResult> {
  const p          = project(ctx.root)
  const components = [...componentFiles(p.sourceDir)].filter(([name, f]) => f !== null && !name.startsWith('_')).map(([name, f]) => ({ name, tag: 'mjs-' + name, file: rel(p.root, f!), page: basename(f!, '.mjs').endsWith('.page') })).sort((a, b) => (a.name < b.name ? -1 : 1))
  return ok({ sourceDir: rel(p.root, p.sourceDir), components })
}

async function listRoutes(_args: Record<string, unknown>, ctx: McpContext): Promise<ToolResult> {
  const p             = project(ctx.root)
  const render        = p.config?.render
  const pages         = Object.entries(render?.routes ?? {}).map(([path, r]) => ({ path, component: r.component, mode: r.mode ?? render?.default ?? 'prerender' }))
  const views         = [] as { file: string, target: string, routes: { path: string, component: string }[] }[]
  const routesObjects = [] as { file: string }[]
  for (const [, f] of componentFiles(p.sourceDir)) {
    if (f === null) continue
    const src = readFileSync(f, 'utf-8')
    // `target` entre guillemets doubles ou simples ; un bloc mis en commentaire n'est pas une table de routes
    for (const m of src.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<routes\s+target=(["'])([^"']+)\1\s*>([\s\S]*?)<\/routes>/g)) {
      const routes = m[3].split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#')).map((l) => l.split(/\s+/)).filter((x) => x.length >= 2).map(([path, component]) => ({ path, component }))
      views.push({ file: rel(p.root, f), target: m[2], routes })
    }
    // un objet `@routes` se calcule à l'exécution : le fichier est nommé, la table est à lire dedans
    if (/^\s*@routes\s*[:=]/m.test(src)) routesObjects.push({ file: rel(p.root, f) })
  }
  return ok({ pages, views, routesObjects })
}

const TOOLS: Tool[] = [
  { name: 'search_docs', description: 'cli.mcp.outil-search-docs', properties: { query: { type: 'string', description: 'cli.mcp.param-query' }, limit: { type: 'integer', description: 'cli.mcp.param-limit' } }, required: ['query'], run: searchDocs },
  { name: 'read_doc', description: 'cli.mcp.outil-read-doc', properties: { page: { type: 'string', description: 'cli.mcp.param-page' }, section: { type: 'string', description: 'cli.mcp.param-section' } }, required: ['page'], run: readDoc },
  { name: 'compile_component', description: 'cli.mcp.outil-compile-component', properties: { file: { type: 'string', description: 'cli.mcp.param-file' }, source: { type: 'string', description: 'cli.mcp.param-source' }, name: { type: 'string', description: 'cli.mcp.param-name' } }, run: compileComponent },
  { name: 'page_errors', description: 'cli.mcp.outil-page-errors', properties: { port: { type: 'integer', description: 'cli.mcp.param-port' }, host: { type: 'string', description: 'cli.mcp.param-host' }, limit: { type: 'integer', description: 'cli.mcp.param-limit-journal' } }, run: pageErrors },
  { name: 'list_components', description: 'cli.mcp.outil-list-components', properties: {}, run: listComponents },
  { name: 'list_routes', description: 'cli.mcp.outil-list-routes', properties: {}, run: listRoutes },
]

// ---------------------------------------------------------------------------------------------------------------------
// PROTOCOLE
// ---------------------------------------------------------------------------------------------------------------------

type Message = { jsonrpc?: unknown, id?: unknown, method?: unknown, params?: any }

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }
}

async function handle(msg: Message, ctx: McpContext): Promise<object | null> {
  if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) return rpcError(null, -32600, 'Invalid Request')
  const notification = !('id' in msg)
  // une réponse du client (résultat ou erreur, sans méthode) n'attend rien
  if (typeof msg.method !== 'string') return notification || 'result' in msg || 'error' in msg ? null : rpcError(msg.id, -32600, 'Invalid Request')
  if (msg.jsonrpc !== '2.0') return notification ? null : rpcError(msg.id, -32600, 'Invalid Request')
  if (msg.method.startsWith('notifications/')) return null
  // la langue des messages est celle du projet dès la première réponse : sa config est lue ici (illisible, le premier outil le dira)
  if (msg.method === 'initialize' || msg.method === 'tools/list') {
    try { project(ctx.root) } catch { /* messages en français */ }
  }
  let result: unknown
  switch (msg.method) {
    case 'initialize': {
      const asked = msg.params?.protocolVersion
      result = { protocolVersion: MCP_PROTOCOLS.includes(asked) ? asked : MCP_PROTOCOLS[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'modularjs', title: 'ModularJS', version: ctx.version ?? '0.0.0' }, instructions: t('cli.mcp.instructions', { version: ctx.version ?? '?' }) }
      break
    }
    case 'ping':
      result = {}
      break
    case 'tools/list':
      result = { tools: TOOLS.map((o) => ({ name: o.name, description: t(o.description), inputSchema: { type: 'object', properties: Object.fromEntries(Object.entries(o.properties).map(([k, v]) => [k, { type: v.type, description: t(v.description) }])), ...(o.required ? { required: o.required } : {}) } })) }
      break
    case 'tools/call': {
      const tool = TOOLS.find((o) => o.name === msg.params?.name)
      if (!tool) return rpcError(msg.id, -32602, `Unknown tool: ${String(msg.params?.name)}`)
      const args = msg.params?.arguments && typeof msg.params.arguments === 'object' ? msg.params.arguments : {}
      // une faute de l'outil est un résultat en erreur (le modèle la lit), jamais une erreur du protocole
      try { result = await tool.run(args, ctx) }
      catch (e: any) { result = fail(e?.message ?? String(e)) }
      break
    }
    default:
      return notification ? null : rpcError(msg.id, -32601, `Method not found: ${msg.method}`)
  }
  return notification ? null : { jsonrpc: '2.0', id: msg.id, result }
}

/** `mjs mcp` : lit l'entrée standard jusqu'à sa fermeture, répond sur la sortie standard */
export async function runMcp(opts: { root: string, version: string | null }): Promise<void> {
  const write = process.stdout.write.bind(process.stdout)
  const send  = (msg: object) => { write(JSON.stringify(msg) + '\n') }
  // la sortie standard est au protocole : la console et toute écriture égarée passent sur la sortie d'erreur
  console.log   = console.error
  console.info  = console.error
  console.debug = console.error
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => process.stderr.write(chunk as string, ...(rest as []))) as typeof process.stdout.write
  const ctx   = { root: opts.root, version: opts.version }
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
  let file    = Promise.resolve()
  // l'entrée fermée (l'assistant est parti) : au-delà de cette heure, ce qui attend encore est abandonné
  let limite  = Infinity
  lines.on('line', (line) => {
    file = file.then(async () => {
      // un tour de la boucle d'événements avant chaque message : la fin de l'entrée se voit entre deux requêtes
      await new Promise<void>((ok) => setImmediate(ok))
      if (Date.now() > limite || line.trim() === '') return
      let msg: unknown
      try { msg = JSON.parse(line) }
      catch { send(rpcError(null, -32700, 'Parse error')); return }
      if (Array.isArray(msg)) {
        const out = [] as object[]
        for (const m of msg) {
          if (Date.now() > limite) return
          const r = await handle(m, ctx)
          if (r !== null) out.push(r)
        }
        if (msg.length === 0) send(rpcError(null, -32600, 'Invalid Request'))
        else if (out.length > 0) send(out)
        return
      }
      const r = await handle(msg as Message, ctx)
      if (r !== null) send(r)
    })
  })
  await new Promise<void>((ok) => lines.once('close', () => ok()))
  limite = Date.now() + CLOSE_GRACE_MS
  // la requête en cours a le même délai pour finir ; au-delà, le serveur s'arrête quand même
  let minuterie: NodeJS.Timeout | undefined
  await Promise.race([file, new Promise<void>((ok) => { minuterie = setTimeout(ok, CLOSE_GRACE_MS) })])
  clearTimeout(minuterie)
}
