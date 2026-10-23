// `data-*` et `aria-*` écrits sur un composant (`<@x>`, léger, cœur `<@@x>`) arrivent toujours sur SA
// balise : fixes, liés (`{$x}`, `!{$x}`, store `$$x`), ou nus (valeur vide, comme en HTML). Un lié suit sa
// variable : `null`/`undefined` retirent l'attribut, `true` donne « true », `false` donne « false » pour
// `aria-*` (comme pour une balise native) et retire un `data-*`. Le composant relit la valeur par
// `@getAttribute('data-…')`. Rendu serveur : l'attribut est dans le HTML prérendu, fixe comme lié.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const stripEsm = (s: string): string => s
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
  .replace(/\bexport\s+default\s+/g, '')
  .replace(/\bexport\s+/g, '')
  .replace(/import\.meta\.url/g, "'http://localhost/'")

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

const HOTE = [
  '<script>',
  "  $$s    = 'st1'",
  "  $cle   = 'abc'",
  "  $lab   = 'L1'",
  '  $on    = true',
  "  $liste = ['p', 'q']",
  '</script>',
  '<@carte class="fixe" data-cle="abc"></@carte>',
  '<@carte class="lie" data-cle={$cle}></@carte>',
  '<@carte class="bidi" data-cle=!{$cle}></@carte>',
  '<@carte class="sto" data-st={$$s}></@carte>',
  '<@carte class="nu" data-vide></@carte>',
  '<@carte class="nua" aria-hidden></@carte>',
  '<@carte class="arl" aria-label={$lab}></@carte>',
  '<@carte class="arb" aria-pressed={$on}></@carte>',
  '<@carte class="leg" @lightDom data-cle={$cle}></@carte>',
  '<@@checkbox class="coeur" name="a" data-cle={$cle}>ok</@@checkbox>',
  '{for n in $liste}<@carte class="bou" data-n={n} data-cle={$cle}></@carte>{end}',
  "<button class=\"go\" @click={$cle = 'def'; $$s = 'st2'; $lab = null; $on = false}>go</button>",
].join('\n')

const CARTE = '<p class="c">carte</p>\n'

async function compiler(prefixe: string, fichiers: Record<string, string>) {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(fichiers)) writeFileSync(join(srcDir, nom), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  await bundler.close()
  return { root, srcDir, outDir }
}

describe('data-* et aria-* sur un composant : sur sa balise', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  let document: any
  let hote: any
  const attr = (cl: string, nom: string): string | null => {
    const n = hote._shadow.querySelector('.' + cl) ?? hote.querySelector('.' + cl)
    return n ? n.getAttribute(nom) : '(balise absente)'
  }

  before(async () => {
    const { outDir } = await compiler('data-aria-composant', { 'hote.mjs': HOTE, 'carte.mjs': CARTE })
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    const window: any = new Window({ url: 'http://localhost/' })
    document = window.document
    window.eval(`${code}\nglobalThis.µ = µ;`)
    document.body.insertAdjacentHTML('beforeend', '<mjs-hote></mjs-hote>')
    hote = document.body.querySelector('mjs-hote')
    await pause(250)
  })

  it('a. fixe : la balise porte l’attribut', () => {
    assert.equal(attr('fixe', 'data-cle'), 'abc')
  })

  it('b. lié `{$x}` : la balise porte la valeur', () => {
    assert.equal(attr('lie', 'data-cle'), 'abc')
  })

  it('c. lié `!{$x}` : la balise porte la valeur', () => {
    assert.equal(attr('bidi', 'data-cle'), 'abc')
  })

  it('d. store `$$x` : la balise porte la valeur', () => {
    assert.equal(attr('sto', 'data-st'), 'st1')
  })

  it('e. sans valeur : vide, pas « true »', () => {
    assert.equal(attr('nu', 'data-vide'), '')
    assert.equal(attr('nua', 'aria-hidden'), '')
  })

  it('f. aria-label et aria-pressed liés', () => {
    assert.equal(attr('arl', 'aria-label'), 'L1')
    assert.equal(attr('arb', 'aria-pressed'), 'true')
  })

  it('g. composant léger et composant cœur', () => {
    assert.equal(attr('leg', 'data-cle'), 'abc')
    assert.equal(attr('coeur', 'data-cle'), 'abc')
  })

  it('h. dans un {for} : chaque ligne porte les siens', () => {
    const lignes = Array.from(hote._shadow.querySelectorAll('.bou')) as any[]
    assert.equal(lignes.length, 2)
    assert.deepEqual(lignes.map((l) => l.getAttribute('data-n')), ['p', 'q'])
    assert.deepEqual(lignes.map((l) => l.getAttribute('data-cle')), ['abc', 'abc'])
  })

  it('i. le composant relit la valeur par getAttribute', () => {
    assert.equal(hote._shadow.querySelector('.lie').getAttribute('data-cle'), 'abc')
  })

  it('j. la variable change : les attributs suivent (null retire, false de aria reste « false »)', async () => {
    hote._shadow.querySelector('.go').click()
    await pause(250)
    assert.equal(attr('lie', 'data-cle'), 'def')
    assert.equal(attr('bidi', 'data-cle'), 'def')
    assert.equal(attr('sto', 'data-st'), 'st2')
    assert.equal(attr('arl', 'aria-label'), null, 'null retire aria-label')
    assert.equal(attr('arb', 'aria-pressed'), 'false')
    assert.equal(attr('leg', 'data-cle'), 'def')
    assert.equal(attr('coeur', 'data-cle'), 'def')
    const lignes = Array.from(hote._shadow.querySelectorAll('.bou')) as any[]
    assert.deepEqual(lignes.map((l) => l.getAttribute('data-cle')), ['def', 'def'])
    assert.equal(attr('fixe', 'data-cle'), 'abc')
  })
})

describe('data-* et aria-* sur un composant : rendu serveur', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('k. le HTML prérendu porte le fixe, le lié (valeur initiale) et le nu', async () => {
    const { srcDir, outDir } = await compiler('data-aria-composant-ssr', { 'hote.mjs': HOTE, 'carte.mjs': CARTE })
    const renderer = await createSSRRenderer({ sourceDir: srcDir, outputDir: outDir })
    try {
      const { html } = await renderer.renderToString('mjs-hote', {})
      const balise = (cl: string): string => (html.match(new RegExp(`<mjs-carte[^>]*class="${cl}"[^>]*>|<mjs-carte[^>]*class='${cl}'[^>]*>`)) ?? [''])[0]
      assert.match(balise('fixe'), /data-cle=["']abc["']/, balise('fixe'))
      assert.match(balise('lie'), /data-cle=["']abc["']/, balise('lie'))
      assert.match(balise('sto'), /data-st=["']st1["']/, balise('sto'))
      assert.match(balise('arl'), /aria-label=["']L1["']/, balise('arl'))
      assert.match(balise('nu'), /data-vide(?:=["']["'])?[\s>]/, balise('nu'))
      assert.doesNotMatch(balise('nu'), /data-vide=["']true["']/)
    } finally {
      await renderer.close()
    }
  })
})
