// Valeur dérivée à l'horloge qui lit une collection de l'état (`Map`, `Set`). Dans une appli qui ne nomme aucune collection, le cœur part
// sans la part qui suit les clés objets : une `Map` venue d'une bibliothèque chargée à part n'y est jamais dite « suivie en entier », et
// l'écran suit sa clé écrite par une autre variable ; ce cœur ne porte ni le contrôle des collections ni l'aide des clés. Avec la part, ce
// que range une collection n'est regardé qu'une fois : le verdict est gardé d'une écriture à l'autre (aucun parcours ni calcul à chaque
// frappe sans rapport), le parcours s'arrête à la première entrée que MJS ne suit pas, et le verdict se refait quand la collection change
// par MJS (`set`, `add`, `delete`, champ posé, collection rangée dedans, écriture par `µ.state`) ou après `µrefresh` ; rien n'est retenu
// d'une collection lâchée (ramasse-miettes forcé). Les limites écrites dans la doc gardent leur remède : une fonction rangée plus loin
// dans la collection, la clé tenue sous l'enveloppe d'un autre composant — `µrefresh($m)`. happy-dom, développement et production

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

interface Reglages { prod?: boolean, lisible?: boolean }

async function construire(composants: Record<string, string>, r: Reglages = {}): Promise<string> {
  const root   = mjsTmp('horloge-verdict')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(composants)) writeFileSync(join(srcDir, nom + '.mjs'), source)
  const opts: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js') }
  if (r.prod) Object.assign(opts, { urlPrefix: '/out', env: 'prod', js: 'bundle' })
  if (r.lisible) opts.minify = false
  const bundler = new Bundler(opts)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.deepEqual(stats.errors.map((e: any) => String(e.message)), [])
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
  return r.prod
    ? readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
    : ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
}

async function jouer(code: string, scenario: string, gc?: () => void): Promise<any> {
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  try {
    if (gc) window.__gc = gc
    window.eval(PAGE)
    window.eval(code)
    return JSON.parse(JSON.stringify(await window.eval(scenario)))
  }
  finally {
    await window.happyDOM.close()
  }
}

// la page : tout ce qui fabrique une collection sans que le projet la nomme (la « bibliothèque chargée à part »), les fonctions que
// lisent les valeurs à l'horloge, et le compte des tours — chaque entrée d'une collection surveillée (`__voir`) visitée par un parcours,
// quelle que soit sa voie (`forEach`, `entries`, `values`, `keys`, `for…of`)
const PAGE = `
window.__W = [];
(function () { var w = console.warn; console.warn = function () { window.__W.push(Array.prototype.map.call(arguments, String).join(' ')); }; })();
window.__obj    = (n) => ({ nom: n });
window.__carte  = (k) => new Map([[k, { prix: 2 }]]);
window.__cles   = (m) => { const o = []; m.forEach((v, k) => o.push(k.nom)); return o.join(',') };
window.fnNom    = () => { const f = () => 1; f.nom = 'a'; return f };
window.nReq     = 0;
window.requete  = (x) => { window.nReq++; return x && typeof x === 'object' ? x.v : String(x) };
window.lire     = (x) => { window.nReq++; return x ? String(x.nom) : '-' };
window.lireG    = (x) => { window.nReq++; return x && x.g ? String(x.g.nom) : '-' };
window.lireTous = (l) => { window.nReq++; return l.map((x) => x && x.nom || '').join('') || '-' };
window.__tours  = 0;
window.__vues   = new WeakSet();
window.__voir   = (c) => { window.__vues.add(c); return c };
for (const C of [Map, Set]) {
  const P = C.prototype, fe = P.forEach;
  P.forEach = function (cb, t) { const vu = window.__vues.has(this); return fe.call(this, function (v, k, m) { if (vu) window.__tours++; return cb.call(this, v, k, m) }, t) };
  for (const n of ['entries', 'values', 'keys', Symbol.iterator]) {
    const f = P[n];
    P[n] = function () { const it = f.call(this); return window.__vues.has(this) ? { next() { const r = it.next(); if (!r.done) window.__tours++; return r }, [Symbol.iterator]() { return this } } : it };
  }
}
window.__grande  = (n) => { const m = new Map(); for (let i = 0; i < n; i++) m.set(i, { v: i }); return window.__voir(m) };
window.__grandS  = (n) => { const s = new Set(); for (let i = 0; i < n; i++) s.add(i); return window.__voir(s) };
window.__grandeO = (n) => { const m = new Map(); for (let i = 0; i < n; i++) m.set({ id: i }, { v: i }); return window.__voir(m) };
window.__niveaux = (n) => { const m = new Map(); for (let i = 0; i < n; i++) m.set(i, window.__grande(n)); return window.__voir(m) };
window.__risquee = (n) => { const m = new Map([['f', window.fnNom()]]); for (let i = 0; i < n; i++) m.set(i, { v: i }); return window.__voir(m) };
window.__refs    = [];
window.__suivre  = (x) => { window.__refs.push(new WeakRef(x)); return window.__voir(x) };
window.__vivants = () => window.__refs.filter((r) => r.deref() !== undefined).length;
`
const OUTILS = `const pause = (ms = 30) => new Promise((r) => setTimeout(r, ms))
  const attendre = async (f) => { const fin = Date.now() + 4000; while (!f() && Date.now() < fin) await pause(10) }
  const monter = async (n, sel = '.v') => { const el = document.body.appendChild(document.createElement('mjs-' + n)); await attendre(() => el._shadow && el._shadow.querySelector(sel)); await pause(60); return el }
  const ecran = (el, sel = '.v') => el._shadow.querySelector(sel).textContent
  const frappes = async (el, l) => { const o = []; for (const x of l) { window.__tours = 0; window.nReq = 0; el.w(x); await pause(40); o.push([window.__tours, window.nReq]) } return o }`
