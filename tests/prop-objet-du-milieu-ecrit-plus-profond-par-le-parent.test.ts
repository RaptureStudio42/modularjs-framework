// Un enfant qui tient un objet du MILIEU d'un chemin de l'état du parent (`item={$o.a.b}`) se redessine quand le parent écrit plus bas
// (`$o.a.b.c.d = v`) : l'écriture compilée (`µ._mjs_deepSet`, `µ._mjs_deepCall`, `µ._mjs_deepDelete`) fait avancer l'époque de chaque
// objet tenu que son chemin traverse, que l'enfant compare quand le parent lui repose le même objet ; sans elle, l'enfant y voit un écho
// et garde l'ancienne valeur. Cas joués : objet tenu à un, deux et trois niveaux au-dessus de l'objet écrit, la racine, clé calculée,
// suppression, méthode d'une liste au bout du chemin, deux enfants qui tiennent deux niveaux du même chemin, ligne d'une liste avec et
// sans clé, magasin, l'enfant qui écrit lui-même plus bas dans ce qu'il tient (son parent n'en est pas prévenu, règle des props) ; une
// écriture sur une autre branche ne prévient pas l'enfant (écho). Quatre
// réglages : développement et production, chacun avec et sans enveloppe (`proxy: false`). Cœur construit, monté dans happy-dom
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const tic = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)) }
const js  = (script: string[], gabarit: string) => ['<script lang="js">', ...script.map((l) => '  ' + l), '</script>', gabarit].join('\n')
const O4  = '$o = { a: { b: { c: { d: 0 } } } };'
const E4  = '@ecrire = function(v) { $o.a.b.c.d = v; };'

const SOURCES: Record<string, string> = {
  // enfants : ce qu'ils montrent de l'objet qu'on leur passe
  've-d.mjs':       js(['$item = null;'], "<em>{$item ? String($item.d) : '-'}</em>"),
  've-cd.mjs':      js(['$item = null;'], "<em>{$item ? String($item.c.d) : '-'}</em>"),
  've-bcd.mjs':     js(['$item = null;'], "<em>{$item ? String($item.b.c.d) : '-'}</em>"),
  've-json.mjs':    js(['$item = null;'], '<em>{JSON.stringify($item)}</em>'),
  've-ecrit.mjs':   js(['$item = null;', '@ecrire = function(v) { $item.c.d = v; };', '@ecrireBas = function(v) { $item.c.e.d = v; };'], "<em>{$item ? String($item.c.d) + '/' + String($item.c.e.d) : '-'}</em>"),
  // parents : l'objet écrit tenu (témoin), puis un objet du milieu du chemin
  'ep-ecrit.mjs':   js([O4, E4], '<@ve-d item={$o.a.b.c}></@ve-d>'),
  'ep-n1.mjs':      js([O4, E4], '<@ve-cd item={$o.a.b}></@ve-cd>'),
  'ep-n2.mjs':      js([O4, E4], '<@ve-bcd item={$o.a}></@ve-bcd>'),
  'ep-n3.mjs':      js(['$o = { a: { b: { c: { e: { d: 0 } } } } };', '@ecrire = function(v) { $o.a.b.c.e.d = v; };'], '<@ve-json item={$o.a}></@ve-json>'),
  'ep-racine.mjs':  js([O4, E4], '<@ve-json item={$o}></@ve-json>'),
  'ep-cle.mjs':     js([O4, "@ecrire = function(v) { const k = 'd'; $o.a.b.c[k] = v; };"], '<@ve-cd item={$o.a.b}></@ve-cd>'),
  'ep-suppr.mjs':   js(['$o = { a: { b: { c: { d: 1, e: 2 } } } };', '@ecrire = function() { delete $o.a.b.c.d; };'], '<@ve-json item={$o.a.b}></@ve-json>'),
  'ep-pousse.mjs':  js(['$o = { a: { b: { c: { l: [] } } } };', '@ecrire = function(v) { $o.a.b.c.l.push(v); };'], '<@ve-json item={$o.a.b}></@ve-json>'),
  'ep-deux.mjs':    js([O4, E4], '<@ve-bcd item={$o.a}></@ve-bcd><@ve-cd item={$o.a.b}></@ve-cd>'),
  'ep-ligne.mjs':   js(['$rows = [{ id: 1, x: { c: { d: 0 } } }, { id: 2, x: { c: { d: 0 } } }];', '@ecrire = function(v) { $rows[0].x.c.d = v; };'], '{for r in $rows by id}<@ve-cd item={r.x}></@ve-cd>{end}'),
  'ep-ligne-sans-cle.mjs': js(['$rows = [{ x: { c: { d: 0 } } }, { x: { c: { d: 0 } } }];', '@ecrire = function(v) { $rows[0].x.c.d = v; };'], '{for r in $rows}<@ve-cd item={r.x}></@ve-cd>{end}'),
  'ep-magasin.mjs': js(['$$epo = { a: { b: { c: { d: 0 } } } };', '@ecrire = function(v) { $$epo.a.b.c.d = v; };'], '<@ve-cd item={$$epo.a.b}></@ve-cd>'),
  'ep-remonte.mjs': js(['$o = { a: { b: { c: { d: 0, e: { d: 0 } } } } };'], '<b>{$o.a.b.c.d}/{$o.a.b.c.e.d}</b><@ve-ecrit item={$o.a.b}></@ve-ecrit>'),
  'ep-autre.mjs':   js(['$o = { a: { b: { c: { d: 0 } } }, z: { y: { x: { w: 0 } } } };', E4, '@autre = function(v) { $o.z.y.x.w = v; };'], '<@ve-cd item={$o.a.b}></@ve-cd>'),
}

