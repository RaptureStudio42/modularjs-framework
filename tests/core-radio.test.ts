// Test neuf — module cœur radio : COMPORTEMENT runtime en happy-dom, harnais
// build+happy-dom copié de tests/core-checkbox-indeterminate.test.ts:1-47 (lui-même
// copié de tests/core-toggles.test.ts:1-52).
//
// Bug ciblé : `@closest('form') ?? document` (radio.mjs) ne traverse jamais une
// frontière shadow — un groupe <mjs-core-radio> rendu dans le shadow root d'un composant
// CONTENEUR (donc SANS <form> dans ce même shadow) retombe sur `document`, qui ne
// voit jamais l'intérieur d'un shadow (fermé ici, cf. mjs_element.ts mode:'closed') :
// l'exclusion mutuelle du groupe est perdue, plusieurs boutons peuvent rester cochés.

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

// HOST = le composant conteneur TIERS : compilé en <mjs-hote>, SON PROPRE shadow root
// (fermé). `#grp-form` a un <form> dans ce même shadow (cas déjà couvert par
// closest('form'), non-régression) ; `#grp-noform` n'a AUCUN <form>, ni dans ce shadow
// ni ailleurs — exactement le scénario qui retombait sur `document` avant correctif.
const HOST = [
  '<form id="grp-form" @noUJS>',
  '  <@@radio name="taille" value="s">S</@@radio>',
  '  <@@radio name="taille" value="m">M</@@radio>',
  '  <@@radio name="taille" value="l">L</@@radio>',
  '</form>',
  '<div id="grp-noform">',
  '  <@@radio name="couleur" value="rouge">Rouge</@@radio>',
  '  <@@radio name="couleur" value="vert">Vert</@@radio>',
  '  <@@radio name="couleur" value="bleu">Bleu</@@radio>',
  '</div>',
].join('\n')

async function buildAndMount(hostSource: string): Promise<{ window: any; document: any; hote: any }> {
  const root = mjsTmp('core-radio')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hote.mjs'), hostSource)

  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))

  const files = readdirSync(outDir)
  const pick = (re: RegExp) => {
    const f = files.find((f) => re.test(f))
    assert.ok(f, `chunk attendu ${re} parmi ${files.join(', ')}`)
    return f!
  }
  const chunkFiles = [pick(/^mjs_core-/), pick(/^core-radio-/), pick(/^hote-/)]
  const code = chunkFiles.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')

  const window: any = new Window({ url: 'http://localhost/' })
  const document: any = window.document
  window.eval(`${code}\nglobalThis.µ = µ;`)
  document.body.innerHTML = '<mjs-hote></mjs-hote>'
  await new Promise((r) => setTimeout(r, 80))
  const hote = document.body.querySelector('mjs-hote')
  return { window, document, hote }
}

// simule ce que fait un navigateur réel sur un clic radio : le natif passe à
// checked=true PUIS l'événement change se déclenche (@onChange l'écoute)
function check(win: any, native: any) {
  native.checked = true
  native.dispatchEvent(new win.Event('change', { bubbles: true, cancelable: true, composed: true }))
}

async function tick(ms = 30) {
  await new Promise((r) => setTimeout(r, ms))
}

