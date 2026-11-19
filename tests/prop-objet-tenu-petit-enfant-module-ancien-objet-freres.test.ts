// L'objet de l'état d'un parent redonné plus bas, et ce que l'enfant ne tient plus. Un enfant qui reçoit `item={$o.a}` et redonne
// `sub={$item.b}` à son propre enfant : quand le parent écrit dedans par un nom (`t = $o.a.b; t.c = v`, ou plus bas que l'objet du
// petit-enfant), ou signale par `µrefresh($o)` un changement fait hors de MJS, l'enfant ET le petit-enfant se redessinent, dans les quatre
// réglages (avec le réglage `proxy: false`, l'écriture par un nom se signale aussi par `µrefresh($o)`). De même pour la prop d'un composant
// dynamique (`<@module $comp item={$o.a}>`). L'enfant qui a changé d'objet (`item={$o[$k]}`, puis `$k = 'b'`) n'est plus prévenu par une
// écriture dans l'objet qu'il ne tient plus : son reffet ne repart pas. Deux frères qui tiennent le même objet : celui qui écrit dedans, par un
// nom ou directement, redessine l'autre (sans l'enveloppe, non) — le même écran dans les deux cas. Un enfant détruit n'est plus appelé. Une boucle qui écrit par un nom dans chaque ligne d'une
// liste dont chaque ligne va à un enfant : chaque enfant suit. Cœur construit, monté dans happy-dom
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const tic = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) }
const js  = (script: string[], gabarit: string) => ['<script lang="js">', ...script.map((l) => '  ' + l), '</script>', gabarit].join('\n')
const RAF = '@rafraichir = function() { µrefresh($o); };'
const SER = `globalThis.__ser = function ser(x) { return x === null || typeof x !== 'object' ? String(JSON.stringify(x)) : JSON.stringify(x); };`
const PAR = (o: string, nom: string, direct: string, dehors: string) => ['const garde = ' + o + ';', '$o = garde;', '@nom = function(v) { ' + nom + ' };', '@direct = function(v) { ' + direct + ' };', '@dehors = function(v) { ' + dehors + ' };', RAF]