const ombre   = (el: any) => el._shadow || el.shadowRoot || el
const enfants = (el: any) => (Array.from(ombre(el).querySelectorAll('*')) as any[]).filter((c) => /^MJS-/.test(c.tagName))
// ce que montre chaque enfant du parent, dans l'ordre de la page
const vus = (el: any) => enfants(el).map((c) => { const e = ombre(c).querySelector('em'); return e ? e.textContent : '?' }).join('|')
// l'objet écrit, montré en entier
const json = (x: any) => JSON.stringify(x)

const REGLAGES: Array<[string, any]> = [['développement', {}], ['production', { env: 'prod' }], ['production sans enveloppe', { env: 'prod', proxy: false }], ['développement sans enveloppe', { proxy: false }]]

for (const [nom, opts] of REGLAGES) describe(`objet du milieu d'un chemin tenu par un enfant, écrit plus bas par le parent (${nom})`, function () {
  this.timeout(120000)
  let code = ''
  const fenetres: any[] = []

  before(async () => {
    const root   = mjsTmp('prop-objet-du-milieu')
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

  // une appli dans sa fenêtre : avertissements relevés, notifications de chaque composant comptées par variable
  async function appli(balise: string) {
    const win: any = new Window({ url: 'http://localhost/' })
    fenetres.push(win)
    win.eval(`${code}\nglobalThis.µ = µ;`)
    win.__avis = []
    win.µ.warn = (...a: any[]) => { win.__avis.push(a.join(' ')) }
    win.eval(`(() => {
      const P = µ.Element.prototype, n = P._mjs_notifyMutation
      window.__n = {}
      P._mjs_notifyMutation = function (k, ...a) { const c = this.localName.slice(4) + '.' + k; window.__n[c] = (window.__n[c] || 0) + 1; return n.call(this, k, ...a) }
    })()`)
    win.document.body.innerHTML = `<mjs-${balise}></mjs-${balise}>`
    await tic()
    return { win, el: win.document.querySelector('mjs-' + balise) }
  }

  // ce que montrent les enfants avant, puis après chaque écriture du parent
  async function suite(balise: string, valeurs: any[]) {
    const { win, el } = await appli(balise)
    const vu = [vus(el)]
    for (const v of valeurs) {
      el.ecrire(v)
      await tic()
      vu.push(vus(el))
    }
    assert.deepEqual(win.__avis, [], 'aucun avertissement')
    return vu
  }

  it('l\'enfant qui tient l\'objet écrit se redessine (témoin)', async () => {
    assert.deepEqual(await suite('ep-ecrit', [5, 6, 6, 7]), ['0', '5', '6', '6', '7'])
  })

  it('objet tenu un niveau au-dessus de l\'objet écrit (`item={$o.a.b}`, `$o.a.b.c.d = v`)', async () => {
    assert.deepEqual(await suite('ep-n1', [5, 6, 6, 7]), ['0', '5', '6', '6', '7'])
  })

  it('objet tenu deux niveaux au-dessus (`item={$o.a}`)', async () => {
    assert.deepEqual(await suite('ep-n2', [5, 6, 6, 7]), ['0', '5', '6', '6', '7'])
  })

  it('objet tenu trois niveaux au-dessus (`item={$o.a}`, `$o.a.b.c.e.d = v`)', async () => {
    const o = (d: number) => json({ b: { c: { e: { d } } } })
    assert.deepEqual(await suite('ep-n3', [5, 6, 6, 7]), [o(0), o(5), o(6), o(6), o(7)])
  })

  it('la racine tenue par l\'enfant (`item={$o}`)', async () => {
    const o = (d: number) => json({ a: { b: { c: { d } } } })
    assert.deepEqual(await suite('ep-racine', [5, 6, 6, 7]), [o(0), o(5), o(6), o(6), o(7)])
  })

  it('clé calculée au bout du chemin (`$o.a.b.c[k] = v`)', async () => {
    assert.deepEqual(await suite('ep-cle', [5, 6, 6, 7]), ['0', '5', '6', '6', '7'])
  })

  it('suppression au bout du chemin (`delete $o.a.b.c.d`)', async () => {
    assert.deepEqual(await suite('ep-suppr', [0]), [json({ c: { d: 1, e: 2 } }), json({ c: { e: 2 } })])
  })

  it('méthode d\'une liste au bout du chemin (`$o.a.b.c.l.push(v)`, `item={$o.a.b}`)', async () => {
    assert.deepEqual(await suite('ep-pousse', [5, 6]), [json({ c: { l: [] } }), json({ c: { l: [5] } }), json({ c: { l: [5, 6] } })])
  })

  it('deux enfants qui tiennent deux niveaux du même chemin (`item={$o.a}`, `item={$o.a.b}`)', async () => {
    assert.deepEqual(await suite('ep-deux', [5, 6, 6, 7]), ['0|0', '5|5', '6|6', '6|6', '7|7'])
  })

  it('ligne d\'une liste (`{for r in $rows by id}<@ve-cd item={r.x}>`, `$rows[0].x.c.d = v`)', async () => {
    assert.deepEqual(await suite('ep-ligne', [5, 6, 6, 7]), ['0|0', '5|0', '6|0', '6|0', '7|0'])
  })

  it('ligne d\'une liste sans clé (`{for r in $rows}<@ve-cd item={r.x}>`)', async () => {
    assert.deepEqual(await suite('ep-ligne-sans-cle', [5, 6, 6, 7]), ['0|0', '5|0', '6|0', '6|0', '7|0'])
  })

  it('magasin (`item={$$epo.a.b}`, `$$epo.a.b.c.d = v`)', async () => {
    assert.deepEqual(await suite('ep-magasin', [5, 6, 6, 7]), ['0', '5', '6', '6', '7'])
  })

  // règle des props (docs/04-props.md, « Modifier un objet reçu ») : le parent n'est pas prévenu de ce que l'enfant modifie dans un objet
  // reçu par une prop simple, le développement le dit
  it('l\'enfant qui écrit lui-même plus bas dans ce qu\'il tient se redessine ; le parent n\'en est pas prévenu, le développement le dit', async () => {
    const { win, el } = await appli('ep-remonte')
    const enf  = ombre(el).querySelector('mjs-ve-ecrit')
    const etat = () => ombre(el).querySelector('b').textContent + ' ' + vus(el)
    const vu   = [etat()]
    enf.ecrire(5)
    await tic()
    vu.push(etat())
    enf.ecrireBas(6)
    await tic()
    vu.push(etat())
    assert.deepEqual(vu, ['0/0 0/0', '0/0 5/0', '0/0 5/6'])
    const dits = win.__avis.filter((a: string) => a.includes('modifie un objet que <@ep-remonte> lui a passé par sa prop « item »'))
    if (opts.env === 'prod') assert.deepEqual(win.__avis, [], 'aucun avertissement en production')
    else assert.ok(dits.length > 0 && dits.length === win.__avis.length, 'avertissement de la prop modifiée : ' + json(win.__avis))
  })

  it('une écriture sur une autre branche de l\'objet ne prévient pas l\'enfant (écho) ; une écriture sur son chemin, une fois', async () => {
    const { win, el } = await appli('ep-autre')
    win.__n = {}
    el.autre(1)
    await tic()
    assert.equal(vus(el), '0')
    assert.equal(win.__n['ve-cd.item'], undefined, 'enfant prévenu par une écriture qui ne le traverse pas : ' + json(win.__n))
    el.ecrire(5)
    await tic()
    assert.equal(vus(el), '5')
    assert.equal(win.__n['ve-cd.item'], 1, 'enfant prévenu une fois : ' + json(win.__n))
  })
})

// une appli dont aucune balise de composant écrite en dur ne reçoit de prop : le composant dynamique (`<@module $comp item={…}>`) et
// l'étalement sur une balise de composant reposent l'objet par leurs propres aides, sans `µ._mjs_pend` dans le code compilé ; le cœur de
// production garde pourtant le suivi des objets du milieu, comme le développement
const SEULS: Record<string, Record<string, string>> = {
  'le composant dynamique': { 've-cd.mjs': SOURCES['ve-cd.mjs'], 'ep-module.mjs': js([O4, "$comp = 've-cd';", E4], '<@module $comp item={$o.a.b}></@module>') },
  'un étalement sur la balise': { 've-cd.mjs': SOURCES['ve-cd.mjs'], 'ep-etale.mjs': js([O4, E4], '<@ve-cd {...{ item: $o.a.b }}></@ve-cd>') },
}
for (const [quoi, sources] of Object.entries(SEULS)) for (const [nom, opts] of REGLAGES.filter(([, o]) => o.env === 'prod')) describe(`objet du milieu passé par ${quoi}, seule prop de l'appli (${nom})`, function () {
  this.timeout(120000)
  let code = ''
  let win: any

  before(async () => {
    const root   = mjsTmp('prop-objet-du-milieu-seul')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [f, s] of Object.entries(sources)) writeFileSync(join(srcDir, f), s)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), minify: false, ...opts } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b))
    code = files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  })

  after(async () => {
    win?.close?.()
    await terminateSharedWorkerPool()
  })

  it('l\'enfant se redessine quand le parent écrit plus bas (`$o.a.b.c.d = v`)', async () => {
    win = new Window({ url: 'http://localhost/' })
    win.eval(`${code}\nglobalThis.µ = µ;`)
    const balise = Object.keys(sources).find((f) => f.startsWith('ep-'))!.slice(0, -4)
    win.document.body.innerHTML = `<${'mjs-' + balise}></${'mjs-' + balise}>`
    await tic()
    const el = win.document.querySelector('mjs-' + balise)
    const vu = [vus(el)]
    for (const v of [5, 6]) {
      el.ecrire(v)
      await tic()
      vu.push(vus(el))
    }
    assert.deepEqual(vu, ['0', '5', '6'])
  })
})