const sc = (corps: string): string => `(async () => {
  ${OUTILS}
  const R = {}
  ${corps}
  return R
})()`

// collection venue d'ailleurs, clé objet, lue par une valeur à l'horloge ; la clé écrite par une autre variable
const CLES = "[...$m.keys()].map((x) -> x.nom).join(',')"
const ailleurs = (src: string, lire: string): string => `<script>
k = window.__obj('a')
$k = k
$m = ${src}
$v = ${lire}
@w = (x) -> $k.nom = x
@lire = -> ${lire}
</script>
<p class="v">{$v}</p>
`
const SANS_PART: Record<string, string> = {
  'h-cle':  ailleurs('window.__carte(k)', CLES),
  'h-fe':   ailleurs('window.__carte(k)', 'window.__cles($m)'),
  // valeur précise : la clé brute lue par ses entrées la fait passer à l'horloge
  'h-ent':  ailleurs('window.__carte(k)', "[...$m].map((x) -> x[0].nom).join(',')"),
  'h-glob': ailleurs("new globalThis['M' + 'ap']([[k, 1]])", CLES)
}
const NOMME = "<script>\n$autre = new Map([['a', 1]])\n</script>\n<p class=\"v\">{$autre.size}</p>\n"

// frappes sans rapport à côté d'une valeur à l'horloge montrée qui lit une grande collection
const prix = (decl: string, vues: string[]): string => `<script>
${decl}
${vues.map((v, i) => '$v' + i + ' = ' + v).join('\n')}
$form = {q: ''}
@w = (x) -> $form.q = x
</script>
<p class="v">${vues.map((_, i) => '{$v' + i + '}').join(' ')}</p><p class="q">{$form.q}</p>
`
const PRIX: Record<string, string> = {
  'p-map':    prix('$m = window.__grande(10000)', ['window.requete($m.get(5))']),
  'p-set':    prix('$s = window.__grandS(10000)', ['window.requete($s.has(5))']),
  'p-obj':    prix('$m = window.__grandeO(10000)', ['window.requete($m.size)']),
  'p-deux':   prix('$m = window.__grande(10000)', ['window.requete($m.get(5))', 'window.requete($m.get(6))']),
  'p-niv':    prix('$m = window.__niveaux(100)', ['window.requete($m.size)']),
  'p-risque': prix('$m = window.__risquee(10000)', ['window.requete($m.get(5))'])
}
// tours attendus à la première frappe (le seul parcours), puis à chaque frappe suivante ; calculs par frappe
const ATTENDU: Record<string, [number, number]> = { 'p-map': [10000, 0], 'p-set': [10000, 0], 'p-obj': [10000, 0], 'p-deux': [10000, 0], 'p-niv': [10100, 0], 'p-risque': [1, 1] }

