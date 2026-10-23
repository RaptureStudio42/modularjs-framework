// transpiler/tag-reader — découpage d'une balise ouverte, partagé par les lints a11y et <form> : le `>` qui la ferme
// vraiment, hors valeurs entre guillemets et hors accolades `{…}`. Une accolade se lit comme du JavaScript : les
// chaînes ('…', "…"), les gabarits (`…`, `${…}` imbriqués compris), les littéraux regex (/…/) et les commentaires
// (// et /* */) y sont sautés d'un bloc — une `{`, une `}`, un `>` ou un guillemet écrits dedans ne comptent pas.
//
// Tolérant et linéaire : un guillemet ou une accolade jamais refermés sont lus comme du texte (la balise finit au
// `>` suivant) au lieu d'effacer tout ce qui suit, et une recherche qui a couru jusqu'à la fin du texte sans rien
// trouver est mémorisée pour ne pas être refaite à chaque balise suivante. Les `${` imbriqués ne sont suivis que
// sur 200 niveaux : au-delà, le gabarit est lu comme du texte (aucune pile n'est épuisée)

export interface TagReader {
  braceEnd(start: number): number
  tagEnd(start: number): number
}

// caractères après lesquels un `/` ouvre un littéral regex plutôt qu'une division
const BEFORE_REGEX = '(,=:[!&|?{};+-*%<>~^'

// profondeur maximale de gabarits imbriqués suivis
const MAX_DEPTH = 200

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
    for (let i = start + 1; i < s.length; i++) {
      const c = s[i]
      if (c === '\\') i++
      else if (c === '`') return i
      else if (c === '$' && s[i + 1] === '{') {
        interpolated = true
        const end = braceEnd(i + 2)
        if (end === -1) return -1
        i = end
      }
    }
    if (!interpolated) noTemplateFrom = Math.min(noTemplateFrom, start)
    return -1
  }

  // fin de l'accolade ouverte juste avant `start` : l'index de la `}` qui la ferme, -1 si elle ne l'est jamais
  const braceEnd = (start: number): number => {
    if (unclosedBraces.has(start)) return -1
    let depth  = 1
    const open = [start]
    let before = ''
    for (let i = start; i < s.length; i++) {
      const c = s[i]
      if (c === '"' || c === '\'') {
        const end = stringEnd(i)
        if (end !== -1) i = end
        before = 'a'
      }
      else if (c === '`') {
        const end = templateEnd(i)
        if (end !== -1) i = end
        before = 'a'
      }
      else if (c === '/') {
        const next = s[i + 1]
        if (next === '/') {
          const end = s.indexOf('\n', i)
          i = end === -1 ? s.length : end
        }
        else if (next === '*') {
          const end = i + 2 >= noCommentEndFrom ? -1 : s.indexOf('*/', i + 2)
          if (end === -1) noCommentEndFrom = Math.min(noCommentEndFrom, i + 2)
          else i = end + 1
        }
        else if (before === '' || BEFORE_REGEX.includes(before)) {
          const end = regexEnd(i)
          if (end !== -1) i = end
          before = 'a'
        }
        else before = '/'
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
      else if (c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r') before = c
    }
    for (const o of open) unclosedBraces.add(o)
    return -1
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

  return { braceEnd, tagEnd }
}
