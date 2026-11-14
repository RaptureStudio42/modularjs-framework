// clés `by` à la création complète d'une liste : un doublon se voit en remplissant le cache des lignes (encore vide), sans ensemble des n
// clés fabriqué à part ; seule une liste qui a des doublons en fabrique un pour les écarter. Comportement d'avant : seule la première occurrence de chaque clé est rendue, avec son rang dans la collection, et un
// avertissement part une fois par composant ; une liste déjà rendue qui reçoit des doublons les écarte de même

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

const LISTE = [
  '<script lang="js">',
  '  $data = [];',
  '  @poser = function(a) { $data = a; };',
  '</script>',
  '<ul>',
  '  {for i, row in $data by id}',
  '    <li>{row.id}:{row.label}:{i}</li>',
  '  {end}',
  '</ul>'
].join('\n')

const tic = async () => { await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)) }

describe('{for … by} — clés en double à la création complète, sans ensemble des clés', function () {
  this.timeout(60000)
  let win: any, el: any
  const avis: string[] = []
  let ajouts = 0
  let suivies = new Set<any>()

  before(async () => {
    const root = mjsTmp('for-doublons-creation')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'doublons.mjs'), LISTE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    win = new Window({ url: 'http://localhost/' })
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const coeur = files.find((f) => /^mjs_core-/.test(f))!
    const code = files.filter((f) => f !== coeur).reduce((acc, f) => acc + '\n' + stripEsm(readFileSync(join(outDir, f), 'utf-8')), stripEsm(readFileSync(join(outDir, coeur), 'utf-8')))
    win.eval(`${code}\nglobalThis.µ = µ;`)
    win.console.warn = (...a: any[]) => { avis.push(a.map(String).join(' ')) }
    // chaque clé de ligne reçue par un ensemble, comptée
    const proto = win.Set.prototype
    const avant = proto.add
    proto.add = function(v: any) { if (suivies.has(v)) ajouts++; return avant.call(this, v) }
    win.document.body.innerHTML = '<mjs-doublons></mjs-doublons>'
    el = win.document.body.firstElementChild
    await tic()
  })
  after(async () => { win?.close?.(); await terminateSharedWorkerPool() })

  const textes = () => Array.from((el._shadow || el.shadowRoot).querySelectorAll('li')).map((li: any) => li.textContent)
  const doublons = () => avis.filter((a) => /clés dupliquées|duplicate keys/i.test(a))

  it('création complète avec doublons : premières occurrences rendues à leur rang, un avertissement', async () => {
    el.poser([{ id: 1, label: 'a' }, { id: 2, label: 'b' }, { id: 2, label: 'b2' }, { id: 3, label: 'c' }, { id: 1, label: 'a2' }, { id: 4, label: 'd' }])
    await tic()
    assert.deepEqual(textes(), ['1:a:0', '2:b:1', '3:c:3', '4:d:5'])
    assert.equal(doublons().length, 1, 'un avertissement')
  })

  it('création complète sans doublon : aucun ensemble des clés', async () => {
    el.poser([])
    await tic()
    suivies = new Set<any>([5, 6, 7])
    ajouts = 0
    el.poser([{ id: 5, label: 'e' }, { id: 6, label: 'f' }, { id: 7, label: 'g' }])
    await tic()
    suivies = new Set()
    assert.deepEqual(textes(), ['5:e:0', '6:f:1', '7:g:2'])
    assert.equal(ajouts, 0, 'clés reçues par un ensemble à la création : ' + ajouts)
  })

  it('liste déjà rendue qui reçoit des doublons : premières occurrences seulement, pas de second avertissement', async () => {
    el.poser([{ id: 7, label: 'g' }, { id: 8, label: 'h' }, { id: 7, label: 'g2' }, { id: 9, label: 'i' }])
    await tic()
    assert.deepEqual(textes(), ['7:g:0', '8:h:1', '9:i:3'])
    assert.equal(doublons().length, 1, 'l\'avertissement part une fois par composant')
  })

  it('doublon en dernière place, puis tout en double : la liste reste juste', async () => {
    el.poser([])
    await tic()
    el.poser([{ id: 1, label: 'a' }, { id: 2, label: 'b' }, { id: 1, label: 'x' }])
    await tic()
    assert.deepEqual(textes(), ['1:a:0', '2:b:1'])
    el.poser([])
    await tic()
    el.poser([{ id: 3, label: 'c' }, { id: 3, label: 'c' }, { id: 3, label: 'c' }])
    await tic()
    assert.deepEqual(textes(), ['3:c:0'])
  })
})
