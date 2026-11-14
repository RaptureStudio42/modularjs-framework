// aucune réserve : une ligne retirée d'une liste n'est gardée nulle part, et rien ne s'arme pour la rendre plus tard — ni ligne détachée
// sur le composant, ni minuterie de repos, ni pool de nœuds texte sur µ. Une ligne qui revient est refaite par son gabarit : un nœud
// neuf, jamais celui d'une autre donnée. Les minuteries longues (une seconde et plus) sont relevées ici : les retraits n'en arment aucune

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const stripEsm = (s: string) => s
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
  .replace(/\bexport\s+default\s+/g, '')
  .replace(/\bexport\s+/g, '')
  .replace(/import\.meta\.url/g, "'http://localhost/'")

const CORPS = [
  '<script lang="js">',
  '  $data = µ.raw([]);',
  '  @poser = function(a) { $data = a; };',
  '</script>',
  '<ul>',
  '  {for row in $data by id}',
  '    <li><b class="id">{row.id}</b> <i>{row.label}</i></li>',
  '  {end}',
  '</ul>'
].join('\n')

const tic = async () => { await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)) }

describe('{for} — aucune réserve de lignes ni de nœuds texte', function () {
  this.timeout(60000)
  let win: any, el: any, µ: any
  const longues: number[] = []

  before(async () => {
    const root = mjsTmp('for-repos')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'repos.mjs'), CORPS)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') } as any)
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    win = new Window({ url: 'http://localhost/' })
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const coeur = files.find((f) => /^mjs_core-/.test(f))!
    const code = files.filter((f) => f !== coeur).reduce((acc, f) => acc + '\n' + stripEsm(readFileSync(join(outDir, f), 'utf-8')), stripEsm(readFileSync(join(outDir, coeur), 'utf-8')))
    // minuteries d'une seconde et plus relevées, toutes passent
    const st = win.setTimeout.bind(win)
    win.setTimeout = (f: Function, d?: number, ...x: any[]) => { if ((d ?? 0) >= 1000) longues.push(d!); return st(f, d, ...x) }
    win.eval(`${code}\nglobalThis.µ = µ;`)
    win.document.body.innerHTML = '<mjs-repos></mjs-repos>'
    el = win.document.body.firstElementChild
    µ = win.µ
    await tic()
  })
  after(async () => { win?.close?.(); await terminateSharedWorkerPool() })

  const ligne = (id: number) => µ.raw({ id, label: 'L' + id })
  const ids = (a: number, b: number) => { const r: any[] = []; for (let i = a; i <= b; i++) r.push(ligne(i)); return r }
  const lis = () => Array.from((el._shadow || el.shadowRoot).querySelectorAll('li')) as any[]
  const vus = () => lis().map((x: any) => +x.querySelector('.id').textContent)

  it('lignes : retirées puis remises, elles sont refaites par leur gabarit ; aucune n\'est gardée, aucune minuterie armée', async () => {
    el.poser(µ.raw(ids(1, 10))); await tic()
    const anciennes = new Set(lis())
    el.poser(µ.raw(ids(1, 4))); await tic()
    el.poser(µ.raw([])); await tic()
    assert.equal(lis().length, 0, 'liste vidée')
    assert.ok(el._mjs_list_pool === undefined, 'aucune réserve de lignes sur le composant')
    assert.deepEqual(longues, [], 'aucune minuterie armée pour rendre une réserve plus tard')
    el.poser(µ.raw(ids(1, 8))); await tic()
    assert.deepEqual(vus(), [1, 2, 3, 4, 5, 6, 7, 8], 'lignes refaites par leur gabarit')
    assert.equal(lis().filter((li) => anciennes.has(li)).length, 0, 'aucune ligne retirée n\'est reprise')
  })

  it('nœuds texte : µ ne porte aucun pool', () => {
    assert.equal(typeof µ._mjs_getTextNode, 'undefined', 'aucun service de nœuds texte')
    assert.equal(typeof µ._mjs_recycleTextLeaves, 'undefined', 'aucun retour de nœuds texte')
    assert.equal(typeof µ._mjs_textPool, 'undefined', 'aucun pool')
  })
})
