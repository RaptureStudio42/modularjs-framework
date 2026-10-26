// bundler/core-chart — <@@chart> : ce que la balise écrit en dur se vérifie au build. Un mot inconnu de `shape`, `stats`, `step`, `axis`,
// `toolbar` ou `shapes`, une couleur de série refusée ou que le navigateur ne saurait pas lire, une combinaison impossible (des statistiques sur des barres empilées, un anneau,
// une carte, un radar ou un calendrier, la tendance sur un histogramme ; un pas d'un an ou
// un axe qui n'est pas une date sur un calendrier ; un radar de moins de 3 lignes), un fuseau (`timezone`) qui n'est ni local ni une zone
// connue d'Intl, une précision (`decimals`) qui n'est pas un entier de 0 à 10 arrêtent la construction : la faute est dans le code,
// la page ne part pas avec. Une valeur calculée passe : le module la vérifie à l'exécution (µ.error, puis la valeur par défaut).
// Les listes sont celles du module (src/core-modules/chart.mjs) et de sa couche de calcul (src/runtime/mjs_chart.ts) ;
// tests/core-graphique-erreurs-construction.test.ts les compare.

import type { TagRefAttrs } from '../parser/index.js'
import { t } from '../messages/index.js'

const SHAPES = ['line', 'area', 'dots', 'bar', 'stack', 'histogram', 'pie', 'heatmap', 'radar', 'calendar']

/** les mots permis de chaque attribut, dans l'ordre du module ; `shapes` (les formes du menu de la barre) prend ceux de `shape` */
export const CHART_WORDS: Readonly<Record<'shape' | 'stats' | 'step' | 'axis' | 'toolbar' | 'shapes', readonly string[]>> = {
  shape:   SHAPES,
  stats:   ['mean', 'median', 'q1', 'q3', 'trend'],
  step:    ['auto', 'day', 'week', 'month', 'year'],
  axis:    ['date', 'datetime', 'number', 'category'],
  toolbar: ['legend', 'shapes', 'stats', 'step'],
  shapes:  SHAPES,
}

/** les noms des six teintes du thème : `color: 'green'` vaut `color: 3` */
export const CHART_HUES: readonly string[] = ['blue', 'orange', 'green', 'pink', 'violet', 'gold']

/**
 * une couleur de l'auteur part telle quelle tant qu'elle ne peut rien écrire d'autre qu'une valeur : ni « ; », ni « : », ni guillemet, ni
 * accolade, ni « < » ou « > », ni « \ », ni « /* », ni url(…) ; `oklch(from var(--marque) calc(l * 0.8) c h)` passe
 */
export const CHART_SAFE_COLOR = /^(?![\s\S]*(?:url\s*\(|\/\*))[^;:\x22\x27\x60\{\}<>\\]+$/i

/** les couleurs nommées du CSS, `currentcolor` et `transparent` compris, et les couleurs du système (les anciennes aussi : le navigateur les lit encore) */
const CSS_NAMED = new Set(('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen ' +
  'currentcolor transparent accentcolor accentcolortext activetext buttonborder buttonface buttontext canvas canvastext field fieldtext graytext highlight highlighttext linktext mark marktext selecteditem selecteditemtext visitedtext ' +
  'activeborder activecaption appworkspace background buttonhighlight buttonshadow captiontext inactiveborder inactivecaption inactivecaptiontext infobackground infotext menu menutext scrollbar threeddarkshadow threedface threedhighlight threedlightshadow threedshadow window windowframe windowtext').split(' '))

/** les fonctions de couleur du CSS ; `var(…)` aussi, sa valeur se lit dans le thème */
const COLOR_FUNCTIONS = ['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color', 'color-mix', 'light-dark', 'var']

/** vrai quand la parenthèse ouverte à `open` se ferme sur le dernier signe : le texte n'est qu'un appel de fonction */
function closesAtEnd(s: string, open: number): boolean {
  let depth = 0
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') depth++
    else if (s[i] === ')' && --depth === 0) return i === s.length - 1
  }
  return false
}

/**
 * Une couleur écrite que le navigateur ne saurait pas lire, à coup sûr : un nombre en toute écriture (`'0'`, `'1.5'`, `'1e-7'` à exposant :
 * un numéro de teinte est un entier de 1 ou plus, reconnu avant, comme au module) et tout ce qui commence par un chiffre (`'0x10'`, `'12px'`),
 * « . », « + » ou un « - » sans lettre derrière — la règle du module (`readable`, src/core-modules/chart.mjs), la même au serveur et au
 * navigateur —, un mot nu qui n'est ni une teinte du thème ni une couleur nommée du CSS (`'bleu'`), un # sans 3,
 * 4, 6 ou 8 chiffres hexadécimaux, un appel d'une fonction qui n'est pas de couleur. Dans le doute (deux mots, un mot préfixé par un moteur,
 * une fonction suivie d'autre chose), rien n'est refusé : le module la vérifie à l'exécution.
 */
