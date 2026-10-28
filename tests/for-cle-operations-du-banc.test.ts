// {for … by id} : chaque opération du banc des cadres (créer, remplacer, ajouter, mettre à jour une ligne sur trois, échanger, supprimer, vider)
// et leurs voisines (bloc retiré ou inséré au milieu, ligne déplacée, inversion, mélange, remplacement au-delà de la réserve de lignes, clés en
// double) laissent la liste juste : lignes dans l'ordre des données, textes à jour, une ligne gardée garde son nœud, et un clic sur une ligne
// décalée agit sur son propre élément. Vérifié sur une liste µraw (lignes sautées quand rien n'a changé) et sur une liste suivie

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

// la ligne du banc : classe filtrée par valeur, deux gestionnaires qui lisent l'élément de la ligne
const corps = (brut: boolean) => [
  '<script lang="js">',
  '  function _sansLigne(src, idx) {',
  '    const out = [];',
  '    for (let k = 0; k < src.length; k++) if (k !== idx) out.push(src[k]);',
  `    return ${brut ? 'µ.raw(out)' : 'out'};`,
  '  }',
  `  $data = ${brut ? 'µ.raw([])' : '[]'};`,
  '  $selected = -1;',
  '  @poser = function(a) { $data = a; };',
  '  @select = function(id) { $selected = id; };',
  '  @remove = function(id) {',
  '    let idx = -1;',
  '    for (let k = 0; k < $data.length; k++) { if ($data[k].id === id) { idx = k; break; } }',
  '    if (idx !== -1) $data = _sansLigne($data, idx);',
  '  };',
  '</script>',
  '<table><tbody>',
  '  {for row in $data by id}',
  '    <tr @class{$selected === row.id}="danger">',
  '      <td class="id">{row.id}</td>',
  '      <td class="lab"><a class="sel" @click={@select(row.id)}>{row.label}</a></td>',
  '      <td><a class="del" @click={@remove(row.id)}>x</a></td>',
  '    </tr>',
  '  {end}',
  '</tbody></table>'
].join('\n')

async function construire(): Promise<string> {
  const root = mjsTmp('for-banc')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'bancbrut.mjs'), corps(true))
  writeFileSync(join(srcDir, 'bancsuivi.mjs'), corps(false))
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return outDir
}

function monter(outDir: string, tag: string) {
  const win: any = new Window({ url: 'http://localhost/' })
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const coeur = files.find((f) => /^mjs_core-/.test(f))!
  const code = files.filter((f) => f !== coeur).reduce((acc, f) => acc + '\n' + stripEsm(readFileSync(join(outDir, f), 'utf-8')), stripEsm(readFileSync(join(outDir, coeur), 'utf-8')))
  win.eval(`${code}\nglobalThis.µ = µ;`)
  win.document.body.innerHTML = `<${tag}></${tag}>`
  return { win, el: win.document.body.firstElementChild }
}

const tic = async () => { await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)) }

