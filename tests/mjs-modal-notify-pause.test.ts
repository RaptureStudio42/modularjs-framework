// µ.modal.notify(message, { pause }) et µ.config.notifyPause (mjs_modal.ts) — le décompte d'un toast s'arrête tant que le pointeur
// (souris, stylet) le survole ou que le focus est dans le toast, et repart avec le temps RESTANT, pas depuis zéro :
// - le minuteur de fermeture ET la barre de vie (classe mjs-toast-paused, qui met l'animation de la barre en pause) ;
// - le doigt ne survole rien : un événement de pointeur de type « touch » ne fige pas le décompte ;
// - survol et focus se cumulent : le décompte ne repart que lorsque les deux sont partis ;
// - `pause: false` (appel) ou `µ.config.notifyPause = false` (réglage global) rendent l'ancien comportement ; l'appel l'emporte sur le
//   réglage ; une valeur non booléenne vaut l'absence d'option ;
// - `duration: 0` (permanent) n'a rien à figer ;
// - les écouteurs posés sur le toast sont retirés à sa fermeture.
// Le survol et le focus réels, et la barre qui s'arrête vraiment, vivent dans mjs-modal-notify-pause-browser.test.ts : happy-dom n'a ni
// animation ni test de survol. Ici une horloge fausse (setTimeout, clearTimeout, Date.now) avance à la main : aucune attente réelle.

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

const INIT_SRC       = stripEsm(readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_init.ts'), 'utf-8'))
const PAGE_CACHE_SRC = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_page_cache.ts'), 'utf-8')
const MODAL_SRC      = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_modal.ts'), 'utf-8')

function loadModal(): { window: any; document: any; µ: any } {
  const window: any = new Window({ url: 'http://localhost/' })
  window.eval(`${INIT_SRC}\n${PAGE_CACHE_SRC}\n${MODAL_SRC}\nglobalThis.µ = µ;`)
  return { window, document: window.document, µ: window.µ }
}

// horloge fausse : les minuteurs et Date.now du window sont remplacés, le temps n'avance que par avancer(ms)
function horloge(window: any) {
  let now = 1000
  let seq = 0
  const taches = new Map<number, { fn: () => void; at: number; ms: number }>()
  window.Date.now = () => now
  window.setTimeout = (fn: () => void, ms = 0) => { seq++; taches.set(seq, { fn, at: now + ms, ms }); return seq }
  window.clearTimeout = (id: number) => { taches.delete(id) }
  return {
    avancer(ms: number) {
      const fin = now + ms
      for (;;) {
        const due = [...taches.entries()].filter(([, t]) => t.at <= fin).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        taches.delete(due[0])
        now = Math.max(now, due[1].at)
        due[1].fn()
      }
      now = fin
    },
    restants: (): number[] => [...taches.values()].map((t) => t.at - now),
    nombre: (): number => taches.size
  }
}

// le prototype qui porte addEventListener : celui des éléments d'un window happy-dom, que window.EventTarget.prototype n'est pas
function protoEcouteurs(window: any): any {
  let proto = Object.getPrototypeOf(window.document.createElement('div'))
  while (!Object.prototype.hasOwnProperty.call(proto, 'addEventListener')) proto = Object.getPrototypeOf(proto)
  return proto
}

const toasts = (document: any): any[] => Array.from(document.body.querySelectorAll('.mjs-toast'))
const barre  = (t: any): any => t.querySelector('.mjs-toast-barre')
const croix  = (t: any): any => t.querySelector('.mjs-toast-close')
const PAUSE  = 'mjs-toast-paused'

// survol : pointerenter / pointerleave ne remontent pas, comme dans un navigateur
const entre  = (window: any, t: any, pointerType = 'mouse') => t.dispatchEvent(new window.PointerEvent('pointerenter', { pointerType }))
const sort   = (window: any, t: any, pointerType = 'mouse') => t.dispatchEvent(new window.PointerEvent('pointerleave', { pointerType }))
// focus : focusin / focusout remontent ; relatedTarget dit où va le focus
const prend  = (window: any, cible: any) => cible.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }))
const perd   = (window: any, cible: any, vers: any = null) => cible.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true, relatedTarget: vers }))

