// mjs-ws/heatmap — paquet CARTE DE CHALEUR : où les visiteurs cliquent (ou tout autre événement choisi
// par l'effet, `on: mousemove`…), page par page (son adresse et sa route, sans requête ni ancre) et
// composant par composant (l'effet `*heatmap`, runtime/mjs_fx_heatmap.ts). Les points restent dans le
// serveur : leur âge les efface (`maxAge` en `unit`), et des plafonds de sécurité gardent la mémoire
// bornée (`maxPages`, `maxZones`, `maxPoints` : les plus anciens partent d'abord) ; la carte se lit sur la page d'admin du pont
// (`GET /heatmap`, signée comme `/state` — sans signature quand le pont écoute en local), en JSON
// (`GET /heatmap.json`), ou par `app.heatmap()`.
//
//   import { mjsWs, heatmapPackage } from 'modularjs-framework/ws'
//   app.use(heatmapPackage({ origins: ['https://monsite.fr'], maxAge: 30, unit: 'day' }))
//
// `opts.origins` (OBLIGATOIRE) : les origines de vos pages (`https://monsite.fr`, sans chemin). L'en-tête
// Origin d'une connexion se falsifie par un script (`new WebSocket(url, { origin })`), et la page d'admin
// charge les adresses reçues dans un cadre : sans cette liste blanche, le paquet refuse de démarrer.
//
// Protocole :
//   heatmap:point  CLIENT→SERVEUR (fire-and-forget)  { url, ev, z: [[nom, x, y, w, h], …] } — ou, quand
//     plusieurs points partent ensemble (la part des effets en direct épuisée : ils attendent, puis partent
//     d'un trait), { pts: [{ url, ev, z }, …] } : 50 points au plus par trame, le seau de débit en compte un
//     par point
//     url : l'adresse de la page (http, https) — gardée sans requête, ni ancre, ni identifiants (seule
//           la route `#/…` du routeur MJS reste, telle quelle ; un segment qui ressemble à un jeton ou à une donnée
//           personnelle — un UUID, un JWT, un e-mail, un téléphone, un nombre de 6 chiffres ou plus, 8 caractères hexadécimaux
//           ou plus, 16 caractères ou plus de lettres, chiffres, `-` et `_` quels qu'ils soient, 20 caractères ou plus de l'alphabet
//           base64 mêlant minuscules, majuscules et chiffres — part remplacé par `_SECRET_ID_`, un slug, une date, `v2` restent en clair : voir `looksLikeToken` ; devant
//           une extension (`.pdf`) ou après un `;` (`;jsessionid=…`), la règle porte sur la partie qui précède ou sur la valeur, et le nom du paramètre est jugé seul : ni jeton
//           ni e-mail sur la page d'admin, pas une « page » par visite), de 2 000 caractères au plus UNE FOIS NORMALISÉE (l'encodage d'une
//           adresse brute peut la multiplier par six : la limite porte sur ce qui est gardé), et seulement si elle est de la même origine
//           que la connexion ET que cette origine est dans `opts.origins` (l'en-tête Origin de la page qui
//           s'est connectée — une connexion sans Origin, un script, n'est pas prise) : aucune autre adresse
//           n'arrive sur la page d'admin ;
//     ev  : l'événement (`click` par défaut) — chacun sa carte ;
//     z   : les zones que le point touche, de la plus large à la plus fine — `document` (la page
//           entière : x, y en fractions de la page, w, h sa taille en px), puis chaque composant
//           traversé (`mjs-carte` : x, y en fractions de sa boîte, w, h sa taille) ; 8 au plus.
//   Rien d'autre ne part : ni texte, ni identité, ni cookie.
// Mémoire : un point plus vieux que `opts.maxAge` (en `opts.unit` : second, minute, hour, day, week,
// month, year — défaut 7 jours) est effacé, et une page sans point part ; au-delà de `maxPoints` points
// en tout (défaut 1 000 000, ~80 Mo), les plus anciens partent ; au plus `maxPages` pages (1 000) et
// `maxZones` zones par page (64) : au-delà, la page (ou la zone de la page) la moins récente part pour faire
// place à la nouvelle — un script ne fait pas tomber le serveur temps réel en inventant des adresses et des
// zones, et ne fige pas les vraies pages : elles reviennent dès qu'on les visite.
// `opts.exclude` : des IP (celle de la connexion, ou la première de `X-Forwarded-For` derrière un
// proxy) et des comptes (l'`id` de l'identité rendue par `auth`) dont les points ne sont pas pris —
// pour ne pas se compter soi-même ; ou une fonction `(client) => true` pour écarter. `opts.onPoint(point)`
// : chaque point reçu, avant les plafonds de mémoire, pour le garder ailleurs (une base). Débit : un seau
// à jetons par connexion et un par adresse (`addressRateLimit` : une IPv6 compte pour son préfixe /56), un
// jeton par point.
// `opts.file` : les points gardés dans un fichier JSON (la forme de `app.heatmap()`), relu au démarrage
// (`app.use` : une page dont l'adresse n'est pas http(s) — `javascript:`, `data:` — ou dépasse 2 000 caractères, dont l'origine
// n'est pas dans `origins`, ou au-delà de `maxPages` et `maxZones`, est écartée seule, le journal le dit : la page d'admin
// charge chaque adresse dans un cadre), écrit toutes les `saveEvery` ms s'il y a du nouveau (une minute par défaut) et à l'arrêt —
// `app.stop()`, fin du process, SIGTERM de `systemctl stop`. Écriture atomique (fichier temporaire puis
// renommage : `<file>.tmp`, `<file>.fond.tmp` — ceux d'une écriture interrompue sont purgés au démarrage) ;
// un fichier illisible est mis de côté (`<file>.bad-<date>`), jamais écrasé. Un seul processus par fichier
// (plusieurs serveurs : `onPoint` vers une base).

import { readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { MjsWsClient, MjsWsLogFn } from './core.js'
import { definePackage } from './packages.js'
import type { MjsPackage } from './packages.js'
import { TokenBucket } from './guard.js'
import { addressForLimits } from './transport.js'
import { defaultLogOf } from './package-helpers.js'
import { t } from '../messages/index.js'

export type MjsWsHeatmapUnit = 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year'

export interface MjsWsHeatmapOptions {
  /** OBLIGATOIRE : les origines de vos pages (`['https://monsite.fr']`, sans chemin) — une trame d'une autre origine n'écrit rien,
   *  et sans cette liste le paquet refuse de démarrer (l'en-tête Origin se falsifie par un script) */
  origins: string[]
  /** l'âge au-delà duquel un point est effacé, en `unit` — défaut 7 */
  maxAge?: number
  /** l'unité de `maxAge` — défaut 'day' (un mois : 30 jours, un an : 365) */
  unit?: MjsWsHeatmapUnit
  /** débit PAR CONNEXION, en points (défaut `{ rate: 10, burst: 20 }`) */
  rateLimit?: { rate?: number; burst?: number }
  /** débit PAR ADRESSE, en points, que se partagent toutes les connexions d'une adresse (une IPv6 compte pour son préfixe /56) —
   *  défaut `{ rate: 100, burst: 200 }` ; `false` : le seau de la connexion seul */
  addressRateLimit?: { rate?: number; burst?: number } | false
  /** qui ne compte pas, à la capture : des IP, des comptes (`identity.id`), ou une fonction qui écarte */
  exclude?: { ips?: string[]; accounts?: Array<string | number> } | ((client: MjsWsClient) => boolean)
  /** chaque point reçu, vérifié, avant les plafonds de mémoire — pour le garder ailleurs */
  onPoint?: (point: MjsWsHeatmapPoint) => void
  /** un fichier où garder les points d'un redémarrage à l'autre (relatif au dossier de lancement) :
   *  relu au démarrage, écrit toutes les `saveEvery` ms s'il y a du nouveau, et à l'arrêt */
  file?: string
  /** l'écriture régulière de `file`, en millisecondes — défaut 60 000 (une minute) */
  saveEvery?: number
  /** défaut : console, préfixe '[mjs-ws:heatmap]' */
  onLog?: MjsWsLogFn
  /** horloge injectable — simule l'âge des points SANS vrai délai (cf. mjs-ws-reactions-follow-heatmap.test.ts) */
  now?: () => number
  /** plafond de sécurité : les points gardés en tout — au-delà, les plus anciens partent (défaut 1 000 000) */
  maxPoints?: number
  /** plafond de sécurité : les pages (adresses) gardées — au-delà, la moins récente part pour la nouvelle (défaut 1 000) */
  maxPages?: number
  /** plafond de sécurité : les zones (par événement) d'une page — au-delà, la moins récente de la page part pour la nouvelle (défaut 64) */
  maxZones?: number
}

export interface MjsWsHeatmapPoint {
  url: string
  ev: string
  z: Array<[string, number, number, number, number]>
}

export interface MjsWsHeatmapZone { zone: string; ev: string; n: number; w: number; h: number; pts: Array<[number, number]>; ts: number[] }
export interface MjsWsHeatmapPage { url: string; n: number; zones: MjsWsHeatmapZone[] }
export interface MjsWsHeatmapSnapshot { pages: MjsWsHeatmapPage[] }

const UNITS: Record<MjsWsHeatmapUnit, number> = { second: 1000, minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000, month: 2_592_000_000, year: 31_536_000_000 }

const frac = (v: unknown): number | null => typeof v === 'number' && isFinite(v) && v >= 0 && v <= 1 ? Math.round(v * 10000) / 10000 : null
const size = (v: unknown): number | null => typeof v === 'number' && isFinite(v) && v >= 0 && v <= 100000 ? Math.round(v) : null
// un événement (`click`, `pointermove`…), un nom de zone (`document`, `mjs-offre`, `div.carte#x`)
const EV_RE   = /^[a-z][a-z0-9:_-]{0,39}$/
const ZONE_RE = /^[a-z][a-z0-9._#-]{0,119}$/
// au plus 50 points par trame (le client en envoie 20 au plus)
const MAX_LOT = 50

// un texte (un segment de chemin, déjà décodé) qui ressemble à un jeton ou à une donnée personnelle : un UUID (avec ou sans tirets, entre
// accolades), un JWT (`eyJ…`, trois à cinq parties base64url, ou trois parties de 8 caractères au moins), un e-mail, un nombre de 6 chiffres
// ou plus (un téléphone : `+33612345678`, `06 12 34 56 78`), 8 caractères hexadécimaux ou plus mêlant lettres et chiffres (un jeton court :
// `5f3a9c2e` ; de 9 à 11 caractères, un mot écrit en hexadécimal — `added2023`, `face2face` — se lit, il reste en clair), 16 caractères
// alphanumériques ou plus mêlant lettres et chiffres (un jeton, une empreinte), ou 20 caractères ou plus de l'alphabet base64 (`A-Za-z0-9+/=_-`)
// mêlant minuscules, majuscules et chiffres, avec au moins une bosse (`aB`) ou un voisinage lettre-chiffre (`a1`). Ces deux derniers restent en
// clair quand 90 % du texte se lit : des mots prononçables (`Samsung_Galaxy_S23_Ultra`, `bootstrap5components`), des dates compactes
// (`20241003T101500Z`, `IMG20241003123456`, `DSC20241003123456`). Un slug (`top-10-des-meilleurs-outils`), une date, `v2`, un numéro court, un code court restent en
// clair. Enfin, 16 caractères ou plus faits de lettres, de chiffres, de `-` et de `_`, quels que soient ces caractères (sans chiffre, en
// minuscules seules, avec un tiret) : un jeton, sauf quand ils se lisent comme des mots (`isPlain`), et une clé de groupes de même longueur, même courte (`isKey`) — un jeton qu'un client enverrait en
// clair ne reste jamais. La MÊME règle que le navigateur (runtime/mjs_fx_heatmap.ts, `_mjsHeatmapLooks`), qui l'applique avant d'envoyer :
// ici, c'est le serveur qui décide
const READ_RE = /[A-Z]{2,4}(?=\d{4})|([a-z]?[A-Z][a-z]{2,}|[a-z]{5,}|[A-Z]{2,})(\d{0,3})|\d{4,}[A-Z]?|(?:^|[-_])[A-Z]\d{1,3}(?![A-Za-z\d])|[-_.]/g
// un mot prononçable : des voyelles (un quart au moins), jamais 6 consonnes de suite, pas de lettres rares en foule
const isWord = (w: string): boolean => {
  const v = (w.match(/[aeiouy]/gi) || []).length
  return v > 0 && v * 4 >= w.length && !/[^aeiouy]{6}/i.test(w) && (w.length < 8 || (w.match(/[jqxz]/gi) || []).length * 6 <= w.length)
}
const isReadable = (s: string): boolean => {
  let n = 0
  s.replace(READ_RE, (m, w) => {
    if (!w || isWord(w)) n += m.length
    return m
  })
  return n * 10 >= s.length * 9
}
// les lettres qui en suivent chacune dans les mots (dictionnaires français et anglais, plus `lw` : always, railway, tailwind) : une paire
// absente d'ici (`qx`, `zk`, `wj`…) n'est dans aucun mot courant — un jeton tiré au hasard en a presque toujours une
const PAIRS: Record<string, string> = {
  a: 'abcdefghijklmnopqrstuvwxyz',
  b: 'abdeijlmorstuvy',
  c: 'acehikloqrstuy',
  d: 'abcdefghijlmnoprstuvwy',
  e: 'abcdefghijklmnopqrstuvwxyz',
  f: 'aefilorstuy',
  g: 'aeghilmnorstuy',
  h: 'abefilmnorstuwy',
  i: 'abcdefgiklmnopqrstuvxz',
  j: 'aeiou',
  k: 'abehilmnorsuwy',
  l: 'abcdefghiklmnopqrstuvwy',
  m: 'abcefilmnopsuy',
  n: 'abcdefghijklmnopqrstuvwyz',
  o: 'abcdefghiklmnopqrstuvwxyz',
  p: 'abehilmoprstuy',
  q: 'u',
  r: 'abcdefghijklmnopqrstuvwy',
  s: 'abcdefghiklmnopqrstuwy',
  t: 'abcefghilmnoprstuwyz',
  u: 'abcdefgiklmnopqrstvxyz',
  v: 'aeioru',
  w: 'abdehiklnors',
  x: 'acehioptuy',
  y: 'abcdegilmnoprstuw',
  z: 'aeiloyz'
}
// un mot (lettres seules) qui se prononce : une voyelle, jamais 6 consonnes de suite, chaque paire de lettres dans PAIRS
const says = (word: string): boolean => {
  const w = word.toLowerCase()
  if (!/[aeiouy]/.test(w) || /[^aeiouy]{6}/.test(w)) return false
  for (let i = 1; i < w.length; i++) if (PAIRS[w[i - 1]].indexOf(w[i]) < 0) return false
  return true
}
// un texte de lettres, chiffres, `-` et `_` qui se lit : découpé en nombres, séparateurs et mots (minuscules, une capitale puis des
// minuscules, ou capitales), chaque mot de 3 lettres et plus se prononce (des capitales : en morceau entier ou devant un nombre) ; un mot
// plus court est un morceau entier entre deux séparateurs (`de`, `OLED` ; une lettre seule : une voyelle), touche un nombre
// (`S23`, `IMG2024…`, `256gb`, le `T` d'une date) ou ouvre un mot à capitale (`iPhone`) ; deux mots ou nombres au moins, 31 pour 100
// caractères au plus. Un morceau court qui ne se prononce pas est un sigle (`php`, `vs`, `IMG`, `json`) : les sigles font moins d'un
// cinquième du texte, et un sigle de 4 lettres veut un mot de 5 lettres ou plus, ou un nombre, dans le texte — des groupes de lettres
// tirées au hasard (`xxxx-xxxx-xxxx-xxxx`, une clé de licence) ne se lisent pas. Un mot d'un slug — des mots en minuscules et des nombres séparés par `-` : `github-actions-workflow`,
// `postgresql-performance-tips` — se lit aussi quand ses paires de lettres manquent à la table (un nom de marque, un mot composé, un
// mot rare), un seul par slug : 10 lettres au plus, une voyelle, jamais 5 consonnes de suite, une seule paire hors table (deux pour un
// mot de 6 lettres au plus : `nextjs`). Au-delà, un morceau tiré au hasard ne s'en distingue plus (`invite-…`, `xxxxx-xxxxx-…`) ; `_`
// lie les morceaux d'un identifiant (`tok_…`), pas les mots d'un slug. Un seul mot de 16 lettres et plus, un séparateur en tête, en fin
// ou doublé ne se lisent pas : un jeton de lettres ne s'en distingue pas
const WORDS_RE = /\d+|[-_]|[A-Z]+(?![a-z])|[A-Z]?[a-z]+/g
// les paires de lettres d'un mot en minuscules absentes de PAIRS
const gaps = (w: string): number => {
  let n = 0
  for (let i = 1; i < w.length; i++) if (PAIRS[w[i - 1]].indexOf(w[i]) < 0) n++
  return n
}
const isPlain = (s: string): boolean => {
  if (/^[-_]|[-_]$|[-_]{2}/.test(s)) return false
  // un slug : des mots en minuscules et des nombres, séparés par `-` ; il peut porter un mot hors table
  let slug = /^(?:[a-z]+|\d+)(?:-(?:[a-z]+|\d+))+$/.test(s)
  const t    = s.match(WORDS_RE) || []
  // un mot de 5 lettres ou plus, ou un nombre : un sigle de 4 lettres peut l'accompagner
  const long = /\d|[A-Za-z]{5}/.test(s)
  let words  = 0
  // les lettres des sigles
  let sigle  = 0
  for (let i = 0; i < t.length; i++) {
    const w = t[i]
    if (w === '-' || w === '_') continue
    words++
    if (/^\d/.test(w)) continue
    const a  = t[i - 1] || '-'
    const b  = t[i + 1] || '-'
    const sa = a === '-' || a === '_'
    const sb = b === '-' || b === '_'
    const da = /^\d/.test(a)
    const db = /^\d/.test(b)
    if (sa && sb && w.length <= 4 && (w.length > 1 || /[aeiouy]/i.test(w))) {
      if (w.length > 1 && !says(w)) {
        if (w.length > 3 && !long) return false
        sigle += w.length
      }
      continue
    }
    if ((sa && db && w.length <= 3) || (da && sb && w.length <= 2) || (/^\d{4}/.test(a) && /^\d{4}/.test(b) && w.length === 1)) continue
    if (w.length === 1 && /^[a-z]$/.test(w) && sa && /^[A-Z][a-z]{2}/.test(b)) continue
    if (w.length >= 3 && (!/^[A-Z]{2}/.test(w) || (sa && (sb || db))) && says(w)) continue
    if (slug && w.length <= 10 && /[aeiouy]/.test(w) && !/[^aeiouy]{5}/.test(w) && gaps(w) <= (w.length <= 6 ? 2 : 1)) {
      slug = false
      continue
    }
    return false
  }
  return words >= 2 && words * 100 <= s.length * 31 && sigle * 5 < s.length
}
// une clé : trois groupes ou plus de 4 à 6 lettres ou chiffres, tous de la même longueur, séparés par `-` ou `_`, au bout du texte, seule ou
// derrière des mots (`xxxxx-xxxxx-xxxxx`, `XXXX_XXXX_XXXX_XXXX`, `key-xxxxx-xxxxx-xxxxx`, `order-1234-5678-9012`) ; capitales et minuscules se
// valent. Elle se masque quand un groupe porte un chiffre, quelle que soit sa longueur (`1234-5678-9012`, 14 caractères) ; de lettres, elle ne
// se lit qu'en quatre groupes ou plus, chacun un mot qui se prononce, à deux voyelles au moins (`salut-monde-pomme-poire`) : trois groupes
// tirés au hasard se prononcent trop souvent (près de 7 pour 100 pour 3 × 5 lettres), trois mots de même longueur au bout d'un slug se
// masquent donc même quand ils se lisent (`react-hooks-guide`, `the-black-white-photo`). Trois groupes de 4 lettres seuls (14 caractères,
// sous les 16 des jetons à séparateurs) se lisent comme un slug, chaque mot prononçable : `best-food-ever` reste, `html-form-tips` se masque
const isKey = (s: string): boolean => {
  const g = s.split(/[-_]/)
  const n = g[g.length - 1].length
  let i   = g.length
  while (i > 0 && g[i - 1].length === n && /^[A-Za-z\d]{4,6}$/.test(g[i - 1])) i--
  const k = g.slice(i)
  if (k.length < 3) return false
  if (/\d/.test(k.join(''))) return true
  if (k.length > 3) return !k.every(w => says(w) && /[aeiouy].*[aeiouy]/i.test(w))
  return s.length >= 16 || !isPlain(s)
}
// un numéro écrit en groupes : 6 chiffres ou plus séparés par `-`, `.` ou des espaces, `+` en tête permis (`555-123-4567`, `06.12.34.56.78`,
// `+33-6-12-34-56-78`) ; une date reste en clair : `AAAA-MM-JJ`, `AAAA-MM`, `JJ-MM-AAAA` (ou `MM-JJ-AAAA`), une année de 1900 à 2099
const DATE = /^(?:(?:19|20)\d\d([-. ])(?:0?[1-9]|1[0-2])(?:\1(?:0?[1-9]|[12]\d|3[01]))?|(?:0?[1-9]|[12]\d|3[01])([-. ])(?:0?[1-9]|[12]\d|3[01])\2(?:19|20)\d\d)$/
const isPhone = (s: string): boolean => /^\+?\d+(?:[-. ]+\d+)+$/.test(s) && s.replace(/\D/g, '').length >= 6 && !DATE.test(s)
// un code court tiré au hasard, de groupes de longueurs inégales : trois groupes ou plus de 3 à 6 lettres ou chiffres séparés par `-` ou `_`,
// une lettre collée à un chiffre, un texte qui ne se lit pas (`A7K2-9QXB4M-P3Z`, `c6h-suf-px7-hnh`) ; un slug qui porte un nombre se lit
// (`ps5-pro-review`, `rtx-4090-test`)
const isCode = (s: string): boolean => /^[A-Za-z\d]{3,6}(?:[-_][A-Za-z\d]{3,6}){2,}$/.test(s) && /[A-Za-z]\d|\d[A-Za-z]/.test(s) && !isPlain(s)
const looksLikeToken = (s: string): boolean => {
  if (/^[{(]?[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}[})]?$/i.test(s)) return true
  if (/^eyJ[\w-]*(?:\.[\w-]*){2,4}$/.test(s)) return true
  if (/^[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}$/.test(s)) return true
  if (/^[^@\s]+@[^@\s.]+(?:\.[^@\s.]+)+$/.test(s)) return true
  if (/^\+?\d{6,}$/.test(s.replace(/ /g, ''))) return true
  if (isPhone(s)) return true
  if (/^[0-9a-f]{8,}$/i.test(s) && /[a-f]/i.test(s) && /\d/.test(s) && (s.length < 9 || s.length > 11 || !/^[a-f]{4,}\d{1,4}(?:[a-f]{4,})?$/i.test(s))) return true
  if (/^[a-z\d]{16,}$/i.test(s) && /[a-z]/i.test(s) && /\d/.test(s) && !isReadable(s)) return true
  if (isKey(s)) return true
  if (isCode(s)) return true
  if (/^[\w-]{16,}$/.test(s) && !isPlain(s)) return true
  return /^[\w+/=-]{20,}$/.test(s) && /[a-z]/.test(s) && /[A-Z]/.test(s) && /\d/.test(s) && /[a-z][A-Z]|[A-Za-z]\d|\d[A-Za-z]/.test(s) && !isReadable(s)
}
// les suites `%XX` décodées, une par une : un `%` mal formé ne gâte pas le reste
const decodeRuns = (s: string): string => s.replace(/(?:%[0-9a-f]{2})+/gi, run => {
  try { return decodeURIComponent(run) }
  catch { return run }
})
// le segment tel qu'écrit dans l'adresse, puis décodé jusqu'à trois fois (`%2540` est un `@` encodé deux fois)
const isToken = (seg: string): boolean => {
  let s = seg
  for (let i = 0; i < 4; i++) {
    if (looksLikeToken(s)) return true
    const d = s.indexOf('%') < 0 ? s : decodeRuns(s)
    if (d === s) return false
    s = d
  }
  return false
}
// une partie de segment qui est un jeton : `_SECRET_ID_` ; « <jeton>.pdf » garde son extension (`_SECRET_ID_.pdf`) ; sinon null
const maskWhole = (p: string): string | null => {
  if (isToken(p)) return '_SECRET_ID_'
  const m = /^(.+)\.([A-Za-z0-9]{1,5})$/.exec(p)
  return m && isToken(m[1]) ? '_SECRET_ID_.' + m[2] : null
}
// une partie `nom=valeur` (`;jsessionid=…`) : le nom jugé comme un segment, toujours (`<jeton>.pdf` : `_SECRET_ID_.pdf`) ; une valeur
// jeton part masquée, une valeur déjà masquée (`_SECRET_ID_`, `_SECRET_ID_.pdf`) reste, la partie n'est pas rejugée ; une valeur en
// clair : la partie telle qu'elle partirait, nom masqué, est jugée entière (un base64 coupé par un `=`), la partie écrite pour un `=` de
// remplissage seul (`…sT12=`, `…==`) — rien ne bouge au second passage, le serveur garde ce que le navigateur envoie
const maskPart = (p: string): string => {
  const i = p.indexOf('=')
  if (i < 1) return maskWhole(p) ?? p
  const value = p.slice(i + 1)
  const name  = maskWhole(p.slice(0, i)) ?? p.slice(0, i)
  const mask  = /^_SECRET_ID_(?:\.[A-Za-z0-9]{1,5})?$/.test(value) ? value : maskWhole(value)
  if (mask !== null) return name + '=' + mask
  return maskWhole(/^=*$/.test(value) ? p : name + '=' + value) ?? name + '=' + value
}
// un segment : chaque partie séparée par `;` (le nom, puis ses paramètres `;jsessionid=…`) a son jugement
const maskSegment = (seg: string): string => seg.split(';').map(maskPart).join(';')
const maskPath = (path: string): string => path.split('/').map(maskSegment).join('/')

// une origine de `origins` : `https://monsite.fr`, `http://localhost:3000` — sans chemin, requête ni ancre ; rend
// sa forme normalisée (celle de l'en-tête Origin d'un navigateur), ou null
function normalizeOrigin(o: unknown): string | null {
  if (typeof o !== 'string') return null
  let u: URL
  try { u = new URL(o) }
  catch { return null }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  if (u.pathname !== '/' || u.search || u.hash || u.username || u.password) return null
  return u.origin
}

/** un point reçu, recopié champ par champ ; null s'il manque quoi que ce soit. `origin` : celle de la
 *  connexion — une adresse d'une autre origine est refusée */
export function cleanPoint(p: unknown, origin?: string): MjsWsHeatmapPoint | null {
  if (!p || typeof p !== 'object') return null
  const r = p as Record<string, unknown>
  if (typeof r.url !== 'string' || r.url.length > 2000) return null
  let u: URL
  try { u = new URL(r.url) }
  catch { return null }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  if (origin && u.origin !== origin) return null
  // la page et sa route (`#/…`), sans requête, ancre ni identifiants, ni jeton
  const route = /^#\//.test(u.hash) ? maskPath(u.hash.replace(/^(#[^?#]*).*$/, '$1')) : ''
  const ev = r.ev === undefined ? 'click' : r.ev
  if (typeof ev !== 'string' || !EV_RE.test(ev)) return null
  if (!Array.isArray(r.z) || r.z.length === 0 || r.z.length > 8) return null
  const z: MjsWsHeatmapPoint['z'] = []
  for (const e of r.z) {
    if (!Array.isArray(e) || e.length !== 5) return null
    const [nom, x, y, w, h] = e
    if (typeof nom !== 'string' || !ZONE_RE.test(nom)) return null
    const fx = frac(x)
    const fy = frac(y)
    const sw = size(w)
    const sh = size(h)
    if (fx === null || fy === null || sw === null || sh === null) return null
    z.push([nom, fx, fy, sw, sh])
  }
  const url = u.origin + maskPath(u.pathname) + route
  // la limite porte sur l'adresse GARDÉE : l'encodage d'une adresse brute sous la limite peut la multiplier par six (`é` : `%C3%A9`),
  // et la relecture du fichier refuse ce qui dépasse
  if (url.length > 2000) return null
  return { url, ev, z }
}

// une zone d'une page pour un événement : ses points et leur heure d'arrivée, dans l'ordre — les
// effacés sont avant `head`, recopiés de temps en temps
interface Zone { zone: string; ev: string; w: number; h: number; pts: Array<[number, number]>; ts: number[]; head: number }

// les cartes à écrire quand le process s'arrête sans `app.stop()` : 'exit' (fin normale, process.exit)
// et SIGTERM (`systemctl stop`), qui termine Node sans passer par 'exit' — le signal est renvoyé une
// fois l'écriture faite (listener `once`, déjà retiré) : Node finit comme il l'aurait fait (code 143) ;
// sauf si l'appli attend elle-même le signal (son arrêt propre : un écouteur de SIGTERM déjà là quand le
// paquet s'installe — même s'il s'est retiré en route, un `once` — ou posé depuis) : le signal est à elle.
// Pas de SIGINT : un listener SIGINT seul empêcherait Ctrl+C de terminer le process (même choix que
// server/journal.ts). Un listener par événement, partagé par toutes les cartes.
const flushers = new Set<() => void>()
let exitHooked = false
function ensureExitHooks(): void {
  if (exitHooked) return
  exitHooked = true
  const already = process.listenerCount('SIGTERM')
  process.on('exit', () => { for (const f of flushers) f() })
  process.once('SIGTERM', () => {
    for (const f of flushers) f()
    // un autre gestionnaire (un arrêt propre de l'appli) attend le signal : il décide de la suite
    if (already === 0 && process.listenerCount('SIGTERM') === 0) process.kill(process.pid, 'SIGTERM')
  })
}

const errText = (err: unknown): string => err instanceof Error ? err.message : String(err)

/** paquet CARTE DE CHALEUR — `app.use(heatmapPackage(opts))` (cf. tête de fichier). */
export function heatmapPackage(opts: MjsWsHeatmapOptions): MjsPackage {
  // appelé sans réglages (JavaScript, ou `as any`) : le même message clair que sans `origins`
  if (!opts || typeof opts !== 'object') throw new Error(t('ws.heatmap.origins-manquantes'))
  const unit = opts.unit ?? 'day'
  if (!Object.prototype.hasOwnProperty.call(UNITS, unit)) throw new Error(t('ws.heatmap.unit-inconnue', { unit: String(unit), liste: Object.keys(UNITS).join(', ') }))
  const maxAge = opts.maxAge ?? 7
  if (typeof maxAge !== 'number' || !isFinite(maxAge) || maxAge <= 0) throw new Error(t('ws.heatmap.maxage-invalide', { valeur: String(maxAge) }))
  let   file  = opts.file
  if (file !== undefined && (typeof file !== 'string' || file === '')) throw new Error(t('ws.heatmap.file-invalide', { valeur: JSON.stringify(file) }))
  const saveEvery = opts.saveEvery ?? 60_000
  if (typeof saveEvery !== 'number' || !isFinite(saveEvery) || saveEvery <= 0) throw new Error(t('ws.heatmap.saveevery-invalide', { valeur: String(saveEvery) }))
  // la liste blanche des origines : sans elle, le paquet ne démarre pas
  if (!Array.isArray(opts.origins) || opts.origins.length === 0) throw new Error(t('ws.heatmap.origins-manquantes'))
  const originSet = new Set<string>()
  for (const o of opts.origins) {
    const n = normalizeOrigin(o)
    if (n === null) throw new Error(t('ws.heatmap.origine-invalide', { valeur: String(JSON.stringify(o)) }))
    originSet.add(n)
  }
  const ttl     = maxAge * UNITS[unit]
  const now     = opts.now ?? Date.now
  const rate    = opts.rateLimit?.rate ?? 10
  const burst   = opts.rateLimit?.burst ?? 20
  const onLog   = opts.onLog ?? defaultLogOf('heatmap')
  const plafond = (nom: string, v: unknown, dflt: number): number => {
    if (v === undefined || v === null) return dflt
    if (typeof v !== 'number' || !isFinite(v) || v < 1) throw new Error(t('ws.heatmap.plafond-invalide', { nom, valeur: String(v) }))
    return Math.floor(v)
  }
  const maxPoints = plafond('maxPoints', opts.maxPoints, 1_000_000)
  const maxPages  = plafond('maxPages', opts.maxPages, 1000)
  const maxZones  = plafond('maxZones', opts.maxZones, 64)
  // page → (événement, zone) → ses points ; les deux tables dans l'ordre de leur dernier point : la première est la moins récente
  const pages   = new Map<string, Map<string, Zone>>()
  // les points gardés en tout
  let total     = 0
  // chaque plafond atteint n'est dit qu'une fois (un journal inondé ne sert à personne)
  const dits    = new Set<string>()
  const plafondAtteint = (quoi: 'points' | 'pages' | 'zones', vars: Record<string, string>): void => {
    if (dits.has(quoi)) return
    dits.add(quoi)
    onLog('warn', quoi === 'points' ? t('ws.heatmap.plafond-points', vars) : quoi === 'pages' ? t('ws.heatmap.plafond-pages', vars) : t('ws.heatmap.plafond-zones', vars))
  }
  const buckets = new WeakMap<MjsWsClient, TokenBucket>()
  // un seau par adresse, que se partagent ses connexions — dans l'ordre de leur dernier jeton : un seau oublié depuis le temps de se
  // remplir (burst / rate) est plein, comme un neuf, il part (mémoire bornée sans minuterie)
  const parAdresse = opts.addressRateLimit === false ? null : { rate: opts.addressRateLimit?.rate ?? 100, burst: opts.addressRateLimit?.burst ?? 200 }
  if (parAdresse) for (const cle of ['rate', 'burst'] as const) {
    const v = parAdresse[cle]
    if (typeof v !== 'number' || !isFinite(v) || v <= 0) throw new Error(t('ws.heatmap.debit-adresse-invalide', { cle, valeur: String(v) }))
  }
  const seauxAdresse = new Map<string, { seau: TokenBucket; at: number }>()
  const jetonAdresse = (client: MjsWsClient): boolean => {
    const adresse = parAdresse ? addressForLimits(client.meta?.address) : undefined
    if (!parAdresse || adresse === undefined) return true
    const maintenant = Date.now()
    const plein = parAdresse.burst / parAdresse.rate * 1000
    for (const [cle, e] of seauxAdresse) {
      if (maintenant - e.at < plein) break
      seauxAdresse.delete(cle)
    }
    let e = seauxAdresse.get(adresse)
    if (e) seauxAdresse.delete(adresse)
    else e = { seau: new TokenBucket(parAdresse.burst, parAdresse.rate), at: 0 }
    e.at = maintenant
    seauxAdresse.set(adresse, e)
    return e.seau.take()
  }
  let recus     = 0
  // des points pas encore écrits dans `file`
  let dirty     = false

  // les points trop vieux d'une zone s'effacent ; rend le nombre qui reste. Le tassement remplace les tableaux au lieu de
  // les retailler : une lecture en cours garde ceux de son instant (cf. vue) et ne le retarde jamais — un client du pont
  // qui ne lisait plus empêchait sinon tout tassement, et la mémoire suivait l'arrivée des points au lieu de `maxPoints`
  const trim = (z: Zone, limite: number): number => {
    while (z.head < z.ts.length && z.ts[z.head] < limite) {
      z.head++
      total--
    }
    if (z.head > 1024 && z.head * 2 > z.ts.length) {
      z.pts  = z.pts.slice(z.head)
      z.ts   = z.ts.slice(z.head)
      z.head = 0
    }
    return z.ts.length - z.head
  }
  const sweep = (limite = now() - ttl): void => {
    for (const [url, zones] of pages) {
      for (const [k, z] of zones) if (trim(z, limite) === 0) zones.delete(k)
      if (zones.size === 0) pages.delete(url)
    }
  }
  // au-delà de `maxPoints` : les plus anciens partent — l'heure qui en garde 90 %, cherchée par
  // dichotomie sur les heures de chaque zone (déjà dans l'ordre)
  const evict = (): void => {
    plafondAtteint('points', { max: String(maxPoints) })
    const cible = Math.floor(maxPoints * 0.9)
    const avant = (t0: number): number => {
      let n = 0
      for (const zones of pages.values()) {
        for (const z of zones.values()) {
          let lo = z.head
          let hi = z.ts.length
          while (lo < hi) {
            const mid = (lo + hi) >> 1
            if (z.ts[mid] < t0) lo = mid + 1
            else hi = mid
          }
          n += lo - z.head
        }
      }
      return n
    }
    let lo = Infinity
    let hi = -Infinity
    for (const zones of pages.values()) for (const z of zones.values()) if (z.head < z.ts.length) {
      lo = Math.min(lo, z.ts[z.head])
      hi = Math.max(hi, z.ts[z.ts.length - 1])
    }
    if (lo > hi) return
    hi += 1
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2)
      if (total - avant(mid) > cible) lo = mid
      else hi = mid
    }
    sweep(hi)
  }

  const snapshot = (): MjsWsHeatmapSnapshot => {
    sweep()
    return {
      pages: [...pages.entries()].map(([url, zones]) => {
        const zs = [...zones.values()].map(z => ({ zone: z.zone, ev: z.ev, n: z.ts.length - z.head, w: z.w, h: z.h, pts: z.pts.slice(z.head), ts: z.ts.slice(z.head) }))
        return { url, n: zs.reduce((a, z) => z.zone === 'document' ? a + z.n : a, 0) || zs.reduce((m, z) => Math.max(m, z.n), 0), zones: zs.sort((a, b) => b.n - a.n) }
      }).sort((a, b) => b.n - a.n),
    }
  }

  // --- le fichier ------------------------------------------------------------------------------
  // écrit d'un coup (fichier temporaire puis renommage : jamais un fichier à moitié écrit), et
  // seulement s'il y a du nouveau ; un échec le redira à la prochaine fois, les points restent là.
  // À l'arrêt : d'un seul trait (une écriture de fond en cours n'a pas encore mis le fichier à jour)
  const save = (): void => {
    if (!file || (!dirty && !fond)) return
    const tmp = file + '.tmp'
    try {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(tmp, JSON.stringify({ v: 1, pages: snapshot().pages }))
      renameSync(tmp, file)
      dirty = false
    }
    catch (err) {
      onLog('error', t('ws.heatmap.file-ecriture', { file }), { err: errText(err) })
      try { unlinkSync(tmp) }
      catch { /* jamais écrit */ }
    }
  }

  // l'écriture de chaque minute rend la main au serveur temps réel : la carte de l'instant sans copie de ses
  // points, le texte par morceaux de points, l'écriture en tâche de fond — à 1 million de points (le plafond
  // par défaut), d'un seul trait, elle le gelait plus de 200 ms à chaque fois. Même fichier. Arrêté
  // (`arrete`), elle est abandonnée sans rien laisser : `save()` a écrit d'un seul trait
  const MORCEAU = 20000
  let fond: Promise<void> | null = null
  let arrete = false
  const pause = (): Promise<void> => new Promise(ok => setImmediate(ok))
  // la carte de l'instant, SANS copier ses points (la copie d'un million de points tenait la boucle à chaque
  // requête) : chaque zone garde ses tableaux de l'instant et leurs bornes, [de, a[ — les points arrivés ensuite
  // sont au-delà de `a`, et un tassement pose d'autres tableaux dans la zone sans toucher ceux-ci (cf. trim)
  interface ZoneVue { zone: string; ev: string; n: number; w: number; h: number; pts: Array<[number, number]>; ts: number[]; de: number; a: number }
  interface PageVue { url: string; n: number; zones: ZoneVue[] }
  const vue = (): PageVue[] => {
    sweep()
    return [...pages.entries()].map(([url, zones]) => {
      const zs = [...zones.values()].map(z => ({ zone: z.zone, ev: z.ev, n: z.ts.length - z.head, w: z.w, h: z.h, pts: z.pts, ts: z.ts, de: z.head, a: z.ts.length }))
      return { url, n: zs.reduce((a, z) => z.zone === 'document' ? a + z.n : a, 0) || zs.reduce((m, z) => Math.max(m, z.n), 0), zones: zs.sort((a, b) => b.n - a.n) }
    }).sort((a, b) => b.n - a.n)
  }
  // les pages d'une vue en texte JSON (les octets de JSON.stringify d'un instantané), donné à `envoi` par
  // morceaux d'environ 512 Ko, la main rendue au serveur temps réel après chaque morceau de points : pour
  // l'écriture de fond, et pour le pont (GET /heatmap.json, GET /heatmap) — d'un seul trait, à 1 million de
  // points, 54 Mo de JSON gelaient la boucle plus de 600 ms à chaque requête. Une promesse rendue par `envoi`
  // (un flux plein qui attend sa vidange) est attendue avant le morceau de points suivant ; `envoi` qui lève
  // arrête la lecture
  const pagesText = async (pages: PageVue[], envoi: (txt: string) => void | Promise<void>): Promise<void> => {
    let cur = '['
    let attente: void | Promise<void>
    const add = (txt: string): void => {
      cur += txt
      if (cur.length >= 524288) {
        const prete = cur
        cur = ''
        attente = envoi(prete)
      }
    }
    const suite = async (): Promise<void> => {
      const a = attente
      attente = undefined
      if (a) await a
      else await pause()
    }
    let p = 0
    for (const { zones, ...page } of pages) {
      add((p++ ? ',' : '') + JSON.stringify(page).slice(0, -1) + ',"zones":[')
      let k = 0
      for (const { pts, ts, de, a, ...zone } of zones) {
        add((k++ ? ',' : '') + JSON.stringify(zone).slice(0, -1))
        for (const [cle, xs] of [['pts', pts], ['ts', ts]] as Array<[string, unknown[]]>) {
          add(',"' + cle + '":[')
          for (let i = de; i < a; i += MORCEAU) {
            add((i > de ? ',' : '') + JSON.stringify(xs.slice(i, Math.min(i + MORCEAU, a))).slice(1, -1))
            await suite()
          }
          add(']')
        }
        add('}')
      }
      add(']}')
    }
    await suite()
    await envoi(cur + ']')
  }
  const saveLater = (): Promise<void> => {
    if (!file || !dirty || fond || arrete) return fond ?? Promise.resolve()
    dirty = false
    const pages  = vue()
    const tmp    = file + '.fond.tmp'
    const oublie = (): void => {
      try { unlinkSync(tmp) }
      catch { /* jamais écrit */ }
    }
    fond = (async () => {
      try {
        const textes = ['{"v":1,"pages":']
        await pagesText(pages, txt => { textes.push(txt) })
        if (arrete) return
        mkdirSync(dirname(file), { recursive: true })
        await writeFile(tmp, textes.join('') + '}')
        if (arrete) oublie()
        else renameSync(tmp, file)
      }
      catch (err) {
        dirty = true
        onLog('error', t('ws.heatmap.file-ecriture', { file }), { err: errText(err) })
        oublie()
      }
      finally {
        fond = null
      }
    })()
    return fond
  }
  // les fichiers temporaires d'une écriture interrompue (arrêt brutal, coupure) : personne ne les reprend, ils partent
  // au démarrage — comme celui d'une écriture de fond que l'arrêt coupe (`flush`)
  const purge = (): void => {
    if (!file) return
    for (const tmp of [file + '.tmp', file + '.fond.tmp']) {
      try { unlinkSync(tmp) }
      catch { /* absent */ }
    }
  }
  const flush = (): void => {
    arrete = true
    save()
    // une écriture de fond en cours ne finira pas : son fichier à moitié écrit part avec elle
    if (file) {
      try { unlinkSync(file + '.fond.tmp') }
      catch { /* rien d'écrit */ }
    }
  }

  // l'origine d'une page relue : http ou https — la page d'admin charge chaque adresse dans un cadre, `javascript:` ou `data:` n'y arrivent jamais
  const originOf = (url: string): string | null => {
    try {
      const u = new URL(url)
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null
    }
    catch { return null }
  }

  // le fichier relu : la forme de app.heatmap() ; une seule valeur hors de sa forme le rend illisible —
  // jamais chargé à moitié. Une page fautive, elle, est écartée seule (leur nombre est rendu, le journal le dit) : une adresse qui n'est pas
  // http(s) ou qui dépasse 2 000 caractères, une origine qui n'est pas dans `origins`, une page au-delà de `maxPages`, une zone au-delà de
  // `maxZones` — les mêmes bornes qu'à la réception ; le fichier range les pages les plus fréquentées d'abord, ce sont elles qui restent
  const restore = (d: unknown): { n: number, badUrl: number, otherOrigin: number, extraPages: number, extraZones: number } => {
    const bad = (): never => { throw new Error('heatmap') }
    const doc = d as { v?: unknown, pages?: unknown }
    if (!doc || typeof doc !== 'object' || doc.v !== 1 || !Array.isArray(doc.pages)) bad()
    const read = new Map<string, Map<string, Zone>>()
    let n = 0
    let badUrl = 0
    let otherOrigin = 0
    let extraPages = 0
    let extraZones = 0
    for (const p of doc.pages as Array<Record<string, unknown>>) {
      if (!p || typeof p.url !== 'string' || !Array.isArray(p.zones)) bad()
      const url   = p.url as string
      const zones = new Map<string, Zone>()
      for (const z of p.zones as Array<Record<string, unknown>>) {
        if (!z || typeof z.zone !== 'string' || !ZONE_RE.test(z.zone) || typeof z.ev !== 'string' || !EV_RE.test(z.ev)) bad()
        const w = size(z.w)
        const h = size(z.h)
        if (w === null || h === null || !Array.isArray(z.pts) || !Array.isArray(z.ts) || z.pts.length !== z.ts.length) bad()
        const pts: Array<[number, number]> = []
        const ts: number[] = []
        for (let i = 0; i < (z.pts as unknown[]).length; i++) {
          const q    = (z.pts as unknown[])[i]
          const when = (z.ts as unknown[])[i]
          if (!Array.isArray(q) || q.length !== 2 || frac(q[0]) === null || frac(q[1]) === null || typeof when !== 'number' || !isFinite(when)) bad()
          pts.push([frac((q as unknown[])[0])!, frac((q as unknown[])[1])!])
          ts.push(when as number)
        }
        zones.set(z.ev + ' ' + z.zone, { zone: z.zone as string, ev: z.ev as string, w: w!, h: h!, pts, ts, head: 0 })
      }
      const origin = url.length > 2000 ? null : originOf(url)
      if (origin === null) {
        badUrl++
        continue
      }
      if (!originSet.has(origin)) {
        otherOrigin++
        continue
      }
      if (read.size >= maxPages) {
        extraPages++
        continue
      }
      if (zones.size > maxZones) {
        extraZones += zones.size - maxZones
        for (const k of [...zones.keys()].slice(maxZones)) zones.delete(k)
      }
      for (const z of zones.values()) n += z.pts.length
      if (zones.size > 0) read.set(url, zones)
    }
    // dans l'ordre de leur dernier point (celui des pages, celui des zones de chaque page) : la première est la moins récente
    const dernier = (z: Zone): number => z.ts.length ? z.ts[z.ts.length - 1] : -Infinity
    const recence = (zones: Map<string, Zone>): number => Math.max(...[...zones.values()].map(dernier))
    for (const [url, zones] of [...read].sort((a, b) => recence(a[1]) - recence(b[1]))) {
      pages.set(url, new Map([...zones].sort((a, b) => dernier(a[1]) - dernier(b[1]))))
    }
    total = n
    sweep()
    if (total > maxPoints) evict()
    return { n, badUrl, otherOrigin, extraPages, extraZones }
  }

  const load = (): void => {
    if (!file) return
    let raw: string
    try { raw = readFileSync(file, 'utf8') }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') onLog('error', t('ws.heatmap.file-lecture', { file }), { err: errText(err) })
      return
    }
    try {
      const { n, badUrl, otherOrigin, extraPages, extraZones } = restore(JSON.parse(raw))
      onLog('info', t('ws.heatmap.file-relu', { file, n: String(n) }))
      if (badUrl > 0) onLog('warn', t('ws.heatmap.file-adresses-ecartees', { file, n: String(badUrl) }))
      if (otherOrigin > 0) onLog('warn', t('ws.heatmap.file-origines-ecartees', { file, n: String(otherOrigin) }))
      if (extraPages > 0 || extraZones > 0) onLog('warn', t('ws.heatmap.file-plafonds-ecartes', { file, pages: String(extraPages), zones: String(extraZones), maxPages: String(maxPages), maxZones: String(maxZones) }))
    }
    catch {
      // illisible : mis de côté, jamais écrasé par la prochaine écriture
      pages.clear()
      const aside = file + '.bad-' + Date.now()
      try {
        renameSync(file, aside)
        onLog('error', t('ws.heatmap.file-illisible', { file, aside }))
      }
      catch (err) {
        onLog('error', t('ws.heatmap.file-intouchable', { file }), { err: errText(err) })
        file = undefined
      }
    }
  }

  // qui ne compte pas : son IP (la connexion, ou la première de X-Forwarded-For), son compte
  const exclu = (client: MjsWsClient): boolean => {
    const ex = opts.exclude
    if (!ex) return false
    if (typeof ex === 'function') {
      try { return ex(client) === true }
      catch (err) { onLog('error', t('ws.heatmap.exclude-a-leve'), { err: err instanceof Error ? err.message : String(err) }); return false }
    }
    const h   = client.meta?.headers ?? {}
    const fwd = h['x-forwarded-for']
    const ips = [client.meta?.address, ...String(Array.isArray(fwd) ? fwd[0] : fwd ?? '').split(',').slice(0, 1).map(x => x.trim()), String(h['x-real-ip'] ?? '').trim()].filter(Boolean)
    if (ex.ips && ips.some(ip => ex.ips!.includes(ip as string))) return true
    const id = (client.identity as Record<string, unknown> | null | undefined)?.id
    return !!ex.accounts && id !== undefined && id !== null && ex.accounts.map(String).includes(String(id))
  }

  const pkg = definePackage('heatmap', app => {
    ;(app as any).heatmap = snapshot
    // pour le pont : la carte écrite au fil de sa sérialisation — son JSON, ou la page d'admin autour (`page`, chaque morceau échappé
    // pour <script>) —, chaque morceau donné à `envoi` dès qu'il est prêt : un flux plein fait attendre la suite (sa vidange), la carte
    // entière n'est jamais gardée en texte
    const ecrire = async (page: boolean, envoi: (txt: string) => void | Promise<void>): Promise<void> => {
      const json = page ? (txt: string) => envoi(escapeJsonForScript(txt)) : envoi
      if (page) await envoi(PAGE_HEAD)
      await json('{"pages":')
      await pagesText(vue(), json)
      await json('}')
      if (page) await envoi(PAGE_TAIL)
    }
    ;(app as any)._heatmapWrite = ecrire
    // la même carte, en morceaux rendus d'un coup
    ;(app as any)._heatmapPieces = async (page: boolean): Promise<string[]> => {
      const out: string[] = []
      await ecrire(page, txt => { out.push(txt) })
      return out
    }
    if (file) {
      purge()
      load()
      const timer = setInterval(() => { void saveLater() }, saveEvery)
      timer.unref?.()
      flushers.add(flush)
      ensureExitHooks()
      // à l'arrêt : l'écriture, une dernière fois, une fois le serveur fermé
      const baseStop = app.stop
      app.stop = async () => {
        try { await baseStop() }
        finally {
          clearInterval(timer)
          flushers.delete(flush)
          flush()
        }
      }
    }
    // un point reçu : `onPoint` d'abord — tous, plafonds de mémoire ou non —, puis la carte
    const accept = (point: MjsWsHeatmapPoint): void => {
      if (opts.onPoint) {
        try { opts.onPoint(point) }
        catch (err) { onLog('error', t('ws.heatmap.onpoint-a-leve'), { err: errText(err) }) }
      }
      const quand = now()
      // la page et la zone touchées passent en dernier : la première de chaque table est la moins récente, celle qui part au plafond
      let zones = pages.get(point.url)
      if (zones) pages.delete(point.url)
      else {
        if (pages.size >= maxPages) {
          plafondAtteint('pages', { max: String(maxPages) })
          const [url, partie] = pages.entries().next().value!
          for (const z of partie.values()) total -= z.ts.length - z.head
          pages.delete(url)
        }
        zones = new Map()
      }
      pages.set(point.url, zones)
      for (const [nom, x, y, w, h] of point.z) {
        const k = point.ev + ' ' + nom
        let z = zones.get(k)
        if (z) zones.delete(k)
        else {
          if (zones.size >= maxZones) {
            plafondAtteint('zones', { max: String(maxZones), url: point.url })
            const [cle, partie] = zones.entries().next().value!
            total -= partie.ts.length - partie.head
            zones.delete(cle)
          }
          z = { zone: nom, ev: point.ev, w, h, pts: [], ts: [], head: 0 }
        }
        zones.set(k, z)
        z.w = w
        z.h = h
        z.pts.push([x, y])
        z.ts.push(quand)
        total++
        trim(z, quand - ttl)
      }
      if (total > maxPoints) evict()
      dirty = true
      // les pages que plus personne ne visite s'effacent aussi, de temps en temps
      if (++recus % 500 === 0) sweep()
    }
    app.on('heatmap:point', (p, client) => {
      // une connexion sans Origin n'est pas une page de navigateur ; l'en-tête se falsifie par un script, d'où
      // la liste blanche : une origine qui n'est pas dans `origins` n'écrit rien
      const origin = client.meta?.origin
      if (!origin || !originSet.has(origin)) return
      // une trame : un point (la forme d'avant) ou plusieurs (`pts`), 50 au plus
      const rawPts = (p as { pts?: unknown } | null | undefined)?.pts
      const batch  = Array.isArray(rawPts) ? rawPts.slice(0, MAX_LOT) : [p]
      let excluded: boolean | undefined
      for (const un of batch) {
        const point = cleanPoint(un, origin)
        if (!point) continue
        if (excluded === undefined) excluded = exclu(client)
        if (excluded) return
        let b = buckets.get(client)
        if (!b) { b = new TokenBucket(burst, rate); buckets.set(client, b) }
        if (!b.take() || !jetonAdresse(client)) return
        accept(point)
      }
    })
  })
  ;(pkg as any)._pages = pages
  ;(pkg as any)._limits = { maxPoints, maxPages, maxZones }
  ;(pkg as any)._saveLater = saveLater
  return pkg
}

