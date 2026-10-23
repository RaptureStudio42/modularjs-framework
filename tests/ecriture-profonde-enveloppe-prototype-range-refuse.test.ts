// écriture dans l'état `$` à travers son ENVELOPPE réactive (le Proxy de l'état, filet des écritures que le suivi des
// chemins ne compile pas) quand l'objet visé est un prototype rangé par une lecture : `$loc.p = $$o['__proto__']`
// (`Object.prototype`) ou `$loc.p = $$o.l['__proto__']` (`Array.prototype`), puis `$loc.p.x += 1`, `++`, `||=`, `&&=`,
// `??=` (Civet), `?=`, `or=`, `and=` (CoffeeScript), un alias (`t := $loc.p` puis `t.x = 1`, `delete t.x`,
// `Reflect.defineProperty(t, …)`, `t.push(v)`), `Object.assign($loc.p, …)`, la rune `(µproxy $loc.p).x = 1`. L'enveloppe
// refuse d'écrire, de définir ou de supprimer une propriété dans un prototype : rien n'est écrit, aucune erreur, un
// avertissement nomme le segment qui y mène (développement) ; `Object.defineProperty` lève sa TypeError, comme pour un
// nom réservé. Une fonction rangée de même (`$$o['constructor']`, `Object`) n'a pas d'enveloppe : la lecture rend une
// copie liée, rien n'atteint `Object`. Civet et CoffeeScript, développement et production. Un objet ordinaire, une liste,
// une Map, une Date, un objet sans prototype, un objet dont une donnée s'appelle `constructor` reçoivent toujours ces
// écritures, et la vue suit

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const CIVET = `<script>
  $$o = { l: [], d: JSON.parse('{"constructor":1,"prototype":2}'), n: Object.create(null), m: new Map(), t: new Date(0) }
  $loc = { a: { b: 0 } }
  @remettre = ->
    $loc = { a: { b: 0 } }
  @lire = -> JSON.stringify($loc)
  @ranger = (k) -> $loc.p = $$o[k]
  @rangerListe = (k) -> $loc.p = $$o.l[k]
  @plus = -> $loc.p.polluK += 1
  @incr = -> $loc.p.polluK++
  @ou = -> $loc.p.polluK ||= 1
  @et = -> $loc.p.polluD &&= 2
  @nul = -> $loc.p.polluK ??= 1
  @alias = ->
    t := $loc.p
    t.polluK = 1
  @aliasEfface = ->
    t := $loc.p
    delete t.polluD
  @aliasDefinit = ->
    t := $loc.p
    Reflect.defineProperty(t, 'polluK', { value: 1, configurable: true, writable: true, enumerable: true })
  @aliasDefinitObjet = ->
    t := $loc.p
    Object.defineProperty(t, 'polluK', { value: 1, configurable: true, writable: true, enumerable: true })
  @aliasPousse = ->
    t := $loc.p
    t.push(1)
  @assigne = -> Object.assign($loc.p, { polluK: 1 })
  @rune = -> (µproxy $loc.p).polluK = 1
  @permis = ->
    t := $loc.a
    t.b += 1
    t.c = 1
    Object.assign($loc.a, { d: 1 })
    (µproxy $loc.a).e = 1
    $loc.a.f ||= 1
    delete t.c
    Reflect.defineProperty(t, 'g', { value: 1, configurable: true, writable: true, enumerable: true })
    $loc.l = [1, 2]
    u := $loc.l
    u.push(3)
    u[0] += 10
    $loc.n = $$o.n
    n := $loc.n
    n.x = 2
    $loc.d = $$o.d
    d := $loc.d
    d.x = 3
    $loc.m = $$o.m
    m := $loc.m
    m.set('k', 4)
    m.x = 5
    $loc.t = $$o.t
    j := $loc.t
    j.x = 6
    JSON.stringify([$loc.l, $$o.n.x, $$o.d, $$o.m.get('k'), $$o.m.x, $$o.t.x])
</script>

<p class="etat">{JSON.stringify($loc.a)}</p>
`

