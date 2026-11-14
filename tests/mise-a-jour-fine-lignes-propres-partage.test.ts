// lignes propres : un objet montré par une liste propre et changé PAR MJS ailleurs — magasin, enfant lié par une prop à deux sens,
// autre composant qui tient le même tableau — est relu à la passe suivante de la liste, comme avant la mise à jour fine ; une ligne
// en attente de sa microtâche quand le composant quitte la page est relue quand il revient. Seul un objet changé hors de MJS garde son
// ancienne valeur (µrefresh). En développement, une clé en double n'avertit pas à tort, et la construction réussit avec µafter

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

const tic = async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0)) }
const js = (script: string[], gabarit: string[]) => ['<script lang="js">', ...script.map((l) => '  ' + l), '</script>', ...gabarit].join('\n')
const LIGNES = "const a = []; for (let i = 0; i < 6; i++) a.push({ id: i + 1, label: 'r' + (i + 1) });"
const BASE = ['$data = [];', `@poser = function() { ${LIGNES} $data = a; };`, "@fine = function() { $data[2].label += ' F'; };", '@echanger = function() { const t = $data[1]; $data[1] = $data[4]; $data[4] = t; };']
const LISTE = '{for row in $data by id}<i>{row.label}</i>{end}'

const SOURCES: Record<string, string> = {
  'mag-liste.mjs': js([...BASE, '@prendre = function() { $data = $$items; };'], [LISTE]),
  'mag-ecrit.mjs': js(["@ecrire = function() { $$items[3].label += ' M'; };"], ['<b>{$$items ? $$items.length : 0}</b>']),
  'fiche-liee.mjs': js(["@ecrire = function() { $item.label += ' C'; };"], ["<em>{$item ? $item.label : '-'}</em>"]),
  'parent-lie.mjs': js([...BASE, '$sel = null;', '@choisir = function() { $sel = $data[3]; };'], ['<@fiche-liee item=!{$sel}></@fiche-liee>', LISTE]),
  'comp-a.mjs': js([...BASE, '@prendre = function() { $data = globalThis.__partage; };'], [LISTE]),
  'comp-b.mjs': js([...BASE, '@prendre = function() { $data = globalThis.__partage; };', "@ecrire = function() { $data[3].label += ' B'; };"], ['{for row in $data by id}<b>{row.label}</b>{end}']),
  'part.mjs': js([...BASE, "@partir = function() { $data[0].label += '!'; this.remove(); };"], [LISTE]),
  'doublon.mjs': js([...BASE, "@doubler = function() { $data.push({ id: 2, label: 'double' }); };"], [LISTE]),
}

