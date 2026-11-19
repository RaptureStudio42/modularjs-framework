// Types — une variable dérivée qui porte une règle dans le <vars> (`$total int 0..100`, `$total = $a * 2`) : en développement, sa
// valeur passe le verdict d'une écriture, sans que rien la touche, à son premier calcul et à chaque recalcul qui la change, jamais à
// une lecture. Une valeur qui ne passerait pas telle quelle (ramenée, refusée, convertie) le dit une fois par composant et par
// variable tant qu'elle reste hors de sa règle ; revenue dans sa règle puis ressortie, de nouveau. Les modes "error" et "throw" ne
// l'arrêtent pas, le gestionnaire `µtypes.onError` ne la reçoit pas. Une dérivée qui attend ne dit que ce que dit déjà sa réponse.
// En production, le code de ce contrôle et son texte ne sont pas dans la construction. happy-dom ; le navigateur réel :
// types-derived-value-out-of-rule-warns-browser.test.ts

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs'
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

const DERIVED = [
  '<vars>',
  '  $total  int 0..100',
  '  $ok     bool',
  '  $flag   bool',
  '  $count  int',
  '  $fine   int 0..100',
  '  $many   int 0..1',
  '  $r      int 0..100',
  '</vars>',
  '',
  '<script>',
  '  $a      = 80',
  '  $list   = [1, 2]',
  '  $obj    = { x: 1 }',
  "  $txt    = '5'",
  '  $q      = 0',
  '  $total  = $a * 2',
  '  $ok     = $list.length',
  '  $flag   = $obj',
  '  $count  = $txt',
  '  $fine   = $a - 50',
  '  $many   = $list.filter((x) -> x > 0).length',
  '  charger = (q) -> Promise.resolve(300)',
  '  $r      = await charger($q)',
  '  µtypes.onError (e) -> window.__errs.push(e.path)',
  '</script>',
  '',
  '<p class="t">{$total}</p>',
  '<p class="o">{$ok}</p>',
  '<p class="f">{JSON.stringify($flag)}</p>',
  '<p class="c">{$count}</p>',
  '<p class="n">{$fine}</p>',
  '<p class="m">{$many}</p>',
  '<p class="r">{$r}</p>',
].join('\n')

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

// `prod` : les réglages d'une construction de production (rien : développement)
async function build(name: string, prod?: Record<string, unknown>): Promise<string> {
  const root   = mjsTmp(name)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'derived.mjs'), DERIVED)
  const options = prod ? { env: 'prod', js: 'bundle', urlPrefix: '/out', ...prod } : {}
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(prod ? outDir : root, 'bundle.js'), ...options } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return outDir
}

// le texte du message, tel que le développement l'écrit (catalogue français du cœur)
const said = (warnings: string[], k: string) => warnings.filter((w) => w.includes(`La variable dérivée « $${k} » du composant <mjs-derived> sort de sa règle`))

