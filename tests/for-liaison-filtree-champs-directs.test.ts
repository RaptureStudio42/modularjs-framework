// liaison filtrée par valeur d'une ligne (`:class{$sel === row.id}="danger"`) : la ligne range sa clé et sa balise dans des champs directs,
// sans objet par ligne, et le nom de l'index rejoint la liste des index du composant une fois, pas à chaque ligne. Une sélection ne touche
// que les lignes concernées ; une seconde liaison filtrée dans la même ligne marche de même ; une ligne retirée quitte l'index (rien n'est
// basculé sur sa balise morte, la ligne neuve de même clé s'allume)

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

const SOURCE = [
  '<script lang="js">',
  '  $rows = [];',
  '  $sel = 0;',
  '  @poser = function(x) { $rows = x; };',
  '  @choisir = function(id) { $sel = id; };',
  '</script>',
  '<table class="une"><tbody>',
  '  {for row in $rows by id}',
  '    <tr :class{$sel === row.id}="danger"><td>{row.label}</td></tr>',
  '  {end}',
  '</tbody></table>',
  '<table class="deux"><tbody>',
  '  {for row in $rows by id}',
  '    <tr :class{$sel === row.id}="danger"><td :class{$sel === row.id}="actif">{row.label}</td></tr>',
  '  {end}',
  '</tbody></table>'
].join('\n')

const tic = async () => { await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)) }
const lignes = (n: number, d = 1) => Array.from({ length: n }, (_, i) => ({ id: i + d, label: 'l' + (i + d) }))

describe('{for} — liaison filtrée par valeur : champs directs sur la ligne', function () {
  this.timeout(60000)
  let win: any, el: any
  let ajoutsDeNom = 0

  before(async () => {
    const root = mjsTmp('for-filtree-champs')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'filtre.mjs'), SOURCE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    win = new Window({ url: 'http://localhost/' })
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const coeur = files.find((f) => /^mjs_core-/.test(f))!
    const code = files.filter((f) => f !== coeur).reduce((acc, f) => acc + '\n' + stripEsm(readFileSync(join(outDir, f), 'utf-8')), stripEsm(readFileSync(join(outDir, coeur), 'utf-8')))
    win.eval(`${code}\nglobalThis.µ = µ;`)
    win.document.body.innerHTML = '<mjs-filtre></mjs-filtre>'
    el = win.document.body.firstElementChild
    await tic()
    // chaque nom d'index reçu par l'ensemble des index du composant, compté
    const proto = win.Set.prototype
    const avant = proto.add
    proto.add = function(v: any) { if (this === el._mjs_filtIdxKeys) ajoutsDeNom++; return avant.call(this, v) }
  })
  after(async () => { win?.close?.(); await terminateSharedWorkerPool() })

  const racine = () => el._shadow || el.shadowRoot
  const trs = (t = 'deux') => Array.from(racine().querySelectorAll(`table.${t} tbody tr`)) as any[]
  // les entrées de la liste à une seule liaison filtrée (la première des deux du composant)
  const entrees = () => Array.from((Object.values(el._mjs_list_cache)[0] as any).values()) as any[]
  // ce que la ligne range hors de ses balises et de son entrée : aucun objet
  const objetsDeLigne = (en: any) => Object.keys(en.__nodes).filter((k) => { const v = en.__nodes[k]; return v !== null && typeof v === 'object' && !(v instanceof win.Node) && v !== en && k !== '_mjs_reg' })

  it('création de 50 lignes à une liaison filtrée : aucun objet par ligne pour l\'index, chaque nom d\'index rangé une fois au plus', async () => {
    ajoutsDeNom = 0
    el.poser(lignes(50))
    await tic()
    assert.equal(trs('une').length, 50)
    assert.equal(entrees().length, 50)
    const enTrop = entrees().map(objetsDeLigne).filter((x) => x.length)
    assert.equal(enTrop.length, 0, 'objets rangés par ligne : ' + JSON.stringify(enTrop.slice(0, 2)))
    assert.ok(ajoutsDeNom <= 3, 'noms d\'index rangés : ' + ajoutsDeNom)
  })

  it('une sélection ne touche que les lignes concernées, les deux liaisons de la ligne suivent', async () => {
    const touchees = new Set<any>()
    const mo = new win.MutationObserver((ms: any[]) => { for (const m of ms) touchees.add(m.target.closest('tr')) })
    mo.observe(racine().querySelector('table.deux tbody'), { subtree: true, attributes: true })
    mo.observe(racine().querySelector('table.une tbody'), { subtree: true, attributes: true })
    el.choisir(2)
    await tic()
    el.choisir(5)
    await tic()
    mo.takeRecords().forEach((m: any) => touchees.add(m.target.closest('tr')))
    mo.disconnect()
    assert.equal(touchees.size, 4, 'lignes touchées (deux par liste) : ' + touchees.size)
    assert.deepEqual(trs('une').map((t, i) => t.classList.contains('danger') ? i : -1).filter((i) => i >= 0), [4])
    assert.deepEqual(trs().map((t, i) => t.classList.contains('danger') ? i : -1).filter((i) => i >= 0), [4])
    assert.deepEqual(trs().map((t, i) => t.firstElementChild.classList.contains('actif') ? i : -1).filter((i) => i >= 0), [4])
  })

  it('une ligne retirée quitte l\'index : sa balise morte ne bouge plus, la ligne neuve de même clé s\'allume', async () => {
    const morte = trs()[2]
    el.poser(lignes(50).filter((r) => r.id !== 3))
    await tic()
    el.choisir(3)
    await tic()
    assert.ok(!morte.classList.contains('danger') && !morte.firstElementChild.classList.contains('actif'), 'la balise retirée a été basculée')
    el.poser(lignes(50))
    await tic()
    const neuve = trs()[2]
    assert.ok(neuve !== morte || neuve.classList.contains('danger'), 'la ligne de clé 3 doit être allumée')
    assert.ok(neuve.classList.contains('danger') && neuve.firstElementChild.classList.contains('actif'))
    el.choisir(4)
    await tic()
    assert.deepEqual(trs().map((t, i) => t.classList.contains('danger') ? i : -1).filter((i) => i >= 0), [3])
    assert.equal(trs().filter((t) => t.firstElementChild.classList.contains('actif')).length, 1)
  })
})
