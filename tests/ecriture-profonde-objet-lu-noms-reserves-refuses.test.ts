// écriture du magasin `$$` dont l'objet est d'abord LU par le code, comme JavaScript le lit : `?.` devant la clé écrite,
// variable de travail de CoffeeScript (`?=`, `or=`, `and=`), élément trouvé suivi d'une clé calculée, clé faite d'une
// expression (`$$prefs[r.section][r.champ] = v`), variable ou alias qui garde un objet du magasin, objet fait d'une
// expression (`($$o[k] || {})[k2] = v`), prototype rangé par une lecture (`$$o.p = $$o[k]`, puis `$$o.p.x = v`). Une clé
// qui vaut `__proto__` y mène au prototype, `constructor` à la fonction `Object` : l'aide d'écriture refuse d'écrire dans
// un prototype ou dans une fonction — rien n'est écrit, aucune erreur, un avertissement nomme le segment qui y mène
// (développement). `prototype` y rend `undefined`, comme en JavaScript : `?.` s'arrête, une autre forme lève sa
// TypeError, rien n'est écrit. Civet et CoffeeScript, développement et production. L'enveloppe d'un chemin de l'état
// (`µ._mjs_makeDeepProxy`) refuse les mêmes noms. Une clé permise, un objet sans prototype, un objet dont une donnée
// s'appelle `constructor` écrivent toujours

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const CIVET = `<script>
  $$o = { a: { b: 0 }, l: [], d: JSON.parse('{"constructor":1,"prototype":2}'), n: Object.create(null), m: new Map() }
  $$prefs = { ui: {} }
  $$l = [{ n: 0, t: {}, u: [] }]
  $loc = { a: { b: 0 } }
  $fige = Object.freeze({ a: { b: 0 } })
  @remettre = ->
    $$o = { a: { b: 0 }, l: [], d: JSON.parse('{"constructor":1,"prototype":2}'), n: Object.create(null), m: new Map() }
    $$prefs = { ui: {} }
    $$l = [{ n: 0, t: {}, u: [] }]
    $loc = { a: { b: 0 } }
  @lire = -> JSON.stringify([$$o, $$prefs, $$l, $loc])
  @fOpt = (k) -> $$o[k]?.polluK = 1
  @fOptCle = (k) -> $$o[k]?['polluK'] = 1
  @fTrouve = (k) -> $$l.find((x) -> x.n == 0)[k].polluK = 1
  @fTrouvePlus = (k) -> $$l.find((x) -> x.n == 0)[k].polluK += 1
  @fTrouvePousse = (k) -> $$l.find((x) -> x.n == 0).u[k].push(1)
  @fTrouveEfface = (k) -> delete $$l.find((x) -> x.n == 0)[k].polluD
  @fExpr = (r) -> $$prefs[r.section][r.champ] = '<img src=x onerror=alert(1)>'
  @fExprPlus = (r) -> $$o[r.k].polluK += 1
  @fExprPousse = (r) -> $$o.l[r.k].push(1)
  @fExprEfface = (r) -> delete $$o[r.k].polluD
  @fAlias = (k) ->
    lu1 := $$o[k]
    lu1.polluK = 1
  @fAliasPousse = (k) ->
    lu2 := $$o.l[k]
    lu2.push(1)
  @fOuVide = (k) -> ($$o[k] || {}).polluK = 1
  @fRanger = (k) -> $$o.p = $$o[k]
  @fRangerListe = (k) -> $$o.q = $$o.l[k]
  @fRangeEcrit = -> $$o.p.polluK = 1
  @fRangePousse = -> $$o.q.push(1)
  @fRangeEfface = -> delete $$o.p.polluD
  @pDonnee = -> $$o.d.x = 1
  @pSansModele = -> $$o.n.x = 2
  @pMap = -> $$o.m.set('k', 3)
  @valeurs = -> [$$o.d.x, $$o.n.x, $$o.m.get('k')]
</script>

<p class="etat">{JSON.stringify($$o.a)} {JSON.stringify($$prefs.ui)} {JSON.stringify($$l[0].t)}</p>
`

