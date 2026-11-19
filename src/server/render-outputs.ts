// Feuilles partagées d'un composant dans le HTML rendu : forme (en ligne ou liée) et fichiers écrits.
//
// Une racine d'ombre ne voit pas les feuilles d'une autre : chaque racine d'un fragment doit porter
// SES feuilles partagées (remise à zéro, héritées d'une vue, `@css`), sinon la page change de
// géométrie au démarrage du JavaScript. Écrites telles quelles, elles se répètent par racine : 300
// composants identiques et une feuille de 37 Ko faisaient 11,4 Mo de HTML.
//
// RÈGLE — une feuille partagée sort en `<style>` en ligne tant que la répéter coûte peu : surcoût
// (occurrences - 1) x taille, sous SHEET_OVERHEAD_THRESHOLD. Au-delà, en `<link rel="stylesheet">` vers
// UN fichier nommé par l'empreinte de son contenu, écrit une seule fois : même URL pour toutes les
// racines (une requête), même fichier pour les autres pages (cache du navigateur). Mesuré dans
// Chromium : le `<link>` d'une racine d'ombre déclarative ne fait pas sauter la mise en page
// (la racine n'est peinte qu'avec sa feuille), mais l'analyse de la page attend l'arrivée du fichier
// — d'où le `<style>` en ligne pour le petit surcoût, qui ne coûte aucune requête de plus à une
// page ordinaire. Sans dossier de sortie propre (rendu ponctuel), il n'y a aucun fichier à servir :
// tout reste en ligne.
//
// Les fichiers écrits sont consignés dans le registre des sorties du build (`.mjs-outputs.json`,
// clé `ssrStyles`) : la purge de fin de build retire ceux que ce build n'a plus écrits.

import { readFileSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'
import { randomBytes } from 'node:crypto'
import { writeHashedAsset } from './ssr-head.js'
import { writeFileAtomicAlways } from '../bundler/outputs.js'

/** Surcoût (octets) au-delà duquel une feuille partagée sort en fichier lié. */
export const SHEET_OVERHEAD_THRESHOLD = 8192

/** Nom d'une feuille partagée écrite par le rendu : `mjs_ssr_style_shared-<nom>-<empreinte>.css`. */
export const SHARED_SHEET_RE = /^mjs_ssr_style_shared-[\w-]+-[0-9a-f]{8}\.css$/

// noms écrits PAR CE PROCESSUS, par dossier : ce que le rendu de ce build utilise
const written = new Map<string, Set<string>>()

const registryName = '.mjs-outputs.json'

function readRegistry(dir: string): any | null {
  try {
    const raw = JSON.parse(readFileSync(join(dir, registryName), 'utf-8'))
    return raw && Array.isArray(raw.extensions) ? raw : null
  } catch {
    return null
  }
}

/** Noms consignés au registre sous `ssrStyles` (liste vide si registre absent ou illisible). */
export function recordedSheets(dir: string): string[] {
  const reg = readRegistry(dir)
  return reg && Array.isArray(reg.ssrStyles) ? reg.ssrStyles.filter((n: unknown): n is string => typeof n === 'string' && SHARED_SHEET_RE.test(n)) : []
}

// ajoute le nom au registre, seulement s'il existe déjà (un build l'a écrit) : un registre fabriqué ici
// sans les extensions du build ferait sauter la purge (« registre vide »)
function record(dir: string, name: string): void {
  const reg = readRegistry(dir)
  if (!reg) return
  const names = new Set<string>(recordedSheets(dir))
  if (names.has(name)) return
  names.add(name)
  reg.ssrStyles = [...names].sort()
  const path = join(dir, registryName)
  writeFileAtomicAlways(path, JSON.stringify(reg, null, 2) + '\n')
}

/** Écrit une feuille du rendu (nom par empreinte de contenu), la note comme écrite par ce rendu, rend son URL. */
export function writeRenderSheet(dir: string, urlPrefix: string, tag: string, css: string): string {
  const url = writeHashedAsset(dir, urlPrefix, 'mjs_ssr_style_' + tag, '.css', css)
  const name = basename(url)
  if (SHARED_SHEET_RE.test(name)) {
    const key = resolve(dir)
    const seen = written.get(key) ?? written.set(key, new Set()).get(key)!
    if (!seen.has(name)) {
      seen.add(name)
      record(dir, name)
    }
  }
  return url
}

/** Feuilles consignées par un build précédent que ce processus n'a pas (ré)écrites : plus utilisées, la purge les retire. */
export function staleRenderSheets(dir: string): string[] {
  const seen = written.get(resolve(dir)) ?? new Set<string>()
  return recordedSheets(dir).filter(n => !seen.has(n))
}

/** Feuilles (texte -> nombre de racines qui la portent) à sortir en fichier lié plutôt qu'en ligne. */
export function sheetsToBind(occurrences: Map<string, number>): Set<string> {
  const linked = new Set<string>()
  for (const [css, n] of occurrences) if ((n - 1) * Buffer.byteLength(css, 'utf-8') > SHEET_OVERHEAD_THRESHOLD) linked.add(css)
  return linked
}

/**
 * Plan d'un rendu : la sérialisation écrit un repère à la place de chaque feuille partagée, `finish`
 * décide en connaissant le nombre de racines (feuille par feuille, règle ci-dessus) et remplace les
 * repères par un `<style>` en ligne ou un `<link>`. `ref` : le HTML qui sert à compter (le fragment
 * entier), quand on finit une partie de lui.
 *
 * Le remplacement passe sur TOUT le HTML, données de la page comprises : le repère porte donc un sel
 * tiré au hasard pour chaque rendu. Une donnée (recherche de l'adresse, paramètre de route, texte venu
 * d'une base) qui reprend la forme d'un repère ne devine pas ce sel et reste une donnée ; sans lui, une
 * adresse qui répétait le repère faisait poser des `<link>` dans un attribut, dont le guillemet fermait
 * l'attribut. Un numéro sans feuille reste tel quel.
 */
export function createSheetPlan(inline: (css: string) => string, link: (css: string, tag: string) => string) {
  const ids                                    = new Map<string, number>()
  const sheets: { css: string; tag: string }[] = []
  const sel                                    = randomBytes(16).toString('hex')
  const landmark                               = new RegExp(`\u0000mjsf${sel}-(\\d+)\u0000`, 'g')
  return {
    mark(css: string, tag: string): string {
      let id = ids.get(css)
      if (id === undefined) {
        id = sheets.length
        ids.set(css, id)
        sheets.push({ css, tag })
      }
      return `\u0000mjsf${sel}-${id}\u0000`
    },
    finish(html: string, ref: string = html): string {
      const count = new Map<string, number>()
      for (const m of ref.matchAll(landmark)) {
        const f = sheets[+m[1]]
        if (f) count.set(f.css, (count.get(f.css) ?? 0) + 1)
      }
      const linked = sheetsToBind(count)
      return html.replace(landmark, (m, id) => {
        const f = sheets[+id]
        if (!f) return m
        return linked.has(f.css) ? link(f.css, f.tag) : inline(f.css)
      })
    },
  }
}

// `@import` d'une feuille partagée : le navigateur adopte ces feuilles par `replaceSync`, qui IGNORE
// les `@import` (aucune requête). Le texte prérendu les retire donc aussi : sinon le `<style>` du
// HTML en ferait une requête (relative à la page, en 404) que la page démarrée n'a jamais faite, et
// la mise en page prérendue ne serait pas celle d'après le démarrage.
export function withoutImports(css: string): string {
  return css.replace(/@import\s+(?:url\([^)]*\)|"[^"]*"|'[^']*')[^;{}]*;/gi, '')
}