describe('mjs-core-radio — exclusion mutuelle du groupe', function () {
  this.timeout(30000)
  after(async () => { await terminateSharedWorkerPool() })

  it('groupe SANS <form>, dans le shadow root du composant hôte : cocher le 2e décoche le 1er', async () => {
    const { window, hote } = await buildAndMount(HOST)
    const radios = Array.from(hote._shadow.querySelectorAll('#grp-noform mjs-core-radio')) as any[]
    assert.equal(radios.length, 3, 'les 3 <mjs-core-radio> du groupe doivent être rendus dans le shadow de l\'hôte')
    const natives = radios.map((r: any) => r._shadow.querySelector('input.native'))

    check(window, natives[0])
    await tick()
    assert.equal(natives[0].checked, true, 'le 1er radio coché doit porter checked=true')

    check(window, natives[1])
    await tick()
    assert.equal(natives[1].checked, true, 'le 2e radio coché doit porter checked=true')
    assert.equal(natives[0].checked, false, 'le 1er radio doit repasser à checked=false (exclusion mutuelle du groupe)')
  })

  it('groupe DANS un <form> (même shadow) : cocher le 2e décoche le 1er — non-régression', async () => {
    const { window, hote } = await buildAndMount(HOST)
    const radios = Array.from(hote._shadow.querySelectorAll('#grp-form mjs-core-radio')) as any[]
    const natives = radios.map((r: any) => r._shadow.querySelector('input.native'))

    check(window, natives[0])
    await tick()
    assert.equal(natives[0].checked, true)

    check(window, natives[1])
    await tick()
    assert.equal(natives[1].checked, true)
    assert.equal(natives[0].checked, false, 'exclusion mutuelle via <form> : déjà correcte avant le fix, doit le rester')
  })
})

