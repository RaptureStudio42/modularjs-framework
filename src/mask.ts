// src/mask — LE masqueur commun des réécritures de texte du compilateur : chaque passe qui
// cherche un motif dans du texte (directive, balise, sélecteur CSS…) doit d'abord neutraliser
// chaînes/commentaires pour ne jamais matcher DEDANS. Avant ce module, chaque passe avait son
// propre masquage local (ou aucun) — trouvé fautif sur plusieurs d'entre elles (une directive
// citée en exemple dans une chaîne de script activée à tort, un `<script>` mis en commentaire
// HTML redevenu le script réel…). Les trois fonctions ci-dessous gardent TOUTES la MÊME
// LONGUEUR que l'entrée (retours à la ligne compris) : un match trouvé sur la vue masquée reste
// à la bonne position sur le texte d'origine (relecture directe, ou via `m.indices`).
//
// QUELLE VARIANTE CHOISIR :
// - `maskNonCode(src, lang)` — code Civet/Coffee/JS : chaînes/heredocs/commentaires/regex
//   blanchis, le CODE des interpolations `${…}`/`#{…}` reste lisible (une réécriture qui doit
//   encore voir l'intérieur d'une interpolation, ex. lintSplitRune).
// - `maskInertSameLength(src)` (réexportée depuis le lexer) — même famille, mais un gabarit
//   est blanchi D'UN BLOC, interpolations comprises (rien de littéral ne ressort) : pour une
//   réécriture qui ne doit RIEN voir de ce qui est entre guillemets/heredoc/commentaire.
// - `maskHtmlComments(html)` — uniquement les commentaires HTML `<!-- … -->`, chacun jusqu'à sa
//   première fin (un `<!--` jamais refermé ne masque rien, même tolérance que le HTML natif).
//
// BORNES D'UN COMMENTAIRE HTML : celles que lit le navigateur. `<!-->` et `<!--->` sont des commentaires VIDES, refermés
// sur place ; sinon la fin est le premier `-->` ou `--!>`. Toute passe qui saute, masque ou retire un commentaire lit ces
// bornes-là — `readHtmlComment` pour un commentaire ouvert à une position connue, sinon le motif
// `<!--(?:-?>|[\s\S]*?--!?>)`, ou `findBlocks` / `replaceBlocks`, qui lisent les mêmes bornes en avançant seulement (un
// `<!--` jamais refermé se lit une fois). Chercher le `-->` suivant avalait tout ce qui suit un `<!-->` jusqu'au
// commentaire d'après : le gabarit perdait des balises que le navigateur affiche.

import { maskInertSameLength } from './lexer/index.js'
import { ouvreUneRegex, regexEnArgument, scanRegexLiteral } from './sigils.js'

export { maskInertSameLength }

