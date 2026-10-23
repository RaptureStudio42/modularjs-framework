// µ.modal.notify(message, { icon }) (mjs_modal.ts) : l'icône du toast est celle du type tant que `icon` n'est pas posé. Posé, c'est :
// - une chaîne SVG (fournie par l'appli, de confiance) : posée telle quelle dans la case d'icône ;
// - une adresse d'image (toute autre chaîne) : une <img alt=""> dont l'adresse passe par le filtre des adresses du framework
//   (javascript:, vbscript: et file: refusés) ; une chaîne qui ne commence pas par `<svg` n'est JAMAIS analysée comme du HTML ;
// - un élément du document : placé dans la case ;
// - `false` : pas d'icône du tout (ni case, ni colonne réservée : le toast porte la classe mjs-toast-no-icon).
// Une autre valeur (null, chaîne vide, nombre, objet qui n'est pas un élément) vaut l'absence d'option. Même assemblage que
// mjs-modal-notify.test.ts : sources du runtime chargées dans happy-dom, sans Bundler (la mise en page est vérifiée dans un vrai
// navigateur par mjs-modal-notify-icone-browser.test.ts).

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

const INIT_SRC = stripEsm(readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_init.ts'), 'utf-8'))
const PAGE_CACHE_SRC = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_page_cache.ts'), 'utf-8')
const MODAL_SRC = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_modal.ts'), 'utf-8')

function loadModal(): { window: any; document: any; µ: any } {
  const window: any = new Window({ url: 'http://localhost/' })
  window.eval(`${INIT_SRC}\n${PAGE_CACHE_SRC}\n${MODAL_SRC}\nglobalThis.µ = µ;`)
  return { window, document: window.document, µ: window.µ }
}

const toast = (document: any): any => document.body.querySelector('.mjs-toast')
const icone = (document: any): any => document.body.querySelector('.mjs-toast-icon')

// un tracé propre à chaque icône de type : de quoi reconnaître laquelle est posée
const TRACES: Array<[string, string]> = [['success', 'M7.5 12.5l3 3 6-7'], ['error', 'M8.5 8.5l7 7M15.5 8.5l-7 7'], ['warning', 'M12 3.5L22 20.5H2z'], ['info', 'M12 11v5.5']]

const SVG = '<svg viewBox="0 0 10 10" class="mien"><path d="M0 0h10v10z"/></svg>'

describe('mjs_modal — µ.modal.notify, icône à soi (option icon)', function () {
  for (const [type, trace] of TRACES) {
    it(`sans icon : le toast '${type}' garde l'icône de son type`, function () {
      const { document, µ } = loadModal()
      µ.modal.notify('x', { type })
      assert.ok(icone(document).innerHTML.includes(trace), `le tracé du type ${type} est posé`)
      assert.equal(icone(document).getAttribute('aria-hidden'), 'true')
      assertAbsent(icone(document).querySelector('img'), 'aucune image')
      assert.equal(toast(document).classList.contains('mjs-toast-no-icon'), false)
    })
  }

  it('chaîne SVG : posée telle quelle à la place de l\'icône du type, la couleur du type reste', function () {
    const { document, µ } = loadModal()
    µ.modal.notify('x', { type: 'success', icon: SVG })
    assert.ok(icone(document).querySelector('svg.mien'), 'le SVG de l\'appli est là')
    assert.equal(icone(document).querySelectorAll('svg').length, 1, 'un seul SVG')
    assertAbsent(icone(document).querySelector('circle'), 'l\'icône du type n\'est plus là')
    assertAbsent(icone(document).querySelector('img'), 'aucune image')
    assert.equal(icone(document).getAttribute('aria-hidden'), 'true')
    assert.equal(toast(document).classList.contains('mjs-toast-success'), true, 'le type garde sa classe, donc sa couleur')
  })

  it('chaîne SVG précédée d\'espaces ou de retours à la ligne, ou écrite en majuscules : reste du SVG', function () {
    for (const chaine of [`\n  ${SVG}\n`, SVG.replace(/svg/g, 'SVG')]) {
      const { document, µ } = loadModal()
      µ.modal.notify('x', { icon: chaine })
      assertAbsent(icone(document).querySelector('img'), 'jamais traitée comme une adresse')
      assert.ok(icone(document).querySelector('.mien'), 'le SVG de l\'appli est là')
      assertAbsent(icone(document).querySelector('circle'), 'l\'icône du type n\'est plus là')
      assert.equal(icone(document).children.length, 1)
      assert.equal(icone(document).firstElementChild.tagName.toLowerCase(), 'svg')
    }
  })

  for (const adresse of ['/icones/ok.png', 'icones/ok.svg', 'https://exemple.test/ok.png', 'data:image/png;base64,iVBORw0KGgo=']) {
    it(`adresse ${JSON.stringify(adresse)} : une <img alt=""> dans la case d'icône`, function () {
      const { document, µ } = loadModal()
      µ.modal.notify('x', { icon: adresse })
      const images = icone(document).querySelectorAll('img')
      assert.equal(images.length, 1, 'une seule image')
      assert.equal(images[0].getAttribute('src'), adresse)
      assert.equal(images[0].hasAttribute('alt'), true, 'alt présent')
      assert.equal(images[0].getAttribute('alt'), '', 'image décorative : alt vide')
      assertAbsent(icone(document).querySelector('svg'), 'l\'icône du type n\'est plus là')
    })
  }

  it('élément du document : placé tel quel dans la case d\'icône', function () {
    const { document, µ } = loadModal()
    const etoile = document.createElement('span')
    etoile.className = 'mien'
    etoile.textContent = '★'
    µ.modal.notify('x', { icon: etoile })
    assert.ok(etoile.parentNode === icone(document), 'le même nœud, pas une copie')
    assert.equal(icone(document).children.length, 1)
    assertAbsent(icone(document).querySelector('svg'), 'l\'icône du type n\'est plus là')
  })

  it('false : pas d\'icône du tout, le contenu et la croix restent, le rôle suit toujours le type', function () {
    const { document, µ } = loadModal()
    µ.modal.notify('dit', { type: 'error', icon: false, duration: 0 })
    const t = toast(document)
    assertAbsent(icone(document), 'aucune case d\'icône')
    assertAbsent(t.querySelector('svg'), 'aucune image vectorielle')
    assertAbsent(t.querySelector('img'), 'aucune image')
    assert.deepEqual(Array.from(t.children).map((c: any) => c.className), ['mjs-toast-content', 'mjs-toast-close'])
    assert.equal(t.classList.contains('mjs-toast-no-icon'), true)
    assert.equal(t.classList.contains('mjs-toast-error'), true)
    assert.equal(t.getAttribute('role'), 'alert')
    assert.equal(t.querySelector('.mjs-toast-message').textContent, 'dit')
  })

  for (const adresse of ['javascript:alert(1)', ' JaVa\tScRiPt:alert(1)', 'vbscript:msgbox(1)', 'file:///etc/passwd']) {
    it(`adresse refusée ${JSON.stringify(adresse)} : l'image n'a pas d'adresse, rien ne part`, function () {
      const { document, µ } = loadModal()
      assert.doesNotThrow(() => µ.modal.notify('x', { icon: adresse }))
      const images = icone(document).querySelectorAll('img')
      assert.equal(images.length, 1)
      assert.equal(images[0].hasAttribute('src'), false, 'l\'adresse dangereuse n\'est pas posée')
      assert.equal(images[0].getAttribute('alt'), '')
    })
  }

  it('une chaîne HTML qui n\'est pas du SVG n\'est jamais analysée : elle reste une adresse', function () {
    const { document, µ } = loadModal()
    for (const piege of ['<img src=x onerror=alert(1)>', '<script>alert(1)</script>', '<iframe src="javascript:alert(1)"></iframe>']) {
      µ.modal.notify('x', { icon: piege })
    }
    const cases = Array.from(document.body.querySelectorAll('.mjs-toast-icon')) as any[]
    assert.equal(cases.length, 3)
    for (const c of cases) {
      assert.equal(c.children.length, 1, 'un seul enfant, l\'image')
      assert.equal(c.firstElementChild.tagName, 'IMG')
      assert.equal(c.firstElementChild.hasAttribute('onerror'), false)
    }
    assertAbsent(document.body.querySelector('.mjs-toast-icon script'), 'aucun script')
    assertAbsent(document.body.querySelector('.mjs-toast-icon iframe'), 'aucun cadre')
  })

  it('une autre valeur (null, chaîne vide, 0, true, nombre, objet) vaut l\'absence d\'option : icône du type', function () {
    for (const valeur of [null, '', 0, true, 42, {}, { nodeType: 3 }]) {
      const { document, µ } = loadModal()
      assert.doesNotThrow(() => µ.modal.notify('x', { type: 'warning', icon: valeur }), String(valeur))
      assert.ok(icone(document).innerHTML.includes('M12 3.5L22 20.5H2z'), `${JSON.stringify(valeur)} : l'icône du type`)
      assertAbsent(icone(document).querySelector('img'), 'aucune image')
      assert.equal(toast(document).classList.contains('mjs-toast-no-icon'), false)
    }
  })

  it('un toast mis en file garde son icône à soi quand il paraît', function () {
    const { document, µ } = loadModal()
    µ.config.notifyMax = 1
    const premier = µ.modal.notify('un', { duration: 0 })
    µ.modal.notify('deux', { duration: 0, icon: SVG })
    assert.equal(document.body.querySelectorAll('.mjs-toast').length, 1, 'le second attend')
    premier.close()
    assert.equal(document.body.querySelectorAll('.mjs-toast').length, 1)
    assert.ok(icone(document).querySelector('svg.mien'), 'le second paraît avec son icône')
  })
})
