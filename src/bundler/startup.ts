// startup — ce que le HTML FIGÉ d'une page prérendue dit au navigateur de charger, AVANT que le
// manifeste (`bundle_modular.js`) n'ait été téléchargé puis exécuté.
//
// Le manifeste est le seul à savoir quels composants une page affiche : ils ne partent donc qu'après
// lui (son bloc `modulepreload`, cf. writeManifest()). Le fragment prérendu, lui, le sait dès sa
// CONSTRUCTION — c'est tout l'objet de ce module : réécrire le fragment pour qu'il porte lui-même ce
// que sa page démarre. Clé de configuration `render.startup` (cf. `RenderStartupMode`),
// surchargeable par route, qui ne concerne QUE les routes prérendues.
//
// ENSEMBLE DE DÉMARRAGE d'une page = les clés de `µ.paths` dont la balise `mjs-<clé>` est dans le
// HTML rendu (`PrerenderReport.generated[].tags`), FERMÉ par la table des dépendances directes
// (`µDeps`/`manifestDeps`, même marche que `µWalkDeps` du manifeste) : un enfant qu'un `{if}` faux
// n'a pas rendu est quand même dans l'ensemble (il s'affichera au premier clic sans aller-retour),
// et les modules `@import`-és par ces composants aussi, comme les fichiers de leurs effets
// (`mjs_fx_<nom>`, cf. Bundler.compileFxChunks). Les alias de balise sont des clés du manifeste
// comme les autres.
//
// FICHIER DE PAGE (`'bundle'`, construction de PRODUCTION seulement) : les COMPOSANTS de l'ensemble
// sont assemblés en un `mjs_page-<slug>-<empreinte>.js` (préfixe `mjs_` obligatoire, hors d'atteinte
// d'un nom de composant). Restent EXTERNES le cœur, les feuilles, les animations, les fichiers de
// langue, le manifeste externe, les fichiers d'effets — et les MODULES : un module doit rester une
// instance unique, un store singleton dupliqué dans le fichier de page casserait l'état partagé. Les fichiers séparés
// existent toujours : une autre page les charge seuls, le rendu serveur les lit un par un.
//
// En DÉVELOPPEMENT, `'bundle'` se comporte comme `'preload'` (une ligne d'information au journal) :
// le rechargement à chaud et le cache des noms courts ne sont pas mêlés à un second assemblage.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { build as esbuildBuild } from 'esbuild'
import type { Bundler } from './index.js'
import type { RenderConfig, RenderStartupMode, BundleGroupConfig } from './config.js'
import type { PrerenderReport } from '../server/prerender.js'
import { pickStartup, startupSlug } from '../server/render-routes.js'
import { t } from '../messages/index.js'

/** Nombre de composants en dessous duquel un fichier de page n'a rien à factoriser. */
const MIN_UNITS_PER_PAGE = 2

export interface StartupPage {
  /** URL de la route prérendue. */
  url: string
  /** Fragment réécrit (chemin absolu). */
  file: string
  /** Mode RÉSOLU, dégradation de développement comprise. */
  mode: RenderStartupMode
  /** Ensemble de démarrage (composants ET modules), trié. */
  names: string[]
  /** Hrefs posés en tête du fragment, dans l'ordre. */
  hrefs: string[]
  /** Chemin web du fichier de page, quand la page en a un. */
  pageFile?: string
}

export interface StartupReport {
  pages: StartupPage[]
  /** Fragments RÉELLEMENT réécrits (une réécriture sans changement est sautée). */
  written: number
  /** Chemins web des fichiers de page émis, triés. */
  pageFiles: string[]
}

export interface StartupOpts {
  /** Construction de production (`mjs build --prod`) : seule à assembler un fichier de page. */
  prod: boolean
  log?: (msg: string) => void
}

const byCodePoint = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0

/** Clé RÉELLE du manifeste par nom en minuscules — mêmes règles de résolution que
 *  buildManifestDeps() (les balises du HTML sont minuscules, une clé peut ne pas l'être). */
function manifestKeysByLower(bundler: Bundler): Map<string, string> {
  const table = new Map<string, string>()
  for (const key of Object.keys(bundler.manifest)) {
    if (key === '__animations' || key === '__styles' || key === '__external') continue
    table.set(key.toLowerCase(), key)
  }
  return table
}

