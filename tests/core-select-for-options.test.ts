// module cœur select alimenté par un `{for}` : des options qui arrivent APRÈS la construction,
// des valeurs numériques, `multiple={false}`, des options sans valeur.
//
// Pannes relevées dans une application (paquet 2.4.3) : un `<@select value=!{$x}>` dont les
// `<@option value={m.id}>` venaient d'un `{for}` affichait « Camille, Alex » après un clic, comme
// un choix multiple, et la variable liée ne recevait rien d'utile. Cause : le premier relevé des
// options lisait leurs attributs AVANT qu'elles les aient posés — toutes les valeurs valaient
// null, et `null == null` cochait tout. Le relevé suit désormais les attributs des options ;
// restaient, et ce fichier les verrouille :
//   · la valeur relue en TEXTE (`getAttribute`) : `18` remontait « 18 » dans la variable liée ;
//   · une valeur vide (null) cochait toutes les options sans valeur ;
//   · deux options de même valeur s'affichaient ensemble en choix simple ;
//   · sous happy-dom, un `{for}` vide puis rempli ne posait que sa PREMIÈRE ligne dans le select
//     (le `slotchange` y est synchrone : le rendu du select, déclenché pendant l'insertion,
//     reprenait le fragment partagé du `{for}` hôte et emportait les lignes suivantes).
// `multiple={false}` arrive bien en booléen : ce n'était pas la cause, le test le garde.

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

const HOST = [
  '<script>',
  '$membres = []',
  '$choix   = null',
  '$choixb  = 18',
  '@charger = -> $membres = [{id: 17, name: "Camille"}, {id: 18, name: "Alex"}]',
  '</script>',
  '<div id="a"><@select value=!{$choix} multiple={false} placeholder="Choisir">',
  '  {for m in $membres by id}',
  '    <@option value={m.id}>{m.name}</@option>',
  '  {end}',
  '</@select></div>',
  '<div id="b"><@select value=!{$choixb}>',
  '  {for m in $membres by id}',
  '    <@option value={m.id}>{m.name}</@option>',
  '  {end}',
  '</@select></div>',
  '<div id="c"><@select placeholder="Aucun">',
  '  <@option>Sans valeur 1</@option>',
  '  <@option>Sans valeur 2</@option>',
  '</@select></div>',
  '<div id="d"><@select>',
  '  <@option value="x">Premier</@option>',
  '  <@option value="x">Doublon</@option>',
  '</@select></div>',
  '<button class="charger" @click={@charger()}>charger</button>',
].join('\n')

async function buildAndMount(): Promise<{ window: any; hote: any }> {
  const root   = mjsTmp('core-select-for')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hote.mjs'), HOST)

  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))

  const files = readdirSync(outDir)
  const pick = (re: RegExp) => {
    const f = files.find((f) => re.test(f))
    assert.ok(f, `chunk attendu ${re} parmi ${files.join(', ')}`)
    return f!
  }
  const code = [pick(/^mjs_core-/), pick(/^select-/), pick(/^option-/), pick(/^hote-/)]
    .map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8')))
    .join('\n')

  const window: any   = new Window({ url: 'http://localhost/' })
  const document: any = window.document
  window.eval(`${code}\nglobalThis.µ = µ;`)
  document.body.innerHTML = '<mjs-hote></mjs-hote>'
  await new Promise((r) => setTimeout(r, 80))
  const hote = document.body.querySelector('mjs-hote')
  return { window, hote }
}

function click(win: any, el: any) {
  el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true, composed: true }))
}

async function tick(ms = 40) {
  await new Promise((r) => setTimeout(r, ms))
}

describe('mjs-select — options venues d\'un {for}, valeurs typées, choix simple', function () {
  this.timeout(30000)
  after(async () => { await terminateSharedWorkerPool() })

  let window: any, hote: any
  const sel     = (id: string) => hote._shadow.querySelector(`#${id} mjs-select`)
  const libelle = (id: string) => sel(id)._shadow.querySelector('.select-label').textContent.trim()
  const lignes  = (id: string) => sel(id)._shadow.querySelectorAll('.select-option')

  before(async () => {
    ({ window, hote } = await buildAndMount())
  })

  it('options sans valeur et valeur vide : le placeholder, jamais toutes les options cochées', () => {
    assert.equal(libelle('c'), 'Aucun')
  })

  it('une option sans valeur prend son libellé pour valeur, comme une <option> native', async () => {
    click(window, sel('c')._shadow.querySelector('.select-btn'))
    await tick()
    click(window, lignes('c')[1])
    await tick()
    assert.equal(sel('c')._state.value, 'Sans valeur 2')
    assert.equal(libelle('c'), 'Sans valeur 2')
  })

  it('deux options de même valeur en choix simple : un seul libellé sur le bouton', async () => {
    click(window, sel('d')._shadow.querySelector('.select-btn'))
    await tick()
    click(window, lignes('d')[0])
    await tick()
    assert.equal(libelle('d'), 'Premier')
  })

  it('des options arrivées APRÈS la construction ({for} vide puis rempli) : toutes posées et listées', async () => {
    click(window, hote._shadow.querySelector('.charger'))
    await tick(120)
    assert.equal(sel('a').querySelectorAll('mjs-option').length, 2, 'les deux <mjs-option> dans le select')
    click(window, sel('a')._shadow.querySelector('.select-btn'))
    await tick()
    assert.equal(lignes('a').length, 2, 'les deux lignes dans le panneau')
  })

  it('la valeur garde son type : choisir Alex remonte le NOMBRE 18 dans la variable liée', async () => {
    click(window, lignes('a')[1])
    await tick()
    assert.strictEqual(sel('a')._state.value, 18)
    assert.strictEqual(hote._state.choix, 18)
    assert.equal(libelle('a'), 'Alex')
  })

  it('multiple={false} reste un choix simple : panneau refermé, un seul libellé, la nouvelle valeur remplace l\'ancienne', async () => {
    assert.equal(sel('a')._state.open, false)
    click(window, sel('a')._shadow.querySelector('.select-btn'))
    await tick()
    click(window, lignes('a')[0])
    await tick()
    assert.equal(sel('a')._state.open, false)
    assert.equal(libelle('a'), 'Camille')
    assert.strictEqual(hote._state.choix, 17)
  })

  it('une valeur posée AVANT l\'arrivée des options : le bouton affiche son libellé dès qu\'elles arrivent, sans ouvrir le panneau', () => {
    assert.equal(sel('b')._state.open, false)
    assert.equal(libelle('b'), 'Alex')
  })
})
