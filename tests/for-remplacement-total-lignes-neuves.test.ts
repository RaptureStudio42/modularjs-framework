// {for … by id} : une liste dont toutes les clés changent (remplacement total) donne à chaque clé neuve sa ligne neuve, faite par le
// gabarit : une donnée garde ses propres nœuds, aucune ancienne ligne n'est reprise pour une autre donnée, quel que soit leur nombre, et
// les anciennes lignes quittent la page. La ligne neuve affiche sa donnée et ses gestionnaires suivent sa clé ; un `<details>` ouvert ne
// passe pas à une clé neuve ; un champ tapé reste dans sa ligne, une clé neuve a un champ neuf à sa valeur de gabarit

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

const TABLE = [
  '<script lang="js">',
  '  $data = µ.raw([]);',
  '  $selected = -1;',
  '  @poser = function(a) { $data = a; };',
  '  @select = function(id) { $selected = id; };',
  '</script>',
  '<table><tbody>',
  '  {for row in $data by id}',
  '    <tr :class{$selected === row.id}="danger">',
  '      <td class="id">{row.id}</td>',
  '      <td class="lab"><a class="sel" @click={@select(row.id)}>{row.label}</a></td>',
  '    </tr>',
  '  {end}',
  '</tbody></table>'
].join('\n')

const DETAILS = [
  '<script lang="js">',
  '  $data = µ.raw([]);',
  '  @poser = function(a) { $data = a; };',
  '</script>',
  '<ul>',
  '  {for row in $data by id}',
  '    <li><details><summary>{row.label}</summary>texte</details></li>',
  '  {end}',
  '</ul>'
].join('\n')

const CHAMP = [
  '<script lang="js">',
  '  $data = µ.raw([]);',
  '  @poser = function(a) { $data = a; };',
  '</script>',
  '<ul>',
  '  {for row in $data by id}',
  '    <li><input class="champ" aria-label="champ" value="gabarit"><span>{row.label}</span></li>',
  '  {end}',
  '</ul>'
].join('\n')

const tic = async () => { await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)) }

