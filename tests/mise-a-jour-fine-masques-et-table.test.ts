// mise à jour fine, côté compilateur : chaque liaison d'une ligne de `{for}` porte le masque des champs de l'élément qu'elle lit, et le
// composant porte la table `_mjs_fine` des variables lues champ par champ (`r` : listes, champ → masque ; `f` : champ → liaisons) — seulement
// quand un champ de la variable est écrit par un chemin compilé. Un lecteur que l'analyse ne suit pas (élément entier, valeur dérivée, reffet,
// prop d'enfant, appel, la liste lue dans sa ligne, `{if $data[0]}`, liste dans une autre liste) ôte la table : la variable garde le chemin
// ordinaire. Sans l'aiguillage du runtime, `__f` n'est jamais passé à la ligne : tout se rejoue comme avant

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { transpile } from '../src/transpiler/index.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const compiler = async (corps: string): Promise<string> => (await transpile(corps, { moduleName: 'Essai' })).output

// la table posée dans `init`, `_mjs_eff[i]` lu `e<i>` ; null sans table
function table(sortie: string): any {
  const m = /_mjsThis\._mjs_fine = (.*);\n/.exec(sortie)
  if (!m) return null
  return new Function('_mjs_eff', `return ${m[1]}`)(Array.from({ length: 200 }, (_, i) => `e${i}`))
}

// `__f` cité comme nom (`__fe`, l'index des classes, n'en est pas un)
const CITE_F = /(?<![\w$])__f(?![\w$])/

