// µinspect($x) : « From » montre la valeur de $x d'AVANT l'écriture, à toute profondeur — écriture directe, par un nom, par une
// méthode de liste ou de Map. Défaut garanti absent : dès deux niveaux sous la racine, la copie d'avant partageait ses objets avec
// l'état réel, que l'écriture change en place, et « From » montrait déjà la valeur d'après ; écrite par un nom, elle ne copiait que
// l'objet écrit. Chaque composant écrit deux fois et l'affichage se lit après la seconde : « From » et « To » restent ceux du moment

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterInspect } from './helpers/inspect-console.js'

const js = (etat: string, first: string, second: string, lu: string) => `<script lang="js">\n$o = ${etat};\nµinspect($o);\n@first = function() { ${first} };\n@second = function() { ${second} };\n</script>\n<p>{${lu}}</p>\n`

const SOURCES = {
  depth2:   js('{a: {b: 1}}', '$o.a.b = 2;', '$o.a.b = 3;', '$o.a.b'),
  depth3:   js('{a: {b: {c: 1}}}', '$o.a.b.c = 2;', '$o.a.b.c = 3;', '$o.a.b.c'),
  depth6:   js('{a: {b: {c: {d: {e: {f: 1}}}}}}', '$o.a.b.c.d.e.f = 2;', '$o.a.b.c.d.e.f = 3;', '$o.a.b.c.d.e.f'),
  byname:   js('{a: {b: 1}}', 'const t = $o.a; t.b = 2;', 'const t = $o.a; t.b = 3;', '$o.a.b'),
  listpush: js('{a: {l: [1, 2]}}', '$o.a.l.push(3);', '$o.a.l.push(4);', '$o.a.l.length'),
  mapset:   js("{a: {m: new Map([['x', 1]])}}", "$o.a.m.set('x', 2);", "$o.a.m.set('x', 3);", "$o.a.m.get('x')"),
}

const G = '🔍 [MJS Inspect] o'
const J = JSON.stringify
// deux écritures : de v1 à v2, puis de v2 à v3
const twice = (v1: unknown, v2: unknown, v3: unknown) => [G, 'From ' + J(v1), 'To ' + J(v2), G, 'From ' + J(v2), 'To ' + J(v3)]

describe('µinspect($x) — « From » est la valeur d\'avant l\'écriture, à toute profondeur', function () {
  this.timeout(60000)
  let page: any
  before(async () => { page = await monterInspect('inspect-from-profond', SOURCES) })
  after(async () => {
    page?.window.close()
    await terminateSharedWorkerPool()
  })

  it('écriture directe à deux, trois et six niveaux', async () => {
    assert.deepEqual(await page.jouer('depth2', 'first', 'second'), twice({ a: { b: 1 } }, { a: { b: 2 } }, { a: { b: 3 } }))
    assert.deepEqual(await page.jouer('depth3', 'first', 'second'), twice({ a: { b: { c: 1 } } }, { a: { b: { c: 2 } } }, { a: { b: { c: 3 } } }))
    assert.deepEqual(await page.jouer('depth6', 'first', 'second'), twice({ a: { b: { c: { d: { e: { f: 1 } } } } } }, { a: { b: { c: { d: { e: { f: 2 } } } } } }, { a: { b: { c: { d: { e: { f: 3 } } } } } }))
  })

  it('écriture par un nom : t = $o.a ; t.b = 2', async () => {
    assert.deepEqual(await page.jouer('byname', 'first', 'second'), twice({ a: { b: 1 } }, { a: { b: 2 } }, { a: { b: 3 } }))
  })

  it('méthode de liste : $o.a.l.push(3)', async () => {
    assert.deepEqual(await page.jouer('listpush', 'first', 'second'), twice({ a: { l: [1, 2] } }, { a: { l: [1, 2, 3] } }, { a: { l: [1, 2, 3, 4] } }))
  })

  it('méthode d\'une Map : $o.a.m.set(\'x\', 2)', async () => {
    assert.deepEqual(await page.jouer('mapset', 'first', 'second'), twice({ a: { m: { Map: [['x', 1]] } } }, { a: { m: { Map: [['x', 2]] } } }, { a: { m: { Map: [['x', 3]] } } }))
  })
})
