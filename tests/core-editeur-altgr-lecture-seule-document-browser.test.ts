// Éditeur riche du cœur (<@@editor>) dans Chromium et Firefox réels, en construction de développement ET de production (la production envoie
// la forme sans mode « répondre » de la zone de texte) :
// - AltGr, que Windows transmet comme Ctrl+Alt, tape un caractère (« @ », « # », « ~ » d'un clavier français, belge, suisse, espagnol, allemand) : jamais
//   un raccourci ; Ctrl+Alt+2 sans AltGr reste le titre (clavier anglais, clavier français sous Linux), ⌘⌥2 aussi (Firefox sous macOS dit AltGraph pour ⌥) ;
// - lecture seule : Tab mène à la zone, comme dans une zone de texte en lecture seule (on y sélectionne et copie au clavier) ;
// - le texte d'attente de la zone vide est donné aux lecteurs d'écran (`aria-placeholder`, et l'arbre d'accessibilité de Chromium) ;
// - les réglages d'édition que l'éditeur pose au focus sont ceux du DOCUMENT entier : ils sont rendus à la sortie, une autre zone éditable de la page garde les siens ;
// - Chromium d'avant 137 (sans `getComposedRanges`, avec `ShadowRoot.getSelection`) : une sélection vide ne lève aucune erreur.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { BUILDS, ouvrir, type Moteur, type Session } from './helpers/editeur-riche.js'

const SOURCE = `<script>
  $v  = '<p>mail moi</p>'
  $ro = '<p>Texte en lecture seule</p>'
</script>
<@@editor class="e1" name="e1" value=!{$v}></@@editor>
<button class="avant">avant</button>
<@@editor class="ero" name="ro" readonly value={$ro}></@@editor>
<button class="apres">après</button>
<@@editor class="ev" name="v" placeholder="Écrivez ici" value=""></@@editor>
<pre class="o">{$v}</pre>`

const ATTENTE = `(() => {
  const s = document.querySelector('mjs-hote')?._shadow
  return !!(s && s.querySelector('.e1')?._shadow?.querySelector('.surface p') && s.querySelector('.ero')?._shadow?.querySelector('.surface p') && s.querySelector('.ev')?._shadow?.querySelector('.surface'))
})()`

const AIDES = `
window.__H = () => document.querySelector('mjs-hote')._shadow
window.__sf = (c) => __H().querySelector('.' + c)._shadow.querySelector('.surface')
window.__actif = (c) => __H().querySelector('.' + c)._shadow.activeElement === __sf(c)
window.__touche = (init) => {
  const sf = __sf('e1')
  sf.focus()
  const t = sf.querySelector('p, h2, h3').firstChild
  document.getSelection().setBaseAndExtent(t, 4, t, 4)
  const e = new KeyboardEvent('keydown', Object.assign({ bubbles: true, cancelable: true, composed: true }, init))
  sf.dispatchEvent(e)
  return e.defaultPrevented
}
window.__fin = (el) => { el.focus(); const t = el.lastChild; document.getSelection().setBaseAndExtent(t, t.nodeValue.length, t, t.nodeValue.length) }
window.__vide = (c) => { const sf = __sf(c); sf.focus(); const p = sf.querySelector('p'); document.getSelection().setBaseAndExtent(p, 0, p, 0) }
window.__clic = (c) => { const r = __H().querySelector('.' + c).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } }
`

const MOTEURS: Moteur[] = ['chromium', 'firefox']