const COFFEE = `<script lang="coffee">
$$c = { l: [], d: JSON.parse('{"constructor":1,"prototype":2}'), n: Object.create(null), m: new Map() }
$cl = { a: { b: 0 } }
@remettre = ->
  $cl = { a: { b: 0 } }
@lire = -> JSON.stringify($cl)
@ranger = (k) -> $cl.p = $$c[k]
@rangerListe = (k) -> $cl.p = $$c.l[k]
@plus = -> $cl.p.polluK += 1
@existe = -> $cl.p.polluK ?= 1
@ou = -> $cl.p.polluK or= 1
@et = -> $cl.p.polluD and= 2
@alias = ->
  t = $cl.p
  t.polluK = 1
@aliasEfface = ->
  t = $cl.p
  delete t.polluD
@aliasPousse = ->
  t = $cl.p
  t.push(1)
@assigne = -> Object.assign($cl.p, { polluK: 1 })
@rune = -> (µproxy $cl.p).polluK = 1
@permis = ->
  t = $cl.a
  t.b += 1
  t.c = 1
  Object.assign($cl.a, { d: 1 })
  (µproxy $cl.a).e = 1
  $cl.a.f or= 1
  $cl.a.h ?= 1
  delete t.c
  $cl.l = [1, 2]
  u = $cl.l
  u.push(3)
  u[0] += 10
  $cl.n = $$c.n
  n = $cl.n
  n.x = 2
  $cl.d = $$c.d
  d = $cl.d
  d.x = 3
  $cl.m = $$c.m
  m = $cl.m
  m.set('k', 4)
  JSON.stringify([$cl.l, $$c.n.x, $$c.d, $$c.m.get('k')])
</script>

<p class="etat">{JSON.stringify($cl.a)}</p>
`

// formes qui écrivent par l'enveloppe ; `aliasPousse` (méthode d'une liste) ne vise que `Array.prototype`
const FORMES_CIVET  = ['plus', 'incr', 'ou', 'et', 'nul', 'alias', 'aliasEfface', 'aliasDefinit', 'assigne', 'rune']
const FORMES_COFFEE = ['plus', 'existe', 'ou', 'et', 'alias', 'aliasEfface', 'assigne', 'rune']

// la lecture qui range : `__proto__` mène à `Object.prototype` (`$$o[k]`) ou à `Array.prototype` (`$$o.l[k]`),
// `constructor` à la fonction `Object` ou `Array`
const RANGES: [string, string][] = [['ranger', '__proto__'], ['rangerListe', '__proto__'], ['ranger', 'constructor'], ['rangerListe', 'constructor']]

// témoins posés sur les prototypes et les fonctions de la page : `polluK` écrit, `polluD` effacé ou changé
const TEMOINS = ['Object.prototype', 'Object', 'Array.prototype', 'Array', 'Function.prototype']

async function construire(prefixe: string, prod: boolean): Promise<string> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'env-civet.mjs'), CIVET)
  writeFileSync(join(srcDir, 'env-coffee.mjs'), COFFEE)
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
  window.document.body.innerHTML = '<mjs-env-civet></mjs-env-civet><mjs-env-coffee></mjs-env-coffee>'
  const civet  = window.document.querySelector('mjs-env-civet')
  const coffee = window.document.querySelector('mjs-env-coffee')
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
  const ecrits  = TEMOINS.map((t) => `Object.prototype.hasOwnProperty.call(${t}, 'polluK') ? '${t}.polluK' : ''`)
  const touches = TEMOINS.map((t) => `Object.prototype.hasOwnProperty.call(${t}, 'polluD') && ${t}.polluD === 1 ? '' : '${t}.polluD touché'`)
  const pollue  = window.eval(`[${ecrits.join(', ')}, Array.prototype.length ? 'Array.prototype[0]' : '', ${touches.join(', ')}].filter(Boolean)`)
  window.eval(`${TEMOINS.map((t) => `delete ${t}.polluK; delete ${t}.polluD`).join(';')}; Array.prototype.length = 0`)
  const donnees = c.lire()
  c.remettre()
  return { pollue: [...pollue], erreur, donnees }
}

// écart d'une trace à celle attendue : rien d'écrit, mêmes données, aucune erreur ; en développement, pour un prototype,
// des avertissements qui nomment tous le segment `__proto__`, aucun pour une fonction (rien n'atteint l'enveloppe)
function ecart(t: ReturnType<typeof tracer>, ref: ReturnType<typeof tracer>, cle: string, avis: string[], prod: boolean): string {
  if (t.pollue.length || t.donnees !== ref.donnees || t.erreur !== '') return JSON.stringify(t)
  if (prod) return ''
  const bon = cle === 'constructor' ? avis.length === 0 : avis.length > 0 && avis.every((a) => a.includes('segment « __proto__ »'))
  return bon ? '' : `avertissements ${JSON.stringify(avis)}`
}

