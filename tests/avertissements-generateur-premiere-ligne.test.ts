// Les avertissements du HTML d'un composant citent la ligne du FICHIER, même quand le fichier commence par des
// lignes vides : le HTML est rogné en tête avant d'être compilé, la première ligne du HTML (`firstLine`) est
// alors celle où il commence vraiment dans le fichier. Sans lignes vides en tête, rien ne change.

import assert from 'node:assert/strict'
import { setMessagesLang } from '../src/messages/index.js'
import { compile } from '../src/generator/compile.js'
import { transpile } from '../src/transpiler/index.js'

async function avertissements(src: string, type = 'syntax'): Promise<string[]> {
  const orig = console.warn
  const vus: string[] = []
  console.warn = (...a: unknown[]) => { vus.push(String(a[0])) }
  try { await transpile(src, { moduleName: 'avert-ligne' }) } finally { console.warn = orig }
  return vus.filter(m => m.includes(`[lint.${type}]`))
}

// les messages d'un appel direct du générateur
function directs(html: string, opts: Record<string, unknown> = {}): string[] {
  const orig = console.warn
  const vus: string[] = []
  console.warn = (...a: unknown[]) => { vus.push(String(a[0])) }
  try { compile(html, { moduleName: 'avert-ligne', ...opts } as any) } finally { console.warn = orig }
  return vus
}

describe('avertissements du HTML : la ligne du fichier, lignes vides en tête comprises', () => {
  it('disabled="false" : trois lignes vides en tête, le bouton est ligne 4', async () => {
    const vus = await avertissements('\n\n\n<button disabled="false">ok</button>\n')
    assert.equal(vus.length, 1, vus.join('\n'))
    assert.match(vus[0], /avert-ligne \(ligne 4\) : <button disabled="false">/)
  })

  it('une seule ligne vide en tête', async () => {
    const vus = await avertissements('\n<p>un</p>\n<button disabled="false">ok</button>\n')
    assert.match(vus[0], /\(ligne 3\)/)
  })

  it('des lignes vides, puis du HTML, puis la balise fautive plus bas', async () => {
    const vus = await avertissements('\n\n<p>un</p>\n<p>deux</p>\n<input type="checkbox" checked="false">\n')
    assert.equal(vus.length, 1, vus.join('\n'))
    assert.match(vus[0], /\(ligne 5\)/)
  })

  it('#{ … } dans un attribut statique : la ligne de la balise', async () => {
    const vus = await avertissements('\n\n<b title="#{x}">y</b>\n')
    assert.equal(vus.length, 1, vus.join('\n'))
    assert.match(vus[0], /avert-ligne \(ligne 3\) : attribut "title"/)
  })

  it('# en tête de ligne dans un texte sur plusieurs lignes : la ligne du # lui-même', async () => {
    const vus = await avertissements('\n\n\n<p>\n# liste\n</p>\n')
    assert.equal(vus.length, 1, vus.join('\n'))
    assert.match(vus[0], /avert-ligne \(ligne 5\) : « # liste »/)
  })

  it('des lignes vides AVANT un <script> : la ligne du fichier, comme sans lignes vides', async () => {
    const vus = await avertissements('\n\n<script>\n$x = 1\n</script>\n<button disabled="false">ok</button>\n')
    assert.equal(vus.length, 1, vus.join('\n'))
    assert.match(vus[0], /\(ligne 6\)/)
  })

  it('sans ligne vide en tête : rien ne change', async () => {
    const vus = await avertissements('<p>un</p>\n<p>deux</p>\n<button disabled="false">ok</button>\n')
    assert.match(vus[0], /avert-ligne \(ligne 3\) : <button disabled="false">/)
  })

  it('en anglais : « line » à la place de « ligne », même numéro', async () => {
    setMessagesLang('en')
    try {
      const vus = await avertissements('\n\n\n<button disabled="false">ok</button>\n')
      assert.match(vus[0], /avert-ligne \(line 4\): <button disabled="false">/)
    }
    finally {
      setMessagesLang('fr')
    }
  })

  it('compile() : firstLine s\'ajoute aux lignes citées, les trois avertissements', () => {
    const html = '<button disabled="false">a</button>\n<b title="#{x}">y</b>\n<p>\n# liste\n</p>'
    const vus = directs(html, { firstLine: 10 })
    assert.equal(vus.length, 3, vus.join('\n'))
    assert.match(vus.join('\n'), /\(ligne 10\) : <button disabled="false">/)
    assert.match(vus.join('\n'), /\(ligne 11\) : attribut "title"/)
    assert.match(vus.join('\n'), /\(ligne 13\) : « # liste »/)
  })

  it('compile() sans firstLine : les lignes du HTML reçu', () => {
    const vus = directs('<p>a</p>\n<button disabled="false">a</button>')
    assert.match(vus[0], /\(ligne 2\) : <button disabled="false">/)
  })
})