// ------------------------------------------------------------------------------------------------
// la page d'admin — sombre, autonome (aucune ressource externe), comme la page /state : à gauche les
// pages et leurs zones (par événement), à droite la carte de la zone choisie. La page entière s'affiche
// dessous (un cadre de l'adresse, à demi-taille) ; un composant, par une boîte de ses proportions.
// La chaleur : des disques flous qui s'additionnent, teintés du bleu (peu) au rouge (beaucoup).
// ------------------------------------------------------------------------------------------------

function escapeJsonForScript(json: string): string {
  return json.replace(/</g, '\\u003c')
}

const CSS = `
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;grid-template-columns:320px 1fr;background:#111;color:#e4e4e4;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
aside{padding:18px;border-right:1px solid #262626;overflow:auto;max-height:100vh}
h1{font-size:16px;font-weight:600;margin:0 0 4px}
.sub{color:#888;font-size:12px;margin:0 0 16px}
.page{margin:0 0 12px}
.url{display:block;color:#7aa2ff;font-size:12px;word-break:break-all;margin:0 0 4px}
.zone{display:flex;justify-content:space-between;width:100%;padding:4px 8px;margin:2px 0;border:1px solid #262626;border-radius:6px;background:#181818;color:inherit;font:inherit;font-size:13px;text-align:left;cursor:pointer}
.zone[aria-pressed="true"]{border-color:#7aa2ff;background:#1b2233}
.zone span:last-child{color:#999;font-variant-numeric:tabular-nums}
main{padding:18px;overflow:auto}
.vide{color:#777}
.scene{position:relative;display:inline-block;border:1px solid #262626;border-radius:8px;overflow:hidden;background:#0b0b0b}
.cadre{position:absolute;left:0;top:0;width:1280px;border:0;transform:scale(.5);transform-origin:0 0;pointer-events:none;background:#fff}
canvas{position:relative;display:block}
.legende{margin:10px 0 0;color:#888;font-size:12px}
.recents{display:flex;align-items:center;gap:10px;margin:0 0 10px;color:#aaa;font-size:12px}
.recents input{flex:1;max-width:420px}
`.trim()

