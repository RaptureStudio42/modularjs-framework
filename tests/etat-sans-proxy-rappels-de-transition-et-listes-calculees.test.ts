// réglage `proxy: false` : une écriture qu'un rappel de transition (`@introstart`, `@introend`, `@outrostart`, `@outroend`) fait sans
// que le compilateur la voie avertit à la ligne de sa balise (variable sans `$` qui garde l'objet, `Object.assign`, élément rendu
// par une méthode, élément d'une boucle `{for}` qui l'entoure). Compilés en appels de MJS : la variable d'une boucle `{for}` sur une
// liste calculée qui garde les objets d'une liste de l'état nommée par un chemin (`filter`, `slice`, `toSorted`, `toReversed`),
// retrouvée par son identité ; une valeur lue en tête d'instruction (`x.n++ || f()`) — la branche qui écrit telle qu'écrit, quand
// l'élément a quitté sa place, passe par l'aide gardée (`µ._mjs_deepSetOn`), qui refuse un prototype ou une fonction du navigateur. Avertissent encore : une autre liste calculée
// (`map`), une clé qui agit (`x.t[k++] = 1`, `x.t[k++] += 1`, `x.t[($l.reverse(), 0)] = 1` : la garde se lirait avant son effet), une
// liste calculée d'un élément de boucle (`row.cells.filter(f)`), un gestionnaire qui attend (`await`). La liaison à deux sens
// (`items=!{$rows}`) passe l'objet revenu de l'enfant à `µ._set`, qui juge l'écho par l'époque, et repose l'objet à l'enfant même tel
// quel. Sans le réglage : aucun avertissement, écritures telles qu'écrites, gardes de la liaison gardées

import assert from 'node:assert/strict'
import * as acorn from 'acorn'
import { transpile } from '../src/transpiler/index.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const TRANSITIONS = `<script>
  $o = { c: 0 }
  $l = [{ n: 0 }]
</script>
<p :transition=*fade @introend={t = $o; t.c = 9}>a</p>
<p :transition=*fade @introstart={Object.assign($o, { c: 1 })}>b</p>
<p :transition=*fade @outroend={$l.find((z) => z.n == 0).n = 1}>c</p>
{for x in $l}<p :transition=*fade @introend={x.n++}>{x.n}</p>{end}
<p :transition=*fade @introend={$o.c = 2}>d</p>
`

const LISTES = `<script lang="js">
  $l = [{ n: 0, t: [0, 0] }, { n: 10, t: [0, 0] }];
  @tete = function() { $l.forEach((x) => { x.n++ || g(); }); };
  @cle = function(k) { $l.forEach((x) => { x.t[k++] = 1; }); };
</script>
{for x in $l.filter((z) => z.n >= 0)}<button class="a" @click={x.n++}>{x.n}</button>{end}
{for x in $l.slice(1).toSorted((a, b) => a.n - b.n)}<button class="b" @click={x.t.push(1)}>{x.n}</button>{end}
{for x in $l.map((z) => z)}<button class="c" @click={x.n = 5}>{x.n}</button>{end}
{for x in $l}<button class="d" @click={x.n++ || g(); h()}>{x.n}</button>{end}
`

// clés qui agissent, liste calculée d'un élément de boucle, gestionnaire qui attend : avertis, gardés tels qu'écrits
const AVERTIS = `<script lang="js">
  $l = [{ n: 0, t: [0, 0] }];
  $rows = [{ cells: [{ n: 0 }] }];
  @a = function(k) { $l.forEach((x) => { x.t[k++] += 1; }); };
  @b = function(k) { $l.forEach((x) => { x.t[k++]++; }); };
  @c = function(k) { $l.forEach((x) => { x.t[k++] ||= 1; }); };
</script>
{for x in $l}<button @click={x.t[($l.reverse(), 0)] = 1}>{x.n}</button>{end}
{for row in $rows}<div>{for c in row.cells.filter((z) => z)}<button @click={c.n++}>{c.n}</button>{end}</div>{end}
{for x in $l.filter((z) => z)}<button @click={await µafter(10); x.n++}>{x.n}</button>{end}
`

const LIAISON = `<script>
  $rows = [{ nom: 'a' }]
