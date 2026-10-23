// Un gestionnaire qui rend une flèche écrite sur UNE ligne, dont le corps affecte un `if … then … else …` (ou un
// `unless`, `switch`, `try`, `for`) : `@click={-> x = if a then 'b' else 'c'}`. La flèche fine `->` d'un gestionnaire
// devient une flèche `=>` (le composant reste `this`), et Civet compile `=> x = if …` en JavaScript invalide : la
// variable temporaire est déclarée derrière la flèche, sans accolades (`() =>let ref;if (a) ref = 'b'; …`). Le
// compilateur refusait déjà le lot, mais son conseil visait une autre faute (« un corps de flèche à accolades ») : le
// message nomme maintenant cette forme et les deux écritures qui passent — la valeur entre parenthèses, ou le corps de
// la flèche à la ligne, indenté. Les deux sont vérifiées au clic, avec le corps écrit sans flèche que la doc conseille.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { monterHote, attendre } from './helpers/coeur-monter.js'

const composant = (gestionnaire: string, lang = ' lang="coffee"') => `<script${lang}>\n$x = 'rien'\n$a = true\n$l = [1]\n</script>\n<button ${gestionnaire}>{$x}</button>`

describe('gestionnaire : flèche en ligne qui affecte une instruction', () => {
  const fautives: Array<[string, string]> = [
    ['if … then … else, CoffeeScript', "@click={-> x = if $a then 'b' else 'c'}"],
    ['if … then … else sur une variable d\'état', "@click={-> $x = if $a then 'b' else 'c'}"],
    ['flèche passée à un appel', "@click={$l.forEach (i) -> $x = if i then 'b' else 'c'}"],
    ['switch', "@click={-> $x = switch $a\n  when true then 'b'\n  else 'c'\n}"],
    ['for', '@click={-> $x = for y of $l then y}'],
  ]
  for (const [nom, gestionnaire] of fautives) {
    it(`${nom} : refusé, avec la forme fautive et les deux écritures qui passent`, async () => {
      await assert.rejects(() => transpile(composant(gestionnaire), { moduleName: 'fleche-en-ligne' }), (e: any) => {
        assert.match(e.message, /flèche écrite sur une seule ligne/)
        assert.match(e.message, /entre parenthèses/)
        assert.match(e.message, /à la ligne suivante, indenté/)
        assert.doesNotMatch(e.message, /accolades englobantes/)
        return true
      })
    })
  }

  it('Civet : même forme, même message', async () => {
    await assert.rejects(() => transpile(composant("@click={-> $x = if $a then 'b' else 'c'}", ''), { moduleName: 'fleche-en-ligne-civet' }), /flèche écrite sur une seule ligne/)
  })

  for (const [nom, gestionnaire] of [
    ['écriture conseillée : corps sans flèche', "@click={$x = if $a then 'b' else 'c'}"],
    ['écriture conseillée : valeur entre parenthèses', "@click={-> $x = (if $a then 'b' else 'c')}"],
    ['écriture conseillée : corps à la ligne, indenté', "@click={->\n  $x = if $a then 'b' else 'c'\n}"],
    ['contre-cas : flèche en ligne qui affecte une simple valeur', "@click={-> $x = 'b'}"],
  ]) {
    it(`${nom} : compile, et le clic écrit la valeur`, async () => {
      const { window, hote, erreurs } = await monterHote(composant(gestionnaire), 'fleche-en-ligne-clic')
      try {
        const bouton = hote._shadow.querySelector('button')
        assert.equal(bouton?.textContent, 'rien')
        bouton.click()
        await attendre(() => bouton.textContent !== 'rien')
        assert.equal(bouton.textContent, 'b')
        assert.equal(erreurs.length, 0, erreurs.join('\n'))
      }
      finally {
        await window.happyDOM.close()
      }
    })
  }
})
