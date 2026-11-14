// reader/positions — d'un indice du fichier à sa ligne et sa colonne (`fichier:ligne:colonne`)
// ligne et colonne comptées à partir de 1, la colonne en unités UTF-16 (celle des éditeurs et du serveur de langage)

// indice du premier caractère de chaque ligne
export function debutsDeLigne(source: string): number[] {
  const debuts = [0]
  for (let i = 0; i < source.length; i++) if (source.charCodeAt(i) === 10) debuts.push(i + 1)
  return debuts
}

// recherche dichotomique de la ligne qui contient l'indice
export function situer(debuts: number[], indice: number): { ligne: number, colonne: number } {
  let bas  = 0
  let haut = debuts.length - 1
  while (bas < haut) {
    const milieu = (bas + haut + 1) >> 1
    if (debuts[milieu] <= indice) bas = milieu
    else haut = milieu - 1
  }
  return { ligne: bas + 1, colonne: indice - debuts[bas] + 1 }
}

export function positionDe(fichier: { debutsDeLigne: number[] }, indice: number): { ligne: number, colonne: number } {
  return situer(fichier.debutsDeLigne, indice)
}

export function formaterPosition(fichier: { chemin: string, debutsDeLigne: number[] }, indice: number): string {
  const { ligne, colonne } = situer(fichier.debutsDeLigne, indice)
  return `${fichier.chemin}:${ligne}:${colonne}`
}

// alignement de deux lignes caractère à caractère (plus longue sous-suite commune) : pour chaque caractère de `a`, l'indice du
// caractère de `b` qui lui répond (-1 : ajouté), et la longueur commune
function aligner(a: string, b: string): { vis: Int32Array, commun: number } {
  const n   = a.length
  const m   = b.length
  const vis = new Int32Array(n + 1).fill(-1)
  vis[n]    = m
  if (n * m > 4_000_000) return { vis, commun: 0 }
  const l = new Uint32Array((n + 1) * (m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      l[i * (m + 1) + j] = a[i] === b[j] ? l[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(l[(i + 1) * (m + 1) + j], l[i * (m + 1) + j + 1])
    }
  }
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) vis[i++] = j++
    else if (l[(i + 1) * (m + 1) + j] >= l[i * (m + 1) + j + 1]) i++
    else j++
  }
  return { vis, commun: l[0] }
}

// l'alignement de deux lignes longues qui diffèrent de peu (le sucre réécrit quelques noms des deux côtés de la faute) : le
// chemin le plus court de Myers, en (n + m) × d, rend comme aligner l'indice dans `b` de chaque caractère de `a` (-1 : ajouté) ;
// null au-delà de `plafond` différences
function alignerPeuDEcarts(a: string, b: string, plafond: number): Int32Array | null {
  const n      = a.length
  const m      = b.length
  const max    = Math.min(n + m, plafond)
  const centre = max + 1
  const v      = new Int32Array(2 * max + 3)
  const traces: Int32Array[] = []
  for (let d = 0; d <= max; d++) {
    traces.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[centre + k - 1] < v[centre + k + 1]) ? v[centre + k + 1] : v[centre + k - 1] + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[centre + k] = x
      if (x >= n && y >= m) return remonter(traces, n, m, centre)
    }
  }
  return null
}

// le chemin de Myers relu depuis la fin : chaque pas en diagonale apparie un caractère de `a` à un de `b`
function remonter(traces: Int32Array[], n: number, m: number, centre: number): Int32Array {
  const vis = new Int32Array(n + 1).fill(-1)
  vis[n]    = m
  let x     = n
  let y     = m
  for (let d = traces.length - 1; d >= 0; d--) {
    const v     = traces[d]
    const k     = x - y
    const avant = k === -d || (k !== d && v[centre + k - 1] < v[centre + k + 1]) ? k + 1 : k - 1
    const px    = v[centre + avant]
    const py    = px - avant
    while (x > px && y > py) {
      x--
      y--
      if (x < n) vis[x] = y
    }
    x = px
    y = py
  }
  return vis
}

// le début et la fin communs à deux lignes : ils se répondent tels quels, seul le milieu (ce que la compilation réécrit)
// s'aligne ; une ligne longue ne coûte que sa réécriture
function bords(a: string, b: string): { p: number, s: number } {
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
export function colonneEcrite(compilee: string, ecrite: string, colonne: number): number {
  const k        = Math.max(0, Math.min(colonne - 1, compilee.length))
  const { p, s } = bords(compilee, ecrite)
  if (k < p) return k + 1
  if (k >= compilee.length - s) return ecrite.length - (compilee.length - k) + 1
  const a = compilee.slice(p, compilee.length - s)
  const b = ecrite.slice(p, ecrite.length - s)
  const vis = a.length * b.length > 4_000_000 ? alignerPeuDEcarts(a, b, 256) : aligner(a, b).vis
  if (!vis) return Math.min(Math.max(k + ecrite.length - compilee.length, p), ecrite.length - s) + 1
  for (let i = k - p; i <= a.length; i++) if (vis[i] >= 0) return p + vis[i] + 1
  return ecrite.length - s + 1
}

// ressemblance de deux lignes, blancs de tête et de fin retirés (0 à 1) : la part commune rapportée à la plus longue. Un milieu
// trop long pour l'alignement complet (une ligne longue réécrite des deux côtés) se compte sur ses seules différences, comme
// colonneEcrite l'aligne ; trop différent, il ne compte pas
export function ressemblance(a: string, b: string): number {
  const x = a.trim()
  const y = b.trim()
  if (x.length === 0 || y.length === 0) return 0
  const { p, s } = bords(x, y)
  const mx       = x.slice(p, x.length - s)
  const my       = y.slice(p, y.length - s)
  const long     = mx.length * my.length > 4_000_000
  const vis      = long ? alignerPeuDEcarts(mx, my, 256) : null
  const commun   = !long ? aligner(mx, my).commun : vis ? vis.subarray(0, mx.length).filter((j) => j >= 0).length : 0
  return (p + s + commun) / Math.max(x.length, y.length)
}

// la colonne (unités UTF-16, à partir de 1) d'un décalage en octets UTF-8 compté à partir de 0 sur la ligne (esbuild compte
// ainsi : un caractère accentué y vaut deux octets, un emoji quatre)
export function colonneDesOctets(ligne: string, octets: number): number {
  let u = 0
  for (let o = 0; u < ligne.length && o < octets; u++) {
    const c = ligne.charCodeAt(u)
    o += c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c < 0xdc00 ? 4 : c >= 0xdc00 && c < 0xe000 ? 0 : 3
  }
  return u + 1
}
