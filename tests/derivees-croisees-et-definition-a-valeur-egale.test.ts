// deux valeurs dérivées dont chacune rafraîchit (`µrefresh`) une source de l'autre se refont l'une l'autre jusqu'au détecteur
// de boucle : en développement, un avertissement (une fois par composant) nomme `µrefresh` et la valeur dérivée ; rien en
// production ; une seule valeur dérivée qui l'appelle ne boucle pas et n'est pas avertie. `Object.defineProperty` sur une
// variable suivie, appelé par une fonction que lit le gabarit, à valeur égale : autant d'appels que l'affectation équivalente
// (`$s.tag = 'x'`), aucune boucle. Précision (défaut) et horloge, développement et production ; happy-dom

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const SOURCES: Record<string, string> = {
  'dc-deux.mjs': `<script>
c1 = -> window.__c1 = (window.__c1 or 0) + 1
$x = { n: 1 }
$y = { n: 2 }
$a = (µrefresh($y) or '') + $x.n + c1() * 0
$b = (µrefresh($x) or '') + $y.n
</script>
<p class="d">{$a} {$b}</p>
`,
  'dc-une.mjs': `<script>
c2 = -> window.__c2 = (window.__c2 or 0) + 1
$x = { n: 1 }
$y = { n: 2 }
$a = (µrefresh($y) or '') + $x.n + c2() * 0
@plus = -> $x.n++
</script>
<p class="d">{$a} {$y.n}</p>
`,
  'dp-def.mjs': `<script>
$s = { n: 1 }
@g = ->
  window.__dp = (window.__dp or 0) + 1
  Object.defineProperty($s, 'tag', { value: 'x', configurable: true, writable: true, enumerable: false })
  ''
</script>
<p class="g">{@g() + $s.n}</p>
`,
  'dp-set.mjs': `<script>
$s = { n: 1 }
@g = ->
  window.__st = (window.__st or 0) + 1
  $s.tag = 'x'
  ''
</script>
<p class="g">{@g() + $s.n}</p>
`
}

const RELEVE = "window.__W = []; (function () { var w = console.warn; console.warn = function () { window.__W.push(Array.prototype.map.call(arguments, String).join(' ')); return w.apply(console, arguments) } })();"

const SCENARIO = `(async () => {
  const R = {}
  const pause = (ms) => new Promise((r) => setTimeout(r, ms))
  const stable = async (k) => { let n = -1; while (n !== window[k]) { n = window[k]; await pause(200) } return window[k] || 0 }
  const neuf = async (tag) => { const e = document.createElement(tag); document.body.appendChild(e); await pause(300); return e }
  const txt = (e) => (e._shadow?.querySelector('p')?.textContent || '').trim()
  const avis = () => window.__W.filter((w) => w.includes('µrefresh'))
  window.__W = []
  let e = await neuf('mjs-dc-deux')
  R.deux = { calculs: await stable('__c1'), ecran: txt(e), avis: avis() }
  e.remove()
  window.__W = []
  e = await neuf('mjs-dc-une')
  await stable('__c2')
  e.plus()
  await pause(300)
  R.une = { calculs: await stable('__c2'), ecran: txt(e), avis: avis() }
  e.remove()
  e = await neuf('mjs-dp-def')
  R.def = await stable('__dp')
  e.remove()
  e = await neuf('mjs-dp-set')
  R.set = await stable('__st')
  e.remove()
  return JSON.stringify(R)
})()`

async function construire(prod: boolean, precise: boolean): Promise<string> {
  const root   = mjsTmp('derivees-croisees')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, src] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), src)
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

describe('deux valeurs dérivées qui se rafraîchissent l\'une l\'autre (avertissement de développement) et `defineProperty` à valeur égale', function () {
  this.timeout(240000)
  after(async () => { await terminateSharedWorkerPool() })
  for (const precise of [true, false]) {
    for (const prod of [false, true]) {
      it((precise ? 'précision (défaut)' : 'horloge') + ', ' + (prod ? 'production' : 'développement'), async () => {
        const code   = await construire(prod, precise)
        const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
        try {
          window.eval(RELEVE)
          window.eval(code)
          const r = JSON.parse(await window.eval(SCENARIO))
          assert.equal(r.deux.ecran, '10 2', JSON.stringify(r.deux))
          if (prod) assert.deepEqual(r.deux.avis, [], 'production : aucun avertissement ' + JSON.stringify(r.deux))
          else {
            assert.equal(r.deux.avis.length, 1, 'développement : un avertissement ' + JSON.stringify(r.deux))
            assert.match(r.deux.avis[0], /µrefresh\(\$[xy]\)/)
            assert.match(r.deux.avis[0], /\$[ab]\b/)
            assert.match(r.deux.avis[0], /<dc-deux>|mjs-dc-deux/)
          }
          assert.deepEqual(r.une, { calculs: 2, ecran: '20 2', avis: [] })
          assert.ok(r.set <= 2, 'affectation : ' + r.set + ' appels')
          assert.equal(r.def, r.set, 'defineProperty à valeur égale : autant d\'appels que l\'affectation')
        }
        finally {
          await window.happyDOM.close()
        }
      })
    }
  }
})
