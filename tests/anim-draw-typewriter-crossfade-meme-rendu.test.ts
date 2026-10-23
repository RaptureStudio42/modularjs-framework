// draw, typewriter et crossfade ont été réécrits : ils font la même chose qu'avant. Le témoin est l'ancien code figé
// (tests/snapshots/transitions-temoins.ts ; pour typewriter, celui qui relit le texte réécrit par sa liaison). Mêmes entrées dans les deux, avec
// le vrai moteur de courbes, et chaque sortie comparée au caractère près :
//   draw        configuration rendue (délai, durée, courbe, pas), images css(t, u), avertissements ; tracé de toute longueur (ou sans longueur),
//               bouts du trait, épaisseurs lisibles ou non, durée écrite, fonction de la longueur, vitesse
//   typewriter  l'erreur levée (ou non) pour chaque forme de balise, la configuration rendue (durée, relecture, délai, courbe), puis le texte
//               que laisse chaque tick(t) (dont t hors de [0, 1]) et ce que la balise retient (texte d'origine, dernier texte écrit), jusqu'au
//               texte réécrit par une liaison entre deux jeux
//   crossfade   tout ce que fait le couple Send / Receive : les boîtes lues et dans quel ordre, les 61 images clés passées à l'animation,
//               ses options, ce qui est annulé, ce que chaque promesse rend — pour un couple dans un sens et dans l'autre, un côté seul avec
//               ou sans repli, un repli qui lève, une animation annulée, des clés différentes, des réglages de crossfade() et de l'appel

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { temoins } from './snapshots/transitions-temoins.js'
import { chargerAnimation } from './helpers/charger-animation.js'

const lire = (f: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'runtime', f), 'utf-8')
const RIEN = Symbol('rien')
const INSTANTS = [-0.5, -0.1, 0, 0.05, 0.1, 0.25, 1 / 3, 0.5, 0.77, 0.99, 1, 1.2, 2]

// un µ avec le vrai moteur de courbes ; `journal` reçoit les avertissements et ce qu'on veut y lire
function monter(journal: any[]) {
  const µ: any = { debug: false, warn: (...a: any[]) => journal.push(['warn', ...a.map(String)]), anim: {}, _mjs_txt: (_k: string, _a: any, d: string) => d }
  new Function('µ', 'window', lire('mjs_easing.ts'))(µ, {})
  return µ
}

function combinaisons(axes: Record<string, any[]>) {
  const out: any[] = [{}]
  for (const [cle, valeurs] of Object.entries(axes)) for (const v of valeurs) if (v !== RIEN) out.push({ [cle]: v })
  // quelques croisements, pour que les réglages se gênent entre eux
  const cles = Object.keys(axes)
  for (let i = 0; i < 400; i++) {
    const c: any = {}
    cles.forEach((k, j) => { const v = axes[k][(i * (j + 3) + j * 7) % axes[k].length]; if (v !== RIEN) c[k] = v })
    out.push(c)
  }
  return out
}

