// cli/agents-md — le bloc MJS de l'`AGENTS.md` d'une appli : entre deux marqueurs, il dit aux assistants d'IA quelle version
// de MJS est installée et où lire sa doc (celle du paquet, la même version). `mjs init` le crée ; `mjs dev` et `mjs check` le
// rétablissent (version périmée, intérieur retouché, bloc retiré remis en fin de fichier). Le reste du fichier ne bouge jamais,
// à l'octet près (BOM et fins de ligne compris). Garde : un bloc mal fermé (début sans fin, fin sans début, deux blocs, fin
// avant début) n'est JAMAIS réécrit — remplacer « du début jusqu'à la fin du fichier » effacerait les consignes que l'auteur
// a écrites après le marqueur. `mjs dev` et `mjs check` ne créent pas de fichier : sans `AGENTS.md`, rien n'est écrit (seul
// `mjs init` le crée). Écriture d'un seul coup, sur la CIBLE du lien : fichier temporaire dans le dossier de la cible, puis
// renommage — un `AGENTS.md` lien symbolique vers `CLAUDE.md` reste un lien, et un lecteur (un autre `mjs check`, `mjs dev`)
// voit l'ancien texte ou le nouveau, jamais un fichier vide ; écrit en place, un lecteur tombé entre la troncature et
// l'écriture lisait un fichier vide et n'y remettait que le bloc. Relu juste avant le renommage : un fichier changé depuis
// la lecture n'est pas écrasé. Trois refus, dits en une ligne, avant toute lecture ou écriture : une cible hors de la racine
// du projet (lien qui mène dehors, même cassé, même par un dossier lié), une cible qui n'est pas un fichier ordinaire, et un
// fichier qui n'est pas en UTF-8 (décodé puis réécrit, il perdrait ses accents). Des marqueurs cités dans un bloc de code
// fermé sont un exemple de l'auteur, pas le bloc. La ligne `<!-- modularjs-agent-rules: off -->`, écrite n'importe où dans le fichier, le retire à MJS : aucune
// commande n'y écrit plus (ni ajout du bloc, ni mise à jour, ni retrait) et chacune le dit en une ligne ; les trois refus passent avant

import { accessSync, chmodSync, constants, lstatSync, readFileSync, readlinkSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync, type Stats } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { t, type MsgKey } from '../messages/index.js'
import { ownPackageVersion } from './package-files.js'

export const AGENTS_FILE  = 'AGENTS.md'
export const AGENTS_BEGIN = '<!-- BEGIN:modularjs-agent-rules -->'
export const AGENTS_END   = '<!-- END:modularjs-agent-rules -->'
/** la ligne qui retire le fichier à MJS : avec elle, aucune commande n'y écrit */
export const AGENTS_OFF   = '<!-- modularjs-agent-rules: off -->'
// reconnue où qu'elle soit (seule sur sa ligne, dans une phrase, dans un bloc de code), sans égard à la casse ni aux espaces : au
// moindre doute, MJS n'écrit pas
const AGENTS_OFF_RE = /<!--\s*modularjs-agent-rules\s*:\s*off\s*-->/i

export type AgentsUpsert =
  | { status: 'created' | 'added' | 'updated' | 'unchanged', text: string }
  | { status: 'refused', reason: 'missing-end' | 'missing-begin' | 'ambiguous', line: number }

export type AgentsSync = AgentsUpsert['status'] | 'absent' | 'changed' | 'error' | 'off'

/** le bloc, marqueurs compris, dans la langue des messages du projet */
export function agentsBlock(version: string): string {
  return AGENTS_BEGIN + '\n' + t('cli.agents-md.block', { version }) + '\n' + AGENTS_END
}

interface Mark { start: number, end: number, line: number }

