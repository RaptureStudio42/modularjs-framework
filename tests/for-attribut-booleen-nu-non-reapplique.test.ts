// {for} — un attribut booléen HTML5 nu (`checked`, `disabled`, `selected`…)
// ne pose que la valeur INITIALE d'une ligne, jamais rejouée ensuite — comme
// un attribut HTML ordinaire (l'attribut = valeur par défaut).
//
// Le parseur réécrit cet attribut nu en liaison `dynamic` littérale `true`
// (parser/index.ts, même chemin de génération que `checked={true}`, cf.
// tests/native-boolean-attr-shorthand.test.ts) pour que le générateur ne le
// jette plus en silence. Mais dans une `{for}`, la boucle est "always-run" :
// TOUT le code d'une ligne est rejoué à chaque réconciliation, sans le
// filtrage par variable du root — une constante `true` reposée à chaque
// passage écrasait la sélection faite par l'utilisateur sur cette ligne, et
// par ricochet natif (même `name` de radio), décochait un radio totalement
// étranger à la liste.
//
// Une vraie liaison (`checked={$x}`, `checked=!{$x}`) garde son comportement
// (rejouée à chaque réconciliation) : seule une expression CONSTANTE change.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { renderToString } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const stripEsm = (s: string): string => s
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
  .replace(/\bexport\s+default\s+/g, '')
  .replace(/\bexport\s+/g, '')
  .replace(/import\.meta\.url/g, "'http://localhost/'")

async function build(files: Record<string, string>, tag: string): Promise<string> {
  const root   = mjsTmp('for-bool-nu-' + tag)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [rel, content] of Object.entries(files)) writeFileSync(join(srcDir, rel), content)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return outDir
}

function mountAll(outDir: string, hostTag: string) {
  const win: any      = new Window({ url: 'http://localhost/' })
  const document: any = win.document
  const files    = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const coreFile = files.find((f) => /^mjs_core-/.test(f))!
  const code = files
    .filter((f) => f !== coreFile)
    .reduce((acc, f) => acc + '\n' + stripEsm(readFileSync(join(outDir, f), 'utf-8')), stripEsm(readFileSync(join(outDir, coreFile), 'utf-8')))
  win.eval(`${code}\nglobalThis.µ = µ;`)
  document.body.innerHTML = `<${hostTag}></${hostTag}>`
  return { win, document, el: document.body.firstElementChild }
}

const tick  = () => new Promise((r) => setTimeout(r, 0))
const ticks = async (n = 2) => { for (let i = 0; i < n; i++) await tick() }