export function unknownColor(color: string): boolean {
  if (/^[\d.+]|^-(?![a-z])/i.test(color)) return true
  if (/^[a-z][a-z0-9-]*$/i.test(color)) return !CHART_HUES.includes(color.toLowerCase()) && !CSS_NAMED.has(color.toLowerCase())
  if (color[0] === '#') return !/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)
  const fn = /^([a-z][a-z-]*)\(/i.exec(color)
  return !!fn && closesAtEnd(color, fn[0].length - 1) && !COLOR_FUNCTIONS.includes(fn[1].toLowerCase())
}

/** les formes qui tracent des statistiques, celles qui tracent aussi la tendance (dites dans le message), dans l'ordre du module */
export const CHART_STATS_SHAPES: readonly string[] = ['line', 'area', 'dots', 'bar', 'histogram']
export const CHART_TREND_SHAPES: readonly string[] = ['line', 'area', 'dots', 'bar']

/** un calendrier se compte par jour, par semaine ou par mois, sur des dates */
const CALENDAR = { step: ['auto', 'day', 'week', 'month'], axis: ['date', 'datetime'] }

const wordsOf = (text: string): string[] => text.split(/[\s,]+/).filter(Boolean)

/** vrai quand Intl connaît la zone (`Europe/Paris`, `UTC`) */
function knownZone(zone: string): boolean {
  try {
    return new Intl.DateTimeFormat('en', { timeZone: zone }).resolvedOptions().timeZone !== ''
  }
  catch {
    return false
  }
}

/**
 * une précision permise : un entier de 0 à 10, le nombre de chiffres après la virgule, comme le lit le module — écrite en texte, en chiffres
 * seuls (`decimals="2"`) ; écrite en nombre, sa valeur (`decimals={2.0}` vaut 2)
 */
const placesOk = (text: string): boolean => /^\d+$/.test(text) && Number(text) <= 10
const placesValueOk = (text: string): boolean => Number.isInteger(Number(text)) && Number(text) >= 0 && Number(text) <= 10

/**
 * Les couleurs écrites dans `series={…}` : la valeur de chaque clé `color` (nue ou entre guillemets) qui est un texte ou un nombre écrit, lue hors des
 * chaînes (le nom d'une série qui contient « color: 'x;y' » n'en pose aucune). Dans le doute, rien : une interpolation (`#{…}`, `${…}`),
 * un texte qui s'échappe ou qui ne se ferme pas — le module la vérifie à l'exécution.
 */
export function writtenColors(expr: string): string[] {
  const out: string[] = []
  if (/\$\{|#\{/.test(expr)) return out
  const toks: { kind: 'text' | 'word' | 'sign', value: string, sure: boolean }[] = []
  for (let i = 0; i < expr.length;) {
    const c = expr[i]
    if (c === '"' || c === '\'' || c === '`') {
      let j    = i + 1
      let sure = true
      while (j < expr.length && expr[j] !== c) {
        if (expr[j] === '\\') {
          sure = false
          j++
        }
        j++
      }
      if (j >= expr.length) return out
      toks.push({ kind: 'text', value: expr.slice(i + 1, j), sure })
      i = j + 1
    }
    else if (/[\w$]/.test(c)) {
      let j = i
      while (j < expr.length && /[\w$]/.test(expr[j])) j++
      toks.push({ kind: 'word', value: expr.slice(i, j), sure: true })
      i = j
    }
    else {
      if (!/\s/.test(c)) toks.push({ kind: 'sign', value: c, sure: true })
      i++
    }
  }
  // une clé `color` : en tête d'objet ou après une virgule, suivie de « : » puis d'un texte sûr, ou d'un nombre écrit seul, lu comme le module
  // le lit (`color: 1.0` vaut « 1 », `color: -0` vaut « 0 ») ; un nombre suivi d'autre chose (`0 || 2`, `1 + 1`) n'est pas relevé
  for (let k = 0; k + 2 < toks.length; k++) {
    const before = toks[k - 1]
    const value  = toks[k + 2]
    if (toks[k].value !== 'color' || toks[k].kind === 'sign') continue
    if (before && !(before.kind === 'sign' && (before.value === '{' || before.value === ','))) continue
    const bare = value.kind === 'text' ? null : /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?=[,}]|$)/i.exec(toks.slice(k + 2, k + 9).map((x) => x.value).join(''))
    if (toks[k + 1].kind === 'sign' && toks[k + 1].value === ':' && (bare || (value.kind === 'text' && value.sure))) out.push(bare ? String(Number(bare[0])) : value.value)
  }
  return out
}

/**
 * Le nombre de lignes d'un tableau écrit en dur (`rows={[{…}, {…}]}`) ; null quand l'expression n'en est pas un : une variable, un appel,
 * un étalement, un élément qui n'est pas un objet écrit, deux éléments sans virgule — le build ne compte que ce qu'il lit à coup sûr.
 */
