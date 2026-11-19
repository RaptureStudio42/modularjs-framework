// lecture du script par l'arbre, une seule lecture par Civet : les raccourcis `$x` et `&x` sont écrits par le lexeur,
// l'arbre de la compilation du script vérifie qu'ils sont du code au lieu d'une compilation de plus par le lecteur ; les
// commentaires d'un composant sont retirés avant le sucre, un `#` restant (couleur, interpolation) ne coûte aucune lecture ;
// un raccourci que l'arbre ne sait pas poser (`{$x}`, clé `$x:`, nom de méthode, paramètre) passe par le lecteur et rend
// le code ou l'erreur du lexeur ; un `#` que Civet lirait comme du code fait relire le script, ses commentaires lus par
// l'arbre ; un module qui exporte un nom déclaré plus bas est lu par l'arbre

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { codeCounters, clearCodeCache } from '../src/reader/index.js'
import { dialectComments, scriptReadCounters } from '../src/reader/script.js'

async function sortie(src: string): Promise<string> {
  try {
    const r = await transpile(src, { moduleName: 'une-lecture', defaultScriptLang: 'civet', templateLang: 'civet', devWarnings: false })
    return `${r.output}\n--- carte\n${r.sourceMap ?? ''}`
  }
  catch (e) {
    return `--- erreur\n${String((e as Error).message ?? e)}`
  }
}

const composant = (script: string, gabarit = '<p>{$n}</p>'): string => `<script>\n${script}\n</script>\n${gabarit}\n`

// la sortie (ou l'erreur) contient chaque ligne attendue, blancs des bords ôtés
async function contient(src: string, attendues: string[]): Promise<void> {
  const out    = await sortie(src)
  const lignes = out.split('\n').map((l) => l.trim())
  for (const l of attendues) assert.ok(lignes.includes(l), `${l}\n${out}`)
}

// les compilations de Civet faites par le lecteur pour une compilation du composant, son cache vidé avant
async function compilationsDuLecteur(src: string): Promise<number> {
  clearCodeCache()
  const lu = codeCounters.compilations
  await sortie(src)
  return codeCounters.compilations - lu
}

// à froid, le lecteur compile une fois pour tout composant de ces cas (autant que sans la lecture du script par l'arbre) :
// le script n'en coûte aucune de plus
const LECTURE_DU_COMPOSANT = 1

