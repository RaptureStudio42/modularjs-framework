// l'enfant à qui un parent redonne un objet écrit par un nom (`t = $rows[i].x; t.c = v`) le suit par une seule voie : de 1 à 100 objets
// écrits, sur des lignes de 6, 26 et 71 champs, il se redessine autant que sous l'écriture directe, l'écran est juste, et le travail ne
// baisse jamais quand le nombre d'objets écrits grandit (aucune voie qui change à un seuil) ; un enfant qui montre deux fois plus d'objets
// coûte au plus deux fois et demie plus, sans redessin de trop ; un enfant qui montre des boucles et des chemins doubles est suivi aussi
// (happy-dom, opérations comptées)
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const tic    = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)) }
const js     = (script: string[], gabarit: string) => ['<script lang="js">', ...script.map((l) => '  ' + l), '</script>', gabarit].join('\n')
const ligne  = (champs: string) => `@monter = function(n) { $rows = Array.from({ length: n }, (_, i) => { const r = ${champs}; return r; }); };`
const ECRIRE = ['@nomN = function(n, v) { for (let i = 0; i < n; i++) { const t = $rows[i].x; t.c = v; } };', '@directN = function(n, v) { for (let i = 0; i < n; i++) $rows[i].x.c = v; };']
const SOURCES: Record<string, string> = {
  'vs.mjs': js(['$item = null;'], "<i>{$item ? $item.x.c + ' ' + $item.o0.v : '-'}</i>"),
  'gs.mjs': js(['$rows = [];', ligne('{ id: i, x: { c: 0 }, o0: { v: 0 }, f0: 0, f1: 1, f2: 2 }'), ...ECRIRE], '{for r in $rows by id}<@vs item={r}></@vs>{end}'),
  'vr.mjs': js(['$item = null;'], "<i>{$item ? $item.x.c + ' ' + $item.o0.v + $item.o1.v + $item.o2.v + $item.o3.v : '-'}</i>"),
  'gr.mjs': js(['$rows = [];', ligne('{ id: i, x: { c: 0 }, o0: { v: 0 }, o1: { v: 0 }, o2: { v: 0 }, o3: { v: 0 } }; for (let k = 0; k < 20; k++) r["f" + k] = k'), ...ECRIRE], '{for r in $rows by id}<@vr item={r}></@vr>{end}'),
  'vw.mjs': js(['$item = null;'], "<i>{$item ? $item.x.c + ' 0' : '-'}</i>"),
  'gw.mjs': js(['$rows = [];', ligne('{ id: i }; for (let k = 0; k < 69; k++) r["f" + k] = k; r.x = { c: 0 }'), ...ECRIRE], '{for r in $rows by id}<@vw item={r}></@vw>{end}'),
  'vl.mjs': js(['$item = null;'], "<i>{$item ? $item.l.map((o) => o.v).join('') : '-'}</i>"),
  'gl.mjs': js(['$rows = [];', '@monter = function(n, m) { $rows = Array.from({ length: n }, (_, i) => ({ id: i, l: Array.from({ length: m }, () => ({ v: 0 })) })); };', '@nom1 = function(v) { const t = $rows[0].l[0]; t.v = v; };', '@direct1 = function(v) { $rows[0].l[0].v = v; };'], '{for r in $rows by id}<@vl item={r}></@vl>{end}'),
  'vc.mjs': js(['$item = null;'], "<i>{$item ? $item.x.c + ' ' + $item.moi.d.c + ' ' + $item.x.haut.x.y.z.c : '-'}</i>"),
  'gc.mjs': js(['$rows = [];', '@monter = function(n) { $rows = Array.from({ length: n }, (_, i) => { const r = { id: i, x: { c: 0 } }; r.moi = r; r.d = r.x; r.x.haut = r; r.x.y = { z: r.x }; return r; }); };', '@nom1 = function(v) { const t = $rows[0].x; t.c = v; };', '@direct1 = function(v) { $rows[0].x.c = v; };'], '{for r in $rows by id}<@vc item={r}></@vc>{end}'),
}
// opérations des collections, clés de descripteurs, cases lues par `includes`, déréférencements : comptés pendant un geste
const ESPIONS = `globalThis.__ops = { on: false, n: {} };
const __c = (k, d = 1) => { if (__ops.on) __ops.n[k] = (__ops.n[k] || 0) + d; };
for (const [nom, K] of [['Map', Map], ['WeakMap', WeakMap], ['Set', Set], ['WeakSet', WeakSet]]) {
  for (const m of ['get', 'set', 'has', 'delete', 'add', 'clear', 'forEach']) {
    const f = K.prototype[m];
    if (typeof f === 'function') K.prototype[m] = function(...a) { __c('ops'); return f.apply(this, a); };
  }
}
{ const g = Object.getOwnPropertyDescriptors; Object.getOwnPropertyDescriptors = function(o) { const d = g(o); __c('cles', Object.keys(d).length); return d; }; }
{ const g = Object.getOwnPropertyDescriptor; Object.getOwnPropertyDescriptor = function(o, k) { __c('cles'); return g(o, k); }; }
{ if (typeof WeakRef === 'function') { const d = WeakRef.prototype.deref; WeakRef.prototype.deref = function() { __c('deref'); return d.call(this); }; } }
{ const inc = Array.prototype.includes; Array.prototype.includes = function(...a) { __c('lus', this.length); return inc.apply(this, a); }; }`
const ombre = (el: any) => el._shadow || el.shadowRoot || el
const REGLAGES: Array<[string, any]> = [['développement', {}], ['production', { env: 'prod' }]]

