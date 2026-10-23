// La page /state pose ses libellés traduits dans son propre JavaScript : ils y étaient écrits entre apostrophes,
// si bien qu'une traduction contenant une apostrophe (« d'origine ») cassait tout le script de la page. Désormais
// chaque libellé y entre en littéral JSON. Le test donne une apostrophe, un guillemet, une barre oblique inverse
// et un </script> à deux libellés, puis exécute le script de la page dans un bac à sable.
import assert from 'node:assert/strict'
import { Script, createContext } from 'node:vm'
import { renderStatsPage } from '../src/mjs-ws/stats-page.js'
import { fr } from '../src/messages/fr.js'
import { setMessagesLang, getMessagesLang } from '../src/messages/index.js'

const TITRE = 'Connexions d\'origine "réelles" \\ </script>'
const SUB   = 'Processus d\'origine '

function scriptDeLaPage(html: string): string {
  const debut = html.indexOf('<script>')
  const fin   = html.lastIndexOf('</script>')
  assert.ok(debut >= 0 && fin > debut, 'script de la page introuvable')
  return html.slice(debut + '<script>'.length, fin)
}

describe('MJS-WS — page /state : libellés traduits avec apostrophe', () => {
  it('le script reste valide et affiche les libellés tels quels', () => {
    const catalogue = fr as Record<string, unknown>
    const avant     = { titre: catalogue['ws.stats.titre-connexions'], sub: catalogue['ws.stats.sub-process'], lang: getMessagesLang() }
    catalogue['ws.stats.titre-connexions'] = TITRE
    catalogue['ws.stats.sub-process']      = SUB
    setMessagesLang('fr')
    try {
      const html = renderStatsPage({ processId: 'p-test', uptime: 3, horodatage: Date.now(), connexions: { actives: 2 }, latences: {}, memoire: { rss: 0 } } as any)
      const code = scriptDeLaPage(html)
      assert.equal(code.indexOf('</script>'), -1, 'un </script> du libellé fermerait la balise')
      const script = new Script(code)
      const elements: Record<string, { innerHTML: string; textContent: string }> = {}
      const document = { getElementById: (id: string) => (elements[id] ??= { innerHTML: '', textContent: '' }) }
      script.runInContext(createContext({ document, setInterval: () => 0, fetch: () => new Promise(() => {}), Date, Math, String }))
      assert.ok(elements.grid.innerHTML.includes('<h2>'+ TITRE +'</h2>'), elements.grid.innerHTML.slice(0, 200))
      assert.ok(elements.sub.textContent.startsWith(SUB +'p-test'), elements.sub.textContent)
    } finally {
      catalogue['ws.stats.titre-connexions'] = avant.titre
      catalogue['ws.stats.sub-process']      = avant.sub
      setMessagesLang(avant.lang)
    }
  })
})
