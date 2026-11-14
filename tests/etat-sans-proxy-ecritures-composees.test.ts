// réglage `proxy: false` : l'objet rangé dans une variable `$` l'est tel quel, sans enveloppe — l'écriture qui le change par un
// chemin passe donc par l'aide qui prévient (`µ._mjs_deepSet`), aussi pour `++` et `--` (préfixes ou suffixes), les affectations
// composées (`+=`, `-=`, `*=`, `/=`, `%=`, `**=`, `<<=`, `>>=`, `>>>=`, `&=`, `|=`, `^=`) et logiques (`||=`, `&&=`, `??=`), à toute
// profondeur et par indice (`$l[i].n++`), et pour les cibles d'un motif (`[$o.a, $o.b] = …`) : dans le script (js, Civet, CoffeeScript), dans un gestionnaire en ligne, dans un rappel de
// transition, et dans une construction (le bundler transmet le réglage au compilateur). La valeur de l'écriture reste celle de
// JavaScript (suffixe : l'ancienne valeur, convertie en nombre ; préfixe et affectation : la valeur écrite). Sans le réglage, ou avec
// `proxy: true`, le code produit est le même : ces écritures passent par l'aide, jamais par l'enveloppe

import assert from 'node:assert/strict'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { transpile } from '../src/transpiler/index.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const ETAT = '$o = { n: 0, a: 1, b: 0, c: null, d: 1, bits: 6, p: { q: { r: 0 } } };\n  $l = [{ n: 0 }, { n: 10 }];'

// la forme écrite, puis ce que le compilateur en fait avec le réglage
const FORMES: [string, string][] = [
  ['$o.n++', '(_mjs_n = $.o.n, µ._mjs_deepSet(_mjsThis, ["o", "n"], ++_mjs_n))'],
  ['++$o.n', '(_mjs_n = $.o.n, µ._mjs_deepSet(_mjsThis, ["o", "n"], ++_mjs_n))'],
  ['$o.n--', '(_mjs_n = $.o.n, µ._mjs_deepSet(_mjsThis, ["o", "n"], --_mjs_n))'],
  ['--$o.n', '(_mjs_n = $.o.n, µ._mjs_deepSet(_mjsThis, ["o", "n"], --_mjs_n))'],
  ...['+=', '-=', '*=', '/=', '%=', '**=', '<<=', '>>=', '>>>=', '&=', '|=', '^=', '||=', '&&=', '??='].map((op): [string, string] => [`$o.a ${op} 2`, `µ._mjs_deepSet(_mjsThis, ["o", "a"], $.o.a ${op.slice(0, -1)} (2))`]),
  ['$o.p.q.r++', '(_mjs_n = $.o.p.q.r, µ._mjs_deepSet(_mjsThis, ["o", "p", "q", "r"], ++_mjs_n))'],
  ['$o.p.q.r += 10', 'µ._mjs_deepSet(_mjsThis, ["o", "p", "q", "r"], $.o.p.q.r + (10))'],
  ['$l[i].n++', '(_mjs_n = $.l[i].n, µ._mjs_deepSet(_mjsThis, ["l", i, "n"], ++_mjs_n))'],
  ['$l[0].n += 5', 'µ._mjs_deepSet(_mjsThis, ["l", 0, "n"], $.l[0].n + (5))'],
  ['$o.b ||= 5', 'µ._mjs_deepSet(_mjsThis, ["o", "b"], $.o.b || (5))'],
]

// chaque forme dans sa méthode, une instruction seule
const SOURCE_JS = `<script lang="js">
  ${ETAT}
${FORMES.map(([f], k) => `  @f${k} = function(i) { ${f}; };`).join('\n')}
</script>
<p>{$o.n} {$o.a} {$l[0].n}</p>
`

const compile = async (source: string, opts: Record<string, unknown> = {}): Promise<string> => (await transpile(source, { moduleName: 'c', ...opts } as any)).output

// le texte compilé de la forme écrite (`$o.n++` → `$.o.n++`)
const brute = (f: string) => f.replace(/\$([a-z])/g, '$.$1')

