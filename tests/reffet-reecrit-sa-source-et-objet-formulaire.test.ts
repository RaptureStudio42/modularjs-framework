// Les reffets d'un composant suivent leurs vraies lectures (graphe des signaux) : deux règles qui en découlent, jouées dans happy-dom,
// en développement et en production. 1) Un `µeffect` qui lit `$x` puis écrit `µrefresh($x)` passe une fois, sans
// boucle ni avertissement, comme `$x = $x` en 3.1.0, qui ne faisait rien ; une vraie écriture qu'il fait de sa source le relance
// comme avant, réécriture ou non derrière elle. De même quand il lit une valeur dérivée de `$x` qui rend un objet neuf à chaque
// calcul (`[$n, $n * 2]`, `$x.filter(…)`) : la dérivée se refait, le reffet ne repart pas. 2) Un `µeffect` qui lit l'objet
// formulaire (`$form.valid`) repart à chaque changement de l'objet (départ des champs, écriture d'une variable typée), comme un
// `µeffect` qui lit une variable écrite ; un `µeffect` qui lit une variable repart quand `$form.reset()` lui rend une valeur de
// départ que sa règle refuse, comme quand il lui rend une valeur acceptée

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const SOURCES: Record<string, string> = {
  // `µrefresh($x)` et `µrefresh($m)` écrits par l'effet qui les lit ; `$c` et `$d` : une vraie écriture de sa source, la seconde suivie
  // d'une réécriture
  'rss-lit-ecrit.mjs': `<script>
$x = [1, 2]
$m = {n: 1}
$c = 0
$d = 0
µeffect ->
  window.__rx = (window.__rx or 0) + 1
  window.__rxL = $x.length
  µrefresh($x)
µeffect ->
  window.__rm = (window.__rm or 0) + 1
  window.__rmN = $m.n
  µrefresh($m)
µeffect ->
  window.__rc = (window.__rc or 0) + 1
  $c += 1 if $c < 3
µeffect ->
  window.__rd = (window.__rd or 0) + 1
  $d += 1 if $d < 3
  µrefresh($d)
@pousse = -> $x.push(3)
</script>
<p class="f">{$x.length + '|' + $m.n + '|' + $c + '|' + $d}</p>
`,
  // l'effet lit une dérivée qui rend un objet neuf (d'une variable simple, d'une liste), puis réécrit sa source
  'rss-der-simple.mjs': `<script>
$n = 1
$f = [$n, $n * 2]
µeffect ->
  window.__rds = (window.__rds or 0) + 1
  window.__rdsV = $f[1]
  µrefresh($n)
@inc = -> $n += 1
</script>
<p class="f">{$n}</p>
`,
  'rss-der-liste.mjs': `<script>
$x = [1, 2]
$g = $x.filter((v) -> v > 0)
µeffect ->
  window.__rdl = (window.__rdl or 0) + 1
  window.__rdlV = $g.length
  µrefresh($x)
@pousse = -> $x.push(3)
</script>
<p class="f">{$x.length + '|' + $g.length}</p>
`,
  // remise à zéro : `$nick` reprend sa valeur de départ, que la règle refuse (pseudo obligatoire encore vide)
  'rss-remise.mjs': `<vars>
  $nick string 3..20
</vars>

<script>
  $form = µform(this)
  µeffect ->
    window.__rr = (window.__rr or 0) + 1
    window.__rrV = JSON.stringify($nick)
  @ecrire = -> $nick = 'abcd'
  @remettre = -> $form.reset()
</script>

<p class="f">{$form.valid}</p>
`,
  // l'effet lit la validité de l'objet formulaire ; sans saisie, la valeur du champ est la variable
  'rss-form.mjs': `<vars>
  $q string 3..10
</vars>

<script>
  $q    = 'okok'
  $form = µform(this)
  µeffect ->
    window.__fv = (window.__fv or 0) + 1
    window.__fvV = $form.valid
  @ecrire = (v) -> $q = v
</script>

<p class="f">{$form.valid}</p>
`
}