// source → même longueur, retours à la ligne gardés, tout ce qui n'est pas du code remplacé par des espaces ; mêmes
// zones inertes que la passe 1 d'applyCivetDialectSugar puis transformCodeOnly : commentaires `//` `/* */` `###…###`
// et `#` (champ privé `#nom` gardé hors Coffee), chaînes et heredocs, littéraux regex (en Coffee/Civet, passés aussi
// sans parenthèses : `s.split /@/`), heregex `///…///` en Coffee/Civet ; le code des interpolations `${…}` (gabarit)
// et `#{…}` (guillemets doubles Coffee/Civet) reste lu
export function maskNonCode(src: string, lang = 'civet'): string {
  const coffee    = lang === 'coffee'
  const heredocs  = coffee || lang === 'civet'
  const chars     = src.split('')
  const n         = src.length
  const blank     = (from: number, to: number): void => { for(let k = from; k < to && k < n; k++) if(chars[k] !== '\n') chars[k] = ' ' }
  const lineEnd   = (j: number): number => { const e = src.indexOf('\n', j); return e < 0 ? n : e }
  const closeAt   = (j: number, close: string): number => { const e = src.indexOf(close, j); return e < 0 ? n : e + close.length }

  // chaîne ouverte en `open`, texte à partir de `j` : masquée jusqu'au délimiteur, interpolations gardées comme code
  const text = (open: number, j: number, close: string, interp: string | null): number => {
    let from = open
    while(j < n) {
      if(src[j] === '\\') { j += 2; continue }
      if(src.startsWith(close, j)) { blank(from, j + close.length); return j + close.length }
      if(interp && src.startsWith(interp, j)) {
        blank(from, j + interp.length)
        const end = code(j + interp.length, true)
        from = end
        j    = end + 1
        continue
      }
      j++
    }
    blank(from, n)
    return n
  }

  // code à partir de `i` ; dans une interpolation, s'arrête sur l'accolade fermante appariée et rend son index
  const code = (i: number, inside: boolean): number => {
    let depth = 0
    while(i < n) {
      const c = src[i], c1 = src[i + 1], c2 = src[i + 2]
      if(inside && c === '{') depth++
      if(inside && c === '}') {
        if(depth === 0) return i
        depth--
      }
      if(c === '#' && c1 === '#' && c2 === '#') { const s = closeAt(i + 3, '###'); blank(i, s); i = s; continue }
      if(heredocs && c === '/' && c1 === '/' && c2 === '/') { const s = closeAt(i + 3, '///'); blank(i, s); i = s; continue }
      if(c === '/' && c1 === '/') { const s = lineEnd(i); blank(i, s); i = s; continue }
      if(c === '/' && c1 === '*') { const s = closeAt(i + 2, '*/'); blank(i, s); i = s; continue }
      if(c === '#' && (coffee || !(c1 !== undefined && /[a-zA-Z_!]/.test(c1)))) { const s = lineEnd(i); blank(i, s); i = s; continue }
      // appel implicite (`s.split /@/`) : regex en Coffee et en Civet seulement
      if(c === '/' && (ouvreUneRegex(src.slice(0, i)) || (heredocs && regexEnArgument(src, i)))) {
        const fin = scanRegexLiteral(src, i)
        if(fin !== -1) { blank(i, fin); i = fin; continue }
      }
      if(heredocs && (c === '"' || c === "'") && c1 === c && c2 === c) { i = text(i, i + 3, c + c + c, c === '"' ? '#{' : null); continue }
      if(c === '`') { i = text(i, i + 1, '`', '${'); continue }
      if(c === '"' || c === "'") { i = text(i, i + 1, c, heredocs && c === '"' ? '#{' : null); continue }
      i++
    }
    return i
  }

  code(0, false)
  return chars.join('')
}

// nextMatch — prochaine occurrence d'un motif (regex globale) à partir d'une position, gardée d'un appel à l'autre :
// interrogée en avançant, la recherche lit le texte une seule fois (un motif absent ne se cherche qu'une fois jusqu'à la
// fin) ; une position plus basse relance la recherche
export function nextMatch(text: string, re: RegExp): (from: number) => RegExpExecArray | null {
  let searched = Infinity
  let found    = null as RegExpExecArray | null
  return (from: number): RegExpExecArray | null => {
    if (from < searched || (found !== null && found.index < from)) {
      re.lastIndex = from
      searched     = from
      found        = re.exec(text)
    }
    return found
  }
}

