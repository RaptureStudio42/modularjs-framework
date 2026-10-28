// module cœur editor (<@@editor>), vrais navigateurs (Chromium, Firefox, WebKit) : le focus donné par la page.
// - `autofocus` : l'éditeur prend le focus dès qu'il est monté, même posé par un `{if}` après un clic (un `.focus()` appelé à l'attache tombe avant le montage) ;
//   un éditeur désactivé ne le prend pas ;
// - `caret="end"` : quand la page donne le focus (`autofocus`, `.focus()` de la balise), le curseur se pose à la fin du texte, pour continuer un texte rouvert,
//   et un long texte défile jusqu'à lui, même quand la page pose une autre valeur dans le même geste (elle n'est rendue qu'au tour suivant) ; la zone qui a
//   déjà le focus garde son curseur. Sans `caret`, rien ne change.
// La frappe qui suit le dit : la lettre tapée arrive à la fin du texte, ou au début.

import assert from 'node:assert/strict'
import { ouvrir } from './helpers/editeur-riche.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const TEXTE = '<p>Premier paragraphe</p><p>Deux trois</p>'

const SOURCE = `<script>
  $long = ''
  $fin2 = '<p>Ancien</p>'
  $a    = false
  $b    = false
  $c    = false

  µmount ->
    $long = [1..80].map((i)-> '<p>Ligne ' + i + '</p>').join('')
    window.__rouvrir = ->
      $fin2 = '<p>Texte rouvert</p><p>Fin du texte</p>'
      document.querySelector('mjs-hote')._shadow.querySelector('.fin2').focus()
    window.__ouvrir = (k)->
      if k == 'a' then $a = true
      else if k == 'b' then $b = true
      else $c = true
</script>

<button type="button" class="avant">avant</button>
<@@editor class="sans" name="sans" toolbar="none" value="${TEXTE}"></@@editor>
<@@editor class="fin" name="fin" toolbar="none" caret="end" value="${TEXTE}"></@@editor>
<@@editor class="long" name="long" toolbar="none" caret="end" value=!{$long}></@@editor>
<@@editor class="fin2" name="fin2" toolbar="none" caret="end" value=!{$fin2}></@@editor>
{if $a}
  <@@editor class="a" name="a" toolbar="none" autofocus value="${TEXTE}"></@@editor>
{end}
{if $b}
  <@@editor class="b" name="b" toolbar="none" autofocus caret="end" value="${TEXTE}"></@@editor>
{end}
{if $c}
  <@@editor class="c" name="c" toolbar="none" autofocus disabled value="${TEXTE}"></@@editor>
{end}
`

const ATTENTE = `(() => { const H = document.querySelector('mjs-hote')?._shadow; return !!(H && ['sans', 'fin'].every((c) => H.querySelector('.' + c)?._shadow?.querySelector('.surface p')) && H.querySelector('.long')?._shadow?.querySelectorAll('.surface p').length === 80) })()`

const AIDES = `
window.__H = () => document.querySelector('mjs-hote')._shadow
window.__ed = (c) => __H().querySelector('.' + c)
window.__sf = (c) => __ed(c)._shadow.querySelector('.surface')
window.__val = (c) => __ed(c).querySelector(':scope > input[type=hidden]').value
window.__deep = () => { let a = document.activeElement; while (a && (a._shadow || a.shadowRoot) && (a._shadow || a.shadowRoot).activeElement) a = (a._shadow || a.shadowRoot).activeElement; if (!a) return 'rien'; const h = a.getRootNode().host; return (h && h.classList.length ? h.classList[0] + ' ' : '') + a.tagName.toLowerCase() + '.' + a.className }
window.__avant = () => __H().querySelector('.avant').focus()
window.__debut = (c) => { const sf = __sf(c); sf.focus(); const t = sf.querySelector('p').firstChild; document.getSelection().setBaseAndExtent(t, 0, t, 0) }
`

