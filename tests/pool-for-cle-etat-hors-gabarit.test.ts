// Régression — {for … by clé} : le pool de lignes (actif par défaut dès qu'un
// composant n'a AUCUN hook destroy, cf. `_mjs_noDestroyHooks`) recyclait le
// sous-arbre DOM d'une ligne supprimée pour une AUTRE clé. Une clé sert
// justement à garantir l'IDENTITÉ d'une ligne : tout état qui vit hors du
// gabarit (valeur tapée dans un `<input>` non lié, compteur interne d'un
// composant enfant) traversait alors vers le nouvel occupant du slot poolé.
//
// Fix : `_mjs_mjsHasOwnState` (mjs_for.ts) scanne le sous-arbre d'une ligne
// avant de la pooler. Deux traitements distincts :
//  - un état OPAQUE (`[contenteditable]`, `<details>`, audio/vidéo, canvas,
//    iframe, élément personnalisé) interdit le recyclage : la ligne est
//    détruite pour de bon et une ligne neuve est créée pour la clé suivante ;
//  - un champ de formulaire (INPUT/TEXTAREA/SELECT) reste recyclé — le
//    navigateur garde nativement la valeur du gabarit (`defaultValue`/
//    `defaultChecked`/`option.defaultSelected`), restaurée UNE FOIS le
//    sous-arbre détaché du document (jamais avant : un `<input type=radio>`
//    encore connecté déclenche nativement le décochage de tout autre radio
//    du même `name` dans le même arbre, y compris un radio étranger à cette
//    ligne — la restauration attend donc le retrait du DOM), avant que les
//    liaisons de la nouvelle clé ne s'appliquent.
//
// Le DÉFILEMENT (`scrollTop` d'une `<div>` scrollable dans la ligne) n'entre
// dans aucune des deux familles ci-dessus et n'est remis à zéro par AUCUN
// code de ce fichier — sans fuite pour autant : retirer puis réinsérer un
// nœud du DOM remet NATIVEMENT son `scrollTop` à 0 dans un navigateur réel
// (vérifié Chromium, build réel + Playwright ; happy-dom ne simule pas cet
// effet de bord et ne peut donc pas servir de test ici).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'

const stripEsm = (s: string) => s
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
  .replace(/\bexport\s+default\s+/g, '')
  .replace(/\bexport\s+/g, '')
  .replace(/import\.meta\.url/g, "'http://localhost/'")

async function build(files: Record<string, string>, tag: string) {
  const root = mjsTmp('pool-state-' + tag)
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
  const win: any = new Window({ url: 'http://localhost/' })
  const document: any = win.document
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const coreFile = files.find((f) => /^mjs_core-/.test(f))!
  const code = files
    .filter((f) => f !== coreFile)
    .reduce((acc, f) => acc + '\n' + stripEsm(readFileSync(join(outDir, f), 'utf-8')), stripEsm(readFileSync(join(outDir, coreFile), 'utf-8')))
  win.eval(`${code}\nglobalThis.µ = µ;`)
  document.body.innerHTML = `<${hostTag}></${hostTag}>`
  return { win, document, el: document.body.firstElementChild }
}

