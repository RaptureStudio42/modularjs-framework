// transpiler/font-size — taille du texte adaptée à l'écran, faite par la construction
// une déclaration `font-size` en px seul, au-dessus du seuil, devient `var(--mjs-fs-<valeur>)` (point → `_`) ; la variable, posée
// sur :root par la feuille racine, vaut la taille fluide (`calc(rem + vw)`) sous la bascule et la taille écrite au-dessus.
// Calcul de la fonction RFS (rfs.sass, mode min-media-query, une dimension), arrondis compris tels que Dart Sass les rend : sa
// division chiffre à chiffre (10 décimales, le 11e chiffre arrondit), les comparaisons floues de Sass (à la 11e décimale près) et
// l'écriture de ses nombres (10 décimales au plus). Aucun Sass lancé pour ce calcul

export interface FontSizeSettings {
  /** seuil en px : une taille au seuil ou dessous ne bouge jamais */
  base: number
  /** largeur d'écran en px à partir de laquelle la taille écrite s'applique */
  breakpoint: number
  /** force de la réduction, plus grand que 1 */
  factor: number
  /** unité de sortie (1 rem = 16 px) */
  unit: 'rem' | 'px'
}

export const FONT_SIZE_DEFAULTS: FontSizeSettings = { base: 20, breakpoint: 1200, factor: 10, unit: 'rem' }
export const FONT_SIZE_KEYS = ['base', 'breakpoint', 'factor', 'unit'] as const
// rendu serveur : le bloc :root des tailles, écrit par la construction à côté du manifeste et repris par la tête que pose le
// serveur (server/ssr-head.ts), jamais lu par le navigateur ; nom de la famille que la purge des orphelins épargne (SERVER_WRITTEN_RE,
// bundler/outputs.ts)
export const FONT_SIZE_SHEET = 'mjs_ssr_head-font-sizes.css'

// réglage `responsiveFontSize` (déjà validé à la lecture de mjs.config.json) → réglages complets ; false = coupé
export function fontSizeSettings(value: unknown): FontSizeSettings | undefined {
  if (value === false) return undefined
  const out = { ...FONT_SIZE_DEFAULTS }
  if (typeof value !== 'object' || value === null) return out
  for (const k of FONT_SIZE_KEYS) {
    const v = (value as Record<string, unknown>)[k]
    if (v !== undefined) (out as Record<string, unknown>)[k] = v
  }
  return out
}

const EPSILON = Math.pow(10, -11)
const INVERSE = Math.pow(10, 11)
const REM     = 16

// arrondi de Dart : la moitié s'éloigne de zéro
const dartRound = (x: number): number => x < 0 ? -Math.round(-x) : Math.round(x)
// égalité floue de Dart Sass : égaux jusqu'à la 11e décimale
const feq = (a: number, b: number): boolean => a === b || (Math.abs(a - b) <= EPSILON && dartRound(a * INVERSE) === dartRound(b * INVERSE))
const gt  = (a: number, b: number): boolean => a > b && !feq(a, b)
const ge  = (a: number, b: number): boolean => a > b || feq(a, b)
const lt  = (a: number, b: number): boolean => a < b && !feq(a, b)

// divide() de rfs.sass : quotient chiffre à chiffre, 10 décimales, le 11e chiffre arrondit
function divide(dividend: number, divisor: number): number {
  const sign = (gt(dividend, 0) && gt(divisor, 0)) || (lt(dividend, 0) && lt(divisor, 0)) ? 1 : -1
  dividend = Math.abs(dividend)
  divisor  = Math.abs(divisor)
  if (feq(dividend, 0)) return 0
  if (feq(divisor, 0)) throw new Error('responsiveFontSize : division par 0')
  let remainder = dividend
  let result    = 0
  let factor    = 10
  let precision = 10
  while (gt(remainder, 0) && precision >= 0) {
    let quotient = 0
    // Sass soustrait une fois par unité ; au-delà d'un million (aucune taille réelle), le gros du quotient d'un coup
    if (remainder / divisor > 1e6) {
      quotient   = Math.floor(remainder / divisor) - 1
      remainder -= quotient * divisor
    }
    while (ge(remainder, divisor)) {
      remainder -= divisor
      quotient++
    }
    result    = result * 10 + quotient
    factor    = factor * 0.1
    remainder = remainder * 10
    precision--
    if (precision < 0 && ge(remainder, divisor * 5)) result++
  }
  return result * factor * sign
}

// texte décimal sans exposant, comme Dart Sass (`1.5e-7` → `0.00000015`)
function withoutExponent(text: string): string {
  const m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(text)
  if (m === null) return text
  const [, sign, first, rest = '', exp] = m
  const e = Number(exp)
  if (e < 0) return `${sign}0.${'0'.repeat(-e - 1)}${first}${rest}`
  return `${sign}${first}${rest}${'0'.repeat(Math.max(0, e - rest.length))}`
}

