// passes de masques du compilateur sur des gabarits ORDINAIRES (balises fermées, blocs <pre> / <code> et commentaires
// fermés, guillemet d'attribut non fermé) : pas plus lentes que les remplacements par regex qu'elles ont remplacés, lus sur
// le même texte ; rapports de temps, jamais une durée fixe : sûr sous charge

import assert from 'node:assert/strict'
import { maskDocBlocks } from '../src/transpiler/lint.js'

const N = 32000

// gabarits ordinaires : tout y est fermé, les remplacements par regex y lisent le texte une fois
const GABARITS: Record<string, string> = {
  'balises <p>':                   '<p class="a">texte {$n}</p>\n'.repeat(N),
  '<pre>, <code> et commentaires': '<pre>p</pre>\n<code>c</code>\n<!-- c -->\n<p>x</p>\n'.repeat(N / 4),
  'guillemet non fermé':           '<b title="x>\n' + '<i>a</i>\n'.repeat(N),
}

// passe témoin : les trois remplacements par regex des blocs de documentation, chacun d'une lecture native du texte
function passeRegex(s: string): string {
  const blocs = [] as string[]
  const garde = (m: string): string => `@${blocs.push(m) - 1}@`
  return s.replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, garde).replace(/<code\b[^>]*>[\s\S]*?<\/code>/gi, garde).replace(/<!--(?:-?>|[\s\S]*?--!?>)/g, garde)
}

// meilleure durée de `fois` appels, en millisecondes
function duree(f: () => unknown, fois = 7): number {
  let best = Infinity
  for (let k = 0; k < fois; k++) {
    const debut = performance.now()
    f()
    best = Math.min(best, performance.now() - debut)
  }
  return best
}

describe('masques du compilateur : un gabarit ordinaire se masque aussi vite que par les regex remplacées', function () {
  this.timeout(60000)

  for (const [nom, s] of Object.entries(GABARITS)) {
    it(`maskDocBlocks, ${nom} : au plus deux fois le temps des trois regex sur le même texte`, () => {
      for (let k = 0; k < 3; k++) {
        maskDocBlocks(s)
        passeRegex(s)
      }
      const r = duree(() => maskDocBlocks(s)) / duree(() => passeRegex(s))
      assert.ok(r < 2, `rapport ${r.toFixed(2)}`)
    })
  }
})
