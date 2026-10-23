// module cœur editor (<@@editor>) dans Chromium réel, la plateforme du navigateur dite « Win32 » : sous Windows, Ctrl et Alt de gauche
// tenus avec le 2 d'un clavier français tapent « ~ », qui est une touche morte : le navigateur ne dit pas « ~ » mais `Dead`, le tilde
// attend la touche suivante. La touche morte reste au navigateur comme un caractère : pas de titre, défaut non empêché. Un chiffre
// (clavier anglais, sans caractère AltGr) reste le raccourci du titre ; hors de Windows, Ctrl+Alt n'écrit rien et la touche morte aussi
// reste le raccourci.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { ouvrir, type Session } from './helpers/editeur-riche.js'

const SOURCE = `<script>
  $v = '<p>tilde ici</p>'
</script>
<@@editor class="e1" name="e1" value=!{$v}></@@editor>`

const ATTENTE = `(() => !!document.querySelector('mjs-hote')?._shadow?.querySelector('.e1')?._shadow?.querySelector('.surface p'))()`

const AIDES = `
window.__sf = () => document.querySelector('mjs-hote')._shadow.querySelector('.e1')._shadow.querySelector('.surface')
window.__touche = (init) => {
  const sf = __sf()
  sf.focus()
  const t = sf.querySelector('p, h2, h3').firstChild
  document.getSelection().setBaseAndExtent(t, 5, t, 5)
  const e = new KeyboardEvent('keydown', Object.assign({ bubbles: true, cancelable: true, composed: true }, init))
  sf.dispatchEvent(e)
  return e.defaultPrevented
}
window.__plateforme = (nom) => Object.defineProperty(Navigator.prototype, 'platform', { get: () => nom, configurable: true })
`

describe('éditeur riche : sous Windows, Ctrl+Alt sur une touche morte la laisse au navigateur (chromium réel)', function () {
  this.timeout(180000)
  let s: Session | null = null

  const E     = (expr: string): Promise<any> => s!.page.evaluate(expr)
  const pause = (ms = 80) => s!.page.waitForTimeout(ms)
  const bloc  = () => E(`__sf().innerHTML`)

  before(async () => { s = await ouvrir('chromium', 'dev', { source: SOURCE, cle: 'editeur-altgr-touche-morte', attente: ATTENTE, aides: AIDES }) })

  after(async () => {
    if (s) await s.fermer()
    await terminateSharedWorkerPool()
  })

  beforeEach(function () { if (!s) this.skip() })

  it('Windows, clavier français, Ctrl+Alt+2 (« ~ », touche morte) : ni titre ni défaut empêché', async () => {
    const ici = await E(`navigator.platform`)
    await E(`__plateforme('Win32')`)
    try {
      const annulee = await E(`__touche({ key: 'Dead', code: 'Digit2', ctrlKey: true, altKey: true })`)
      await pause()
      assert.equal(annulee, false, 'la touche morte doit rester au navigateur, qui compose le tilde')
      assert.equal(await bloc(), '<p>tilde ici</p>', 'le paragraphe reste un paragraphe')
    }
    finally {
      await E(`__plateforme(${JSON.stringify(ici)})`)
    }
  })

  it('Windows, clavier anglais : un chiffre sans caractère reste le raccourci (Ctrl+Alt+2 titre, Ctrl+Alt+0 paragraphe)', async () => {
    const ici = await E(`navigator.platform`)
    await E(`__plateforme('Win32')`)
    try {
      assert.equal(await E(`__touche({ key: '2', code: 'Digit2', ctrlKey: true, altKey: true })`), true)
      await pause()
      assert.equal(await bloc(), '<h2>tilde ici</h2>')
      assert.equal(await E(`__touche({ key: '0', code: 'Digit0', ctrlKey: true, altKey: true })`), true)
      await pause()
      assert.equal(await bloc(), '<p>tilde ici</p>')
    }
    finally {
      await E(`__plateforme(${JSON.stringify(ici)})`)
    }
  })

  it('hors de Windows : Ctrl+Alt sur une touche morte reste le raccourci du titre', async () => {
    assert.equal(await E(`/^Win/.test(navigator.platform)`), false)
    assert.equal(await E(`__touche({ key: 'Dead', code: 'Digit2', ctrlKey: true, altKey: true })`), true)
    await pause()
    assert.equal(await bloc(), '<h2>tilde ici</h2>')
    assert.equal(await E(`__touche({ key: 'Dead', code: 'Digit0', ctrlKey: true, altKey: true })`), true)
    await pause()
    assert.equal(await bloc(), '<p>tilde ici</p>')
    assert.deepEqual(s!.logs, [])
  })
})
