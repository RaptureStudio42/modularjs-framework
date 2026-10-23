// la garde de cadence du moteur des effets (le passage aux effets économes, mjs_fx.ts) : tant qu'un effet lourd est posé,
// elle juge la cadence des images — deux fenêtres de 60 images à plus de 28 ms (après 30 images de chauffe), c'est un appareil
// lent. Elle ne demande AUCUNE image au repos : une salve de 151 images à la pose du premier effet lourd (chauffe + deux fenêtres,
// de quoi rendre un verdict sans geste ni signal du navigateur), puis elle s'arme à un geste (pointeur, molette, défilement) ou à
// une image longue que le navigateur signale, mesure dix images, et se tait. Ce qu'elle décide ne change pas : mêmes seuils,
// même image où elle tranche. Les images d'animation sont menées à la main (l'horloge est celle du test, jamais celle de la
// machine) : aucune mesure ne dépend de sa vitesse.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'

const ICI  = dirname(fileURLToPath(import.meta.url))
const lire = (f: string) => readFileSync(join(ICI, '../src/runtime', f), 'utf-8')
const MOTEUR = lire('mjs_fx.ts')
const GARDE  = lire('mjs_fx_toolgauge.ts')

interface Monde {
  window: any
  µ: any
  demandes: () => number
  attendues: () => number
  image: (dt: number) => void
  geste: (type?: string) => void
  pas: (n: number, dt: number) => void
  lourd: () => () => void
  calme: () => void
  observateurs: any[]
  ecouteurs: Array<{ type: string, options: any }>
}

// le moteur seul dans une fenêtre happy-dom ; requestAnimationFrame est une file que le test vide image par image
function monde(opts: { conf?: any, sansGarde?: boolean, longues?: boolean, saveData?: boolean } = {}): Monde {
  const window: any = new Window({ url: 'http://localhost/' })
  const file: Array<{ id: number, f: (t: number) => void }> = []
  let demandes = 0
  let temps    = 0
  window.requestAnimationFrame = (f: (t: number) => void) => { file.push({ id: ++demandes, f }); return demandes }
  window.cancelAnimationFrame  = (id: number) => { const i = file.findIndex((x) => x.id === id); if (i >= 0) file.splice(i, 1) }
  // les écouteurs posés sur la fenêtre, avec leurs options
  const ecouteurs: Array<{ type: string, options: any }> = []
  const ajoute = window.addEventListener.bind(window)
  window.addEventListener = (type: string, f: any, options: any) => { ecouteurs.push({ type, options }); return ajoute(type, f, options) }
  // un navigateur qui signale les images longues : les observateurs posés, que le test appelle lui-même
  const observateurs: any[] = []
  if (opts.longues) {
    window.PerformanceObserver = class {
      static supportedEntryTypes = ['long-animation-frame']
      cb: any
      opts: any = null
      constructor(cb: any) { this.cb = cb; observateurs.push(this) }
      observe(o: any) { this.opts = o }
      disconnect() {}
    }
  }
  // l'économie de données demandée par l'utilisateur
  if (opts.saveData) Object.defineProperty(window.navigator, 'connection', { value: { saveData: true }, configurable: true })
  const µ: any = {
    _fxConf: opts.conf ?? {},
    warn: () => {},
    _mjs_msg: (_cle: string, vars: Record<string, string> | null, texte: string) => texte.replace(/\{(\w+)\}/g, (_m, n) => String(vars?.[n] ?? ''))
  }
  window.eval(`globalThis.__charge = function(µ) {\n${MOTEUR}\n${opts.sansGarde ? '' : GARDE}\n}`)
  window.__charge(µ)
  µ._mjs_fxDefs.lourd = { heavy: true, setup: () => () => {} }
  const lourd = () => {
    const cible = window.document.body.appendChild(window.document.createElement('div'))
    return µ._mjs_fx(null, cible, 'lourd', {})
  }
  // une image : l'horloge avance de `dt` ms, les rappels en attente sont servis
  const image = (dt: number) => {
    temps += dt
    for (const x of file.splice(0)) x.f(temps)
  }
  const geste = (type = 'pointermove') => { window.dispatchEvent(new window.Event(type)) }
  const pas   = (n: number, dt: number) => { for (let i = 0; i < n; i++) { geste(); image(dt) } }
  // la salve de la pose jouée sur un appareil qui suit : les 151 images à 16,7 ms (deux fenêtres fluides), puis le silence
  const calme = () => { for (let i = 0; i < 151; i++) image(16.7) }
  return { window, µ, demandes: () => demandes, attendues: () => file.length, image, geste, pas, lourd, calme, observateurs, ecouteurs }
}

