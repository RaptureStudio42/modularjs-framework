// écritures profondes que le compilateur voit : clé ou indice calculés (`$l[$i].n = 5`, `$o[$k]++`, `$l[$l.length] = x`),
// méthodes qui modifient une `Date`, paramètre d'un rappel de liste écrit sur place, variable d'une boucle `{for}` du gabarit, tête
// d'une boucle du script qui écrit un champ, `+=` profond — toutes compilées en appels de MJS, avec ou sans le réglage `proxy: false`
// (même sortie, sauf la branche d'un élément de liste déplacé, gardée sans l'enveloppe : voir `telleQuEcrite`). Avec le réglage, ce qu'il ne voit pas (alias, `Object.assign`, méthode d'une classe, fonction venue d'ailleurs)
// reçoit un avertissement à la construction, à sa ligne, qui conseille `µrefresh` ; jamais sans le réglage

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const FORMES = [
  '$l[$i].n = 5', '$l[$i].n += 1', '$o[$k]++', '$l[$l.length] = { n: 9, tags: [] }', 'const i = 0; $l[i + 1].n = 2', 'let k = 0; $l[k++].n += 1',
  '$d.setUTCDate(5)', '$o.when.setUTCHours(3)', '$l.forEach((x) => x.n++)', '$l.map((x) => { x.n = 1; return x; })', 'for ($o.k of [1, 2]) {}', '$o.a.b += 1',
  '$l.forEach((x, j) => { x.tags.push(j); })',
]

const SOURCE = `<script lang="js">
  $o = { n: 0, a: { b: 0 }, k: 0, when: new Date(0) };
  $l = [{ n: 0, tags: [] }];
  $i = 0;
  $k = 'n';
  $d = new Date(0);
${FORMES.map((f, k) => `  @f${k} = function() { ${f}; };`).join('\n')}
</script>
<p>{$o.n} {$l[0].n} {$d.getTime()}</p>
{for x in $l}<button @click={x.n++}>{x.n}</button><i @click={x.tags.push(1)}>i</i>{end}
`

// branche telle qu'écrite d'un paramètre de rappel ou d'une variable `{for}` quand l'élément n'est plus à son indice (liste remplacée ou
// retriée pendant le rappel) : sans l'enveloppe, elle passe par l'aide gardée du composant (`µ._mjs_deepSetOn`, `µ._mjs_deepCallOn`).
// `x` y reste un ancien élément de la liste, qui peut être un prototype rangé par une clé venue de données (`$l = [$o[k]]`, `k` vaut
// `'__proto__'`) : écrite telle quelle, `x.n = 1` poserait `n` sur `Object.prototype`, `x.tags.push(j)` remplirait `Array.prototype`.
// Avec l'enveloppe, l'écriture telle qu'écrite passe par elle, qui refuse ce prototype : rien à poser. Ici, l'aide remise en écriture
// telle qu'écrite, pour comparer le reste des deux sorties
const telleQuEcrite = (texte: string) => texte
  .replace(/\(\(_mjs_n, _mjs_v = _mjs_n\+\+\) => \(µ\._mjs_deepSetOn\("l", x, "n", _mjs_n\), _mjs_v\)\)\(x\.n\)/g, 'x.n++')
  .replace(/µ\._mjs_deepSetOn\("l", x, "n", 1\)/g, 'x.n = 1')
  .replace(/µ\._mjs_deepCallOn\("l", x\.tags, 'push', \[(\w+)\]\)/g, 'x.tags.push($1)')

// le corps compilé de la méthode `@fk`
const corps = (out: string, k: number) => {
  const m = out.match(new RegExp(`this\\.f${k} = function\\(\\) \\{([^\\n]*)`))
  assert.ok(m, `méthode f${k} introuvable`)
  return m![1]
}

