// sorties du Bundler : écritures (atomiques, si changées, différées), registre des sorties (`.mjs-outputs.json`), refus d'écrire sur un
// fichier de l'auteur, purge des anciennes empreintes et des orphelins
// fonctions sorties de la classe Bundler, qui garde ses méthodes (mêmes noms, mêmes signatures) et leur passe l'instance : un membre
// privé de la classe s'y lit `bundler['nom']`, et tout appel de méthode passe par l'instance, comme avant la découpe
import { existsSync, writeFileSync, renameSync, unlinkSync, readdirSync, readFileSync, mkdirSync, statSync, realpathSync } from 'node:fs'
import { dirname, basename, join, extname } from 'node:path'
import { t } from '../messages/index.js'
import { feuillesConsignees, feuillesRenduPerimees } from '../server/sorties-rendu.js'
import { cheminDansDossier, refusManifestPath } from './config.js'
import type { Bundler, CacheEntry } from './index.js'

/** pruneOrphans() — la famille des noms que LE BUNDLER LUI-MÊME
 * émet : `<base>-<empreinte5>.<ext>` et son `.map` (writeHashed : empreinte courte en base 36), `<base>-<empreinte8>.<ext>`
 * (copies brutes, ou fichiers d'un build d'avant l'empreinte courte), ou une variante
 * d'image `<base>-<largeur>-<empreinte8>.<format>` (image.ts, variantName). Un nom STABLE
 * (bundle.js, mjs-precache.json, card.wide.css…) ne la matche jamais. Aucune des deux formes ne
 * suffit à désigner une sortie du bundler : celle à 5 caractères est celle de n'importe quel mot
 * court (`theme-light.css`, `card-utils.js`), celle à 8 hexadécimaux celle d'un fichier déposé à la
 * main (`vendor-0123abcd.js`). Le ménage exige en plus que le registre la liste (cf. registeredOutputs). */
const HASHED_OUTPUT_RE = /-[a-f0-9]{8}\.[a-z0-9]+(?:\.map)?$/
/** forme d'un fichier à empreinte courte (`<base>-<5 caractères base 36>.<ext>`, `.map` compris) */
const SHORT_HASHED_RE = /-[0-9a-z]{5}\.[a-z0-9]+(?:\.map)?$/
/** nom de la famille qu'écrit le bundler, l'une ou l'autre forme d'empreinte */
const isHashedOutputName = (name: string): boolean => HASHED_OUTPUT_RE.test(name) || SHORT_HASHED_RE.test(name)
/** nom d'un fichier voisin du manifeste (un `.js` ou sa carte) : un nom simple, jamais un chemin ni un nom caché */
const BUNDLE_NEIGHBOR_RE = /^[^/\\\0.][^/\\\0]*\.js(?:\.map)?$/

/**
 * Les fichiers que des builds ont écrits à côté de `manifestPath` quand le fichier unique est coupé en morceaux (module chargé
 * à la demande, code qu'il partage avec le reste), tels que le registre `.mjs-outputs.json` les consigne (clé `chunks`) :
 * noms simples seulement, liste vide si le registre est absent ou illisible. C'est la seule liste de fichiers que le build
 * retire ou que les serveurs servent à côté du manifeste : jamais un nom reconnu à sa forme.
 */
export function bundleNeighborFiles(manifestPath: string): string[] {
  try {
    const registre = JSON.parse(readFileSync(join(dirname(manifestPath), '.mjs-outputs.json'), 'utf-8'))
    return Array.isArray(registre?.chunks) ? registre.chunks.filter((n: unknown): n is string => typeof n === 'string' && BUNDLE_NEIGHBOR_RE.test(n)) : []
  } catch {
    return []
  }
}

/** pruneOrphans() — les assets que le RENDU SERVEUR écrit lui-même dans le dossier de sortie
 * (`writeHashedAsset`, server/ssr-head.ts) : feuille scopée d'un composant sous le mode strict
 * `csp` (`mjs_ssr_style…`), feuille de `<@head>` (`mjs_ssr_head…`), module de la visionneuse
 * (`mjs_viewer_…`). Ils portent la même forme de nom hachée que les sorties du bundler mais ne
 * sortent d'AUCUN `compile()` — un `mjs build` les prendrait donc pour des orphelins et les
 * retirerait juste après que le prérendu les a écrits, laissant les `<link>` des fragments pointer
 * dans le vide. Protégés PAR LEUR NOM, comme le manifeste.
 *
 * Trois familles NOMMÉES, jamais un préfixe large : `mjs_style_…` est le stem des unités que CE
 * bundler émet pour les feuilles PARTAGÉES (`css: 'split'` → un `.js` par feuille, `css: 'lazy'` →
 * un `.css`). L'exempter aurait rendu ces unités-là impurgeables — une feuille retirée du projet
 * laissant son fichier compilé à vie. D'où la famille propre au rendu, `mjs_ssr_style…` : aucune
 * sortie du bundler ne commence par `mjs_ssr`. */
// `mjs_ssr_head` est un nom FIXE (server/ssr-head.ts) — ancré au tiret du suffixe haché
// (`mjs_ssr_head-<empreinte8>.ext`) depuis le 23/09/2026 : un asset PROJET nommé par ex.
// `mjs_ssr_headline-<empreinte8>.png` matchait à tort le préfixe non ancré (trouvé en revue),
// impurgeable pour toujours même orphelin réel. `mjs_ssr_style_`/`mjs_viewer_` gardent, eux, un
// suffixe LIBRE (nom de composant/module choisi par le projet) : un ancrage au tiret ne
// fermerait rien pour eux (le nom réel a lui aussi un tiret avant son empreinte) — la même
// collision résiduelle existe pour ces deux familles, non fermée, faute d'un marqueur qui les
// distinguerait d'un nom de projet coïncidant.
const SERVER_WRITTEN_RE = /^mjs_(?:ssr_style|viewer_)|^mjs_ssr_head-/

// marque des sorties à nom fixe d'une construction qui écrit dans le dossier des sources : première ligne du manifeste et des
// feuilles de mise en page, clé de `mjs-precache.json` — la preuve, dans le fichier même, qu'il vient d'une construction ; seule
// source de la marque, relue aussi par les serveurs (cf. server/render-server.ts)
export const MARQUE_SORTIE        = '/* @generated by ModularJS */'
export const CLE_MARQUE_SORTIE    = '@generated'
export const VALEUR_MARQUE_SORTIE = 'ModularJS'

// sorties à nom fixe : manifeste, `mjs-precache.json`, feuille `<module>.<nom>.css`, `.mjs-theme-vars.json`, `.mangle-cache.json`,
// carte du fichier unique (`<manifeste>.map`), fragment de traduction à nom clair (`i18n/<langue>/<section>.json`)
export type SorteSortie = 'manifeste' | 'precache' | 'feuille' | 'registre-theme' | 'noms-courts' | 'carte' | 'traduction'

