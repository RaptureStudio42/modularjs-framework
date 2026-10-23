// µ.modal.notify(message, { swipe }) et µ.config.notifySwipe (mjs_modal.ts) — glisser un toast pour le fermer, doigt, souris ou stylet :
// - on attrape le toast et on le tire à l'horizontale : il suit le pointeur (propriété --mjs-toast-dx, classe mjs-toast-dragging) ;
// - au lâcher, au-delà d'un seuil (80 px, ou 35 % de la largeur du toast s'il est plus étroit, ou un lancer assez rapide) dans un sens
//   permis, il sort en glissant (classe mjs-toast-sliding, 200 ms) puis se ferme par le chemin de la croix ; en deçà, il revient ;
// - sens permis : préréglage ancré à droite, vers la droite ; à gauche, vers la gauche ; position libre posée d'un seul côté, lue sur la place
//   de la pile à l'appui (milieu dans le tiers central de la fenêtre : les deux sens, sinon le bord le plus proche) ; posée des deux côtés
//   ou d'aucun, les deux ;
// - la sortie va jusqu'au bout : le toast quitte entièrement la fenêtre, à droite comme à gauche ;
// - minuteur et barre de vie figés pendant le glisser (même mécanisme que la pause), ils repartent si le toast revient ;
// - prefers-reduced-motion: reduce : le toast suit encore le pointeur, mais ni sortie ni retour animés ;
// - moins de 8 px, le geste reste un clic ; après un vrai glisser, le clic qui suit le lâcher est avalé ;
// - un appui qui n'a jamais été un glisser (sorti du toast, relâché dehors) ne laisse rien derrière lui : le survol sans bouton ne tire pas
//   le toast, le geste suivant part de son propre appui, un autre appui parti de la page et traîné sur le toast ne le tire pas (la sortie du
//   pointeur oublie l'appui, celle d'un autre pointeur ou d'un glisser commencé n'oublie rien), et un glisser dont le lâcher s'est perdu rend le toast ;
// - un seul pointeur primaire à la fois (le doigt non primaire est ignoré), le pointeur est capturé, un toast repris en main pendant son
//   retour n'est pas défait par la fin de ce retour ;
// - la souris et le stylet n'ont ni sélection de texte ni glisser natif (pointerdown retenu) ; le doigt garde le défilement vertical ;
// - `swipe: false` (appel) ou `µ.config.notifySwipe = false` (global) désactivent tout ; l'appel l'emporte ; valeur non booléenne = absence d'option ;
// - les écouteurs sont retirés à la fermeture.
// Le glisser réel (souris, doigt), l'ancrage lu sur la mise en page et touch-action vivent dans mjs-modal-notify-swipe-browser.test.ts :
// happy-dom n'a ni géométrie ni défilement. Ici, une horloge fausse et des boîtes posées à la main.

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

// horloge fausse : setTimeout, clearTimeout et Date.now du window, avancés à la main
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
    restants: (): number[] => [...taches.values()].map((t) => t.at - now).sort((a, b) => a - b),
    nombre: (): number => taches.size
  }
}

const toasts = (document: any): any[] => Array.from(document.body.querySelectorAll('.mjs-toast'))
const dx     = (t: any): string => t.style.getPropertyValue('--mjs-toast-dx')
const a      = (t: any, classe: string): boolean => t.classList.contains(classe)
const SWIPE  = 'mjs-toast-swipe'
const TIRE   = 'mjs-toast-dragging'
const GLISSE = 'mjs-toast-sliding'
const PAUSE  = 'mjs-toast-paused'

// événement de pointeur à l'instant t (ms de l'horloge des événements) ; la pose du bouton compte pour le clic de l'appel ; `buttons`
// dit les boutons enfoncés, comme dans un navigateur : un à la pose et pendant le déplacement, aucun au lâcher et à l'annulation
function ev(window: any, cible: any, type: string, x: number, t: number, o: { y?: number; id?: number; pointeur?: string; bouton?: number; boutons?: number; primaire?: boolean } = {}): any {
  const enfonce = type === 'pointerdown' || type === 'pointermove' ? 1 : 0
  const e = new window.PointerEvent(type, { bubbles: true, cancelable: true, pointerId: o.id ?? 1, pointerType: o.pointeur ?? 'mouse', isPrimary: o.primaire ?? true, button: o.bouton ?? 0, buttons: o.boutons ?? enfonce, clientX: x, clientY: o.y ?? 20 })
  Object.defineProperty(e, 'timeStamp', { value: t })
  cible.dispatchEvent(e)
  return e
}

// un toast de 400 px posé à la main (happy-dom n'a pas de mise en page) : la pile en haut à droite d'une fenêtre de 1024 px
function poser(t: any, largeur = 400): void {
  Object.defineProperty(t, 'offsetWidth', { value: largeur, configurable: true })
  t.getBoundingClientRect = () => ({ left: 1024 - 16 - largeur, right: 1024 - 16, top: 16, bottom: 86, width: largeur, height: 70 })
}

// la boîte d'un toast de 400 px comme un navigateur la rend : le décalage --mjs-toast-dx la déplace (posé à gauche = 16, à droite = 608)
function poserMobile(t: any, gauche: number): void {
  Object.defineProperty(t, 'offsetWidth', { value: 400, configurable: true })
  t.getBoundingClientRect = () => {
    const d = parseFloat(t.style.getPropertyValue('--mjs-toast-dx')) || 0
    return { left: gauche + d, right: gauche + 400 + d, top: 16, bottom: 86, width: 400, height: 70 }
  }
}

// la place de la pile (le conteneur des toasts) : pour une position libre, MJS la lit à l'appui
function poserPile(t: any, gauche: number, droite: number): void {
  t.parentNode.getBoundingClientRect = () => ({ left: gauche, right: droite, top: 16, bottom: 86, width: droite - gauche, height: 70 })
}

// geste complet : pointerdown en x0, déplacements [x, t], puis la fin (pointerup par défaut)
function geste(window: any, t: any, x0: number, points: Array<[number, number]>, fin = 'pointerup', o: { pointeur?: string; id?: number } = {}): void {
  ev(window, t, 'pointerdown', x0, 0, o)
  for (const [x, tm] of points) ev(window, t, 'pointermove', x, tm, o)
  const [xf, tf] = points.length ? points[points.length - 1] : [x0, 0]
  ev(window, t, fin, xf, tf + 1, o)
}

