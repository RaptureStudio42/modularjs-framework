// magasin `$$` : une variable qui garde un objet du magasin (`lu := $$prefs[section]`, `p := Object.getPrototypeOf($$prefs.m)`,
// CoffeeScript `lu = …`) refuse d'écrire dans un prototype même quand son nom est repris ailleurs — dans une autre
// fonction, dans une boucle, réaffecté, paramètre d'une autre fonction : `lu[k] = v`, `delete lu[k]`, `lm.push(x)` passent
// par l'aide gardée, `section` valant `'__proto__'` ne touche ni `Object.prototype`, ni `Map.prototype`, ni
// `Array.prototype`, un avertissement nomme le segment (développement). Une écriture permise par ce nom va à l'objet du
// magasin et redessine la vue. Civet et CoffeeScript, développement et production

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const CIVET = `<script>
  $$prefs = { a: { b: 1 }, m: new Map(), l: [] }
  @lu1 = (s, k) ->
    lu := $$prefs[s]
    lu[k] = 1
  @lu2 = (s, k) ->
    lu := $$prefs[s]
    lu[k] = 2
  @pr1 = (k) ->
    p := Object.getPrototypeOf($$prefs.m)
    p[k] = 1
  @pr2 = (k) ->
    p := Object.getPrototypeOf($$prefs.m)
    p[k] = 2
  @boucle = (s, k) ->
    i .= 0
    while i < 2
      lb := $$prefs[s]
      lb[k] = i
      i++
  @reaffecte = (s, k) ->
    lr .= $$prefs[s]
    lr[k] = 1
    lr = {}
  @param1 = (s, k) ->
    lp := $$prefs[s]
    lp[k] = 1
  @param2 = (lp) -> lp.x = 1
  @efface = (s, k) ->
    lu := $$prefs[s]
    delete lu[k]
  @methode = (s) ->
    lm := $$prefs.l[s]
    lm.push(1)
  @methode2 = ->
    lm := $$prefs.l
    lm.length
  @legit = (s) ->
    lu := $$prefs[s]
    lu.b = 5
</script>

<p class="vue">{$$prefs.a.b}</p>
`

const COFFEE = `<script lang="coffee">
$$cprefs = { a: { b: 1 }, m: new Map(), l: [] }
@lu1 = (s, k) ->
  lu = $$cprefs[s]
  lu[k] = 1
@lu2 = (s, k) ->
  lu = $$cprefs[s]
  lu[k] = 2
@pr1 = (k) ->
  p = Object.getPrototypeOf($$cprefs.m)
  p[k] = 1
@pr2 = (k) ->
  p = Object.getPrototypeOf($$cprefs.m)
  p[k] = 2
@boucle = (s, k) ->
  for i in [0..1]
    lb = $$cprefs[s]
    lb[k] = i
  0
@reaffecte = (s, k) ->
  lr = $$cprefs[s]
  lr[k] = 1
  lr = {}
@param1 = (s, k) ->
  lp = $$cprefs[s]
  lp[k] = 1
@param2 = (lp) -> lp.x = 1
@efface = (s, k) ->
  lu = $$cprefs[s]
  delete lu[k]
@methode = (s) ->
  lm = $$cprefs.l[s]
  lm.push(1)
@methode2 = ->
  lm = $$cprefs.l
  lm.length
@legit = (s) ->
  lu = $$cprefs[s]
  lu.b = 5
</script>

<p class="vue">{$$cprefs.a.b}</p>
`

async function construire(prefixe: string, prod: boolean): Promise<string> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'nom-civet.mjs'), CIVET)
  writeFileSync(join(srcDir, 'nom-coffee.mjs'), COFFEE)
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
  const erreurs: string[] = []
  window.eval(prod ? code : `${code}\nglobalThis.µ = µ;`)
  if (!prod) window.µ.warn = (m: string) => avis.push(String(m))
  const err = window.console.error
  window.console.error = (...a: any[]) => { erreurs.push(a.map(String).join(' ')); return err }
  window.document.body.innerHTML = '<mjs-nom-civet></mjs-nom-civet><mjs-nom-coffee></mjs-nom-coffee>'
  const civet  = window.document.querySelector('mjs-nom-civet')
  const coffee = window.document.querySelector('mjs-nom-coffee')
  const vue    = (c: any) => c._shadow?.querySelector('.vue')?.textContent
  const fin    = Date.now() + 3000
  while (!(vue(civet) !== undefined && vue(coffee) !== undefined) && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
  return { window, civet, coffee, avis, erreurs, vue }
}

