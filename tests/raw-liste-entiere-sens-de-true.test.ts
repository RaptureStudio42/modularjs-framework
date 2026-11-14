// `µraw(liste, true)` : toute une liste marquée d'un coup. La liste est µraw, et le `{for}` qui la parcourt tient chacune de ses lignes
// pour brute sans qu'aucune ne soit marquée : la note vit sur la liste seule. Le tableau « chaque ligne marquée une à une » (`rows`)
// contre « la liste marquée avec `true` » (`list`), forme par forme, avec pour témoin la liste µraw aux lignes ordinaires (`plain`) :
// rendu du `{for}` à clé, sans clé, avec indice ; ligne ajoutée après coup ; liste remplacée par une copie ; ligne rangée ailleurs,
// tenue par une autre liste, donnée à un enfant ; liste dans une liste ; `Set` et objet ; liste déjà suivie ; second argument ;
// autre chose qu'un tableau. happy-dom, développement, production et réglage `proxy: false`. Une ligne « sautée » se voit à l'écran :
// son objet est écrit sur place, hors de MJS, puis la liste repasse — le texte d'avant reste.
// L'hôte marque lui-même ses listes (`@markAll`) : la construction de production ne garde le carnet que pour l'appli dont le code écrit
// l'appel ; écrit par un code qu'elle ne lit pas, `true` y reste sans effet. MJS_TABLEAU=<fichier> : le tableau observé y est écrit en JSON

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { attendre, pause } from './helpers/coeur-monter.js'

const HOST = `<script lang="js">
  function pick(l, i) { return l[i]; }
  $rows  = µ.raw([]);
  $bag   = µ.raw([]);
  $live  = [];
  $sel   = null;
  $other = [];
  @fill      = function(a) { $rows = a; };
  @markAll   = function(a) { return µ.raw(a, true); };
  @change    = function(f) { $rows = f($rows); };
  @refresh   = function() { µrefresh($rows); };
  @push      = function(r) { $rows.push(r); };
  @put       = function(i, r) { $rows[i] = r; };
  @insert    = function(i, r) { $rows.splice(i, 0, r); };
  @poke      = function(i, v) { $rows[i].label = v; };
  @pokeAlias = function(i, v) { const r = pick($rows, i); r.label = v; };
  @take      = function(i) { $sel = $rows[i]; };
  @pokeSel   = function(v) { $sel.label = v; };
  @share     = function(i) { $other = [$rows[i]]; };
  @pokeOther = function(v) { $other[0].label = v; };
  @fillBag   = function(a) { $bag = a; };
  @fillLive  = function(a) { $live = a; };
  @markLive  = function(f) { $live = f($live); };
  @pokeLive  = function(i, v) { $live[i].label = v; };
  @pokeLiveAlias = function(i, v) { const r = pick($live, i); r.label = v; };
  @refreshLive   = function() { µrefresh($live); };
</script>
<ul class="k">{for r in $rows by id}<li>{r.id}:{r.label}</li>{end}</ul>
<ul class="u">{for r in $rows}<li>{r.id}:{r.label}</li>{end}</ul>
<ul class="x">{for i, r in $rows by id}<li>{i}/{r.id}:{r.label}</li>{end}</ul>
<ul class="c">{for r in $rows by id}<li><@ligne item={r}></li>{end}</ul>
<ul class="b">{for r in $bag}<li>{r.label}</li>{end}</ul>
<ul class="l">{for r in $live by id}<li>{r.label}</li>{end}</ul>
<p class="sel">{$sel ? $sel.label : '-'}</p>
<ul class="o">{for r in $other by id}<li>{r.label}</li>{end}</ul>
`
const CHILD = `<script lang="js">
  @rename = function(v) { $item.label = v; };
</script>
<b>{$item ? $item.label : ''}</b>
`
// la liste de listes a son hôte : un `{for}` dans une ligne retire à toutes les listes de son composant le saut des lignes pures
const GRID = `<script lang="js">
  $grid = µ.raw([]);
  @fill = function(a) { $grid = a; };
  @markAll = function(a) { return µ.raw(a, true); };
</script>
<ul class="g">{for row in $grid}<li>{for c in row}<i>{c.t}</i>{end}</li>{end}</ul>
`