describe('lecture du script par l\'arbre — une seule lecture par Civet', () => {
  it('compile un script sans commentaire `#` sans lecture de plus par le lecteur', async () => {
    const retouche = scriptReadCounters.patches
    assert.equal(await compilationsDuLecteur(composant('$n = 0\nid = &id\nplus = -> $n += 1')), LECTURE_DU_COMPOSANT, 'compilations de Civet par le lecteur')
    assert.equal(scriptReadCounters.patches - retouche, 1, 'raccourcis posés dans l\'arbre de la compilation')
  })

  it('rend le code des raccourcis écrits par le lexeur', async () => {
    // chaque ligne attendue : celle que rendait aussi l'ancienne lecture (sorties égales au caractère près, carte comprise)
    const cas: [string, string[]][] = [
      ['$n = 0\nplus = -> $n += 1\n$o.a = $n * 2', ["let plus = function() { return ((_v) => (µ._set(_mjsThis, 'n', _v), _v))($.n + (1)) }", 'µ._mjs_deepSet(_mjsThis, ["o", "a"], $.n * 2)']],
      ['obj = {a: $n, b: [$n, &id]}\nf $n, "texte $n &id"\nobj.$x = 2', ['let obj = {a: $.n, b: [$.n, µ.url.params.id]}', 'f($.n, "texte $n &id")', 'obj.$x = 2']],
      ['if $n? then $n++ else $n--\n[$a, $b] = [1, 2]\nt = `a ${$n} b`', ["if ($.n != null) {let _mjs_n;(_mjs_n = $.n, µ._set(_mjsThis, 'n', ++_mjs_n));} else {let _mjs_n;(_mjs_n = $.n, µ._set(_mjsThis, 'n', --_mjs_n));}", 'let t = `a ${$.n} b`']],
      ["c = &catégorie\n$prénom = 'Léa'", ['let c = µ.url.params.catégorie', "µ._set(_mjsThis, 'prénom', 'Léa')"]],
      ['e = "&amp; et a &b"\nz = a&&b\ny = a & b\nk = (&page)', ['let e = "&amp; et a &b"', 'let z = a&&b', 'let y = a & b', 'let k = (µ.url.params.page)']],
      ['g = -> $liste.y?.z ?? $w\n$n ?= 2  // note $n', ['let g = function() { return $.liste.y?.z ?? $.w }', "µ._set(_mjsThis, 'n', $.n ?? (2))"]]
    ]
    for (const [script, lignes] of cas) await contient(composant(script), lignes)
  })

  it('garde tels quels un $x du <script module> et un nom importé', async () => {
    // le code que rendait aussi l'ancienne lecture
    await contient('<script module>\n$Theme = 1\nexport f = -> $Theme + 1\n</script>\n<script>\n$n = f()\n</script>\n<p>{$n}</p>\n', ['let $Theme = undefined; $Theme = 1', 'export var f = function() { return $Theme + 1 }', "µ._set(_mjsThis, 'n', f())"])
  })

  it('rend le code du lexeur pour une abréviation `{$x}` et un paramètre décomposé, en une reprise au plus', async () => {
    // le code que rendait aussi l'ancienne lecture
    const cas: [string, string][] = [['$n = 1\no = {$n}', 'let o = {n: $.n}'], ['$n = 1\nf = ({$q}) -> $q', 'let f = ({q: $.q})(function() { return $.q })']]
    for (const [script, ligne] of cas) {
      const avant = scriptReadCounters.retries
      await contient(composant(script), [ligne])
      assert.ok(scriptReadCounters.retries - avant <= 1, script)
    }
  })

  it('rend le code ou l\'erreur du lexeur pour un $x en clé, en nom de méthode ou de champ, en paramètre, par le lecteur', async () => {
    // le code ou l'erreur que rendait aussi l'ancienne lecture (même message, même position)
    const cas: [string, string][] = [
      ['$n = 1\no = {$n: 1, b: $n}', "'une-lecture' : une-lecture.mjs:3:8 Failed to parse"],
      ['$n = 1\nclass A\n  $m: -> 1', "'une-lecture' : une-lecture.mjs:4:4 Failed to parse"],
      ['$n = 1\no = {$m() { 1 }}', "'une-lecture' : [analyzer] parse error: Unexpected token (3:22)"],
      ['$n = 1\nclass A\n  $g() { 1 }', "'une-lecture' : une-lecture.mjs:4:4 Failed to parse"],
      ['$n = 1\n{$a} = o', "(void ((_mjsR) => { let _mjsD0; ({a: _mjsD0} = _mjsR); µ._set(_mjsThis, 'a', _mjsD0) })(o))"],
      ['$n = 1\nf = ($p = 1) -> $p', "let f = function(pin = 1) { µ._set(_mjsThis, 'p', pin); return $.p }"],
      ['$n = 1\no = {&id: 1}', "'une-lecture' : une-lecture.mjs:3:9 Failed to parse"]
    ]
    for (const [script, ligne] of cas) {
      const avant = scriptReadCounters.retries
      await contient(composant(script), [ligne])
      assert.ok(scriptReadCounters.retries - avant <= 1, script)
    }
  })

  it('compile `$x =: valeur` en une seule lecture, sans reprise', async () => {
    // le code que rendait aussi l'ancienne lecture
    const cas: [string, string[]][] = [
      [composant('$n = 1\n$f =: $n\ng = -> $f =: $n + 1'), ["µ._set(_mjsThis, 'f', µ.snap($.n))", "let g = function() { return ((_v) => (µ._set(_mjsThis, 'f', _v), _v))(µ.snap($.n + 1)) }"]],
      ['<script module>\n$T =: 2\n</script>\n<script>\n$n = 1\n</script>\n<p>{$n}</p>\n', ['let $T = undefined; $T = µ.snap(2)']]
    ]
    for (const [src, lignes] of cas) {
      const avant = scriptReadCounters.retries
      assert.equal(await compilationsDuLecteur(src), LECTURE_DU_COMPOSANT, src)
      assert.equal(scriptReadCounters.retries - avant, 0, src)
      await contient(src, lignes)
    }
  })

  it('laisse en texte `$x =: valeur` et `&x` cités dans une chaîne sur plusieurs lignes, lue correctement du premier coup (sans reprise)', async () => {
    for (const script of ['$n = 1\ns = "ligne un\n$x =: 2 et &id\nfin"', "$n = 1\ns = 'ligne un\n$x =: 2 et &id\nfin'"]) {
      const avant = scriptReadCounters.retries
      const out   = await sortie(composant(script))
      assert.match(out, /let s = (["'])ligne un\\n\$x =: 2 et &id\\nfin\1/, script)
      assert.equal(scriptReadCounters.retries - avant, 0, script)
    }
  })

  it('compile un composant dont le script porte un `#` hors commentaire sans lecture de plus par le lecteur', async () => {
    // le code que rendait aussi l'ancienne lecture
    const cas: [string, string[]][] = [
      ['$n = 1\nc = "#fff"\nd = "x#{$n}y"', ['let c = "#fff"', 'let d = `x${$.n}y`']],
      ['c = \'#0a0\'\n$n = 2', ["let c = '#0a0'", "µ._set(_mjsThis, 'n', 2)"]],
      ['$n = 1\nr = /#a/\ns = "b#{1 + 2}"', ['let r = /#a/', 'let s = `b${1 + 2}`']]
    ]
    for (const [script, lignes] of cas) {
      assert.equal(await compilationsDuLecteur(composant(script)), LECTURE_DU_COMPOSANT, script)
      await contient(composant(script), lignes)
    }
  })

  it('compile les gestionnaires dont le code porte `#{…}` ou un commentaire `#` sans lecture de plus par le lecteur', async () => {
    // le code que rendait aussi l'ancienne lecture
    const cas: [string, string[]][] = [
      ['<button @click={-> $n = "x#{$n}"}>a</button>', ["return () => ((_v) => (µ._set(_mjsThis, 'n', _v), _v))(`x${$.n}`)"]],
      ['<button @click={->\n  # note\n  $n++\n}>a</button>', ['// note', "return ((_mjs_n, _mjs_v = _mjs_n++) => (µ._set(_mjsThis, 'n', _mjs_n), _mjs_v))($.n)"]]
    ]
    for (const [gabarit, lignes] of cas) {
      assert.equal(await compilationsDuLecteur(composant('$n = 0', gabarit)), LECTURE_DU_COMPOSANT, gabarit)
      await contient(composant('$n = 0', gabarit), lignes)
    }
  })

  it('relit les commentaires par l\'arbre quand la compilation lirait un `#` comme du code (commentaire dans `${…}`)', async () => {
    const src   = composant('$n = 1\nt = `a${1 # note\n}b`')
    const avant = scriptReadCounters.retries
    const out   = await sortie(src)
    assert.match(out, /`a\$\{1 \/\/ note\n\}b`/)
    assert.doesNotMatch(out, /this\.length/)
    assert.equal(scriptReadCounters.retries - avant, 1)
    assert.match(scriptReadCounters.lastRetry ?? '', /#/)
  })

  it('rend le code du lexeur pour une heregex interpolée, une déclaration de type, un $T dans une annotation', async () => {
    // le code que rendait aussi l'ancienne lecture
    const cas: [string, string[]][] = [
      ['$n = 1\nr = ///a#{$n}b///', ['let r = /a#{$n}b/']],
      ['type T = typeof $n\n$n = 1', ["µ._set(_mjsThis, 'n', 1)"]],
      ['f = (a: typeof $n) -> a\n$n = 1', ['let f = function(a) { return a }']],
      ['$n = 1\nr = ///\n  a # lettre\n  b\n///', ['let r = /ab/']]
    ]
    for (const [script, lignes] of cas) await contient(composant(script), lignes)
    // le code produit seul : la carte de source cite le texte d'origine
    assert.doesNotMatch((await sortie(composant('type T = typeof $n\n$n = 1'))).split('\n--- carte\n')[0], /typeof \$/)
  })

  it('lit par l\'arbre un module qui exporte un nom déclaré plus bas', () => {
    const relus = scriptReadCounters.reread
    const lu    = dialectComments('export { plus }\n# ajoute un\nplus = (x) -> x + 1')
    assert.equal(lu, 'export { plus }\n// ajoute un\nplus = (x) -> x + 1')
    assert.equal(scriptReadCounters.reread, relus)
  })
})