// sortieDuBuild() : `chemin` vient-il d'une construction ? Il porte la marque, ou c'est le manifeste ou la liste de pré-cache
// d'une version qui ne marquait pas ses sorties (2.5.0) : manifeste ouvert par `const µCore = '…';` avec sa ligne
// `µ.version = "<empreinte>";` ou fichier unique qui finit par `//# mjsVersion=<empreinte>`, liste réduite à `{ version,
// assets }`. Une feuille sans marque n'a aucun signe sûr : jamais reconnue. Les autres sorties JSON ne portent pas de clé de
// marque (le registre et les fragments la liraient comme une donnée) : elles sont reconnues à leur forme, la même dans toutes
// les versions — registre `{ <variable>: { declarations, readBy } }`, noms courts (cf. cacheDeNoms), carte de version 3,
// fragment écrit d'un seul tenant (`JSON.stringify`, sans espace ni fin de ligne). Fichier illisible (dossier, droits) : pas
// une sortie
export function sortieDuBuild(chemin: string, sorte: SorteSortie): boolean {
  let texte: string
  try {
    texte = readFileSync(chemin, 'utf-8')
  }
  catch {
    return false
  }
  if (sorte === 'noms-courts') return cacheDeNoms(texte)
  if (sorte === 'manifeste' || sorte === 'feuille') {
    if (texte.split('\n', 1)[0].replace(/\r$/, '') === MARQUE_SORTIE) return true
    if (sorte === 'feuille') return false
    return (/^const µCore = '[^'\r\n]*';\r?\n/.test(texte) && /^ *µ\.version = "[0-9a-f]{8}";\r?$/m.test(texte)) || /^\/\/# mjsVersion=(?:[0-9a-f]{8})?\r?$/m.test(texte)
  }
  let lu: any
  try {
    lu = JSON.parse(texte)
  }
  catch {
    return false
  }
  if (lu === null || typeof lu !== 'object' || Array.isArray(lu)) return false
  if (sorte === 'precache') {
    if (lu[CLE_MARQUE_SORTIE] === VALEUR_MARQUE_SORTIE) return true
    return Object.keys(lu).sort().join(',') === 'assets,version' && typeof lu.version === 'string' && Array.isArray(lu.assets) && lu.assets.every((a: unknown) => typeof a === 'string')
  }
  if (sorte === 'registre-theme') return Object.values(lu).every((v: any) => v !== null && typeof v === 'object' && Array.isArray(v.declarations) && Array.isArray(v.readBy))
  if (sorte === 'carte') return lu.version === 3 && typeof lu.mappings === 'string'
  return texte === JSON.stringify(lu)
}

// cacheDeNoms() : `texte` a-t-il la forme du cache des noms courts (`.mangle-cache.json`, cf. Bundler.saveMangleCache) ? Un objet
// dont chaque clé est une propriété `_mjs_…` (son nom court, ou une valeur abîmée que le chargeur écarte) ou un nom réservé
// (`false`). Versionné, il peut sortir d'une fusion git en conflit, illisible : marqueurs de conflit retirés (`<<<<<<<`, `|||||||`,
// `>>>>>>>` et la fin de leur ligne, `=======`, collés à l'accolade finale quand ils la suivent : le cache ne finit pas par un saut
// de ligne), chaque ligne y reste une accolade ou une paire de cette forme, une par ligne comme il est écrit. Coupé en cours
// d'écriture ou de copie, sa dernière ligne n'est qu'un début de paire : une clé coupée, ou une clé suivie d'un début de valeur
// (n'importe laquelle pour une propriété `_mjs_…`, un début de `false` pour un nom réservé)
export function cacheDeNoms(texte: string): boolean {
  const entree = (cle: string, valeur: unknown): boolean => cle.startsWith('_mjs_') || valeur === false
  try {
    const lu = JSON.parse(texte)
    return lu !== null && typeof lu === 'object' && !Array.isArray(lu) && Object.entries(lu).every(([cle, valeur]) => entree(cle, valeur))
  }
  catch {
    const lignes = texte.split('\n').map(l => l.replace(/\r$/, '').replace(/(?:<{7}|\|{7}|>{7})(?: .*)?$|={7}$/, ''))
    return lignes.every((l, i) => {
      if (/^\s*(?:[{}],?)?\s*$/.test(l)) return true
      const paire = /^\s*"((?:[^"\\]|\\.)*)"\s*:\s*(.*?),?\s*$/.exec(l)
      if (paire !== null && entree(paire[1], paire[2] === 'false' ? false : paire[2])) return true
      const debut = i === lignes.length - 1 ? /^\s*"((?:[^"\\]|\\.)*)(")?(?:\s*:\s*(.*))?$/.exec(l) : null
      return debut !== null && (debut[2] === undefined || debut[3] === undefined || debut[1].startsWith('_mjs_') || 'false'.startsWith(debut[3]))
    })
  }
}

// fichierVide() : un fichier de 0 octet à la place du manifeste n'a rien à perdre (fichier créé d'avance, écriture interrompue) :
// il est remplacé sans refus. Un seul octet suffit à le protéger
function fichierVide(chemin: string): boolean {
  try {
    const st = statSync(chemin)
    return st.isFile() && st.size === 0
  }
  catch {
    return false
  }
}

// une seule erreur pour toutes les sorties à nom fixe qui tomberaient sur des fichiers de l'auteur (cf. Bundler.refusSortiesAuteur) ;
// `avant` : levée avant toute écriture de la construction, sinon au moment d'écrire ce fichier. La marque n'est réclamée que des
// sorties qui la portent : les sorties JSON reconnues à leur seule forme (cf. sortieDuBuild) ne la portent jamais
function erreurFichiersAuteur(fichiers: [string, SorteSortie][], sources: string, avant: boolean): Error {
  const sansMarque = fichiers.filter(([, sorte]) => ['registre-theme', 'noms-courts', 'carte', 'traduction'].includes(sorte)).length
  const raison     = sansMarque === 0 ? 'marque' : sansMarque === fichiers.length ? 'forme' : 'les-deux'
  return new Error(t('bundler.index.sorties-fichiers-auteur', { nb: fichiers.length, fichiers: fichiers.map(([f]) => `\n  - ${f}`).join(''), sources, marque: MARQUE_SORTIE, cle: CLE_MARQUE_SORTIE, avant, raison }))
}

