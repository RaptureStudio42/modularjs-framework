// écriture profonde de l'état `$` dans un objet RANGÉ par une lecture du magasin : `$loc.p = $$o[k]` (ou `$$o.l[k]`, une
// variable d'état entière `$racine = $$o[k]`), puis `$loc.p.x = v`, `$loc.q.push(v)`, `delete $loc.p.x`. Une clé qui vaut
// `__proto__` y range le prototype, `constructor` la fonction (`Object`, `Array`) : les aides d'écriture de l'état
// (`µ._mjs_deepSet`, `µ._mjs_deepCall`, `µ._mjs_deepDelete`) refusent d'écrire dans un prototype ou dans une fonction —
// rien n'est écrit, aucune erreur, un avertissement nomme le segment qui y mène (développement). `prototype` y range
// `undefined`, comme en JavaScript : l'écriture lève sa TypeError, rien n'est écrit. Civet et CoffeeScript,
// développement et production. Un objet permis rangé de la même façon, un objet sans prototype, une Map, un objet dont
// une donnée s'appelle `constructor` écrivent toujours ; une écriture refusée rend sa valeur, une méthode `undefined`,
// une suppression `false`

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const CIVET = `<script>
  $$o = { a: { b: 0 }, l: [], d: JSON.parse('{"constructor":1,"prototype":2}'), n: Object.create(null), m: new Map() }
  $loc = { a: { b: 0 } }
  $racine = null
  $racineL = null
  @remettre = ->
    $loc = { a: { b: 0 } }
    $racine = null
    $racineL = null
  @lire = -> JSON.stringify([$loc, $racine, $racineL])
  @ranger = (k) -> $loc.p = $$o[k]
  @rangerEtat = (k) -> $loc.p = $loc[k]
  @rangerListe = (k) -> $loc.q = $$o.l[k]
  @rangerRacine = (k) -> $racine = $$o[k]
  @rangerRacineL = (k) -> $racineL = $$o.l[k]
  @rangeEcrit = -> $loc.p.polluK = 1
  @rangeEcritCle = (k2) -> $loc.p[k2] = 1
  @rangePousse = -> $loc.q.push(1)
  @rangeEfface = -> delete $loc.p.polluD
  @racineEcrit = -> $racine.polluK = 1
  @racineEfface = -> delete $racine.polluD
  @racinePousse = -> $racineL.push(1)
  @permis = ->
    $loc.n = $$o.n
    $loc.n.x = 2
    $loc.mm = $$o.m
    $loc.mm.set('k', 3)
    [$$o.n.x, $$o.m.get('k')]
</script>

<p class="etat">{JSON.stringify($loc.a)}</p>
`

const COFFEE = `<script lang="coffee">
$$c = { a: { b: 0 }, l: [] }
$cl = { a: { b: 0 } }
$cr = null
@remettre = ->
  $cl = { a: { b: 0 } }
  $cr = null
@lire = -> JSON.stringify([$cl, $cr])
@ranger = (k) -> $cl.p = $$c[k]
@rangerEtat = (k) -> $cl.p = $cl[k]
@rangerListe = (k) -> $cl.q = $$c.l[k]
@rangerRacine = (k) -> $cr = $$c[k]
@rangeEcrit = -> $cl.p.polluK = 1
@rangePousse = -> $cl.q.push(1)
@rangeEfface = -> delete $cl.p.polluD
@racineEcrit = -> $cr.polluK = 1
@racineEfface = -> delete $cr.polluD
</script>

<p class="etat">{JSON.stringify($cl.a)}</p>
`

// la lecture qui range, puis l'écriture qui vise l'objet rangé (un chemin de l'état, compilé en appel d'une des trois
// aides) ; une clé écrite par une variable reçoit `polluK`
const RANGEES_CIVET: [string, string][] = [
  ['ranger', 'rangeEcrit'], ['ranger', 'rangeEcritCle'], ['ranger', 'rangeEfface'],
  ['rangerListe', 'rangePousse'],
  ['rangerRacine', 'racineEcrit'], ['rangerRacine', 'racineEfface'], ['rangerRacineL', 'racinePousse'],
]
const RANGEES_COFFEE: [string, string][] = [
  ['ranger', 'rangeEcrit'], ['ranger', 'rangeEfface'],
  ['rangerListe', 'rangePousse'],
  ['rangerRacine', 'racineEcrit'], ['rangerRacine', 'racineEfface'],
]

// clés réservées, sous chaque forme que prend une clé : chaîne, tableau, objet converti ; le segment que l'avertissement
// cite (`prototype` mène à `undefined` : aucun)
const CLES: [string, () => any, string][] = [
  ['\'__proto__\'', () => '__proto__', '__proto__'],
  ['[\'__proto__\']', () => ['__proto__'], '__proto__'],
  ['objet dont toString rend \'__proto__\'', () => ({ toString: () => '__proto__' }), '__proto__'],
  ['\'constructor\'', () => 'constructor', 'constructor'],
  ['\'prototype\'', () => 'prototype', 'prototype'],
]