// un hôte dont le code n'écrit pas l'appel à deux arguments
const OUTSIDE = `<script lang="js">
  $rows = µ.raw([]);
  @fill = function(a) { $rows = a; };
</script>
<ul class="k">{for r in $rows by id}<li>{r.id}:{r.label}</li>{end}</ul>
`
// un hôte dont la variable de la liste a sa table de mise à jour fine (un champ de ligne écrit par un chemin compilé)
const FINE = `<script lang="js">
  $rows = µ.raw([]);
  @fill    = function(a) { $rows = a; };
  @markAll = function(a) { return µ.raw(a, true); };
  @poke    = function(i, v) { $rows[i].label = v; };
</script>
<ul class="k">{for r in $rows by id}<li>{r.id}:{r.label}</li>{end}</ul>
`

type Mode = 'rows' | 'list' | 'plain'
type Obs  = Record<string, any>

async function mount(files: Record<string, string>, opts: Record<string, unknown>): Promise<{ window: any, host: any, µ: any }> {
  const root   = mjsTmp('raw-liste-entiere')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [name, source] of Object.entries(files)) writeFileSync(join(srcDir, name), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), ...opts } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const out   = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const order = [...out.filter((f) => f.startsWith('mjs_')), ...out.filter((f) => !f.startsWith('mjs_'))]
  const code  = order.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  // les avertissements de MJS sont recueillis (texte seul) au lieu d'aller à la console
  window.eval(`${code}\nglobalThis.µ = µ;\nglobalThis.__warned = [];\nµ.warn = function(...a) { globalThis.__warned.push(a.map(String).join(' ')); };`)
  window.document.body.innerHTML = '<mjs-hote></mjs-hote>'
  const host = window.document.querySelector('mjs-hote')
  await attendre(() => !!host._shadow)
  await pause(120)
  return { window, host, µ: window.µ }
}

const tick = async () => { await pause(0); await pause(0); await pause(0) }