// Écriture NON ATOMIQUE : un
// `writeFileSync` direct sur le chemin FINAL peut être interrompu à
// mi-chemin (crash process, OOM-kill, coupure d'alim) — le fichier reste
// alors TRONQUÉ sur disque. Le nom étant dérivé du hash du CONTENU SOURCE
// (jamais revérifié contre les octets RÉELLEMENT écrits), `existsSync
// (target)` renvoie ensuite `true` pour ce fichier CORROMPU à CHAQUE build
// suivant → l'écriture est skippée (« il existe déjà ») → le fichier
// tronqué n'est JAMAIS réparé, à vie, jusqu'à suppression manuelle.
// Fix : écriture dans un fichier temporaire PUIS `renameSync` — un rename
// sur le même volume est ATOMIQUE au niveau filesystem (POSIX comme NTFS) :
// soit l'ancien contenu reste intact, soit le nouveau le remplace
// ENTIÈREMENT, jamais un état intermédiaire visible depuis `target`. Si
// deux compilations concurrentes produisent par coïncidence le MÊME hash
// (donc le même contenu, par construction), l'écriture atomique de l'une
// ou l'autre suffit — inoffensif.
export function writeFileAtomic(bundler: Bundler, target: string, content: string | Buffer): void {
  if (existsSync(target)) return // même hash = même contenu (collision négligeable)
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  writeFileSync(tmp, content, 'utf-8')
  try {
    renameSync(tmp, target)
  } catch (e) {
    try { unlinkSync(tmp) } catch {}
    throw e
  }
  // tient la liste mémoïsée de outputDir à jour (cf. son bandeau) : un fichier qui vient
  // d'apparaître doit être visible du PROCHAIN cleanupOldHashes() de CE tour, sans reforcer
  // une lecture disque. `dirname(target) === this.outputDir` : cette méthode sert aussi à
  // d'autres dossiers (aucun cas réel actuellement, filet).
  if (bundler['outputDirListingCache'] && dirname(target) === bundler.outputDir) {
    bundler['outputDirListingCache'].push(basename(target))
  }
}

// currentOutputDirListing() : jumeau lazy de outputDirListingCache (cf. son bandeau) — lit
// outputDir UNE fois par compile(), au premier besoin, jamais plus.
export function currentOutputDirListing(bundler: Bundler): string[] {
  if (bundler['outputDirListingCache'] === null) bundler['outputDirListingCache'] = readdirSync(bundler.outputDir)
  return bundler['outputDirListingCache']
}

// writeIfChanged() : jumeau de la garde déjà en place dans writeManifest() (même motif
// exact), généralisé ici pour tout fichier à nom STABLE dont le CONTENU varie d'un build
// à l'autre (variants `<style name="…">`, registre `.mjs-theme-vars.json`).
// `writeFileAtomic` NE CONVIENT PAS : il skippe dès que `target` existe, quel
// que soit son contenu (pensé pour un nom HASHÉ, jamais pour un nom stable). Un build qui
// ne change rien ne doit pas non plus TOUCHER le fichier (nouveau mtime → le watcher se
// redéclencherait pour rien).
// feuille de mise en page `<module>.<nom>.css` : nom stable, sans empreinte, donc lue tout de suite par le site servi.
// En build (`keepFailedComponents: false`), elle attend la publication du manifeste (compile(), étape 4) : un build en
// échec ne publie rien et laisse les feuilles du dernier build réussi
// construction qui écrit dans le dossier des sources : la feuille porte la marque, et un fichier de l'auteur du même nom n'est
// jamais réécrit (cf. refusFichierAuteur ; refusé dès la tête de compile() quand la recherche des variantes l'a trouvé)
export function writeLayoutCss(bundler: Bundler, target: string, content: string): void {
  const refus = bundler['refusFichierAuteur'](target, 'feuille')
  if (refus) {
    bundler['authorRefusals'].set(target, refus)
    return
  }
  const texte = bundler['ecritDansSources']() ? `${MARQUE_SORTIE}\n${content}` : content
  if (bundler.keepFailedComponents) bundler['writeIfChanged'](target, texte)
  else bundler['pendingLayoutWrites'].push({ target, content: texte })
}

// fragment de traduction à nom clair (`i18n/<langue>/<section>.json`) et registre des variables de thème : même règle que la
// feuille de mise en page, le site servi (ou l'atelier du thème) les lit tout de suite — un build en échec laisse ceux du dernier
// build réussi ; un fichier de l'auteur du même nom n'est jamais réécrit (cf. refusFichierAuteur)
export function writeSortieDifferee(bundler: Bundler, target: string, content: string, sorte: SorteSortie): void {
  const refus = bundler['refusFichierAuteur'](target, sorte)
  if (refus) {
    bundler['authorRefusals'].set(target, refus)
    return
  }
  if (bundler.keepFailedComponents) bundler['writeIfChanged'](target, content)
  else bundler['pendingLayoutWrites'].push({ target, content })
}

export function writeIfChanged(bundler: Bundler, target: string, content: string): void {
  if (existsSync(target)) {
    const current = readFileSync(target, 'utf-8')
    if (current === content) return
  }
  bundler['writeFileAtomicAlways'](target, content)
}

