// page /state du pont : les libellés traduits posés dans le JavaScript de la page sont des littéraux JSON, mais ceux du
// HTML (titre de l'onglet, h1, pied de page) partaient tels quels. Une traduction qui contient `<` ou `&` y glissait du
// HTML. Ils sont maintenant échappés comme du texte
import assert from 'node:assert/strict'
import { fr } from '../src/messages/fr.js'
import { renderStatsPage } from '../src/mjs-ws/stats-page.js'

describe('MJS-WS — page /state : libellés du HTML échappés', () => {
  it('titre, h1 et pied de page : `<`, `>`, `&` et guillemets rendus en texte', () => {
    const catalogue = fr as Record<string, unknown>
    const titre     = catalogue['ws.stats.titre-page']
    const pied      = catalogue['ws.stats.pied-de-page']
    try {
      catalogue['ws.stats.titre-page']   = 'État <b>gras</b> & "co"'
      catalogue['ws.stats.pied-de-page'] = 'Mis à jour <img src=x onerror=alert(1)>'
      const html = renderStatsPage({} as any)
      assert.ok(!html.includes('<b>gras</b>'), 'aucune balise venue du titre')
      assert.ok(!html.includes('<img'), 'aucune balise venue du pied de page')
      assert.ok(html.includes('<title>État &lt;b&gt;gras&lt;/b&gt; &amp; &quot;co&quot;</title>'), 'titre de l’onglet')
      assert.ok(html.includes('<h1>État &lt;b&gt;gras&lt;/b&gt; &amp; &quot;co&quot;</h1>'), 'h1')
      assert.ok(html.includes('<footer>Mis à jour &lt;img src=x onerror=alert(1)&gt; <span id="ts"></span></footer>'), 'pied de page')
    }
    finally {
      catalogue['ws.stats.titre-page']   = titre
      catalogue['ws.stats.pied-de-page'] = pied
    }
  })
})
