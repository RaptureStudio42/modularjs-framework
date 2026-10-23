// Au gabarit, une chaîne `"…"` écrite dans une valeur `{…}` lit ses interpolations `#{…}` comme le fait le <script> :
// une accolade fermante écrite dans une chaîne de l'interpolation (`{"#{"}"}#{$x}"}`) ne referme pas la valeur.
//
// Défaut : le parseur lisait la chaîne à plat, jusqu'au guillemet suivant ; le `}` de `"}"` refermait la valeur, et
// `<p>{"#{"}"}#{$x}"}</p>` affichait `#{"}#X"}` au lieu de `}X`, sans erreur.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote } from './helpers/coeur-monter.js'

// [valeur du gabarit, texte attendu]
const CAS: [string, string][] = [
  ['{"#{"}"}#{$x}"}', '}X'],
  ['{"a #{ if $x then "}" else "{" } b"}', 'a } b'],
  ['{"#{$x}"}', 'X'],
  ['{"#{ "x" }"}', 'x'],
  ['{"#{"}"}"} et {"#{"{"}"}', '} et {'],
  ['{"#{ ouvre"}', '#{ ouvre'],
]

describe('gabarit : chaîne interpolée qui contient une accolade', function () {
  this.timeout(60000)
  after(() => terminateSharedWorkerPool())

  for (const [valeur, attendu] of CAS) {
    it(`<p>${valeur}</p> affiche ${attendu}`, async () => {
      const { window, hote, erreurs } = await monterHote(`<script>\n$x = 'X'\n</script>\n<p>${valeur}</p>\n`, 'chaine-accolade')
      try {
        assert.deepEqual([hote._shadow.querySelector('p').textContent, erreurs.length], [attendu, 0])
      }
      finally { await window.happyDOM.close() }
    })
  }
})
