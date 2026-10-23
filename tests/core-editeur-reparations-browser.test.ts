// Éditeur de texte riche du cœur (<@@editor>, <@@toolbar>) dans Chromium, Firefox et WebKit réels, en construction de développement ET de
// production : ce que la page voit de l'éditeur et comment il tient dans son entourage.
// - `@input` posé sur l'éditeur ne reçoit que l'événement de l'éditeur (une fois par modification, données = le HTML) : jamais l'`input`
//   natif de la surface ni celui du champ d'adresse du lien ; `@click` et `@keydown` natifs, eux, arrivent toujours ;
//   (le premier éditeur a une barre `toolbar="link"` : Ctrl+K n'ouvre le champ d'adresse que sur un éditeur dont la barre montre le lien) ;
// - <@@field> enveloppe l'éditeur comme les autres champs : nom accessible et aria-invalid sur la surface, clic sur l'étiquette = focus ;
// - une barre posée à part se branche dès que l'éditeur visé apparaît (dans un {if}) et se débranche quand il disparaît ;
// - la description des cases suit la langue de la page après une bascule à chaud ;
// - le nettoyeur : jamais de balise en ligne vide, gras de Word gardé, <pre> sans retour perdu, nettoyer deux fois = nettoyer une fois,
//   y compris sur un tirage de gestes réels (clavier, barre, collage) dont la graine est fixe.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { AIDES, BUILDS, MOTEURS, ouvrir, type Page, type Session } from './helpers/editeur-riche.js'

const SOURCE = `<script>
  $x     = '<p>Contrat important</p>'
  $cf    = '<p>Dans un champ</p>'
  $tard  = '<p>Tardif</p>'
  $vue   = false
  $liste = '<ul data-checklist><li data-checked>Fait</li><li>À faire</li></ul>'
  $notes = ''
  $gx    = ''
  $gc    = ''

  @noter = (e)->
    window.__evts.push(e.type + '|' + e.constructor.name + '|' + typeof e.data + '|' + String(e.data))

  @natif = (e)->
    window.__natifs.push(e.type + '|' + e.isTrusted)

  µmount ->
    window.__montrer  = -> $vue = true
    window.__cacher   = -> $vue = false
    window.__langue   = (l)-> µlang = l
    window.__erreurs  = (e)-> µres.errors = e
    window.__poser    = (v)-> $notes = v
    window.__lireX    = -> $x
    window.__lireGx   = -> $gx
    window.__poserGx  = (v)-> $gx = v
    window.__poserGc  = (v)-> $gc = v
</script>

<@@editor class="e" name="e" toolbar="link" value=!{$x} @input={@noter(e)} @click={@natif(e)} @keydown={@natif(e)}></@@editor>
<@@field class="f" label="Contrat" help="Aide du contrat"><@@editor class="ef" name="cf" toolbar="none" value=!{$cf}></@@editor></@@field>
<@@toolbar class="tbt" for="et"></@@toolbar>
{if $vue}
  <@@editor id="et" class="et" name="et" toolbar="none" value={$tard}></@@editor>
{end}
<@@editor class="el" name="el" toolbar="none" value={$liste}></@@editor>
<@@editor class="en" name="en" toolbar="none" value=!{$notes}></@@editor>
<@@editor class="ge" name="ge" value=!{$gx}></@@editor>
<@@editor class="gc" name="gc" toolbar="none" value=!{$gc}></@@editor>
`

const ATTENTE = `(() => {
  const h = document.querySelector('mjs-hote')
  const q = (c) => h && h._shadow && h._shadow.querySelector('.' + c)
  const s = (c) => { const e = q(c); return !!(e && e._shadow && e._shadow.querySelector('.surface')) }
  const b = q('ge') && q('ge')._shadow && q('ge')._shadow.querySelector('mjs-core-toolbar')
  return s('e') && s('ef') && s('el') && s('en') && s('ge') && s('gc') && !!(b && b._shadow && b._shadow.querySelector('button'))
})()`