const COMMUNS = {
  delay:  [RIEN, undefined, null, 0, 120, '50'],
  easing: [RIEN, undefined, null, '', 'linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'cubic-bezier(.1,.2,.3,1)', (t: number) => t * t],
  steps:  [RIEN, undefined, 0, 1, 7, 60, '12']
}

describe('draw : le tracé se dessine comme avant', function () {
  this.timeout(120000)
  const STYLES = [{ strokeLinecap: 'butt', strokeWidth: '2px' }, { strokeLinecap: 'round', strokeWidth: '4px' }, { strokeLinecap: 'square', strokeWidth: '3.5px' }, { strokeLinecap: 'round', strokeWidth: 'abc' }, { strokeLinecap: 'square', strokeWidth: '' }]
  const LONGUEURS = [0, 1, 99.99, 1234.5678, null, undefined, 'absent']
  const OPTIONS = { ...COMMUNS, duration: [RIEN, undefined, null, 0, 300, 1500, (l: number) => l * 2, (l: number) => Math.sqrt(l) * 10], speed: [RIEN, undefined, null, 0.5, 2, 0] }
  let avant: any

  before(() => { avant = (globalThis as any).window })
  after(() => { (globalThis as any).window = avant })

  it('configuration rendue, images et avertissements : identiques pour toutes les longueurs, tous les bouts, toutes les options', () => {
    let cas = 0
    for (const style of STYLES) {
      ;(globalThis as any).window = { getComputedStyle: () => style }
      for (const longueur of LONGUEURS) {
        for (const opts of combinaisons(OPTIONS)) {
          const jv: any[] = [], jn: any[] = []
          const µv = monter(jv), µn = monter(jn)
          chargerAnimation('draw', µn)
          const noeud = longueur === 'absent' ? {} : { getTotalLength: () => longueur }
          for (const sens of ['intro', 'outro'] as const) {
            const cv = temoins.draw(µv)(opts)[sens](noeud)
            const cn = µn.anim.draw(opts)[sens](noeud)
            assert.deepEqual(Object.keys(cn), Object.keys(cv))
            for (const k of ['delay', 'duration', 'steps']) assert.ok(Object.is(cn[k], cv[k]), `${k} : ${cv[k]} devenu ${cn[k]} ${JSON.stringify([style, longueur, opts])}`)
            if (cn.easing !== cv.easing) for (let p = 0; p <= 60; p++) assert.ok(Object.is(cn.easing(p / 60), cv.easing(p / 60)))
            for (const t of INSTANTS) assert.deepEqual(cn.css(t, 1 - t), cv.css(t, 1 - t), `t=${t} ${JSON.stringify([style, longueur])}`)
            cas++
          }
          assert.deepEqual(jn, jv, 'mêmes avertissements')
        }
      }
    }
    console.log(`\n  draw : ${cas} configurations rendues, ${cas * INSTANTS.length} images, identiques`)
  })
})

// une balise de test : des nœuds enfants, comme le DOM les rend
const texte = (contenu: string) => ({ nodeType: 3, textContent: contenu })
const balise = (...enfants: any[]) => ({ childNodes: enfants })
const FORMES: Record<string, () => any> = {
  'un texte':                     () => balise(texte('Bonjour')),
  'des blancs autour':            () => balise(texte('\n  '), texte('Bonjour le monde'), texte('\n')),
  'que des blancs':               () => balise(texte('   ')),
  'un texte vide':                () => balise(texte('')),
  'un commentaire et un texte':   () => balise({ nodeType: 8, textContent: 'x' }, texte('Salut')),
  'des accents':                  () => balise(texte('héllo wörld ✓ ça va')),
  'aucun enfant':                 () => balise(),
  'un sous-élément':              () => balise({ nodeType: 1 }),
  'un texte et un sous-élément':  () => balise(texte('a'), { nodeType: 1 }),
  'deux textes à contenu':        () => balise(texte('Bonjour '), texte('Marie'), texte('!')),
  'deux textes dont un blanc':    () => balise(texte('Bonjour'), texte('  '))
}

describe('typewriter : le texte s\'écrit et s\'efface comme avant', function () {
  this.timeout(120000)
  let avantNode: any

  before(() => { avantNode = (globalThis as any).Node; (globalThis as any).Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 } })
  after(() => { (globalThis as any).Node = avantNode })

  const jouer = (fabrique: (o: any) => any, opts: any, forme: () => any) => {
    const noeud = forme()
    const lu: any[] = []
    let cfg: any
    try { cfg = fabrique(opts).intro(noeud) } catch (e: any) { return { erreur: String(e.message) } }
    const texteReel = noeud.childNodes.filter((c: any) => c.nodeType === 3)
    const etat = () => ({ textes: texteReel.map((c: any) => c.textContent), cache: noeud._mjs_text_cache, dernier: noeud._mjs_text_last })
    lu.push(['cfg', Object.keys(cfg), cfg.duration, cfg.reread, cfg.delay, typeof cfg.easing === 'function' ? 'ƒ' : cfg.easing, etat()])
    for (const t of INSTANTS) lu.push([t, cfg.tick(t, 1 - t), etat()])
    return lu
  }

  it('l\'erreur levée, la configuration rendue et chaque tick : identiques, pour chaque forme de balise et chaque réglage', () => {
    const OPTIONS = { speed: [RIEN, undefined, null, 0, 10, 30, 100], duration: [RIEN, undefined, null, 0, 500, 2000], delay: [RIEN, null, 0, 150], easing: [RIEN, undefined, null, '', 'ease-in', 'linear', (t: number) => t] }
    let cas = 0
    for (const [nom, forme] of Object.entries(FORMES)) {
      for (const opts of combinaisons(OPTIONS)) {
        const µv = monter([]), µn = monter([])
        chargerAnimation('typewriter', µn)
        const vieux = jouer(temoins.typewriter(µv), opts, forme)
        const neuf  = jouer(µn.anim.typewriter, opts, forme)
        assert.deepEqual(neuf, vieux, `${nom} ${JSON.stringify(opts, (_k, v) => typeof v === 'function' ? 'ƒ' : v)}`)
        cas++
      }
    }
    console.log(`\n  typewriter : ${cas} balises jouées avec ${INSTANTS.length} instants chacune, identiques`)
  })

  it('le texte réécrit par une liaison entre deux jeux est relu ; le texte qui n\'a pas bougé reste celui d\'origine', () => {
    const scenarios: Array<(suivant: string) => any> = [
      // le tick a écrit, la liaison réécrit : le jeu suivant lit le texte courant
      (t) => ['ecrit', 0.5, t],
      // le tick a écrit, rien ne change : le jeu suivant garde le texte d'origine
      () => ['ecrit', 0.5, null],
      // rien n'a été écrit par le tick : le texte d'origine reste, même réécrit à la main
      (t) => ['sans-tick', null, t]
    ]
    for (const scenario of scenarios) {
      const transcrit = (fabrique: (o: any) => any) => {
        const noeud = FORMES['un texte']()
        const texteNoeud = noeud.childNodes[0]
        const sortie: any[] = []
        const paire = fabrique({ speed: 20 })
        const c1 = paire.intro(noeud)
        const [mode, t, neuf] = scenario('Autre texte, plus long')
        if (mode === 'ecrit') c1.tick(t, 1 - t)
        if (neuf != null) texteNoeud.textContent = neuf
        const c2 = paire.intro(noeud)
        sortie.push([c1.duration, c2.duration, noeud._mjs_text_cache, noeud._mjs_text_last, texteNoeud.textContent])
        c2.tick(1, 0)
        sortie.push([noeud._mjs_text_cache, noeud._mjs_text_last, texteNoeud.textContent])
        c2.tick(0, 1)
        sortie.push([noeud._mjs_text_cache, noeud._mjs_text_last, texteNoeud.textContent])
        return sortie
      }
      const µv = monter([]), µn = monter([])
      chargerAnimation('typewriter', µn)
      assert.deepEqual(transcrit(µn.anim.typewriter), transcrit(temoins.typewriter(µv)))
    }
  })
})

