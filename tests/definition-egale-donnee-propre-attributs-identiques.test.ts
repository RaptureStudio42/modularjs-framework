// `Object.defineProperty` sur une variable suivie ne refait rien seulement quand il ne change rien : la propriété est déjà une
// donnée propre de l'objet et chaque attribut donné (`value`, `writable`, `enumerable`, `configurable`) y est déjà le même.
// Une clé absente créée à `undefined`, `{ enumerable: false }`, `{ writable: false }` ou `{ configurable: false }` seuls, un
// indice au-delà de la longueur d'une liste sont des écritures : l'écran suit aussitôt. Une définition qui ne change rien
// (même valeur et mêmes attributs, aucune valeur et aucun attribut changé, aucun attribut donné) garde l'écran et refait
// autant de rendus que l'affectation à valeur égale. Précision (défaut) et horloge, développement et production ; happy-dom

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

// un composant par cas : `@agir` fait la définition, `@vu` compte les rendus du paragraphe
const DP = (decl: string, act: string, vue: string) => `<script>
${decl}
@vu = -> window.__vu = (window.__vu or 0) + 1
@agir = -> ${act}
</script>
<p class="v">{${vue} + (@vu() && '')}</p>
`

const OBJ   = '$o = { a: 1, b: 2 }'
const LISTE = '$l = [1, 2, 3]'
const CLES  = "Object.keys($o).join(',')"
const ATTR  = (nom: string) => "Object.getOwnPropertyDescriptor($o, 'a')." + nom

// nom : [déclaration, action, vue, écran avant, écran juste après]
const CAS: Record<string, [string, string, string, string, string]> = {
  'dp-cle': [OBJ, "Object.defineProperty($o, 'c', { value: undefined, writable: true, enumerable: true, configurable: true })", CLES, 'a,b', 'a,b,c'],
  'dp-cache': [OBJ, "Object.defineProperty($o, 'a', { enumerable: false })", CLES, 'a,b', 'b'],
  'dp-idx': [LISTE, 'Object.defineProperty($l, 3, { value: undefined, writable: true, enumerable: true, configurable: true })', '$l.length', '3', '4'],
  'dp-fige': [OBJ, "Object.defineProperty($o, 'a', { writable: false })", ATTR('writable'), 'true', 'false'],
  'dp-scelle': [OBJ, "Object.defineProperty($o, 'a', { configurable: false })", ATTR('configurable'), 'true', 'false'],
  'dp-meme': [OBJ, "Object.defineProperty($o, 'a', { value: 1, writable: true, enumerable: true, configurable: true })", CLES, 'a,b', 'a,b'],
  'dp-rien': [OBJ, "Object.defineProperty($o, 'a', { enumerable: true, configurable: true })", CLES, 'a,b', 'a,b'],
  'dp-vide': [OBJ, "Object.defineProperty($o, 'a', {})", CLES, 'a,b', 'a,b'],
  'dp-aff': [OBJ, '$o.a = 1', CLES, 'a,b', 'a,b']
}
const ECRITURES = ['dp-cle', 'dp-cache', 'dp-idx', 'dp-fige', 'dp-scelle']
const MUETS     = ['dp-meme', 'dp-rien', 'dp-vide']

const SCENARIO = `(async () => {
  const R = {}
  const pause = (ms) => new Promise((r) => setTimeout(r, ms))
  const txt = (e) => (((e._shadow || e.shadowRoot)?.querySelector('p.v'))?.textContent || '').trim()
  for (const nom of ${JSON.stringify(Object.keys(CAS))}) {
    window.__vu = 0
    const e = document.createElement('mjs-' + nom)
    document.body.appendChild(e)
    await pause(200)
    const avant = txt(e), n = window.__vu
    e.agir()
    await pause(200)
    R[nom] = { avant, apres: txt(e), rendus: window.__vu - n }
    e.remove()
  }
  return JSON.stringify(R)
})()`

async function construire(prod: boolean, precise: boolean): Promise<string> {
  const root   = mjsTmp('definition-egale')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, [decl, act, vue]] of Object.entries(CAS)) writeFileSync(join(srcDir, nom + '.mjs'), DP(decl, act, vue))
  const opts: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), derivedMode: precise ? 'precise' : 'clock' }
  if (prod) Object.assign(opts, { urlPrefix: '/out', env: 'prod', js: 'bundle' })
  const bundler = new Bundler(opts)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
  return prod
    ? readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
    : ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
}

// un relevé par configuration, partagé par ses deux tests
const releves = new Map<string, Promise<Record<string, { avant: string, apres: string, rendus: number }>>>()

function relever(prod: boolean, precise: boolean) {
  const cle = (prod ? 'prod' : 'dev') + (precise ? ':precise' : ':clock')
  let r = releves.get(cle)
  if (!r) {
    r = (async () => {
      const code     = await construire(prod, precise)
      const win: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
      try {
        win.eval(code)
        return JSON.parse(await win.eval(SCENARIO))
      }
      finally {
        await win.happyDOM.close()
      }
    })()
    releves.set(cle, r)
  }
  return r
}

describe('`Object.defineProperty` sur une variable suivie : ne refait rien seulement quand il ne change rien', function () {
  this.timeout(240000)
  after(async () => { await terminateSharedWorkerPool() })
  for (const precise of [true, false]) {
    for (const prod of [false, true]) {
      const mode = (precise ? 'précision (défaut)' : 'horloge') + ', ' + (prod ? 'production' : 'développement')
      it(mode + ' : clé créée à `undefined`, attribut changé seul, indice au-delà de la longueur — l\'écran suit', async () => {
        const r      = await relever(prod, precise)
        const fautes = ECRITURES.filter((nom) => r[nom].avant !== CAS[nom][3] || r[nom].apres !== CAS[nom][4]).map((nom) => nom + ' ' + JSON.stringify(r[nom]))
        assert.deepEqual(fautes, [], 'définitions qui changent la donnée, écran figé')
      })
      it(mode + ' : même valeur et mêmes attributs, ou aucun attribut changé — écran gardé, rendus de l\'affectation à valeur égale', async () => {
        const r      = await relever(prod, precise)
        const temoin = r['dp-aff']
        assert.deepEqual([temoin.avant, temoin.apres], ['a,b', 'a,b'], 'affectation à valeur égale ' + JSON.stringify(temoin))
        const fautes = MUETS.filter((nom) => r[nom].avant !== 'a,b' || r[nom].apres !== 'a,b' || r[nom].rendus !== temoin.rendus).map((nom) => nom + ' ' + JSON.stringify(r[nom]))
        assert.deepEqual(fautes, [], 'affectation à valeur égale : ' + temoin.rendus + ' rendus')
      })
    }
  }
})