describe('la garde de cadence — la salve de la pose, puis rien au repos', () => {
  it('un effet lourd posé : UNE salve de 151 images (chauffe + deux fenêtres), puis plus aucune image, quelle que soit la durée', () => {
    const m = monde()
    m.lourd()
    assert.equal(m.attendues(), 1, 'la pose demande la première image de la salve')
    for (let i = 0; i < 400; i++) m.image(16.7)
    assert.equal(m.demandes(), 151, 'la salve : 30 images de chauffe et deux fenêtres de 60, la première image ne compte pas')
    assert.equal(m.attendues(), 0, 'la salve est finie')
    assert.equal(m.µ._mjs_fxLite, false, 'un appareil qui suit n\'est pas économe')
    // trois secondes d\'horloge sans geste, deux fois : plus aucune image n\'est demandée par personne
    m.image(3000)
    m.image(3000)
    assert.equal(m.demandes(), 151)
    assert.equal(m.attendues(), 0)
  })

  it('un geste après la salve arme la mesure, qui se tait quand le geste cesse (quelques images de reste, pas une boucle)', () => {
    const m = monde()
    m.lourd()
    m.calme()
    assert.equal(m.attendues(), 0)
    const avant = m.demandes()
    m.geste()
    assert.equal(m.attendues(), 1, 'le geste demande une image')
    m.pas(40, 16.7)
    const pendant = m.demandes()
    assert.ok(pendant - avant >= 40, 'tant que le geste dure, chaque image en demande une autre')
    // plus de geste : le reste de la salve se joue puis plus rien
    for (let i = 0; i < 30; i++) m.image(16.7)
    assert.equal(m.attendues(), 0, 'la mesure est arrêtée')
    const fini = m.demandes()
    assert.ok(fini - pendant <= 15, 'un reste borné d\'images, pas une boucle : ' + (fini - pendant))
    m.image(5000)
    assert.equal(m.demandes(), fini, 'plus rien ensuite')
  })

  it('chaque famille de geste arme la mesure : pointeur, molette, défilement', () => {
    for (const type of ['pointermove', 'wheel', 'scroll']) {
      const m = monde()
      m.lourd()
      m.calme()
      assert.equal(m.attendues(), 0, type)
      m.geste(type)
      assert.equal(m.attendues(), 1, type)
    }
  })

  it('les écouteurs de geste sont sur la fenêtre, en capture (le défilement d\'un conteneur ne remonte pas) et passifs (ils ne bloquent jamais le défilement)', () => {
    const m = monde()
    m.lourd()
    const gestes = m.ecouteurs.filter((e) => ['pointermove', 'wheel', 'scroll'].includes(e.type))
    assert.deepEqual(gestes.map((e) => e.type).sort(), ['pointermove', 'scroll', 'wheel'])
    for (const e of gestes) {
      assert.equal(e.options.capture, true, e.type + ' : en capture')
      assert.equal(e.options.passive, true, e.type + ' : passif')
    }
  })

  it('le défilement d\'un conteneur de la page (l\'événement ne remonte pas jusqu\'à la fenêtre) arme la mesure', () => {
    const m = monde()
    m.lourd()
    m.calme()
    const conteneur = m.window.document.body.appendChild(m.window.document.createElement('div'))
    conteneur.dispatchEvent(new m.window.Event('scroll'))
    assert.equal(m.attendues(), 1)
  })

  it('effets économes coupés par le réglage (lite: off) : ni salve, ni écouteur, ni observateur', () => {
    const m = monde({ conf: { lite: 'off' }, longues: true })
    m.lourd()
    m.geste()
    assert.equal(m.demandes(), 0)
    assert.equal(m.observateurs.length, 0)
    assert.equal(m.ecouteurs.filter((e) => ['pointermove', 'wheel', 'scroll'].includes(e.type)).length, 0)
  })
})

