// L'écriture par un nom (`t = $o.a.b; t.c = v`) suit les conteneurs par lesquels l'objet a été lu : l'objet rangé à deux
// endroits (`$o.liste[0]` et `$o.courant`), relu ailleurs entre la prise du nom et l'écriture, gardé à travers une attente ou pris avant
// que le premier enfant existe, l'objet qui se contient — l'enfant qui tient un conteneur suit comme sous l'écriture directe. Un objet lu
// par trois conteneurs garde ses trois chemins. Là où les liens ne peuvent pas se suivre (navigateur sans `WeakRef`), l'écriture redit
// les liaisons de sa variable, aucun enfant ne reste figé. Le cas courant ne se replie pas : une ligne écrite par un nom prévient UN enfant, même après deux remplacements de la liste.
// `µrefresh($x)` rafraîchit les enfants à qui une liaison repose un objet que `$x` atteint, et eux seuls — pas l'enfant qui tient l'objet
// d'une autre variable, même placé dans un bloc de `$x` ou rejoué dans la même passe. Sans l'enveloppe (réglage `"proxy": false`), MJS ne
// sait pas d'où vient un objet : l'enfant qui en reçoit un pendant que les liaisons de `$x` rejouent se rafraîchit aussi — davantage de
// rendus, jamais un enfant figé. Cœur construit, monté dans happy-dom
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const tic = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)) }
const js  = (script: string[], gabarit: string) => ['<script lang="js">', ...script.map((l) => '  ' + l), '</script>', gabarit].join('\n')

