// magasin `$$` — une écriture, clé calculée comprise, sous toutes ses formes : après un élément trouvé (`find`, `get`),
// après la racine d'un chemin (`$$taches[0][k1]`), à travers une variable qui garde l'élément ou un alias, dans un objet
// fait d'une expression (`($$o[k1] || {})[k2]`), dans un motif de déstructuration, devant un `yield`, avec une clé
// `'__proto__'`, `['__proto__']`, un objet dont `toString` rend `'__proto__'`, `'constructor'` ou `'prototype'`. Chaque
// forme est jouée sur le magasin puis sur sa jumelle, la même source où chaque `$$x` est un objet ordinaire de la page
// (`globalThis.j_x`, que MJS ne réécrit pas), qui laisse la trace de JavaScript (prototypes écrits ou effacés, erreur
// levée, données). Une forme dont le chemin part de la racine (`$$taches[0][k1][k2]`, cf. REFUSEES) passe toutes ses clés
// au refus d'un nom réservé : aucune trace, un avertissement nomme le segment — sauf la lecture qui précède l'écriture
// (`+=`, `++`, `||=`), qui suit JavaScript. Les autres formes, dont l'objet écrit est calculé par le code compilé
// (élément trouvé, `?.`, alias, variable de travail de CoffeeScript, clé faite d'une expression), le lisent comme
// JavaScript : `__proto__` y mène à un prototype, `constructor` à une fonction, que l'aide d'écriture refuse (aucune
// trace, un avertissement nomme le segment) ; `prototype` y mène à `undefined` et laisse la trace de JavaScript. En
// développement comme en production (docs/14-stores.md, « Sécurité »)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const CIVET_SCRIPT = `
  $$taches = [{ id: 1, meta: { vu: false }, tags: [] }]
  $$m = new Map([['a', { n: 1, meta: { vu: false }, tags: [] }]])
  @remettre = ->
    $$taches = [{ id: 1, meta: { vu: false }, tags: [] }]
    $$m = new Map([['a', { n: 1, meta: { vu: false }, tags: [] }]])
  @lire = -> JSON.stringify([$$taches, Array.from($$m)])
  @fEgal = (k1, k2) -> $$taches.find((x) -> x.id == 1)[k1][k2] = 'pollue'
  @fPlus = (k1, k2) -> $$taches.find((x) -> x.id == 1)[k1][k2] += 'pollue'
  @fIncr = (k1, k2) -> $$taches.find((x) -> x.id == 1)[k1][k2]++
  @fOu = (k1, k2) -> $$taches.find((x) -> x.id == 1)[k1][k2] ||= 'pollue'
  @fEfface = (k1, k2) -> delete $$taches.find((x) -> x.id == 1)[k1][k2]
  @fPousse = (k1) -> $$taches.find((x) -> x.id == 1).tags[k1].push('pollue')
  @fOptEgal = (k1, k2) -> $$taches.find((x) -> x.id == 1)[k1]?[k2] = 'pollue'
  @fOptPlus = (k1, k2) -> $$taches.find((x) -> x.id == 1)[k1]?[k2] += 'pollue'
  @fOptEfface = (k1, k2) -> delete $$taches.find((x) -> x.id == 1)[k1]?[k2]
  @fOptPousse = (k1) -> $$m.get('a')?.tags[k1]?.push('pollue')
  @fGetEgal = (k1, k2) -> $$m.get('a')?[k1][k2] = 'pollue'
  @fVar = (k1, k2) ->
    t := $$taches.find((x) -> x.id == 1)
    t[k1][k2] = 'pollue'
  @cEgal = (k1, k2) -> $$taches[0][k1][k2] = 'pollue'
  @cPlus = (k1, k2) -> $$taches[0][k1][k2] += 'pollue'
  @cIncr = (k1, k2) -> $$taches[0][k1][k2]++
  @cOu = (k1, k2) -> $$taches[0][k1][k2] ||= 'pollue'
  @cEfface = (k1, k2) -> delete $$taches[0][k1][k2]
  @cPousse = (k1) -> $$taches[0].tags[k1].push('pollue')
  @cOptEgal = (k1, k2) -> $$taches[0][k1]?[k2] = 'pollue'
  @cOptPlus = (k1, k2) -> $$taches[0][k1]?[k2] += 'pollue'
  @cCalcule = (k1, k2) -> $$taches[0][[k1][0]][k2] = 'pollue'
  @cCalculePlus = (k1, k2) -> $$taches[0][[k1][0]][k2] += 'pollue'
  @aEgal = (k1, k2) ->
    s := $$taches[0]
    s[k1][k2] = 'pollue'
  @aPousse = (k1) ->
    s2 := $$taches[0]
    s2.tags[k1].push('pollue')
  @aValeur = (k1, k2) ->
    pris := $$taches[0][k1]
    pris[k2] = 'pollue'
  @eOuEgal = (k1, k2) -> ($$taches[0][k1] ||= {})[k2] = 'pollue'
  @eOu = (k1, k2) -> ($$taches[0][k1] || {})[k2] = 'pollue'
  @eNul = (k1, k2) -> ($$taches[0][k1] ?? {})[k2] = 'pollue'
  @eTern = (k1, k2) -> (k1 ? $$taches[0][k1] : $$taches[0])[k2] = 'pollue'
  @eVirg = (k1, k2) -> (0, $$taches[0][k1])[k2] = 'pollue'
  @ePlus = (k1, k2) -> ($$taches[0][k1] || {})[k2] += 'pollue'
  @eEfface = (k1, k2) -> delete ($$taches[0][k1] || {})[k2]
  @mAlias = (k1, k2) ->
    da := $$taches[0]
    [da[k1][k2]] = ['pollue']
  @mExpr = (k1, k2) -> [$$taches[0][k1 + ''][k2]] = ['pollue']
  @genF = function*(k1, k2) { $$taches.find((x) => x.id == 1)[k1][k2] = yield 'v' }
  @genA = function*(k1, k2) { const ga = $$taches[0]; ga[k1][k2] = yield 'v' }
  @yFind = (k1, k2) ->
    g := @genF(k1, k2)
    g.next()
    g.next('pollue')
  @yAlias = (k1, k2) ->
    g := @genA(k1, k2)
    g.next()
    g.next('pollue')
  @vOu = (k1, k2) ->
    ov := $$taches[0][k1] || {}
    ov[k2] = 'pollue'
  @vNul = (k1, k2) ->
    nv := $$taches[0][k1] ?? {}
    nv[k2] = 'pollue'
  @vTern = (k1, k2) ->
    tv := k1 ? $$taches[0][k1] : $$taches[0]
    tv[k2] = 'pollue'
  @vOpt = (k1, k2) ->
    mo := $$m.get('a')?[k1]
    mo[k2] = 'pollue'