</script>
<@c-editeur items=!{$rows}>
<p>{$rows[0].nom}</p>
`

const net   = (a: unknown) => String(a).replace(/\x1b\[[0-9;]*m/g, '')
const ligne = (source: string, marque: string) => source.split('\n').findIndex((l) => l.includes(marque)) + 1

async function compiler(source: string, nom: string, opts: Record<string, unknown>) {
  const r: any = await transpile(source, { moduleName: nom, ...opts } as any)
  return { sortie: String(r.output), avis: (r.data?.sectionWarnings ?? []).map(net).filter((a: string) => a.includes('µrefresh')) as string[] }
}

describe('réglage proxy: false — rappels de transition signalés, éléments de listes calculées et têtes d\'instruction compilés', function () {
  this.timeout(60000)
  const r: Record<string, { sortie: string, avis: string[] }> = {}

  before(async () => {
    for (const [nom, source] of Object.entries({ transitions: TRANSITIONS, listes: LISTES, liaison: LIAISON, avertis: AVERTIS })) {
      r[nom + '-sans'] = await compiler(source, nom, { proxy: false })
      r[nom + '-defaut'] = await compiler(source, nom, {})
    }
  })
  after(() => terminateSharedWorkerPool())

  it('rappels de transition : chaque écriture que le compilateur ne voit pas avertit à la ligne de sa balise, avec le conseil µrefresh', () => {
    const avis = r['transitions-sans'].avis
    const signale = (marque: string, motif: string, racine: string) => assert.ok(avis.some((a) => a.includes(`ligne ${ligne(TRANSITIONS, marque)} :`) && a.includes(motif) && a.includes(`µrefresh(${racine})`)), `${marque} non signalé : ${JSON.stringify(avis)}`)
    signale('@introend={t = $o', 'écriture par `t`, qui tient une partie de `$o`', '$o')
    signale('@introstart={Object.assign', '`Object.assign` modifie `$o`', '$o')
    signale('@outroend={$l.find', 'qui tient une partie de `$l`', '$l')
    signale('{for x in $l}', 'écriture par `x`, qui tient une partie de `$l`', '$l')
    assert.equal(avis.length, 4, JSON.stringify(avis))
    assert.ok(r['transitions-sans'].sortie.includes('µ._mjs_deepSet(_mjsThis, ["o", "c"], 2)'), 'l\'écriture par un chemin reste compilée')
  })

  it('liste calculée qui garde les objets d\'une liste de l\'état : l\'élément écrit passe par son indice dans la liste, retrouvé par identité', () => {
    const s = r['listes-sans'].sortie
    assert.match(s, /_mjs_rj_0 = Array\.prototype\.indexOf\.call\(_mjs_rl_0, x\)/)
    assert.ok(s.includes('µ._mjs_toRaw($.l?.[_mjs_rj_0]) === µ._mjs_toRaw(x) ? (_mjs_n = x.n, µ._mjs_deepSet(_mjsThis, ["l", _mjs_rj_0, "n"], ++_mjs_n)) : ((_mjs_n, _mjs_v = _mjs_n++) => (µ._mjs_deepSetOn("l", x, "n", _mjs_n), _mjs_v))(x.n)'), 'filter')
    assert.ok(s.includes('µ._mjs_deepCall(_mjsThis, ["l", _mjs_rj_0, "t"], \'push\', [1])'), 'slice puis toSorted')
    assert.ok(s.includes('x.n = 5') && !s.includes('["l", _mjs_rj_0, "n"], 5)'), 'map : telle qu\'écrite')
  })

  it('valeur lue en tête d\'instruction : compilée dans sa garde ; clé qui agit : telle qu\'écrite', () => {
    const s = r['listes-sans'].sortie
    assert.ok(s.includes(';(µ._mjs_toRaw($.l?.[_mjs_i0]) === µ._mjs_toRaw(x) ? ((_mjs_n, _mjs_v = _mjs_n++) => (µ._mjs_deepSet(_mjsThis, ["l", _mjs_i0, "n"], _mjs_n), _mjs_v))(x.n) : ((_mjs_n, _mjs_v = _mjs_n++) => (µ._mjs_deepSetOn("l", x, "n", _mjs_n), _mjs_v))(x.n)) || g()'), 'tête, dans un rappel')
    assert.ok(s.includes(';(µ._mjs_toRaw($.l?.[_mjs_ra_0._mjs_ix]) === µ._mjs_toRaw(x) ? ((_mjs_n, _mjs_v = _mjs_n++) => (µ._mjs_deepSet(_mjsThis, ["l", _mjs_ra_0._mjs_ix, "n"], _mjs_n), _mjs_v))(x.n) : ((_mjs_n, _mjs_v = _mjs_n++) => (µ._mjs_deepSetOn("l", x, "n", _mjs_n), _mjs_v))(x.n)) || g()'), 'tête, dans un gestionnaire')
    assert.ok(s.includes('$.l.forEach((x) => { µ._mjs_deepSetOn("l", x.t, k++, 1); })') && !s.includes('"t", k++]'), 'clé qui agit : par l\'aide gardée, sans garde d\'élément')
  })

  it('la liste calculée que le compilateur ne suit pas et la clé qui agit avertissent encore', () => {
    const avis = r['listes-sans'].avis
    assert.equal(avis.length, 2, JSON.stringify(avis))
    for (const marque of ['$l.map(', '@cle =']) assert.ok(avis.some((a) => a.includes(`ligne ${ligne(LISTES, marque)} :`) && a.includes('qui tient une partie de `$l`')), `${marque} : ${JSON.stringify(avis)}`)
  })

  it('clé qui agit (affectation composée, `++`, `||=`, clé à effet), liste d\'un élément de boucle, gestionnaire qui attend : avertis, sortie lisible', () => {
    const { sortie, avis } = r['avertis-sans']
    assert.doesNotThrow(() => acorn.parse(sortie.replace(/µ\.asset\(('[^']+')\)/g, '$1'), { ecmaVersion: 'latest', sourceType: 'module' }), 'sortie lisible en JavaScript')
    for (const marque of ['@a =', '@b =', '@c =', '$l.reverse()', 'row.cells.filter(', 'await µafter']) assert.ok(avis.some((a) => a.includes(`ligne ${ligne(AVERTIS, marque)} :`)), `${marque} non signalé : ${JSON.stringify(avis)}`)
    assert.equal(avis.length, 6, JSON.stringify(avis))
    assert.ok(!/"t", (?:_mjs_k1|k\+\+|\(\$\.l)/.test(sortie) && !sortie.includes('_mjs_rj_'), 'rien de compilé sous une garde')
  })

  it('liaison à deux sens : l\'objet revenu de l\'enfant passe à µ._set, qui juge l\'écho par son époque', () => {
    assert.ok(r['liaison-sans'].sortie.includes('return µ._set(_mjsThis, \'rows\', _mjs_e.data)') && !r['liaison-sans'].sortie.includes('Object.is($.rows, _mjs_e.data)'), 'sans le réglage de garde')
    assert.ok(r['liaison-defaut'].sortie.includes('if (!Object.is($.rows, _mjs_e.data)) { return µ._set(_mjsThis, \'rows\', _mjs_e.data) }'), 'avec l\'enveloppe : la garde reste')
    assert.ok(r['liaison-sans'].sortie.includes("(_mjs_node._state['items'] !== $.rows || typeof $.rows === 'object')"), 'sans le réglage de garde : l\'objet reposé à l\'enfant même tel quel')
    assert.ok(r['liaison-defaut'].sortie.includes("if (_mjs_node._state && _mjs_node._state['items'] !== $.rows) _mjs_node._set('items', $.rows)"), 'avec l\'enveloppe : reposé s\'il change')
  })

  it('sans le réglage : aucun avertissement, écritures telles qu\'écrites', () => {
    for (const nom of ['transitions', 'listes', 'liaison', 'avertis']) assert.deepEqual(r[nom + '-defaut'].avis, [], nom)
    const s = r['listes-defaut'].sortie
    assert.ok(s.includes('$.l.forEach((x) => { x.n++ || g(); })') && s.includes('$.l.forEach((x) => { x.t[k++] = 1; })') && !s.includes('_mjs_rj_'), 'formes telles qu\'écrites')
  })
})