describe('{for … by clé} — pool de lignes : la valeur d\'un champ de formulaire hors gabarit ne traverse jamais vers une autre clé', function () {
  this.timeout(40000)
  after(async () => { await terminateSharedWorkerPool() })

  it('input NON lié : id=2 supprimé puis id=4 ajouté → le nœud est RECYCLÉ mais son contenu est VIERGE (pas le texte tapé pour id=2)', async () => {
    const HOTE = [
      '<script lang="coffee">',
      '$rows = [',
      '  { id: 1, label: \'A\' }',
      '  { id: 2, label: \'B\' }',
      '  { id: 3, label: \'C\' }',
      ']',
      'removeRow2 = -> $rows.splice(1, 1)',
      'insertRow4 = -> $rows.splice(1, 0, { id: 4, label: \'D\' })',
      '</script>',
      '<div>',
      '  {for row in $rows by id}',
      '    <section class="row" data-id="{row.id}">',
      '      <input class="inp" />',
      '      <span class="lbl">{row.label}</span>',
      '    </section>',
      '  {end}',
      '</div>',
      '<button id="btnRemove" @click={removeRow2}>remove</button>',
      '<button id="btnInsert" @click={insertRow4}>insert</button>',
    ].join('\n')

    const outDir = await build({ 'hoteinput.mjs': HOTE }, 'input')
    const { win, el } = mountAll(outDir, 'mjs-hoteinput')
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0))
    const shadow = el._shadow || el.shadowRoot
    assert.ok(shadow, 'shadow root présent')
    assert.equal(el.constructor._mjs_noDestroyHooks, true, 'précondition : composant sans hooks destroy => pool actif')

    const row2: any = shadow.querySelector('section.row[data-id="2"]')
    assert.ok(row2, 'row id=2 rendue')
    const input2: any = row2.querySelector('input.inp')
    input2.value = 'SECRET_USER_TEXT'

    shadow.querySelector('#btnRemove').dispatchEvent(new win.Event('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0))
    assertAbsent(shadow.querySelector('section.row[data-id="2"]'), 'row id=2 retirée du DOM')

    shadow.querySelector('#btnInsert').dispatchEvent(new win.Event('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0))

    const row4: any = shadow.querySelector('section.row[data-id="4"]')
    assert.ok(row4, 'row id=4 rendue')
    assert.equal(row4.querySelector('span.lbl').textContent, 'D', 'le label suit le nouvel item')
    const input4: any = row4.querySelector('input.inp')
    assert.equal(input4, input2, 'un <input> SANS état opaque reste recyclé (identité du nœud) — seule sa valeur est remise au gabarit')
    assert.equal(input4.value, '', 'input vierge : la valeur tapée pour id=2 ne doit pas fuiter sur id=4')

    win.close?.()
  })

  it('case à cocher NON liée : id=2 cochée puis supprimée, id=4 ajouté → le nœud est RECYCLÉ mais DÉCOCHÉ (valeur du gabarit)', async () => {
    const HOTE = [
      '<script lang="coffee">',
      '$rows = [',
      '  { id: 1, label: \'A\' }',
      '  { id: 2, label: \'B\' }',
      '  { id: 3, label: \'C\' }',
      ']',
      'removeRow2 = -> $rows.splice(1, 1)',
      'insertRow4 = -> $rows.splice(1, 0, { id: 4, label: \'D\' })',
      '</script>',
      '<div>',
      '  {for row in $rows by id}',
      '    <section class="row" data-id="{row.id}">',
      '      <input type="checkbox" class="chk" />',
      '      <span class="lbl">{row.label}</span>',
      '    </section>',
      '  {end}',
      '</div>',
      '<button id="btnRemove" @click={removeRow2}>remove</button>',
      '<button id="btnInsert" @click={insertRow4}>insert</button>',
    ].join('\n')

    const outDir = await build({ 'hotechk.mjs': HOTE }, 'chk')
    const { win, el } = mountAll(outDir, 'mjs-hotechk')
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0))
    const shadow = el._shadow || el.shadowRoot
    assert.equal(el.constructor._mjs_noDestroyHooks, true, 'précondition : composant sans hooks destroy => pool actif')

    const row2: any = shadow.querySelector('section.row[data-id="2"]')
    const chk2: any = row2.querySelector('input.chk')
    assert.equal(chk2.defaultChecked, false, 'sanity : décochée par défaut dans le gabarit')
    chk2.checked = true

    shadow.querySelector('#btnRemove').dispatchEvent(new win.Event('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0))
    shadow.querySelector('#btnInsert').dispatchEvent(new win.Event('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0))

    const row4: any = shadow.querySelector('section.row[data-id="4"]')
    assert.ok(row4, 'row id=4 rendue')
    const chk4: any = row4.querySelector('input.chk')
    assert.equal(chk4, chk2, 'la case à cocher SANS état opaque reste recyclée (identité du nœud)')
    assert.equal(chk4.checked, false, 'décochée : la coche de id=2 ne doit pas fuiter sur id=4')

    win.close?.()
  })

  it('option choisie NON liée (<select>) : id=2 change de sélection puis supprimé, id=4 ajouté → le nœud est RECYCLÉ mais revient à l\'option du gabarit', async () => {
    const HOTE = [
      '<script lang="coffee">',
      '$rows = [',
      '  { id: 1, label: \'A\' }',
      '  { id: 2, label: \'B\' }',
      '  { id: 3, label: \'C\' }',
      ']',
      'removeRow2 = -> $rows.splice(1, 1)',
      'insertRow4 = -> $rows.splice(1, 0, { id: 4, label: \'D\' })',
      '</script>',
      '<div>',
      '  {for row in $rows by id}',
      '    <section class="row" data-id="{row.id}">',
      '      <select class="sel">',
      '        <option value="x">X</option>',
      '        <option value="y" selected>Y</option>',
      '        <option value="z">Z</option>',
      '      </select>',
      '      <span class="lbl">{row.label}</span>',
      '    </section>',
      '  {end}',
      '</div>',
      '<button id="btnRemove" @click={removeRow2}>remove</button>',
      '<button id="btnInsert" @click={insertRow4}>insert</button>',
    ].join('\n')

    const outDir = await build({ 'hotesel.mjs': HOTE }, 'sel')
    const { win, el } = mountAll(outDir, 'mjs-hotesel')
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0))
    const shadow = el._shadow || el.shadowRoot
    assert.equal(el.constructor._mjs_noDestroyHooks, true, 'précondition : composant sans hooks destroy => pool actif')

    const row2: any = shadow.querySelector('section.row[data-id="2"]')
    const sel2: any = row2.querySelector('select.sel')
    assert.equal(sel2.value, 'y', 'sanity : option Y sélectionnée par défaut dans le gabarit')
    sel2.value = 'z'
    assert.equal(sel2.value, 'z', 'sanity : sélection changée avant suppression')

    shadow.querySelector('#btnRemove').dispatchEvent(new win.Event('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0))
    shadow.querySelector('#btnInsert').dispatchEvent(new win.Event('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0))

    const row4: any = shadow.querySelector('section.row[data-id="4"]')
    assert.ok(row4, 'row id=4 rendue')
    const sel4: any = row4.querySelector('select.sel')
    assert.equal(sel4, sel2, 'le <select> SANS état opaque reste recyclé (identité du nœud)')
    assert.equal(sel4.value, 'y', 'option Y (gabarit) restaurée : le choix Z de id=2 ne doit pas fuiter sur id=4')

    win.close?.()
  })

  it('input LIÉ (value=!{row.text}) : id=2 supprimé puis id=4 ajouté avec la MÊME valeur → le nœud est recyclé ET la liaison réécrit quand même sa valeur', async () => {
    const HOTE = [
      '<script lang="coffee">',
      '$rows = [',
      '  { id: 1, text: \'A\' }',
      '  { id: 2, text: \'B\' }',
      '  { id: 3, text: \'C\' }',
      ']',
      'removeRow2 = -> $rows.splice(1, 1)',
      'insertRow4Same = -> $rows.splice(1, 0, { id: 4, text: \'B\' })',
      '</script>',
      '<div>',
      '  {for row in $rows by id}',
      '    <section class="row" data-id="{row.id}">',
      '      <input class="inp" value=!{row.text} />',
      '    </section>',
      '  {end}',
      '</div>',
      '<button id="btnRemove" @click={removeRow2}>remove</button>',
      '<button id="btnInsert" @click={insertRow4Same}>insert</button>',
    ].join('\n')

    const outDir = await build({ 'hoteliee.mjs': HOTE }, 'liee')
    const { win, el } = mountAll(outDir, 'mjs-hoteliee')
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0))
    const shadow = el._shadow || el.shadowRoot
    assert.equal(el.constructor._mjs_noDestroyHooks, true, 'précondition : composant sans hooks destroy => pool actif')

    const row2: any = shadow.querySelector('section.row[data-id="2"]')
    const input2: any = row2.querySelector('input.inp')
    assert.equal(input2.value, 'B', 'sanity : la liaison affiche bien le texte de id=2 avant suppression')

    shadow.querySelector('#btnRemove').dispatchEvent(new win.Event('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0))
    // id=4 porte EXACTEMENT la même valeur ('B') que celle affichée par id=2 avant
    // sa suppression : si une liaison sautait l'écriture parce que « la valeur n'a
    // pas changé » (par rapport à un état mis en cache plutôt qu'au nœud réel),
    // la remise à zéro du recyclage resterait affichée (vide) au lieu de 'B'.
    shadow.querySelector('#btnInsert').dispatchEvent(new win.Event('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0))

    const row4: any = shadow.querySelector('section.row[data-id="4"]')
    assert.ok(row4, 'row id=4 rendue')
    const input4: any = row4.querySelector('input.inp')
    assert.equal(input4, input2, 'un <input> LIÉ est lui aussi recyclé (identité du nœud)')
    assert.equal(input4.value, 'B', 'la liaison de la nouvelle clé réécrit bien sa valeur, même identique à l\'ancienne')

    win.close?.()
  })

  it('composant enfant SANS prop : id=2 supprimé puis id=4 ajouté → le compteur interne repart à zéro (pas de fuite d\'état)', async () => {
    const ENFANT = [
      '<script lang="coffee">',
      '  $localCount ?= 0',
      '</script>',
      '<button class="inc" @click={-> $localCount++}>+</button>',
      '<span class="cnt">{$localCount}</span>',
    ].join('\n')
    const HOTE = [
      '<script lang="coffee">',
      '$rows = [',
      '  { id: 1, label: \'A\' }',
      '  { id: 2, label: \'B\' }',
      '  { id: 3, label: \'C\' }',
      ']',
      'removeRow2 = -> $rows.splice(1, 1)',
      'insertRow4 = -> $rows.splice(1, 0, { id: 4, label: \'D\' })',
      '</script>',
      '<div>',
      '  {for row in $rows by id}',
      '    <section class="row" data-id="{row.id}">',
      '      <mjs-enfantetat></mjs-enfantetat>',
      '      <span class="lbl">{row.label}</span>',
      '    </section>',
      '  {end}',
      '</div>',
      '<button id="btnRemove" @click={removeRow2}>remove</button>',
      '<button id="btnInsert" @click={insertRow4}>insert</button>',
    ].join('\n')

    const outDir = await build({ 'enfantetat.mjs': ENFANT, 'hoteenfant.mjs': HOTE }, 'enfant')
    const { win, el } = mountAll(outDir, 'mjs-hoteenfant')
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0))
    const shadow = el._shadow || el.shadowRoot
    assert.ok(shadow, 'shadow root présent')
    assert.equal(el.constructor._mjs_noDestroyHooks, true, 'précondition : composant sans hooks destroy => pool actif')

    const row2: any = shadow.querySelector('section.row[data-id="2"]')
    const child2: any = row2.querySelector('mjs-enfantetat')
    const incBtn2 = child2._shadow.querySelector('button.inc')
    for (let i = 0; i < 3; i++) incBtn2.dispatchEvent(new win.Event('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0))
    assert.equal(child2._shadow.querySelector('span.cnt').textContent, '3', 'sanity : le compteur enfant est monté à 3 avant suppression')

    shadow.querySelector('#btnRemove').dispatchEvent(new win.Event('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0))
    shadow.querySelector('#btnInsert').dispatchEvent(new win.Event('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0))

    const row4: any = shadow.querySelector('section.row[data-id="4"]')
    assert.ok(row4, 'row id=4 rendue')
    const child4: any = row4.querySelector('mjs-enfantetat')
    assert.notEqual(child4, child2, 'le composant enfant ne doit PAS être recyclé vers une autre clé')
    assert.equal(child4._shadow.querySelector('span.cnt').textContent, '0', 'compteur remis à zéro : pas d\'état hérité de l\'ancienne clé')

    win.close?.()
  })

  it('radio HORS DE LA BOUCLE : coché par l\'utilisateur, il ne doit jamais être décoché quand une ligne du même groupe est supprimée', async () => {
    // Seule la ligne id=2 porte un radio du MÊME `name` que le radio hors
    // boucle (les autres lignes n'en ont pas) : un attribut booléen nu comme
    // `checked` se réapplique à CHAQUE réconciliation de la liste sur les
    // lignes qui restent, indépendamment de tout recyclage — un radio du même
    // groupe sur une ligne qui SURVIT à l'opération déclencherait la même
    // mutuelle exclusion native pour une raison totalement différente de
    // celle testée ici. Ce scénario isole le seul mécanisme visé : la remise
    // au gabarit d'une ligne qui PART.
    const HOTE = [
      '<script lang="coffee">',
      '$rows = [',
      '  { id: 1, label: \'A\' }',
      '  { id: 2, label: \'B\' }',
      '  { id: 3, label: \'C\' }',
      ']',
      'removeRow2 = -> $rows.splice(1, 1)',
      '</script>',
      '<div>',
      '  <input type="radio" name="pick" id="master" checked />',
      '  {for row in $rows by id}',
      '    <section class="row" data-id="{row.id}">',
      '      {if row.id === 2}',
      '        <input type="radio" name="pick" class="ra" checked />',
      '      {end}',
      '      <span class="lbl">{row.label}</span>',
      '    </section>',
      '  {end}',
      '</div>',
      '<button id="btnRemove" @click={removeRow2}>remove</button>',
    ].join('\n')

    const outDir = await build({ 'hoteradiomaster.mjs': HOTE }, 'radiomaster')
    const { win, el } = mountAll(outDir, 'mjs-hoteradiomaster')
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0))
    const shadow = el._shadow || el.shadowRoot
    assert.equal(el.constructor._mjs_noDestroyHooks, true, 'précondition : composant sans hooks destroy => pool actif')

    const master: any = shadow.querySelector('#master')
    master.checked = true
    assert.equal(master.checked, true, 'sanity : radio externe coché par l\'utilisateur')

    shadow.querySelector('#btnRemove').dispatchEvent(new win.Event('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0))

    assert.equal(master.checked, true, 'le radio externe (jamais touché par le {for}) ne doit pas être décoché par la remise au gabarit du radio d\'une ligne supprimée du même groupe')

    win.close?.()
  })

  it('radio HORS DE LA BOUCLE, chemin liste vidée d\'un coup : ne doit pas être décoché quand toutes les lignes disparaissent en une fois', async () => {
    const HOTE = [
      '<script lang="coffee">',
      '$rows = [',
      '  { id: 1, label: \'A\' }',
      '  { id: 2, label: \'B\' }',
      '  { id: 3, label: \'C\' }',
      ']',
      'clearAll = -> $rows = []',
      '</script>',
      '<div>',
      '  <input type="radio" name="pick2" id="master2" checked />',
      '  {for row in $rows by id}',
      '    <section class="row" data-id="{row.id}">',
      '      <input type="radio" name="pick2" class="ra" checked />',
      '      <span class="lbl">{row.label}</span>',
      '    </section>',
      '  {end}',
      '</div>',
      '<button id="btnClear" @click={clearAll}>clear</button>',
    ].join('\n')

    const outDir = await build({ 'hoteradioclear.mjs': HOTE }, 'radioclear')
    const { win, el } = mountAll(outDir, 'mjs-hoteradioclear')
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0))
    const shadow = el._shadow || el.shadowRoot

    const master2: any = shadow.querySelector('#master2')
    master2.checked = true
    assert.equal(master2.checked, true, 'sanity : radio externe coché par l\'utilisateur')

    shadow.querySelector('#btnClear').dispatchEvent(new win.Event('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0))

    assert.equal(shadow.querySelectorAll('section.row').length, 0, 'sanity : toutes les lignes ont disparu (chemin liste vidée d\'un coup)')
    assert.equal(master2.checked, true, 'le radio externe ne doit pas être décoché par la remise au gabarit d\'une ligne vidée en masse')

    win.close?.()
  })

  it('radio D\'UNE LIGNE : coché par l\'utilisateur puis la ligne supprimée, une nouvelle clé insérée → le nœud recyclé revient décoché (valeur du gabarit)', async () => {
    const HOTE = [
      '<script lang="coffee">',
      '$rows = [',
      '  { id: 1, label: \'A\' }',
      '  { id: 2, label: \'B\' }',
      '  { id: 3, label: \'C\' }',
      ']',
      'removeRow2 = -> $rows.splice(1, 1)',
      'insertRow4 = -> $rows.splice(1, 0, { id: 4, label: \'D\' })',
      '</script>',
      '<div>',
      '  {for row in $rows by id}',
      '    <section class="row" data-id="{row.id}">',
      '      <input type="radio" name="pick-{row.id}" class="ra" />',
      '      <span class="lbl">{row.label}</span>',
      '    </section>',
      '  {end}',
      '</div>',
      '<button id="btnRemove" @click={removeRow2}>remove</button>',
      '<button id="btnInsert" @click={insertRow4}>insert</button>',
    ].join('\n')

    const outDir = await build({ 'hoteradiorow.mjs': HOTE }, 'radiorow')
    const { win, el } = mountAll(outDir, 'mjs-hoteradiorow')
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0))
    const shadow = el._shadow || el.shadowRoot

    const row2: any = shadow.querySelector('section.row[data-id="2"]')
    const ra2: any = row2.querySelector('input.ra')
    assert.equal(ra2.defaultChecked, false, 'sanity : décoché par défaut dans le gabarit')
    ra2.checked = true

    shadow.querySelector('#btnRemove').dispatchEvent(new win.Event('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0))
    shadow.querySelector('#btnInsert').dispatchEvent(new win.Event('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0))

    const row4: any = shadow.querySelector('section.row[data-id="4"]')
    assert.ok(row4, 'row id=4 rendue')
    const ra4: any = row4.querySelector('input.ra')
    assert.equal(ra4, ra2, 'le radio SANS état opaque reste recyclé (identité du nœud)')
    assert.equal(ra4.checked, false, 'décoché : la coche de id=2 ne doit pas fuiter sur id=4')

    win.close?.()
  })

  it('textarea NON liée : texte tapé pour id=2 supprimé puis id=4 ajouté → le nœud est recyclé mais VIERGE', async () => {
    const HOTE = [
      '<script lang="coffee">',
      '$rows = [',
      '  { id: 1, label: \'A\' }',
      '  { id: 2, label: \'B\' }',
      '  { id: 3, label: \'C\' }',
      ']',
      'removeRow2 = -> $rows.splice(1, 1)',
      'insertRow4 = -> $rows.splice(1, 0, { id: 4, label: \'D\' })',
      '</script>',
      '<div>',
      '  {for row in $rows by id}',
      '    <section class="row" data-id="{row.id}">',
      '      <textarea class="ta"></textarea>',
      '      <span class="lbl">{row.label}</span>',
      '    </section>',
      '  {end}',
      '</div>',
      '<button id="btnRemove" @click={removeRow2}>remove</button>',
      '<button id="btnInsert" @click={insertRow4}>insert</button>',
    ].join('\n')

    const outDir = await build({ 'hotetextarea.mjs': HOTE }, 'textarea')
    const { win, el } = mountAll(outDir, 'mjs-hotetextarea')
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0))
    const shadow = el._shadow || el.shadowRoot

    const row2: any = shadow.querySelector('section.row[data-id="2"]')
    const ta2: any = row2.querySelector('textarea.ta')
    ta2.value = 'SECRET_USER_TEXT'

    shadow.querySelector('#btnRemove').dispatchEvent(new win.Event('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0))
    shadow.querySelector('#btnInsert').dispatchEvent(new win.Event('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0))

    const row4: any = shadow.querySelector('section.row[data-id="4"]')
    assert.ok(row4, 'row id=4 rendue')
    const ta4: any = row4.querySelector('textarea.ta')
    assert.equal(ta4, ta2, 'la textarea SANS état opaque reste recyclée (identité du nœud)')
    assert.equal(ta4.value, '', 'vierge : le texte tapé pour id=2 ne doit pas fuiter sur id=4')

    win.close?.()
  })

  it('<select multiple> NON lié : options choisies pour id=2 supprimé puis id=4 ajouté → toutes les options reviennent décochées (gabarit)', async () => {
    const HOTE = [
      '<script lang="coffee">',
      '$rows = [',
      '  { id: 1, label: \'A\' }',
      '  { id: 2, label: \'B\' }',
      '  { id: 3, label: \'C\' }',
      ']',
      'removeRow2 = -> $rows.splice(1, 1)',
      'insertRow4 = -> $rows.splice(1, 0, { id: 4, label: \'D\' })',
      '</script>',
      '<div>',
      '  {for row in $rows by id}',
      '    <section class="row" data-id="{row.id}">',
      '      <select class="sel" multiple>',
      '        <option value="x">X</option>',
      '        <option value="y">Y</option>',
      '        <option value="z">Z</option>',
      '      </select>',
      '      <span class="lbl">{row.label}</span>',
      '    </section>',
      '  {end}',
      '</div>',
      '<button id="btnRemove" @click={removeRow2}>remove</button>',
      '<button id="btnInsert" @click={insertRow4}>insert</button>',
    ].join('\n')

    const outDir = await build({ 'hoteselm.mjs': HOTE }, 'selm')
    const { win, el } = mountAll(outDir, 'mjs-hoteselm')
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0))
    const shadow = el._shadow || el.shadowRoot

    const row2: any = shadow.querySelector('section.row[data-id="2"]')
    const sel2: any = row2.querySelector('select.sel')
    sel2.options[0].selected = true
    sel2.options[2].selected = true

    shadow.querySelector('#btnRemove').dispatchEvent(new win.Event('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0))
    shadow.querySelector('#btnInsert').dispatchEvent(new win.Event('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0))

    const row4: any = shadow.querySelector('section.row[data-id="4"]')
    assert.ok(row4, 'row id=4 rendue')
    const sel4: any = row4.querySelector('select.sel')
    assert.equal(sel4, sel2, 'le <select multiple> SANS état opaque reste recyclé (identité du nœud)')
    const selected = Array.from(sel4.options as any[]).filter((o: any) => o.selected).map((o: any) => o.value)
    assert.deepEqual(selected, [], 'aucune option ne doit rester sélectionnée : le choix de id=2 ne doit pas fuiter sur id=4')

    win.close?.()
  })

  it('input value STATIQUE (pas de liaison) : écrasée par l\'utilisateur pour id=2 supprimé puis id=4 ajouté → revient à la valeur du gabarit', async () => {
    const HOTE = [
      '<script lang="coffee">',
      '$rows = [',
      '  { id: 1, label: \'A\' }',
      '  { id: 2, label: \'B\' }',
      '  { id: 3, label: \'C\' }',
      ']',
      'removeRow2 = -> $rows.splice(1, 1)',
      'insertRow4 = -> $rows.splice(1, 0, { id: 4, label: \'D\' })',
      '</script>',
      '<div>',
      '  {for row in $rows by id}',
      '    <section class="row" data-id="{row.id}">',
      '      <input class="inp" value="PREREMPLI" />',
      '      <span class="lbl">{row.label}</span>',
      '    </section>',
      '  {end}',
      '</div>',
      '<button id="btnRemove" @click={removeRow2}>remove</button>',
      '<button id="btnInsert" @click={insertRow4}>insert</button>',
    ].join('\n')

    const outDir = await build({ 'hotestatic.mjs': HOTE }, 'static')
    const { win, el } = mountAll(outDir, 'mjs-hotestatic')
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0))
    const shadow = el._shadow || el.shadowRoot

    const row2: any = shadow.querySelector('section.row[data-id="2"]')
    const inp2: any = row2.querySelector('input.inp')
    assert.equal(inp2.value, 'PREREMPLI', 'sanity : valeur statique du gabarit affichée initialement')
    inp2.value = 'ECRASE_PAR_USER'

    shadow.querySelector('#btnRemove').dispatchEvent(new win.Event('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0))
    shadow.querySelector('#btnInsert').dispatchEvent(new win.Event('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0))

    const row4: any = shadow.querySelector('section.row[data-id="4"]')
    assert.ok(row4, 'row id=4 rendue')
    const inp4: any = row4.querySelector('input.inp')
    assert.equal(inp4, inp2, 'un <input> à valeur statique reste recyclé (identité du nœud)')
    assert.equal(inp4.value, 'PREREMPLI', 'valeur remise à celle du gabarit, pas à vide')

    win.close?.()
  })

  it('input type range/date/color/file : aucun crash au recyclage, valeur remise au gabarit', async () => {
    const HOTE = [
      '<script lang="coffee">',
      '$rows = [',
      '  { id: 1, label: \'A\' }',
      '  { id: 2, label: \'B\' }',
      '  { id: 3, label: \'C\' }',
      ']',
      'removeRow2 = -> $rows.splice(1, 1)',
      'insertRow4 = -> $rows.splice(1, 0, { id: 4, label: \'D\' })',
      '</script>',
      '<div>',
      '  {for row in $rows by id}',
      '    <section class="row" data-id="{row.id}">',
      '      <input type="range" class="rg" min="0" max="10" value="3" />',
      '      <input type="date" class="dt" value="2020-01-01" />',
      '      <input type="color" class="cl" value="#00ff00" />',
      '      <input type="file" class="fl" />',
      '      <span class="lbl">{row.label}</span>',
      '    </section>',
      '  {end}',
      '</div>',
      '<button id="btnRemove" @click={removeRow2}>remove</button>',
      '<button id="btnInsert" @click={insertRow4}>insert</button>',
    ].join('\n')

    const outDir = await build({ 'hotevariante.mjs': HOTE }, 'variante')
    const { win, el } = mountAll(outDir, 'mjs-hotevariante')
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0))
    const shadow = el._shadow || el.shadowRoot

    const row2: any = shadow.querySelector('section.row[data-id="2"]')
    const rg2: any = row2.querySelector('input.rg')
    row2.querySelector('input.dt').value = '2025-12-31'
    row2.querySelector('input.cl').value = '#ff0000'
    rg2.value = '9'

    shadow.querySelector('#btnRemove').dispatchEvent(new win.Event('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0))
    shadow.querySelector('#btnInsert').dispatchEvent(new win.Event('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0))

    const row4: any = shadow.querySelector('section.row[data-id="4"]')
    assert.ok(row4, 'row id=4 rendue (pas de crash malgré range/date/color/file)')
    const rg4: any = row4.querySelector('input.rg')
    assert.equal(rg4, rg2, 'le range reste recyclé (identité du nœud)')
    assert.equal(rg4.value, '3', 'range remis à la valeur du gabarit')
    assert.equal(row4.querySelector('input.dt').value, '2020-01-01', 'date remise au gabarit')

    win.close?.()
  })

  it('chemin liste vidée d\'un coup (bulk clear) : les nœuds recyclés sont vierges, pas seulement le retrait un par un', async () => {
    const HOTE = [
      '<script lang="coffee">',
      '$rows = [',
      '  { id: 1, label: \'A\' }',
      '  { id: 2, label: \'B\' }',
      '  { id: 3, label: \'C\' }',
      ']',
      'clearAll = -> $rows = []',
      'refill = -> $rows = [ { id: 91, label: \'Z1\' }, { id: 92, label: \'Z2\' }, { id: 93, label: \'Z3\' } ]',
      '</script>',
      '<div>',
      '  {for row in $rows by id}',
      '    <section class="row" data-id="{row.id}">',
      '      <input class="inp" />',
      '      <span class="lbl">{row.label}</span>',
      '    </section>',
      '  {end}',
      '</div>',
      '<button id="btnClear" @click={clearAll}>clear</button>',
      '<button id="btnRefill" @click={refill}>refill</button>',
    ].join('\n')

    const outDir = await build({ 'hotebulk.mjs': HOTE }, 'bulk')
    const { win, el } = mountAll(outDir, 'mjs-hotebulk')
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0))
    const shadow = el._shadow || el.shadowRoot

    const inputs: any[] = Array.from(shadow.querySelectorAll('section.row input.inp'))
    inputs.forEach((inp, i) => { inp.value = 'SECRET_' + i })
    const oldNodes = new Set(inputs)

    shadow.querySelector('#btnClear').dispatchEvent(new win.Event('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0))
    assert.equal(shadow.querySelectorAll('section.row').length, 0, 'sanity : liste bien vidée en un coup')

    shadow.querySelector('#btnRefill').dispatchEvent(new win.Event('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0))

    const newInputs: any[] = Array.from(shadow.querySelectorAll('section.row input.inp'))
    assert.equal(newInputs.length, 3, '3 nouvelles lignes rendues')
    const recycled = newInputs.filter((inp) => oldNodes.has(inp))
    assert.ok(recycled.length > 0, 'sanity : au moins un nœud physiquement recyclé via ce chemin')
    assert.ok(newInputs.every((inp) => inp.value === ''), 'tous les inputs (recyclés ou neufs) doivent être vierges')

    win.close?.()
  })
})