// toutes les formes, jouées dans un hôte neuf : ce que montre l'écran après chaque geste
async function observe(mode: Mode, opts: Record<string, unknown>): Promise<{ o: Obs, µ: any }> {
  const { window, host, µ } = await mount({ 'hote.mjs': HOST, 'ligne.mjs': CHILD }, opts)
  const o: Obs  = {}
  // une ligne : marquée une à une dans le seul mode `rows` ; une liste : marquée avec `true` dans le seul mode `list`, par l'hôte
  const item    = (x: any) => mode === 'rows' ? µ.raw(x) : x
  const mark    = (a: any) => mode === 'list' ? host.markAll(a) : µ.raw(a)
  const fresh   = async (...labels: string[]) => { const a = labels.map((label, i) => item({ id: i + 1, label })); host.fill(mark(a)); await tick(); return a }
  // la liste repasse : les mêmes objets, dans un tableau neuf marqué comme le premier
  const review  = async () => { host.change((cur: any[]) => mark(cur.slice())); await tick() }
  const refresh = async () => { host.refresh(); await tick() }
  const lis     = (cls: string): string[] => Array.from(host._shadow.querySelectorAll(`ul.${cls} > li`)).map((li: any) => li.textContent)
  const kids    = (): any[] => Array.from(host._shadow.querySelectorAll('ul.c mjs-ligne'))
  const child   = (): string[] => kids().map((e: any) => e._shadow.querySelector('b').textContent)
  const sel     = (): string => host._shadow.querySelector('p.sel').textContent
  const step    = async (name: string, f: () => Promise<void>) => { try { await f() } catch (e) { o[name + ' — erreur'] = String(e) } }

  await step('rendu', async () => {
    const a = await fresh('a', 'b', 'c', 'd')
    o.rendu = { k: lis('k'), u: lis('u'), x: lis('x') }
    a[1].label = 'B'
    await review()
    o.revue = { k: lis('k'), u: lis('u'), x: lis('x') }
    // la première ligne retirée : les autres glissent d'un rang
    host.change((cur: any[]) => mark(cur.filter((r) => r !== a[0])))
    await tick()
    o.glisse = { k: lis('k'), u: lis('u'), x: lis('x') }
  })

  await step('rafraichie', async () => {
    const a = await fresh('a', 'b', 'c')
    a[2].label = 'C'
    await refresh()
    o.rafraichie = lis('k')
    // l'objet remplacé par un neuf : la façon de montrer le changement d'une ligne brute
    host.change((cur: any[]) => mark(cur.map((r, i) => i === 1 ? item({ id: r.id, label: 'N' }) : r)))
    await tick()
    o.remplacee = lis('k')
  })

  await step('ajoutee', async () => {
    await fresh('a', 'b')
    // jamais marquée, quel que soit le mode : la ligne ajoutée sans rien écrire de plus
    const e = { id: 9, label: 'e' }
    host.push(e)
    await refresh()
    o.ajoutee = lis('k')
    e.label = 'E'
    await review()
    o.ajouteeRevue = lis('k')
    host.put(0, { id: 10, label: 'f' })
    host.insert(1, { id: 11, label: 'g' })
    await refresh()
    o.poseeEtInseree = lis('k')
  })

  await step('copies', async () => {
    const copies = { slice: (l: any[]) => l.slice(), filter: (l: any[]) => l.filter(() => true), map: (l: any[]) => l.map((r) => r), spread: (l: any[]) => [...l], concat: (l: any[]) => l.concat([]) }
    o.copies = {}
    for (const [name, copy] of Object.entries(copies)) {
      await fresh('a', 'b', 'c')
      let c: any[] = []
      host.change((cur: any[]) => (c = copy(cur)))
      await tick()
      const shown = lis('k')
      // le composant écrit dans deux lignes de la copie : par un nom qui tient la ligne, puis par son chemin
      host.pokeAlias(2, 'Q')
      await tick()
      const alias = lis('k')
      host.poke(1, 'P')
      await tick()
      o.copies[name] = { marquee: µ._mjs_rawSet.has(c), notee: !!µ._mjs_rawRows?.has(c), ecran: shown, alias, ecrite: lis('k') }
    }
    // la copie marquée à son tour : ce qu'il faut écrire
    const a = await fresh('a', 'b', 'c')
    host.change((cur: any[]) => mark(cur.filter(() => true)))
    await tick()
    a[0].label = 'A'
    await review()
    o.copieMarquee = lis('k')
  })

  await step('sortie', async () => {
    const a = await fresh('a', 'b', 'c')
    host.take(2)
    await tick()
    o.sortie = sel()
    host.pokeSel('S')
    await tick()
    o.sortieEcrite = { sel: sel(), k: lis('k'), objet: a[2].label }
    await refresh()
    o.sortieRafraichie = lis('k')
  })

  await step('partagee', async () => {
    const a = await fresh('a', 'b')
    host.share(0)
    await tick()
    o.partagee = lis('o')
    host.pokeOther('O')
    await tick()
    o.partageeEcrite = { o: lis('o'), k: lis('k'), objet: a[0].label }
  })

  await step('enfant', async () => {
    const a = await fresh('a', 'b')
    o.enfant = child()
    kids()[0].rename('N')
    await tick()
    o.enfantEcrit = { enfant: child(), k: lis('k'), objet: a[0].label }
  })

  await step('collections', async () => {
    const WSet = window.eval('Set')
    const s    = [item({ id: 1, label: 'a' }), item({ id: 2, label: 'b' })]
    host.fillBag(mark(new WSet(s)))
    await tick()
    s[0].label = 'A'
    host.fillBag(mark(new WSet(s)))
    await tick()
    o.ensembleRevu = lis('b')
    const p = item({ id: 3, label: 'p' })
    host.fillBag(mark({ p }))
    await tick()
    p.label = 'P'
    host.fillBag(mark({ p }))
    await tick()
    o.objetRevu = lis('b')
    host.fillBag(mark(new Uint8Array([1, 2])))
    await tick()
    o.tableauType = lis('b').length
  })

  await step('suivie', async () => {
    const src = [{ id: 1, label: 'a' }, { id: 2, label: 'b' }]
    host.fillLive(src)
    await tick()
    // une liste déjà rangée dans une variable `$`, marquée après coup
    host.markLive((cur: any[]) => { if (mode === 'rows') cur.forEach((r) => µ.raw(r)); return mark(cur) })
    await tick()
    host.pokeLive(0, 'L')
    await tick()
    o.suiviePuisMarquee = lis('l')
    // écrite par un nom, puis changée hors de MJS et signalée par µrefresh
    host.pokeLiveAlias(1, 'Q')
    await tick()
    o.suivieEcriteParUnNom = lis('l')
    src[1].label = 'R'
    host.refreshLive()
    await tick()
    o.suivieRafraichie = lis('l')
  })

  return { o, µ }
}

