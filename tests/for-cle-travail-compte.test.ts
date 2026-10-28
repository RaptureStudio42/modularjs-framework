// {for … by id} : le travail d'une réconciliation se compte. Une liste qui ne change qu'à un endroit (ligne supprimée, deux lignes échangées,
// lignes ajoutées en fin ou insérées au milieu, ligne déplacée, données changées sans toucher l'ordre) se réconcilie sans Set ni Map, sans
// plus longue sous-suite croissante, et ne déplace que les nœuds qui bougent vraiment. Une ligne qui n'affiche pas son indice ne se rejoue
// pas quand elle glisse (ses gestionnaires lisent l'élément et l'indice sur l'entrée de la ligne). Un remplacement total ne parcourt l'arbre
// d'une ancienne ligne (recherche d'un état hors gabarit) que si la réserve de lignes a encore de la place pour elle

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

const CORPS = [
  '<script lang="js">',
  '  $data = µ.raw([]);',
  '  $selected = -1;',
  '  @poser = function(a) { $data = a; };',
  '  @select = function(id) { $selected = id; };',
  '</script>',
  '<table><tbody>',
  '  {for row in $data by id}',
  '    <tr @class{$selected === row.id}="danger">',
  '      <td class="id">{row.id}</td>',
  '      <td class="lab"><a class="sel" @click={@select(row.id)}>{row.label}</a></td>',
  '    </tr>',
  '  {end}',
  '</tbody></table>'
].join('\n')

const tic = async () => { await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)) }

