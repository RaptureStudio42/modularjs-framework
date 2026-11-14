// Un nom pris sur un chemin fixe de l'état (`t := $o.a.b`, `t := $$s.a.b`) puis écrit (`t.c = 5`) donne le même écran que l'écriture
// directe du même champ (`$o.a.b.c = 5`), sans `µrefresh` : le lien du parent et l'enfant qui tient `$o.a` (ou `$$s.a`) suivent, avec et
// sans le réglage `"proxy": false`. `t.c = f()` où `f()` remplace ou déplace l'objet : l'écriture va à l'objet pris, comme en JavaScript ;
// une valeur entre parenthèses (magasin), un nom pris dans une boucle sur une clé puis écrit après elle, une écriture en chaîne
// (`t.n = t.z = 6`) : la construction passe, la valeur est juste. Deux enfants qui tiennent le même objet, l'un qui écrit par un nom : le même écran que son écriture
// directe. L'objet remplacé entre la prise du nom et l'écriture : l'écriture va à l'ancien objet, comme en JavaScript, le neuf reste
// intact ; une ligne prise par un indice qui avance ensuite (`it := $rows[i]`, `i++`, `it.x = 1`) : la ligne du départ est écrite ; en CoffeeScript, `sheet = $$liste[slot]` puis `slot` qui change : l'écriture va à `sheet`, aucune autre case n'est écrite.
// Quatre réglages : développement et production, avec et sans enveloppe. Cœur construit, monté dans happy-dom
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const tic = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) }
const js  = (script: string[], gabarit: string) => ['<script lang="js">', ...script.map((l) => '  ' + l), '</script>', gabarit].join('\n')
// valeur rendue par la fenêtre de happy-dom, ramenée aux tableaux d'ici
const net = (v: unknown) => JSON.parse(JSON.stringify(v))
const AFF = "<em>{$item ? JSON.stringify($item) : '-'}</em>"
const SOURCES: Record<string, string> = {
  'vn.mjs': js(['$item = null;'], AFF),
  // état d'un composant
  'lo.mjs': js(['$o = { a: { b: { c: 0 } } };', '@nom = function(v) { const t = $o.a.b; t.c = v; };', '@direct = function(v) { $o.a.b.c = v; };', '@remplace = function(v) { const t = $o.a.b; $o.a = { b: { c: 1 } }; t.c = v; return t.c; };'], '<p>{$o.a.b.c}</p><@vn item={$o.a}></@vn>'),
  // objet d'un magasin
  'ma.mjs': js(['$$s = { a: { b: { c: 0 } } };', '@nom = function(v) { const t = $$s.a.b; t.c = v; };', '@direct = function(v) { $$s.a.b.c = v; };'], '<p>{$$s.a.b.c}</p><@vn item={$$s.a}></@vn>'),
  // objet tenu par deux enfants, l'un écrit
  'vs.mjs': js(['$item = null;', '@nomE = function(v) { const t = $item.b; t.c = v; };', '@directE = function(v) { $item.b.c = v; };'], AFF),
  'sb.mjs': js(['$o = { a: { b: { c: 0 } } };'], '<p>{$o.a.b.c}</p><@vs item={$o.a}></@vs><@vs item={$o.a}></@vs>'),
  // indice dynamique : la ligne prise au départ, puis l'indice qui avance ou non
  'li.mjs': js(['$rows = [{ x: 0 }, { x: 0 }];', '@ligne = function(bouge) { let i = 0; const it = $rows[i]; if (bouge) i++; it.x = 1; };', '@etat = function() { return JSON.stringify($rows); };', '@raf = function() { µrefresh($rows); };'], '<p>{JSON.stringify($rows)}</p>'),
  'lm.mjs': js(['$$rows = [{ x: 0 }, { x: 0 }];', '@ligne = function(bouge) { let i = 0; const it = $$rows[i]; if (bouge) i++; it.x = 1; };'], '<p>{JSON.stringify($$rows)}</p>'),
  // CoffeeScript : clé faite d'un nom, qui change avant l'écriture
  'cs.mjs': ['<script lang="coffee">', '  $$liste = [{ done: false }, { done: false }]', '  @coche = ->', '    slot = 0', '    sheet = $$liste[slot]', '    slot = 1', '    sheet.done = true', '    return', '</script>', '<p>{JSON.stringify($$liste)}</p>'].join('\n'),
}
// valeur qui remplace ou déplace l'objet, valeur entre parenthèses, clé hors de portée, écriture en chaîne : chaque groupe construit à
// part, un code émis invalide refuse toute sa construction
const CONSTATS: Record<string, Record<string, string>> = {
  ordre: {
    'k1.mjs': js(['$o = { a: { b: { c: 0 } } };', '@run = function() { const t = $o.a.b; const vieux = t; const f = () => { $o.a = { b: { c: 100 } }; return 5; }; t.c = f(); return [vieux.c, $o.a.b.c]; };'], '<p>{$o.a.b.c}</p>'),
    'k2.mjs': js(['$$k2 = { a: { b: { c: 0 } } };', '@run = function() { const t = $$k2.a.b; const vieux = t; const f = () => { $$k2.a = { b: { c: 100 } }; return 5; }; t.c = f(); return [vieux.c, $$k2.a.b.c]; };'], '<p>{$$k2.a.b.c}</p>'),
    'k3.mjs': js(['$rows = [{ x: 0 }, { x: 0 }];', '@run = function() { const it = $rows[0]; const f = () => { $rows.unshift({ x: 50 }); return 5; }; it.x = f(); return $rows.map((r) => r.x).join(); };'], '<p>{$rows.length}</p>'),
    'k4.mjs': js(['$$k4 = [{ x: 0 }, { x: 0 }];', '@run = function() { const it = $$k4[0]; const f = () => { $$k4.unshift({ x: 50 }); return 5; }; it.x = f(); return $$k4.map((r) => r.x).join(); };'], '<p>{$$k4.length}</p>'),
    'k6.mjs': js(['$o = { items: { x: { c: 0 }, y: { c: 0 } } };', '@run = function() { let trouve; for (const k of Object.keys($o.items)) { if (k === "y") trouve = $o.items[k]; } trouve.c = 5; return [$o.items.x.c, $o.items.y.c]; };'], '<p>{$o.items.y.c}</p>'),
    'k7.mjs': js(['$$k7 = { items: { x: { c: 0 }, y: { c: 0 } } };', '@run = function() { let trouve; for (const k of Object.keys($$k7.items)) { if (k === "y") trouve = $$k7.items[k]; } trouve.c = 5; return [$$k7.items.x.c, $$k7.items.y.c]; };'], '<p>{$$k7.items.y.c}</p>'),
  },
  parentheses: {
    'k5.mjs': js(['$$k5 = { a: { b: { c: 0 } } };', '@run = function() { const a = 2; const t = $$k5.a.b; t.ok = (a === 2); t.v = (a > 5 ? "grand" : "petit"); return [t.ok, t.v, $$k5.a.b.ok]; };'], '<p>{$$k5.a.b.c}</p>'),
  },
  chaine: {
    'k8.mjs': js(['$o = { a: { b: { c: 0 } } };', '@run = function() { const t = $o.a.b; let b; b = (t.n = t.z = 6); return [b, t.n, t.z, $o.a.b.n, $o.a.b.z]; };'], '<p>{$o.a.b.c}</p>'),
  },
}
const REGLAGES: Array<[string, any]> = [['dev', {}], ['prod', { env: 'prod' }], ['dev-sans', { proxy: false }], ['prod-sans', { env: 'prod', proxy: false }]]
const ombre = (el: any) => el._shadow || el.shadowRoot || el
const tous  = (r: any, tag: string, out: any[] = []): any[] => { for (const e of Array.from(ombre(r).querySelectorAll('*')) as any[]) { if (e.tagName === tag) out.push(e); if (e._shadow || e.shadowRoot) tous(e, tag, out) } return out }
const txt   = (el: any, sel: string) => ombre(el).querySelector(sel)?.textContent ?? '?'