// le bouton qui vient d'être coché par l'utilisateur annonce sa valeur par un `change` qui remonte, comme
// <@@select> : `e.data` = la valeur de CE bouton, émis par lui ; la variable liée (group=!{…}) et les
// voisins sont déjà à jour quand l'écouteur joue. Rien quand on rechoisit le bouton déjà coché, quand la
// page pose elle-même la valeur, ni pour `form.reset()`.
describe('mjs-core-radio — l\'événement change', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  const HOTE_CHANGE = `<script>
  $size = null
  $echo = []

  @note = (qui, e, lie)->
    $echo = [...$echo, qui + ':' + e.data + ':' + lie]
</script>

<form id="f" @noUJS>
  <@@radio id="ra" name="size" value="s" group=!{$size} @change={@note('ra', e, $size)}>S</@@radio>
  <@@radio id="rb" name="size" value="m" group=!{$size} @change={@note('rb', e, $size)}>M</@@radio>
  <@@radio id="rc" name="size" value="l" group=!{$size} @change={@note('rc', e, $size)}>L</@@radio>
  <@@radio id="va" name="couleur" value="rouge" checked>Rouge</@@radio>
  <@@radio id="vb" name="couleur" value="vert">Vert</@@radio>
</form>
<button type="button" id="flip" @click={$size = 'l'}>flip</button>
<p id="echo">{$echo.join(',')}</p>`

  type Recu = { qui: string; tag: string; type: string; data: any; bubbles: boolean; composed: boolean; size: any; etats: boolean[]; champs: string[] }

  async function monter(): Promise<{ window: any; hote: any; recus: Recu[] }> {
    const { window, hote } = await buildAndMount(HOTE_CHANGE)
    const recus: Recu[] = []
    const etat = (id: string) => !!hote._shadow.querySelector('#' + id)._state.checked
    const form = hote._shadow.querySelector('#f')
    form.addEventListener('change', (e: any) => recus.push({
      qui: e.target.id, tag: e.target.tagName.toLowerCase(), type: e.type, data: e.data, bubbles: e.bubbles, composed: e.composed,
      size: hote._state.size, etats: ['ra', 'rb', 'rc'].map(etat),
      champs: Array.from(new window.FormData(form).entries()).map((p: any) => p[0] + '=' + p[1])
    }))
    return { window, hote, recus }
  }

  // un clic réel : le natif passe à coché PUIS son `change` part, qui ne franchit pas l'ombre (non composé), comme dans un navigateur
  const choisir = (win: any, native: any) => {
    native.checked = true
    native.dispatchEvent(new win.Event('change', { bubbles: true }))
  }

  const natif  = (hote: any, id: string) => hote._shadow.querySelector('#' + id)._shadow.querySelector('input.native')
  const touche = (window: any, el: any, key: string) => el.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true }))

  it('cocher un bouton : lui seul annonce sa valeur, la variable liée et les voisins sont déjà à jour, la balise est la cible', async () => {
    const { window, hote, recus } = await monter()
    choisir(window, natif(hote, 'rb'))
    await tick(60)
    assert.deepEqual(recus.map((r) => [r.qui, r.tag, r.type, r.data, r.size, r.etats, r.bubbles, r.composed]), [
      ['rb', 'mjs-core-radio', 'change', 'm', 'm', [false, true, false], true, true]
    ])
    choisir(window, natif(hote, 'rc'))
    await tick(60)
    assert.deepEqual(recus.map((r) => [r.qui, r.data, r.size, r.etats]), [
      ['rb', 'm', 'm', [false, true, false]],
      ['rc', 'l', 'l', [false, false, true]]
    ], 'un change par choix, jamais pour le bouton qui se décoche')
    window.close?.()
  })

  it('le @change posé sur la balise lit la variable déjà à jour', async () => {
    const { window, hote } = await monter()
    choisir(window, natif(hote, 'ra'))
    await tick(60)
    choisir(window, natif(hote, 'rc'))
    await tick(60)
    assert.equal(hote._shadow.querySelector('#echo').textContent, 'ra:s:s,rc:l:l')
    window.close?.()
  })

  it('au clavier (flèche) : le voisin coché annonce sa valeur', async () => {
    const { window, hote, recus } = await monter()
    choisir(window, natif(hote, 'ra'))
    await tick(60)
    recus.length = 0
    touche(window, natif(hote, 'ra'), 'ArrowRight')
    await tick(80)
    assert.deepEqual(recus.map((r) => [r.qui, r.data, r.size, r.etats]), [['rb', 'm', 'm', [false, true, false]]])
    window.close?.()
  })

  it('rechoisir le bouton déjà coché n\'annonce rien', async () => {
    const { window, hote, recus } = await monter()
    choisir(window, natif(hote, 'rb'))
    await tick(60)
    choisir(window, natif(hote, 'rb'))
    await tick(60)
    assert.equal(recus.length, 1)
    window.close?.()
  })

  it('un groupe sans liaison (group non écrit) annonce aussi la valeur du bouton coché', async () => {
    const { window, hote, recus } = await monter()
    choisir(window, natif(hote, 'vb'))
    await tick(60)
    assert.deepEqual(recus.map((r) => [r.qui, r.data]), [['vb', 'vert']])
    window.close?.()
  })

  it('la page qui pose elle-même la valeur n\'annonce rien (les boutons suivent)', async () => {
    const { window, hote, recus } = await monter()
    hote._shadow.querySelector('#flip').click()
    await tick(100)
    assert.equal(natif(hote, 'rc').checked, true, 'préalable : la valeur posée par la page est arrivée au bouton')
    assert.deepEqual(recus, [])
    assert.equal(hote._shadow.querySelector('#echo').textContent, '')
    window.close?.()
  })

  it('FormData lu pendant le change : le groupe n\'envoie que le bouton qui vient d\'être coché', async () => {
    const { window, hote, recus } = await monter()
    choisir(window, natif(hote, 'rb'))
    await tick(60)
    choisir(window, natif(hote, 'rc'))
    await tick(60)
    choisir(window, natif(hote, 'vb'))
    await tick(60)
    assert.deepEqual(recus.map((r) => [r.qui, r.champs]), [
      ['rb', ['size=m', 'couleur=rouge']],
      ['rc', ['size=l', 'couleur=rouge']],
      ['vb', ['size=l', 'couleur=vert']]
    ])
    window.close?.()
  })

  it('form.reset() ne annonce aucun change, le groupe rendu à son état de départ', async () => {
    const { window, hote, recus } = await monter()
    choisir(window, natif(hote, 'rc'))
    choisir(window, natif(hote, 'vb'))
    await tick(80)
    assert.equal(recus.length, 2, 'préalable : deux gestes, deux change')
    recus.length = 0
    hote._shadow.querySelector('#f').reset()
    await tick(120)
    assert.deepEqual(['ra', 'rb', 'rc', 'va', 'vb'].map((id) => natif(hote, id).checked), [false, false, false, true, false], 'les états de départ sont revenus')
    assert.deepEqual(recus, [])
    window.close?.()
  })
})
