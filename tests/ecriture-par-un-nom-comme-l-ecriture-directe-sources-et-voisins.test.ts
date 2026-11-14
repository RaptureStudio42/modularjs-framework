// Une écriture par un nom (`t = $o.a.b; t.c = v`) donne le même écran que l'écriture directe du même champ (`$o.a.b.c = v`), et la prop
// suit toutes les variables que lit son expression, en développement comme en production. Une prop qui lit sa variable dans un appel ou
// entre parenthèses (`item={choisir($o)}`, `item={($o.a)}`) : l'enfant suit l'écriture par un nom et `µrefresh($o)` dans les deux modes. Un
// choix (`item={$sel ?? $o.a}`, `item={$ok ? $o.a : $p.a}`) : `µrefresh($o)` redessine l'enfant. Deux frères qui tiennent le même objet,
// liés ou non par `!{…}`, l'enfant glissé dans une mise en page qui tient aussi l'objet (`<slot>`), le petit-enfant sous un enfant qui
// redonne l'objet sans le lire, l'ordre des reffets : le même écran et le même ordre que sous l'écriture directe. Quatre réglages :
// développement et production, avec et sans enveloppe (le réglage `proxy: false` : l'écriture par un nom se signale par `µrefresh`, qui ne
// relance pas les reffets de l'enfant). Cœur construit, monté dans happy-dom
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const tic = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) }
const js  = (script: string[], gabarit: string) => ['<script lang="js">', ...script.map((l) => '  ' + l), '</script>', gabarit].join('\n')
const AFF = "<em>{$item ? JSON.stringify($item) : '-'}</em>"
const PAR = ['const garde = { a: { b: { c: 0 } } };', '$o = garde;', '@nom = function(v) { const t = $o.a.b; t.c = v; };', '@direct = function(v) { $o.a.b.c = v; };', '@dehors = function(v) { garde.a.b.c = v; };', '@raf = function() { µrefresh($o); };']
const ENF = ['$item = null;', '@nomE = function(v) { const t = $item.b; t.c = v; };', '@directE = function(v) { $item.b.c = v; };', '@rafE = function() { µrefresh($item); };']
const SOURCES: Record<string, string> = {
  'vn.mjs':  js(['$item = null;'], AFF),
  'cho.mjs': js([...PAR, '$sel = null;'], '<@vn item={$sel ?? $o.a}></@vn>'),
  'ter.mjs': js([...PAR, '$ok = true;', '$p = { a: { b: { c: 0 } } };'], '<@vn item={$ok ? $o.a : $p.a}></@vn>'),
  // frères, liés ou non, qui tiennent le même objet
  'vs.mjs':  js(ENF, AFF),
  'sb.mjs':  js(PAR, '<p>{JSON.stringify($o)}</p><@vs item={$o.a}></@vs><@vs item={$o.a}></@vs>'),
  'vl.mjs':  js([...ENF, 'µeffect(() => { JSON.stringify($item); window.__eff[this.id] = (window.__eff[this.id] || 0) + 1; });'], AFF),
  'lb.mjs':  js(PAR, '<p>{JSON.stringify($o)}</p><@vl id="e1" item=!{$o.a}></@vl><@vl id="e2" item=!{$o.a}></@vl>'),
  // l'enfant glissé dans une mise en page qui tient aussi l'objet
  'lay.mjs': js(['$data = null;'], "<p>{$data ? JSON.stringify($data) : '-'}</p><slot></slot>"),
  'sl.mjs':  js(PAR, '<@lay data={$o}><@vs item={$o.a}></@vs></@lay>'),
  // le petit-enfant sous un enfant qui redonne l'objet sans le lire ; l'écriture plus bas que l'objet du petit-enfant
  'mid.mjs': js(['$item = null;'], '<i>-</i><@leaf sub={$item ? $item.b : null}></@leaf>'),
  'leaf.mjs': js(['$sub = null;'], "<em>{$sub ? JSON.stringify($sub) : '-'}</em>"),
  'pe.mjs':  js(['const garde = { a: { b: { c: { d: 0 } } } };', '$o = garde;', '@nom = function(v) { const t = $o.a.b.c; t.d = v; };', '@direct = function(v) { $o.a.b.c.d = v; };', '@raf = function() { µrefresh($o); };'], '<@mid item={$o.a}></@mid>'),
  // ordre des reffets du parent et de l'enfant
  'vo.mjs':  js(['$item = null;', 'µeffect(() => { JSON.stringify($item); window.__ordre.push("C"); });'], AFF),
  'mt.mjs':  js([...PAR, 'µeffect(() => { JSON.stringify($o); window.__ordre.push("P"); });'], '<p>{$o.a.b.c}</p><@vo item={$o.a}></@vo>'),
}
// appli seule : la seule prop qui part d'une variable la lit dans un appel, ou entre parenthèses
const SEULES: Record<string, Record<string, string>> = {
  appel: { 'vn.mjs': SOURCES['vn.mjs'], 'chx.mjs': js([...PAR, 'function choisir(o) { return o.a; }'], '<@vn item={choisir($o)}></@vn>') },
  parentheses: { 'vn.mjs': SOURCES['vn.mjs'], 'pa.mjs': js(PAR, '<@vn item={($o.a)}></@vn>') },
}
const REGLAGES: Array<[string, any]> = [['dev', {}], ['prod', { env: 'prod' }], ['prod-sans', { env: 'prod', proxy: false }], ['dev-sans', { proxy: false }]]
const ombre = (el: any) => el._shadow || el.shadowRoot || el
const tous  = (r: any, tag: string, out: any[] = []): any[] => { for (const e of Array.from(ombre(r).querySelectorAll('*')) as any[]) { if (e.tagName === tag) out.push(e); if (e._shadow || e.shadowRoot) tous(e, tag, out) } return out }
const txt   = (el: any, sel = 'em') => ombre(el).querySelector(sel)?.textContent ?? '?'