describe('la garde de cadence — plusieurs effets lourds, une seule mesure', () => {
  it('trois effets lourds posés : une seule salve et un seul jeu d\'écouteurs ; un effet lourd posé plus tard ne relance rien', () => {
    const m = monde()
    m.lourd()
    m.lourd()
    m.lourd()
    assert.equal(m.attendues(), 1)
    m.geste()
    assert.equal(m.attendues(), 1)
    assert.equal(m.ecouteurs.filter((e) => ['pointermove', 'wheel', 'scroll'].includes(e.type)).length, 3)
    m.calme()
    m.lourd()
    assert.equal(m.attendues(), 0, 'la pose suivante ne lance pas de salve')
    m.geste()
    assert.equal(m.attendues(), 1)
    assert.equal(m.ecouteurs.filter((e) => ['pointermove', 'wheel', 'scroll'].includes(e.type)).length, 3)
  })
})

describe('la garde de cadence — module à part, pour les seuls effets lourds', () => {
  it('sans le module (aucun effet lourd dans la page) : un effet lourd posé plus tard ne casse rien et rien ne mesure', () => {
    const m = monde({ sansGarde: true })
    assert.equal(m.µ._mjs_fxGauge, undefined)
    const off = m.lourd()
    m.geste()
    assert.equal(m.demandes(), 0)
    assert.doesNotThrow(() => off())
  })

  it('le moteur ne porte plus la mesure : ni écouteur, ni observateur, ni boucle dans mjs_fx.ts', () => {
    assert.doesNotMatch(MOTEUR, /requestAnimationFrame\(tick\)|pointermove/)
  })
})

describe('la garde de cadence — les images longues du navigateur', () => {
  it('un navigateur qui signale les images longues : un seul observateur, posé sur ce type, quel que soit le nombre d\'effets lourds', () => {
    const m = monde({ longues: true })
    m.lourd()
    m.lourd()
    assert.equal(m.observateurs.length, 1)
    assert.equal(m.observateurs[0].opts.type, 'long-animation-frame')
  })

  it('une image longue arme la mesure sans aucun geste', () => {
    const m = monde({ longues: true })
    m.lourd()
    m.calme()
    assert.equal(m.attendues(), 0)
    m.observateurs[0].cb({ getEntries: () => [{}] })
    assert.equal(m.attendues(), 1)
  })

  it('un appareil qui devient lent APRÈS la salve de la pose et joue seul (aucun geste) : les images longues suffisent, 120 images lentes', () => {
    const m = monde({ longues: true })
    m.lourd()
    m.calme()
    let tranche = 0
    for (let i = 1; i <= 400 && !tranche; i++) {
      m.observateurs[0].cb({ getEntries: () => [{}] })
      m.image(60)
      if (m.µ._mjs_fxLite) tranche = i
    }
    assert.equal(tranche, 121, 'la première image de la reprise ne compte pas, puis deux fenêtres de 60')
  })

  it('un navigateur sans ce signal : aucune erreur, la salve de la pose juge sans geste et le geste suffit ensuite', () => {
    const m = monde()
    m.lourd()
    assert.equal(m.demandes(), 1)
    m.calme()
    m.geste()
    assert.equal(m.attendues(), 1)
  })
})

