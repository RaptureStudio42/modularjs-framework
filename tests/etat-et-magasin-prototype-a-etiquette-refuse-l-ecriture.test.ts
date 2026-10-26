// prototypes du moteur qui portent une étiquette (`Map.prototype`, `Set.prototype`) : lus par le magasin et rangés
// dans l'état `$` — à la racine (`$racine = $$o.m[k]`) ou plus bas (`$loc.p = $$o.s[k]`), `k` valant
// `__proto__` —, ils sortent enveloppés, comme `Object.prototype`, et rien ne s'y écrit par l'état : `+=`, un alias
// (`t := $racine` puis `t.x = 1`, `delete t.x`), `Object.assign`, la rune `µproxy`, `Reflect.defineProperty`,
// `Object.freeze`, `Reflect.setPrototypeOf`. Le magasin `$$` : une variable qui garde le prototype d'un objet du magasin
// (`p := Object.getPrototypeOf($$o.m)`, `Reflect.getPrototypeOf`) refuse l'écriture, la suppression, la méthode — sa
// valeur reste celle de JavaScript (lecture nue). Rien n'est écrit, un avertissement nomme le segment qui y mène
// (développement). Civet et CoffeeScript, développement et production

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const CIVET = `<script>
  $$o = { m: new Map(), s: new Set(), l: [] }
  $racine = null
  $loc = { a: 1 }
  @rangerMap = (k) -> $racine = $$o.m[k]
  @rangerSet = (k) -> $racine = $$o.s[k]
  @rangerBas = (k) -> $loc.p = $$o.m[k]
  @lire = -> $racine
  @plus = -> $racine.polluK += 1
  @alias = ->
    t := $racine
    t.polluK = 1
  @aliasEfface = ->
    u := $racine
    delete u.polluD
  @assigne = -> Object.assign($racine, { polluK: 1 })
  @rune = -> (µproxy $racine).polluK = 1
  @definit = -> Reflect.defineProperty($racine, 'polluK', { value: 1, configurable: true, writable: true })
  @gele = -> Object.freeze($racine)
  @proto = -> Reflect.setPrototypeOf($racine, null)
  @basPlus = -> $loc.p.polluK += 1
  @basAlias = ->
    v := $loc.p
    v.polluK = 1
  @basAssigne = -> Object.assign($loc.p, { polluK: 1 })
  @magProto = ->
    p1 := Object.getPrototypeOf($$o.m)
    p1.polluK = 1
  @magReflect = ->
    p2 := Reflect.getPrototypeOf($$o.s)
    p2.polluK = 1
  @magEfface = ->
    p3 := Object.getPrototypeOf($$o.m)
    delete p3.polluD
  @magMethode = ->
    p4 := Object.getPrototypeOf($$o.l)
    p4.push(1)
  @magLit = -> [Object.getPrototypeOf($$o.m), Reflect.getPrototypeOf($$o.s)]
</script>

<p class="etat">{JSON.stringify($loc)}</p>
`

const COFFEE = `<script lang="coffee">
$$c = { m: new Map(), s: new Set(), l: [] }
$cr = null
$cl = { a: 1 }
@rangerMap = (k) -> $cr = $$c.m[k]
@rangerSet = (k) -> $cr = $$c.s[k]
@rangerBas = (k) -> $cl.p = $$c.m[k]
@lire = -> $cr
@plus = -> $cr.polluK += 1
@alias = ->
  t = $cr
  t.polluK = 1
@aliasEfface = ->
  u = $cr
  delete u.polluD
@assigne = -> Object.assign($cr, { polluK: 1 })
@rune = -> (µproxy $cr).polluK = 1
@definit = -> Reflect.defineProperty($cr, 'polluK', { value: 1, configurable: true, writable: true })
@gele = -> Object.freeze($cr)
@proto = -> Reflect.setPrototypeOf($cr, null)
@basPlus = -> $cl.p.polluK += 1
@basAlias = ->
  v = $cl.p
  v.polluK = 1
@basAssigne = -> Object.assign($cl.p, { polluK: 1 })
@magProto = ->
  p1 = Object.getPrototypeOf($$c.m)
  p1.polluK = 1
@magReflect = ->
  p2 = Reflect.getPrototypeOf($$c.s)
  p2.polluK = 1
@magEfface = ->
  p3 = Object.getPrototypeOf($$c.m)
  delete p3.polluD
@magMethode = ->
  p4 = Object.getPrototypeOf($$c.l)
  p4.push(1)
@magLit = -> [Object.getPrototypeOf($$c.m), Reflect.getPrototypeOf($$c.s)]
</script>

<p class="etat">{JSON.stringify($cl)}</p>
`

// formes qui écrivent dans le prototype rangé à la racine ; `gele` lève sa TypeError
const FORMES = ['plus', 'alias', 'aliasEfface', 'assigne', 'rune', 'definit', 'gele', 'proto']
const RANGES: [string, string][] = [['rangerMap', 'Map.prototype'], ['rangerSet', 'Set.prototype']]
// formes jouées sans rangement préalable (ou après `rangerBas`) : [forme, rangement, segment de l'avertissement]
const AUTRES: [string, string, string][] = [
  ['basPlus', 'rangerBas', '__proto__'], ['basAlias', 'rangerBas', '__proto__'], ['basAssigne', 'rangerBas', '__proto__'],
  ['magProto', '', '__proto__'], ['magReflect', '', '__proto__'], ['magEfface', '', '__proto__'], ['magMethode', '', '__proto__'],
]