for (const build of BUILDS) for (const nom of MOTEURS) describe(`éditeur riche : AltGr, lecture seule au clavier, texte d'attente, réglages du document (${build}, ${nom} réel)`, function () {
  this.timeout(240000)
  let s: Session | null = null

  const E     = (expr: string): Promise<any> => s!.page.evaluate(expr)
  const pause = (ms = 80) => s!.page.waitForTimeout(ms)
  const bloc  = () => E(`__sf('e1').innerHTML`)

  before(async () => { s = await ouvrir(nom, build, { source: SOURCE, cle: 'editeur-altgr-' + build, attente: ATTENTE, aides: AIDES }) })

  after(async () => {
    if (s) await s.fermer()
    await terminateSharedWorkerPool()
  })

  beforeEach(function () { if (!s) this.skip() })

  // en premier : aucun éditeur n'a encore eu le focus, le réglage lu au départ est celui du document
  it('les réglages d\'édition posés au focus sont rendus à la sortie : une autre zone éditable de la page garde les siens', async function () {
    await E(`document.body.insertAdjacentHTML('beforeend', '<div class="libre1" contenteditable="true">libre</div><div class="libre2" contenteditable="true">libre</div>')`)
    const avant = await E(`document.queryCommandValue('defaultParagraphSeparator')`)
    await E(`__fin(document.querySelector('.libre1'))`)
    await s!.page.keyboard.press('Enter')
    await pause()
    const html1 = await E(`document.querySelector('.libre1').innerHTML`)
    await E(`__sf('e1').focus()`)
    await pause()
    assert.equal(await E(`document.queryCommandValue('defaultParagraphSeparator')`), 'p', 'dans l\'éditeur, Entrée fait un paragraphe <p>')
    await E(`__fin(document.querySelector('.libre2'))`)
    await pause()
    const reglage = await E(`document.queryCommandValue('defaultParagraphSeparator')`)
    await s!.page.keyboard.press('Enter')
    await pause()
    assert.equal(await E(`document.querySelector('.libre2').innerHTML`), html1, 'Entrée fait dans l\'autre zone ce qu\'elle y faisait avant le focus de l\'éditeur')
    assert.equal(reglage, avant, 'sorti de l\'éditeur, le document retrouve son réglage')
  })

  it('AltGr tape « @ », « # », « ~ » : la touche n\'est pas annulée, le paragraphe ne change pas', async function () {
    for (const [k, code] of [['@', 'Digit0'], ['#', 'Digit3'], ['~', 'Digit2']]) {
      const annulee = await E(`__touche({ key: '${k}', code: '${code}', ctrlKey: true, altKey: true, modifierAltGraph: true })`)
      await pause()
      assert.equal(annulee, false, `AltGr+${code.slice(5)} (« ${k} ») : le caractère doit être tapé`)
      assert.equal(await bloc(), '<p>mail moi</p>', `AltGr+${code.slice(5)} (« ${k} ») : le paragraphe reste un paragraphe`)
    }
    assert.deepEqual(s!.logs, [])
  })

  it('Ctrl+Alt+2 sans AltGr reste le raccourci du titre, ⌘⌥2 aussi ; Ctrl+Alt+0 remet le paragraphe', async function () {
    const formes: [string, string][] = [
      ['clavier anglais', `{ key: '2', code: 'Digit2', ctrlKey: true, altKey: true }`],
      ['clavier français sous Linux', `{ key: 'é', code: 'Digit2', ctrlKey: true, altKey: true }`],
      ['Firefox sous macOS', `{ key: '™', code: 'Digit2', metaKey: true, altKey: true, modifierAltGraph: true }`],
    ]
    for (const [forme, init] of formes) {
      assert.equal(await E(`__touche(${init})`), true, `${forme} : le raccourci prend la touche`)
      await pause()
      assert.equal(await bloc(), '<h2>mail moi</h2>', `${forme} : le paragraphe devient un titre`)
      assert.equal(await E(`__touche({ key: '0', code: 'Digit0', ctrlKey: true, altKey: true })`), true)
      await pause()
      assert.equal(await bloc(), '<p>mail moi</p>', `${forme} : Ctrl+Alt+0 remet le paragraphe`)
    }
  })

  it('lecture seule : Tab mène à la zone, comme dans une zone de texte en lecture seule', async function () {
    await E(`__H().querySelector('.avant').focus()`)
    await s!.page.keyboard.press('Tab')
    await pause()
    assert.equal(await E(`__actif('ero')`), true, 'Tab depuis « avant » donne le focus à la zone en lecture seule')
    assert.equal(await E(`__sf('ero').getAttribute('contenteditable')`), 'false', 'la zone reste non éditable')
    await s!.page.keyboard.press('Tab')
    await pause()
    assert.equal(await E(`document.activeElement === document.querySelector('mjs-hote') && __H().activeElement === __H().querySelector('.apres')`), true, 'Tab suivant mène au bouton « après »')
  })

  it('texte d\'attente : donné aux lecteurs d\'écran tant que la zone est vide', async function () {
    assert.equal(await E(`__sf('ev').getAttribute('aria-placeholder')`), 'Écrivez ici')
    assert.equal(await E(`__sf('e1').hasAttribute('aria-placeholder')`), false, 'une zone qui a du texte n\'en a pas')
    if (nom === 'chromium') {
      const cdp = await s!.ctx.newCDPSession(s!.page)
      await cdp.send('Accessibility.enable')
      const { nodes } = await cdp.send('Accessibility.getFullAXTree')
      // le texte d'attente d'une zone de texte : une source de son nom, de type « placeholder », que le nom donné par `aria-label` passe mais qui reste exposée
      const attente = nodes.filter((n: any) => n.role?.value === 'textbox').flatMap((n: any) => (n.name?.sources ?? []).filter((x: any) => x.type === 'placeholder' && x.value).map((x: any) => x.attribute + ':' + x.value.value))
      assert.deepEqual(attente, ['aria-placeholder:Écrivez ici'], 'l\'arbre d\'accessibilité porte le texte d\'attente de la zone vide, et d\'elle seule')
      await cdp.detach()
    }
    await E(`__vide('ev')`)
    await s!.page.keyboard.type('a')
    await pause(150)
    assert.equal(await E(`__sf('ev').hasAttribute('aria-placeholder')`), false, 'du texte tapé : plus de texte d\'attente')
    await s!.page.keyboard.press('Backspace')
    await pause(150)
    assert.equal(await E(`__sf('ev').getAttribute('aria-placeholder')`), 'Écrivez ici', 'la zone redevenue vide le reprend')
  })

  it('sans getComposedRanges (Chromium d\'avant 137) : une sélection vide ne lève aucune erreur', async function () {
    if (!(await E(`typeof ShadowRoot.prototype.getSelection === 'function'`))) this.skip()
    const deja = s!.logs.length
    await E(`window.__gcr = Selection.prototype.getComposedRanges; delete Selection.prototype.getComposedRanges`)
    try {
      await E(`(() => { const sf = __sf('e1'); sf.focus(); const t = sf.querySelector('p').firstChild; document.getSelection().setBaseAndExtent(t, 1, t, 1) })()`)
      await pause(120)
      await E(`document.getSelection().removeAllRanges()`)
      await pause(150)
      const p = await E(`__clic('apres')`)
      await s!.page.mouse.click(p.x, p.y)
      await pause(150)
      assert.deepEqual(s!.logs.slice(deja), [], 'aucune erreur de page')
    }
    finally {
      await E(`Selection.prototype.getComposedRanges = window.__gcr`)
    }
  })
})
