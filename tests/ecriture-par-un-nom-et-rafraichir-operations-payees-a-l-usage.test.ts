// Écriture par un nom qui garde un objet de l'état (`t = $o.a.b; t.c = v`) et `µrefresh($o)` : ce qui prévient l'enfant tenant un objet
// donné par son parent (`item={$o.a}`) se paie à l'usage, en opérations COMPTÉES. Chaque objet enveloppé garde un lien vers le conteneur
// par lequel il a été lu ; l'écriture par un nom remonte ces liens et fait avancer l'époque des conteneurs qu'un autre composant tient
// (µ._mjs_lift). Une appli qui ne donne aucun objet à un composant fait, par écriture et par `µrefresh`, les opérations d'avant ; un objet
// de l'état rangé dans une autre variable du même composant ajoute une remontée de quelques lectures ; avec un enfant, une écriture par un
// nom coûte ce que coûte l'écriture directe du même champ, à quelques lectures près, quelle que soit la taille des données ; la table qui
// reçoit ses 10 000 lignes (`<@vt rows={$rows}>`) se monte avec les opérations de la même table tenue par le parent, à la réception
// près ; N enfants qui partagent un objet, et une boucle qui écrit par un nom dans chaque ligne d'une liste dont chaque ligne va à un
// enfant, coûtent en proportion de N ; `µrefresh($rows)` sur 10 000 lignes reste à quelques opérations ; les anciens objets remplacés ne
// restent pas en mémoire, et une ligne gardée ne retient ni son ancienne liste ni les autres lignes. Appels de fonctions (couverture
// précise de V8), opérations sur Map / WeakMap / Set / WeakSet. Cœur de production, non minifié pour en lire les noms, monté dans happy-dom
import assert from 'node:assert/strict'
import { Session } from 'node:inspector/promises'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import v8 from 'node:v8'
import vm from 'node:vm'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

