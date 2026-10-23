// Les réglages d'un effet se collent à son nom : `*neon(#0ff)`. Écrits avec un espace
// (`*neon (#0ff)`), ils étaient perdus en silence — l'effet posé sans eux, et le reste versé en
// attributs parasites (`<p 0ff>`). Le build refuse désormais cette écriture en donnant la bonne, sur
// une balise comme dans une transition (`@in=*fly (up)`) ; un espace suivi d'un autre attribut reste
// permis.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

const refuse = (src: string, nom: string, ligne: number) => assert.rejects(
  transpile(src, { moduleName: 'effet-espace' }),
  (err: any) => err.message.includes(`*${nom}(`) && err.message.includes(`ligne ${ligne}`) && /espace/.test(err.message)
)

describe('effets : les réglages collés au nom', () => {
  it('*neon (#0ff) : refusé, le message donne *neon(…)', async () => {
    await refuse('<p *neon (#0ff)>x</p>\n', 'neon', 1)
  })

  it('*neon (color: red) : refusé aussi', async () => {
    await refuse('<p class="a" *neon (color: red)>x</p>\n', 'neon', 1)
  })

  it('un retour à la ligne avant la parenthèse : refusé', async () => {
    await refuse('<div>\n  <p *neon\n     (#0ff)>x</p>\n</div>\n', 'neon', 2)
  })

  it('@in=*fly (up) : refusé', async () => {
    await refuse('<script>\n  $vu = true\n</script>\n{if $vu}<p @in=*fly (up)>x</p>{end}\n', 'fly', 4)
  })

  it('*neon(#0ff) collé : les réglages arrivent à l\'effet, aucun attribut parasite', async () => {
    const { output } = await transpile('<p *neon(#0ff)>x</p>\n', { moduleName: 'effet-colle' })
    assert.match(output, /_mjs_fx\([^)]*"neon", \{[^}]*#0ff/)
    assert.doesNotMatch(output, /0ff=|<p 0ff/)
  })

  it('un espace suivi d\'un autre attribut reste permis', async () => {
    const { output } = await transpile('<p *neon title="t">x</p>\n<p *neon >y</p>\n', { moduleName: 'effet-espace-attribut' })
    assert.match(output, /"neon"/)
    assert.match(output, /title/)
  })
})
