// Un objet rangé dans plus de huit conteneurs d'un état partagé (`µ.state`) ou d'un magasin (`new µ.Store(…).data`) ne se suit plus lien
// par lien : la remontée d'une écriture faite par un nom (`t = st.rows[0].x; t.c = v`) ne répond plus de tous les conteneurs et se replie.
// L'enfant qui tient l'un de ces conteneurs (une ligne, donnée hors d'une boucle) suit quand même : ses abonnés redisent leurs liaisons, jamais un écran figé. Les
// quatre réglages rendent le même écran. Cœur construit, monté dans happy-dom
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const tic = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) }
const js  = (script: string[], gabarit: string) => ['<script lang="js">', ...script.map((l) => '  ' + l), '</script>', gabarit].join('\n')
const DONNEES = '{ rows: Array.from({ length: 10 }, (_, i) => ({ id: i, x: commun })) }'
const GESTES  = ['const commun = { c: 0 };', '@nom = function(v) { const t = st.rows[0].x; t.c = v; };', '@autre = function(v) { const t = st.rows[9].x; t.c = v; };']
const GABARIT = '{for r in st.rows by id}<i>{r.x.c}</i>{end}' + Array.from({ length: 10 }, (_, i) => '<@ze-vue item={st.rows[' + i + ']}></@ze-vue>').join('')
const SOURCES: Record<string, string> = {
  'ze-vue.mjs':     js(['$item = null;'], '<em>{JSON.stringify($item)}</em>'),
  'ze-etat.mjs':    js([GESTES[0], 'const st = µ.state(' + DONNEES + ');', ...GESTES.slice(1)], GABARIT),
  'ze-magasin.mjs': js([GESTES[0], 'const st = new µ.Store(' + DONNEES + ').data;', ...GESTES.slice(1)], GABARIT),
}
const REGLAGES: Array<[string, any]> = [['développement', {}], ['production', { env: 'prod' }], ['production sans enveloppe', { env: 'prod', proxy: false }], ['développement sans enveloppe', { proxy: false }]]
const ombre = (el: any) => el._shadow || el.shadowRoot || el

for (const [nom, opts] of REGLAGES) describe(`objet rangé dans dix conteneurs, écrit par un nom : la remontée se replie (${nom})`, function () {
  this.timeout(120000)
  let code = ''
  const fenetres: any[] = []
  before(async () => {
    const root = mjsTmp('prop-objet-repli'), srcDir = join(root, 'src'), outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [f, s] of Object.entries(SOURCES)) writeFileSync(join(srcDir, f), s)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), minify: false, ...opts } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const rang = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    code = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  })
  after(async () => {
    for (const w of fenetres) w.close?.()
    await terminateSharedWorkerPool()
  })
  for (const balise of ['ze-etat', 'ze-magasin']) it(`${balise} : l'enfant montre ce qu'il tient après chaque écriture`, async () => {
    const win: any = new Window({ url: 'http://localhost/' })
    fenetres.push(win)
    win.eval(`${code}\nglobalThis.µ = µ;`)
    win.__avis = []
    win.µ.warn = (...a: any[]) => { win.__avis.push(a.join(' ')) }
    win.document.body.innerHTML = `<mjs-${balise}></mjs-${balise}>`
    await tic()
    const el     = win.document.querySelector('mjs-' + balise)
    const ecarts = [] as string[]
    let v = 0
    for (const geste of ['nom', 'autre', 'nom']) {
      el[geste](++v)
      await tic()
      const vues = (Array.from(ombre(el).querySelectorAll('*')) as any[]).filter((c) => c.tagName === 'MJS-ZE-VUE')
      vues.forEach((k: any, i: number) => {
        const tenu   = JSON.stringify(win.µ._mjs_toRaw(k._state.item))
        const montre = ombre(k).querySelector('em').textContent
        if (!montre.includes('"c":' + v)) ecarts.push(`${geste}(${v}) : l'enfant ${i} montre ${montre}`)
        if (montre !== tenu) ecarts.push(`${geste}(${v}) : l'enfant ${i} montre ${montre}, il tient ${tenu}`)
      })
    }
    assert.equal(ecarts.length === 0 ? (Array.from(ombre(el).querySelectorAll('*')) as any[]).filter((c) => c.tagName === 'MJS-ZE-VUE').length : 10, 10, 'dix enfants')
    assert.deepEqual(ecarts, [])
    assert.deepEqual([...win.__avis], [], 'aucun avertissement')
  })
})
