// Feuilles partagées d'un composant dans le HTML rendu : forme (en ligne ou liée) et fichiers écrits.
//
// Une racine d'ombre ne voit pas les feuilles d'une autre : chaque racine d'un fragment doit porter
// SES feuilles partagées (remise à zéro, héritées d'une vue, `@css`), sinon la page change de
// géométrie au démarrage du JavaScript. Écrites telles quelles, elles se répètent par racine : 300
// composants identiques et une feuille de 37 Ko faisaient 11,4 Mo de HTML.
//
// RÈGLE — une feuille partagée sort en `<style>` en ligne tant que la répéter coûte peu : surcoût
// (occurrences - 1) x taille, sous SEUIL_SURCOUT_FEUILLE. Au-delà, en `<link rel="stylesheet">` vers
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

import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'
import { writeHashedAsset } from './ssr-head.js'

/** Surcoût (octets) au-delà duquel une feuille partagée sort en fichier lié. */
export const SEUIL_SURCOUT_FEUILLE = 8192

/** Nom d'une feuille partagée écrite par le rendu : `mjs_ssr_style_partagee-<nom>-<empreinte>.css`. */
export const FEUILLE_PARTAGEE_RE = /^mjs_ssr_style_partagee-[\w-]+-[0-9a-f]{8}\.css$/

// noms écrits PAR CE PROCESSUS, par dossier : ce que le rendu de ce build utilise
const ecrites = new Map<string, Set<string>>()

const nomRegistre = '.mjs-outputs.json'

function lireRegistre(dossier: string): any | null {
  try {
    const brut = JSON.parse(readFileSync(join(dossier, nomRegistre), 'utf-8'))
    return brut && Array.isArray(brut.extensions) ? brut : null
  } catch {
    return null
  }
}

/** Noms consignés au registre sous `ssrStyles` (liste vide si registre absent ou illisible). */
export function feuillesConsignees(dossier: string): string[] {
  const reg = lireRegistre(dossier)
  return reg && Array.isArray(reg.ssrStyles) ? reg.ssrStyles.filter((n: unknown): n is string => typeof n === 'string' && FEUILLE_PARTAGEE_RE.test(n)) : []
}

// ajoute le nom au registre, seulement s'il existe déjà (un build l'a écrit) : un registre fabriqué ici
// sans les extensions du build ferait sauter la purge (« registre vide »)
function consigner(dossier: string, nom: string): void {
  const reg = lireRegistre(dossier)
  if (!reg) return
  const noms = new Set<string>(feuillesConsignees(dossier))
  if (noms.has(nom)) return
  noms.add(nom)
  reg.ssrStyles = [...noms].sort()
  const chemin = join(dossier, nomRegistre)
  const tmp    = `${chemin}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`
  writeFileSync(tmp, JSON.stringify(reg, null, 2) + '\n', 'utf-8')
  try { renameSync(tmp, chemin) } catch (e) { try { unlinkSync(tmp) } catch {} ; throw e }
}

/** Écrit une feuille du rendu (nom par empreinte de contenu), la note comme écrite par ce rendu, rend son URL. */
export function ecrireFeuilleRendu(dossier: string, urlPrefix: string, tag: string, css: string): string {
  const url = writeHashedAsset(dossier, urlPrefix, 'mjs_ssr_style_' + tag, '.css', css)
  const nom = basename(url)
  if (FEUILLE_PARTAGEE_RE.test(nom)) {
    const cle = resolve(dossier)
    const vus = ecrites.get(cle) ?? ecrites.set(cle, new Set()).get(cle)!
    if (!vus.has(nom)) {
      vus.add(nom)
      consigner(dossier, nom)
    }
  }
  return url
}

/** Feuilles consignées par un build précédent que ce processus n'a pas (ré)écrites : plus utilisées, la purge les retire. */
export function feuillesRenduPerimees(dossier: string): string[] {
  const vus = ecrites.get(resolve(dossier)) ?? new Set<string>()
  return feuillesConsignees(dossier).filter(n => !vus.has(n))
}

/** Feuilles (texte -> nombre de racines qui la portent) à sortir en fichier lié plutôt qu'en ligne. */
export function feuillesALier(occurrences: Map<string, number>): Set<string> {
  const liees = new Set<string>()
  for (const [css, n] of occurrences) if ((n - 1) * Buffer.byteLength(css, 'utf-8') > SEUIL_SURCOUT_FEUILLE) liees.add(css)
  return liees
}

/**
 * Plan d'un rendu : la sérialisation écrit un repère à la place de chaque feuille partagée, `finir`
 * décide en connaissant le nombre de racines (feuille par feuille, règle ci-dessus) et remplace les
 * repères par un `<style>` en ligne ou un `<link>`. `ref` : le HTML qui sert à compter (le fragment
 * entier), quand on finit une partie de lui.
 */
export function creerPlanFeuilles(enLigne: (css: string) => string, lien: (css: string, tag: string) => string) {
  const ids      = new Map<string, number>()
  const feuilles: { css: string; tag: string }[] = []
  const repere   = /\u0000mjsf(\d+)\u0000/g
  return {
    marquer(css: string, tag: string): string {
      let id = ids.get(css)
      if (id === undefined) {
        id = feuilles.length
        ids.set(css, id)
        feuilles.push({ css, tag })
      }
      return `\u0000mjsf${id}\u0000`
    },
    finir(html: string, ref: string = html): string {
      const compte = new Map<string, number>()
      for (const m of ref.matchAll(repere)) {
        const css = feuilles[+m[1]].css
        compte.set(css, (compte.get(css) ?? 0) + 1)
      }
      const liees = feuillesALier(compte)
      return html.replace(repere, (_m, id) => {
        const f = feuilles[+id]
        return liees.has(f.css) ? lien(f.css, f.tag) : enLigne(f.css)
      })
    },
  }
}

// `@import` d'une feuille partagée : le navigateur adopte ces feuilles par `replaceSync`, qui IGNORE
// les `@import` (aucune requête). Le texte prérendu les retire donc aussi : sinon le `<style>` du
// HTML en ferait une requête (relative à la page, en 404) que la page démarrée n'a jamais faite, et
// la mise en page prérendue ne serait pas celle d'après le démarrage.
export function sansImport(css: string): string {
  return css.replace(/@import\s+(?:url\([^)]*\)|"[^"]*"|'[^']*')[^;{}]*;/gi, '')
}