const SCRIPT = `
var D = window.__HEATMAP__ || { pages: [] }
var liste = document.getElementById('liste'), scene = document.getElementById('scene'), titre = document.getElementById('titre'), legende = document.getElementById('legende'), recents = document.getElementById('recents'), depuis = document.getElementById('depuis')
function ramp(a) {
  var s = [[0, 0, 255], [0, 200, 120], [255, 220, 0], [255, 30, 30]]
  var x = Math.min(0.999, a) * (s.length - 1), i = Math.floor(x), k = x - i
  return [0, 1, 2].map(function(j) { return Math.round(s[i][j] + (s[i + 1][j] - s[i][j]) * k) })
}
function chauffer(c, pts) {
  var w = c.width, h = c.height, g = c.getContext('2d')
  g.clearRect(0, 0, w, h)
  var r = Math.max(10, Math.round(Math.min(w, h) / 22))
  pts.forEach(function(p) {
    var x = p[0] * w, y = p[1] * h, d = g.createRadialGradient(x, y, 0, x, y, r)
    d.addColorStop(0, 'rgba(0,0,0,0.22)')
    d.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = d
    g.fillRect(x - r, y - r, 2 * r, 2 * r)
  })
  var img = g.getImageData(0, 0, w, h), px = img.data
  for (var i = 0; i < px.length; i += 4) {
    var a = px[i + 3] / 255
    if (!a) continue
    var c3 = ramp(a)
    px[i] = c3[0]; px[i + 1] = c3[1]; px[i + 2] = c3[2]; px[i + 3] = Math.round(70 + a * 170)
  }
  g.putImageData(img, 0, 0)
}
function voir(page, zone, bouton) {
  document.querySelectorAll('.zone').forEach(function(b) { b.setAttribute('aria-pressed', b === bouton ? 'true' : 'false') })
  scene.textContent = ''
  titre.textContent = zone.zone + ' · ' + zone.ev + ' — ' + page.url
  var larg = 640, haut = zone.w > 0 ? Math.round(larg * zone.h / zone.w) : 360
  if (zone.zone === 'document') {
    var f = document.createElement('iframe')
    f.className = 'cadre'
    f.src = page.url
    f.title = page.url
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin')
    f.setAttribute('height', String(haut * 2))
    scene.appendChild(f)
  }
  var c = document.createElement('canvas')
  c.width = larg
  c.height = Math.min(haut, 4000)
  scene.appendChild(c)
  // les N points les plus récents : le curseur va du plus récent seul à tous
  var dessine = function() {
    var k = Math.max(1, Math.min(zone.pts.length, Number(recents.value) || zone.pts.length))
    chauffer(c, zone.pts.slice(-k))
    var t0 = zone.ts && zone.ts[zone.ts.length - k]
    depuis.textContent = k + ' / ' + zone.pts.length + (t0 ? ' — depuis le ' + new Date(t0).toLocaleString('fr-FR') : '')
  }
  recents.max = String(Math.max(1, zone.pts.length))
  recents.value = recents.max
  recents.oninput = dessine
  dessine()
  legende.textContent = zone.n + ' point' + (zone.n > 1 ? 's' : '') + ' (' + zone.ev + ') — ' + (zone.zone === 'document' ? 'la page entière, à demi-taille' : 'la boîte du composant, à ses proportions (' + zone.w + ' × ' + zone.h + ' px)')
}
if (D.pages.length === 0) liste.innerHTML = '<p class="vide">Aucun point pour l\\'instant.</p>'
D.pages.forEach(function(page, i) {
  var bloc = document.createElement('div')
  bloc.className = 'page'
  var u = document.createElement('span')
  u.className = 'url'
  u.textContent = page.url
  bloc.appendChild(u)
  page.zones.forEach(function(zone, j) {
    var b = document.createElement('button')
    b.className = 'zone'
    b.type = 'button'
    var n = document.createElement('span'), c = document.createElement('span')
    n.textContent = zone.zone + ' · ' + zone.ev
    c.textContent = String(zone.n)
    b.appendChild(n)
    b.appendChild(c)
    b.addEventListener('click', function() { voir(page, zone, b) })
    bloc.appendChild(b)
    if (i === 0 && j === 0) setTimeout(function() { voir(page, zone, b) }, 0)
  })
  liste.appendChild(bloc)
})
`

// la page d'admin autour du texte JSON de la carte (chaque morceau de ce texte échappé pour <script>)
const PAGE_HEAD = '<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>MJS-WS — carte de chaleur</title>\n'
  + '<style>' + CSS + '</style>\n</head>\n<body>\n'
  + '<aside><h1>Carte de chaleur</h1><p class="sub">Par page (adresse complète), puis par composant et par événement.</p><div id="liste"></div></aside>\n'
  + '<main><h1 id="titre"></h1><label class="recents">Les plus récents <input type="range" id="recents" min="1" max="1" value="1"><span id="depuis"></span></label><div class="scene" id="scene"></div><p class="legende" id="legende"></p></main>\n'
  + '<script>window.__HEATMAP__ = '
const PAGE_TAIL = ';\n' + SCRIPT + '</script>\n</body>\n</html>\n'

/** la page d'admin de la carte de chaleur (GET /heatmap) */
export function renderHeatmapPage(snap: MjsWsHeatmapSnapshot): string {
  return PAGE_HEAD + escapeJsonForScript(JSON.stringify(snap)) + PAGE_TAIL
}
