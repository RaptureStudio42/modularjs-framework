// Éditeur riche du cœur (<@@editor>) : une ligne à cocher copiée puis collée, au-dessus ou en dessous de l'originale, dans Chromium, Firefox et WebKit réels (développement ET
// production). La ligne qui portait déjà le nom le garde, la copie collée en reçoit un neuf, où qu'elle soit : annuler le collage (Ctrl+Z) laisse donc l'original sous son nom, et
// les coches des répondants posées sur ce nom ne se perdent pas. Refaire (Ctrl+Y) puis annuler encore, de suite, ne change rien à cela.
// Entrée au début d'une ligne puis Ctrl+Z : la ligne rend son nom, même quand le navigateur (Firefox) remet son texte dans la copie vide et non dans l'originale.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { AIDES, BUILDS, MOTEURS, ouvrir, type Page, type Session } from './helpers/editeur-riche.js'

const TEXTE = '<ul data-checklist><li data-key="aa11">Un</li><li data-key="bb22">Deux</li><li data-key="cc33">Trois</li></ul>'
const LIGNE = '<ul data-checklist><li data-key="bb22">Deux</li></ul>'
const FORME = /^[a-z][a-z0-9]{3}$/

const AIDES_LIGNES = AIDES + `
window.__lis = (c) => [...__sf(c).querySelectorAll('ul[data-checklist] > li')]
window.__noms = (c) => __lis(c).map((li) => li.textContent + ':' + (li.getAttribute('data-key') ?? '-'))
`

const PAGE: Page = {
  cle:     'lignes-nommees-collage',
  attente: `(() => { const h = document.querySelector('mjs-hote'); const e = h && h._shadow && h._shadow.querySelector('.a1'); return !!(e && e._shadow && e._shadow.querySelector('.surface')) })()`,
  aides:   AIDES_LIGNES,
  source:  `<script>
  $texte = '${TEXTE}'

  µmount ->
    window.__poser = (v)-> $texte = v
</script>

<form class="f" @noUJS>
  <@@editor class="a1" name="modele" value=!{$texte}></@@editor>
</form>
`,
}

for (const build of BUILDS) for (const nom of MOTEURS) describe(`éditeur riche, ligne à cocher copiée puis collée (${build}, ${nom} réel)`, function () {
  this.timeout(240000)
  let s: Session | null = null

  const E     = (expr: string): Promise<any> => s!.page.evaluate(expr)
  const pause = (ms = 250) => s!.page.waitForTimeout(ms)
  const touche = (t: string) => s!.page.keyboard.press(t)
  const noms  = (): Promise<string[]> => E(`__noms('a1')`)

  before(async () => { s = await ouvrir(nom, build, PAGE) })
  after(async () => {
    if (s) await s.fermer()
    await terminateSharedWorkerPool()
  })

  beforeEach(async () => {
    await E(`window.__poser(${JSON.stringify(TEXTE)})`)
    await pause()
  })

  afterEach(() => {
    assert.deepEqual(s!.logs, [], 'la console reste vide')
  })

  // les noms d'une liste « Un, Deux, Deux, Trois » dont la ligne d'origine est `origine` (0 ou 1 parmi les deux « Deux ») : un nom neuf, de la bonne forme, à la copie
  function verifier(liste: string[], origine: 'haut' | 'bas') {
    assert.equal(liste.length, 4, liste.join(' | '))
    const [deux1, deux2] = [liste[1], liste[2]]
    const [orig, copie] = origine === 'haut' ? [deux1, deux2] : [deux2, deux1]
    assert.equal(orig, 'Deux:bb22', 'l\'original garde son nom : ' + liste.join(' | '))
    assert.match(copie.split(':')[1], FORME, 'la copie reçoit un nom neuf : ' + liste.join(' | '))
    assert.notEqual(copie, 'Deux:bb22')
    assert.equal(liste[0], 'Un:aa11')
    assert.equal(liste[3], 'Trois:cc33')
  }

  const ORIGINE = ['Un:aa11', 'Deux:bb22', 'Trois:cc33']

  it('collée au-dessus de l\'originale : l\'original garde son nom, la copie en reçoit un neuf ; Ctrl+Z laisse l\'original, Ctrl+Y / Ctrl+Z répétés aussi', async function () {
    await E(`__caret('a1', 'Deux', 0)`)
    await E(`__coller('a1', ${JSON.stringify(LIGNE)})`)
    await pause()
    verifier(await noms(), 'bas')
    for (let i = 0; i < 3; i++) {
      await touche('Control+z')
      await pause()
      assert.deepEqual(await noms(), ORIGINE, `annuler (${i + 1}) : bb22 survit`)
      await touche('Control+y')
      await pause()
      verifier(await noms(), 'bas')
    }
  })

  it('collée en dessous de l\'originale : l\'original garde son nom, la copie en reçoit un neuf ; Ctrl+Z laisse l\'original, Ctrl+Y / Ctrl+Z répétés aussi', async function () {
    await E(`__caret('a1', 'Deux')`)
    await E(`__coller('a1', ${JSON.stringify(LIGNE)})`)
    await pause()
    verifier(await noms(), 'haut')
    for (let i = 0; i < 3; i++) {
      await touche('Control+z')
      await pause()
      assert.deepEqual(await noms(), ORIGINE, `annuler (${i + 1}) : bb22 survit`)
      await touche('Control+y')
      await pause()
      verifier(await noms(), 'haut')
    }
  })

  it('collée sans annulation : l\'original garde son nom, la copie un neuf, et un second collage donne encore un nom neuf', async function () {
    await E(`__caret('a1', 'Deux', 0)`)
    await E(`__coller('a1', ${JSON.stringify(LIGNE)})`)
    await pause()
    verifier(await noms(), 'bas')
    await E(`__caret('a1', 'Trois')`)
    await E(`__coller('a1', ${JSON.stringify(LIGNE)})`)
    await pause()
    const liste = await noms()
    const cles = liste.map((x) => x.split(':')[1])
    assert.equal(liste.length, 5, liste.join(' | '))
    assert.equal(new Set(cles).size, 5, 'aucun doublon : ' + liste.join(' | '))
    assert.equal(liste[2], 'Deux:bb22', 'l\'original garde son nom : ' + liste.join(' | '))
  })

  if (nom === 'chromium') it('aux vrais gestes (copier une ligne, la coller au début de sa ligne, annuler) : l\'original garde son nom', async function () {
    await E(`__caret('a1', 'Deux')`)
    await touche('Home')
    await touche('Shift+End')
    await touche('Control+c')
    await touche('Home')
    await touche('Control+v')
    await pause()
    verifier(await noms(), 'bas')
    await touche('Control+z')
    await pause()
    assert.deepEqual(await noms(), ORIGINE)
    await touche('Control+y')
    await pause()
    verifier(await noms(), 'bas')
  })

  it('Entrée au début d\'une ligne nommée puis Ctrl+Z : la ligne garde son nom (Firefox remet le texte dans la copie vide)', async function () {
    await E(`__caret('a1', 'Deux', 0)`)
    await touche('Enter')
    await pause()
    const apres = await noms()
    assert.equal(apres.length, 4, apres.join(' | '))
    assert.ok(apres.includes('Deux:bb22'), apres.join(' | '))
    await touche('Control+z')
    await pause()
    assert.deepEqual(await noms(), ORIGINE, 'annuler : bb22 survit')
  })
})
