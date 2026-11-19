// lecture du script par l'arbre : les commentaires `#` du dialecte sont lus par Civet (mode `coffeeComment`) ; la passe des
// commentaires rend le même texte que le balayeur (chemin `balayeur`, appelé directement) partout où celui-ci lit juste, et
// lit juste une bannière `######`, une chaîne sur plusieurs lignes, une regex passée sans parenthèses ; un script que
// l'arbre ne lit pas sûrement (bloc `### … ###` au milieu d'une ligne, heregex, lettre réservée, script illisible) reprend
// le balayeur

import assert from 'node:assert/strict'
import { applyCivetDialectSugar, transpile } from '../src/transpiler/index.js'
import { scriptReadCounters } from '../src/reader/script.js'

// la lecture des commentaires par l'arbre (`lus`) : celle d'un script de composant repris
const dialecte = (src: string): string => applyCivetDialectSugar(src, 'civet', undefined, 1, undefined, undefined, 'read')
// le balayeur des commentaires : celui des gestionnaires, des modules et des fichiers serveur
const balayeur = (src: string): string => applyCivetDialectSugar(src, 'civet', undefined, 1, undefined, undefined, 'scanner')

describe('lecture du script par l\'arbre — commentaires du dialecte', () => {
  it('rend le même texte que le balayeur là où il lit juste', () => {
    const scripts = [
      "x = 1 # note l'eau\ny = 2",
      '### bloc\n  src/**/*.json\n###\nc = 1',
      'o =\n  a: 1 # c1\n  b: 2 ### c2 ###\n',
      'e = /#\\d/\n# fin',
      'h = "a #{b} c" # com',
      "s = '# pas un commentaire'\nt = \"\"\"\n  # texte\n\"\"\"\n",
      '#!/usr/bin/env node\ni = 1',
      '// deja\ng = 1 /* bloc */',
      '  k = 1\n  # indenté\n  l = 2',
      'm = 1 #'
    ]
    for (const src of scripts) assert.equal(dialecte(src), balayeur(src), src)
  })

  it('lit par l\'arbre un script ordinaire, sans relecture', () => {
    const avant = { ...scriptReadCounters }
    dialecte("total = 0 # somme l'an\n### note\n###\nfin = 1")
    assert.equal(scriptReadCounters.tree, avant.tree + 1)
    assert.equal(scriptReadCounters.reread, avant.reread)
  })

  it('reprend le balayeur pour un script que l\'arbre ne lit pas sûrement, avec sa raison', () => {
    const scripts = [
      'd = 1 ### en ligne ### + 2',
      'a = 1\n### bloc ### b = 2',
      'x = b#',
      'f = ///\n  a # commentaire\n  b\n///\n',
      'x = 1\nr = ///\n  a#{x} # commentaire\n  b\n///\n',
      'type Point =\n  # abscisse\n  x: number\np = 1',
      "n = 'Ꞩ'\n# c",
      'x = (\n# c'
    ]
    for (const src of scripts) {
      const avant = scriptReadCounters.reread
      assert.equal(dialecte(src), balayeur(src), src)
      assert.equal(scriptReadCounters.reread, avant + 1, src)
      assert.ok(typeof scriptReadCounters.last === 'string' && scriptReadCounters.last.length > 0, src)
    }
  })

  it('lit une bannière dont le nombre de # est un multiple de 3 comme un commentaire', () => {
    const src = '###### Réglages ######\nz = 3'
    assert.equal(dialecte(src), '//##### Réglages ######\nz .= 3')
  })

  it('lit une ligne qui commence par #### comme un commentaire, sans avaler la suite du script', () => {
    assert.equal(dialecte('#### quatre\nq = 1'), '//### quatre\nq .= 1')
  })

  it('garde une chaîne sur deux lignes dont la seconde commence par #', () => {
    const src = "$msg = 'prix en euros\n# deuxième ligne'\nw = 1"
    const out = dialecte(src)
    assert.ok(out.includes("'prix en euros\n# deuxième ligne'"), out)
  })

  it('lit une regex passée sans parenthèses suivie d\'un commentaire', () => {
    const src = "a = 'l\\'eau'.replace /'/g, '-'  # retire l'apostrophe\nb = 2"
    const out = dialecte(src)
    assert.ok(out.includes(".replace /'/g, '-'  // retire l'apostrophe\n"), out)
  })

  it('compile un composant dont le script porte des commentaires `#`, sans rien en garder', async () => {
    const src    = "<script>\n# compteur l'an\n$n = 0 # départ\n### bloc\n  src/**/*.json\n###\nplus = -> $n += 1 # clic\n</script>\n<button @click={plus}>{$n}</button>\n"
    const out    = (await transpile(src, { moduleName: 'compteur', devWarnings: false })).output
    const lignes = out.split('\n').map((l) => l.trim())
    // le code du script, celui que rendait aussi l'ancienne lecture (sortie et carte égales au caractère près)
    for (const l of ["µ._set(_mjsThis, 'n', 0)", "let plus = function() { return ((_v) => (µ._set(_mjsThis, 'n', _v), _v))($.n + (1)) }"]) assert.ok(lignes.includes(l), `${l}\n${out}`)
    assert.doesNotMatch(out, /compteur l'an|départ|src\/\*\*\/\*\.json/)
  })
})
