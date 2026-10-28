// bundler/core-chart — <@@chart> : ce que la balise écrit en dur se vérifie au build. Un mot inconnu de `shape`, `stats`, `step`, `axis`,
// `toolbar` ou `shapes`, une couleur de série refusée ou que le navigateur ne saurait pas lire, une combinaison impossible (des statistiques sur des barres empilées, un anneau,
// une carte, un radar ou un calendrier, la tendance sur un histogramme ; un pas d'un an ou
// un axe qui n'est pas une date sur un calendrier ; un radar de moins de 3 lignes), un fuseau (`timezone`) qui n'est ni local ni une zone
// connue d'Intl, une précision (`decimals`) qui n'est pas un entier de 0 à 10, l'axe d'une série écrite (`axis` dans `series`) qui n'est ni
// `left` ni `right` arrêtent la construction : la faute est dans le code,
// la page ne part pas avec. Une valeur calculée passe : le module la vérifie à l'exécution (µ.error, puis la valeur par défaut).
// Une série écrite `axis: 'right'` sur une forme écrite qui n'a qu'une échelle n'est pas une faute : le module l'ignore et le dit en
// développement (µ.warn), la construction le dit aussi, par un avertissement (chartWarnings).
// Les listes sont celles du module (src/core-modules/chart.mjs) et de sa couche de calcul (src/runtime/mjs_chart.ts) ;
// tests/core-graphique-erreurs-construction.test.ts et tests/core-graphique-axe-droite-construction.test.ts les comparent.

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

/** l'axe d'une série (`series={[{ key, axis }]}`) : son échelle, à gauche (défaut) ou à droite */
export const CHART_SERIES_AXES: readonly string[] = ['left', 'right']

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

/** les formes à deux échelles : une série `axis: 'right'` y prend la sienne, graduée à droite ; les autres n'en ont qu'une, ou aucune */
export const CHART_TWIN_SHAPES: readonly string[] = ['line', 'area', 'dots', 'bar']

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

// `line` : un saut de ligne précède le jeton (dans un commentaire compris) ; `indent` : le retrait de sa ligne, vide sur la première (l'expression se
// compile entre parenthèses, sa première ligne n'a pas de retrait)
type Token = { kind: 'text' | 'word' | 'sign', value: string, sure: boolean, line: boolean, indent: string }

/**
 * Les jetons d'une expression écrite, lus hors des chaînes et des commentaires, de ligne (`// …`) comme de bloc : ses textes (`sure` faux quand un échappement
 * s'y trouve), ses mots et ses signes, chacun avec sa place dans les lignes. Null quand le build n'y lit rien à coup sûr : une interpolation
 * (`#{…}`, `${…}`), un texte ou un commentaire qui ne se ferme pas. `#` n'ouvre pas de commentaire : l'expression est du Civet, où il vaut `this.length`
 */
