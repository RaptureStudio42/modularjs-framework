// écriture profonde du magasin `$$` et de l'état d'un composant `$` : une clé qui vaut `__proto__`, `constructor` ou
// `prototype`, à n'importe quel rang du chemin, est refusée — rien n'est écrit, aucune erreur, un avertissement nomme le
// segment (développement). Chaque forme que le compilateur confie aux aides d'écriture : `=`, `+=`, `||=`, `&&=`, `??=`,
// `++`, `?.` devant la clé écrite, `delete`, appel de méthode, en Civet et en CoffeeScript, en développement et en
// production ; le lien piégé `$$prefs[section][champ] = v` (`section` valant `__proto__`) ne touche pas
// `Object.prototype`. Une clé objet est convertie une fois : un `toString` qui change de nom d'une conversion à l'autre
// ne contourne rien. Un indice ou un symbole n'est jamais un nom réservé, une clé permise écrit toujours

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const CIVET = `<script>
  $$o = { a: { b: 0, l: [0] }, l: [], d: JSON.parse('{"constructor":1,"prototype":2}') }
  $$prefs = { ui: {} }
  $loc = { a: { b: 0, l: [0] }, l: [], d: JSON.parse('{"constructor":1,"prototype":2}') }
  $prefsLoc = { ui: {} }
  @remettre = ->
    $$o = { a: { b: 0, l: [0] }, l: [], d: JSON.parse('{"constructor":1,"prototype":2}') }
    $$prefs = { ui: {} }
    $loc = { a: { b: 0, l: [0] }, l: [], d: JSON.parse('{"constructor":1,"prototype":2}') }
    $prefsLoc = { ui: {} }
  @lire = -> JSON.stringify([$$o, $$prefs, $loc, $prefsLoc, Object.getPrototypeOf($$o.a) == Object.prototype, Object.getPrototypeOf($loc.a) == Object.prototype])
  @sEgal = (k) -> $$o[k].polluK = 1
  @sPlus = (k) -> $$o[k].polluK += 1
  @sOu = (k) -> $$o[k].polluK ||= 1
  @sEt = (k) -> $$o[k].polluK &&= 1
  @sNul = (k) -> $$o[k].polluK ??= 1
  @sIncr = (k) -> $$o[k].polluK++
  @sMilieu = (k) -> $$o.a[k].polluK = 1
  @sFin = (k) -> $$o.a[k] = { polluK: 1 }
  @sOptFin = (k) -> $$o.a?[k] = { polluK: 1 }
  @sEfface = (k) -> delete $$o[k].polluD
  @sOptEfface = (k) -> delete $$o.d?[k]
  @sPousse = (k) -> $$o.l[k].push(1)
  @sPrefs = (section, champ) -> $$prefs[section][champ] = '<img src=x onerror=alert(1)>'
  @sIndice = (i) -> $$o.a.l[i] = 9
  @sSymbole = (s) -> $$o.a[s] = 9
  @luSymbole = (s) -> [$$o.a[s], $loc.a[s]]
  @lEgal = (k) -> $loc[k].polluK = 1
  @lMilieu = (k) -> $loc.a[k].polluK = 1
  @lFin = (k) -> $loc.a[k] = { polluK: 1 }
  @lEfface = (k) -> delete $loc[k].polluD
  @lPousse = (k) -> $loc.l[k].push(1)
  @lPrefs = (section, champ) -> $prefsLoc[section][champ] = '<img src=x onerror=alert(1)>'
  @lIndice = (i) -> $loc.a.l[i] = 9
  @lSymbole = (s) -> $loc.a[s] = 9
  @pPlus = (k) -> $loc[k].polluK += 1
  @pIncr = (k) -> $loc[k].polluK++
  @pOu = (k) -> $loc.a[k] ||= { polluK: 1 }
  @pNul = (k) -> $loc.a[k] ??= { polluK: 1 }
  @pOpt = (k) -> $loc[k]?.polluK = 1
  @pExpr = (r) -> $loc[r.k].polluK = 1
</script>

<p class="etat">{JSON.stringify($$o.a)} {JSON.stringify($loc.a)}</p>
`

