// module cœur field (<@@field layout="float">) dans Chromium réel, construction de production par défaut (un fichier par module, `js: 'split'`) et
// construction de développement : le module du champ arrive AVANT celui du nombre, de la liste ou de l'éditeur qu'il enveloppe, et se monte
// avant eux. Il attend leur mise à niveau pour lire leur valeur : le libellé monte au-dessus d'un nombre à 0, d'une option choisie, d'un
// éditeur rédigé, et suit une liaison qui passe de 0 à 3 sans aucun geste ; un nombre vide le laisse couché.

import assert from 'node:assert/strict'
import { ouvrir, BUILDS } from './helpers/editeur-riche.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const SOURCE = `<script>
  $n = 0
  $t = '<p>Bonjour</p>'

  µmount ->
    window.__poser = (v)-> $n = v
</script>

<form class="f" @noUJS>
  <@@field class="zero" layout="float" label="Quantité"><@@number name="q0" value="0"></@@number></@@field>
  <@@field class="lie" layout="float" label="Lié"><@@number name="q1" value=!{$n}></@@number></@@field>
  <@@field class="vide" layout="float" label="Libre"><@@number name="q2" placeholder="aucun"></@@number></@@field>
  <@@field class="pays" layout="float" label="Pays"><@@select name="p" value="fr"><@@option value="fr">France</@@option><@@option value="de">Allemagne</@@option></@@select></@@field>
  <@@field class="msg" layout="float" label="Message"><@@editor name="m" value={$t}></@@editor></@@field>
</form>
`
const ATTENTE = `(() => { const S = document.querySelector('mjs-hote')?._shadow; return !!(S && S.querySelector('.msg mjs-core-editor')?._shadow?.querySelector('.surface p') && S.querySelector('.pays mjs-core-select')?._shadow?.querySelector('.select-label') && S.querySelector('.lie mjs-core-number')?._shadow?.querySelector('.input')) })()`
const AIDES  = `window.__rempli = (c) => document.querySelector('mjs-hote')._shadow.querySelector('.' + c)._shadow.querySelector('.field').classList.contains('filled')`

describe('mjs-core-field — libellé flottant quand le champ se monte avant son contenu (chromium réel)', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const build of BUILDS) {
    it(`construction ${build === 'prod' ? 'de production (un fichier par module)' : 'de développement'} : nombre à 0, option choisie, éditeur rédigé, liaison 0 → 3`, async function () {
      const s = await ouvrir('chromium', build, { source: SOURCE, cle: 'field-par-module', attente: ATTENTE, aides: AIDES })
      if (!s) { this.skip(); return }
      try {
        await s.page.waitForTimeout(300)
        const vu = await s.page.evaluate(`({ zero: __rempli('zero'), lie: __rempli('lie'), vide: __rempli('vide'), pays: __rempli('pays'), msg: __rempli('msg') })`)
        assert.deepEqual(vu, { zero: true, lie: true, vide: false, pays: true, msg: true })
        await s.page.evaluate(`__poser(3)`)
        await s.page.waitForFunction(`document.querySelector('mjs-hote')._shadow.querySelector('.lie mjs-core-number')._shadow.querySelector('.input').value === '3'`)
        await s.page.waitForTimeout(100)
        assert.equal(await s.page.evaluate(`__rempli('lie')`), true, 'liaison passée de 0 à 3, sans geste')
        assert.deepEqual(s.logs.filter((l) => /PAGEERROR/.test(l)), [])
      } finally {
        await s.fermer()
      }
    })
  }
})