describe('la garde de cadence — un appareil lent qui joue seul est jugé dans tous les navigateurs', () => {
  it('un geste pendant la salve de la pose ne l\'abrège pas : elle va jusqu\'à ses 151 images', () => {
    const m = monde()
    m.lourd()
    for (let i = 0; i < 20; i++) m.image(40)
    m.geste()
    let tranche = 0
    for (let i = 21; i <= 400 && !tranche; i++) {
      m.image(40)
      if (m.µ._mjs_fxLite) tranche = i
    }
    assert.equal(tranche, 151)
  })

  it('40 ms par image, aucun geste, aucune image longue signalée (Firefox, Safari, ou 28 à 50 ms par image) : économe à la 151e image', () => {
    const m = monde()
    m.lourd()
    let tranche = 0
    for (let i = 1; i <= 400 && !tranche; i++) {
      m.image(40)
      if (m.µ._mjs_fxLite) tranche = i
    }
    assert.equal(tranche, 151)
    assert.ok(m.window.document.documentElement.hasAttribute('mjs-fx-lite'))
    assert.equal(m.attendues(), 0, 'le verdict rendu, la mesure se tait')
  })

  it('60 ms par image, aucun geste, un observateur d\'images longues : le même verdict, à la même image', () => {
    const m = monde({ longues: true })
    m.lourd()
    let tranche = 0
    for (let i = 1; i <= 400 && !tranche; i++) {
      m.observateurs[0].cb({ getEntries: () => [{}] })
      m.image(60)
      if (m.µ._mjs_fxLite) tranche = i
    }
    assert.equal(tranche, 151)
  })
})

describe('la garde de cadence — des pauses dans la salve de la pose', () => {
  // une pause (250 ms et plus entre deux images : point d'arrêt, ramasse-miettes, onglet repris) ne compte pas ET ne consomme pas la salve :
  // le verdict tombe aux 151 images qui comptent, pauses en plus. Au plus 150 pauses par salve : une page qui n'a que des pauses (moins de
  // quatre images par seconde) ne reste pas sous mesure sans fin, elle n'est pas jugée
  const jouer = (dt: (i: number) => number, n = 800) => {
    const m = monde()
    m.lourd()
    let tranche = 0
    for (let i = 1; i <= n && !tranche; i++) {
      m.image(dt(i))
      if (m.µ._mjs_fxLite) tranche = i
    }
    return { m, tranche }
  }

  it('40 ms par image et UNE image de 300 ms à la 20e, aucun geste : la salve va jusqu\'au verdict, à la 152e image (151 qui comptent et la pause)', () => {
    const { m, tranche } = jouer((i) => i === 20 ? 300 : 40)
    assert.equal(tranche, 152)
    assert.ok(m.window.document.documentElement.hasAttribute('mjs-fx-lite'))
    assert.equal(m.attendues(), 0, 'le verdict rendu, la salve s\'achève')
  })

  it('plusieurs pauses (une image sur sept, 250 ms pile ou plus d\'une seconde) : le verdict tombe toujours aux 151 images qui comptent', () => {
    const { tranche } = jouer((i) => i % 7 ? 40 : i % 2 ? 250 : 1200)
    assert.equal(tranche, 176, '151 images qui comptent et vingt-cinq pauses (la 7e, la 14e… la 175e)')
  })

  it('249 ms n\'est pas une pause : elle compte comme une image lente et consomme la salve', () => {
    const { tranche } = jouer((i) => i === 20 ? 249 : 40)
    assert.equal(tranche, 151)
  })

  it('un appareil rapide (16,7 ms) et dix pauses : 151 images qui comptent, jamais économe, puis plus aucune image', () => {
    const m = monde()
    m.lourd()
    for (let i = 1; i <= 400; i++) m.image(i % 15 === 0 ? 300 : 16.7)
    assert.equal(m.demandes(), 161, '151 images qui comptent et dix pauses, pas une de plus')
    assert.equal(m.attendues(), 0)
    assert.equal(m.µ._mjs_fxLite, false)
    m.image(3000)
    assert.equal(m.demandes(), 161)
  })

  it('une page faite uniquement de pauses (300 ms par image) : la salve s\'arrête à la 150e pause, la page n\'est pas jugée, plus aucune image ensuite', () => {
    const m = monde()
    m.lourd()
    for (let i = 0; i < 1000; i++) m.image(300)
    assert.equal(m.demandes(), 151, 'la première image, puis 150 pauses : la borne')
    assert.equal(m.attendues(), 0)
    assert.equal(m.µ._mjs_fxLite, false)
    m.image(60000)
    assert.equal(m.demandes(), 151, 'plus rien ensuite')
  })

  it('la borne : 149 pauses puis une page lente sont encore jugées (à la 300e image), 150 pauses ne le sont plus', () => {
    for (const [pauses, attendu] of [[149, 300], [150, 0]]) {
      const { tranche } = jouer((i) => i > 1 && i <= 1 + pauses ? 300 : 40)
      assert.equal(tranche, attendu, pauses + ' pauses')
    }
  })

  it('la borne se remet à zéro avec la salve : un geste relance la mesure, qui supporte de nouveau une pause', () => {
    const m = monde()
    m.lourd()
    for (let i = 0; i < 400; i++) m.image(300)
    assert.equal(m.attendues(), 0)
    m.geste()
    m.image(16.7)
    m.image(300)
    assert.equal(m.attendues(), 1, 'la première pause de la reprise ne l\'arrête pas')
  })
})

