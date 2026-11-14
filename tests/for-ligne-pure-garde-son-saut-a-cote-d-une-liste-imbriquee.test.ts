// Liste `µraw` dont les lignes pures (rien que leur élément) sont sautées quand elles gardent leur objet : une autre liste du même
// composant dont la ligne porte un `{for}` ne leur retire pas ce saut — seules les lignes qui portent une liste perdent le saut. Compté
// par les lignes relues : chaque objet est écrit sur place, puis la liste repasse avec les mêmes objets ; une ligne relue montre « X ».
// Justesse de la liste voisine à liste intérieure : ligne changée, liste intérieure changée, ligne ajoutée, retirée, échangée

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

async function construire(composants: Record<string, string>, prod: boolean): Promise<string> {
  const root   = mjsTmp('for-ligne-pure-voisine')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(composants)) writeFileSync(join(srcDir, nom + '.mjs'), source)
  const opts: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js') }
  if (prod) Object.assign(opts, { urlPrefix: '/out', env: 'prod', js: 'bundle' })
  const bundler = new Bundler(opts)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.deepEqual(stats.errors.map((e: any) => String(e.message)), [])
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
  return prod
    ? readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
    : ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
}

async function jouer(code: string, scenario: string): Promise<any> {
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  window.eval(code)
  const r = JSON.parse(JSON.stringify(await window.eval(scenario)))
  await window.happyDOM.close()
  return r
}

const N = 50
const COMP = `<script lang="js">
  $rows = µ.raw([]);
  $autres = [];
  @fill = function(a) { $rows = µ.raw(a); };
  @brut = function(o) { return µ.raw(o); };
  @groupes = function(g) { $autres = g; };
  @nom = function(i, v) { $autres[i].nom = v; };
  @item = function(i, v) { $autres[i].items.push(v); };
  @ajout = function(g) { $autres.push(g); };
  @retrait = function(i) { $autres.splice(i, 1); };
  @echange = function() { const a = $autres[0]; $autres[0] = $autres[1]; $autres[1] = a; };
</script>
<ul class="a">{for r in $rows by id}<li>{r.id}:{r.label}</li>{end}</ul>
<div class="g">{for g in $autres by id}<p>{g.nom}{for x in g.items}<i>{x}</i>{end}</p>{end}</div>
`
const SC = `(async () => {
  const tic = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)) }
  const el = document.body.appendChild(document.createElement('mjs-co-mixte'))
  for (let i = 0; i < 200 && !(el._shadow && el._shadow.querySelector('.g')); i++) await new Promise((r) => setTimeout(r, 10))
  await tic()
  const g = () => Array.from(el._shadow.querySelectorAll('.g > p')).map((p) => p.textContent).join(',')
  const a = Array.from({ length: ${N} }, (_, i) => el.brut({ id: i + 1, label: 'l' + i }))
  el.fill(a); await tic()
  el.fill(a.slice()); await tic()
  const R = { premier: el._shadow.querySelectorAll('ul.a > li').length }
  for (const o of a) o.label = 'X'
  el.fill(a.slice()); await tic()
  R.relues = Array.from(el._shadow.querySelectorAll('ul.a > li')).filter((li) => li.textContent.endsWith(':X')).length
  el.groupes([{ id: 1, nom: 'a', items: [1] }, { id: 2, nom: 'b', items: [] }, { id: 3, nom: 'c', items: [7, 8] }]); await tic()
  const S = [g()]
  el.nom(0, 'A'); await tic(); S.push(g())
  el.item(1, 5); await tic(); S.push(g())
  el.ajout({ id: 4, nom: 'd', items: [9] }); await tic(); S.push(g())
  el.retrait(2); await tic(); S.push(g())
  el.echange(); await tic(); S.push(g())
  R.scenes = S
  return R
})()`

describe('un `{for}` dans la ligne d\'une liste voisine laisse leur saut aux lignes pures d\'une liste `µraw`', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of [false, true]) {
    it((prod ? 'production' : 'développement') + ' : 0 ligne relue sur ' + N + ', liste voisine juste', async () => {
      const r = await jouer(await construire({ 'co-mixte': COMP }, prod), SC)
      assert.deepEqual(r, { premier: N, relues: 0, scenes: ['a1,b,c78', 'A1,b,c78', 'A1,b5,c78', 'A1,b5,c78,d9', 'A1,b5,d9', 'b5,A1,d9'] })
    })
  }
})