// la collection change après un premier verdict : la fonction rangée ensuite, écrite par sa propre variable, fait suivre l'écran
const change = (decl: string, lire: string, ajout: string): string => `<script>
f = window.fnNom()
$f = f
${decl}
$form = {q: ''}
$v = ${lire}
@w = (x) -> $form.q = x
@nom = (x) -> $f.nom = x
@ajout = ->
  ${ajout.split('\n').join('\n  ')}
</script>
<p class="v">{$v}</p><p class="q">{$form.q}</p>
`
const CHANGE: Record<string, string> = {
  'c-set':     change("$m = new Map([['a', 1]])", "window.lire($m.get('f'))", "$m.set('f', f)"),
  'c-alias':   change("$m = new Map([['a', 1]])", "window.lire($m.get('f'))", "m = $m\nm.set('f', f)"),
  'c-add':     change('$s = new Set([1])', 'window.lireTous([...$s])', '$s.add(f)'),
  'c-niv':     change("$m = new Map([['in', new Map([['a', 1]])]])", "window.lire($m.get('in').get('f'))", "$m.get('in').set('f', f)"),
  'c-champ':   change("$m = new Map([['in', new Map([['a', 1]])]])", "window.lireG($m.get('in').meta)", "$m.get('in').meta = {g: f}"),
  'c-etat':    change("st = µ.state({m: new Map([['a', 1]])})\n$m = st.m", "window.lire($m.get('f'))", "st.m.set('f', f)"),
  'c-refresh': change("m = new Map([['a', 1]])\n$m = m", "window.lire($m.get('f'))", "m.set('f', f)\nµrefresh($m)"),
  'c-retrait': `<script>
f = window.fnNom()
$m = new Map([['a', 1], ['f', f]])
$form = {q: ''}
$v = window.lire($m.get('f'))
@w = (x) -> $form.q = x
@retrait = -> $m.delete('f')
</script>
<p class="v">{$v}</p><p class="q">{$form.q}</p>
`
}

// la collection passée à un enfant, que l'enfant écrit par une clé simple : le verdict gardé chez le parent se refait
const PARTAGE: Record<string, string> = {
  'c-parent': `<script>
f = window.fnNom()
window.__f = f
$f = f
$m = new Map([['a', 1]])
$form = {q: ''}
$v = window.lire($m.get('f'))
@w = (x) -> $form.q = x
@nom = (x) -> $f.nom = x
</script>
<p class="v">{$v}</p><p class="q">{$form.q}</p><@c-enfant m={$m}></@c-enfant>
`,
  'c-enfant': `<script>
$m = null
@ajout = -> $m.set('f', window.__f)
</script>
<p class="e">{if $m}{$m.size}{else}-{end}</p>
`
}

const TAS = `<script>
$m = null
$form = {q: ''}
$v = window.requete(if $m then $m.size else 0)
@neuve = (i) -> $m = window.__suivre(new Map([[i, {v: i}]]))
@w = (x) -> $form.q = x
@vider = -> $m = null
</script>
<p class="v">{$v}</p><p class="q">{$form.q}</p>
`

// limites de la doc et leur remède : fonction rangée dans un objet ordinaire d'une `Map`, clé tenue sous l'enveloppe d'un autre composant
const LIMITES: Record<string, string> = {
  'l-loin': `<script>
f = window.fnNom()
$f = f
$m = new Map([['a', {g: f}]])
$v = [$m.get('a').g.nom].join('')
@w = (x) -> $f.nom = x
@r = -> µrefresh($m)
</script>
<p class="v">{$v}</p>
`,
  'l-a': `<script>
k0 = window.__obj('a')
$rows = [k0]
m = new Map([[$rows[0], 1]])
window.__partage = m
$m = m
@wa = (x) -> $rows[0].nom = x
</script>
<p class="v">{$rows[0].nom}</p>
`,
  'l-b': `<script>
$m = window.__partage
$v = ${CLES}
@r = -> µrefresh($m)
</script>
<p class="v">{$v}</p>
`
}