const COFFEE = `<script lang="coffee">
$$c = { a: { b: 0 }, l: [] }
@remettre = ->
  $$c = { a: { b: 0 }, l: [] }
@lire = -> JSON.stringify([$$c])
@cOpt = (k) -> $$c[k]?.polluK = 1
@cExiste = (k) -> $$c[k].polluK ?= 1
@cOu = (k) -> $$c[k].polluK or= 1
@cEt = (k) -> $$c[k].polluD and= 2
@cExpr = (r) -> $$c[r.section][r.champ] = '<img src=x onerror=alert(1)>'
@cAlias = (k) ->
  t = $$c[k]
  t.polluK = 1
@cOuVide = (k) -> ($$c[k] || {}).polluK = 1
</script>

<p class="etat">{JSON.stringify($$c.a)}</p>
`

// formes à une étape ; une clé faite d'une expression reçoit l'objet `{ section, champ, k }`
const FORMES_CIVET  = ['fOpt', 'fOptCle', 'fTrouve', 'fTrouvePlus', 'fTrouvePousse', 'fTrouveEfface', 'fExpr', 'fExprPlus', 'fExprPousse', 'fExprEfface', 'fAlias', 'fAliasPousse', 'fOuVide']
const FORMES_COFFEE = ['cOpt', 'cExiste', 'cOu', 'cEt', 'cExpr', 'cAlias', 'cOuVide']
// prototype rangé par une lecture : la lecture qui le range, puis l'écriture qui le vise
const RANGEES: [string, string][] = [['fRanger', 'fRangeEcrit'], ['fRangerListe', 'fRangePousse'], ['fRanger', 'fRangeEfface']]
const argument = (forme: string, k: any) => /Expr/.test(forme) ? { section: k, champ: 'html', k } : k

// clés réservées, sous chaque forme que prend une clé : chaîne, tableau, objet converti ; le segment que l'avertissement
// cite (`prototype` mène à `undefined` : aucun)
const CLES: [string, () => any, string][] = [
  ['\'__proto__\'', () => '__proto__', '__proto__'],
  ['[\'__proto__\']', () => ['__proto__'], '__proto__'],
  ['objet dont toString rend \'__proto__\'', () => ({ toString: () => '__proto__' }), '__proto__'],
  ['\'constructor\'', () => 'constructor', 'constructor'],
  ['\'prototype\'', () => 'prototype', 'prototype'],
]

// témoins posés sur les prototypes et les fonctions de la page : `polluK` et `html` écrits, `polluD` effacé ou changé
const TEMOINS = ['Object.prototype', 'Object', 'Array.prototype', 'Array', 'Function.prototype']
const ECRITS  = ['polluK', 'html']

async function construire(prefixe: string, prod: boolean): Promise<string> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'lu-civet.mjs'), CIVET)
  writeFileSync(join(srcDir, 'lu-coffee.mjs'), COFFEE)
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
  window.document.body.innerHTML = '<mjs-lu-civet></mjs-lu-civet><mjs-lu-coffee></mjs-lu-coffee>'
  const civet  = window.document.querySelector('mjs-lu-civet')
  const coffee = window.document.querySelector('mjs-lu-coffee')
  const etat   = (c: any) => c._shadow?.querySelector('.etat')?.textContent
  const fin    = Date.now() + 3000
  while (!(etat(civet) && etat(coffee)) && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
  return { window, civet, coffee, avis, etat }
}

