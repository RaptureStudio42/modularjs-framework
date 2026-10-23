// Les avertissements du HTML d'un composant citent la ligne de ce qu'ils signalent : `disabled="false"`
// et `#{ … }` dans un attribut (la ligne de la balise), un `#` en tête de ligne dans du texte (la ligne
// du `#` lui-même, même quand le texte court sur plusieurs lignes). La ligne est celle du gabarit comptée
// depuis le haut du fichier quand il commence par une balise ou un <script> ; elle est citée en français
// comme en anglais, sans changer le reste du message.

import assert from 'node:assert/strict'
import { setMessagesLang } from '../src/messages/index.js'
import { transpile } from '../src/transpiler/index.js'

async function avertissements(src: string, type = 'syntax'): Promise<string[]> {
  const orig = console.warn
  const vus: string[] = []
  console.warn = (...a: unknown[]) => { vus.push(String(a[0])) }
  try { await transpile(src, { moduleName: 'avert-ligne' }) } finally { console.warn = orig }
  return vus.filter(m => m.includes(`[lint.${type}]`))
}

describe('avertissements du HTML — la ligne est citée', () => {
  it('disabled="false" : la ligne de la balise, avant le texte du message', async () => {
    const vus = await avertissements('<p>un</p>\n<p>deux</p>\n<button disabled="false">ok</button>\n')
    assert.equal(vus.length, 1, vus.join('\n'))
    assert.match(vus[0], /avert-ligne \(ligne 3\) : <button disabled="false">/)
  })

  it('un <script> avant le HTML : la ligne reste celle du fichier', async () => {
    const vus = await avertissements('<script>\n$x = 1\n</script>\n<p>{$x}</p>\n<input type="checkbox" checked="false">\n')
    assert.equal(vus.length, 1, vus.join('\n'))
    assert.match(vus[0], /\(ligne 5\)/)
  })

  it('deux balises fautives : chacune sa ligne', async () => {
    const vus = await avertissements('<button disabled="false">a</button>\n\n<input checked="false">\n')
    assert.equal(vus.length, 2, vus.join('\n'))
    assert.match(vus[0], /\(ligne 1\)/)
    assert.match(vus[1], /\(ligne 3\)/)
  })

  it('un attribut sur une ligne plus bas dans la balise : la ligne où la balise s\'ouvre', async () => {
    const vus = await avertissements('<p>x</p>\n<button\n  class="b"\n  disabled="false">ok</button>\n')
    assert.equal(vus.length, 1, vus.join('\n'))
    assert.match(vus[0], /\(ligne 2\)/)
  })

  it('# en tête de ligne : la ligne du # lui-même', async () => {
    const vus = await avertissements('# liste des produits\n<ul>\n  <li>a</li>\n  # fin de la liste\n</ul>\n')
    assert.equal(vus.length, 2, vus.join('\n'))
    assert.match(vus[0], /avert-ligne \(ligne 1\) : « # liste des produits »/)
    assert.match(vus[1], /avert-ligne \(ligne 4\) : « # fin de la liste »/)
  })

  it('# dans un même texte de plusieurs lignes : chaque ligne fautive porte son numéro', async () => {
    const vus = await avertissements('<p>\n  texte\n  # un\n  suite\n  ## deux\n</p>\n')
    assert.equal(vus.length, 2, vus.join('\n'))
    assert.match(vus[0], /\(ligne 3\) : « # un »/)
    assert.match(vus[1], /\(ligne 5\) : « ## deux »/)
  })

  it('# après un <script> : la ligne du fichier', async () => {
    const vus = await avertissements('<script>\n$x = 1\n</script>\n<div>\n  {$x}\n  # note\n</div>\n')
    assert.equal(vus.length, 1, vus.join('\n'))
    assert.match(vus[0], /\(ligne 6\) : « # note »/)
  })

  it('#{ … } dans un attribut statique : la ligne de la balise', async () => {
    const vus = await avertissements('<p>x</p>\n<b title="Réservé à #{$pierre}">x</b>\n')
    assert.equal(vus.length, 1, vus.join('\n'))
    assert.match(vus[0], /avert-ligne \(ligne 2\) : attribut "title"/)
  })

  it('en anglais : « line » à la place de « ligne »', async () => {
    setMessagesLang('en')
    try {
      const a = await avertissements('<p>x</p>\n<button disabled="false">ok</button>\n')
      assert.match(a[0], /avert-ligne \(line 2\): <button disabled="false">/)
      const b = await avertissements('<p>\n  texte\n  # un\n</p>\n')
      assert.match(b[0], /avert-ligne \(line 3\): "# un"/)
      const c = await avertissements('<b title="a #{$x}">x</b>\n')
      assert.match(c[0], /avert-ligne \(line 1\): attribute "title"/)
    }
    finally {
      setMessagesLang('fr')
    }
  })

  it('le reste du message ne change pas : ce qu\'il faut écrire à la place est toujours là', async () => {
    const vus = await avertissements('<p>x</p>\n<button disabled="false">ok</button>\n')
    assert.match(vus[0], /disabled=\{false\}/)
    assert.match(vus[0], /\[lint\.syntax\]$/)
  })
})
