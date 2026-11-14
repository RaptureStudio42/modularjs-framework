// µ.modal, les menus de MJS et le cache de pages (DOM simulé, happy-dom) : les menus de MJS ouverts (µ._mjs_menus : liste d'un
// <@@select>, bulle `@title`, menu d'un <@@chart>) se ferment à l'ouverture, avant que la modale ne retienne le focus à rendre ;
// Échap dans la modale ferme d'abord une liste ou un menu ouvert (sa fermeture rend vrai), la modale seulement quand aucun ne l'est ;
// la modale ouverte reste hors de la photo du cache de pages, et partie avec la page, elle se ferme à l'arrivée de la suivante ;
// la page derrière elle reste telle quelle, comme sans modale : aucun `inert` posé. Les navigateurs réels :
// modale-menus-et-cache-de-pages-browser.test.ts

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Window } from 'happy-dom'

const __dirname = dirname(fileURLToPath(import.meta.url))

function stripEsm(s: string): string {
  return s
    .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
    .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
}

const RT             = join(__dirname, '..', 'src', 'runtime')
const INIT_SRC       = stripEsm(readFileSync(join(RT, 'mjs_init.ts'), 'utf-8'))
const PAGE_CACHE_SRC = readFileSync(join(RT, 'mjs_page_cache.ts'), 'utf-8')
const MODAL_SRC      = readFileSync(join(RT, 'mjs_modal.ts'), 'utf-8')
const UJS_SRC        = readFileSync(join(RT, 'mjs_ujs.ts'), 'utf-8')

function charger(): { window: any, document: any, µ: any } {
  const window: any = new Window({ url: 'http://localhost/' })
  const document = window.document
  document.body.innerHTML = '<button id="bouton" type="button">bouton</button><div id="liste" inert><button id="dans" type="button">dans</button></div>'
  window.eval(`${INIT_SRC}\n${PAGE_CACHE_SRC}\n${MODAL_SRC}\n${UJS_SRC}\nglobalThis.µ = µ;`)
  return { window, document, µ: window.µ }
}

// en texte, jamais un nœud dans une assertion : les éléments de la photo du cache, ceux de la page qui portent `inert`
const nom     = (e: any) => e.id || e.className.split(' ')[0]
const photo   = (µ: any, chemin: string) => µ.pageCache.get(chemin).filter((n: any) => n.nodeType === 1).map(nom).join(',')
const inertes = (document: any) => [...document.querySelectorAll('[inert]')].map(nom).join(',')

// plein écran simulé sur `el` (null : sortie), annoncé comme le fait le navigateur
function pleinEcran(window: any, el: any): void {
  Object.defineProperty(window.document, 'fullscreenElement', { configurable: true, get: () => el })
  window.document.dispatchEvent(new window.Event('fullscreenchange'))
}

