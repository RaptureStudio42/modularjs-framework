// <@@select> : une icône en image et des groupes d'options, comme <optgroup> en HTML.
// - `icon="🇫🇷"` reste du texte, comme avant ; `icon={µimage('euro.png')}` (l'image résolue au build)
//   s'affiche en <img>, dans la liste comme dans le bouton fermé — avant, le bouton écrivait
//   « [object Object] » ;
// - `<@@optgroup label="Europe">` range ses options sous un titre, dans un groupe nommé pour les
//   lecteurs d'écran ; les flèches passent d'un groupe à l'autre, la recherche cache un groupe vide.
// happy-dom et bundler réel, même patron que core-select.test.ts.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { assertAbsent } from './helpers/dom-assert.js'
import { mjsTmp } from './helpers/tmp.js'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

const HOST = `<div id="sel-texte">
  <@@select name="texte">
    <@@option value="fr" icon="🇫🇷">France</@@option>
  </@@select>
</div>

<div id="sel-image">
  <@@select name="image" value="eur">
    <@@option value="eur" icon={µimage('euro.png')}>Euro</@@option>
    <@@option value="usd" icon="$">Dollar</@@option>
  </@@select>
</div>

<div id="sel-groupes">
  <@@select name="groupes" search>
    <@@optgroup label="Europe">
      <@@option value="eur">Euro</@@option>
      <@@option value="chf">Franc suisse</@@option>
    </@@optgroup>
    <@@optgroup label="Asie">
      <@@option value="jpy">Yen</@@option>
    </@@optgroup>
    <@@option value="btc">Bitcoin</@@option>
  </@@select>
</div>
`

describe('<@@select> — icône en image, groupes d\'options', function () {
  this.timeout(60000)
  let window: any
  let hote: any

  const sel     = (id: string) => hote._shadow.querySelector(`#${id} mjs-core-select`)
  const btn     = (id: string) => sel(id)._shadow.querySelector('.select-btn')
  const panneau = (id: string) => sel(id)._shadow.querySelector('.select-panel')
  const click   = (el: any) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, composed: true }))
  const touche  = (id: string, k: string) => sel(id)._shadow.querySelector('.select').dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, composed: true }))
  const tick    = (ms = 30) => new Promise((r) => setTimeout(r, ms))

  async function ouvrir(id: string) {
    if (btn(id).getAttribute('aria-expanded') !== 'true') { click(btn(id)); await tick() }
  }

  async function fermer(id: string) {
    if (btn(id).getAttribute('aria-expanded') === 'true') { click(btn(id)); await tick() }
  }

  // le panneau en texte : « [Europe|Europe] Euro, Franc suisse | [Asie|Asie] Yen | Bitcoin » — le titre affiché,
  // puis le nom donné au groupe ; une option hors groupe, seule, sans titre ni groupe nommé
  function plan(id: string): string {
    const out: string[] = []
    const noms = (n: any) => [...n.querySelectorAll('.select-option')].map((o: any) => o.textContent.trim())
    for (const n of panneau(id).querySelector('[role=listbox]').children) {
      if (n.getAttribute('role') === 'group') {
        const titre = n.querySelector('.select-group-label').textContent.trim()
        out.push(`[${titre}|${n.getAttribute('aria-label')}] ` + noms(n).join(', '))
      }
      else if (n.classList.contains('select-option')) out.push(n.textContent.trim())
      else if (n.querySelector('.select-option')) {
        assertAbsent(n.querySelector('.select-group-label'), 'une suite d\'options hors groupe n\'a pas de titre')
        out.push(...noms(n))
      }
    }
    return out.join(' | ')
  }

  before(async () => {
    const root   = mjsTmp('select-icone-groupes')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'euro.png'), Buffer.from(PNG, 'base64'))
    writeFileSync(join(srcDir, 'hote.mjs'), HOST)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
    window.document.body.innerHTML = '<mjs-hote></mjs-hote>'
    await tick(120)
    hote = window.document.body.firstElementChild
    assert.ok(hote._shadow, 'hôte monté')
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  it('une icône en texte reste du texte, comme avant', async () => {
    await ouvrir('sel-texte')
    const opt = sel('sel-texte')._shadow.querySelector('.select-option')
    assert.equal(opt.querySelector('.select-icon').textContent, '🇫🇷')
    assert.equal(opt.querySelectorAll('img').length, 0)
    await fermer('sel-texte')
  })

  it('icon={µimage(…)} : une image, dans le bouton fermé comme dans la liste ; l\'option voisine garde son texte', async () => {
    const b = btn('sel-image')
    assert.doesNotMatch(b.textContent, /object/, 'le bouton n\'écrit plus « [object Object] »')
    const img = b.querySelector('img.select-icon')
    assert.ok(img, 'le bouton fermé montre l\'image de l\'option choisie')
    assert.match(img.getAttribute('src'), /euro[^/]*\.png$/)
    assert.equal(img.getAttribute('alt'), '', 'image décorative : le libellé dit déjà l\'option')
    await ouvrir('sel-image')
    const opts = sel('sel-image')._shadow.querySelectorAll('.select-option')
    assert.match(opts[0].querySelector('img.select-icon').getAttribute('src'), /euro[^/]*\.png$/)
    assert.equal(opts[1].querySelector('.select-icon').textContent, '$')
    assert.equal(opts[1].querySelectorAll('img').length, 0)
    await fermer('sel-image')
  })

  it('<@@optgroup label> : les options rangées sous leur titre, dans un groupe nommé ; une option hors groupe reste à sa place', async () => {
    await ouvrir('sel-groupes')
    assert.equal(plan('sel-groupes'), '[Europe|Europe] Euro, Franc suisse | [Asie|Asie] Yen | Bitcoin')
  })

  it('les flèches passent d\'un groupe à l\'autre ; Entrée choisit', async () => {
    await ouvrir('sel-groupes')
    touche('sel-groupes', 'ArrowDown')
    touche('sel-groupes', 'ArrowDown')
    await tick()
    const active = sel('sel-groupes')._shadow.querySelector('.select-option.active')
    assert.equal(active.textContent.trim(), 'Yen')
    touche('sel-groupes', 'Enter')
    await tick()
    assert.equal(sel('sel-groupes')._state.value, 'jpy')
    assert.match(btn('sel-groupes').textContent, /Yen/)
  })

  it('la recherche cache un groupe sans option trouvée', async () => {
    await ouvrir('sel-groupes')
    const input = sel('sel-groupes')._shadow.querySelector('.select-search')
    input.value = 'yen'
    input.dispatchEvent(new window.Event('input', { bubbles: true, cancelable: true, composed: true }))
    await tick()
    assert.equal(plan('sel-groupes'), '[Asie|Asie] Yen')
    await fermer('sel-groupes')
  })
})