v8.setFlagsFromString('--expose-gc')
const gc = vm.runInNewContext('gc')
const tic = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)) }
const js  = (script: string[], gabarit: string) => ['<script lang="js">', ...script.map((l) => '  ' + l), '</script>', gabarit].join('\n')
const BASE = ['$o = { a: { b: { c: 0 } } };', '$sel = null;', '@poser = function() { $sel = $o.a; };', '@nom = function(n) { const t = $o.a.b; for (let i = 0; i < n; i++) t.c = i + 1; };', '@direct = function(n) { for (let i = 0; i < n; i++) $o.a.b.c = i + 1; };', '@raf = function(n) { for (let i = 0; i < n; i++) µrefresh($o); };']
const LIGNES = ['$rows = Array.from({ length: 10000 }, (_, i) => ({ id: i, label: "l" + i, x: { c: i } }));', '@raf = function() { µrefresh($rows); };']
const TABLE  = ['$rows = Array.from({ length: 10000 }, (_, i) => ({ id: i, label: "l" + i, x: { c: i } }));']
const RETIENT = ['window.__refs = []; window.__gardes = [];', '$o = { a: { b: { c: 0 }, lourd: new Array(1000).fill(1) } };', '@remplacer = function(n) { for (let i = 0; i < n; i++) { window.__gardes.push($o.a.b); window.__refs.push(new WeakRef(µ._mjs_toRaw($o.a))); $o.a = { b: { c: i }, lourd: new Array(1000).fill(1) }; } };']
const SOURCES: Record<string, string> = {
  'eo-fi.mjs': js(['$n = 0;'], '<i>{$n}</i>'),
  'eo-fiche.mjs': js(['$item = null;'], "<em>{$item ? $item.b.c : '-'}</em>"),
  'eo-ligne.mjs': js(['$item = null;'], "<em>{$item ? $item.id : '-'}</em>"),
  'eo-sans.mjs': js(BASE, '<p>{$o.a.b.c}</p><@eo-fi n={1}></@eo-fi>'),
  'eo-enfant.mjs': js(BASE, '<p>{$o.a.b.c}</p><@eo-fiche item={$o.a}></@eo-fiche>'),
  'eo-lignes-prim.mjs': js(LIGNES, '<p>{$rows.length} {$rows[5].x.c}</p><@eo-fi n={1}></@eo-fi>'),
  'eo-lignes-tenu.mjs': js(LIGNES, '<p>{$rows.length} {$rows[5].x.c}</p><@eo-ligne item={$rows[0]}></@eo-ligne>'),
  'eo-retient.mjs': js(RETIENT, '<p>{$o.a.b.c}</p><@eo-fi n={1}></@eo-fi>'),
  'eo-retient-tenu.mjs': js(RETIENT, '<p>{$o.a.b.c}</p><@eo-fiche item={$o.a}></@eo-fiche>'),
  // la table qui reçoit ses lignes, et la même tenue par le parent
  'eo-vt.mjs': js(['$rows = [];'], '{for r in $rows by id}<i>{r.label} {r.x.c}</i>{end}'),
  'eo-table-recue.mjs': js(TABLE, '<@eo-vt rows={$rows}></@eo-vt>'),
  'eo-table-tenue.mjs': js(TABLE, '{for r in $rows by id}<i>{r.label} {r.x.c}</i>{end}'),
  // N enfants qui partagent un objet
  'eo-partage.mjs': js(['$o = { a: { b: { c: 0 } } };', '$ids = [];', '@monter = function(n) { $ids = Array.from({ length: n }, (_, i) => i); };', '@nom = function(v) { const t = $o.a.b; t.c = v; };'], '{for i in $ids}<@eo-fiche item={$o.a}></@eo-fiche>{end}'),
  // chaque ligne à un enfant ; une boucle écrit par un nom dans chaque ligne
  'eo-rangee.mjs': js(['$item = null;'], "<em>{$item ? $item.x.c : '-'}</em>"),
  'eo-rangees.mjs': js(['$rows = [];', '@monter = function(n) { $rows = Array.from({ length: n }, (_, i) => ({ id: i, x: { c: 0 } })); };', '@tous = function(v) { for (const r of $rows) { const t = r.x; t.c = v; } };'], '{for r in $rows by id}<@eo-rangee item={r}></@eo-rangee>{end}'),
  // une ligne gardée par une variable, puis la liste remplacée
  'eo-garde.mjs': js(['window.__refs = [];', '$rows = Array.from({ length: 500 }, (_, i) => ({ id: i, x: { c: i } }));', '$sel = null;', '@garder = function() { $sel = $rows[3]; window.__refs.push(new WeakRef(µ._mjs_toRaw($rows)), new WeakRef(µ._mjs_toRaw($rows[7]))); };', '@remplacer = function() { $rows = Array.from({ length: 500 }, (_, i) => ({ id: 1000 + i, x: { c: i } })); };'], "<p>{$sel ? $sel.x.c : '-'}</p>{for r in $rows by id}<@eo-rangee item={r}></@eo-rangee>{end}"),
}
const ESPIONS = `globalThis.__ops = { on: false, n: {}, it: 0 };
for (const [nom, K] of [['Map', Map], ['WeakMap', WeakMap], ['Set', Set], ['WeakSet', WeakSet]]) {
  for (const m of ['get', 'set', 'has', 'delete', 'add', 'clear', 'forEach']) {
    const f = K.prototype[m];
    if (typeof f !== 'function') continue;
    K.prototype[m] = function __espion(...a) { if (__ops.on) __ops.n[nom + '.' + m] = (__ops.n[nom + '.' + m] || 0) + 1; return f.apply(this, a); };
  }
}
// pas des itérations d'un Set, comptés à part
{ const SI = Object.getPrototypeOf(new Set().values()), nx = SI.next; SI.next = function __espion() { if (__ops.on) __ops.it++; return nx.call(this); }; }`
const N1 = 200, N2 = 600
for (const [nom, opts] of [['prod', { env: 'prod' }], ['prod sans enveloppe', { env: 'prod', proxy: false }]] as Array<[string, any]>) describe(`écriture par un nom et µrefresh : le suivi des objets donnés n'est payé que par l'appli qui s'en sert (${nom}, comptes par opération)`, function () {
  this.timeout(180000)
  let code = ''
  const session = new Session()
  const fenetres: any[] = []
  before(async () => {
    const root = mjsTmp('ecriture-nom-rafraichir-operations'), srcDir = join(root, 'src'), outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [f, s] of Object.entries(SOURCES)) writeFileSync(join(srcDir, f), s)
    const b = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), minify: false, ...opts } as any)
    const st = await b.compile(); await b.close()
    if (st.errors.length) throw new Error(st.errors.map((e: any) => e.message).join('\n'))
    const rang = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    code = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    session.connect()
    await session.post('Profiler.enable')
    await session.post('Profiler.startPreciseCoverage', { callCount: true, detailed: false })
  })
  after(async () => { await session.post('Profiler.stopPreciseCoverage'); session.disconnect(); for (const w of fenetres) w.close?.(); await terminateSharedWorkerPool() })
  async function appli(balise: string) {
    const win: any = new Window({ url: 'http://localhost/' })
    fenetres.push(win)
    win.eval(ESPIONS)
    win.eval(`${code}\nglobalThis.µ = µ;`)
    win.document.body.innerHTML = `<mjs-${balise}></mjs-${balise}>`
    await tic()
    return { win, el: win.document.querySelector('mjs-' + balise) }
  }
  // les fonctions internes de Node (`node:…` : file des tâches, crochets asynchrones, flux de sortie) ne comptent pas : leur nombre suit
  // l'activité du processus, jamais l'écriture ; un `get` de Node se confondait par son nom avec le piège `get` du cœur (14,0225 appels
  // par µrefresh au lieu de 14, dans un processus chargé)
  async function releve(): Promise<Map<string, number>> {
    const { result } = await session.post('Profiler.takePreciseCoverage') as any
    const n = new Map<string, number>()
    for (const s of result) if (!s.url.startsWith('node:')) for (const f of s.functions) if (f.ranges[0].count > 0 && f.functionName !== '__espion') n.set(f.functionName || '(anonyme)', (n.get(f.functionName || '(anonyme)') || 0) + f.ranges[0].count)
    return n
  }
  // par opération : deux fenêtres, synchrone puis avec le rendu qui suit
  async function parOp(win: any, el: any, m: string) {
    const fen = async (n: number) => {
      await releve(); win.__ops.n = {}; win.__ops.on = true
      el[m](n)
      const sync = { ...win.__ops.n }
      await tic()
      win.__ops.on = false
      return { appels: await releve(), sync, tout: { ...win.__ops.n } }
    }
    const a = await fen(N1), b = await fen(N2)
    const par = (x = 0, y = 0) => (y - x) / (N2 - N1)
    const app: Record<string, number> = {}, sync: Record<string, number> = {}, tout: Record<string, number> = {}
    for (const k of new Set([...a.appels.keys(), ...b.appels.keys()])) { const v = par(a.appels.get(k), b.appels.get(k)); if (v > 0.5) app[k] = v }
    for (const k of new Set([...Object.keys(a.sync), ...Object.keys(b.sync)])) { const v = par(a.sync[k], b.sync[k]); if (v > 0.05) sync[k] = v }
    for (const k of new Set([...Object.keys(a.tout), ...Object.keys(b.tout)])) { const v = par(a.tout[k], b.tout[k]); if (v > 0.05) tout[k] = v }
    const somme = (o: Record<string, number>) => Object.values(o).reduce((x, y) => x + y, 0)
    return { app, sync, appels: somme(app), ops: somme(sync) }
  }
  // comptes d'avant ce travail (même cœur, même appli, sans lui) : par écriture et par `µrefresh`
  const AVANT: Record<string, [number, number]> = nom === 'prod'
    ? { nom: [25, 8], raf: [14, 4], aliasnom: [30, 9], aliasraf: [14, 4] }
    : { nom: [2, 0], raf: [8, 2], aliasnom: [2, 0], aliasraf: [8, 2] }
  it('aucun objet donné à un composant : une écriture par un nom et µrefresh font les opérations d\'avant, sans remontée ; un objet de l\'état rangé dans une autre variable : une remontée, cinq lectures', async () => {
    const { win, el } = await appli('eo-sans')
    // avec `"proxy": false`, l'écriture par un nom pris sur un chemin fixe passe par le chemin : elle coûte l'écriture directe du même
    // composant, plus les deux lectures brutes de sa garde (µ._mjs_toRaw)
    const direct = opts.proxy === false ? await parOp(win, el, 'direct') : null
    for (const [m, cle] of [['nom', 'nom'], ['raf', 'raf']]) {
      const r = await parOp(win, el, m)
      const max: [number, number] = m === 'nom' && direct ? [direct.appels + 2, direct.ops] : AVANT[cle]
      assert.ok(!('_mjsLift' in r.app) && r.appels <= max[0] && r.ops <= max[1], `${m} : ${r.appels} appels, ${r.ops} opérations (au plus : ${max}) ${JSON.stringify(r.app)} ${JSON.stringify(r.sync)}`)
    }
    el.poser()
    await tic()
    const n = await parOp(win, el, 'nom'), d = await parOp(win, el, 'direct'), r = await parOp(win, el, 'raf')
    console.log(`R|${nom}|objet rangé dans une autre variable|nom ${n.appels} appels ${n.ops} opérations|direct ${d.appels} appels ${d.ops} opérations|µrefresh ${r.appels} appels ${r.ops} opérations`)
    // deux conteneurs au-dessus de l'objet écrit : trois lectures du relevé, deux de la table des objets tenus ; aucune époque n'avance (l'écrivain seul les tient)
    // avec `"proxy": false`, comme plus haut : l'écriture directe du même composant, plus les deux lectures brutes de la garde
    assert.ok((n.app['_mjsLift'] ?? 0) === (nom === 'prod' ? 1 : 0) && (direct ? n.appels <= d.appels + 2 && n.ops <= d.ops : n.appels <= AVANT.aliasnom[0] + 1 && n.ops <= AVANT.aliasnom[1] + 5), `nom : ${n.appels} appels, ${n.ops} opérations (avant : ${AVANT.aliasnom}, direct : ${d.appels}, ${d.ops}) ${JSON.stringify(n.app)} ${JSON.stringify(n.sync)}`)
    assert.ok(r.appels <= AVANT.aliasraf[0] && r.ops <= AVANT.aliasraf[1], `µrefresh : ${r.appels} appels, ${r.ops} opérations (avant : ${AVANT.aliasraf}) ${JSON.stringify(r.app)}`)
  })
  it('enfant qui tient un objet du parent : une écriture par un nom remonte une fois et coûte l\'écriture directe, à quelques lectures près ; µrefresh ne remonte pas', async () => {
    const { win, el } = await appli('eo-enfant')
    const n = await parOp(win, el, 'nom'), d = await parOp(win, el, 'direct'), r = await parOp(win, el, 'raf')
    console.log(`R|${nom}|enfant qui tient $o.a|nom ${n.appels} appels ${n.ops} opérations ${JSON.stringify(n.sync)}|direct ${d.appels} appels ${d.ops} opérations ${JSON.stringify(d.sync)}|µrefresh ${r.appels} appels ${r.ops} opérations`)
    assert.equal(n.app['_mjsLift'] ?? 0, nom === 'prod' ? 1 : 0, `écriture : ${JSON.stringify(n.app)}`)
    assert.ok(n.ops <= d.ops + 6, `écriture par un nom : ${n.ops} opérations ${JSON.stringify(n.sync)} ; directe : ${d.ops} ${JSON.stringify(d.sync)}`)
    assert.equal(r.app['_mjsLift'] ?? 0, 0, `µrefresh : ${JSON.stringify(r.app)}`)
  })
  // opérations sur les collections, pas des itérations d'un Set compris
  const compte = async (win: any, f: () => any) => { win.__ops.n = {}; win.__ops.it = 0; win.__ops.on = true; f(); await tic(); win.__ops.on = false; return (Object.values(win.__ops.n).reduce((x: any, y: any) => x + y, 0) as number) + win.__ops.it }
  it('la table qui reçoit ses 10 000 lignes se monte comme la même table tenue par le parent, à la réception près', async () => {
    const ops: Record<string, number> = {}
    for (const b of ['eo-table-tenue', 'eo-table-recue']) {
      const win: any = new Window({ url: 'http://localhost/' })
      fenetres.push(win)
      win.eval(ESPIONS)
      win.eval(`${code}\nglobalThis.µ = µ;`)
      ops[b] = await compte(win, () => { win.document.body.innerHTML = `<mjs-${b}></mjs-${b}>` })
    }
    // d'avant ce travail : 52 opérations de plus pour la table reçue (la prop et son composant) ; la réception en ajoute 3
    assert.ok(ops['eo-table-recue'] - ops['eo-table-tenue'] <= 60, JSON.stringify(ops))
  })
  it('N enfants qui partagent un objet, une boucle qui écrit dans chaque ligne tenue par un enfant : en proportion de N', async () => {
    const mesures: string[] = []
    for (const [b, m] of [['eo-partage', 'nom'], ['eo-rangees', 'tous']]) {
      const par: number[] = []
      for (const N of [250, 1000]) {
        const { win, el } = await appli(b)
        const monte = await compte(win, () => el.monter(N))
        const ecrit = await compte(win, () => el[m](N))
        par.push(monte / N, ecrit / N)
        mesures.push(`${b} N=${N} : montage ${monte}, écriture ${ecrit}`)
      }
      // par enfant : le même compte à 250 et à 1 000 (à 15 % près), jamais quatre fois plus
      assert.ok(par[2] <= par[0] * 1.15 && par[3] <= par[1] * 1.15, mesures.join(' ; '))
    }
  })
  it('µrefresh($rows) sur 10 000 lignes : quelques opérations, rendu compris, jamais proportionnelles aux lignes', async () => {
    for (const b of ['eo-lignes-prim', 'eo-lignes-tenu']) {
      const { win, el } = await appli(b)
      win.__ops.n = {}; win.__ops.on = true
      el.raf()
      const sync = { ...win.__ops.n }
      await tic()
      win.__ops.on = false
      const s = (o: any) => Object.values(o).reduce((x: any, y: any) => x + y, 0) as number
      // d'avant ce travail : 12 et 22 opérations (2 et 7 sans l'enveloppe) ; l'enfant qui tient une ligne en ajoute quelques-unes, jamais 10 000
      const max = b === 'eo-lignes-prim' ? (nom === 'prod' ? 12 : 2) : 40
      assert.ok(s(win.__ops.n) <= max, `${b} : ${s(win.__ops.n)} opérations ${JSON.stringify(win.__ops.n)} (au plus ${max}) ; µrefresh seul ${JSON.stringify(sync)}`)
    }
  })
  it('1 000 remplacements de $o.a : aucun ancien objet retenu', async () => {
    for (const b of ['eo-retient', 'eo-retient-tenu']) {
      const { win, el } = await appli(b)
      gc(); await tic(); gc()
      const avant = process.memoryUsage().heapUsed
      el.remplacer(1000)
      await tic(); await tic()
      gc(); await tic(); gc()
      const vivants = win.__refs.filter((r: any) => r.deref() !== undefined).length
      assert.equal(vivants, 0, `${b} : ${vivants} / 1000 anciens $o.a en mémoire ; tas +${Math.round((process.memoryUsage().heapUsed - avant) / 1024)} Kio`)
    }
  })
  it('une ligne gardée après le remplacement de la liste ne retient ni l\'ancienne liste ni ses autres lignes', async () => {
    const { win, el } = await appli('eo-garde')
    el.garder()
    await tic()
    el.remplacer()
    await tic(); await tic()
    gc(); await tic(); gc()
    assert.deepEqual([...win.__refs].map((r: any) => r.deref() !== undefined), [false, false], 'ancienne liste, autre ligne de l\'ancienne liste')
    assert.equal(win.µ._mjs_toRaw(el._state.sel).id, 3, 'la ligne gardée')
  })
})