for (const [nom, opts] of REGLAGES) describe(`prop objet écrite par un nom : une seule voie, sans saut (${nom})`, function () {
  this.timeout(240000)
  let code = ''
  const fen: any[] = []
  before(async () => {
    const root = mjsTmp('une-seule-voie'), srcDir = join(root, 'src'), outDir = join(root, 'out')
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
  // l'appli montée, ses enfants, et la mesure d'un geste : compteurs et redessins (`_mjs_notifyMutation`, `_mjs_notifyMutationAliased`)
  async function appli(tag: string, enfant: string, ...monter: number[]) {
    const win: any = new Window({ url: 'http://localhost/' })
    fen.push(win)
    win.eval(ESPIONS)
    win.eval(`${code}\nglobalThis.µ = µ;`)
    win.document.body.innerHTML = `<mjs-${tag}></mjs-${tag}>`
    await tic()
    const el = win.document.querySelector('mjs-' + tag)
    el.monter(...monter)
    await tic()
    const enfants = Array.from(ombre(el).querySelectorAll(enfant)) as any[]
    let p = enfants[0]
    while (p && !Object.prototype.hasOwnProperty.call(p, '_mjs_notifyMutation')) p = Object.getPrototypeOf(p)
    for (const m of ['_mjs_notifyMutation', '_mjs_notifyMutationAliased']) {
      const f = p[m]
      p[m] = function (...a: any[]) { if (win.__ops.on) win.__ops.n.redessins = (win.__ops.n.redessins || 0) + 1; return f.apply(this, a) }
    }
    const geste = async (f: () => void) => {
      win.__ops.n  = {}
      win.__ops.on = true
      f()
      await tic()
      win.__ops.on = false
      const c = win.__ops.n
      return { ops: c.ops || 0, travail: (c.ops || 0) + (c.cles || 0) + (c.lus || 0) + (c.deref || 0), redessins: c.redessins || 0 }
    }
    const textes = () => enfants.map((e) => ombre(e).querySelector('i')?.textContent)
    return { el, geste, textes }
  }

  // chaque nombre d'objets écrits mesuré sur une appli neuve : le travail d'un geste ne dépend pas des gestes d'avant
  for (const [tag, enfant, champs, fin] of [['gs', 'mjs-vs', 6, ' 0'], ['gr', 'mjs-vr', 26, ' 0000'], ['gw', 'mjs-vw', 71, ' 0']] as Array<[string, string, number, string]>) it(`lignes de ${champs} champs : 1 à 100 objets écrits par un nom, comme l'écriture directe`, async () => {
    const lignes = 200
    let avant = 0
    for (const n of [1, 4, 5, 64, 65, 100]) {
      const attendu = Array.from({ length: lignes }, (_, i) => (i < n ? 1 : 0) + fin)
      const a       = await appli(tag, enfant, lignes)
      const parNom  = await a.geste(() => a.el.nomN(n, 1))
      assert.deepEqual(a.textes(), attendu, `${n} objets écrits par un nom : écran juste`)
      const b      = await appli(tag, enfant, lignes)
      const direct = await b.geste(() => b.el.directN(n, 1))
      assert.deepEqual(b.textes(), attendu, `${n} objets écrits directement : écran juste`)
      assert.equal(parNom.redessins, direct.redessins, `${n} objets écrits par un nom : autant de redessins que sous l'écriture directe`)
      if (opts.env === 'prod') {
        assert.ok(parNom.ops >= avant, `${n} objets écrits par un nom : le travail ne baisse pas (${avant} puis ${parNom.ops} opérations)`)
        avant = parNom.ops
      }
    }
  })

  it('un enfant qui montre des boucles et des chemins doubles (`r.moi = r`, `r.x.y.z = r.x`) : suivi, comme l\'écriture directe', async () => {
    const { el, geste, textes } = await appli('gc', 'mjs-vc', 50)
    const parNom = await geste(() => el.nom1(1))
    assert.deepEqual(textes(), Array.from({ length: 50 }, (_, i) => i === 0 ? '1 1 1' : '0 0 0'), 'écriture par un nom')
    const direct = await geste(() => el.direct1(2))
    assert.deepEqual(textes(), Array.from({ length: 50 }, (_, i) => i === 0 ? '2 2 2' : '0 0 0'), 'écriture directe')
    assert.equal(parNom.redessins, direct.redessins, 'autant de redessins que sous l\'écriture directe')
  })

  it('un enfant qui montre deux fois plus d\'objets : au plus deux fois et demie plus de travail, aucun redessin de trop', async () => {
    const travail: number[] = []
    for (const m of [100, 200]) {
      const { el, geste, textes } = await appli('gl', 'mjs-vl', 10, m)
      const parNom = await geste(() => el.nom1(1))
      assert.equal(textes()[0], '1' + '0'.repeat(m - 1), `${m} objets montrés : écran juste après l'écriture par un nom`)
      const direct = await geste(() => el.direct1(2))
      assert.equal(textes()[0], '2' + '0'.repeat(m - 1), `${m} objets montrés : écran juste après l'écriture directe`)
      assert.equal(parNom.redessins, direct.redessins, `${m} objets montrés : autant de redessins que sous l'écriture directe`)
      travail.push(parNom.travail)
    }
    assert.ok(travail[1] <= 2.5 * travail[0], `travail de 100 puis 200 objets montrés : ${travail.join(' puis ')}`)
  })
})