for (const moteur of ['chromium', 'firefox', 'webkit'] as const) {
  describe(`mjs-core-editor — autofocus et curseur à la fin (${moteur} réel)`, function () {
    this.timeout(180000)
    let s: any = null
    after(async () => { await s?.fermer(); await terminateSharedWorkerPool() })

    before(async function () {
      s = await ouvrir(moteur, 'dev', { source: SOURCE, cle: 'editeur-autofocus', attente: ATTENTE, aides: AIDES })
      if (!s) this.skip()
    })

    // la lettre tapée au clavier, puis la valeur du champ de l'éditeur
    const taper = async (c: string, lettre: string): Promise<string> => {
      await s.page.keyboard.type(lettre)
      await s.page.waitForTimeout(120)
      return s.page.evaluate(`__val('${c}')`)
    }

    // l'éditeur posé par un `{if}`, le focus d'abord sur le bouton « avant » (celui qui ouvre, dans une vraie page)
    const poser = async (k: string): Promise<void> => {
      await s.page.evaluate(`__avant()`)
      await s.page.evaluate(`__ouvrir('${k}')`)
      await s.page.waitForFunction(`!!__H().querySelector('.${k}')?._shadow?.querySelector('.surface p')`, null, { timeout: 10000 })
      await s.page.waitForTimeout(150)
    }

    it('sans `autofocus`, le chargement ne donne le focus à aucun éditeur', async () => {
      assert.ok(!/surface/.test(await s.page.evaluate(`__deep()`)), await s.page.evaluate(`__deep()`))
    })

    it('`autofocus` sur un éditeur posé par un `{if}` : le focus est dans son texte dès le montage', async () => {
      await poser('a')
      assert.equal(await s.page.evaluate(`__deep()`), 'a div.surface')
      assert.match(await taper('a', 'Z'), /Z/)
    })

    it('`autofocus` et `caret="end"` : le curseur est à la fin du texte', async () => {
      await poser('b')
      assert.equal(await s.page.evaluate(`__deep()`), 'b div.surface')
      assert.equal(await taper('b', 'X'), '<p>Premier paragraphe</p><p>Deux troisX</p>')
    })

    it('`autofocus` sur un éditeur désactivé : le focus reste où il était', async () => {
      await poser('c')
      assert.equal(await s.page.evaluate(`__deep()`), 'button.avant')
    })

    it('`.focus()` de la balise et `caret="end"` : le curseur est à la fin du texte', async () => {
      await s.page.evaluate(`__avant()`)
      await s.page.evaluate(`__ed('fin').focus()`)
      await s.page.waitForTimeout(80)
      assert.equal(await s.page.evaluate(`__deep()`), 'fin div.surface')
      assert.equal(await taper('fin', 'Y'), '<p>Premier paragraphe</p><p>Deux troisY</p>')
    })

    it('`.focus()` sur une zone qui a déjà le focus : le curseur ne bouge pas', async () => {
      await s.page.evaluate(`__debut('fin')`)
      await s.page.evaluate(`__ed('fin').focus()`)
      await s.page.waitForTimeout(80)
      assert.equal(await taper('fin', 'W'), '<p>WPremier paragraphe</p><p>Deux troisY</p>')
    })

    it('`caret="end"` sur un long texte : la zone défile jusqu\'au curseur', async () => {
      await s.page.evaluate(`__avant()`)
      await s.page.evaluate(`__ed('long').focus()`)
      await s.page.waitForTimeout(120)
      const [haut, vue, total] = await s.page.evaluate(`[__sf('long').scrollTop, __sf('long').clientHeight, __sf('long').scrollHeight]`)
      assert.ok(total > vue * 2, `le texte dépasse la zone (${total} > 2 × ${vue})`)
      assert.ok(haut + vue >= total - 2, `défilé jusqu'en bas (${haut} + ${vue} ≥ ${total})`)
      assert.match(await taper('long', 'V'), /<p>Ligne 80V<\/p>$/)
    })

    it('texte rouvert : la page pose une autre valeur et donne le focus dans le même geste, le curseur est à la fin du nouveau texte', async () => {
      await s.page.evaluate(`__avant()`)
      await s.page.evaluate(`__rouvrir()`)
      await s.page.waitForTimeout(120)
      assert.equal(await s.page.evaluate(`__deep()`), 'fin2 div.surface')
      assert.equal(await taper('fin2', 'T'), '<p>Texte rouvert</p><p>Fin du texteT</p>')
    })

    it('sans `caret`, `.focus()` garde la place que le navigateur donne : le début', async () => {
      await s.page.evaluate(`__avant()`)
      await s.page.evaluate(`__ed('sans').focus()`)
      await s.page.waitForTimeout(80)
      assert.equal(await s.page.evaluate(`__deep()`), 'sans div.surface')
      assert.equal(await taper('sans', 'U'), '<p>UPremier paragraphe</p><p>Deux trois</p>')
    })

    it('aucune erreur dans la console', () => {
      assert.deepEqual(s.logs.filter((l: string) => !/favicon/.test(l)), [])
    })
  })
}