const AIDES_PAGE = AIDES + `
window.__evts = []
window.__natifs = []
window.__tbtn = (t) => __H().querySelector('.tbt')._shadow.querySelector('[data-tool="' + t + '"]')
window.__grises = () => [...__H().querySelector('.tbt')._shadow.querySelectorAll('button')].map((b) => b.getAttribute('aria-disabled') === 'true')
window.__gbtn = (t) => __ed('ge')._shadow.querySelector('mjs-core-toolbar')._shadow.querySelector('[data-tool="' + t + '"]')
window.__getat = () => __ed('ge')._mjsState()
window.__dedans = () => !!__ed('ge')._shadow.activeElement
const PERMIS = { p: [], h2: [], h3: [], blockquote: [], strong: [], em: [], u: [], s: [], a: ['href'], ul: ['data-checklist'], ol: [], li: ['data-checked', 'data-key'], br: [] }
window.__audit = (html) => {
  const mal = []
  const t = document.createElement('template')
  t.innerHTML = html
  const marche = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) continue
      if (c.nodeType !== 1) { mal.push('noeud'); continue }
      const tag = c.localName
      if (!(tag in PERMIS)) { mal.push('balise ' + tag); continue }
      for (const a of c.attributes) if (!PERMIS[tag].includes(a.name)) mal.push(tag + '@' + a.name)
      if (c.hasAttribute('data-key') && !(/^[a-z][a-z0-9]{3}$/.test(c.getAttribute('data-key')) && c.parentNode.hasAttribute && c.parentNode.hasAttribute('data-checklist'))) mal.push('data-key ' + c.getAttribute('data-key'))
      if (!c.firstChild && tag !== 'br') mal.push('balise vide ' + tag)
      marche(c)
    }
  }
  marche(t.content)
  return mal
}
`

const PAGE: Page = { source: SOURCE, cle: 'reparations', attente: ATTENTE, aides: AIDES_PAGE }

// [ce que le cas vérifie, le HTML qui entre, le HTML propre attendu]
const NETTOYAGES: Array<[string, string, string]> = [
  ['gras terminé par une espace', '<p>gamma delta<b> </b></p>', '<p>gamma delta</p>'],
  ['italique terminé par une espace', '<p>x<em> </em></p>', '<p>x</p>'],
  ['souligné et barré terminés par une espace', '<p>x<u> </u><s> </s></p>', '<p>x</p>'],
  ['lien réduit à une espace', '<p>a<a href="https://x.test/"> </a></p>', '<p>a</p>'],
  ['balise vide au bout d\'une ligne de liste', '<ul><li>a<b> </b></li></ul>', '<ul><li>a</li></ul>'],
  ['balise vide au bout d\'un titre', '<h2>titre<b> </b></h2>', '<h2>titre</h2>'],
  ['lien, une espace, un retour à la ligne', '<p><a href="https://x.test/">lien</a> <br>suite</p>', '<p><a href="https://x.test/">lien<br></a>suite</p>'],
  ['gras de Word (mso-bidi-font-weight:normal sur un <b>)', '<b style=\'mso-bidi-font-weight:normal\'>Titre</b>', '<p><strong>Titre</strong></p>'],
  ['gras de Word en <span>, la propriété de Word d\'abord', '<span style=\'mso-bidi-font-weight:normal;font-weight:bold\'>x</span>', '<p><strong>x</strong></p>'],
  ['un bloc <pre> garde le retour à la ligne de chaque ligne', '<pre>a\nb\n\nc</pre>', '<p>a<br>b<br><br>c</p>'],
  ['un <pre><code> aussi, et le paragraphe qui suit reste à part', '<pre><code>x\ny</code></pre><p>z</p>', '<p>x<br>y</p><p>z</p>']
]

