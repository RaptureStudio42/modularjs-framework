// Dans un {for}, un gestionnaire retrouve SA ligne par l'index que le moteur pose sur la balise
// qui le porte. Garde d'un défaut déjà corrigé : un nom d'événement qui COMMENCE par celui d'une
// directive (`@input` par `@in`, `@invalid`, `@transitionend` par `@transition`) passait pour cette
// directive, l'index n'était pas posé, et le gestionnaire agissait en silence sur la PREMIÈRE ligne
// (un champ imbriqué, une liste sous {if}…{else} : les cas où on le voyait). Ce test échoue si la
// confusion revient.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const LISTE = [
  '<script>',
  '$edit = true',
  '$liste = [{ k: \'a\', v: \'A\' }, { k: \'b\', v: \'B\' }, { k: \'c\', v: \'C\' }]',
  '$pris = \'\'',
  'choisir = (x) -> $pris = x.k',
  '</script>',
  '<button class="t" @click={$edit = !$edit}>t</button>',
  '{if $edit}',
  '  {for x in $liste}',
  '    <div><label>{x.k} <input class="i{x.k}" @input={x.v = e.target.value} @invalid={x.v = \'!\'}></label></div>',
  '  {end}',
  '{else}',
  '  {for x in $liste}',
  '    <div><span><button class="b{x.k}" @click={choisir(x)}>{x.v}</button></span></div>',
  '  {end}',
  '{end}',
  '<p class="res">{$pris} {$liste.map((x) -> x.v).join(\',\')}</p>',
].join('\n')

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('{for} — un gestionnaire imbriqué agit sur SA ligne', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('for-index-ligne-gestionnaire-imbrique')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'liste-lignes.mjs'), LISTE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  it('@input / @invalid d\'un champ dans un <label>, liste sous {if}…{else} : la bonne ligne, avant et après bascule', async () => {
    window.document.body.innerHTML = '<mjs-liste-lignes></mjs-liste-lignes>'
    const comp = window.document.querySelector('mjs-liste-lignes')
    await attendre(() => !!comp._shadow?.querySelector('.ib'))
    const res   = () => comp._shadow.querySelector('.res').textContent
    const pause = () => new Promise((r) => setTimeout(r, 20))
    const saisir = async (sel: string, valeur: string) => {
      const champ = comp._shadow.querySelector(sel)
      champ.value = valeur
      champ.dispatchEvent(new window.Event('input', { bubbles: true, composed: true }))
      await pause()
    }
    await saisir('.ib', 'ZZ')
    assert.equal(res(), ' A,ZZ,C', '@input : la 2e ligne, pas la 1re')
    comp._shadow.querySelector('.ic').dispatchEvent(new window.Event('invalid'))
    await pause()
    assert.equal(res(), ' A,ZZ,!', '@invalid : la 3e ligne')
    comp._shadow.querySelector('.t').click()
    await pause()
    comp._shadow.querySelector('.bc').click()
    await pause()
    assert.equal(res(), 'c A,ZZ,!', 'liste du {else} : le clic sur la 3e ligne')
    comp._shadow.querySelector('.t').click()
    await pause()
    await saisir('.ic', 'YY')
    assert.equal(res(), 'c A,ZZ,YY', 'après deux bascules, toujours la bonne ligne')
  })
})