// les lignes d'un bloc de code fermé, clôtures comprises (``` ou ~~~, refermé par la même clôture, au moins aussi longue). Une
// clôture jamais refermée ne compte pas : le bloc MJS écrit après elle reste reconnu, il n'est pas ajouté une seconde fois
function fencedLines(lines: string[]): Set<number> {
  const out = new Set<number>()
  let start = -1
  let mark  = ''
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*(`{3,}|~{3,})(.*)$/.exec(lines[i])
    if (m === null) continue
    if (start === -1) {
      start = i
      mark  = m[1]
    }
    else if (m[1][0] === mark[0] && m[1].length >= mark.length && m[2].trim() === '') {
      for (let k = start; k <= i; k++) out.add(k)
      start = -1
    }
  }
  return out
}

/** le texte d'`AGENTS.md` (ou `null` : pas de fichier) avec le bloc à jour — ou le refus, et la ligne fautive */
export function upsertAgentsBlock(text: string | null, block: string): AgentsUpsert {
  if (text === null) return { status: 'created', text: block + '\n' }
  // le BOM reste en tête, hors des calculs : un marqueur sur la première ligne ne l'emporte pas avec lui
  const bom  = text.startsWith('\ufeff') ? '\ufeff' : ''
  const body = text.slice(bom.length)
  // les fins de ligne du fichier, à la majorité : une ligne Windows égarée dans un fichier Unix ne change pas celles du bloc
  const crlf     = body.split('\r\n').length - 1
  const eol      = crlf > body.split('\n').length - 1 - crlf ? '\r\n' : '\n'
  const eolBlock = block.split('\n').join(eol)
  const begins   = [] as Mark[]
  const ends     = [] as Mark[]
  let pos        = 0
  let no         = 1
  // un marqueur est une ligne à lui seul, hors de tout bloc de code fermé : cité dans une phrase, du code en ligne ou un exemple
  // entre deux clôtures, il n'en est pas un
  const lines = body.split('\n')
  const code  = fencedLines(lines)
  for (const raw of lines) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    const mark = code.has(no - 1) ? '' : line.trim()
    if (mark === AGENTS_BEGIN) begins.push({ start: pos, end: pos + line.length, line: no })
    else if (mark === AGENTS_END) ends.push({ start: pos, end: pos + line.length, line: no })
    pos += raw.length + 1
    no++
  }
  if (begins.length === 0 && ends.length === 0) {
    // en fin de fichier, séparé par une ligne vide : le texte d'origine reste un préfixe intact
    const sep = body === '' ? '' : body.endsWith('\n') ? eol : eol + eol
    return { status: 'added', text: bom + body + sep + eolBlock + eol }
  }
  if (begins.length === 1 && ends.length === 0) return { status: 'refused', reason: 'missing-end', line: begins[0].line }
  if (begins.length === 0 && ends.length === 1) return { status: 'refused', reason: 'missing-begin', line: ends[0].line }
  if (begins.length !== 1 || ends.length !== 1 || ends[0].start < begins[0].start) {
    return { status: 'refused', reason: 'ambiguous', line: (begins[1] ?? ends[1] ?? ends[0]).line }
  }
  const next = bom + body.slice(0, begins[0].start) + eolBlock + body.slice(ends[0].end)
  return next === text ? { status: 'unchanged', text } : { status: 'updated', text: next }
}

const WRITTEN: Record<'created' | 'added' | 'updated', MsgKey> = {
  created: 'cli.agents-md.created',
  added:   'cli.agents-md.added',
  updated: 'cli.agents-md.updated',
}

const REFUSED: Record<'missing-end' | 'missing-begin' | 'ambiguous', MsgKey> = {
  'missing-end':   'cli.agents-md.refusal-end',
  'missing-begin': 'cli.agents-md.refusal-start',
  ambiguous:       'cli.agents-md.refusal-duplicate',
}

// la cible finale d'un chemin, liens suivis un à un (même cassés : `mjs init` crée alors la cible) — c'est elle qui est
// remplacée, le lien reste un lien
function finalTarget(path: string): string {
  let p = path
  for (let i = 0; i < 40; i++) {
    let link = false
    try { link = lstatSync(p).isSymbolicLink() } catch { return p }
    if (!link) return p
    p = resolve(dirname(p), readlinkSync(p))
  }
  throw Object.assign(new Error(`ELOOP: too many symbolic links, '${path}'`), { code: 'ELOOP' })
}

// la cible de `path` peut-elle recevoir le bloc ? Non hors de la racine du projet (lien qui mène dehors, dossier réel de la cible
// compris : un dossier du projet peut être lui-même un lien), non plus si ce n'est pas un fichier ordinaire (dossier,
// périphérique, tube) — vu avant toute lecture. Une cible pas encore là passe : `mjs init` la crée, dans le projet
function targetRefusal(root: string, path: string): { key: MsgKey, target: string } | null {
  const target = finalTarget(path)
  if (target !== path) {
    let dir = dirname(target)
    try { dir = realpathSync(dir) } catch { /* dossier absent : l'écriture le dira */ }
    const path = relative(realpathSync(root), join(dir, basename(target)))
    if (path === '..' || path.startsWith('..' + sep) || isAbsolute(path)) return { key: 'cli.agents-md.link-outside-project', target }
  }
  let st: Stats
  try { st = statSync(target) } catch { return null }
  return st.isFile() ? null : { key: 'cli.agents-md.target-not-a-file', target }
}

let temporary = 0

/** remplace `path` (la cible du lien, s'il en est un) par `text`, d'un seul coup : fichier temporaire dans le dossier de la
 *  cible, puis renommage. Relu juste avant : changé depuis la lecture (`before`, `null` = pas de fichier), rien n'est
 *  écrit (`changed`). Un fichier à plusieurs liens physiques n'est pas remplacé (`hardlinked` : les noms se sépareraient) ;
 *  sans droit d'écriture, l'erreur remonte, comme toute erreur du disque — le fichier temporaire est toujours retiré */
export function writeAgentsFile(path: string, before: string | null, text: string): 'written' | 'changed' | 'hardlinked' {
  const target = finalTarget(path)
  let mode     = null as number | null
  if (before !== null) {
    const st = statSync(target)
    if (st.nlink > 1) return 'hardlinked'
    // le renommage passerait outre un fichier en lecture seule : son droit d'écriture est demandé d'abord
    accessSync(target, constants.W_OK)
    mode = st.mode & 0o7777
  }
  const tmp = join(dirname(target), `.${basename(target)}.${process.pid}-${++temporary}.tmp`)
  writeFileSync(tmp, text, { flag: 'wx' })
  try {
    if (mode !== null) chmodSync(tmp, mode)
    let now = null as Buffer | null
    try { now = readFileSync(target) }
    catch (e: any) {
      if (e?.code !== 'ENOENT') throw e
    }
    // comparé octet pour octet : un fichier qui a cessé d'être de l'UTF-8 n'est pas « le même » que son texte décodé
    if (before === null ? now !== null : now === null || !now.equals(Buffer.from(before, 'utf-8'))) {
      unlinkSync(tmp)
      return 'changed'
    }
    renameSync(tmp, target)
  }
  catch (e) {
    try { unlinkSync(tmp) } catch { /* déjà retiré */ }
    throw e
  }
  return 'written'
}

/** `<root>/AGENTS.md` : bloc créé (`create`, `mjs init` seulement), ajouté ou mis à jour ; chaque écriture et chaque refus
 *  est dit en une ligne, rien n'est écrit quand le bloc est déjà à jour, ni hors de `root`, ni dans un fichier qui n'est
 *  pas en UTF-8, ni dans un fichier qui porte la ligne `AGENTS_OFF` (dit en une ligne, sur la sortie standard) */
export function syncAgentsMd(root: string, opts: { create: boolean, version?: string | null }): AgentsSync {
  const path = join(root, AGENTS_FILE)
  let text   = null as string | null
  try {
    const reject = targetRefusal(root, path)
    if (reject !== null) {
      console.warn(t(reject.key, { file: AGENTS_FILE, target: reject.target }))
      return 'refused'
    }
    const raw = readFileSync(path)
    text      = raw.toString('utf-8')
    // l'aller-retour n'est pas exact : le fichier n'est pas en UTF-8 (Latin-1, UTF-16…), le réécrire perdrait des octets de l'auteur
    if (!Buffer.from(text, 'utf-8').equals(raw)) {
      console.warn(t('cli.agents-md.encoding', { file: AGENTS_FILE }))
      return 'refused'
    }
  }
  catch (e: any) {
    if (e?.code !== 'ENOENT') {
      console.warn(t('cli.agents-md.error', { file: AGENTS_FILE, error: e?.message ?? String(e) }))
      return 'error'
    }
  }
  // la ligne qui retire le fichier à MJS : rien n'y est écrit, un bloc déjà là reste tel quel — ni erreur ni avertissement
  const off = text === null ? null : AGENTS_OFF_RE.exec(text)
  if (text !== null && off !== null) {
    console.log(t('cli.agents-md.left-as-is', { file: AGENTS_FILE, line: text.slice(0, off.index).split('\n').length, mark: AGENTS_OFF }))
    return 'off'
  }
  if (text === null && !opts.create) return 'absent'
  const version = opts.version === undefined ? ownPackageVersion() : opts.version
  if (version === null) {
    console.warn(t('cli.agents-md.version-unreadable', { file: AGENTS_FILE }))
    return 'error'
  }
  const r = upsertAgentsBlock(text, agentsBlock(version))
  if (r.status === 'refused') {
    console.warn(t(REFUSED[r.reason], { file: AGENTS_FILE, line: r.line, start: AGENTS_BEGIN, end: AGENTS_END }))
    return r.status
  }
  if (r.status === 'unchanged') return r.status
  let written: ReturnType<typeof writeAgentsFile>
  try { written = writeAgentsFile(path, text, r.text) }
  catch (e: any) {
    console.warn(t('cli.agents-md.error', { file: AGENTS_FILE, error: e?.message ?? String(e) }))
    return 'error'
  }
  if (written === 'changed') {
    console.warn(t('cli.agents-md.change-during', { file: AGENTS_FILE }))
    return 'changed'
  }
  if (written === 'hardlinked') {
    console.warn(t('cli.agents-md.hard-links', { file: AGENTS_FILE }))
    return 'refused'
  }
  console.log(t(WRITTEN[r.status], { file: AGENTS_FILE, version }))
  // un fichier déjà là : la ligne qui le fait laisser tel quel
  if (r.status !== 'created') console.log(t('cli.agents-md.prevent', { file: AGENTS_FILE, mark: AGENTS_OFF }))
  return r.status
}