// vingt déplacements réguliers de x0 à x1, étalés sur `duree` ms
function trajet(x0: number, x1: number, duree: number): Array<[number, number]> {
  return Array.from({ length: 20 }, (_, i) => [x0 + ((x1 - x0) * (i + 1)) / 20, (duree * (i + 1)) / 20] as [number, number])
}

// nouvelle page avec un toast posé ; la fonction rend tout ce qu'il faut
function un(opts: any = {}, config: any = {}) {
  const m = loadModal()
  const h = horloge(m.window)
  Object.assign(m.µ.config, config)
  m.µ.modal.notify('x', Object.assign({ duration: 4000 }, opts))
  const t = toasts(m.document)[0]
  poser(t)
  return { ...m, h, t }
}

describe('mjs_modal — µ.modal.notify : glisser pour fermer', function () {
  describe('suivre le pointeur', function () {
    it('par défaut le toast est prêt à glisser : classe mjs-toast-swipe, rien d\'autre sur lui', function () {
      const { t } = un()
      assert.equal(a(t, SWIPE), true)
      assert.equal(a(t, TIRE) || a(t, GLISSE), false)
      assert.equal(t.hasAttribute('style'), false, 'aucun style inline au repos')
    })

    it('le toast suit le pointeur vers la droite sur une pile ancrée à droite', function () {
      const { window, t } = un()
      ev(window, t, 'pointerdown', 500, 0)
      ev(window, t, 'pointermove', 530, 10)
      assert.equal(a(t, TIRE), true)
      assert.equal(dx(t), '30px')
      ev(window, t, 'pointermove', 590, 20)
      assert.equal(dx(t), '90px', 'il suit le pointeur')
      ev(window, t, 'pointermove', 560, 30)
      assert.equal(dx(t), '60px', 'dans les deux sens, jusqu\'à sa place')
    })

    it('sur une pile ancrée à droite, tirer vers la gauche ne le déplace pas', function () {
      const { window, t } = un()
      ev(window, t, 'pointerdown', 500, 0)
      ev(window, t, 'pointermove', 440, 10)
      assert.equal(dx(t), '0px')
      ev(window, t, 'pointermove', 520, 20)
      assert.equal(dx(t), '20px', 'le sens permis reprend la main')
    })

    it('sur une pile ancrée à gauche : vers la gauche seulement', function () {
      const { window, t } = un({}, { notifyPosition: 'top-left' })
      ev(window, t, 'pointerdown', 500, 0)
      ev(window, t, 'pointermove', 560, 10)
      assert.equal(dx(t), '0px', 'vers la droite, rien')
      ev(window, t, 'pointermove', 430, 20)
      assert.equal(dx(t), '-70px', 'vers la gauche, il suit')
    })

    it('les quatre préréglages du bas et du quart : le côté du nom décide', function () {
      for (const [position, permis] of [['bottom-right', 1], ['bottom-left', -1], ['quarter-top-right', 1], ['quarter-top-left', -1], ['quarter-bottom-right', 1], ['quarter-bottom-left', -1]] as const) {
        const { window, t } = un({}, { notifyPosition: position })
        ev(window, t, 'pointerdown', 500, 0)
        ev(window, t, 'pointermove', 500 + 50 * permis, 10)
        assert.equal(dx(t), (50 * permis) + 'px', `${position} : le sens permis`)
        ev(window, t, 'pointermove', 500 - 50 * permis, 20)
        assert.equal(dx(t), '0px', `${position} : le sens contraire`)
      }
    })

    it('une pile centrée ou posée au pixel près (sans côté lisible) : les deux sens', function () {
      const { window, t } = un({}, { notifyPosition: { top: '80px' } })
      ev(window, t, 'pointerdown', 500, 0)
      ev(window, t, 'pointermove', 440, 10)
      assert.equal(dx(t), '-60px')
      ev(window, t, 'pointermove', 560, 20)
      assert.equal(dx(t), '60px')
    })

    it('moins de 8 px reste un clic : rien ne bouge, aucune marque', function () {
      const { window, t } = un()
      ev(window, t, 'pointerdown', 500, 0)
      ev(window, t, 'pointermove', 507, 10)
      assert.equal(a(t, TIRE), false)
      assert.equal(dx(t), '')
      ev(window, t, 'pointerup', 507, 20)
      assert.equal(a(t, GLISSE), false)
    })

    it('8 px suffisent à commencer', function () {
      const { window, t } = un()
      ev(window, t, 'pointerdown', 500, 0)
      ev(window, t, 'pointermove', 508, 10)
      assert.equal(a(t, TIRE), true)
    })

    it('un geste d\'abord vertical n\'est pas un glisser, même s\'il devient horizontal ensuite', function () {
      const { window, t } = un()
      ev(window, t, 'pointerdown', 500, 0, { y: 20 })
      ev(window, t, 'pointermove', 502, 10, { y: 40 })
      ev(window, t, 'pointermove', 600, 20, { y: 41 })
      assert.equal(a(t, TIRE), false)
      assert.equal(dx(t), '')
    })

    it('le toast n\'a pas d\'attribut style tant qu\'il n\'est pas tiré, et seulement la propriété --mjs-toast-dx ensuite', function () {
      const { window, t } = un()
      ev(window, t, 'pointerdown', 500, 0)
      ev(window, t, 'pointermove', 540, 10)
      assert.equal((t.getAttribute('style') || '').replace(/\s/g, ''), '--mjs-toast-dx:40px;')
    })

    it('le glisser rend le focus : le bouton pressé ne tient pas le toast après son retour', function () {
      const { window, h, t } = un()
      const croix = t.querySelector('.mjs-toast-close')
      croix.focus()
      assert.equal(h.nombre(), 0, 'le focus fige le décompte')
      ev(window, croix, 'pointerdown', 500, 0)
      ev(window, croix, 'pointermove', 530, 10)
      assert.equal(window.document.activeElement === croix, false, 'le focus a quitté la croix')
      ev(window, croix, 'pointerup', 530, 20)
      assert.equal(a(t, PAUSE), false, 'plus rien ne tient le décompte')
      assert.ok(h.restants().some((r) => r > 1000), 'le minuteur est reparti')
    })

    it('lostpointercapture venu d\'un enfant (la capture implicite du doigt cède la place à la nôtre) ne lâche pas le glisser', function () {
      const { window, t } = un()
      const croix = t.querySelector('.mjs-toast-close')
      ev(window, t, 'pointerdown', 500, 0, { pointeur: 'touch' })
      ev(window, t, 'pointermove', 520, 10, { pointeur: 'touch' })
      ev(window, croix, 'lostpointercapture', 520, 11, { pointeur: 'touch' })
      ev(window, t, 'pointermove', 560, 20, { pointeur: 'touch' })
      assert.equal(a(t, TIRE), true, 'toujours en main')
      assert.equal(dx(t), '60px')
    })

    it('lostpointercapture du toast lui-même : le navigateur a repris le geste, le toast revient', function () {
      const { window, t } = un()
      ev(window, t, 'pointerdown', 500, 0, { pointeur: 'touch' })
      ev(window, t, 'pointermove', 560, 10, { pointeur: 'touch' })
      ev(window, t, 'lostpointercapture', 560, 11, { pointeur: 'touch' })
      assert.equal(a(t, TIRE), false)
      assert.equal(a(t, GLISSE), true, 'retour en glissant')
      assert.equal(dx(t), '0px')
    })

    it('un second pointeur est ignoré pendant le glisser', function () {
      const { window, t } = un()
      ev(window, t, 'pointerdown', 500, 0, { id: 1 })
      ev(window, t, 'pointermove', 540, 10, { id: 1 })
      ev(window, t, 'pointerdown', 300, 11, { id: 2 })
      ev(window, t, 'pointermove', 100, 12, { id: 2 })
      assert.equal(dx(t), '40px')
      ev(window, t, 'pointerup', 100, 13, { id: 2 })
      assert.equal(a(t, TIRE), true, 'la fin de l\'autre pointeur ne le lâche pas')
    })

    it('un doigt non primaire est ignoré : deux toasts ne se tirent pas à la fois', function () {
      const m = loadModal()
      horloge(m.window)
      m.µ.modal.notify('un', { duration: 0 })
      m.µ.modal.notify('deux', { duration: 0 })
      const [premier, second] = toasts(m.document)
      poser(premier)
      poser(second)
      ev(m.window, premier, 'pointerdown', 500, 0, { pointeur: 'touch', id: 1 })
      ev(m.window, premier, 'pointermove', 540, 10, { pointeur: 'touch', id: 1 })
      ev(m.window, second, 'pointerdown', 500, 11, { pointeur: 'touch', id: 2, primaire: false })
      ev(m.window, second, 'pointermove', 560, 12, { pointeur: 'touch', id: 2, primaire: false })
      assert.equal(dx(premier), '40px', 'le premier doigt tire le premier toast')
      assert.equal(a(second, TIRE), false, 'le second doigt ne tire rien')
      assert.equal(dx(second), '')
    })

    it('le pointeur est capturé dès que le glisser commence : les mouvements suivent hors du toast et de la fenêtre', function () {
      const { window, t } = un()
      const vus: number[] = []
      t.setPointerCapture = (id: number) => { vus.push(id) }
      ev(window, t, 'pointerdown', 500, 0, { id: 7 })
      ev(window, t, 'pointermove', 504, 5, { id: 7 })
      assert.deepEqual(vus, [], 'un geste sous 8 px reste un clic : pas de capture')
      ev(window, t, 'pointermove', 540, 10, { id: 7 })
      assert.deepEqual(vus, [7], 'capturé au début du glisser')
      ev(window, t, 'pointermove', 560, 20, { id: 7 })
      assert.deepEqual(vus, [7], 'une seule fois')
    })
  })

  describe('un état de glisser qui ne tient plus', function () {
    // appui à quelques pixels du bord du toast, pointeur sorti avant d'avoir fait 8 px, bouton relâché dehors : le toast ne voit jamais le lâcher
    const rate = (window: any, document: any, t: any, pointeur = 'mouse'): void => {
      ev(window, t, 'pointerdown', 404, 0, { pointeur })
      ev(window, t, 'pointermove', 402, 5, { pointeur })
      ev(window, document.body, 'pointerup', 380, 10, { pointeur })
    }

    it('le survol qui suit (aucun bouton enfoncé) ne fait pas suivre le toast : souris et stylet', function () {
      for (const pointeur of ['mouse', 'pen']) {
        const { window, document, h, t } = un()
        rate(window, document, t, pointeur)
        ev(window, t, 'pointermove', 600, 20, { pointeur, boutons: 0 })
        ev(window, t, 'pointermove', 640, 30, { pointeur, boutons: 0 })
        assert.equal(a(t, TIRE), false, `${pointeur} : rien à tirer sans bouton`)
        assert.equal(dx(t), '', pointeur)
        assert.equal(a(t, PAUSE), false, `${pointeur} : le décompte n'est pas tenu`)
        h.avancer(4000)
        assert.equal(toasts(document).length, 0, `${pointeur} : il se ferme à son heure`)
      }
    })

    it('le geste suivant part de son propre appui, pas de l\'ancien', function () {
      const { window, document, h, t } = un()
      rate(window, document, t)
      ev(window, t, 'pointerdown', 700, 20)
      ev(window, t, 'pointermove', 710, 30)
      assert.equal(dx(t), '10px', 'dix pixels depuis le nouvel appui')
      ev(window, t, 'pointerup', 710, 40)
      h.avancer(300)
      assert.equal(toasts(document).length, 1, 'trop près pour sortir : il revient')
    })

    it('l\'appui qui sort du toast est oublié : un autre appui, parti de la page et traîné bouton tenu sur le toast, ne le tire pas : souris et stylet', function () {
      for (const pointeur of ['mouse', 'pen']) {
        const { window, document, h, t } = un()
        ev(window, t, 'pointerdown', 404, 0, { pointeur })
        ev(window, t, 'pointermove', 402, 5, { pointeur })
        ev(window, t, 'pointerleave', 380, 6, { pointeur, boutons: 1 })
        ev(window, document.body, 'pointerup', 300, 10, { pointeur })
        ev(window, t, 'pointermove', 600, 20, { pointeur, boutons: 1 })
        ev(window, t, 'pointermove', 660, 30, { pointeur, boutons: 1 })
        assert.equal(a(t, TIRE), false, `${pointeur} : le geste n'a pas commencé sur le toast`)
        assert.equal(dx(t), '', pointeur)
        assert.equal(a(t, PAUSE), false, `${pointeur} : le décompte n'est pas tenu`)
        ev(window, document.body, 'pointerup', 660, 40, { pointeur })
        h.avancer(4000)
        assert.equal(toasts(document).length, 0, `${pointeur} : il se ferme à son heure`)
      }
    })

    it('la sortie d\'un autre pointeur n\'oublie pas l\'appui en cours', function () {
      const { window, t } = un()
      ev(window, t, 'pointerdown', 500, 0, { id: 1 })
      ev(window, t, 'pointerleave', 450, 3, { id: 2 })
      ev(window, t, 'pointermove', 540, 10, { id: 1 })
      assert.equal(dx(t), '40px')
    })

    it('un glisser commencé n\'est pas abandonné à la sortie du pointeur : capturé, le toast le suit hors de lui', function () {
      const { window, t } = un()
      ev(window, t, 'pointerdown', 500, 0)
      ev(window, t, 'pointermove', 540, 10)
      assert.equal(a(t, TIRE), true)
      ev(window, t, 'pointerleave', 700, 20, { boutons: 1 })
      ev(window, t, 'pointermove', 620, 30)
      assert.equal(a(t, TIRE), true)
      assert.equal(dx(t), '120px')
    })

    it('un glisser dont le lâcher s\'est perdu (plus aucun bouton enfoncé) rend le toast, sans le fermer : souris et stylet', function () {
      for (const pointeur of ['mouse', 'pen']) {
        const { window, document, h, t } = un()
        ev(window, t, 'pointerdown', 500, 0, { pointeur })
        ev(window, t, 'pointermove', 530, 10, { pointeur })
        assert.equal(a(t, TIRE), true, pointeur)
        ev(window, t, 'pointermove', 640, 20, { pointeur, boutons: 0 })
        assert.equal(a(t, TIRE), false, `${pointeur} : le geste est fini`)
        assert.equal(a(t, GLISSE), true, `${pointeur} : il revient en glissant`)
        assert.equal(dx(t), '0px', pointeur)
        assert.equal(a(t, PAUSE), false, `${pointeur} : le décompte repart`)
        h.avancer(300)
        assert.equal(toasts(document).length, 1, `${pointeur} : jamais fermé par un lâcher perdu, même loin`)
      }
    })

    it('le doigt n\'a pas de bouton à surveiller : un déplacement tactile suit, quoi que dise `buttons`', function () {
      const { window, t } = un()
      ev(window, t, 'pointerdown', 500, 0, { pointeur: 'touch' })
      ev(window, t, 'pointermove', 540, 10, { pointeur: 'touch', boutons: 0 })
      assert.equal(dx(t), '40px')
    })
  })

  describe('le pointeur au départ', function () {
    it('la souris et le stylet : pointerdown retenu — ni sélection de texte ni glisser natif', function () {
      for (const pointeur of ['mouse', 'pen']) {
        const { window, t } = un()
        assert.equal(ev(window, t, 'pointerdown', 500, 0, { pointeur }).defaultPrevented, true, pointeur)
      }
    })

    it('sur un bouton ou un lien du toast (la croix, la couverture), pointerdown n\'est pas retenu : focus et :active restent', function () {
      const m = loadModal()
      horloge(m.window)
      m.µ.modal.notify('x', { duration: 0, href: '#/suite' })
      const t = toasts(m.document)[0]
      poser(t)
      assert.equal(ev(m.window, t.querySelector('.mjs-toast-action'), 'pointerdown', 500, 0).defaultPrevented, false, 'la couverture (lien)')
      ev(m.window, t.querySelector('.mjs-toast-action'), 'pointerup', 500, 5)
      assert.equal(ev(m.window, t.querySelector('.mjs-toast-close'), 'pointerdown', 500, 10).defaultPrevented, false, 'la croix')
      assert.equal(ev(m.window, t.querySelector('.mjs-toast-message'), 'pointerup', 500, 15).defaultPrevented, false)
      assert.equal(ev(m.window, t.querySelector('.mjs-toast-message'), 'pointerdown', 500, 20).defaultPrevented, true, 'le texte, lui, est retenu')
    })

    it('le lien de la couverture n\'est pas déplaçable en natif : le toast glisse à sa place', function () {
      const m = loadModal()
      horloge(m.window)
      m.µ.modal.notify('x', { duration: 0, href: '#/suite' })
      assert.equal(toasts(m.document)[0].querySelector('.mjs-toast-action').getAttribute('draggable'), 'false')
    })

    it('le doigt : pointerdown intact (le défilement vertical reste au navigateur)', function () {
      const { window, t } = un()
      assert.equal(ev(window, t, 'pointerdown', 500, 0, { pointeur: 'touch' }).defaultPrevented, false)
    })

    it('un autre bouton que le premier (clic droit, clic du milieu) ne commence rien et n\'est pas retenu', function () {
      for (const bouton of [1, 2]) {
        const { window, t } = un()
        const e = ev(window, t, 'pointerdown', 500, 0, { bouton })
        ev(window, t, 'pointermove', 560, 10)
        assert.equal(e.defaultPrevented, false, `bouton ${bouton}`)
        assert.equal(a(t, TIRE), false, `bouton ${bouton}`)
      }
    })

    it('le doigt glisse comme la souris', function () {
      const { window, t } = un()
      ev(window, t, 'pointerdown', 500, 0, { pointeur: 'touch' })
      ev(window, t, 'pointermove', 540, 10, { pointeur: 'touch' })
      assert.equal(dx(t), '40px')
    })
  })

  describe('le minuteur pendant le glisser', function () {
    it('minuteur et barre figés pendant qu\'on tire, repartis avec le temps restant si le toast revient', function () {
      const { window, h, t } = un()
      h.avancer(1000)
      ev(window, t, 'pointerdown', 500, 0)
      ev(window, t, 'pointermove', 530, 10)
      assert.equal(h.nombre(), 0, 'minuteur arrêté')
      assert.equal(a(t, PAUSE), true, 'barre en pause')
      h.avancer(30000)
      assert.equal(toasts(window.document).length, 1, 'il survit à sa durée')
      ev(window, t, 'pointerup', 530, 20)
      assert.equal(a(t, PAUSE), false, 'barre relancée dès le lâcher')
      assert.deepEqual(h.restants().filter((r) => r > 1000), [3000], 'il restait 4000 - 1000 ms')
    })

    it('même avec pause: false : un toast qu\'on tient en main ne se ferme pas sous le doigt', function () {
      const { window, h, t } = un({ pause: false })
      ev(window, t, 'pointerdown', 500, 0)
      ev(window, t, 'pointermove', 530, 10)
      assert.equal(h.nombre(), 0)
      h.avancer(30000)
      assert.equal(toasts(window.document).length, 1)
    })

    it('si le survol tient encore le toast après son retour, le décompte reste figé', function () {
      const { window, h, t } = un()
      t.dispatchEvent(new window.PointerEvent('pointerenter', { pointerType: 'mouse' }))
      ev(window, t, 'pointerdown', 500, 0)
      ev(window, t, 'pointermove', 530, 10)
      ev(window, t, 'pointerup', 530, 20)
      assert.equal(h.nombre() <= 1 && h.restants().every((r) => r < 1000), true, 'seul le retour est planifié')
      assert.equal(a(t, PAUSE), true, 'le pointeur est encore sur le toast')
    })

    it('un toast permanent se glisse aussi', function () {
      const { window, h, t } = un({ duration: 0 })
      geste(window, t, 500, trajet(500, 620, 100))
      h.avancer(300)
      assert.equal(toasts(window.document).length, 0)
    })
  })

  describe('au lâcher', function () {
    it('au-delà de 80 px dans le sens permis : il sort en glissant, puis se ferme', function () {
      const { window, document, h, t } = un()
      ev(window, t, 'pointerdown', 500, 0)
      ev(window, t, 'pointermove', 600, 300)
      ev(window, t, 'pointerup', 600, 600)
      assert.equal(toasts(document).length, 1, 'encore là pendant la sortie')
      assert.equal(a(t, GLISSE), true)
      assert.equal(a(t, TIRE), false)
      assert.ok(parseFloat(dx(t)) > 400, `il va au-delà du bord droit (dx ${dx(t)})`)
      h.avancer(150)
      assert.equal(toasts(document).length, 1, 'la sortie dure environ 200 ms')
      h.avancer(150)
      assert.equal(toasts(document).length, 0, 'fermé à la fin')
    })

    it('vers la gauche sur une pile ancrée à gauche : il sort par la gauche', function () {
      const { window, document, h, t } = un({}, { notifyPosition: 'bottom-left' })
      geste(window, t, 500, trajet(500, 380, 300))
      assert.ok(parseFloat(dx(t)) < -300, `dx ${dx(t)}`)
      h.avancer(300)
      assert.equal(toasts(document).length, 0)
    })

    it('une pile centrée sort par le côté où on l\'a tirée', function () {
      for (const [vers, signe] of [[620, 1], [380, -1]] as const) {
        const { window, document, h, t } = un({}, { notifyPosition: { top: '10px' } })
        geste(window, t, 500, trajet(500, vers, 300))
        assert.equal(Math.sign(parseFloat(dx(t))), signe)
        h.avancer(300)
        assert.equal(toasts(document).length, 0)
      }
    })

    it('79 px, lentement : il revient ; 80 px : il sort', function () {
      for (const [distance, sort] of [[79, false], [80, true]] as const) {
        const { window, document, h, t } = un()
        geste(window, t, 500, trajet(500, 500 + distance, 1000))
        assert.equal(a(t, GLISSE), true)
        h.avancer(300)
        assert.equal(toasts(document).length, sort ? 0 : 1, `${distance} px`)
      }
    })

    it('un toast étroit : le seuil est 35 % de sa largeur', function () {
      const { window, t } = un()
      poser(t, 160)
      geste(window, t, 500, trajet(500, 560, 1000))
      assert.ok(parseFloat(dx(t)) > 100, '60 px sur 160 px (56 px de seuil) : il sort')
      const autre = un()
      poser(autre.t, 160)
      geste(autre.window, autre.t, 500, trajet(500, 554, 1000))
      assert.equal(dx(autre.t), '0px', '54 px sur 160 px : il revient à sa place')
    })

    it('un lancer rapide suffit : 30 px en 40 ms sortent le toast', function () {
      const { window, document, h, t } = un()
      geste(window, t, 500, [[510, 10], [520, 20], [530, 30], [540, 40]])
      h.avancer(300)
      assert.equal(toasts(document).length, 0)
    })

    it('le même trajet lent revient', function () {
      const { window, document, h, t } = un()
      geste(window, t, 500, [[510, 100], [520, 200], [530, 300], [540, 400]])
      h.avancer(300)
      assert.equal(toasts(document).length, 1)
    })

    it('un lancer trop court (moins de 24 px) ne ferme pas', function () {
      const { window, document, h, t } = un()
      geste(window, t, 500, [[510, 5], [520, 10]])
      h.avancer(300)
      assert.equal(toasts(document).length, 1)
    })

    it('un lancer dans le sens contraire à celui du déplacement ne ferme pas', function () {
      const { window, document, h, t } = un()
      geste(window, t, 500, [[560, 100], [600, 200], [590, 210], [560, 220], [535, 230]])
      h.avancer(300)
      assert.equal(toasts(document).length, 1, 'tiré vers la droite puis ramené d\'un geste vif vers la gauche')
    })

    it('un pointeur qui s\'est arrêté avant le lâcher n\'a plus de vitesse', function () {
      const { window, document, h, t } = un()
      ev(window, t, 'pointerdown', 500, 0)
      ev(window, t, 'pointermove', 515, 10)
      ev(window, t, 'pointermove', 535, 20)
      ev(window, t, 'pointerup', 535, 500)
      h.avancer(300)
      assert.equal(toasts(document).length, 1)
    })

    it('en deçà du seuil il revient d\'abord en glissant, puis la marque s\'efface sans laisser de style', function () {
      const { window, document, h, t } = un()
      geste(window, t, 500, trajet(500, 540, 1000))
      assert.equal(a(t, GLISSE), true)
      assert.equal(dx(t), '0px', 'il rejoint sa place')
      h.avancer(300)
      assert.equal(a(t, GLISSE), false)
      assert.equal(t.hasAttribute('style'), false, 'plus aucun style')
      assert.equal(toasts(document).length, 1)
    })

    it('un glisser sans déplacement utile (sens interdit) ne laisse ni marque ni style', function () {
      const { window, h, t } = un()
      geste(window, t, 500, trajet(500, 380, 1000))
      h.avancer(300)
      assert.equal(a(t, TIRE) || a(t, GLISSE), false)
      assert.equal(t.hasAttribute('style'), false)
    })

    it('pointercancel (le navigateur reprend le geste pour défiler) : le toast revient, jamais fermé', function () {
      const { window, document, h, t } = un()
      geste(window, t, 500, trajet(500, 700, 100), 'pointercancel')
      h.avancer(500)
      assert.equal(toasts(document).length, 1)
      assert.equal(a(t, TIRE) || a(t, GLISSE), false)
      assert.equal(a(t, PAUSE), false, 'le décompte repart')
    })

    it('un nouveau glisser pendant la sortie est ignoré', function () {
      const { window, document, h, t } = un()
      geste(window, t, 500, trajet(500, 620, 100))
      ev(window, t, 'pointerdown', 500, 700)
      ev(window, t, 'pointermove', 400, 710)
      assert.equal(a(t, TIRE), false)
      h.avancer(300)
      assert.equal(toasts(document).length, 0)
    })

    it('un toast repris en main pendant son retour n\'est pas défait par la fin de ce retour', function () {
      const { window, h, t } = un()
      geste(window, t, 500, trajet(500, 540, 1000))
      assert.equal(a(t, GLISSE), true, 'il revient en glissant')
      h.avancer(100)
      ev(window, t, 'pointerdown', 520, 2000)
      ev(window, t, 'pointermove', 550, 2010)
      assert.equal(a(t, TIRE), true, 'repris en main')
      h.avancer(300)
      assert.equal(a(t, TIRE), true, 'le délai du retour interrompu n\'a rien défait')
      assert.equal(a(t, GLISSE), false)
      assert.equal(dx(t), '30px', 'le décalage de la nouvelle prise est intact')
    })
  })

  describe('la sortie va jusqu\'au bout', function () {
    it('vers la gauche : le toast sort entièrement, son bord droit dépasse de 32 px le bord gauche de la fenêtre', function () {
      const { window, document, h, t } = un({}, { notifyPosition: 'bottom-left' })
      poserMobile(t, 16)
      geste(window, t, 500, trajet(500, 380, 300))
      assert.equal(16 + 400 + parseFloat(dx(t)), -32, `décalage ${dx(t)}`)
      h.avancer(300)
      assert.equal(toasts(document).length, 0)
    })

    it('vers la droite : le toast sort entièrement, son bord gauche dépasse de 32 px le bord droit de la fenêtre', function () {
      const { window, document, h, t } = un()
      poserMobile(t, 608)
      geste(window, t, 500, trajet(500, 620, 300))
      assert.equal(608 + parseFloat(dx(t)), window.innerWidth + 32, `décalage ${dx(t)}`)
      h.avancer(300)
      assert.equal(toasts(document).length, 0)
    })
  })

  describe('le sens permis d\'une position libre se lit sur la place de la pile', function () {
    // tire à gauche puis à droite depuis la prise ; rend le décalage obtenu de chaque côté
    const sens = (position: any, gauche: number, droite: number): [string, string] => {
      const { window, t } = un({}, { notifyPosition: position })
      poserPile(t, gauche, droite)
      ev(window, t, 'pointerdown', 500, 0)
      ev(window, t, 'pointermove', 440, 10)
      const vers_gauche = dx(t)
      ev(window, t, 'pointermove', 560, 20)
      return [vers_gauche, dx(t)]
    }

    it('une pile centrée par left: 50 % et un translate (un seul côté posé, milieu de la fenêtre) : les deux sens', function () {
      assert.deepEqual(sens({ top: '16px', left: '50%' }, 312, 712), ['-60px', '60px'])
    })

    it('un seul côté posé, la pile dans le tiers gauche : vers la gauche seulement', function () {
      assert.deepEqual(sens({ top: '16px', left: '16px' }, 16, 416), ['-60px', '0px'])
    })

    it('un seul côté posé, la pile dans le tiers droit : vers la droite seulement', function () {
      assert.deepEqual(sens({ top: '16px', right: '16px' }, 608, 1008), ['0px', '60px'])
    })

    it('le tiers central de la fenêtre (1024 px) : du tiers au deuxième tiers, les deux sens ; au-delà, le bord le plus proche', function () {
      for (const [milieu, attendu] of [[335, ['-60px', '0px']], [350, ['-60px', '60px']], [675, ['-60px', '60px']], [690, ['0px', '60px']]] as const) {
        assert.deepEqual(sens({ top: '16px', left: '0px' }, milieu - 200, milieu + 200), attendu, `milieu de la pile en ${milieu} px`)
      }
    })

    it('posée des deux côtés, même contre un bord : les deux sens (la pile est étirée ou centrée par l\'application)', function () {
      assert.deepEqual(sens({ top: '16px', left: '16px', right: '16px' }, 16, 416), ['-60px', '60px'])
    })

    it('un préréglage garde le côté de son nom, quelle que soit la place mesurée', function () {
      assert.deepEqual(sens('top-right', 16, 416), ['0px', '60px'])
      assert.deepEqual(sens('top-left', 608, 1008), ['-60px', '0px'])
    })
  })

  describe('même chemin que la croix', function () {
    it('la file de notifyMax avance quand le toast tiré sort', function () {
      const { window, document, µ, h } = (() => { const m = loadModal(); return { ...m, h: horloge(m.window) } })()
      µ.config.notifyMax = 1
      µ.modal.notify('premier', { duration: 0 })
      µ.modal.notify('second', { duration: 0 })
      const [premier] = toasts(document)
      poser(premier)
      assert.equal(toasts(document).length, 1, 'le second attend')
      geste(window, premier, 500, trajet(500, 620, 100))
      assert.ok(toasts(document)[0] === premier, 'tant que le premier glisse, la place est prise')
      h.avancer(300)
      const reste = toasts(document)
      assert.equal(reste.length, 1)
      assert.equal(reste[0].querySelector('.mjs-toast-message').textContent, 'second', 'la file a avancé')
    })

    it('close() rendu par notify() reste valable pendant le glisser et la sortie', function () {
      const m = loadModal()
      const h = horloge(m.window)
      const poignee = m.µ.modal.notify('x', { duration: 4000 })
      const t = toasts(m.document)[0]
      poser(t)
      ev(m.window, t, 'pointerdown', 500, 0)
      ev(m.window, t, 'pointermove', 540, 10)
      poignee.close()
      assert.equal(toasts(m.document).length, 0)
      assert.equal(h.nombre(), 0, 'aucun minuteur ne traîne')
      assert.doesNotThrow(() => { ev(m.window, t, 'pointermove', 600, 20); ev(m.window, t, 'pointerup', 600, 30) })
      h.avancer(500)
      assert.equal(toasts(m.document).length, 0)
    })

    it('la croix continue de fermer, sans glisser', function () {
      const { window, document, t } = un()
      const croix = t.querySelector('.mjs-toast-close')
      ev(window, croix, 'pointerdown', 500, 0)
      ev(window, croix, 'pointerup', 500, 10)
      croix.click()
      assert.equal(toasts(document).length, 0)
    })
  })

  describe('prefers-reduced-motion: reduce', function () {
    const reduit = (window: any) => { window.matchMedia = (q: string) => ({ matches: /prefers-reduced-motion:\s*reduce/.test(q), media: q }) }

    it('le toast suit encore le pointeur', function () {
      const { window, t } = un()
      reduit(window)
      ev(window, t, 'pointerdown', 500, 0)
      ev(window, t, 'pointermove', 560, 10)
      assert.equal(dx(t), '60px')
      assert.equal(a(t, TIRE), true)
    })

    it('au-delà du seuil il se ferme sans mouvement : aucune sortie animée, aucun délai', function () {
      const { window, document, h, t } = un()
      reduit(window)
      geste(window, t, 500, trajet(500, 620, 100))
      assert.equal(toasts(document).length, 0, 'fermé tout de suite')
      assert.equal(a(t, GLISSE), false)
      assert.equal(h.nombre(), 0)
    })

    it('en deçà il revient d\'un coup : plus de décalage, plus de marque, aucun délai', function () {
      const { window, document, h, t } = un()
      reduit(window)
      geste(window, t, 500, trajet(500, 540, 1000))
      assert.equal(a(t, GLISSE) || a(t, TIRE), false)
      assert.equal(t.hasAttribute('style'), false)
      assert.equal(toasts(document).length, 1)
      assert.deepEqual(h.restants().filter((r) => r < 1000), [], 'rien à attendre pour le retour')
    })

    it('sans la préférence, la sortie est animée', function () {
      const { window, t } = un()
      window.matchMedia = (q: string) => ({ matches: false, media: q })
      geste(window, t, 500, trajet(500, 620, 100))
      assert.equal(a(t, GLISSE), true)
    })
  })

  describe('le clic après le glisser', function () {
    // clic au pointeur à l'instant t de l'horloge des événements, comme celui que le navigateur envoie juste après le lâcher
    const clic = (window: any, cible: any, t: number): any => {
      const e = new window.PointerEvent('click', { bubbles: true, cancelable: true, pointerType: 'mouse', clientX: 520, clientY: 20 })
      Object.defineProperty(e, 'timeStamp', { value: t })
      cible.dispatchEvent(e)
      return e
    }
    // toast cliquable posé, avec l'action et le lien comptés
    const cliquable = (opts: any = {}) => {
      const m = loadModal()
      const h = horloge(m.window)
      const vu = { n: 0 }
      m.µ.modal.notify('x', Object.assign({ duration: 0, onClick: () => { vu.n++ } }, opts))
      const t = toasts(m.document)[0]
      poser(t)
      return { ...m, h, t, vu, couverture: t.querySelector('.mjs-toast-action') }
    }
    const tirer = (window: any, el: any, vers = 520) => {
      ev(window, el, 'pointerdown', 500, 0)
      ev(window, el, 'pointermove', vers, 10)
      ev(window, el, 'pointerup', vers, 20)
    }

    it('un vrai glisser avale le clic qui suit le lâcher : ni onClick ni lien', function () {
      const { window, document, vu, couverture } = cliquable({ href: '#/suite' })
      tirer(window, couverture)
      const e = clic(window, couverture, 22)
      assert.equal(vu.n, 0, 'onClick n\'est pas appelée')
      assert.equal(window.location.hash, '', 'le lien n\'est pas suivi')
      assert.equal(e.defaultPrevented, true)
      assert.equal(toasts(document).length, 1, 'le toast n\'est pas fermé par ce clic')
    })

    it('un bouton posé dans le toast avale le sien aussi, puisque le clic traverse le toast', function () {
      const { window, t } = cliquable()
      let n = 0
      const b = window.document.createElement('button')
      b.addEventListener('click', () => { n++ })
      t.appendChild(b)
      tirer(window, b)
      clic(window, b, 22)
      assert.equal(n, 0)
    })

    it('l\'avalement ne dure que le temps du lâcher : un clic franc, 50 ms plus tard, passe', function () {
      const { window, vu, couverture } = cliquable()
      tirer(window, couverture)
      clic(window, couverture, 20 + 50)
      assert.equal(vu.n, 1)
    })

    it('un seul clic est avalé : le suivant, même immédiat, passe', function () {
      const { window, vu, couverture } = cliquable()
      tirer(window, couverture)
      clic(window, couverture, 22)
      clic(window, couverture, 23)
      assert.equal(vu.n, 1)
    })

    it('un geste de moins de 8 px reste un clic : la couverture déclenche l\'action', function () {
      const { window, document, vu, couverture } = cliquable()
      tirer(window, couverture, 504)
      clic(window, couverture, 22)
      assert.equal(vu.n, 1)
      assert.equal(toasts(document).length, 0)
    })

    it('un clic sans glisser avant (clavier, .click()) n\'est jamais avalé', function () {
      const { document, vu, couverture } = cliquable()
      couverture.click()
      assert.equal(vu.n, 1)
      assert.equal(toasts(document).length, 0)
    })

    it('un bouton posé dans le toast par la page n\'est pas concerné par un simple clic', function () {
      const { window, t } = cliquable()
      let n = 0
      const b = window.document.createElement('button')
      b.addEventListener('click', () => { n++ })
      t.appendChild(b)
      ev(window, b, 'pointerdown', 500, 0)
      ev(window, b, 'pointerup', 500, 10)
      b.click()
      assert.equal(n, 1)
    })

    it('après le retour d\'un glisser abandonné, le toast reste cliquable', function () {
      const { window, h, vu, couverture } = cliquable()
      tirer(window, couverture, 540)
      h.avancer(300)
      clic(window, couverture, 400)
      assert.equal(vu.n, 1)
    })
  })

  describe('réglages : swipe (appel) et notifySwipe (global)', function () {
    it('par défaut le glisser est actif, et le défaut est déclaré dans µ.config', function () {
      const { µ } = loadModal()
      assert.equal(µ.config.notifySwipe, true)
    })

    it('swipe: false — rien n\'est posé : ni classe, ni écouteur de pointeur, aucun pointerdown retenu', function () {
      const { window, t } = un({ swipe: false })
      assert.equal(a(t, SWIPE), false)
      const e = ev(window, t, 'pointerdown', 500, 0)
      ev(window, t, 'pointermove', 600, 10)
      assert.equal(e.defaultPrevented, false)
      assert.equal(a(t, TIRE), false)
      assert.equal(dx(t), '')
    })

    it('µ.config.notifySwipe = false — désactive le glisser pour tous les toasts ; swipe: true par appel l\'emporte', function () {
      const m = loadModal()
      horloge(m.window)
      m.µ.config.notifySwipe = false
      m.µ.modal.notify('global', { duration: 0 })
      m.µ.modal.notify('appel', { duration: 0, swipe: true })
      const [g, p] = toasts(m.document)
      poser(g)
      poser(p)
      assert.equal(a(g, SWIPE), false)
      assert.equal(a(p, SWIPE), true)
      ev(m.window, g, 'pointerdown', 500, 0)
      ev(m.window, g, 'pointermove', 560, 10)
      assert.equal(a(g, TIRE), false)
      ev(m.window, p, 'pointerdown', 500, 0)
      ev(m.window, p, 'pointermove', 560, 10)
      assert.equal(a(p, TIRE), true)
    })

    it('swipe: false par appel l\'emporte sur notifySwipe = true', function () {
      const { t } = un({ swipe: false }, { notifySwipe: true })
      assert.equal(a(t, SWIPE), false)
    })

    for (const [nom, valeur] of [['chaîne', 'non'], ['nombre 0', 0], ['nombre 1', 1], ['null', null], ['objet', {}], ['undefined', undefined]] as const) {
      it(`swipe non booléen (${nom}) : vaut l'absence d'option, le réglage global décide`, function () {
        for (const global of [true, false]) {
          const { t } = un({ swipe: valeur as any }, { notifySwipe: global })
          assert.equal(a(t, SWIPE), global, `notifySwipe = ${global}`)
        }
      })

      it(`notifySwipe non booléen (${nom}) : vaut le défaut, le glisser reste actif`, function () {
        const { t } = un({}, { notifySwipe: valeur })
        assert.equal(a(t, SWIPE), true)
      })
    }

    it('swipe et pause sont indépendants', function () {
      const { window, t } = un({ swipe: false })
      t.dispatchEvent(new window.PointerEvent('pointerenter', { pointerType: 'mouse' }))
      assert.equal(a(t, PAUSE), true, 'la pause reste active sans glisser')
      const autre = un({ pause: false })
      assert.equal(a(autre.t, SWIPE), true)
      autre.t.dispatchEvent(new autre.window.PointerEvent('pointerenter', { pointerType: 'mouse' }))
      assert.equal(a(autre.t, PAUSE), false, 'le glisser reste actif sans pause')
    })
  })

  describe('aucune fuite', function () {
    it('tous les écouteurs posés sur le toast sont retirés à sa fermeture, glisser en cours ou clic avalé compris', function () {
      const m = loadModal()
      horloge(m.window)
      let proto = Object.getPrototypeOf(m.document.createElement('div'))
      while (!Object.prototype.hasOwnProperty.call(proto, 'addEventListener')) proto = Object.getPrototypeOf(proto)
      const ajout = proto.addEventListener
      const retrait = proto.removeEventListener
      const actifs: Array<{ cible: any; type: string; fn: any; capture: boolean }> = []
      const capture = (o: any) => o === true || (!!o && typeof o === 'object' && !!o.capture)
      proto.addEventListener = function (type: string, fn: any, o: any) {
        if (!actifs.some((x) => x.cible === this && x.type === type && x.fn === fn && x.capture === capture(o))) actifs.push({ cible: this, type, fn, capture: capture(o) })
        return ajout.call(this, type, fn, o)
      }
      proto.removeEventListener = function (type: string, fn: any, o: any) {
        const i = actifs.findIndex((x) => x.cible === this && x.type === type && x.fn === fn && x.capture === capture(o))
        if (i !== -1) actifs.splice(i, 1)
        return retrait.call(this, type, fn, o)
      }
      try {
        const poignee = m.µ.modal.notify('x', { duration: 4000 })
        const t = toasts(m.document)[0]
        poser(t)
        const sur = () => actifs.filter((x) => x.cible === t).map((x) => x.type).sort()
        assert.ok(['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].every((type) => sur().includes(type)), `écouteurs du glisser sur le toast (trouvé : ${JSON.stringify(sur())})`)
        ev(m.window, t, 'pointerdown', 500, 0)
        ev(m.window, t, 'pointermove', 540, 10)
        ev(m.window, t, 'pointerup', 540, 20)
        assert.ok(sur().includes('click'), 'l\'avalement du clic est en place')
        poignee.close()
        assert.deepEqual(sur(), [], 'plus rien sur le toast fermé')
      } finally {
        proto.addEventListener = ajout
        proto.removeEventListener = retrait
      }
    })

    it('swipe: false et pause: false : aucun écouteur sur le toast', function () {
      const m = loadModal()
      horloge(m.window)
      let proto = Object.getPrototypeOf(m.document.createElement('div'))
      while (!Object.prototype.hasOwnProperty.call(proto, 'addEventListener')) proto = Object.getPrototypeOf(proto)
      const ajout = proto.addEventListener
      const types: string[] = []
      proto.addEventListener = function (type: string, fn: any, o: any) {
        if (this.classList && this.classList.contains('mjs-toast')) types.push(type)
        return ajout.call(this, type, fn, o)
      }
      try {
        m.µ.modal.notify('x', { duration: 4000, swipe: false, pause: false })
        assert.deepEqual(types, [])
      } finally {
        proto.addEventListener = ajout
      }
    })
  })

  describe('feuille de style', function () {
    const m = MODAL_SRC.match(/µ\._mjs_modalSheet\.replaceSync\(`([\s\S]*?)`\);/)
    const css = m ? m[1] : ''

    it('touch-action: pan-y sur le toast qui glisse : le geste horizontal ne fait pas défiler la page', function () {
      assert.ok(m, 'texte de la feuille repérable')
      assert.match(css, /:where\(\.mjs-toast-swipe\)\{[^}]*touch-action:pan-y/)
    })

    it('pendant qu\'on tire : le décalage passe par la propriété translate et la variable --mjs-toast-dx, sans sélection de texte', function () {
      assert.match(css, /:where\(\.mjs-toast-dragging\)\{[^}]*translate:var\(--mjs-toast-dx, 0\) 0/)
      assert.match(css, /:where\(\.mjs-toast-dragging\)\{[^}]*user-select:none/)
      assert.match(css, /:where\(\.mjs-toast-dragging\)\{[^}]*-webkit-user-select:none/)
    })

    it('la sortie et le retour glissent en 200 ms sur translate', function () {
      assert.match(css, /:where\(\.mjs-toast-sliding\)\{[^}]*translate:var\(--mjs-toast-dx, 0\) 0/)
      assert.match(css, /:where\(\.mjs-toast-sliding\)\{[^}]*transition:translate \.2s/)
    })

    it('l\'animation d\'entrée reste sur transform : le glisser (translate) s\'y superpose sans la défaire', function () {
      assert.match(css, /@keyframes mjs-toast-entree\{0%\{transform:/)
      assert.doesNotMatch(css, /:where\(\.mjs-toast-(dragging|sliding)\)\{[^}]*transform:/)
    })
  })
})