describe('mjs_modal — µ.modal.notify : pause du décompte au survol et au focus', function () {
  describe('survol', function () {
    it('le pointeur fige le minuteur et met la barre en pause ; il repart au départ du pointeur', function () {
      const { window, document, µ } = loadModal()
      const h = horloge(window)
      µ.modal.notify('x', { duration: 4000 })
      const t = toasts(document)[0]
      assert.deepEqual(h.restants(), [4000], 'un minuteur de fermeture, durée pleine')
      assert.equal(t.classList.contains(PAUSE), false)
      entre(window, t)
      assert.equal(h.nombre(), 0, 'minuteur annulé pendant le survol')
      assert.equal(t.classList.contains(PAUSE), true, 'la barre est en pause')
      h.avancer(60000)
      assert.equal(toasts(document).length, 1, 'le toast survolé ne se ferme pas')
      sort(window, t)
      assert.equal(t.classList.contains(PAUSE), false, 'la barre repart')
      assert.equal(h.nombre(), 1, 'minuteur reposé')
    })

    it('le décompte repart avec le temps RESTANT, pas depuis zéro', function () {
      const { window, document, µ } = loadModal()
      const h = horloge(window)
      µ.modal.notify('x', { duration: 4000 })
      const t = toasts(document)[0]
      h.avancer(1500)
      entre(window, t)
      h.avancer(9000)
      sort(window, t)
      assert.deepEqual(h.restants(), [2500], 'il restait 4000 - 1500 ms')
      h.avancer(2499)
      assert.equal(toasts(document).length, 1, 'encore là à 1 ms de la fin')
      h.avancer(1)
      assert.equal(toasts(document).length, 0, 'fermé à la fin du temps restant')
    })

    it('plusieurs survols successifs : le temps écoulé hors survol s\'additionne', function () {
      const { window, document, µ } = loadModal()
      const h = horloge(window)
      µ.modal.notify('x', { duration: 4000 })
      const t = toasts(document)[0]
      h.avancer(1000)
      entre(window, t)
      h.avancer(5000)
      sort(window, t)
      h.avancer(1000)
      entre(window, t)
      h.avancer(5000)
      sort(window, t)
      assert.deepEqual(h.restants(), [2000], '4000 - 1000 - 1000')
      h.avancer(2000)
      assert.equal(toasts(document).length, 0)
    })

    it('un survol sans temps écoulé garde la durée pleine', function () {
      const { window, document, µ } = loadModal()
      const h = horloge(window)
      µ.modal.notify('x', { duration: 4000 })
      const t = toasts(document)[0]
      entre(window, t)
      sort(window, t)
      assert.deepEqual(h.restants(), [4000])
    })

    it('un événement répété (second pointerenter sans pointerleave) ne double rien', function () {
      const { window, document, µ } = loadModal()
      const h = horloge(window)
      µ.modal.notify('x', { duration: 4000 })
      const t = toasts(document)[0]
      h.avancer(500)
      entre(window, t)
      entre(window, t)
      h.avancer(500)
      sort(window, t)
      assert.deepEqual(h.restants(), [3500], 'un seul minuteur, 500 ms écoulées avant le survol')
      sort(window, t)
      assert.deepEqual(h.restants(), [3500], 'un second pointerleave ne change rien')
    })

    it('la souris et le stylet figent le décompte', function () {
      for (const type of ['mouse', 'pen']) {
        const { window, document, µ } = loadModal()
        const h = horloge(window)
        µ.modal.notify('x', { duration: 4000 })
        const t = toasts(document)[0]
        entre(window, t, type)
        assert.equal(h.nombre(), 0, type)
        assert.equal(t.classList.contains(PAUSE), true, type)
        sort(window, t, type)
        assert.equal(h.nombre(), 1, type)
      }
    })

    it('le doigt ne survole rien : ses événements ne figent pas le décompte', function () {
      const { window, document, µ } = loadModal()
      const h = horloge(window)
      µ.modal.notify('x', { duration: 4000 })
      const t = toasts(document)[0]
      entre(window, t, 'touch')
      assert.deepEqual(h.restants(), [4000], 'toujours en train de compter')
      assert.equal(t.classList.contains(PAUSE), false)
      sort(window, t, 'touch')
      assert.deepEqual(h.restants(), [4000])
    })

    it('chaque toast a sa pause : survoler l\'un ne fige pas l\'autre', function () {
      const { window, document, µ } = loadModal()
      const h = horloge(window)
      µ.modal.notify('un', { duration: 3000 })
      µ.modal.notify('deux', { duration: 5000 })
      const [a, b] = toasts(document)
      entre(window, a)
      assert.deepEqual(h.restants(), [5000], 'le minuteur du second continue')
      assert.equal(b.classList.contains(PAUSE), false)
      h.avancer(5000)
      assert.equal(toasts(document).length, 1, 'le second est parti, le premier survolé reste')
      assert.ok(toasts(document)[0] === a, 'le premier, survolé, est toujours là')
    })

    it('la barre garde sa durée d\'origine : c\'est la pause de l\'animation qui la fige', function () {
      const { window, document, µ } = loadModal()
      horloge(window)
      µ.modal.notify('x', { duration: 4000 })
      const t = toasts(document)[0]
      entre(window, t)
      assert.equal(barre(t).style.getPropertyValue('--mjs-toast-duration'), '4000ms')
      sort(window, t)
      assert.equal(barre(t).style.getPropertyValue('--mjs-toast-duration'), '4000ms')
    })
  })

  describe('focus', function () {
    it('le focus dans le toast fige le décompte ; il repart quand le focus le quitte', function () {
      const { window, document, µ } = loadModal()
      const h = horloge(window)
      µ.modal.notify('x', { duration: 4000 })
      const t = toasts(document)[0]
      h.avancer(1000)
      prend(window, croix(t))
      assert.equal(h.nombre(), 0)
      assert.equal(t.classList.contains(PAUSE), true)
      h.avancer(30000)
      assert.equal(toasts(document).length, 1)
      perd(window, croix(t))
      assert.equal(t.classList.contains(PAUSE), false)
      assert.deepEqual(h.restants(), [3000])
    })

    it('le vrai focus et le vrai blur du navigateur de test font de même', function () {
      const { window, document, µ } = loadModal()
      const h = horloge(window)
      µ.modal.notify('x', { duration: 4000 })
      const t = toasts(document)[0]
      croix(t).focus()
      assert.equal(h.nombre(), 0, 'focus() fige')
      croix(t).blur()
      assert.equal(h.nombre(), 1, 'blur() relance')
    })

    it('la couverture d\'un toast cliquable compte aussi', function () {
      const { window, document, µ } = loadModal()
      const h = horloge(window)
      µ.modal.notify('x', { duration: 4000, onClick: () => {} })
      const t = toasts(document)[0]
      const couverture = t.querySelector('.mjs-toast-action')
      prend(window, couverture)
      assert.equal(h.nombre(), 0)
      perd(window, couverture)
      assert.equal(h.nombre(), 1)
    })

    it('le focus qui passe d\'un bouton à l\'autre du même toast ne relance pas le décompte', function () {
      const { window, document, µ } = loadModal()
      const h = horloge(window)
      µ.modal.notify('x', { duration: 4000, onClick: () => {} })
      const t = toasts(document)[0]
      const couverture = t.querySelector('.mjs-toast-action')
      prend(window, couverture)
      perd(window, couverture, croix(t))
      prend(window, croix(t))
      assert.equal(h.nombre(), 0, 'toujours figé')
      assert.equal(t.classList.contains(PAUSE), true)
      perd(window, croix(t), document.body)
      assert.equal(h.nombre(), 1, 'le focus est sorti du toast')
    })
  })

  describe('survol et focus ensemble', function () {
    it('le décompte ne repart que lorsque le pointeur ET le focus sont partis (pointeur parti d\'abord)', function () {
      const { window, document, µ } = loadModal()
      const h = horloge(window)
      µ.modal.notify('x', { duration: 4000 })
      const t = toasts(document)[0]
      entre(window, t)
      prend(window, croix(t))
      sort(window, t)
      assert.equal(h.nombre(), 0, 'le focus tient encore le toast')
      assert.equal(t.classList.contains(PAUSE), true)
      perd(window, croix(t))
      assert.equal(h.nombre(), 1)
      assert.equal(t.classList.contains(PAUSE), false)
    })

    it('… et dans l\'autre ordre (focus parti d\'abord)', function () {
      const { window, document, µ } = loadModal()
      const h = horloge(window)
      µ.modal.notify('x', { duration: 4000 })
      const t = toasts(document)[0]
      prend(window, croix(t))
      entre(window, t)
      perd(window, croix(t))
      assert.equal(h.nombre(), 0, 'le pointeur tient encore le toast')
      sort(window, t)
      assert.equal(h.nombre(), 1)
    })

    it('une seule reprise : un seul minuteur, jamais deux', function () {
      const { window, document, µ } = loadModal()
      const h = horloge(window)
      µ.modal.notify('x', { duration: 4000 })
      const t = toasts(document)[0]
      entre(window, t)
      prend(window, croix(t))
      sort(window, t)
      perd(window, croix(t))
      assert.equal(h.nombre(), 1)
    })
  })

  describe('conteneur déplacé (plein écran)', function () {
    // happy-dom n'a pas l'API Fullscreen : l'élément plein écran est simulé sur le document et `fullscreenchange` déclenché à la main,
    // comme dans notifications-par-dessus-le-plein-ecran.test.ts. Le déplacement du conteneur ne fait ni pointerleave ni focusout ici,
    // comme dans Firefox et WebKit ; :hover n'existe pas non plus, le test dit ce que le navigateur répondrait
    function page() {
      const m = loadModal()
      const h = horloge(m.window)
      m.document.body.insertAdjacentHTML('beforeend', '<div id="plein"></div>')
      return { ...m, h, plein: m.document.getElementById('plein') }
    }
    function entrer(window: any, document: any, el: any): void {
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => el })
      document.dispatchEvent(new window.Event('fullscreenchange', { bubbles: true }))
    }
    const survole = (t: any, oui: boolean): void => { t.matches = (sel: string) => sel === ':hover' && oui }

    it('un survol que le navigateur ne confirme plus : le décompte repart avec le temps restant', function () {
      const { window, document, µ, h, plein } = page()
      µ.modal.notify('x', { duration: 4000 })
      const t = toasts(document)[0]
      h.avancer(1000)
      entre(window, t)
      assert.equal(h.nombre(), 0)
      survole(t, false)
      entrer(window, document, plein)
      assert.equal(plein.querySelector('.mjs-toasts') !== null, true, 'le conteneur a suivi le plein écran')
      assert.equal(t.classList.contains(PAUSE), false, 'la marque de pause est retirée')
      assert.deepEqual(h.restants(), [3000], 'le minuteur repart avec le temps restant')
    })

    it('un toast toujours survolé après le déplacement garde sa pause', function () {
      const { window, document, µ, h, plein } = page()
      µ.modal.notify('x', { duration: 4000 })
      const t = toasts(document)[0]
      entre(window, t)
      survole(t, true)
      entrer(window, document, plein)
      assert.equal(t.classList.contains(PAUSE), true)
      assert.equal(h.nombre(), 0)
    })

    it('un focus perdu sans focusout (l\'élément actif est revenu au corps) est relâché', function () {
      const { window, document, µ, h, plein } = page()
      µ.modal.notify('x', { duration: 4000 })
      const t = toasts(document)[0]
      prend(window, croix(t))
      survole(t, false)
      assert.equal(h.nombre(), 0)
      entrer(window, document, plein)
      assert.equal(t.classList.contains(PAUSE), false, 'plus de focus dans le toast : relâché')
      assert.deepEqual(h.restants(), [4000])
    })

    it('un focus encore dans le toast après le déplacement reste tenu', function () {
      const { window, document, µ, h, plein } = page()
      µ.modal.notify('x', { duration: 4000 })
      const t = toasts(document)[0]
      prend(window, croix(t))
      survole(t, false)
      Object.defineProperty(document, 'activeElement', { configurable: true, get: () => croix(t) })
      entrer(window, document, plein)
      assert.equal(t.classList.contains(PAUSE), true, 'la croix a encore le focus')
      assert.equal(h.nombre(), 0)
    })

    it('chaque toast de la pile est relu : l\'un reste tenu, l\'autre repart', function () {
      const { window, document, µ, h, plein } = page()
      µ.modal.notify('un', { duration: 4000 })
      µ.modal.notify('deux', { duration: 4000 })
      const [un, deux] = toasts(document)
      entre(window, un)
      entre(window, deux)
      survole(un, true)
      survole(deux, false)
      entrer(window, document, plein)
      assert.equal(un.classList.contains(PAUSE), true)
      assert.equal(deux.classList.contains(PAUSE), false)
      assert.equal(h.nombre(), 1, 'un seul minuteur repart')
    })

    it('le focus dans l\'ombre où le conteneur est posé compte encore : on traverse les ombres pour le trouver', function () {
      const { window, document, µ, plein } = page()
      µ.modal.notify('x', { duration: 4000 })
      const t = toasts(document)[0]
      prend(window, croix(t))
      survole(t, false)
      const ombre = plein.attachShadow({ mode: 'open' })
      Object.defineProperty(document, 'activeElement', { configurable: true, get: () => plein })
      Object.defineProperty(ombre, 'activeElement', { configurable: true, get: () => croix(t) })
      entrer(window, document, plein)
      assert.equal(ombre.querySelector('.mjs-toasts') !== null, true, 'le conteneur est dans l\'ombre')
      assert.equal(t.classList.contains(PAUSE), true, 'la croix a le focus, que document.activeElement n\'en rende que l\'hôte')
    })

    it('le focus dans l\'ombre d\'un composant posé dans le toast compte aussi : on remonte par l\'hôte', function () {
      const { window, document, µ, plein } = page()
      const composant = document.createElement('div')
      const bouton = document.createElement('button')
      composant.attachShadow({ mode: 'open' }).appendChild(bouton)
      µ.modal.notify('x', { duration: 4000, icon: composant })
      const t = toasts(document)[0]
      prend(window, composant)
      survole(t, false)
      Object.defineProperty(document, 'activeElement', { configurable: true, get: () => composant })
      Object.defineProperty(composant.shadowRoot, 'activeElement', { configurable: true, get: () => bouton })
      entrer(window, document, plein)
      assert.equal(t.classList.contains(PAUSE), true, 'le bouton de l\'ombre du composant est dans le toast')
    })

    it('un événement de plein écran qui ne déplace rien ne relâche rien', function () {
      const { window, document, µ, h } = page()
      µ.modal.notify('x', { duration: 4000 })
      const t = toasts(document)[0]
      entre(window, t)
      prend(window, croix(t))
      survole(t, false)
      entrer(window, document, null)
      assert.equal(t.classList.contains(PAUSE), true, 'le conteneur n\'a pas bougé : le navigateur n\'a rien oublié')
      assert.equal(h.nombre(), 0)
    })
  })

  describe('réglages : pause (appel) et notifyPause (global)', function () {
    it('par défaut la pause est active', function () {
      const { window, document, µ } = loadModal()
      const h = horloge(window)
      assert.equal(µ.config.notifyPause, true, 'défaut déclaré dans µ.config')
      µ.modal.notify('x', { duration: 4000 })
      entre(window, toasts(document)[0])
      assert.equal(h.nombre(), 0)
    })

    it('pause: false — l\'ancien comportement : ni minuteur figé, ni barre en pause', function () {
      const { window, document, µ } = loadModal()
      const h = horloge(window)
      µ.modal.notify('x', { duration: 4000, pause: false })
      const t = toasts(document)[0]
      entre(window, t)
      prend(window, croix(t))
      assert.deepEqual(h.restants(), [4000])
      assert.equal(t.classList.contains(PAUSE), false)
      h.avancer(4000)
      assert.equal(toasts(document).length, 0, 'le toast se ferme malgré le survol et le focus')
    })

    it('µ.config.notifyPause = false — désactive la pause pour tous les toasts', function () {
      const { window, document, µ } = loadModal()
      const h = horloge(window)
      µ.config.notifyPause = false
      µ.modal.notify('x', { duration: 4000 })
      entre(window, toasts(document)[0])
      assert.deepEqual(h.restants(), [4000])
      h.avancer(4000)
      assert.equal(toasts(document).length, 0)
    })

    it('pause: true par appel l\'emporte sur notifyPause = false', function () {
      const { window, document, µ } = loadModal()
      const h = horloge(window)
      µ.config.notifyPause = false
      µ.modal.notify('x', { duration: 4000, pause: true })
      entre(window, toasts(document)[0])
      assert.equal(h.nombre(), 0)
    })

    it('pause: false par appel l\'emporte sur notifyPause = true', function () {
      const { window, document, µ } = loadModal()
      const h = horloge(window)
      µ.config.notifyPause = true
      µ.modal.notify('x', { duration: 4000, pause: false })
      entre(window, toasts(document)[0])
      assert.deepEqual(h.restants(), [4000])
    })

    it('le réglage global est relu à chaque appel : un changement à chaud vaut pour le toast suivant', function () {
      const { window, document, µ } = loadModal()
      const h = horloge(window)
      µ.config.notifyPause = false
      µ.modal.notify('un', { duration: 4000 })
      µ.config.notifyPause = true
      µ.modal.notify('deux', { duration: 4000 })
      const [a, b] = toasts(document)
      entre(window, a)
      assert.equal(h.nombre(), 2, 'le premier a été posé sans pause')
      entre(window, b)
      assert.equal(h.nombre(), 1, 'le second se fige')
    })

    for (const [nom, valeur] of [['chaîne', 'non'], ['nombre 0', 0], ['nombre 1', 1], ['null', null], ['objet', {}], ['undefined', undefined]] as const) {
      it(`pause non booléen (${nom}) : vaut l'absence d'option, le réglage global décide`, function () {
        for (const global of [true, false]) {
          const { window, document, µ } = loadModal()
          const h = horloge(window)
          µ.config.notifyPause = global
          µ.modal.notify('x', { duration: 4000, pause: valeur as any })
          entre(window, toasts(document)[0])
          assert.equal(h.nombre(), global ? 0 : 1, `notifyPause = ${global}`)
        }
      })

      it(`notifyPause non booléen (${nom}) : vaut le défaut, la pause reste active`, function () {
        const { window, document, µ } = loadModal()
        const h = horloge(window)
        µ.config.notifyPause = valeur
        µ.modal.notify('x', { duration: 4000 })
        entre(window, toasts(document)[0])
        assert.equal(h.nombre(), 0)
      })
    }

    it('un réglage fautif n\'avertit pas : aucun avertissement de la console', function () {
      const { window, document, µ } = loadModal()
      horloge(window)
      const avertis: string[] = []
      µ.warn = (m: string) => { avertis.push(m) }
      µ.config.notifyPause = 'oui'
      µ.modal.notify('x', { duration: 4000, pause: 'non' })
      entre(window, toasts(document)[0])
      assert.deepEqual(avertis, [])
    })
  })

  describe('toast permanent et toast en file', function () {
    it('duration: 0 — rien à figer : ni erreur, ni marque de pause, ni minuteur', function () {
      const { window, document, µ } = loadModal()
      const h = horloge(window)
      µ.modal.notify('x', { duration: 0 })
      const t = toasts(document)[0]
      assert.doesNotThrow(() => { entre(window, t); prend(window, croix(t)); perd(window, croix(t)); sort(window, t) })
      assert.equal(t.classList.contains(PAUSE), false)
      assert.equal(h.nombre(), 0)
      assert.equal(toasts(document).length, 1, 'toujours permanent')
    })

    it('un toast sorti de la file démarre sa durée PLEINE, puis se fige comme les autres', function () {
      const { window, document, µ } = loadModal()
      const h = horloge(window)
      µ.config.notifyMax = 1
      const premier = µ.modal.notify('premier', { duration: 0 })
      µ.modal.notify('second', { duration: 3000 })
      assert.equal(toasts(document).length, 1)
      h.avancer(10000)
      premier.close()
      const t = toasts(document)[0]
      assert.equal(t.querySelector('.mjs-toast-message').textContent, 'second')
      assert.deepEqual(h.restants(), [3000], 'durée pleine à l\'affichage')
      h.avancer(1000)
      entre(window, t)
      h.avancer(9000)
      assert.equal(toasts(document).length, 1, 'figé, il survit à sa durée')
      sort(window, t)
      assert.deepEqual(h.restants(), [2000])
    })
  })

  describe('fermeture', function () {
    it('close() pendant la pause : rien ne traîne, la reprise tardive ne fait rien', function () {
      const { window, document, µ } = loadModal()
      const h = horloge(window)
      const poignee = µ.modal.notify('x', { duration: 4000 })
      const t = toasts(document)[0]
      entre(window, t)
      poignee.close()
      assert.equal(toasts(document).length, 0)
      assert.doesNotThrow(() => sort(window, t))
      assert.equal(h.nombre(), 0, 'aucun minuteur recréé pour un toast fermé')
    })

    it('la croix pendant la pause ferme le toast sans autre effet', function () {
      const { window, document, µ } = loadModal()
      const h = horloge(window)
      µ.modal.notify('x', { duration: 4000 })
      const t = toasts(document)[0]
      entre(window, t)
      croix(t).click()
      assert.equal(toasts(document).length, 0)
      assert.equal(h.nombre(), 0)
    })

    it('les écouteurs posés sur le toast sont retirés à sa fermeture (aucune fuite)', function () {
      const { window, document, µ } = loadModal()
      horloge(window)
      const proto = protoEcouteurs(window)
      const ajout = proto.addEventListener
      const retrait = proto.removeEventListener
      const actifs: Array<{ cible: any; type: string; fn: any; capture: boolean }> = []
      const capture = (o: any) => o === true || (!!o && typeof o === 'object' && !!o.capture)
      proto.addEventListener = function (type: string, fn: any, o: any) {
        if (!actifs.some((a) => a.cible === this && a.type === type && a.fn === fn && a.capture === capture(o))) actifs.push({ cible: this, type, fn, capture: capture(o) })
        return ajout.call(this, type, fn, o)
      }
      proto.removeEventListener = function (type: string, fn: any, o: any) {
        const i = actifs.findIndex((a) => a.cible === this && a.type === type && a.fn === fn && a.capture === capture(o))
        if (i !== -1) actifs.splice(i, 1)
        return retrait.call(this, type, fn, o)
      }
      try {
        const poignee = µ.modal.notify('x', { duration: 4000 })
        const t = toasts(document)[0]
        const surLeToast = () => actifs.filter((a) => a.cible === t).map((a) => a.type).sort()
        assert.ok(surLeToast().length >= 4, `le survol et le focus posent des écouteurs sur le toast (trouvé : ${JSON.stringify(surLeToast())})`)
        poignee.close()
        assert.deepEqual(surLeToast(), [], 'plus aucun écouteur sur le toast fermé')
      } finally {
        proto.addEventListener = ajout
        proto.removeEventListener = retrait
      }
    })

    it('un toast encore en file, fermé avant son affichage, ne laisse rien non plus', function () {
      const { window, document, µ } = loadModal()
      horloge(window)
      const proto = protoEcouteurs(window)
      const ajout = proto.addEventListener
      const retrait = proto.removeEventListener
      const actifs: Array<{ cible: any; type: string; fn: any }> = []
      proto.addEventListener = function (type: string, fn: any, o: any) { actifs.push({ cible: this, type, fn }); return ajout.call(this, type, fn, o) }
      proto.removeEventListener = function (type: string, fn: any, o: any) {
        const i = actifs.findIndex((a) => a.cible === this && a.type === type && a.fn === fn)
        if (i !== -1) actifs.splice(i, 1)
        return retrait.call(this, type, fn, o)
      }
      try {
        µ.config.notifyMax = 1
        µ.modal.notify('premier', { duration: 0 })
        const premierEl = toasts(document)[0]
        const attente = µ.modal.notify('second', { duration: 4000 })
        const avant = actifs.filter((a) => a.cible !== premierEl && a.cible.classList && a.cible.classList.contains('mjs-toast')).length
        assert.ok(avant >= 1, 'le toast en file a ses écouteurs')
        attente.close()
        const apres = actifs.filter((a) => a.cible !== premierEl && a.cible.classList && a.cible.classList.contains('mjs-toast')).length
        assert.equal(apres, 0, 'retirés à la fermeture, affiché ou non')
      } finally {
        proto.addEventListener = ajout
        proto.removeEventListener = retrait
      }
    })

    it('pause: false ne pose aucun écouteur de survol ni de focus sur le toast', function () {
      const { window, document, µ } = loadModal()
      horloge(window)
      const proto = protoEcouteurs(window)
      const ajout = proto.addEventListener
      const types: string[] = []
      proto.addEventListener = function (type: string, fn: any, o: any) {
        if (this.classList && this.classList.contains('mjs-toast')) types.push(type)
        return ajout.call(this, type, fn, o)
      }
      try {
        // swipe: false — le glisser pose son propre pointerleave (l'appui qui sort du toast est oublié) : sans lui, seule la pause pourrait en poser un
        µ.modal.notify('x', { duration: 4000, pause: false, swipe: false })
        assert.ok(toasts(document)[0])
        for (const type of ['pointerenter', 'pointerleave', 'focusin', 'focusout']) assert.equal(types.includes(type), false, type)
      } finally {
        proto.addEventListener = ajout
      }
    })
  })

  describe('feuille de style', function () {
    const m = MODAL_SRC.match(/µ\._mjs_modalSheet\.replaceSync\(`([\s\S]*?)`\);/)
    const css = m ? m[1] : ''

    it('la marque de pause met l\'animation de la barre en pause, après la règle de la barre (qui la remet en marche)', function () {
      assert.ok(m, 'texte de la feuille repérable')
      const regle = css.indexOf(':where(.mjs-toast-paused .mjs-toast-barre){animation-play-state:paused}')
      assert.ok(regle !== -1, 'règle de pause de la barre')
      assert.ok(regle > css.indexOf(':where(.mjs-toast-barre){'), 'posée après la règle de la barre : même poids, la dernière gagne')
    })

    it('zéro style inline : la pause ne pose aucun attribut style sur le toast', function () {
      const { window, document, µ } = loadModal()
      horloge(window)
      µ.modal.notify('x', { duration: 4000 })
      const t = toasts(document)[0]
      entre(window, t)
      assert.equal(t.hasAttribute('style'), false)
    })
  })
})