// formes jouées : nom, appel ; `__proto__` mène à `Object.prototype`, `Map.prototype` par `getPrototypeOf`,
// `Array.prototype` par `$$prefs.l[s]`
const FORMES: [string, (c: any) => any][] = [
  ['lu1', (c) => c.lu1('__proto__', 'polluK')], ['lu2', (c) => c.lu2('__proto__', 'polluK')],
  ['pr1', (c) => c.pr1('polluK')], ['pr2', (c) => c.pr2('polluK')],
  ['boucle', (c) => c.boucle('__proto__', 'polluK')], ['reaffecte', (c) => c.reaffecte('__proto__', 'polluK')],
  ['param1', (c) => c.param1('__proto__', 'polluK')], ['efface', (c) => c.efface('__proto__', 'polluD')],
  ['methode', (c) => c.methode('__proto__')],
]
const TEMOINS = ['Object.prototype', 'Map.prototype', 'Array.prototype']

// prototypes touchés (`polluK` écrit, `polluD` effacé, `Array.prototype` rempli), puis remis
function pollution(W: any): string[] {
  const vus = [...W.eval(`[${TEMOINS.map((t) => `(Object.prototype.hasOwnProperty.call(${t}, 'polluK') ? '${t}.polluK ' : '') + (Object.prototype.hasOwnProperty.call(${t}, 'polluD') ? '' : '${t}.polluD effacé')`).join(', ')}, Array.prototype.length ? 'Array.prototype[0]' : ''].map((x) => x.trim()).filter(Boolean)`)]
  W.eval(`${TEMOINS.map((t) => `delete ${t}.polluK`).join(';')}; Array.prototype.length = 0`)
  return vus
}

describe('magasin $$ : une variable qui garde un objet du magasin refuse le prototype, même son nom repris ailleurs', function () {
  this.timeout(240000)
  const codes: Record<string, string> = {}

  before(async function () {
    this.timeout(240000)
    codes.dev  = await construire('nom-repris', false)
    codes.prod = await construire('nom-repris-prod', true)
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const mode of ['dev', 'prod']) {
    const nom  = mode === 'dev' ? 'développement' : 'production'
    const prod = mode === 'prod'

    it(`${nom} : nom repris dans deux fonctions, dans une boucle, réaffecté, paramètre ailleurs, delete, méthode — aucun prototype n'est touché, Civet et CoffeeScript`, async () => {
      const m = await monter(codes[mode], prod)
      try {
        const ecarts: string[] = []
        for (const [langue, c] of [['Civet', m.civet], ['CoffeeScript', m.coffee]] as [string, any][]) {
          for (const [forme, f] of FORMES) {
            m.window.eval(TEMOINS.map((t) => `Object.defineProperty(${t}, 'polluD', { value: 1, configurable: true, writable: true })`).join(';'))
            m.avis.length = 0
            let erreur = ''
            try {
              f(c)
            }
            catch (e: any) {
              erreur = `${e.name}: ${e.message}`
            }
            const p = pollution(m.window)
            if (p.length || erreur) ecarts.push(`${langue} ${forme} : ${JSON.stringify(p)} ${erreur}`)
            if (!prod && !(m.avis.length >= 1 && m.avis.every((a) => a.includes('segment « __proto__ »')))) ecarts.push(`${langue} ${forme} : avertissements ${JSON.stringify(m.avis)}`)
          }
        }
        assert.deepEqual(ecarts, [])
      }
      finally {
        m.window.close()
      }
    })

    it(`${nom} : une écriture permise par ce nom va à l'objet du magasin et redessine la vue`, async () => {
      const m = await monter(codes[mode], prod)
      try {
        m.civet.legit('a')
        m.coffee.legit('a')
        await new Promise((r) => setTimeout(r, 40))
        assert.equal(m.vue(m.civet), '5')
        assert.equal(m.vue(m.coffee), '5')
        if (!prod) assert.deepEqual(m.avis, [])
      }
      finally {
        m.window.close()
      }
    })
  }
})
