// effects/catalog — les effets `*nom(réglages)` connus du compilateur : leurs réglages, la règle
// de chaque réglage (grammaire des types, plus des formes propres aux effets : une durée, une
// couleur, une liste de couleurs, une liste de mots) et le réglage principal, qu'on peut écrire
// sans son nom (`*neon(#0ff)`).
//
// Une valeur est fixe, ou une variable écrite telle quelle (`*neon($couleur)`). La compilation
// vérifie et convertit les valeurs fixes ; une variable est lue à la pose puis suivie, et sa règle
// part avec elle (runtime/mjs_fx.ts la ramène dans sa plage, ou l'écarte, à chaque changement).

import { AsyncLocalStorage } from 'node:async_hooks'
import { t, type MsgKey } from '../messages/index.js'
import { parseRule, ruleText, type RuleAst, type Lit } from '../transpiler/var-types.js'
import { levenshtein } from '../bundler/config.js'
import { isResolvableSrc } from '../transpiler/img-tag.js'
import { aliasExample, setDeclaredAliases, MJS_ALIASES } from './aliases-mjs.js'

export interface EffectSetting {
  rule: string
  /** la valeur prise quand le réglage n'est pas écrit (absente : l'effet décide) */
  dflt?: EffectValue
  /** le réglage, à `true`, dessine dans la balise (pseudo-élément) */
  inside?: boolean
  /** la valeur écrite de ce réglage qui rend l'effet indifférent au texte de la balise (`unit: child` anime les enfants, il ne
   * lit pas le texte) : la balise peut alors être un composant ou une balise sans texte */
  textless?: EffectValue
  /** une image dont l'effet ne lit que l'adresse, jamais les variantes de largeur : le build publie le fichier seul (cf. localImages) */
  plain?: boolean
  /** une image qui s'écrit aussi en texte libre (le logo de *offline : un texte, un émoji ; la seconde image de *pixels : un dégradé, `url(…)`), longue (une adresse `data:`) ou vide : ni la longueur ni le vide ne sont vérifiés */
  free?: boolean
  /** un effet donné par défaut (`fx: *shake`) qui part dans le cœur même s'il n'est pas écrit */
  pull?: boolean
  /** un texte qui va dans le CSS de l'effet (l'axe de *weight, dans `font-variation-settings`) : tenu par une variable, il suit la
   * règle d'une valeur CSS, pas celle d'un texte de la page */
  css?: boolean
}

export interface EffectSpec {
  /** le réglage qui peut s'écrire sans son nom */
  main: string
  /** les réglages qu'une valeur sans nom prend quand elle en a la forme, avant le principal : une image pour un réglage
   * d'image, un mot de sa liste pour un autre (`*gradient('photo.jpg')`, `*gradient(dots)` ; `*gradient([#f0f, #0ff])`
   * reste au principal) — une variable va toujours au principal */
  alt?: string[]
  settings: Record<string, EffectSetting>
  /** l'effet dessine dans la balise (calque ajouté, pseudo-éléments) */
  inside?: boolean
  /** l'effet travaille le texte propre de la balise (lettres, nombre, défilé) */
  text?: boolean
  /** l'effet se pose sur un champ (input, textarea, select) */
  field?: boolean
  /** famille, pour la doc et l'éditeur */
  family: string
  /** une transition (runtime/animations/<nom>.ts) : se joue à l'entrée ou à la sortie de la balise
   * (`@in=*fade`, `@out=*fade`, `@transition=*fade`), ou, posée directement, à l'arrivée à l'écran
   * (`on: view`), au défilement (`on: scroll`), dès l'apparition (`on: load`) */
  transition?: boolean
  /** sur le cycle de vie seulement (`@in`/`@out`/`@transition`), jamais posée directement */
  life?: boolean
  /** un effet CSS de l'appli (fichier *.effects.mjs) */
  custom?: boolean
  /** le réglage à écrire : sans lui, l'effet n'a rien à faire (la clé de *shared) */
  need?: string
}

/** un effet de l'appli, écrit dans un fichier `*.effects.mjs` : un effet de la bibliothèque réglé une
 * fois pour toutes (`base` et ses réglages fixes), ou un effet CSS à soi (ses réglages et leurs valeurs
 * par défaut, ses déclarations, ses images clés) — cf. effects/project.ts */
export interface ProjectEffect {
  base?: string
  fixed?: Record<string, EffectValue>
  params?: Array<[string, string]>
  decls?: Array<[string, string]>
  keyframes?: Array<[string, Array<[string, string]>]>
  /** un alias utilisé plusieurs fois dans l'appli : son rang dans la table du cœur (donné par le bundler) */
  table?: number
  file: string
  line: number
}

// les effets de l'appli de la compilation en cours : ceux de son flux quand elle en a un (withProjectEffects, que transpile()
// appelle : deux compilations lancées en même temps gardent chacune les siens), sinon ceux posés par setProjectEffects
const PROJECT_FLUX = new AsyncLocalStorage<Record<string, ProjectEffect>>()
let PROJECT_POSE: Record<string, ProjectEffect> = {}
const projet = (): Record<string, ProjectEffect> => PROJECT_FLUX.getStore() ?? PROJECT_POSE

// leurs alias : les messages en citent un en exemple
setDeclaredAliases(() => Object.keys(projet()))

/** les effets de l'appli, lus par les compilations qui suivent */
export function setProjectEffects(effects: Record<string, ProjectEffect> | undefined): void {
  PROJECT_POSE = effects ?? {}
}

/** `run` avec `effects` pour effets de l'appli, ceux d'avant rétablis ensuite — la résolution d'un
 * fichier d'effets lit ceux qu'elle vient de résoudre, jamais ceux d'une compilation précédente (un
 * processus neuf n'en a aucun, une session `mjs dev` ceux du tour d'avant). `run` asynchrone : ses
 * suites les gardent, quoi que fassent les compilations qui tournent en même temps */
export function withProjectEffects<T>(effects: Record<string, ProjectEffect>, run: () => T): T {
  return PROJECT_FLUX.run(effects, run)
}

/** un effet de l'appli, par son nom */
export function projectEffect(name: string): ProjectEffect | undefined {
  const p = projet()
  return Object.prototype.hasOwnProperty.call(p, name) ? p[name] : undefined
}

/** la règle du nom d'un alias d'effet (`*filter.frosted_glass`), à la déclaration comme à l'usage */
export const ALIAS_NAME = /^[a-z][a-z0-9_]*$/

/** les fautes d'un effet réglé (alias) se disent sous le nom écrit — `*filter.net : blur = …` —, pas sous celui de l'effet qu'il règle */
export function asWritten<T>(written: string, base: string, run: () => T): T {
  try {
    return run()
  }
  catch (err) {
    if (err instanceof Error) err.message = err.message.replace(new RegExp(`^(\\[ModularJS\\] \\*)${base}(?![\\w.-])`), (_, debut) => debut + written)
    throw err
  }
}

// la fiche d'un effet CSS de l'appli : ses réglages (une valeur CSS, leur défaut), et les réglages
// communs — on, duration, delay, easing
function customSpec(p: ProjectEffect): EffectSpec {
  const settings: Record<string, EffectSetting> = Object.create(null)
  for (const [k, v] of p.params ?? []) settings[k] = { rule: 'css', dflt: v }
  const anime = (p.keyframes ?? []).length > 0
  settings.on       = set(anime ? "'always' | 'hover' | 'view' | 'click' | 'load' | 'success' | 'error'" : "'always' | 'hover' | 'view' | 'click' | 'load'", 'always')
  settings.duration = time(anime ? '1s' : '400ms')
  settings.delay    = time('0s')
  settings.easing   = easing('ease')
  return { family: 'custom', custom: true, main: p.params?.[0]?.[0] ?? 'on', settings }
}

/** la fiche d'un effet : de la bibliothèque, ou de l'appli (un alias prend celle de son effet) */
export function effectSpec(name: string): EffectSpec | undefined {
  if (EFFECTS[name]) return EFFECTS[name]
  const p = projectEffect(name)
  if (!p) return undefined
  return p.base ? EFFECTS[p.base] : customSpec(p)
}

// réglages : une règle des types, ou des formes propres aux effets (une durée CSS `300ms`, `1.5s`,
// `0` ; une couleur CSS ; une liste de couleurs `[#f0f, #0ff]` ; une liste de mots `[Un, 'Deux.']` ;
// une direction, un mot ou un angle ; un point d'origine) ;
// `dflt` = la valeur que l'effet
// prend quand le réglage n'est pas écrit (sans elle : l'effet décide, ex. la couleur du texte) —
// l'éditeur de la doc part de là
const time   = (dflt?: string): EffectSetting => ({ rule: 'time', dflt })
const color  = (dflt?: string): EffectSetting => ({ rule: 'color', dflt })
const colors = (dflt?: string[]): EffectSetting => ({ rule: 'colors', dflt })
const words  = (): EffectSetting => ({ rule: 'words' })
const set    = (rule: string, dflt?: EffectValue): EffectSetting => ({ rule, dflt })
// le vocabulaire commun : QUAND l'effet agit…
//   - un effet qui boucle : always (tout le temps), hover (pendant le survol), view (tant que la
//     balise est à l'écran), click (un cycle par clic), load (un cycle à l'apparition), success et
//     error (un cycle à la fin réussie, ou ratée, de l'action de la balise : cf. µ._mjs_fxOnResult)
const loop   = (dflt = 'always'): EffectSetting => set("'always' | 'hover' | 'view' | 'click' | 'load' | 'success' | 'error'", dflt)
//   - un effet à état : hover (pendant le survol), view (dès que la balise est à l'écran), click
//     (chaque clic bascule), always (tout le temps)
const state  = (dflt = 'hover'): EffectSetting => set("'hover' | 'view' | 'click' | 'always'", dflt)
//   - un effet qui se joue : view (à l'entrée à l'écran), hover, click, load (dès l'apparition),
//     success, error (à la fin réussie, ou ratée, de l'action de la balise)
const play   = (dflt = 'view'): EffectSetting => set("'view' | 'hover' | 'click' | 'load' | 'success' | 'error'", dflt)
// … et l'ordre des lettres d'un effet de lettres : de gauche à droite, de droite à gauche, du
// centre vers les bords, des bords vers le centre, au hasard
const order  = (): EffectSetting => set("'right' | 'left' | 'center' | 'edges' | 'random'", 'right')
const easing = (dflt: string): EffectSetting => set("'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out'", dflt)
const angle  = (dflt: number): EffectSetting => set('int 0..360', dflt)
// … la direction d'un mouvement : un mot (right, left, up, down, les diagonales up-right…) ou un angle
// en degrés, 0 = vers le haut, 90 = vers la droite (comme un dégradé CSS)
const dir    = (dflt?: EffectValue): EffectSetting => ({ rule: 'direction', dflt })
// … quatre sens seulement (un remplissage, un défilé)
const dir4   = (dflt: string): EffectSetting => set("'right' | 'left' | 'up' | 'down'", dflt)
// … la connexion MJS WS d'un effet en direct : la variable qui la tient (`sock: $$sock`, un store ;
// `sock: @sock`), jamais une valeur écrite — non écrite, `@sock` du composant (cf. generator)
const sock   = (): EffectSetting => ({ rule: 'socket' })
// … le point d'où part l'effet : un mot (center, top-left…) ou `x% y%` ; `pointer` (le point sous la
// souris) pour un effet qui sait le suivre
const origin = (dflt: string, pointer = false): EffectSetting => ({ rule: pointer ? 'origin-pointer' : 'origin', dflt })

// … une courbe de transition : les mots CSS, `cubic-bezier(…)`, ou une courbe de µeasing (bounce-out,
// elastic-out…)
const curve  = (dflt?: string): EffectSetting => ({ rule: 'curve', dflt })
// … une longueur : un nombre (px) ou une valeur CSS (`40px`, `100%`, `2em`)
const len    = (dflt?: EffectValue): EffectSetting => ({ rule: 'length', dflt })
// … un effet, qui se joue une fois (`fx: *scramble(20)`, `fx: *fly(up)`) ou none : l'effet qui écrit un
// texte nouveau (cf. effectValue)
const fxOf   = (dflt: string, pull = false): EffectSetting => ({ rule: 'effect', dflt, pull })
// … la bande de l'écran où se joue un effet au défilement (`on: scroll`) : deux hauteurs de la zone
// visible, en % (0 % en haut, 100 % en bas) ou en mots (top, center, bottom) — l'effet part quand le
// haut de la balise passe la première, il est fini à la seconde ; sans elle, du bas de l'écran
// (le haut de la balise y entre) au milieu (son milieu y arrive)
const zone   = (): EffectSetting => ({ rule: 'zone' })
// … une image : son adresse, `µasset('…')`, ou `µimage('…')` (la variante la mieux taillée pour la
// balise est choisie à la pose, cf. µ._mjs_fxImage) ; le chemin d'un fichier local (`'photo.jpg'`, `photo.jpg`) est
// résolu au build comme `µimage('photo.jpg')` (cf. localImages). `plain` : l'effet ne lit que l'adresse, jamais les
// variantes de largeur — le fichier est publié seul, sans variante (`µasset('photo.jpg')`)
const img    = (plain = false, free = false): EffectSetting => ({ rule: 'image', ...plain && { plain }, ...free && { free } })
// … une liste d'images : leurs adresses, `µasset('…')` ou `µimage('…')`, écrites `[a.jpg, 'b.jpg']` ; un chemin
// local est résolu au build comme `µimage('…')` (cf. localImages). `plain` : comme pour une image seule
const imgs   = (plain = false): EffectSetting => plain ? { rule: 'images', plain } : { rule: 'images' }

// une transition : ses réglages propres, puis les communs — duration, delay, easing ; posée
// directement sur une balise : on (view : à l'arrivée à l'écran ; scroll : elle suit le défilement ;
// load : dès l'apparition ; hover : cachée au repos, elle entre quand la souris arrive sur son parent
// et sort quand elle le quitte), once (view : une seule fois ; non : elle repart et revient à chaque
// passage), range (scroll : deux positions de défilement de la page, « début fin »), zone (scroll :
// la bande de l'écran où elle se joue, cf. zone()), of (hover : un sélecteur — l'ancêtre le plus proche
// qui le vérifie tient lieu de parent)
function tr(main: string, own: Record<string, EffectSetting>, duration: string | undefined, ease: string, life = false): EffectSpec {
  const direct: Record<string, EffectSetting> = life ? {} : { on: set("'view' | 'scroll' | 'load' | 'success' | 'error' | 'hover'", 'view'), once: set('bool', true), range: { rule: 'range' }, zone: zone(), of: set('string 1..200') }
  return { family: 'transition', transition: true, life, main, settings: { ...own, duration: time(duration), delay: time('0s'), easing: curve(ease), ...direct } }
}

