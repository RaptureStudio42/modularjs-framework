// Un lien douteux ne prouve jamais qu'un objet est sorti de l'état : une ligne glissée dans sa liste, deux lignes échangées, ou le même
// objet sous deux champs dont l'un est vidé, sont encore dans leur conteneur ; le sous-objet qu'ils partagent garde son lien vers eux,
// et l'écriture faite plus tard par un nom dans ce sous-objet prévient l'enfant qui tient la ligne. Le `get` d'une sous-classe de `Map`
// n'est pas appelé par un `set` ou un `delete`. Cœur construit, monté dans happy-dom
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const tic = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)) }
const js  = (script: string[], gabarit: string) => ['<script lang="js">', ...script.map((l) => '  ' + l), '</script>', gabarit].join('\n')
const RENOMMER = '@renommer = function(v) { const c = $cats[0]; c.nom = v; };'
const SOURCES: Record<string, string> = {
  'ld-enf.mjs':    js(['$item = null;'], '<em>{$item ? JSON.stringify($item) : ""}</em>'),
  'ld-table.mjs':  js(['$rows = null;'], '{if $rows}{for r in $rows by id}<@ld-enf item={r}></@ld-enf>{end}{end}'),
  'ld-champs.mjs': js(['$o = null;'], '{if $o}<@ld-enf item={$o.choisi}></@ld-enf>{end}'),
  // la liste est rendue par l'enfant : le parent ne la relit pas
  'ld-par.mjs':    js([
    'const c0 = { nom: "a" };',
    '$cats = [c0];',
    '$rows = [{ id: 1, cat: c0 }, { id: 2, cat: c0 }, { id: 3, cat: c0 }];',
    '@total = function() { let s = ""; for (const r of $rows) s += r.cat.nom; return s; };',
    '@glisser = function() { const x = $rows.splice(0, 1)[0]; $rows.splice(2, 0, x); };',
    '@echanger = function() { const t = $rows[0]; $rows[0] = $rows[1]; $rows[1] = t; };',
    '@troquer = function() { [$rows[0], $rows[1]] = [$rows[1], $rows[0]]; };',
    '@ajouter = function() { $rows.push({ id: $rows.length + 1, cat: $cats[0] }); const r = $rows[$rows.length - 1]; return r.cat.nom; };',
    RENOMMER,
  ], '<@ld-table rows={$rows}></@ld-table>'),
  'ld-deux.mjs':   js([
    'const c0 = { nom: "a" }; const x = { id: 1, cat: c0 };',
    '$cats = [c0];',
    '$o = { survole: x, choisi: x };',
    '$autres = [{ id: 2, cat: c0 }, { id: 3, cat: c0 }];',
    '@lire = function() { return $o.survole.cat.nom + $autres[0].cat.nom + $autres[1].cat.nom; };',
    '@quitter = function() { $o.survole = null; };',
    RENOMMER,
  ], '<@ld-champs o={$o}></@ld-champs>'),
  'ld-map.mjs':    js([
    'class Cpt extends Map { get(k) { globalThis.__g = (globalThis.__g || 0) + 1; return super.get(k); } }',
    '$m = new Cpt([["a", { v: 1 }]]);',
    '$o = { x: 1 };',
    '@dset = function() { $m.set("a", { v: 2 }); };',
    '@ddel = function() { $m.delete("a"); };',
  ], '<p>{$m.size}</p><@ld-enf item={$o}></@ld-enf>'),
}

const REGLAGES: Array<[string, any]> = [['développement', {}], ['production', { env: 'prod' }]]
const ombre = (el: any) => el._shadow || el.shadowRoot || el

// les `<em>` des `ld-enf`, cherchés dans les racines d'ombre imbriquées
function ems(el: any): string[] {
  const vus: string[] = []
  const fouille = (r: any) => {
    for (const c of Array.from(r.querySelectorAll('*')) as any[]) {
      if (c.tagName === 'MJS-LD-ENF') vus.push(ombre(c).querySelector('em').textContent)
      else if (c.tagName.startsWith('MJS-')) fouille(ombre(c))
    }
  }
  fouille(ombre(el))
  return vus
}

