// l'aide des essais en vrai navigateur (tests/helpers/sortable-navigateur.ts) met en développement les fichiers construits bout à bout dans
// un seul script : chaque composant (un module du cœur, la page) y garde sa portée, comme au vrai chargement où chaque fichier est un module.
// <@@select> sans `other` et la barre d'outils de <@@editor> déclarent chacun `told` au niveau du module : dans une seule portée, le script
// ne se lisait pas (SyntaxError : `told` déclaré deux fois), et la page ne démarrait pas

import assert from 'node:assert/strict'
import { Script } from 'node:vm'
import { construire, fermer } from './helpers/sortable-navigateur.js'

const PAGE = `<script>
  $v = 'a'
</script>
<@@select class="s" value=!{$v}>
  <@@option value="a">A</@@option>
  <@@option value="b">B</@@option>
</@@select>
<@@editor class="e" name="e" toolbar="bold italic" value="<p>Un</p>"></@@editor>
`

describe('aide des essais en navigateur : en développement, chaque fichier garde sa portée dans le script commun', function () {
  this.timeout(120000)
  after(fermer)

  it('<@@select> et <@@editor> (sa barre d\'outils) dans le même projet : le script se lit, chaque `told` dans sa portée', async () => {
    const { script } = await construire('portee-modules', { 'page.mjs': PAGE }, false)
    const told = script.match(/\b(?:let|const|class)\s+told\b/g) ?? []
    assert.ok(told.length >= 2, `le cas suppose deux déclarations de told au niveau du module (vues : ${told.length})`)
    assert.doesNotThrow(() => new Script(script), 'le script de développement se lit')
  })
})
