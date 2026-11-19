// transpiler/tag-reader — découpage d'une balise ouverte (sections.ts, contrôles de build-checks.ts) : le `>` qui la ferme
// vraiment, hors valeurs entre guillemets et hors accolades `{…}`. Une accolade se lit comme du JavaScript : les
// chaînes ('…', "…"), les gabarits (`…`, `${…}` imbriqués compris), les littéraux regex (/…/) et les commentaires
// (// et /* */) y sont sautés d'un bloc — une `{`, une `}`, un `>` ou un guillemet écrits dedans ne comptent pas.
//
// Tolérant et linéaire : un guillemet ou une accolade jamais refermés sont lus comme du texte (la balise finit au
// `>` suivant) au lieu d'effacer tout ce qui suit, et une recherche qui a couru jusqu'à la fin du texte sans rien
// trouver est mémorisée pour ne pas être refaite à chaque balise suivante. Les `${` imbriqués ne sont suivis que
// sur 200 niveaux : au-delà, le gabarit est lu comme du texte (aucune pile n'est épuisée)
//
// braceCode lit une accolade par cette même lecture et en rend le code, le texte de ses chaînes et de ses commentaires
// blanchi (contrôle des liens, build-checks.ts) ; à la première forme que le compilateur peut lire autrement, il se tait

import { opensRegex, SCOPE_OPENS_REGEX } from '../sigils.js'

export interface TagReader {
  braceEnd(start: number): number
  tagEnd(start: number): number
  braceCode(start: number): BraceCode
}

/** une accolade lue par braceCode : la fin que lui trouve braceEnd, et son code — le texte de ses chaînes et de ses commentaires
 *  blanchi, même longueur, sauts de ligne gardés —, null quand le compilateur peut la lire autrement que braceEnd */
export interface BraceCode {
  end: number
  code: string | null
}

// caractères après lesquels un `/` ouvre un littéral regex plutôt qu'une division
const BEFORE_REGEX = '(,=:[!&|?{};+-*%<>~^'

// profondeur maximale de gabarits imbriqués suivis
const MAX_DEPTH = 200

// le mot qui ouvre un bloc (`{if …}`, `{for …}`, `{await …}`, `{const x = …}`) : le compilateur lit le code du bloc après lui, la
// lecture par l'arbre après `const x =` (reader/index.ts, BLOCK_KEYWORD), le parser après `const`
const BLOCK_KEYWORD = /(?:await(?:\.keep)?|success|error|if|elsif|key|for|const)\s+/y
const NAMED_CONST   = /const\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s*=(?![=>])\s*/y

