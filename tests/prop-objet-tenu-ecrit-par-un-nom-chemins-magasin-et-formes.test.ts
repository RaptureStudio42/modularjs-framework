// Un enfant qui tient un objet de l'état de son parent, ou du magasin que lit son parent, se redessine quand le parent écrit plus bas par un
// nom qui garde l'objet écrit : objet déplacé sous un autre conteneur (`x = $o.a.b; $o.z.m = x; delete $o.a.b; x.c = v`), objet atteint par
// deux chemins (l'enfant tient le second), ligne d'un `{for}` ou objet de la ligne, objet écrit par la rune `µproxy`, valeur d'une `Map`,
// `Set` ou `Date` sous l'objet tenu, CoffeeScript et Civet. Avec l'enveloppe (défaut), l'écriture passe par
// elle et l'enfant suit sans rien écrire d'autre ; avec le réglage `proxy: false`, `µrefresh($o)` la signale. Magasin (`t = $$o.a.b; t.c = v`) :
// ses lectures ne passent par aucune enveloppe, `µrefresh($$o)` signale l'écriture par un nom faite sous l'objet tenu. Un
// changement fait hors de MJS (objet gelé au milieu, objet gardé dans une variable sans `$`), signalé par `µrefresh`, redessine l'enfant dans
// les quatre réglages, y compris celui qui a changé d'objet (`item={$o[$k]}`, puis `$k = 'b'`). `µrefresh($o)` ne lit aucun accesseur de
// l'appli et ne lève pas son exception. Quatre réglages : développement et production, avec et sans enveloppe. Cœur construit, monté dans
// happy-dom
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

const SER = `globalThis.__ser = function ser(x, vu = new Set()) {
  if (x === null || typeof x !== 'object') return String(JSON.stringify(x));
  if (vu.has(x)) return '#';
  vu.add(x);
  let s;
  if (x instanceof Map) s = 'Map{' + [...x].map(([k, v]) => ser(k, vu) + ':' + ser(v, vu)).join(',') + '}';
  else if (x instanceof Set) s = 'Set{' + [...x].map((v) => ser(v, vu)).join(',') + '}';
  else if (x instanceof Date) s = 'Date(' + x.getTime() + ')';
  else if (Array.isArray(x)) s = '[' + x.map((v) => ser(v, vu)).join(',') + ']';
  else s = '{' + Object.keys(x).filter((k) => 'value' in Object.getOwnPropertyDescriptor(x, k)).map((k) => k + ':' + ser(x[k], vu)).join(',') + '}';
  vu.delete(x);
  return s;
};`

