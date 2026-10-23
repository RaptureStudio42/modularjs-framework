// module cœur editor (<@@editor>) dans Chromium réel, la plateforme du navigateur dite « Win32 » : sous Windows, Ctrl+Alt vaut AltGr.
// Ctrl et Alt de gauche tenus avec 0, 2 ou 3 d'un clavier français tapent « @ », « ~ », « # », et le navigateur peut ne pas y mettre le
// drapeau AltGraph : la touche qui donne un caractère l'écrit, le raccourci ne la prend pas. Un chiffre (clavier anglais, sans caractère
// AltGr) reste le raccourci du titre et du paragraphe. Hors de Windows (Linux, macOS), Ctrl+Alt n'écrit rien : le raccourci reste, même quand
// la touche dit un caractère (« é » d'un clavier français sous Linux).

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { ouvrir, type Session } from './helpers/editeur-riche.js'

const SOURCE = `<script>
  $v = '<p>mail moi</p>'
</script>
<@@editor class="e1" name="e1" value=!{$v}></@@editor>`

const ATTENTE = `(() => !!document.querySelector('mjs-hote')?._shadow?.querySelector('.e1')?._shadow?.querySelector('.surface p'))()`

const AIDES = `
window.__sf = () => document.querySelector('mjs-hote')._shadow.querySelector('.e1')._shadow.querySelector('.surface')
window.__touche = (init) => {
  const sf = __sf()
  sf.focus()
  const t = sf.querySelector('p, h2, h3').firstChild
  document.getSelection().setBaseAndExtent(t, 4, t, 4)
  const e = new KeyboardEvent('keydown', Object.assign({ bubbles: true, cancelable: true, composed: true }, init))
  sf.dispatchEvent(e)
  return e.defaultPrevented
}
window.__plateforme = (nom) => Object.defineProperty(Navigator.prototype, 'platform', { get: () => nom, configurable: true })
`

describe('éditeur riche : sous Windows, Ctrl+Alt qui tape un caractère l\'écrit (chromium réel)', function () {
  this.timeout(180000)
  let s: Session | null = null

  const E     = (expr: string): Promise<any> => s!.page.evaluate(expr)
  const pause = (ms = 80) => s!.page.waitForTimeout(ms)
  const bloc  = () => E(`__sf().innerHTML`)

  before(async () => { s = await ouvrir('chromium', 'dev', { source: SOURCE, cle: 'editeur-altgr-windows', attente: ATTENTE, aides: AIDES }) })

  after(async () => {
    if (s) await s.fermer()
    await terminateSharedWorkerPool()
  })

  beforeEach(function () { if (!s) this.skip() })

  it('Windows, clavier français, Ctrl+Alt de gauche sans drapeau AltGraph : « @ », « ~ », « # » s\'écrivent, le paragraphe ne change pas', async () => {
    const ici = await E(`navigator.platform`)
    await E(`__plateforme('Win32')`)
    try {
      for (const [k, code] of [['@', 'Digit0'], ['~', 'Digit2'], ['#', 'Digit3']]) {
        const annulee = await E(`__touche({ key: '${k}', code: '${code}', ctrlKey: true, altKey: true })`)
        await pause()
        assert.equal(annulee, false, `Ctrl+Alt+${code.slice(5)} (« ${k} ») : le caractère doit être tapé`)
        assert.equal(await bloc(), '<p>mail moi</p>', `Ctrl+Alt+${code.slice(5)} (« ${k} ») : le paragraphe reste un paragraphe`)
      }
    }
    finally {
      await E(`__plateforme(${JSON.stringify(ici)})`)
    }
  })

  it('Windows, clavier anglais : Ctrl+Alt+2 reste le titre, Ctrl+Alt+0 remet le paragraphe', async () => {
    const ici = await E(`navigator.platform`)
    await E(`__plateforme('Win32')`)
    try {
      assert.equal(await E(`__touche({ key: '2', code: 'Digit2', ctrlKey: true, altKey: true })`), true)
      await pause()
      assert.equal(await bloc(), '<h2>mail moi</h2>')
      assert.equal(await E(`__touche({ key: '0', code: 'Digit0', ctrlKey: true, altKey: true })`), true)
      await pause()
      assert.equal(await bloc(), '<p>mail moi</p>')
    }
    finally {
      await E(`__plateforme(${JSON.stringify(ici)})`)
    }
  })

  it('hors de Windows : Ctrl+Alt+2 d\'un clavier français sous Linux (« é ») reste le titre', async () => {
    assert.equal(await E(`/^Win/.test(navigator.platform)`), false)
    assert.equal(await E(`__touche({ key: 'é', code: 'Digit2', ctrlKey: true, altKey: true })`), true)
    await pause()
    assert.equal(await bloc(), '<h2>mail moi</h2>')
    assert.equal(await E(`__touche({ key: 'à', code: 'Digit0', ctrlKey: true, altKey: true })`), true)
    await pause()
    assert.equal(await bloc(), '<p>mail moi</p>')
    assert.deepEqual(s!.logs, [])
  })
})
