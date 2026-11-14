// une prop objet qui lit une clé du magasin et une variable (`item={$$s.on ? $$s.x : $o.a}`), un rang calculé (`item={$rows[$i - 1]}`) et
// des props étalées (`<@vn {...$p}>`) : l'enfant suit l'écriture par un nom comme l'écriture directe, dans les quatre réglages ; un objet
// lâché après une écriture par un nom part au ramasse-miettes, comme après l'écriture directe (happy-dom)
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import v8 from 'node:v8'
import vm from 'node:vm'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

v8.setFlagsFromString('--expose-gc')
const gc  = vm.runInNewContext('gc')
const tic = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) }
const js  = (script: string[], gabarit: string) => ['<script lang="js">', ...script.map((l) => '  ' + l), '</script>', gabarit].join('\n')
const PAR = ['$o = { a: { b: { c: 0 } } };', '@nom = function(v) { const t = $o.a.b; t.c = v; };', '@direct = function(v) { $o.a.b.c = v; };', '@raf = function() { µrefresh($o); };']
// une comparaison ou un calcul en tête, puis un opérande de `&&`, `||` ou `?:` qui peut rendre un objet de l'état
const LISTE  = ['$list = [{ b: { c: 0 } }];', '@nom = function(v) { const t = $list[0].b; t.c = v; };', '@direct = function(v) { $list[0].b.c = v; };', '@raf = function() { µrefresh($list); };']
const FORMES: Array<[string, string, string[]]> = [['fa', '$list.length > 0 && $list[0]', LISTE], ['fb', '$n >= 0 && $o.a', PAR], ['fc', '$k === 1 || $o.a', PAR], ['fd', '$k !== 1 && $o.a', PAR], ['fe', '$o.a || $k === 1', PAR], ['ff', '$list.length && $list[0]', LISTE], ['fg', '($n >= 0) && $o.a', PAR], ['fh', '$n * 2 >= 0 && $o.a', PAR], ['fi', '$k == 1 || $n > 5 || $o.a', PAR], ['fj', '$n >= 0 && $k !== 1 && $o.a', PAR], ['fk', '$n < 0 ? null : $o.a', PAR]]
const FORMES_SOURCES = Object.fromEntries(FORMES.map(([tag, e, par]) => [tag + '.mjs', js(['$n = 0;', '$k = 0;', '@plus = function() { $n++; };', ...par], `<@vn item={${e}}></@vn>`)]))
const SOURCES: Record<string, string> = {
  'vn.mjs': js(['$item = null;'], "<em>{$item ? JSON.stringify($item) : '-'}</em>"),
  'mx.mjs': js(['$$s = { on: false, x: { n: 0 } };', ...PAR, '@nomS = function(v) { const t = $$s.x; t.n = v; };', '@rafS = function() { µrefresh($$s); };', '@deux = function(v) { const t = $$s.x; t.n = v; const u = $o.a.b; u.c = v; };', '@rafDeux = function() { µrefresh($$s); µrefresh($o); };'], '<p>{$o.a.b.c}</p><@vn item={$$s.on ? $$s.x : $o.a}></@vn><@vm item={$$s.on ? $$s.x : $o.a}></@vm>'),
  'vm.mjs': js(['$item = null;'], '<@vn item={$item ? $item.b : null}></@vn>'),
  'my.mjs': js(['$$u = { x: { n: 0 } };', '$on = true;', ...PAR, '@off = function() { $on = false; };', '@nomU = function(v) { const t = $$u.x; t.n = v; };', '@directU = function(v) { $$u.x.n = v; };', '@rafU = function() { µrefresh($$u); };'], '<@vn item={$on ? $o.a : $$u.x}></@vn>'),
  'ix.mjs': js(['$rows = [{ x: { c: 0 } }, { x: { c: 0 } }];', '$i = 1;', '@nom = function(v) { const t = $rows[0].x; t.c = v; };', '@direct = function(v) { $rows[0].x.c = v; };', '@raf = function() { µrefresh($rows); };'], '<@vn item={$rows[$i - 1]}></@vn>'),
  'sp.mjs': js(['$p = { item: { b: { c: 0 } } };', '@nom = function(v) { const t = $p.item.b; t.c = v; };', '@direct = function(v) { $p.item.b.c = v; };', '@raf = function() { µrefresh($p); };'], '<@vn {...$p}></@vn>'),
  'vk.mjs': js(['$item = null;'], "<i>{$item ? $item.n : '-'}</i>"),
  ...FORMES_SOURCES,
  'vg.mjs': js(['$item = null;'], "<i>{$item ? $item.x.c + '-' + $item.o.v : '-'}</i>"),
  'gr.mjs': js(['$rows = Array.from({ length: 100 }, (_, i) => { const r = { id: i, x: { c: 0 }, o: { v: 0 } }; for (let k = 0; k < 20; k++) r["f" + k] = k; return r; });', '@nomN = function(n, v) { for (let i = 0; i < n; i++) { const t = $rows[i].x; t.c = v; } };', '@raf = function() { µrefresh($rows); };'], '{for r in $rows by id}<@vg item={r}></@vg>{end}'),
  'rt.mjs': js(['$o = { big: null };', '@charger = function() { $o = { big: { n: 0, rows: Array.from({ length: 200000 }, (_, i) => ({ i })) } }; };', '@nom = function() { const t = $o.big; t.n = 1; };', '@direct = function() { $o.big.n = 2; };', '@vider = function() { window.__refs.push(new WeakRef(µ._mjs_toRaw ? µ._mjs_toRaw($o.big) : $o.big)); $o = { big: null }; };'], '<@vk item={$o.big}></@vk>'),
  'rs.mjs': js(['$$gros = { big: null };', '@charger = function() { $$gros = { big: { n: 0, rows: Array.from({ length: 200000 }, (_, i) => ({ i })) } }; };', '@nom = function() { const t = $$gros.big; t.n = 1; };', '@direct = function() { $$gros.big.n = 2; };', '@vider = function() { window.__refs.push(new WeakRef(µread($$gros).big)); $$gros = { big: null }; };'], '<@vk item={$$gros.big}></@vk>'),
}
const REGLAGES: Array<[string, any]> = [['développement', {}], ['production', { env: 'prod' }], ['production sans enveloppe', { env: 'prod', proxy: false }], ['développement sans enveloppe', { proxy: false }]]
const ombre = (el: any) => el._shadow || el.shadowRoot || el
const tous  = (r: any, tag: string, out: any[] = []): any[] => { for (const e of Array.from(ombre(r).querySelectorAll('*')) as any[]) { if (e.tagName === tag) out.push(e); if (e._shadow || e.shadowRoot) tous(e, tag, out) } return out }
const txt   = (el: any, sel = 'em') => ombre(el).querySelector(sel)?.textContent ?? '?'

