// render-server — serveur HTTP `mjs serve`.
//
// Enveloppe le handler de rendu (render-request) dans un serveur : sert les assets
// compilés (outputDir) + le bundle, et pour chaque page applique le mode résolu
// (prerender / ssr / csr). Pensé pour un projet MJS autonome ; pour un back existant
// (Rails…), on réutilise plutôt `createRenderHandler` en sidecar/middleware.

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFileSync, existsSync, statSync, realpathSync, openSync, readSync, closeSync, type Stats } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve, relative, isAbsolute, extname, sep, dirname, basename } from 'node:path'
import type { MjsConfig } from '../bundler/config.js'
import { createRenderHandler, type RenderHandler, type RenderResponse } from './render-request.js'
import { resolvePage } from './render-routes.js'
import { createServeEntry, isPlainObject } from './serve-entry.js'
import { escapeJsonForScript } from './renderToString.js'
import { createJournal, type Journal, type RecordServerFn } from './journal.js'
import { handleMutatingRequest, navExtras } from './action-pipeline.js'
import { TokenBucket, pruneIdleBuckets } from './token-bucket.js'
import { getViewerScript, isViewerAllowed, setViewerPageHeaders, isSecureRequest, viewerScriptElement, warnIfJournalViewerOpenInProd, isProdEnv, JOURNAL_VIEWER, THEME_VIEWER } from './viewer-page.js'
import { buildSsrHead } from './ssr-head.js'
import { deriveUrlPrefix, bundleNeighborFiles, MARQUE_SORTIE, CLE_MARQUE_SORTIE, VALEUR_MARQUE_SORTIE } from '../bundler/index.js'
import { readBuildVersion } from './build-version.js'
import { t } from '../messages/index.js'
import { shortFingerprint } from '../bundler/fingerprint.js'
import { createAddressResolver } from '../mjs-ws/trust-proxy.js'

// Exportée : réutilisée telle quelle par render-browser.ts (interception page.route
// du moteur navigateur — mêmes types MIME que le serveur HTTP, une seule source) ET par
// server/index.ts (MIME_TYPES, spread sur celle-ci) — UNE seule table pour les deux serveurs
// `.wasm` manquait aux DEUX consommateurs (octet-stream par défaut), ajoutée ICI
// plutôt que dupliquée localement dans chacun.
export const MIME: Record<string, string> = {
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.html': 'text/html', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
}

/**
 * `/__mjs/<nom>` : un fichier que le build a écrit à côté du manifeste. Le manifeste est servi sous un chemin virtuel
 * (`/__mjs/bundle.js`) ; un fichier unique coupé en morceaux importe ses voisins par un chemin relatif (`./chunk-….js`), qui se
 * lit donc sous `/__mjs/`. Seuls les noms que le registre du build consigne (`bundleNeighborFiles`) sont servis — jamais un autre
 * fichier du dossier du manifeste, jamais un chemin. Rend vrai quand la réponse est partie.
 */
export function serveBundleNeighbor(manifestPath: string | null, nom: string, method: string | undefined, res: ServerResponse): boolean {
  if (!manifestPath || (method !== 'GET' && method !== 'HEAD')) return false
  if (!bundleNeighborFiles(manifestPath).includes(nom)) return false
  let contenu: Buffer
  try { contenu = readFileSync(join(dirname(manifestPath), nom)) } catch { return false }
  res.statusCode = 200
  res.setHeader('Content-Type', nom.endsWith('.map') ? 'application/json' : 'text/javascript')
  res.end(method === 'HEAD' ? undefined : contenu)
  return true
}

export interface RenderServerOptions { port?: number; host?: string; /** environnement du build (`mjs serve --prod`) — le rendu par requête RECOMPILE dans le vrai dossier de sortie */ env?: 'dev' | 'prod' }
export interface RunningServer { server: Server; port: number; close(): Promise<void> }

// L'ancien garde-fou d'asset était
// `asset.startsWith(outputDir)`, un simple préfixe de CHAÎNE, sans vérifier
// de séparateur de chemin : si `outputDir` vaut `.../dist`, un chemin résolu
// en `.../dist-secret/x` (dossier FRÈRE, hors de `outputDir`) COMMENCE PAR la
// même chaîne `.../dist` et passait donc le test à tort. Fix :
// `path.relative(base, target)` — si le résultat commence par `..` (ou est
// absolu, cas Windows multi-lecteurs), `target` est RÉELLEMENT hors de
// `base`, indépendamment de toute coïncidence de préfixe textuel. Exportée
// pour test direct (le seul appelant actuel reçoit un `pathname` déjà
// normalisé par `new URL()`, qui élimine `..` en amont — ce garde-fou reste
// une défense en profondeur pour tout futur appelant moins prudent).
// empreintes déjà vérifiées, par fichier : taille et date de modification d'alors, verdict ; au plus VERDICTS_MAX (cf.
// isServableFile), le plus ancien sort
const empreintesVerifiees = new Map<string, { cle: string, ok: boolean }>()

/** Vrai si ce fichier porte l'empreinte que le build écrit juste avant l'extension, donc ne change jamais sous ce nom (cache d'un
 *  an) : `<base>-<5 caractères base 36>`, empreinte courte du contenu (bundler/fingerprint.ts), ou `<base>-<8 hexadécimaux>`, début
 *  du md5 du contenu (images, fichiers copiés, feuilles du rendu). L'une et l'autre ne sont crues qu'après vérification sur le
 *  contenu même, avec ou sans la ligne `sourceMappingURL` que le build ajoute après l'avoir calculée : un nom d'auteur qui leur
 *  ressemble (`main-style.css`, `photo-2024a.jpg`, `facture-20241019.pdf`) n'est jamais immuable, et une empreinte sans chiffre
 *  (`mjs_core-hymif.js`) l'est. Les morceaux d'un fichier unique, nommés par le build d'après le nom que leur donne esbuild (lui-même
 *  tiré de leur contenu), sont crus sur le registre des sorties qui les consigne (`.mjs-outputs.json`, clé `chunks`). Une carte
 *  `.map` garde le nom de son script même quand elle change : jamais immuable. Verdict mémorisé tant que le fichier garde sa taille
 *  et sa date, 4096 verdicts au plus (le plus ancien sort). */
