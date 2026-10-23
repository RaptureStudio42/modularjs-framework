// SSR — la version de happy-dom exigée au rendu serveur. Avant 20.11.2, happy-dom tient le rappel d'un
// MutationObserver par une référence faible : un ramasse-miettes l'éteint en silence (un composant ne voit
// plus ses attributs changer, un rendu varie d'un passage à l'autre). `createSSRRenderer` (renderToString.ts)
// refuse donc une version plus ancienne, plutôt que de laisser ces échecs au hasard.
//
// La version lue est celle que `import('happy-dom')` charge chez l'appli : le `package.json` de happy-dom, résolu
// depuis ce fichier comme l'import lui-même, par `require` (Node en garde l'objet en mémoire : un essai peut y
// poser une autre version le temps d'un appel, sans autre point d'entrée).

import { createRequire } from 'node:module'

/** Plus petite version de happy-dom acceptée au rendu serveur (la dépendance pair de package.json dit la même chose). */
export const HAPPY_DOM_MINIMUM = '20.11.2'

// majeur, mineur et correctif d'une version ; un suffixe de préversion (`-beta.1`) est ignoré
function numbersOf(version: string): number[] | null {
  const m = /^\s*v?(\d+)\.(\d+)\.(\d+)/.exec(version)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/**
 * La version de happy-dom installée chez l'appli quand elle est plus ancienne que `HAPPY_DOM_MINIMUM`, sinon `null`.
 * Comparée par nombres, composante après composante (`20.9.0` vient avant `20.11.2`, `100.0.0` après). Une version
 * qui ne se lit pas n'est jamais refusée : on ne ferme pas la porte sur une supposition.
 */
export function outdatedHappyDomVersion(): string | null {
  let version: unknown
  try { version = createRequire(import.meta.url)('happy-dom/package.json').version } catch { return null }
  if (typeof version !== 'string') return null
  const found    = numbersOf(version)
  const required = numbersOf(HAPPY_DOM_MINIMUM)!
  if (!found) return null
  for (let i = 0; i < 3; i++) {
    if (found[i] !== required[i]) return found[i] < required[i] ? version : null
  }
  return null
}
