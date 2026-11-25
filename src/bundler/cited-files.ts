// --------------------------------------------------------------------------
// garde de fin de `mjs build` : chaque fichier que la sortie CITE y existe — les adresses `.js` gravées dans les modules livrés (sous
// le préfixe public de la sortie), celles du manifeste (sa table des chemins décodée comprise) et la liste de `mjs-precache.json`.
// Un module repris d'une construction d'avant (cache sur disque) ou une sortie effacée en partie citerait sinon un fichier absent, et
// la construction se dirait réussie : en ligne, la page ne charge plus. Lecture seule : chaque fichier lu une fois, un `existsSync`
// par adresse distincte ; une adresse hors du préfixe de la sortie (autre dossier, autre site) n'est pas la sienne
// --------------------------------------------------------------------------

import { existsSync, readFileSync } from 'node:fs'
import { basename, join, relative, resolve, sep } from 'node:path'
import { decodePathValue } from './manifest.js'

export interface CitedMissing { file: string, by: string }
export interface CitedCheck { missing: CitedMissing[], files: number, bytes: number }

const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// `delivered` : les fichiers livrés, chacun vu présent juste avant (cf. DeliveredFiles.missing)
export function citedMissing(outputDir: string, urlPrefix: string, manifestPath: string, delivered: string[]): CitedCheck {
  const prefix  = urlPrefix.endsWith('/') ? urlPrefix : `${urlPrefix}/`
  // une adresse entre guillemets qui commence par le préfixe : le nom qui suit, sans requête ni ancre, jusqu'au guillemet qui la ferme —
  // jamais une adresse calculée (`${…}` d'un gabarit), qui ne nomme aucun fichier
  const quoted  = new RegExp(`["'\`]${escapeRe(prefix)}([^"'\`?#\\s$]+)(?=["'\`?#])`, 'g')
  // sortie servie à la racine (aucun préfixe) : toute adresse absolue commence par `/`, une route du serveur (`/api/liste.js`) aussi ;
  // dans les modules et le manifeste, seuls les noms à empreinte que donne la construction (`nom-xxxxx.js`) sont alors les siens
  const ours    = (name: string): boolean => prefix !== '/' || /-[0-9a-z]{5}\.[a-z0-9]+$/.test(name)
  const known   = new Map<string, boolean>()
  const missing = new Map<string, string>()
  let files = 0
  let bytes = 0
  const read = (path: string): string => {
    const data = readFileSync(path)
    files++
    bytes += data.length
    return data.toString('utf-8')
  }
  // `address` : adresse complète ; hors du préfixe, ignorée
  const cite = (address: string, by: string): void => {
    if (!address.startsWith(prefix)) return
    const name = address.slice(prefix.length)
    if (!known.has(name)) known.set(name, existsSync(join(outputDir, name)))
    if (!known.get(name) && !missing.has(name)) missing.set(name, by)
  }
  // un fichier livré est là, sans `stat` de plus : la garde des fichiers livrés vient de le voir (cf. DeliveredFiles.missing)
  const manifest = resolve(manifestPath)
  for (const path of delivered) known.set(relative(outputDir, path).split(sep).join('/'), true)
  // les modules livrés : leurs adresses `.js` (le manifeste, lu plus bas, une fois)
  for (const path of delivered) {
    if (!path.endsWith('.js') || path === manifest) continue
    const by = relative(outputDir, path)
    for (const m of read(path).matchAll(quoted)) if (m[1].endsWith('.js') && ours(m[1])) cite(prefix + m[1], by)
  }
  // le manifeste : ses adresses de fichiers écrites en entier (jamais une route), puis sa table des chemins (préfixe commun et nom
  // encodé, cf. writeManifest)
  if (existsSync(manifestPath)) {
    const by   = basename(manifestPath)
    const text = read(manifestPath)
    for (const m of text.matchAll(quoted)) if (/\.(?:m?js|css|json)$/.test(m[1]) && ours(m[1])) cite(prefix + m[1], by)
    const head  = /^const µPathsPrefix = ("(?:[^"\\]|\\.)*");$/m.exec(text)
    const table = /^const µPaths = (\{.*\});$/m.exec(text)
    if (table !== null) {
      try {
        const common = head === null ? '' : JSON.parse(head[1]) as string
        for (const [key, value] of Object.entries(JSON.parse(table[1]) as Record<string, unknown>)) if (typeof value === 'string' && value !== '') cite(common + decodePathValue(key, value), by)
      }
      catch {
        // table illisible : jamais une garde qui passe sans l'avoir lue
        missing.set('µPaths', by)
      }
    }
  }
  // la liste du précache
  const precache = join(outputDir, 'mjs-precache.json')
  if (existsSync(precache)) {
    try {
      const list = JSON.parse(read(precache)) as { assets?: unknown }
      for (const address of Array.isArray(list.assets) ? list.assets : []) if (typeof address === 'string') cite(address, 'mjs-precache.json')
    }
    catch {
      missing.set('assets', 'mjs-precache.json')
    }
  }
  return { missing: [...missing].map(([file, by]) => ({ file, by })).sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0), files, bytes }
}