describe('{for … by id} — opérations du banc : liste juste, nœuds gardés, clics sur la bonne ligne', function () {
  this.timeout(60000)
  let outDir = ''
  before(async () => { outDir = await construire() })
  after(async () => { await terminateSharedWorkerPool() })

  for (const brut of [true, false]) {
    it(`liste ${brut ? 'µraw' : 'suivie'} : toutes les opérations, dans l'ordre du banc et au-delà`, async () => {
      const { win, el } = monter(outDir, brut ? 'mjs-bancbrut' : 'mjs-bancsuivi')
      await tic()
      const ombre = el._shadow || el.shadowRoot
      const µ = win.µ
      const enveloppe = (a: any[]) => brut ? µ.raw(a.map((o) => µ.raw(o))) : a
      let donnees: any[] = []
      const poser = async (a: any[]) => { donnees = a; el.poser(enveloppe(a)); await tic() }
      const ligne = (id: number, label?: string) => ({ id, label: label ?? 'L' + id })
      const lignes = () => Array.from(ombre.querySelectorAll('tbody > tr')) as any[]
      let noeuds = new Map<number, any>()
      const verifier = (quoi: string) => {
        const trs = lignes()
        assert.deepEqual(trs.map((tr) => +tr.querySelector('.id').textContent), donnees.map((d) => d.id), quoi + ' : ordre des lignes')
        assert.deepEqual(trs.map((tr) => tr.querySelector('.sel').textContent), donnees.map((d) => d.label), quoi + ' : textes')
        const neufs = new Map<number, any>()
        trs.forEach((tr, i) => {
          const id = donnees[i].id
          if (noeuds.has(id)) assert.ok(noeuds.get(id) === tr, quoi + ' : la ligne ' + id + ' garde son nœud')
          neufs.set(id, tr)
        })
        noeuds = neufs
      }
      const cliquer = async (tr: any, cls: string) => { tr.querySelector('.' + cls).dispatchEvent(new win.Event('click', { bubbles: true })); await tic() }
      const ids = (a: number, b: number) => { const r: any[] = []; for (let i = a; i <= b; i++) r.push(ligne(i)); return r }

      await poser(ids(1, 12)); verifier('créer')
      await poser(donnees.map((d, i) => i % 3 === 0 ? ligne(d.id, d.label + ' !!!') : d)); verifier('mettre à jour une ligne sur trois')
      let a = donnees.slice(); [a[1], a[10]] = [a[10], a[1]]; await poser(a); verifier('échanger deux lignes éloignées')
      a = donnees.slice(); [a[4], a[5]] = [a[5], a[4]]; await poser(a); verifier('échanger deux lignes voisines')
      a = donnees.slice(); a.splice(6, 1); await poser(a); verifier('supprimer une ligne au milieu')
      // la ligne qui a pris la place de la supprimée, et celle qui suit : le clic lit leur propre élément
      await cliquer(lignes()[6], 'sel')
      assert.equal(lignes().filter((tr) => tr.className.includes('danger')).map((tr) => +tr.querySelector('.id').textContent).join(), String(donnees[6].id), 'sélection sur la ligne décalée')
      const vise = donnees[7].id
      await cliquer(lignes()[7], 'del')
      donnees = donnees.filter((d) => d.id !== vise); verifier('suppression par clic sur une ligne décalée')
      a = donnees.slice(); a.shift(); await poser(a); verifier('supprimer la première ligne')
      a = donnees.slice(); a.pop(); await poser(a); verifier('supprimer la dernière ligne')
      a = donnees.slice(); a.splice(2, 3); await poser(a); verifier('supprimer un bloc')
      a = donnees.slice(); a.splice(2, 0, ligne(101), ligne(102), ligne(103)); await poser(a); verifier('insérer un bloc au milieu')
      a = donnees.slice(); a.unshift(ligne(104)); await poser(a); verifier('insérer en tête')
      await poser(donnees.concat(ids(201, 205))); verifier('ajouter en fin')
      a = donnees.slice(); a.splice(8, 0, a.splice(2, 1)[0]); await poser(a); verifier('déplacer une ligne vers le bas')
      a = donnees.slice(); a.splice(1, 0, a.splice(9, 1)[0]); await poser(a); verifier('déplacer une ligne vers le haut')
      a = donnees.slice(); a.unshift(a.pop()); await poser(a); verifier('la dernière ligne passe en tête')
      a = donnees.slice(); a.push(a.shift()); await poser(a); verifier('la première ligne passe en queue')
      a = donnees.slice(); [a[0], a[a.length - 1]] = [a[a.length - 1], a[0]]; await poser(a); verifier('échanger la première et la dernière')
      await poser(donnees.slice().reverse()); verifier('inverser')
      a = donnees.slice(); a.splice(3, 2); a.splice(1, 0, ligne(301), ligne(302)); [a[5], a[7]] = [a[7], a[5]]; await poser(a); verifier('mélange (retraits, ajouts, échange)')
      await cliquer(lignes()[3], 'sel')
      assert.equal(lignes().filter((tr) => tr.className.includes('danger')).map((tr) => +tr.querySelector('.id').textContent).join(), String(donnees[3].id), 'sélection après le mélange')
      await poser(ids(1001, 1300)); verifier('remplacer tout (300 lignes, au-delà de la réserve)')
      await poser(ids(2001, 2300)); verifier('remplacer tout encore')
      await poser(donnees.slice(0, 150).concat(ids(3001, 3010), donnees.slice(150))); verifier('insérer un bloc dans une longue liste')
      await poser([]); verifier('vider')
      assert.equal(lignes().length, 0, 'plus aucune ligne')
      await poser(ids(1, 10)); verifier('créer après le vidage')
      await poser(ids(11, 20)); verifier('remplacer tout (dix lignes)')
      await poser([]); verifier('vider encore')
      win.close?.()
    })
  }

  it('clés en double : la première occurrence seule, un avertissement, et la liste se remet d\'aplomb', async () => {
    const { win, el } = monter(outDir, 'mjs-bancbrut')
    await tic()
    const ombre = el._shadow || el.shadowRoot
    const µ = win.µ
    const avis: string[] = []
    const warn0 = µ.warn
    µ.warn = (...x: any[]) => { avis.push(x.join(' ')) }
    const poser = async (ids: number[]) => { el.poser(µ.raw(ids.map((id) => µ.raw({ id, label: 'L' + id })))); await tic() }
    const vus = () => Array.from(ombre.querySelectorAll('tbody > tr .id')).map((n: any) => +n.textContent)
    await poser([1, 2, 3, 4])
    await poser([1, 2, 3, 4, 2, 5])
    assert.deepEqual(vus(), [1, 2, 3, 4, 5], 'ajout en fin avec une clé déjà là : la première occurrence seule')
    await poser([1, 2, 3, 4, 5, 6, 6])
    assert.deepEqual(vus(), [1, 2, 3, 4, 5, 6], 'deux clés neuves égales : une seule ligne')
    await poser([7, 8, 7, 9])
    assert.deepEqual(vus(), [7, 8, 9], 'remplacement total avec un doublon')
    await poser([7, 8, 9])
    assert.deepEqual(vus(), [7, 8, 9], 'doublon retiré')
    assert.ok(avis.length >= 1, 'les clés en double sont signalées')
    µ.warn = warn0
    win.close?.()
  })
})