const SCENARIO = `(async () => {
  const pause = (ms = 30) => new Promise((r) => setTimeout(r, ms))
  const W = []
  const ow = console.warn
  console.warn = (...a) => { W.push(a.map(String).join(' ').slice(0, 100)); return ow.apply(console, a) }
  const neuf = async (tag) => { const el = document.createElement(tag); document.body.appendChild(el); const fin = Date.now() + 4000; while (!el._shadow?.querySelector('.f') && Date.now() < fin) await pause(10); await pause(200); return el }
  const n = (...k) => k.map((x) => window[x] || 0).join('/')
  const R = {}
  const a = await neuf('mjs-rss-lit-ecrit')
  const s = [n('__rx', '__rm', '__rc', '__rd')]
  a.pousse(); await pause(200); s.push(n('__rx', '__rm', '__rc', '__rd'))
  R.litEtEcrit = s.join(' → ') + ' | écran ' + a._shadow.querySelector('.f').textContent + ' | lu ' + window.__rxL + ',' + window.__rmN
  const f = await neuf('mjs-rss-form')
  const t = [n('__fv') + ' ' + window.__fvV]
  f.ecrire('abcd'); await pause(200); t.push(n('__fv') + ' ' + window.__fvV)
  f.ecrire('efgh'); await pause(200); t.push(n('__fv') + ' ' + window.__fvV)
  R.formulaire = t.join(' → ')
  const g = await neuf('mjs-rss-der-simple')
  const u = [n('__rds')]
  g.inc(); await pause(200); u.push(n('__rds'))
  R.deriveeSimple = u.join(' → ') + ' | lu ' + window.__rdsV
  const h = await neuf('mjs-rss-der-liste')
  const v = [n('__rdl')]
  h.pousse(); await pause(200); v.push(n('__rdl'))
  R.deriveeListe = v.join(' → ') + ' | lu ' + window.__rdlV
  const r = await neuf('mjs-rss-remise')
  const w = [n('__rr') + ' ' + window.__rrV]
  r.ecrire(); await pause(200); w.push(n('__rr') + ' ' + window.__rrV)
  r.remettre(); await pause(200); w.push(n('__rr') + ' ' + window.__rrV)
  R.remiseAZero = w.join(' → ')
  console.warn = ow
  R.avertissements = W.length + (W.length ? ' ' + W[0] : '')
  return R
})()`

const ATTENDU = {
  // montage : un passage chacun ; `$c` et `$d` repartent sur leur propre écriture jusqu'à 3 (quatre passages chacun) ; la poussée
  // d'un gestionnaire relance le lecteur de `$x`
  litEtEcrit: '1/1/4/4 → 2/1/4/4 | écran 3|1|3|3 | lu 3,1',
  // le montage, puis le départ des champs ; puis chaque écriture de `$q`
  formulaire: '2 true → 3 true → 4 true',
  // un passage au montage, un à la vraie écriture, comme en 3.1.0
  deriveeSimple: '1 → 2 | lu 4',
  deriveeListe: '1 → 2 | lu 3',
  // le montage, l'écriture, la remise à zéro
  remiseAZero: '1 undefined → 2 "abcd" → 3 undefined',
  avertissements: '0'
}

async function construire(prod: boolean): Promise<string> {
  const root   = mjsTmp('rss')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, src] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), src)
  const opts: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js') }
  if (prod) Object.assign(opts, { urlPrefix: '/out', env: 'prod', js: 'bundle' })
  const bundler = new Bundler(opts)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [])
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
  return prod
    ? readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
    : ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
}

describe('un reffet qui réécrit sa source passe une fois ; un reffet qui lit l\'objet formulaire suit ses changements', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of [false, true]) {
    it(prod ? 'production' : 'développement', async () => {
      const code   = await construire(prod)
      const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
      window.eval(code)
      const r = await window.eval(SCENARIO)
      await window.happyDOM.close()
      assert.deepEqual(JSON.parse(JSON.stringify(r)), ATTENDU)
    })
  }
})
