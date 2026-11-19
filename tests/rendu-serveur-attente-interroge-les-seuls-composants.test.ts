// Rendu serveur : l'attente de la fin du rendu relit les blocs {await} de tout l'arbre toutes les 5 ms. Seul un composant (élément
// personnalisé, un tiret dans son nom) en porte : un élément ordinaire n'est pas interrogé (sur une page à 2 000 éléments, 8 appels par
// rendu au lieu de 6 014), et le bloc d'un composant niché sous des éléments ordinaires est toujours relevé

import assert from 'node:assert/strict'
import { collectAwaitStates, hasPendingAwait } from '../src/server/renderToString.js'

function arbre() {
  const interroges: string[] = []
  const doc = { defaultView: { __mjsCore: { _ssrInfo: (el: any) => { interroges.push(el.localName); return { awaitStates: el.etats } } } } }
  const el  = (localName: string, children: any[] = [], extra: Record<string, unknown> = {}) => ({ localName, ownerDocument: doc, children, ...extra })
  const carte = el('mjs-carte', [], { etats: new Map([['a', { status: 'pending' }]]) })
  const page  = el('mjs-page', [], { _shadow: { children: [el('ul', [el('li', [el('b')]), el('li', [carte])]), el('p')] } })
  return { page, carte, interroges }
}

describe('rendu serveur : l\'attente des blocs {await} n\'interroge que les composants', () => {
  it('les éléments ordinaires ne sont pas interrogés', () => {
    const { page, interroges } = arbre()
    collectAwaitStates(page)
    assert.deepEqual(interroges, ['mjs-page', 'mjs-carte'])
  })

  it('le bloc d\'un composant niché sous des éléments ordinaires est relevé, et retient le rendu', () => {
    const { page, carte } = arbre()
    assert.deepEqual(collectAwaitStates(page), [carte.etats])
    assert.equal(hasPendingAwait(page), true)
    carte.etats.get('a')!.status = 'success'
    assert.equal(hasPendingAwait(page), false)
  })
})
