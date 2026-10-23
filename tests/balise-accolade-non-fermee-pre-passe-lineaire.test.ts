// pré-passe du gabarit (commentaires, valeurs d'attribut, interpolations) : à chaque accolade d'une balise, la fin de
// l'expression était cherchée de nouveau jusqu'au bout du texte. Sur un fichier en cours de frappe aux accolades non
// refermées, le coût devenait quadratique. Une accolade reconnue sans fin ne se relit plus

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

// temps processeur du meilleur de trois essais ; le <mjs-x> jamais refermé arrête la construction juste après la
// pré-passe
async function meilleur(src: string): Promise<number> {
  let best = Infinity
  for (let r = 0; r < 3; r++) {
    const c0 = process.cpuUsage()
    await assert.rejects(transpile(src, { moduleName: 'pre-passe' }), /déséquilibre structurel/)
    const u = process.cpuUsage(c0)
    best = Math.min(best, (u.user + u.system) / 1000)
  }
  return best
}

describe('balise à accolade non refermée : pré-passe linéaire', function () {
  this.timeout(120000)

  it('8 000 balises à accolade non refermée coûtent du même ordre que sans accolade', async () => {
    const mal    = '<mjs-x>' + '<a x={y '.repeat(8000)
    const temoin = '<mjs-x>' + '<a x=y '.repeat(8000)
    const tMal    = await meilleur(mal)
    const tTemoin = await meilleur(temoin)
    assert.ok(tMal < 10 * Math.max(tTemoin, 20), `accolades : ${Math.round(tMal)} ms, témoin : ${Math.round(tTemoin)} ms`)
  })

  it('témoin : après une accolade sans fin, la même balise est toujours lue jusqu\'à son `>`', async () => {
    await assert.rejects(transpile('<a @confirm="a" x={y @confirm="b">ok</a>', { moduleName: 'pre-passe-suite' }), /@confirm/)
  })
})
