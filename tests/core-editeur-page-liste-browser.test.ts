// Une page qui emploie l'éditeur riche, la liste (<@@select>) et la liste triable (<@@sortable>) monte et marche dans Chromium, Firefox et WebKit
// réels, en construction de développement ET de production. Les trois modules déclarent chacun, au niveau du module, un nom de même valeur (un
// drapeau « déjà dit ») : au vrai chargement chaque module a sa portée, le harnais de développement (un seul script) doit la lui rendre.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { AIDES, BUILDS, MOTEURS, ouvrir, type Page, type Session } from './helpers/editeur-riche.js'

const PAGE: Page = {
  cle:     'page-liste',
  attente: `(() => {
    const h = document.querySelector('mjs-hote')
    const s = h && h._shadow
    if (!s) return false
    const e  = s.querySelector('.e')
    const se = s.querySelector('.s')
    const l  = s.querySelector('.l')
    return !!(e && e._shadow && e._shadow.querySelector('.surface') && se && se._shadow && se._shadow.children.length && l && l._shadow && l._shadow.children.length)
  })()`,
  aides:   AIDES,
  source:  `<script>
  $texte = '<p>Un texte</p>'
  $choix = '1'
  $liste = ['a', 'b', 'c']

  µmount ->
    window.__etat = -> { texte: $texte, choix: $choix, liste: $liste }
</script>

<form class="f" @noUJS>
  <@@editor class="e" name="contrat" value=!{$texte}></@@editor>
  <@@select class="s" name="choix" value=!{$choix}><@@option value="1">Un</@@option><@@option value="2">Deux</@@option></@@select>
  <@@sortable class="l" value=!{$liste}>{for x in $liste}<div class="x">{x}</div>{end}</@@sortable>
</form>
`,
}

for (const build of BUILDS) for (const nom of MOTEURS) describe(`page avec éditeur, liste et liste triable (${build}, ${nom} réel)`, function () {
  this.timeout(240000)
  let s: Session | null = null

  before(async () => {
    s = await ouvrir(nom, build, PAGE)
  })

  after(async () => {
    if (s) await s.fermer()
    await terminateSharedWorkerPool()
  })

  it('la page monte, les trois modules sont là et la console reste vide', async function () {
    if (!s) { this.skip(); return }
    const r = await s.page.evaluate(`(() => {
      const h = document.querySelector('mjs-hote')._shadow
      return {
        surface: !!h.querySelector('.e')._shadow.querySelector('.surface'),
        liste:   h.querySelector('.s')._shadow.children.length > 0,
        lignes:  h.querySelector('.l').querySelectorAll('.x').length
      }
    })()`)
    assert.equal(r.surface, true, 'l\'éditeur a sa surface')
    assert.equal(r.liste, true, 'la liste est dessinée')
    assert.equal(r.lignes, 3, 'la liste triable garde ses trois lignes')
    assert.deepEqual(s.logs, [], 'la console reste vide')
  })

  it('l\'éditeur de cette page marche : la frappe remonte vers la variable', async function () {
    if (!s) { this.skip(); return }
    await s.page.evaluate(`__caret('e', 'texte', 2)`)
    await s.page.keyboard.type('XY')
    await s.page.waitForTimeout(300)
    assert.match(await s.page.evaluate(`__etat().texte`), /<p>UnXY texte<\/p>/)
    assert.deepEqual(s.logs, [], 'la console reste vide')
  })
})
