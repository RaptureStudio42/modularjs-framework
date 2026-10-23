// L'avertissement « # en tête de ligne dans le HTML » ne vise que du texte qui s'affiche sans l'avoir voulu :
//   - un bloc de code montré tel quel n'avertit pas : `<@@code>` (module cœur, `mjs-core-code`), `<@code>`
//     (`mjs-code`), `<code>`, `<pre>` — un extrait shell, Civet ou Python y a des lignes `# …` ;
//   - un `#` seul sur sa ligne (`<th>\n  #\n</th>`, l'en-tête d'une colonne de numéros) n'avertit pas :
//     il faut un texte après le `#` ; `# titre` et `## titre` avertissent toujours.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

async function avertissements(src: string): Promise<string[]> {
  const orig = console.warn
  const vus: string[] = []
  console.warn = (...a: unknown[]) => { vus.push(String(a[0])) }
  try { await transpile(src, { moduleName: 'diese' }) } finally { console.warn = orig }
  return vus.filter(m => m.includes('[lint.syntax]'))
}

describe('# en tête de ligne dans le HTML — blocs de code et cellules', () => {
  it('<@@code> : des lignes `# …` d\'un extrait de code n\'avertissent pas', async () => {
    const src = '<@@code>\n# installer\nnpm i\n\n# lancer\nnpm start\n</@@code>\n'
    assert.deepEqual(await avertissements(src), [])
  })

  it('<@code>, <mjs-code> et <mjs-core-code> : pareil', async () => {
    for (const balise of ['@code', 'mjs-code', 'mjs-core-code']) {
      assert.deepEqual(await avertissements(`<${balise}>\n# une ligne\nx\n</${balise}>\n`), [], balise)
    }
  })

  it('<@@code> : un bloc dans un bloc (div à l\'intérieur) reste du texte littéral', async () => {
    assert.deepEqual(await avertissements('<@@code>\n<div>\n# dedans\n</div>\n</@@code>\n'), [])
  })

  it('<pre> et <code> : toujours rien', async () => {
    assert.deepEqual(await avertissements('<pre>\n# a\n</pre>\n<code>\n# b\n</code>\n'), [])
  })

  it('un `#` seul sur sa ligne (cellule d\'en-tête sur plusieurs lignes) : rien', async () => {
    assert.deepEqual(await avertissements('<table><tr><th>\n  #\n</th><th>nom</th></tr></table>\n'), [])
    assert.deepEqual(await avertissements('<table><tr>\n<th>\n  #\n</th>\n</tr></table>\n'), [])
  })

  it('un `#` suivi seulement de blancs : rien', async () => {
    assert.deepEqual(await avertissements('<table><tr><th>\n  #  \n</th></tr></table>\n'), [])
  })

  it('un `#` suivi d\'un texte : un avertissement', async () => {
    const vus = await avertissements('<p>\n  # liste des produits\n</p>\n<p>\n  ## titre\n</p>\n')
    assert.equal(vus.length, 2, vus.join('\n'))
    assert.match(vus[0], /# liste des produits/)
    assert.match(vus[1], /## titre/)
  })

  it('un `#` seul dans une cellule, et #1 : rien, comme avant', async () => {
    assert.deepEqual(await avertissements('<table><tr><th>#</th><td>#1 des ventes</td></tr></table>\n<a href="#haut">haut</a>\n'), [])
  })
})