// findBlocks — blocs d'un texte, de gauche à droite, aux bornes d'un seul `replace` global de leurs motifs : `'<!--'` pour
// les commentaires (`<!--(?:-?>|[\s\S]*?--!?>)`), un nom de balise pour ses blocs (`<nom\b[^>]*>[\s\S]*?<\/nom>`, casse
// ignorée, précédé de `<nom\b[^>]*\/>` avec `selfClosing`) ; une seule regex native, une alternative par sorte, va
// d'ouverture en ouverture et lit chaque bloc d'un coup (ouverture, fin de balise ou de commentaire, fermante, chaque
// morceau facultatif et capté) : le texte entre deux ouvertures ne se relit pas en JavaScript ; une sorte qui ne peut plus
// se fermer sort de la regex, une fin absente n'est donc cherchée qu'une fois (la fermante d'une autofermante se cherche à
// part, en avançant seulement, nextMatch) : une construction jamais fermée se lit une fois, jamais jusqu'à la fin depuis
// chacune de ses ouvertures (temps linéaire)
export function findBlocks(text: string, kinds: readonly string[], selfClosing = false): { start: number, end: number, kind: string }[] {
  const blocks  = [] as { start: number, end: number, kind: string }[]
  const live    = [...kinds]
  // motif d'une sorte, trois groupes : ouverture, fin de balise ou de commentaire, fermante (vide ou absente sans elle)
  const motif   = (k: string): string => k === '<!--' ? '(<!--)((?:-?>|[\\s\\S]*?--!?>)?)()' : selfClosing ? `(<${k}\\b)([^>]*>)?()` : `(<${k}\\b)(?:([^>]*>)([\\s\\S]*?</${k}>)?)?`
  const sticky  = new Map(kinds.map((k) => [k, new RegExp(motif(k), 'iy')]))
  const closing = new Map(kinds.map((k) => [k, nextMatch(text, new RegExp(`</${k}>`, 'gi'))]))
  let openings  = new RegExp(live.map(motif).join('|'), 'gi')
  // une sorte qui ne peut plus se fermer sort de la regex des ouvertures
  const drop = (kind: string): void => {
    live.splice(live.indexOf(kind), 1)
    if (live.length > 0) openings = new RegExp(live.map(motif).join('|'), 'gi')
  }
  // fin du bloc de cette sorte ouvert en `at`, lue sur les morceaux captés par son motif ; -1 sans bloc
  const endOf = (kind: string, at: number, tag: string | undefined, close: string | undefined): number => {
    if (kind === '<!--') {
      if (tag !== '') return at + 4 + tag!.length
      // sans `-->` ni `--!>` plus loin, aucun commentaire ne se ferme plus (`<!-->` en porte un)
      drop(kind)
      return -1
    }
    // sans `>` plus loin, aucune balise de cette sorte ne se ferme plus
    if (tag === undefined) {
      drop(kind)
      return -1
    }
    const gt = at + kind.length + 1 + tag.length
    if (!selfClosing) {
      if (close !== undefined) return gt + close.length
      // sans fermante plus loin, aucun bloc de cette sorte ne s'ouvre plus
      drop(kind)
      return -1
    }
    if (text[gt - 2] === '/') return gt
    // une balise autofermante peut encore suivre : la fermante se cherche en avançant, la sorte reste
    const end = closing.get(kind)!(gt)
    return end === null ? -1 : end.index + end[0].length
  }
  let at = 0
  while (live.length > 0) {
    openings.lastIndex = at
    const m = openings.exec(text)
    if (m === null) break
    at = m.index
    // la première sorte qui s'ouvre ici, puis les suivantes (aucune sorte d'avant ne s'ouvre ici)
    let j = 0
    while (m[3 * j + 1] === undefined) j++
    const order = live.slice(j)
    let kind    = order[0]
    let end     = endOf(kind, at, m[3 * j + 2], m[3 * j + 3])
    for (let q = 1; q < order.length && end === -1; q++) {
      const s = sticky.get(order[q])!
      s.lastIndex = at
      const n = s.exec(text)
      if (n === null) continue
      kind = order[q]
      end  = endOf(kind, at, n[2], n[3])
    }
    if (end === -1) {
      at++
      continue
    }
    blocks.push({ start: at, end, kind })
    at = end
  }
  return blocks
}

// replaceBlocks — les blocs de findBlocks remplacés par `fn(bloc, sorte)`, le reste tel quel : même texte qu'un `replace`
// global de leurs motifs, en temps linéaire ; un bloc rendu tel quel ne se recopie pas
export function replaceBlocks(text: string, kinds: readonly string[], fn: (block: string, kind: string) => string, selfClosing = false): string {
  let out    = ''
  let cursor = 0
  for (const { start, end, kind } of findBlocks(text, kinds, selfClosing)) {
    const block = text.slice(start, end)
    const by    = fn(block, kind)
    if (by === block) continue
    out += text.slice(cursor, start) + by
    cursor = end
  }
  return cursor === 0 ? text : out + text.slice(cursor)
}