for (const [nom, opts] of REGLAGES) describe(`état : un lien douteux ne prouve jamais qu'un objet est sorti (${nom})`, function () {
  this.timeout(120000)
  let code = ''
  const fenetres: any[] = []

  before(async () => {
    const root   = mjsTmp('lien-douteux')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [f, s] of Object.entries(SOURCES)) writeFileSync(join(srcDir, f), s)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), minify: false, ...opts } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b))
    code = files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  })

  after(async () => {
    for (const w of fenetres) w.close?.()
    await terminateSharedWorkerPool()
  })

  async function appli(balise: string) {
    const win: any = new Window({ url: 'http://localhost/' })
    fenetres.push(win)
    win.eval(`${code}\nglobalThis.µ = µ;`)
    win.document.body.innerHTML = `<mjs-${balise}></mjs-${balise}>`
    await tic(); await tic()
    const el    = win.document.querySelector('mjs-' + balise)
    const geste = async (f: () => void) => { f(); await tic() }
    return { win, el, geste }
  }
  const tous = (vus: string[], n: number, v: string) => {
    assert.equal(vus.length, n, `enfants : ${vus.join(' ')}`)
    assert.ok(vus.every((t) => t.includes(`"nom":"${v}"`)), `un enfant ne montre pas ${v} : ${vus.join(' ')}`)
  }

  it('ligne glissée dans sa liste, puis le sous-objet partagé renommé par un nom : tous les enfants suivent', async () => {
    const { el, geste } = await appli('ld-par')
    for (const g of [() => el.total(), () => el.renommer('n0'), () => el.glisser(), () => el.ajouter(), () => el.renommer('n1')]) await geste(g)
    tous(ems(el), 4, 'n1')
    await geste(() => el.renommer('n2'))
    tous(ems(el), 4, 'n2')
  })

  it('deux lignes échangées, puis le sous-objet partagé renommé par un nom : tous les enfants suivent', async () => {
    const { el, geste } = await appli('ld-par')
    for (const g of [() => el.total(), () => el.echanger(), () => el.renommer('n1')]) await geste(g)
    tous(ems(el), 3, 'n1')
  })

  it('deux lignes échangées par déstructuration, puis le sous-objet partagé renommé par un nom : tous les enfants suivent', async () => {
    const { el, geste } = await appli('ld-par')
    for (const g of [() => el.total(), () => el.troquer(), () => el.renommer('n1')]) await geste(g)
    tous(ems(el), 3, 'n1')
  })

  it('le même objet sous deux champs, l\'un vidé, puis son sous-objet renommé par un nom : l\'enfant qui tient l\'autre champ suit', async () => {
    const { el, geste } = await appli('ld-deux')
    for (const g of [() => el.lire(), () => el.quitter(), () => el.renommer('n1')]) await geste(g)
    assert.deepEqual(ems(el), ['{"id":1,"cat":{"nom":"n1"}}'])
  })

  it('témoin sans déplacement : une ligne ajoutée, puis le sous-objet partagé renommé par un nom : tous les enfants suivent', async () => {
    const { el, geste } = await appli('ld-par')
    for (const g of [() => el.total(), () => el.renommer('n0'), () => el.ajouter(), () => el.renommer('n1')]) await geste(g)
    tous(ems(el), 4, 'n1')
  })

  it('`set` sur une sous-classe de `Map` : son `get` n\'est pas appelé', async () => {
    const { win, el, geste } = await appli('ld-map')
    win.__g = 0
    await geste(() => el.dset())
    assert.equal(win.__g, 0)
  })

  it('`delete` sur une sous-classe de `Map` : son `get` n\'est pas appelé', async () => {
    const { win, el, geste } = await appli('ld-map')
    win.__g = 0
    await geste(() => el.ddel())
    assert.equal(win.__g, 0)
  })
})
