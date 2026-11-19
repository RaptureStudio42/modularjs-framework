// Le contrôle « aucune route » attend qu'un composant routé dont le montage est en route ait monté : il peut rediriger dans
// son µmount. Tant que des textes traduits sont en route (premier rendu gelé par leur attente ; sous `*loader`, sans secours,
// le gel dure jusqu'à la fin du chargement), il ne demande plus d'image : un fragment qui ne répondait jamais faisait demander
// une image à chaque image, sans fin. La fin d'un chargement, le montage d'un composant qui attend ou une nouvelle demande le
// réveillent. Il ne juge donc jamais « aucune route » pendant qu'un texte est attendu, même longtemps (réseau lent, écran
// rapide) ; sans textes en route, il attend le montage d'image en image, comme avant, sans borne en images ni en temps. Les
// images arrivent ici à la cadence d'un écran, chacune avec son instant ; les chargements de textes sont imités
// (`µ.i18n._mjs_inFlight`), le montage joue le µmount puis la file des montages, comme `_mjs_fireMount`.

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Window } from 'happy-dom'
import { poserMessages } from './helpers/messages-stub.js'
import { poserPage } from './helpers/page-globale.js'
import { assertAbsent } from './helpers/dom-assert.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const routerSrc = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_router.ts'), 'utf-8')


