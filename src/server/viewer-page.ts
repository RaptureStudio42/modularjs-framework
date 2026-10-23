// viewer-page — compile À LA VOLÉE le composant MJS d'une visionneuse de dev (le framework se
// mange lui-même) et décide qui a le droit de la voir. Née pour `errors-viewer.mjs` (étage 3 du
// journal d'erreurs), généralisée pour servir aussi `theme-viewer.mjs` (atelier
// /__mjs/theme) — toute visionneuse future n'a qu'à fournir un `ViewerSpec`.
//
// Compilation : `transpile()` (src/transpiler/index.ts, la même fonction single-file que les
// sondes de tests appellent) produit un JS qui importe le cœur via le PLACEHOLDER
// `µ.asset('mjs_core.js')` (résolu normalement par le bundler, `resolveMagicAssets`) — ici, HORS
// bundler, on le remplace par le VRAI chemin du core que le manifeste de l'app sert déjà (extrait
// du manifeste par regex, même patron que `readBuildVersion`, render-server.ts — cascade de
// modules : bundle.js n'importe plus le cœur STATIQUEMENT, `const µCore = '<chemin>';` en tête de
// fichier reste le littéral que cette regex cherche, cf. writeManifest, bundler/index.ts) : le navigateur
// dédup l'import ES (même URL que celle déjà chargée par `/__mjs/bundle.js`), la visionneuse
// partage donc le MÊME `µ` (mêmes composants enregistrés, même config) que l'appli hôte — jamais
// un second cœur chargé en double. Cache MÉMOIRE PAR VISIONNEUSE (pas de fichier écrit,
// `Map<fileName, …>`) : recompilé seulement si le core de l'app change (nouveau build) — ouvrir
// l'atelier des variables de thème n'invalide jamais le cache du journal, et réciproquement.

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { basename, dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { transpile } from '../transpiler/index.js'
import { writeHashedAsset } from './ssr-head.js'
import { t, getMessagesLang, type MsgKey } from '../messages/index.js'
import { resolveTrustProxy } from '../mjs-ws/trust-proxy.js'
import { safeEqual } from '../mjs-ws/package-helpers.js'

// même patron que Bundler.locateRuntimeDir/locateCoreModulesDir (bundler/index.ts) : plusieurs
// emplacements possibles selon dev (tsx, ce fichier vit à sa vraie place) / prod bundlé (dist/
// cli.js, aplati par esbuild --bundle) / install npm (`src/` est publié à côté de `dist/`, cf.
// package.json "files"). Généralisée (ex-`locateErrorsViewerSource`) : prend le nom de
// fichier en paramètre, sert n'importe quelle visionneuse du dossier server/.
function locateViewerSource(fileName: string): string {
  const candidates = [
    fileURLToPath(new URL('./' + fileName, import.meta.url)),
    fileURLToPath(new URL('../src/server/' + fileName, import.meta.url)),
    fileURLToPath(new URL('../../src/server/' + fileName, import.meta.url)),
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return candidates[0]
}

// dossier du runtime — même patron que Bundler.locateRuntimeDir (bundler/index.ts) : dev (tsx), prod bundlé (dist/cli.js), install npm
function locateRuntimeDir(): string {
  const candidates = [
    fileURLToPath(new URL('../runtime/', import.meta.url)),
    fileURLToPath(new URL('../src/runtime/', import.meta.url)),
    fileURLToPath(new URL('../../src/runtime/', import.meta.url)),
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return candidates[0]
}

// ce que les visionneuses appellent dans le cœur et qu'un cœur nu (`runtime: 'core'`) n'embarque pas : le fichier du runtime et le
// membre qu'il pose (sur `µ` ou sur `µ.Element.prototype`), cherché dans le texte du cœur pour savoir s'il manque, puis dans la
// page pour ne jamais le poser deux fois. Dans l'ordre du cœur. La liste suit le code compilé des visionneuses
// (tests/viewer-page-coeur-nu.test.ts le garde) ; rien n'entre dans le cœur de l'application, seule la page de la visionneuse s'alourdit
export const VIEWER_RUNTIME = [
  { file: 'mjs_deep.ts',          member: '_mjs_deepSet',          on: 'µ' },
  { file: 'mjs_lifecycle.ts',     member: '_mjs_hook',             on: 'µ.Element.prototype' },
  { file: 'mjs_destroy_hooks.ts', member: '_mjs_destroyWithHooks', on: 'µ.Element.prototype' },
  { file: 'mjs_if.ts',            member: '_mjs_updIf',            on: 'µ.Element.prototype' },
  { file: 'mjs_for.ts',           member: '_mjs_updFor',           on: 'µ.Element.prototype' },
  { file: 'mjs_for_nested.ts',    member: '_mjs_updList',          on: 'µ.Element.prototype' },
] as const
type ViewerRuntimeEntry = typeof VIEWER_RUNTIME[number]

// texte du cœur que la page charge : le fichier du cœur (fichiers séparés), cherché dans le dossier de sortie que le serveur donne
// (à défaut, à côté du manifeste), ou le manifeste lui-même (fichier unique, cœur fusionné dedans) ; null si le fichier est
// introuvable — la page apporte alors tout, et son test de présence tranche
function readCoreText(manifestPath: string, manifestSrc: string, corePath: string, separate: boolean, outputDir: string | undefined): string | null {
  if (!separate) return manifestSrc
  const file = join(outputDir ?? dirname(manifestPath), basename(corePath))
  return existsSync(file) ? readFileSync(file, 'utf-8') : null
}

// les fichiers que le cœur n'a pas : un membre posé par `.membre = function` (ou `async function`) dans le texte du cœur y est
function missingViewerRuntime(coreText: string | null): ViewerRuntimeEntry[] {
  if (coreText === null) return [...VIEWER_RUNTIME]
  return VIEWER_RUNTIME.filter(e => !new RegExp('\\.' + e.member + '\\s*=\\s*(?:async\\s+)?function').test(coreText))
}

const CORE_IMPORT_LINE_RE = /^import \{ µ \} from [^\n]*\n/

// joint ces fichiers juste après l'import du cœur, chacun derrière son test de présence : la page les pose avant d'avoir
// le moindre élément, et un cœur qui a déjà le membre n'est jamais redéfini. Sans l'import en tête, erreur plutôt que rien joint
export function withViewerRuntime(js: string, files: ViewerRuntimeEntry[]): string {
  if (!CORE_IMPORT_LINE_RE.test(js)) throw new Error(t('server.viewer-import-coeur-introuvable'))
  const dir     = locateRuntimeDir()
  const runtime = files.map(e => {
    const path = join(dir, e.file)
    if (!existsSync(path)) throw new Error(t('server.viewer-runtime-introuvable', { fichier: e.file, dossier: dir }))
    return 'if (!' + e.on + '.' + e.member + ') {\n' + readFileSync(path, 'utf-8') + '\n}'
  }).join('\n')
  return js.replace(CORE_IMPORT_LINE_RE, imp => imp + runtime + '\n')
}

const CORE_IMPORT_RE = /const µCore = '([^']+)';/

// (mode `csp`) — même littéral que `manifestBodyLines()` (bundler/index.ts, `this.csp ?
// 'µ._csp = true;' : ''`), partagé par writeManifest() ('split') ET emitSingleFile() ('bundle') :
// le manifeste porte déjà l'information, pas besoin de la faire voyager par un paramètre neuf (les
// 3 call-sites de `getViewerScript`/`viewerScriptElement`, `render-server.ts`, sont hors zone ici).
// Le manifeste 'bundle' passe par une VRAIE minification esbuild en prod (contrairement à
// 'split', jamais minifié) : espaces retirés autour du `=`, `true` compacté en `!0` — un littéral
// figé (`µ._csp = true;`) ne matchait alors plus rien, la visionneuse repartant en mode NON
// strict (script inline) sur un projet qui l'interdit. Le récepteur `µ` lui-même y est en plus
// RENOMMÉ par le mangler (variable locale, pas une propriété) : `.propName` (sans exiger `µ`)
// retrouve la valeur quel que soit le nom que porte son récepteur.
const CSP_FLAG_RE = /\._csp\s*=\s*(?:true|!0)\b/

// (mode `csp`) — marqueur interne (jamais un vrai chemin d'URL, `\0` ne peut pas y
// apparaître) : `getViewerScript` le préfixe à l'URL du fichier hashé quand `csp` est actif,
// `viewerScriptElement` le détecte pour émettre un `<script src>` au lieu d'inliner.

// échappe toute occurrence de `</script` (insensible à la casse) — le HTML tokenizer la reconnaît
// QUELLE QUE SOIT sa position (chaîne, commentaire…) : seule protection universelle, cf. le patron
// `'</' + 'script>'` de renderToString.ts pour le même risque côté littéral figé dans NOTRE propre
// source. Ici le contenu vient d'une COMPILATION (pas d'entrée utilisateur), risque résiduel très
// faible — défense en profondeur quand même.
function escapeScriptClose(js: string): string {
  return js.replace(/<\/script/gi, '<\\/script')
}

// Identité d'une visionneuse : le nom de fichier localise le source .mjs (via
// locateViewerSource) ET sert de clé de cache ; moduleName décide le tag du composant compilé
// (`mjs-<moduleName>`, cf. transpile()). `journal-viewer` ≠ nom de fichier `errors-viewer.mjs`
// (héritage, jamais renommé depuis) — `theme-viewer` correspond, lui, à son propre fichier.
export interface ViewerSpec { fileName: string, moduleName: string }
export const JOURNAL_VIEWER: ViewerSpec = { fileName: 'errors-viewer.mjs', moduleName: 'journal-viewer' }
export const THEME_VIEWER: ViewerSpec = { fileName: 'theme-viewer.mjs', moduleName: 'theme-viewer' }

// cache MÉMOIRE PAR VISIONNEUSE (clé `spec.fileName`) : ouvrir l'atelier /__mjs/theme n'invalide
// jamais le cache du journal, et réciproquement — sinon chaque aller-retour entre les deux
// visionneuses recompilait l'autre à chaque fois.
const cache = new Map<string, { corePath: string, csp: boolean, kit: string, lang: string, js: string }>()

// textes des visionneuses : `⟪cle⟫` dans leur source désigne `viewer.<cle>` du catalogue, dans la langue des messages —
// littéral de chaîne dans le script, texte échappé dans le gabarit ; `⟪#langue⟫` donne la langue elle-même (règle du pluriel)
const TEXT_MARK_RE = /⟪(#?[a-z0-9.-]+)⟫/g

function viewerText(cle: string): string {
  return cle === '#langue' ? getMessagesLang() : t(('viewer.' + cle) as MsgKey) ?? cle
}

/** Source d'une visionneuse avec ses textes dans la langue des messages. Exportée pour test direct. */
export function localizeViewerSource(source: string): string {
  const fin      = source.indexOf('</script>')
  const script   = fin === -1 ? '' : source.slice(0, fin)
  const reste    = fin === -1 ? source : source.slice(fin)
  const litteral = (s: string): string => "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'"
  const html     = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\{/g, '&#123;').replace(/\}/g, '&#125;')
  return script.replace(TEXT_MARK_RE, (_m, cle: string) => litteral(viewerText(cle))) + reste.replace(TEXT_MARK_RE, (_m, cle: string) => html(viewerText(cle)))
}

const CSP_URL_MARKER = '\0mjs-viewer-src:'

/** Compile (ou sert depuis le cache mémoire) le JS d'une visionneuse `<mjs-{spec.moduleName}>`,
 *  prêt à inliner dans un `<script type="module">` — DOIT suivre un `<script type="module"
 *  src="/__mjs/bundle.js">` dans la page (même cœur µ, import ES dédupliqué par URL). Lève si le
 *  manifeste est absent/illisible ou si la compilation échoue — l'appelant répond 500 (l'app
 *  continue de tourner). */
export async function getViewerScript(manifestPath: string | null, spec: ViewerSpec, outputDir?: string): Promise<string> {
  if (!manifestPath || !existsSync(manifestPath)) {
    throw new Error(t('server.journal-viewer-manifest-absent'))
  }
  const manifestSrc = readFileSync(manifestPath, 'utf-8')
  const m = manifestSrc.match(CORE_IMPORT_RE)
  // mode `js: 'bundle'` : pas de ligne `const µCore = '…';` — le cœur n'est plus une unité
  // séparée (cf. bundler/index.ts, emitSingleFile()/buildBundleEntry()), tout est fusionné dans
  // le manifeste lui-même, qui RÉEXPORTE µ (`export { µ };`, dernière ligne de son entrée) :
  // importer le manifeste à SA PROPRE URL publique fait le même office. Cette URL est TOUJOURS
  // `/__mjs/bundle.js` (route fixe servant `manifestPath` tel quel, cf. render-server.ts) —
  // précondition déjà documentée en tête de ce fichier (la visionneuse suit TOUJOURS un
  // `<script type="module" src="/__mjs/bundle.js">`), vraie quel que soit le mode. Un manifeste
  // qui n'a NI la ligne `const µCore` NI un export (illisible/corrompu) garde l'erreur d'origine.
  const corePath = m ? m[1] : (/\bexport\s*\{/.test(manifestSrc) ? '/__mjs/bundle.js' : null)
  if (!corePath) {
    throw new Error(t('server.journal-viewer-core-introuvable'))
  }
  const csp = CSP_FLAG_RE.test(manifestSrc)
  // ce que le cœur chargé n'a pas (cœur nu) : la page l'apporte ; la clé du cache le suit, le cœur pouvant changer sous le même chemin
  const missing = missingViewerRuntime(readCoreText(manifestPath, manifestSrc, corePath, m !== null, outputDir))
  const kit     = missing.map(e => e.member).join(',')
  const cached  = cache.get(spec.fileName)
  const lang    = getMessagesLang()
  if (cached && cached.corePath === corePath && cached.csp === csp && cached.kit === kit && cached.lang === lang) return cached.js
  const source = localizeViewerSource(readFileSync(locateViewerSource(spec.fileName), 'utf-8'))
  const { output } = await transpile(source, { moduleName: spec.moduleName })
  const withCore = output.replace("µ.asset('mjs_core.js')", JSON.stringify(corePath))
  let js = escapeScriptClose(missing.length > 0 ? withViewerRuntime(withCore, missing) : withCore)
  if (csp) {
    // (mode `csp`) — `<script type="module">` en ligne BLOQUÉ par `script-src` sans
    // 'unsafe-inline' (vérifié en navigateur). Sort en fichier servi : même trailer
    // (appendChild) que `viewerScriptElement` posait jusqu'ici EN LIGNE, désormais dans CE
    // fichier (un `<script src>` seul ne peut pas être suivi d'une instruction inline). `outputDir`/
    // `urlPrefix` re-DÉRIVÉS ici (pas de paramètre neuf, cf. CSP_FLAG_RE) : `outputDir` =
    // dossier du manifeste (convention `join(outputDir, 'bundle.js')`, cf. createSSRRenderer/
    // createBrowserRenderer) ; `urlPrefix` = dossier de `corePath` (même convention que
    // `Bundler.writeHashed`, le core vit à la racine d'`outputDir`).
    const outputDir = dirname(manifestPath)
    const urlPrefix = corePath.replace(/\/[^/]*$/, '')
    const tag = 'mjs-' + spec.moduleName
    const full = js + '\ndocument.body.appendChild(document.createElement(' + JSON.stringify(tag) + '));'
    const url = writeHashedAsset(outputDir, urlPrefix, 'mjs_viewer_' + spec.moduleName, '.js', full)
    js = CSP_URL_MARKER + url
  }
  cache.set(spec.fileName, { corePath, csp, kit, lang, js })
  return js
}

// Script complet d'une visionneuse : le JS compilé SUIVI d'une ligne qui crée et
// insère l'élément <mjs-{moduleName}>. POURQUOI la balise n'est plus écrite en dur dans le HTML du
// shell (cf. ses 3 call-sites) : l'autoloader (mjs_autoloader.ts, chargé en premier par le bundle)
// voit tout tag présent dans le DOM au 1er passage et le rejette s'il n'est pas dans µ.paths
// (normal : une visionneuse est compilée à la volée, jamais dans le manifeste) → erreur console à
// l'ouverture, page qui marche quand même (une course, pas une panne) mais laide pour un outil dont
// le métier est justement de lire une console. En insérant l'élément APRÈS sa définition (le
// `customElements.define` déjà présent dans `js`), `µ.Autoloader.load` le voit déjà défini et sort
// immédiatement (mjs_autoloader.ts:70) — plus aucune course. Nom de balise dérivé du ViewerSpec,
// écrit via JSON.stringify (jamais concaténé nu : mêmes garanties que le reste du fichier).
export function viewerScriptElement(js: string, spec: ViewerSpec): string {
  // (mode `csp`) — `js` porte le MARQUEUR (`CSP_URL_MARKER`) posé par `getViewerScript`
  // quand le manifeste porte `µ._csp = true;` : le trailer (appendChild) est alors DÉJÀ dans le
  // fichier servi (cf. son commentaire), un `<script src>` seul suffit, zéro script en ligne.
  if (js.startsWith(CSP_URL_MARKER)) {
    return '<script type="module" src="' + js.slice(CSP_URL_MARKER.length) + '"></script>\n'
  }
  const tag = 'mjs-' + spec.moduleName
  return '<script type="module">' + js + '\ndocument.body.appendChild(document.createElement(' + JSON.stringify(tag) + '));</script>\n'
}

/** Décision « production » PARTAGÉE : le drapeau CLI/config (`env`, MÊME
 *  paramètre que `render-request.ts` reçoit déjà, cf. son `isProd`) prime, `NODE_ENV=production`
 *  reste accepté comme second signal (systemd/pm2 qui l'exportent sans jamais passer par --prod).
 *  Auparavant, les 3 gardes concernées (ici + l'atelier `/__mjs/theme`, server/index.ts et
 *  render-server.ts) ne regardaient QUE NODE_ENV : un `--prod` sans NODE_ENV positionné les
 *  laissait ouvertes en production réelle. Exportée : réutilisée par `isViewerAllowed`/
 *  `warnIfJournalViewerOpenInProd` ci-dessous ET par la garde `/__mjs/theme` de server/index.ts —
 *  une seule décision, jamais 2 logiques à la main qui divergent. */
export function isProdEnv(env?: 'dev' | 'prod'): boolean {
  return env === 'prod' || process.env.NODE_ENV === 'production'
}

/** Règle d'accès des 3 routes lecture/purge (GET page, GET .json, DELETE) — cf. le JSDoc de
 *  `JournalConfig.viewer` : `true`/absent = hors production seulement ; chaîne = jeton `?token=`
 *  EXIGÉ dans toute circonstance (dev compris — poser un jeton verrouille partout, sans exception
 *  discrète) ; `false` = jamais. Le refus (quelle qu'en soit la raison) est TOUJOURS un 404, jamais
 *  un 403 — indistinct d'une route qui n'existe pas. */
export function isViewerAllowed(viewerCfg: boolean | string | undefined, url: URL, env?: 'dev' | 'prod', cookie?: string | string[]): boolean {
  if (viewerCfg === false) return false
  if (typeof viewerCfg === 'string' && viewerCfg.length > 0) {
    return safeEqual(url.searchParams.get('token') ?? '', viewerCfg) || safeEqual(cookieValue(cookie, VIEWER_COOKIE), viewerCookieValue(viewerCfg))
  }
  return !isProdEnv(env)
}

// jeton de la visionneuse : reçu une fois dans l'adresse, puis porté par un cookie de session dont la valeur en dérive (le
// jeton lui-même n'y est jamais écrit)
const VIEWER_COOKIE = 'mjs-journal'

function viewerCookieValue(token: string): string {
  return createHash('sha256').update('mjs-journal\0' + token).digest('base64url')
}

function cookieValue(header: string | string[] | undefined, name: string): string {
  for (const part of (Array.isArray(header) ? header.join('; ') : header ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i !== -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return ''
}

/** En-têtes de la page de la visionneuse du journal : aucun Referer ne part de la page (son adresse peut porter le jeton) ;
 *  un jeton reçu dans l'adresse devient un cookie de session réservé aux routes `/__mjs/` (HttpOnly, SameSite=Strict, Secure
 *  quand la page arrive en https, cf. isSecureRequest), puis la visionneuse retire le jeton de la barre d'adresse et de l'entrée
 *  de l'onglet. L'historique du navigateur garde l'adresse tapée (vu dans Chromium, même avec une redirection qui pose le cookie). */
export function setViewerPageHeaders(res: ServerResponse, viewerCfg: boolean | string | undefined, url: URL, secure: boolean): void {
  res.setHeader('Referrer-Policy', 'no-referrer')
  if (typeof viewerCfg === 'string' && viewerCfg.length > 0 && url.searchParams.has('token')) {
    res.setHeader('Set-Cookie', `${VIEWER_COOKIE}=${viewerCookieValue(viewerCfg)}; Path=/__mjs/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`)
  }
}

/** Vrai si la requête est arrivée en https : socket TLS, ou proxy de confiance (`journal.trustProxy`, mêmes valeurs que MJS-WS)
 *  qui l'annonce par `X-Forwarded-Proto: https` (le premier de la liste). Sans `journal.trustProxy`, ou venu d'un autre pair,
 *  l'en-tête n'est pas lu. Décide `Secure` sur le cookie de la visionneuse. */
export function isSecureRequest(req: IncomingMessage, trustProxy: unknown): boolean {
  if ((req.socket as any).encrypted) return true
  const confiance = resolveTrustProxy(trustProxy)
  if (confiance === null || !confiance.trusts(req.socket.remoteAddress)) return false
  const proto = req.headers['x-forwarded-proto']
  return (Array.isArray(proto) ? proto[0] : proto ?? '').split(',')[0].trim().toLowerCase() === 'https'
}

/** Avertissement AU DÉMARRAGE (une fois, pas par requête) quand une config met explicitement
 *  `journal.viewer: true` ET tourne en production — le défaut (absent/undefined) reste silencieux,
 *  c'est le cas normal du dev (cf. isViewerAllowed juste au-dessus). `true` vaut « hors production
 *  seulement » : en production la page n'est PAS servie (404) — l'avertissement le dit, pour qui
 *  croyait l'avoir ouverte (un jeton, `viewer: "<jeton>"`, l'ouvre). Appelée depuis les 2 points
 *  d'entrée joignables (`mjs dev` → server/index.ts, `mjs serve` → render-server.ts). */
export function warnIfJournalViewerOpenInProd(viewerCfg: boolean | string | undefined, env?: 'dev' | 'prod'): void {
  if (viewerCfg === true && isProdEnv(env)) {
    console.error(t('server.journal-viewer-ignore-en-prod'))
  }
}
