// µ.modal.notify(message, { href, onClick }) — toast cliquable (mjs_modal.ts) :
// - `href` : un lien (<a>) posé en couverture du toast ; Entrée l'ouvre ; le toast se ferme quand on le suit ;
// - `onClick` : un bouton (<button type="button">) posé en couverture ; `fn(événement)` est appelée, PUIS le toast se ferme ;
// - ensemble : le lien, avec `onClick` appelée d'abord — `event.preventDefault()` retient la navigation ;
// - la croix reste à part : elle ferme sans déclencher le lien ni la fonction ;
// - sans `href` ni `onClick` (ou avec une valeur inutilisable, adresse faite d'espaces seuls comprise) le toast ne change pas d'un octet ;
// - le clic au pointeur qui ferme un toast cliquable arme un délai de 400 ms : le toast qui vient de prendre sa place sous le pointeur
//   ignore alors le clic suivant au pointeur (second clic d'un double clic) ; le clavier et `.click()` ne sont jamais concernés.
// Le clavier (Tab, Entrée, Espace), le focus visible et la mise en page vivent dans mjs-modal-notify-cliquable-browser.test.ts :
// happy-dom n'a ni géométrie ni activation clavier. Même harnais que mjs-modal-notify.test.ts.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Window } from 'happy-dom'
import { assertAbsent } from './helpers/dom-assert.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

function stripEsm(s: string): string {
  return s
    .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
    .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
}