const SOURCES: Record<string, string> = {
  'ld-json.mjs':    js(['$item = null;'], '<em>{JSON.stringify($item)}</em>'),
  'ld-fx.mjs':      js(['$item = null;', 'µeffect(() => { JSON.stringify($item); globalThis.__fx = (globalThis.__fx || 0) + 1; });'], '<em>{JSON.stringify($item)}</em>'),
  'ld-relais.mjs':  js(['$item = null;'], '{if $item}<@ld-json item={$item.s}></@ld-json>{end}'),
  // la même ligne dans la liste et dans `courant` : le nom pris par la liste, gardé à travers une attente pendant laquelle le rendu relit la ligne par `courant`
  'ld-courant.mjs': js(['const r1 = { id: 1, on: false };', '$o = { liste: [r1, { id: 2, on: false }], courant: r1 };', '@sauver = async function() { const r = $o.liste[0]; r.on = true; await Promise.resolve(); await Promise.resolve(); r.on = false; r.fini = true; };'], '<p>{$o.courant.on ? 1 : 0}</p><@ld-json item={$o.liste}></@ld-json>'),
  // le même objet sous deux conteneurs, relu par l'autre entre la prise du nom et l'écriture
  'ld-relu.mjs':    js(['const x = { d: 0 };', '$o = { a: { ref: x }, z: { m: x } };', '@ecrire = function(v) { const t1 = $o.a.ref; const u = $o.z.m; const t2 = $o.a.ref; t2.d = v; return t1 === u; };'], '<@ld-json item={$o.a}></@ld-json><@ld-json item={$o.z}></@ld-json>'),
  // l'objet qui se contient : `a.b.haut === a`
  'ld-cycle.mjs':   js(['const a = { n: 0 }, b = { haut: a, c: 0 };', 'a.b = b;', '$o = { a };', '@ecrire = function(v) { const t = $o.a.b.haut.b; t.c = v; };'], '<@ld-c item={$o.a}></@ld-c>'),
  'ld-c.mjs':       js(['$item = null;'], '<em>{$item && $item.b ? $item.b.c : "-"}</em>'),
  // le nom pris à l'initialisation, avant que le premier composant de la page reçoive un objet
  'ld-avant.mjs':   js(['$o = { a: { b: { c: 0 } } };', '$voir = false;', 'const courant = $o.a.b;', '@montrer = function() { $voir = true; };', '@ecrire = function(v) { courant.c = v; };'], '{if $voir}<@ld-json item={$o.a}></@ld-json>{end}'),
  // le même objet sous trois conteneurs de l'état, tous lus
  'ld-trois.mjs':   js(['const x = { d: 0 };', '$o = { a: { ref: x }, y: { n: x }, z: { m: x } };', '@ecrire = function(v) { const t = $o.a.ref; const u = $o.y.n; const w = $o.z.m; t.d = v; return u === w; };'], '<@ld-json item={$o.a}></@ld-json><@ld-json item={$o.y}></@ld-json><@ld-json item={$o.z}></@ld-json>'),
  // le même objet sous trois conteneurs, un relais tient l'objet de la variable et donne `a` à son propre enfant
  'ld-porte.mjs':   js(['$item = null;'], '{if $item}<@ld-json item={$item.a}></@ld-json>{end}'),
  'ld-trois-porte.mjs': js(['const x = { d: 0 };', '$o = { a: { ref: x }, y: { n: x }, z: { m: x } };', '@ecrire = function(v) { const t = $o.a.ref; const u = $o.y.n; const w = $o.z.m; t.d = v; return u === w; };'], '<@ld-porte item={$o}></@ld-porte>'),
  // lignes-composants : une ligne écrite par un nom, avant et après deux remplacements de la liste
  'ld-lignes.mjs':  js(['$rows = Array.from({ length: 8 }, (_, i) => ({ id: i, fait: false }));', '@cocher = function(i) { const r = $rows[i]; r.fait = !r.fait; };', '@filtrer = function(id) { $rows = $rows.filter((r) => r.id !== id); };'], '{for r in $rows by id}<@ld-json item={r}></@ld-json>{end}'),
  // la liste rangée dans un objet de l'état, remplacée plusieurs fois, puis l'objet de la variable refait autour d'elle
  'ld-sous.mjs':    js(['$o = { rows: Array.from({ length: 6 }, (_, i) => ({ id: i, fait: false })), titre: "t" };', '@cocher = function(i) { const r = $o.rows[i]; r.fait = !r.fait; };', '@filtrer = function(id) { $o.rows = $o.rows.filter((r) => r.id !== id); };', '@refaire = function() { $o = { titre: $o.titre, rows: $o.rows.slice() }; };'], '{for r in $o.rows by id}<@ld-json item={r}></@ld-json>{end}'),
  // µrefresh : enfants dans l'ordre — $o.a ; $p ; $n ? $p : $p ; $p dans {if $o.on} ; $p dans {for r in $o.l} ; $o.a (enfant à reffet) ; $o.a (relais) et son enfant
  'ld-raf.mjs':     js(['const garde = { a: { x: 0, s: { y: 0 } }, l: [{ id: 1 }], on: true };', '$o = garde;', 'const gp = { q: 0 };', '$p = gp;', '$n = 1;', '$go = 0;', '$w = 0;',
    '@dehors = function(v) { garde.a.x = v; garde.a.s.y = v; gp.q = v; };', '@raf = function() { µrefresh($o); };', '@rafn = function() { $n++; µrefresh($o); };', '@rafp = function() { µrefresh($p); };', '@seuln = function() { $n++; };', '@rafe = function() { $go = ($go || 0) + 1; };', '@rafw = function() { $w = ($w || 0) + 1; };',
    'µeffect(() => { if ($go) { $n = $go + 1; µrefresh($o); } });', 'µeffect(() => { if ($w) { $o.a.x = $w + 100; µrefresh($o); } });'],
    '<@ld-json item={$o.a}></@ld-json><@ld-json item={$p}></@ld-json><@ld-json item={$n ? $p : $p}></@ld-json>{if $o.on}<@ld-json item={$p}></@ld-json>{end}{for r in $o.l by id}<@ld-json item={$p}></@ld-json>{end}<@ld-fx item={$o.a}></@ld-fx><@ld-relais item={$o.a}></@ld-relais>'),
}

const REGLAGES: Array<[string, any, boolean]> = [['développement', {}, true], ['production', { env: 'prod' }, true], ['production sans enveloppe', { env: 'prod', proxy: false }, false], ['développement sans enveloppe', { proxy: false }, false]]
const ombre = (el: any) => el._shadow || el.shadowRoot || el
const tous  = (el: any, acc: any[] = []): any[] => { for (const c of Array.from(ombre(el).querySelectorAll('*')) as any[]) if (c.tagName.startsWith('MJS-')) { acc.push(c); tous(c, acc) } return acc }

