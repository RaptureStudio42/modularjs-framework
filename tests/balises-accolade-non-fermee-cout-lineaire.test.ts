// un gabarit dont beaucoup de balises ont une accolade d'attribut jamais refermée (fichier en cours de frappe,
// tout sur une ligne) : chaque balise relisait tout le reste du texte, la recompilation gelait plusieurs
// secondes. Une accolade reconnue sans fin ne se relit plus. Même garde pour le contenu de <@head> et le repli
// de <@failed>, où une accolade seule reste du texte : chacune relisait tout le reste du bloc (des secondes pour quelques milliers)

import assert from 'node:assert/strict'
import { scanEffectImages } from '../src/transpiler/effect-images.js'
import { processGlobalMacros } from '../src/transpiler/macros.js'
import { findMacroTagEnd } from '../src/transpiler/macro-tag.js'
import { transpile } from '../src/transpiler/index.js'

function meilleur(fn: () => void): number {
  let best = Infinity
  for (let r = 0; r < 3; r++) {
    const t0 = performance.now()
    fn()
    best = Math.min(best, performance.now() - t0)
  }
  return best
}

describe('accolade d\'attribut jamais refermée : coût linéaire', function () {
  this.timeout(120000)

  it('images des effets : 64 Ko de balises mal fermées coûtent du même ordre que bien fermées', () => {
    const mal  = '<a x={y '.repeat(8000)
    const bien = '<a x={y}>'.repeat(8000)
    const tMal  = meilleur(() => scanEffectImages(mal))
    const tBien = meilleur(() => scanEffectImages(bien))
    assert.ok(tMal < 4 * tBien + 50, `mal fermées : ${Math.round(tMal)} ms, bien fermées : ${Math.round(tBien)} ms`)
  })

  it('balises du langage : 4 000 <@window @x={ sur une ligne coûtent du même ordre que des balises inconnues', () => {
    const avant = console.error
    console.error = () => {}
    try {
      const mal    = '<@window @x={'.repeat(4000)
      const temoin = '<@windox @x={'.repeat(4000)
      const tMal    = meilleur(() => processGlobalMacros(mal))
      const tTemoin = meilleur(() => processGlobalMacros(temoin))
      assert.ok(tMal < 4 * tTemoin + 50, `<@window : ${Math.round(tMal)} ms, témoin : ${Math.round(tTemoin)} ms`)
      assert.ok(processGlobalMacros(mal).errors.length > 0)
    }
    finally {
      console.error = avant
    }
  })

  it('le `>` réel est toujours trouvé, sur le même texte, après une accolade sans fin', () => {
    const html = '<a x={y <b c={d}>'
    assert.equal(findMacroTagEnd(html, 2), -1)
    assert.equal(findMacroTagEnd(html, 10), html.length - 1)
    assert.equal(findMacroTagEnd('<a x={y\n<b c={d}>', 2), -1)
    assert.equal(findMacroTagEnd('<a x={"}"}>', 2), 10)
  })
})

// le coût d'une entrée huit fois plus grande, rapporté à celui de l'entrée de base (meilleure de trois passes chacune, après une chauffe) : une
// lecture linéaire coûte environ huit fois plus, une lecture quadratique soixante-quatre fois. La garde (vingt fois, plus 50 ms) tient sous
// charge : les deux mesures s'y allongent ensemble
function croissance(fn: (n: number) => void, n: number): { tenue: boolean, message: string } {
  fn(n)
  const petit = meilleur(() => fn(n))
  const borne = 20 * petit + 50
  let grand   = Infinity
  for (let r = 0; r < 3 && !(grand < borne); r++) {
    const t0 = performance.now()
    fn(8 * n)
    grand = Math.min(grand, performance.now() - t0)
  }
  return { tenue: grand < borne, message: `${n} : ${Math.round(petit)} ms, ${8 * n} : ${Math.round(grand)} ms` }
}