// témoins posés sur les prototypes et les fonctions de la page : `polluK` écrit, `polluD` effacé ou changé
const TEMOINS = ['Object.prototype', 'Object', 'Array.prototype', 'Array', 'Function.prototype']

async function construire(prefixe: string, prod: boolean): Promise<string> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'range-civet.mjs'), CIVET)
  writeFileSync(join(srcDir, 'range-coffee.mjs'), COFFEE)
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
  window.document.body.innerHTML = '<mjs-range-civet></mjs-range-civet><mjs-range-coffee></mjs-range-coffee>'
  const civet  = window.document.querySelector('mjs-range-civet')
  const coffee = window.document.querySelector('mjs-range-coffee')
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

describe('écriture profonde de l\'état $ dans un objet rangé par une lecture : prototype et fonction refusés', function () {
  this.timeout(180000)
  const codes: Record<string, string> = {}

  before(async function () {
    this.timeout(240000)
    codes.dev  = await construire('etat-range', false)
    codes.prod = await construire('etat-range-prod', true)
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const mode of ['dev', 'prod']) {
    const nom  = mode === 'dev' ? 'développement' : 'production'
    const prod = mode === 'prod'

    it(`${nom} : un prototype ou une fonction rangés dans l'état ($loc.p = $$o[k], $racine = $$o[k]) ne reçoivent ni écriture, ni méthode, ni suppression, Civet et CoffeeScript`, async () => {
      const m = await monter(codes[mode], prod)
      try {
        const ecarts: string[] = []
        for (const [comp, rangees, langue] of [[m.civet, RANGEES_CIVET, 'Civet'], [m.coffee, RANGEES_COFFEE, 'CoffeeScript']] as [any, [string, string][], string][]) {
          for (const [range, forme] of rangees) {
            for (const [cle, valeur, seg] of CLES) {
              const ref = tracer(m.window, comp, () => comp[range](valeur()))
              m.avis.length = 0
              const t = tracer(m.window, comp, () => {
                comp[range](valeur())
                comp[forme]('polluK')
              })
              const e = ecart(t, ref, seg, m.avis, prod)
              if (e) ecarts.push(`${langue} ${range}(${cle}) puis ${forme}() : ${e}`)
            }
          }
        }
        assert.deepEqual(ecarts, [])
      }
      finally {
        m.window.close()
      }
    })

    it(`${nom} : valeurs rendues — une écriture refusée rend sa valeur, une méthode refusée undefined, une suppression refusée false`, async () => {
      const m = await monter(codes[mode], prod)
      try {
        m.civet.ranger('__proto__')
        assert.equal(m.civet.rangeEcrit(), 1)
        assert.equal(m.civet.rangeEfface(), false)
        m.civet.rangerListe('__proto__')
        assert.equal(m.civet.rangePousse(), undefined)
        m.civet.rangerRacine('constructor')
        assert.equal(m.civet.racineEcrit(), 1)
        assert.equal(m.civet.racineEfface(), false)
        m.coffee.ranger('__proto__')
        assert.equal(m.coffee.rangeEcrit(), 1)
        assert.equal(m.window.eval('({}).polluK'), undefined)
        assert.equal(m.window.eval('Object.polluK'), undefined)
        assert.equal(m.window.eval('Array.prototype.length'), 0)
        if (!prod) assert.equal(m.avis.length, 6)
      }
      finally {
        m.window.close()
      }
    })

    it(`${nom} : un objet permis rangé de la même façon, un objet sans prototype, une Map, une donnée qui s'appelle constructor écrivent toujours`, async () => {
      const m = await monter(codes[mode], prod)
      try {
        // objet de l'état rangé par une lecture de l'état : l'écriture y va, la vue suit
        m.civet.rangerEtat('a')
        m.civet.rangeEcrit()
        m.coffee.rangerEtat('a')
        m.coffee.rangeEcrit()
        await new Promise((r) => setTimeout(r, 60))
        assert.equal(m.etat(m.civet), '{"b":0,"polluK":1}')
        assert.equal(m.etat(m.coffee), '{"b":0,"polluK":1}')
        // objet du magasin rangé par une lecture : écriture et suppression y vont
        m.civet.ranger('d')
        m.civet.rangeEcrit()
        assert.equal(JSON.parse(m.civet.lire())[0].p.polluK, 1)
        m.civet.rangerRacine('d')
        assert.equal(m.civet.racineEfface(), true)
        m.civet.racineEcrit()
        assert.equal(JSON.parse(m.civet.lire())[1].polluK, 1)
        assert.deepEqual([...m.civet.permis()], [2, 3])
        if (!prod) assert.deepEqual(m.avis, [])
      }
      finally {
        m.window.close()
      }
    })
  }
})
