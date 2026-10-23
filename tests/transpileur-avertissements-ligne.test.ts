// Les avertissements du transpileur citent la ligne du fichier .mjs où se trouve la faute, quand elle se
// situe : `@title = …` à la construction du composant, un gestionnaire qui cite nu une méthode du
// composant, `@onUrlChange = …` (ancienne écriture). Sans position connue, aucune ligne n'est inventée.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

async function avertissements(src: string, type: string): Promise<string[]> {
  const orig = console.warn
  const vus: string[] = []
  console.warn = (...a: unknown[]) => { vus.push(String(a[0])) }
  try { await transpile(src, { moduleName: 'carte' }) } finally { console.warn = orig }
  return vus.filter(m => m.includes(`[lint.${type}]`))
}

describe('avertissements du transpileur : la ligne du fichier', () => {
  it('@title = … à la construction : la ligne de l\'écriture', async () => {
    const vus = await avertissements("<script>\n$n = 1\n@title = 'x'\n</script>\n<p>x</p>\n", 'naming')
    assert.equal(vus.length, 1, vus.join(' | '))
    assert.match(vus[0], /\(ligne 3\)/)
  })

  it('la ligne tient compte de ce qui précède le <script> dans le fichier', async () => {
    const vus = await avertissements("<p>a</p>\n<script>\n$n = 1\n\n@title = 'x'\n</script>\n", 'naming')
    assert.equal(vus.length, 1, vus.join(' | '))
    assert.match(vus[0], /\(ligne 5\)/)
  })

  it('une propriété écrite par déstructuration : la ligne aussi', async () => {
    const vus = await avertissements("<script>\n$n = 1\n[@hidden] = [false]\n</script>\n<p>x</p>\n", 'naming')
    assert.equal(vus.length, 1, vus.join(' | '))
    assert.match(vus[0], /\(ligne 3\)/)
  })

  it('un gestionnaire qui cite nu une méthode du composant : la ligne du gestionnaire', async () => {
    const vus = await avertissements('<script>\n@valider = -> 1\n</script>\n<p>a</p>\n<button @click=valider>go</button>\n', 'events')
    assert.equal(vus.length, 1, vus.join(' | '))
    assert.match(vus[0], /\(ligne 5\)/)
    const accolades = await avertissements('<script>\n@valider = -> 1\n</script>\n<p>a</p>\n<p>b</p>\n<button @click={valider()}>go</button>\n', 'events')
    assert.equal(accolades.length, 1, accolades.join(' | '))
    assert.match(accolades[0], /\(ligne 6\)/)
  })

  it('un gestionnaire de <@window> : la ligne de la balise', async () => {
    const vus = await avertissements('<script>\n@valider = -> 1\n</script>\n<p>a</p>\n<@window @keydown={valider()}>\n', 'events')
    assert.equal(vus.length, 1, vus.join(' | '))
    assert.match(vus[0], /\(ligne 5\)/)
  })

  it('@onUrlChange = … (ancienne écriture) : la ligne de l\'écriture', async () => {
    const vus = await avertissements('<script>\n$n = 1\n@onUrlChange = -> 1\n</script>\n<p>x</p>\n', 'legacy')
    assert.equal(vus.length, 1, vus.join(' | '))
    assert.match(vus[0], /\(ligne 3\)/)
  })
})