// les gardes des liaisons de la ligne, dans l'ordre : le masque, 0 pour `if (!__f)` ; null quand la ligne n'a pas de masques
function gardes(sortie: string): number[] | null {
  const m = /const _mjs_updFn = \(row, index(, __f)?\) => \{([^\n]*)\};\n/.exec(sortie)
  assert.ok(m, 'fermeture de ligne introuvable')
  if (!m[1]) {
    assert.ok(!CITE_F.test(m[2]), 'une ligne sans masques ne cite pas __f')
    return null
  }
  return [...m[2].matchAll(/if \(!__f(?: \|\| __f & (\d+))?\) \{/g)].map((g) => g[1] ? Number(g[1]) : 0)
}

const ligne = (script: string, corpsDeLigne: string, entete = '', cle = ' by id'): string => [
  '<script lang="js">',
  '  $data = [];',
  '  $selected = -1;',
  script,
  '</script>',
  entete,
  '<table><tbody>',
  `  {for row in $data${cle}}`,
  `    <tr>${corpsDeLigne}</tr>`,
  '  {end}',
  '</tbody></table>',
].join('\n')

const SUR_PLACE = '  @update = function() { for (let i = 0; i < $data.length; i += 10) $data[i].label += \' !!!\'; };'

describe('mise à jour fine — masques de ligne et table du composant (compilateur)', function () {
  this.timeout(30000)
  it('appli « sur place » : un bit par champ lu, `if (!__f)` pour l\'indice seul, la clé à -1', async () => {
    const sortie = await compiler(ligne(SUR_PLACE, '<td :class{$selected === row.id}="danger">{row.id}</td><td>{row.label}</td><td>{index}</td>'))
    // la classe (posée sur la première cellule, lue avant son texte) et le texte de `row.id` : bit 1 ; `row.label` : bit 2 ; l'indice : 0
    assert.deepEqual(gardes(sortie), [1, 1, 2, 0])
    const t = table(sortie)
    assert.deepEqual(Object.keys(t), ['data'])
    assert.equal(t.data.r.length, 1)
    assert.match(t.data.r[0][0], /^for\d+$/)
    assert.deepEqual(t.data.r[0][1], { id: -1, label: 2 })
    assert.equal(t.data.f, undefined)
    // la mise à jour ordinaire et la pose initiale n'ont jamais de masque : tout se rejoue
    assert.ok(sortie.includes('_mjs_updFn(row, index);'), 'pose initiale sans masque')
  })

  it('liste sans clé : pas de champ à -1', async () => {
    const sortie = await compiler(ligne(SUR_PLACE, '<td>{row.label}</td><td>{row.n + index}</td>', '', ''))
    assert.deepEqual(gardes(sortie), [1, 2])
    assert.deepEqual(table(sortie).data.r[0][1], { label: 1, n: 2 })
  })

  it('une liaison qui lit l\'élément entier ôte la table', async () => {
    for (const lu of ['{JSON.stringify(row)}', '{row[\'label\']}', '{row?.label}', '{row.fmt()}']) {
      const sortie = await compiler(ligne(SUR_PLACE, `<td>{row.id}</td><td>${lu}</td>`))
      assert.equal(gardes(sortie), null, lu)
      assert.equal(table(sortie), null, lu)
    }
  })

  it('table absente quand aucun champ n\'est écrit par un chemin compilé', async () => {
    const structure = '  @swap = function() { $data[1] = $data[2]; };\n  @remove = function(i) { $data.splice(i, 1); };\n  @update = function() { $data = $data.map((r) => ({ ...r, label: r.label + \' !\' })); };'
    const filet     = '  pick = function(l) { return l[0]; };\n  @update = function() { pick($data).label += \' !\'; };'
    for (const script of [structure, filet]) {
      const sortie = await compiler(ligne(script, '<td>{row.id}</td><td>{row.label}</td>'))
      assert.equal(gardes(sortie), null)
      assert.equal(table(sortie), null)
      assert.ok(!sortie.includes('_mjs_fine'))
    }
  })

  it('objet hors liste : chaque liaison rangée sous le champ qu\'elle lit', async () => {
    const sortie = await compiler([
      '<script lang="js">',
      '  $o = { f0: \'a\', f1: \'b\' };',
      '  @poke = function() { $o.f1 = \'z\'; };',
      '</script>',
      '<p>{$o.f0} {$o.f1} {$o.f0 + $o.f1}</p>',
    ].join('\n'))
    assert.deepEqual(table(sortie), { o: { f: { f0: ['e0', 'e2'], f1: ['e1', 'e2'] } } })
  })

  it('`{const}` de ligne : la liaison qui le lit porte les champs qu\'il lit', async () => {
    const sortie = await compiler(ligne(SUR_PLACE, '{const lib = row.label + \' !\'}<td>{lib}</td><td>{row.id}</td>'))
    assert.deepEqual(gardes(sortie), [1, 2])
    assert.deepEqual(table(sortie).data.r[0][1], { label: 1, id: -1 })
  })

  it('liste dans un bloc : masques et table', async () => {
    const sortie = await compiler(ligne(SUR_PLACE + '\n  $voir = true;', '<td>{row.label}</td>').replace('<table><tbody>', '{if $voir}<table><tbody>').replace('</tbody></table>', '</tbody></table>{end}'))
    assert.deepEqual(gardes(sortie), [1])
    assert.deepEqual(table(sortie).data.r[0][1], { label: 1, id: -1 })
  })

  it('gestionnaire de la ligne qui écrit l\'élément : chemin compilé, table posée', async () => {
    const sortie = await compiler(ligne('', '<td @click={row.label = \'x\'}>{row.label}</td>'))
    assert.deepEqual(gardes(sortie), [1])
    assert.deepEqual(table(sortie).data.r[0][1], { label: 1, id: -1 })
  })

  it('refus des lecteurs cachés : la variable garde le chemin ordinaire', async () => {
    const cas: [string, string, string, string][] = [
      // [nom, script en plus, gabarit en plus, corps de ligne]
      ['valeur dérivée', '  $nb = $data.length;', '<p>{$nb}</p>', '<td>{row.label}</td>'],
      ['reffet', '  µeffect(() => { console.log($data.length); });', '', '<td>{row.label}</td>'],
      ['la ligne lit sa liste', '', '', '<td>{row.label} / {$data.length}</td>'],
      ['{if $data[0]}', '', '{if $data[0]}<p>premier</p>{end}', '<td>{row.label}</td>'],
      ['appel non suivi dans la ligne', '  fmt = function(x) { return x; };', '', '<td>{fmt(row.label)}</td>'],
      ['méthode du composant dans la ligne', '  @fmt = function(x) { return x; };', '', '<td>{@fmt(row.label)}</td>'],
      ['prop d\'enfant dans la ligne', '', '', '<td><@fiche val={row.label}></@fiche></td>'],
    ]
    for (const [nom, script, entete, corps] of cas) {
      const sortie = await compiler(ligne(SUR_PLACE + '\n' + script, corps, entete))
      assert.equal(table(sortie), null, nom)
      assert.equal(gardes(sortie), null, nom)
    }
  })

  it('refus des lecteurs cachés d\'un objet : prop d\'enfant, appel non suivi, valeur dérivée, reffet', async () => {
    const cas: [string, string, string][] = [
      ['prop d\'enfant', '', '<@fiche val={$o.a}></@fiche>'],
      ['appel non suivi', '  fmt = function(x) { return x; };', '<p>{fmt($o.a)}</p>'],
      ['valeur dérivée', '  $double = $o.a * 2;', '<p>{$double}</p>'],
      ['reffet', '  µeffect(() => { console.log($o.a); });', ''],
      ['méthode de l\'objet', '', '<p>{$o.lire()}</p>'],
    ]
    for (const [nom, script, gabarit] of cas) {
      const sortie = await compiler(['<script lang="js">', '  $o = { a: 1, lire() { return 1; } };', '  @poke = function() { $o.a = 2; };', script, '</script>', `<p>{$o.a}</p>${gabarit}`].join('\n'))
      assert.equal(table(sortie), null, nom)
    }
  })

  it('liste dans une autre liste : refus explicite, aucune table', async () => {
    const sortie = await compiler([
      '<script lang="js">',
      '  $groupes = [1, 2];',
      '  $data = [];',
      SUR_PLACE,
      '</script>',
      '{for g in $groupes}',
      '  {for row in $data by id}<p>{row.label}</p>{end}',
      '{end}',
    ].join('\n'))
    assert.ok(!CITE_F.test(sortie))
    assert.equal(table(sortie), null)
  })
})

const stripEsm = (s: string) => s
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
  .replace(/\bexport\s+default\s+/g, '')
  .replace(/\bexport\s+/g, '')
  .replace(/import\.meta\.url/g, "'http://localhost/'")

const tic = async () => { await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)) }