/** Une clé du manifeste est-elle un COMPOSANT (`.mjs`) ? Sinon c'est un module autonome
 *  (`.civet`/`.coffee`/`.ts`), qui reste externe au fichier de page. Le registre
 *  `manifestSources` est rempli à CHAQUE compile, cache-hit compris. */
function isComponent(bundler: Bundler, name: string): boolean {
  return bundler.manifestSources.get(name)?.endsWith('.mjs') ?? false
}

/** Les clés d'un même FICHIER sont un seul composant (alias de dossier, cf. shortModuleName) : `names` complété de
 *  toutes les clés du manifeste qui désignent les mêmes fichiers, triées. */
function withSiblingKeys(bundler: Bundler, names: string[]): string[] {
  const fichiers = new Set(names.map(n => bundler.manifest[n]).filter(Boolean).map(f => basename(f)))
  const tous     = new Set(names)
  for (const key of Object.keys(bundler.manifest)) {
    if (bundler.manifest[key] && isComponent(bundler, key) && fichiers.has(basename(bundler.manifest[key]))) tous.add(key)
  }
  return [...tous].sort(byCodePoint)
}

/** Ensemble de démarrage : les balises du HTML résolues en clés de manifeste, fermées par
 *  `manifestDeps`. Une dépendance que le manifeste ne publie pas (alias empoisonné, cible en
 *  échec) n'est jamais suivie — même prudence que µWalkDeps côté navigateur. */
function startupSet(bundler: Bundler, tags: string[], keys: Map<string, string>): string[] {
  const vus = new Set<string>()
  const walk = (name: string): void => {
    if (vus.has(name)) return
    vus.add(name)
    for (const dep of bundler.manifestDeps[name] ?? []) {
      if (bundler.unitPath(dep)) walk(dep)
    }
  }
  for (const tag of tags) {
    const real = keys.get(tag.slice(4))
    if (real && bundler.manifest[real]) walk(real)
  }
  return [...vus].sort(byCodePoint)
}

/**
 * Ordre d'import des composants dans le fichier de page : ENFANTS AVANT PARENTS (post-ordre DFS sur
 * `manifestDeps`, départ trié). Un parent se définit après ses enfants — l'upgrade d'un élément déjà
 * présent dans la page (prérendu) trouve alors ses enfants déjà définis. Même règle que
 * `bundleUnitOrder()` du mode `js: 'bundle'`, restreinte ici à l'ensemble de la page.
 */
function childrenFirst(bundler: Bundler, names: string[]): string[] {
  const dans  = new Set(names)
  const ordre: string[] = []
  const fait  = new Set<string>()
  const encours = new Set<string>()
  const visit = (name: string): void => {
    if (fait.has(name) || encours.has(name)) return   // déjà placé, ou cycle : jamais revisité
    encours.add(name)
    for (const dep of [...(bundler.manifestDeps[name] ?? [])].sort(byCodePoint)) {
      if (dans.has(dep)) visit(dep)
    }
    encours.delete(name)
    fait.add(name)
    ordre.push(name)
  }
  for (const name of [...names].sort(byCodePoint)) visit(name)
  return ordre
}

/**
 * Le `Bundler` dont le manifeste fait foi pour ce que le dossier de sortie contient MAINTENANT. Le prérendu recompile
 * dans le même dossier (second `Bundler`, cf. `PrerenderReport.bundler`) : si une source a changé entre les deux
 * compilations, les empreintes du premier manifeste désignent des fichiers qui n'existent plus. Le dernier
 * compile est donc celui que l'assemblage (fichiers de page, liens de préchargement) et la purge doivent lire.
 * Le premier reste le bon quand le prérendu n'a rien recompilé, ou l'a fait AILLEURS (fichier unique `js: 'bundle'` :
 * dossier de travail temporaire) — jamais dans le même dossier de sortie.
 */
export function latestBundler(first: Bundler, report: PrerenderReport): Bundler {
  const dernier = report.bundler
  if (!dernier || dernier === first || first.jsMode === 'bundle') return first
  return resolve(dernier.outputDir) === resolve(first.outputDir) ? dernier : first
}

