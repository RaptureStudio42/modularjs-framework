// Régression — `µ._mjs_destroyEvictedTree` (page hibernée évincée du cache
// LRU du routeur/UJS) relance les teardowns différés par l'hibernation. Le
// parcours était un DFS RÉCURSIF borné à une profondeur de 50 (garde-fou anti-
// boucle) : un composant imbriqué AU-DELÀ de cette profondeur ne voyait
// jamais `_mjs_runDestroyCallbacks()` — ses ressources (timers, abonnements)
// fuyaient à vie.
//
// Fix : parcours ITÉRATIF (pile explicite), sans limite de profondeur — rien
// dans cet arbre (children/shadow) ne peut boucler, la pile n'a donc pas
// besoin du même garde-fou que la récursion.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'

const __dirname = dirname(fileURLToPath(import.meta.url))

function loadPageCache(win: any) {
  const initSrc = readFileSync(join(__dirname, '../src/runtime/mjs_init.ts'), 'utf-8')
    .replace(/export\s*\{[^}]*\}/, '')
  const pageCacheSrc = readFileSync(join(__dirname, '../src/runtime/mjs_page_cache.ts'), 'utf-8')
  const sandbox = `
    ${initSrc}
    ${pageCacheSrc}
    return µ;
  `
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function('window', 'document', 'customElements', 'HTMLElement', 'CSSStyleSheet', sandbox)(
    win, win.document, win.customElements, win.HTMLElement, win.CSSStyleSheet,
  )
}

// Construit une chaîne d'éléments <div> imbriqués sur `depth` niveaux
// (chacun enfant unique du précédent) et pose `_mjs_runDestroyCallbacks` sur
// le PLUS PROFOND.
function buildChain(win: any, depth: number) {
  const root = win.document.createElement('div')
  let cursor = root
  let destroyed = 0
  for (let i = 0; i < depth; i++) {
    const child = win.document.createElement('div')
    cursor.appendChild(child)
    cursor = child
  }
  cursor._mjs_runDestroyCallbacks = () => { destroyed++ }
  return { root, getDestroyed: () => destroyed }
}

describe('µ._mjs_destroyEvictedTree — profondeur illimitée (pile explicite)', function () {
  it('composant imbriqué à 51 niveaux : son teardown est bien appelé (AVANT le fix : coupé à la profondeur 50)', () => {
    const win: any = new Window({ url: 'http://localhost/' })
    const µ: any = loadPageCache(win)
    const { root, getDestroyed } = buildChain(win, 51)

    µ._mjs_destroyEvictedTree(root)

    assert.equal(getDestroyed(), 1, 'AVANT le fix : le DFS récursif s\'arrêtait à la profondeur 50, ce nœud à 51 n\'était jamais atteint')
    win.close?.()
  })

  it('composant imbriqué à 500 niveaux : toujours atteint (aucune limite de profondeur)', () => {
    const win: any = new Window({ url: 'http://localhost/' })
    const µ: any = loadPageCache(win)
    const { root, getDestroyed } = buildChain(win, 500)

    µ._mjs_destroyEvictedTree(root)

    assert.equal(getDestroyed(), 1, 'un parcours itératif ne doit connaître aucun plafond de profondeur')
    win.close?.()
  })

  it('témoin non-régression : un arbre peu profond (3 niveaux) continue de nettoyer normalement', () => {
    const win: any = new Window({ url: 'http://localhost/' })
    const µ: any = loadPageCache(win)
    const { root, getDestroyed } = buildChain(win, 3)

    µ._mjs_destroyEvictedTree(root)

    assert.equal(getDestroyed(), 1)
    win.close?.()
  })
})
