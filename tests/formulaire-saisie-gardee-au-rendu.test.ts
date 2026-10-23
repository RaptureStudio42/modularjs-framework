// Une liaison simple de champ (`value={…}` d'un `<input>`/`<textarea>`, `checked={…}` d'une case,
// `selected={…}` d'une option) n'écrit plus que quand SA valeur change. Avant, elle comparait au
// DOM vivant : chaque passage du rendu — une ligne de `{for}` qui repasse parce qu'un autre état
// du composant a changé, une frappe qui met à jour un compteur, un changement de langue, une
// navigation — remettait la valeur du modèle par-dessus ce que l'utilisateur venait de taper, de
// choisir ou de cocher. Les champs n'étaient pas recréés : leur saisie était écrasée. La valeur
// du modèle qui change, elle, s'écrit toujours dans le champ.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function monter(prefixe: string, fichiers: Record<string, string>, url: string) {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(fichiers)) writeFileSync(join(srcDir, nom), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  await bundler.close()
  const files  = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const rang   = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const code   = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  const window: any = new Window({ url })
  window.eval(`${code}\nglobalThis.µ = µ;`)
  return window
}

// la forme du formulaire d'édition d'une administration : sections recalculées (objets neufs),
// lignes par id, branche d'édition, champs par langue dans une liste imbriquée ; chaque frappe met
// à jour un état relu dans le formulaire (le compteur, comme les langues encore vides). Zone de
// texte, champ, choix et cases posés directement dans la ligne servent aussi à vérifier que la
// valeur du modèle qui change s'écrit toujours
const EDIT_FORM = `<script>
  $rows    = [{id: 1, fr: 'Bonjour', en: 'Hello', code: 'x1', parent: 'a', active: true, star: false}, {id: 2, fr: 'Merci', en: 'Thanks', code: 'x9', parent: 'b', active: true, star: false}]
  $editing = 1
  $blanks  = {}
  $lang    = 'fr'
  $$langs  = [{code: 'fr'}, {code: 'en'}]

  number = (list) -> list.map((r, i) -> Object.assign({}, r, { n: i + 1 }))

  sectionsOf = (rows, lang) -> [ { key: 'all', title: lang, rows: number(rows) } ]

  $sections = sectionsOf($rows, $lang)

  @typed = (e) -> $blanks = Object.assign({}, $blanks, { n: ($blanks.n or 0) + 1 })
</script>

{for sec in $sections by key}
  <ol>
    {for r in sec.rows by id}
      <li>
        {if $editing is r.id}
          <div class="form" @input={@typed(e)}>
            <small class="n">{$blanks.n or 0}</small>
            {for l in $$langs by code}
              <label>{l.code}<input type="text" data-field={l.code} value={r[l.code] or ''} @class{l.code isnt $lang}="hidden"></label>
            {end}
            <label>code<input type="text" data-field="code" value={r.code}></label>
            <label>note<textarea data-field="note" value={r.fr + ' !'}></textarea></label>
            <label>parent<select data-field="parent"><option value="a" selected={r.parent is 'a' ? true : null}>a</option><option value="b" selected={r.parent is 'b' ? true : null}>b</option><option value="c" selected={r.parent is 'c' ? true : null}>c</option></select></label>
            <label>actif<input type="checkbox" data-field="active" checked={r.active}></label>
            <label>vedette<input type="checkbox" data-field="star" checked={r.star}></label>
          </div>
        {else}
          <span>{r.fr}</span>
        {end}
      </li>
    {end}
  </ol>
{end}
<button class="lang" @click={$lang = 'en'}>en</button>
<button class="reload" @click={$rows = [{id: 1, fr: 'Salut', en: 'Hi', code: 'x2', parent: 'b', active: false, star: true}, {id: 2, fr: 'Merci', en: 'Thanks', code: 'x9', parent: 'b', active: true, star: false}]}>relit</button>
`

const LAYOUT = `<routes target="main">
  /record/(:tab) record-page
</routes>

<script>
  µurlChange (path) -> null
</script>

<div class="shell"><@view main></div>
`

const RECORD = `<script>
  $name = 'Alice'
</script>

<h1>{&tab or 'accueil'}</h1>
<label>nom<input type="text" class="name" value={$name}></label>
`

// une liste dont les lignes SONT les options (composant sans nettoyage : les lignes retirées sont
// recyclées pour les clés suivantes) ; le choix fait à la main sur une option ne doit pas suivre
// cette option recyclée vers une autre clé
const OPTIONS = `<script>
  $opts = [{id: 'a'}, {id: 'b'}, {id: 'c'}]
  $sel  = 'b'
</script>

<label>choix<select class="s">{for o in $opts by id}<option value={o.id} selected={o.id is $sel ? true : null}>{o.id}</option>{end}</select></label>
<button class="replace" @click={$opts = [{id: 'd'}, {id: 'e'}, {id: 'f'}]; $sel = 'e'}>r</button>
<button class="again" @click={$opts = [{id: 'g'}, {id: 'h'}, {id: 'i'}]; $sel = 'h'}>r2</button>
`

