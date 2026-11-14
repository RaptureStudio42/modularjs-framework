// Les liens d'un objet de l'état vers ses conteneurs : au-delà de deux, ils vont dans une petite liste, et le conteneur qu'une écriture a
// sorti de l'état ne compte plus — le conteneur quitté n'est regardé qu'au moment de libérer une place. Une ligne recopiée (`$rows[i] = { ...$rows[i], k }`) autant de fois qu'on veut
// dans une longue liste, une ligne rangée dans trois listes, un objet lu par trois endroits : l'écriture faite par un nom prévient les
// seuls enfants qui tiennent un conteneur de l'objet écrit, comme l'écriture directe, sans jamais redire toute la variable. Un objet
// sorti d'UN de ses conteneurs reste suivi par les autres ; deux lignes échangées, ou le même objet sous deux champs dont l'un est
// vidé, restent suivis par le conteneur où ils sont encore. Rien de plus sur la fiche d'un objet à un ou deux conteneurs. Cœur construit,
// monté dans happy-dom ; les replis de la remontée sont comptés dans le cœur bâti
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const tic = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)) }
const js  = (script: string[], gabarit: string) => ['<script lang="js">', ...script.map((l) => '  ' + l), '</script>', gabarit].join('\n')
const N   = 80
const ROWS = `$rows = Array.from({ length: ${N} }, (_, i) => ({ id: i, fait: false, s: { y: 0 } })); $favoris = []; $recents = [];`
const GESTES = [
  '@ind = function(i) { const r = $rows[i]; r.fait = !r.fait; };',
  '@dind = function(i) { $rows[i].fait = !$rows[i].fait; };',
  '@sous = function(i) { const t = $rows[i].s; t.y++; };',
  '@dsous = function(i) { $rows[i].s.y++; };',
  '@majligne = function(i) { $rows[i] = { ...$rows[i], k: ($rows[i].k || 0) + 1 }; };',
  '@marquer = function(i) { $favoris = [$rows[i]]; $recents = [$rows[i]]; };',
]
const VUE = ['$item = null;', 'let n = 0;', 'function montre(x) { n++; return JSON.stringify(x); }', '@compte = function() { return n; };']
const SOURCES: Record<string, string> = {
  'lz-v.mjs':       js(VUE, '<em>{montre($item)}</em>'),
  'lz-lignes.mjs':  js([ROWS, ...GESTES], '{for r in $rows by id}<@lz-v item={r}></@lz-v>{end}'),
  'lz-trois.mjs':   js([ROWS, ...GESTES], '{for r in $favoris by id}<i>{r.id}{r.fait}</i>{end}{for r in $recents by id}<i>{r.id}{r.fait}</i>{end}{for r in $rows by id}<@lz-v item={r}></@lz-v>{end}'),
  // le même objet lu par trois endroits, chacun tenu par un enfant ; `$o.w` et les lignes de `$o.l` n'ont rien à voir
  'lz-endroits.mjs': js(['const x = { d: 0 };', '$o = { a: { ref: x }, y: { n: x }, z: { m: x }, w: { q: 0 }, l: [{ id: 1 }, { id: 2 }] };', '@nom = function(v) { const t = $o.a.ref; const u = $o.y.n; const w = $o.z.m; t.d = v; return u === w; };', '@direct = function(v) { $o.a.ref.d = v; };'],
    '<@lz-v item={$o.a}></@lz-v><@lz-v item={$o.y}></@lz-v><@lz-v item={$o.z}></@lz-v><@lz-v item={$o.w}></@lz-v>{for r in $o.l by id}<@lz-v item={r}></@lz-v>{end}'),
  // la ligne rangée dans deux listes, retirée d'une seule ; les deux listes tenues par un enfant
  'lz-deux.mjs':    js(['const r1 = { id: 1, d: 0 }, r2 = { id: 2, d: 0 };', '$o = { tous: [r1, r2], favoris: [r1] };', 'let t;', '@prendre = function() { t = $o.tous[0]; return t === $o.favoris[0]; };', '@retirer = function() { $o.tous.splice(0, 1); };', '@ecrire = function(v) { t.d = v; };'],
    '<@lz-v item={$o.tous}></@lz-v><@lz-v item={$o.favoris}></@lz-v>'),
  // deux lignes échangées dans une liste que tient un enfant, puis l'une écrite par un nom pris avant
  'lz-echange.mjs': js(['$o = { rows: [{ id: 1, d: 0 }, { id: 2, d: 0 }, { id: 3, d: 0 }] };', 'let t;', '@prendre = function() { t = $o.rows[0]; };', '@echanger = function() { [$o.rows[0], $o.rows[2]] = [$o.rows[2], $o.rows[0]]; };', '@ecrire = function(v) { t.d = v; };'],
    '<@lz-v item={$o.rows}></@lz-v>'),
  // le même objet sous deux champs du même conteneur, l'un vidé ; le conteneur tenu par un enfant
  'lz-double.mjs':  js(['const x = { d: 0 };', '$o = { p: { survole: x, choisi: x } };', 'let t;', '@prendre = function() { t = $o.p.survole; };', '@vider = function() { $o.p.survole = null; };', '@ecrire = function(v) { t.d = v; };'],
    '<@lz-v item={$o.p}></@lz-v>'),
  // les valeurs d'une Map recopiées par `set`
  'lz-map.mjs':     js(['$m = new Map([[1, { id: 1, s: { y: 0 } }], [2, { id: 2, s: { y: 0 } }], [3, { id: 3, s: { y: 0 } }]]);', '@maj = function(id) { $m.set(id, { ...$m.get(id), k: ($m.get(id).k || 0) + 1 }); };', '@sous = function(id) { const t = $m.get(id).s; t.y++; };'],
    '{for r in Array.from($m.values()) by id}<@lz-v item={r}></@lz-v>{end}'),
}