describe('<@head> et <@failed> : accolades jamais refermées, coût linéaire', function () {
  this.timeout(120000)

  // une `)` sans sa `(` après les accolades, même dans une autre balise, et les autres lectures qui vont jusqu'à la fin du bloc : commentaire
  // jamais refermé, commentaire `#` jusqu'à la fin de la ligne, accolades imbriquées suivies d'une accolade seule
  const BLOCS: Array<[string, (milieu: string) => string]> = [
    ['titre de <@head>', (milieu) => `<@head><title>${milieu}{$x}</title></@head>`],
    ['commentaire de <@head>', (milieu) => `<@head><!-- ${milieu} --><title>{$x}</title></@head>`],
    ['repli de <@failed>', (milieu) => `<@failed err reset><p>${milieu}{err.message}</p></@failed>`],
    ['titre de <@head>, une `)` après', (milieu) => `<@head><title>${milieu}){$x}</title></@head>`],
    ['commentaire de <@head>, une `)` après', (milieu) => `<@head><!-- ${milieu}) --><title>{$x}</title></@head>`],
    ['repli de <@failed>, une `)` après', (milieu) => `<@failed err reset><p>${milieu}){err.message}</p></@failed>`],
    ['titre de <@head>, « :) » dans une autre balise', (milieu) => `<@head><title>${milieu}</title><meta name="d" content="Bonjour :)"></@head>`],
  ]

  for (const [nom, bloc] of BLOCS) {
    it(`${nom} : des milliers d'accolades seules coûtent en proportion du texte, et restent du texte`, () => {
      const { tenue, message } = croissance((n) => processGlobalMacros(bloc('a { '.repeat(n))), 1000)
      assert.ok(tenue, message)
      const r = processGlobalMacros(bloc('a { '.repeat(4000)))
      assert.deepEqual(r.errors, [])
      assert.ok(r.setup.includes('a { a { a { '), r.setup.slice(0, 200))
    })
  }

  const SEULES: Array<[string, (n: number) => string]> = [
    ['commentaire `/*` jamais refermé', (n) => '{ /* '.repeat(n)],
    ['commentaire `#` jusqu\'à la fin de la ligne', (n) => '{ # '.repeat(n)],
    ['accolades imbriquées, puis une accolade seule', (n) => '{'.repeat(n) + '}'.repeat(n) + ' { '],
    ['chaînes aux guillemets échappés', (n) => '{ \' ' + '{ \\\' '.repeat(n)],
    ['accolades comptées dans des commentaires `#`, puis autant de `}`', (n) => '{ # '.repeat(n) + '\n' + '}'.repeat(n)],
  ]
  for (const [nom, milieu] of SEULES) {
    it(`titre de <@head>, ${nom} : coût en proportion du texte`, () => {
      const { tenue, message } = croissance((n) => processGlobalMacros(`<@head><title>${milieu(n)}){$x}</title></@head>`), 1000)
      assert.ok(tenue, message)
    })
  }
})

describe('gabarit d\'un composant : accolades jamais refermées, coût linéaire', function () {
  this.timeout(120000)

  // la construction refuse le gabarit (accolade jamais refermée) ; elle le dit vite, quel que soit le texte qui suit les accolades
  const refus = async (milieu: string) => {
    try {
      await transpile(`<script>\n  $x = 1\n</script>\n<p>${milieu}{$x}</p>\n`, { moduleName: 'mjs-cout' })
    }
    catch {
      // attendu : accolade jamais refermée
    }
  }
  const CAS: Array<[string, (n: number) => string]> = [
    ['accolades seules', (n) => 'a { '.repeat(n)],
    ['accolades seules, une `)` après', (n) => 'a { '.repeat(n) + ')'],
    ['commentaire `#` jusqu\'à la fin de la ligne', (n) => '{ # '.repeat(n)],
  ]
  for (const [nom, milieu] of CAS) {
    it(`${nom} : coût en proportion du texte`, async () => {
      await refus(milieu(1000))
      const mesure = async (n: number) => {
        let best = Infinity
        for (let r = 0; r < 3; r++) {
          const t0 = performance.now()
          await refus(milieu(n))
          best = Math.min(best, performance.now() - t0)
        }
        return best
      }
      const petit = await mesure(1000)
      const borne = 20 * petit + 50
      let grand   = Infinity
      for (let r = 0; r < 3 && !(grand < borne); r++) {
        const t0 = performance.now()
        await refus(milieu(8000))
        grand = Math.min(grand, performance.now() - t0)
      }
      assert.ok(grand < borne, `1000 : ${Math.round(petit)} ms, 8000 : ${Math.round(grand)} ms`)
    })
  }
})
