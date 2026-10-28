// Les objets que le pont des transitions et l'enveloppe commune se passent sont sans prototype : les options qu'une transition
// reçoit de ses réglages (µ._mjs_fxAnimOpts), les options et la définition que lit l'enveloppe de fade, fly, scale, blur, rotate et
// slide (animations/shared/from.ts), la configuration qu'elle rend au moteur, et la table des valeurs par défaut d'un effet de
// l'appli (mjs_fx_custom.ts). Un nom que la page n'a pas écrit reste absent, jamais lu sur un prototype pollué : avant, un `tick`
// ajouté à Object.prototype était joué à la place de l'enveloppe, un `add` hérité appelé, un `steps` ou une durée hérités pris
// pour des réglages, et un effet de l'appli qui cite `$constructor` ou déclare un réglage `__proto__` écrivait
// « function Object() { [native code] } » ou « [object Object] » dans sa feuille
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chargerAnimation } from './helpers/charger-animation.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const lire      = (f: string) => readFileSync(join(__dirname, '..', 'src', 'runtime', f), 'utf-8')

const ENVELOPPE = ['fade', 'fly', 'scale', 'blur', 'rotate', 'slide']
const PONT      = ['fade', 'fly', 'scale', 'rotate', 'blur', 'slide', 'draw', 'iris', 'wheel', 'swipe', 'bars', 'volet', 'reveal', 'flip', 'cube', 'turn', 'blocks', 'typewriter', 'shatter', 'pixelate', 'ink']

function monter() {
  const µ: any  = { debug: false, warn() {}, anim: {}, _mjs_txt: (_k: string, _a: any, d: string) => d, _mjs_dom: {}, _mjs_fxDefs: {} }
  const fenetre = { getComputedStyle: (n: any) => n.cs, matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }) }
  for (const f of ['mjs_easing.ts', 'mjs_fx.ts', 'mjs_fx_transition.ts', 'mjs_fx_custom.ts']) new Function('µ', 'window', lire(f))(µ, fenetre)
  for (const n of ENVELOPPE) chargerAnimation(n, µ)
  return { µ, fenetre }
}

// Object.prototype pollué le temps d'un essai, rendu propre quoi qu'il arrive
const POLLUTION: Record<string, unknown> = { tick: () => 0.5, add: () => { throw new Error('add hérité appelé') }, steps: 3, duration: 9999, delay: 777, easing: 'cubic-bezier(9,9,9,9)', opacity: 0.42, axis: 'z' }
function pollue<T>(fn: () => T, noms: string[] = Object.keys(POLLUTION)): T {
  const avant = noms.filter((k) => Object.prototype.hasOwnProperty.call(Object.prototype, k))
  assert.deepEqual(avant, [], 'Object.prototype propre avant l\'essai')
  for (const k of noms) Object.defineProperty(Object.prototype, k, { value: POLLUTION[k], configurable: true, writable: true, enumerable: false })
  try { return fn() }
  finally { for (const k of noms) delete (Object.prototype as any)[k] }
}
// les noms que l'enveloppe lit elle-même ; une transition appelée directement (`µ.anim.fly({…})`) lit les siens (opacity, x, angle…)
// sur l'objet qu'on lui donne
const LUS_PAR_L_ENVELOPPE = ['tick', 'add', 'steps', 'duration', 'delay', 'easing']

const noeud = () => ({ cs: { opacity: '1', transform: 'none', filter: 'none' }, style: {} })

