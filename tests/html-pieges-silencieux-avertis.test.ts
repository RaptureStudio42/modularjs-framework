// Deux pièges du HTML d'un composant qui ne cassaient rien au build et trompaient à l'écran :
//   - `disabled="false"` (tout attribut booléen HTML écrit "false") : la balise reste désactivée — sa
//     seule présence vaut vrai, quelle que soit la valeur ;
//   - une ligne qui commence par `#` hors du <script> : ce n'est pas un commentaire, le texte part à
//     l'écran tel quel.
// Le build prévient désormais (lint.syntax), sans rien changer à ce qu'il produit ; les écritures
// légitimes (`<th>#</th>`, `#1`, un `<pre>`, un attribut énuméré `contenteditable="false"`, une
// prop de composant) ne disent rien.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

async function avertissements(src: string): Promise<string[]> {
  const orig = console.warn
  const vus: string[] = []
  console.warn = (...a: unknown[]) => { vus.push(String(a[0])) }
  try { await transpile(src, { moduleName: 'piege' }) } finally { console.warn = orig }
  return vus.filter(m => m.includes('[lint.syntax]'))
}

describe('HTML — les pièges silencieux sont signalés au build', () => {
  it('disabled="false" sur une balise native : un avertissement qui dit quoi écrire', async () => {
    const vus = await avertissements('<button disabled="false">ok</button>\n<input type="checkbox" checked="false">\n')
    assert.equal(vus.length, 2, vus.join('\n'))
    assert.match(vus[0], /disabled="false"/)
    assert.match(vus[0], /disabled=\{false\}/)
    assert.match(vus[1], /checked="false"/)
  })

  it('pas d\'avertissement : disabled nu ou lié, attribut énuméré, prop d\'un composant', async () => {
    const src = '<script>\n$off = false\n</script>\n<button disabled>a</button>\n<button disabled={$off}>b</button>\n<div contenteditable="false" aria-hidden="false" draggable="false">c</div>\n<@@checkbox disabled="false"></@@checkbox>\n'
    assert.deepEqual(await avertissements(src), [])
  })

  it('une ligne « # … » dans le HTML : un avertissement qui renvoie vers <!-- … -->', async () => {
    const vus = await avertissements('# liste des produits\n<ul>\n  <li>a</li>\n  # fin de la liste\n</ul>\n')
    assert.equal(vus.length, 2, vus.join('\n'))
    assert.match(vus[0], /# liste des produits/)
    assert.match(vus[0], /<!-- … -->/)
  })

  it('pas d\'avertissement : <th>#</th>, #1, un lien #, un <pre> ou un <code>', async () => {
    const src = '<table><tr><th>#</th><td>#1 des ventes</td></tr></table>\n<a href="#haut">haut</a>\n<pre>\n# installe\nnpm i\n</pre>\n<code>\n# note\n</code>\n<p>{"#/x"}</p>\n'
    assert.deepEqual(await avertissements(src), [])
  })
})