describe('la garde de cadence — seulement tant qu\'un effet lourd est posé', () => {
  it('l\'effet lourd retiré (un bloc refermé), la page lente et des gestes continus : la mesure s\'arrête, jamais économe', () => {
    const m = monde()
    const off = m.lourd()
    m.pas(20, 40)
    off()
    m.pas(400, 40)
    assert.equal(m.µ._mjs_fxLite, false)
    assert.ok(!m.window.document.documentElement.hasAttribute('mjs-fx-lite'))
    m.image(40)
    assert.equal(m.attendues(), 0, 'plus aucune mesure')
    m.geste()
    assert.equal(m.attendues(), 0, 'un geste n\'arme rien tant qu\'aucun effet lourd n\'est posé')
  })

  it('l\'effet lourd retiré en pleine salve de la pose : la salve s\'arrête à l\'image suivante', () => {
    const m = monde()
    const off = m.lourd()
    m.image(16.7)
    m.image(16.7)
    off()
    m.image(16.7)
    assert.equal(m.attendues(), 0)
    m.image(16.7)
    assert.equal(m.demandes(), 3)
  })

  it('l\'effet lourd retiré une image avant le verdict : cette image-là ne compte pas, la page n\'est pas jugée', () => {
    const m = monde()
    const off = m.lourd()
    for (let i = 1; i <= 150; i++) m.image(40)
    assert.equal(m.µ._mjs_fxLite, false, 'à la 150e image, rien n\'est encore tranché')
    off()
    m.image(40)
    assert.equal(m.µ._mjs_fxLite, false)
    assert.equal(m.attendues(), 0)
  })

  it('un autre effet lourd posé ensuite : les gestes mesurent de nouveau, et le verdict revient sur la page lente', () => {
    const m = monde()
    const off = m.lourd()
    off()
    m.pas(300, 40)
    assert.equal(m.µ._mjs_fxLite, false)
    m.lourd()
    m.pas(200, 40)
    assert.equal(m.µ._mjs_fxLite, true)
  })
})