const MOTS = ['alpha', 'beta', 'x', ' ', 'é', 'gamma delta', '1', '— ']
const GESTES: Array<[string, number]> = [
  ['type', 9], ['Enter', 6], ['Shift+Enter', 1], ['Backspace', 4], ['Delete', 1], ['Tab', 2], ['Shift+Tab', 2],
  ['Control+b', 2], ['Control+i', 1], ['Control+u', 1], ['Control+Shift+x', 1], ['Control+Enter', 2], ['Control+a', 1],
  ['ArrowLeft', 2], ['ArrowRight', 2], ['ArrowUp', 2], ['ArrowDown', 2], ['Home', 1], ['End', 1], ['Shift+ArrowLeft', 2], ['Shift+ArrowUp', 1],
  ['btn:h2', 1], ['btn:h3', 1], ['btn:quote', 1], ['btn:ul', 2], ['btn:ol', 2], ['btn:check', 3], ['btn:clear', 1], ['btn:undo', 2], ['btn:redo', 1], ['btn:bold', 1], ['btn:italic', 1],
  ['paste:p2', 1], ['paste:ul', 1], ['paste:h1', 1], ['paste:b', 1], ['paste:txt', 1]
]
const POIDS   = GESTES.reduce((a, [, w]) => a + w, 0)
const COLLAGES: Record<string, [string, string]> = {
  'paste:p2': ['<p>p1</p><p>p2</p>', ''],
  'paste:ul': ['<ul><li>a</li><li>b</li></ul>', ''],
  'paste:h1': ['<h1>titre</h1><p>suite</p>', ''],
  'paste:b':  ['<b>gras</b> <a href="https://x.test/">lien</a>', ''],
  'paste:txt': ['', 'ligne un\n\nligne deux\nsuite']
}
const GRAINES = [1012, 1000, 1001, 1002, 1003, 1004]
const NB_GESTES = 22

