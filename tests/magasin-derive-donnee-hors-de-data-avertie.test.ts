// Un magasin dérivé de `µ.Store` qui range sa donnée dans un champ à lui (`this.state = { rows: […] }`) et laisse `.data` vide : le
// développement le dit, une fois, dans toute appli qui a un `µ.Store` — le cas seul dans son appli, sans aucune autre liste. Rien n'est
// dit pour un champ qui tient un `µ.state` (l'écran suit), un champ `_…`, une `Map`, l'objet d'une classe, ni quand `.data` tient la
// donnée ; rien en production. Cœur construit, monté dans happy-dom
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const tic = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) }
const js  = (script: string[], gabarit: string) => ['<script lang="js">', ...script.map((l) => '  ' + l), '</script>', gabarit].join('\n')
// une appli par jeu : le cas seul, puis les champs qui ne doivent rien dire
const JEUX: Record<string, Record<string, string>> = {
  seul: {
    'zm-panier': js(['class Panier extends µ.Store { constructor() { super(); this.state = { rows: [{ id: 1, n: 1 }, { id: 2, n: 2 }] }; } }', 'const p = new Panier();', '@ecrire = function(v) { p.state.rows[1].n = v; };'], '{for r in p.state.rows by id}<i>{r.n}</i>{end}'),
  },
  muets: {
    'zm-etat':   js(['class AvecEtat extends µ.Store { constructor() { super(); this.ui = µ.state({ ouvert: false }); } }', 'const u = new AvecEtat();', '@basculer = function() { u.ui.ouvert = true; };'], "<p>{u.ui.ouvert ? 'oui' : 'non'}</p>"),
    'zm-outils': js(['class Api {}', 'class Outils extends µ.Store { constructor() { super(); this._cache = { a: 1 }; this.index = new Map(); this.api = new Api(); } }', 'const o = new Outils();'], '<p>o</p>'),
    'zm-data':   js(['class AvecData extends µ.Store { constructor() { super({ rows: [] }); this.reglages = { a: 1 }; } }', 'const d = new AvecData();'], '<p>d</p>'),
  },
}
const REGLAGES: Array<[string, any]> = [['développement', {}], ['développement sans enveloppe', { proxy: false }], ['production', { env: 'prod' }]]
const ombre    = (el: any) => el._shadow || el.shadowRoot || el

for (const [nom, opts] of REGLAGES) describe(`magasin dérivé dont la donnée est rangée hors de .data (${nom})`, function () {
  this.timeout(240000)
  const codes: Record<string, string> = {}
  const fenetres: any[] = []
  before(async () => {
    for (const [jeu, sources] of Object.entries(JEUX)) {
      const root = mjsTmp('magasin-derive-' + jeu), srcDir = join(root, 'src'), outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      for (const [f, s] of Object.entries(sources)) writeFileSync(join(srcDir, f + '.mjs'), s)
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), minify: false, ...opts } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      const rang = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
      codes[jeu] = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    }
  })
  after(async () => {
    for (const w of fenetres) w.close?.()
    await terminateSharedWorkerPool()
  })
  // monte les balises du jeu une à une, les avis du développement relevés
  const monter = async (jeu: string) => {
    const win: any = new Window({ url: 'http://localhost/' })
    fenetres.push(win)
    win.eval(`${codes[jeu]}\nglobalThis.µ = µ;`)
    const avis = [] as string[]
    win.µ.warn = (...a: any[]) => { avis.push(a.map(String).join(' ')) }
    for (const b of Object.keys(JEUX[jeu])) {
      win.document.body.insertAdjacentHTML('beforeend', `<mjs-${b}></mjs-${b}>`)
      await tic()
    }
    return { win, avis }
  }
  const dev = !opts.env
  it(dev ? 'le cas seul dans son appli : le développement dit, une fois, que `this.state` n\'est pas suivi et nomme `.data`' : 'le cas seul dans son appli : rien n\'est dit en production', async () => {
    const { win, avis } = await monter('seul')
    win.document.querySelector('mjs-zm-panier').ecrire(7)
    await tic()
    assert.equal(avis.filter((a) => /this\.state/.test(a) && /\.data/.test(a)).length, dev ? 1 : 0, avis.join('\n'))
  })
  it('un champ qui tient un `µ.state`, un champ `_…`, une `Map`, l\'objet d\'une classe, `.data` qui tient la donnée : rien n\'est dit, l\'écran du `µ.state` suit', async () => {
    const { win, avis } = await monter('muets')
    const el = win.document.querySelector('mjs-zm-etat')
    el.basculer()
    await tic()
    assert.deepEqual(avis.filter((a) => /\.data/.test(a)), [])
    assert.equal(ombre(el).querySelector('p').textContent, 'oui')
  })
})