describe('{for … by id} — le remplacement total donne à chaque clé neuve sa ligne neuve', function () {
  this.timeout(60000)
  let win: any, µ: any
  const els: any = {}

  before(async () => {
    const root = mjsTmp('for-remplacement-total')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'remptable.mjs'), TABLE)
    writeFileSync(join(srcDir, 'rempdetails.mjs'), DETAILS)
    writeFileSync(join(srcDir, 'rempchamp.mjs'), CHAMP)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    win = new Window({ url: 'http://localhost/' })
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const coeur = files.find((f) => /^mjs_core-/.test(f))!
    const code = files.filter((f) => f !== coeur).reduce((acc, f) => acc + '\n' + stripEsm(readFileSync(join(outDir, f), 'utf-8')), stripEsm(readFileSync(join(outDir, coeur), 'utf-8')))
    win.eval(`${code}\nglobalThis.µ = µ;`)
    win.document.body.innerHTML = '<mjs-remptable></mjs-remptable><mjs-rempdetails></mjs-rempdetails><mjs-rempchamp></mjs-rempchamp>'
    for (const el of win.document.body.children) els[el.localName.slice(4)] = el
    µ = win.µ
    await tic()
  })
  after(async () => { win?.close?.(); await terminateSharedWorkerPool() })

  const ombre = (el: any) => el._shadow || el.shadowRoot
  const ligne = (id: number) => µ.raw({ id, label: 'L' + id })
  const ids = (a: number, b: number) => { const r: any[] = []; for (let i = a; i <= b; i++) r.push(ligne(i)); return r }
  const poser = async (el: any, a: any[]) => { el.poser(µ.raw(a)); await tic() }

  it('remplacer 300 lignes par 300 clés neuves : aucune ancienne ligne n\'est reprise, chaque clé neuve a sa ligne neuve', async () => {
    const el = els.remptable
    await poser(el, ids(1, 300))
    const avant = new Set(ombre(el).querySelectorAll('tbody > tr'))
    assert.equal(avant.size, 300, 'lignes de départ')
    await poser(el, ids(1001, 1300))
    const apres = Array.from(ombre(el).querySelectorAll('tbody > tr'))
    assert.equal(apres.length, 300)
    const reprises = apres.filter((tr: any) => avant.has(tr)).length
    assert.equal(reprises, 0, 'lignes reprises : ' + reprises + ' sur 300')
    assert.equal([...avant].filter((tr: any) => tr.isConnected).length, 0, 'anciennes lignes encore dans la page')
    assert.deepEqual(apres.map((tr: any) => +tr.querySelector('.id').textContent), ids(1001, 1300).map((d) => d.id), 'ordre et identifiants')
    assert.deepEqual(apres.map((tr: any) => tr.querySelector('.sel').textContent), ids(1001, 1300).map((d) => d.label), 'libellés')
  })

  it('une ligne neuve suit sa clé : un clic la sélectionne, elle seule', async () => {
    const el = els.remptable
    const trs = Array.from(ombre(el).querySelectorAll('tbody > tr')) as any[]
    trs[4].querySelector('.sel').click()
    await tic()
    const dangers = trs.filter((tr) => tr.classList.contains('danger'))
    assert.equal(dangers.length, 1, 'une seule ligne sélectionnée')
    assert.ok(dangers[0] === trs[4], 'la ligne cliquée est la ligne sélectionnée')
    assert.equal(el._state.selected, 1005)
    // la sélection suit la clé au remplacement suivant : la clé 1005 a disparu, aucune ligne neuve ne porte la classe
    await poser(el, ids(2001, 2300))
    assert.equal(ombre(el).querySelectorAll('tbody > tr.danger').length, 0, 'aucune ligne sélectionnée après le remplacement')
  })

  it('une ligne à <details> ouvert n\'est jamais reprise pour une autre clé', async () => {
    const el = els.rempdetails
    await poser(el, ids(1, 5))
    const avant = Array.from(ombre(el).querySelectorAll('li')) as any[]
    assert.equal(avant.length, 5, 'lignes de départ')
    avant[0].querySelector('details').open = true
    await poser(el, ids(11, 15))
    const apres = Array.from(ombre(el).querySelectorAll('li')) as any[]
    assert.equal(apres.length, 5)
    assert.equal(apres.filter((li) => avant.includes(li)).length, 0, 'aucune ligne à <details> reprise')
    assert.equal(apres.filter((li) => li.querySelector('details').open).length, 0, 'aucun <details> ouvert hérité')
    assert.deepEqual(apres.map((li) => li.querySelector('summary').textContent), ['L11', 'L12', 'L13', 'L14', 'L15'])
  })

  it('un champ tapé reste dans sa ligne : chaque clé neuve a sa ligne neuve, au champ du gabarit', async () => {
    const el = els.rempchamp
    await poser(el, ids(1, 4))
    const avant = Array.from(ombre(el).querySelectorAll('li')) as any[]
    assert.equal(avant.length, 4, 'lignes de départ')
    avant[1].querySelector('.champ').value = 'saisi'
    await poser(el, ids(21, 24))
    const apres = Array.from(ombre(el).querySelectorAll('li')) as any[]
    assert.equal(apres.length, 4)
    assert.equal(apres.filter((li) => avant.includes(li)).length, 0, 'lignes à champ reprises')
    assert.equal(avant.filter((li) => li.isConnected).length, 0, 'anciennes lignes encore dans la page')
    assert.equal(avant[1].querySelector('.champ').value, 'saisi', 'le champ tapé garde sa saisie dans sa propre ligne')
    assert.deepEqual(apres.map((li) => li.querySelector('.champ').value), ['gabarit', 'gabarit', 'gabarit', 'gabarit'], 'champs neufs à la valeur du gabarit')
    assert.deepEqual(apres.map((li) => li.querySelector('span').textContent), ['L21', 'L22', 'L23', 'L24'])
  })
})