describe('écritures profondes vues par le compilateur', function () {
  this.timeout(60000)
  let defaut = ''
  let sans   = ''
  let avisSans: string[] = []
  let avisDefaut: string[] = []

  before(async () => {
    const a: any = await transpile(SOURCE, { moduleName: 'vues' } as any)
    const b: any = await transpile(SOURCE, { moduleName: 'vues', proxy: false } as any)
    defaut     = a.output
    sans       = b.output
    avisDefaut = a.data?.sectionWarnings ?? []
    avisSans   = b.data?.sectionWarnings ?? []
  })
  after(() => terminateSharedWorkerPool())

  it('même sortie avec ou sans le réglage (hors la branche d\'un élément déplacé, gardée sans l\'enveloppe), aucun avertissement pour ces formes', () => {
    // avec l'enveloppe, une méthode de liste n'est compilée que pour ce qui n'est pas un objet ordinaire (un objet à soi qui porte ce nom
    // est appelé tel quel, sur l'enveloppe) : ce test de type retiré, la sortie est celle sans l'enveloppe
    const sansTest = (texte: string) => texte.replace(/\(Object\.prototype\.toString\.call\(([^()]*)\) !== '\[object Object\]' \? (µ\._mjs_deepCall\([^\n]*?\)) : \1\.\w+\([^()\n]*\)\)/g, '$2')
    assert.ok(defaut.includes('Object.prototype.toString.call(x.tags)'), 'test de type posé avec l\'enveloppe')
    // la branche d'un élément déplacé (cf. telleQuEcrite) : gardée sans l'enveloppe (3 rappels du script, 2 gestionnaires du gabarit)
    assert.equal(sans.match(/µ\._mjs_deep(?:Set|Call)On\("l", x/g)?.length, 5, sans)
    assert.equal(defaut.match(/µ\._mjs_deep(?:Set|Call)On\(/g), null)
    assert.equal(telleQuEcrite(sans), sansTest(defaut))
    assert.deepEqual(avisDefaut, [])
    assert.deepEqual(avisSans, [])
  })

  it('clé ou indice calculés : le chemin compilé garde l\'expression, évaluée une fois', () => {
    assert.match(corps(sans, 0), /µ\._mjs_deepSet\(_mjsThis, \["l", \$\.i, "n"\], 5\)/)
    assert.match(corps(sans, 1), /µ\._mjs_deepSet\(_mjsThis, \["l", \$\.i, "n"\], \$\.l\[\$\.i\]\.n \+ \(1\)\)/)
    assert.match(corps(sans, 2), /\(_mjs_n = \$\.o\[\$\.k\], µ\._mjs_deepSet\(_mjsThis, \["o", \$\.k\], \+\+_mjs_n\)\)/)
    assert.match(corps(sans, 3), /µ\._mjs_deepSet\(_mjsThis, \["l", \$\.l\.length\], \{ n: 9, tags: \[\] \}\)/)
    assert.match(corps(sans, 4), /µ\._mjs_deepSet\(_mjsThis, \["l", i \+ 1, "n"\], 2\)/)
    const f5 = corps(sans, 5)
    assert.match(f5, /_mjs_deepSet\(_mjsThis, \["l", _mjs_k1, "n"\], \$\.l\[_mjs_k1\]\.n \+ \(1\)\)/)
    assert.equal(f5.split('k++').length - 1, 1, 'clé à effet évaluée une seule fois : ' + f5)
  })

  it('méthodes qui modifient une Date, à la racine et en profondeur', () => {
    assert.match(corps(sans, 6), /\(\$\.d instanceof Date \? µ\._mjs_deepCall\(_mjsThis, \["d"\], 'setUTCDate', \[5\]\) : \$\.d\.setUTCDate\(5\)\)/)
    assert.match(corps(sans, 7), /\(\$\.o\.when instanceof Date \? µ\._mjs_deepCall\(_mjsThis, \["o", "when"\], 'setUTCHours', \[3\]\) : \$\.o\.when\.setUTCHours\(3\)\)/)
  })

  it('paramètre d\'un rappel de liste : écrit par son indice, vérifié par identité', () => {
    assert.match(corps(sans, 8), /forEach\(\(x, (_mjs_i\d+)\) => \(µ\._mjs_toRaw\(\$\.l\?\.\[\1\]\) === µ\._mjs_toRaw\(x\) \? .*µ\._mjs_deepSet\(_mjsThis, \["l", \1, "n"\]/)
    // branche d'un élément déplacé : l'aide gardée sans l'enveloppe, l'écriture telle qu'écrite avec elle (cf. telleQuEcrite)
    assert.match(corps(sans, 9), /map\(\(x, (_mjs_i\d+)\) => \{ ;?\(µ\._mjs_toRaw\(\$\.l\?\.\[\1\]\) === µ\._mjs_toRaw\(x\) \? µ\._mjs_deepSet\(_mjsThis, \["l", \1, "n"\], 1\) : µ\._mjs_deepSetOn\("l", x, "n", 1\)\)/)
    assert.match(corps(defaut, 9), /map\(\(x, (_mjs_i\d+)\) => \{ ;?\(µ\._mjs_toRaw\(\$\.l\?\.\[\1\]\) === µ\._mjs_toRaw\(x\) \? µ\._mjs_deepSet\(_mjsThis, \["l", \1, "n"\], 1\) : x\.n = 1\)/)
    assert.match(corps(sans, 12), /forEach\(\(x, j\) => \{ ;?\(µ\._mjs_toRaw\(\$\.l\?\.\[j\]\) === µ\._mjs_toRaw\(x\) \? µ\._mjs_deepCall\(_mjsThis, \["l", j, "tags"\], 'push', \[j\]\) : µ\._mjs_deepCallOn\("l", x\.tags, 'push', \[j\]\)\)/)
  })

  it('tête d\'une boucle du script qui écrit un champ', () => {
    assert.match(corps(sans, 10), /for \(const (_mjs_f\d+) of \[1, 2\]\) \{ µ\._mjs_deepSet\(_mjsThis, \["o", "k"\], \1\);/)
  })

  it('`+=` profond de l\'état local : compilé, même sans le réglage', () => {
    assert.match(corps(defaut, 11), /µ\._mjs_deepSet\(_mjsThis, \["o", "a", "b"\], \$\.o\.a\.b \+ \(1\)\)/)
  })

  it('variable d\'une boucle `{for}` du gabarit : écrite par son indice, vérifiée par identité', () => {
    assert.match(sans, /µ\._mjs_deepSet\(_mjsThis, \["l", _mjs_ra_0\._mjs_ix, "n"\]/)
    assert.match(sans, /µ\._mjs_deepCall\(_mjsThis, \["l", _mjs_ra_0\._mjs_ix, "tags"\], 'push', \[1\]\)/)
    assert.match(sans, /µ\._mjs_toRaw\(\$\.l\?\.\[_mjs_ra_0\._mjs_ix\]\) === µ\._mjs_toRaw\(x\) \?/)
  })

  it('CoffeeScript et Civet : mêmes formes compilées', async () => {
    const coffee: any = await transpile('<script lang="coffee">\n$l = [{ n: 0 }]\n$i = 0\n@a = ->\n  $l[$i].n += 1\n  return\n@b = ->\n  $l.forEach (x) -> x.n++\n  return\n</script>\n<p>{$l[0].n}</p>\n', { moduleName: 'cf', proxy: false } as any)
    assert.match(coffee.output, /_mjs_deepSet\(_mjsThis, \["l", \$\.i, "n"\], \$\.l\[\$\.i\]\.n \+ \(1\)\)/)
    assert.match(coffee.output, /_mjs_deepSet\(_mjsThis, \["l", _mjs_i\d+, "n"\]/)
    const civet: any = await transpile('<script>\n$l = [{ n: 0 }]\n$i = 0\n@a = -> $l[$i].n = 5\n@b = -> $l.forEach (x) => x.n++\n</script>\n<p>{$l[0].n}</p>\n', { moduleName: 'cv', proxy: false } as any)
    assert.match(civet.output, /µ\._mjs_deepSet\(_mjsThis, \["l", \$\.i, "n"\], 5\)/)
    assert.match(civet.output, /_mjs_deepSet\(_mjsThis, \["l", _mjs_i\d+, "n"\]/)
  })

  it('réglage `proxy: false` : ce que le compilateur ne voit pas est signalé à sa ligne, avec `µrefresh` ; jamais sans le réglage', async () => {
    const src = `<script lang="js">
  $o = { n: 0, panier: null };
  $l = [{ n: 0 }];
  @a = function() { const t = $o; t.n = 1; };
  @b = function() { Object.assign($o, { n: 1 }); };
  @c = function() { $o.panier.ajouter(1); };
  @d = function() { trier($l); };
  @e = function() { $l.forEach(maj); $l.find((x) => x.n === 0).n = 1; };
  @f = function() { $n = calcul($l); console.log($o); $l.forEach((x) => x.n++); $o.n++; };
  function trier(l) { return l; }
  function maj(x) { return x; }
  function calcul(l) { return l.length; }
</script>
<p>{$o.n} {$n}</p>
<button @click={Object.assign($o, { n: 2 })}>b</button>
`
    const sansP: any = await transpile(src, { moduleName: 'avis', proxy: false } as any)
    const avecP: any = await transpile(src, { moduleName: 'avis' } as any)
    const avis = (sansP.data?.sectionWarnings ?? []).filter((w: string) => w.includes('µrefresh'))
    assert.deepEqual((avecP.data?.sectionWarnings ?? []).filter((w: string) => w.includes('µrefresh')), [])
    const lignes = avis.map((w: string) => (w.match(/ligne (\d+)/) ?? [])[1])
    assert.deepEqual(lignes, ['4', '5', '6', '7', '8', '8', '15'], avis.join('\n'))
    for (const w of avis) assert.match(w, /écrivez µrefresh\(\$(o|l)\)/)
    assert.match(avis[0], /`t`/)
    assert.match(avis[2], /`ajouter`/)
    assert.match(avis[3], /`trier`/)
    assert.match(avis[5], /écriture par `\$l\.find\(/)
  })
})