// écriture d'un nombre par Dart Sass : entier à la 11e décimale près, sinon 10 décimales au plus (le 11e chiffre du texte
// arrondit), zéros de fin retirés
function sassNumber(n: number): string {
  if (feq(Math.abs(n - 0.5) % 1, 0.5)) return withoutExponent(String(dartRound(n)))
  const text = withoutExponent(String(n))
  if (text.length < 12) return text
  const negative = text.startsWith('-')
  const [whole, fraction = ''] = (negative ? text.slice(1) : text).split('.')
  if (fraction.length <= 10) return text
  // 0 en tête : la place d'une retenue
  const digits = [0, ...[...whole, ...fraction.slice(0, 10)].map(Number)]
  if (Number(fraction[10]) >= 5) {
    let i = digits.length - 1
    while (++digits[i] === 10) digits[i--] = 0
  }
  const head = digits.slice(0, whole.length + 1).join('').replace(/^0+(?=\d)/, '')
  const tail = digits.slice(whole.length + 1).join('').replace(/0+$/, '')
  const out  = tail === '' ? head : `${head}.${tail}`
  return negative && /[1-9]/.test(out) ? `-${out}` : out
}

/** taille fluide (sous la bascule) et taille écrite (au-dessus) d'une taille en px ; null au seuil ou dessous (rien ne bouge) */
export function rfsSize(px: number, settings: FontSizeSettings): { fluid: string, fixed: string } | null {
  const base  = divide(settings.base, 1)
  const value = divide(px, 1)
  if (!gt(Math.abs(value), base)) return null
  const valueMin  = base + divide(Math.abs(value) - base, settings.factor)
  const valueDiff = Math.abs(value) - valueMin
  const minWidth  = settings.unit === 'rem' ? `${sassNumber(divide(valueMin, REM))}rem` : `${sassNumber(valueMin)}px`
  const variable  = `${sassNumber(divide(valueDiff * 100, divide(settings.breakpoint, 1)))}vw`
  const fixed     = settings.unit === 'rem' ? `${sassNumber(divide(px, REM))}rem` : `${sassNumber(px)}px`
  return { fluid: `calc(${minWidth} + ${variable})`, fixed }
}

const varName    = (value: string): string => `--mjs-fs-${value.replace('.', '_')}`
const bySize     = (a: string, b: string): number => Number(a) - Number(b)
// déclaration en tête (après `{` ou `;` et des blancs) : `font-size`, un nombre en px seul, `!important` permis
// blancs et commentaires permis après la valeur (`font-size: 50px /* titre */;`)
// un commentaire s'arrête à son premier `*/`, lu sans retour arrière : une file de commentaires suivie d'une valeur échoue aussitôt
const DECL_RE    = /(font-size[ \t\n\r\f]*:[ \t\n\r\f]*)(\d*\.?\d+)px(?=(?:[ \t\n\r\f]|\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\/)*(?:!(?:[ \t\n\r\f]|\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\/)*important(?:[ \t\n\r\f]|\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\/)*)?(?:;|\}|$))/iy
const BLANCS_RE  = /[ \t\n\r\f]*/y

/** CSS compilé → chaque `font-size: <n>px` au-dessus du seuil devient `font-size: var(--mjs-fs-<n>)` ; chaînes et commentaires
 *  recopiés tels quels. `sizes` : les valeurs converties, sans doublon, rangées */
export function rewriteFontSizes(css: string, settings: FontSizeSettings): { css: string, sizes: string[] } {
  if (!/font-size/i.test(css)) return { css, sizes: [] }
  const sizes = new Set<string>()
  let out = ''
  let i   = 0
  while (i < css.length) {
    const c = css[i]
    if (c === '/' && css[i + 1] === '*') {
      const end  = css.indexOf('*/', i + 2)
      const stop = end === -1 ? css.length : end + 2
      out += css.slice(i, stop)
      i = stop
    }
    else if (c === '"' || c === '\'') {
      let j = i + 1
      while (j < css.length && css[j] !== c) j += css[j] === '\\' ? 2 : 1
      out += css.slice(i, j + 1)
      i = j + 1
    }
    else if (c === '\\') {
      out += css.slice(i, i + 2)
      i += 2
    }
    else if (c === '{' || c === ';' || c === '}') {
      // blancs et commentaires entre `{` (ou `;`) et la déclaration, recopiés tels quels : `.b { /* note */ font-size: 50px; }`
      let j = i + 1
      for (;;) {
        BLANCS_RE.lastIndex = j
        j += BLANCS_RE.exec(css)![0].length
        const end = css.startsWith('/*', j) ? css.indexOf('*/', j + 2) : -1
        if (end === -1) break
        j = end + 2
      }
      out += css.slice(i, j)
      i = j
      DECL_RE.lastIndex = i
      const m = DECL_RE.exec(css)
      if (m === null) continue
      const value = String(Number(m[2]))
      if (rfsSize(Number(value), settings) === null) continue
      sizes.add(value)
      out += `${m[1]}var(${varName(value)})`
      i += m[0].length
    }
    else {
      out += c
      i++
    }
  }
  return { css: out, sizes: [...sizes].sort(bySize) }
}

/** bloc posé dans la feuille racine : une variable par valeur, la taille fluide sur :root, la taille écrite à partir de la
 *  bascule ; vide sans valeur au-dessus du seuil */
export function fontSizeRootCss(sizes: Iterable<string>, settings: FontSizeSettings): string {
  const rows = [...new Set(sizes)].sort(bySize).map(v => [v, rfsSize(Number(v), settings)] as const).filter((r): r is readonly [string, { fluid: string, fixed: string }] => r[1] !== null)
  if (rows.length === 0) return ''
  const fluid = rows.map(([v, r]) => `${varName(v)}:${r.fluid}`).join(';')
  const fixed = rows.map(([v, r]) => `${varName(v)}:${r.fixed}`).join(';')
  return `:root{${fluid}}@media (min-width:${sassNumber(divide(settings.breakpoint, 1))}px){:root{${fixed}}}`
}