/** Garde-fou : chaque fichier que l'assemblage va lire ou annoncer existe dans le dossier de sortie. Sinon le dossier
 *  a été recompilé sous d'autres empreintes depuis le manifeste lu — erreur claire, jamais un fragment qui nomme un
 *  fichier disparu avec une sortie 0. */
function assertOutputsPresent(bundler: Bundler, files: Iterable<string>): void {
  for (const f of files) {
    if (!existsSync(join(bundler.outputDir, f))) throw new Error(t('bundler.startup.recompile-empreintes', { fichier: f }))
  }
}

/** `<link rel="modulepreload">` d'un href. */
function lien(href: string): string {
  return `<link rel="modulepreload" href="${href}">`
}

/**
 * Assemble les COMPOSANTS `files` (basenames dans `outputDir`) en un seul module ES.
 *
 * Tout ce qu'un composant importe et qui n'est pas de l'ensemble reste EXTERNE, chemin INCHANGÉ
 * (cœur, feuilles partagées, animations, fichiers de langue, manifeste externe, modules) : ce sont
 * des chemins web absolus (`<urlPrefix>/<base>-<empreinte>.js`, cf. placeholderPath()) qu'esbuild
 * chercherait sinon sur le disque. Le fichier de page vit dans le MÊME dossier que les composants
 * qu'il assemble : leur `new URL('.', import.meta.url)` (dossier du module, lu par le runtime pour
 * les satellites CSS) continue de désigner le bon dossier.
 *
 * NI `mangleProps` NI `mangleCache` : les fichiers séparés sont déjà raccourcis, l'assemblage ne
 * renomme rien — un second mangle sur un code déjà mangé n'aurait aucun cache commun avec le
 * premier.
 */
async function bundlePage(bundler: Bundler, files: string[]): Promise<{ code: string; map?: string }> {
  const inline = new Set(files)
  const entree = files.map(f => `import './${f}';`).join('\n')
  const plugin = {
    name: 'mjs-page-externals',
    setup: (b: any) => {
      b.onResolve({ filter: /.*/ }, (args: any) => {
        if (args.kind === 'entry-point') return null
        const base = basename(args.path)
        if (inline.has(base)) return { path: join(bundler.outputDir, base), namespace: 'file' }
        return { path: args.path, external: true }
      })
    },
  }
  const result = await esbuildBuild({
    stdin: { contents: entree, resolveDir: bundler.outputDir, sourcefile: 'mjs_page.js', loader: 'js' },
    absWorkingDir: bundler.outputDir,
    // `outfile` : sans lui esbuild refuse une carte externe (« Cannot use an external source map without an
    // output path ») ; rien n'est écrit par lui (`write: false`), seuls les chemins des `sources` s'en servent
    outfile: join(bundler.outputDir, 'mjs_page.js'),
    bundle: true,
    write: false,
    format: 'esm',
    target: 'es2022',
    // même raison que le manifeste assemblé (cf. runBundleEsbuild) : sans `charset`, esbuild
    // échapperait tout non-ASCII en `\uXXXX`, le sigil `µ` compris.
    charset: 'utf8',
    minify: bundler.shouldMinify(),
    treeShaking: true,
    keepNames: false,
    legalComments: 'none',
    sourcemap: bundler.shouldEmitSourceMap() ? 'external' : false,
    logLevel: 'silent',
    plugins: [plugin],
  })
  const js  = result.outputFiles!.find(f => f.path.endsWith('.js')) ?? result.outputFiles![0]
  const map = result.outputFiles!.find(f => f.path.endsWith('.map'))
  return { code: js.text, map: map?.text }
}

export interface GroupReport {
  /** Nom du groupe (clé de `bundles`). */
  name: string
  /** Chemin web du fichier de groupe. */
  file: string
  /** Racines résolues en clés du manifeste, triées. */
  roots: string[]
  /** Composants assemblés (racines et descendance), triés. */
  names: string[]
  /** Toutes les clés du manifeste qui désignent ces fichiers, alias compris (deux clés d'un même fichier
   *  sont un seul composant : toutes suivent le groupe). Triées. */
  keys: string[]
}

/** Clé du manifeste d'un composant nommé dans un groupe (racine ou `except`) : le nom tel quel ou sans son préfixe `mjs-`,
 *  casse ignorée. Un module (`.civet`/`.coffee`) n'est jamais un composant ; `null` si le nom n'en désigne aucun. */