// [sources du parent, pas] ; un pas : [méthode, argument, 'nom' (écriture par un nom : µrefresh sans l'enveloppe) | 'dehors' (µrefresh toujours) | '']
type Pas = [string, any, string]
const CAS: Record<string, [string, Pas[]]> = {
  // objet déplacé sous un autre conteneur, puis écrit par le nom gardé ; l'enfant tient le nouveau conteneur
  'zc-deplace': [js(['let x = null;', '$o = { a: { b: { c: 0 } }, z: { w: 0 } };', '@deplacer = function() { x = $o.a.b; $o.z.m = x; delete $o.a.b; };', '@ecrire = function(v) { x.c = v; };', RAF], '<p>{JSON.stringify($o)}</p><@zv item={$o.z}></@zv>'), [['deplacer', 0, 'nom'], ['ecrire', 5, 'nom'], ['ecrire', 6, 'nom']]],
  // la forme de la mission : l'objet déplacé est lui-même tenu
  'zc-deplace2': [js(['let x = null;', '$o = { a: { b: { c: 0 } }, z: null };', '@deplacer = function() { x = $o.a.b; $o.z = x; delete $o.a.b; };', '@ecrire = function(v) { x.c = v; };', RAF], '<p>{JSON.stringify($o)}</p><@zv item={$o.z}></@zv>'), [['deplacer', 0, 'nom'], ['ecrire', 5, 'nom']]],
  // un objet atteint par deux chemins, lu d'abord par le premier ; l'enfant tient le second
  'zc-deux': [js(['const s = { c: 0 };', '$o = { a: { s: s }, b: { s: s } };', '@ecrire = function(v) { const t = $o.b.s; t.c = v; };', RAF], '<p>{$o.a.s.c}</p><@zv item={$o.b}></@zv>'), [['ecrire', 5, 'nom']]],
  // ligne d'une liste : l'enfant tient la ligne, ou un objet de la ligne
  'zc-ligne': [js(['$o = [{ id: 1, n: 0 }, { id: 2, n: 0 }, { id: 3, n: 0 }, { id: 4, n: 0 }];', '@ecrire = function(v) { const t = $o[3]; t.n = v; };', RAF], '{for r in $o by id}<@zv item={r}></@zv>{end}'), [['ecrire', 5, 'nom']]],
  'zc-ligne2': [js(['$o = [{ id: 1, x: { c: { d: 0 } } }, { id: 2, x: { c: { d: 0 } } }];', '@ecrire = function(v) { const t = $o[1].x.c; t.d = v; };', RAF], '{for r in $o by id}<@zv item={r.x}></@zv>{end}'), [['ecrire', 5, 'nom']]],
  // rune µproxy
  'zc-proxy': [js(['$o = { a: { b: { c: 0 } } };', '@ecrire = function(v) { const t = µproxy $o.a.b; t.c = v; };', RAF], '<@zv item={$o.a}></@zv>'), [['ecrire', 5, 'nom']]],
  // Map, Set, Date sous l'objet tenu
  'zc-mapset': [js(['$o = { a: { m: new Map([["k", { c: 0 }]]), s: new Set([1]), d: new Date(0) } };', '@ecrire = function(v) { const t = $o.a.m.get("k"); t.c = v; };', '@ecrire2 = function(v) { const s = $o.a.s; s.add(v); };', '@ecrire3 = function(v) { const d = $o.a.d; d.setTime(v * 1000); };', RAF], '<@zv item={$o.a}></@zv>'), [['ecrire', 5, 'nom'], ['ecrire2', 7, 'nom'], ['ecrire3', 9, 'nom']]],
  // objet gelé au milieu : l'écriture plus bas passe hors de l'enveloppe
  'zc-gel': [js(['$o = { a: Object.freeze({ b: { c: 0 } }) };', '@ecrire = function(v) { const t = $o.a.b; t.c = v; };', RAF], '<@zv item={$o.a}></@zv>'), [['ecrire', 5, 'dehors']]],
  // l'enfant change d'objet, puis un changement fait dehors dans le nouvel objet est signalé par µrefresh($o)
  'zc-bascule': [js(['const garde = { a: { v: 1 }, b: { v: 2 } };', '$o = garde;', '$k = "a";', '@basculer = function() { $k = "b"; };', '@dehors = function(v) { garde.b.v = v; };', '@rien = function() {};', RAF], '<@zv item={$o[$k]}></@zv>'), [['rien', 0, 'dehors'], ['basculer', 0, ''], ['dehors', 7, 'dehors']]],
  // magasin : `$$zmo.a.b` se lit sans enveloppe, rien ne dit par où le nom est venu — l'écriture par un nom sous l'objet tenu se signale par
  // `µrefresh($$zmo)`, dans les quatre réglages
  'zc-magasin': [js(['$$zmo = { a: { b: { c: 0 } } };', '@ecrire = function(v) { const t = $$zmo.a.b; t.c = v; };', '@dehors = function(v) { µread($$zmo).a.b.c = v; };', '@rafraichir = function() { µrefresh($$zmo); };'], '<p>{$$zmo.a.b.c}</p><@zv item={$$zmo.a}></@zv>'), [['ecrire', 5, 'dehors'], ['dehors', 6, 'dehors']]],
  // magasin : écriture directe (témoin du mécanisme d'avant)
  'zc-magasin-direct': [js(['$$zmd = { a: { b: { c: 0 } } };', '@ecrire = function(v) { $$zmd.a.b.c = v; };', '@rafraichir = function() { µrefresh($$zmd); };'], '<p>{$$zmd.a.b.c}</p><@zv item={$$zmd.a}></@zv>'), [['ecrire', 5, '']]],
  // CoffeeScript et Civet : écriture par un nom
  'zc-coffee': ['<script lang="coffee">\n$o = { a: { b: { c: { d: 0 } } } }\n@ecrire = (v) ->\n  t = $o.a.b.c\n  t.d = v\n  return\n@rafraichir = ->\n  µrefresh($o)\n  return\n</script>\n<@zv item={$o.a}></@zv>', [['ecrire', 5, 'nom']]],
  'zc-civet': ['<script>\n$o = { a: { b: { c: { d: 0 } } } }\n@ecrire = (v) ->\n  t := $o.a.b.c\n  t.d = v\n  return\n@rafraichir = ->\n  µrefresh($o)\n  return\n</script>\n<@zv item={$o.a}></@zv>', [['ecrire', 5, 'nom']]],
}
// accesseurs propres lus par µrefresh
const ACCES = js(['window.__read = 0;', '$o = { a: { c: 0 }, get lourd() { window.__read++; return 1; } };', RAF], '<@zv item={$o.a}></@zv>')
const BOUM  = js(['$o = { a: { c: 0 }, get boum() { throw new Error("accesseur de l appli"); } };', RAF], '<@zv item={$o.a}></@zv>')

