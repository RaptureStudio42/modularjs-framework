// La redite des liaisons d'une variable (l'enfant qui reçoit de nouveau l'objet qu'il tient est prévenu quand même) sert deux choses :
// l'écriture par un nom dont la remontée se replie, que seule l'enveloppe connaît, et `µrefresh`. Sans l'enveloppe (réglage
// `"proxy": false`), une appli de production qui n'écrit pas `µrefresh` n'en porte donc rien ; dès qu'une unité écrit la rune, ou avec
// l'enveloppe, elle est au cœur. Et sans elle rien ne change : l'enfant suit l'écriture directe. Cœur construit, monté dans happy-dom
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const tic = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)) }
const js  = (script: string[], gabarit: string) => ['<script lang="js">', ...script.map((l) => '  ' + l), '</script>', gabarit].join('\n')
const ENFANT = js(['$item = null;'], '<em>{$item ? $item.x : "-"}</em>')
const PARENT = (geste: string) => js(['const brut = { a: { x: 1 } };', '$o = brut;', '@direct = function() { $o.a.x += 1; };', geste], '<@rd-enf item={$o.a}></@rd-enf>')
const APPLIS: Record<string, [Record<string, string>, any, boolean]> = {
  'sans enveloppe, sans µrefresh': [{ 'rd-enf.mjs': ENFANT, 'rd-par.mjs': PARENT('@dehors = function() { brut.a.x = 9; };') }, { proxy: false }, false],
  'sans enveloppe, avec µrefresh': [{ 'rd-enf.mjs': ENFANT, 'rd-par.mjs': PARENT('@dehors = function() { brut.a.x = 9; µrefresh($o); };') }, { proxy: false }, true],
  'avec l\'enveloppe, sans µrefresh': [{ 'rd-enf.mjs': ENFANT, 'rd-par.mjs': PARENT('@dehors = function() { brut.a.x = 9; };') }, {}, true],
}
const ombre = (el: any) => el._shadow || el.shadowRoot || el

describe('redite des liaisons : au cœur de production seulement pour l\'appli qui s\'en sert', function () {
  this.timeout(120000)
  const fenetres: any[] = []

  after(async () => {
    for (const w of fenetres) w.close?.()
    await terminateSharedWorkerPool()
  })

  for (const [nom, [sources, opts, attendue]] of Object.entries(APPLIS)) it(`${nom} : la redite ${attendue ? 'est au cœur' : 'n\'est pas au cœur'}, l'enfant suit l'écriture directe`, async () => {
    const root   = mjsTmp('redite-au-coeur')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [f, s] of Object.entries(sources)) writeFileSync(join(srcDir, f), s)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), minify: false, env: 'prod', ...opts } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b))
    const code  = files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    assert.equal(/function _mjsRetold\(|function _mjsRetell\(|_mjs_retold\b|_mjs_rdp\b/.test(code), attendue, attendue ? 'la redite manque au cœur' : 'la redite est restée au cœur')
    const win: any = new Window({ url: 'http://localhost/' })
    fenetres.push(win)
    win.eval(`${code}\nglobalThis.µ = µ;`)
    win.document.body.innerHTML = '<mjs-rd-par></mjs-rd-par>'
    await tic()
    const el  = win.document.querySelector('mjs-rd-par')
    const vu  = () => ombre(ombre(el).querySelector('mjs-rd-enf')).querySelector('em').textContent
    assert.equal(vu(), '1')
    el.direct()
    await tic()
    assert.equal(vu(), '2')
    if (opts.proxy === false && attendue) {
      el.dehors()
      await tic()
      assert.equal(vu(), '9', 'µrefresh($o) rafraîchit l\'enfant qui tient `$o.a`')
    }
  })
})