// trace d'un appel : prototypes et fonctions écrits, `polluD` effacé ou changé, `Array.prototype` rempli, erreur levée,
// puis les données du composant ; tout est retiré ensuite, les données remises
function tracer(window: any, c: any, f: () => any): { pollue: string[], erreur: string, donnees: string } {
  window.eval(TEMOINS.map((t) => `Object.defineProperty(${t}, 'polluD', { value: 1, configurable: true, writable: true })`).join(';'))
  let erreur = ''
  try {
    f()
  }
  catch (e: any) {
    erreur = `${e.name}: ${e.message}`
  }
  const ecrits  = TEMOINS.flatMap((t) => ECRITS.map((n) => `Object.prototype.hasOwnProperty.call(${t}, '${n}') ? '${t}.${n}' : ''`))
  const touches = TEMOINS.map((t) => `Object.prototype.hasOwnProperty.call(${t}, 'polluD') && ${t}.polluD === 1 ? '' : '${t}.polluD touché'`)
  const pollue  = window.eval(`[${ecrits.join(', ')}, Array.prototype.length ? 'Array.prototype[0]' : '', ${touches.join(', ')}].filter(Boolean)`)
  window.eval(`${TEMOINS.map((t) => [...ECRITS, 'polluD'].map((n) => `delete ${t}.${n}`).join(';')).join(';')}; Array.prototype.length = 0`)
  const donnees = c.lire()
  c.remettre()
  return { pollue: [...pollue], erreur, donnees }
}

// écart d'une trace à celle attendue : rien d'écrit, mêmes données ; une erreur seulement pour `prototype` (la lecture de
// JavaScript mène à `undefined`) ; en développement, un avertissement qui nomme le segment, aucun pour `prototype`
function ecart(t: ReturnType<typeof tracer>, ref: ReturnType<typeof tracer>, seg: string, avis: string[], prod: boolean): string {
  const vide = seg === 'prototype'
  if (t.pollue.length || t.donnees !== ref.donnees) return JSON.stringify(t)
  if (vide ? !/^(|TypeError: .*)$/.test(t.erreur) : t.erreur !== '') return JSON.stringify(t)
  if (prod) return ''
  const bon = vide ? avis.length === 0 : avis.length === 1 && avis[0].includes(`segment « ${seg} »`)
  return bon ? '' : `avertissements ${JSON.stringify(avis)}`
}