`

const COFFEE_SCRIPT = `
$$liste = [{ id: 1, meta: { vu: false }, tags: [] }]
$$carte = new Map([['a', { n: 1, meta: { vu: false }, tags: [] }]])
@remettre = ->
  $$liste = [{ id: 1, meta: { vu: false }, tags: [] }]
  $$carte = new Map([['a', { n: 1, meta: { vu: false }, tags: [] }]])
@lire = -> JSON.stringify([$$liste, Array.from($$carte)])
@fEgal = (k1, k2) -> $$liste.find((x) -> x.id == 1)[k1][k2] = 'pollue'
@fPlus = (k1, k2) -> $$liste.find((x) -> x.id == 1)[k1][k2] += 'pollue'
@fIncr = (k1, k2) -> $$liste.find((x) -> x.id == 1)[k1][k2]++
@fOu = (k1, k2) -> $$liste.find((x) -> x.id == 1)[k1][k2] ||= 'pollue'
@fNul = (k1, k2) -> $$liste.find((x) -> x.id == 1)[k1][k2] ?= 'pollue'
@fEfface = (k1, k2) -> delete $$liste.find((x) -> x.id == 1)[k1][k2]
@fPousse = (k1) -> $$liste.find((x) -> x.id == 1).tags[k1].push('pollue')
@fOptEgal = (k1, k2) -> $$liste.find((x) -> x.id == 1)[k1]?[k2] = 'pollue'
@fOptPousse = (k1) -> $$carte.get('a')?.tags[k1]?.push('pollue')
@fGetOu = (k1, k2) -> $$carte.get('a')?[k1][k2] ||= 'pollue'
@fVar = (k1, k2) ->
  t = $$liste.find((x) -> x.id == 1)
  t[k1][k2] = 'pollue'