const TEMOINS = ['Map.prototype', 'Set.prototype', 'Function.prototype', 'Array.prototype', 'Object.prototype', 'Map', 'Set', 'Function']

async function construire(prefixe: string, prod: boolean): Promise<string> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'etiq-civet.mjs'), CIVET)
  writeFileSync(join(srcDir, 'etiq-coffee.mjs'), COFFEE)
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
  window.document.body.innerHTML = '<mjs-etiq-civet></mjs-etiq-civet><mjs-etiq-coffee></mjs-etiq-coffee>'
  const civet  = window.document.querySelector('mjs-etiq-civet')
  const coffee = window.document.querySelector('mjs-etiq-coffee')
  const etat   = (c: any) => c._shadow?.querySelector('.etat')?.textContent
  const fin    = Date.now() + 3000
  while (!(etat(civet) && etat(coffee)) && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
  return { window, civet, coffee, avis }
}

// ce que l'appel a touché sur les témoins de la page
function touches(window: any): string[] {
  const parts = TEMOINS.flatMap((t) => [
    `Object.prototype.hasOwnProperty.call(${t}, 'polluK') ? '${t}.polluK' : ''`,
    `Object.prototype.hasOwnProperty.call(${t}, 'polluD') && ${t}.polluD === 1 ? '' : '${t}.polluD touché'`,
    `Object.isExtensible(${t}) ? '' : '${t} fermé'`,
  ])
  parts.push(`Object.getPrototypeOf(Map.prototype) === Object.prototype && Object.getPrototypeOf(Set.prototype) === Object.prototype && Object.getPrototypeOf(Function.prototype) === Object.prototype ? '' : 'prototype changé'`)
  parts.push(`Array.prototype.length ? 'Array.prototype[0]' : ''`)
  return [...window.eval(`[${parts.join(', ')}].filter(Boolean)`)]
}

// une forme jouée dans une page neuve (un prototype gelé le reste) : écart à l'attendu, ou ''
async function jouer(code: string, prod: boolean, langue: string, range: string, forme: string, seg: string): Promise<string> {
  const m = await monter(code, prod)
  try {
    const c = langue === 'Civet' ? m.civet : m.coffee
    m.window.eval(TEMOINS.map((t) => `Object.defineProperty(${t}, 'polluD', { value: 1, configurable: true, writable: true })`).join(';'))
    if (range) c[range]('__proto__')
    m.avis.length = 0
    let erreur = ''
    try {
      c[forme]()
    }
    catch (e: any) {
      erreur = `${e.name}: ${e.message}`
    }
    const ecarts: string[] = []
    const t = touches(m.window)
    if (t.length) ecarts.push(JSON.stringify(t))
    if (forme === 'gele' ? !/^TypeError/.test(erreur) : erreur !== '') ecarts.push(`erreur « ${erreur} »`)
    if (!prod && !(m.avis.length >= 1 && m.avis.every((a) => a.includes(seg)))) ecarts.push(`avertissements ${JSON.stringify(m.avis)}`)
    return ecarts.length ? `${langue} ${range || '(magasin)'} puis ${forme}() : ${ecarts.join(' · ')}` : ''
  }
  finally {
    m.window.close()
  }
}

describe('prototypes à étiquette (Map, Set) : rien ne s\'y écrit par l\'état $ ni par une variable qui garde le prototype d\'un objet du magasin', function () {
  this.timeout(240000)
  const codes: Record<string, string> = {}

  before(async function () {
    this.timeout(240000)
    codes.dev  = await construire('etiq-proto', false)
    codes.prod = await construire('etiq-proto-prod', true)
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const mode of ['dev', 'prod']) {
    const nom  = mode === 'dev' ? 'développement' : 'production'
    const prod = mode === 'prod'

    it(`${nom} : Map.prototype et Set.prototype rangés dans l'état ne reçoivent rien (+=, alias, delete, Object.assign, µproxy, defineProperty, freeze, setPrototypeOf), Civet et CoffeeScript`, async () => {
      const ecarts: string[] = []
      for (const langue of ['Civet', 'CoffeeScript']) {
        for (const [range] of RANGES) {
          for (const forme of FORMES) {
            const e = await jouer(codes[mode], prod, langue, range, forme, forme === 'proto' ? 'changement de prototype refusé' : 'segment « __proto__ »')
            if (e) ecarts.push(e)
          }
        }
        for (const [forme, range, seg] of AUTRES) {
          const e = await jouer(codes[mode], prod, langue, range, forme, `segment « ${seg} »`)
          if (e) ecarts.push(e)
        }
      }
      assert.deepEqual(ecarts, [])
    })

    it(`${nom} : les lectures rendent ce que JavaScript rend — le prototype d'un objet du magasin tel quel, un prototype rangé dans l'état enveloppé`, async () => {
      const m = await monter(codes[mode], prod)
      try {
        const W = m.window
        for (const c of [m.civet, m.coffee]) {
          const [pm, ps] = c.magLit()
          assert.equal(pm, W.Map.prototype)
          assert.equal(ps, W.Set.prototype)
          c.rangerMap('__proto__')
          const p = c.lire()
          assert.equal(typeof p.get, 'function')
          assert.throws(() => p.size, (e: any) => e.name === 'TypeError', 'Map.prototype.size lève, comme en JavaScript')
        }
        if (!prod) assert.deepEqual(m.avis, [])
      }
      finally {
        m.window.close()
      }
    })
  }
})
