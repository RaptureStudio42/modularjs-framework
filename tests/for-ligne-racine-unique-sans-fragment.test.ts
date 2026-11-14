// gabarit de ligne `{for}` à racine unique : l'élément est cloné seul, sans fragment autour (un nœud de moins par ligne, que la ligne
// n'a plus à quitter à son insertion) ; une ligne à plusieurs racines, un texte ou un marqueur en tête, et tout autre bloc gardent le
// fragment. La liste reste juste : création, ajout, échange, suppression, clic, vidage puis lignes reprises de la réserve

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { generateCreateFnBody } from '../src/generator/paths.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const stripEsm = (s: string) => s
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
  .replace(/\bexport\s+default\s+/g, '')
  .replace(/\bexport\s+/g, '')
  .replace(/import\.meta\.url/g, "'http://localhost/'")

const corps = [
  '<script lang="js">',
  '  $rows = [];',
  '  $picked = 0;',
  '  @put = function(a) { $rows = a; };',
  '  @pick = function(id) { $picked = id; };',
  '</script>',
  '<table><tbody>',
  '  {for row in $rows by id}',
  '    <tr><td class="id">{row.id}</td><td><a class="sel" @click={@pick(row.id)}>{row.label}</a></td></tr>',
  '  {end}',
  '</tbody></table>',
  '<dl>',
  '  {for row in $rows by id}',
  '    <dt>{row.id}</dt><dd>{row.label}</dd>',
  '  {end}',
  '</dl>'
].join('\n')

async function construire(): Promise<string> {
  const root = mjsTmp('for-racine-unique')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'racine.mjs'), corps)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return outDir
}

function monter(outDir: string) {
  const win: any = new Window({ url: 'http://localhost/' })
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const coeur = files.find((f) => /^mjs_core-/.test(f))!
  const code = files.filter((f) => f !== coeur).reduce((acc, f) => acc + '\n' + stripEsm(readFileSync(join(outDir, f), 'utf-8')), stripEsm(readFileSync(join(outDir, coeur), 'utf-8')))
  win.eval(`${code}\nglobalThis.µ = µ;`)
  win.document.body.innerHTML = '<mjs-racine></mjs-racine>'
  return { win, el: win.document.body.firstElementChild }
}

const tic = async () => { await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)) }

describe('{for} — ligne à racine unique clonée sans fragment', function () {
  this.timeout(60000)

  describe('gabarit compilé', () => {
    it('une racine, un élément : µ._mjs_cloneEl, chemins comptés depuis l\'élément', () => {
      const r = generateCreateFnBody("<tr mjs-id='r1'><td>x</td><td><a mjs-id='a1'>y</a></td></tr>", { forceClone: true, singleRoot: true })
      assert.ok(r.body.includes('µ._mjs_cloneEl("<tr><td>x</td><td><a>y</a></td></tr>")'), r.body)
      assert.ok(!r.body.includes('_mjs_cloneTpl'), r.body)
      assert.ok(r.body.includes('_mjs_refs["r1"] = _mjs_fr;'), 'la racine est l\'élément cloné lui-même : ' + r.body)
      assert.ok(r.body.includes('_mjs_refs["a1"] = _mjs_fr.firstChild.nextSibling.firstChild;'), 'chemins comptés depuis l\'élément : ' + r.body)
      const avant = generateCreateFnBody("<tr mjs-id='r1'><td>x</td><td><a mjs-id='a1'>y</a></td></tr>", { forceClone: true })
      assert.ok(avant.body.includes('const _mjs_p0 = _mjs_fr.firstChild;'), 'sans la demande, le fragment et son premier rang : ' + avant.body)
    })

    it('plusieurs racines, un texte en tête, ou sans demande : le fragment, comme avant', () => {
      for (const html of ['<dt> </dt><dd> </dd>', 'texte <b>gras</b>', '<!--$--><b> </b>']) {
        const r = generateCreateFnBody(html, { forceClone: true, singleRoot: true })
        assert.ok(r.body.includes('µ._mjs_cloneTpl('), html + ' : ' + r.body)
        assert.ok(!r.body.includes('_mjs_cloneEl'), html + ' : ' + r.body)
      }
      const seul = generateCreateFnBody('<li> </li>', { forceClone: true })
      assert.ok(seul.body.includes('µ._mjs_cloneTpl("<li> </li>")'), 'autre bloc qu\'une ligne : ' + seul.body)
    })
  })

  describe('liste rendue', () => {
    let outDir = ''
    before(async () => { outDir = await construire() })
    after(async () => { await terminateSharedWorkerPool() })

    it('création, ajout, échange, suppression, clic, vidage puis recréation', async () => {
      const { win, el } = monter(outDir)
      await tic()
      const ombre = el._shadow || el.shadowRoot
      const ligne = (id: number) => ({ id, label: 'L' + id })
      const ids = (a: number, b: number) => { const r: any[] = []; for (let i = a; i <= b; i++) r.push(ligne(i)); return r }
      let donnees: any[] = []
      const poser = async (a: any[]) => { donnees = a; el.put(a); await tic() }
      const verifier = (quoi: string) => {
        const trs = Array.from(ombre.querySelectorAll('tbody > tr')) as any[]
        assert.deepEqual(trs.map((tr) => tr.querySelector('.id').textContent + '/' + tr.querySelector('.sel').textContent), donnees.map((d) => d.id + '/' + d.label), quoi + ' : lignes à racine unique')
        assert.deepEqual(Array.from(ombre.querySelector('dl').children).map((n: any) => n.textContent), donnees.flatMap((d) => [String(d.id), d.label]), quoi + ' : lignes à deux racines')
        assert.equal(ombre.querySelector('tbody').querySelectorAll('tr').length, donnees.length, quoi + ' : aucune ligne en trop')
      }
      await poser(ids(1, 6)); verifier('créer')
      const trs0 = Array.from(ombre.querySelectorAll('tbody > tr')) as any[]
      await poser([...donnees, ...ids(7, 9)]); verifier('ajouter')
      assert.ok(trs0.every((tr, i) => ombre.querySelectorAll('tbody > tr')[i] === tr), 'les lignes gardées gardent leur nœud')
      let a = donnees.slice(); [a[1], a[7]] = [a[7], a[1]]; await poser(a); verifier('échanger')
      a = donnees.slice(); a.splice(3, 2); await poser(a); verifier('supprimer')
      const tr = ombre.querySelectorAll('tbody > tr')[2]
      tr.querySelector('.sel').dispatchEvent(new win.Event('click', { bubbles: true }))
      await tic()
      assert.equal(el._state.picked, donnees[2].id, 'le clic agit sur sa propre ligne')
      await poser([]); verifier('vider')
      await poser(ids(20, 30)); verifier('recréer (lignes reprises de la réserve puis neuves)')
      await poser(ids(40, 42)); verifier('tout remplacer')
      win.close?.()
    })
  })
})