describe('écriture du magasin $$ par un objet lu : prototype et fonction refusés, chaque forme que la garde des chemins ne voit pas', function () {
  this.timeout(180000)
  const codes: Record<string, string> = {}

  before(async function () {
    this.timeout(240000)
    codes.dev  = await construire('objet-lu', false)
    codes.prod = await construire('objet-lu-prod', true)
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const mode of ['dev', 'prod']) {
    const nom  = mode === 'dev' ? 'développement' : 'production'
    const prod = mode === 'prod'

    it(`${nom} : ?., ?=, or=, and=, élément trouvé, clé faite d'une expression, alias, objet fait d'une expression — rien d'écrit dans un prototype ni une fonction`, async () => {
      const m = await monter(codes[mode], prod)
      try {
        const ecarts: string[] = []
        for (const [comp, formes] of [[m.civet, FORMES_CIVET], [m.coffee, FORMES_COFFEE]] as [any, string[]][]) {
          const intact = tracer(m.window, comp, () => {})
          for (const forme of formes) {
            for (const [cle, valeur, seg] of CLES) {
              m.avis.length = 0
              const t = tracer(m.window, comp, () => comp[forme](argument(forme, valeur())))
              const e = ecart(t, intact, seg, m.avis, prod)
              if (e) ecarts.push(`${forme}(${cle}) : ${e}`)
            }
          }
        }
        assert.deepEqual(ecarts, [])
      }
      finally {
        m.window.close()
      }
    })

    it(`${nom} : un prototype ou une fonction rangés par une lecture ($$o.p = $$o[k]) ne reçoivent ni écriture, ni méthode, ni suppression`, async () => {
      const m = await monter(codes[mode], prod)
      try {
        const ecarts: string[] = []
        for (const [range, forme] of RANGEES) {
          for (const [cle, valeur, seg] of CLES) {
            const ref = tracer(m.window, m.civet, () => m.civet[range](valeur()))
            m.avis.length = 0
            const t = tracer(m.window, m.civet, () => {
              m.civet[range](valeur())
              m.civet[forme]()
            })
            const e = ecart(t, ref, seg, m.avis, prod)
            if (e) ecarts.push(`${range}(${cle}) puis ${forme}() : ${e}`)
          }
        }
        assert.deepEqual(ecarts, [])
      }
      finally {
        m.window.close()
      }
    })

    it(`${nom} : le lien piégé $$prefs[r.section][r.champ] = v, Civet et CoffeeScript, laisse Object.prototype.html absent ; valeurs rendues`, async () => {
      const m = await monter(codes[mode], prod)
      try {
        const r = { section: '__proto__', champ: 'html' }
        assert.equal(m.civet.fExpr(r), '<img src=x onerror=alert(1)>')
        assert.equal(m.coffee.cExpr(r), '<img src=x onerror=alert(1)>')
        assert.equal(m.window.eval('({}).html'), undefined)
        assert.equal(m.window.eval('Object.html'), undefined)
        // une écriture refusée rend sa valeur, une méthode refusée `undefined`, une suppression refusée `true`
        assert.equal(m.civet.fTrouve('__proto__'), 1)
        assert.equal(m.civet.fTrouvePousse('__proto__'), undefined)
        assert.equal(m.civet.fTrouveEfface('constructor'), true)
        assert.equal(m.window.eval('Array.prototype.length'), 0)
        if (!prod) assert.equal(m.avis.length, 5)
      }
      finally {
        m.window.close()
      }
    })

    it(`${nom} : une clé permise, un objet sans prototype, un objet dont une donnée s'appelle constructor écrivent et redessinent`, async () => {
      const m = await monter(codes[mode], prod)
      try {
        m.civet.fOpt('a')
        m.civet.fTrouve('t')
        m.civet.fExpr({ section: 'ui', champ: 'x' })
        m.civet.pDonnee()
        m.civet.pSansModele()
        m.civet.pMap()
        m.coffee.cOu('a')
        await new Promise((r) => setTimeout(r, 60))
        assert.equal(m.etat(m.civet), '{"b":0,"polluK":1} {"x":"<img src=x onerror=alert(1)>"} {"polluK":1}')
        assert.equal(m.etat(m.coffee), '{"b":0,"polluK":1}')
        assert.deepEqual([...m.civet.valeurs()], [1, 2, 3])
        // objet rangé par une lecture permise : l'écriture y va
        m.civet.fRanger('d')
        m.civet.fRangeEcrit()
        assert.equal(JSON.parse(m.civet.lire())[0].d.polluK, 1)
        if (!prod) assert.deepEqual(m.avis, [])
      }
      finally {
        m.window.close()
      }
    })
  }

  it('développement : l\'enveloppe d\'un chemin de l\'état (µ._mjs_makeDeepProxy) refuse les noms réservés, écrit par une clé permise', async () => {
    const m = await monter(codes.dev, false)
    try {
      const µ      = m.window.µ
      const ecarts: string[] = []
      const intact = tracer(m.window, m.civet, () => {})
      // un objet gelé de l'état est rendu brut par l'état enveloppé : la suite du chemin n'est plus lue par l'enveloppe
      for (const chemin of [['loc'], ['fige', 'a']]) {
        for (const [cle, valeur, seg] of CLES) {
          m.avis.length = 0
          let rendu: any = 'non appelé'
          const t = tracer(m.window, m.civet, () => {
            rendu = µ._mjs_makeDeepProxy(m.civet, [...chemin, valeur()])
            if (rendu != null) rendu.polluK = 1
          })
          if (rendu !== undefined || t.pollue.length || t.erreur || t.donnees !== intact.donnees) ecarts.push(`${chemin}.${cle} : ${typeof rendu} ${JSON.stringify(t)}`)
          if (!(m.avis.length === 1 && m.avis[0].includes(`segment « ${seg} »`))) ecarts.push(`${chemin}.${cle} : avertissements ${JSON.stringify(m.avis)}`)
        }
      }
      assert.deepEqual(ecarts, [])
      m.avis.length = 0
      const env = µ._mjs_makeDeepProxy(m.civet, ['loc', 'a'])
      env.b = 7
      assert.equal(JSON.parse(m.civet.lire())[3].a.b, 7)
      assert.deepEqual(m.avis, [])
    }
    finally {
      m.window.close()
    }
  })
})