const INIT_SRC       = stripEsm(readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_init.ts'), 'utf-8'))
const PAGE_CACHE_SRC = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_page_cache.ts'), 'utf-8')
const MODAL_SRC      = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_modal.ts'), 'utf-8')

function loadModal(): { window: any; document: any; µ: any } {
  const window: any = new Window({ url: 'http://localhost/' })
  window.eval(`${INIT_SRC}\n${PAGE_CACHE_SRC}\n${MODAL_SRC}\nglobalThis.µ = µ;`)
  return { window, document: window.document, µ: window.µ }
}

const toasts = (document: any): any[] => Array.from(document.body.querySelectorAll('.mjs-toast'))
const action = (t: any): any => t.querySelector('.mjs-toast-action')

describe('mjs_modal — µ.modal.notify cliquable', function () {
  describe('href — le toast est un lien', function () {
    it('un <a href> vide est posé dans le toast, entre le contenu et la croix', function () {
      const { document, µ } = loadModal()
      µ.modal.notify('Nouveau badge', { href: '#/badges', duration: 0 })
      const a = action(toasts(document)[0])
      assert.ok(a, 'élément d\'action attendu')
      assert.equal(a.tagName, 'A')
      assert.equal(a.getAttribute('href'), '#/badges')
      assert.equal(a.children.length, 0, 'l\'élément d\'action est une couverture vide')
      assert.deepEqual(Array.from(toasts(document)[0].children).map((c: any) => c.className), ['mjs-toast-icon', 'mjs-toast-content', 'mjs-toast-action', 'mjs-toast-close'])
    })

    it('son nom accessible reprend le titre et le message', function () {
      const { document, µ } = loadModal()
      µ.modal.notify('Nouveau badge', { type: 'success', href: '#/badges' })
      assert.equal(action(toasts(document)[0]).getAttribute('aria-label'), 'Succès Nouveau badge')
    })

    it('sans titre, le nom accessible est le message seul', function () {
      const { document, µ } = loadModal()
      µ.modal.notify('Copié', { title: false, href: '#/x' })
      assert.equal(action(toasts(document)[0]).getAttribute('aria-label'), 'Copié')
    })

    it('suivre le lien ferme le toast ET suit le lien', function () {
      const { window, document, µ } = loadModal()
      µ.modal.notify('Nouveau badge', { href: '#/badges', duration: 0 })
      const t = toasts(document)[0]
      action(t).click()
      assert.equal(toasts(document).length, 0, 'toast retiré')
      assert.equal(window.location.hash, '#/badges', 'lien suivi')
    })

    it('ne ferme que son propre toast', function () {
      const { document, µ } = loadModal()
      µ.modal.notify('un', { href: '#/a', duration: 0 })
      µ.modal.notify('deux', { href: '#/b', duration: 0 })
      action(toasts(document)[0]).click()
      const reste = toasts(document)
      assert.equal(reste.length, 1)
      assert.equal(reste[0].querySelector('.mjs-toast-message').textContent, 'deux')
    })

    it('adresse refusée par le filtre des adresses (javascript:) : comme sans href, aucun élément d\'action', function () {
      const { document, µ } = loadModal()
      µ.modal.notify('piège', { href: 'javascript:alert(1)', duration: 0 })
      const t = toasts(document)[0]
      assertAbsent(action(t), 'aucun élément d\'action pour une adresse refusée')
      assertAbsent(t.querySelector('a'), 'aucun lien')
    })

    for (const [nom, valeur] of [['chaîne vide', ''], ['espaces seuls', '   '], ['tabulation et saut de ligne', '\t\n'], ['espace insécable', '\u00a0'], ['nombre', 42], ['booléen', true], ['objet', { a: 1 }], ['null', null]] as const) {
      it(`href inutilisable (${nom}) : comme sans href`, function () {
        const { document, µ } = loadModal()
        µ.modal.notify('x', { href: valeur as any, duration: 0 })
        assertAbsent(action(toasts(document)[0]), 'href inutilisable : aucun élément d\'action')
        assertAbsent(toasts(document)[0].querySelector('a'), 'aucun lien')
      })
    }

    it('adresse faite d\'espaces seuls + onClick : repli sur le bouton, jamais un lien', function () {
      const { document, µ } = loadModal()
      let n = 0
      µ.modal.notify('x', { href: '   ', duration: 0, onClick: () => { n++ } })
      const b = action(toasts(document)[0])
      assert.equal(b.tagName, 'BUTTON')
      b.click()
      assert.equal(n, 1)
    })

    it('adresse entourée d\'espaces mais non vide : reste un lien', function () {
      const { document, µ } = loadModal()
      µ.modal.notify('x', { href: '  #/badges  ', duration: 0 })
      const a = action(toasts(document)[0])
      assert.equal(a.tagName, 'A')
      assert.equal(a.getAttribute('href'), '  #/badges  ', 'l\'adresse est posée telle quelle, le navigateur ignore les espaces de bord')
    })
  })

  describe('onClick — le toast est un bouton', function () {
    it('un <button type="button"> vide est posé dans le toast, entre le contenu et la croix', function () {
      const { document, µ } = loadModal()
      µ.modal.notify('Annuler ?', { onClick: () => {}, duration: 0 })
      const b = action(toasts(document)[0])
      assert.ok(b, 'élément d\'action attendu')
      assert.equal(b.tagName, 'BUTTON')
      assert.equal(b.getAttribute('type'), 'button')
      assert.equal(b.children.length, 0)
      assert.equal(b.getAttribute('aria-label'), 'Info Annuler ?')
      assert.deepEqual(Array.from(toasts(document)[0].children).map((c: any) => c.className), ['mjs-toast-icon', 'mjs-toast-content', 'mjs-toast-action', 'mjs-toast-close'])
    })

    it('fn est appelée UNE fois avec l\'événement click, puis le toast se ferme', function () {
      const { document, µ } = loadModal()
      const appels: any[] = []
      let presentPendantFn = false
      µ.modal.notify('x', { duration: 0, onClick: (e: any) => { appels.push(e); presentPendantFn = toasts(document).length === 1 } })
      action(toasts(document)[0]).click()
      assert.equal(appels.length, 1)
      assert.equal(appels[0].type, 'click')
      assert.equal(presentPendantFn, true, 'le toast est encore là pendant fn')
      assert.equal(toasts(document).length, 0, 'et retiré ensuite')
    })

    it('un second clic sur l\'élément déjà retiré n\'appelle plus fn', function () {
      const { document, µ } = loadModal()
      let n = 0
      µ.modal.notify('x', { duration: 0, onClick: () => { n++ } })
      const b = action(toasts(document)[0])
      b.click()
      b.click()
      assert.equal(n, 1)
    })

    it('fn qui lève : le toast se ferme quand même et l\'erreur n\'est pas avalée', function () {
      const { window, document, µ } = loadModal()
      const erreurs: string[] = []
      window.addEventListener('error', (e: any) => { erreurs.push(String(e.message || e.error)) })
      µ.modal.notify('x', { duration: 0, onClick: () => { throw new Error('boum') } })
      action(toasts(document)[0]).click()
      assert.equal(toasts(document).length, 0, 'toast fermé malgré l\'erreur')
      assert.ok(erreurs.some((m) => m.includes('boum')), `erreur remontée attendue : ${JSON.stringify(erreurs)}`)
    })

    it('fn qui ferme le toast elle-même (poignée close()) : aucune erreur, pas de double retrait', function () {
      const { document, µ } = loadModal()
      const ref: { poignee?: any } = {}
      ref.poignee = µ.modal.notify('x', { duration: 0, onClick: () => { ref.poignee.close() } })
      assert.doesNotThrow(() => action(toasts(document)[0]).click())
      assert.equal(toasts(document).length, 0)
    })

    for (const [nom, valeur] of [['chaîne', 'alert(1)'], ['objet', { a: 1 }], ['nombre', 3], ['null', null]] as const) {
      it(`onClick inutilisable (${nom}) : comme sans onClick`, function () {
        const { document, µ } = loadModal()
        µ.modal.notify('x', { onClick: valeur as any, duration: 0 })
        assertAbsent(action(toasts(document)[0]), 'onClick inutilisable : aucun élément d\'action')
      })
    }

    it('toast encore en file : cliquable dès qu\'il s\'affiche', function () {
      const { document, µ } = loadModal()
      µ.config.notifyMax = 1
      let n = 0
      const premier = µ.modal.notify('premier', { duration: 0 })
      µ.modal.notify('second', { duration: 0, onClick: () => { n++ } })
      assert.equal(toasts(document).length, 1, 'le second attend en file')
      premier.close()
      const t = toasts(document)[0]
      assert.equal(t.querySelector('.mjs-toast-message').textContent, 'second')
      action(t).click()
      assert.equal(n, 1)
      assert.equal(toasts(document).length, 0)
    })
  })

  describe('href et onClick ensemble — un lien dont onClick est appelée d\'abord', function () {
    it('l\'élément est un lien ; fn est appelée, le lien est suivi, le toast se ferme', function () {
      const { window, document, µ } = loadModal()
      const ordre: string[] = []
      µ.modal.notify('x', { href: '#/badges', duration: 0, onClick: () => { ordre.push('fn:' + window.location.hash + ':' + toasts(document).length) } })
      const a = action(toasts(document)[0])
      assert.equal(a.tagName, 'A')
      a.click()
      assert.deepEqual(ordre, ['fn::1'], 'fn passe avant le lien (adresse encore vide) et avant la fermeture')
      assert.equal(window.location.hash, '#/badges', 'lien suivi après fn')
      assert.equal(toasts(document).length, 0)
    })

    it('event.preventDefault() dans fn retient la navigation ; le toast se ferme quand même', function () {
      const { window, document, µ } = loadModal()
      µ.modal.notify('x', { href: '#/badges', duration: 0, onClick: (e: any) => { e.preventDefault() } })
      action(toasts(document)[0]).click()
      assert.equal(window.location.hash, '', 'lien retenu')
      assert.equal(toasts(document).length, 0)
    })

    it('href refusé + onClick : repli sur le bouton', function () {
      const { document, µ } = loadModal()
      let n = 0
      µ.modal.notify('x', { href: 'javascript:alert(1)', duration: 0, onClick: () => { n++ } })
      const b = action(toasts(document)[0])
      assert.equal(b.tagName, 'BUTTON')
      b.click()
      assert.equal(n, 1)
    })
  })

  describe('la croix reste à part', function () {
    it('toast à href : la croix ferme sans suivre le lien', function () {
      const { window, document, µ } = loadModal()
      let clicsSurLeLien = 0
      µ.modal.notify('x', { href: '#/badges', duration: 0 })
      const t = toasts(document)[0]
      action(t).addEventListener('click', () => { clicsSurLeLien++ })
      t.querySelector('.mjs-toast-close').click()
      assert.equal(toasts(document).length, 0)
      assert.equal(clicsSurLeLien, 0, 'le lien n\'a rien reçu')
      assert.equal(window.location.hash, '', 'rien n\'a été suivi')
    })

    it('toast à onClick : la croix ferme sans appeler fn', function () {
      const { document, µ } = loadModal()
      let n = 0
      µ.modal.notify('x', { duration: 0, onClick: () => { n++ } })
      toasts(document)[0].querySelector('.mjs-toast-close').click()
      assert.equal(toasts(document).length, 0)
      assert.equal(n, 0)
    })
  })

  describe('double clic — le toast qui prend la place d\'un toast fermé par un clic ignore le clic suivant au pointeur', function () {
    // happy-dom n'a pas de mise en page : chaque toast reçoit à la main la boîte qu'il aurait à l'écran
    const BOITE = { left: 0, top: 0, right: 400, bottom: 70, width: 400, height: 70 }
    const placer = (t: any, boite: any = BOITE) => {
      t.getBoundingClientRect = () => boite
      action(t).getBoundingClientRect = () => boite
    }
    // clic synthétique : type de pointeur ('mouse', ou '' comme au clavier), point cliqué, instant de l'événement
    const clic = (window: any, cible: any, { pointeur = 'mouse', x = 200, y = 30, t }: { pointeur?: string; x?: number; y?: number; t: number }): any => {
      const ev = new window.PointerEvent('click', { bubbles: true, cancelable: true, pointerType: pointeur, clientX: x, clientY: y })
      Object.defineProperty(ev, 'timeStamp', { value: t })
      cible.dispatchEvent(ev)
      return ev
    }
    // deux toasts à bouton empilés, le second prenant la place du premier une fois celui-ci fermé
    const empiler = (µ: any, document: any, appels: string[]): any[] => {
      µ.modal.notify('premier', { duration: 0, onClick: () => { appels.push('premier') } })
      µ.modal.notify('second', { duration: 0, onClick: () => { appels.push('second') } })
      const [a, b] = toasts(document)
      placer(a)
      placer(b)
      return [action(a), action(b)]
    }

    it('le second clic au pointeur, sur le toast qui a pris la place et dans le délai, est ignoré', function () {
      const { window, document, µ } = loadModal()
      const appels: string[] = []
      const [a, b] = empiler(µ, document, appels)
      clic(window, a, { t: 1000 })
      assert.deepEqual(appels, ['premier'])
      assert.equal(toasts(document).length, 1, 'le premier toast est fermé')
      const second = clic(window, b, { t: 1150 })
      assert.deepEqual(appels, ['premier'], 'la fonction du second toast n\'est pas appelée')
      assert.equal(toasts(document).length, 1, 'le second toast reste affiché')
      assert.equal(second.defaultPrevented, true, 'l\'activation est retenue')
    })

    it('le délai passé, le même clic déclenche le toast', function () {
      const { window, document, µ } = loadModal()
      const appels: string[] = []
      const [a, b] = empiler(µ, document, appels)
      clic(window, a, { t: 1000 })
      clic(window, b, { t: 1150 })
      clic(window, b, { t: 1500 })
      assert.deepEqual(appels, ['premier', 'second'])
      assert.equal(toasts(document).length, 0)
    })

    it('le délai est de 400 ms : ignoré à 399 ms, déclenché à 400 ms', function () {
      for (const [ecart, attendu] of [[399, ['premier']], [400, ['premier', 'second']]] as const) {
        const { window, document, µ } = loadModal()
        const appels: string[] = []
        const [a, b] = empiler(µ, document, appels)
        clic(window, a, { t: 1000 })
        clic(window, b, { t: 1000 + ecart })
        assert.deepEqual(appels, attendu, `${ecart} ms après le premier clic`)
      }
    })

    it('un toast qui n\'est pas sous le point du premier clic n\'est pas retenu', function () {
      const { window, document, µ } = loadModal()
      const appels: string[] = []
      const [a, b] = empiler(µ, document, appels)
      placer(toasts(document)[1], { left: 0, top: 78, right: 400, bottom: 148, width: 400, height: 70 })
      clic(window, a, { t: 1000, x: 200, y: 30 })
      clic(window, b, { t: 1100, x: 200, y: 100 })
      assert.deepEqual(appels, ['premier', 'second'], 'le second toast est ailleurs : il se déclenche')
    })

    it('le clavier n\'est pas concerné : sans type de pointeur, même point, même instant, le toast se déclenche', function () {
      const { window, document, µ } = loadModal()
      const appels: string[] = []
      const [a, b] = empiler(µ, document, appels)
      clic(window, a, { t: 1000 })
      clic(window, b, { t: 1100, pointeur: '' })
      assert.deepEqual(appels, ['premier', 'second'])
    })

    it('une fermeture au clavier n\'arme rien : le clic au pointeur qui suit se déclenche', function () {
      const { window, document, µ } = loadModal()
      const appels: string[] = []
      const [a, b] = empiler(µ, document, appels)
      clic(window, a, { t: 1000, pointeur: '' })
      clic(window, b, { t: 1100 })
      assert.deepEqual(appels, ['premier', 'second'])
    })

    it('.click() n\'arme rien et n\'est jamais retenu', function () {
      const { document, µ } = loadModal()
      const appels: string[] = []
      const [a, b] = empiler(µ, document, appels)
      a.click()
      b.click()
      assert.deepEqual(appels, ['premier', 'second'])
      assert.equal(toasts(document).length, 0)
    })

    it('un clic ignoré ne prolonge pas le délai', function () {
      const { window, document, µ } = loadModal()
      const appels: string[] = []
      const [a, b] = empiler(µ, document, appels)
      clic(window, a, { t: 1000 })
      clic(window, b, { t: 1300 })
      assert.deepEqual(appels, ['premier'], 'ignoré à 300 ms')
      clic(window, b, { t: 1450 })
      assert.deepEqual(appels, ['premier', 'second'], 'déclenché à 450 ms du clic qui a fermé, 150 ms après le clic ignoré')
    })

    it('liens : le second clic ignoré ne suit pas le lien', function () {
      const { window, document, µ } = loadModal()
      µ.modal.notify('premier', { duration: 0, href: '#/premier' })
      µ.modal.notify('second', { duration: 0, href: '#/second' })
      const [a, b] = toasts(document)
      placer(a)
      placer(b)
      clic(window, action(a), { t: 1000 })
      assert.equal(window.location.hash, '#/premier')
      clic(window, action(b), { t: 1100 })
      assert.equal(window.location.hash, '#/premier', 'le lien du second toast n\'est pas suivi')
      assert.equal(toasts(document).length, 1, 'le second toast reste affiché')
    })

    it('un lien fermé par un clic retient aussi le bouton qui prend sa place', function () {
      const { window, document, µ } = loadModal()
      let n = 0
      µ.modal.notify('premier', { duration: 0, href: '#/premier' })
      µ.modal.notify('second', { duration: 0, onClick: () => { n++ } })
      const [a, b] = toasts(document)
      placer(a)
      placer(b)
      clic(window, action(a), { t: 1000 })
      clic(window, action(b), { t: 1100 })
      assert.equal(n, 0)
      assert.equal(toasts(document).length, 1)
    })
  })

  describe('sans href ni onClick, le toast ne change pas', function () {
    it('structure exacte d\'un toast ordinaire (icône, titre et barre retirés pour la lisibilité ; glisser coupé : il ajoute sa classe)', function () {
      const { document, µ } = loadModal()
      µ.modal.notify('x', { icon: false, title: false, duration: 0, swipe: false })
      assert.equal(toasts(document)[0].outerHTML, '<div class="mjs-toast mjs-toast-info mjs-toast-no-icon" role="status" aria-live="polite"><div class="mjs-toast-content"><span class="mjs-toast-message">x</span></div><button type="button" class="mjs-toast-close">×</button></div>')
    })

    it('enfants d\'un toast ordinaire : icône, contenu, croix — aucun élément d\'action', function () {
      const { document, µ } = loadModal()
      µ.modal.notify('x', { duration: 0 })
      assert.deepEqual(Array.from(toasts(document)[0].children).map((c: any) => c.className), ['mjs-toast-icon', 'mjs-toast-content', 'mjs-toast-close'])
    })

    for (const [nom, opts] of [['aucune option', undefined], ['objet vide', {}], ['href et onClick indéfinis', { href: undefined, onClick: undefined }]] as const) {
      it(`${nom} : pas d'élément d'action`, function () {
        const { document, µ } = loadModal()
        µ.modal.notify('x', opts as any)
        assertAbsent(action(toasts(document)[0]), 'aucun élément d\'action')
        assertAbsent(toasts(document)[0].querySelector('a'), 'aucun lien')
      })
    }
  })

  describe('feuille de style', function () {
    const m = MODAL_SRC.match(/µ\._mjs_modalSheet\.replaceSync\(`([\s\S]*?)`\);/)
    const css = m ? m[1] : ''

    it('la couverture, ses trois états et la croix au-dessus sont dans la feuille du module des toasts', function () {
      assert.ok(m, 'texte de la feuille repérable')
      assert.match(css, /:where\(\.mjs-toast-action\)\{[^}]*position:absolute/)
      assert.match(css, /:where\(\.mjs-toast-action:hover\)\{[^}]*background:var\(--mjs-toast-hover-bg,/)
      assert.match(css, /:where\(\.mjs-toast-action:active\)\{[^}]*background:var\(--mjs-toast-active-bg,/)
      assert.match(css, /:where\(\.mjs-toast-action:focus-visible\)\{[^}]*outline:[^;}]*var\(--mjs-toast-focus,/)
      assert.match(css, /:where\(\.mjs-toast-action ~ \.mjs-toast-close\)\{[^}]*position:relative/)
      assert.match(css, /:where\(\.mjs-toast-action ~ \.mjs-toast-barre\)\{[^}]*pointer-events:none/)
    })

    it('la structure de la couverture est en !important : une règle de balise de l\'appli (button, a) ne la défait pas', function () {
      const base = css.match(/:where\(\.mjs-toast-action\)\{([^}]*)\}/)
      assert.ok(base, 'règle de base repérable')
      for (const prop of ['position', 'top', 'left', 'box-sizing', 'width', 'height', 'margin', 'padding', 'border', 'border-radius', 'background', 'color', 'font', 'appearance', 'outline-offset']) {
        assert.match(base[1], new RegExp('(^|;)' + prop + ':[^;]*!important'), `${prop} doit être en !important`)
      }
    })

    it('les états (voile de survol et d\'appui, anneau de focus) sont en !important eux aussi, et gardent leurs variables', function () {
      assert.match(css, /:where\(\.mjs-toast-action:hover\)\{background:var\(--mjs-toast-hover-bg,[^}]*\)!important\}/)
      assert.match(css, /:where\(\.mjs-toast-action:active\)\{background:var\(--mjs-toast-active-bg,[^}]*\)!important\}/)
      assert.match(css, /:where\(\.mjs-toast-action:focus-visible\)\{outline:[^;}]*var\(--mjs-toast-focus,[^}]*\)!important\}/)
    })

    it('zéro style inline sur la couverture', function () {
      const { document, µ } = loadModal()
      µ.modal.notify('x', { href: '#/a', duration: 0 })
      µ.modal.notify('y', { onClick: () => {}, duration: 0 })
      for (const t of toasts(document)) assert.equal(action(t).hasAttribute('style'), false)
    })
  })
})