@cEgal = (k1, k2) -> $$liste[0][k1][k2] = 'pollue'
@cPlus = (k1, k2) -> $$liste[0][k1][k2] += 'pollue'
@cOu = (k1, k2) -> $$liste[0][k1][k2] ||= 'pollue'
@cNul = (k1, k2) -> $$liste[0][k1][k2] ?= 'pollue'
@cEfface = (k1, k2) -> delete $$liste[0][k1][k2]
@cPousse = (k1) -> $$liste[0].tags[k1].push('pollue')
@cOptEgal = (k1, k2) -> $$liste[0][k1]?[k2] = 'pollue'
@aEgal = (k1, k2) ->
  s = $$liste[0]
  s[k1][k2] = 'pollue'
@aValeur = (k1, k2) ->
  pris = $$liste[0][k1]
  pris[k2] = 'pollue'
@eOuEgal = (k1, k2) -> ($$liste[0][k1] or= {})[k2] = 'pollue'
@eOu = (k1, k2) -> ($$liste[0][k1] or {})[k2] = 'pollue'
@mAlias = (k1, k2) ->
  da = $$liste[0]
  [da[k1][k2]] = ['pollue']
@vOu = (k1, k2) ->
  ov = $$liste[0][k1] or {}
  ov[k2] = 'pollue'
@vOpt = (k1, k2) ->
  mo = $$carte.get('a')?[k1]
  mo[k2] = 'pollue'
