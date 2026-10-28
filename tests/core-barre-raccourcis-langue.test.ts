// Barre d'outils de l'éditeur riche du cœur (<@@toolbar>, et celle que <@@editor> intègre) : le titre de chaque bouton dit son raccourci avec le nom
// des touches dans la langue de la page — « Barré (Ctrl+Maj+X) » sur une page française, « Strikethrough (Ctrl+Shift+X) » sur une page anglaise,
// bascule à chaud comprise (le dictionnaire du projet le change sous `mjs.core.toolbarShift`). Joué dans happy-dom, dont la plateforme n'est pas un Mac.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { attendre, monter } from './helpers/editeur-riche.js'

const HOTE = `<script>
  µmount ->
    window.__langue = (l)-> µlang = l
</script>

<@@toolbar class="t1"></@@toolbar>
<@@editor class="e1" toolbar="strike ul redo bold"></@@editor>
`

const OUTILS = ['strike', 'ul', 'redo', 'bold']

describe('éditeur riche : le nom des touches dans le titre des boutons suit la langue de la page (happy-dom)', function () {
  this.timeout(120000)
  let window: any
  let hote: any

  const seule  = () => hote._shadow.querySelector('.t1')
  const dans   = () => hote._shadow.querySelector('.e1')._shadow.querySelector('mjs-core-toolbar')
  const titres = (barre: any) => OUTILS.map((t) => barre._shadow.querySelector(`[data-tool="${t}"]`)?.getAttribute('title'))
  const langue = async (l: string) => { window.__langue(l); await new Promise((r) => setTimeout(r, 80)) }

  before(async () => {
    ;({ window, hote } = await monter(HOTE, 'barre-raccourcis-langue'))
    await attendre(() => !!hote._shadow.querySelector('.e1')?._shadow?.querySelector('mjs-core-toolbar')?._shadow?.querySelector('button'), 10000)
  })

  after(async () => { await terminateSharedWorkerPool() })

  it('page française : la touche s\'écrit « Maj »', async () => {
    await langue('fr')
    const attendu = ['Barré (Ctrl+Maj+X)', 'Liste à puces (Ctrl+Maj+8)', 'Rétablir (Ctrl+Maj+Z)', 'Gras (Ctrl+B)']
    assert.deepEqual(titres(seule()), attendu, 'barre posée à part')
    assert.deepEqual(titres(dans()), attendu, 'barre intégrée')
  })

  it('page anglaise : la touche s\'écrit « Shift », jamais « Maj »', async () => {
    await langue('en')
    const attendu = ['Strikethrough (Ctrl+Shift+X)', 'Bulleted list (Ctrl+Shift+8)', 'Redo (Ctrl+Shift+Z)', 'Bold (Ctrl+B)']
    assert.deepEqual(titres(seule()), attendu, 'barre posée à part')
    assert.deepEqual(titres(dans()), attendu, 'barre intégrée')
  })

  it('retour au français, à chaud : « Maj » revient', async () => {
    await langue('en')
    await langue('fr')
    assert.equal(titres(seule())[0], 'Barré (Ctrl+Maj+X)')
    assert.equal(titres(dans())[2], 'Rétablir (Ctrl+Maj+Z)')
  })
})
