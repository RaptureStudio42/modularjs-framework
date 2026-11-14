// clés `by` (et clés d'une Map sans `by`) : une clé garde son type, comme chez Svelte et Vue — un nombre reste un nombre, un texte reste
// un texte, sans conversion par ligne à chaque rendu ; `1` et `'1'` sont donc deux clés, deux lignes. En développement, une même liste
// qui voit deux clés de types différents qui s'écrivent pareil (`1` et `'1'`, `true` et `'true'`, `1n` et `1` ; dans un rendu, ou d'un
// rendu au suivant : la ligne serait refaite au lieu d'être déplacée) le dit une fois par liste, en demandant le même type pour toutes
// ses clés ; des types mêlés qui ne s'écrivent jamais pareil ne disent rien. Une clé numérique déplace toujours sa ligne

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const stripEsm = (s: string) => s
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
  .replace(/\bexport\s+default\s+/g, '')
  .replace(/\bexport\s+/g, '')
  .replace(/import\.meta\.url/g, "'http://localhost/'")

const LISTES = [
  '<script lang="js">',
  '  $a = [];',
  '  $b = [];',
  '  $m = new Map();',
  '  $c = [];',
  '  $d = [];',
  '  $e = [];',
  '  @poserA = function(x) { $a = x; };',
  '  @poserB = function(x) { $b = x; };',
  '  @poserM = function(x) { $m = x; };',
  '  @poserC = function(x) { $c = x; };',
  '  @poserD = function(x) { $d = x; };',
  '  @poserE = function(x) { $e = x; };',
  '</script>',
  '<ul class="a">',
  '  {for i, row in $a by id}',
  '    <li>{row.id}:{row.label}:{i}</li>',
  '  {end}',
  '</ul>',
  '<ul class="b">',
  '  {for row in $b by id}',
  '    <li>{row.label}</li>',
  '  {end}',
  '</ul>',
  '<ul class="m">',
  '  {for i, p in $m}',
  '    <li>{p[1]}</li>',
  '  {end}',
  '</ul>',
  ...['c', 'd', 'e'].map((l) => `<ul class="${l}">{for row in $${l} by id}<li>{row.label}</li>{end}</ul>`)
].join('\n')

const tic = async () => { await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)) }