const DIR_WORDS    = ['right', 'left', 'up', 'down', 'up-right', 'up-left', 'down-right', 'down-left']
const CURVE_RE     = /^(?:linear|ease|ease-in|ease-out|ease-in-out|(?:back|bounce|circ|cubic|elastic|expo|quad|quart|quint|sine)-(?:in|out|in-out))$/
const BEZIER_RE    = /^cubic-bezier\(\s*-?[\d.]+\s*,\s*-?[\d.]+\s*,\s*-?[\d.]+\s*,\s*-?[\d.]+\s*\)$/
const LENGTH_RE    = /^-?\d*\.?\d+(?:px|%|em|rem|vw|vh)$/
const RANGE_RE     = /^-?\d*\.?\d+(?:px|vh)? -?\d*\.?\d+(?:px|vh)?$/
// la fenêtre d'une carte : une forme CSS de clip-path, écrite telle quelle (`inset(10% 8% 53% 8%)`, `polygon(…)`) ; le refus d'une autre valeur la donne en exemples
const CARD_ZONE_RE = /^(?:inset|polygon|circle|ellipse|path)\([^;{}]+\)$/
const CARD_ZONES   = 'inset(10% 8% 53% 8%), polygon(8% 16%, 92% 16%, 92% 47%), circle(30% at 50% 40%), ellipse(30% 20% at 50% 40%), path(\'M 10 10 H 90 V 60 Z\')'
// une fenêtre écrite en quatre nombres « haut droite bas gauche » (en %) n'est pas une forme CSS : le refus donne l'`inset(…)` qui la dit en CSS ; tout autre mot n'a pas d'équivalent, le refus donne les formes permises
const OLD_ZONE_RE  = /^-?\d+(?:\.\d+)?(?: -?\d+(?:\.\d+)?){3}$/
const oldZone      = (value: string): string | undefined => OLD_ZONE_RE.test(value) ? 'inset(' + value.split(' ').join('% ') + '%)' : undefined
const ZONE_RE      = /^(?:-?\d*\.?\d+%|top|center|bottom) (?:-?\d*\.?\d+%|top|center|bottom)$/
const ORIGIN_WORDS = ['center', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right']
const POINT_RE     = /^-?\d+(?:\.\d+)?% -?\d+(?:\.\d+)?%$/

export const EFFECTS: Record<string, EffectSpec> = {
  // ---- Texte
  glitch:    { family: 'text', main: 'every', settings: { every: time('5s'), on: loop(), burst: time('1.5s'), strength: set('int 0..40', 4), color: color('#00d29499'), color2: color('#fb2c3666'), glow: color('rgba(16,185,129,.6)'), mode: set("'text' | 'box'") } },
  neon:      { family: 'text', main: 'color', settings: { color: color('#0ff'), where: set("'text' | 'box' | 'both'", 'text'), size: set('float 0.2..5', 1), core: color('#fff'), flicker: set('bool', false), breathe: set('bool', false), speed: time('3s'), on: state('always') } },
  gradient:  { family: 'text', main: 'colors', alt: ['image', 'pattern'], settings: { speed: time('4s'), colors: colors(['#22d3ee', '#ff4fa3', '#facc15']), direction: dir('right'), where: set("'text' | 'box'", 'text'), image: img(), pattern: set("'none' | 'stripes' | 'dots' | 'waves' | 'checks'", 'none'), angle: set('int 0..360'), size: set('int 100..800'), outline: color(), width: set('float 0..10', 0), animate: set('bool', true), on: loop() } },
  scramble:  { family: 'text', text: true, main: 'speed', settings: { speed: set('int 10..500', 40), on: play(), order: order(), delay: time('0s'), chars: set('string 1..80') } },
  stagger:   { family: 'text', text: true, main: 'style', settings: { style: set("'move' | 'zoom' | 'flip' | 'blur' | 'rotate' | 'fade'", 'move'), direction: dir('up'), step: time('45ms'), duration: time('500ms'), order: order(), distance: set('int 0..200', 16), delay: time('0s'), easing: easing('ease-out'), unit: { ...set("'letter' | 'word' | 'line' | 'child'", 'letter'), textless: 'child' }, clip: set('bool', false), on: set("'view' | 'hover' | 'click' | 'load' | 'scroll' | 'success' | 'error'", 'view'), zone: zone(), opacity: set('float 0..1', 0) } },
  bounce:    { family: 'text', text: true, main: 'height', settings: { height: set('int 0..100', 14), speed: time('1.4s'), step: time('90ms'), order: order(), easing: easing('ease-in-out'), on: loop() } },
  outline:   { family: 'text', main: 'color', settings: { color: color(), width: set('float 0.5..6', 1.5), fill: set('bool', true), direction: set("'right' | 'left' | 'up' | 'down'", 'right'), duration: time('500ms'), on: state() } },
  underline: { family: 'text', inside: true, main: 'color', settings: { color: color(), thickness: set('int 1..12', 3), offset: set('int 0..40', 2), origin: set("'left' | 'center' | 'right'", 'left'), duration: time('350ms'), easing: easing('ease'), on: state() } },
  highlight: { family: 'text', main: 'color', settings: { color: color('rgba(250,204,21,.55)'), height: set('int 5..100', 45), direction: set("'right' | 'left'", 'right'), duration: time('600ms'), delay: time('0s'), on: state('view') } },
  split:     { family: 'text', text: true, main: 'color', settings: { color: color(), distance: set('int 0..100', 8), direction: dir('right'), duration: time('350ms'), on: state() } },
  rainbow:   { family: 'text', text: true, main: 'colors', settings: { speed: time('3s'), colors: colors(['#ff4d4d', '#ff9f1a', '#ffe14d', '#4dff88', '#4dd2ff', '#6b6bff', '#d24dff']), animate: set('bool', true), order: order(), on: loop() } },
  count:     { family: 'text', text: true, main: 'duration', settings: { duration: time('2s'), from: set('float', 0), separator: set('string 0..3', ' '), decimal: set('string 0..3', ','), prefix: set('string 0..8'), suffix: set('string 0..8'), pad: set('int 1..12'), easing: easing('ease-out'), delay: time('0s'), on: play(), style: set("'plain' | 'flip'", 'plain'), speed: time('400ms'), background: color('#1f2633'), color: color('#f5f7fa') } },
  marquee:   { family: 'text', text: true, main: 'speed', settings: { speed: time('12s'), direction: dir4('left'), gap: set('int 0..400', 32), pause: set('bool', false), on: set("'always' | 'hover' | 'view' | 'click' | 'load' | 'scroll' | 'success' | 'error'", 'always'), drag: set('bool', false), axis: set("'auto' | 'both'", 'auto'), reverse: set('bool', false), unit: set("'auto' | 'child'", 'auto') } },
  extrude:   { family: 'text', main: 'color', settings: { color: color('#2563eb'), depth: set('int 1..30', 6), angle: angle(45), grow: set('int 0..30', 4), on: state() } },
  longshadow: { family: 'text', main: 'color', settings: { color: color('#212121'), follow: set("'pointer' | 'fixed'", 'pointer'), angle: angle(45), length: set('int 10..1000', 200), fade: set('bool', true), light: set('bool', false) } },
  wave:      { family: 'text', text: true, main: 'color', settings: { color: color('#03a9f4'), speed: time('4s'), level: set('int 0..100', 45), stroke: set('float 0..10', 2), on: loop() } },
  dissolve:  { family: 'text', main: 'duration', settings: { duration: time('5.5s'), direction: set("'left' | 'right'", 'left'), delay: time('2s'), particles: set('bool', true), on: play() } },
  unveil:    { family: 'text', inside: true, main: 'color', settings: { color: color('#ff4fa3'), duration: time('1.1s'), direction: set("'right' | 'left' | 'up' | 'down'", 'right'), delay: time('0s'), easing: easing('ease-in-out'), on: play() } },
  annotate:  { family: 'text', inside: true, main: 'style', settings: { style: set("'underline' | 'box' | 'circle' | 'strike' | 'cross' | 'bracket'", 'underline'), color: color('#ff4fa3'), width: set('float 0.5..12', 2), padding: set('int 0..40', 5), strokes: set('int 1..3', 2), duration: time('800ms'), delay: time('0s'), on: set("'view' | 'hover' | 'click' | 'load' | 'always' | 'success' | 'error'", 'view'), every: time('3s') } },
  tracking:  { family: 'text', main: 'spacing', settings: { spacing: set('float -0.5..3', 0.5), blur: set('int 0..40', 0), opacity: set('float 0..1', 0), duration: time('900ms'), delay: time('0s'), easing: easing('ease-out'), on: play() } },
  cycle:     { family: 'text', text: true, main: 'words', settings: { words: words(), style: set("'slide' | 'flip' | 'fade' | 'blur' | 'zoom' | 'frame' | 'type'", 'slide'), direction: dir4('up'), speed: time('2.5s'), duration: time('500ms'), color: color('#01fe87'), delay: time('500ms'), cursor: set('bool', true), outside: set("'hidden' | 'hollow' | 'visible'", 'hidden'), on: loop() } },
  circular:  { family: 'text', text: true, main: 'radius', settings: { radius: set('int 10..1000', 60), speed: time('12s'), direction: set("'cw' | 'ccw'", 'cw'), on: loop() } },
  sparkles:  { family: 'text', inside: true, main: 'color', settings: { color: color('#ffc700'), count: set('int 1..60', 10), size: set('int 4..80', 18), speed: time('700ms'), on: loop() } },
  weight:    { family: 'text', text: true, main: 'radius', settings: { radius: set('int 20..800', 120), strength: set('float 0..1', 1), min: set('int 1..1000', 300), max: set('int 1..1000', 900), axis: { rule: 'string 4..4', dflt: 'wght', css: true }, fallback: set("'auto' | 'bold' | 'stretch' | 'none'", 'auto'), duration: time('150ms'), idle: set('bool', true), speed: time('3s') } },
  spoiler:   { family: 'text', inside: true, main: 'style', settings: { style: set("'grains' | 'blur' | 'bar' | 'pixels'", 'grains'), color: color(), density: set('int 1..10', 5), size: set('float 0.5..6', 1.2), speed: time('1.2s'), duration: time('500ms'), revealed: set('bool', false), again: set('bool', false), radius: set('int 0..999', 4), on: set("'click' | 'hover'", 'click') } },
  // ---- Boutons
  attention: { family: 'button', main: 'style', settings: { style: set("'tada' | 'wobble' | 'jello' | 'heartbeat' | 'swing' | 'rubber' | 'blink' | 'headshake' | 'jump' | 'pop' | 'wiggle'", 'tada'), on: set("'view' | 'hover' | 'click' | 'load' | 'always' | 'success' | 'error'", 'view'), every: time('3s'), duration: time('1s'), repeat: set('int 1..10', 1), delay: time('0s'), angle: set('int 1..45', 12) } },
  pulse:     { family: 'button', main: 'color', settings: { color: color('rgba(88,166,255,.6)'), where: set("'box' | 'text'", 'box'), size: set('int 0..100', 16), speed: time('1.8s'), direction: set("'out' | 'in'", 'out'), delay: time('0s'), radius: set('int 0..999'), on: loop() } },
  ripple:    { family: 'button', main: 'color', inside: true, settings: { color: color(), duration: time('600ms'), on: set("'click' | 'enter' | 'move'", 'click'), origin: origin('pointer', true), opacity: set('float 0..1', 0.35), easing: easing('ease-out'), size: set('int 10..2000', 100) } },
  shine:     { family: 'button', inside: true, main: 'color', settings: { color: color('rgba(255,255,255,.55)'), where: set("'box' | 'text'", 'box'), ink: color('#6e7681'), direction: dir(105), width: set('int 5..100', 30), duration: time('700ms'), on: set("'hover' | 'always' | 'view' | 'click' | 'load' | 'success' | 'error'", 'hover'), every: time('3s') } },
  confetti:  { family: 'button', main: 'count', settings: { count: set('int 5..300', 40), on: play('click'), colors: colors(['#ff4fa3', '#22d3ee', '#facc15', '#7c3aed']), direction: dir('up'), spread: set('int 10..360', 360), power: set('int 20..600', 140) } },
  shake:     { family: 'button', main: 'when', settings: { when: set('bool'), on: play('click'), direction: dir('right'), distance: set('int 1..60', 8), repeat: set('int 1..10', 1), duration: time('450ms') } },
  pixels:    { family: 'button', inside: true, main: 'mode', settings: { mode: set("'fill' | 'explode' | 'strip' | 'mosaic' | 'swap'", 'fill'), color: color('#ff5722'), size: set('int 1..100'), spread: set('int 0..500', 60), duration: time(), stagger: time(), image: img(false, true), cover: set('bool', false), on: state() } },
  smoke:     { family: 'button', inside: true, main: 'color', settings: { color: color('#fff'), count: set('int 1..100', 20), size: set('int 1..100', 8), distance: set('int 0..500', 100), duration: time('1s') } },
  // ---- Cartes
  tilt:      { family: 'card', main: 'max', settings: { max: set('float 0..45', 12), scale: set('float 0.5..2', 1.03), perspective: set('int 100..5000', 800), direction: set("'toward' | 'away'", 'toward'), glare: { rule: 'bool', dflt: false, inside: true }, duration: time('450ms'), follow: time('100ms'), wait: time('0ms'), bounce: set('float 0..0.5', 0), depth: set('int 0..400', 0), slide: set('bool', false) } },
  lift:      { family: 'card', main: 'height', settings: { height: set('int 0..60', 8), shadow: set('bool', true), color: color('rgba(0,0,0,.45)'), blur: set('int 0..200', 30), press: set('bool', false), duration: time('250ms'), easing: easing('ease'), radius: set('int 0..999'), on: state() } },
  spotlight: { family: 'card', inside: true, main: 'color', settings: { color: color('#fff'), where: set("'both' | 'fill' | 'border' | 'veil'", 'both'), size: set('int 10..1000', 200), fill: set('float 0..1', 0.25), width: set('int 1..20', 2), soft: set('int 0..1000', 120), smooth: set('float 0.01..1', 1), radius: set('int 0..999'), on: set("'hover' | 'always'", 'hover'), origin: origin('pointer', true), glow: set('int 0..1000'), every: time() } },
  glass:     { family: 'card', main: 'blur', settings: { blur: set('int 0..100', 10), tint: color('rgba(255,255,255,.13)'), border: set('bool', true), shadow: set('bool', true), radius: set('int 0..999') } },
  clay:      { family: 'card', main: 'color', settings: { color: color('#1f83f2'), shape: set("'raised' | 'hollow'", 'raised'), radius: set('int 0..200', 30), on: state('always') } },
  stack:     { family: 'card', main: 'layers', settings: { layers: set('int 1..6', 2), gap: set('int 0..200', 40), color: color('#fff'), radius: set('int 0..999'), on: state() } },
  zoom:      { family: 'card', main: 'scale', settings: { scale: set('float 1..3', 1.5), origin: origin('center', true), duration: time('500ms'), easing: easing('ease'), on: state() } },
  hologram:  { family: 'card', inside: true, main: 'style', settings: { style: set("'rainbow' | 'foil' | 'galaxy' | 'prism' | 'gold' | 'sheen' | 'frame' | 'curtain' | 'night-sky' | 'frost' | 'lattice' | 'opal' | 'streaks' | 'rays' | 'rays-window' | 'rays-cloud' | 'rays-fade' | 'rays-wide' | 'haze' | 'haze-deep' | 'dust-dark' | 'dust' | 'glint' | 'glint-dark' | 'bloom'", 'rainbow'), strength: set('float 0..1'), colors: colors(), size: set('int 50..600', 200), angle: angle(110), blend: set("'color-dodge' | 'overlay' | 'soft-light' | 'screen' | 'hard-light'", 'color-dodge'), glare: set('bool', true), speed: time('7s'), radius: set('int 0..999'), image: img(), mask: img(), zone: { rule: 'card-zone' }, shine: set("'bright' | 'calm' | 'shade'"), glow: color('hsl(175, 100%, 90%)'), brightness: set('float 0..2', 0.55), zoom: set("bool | 'spin'", false), back: img(), shadow: set('bool', true), seed: set('int 0..999'), on: set("'always' | 'hover' | 'view' | 'load'") } },
  flipcard:  { family: 'card', main: 'axis', settings: { axis: set("'y' | 'x'", 'y'), flipped: set('bool', false), reverse: set('bool', false), perspective: set('int 100..5000', 1000), duration: time('600ms'), easing: curve('ease'), shadow: set('bool', true), radius: set('int 0..999'), on: set("'hover' | 'click' | 'view' | 'none'", 'hover') } },
  scratch:   { family: 'card', inside: true, main: 'color', settings: { color: color('#b9bec7'), colors: colors(), image: img(), text: set('string 0..80'), ink: color('#5b6270'), brush: set('int 4..200', 28), shape: set("'round' | 'square'", 'round'), threshold: set('float 0.05..1', 0.6), duration: time('500ms'), revealed: set('bool', false), radius: set('int 0..999') } },
  peel:      { family: 'card', inside: true, main: 'corner', settings: { corner: set("'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'", 'top-right'), size: set('int 10..400', 40), grow: set('int 10..600', 90), color: color('#f5f5f5'), under: color('#111827'), image: img(), shadow: set('bool', true), duration: time('300ms'), easing: easing('ease'), on: state() } },
  // ---- Icônes
  float:     { family: 'icon', main: 'distance', settings: { distance: set('int 0..200', 12), speed: time('3s'), direction: dir('up'), easing: easing('ease-in-out'), on: loop() } },
  spin:      { family: 'icon', main: 'speed', settings: { speed: time('2.5s'), direction: set("'cw' | 'ccw'", 'cw'), axis: set("'z' | 'x' | 'y'", 'z'), origin: origin('center'), easing: easing('linear'), on: loop() } },
  orbit:     { family: 'icon', main: 'radius', settings: { radius: set('int 10..2000', 120), speed: time('20s'), direction: set("'cw' | 'ccw'", 'cw'), upright: set('bool', true), on: loop() } },
  dock:      { family: 'icon', main: 'scale', settings: { scale: set('float 1..3', 1.6), range: set('int 20..800', 140), axis: set("'x' | 'y'", 'x'), duration: time('150ms') } },
  path:      { family: 'icon', main: 'd', settings: { d: set('string 1..4000', 'wave'), from: set('string 1..200'), viewbox: set('string 3..60'), duration: time('4s'), delay: time('0s'), easing: curve('linear'), rotate: set('bool', true), angle: set('int -360..360', 0), reverse: set('bool', false), alternate: set('bool', false), repeat: set('int 0..1000', 0), start: set('float 0..1', 0), end: set('float 0..1', 1), anchor: origin('center'), on: set("'always' | 'hover' | 'view' | 'click' | 'load' | 'scroll'", 'always'), zone: zone() } },
  // ---- Images
  kenburns:  { family: 'image', inside: true, main: 'zoom', settings: { zoom: set('float 1..3', 1.2), direction: dir('right'), distance: set('int 0..50', 5), duration: time('12s'), easing: easing('ease-in-out'), on: loop() } },
  filter:    { family: 'image', main: 'style', settings: { style: set("'grayscale' | 'sepia' | 'vintage' | 'noir' | 'warm' | 'cool' | 'vivid' | 'faded' | 'dramatic' | 'duotone' | 'blur' | 'invert' | 'polaroid' | 'lomo' | 'kodachrome' | 'technicolor' | 'cyberpunk' | 'sunset' | 'night' | 'nightvision' | 'thermal' | 'xray' | 'newsprint' | 'bleach' | 'cross' | 'pastel' | 'matrix' | 'posterize' | 'threshold' | 'sharpen' | 'emboss' | 'edges' | 'chromatic' | 'pixelate' | 'grain' | 'halftone' | 'vignette' | 'tiltshift' | 'bloom' | 'ripple' | 'scanlines' | 'none'", 'grayscale'), amount: set('float 0..1', 1), colors: colors(['#1b1464', '#ffd1e8']), brightness: set('float 0..3', 1), contrast: set('float 0..3', 1), saturate: set('float 0..3', 1), hue: set('int -360..360', 0), grayscale: set('float 0..1', 0), sepia: set('float 0..1', 0), invert: set('float 0..1', 0), blur: set('float 0..50', 0), opacity: set('float 0..1', 1), shadow: { rule: 'css' }, levels: set('int 2..8', 4), threshold: set('float 0..1', 0.35), strength: set('float 0..3', 1), size: set('int 1..48'), shift: set('float 0..20', 6), radius: set('int 1..100'), band: set('int 10..70', 30), frequency: set('int 1..60', 15), scale: set('int 0..80', 40), gap: set('int 2..10', 4), spot: set('int 0..2000', 0), soft: set('int 0..1000', 40), smooth: set('float 0.01..1', 0.2), ring: set('bool', false), color: color('#fff'), near: set('bool', false), parallax: set('float 0..1', 0), duration: time('400ms'), easing: easing('ease'), on: set("'always' | 'hover' | 'rest' | 'view'", 'always') } },
  blend:     { family: 'image', main: 'mode', settings: { mode: set("'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'color-dodge' | 'color-burn' | 'hard-light' | 'soft-light' | 'difference' | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity'", 'multiply'), color: color(), colors: colors(), angle: angle(180), image: img(), fit: set("'cover' | 'contain' | 'stretch' | 'repeat'", 'cover'), position: origin('center'), opacity: set('float 0..1', 1), order: set("'over' | 'under'", 'over'), duration: time('400ms'), on: set("'always' | 'hover' | 'rest' | 'view'", 'always') } },
  liquid:    { family: 'image', main: 'strength', settings: { strength: set('int 0..200', 40), cells: set('int 0..200', 0), radius: set('int 0..2000', 0), ghost: color(), resolution: set('float 0.5..4', 1.5), rest: set('float 0..1', 0.12), frequency: set('float 0.001..0.2', 0.015), octaves: set('int 1..5', 2), seed: set('int 1..999', 2), speed: time('4s'), animate: set('bool', true), duration: time('500ms'), on: set("'hover' | 'always' | 'view' | 'click'", 'hover') } },
  chromatic: { family: 'image', main: 'gap', settings: { gap: set('float 0..40', 4), grow: set('float 0..80', 12), angle: angle(90), mode: set("'rgb' | 'cmy'", 'rgb'), animate: set('bool', false), speed: time('2s'), duration: time('250ms'), on: state() } },
  crt:       { family: 'image', inside: true, main: 'lines', settings: { lines: set('int 1..12', 3), opacity: set('float 0..1', 0.35), flicker: set('float 0..1', 0.4), roll: set('bool', true), speed: time('6s'), vignette: set('float 0..1', 0.5), tint: color(), glow: set('float 0..1', 0.3), radius: set('int 0..200', 18), on: loop() } },
  reflect:   { family: 'image', main: 'gap', settings: { gap: set('int 0..100', 4), opacity: set('float 0..1', 0.5), size: set('int 5..100', 50), blur: set('int 0..40', 0), direction: dir4('down'), water: set('bool', false), speed: time('4s') } },
  magnet:    { family: 'icon', main: 'strength', settings: { strength: set('int 0..200', 20), duration: time('300ms'), ring: set('bool', false), color: color('#fff') } },
  iso:       { family: 'icon', inside: true, main: 'depth', settings: { depth: set('int 0..200', 60), lift: set('int 0..100', 20), shadow: set('bool', true), on: state() } },
  // ---- Défilement
  parallax:  { family: 'scroll', main: 'speed', settings: { speed: set('float -5..5', 0.5), axis: set("'y' | 'x'", 'y'), origin: set("'view' | 'page'", 'view'), smooth: set('float 0.01..1', 1) } },
  scrollprogress: { family: 'scroll', inside: true, main: 'color', settings: { color: color('#58a6ff'), colors: colors(), track: color(), thickness: set('int 1..40', 4), place: set("'top' | 'bottom' | 'left' | 'right'", 'top'), source: set("'self' | 'page'", 'self'), origin: set("'start' | 'center' | 'end'", 'start'), radius: set('int 0..999', 0), glow: set('int 0..40', 0), zindex: set('int 0..2147483647', 10), duration: time('0s') } },
  // ---- Chargement
  skeleton:  { family: 'loader', inside: true, main: 'lines', settings: { lines: set('int 1..12', 3), color: color('#21262d'), shine: color('#30363d'), speed: time('1.4s'), radius: set('int 0..20', 7) } },
  loader:    { family: 'loader', inside: true, main: 'style', settings: { style: set("'dots' | 'steps' | 'plus' | 'neon' | 'trio' | '3d' | 'bloom' | 'spiral' | 'galaxy' | 'cross' | 'vortex'", 'dots'), color: color(), color2: color('#e91e63'), size: set('int 16..600', 96), speed: time() } },
  // ---- Bordures
  border:    { family: 'border', inside: true, main: 'style', settings: { style: set("'gradient' | 'wave' | 'run'", 'gradient'), colors: colors(['#ffbc00', '#ff0058']), color: color(), width: set('int 1..40'), glow: set('int 0..200', 30), angle: angle(45), animate: set('bool', false), speed: time(), delay: time('0s'), radius: set('int 0..999') } },
  // ---- Formes
  goo:       { family: 'shape', main: 'mode', settings: { mode: set("'drip' | 'merge'", 'drip'), color: color(), strength: set('int 1..40', 10), halo: set('int 0..200', 50), count: set('int 1..20', 3), distance: set('int 10..1000', 200), on: set("'always' | 'hover'", 'always'), drag: set('bool', false), pointer: set('int 0..600', 0) } },
  // ---- Fonds
  grid:      { family: 'background', inside: true, main: 'style', settings: { style: set("'hex' | 'halo' | 'trail' | 'needle' | 'lines'", 'hex'), light: set("'fill' | 'outline' | 'glow' | 'rows'", 'fill'), color: color(), size: set('int 10..300'), rainbow: set('bool', true), fade: set("'none' | 'down' | 'up' | 'left' | 'right' | 'edges'", 'none') } },
  particles: { family: 'background', inside: true, main: 'mode', settings: { mode: set("'snow' | 'stars' | 'network' | 'aura' | 'meteors'", 'snow'), count: set('int 1..400'), color: color('#fff'), speed: time(), direction: dir('down'), links: set('int 0..500', 150), mouse: set("'repulse' | 'attract' | 'none'", 'repulse'), on: set("'always' | 'hover'", 'always') } },
  noise:     { family: 'background', inside: true, main: 'amount', settings: { amount: set('float 0..1', 0.5), speed: time('500ms'), blend: set("'overlay' | 'soft-light' | 'multiply' | 'screen'", 'overlay') } },
  beam:      { family: 'background', inside: true, main: 'color', settings: { color: color('#fff'), angle: set('int -80..80', -35), opacity: set('float 0..1', 0.21), count: set('int 1..4', 2), blur: set('int 0..200', 70), origin: set("'top-left' | 'top-right'", 'top-left'), duration: time('2s'), delay: time('750ms'), on: play() } },
  mesh:      { family: 'background', inside: true, main: 'style', settings: { style: set("'boreal' | 'sunset' | 'ocean' | 'neon' | 'candy' | 'forest'", 'boreal'), drift: set("'spots' | 'sweep'", 'spots'), colors: colors(), background: color(), count: set('int 2..8', 5), size: set('int 10..150', 60), blur: set('int 0..200', 60), speed: time('20s'), opacity: set('float 0..1', 1), mouse: set('bool', false), on: loop() } },
  matrix:    { family: 'background', inside: true, main: 'color', settings: { color: color('#00ff66'), head: color('#e9fff1'), background: color('#000'), speed: set('int 1..10', 5), density: set('int 1..10', 6), size: set('int 8..40', 15), chars: set('string 1..200'), trail: set('float 0.01..0.5', 0.06), direction: dir4('down'), opacity: set('float 0..1', 1), on: set("'always' | 'hover' | 'view'", 'always') } },
  // ---- En direct (ce qui change sous les yeux)
  delta:     { family: 'live', text: true, main: 'duration', settings: { duration: time('1s'), up: color('#16a34a'), down: color('#dc2626'), arrow: set('bool', true), fx: fxOf('*count'), separator: set('string 0..3', ' '), decimal: set('string 0..3', ','), prefix: set('string 0..8'), suffix: set('string 0..8'), easing: easing('ease-out') } },
  autosize:  { family: 'live', main: 'duration', settings: { duration: time('300ms'), easing: easing('ease'), axis: set("'height' | 'width' | 'both'", 'height') } },
  lang:      { family: 'live', main: 'style', settings: { style: set("'scramble' | 'type'", 'scramble'), duration: time('600ms'), chars: set('string 1..80') } },
  cursors:   { family: 'live', main: 'sock', settings: { sock: sock(), server: set('string 1..300'), room: set('string 1..200'), cursor: set("'none' | 'normal' | 'pulse'", 'pulse'), selection: set('bool', true), focus: set('bool', true), max: set('int 1..1000', 20) } },
  react:     { family: 'live', main: 'emoji', settings: { emoji: set('string 1..16'), count: set('int 1..10', 1), stage: set('bool', false), sock: sock(), server: set('string 1..300'), room: set('string 1..200'), rate: set('int 1..10', 5), direction: dir('up'), gravity: set('float -5..5', -1), size: set('int 8..200', 32), duration: time('2.5s'), spread: set('int 0..400', 60), height: set('int 10..100', 60), max: set('int 1..200', 40) } },
  follow:    { family: 'live', main: 'sock', settings: { sock: sock(), server: set('string 1..300'), room: set('string 1..200'), lead: set('bool', false), ease: set('float 0..1', 0.12), glow: color('rgba(88,166,255,.18)'), cursor: set("'none' | 'normal' | 'pulse'", 'pulse'), selection: set('bool', true), focus: set('bool', true) } },
  heatmap:   { family: 'live', main: 'on', settings: { on: set('string 1..40', 'click'), sock: sock(), server: set('string 1..300'), name: set('string 1..120'), show: set('bool | int 1..10000000', false) } },
  gauge:     { family: 'live', inside: true, main: 'color', settings: { color: color('#58a6ff'), colors: colors(), track: color(), style: set("'fill' | 'line' | 'ring'", 'fill'), direction: dir4('right'), thickness: set('int 1..60', 4), opacity: set('float 0..1', 0.35), duration: time('300ms'), easing: easing('ease'), value: set('float'), min: set('float'), max: set('float'), radius: set('int 0..999') } },
  flash:     { family: 'live', main: 'color', settings: { color: color('#facc15'), duration: time('600ms'), style: set("'outline' | 'fill' | 'glow'", 'outline'), radius: set('int 0..999'), on: set("'change' | 'load' | 'click' | 'hover' | 'view' | 'success' | 'error'", 'change') } },
  offline:   { family: 'live', inside: true, main: 'text', settings: { text: set('string 1..200'), count: set('bool', true), place: set("'top' | 'bottom'", 'top'), size: set('int 16..300', 40), zindex: set('int 0..2147483647', 2147483000), background: color('#24292f'), color: color('#fff'), opacity: set('float 0..1', 1), logo: img(true, true), veil: set('float 0..1', 0.8), fx: { rule: 'effect' }, delay: time('1s') } },
  guard:     { family: 'live', field: true, main: 'text', settings: { text: set('string 1..200'), fx: fxOf('*shake', true), color: color('#dc2626'), duration: time('2s'), place: set("'bottom' | 'top' | 'right'", 'bottom'), radius: set('int 0..999'), delay: time('1s'), silent: set('bool', false) } },
  // ---- Transitions
  scrub:     { family: 'scroll', main: 'frames', settings: { frames: set('string 1..2000'), count: set('int 2..2000'), images: imgs(true), first: set('int 0..100000', 1), on: set("'scroll' | 'hover'", 'scroll'), zone: zone(), from: set('float 0..1', 0), to: set('float 0..1', 1), smooth: set('float 0..1', 0.15), fit: set("'cover' | 'contain'", 'cover'), reverse: set('bool', false) } },
  travel:    { family: 'scroll', main: 'to', need: 'to', settings: { to: set('string 1..400'), rotate: set('int -3600..3600', 0), spin: set('int -3600..3600', 0), arc: set('int -2000..2000', 0), size: set('bool', true), zone: zone(), easing: curve('ease-in-out'), smooth: set('float 0..1', 0.12), fade: set('bool', false) } },
  gallery:   { family: 'scroll', main: 'style', settings: { style: set("'depth' | 'coverflow' | 'strip' | 'wheel' | 'arc' | 'tunnel' | 'sphere'", 'coverflow'), on: set("'scroll' | 'drag' | 'pointer' | 'always'", 'scroll'), loop: set('bool', false), snap: set('bool', true), gap: set('float 0.2..4', 1), perspective: set('int 200..5000', 1200), tilt: set('float 0..30', 0), speed: time('4s'), zone: zone(), index: set('int 0..10000', 0), smooth: set('float 0.01..1', 0.1) } },
  pointer:   { family: 'cursor', main: 'style', settings: { style: set("'disc' | 'ring' | 'dot' | 'lens'", 'disc'), color: color('#fff'), size: set('int 4..600', 36), blend: set("'difference' | 'normal' | 'exclusion' | 'screen' | 'multiply' | 'overlay'", 'difference'), filter: set("'grayscale' | 'invert' | 'blur' | 'saturate' | 'sepia' | 'hue'", 'grayscale'), outside: set('bool', false), soft: set('int 0..1000', 0), grow: set('float 1..6', 2.2), smooth: set('float 0.01..1', 0.18), hide: set('bool', false), text: set('bool', true), press: set('float 0.3..2', 0.8), zindex: set('int 0..2147483647', 2147483000) } },
  physics:   { family: 'shape', inside: true, main: 'mode', settings: { mode: set("'fall' | 'float' | 'hang'", 'fall'), gravity: set('float -3..3', 1), bounce: set('float 0..1', 0.5), friction: set('float 0..1', 0.3), drag: set('bool', true), walls: set("'all' | 'floor' | 'none'", 'all'), spin: set('bool', true), strength: set('float 0..1', 0.3), length: set('int 0..2000', 100), push: set('int 0..600', 140), color: color(), sleep: time('30s'), on: set("'view' | 'load' | 'click'", 'view') } },
  pile:      { family: 'scroll', main: 'gap', settings: { gap: set('int 0..400', 0), top: set('int 0..1000', 0), scale: set('float 0..0.3', 0.05), dim: set('float 0..1', 0), blur: set('int 0..40', 0), radius: set('int 0..999'), origin: set("'top' | 'center'", 'top') } },
  velocity:  { family: 'scroll', main: 'style', settings: { style: set("'skew' | 'stretch' | 'tilt' | 'bend' | 'blur' | 'shift'", 'skew'), strength: set('float 0..5', 2), max: set('float 0..90', 12), smooth: set('float 0.01..1', 0.15), axis: set("'y' | 'x'", 'y') } },
  focus:     { family: 'card', main: 'blur', settings: { blur: set('int 0..40', 8), opacity: set('float 0..1', 1), grayscale: set('float 0..1', 0), scale: set('float 0.5..1.5', 1), grow: set('float 1..2', 1), duration: time('500ms'), easing: easing('ease') } },
  sprite:    { family: 'icon', inside: true, main: 'image', settings: { image: img(), frames: set('int 1..1000', 1), columns: set('int 1..1000'), speed: time('1s'), repeat: set('int 0..1000', 0), direction: set("'normal' | 'reverse' | 'alternate'", 'normal'), start: set('int 0..999', 0), pixel: set('bool', false), fps: set('float 0.1..120'), rows: set('int 1..1000'), row: set('int 0..999', 0), poses: words(), animate: set('bool', true), hold: set('bool', false), on: loop() } },
  sticky:    { family: 'scroll', main: 'offset', settings: { offset: set('int 0..20000', 0), hide: set('bool', false), top: set('int 0..500', 0), duration: time('400ms'), easing: easing('ease'), zindex: set('int 0..2147483647', 1000) } },
  fluid:     { family: 'background', inside: true, main: 'colors', settings: { colors: colors(), where: set("'box' | 'text'", 'box'), auto: set('bool', false), size: set('float 0.05..2', 0.5), strength: set('int 0..5000', 1000), fade: set('float 0..10', 2), friction: set('float 0..10', 1), curl: set('int 0..50', 4), glow: set('float 0..2', 0.5), rays: set('float 0..1', 0.6), detail: set('int 16..256', 32), quality: set('int 64..2048', 512), resolution: set('float 0.5..4', 1.5), background: color(), on: set("'hover' | 'click'", 'hover') } },
  behind:    { family: 'image', inside: true, main: 'image', settings: { image: img(), size: set("'cover' | 'contain' | 'auto'"), position: { rule: 'origin' }, depth: set('int 0..100', 0), edge: set("'zoom' | 'blur' | string /^[^;{}]+$/", 'zoom') } },
  backlight: { family: 'image', main: 'blur', settings: { blur: set('int 0..200', 24), opacity: set('float 0..1', 0.8), saturate: set('float 0..4', 1.4), size: set('float 0.5..2', 1), x: set('int -500..500', 0), y: set('int -500..500', 12), duration: time('300ms'), on: state('always'), legend: set('bool', false) } },
  fade:       tr('duration', {}, '400ms', 'linear'),
  fly:       tr('direction', { direction: dir('up'), distance: len(40), opacity: set('float 0..1', 0), blur: set('int 0..100', 0), skew: set('int -80..80', 0), rotate: set('int -1080..1080', 0) }, '400ms', 'cubic-out'),
  slide:      tr('axis', { axis: set("'y' | 'x'", 'y') }, '400ms', 'cubic-out'),
  scale:     tr('start', { start: set('float 0..40', 0), opacity: set('float 0..1', 0), origin: origin('center'), axis: set("'both' | 'x' | 'y'", 'both') }, '400ms', 'cubic-out'),
  rotate:     tr('angle', { angle: set('int -1080..1080', -200), start: set('float 0..3', 1), opacity: set('float 0..1', 0), origin: origin('center') }, '600ms', 'cubic-out'),
  blur:       tr('amount', { amount: set('int 0..200', 5), opacity: set('float 0..1', 0) }, '400ms', 'cubic-in-out'),
  draw:       tr('duration', { speed: set('int 1..100000') }, '800ms', 'cubic-in-out'),
  iris:      tr('origin', { origin: origin('center', true), shape: set("'circle' | 'box' | 'diamond' | 'cross' | 'ellipse'", 'circle'), start: set('float 0..1', 0), angle: set('int -180..180', 0) }, '380ms', 'ease-out'),
  wheel:      tr('spokes', { spokes: set('int 1..12', 1), origin: origin('center'), reverse: set('bool', false) }, '700ms', 'linear'),
  volet:      tr('direction', { direction: dir4('down') }, '380ms', 'ease-out'),
  reveal:     tr('direction', { direction: dir4('up') }, '380ms', 'ease-in'),
  flip:       tr('direction', { direction: dir4('left') }, '550ms', 'ease-in-out'),
  cube:       tr('direction', { direction: dir4('left') }, '600ms', 'cubic-bezier(.45, .05, .55, .95)'),
  turn:       tr('direction', { direction: dir4('left') }, '600ms', 'linear'),
  swipe:      tr('direction', { direction: dir('right') }, '320ms', 'ease-out'),
  bars:       tr('direction', { direction: dir4('down'), count: set('int 1..40', 8) }, '640ms', 'linear'),
  blocks:    tr('cols', { cols: set('int 1..40', 6), rows: set('int 1..40', 4), order: set("'diagonal' | 'random' | 'rows' | 'columns' | 'center' | 'edges'", 'diagonal'), seed: set('int 1..999', 3) }, '620ms', 'linear'),
  shatter:    tr('size', { size: set('int 4..200', 20), spread: set('int 0..3000', 400), rotate: set('int 0..1080', 360) }, '1.2s', 'cubic-out'),
  pixelate:  tr('size', { size: set('int 2..400', 48), steps: set('int 2..40', 8) }, '900ms', 'ease-out'),
  ink:        tr('style', { style: set("'blots' | 'brush' | 'wash' | 'smoke' | 'drip' | 'dots' | 'shards' | 'swirl' | 'tear' | 'burn' | 'frost' | 'rain' | 'cells' | 'cracks' | 'ripple' | 'scribble' | 'petals' | 'glitch' | 'topo' | 'maze'", 'blots'), image: img(), soft: set('float 0.005..1'), count: set('int 1..20'), seed: set('int 1..999', 3), direction: dir(), origin: origin('center'), invert: set('bool', false) }, '1.8s', 'linear'),
  typewriter: tr('speed', { speed: set('int 1..1000', 30) }, undefined, 'linear'),
  crossfade:  tr('key', { key: { rule: 'key' }, group: set('string 1..40'), fallback: set("'scale' | 'fade' | 'none'", 'scale') }, undefined, 'cubic-out', true),
  // l'élément partagé d'une transition de page : un nom de transition tiré de sa clé
  shared:     { family: 'transition', main: 'key', need: 'key', settings: { key: { rule: 'key' }, group: set('string 1..40') } },
}
// un nom écrit (`*constructor`, `toString: 1`) ne tombe jamais sur une propriété héritée d'un objet :
// le catalogue et ses listes de réglages n'ont pas de prototype
Object.setPrototypeOf(EFFECTS, null)
for (const fx of Object.values(EFFECTS)) Object.setPrototypeOf(fx.settings, null)

export type EffectValue = string | number | boolean | string[] | EffectRef | EffectImage

/** une image donnée en réglage par µimage('…') : l'adresse d'origine et la liste des variantes de largeur */
export interface EffectImage {
  src: string
  srcset: string
}

/** un effet donné en réglage (`fx: *scramble(20)`) : son nom, ses réglages fixes, vérifiés */
export interface EffectRef {
  fx: string
  s: Record<string, EffectValue>
}

/** réglages écrits sur la balise : valeurs fixes vérifiées, variables à suivre et leur règle */
export interface ParsedEffect {
  /** un effet de l'appli qui en règle un de la bibliothèque : celui-là, à poser */
  base?: string
  /** un effet CSS de l'appli : sa définition, à embarquer */
  custom?: ProjectEffect
  /** les effets de l'appli donnés en réglage (`fx: *titre`), sous leur nom écrit : un effet réglé
   * n'y laisse que celui de la bibliothèque qu'il règle */
  uses?: string[]
  fixed: Record<string, EffectValue>
  /** réglage → variable écrite (`$x`, `$$x`, `$x.champ`) */
  dynamic: Record<string, string>
  /** réglage → règle transmise au moteur : `['i'|'f', min, max, texte]`, `['b'|'t'|'c'|'s'|'p'|'k'|'w'|'e'|'x', texte]`, `['s'|'p', min, max, texte]`
   * (un texte borné en longueur), `['l', valeurs, texte]`,
   * `['v', variable écrite, texte]` (la connexion d'un effet en direct ; variable vide : `@sock` par défaut) */
  spec: Record<string, unknown[]>
}

// une variable seule : `$x`, `$$x`, `$x.champ.sous`
const VAR_RE = /^\$\$?[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/
// la connexion d'un effet en direct : une variable seule, de l'état, d'un store ou de l'instance (`@sock`)
const SOCK_RE = /^(?:\$\$?|@)[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/
// … ou une variable d'une boucle englobante, `item`, `item.id`
const PATH_RE = /^([A-Za-z_]\w*)(?:\.[A-Za-z_]\w*)*$/
function isScoped(value: string, scope: string[]): boolean {
  const m = PATH_RE.exec(value)
  return !!m && scope.includes(m[1])
}

const TIME_RE  = /^(?:0|\d*\.?\d+(?:ms|s))$/
const COLOR_RE = /^[^;{}]+$/
const KEY_RE   = /^([A-Za-z][\w-]*)\s*:\s*([\s\S]*)$/

// `réglage: valeur` → [réglage, valeur], null pour une valeur écrite sans nom ; une adresse sans guillemets (`https://cdn/a.png`)
// n'est pas le réglage `https` : un nom suivi de `//` n'est un réglage que si l'effet en a un de ce nom (`image://cdn/a.png`)
function keyValue(item: string, settings: Record<string, EffectSetting>): [string, string] | null {
  const m = /^\{/.test(item) ? null : KEY_RE.exec(item)
  if (!m || (m[2].startsWith('//') && !Object.hasOwn(settings, m[1]))) return null
  return [m[1], m[2]]
}

// règles des types analysées une seule fois
const parsed = new Map<string, RuleAst>()
function ruleOf(rule: string): RuleAst {
  let r = parsed.get(rule)
  if (!r) {
    r = parseRule(rule, { bloc: 'effet', ligne: 0 })
    parsed.set(rule, r)
  }
  return r
}

function ruleDisplay(rule: string): string {
  if (rule === 'time') return t('effets.regle-duree')
  if (rule === 'color') return t('effets.regle-couleur')
  if (rule === 'colors') return t('effets.regle-couleurs')
  if (rule === 'words') return t('effets.regle-mots')
  if (rule === 'direction') return t('effets.regle-direction')
  if (rule === 'origin') return t('effets.regle-origine')
  if (rule === 'origin-pointer') return t('effets.regle-origine-pointeur')
  if (rule === 'curve') return t('effets.regle-courbe')
  if (rule === 'length') return t('effets.regle-longueur')
  if (rule === 'range') return t('effets.regle-plage')
  if (rule === 'zone') return t('effets.regle-zone')
  if (rule === 'card-zone') return CARD_ZONES
  if (rule === 'key') return t('effets.regle-cle')
  if (rule === 'css') return t('effets.regle-css')
  if (rule === 'image') return t('effets.regle-image')
  if (rule === 'images') return t('effets.regle-images')
  if (rule === 'effect') return t('effets.regle-effet')
  if (rule === 'socket') return t('effets.regle-connexion')
  return ruleText(ruleOf(rule))
}

// découpe `a, b(c, d), [e, f], {g, h}, 'i, j'` aux virgules de premier niveau (hors parenthèses,
// crochets, accolades et guillemets) ; une accolade ne compte que si elle ouvre la valeur (l'objet
// posé par µimage) et se referme : dans un mot (`chars: AB{CD`) ou jamais refermée, elle reste une lettre
function splitArgs(raw: string): string[] {
  const out: string[] = []
  let depth = 0
  let quote: string | null = null
  let cur = ''
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (quote) {
      cur += ch
      // un antislash garde dans la chaîne le caractère qui le suit (`'a\'b'`)
      if (ch === '\\' && i + 1 < raw.length) cur += raw[++i]
      else if (ch === quote) quote = null
      continue
    }
    // un objet qui ouvre la valeur et se referme : ses virgules restent dedans
    if (ch === '{' && depth === 0 && /(?:^|:)\s*$/.test(cur)) {
      const end = closingBrace(raw, i)
      if (end > 0) {
        cur += raw.slice(i, end + 1)
        i = end
        continue
      }
    }
    if (ch === "'" || ch === '"') quote = ch
    else if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') depth--
    else if (ch === ',' && depth === 0) {
      out.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur.trim() !== '' || out.length > 0) out.push(cur)
  return out.map(s => s.trim())
}

// la position de l'accolade qui referme celle de `from` (guillemets et accolades imbriquées sautés) ;
// -1 si elle ne se referme jamais : elle n'ouvrait pas un objet, c'est un caractère comme un autre
function closingBrace(raw: string, from: number): number {
  let n = 0
  let quote: string | null = null
  for (let i = from; i < raw.length; i++) {
    const ch = raw[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === '{') n++
    else if (ch === '}' && --n === 0) return i
  }
  return -1
}

// une valeur entre guillemets : son texte, sans l'antislash qui échappe un guillemet ou un antislash (`'a\'b'` → a'b)
function unquote(v: string): string {
  const m = /^(['"])([\s\S]*)\1$/.exec(v)
  return m ? m[2].replace(/\\(['"\\])/g, '$1') : v
}

/** une valeur CSS qui ne laisse rien d'ouvert : guillemets, parenthèses et commentaires refermés, pas d'antislash au bout — dans la feuille
 * d'un effet de l'appli, une chaîne ou une parenthèse restée ouverte avalerait la suite, jusqu'à la règle du mouvement réduit */
export function closedCss(v: string): boolean {
  let depth = 0
  let quote = ''
  for (let i = 0; i < v.length; i++) {
    const ch = v[i]
    if (ch === '\\') {
      if (i === v.length - 1) return false
      i++
      continue
    }
    if (quote) {
      if (ch === quote) quote = ''
      continue
    }
    // un commentaire CSS : son texte ne compte pas (`/* l'épaisseur */`) ; jamais refermé, il avalerait la suite
    if (ch === '/' && v[i + 1] === '*') {
      const fin = v.indexOf('*/', i + 2)
      if (fin < 0) return false
      i = fin + 1
      continue
    }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === '(') depth++
    else if (ch === ')' && --depth < 0) return false
  }
  return quote === '' && depth === 0
}

// une valeur littérale confrontée à une règle des types : convertie, ou undefined si refusée
function checkLiteral(rule: RuleAst, raw: string): EffectValue | undefined {
  switch (rule.k) {
    case 'int':
    case 'float': {
      if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw)) return undefined
      let n = Number(raw)
      if (rule.k === 'int') n = Math.round(n)
      if (rule.min !== undefined && n < rule.min) return undefined
      if (rule.max !== undefined && n > rule.max) return undefined
      return n
    }
    case 'bool':
      return raw === 'true' ? true : raw === 'false' ? false : undefined
    case 'string': {
      // ses bornes de longueur (`string 4..4`), comptée en caractères, comme le fait le moteur des types
      const n = [...raw].length
      if ((rule.min !== undefined && n < rule.min) || (rule.max !== undefined && n > rule.max)) return undefined
      if (rule.re && !new RegExp(rule.re.source, rule.re.flags).test(raw)) return undefined
      return raw
    }
    case 'lit': {
      const hit = rule.values.find((v: Lit) => String(v) === raw)
      return hit === undefined || hit === null ? undefined : hit
    }
    case 'union':
      for (const alt of rule.alts) {
        const v = checkLiteral(alt, raw)
        if (v !== undefined) return v
      }
      return undefined
    default:
      return raw
  }
}

// la règle d'un réglage tenu par une variable, pour le moteur (cf. µ._mjs_fxNorm). Ce qui va dans le CSS — une valeur CSS, la découpe de
// *hologram (posée telle quelle dans `clip-path`), un texte marqué `css` — prend `s`, qui refuse toute adresse ; un texte de la page (un
// `textContent`, une toile, un sélecteur, une adresse donnée exprès) prend `p`, qui le laisse tel quel. Une courbe, une longueur, une
// plage, une zone sont relues par l'effet (un mot, des nombres) ; une clé est un nom ; une image, une adresse donnée exprès : `x`
function specOf(rule: string, css = false): unknown[] {
  const shown = ruleDisplay(rule)
  if (rule === 'time') return ['t', shown]
  if (rule === 'color') return ['c', shown]
  if (rule === 'colors') return ['k', shown]
  if (rule === 'words' || rule === 'images') return ['w', shown]
  if (rule === 'direction') return ['d', shown]
  if (rule === 'origin' || rule === 'origin-pointer') return ['o', rule === 'origin-pointer', shown]
  if (rule === 'curve' || rule === 'length' || rule === 'range' || rule === 'zone' || rule === 'key') return ['x', shown]
  if (rule === 'effect') return ['e', shown]
  if (rule === 'css' || rule === 'card-zone') return ['s', shown]
  if (rule === 'image') return ['x', shown]
  if (rule === 'socket') return ['v', '', shown]
  const r = ruleOf(rule)
  switch (r.k) {
    case 'int':
    case 'float':
      return [r.k === 'int' ? 'i' : 'f', r.min ?? null, r.max ?? null, shown]
    case 'bool':
      return ['b', shown]
    case 'string':
      // ses bornes de longueur (`string 4..4`) partent avec elle : le moteur écarte un texte trop court ou trop long, comme la compilation
      return r.min !== undefined || r.max !== undefined ? [css ? 's' : 'p', r.min ?? null, r.max ?? null, shown] : [css ? 's' : 'p', shown]
    case 'lit':
      return ['l', r.values, shown]
    default:
      return ['x', shown]
  }
}

/** les réglages de chaque effet de `names`, pour l'onglet « Effets » du panneau d'inspection (cœur
 * de développement seulement) : le réglage principal (`m`), et pour chaque réglage sa règle pour le
 * moteur (cf. µ._mjs_fxNorm) et sa valeur par défaut (`null` : l'effet décide) */
export function devCatalog(names: string[]): Record<string, { m: string, s: Record<string, [unknown[], EffectValue | null]> }> {
  const out: Record<string, { m: string, s: Record<string, [unknown[], EffectValue | null]> }> = {}
  for (const n of names) {
    const fx = EFFECTS[n]
    if (!fx) continue
    const s: Record<string, [unknown[], EffectValue | null]> = {}
    for (const [k, st] of Object.entries(fx.settings)) s[k] = [specOf(st.rule, st.css), st.dflt ?? null]
    out[n] = { m: fx.main, s }
  }
  return out
}

/** les plages des réglages de chaque effet de `names` qu'un réglage `fx` peut nommer (cf. playsOnce) : un nombre borné (`int 0..40`,
 * `float 0.2..5`) ou un texte borné en longueur (`string 0..8`), sous la règle qu'une variable écrite sur la balise reçoit (cf. specOf).
 * Le moteur s'en sert pour un effet donné en objet `{ fx, s }` par une variable (µ._mjs_fxRanges, émise par le constructeur seulement
 * quand une page nomme un effet par une variable) : ses réglages passent les mêmes plages que s'ils étaient écrits sur la balise. Chaque
 * effet qui se nomme y a son entrée, même sans plage (`spin`) : la règle `e` du moteur n'accepte qu'un nom de la table — un effet continu
 * (`magnet`, `particles`) n'y est pas, ses nombres ne passeraient aucune plage */
export function fxRanges(names: string[]): Record<string, Record<string, unknown[]>> {
  const out: Record<string, Record<string, unknown[]>> = {}
  for (const n of names) {
    const fx = EFFECTS[n]
    if (!fx || !playsOnce(fx)) continue
    const plages: Record<string, unknown[]> = out[n] = {}
    for (const [k, st] of Object.entries(fx.settings)) {
      const sp = specOf(st.rule, st.css)
      const bornes = sp[0] === 'i' || sp[0] === 'f' ? sp[1] !== null || sp[2] !== null : (sp[0] === 's' || sp[0] === 'p') && sp.length > 3
      if (bornes) plages[k] = sp
    }
  }
  return out
}

/** la table de fxRanges écrite en JavaScript pour le cœur : chaque objet sans prototype (`"__proto__": null` dans un littéral), le moteur
 * la lit sans garde — un nom hérité d'Object (`constructor`) n'y est jamais une plage */
export function fxRangesSource(names: string[]): string {
  const lit = (o: Record<string, unknown>): string => '{"__proto__":null' + Object.entries(o).map(([k, v]) => ',' + JSON.stringify(k) + ':' + (Array.isArray(v) ? JSON.stringify(v) : lit(v as Record<string, unknown>))).join('') + '}'
  return lit(fxRanges(names))
}

/** un effet qui se joue une fois — une transition, un effet CSS de l'appli, un effet dont `on` connaît
 * load —, hors cycle de vie seul : ce qu'un réglage `fx` peut nommer, écrit ou tenu par une variable */
export function playsOnce(spec: EffectSpec): boolean {
  return !spec.life && (!!spec.transition || !!spec.custom || /'load'/.test(spec.settings.on?.rule ?? ''))
}

// un effet donné en réglage (`fx: *scramble(20)`) : un effet qui se joue une fois (cf. playsOnce), ou
// none ; ses réglages vérifiés comme sur une balise de texte, en valeurs fixes seulement
function effectValue(name: string, key: string, value: string): EffectValue {
  if (value === 'none') return 'none'
  const m = /^\*([A-Za-z][\w-]*)(?:\(([\s\S]*)\))?$/.exec(value)
  if (!m) throw new Error(t('effets.fx-effet', { nom: name, reglage: key, valeur: value }))
  const sub  = m[1]
  const r    = parseEffect(sub, m[2] ?? '')
  const real = r.base ?? sub
  if (Object.keys(r.dynamic).length > 0) throw new Error(t('effets.fx-variable', { nom: name, reglage: key, effet: sub }))
  const spec = effectSpec(real)!
  if (!playsOnce(spec) || real === name) throw new Error(t('effets.fx-une-fois', { nom: name, reglage: key, effet: sub }))
  checkPlacement(real, r, 'span', false)
  return { fx: real, s: r.fixed }
}

/** les effets donnés en réglage (`fx: *scramble`) dans des réglages fixes : leurs noms */
export function nestedEffects(fixed: Record<string, EffectValue>): string[] {
  const out: string[] = []
  for (const v of Object.values(fixed)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof (v as EffectRef).fx === 'string') out.push((v as EffectRef).fx)
  }
  return out
}

// ce que µimage('…') laisse au build : un objet JSON ; on garde l'adresse (chaîne s'il n'y a pas de
// variantes), sinon { src, srcset } — sizes, width et height ne servent pas à un effet
export function imageValue(raw: string): EffectValue | undefined {
  let o: unknown
  try { o = JSON.parse(raw) }
  catch { return undefined }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return undefined
  const { src, srcset } = o as Record<string, unknown>
  if (typeof src !== 'string' || src === '' || src.length > 2000) return undefined
  if (srcset === undefined || srcset === null || srcset === '') return src
  if (typeof srcset !== 'string' || srcset.length > 20000) return undefined
  return { src, srcset }
}

// un µimage('…') que le build n'a pas remplacé (appel hors d'un build, écriture non reconnue)
const IMAGE_CALL = /^(?:µimage|µ\.image|mjsimage|mjs\.image)\s*\(/

// un chemin entre guillemets : sans guillemet ni antislash dedans, sans rien qui ressemble à une expression
const QUOTED_PATH = /^(['"])([^'"\\\n\r{}$µ]+)\1$/
// … ou un mot seul
const BARE_PATH   = /^[^\s'"\\(){}\[\],;<>$µ]+$/
// … et, dans les deux cas, un fichier d'image : son extension le dit. Une variable de boucle (`g.frames`, `item.src`)
// n'en porte pas, ni un texte, un émoji, un dégradé ou `url(…)` donnés à un réglage qui les accepte (`logo`,
// `image` de *pixels) ; une requête ou une ancre après l'extension (`photo.png?v=2`) n'y change rien
const IMAGE_EXT   = /\.(?:apng|avif|bmp|gif|ico|jfif|jpe?g|png|svg|tiff?|webp)(?:[?#][^\s()]*)?$/i

// une valeur qui est une image : un chemin ou une adresse finie par une extension d'image, `url(…)`, une image `data:`, ce que
// µimage laisse au build, ou un appel µimage resté tel quel (refusé ensuite par checkValue)
function isImageValue(raw: string): boolean {
  const value = unquote(raw)
  return IMAGE_CALL.test(raw) || (raw.startsWith('{') && imageValue(raw) !== undefined) || /^url\(/i.test(value) || /^data:image\//i.test(value) || IMAGE_EXT.test(value)
}

// le réglage que prend une valeur écrite sans nom : le premier des réglages `alt` de l'effet dont elle a la forme (cf. EffectSpec),
// sinon le principal ; une variable va au principal
function positionalKey(spec: EffectSpec, raw: string): string {
  for (const k of spec.alt ?? []) {
    const rule = Object.hasOwn(spec.settings, k) ? spec.settings[k].rule : ''
    if (rule === 'image' ? isImageValue(raw) : rule !== '' && !/\$/.test(raw) && checkLiteral(ruleOf(rule), unquote(raw)) !== undefined) return k
  }
  return spec.main
}

// les éléments de `raw` séparés par des virgules (cf. splitArgs), chacun avec sa place dans `raw`
function itemsAt(raw: string): Array<{ text: string, at: number }> {
  let from = 0
  return splitArgs(raw).map(text => {
    const at = raw.indexOf(text, from)
    from = at + text.length
    return { text, at }
  })
}

// le chemin d'un fichier local que `value` écrit (entre guillemets, ou un mot seul), sinon undefined : il finit par
// une extension d'image ; une adresse complète, `data:`, `blob:`, une adresse de la racine, une variable, un appel
// µimage ou µasset ne sont pas des chemins locaux
function localPath(value: string): string | undefined {
  const m    = QUOTED_PATH.exec(value)
  const path = m ? m[2] : BARE_PATH.test(value) ? value : undefined
  return path !== undefined && IMAGE_EXT.test(path) && isResolvableSrc(path) ? path : undefined
}

/** les chemins de fichiers locaux écrits en clair dans les réglages d'image de `*name(raw)` : une valeur d'un réglage
 * `image` (`*behind('photo.jpg')`, `*behind(photo.jpg)`), un élément d'un réglage `images` (`images: [a.jpg, 'b.jpg']`),
 * guillemets ou non, qui finit par une extension d'image. `start` et `end` : la place de la valeur dans `raw`,
 * guillemets compris ; `plain` : l'effet ne lit que l'adresse de ce réglage, pas ses variantes de largeur.
 * C'est la règle du réglage au catalogue qui décide, jamais le nom de l'effet ; le build résout ces chemins
 * comme `µimage('…')` (`µasset('…')` pour un réglage `plain`), cf. transpiler/effect-images.ts. Un mot qui ne finit pas
 * par une extension d'image peut être une variable de boucle (`g.frames`) : il n'est pas touché.
 * Rien ne lève, une faute de réglage est dite par parseEffect */
export function localImages(name: string, raw: string): Array<{ key: string, path: string, start: number, end: number, plain?: boolean }> {
  const out: Array<{ key: string, path: string, start: number, end: number, plain?: boolean }> = []
  const spec = effectSpec(name)
  if (!spec) return out
  let positional = false
  for (const { text, at } of itemsAt(raw)) {
    if (text === '') continue
    const kv = keyValue(text, spec.settings)
    let key: string
    let value: string
    let from: number
    if (kv) {
      key   = kv[0]
      value = kv[1]
      from  = at + text.length - kv[1].length
    }
    else {
      if (positional) continue
      positional = true
      key   = positionalKey(spec, text)
      value = text
      from  = at
    }
    const setting = Object.hasOwn(spec.settings, key) ? spec.settings[key] : undefined
    const rule    = setting?.rule ?? ''
    const plain   = setting?.plain ? { plain: true } : {}
    if (rule === 'image') {
      const path = localPath(value)
      if (path !== undefined) out.push({ key, path, start: from, end: from + value.length, ...plain })
    }
    else if (rule === 'images') {
      const list = /^\[[\s\S]*\]$/.test(value)
      const body = list ? value.slice(1, -1) : value
      for (const item of list ? itemsAt(body) : [{ text: body, at: 0 }]) {
        const path  = localPath(item.text)
        const start = from + (list ? 1 : 0) + item.at
        if (path !== undefined) out.push({ key, path, start, end: start + item.text.length, ...plain })
      }
    }
  }
  return out
}

// un chemin de fichier local tel que parseEffect le rend (sans guillemets) : il finit par une extension d'image
function fixedPath(v: unknown): string | undefined {
  return typeof v === 'string' && !/['"\\\n\r{}$µ]/.test(v) && IMAGE_EXT.test(v) && isResolvableSrc(v) ? v : undefined
}

/** les chemins de fichiers locaux que les réglages fixes d'un effet réglé du fichier `*.effects.mjs`
 * (`*fond = *behind('photo.jpg')`, cf. effects/project.ts) donnent à ses réglages d'image : le réglage, la place du chemin
 * dans la liste d'un réglage `images` (-1 : une image seule), le chemin, et si l'effet ne lit que l'adresse. Le build les
 * résout comme ceux d'un gabarit (cf. Bundler.resolveEffectsImages) */
export function fixedImages(base: string, fixed: Record<string, EffectValue>): Array<{ key: string, index: number, path: string, plain: boolean }> {
  const out: Array<{ key: string, index: number, path: string, plain: boolean }> = []
  const spec = EFFECTS[base]
  if (!spec) return out
  for (const [key, value] of Object.entries(fixed)) {
    const setting = Object.hasOwn(spec.settings, key) ? spec.settings[key] : undefined
    const plain   = !!setting?.plain
    if (setting?.rule === 'image') {
      const path = fixedPath(value)
      if (path !== undefined) out.push({ key, index: -1, path, plain })
    }
    else if (setting?.rule === 'images' && Array.isArray(value)) {
      value.forEach((item, index) => {
        const path = fixedPath(item)
        if (path !== undefined) out.push({ key, index, path, plain })
      })
    }
  }
  return out
}

function checkValue(name: string, key: string, rule: string, raw: string, free = false): EffectValue {
  const value = unquote(raw)
  if (rule === 'image' && IMAGE_CALL.test(raw)) throw new Error(t('effets.image-non-resolue', { nom: name, reglage: key, valeur: raw }))
  if (rule === 'image' && raw.startsWith('{')) {
    const img = imageValue(raw)
    if (img === undefined) throw new Error(t('effets.valeur', { nom: name, reglage: key, valeur: raw, regle: ruleDisplay(rule) }))
    return img
  }
  // une liste d'images donnée par sa seule image (`images: 'photo.png'`, devenue l'objet de µimage) : une liste d'un élément
  if (rule === 'images' && raw.startsWith('{') && imageValue(raw) !== undefined) return [raw]
  if (/^\{[\s\S]*\}$/.test(raw)) throw new Error(t('effets.valeur-calculee', { nom: name, reglage: key }))
  // un effet donné en réglage (`fx: *fade(duration: $d)`) : vérifié d'abord, une variable dans ses réglages a son message
  if (rule === 'effect' && raw.startsWith('*')) return effectValue(name, key, raw)
  if (value === raw && /\$/.test(raw)) throw new Error(t('effets.variable-seule', { nom: name, reglage: key, valeur: raw }))
  let ok: EffectValue | undefined
  if (rule === 'time') ok = TIME_RE.test(value) ? value : undefined
  else if (rule === 'color') ok = value !== '' && COLOR_RE.test(value) ? value : undefined
  else if (rule === 'colors') {
    // une liste `[#f00, #0ff]`, ou une seule couleur
    const items = /^\[[\s\S]*\]$/.test(value) ? splitArgs(value.slice(1, -1)).map(unquote) : [value]
    ok = items.length > 0 && items.every(c => c !== '' && COLOR_RE.test(c)) ? items : undefined
  }
  else if (rule === 'words' || rule === 'images') {
    // une liste `[Coder., 'Designer, web.']`, ou un seul mot
    const items = /^\[[\s\S]*\]$/.test(value) ? splitArgs(value.slice(1, -1)).map(unquote) : [value]
    ok = items.length > 0 && items.every(w => w !== '') ? items : undefined
  }
  else if (rule === 'direction') {
    // un mot, ou un angle de -360 à 360, ramené dans 0..360
    if (DIR_WORDS.includes(value)) ok = value
    else if (/^-?\d+(?:\.\d+)?$/.test(value) && Math.abs(Number(value)) <= 360) ok = ((Number(value) % 360) + 360) % 360
  }
  else if (rule === 'origin' || rule === 'origin-pointer') {
    if (ORIGIN_WORDS.includes(value) || POINT_RE.test(value) || (rule === 'origin-pointer' && value === 'pointer')) ok = value
  }
  else if (rule === 'curve') ok = CURVE_RE.test(value) || BEZIER_RE.test(value) ? value : undefined
  else if (rule === 'length') ok = /^-?\d*\.?\d+$/.test(value) ? Number(value) : LENGTH_RE.test(value) ? value : undefined
  else if (rule === 'range') ok = RANGE_RE.test(value) ? value : undefined
  else if (rule === 'zone') ok = ZONE_RE.test(value) && value.split(' ')[0] !== value.split(' ')[1] ? value : undefined
  else if (rule === 'card-zone') ok = CARD_ZONE_RE.test(value) ? value : undefined
  else if (rule === 'key') ok = /^-?\d+(?:\.\d+)?$/.test(value) ? Number(value) : value !== '' ? value : undefined
  else if (rule === 'css') ok = value !== '' && !/[;{}]/.test(value) && closedCss(value) ? value : undefined
  else if (rule === 'image') {
    if (!free && value.length > 2000) throw new Error(t('effets.image-longue', { nom: name, reglage: key, longueur: String(value.length) }))
    ok = free || value !== '' ? value : undefined
  }
  else if (rule === 'effect') ok = effectValue(name, key, raw)
  else ok = checkLiteral(ruleOf(rule), value)
  // une valeur retirée avant la 3.0 (`*loader(arc)`, `*mesh(aurora)`) : celle qui la remplace
  const retiree = ok === undefined && Object.hasOwn(RETIRED_VALUES, `${name}.${key}.${value}`) ? RETIRED_VALUES[`${name}.${key}.${value}`] : undefined
  if (retiree) throw new Error(t('effets.valeur-retiree', { nom: name, reglage: key, valeur: value, nouveau: retiree[0], note: t(retiree[1]), regle: ruleDisplay(rule) }))
  if (ok === undefined) throw new Error(t('effets.valeur', { nom: name, reglage: key, valeur: value, regle: (rule === 'card-zone' && oldZone(value)) || ruleDisplay(rule) }))
  return ok
}

/** l'erreur d'un effet en direct sans connexion : l'écriture qu'elle propose suit le réglage principal de
 * l'effet — `*follow($$sock)`, `*heatmap(sock: $$sock)`. `written` : le nom écrit, `name` : l'effet posé */
export function sockAbsent(written: string, name = written): string {
  return t('effets.sock-absent', { nom: written, ecriture: effectSpec(name)?.main === 'sock' ? '$$sock' : 'sock: $$sock' })
}

/** un effet en direct (il a `sock`) sans connexion écrite — ni `sock`, ni une adresse (`server`) : il la
 * prend dans `@sock`, que le <script> du composant doit poser (`hasSock`) ; sinon, erreur du build qui
 * dit quoi écrire. `written` : le nom écrit (un effet de l'appli qui règle celui-là) */
export function defaultSock(name: string, written: string, settings: ParsedEffect, hasSock: boolean): void {
  if (!effectSpec(name)?.settings.sock) return
  for (const k of ['sock', 'server']) if (k in settings.fixed || k in settings.dynamic) return
  // un bouton *react passe par la connexion de la scène la plus proche (une balise `stage`, <@document>,
  // parfois dans un composant parent) : @sock s'il est posé, rien sinon — la scène qu'il pose lui-même,
  // faute d'en trouver une, le dit en console
  const bouton = name === 'react' && settings.fixed.stage !== true && !('stage' in settings.dynamic)
  if (!hasSock && bouton) return
  if (!hasSock) throw new Error(sockAbsent(written, name))
  settings.dynamic.sock = '@sock'
  settings.spec.sock    = ['v', '', ruleDisplay('socket')]
}

// le réglage qu'un effet exige (la clé de *shared) : écrit, ou tenu par une variable ; `written` : le nom écrit, quand c'est un
// alias (le message le nomme, et propose de le poser avec la clé)
function checkNeed(name: string, out: ParsedEffect, written = name): void {
  const need = EFFECTS[name]?.need
  if (need && !(need in out.fixed) && !(need in out.dynamic)) throw new Error(t('effets.manque', { nom: written, reglage: need }))
}

/** le message d'un effet que ni la bibliothèque ni l'appli ne connaissent (`*fadee`, `*fadee.lent`), sinon rien : dit avant toute autre faute de la
 * même écriture (un point mal placé, un espace) ; `transition` : sur `@in`, `@out` et `@transition`, un nom éloigné de tout effet peut être celui
 * d'une transition que le script crée (`µanim.create`), il n'est refusé qu'en fin de construction */
export function unknownEffectError(name: string, transition = false): string | null {
  const effet = name.split('.')[0]
  if (EFFECTS[effet] || projectEffect(effet) || projectEffect(name)) return null
  if (transition && nearestEffect(name).distance > 1) return null
  try { parseEffect(name, '') } catch (e) { return (e as Error).message }
  return null
}

// les réglages renommés de la V3 (effet → ancien nom → les noms qui le remplacent) et les effets retirés
// de la bibliothèque : le message dit quoi écrire à la place, au lieu d'un simple « inconnu »
const RENAMED_SETTINGS: Record<string, Record<string, string>> = {
  cursors:   { show: 'cursor, selection, focus' },
  count:     { thousands: 'separator' },
  gradient:  { style: 'pattern' },
  underline: { from: 'origin' },
}
const REMOVED_EFFECTS = new Set(['drop', 'trail'])

// les effets fondus dans un autre avant la 3.0, comme les anciennes animations des transitions, un par entrée : l'alias qui rend le même effet
// (`alias`), le réglage que prenait une valeur écrite sans nom (`main`), ce que devient un ancien réglage qui change (`map` : son nouveau nom, ou
// ses réglages d'après la valeur écrite, null quand elle ne se traduit pas ; un autre réglage garde son nom), l'alias que choisit un style
// (`styles`), les réglages des anciens préréglages livrés (`presets`), la correspondance que dit le message (`note`) et les anciennes variables
// de thème (`vars` : celle qui la remplace, '' s'il n'y en a pas)
interface ReplacedEffect {
  alias: string
  main: string
  note: string
  vars: Record<string, string>
  map?: Record<string, string | ((v: string) => string | null)>
  styles?: [string, Record<string, string>]
  presets?: Record<string, string>
}

// une durée écrite (`500ms`, `1.5s`, `0`), triplée : la pause de l'ancien *wiggle ; null pour une variable
function tripled(v: string): string | null {
  const m = /^(?:0|(\d*\.?\d+)(ms|s))$/.exec(v)
  if (!m) return null
  const ms = m[1] === undefined ? 0 : Number(m[1]) * (m[2] === 's' ? 3000 : 3)
  return ms >= 1000 ? +(ms / 1000).toFixed(3) + 's' : +ms.toFixed(3) + 'ms'
}

const REPLACED_EFFECTS: Record<string, ReplacedEffect> = {
  knockout: { alias: 'gradient.knockout', main: 'image', note: '*knockout($x) → *gradient.knockout(image: $x)', vars: { speed: 'gradient-speed', width: 'gradient-width', outline: 'gradient-outline', colors: 'gradient-colors' } },
  texture:  { alias: 'gradient.texture', main: 'style', map: { style: 'pattern' }, note: 'style → pattern', vars: { speed: 'gradient-speed', colors: 'gradient-colors' } },
  aurora:   { alias: 'mesh.aurora', main: 'colors', note: '*aurora([…]) → *mesh.aurora(colors: […])', vars: { speed: 'mesh-speed', opacity: 'mesh-opacity', blur: 'mesh-blur', colors: 'mesh-colors' } },
  shimmer:  { alias: 'shine.shimmer', main: 'speed', map: { speed: v => `duration: ${v}, every: ${v}`, color: 'ink', shine: 'color' }, note: 'speed: v → duration: v, every: v · color → ink · shine → color', vars: { speed: 'shine-duration', color: 'shine-ink', shine: 'shine-color' } },
  wiggle:   { alias: 'attention.wiggle', main: 'angle', map: { duration: v => tripled(v) === null ? null : `duration: ${v}, every: ${tripled(v)}` }, note: 'duration: d → duration: d, every: 3 × d', vars: { angle: 'attention-angle', duration: 'attention-duration' } },
  typing:   { alias: 'cycle.frame', main: 'words', styles: ['style', { frame: 'cycle.frame', type: 'cycle.typewriter' }], presets: { typewriter: 'style: type' }, note: 'style: type → *cycle.typewriter', vars: { color: 'cycle-color', speed: 'cycle-speed', delay: 'cycle-delay' } },
  lens:     { alias: 'filter.lens', main: 'size', map: { size: v => /^\d+(?:\.\d+)?$/.test(v) ? 'spot: ' + 2 * Math.round(Number(v)) : null }, note: 'size: s → spot: 2 × s', vars: { size: '', blur: '', color: '' } },
}

// les alias livrés retirés avant la 3.0 (trop proches d'un voisin, ou d'un seul réglage) : l'écriture qui les remplace, sans alias — elle
// s'écrit aussi en cible d'un effet du fichier d'effets (`*titre = *focus`)
const RETIRED_ALIASES: Record<string, string> = {
  'focus.blur_others':        '*focus',
  'physics.soft_fall':        '*physics',
  'physics.bouncy_fall':      '*physics(mode: fall, bounce: .65, friction: .2)',
  'behind.soft_depth':        '*behind(depth: 14)',
  'velocity.skew':            '*velocity(style: skew, max: 9)',
  'parallax.forest':          '*parallax(origin: page, speed: .5, smooth: .08)',
  'tilt.slow_follow':         '*tilt(follow: 250ms)',
  'pointer.disc':             '*pointer(style: disc, color: #fff, size: 64, blend: difference, grow: 2)',
  'pointer.sharp_circle':     '*pointer(style: lens, outside: true, filter: blur, size: 200, grow: 1.25)',
  'sticky.floating_bar':      '*sticky(top: 12)',
  'backlight.vivid_glow':     '*backlight(blur: 40, opacity: .7, saturate: 2, size: 1.15)',
  'loader.arc':               '*loader(style: neon)',
  'loader.swirl':             '*loader(style: galaxy)',
  'fly.button_veil':          '*fly(on: hover, direction: up, distance: 30, duration: 300ms, delay: 80ms)',
  'sprite.pixel_six_frames':  '*sprite(frames: 6, speed: 800ms, pixel: true)',
  'sprite.grid_eight_frames': '*sprite(frames: 8, columns: 4, speed: 900ms)',
  'fluid.pure_black':         '*fluid(background: #000)',
  'pixelate.sharpen':         '*pixelate(on: view, duration: 2000ms, easing: linear)',
  'gallery.coverflow':        '*gallery(style: coverflow, on: scroll, loop: true)',
  'spotlight.blue_veil':      '*spotlight(where: veil, color: #0a1a3a, fill: .8, size: 120, soft: 240, on: always, smooth: .3)',
  'lift.purple_glow':         '*lift(color: rgba(192,96,255,.95), blur: 48)',
  'travel.path':              '*travel(zone: 40% 65%)',
  'peel.bottom_left':         '*peel(corner: bottom-left)',
  // l'ancien nom du style blink de *attention (il se confondait avec l'effet *flash), écrit comme un alias
  'attention.flash':          '*attention(style: blink)',
}

// les valeurs retirées d'un réglage avant la 3.0 (`effet.réglage.valeur`) : celle qui la remplace, et ce qu'en dit le message
const RETIRED_VALUES: Record<string, [string, MsgKey]> = {
  'loader.style.arc':      ['neon', 'effets.valeur-meme-dessin'],
  'loader.style.swirl':    ['galaxy', 'effets.valeur-meme-dessin'],
  'mesh.style.aurora':     ['boreal', 'effets.valeur-mesh-aurora'],
  'attention.style.flash': ['blink', 'effets.valeur-attention-flash'],
}

// les réglages `réglage: valeur` d'une écriture, dans l'ordre
function settingsOf(raw: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const item of splitArgs(raw)) {
    const at = item.indexOf(':')
    if (at > 0) out.set(item.slice(0, at).trim(), item.slice(at + 1).trim())
  }
  return out
}

// l'écriture qui remplace un alias livré retiré, les réglages écrits par-dessus ceux de l'ancien alias (`*pointer.disc(size: 32)` garde
// `size: 32`, pas les 64 de l'alias) ; une valeur sans nom va au réglage principal de l'effet (`*travel.path(hero)` → `to: hero`)
function retiredWriting(name: string, raw: string): string {
  const ecrits = splitArgs(raw).filter(item => item !== '')
  if (ecrits.length === 0) return RETIRED_ALIASES[name]
  const m    = /^\*([\w-]+)(?:\(([\s\S]*)\))?$/.exec(RETIRED_ALIASES[name])!
  const spec = EFFECTS[m[1]]
  const tous = settingsOf(m[2] ?? '')
  for (const item of ecrits) {
    const kv = keyValue(item, spec.settings)
    tous.set(kv ? kv[0] : spec.main, (kv ? kv[1] : item).trim())
  }
  return '*' + m[1] + '(' + [...tous].map(([k, v]) => k + ': ' + v).join(', ') + ')'
}

// une valeur traduite hors de la plage du réglage qui la reçoit (`*lens(blur: 55)` → `*filter`, qui s'arrête à 50) : ramenée à la borne,
// notée dans `notes` ; un texte qui n'est pas un nombre, ou une règle sans bornes, passe tel quel
function clampTranslated(st: EffectSetting | undefined, key: string, value: string, notes: string[]): string {
  if (!st || !/^(?:int|float) /.test(st.rule) || !/^-?\d+(?:\.\d+)?$/.test(value)) return value
  const r = ruleOf(st.rule) as { min?: number, max?: number }
  const n = Number(value)
  const b = r.min !== undefined && n < r.min ? r.min : r.max !== undefined && n > r.max ? r.max : n
  if (b === n) return value
  notes.push(`${key}: ${value} → ${b}`)
  return String(b)
}

// l'écriture d'un effet fondu dans un autre (`*shimmer(speed: 1s)` → `*shine.shimmer(duration: 1s, every: 1s)`) : l'alias, les réglages écrits
// traduits (ramenés dans la plage du réglage qui les reçoit : `ramenes`), ceux qui ne se traduisent pas ; `expand` : l'alias écrit avec tous
// ses réglages (`*shine(where: text, …)`), là où un alias ne s'écrit pas (la cible d'un effet du fichier d'effets)
function replacedWriting(name: string, raw: string, expand: boolean): { r: ReplacedEffect, alias: string, ecriture: string, sans: string[], ramenes: string[] } | null {
  const point = name.indexOf('.')
  const old   = point < 0 ? name : name.slice(0, point)
  if (!Object.hasOwn(REPLACED_EFFECTS, old)) return null
  const r      = REPLACED_EFFECTS[old]
  const preset = point < 0 ? '' : name.slice(point + 1)
  // les réglages écrits, par-dessus ceux de l'ancien préréglage ; une valeur sans nom va à l'ancien réglage principal
  const ecrits = new Map<string, string>()
  for (const item of [...(r.presets && Object.hasOwn(r.presets, preset) ? splitArgs(r.presets[preset]) : []), ...splitArgs(raw)]) {
    if (item === '') continue
    const kv = keyValue(item, {})
    ecrits.set(kv ? kv[0] : r.main, (kv ? kv[1] : item).trim())
  }
  let alias = r.alias
  const style = r.styles && ecrits.has(r.styles[0]) ? unquote(ecrits.get(r.styles[0])!) : ''
  if (r.styles && Object.hasOwn(r.styles[1], style)) {
    alias = r.styles[1][style]
    ecrits.delete(r.styles[0])
  }
  const reglages = EFFECTS[alias.split('.')[0]].settings
  const traduits = new Map<string, string>()
  const sans: string[] = []
  const ramenes: string[] = []
  for (const [k, v] of ecrits) {
    const m     = r.map && Object.hasOwn(r.map, k) ? r.map[k] : undefined
    const texte = typeof m === 'function' ? m(v) : m !== undefined ? m + ': ' + v : Object.hasOwn(reglages, k) ? k + ': ' + v : null
    if (texte === null) sans.push(k + ': ' + v)
    else for (const [nk, nv] of settingsOf(texte)) traduits.set(nk, clampTranslated(reglages[nk], nk, nv, ramenes))
  }
  const liste = (m: Map<string, string>) => [...m].map(([k, v]) => k + ': ' + v).join(', ')
  if (!expand) return { r, alias, sans, ramenes, ecriture: '*' + alias + (traduits.size ? '(' + liste(traduits) + ')' : '') }
  const def  = MJS_ALIASES.split('\n').find(l => l.startsWith('*' + alias + ' = '))!
  const base = /^\*([\w-]+)\(([\s\S]*)\)$/.exec(def.slice(def.indexOf(' = ') + 3))!
  const tous = settingsOf(base[2])
  for (const [k, v] of traduits) tous.set(k, v)
  return { r, alias, sans, ramenes, ecriture: '*' + base[1] + '(' + liste(tous) + ')' }
}

// le message d'un effet fondu dans un autre (`*shimmer`, `*typing.typewriter`), sinon null : « le même rendu » sans réglage écrit seulement
function replacedEffectError(name: string, raw: string, expand: boolean): string | null {
  const w = replacedWriting(name, raw, expand)
  if (!w) return null
  const ecrit = splitArgs(raw).some(item => item !== '')
  return t(ecrit ? 'effets.remplace-reglages' : 'effets.remplace', { nom: name, effet: w.ecriture, reglages: t('effets.remplace-correspondance', { liste: w.r.note }) })
    + (w.sans.length > 0 ? t('effets.remplace-sans-equivalent', { alias: '*' + w.alias, liste: w.sans.join(', ') }) : '')
    + (w.ramenes.length > 0 ? t('effets.remplace-ramene', { alias: '*' + w.alias, liste: w.ramenes.join(', ') }) : '')
}

/** le message d'un effet retiré de la bibliothèque, fondu dans un autre, ou d'un alias livré retiré (partout où il est écrit, `<@document>`
 * compris), sinon rien ; `raw` : les réglages écrits, traduits pour un effet fondu ; `expand` : l'écriture sans alias, pour la cible d'un effet
 * du fichier d'effets. Un effet ou un alias de l'appli qui porte ce nom l'emporte */
export function removedEffectError(name: string, raw = '', expand = false): string | null {
  if (EFFECTS[name] || projectEffect(name)) return null
  if (Object.hasOwn(RETIRED_ALIASES, name)) return t('effets.alias-retire', { nom: name, effet: name.split('.')[0], ecriture: retiredWriting(name, raw) })
  const fondu = replacedEffectError(name, raw, expand)
  if (fondu || !REMOVED_EFFECTS.has(name)) return fondu
  try { parseEffect(name, '') } catch (e) { return (e as Error).message }
  return null
}

/** un alias de l'appli rattaché à un effet fondu dans un autre (`*shimmer.lent = *shimmer(speed: 4s)`), sinon null : l'effet qui l'a repris, et
 * la déclaration à écrire (`*shine.lent = *shine(…)`, réglages traduits quand la cible est l'ancien effet) */
export function replacedAlias(effet: string, alias: string, cible: string, args: string): { nouveau: string, ecriture: string } | null {
  if (EFFECTS[effet] || !Object.hasOwn(REPLACED_EFFECTS, effet)) return null
  const w       = cible === effet ? replacedWriting(effet, args, true) : null
  const nouveau = (w ? w.alias : REPLACED_EFFECTS[effet].alias).split('.')[0]
  const droite  = w ? w.ecriture : cible === nouveau ? '*' + cible + (args ? '(' + args + ')' : '') : '*' + nouveau + '(…)'
  return { nouveau, ecriture: `*${nouveau}.${alias} = ${droite}` }
}

/** une variable de thème d'un effet fondu dans un autre (`shimmer-color`, écrite sans `$$`) : l'effet, l'alias qui l'a repris, et la variable
 * qui la remplace (`shine-ink` ; '' s'il n'y en a pas) ; undefined pour tout autre nom */
export function replacedThemeVar(name: string): { effet: string, alias: string, nouveau: string } | undefined {
  const at    = name.indexOf('-')
  const effet = name.slice(0, at)
  if (at < 0 || !Object.hasOwn(REPLACED_EFFECTS, effet) || !Object.hasOwn(REPLACED_EFFECTS[effet].vars, name.slice(at + 1))) return undefined
  return { effet, alias: '*' + REPLACED_EFFECTS[effet].alias, nouveau: REPLACED_EFFECTS[effet].vars[name.slice(at + 1)] }
}

/** les réglages écrits entre les parenthèses de `*nom(…)`, vérifiés et convertis ; `scope` : les
 * variables d'une boucle englobante (`{for item in $liste}` → `item`), qu'un réglage peut lire
 * (`*crossfade(key: item.id)`) ; `partial` : une partie des réglages seulement (un effet réglé du
 * fichier *.effects.mjs, complété à la pose) — le réglage exigé peut y manquer */
export function parseEffect(name: string, raw: string, scope: string[] = [], partial = false): ParsedEffect {
  const proj = EFFECTS[name] ? undefined : projectEffect(name)
  // un effet de l'appli qui en règle un de la bibliothèque : ses réglages d'abord, ceux écrits à la
  // pose l'emportent
  if (proj?.base) {
    const base  = proj.base
    const r     = asWritten(name, base, () => parseEffect(base, raw, scope, true))
    const fixed = { ...proj.fixed }
    for (const k of Object.keys(r.dynamic)) delete fixed[k]
    const out: ParsedEffect = { fixed: { ...fixed, ...r.fixed }, dynamic: r.dynamic, spec: r.spec, base }
    if (r.uses) out.uses = r.uses
    if (!partial) checkNeed(base, out, name)
    return out
  }
  const spec = EFFECTS[name] ?? (proj ? customSpec(proj) : undefined)
  if (!spec) {
    // `*filter.inconnu` : l'effet existe, pas cet alias ; `*filter.Net` : ce nom-là ne peut être celui d'aucun alias
    const point = name.indexOf('.')
    if (point > 0 && EFFECTS[name.slice(0, point)]) {
      const effet = name.slice(0, point)
      // un alias livré retiré avant la 3.0 : l'écriture qui le remplace
      if (Object.hasOwn(RETIRED_ALIASES, name)) throw new Error(t('effets.alias-retire', { nom: name, effet, ecriture: retiredWriting(name, raw) }))
      const liste = Object.keys(projet()).filter(n => n.startsWith(effet + '.')).sort().map(n => '*' + n).join(', ')
      throw new Error(t(ALIAS_NAME.test(name.slice(point + 1)) ? 'effets.alias-inconnu' : 'effets.alias-nom', { nom: name, effet, liste: liste || '—', exemple: aliasExample(effet) }))
    }
    // la suggestion cherche aussi parmi les alias (`*fliter.frosted_glass` → `*filter.frosted_glass`) ; la liste ne donne que les effets, ceux
    // de la bibliothèque et ceux de l'appli : les alias se listent dans l'erreur d'alias inconnu, pour l'effet concerné seulement
    const names = [...Object.keys(EFFECTS), ...Object.keys(projet())].sort()
    let best = ''
    let dist = Infinity
    for (const n of names) {
      const d = levenshtein(name, n)
      if (d < dist) { dist = d; best = n }
    }
    const hint  = dist <= 2 ? t('effets.suggestion', { nom: best }) : ''
    const liste = names.filter(n => !n.includes('.')).map(n => '*' + n).join(', ')
    if (REMOVED_EFFECTS.has(name)) throw new Error(t('effets.retire', { nom: name, liste }))
    const fondu = replacedEffectError(name, raw, false)
    if (fondu) throw new Error(fondu)
    throw new Error(t('effets.inconnu', { nom: name, liste }) + hint)
  }
  const out: ParsedEffect = { fixed: {}, dynamic: {}, spec: {} }
  let positional = false
  for (const item of splitArgs(raw)) {
    if (item === '') continue
    const kv = keyValue(item, spec.settings)
    let key: string
    let value: string
    if (kv) {
      key = kv[0]
      value = kv[1].trim()
    }
    else {
      if (positional) throw new Error(t('effets.positionnel', { nom: name, principal: spec.main }))
      positional = true
      key = positionalKey(spec, item)
      value = item
    }
    const setting = spec.settings[key]
    if (!setting) {
      // propres à la table seulement : `constructor`, `toString`… viennent d'Object, pas d'un ancien nom
      const nouveau = Object.hasOwn(RENAMED_SETTINGS, name) && Object.hasOwn(RENAMED_SETTINGS[name], key) ? RENAMED_SETTINGS[name][key] : undefined
      throw new Error(t('effets.reglage-inconnu', { nom: name, reglage: key, liste: Object.keys(spec.settings).join(', ') }) + (nouveau ? t('effets.reglage-renomme', { reglage: key, nouveau }) : ''))
    }
    if (key in out.fixed || key in out.dynamic) throw new Error(t('effets.double', { nom: name, reglage: key }))
    // la connexion : une variable, suivie (un store qui reçoit une nouvelle connexion relance l'effet)
    if (setting.rule === 'socket') {
      if (!SOCK_RE.test(value)) throw new Error(t('effets.sock-variable', { nom: name, valeur: value }))
      out.dynamic[key] = value
      out.spec[key]    = ['v', value, ruleDisplay('socket')]
      continue
    }
    if (VAR_RE.test(value) || isScoped(value, scope)) {
      out.dynamic[key] = value
      out.spec[key]    = specOf(setting.rule, setting.css)
    }
    else {
      out.fixed[key] = checkValue(name, key, setting.rule, value, setting.free)
      const sub = setting.rule === 'effect' ? /^\*([A-Za-z][\w-]*)/.exec(unquote(value)) : null
      if (sub && projectEffect(sub[1])) (out.uses ??= []).push(sub[1])
    }
  }
  if (!partial) checkNeed(name, out)
  if (proj) out.custom = proj
  return out
}

// balises qui n'affichent rien elles-mêmes
const NO_BOX = new Set(['slot', 'template'])
// balises dont le contenu ne s'affiche pas : un effet qui dessine DANS sa balise n'y serait jamais vu
const NO_CONTENT = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr', 'iframe', 'video', 'audio', 'canvas', 'object', 'select', 'textarea', 'option', 'optgroup', 'svg', 'math'])

// les champs, où se pose un effet de champ (*guard)
const FIELDS = new Set(['input', 'textarea', 'select'])

// la balise telle que l'auteur l'a écrite : `<@card>`, `<@@select>`, `<@view>`
function tagDisplay(tag: string): string {
  if (tag === 'metamjs-view') return '@view'
  if (tag.startsWith('mjs-core-')) return '@@' + tag.slice(9)
  if (tag.startsWith('mjs-')) return '@' + tag.slice(4)
  return tag
}

/** la balise peut-elle porter cet effet (réglages compris) ? erreur de compilation sinon ; un
 * réglage tenu par une variable compte comme allumé. Sur un composant, tout passe : le moteur
 * dessine dans le composant lui-même. `written` : le nom écrit, quand c'est un alias (les messages le nomment) */
export function checkPlacement(name: string, settings: ParsedEffect, tag: string, foreign: boolean, written = name): void {
  const spec  = effectSpec(name)!
  const lower = tag.toLowerCase()
  if (spec.life) throw new Error(t('transitions.cycle-seul', { nom: written }))
  if (NO_BOX.has(lower)) throw new Error(t('effets.balise', { nom: written, balise: lower }))
  // une transition anime la balise elle-même : un tracé SVG aussi (*draw ne va que là)
  if (foreign && !spec.transition) throw new Error(t('effets.svg', { nom: written, balise: tag }))
  // un réglage écrit à sa valeur « sans texte » (`unit: child`) : l'effet n'a pas à lire le texte de la balise
  const free = Object.keys(spec.settings).some(k => spec.settings[k].textless !== undefined && settings.fixed[k] === spec.settings[k].textless)
  if (spec.text && !free && (NO_CONTENT.has(lower) || lower.includes('-'))) throw new Error(t('effets.texte', { nom: written, balise: tagDisplay(lower) }))
  if (spec.field && !FIELDS.has(lower)) throw new Error(t('effets.champ', { nom: written, balise: tagDisplay(lower) }))
  const on   = (k: string) => settings.fixed[k] === true || k in settings.dynamic
  const key  = Object.keys(spec.settings).find(k => spec.settings[k].inside && on(k))
  const quoi = spec.inside ? `*${written}` : key ? `*${written}(${key}: true)` : ''
  if (!quoi) return
  if (NO_CONTENT.has(lower)) throw new Error(t('effets.contenu', { quoi, balise: lower }))
}

// les réglages que l'auteur a écrits entre les parenthèses de la pose (un alias en porte d'autres, les siens) ; une valeur sans nom
// porte le réglage principal de `spec`
function writtenKeys(raw: string, spec: EffectSpec): Set<string> {
  const keys = new Set<string>()
  for (const item of splitArgs(raw)) {
    if (item === '') continue
    keys.add(keyValue(item, spec.settings)?.[0] ?? spec.main)
  }
  return keys
}

/** la directive d'une transition (`in`, `out`, `transition`) peut-elle porter cet effet ? Une
 * transition, oui ; un autre effet, s'il sait se jouer une fois (son `on` connaît `load`) ; le
 * déclencheur est la directive elle-même : `on`, `once`, `range`, `zone` n'y ont pas de sens. `raw` : les réglages
 * écrits à la pose — un déclencheur que l'alias porte (`*fly.spin_in` est `on: view`), sans que l'auteur l'ait écrit,
 * a son message : il n'y a rien à retirer, c'est l'alias qui ne convient pas après la directive */
export function checkLife(name: string, settings: ParsedEffect, directive: string, raw = ''): void {
  const spec  = effectSpec(name)!
  const alias = projectEffect(name)?.fixed
  for (const k of ['on', 'once', 'range', 'zone']) {
    if (!(k in settings.fixed || k in settings.dynamic)) continue
    if (alias && k in alias && !writtenKeys(raw, spec).has(k)) throw new Error(t('transitions.declencheur-alias', { nom: name, reglage: k, valeur: String(alias[k]), directive: '@' + directive }))
    throw new Error(t('transitions.declencheur', { nom: name, reglage: k, directive: '@' + directive }))
  }
  if (spec.transition || spec.custom) return
  const on = spec.settings.on
  if (!on || !/'load'/.test(on.rule)) throw new Error(t('transitions.continu', { nom: name, directive: '@' + directive }))
}

/** le nom le plus proche d'un effet du catalogue, et sa distance — deux lettres interverties comptent
 * pour une faute (`fdae` → `fade`), comme une lettre en trop, en moins ou changée */
export function nearestEffect(name: string): { nom: string, distance: number } {
  let nom = ''
  let distance = Infinity
  for (const n of Object.keys(EFFECTS)) {
    const d = typoDistance(name, n)
    if (d < distance) { distance = d; nom = n }
  }
  return { nom, distance }
}

// la distance entre deux noms : une lettre en trop, en moins ou changée compte pour une, deux lettres interverties aussi
export function typoDistance(a: string, b: string): number {
  const d: number[][] = []
  for (let i = 0; i <= a.length; i++) d[i] = [i]
  for (let j = 0; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cout = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cout)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  return d[a.length][b.length]
}