// la liste de listes : chaque niveau marqué comme le veut le mode
async function observeGrid(mode: Mode): Promise<Obs> {
  const { host, µ } = await mount({ 'hote.mjs': GRID }, {})
  const item = (x: any) => mode === 'rows' ? µ.raw(x) : x
  const mark = (a: any) => mode === 'list' ? host.markAll(a) : µ.raw(a)
  const grid = (): string[] => Array.from(host._shadow.querySelectorAll('ul.g > li')).map((li: any) => li.textContent)
  const cell = (t: string) => item({ t })
  const g    = [item([cell('a'), cell('b')]), item([cell('c')])]
  host.fill(mark(g))
  await tick()
  const o: Obs = { grille: grid(), sousListeNotee: !!µ._mjs_rawRows?.has(g[0]) }
  g[0][0].t = 'A'
  host.fill(mark(g.slice()))
  await tick()
  o.grilleRevue = grid()
  return o
}

// ce que montre l'écran en développement, forme par forme — la même valeur pour le marquage ligne à ligne et pour `true`
const SAME: Obs = {
  rendu:             { k: ['1:a', '2:b', '3:c', '4:d'], u: ['1:a', '2:b', '3:c', '4:d'], x: ['0/1:a', '1/2:b', '2/3:c', '3/4:d'] },
  // la ligne écrite sur place est sautée : à clé, sans clé, avec indice
  revue:             { k: ['1:a', '2:b', '3:c', '4:d'], u: ['1:a', '2:b', '3:c', '4:d'], x: ['0/1:a', '1/2:b', '2/3:c', '3/4:d'] },
  // la ligne qui montre son indice se rejoue quand elle glisse, les autres restent sautées
  glisse:            { k: ['2:b', '3:c', '4:d'], u: ['2:b', '3:c', '4:d'], x: ['0/2:B', '1/3:c', '2/4:d'] },
  // µrefresh fait repasser la liste sans rien sauter : la ligne brute changée sur place se voit ; un objet neuf la montre aussi
  rafraichie:        ['1:a', '2:b', '3:C'],
  remplacee:         ['1:a', '2:N', '3:C'],
  ajoutee:           ['1:a', '2:b', '9:e'],
  copieMarquee:      ['1:a', '2:b', '3:c'],
  sortie:            'c',
  sortieRafraichie:  ['1:a', '2:b', '3:S'],
  partagee:          ['a'],
  // l'autre liste, suivie, montre l'écriture ; la liste brute garde sa ligne sautée
  partageeEcrite:    { o: ['O'], k: ['1:a', '2:b'], objet: 'O' },
  enfant:            ['a', 'b'],
  tableauType:       2,
  suiviePuisMarquee: ['L', 'b'],
}
// … et là où les deux diffèrent : [ligne à ligne, avec `true`]
const DIFFERENT: Record<string, [unknown, unknown]> = {
  // la ligne ajoutée sans marque : relue à chaque passe ligne à ligne, sautée avec `true`
  ajouteeRevue:      [['1:a', '2:b', '9:E'], ['1:a', '2:b', '9:e']],
  poseeEtInseree:    [['10:f', '11:g', '2:b', '9:E'], ['10:f', '11:g', '2:b', '9:E']],
  // la ligne rangée dans une autre variable, écrite par elle : rien ne se redessine ligne à ligne ; avec `true`, ce qui montre cette variable
  sortieEcrite:      [{ sel: 'c', k: ['1:a', '2:b', '3:c'], objet: 'S' }, { sel: 'S', k: ['1:a', '2:b', '3:c'], objet: 'S' }],
  // la ligne donnée à un enfant, écrite par lui : il ne se redessine pas ligne à ligne ; avec `true`, il la suit comme un autre objet
  enfantEcrit:       [{ enfant: ['a', 'b'], k: ['1:a', '2:b'], objet: 'N' }, { enfant: ['N', 'b'], k: ['1:a', '2:b'], objet: 'N' }],
  // `true` ne vaut que pour un tableau : les éléments d'un `Set` ou d'un objet sont relus
  ensembleRevu:      [['a', 'b'], ['A', 'b']],
  objetRevu:         [['p'], ['P']],
  // la liste déjà affichée puis marquée : ligne à ligne, ses lignes restent suivies (écriture par un nom) ; avec `true`, figées, sauf
  // après µrefresh, qui la fait repasser sans rien sauter : vue après `µrefresh` des deux façons
  suivieEcriteParUnNom: [['L', 'Q'], ['L', 'b']],
  suivieRafraichie:     [['L', 'R'], ['L', 'R']],
}
// la copie d'une liste : ni marque ni note. Ligne à ligne, ses lignes restent brutes (l'écriture par un nom ne se voit qu'à la passe
// suivante) ; avec `true`, elles sont de nouveau suivies une à une (l'écriture par un nom redessine)
const COPY: [Obs, Obs] = [
  { marquee: false, notee: false, ecran: ['1:a', '2:b', '3:c'], alias: ['1:a', '2:b', '3:c'], ecrite: ['1:a', '2:P', '3:Q'] },
  { marquee: false, notee: false, ecran: ['1:a', '2:b', '3:c'], alias: ['1:a', '2:b', '3:Q'], ecrite: ['1:a', '2:P', '3:Q'] },
]
// avec le réglage `proxy: false`, ce qui change du tableau du développement : sans enveloppe, la marque se pose sur la liste même
const NO_PROXY: Record<string, [unknown, unknown]> = { suiviePuisMarquee: [['a', 'b'], ['a', 'b']], suivieEcriteParUnNom: [['a', 'b'], ['a', 'b']], suivieRafraichie: [['L', 'R'], ['L', 'R']] }

