// réglage `proxy: false` : une écriture par un élément de liste que le compilateur ne suit pas avertit à sa ligne — variable d'une
// boucle `for … of` du script, paramètre d'un rappel posé sur une liste calculée (`$l.filter(f).forEach(…)`), liste reçue en 3e
// paramètre d'un rappel (`arr[i].n = 1`), variable d'une boucle `{for}` du gabarit sur une liste calculée. Une valeur que le
// compilateur SAIT simple (type chaîne, nombre ou booléen du `<vars>`, valeur de départ simple jamais remplacée par autre chose
// qu'une valeur simple) passée à une fonction n'avertit plus : rien ne peut la modifier. Sans le réglage : aucun avertissement ;
// comparée à lui, la sortie avec le réglage ne change qu'aux écritures par un élément, que le réglage fait passer par l'aide gardée
// (`µ._mjs_deepSetOn`…, qui refuse un prototype ou une fonction du navigateur), ligne par ligne

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const SOURCE = `<vars>
  $msg  string
  $delai  int
</vars>
<script lang="js">
  $msg = 'a';
  $delai = 0;
  $n = 3;
  $texte = 'b';
  $obj = { a: 1 };
  $l = [{ n: 0 }];
  @f0 = function() { for (const y of $l) y.n++; };
  @f1 = function(f) { $l.filter(f).forEach((x) => x.n++); };
  @f2 = function() { $l.forEach((x, i, arr) => { arr[i].n = 1; }); };
  @f3 = function() { envoyer($msg); };
  @f4 = function(ws) { ws.send($msg); };
  @f5 = function() { history.pushState($delai, ''); };
  @f6 = function() { envoyer($n); $n++; $n = $n * 2; };
  @f7 = function() { envoyer($obj); };
  @f8 = function(v) { envoyer($texte); $texte = v; };
  @f9 = function() { for (const z of $l) { $delai = z.n; } };
  $w = 'c';
  @f10 = function() { µwrite($w, { a: 1 }); envoyer($w); };
  @f11 = function() { for (const [i, y] of $l.entries()) y.n++; };
</script>
<p>{$msg} {$delai} {$n} {$texte} {$obj.a}</p>
{for x in $l.map((z) => z)}<button @click={x.n++}>{x.n}</button>{end}
`

const ligne = (marque: string) => SOURCE.split('\n').findIndex((l) => l.includes(marque)) + 1
const net   = (a: unknown) => String(a).replace(/\x1b\[[0-9;]*m/g, '')

describe('réglage proxy: false — écritures par un élément de liste signalées, valeurs simples tues', function () {
  this.timeout(60000)
  let avisSans: string[] = []
  let avisDefaut: string[] = []
  let sans = ''
  let defaut = ''

  before(async () => {
    const a: any = await transpile(SOURCE, { moduleName: 'boucles' } as any)
    const b: any = await transpile(SOURCE, { moduleName: 'boucles', proxy: false } as any)
    defaut     = a.output
    sans       = b.output
    avisDefaut = (a.data?.sectionWarnings ?? []).map(net)
    avisSans   = (b.data?.sectionWarnings ?? []).map(net)
  })
  after(() => terminateSharedWorkerPool())

  const signale = (marque: string, motif: RegExp) => {
    const l = ligne(marque)
    assert.ok(avisSans.some((a) => a.includes(`ligne ${l} :`) && motif.test(a) && a.includes('µrefresh($l)')), `ligne ${l} (${marque}) non signalée : ${JSON.stringify(avisSans)}`)
  }

  it('variable d\'une boucle `for … of` du script sur une liste de l\'état', () => signale('@f0', /écriture par `y`, qui tient une partie de `\$l`/))
  it('paramètre d\'un rappel posé sur une liste calculée', () => signale('@f1', /écriture par `x`, qui tient une partie de `\$l`/))
  it('liste reçue en 3e paramètre d\'un rappel', () => signale('@f2', /écriture par `arr`, qui tient une partie de `\$l`/))
  it('variable d\'une boucle `{for}` du gabarit sur une liste calculée', () => signale('{for x in', /écriture par `x`, qui tient une partie de `\$l`/))
  it('élément de la paire rendue par `entries()` dans une boucle `for … of`', () => signale('@f11', /écriture par `y`, qui tient une partie de `\$l`/))

  it('valeur simple passée à une fonction : aucun avertissement (type du <vars>, valeur de départ simple jamais remplacée)', () => {
    for (const marque of ['@f3', '@f4', '@f5', '@f6', '@f9']) assert.ok(!avisSans.some((a) => a.includes(`ligne ${ligne(marque)} :`)), `${marque} averti : ${JSON.stringify(avisSans)}`)
  })

  it('dans le doute l\'avertissement reste : objet, variable remplacée par une valeur inconnue ou par `µwrite`', () => {
    assert.ok(avisSans.some((a) => a.includes(`ligne ${ligne('@f10')} :`) && a.includes('`$w` passé à `envoyer`')), JSON.stringify(avisSans))
    assert.ok(avisSans.some((a) => a.includes(`ligne ${ligne('@f7')} :`) && a.includes('`$obj` passé à `envoyer`')), JSON.stringify(avisSans))
    assert.ok(avisSans.some((a) => a.includes(`ligne ${ligne('@f8')} :`) && a.includes('`$texte` passé à `envoyer`')), JSON.stringify(avisSans))
  })

  it('sans le réglage : aucun avertissement', () => {
    assert.deepEqual(avisDefaut, [])
  })

  // chaque ligne qui change, telle qu'attendue avec le réglage : l'écriture par l'élément passe par l'aide gardée, une clé calculée de
  // sa chaîne par `µ._mjs_deepKey` ; le reste de la ligne ne bouge pas
  it('avec le réglage, comparé à la sortie sans lui : seules les écritures par un élément changent, passées par l\'aide gardée', () => {
    const a = defaut.split('\n')
    const b = sans.split('\n')
    assert.equal(b.length, a.length)
    const changees = b.flatMap((l, i) => l === a[i] ? [] : [[a[i].trim(), l.trim()]])
    assert.deepEqual(changees, [
      ['this.f0 = function() { for (const y of $.l) y.n++; };', 'this.f0 = function() { for (const y of $.l) {let _mjs_n;(_mjs_n = y.n, µ._mjs_deepSetOn("l", y, "n", ++_mjs_n));} };'],
      ['this.f1 = function(f) { $.l.filter(f).forEach((x) => x.n++); };', 'this.f1 = function(f) { $.l.filter(f).forEach((x) => ((_mjs_n, _mjs_v = _mjs_n++) => (µ._mjs_deepSetOn("l", x, "n", _mjs_n), _mjs_v))(x.n)); };'],
      ['this.f2 = function() { $.l.forEach((x, i, arr) => { arr[i].n = 1; }); };', 'this.f2 = function() { $.l.forEach((x, i, arr) => { µ._mjs_deepSetOn("l", µ._mjs_deepKey(arr, i), "n", 1); }); };'],
      ['this.f11 = function() { for (const [i, y] of $.l.entries()) y.n++; };', 'this.f11 = function() { for (const [i, y] of $.l.entries()) {let _mjs_n;(_mjs_n = y.n, µ._mjs_deepSetOn("l", y, "n", ++_mjs_n));} };'],
    ])
  })
})
