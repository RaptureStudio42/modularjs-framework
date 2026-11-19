// `µrefresh($o)` dans le parent et l'enfant qui tient une partie de `$o` : l'enfant qui a changé d'objet (`item={$o[$k]}`, puis
// `$k = 'b'`) est prévenu d'un changement fait hors de MJS dans son nouvel objet, quel que soit le compte de rafraîchissements de
// l'ancien ; le parcours de `$o` ne lit que des champs de données — un accesseur de l'appli (`get total()`) n'est jamais appelé, ni
// son exception levée par `µrefresh` ; l'objet qu'un parent a déplacé sous un autre conteneur puis écrit par un nom, signalé par
// `µrefresh($o)`, redessine l'enfant qui tient le nouveau conteneur. Quatre réglages : développement et production, avec et sans
// enveloppe. Cœur construit, monté dans happy-dom
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const tic = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)) }
const js  = (script: string[], gabarit: string) => ['<script lang="js">', ...script.map((l) => '  ' + l), '</script>', gabarit].join('\n')
const RAF = '@rafraichir = function() { µrefresh($o); };'

const SOURCES: Record<string, string> = {
  'rc-json.mjs':    js(['$item = null;'], '<em>{JSON.stringify($item)}</em>'),
  // l'enfant tient `$o.a`, puis `$o.b` ; `garde.b.v` changé hors de MJS
  'rc-bascule.mjs': js(['const garde = { a: { v: 1 }, b: { v: 2 } };', '$o = garde;', '$k = "a";', '@basculer = function() { $k = "b"; };', '@dehors = function(v) { garde.b.v = v; };', RAF], '<@rc-json item={$o[$k]}></@rc-json>'),
  // accesseurs propres de `$o` : l'un compte ses lectures, l'autre lève
  'rc-acces.mjs':   js(['window.__read = 0;', '$o = { a: { c: 0 }, get total() { window.__read++; return 1; }, get boum() { throw new Error("accesseur"); } };', RAF], '<@rc-json item={$o.a}></@rc-json>'),
  // objet déplacé sous le conteneur que tient l'enfant, puis écrit par le nom gardé
  'rc-deplace.mjs': js(['let x = null;', '$o = { a: { b: { c: 0 } }, z: { w: 0 } };', '@deplacer = function() { x = $o.a.b; $o.z.m = x; delete $o.a.b; };', '@ecrire = function(v) { x.c = v; };', RAF], '<@rc-json item={$o.z}></@rc-json>'),
}

const REGLAGES: Array<[string, any]> = [['développement', {}], ['production', { env: 'prod' }], ['production sans enveloppe', { env: 'prod', proxy: false }], ['développement sans enveloppe', { proxy: false }]]
const ombre = (el: any) => el._shadow || el.shadowRoot || el

for (const [nom, opts] of REGLAGES) describe(`µrefresh($o) et l'enfant qui tient une partie de $o : changement d'objet, accesseurs, objet déplacé (${nom})`, function () {
  this.timeout(120000)
  let code = ''
  const fenetres: any[] = []

  before(async () => {
    const root   = mjsTmp('prop-objet-tenu-rafraichi')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [f, s] of Object.entries(SOURCES)) writeFileSync(join(srcDir, f), s)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), minify: false, ...opts } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b))
    code = files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  })

  after(async () => {
    for (const w of fenetres) w.close?.()
    await terminateSharedWorkerPool()
  })

  async function appli(balise: string) {
    const win: any = new Window({ url: 'http://localhost/' })
    fenetres.push(win)
    win.eval(`${code}\nglobalThis.µ = µ;`)
    win.document.body.innerHTML = `<mjs-${balise}></mjs-${balise}>`
    await tic()
    const el    = win.document.querySelector('mjs-' + balise)
    const fiche = () => ombre(el).querySelector('mjs-rc-json')
    return { win, el, montre: () => ombre(fiche()).querySelector('em').textContent, tient: () => JSON.stringify(win.µ._mjs_toRaw(fiche()._state.item)) }
  }

  it('l\'enfant qui a changé d\'objet suit le changement fait hors de MJS dans le nouvel objet, signalé par µrefresh($o)', async () => {
    const { el, montre, tient } = await appli('rc-bascule')
    el.rafraichir()
    await tic()
    el.basculer()
    await tic()
    assert.equal(montre(), '{"v":2}')
    el.dehors(7)
    el.rafraichir()
    await tic()
    assert.equal(tient(), '{"v":7}')
    assert.equal(montre(), '{"v":7}', 'l\'enfant garde l\'écran de son objet d\'avant le changement')
  })

  it('µrefresh($o) n\'appelle aucun accesseur de l\'appli et ne lève pas son exception', async () => {
    const { win, el, montre } = await appli('rc-acces')
    const lu = win.__read
    assert.doesNotThrow(() => { el.rafraichir(); el.rafraichir() })
    await tic()
    assert.equal(win.__read, lu, 'accesseur appelé par µrefresh')
    assert.equal(montre(), '{"c":0}')
  })

  it('objet déplacé sous le conteneur que tient l\'enfant, écrit par un nom puis signalé par µrefresh($o) : l\'enfant suit', async () => {
    const { el, montre, tient } = await appli('rc-deplace')
    el.deplacer()
    await tic()
    el.ecrire(5)
    el.rafraichir()
    await tic()
    assert.equal(tient(), '{"w":0,"m":{"c":5}}')
    assert.equal(montre(), tient())
  })
})