describe('routeur — le contrôle « aucune route » attend sans demander d\'image tant que des textes sont en route', function () {
  let win: any
  let rendrePage: () => void
  let rafAvant: any
  let images: any[]
  before(() => {
    win        = new Window({ url: 'http://localhost/nulle-part' })
    rendrePage = poserPage({ window: win, document: win.document }, true)
    rafAvant   = (globalThis as any).requestAnimationFrame
  })
  after(() => {
    if (rafAvant !== undefined) (globalThis as any).requestAnimationFrame = rafAvant
    else delete (globalThis as any).requestAnimationFrame
    rendrePage()
  })
  beforeEach(() => {
    images = []
    ;(globalThis as any).requestAnimationFrame = (cb: any) => images.push(cb)
    win.history.replaceState(null, '', '/nulle-part')
  })

  // un routeur, une vue, un composant routé dont le montage attend ; `textes` : des textes en route (faux : pas de module des
  // traductions), jusqu'à `finir()` ; `monter(redirige)` : le montage, redirection vers `#/accueil` dans le µmount si demandé
  const scene = (textes = true) => {
    const errors: any[] = []
    const µ: any = { log() {}, warn() {}, error: (...a: any[]) => errors.push(a), config: {} }
    const charge = { enRoute: textes, fins: [] as Array<() => void> }
    if (textes) µ.i18n = { _mjs_inFlight: (fin: () => void) => charge.enRoute ? charge.fins.push(fin) : 0 }
    poserMessages(µ)
    new Function('µ', routerSrc)(µ)
    const view: any = win.document.createElement('metamjs-view')
    view.id = 'main'
    const comp: any = {
      tagName: 'MJS-APP',
      _shadow: { querySelector: (sel: string) => sel.includes('#main') ? view : null },
      querySelector: () => null,
      routes: { main: { '/accueil': 'mjs-accueil' } },
      _mjs_pendingMount: true,
      _mjs_mounted: false,
      isConnected: true,
    }
    µ.Router._mjs_awareComponents.add(comp)
    const finir = () => {
      charge.enRoute = false
      for (const f of charge.fins.splice(0)) f()
    }
    const monter = (redirige: boolean) => {
      const cbs = comp._mjs_mount_cbs
      comp._mjs_pendingMount = false
      comp._mjs_mounted      = true
      comp._mjs_mount_cbs    = null
      if (redirige) win.history.replaceState(null, '', '/nulle-part#/accueil')
      for (const f of cbs ?? []) f.call(comp)
    }
    return { µ, comp, errors, view, finir, monter }
  }

  // joue les images demandées à `hz` images par seconde, chacune avec son instant (la page a démarré 1 s plus tôt), jusqu'à
  // `max` ; `avant(i, ms)` voit l'image i et le temps écoulé depuis la première ; rend les images jouées et l'instant du jugement
  const jouer = (hz: number, errors: any[], max: number, avant?: (i: number, ms: number) => void, pause = 0) => {
    let n     = 0
    let juge  = -1
    while (images.length && n < max) {
      const ms = n * 1000 / hz + (n >= 10 ? pause : 0)
      avant?.(n, ms)
      images.shift()(1000 + ms)
      if (juge < 0 && errors.length) juge = ms
      n++
    }
    return { n, juge }
  }
  const dire = (errors: any[]) => errors.map((e) => String(e[0]).slice(0, 80)).join(' | ')

  it('textes en route qui ne viennent jamais (premier rendu gelé sous `*loader`) : plus aucune image demandée après la première, aucun jugement', function () {
    const { µ, errors } = scene()
    µ.Router._mjs_scheduleNoMatchCheck('/nulle-part')
    const { n } = jouer(60, errors, 100000)
    assert.equal(n, 1, `AVANT : une image demandée à chaque image, sans fin (${n} images jouées)`)
    assert.equal(images.length, 0, 'plus aucune image demandée')
    assert.equal(errors.length, 0, 'jugé pendant que des textes étaient attendus : ' + dire(errors))
  })

  it('les textes arrivent : le contrôle reprend, attend le montage d\'image en image, puis juge l\'adresse', function () {
    const { µ, errors, finir, monter } = scene()
    µ.Router._mjs_scheduleNoMatchCheck('/nulle-part')
    jouer(60, errors, 1)
    assert.equal(images.length, 0, 'AVANT : une image demandée pendant que les textes sont en route')
    finir()
    assert.equal(images.length, 1, 'une image demandée à la fin du chargement')
    const { n } = jouer(60, errors, 1000, (i) => { if (i === 2) monter(false) })
    assert.equal(n, 3, 'jugé à l\'image qui suit le montage')
    assert.equal(errors.length, 1)
    assert.match(String(errors[0][0]), /'\/nulle-part'/)
    assert.equal(images.length, 0, 'plus aucune image demandée')
  })

  it('réseau lent, écran à 240 Hz : les textes arrivent après 10 s, le composant monte et redirige — aucune « aucune route » à tort', function () {
    const { µ, errors, view, finir, monter } = scene()
    µ.Router._mjs_scheduleNoMatchCheck('/nulle-part')
    // 10 s d'images, s'il en demande : bien au-delà de 600 images et de l'attente des textes par défaut (3 s) plus 2 s
    jouer(240, errors, 2400)
    assert.equal(errors.length, 0, 'jugé à tort pendant que les textes étaient en route : ' + dire(errors))
    finir()
    monter(true)
    jouer(240, errors, 1000)
    assert.equal(errors.length, 0, 'jugé à tort : ' + dire(errors))
    assertAbsent(view.querySelector('[data-mjs-route-error]'), 'aucune boîte d\'erreur')
    assert.equal(images.length, 0, 'plus aucune image demandée')
  })

  // sous `wait`, le secours de l'attente des textes monte le composant à l'échéance de `i18n.timeout`, textes toujours en route
  for (const redirige of [false, true]) {
    it(`textes qui ne viennent jamais sous \`wait\` : le secours monte le composant${redirige ? ', qui redirige : aucune erreur' : ', sans redirection : l\'adresse est jugée à l\'image qui suit'}`, function () {
      const { µ, errors, view, monter } = scene()
      µ.Router._mjs_scheduleNoMatchCheck('/nulle-part')
      jouer(60, errors, 1)
      monter(redirige)
      assert.equal(images.length, 1, 'le montage réveille le contrôle')
      const { n } = jouer(60, errors, 1000)
      assert.equal(n, 1, 'contrôle fait à l\'image qui suit le montage')
      if (redirige) {
        assert.equal(errors.length, 0, 'jugé à tort : ' + dire(errors))
        assertAbsent(view.querySelector('[data-mjs-route-error]'), 'aucune boîte d\'erreur')
      }
      else {
        assert.equal(errors.length, 1)
        assert.match(String(errors[0][0]), /'\/nulle-part'/)
      }
      assert.equal(images.length, 0, 'plus aucune image demandée')
    })
  }

  it('nouvelle demande pendant l\'attente (le composant qui attendait a quitté la page) : le contrôle reprend et juge la nouvelle adresse', function () {
    const { µ, comp, errors } = scene()
    µ.Router._mjs_scheduleNoMatchCheck('/nulle-part')
    jouer(60, errors, 1)
    comp.isConnected = false
    win.history.replaceState(null, '', '/ailleurs')
    µ.Router._mjs_scheduleNoMatchCheck('/ailleurs')
    assert.equal(images.length, 1, 'la demande réveille le contrôle')
    jouer(60, errors, 1000)
    assert.equal(errors.length, 1)
    assert.match(String(errors[0][0]), /'\/ailleurs'/)
    assert.equal(images.length, 0, 'plus aucune image demandée')
  })

  // sans module des traductions (ou sans textes en route), le contrôle attend le montage d'image en image, sans borne
  for (const [cas, hz, echeance] of [['montage à 15 s, écran à 60 Hz', 60, 15000], ['montage à 3 s, écran à 240 Hz', 240, 3000]] as const) {
    it(`sans textes en route, ${cas} (après la 600e image) : redirection au montage — aucune « aucune route » à tort`, function () {
      const { µ, errors, view, monter } = scene(false)
      µ.Router._mjs_scheduleNoMatchCheck('/nulle-part')
      let monteA = -1
      const { n } = jouer(hz, errors, 10000, (i, ms) => {
        if (monteA < 0 && ms >= echeance) {
          monteA = i
          monter(true)
        }
      })
      assert.ok(monteA > 600, `montage à l'image ${monteA}, après la 600e`)
      assert.equal(errors.length, 0, 'jugé à tort avant le montage : ' + dire(errors))
      assertAbsent(view.querySelector('[data-mjs-route-error]'), 'aucune boîte d\'erreur')
      assert.equal(n, monteA + 1, 'contrôle fait à l\'image du montage')
      assert.equal(images.length, 0, 'plus aucune image demandée')
    })
  }

  it('sans textes en route, onglet en arrière-plan (aucune image pendant une minute) : le contrôle attend toujours le montage', function () {
    const { µ, errors, monter } = scene(false)
    µ.Router._mjs_scheduleNoMatchCheck('/nulle-part')
    let monteA = -1
    const { n } = jouer(60, errors, 5000, (i) => {
      if (i === 300) {
        monteA = i
        monter(true)
      }
    }, 60000)
    assert.equal(errors.length, 0, 'jugé à tort au retour au premier plan : ' + dire(errors))
    assert.equal(n, monteA + 1)
  })

  it('sans textes en route, montage à la 30e image : le contrôle l\'attend, puis juge à l\'image qui suit', function () {
    const { µ, errors, monter } = scene(false)
    µ.Router._mjs_scheduleNoMatchCheck('/nulle-part')
    let jugeAvant = false
    const { n } = jouer(60, errors, 5000, (i) => {
      if (i === 30) monter(false)
      if (i < 30 && errors.length) jugeAvant = true
    })
    assert.equal(jugeAvant, false, 'aucun jugement tant que le composant n\'a pas monté')
    assert.equal(errors.length, 1)
    assert.equal(n, 31)
  })
})