for (const [nom, opts, enveloppe] of REGLAGES) describe(`état : deux liens vers les conteneurs, repli par clé, µrefresh précis (${nom})`, function () {
  this.timeout(120000)
  let code = ''
  const fenetres: any[] = []

  before(async () => {
    const root   = mjsTmp('enveloppe-deux-liens')
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

  // l'appli montée, ses composants enfants, et pour chacun : ce qu'il montre, ce qu'il tient, les notifications reçues de sa prop
  async function appli(balise: string, sansWeakRef = false) {
    const win: any = new Window({ url: 'http://localhost/' })
    fenetres.push(win)
    // navigateur sans `WeakRef` : aucun lien ne se pose, toute écriture par un nom se replie
    if (sansWeakRef) win.eval('globalThis.WeakRef = undefined;')
    win.eval(`${code}\nglobalThis.µ = µ;`)
    win.eval('(() => { const P = µ.Element.prototype, n = P._mjs_notifyMutation; P._mjs_notifyMutation = function (k, ...a) { (this.__n ||= {})[k] = (this.__n[k] || 0) + 1; return n.call(this, k, ...a) } })()')
    win.document.body.innerHTML = `<mjs-${balise}></mjs-${balise}>`
    await tic()
    const el      = win.document.querySelector('mjs-' + balise)
    const enfants = () => tous(el)
    const juste   = (c: any) => ombre(c).querySelector('em').textContent === JSON.stringify(win.µ._mjs_toRaw(c._state.item))
    const recus   = () => enfants().map((c: any) => (c.__n && c.__n.item) || 0)
    return { win, el, enfants, juste, recus }
  }

  if (enveloppe) {
    it('la ligne rangée dans la liste et dans `courant`, écrite par un nom gardé à travers une attente : l\'enfant qui tient la liste suit', async () => {
      const { el, enfants, juste } = await appli('ld-courant')
      await el.sauver()
      await tic()
      const c = enfants()[0]
      assert.match(ombre(c).querySelector('em').textContent, /"fini":true/)
      assert.ok(juste(c), 'l\'enfant ne montre pas la liste qu\'il tient : ' + ombre(c).querySelector('em').textContent)
    })

    it('l\'objet relu par son autre conteneur entre la prise du nom et l\'écriture : les deux enfants suivent', async () => {
      const { el, enfants, juste } = await appli('ld-relu')
      assert.equal(el.ecrire(7), true)
      await tic()
      assert.deepEqual(enfants().map((c: any) => ombre(c).querySelector('em').textContent), ['{"ref":{"d":7}}', '{"m":{"d":7}}'])
      assert.ok(enfants().every(juste))
    })

    it('l\'objet qui se contient, écrit par un nom pris en faisant le tour : l\'enfant qui tient le conteneur suit', async () => {
      const { el, enfants } = await appli('ld-cycle')
      el.ecrire(4)
      await tic()
      assert.equal(ombre(enfants()[0]).querySelector('em').textContent, '4')
    })

    it('le nom pris avant que le premier composant de la page reçoive un objet : l\'enfant monté ensuite suit', async () => {
      const { win, el, enfants, juste } = await appli('ld-avant')
      assert.equal(win.µ._mjs_middle, false)
      el.montrer()
      await tic()
      el.ecrire(5)
      await tic()
      assert.equal(ombre(enfants()[0]).querySelector('em').textContent, '{"b":{"c":5}}')
      assert.ok(juste(enfants()[0]))
    })

    for (const sans of [false, true]) it(`l'objet lu par trois conteneurs de l'état${sans ? ', sans `WeakRef` : aucun lien, l\'écriture redit la variable et aucun enfant ne reste figé' : ' : ses trois chemins sont suivis, les trois enfants suivent'}`, async () => {
      const { el, enfants, juste } = await appli('ld-trois', sans)
      assert.equal(el.ecrire(3), true)
      await tic()
      assert.deepEqual(enfants().map((c: any) => ombre(c).querySelector('em').textContent), ['{"ref":{"d":3}}', '{"n":{"d":3}}', '{"m":{"d":3}}'])
      assert.ok(enfants().every(juste))
      el.ecrire(9)
      await tic()
      assert.deepEqual(enfants().map((c: any) => ombre(c).querySelector('em').textContent), ['{"ref":{"d":9}}', '{"n":{"d":9}}', '{"m":{"d":9}}'])
    })

    for (const sans of [false, true]) it(`sous un relais qui tient l'objet de la variable${sans ? ', sans `WeakRef` : repli, le relais, prévenu d\'une écriture, redit à son tour — son enfant ne reste pas figé' : ' : l\'enfant du relais suit'}`, async () => {
      const { el, enfants } = await appli('ld-trois-porte', sans)
      assert.equal(el.ecrire(3), true)
      await tic()
      assert.equal(ombre(enfants()[1]).querySelector('em').textContent, '{"ref":{"d":3}}')
      el.ecrire(9)
      await tic()
      assert.equal(ombre(enfants()[1]).querySelector('em').textContent, '{"ref":{"d":9}}')
    })

    it('lignes-composants : une ligne écrite par un nom prévient UN enfant, aussi après deux remplacements de la liste', async () => {
      const { el, enfants, juste, recus } = await appli('ld-lignes')
      let avant = recus()
      el.cocher(5)
      await tic()
      assert.deepEqual(recus().map((n: number, i: number) => n - avant[i]), [0, 0, 0, 0, 0, 1, 0, 0])
      assert.ok(enfants().every(juste))
      el.filtrer(1)
      await tic()
      el.filtrer(2)
      await tic()
      assert.equal(enfants().length, 6)
      avant = recus()
      el.cocher(3)
      await tic()
      assert.deepEqual(recus().map((n: number, i: number) => n - avant[i]), [0, 0, 0, 1, 0, 0], 'la liste remplacée deux fois ne met pas ses lignes au repli')
      assert.ok(enfants().every(juste))
    })

    it('lignes d\'une liste rangée dans un objet : remplacée deux fois, puis l\'objet refait trois fois autour d\'elle, une ligne écrite par un nom prévient toujours UN enfant', async () => {
      const { el, enfants, juste, recus } = await appli('ld-sous')
      el.filtrer(1)
      await tic()
      el.filtrer(2)
      await tic()
      let avant = recus()
      el.cocher(2)
      await tic()
      assert.deepEqual(recus().map((n: number, i: number) => n - avant[i]), [0, 0, 1, 0], 'la liste remplacée deux fois dans son objet ne met pas ses lignes au repli')
      for (let i = 0; i < 3; i++) { el.refaire(); await tic() }
      avant = recus()
      el.cocher(1)
      await tic()
      assert.deepEqual(recus().map((n: number, i: number) => n - avant[i]), [0, 1, 0, 0], 'l\'objet refait trois fois ne met pas les lignes au repli')
      assert.ok(enfants().every(juste))
    })
  }

  // notifications reçues par chaque enfant, dans l'ordre du gabarit, le petit-enfant du relais en dernier
  // sans l'enveloppe, l'enfant de la liste `$o.l` reçoit `$p` pendant que les liaisons de `$o` rejouent : rafraîchi lui aussi ; de même
  // celui de `$n ? $p : $p` quand `$n` change dans la passe où `$o` est rafraîchie par un reffet
  const ATTENDU: Record<string, number[]> = {
    raf:   enveloppe ? [1, 0, 0, 0, 0, 1, 1, 1] : [1, 0, 0, 0, 1, 1, 1, 1],
    rafn:  enveloppe ? [1, 0, 0, 0, 0, 1, 1, 1] : [1, 0, 0, 0, 1, 1, 1, 1],
    rafe:  enveloppe ? [1, 0, 0, 0, 0, 1, 1, 1] : [1, 0, 1, 0, 1, 1, 1, 1],
    rafp:  [0, 1, 1, 1, 1, 0, 0, 0],
    seuln: [0, 0, 0, 0, 0, 0, 0, 0],
  }
  it('µrefresh appelé par un reffet juste après une écriture dans l\'objet que tient un relais : l\'enfant du relais est rafraîchi lui aussi', async () => {
    const { el, enfants, juste } = await appli('ld-raf')
    el.dehors(5)
    el.rafw()
    await tic()
    const petit = enfants()[7]
    assert.equal(ombre(petit).querySelector('em').textContent, '{"y":5}')
    assert.ok(juste(petit))
  })

  for (const [geste, attendu] of Object.entries(ATTENDU)) it(`µrefresh, geste ${geste} : ${enveloppe ? 'seuls les enfants que nourrit la variable rafraîchie se rafraîchissent' : 'les enfants que nourrit la variable rafraîchie se rafraîchissent, et ceux qui reçoivent un objet pendant ce rendu'}, sans reffet`, async () => {
    const { win, el, enfants, juste, recus } = await appli('ld-raf')
    const avant = recus(), fx = win.__fx || 0
    el.dehors(5)
    el[geste]()
    await tic()
    assert.deepEqual(recus().map((n: number, i: number) => n - avant[i]), attendu)
    assert.equal((win.__fx || 0) - fx, 0, 'un reffet d\'enfant est reparti')
    // l'enfant rafraîchi montre ce qu'il tient ; le relais n'a pas de texte à lui
    enfants().forEach((c: any, i: number) => { if (attendu[i] && c.localName !== 'mjs-ld-relais') assert.ok(juste(c), `enfant ${i} figé : ${ombre(c).querySelector('em').textContent}`) })
  })
})