// un pas : [méthode, argument, 'nom' (µrefresh sans l'enveloppe) | 'dehors' (µrefresh toujours) | '']
type Pas = [string, any, string]
const CAS: Record<string, [string, Pas[]]> = {
  // le petit-enfant tient l'objet écrit
  'zi-petit': [js(PAR('{ a: { b: { c: 0 } } }', 'const t = $o.a.b; t.c = v;', '$o.a.b.c = v;', 'garde.a.b.c = v;'), '<p>{JSON.stringify($o)}</p><@zim item={$o.a}></@zim>'), [['nom', 1, 'nom'], ['direct', 2, ''], ['dehors', 3, 'dehors'], ['nom', 4, 'nom']]],
  // l'objet écrit est plus bas que celui du petit-enfant
  'zi-petit-bas': [js(PAR('{ a: { b: { c: { d: 0 } } } }', 'const t = $o.a.b.c; t.d = v;', '$o.a.b.c.d = v;', 'garde.a.b.c.d = v;'), '<p>{JSON.stringify($o)}</p><@zim item={$o.a}></@zim>'), [['nom', 5, 'nom'], ['dehors', 6, 'dehors'], ['direct', 7, '']]],
  // composant dynamique
  'zi-module': [js([...PAR('{ a: { b: { c: 0 } } }', 'const t = $o.a.b; t.c = v;', '$o.a.b.c = v;', 'garde.a.b.c = v;'), '$comp = "mjs-zv";'], '<@module $comp item={$o.a}></@module>'), [['nom', 5, 'nom'], ['dehors', 6, 'dehors'], ['direct', 7, '']]],
}
const SOURCES: Record<string, string> = {
  'zv.mjs': js(['$item = null;'], '<em>{window.__ser($item)}</em>'),
  'zim.mjs': js(['$item = null;'], '<em>{window.__ser($item)}</em><@zil sub={$item ? $item.b : null}></@zil>'),
  'zil.mjs': js(['$sub = null;'], '<em>{window.__ser($sub)}</em>'),
  // l'enfant qui a changé d'objet : son reffet compte ses passages
  'zie.mjs': js(['$item = null;', 'window.__eff = 0;', 'µeffect(() => { JSON.stringify($item); window.__eff++; });'], '<em>{window.__ser($item)}</em>'),
  'zi-ancien.mjs': js(['const garde = { a: { x: { v: 0 } }, b: { x: { v: 0 } } };', '$o = garde;', '$k = "a";', '@basculer = function() { $k = "b"; };', '@nomA = function(v) { const t = $o.a.x; t.v = v; };', '@nomB = function(v) { const t = $o.b.x; t.v = v; };', RAF], '<@zie item={$o[$k]}></@zie>'),
  // deux frères qui tiennent le même objet ; le premier écrit dedans par un nom, ou directement
  'zif.mjs': js(['$item = null;', '@nomE = function(v) { const t = $item.b; t.c = v; };', '@directE = function(v) { $item.b.c = v; };', '@rafE = function() { µrefresh($item); };'], '<em>{window.__ser($item)}</em>'),
  'zi-freres.mjs': js(['$o = { a: { b: { c: 0 } } };', RAF], '<p>{JSON.stringify($o)}</p><@zif item={$o.a}></@zif><@zif item={$o.a}></@zif>'),
  // enfant détruit
  'zi-detruit.mjs': js([...PAR('{ a: { b: { c: 0 } } }', 'const t = $o.a.b; t.c = v;', '$o.a.b.c = v;', 'garde.a.b.c = v;'), '$voir = true;', '@cacher = function() { $voir = false; };'], '{if $voir}<@zv item={$o.a}></@zv>{end}'),
  // une boucle qui écrit par un nom dans chaque ligne, chaque ligne tenue par un enfant
  'zir.mjs': js(['$item = null;'], "<em>{$item ? String($item.x.c) : '-'}</em>"),
  'zi-boucle.mjs': js(['$rows = Array.from({ length: 40 }, (_, i) => ({ id: i, x: { c: 0 } }));', '@tous = function(v) { for (const r of $rows) { const t = r.x; t.c = v; } };', '@rafraichir = function() { µrefresh($rows); };'], '{for r in $rows by id}<@zir item={r}></@zir>{end}'),
}
for (const [n, [s]] of Object.entries(CAS)) SOURCES[n + '.mjs'] = s

const REGLAGES: Array<[string, any]> = [['dev', {}], ['prod', { env: 'prod' }], ['prod sans enveloppe', { env: 'prod', proxy: false }], ['dev sans enveloppe', { proxy: false }]]
const ombre = (el: any) => el._shadow || el.shadowRoot || el
const tous  = (r: any, out: any[] = []): any[] => { for (const e of Array.from(ombre(r).querySelectorAll('*')) as any[]) { if (/^MJS-Z/.test(e.tagName)) out.push(e); if (e._shadow || e.shadowRoot) tous(e, out) } return out }
const tenu  = (win: any, k: any) => win.__ser(win.µ._mjs_toRaw(k._state.item !== undefined ? k._state.item : k._state.sub))