describe('réglage proxy: false — `++`, `--`, affectations composées et logiques sur l\'état local', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  it('chaque forme, à toute profondeur et par indice, s\'écrit par µ._mjs_deepSet', async () => {
    const out = await compile(SOURCE_JS, { proxy: false })
    for (const [f, attendu] of FORMES) {
      assert.ok(out.includes(attendu), `${f} : « ${attendu} » manque`)
      assert.ok(!out.includes(brute(f)), `${f} : la forme brute « ${brute(f)} » est restée`)
    }
  })

  it('la valeur lue reste celle de JavaScript : l\'ancienne valeur pour un suffixe, la valeur écrite sinon', async () => {
    const out = await compile(`<script lang="js">
  ${ETAT}
  @lu = function() { return [$o.n++, ++$o.n, $o.a += 1, $o.b ||= 9]; };
</script>
<p>{$o.n}</p>
`, { proxy: false })
    assert.ok(out.includes('((_mjs_n, _mjs_v = _mjs_n++) => (µ._mjs_deepSet(_mjsThis, ["o", "n"], _mjs_n), _mjs_v))($.o.n)'), 'suffixe lu : l\'ancienne valeur, convertie')
    assert.ok(out.includes(', µ._mjs_deepSet(_mjsThis, ["o", "n"], ((_mjs_n) => ++_mjs_n)($.o.n)), µ._mjs_deepSet(_mjsThis, ["o", "a"], $.o.a + (1)), µ._mjs_deepSet(_mjsThis, ["o", "b"], $.o.b || (9))]'), 'préfixe et affectations lus : la valeur écrite')
  })

  it('Civet et CoffeeScript : les mêmes formes s\'écrivent par µ._mjs_deepSet', async () => {
    const civet = await compile('<script>\n$o = { n: 0, a: 1, b: 0 }\n@plus = -> $o.n++\n@ajoute = -> $o.a += 2\n@ou = -> $o.b ||= 5\n</script>\n<p>{$o.n}</p>\n', { proxy: false })
    for (const attendu of ['µ._mjs_deepSet(_mjsThis, ["o", "n"], _mjs_n), _mjs_v)', 'µ._mjs_deepSet(_mjsThis, ["o", "a"], $.o.a + (2))', 'µ._mjs_deepSet(_mjsThis, ["o", "b"], $.o.b || (5))']) assert.ok(civet.includes(attendu), `Civet : « ${attendu} » manque`)
    const coffee = await compile('<script lang="coffee">\n$o = { n: 0, a: 1 }\n@plus = ->\n  $o.n++\n  return\n@ajoute = ->\n  $o.a += 2\n  return\n</script>\n<p>{$o.n}</p>\n', { proxy: false })
    for (const attendu of ['(_mjs_n = $.o.n, µ._mjs_deepSet(_mjsThis, ["o", "n"], ++_mjs_n))', 'µ._mjs_deepSet(_mjsThis, ["o", "a"], $.o.a + (2))']) assert.ok(coffee.includes(attendu), `CoffeeScript : « ${attendu} » manque`)
  })

  it('les cibles d\'un motif aussi, mêlées ou non à une variable, valeur lue comprise', async () => {
    const out = await compile(`<script lang="js">
  ${ETAT}
  $n = 0;
  @f1 = function() { [$o.a, $o.b] = [$o.b, $o.a]; };
  @f2 = function() { [$n, $o.p.q.r] = [5, 6]; };
  @f3 = function() { ({ a: $o.a, d: $o.d } = { a: 7, d: 8 }); };
  @f4 = function() { return [$o.a, $o.b] = [1, 2]; };
</script>
<p>{$o.a} {$n}</p>
`, { proxy: false })
    assert.ok(out.includes('µ._mjs_deepSet(_mjsThis, ["o", "a"], _mjsS0); µ._mjs_deepSet(_mjsThis, ["o", "b"], _mjsS1) })([$.o.b, $.o.a])'), 'échange par un motif')
    assert.ok(out.includes('µ._mjs_deepSet(_mjsThis, ["o", "p", "q", "r"], _mjsS0) })(_mjsR)); µ._set(_mjsThis, \'n\', _mjsD0)'), 'motif mêlé à une variable')
    assert.ok(out.includes('({ a: _mjsS0, d: _mjsS1 } = _mjsSR); µ._mjs_deepSet(_mjsThis, ["o", "a"], _mjsS0); µ._mjs_deepSet(_mjsThis, ["o", "d"], _mjsS1)'), 'motif d\'objet')
    assert.ok(out.includes('µ._mjs_deepSet(_mjsThis, ["o", "b"], _mjsS1); return _mjsSR })([1, 2])'), 'motif lu : la valeur affectée')
    for (const f of ['[$.o.a, $.o.b] = ', '$.o.p.q.r] = ', 'a: $.o.a']) assert.ok(!out.includes(f), `la forme brute « ${f} » est restée`)
  })

  it('un gestionnaire en ligne et un rappel de transition aussi', async () => {
    const out = await compile(`<script lang="js">
  ${ETAT}
  $vu = true;
</script>
<button @click={$o.n++}>+</button>
<button @click={$o.a *= 3}>*</button>
{if $vu}
  <p :transition=*fade @introend={$o.p.q.r++} @outroend={$o.b ||= 4}>x</p>
{end}
`, { proxy: false })
    for (const attendu of ['(_mjs_n = $.o.n, µ._mjs_deepSet(_mjsThis, ["o", "n"], ++_mjs_n))', 'µ._mjs_deepSet(_mjsThis, ["o", "a"], $.o.a * (3))', '(_mjs_n = $.o.p.q.r, µ._mjs_deepSet(_mjsThis, ["o", "p", "q", "r"], ++_mjs_n))', 'µ._mjs_deepSet(_mjsThis, ["o", "b"], $.o.b || (4))']) assert.ok(out.includes(attendu), `« ${attendu} » manque`)
    for (const f of ['$.o.n++', '$.o.a *= 3', '$.o.p.q.r++', '$.o.b ||= 4']) assert.ok(!out.includes(f), `la forme brute « ${f} » est restée`)
  })

  it('sans le réglage, ou avec proxy: true, le code produit est le même : les formes passent par l\'aide, jamais par l\'enveloppe', async () => {
    const defaut = await compile(SOURCE_JS)
    assert.equal(await compile(SOURCE_JS, { proxy: true }), defaut)
    assert.equal(await compile(SOURCE_JS, { proxy: false }), defaut)
    for (const [f] of FORMES) assert.ok(!defaut.includes(brute(f)), `${f} : la forme brute « ${brute(f)} » est restée dans le code par défaut`)
  })

  it('les écritures que le compilateur suivait déjà ne changent pas avec le réglage', async () => {
    const source = `<script lang="js">
  ${ETAT}
  $n = 0;
  $$s = { n: 0 };
  @f = function(i) { $n++; $n += 2; $o.a = 3; $l[i].n = 4; $l.push({ n: 1 }); delete $o.c; $$s.n++; $$s.n += 2; };
</script>
<p>{$n} {$o.a} {$$s.n}</p>
`
    // avec l'enveloppe, une méthode de liste n'est compilée que pour ce qui n'est pas un objet ordinaire (un objet à soi qui porte ce nom
    // est appelé tel quel, sur l'enveloppe) : ce test de type retiré, la sortie est celle du réglage
    const defaut   = await compile(source)
    const sansTest = (texte: string) => texte.replace(/;?\(Object\.prototype\.toString\.call\(([^()]*)\) !== '\[object Object\]' \? (µ\._mjs_deepCall\([^\n]*?\)) : \1\.\w+\([^\n]*?\)\)(?=;)/g, '$2')
    assert.ok(defaut.includes('Object.prototype.toString.call(_mjsThis._state.l)'), 'test de type posé avec l\'enveloppe')
    assert.equal(await compile(source, { proxy: false }), sansTest(defaut))
  })

  it('une construction transmet le réglage au compilateur (fichiers du projet et compileSingle)', async () => {
    const root   = mjsTmp('sans-proxy-composees')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'c-formes.mjs'), SOURCE_JS)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), proxy: false } as any)
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const sortie = readFileSync(join(outDir, readdirSync(outDir).find((f) => f.startsWith('c-formes'))!), 'utf-8')
    assert.ok(sortie.includes('(_mjs_n = $.o.n, µ._mjs_deepSet(_mjsThis, ["o", "n"], ++_mjs_n))'), 'construction : `$o.n++` n\'est pas compilé')
    const seul = await bundler.compileSingle(SOURCE_JS, { fileName: 'c-formes.mjs' })
    assert.ok(seul.includes('µ._mjs_deepSet(_mjsThis, ["o", "a"], $.o.a + (2))'), 'compileSingle : `$o.a += 2` n\'est pas compilé')
    await bundler.close()
  })
})