const COFFEE = `<script lang="coffee">
$$c = { a: { b: 0 }, l: [] }
$cl = { a: { b: 0 }, l: [] }
@remettre = ->
  $$c = { a: { b: 0 }, l: [] }
  $cl = { a: { b: 0 }, l: [] }
@lire = -> JSON.stringify([$$c, $cl])
@cEgal = (k) -> $$c[k].polluK = 1
@cPlus = (k) -> $$c[k].polluK += 1
@cPousse = (k) -> $$c.l[k].push(1)
@cLocEgal = (k) -> $cl[k].polluK = 1
@cLocPousse = (k) -> $cl.l[k].push(1)
</script>

<p class="etat">{JSON.stringify($$c.a)} {JSON.stringify($cl.a)}</p>
`

// forme, et la clé qu'elle reçoit (un nom réservé à son rang : premier, milieu ou dernier segment)
const FORMES_CIVET  = ['sEgal', 'sPlus', 'sOu', 'sEt', 'sNul', 'sIncr', 'sMilieu', 'sFin', 'sOptFin', 'sEfface', 'sOptEfface', 'sPousse', 'lEgal', 'lMilieu', 'lFin', 'lEfface', 'lPousse']
const FORMES_COFFEE = ['cEgal', 'cPlus', 'cPousse', 'cLocEgal', 'cLocPousse']
// formes qui lisent la cible avant de l'écrire : la lecture suit JavaScript, `prototype` y rend `undefined` et lève sa
// TypeError avant toute écriture (rien n'est écrit, aucun avertissement : la garde ne touche pas les lectures)
const LISENT = new Set(['sPlus', 'sOu', 'sEt', 'sNul', 'sIncr', 'cPlus'])
const LECTURE_VIDE = 'TypeError: Cannot read properties of undefined (reading \'polluK\')'

// clés réservées, sous chaque forme que prend une clé : chaîne, tableau, objet converti ; le nom que l'avertissement cite
const CLES: [string, () => any, string][] = [
  ['\'__proto__\'', () => '__proto__', '__proto__'],
  ['[\'__proto__\']', () => ['__proto__'], '__proto__'],
  ['objet dont toString rend \'__proto__\'', () => ({ toString: () => '__proto__' }), '__proto__'],
  ['\'constructor\'', () => 'constructor', 'constructor'],
  ['\'prototype\'', () => 'prototype', 'prototype'],
]

// témoins posés sur les prototypes et les fonctions de la page : `polluK` et `html` écrits, `polluD` effacé
const TEMOINS = ['Object.prototype', 'Object', 'Array.prototype', 'Function.prototype']
const ECRITS  = ['polluK', 'html']

async function construire(prefixe: string, prod: boolean): Promise<string> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'garde-civet.mjs'), CIVET)
  writeFileSync(join(srcDir, 'garde-coffee.mjs'), COFFEE)
  const opts: any = prod ? { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env: 'prod', js: 'bundle' } : { sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') }
  const bundler = new Bundler(opts)
  const stats   = await bundler.compile()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [])
  await bundler.close()
  if (prod) return readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
  const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b))
  return files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
}

