// Un gestionnaire à accolades dont le contenu forme aussi un objet (`@click={() => { if ($a) { $x = 5 } }}`) était lu
// par Civet comme un OBJET (une méthode nommée `if`) : la flèche rendait cet objet, le clic restait sans effet, sans la
// moindre erreur. Les accolades derrière la flèche sont désormais un bloc, comme en JavaScript

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote, attendre } from './helpers/coeur-monter.js'

const GESTIONNAIRES = [
  '@click={() => { if ($a) { $x = 5 } }}',
  '@click={() => {\n  if ($a) { $x = 5 }\n}}',
  '@click={(e) => { if (e) { $x = 5 } }}',
  '@click={() => { while ($a) { $x = 5; $a = 0 } }}',
  '@click={() => { if ($a) { $x = 5 }; }}',
  '@click={() => { if ($a) { $x = 5 } else { $x = 6 } }}'
]

describe('gestionnaire à accolades : un bloc, jamais un objet', function () {
  this.timeout(60000)
  after(() => terminateSharedWorkerPool())

  for (const h of GESTIONNAIRES) {
    it(`${h} : le clic écrit $x`, async () => {
      const { window, hote, erreurs } = await monterHote(`<script>\n$x = 0\n$a = 1\n</script>\n<button ${h}>{$x}</button>\n`, 'accolades-bloc')
      try {
        const b = hote._shadow.querySelector('button')
        b.click()
        try { await attendre(() => b.textContent === '5', 1500) } catch {}
        assert.deepEqual([b.textContent, erreurs.length], ['5', 0])
      }
      finally { await window.happyDOM.close() }
    })
  }
})
