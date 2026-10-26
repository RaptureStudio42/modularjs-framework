// magasin `$$` : une variable dont la valeur lit deux clés différentes dans UNE expression (`z := $$carte.get(k) or
// $$liste[0]`, `??`, ternaire, expression `if`) reste gardée, mais ne prévient aucune clé, comme une variable affectée
// deux fois sur deux clés : son écriture va à l'objet, refuse un prototype, et ne relance pas le reffet qui lit la
// première clé. Une même expression sur une seule clé (`$$carte.get(k) or $$carte.get('a')`) la prévient toujours.
// Civet, CoffeeScript et JavaScript, développement et production

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const CIVET = `<script>
  $$carte = new Map([['a', { n: 1 }]])
  $$liste = [{ id: 1, fait: false, vu: false }]
  µeffect ->
    window.toursCivet = (window.toursCivet ?? 0) + $$carte.size
    return
  @ouDeux = ->
    z := $$carte.get('zz') or $$liste[0]
    z.fait = true
    return
  @nulDeux = ->
    z := $$carte.get('zz') ?? $$liste[0]
    z.vu = true
    return
  @siDeux = (c) ->
    w := if c then $$carte.get('a') else $$liste[0]
    w.fait = true
    return
  @proto = (s, k) ->
    z := $$carte.get(s) or $$liste[0][s]
    z[k] = 1
    return
  @uneCle = ->
    u := $$carte.get('zz') or $$carte.get('a')
    u.n = 2
    return
</script>

<p class="liste">{JSON.stringify($$liste)}</p>
`

const COFFEE = `<script lang="coffee">
$$fcarte = new Map([['a', { n: 1 }]])
$$fliste = [{ id: 1, fait: false, vu: false }]
µeffect ->
  window.toursCoffee = (window.toursCoffee or 0) + $$fcarte.size
  return
@ouDeux = ->
  z = $$fcarte.get('zz') or $$fliste[0]
  z.fait = true
  return
@nulDeux = ->
  z = $$fcarte.get('zz') ? $$fliste[0]
  z.vu = true
  return
@siDeux = (c) ->
  w = if c then $$fcarte.get('a') else $$fliste[0]
  w.fait = true
  return
@proto = (s, k) ->
  z = $$fcarte.get(s) or $$fliste[0][s]
  z[k] = 1
  return
@uneCle = ->
  u = $$fcarte.get('zz') or $$fcarte.get('a')
  u.n = 2
  return
</script>

<p class="liste">{JSON.stringify($$fliste)}</p>
`

const JS = `<script lang="js">
$$jcarte = new Map([['a', { n: 1 }]])
$$jliste = [{ id: 1, fait: false, vu: false }]
µeffect(() => { window.toursJs = (window.toursJs ?? 0) + $$jcarte.size })
@ouDeux = function() { const z = $$jcarte.get('zz') || $$jliste[0]; z.fait = true }
@nulDeux = function() { const z = $$jcarte.get('zz') ?? $$jliste[0]; z.vu = true }
@siDeux = function(c) { const w = c ? $$jcarte.get('a') : $$jliste[0]; w.fait = true }
@proto = function(s, k) { const z = $$jcarte.get(s) || $$jliste[0][s]; z[k] = 1 }
@uneCle = function() { const u = $$jcarte.get('zz') || $$jcarte.get('a'); u.n = 2 }
</script>

<p class="liste">{JSON.stringify($$jliste)}</p>
`

// langue, balise, compteur du reffet de la carte, clé de la carte
const LANGUES: [string, string, string, string][] = [
  ['Civet', 'mjs-deux-expr-civet', 'toursCivet', 'carte'],
  ['CoffeeScript', 'mjs-deux-expr-coffee', 'toursCoffee', 'fcarte'],
  ['JS', 'mjs-deux-expr-js', 'toursJs', 'jcarte'],
]

