// un guillemet jamais refermé dans un attribut : le lecteur suit la chaîne jusqu'au bout du gabarit, comme le navigateur ;
// le gabarit est refusé, du message du guillemet (aucune valeur devinée, aucune relecture). Un {end} de trop à la toute fin,
// après une balise raccourci que sa sonde referme plus loin : cette balise, jamais refermée

import assert from 'node:assert/strict'
import { parse, type Node } from '../src/parser/index.js'

// la lecture d'un gabarit, ses messages de console retenus
function lire(html: string): { arbre?: Node, erreur?: string, console: string[] } {
  const garde = { warn: console.warn, error: console.error, log: console.log }
  const vus: string[] = []
  console.warn = console.error = console.log = (...a: unknown[]) => { vus.push(a.map(String).join(' ')) }
  try {
    return { arbre: parse(html), console: vus }
  }
  catch (e) {
    return { erreur: (e as Error).message, console: vus }
  }
  finally {
    Object.assign(console, garde)
  }
}

describe('un guillemet jamais refermé dans un attribut : refusé, du message du guillemet', () => {
  const cas: Array<[string, string, string, string]> = [
    ['<p class="a>b</p>\n<p>c</p>\n', '"', 'class', 'p'],
    ["<p title='x>b</p>\n<p>c</p>\n", "'", 'title', 'p'],
    ['<input value="{$v}>\n<p>b</p>\n', '"', 'value', 'input'],
    ["<b title='y>", "'", 'title', 'b'],
  ]
  for (const [html, guillemet, nom, balise] of cas) {
    it(JSON.stringify(html), () => {
      const lu = lire(html)
      assert.ok(lu.arbre === undefined, 'accepté')
      assert.ok(lu.erreur?.includes(`[GUILLEMET JAMAIS REFERMÉ] ligne 1, colonne ${html.indexOf(guillemet) + 1} : le guillemet ${guillemet} qui ouvre la valeur de \`${nom}\` sur <${balise}>`), lu.erreur)
      assert.deepEqual(lu.console, [])
    })
  }
})

describe('un {end} de trop à la fin, après une balise raccourci que sa sonde referme plus loin', () => {
  it('la balise raccourci, jamais refermée, sans avertissement', () => {
    const lu = lire('<@carte>\n<title></@carte></title>\n{end}\n')
    assert.ok(lu.erreur?.includes('[BALISE NON FERMÉE] `<mjs-carte>` ouverte ligne 1'), lu.erreur)
    assert.deepEqual(lu.console, [])
  })
})
