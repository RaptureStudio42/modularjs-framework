// état `$` : l'enveloppe d'un prototype rangé par une lecture (`$loc.p = $$o['__proto__']`, `Object.prototype` ;
// `$loc.p = $$o.l['__proto__']`, `Array.prototype` ; à la racine, `$p = $$o['__proto__']`) ne laisse ni geler, ni
// sceller, ni fermer aux ajouts, ni changer le prototype du vrai prototype : `Object.freeze`, `Object.seal`,
// `Object.preventExtensions` et `Object.setPrototypeOf` lèvent leur TypeError, `Reflect.preventExtensions` et
// `Reflect.setPrototypeOf` rendent `false`, directement ou par un alias ; rien n'est touché, un avertissement le dit
// (développement). Un objet ordinaire de l'état se gèle, se scelle et se ferme toujours. Civet et CoffeeScript,
// développement et production

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const CIVET = `<script>
  $$o = { a: 1, l: [] }
  $loc = { a: { b: 0 }, s: { b: 0 }, f: { b: 0 } }
  $p = null
  @ranger = (k) -> $loc.p = $$o[k]
  @rangerListe = (k) -> $loc.p = $$o.l[k]
  @rangerRacine = (k) -> $p = $$o[k]
  @lire = -> $loc.p
  @lireRacine = -> $p
  @gele = -> Object.freeze($loc.p)
  @scelle = -> Object.seal($loc.p)
  @ferme = -> Object.preventExtensions($loc.p)
  @rFerme = -> Reflect.preventExtensions($loc.p)
  @proto = -> Object.setPrototypeOf($loc.p, null)
  @rProto = -> Reflect.setPrototypeOf($loc.p, {})
  @aliasFerme = ->
    t := $loc.p
    Object.preventExtensions(t)
  @aliasGele = ->
    u := $loc.p
    Object.freeze(u)
  @racineGele = -> Object.freeze($p)
  @racineFerme = -> Reflect.preventExtensions($p)
  @permis = ->
    Object.freeze($loc.a)
    Object.seal($loc.s)
    Object.preventExtensions($loc.f)
    [Object.isFrozen($loc.a), Object.isSealed($loc.s), Object.isExtensible($loc.f)]
</script>

<p class="etat">{JSON.stringify($loc.a)}</p>
`

const COFFEE = `<script lang="coffee">
$$c = { a: 1, l: [] }
$cl = { a: { b: 0 }, s: { b: 0 }, f: { b: 0 } }
$cp = null
@ranger = (k) -> $cl.p = $$c[k]
@rangerListe = (k) -> $cl.p = $$c.l[k]
@rangerRacine = (k) -> $cp = $$c[k]
@lire = -> $cl.p
@lireRacine = -> $cp
@gele = -> Object.freeze($cl.p)
@scelle = -> Object.seal($cl.p)
@ferme = -> Object.preventExtensions($cl.p)
@rFerme = -> Reflect.preventExtensions($cl.p)
@proto = -> Object.setPrototypeOf($cl.p, null)
@rProto = -> Reflect.setPrototypeOf($cl.p, {})
@aliasFerme = ->
  t = $cl.p
  Object.preventExtensions(t)
@aliasGele = ->
  u = $cl.p
  Object.freeze(u)
@racineGele = -> Object.freeze($cp)
@racineFerme = -> Reflect.preventExtensions($cp)
@permis = ->
  Object.freeze($cl.a)
  Object.seal($cl.s)
  Object.preventExtensions($cl.f)
  [Object.isFrozen($cl.a), Object.isSealed($cl.s), Object.isExtensible($cl.f)]
</script>

<p class="etat">{JSON.stringify($cl.a)}</p>
`

// forme → [ce qu'elle rend ou lève, ce que dit l'avertissement]
const FERME = 'segment « __proto__ »'
const PROTO = 'changement de prototype refusé'
const FORMES: Record<string, [string, string]> = {
  gele: ['TypeError', FERME],
  scelle: ['TypeError', FERME],
  ferme: ['TypeError', FERME],
  rFerme: ['false', FERME],
  proto: ['TypeError', PROTO],
  rProto: ['false', PROTO],
  aliasFerme: ['TypeError', FERME],
  aliasGele: ['TypeError', FERME],
}
const RANGES = ['ranger', 'rangerListe']
const RACINE: Record<string, [string, string]> = { racineGele: ['TypeError', FERME], racineFerme: ['false', FERME] }

