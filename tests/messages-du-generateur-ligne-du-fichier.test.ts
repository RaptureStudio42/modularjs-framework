// Les messages de la construction du gabarit (élément hors d'un tableau, imbrication refusée, `<p>` refermé par un bloc,
// valeur dans un `<template>`) citaient la ligne comptée dans le morceau de gabarit construit — « ligne 2 » pour une balise
// à la ligne 6 du fichier, sans rapport dans un bloc `{if}`/`{for}`. Ils citent la ligne du fichier `.mjs`. Un `<form>`
// dans un tableau a son propre message : le navigateur y laisse un `<form>` vide et sort son contenu du formulaire

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { t, setMessagesLang } from '../src/messages/index.js'

const T = (html: string) => transpile(`<script>\n$a = 1\n$rows = [1]\n</script>\n${html}\n`, { moduleName: 'lignes-generateur' })

describe('messages du générateur : la ligne du fichier', () => {
  it('à la racine : la ligne de la balise fautive', async () => {
    await assert.rejects(T('<div>\n  <select><option>a</option><select><option>{$a}</option></select></select>\n</div>'), /<select> \(ligne 6\)/)
    await assert.rejects(T('<table>\n  <tr>\n\n    oups\n    <td>{$a}</td>\n  </tr>\n</table>'), /du texte \(ligne 8\)/)
  })

  it('dans un bloc `{for}` ou `{if}` : la ligne du fichier, pas celle du bloc', async () => {
    await assert.rejects(T('<div>\n{for r in $rows}\n<table>\n<form><tr><td>{r}</td></tr></form>\n</table>\n{end}\n</div>'), /<form> \(ligne 8\)/)
    await assert.rejects(T('<div>\n{if $a}\n\n<p>a\n<li>b</li>\n</p>\n{end}\n</div>'), /\(ligne 9\)/)
  })

  it('`<form>` dans un tableau : le message dit ce que fait le navigateur, en français et en anglais', async () => {
    await assert.rejects(T('<table><form><tr><td>{$a}</td></tr></form></table>'), /<form> \(ligne 5\)[^]*<form> vide, refermé sur place[^]*sort son contenu du formulaire/)
    await assert.rejects(T('<table><div>{$a}</div></table>'), /<div> \(ligne 5\)[^]*le retire du tableau/)
    setMessagesLang('en')
    try {
      assert.match(t('generator.hors-tableau-form', { parent: 'table', ligne: 3 }), /line 3\)[^]*empty <form>/)
    }
    finally { setMessagesLang('fr') }
  })
})