async function construire(nom: string, src: Record<string, string>, opts: any) {
  const root = mjsTmp('nom-comme-direct-' + nom), srcDir = join(root, 'src'), outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [f, s] of Object.entries(src)) writeFileSync(join(srcDir, f), s)
  const b = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), minify: false, ...opts } as any)
  const st = await b.compile(); await b.close()
  assert.deepEqual(st.errors.map((e: any) => e.message), [], 'construction')
  const rang = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  return readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
}

for (const [nom, opts] of REGLAGES) describe(`écriture par un nom comme l'écriture directe, sources de la prop (${nom})`, function () {
  this.timeout(240000)
  const sans = opts.proxy === false
  let code = ''
  const seules: Record<string, string> = {}
  const fen: any[] = []
  before(async () => {
    code = await construire(nom, SOURCES, opts)
    for (const [cas, src] of Object.entries(SEULES)) seules[cas] = await construire(nom + '-' + cas, src, opts)
  })
  after(async () => { for (const w of fen) w.close?.(); await terminateSharedWorkerPool() })
  async function appli(tag: string, c = code) {
    const win: any = new Window({ url: 'http://localhost/' })
    fen.push(win)
    win.__ordre = []; win.__eff = {}
    win.eval(`${c}\nglobalThis.µ = µ;`)
    win.document.body.innerHTML = `<mjs-${tag}></mjs-${tag}>`
    await tic()
    return { win, el: win.document.querySelector('mjs-' + tag) }
  }
  // l'écran (textes des balises `sel` des composants `tags`) après `pas`, dans une appli neuve
  async function ecran(tag: string, pas: (el: any) => void, tags: string[], c = code) {
    const { el } = await appli(tag, c)
    pas(el)
    await tic()
    return tags.map((t) => [el, ...tous(el, t.toUpperCase())].filter((e) => e.tagName === t.toUpperCase()).map((e) => txt(e, t === 'mjs-lay' ? 'p' : 'em')).join(' / '))
  }

  for (const cas of ['appel', 'parentheses']) it(`une prop qui lit sa variable ${cas === 'appel' ? 'dans un appel' : 'entre parenthèses'} : l'enfant suit l'écriture par un nom et µrefresh`, async () => {
    const tag = cas === 'appel' ? 'chx' : 'pa'
    const n = await ecran(tag, (el) => { el.nom(5); if (sans) el.raf() }, ['mjs-vn'], seules[cas])
    const d = await ecran(tag, (el) => { el.dehors(6); el.raf() }, ['mjs-vn'], seules[cas])
    assert.deepEqual([n, d], [['{"b":{"c":5}}'], ['{"b":{"c":6}}']])
  })
  for (const tag of ['cho', 'ter']) it(`${tag === 'cho' ? '`$sel ?? $o.a`' : '`$ok ? $o.a : $p.a`'} : µrefresh($o) redessine l'enfant, l'écriture par un nom aussi`, async () => {
    const d = await ecran(tag, (el) => { el.dehors(6); el.raf() }, ['mjs-vn'])
    const n = await ecran(tag, (el) => { el.nom(5); if (sans) el.raf() }, ['mjs-vn'])
    assert.deepEqual([d, n], [['{"b":{"c":6}}'], ['{"b":{"c":5}}']])
  })
  it('frères : celui qui écrit, par un nom ou directement, se redessine ; l\'autre, ni dans un cas ni dans l\'autre', async () => {
    const n = await ecran('sb', (el) => { const [e1] = tous(el, 'MJS-VS'); e1.nomE(4); if (sans) e1.rafE() }, ['mjs-vs'])
    const d = await ecran('sb', (el) => { tous(el, 'MJS-VS')[0].directE(4) }, ['mjs-vs'])
    assert.deepEqual(n, d)
    assert.deepEqual(d, ['{"b":{"c":4}} / {"b":{"c":0}}'])
  })
  it('frères liés par !{…} : le même écran sous l\'écriture par un nom et sous l\'écriture directe', async () => {
    const n = await ecran('lb', (el) => { const [e1] = tous(el, 'MJS-VL'); e1.nomE(4); if (sans) e1.rafE() }, ['mjs-vl'])
    const d = await ecran('lb', (el) => { tous(el, 'MJS-VL')[0].directE(4) }, ['mjs-vl'])
    assert.deepEqual(n, d)
  })
  it('mise en page : le parent qui écrit redessine la mise en page et l\'enfant glissé ; l\'enfant glissé qui écrit, le même écran sous les deux écritures', async () => {
    const p = await ecran('sl', (el) => { el.nom(7); if (sans) el.raf() }, ['mjs-lay', 'mjs-vs'])
    assert.deepEqual(p, ['{"a":{"b":{"c":7}}}', '{"b":{"c":7}}'])
    const n = await ecran('sl', (el) => { const [e] = tous(el, 'MJS-VS'); e.nomE(8); if (sans) e.rafE() }, ['mjs-lay', 'mjs-vs'])
    const d = await ecran('sl', (el) => { tous(el, 'MJS-VS')[0].directE(8) }, ['mjs-lay', 'mjs-vs'])
    assert.deepEqual(n, d)
  })
  it('petit-enfant sous un enfant qui redonne l\'objet sans le lire : il suit l\'écriture par un nom plus bas, comme l\'écriture directe', async () => {
    const n = await ecran('pe', (el) => { el.nom(3); if (sans) el.raf() }, ['mjs-leaf'])
    const d = await ecran('pe', (el) => { el.direct(3) }, ['mjs-leaf'])
    assert.deepEqual(n, d)
    assert.deepEqual(d, ['{"c":{"d":3}}'])
  })
  it('reffets du parent et de l\'enfant : le même ordre sous l\'écriture par un nom et sous l\'écriture directe', async () => {
    const ordre = async (m: string) => {
      const { win, el } = await appli('mt')
      win.__ordre.length = 0
      el[m](2); if (sans && m === 'nom') el.raf()
      await tic()
      return [win.__ordre.join(''), txt(tous(el, 'MJS-VO')[0])]
    }
    const n = await ordre('nom'), d = await ordre('direct')
    // sans enveloppe, `µrefresh` redessine l'enfant sans relancer ses reffets (docs/41-refresh.md) : l'écran seul se compare
    assert.deepEqual(sans ? n[1] : n, sans ? d[1] : d)
  })
})