async function construire(prefixe: string, prod: boolean): Promise<string> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'gel-civet.mjs'), CIVET)
  writeFileSync(join(srcDir, 'gel-coffee.mjs'), COFFEE)
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
  window.document.body.innerHTML = '<mjs-gel-civet></mjs-gel-civet><mjs-gel-coffee></mjs-gel-coffee>'
  const civet  = window.document.querySelector('mjs-gel-civet')
  const coffee = window.document.querySelector('mjs-gel-coffee')
  const etat   = (c: any) => c._shadow?.querySelector('.etat')?.textContent
  const fin    = Date.now() + 3000
  while (!(etat(civet) && etat(coffee)) && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
  return { window, civet, coffee, avis, etat }
}

// prototypes de la page touchés : fermés, gelés, prototype changé
function touches(window: any): string[] {
  return [...window.eval(`[
    Object.isExtensible(Object.prototype) ? '' : 'Object.prototype fermé',
    Object.isExtensible(Array.prototype) ? '' : 'Array.prototype fermé',
    Object.getOwnPropertyDescriptor(Object.prototype, 'toString').configurable ? '' : 'Object.prototype scellé',
    Object.getOwnPropertyDescriptor(Array.prototype, 'push').configurable ? '' : 'Array.prototype scellé',
    Object.getPrototypeOf(Array.prototype) === Object.prototype ? '' : 'prototype d\\'Array.prototype changé',
    Object.getPrototypeOf(Object.prototype) === null ? '' : 'prototype d\\'Object.prototype changé',
  ].filter(Boolean)`)]
}

// une forme jouée dans une page neuve (un prototype gelé le reste) : ce qu'elle a touché, rendu ou levé, et dit
async function jouer(code: string, prod: boolean, langue: string, range: string, forme: string, attendu: [string, string]): Promise<string> {
  const m = await monter(code, prod)
  try {
    const c = langue === 'Civet' ? m.civet : m.coffee
    c[range]('__proto__')
    m.avis.length = 0
    let rendu = ''
    try {
      rendu = String(c[forme]())
    }
    catch (e: any) {
      rendu = e.name
    }
    const t = touches(m.window)
    const ecarts: string[] = []
    if (t.length) ecarts.push(JSON.stringify(t))
    if (rendu !== attendu[0]) ecarts.push(`rend ${rendu.slice(0, 40)} au lieu de ${attendu[0]}`)
    if (!prod && !(m.avis.length >= 1 && m.avis.every((a) => a.includes(attendu[1])))) ecarts.push(`avertissements ${JSON.stringify(m.avis)}`)
    return ecarts.length ? `${langue} ${range}('__proto__') puis ${forme}() : ${ecarts.join(' · ')}` : ''
  }
  finally {
    m.window.close()
  }
}

describe('état $ : l\'enveloppe d\'un prototype ne le laisse ni geler, ni sceller, ni fermer, ni changer de prototype', function () {
  this.timeout(240000)
  const codes: Record<string, string> = {}

  before(async function () {
    this.timeout(240000)
    codes.dev  = await construire('gel-proto', false)
    codes.prod = await construire('gel-proto-prod', true)
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const mode of ['dev', 'prod']) {
    const nom  = mode === 'dev' ? 'développement' : 'production'
    const prod = mode === 'prod'

    it(`${nom} : freeze, seal, preventExtensions, setPrototypeOf (Object et Reflect, direct ou par un alias) ne touchent ni Object.prototype ni Array.prototype, Civet et CoffeeScript`, async () => {
      const ecarts: string[] = []
      for (const langue of ['Civet', 'CoffeeScript']) {
        for (const range of RANGES) {
          for (const [forme, attendu] of Object.entries(FORMES)) {
            const e = await jouer(codes[mode], prod, langue, range, forme, attendu)
            if (e) ecarts.push(e)
          }
        }
        for (const [forme, attendu] of Object.entries(RACINE)) {
          const e = await jouer(codes[mode], prod, langue, 'rangerRacine', forme, attendu)
          if (e) ecarts.push(e)
        }
      }
      assert.deepEqual(ecarts, [])
    })

    it(`${nom} : un objet ordinaire de l'état se gèle, se scelle et se ferme toujours, sans avertissement`, async () => {
      const m = await monter(codes[mode], prod)
      try {
        for (const c of [m.civet, m.coffee]) assert.deepEqual([...c.permis()], [true, true, false])
        if (!prod) assert.deepEqual(m.avis, [])
        assert.deepEqual(touches(m.window), [])
      }
      finally {
        m.window.close()
      }
    })
  }
})