describe('la garde de cadence — ce qu\'elle décide ne change pas', () => {
  it('un appareil lent (40 ms par image) sous un geste continu : économe à la 151e image, la 1re ne compte pas, 30 de chauffe, deux fenêtres de 60', () => {
    const m = monde()
    m.lourd()
    let tranche = 0
    for (let i = 1; i <= 400 && !tranche; i++) {
      m.pas(1, 40)
      if (m.µ._mjs_fxLite) tranche = i
    }
    assert.equal(tranche, 151)
    assert.ok(m.window.document.documentElement.hasAttribute('mjs-fx-lite'))
    for (let i = 0; i < 12; i++) m.image(40)
    assert.equal(m.attendues(), 0, 'la décision prise, la salve en cours s\'achève et la mesure se tait')
    m.geste()
    assert.equal(m.attendues(), 0, 'le verdict rendu, un geste ne mesure plus')
  })

  it('juste sous le seuil (28 ms par image) : jamais économe ; au-dessus (28,2 puis 28,5) : économe — le seuil est 28 ms, pas 28,33', () => {
    const net = monde()
    net.lourd()
    net.pas(400, 28)
    assert.equal(net.µ._mjs_fxLite, false)
    for (const dt of [28.2, 28.5]) {
      const lent = monde()
      lent.lourd()
      lent.pas(400, dt)
      assert.equal(lent.µ._mjs_fxLite, true, dt + ' ms par image')
    }
  })

  it('30 images de chauffe, pas 29 : la 30e (ici de 200 ms) n\'entre dans aucune fenêtre', () => {
    const m = monde()
    m.lourd()
    // la 1re image ne compte pas (aucune image avant elle), 29 images fluides, puis la 30e de chauffe, très lente
    m.image(16.7)
    for (let i = 0; i < 29; i++) m.image(16.7)
    m.image(200)
    // première fenêtre : 60 images à 26 ms, fluide (1 560 ms) ; si la 30e y entrait, 1 760 ms : lente
    for (let i = 0; i < 60; i++) m.image(26)
    // seconde fenêtre : lente
    for (let i = 0; i < 60; i++) m.image(40)
    assert.equal(m.µ._mjs_fxLite, false, 'une seule fenêtre lente sur deux')
  })

  it('une seule fenêtre lente ne suffit pas : il en faut deux d\'affilée', () => {
    const m = monde()
    m.lourd()
    m.pas(31, 16.7)
    m.pas(60, 40)
    m.pas(60, 16.7)
    m.pas(60, 40)
    m.pas(60, 16.7)
    assert.equal(m.µ._mjs_fxLite, false)
    m.pas(60, 40)
    m.pas(60, 40)
    assert.equal(m.µ._mjs_fxLite, true)
  })

  it('une pause (250 ms et plus entre deux images) ne compte pas', () => {
    const m = monde()
    m.lourd()
    m.pas(31, 16.7)
    for (let i = 0; i < 30; i++) {
      m.pas(1, 300)
      m.pas(1, 16.7)
    }
    m.pas(300, 16.7)
    assert.equal(m.µ._mjs_fxLite, false)
  })

  it('des pauses réparties sur plusieurs fenêtres de suite ne comptent dans aucune : un appareil qui suit reste fluide', () => {
    const m = monde()
    m.lourd()
    m.pas(31, 16.7)
    // 200 pauses de 300 ms entre autant d\'images à 16,7 ms : trois fenêtres de 60 images, chacune pleine de pauses
    for (let i = 0; i < 200; i++) {
      m.pas(1, 300)
      m.pas(1, 16.7)
    }
    assert.equal(m.µ._mjs_fxLite, false)
  })

  it('un appareil qui suit (16,7 ms) : vingt fenêtres fluides d\'affilée, le verdict est rendu et la mesure s\'arrête', () => {
    const m = monde()
    m.lourd()
    m.pas(1231, 16.7)
    for (let i = 0; i < 12; i++) m.image(16.7)
    assert.equal(m.µ._mjs_fxLite, false)
    assert.equal(m.attendues(), 0, 'la mesure est finie')
    const avant = m.demandes()
    m.geste()
    m.image(16.7)
    assert.equal(m.demandes(), avant, 'le verdict rendu, un geste ne mesure plus')
  })

  it('les fenêtres comptées se gardent d\'un geste à l\'autre : la mesure ne repart pas de zéro', () => {
    const m = monde()
    m.lourd()
    m.calme()
    // 150 images lentes réparties en gestes de 25 images, séparés de silences longs
    for (let g = 0; g < 7 && !m.µ._mjs_fxLite; g++) {
      m.pas(25, 40)
      for (let i = 0; i < 40; i++) m.image(40)
      assert.equal(m.attendues(), 0, 'le silence est un vrai silence')
    }
    assert.equal(m.µ._mjs_fxLite, true)
  })

  it('l\'intervalle d\'un silence n\'est pas une image : un appareil rapide qui fait des gestes courts de 10 images, séparés de 120 ms, n\'est jamais économe', () => {
    const m = monde()
    m.lourd()
    m.calme()
    for (let g = 0; g < 400; g++) {
      m.geste()
      for (let i = 0; i < 10; i++) m.image(16.7)
      assert.equal(m.attendues(), 0, 'le geste fini, la mesure se tait')
      m.image(120)
    }
    assert.equal(m.µ._mjs_fxLite, false)
  })

  it('une fenêtre lente remet la série fluide à zéro : dix-neuf fenêtres fluides, une lente, une fluide — la mesure s\'arme encore (la série repart de 1, elle n\'est pas à vingt)', () => {
    const m = monde()
    m.lourd()
    m.calme()
    // deux fenêtres fluides jouées par la salve ; la première image d'une reprise ne compte pas
    m.pas(1, 16.7)
    m.pas(17 * 60, 16.7)
    m.pas(60, 40)
    assert.equal(m.µ._mjs_fxLite, false, 'une seule fenêtre lente ne suffit pas')
    m.pas(60, 16.7)
    for (let i = 0; i < 12; i++) m.image(16.7)
    assert.equal(m.attendues(), 0)
    m.geste()
    assert.equal(m.attendues(), 1, 'la série fluide repart de 1 : un geste arme encore la mesure')
  })

  it('la mesure s\'arme jusqu\'à dix-neuf fenêtres fluides d\'affilée et se tait à la vingtième', () => {
    const m = monde()
    m.lourd()
    m.calme()
    m.pas(1, 16.7)
    m.pas(17 * 60, 16.7)
    for (let i = 0; i < 12; i++) m.image(16.7)
    assert.equal(m.attendues(), 0)
    m.geste()
    assert.equal(m.attendues(), 1, 'dix-neuf fenêtres fluides : un geste arme encore la mesure')
    m.pas(61, 16.7)
    for (let i = 0; i < 12; i++) m.image(16.7)
    assert.equal(m.attendues(), 0)
    m.geste()
    assert.equal(m.attendues(), 0, 'vingt fenêtres fluides : le verdict est rendu, un geste n\'arme plus rien')
  })

  it('un geste donne dix images de mesure au moins à partir de lui : un second geste, une image après le premier, les remet à dix', () => {
    const m = monde()
    m.lourd()
    m.calme()
    m.geste()
    m.image(16.7)
    m.geste()
    let restantes = 0
    while (m.attendues()) {
      m.image(16.7)
      restantes++
    }
    assert.equal(restantes, 10)
  })

  it('« économes » demandé par le réglage (lite: on) : décidé à la pose, sans mesure', () => {
    const m = monde({ conf: { lite: 'on' } })
    m.lourd()
    assert.equal(m.µ._mjs_fxLite, true)
    assert.equal(m.demandes(), 0)
  })

  it('l\'économie de données de l\'appareil (saveData) : économe à la pose, sans mesure — sauf si le réglage dit « jamais »', () => {
    const m = monde({ saveData: true })
    m.lourd()
    assert.equal(m.µ._mjs_fxLite, true)
    assert.equal(m.demandes(), 0)
    const non = monde({ saveData: true, conf: { lite: 'off' } })
    non.lourd()
    assert.equal(non.µ._mjs_fxLite, false)
    assert.equal(non.demandes(), 0)
  })
})
