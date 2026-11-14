// `µrefresh($x)` rafraîchit tout enfant qu'une liaison de `$x` nourrit, avec ou sans l'enveloppe (réglage `"proxy": false`) — aussi
// l'enfant d'une ligne qu'une AUTRE variable du composant tient elle-même (`$sel = $rows[0]`, puis une écriture faite par un nom ou
// hors de MJS, puis `µrefresh($rows)`) : sans l'enveloppe, MJS ne connaît de cette ligne que `$sel`, et son enfant ne doit pas rester
// figé pour autant. De même pour un sous-objet (`$q = $o.a`, puis `µrefresh($o)`). Cœur construit, monté dans happy-dom
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const tic = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)) }
const js  = (script: string[], gabarit: string) => ['<script lang="js">', ...script.map((l) => '  ' + l), '</script>', gabarit].join('\n')
const SOURCES: Record<string, string> = {
  'rn-v.mjs': js(['$item = null;'], '<em>{JSON.stringify($item)}</em>'),
  // lignes-composants et sélection
  'rn-lignes.mjs': js(['const brut = [{ id: 1, n: "a" }, { id: 2, n: "b" }];', '$rows = brut;', '$sel = null;', '@choisir = function() { $sel = $rows[0]; };',
    '@dehors = function() { brut[0].n = "X"; brut[1].n = "Y"; µrefresh($rows); };', '@nom = function() { const r = $rows[0], q = $rows[1]; r.n = "X"; q.n = "Y"; µrefresh($rows); };', '@direct = function() { $rows[0].n = "X"; $rows[1].n = "Y"; };'],
    '<p>{$sel ? $sel.n : "-"}</p>{for r in $rows by id}<@rn-v item={r}></@rn-v>{end}'),
  // objet de l'état et une seconde variable sur son sous-objet
  'rn-objet.mjs': js(['const brut = { a: { x: 0 }, z: { y: 0 } };', '$o = brut;', '$q = null;', '@choisir = function() { $q = $o.a; };',
    '@dehors = function() { brut.a.x = 5; brut.z.y = 5; µrefresh($o); };', '@nom = function() { const t = $o.a, u = $o.z; t.x = 5; u.y = 5; µrefresh($o); };', '@direct = function() { $o.a.x = 5; $o.z.y = 5; };'],
    '<p>{$q ? $q.x : "-"}</p><@rn-v item={$o.a}></@rn-v><@rn-v item={$o.z}></@rn-v>'),
}
const ATTENDU: Record<string, string[]> = { 'rn-lignes': ['{"id":1,"n":"X"}', '{"id":2,"n":"Y"}'], 'rn-objet': ['{"x":5}', '{"y":5}'] }
const REGLAGES: Array<[string, any]> = [['développement', {}], ['production', { env: 'prod' }], ['production sans enveloppe', { env: 'prod', proxy: false }], ['développement sans enveloppe', { proxy: false }]]
const ombre = (e: any) => e._shadow || e.shadowRoot || e

for (const [nom, opts] of REGLAGES) describe(`µrefresh : l'enfant nourri par la variable rafraîchie suit, même tenu aussi par une autre variable (${nom})`, function () {
  this.timeout(120000)
  let code = ''
  const fenetres: any[] = []

  before(async () => {
    const root   = mjsTmp('raf-autre-variable')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [f, s] of Object.entries(SOURCES)) writeFileSync(join(srcDir, f), s)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), minify: false, ...opts } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b))
    code = files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  })

  after(async () => {
    for (const w of fenetres) w.close?.()
    await terminateSharedWorkerPool()
  })

  for (const tag of ['rn-lignes', 'rn-objet']) for (const choisi of [false, true]) for (const geste of ['dehors', 'nom', 'direct']) {
    it(`${tag === 'rn-lignes' ? 'lignes d\'une liste' : 'sous-objets d\'un objet'}, ${choisi ? 'l\'un tenu aussi par une autre variable' : 'sans autre variable'}, geste ${geste} : chaque enfant montre ce qu'il tient`, async () => {
      const win: any = new Window({ url: 'http://localhost/' })
      fenetres.push(win)
      win.eval(`${code}\nglobalThis.µ = µ;`)
      win.document.body.innerHTML = `<mjs-${tag}></mjs-${tag}>`
      await tic()
      const el = win.document.querySelector('mjs-' + tag)
      if (choisi) { el.choisir(); await tic() }
      el[geste]()
      await tic()
      const vus = (Array.from(ombre(el).querySelectorAll('mjs-rn-v')) as any[]).map((c) => ombre(c).querySelector('em').textContent)
      assert.deepEqual(vus, ATTENDU[tag])
    })
  }
})
