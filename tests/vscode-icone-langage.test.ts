// extension VS Code — les fichiers MJS ont leur icône de langage, l'une pour les thèmes clairs, l'autre pour les sombres : la lettre µ
// dessinée en SVG (un tracé, sans texte, qui dépendrait des polices), livrée dans le paquet de l'extension depuis la 1.17.0.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const EXTENSION = join(dirname(fileURLToPath(import.meta.url)), '..', 'editors', 'vscode')
const MANIFESTE = JSON.parse(readFileSync(join(EXTENSION, 'package.json'), 'utf-8'))

describe('extension VS Code — icône des fichiers MJS', () => {
  it('le langage modularjs déclare une icône claire et une sombre, deux SVG simples livrés avec l\'extension', () => {
    const langage = MANIFESTE.contributes.languages.find((l: any) => l.id === 'modularjs')
    assert.ok(langage.icon, 'contributes.languages[].icon absent')
    assert.notEqual(langage.icon.light, langage.icon.dark)
    for (const cote of ['light', 'dark']) {
      const chemin = langage.icon[cote]
      assert.match(chemin, /^\.\/icons\/[a-z-]+\.svg$/, cote)
      const svg = readFileSync(join(EXTENSION, chemin), 'utf-8')
      assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="16" height="16" viewBox="0 0 16 16">/, cote)
      assert.ok(/<path d="M/.test(svg), cote + ' : un tracé')
      assert.ok(!/<script|<image|<text|<style|href=|url\(/.test(svg), cote + ' : ni script, ni image, ni texte, ni feuille, ni lien')
    }
    const ignore = readFileSync(join(EXTENSION, '.vscodeignore'), 'utf-8')
    assert.ok(!/icons/.test(ignore), 'les icônes partent dans le paquet')
  })

  it('l\'extension est au moins en 1.17.0, la version qui a apporté l\'icône', () => {
    const [majeure, mineure] = MANIFESTE.version.split('.').map(Number)
    assert.ok(majeure > 1 || (majeure === 1 && mineure >= 17), MANIFESTE.version)
  })
})
