// fade, fly, scale, blur, rotate et slide ont été refaites sur une enveloppe commune (animations/shared/from.ts) : elles rendent la même
// chose qu'avant. Le témoin est l'ancien code, figé dans tests/snapshots/transitions-temoins.ts ; chaque réglage (ses bornes, ses
// unités), leurs combinaisons tirées au sort, les courbes, les durées et délais, la balise nue ou avec un transform, un filter,
// une opacité d'auteur, l'entrée et la sortie (t et 1 - t) : la configuration rendue (délai, durée, courbe, pas) et chaque
// image de css(t, u) sont comparées, d'abord avec les options écrites à la main, puis avec celles que donne le pont des effets
// pour des réglages d'effet (directions, distances, unités, courbes) ; l'écart toléré est écrit, grandeur par grandeur :
//   identique   la même chaîne, au caractère près — l'exigence de toutes les grandeurs qui ne sont pas listées ci-dessous
//   chiffres    la même chaîne au dernier chiffre près (fade et blur : l'opacité était t × o ou (o - d) × t + d, elle est
//               maintenant o - d × u, comme dans fly ; l'écart est de quelques unités du dernier chiffre d'un nombre
//               double, sous ce que le navigateur retient)
// les clés d'une image sont comparées dans leur ordre ; slide lit l'opacité de la balise comme les cinq
// autres (1 quand elle est illisible, ce que seul un style factice rend), là où elle valait 0 : la balise « illisible » ne lui est donc pas posée

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { temoins } from './snapshots/transitions-temoins.js'
import { chargerAnimation } from './helpers/charger-animation.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RUNTIME   = join(__dirname, '..', 'src', 'runtime')
const lire      = (f: string) => readFileSync(join(RUNTIME, f), 'utf-8')

const NOMS = ['fade', 'fly', 'scale', 'blur', 'rotate', 'slide']

// ce que chaque grandeur peut avoir de différent, et rien de plus
const CHIFFRES = new Set(['fade.opacity', 'blur.opacity'])

const EPS = Number.EPSILON
const NOMBRE = /-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi

// un µ avec les vrais moteurs : les courbes, le pont des réglages d'effet, et les nouvelles transitions
function monter() {
  const µ: any  = { debug: false, warn() {}, anim: {}, _mjs_txt: (_k: string, _a: any, d: string) => d, _mjs_dom: {}, _mjs_fxDefs: {} }
  const fenetre = { getComputedStyle: (n: any) => n.cs, matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }) }
  for (const f of ['mjs_easing.ts', 'mjs_fx.ts', 'mjs_fx_transition.ts']) new Function('µ', 'window', lire(f))(µ, fenetre)
  for (const n of NOMS) chargerAnimation(n, µ)
  const anciens: Record<string, any> = {}
  for (const n of NOMS) anciens[n] = temoins[n](µ)
  return { µ, anciens, fenetre }
}

