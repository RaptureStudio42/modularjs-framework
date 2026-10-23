// module cœur editor (<@@editor answer>, le mode « répondre ») : la case d'une ligne à cocher (role="checkbox") ne contient plus le texte
// de la ligne. Un lien dans ce texte se retrouvait DANS la case : les enfants d'une case sont de simple présentation pour l'ARIA, et un
// contrôle dans un contrôle est une faute (nested-interactive). La case prend son nom du texte, posé à côté d'elle (aria-labelledby) ;
// le lien reste un lien. Le geste ne change pas : Espace sur la case la coche.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote, attendre, pause } from './helpers/coeur-monter.js'

const HOTE = `<script>
  $m = '<ul data-checklist><li>J\\'accepte <a href="https://exemple.fr/cgu">les conditions</a></li><li>Deux<ul data-checklist><li>Deux-un</li></ul></li></ul>'
</script>
<form class="f">
  <@@editor class="r" name="r" answer value={$m}></@@editor>
</form>`

describe('mjs-core-editor — la case d\'une ligne à cocher ne contient pas son lien', function () {
  this.timeout(60000)
  let window: any
  let hote: any
  let erreurs: string[]
  let surface: any
  before(async () => {
    ({ window, hote, erreurs } = await monterHote(HOTE, 'editeur-case-lien'))
    surface = hote._shadow.querySelector('.r')._shadow.querySelector('.surface')
    await attendre(() => surface.querySelectorAll('.line').length === 3)
    await pause(60)
  })
  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  const cases = (): any[] => Array.from(surface.querySelectorAll('.line'))
  const nomDe = (c: any): any => surface.getRootNode().getElementById(c.getAttribute('aria-labelledby') ?? '')

  it('la case ne contient ni lien ni autre élément focalisable, et garde son rôle, son état et sa place au clavier', () => {
    assert.equal(cases().length, 3)
    for (const c of cases()) {
      assert.equal(c.querySelectorAll('a, button, input, [href], [tabindex]').length, 0, 'rien de focalisable dans la case : ' + c.outerHTML)
      assert.deepEqual([c.getAttribute('role'), c.getAttribute('aria-checked'), c.getAttribute('tabindex')], ['checkbox', 'false', '0'])
      assert.ok(c.parentNode.firstElementChild === c, 'la case est le premier enfant de sa ligne de liste')
    }
  })

  it('la case prend son nom du texte de sa ligne (aria-labelledby), posé à côté d\'elle dans la même ligne ; le lien y reste un lien', () => {
    const noms = cases().map(nomDe)
    assert.ok(noms.every(Boolean), 'chaque case désigne un élément qui existe')
    assert.equal(new Set(cases().map((c) => c.getAttribute('aria-labelledby'))).size, 3, 'un nom par case')
    assert.deepEqual(noms.map((n: any) => n.textContent), ['J\'accepte les conditions', 'Deux', 'Deux-un'])
    assert.equal(noms[0].querySelector('a')?.getAttribute('href'), 'https://exemple.fr/cgu', 'le lien est dans le texte, hors de la case')
    noms.forEach((n: any, i: number) => assert.ok(n.parentNode === cases()[i].parentNode, 'le texte est dans la même ligne de liste que sa case'))
  })

  it('Espace sur la case la coche, le champ du formulaire suit', async () => {
    cases()[0].dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
    await pause(60)
    assert.equal(cases()[0].getAttribute('aria-checked'), 'true')
    const champs = [...new window.FormData(hote._shadow.querySelector('.f')).entries()].map(([k, v]: any) => k + '=' + v)
    assert.deepEqual(champs, ['r=0'])
    assert.equal(erreurs.length, 0, erreurs.join(' | '))
  })
})
