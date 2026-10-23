// Journal d'erreurs plein : chaque `record()` resérialisait TOUT le journal (≈ 1 Mio) pour tenir
// le plafond en octets — 6 ms de boucle bloquée par erreur, déclenchable à volonté par une action
// qui jette. La taille de chaque entrée est désormais retenue : un `record()` ne sérialise que
// l'entrée qui change.

import assert from 'node:assert/strict'
import { mjsTmp } from './helpers/tmp.js'
import { createJournal } from '../src/server/journal.js'

describe('journal — record() à coût constant, journal plein', () => {
  it('journal plein (1 Mio) : record() moyen sous 1 ms, plafond en octets tenu', () => {
    const maxBytes = 1_048_576
    const j = createJournal({ dir: mjsTmp('journal-cout'), maxEntries: 100000, maxBytes })
    try {
      const gros = 'x'.repeat(1900)
      for (let i = 0; i < 700; i++) j.record('server', { message: `erreur ${i} ${gros}`, pile: 'at f', url: '/p' })
      const n = 200
      const t0 = performance.now()
      for (let i = 0; i < n; i++) j.record('server', { message: `nouvelle ${i} ${gros}`, pile: 'at g', url: '/q' })
      const moyen = (performance.now() - t0) / n
      const taille = j.list().reduce((s, e) => s + Buffer.byteLength(JSON.stringify(e), 'utf-8') + 1, 0)
      assert.ok(taille <= maxBytes, `plafond dépassé : ${taille}`)
      assert.ok(taille > maxBytes - 5000, `journal pas plein : ${taille}`)
      assert.ok(moyen < 1, `record() trop lent : ${moyen.toFixed(2)} ms`)
    } finally {
      j.close()
    }
  })
})