// le générateur au hasard à graine : les mêmes tirages à chaque passage
function graine(a: number) {
  return () => {
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const RIEN = Symbol('rien')

// les réglages d'une transition, chacun avec ses valeurs (bornes, unités, valeurs sans effet) ; RIEN : non écrit
const COMMUNS: Record<string, any[]> = {
  duration: [RIEN, undefined, 0, 1, 250, 400, '300', 1000],
  delay:    [RIEN, undefined, 0, 120, -5, '50'],
  easing:   [RIEN, undefined, null, '', 'linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'cubic-bezier(.1,.2,.3,1)', 'inconnue', (t: number) => t * t],
  steps:    [RIEN, undefined, 0, 1, 7, 60, '12']
}
const LONGUEURS = [RIEN, undefined, null, 0, 40, -40, 12.5, '40px', '-12.5px', '10%', '-7.07%', '2em', '1.5rem', '0px', '-0px', 'abc', '']
const OPACITES  = [RIEN, undefined, null, 0, 0.2, 0.5, 1, '0.3']
const ORIGINES  = [RIEN, undefined, null, '', '0% 0%', '50% 87%', 'top left', '100% 100%']
const REGLAGES: Record<string, Record<string, any[]>> = {
  fade:   { ...COMMUNS },
  fly:    { ...COMMUNS, x: LONGUEURS, y: LONGUEURS, opacity: OPACITES, blur: [RIEN, undefined, null, 0, 4, 0.3, 8, 25], skew: [RIEN, undefined, null, 0, 10, -20, 80, -80, 0.123, 'abc', NaN], rotate: [RIEN, undefined, null, 0, 30, -360, 1080, -1080, 0.005, 'abc', NaN] },
  scale:  { ...COMMUNS, start: [RIEN, undefined, null, 0, 0.5, 1, 20, 40, 0.123456, -0.5], opacity: OPACITES, origin: ORIGINES, axis: [RIEN, undefined, null, 'x', 'y', 'both', 'z'] },
  blur:   { ...COMMUNS, amount: [RIEN, undefined, null, 0, 5, 8, 0.5, 25, '4px', '1em', '2.5rem', '10%', 'abc', '-3'], opacity: OPACITES.filter(v => typeof v !== 'string') },
  rotate: { ...COMMUNS, angle: [RIEN, undefined, null, 0, -200, 90, -90, 360, 1080, 0.005, 'abc', NaN], start: [RIEN, undefined, null, 0, 0.5, 1, 2, 0.123456], opacity: OPACITES, origin: ORIGINES },
  slide:  { ...COMMUNS, axis: [RIEN, undefined, null, 'y', 'x', 'z'] }
}

// les réglages d'un effet, tels que l'écrit un auteur : ils passent par le pont avant d'arriver à la transition
const DIRECTIONS = ['up', 'down', 'left', 'right', 'up-left', 'up-right', 'down-left', 'down-right', 0, 45, 90, 135, 180, 225, 270, 315, 37.5]
const EFFETS: Record<string, Record<string, any[]>> = {
  fade:   { duration: [RIEN, '200ms', '1.2s', 900, 0], delay: [RIEN, '100ms', 40], easing: [RIEN, 'linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'cubic-bezier(0.2,0.8,0.2,1)', 'bounce-out', 'elastic-out', 'back-out', 'sine-in-out'] },
  fly:    { direction: DIRECTIONS, distance: [RIEN, 0, 10, 40, 120, 200.5, '10%', '5vw', '2em'], opacity: [RIEN, 0, 0.2, 1], blur: [RIEN, 0, 4, 8], skew: [RIEN, 0, 10, -20], rotate: [RIEN, 0, 30, -360], duration: [RIEN, '200ms', '1.2s', 900], delay: [RIEN, '100ms'], easing: [RIEN, 'linear', 'ease-out', 'bounce-out', 'back-out', 'cubic-bezier(0.2,0.8,0.2,1)'] },
  scale:  { start: [RIEN, 0, 0.3, 1, 20, 40], opacity: [RIEN, 0, 0.5, 1], origin: [RIEN, 'center', 'top-left', 'bottom-right', 'left', '30% 70%'], axis: [RIEN, 'x', 'y', 'both'], duration: [RIEN, '200ms', 900], easing: [RIEN, 'ease-in', 'elastic-out', 'back-out'] },
  rotate: { start: [RIEN, 0, 0.5, 1, 2], opacity: [RIEN, 0, 0.5, 1], angle: [RIEN, 0, -90, 270, 1080], origin: [RIEN, 'center', 'top-left', '30% 70%'], duration: [RIEN, '200ms', 900], easing: [RIEN, 'ease-in', 'back-out'] },
  blur:   { amount: [RIEN, 0, 3, 8, 25], opacity: [RIEN, 0, 0.5, 1], duration: [RIEN, '200ms', 900], easing: [RIEN, 'linear', 'bounce-out'] },
  slide:  { axis: [RIEN, 'x', 'y'], duration: [RIEN, '200ms', 900], easing: [RIEN, 'linear', 'ease-in-out', 'bounce-out'] }
}

// des configurations : chaque réglage seul avec chacune de ses valeurs, puis des combinaisons au hasard
function configurations(axes: Record<string, any[]>, combien: number, rnd: () => number) {
  const out: any[] = [{}]
  for (const [cle, valeurs] of Object.entries(axes)) for (const v of valeurs) if (v !== RIEN) out.push({ [cle]: v })
  for (let i = 0; i < combien; i++) {
    const c: any = {}
    for (const [cle, valeurs] of Object.entries(axes)) {
      const v = valeurs[Math.floor(rnd() * valeurs.length)]
      if (v !== RIEN) c[cle] = v
    }
    out.push(c)
  }
  return out
}

// la balise telle que la lit la transition : sa mise en page et son style calculé
const STYLES: Record<string, any> = {
  nue:       { opacity: '1', transform: 'none', filter: 'none' },
  opacite:   { opacity: '0.6', transform: 'none', filter: 'none' },
  transparente: { opacity: '0', transform: 'none', filter: 'none' },
  illisible: { opacity: '', transform: 'none', filter: 'none' },
  transform: { opacity: '1', transform: 'matrix(0.9, 0.1, -0.1, 0.9, 12, -8)', filter: 'none' },
  filtre:    { opacity: '1', transform: 'none', filter: 'grayscale(1) blur(2px)' },
  tout:      { opacity: '0.8', transform: 'matrix(1, 0, 0, 1, 5, 5)', filter: 'brightness(1.2)' }
}
const BOITES: Record<string, any> = {
  carree:  { height: '120px', width: '200px', paddingTop: '8px', paddingBottom: '12px', paddingLeft: '3px', paddingRight: '5px', marginTop: '4px', marginBottom: '6px', marginLeft: '7px', marginRight: '9px', borderTopWidth: '1px', borderBottomWidth: '2px', borderLeftWidth: '3px', borderRightWidth: '0px', offsetHeight: 139, offsetWidth: 218 },
  auto:    { height: 'auto', width: 'auto', paddingTop: '0px', paddingBottom: '0px', paddingLeft: '0px', paddingRight: '0px', marginTop: '0px', marginBottom: '0px', marginLeft: '0px', marginRight: '0px', borderTopWidth: '0px', borderBottomWidth: '0px', borderLeftWidth: '0px', borderRightWidth: '0px', offsetHeight: 57, offsetWidth: 91 },
  fine:    { height: '33.333px', width: '71.7px', paddingTop: '0.5px', paddingBottom: '1.25px', paddingLeft: '2.5px', paddingRight: '0.1px', marginTop: '1e-7px', marginBottom: '16px', marginLeft: '0px', marginRight: '-4px', borderTopWidth: '0.75px', borderBottomWidth: '0px', borderLeftWidth: '1px', borderRightWidth: '1.5px', offsetHeight: 34, offsetWidth: 72 }
}
function balises(nom: string) {
  const out: { id: string, noeud: any }[] = []
  for (const [s, style] of Object.entries(STYLES)) {
    if (nom !== 'slide') out.push({ id: s, noeud: { cs: style, offsetHeight: 50, offsetWidth: 80 } })
    else if (['nue', 'opacite'].includes(s)) {
      for (const [b, boite] of Object.entries(BOITES)) {
        const { offsetHeight, offsetWidth, ...mesures } = boite
        out.push({ id: s + '/' + b, noeud: { cs: { ...style, ...mesures }, offsetHeight, offsetWidth } })
      }
    }
  }
  return out
}

// les instants : toute la plage, hors plage (courbes qui dépassent), des valeurs sans écriture exacte, et leur sortie (1 - t)
const INSTANTS: number[] = (() => {
  const base = [-0.25, -0.05, 1.05, 1.3, 0.1, 0.2, 0.3, 0.7, 1 / 3, 2 / 3, 0.123456789, 0.987654321, 0.0001, 0.9999]
  for (let i = 0; i <= 60; i++) base.push(i / 60)
  return [...base, ...base.map(t => 1 - t)]
})()

function comparer(a: any, b: any) {
  if (a === b) return { identique: true, forme: true, absolu: 0, relatif: 0 }
  const sa = String(a)
  const sb = String(b)
  const na = sa.match(NOMBRE) ?? []
  const nb = sb.match(NOMBRE) ?? []
  const forme = sa.replace(NOMBRE, '#') === sb.replace(NOMBRE, '#') && na.length === nb.length
  let absolu = 0
  let relatif = 0
  if (forme) {
    na.forEach((x, i) => {
      const d = Math.abs(parseFloat(x) - parseFloat(nb[i]))
      absolu  = Math.max(absolu, d)
      relatif = Math.max(relatif, d / Math.max(1, Math.abs(parseFloat(x))))
    })
  }
  return { identique: false, forme, absolu, relatif }
}

const stats: Record<string, { identique: number, chiffres: number, chiffresFloat: number, maxRelatif: number }> = {}
let configs = 0
let images  = 0
let grandeurs = 0

function verifier(nom: string, vieux: any, neuf: any, contexte: () => string) {
  const ka = Object.keys(vieux)
  const kb = Object.keys(neuf)
  if (ka.join() !== kb.join()) throw new Error(`${nom} : les grandeurs diffèrent (${ka.join()} / ${kb.join()}) ${contexte()}`)
  for (const k of ka) {
    const cle = nom + '.' + k
    const s = stats[cle] ?? (stats[cle] = { identique: 0, chiffres: 0, chiffresFloat: 0, maxRelatif: 0 })
    const c = comparer(vieux[k], neuf[k])
    grandeurs++
    if (c.identique) {
      s.identique++
      continue
    }
    if (!CHIFFRES.has(cle) || !c.forme) throw new Error(`${cle} : ${JSON.stringify(vieux[k])} devenu ${JSON.stringify(neuf[k])} ${contexte()}`)
    if (c.relatif > 8 * EPS) throw new Error(`${cle} : écart de ${c.relatif} (au plus ${8 * EPS}) : ${JSON.stringify(vieux[k])} devenu ${JSON.stringify(neuf[k])} ${contexte()}`)
    s.chiffres++
    // un nombre CSS devient un flottant de 32 bits dans le navigateur : les deux valeurs y sont la même
    if (Math.fround(parseFloat(String(vieux[k]))) === Math.fround(parseFloat(String(neuf[k])))) s.chiffresFloat++
    s.maxRelatif = Math.max(s.maxRelatif, c.relatif)
  }
}

// une configuration rendue : mêmes champs, même courbe (le même objet), mêmes images
function confronter(nom: string, µ: any, ancien: any, nouveau: any, opts: any, balise: any, source: string) {
  const contexte = () => `[${source}] opts=${JSON.stringify(opts, (_k, v) => typeof v === 'function' ? 'ƒ' : v)} balise=${JSON.stringify(balise.cs)}`
  const vieux = ancien(opts)
  const neuf  = nouveau(opts)
  for (const sens of ['intro', 'outro'] as const) {
    const cv = vieux[sens](balise)
    const cn = neuf[sens](balise)
    assert.deepEqual(Object.keys(cn), Object.keys(cv), 'mêmes champs, dans le même ordre ' + contexte())
    for (const k of ['delay', 'duration', 'steps']) assert.equal(cn[k], cv[k], `${k} ${contexte()}`)
    // la même courbe : le même objet, ou (cubic-bezier fabrique une fonction neuve à chaque fois) les mêmes valeurs aux mêmes instants
    if (cn.easing !== cv.easing) for (let p = 0; p <= 60; p++) assert.ok(Object.is(cn.easing(p / 60), cv.easing(p / 60)), 'la même courbe ' + contexte())
    configs++
    for (const t of INSTANTS) {
      images++
      verifier(nom, cv.css(t, 1 - t), cn.css(t, 1 - t), () => contexte() + ` t=${t}`)
    }
  }
  assert.equal(vieux.intro, vieux.outro)
  assert.equal(neuf.intro, neuf.outro, 'une seule configuration pour l\'entrée et la sortie, comme avant')
  assert.equal(neuf.intro._isCfgFactory, true)
}

describe('fade, fly, scale, blur, rotate, slide : l\'enveloppe commune rend la même chose que l\'ancien code', function () {
  this.timeout(300000)
  let µ: any
  let anciens: Record<string, any>
  let avant: any

  before(() => {
    avant = (globalThis as any).window
    const m = monter()
    µ = m.µ
    anciens = m.anciens
    ;(globalThis as any).window = m.fenetre
  })

  after(() => {
    (globalThis as any).window = avant
    const lignes = Object.entries(stats).sort().map(([cle, s]) => `  ${cle.padEnd(22)} ${String(s.identique).padStart(8)} identiques · ${String(s.chiffres).padStart(6)} au dernier chiffre (${s.chiffresFloat} le même en flottant 32 bits)` + (s.maxRelatif ? ` · écart relatif max ${s.maxRelatif.toExponential(2)}` : ''))
    console.log(`\n  ${configs} configurations (réglages × balise × entrée et sortie), ${images} images css(t, u), ${grandeurs} grandeurs comparées\n` + lignes.join('\n'))
  })

  for (const nom of NOMS) {
    it(`${nom} : les réglages écrits à la main, seuls puis combinés`, () => {
      const rnd = graine(1000 + NOMS.indexOf(nom))
      const gamme = configurations(REGLAGES[nom], 260, rnd)
      for (const opts of gamme) for (const b of balises(nom)) confronter(nom, µ, anciens[nom], µ.anim[nom], opts, b.noeud, `main ${b.id}`)
    })

    it(`${nom} : les réglages d'un effet, par le pont (directions, distances, unités, courbes)`, () => {
      const rnd = graine(5000 + NOMS.indexOf(nom))
      const gamme = configurations(EFFETS[nom], 160, rnd)
      for (const reglages of gamme) {
        const opts = µ._mjs_fxAnimOpts(nom, reglages)
        for (const b of balises(nom).filter((_x, i) => i % 2 === 0)) confronter(nom, µ, anciens[nom], µ.anim[nom], opts, b.noeud, 'pont ' + b.id + ' ' + JSON.stringify(reglages))
      }
    })
  }

  it('blur : une opacité de départ écrite en chaîne était concaténée par l\'ancien code (« 0.1750.3 » au lieu d\'un nombre), elle est maintenant lue comme les autres', () => {
    const noeud = { cs: STYLES.nue, offsetHeight: 50, offsetWidth: 80 }
    const vieux = anciens.blur({ opacity: '0.3' }).intro(noeud).css(0.25, 0.75)
    const neuf  = µ.anim.blur({ opacity: '0.3' }).intro(noeud).css(0.25, 0.75)
    assert.equal(vieux.opacity, '0.1750.3')
    assert.equal(typeof neuf.opacity, 'number')
    assert.equal(neuf.opacity, µ.anim.blur({ opacity: 0.3 }).intro(noeud).css(0.25, 0.75).opacity)
    assert.ok(Math.abs(neuf.opacity - 0.475) < 1e-12)
  })

  it('sans options du tout, ou sans rien passer : les mêmes transitions que l\'ancien code', () => {
    const noeud = { cs: STYLES.nue, offsetHeight: 50, offsetWidth: 80 }
    for (const nom of NOMS) {
      const cn = µ.anim[nom]().intro(noeud)
      const cv = anciens[nom]().intro(noeud)
      assert.equal(cn.duration, cv.duration, nom)
      assert.equal(cn.easing, cv.easing, nom)
      assert.deepEqual(cn.css(0.5, 0.5), cv.css(0.5, 0.5), nom)
    }
  })
})
