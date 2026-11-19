// `Object.defineProperty` compare chaque attribut donné à l'ancien comme JavaScript l'écrit (`Object.is`) : `-0` défini sur
// `0` change la donnée, c'est une écriture — l'écran suit, la valeur précise qui la lit se refait, et le développement ne dit
// pas qu'elle a été changée hors de MJS ; `NaN` défini sur `NaN` ne change rien : écran gardé, autant de rendus que
// l'affectation à valeur égale. Précision (défaut) et horloge, développement et production ; happy-dom

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

// un composant par cas : `@agir` fait la définition, `@plus` écrit ailleurs, `@vu` compte les rendus du paragraphe ;
// écran = `$t`, `1 / $o.x` (où `-0` se voit) et la valeur précise `$z`
const DP = (decl: string, act: string) => `<script>
$t = 0
${decl}
$z = [$o.x].map((v) -> 1 / v).join('')
@vu = -> window.__seenMark = (window.__seenMark or 0) + 1
@agir = -> ${act}
@plus = -> $t++
</script>
<p class="v">{$t + ':' + (1 / $o.x) + ':' + $z + (@vu() && '')}</p>
`

const DEF = (v: string) => "Object.defineProperty($o, 'x', { value: " + v + ', writable: true, enumerable: true, configurable: true })'

// nom : [déclaration, action]
const CAS: Record<string, [string, string]> = {
  'dz-zero': ['$o = { x: 0, a: 1 }', DEF('-0')],
  'dz-nan': ['$o = { x: NaN, a: 1 }', DEF('NaN')],
  'dz-aff': ['$o = { x: NaN, a: 1 }', '$o.a = 1']
}

// avertissements de la page, relevés sans être affichés
const RELEVE = "window.__W = []; console.warn = function () { window.__W.push(Array.prototype.map.call(arguments, String).join(' ')) };"

const SCENARIO = `(async () => {
  const R = {}
  const pause = (ms) => new Promise((r) => setTimeout(r, ms))
  const txt = (e) => (((e._shadow || e.shadowRoot)?.querySelector('p.v'))?.textContent || '').trim()
  for (const nom of ${JSON.stringify(Object.keys(CAS))}) {
    window.__seenMark = 0
    window.__W  = []
    const e = document.createElement('mjs-' + nom)
    document.body.appendChild(e)
    await pause(200)
    const montage = txt(e), n = window.__seenMark
    e.agir()
    await pause(200)
    const geste = txt(e), rendus = window.__seenMark - n
    e.plus()
    await pause(200)
    R[nom] = { ecrans: [montage, geste, txt(e)], rendus, avis: window.__W.filter((w) => w.includes('$z')) }
    e.remove()
  }
  return JSON.stringify(R)
})()`

async function construire(prod: boolean, precise: boolean): Promise<string> {
  const root   = mjsTmp('definition-moins-zero')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, [decl, act]] of Object.entries(CAS)) writeFileSync(join(srcDir, nom + '.mjs'), DP(decl, act))
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
const releves = new Map<string, Promise<Record<string, { ecrans: string[], rendus: number, avis: string[] }>>>()

function relever(prod: boolean, precise: boolean) {
  const cle = (prod ? 'prod' : 'dev') + (precise ? ':precise' : ':clock')
  let r = releves.get(cle)
  if (!r) {
    r = (async () => {
      const code     = await construire(prod, precise)
      const win: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
      try {
        win.eval(RELEVE)
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

describe('`Object.defineProperty` compare comme JavaScript écrit (`Object.is`) : `-0` sur `0` est une écriture, `NaN` sur `NaN` ne change rien', function () {
  this.timeout(240000)
  after(async () => { await terminateSharedWorkerPool() })
  for (const precise of [true, false]) {
    for (const prod of [false, true]) {
      const mode = (precise ? 'précision (défaut)' : 'horloge') + ', ' + (prod ? 'production' : 'développement')
      it(mode + ' : `-0` défini sur `0` — l\'écran suit, la valeur précise se refait, aucun avertissement', async () => {
        const r = (await relever(prod, precise))['dz-zero']
        assert.deepEqual(r.ecrans, ['0:Infinity:Infinity', '0:-Infinity:-Infinity', '1:-Infinity:-Infinity'], 'montage, définition, écriture suivante ' + JSON.stringify(r))
        assert.deepEqual(r.avis, [], 'avertissement à tort')
      })
      it(mode + ' : `NaN` défini sur `NaN` — écran gardé, rendus de l\'affectation à valeur égale', async () => {
        const r      = await relever(prod, precise)
        const temoin = r['dz-aff']
        assert.deepEqual(temoin.ecrans, ['0:NaN:NaN', '0:NaN:NaN', '1:NaN:NaN'], 'affectation à valeur égale ' + JSON.stringify(temoin))
        assert.deepEqual([r['dz-nan'].ecrans, r['dz-nan'].rendus, r['dz-nan'].avis], [temoin.ecrans, temoin.rendus, []], 'affectation à valeur égale : ' + temoin.rendus + ' rendus ; ' + JSON.stringify(r['dz-nan']))
      })
    }
  }
})
