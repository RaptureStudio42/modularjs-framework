// Un enfant qui tient un objet lu dans un magasin (`new µ.Store(…).data`) se redessine quand une écriture est faite plus bas que cet
// objet : par un nom qui en garde une partie (`t = st.o.a.b; t.c = v`), par le chemin entier (`st.o.a.b.c = v`), dans la ligne d'une
// liste, par une méthode de liste. Les objets d'un magasin sont toujours lus par leur enveloppe, avec ou sans le réglage `proxy: false` :
// les quatre réglages rendent le même écran. Cœur construit, monté dans happy-dom
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const tic = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) }
const js  = (script: string[], gabarit: string) => ['<script lang="js">', ...script.map((l) => '  ' + l), '</script>', gabarit].join('\n')
const DONNEES = '{ o: { a: { b: { c: 0 }, l: [] } }, rows: [{ id: 1, x: { c: 0 } }, { id: 2, x: { c: 0 } }] }'
const GESTES  = ['@nom = function(v) { const t = st.o.a.b; t.c = v; };', '@direct = function(v) { st.o.a.b.c = v; };', '@pousser = function(v) { const l = st.o.a.l; l.push(v); };', '@ligne = function(v) { const t = st.rows[1].x; t.c = v; };']
const GABARIT = '<p>{st.o.a.b.c} {st.rows[1].x.c}</p><@ze-vue item={st.o.a}></@ze-vue>{for r in st.rows by id}<@ze-vue item={r}></@ze-vue>{end}'
const SOURCES: Record<string, string> = {
  'ze-vue.mjs':     js(['$item = null;'], '<em>{JSON.stringify($item)}</em>'),
  'ze-magasin.mjs': js(['const st = new µ.Store(' + DONNEES + ').data;', ...GESTES], GABARIT),
}
const REGLAGES: Array<[string, any]> = [['développement', {}], ['production', { env: 'prod' }], ['production sans enveloppe', { env: 'prod', proxy: false }], ['développement sans enveloppe', { proxy: false }]]
const ombre = (el: any) => el._shadow || el.shadowRoot || el

for (const [nom, opts] of REGLAGES) describe(`objet d'un magasin tenu par un enfant, écrit plus bas (${nom})`, function () {
  this.timeout(120000)
  let code = ''
  const fenetres: any[] = []
  before(async () => {
    const root = mjsTmp('prop-objet-magasin'), srcDir = join(root, 'src'), outDir = join(root, 'out')
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
  for (const balise of ['ze-magasin']) it(`${balise} : l'enfant montre ce qu'il tient après chaque écriture`, async () => {
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
    for (const geste of ['nom', 'direct', 'pousser', 'ligne', 'nom', 'ligne']) {
      el[geste](++v)
      await tic()
      const vues = (Array.from(ombre(el).querySelectorAll('*')) as any[]).filter((c) => c.tagName === 'MJS-ZE-VUE')
      vues.forEach((k: any, i: number) => {
        const tenu   = JSON.stringify(win.µ._mjs_toRaw(k._state.item))
        const montre = ombre(k).querySelector('em').textContent
        if (montre !== tenu) ecarts.push(`${geste}(${v}) : l'enfant ${i} montre ${montre}, il tient ${tenu}`)
      })
    }
    assert.deepEqual(ecarts, [])
    assert.deepEqual([...win.__avis], [], 'aucun avertissement')
  })
})
