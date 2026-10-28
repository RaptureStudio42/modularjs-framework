// Réserves rendues au repos : les lignes détachées qu'une liste garde pour les reprendre (réserve de lignes, mjs_for.ts) et les nœuds
// texte vides gardés pour le mode impératif du générateur (mjs_textpool.ts) ne restent pas en mémoire pour toujours. Une minuterie de
// 5 s, armée au premier dépôt, est relancée tant que la réserve sert ; un tour entier sans dépôt ni reprise la vide. Les minuteries de
// 5 s sont captées ici et déclenchées à la main

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

describe('{for} — réserves rendues au repos', function () {
  this.timeout(60000)
  let win: any, el: any, µ: any
  const captees: Function[] = []

  before(async () => {
    const root = mjsTmp('for-repos')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'repos.mjs'), CORPS)
    // le pool de nœuds texte joint d'office (le mode clone du générateur ne l'appelle pas)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), runtime: ['textpool'] } as any)
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    win = new Window({ url: 'http://localhost/' })
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const coeur = files.find((f) => /^mjs_core-/.test(f))!
    const code = files.filter((f) => f !== coeur).reduce((acc, f) => acc + '\n' + stripEsm(readFileSync(join(outDir, f), 'utf-8')), stripEsm(readFileSync(join(outDir, coeur), 'utf-8')))
    // minuteries de 5 s captées, les autres passent
    const st = win.setTimeout.bind(win)
    win.setTimeout = (f: Function, d?: number, ...x: any[]) => { if (d === 5000) { captees.push(f); return 1 } return st(f, d, ...x) }
    win.eval(`${code}\nglobalThis.µ = µ;`)
    win.document.body.innerHTML = '<mjs-repos></mjs-repos>'
    el = win.document.body.firstElementChild
    µ = win.µ
    await tic()
  })
  after(async () => { win?.close?.(); await terminateSharedWorkerPool() })

  const ligne = (id: number) => µ.raw({ id, label: 'L' + id })
  const ids = (a: number, b: number) => { const r: any[] = []; for (let i = a; i <= b; i++) r.push(ligne(i)); return r }
  const reserve = () => { const cid = Object.keys(el._mjs_list_pool || {})[0]; return cid ? el._mjs_list_pool[cid] || [] : [] }
  const vus = () => Array.from((el._shadow || el.shadowRoot).querySelectorAll('li .id')).map((x: any) => +x.textContent)
  const declencher = () => { const f = captees.shift(); assert.ok(f, 'une minuterie de 5 s est armée'); f!() }

  it('lignes : la réserve reste tant qu\'elle sert, se vide après un tour sans usage, et la liste se refait ensuite', async () => {
    el.poser(µ.raw(ids(1, 10))); await tic()
    el.poser(µ.raw(ids(1, 4))); await tic()
    assert.equal(reserve().length, 6, 'six lignes retirées, gardées en réserve')
    assert.equal(captees.length, 1, 'minuterie armée au premier dépôt')
    declencher()
    assert.equal(reserve().length, 6, 'réserve servie pendant ce tour : gardée, minuterie relancée')
    assert.equal(captees.length, 1, 'minuterie relancée')
    declencher()
    assert.equal(reserve().length, 0, 'un tour entier sans dépôt ni reprise : réserve vidée')
    assert.equal(captees.length, 0, 'plus de minuterie tant que rien n\'est déposé')
    el.poser(µ.raw(ids(1, 8))); await tic()
    assert.deepEqual(vus(), [1, 2, 3, 4, 5, 6, 7, 8], 'lignes refaites par leur gabarit')
  })

  it('nœuds texte : le pool se vide après un tour sans service ni retour', async () => {
    captees.length = 0
    const d = win.document.createElement('p')
    d.appendChild(win.document.createTextNode('a'))
    d.appendChild(win.document.createElement('span')).appendChild(win.document.createTextNode('b'))
    const avant = µ._mjs_textPool.length
    µ._mjs_recycleTextLeaves(d)
    assert.ok(µ._mjs_textPool.length >= avant + 2, 'nœuds texte rendus au pool')
    assert.equal(captees.length, 1, 'minuterie armée au retour')
    declencher()
    assert.ok(µ._mjs_textPool.length > 0, 'pool servi pendant ce tour : gardé')
    declencher()
    assert.equal(µ._mjs_textPool.length, 0, 'un tour entier sans usage : pool vidé')
  })
})