for (const prod of [false, true]) {
  describe('valeur à l\'horloge qui lit une collection — ' + (prod ? 'production' : 'développement'), function () {
    this.timeout(240000)
    let gc: () => void
    before(() => { setFlagsFromString('--expose_gc'); gc = runInNewContext('gc') })
    after(async () => { await terminateSharedWorkerPool() })

    describe('appli qui ne nomme aucune collection', function () {
      let code: string
      before(async () => { code = await construire(SANS_PART, { prod }) })

      it('l\'écran suit la clé objet d\'une `Map` venue d\'ailleurs, écrite par une autre variable', async () => {
        const r = await jouer(code, sc(`for (const n of ${JSON.stringify(Object.keys(SANS_PART))}) {
          const el = await monter(n)
          const o = [ecran(el)]
          for (const x of ['z', 'y']) { el.w(x); await pause(60); o.push(ecran(el) + '/' + el.lire()) }
          R[n] = o.join(' ; ')
        }
        R.avis = window.__W.filter((w) => /collection/i.test(w))`))
        for (const n of Object.keys(SANS_PART)) assert.equal(r[n], 'a ; z/z ; y/y', n)
        // le développement le dit une fois, et dit quoi écrire : "collections": true, qui ne touche pas au repérage des autres modules
        if (prod) assert.deepEqual(r.avis, [])
        else {
          assert.equal(r.avis.length, 1)
          assert.match(r.avis[0], /"collections": true dans mjs\.config\.json/)
          assert.match(r.avis[0], /sans toucher au repérage des autres modules/)
          assert.doesNotMatch(r.avis[0], /la liste complète/)
        }
      })

      it('son cœur ne porte ni le contrôle des collections suivies ni l\'aide des clés d\'une autre famille', async () => {
        const sans = (await construire(SANS_PART, { prod, lisible: true })).replace(/^[ \t]*\/\/.*$/gm, '')
        const avec = (await construire({ ...SANS_PART, 'n-map': NOMME }, { prod, lisible: true })).replace(/^[ \t]*\/\/.*$/gm, '')
        for (const nom of ['_mjsTracked', '_mjsCollections', '_mjs_doubtKey']) {
          assert.equal(sans.includes(nom), false, nom + ' dans un cœur sans collection')
          assert.equal(avec.includes(nom), true, nom + ' dans le cœur d\'une appli qui nomme `Map`')
        }
      })
    })

    describe('appli qui nomme une collection', function () {
      let code: string
      before(async () => { code = await construire({ ...PRIX, ...CHANGE, ...PARTAGE, ...LIMITES, 't-tas': TAS }, { prod }) })

      it('une frappe sans rapport ne reparcourt pas la collection et ne refait pas la valeur ; le parcours s\'arrête à la première entrée à risque', async () => {
        const r = await jouer(code, sc(`for (const n of ${JSON.stringify(Object.keys(PRIX))}) { const el = await monter(n); R[n] = await frappes(el, ['a', 'ab', 'abc', 'abcd']); R[n + ' q'] = ecran(el, '.q') }`))
        for (const [n, [premier, calculs]] of Object.entries(ATTENDU)) {
          assert.deepEqual(r[n], [[premier, calculs], [0, calculs], [0, calculs], [0, calculs]], n + ' : [tours, calculs] par frappe')
          assert.equal(r[n + ' q'], 'abcd', n)
        }
      })

      it('le verdict se refait quand la collection change par MJS, ou après µrefresh : l\'écran suit la fonction rangée ensuite', async () => {
        const noms = Object.keys(CHANGE).filter((n) => n !== 'c-retrait')
        const r    = await jouer(code, sc(`for (const n of ${JSON.stringify(noms)}) {
          const el = await monter(n)
          const o = [ecran(el)]
          await frappes(el, ['a', 'ab'])
          el.ajout(); await pause(60); o.push(ecran(el))
          for (const x of ['z', 'y']) { el.nom(x); await pause(60); o.push(ecran(el)) }
          R[n] = o.join(' ; ')
        }`))
        for (const n of noms) assert.equal(r[n], '- ; a ; z ; y', n)
      })

      it('une collection passée à un enfant et écrite par lui : le verdict du parent se refait', async () => {
        const r = await jouer(code, sc(`const el = await monter('c-parent')
        await frappes(el, ['a', 'ab'])
        el._shadow.querySelector('mjs-c-enfant').ajout(); await pause(60)
        el.nom('z'); await pause(60)
        R.ecran = ecran(el)`))
        assert.deepEqual(r, { ecran: 'z' })
      })

      it('une collection qui ne range plus rien d\'à risque redevient suivie : la valeur n\'est plus refaite à chaque frappe', async () => {
        const r = await jouer(code, sc(`const el = await monter('c-retrait')
        R.avant = (await frappes(el, ['a', 'ab'])).map((x) => x[1])
        el.retrait(); await pause(60)
        R.apres = (await frappes(el, ['abc', 'abcd'])).map((x) => x[1])
        R.ecran = ecran(el)`))
        assert.deepEqual(r, { avant: [1, 1], apres: [0, 0], ecran: '-' })
      })

      it('10 000 collections jugées puis lâchées : aucune n\'est retenue', async () => {
        const r = await jouer(code, sc(`const el = await monter('t-tas', '.q')
        window.__tours = 0
        for (let i = 0; i < 10000; i++) { el.neuve(i); el.w('x' + i) }
        R.tours = window.__tours
        el.vider(); await pause(80)
        for (let i = 0; i < 3; i++) { window.__gc(); await pause(40) }
        R.vivants = window.__vivants()`), gc)
        assert.deepEqual(r, { tours: 10000, vivants: 0 })
      })

      it('limites écrites : fonction rangée plus loin, clé sous l\'enveloppe d\'un autre composant — µrefresh($m) remet l\'écran', async () => {
        const r = await jouer(code, sc(`{ const el = await monter('l-loin')
          el.w('z'); await pause(60); el.r(); await pause(60); R.loin = [ecran(el)]
          el.w('y'); await pause(60); R.loin.push(ecran(el)) }
        { const a = await monter('l-a'), b = await monter('l-b')
          a.wa('y'); await pause(80); b.r(); await pause(60); R.freres = ecran(b) }`))
        assert.deepEqual(r, { loin: ['z', 'y'], freres: 'y' })
      })
    })
  })
}