// un couple Send / Receive, rejoué avec des rectangles, des styles et des animations factices : tout ce qui est lu ou demandé est noté
function transcrire(fabrique: 'neuf' | 'vieux', scenario: any) {
  const journal: any[] = []
  const µ = monter(journal)
  const animations: any[] = []
  const files: Array<() => void> = []
  µ._mjs_animate = (noeud: any, images: any[], options: any) => {
    journal.push(['animate', noeud.id, JSON.stringify(images), JSON.stringify(options)])
    const a: any = { cancel: () => journal.push(['cancel', noeud.id]) }
    a.finished = new Promise((ok, ko) => { a.ok = ok; a.ko = ko })
    animations.push(a)
    return a
  }
  const g = globalThis as any
  const avant = { raf: g.requestAnimationFrame, window: g.window }
  g.requestAnimationFrame = (cb: () => void) => { files.push(cb); return files.length }
  const balises: Record<string, any> = {}
  const noeud = (id: string, rect: any, style: any) => balises[id] = {
    id, cs: style,
    getBoundingClientRect: () => { journal.push(['rect', id]); return rect }
  }
  g.window = { getComputedStyle: (n: any) => { journal.push(['style', n.id]); return n.cs } }
  try {
    const defaults = scenario.defaults()
    if (fabrique === 'neuf') chargerAnimation('crossfade', µ)
    ;(fabrique === 'neuf' ? µ.anim.crossfade : temoins.crossfade(µ))('x', defaults)
    const promesses: Promise<any>[] = []
    const resultats: any[] = []
    for (const [cote, cle, id, rect, style, params] of scenario.appels) {
      const n = balises[id] ?? noeud(id, rect, style)
      const paire = µ.anim[cote === 'send' ? 'xSend' : 'xReceive']({ key: cle, ...params })
      promesses.push(paire[cote === 'send' ? 'outro' : 'intro'](n).then((v: any) => resultats.push(['rendu', id, v === undefined ? 'rien' : 'valeur']), (e: any) => resultats.push(['rejet', id, String(e)])))
    }
    // deux images : les appariements ; puis les animations finissent (ou sont annulées)
    for (let tour = 0; tour < 3; tour++) for (const cb of files.splice(0)) cb()
    return Promise.resolve().then(async () => {
      for (const a of animations) scenario.fin === 'rejet' ? a.ko(new Error('annulée')) : a.ok(a)
      await Promise.all(promesses)
      journal.push(...resultats)
      return journal
    }).finally(() => { g.requestAnimationFrame = avant.raf; g.window = avant.window })
  } catch (e) {
    g.requestAnimationFrame = avant.raf
    g.window = avant.window
    throw e
  }
}