for (const [nom, opts] of REGLAGES) describe(`objet de l'état redonné plus bas, composant dynamique, objet quitté, frères (${nom})`, function () {
  this.timeout(180000)
  const sans = opts.proxy === false
  let code = ''
  const fenetres: any[] = []
  before(async () => {
    const root = mjsTmp('prop-objet-tenu-petit-enfant'), srcDir = join(root, 'src'), outDir = join(root, 'out')
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
  after(async () => { for (const w of fenetres) w.close?.(); await terminateSharedWorkerPool() })
  async function appli(balise: string) {
    const win: any = new Window({ url: 'http://localhost/' })
    fenetres.push(win)
    win.eval(SER)
    win.eval(`${code}\nglobalThis.µ = µ;`)
    win.__avis = []
    win.µ.warn = (...a: any[]) => { win.__avis.push(a.join(' ')) }
    // appels reçus par chaque composant : `_set`, `_mjs_notifyMutation`
    win.eval(`(() => { const P = µ.Element.prototype; for (const m of ['_mjs_notifyMutation', '_set']) { const f = P[m]; P[m] = function (...a) { const c = this.__n ||= {}; c[m] = (c[m] || 0) + 1; return f.apply(this, a) } } })()`)
    win.document.body.innerHTML = `<mjs-${balise}></mjs-${balise}>`
    await tic()
    return { win, el: win.document.querySelector('mjs-' + balise) }
  }
  const ecartsDe = (win: any, el: any, quoi: string, out: string[]) => tous(el).forEach((k: any, i: number) => {
    const montre = ombre(k).querySelector('em')?.textContent, t = tenu(win, k)
    if (montre !== t) out.push(`${quoi} : ${k.tagName.toLowerCase()} ${i} montre ${montre}, tient ${t}`)
  })
  for (const [balise, [, pas]] of Object.entries(CAS)) it(`${balise} : l'enfant et le petit-enfant suivent`, async () => {
    const { win, el } = await appli(balise)
    const ecarts: string[] = []
    for (const [m, v, genre] of pas) {
      el[m](v)
      const raf = genre === 'dehors' || (genre === 'nom' && sans)
      if (raf) el.rafraichir()
      await tic()
      ecartsDe(win, el, `${m}(${v})${raf ? ' + µrefresh($o)' : ''}`, ecarts)
    }
    if (win.__avis.length) ecarts.push('avis : ' + win.__avis.join(' / '))
    assert.deepEqual(ecarts, [])
  })
  it('zi-ancien : l\'enfant qui a changé d\'objet n\'est plus prévenu par l\'ancien, et suit le nouveau', async () => {
    const { win, el } = await appli('zi-ancien')
    el.basculer(); await tic()
    const ecarts: string[] = []
    const avant = win.__eff
    el.nomA(9); if (sans) el.rafraichir()
    await tic()
    if (win.__eff !== avant) ecarts.push(`écriture dans l'ancien objet : reffet de l'enfant +${win.__eff - avant}`)
    ecartsDe(win, el, 'nomA(9)', ecarts)
    el.nomB(3); if (sans) el.rafraichir()
    await tic()
    ecartsDe(win, el, 'nomB(3)', ecarts)
    assert.deepEqual(ecarts, [])
  })
  it('zi-freres : le frère qui tient le même objet suit l\'écriture directe et l\'écriture par un nom de l\'autre (sans enveloppe, ni l\'une ni l\'autre), le même écran', async () => {
    const ecran = async (m: string) => {
      const { el } = await appli('zi-freres')
      const [e1, e2] = tous(el)
      e1[m](4); if (sans) e1.rafE()
      await tic()
      return [e1, e2].map((e: any) => (e._shadow || e.shadowRoot || e).querySelector('em')?.textContent)
    }
    const nom = await ecran('nomE'), direct = await ecran('directE')
    assert.deepEqual(nom, direct)
    assert.deepEqual(direct, sans ? ['{"b":{"c":4}}', '{"b":{"c":0}}'] : ['{"b":{"c":4}}', '{"b":{"c":4}}'])
  })
  it('zi-detruit : l\'enfant détruit n\'est plus appelé', async () => {
    const { el } = await appli('zi-detruit')
    const [mort] = tous(el)
    el.cacher(); await tic()
    const avant = JSON.stringify(mort.__n)
    el.nom(5); if (sans) el.rafraichir()
    await tic()
    assert.equal(JSON.stringify(mort.__n), avant)
  })
  it('zi-boucle : une boucle qui écrit par un nom dans chaque ligne redessine chaque enfant', async () => {
    const { win, el } = await appli('zi-boucle')
    const ecarts: string[] = []
    for (const v of [3, 8]) {
      el.tous(v); if (sans) el.rafraichir()
      await tic()
      const vus = tous(el).map((k: any) => ombre(k).querySelector('em')?.textContent)
      if (vus.length !== 40 || vus.some((x: string) => x !== String(v))) ecarts.push(`tous(${v}) : ${[...new Set(vus)].join(',')} (${vus.length} enfants)`)
    }
    if (win.__avis.length) ecarts.push('avis : ' + win.__avis.join(' / '))
    assert.deepEqual(ecarts, [])
  })
})