const REGLAGES: Array<[string, any]> = [['développement', {}], ['production', { env: 'prod' }]]
const ombre = (el: any) => el._shadow || el.shadowRoot || el

for (const [nom, opts] of REGLAGES) describe(`état : liens au-delà de deux, conteneur sorti de l'état (${nom})`, function () {
  this.timeout(120000)
  let code = ''
  const fenetres: any[] = []

  before(async () => {
    const root   = mjsTmp('liens-au-dela-de-deux')
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
    // le repli de la remontée, compté là où il se décide
    assert.equal(code.split('repli = true;').length, 2, 'le repli de la remontée ne se décide plus en un seul endroit du cœur')
    code = code.split('repli = true;').join('repli = true; globalThis.__replis = (globalThis.__replis || 0) + 1;')
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
    const el      = win.document.querySelector('mjs-' + balise)
    const enfants = () => Array.from(ombre(el).querySelectorAll('mjs-lz-v')) as any[]
    const texte   = (c: any) => ombre(c).querySelector('em').textContent
    const juste   = (c: any) => texte(c) === JSON.stringify(win.µ._mjs_toRaw(c._state.item))
    // un geste, puis le nombre de rendus de chaque enfant pendant ce geste
    const geste   = async (f: () => void) => {
      const cs = enfants(), avant = cs.map((c) => c.compte())
      f()
      await tic()
      return cs.map((c, i) => c.compte() - avant[i])
    }
    const rendus = (d: number[]) => d.map((x, i) => x > 0 ? i : -1).filter((i) => i !== -1)
    return { win, el, enfants, texte, juste, geste, rendus }
  }

  it(`ligne recopiée trois fois dans une liste de ${N} lignes : toute écriture dans la ligne ou son sous-objet, par un nom ou directe, rend UN enfant`, async () => {
    const { win, el, enfants, juste, geste, rendus } = await appli('lz-lignes')
    for (let i = 0; i < 3; i++) { el.majligne(40); await tic() }
    for (const g of ['sous', 'dsous', 'ind', 'dind', 'sous']) {
      assert.deepEqual(rendus(await geste(() => el[g](40))), [40], `geste ${g} après trois recopies`)
      assert.ok(enfants().every(juste), `geste ${g} : un enfant ne montre pas ce qu'il tient`)
    }
    assert.deepEqual(rendus(await geste(() => el.sous(7))), [7])
    assert.equal(win.__replis || 0, 0, 'la remontée s\'est repliée')
  })

  it('ligne recopiée quarante fois de suite, sans ramasse-miettes entre les recopies : le sous-objet ne garde pas un lien par recopie, UN enfant rendu, aucun repli', async () => {
    const { win, el, enfants, juste, geste, rendus } = await appli('lz-lignes')
    for (let i = 0; i < 40; i++) { el.majligne(40); await tic() }
    assert.deepEqual(rendus(await geste(() => el.sous(40))), [40])
    assert.deepEqual(rendus(await geste(() => el.dsous(40))), [40])
    assert.ok(enfants().every(juste))
    assert.equal(win.__replis || 0, 0, 'la remontée s\'est repliée')
    const f = el._mjs_rootsByTarget.get(win.µ._mjs_toRaw(el._state.rows)[40].s) || el._mjs_rootsByTarget.get(win.µ._mjs_toRaw(win.µ._mjs_toRaw(el._state.rows)[40].s))
    assert.ok(f, 'la fiche du sous-objet')
    assert.ok(f.l === undefined || f.l.length < 3, `le sous-objet d'une ligne recopiée quarante fois garde ${f.l && f.l.length} lien(s) de plus que deux`)
  })

  it('ligne rangée dans trois listes : écrite par un nom ou en direct, elle ou son sous-objet, UN enfant rendu ; la liste des liens naît au troisième conteneur', async () => {
    const { win, el, enfants, juste, geste, rendus } = await appli('lz-trois')
    const brut = (i: number) => win.µ._mjs_toRaw(el._state.rows)[i]
    assert.deepEqual(rendus(await geste(() => el.ind(40))), [40])
    el.marquer(40)
    await tic()
    for (const g of ['ind', 'dind', 'sous', 'dsous']) {
      assert.deepEqual(rendus(await geste(() => el[g](40))), [40], `geste ${g}, ligne dans trois listes`)
      assert.ok(enfants().every(juste), `geste ${g} : un enfant ne montre pas ce qu'il tient`)
    }
    assert.deepEqual(rendus(await geste(() => el.ind(7))), [7])
    assert.equal(win.__replis || 0, 0, 'la remontée s\'est repliée')
    assert.equal(el._mjs_rootsByTarget.get(brut(40)).l.length, 1, 'le troisième conteneur de la ligne va dans la liste de sa fiche')
    // la fiche d'une ligne à un seul conteneur : ses seize champs, rien de plus (une marque de plus en développement)
    const cles = Object.keys(el._mjs_rootsByTarget.get(brut(7))).filter((k) => !k.startsWith('_mjs_'))
    assert.deepEqual(cles, ['e', 'r', 's', 'x', 'f', 't', 'q', 'm', 'o', 'u', 'a', 'b', 'v', 'k', 'p', 'n'])
  })

  it('objet lu par trois endroits de l\'état : l\'écriture par un nom rend les trois enfants qui tiennent un de ses conteneurs, et eux seuls', async () => {
    const a = await appli('lz-endroits')
    let parNom = false
    const dn = await a.geste(() => { parNom = a.el.nom(3) })
    assert.equal(parNom, true)
    assert.deepEqual(a.rendus(dn), [0, 1, 2], 'enfants rendus par l\'écriture faite par un nom : ni celui de `$o.w`, ni les lignes de `$o.l`')
    assert.deepEqual(a.enfants().slice(0, 3).map(a.texte), ['{"ref":{"d":3}}', '{"n":{"d":3}}', '{"m":{"d":3}}'])
    assert.deepEqual(a.rendus(await a.geste(() => { a.el.nom(9) })), [0, 1, 2])
    assert.ok(a.enfants().every(a.juste))
    assert.equal(a.win.__replis || 0, 0, 'la remontée s\'est repliée')
  })

  it('ligne rangée dans deux listes puis retirée de l\'une : écrite par un nom pris avant, l\'enfant qui tient l\'autre liste suit', async () => {
    const { el, enfants, texte, juste } = await appli('lz-deux')
    assert.equal(el.prendre(), true)
    el.retirer()
    await tic()
    el.ecrire(5)
    await tic()
    assert.equal(texte(enfants()[1]), '[{"id":1,"d":5}]')
    assert.ok(enfants().every(juste))
  })

  it('deux lignes échangées dans une liste que tient un enfant, puis l\'une écrite par un nom pris avant l\'échange : l\'enfant suit', async () => {
    const { el, enfants, texte, juste } = await appli('lz-echange')
    el.prendre()
    el.echanger()
    await tic()
    assert.equal(texte(enfants()[0]), '[{"id":3,"d":0},{"id":2,"d":0},{"id":1,"d":0}]')
    el.ecrire(5)
    await tic()
    assert.equal(texte(enfants()[0]), '[{"id":3,"d":0},{"id":2,"d":0},{"id":1,"d":5}]')
    assert.ok(enfants().every(juste))
  })

  it('le même objet sous deux champs d\'un conteneur que tient un enfant, l\'un vidé : écrit par un nom pris avant, l\'enfant suit', async () => {
    const { el, enfants, texte, juste } = await appli('lz-double')
    el.prendre()
    el.vider()
    await tic()
    el.ecrire(5)
    await tic()
    assert.equal(texte(enfants()[0]), '{"survole":null,"choisi":{"d":5}}')
    assert.ok(enfants().every(juste))
  })

  it('valeur d\'une Map recopiée quarante fois par `set` : son sous-objet écrit par un nom rend UN enfant, aucun repli', async () => {
    const { win, el, enfants, juste, geste, rendus } = await appli('lz-map')
    for (let i = 0; i < 40; i++) { el.maj(2); await tic() }
    assert.deepEqual(rendus(await geste(() => el.sous(2))), [1])
    assert.ok(enfants().every(juste))
    assert.equal(win.__replis || 0, 0, 'la remontée s\'est repliée')
  })
})
