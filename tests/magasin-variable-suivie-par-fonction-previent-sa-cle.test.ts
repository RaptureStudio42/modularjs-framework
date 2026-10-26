// magasin `$$` : une variable suit la clé qu'elle lit dans SA fonction. CoffeeScript lit la liste d'une boucle par une
// variable qu'il nomme lui-même (`ref`) et qu'il déclare dans chaque fonction : deux boucles sur deux stores, dans deux
// fonctions (`for u in $$liste`, `for c in $$autre`), ou un `?.` sur un troisième store ailleurs, préviennent chacune
// leur clé et redessinent leur vue. De même un nom déclaré dans deux fonctions sur deux stores (Civet `x := $$liste[0]`,
// `x := $$autre[0]`). Rien n'est perdu de la garde : l'écriture par un `'__proto__'` reste refusée, comme celle d'un
// paramètre du même nom ; une seule variable qui lit deux clés (déclarée hors des fonctions, affectée dans chacune) ne
// prévient rien. Développement et production

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const COFFEE = `<script lang="coffee">
$$fliste = [{ id: 1, fait: false }]
$$fautre = [{ id: 2, vu: false }]
$$fcarte = new Map([['a', { n: 1 }]])
@opt = (k) -> $$fcarte.get(k)?.n = 9
@un = ->
  for u in $$fliste
    u.fait = true
  return
@deux = ->
  for c in $$fautre
    c.vu = true
  return
@proto = (s, k) ->
  for u in $$fliste
    u[s][k] = 1
  return
</script>

<p class="liste">{JSON.stringify($$fliste)}</p>
<p class="autre">{JSON.stringify($$fautre)}</p>
`

const CIVET = `<script>
  $$cliste = [{ id: 1, fait: false }]
  $$cautre = [{ id: 2, vu: false }]
  y .= null
  @un = ->
    x := $$cliste[0]
    x.fait = true
    return
  @deux = ->
    x := $$cautre[0]
    x.vu = true
    return
  @proto = (s, k) ->
    x := $$cautre[0]
    x[s][k] = 1
    return
  @parametre = (x, k) ->
    x[k] = 1
    return
  @partage1 = ->
    y = $$cliste[0]
    y.n = 1
    return
  @partage2 = ->
    y = $$cautre[0]
    y.n = 1
    return
</script>

<p class="liste">{JSON.stringify($$cliste)}</p>
<p class="autre">{JSON.stringify($$cautre)}</p>
`

// langue, balise, clé de la première liste, clé de la seconde
const LANGUES: [string, string, string, string][] = [
  ['CoffeeScript', 'mjs-portee-coffee', 'fliste', 'fautre'],
  ['Civet', 'mjs-portee-civet', 'cliste', 'cautre'],
]

async function construire(prefixe: string, prod: boolean): Promise<string> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'portee-coffee.mjs'), COFFEE)
  writeFileSync(join(srcDir, 'portee-civet.mjs'), CIVET)
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
  const vue = (b: string, c: string) => q(b)._shadow?.querySelector(c)?.textContent
  const fin = Date.now() + 3000
  while (!LANGUES.every(([, b]) => vue(b, '.liste') !== undefined) && Date.now() < fin) await pause(10)
  await pause(60)
  return { window, q, vue, avis }
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

describe('magasin $$ : une variable suit la clé qu\'elle lit dans sa fonction', function () {
  this.timeout(240000)
  const codes: Record<string, string> = {}

  before(async function () {
    this.timeout(240000)
    codes.dev  = await construire('portee', false)
    codes.prod = await construire('portee-prod', true)
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('dev : chaque boucle, chaque variable prévient la clé qu\'elle lit ; une variable partagée sur deux clés, aucune', async () => {
    const { window, q } = await monter(codes.dev, false)
    try {
      for (const [langue, balise, a, b] of LANGUES) {
        assert.deepEqual(prevenues(window, () => q(balise).un()), [a], `${langue} un`)
        assert.deepEqual(prevenues(window, () => q(balise).deux()), [b], `${langue} deux`)
      }
      assert.deepEqual(prevenues(window, () => q('mjs-portee-civet').partage1()), [], 'Civet partage1')
      assert.deepEqual(prevenues(window, () => q('mjs-portee-civet').partage2()), [], 'Civet partage2')
    }
    finally {
      window.close()
    }
  })

  for (const mode of ['dev', 'prod']) {
    it(`${mode} : les deux vues se mettent à jour, et la garde refuse toujours le prototype`, async () => {
      const prod = mode === 'prod'
      const { window, q, vue, avis } = await monter(codes[mode], prod)
      try {
        for (const [langue, balise] of LANGUES) {
          q(balise).un()
          q(balise).deux()
          await pause(60)
          assert.equal(vue(balise, '.liste'), '[{"id":1,"fait":true}]', `${langue} : vue de la première liste`)
          assert.equal(vue(balise, '.autre'), '[{"id":2,"vu":true}]', `${langue} : vue de la seconde liste`)
          const n = avis.length
          q(balise).proto('__proto__', `pollu_${langue}`)
          assert.equal(window.eval(`Object.prototype.hasOwnProperty('pollu_${langue}')`), false, `${langue} : Object.prototype pollué`)
          if (!prod) assert.ok(avis.length > n, `${langue} : aucun avertissement`)
        }
        q('mjs-portee-civet').parametre(window.Object.prototype, 'pollu_parametre')
        assert.equal(window.eval(`Object.prototype.hasOwnProperty('pollu_parametre')`), false, 'paramètre du même nom : Object.prototype pollué')
      }
      finally {
        window.eval(`for (const p of Object.getOwnPropertyNames(Object.prototype)) if (p.startsWith('pollu_')) delete Object.prototype[p]`)
        window.close()
      }
    })
  }
})