// Cette logique de nettoyage était
// DUPLIQUÉE (quasi identique) 2 fois DANS writeHashed() lui-même, et
// ABSENTE d'un 3e site qui en aurait eu tout autant besoin (copie
// d'assets binaires, cf. resolveOneAsset ci-dessous) : un binaire
// (logo.png, etc.) réédité au fil du temps voyait CHAQUE ANCIENNE
// version (`logo-<vieuxhash>.png`) s'accumuler indéfiniment dans
// outputDir, jamais nettoyée — contrairement au JS compilé (writeHashed),
// qui purge déjà ses anciennes versions. Factorisé ici pour les 3 sites.
// La suppression n'est plus IMMÉDIATE : elle est mise EN ATTENTE
// (pendingHashCleanup), purgée pour de bon seulement après que writeManifest() ait republié le
// manifeste (cf. flushPendingHashCleanup, appelée en fin d'étape 4 de compile()). Sans ce
// report, un composant qui recompile supprimait son ancien fichier haché DÈS cette étape 2 —
// AVANT que writeManifest() (étape 4) ne republie la nouvelle URL — fenêtre où le manifeste
// ENCORE PUBLIÉ (celui qu'un navigateur/CDN a déjà chargé) nommait un fichier déjà disparu.
// Seul un fichier qu'un build a écrit (registre, cf. registeredOutputs) est remplacé, jamais un fichier de l'auteur qui n'a
// que la forme d'une sortie : `card-utils.js` à côté d'un composant `card.mjs`, `logo-white.png` à côté d'une image
// `logo.png`, un fichier source quand le dossier de sortie est le dossier source. `prune: false` : rien n'est retiré.
export function cleanupOldHashes(bundler: Bundler, baseName: string, ext: string, keepFilenames: string[]): void {
  if (!bundler.prune) return
  const re = new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(?:[0-9a-z]{5}|[a-f0-9]{8})${ext.replace('.', '\\.')}(\\.map)?$`)
  const ecrits = bundler['registeredOutputs']()
  // mémoïsée le temps du compile() (cf. currentOutputDirListing) plutôt que relue à CHAQUE
  // appel : un projet de plusieurs centaines d'unités relisait sinon outputDir en entier une
  // fois PAR fichier écrit.
  for (const f of bundler['currentOutputDirListing']()) {
    if (re.test(f) && !keepFilenames.includes(f) && ecrits.has(f.replace(/\.map$/, ''))) {
      bundler['pendingHashCleanup'].push(join(bundler.outputDir, f))
    }
  }
}

// registeredOutputs() : les fichiers que des builds de ce constructeur ont écrits, tels que le registre les consigne (clé
// `files`) — la seule liste de ce que le ménage peut retirer. Lue une fois par compile(), comme la liste de outputDir
export function registeredOutputs(bundler: Bundler): Set<string> {
  if (bundler['registryFilesCache'] === null) bundler['registryFilesCache'] = new Set(bundler['readRegistryFiles']())
  return bundler['registryFilesCache']
}

// flushPendingHashCleanup() : supprime pour de bon les anciens fichiers hachés mis en attente
// par cleanupOldHashes() ci-dessus. Appelée UNIQUEMENT après que writeManifest() ait réussi
// (compile(), étape 4) : avant cet instant, l'ancien fichier peut encore être celui que le
// manifeste PUBLIÉ sur disque promet à un visiteur/CDN.
// PUBLIC : bundler/startup.ts écrit ses fichiers de page APRÈS compile() et suit la même
// discipline — nouveau fichier écrit, fragment réécrit, ANCIEN supprimé seulement ensuite.
// Le registre des sorties suit (cf. writeOutputsRegistry) : les fichiers retirés en sortent, ceux écrits depuis le compile()
// (fichiers de page de startup.ts) y entrent — le ménage du build suivant les connaîtra.
export function flushPendingHashCleanup(bundler: Bundler): void {
  for (const f of bundler['pendingHashCleanup']) {
    if (bundler['flushWillRemove'](basename(f))) try { unlinkSync(f) } catch {}
  }
  bundler['pendingHashCleanup'] = []
  bundler['writeOutputsRegistry']()
}

// flushWillRemove() : un fichier en attente part-il au prochain flushPendingHashCleanup() ? Non s'il a été émis par CE compile
// (homonyme d'un autre dossier, a/util.js et b/util.js, ou réémis depuis sa mise en attente), ou cité par une unité que le
// cache a resservie CE tour-ci (un homonyme resté en cache, donc non réécrit) : encore référencé, jamais supprimé — sa carte
// `.map` non plus. Un fichier dont la source existe toujours mais que plus personne ne cite n'est pas protégé : il part.
// `prune: false` : rien ne part, quelle que soit la file qui l'a mis en attente (ménage des empreintes, fichiers voisins
// du manifeste en mode 'bundle')
export function flushWillRemove(bundler: Bundler, nom: string): boolean {
  return bundler.prune && !bundler['emittedThisCompile'].has(nom) && !bundler['cachedAssetNames'].has(nom) && !(nom.endsWith('.map') && bundler['emittedThisCompile'].has(nom.slice(0, -4)))
}

// keepCachedAssets() : les images, sons et .js voisins d'une unité que le cache resert ne sont pas réécrits
// ce tour-ci (cf. cachedAssetNames) : le précache les garde
export function keepCachedAssets(bundler: Bundler, cached: CacheEntry): void {
  for (const dep of cached.importedModules ?? []) {
    const published = bundler['publishedAssets'].get(dep)
    if (!published) continue
    bundler['cachedAssetNames'].add(published.name)
    for (const variant of published.variants) bundler['cachedAssetNames'].add(variant)
  }
}

// notePublished() : le nom que porte, sous outputDir, la copie de CETTE source — l'ancien nom du même
// chemin cesse d'être protégé (il part au prochain ménage), le nom d'un autre chemin reste protégé
export function notePublished(bundler: Bundler, source: string, filename: string): void {
  if (bundler['publishedAssets'].get(source)?.name === filename) return
  bundler['publishedAssets'].set(source, { name: filename, variants: new Set() })
}

// --------------------------------------------------------------------------
// outputsRegistry — `.mjs-outputs.json`, à côté du manifeste, réécrit à
// CHAQUE build réussi. Ne mémorise PAS les noms de fichiers (déjà couverts par
// emittedThisCompile, qui ne survit pas d'un compile() à l'autre) mais les EXTENSIONS que ce
// bundler sait produire : `.js`/`.css`/`.map` toujours, les formats image CONFIGURÉS
// (imageConfig.formats, même si aucune image n'a encore été compilée), et toute extension
// RÉELLEMENT vue dans emittedThisCompile (assets µasset() génériques : .png, .woff2, un .pdf
// légitimement servi…) — le tout ACCUMULÉ avec ce qui était déjà dans le registre (une
// extension vue un jour le reste, même si un rebuild n'y touche plus ou que la config change).
//
// Sert de garde-fou à pruneOrphans() (ci-dessous) : un fichier au nom hachage-compatible mais
// dont l'extension n'y a JAMAIS figuré n'est pas un candidat, même s'il en a la forme — c'est
// exactement le cas d'un fichier étranger déposé à la main (rapport-1a2b3c4d.pdf), que
// docs/32-cli-et-configuration.md promet intact et que HASHED_OUTPUT_RE seul ne peut pas
// distinguer d'une vraie sortie.
// --------------------------------------------------------------------------
export function outputsRegistryPath(bundler: Bundler): string {
  return join(dirname(bundler.manifestPath), '.mjs-outputs.json')
}

export function writeOutputsRegistry(bundler: Bundler): void {
  const known = new Set<string>(['.js', '.css', '.map'])
  for (const fmt of bundler.imageConfig.formats) known.add(`.${fmt}`)
  for (const f of bundler['emittedThisCompile']) known.add(extname(f.endsWith('.map') ? f.slice(0, -4) : f))
  // fragments de traduction : ceux d'avant (que la purge n'a pas encore retirés) + ceux de ce build
  const fragments = new Map<string, Set<string>>()
  const ajoute    = (lang: string, nom: string): void => { (fragments.get(lang) ?? fragments.set(lang, new Set()).get(lang)!).add(nom) }
  try {
    const prev = JSON.parse(readFileSync(bundler['outputsRegistryPath'](), 'utf-8'))
    if (Array.isArray(prev?.extensions)) for (const e of prev.extensions) if (typeof e === 'string') known.add(e)
    for (const [lang, noms] of Object.entries(prev?.i18nFragments ?? {})) if (Array.isArray(noms)) for (const nom of noms) if (typeof nom === 'string') ajoute(lang, nom)
  } catch { /* registre absent ou périmé : repart d'une base saine, réécrite juste après */ }
  for (const [lang, noms] of bundler.i18nWritten) for (const nom of noms) ajoute(lang, nom)
  // fichiers écrits par les builds, l'une ou l'autre forme d'empreinte : ceux d'avant + ceux de ce build — la seule liste de ce
  // que le ménage peut retirer (cf. registeredOutputs, pruneOrphans)
  // (ceux que le build a déjà remplacés n'existent plus : ils sortent de la liste, qui ne grossit pas à chaque édition)
  const fichiers = new Set<string>(bundler['readRegistryFiles']().filter(f => existsSync(join(bundler.outputDir, f))))
  for (const f of bundler['emittedThisCompile']) if (isHashedOutputName(f)) fichiers.add(f)
  // premier build en échec : le dossier du manifeste n'existe pas encore (writeManifest(), qui le crée, n'a pas tourné)
  mkdirSync(dirname(bundler['outputsRegistryPath']()), { recursive: true })
  bundler['writeIfChanged'](bundler['outputsRegistryPath'](), bundler['serializeOutputsRegistry'](known, fragments, fichiers, bundler['registryChunks']()))
}

/** `chunks` du registre : les fichiers écrits à côté du manifeste (cf. bundleNeighborFiles) qui existent encore, avec ceux de ce build */
export function registryChunks(bundler: Bundler): Set<string> {
  const dossier = dirname(bundler.manifestPath)
  const voisins = new Set<string>(bundleNeighborFiles(bundler.manifestPath).filter(f => existsSync(join(dossier, f))))
  for (const f of bundler['bundleChunkFiles']) voisins.add(f)
  return voisins
}

/** `files` du registre : les fichiers à empreinte que des builds ont écrits (liste vide si registre absent ou illisible) */
export function readRegistryFiles(bundler: Bundler): string[] {
  try {
    const prev = JSON.parse(readFileSync(bundler['outputsRegistryPath'](), 'utf-8'))
    return Array.isArray(prev?.files) ? prev.files.filter((n: unknown): n is string => typeof n === 'string') : []
  } catch {
    return []
  }
}

// ecritDansSources() : le dossier de sortie ou le manifeste sont dans le dossier des sources. Les sorties à nom fixe y côtoient
// les fichiers de l'auteur : elles portent la marque des fichiers produits, et seul un fichier qui la porte est remplacé
// (cf. sortieDuBuild). Hors de ce cas, aucune marque
export function ecritDansSources(bundler: Bundler): boolean {
  return cheminDansDossier(bundler.outputDir, bundler.sourceDir) || cheminDansDossier(bundler.manifestPath, bundler.sourceDir)
}

// refusFichierAuteur() : dans une construction qui écrit dans le dossier des sources, une sortie à nom fixe tomberait sur un
// fichier qui existe sans être une sortie du build (cf. sortieDuBuild) : c'est peut-être un fichier de l'auteur, jamais remplacé
export function refusFichierAuteur(bundler: Bundler, target: string, sorte: SorteSortie): Error | null {
  if (!existsSync(target) || !bundler['ecritDansSources']() || sortieDuBuild(target, sorte)) return null
  return erreurFichiersAuteur([[target, sorte]], bundler.sourceDir, false)
}

// refusSortiesAuteur() : la même règle pour toutes les sorties à nom fixe d'un coup — le manifeste, `mjs-precache.json` et
// les feuilles de mise en page trouvées par feuillesAttendues() : une seule erreur les nomme toutes, avant toute écriture
// Hors du dossier des sources, seul le manifeste peut tomber sur un fichier de l'auteur (`manifestPath` vise
// `app/assets/javascripts/application.js`) : il ne porte jamais la marque, il est reconnu à sa forme, de cette version ou
// d'une précédente (cf. sortieDuBuild) ; un dossier à sa place n'est pas un fichier à protéger, son écriture échoue d'elle-même.
// Dans les sources comme dehors, un fichier vide à la place du manifeste est remplacé (cf. fichierVide), et un manifeste déjà
// refusé (`manifeste` faux, cf. refusCheminManifeste) n'est pas nommé une seconde fois
export function refusSortiesAuteur(bundler: Bundler, manifeste = true, fragments = true): Error | null {
  if (!bundler['ecritDansSources']()) {
    if (!manifeste || !existsSync(bundler.manifestPath) || !statSync(bundler.manifestPath).isFile() || fichierVide(bundler.manifestPath) || sortieDuBuild(bundler.manifestPath, 'manifeste')) return null
    return new Error(t('bundler.index.manifeste-fichier-auteur', { chemin: bundler.manifestPath }))
  }
  const cibles: [string, SorteSortie][] = manifeste ? [[bundler.manifestPath, 'manifeste']] : []
  cibles.push([join(bundler.outputDir, 'mjs-precache.json'), 'precache'])
  if (!bundler['isProd']()) cibles.push([join(bundler.outputDir, '.mjs-theme-vars.json'), 'registre-theme'])
  if (bundler.shouldMinify()) cibles.push([bundler['mangleCachePath'], 'noms-courts'])
  if (bundler.jsMode === 'bundle' && bundler.shouldEmitSourceMap()) cibles.push([`${bundler.manifestPath}.map`, 'carte'])
  if (fragments) for (const f of bundler['fragmentsAttendus']()) cibles.push([f, 'traduction'])
  const fichiers = cibles.filter(([f, sorte]) => existsSync(f) && !(sorte === 'manifeste' && fichierVide(f)) && !sortieDuBuild(f, sorte))
  for (const f of bundler['feuillesAttendues']()) fichiers.push([f, 'feuille'])
  return fichiers.length > 0 ? erreurFichiersAuteur(fichiers, bundler.sourceDir, true) : null
}

// i18nHashed() : fragments de traduction sous empreinte (`i18n.hash`, `'auto'` = en production seulement) ou à nom clair
export function i18nHashed(bundler: Bundler): boolean {
  const hashMode = bundler.i18n?.hash ?? 'auto'
  return hashMode === 'auto' ? bundler['isProd']() : hashMode
}

// fragmentsAttendus() : les fragments à nom clair que les traductions par sections (`i18n/<langue>/<section>.json|yml`)
// feront écrire dans `outputDir/i18n/<langue>/` ; un fragment qui échapperait à cette liste reste refusé au moment de
// l'écrire (cf. writeSortieDifferee)
export function fragmentsAttendus(bundler: Bundler): string[] {
  const i18nDir = join(bundler.sourceDir, 'i18n')
  if (bundler['i18nHashed']() || !bundler['hasI18nConfigured']()) return []
  const fragments: string[] = []
  try {
    for (const lang of readdirSync(i18nDir).sort()) {
      if (!statSync(join(i18nDir, lang)).isDirectory()) continue
      for (const f of readdirSync(join(i18nDir, lang)).sort()) {
        if (['.yml', '.yaml', '.json'].includes(extname(f))) fragments.push(join(bundler.outputDir, 'i18n', lang, `${basename(f, extname(f))}.json`))
      }
    }
  }
  catch {
    // dossier illisible : refusI18nSurPlace() rend son erreur
  }
  return fragments
}

// refusAvantEcriture() : ce que compile() refuse avant d'écrire quoi que ce soit — un manifeste qui remplacerait un fichier source
// (cf. refusCheminManifeste), le dossier des traductions comme dossier de sortie (cf. refusI18nSurPlace), et des sorties à nom fixe
// sur des fichiers de l'auteur (cf. refusSortiesAuteur)
export function refusAvantEcriture(bundler: Bundler): Error[] {
  const manifeste = bundler['refusCheminManifeste']()
  const i18n      = bundler['refusI18nSurPlace']()
  // un manifeste ou des traductions déjà refusés ne sont pas nommés une seconde fois comme fichiers de l'auteur
  return [manifeste, i18n, bundler['refusSortiesAuteur'](manifeste === null, i18n === null)].filter((e): e is Error => e !== null)
}

// refusCheminManifeste() : les refus de `manifestPath` que mjs.config.json et la ligne de commande appliquent déjà (cf.
// refusManifestPath, config.ts), pour `new Bundler()` appelé par l'API — sinon le fichier visé était écrasé à chaque construction
export function refusCheminManifeste(bundler: Bundler): Error | null {
  const refus = refusManifestPath({ manifestPath: bundler.manifestPath, sourceDir: bundler.sourceDir, outputDir: bundler.outputDir, manifestExternal: bundler.manifestExternal })
  if (refus === null) return null
  if (refus.raison === 'extension') return new Error(t('bundler.index.manifeste-refuse-extension', { chemin: bundler.manifestPath, extension: refus.extension }))
  if (refus.raison === 'externe') return new Error(t('bundler.index.manifeste-refuse-externe', { chemin: bundler.manifestPath }))
  return new Error(t('bundler.index.manifeste-refuse-sources', { chemin: bundler.manifestPath, sourceDir: bundler.sourceDir, outputDir: bundler.outputDir }))
}

// refusI18nSurPlace() : traductions par sections (`i18n/<langue>/*.json|yml`) et dossier de sortie qui mène au dossier des
// traductions — même règle que scanI18n(), qui ne tourne qu'après l'écriture des sorties. Une entrée illisible du dossier des
// traductions ferait échouer scanI18n() : son erreur est rendue ici, avant toute écriture
export function refusI18nSurPlace(bundler: Bundler): Error | null {
  const i18nDir = join(bundler.sourceDir, 'i18n')
  try {
    if (!existsSync(i18nDir) || !statSync(i18nDir).isDirectory()) return null
    for (const lang of readdirSync(i18nDir).sort()) {
      const dossier = join(i18nDir, lang)
      if (!statSync(dossier).isDirectory()) continue
      if (!readdirSync(dossier).some(f => ['.yml', '.yaml', '.json'].includes(extname(f)))) continue
      const outDir = join(bundler.outputDir, 'i18n', lang)
      if (cheminDansDossier(outDir, i18nDir)) return new Error(t('bundler.index.i18n-sortie-dans-sources', { dossier: outDir, sources: i18nDir }))
    }
  } catch (e: any) {
    return e instanceof Error ? e : new Error(String(e))
  }
  return null
}

/** Forme écrite de `.mjs-outputs.json` : `extensions` toujours, `i18nFragments` (langue → noms) seulement s'il y en a. */
export function serializeOutputsRegistry(bundler: Bundler, known: Set<string>, fragments: Map<string, Set<string>>, files: Set<string> = new Set(), chunks: Set<string> = new Set()): string {
  const body: { extensions: string[], i18nFragments?: Record<string, string[]>, files?: string[], chunks?: string[], ssrStyles?: string[] } = { extensions: [...known].sort() }
  if (files.size > 0) body.files = [...files].sort()
  // fichiers écrits à côté du manifeste quand le fichier unique est coupé en morceaux : la seule liste de ceux que le build peut retirer ou que les serveurs servent
  if (chunks.size > 0) body.chunks = [...chunks].sort()
  // feuilles partagées que le rendu serveur a écrites (cf. server/sorties-rendu.ts) : gardées d'un build au suivant, celles qui n'existent plus sortent de la liste
  const rendu = feuillesConsignees(dirname(bundler.manifestPath)).filter(f => existsSync(join(bundler.outputDir, f)))
  if (rendu.length > 0) body.ssrStyles = rendu
  const langs = [...fragments.keys()].filter(l => fragments.get(l)!.size > 0).sort()
  if (langs.length > 0) {
    body.i18nFragments = {}
    for (const l of langs) body.i18nFragments[l] = [...fragments.get(l)!].sort()
  }
  return JSON.stringify(body, null, 2) + '\n'
}

// retire de `i18n/<langue>/` les fragments que le registre dit écrits par un build et que CE build n'a pas
// réécrits ; seuls des noms simples (jamais un chemin) sont suivis. Le registre est réécrit avec ce qui reste
export function pruneI18nFragments(bundler: Bundler, knownExt: Set<string>, purged: Set<string>): { removed: string[], failed: string[] } {
  const removed: string[] = []
  const failed: string[]  = []
  let prev: any
  try {
    prev = JSON.parse(readFileSync(bundler['outputsRegistryPath'](), 'utf-8'))
  } catch {
    return { removed, failed }
  }
  const simple  = (n: string): boolean => n !== '' && n !== '.' && n !== '..' && !n.startsWith('.') && !/[\\/\0]/.test(n)
  const restant = new Map<string, Set<string>>()
  for (const [lang, noms] of Object.entries(prev?.i18nFragments ?? {})) {
    if (!Array.isArray(noms) || !simple(lang)) continue
    const courants = bundler.i18nWritten.get(lang) ?? new Set<string>()
    for (const nom of noms) {
      if (typeof nom !== 'string' || !simple(nom) || !nom.endsWith('.json')) continue
      if (!courants.has(nom)) {
        const chemin = join(bundler.outputDir, 'i18n', lang, nom)
        // jamais une traduction de l'auteur (sortie = sources), même nommée par le registre : elle reste, et sort du registre
        if (cheminDansDossier(chemin, join(bundler.sourceDir, 'i18n'))) continue
        try {
          if (existsSync(chemin)) unlinkSync(chemin)
          removed.push(`i18n/${lang}/${nom}`)
          continue
        } catch {
          failed.push(`i18n/${lang}/${nom}`)
        }
      }
      ;(restant.get(lang) ?? restant.set(lang, new Set()).get(lang)!).add(nom)
    }
  }
  const fichiers = new Set(bundler['readRegistryFiles']().filter(f => !purged.has(f)))
  bundler['writeIfChanged'](bundler['outputsRegistryPath'](), bundler['serializeOutputsRegistry'](knownExt, restant, fichiers, bundler['registryChunks']()))
  return { removed, failed }
}

// --------------------------------------------------------------------------
// pruneBundleChunks() : la purge du mode 'bundle'. Le cœur est dans le fichier unique : `mjs_core-….js` n'existe pas, la garde
// `no-core` de pruneOrphans() ne dit rien ici. Les seuls candidats sont les fichiers que le registre dit écrits à côté du
// manifeste par un build (clé `chunks`) et que CE build n'a pas réécrits — un module retiré ou renommé laisse les siens d'un
// processus à l'autre —, jamais un fichier reconnu à la forme de son nom : un fichier d'auteur nommé `chunk-deadbeef.js`, posé à
// côté du manifeste (dans le dossier de sortie ou ailleurs), n'y figure pas. Un registre présent mais illisible bloque tout.
// --------------------------------------------------------------------------
export function pruneBundleChunks(bundler: Bundler): { removed: string[], failed: string[], skipped?: 'registry-unreadable' } {
  const dossier = dirname(bundler.manifestPath)
  const chemin  = bundler['outputsRegistryPath']()
  if (!existsSync(chemin)) return { removed: [], failed: [] }
  try {
    JSON.parse(readFileSync(chemin, 'utf-8'))
  } catch {
    return { removed: [], failed: [], skipped: 'registry-unreadable' }
  }
  const removed: string[] = []
  const failed: string[]  = []
  const manifeste = basename(bundler.manifestPath)
  for (const nom of bundleNeighborFiles(bundler.manifestPath)) {
    if (bundler['bundleChunkFiles'].has(nom) || nom.replace(/\.map$/, '') === manifeste) continue // écrit ce tour-ci, ou le manifeste lui-même
    const fichier = join(dossier, nom)
    if (!existsSync(fichier)) continue
    try {
      unlinkSync(fichier)
      removed.push(nom)
    } catch {
      failed.push(nom)
    }
  }
  if (removed.length > 0) bundler['writeOutputsRegistry']() // le registre ne consigne plus ce qui n'existe plus
  removed.sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
  failed.sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
  return { removed, failed }
}

// --------------------------------------------------------------------------
// pruneOrphans() : purge — le build remplace déjà l'empreinte
// d'un fichier qui CHANGE (cleanupOldHashes ci-dessus), mais jamais un NOM qui DISPARAÎT
// (composant renommé ou supprimé) : mesuré sur un vrai projet, 893 fichiers / 17 Mo dans
// outputDir pour 330 écrits par le dernier build. Rien n'est SERVI (le manifeste ne les
// référence plus), mais le dossier MENT sur ce que le site contient réellement.
//
// Retire d'outputDir tout fichier qu'un build a écrit (registre `.mjs-outputs.json`, clé `files`, au nom de la famille
// émise par CE bundler) qu'AUCUNE émission de ce compile() n'a produit (`emittedThisCompile`) — jamais un fichier sur la
// seule forme de son nom, même à huit hexadécimaux (`vendor-0123abcd.js` déposé à la main). `prune: false` : rien.
//
// Dans `i18n/<langue>/`, seuls partent les fragments que le registre dit écrits par un build et que ce build
// n'a pas réécrits (cf. pruneI18nFragments) : jamais un fichier de l'utilisateur, jamais d'après la forme du nom.
//
// JAMAIS touché : un SOUS-DOSSIER (i18n/, mjs_pages/… — readdirSync filtré à `isFile()`) ; un
// DOTFILE (`.mangle-cache.json`, `.mjs-theme-vars.json`) ; un nom STABLE qui ne matche pas la
// famille hachée (le manifeste, un CSS de layout `<module>.<layout>.css`, `mjs-precache.json`) ;
// tout fichier ÉTRANGER au build ; ni sur un compile qui a resservi son cache. LE MANIFESTE, PAR
// SON NOM, même s'il matche la famille hachée par collision de config
// (`manifestPath`/`--manifest` en `<base>-<empreinte>.<ext>`) : `writeManifest()` écrit hors de
// `emittedThisCompile`, un nom qui matche s'auto-détruisait sinon au build qui vient de l'écrire.
//
// Mode `js: 'bundle'` : le cœur est dans le fichier unique, le reste de cette méthode ne s'applique pas ; seule tourne la
// purge des fichiers écrits à côté du manifeste que le registre consigne (cf. pruneBundleChunks).
//
// GARDES, sans exception (rendent `{ removed: [], failed: [], skipped: '…' }` sans rien lire ni
// supprimer — `skipped` absent seulement quand la purge a tourné) :
//  - aucun compile() n'a encore tourné, OU le dernier est EN ERREUR (`skipped: 'errors'`) : un
//    build partiel garde tout (cf. recoverFailedComponentManifest) — purger sur un ensemble
//    d'émissions incomplet effacerait des fichiers ENCORE valides.
//  - `emittedThisCompile` est vide (`skipped: 'empty'`) : rien de fiable à quoi comparer.
//  - AUCUNE entrée de `emittedThisCompile` n'est le runtime `mjs_core-<empreinte>.js`
//    (`skipped: 'no-core'`) — il est émis par TOUT build sain ; son absence signale un
//    ensemble non fiable plutôt qu'un site sans runtime — une garde MUETTE ici effacerait TOUT
//    outputDir.
//  - outputDir n'existe pas (`skipped: 'no-dir'`).
//  - CE compile() a resservi au moins un composant depuis un compile() PRÉCÉDENT (`skipped:
//    'cache'`, cf. `cacheHitsThisCompile`/
//    `compileGeneration`) : `_compileMjsInner`/`_compileScriptModuleInner` réinjectent le `.js` du
//    cache hit dans `emittedThisCompile` mais jamais ses assets annexes (`µasset`, variantes
//    d'image — `resolveOneAsset` n'est rappelé QUE sur recompilation) ; purger sur cet ensemble
//    partiel retirerait un asset encore référencé en dur par le `.js` resservi. NE COMPTE PAS un
//    hit sur une entrée posée PENDANT ce même compile() (composant redemandé 2 fois dans le même
//    tour — resolveTagShortcuts, une inclusion…) : ses assets annexes ont déjà été émis ce
//    tour-ci, hit inoffensif (11 hits de ce genre mesurés sur un build FROID d'un site réel,
//    685 fichiers — la garde se déclenchait alors sur CHAQUE `mjs build` d'un vrai
//    projet, la purge n'y tournait donc JAMAIS). Cette garde ne vise plus que l'instance réutilisée
//    entre au moins 2 `compile()` (watcher, `mjs dev`, API).
// --------------------------------------------------------------------------
export function pruneOrphans(bundler: Bundler): { removed: string[], failed: string[], skipped?: 'errors' | 'empty' | 'no-core' | 'no-dir' | 'cache' | 'registry-unreadable' | 'registry-empty' | 'disabled' } {
  if (!bundler.prune) return { removed: [], failed: [], skipped: 'disabled' } // `prune: false` : rien n'est retiré
  if (bundler['lastCompileErrors'] !== 0) return { removed: [], failed: [], skipped: 'errors' } // aucun compile, ou un compile en erreur
  if (bundler.jsMode === 'bundle') return bundler['pruneBundleChunks']() // fichier unique : pas de cœur à part, seuls les fichiers consignés à côté du manifeste
  if (bundler['emittedThisCompile'].size === 0) return { removed: [], failed: [], skipped: 'empty' } // rien à comparer
  if (![...bundler['emittedThisCompile']].some(f => /^mjs_core-(?:[0-9a-z]{5}|[a-f0-9]{8})\.js$/.test(f))) return { removed: [], failed: [], skipped: 'no-core' } // ensemble non fiable
  if (!existsSync(bundler.outputDir)) return { removed: [], failed: [], skipped: 'no-dir' }
  if (bundler['cacheHitsThisCompile'] > 0) return { removed: [], failed: [], skipped: 'cache' } // assets annexes non réinjectés par le(s) cache hit(s)

  // Extensions que CE bundler sait produire (cf. writeOutputsRegistry) :
  // garde-fou EN PLUS de emittedThisCompile, pas à sa place — un fichier qui matche
  // HASHED_OUTPUT_RE par pure coïncidence de nom (rapport-1a2b3c4d.pdf déposé à la main) mais
  // dont l'extension n'a JAMAIS figuré au registre n'est pas un candidat. Registre absent (jamais
  // écrit encore) : base sûre minimale, rien de perdu — PRÉSENT mais illisible : garde muette
  // interdite, la purge ENTIÈRE est bloquée plutôt que de deviner.
  let knownExt: Set<string>
  const registryPath = bundler['outputsRegistryPath']()
  if (existsSync(registryPath)) {
    try {
      const parsed = JSON.parse(readFileSync(registryPath, 'utf-8'))
      if (!Array.isArray(parsed?.extensions) || !parsed.extensions.every((e: unknown) => typeof e === 'string')) throw new Error('forme inattendue')
      knownExt = new Set<string>(parsed.extensions)
    } catch {
      return { removed: [], failed: [], skipped: 'registry-unreadable' }
    }
    // `{"extensions":[]}` est un JSON PARFAITEMENT valide
    // (tableau, `.every()` vacuement vrai sur un tableau vide) : sans cette garde, `knownExt`
    // restait VIDE, chaque fichier échouait silencieusement le test d'extension connue plus bas,
    // removed:[] était rendu SANS jamais poser `skipped` — même silhouette qu'un run sain « rien
    // à purger ». Un zombie survivait indéfiniment, indiscernable d'un build propre.
    if (knownExt.size === 0) return { removed: [], failed: [], skipped: 'registry-empty' }
  } else {
    knownExt = new Set<string>(['.js', '.css', '.map'])
    for (const fmt of bundler.imageConfig.formats) knownExt.add(`.${fmt}`)
  }
  const hashedOutputExt = (name: string): string => extname(name.endsWith('.map') ? name.slice(0, -4) : name)

  // le manifeste ne passe jamais par emittedThisCompile (écrit par writeManifest(), hors filet) :
  // protégé PAR SON NOM quand il est logé DANS outputDir, sans condition de motif — sur les chemins
  // RÉELS : un lien symbolique vers outputDir faisait échouer l'égalité de chaînes, manifeste retiré
  const sameDir      = (a: string, b: string): boolean => { try { return realpathSync(a) === realpathSync(b) } catch { return a === b } }
  const manifestName = sameDir(dirname(bundler.manifestPath), bundler.outputDir) ? basename(bundler.manifestPath) : null

  const removed: string[] = []
  const failed: string[]  = []
  const registreFichiers  = new Set(bundler['readRegistryFiles']())
  // feuilles partagées du rendu serveur que ce processus n'a pas réécrites : celles que le dernier prérendu n'utilise plus
  const feuillesRenduInutiles = new Set(feuillesRenduPerimees(dirname(bundler.manifestPath)))
  const purgesCourtes     = new Set<string>()
  for (const entry of readdirSync(bundler.outputDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue // jamais un sous-dossier (i18n/, mjs_pages/…)
    const name = entry.name
    if (name.startsWith('.')) continue // jamais un dotfile (.mangle-cache.json…, .mjs-outputs.json compris)
    if (manifestName !== null && name.replace(/\.map$/, '') === manifestName) continue // jamais le manifeste, ni son .map
    // seul un fichier qu'un build a écrit est candidat (registre, clé `files`), ou une feuille partagée que le registre dit
    // écrite par un prérendu : aucune forme de nom ne suffit, ni à cinq caractères (`theme-light.css`) ni à huit
    // hexadécimaux (`vendor-0123abcd.js` déposé à la main)
    const consigne = registreFichiers.has(name.replace(/\.map$/, '')) || feuillesRenduInutiles.has(name)
    if (!consigne || !isHashedOutputName(name)) continue // jamais un nom STABLE (bundle.js, mjs-precache.json, CSS de layout…)
    if (SERVER_WRITTEN_RE.test(name) && !feuillesRenduInutiles.has(name)) continue // jamais un asset écrit par le rendu serveur (cf. SERVER_WRITTEN_RE), sauf une feuille partagée que le registre dit écrite par un prérendu précédent et que celui-ci n'a pas réécrite
    if (bundler['emittedThisCompile'].has(name)) continue // émis ce tour-ci
    if (name.endsWith('.map') && bundler['emittedThisCompile'].has(name.slice(0, -4))) continue // .map d'un .js émis ce tour-ci
    if (!knownExt.has(hashedOutputExt(name))) continue // Extension jamais produite par CE bundler : jamais un candidat
    if (name.endsWith('.json') && !name.startsWith('mjs_err-')) continue // en JSON, ce bundler n'écrit que les fichiers de messages : tout autre nom est au projet
    try {
      unlinkSync(join(bundler.outputDir, name))
      removed.push(name)
      purgesCourtes.add(name)
    } catch {
      failed.push(name)
    }
  }
  if (existsSync(registryPath)) {
    const fragments = bundler['pruneI18nFragments'](knownExt, purgesCourtes)
    removed.push(...fragments.removed)
    failed.push(...fragments.failed)
  }
  removed.sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
  failed.sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
  return { removed, failed }
}

// même motif que writeFileAtomic ci-dessus, non réutilisable ici : le
// manifest change de contenu à chaque build, alors que writeFileAtomic
// skippe si `target` existe déjà — inadapté à un chemin FIXE dont le
// contenu varie. Extrait de writeManifest() pour rester testable isolément
// (cf. tests/bundler-manifest-atomic.test.ts).
export function writeFileAtomicAlways(bundler: Bundler, target: string, content: string | Buffer): void {
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  writeFileSync(tmp, content, 'utf-8')
  try {
    renameSync(tmp, target)
  } catch (e) {
    try { unlinkSync(tmp) } catch {}
    throw e
  }
}