export function writtenRows(expr: string): number | null {
  const s = expr.trim()
  if (s[0] !== '[' || s[s.length - 1] !== ']') return null
  let depth = 0
  let count = 0
  let open  = false
  let done  = false
  let quote = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = ''
      continue
    }
    if (depth === 1 && !/[\s,\]]/.test(c)) {
      if (open) {
        if (done) return null
      }
      else {
        if (c !== '{') return null
        open  = true
        done  = false
        count++
      }
    }
    if (c === '"' || c === '\'' || c === '`') quote = c
    else if (c === '[' || c === '{' || c === '(') depth++
    else if (c === ']' || c === '}' || c === ')') {
      depth--
      if (depth === 1 && c === '}') done = true
      if (depth === 0 && i !== s.length - 1) return null
    }
    else if (c === ',' && depth === 1) open = false
  }
  return depth === 0 && !quote ? count : null
}

/**
 * Les fautes écrites en dur sur une référence à <@@chart> (`<@@chart>` ou `<mjs-core-chart>`), un message de build par faute. Les mots se
 * vérifient toujours ; une combinaison seulement quand ses deux côtés sont écrits et qu'aucun étalement `{...p}` ne peut poser l'autre.
 */
export function chartProblems(ref: { file: string, kind: string, attrs?: TagRefAttrs }): string[] {
  const attrs = ref.attrs
  if (!attrs?.texts) return []
  const texts  = attrs.texts
  const tag    = ref.kind === 'litteral-coeur' ? 'mjs-core-chart' : '@@chart'
  const out: string[] = []
  const said   = (name: string): string | null => typeof texts[name] === 'string' ? texts[name]!.trim() : null
  const stats  = said('stats')
  const marks  = stats ? wordsOf(stats) : []
  for (const name of ['shape', 'step', 'axis'] as const) {
    const word = said(name)
    if (word && !CHART_WORDS[name].includes(word)) out.push(t('bundler.index.chart-mot-inconnu', { fichier: ref.file, tag, attribut: name, valeur: texts[name]!, mot: word, connus: CHART_WORDS[name].join(' ') }))
  }
  // les listes de mots : les statistiques, les outils de la barre, les formes de son menu
  for (const name of ['stats', 'toolbar', 'shapes'] as const) {
    const text = said(name)
    for (const word of text ? wordsOf(text) : []) {
      if (!CHART_WORDS[name].includes(word)) out.push(t('bundler.index.chart-mot-inconnu', { fichier: ref.file, tag, attribut: name, valeur: texts[name]!, mot: word, connus: CHART_WORDS[name].join(' ') }))
    }
  }
  for (const raw of writtenColors(attrs.exprs?.series ?? '')) {
    const color = raw.trim()
    if (color === '' || CHART_HUES.includes(color.toLowerCase()) || (/^\d+$/.test(color) && Number(color) > 0) || (CHART_SAFE_COLOR.test(color) && !unknownColor(color))) continue
    out.push(t('bundler.index.chart-couleur-refusee', { fichier: ref.file, tag, couleur: color, teintes: CHART_HUES.join(' ') }))
  }
  // le fuseau des heures : local, ou une zone qu'Intl connaît ; la précision, écrite en texte (`decimals="2"`) ou en nombre (`decimals={2}`) :
  // une autre expression se vérifie à l'exécution
  const zone = said('timezone')
  if (zone && zone !== 'local' && !knownZone(zone)) out.push(t('bundler.index.chart-fuseau-inconnu', { fichier: ref.file, tag, valeur: zone }))
  const places = said('decimals')
  const nombre = attrs.exprs?.decimals?.trim()
  if (places && !placesOk(places)) out.push(t('bundler.index.chart-decimales', { fichier: ref.file, tag, ecrit: `decimals="${texts.decimals}"`, valeur: places }))
  else if (nombre !== undefined && /^[+-]?\d+(?:\.\d*)?$/.test(nombre) && !placesValueOk(nombre)) out.push(t('bundler.index.chart-decimales', { fichier: ref.file, tag, ecrit: `decimals={${nombre}}`, valeur: nombre }))
  const shape = said('shape')
  if (!shape || attrs.spread) return out
  // des statistiques sur une forme qui n'en trace pas (tous les mots, connus ou non : elle n'en veut aucun), la tendance sur une forme qui trace
  // les autres sans elle
  const wrong = CHART_WORDS.shape.includes(shape) ? marks.filter((m) => !CHART_STATS_SHAPES.includes(shape) || (m === 'trend' && !CHART_TREND_SHAPES.includes(shape))) : []
  if (wrong.length) out.push(t('bundler.index.chart-sans-statistiques', { fichier: ref.file, tag, forme: shape, valeur: texts.stats!, mots: wrong.join(' '), formes: CHART_STATS_SHAPES.join(' '), tendance: CHART_TREND_SHAPES.join(' ') }))
  if (shape === 'calendar') {
    for (const name of ['step', 'axis'] as const) {
      const word = said(name)
      if (word && CHART_WORDS[name].includes(word) && !CALENDAR[name].includes(word)) out.push(t('bundler.index.chart-combinaison', { fichier: ref.file, tag, forme: shape, attribut: name, valeur: word, connus: CALENDAR[name].join(' ') }))
    }
  }
  const rows = attrs.exprs?.rows
  const n    = shape === 'radar' && rows !== undefined ? writtenRows(rows) : null
  if (n !== null && n > 0 && n < 3) out.push(t('bundler.index.chart-radar-axes', { fichier: ref.file, tag, nb: n }))
  return out
}