export function isBuildFingerprinted(file: string): boolean {
  const nom = basename(file)
  if (nom.endsWith('.map')) return false
  const m = nom.match(/-([a-f0-9]{8})\.[0-9a-z]+$/) ?? nom.match(/-([0-9a-z]{5})\.[0-9a-z]+$/)
  if (!m) return false
  const empreinte = m[1].length === 8 ? (c: Buffer): string => createHash('md5').update(c).digest('hex').slice(0, 8) : shortFingerprint
  try {
    const st  = statSync(file)
    const cle = st.size + ':' + st.mtimeMs
    const vu  = empreintesVerifiees.get(file)
    if (vu && vu.cle === cle) return vu.ok
    const contenu = readFileSync(file)
    const fin     = Buffer.from(`\n//# sourceMappingURL=${nom}.map\n`)
    const ok      = empreinte(contenu) === m[1] || (contenu.length > fin.length && contenu.subarray(contenu.length - fin.length).equals(fin) && empreinte(contenu.subarray(0, contenu.length - fin.length)) === m[1]) || (m[1].length === 8 && bundleNeighborFiles(file).includes(nom))
    if (!vu && empreintesVerifiees.size >= VERDICTS_MAX) empreintesVerifiees.delete(empreintesVerifiees.keys().next().value as string)
    empreintesVerifiees.set(file, { cle, ok })
    return ok
  } catch {
    return false
  }
}

