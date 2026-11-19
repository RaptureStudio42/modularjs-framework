// Types — le contrôle des variables dérivées réglées, en développement : un message par balise et par variable tant qu'une instance est
// hors de sa règle (une liste qui alterne instances dedans et dehors n'en donne qu'un ; toutes revenues dans leur règle puis une
// ressortie, de nouveau) ; rien n'est jugé tant qu'une valeur qui attend du composant n'a pas donné sa première réponse (`$half = $r * 2`
// vaudrait NaN), tout l'est à cette réponse ; la règle d'un objet se dit sur une ligne. happy-dom ; le message lui-même :
// types-derived-value-out-of-rule-warns-in-development.test.ts

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

const PARENT = [
  '<vars>',
  '  $half  int 0..1000',
  '  $big   int 0..10',
  '  $p',
  '    n  int',
  '</vars>',
  '<script>',
  '  $vals = [50, 1, 60, 2, 70, 3]',
  '  $q    = 0',
  "  $txt  = '5'",
  '  load  = (q) ->',
  '    await µafter 200',
  '    300',
  '  $r    = await load($q)',
  '  $half = $r * 2',
  '  $big  = $q + 50',
  '  $p    = { n: $txt }',
  '</script>',
  '<i>{$half} {$big} {JSON.stringify($p)}</i>',
  '{for v in $vals}',
  '  <@kid b={v}>',
  '{end}',
].join('\n')

const KID = [
  '<vars>',
  '  $k  int 0..10',
  '</vars>',
  '<script>',
  '  $k = $b + 1',
  '</script>',
  '<b>{$k} {$b}</b>',
].join('\n')

async function waitFor(cond: () => boolean, ms = 3000) {
  const end = Date.now() + ms
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 10))
}

async function build(name: string): Promise<string> {
  const root   = mjsTmp(name)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'derived.mjs'), PARENT)
  writeFileSync(join(srcDir, 'kid.mjs'), KID)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return outDir
}

describe('types — derived value check: one message per tag and variable, nothing judged before the first answer of a waiting value', function () {
  this.timeout(60000)
  let window: any
  let el: any
  const warnings: string[] = []
  const said = (tag: string, k: string) => warnings.filter((w) => w.includes(`La variable dérivée « $${k} » du composant <${tag}> sort de sa règle`))

  before(async () => {
    const outDir = await build('types-derived-per-tag')
    const files  = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const code   = [...files.filter((f) => f.startsWith('mjs_')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()].map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ; µ._typesMode = 'warn';`)
    window.µ.warn = (...a: any[]) => { warnings.push(a.join(' ')) }
    window.document.body.innerHTML = '<mjs-derived></mjs-derived>'
    el = window.document.body.querySelector('mjs-derived')
    await waitFor(() => el._state?.half === 600)
    await new Promise((r) => setTimeout(r, 100))
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  it('six instances alternately inside and outside their rule: one message', () => {
    assert.equal(said('mjs-kid', 'k').length, 1, said('mjs-kid', 'k').join('\n'))
  })

  it('a derived value that reads a waiting value is not judged before its first answer (NaN), the answer 300 gives 600, inside its rule', () => {
    assert.equal(el._state.half, 600)
    assert.deepEqual(said('mjs-derived', 'half'), [])
  })

  it('a derived value outside its rule in a component that waits is reported once the answer has come', () => {
    assert.equal(said('mjs-derived', 'big').length, 1, warnings.join('\n'))
  })

  it('a conversion inside an object: the rule of the object is said on one line', () => {
    const p = said('mjs-derived', 'p')
    assert.equal(p.length, 1, warnings.join('\n'))
    assert.ok(p[0].includes('permis : { n int }'), p[0])
    assert.ok(!p[0].includes('\n'), p[0])
  })

  it('all instances back inside their rule, then one outside again: a new message', async () => {
    window.µ._set(el, 'vals', [1, 2, 3, 4, 5, 6])
    await waitFor(() => el._shadow.querySelectorAll('mjs-kid').length === 6 && [...el._shadow.querySelectorAll('mjs-kid')].every((k: any) => k._state.k <= 7))
    assert.equal(said('mjs-kid', 'k').length, 1, said('mjs-kid', 'k').join('\n'))
    window.µ._set(el, 'vals', [1, 90, 3, 4, 5, 6])
    await waitFor(() => said('mjs-kid', 'k').length === 2)
    assert.equal(said('mjs-kid', 'k').length, 2, said('mjs-kid', 'k').join('\n'))
  })
})