describe('crossfade : le couple Send / Receive fait comme avant', function () {
  this.timeout(120000)
  const style = { transform: 'none', opacity: '1' }
  const styleD = { transform: 'matrix(1, 0, 0, 1, 12, 8)', opacity: '0.7' }
  const A = (id: string) => [id, { left: 10, top: 20, width: 100, height: 50 }, style]
  const B = (id: string) => [id, { left: 300, top: 120, width: 200, height: 80 }, styleD]
  const Z = (id: string) => [id, { left: 5, top: 5, width: 0, height: 0 }, style]
  const DEFAUTS: Record<string, () => any> = {
    'sans réglage': () => ({}),
    'durée': () => ({ duration: 600 }),
    'durée en fonction de la distance': () => ({ duration: (d: number) => d * 2 }),
    'délai et courbe': () => ({ delay: 50, easing: 'linear' }),
    'courbe en fonction': () => ({ easing: (t: number) => t * t }),
    'repli en css': () => ({ fallback: () => ({ css: (t: number) => ({ opacity: t }), duration: 300, delay: 10, easing: 'ease-out' }) }),
    'repli sans css': () => ({ fallback: () => ({ duration: 300 }) }),
    'repli vide': () => ({ fallback: () => null }),
    'repli qui lève': () => ({ fallback: () => { throw new Error('repli') } }),
    'repli en css sans durée': () => ({ fallback: () => ({ css: (t: number) => ({ transform: `scale(${t})` }) }) })
  }
  const APPELS: Record<string, any[]> = {
    'sortie puis entrée':          [['send', 'k', ...A('a'), {}], ['recv', 'k', ...B('b'), {}]],
    'entrée puis sortie':          [['recv', 'k', ...B('b'), {}], ['send', 'k', ...A('a'), {}]],
    'réglages de l\'appel':        [['send', 'k', ...A('a'), { duration: 100, delay: 5, easing: 'ease-in' }], ['recv', 'k', ...B('b'), { duration: (d: number) => d, delay: 3 }]],
    'boîte d\'arrivée sans taille': [['send', 'k', ...A('a'), {}], ['recv', 'k', ...Z('z'), {}]],
    'la sortie seule':             [['send', 'k', ...A('a'), {}]],
    'l\'entrée seule':             [['recv', 'k', ...B('b'), {}]],
    'deux clés qui se manquent':   [['send', 'k1', ...A('a'), {}], ['recv', 'k2', ...B('b'), {}]],
    'deux sorties de même clé':    [['send', 'k', ...A('a'), {}], ['send', 'k', ...A('c'), {}], ['recv', 'k', ...B('b'), {}]],
    'deux couples':                [['send', 'k1', ...A('a'), {}], ['send', 'k2', ...A('c'), {}], ['recv', 'k2', ...B('b'), {}], ['recv', 'k1', ...B('d'), {}]]
  }

  it('boîtes lues (et dans quel ordre), images clés, options, annulations et résultats : identiques', async () => {
    let cas = 0
    for (const [dn, defaults] of Object.entries(DEFAUTS)) {
      for (const [an, appels] of Object.entries(APPELS)) {
        for (const fin of ['ok', 'rejet']) {
          const scenario = { defaults, appels, fin }
          const vieux = await transcrire('vieux', scenario)
          const neuf  = await transcrire('neuf', scenario)
          assert.deepEqual(neuf, vieux, `${dn} / ${an} / ${fin}`)
          assert.ok(vieux.some((l: any) => l[0] === 'rendu' || l[0] === 'rejet'), 'les promesses se sont résolues')
          cas++
        }
      }
    }
    console.log(`\n  crossfade : ${cas} scénarios rejoués (journal des boîtes, styles, animations, annulations et résultats), identiques`)
  })

  it('le journal contient bien les 61 images clés d\'un couple apparié, et un repli en css en échantillonne 61 aussi', async () => {
    const couple = await transcrire('neuf', { defaults: DEFAUTS['sans réglage'], appels: APPELS['sortie puis entrée'], fin: 'ok' })
    const animations = couple.filter((l: any) => l[0] === 'animate')
    assert.equal(animations.length, 2)
    for (const a of animations) assert.equal(JSON.parse(a[2]).length, 61)
    const repli = await transcrire('neuf', { defaults: DEFAUTS['repli en css'], appels: APPELS['la sortie seule'], fin: 'ok' })
    const echantillons = repli.filter((l: any) => l[0] === 'animate')
    assert.equal(echantillons.length, 1)
    assert.equal(JSON.parse(echantillons[0][2]).length, 61)
  })
})