const SOURCES: Record<string, string> = { 'zv.mjs': js(['$item = null;'], '<em>{window.__ser($item)}</em>'), 'zc-acces.mjs': ACCES, 'zc-boum.mjs': BOUM }
for (const [n, [s]] of Object.entries(CAS)) SOURCES[n + '.mjs'] = s

const REGLAGES: Array<[string, any]> = [['dev', {}], ['prod', { env: 'prod' }], ['prod sans enveloppe', { env: 'prod', proxy: false }], ['dev sans enveloppe', { proxy: false }]]
const ombre = (el: any) => el._shadow || el.shadowRoot || el

for (const [nom, opts] of REGLAGES) describe(`objet tenu par un enfant, écrit par le parent plus bas par un nom, ou rafraîchi (${nom})`, function () {
  this.timeout(180000)
  const sans = opts.proxy === false
  let code = ''
  const fenetres: any[] = []
  before(async () => {
    const root = mjsTmp('prop-objet-tenu-chemins'), srcDir = join(root, 'src'), outDir = join(root, 'out')
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
    win.document.body.innerHTML = `<mjs-${balise}></mjs-${balise}>`
    await tic()
    return { win, el: win.document.querySelector('mjs-' + balise) }
  }
  const enfants = (el: any) => (Array.from(ombre(el).querySelectorAll('*')) as any[]).filter((c) => c.tagName === 'MJS-ZV')
  for (const [balise, [, pas]] of Object.entries(CAS)) it(balise, async () => {
    const { win, el } = await appli(balise)
    const ecarts: string[] = []
    for (const [m, v, genre] of pas) {
      el[m](v)
      if (genre === 'dehors' || (genre === 'nom' && sans)) el.rafraichir()
      await tic()
      enfants(el).forEach((k: any, i: number) => {
        const tenu = win.__ser(win.µ._mjs_toRaw(k._state.item)), montre = ombre(k).querySelector('em')?.textContent
        if (montre !== tenu) ecarts.push(`${m}(${v})${genre === 'dehors' || (genre === 'nom' && sans) ? ' + µrefresh' : ''} : enfant ${i} montre ${montre}, tient ${tenu}`)
      })
    }
    if (win.__avis.length) ecarts.push('avis : ' + win.__avis.join(' / '))
    assert.deepEqual(ecarts, [])
  })
  it('zc-acces : µrefresh($o) ne lit aucun accesseur de l\'appli', async () => {
    const { win, el } = await appli('zc-acces')
    const avant = win.__read
    el.rafraichir(); el.rafraichir(); el.rafraichir()
    await tic()
    assert.equal(win.__read - avant, 0)
  })
  it('zc-boum : µrefresh($o) ne lève pas l\'exception d\'un accesseur de l\'appli', async () => {
    const { el } = await appli('zc-boum')
    let err = ''
    try { el.rafraichir() } catch (e: any) { err = String(e && e.message) }
    await tic()
    assert.equal(err, '')
  })
})