// maskHtmlComments — commentaires HTML `<!-- … -->` blanchis, même longueur, `\n` gardés ; chacun
// jusqu'à sa première fin (replaceBlocks) : un `<!--` jamais refermé ne masque rien (mettre un bloc de
// côté en le commentant doit le rendre inerte, jamais avaler tout le reste du fichier en silence).
export function maskHtmlComments(html: string): string {
  return replaceBlocks(html, ['<!--'], (m) => m.replace(/[^\n]/g, ' '))
}

// readHtmlComment — commentaire HTML ouvert en `i` (`<!--`), bornes du navigateur (cf. en-tête) : position qui suit sa
// fin et texte qu'il porte ; null s'il n'est jamais refermé ; la fin se cherche en avançant (nextMatch), gardée pour le
// dernier texte lu : une passe qui lit ses commentaires l'un après l'autre ne relit pas jusqu'à la fin depuis chacun
let commentText  = ''
let commentClose = nextMatch(commentText, /--!?>/g)

export function readHtmlComment(html: string, i: number): { end: number, data: string } | null {
  if (!html.startsWith('<!--', i)) return null
  if (html[i + 4] === '>') return { end: i + 5, data: '' }
  if (html.startsWith('->', i + 4)) return { end: i + 6, data: '' }
  // même texte dans une autre chaîne (un passage qui n'y a rien changé) : la recherche gardée vaut encore, et la chaîne retenue
  // devient celle-ci, que les appels suivants reconnaissent sans relire tout le texte (comparer à chaque appel deux chaînes
  // égales coûtait un temps quadratique)
  if (html !== commentText) commentClose = nextMatch(html, /--!?>/g)
  commentText = html
  const close = commentClose(i + 4)
  return close === null ? null : { end: close.index + close[0].length, data: html.slice(i + 4, close.index) }
}

// ----------------------------------------------------------------------------
// createMaskTable — table de masques réversibles du compilateur : `stash` remplace un bloc par un
// jeton, `restore` remet les blocs ; le jeton porte un sceau absent du texte à masquer : le premier
// caractère de contrôle U+0001 à U+0008 qui n'y figure pas (un caractère d'un octet : le texte masqué d'un
// texte d'un octet par caractère le reste, un sceau d'usage privé le passait à deux octets par caractère,
// plus long à recopier et à relire), sinon le premier caractère d'usage privé (U+E000 à U+F8FF) qui n'y
// figure pas, ou, si le texte les porte tous, U+F8FF répété 2, 4, 8… fois jusqu'à ne plus y figurer : la
// recherche finit toujours ; aucun texte de l'auteur ne peut donc former un jeton (un NUL suivi d'un nom de masque et
// d'un numéro, écrit dans une chaîne, reste tel quel) et `restore` ne touche que les jetons de sa
// table ; remise par passes jusqu'au point fixe : un bloc peut contenir des jetons posés avant lui
// (une chaîne d'interpolation qui cite un commentaire masqué), jamais un jeton posé après lui, d'où
// une passe par bloc au plus
export function createMaskTable(text: string, name: string): { stash: (block: string) => string; restore: (s: string) => string } {
  let code = 1
  while (code <= 8 && text.includes(String.fromCharCode(code))) code++
  if (code > 8) code = 0xe000
  let seal = String.fromCharCode(code)
  while (text.includes(seal)) seal = code < 0xf8ff ? String.fromCharCode(++code) : seal + seal
  const prefix  = `\x00${name}${seal}`
  const token   = new RegExp(`${prefix}(\\d+)\\x00`, 'g')
  const blocks  = [] as string[]
  const stash   = (block: string): string => `${prefix}${blocks.push(block) - 1}\x00`
  const restore = (s: string): string => {
    let out = s
    for (let pass = 0; pass <= blocks.length && out.includes(prefix); pass++) out = out.replace(token, (_m, i) => blocks[Number(i)])
    return out
  }
  return { stash, restore }
}