describe('mise à jour fine — masques justes à l\'exécution, sans aiguillage', function () {
  this.timeout(60000)
  let win: any, el: any, µ: any

  before(async () => {
    const root = mjsTmp('fine-masques')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'surplace.mjs'), [
      '<script lang="js">',
      '  $data = [];',
      '  @poser = function(a) { $data = a; };',
      '  @update = function() { for (let i = 0; i < $data.length; i++) $data[i].label += \' !\'; };',
      '</script>',
      '<table><tbody>',
      '  {for row in $data by id}',
      '    <tr><td class="id">{row.id}</td><td class="lab">{row.label}</td><td class="n">{row.n}</td><td class="i">{index}</td></tr>',
      '  {end}',
      '</tbody></table>',
    ].join('\n'))
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    win = new Window({ url: 'http://localhost/' })
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const coeur = files.find((f) => /^mjs_core-/.test(f))!
    const code = files.filter((f) => f !== coeur).reduce((acc, f) => acc + '\n' + stripEsm(readFileSync(join(outDir, f), 'utf-8')), stripEsm(readFileSync(join(outDir, coeur), 'utf-8')))
    win.eval(`${code}\nglobalThis.µ = µ;`)
    win.document.body.innerHTML = '<mjs-surplace></mjs-surplace>'
    el = win.document.body.firstElementChild
    µ = win.µ
    await tic()
  })
  after(async () => { win?.close?.(); await terminateSharedWorkerPool() })

  const cellules = (cls: string) => Array.from((el._shadow || el.shadowRoot).querySelectorAll(`td.${cls}`)).map((x: any) => x.textContent)

  it('la ligne rappelée avec le masque d\'un champ ne rejoue que ses liaisons ; sans masque, toutes ; l\'écriture compilée passe comme avant', async () => {
    el.poser([{ id: 1, label: 'a', n: 10 }, { id: 2, label: 'b', n: 20 }])
    await tic()
    const cid = Object.keys(el._mjs_list_cache)[0]
    assert.deepEqual(JSON.parse(JSON.stringify(el._mjs_fine)), { data: { r: [[cid, { id: -1, label: 2, n: 4 }]] } })
    const en  = [...el._mjs_list_cache[cid].values()].find((x: any) => x._mjs_it.id === 1)
    const brut = µ._mjs_toRaw(en._mjs_it)
    // changé hors de MJS : seule la ligne rappelée à la main le montre
    brut.label = 'A'
    brut.n     = 11
    en._mjs_updFn(en._mjs_it, en._mjs_ix, 2)
    assert.deepEqual(cellules('lab'), ['A', 'b'])
    assert.deepEqual(cellules('n'), ['10', '20'])
    en._mjs_updFn(en._mjs_it, en._mjs_ix, 4)
    assert.deepEqual(cellules('n'), ['11', '20'])
    brut.label = 'AA'
    en._mjs_updFn(en._mjs_it, en._mjs_ix)
    assert.deepEqual(cellules('lab'), ['AA', 'b'])
    // l'écriture compilée (`µ._mjs_deepSet`) : le runtime ne passe aucun masque, toute la liste se rejoue, comme avant
    el.update()
    await tic()
    assert.deepEqual(cellules('lab'), ['AA !', 'b !'])
    assert.deepEqual(cellules('i'), ['0', '1'])
  })
})