async function construire(prefixe: string, prod: boolean): Promise<string> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'deux-expr-civet.mjs'), CIVET)
  writeFileSync(join(srcDir, 'deux-expr-coffee.mjs'), COFFEE)
  writeFileSync(join(srcDir, 'deux-expr-js.mjs'), JS)
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

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function monter(code: string, prod: boolean) {
  const window: any = new Window({ url: 'http://localhost/' })
  const avis: string[] = []
  window.eval(prod ? code : `${code}\nglobalThis.µ = µ;`)
  if (!prod) window.µ.warn = (m: string) => avis.push(String(m))
  window.document.body.innerHTML = LANGUES.map(([, b]) => `<${b}></${b}>`).join('')
  const q   = (b: string) => window.document.querySelector(b)
  const vue = (b: string) => q(b)._shadow?.querySelector('.liste')?.textContent
  const fin = Date.now() + 3000
  while (!LANGUES.every(([, b]) => vue(b) !== undefined) && Date.now() < fin) await pause(10)
  await pause(60)
  return { window, q, avis }
}

// clés du magasin prévenues pendant `faire` (espion posé sur l'aide qui prévient une clé)
function prevenues(window: any, faire: () => void): string[] {
  const vues: string[] = []
  const avant = window.µ._mjs_storeNotifyKey
  window.µ._mjs_storeNotifyKey = function (k: string) {
    vues.push(k)
    return avant.call(this, k)
  }
  try {
    faire()
  }
  finally {
    window.µ._mjs_storeNotifyKey = avant
  }
  return vues
}

describe('magasin $$ : une expression qui lit deux clés différentes ne prévient aucune clé', function () {
  this.timeout(240000)
  const codes: Record<string, string> = {}

  before(async function () {
    this.timeout(240000)
    codes.dev  = await construire('deux-expr', false)
    codes.prod = await construire('deux-expr-prod', true)
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('dev : `or`, `??`, ternaire et `if` sur deux clés ne préviennent rien ; une seule clé est prévenue', async () => {
    const { window, q } = await monter(codes.dev, false)
    try {
      for (const [langue, balise, , carte] of LANGUES) {
        const el = q(balise)
        assert.deepEqual(prevenues(window, () => el.ouDeux()), [], `${langue} or`)
        assert.deepEqual(prevenues(window, () => el.nulDeux()), [], `${langue} ??`)
        assert.deepEqual(prevenues(window, () => el.siDeux(false)), [], `${langue} ternaire`)
        assert.deepEqual(prevenues(window, () => el.uneCle()), [carte], `${langue} une seule clé`)
      }
    }
    finally {
      window.close()
    }
  })

  for (const mode of ['dev', 'prod']) {
    it(`${mode} : l'écriture va à l'objet sans relancer le reffet de la première clé, et refuse le prototype`, async () => {
      const prod = mode === 'prod'
      const { window, q, avis } = await monter(codes[mode], prod)
      try {
        for (const [langue, balise, tours] of LANGUES) {
          const el = q(balise)
          const t0 = window[tours]
          el.ouDeux()
          el.nulDeux()
          el.siDeux(false)
          await pause(60)
          assert.equal(window[tours] - t0, 0, `${langue} : reffet de la carte relancé`)
          const n = avis.length
          el.proto('__proto__', `pollu_${langue}`)
          assert.equal(window.eval(`Object.prototype.hasOwnProperty('pollu_${langue}')`), false, `${langue} : Object.prototype pollué`)
          if (!prod) assert.ok(avis.length > n, `${langue} : aucun avertissement`)
        }
        if (!prod) assert.equal(window.eval('JSON.stringify(µ.store.liste)'), '[{"id":1,"fait":true,"vu":true}]')
      }
      finally {
        window.eval(`for (const p of Object.getOwnPropertyNames(Object.prototype)) if (p.startsWith('pollu_')) delete Object.prototype[p]`)
        window.close()
      }
    })
  }
})