describe('types — a derived variable that leaves its rule is reported in development', function () {
  this.timeout(60000)
  let window: any
  let el: any
  const warnings: string[] = []

  before(async () => {
    const outDir = await build('types-derived-dev')
    const files  = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const code   = [...files.filter((f) => f.startsWith('mjs_')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()].map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.__errs = []
    // le mode que pose le manifeste de développement, et une console qui garde ce qu'on lui dit
    window.eval(`${code}\nglobalThis.µ = µ; µ._typesMode = 'warn';`)
    window.µ.warn = (...a: any[]) => { warnings.push(a.join(' ')) }
    window.document.body.innerHTML = '<mjs-derived></mjs-derived>'
    el = window.document.body.querySelector('mjs-derived')
    await attendre(() => el._shadow?.querySelector('.r')?.textContent === '100')
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  const text = (sel: string) => el._shadow.querySelector(sel).textContent

  it('first computation: a number above its range, a number and an object under bool, a text under int are each reported once', () => {
    for (const k of ['total', 'ok', 'flag', 'count', 'many']) assert.equal(said(warnings, k).length, 1, k + '\n' + warnings.join('\n'))
    assert.ok(said(warnings, 'total')[0].includes('$total vaut 160 — permis : int 0..100'), said(warnings, 'total')[0])
    assert.ok(said(warnings, 'total')[0].includes('corrigez le calcul ou la règle'), said(warnings, 'total')[0])
    assert.ok(said(warnings, 'ok')[0].includes('$ok vaut 2 — permis : bool'), said(warnings, 'ok')[0])
    assert.ok(said(warnings, 'flag')[0].includes('$flag vaut {"x":1} — permis : bool'), said(warnings, 'flag')[0])
    assert.ok(said(warnings, 'count')[0].includes("$count vaut '5' — permis : int"), said(warnings, 'count')[0])
  })

  it('the value stays the one of the calculation: neither brought back, nor converted, nor corrected', () => {
    assert.equal(el._state.total, 160)
    assert.equal(text('.t'), '160')
    assert.equal(el._state.ok, 2)
    assert.deepEqual(JSON.parse(JSON.stringify(el._state.flag)), { x: 1 })
    assert.equal(el._state.count, '5')
    assert.equal(el._state.many, 2)
  })

  it('a derived value that passes its rule says nothing; the precise path (graph of signals) is checked too', () => {
    assert.equal(el._state.fine, 30)
    assert.equal(said(warnings, 'fine').length, 0)
    assert.notEqual(el._mjs_computeds.many._mjs_src, null, '$many is a precise derived value')
  })

  it('a value that waits says only what its answer already says (a write): no second message', () => {
    assert.equal(el._state.r, 100)
    assert.equal(said(warnings, 'r').length, 0, warnings.join('\n'))
    assert.equal(warnings.filter((w) => w.includes('$r : 300 ramené à 100')).length, 1, warnings.join('\n'))
  })

  it('one message while the value stays outside; back inside then outside again: a new one', () => {
    el._set('a', 95)
    assert.equal(el._state.total, 190)
    assert.equal(said(warnings, 'total').length, 1, 'still outside: no new message')
    el._set('a', 30)
    assert.equal(el._state.total, 60)
    el._set('a', 90)
    assert.equal(el._state.total, 180)
    assert.equal(said(warnings, 'total').length, 2)
    el._set('obj', true)
    assert.equal(el._state.flag, true)
    el._set('obj', null)
    assert.equal(el._state.flag, null)
    assert.equal(said(warnings, 'flag').length, 2)
    assert.ok(said(warnings, 'flag')[1].includes('$flag vaut null — permis : bool'), said(warnings, 'flag')[1])
  })

  it('checked at a recalculation that changes the value, never at a read', () => {
    const µ     = window.µ
    const check = µ._mjs_tderived
    let calls   = 0
    µ._mjs_tderived = function (...a: any[]) { if (a[1] === 'total') calls++; return check.apply(this, a) }
    try {
      for (let i = 0; i < 20; i++) assert.equal(el._state.total, 180)
      assert.equal(calls, 0, 'reads served from the cache')
      el._set('txt', '6')
      assert.equal(el._state.total, 180)
      assert.equal(calls, 0, 'recalculated to the same number: no verdict')
      el._set('a', 91)
      assert.equal(el._state.total, 182)
      assert.equal(calls, 1, 'recalculated to another number: one verdict')
    }
    finally {
      µ._mjs_tderived = check
    }
  })

  it('"error" and "throw" modes: the same warning, the derived value neither stops nor throws; µtypes.onError receives nothing', () => {
    const µ = window.µ
    try {
      µ._typesMode = 'error'
      el._set('a', 30)
      assert.equal(el._state.total, 60)
      el._set('a', 99)
      assert.equal(el._state.total, 198)
      assert.equal(said(warnings, 'total').length, 3)
      µ._typesMode  = 'warn'
      µ._typesThrow = 1
      el._set('a', 30)
      assert.equal(el._state.total, 60)
      el._set('a', 98)
      assert.equal(el._state.total, 196)
      assert.equal(said(warnings, 'total').length, 4)
    }
    finally {
      µ._typesMode = 'warn'
      delete µ._typesThrow
    }
    assert.deepEqual(window.__errs, [])
  })

  it('production: neither the code of this check nor its text are in the construction', async () => {
    const files = (outDir: string) => readdirSync(outDir).filter((f) => statSync(join(outDir, f)).isFile()).map((f) => readFileSync(join(outDir, f), 'utf-8')).join('\n')
    // le cœur non minifié, noms lisibles : la machinerie des dérivées est là, rien de ce contrôle
    const core = readFileSync(join(await build('types-derived-prod-plain', { minify: false }), 'bundle.js'), 'utf-8')
    assert.ok(core.includes('_mjs_setComputed(k, fn, src) {'), 'the production core has derived values')
    for (const s of ['sort de sa règle', 'is outside its rule', 'typesDerived', '_mjs_tderived', '_mjsDerivedCheck', '_mjsTDerivedOut', '__before = v._mjs_cached']) assert.equal(core.includes(s), false, s)
    // la construction minifiée, au niveau de console par défaut et au niveau 'warn' : aucun fichier, fichiers de messages compris, n'en porte le texte
    for (const prod of [{}, { logLevel: 'warn' }] as Record<string, string>[]) {
      const all = files(await build('types-derived-prod-' + (prod.logLevel || 'default'), prod))
      assert.ok(all.length > 0)
      for (const s of ['sort de sa règle', 'is outside its rule', 'typesDerived']) assert.equal(all.includes(s), false, s + ' ' + JSON.stringify(prod))
    }
  })
})