const GROUPS: [string, string[]][] = [
  ['rendu du {for} — à clé, sans clé, avec indice : pareil, une ligne pure qui garde son objet est sautée', ['rendu', 'revue', 'glisse']],
  ['prévenir l\'écran d\'un changement dans une ligne — µrefresh, objet remplacé : pareil', ['rafraichie', 'remplacee']],
  ['ligne ajoutée après coup (push, indice, splice) : couverte sans rien écrire avec `true`, à marquer une à une sinon', ['ajoutee', 'ajouteeRevue', 'poseeEtInseree']],
  ['ligne sortie de la liste — autre variable, autre liste, prop d\'un enfant : brute partout ligne à ligne, ordinaire hors de sa liste avec `true`', ['sortie', 'sortieEcrite', 'sortieRafraichie', 'partagee', 'partageeEcrite', 'enfant', 'enfantEcrit']],
  ['`Set`, objet, tableau typé : `true` n\'y veut rien dire, leurs éléments se marquent un à un', ['ensembleRevu', 'objetRevu', 'tableauType']],
  ['liste déjà rangée dans une variable `$`, marquée après coup : le chemin compilé se voit des deux façons ; par un nom, ligne à ligne seulement ; après µrefresh, des deux façons', ['suiviePuisMarquee', 'suivieEcriteParUnNom', 'suivieRafraichie']],
]
const MODES: Mode[] = ['rows', 'list', 'plain']
const ENVS: [string, Record<string, unknown>][] = [['dev', {}], ['prod', { env: 'prod', minify: false }], ['sansProxy', { proxy: false }]]

