// une liaison `prop=!{…}` qui ne peut rien lier fait échouer la construction : sur <@window>, un nom hors de
// la liste (faute de frappe `scrolY`) n'écrivait qu'un message dans la console du worker, construction verte
// et liaison morte ; sur <@document>, <@body>, <@html> et <@head>, la liaison était jetée sans un mot

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

async function erreursDe(gabarit: string): Promise<string[]> {
  const avant = console.error
  console.error = () => {}
  try {
    const r = await transpile(`<script>\n$y = 0\n</script>\n${gabarit}\n<p>{$y}</p>\n`, { moduleName: 'carte' })
    return r.data.macroErrors ?? []
  }
  finally {
    console.error = avant
  }
}

describe('liaison prop=!{…} des balises globales — jamais jetée en silence', () => {
  it('<@window scrollY=!{$y}> : liaison valide, aucune erreur', async () => {
    assert.deepEqual(await erreursDe('<@window scrollY=!{$y}>'), [])
  })

  it('<@window scrolY=!{$y}> : une erreur qui nomme la propriété et cite les propriétés liables', async () => {
    const erreurs = await erreursDe('<@window scrolY=!{$y}>')
    assert.equal(erreurs.length, 1, JSON.stringify(erreurs))
    assert.match(erreurs[0], /scrolY/)
    assert.match(erreurs[0], /scrollY/)
  })

  for (const gabarit of ['<@document scrollY=!{$y}>', '<@body scrollY=!{$y}>', '<@html scrollY=!{$y}>', '<@head scrollY=!{$y}><title>x</title></@head>', '<@head scrollY=!{$y} />']) {
    it(`${gabarit} : une erreur qui renvoie à <@window>`, async () => {
      const erreurs = await erreursDe(gabarit)
      assert.equal(erreurs.length, 1, JSON.stringify(erreurs))
      assert.match(erreurs[0], /<@window>/)
      assert.match(erreurs[0], /scrollY/)
    })
  }
})