for (const [nom, opts] of REGLAGES) describe(`prop objet écrite par un nom : formes suivies et rien de retenu (${nom})`, function () {
  this.timeout(240000)
  const sans = opts.proxy === false
  let code = ''
  const fen: any[] = []
  before(async () => {
    const root = mjsTmp('formes-figees'), srcDir = join(root, 'src'), outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [f, s] of Object.entries(SOURCES)) writeFileSync(join(srcDir, f), s)
    const b  = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), minify: false, ...opts } as any)
    const st = await b.compile()
    await b.close()
    assert.deepEqual(st.errors.map((e: any) => e.message), [])
    const rang = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    code = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  })
  after(async () => { for (const w of fen) w.close?.(); await terminateSharedWorkerPool() })
  async function appli(tag: string) {
    const win: any = new Window({ url: 'http://localhost/' })
    fen.push(win)
    win.__refs = []
    win.eval(`${code}\nglobalThis.µ = µ;`)
    win.document.body.innerHTML = `<mjs-${tag}></mjs-${tag}>`
    await tic()
    return win.document.querySelector('mjs-' + tag)
  }
  const enf = (el: any) => tous(el, 'MJS-VN').map((e) => txt(e)).join(' / ')
  // le geste, puis µrefresh sans l'enveloppe (seule façon d'y dire un changement fait par un nom)
  const pas = async (f: () => void, raf?: () => void) => { f(); if (sans && raf) raf(); await tic() }

  it('une prop qui lit une clé du magasin puis une variable suit encore la variable après une écriture par un nom dans le magasin', async () => {
    const el = await appli('mx')
    await pas(() => el.nomS(1), () => el.rafS())
    assert.equal(enf(el), '{"b":{"c":0}} / {"c":0}')
    await pas(() => el.nom(5), () => el.raf())
    assert.equal(enf(el), '{"b":{"c":5}} / {"c":5}', 'enfant et petit-enfant suivent l\'écriture par un nom dans $o')
    await pas(() => el.nomS(2), () => el.rafS())
    await pas(() => el.nom(7), () => el.raf())
    assert.equal(enf(el), '{"b":{"c":7}} / {"c":7}', 'en alternant les deux sources')
    await pas(() => el.deux(8), () => el.rafDeux())
    assert.equal(enf(el), '{"b":{"c":8}} / {"c":8}', 'les deux sources écrites avant un seul passage')
    await pas(() => el.direct(9))
    assert.equal(enf(el), '{"b":{"c":9}} / {"c":9}', 'écriture directe')
  })
  it('une prop qui lit une variable puis une clé du magasin suit les deux', async () => {
    const el = await appli('my')
    await pas(() => el.nom(1), () => el.raf())
    assert.equal(enf(el), '{"b":{"c":1}}')
    await pas(() => el.off())
    assert.equal(enf(el), '{"n":0}')
    await pas(() => el.nomU(7), () => el.rafU())
    assert.equal(enf(el), '{"n":7}')
    await pas(() => el.directU(8))
    assert.equal(enf(el), '{"n":8}')
  })
  for (const [cas, tag, avant, apres, direct] of [['un rang calculé (item={$rows[$i - 1]})', 'ix', '{"x":{"c":0}}', '{"x":{"c":5}}', '{"x":{"c":6}}'], ['des props étalées (<@vn {...$p}>)', 'sp', '{"b":{"c":0}}', '{"b":{"c":5}}', '{"b":{"c":6}}']]) it(`${cas} suit l'écriture par un nom comme l'écriture directe`, async () => {
    const el = await appli(tag)
    assert.equal(enf(el), avant)
    await pas(() => el.nom(5), () => el.raf())
    assert.equal(enf(el), apres, sans ? 'écriture par un nom puis µrefresh' : 'écriture par un nom')
    await pas(() => el.direct(6))
    assert.equal(enf(el), direct, 'écriture directe')
  })
  for (const [tag, e] of FORMES) it(`item={${e}} suit l'écriture par un nom comme l'écriture directe`, async () => {
    const el = await appli(tag)
    assert.equal(enf(el), '{"b":{"c":0}}')
    await pas(() => el.nom(5), () => el.raf())
    assert.equal(enf(el), '{"b":{"c":5}}', sans ? 'écriture par un nom puis µrefresh' : 'écriture par un nom')
    await pas(() => el.plus())
    await pas(() => el.nom(6), () => el.raf())
    assert.equal(enf(el), '{"b":{"c":6}}', 'après un changement de la variable en tête')
    await pas(() => el.direct(7))
    assert.equal(enf(el), '{"b":{"c":7}}', 'écriture directe')
  })
  // un lot de quelques objets, puis de 70 : chaque ligne écrite se redessine, les autres gardent leur écran
  it('lignes-composants : 3 puis 70 lignes écrites par un nom avant un même redessin', async () => {
    const el      = await appli('gr')
    const vus     = () => tous(el, 'MJS-VG').map((e) => txt(e, 'i'))
    const attendu = (n: number, v: number, avant: number) => Array.from({ length: 100 }, (_, i) => (i < n ? v : avant) + '-0')
    await pas(() => el.nomN(3, 7), () => el.raf())
    assert.deepEqual(vus(), attendu(3, 7, 0))
    await pas(() => el.nomN(70, 8), () => el.raf())
    assert.deepEqual(vus(), attendu(70, 8, 0))
  })
  // le message d'un échec ne montre jamais l'objet (200 000 lignes) : `assert.ok`. En développement, l'objet lâché après une écriture
  // directe dans une clé du magasin reste tenu, sans aucune écriture par un nom dans l'appli : ce cas-là n'est pas comparé ici
  if (!sans) for (const [tag, cas] of [['rt', 'variable du composant'], ['rs', 'clé du magasin']]) for (const w of ['nom', 'direct']) if (opts.env === 'prod' || tag === 'rt' || w === 'nom') it(`objet lâché après une écriture ${w === 'nom' ? 'par un nom' : 'directe'} (${cas}) : rien ne le retient`, async () => {
    const tas = () => { for (let i = 0; i < 3; i++) gc(); return Math.round(v8.getHeapStatistics().used_heap_size / 1e5) / 10 }
    const el  = await appli(tag)
    const t0  = tas()
    el.charger(); await tic(); el[w](); await tic()
    assert.equal(txt(tous(el, 'MJS-VK')[0], 'i'), w === 'nom' ? '1' : '2')
    const t1 = tas()
    el.vider(); await tic()
    for (let i = 0; i < 3; i++) { gc(); await tic() }
    const t2  = tas()
    const win = el.ownerDocument.defaultView
    console.log(`      tas (Mo, après gc) ${nom}, ${cas}, ${w} : avant ${t0}, objet tenu ${t1}, lâché ${t2}`)
    assert.ok(win.__refs[0].deref() === undefined, `${w} : l'objet lâché part au ramasse-miettes`)
  })
})
