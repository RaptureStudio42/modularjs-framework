// Barre d'outils de l'éditeur riche du cœur (<@@toolbar>, et celle que <@@editor toolbar="…"> intègre) : les NOMS des outils, joués dans happy-dom.
// - les noms sont ceux du code, en anglais seulement : h2 h3 quote bold italic underline strike color ul ol check link undo redo clear ; `|` pose un séparateur ;
// - sans liste, tous les outils dans l'ordre par défaut ; un nom en double ne compte qu'une fois, un séparateur de bord ou en double tombe ;
// - un nom inconnu (un mot français comme « gras », une faute de frappe) est IGNORÉ, avec un avertissement par nom dans la console, qui rappelle les noms connus ;
// - la barre d'un éditeur suit le même chemin que la barre posée à part ; `toolbar="none"` n'en met aucune.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { attendre, monter } from './helpers/editeur-riche.js'
import { assertAbsent } from './helpers/dom-assert.js'

const HOTE = `<@@toolbar class="t1" tools="bold italic ul check link"></@@toolbar>
<@@toolbar class="t2" tools="gras italique"></@@toolbar>
<@@toolbar class="t3" tools="| bold | | italic | undo |"></@@toolbar>
<@@toolbar class="t4"></@@toolbar>
<@@toolbar class="t5" tools="bold gras h2 titres bold"></@@toolbar>
<@@editor class="e1" toolbar="bold italic ul check link"></@@editor>
<@@editor class="e2" toolbar="gras ul"></@@editor>
<@@editor class="e3" toolbar="none"></@@editor>
<@@editor class="e4"></@@editor>
`

const DEFAUT = 'h2 h3 quote | bold italic underline strike | ul ol check | link | undo redo | clear'

describe('éditeur riche : les noms des outils de la barre (happy-dom)', function () {
  this.timeout(120000)
  let hote: any
  let avertissements: string[] = []

  // les outils d'une barre, dans l'ordre : le nom de chaque bouton, `|` pour un séparateur
  const outils = (barre: any): string => Array.from(barre._shadow.querySelectorAll('button, [role=separator]')).map((n: any) => n.localName == 'button' ? n.getAttribute('data-tool') : '|').join(' ')
  const barre  = (c: string) => hote._shadow.querySelector('.' + c)
  const dans   = (c: string) => barre(c)._shadow.querySelector('mjs-core-toolbar')

  before(async () => {
    ;({ hote, avertissements } = await monter(HOTE, 'editeur-barre'))
    await attendre(() => !!hote._shadow.querySelector('.e4')?._shadow?.querySelector('mjs-core-toolbar')?._shadow?.querySelector('button'), 10000)
  })

  after(async () => { await terminateSharedWorkerPool() })

  it('les noms anglais donnent les boutons demandés, dans l\'ordre demandé', function () {
    assert.equal(outils(barre('t1')), 'bold italic ul check link')
  })

  it('sans liste, tous les outils dans l\'ordre par défaut', function () {
    assert.equal(outils(barre('t4')), DEFAUT)
    assert.equal(outils(dans('e4')), DEFAUT)
  })

  it('les séparateurs de bord et en double tombent', function () {
    assert.equal(outils(barre('t3')), 'bold | italic | undo')
  })

  it('un nom en double ne compte qu\'une fois, un nom inconnu est ignoré', function () {
    assert.equal(outils(barre('t5')), 'bold h2')
  })

  it('les mots français ne sont pas des noms : une barre qui n\'en a que de tels n\'a aucun bouton', function () {
    assert.equal(outils(barre('t2')), '')
  })

  it('la barre intégrée à un éditeur suit la même règle', function () {
    assert.equal(outils(dans('e1')), 'bold italic ul check link')
    assert.equal(outils(dans('e2')), 'ul')
  })

  it('toolbar="none" ne met aucune barre dans l\'éditeur', function () {
    assertAbsent(dans('e3'), 'toolbar="none" : aucune barre dans l\'éditeur')
  })

  it('chaque nom inconnu est signalé une fois, avec la liste des noms connus ; les noms connus ne disent rien', function () {
    for (const mot of ['gras', 'italique', 'titres']) {
      const dits = avertissements.filter((a) => a.includes('« ' + mot + ' »'))
      assert.equal(dits.length, 1, `« ${mot} » signalé une fois : ${JSON.stringify(avertissements)}`)
      assert.ok(dits[0].includes('h2 h3 quote bold italic underline strike color ul ol check link undo redo clear'), 'la liste des noms connus est rappelée')
    }
    assert.equal(avertissements.length, 3, JSON.stringify(avertissements))
  })
})