describe('transitions : options, enveloppe et configuration sans prototype', function () {
  // l'enveloppe lit le style de la balise par window.getComputedStyle
  let avant: unknown
  before(() => { avant = (globalThis as any).window; (globalThis as any).window = monter().fenetre })
  after(() => { (globalThis as any).window = avant })

  it('µ._mjs_fxAnimOpts : les options rendues pour chaque transition ne lisent rien sur un prototype pollué', () => {
    const { µ } = monter()
    const vus = pollue(() => PONT.map((nom) => {
      const o = µ._mjs_fxAnimOpts(nom, Object.create(null))
      return nom + ' : ' + ['tick', 'add', 'steps', 'duration', 'delay', 'easing', 'opacity', 'axis'].filter((k) => o[k] !== undefined && !Object.prototype.hasOwnProperty.call(o, k)).join(',')
    }))
    assert.deepEqual(vus, PONT.map((nom) => nom + ' : '))
  })

  it('µ._mjs_fxAnimOpts : les réglages écrits passent toujours', () => {
    const { µ } = monter()
    const o = µ._mjs_fxAnimOpts('scale', Object.assign(Object.create(null), { duration: 300, delay: 50, easing: 'ease-in', start: 0.5, axis: 'x' }))
    assert.deepEqual({ ...o }, { duration: 300, delay: 50, easing: 'ease-in', start: 0.5, axis: 'x' })
  })

  for (const nom of ENVELOPPE) {
    it(`${nom} (enveloppe commune) : sans réglage, la configuration rendue garde ses défauts et n'a ni tick ni add hérités`, () => {
      const { µ } = monter()
      const lue = (cfg: any) => ({ tick: cfg.tick, steps: cfg.steps, duration: cfg.duration, delay: cfg.delay, image: JSON.stringify(cfg.css(0.5, 0.5)) })
      // témoin : la même transition sans pollution
      const propre = lue(µ.anim[nom]().intro(noeud()))
      assert.deepEqual([propre.tick, propre.steps, propre.delay], [undefined, 60, 0])
      assert.deepEqual(pollue(() => lue(µ.anim[nom]().intro(noeud())), LUS_PAR_L_ENVELOPPE), propre, 'appelée sans options')
      const pont = () => lue(µ.anim[nom](µ._mjs_fxAnimOpts(nom, Object.create(null))).intro(noeud()))
      assert.deepEqual(pollue(pont), pont(), 'options du pont des effets')
    })
  }

  it('enveloppe commune : les réglages écrits passent toujours', () => {
    const { µ } = monter()
    const cfg = µ.anim.fade({ duration: 250, delay: 20, steps: 12 }).intro(noeud())
    assert.deepEqual([cfg.duration, cfg.delay, cfg.steps, cfg.css(0, 1).opacity], [250, 20, 12, 0])
  })
})

describe('effet de l\'appli : la table des valeurs par défaut est sans prototype', function () {
  const DEF = { params: [['color', '#0ff'], ['__proto__', 'red']], decls: [['box-shadow', '0 0 4px $constructor'], ['outline-color', '$__proto__'], ['color', '$color'], ['border-color', '$toString']], keyframes: [] }

  it('la feuille : un nom d\'Object cité sans être déclaré se replie sur rien, un réglage `__proto__` sur sa valeur', () => {
    const { µ } = monter()
    µ._mjs_fxCustom('halo', JSON.parse(JSON.stringify(DEF)))
    const css: string = µ._mjs_fxDefs.halo.css
    assert.ok(!/native code|\[object/.test(css), 'aucun membre d\'Object dans la feuille : ' + css)
    assert.ok(css.includes('box-shadow:0 0 4px var(--mjs-halo-constructor,)'), css)
    assert.ok(css.includes('outline-color:var(--mjs-halo-__proto__,red)'), css)
    assert.ok(css.includes('color:var(--mjs-halo-color,#0ff)'), css)
    assert.ok(css.includes('border-color:var(--mjs-halo-toString,)'), css)
  })

  it('sur le cycle de vie : l\'état caché ne prend aucun membre d\'Object pour une valeur par défaut', async () => {
    const { µ } = monter()
    const images: any[] = []
    µ._mjs_fxCalm    = () => false
    µ._mjs_fxMs      = (_v: unknown, d: number) => d
    µ._mjs_animate   = (_n: unknown, frames: any[]) => { images.push(...frames); return { finished: Promise.resolve() } }
    µ._mjs_fxCustom('halo', JSON.parse(JSON.stringify(DEF)))
    await µ._mjs_fxDefs.halo.life(Object.create(null)).intro({ animate() {} })
    assert.equal(images.length, 1)
    assert.deepEqual({ ...images[0] }, { boxShadow: '0 0 4px ', outlineColor: 'red', color: '#0ff', borderColor: '' })
  })
})