async function monter(code: string, prod: boolean) {
  const window: any = new Window({ url: 'http://localhost/' })
  const avis: string[] = []
  // production : `µ` n'est pas exposé, ses noms internes sont raccourcis
  window.eval(prod ? code : `${code}\nglobalThis.µ = µ;`)
  if (!prod) window.µ.warn = (m: string) => avis.push(String(m))
  window.document.body.innerHTML = '<mjs-garde-civet></mjs-garde-civet><mjs-garde-coffee></mjs-garde-coffee>'
  const civet  = window.document.querySelector('mjs-garde-civet')
  const coffee = window.document.querySelector('mjs-garde-coffee')
  const etat   = (c: any) => c._shadow?.querySelector('.etat')?.textContent
  const fin    = Date.now() + 3000
  while (!(etat(civet) && etat(coffee)) && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
  return { window, civet, coffee, avis, etat }
}

// trace d'un appel : prototypes et fonctions écrits ou effacés, `Array.prototype` rempli, erreur levée, puis les données
// du composant ; tout est retiré ensuite, les données remises
function tracer(window: any, c: any, f: () => any): string {
  window.eval(TEMOINS.map((t) => `Object.defineProperty(${t}, 'polluD', { value: 1, configurable: true, writable: true })`).join(';'))
  let erreur = ''
  try {
    f()
  }
  catch (e: any) {
    erreur = `${e.name}: ${e.message}`
  }
  const ecrits  = TEMOINS.flatMap((t) => ECRITS.map((n) => `Object.prototype.hasOwnProperty.call(${t}, '${n}') ? '${t}.${n}' : ''`))
  const effaces = TEMOINS.map((t) => `Object.prototype.hasOwnProperty.call(${t}, 'polluD') ? '' : '${t}.polluD retiré'`)
  const pollue  = window.eval(`[${ecrits.join(', ')}, Array.prototype.length ? 'Array.prototype[0]' : '', ${effaces.join(', ')}].filter(Boolean)`)
  window.eval(`${TEMOINS.map((t) => [...ECRITS, 'polluD'].map((n) => `delete ${t}.${n}`).join(';')).join(';')}; Array.prototype.length = 0`)
  const donnees = c.lire()
  c.remettre()
  return JSON.stringify({ pollue: [...pollue], erreur, donnees })
}

// clé objet dont le nom change d'une conversion à l'autre
const changeante = (window: any, premier: string, ensuite: string) => window.eval(`(() => { let n = 0; return { toString: () => n++ === 0 ? '${premier}' : '${ensuite}' } })()`)

describe('écriture profonde : __proto__, constructor et prototype refusés dans le chemin, magasin $$ et état $', function () {
  this.timeout(180000)
  const codes: Record<string, string> = {}

  before(async function () {
    this.timeout(240000)
    codes.dev  = await construire('noms-reserves', false)
    codes.prod = await construire('noms-reserves-prod', true)
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const mode of ['dev', 'prod']) {
    const nom  = mode === 'dev' ? 'développement' : 'production'
    const prod = mode === 'prod'

    it(`${nom} : chaque forme refuse chaque clé réservée — rien d'écrit, aucune erreur, un avertissement qui nomme le segment`, async () => {
      const m = await monter(codes[mode], prod)
      try {
        const ecarts: string[] = []
        for (const [comp, formes] of [[m.civet, FORMES_CIVET], [m.coffee, FORMES_COFFEE]] as [any, string[]][]) {
          const intact = tracer(m.window, comp, () => {})
          for (const forme of formes) {
            for (const [cle, valeur, seg] of CLES) {
              m.avis.length = 0
              const lue     = LISENT.has(forme) && seg === 'prototype'
              const attendu = lue ? JSON.stringify({ ...JSON.parse(intact), erreur: LECTURE_VIDE }) : intact
              const trace   = tracer(m.window, comp, () => comp[forme](valeur()))
              if (trace !== attendu) ecarts.push(`${forme}(${cle}) : ${trace}`)
              const avis = lue ? m.avis.length === 0 : m.avis.length === 1 && m.avis[0].includes(`segment « ${seg} »`)
              if (!prod && !avis) ecarts.push(`${forme}(${cle}) : avertissements ${JSON.stringify(m.avis)}`)
            }
          }
        }
        assert.deepEqual(ecarts, [])
      }
      finally {
        m.window.close()
      }
    })

    it(`${nom} : le lien piégé $$prefs[section][champ] = v, et $prefsLoc, laissent Object.prototype.html absent`, async () => {
      const m = await monter(codes[mode], prod)
      try {
        const intact = tracer(m.window, m.civet, () => {})
        assert.equal(tracer(m.window, m.civet, () => m.civet.sPrefs('__proto__', 'html')), intact)
        assert.equal(tracer(m.window, m.civet, () => m.civet.lPrefs('__proto__', 'html')), intact)
        assert.equal(m.window.eval('({}).html'), undefined)
        if (!prod) assert.equal(m.avis.length, 2)
      }
      finally {
        m.window.close()
      }
    })

    it(`${nom} : une clé objet est convertie une fois — un nom qui change entre deux conversions ne contourne rien`, async () => {
      const m = await monter(codes[mode], prod)
      try {
        const intact = tracer(m.window, m.civet, () => {})
        // réservé à la première conversion : refusé, même si la suivante rendrait un nom permis
        assert.equal(tracer(m.window, m.civet, () => m.civet.sEgal(changeante(m.window, '__proto__', 'a'))), intact)
        assert.equal(tracer(m.window, m.civet, () => m.civet.lEgal(changeante(m.window, '__proto__', 'a'))), intact)
        // permis à la première conversion : écrit là, jamais dans le prototype que nommerait la suivante
        const ecrit = (f: () => any) => JSON.parse(tracer(m.window, m.civet, f))
        const s = ecrit(() => m.civet.sEgal(changeante(m.window, 'a', '__proto__')))
        assert.deepEqual([s.pollue, s.erreur, JSON.parse(s.donnees)[0].a.polluK], [[], '', 1])
        const l = ecrit(() => m.civet.lEgal(changeante(m.window, 'a', '__proto__')))
        assert.deepEqual([l.pollue, l.erreur, JSON.parse(l.donnees)[2].a.polluK], [[], '', 1])
      }
      finally {
        m.window.close()
      }
    })

    // ces formes de l'état ne passent pas par les aides d'écriture : l'enveloppe réactive lit `undefined` pour un nom
    // réservé hérité (TypeError de la lecture qui suit) et refuse de l'écrire — déjà vrai sans la garde des chemins
    it(`${nom} : état $, formes laissées à l'enveloppe réactive (+=, ++, ||=, ??=, ?., clé faite d'une expression) — rien d'écrit`, async () => {
      const m = await monter(codes[mode], prod)
      try {
        const intact = JSON.parse(tracer(m.window, m.civet, () => {}))
        const ecarts: string[] = []
        for (const forme of ['pPlus', 'pIncr', 'pOu', 'pNul', 'pOpt', 'pExpr']) {
          for (const [cle, valeur] of CLES) {
            const t = JSON.parse(tracer(m.window, m.civet, () => m.civet[forme](forme === 'pExpr' ? { k: valeur() } : valeur())))
            if (t.pollue.length || t.donnees !== intact.donnees || !/^(|TypeError: .*)$/.test(t.erreur)) ecarts.push(`${forme}(${cle}) : ${JSON.stringify(t)}`)
          }
        }
        assert.deepEqual(ecarts, [])
      }
      finally {
        m.window.close()
      }
    })

    it(`${nom} : un indice, un symbole, une clé permise écrivent et redessinent`, async () => {
      const m = await monter(codes[mode], prod)
      try {
        m.civet.sIndice(0)
        m.civet.lIndice(0)
        const sym = m.window.eval('Symbol("s")')
        m.civet.sSymbole(sym)
        m.civet.lSymbole(sym)
        assert.deepEqual([...m.civet.luSymbole(sym)], [9, 9])
        m.civet.sEgal('a')
        m.civet.lEgal(['a'])
        m.coffee.cEgal('a')
        m.coffee.cLocEgal('a')
        await new Promise((r) => setTimeout(r, 60))
        assert.equal(m.etat(m.civet), '{"b":0,"l":[9],"polluK":1} {"b":0,"l":[9],"polluK":1}')
        assert.equal(m.etat(m.coffee), '{"b":0,"polluK":1} {"b":0,"polluK":1}')
        if (!prod) assert.deepEqual(m.avis, [])
      }
      finally {
        m.window.close()
      }
    })
  }

  it('développement : le nom de la méthode passe aussi la garde (aides appelées directement)', async () => {
    const m = await monter(codes.dev, false)
    try {
      const µ   = m.window.µ
      const obj = µ._mjs_storeRaw.o.a
      for (const nom of ['__proto__', 'constructor', 'prototype']) {
        m.avis.length = 0
        assert.equal(µ._mjs_storeCallOn('o', obj, nom, []), undefined, `_mjs_storeCallOn(${nom})`)
        assert.equal(µ._mjs_storeDeepCall('o', ['a'], nom, []), undefined, `_mjs_storeDeepCall(${nom})`)
        assert.equal(µ._mjs_deepCall(m.civet, ['loc', 'a'], nom, []), undefined, `_mjs_deepCall(${nom})`)
        assert.equal(m.avis.length, 3, `${nom} : ${JSON.stringify(m.avis)}`)
        assert.ok(m.avis.every((a) => a.includes(`segment « ${nom} »`)), JSON.stringify(m.avis))
      }
    }
    finally {
      m.window.close()
    }
  })
})
