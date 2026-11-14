// le tatouage d'identité qu'une liste pose sur un objet sans clé `by` (`_mjsId`, qui retrouve sa ligne d'un rendu à l'autre)
// n'est pas une écriture de la variable : posé pendant le rendu, il ne redessine rien et ne change pas la liste sous la
// réconciliation, même si `Object.defineProperty` par l'enveloppe en est une. Démo de présence du tutoriel (`µevery`, `splice` et
// `push` tirés au hasard) à graines fixes : les graines 7 et 8 retirent un élément de la liste de départ au premier tour — la
// réconciliation plantait (ligne absente dans `_mjs_updRows`) et l'écran restait vide ; la graine 3 commence par un ajout. Un ajout
// = un rendu. Précision (défaut) et horloge, développement et production ; happy-dom

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const SOURCES: Record<string, string> = {
  'presence-demo.mjs': `
<script>
  $list = [{ name: 'Ana' }, { name: 'Bo' }, { name: 'Cid' }]
  _names = ['Deniz', 'Eli', 'Fab', 'Gus', 'Hana', 'Ivo', 'Jo', 'Kai']
  µevery 30, ->
    if $list.length > 4 or ($list.length > 1 and Math.random() < 0.45)
      $list.splice(Math.floor(Math.random() * $list.length), 1)
    else
      $list.push({ name: _names[Math.floor(Math.random() * _names.length)] })
</script>

<div class="room">
  <div class="tete"><span class="pastille"></span> {$list.length}</div>
  <ul>
    {for j in $list}
      <li>{j.name}</li>
    {end}
  </ul>
</div>

<style lang="css">
:host{display:block;padding:18px;font-family:system-ui,sans-serif;color:#c9d1d9}
.room{background:#0d1117;border:1px solid #30363d;border-radius:10px;padding:14px 16px;max-width:220px}
.tete{font-size:15px;font-weight:600;color:var(--MJS_MAIN_COLOR);margin-bottom:10px}
.pastille{display:inline-block;width:9px;height:9px;border-radius:50%;background:#3fb950;margin-right:6px;vertical-align:middle}
ul{list-style:none;margin:0;padding:0}
li{padding:4px 0;font-size:14px;border-top:1px solid #21262d}
li:first-child{border-top:none}
</style>
`,
  'liste-rendus.mjs': `<script>
$list = [{ n: 'a' }, { n: 'b' }]
@h = (n) ->
  window.__rendus = (window.__rendus or 0) + 1
  ''
@ajoute = -> $list.push({ n: 'c' })
</script>
<p class="r">{@h($list.length)}</p><ul>{for j in $list}<li>{j.n}</li>{end}</ul>
`
}

// erreurs relevées : console.error (plantage intercepté) et erreurs de la fenêtre
const RELEVE = "window.__E = []; (function () { var w = console.error; console.error = function () { window.__E.push(Array.prototype.map.call(arguments, function (a) { return a && a.message ? a.message : String(a) }).join(' ')); return w.apply(console, arguments) } })(); window.addEventListener('error', function (e) { window.__E.push(String(e.message)) });"

const SCENARIO = `(async () => {
  const R = {}
  const pause = (ms) => new Promise((r) => setTimeout(r, ms))
  const graine = (s) => { s >>>= 0; Math.random = function () { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
  const lignes = (e) => [...(e._shadow?.querySelectorAll('li') || [])].map((x) => x.textContent.trim())
  for (const s of [7, 8, 3]) {
    graine(s)
    window.__E = []
    const e = document.createElement('mjs-presence-demo')
    document.body.appendChild(e)
    await pause(420)
    R['graine ' + s] = { lignes: lignes(e), tete: (e._shadow?.querySelector('.tete')?.textContent || '').trim(), erreurs: window.__E.slice(0, 2) }
    e.remove()
  }
  window.__E = []
  const l = document.createElement('mjs-liste-rendus')
  document.body.appendChild(l)
  await pause(150)
  const r0 = window.__rendus
  l.ajoute()
  await pause(150)
  R.ajout = { rendus: window.__rendus - r0, lignes: lignes(l).join(','), erreurs: window.__E.slice(0, 2) }
  l.remove()
  return JSON.stringify(R)
})()`

async function construire(prod: boolean, precise: boolean): Promise<string> {
  const root   = mjsTmp('liste-tatouage')
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

describe('liste : le tatouage des lignes n\'est pas une écriture (démo de présence du tutoriel, graines fixes)', function () {
  this.timeout(240000)
  after(async () => { await terminateSharedWorkerPool() })
  for (const precise of [true, false]) {
    for (const prod of [false, true]) {
      it((precise ? 'précision (défaut)' : 'horloge') + ', ' + (prod ? 'production' : 'développement') + ' : aucun plantage, écran égal à la liste, un ajout = un rendu', async () => {
        const code   = await construire(prod, precise)
        const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
        try {
          window.eval(RELEVE)
          window.eval(code)
          const r = JSON.parse(await window.eval(SCENARIO))
          for (const s of [7, 8, 3]) {
            const g = r['graine ' + s]
            assert.deepEqual(g.erreurs, [], 'graine ' + s + ' : ' + JSON.stringify(g))
            assert.ok(g.lignes.length > 0, 'graine ' + s + ' : écran vide ' + JSON.stringify(g))
            assert.equal(String(g.lignes.length), g.tete, 'graine ' + s + ' : en-tête et lignes ' + JSON.stringify(g))
          }
          assert.deepEqual(r.ajout, { rendus: 1, lignes: 'a,b,c', erreurs: [] })
        }
        finally {
          await window.happyDOM.close()
        }
      })
    }
  }
})
