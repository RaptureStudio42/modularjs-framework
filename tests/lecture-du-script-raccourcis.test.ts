// lecture du script par l'arbre : les raccourcis `$x` (état), `&x` (paramètre de route) et `$x =: valeur` (valeur figée)
// posés par une passe sur l'arbre de Civet (nom → membre, édition par morceaux) ; le texte donné au langage est celui du
// lexeur seul (appelé directement) partout où celui-ci lit juste ; un `$x` dans une chaîne sur plusieurs lignes reste du
// texte ; un script que l'arbre ne lit pas reprend le lexeur seul

import assert from 'node:assert/strict'
import { applyMjsSugarToScript, transpile } from '../src/transpiler/index.js'
import { tokenize } from '../src/lexer/index.js'
import { scriptReadCounters, tokenizeScript } from '../src/reader/script.js'

// le texte donné au langage, raccourcis posés par l'arbre
const texte  = (src: string, opts: Record<string, unknown> = {}): string => tokenizeScript(applyMjsSugarToScript(src, 'civet'), opts)
// le même texte, raccourcis posés par le lexeur seul
const lexeur = (src: string, opts: Record<string, unknown> = {}): string => tokenize(applyMjsSugarToScript(src, 'civet'), opts)

describe('lecture du script par l\'arbre — raccourcis $x, &x, =:', () => {
  it('rend le même texte que le lexeur seul là où il lit juste', () => {
    const scripts = [
      '$n = 0\nplus = -> $n += 1',
      '$total =: $a + $b\n$fige =:3',
      '$o.a = 1\nobj.$x = 2\nl = [1..$n]\nm = [...$items]\nk = $9',
      'id = &id\nx = (&page)\ny = a & b\nz = a&&b\nw = [&q, &r]',
      's = "valeur #{$n} et #{&id}"',
      "s = '$n reste'\n# $n commentaire\nre = /\\$n/",
      'v = µread $n\nµwrite $n, 2\nµrefresh $n',
      'µderived $d = $a * 2, $a',
      'f = (x) -> $liste.push x\nif $ok then $n++ else $n--',
      "$prénom = 'Léa'\nc = &catégorie\n$eté =: 1"
    ]
    for (const src of scripts) assert.equal(texte(src), lexeur(src), src)
  })

  it('garde un $x de module ou importé tel quel, comme le lexeur seul', () => {
    for (const opts of [{ moduleMode: true }, { externalVars: ['$Theme'] }]) {
      const src = '$Theme = 1\n$copie =: $Theme'
      assert.equal(texte(src, opts), lexeur(src, opts), JSON.stringify(opts))
    }
  })

  it('pose les raccourcis par l\'arbre, sans relecture', () => {
    const avant = { ...scriptReadCounters }
    const out   = texte('$n = &id\n$f =: $n')
    assert.equal(out, '$.n = µ.url.params.id\n$.f = µ.snap $.n')
    assert.equal(scriptReadCounters.reread, avant.reread)
    assert.ok(scriptReadCounters.tree >= avant.tree + 2)
  })

  it('reprend le lexeur seul pour un script que l\'arbre ne lit pas, avec sa raison', () => {
    const src   = '$o.a =: 2'
    const avant = scriptReadCounters.reread
    assert.equal(texte(src), lexeur(src))
    assert.ok(scriptReadCounters.reread > avant)
  })

  it('laisse en texte un $x d\'une chaîne sur plusieurs lignes', () => {
    const src = "msg = 'prix\n$n euros'\nx = $n"
    const out = texte(src)
    assert.ok(out.includes("'prix\n$n euros'"), out)
    assert.ok(out.endsWith('x .= $.n'), out)
    assert.ok(lexeur(src).includes("'prix\n$.n euros'"), 'le lexeur seul réécrit le texte de la chaîne')
  })

  it('rend le même texte que le lexeur seul pour une clé d\'objet, un nom de méthode ou un nom importé', () => {
    const scripts = [
      'b = {$x: 1}\nc = {&p: 2}',
      'a =\n  $x: 1\n  y: $z',
      '{$x: a} = obj',
      'class C\n  $x: -> 1',
      "import {$x} from 'y'\nz = $x"
    ]
    for (const src of scripts) assert.equal(texte(src), lexeur(src), src)
  })

  it('reprend le lexeur seul pour une heregex, interpolée ou non, ou une déclaration de type', () => {
    for (const src of ['r = ///a#{$x}b///', 'r = ///a$xb///\ny = $n', 'type T = typeof $n\nx = $n']) {
      const avant = scriptReadCounters.reread
      assert.equal(texte(src), lexeur(src), src)
      assert.ok(scriptReadCounters.reread > avant, src)
    }
  })

  it('compile le script lu par l\'arbre, sans réglage : un $x d\'une chaîne sur plusieurs lignes reste du texte', async () => {
    const avant  = { ...scriptReadCounters }
    const out    = (await transpile("<script>\nmsg = 'prix\n$n euros'\nx = $n\n</script>\n<p>{msg}</p>\n", { moduleName: 'prix', devWarnings: false })).output
    const lignes = out.split('\n').map((l) => l.trim())
    // la chaîne gardée en texte et le `$n` du code posé en membre : le lexeur lit la chaîne entière, aucune reprise
    for (const l of ["let msg = 'prix\\n$n euros'", 'let x = $.n']) assert.ok(lignes.includes(l), `${l}\n${out}`)
    assert.equal(scriptReadCounters.retries, avant.retries)
    assert.ok(scriptReadCounters.tree > avant.tree)
    assert.equal(scriptReadCounters.reread, avant.reread)
  })
})