function resolveGroupComponent(bundler: Bundler, keys: Map<string, string>, name: string): string | null {
  const lower = name.trim().toLowerCase()
  const real  = keys.get(lower) ?? keys.get(lower.replace(/^mjs-/, ''))
  if (!real || !bundler.manifest[real] || !isComponent(bundler, real)) return null
  return real
}

/** Un composant atteint par plusieurs groupes : son nom, les groupes qui l'atteignent (triés) et, parmi eux, ceux dont il est
 *  une RACINE — `except` ne peut pas l'y laisser dehors. */
interface GroupConflict {
  name: string
  groups: string[]
  roots: string[]
}

/** Un groupe tel que la configuration l'écrit : en liste (forme courte) ou en objet, avec son `except` s'il en porte un (les noms
 *  tels que l'application les a écrits) ; `null` : pas de clé `except`. Le message d'erreur en tire ce qu'il dit de la forme et de
 *  l'`except` existant. */
interface GroupForm {
  list:   boolean
  except: string[] | null
}

/** Une liste de noms pour un message : au plus trois en entier, au-delà les deux premiers puis « … » (« a, b, … »). */
function abridge(names: string[]): string {
  return names.length > 3 ? `${names.slice(0, 2).join(', ')}, …` : names.join(', ')
}

/** Des noms entre guillemets, séparés par des virgules : le contenu d'une liste JSON écrite dans un message. */
function quoted(names: string[]): string {
  return names.map(n => JSON.stringify(n)).join(', ')
}

/**
 * Le message de l'erreur « plusieurs groupes » : TOUS les conflits d'un coup (un composant par ligne, avec les groupes qui
 * l'atteignent), puis ce qu'il faut écrire dans la configuration pour qu'aucun conflit ne reste, sans second tour :
 * - la ligne `"except"` exacte, pour les groupes qui n'en ont pas encore ; elle ne porte que les composants dont AUCUN groupe n'est
 *   racine : `except` refuse une racine (`except-racine`), la ligne passe donc telle quelle dans chaque groupe nommé ;
 * - pour un groupe qui a DÉJÀ un `except`, sa liste complétée : collée en seconde clé, la ligne partagée prendrait la place de la
 *   première (JSON garde la dernière) et ferait revenir les composants que ce groupe laissait déjà dehors ;
 * - une racine a sa consigne à part : l'ajouter à `except` des autres groupes (elle reste dans le sien) ; quand plusieurs groupes la
 *   déclarent racine, la garder dans un seul et, dans chacun des autres, la retirer des racines ET l'ajouter à `except` (un groupe
 *   qui l'atteint encore par une autre de ses racines ne s'en sortirait pas autrement) ;
 * - un mot sur la forme objet, seulement quand l'un des groupes à modifier est écrit en liste.
 * Les lignes suivant la première portent trois espaces : la CLI imprime la première après un retrait de trois colonnes.
 */
function groupConflictMessage(conflicts: GroupConflict[], forms: Map<string, GroupForm>): string {
  const sorted  = [...conflicts].sort((a, b) => byCodePoint(a.name, b.name))
  const free    = sorted.filter(c => c.roots.length === 0)
  const lines   = [t('bundler.groupes.plusieurs-groupes', { nb: sorted.length, composants: sorted.map(c => c.name).join(', ') })]
  const touched = new Set<string>()   // les groupes dont la configuration est à modifier sans en donner la liste complète
  for (const c of sorted) lines.push(t('bundler.groupes.plusieurs-groupes-ligne', { composant: c.name, nb: c.groups.length, groupes: abridge(c.groups) }))
  if (free.length > 0) {
    const named = [...new Set(free.flatMap(c => c.groups))].sort(byCodePoint)
    const plain = named.filter(g => !forms.get(g)!.except)
    const given = named.filter(g => forms.get(g)!.except)
    if (plain.length > 0) {
      lines.push(t('bundler.groupes.plusieurs-groupes-conseil', { nb: free.length, nbGroupes: plain.length, groupes: plain.join(', '), except: quoted(free.map(c => c.name)) }))
      for (const g of plain) touched.add(g)
    }
    if (given.length > 0) {
      lines.push(t('bundler.groupes.plusieurs-groupes-existant'))
      for (const g of given) lines.push(t('bundler.groupes.plusieurs-groupes-existant-ligne', { groupe: g, except: quoted([...forms.get(g)!.except!, ...free.filter(c => c.groups.includes(g)).map(c => c.name)]) }))
    }
  }
  for (const c of sorted.filter(c => c.roots.length > 0)) {
    const others = c.groups.filter(g => !c.roots.includes(g))
    lines.push(t('bundler.groupes.plusieurs-groupes-racine', { composant: c.name, racines: c.roots.join(', '), nbRacines: c.roots.length, autres: others.join(', '), nbAutres: others.length }))
    for (const g of c.roots.length > 1 ? c.groups : others) touched.add(g)
  }
  if ([...touched].some(g => forms.get(g)!.list)) lines.push(t('bundler.groupes.plusieurs-groupes-forme-liste'))
  return lines.join('\n')
}