describe('{for … by id} — travail compté d\'une réconciliation', function () {
  this.timeout(60000)
  let win: any, el: any, µ: any
  const n = { set: 0, map: 0, lis: 0, dfs: 0, ins: 0, ret: 0, rejoue: 0 }
  let compte = false
  let jeton = 0
  let donnees: any[] = []

  before(async () => {
    const root = mjsTmp('for-travail')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'banctravail.mjs'), CORPS)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    win = new Window({ url: 'http://localhost/' })
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const coeur = files.find((f) => /^mjs_core-/.test(f))!
    const code = files.filter((f) => f !== coeur).reduce((acc, f) => acc + '\n' + stripEsm(readFileSync(join(outDir, f), 'utf-8')), stripEsm(readFileSync(join(outDir, coeur), 'utf-8')))
    win.eval(`${code}\nglobalThis.µ = µ;`)
    win.document.body.innerHTML = '<mjs-banctravail></mjs-banctravail>'
    el = win.document.body.firstElementChild
    µ = win.µ
    await tic()
    // Set et Map comptés pendant la seule réconciliation (un mandataire du constructeur garde `instanceof` juste)
    const S = win.eval('Set'), M = win.eval('Map')
    win.Set = new Proxy(S, { construct(t: any, a: any[], nt: any) { if (compte) n.set++; return Reflect.construct(t, a, nt) } })
    win.Map = new Proxy(M, { construct(t: any, a: any[], nt: any) { if (compte) n.map++; return Reflect.construct(t, a, nt) } })
    const lis = µ._mjs_lis
    µ._mjs_lis = function(x: any) { n.lis++; return lis.call(this, x) }
    const proto = µ.Element.prototype
    const dfs = proto._mjs_mjsHasOwnState
    proto._mjs_mjsHasOwnState = function(...x: any[]) { n.dfs++; return dfs.apply(this, x) }
    const rec = el._mjs_reconcileList
    el._mjs_reconcileList = function(...x: any[]) { compte = true; try { return rec.apply(this, x) } finally { compte = false } }
  })
  after(async () => { win?.close?.(); await terminateSharedWorkerPool() })

  const ombre = () => el._shadow || el.shadowRoot
  const ligne = (id: number) => µ.raw({ id, label: 'L' + id })
  const ids = (a: number, b: number) => { const r: any[] = []; for (let i = a; i <= b; i++) r.push(ligne(i)); return r }
  const ordre = () => Array.from(ombre().querySelectorAll('tbody > tr .id')).map((x: any) => +x.textContent)

  // pose la liste, compte le travail, vérifie l'ordre ; les lignes déjà là sont espionnées pour compter celles qui se rejouent
  async function operer(a: any[]) {
    const tbody = ombre().querySelector('tbody')
    const N = win.Node.prototype
    tbody.insertBefore = function(x: any, r: any) { if (compte) n.ins++; return N.insertBefore.call(this, x, r) }
    tbody.appendChild = function(x: any) { if (compte) n.ins++; return N.appendChild.call(this, x) }
    tbody.removeChild = function(x: any) { if (compte) n.ret++; return N.removeChild.call(this, x) }
    // seules comptent les lignes affichées au départ (une ligne prise à la réserve se rejoue toujours)
    jeton++
    const cid = Object.keys(el._mjs_list_cache || {})[0]
    if (cid) for (const en of el._mjs_list_cache[cid].values()) {
      en._jeton = jeton
      if (en._mjs_updFn && !en._mjs_updFn._espion) {
        const f = en._mjs_updFn
        en._mjs_updFn = function(...x: any[]) { if (en._jeton === jeton) n.rejoue++; return f.apply(this, x) }
        en._mjs_updFn._espion = true
      }
    }
    for (const k of Object.keys(n)) (n as any)[k] = 0
    donnees = a
    el.poser(µ.raw(a))
    await tic()
    assert.deepEqual(ordre(), a.map((d) => d.id), 'ordre des lignes')
    return { ...n }
  }

  it('créer 20 lignes (référence)', async () => {
    await operer(ids(1, 20))
  })

  it('mettre à jour sans toucher l\'ordre : aucun Set ni Map', async () => {
    const a = donnees.map((d, i) => i % 3 === 0 ? µ.raw({ id: d.id, label: d.label + ' !' }) : d)
    const c = await operer(a)
    assert.deepEqual([c.set, c.map, c.lis, c.ins, c.ret], [0, 0, 0, 0, 0], 'set, map, lis, insertions, retraits : ' + JSON.stringify(c))
    assert.equal(c.rejoue, 7, 'seules les lignes changées se rejouent')
  })

  it('supprimer une ligne au milieu : un seul retrait, aucun Set, Map ni sous-suite', async () => {
    const a = donnees.slice(); a.splice(8, 1)
    const c = await operer(a)
    assert.deepEqual([c.set, c.map, c.lis, c.ins, c.ret, c.dfs], [0, 0, 0, 0, 1, 1], 'set, map, lis, insertions, retraits, parcours : ' + JSON.stringify(c))
    assert.equal(c.rejoue, 0, 'les lignes décalées ne se rejouent pas (la ligne n\'affiche pas son indice)')
  })

  it('échanger deux lignes éloignées : deux déplacements, aucun Set, Map ni sous-suite', async () => {
    const a = donnees.slice(); [a[1], a[17]] = [a[17], a[1]]
    const c = await operer(a)
    assert.deepEqual([c.set, c.map, c.lis, c.ins, c.ret], [0, 0, 0, 2, 0], 'set, map, lis, insertions, retraits : ' + JSON.stringify(c))
    assert.equal(c.rejoue, 0, 'les deux lignes échangées ne se rejouent pas (la ligne n\'affiche pas son indice)')
  })

  it('ajouter en fin : une insertion groupée, aucun Set, Map ni sous-suite', async () => {
    const c = await operer(donnees.concat(ids(21, 30)))
    assert.deepEqual([c.set, c.map, c.lis, c.ins, c.ret], [0, 0, 0, 1, 0], 'set, map, lis, insertions, retraits : ' + JSON.stringify(c))
    assert.equal(c.rejoue, 0, 'aucune ligne déjà là ne se rejoue')
  })

  it('insérer un bloc au milieu : une insertion groupée, aucun Set, Map ni sous-suite', async () => {
    const a = donnees.slice(); a.splice(5, 0, ...ids(31, 33))
    const c = await operer(a)
    assert.deepEqual([c.set, c.map, c.lis, c.ins, c.ret], [0, 0, 0, 1, 0], 'set, map, lis, insertions, retraits : ' + JSON.stringify(c))
    assert.equal(c.rejoue, 0, 'les lignes décalées par l\'insertion ne se rejouent pas')
  })

  it('déplacer une ligne : un seul déplacement, aucun Set, Map ni sous-suite', async () => {
    const a = donnees.slice(); a.splice(12, 0, a.splice(3, 1)[0])
    const c = await operer(a)
    assert.deepEqual([c.set, c.map, c.lis, c.ins, c.ret], [0, 0, 0, 1, 0], 'set, map, lis, insertions, retraits : ' + JSON.stringify(c))
    assert.equal(c.rejoue, 0, 'la ligne déplacée et celles qui glissent ne se rejouent pas')
  })

  it('remplacer 300 lignes : l\'arbre d\'une ancienne ligne n\'est parcouru que si la réserve peut la garder', async () => {
    await operer(ids(1001, 1300))
    const c = await operer(ids(2001, 2300))
    assert.ok(c.dfs <= 256, 'parcours ' + c.dfs + ' pour 300 anciennes lignes et une réserve de 256')
    assert.equal(c.lis, 0, 'aucune sous-suite croissante : ' + JSON.stringify(c))
    assert.equal(c.set, 0, 'aucun Set : ' + JSON.stringify(c))
  })
})
