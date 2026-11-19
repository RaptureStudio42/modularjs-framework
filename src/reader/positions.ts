// reader/positions — d'un indice du fichier à sa ligne et sa colonne (`fichier:ligne:colonne`)
// ligne et colonne comptées à partir de 1, la colonne en unités UTF-16 (celle des éditeurs et du serveur de langage)

// indice du premier caractère de chaque ligne
export function lineStarts(source: string): number[] {
  const starts = [0]
  for (let i = 0; i < source.length; i++) if (source.charCodeAt(i) === 10) starts.push(i + 1)
  return starts
}

// recherche dichotomique de la ligne qui contient l'indice
export function locate(starts: number[], hint: number): { line: number, column: number } {
  let low = 0
  let top = starts.length - 1
  while (low < top) {
    const middle = (low + top + 1) >> 1
    if (starts[middle] <= hint) low = middle
    else top = middle - 1
  }
  return { line: low + 1, column: hint - starts[low] + 1 }
}

export function positionOf(file: { lineStarts: number[] }, hint: number): { line: number, column: number } {
  return locate(file.lineStarts, hint)
}

export function formatPosition(file: { path: string, lineStarts: number[] }, hint: number): string {
  const { line, column } = locate(file.lineStarts, hint)
  return `${file.path}:${line}:${column}`
}

// alignement de deux lignes caractère à caractère (plus longue sous-suite commune) : pour chaque caractère de `a`, l'indice du
// caractère de `b` qui lui répond (-1 : ajouté), et la longueur commune
function align(a: string, b: string): { match: Int32Array, common: number } {
  const n   = a.length
  const m   = b.length
  const match = new Int32Array(n + 1).fill(-1)
  match[n]    = m
  if (n * m > 4_000_000) return { match, common: 0 }
  const l = new Uint32Array((n + 1) * (m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      l[i * (m + 1) + j] = a[i] === b[j] ? l[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(l[(i + 1) * (m + 1) + j], l[i * (m + 1) + j + 1])
    }
  }
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) match[i++] = j++
    else if (l[(i + 1) * (m + 1) + j] >= l[i * (m + 1) + j + 1]) i++
    else j++
  }
  return { match, common: l[0] }
}

// l'alignement de deux lignes longues qui diffèrent de peu (le sucre réécrit quelques noms des deux côtés de la faute) : le
// chemin le plus court de Myers, en (n + m) × d, rend comme aligner l'indice dans `b` de chaque caractère de `a` (-1 : ajouté) ;
// null au-delà de `plafond` différences
function alignFewDiffs(a: string, b: string, cap: number): Int32Array | null {
  const n                    = a.length
  const m                    = b.length
  const max                  = Math.min(n + m, cap)
  const center               = max + 1
  const v                    = new Int32Array(2 * max + 3)
  const traces: Int32Array[] = []
  for (let d = 0; d <= max; d++) {
    traces.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[center + k - 1] < v[center + k + 1]) ? v[center + k + 1] : v[center + k - 1] + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[center + k] = x
      if (x >= n && y >= m) return backtrack(traces, n, m, center)
    }
  }
  return null
}

// le chemin de Myers relu depuis la fin : chaque pas en diagonale apparie un caractère de `a` à un de `b`
function backtrack(traces: Int32Array[], n: number, m: number, center: number): Int32Array {
  const match = new Int32Array(n + 1).fill(-1)
  match[n]    = m
  let x     = n
  let y     = m
  for (let d = traces.length - 1; d >= 0; d--) {
    const v      = traces[d]
    const k      = x - y
    const before = k === -d || (k !== d && v[center + k - 1] < v[center + k + 1]) ? k + 1 : k - 1
    const px     = v[center + before]
    const py     = px - before
    while (x > px && y > py) {
      x--
      y--
      if (x < n) match[x] = y
    }
    x = px
    y = py
  }
  return match
}

// le début et la fin communs à deux lignes : ils se répondent tels quels, seul le milieu (ce que la compilation réécrit)
// s'aligne ; une ligne longue ne coûte que sa réécriture
function edges(a: string, b: string): { p: number, s: number } {
  let p = 0
  while (p < a.length && p < b.length && a[p] === b[p]) p++
  let s = 0
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++
  return { p, s }
}

// la colonne du texte écrit qui répond à une colonne de sa forme compilée (raccourcis de MJS réécrits, retrait commun retiré,
// `.=` d'une déclaration) : un caractère ajouté par la compilation répond au premier caractère écrit qui le suit, la fin de la
// ligne à la fin de la ligne ; colonnes comptées à partir de 1. Un milieu trop long pour l'alignement complet s'aligne sur ses
// seules différences, et garde l'écart des deux longueurs quand elles sont trop nombreuses
export function writtenColumn(compiled: string, written: string, column: number): number {
  const k        = Math.max(0, Math.min(column - 1, compiled.length))
  const { p, s } = edges(compiled, written)
  if (k < p) return k + 1
  if (k >= compiled.length - s) return written.length - (compiled.length - k) + 1
  const a = compiled.slice(p, compiled.length - s)
  const b = written.slice(p, written.length - s)
  const match = a.length * b.length > 4_000_000 ? alignFewDiffs(a, b, 256) : align(a, b).match
  if (!match) return Math.min(Math.max(k + written.length - compiled.length, p), written.length - s) + 1
  for (let i = k - p; i <= a.length; i++) if (match[i] >= 0) return p + match[i] + 1
  return written.length - s + 1
}

// ressemblance de deux lignes, blancs de tête et de fin retirés (0 à 1) : la part commune rapportée à la plus longue. Un milieu
// trop long pour l'alignement complet (une ligne longue réécrite des deux côtés) se compte sur ses seules différences, comme
// writtenColumn l'aligne ; trop différent, il ne compte pas
export function likeness(a: string, b: string): number {
  const x = a.trim()
  const y = b.trim()
  if (x.length === 0 || y.length === 0) return 0
  const { p, s } = edges(x, y)
  const mx       = x.slice(p, x.length - s)
  const my       = y.slice(p, y.length - s)
  const long     = mx.length * my.length > 4_000_000
  const match      = long ? alignFewDiffs(mx, my, 256) : null
  const common   = !long ? align(mx, my).common : match ? match.subarray(0, mx.length).filter((j) => j >= 0).length : 0
  return (p + s + common) / Math.max(x.length, y.length)
}

// la colonne (unités UTF-16, à partir de 1) d'un décalage en octets UTF-8 compté à partir de 0 sur la ligne (esbuild compte
// ainsi : un caractère accentué y vaut deux octets, un emoji quatre)
export function byteColumn(line: string, bytes: number): number {
  let u = 0
  for (let o = 0; u < line.length && o < bytes; u++) {
    const c = line.charCodeAt(u)
    o += c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c < 0xdc00 ? 4 : c >= 0xdc00 && c < 0xe000 ? 0 : 3
  }
  return u + 1
}