/**
 * Groupes de fichiers (`bundles` de mjs.config.json) : pour chaque groupe, ses racines et toute leur
 * descendance par la table des dépendances, MOINS ce qui reste externe (modules, fichiers d'effets :
 * seuls les composants entrent), assemblés en `mjs_group-<nom>-<empreinte>.js` — même assemblage que
 * le fichier de page, mêmes externes. Appelée par compile() après la table des dépendances et AVANT
 * l'écriture du manifeste, qui repointe sur ce fichier chaque composant du groupe. Les fichiers
 * séparés restent écrits : le rendu serveur les lit, `prune` les garde.
 *
 * `except` (forme objet) : ces composants et ce que SEULS ils atteignent restent hors du groupe, en fichiers séparés
 * (ils restent dans la table des dépendances : le préchargement de la racine les nomme aussi).
 *
 * Un composant atteint par PLUSIEURS groupes lève une erreur (jamais de copie silencieuse) qui les relève tous et dit quoi écrire
 * dans la configuration (cf. groupConflictMessage). Un composant
 * non racine du groupe que lit aussi un composant extérieur reste dans le groupe — la page qui
 * l'utilise charge tout le groupe — et un avertissement le nomme.
 */
export async function assembleGroups(bundler: Bundler, bundles: Record<string, BundleGroupConfig>): Promise<{ groups: GroupReport[]; warnings: string[] }> {
  const keys   = manifestKeysByLower(bundler)
  const noms   = Object.keys(bundles).sort(byCodePoint)
  const plans: { name: string; roots: string[]; names: string[]; keys: string[] }[] = []
  const owner  = new Map<string, GroupConflict>()
  const forms  = new Map<string, GroupForm>()
  for (const name of noms) {
    const conf    = bundles[name]
    const racines = Array.isArray(conf) ? conf : conf.roots
    forms.set(name, { list: Array.isArray(conf), except: Array.isArray(conf) ? null : conf.except ?? null })
    const roots   = [...new Set(racines.map(r => {
      const real = resolveGroupComponent(bundler, keys, r)
      if (!real) throw new Error(t('bundler.groupes.racine-inconnue', { groupe: name, racine: r }))
      return real
    }))].sort(byCodePoint)
    // `except` : composants laissés dehors. La marche ne les traverse pas : eux, et ce que SEULS ils atteignent,
    // ne sont jamais vus ; un descendant atteint aussi par un non-exclu l'est par cet autre chemin et reste dedans
    const except      = new Set<string>()
    const exceptFiles = new Set<string>()
    for (const e of Array.isArray(conf) ? [] : conf.except ?? []) {
      const real = resolveGroupComponent(bundler, keys, e)
      if (!real) throw new Error(t('bundler.groupes.except-inconnu', { groupe: name, composant: e }))
      if (roots.includes(real)) throw new Error(t('bundler.groupes.except-racine', { groupe: name, composant: e }))
      except.add(real)
      exceptFiles.add(basename(bundler.manifest[real]))
    }
    const seen = new Set<string>()
    const walk = (key: string): void => {
      if (seen.has(key) || except.has(key) || (bundler.manifest[key] && exceptFiles.has(basename(bundler.manifest[key])))) return
      seen.add(key)
      for (const dep of bundler.manifestDeps[key] ?? []) { if (bundler.unitPath(dep)) walk(dep) }
    }
    for (const root of roots) walk(root)
    const names     = [...seen].filter(n => isComponent(bundler, n) && bundler.manifest[n]).sort(byCodePoint)
    const rootFiles = new Set(roots.map(r => basename(bundler.manifest[r])))
    const counted   = new Set<string>()
    for (const n of names) {
      // la propriété se juge sur le FICHIER : deux clés d'un même fichier (alias) sont un seul composant
      const file = basename(bundler.manifest[n])
      if (counted.has(file)) continue
      counted.add(file)
      // pas d'arrêt ici : tous les conflits sont relevés d'abord (cf. groupConflictMessage)
      const entry: GroupConflict = owner.get(file) ?? { name: n, groups: [], roots: [] }
      entry.groups.push(name)
      if (rootFiles.has(file)) entry.roots.push(name)
      owner.set(file, entry)
    }
    // les clés sœurs (alias de dossier) du même fichier : le manifeste les repointe toutes sur le groupe
    const fichiersDuGroupe = new Set(names.map(n => basename(bundler.manifest[n])))
    const keysDuGroupe     = Object.keys(bundler.manifest).filter(k => bundler.manifest[k] && isComponent(bundler, k) && fichiersDuGroupe.has(basename(bundler.manifest[k]))).sort(byCodePoint)
    plans.push({ name, roots, names, keys: keysDuGroupe })
  }

  // un composant atteint par plusieurs groupes arrête le build, avec TOUS les conflits d'un coup plutôt que le premier seul
  const conflicts = [...owner.values()].filter(o => o.groups.length > 1)
  if (conflicts.length > 0) throw new Error(groupConflictMessage(conflicts, forms))

  const warnings: string[] = []
  for (const plan of plans) {
    const inside = new Set(plan.names)
    for (const n of plan.names) {
      if (plan.roots.includes(n)) continue
      const appelants = Object.keys(bundler.manifestDeps).filter(c => !inside.has(c) && isComponent(bundler, c) && bundler.manifestDeps[c].includes(n)).sort(byCodePoint)
      if (appelants.length > 0) warnings.push(t('bundler.groupes.utilise-hors-groupe', { composant: n, groupe: plan.name, appelants: appelants.join(', ') }))
    }
  }

  const groups: GroupReport[] = []
  for (const plan of plans) {
    const files = [...new Set(childrenFirst(bundler, plan.names).map(n => basename(bundler.manifest[n])))]
    assertOutputsPresent(bundler, files)
    let code: string
    let map: string | undefined
    try {
      ({ code, map } = await bundlePage(bundler, files))
    } catch (e: any) {
      throw new Error(t('bundler.groupes.echec', { groupe: plan.name, raison: e?.message ?? String(e) }))
    }
    const file = bundler.writeHashed(`mjs_group-${plan.name}`, '.js', code, map)
    groups.push({ name: plan.name, file, roots: plan.roots, names: plan.names, keys: plan.keys })
  }
  return { groups, warnings }
}

