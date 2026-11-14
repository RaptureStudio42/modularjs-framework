// la préparation du HTML lit les mots de MJS (`:preload`, `:noUJS`, `:title`…) sur les balises de l'arbre du gabarit : une
// balise écrite dans le texte d'un <textarea> ou d'un <title> n'est qu'un texte, ses mots restent tels qu'écrits (aucune
// réécriture, aucun refus) ; une vraie balise est préparée comme avant

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

async function compile(html: string): Promise<string> {
  const orig = console.warn
  console.warn = () => {}
  try {
    return (await transpile(html + '\n', { moduleName: 'prep' })).output
  }
  finally {
    console.warn = orig
  }
}

describe('la préparation du HTML, balises lues dans l\'arbre du gabarit', () => {
  it('un mot écrit dans le texte d\'un <textarea> reste un texte', async () => {
    const output = await compile('<textarea aria-label="t">voir <a :preload="on">x</a></textarea>')
    assert.doesNotMatch(output, /data-mjs-preload/)
    assert.match(output, /:preload=/)
  })

  it('un mot refusé écrit dans le texte d\'un <textarea> n\'arrête pas la construction', async () => {
    const output = await compile('<textarea aria-label="t"><a :noUJS="x">x</a></textarea>')
    assert.match(output, /:noUJS=/)
  })

  it('une vraie balise après le <textarea> est préparée comme avant', async () => {
    const output = await compile('<textarea aria-label="t">voir <a :preload="on">x</a></textarea>\n<a href="/b" :preload="hover">b</a>')
    assert.match(output, /data-mjs-preload/)
    assert.match(output, /hover/)
  })
})