export function isWithinDir(base: string, target: string): boolean {
  const rel = relative(base, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** `isWithinDir` raisonne sur le TEXTE du chemin : un LIEN SYMBOLIQUE
 *  posé dans le dossier servi et pointant ailleurs le traverse sans jamais écrire `..` (prouvé :
 *  lien vers un fichier système, servi en 200 avec son contenu réel). Ce garde-ci compare les
 *  chemins RÉELS, liens résolus DES DEUX CÔTÉS — la racine elle-même vit souvent derrière un lien
 *  (déploiement `current -> releases/…`), la résoudre d'un seul côté rendrait 404 sur tout.
 *  À utiliser juste avant de LIRE un fichier ; `isWithinDir` reste bon pour un chemin qui n'existe
 *  pas encore. Chemin irrésoluble (fichier disparu entre deux appels) → refusé : en cas de doute, 404. */
export function isRealPathWithin(base: string, target: string): boolean {
  try {
    const realBase = realpathSync(base)
    const realFile = realpathSync(target)
    return realFile === realBase || realFile.startsWith(realBase.endsWith(sep) ? realBase : realBase + sep)
  } catch { return false }
}

// Racine du PROJET servie par `mjs dev` sans bloc `render` : ce qu'un navigateur charge sort, les
// SECRETS d'une appli voisine (Rails, Node…) jamais. Liste FERMÉE de ce qui est refusé, quelle que
// soit l'extension : segment caché (`.git`, `.env`…), dossiers privés (à toute profondeur ; `app/` et
// `server/` à la racine, sources de l'appli et du serveur), fichiers de configuration du projet, à la
// racine même tout `.json` et les entrées serveur (`ws.js`, `serveur.js`, `server.mjs`, entrées
// déclarées dans la configuration), fichiers serveur `*.server.*`, extensions des clés, de la
// configuration, des sources serveur, des journaux, bases et sauvegardes, fichier sans extension
// (`Gemfile`, `id_rsa`). Noms comparés comme les lit un disque insensible à la casse (macOS, Windows) :
// sans la casse, sans les points et espaces de fin que Windows ignore ; `:` (flux NTFS), `~` (noms
// courts 8.3, sauvegardes) et l'antislash (séparateur Windows) refusés.
const PRIVATE_DIRS = new Set(['config', 'log', 'logs', 'tmp', 'db', 'storage', 'node_modules'])
const ROOT_PRIVATE_DIRS = new Set(['app', 'server'])
const PRIVATE_FILES = new Set(['mjs.config.json', 'package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'composer.json', 'composer.lock', 'tsconfig.json', 'jsconfig.json'])
// à la racine même : entrées que `mjs ws` et `mjs serveur` cherchent sans `.server.` (leurs variantes `.civet` sont déjà des
// sources serveur) et entrée usuelle d'une appli Node, pendant du dossier `server/`
const ROOT_SERVER_FILES = new Set(['ws.js', 'serveur.js', 'server.js', 'server.mjs'])
const SECRET_EXTENSIONS = new Set([
  // clés et certificats privés
  '.key', '.pem', '.p8', '.p12', '.pfx', '.jks', '.keystore', '.ppk', '.gpg', '.pgp', '.kdbx', '.enc',
  // configuration
  '.env', '.yml', '.yaml', '.toml', '.ini', '.conf', '.cfg', '.cnf', '.config', '.properties', '.lock', '.tfvars', '.tfstate',
  // sources serveur
  '.rb', '.erb', '.rake', '.ru', '.gemspec', '.haml', '.slim', '.php', '.phtml', '.py', '.pyc', '.pl', '.pm', '.cgi', '.go', '.rs', '.java', '.kt', '.scala', '.cs', '.ex', '.exs', '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd', '.ts', '.mts', '.cts', '.cjs', '.civet', '.coffee',
  // journaux, bases, sauvegardes
  '.log', '.sql', '.sqlite', '.sqlite3', '.db', '.dump', '.bak', '.backup', '.old', '.orig', '.save', '.swp',
])

/** Vrai si ce chemin sous la racine du projet (segments de l'URL décodée, ou du chemin réel) peut
 *  être servi par `mjs dev` — et par les deux serveurs quand le dossier de sortie est la racine du projet (cf. isProjectFileRefused).
 *  Exportée pour test direct. */
export function isBrowserResource(segments: string[]): boolean {
  const noms = segments.flatMap(s => s.split('\\')).filter(Boolean).map(s => s.toLowerCase().replace(/[. ]+$/, ''))
  if (noms.length === 0) return false
  if (noms.some(s => s === '' || s.startsWith('.') || s.includes(':') || s.includes('~') || PRIVATE_DIRS.has(s))) return false
  if (noms.length > 1 && ROOT_PRIVATE_DIRS.has(noms[0])) return false
  const nom = noms[noms.length - 1]
  if (PRIVATE_FILES.has(nom) || /^tsconfig\..*\.json$/.test(nom) || /\.server\.[^.]+$/.test(nom)) return false
  const ext = extname(nom)
  // à la racine même : aucun JSON (`secrets.json`, `credentials.json`…), aucune entrée serveur ; un JSON que la page charge vit dans un dossier
  if (noms.length === 1 && (ext === '.json' || ROOT_SERVER_FILES.has(nom))) return false
  return ext !== '' && !SECRET_EXTENSIONS.has(ext)
}

// une liste de pré-cache plus lourde n'est pas lue
const MAX_PRECACHE_OCTETS = 4 * 1024 * 1024

// sortie que le build écrit lui-même, reconnue à son contenu : nom qui porte l'empreinte vérifiée du contenu (cœur, fichiers de
// messages, images…), marque des sorties à nom fixe en première ligne (manifeste, feuilles de variante ; jamais un `.json`), ou
// `mjs-precache.json` réduit à `version` et `assets` (marqué ou non : la forme qu'il a quand la sortie n'est pas dans les sources)
function isBuildOutput(fichier: string): boolean {
  if (isBuildFingerprinted(fichier)) return true
  try {
    if (basename(fichier) === 'mjs-precache.json') {
      if (statSync(fichier).size > MAX_PRECACHE_OCTETS) return false
      const lu = JSON.parse(readFileSync(fichier, 'utf-8'))
      if (lu === null || typeof lu !== 'object' || Array.isArray(lu)) return false
      const cles = Object.keys(lu).filter(k => !(k === CLE_MARQUE_SORTIE && lu[k] === VALEUR_MARQUE_SORTIE)).sort().join(',')
      return cles === 'assets,version' && typeof lu.version === 'string' && Array.isArray(lu.assets) && lu.assets.every((a: unknown) => typeof a === 'string')
    }
    if (extname(fichier).toLowerCase() === '.json') return false
    const tete = Buffer.alloc(MARQUE_SORTIE.length + 2)
    const fd   = openSync(fichier, 'r')
    let lus: number
    try {
      lus = readSync(fd, tete, 0, tete.length, 0)
    } finally {
      closeSync(fd)
    }
    const debut = tete.subarray(0, lus).toString('latin1')
    return debut === MARQUE_SORTIE || debut === MARQUE_SORTIE + '\r' || debut === MARQUE_SORTIE + '\r\n' || debut.startsWith(MARQUE_SORTIE + '\n')
  } catch {
    return false
  }
}

/** Entrées serveur déclarées dans la configuration (`ws.entry`, `serveur.entry`, `render.entry`, résolues depuis `base`, le dossier
 *  de mjs.config.json), rangées n'importe où sous n'importe quel nom : comparées au fichier demandé par leur chemin réel, sans la
 *  casse (cf. isBrowserResource). */
export function isDeclaredServerEntry(fichierReel: string, config: MjsConfig | null | undefined, base: string): boolean {
  return [config?.ws?.entry, config?.serveur?.entry, config?.render?.entry].some((entree) => {
    if (typeof entree !== 'string' || entree === '') return false
    let chemin = resolve(base, entree)
    try { chemin = realpathSync.native(chemin) } catch { /* absente : comparée telle que déclarée */ }
    return chemin.toLowerCase() === fichierReel.toLowerCase()
  })
}

/** `mjs dev` et `mjs serve` : vrai si ce fichier du dossier servi `dossier` ne doit pas sortir, parce que ce dossier est la racine du
 *  projet ou la contient (`"outputDir": "."`) et porte donc aussi les secrets de l'appli. Même règle que la racine du projet servie
 *  par `mjs dev` (cf. isBrowserResource), sur le chemin réel, plus les entrées serveur déclarées ; les sorties que le build écrit
 *  lui-même restent servies (cf. isBuildOutput). Un dossier de sortie dédié (`public/modularjs`) reste servi tel quel. Chemin
 *  illisible : refusé. */
export function isProjectFileRefused(fichier: string, dossier: string, projectRoot: string | null, config: MjsConfig | null | undefined, configDir: string | null | undefined): boolean {
  if (!projectRoot || !isRealPathWithin(dossier, projectRoot)) return false
  try {
    const reel   = realpathSync.native(fichier)
    const projet = realpathSync.native(projectRoot)
    const base   = isRealPathWithin(projet, reel) ? projet : realpathSync.native(dossier)
    if (isDeclaredServerEntry(reel, config, configDir ?? projectRoot)) return true
    if (isBrowserResource(relative(base, reel).split(sep))) return false
    const ext = extname(reel).toLowerCase()
    return ext === '' || SECRET_EXTENSIONS.has(ext) || !isBuildOutput(reel)
  } catch {
    return true
  }
}

// verdicts favorables déjà rendus, par chemin demandé (cf. verdictGarde) : au plus VERDICTS_MAX, le plus ancien sort
const VERDICTS_MAX   = 4096
const verdictsServis = new Map<string, VerdictGarde>()
// un numéro par objet de configuration : un verdict ne passe jamais d'une configuration à une autre
const numerosConfig = new WeakMap<object, number>()
let configsVues     = 0

interface IdentiteFichier { dev: number, ino: number, size: number, mtimeMs: number, ctimeMs: number }
// endroit réel du chemin demandé et du dossier servi, liens résolus
interface EndroitReel { reel: string, base: string }
type VerdictGarde = IdentiteFichier & EndroitReel

function memeFichier(a: IdentiteFichier, b: IdentiteFichier): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs
}

// chemins réels du fichier demandé et du dossier servi, par la forme native (un appel système chacun) ; irrésoluble : null
function endroitReel(fichier: string, dossier: string): EndroitReel | null {
  try { return { reel: realpathSync.native(fichier), base: realpathSync.native(dossier) } } catch { return null }
}

function memeEndroit(a: EndroitReel | null, b: EndroitReel | null): boolean {
  return a !== null && b !== null && a.reel === b.reel && a.base === b.base
}

function numeroConfig(config: MjsConfig | null | undefined): number {
  if (!config) return 0
  let numero = numerosConfig.get(config) ?? 0
  if (numero === 0) { numero = ++configsVues; numerosConfig.set(config, numero) }
  return numero
}

/** Verdict gardé d'un fichier ordinaire `fichier`, demandé sous le dossier servi `dossier` : `controle` (des dizaines de µs, ses
 *  chemins réels résolus par la forme JavaScript) ne tourne qu'à la première demande, et de nouveau dès que le chemin ne mène plus au
 *  même endroit réel ou au même fichier inchangé. À chaque demande sont relus, en 5 µs environ : l'identité du fichier (appareil, inode, taille, dates de modification et de changement d'état, par
 *  un seul stat qui suit les liens), et les chemins réels du fichier et du dossier servi (forme native). Un lien posé après coup sur
 *  le fichier ou sur un dossier du chemin, le dossier servi compris, mène à un autre fichier ou à un autre endroit réel — même un
 *  dossier déplacé hors du dossier servi puis remplacé par un lien vers lui, qui garde le même fichier ; un fichier réécrit ou
 *  remplacé (sortie reconstruite, `mjs dev` qui recompile) change de dates : tout est alors vérifié de nouveau. Un verdict n'est
 *  gardé que si rien n'a bougé pendant sa vérification ; un refus ne l'est jamais. Absent, dossier, illisible : faux. */
function verdictGarde(cle: string, fichier: string, dossier: string, controle: () => boolean): boolean {
  let avant: Stats | undefined
  try { avant = statSync(fichier, { throwIfNoEntry: false }) } catch { return false }
  if (!avant || !avant.isFile()) return false
  const vu = verdictsServis.get(cle)
  if (vu && memeFichier(vu, avant) && memeEndroit(vu, endroitReel(fichier, dossier))) return true
  if (vu) verdictsServis.delete(cle)
  const endroit = endroitReel(fichier, dossier)
  try {
    if (!controle()) return false
  } catch {
    return false
  }
  let apres: Stats | undefined
  try { apres = statSync(fichier, { throwIfNoEntry: false }) } catch { apres = undefined }
  if (endroit && apres && memeFichier(apres, avant) && memeEndroit(endroit, endroitReel(fichier, dossier))) {
    if (verdictsServis.size >= VERDICTS_MAX) verdictsServis.delete(verdictsServis.keys().next().value as string)
    verdictsServis.set(cle, { dev: avant.dev, ino: avant.ino, size: avant.size, mtimeMs: avant.mtimeMs, ctimeMs: avant.ctimeMs, reel: endroit.reel, base: endroit.base })
  }
  return true
}

/** Vrai si `fichier`, demandé sous le dossier servi `dossier`, est un fichier ordinaire qui peut sortir : dans ce dossier par son
 *  texte (cf. isWithinDir) et par son chemin réel (cf. isRealPathWithin), et pas un secret du projet quand ce dossier est la racine
 *  du projet (cf. isProjectFileRefused ; `projectRoot` nul : sans objet). Verdict gardé par chemin demandé (cf. verdictGarde). */
export function isServableFile(fichier: string, dossier: string, projectRoot: string | null, config: MjsConfig | null | undefined, configDir: string | null | undefined): boolean {
  const cle = dossier + '\0' + (projectRoot ?? '') + '\0' + (configDir ?? '') + '\0' + numeroConfig(config) + '\0' + fichier
  return verdictGarde(cle, fichier, dossier, () => isWithinDir(dossier, fichier) && isRealPathWithin(dossier, fichier) && !isProjectFileRefused(fichier, dossier, projectRoot, config, configDir))
}

/** `mjs dev` qui sert la racine du projet `projectRoot` (sans bloc `render`) : vrai si `fichier` est un fichier ordinaire qui peut
 *  sortir — dans la racine par son chemin réel (un lien posé dans la racine et pointant ailleurs en sort sans jamais écrire `..`),
 *  ressource de navigateur sur ce chemin réel (cf. isBrowserResource : un lien vers `config/`, un nom que le disque lit autrement,
 *  casse ou nom court 8.3 sous Windows, ne la contournent pas), et aucune entrée serveur déclarée dans la configuration, quel que
 *  soit son nom. Verdict gardé par chemin demandé, comme celui d'isServableFile (cf. verdictGarde). */
export function isProjectRootFileServable(fichier: string, projectRoot: string, config: MjsConfig | null | undefined, configDir: string | null | undefined): boolean {
  const cle = '\0racine\0' + projectRoot + '\0' + (configDir ?? '') + '\0' + numeroConfig(config) + '\0' + fichier
  return verdictGarde(cle, fichier, projectRoot, () => {
    if (!isRealPathWithin(projectRoot, fichier)) return false
    const reel = realpathSync.native(fichier)
    return isBrowserResource(relative(realpathSync.native(projectRoot), reel).split(sep)) && !isDeclaredServerEntry(reel, config, configDir ?? projectRoot)
  })
}

/** Shell HTML minimal : enveloppe le rendu d'une page + charge le bundle client.
 *  Exportée : réutilisée telle quelle par server/index.ts (`mjs dev` + bloc
 *  `render`, feature render.routes en dev) — même enveloppe que `mjs serve`,
 *  une seule source. `lang` (défaut 'fr') : langue statique de `<html lang>`,
 *  résolue par l'appelant depuis `config.i18n.default` — sans store passé au
 *  renderer, la langue SSR effective est TOUJOURS `i18n.default` (jamais de
 *  mismatch). Par-visiteur (Accept-Language/cookie) : hors périmètre ici.
 *  `extraScript` (défaut '') : contenu additionnel posé APRÈS le
 *  `<script src>` du bundle — SEUL consommateur aujourd'hui, la visionneuse du
 *  journal d'erreurs (son JS compilé inline, cf. viewer-page.ts) ; chaîne vide
 *  = sortie BYTE-identique à avant pour tous les appelants existants.
 *  `headExtra` (défaut '') : contenu posé JUSTE AVANT `</head>` —
 *  SEUL consommateur aujourd'hui, le `<style data-mjs-ssr-head>` construit par
 *  ssr-head.ts (thème inliné, anti-flash SSR) ; chaîne vide = sortie
 *  BYTE-identique à avant pour tous les appelants existants. */
export function shell(body: string, bundleUrl: string, lang: string = 'fr', extraScript: string = '', headExtra: string = ''): string {
  return '<!doctype html>\n<html lang="' + lang + '">\n' +
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' + headExtra + '</head>\n' +
    '<body>\n' + body + '\n<script type="module" src="' + bundleUrl + '"></script>\n' + extraScript + '</body>\n</html>\n'
}

// `readBuildVersion` (+ son cache par mtime) vivait ICI, avant d'être DÉPLACÉE dans
// build-version.ts, sans changer une ligne de son corps, pour que `mjs dev` tague ses entrées de
// journal avec la même valeur (cf. l'en-tête de ce fichier-là). Import seul ci-dessus.

// navExtras vivait ICI ; déplacée dans action-pipeline.ts (partagée avec `mjs dev`),
// sans changer une ligne de son corps. Import seul ci-dessus.

// Sérialise µres (props résolues par le chargeur .server.mjs) pour le 1er chargement HTML :
// balise consommée UNE fois au boot client (mjs_store_globals.ts), le chemin JSON de nav reprend la
// main ensuite. Props vides → chaîne vide (zéro octet ajouté, cf. appelant). Échec de sérialisation
// (référence circulaire...) → chaîne vide + avertissement, jamais un 500 (même défense que
// serializeGlobal, renderToString.ts, dont on réutilise l'échappement — escapeJsonForScript).
function resScript(pathname: string, props: Record<string, unknown>): string {
  if (Object.keys(props).length === 0) return ''
  try {
    const json = JSON.stringify(props)
    return `<script type="application/json" id="__mjs_res">${escapeJsonForScript(json)}</script>`
  } catch (e: any) {
    console.warn(t('server.res-serialisation-echec', { pathname, erreur: e && e.message ? e.message : String(e) }))
    return ''
  }
}

// MUTATING_METHODS et parseMultipart vivaient ICI ; déplacés dans action-pipeline.ts
// (partagée avec `mjs dev`), sans changer une ligne de leur corps. Import (MUTATING_METHODS via
// handleMutatingRequest) ci-dessus.

// (étage 2, POST /__mjs/errors) — seau à jetons par IP — CLASSE PARTAGÉE,
// cf. token-bucket.ts (portait ici une copie locale, comme server/index.ts) : ~10 jetons, recharge
// 30/min (0.5/s) — cf. le patron d'appel dans startRenderServer.

/** Lit un corps borné à `maxBytes` et répond ELLE-MÊME dès qu'elle refuse : dépassement (413) ou
 *  lecture interrompue en route ('error'/'aborted' — panne réseau, client qui abandonne, 400,
 *  AVANT toute mutation) ; rend `null` dans les deux cas, le corps complet sinon (`Buffer.concat`
 *  déjà fait). Exportée pour test direct (faux req/res), même motif que listenOrReject. */
export function readCappedBody(req: IncomingMessage, res: ServerResponse, maxBytes: number): Promise<Buffer | null> {
  const chunks: Buffer[] = []
  let total = 0
  // posé AVANT tout effet de bord (jamais dans un `finish()` appelé en dernier) : req.destroy()
  // plus bas redéclenche 'error' DANS LE MÊME TOUR — un drapeau posé trop tard laissait passer
  // une 2e écriture sur `res` déjà terminée (write after end)
  let settled = false
  return new Promise<Buffer | null>((resolve) => {
    req.on('data', (chunk: Buffer) => {
      if (settled) return
      total += chunk.length
      if (total > maxBytes) {
        settled = true
        res.statusCode = 413
        res.setHeader('Connection', 'close')
        res.end('Payload Too Large')
        req.destroy()
        resolve(null); return
      }
      chunks.push(chunk)
    })
    req.on('end', () => { if (settled) return; settled = true; resolve(Buffer.concat(chunks)) })
    // corps interrompu en route : un JSON déjà complet dans les chunks reçus (coupure juste
    // après, avant le 'end' propre) passerait quand même le JSON.parse de l'appelant et
    // journaliserait une entrée sur un corps que le client n'a jamais fini d'envoyer
    req.on('error', () => { if (settled) return; settled = true; res.statusCode = 400; res.end('Bad Request'); resolve(null) })
    req.on('aborted', () => { if (settled) return; settled = true; res.statusCode = 400; res.end('Bad Request'); resolve(null) })
  })
}

/** Attend qu'un serveur commence à écouter, ou rejette proprement (port déjà pris, permission
 *  refusée…) — même patron que StaticServer.start (server/index.ts) : écouteur 'error' posé
 *  AVANT listen(), sinon l'exception échappe au process entier au lieu de rejeter cette promesse.
 *  Exportée pour test direct (faux serveur), même motif que isWithinDir/isRealPathWithin. */
export function listenOrReject(server: Pick<Server, 'listen' | 'on'>, port: number, host: string): Promise<void> {
  return new Promise<void>((ok, reject) => {
    server.on('error', reject)
    server.listen(port, host, ok)
  })
}

export async function startRenderServer(
  config: MjsConfig, configDir: string, opts: RenderServerOptions = {},
): Promise<RunningServer> {
  const port = opts.port ?? 3000
  const host = opts.host ?? '127.0.0.1'
  // hôte IPv6 (`::1`, `::`) : entre crochets dans une URL — `http://::1` est invalide, et chaque
  // requête répondait 500
  const hoteUrl = host.includes(':') && !host.startsWith('[') ? '[' + host + ']' : host
  const outputDir = resolve(configDir, config.outputDir || 'dist')
  // Manifeste servi sous `/__mjs/bundle.js` : celui que le projet déclare, sinon le défaut du
  // bundler (`public/modularjs/bundle.js`, relatif à la racine du projet) — `mjs build` et
  // `mjs dev` passent déjà celui de LEUR bundler, ce serveur-ci ne le dérivait pas : un projet
  // qui ne déclare pas `manifestPath` servait une page dont le propre `<script src>` rendait 404.
  // Le défaut n'est retenu que s'il EXISTE : sans fichier, on garde `null` comme avant.
  const manifestDeclare = config.manifestPath ? resolve(configDir, config.manifestPath) : null
  const manifestDefaut  = resolve(configDir, 'public/modularjs/bundle.js')
  const manifestPath    = manifestDeclare ?? (existsSync(manifestDefaut) ? manifestDefaut : null)
  // Préfixe PUBLIC sous lequel ce serveur monte le dossier de sortie : celui que le projet
  // déclare, sinon celui que le bundler DÉRIVE de ce même dossier — même fonction, donc même
  // réponse des deux côtés. Un `|| ''` montait tout à la racine pendant que les URLs ÉCRITES
  // (manifeste, feuilles du rendu) portaient, elles, le préfixe dérivé : chaque asset que la page
  // référençait tombait alors à côté. Une chaîne VIDE déclarée reste une réponse, elle : le projet
  // dit alors « sers à la racine », et `??` la respecte.
  const urlPrefix = config.urlPrefix ?? deriveUrlPrefix(outputDir)

  // Journal d'erreurs 3 étages. Le MAGASIN (createJournal) est TOUJOURS créé (coût nul tant
  // qu'aucun fichier n'est lu/écrit, cf. journal.ts) : ce qui est débrayable ÉTAGE PAR ÉTAGE, c'est
  // le BRANCHEMENT — capture serveur (`journal.server`, défaut true), canal client (`journal.client`,
  // défaut false), visionneuse (`journal.viewer`, défaut true hors prod). `recordServer` est
  // PRÉ-GATÉ une seule fois ici (no-op si l'étage serveur est coupé) : aucun des 5 points de capture
  // n'a besoin de retester la config lui-même — cf. RecordServerFn (journal.ts).
  const journalCfg = config.journal
  // `opts.env` (drapeau --prod du CLI) manquait ICI, seul NODE_ENV comptait :
  // même patron que la garde /__mjs/theme jumelle plus bas (isProdEnv(opts.env), déjà fermée).
  warnIfJournalViewerOpenInProd(journalCfg?.viewer, opts.env) // une fois au démarrage, cf. viewer-page.ts
  const journalServerEnabled = journalCfg?.server !== false
  const journalClientEnabled = journalCfg?.client === true
  const journalStore: Journal = createJournal({ dir: join(configDir, 'log'), maxEntries: journalCfg?.maxEntries, maxBytes: journalCfg?.maxBytes, maxDays: journalCfg?.maxDays })
  const recordServer: RecordServerFn = journalServerEnabled
    ? (input) => journalStore.record('server', { ...input, version: readBuildVersion(manifestPath) })
    : () => {}
  // seau à jetons PAR IP (POST /__mjs/errors, étage 2) — état propre à CE serveur (jamais partagé entre
  // deux instances, ex. deux tests concurrents) ; ~10 jetons, recharge 30/min (0.5/s).
  const errorsRateLimit = new Map<string, TokenBucket>()
  // adresse du visiteur derrière un proxy de confiance (`journal.trustProxy`), sinon celle de la socket
  const adresseVisiteur = createAddressResolver(journalCfg?.trustProxy)

  const handler: RenderHandler = await createRenderHandler(config, configDir, recordServer, opts.env)
  // Chargeurs de props/actions `.server.mjs` (cf. serve-entry.ts) : couture posée par
  // `loadPropsFor`, remplacée par entry.propsFor ci-dessous ; entry.close() au close() du serveur.
  const entry = await createServeEntry(config, configDir, recordServer)

  const server = createServer(async (req, res) => {
    try {
      // `new URL('//p/42', base)` avale `p` comme host WHATWG (routage voit `/42`) — normalise les
      // slashs de tête AVANT résolution (reste du chemin + query intacts). RÉUTILISÉE
      // (jamais `req.url` brut) pour le champ `url` des deux réponses JSON du protocole plus bas :
      // sans cette normalisation ici aussi, un client recevait `//p/42` (lu comme protocole-relatif).
      const reqUrl = (req.url || '/').replace(/^\/{2,}/, '/')
      const url = new URL(reqUrl, 'http://' + hoteUrl)
      // Un pourcentage malformé (`/%zz`) fait JETER `decodeURIComponent` (URIError) :
      // sans ce filet, seul le catch global (bas de fichier) l'attrapait → 500 silencieux
      // pour ce qui n'est qu'une requête mal formée, jamais une erreur serveur réelle.
      let pathname: string
      try {
        pathname = decodeURIComponent(url.pathname)
      } catch {
        res.statusCode = 400
        res.end('Bad Request'); return
      }

      // (path traversal) — `new URL()`
      // ne normalise PAS les séparateurs encodés `%2f` : `/%2e%2e%2f%2e%2e%2fx`
      // reste tel quel dans `.pathname` (le `%2f` empêche la reconnaissance du
      // segment `..`), puis `decodeURIComponent` le transforme en `/../../x`.
      // Ce `..` échappait ensuite de `outputDir` (asset) ET de `pagesDir` (page
      // prérendue via une route catch-all `*`) → lecture de fichier ARBITRAIRE
      // servie au client. On rejette tout `..`/NUL APRÈS décodage, avant le
      // moindre accès disque (même défense que `index.ts`, jusqu'ici absente ici).
      if (pathname.includes('..') || pathname.includes('\0')) {
        res.statusCode = 400
        res.end('Bad Request'); return
      }

      // Bundle à un chemin fixe (référencé par le shell autonome).
      if (pathname === '/__mjs/bundle.js' && manifestPath && existsSync(manifestPath)) {
        res.setHeader('Content-Type', 'text/javascript')
        res.end(readFileSync(manifestPath)); return
      }
      // fichiers voisins du manifeste (fichier unique coupé en morceaux) : seulement ceux que le build a consignés
      if (pathname.startsWith('/__mjs/') && serveBundleNeighbor(manifestPath, pathname.slice('/__mjs/'.length), req.method, res)) return
      // Journal d'erreurs : POST (dépôt client, étage 2) + GET page/.json + DELETE (purge, étage 3).
      // POST suit SA PROPRE porte (`journal.client`) ; les 3 autres suivent la RÈGLE VIEWER
      // (isViewerAllowed) — refus TOUJOURS un 404 indistinct, jamais un 403 (cf. viewer-page.ts).
      if (pathname === '/__mjs/errors' && req.method === 'POST') {
        if (journalClientEnabled) {
          // a. seau à jetons par IP — même défense que bridge.ts:clientIp (jamais X-Forwarded-For,
          // trivialement falsifiable par l'appelant lui-même).
          const ip = adresseVisiteur(req.socket.remoteAddress, req.headers) ?? 'inconnue'
          let bucket = errorsRateLimit.get(ip)
          if (!bucket) {
            pruneIdleBuckets(errorsRateLimit)   // purge avant croissance, cf. token-bucket.ts
            bucket = new TokenBucket(10, 0.5); errorsRateLimit.set(ip, bucket)
          }
          if (!bucket.take()) { res.statusCode = 429; res.end('Too Many Requests'); return }
          // b. corps plafonné à 64 Ko (même patron que le plafond 1 Mo du bloc MUTANTS plus bas,
          // fenêtre bien plus étroite — ce n'est qu'un rapport d'erreur, jamais un formulaire) ;
          // refuse aussi une lecture interrompue en route, cf. readCappedBody.
          const corps = await readCappedBody(req, res, 65_536)
          if (corps === null) return
          // c. JSON strict (sinon 400) — AUCUNE interprétation/évaluation du contenu, juste des
          // champs copiés un à un, chacun plafonné et retypé défensivement.
          let payload: unknown
          try {
            payload = JSON.parse(corps.toString('utf-8'))
          } catch {
            res.statusCode = 400; res.end('Bad Request'); return
          }
          if (!isPlainObject(payload)) { res.statusCode = 400; res.end('Bad Request'); return }
          const p = payload as Record<string, unknown>
          const message  = typeof p.message === 'string' ? p.message.slice(0, 2048) : ''
          const pile     = typeof p.pile === 'string' ? p.pile.slice(0, 8192) : ''
          const errUrl   = typeof p.url === 'string' ? p.url.slice(0, 2048) : ''
          const version  = typeof p.version === 'string' ? p.version.slice(0, 32) : null
          const uaHeader = req.headers['user-agent']
          const ua       = typeof uaHeader === 'string' ? uaHeader.slice(0, 256) : undefined
          // d. source FORCÉE 'client' — `p.source` n'est JAMAIS lu : un payload menteur
          // (`source: 'server'`) est ignoré PAR CONSTRUCTION, pas par un filtre a posteriori.
          journalStore.record('client', { message, pile, url: errUrl, version, ua })
          res.statusCode = 204
          res.end()
          return
        }
        // étage client coupé : NE PAS intercepter — retombe dans le pipeline normal plus bas
        // (aucune action `.server.mjs` déclarée pour ce pathname ⇒ 405 par le bloc MUTANTS).
      } else if (pathname === '/__mjs/errors' || pathname === '/__mjs/errors.json') {
        if (req.method === 'GET' || req.method === 'DELETE') {
          // `opts.env` manquait ICI aussi (même bogue que warnIfJournalViewerOpenInProd
          // plus haut) : un `--prod` sans NODE_ENV laissait cette route ouverte en production réelle.
          if (!isViewerAllowed(journalCfg?.viewer, url, opts.env, req.headers.cookie)) {
            res.statusCode = 404; res.end('Not Found'); return
          }
          if (pathname === '/__mjs/errors.json' && req.method === 'GET') {
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify(journalStore.list()))
            return
          }
          if (pathname === '/__mjs/errors' && req.method === 'GET') {
            try {
              const script = await getViewerScript(manifestPath, JOURNAL_VIEWER, outputDir)
              res.statusCode = 200
              setViewerPageHeaders(res, journalCfg?.viewer, url, isSecureRequest(req, journalCfg?.trustProxy))
              res.setHeader('Content-Type', 'text/html; charset=utf-8')
              res.end(shell('', '/__mjs/bundle.js', config.i18n?.default || 'fr', viewerScriptElement(script, JOURNAL_VIEWER)))
            } catch (e: any) {
              console.error(t('server.journal-viewer-compile-echec', { erreur: e && e.message ? e.message : String(e) }))
              res.statusCode = 500
              res.end('Internal Server Error')
            }
            return
          }
          if (pathname === '/__mjs/errors' && req.method === 'DELETE') {
            const src = url.searchParams.get('source')
            journalStore.purge(src === 'server' || src === 'client' ? src : null)
            res.statusCode = 204
            res.end()
            return
          }
        }
      }
      // Atelier /__mjs/theme : variables de thème ($$) déclarées/lues par le projet, lit
      // SEULEMENT le registre déjà écrit par le bundler (computeVarRegistry, bundler/index.ts)
      // — aucun calcul ici. OUTIL DE DÉVELOPPEMENT UNIQUEMENT : 404 (jamais 403, indistinct d'une
      // route absente) dès que production ; AUCUNE clé de config ajoutée pour ce garde — un éventuel
      // jeton `?token=` pourrait s'ajouter, comme celui du journal.
      // isProdEnv (viewer-page.ts) teste aussi `opts.env` (drapeau
      // --prod du CLI), plus seulement NODE_ENV : même patron que server/index.ts (StaticServer,
      // déjà fermée), cf. tests/serve-prod-guard.test.ts.
      if (pathname === '/__mjs/theme' || pathname === '/__mjs/theme.json') {
        if (isProdEnv(opts.env)) { res.statusCode = 404; res.end('Not Found'); return }
        if (pathname === '/__mjs/theme.json' && req.method === 'GET') {
          const registryPath = join(outputDir, '.mjs-theme-vars.json')
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(existsSync(registryPath) ? readFileSync(registryPath) : '{}')
          return
        }
        if (pathname === '/__mjs/theme' && req.method === 'GET') {
          try {
            const script = await getViewerScript(manifestPath, THEME_VIEWER, outputDir)
            res.statusCode = 200
            res.setHeader('Content-Type', 'text/html; charset=utf-8')
            res.end(shell('', '/__mjs/bundle.js', config.i18n?.default || 'fr', viewerScriptElement(script, THEME_VIEWER)))
          } catch (e: any) {
            console.error(t('server.theme-viewer-compile-echec', { erreur: e && e.message ? e.message : String(e) }))
            res.statusCode = 500
            res.end('Internal Server Error')
          }
          return
        }
      }
      // Assets compilés (imports du manifeste) : outputDir, en retirant l'éventuel urlPrefix.
      const rel = (urlPrefix && pathname.startsWith(urlPrefix) ? pathname.slice(urlPrefix.length) : pathname).replace(/^\/+/, '')
      const asset = join(outputDir, rel)
      // aucun SEGMENT caché (`.mjs-theme-vars.json`, `.mangle-cache.json`… cf. bundler/index.ts,
      // pruneOrphans) : ces artefacts vivent parfois À LA RACINE d'outputDir sans jamais être prévus
      // pour être SERVIS tels quels — `.mjs-theme-vars.json` a sa propre route dédiée
      // (/__mjs/theme.json, fermée en production) ; cet accès direct-ci, lui, ne refusait rien,
      // même donnée disponible sans aucune garde de production — même politique que server/index.ts
      // (serveProjectRoot, dotfile jamais servi)
      const hidden = rel.split('/').some((s) => s.startsWith('.'))
      // `outputDir` qui est la racine du projet (ou la contient) : ses secrets ne sortent pas, les sorties du build si (même garde que `mjs dev`) ;
      // verdict gardé tant que le chemin mène au même fichier inchangé (cf. isServableFile)
      if (rel && !hidden && isServableFile(asset, outputDir, configDir, config, configDir)) {
        res.setHeader('Content-Type', MIME[extname(asset)] || 'application/octet-stream')
        // nommé par son contenu : jamais modifié sous ce nom, cache d'un an ; tout autre fichier revalidé
        res.setHeader('Cache-Control', isBuildFingerprinted(asset) ? 'public, max-age=31536000, immutable' : 'no-cache')
        res.end(readFileSync(asset)); return
      }
      // Verbes MUTANTS (POST/PUT/PATCH/DELETE) : pipeline PARTAGÉ avec `mjs dev`
      // (garde origin, content-type, plafond corps, action, 303/422), cf. action-pipeline.ts pour le
      // détail. mjs_ajax.ts (client) : POST/PUT/PATCH envoient un corps (FormData → multipart posé
      // par fetch, ou objet → JSON, cf. `_request`) ; DELETE part SANS corps ni Content-Type
      // (µ.ajax.delete n'a pas de paramètre `data`, cf. mjs_ujs.ts `_mjs_navDispatch`).
      if (await handleMutatingRequest(req, res, pathname, reqUrl, { config, entry, recordServer, manifestPath })) return
      // Asset ABSENT dont le dernier segment porte une
      // extension (script/style/wasm cassé, ex. /modularjs/inexistant.js) : 404 direct, jamais le
      // repli rendu plus bas (qui sert le shell 200 pour toute URL non déclarée, cf.
      // render-request.ts) — sauf X-MJS-Nav, qui veut la fiche JSON (négociée juste en dessous)
      // même pour un chemin à extension. Même règle que `mjs dev` (server/index.ts).
      // Cette garde tombait AUSSI sur une route DÉCLARÉE avec extension
      // (render.routes['/modularjs/sitemap.xml'], sitemap/robots…) : jamais rendue, 404 sec. Une
      // route résolue par `resolvePage` (déclarée telle quelle, préfixe ou pas) passe toujours au
      // rendu — la garde ne vaut que pour un chemin non déclaré.
      const rawNavPeek = req.headers['x-mjs-nav']
      const navPeek = Array.isArray(rawNavPeek) ? rawNavPeek[0] : rawNavPeek
      const declaredRoute = resolvePage(pathname, (config as any).render, null)
      if (rel && /\.[a-z0-9]+$/i.test(rel) && !navPeek && !declaredRoute) { res.statusCode = 404; res.end('Not Found'); return }
      // Négociation de protocole : X-MJS-Nav présent et non vide → JSON
      // { module, props, url, title, version } au lieu du shell HTML ; même URL,
      // deux représentations, d'où Vary sur les deux branches (ici et HTML plus bas).
      const rawNav = req.headers['x-mjs-nav']
      const navHeader = Array.isArray(rawNav) ? rawNav[0] : rawNav
      if (navHeader) {
        const page = resolvePage(pathname, (config as any).render, null)
        const version = readBuildVersion(manifestPath)
        res.statusCode = page ? 200 : 404
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Vary', 'X-MJS-Nav')
        if (version) res.setHeader('X-MJS-Version', version)
        const props = page ? await entry.propsFor(pathname, req) : {}
        // title: null — mjs serve laisse ce champ vide (le titre de SES pages vient du <@head><title> du
        // composant, cf. mjs_runes.ts µ._mjs_setTitle) mais le CLIENT le LIT désormais : un back applicatif
        // qui parle ce protocole peut y poser le titre qu'il connaît (fiche produit, article…) pour l'imposer
        // à l'onglet — le <@head><title> du composant qui arrive, s'il existe, tire ensuite dans sa microtâche
        // et garde toujours le dernier mot.
        res.end(JSON.stringify({ module: page ? page.component : null, props, url: reqUrl, title: null, version, ...navExtras(config.render) }))
        return
      }
      // Sinon : une PAGE → handler de rendu (mode résolu + override header).
      // Ce signal était déjà câblé côté `mjs dev` (server/index.ts,
      // req.on('close') → AbortController) seulement, `render-server.ts` alors restreint à sa
      // table MIME (503 persistant confirmé côté `mjs serve`
      // sans ce câblage). Même patron : `close` retiré dans le `finally`, jamais accroché après
      // une réponse normale.
      const abortOnClose = new AbortController()
      const onReqClose = () => abortOnClose.abort()
      req.on('close', onReqClose)
      let r: RenderResponse
      try {
        // `loadProps` : même chargeur (entry.propsFor) que la balise __mjs_res plus bas — transmis
        // ICI pour que le RENDU SSR lui-même affiche déjà la donnée chargée (cf. RenderResponse.
        // resProps, réutilisé plus bas SANS rappeler propsFor une 2e fois pour la même requête).
        r = await handler.handle(pathname, req.headers as any, abortOnClose.signal, () => entry.propsFor(pathname, req))
      } finally {
        req.off('close', onReqClose)
      }
      res.statusCode = r.status
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.setHeader('X-MJS-Mode', r.mode || 'csr')
      res.setHeader('Vary', 'X-MJS-Nav')
      // Même en-tête que `mjs dev` (server/index.ts) : status 503 seulement, avec le
      // délai suggéré posé par le handler (RenderGate, render-request.ts) — manquait ICI jusque-là.
      if (r.status === 503 && r.retryAfter) res.setHeader('Retry-After', String(r.retryAfter))
      // même en-tête que les 2 branches JSON : sans lui, un client qui navigue en mode
      // HTML ne peut jamais détecter un nouveau build (cf. readBuildVersion plus haut).
      const version = readBuildVersion(manifestPath)
      if (version) res.setHeader('X-MJS-Version', version)
      // NEUF — même règle que la fiche JSON (navExtras) : la page qui ARRIVE en HTML la porte
      // aussi, posée SEULEMENT si configurée (Vary INCHANGÉ : la variation dépend de la requête
      // X-MJS-Nav, pas de ces en-têtes fixes issus de la config).
      const extras = navExtras(config.render)
      if (extras.target) res.setHeader('X-MJS-Target', extras.target)
      if (extras.method) res.setHeader('X-MJS-Method', extras.method)
      if (extras.cache) res.setHeader('X-MJS-Cache', extras.cache)
      // µres plein dès le 1er chargement HTML : DÉJÀ résolu par `handler.handle` ci-dessus
      // (`loadProps`, même chargeur entry.propsFor, appelé UNE seule fois pour cette requête — la
      // fusion dans le rendu SSR lui-même vit dans render-request.ts) — jamais de 500 pour un
      // chargeur en échec sur une page HTML (déjà rattrapé là-bas ; la branche JSON plus haut,
      // elle, laisse toujours remonter au catch global).
      const resProps = r.resProps ?? {}
      const resTag = resScript(pathname, resProps)
      const body = r.kind === 'csr'
        ? (r.component ? '<' + r.component + '></' + r.component + '>' : '<!-- mjs: csr -->')
        : r.body
      res.end(shell((resTag ? resTag + '\n' : '') + body, '/__mjs/bundle.js', config.i18n?.default || 'fr', '', buildSsrHead(config, configDir, manifestPath)))
    } catch (e: any) {
      console.error(t('server.erreur-imprevue', { url: req.url || '/', erreur: e && e.message ? e.message : String(e) }))
      // (point 1 de capture — dernier filet, quelle qu'en soit la cause).
      recordServer({ message: e && e.message ? e.message : String(e), pile: e && e.stack, url: req.url || '/' })
      res.statusCode = 500
      res.end('Internal Server Error')
    }
  })

  await listenOrReject(server, port, host)
  const addr = server.address()
  const actualPort = (addr && typeof addr === 'object') ? addr.port : port
  return {
    server, port: actualPort,
    // journalStore.close() (jamais flush() seul) : solde ET se retire du hook de sortie
    // process-level — flush() seul laissait ce serveur enregistré dans pendingFlushes (journal.ts)
    // après sa propre fermeture, référence qui n'appartient plus à personne.
    close: async () => { entry.close(); await handler.close(); journalStore.close(); await new Promise<void>((ok) => server.close(() => ok())) },
  }
}