// LIGNES-REPÈRES de l'en-tête de démarrage : elles bornent, juste sous la ligne-bandeau, la zone
// que CE module possède dans un fragment — tout le reste est le CORPS, écrit par le prérendu.
// Définies ici, lues aux deux endroits : `stripStartupHeader()` ci-dessous sert à `emitStartup`
// (rester idempotente : deux passes n'empilent pas l'en-tête, un fragment qui portait celui d'un
// mode précédent le perd) ET au prérendu, qui compare le corps qu'il vient de rendre au corps déjà
// sur disque pour ne pas réécrire un fragment inchangé (cf. server/prerender.ts).
export const STARTUP_HEADER_OPEN  = '<!-- mjs:demarrage -->'
export const STARTUP_HEADER_CLOSE = '<!-- /mjs:demarrage -->'

/**
 * Retire d'un fragment son en-tête de démarrage : la zone bornée par les deux lignes-repères, juste
 * après la ligne-bandeau. Position EXIGÉE (jamais un repère cherché n'importe où dans la page : une
 * page de doc pourrait en citer un) ; en-tête absent, ou ouvert sans être fermé : contenu rendu tel
 * quel, jamais de découpe au hasard.
 */
export function stripStartupHeader(contenu: string): string {
  const coupe = contenu.indexOf('\n')
  if (coupe < 0) return contenu
  const debut = coupe + 1
  if (!contenu.startsWith(`${STARTUP_HEADER_OPEN}\n`, debut)) return contenu
  const fin = contenu.indexOf(`${STARTUP_HEADER_CLOSE}\n`, debut)
  if (fin < 0) return contenu
  return contenu.slice(0, debut) + contenu.slice(fin + STARTUP_HEADER_CLOSE.length + 1)
}