describe('µraw(liste, true) — le sens de `true`, forme par forme, contre le marquage ligne à ligne', function () {
  this.timeout(300000)
  const table: Record<string, Record<string, Obs>> = {}
  const grids: Record<string, Obs> = {}
  let µ: any

  before(async () => {
    for (const [env, opts] of ENVS) {
      table[env] = {}
      for (const mode of MODES) {
        const seen = await observe(mode, opts)
        table[env][mode] = seen.o
        if (env === 'dev' && mode === 'list') µ = seen.µ
      }
    }
    for (const mode of MODES) grids[mode] = await observeGrid(mode)
    if (process.env.MJS_TABLEAU) writeFileSync(process.env.MJS_TABLEAU, JSON.stringify({ ...table, grille: grids }, null, 1) + '\n')
  })
  after(async () => { await terminateSharedWorkerPool() })

  const check = (env: string, key: string, expected?: [unknown, unknown]) => {
    const [rows, list] = expected ?? (key in SAME ? [SAME[key], SAME[key]] : DIFFERENT[key])
    assert.deepEqual(table[env].rows[key], rows, `${env}, ligne à ligne, ${key}`)
    assert.deepEqual(table[env].list[key], list, `${env}, avec true, ${key}`)
  }

  it('aucune forme ne lève, et chacune a son attendu', () => {
    for (const [env] of ENVS) for (const mode of MODES) assert.deepEqual(Object.keys(table[env][mode]).filter((k) => k.endsWith('erreur')).map((k) => k + ' : ' + table[env][mode][k]), [], `${env}, ${mode}`)
    assert.deepEqual(Object.keys(table.dev.list).filter((k) => k !== 'copies' && !(k in SAME) && !(k in DIFFERENT)), [])
  })

  for (const [title, keys] of GROUPS) it(title, () => { for (const key of keys) check('dev', key) })

  it('témoin : sans marque sur ses lignes ni `true`, la liste µraw relit toutes ses lignes', () => {
    assert.deepEqual(table.dev.plain.revue, { k: ['1:a', '2:B', '3:c', '4:d'], u: ['1:a', '2:B', '3:c', '4:d'], x: ['0/1:a', '1/2:B', '2/3:c', '3/4:d'] })
  })

  it('développement : une liste marquée avec ses lignes n\'est pas une liste propre — sa ligne écrite sur place n\'est pas dite, comme ligne à ligne', async () => {
    for (const mode of ['rows', 'list'] as const) {
      const seen = await mount({ 'hote.mjs': FINE }, {})
      const item = (x: any) => mode === 'rows' ? seen.µ.raw(x) : x
      const mark = (a: any[]) => mode === 'rows' ? seen.µ.raw(a) : seen.host.markAll(a)
      const a    = [item({ id: 1, label: 'a' }), item({ id: 2, label: 'b' })]
      seen.host.fill(mark(a))
      await tick()
      a[1].label = 'B'
      seen.host.fill(mark(a.slice()))
      await tick()
      assert.ok(seen.host._mjs_fine, `${mode} : témoin, la variable de la liste a sa table de mise à jour fine`)
      assert.deepEqual(Array.from(seen.host._shadow.querySelectorAll('ul.k > li')).map((li: any) => li.textContent), ['1:a', '2:b'], `${mode} : la ligne est sautée`)
      assert.deepEqual(Array.from(seen.window.eval('globalThis.__warned')), [], `${mode} : un avertissement est parti`)
    }
  })

  it('liste remplacée par une copie (slice, filter, map, étalement, concat) : la copie n\'a ni la marque ni la note', () => {
    for (const name of ['slice', 'filter', 'map', 'spread', 'concat']) {
      assert.deepEqual(table.dev.rows.copies[name], COPY[0], `ligne à ligne, ${name}`)
      assert.deepEqual(table.dev.list.copies[name], COPY[1], `avec true, ${name}`)
    }
    check('dev', 'copieMarquee')
  })

  it('liste dans une liste : `true` ne descend pas, et un {for} dans une ligne retire le saut à tout le composant — pareil', () => {
    for (const mode of ['rows', 'list']) assert.deepEqual(grids[mode], { grille: ['ab', 'c'], sousListeNotee: false, grilleRevue: ['Ab', 'c'] }, mode)
  })

  it('production : le même tableau qu\'en développement', () => {
    for (const mode of MODES) assert.deepEqual(table.prod[mode], table.dev[mode], mode)
  })

  it('réglage "proxy": false : le même tableau, aux écritures par un nom près', () => {
    for (const key of Object.keys(table.dev.list).filter((k) => k !== 'copies')) check('sansProxy', key, NO_PROXY[key])
  })

  it('production, appel écrit hors du code que la construction lit : `true` y reste sans effet, jamais une erreur', async () => {
    const seen = await mount({ 'hote.mjs': OUTSIDE }, { env: 'prod', minify: false })
    assert.equal(seen.µ._mjs_rawRows, void 0, 'le carnet est dans le cœur d\'une appli qui n\'écrit pas l\'appel')
    const a = [{ id: 1, label: 'a' }, { id: 2, label: 'b' }]
    seen.host.fill(seen.µ.raw(a, true))
    await tick()
    a[1].label = 'B'
    seen.host.fill(seen.µ.raw(a.slice(), true))
    await tick()
    // la liste est µraw, ses lignes ordinaires : relues
    assert.deepEqual(Array.from(seen.host._shadow.querySelectorAll('ul.k > li')).map((li: any) => li.textContent), ['1:a', '2:B'])
  })

  it('le second argument : `true` seul compte, et la note ne se retire pas', () => {
    const noted = (x: object) => µ._mjs_rawRows.has(x)
    const l     = [{ id: 1 }]
    assert.ok(µ.raw(l, true) === l, 'µraw rend la liste reçue')
    assert.ok(noted(l) && µ._mjs_rawSet.has(l), 'liste marquée et notée')
    assert.ok(!µ._mjs_rawSet.has(l[0]), 'aucune ligne n\'est marquée')
    µ.raw(l)
    assert.ok(noted(l), 'µraw(liste) après µraw(liste, true) : la note reste')
    µ.raw(l, false)
    assert.ok(noted(l), 'µraw(liste, false) : la note reste')
    const m: unknown[] = []
    µ.raw(m)
    assert.ok(!noted(m), 'µraw(liste) ne note rien')
    µ.raw(m, true)
    assert.ok(noted(m), 'µraw(liste, true) après µraw(liste) : notée')
    for (const v of [1, 'true', 'oui', {}, [], new Boolean(true), 0, false, null, void 0]) {
      const x: unknown[] = []
      µ.raw(x, v)
      assert.ok(!noted(x) && µ._mjs_rawSet.has(x), `second argument ${String(v)} : marquée comme µraw(liste), sans la note`)
    }
    // donné à `map`, µraw reçoit l'indice en second argument : jamais `true`
    const lists: unknown[][] = [[], [], []]
    lists.map(µ.raw)
    for (const x of lists) assert.ok(!noted(x) && µ._mjs_rawSet.has(x), 'µraw donné à map : marquée, sans la note')
  })

  it('autre chose qu\'un tableau : jamais une erreur, la valeur reçue est rendue', () => {
    const revoked = Proxy.revocable([], {})
    revoked.revoke()
    for (const x of [new Map(), new Set(), new Uint8Array(2), {}, (function* () {})(), 5, 'a', true, null, void 0, Symbol('s'), 10n, Object.freeze([1]), revoked.proxy, () => 1]) {
      let r: unknown
      assert.doesNotThrow(() => { r = µ.raw(x, true) }, `µraw(${typeof x}, true) lève`)
      assert.ok(Object.is(r, x), `µraw(${typeof x}, true) ne rend pas la valeur reçue`)
      if (x !== null && typeof x === 'object') assert.ok(µ._mjs_rawSet.has(x), `µraw(${typeof x}, true) : marquée comme µraw(x)`)
    }
  })
})
