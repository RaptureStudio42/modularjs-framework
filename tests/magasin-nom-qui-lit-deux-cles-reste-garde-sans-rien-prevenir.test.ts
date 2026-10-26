// magasin `$$` : une variable qui lit deux clés différentes du magasin reste gardée, mais ne prévient aucune clé — ici
// une variable déclarée hors des fonctions, que deux fonctions affectent sur deux clés (Civet `x .= null`, puis
// `x = $$carte.get(k)` et `x = $$liste[0]` ; CoffeeScript de même, dans une boucle `for u in $$liste`). L'écriture par
// cette variable va à l'objet, refuse un prototype, et ne relance ni les lecteurs ni le reffet de l'autre clé — ni
// ceux d'une clé qui tient `undefined`. Une variable qui ne lit qu'une clé, même si son nom est repris dans deux
// fonctions, prévient toujours cette clé. Développement et production

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const CIVET = `<script>
  $$cliste = [{ id: 1, fait: false, vu: false, n: 0 }]
  $$ccarte = new Map([['a', { n: 1 }]])
  $$csel = { id: 1 }
  µeffect ->
    window.toursCivet = (window.toursCivet ?? 0) + $$ccarte.size
    return
  x .= null
  @lit = (k) ->
    x = $$ccarte.get(k)
    x.n = 2
  @ecrit = ->
    x = $$cliste[0]
    x.fait = true
  @proto = (k) ->
    x = $$cliste[0]
    x[k].pollueK = 1
  @une = ->
    y := $$cliste[0]
    y.vu = true
  @une2 = ->
    y := $$cliste.find((t) -> t.id == 1)
    y.n = 3
  @vider = -> $$csel = undefined
  @luFait = -> $$cliste[0].fait
</script>

<p class="liste">{JSON.stringify($$cliste)}</p>
<p class="carte">{$$ccarte.get('a').n}</p>
`

const COFFEE = `<script lang="coffee">
$$fliste = [{ id: 1, fait: false, vu: false, n: 0 }]
$$fcarte = new Map([['a', { n: 1 }]])
$$fsel = { id: 1 }
µeffect ->
  window.toursCoffee = (window.toursCoffee or 0) + $$fcarte.size
  return
x = null
@opt = (k) ->
  x = $$fcarte.get(k)
  x.n = 9
  return
@boucle = ->
  for u in $$fliste
    x = u
    x.fait = true
  return
@proto = (k) ->
  for u in $$fliste
    x = u
    x[k].pollueK = 1
  return
@une = ->
  y = $$fliste[0]
  y.vu = true
  return
@une2 = ->
  y = $$fliste.find((t) -> t.id == 1)
  y.n = 3
  return
@vider = -> $$fsel = undefined
@luFait = -> $$fliste[0].fait
</script>

<p class="liste">{JSON.stringify($$fliste)}</p>
<p class="carte">{$$fcarte.get('a').n}</p>
`

async function construire(prefixe: string, prod: boolean): Promise<string> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'deux-cles-civet.mjs'), CIVET)
  writeFileSync(join(srcDir, 'deux-cles-coffee.mjs'), COFFEE)
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
  window.document.body.innerHTML = '<mjs-deux-cles-civet></mjs-deux-cles-civet><mjs-deux-cles-coffee></mjs-deux-cles-coffee>'
  const civet  = window.document.querySelector('mjs-deux-cles-civet')
  const coffee = window.document.querySelector('mjs-deux-cles-coffee')
  const vue    = (c: any) => c._shadow?.querySelector('.liste')?.textContent
  const fin    = Date.now() + 3000
  while (!(vue(civet) !== undefined && vue(coffee) !== undefined) && Date.now() < fin) await pause(10)
  await pause(60)
  return { window, civet, coffee, avis, vue }
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

// langue, élément, compteur du reffet, écriture par le nom qui lit deux clés, clé de la liste
const LANGUES: [string, (m: any) => any, string, string, string][] = [
  ['Civet', (m) => m.civet, 'toursCivet', 'ecrit', 'cliste'],
  ['CoffeeScript', (m) => m.coffee, 'toursCoffee', 'boucle', 'fliste'],
]

describe('magasin $$ : un nom qui lit deux clés différentes reste gardé, sans rien prévenir', function () {
  this.timeout(240000)
  const codes: Record<string, string> = {}

  before(async function () {
    this.timeout(240000)
    codes.dev  = await construire('deux-cles', false)
    codes.prod = await construire('deux-cles-prod', true)
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const mode of ['dev', 'prod']) {
    const nom  = mode === 'dev' ? 'développement' : 'production'
    const prod = mode === 'prod'

    for (const [langue, el, tours, ecrit, cle] of LANGUES) {
      it(`${nom}, ${langue} : l'écriture va à l'objet, aucune clé prévenue, le reffet de l'autre clé ne repart pas`, async () => {
        const m = await monter(codes[mode], prod)
        try {
          const c     = el(m)
          const avant = m.window[tours]
          assert.ok(avant >= 1, 'le reffet est passé au montage')
          c.vider()
          if (prod) c[ecrit]()
          else assert.deepEqual(prevenues(m.window, () => c[ecrit]()), [], 'ni la clé de l\'autre lecture, ni une clé qui tient undefined')
          assert.equal(c.luFait(), true, 'l\'écriture va à l\'objet de la liste')
          await pause(80)
          assert.equal(m.window[tours], avant, 'le reffet qui lit l\'autre clé ne repart pas')
          if (!prod) assert.deepEqual(m.avis, [])
        }
        finally {
          m.window.close()
        }
      })

      it(`${nom}, ${langue} : l'écriture de ce nom dans un prototype est refusée`, async () => {
        const m = await monter(codes[mode], prod)
        try {
          el(m).proto('__proto__')
          assert.equal(m.window.eval('Object.prototype.hasOwnProperty("pollueK")'), false)
          if (!prod) assert.ok(m.avis.length >= 1 && m.avis.every((a: string) => a.includes('segment « __proto__ »')), JSON.stringify(m.avis))
        }
        finally {
          m.window.eval('delete Object.prototype.pollueK')
          m.window.close()
        }
      })

      it(`${nom}, ${langue} : un nom qui ne lit qu'une clé, repris dans deux fonctions, prévient cette clé et redessine la vue`, async () => {
        const m = await monter(codes[mode], prod)
        try {
          const c = el(m)
          if (prod) {
            c.une()
            c.une2()
          }
          else {
            assert.deepEqual(prevenues(m.window, () => c.une()), [cle])
            assert.deepEqual(prevenues(m.window, () => c.une2()), [cle])
          }
          await pause(60)
          const e = JSON.parse(m.vue(c))[0]
          assert.equal(e.vu, true)
          assert.equal(e.n, 3)
        }
        finally {
          m.window.close()
        }
      })
    }
  }
})
