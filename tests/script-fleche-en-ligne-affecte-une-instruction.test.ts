// Dans le `<script>` (Civet), une flèche `=>` écrite sur une ligne dont le corps affecte un `if … then … else` (ou un
// `unless`, `switch`, `try`, `for`, `while`) : `f = => x = if a then 'b' else 'c'`. Civet la compile en JavaScript
// invalide — la variable temporaire est déclarée derrière la flèche, sans accolades (`() =>let ref;if (a) …`), une
// boucle y devient `return for (…)`. Le refus arrivait par l'analyse du script, en anglais et sans rapport visible
// avec le code écrit (« The keyword 'let' is reserved », « Unexpected token »). Le message nomme maintenant la forme
// et les deux écritures qui passent ; les deux sont vérifiées au clic.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { setMessagesLang, getMessagesLang } from '../src/messages/index.js'
import { monterHote, attendre } from './helpers/coeur-monter.js'

const composant = (ligne: string) => `<script>\n$x = 'rien'\n$a = true\n${ligne}\n</script>\n<button @click={f()}>{$x}</button>`

describe('<script> : flèche en ligne qui affecte une instruction', () => {
  const fautives: Array<[string, string]> = [
    ['if … then … else', "f = => $x = if $a then 'b' else 'c'"],
    ['if … then … else sur une variable locale', "f = => x = if $a then 'b' else 'c'"],
    ['unless', "f = => $x = unless $a then 'b' else 'c'"],
    ['switch', "f = => $x = switch $a\n  when true then 'b'\n  else 'c'"],
    ['for', 'f = => $x = for y of [1] then y'],
  ]
  for (const [nom, ligne] of fautives) {
    it(`${nom} : refusé, avec la forme fautive et les deux écritures qui passent`, async () => {
      await assert.rejects(() => transpile(composant(ligne), { moduleName: 'script-fleche' }), (e: any) => {
        assert.match(e.message, /'script-fleche\.mjs'/)
        assert.match(e.message, /flèche écrite sur une seule ligne/)
        assert.match(e.message, /entre parenthèses/)
        assert.match(e.message, /à la ligne suivante, indenté/)
        assert.doesNotMatch(e.message, /keyword 'let' is reserved|Unexpected token/)
        return true
      })
    })
  }

  it('en anglais : le même message, traduit', async () => {
    const avant = getMessagesLang()
    setMessagesLang('en')
    try {
      await assert.rejects(() => transpile(composant("f = => $x = if $a then 'b' else 'c'"), { moduleName: 'script-fleche' }), /arrow written on a single line[\s\S]*in parentheses/)
    }
    finally {
      setMessagesLang(avant)
    }
  })

  it('témoin : une autre faute que l\'analyse du script relève garde son message', async () => {
    await assert.rejects(() => transpile(composant('$o = {}\n$p = if $a then {n: 1} else {...$o}\nf = => $x = \'b\''), { moduleName: 'script-fleche' }), (e: any) => {
      assert.doesNotMatch(e.message, /flèche écrite sur une seule ligne/)
      assert.match(e.message, /Piste/)
      return true
    })
  })

  for (const [nom, ligne] of [
    ['écriture conseillée : valeur entre parenthèses', "f = => $x = (if $a then 'b' else 'c')"],
    ['écriture conseillée : corps à la ligne, indenté', "f = =>\n  $x = if $a then 'b' else 'c'"],
    ['contre-cas : flèche en ligne qui affecte une simple valeur', "f = => $x = 'b'"],
  ]) {
    it(`${nom} : compile, et le clic écrit la valeur`, async () => {
      const { window, hote, erreurs } = await monterHote(composant(ligne), 'script-fleche-clic')
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
