// Gestionnaire à accolades (`@click={() => { … }}`) : Civet lit ces accolades comme un OBJET dès que leur contenu en
// forme un, et un `;` collé à la dernière instruction en fait un bloc.
//
// Défauts : quand la dernière ligne finissait par un commentaire `//` (`if ($a) { $x = 6 } // fin`), ou n'était
// qu'un commentaire, le `;` tombait dans le commentaire : le clic restait sans effet, sans erreur. Sans mot de
// contrôle, le `;` posé après un appel final en faisait une méthode (`go() {;}`) : l'appel n'avait plus lieu. Et
// chaque gestionnaire à accolades payait une compilation Civet de plus, environ trois fois le coût d'une flèche.
//
// Règle : le `;` se pose avant le commentaire final ; Civet n'est consulté que si une instruction du premier niveau
// commence par un mot de contrôle (`if`, `while`, `for`…) ; un gestionnaire ordinaire reste tel qu'écrit.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { monterHote, attendre } from './helpers/coeur-monter.js'

// [gestionnaire, texte attendu après le clic]
const GESTIONNAIRES: [string, string][] = [
  ['@click={() => {\n  if ($a) { $x = 6 } // fin\n}}', '6'],
  ['@click={() => {\n  if ($a) { $x = 6 }\n  // note finale\n}}', '6'],
  ['@click={() => {\n  while ($a) { $x = 6; $a = 0 } /* fin */\n}}', '6'],
  ['@click={() => { go() }}', '9'],
  ['@click={() => {\n  un()\n  go()\n}}', '9'],
  ['@click={() => {\n  $x = 4\n  if ($a) { $x = 6 }\n}}', '6'],
]

describe('gestionnaire à accolades : commentaire final, appel final', function () {
  this.timeout(120000)
  after(() => terminateSharedWorkerPool())

  for (const [h, attendu] of GESTIONNAIRES) {
    it(`${h} : le clic écrit ${attendu}`, async () => {
      const { window, hote, erreurs } = await monterHote(`<script>\n$x = 0\n$a = 1\nun = -> $x = 4\ngo = -> $x = 9 if $x is 4 or $x is 0\n</script>\n<button ${h}>{$x}</button>\n`, 'accolades-final')
      try {
        const b = hote._shadow.querySelector('button')
        b.click()
        try { await attendre(() => b.textContent === attendu, 1500) } catch {}
        assert.deepEqual([b.textContent, erreurs.length], [attendu, 0])
      }
      finally { await window.happyDOM.close() }
    })
  }

  it('300 gestionnaires à accolades ordinaires coûtent ce que coûtent 300 flèches sans accolades', async () => {
    const composant = (f: (i: number) => string) => `<script>\n$x = 0\n</script>\n<div>\n${Array.from({ length: 300 }, (_, i) => f(i)).join('\n')}\n</div>\n`
    const formes: Record<string, string> = {
      accolades: composant((i) => `<button @click={() => { $x = ${i} }}>b${i}</button>`),
      fleches: composant((i) => `<button @click={-> $x = ${i}}>b${i}</button>`),
    }
    const avant = console.warn
    console.warn = () => {}
    const temps: Record<string, number[]> = { accolades: [], fleches: [] }
    try {
      for (let tour = 0; tour < 5; tour++) {
        for (const nom of tour % 2 ? ['fleches', 'accolades'] : ['accolades', 'fleches']) {
          const t0 = performance.now()
          await transpile(formes[nom], { moduleName: 'duree' })
          if (tour > 0) temps[nom].push(performance.now() - t0)
        }
      }
    }
    finally { console.warn = avant }
    const mediane = (t: number[]) => [...t].sort((a, b) => a - b)[Math.floor(t.length / 2)]
    const rapport = mediane(temps.accolades) / mediane(temps.fleches)
    assert.ok(rapport < 1.6, `accolades ${Math.round(mediane(temps.accolades))} ms, flèches ${Math.round(mediane(temps.fleches))} ms (rapport ${rapport.toFixed(2)})`)
  })
})