describe('liaison simple d\'un champ : la saisie en cours survit au rendu', function () {
  this.timeout(60000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('formulaire d\'édition dans une ligne de {for} : texte tapé, option choisie et case décochée restent après une frappe et un changement de langue', async () => {
    const window = await monter('saisie-ligne', { 'edit-form.mjs': EDIT_FORM }, 'http://localhost/')
    try {
      window.document.body.innerHTML = '<mjs-edit-form></mjs-edit-form>'
      const c = window.document.querySelector('mjs-edit-form')
      await attendre(() => !!c._shadow?.querySelector('input[data-field=fr]'))
      const sh      = c._shadow
      const champ   = sh.querySelector('input[data-field=fr]')
      const code    = sh.querySelector('input[data-field=code]')
      const note    = sh.querySelector('textarea')
      const choix   = sh.querySelector('select')
      const actif   = sh.querySelector('input[data-field=active]')
      const vedette = sh.querySelector('input[data-field=star]')
      const etat    = () => JSON.stringify({ texte: champ.value, code: code.value, note: note.value, choix: choix.value, actif: actif.checked, vedette: vedette.checked })
      assert.equal(etat(), JSON.stringify({ texte: 'Bonjour', code: 'x1', note: 'Bonjour !', choix: 'a', actif: true, vedette: false }), 'état de départ')
      code.value    = 'x1 revu'
      note.value    = 'Bonjour à tous !'
      choix.value   = 'c'
      actif.checked = false
      champ.value   = 'Bonjour à tous'
      champ.dispatchEvent(new window.Event('input', { bubbles: true, composed: true }))
      await attendre(() => sh.querySelector('.n')?.textContent === '1')
      await pause(20)
      assert.ok(sh.querySelector('input[data-field=fr]') === champ, 'le champ n\'est pas recréé')
      assert.equal(etat(), JSON.stringify({ texte: 'Bonjour à tous', code: 'x1 revu', note: 'Bonjour à tous !', choix: 'c', actif: false, vedette: false }), 'une frappe relance le rendu : chaque saisie reste')
      sh.querySelector('button.lang').click()
      await attendre(() => champ.classList.contains('hidden'))
      await pause(20)
      assert.ok(sh.querySelector('input[data-field=fr]') === champ, 'changement de langue : le champ n\'est pas recréé')
      assert.equal(etat(), JSON.stringify({ texte: 'Bonjour à tous', code: 'x1 revu', note: 'Bonjour à tous !', choix: 'c', actif: false, vedette: false }), 'changement de langue (sections recalculées) : chaque saisie reste')
      sh.querySelector('button.reload').click()
      await attendre(() => code.value === 'x2')
      await pause(20)
      assert.equal(code.value, 'x2', `le modèle change : la nouvelle valeur s'écrit (${etat()})`)
      assert.equal(note.value, 'Salut !', `le modèle change : la zone de texte suit (${etat()})`)
      assert.equal(choix.value, 'b', `le modèle change : l'option du modèle est choisie (${etat()})`)
      assert.equal(vedette.checked, true, `le modèle change : la case suit le modèle (${etat()})`)
    }
    finally {
      window.close()
    }
  })

  it('page routée : naviguer dans la même page garde le texte tapé dans un champ lié', async () => {
    const window = await monter('saisie-route', { 'app.page.mjs': LAYOUT, 'record-page.mjs': RECORD }, 'http://localhost/#/record')
    try {
      window.document.body.innerHTML = '<mjs-app></mjs-app>'
      const app   = window.document.querySelector('mjs-app')
      const page  = () => app._shadow?.querySelector('mjs-record-page')
      const titre = () => page()?._shadow?.querySelector('h1')?.textContent
      await attendre(() => titre() === 'accueil')
      const champ = page()._shadow.querySelector('input.name')
      assert.equal(champ.value, 'Alice')
      champ.value = 'Alice Martin'
      window.eval(`µ.Router.to('/record/details')`)
      await attendre(() => titre() === 'details')
      await pause(20)
      assert.ok(page()._shadow.querySelector('input.name') === champ, 'même page, même champ')
      assert.equal(champ.value, 'Alice Martin', 'la navigation dans la page ne remet pas la valeur du modèle')
    }
    finally {
      window.close()
    }
  })

  it('options recyclées d\'une clé à l\'autre : l\'option du modèle est choisie, pas celle cochée à la main sur l\'ancienne clé', async () => {
    const window = await monter('saisie-options', { 'demo-options.mjs': OPTIONS }, 'http://localhost/')
    try {
      window.document.body.innerHTML = '<mjs-demo-options></mjs-demo-options>'
      const c = window.document.querySelector('mjs-demo-options')
      await attendre(() => (c._shadow?.querySelectorAll('option').length ?? 0) === 3)
      const choix = c._shadow.querySelector('select')
      assert.equal(choix.value, 'b')
      choix.value = 'c'
      const premieres = [...c._shadow.querySelectorAll('option')]
      c._shadow.querySelector('button.replace').click()
      await attendre(() => choix.value === 'e')
      c._shadow.querySelector('button.again').click()
      await attendre(() => c._shadow.querySelector('option')?.value === 'g')
      await pause(20)
      const recyclees = [...c._shadow.querySelectorAll('option')].filter((o: any) => premieres.includes(o)).length
      assert.equal(recyclees, 3, 'le second jeu réutilise les options du premier')
      assert.equal(choix.value, 'h', 'l\'option choisie est celle du modèle')
    }
    finally {
      window.close()
    }
  })
})
