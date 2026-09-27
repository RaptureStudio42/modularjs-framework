// mjs-server/space — zone d'intérêt (AoI) OPTIONNELLE par partie (`def.space { cell }`, cf. game.ts),
// exposée en `partie.space` (game.ts, constructeur) : UTILITAIRE nu, AUCUNE magie imposée — c'est
// au jeu d'appeler .set()/.query() lui-même là où ça compte (typiquement dans `def.view` pour filtrer
// les entités visibles par joueur, ou dans `def.simulate` pour ne comparer les collisions qu'entre
// voisins).
//
// INDEXATION — grille de cellules CARRÉES de taille `cell` : Map<'cx:cy', Set<id>>, cellule = les
// coordonnées divisées par `cell` puis arrondies au sol (Math.floor). Chaque id occupe AU PLUS une
// cellule à la fois — .set(id, x, y) déplace (retire de l'ancienne cellule si besoin, no-op si la
// nouvelle position reste dans la MÊME cellule).
//
// REQUÊTE — .query(x, y, rayon) balaie le carré de cellules qui COUVRE le cercle de rayon `rayon`
// (grossier, ⌈rayon/cell⌉ cellules de chaque côté), PUIS filtre finement chaque id trouvé par
// distance de TCHEBYCHEV (max(|dx|, |dy|), la même mesure « en carré » que le balayage grossier —
// cohérent de bout en bout, pas un cercle euclidien) ≤ `rayon`. Coût = O(cellules couvertes), jamais
// O(entités totales).
//
// GARDE — `x`/`y`/`rayon` non finis (Infinity/NaN, ex. venus tels quels d'un client sans
// validation applicative) NE PROGRESSENT JAMAIS dans la boucle de balayage (`-Infinity + 1 ===
// -Infinity` en JS — boucle sans fin, process bloqué) : rejetés d'emblée, résultat VIDE +
// avertissement `onWarn` UNE SEULE fois par instance (jamais un throw — une requête mal formée
// reste une situation de jeu ordinaire à absorber, pas une panne). Un rayon FINI mais énorme
// (ex. 1e15) franchit cette garde mais balaierait quand même un carré astronomique de cellules :
// `range` est en plus PLAFONNÉ (SPACE_QUERY_MAX_RANGE) — résultat partiel plutôt qu'un blocage,
// silencieusement (risque distinct du cas non-fini ci-dessus : celui-ci progresse, juste borné).
//
// LIMITE CONNUE — `space` est un INDEX DÉRIVÉ, jamais sérialisé (µpersist ne le connaît pas) : une
// partie restaurée (restoreGameFromSnapshot, matchmaking.ts) repart avec un `partie.space` VIDE, même si
// `partie.state` contient déjà des positions. Au jeu de le repeupler lui-même (ex. au premier
// `simulate`/`view` qui suit une reprise) — aucune magie de repopulation automatique ici.

import { t } from '../messages/index.js'

// plafond défensif du nombre de cellules parcourues PAR CÔTÉ dans .query() (cf. « GARDE » en tête
// de fichier) — (2×256+1)² ≈ 263 000 cellules au pire, borné quel que soit le rayon FINI demandé ;
// choix arbitraire, largement au-dessus de tout usage de jeu réaliste (cell/rayon raisonnables)
const SPACE_QUERY_MAX_RANGE = 256

export interface MjsServerSpace {
  /** pose/déplace l'entité `id` — retire de son ancienne cellule si la nouvelle diffère */
  set(id: string, x: number, y: number): void
  /** retire l'entité — no-op si absente */
  remove(id: string): void
  /** ids dans le carré de cellules couvrant le rayon autour de (x, y), filtrés à `rayon` (Tchebychev)
   *  — coordonnées/rayon non finis ou rayon négatif : tableau VIDE (jamais un throw, jamais de
   *  boucle sans fin), cf. « GARDE » en tête de fichier */
  query(x: number, y: number, radius: number): string[]
  /** copie instantanée { id → {x, y} } de TOUTES les entités indexées, quelle que soit leur cellule
   *  — cf. mjs-server/history.ts (extracteur par défaut de def.histo QUAND def.space est déclaré, cf.
   *  game.ts) : objets frais à chaque appel, jamais les mêmes références que `positions` en interne */
  _snapshot(): Record<string, { x: number; y: number }>
  /** vidage complet — appelée à la destruction de la partie (cf. game.ts _destroy) */
  _clear(): void
}

/** construit un index spatial à cellules de taille `cell` (> 0) — cf. commentaire de tête.
 *  `onWarn` optionnel : canal d'avertissement pour une requête .query() invalide (cf. « GARDE »),
 *  émis AU PLUS UNE FOIS par instance — absent (défaut) = pas d'avertissement, le résultat reste
 *  quand même vide. */
export function createSpace(cell: number, onWarn?: (msg: string) => void): MjsServerSpace {
  if (typeof cell !== 'number' || !Number.isFinite(cell) || cell <= 0) {
    throw new Error(t('serveur.space-cell-invalide', { received: JSON.stringify(cell) }))
  }
  const cells  = new Map<string, Set<string>>()
  const positions = new Map<string, { x: number; y: number }>()
  let warnedInvalidQuery = false

  function keyOf(cx: number, cy: number): string { return cx +':'+ cy }
  function cellOf(x: number, y: number): [number, number] { return [Math.floor(x / cell), Math.floor(y / cell)] }

  function removeFromCell(id: string, pos: { x: number; y: number }): void {
    const [cx, cy] = cellOf(pos.x, pos.y)
    const key = keyOf(cx, cy)
    const s = cells.get(key)
    if (!s) return
    s.delete(id)
    if (s.size === 0) cells.delete(key)
  }

  return {
    set(id, x, y) {
      const previous = positions.get(id)
      if (previous) {
        const [acx, acy] = cellOf(previous.x, previous.y)
        const [ncx, ncy] = cellOf(x, y)
        if (acx === ncx && acy === ncy) { positions.set(id, { x, y }); return }   // même cellule — juste rafraîchir la position fine
        removeFromCell(id, previous)
      }
      const [cx, cy] = cellOf(x, y)
      const key = keyOf(cx, cy)
      let s = cells.get(key)
      if (!s) { s = new Set(); cells.set(key, s) }
      s.add(id)
      positions.set(id, { x, y })
    },

    remove(id) {
      const pos = positions.get(id)
      if (!pos) return
      removeFromCell(id, pos)
      positions.delete(id)
    },

    query(x, y, radius) {
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius) || radius < 0) {
        if (!warnedInvalidQuery) {
          warnedInvalidQuery = true
          onWarn?.(t('serveur.space-query-invalide', { x: JSON.stringify(x), y: JSON.stringify(y), radius: JSON.stringify(radius) }))
        }
        return []
      }
      const [ccx, ccy] = cellOf(x, y)
      const range = Math.min(Math.ceil(radius / cell), SPACE_QUERY_MAX_RANGE)
      const found: string[] = []
      for (let dcx = -range; dcx <= range; dcx++) {
        for (let dcy = -range; dcy <= range; dcy++) {
          const s = cells.get(keyOf(ccx + dcx, ccy + dcy))
          if (!s) continue
          for (const id of s) {
            const pos = positions.get(id)!
            if (Math.max(Math.abs(pos.x - x), Math.abs(pos.y - y)) <= radius) found.push(id)
          }
        }
      }
      return found
    },

    _snapshot() {
      const copy: Record<string, { x: number; y: number }> = {}
      for (const [id, pos] of positions) copy[id] = { x: pos.x, y: pos.y }
      return copy
    },

    _clear() { cells.clear(); positions.clear() },
  }
}