// générateur pseudo-aléatoire à graine : le même tirage à chaque exécution
function hasard(graine: number) {
  return () => {
    graine |= 0
    graine  = (graine + 0x6D2B79F5) | 0
    let t = Math.imul(graine ^ (graine >>> 15), 1 | graine)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

for (const build of BUILDS) for (const nom of MOTEURS) describe(`éditeur riche : ce que la page en voit (${build}, ${nom} réel)`, function () {
  this.timeout(240000)
  let s: Session | null = null
  let bilan: string[] = []

  const E      = (expr: string): Promise<any> => s!.page.evaluate(expr)
  const pause  = (ms = 80) => s!.page.waitForTimeout(ms)
  const check  = (nomEssai: string, ok: any, detail: any = '') => { if (!ok) bilan.push(`${nomEssai} — ${String(detail).slice(0, 400)}`) }
  const fin    = () => assert.deepEqual(bilan, [], 'essais en échec')
  // relit une expression jusqu'à ce qu'elle rende la valeur attendue (au plus ~0,6 s) : la dernière lecture est rendue, bonne ou non
  const jusqua = async (expr: string, attendu: string): Promise<string> => {
    let v: string = await E(expr)
    for (let i = 0; i < 40 && v !== attendu; i++) { await s!.page.waitForTimeout(15); v = await E(expr) }
    return v
  }
  const clic   = async (expr: string) => {
    const p = await E(expr)
    await s!.page.mouse.click(p.x, p.y)
    await pause()
  }

  before(async () => { s = await ouvrir(nom, build, PAGE) })

  after(async () => {
    if (s) await s.fermer()
    await terminateSharedWorkerPool()
  })

  beforeEach(function () {
    if (!s) { this.skip(); return }
    bilan = []
  })

  it('input : la page ne reçoit que l\'événement de l\'éditeur, une fois par modification, données = le HTML', async function () {
    check('démarrage sans erreur ni avertissement', s!.logs.length === 0, s!.logs.join(' | '))
    await E(`__caret('e')`)
    await s!.page.keyboard.type('!')
    await pause(150)
    let evts: string[] = await E('window.__evts')
    check('une frappe : un seul événement, celui de l\'éditeur, avec le HTML', evts.length === 1 && evts[0] === 'input|CustomEvent|string|<p>Contrat important!</p>', JSON.stringify(evts))
    await s!.page.keyboard.press('Backspace')
    await pause(150)
    evts = await E('window.__evts')
    check('Retour arrière : un seul événement de plus, avec le HTML', evts.length === 2 && evts[1] === 'input|CustomEvent|string|<p>Contrat important</p>', JSON.stringify(evts))
    await s!.page.keyboard.press('Enter')
    await s!.page.keyboard.press('Backspace')
    await pause(150)
    evts = await E('window.__evts')
    check('Entrée puis Retour arrière (le HTML ne change pas) : aucun événement', evts.length === 2, JSON.stringify(evts))
    await s!.page.keyboard.press('Control+a')
    await s!.page.keyboard.press('Control+k')
    await pause(200)
    check('le champ d\'adresse du lien est ouvert et a le focus', (await E('__deep()')).startsWith('input.link-url'), await E('__deep()'))
    await s!.page.keyboard.type('abc')
    await pause(150)
    evts = await E('window.__evts')
    check('la frappe dans le champ d\'adresse du lien n\'arrive pas à la page', evts.length === 2, JSON.stringify(evts))
    await s!.page.keyboard.press('Escape')
    await pause(150)
    const natifs: string[] = await E('window.__natifs')
    check('les touches natives arrivent toujours (@keydown posé sur l\'éditeur)', natifs.filter((n) => n === 'keydown|true').length >= 4, JSON.stringify(natifs))
    await clic(`__center(__sf('e'))`)
    const apres: string[] = await E('window.__natifs')
    check('le clic natif arrive toujours (@click posé sur l\'éditeur)', apres.includes('click|true'), JSON.stringify(apres))
    evts = await E('window.__evts')
    check('le clic ne fabrique aucun événement input', evts.length === 2, JSON.stringify(evts))
    check('la variable de la page suit', (await E('__lireX()')) === '<p>Contrat important</p>', await E('__lireX()'))
    fin()
  })

  it('<@@field> enveloppe l\'éditeur comme les autres champs : nom accessible, aria-invalid, clic sur l\'étiquette', async function () {
    const nomSurface = () => E(`__sf('ef').getAttribute('aria-label')`)
    check('la surface porte le libellé du champ comme nom accessible', (await nomSurface()) === 'Contrat', await nomSurface())
    check('pas d\'aria-invalid au départ', (await E(`__sf('ef').hasAttribute('aria-invalid')`)) === false)
    await E(`window.__erreurs({ cf: ['Trop court'] })`)
    await pause(300)
    check('en erreur : aria-invalid="true" sur la surface', (await E(`__sf('ef').getAttribute('aria-invalid')`)) === 'true', await E(`__sf('ef').getAttribute('aria-invalid')`))
    await E(`window.__erreurs({})`)
    await pause(300)
    check('au succès : aria-invalid retiré de la surface', (await E(`__sf('ef').hasAttribute('aria-invalid')`)) === false)
    await clic(`(() => { const l = __ed('f')._shadow.querySelector('label'); l.scrollIntoView({ block: 'center' }); const r = l.getBoundingClientRect(); return { x: r.left + 6, y: r.top + r.height / 2 } })()`)
    check('clic sur l\'étiquette : le focus est dans la surface de l\'éditeur', (await E('__deep()')).startsWith('div.surface'), await E('__deep()'))
    fin()
  })

  it('barre posée à part : branchée dès que l\'éditeur visé apparaît, débranchée quand il disparaît', async function () {
    check('sans éditeur : tous les boutons sont grisés', await E(`__grises().length === 14 && __grises().every((g) => g)`), await E('JSON.stringify(__grises())'))
    await E('__montrer()')
    await pause(600)
    check('l\'éditeur est apparu', await E(`!!__ed('et')?._shadow?.querySelector('.surface')`))
    check('sans aucun clic : plus aucun bouton grisé, sauf défaire et refaire (l\'éditeur apparu n\'a rien à défaire)', await E(`[...__H().querySelector('.tbt')._shadow.querySelectorAll('button')].every((b) => (b.getAttribute('aria-disabled') === 'true') === ['undo', 'redo'].includes(b.dataset.tool))`), await E('JSON.stringify(__grises())'))
    await E(`__selText('et', 'Tardif')`)
    await clic(`__center(__tbtn('bold'))`)
    check('le bouton agit sur l\'éditeur apparu (le champ porte le gras propre)', (await E(`__hid('et').value`)) === '<p><strong>Tardif</strong></p>', await E(`__hid('et').value`))
    check('le bouton « défaire » s\'allume : l\'éditeur apparu a de quoi défaire', (await E(`__tbtn('undo').getAttribute('aria-disabled')`)) === 'false', await E(`__tbtn('undo').getAttribute('aria-disabled')`))
    await E('__cacher()')
    await pause(500)
    check('l\'éditeur est parti', await E(`!__ed('et')`))
    check('barre débranchée : tous les boutons grisés de nouveau', await E(`__grises().every((g) => g)`), await E('JSON.stringify(__grises())'))
    fin()
  })

  it('langue : la description des cases suit la langue de la page après une bascule à chaud', async function () {
    const descriptions = () => E(`[...__sf('el').querySelectorAll('li')].map((li) => li.getAttribute('aria-description')).join('|')`)
    check('français au départ', (await descriptions()) === 'Case cochée|Case non cochée', await descriptions())
    await E(`window.__langue('en')`)
    await pause(600)
    check('anglais après la bascule', (await descriptions()) === 'Checked box|Unchecked box', await descriptions())
    await E(`window.__langue('fr')`)
    await pause(600)
    check('français de nouveau', (await descriptions()) === 'Case cochée|Case non cochée', await descriptions())
    fin()
  })

  it('nettoyeur : balise vide jamais émise, gras de Word gardé, <pre> sans retour perdu, nettoyer deux fois = nettoyer une fois', async function () {
    const champ = (): Promise<string> => E(`__hid('en').value`)
    for (const [cas, entree, attendu] of NETTOYAGES) {
      await E(`window.__poser(${JSON.stringify(entree)})`)
      await pause(120)
      const une = await champ()
      check(`${cas} : HTML propre`, une === attendu, JSON.stringify(une))
      await E(`window.__poser(${JSON.stringify(une)})`)
      await pause(120)
      const deux = await champ()
      check(`${cas} : idempotent`, deux === une, JSON.stringify([une, deux]))
    }
    fin()
  })

  it('la console reste sans erreur ni avertissement', async function () {
    check('aucune erreur de console', s!.logs.length === 0, s!.logs.join(' | '))
    fin()
  })

  it('tirage de gestes réels (graine fixe) : liste permise, variable = champ, nettoyer deux fois = nettoyer une fois', async function () {
    const violations: string[] = []
    for (const graine of GRAINES) {
      const hasardeux = hasard(graine)
      await E(`__poserGx('')`)
      await pause(60)
      await E(`__sf('ge').focus()`)
      const trace: string[] = []
      for (let i = 0; i < NB_GESTES; i++) {
        let r = hasardeux() * POIDS
        let geste = GESTES[0][0]
        for (const [g, w] of GESTES) { r -= w; if (r < 0) { geste = g; break } }
        const etat = await E('__getat()')
        if ((geste === 'Tab' || geste === 'Shift+Tab') && !etat.inList) geste = 'type'
        if (!(await E('__dedans()'))) await E(`__sf('ge').focus()`)
        let nomGeste = geste
        try {
          if (geste === 'type') {
            const mot = MOTS[Math.floor(hasardeux() * MOTS.length)]
            nomGeste = 'type:' + JSON.stringify(mot)
            await s!.page.keyboard.type(mot)
          } else if (geste.startsWith('btn:')) {
            const p = await E(`(() => { const b = __gbtn('${geste.slice(4)}'); return b ? __center(b) : null })()`)
            if (p) await s!.page.mouse.click(p.x, p.y)
          } else if (geste.startsWith('paste:')) {
            const [h, t] = COLLAGES[geste]
            await E(`__sf('ge').focus()`)
            await E(`__coller('ge', ${JSON.stringify(h)}, ${JSON.stringify(t)})`)
          } else await s!.page.keyboard.press(geste)
        } catch (err) { nomGeste += ' !' + String(err).slice(0, 80) }
        trace.push(nomGeste)
        await pause(18)
        const champ: string = (await E(`__hid('ge').value`)) ?? ''
        const x: string     = await jusqua('__lireGx()', champ)
        const mal           = await E(`__audit(${JSON.stringify(champ)})`)
        if (mal.length) violations.push(`graine ${graine}, geste ${i} : hors liste ${JSON.stringify(mal)} dans ${champ} après ${trace.join(' ')}`)
        if (x !== champ && !(x === '' && champ === '')) violations.push(`graine ${graine}, geste ${i} : variable ${JSON.stringify(x)} ≠ champ ${JSON.stringify(champ)} après ${trace.join(' ')}`)
        await E(`__poserGc(${JSON.stringify(champ)})`)
        const deux: string = await jusqua(`__hid('gc').value ?? ''`, champ)
        if (deux !== champ) violations.push(`graine ${graine}, geste ${i} : non idempotent ${JSON.stringify(champ)} → ${JSON.stringify(deux)} après ${trace.join(' ')}`)
      }
    }
    assert.deepEqual(violations.slice(0, 3), [], `${violations.length} violation(s)`)
  })
})