async function construire(nom: string, opts: any, sources: Record<string, string> = SOURCES) {
  const root = mjsTmp('nom-chemin-fixe-' + nom), srcDir = join(root, 'src'), outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [f, s] of Object.entries(sources)) writeFileSync(join(srcDir, f), s)
  const b = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), minify: false, ...opts } as any)
  const st = await b.compile(); await b.close()
  const rang = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const code = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  return { code, erreurs: st.errors.map((e: any) => String(e.message)) as string[] }
}

for (const [nom, opts] of REGLAGES) describe(`nom pris sur un chemin fixe : le même écran que l'écriture directe (${nom})`, function () {
  this.timeout(240000)
  let code = ''
  const fen: any[] = []
  const groupes: Record<string, { code: string, erreurs: string[] }> = {}
  before(async () => {
    const r = await construire(nom, opts)
    assert.deepEqual(r.erreurs, [], 'construction')
    code = r.code
  })
  after(async () => { for (const w of fen) w.close?.(); await terminateSharedWorkerPool() })
  async function appli(tag: string, js = code) {
    const win: any = new Window({ url: 'http://localhost/' })
    fen.push(win)
    win.eval(`${js}\nglobalThis.µ = µ;`)
    win.document.body.innerHTML = `<mjs-${tag}></mjs-${tag}>`
    await tic()
    return { win, el: win.document.querySelector('mjs-' + tag) }
  }
  // le lien du parent puis le texte de chaque enfant `enf`, après `pas`, dans une appli neuve
  async function ecran(tag: string, enf: string, pas: (el: any) => unknown) {
    const { el } = await appli(tag)
    const r = pas(el)
    await tic()
    return { vu: [txt(el, 'p'), ...tous(el, enf.toUpperCase()).map((e) => txt(e, 'em'))], r }
  }

  it('état d\'un composant : t := $o.a.b ; t.c = 5 redessine le lien et l\'enfant, comme $o.a.b.c = 5', async () => {
    const n = await ecran('lo', 'mjs-vn', (el) => el.nom(5)), d = await ecran('lo', 'mjs-vn', (el) => el.direct(5))
    assert.deepEqual([n.vu, d.vu], [['5', '{"b":{"c":5}}'], ['5', '{"b":{"c":5}}']])
  })
  it('magasin : t := $$s.a.b ; t.c = 5 redessine le lien et l\'enfant qui tient $$s.a, comme $$s.a.b.c = 5', async () => {
    const n = await ecran('ma', 'mjs-vn', (el) => el.nom(5)), d = await ecran('ma', 'mjs-vn', (el) => el.direct(5))
    assert.deepEqual([n.vu, d.vu], [['5', '{"b":{"c":5}}'], ['5', '{"b":{"c":5}}']])
  })
  it('deux enfants tiennent $o.a, l\'un écrit t := $item.b ; t.c = 5 : le même écran que son écriture directe', async () => {
    const n = await ecran('sb', 'mjs-vs', (el) => tous(el, 'MJS-VS')[0].nomE(5)), d = await ecran('sb', 'mjs-vs', (el) => tous(el, 'MJS-VS')[0].directE(5))
    assert.deepEqual(n.vu, d.vu)
    assert.deepEqual(d.vu, ['0', '{"b":{"c":5}}', '{"b":{"c":0}}'])
  })
  it('objet remplacé entre la prise du nom et l\'écriture : l\'ancien reçoit 5, le neuf reste intact', async () => {
    const r = await ecran('lo', 'mjs-vn', (el) => el.remplace(5))
    assert.deepEqual([r.r, r.vu], [5, ['1', '{"b":{"c":1}}']])
  })
  if (opts.proxy === false) it('liste d\'un composant, "proxy": false : indice changé entre la prise du nom et l\'écriture : la règle s\'abstient, µrefresh reste requis', async () => {
    const { el } = await appli('li')
    el.ligne(true)
    await tic()
    // la donnée est juste, l'écran celui d'avant le lot
    assert.deepEqual([el.etat(), txt(el, 'p')], ['[{"x":1},{"x":0}]', '[{"x":0},{"x":0}]'])
    el.raf()
    await tic()
    assert.equal(txt(el, 'p'), '[{"x":1},{"x":0}]')
  })
  for (const tag of ['li', 'lm']) for (const bouge of [true, false]) if (!(tag === 'li' && bouge && opts.proxy === false)) it(`${tag === 'li' ? 'liste d\'un composant' : 'liste d\'un magasin'} : it := $rows[i]${bouge ? ', puis i++,' : ''} puis it.x = 1 : la ligne prise au départ est écrite, l'autre intacte, l'écran suit`, async () => {
    const r = await ecran(tag, 'mjs-vn', (el) => el.ligne(bouge))
    assert.deepEqual(r.vu, ['[{"x":1},{"x":0}]'])
  })
  // le groupe construit à part : sa construction passe, puis l'appli du composant
  async function constat(groupe: string, tag: string) {
    groupes[groupe] ??= await construire(`${nom}-${groupe}`, opts, CONSTATS[groupe])
    assert.deepEqual(groupes[groupe].erreurs, [], 'construction')
    return appli(tag, groupes[groupe].code)
  }
  for (const [tag, cas, attendu] of [['k1', 'état d\'un composant', [5, 100]], ['k2', 'magasin', [5, 100]]] as Array<[string, string, unknown]>) it(`${cas} : t.c = f() où f() remplace l'objet : l'ancien reçoit 5, le neuf garde 100, comme JavaScript`, async () => {
    const { el } = await constat('ordre', tag)
    const r = net(el.run())
    await tic()
    assert.deepEqual([r, txt(el, 'p')], [attendu, '100'])
  })
  for (const [tag, cas] of [['k3', 'état d\'un composant'], ['k4', 'magasin']]) it(`${cas} : it.x = f() où f() déplace la ligne : la ligne prise reçoit 5, comme JavaScript`, async () => {
    const { el } = await constat('ordre', tag)
    assert.equal(el.run(), '50,5,0')
  })
  it('magasin : t.ok = (a === 2) : la construction passe, la valeur est juste', async () => {
    const { el } = await constat('parentheses', 'k5')
    assert.deepEqual(net(el.run()), [true, 'petit', true])
  })
  for (const [tag, cas] of [['k6', 'état d\'un composant'], ['k7', 'magasin']]) it(`${cas} : nom pris dans une boucle sur une clé, écrit après elle : aucune exception, la bonne case`, async () => {
    const { el } = await constat('ordre', tag)
    assert.deepEqual(net(el.run()), [0, 5])
  })
  it('écriture en chaîne t.n = t.z = 6 : la construction passe, les deux champs valent 6', async () => {
    const { el } = await constat('chaine', 'k8')
    assert.deepEqual(net(el.run()), [6, 6, 6, 6, 6])
  })
  it('CoffeeScript : sheet = $$liste[slot], puis slot change : l\'écriture va à sheet, aucune autre case', async () => {
    const r = await ecran('cs', 'mjs-vn', (el) => el.coche())
    assert.deepEqual(r.vu, ['[{"done":true},{"done":false}]'])
  })
})