export function tagReader(s: string): TagReader {
  // positions (juste après une `{`) dont l'accolade ne se referme jamais ; à partir de cette position, plus aucun
  // gabarit sans interpolation ne se referme ; à partir de celle-ci, plus aucun `*/` ; gabarits en cours de lecture
  const unclosedBraces   = new Set<number>()
  let noTemplateFrom     = Infinity
  let noCommentEndFrom   = Infinity
  let level              = 0
  // (position × dans une classe) déjà parcourus par un littéral regex qui ne se referme pas sur sa ligne : un autre
  // `/` qui y retombe sait d'avance qu'il ne se referme pas non plus
  const unclosedRegexes = new Set<number>()
  // lecture du code d'une accolade (braceCode) : les zones de texte relevées en chemin (début, fin), le doute — levé à la première
  // forme que le compilateur peut lire autrement, il arrête la lecture, et une lecture arrêtée ne mémorise rien —, l'accolade lue et
  // les débuts de son code pour le compilateur
  let zones: number[] | null = null
  let doubt                  = false
  let head                   = -1
  let headStarts: number[]   = []

  // fin de la chaîne ' ou " dont le guillemet ouvrant est à `start` : -1 si elle n'est pas refermée sur la ligne
  // (une apostrophe isolée n'ouvre alors rien)
  const stringEnd = (start: number): number => {
    const q = s[start]
    for (let i = start + 1; i < s.length; i++) {
      const c = s[i]
      if (c === '\\') i++
      else if (c === q) return i
      else if (c === '\n') return -1
    }
    return -1
  }

  // fin du littéral regex dont le `/` ouvrant est à `start` (une classe [...] peut y contenir un `/`) : -1 s'il
  // n'est pas refermé sur la ligne
  const regexEnd = (start: number): number => {
    let inClass = false
    const seen: number[] = []
    for (let i = start + 1; i < s.length; i++) {
      const key = i * 2 + (inClass ? 1 : 0)
      if (unclosedRegexes.has(key)) break
      seen.push(key)
      const c = s[i]
      if (c === '\\') i++
      else if (c === '\n') break
      else if (c === '[') inClass = true
      else if (c === ']') inClass = false
      else if (c === '/' && !inClass) return i
    }
    for (const key of seen) unclosedRegexes.add(key)
    return -1
  }

  // fin du gabarit dont l'accent grave ouvrant est à `start` (les `${…}` imbriqués sont sautés), -1 s'il n'est
  // pas refermé
  const templateEnd = (start: number): number => {
    if (start > noTemplateFrom || level >= MAX_DEPTH) return -1
    level++
    const end = readTemplate(start)
    level--
    return end
  }

  const readTemplate = (start: number): number => {
    let interpolated = false
    let text         = start + 1
    for (let i = start + 1; i < s.length; i++) {
      const c = s[i]
      if (c === '\\') i++
      else if (c === '`') {
        if (zones) zone(text, i)
        return i
      }
      else if (c === '$' && s[i + 1] === '{') {
        interpolated = true
        if (zones) zone(text, i)
        const end = braceEnd(i + 2)
        if (end === -1) return -1
        i    = end
        text = end + 1
      }
    }
    if (!interpolated) noTemplateFrom = Math.min(noTemplateFrom, start)
    return -1
  }

  // fin de l'accolade ouverte juste avant `start` : l'index de la `}` qui la ferme, -1 si elle ne l'est jamais
  const braceEnd = (start: number): number => {
    if (unclosedBraces.has(start)) {
      if (zones) doubt = true
      return -1
    }
    let depth  = 1
    const open = [start]
    let before = ''
    // lecture du code : fin de la ligne d'un `#` que le compilateur lit comme un commentaire
    let hash  = -1
    for (let i = start; i < s.length; i++) {
      if (doubt) return -1
      const c = s[i]
      if (c === '"' || c === '\'') {
        const end = stringEnd(i)
        if (zones) readString(i, end, hash)
        if (end !== -1) i = end
        before = 'a'
      }
      else if (c === '`') {
        const end = templateEnd(i)
        if (zones && (end === -1 || tripleQuotes(i) || (i < hash && (end > hash || braceBetween(i, end, false))))) doubt = true
        if (end !== -1) i = end
        before = 'a'
      }
      else if (c === '/') {
        const next = s[i + 1]
        if (next === '/') {
          const end = s.indexOf('\n', i)
          const lineEnd = end === -1 ? s.length : end
          // `///` ouvre une regex étendue de Civet ; une `}` sur la ligne arrête le commentaire du compilateur (extractBalanced), qui
          // compte aussi ses `{` dans un commentaire `#` ; JavaScript le referme dès une autre fin de ligne (jsLineEnd)
          if (zones) {
            if (s[i + 2] === '/' || braceBetween(i, lineEnd, i >= hash) || jsLineEnd(i, lineEnd)) doubt = true
            else zone(i, lineEnd)
          }
          i = lineEnd
        }
        else if (next === '*') {
          const end = i + 2 >= noCommentEndFrom ? -1 : s.indexOf('*/', i + 2)
          if (zones) {
            if (end === -1 || (i < hash && (end > hash || braceBetween(i, end, false)))) doubt = true
            else zone(i, end + 2)
          }
          if (end === -1) noCommentEndFrom = Math.min(noCommentEndFrom, i + 2)
          else i = end + 1
        }
        else if (before === '' || BEFORE_REGEX.includes(before)) {
          const end = regexEnd(i)
          if (zones) readBar(i, end, before, start, hash)
          if (end !== -1) i = end
          before = 'a'
        }
        else {
          if (zones) readBar(i, -2, before, start, hash)
          before = '/'
        }
      }
      else if ((c === '+' || c === '-') && s[i + 1] === c) {
        i++
        before = 'a'
      }
      else if (c === '{') {
        depth++
        open.push(i + 1)
        before = c
      }
      else if (c === '}') {
        open.pop()
        if (--depth === 0) return i
        before = c
      }
      else if (c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r') {
        before = c
        // un `#` hors `#nom` et `#{` : le compilateur lit la fin de sa ligne comme un commentaire (extractBalanced), ses guillemets
        // n'y ouvrent rien, ses accolades comptent
        if (zones && c === '#' && i >= hash && !/[a-zA-Z_{]/.test(s[i + 1] ?? '')) {
          const e = s.indexOf('\n', i)
          hash    = e === -1 ? s.length : e
        }
      }
    }
    for (const o of open) unclosedBraces.add(o)
    return -1
  }

  // lecture du code (braceCode) : une zone de texte, de `from` à `to` exclu
  const zone = (from: number, to: number): void => {
    if (to > from) zones!.push(from, to)
  }

  // une accolade entre `from` et `to` exclu (la fermante seule si `fermante`)
  const braceBetween = (from: number, to: number, closing: boolean): boolean => {
    for (let k = from; k < to; k++) if (s[k] === '}' || (!closing && s[k] === '{')) return true
    return false
  }

  // une fin de ligne de JavaScript entre `from` et `to` exclu, autre que le `\n` que lit braceEnd : un retour chariot seul (hors
  // `\r\n`), U+2028 ou U+2029 — un partiel est lu sans normaliser ses fins de ligne
  const jsLineEnd = (from: number, to: number): boolean => {
    for (let k = from; k < to; k++) if ((s[k] === '\r' && s[k + 1] !== '\n') || s[k] === '\u2028' || s[k] === '\u2029') return true
    return false
  }

  // trois guillemets en `q` (`'''`, `"""`, ``` `` ` ```) : une chaîne de Civet jusqu'aux trois suivants, que braceEnd lit en trois
  // (vide, texte, vide) — la même tant que son texte n'en contient pas un ; vrai quand ce n'est pas le cas (doute)
  const tripleQuotes = (q: number): boolean => {
    const g = s[q]
    if (s[q + 1] !== g || s[q + 2] !== g) return false
    const f = s.indexOf(g + g + g, q + 3)
    return f === -1 || s.slice(q + 3, f).includes(g)
  }

  // une chaîne ' ou " lue par braceEnd (guillemet ouvrant en `q`, fermant en `end`, -1 si elle ne l'est pas sur sa ligne) : le
  // compilateur la lit de même — sinon doute — quand elle se referme sur sa ligne (il lit les chaînes de plusieurs lignes), hors trois
  // guillemets qui en contiennent un, sans accolade dans un commentaire `#` (il les y compte), et quand ses `#{…}` (guillemets
  // doubles) se referment avant elle. Son texte est relevé, ses `#{…}` restent du code
  const readString = (q: number, end: number, hash: number): void => {
    if (end === -1 || tripleQuotes(q) || (q < hash && braceBetween(q, end, false))) {
      doubt = true
      return
    }
    let from = q + 1
    for (let k = q + 1; s[q] === '"' && k < end; k++) {
      if (s[k] === '\\') k++
      else if (s[k] === '#' && s[k + 1] === '{') {
        const f = braceEnd(k + 2)
        if (f === -1 || f >= end) {
          doubt = true
          return
        }
        zone(from, k)
        from = f + 1
        k    = f
      }
    }
    zone(from, end)
  }

  // ce que lit opensRegex du code qui précède la barre en `i`, depuis son début `d` : blancs de fin sautés, la queue qu'il regarde
  const beforeBar = (d: number, i: number): string => {
    let j = i
    while (j > d && /\s/.test(s[j - 1])) j--
    return s.slice(Math.max(d, j - (s[j - 1] === ')' ? SCOPE_OPENS_REGEX : 16)), j)
  }

  // une barre lue par braceEnd comme un littéral regex (refermé en `end`, -1 s'il ne l'est pas sur sa ligne) ou une division (`end`
  // = -2) : le compilateur la lit de même depuis chaque début possible de son code (opensRegex, extractBalanced), Civet aussi —
  // `a /b/ c` (un blanc avant la barre, aucun après) y appelle `a`, `a! / 2`, `a? / 2` et `& / 2` y divisent —, et aucune accolade du
  // littéral ne compte pour lui dans un commentaire `#` ; sinon doute
  const readBar = (i: number, end: number, before: string, start: number, hash: number): void => {
    const regex = (start === head ? headStarts : [start]).map((d) => opensRegex(beforeBar(d, i)))
    if (end === -2) {
      const civetCall = i > start && /\s/.test(s[i - 1]) && i + 1 < s.length && !/[\s=]/.test(s[i + 1])
      if (civetCall || regex.includes(true)) doubt = true
    }
    else if (end === -1 || regex.includes(false) || before === '!' || before === '?' || before === '&' || (i < hash && braceBetween(i, end, false))) doubt = true
  }

  // le code de l'accolade ouverte juste avant `start`, lu par braceEnd lui-même (cf. BraceCode) ; un bloc (`{if …}`, `{{…}}`) a
  // plusieurs débuts de code possibles pour le compilateur, et chaque lecture d'une barre les essaie tous
  const braceCode = (start: number): BraceCode => {
    zones      = []
    doubt      = false
    head       = start
    headStarts = s[start] === '{' ? [start, start + 1] : [start]
    for (const word of [BLOCK_KEYWORD, NAMED_CONST]) {
      word.lastIndex = start
      if (word.test(s)) headStarts.push(word.lastIndex)
    }
    const end  = braceEnd(start)
    const read = zones
    const safe = !doubt && end !== -1
    zones      = null
    doubt      = false
    head       = -1
    if (!safe) return { end, code: null }
    const code = s.slice(start, end).split('')
    for (let k = 0; k < read.length; k += 2) for (let j = read[k]; j < read[k + 1]; j++) if (s[j] !== '\n') code[j - start] = ' '
    return { end, code: code.join('') }
  }

  // fin de la balise ouverte qui commence à `start` : le `>` qui la ferme vraiment. -1 si elle n'est jamais refermée
  const tagEnd = (start: number): number => {
    for (let i = start; i < s.length; i++) {
      const c = s[i]
      if (c === '"' || c === '\'') {
        const end = s.indexOf(c, i + 1)
        if (end !== -1) i = end
      }
      else if (c === '{') {
        const end = braceEnd(i + 1)
        if (end !== -1) i = end
      }
      else if (c === '>') return i
    }
    return -1
  }

  return { braceEnd, tagEnd, braceCode }
}