/**
 * Réécrit le fragment : bandeau (première ligne, inchangée) + en-tête de démarrage borné par ses
 * lignes-repères + corps tel quel. En-tête VIDE (mode `'none'`) : le fragment perd le sien, sans
 * rien d'autre à la place. Écriture SAUTÉE si le contenu est identique (jamais de `touch` inutile,
 * comme writeManifest()).
 */
function rewriteFragment(file: string, entete: string[]): boolean {
  const actuel  = readFileSync(file, 'utf-8')
  const nu      = stripStartupHeader(actuel)
  const coupe   = nu.indexOf('\n')
  const bandeau = coupe < 0 ? nu : nu.slice(0, coupe + 1)
  const corps   = coupe < 0 ? '' : nu.slice(coupe + 1)
  const lignes  = entete.length > 0 ? [STARTUP_HEADER_OPEN, ...entete, STARTUP_HEADER_CLOSE] : []
  const nouveau = bandeau + lignes.map(l => `${l}\n`).join('') + corps
  if (nouveau === actuel) return false
  writeFileSync(file, nouveau, 'utf-8')
  return true
}

/**
 * Émet l'en-tête de démarrage de chaque page prérendue, et son fichier de page quand elle en
 * demande un. Appelée APRÈS `prerenderPages` (qui vient d'écrire les fragments) et après le
 * `compile()` du `bundler` passé — c'est de SON manifeste que viennent les chemins hachés.
 */