describe('{for} — un attribut booléen HTML5 nu ne pose que la valeur initiale d\'une ligne', function () {
  this.timeout(40000)
  after(async () => { await terminateSharedWorkerPool() })

  it('case à cocher décochée par l\'utilisateur : une AUTRE ligne change de label → elle reste décochée', async () => {
    const HOTE = [
      '<script lang="coffee">',
      '$rows = [',
      '  { id: 1, label: \'A\' }',
      '  { id: 2, label: \'B\' }',
      '  { id: 3, label: \'C\' }',
      ']',
      'changeOtherLabel = -> $rows[1].label = \'B-modifie\'',
      '</script>',
      '<div>',
      '  {for row in $rows by id}',
      '    <section class="row" data-id="{row.id}">',
      '      <input type="checkbox" class="chk" checked />',
      '      <span class="lbl">{row.label}</span>',
      '    </section>',
      '  {end}',
      '</div>',
      '<button id="btnChange" @click={changeOtherLabel}>change</button>',
    ].join('\n')

    const outDir = await build({ 'hotechk.mjs': HOTE }, 'chk')
    const { win, el } = mountAll(outDir, 'mjs-hotechk')
    await ticks()
    const shadow = el._shadow || el.shadowRoot
    const row1: any = shadow.querySelector('section.row[data-id="1"]')
    const chk1: any = row1.querySelector('input.chk')
    assert.equal(chk1.checked, true, 'case cochée par défaut (attribut nu)')

    chk1.checked = false // l'utilisateur décoche la ligne 1

    shadow.querySelector('#btnChange').dispatchEvent(new win.Event('click', { bubbles: true }))
    await ticks()

    assert.equal(shadow.querySelector('section.row[data-id="2"] span.lbl').textContent, 'B-modifie',
      'la réconciliation a bien eu lieu (vérification du déclencheur)')
    assert.equal(chk1.checked, false,
      'AVANT le fix : la case décochée par l\'utilisateur était recochée par la simple réconciliation d\'une AUTRE ligne')

    win.close?.()
  })

  it('radio HORS de la boucle : coché par l\'utilisateur, une ligne de la liste change de label → il reste coché', async () => {
    const HOTE = [
      '<script lang="coffee">',
      '$rows = [',
      '  { id: 1, label: \'A\' }',
      '  { id: 2, label: \'B\' }',
      '  { id: 3, label: \'C\' }',
      ']',
      'changeLabel = -> $rows[0].label = \'A-modifie\'',
      '</script>',
      '<div>',
      '  <input type="radio" name="pick" id="master" checked />',
      '  {for row in $rows by id}',
      '    <section class="row" data-id="{row.id}">',
      '      <input type="radio" name="pick" class="ra" checked />',
      '      <span class="lbl">{row.label}</span>',
      '    </section>',
      '  {end}',
      '</div>',
      '<button id="btnChange" @click={changeLabel}>change</button>',
    ].join('\n')

    const outDir = await build({ 'hoteradio.mjs': HOTE }, 'radio')
    const { win, el } = mountAll(outDir, 'mjs-hoteradio')
    await ticks()
    const shadow = el._shadow || el.shadowRoot
    const master: any = shadow.querySelector('#master')

    master.checked = true // l'utilisateur choisit le radio HORS boucle

    shadow.querySelector('#btnChange').dispatchEvent(new win.Event('click', { bubbles: true }))
    await ticks()

    assert.equal(shadow.querySelector('section.row[data-id="1"] span.lbl').textContent, 'A-modifie',
      'la réconciliation a bien eu lieu (vérification du déclencheur)')
    assert.equal(master.checked, true,
      'AVANT le fix : un radio nu DANS la boucle repose "checked" à chaque réconciliation et décoche par ricochet ce radio pourtant hors de la liste')

    win.close?.()
  })

  it('non-régression {if} : une case reste dans l\'état choisi par l\'utilisateur quand une var étrangère à la condition mute', async () => {
    const HOTE = [
      '<script lang="coffee">',
      '$show = true',
      '$other = 1',
      'bump = -> $other = $other + 1',
      '</script>',
      '{if $show}',
      '  <input type="checkbox" class="chk" checked />',
      '{end}',
      '<span class="cnt">{$other}</span>',
      '<button id="btnBump" @click={bump}>bump</button>',
    ].join('\n')

    const outDir = await build({ 'hoteif.mjs': HOTE }, 'if')
    const { win, el } = mountAll(outDir, 'mjs-hoteif')
    await ticks()
    const shadow = el._shadow || el.shadowRoot
    const chk: any = shadow.querySelector('input.chk')
    assert.equal(chk.checked, true)
    chk.checked = false // l'utilisateur décoche

    shadow.querySelector('#btnBump').dispatchEvent(new win.Event('click', { bubbles: true }))
    await ticks()

    assert.equal(shadow.querySelector('span.cnt').textContent, '2',
      'la réconciliation a bien eu lieu (vérification du déclencheur)')
    assert.equal(chk.checked, false,
      'un {if} ne rejoue pas l\'attribut nu sur une var étrangère à sa condition (déjà correct, non-régression)')

    win.close?.()
  })

  it('non-régression {await} : une case reste dans l\'état choisi par l\'utilisateur quand une var étrangère mute dans la branche résolue', async () => {
    const HOTE = [
      '<script lang="coffee">',
      '$p = new Promise((resolve) -> resolve(true))',
      '$other = 1',
      'bump = -> $other = $other + 1',
      '</script>',
      '{await $p}{success ok}',
      '  <input type="checkbox" class="chk" checked />',
      '{end}',
      '<span class="cnt">{$other}</span>',
      '<button id="btnBump" @click={bump}>bump</button>',
    ].join('\n')

    const outDir = await build({ 'hoteawait.mjs': HOTE }, 'await')
    const { win, el } = mountAll(outDir, 'mjs-hoteawait')
    await ticks(6)
    const shadow = el._shadow || el.shadowRoot
    const chk: any = shadow.querySelector('input.chk')
    assert.ok(chk, 'la branche success a bien créé la case')
    assert.equal(chk.checked, true)
    chk.checked = false // l'utilisateur décoche

    shadow.querySelector('#btnBump').dispatchEvent(new win.Event('click', { bubbles: true }))
    await ticks()

    assert.equal(shadow.querySelector('span.cnt').textContent, '2',
      'la réconciliation a bien eu lieu (vérification du déclencheur)')
    assert.equal(chk.checked, false,
      'un {await} résolu ne rejoue pas l\'attribut nu sur une var étrangère (déjà correct, non-régression)')

    win.close?.()
  })

  it('rendu serveur : l\'attribut nu d\'une ligne de {for} survit au SSR (chaque ligne porte "checked")', async () => {
    const root   = mjsTmp('for-bool-nu-ssr')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'ssrfor.mjs'), [
      '<script lang="coffee">',
      '$rows = [ { id: 1 }, { id: 2 } ]',
      '</script>',
      '<ul>',
      '  {for row in $rows by id}',
      '    <li><input type="checkbox" checked /></li>',
      '  {end}',
      '</ul>',
    ].join('\n'))

    const res = await renderToString({ sourceDir: srcDir, tag: 'mjs-ssrfor' })
    const occurrences = res.shadowHtml.match(/<input[^>]*\bchecked\b[^>]*>/g) ?? []
    assert.equal(occurrences.length, 2, `les 2 lignes doivent porter l'attribut "checked" — HTML produit : ${res.shadowHtml}`)
  })
})
