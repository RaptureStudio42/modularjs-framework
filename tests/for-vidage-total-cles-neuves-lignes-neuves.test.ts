// {for … by clé} vidé d'un coup : aucune ligne n'est gardée, les clés neuves ont des lignes neuves faites par leur gabarit — une valeur
// tapée, un état opaque posé hors gabarit (un `<details>` ajouté à une ligne au HTML brut) ou un composant enfant ne passe jamais à une
// clé neuve

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

async function build(files: Record<string, string>, tag: string) {
  const root   = mjsTmp('vidage-reprise-' + tag)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [rel, content] of Object.entries(files)) writeFileSync(join(srcDir, rel), content)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return outDir
}

function mountAll(outDir: string, hostTag: string) {
  const win: any      = new Window({ url: 'http://localhost/' })
  const document: any = win.document
  const files    = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const coreFile = files.find((f) => /^mjs_core-/.test(f))!
  const code     = files
    .filter((f) => f !== coreFile)
    .reduce((acc, f) => acc + '\n' + stripEsm(readFileSync(join(outDir, f), 'utf-8')), stripEsm(readFileSync(join(outDir, coreFile), 'utf-8')))
  win.eval(`${code}\nglobalThis.µ = µ;`)
  document.body.innerHTML = `<${hostTag}></${hostTag}>`
  return { win, el: document.body.firstElementChild }
}

const tic   = async () => { await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)) }
const clic  = (win: any, shadow: any, sel: string) => shadow.querySelector(sel).dispatchEvent(new win.Event('click', { bubbles: true }))

// hôte : trois lignes, vidées d'un coup puis remplacées par trois clés neuves ; `ligne` = le contenu d'une ligne
const hote = (ligne: string) => [
  '<script lang="coffee">',
  '$rows = [',
  '  { id: 1, label: \'A\' }',
  '  { id: 2, label: \'B\' }',
  '  { id: 3, label: \'C\' }',
  ']',
  'clearAll = -> $rows = []',
  'refill = -> $rows = [ { id: 91, label: \'Z1\' }, { id: 92, label: \'Z2\' }, { id: 93, label: \'Z3\' } ]',
  '</script>',
  '<div>',
  '  {for row in $rows by id}',
  `    <section class="row" data-id="{row.id}">${ligne}<span class="lbl">{row.label}</span></section>`,
  '  {end}',
  '</div>',
  '<button id="btnClear" @click={clearAll}>clear</button>',
  '<button id="btnRefill" @click={refill}>refill</button>',
].join('\n')

describe('{for … by clé} vidé d\'un coup — aucune ligne gardée, les clés neuves ont des lignes neuves', function () {
  this.timeout(40000)
  after(async () => { await terminateSharedWorkerPool() })

  it('le vidage ne garde aucune ligne ; les clés neuves ont trois lignes neuves, champs au gabarit', async () => {
    const outDir = await build({ 'hotevidage.mjs': hote('<input class="inp" />') }, 'compte')
    const { win, el } = mountAll(outDir, 'mjs-hotevidage')
    await tic()
    const shadow = el._shadow || el.shadowRoot
    assert.equal(el.constructor._mjs_noDestroyHooks, true, 'précondition : composant sans crochet de destruction (vidage groupé)')
    const anciens = new Set(Array.from(shadow.querySelectorAll('section.row input.inp')).map((inp: any, i) => { inp.value = 'TAPE_' + i; return inp }))

    clic(win, shadow, '#btnClear')
    await tic()
    assert.equal(shadow.querySelectorAll('section.row').length, 0, 'liste vidée')

    clic(win, shadow, '#btnRefill')
    await tic()
    const neufs = Array.from(shadow.querySelectorAll('section.row input.inp')) as any[]
    assert.equal(neufs.length, 3, 'trois lignes neuves')
    assert.equal(neufs.filter((inp) => anciens.has(inp)).length, 0, 'aucune ligne reprise : trois lignes neuves')
    assert.ok(neufs.every((inp) => inp.value === ''), 'valeur tapée jamais passée à la clé neuve')
    assert.deepEqual(Array.from(shadow.querySelectorAll('section.row .lbl')).map((s: any) => s.textContent), ['Z1', 'Z2', 'Z3'])
    win.close?.()
  })

  it('une ligne au HTML brut qui porte un état opaque posé hors gabarit (un <details> ajouté) : aucune ligne reprise, l\'état ne passe à aucune clé neuve', async () => {
    const outDir = await build({ 'hotemixte.mjs': hote('<i class="h">{{row.label}}</i>') }, 'mixte')
    const { win, el } = mountAll(outDir, 'mjs-hotemixte')
    await tic()
    const shadow = el._shadow || el.shadowRoot
    const lignes  = Array.from(shadow.querySelectorAll('section.row')) as any[]
    const details = win.document.createElement('details')
    details.setAttribute('open', '')
    lignes[1].appendChild(details)

    clic(win, shadow, '#btnClear')
    await tic()
    clic(win, shadow, '#btnRefill')
    await tic()
    const neuves = Array.from(shadow.querySelectorAll('section.row')) as any[]
    assert.deepEqual(neuves.map((s) => s.querySelector('.lbl').textContent), ['Z1', 'Z2', 'Z3'])
    assert.ok(!neuves.includes(lignes[1]), 'la ligne à état propre n\'est reprise pour aucune clé neuve')
    assert.equal(shadow.querySelectorAll('details').length, 0, 'son état ne passe à aucune ligne')
    assert.equal(neuves.filter((s) => lignes.includes(s)).length, 0, 'aucune des trois anciennes lignes n\'est reprise')
    win.close?.()
  })

  it('composant enfant dans chaque ligne : après le vidage, les clés neuves reçoivent des composants neufs, compteurs à zéro', async () => {
    const ENFANT = [
      '<script lang="coffee">',
      '  $localCount ?= 0',
      '</script>',
      '<button class="inc" @click={-> $localCount++}>+</button>',
      '<span class="cnt">{$localCount}</span>',
    ].join('\n')
    const outDir = await build({ 'enfantvidage.mjs': ENFANT, 'hoteenfantvidage.mjs': hote('<mjs-enfantvidage></mjs-enfantvidage>') }, 'enfant')
    const { win, el } = mountAll(outDir, 'mjs-hoteenfantvidage')
    await tic()
    const shadow = el._shadow || el.shadowRoot
    assert.equal(el.constructor._mjs_noDestroyHooks, true, 'précondition : composant sans crochet de destruction (vidage groupé)')
    const enfants = Array.from(shadow.querySelectorAll('mjs-enfantvidage')) as any[]
    const bouton  = enfants[1]._shadow.querySelector('button.inc')
    for (let i = 0; i < 3; i++) bouton.dispatchEvent(new win.Event('click', { bubbles: true }))
    await tic()
    assert.equal(enfants[1]._shadow.querySelector('span.cnt').textContent, '3', 'compteur monté à 3 avant le vidage')

    clic(win, shadow, '#btnClear')
    await tic()
    clic(win, shadow, '#btnRefill')
    await tic()
    const neufs = Array.from(shadow.querySelectorAll('mjs-enfantvidage')) as any[]
    assert.equal(neufs.length, 3, 'trois composants rendus')
    assert.ok(neufs.every((c) => !enfants.includes(c)), 'aucun composant repris pour une autre clé')
    assert.ok(neufs.every((c) => c._shadow.querySelector('span.cnt').textContent === '0'), 'compteurs à zéro')
    win.close?.()
  })
})
