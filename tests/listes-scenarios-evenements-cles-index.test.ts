// listes sous happy-dom : treize scénarios d'événements (`{if}`, `{key}`, `{for}` dans `{if}` et dans une branche `{await}`, `<@element>`
// changé deux fois, listes imbriquées réordonnées, `.once`, `.stop`, `.propagate`, `.self`, `e.currentTarget`, survol, liaison à deux sens et
// `@input`, lignes reprises de la réserve, composant léger), des clés de toutes sortes (nombre, texte, booléen, bigint, symbole, objet, `NaN`,
// `-0`, doublons, `Map`, listes imbriquées) et l'index des liaisons filtrées (classe, attribut, style, lignes touchées par une sélection).
// Chaque scénario note ce qu'il voit (gestionnaires joués, lignes gardées ou refaites, avertissements, erreurs) ; le journal entier est
// comparé à celui attendu (`fixtures/listes-scenarios-evenements-cles-index.json`) : le routage des événements et l'index ne bougent pas
// quand la représentation interne des lignes change, une clé garde son type
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const stripEsm = (s: string) => s
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
  .replace(/\bexport\s+default\s+/g, '')
  .replace(/\bexport\s+/g, '')
  .replace(/import\.meta\.url/g, "'http://localhost/'")

const L = (s: string) => `globalThis.__log(${s})`
const S: Record<string, string> = {}
S['evif.mjs'] = `<script lang="js">
  $rows = [{ id: 1, on: true }, { id: 2, on: true }];
  @tog = function() { $rows = $rows.map((r) => ({ ...r, on: !r.on })); };
</script>
{for row in $rows by id}
  <div class="r"><span class="a" @click={${L("'a' + row.id")}}>a</span>{if row.on}<b class="b" @click={${L("'b' + row.id")}}>b</b>{end}</div>
{end}`
S['evkey.mjs'] = `<script lang="js">
  $rows = [{ id: 1, v: 1 }, { id: 2, v: 1 }];
  @bump = function() { $rows = $rows.map((r) => ({ ...r, v: r.v + 1 })); };
</script>
{for row in $rows by id}
  <div class="r">{key row.v}<b class="k" @click={${L("'k' + row.id + ':' + row.v")}}>k</b>{end}</div>
{end}`
S['evdyn.mjs'] = `<script>
$tag = 'span'
@chg = -> $tag = (if $tag is 'span' then 'em' else 'span')
</script>
<@element $tag class="dy" @click={${L("'dy:' + $tag")}}>x</@element>`
S['evnest.mjs'] = `<script lang="js">
  $gs = [{ id: 1, items: [{ id: 10 }, { id: 11 }] }, { id: 2, items: [{ id: 20 }] }];
  @rev = function() { $gs = $gs.map((g) => ({ ...g, items: g.items.slice().reverse() })).reverse(); };
</script>
{for g in $gs by id}
  <section><h3 class="g" @click={${L("'g' + g.id")}}>g</h3>{for it in g.items by id}<i class="it" @click={${L("'it' + g.id + '/' + it.id")}}>i</i>{end}</section>
{end}`
S['evonce.mjs'] = `<script lang="js">
  $rows = [{ id: 1 }, { id: 2 }];
</script>
{for row in $rows by id}
  <b class="w" @click.once={${L("'c' + row.id")}} @mousedown.once={${L("'m' + row.id")}}>w</b>
{end}`
S['evpool.mjs'] = `<script lang="js">
  $rows = [];
  $sel = 0;
  @set = function(a, b) { const r = []; for (let i = a; i <= b; i++) r.push({ id: i, label: 'l' + i }); $rows = r; };
  @clear = function() { $rows = []; };
  @swap = function() { const r = $rows.slice(); const t = r[1]; r[1] = r[r.length - 2]; r[r.length - 2] = t; $rows = r; };
  @del = function(row) { $rows = $rows.filter((r) => r !== row); };
  @relabel = function() { $rows = $rows.map((r) => ({ ...r, label: r.label + '!' })); };
</script>
<table><tbody>
  {for row in $rows by id}
    <tr :class{$sel === row.id}="danger"><td>{row.id}</td><td><a class="s" @click={$sel = row.id}>{row.label}</a></td><td><a class="x" @click={@del(row)}>x</a></td></tr>
  {end}
</tbody></table>`
S['evawait.mjs'] = `<script lang="js">
  $p = Promise.resolve([1, 2]);
</script>
{await $p}
  <p>...</p>
{success xs}
  {for x in xs}<a class="w" @click={${L("'w' + x")}}>{x}</a>{end}
{end}`
S['evifor.mjs'] = `<script lang="js">
  $show = true;
  $xs = [{ id: 1 }, { id: 2 }];
  @tog = function() { $show = !$show; };
</script>
{if $show}
  {for x in $xs by id}<a class="f" @click={${L("'f' + x.id")}}>f</a>{end}
{end}`
S['evstop.mjs'] = `<script lang="js">
  $rows = [{ id: 1 }];
</script>
{for row in $rows by id}
  <div class="o" @click={${L("'o' + row.id")}}><span class="st" @click.stop={${L("'st' + row.id")}}>s</span><span class="pr" @click.propagate={${L("'pr' + row.id")}}>p</span><span class="sf" @click.self={${L("'sf' + row.id")}}><i class="kid">k</i></span><a class="cur" @click={${L("'cur:' + e.currentTarget.className")}}><i class="kid2">k</i></a></div>
{end}`
S['evmouse.mjs'] = `<script lang="js">
  $rows = [{ id: 1 }, { id: 2 }];
</script>
{for row in $rows by id}
  <div class="m" @mouseenter={${L("'en' + row.id")}} @mouseleave={${L("'le' + row.id")}}><span class="in">x</span></div>
{end}
<p class="out">out</p>`
S['evtwo.mjs'] = `<script lang="js">
  $x = '';
  $rows = [{ id: 1 }];
</script>
<input class="t" value=!{$x} @input={${L("'in:' + $x")}}>
{for row in $rows by id}
  <input class="ri" @input={${L("'ri' + row.id")}} @change={${L("'rc' + row.id")}}>
{end}`
S['leger.mjs'] = `<script lang="js">
  $ys = [{ id: 1 }, { id: 2 }];
</script>
{for y in $ys by id}<a class="ly" @click={${L("'ly' + y.id")}}>y</a>{end}`
S['hote.mjs'] = `<script lang="js">
  $zs = [{ id: 1 }];
</script>
{for z in $zs by id}<a class="hz" @click={${L("'hz' + z.id")}}>z</a>{end}
<@leger :lightDom @click={${L("'hostOnLeger'")}}/>`
S['cles.mjs'] = `<script lang="js">
  $a = [];
  $m = new Map();
  $n = [];
  @setA = function(x) { $a = x; };
  @setM = function(x) { $m = x; };
  @setN = function(x) { $n = x; };
</script>
<ul class="a">{for row in $a by id}<li>{row.l}</li>{end}</ul>
<ul class="m">{for p in $m}<li>{p[1]}</li>{end}</ul>
<div class="n">{for g in $n by id}<p>{for it in g.items by id}<i>{it.l}</i>{end}</p>{end}</div>`
S['filt.mjs'] = `<script lang="js">
  $rows = [];
  $sel = 0;
  $ville = '';
  @set = function(x) { $rows = x; };
  @pick = function(v) { $sel = v; };
  @pickV = function(v) { $ville = v; };
</script>
<table class="c"><tbody>
  {for row in $rows by id}
    <tr :class{$sel === row.id}="danger" data-h={row.id === $sel ? row.h : ''}><td :class{$ville === row.ville}="actif" :style.color={row.id === $sel ? row.c : ''}>{row.id}</td></tr>
  {end}
</tbody></table>`