export async function emitStartup(
  bundler: Bundler,
  render: RenderConfig | undefined,
  report: PrerenderReport,
  opts: StartupOpts,
): Promise<StartupReport> {
  const log    = opts.log ?? (() => {})
  const sortie: StartupReport = { pages: [], written: 0, pageFiles: [] }
  if (!render || report.generated.length === 0) return sortie

  const toutes = report.generated.map(page => ({ page, mode: pickStartup(render, page.url) }))
  // `'none'` : le fragment ne reçoit rien — et PERD l'en-tête qu'un mode précédent lui avait posé
  // (le prérendu ne réécrit plus un corps inchangé, cf. server/prerender.ts : sans ce retrait, un
  // en-tête périmé survivrait à la bascule de mode).
  for (const { page } of toutes.filter(d => d.mode === 'none')) {
    if (rewriteFragment(page.file, [])) sortie.written++
  }
  // Projet à FICHIER UNIQUE (`js: 'bundle'`) : il n'y a rien à démarrer page par page — le fichier
  // que la coquille charge déjà porte le cœur ET tous les composants, et les clés de son manifeste
  // désignent des modules VIRTUELS (`mjs:unit/<stem>`, résolus en mémoire pendant la fusion),
  // qu'aucun navigateur ne sait aller chercher. Le fragment ne reçoit donc aucun en-tête, et perd
  // celui qu'un build antérieur (dans un autre mode d'émission) lui aurait posé.
  if (bundler.jsMode === 'bundle') {
    for (const { page } of toutes) { if (rewriteFragment(page.file, [])) sortie.written++ }
    log(t('bundler.startup.fichier-unique'))
    return sortie
  }
  const demandes = toutes.filter(d => d.mode !== 'none')
  if (demandes.length === 0) return sortie

  // `'bundle'` demandé hors production : dégradé en préchargement, jamais en silence.
  if (!opts.prod && demandes.some(d => d.mode === 'bundle')) log(t('bundler.startup.bundle-hors-production'))

  const keys = manifestKeysByLower(bundler)
  const { prefix, compact } = bundler.pathsCompaction()
  // forme des valeurs de `µ.paths` : basename seul quand le manifeste factorise son préfixe,
  // chemin entier sinon — la fiche `__mjs_page` doit poser EXACTEMENT la même (cf. Autoloader).
  const pathsForm = (href: string): string => compact ? href.slice(prefix.length) : href

  const plans = demandes.map(({ page, mode }) => {
    const names = startupSet(bundler, page.tags, keys)
    return {
      page,
      mode,
      names,
      // `slug` : dérivé de l'URL DE LA ROUTE (cf. startupSlug), jamais du nom du fragment — deux
      // routes de basename identique (`/` et `/a/index`) auraient sinon partagé un seul fichier de
      // page. Les langues d'une même route, elles, ont la même URL et partagent donc bien leur
      // fichier : l'ensemble assemblé est l'UNION de leurs composants, chaque fragment ne déclarant
      // que les siens dans sa fiche.
      slug: startupSlug(page.url),
      components: withSiblingKeys(bundler, names.filter(n => isComponent(bundler, n))),
      modules: names.filter(n => !isComponent(bundler, n)),
    }
  })

  // un fichier de page par SLUG (jamais un par langue : deux fragments de même slug pointeraient
  // deux hachés du même nom de base, dont writeHashed() ne garderait que le dernier)
  const assembles = new Map<string, string>()
  if (opts.prod) {
    const parSlug = new Map<string, Set<string>>()
    for (const plan of plans) {
      if (plan.mode !== 'bundle' || plan.components.length < MIN_UNITS_PER_PAGE) continue
      const union = parSlug.get(plan.slug) ?? new Set<string>()
      for (const name of plan.components) union.add(name)
      parSlug.set(plan.slug, union)
    }
    for (const slug of [...parSlug.keys()].sort(byCodePoint)) {
      const noms  = [...parSlug.get(slug)!]
      const files = [...new Set(childrenFirst(bundler, noms).map(n => basename(bundler.manifest[n])))]
      assertOutputsPresent(bundler, files)
      let code: string
      let map: string | undefined
      try {
        ({ code, map } = await bundlePage(bundler, files))
      } catch (e: any) {
        throw new Error(t('bundler.startup.echec', { page: slug, raison: e?.message ?? String(e) }))
      }
      const href = bundler.writeHashed(`mjs_page-${slug}`, '.js', code, map)
      assembles.set(slug, href)
      sortie.pageFiles.push(href)
      log(t('bundler.startup.fichier-de-page', { page: slug, fichier: basename(href), nb: files.length }))
    }
    sortie.pageFiles.sort(byCodePoint)
  }

  for (const plan of plans) {
    const pageFile = plan.mode === 'bundle' ? assembles.get(plan.slug) : undefined
    // `'bundle'` servi : le fichier de page + les modules de la fermeture (restés externes).
    // Sinon : une unité, un lien — composants ET modules. DÉDOUBLONNÉ par chemin : deux clés du
    // manifeste peuvent nommer le MÊME fichier (alias de dossier, cf. shortModuleName), un fichier
    // n'a besoin que d'un lien.
    const hrefs = [...new Set(pageFile
      ? [pageFile, ...plan.modules.map(n => bundler.unitPath(n)!)]
      : plan.names.map(n => bundler.unitPath(n)!))]
    assertOutputsPresent(bundler, hrefs.map(h => basename(h)))
    const entete = hrefs.map(lien)
    if (pageFile) {
      const fiche = { file: pathsForm(pageFile), names: plan.components }
      entete.push(`<script type="application/json" id="__mjs_page">${JSON.stringify(fiche)}</script>`)
    }
    if (rewriteFragment(plan.page.file, entete)) sortie.written++
    sortie.pages.push({ url: plan.page.url, file: plan.page.file, mode: plan.mode, names: plan.names, hrefs, ...(pageFile ? { pageFile } : {}) })
  }

  // anciens fichiers de page hachés : supprimés seulement maintenant, les fragments réécrits
  // nommant déjà les nouveaux (même discipline que writeManifest → flushPendingHashCleanup)
  bundler.flushPendingHashCleanup()
  // la liste des sorties du build (`mjs-precache.json`, écrite en fin de compile()) est ANTÉRIEURE
  // aux fichiers de page : republiée ici pour les y faire entrer — un service worker qui la lit
  // mettrait sinon en cache tout le site SAUF le fichier que ses pages d'entrée démarrent.
  if (sortie.pageFiles.length > 0) bundler.writePrecacheManifest()
  return sortie
}