function tokensOf(expr: string): Token[] | null {
  if (/\$\{|#\{/.test(expr)) return null
  const toks: Token[] = []
  let line = false
  const push = (kind: Token['kind'], value: string, sure: boolean, at: number): void => {
    const start = expr.lastIndexOf('\n', at - 1) + 1
    toks.push({ kind, value, sure, line, indent: start === 0 ? '' : /^[ \t]*/.exec(expr.slice(start))![0] })
    line = false
  }
  for (let i = 0; i < expr.length;) {
    const c = expr[i]
    if (expr.startsWith('//', i)) {
      const end = expr.indexOf('\n', i)
      i = end < 0 ? expr.length : end
    }
    else if (expr.startsWith('/*', i)) {
      const end = expr.indexOf('*/', i + 2)
      if (end < 0) return null
      if (expr.slice(i, end).includes('\n')) line = true
      i = end + 2
    }
    else if (c === '"' || c === '\'' || c === '`') {
      let j    = i + 1
      let sure = true
      while (j < expr.length && expr[j] !== c) {
        if (expr[j] === '\\') {
          sure = false
          j++
        }
        j++
      }
      if (j >= expr.length) return null
      push('text', expr.slice(i + 1, j), sure, i)
      i = j + 1
    }
    else if (/[\w$]/.test(c)) {
      let j = i
      while (j < expr.length && /[\w$]/.test(expr[j])) j++
      push('word', expr.slice(i, j), true, i)
      i = j
    }
    else {
      if (c === '\n') line = true
      else if (!/\s/.test(c)) push('sign', c, true, i)
      i++
    }
  }
  return toks
}

/**
 * Les valeurs d'une clé (`color`, `axis`) écrites dans `series={…}` : la valeur de chaque clé `key` (nue ou entre guillemets) qui est un texte ou un
 * nombre écrit seul, lue hors des chaînes (le nom d'une série qui contient « color: 'x;y' » n'en pose aucune). Dans le doute, rien : une interpolation
 * (`#{…}`, `${…}`), un texte qui s'échappe ou qui ne se ferme pas, une valeur calculée qui commence par un texte (`'x' == $mode ? 'right' : 'left'`,
 * `'bleu' + $nuance`) — le module la vérifie à l'exécution.
 */
function writtenValues(expr: string, key: string): string[] {
  const out: string[] = []
  const toks = tokensOf(expr)
  if (!toks) return out
  // la valeur finie au jeton `j - 1` est-elle écrite seule : rien derrière, une virgule, une accolade fermante (un commentaire ne compte pas), ou
  // la clé suivante (un mot ou un texte sûr suivi de « : ») en tête de la ligne suivante, au retrait de la ligne de la valeur — Civet y pose la
  // virgule ; plus en retrait, il en fait un appel (`'droite'({ color: 'red' })`)
  const alone = (j: number): boolean => {
    const next = toks[j]
    if (!next || (next.kind === 'sign' && (next.value === ',' || next.value === '}'))) return true
    return next.line && next.indent === toks[j - 1].indent && (next.kind === 'word' || (next.kind === 'text' && next.sure)) && isSign(toks[j + 1], ':')
  }
  // la clé : en tête d'objet ou après une virgule, suivie de « : » puis d'un texte sûr ou d'un nombre écrits seuls (cf. alone), le nombre lu
  // comme le module le lit (`color: 1.0` vaut « 1 », `color: -0` vaut « 0 ») ; une valeur suivie d'autre chose (`'droite' + $s`, `'gauche' if
  // $vrai`, `0 || 2`, `1 + 1`, une ligne qui continue l'expression : `.trim()`, `+ $s`, `and $v`) n'est pas relevée
  for (let k = 0; k + 2 < toks.length; k++) {
    const before = toks[k - 1]
    const value  = toks[k + 2]
    if (toks[k].value !== key || toks[k].kind === 'sign' || !isSign(toks[k + 1], ':')) continue
    if (before && !(before.kind === 'sign' && (before.value === '{' || before.value === ','))) continue
    if (value.kind === 'text') {
      if (value.sure && alone(k + 3)) out.push(value.value)
      continue
    }
    // un nombre : ses jetons (signe, chiffres, point, exposant) joints
    for (let j = k + 3; j <= Math.min(k + 9, toks.length); j++) {
      const text = toks.slice(k + 2, j).map((x) => x.value).join('')
      if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text) && alone(j)) {
        out.push(String(Number(text)))
        break
      }
    }
  }
  return out
}

/** les couleurs écrites dans `series={…}` (cf. writtenValues) */
export const writtenColors = (expr: string): string[] => writtenValues(expr, 'color')

const isSign = (tok: Token | undefined, c: string): boolean => tok?.kind === 'sign' && tok.value === c

// les parts d'une suite de jetons, séparées par ses virgules de premier niveau ; null quand une parenthèse, un crochet ou une accolade
// s'y referme sans s'y être ouvert, ou s'y ouvre sans s'y refermer
function splitTopLevel(toks: Token[]): Token[][] | null {
  const parts: Token[][] = [[]]
  let depth = 0
  for (const tok of toks) {
    if (tok.kind === 'sign' && '([{'.includes(tok.value)) depth++
    else if (tok.kind === 'sign' && ')]}'.includes(tok.value) && --depth < 0) return null
    if (depth === 0 && isSign(tok, ',')) parts.push([])
    else parts[parts.length - 1].push(tok)
  }
  return depth === 0 ? parts : null
}

// la valeur écrite d'une clé : un texte sûr, ou un nombre écrit seul, lu comme le module le lit (`key: 1.0` vaut « 1 ») ; null pour une
// valeur calculée ou un texte qui s'échappe
function writtenValue(toks: Token[]): string | null {
  if (toks.length === 1 && toks[0].kind === 'text') return toks[0].sure ? toks[0].value : null
  const text = toks.map((x) => x.value).join('')
  return toks.length > 0 && toks.every((x) => x.kind !== 'text') && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text) ? String(Number(text)) : null
}