describe('mise à jour fine — lignes propres : objet changé par MJS ailleurs (runtime)', function () {
  this.timeout(60000)
  let win: any, µ: any
  const avis: string[] = []

  before(async () => {
    const root   = mjsTmp('fine-lignes-propres-partage')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [f, s] of Object.entries(SOURCES)) writeFileSync(join(srcDir, f), s)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    win = new Window({ url: 'http://localhost/' })
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const coeur = files.find((f) => /^mjs_core-/.test(f))!
    const code = files.filter((f) => f !== coeur).reduce((acc, f) => acc + '\n' + stripEsm(readFileSync(join(outDir, f), 'utf-8')), stripEsm(readFileSync(join(outDir, coeur), 'utf-8')))
    win.eval(`${code}\nglobalThis.µ = µ;`)
    µ = win.µ
    µ.warn = (...a: any[]) => { avis.push(a.map(String).join(' ')) }
    win.document.body.innerHTML = '<mjs-mag-liste></mjs-mag-liste><mjs-mag-ecrit></mjs-mag-ecrit><mjs-parent-lie></mjs-parent-lie><mjs-comp-a></mjs-comp-a><mjs-comp-b></mjs-comp-b><div id="h"><mjs-part></mjs-part></div><mjs-doublon></mjs-doublon>'
    await tic()
  })
  after(async () => { win?.close?.(); await terminateSharedWorkerPool() })

  const hote = (nom: string): any => win.document.querySelector('mjs-' + nom)
  const ombre = (el: any) => el._shadow || el.shadowRoot
  const textes = (el: any, sel: string) => Array.from(ombre(el).querySelectorAll(sel)).map((x: any) => x.textContent)
  // une écriture fine puis un échange : la liste est propre (sa passe saute les lignes qui gardent leur objet)
  async function propre(el: any) {
    el.fine()
    await tic()
    el.echanger()
    await tic()
  }
  const lignesAvis = () => avis.filter((a) => /sans passer par MJS|without going through MJS/.test(a))

  it('objet d\'un magasin écrit par un autre composant, puis échange : la ligne montre l\'écriture, sans avertissement', async () => {
    µ.store.items = [1, 2, 3, 4, 5, 6].map((i) => ({ id: i, label: 'm' + i }))
    await tic()
    const el = hote('mag-liste')
    el.prendre()
    await tic()
    await propre(el)
    hote('mag-ecrit').ecrire()
    await tic()
    el.echanger()
    await tic()
    assert.deepEqual(textes(el, 'i'), ['m1', 'm2', 'm3 F', 'm4 M', 'm5', 'm6'])
    assert.deepEqual(lignesAvis(), [])
  })

  it('enfant lié par une prop à deux sens qui écrit un champ, puis échange chez le parent : la ligne montre l\'écriture', async () => {
    const el = hote('parent-lie')
    el.poser()
    await tic()
    await propre(el)
    el.choisir()
    await tic()
    ombre(el).querySelector('mjs-fiche-liee').ecrire()
    await tic()
    el.echanger()
    await tic()
    assert.deepEqual(textes(el, 'i'), ['r1', 'r2', 'r3 F', 'r4 C', 'r5', 'r6'])
    assert.deepEqual(lignesAvis(), [])
  })

  it('deux composants qui tiennent le même tableau : l\'écriture de l\'un se voit à la passe suivante de l\'autre', async () => {
    win.__partage = [1, 2, 3, 4, 5, 6].map((i) => ({ id: i, label: 'p' + i }))
    const a = hote('comp-a'), b = hote('comp-b')
    a.prendre()
    b.prendre()
    await tic()
    await propre(a)
    b.ecrire()
    await tic()
    a.echanger()
    await tic()
    assert.deepEqual(textes(a, 'i'), ['p1', 'p2', 'p3 F', 'p4 B', 'p5', 'p6'])
    assert.deepEqual(lignesAvis(), [])
  })

  it('composant retiré dans le tour d\'une écriture fine, puis remis : la ligne montre l\'écriture', async () => {
    const el = hote('part')
    el.poser()
    await tic()
    await propre(el)
    el.partir()
    await tic()
    win.document.getElementById('h').append(el)
    await tic()
    el.echanger()
    await tic()
    assert.deepEqual(textes(el, 'i'), ['r1!', 'r2', 'r3 F', 'r4', 'r5', 'r6'])
  })

  it('clé en double dans une liste propre : pas d\'avertissement de ligne changée hors de MJS', async () => {
    const el = hote('doublon')
    el.poser()
    await tic()
    await propre(el)
    el.doubler()
    await tic()
    el.echanger()
    await tic()
    el.echanger()
    await tic()
    assert.deepEqual(lignesAvis(), [])
  })

  it('construction de développement d\'une liste qui a sa table, avec µafter : aucune erreur', async () => {
    const root = mjsTmp('fine-lignes-propres-minuterie')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'minuterie.mjs'), js([...BASE, "µafter(10, () => { $data[0].label += '!'; });"], [LISTE]))
    const bundler = new Bundler({ sourceDir: join(root, 'src'), outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js') })
    const stats = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  })
})