`

// la jumelle : la même source, chaque `$$x` remplacé par un objet ordinaire de la page — du JavaScript que MJS ne
// réécrit pas, compilé par Civet ou CoffeeScript comme le composant
const jumelle = (script: string) => script.replace(/\$\$(\w+)/g, 'globalThis.j_$1')

const CIVET  = `<script>${CIVET_SCRIPT}</script>\n\n<p class="etat">{JSON.stringify($$taches)} {JSON.stringify([...$$m])}</p>\n`
const COFFEE = `<script lang="coffee">${COFFEE_SCRIPT}</script>\n\n<p class="etat">{JSON.stringify($$liste)} {JSON.stringify([...$$carte])}</p>\n`
const SOURCES = {
  'pollution-civet.mjs': CIVET,
  'pollution-coffee.mjs': COFFEE,
  'pollution-civet-js.mjs': `<script>${jumelle(CIVET_SCRIPT)}</script>\n\n<p class="etat">jumelle</p>\n`,
  'pollution-coffee-js.mjs': `<script lang="coffee">${jumelle(COFFEE_SCRIPT)}</script>\n\n<p class="etat">jumelle</p>\n`,
}

const FORMES_CIVET  = ['fEgal', 'fPlus', 'fIncr', 'fOu', 'fEfface', 'fPousse', 'fOptEgal', 'fOptPlus', 'fOptEfface', 'fOptPousse', 'fGetEgal', 'fVar', 'cEgal', 'cPlus', 'cIncr', 'cOu', 'cEfface', 'cPousse', 'cOptEgal', 'cOptPlus', 'cCalcule', 'cCalculePlus', 'aEgal', 'aPousse', 'aValeur', 'eOuEgal', 'eOu', 'eNul', 'eTern', 'eVirg', 'ePlus', 'eEfface', 'mAlias', 'mExpr', 'yFind', 'yAlias', 'vOu', 'vNul', 'vTern', 'vOpt']
const FORMES_COFFEE = ['fEgal', 'fPlus', 'fIncr', 'fOu', 'fNul', 'fEfface', 'fPousse', 'fOptEgal', 'fOptPousse', 'fGetOu', 'fVar', 'cEgal', 'cPlus', 'cOu', 'cNul', 'cEfface', 'cPousse', 'cOptEgal', 'aEgal', 'aValeur', 'eOuEgal', 'eOu', 'mAlias', 'vOu', 'vOpt']

// clés qui mènent hors des données : vers un prototype, une fonction, ou `undefined` ; le segment refusé qu'elles nomment
const CLES: [string, () => any, string][] = [
  ['\'__proto__\'', () => '__proto__', '__proto__'],
  ['[\'__proto__\']', () => ['__proto__'], '__proto__'],
  ['objet dont toString rend \'__proto__\'', () => ({ toString: () => '__proto__' }), '__proto__'],
  ['\'constructor\'', () => 'constructor', 'constructor'],
  ['\'prototype\'', () => 'prototype', 'prototype'],
]

// formes dont le chemin part de la racine du magasin : chaque clé passe le refus d'un nom réservé
const REFUSEES: Record<string, Set<string>> = {
  Civet: new Set(['cEgal', 'cPlus', 'cIncr', 'cOu', 'cEfface', 'cPousse']),
  CoffeeScript: new Set(['cEgal', 'cPlus', 'cEfface', 'cPousse']),
}
// parmi elles, celles qui lisent la cible avant de l'écrire : `prototype` y rend `undefined`, et la lecture lève la
// TypeError de JavaScript avant toute écriture
const LISENT = new Set(['cPlus', 'cIncr', 'cOu'])
// `($$taches[0][k1] ||= {})[k2] = v` : le `||=` passe par le chemin (refusé, avertissement) ; l'écriture extérieure va
// à l'objet que rend la lecture, comme en JavaScript — sauf `prototype` (lu `undefined`) : elle va au `{}` neuf, que le
// refus n'a pas rangé. Le `||=` de Civet écrit toujours (avertissement pour chaque clé), le `or=` de CoffeeScript
// seulement quand la lecture rend une valeur fausse (`prototype`)
const MIXTE = 'eOuEgal'

// témoins posés sur les prototypes et les fonctions de la page : `polluK` écrit, `polluD` effacé
const TEMOINS = ['Object.prototype', 'Object', 'Array.prototype', 'Function.prototype']

async function construire(prefixe: string, prod: boolean): Promise<string> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
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

// le composant et sa jumelle, montés dans la même page
async function monter(code: string, balise: string, prod: boolean) {
  const window: any = new Window({ url: 'http://localhost/' })
  const avis: string[] = []
  // production : `µ` n'est pas exposé, ses noms internes sont raccourcis
  window.eval(prod ? code : `${code}\nglobalThis.µ = µ;`)
  if (!prod) window.µ.warn = (m: string) => avis.push(String(m))
  window.document.body.innerHTML = `<${balise}></${balise}><${balise}-js></${balise}-js>`
  const comp = window.document.querySelector(balise)
  const jum  = window.document.querySelector(`${balise}-js`)
  const etat = (c: any) => c._shadow?.querySelector('.etat')?.textContent
  const fin  = Date.now() + 3000
  while (!(etat(comp) && etat(jum)) && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
  return { window, comp, jum, avis, prod }
}

// trace d'une forme jouée avec une clé : prototypes et fonctions écrits (`polluK`) ou effacés (`polluD`),
// `Array.prototype` rempli, erreur levée (« … is not a function » ramenée au nom de la méthode : JavaScript y cite
// l'expression appelée), puis les données ; tout est retiré ensuite, les données remises
function tracer(window: any, c: any, forme: string, cle: any): string {
  const efface = forme.includes('Efface')
  window.eval(TEMOINS.map((t) => `Object.defineProperty(${t}, 'polluD', { value: 1, configurable: true, writable: true })`).join(';'))
  let erreur = ''
  try {
    if (forme) c[forme](cle, efface ? 'polluD' : 'polluK')
  }
  catch (e: any) {
    erreur = `${e.name}: ${String(e.message).replace(/^.*?([\w$]+) is not a function$/, '$1 is not a function')}`
  }
  const pollue = window.eval(`[${TEMOINS.map((t) => `Object.prototype.hasOwnProperty.call(${t}, 'polluK') ? '${t}.polluK' : ''`).join(', ')}, Array.prototype.length ? 'Array.prototype[0]' : '', ${TEMOINS.map((t) => `Object.prototype.hasOwnProperty.call(${t}, 'polluD') ? '' : '${t}.polluD retiré'`).join(', ')}].filter(Boolean)`)
  window.eval(`${TEMOINS.map((t) => `delete ${t}.polluK; delete ${t}.polluD`).join(';')}; Array.prototype.length = 0`)
  const donnees = c.lire()
  c.remettre()
  return JSON.stringify({ pollue: [...pollue], erreur, donnees })
}

describe('magasin $$ : une forme par le chemin refuse les noms réservés, les autres le prototype ou la fonction atteints', function () {
  this.timeout(180000)
  const codes: Record<string, string> = {}

  before(async function () {
    this.timeout(240000)
    codes.dev  = await construire('pollution-formes', false)
    codes.prod = await construire('pollution-formes-prod', true)
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const mode of ['dev', 'prod']) {
    for (const [langue, balise, formes] of [['Civet', 'mjs-pollution-civet', FORMES_CIVET], ['CoffeeScript', 'mjs-pollution-coffee', FORMES_COFFEE]] as [string, string, string[]][]) {
      it(`${langue}, ${mode === 'dev' ? 'développement' : 'production'} : ${formes.length} formes × ${CLES.length} clés, refus par le chemin ou de l'objet atteint, trace de JavaScript pour prototype`, async () => {
        const m = await monter(codes[mode], balise, mode === 'prod')
        try {
          const ecarts: string[] = []
          const traces: Record<string, any> = {}
          const intact = tracer(m.window, m.comp, '', null)
          for (const forme of formes) {
            for (const [nom, cle, seg] of CLES) {
              m.avis.length = 0
              const magasin = tracer(m.window, m.comp, forme, cle())
              const js      = tracer(m.window, m.jum, forme, cle())
              const lue     = LISENT.has(forme) && seg === 'prototype'
              const refusee = REFUSEES[langue].has(forme) && !lue
              // les autres formes lisent l'objet écrit comme JavaScript : `__proto__` y mène à un prototype,
              // `constructor` à une fonction, que l'aide d'écriture refuse ; `prototype` à `undefined`
              const atteint = !REFUSEES[langue].has(forme) && seg !== 'prototype'
              const attendu = refusee || atteint || (forme === MIXTE && seg === 'prototype') ? intact : js
              // un avertissement par refus : le `||=` du MIXTE refuse aussi par le chemin
              const averti  = (refusee || atteint ? 1 : 0) + (forme === MIXTE && (langue === 'Civet' || seg === 'prototype') ? 1 : 0)
              if (!m.prod && !(m.avis.length === averti && m.avis.every((a: string) => a.includes(`segment « ${seg} »`)))) ecarts.push(`${forme}(${nom}) : avertissements ${JSON.stringify(m.avis)}`)
              if (magasin !== attendu) ecarts.push(`${forme}(${nom}) : magasin ${magasin} ≠ ${attendu === js ? 'JavaScript' : 'refus'} ${attendu}`)
              traces[`${forme}(${nom})`] = JSON.parse(js)
            }
          }
          assert.deepEqual(ecarts, [])
          // la jumelle fait ce que fait JavaScript : `__proto__` mène au prototype, `constructor` à la fonction,
          // `prototype` à `undefined`
          assert.deepEqual(traces['fEgal(\'__proto__\')'].pollue, ['Object.prototype.polluK'])
          assert.deepEqual(traces['fEgal([\'__proto__\'])'].pollue, ['Object.prototype.polluK'])
          assert.deepEqual(traces['fEgal(\'constructor\')'].pollue, ['Object.polluK'])
          assert.equal(traces['fEgal(\'prototype\')'].erreur, 'TypeError: Cannot set properties of undefined (setting \'polluK\')')
          assert.deepEqual(traces['fEfface(\'__proto__\')'].pollue, ['Object.prototype.polluD retiré'])
          assert.deepEqual(traces['fPousse(\'__proto__\')'].pollue, ['Array.prototype[0]'])
          assert.equal(traces['fPousse(\'constructor\')'].erreur, 'TypeError: push is not a function')
        }
        finally {
          m.window.close()
        }
      })
    }
  }

  it('une clé permise écrit toujours, par chaque famille de forme, et redessine', async () => {
    const { window, comp } = await monter(codes.dev, 'mjs-pollution-civet', false)
    try {
      comp.fEgal('meta', 'vu')
      comp.fOptEgal(['meta'], 'note')
      comp.cEgal({ toString: () => 'meta' }, 'a')
      comp.cCalcule('meta', 'b')
      comp.aEgal('meta', 'c')
      comp.fVar('meta', 'd')
      comp.eOu('meta', 'e')
      comp.mAlias('meta', 'f')
      comp.yAlias('meta', 'g')
      comp.vNul('meta', 'h')
      assert.equal(JSON.stringify(window.µ._mjs_storeRaw.taches[0].meta), '{"vu":"pollue","note":"pollue","a":"pollue","b":"pollue","c":"pollue","d":"pollue","e":"pollue","f":"pollue","g":"pollue","h":"pollue"}')
      await new Promise((r) => setTimeout(r, 60))
      assert.match(comp._shadow.querySelector('.etat').textContent, /"meta":\{"vu":"pollue","note":"pollue","a":"pollue","b":"pollue","c":"pollue","d":"pollue","e":"pollue","f":"pollue","g":"pollue","h":"pollue"\}/)
    }
    finally {
      window.close()
    }
  })
})