/**
 * Les séries écrites en dur (`series={[{ key: 'pluie', axis: 'right' }, …]}`) : pour chaque objet écrit du tableau, ses clés et leur valeur
 * écrite (cf. writtenValue), la dernière quand une clé se répète. Dans le doute, rien : une expression qui n'est pas un tableau écrit
 * (`$vrai ? […] : []`, `[…].concat(x)`), une interpolation, un texte qui ne se ferme pas. Un élément qui n'est pas un objet écrit (une
 * variable, un étalement, une condition) n'y figure pas, ni un objet dont une clé ne se lit pas (un étalement, une clé calculée, une méthode).
 */
function writtenSeries(expr: string): Map<string, string | null>[] {
  const out: Map<string, string | null>[] = []
  const toks = tokensOf(expr)
  if (!toks || !isSign(toks[0], '[') || !isSign(toks[toks.length - 1], ']') || toks.length < 2) return out
  for (const el of splitTopLevel(toks.slice(1, -1)) ?? []) {
    if (!isSign(el[0], '{') || !isSign(el[el.length - 1], '}') || el.length < 2) continue
    const members = splitTopLevel(el.slice(1, -1))
    let serie: Map<string, string | null> | null = members ? new Map() : null
    for (const m of members ?? []) {
      if (m.length === 0) continue
      const [name, colon] = m
      if (m.length === 1 && name.kind === 'word') serie!.set(name.value, null)
      else if (name.kind === 'sign' || !name.sure || !isSign(colon, ':')) {
        serie = null
        break
      }
      else serie!.set(name.value, writtenValue(m.slice(2)))
    }
    if (serie) out.push(serie)
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
  // l'axe d'une série écrite : `left` ou `right`, tel quel (le module ne retire que les espaces autour) ; vide, l'axe de gauche
  for (const raw of writtenValues(attrs.exprs?.series ?? '', 'axis')) {
    const side = raw.trim()
    if (side !== '' && !CHART_SERIES_AXES.includes(side)) out.push(t('bundler.index.chart-axe-serie-inconnu', { fichier: ref.file, tag, mot: side, connus: CHART_SERIES_AXES.join(' ') }))
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

/**
 * Les avertissements de construction d'une référence à <@@chart> : une série écrite `axis: 'right'` sur une forme écrite qui n'a qu'une
 * échelle, ou aucune (hors de CHART_TWIN_SHAPES). Le module l'ignore, la série reste sur l'échelle du graphique, et le dit en développement ;
 * la construction le dit aussi, sans s'arrêter. Seulement à coup sûr, comme le module le lit : la forme écrite en texte et connue (un mot
 * inconnu est une faute, cf. chartProblems), aucun étalement `{...p}` sur la balise, pas un radar dont les lignes écrites sont 1 ou 2 (une
 * courbe le remplace) ; une série écrite dont la clé n'est pas vide, dont `axis` vaut `right` aux espaces près, et qui n'est pas une série
 * de mots (`kind: 'text'`). Une valeur calculée laisse la série de côté.
 */
export function chartWarnings(ref: { file: string, kind: string, attrs?: TagRefAttrs }): string[] {
  const attrs = ref.attrs
  const shape = typeof attrs?.texts?.shape === 'string' ? attrs.texts.shape.trim() : ''
  if (!attrs || attrs.spread || !CHART_WORDS.shape.includes(shape) || CHART_TWIN_SHAPES.includes(shape)) return []
  const rows = shape === 'radar' && attrs.exprs?.rows !== undefined ? writtenRows(attrs.exprs.rows) : null
  if (rows !== null && rows > 0 && rows < 3) return []
  const right = writtenSeries(attrs.exprs?.series ?? '').filter((s) => s.get('key') && s.get('axis')?.trim() === 'right' && (!s.has('kind') || (s.get('kind') ?? 'text') !== 'text')).map((s) => s.get('key')!)
  if (right.length === 0) return []
  const tag = ref.kind === 'litteral-coeur' ? 'mjs-core-chart' : '@@chart'
  return [t('bundler.index.chart-axe-droite-ignore', { fichier: ref.file, tag, forme: shape, cles: right.join(' '), formes: CHART_TWIN_SHAPES.join(' ') })]
}