describe('{for … by} — une clé garde son type (nombre ou texte)', function () {
  this.timeout(60000)
  let win: any, el: any
  const avis: string[] = []

  before(async () => {
    const root = mjsTmp('for-cles-type')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'cles.mjs'), LISTES)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    win = new Window({ url: 'http://localhost/' })
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const coeur = files.find((f) => /^mjs_core-/.test(f))!
    const code = files.filter((f) => f !== coeur).reduce((acc, f) => acc + '\n' + stripEsm(readFileSync(join(outDir, f), 'utf-8')), stripEsm(readFileSync(join(outDir, coeur), 'utf-8')))
    win.eval(`${code}\nglobalThis.µ = µ;`)
    win.console.warn = (...a: any[]) => { avis.push(a.map(String).join(' ')) }
    win.document.body.innerHTML = '<mjs-cles></mjs-cles>'
    el = win.document.body.firstElementChild
    await tic()
  })
  after(async () => { win?.close?.(); await terminateSharedWorkerPool() })

  const racine = () => el._shadow || el.shadowRoot
  const textes = (ul: string) => Array.from(racine().querySelectorAll(`ul.${ul} li`)).map((li: any) => li.textContent)
  const typesMeles = () => avis.filter((a) => /sous deux types|as two types/i.test(a))
  const doublons = () => avis.filter((a) => /clés dupliquées|duplicate keys/i.test(a))

  it('`1` et `\'1\'` sont deux clés : deux lignes, aucun doublon écarté', async () => {
    el.poserA([{ id: 1, label: 'n' }, { id: '1', label: 't' }, { id: 2, label: 'x' }])
    await tic()
    assert.deepEqual(textes('a'), ['1:n:0', '1:t:1', '2:x:2'])
    assert.equal(doublons().length, 0, 'aucun avertissement de doublon : ' + doublons().join(' / '))
  })

  it('développement : la même clé en nombre et en texte dans un rendu est dite une fois, avec le remède', async () => {
    assert.equal(typesMeles().length, 1, 'un avertissement : ' + avis.join(' / '))
    assert.match(typesMeles()[0], /même type|same type/)
    assert.match(typesMeles()[0], /1 et '1'|1 and '1'/, 'les deux écritures de la clé')
    el.poserA([{ id: '1', label: 't' }, { id: 1, label: 'n' }])
    await tic()
    assert.equal(typesMeles().length, 1, 'une fois par liste')
  })

  it('développement : la même clé en nombre puis en texte, d\'un rendu au suivant, est dite aussi', async () => {
    el.poserB([{ id: 7, label: 'sept' }, { id: 8, label: 'huit' }])
    await tic()
    assert.equal(typesMeles().length, 1, 'rien encore pour la seconde liste')
    el.poserB([{ id: '7', label: 'sept' }, { id: '8', label: 'huit' }])
    await tic()
    assert.deepEqual(textes('b'), ['sept', 'huit'])
    assert.equal(typesMeles().length, 2, 'la seconde liste le dit : ' + avis.join(' / '))
  })

  it('une Map sans `by` garde ses clés telles quelles : 1 et \'1\' font deux lignes', async () => {
    el.poserM(new win.Map([[1, 'un'], ['1', 'texte un'], [2, 'deux']]))
    await tic()
    assert.deepEqual(textes('m'), ['un', 'texte un', 'deux'])
  })

  it('clés numériques : la ligne est déplacée, pas refaite', async () => {
    el.poserA([{ id: 10, label: 'a' }, { id: 11, label: 'b' }, { id: 12, label: 'c' }])
    await tic()
    const avant = Array.from(racine().querySelectorAll('ul.a li'))
    el.poserA([{ id: 12, label: 'c' }, { id: 10, label: 'a' }, { id: 11, label: 'b' }])
    await tic()
    const apres = Array.from(racine().querySelectorAll('ul.a li'))
    assert.deepEqual(textes('a'), ['12:c:0', '10:a:1', '11:b:2'])
    assert.ok(apres[0] === avant[2] && apres[1] === avant[0] && apres[2] === avant[1], 'les mêmes balises, déplacées')
  })

  it('développement : `true` et `\'true\'` (deux clés, deux lignes) sont dits aussi', async () => {
    const avant = typesMeles().length
    el.poserC([{ id: true, label: 'vrai' }, { id: 'true', label: 'texte' }])
    await tic()
    assert.deepEqual(textes('c'), ['vrai', 'texte'])
    assert.equal(typesMeles().length, avant + 1, 'un avertissement : ' + avis.join(' / '))
    assert.match(typesMeles()[avant], /true et 'true'|true and 'true'/)
  })

  it('développement : `1n` et `1` (deux clés, deux lignes) sont dits aussi', async () => {
    const avant = typesMeles().length
    el.poserD([{ id: 1n, label: 'grand' }, { id: 1, label: 'nombre' }])
    await tic()
    assert.deepEqual(textes('d'), ['grand', 'nombre'])
    assert.equal(typesMeles().length, avant + 1, 'un avertissement : ' + avis.join(' / '))
    assert.match(typesMeles()[avant], /1n et 1|1n and 1/)
  })

  it('développement : des types mêlés qui ne s\'écrivent jamais pareil ne disent rien', async () => {
    const avant = typesMeles().length
    el.poserE([{ id: 1, label: 'a' }, { id: 'x', label: 'b' }, { id: false, label: 'c' }, { id: 2n, label: 'd' }])
    await tic()
    assert.deepEqual(textes('e'), ['a', 'b', 'c', 'd'])
    el.poserE([{ id: 'y', label: 'e' }, { id: 3, label: 'f' }])
    await tic()
    assert.equal(typesMeles().length, avant, 'aucun avertissement : ' + avis.join(' / '))
  })
})