const tic = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)) }

const ATTENDU = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'listes-scenarios-evenements-cles-index.json'), 'utf-8'))

describe('listes — scénarios d\'événements, de clés et d\'index des liaisons filtrées, journal comparé', function () {
  this.timeout(120000)
  let win: any
  const log: string[] = []
  const avis: string[] = []
  const errs: string[] = []
  const R: Record<string, any> = {}

  before(async () => {
    const root = mjsTmp('listes-scenarios')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [n, s] of Object.entries(S)) writeFileSync(join(srcDir, n), s)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    win = new Window({ url: 'http://localhost/' })
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const coeur = files.find((f) => /^mjs_core-/.test(f))!
    const code = files.filter((f) => f !== coeur).reduce((acc, f) => acc + '\n' + stripEsm(readFileSync(join(outDir, f), 'utf-8')), stripEsm(readFileSync(join(outDir, coeur), 'utf-8')))
    win.__log = (s: string) => { log.push(s) }
    win.eval(`${code}\nglobalThis.µ = µ;`)
    win.console.warn = (...a: any[]) => { avis.push(a.map(String).join(' ')) }
    win.console.error = (...a: any[]) => { errs.push(a.map((x: any) => x && x.stack ? String(x.stack).split('\n')[0] : String(x)).join(' ')) }
    win.addEventListener('error', (e: any) => { errs.push('uncaught ' + (e.error ? String(e.error.stack).split('\n')[0] : e.message)) })
    win.document.body.innerHTML = Object.keys(S).filter((n) => n !== 'leger.mjs').map((n) => `<mjs-${n.replace('.mjs', '')}></mjs-${n.replace('.mjs', '')}>`).join('')
    await tic()
    await tic()
  })
  after(async () => {
    win?.close?.()
    await terminateSharedWorkerPool()
  })

  const comp = (t: string) => win.document.querySelector('mjs-' + t)
  const rt = (t: string) => { const e = comp(t); return e._shadow || e.shadowRoot }
  const all = (t: string, sel: string) => Array.from(rt(t).querySelectorAll(sel)) as any[]
  const ev = async (n: any, type: string, init: any = {}) => {
    try { n.dispatchEvent(new win.MouseEvent(type, { bubbles: true, composed: true, ...init })) } catch (e: any) { errs.push(type + ' dispatch ' + String(e)) }
    await tic()
  }
  const run = async (nom: string, f: () => Promise<void>) => {
    log.length = 0
    const e0 = errs.length
    try { await f() } catch (e: any) { log.push('EXC ' + String(e && e.message)) }
    R[nom] = { log: log.slice(), errs: errs.slice(e0) }
  }

  it('événements', async () => {
    await run('evif', async () => {
      for (const n of [...all('evif', '.a'), ...all('evif', '.b')]) await ev(n, 'click')
      comp('evif').tog(); await tic(); log.push('nb b=' + all('evif', '.b').length)
      comp('evif').tog(); await tic()
      for (const n of [...all('evif', '.a'), ...all('evif', '.b')]) await ev(n, 'click')
    })
    await run('evkey', async () => {
      for (const n of all('evkey', '.k')) await ev(n, 'click')
      comp('evkey').bump(); await tic()
      for (const n of all('evkey', '.k')) await ev(n, 'click')
    })
    await run('evdyn', async () => {
      for (let i = 0; i < 3; i++) { const n = all('evdyn', '.dy')[0]; log.push('tag=' + (n && n.localName)); if (n) await ev(n, 'click'); comp('evdyn').chg(); await tic() }
    })
    await run('evnest', async () => {
      for (const n of [...all('evnest', '.g'), ...all('evnest', '.it')]) await ev(n, 'click')
      comp('evnest').rev(); await tic()
      for (const n of [...all('evnest', '.g'), ...all('evnest', '.it')]) await ev(n, 'click')
    })
    await run('evonce', async () => {
      for (const n of all('evonce', '.w')) { await ev(n, 'click'); await ev(n, 'click'); await ev(n, 'mousedown'); await ev(n, 'mousedown') }
    })
    await run('evpool', async () => {
      const c = comp('evpool')
      const etat = (q: string) => log.push(q + ' sel=' + c._state.sel + ' rows=' + all('evpool', 'tr').map((t) => t.firstElementChild.textContent + (t.classList.contains('danger') ? '*' : '')).join(','))
      c.set(1, 5); await tic(); await ev(all('evpool', '.s')[2], 'click'); etat('A')
      c.clear(); await tic(); c.set(11, 15); await tic(); await ev(all('evpool', '.s')[1], 'click'); etat('B')
      c.swap(); await tic(); await ev(all('evpool', '.s')[1], 'click'); etat('C')
      await ev(all('evpool', '.x')[0], 'click'); await ev(all('evpool', '.s')[0], 'click'); etat('D')
      c.relabel(); await tic(); await ev(all('evpool', '.s')[3], 'click'); etat('E')
      c.set(13, 18); await tic(); await ev(all('evpool', '.s')[5], 'click'); etat('F')
    })
    await run('evawait', async () => {
      await tic(); await tic()
      for (const n of all('evawait', '.w')) await ev(n, 'click')
    })
    await run('evifor', async () => {
      for (const n of all('evifor', '.f')) await ev(n, 'click')
      comp('evifor').tog(); await tic(); comp('evifor').tog(); await tic()
      for (const n of all('evifor', '.f')) await ev(n, 'click')
    })
    await run('evstop', async () => {
      for (const s of ['.st', '.pr', '.kid', '.sf', '.kid2', '.cur']) { log.push('>' + s); await ev(all('evstop', s)[0], 'click') }
    })
    await run('evmouse', async () => {
      const [a, b] = all('evmouse', '.in'), out = all('evmouse', '.out')[0]
      await ev(a, 'mouseover', { relatedTarget: out })
      await ev(a, 'mouseout', { relatedTarget: b }); await ev(b, 'mouseover', { relatedTarget: a })
      await ev(b, 'mouseout', { relatedTarget: out }); await ev(out, 'mouseover', { relatedTarget: b })
    })
    await run('evtwo', async () => {
      const t = all('evtwo', 'input.t')[0]; t.value = 'abc'; t.dispatchEvent(new win.Event('input', { bubbles: true, composed: true })); await tic()
      const r = all('evtwo', 'input.ri')[0]; r.dispatchEvent(new win.Event('input', { bubbles: true, composed: true })); await tic(); r.dispatchEvent(new win.Event('change', { bubbles: true, composed: true })); await tic()
    })
    await run('leger', async () => {
      const lg = rt('hote').querySelector('mjs-leger')
      log.push('leger=' + !!lg)
      for (const n of [...all('hote', '.hz'), ...Array.from(lg ? lg.querySelectorAll('.ly') : [])]) await ev(n, 'click')
      if (lg) await ev(lg, 'click')
    })
  })

  it('clés', async () => {
    const c = comp('cles')
    let gen = 0
    const pose = async (nom: string, sel: string, f: () => void) => {
      for (const n of all('cles', sel)) if (n.__g === undefined) n.__g = ++gen
      const a0 = avis.length
      const e0 = errs.length
      try { f() } catch (e: any) { errs.push('pose ' + String(e && e.message)) }
      await tic()
      R['k-' + nom] = { li: all('cles', sel).map((n) => n.textContent + '#' + (n.__g ?? 'neuf')), avis: avis.slice(a0).map((s) => s.slice(0, 90)), errs: errs.slice(e0) }
    }
    await pose('nan-1', 'ul.a li', () => c.setA([{ id: NaN, l: 'nan' }, { id: 1, l: 'one' }]))
    await pose('nan-2', 'ul.a li', () => c.setA([{ id: 1, l: 'one' }, { id: NaN, l: 'nan' }]))
    await pose('nan-3', 'ul.a li', () => c.setA([{ id: 1, l: 'one' }, { id: NaN, l: 'nan' }]))
    await pose('z-1', 'ul.a li', () => c.setA([{ id: -0, l: 'z' }]))
    await pose('z-2', 'ul.a li', () => c.setA([{ id: 0, l: 'z' }]))
    await pose('bool', 'ul.a li', () => c.setA([{ id: true, l: 't' }, { id: 'true', l: 'ts' }]))
    await pose('big-1', 'ul.a li', () => c.setA([{ id: 1n, l: 'b' }]))
    await pose('big-2', 'ul.a li', () => c.setA([{ id: 1n, l: 'b' }, { id: 1, l: 'n' }]))
    const s1 = Symbol('k'), s2 = Symbol('k')
    await pose('sym', 'ul.a li', () => c.setA([{ id: s1, l: 's1' }, { id: s2, l: 's2' }]))
    class K { v: string; constructor(v: string) { this.v = v } toString() { return 'K' + this.v } }
    await pose('tostr', 'ul.a li', () => c.setA([{ id: new K('1'), l: 'k1' }, { id: new K('1'), l: 'k1bis' }]))
    const o1 = {}, o2 = {}
    await pose('obj-1', 'ul.a li', () => c.setA([{ id: o1, l: 'o1' }, { id: o2, l: 'o2' }]))
    await pose('obj-2', 'ul.a li', () => c.setA([{ id: o2, l: 'o2' }, { id: o1, l: 'o1' }]))
    await pose('dup', 'ul.a li', () => c.setA([{ id: 5, l: 'a' }, { id: 5, l: 'b' }, { id: 6, l: 'c' }]))
    await pose('type-1', 'ul.a li', () => c.setA([{ id: 7, l: 's' }]))
    await pose('type-2', 'ul.a li', () => c.setA([{ id: '7', l: 's' }]))
    await pose('type-3', 'ul.a li', () => c.setA([{ id: 7, l: 's' }]))
    await pose('mix-1', 'ul.a li', () => c.setA([{ id: 1, l: 'n1' }, { id: null, l: 'vide' }, { id: '2', l: 't2' }]))
    await pose('map', 'ul.m li', () => c.setM(new win.Map([[1, 'un'], ['1', 'texte'], [2, 'deux']])))
    await pose('map-2', 'ul.m li', () => c.setM(new win.Map([[2, 'deux'], [1, 'un'], ['1', 'texte']])))
    await pose('nest-1', 'div.n i', () => c.setN([{ id: 1, items: [{ id: 1, l: 'a' }, { id: 2, l: 'b' }] }, { id: 2, items: [{ id: 1, l: 'c' }] }]))
    await pose('nest-2', 'div.n i', () => c.setN([{ id: 2, items: [{ id: 1, l: 'c' }] }, { id: 1, items: [{ id: 2, l: 'b' }, { id: 1, l: 'a' }] }]))
  })

  it('index des liaisons filtrées', async () => {
    const c = comp('filt')
    const etat = (q: string) => {
      R['f-' + q] = all('filt', 'tr').map((t) => t.firstElementChild.textContent + (t.classList.contains('danger') ? '*' : '') + (t.getAttribute('data-h') ? '[' + t.getAttribute('data-h') + ']' : '') + (t.firstElementChild.classList.contains('actif') ? 'A' : '') + (t.firstElementChild.style.color ? '{' + t.firstElementChild.style.color + '}' : '')).join(',')
    }
    const L5 = (ids: number[], ville = (i: number) => (i % 2 ? 'A' : 'B')) => ids.map((i) => ({ id: i, h: 'h' + i, c: 'red', ville: ville(i) }))
    let touchees = new Set<any>()
    const prends = () => { mo.takeRecords().forEach((m: any) => touchees.add(m.target.closest('tr'))); const n = touchees.size; touchees = new Set(); return n }
    const mo = new win.MutationObserver((ms: any[]) => { for (const m of ms) touchees.add(m.target.closest('tr')) })
    c.set(L5([1, 2, 3, 4, 5])); await tic(); etat('1')
    mo.observe(rt('filt').querySelector('tbody'), { subtree: true, attributes: true })
    c.pick(3); await tic(); R['f-touchees-pick3'] = prends(); etat('2')
    c.pickV('A'); await tic(); prends(); etat('3')
    c.set(L5([1, 3, 5])); await tic(); etat('4')
    c.set(L5([1, 3, 5, 8, 9])); await tic(); etat('5')
    prends(); c.pick(2); await tic(); R['f-touchees-pick2'] = prends(); etat('6')
    c.pick(8); await tic(); R['f-touchees-pick8'] = prends(); etat('7')
    c.set(L5([1, 3, 5, 8, 9], (i) => (i === 8 ? 'A' : i === 1 ? 'B' : (i % 2 ? 'A' : 'B')))); await tic(); etat('8')
    c.pickV('B'); await tic(); etat('9')
    c.set([]); await tic(); c.set(L5([3, 8, 20])); await tic(); etat('10')
    c.pick(20); await tic(); etat('11')
    c.pick(3); await tic(); etat('12')
    c.set(L5([20, 3])); await tic(); c.pick(8); await tic(); etat('13')
    c.set(L5([20, 3, 8, 30, 31])); await tic(); etat('14')
    prends(); c.pick(31); await tic(); R['f-touchees-pick31'] = prends(); etat('15')
    mo.disconnect()
    R['f-idx'] = Object.fromEntries(Object.entries(c._mjs_filt || {}).map(([k, v]: any) => [k, v.idx ? Array.from(v.idx.keys()).map(String).join('|') : null]))
  })

  it('le journal relevé est celui attendu', () => {
    R.__errs = errs
    for (const nom of Object.keys(ATTENDU)) assert.deepEqual(R[nom], ATTENDU[nom], `scénario ${nom}`)
    assert.deepEqual(Object.keys(R).sort(), Object.keys(ATTENDU).sort(), 'les mêmes scénarios')
  })
})
