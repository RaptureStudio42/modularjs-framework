// Le refus d'un lot de gestionnaires dont le JavaScript compilé ne s'analyse pas donnait pour « forme fautive la plus
// courante » un corps de flèche à accolades dont la seule instruction est un `if` : cette forme compile désormais
// comme un bloc, la flèche en ligne qui affecte un `if` a son propre message, et d'autres défauts de Civet y mènent
// (objet décomposé dans un `else`). Le message désigne le gestionnaire par la ligne produite
// et propose les écritures qui passent, chacune vérifiée ici au clic.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { setMessagesLang, getMessagesLang } from '../src/messages/index.js'
import { monterHote, attendre } from './helpers/coeur-monter.js'

const composant = (gestionnaire: string) => `<script>\n$x = 0\n$a = true\n$o = {}\ndoubler = -> $x = 2\n</script>\n<button ${gestionnaire}>{$x}</button>`

describe('gestionnaires au JavaScript invalide : le conseil du refus', () => {
  for (const [nom, gestionnaire] of [
    ['objet décomposé dans le else', '@click={$o = if $a then {n: 1} else {...$o}}'],
  ]) {
    it(`${nom} : refusé, le message cite la ligne produite et les écritures qui passent`, async () => {
      await assert.rejects(() => transpile(composant(gestionnaire), { moduleName: 'conseil' }), (e: any) => {
        assert.match(e.message, /JavaScript invalide/)
        assert.match(e.message, /Ligne \d+ produite : /)
        assert.match(e.message, /directement entre les accolades/)
        assert.match(e.message, /fonction du <script>/)
        assert.doesNotMatch(e.message, /Forme fautive la plus courante/)
        return true
      })
    })
  }

  it('en anglais : le même conseil, traduit', async () => {
    const avant = getMessagesLang()
    setMessagesLang('en')
    try {
      await assert.rejects(() => transpile(composant('@click={$o = if $a then {n: 1} else {...$o}}'), { moduleName: 'conseil' }), (e: any) => {
        assert.match(e.message, /directly between the braces/)
        assert.match(e.message, /function of the <script>/)
        assert.doesNotMatch(e.message, /most common culprit/)
        return true
      })
    }
    finally {
      setMessagesLang(avant)
    }
  })

  for (const [nom, gestionnaire, attendu] of [
    ['corps écrit directement, sans flèche', '@click={if $a then $x = 1}', '1'],
    ['flèche gardée, corps à la ligne, indenté', '@click={() =>\n  if ($a)\n    $x = 1\n}', '1'],
    ['appel d\'une fonction du <script>', '@click={doubler}', '2'],
  ]) {
    it(`écriture conseillée : ${nom} — compile, et le clic écrit la valeur`, async () => {
      const { window, hote, erreurs } = await monterHote(composant(gestionnaire), 'conseil-clic')
      try {
        const bouton = hote._shadow.querySelector('button')
        assert.equal(bouton?.textContent, '0')
        bouton.click()
        await attendre(() => bouton.textContent !== '0')
        assert.equal(bouton.textContent, attendu)
        assert.equal(erreurs.length, 0, erreurs.join('\n'))
      }
      finally {
        await window.happyDOM.close()
      }
    })
  }
})