describe('µ.modal — les menus de MJS et le cache de pages (DOM simulé)', function () {
  it('les menus de MJS ouverts se ferment à l\'ouverture, avant que la modale ne retienne le focus à rendre ; un menu qui échoue n\'empêche pas l\'ouverture', function () {
    const { document, µ }   = charger()
    const journal: string[] = []
    const bouton            = document.getElementById('bouton')
    document.getElementById('dans').focus()
    const menu   = () => { journal.push('menu'); µ._mjs_menus.delete(menu); bouton.focus() }
    µ._mjs_menus = new Set([() => { throw new Error('menu détruit') }, menu])
    µ.modal.fire({ title: 'T' })
    assert.deepEqual([journal.join(','), µ._mjs_menus.size, document.querySelectorAll('.mjs-modal-backdrop').length, document.activeElement.className], ['menu', 1, 1, 'mjs-modal-btn mjs-modal-confirm'])
    µ.modal.close()
    assert.ok(document.activeElement === bouton, 'le focus rendu au bouton du menu fermé')
  })

  it('Échap dans la modale : une liste ou un menu ouvert (sa fermeture rend vrai) se ferme seul, la modale reste ouverte et Échap s\'arrête là ; la bulle, fermée sans rien rendre, ne la retient pas', async function () {
    const { window, document, µ } = charger()
    const journal: string[] = []
    const recus: string[]   = []
    const echap = () => document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    document.addEventListener('keydown', (e: any) => { recus.push(e.key) })
    µ._mjs_menus = new Set([() => { journal.push('bulle') }])
    let fin: any = null
    µ.modal.fire({ title: 'T' }).then((r: any) => { fin = r })
    const menu = () => { journal.push('menu'); µ._mjs_menus.delete(menu); return true }
    µ._mjs_menus.add(menu)
    echap()
    await new Promise((f) => setTimeout(f, 0))
    assert.deepEqual([journal.join(','), document.querySelectorAll('.mjs-modal-backdrop').length, fin, recus.join(',')], ['bulle,bulle,menu', 1, null, ''], 'le menu fermé seul, la modale ouverte, Échap arrêté')
    echap()
    await new Promise((f) => setTimeout(f, 0))
    assert.deepEqual([journal.join(','), fin && fin.dismiss, recus.join(',')], ['bulle,bulle,menu,bulle', 'esc', ''], 'aucun menu ouvert : la modale fermée')
  })

  it('la modale ouverte reste hors de la photo du cache de pages ; partie avec la page, elle se ferme à l\'arrivée de la suivante', async function () {
    const { window, document, µ } = charger()
    µ.modal.notify('t', { duration: 0 })
    const p = µ.modal.fire({ title: 'T' })
    µ._mjs_navHibernate(document.body, '/p')
    assert.equal(photo(µ, '/p'), 'bouton,liste,mjs-toasts', 'la page photographiée sans la modale')
    document.body.replaceChildren(document.createElement('main'))
    document.dispatchEvent(new window.Event('mjs:load'))
    assert.equal((await p).dismiss, 'close')
    assert.deepEqual([µ._mjs_modalLayer == null, document.querySelectorAll('.mjs-modal-backdrop').length, photo(µ, '/p')], [true, 0, 'bouton,liste,mjs-toasts'], 'fermée, rien dans la page suivante ni dans la photo')
  })

  it('rouverte pendant son propre focus (un `blur` de l\'appli qui ouvre une autre modale), seule la seconde reste, hors de la photo ; refermée pendant son focus (un `focusin` de l\'appli), elle ne laisse rien', function () {
    const { document, µ } = charger()
    const bouton          = document.getElementById('bouton')
    let n                 = 0
    bouton.addEventListener('blur', () => { if (++n === 1) { µ.modal.fire({ title: 'E2' }) } })
    bouton.focus()
    µ.modal.fire({ title: 'E1' })
    µ._mjs_navHibernate(document.body, '/a')
    assert.deepEqual([document.querySelector('.mjs-modal-title').textContent, document.querySelectorAll('.mjs-modal-backdrop').length], ['E2', 1], 'la seconde ouverte seule')
    assert.equal(photo(µ, '/a'), 'bouton,liste', 'la seconde hors de la photo')
    µ.modal.close()
    const f = (e: any) => { if (e.target.closest && e.target.closest('.mjs-modal-box')) { document.removeEventListener('focusin', f); µ.modal.close() } }
    document.addEventListener('focusin', f)
    µ.modal.fire({ title: 'F1' })
    µ._mjs_navHibernate(document.body, '/b')
    assert.deepEqual([document.querySelectorAll('.mjs-modal-backdrop').length, µ._mjs_modalLayer == null, photo(µ, '/b'), inertes(document)], [0, true, 'bouton,liste', 'liste'], 'fermée pendant son focus : plus rien')
  })

  it('la page derrière la modale reste telle quelle, comme sans modale : aucun `inert` posé, plein écran compris', async function () {
    const { window, document, µ } = charger()
    const plein                   = document.createElement('div')
    plein.id                      = 'plein'
    plein.innerHTML               = '<button id="pb" type="button">pb</button>'
    document.body.appendChild(plein)
    const p = µ.modal.fire({ title: 'T', showCancelButton: true })
    await new Promise((f) => setTimeout(f, 0))
    const ouverte = inertes(document)
    pleinEcran(window, plein)
    const pleine = [inertes(document), document.querySelector('.mjs-modal-backdrop').parentNode === plein]
    pleinEcran(window, null)
    const sortie = inertes(document)
    µ.modal.close()
    await p
    assert.deepEqual({ ouverte, pleine, sortie, fermee: inertes(document) }, { ouverte: 'liste', pleine: ['liste', true], sortie: 'liste', fermee: 'liste' }, 'seul l\'inert de l\'appli')
  })
})
