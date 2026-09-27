// history.ts::pousser() — l'objet `positions` doit être copié INDÉPENDAMMENT à l'écriture ; muter
// l'objet source APRÈS l'avoir poussé dans le tampon ne doit jamais réécrire le passé au rewind.
import assert from 'node:assert/strict'
import { createHistory } from '../src/mjs-server/history.js'

describe('historique (compensation de lag) — copie indépendante à l’écriture', () => {
  it('muter l’objet positions après pousser() ne change pas ce qui a été enregistré', () => {
    const histo = createHistory(5)
    const partage = { p1: { x: 1, y: 0 } }
    histo.pousser(1, 1000, partage as any)
    partage.p1.x = 99   // mutation APRÈS le pousser(), sur le MÊME objet passé en argument
    const x = histo.rewind(1000, (positions: any) => positions.p1.x)
    assert.equal(x, 1, 'le rewind doit rendre 1 (valeur au moment du pousser()), pas 99 (muté après coup)')
  })

  it('deux pousser() successifs sur le MÊME objet réutilisé par l’appelant restent indépendants l’un de l’autre', () => {
    const histo = createHistory(5)
    const reutilise = { e1: { x: 0, y: 0 } }
    histo.pousser(1, 1000, reutilise as any)
    reutilise.e1.x = 5
    histo.pousser(2, 2000, reutilise as any)
    reutilise.e1.x = 10   // mutation APRÈS le 2e pousser()

    const auTick1 = histo.rewind(1000, (positions: any) => positions.e1.x)
    const auTick2 = histo.rewind(2000, (positions: any) => positions.e1.x)
    assert.equal(auTick1, 0, 'le 1er instantané garde x=0, jamais affecté par les pousser() suivants')
    assert.equal(auTick2, 5, 'le 2e instantané garde x=5 (valeur au moment de CE pousser()), pas 10')
  })
})
