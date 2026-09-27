// Régression — un tag raw-text (<textarea>/<style>/<script>/<title>) dont le
// contenu brut contient le NOM de la balise fermante en PRÉFIXE d'un mot plus
// long (ex. le texte auteur « fermez avec </textareaBoom> ») fermait le tag
// trop tôt : la recherche de `</tag` se faisait par simple `indexOf`, sans
// vérifier ce qui suit le nom. Le fragment `</textareaBoom>` était alors
// injecté tel quel dans la sortie comme si c'était la vraie balise fermante,
// et le reste du flux (` proprement.</textarea>`) repartait en HTML normal
// avec une fermeture `</textarea>` sans ouverture correspondante — le build
// échouait plus loin avec un message indirect, jamais sur la cause réelle.
//
// Fix : `findCloseRawText` (paths.ts) exige désormais un délimiteur après le
// nom de balise (fin de chaîne, espace, `>` ou `/`) avant d'accepter un match.

import assert from 'node:assert/strict'
import { extractPaths, generateCreateFnBody } from '../src/generator/paths.js'

describe('paths.ts — fermeture de tag raw-text confondue avec un préfixe', () => {

  describe('extractPaths', () => {
    it('</textareaBoom> dans le texte brut ne ferme pas <textarea> en avance', () => {
      const html = '<div><textarea>avant </textareaBoom> apres</textarea></div>'
      const result = extractPaths(html)
      assert.equal(result.cleanHtml, html, 'la vraie fermeture </textarea> doit être trouvée, pas le préfixe </textareaBoom>')
    })

    it('</scriptRuntime> dans un <script> ne ferme pas le tag en avance', () => {
      const html = '<div><script>var x = "</scriptRuntime>";</script></div>'
      const result = extractPaths(html)
      assert.equal(result.cleanHtml, html)
    })

    it('cas nominal (fermeture exacte, sans suffixe) : inchangé', () => {
      const html = '<div><textarea>x</textarea></div>'
      const result = extractPaths(html)
      assert.equal(result.cleanHtml, html)
    })

    it('</textarea suivi de "/" (auto-fermeture atypique) reste un délimiteur valide', () => {
      const html = '<div><textarea>x</textarea/></div>'
      const result = extractPaths(html)
      assert.ok(result.cleanHtml.startsWith('<div><textarea>x</textarea'), 'la fermeture doit être reconnue dès "</textarea/"')
    })
  })

  describe('generateCreateFnBody (mode impératif, interpolation pour forcer ce chemin)', () => {
    it('</textareaBoom> dans le texte brut ne ferme pas <textarea> en avance', () => {
      // hasInterpolations() doit être vrai pour router vers le mode impératif
      // (2e site du bug, generateCreateFnBodyImperative).
      const html = '<div>${x}<textarea>avant </textareaBoom> apres</textarea></div>'
      const result = generateCreateFnBody(html)
      assert.match(result.body, /createElement\("textarea"\)/)
      // le texte brut complet (préfixe inclus) doit être injecté comme UN
      // SEUL nœud texte, jamais coupé au milieu de </textareaBoom>.
      assert.match(result.body, /avant <\/textareaBoom> apres/)
    })

    it('cas nominal (fermeture exacte) : toujours correct après le fix', () => {
      const html = '<div>${x}<textarea>y</textarea></div>'
      const result = generateCreateFnBody(html)
      assert.match(result.body, /createElement\("textarea"\)/)
    })
  })
})