describe('écriture dans l\'état $ par son enveloppe réactive : un prototype rangé par une lecture ne reçoit rien', function () {
  this.timeout(180000)
  const codes: Record<string, string> = {}

  before(async function () {
    this.timeout(240000)
    codes.dev  = await construire('env-proto', false)
    codes.prod = await construire('env-proto-prod', true)
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const mode of ['dev', 'prod']) {
    const nom  = mode === 'dev' ? 'développement' : 'production'
    const prod = mode === 'prod'

    it(`${nom} : +=, ++, ||=, &&=, ??=, ?=, or=, and=, un alias, Object.assign, la rune µproxy n'écrivent ni ne suppriment rien dans un prototype ou une fonction rangés dans l'état, Civet et CoffeeScript`, async () => {
      const m = await monter(codes[mode], prod)
      try {
        const ecarts: string[] = []
        for (const [comp, formes, langue] of [[m.civet, FORMES_CIVET, 'Civet'], [m.coffee, FORMES_COFFEE, 'CoffeeScript']] as [any, string[], string][]) {
          for (const [range, cle] of RANGES) {
            const liste = range === 'rangerListe' && cle === '__proto__' ? [...formes, 'aliasPousse'] : formes
            for (const forme of liste) {
              const ref = tracer(m.window, comp, () => comp[range](cle))
              m.avis.length = 0
              const t = tracer(m.window, comp, () => {
                comp[range](cle)
                comp[forme]()
              })
              const e = ecart(t, ref, cle, m.avis, prod)
              if (e) ecarts.push(`${langue} ${range}('${cle}') puis ${forme}() : ${e}`)
            }
          }
        }
        assert.deepEqual(ecarts, [])
      }
      finally {
        m.window.close()
      }
    })

    it(`${nom} : valeurs rendues — une écriture refusée rend sa valeur, une suppression refusée true, Reflect.defineProperty false, Object.defineProperty lève sa TypeError`, async () => {
      const m = await monter(codes[mode], prod)
      try {
        m.civet.ranger('__proto__')
        assert.equal(m.civet.alias(), 1)
        assert.equal(m.civet.rune(), 1)
        assert.equal(m.civet.aliasEfface(), true)
        assert.equal(m.civet.aliasDefinit(), false)
        assert.throws(() => m.civet.aliasDefinitObjet(), (e: any) => e.name === 'TypeError')
        m.coffee.rangerListe('__proto__')
        assert.equal(m.coffee.aliasPousse(), 1)
        assert.equal(m.window.eval('({}).polluK'), undefined)
        assert.equal(m.window.eval('Object.prototype.hasOwnProperty.call(Object.prototype, \'polluK\')'), false)
        assert.equal(m.window.eval('Array.prototype.length'), 0)
        if (!prod) {
          assert.ok(m.avis.length >= 6, JSON.stringify(m.avis))
          assert.ok(m.avis.every((a) => a.includes('segment « __proto__ »')), JSON.stringify(m.avis))
        }
      }
      finally {
        m.window.close()
      }
    })

    it(`${nom} : un objet ordinaire, une liste, une Map, une Date, un objet sans prototype, une donnée qui s'appelle constructor reçoivent toujours ces écritures, et la vue suit`, async () => {
      const m = await monter(codes[mode], prod)
      try {
        assert.equal(m.civet.permis(), '[[11,2,3],2,{"constructor":1,"prototype":2,"x":3},4,5,6]')
        assert.equal(m.coffee.permis(), '[[11,2,3],2,{"constructor":1,"prototype":2,"x":3},4]')
        await new Promise((r) => setTimeout(r, 60))
        assert.equal(m.etat(m.civet), '{"b":1,"d":1,"e":1,"f":1,"g":1}')
        assert.equal(m.etat(m.coffee), '{"b":1,"d":1,"e":1,"f":1,"h":1}')
        if (!prod) assert.deepEqual(m.avis, [])
      }
      finally {
        m.window.close()
      }
    })
  }
})
