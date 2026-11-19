// reader/expression — une expression du gabarit lue par le vrai Civet puis par acorn, ses raccourcis de MJS réécrits sur
// l'arbre ESTree du JavaScript produit : `$x` → `$.x` (un nom importé reste tel quel), `$$x` → `µ.store.x`, `§x` et `§§x`
// (lecture du contexte), `@@x` → `_mjsThis.x`, `&id` → `µ.url.params.id`, les runes `µx` des formes courtes, de la langue,
// du thème et de la mise en page ; `@x`, `isnt` et la grammaire de Civet sont lus par Civet lui-même
// une seule compilation par texte (cache du lecteur) ; la carte de Civet situe chaque nom dans le texte écrit, ce qui
// sépare exactement le code de ses chaînes. Une écriture dont Civet donnerait une autre sortie que sur le texte de
// l'ancienne lecture (nom en clé ou lié, comparaison chaînée, rune à forme, expression illisible) est rendue en texte
// réécrit : chaque nom remplacé, à la place que l'arbre lui trouve. Une écriture que l'arbre ne sait pas situer revient à
// l'ancienne lecture du générateur, avec sa raison : la sortie ne change pas d'une lecture à l'autre, sauf
// où l'ancienne lecture prenait du code pour du texte (expression régulière qui contient `}`, `{`, un guillemet ou un
// accent grave dans le `${…}` d'un gabarit de texte, chaîne à trois guillemets) : elle refusait l'expression ou y
// laissait un nom sans le réécrire, l'arbre la lit juste

import * as acorn from 'acorn'
import { originalPositionFor } from '@jridgewell/trace-mapping'
import { compileText } from './code.js'
import { RESERVED_LETTERS } from './disguise.js'
import { MU_HOOKS, MU_LANG_OUT, MU_THEME_OUT, importedSingletonError, vaultRemovedError } from '../sigils.js'
import { maskInertSameLength, scriptSpans, SPAN } from '../lexer/index.js'
import { t } from '../messages/index.js'

// même grammaire que la compilation de l'ancienne lecture : `==` lu `===` (option coffeeEq), `isnt` lu `is not` (coffeeIsnt)
const DIRECTIVE = '"civet coffeeEq coffeeIsnt"\n'
// un `isnt` que l'ancienne lecture laisse en nom (ISNT_AS_NAME) : lu sans coffeeIsnt, Civet le garde en nom comme elle
const DIRECTIVE_ISNT_NAME = '"civet coffeeEq"\n'
// un gestionnaire du dialecte, lu dans la grammaire du lot des gestionnaires : `#` et `### ###` y sont des commentaires (le lot les
// change en commentaires, applyCivetDialectSugar) ; la même grammaire dit la faute d'un gestionnaire illisible (generator/utils.ts)
export const HANDLER_DIRECTIVE = '"civet coffeeComment coffeeEq coffeeIsnt"\n'
// la raison d'un gestionnaire du dialecte que Civet ne lit pas : une vraie faute de syntaxe, dite sur le texte écrit (generator/utils.ts)
export const UNREADABLE_HANDLER = 'fragment du dialecte : illisible par Civet'

// `§`, `@@` et `&id` déguisés à longueur égale en lettres d'un nom (reader/disguise.ts), `&id` aux seules places où l'ancienne
// lecture le lisait (ni après un opérande, ni suivi d'un `;` : `&amp;` reste du texte) ; une lettre de déguisement restée
// dans le JavaScript produit (chaîne, propriété, `§` nu) rend l'expression à l'ancienne lecture
const SECTION_SIGN = RESERVED_LETTERS['§']
const AROBASE      = RESERVED_LETTERS['@@']
const ESPERLUETTE  = RESERVED_LETTERS['&']
const RE_LETTER    = new RegExp(`[${Object.values(RESERVED_LETTERS).join('')}]`)

export function disguiseExpression(text: string): string {
  return text.replace(/§/g, SECTION_SIGN).replace(/@@/g, AROBASE + AROBASE).replace(/(?<![\w)\]"'`&.])&(?=[a-zA-Z_]\w*(?![\w;]))/g, ESPERLUETTE)
}

// une lettre de déguisement écrite dans un texte qui a aussi un signe à déguiser : elle y serait lue pour ce signe
export function writtenReservedLetter(text: string): boolean {
  return RE_LETTER.test(text) && disguiseExpression(text) !== text
}

// une expression qui commence par une regex (`/abc/.test($t)`) : Civet lit `(/abc/…)` comme une section d'opérateur, une fonction
// à l'écran ; elle se compile sans parenthèses, la regex reste une regex et son texte reste celui écrit
const LEADING_REGEX = /^\s*\/(?![/*])/

// une expression entourée de ses parenthèses qui commence par une regex (`(/b/.test($t))`)
const PARENTHESIZED_REGEX = /^\s*\(\s*\/(?![/*])/

// position de la parenthèse qui ferme la première de `texte`, comptée sur le code seul (lecteur du script) ; -1 si elle ne se ferme pas
function closingParen(text: string): number {
  let parenDepth = 0
  for (const [kind, start, end, depth] of scriptSpans(text)) {
    if (kind !== SPAN.CODE || depth > 0) continue
    for (let k = start; k < end; k++) {
      if (text[k] === '(') parenDepth++
      else if (text[k] === ')' && --parenDepth === 0) return k
    }
  }
  return -1
}

export function wrapper(text: string): string {
  // Civet lit `(/` comme le début d'une section d'opérateur, une fonction comme `(/ 2)` : des parenthèses qui entourent toute
  // l'expression et s'ouvrent sur une regex deviennent deux blancs (même longueur), la regex est en tête, lue comme ci-dessous
  if (PARENTHESIZED_REGEX.test(text)) {
    const closes = closingParen(text)
    const opens  = text.indexOf('(')
    if (closes === text.trimEnd().length - 1) return wrapper(text.slice(0, opens) + ' ' + text.slice(opens + 1, closes) + ' ' + text.slice(closes + 1))
  }
  if (!LEADING_REGEX.test(text)) return `(${text})`
  // sans parenthèses, Civet lit un programme : un `if` ou un `unless` placé derrière (`/b/.test($t) if $a`) en fait une instruction,
  // qui casse le code produit (seules les aides de Civet, `var modulo = …`, peuvent précéder l'expression) ; entre parenthèses, ce mot défait la section d'opérateur, l'expression se lit comme avant
  const body = (compileText(DIRECTIVE + text, 'expression').ast as any)?.body
  const read = (n: any, i: number) => i === body.length - 1 ? n.type === 'ExpressionStatement' : n.type === 'VariableDeclaration'
  return !body || (body.length > 0 && body.every(read)) ? text : `(${text})`
}

// les signes de MJS repris à la place de leurs lettres de déguisement (message de Civet sur le texte déguisé)
export function reusedSigns(text: string): string {
  return text.replaceAll(AROBASE + AROBASE, '@@').replaceAll(SECTION_SIGN, '§').replaceAll(ESPERLUETTE, '&')
}

// relevé pour l'outil de comparaison : expressions lues par l'arbre, refusées par lui et pourquoi ; `fragments` :
// les fragments de JavaScript (liaisons, corps des gestionnaires) lus par acorn
export const expressionCounters = { tree: 0, reread: 0, fragments: 0, last: '', reasons: new Map<string, number>() }

function reread(reason: string, name = ''): null {
  expressionCounters.reread++
  expressionCounters.last = name ? `« ${name} » : ${reason}` : reason
  expressionCounters.reasons.set(reason, (expressionCounters.reasons.get(reason) ?? 0) + 1)
  return null
}

// écritures réécrites par l'ancienne lecture avant Civet (`=:`, `:=`, `&$x` refusé) et runes réécrites selon ce qui les suit :
// cherchées dans tout le texte, chaînes comprises (une expression rendue de trop ne change rien)
export const NON_CIVET_SHORTHANDS = /=:|:=|&\$/
export const SHAPED_RUNES         = /µ\s*\.?\s*(?:read|write|refresh|inspect|toggle|import|every|after|derived|minmax)|mjsimport/
// `isnt` que l'ancienne lecture laisse en nom (devant `:`, `)`, `]`, `}`, `,`, `;`, cf. compileGrammarViaCivet) et que Civet, avec
// coffeeIsnt, lirait en opérateur : `(isnt)`, `($a isnt)` y deviennent des fonctions
const ISNT_AS_NAME           = /(?<![\w.$])isnt(?![\w$])(?=\s*[:)\]},;])/
// `µfailed($x)` se lit dans le gabarit (l'erreur d'une valeur dérivée qui attend) ; le crochet `µfailed (err, reset)->` y est refusé
// avant, par le générateur (generator/utils.ts, RE_MU_HOOKS_G)
const SCRIPT_RUNES        = new Set(['every', 'after', 'derived', ...MU_HOOKS.split('|').filter((h) => h !== 'failed')])
const RE_DOLLAR           = /^\$([a-zA-Z_][a-zA-Z0-9_$]*)$/
const RE_STORE            = /^\$\$([a-zA-Z_][a-zA-Z0-9_$]*)$/
const RE_MU               = /^µ([a-zA-Z]\w*)$/
const RE_PATH             = /^[\w$µ]+(?:\.[\w$]+)+$/
const DIALECT_WORDS       = new Set(['not', 'and', 'or', 'is', 'isnt', 'unless'])
const RE_CONTEXT          = new RegExp(`^${SECTION_SIGN}([a-zA-Z_]\\w*)$`)
const RE_REACTIVE_CONTEXT = new RegExp(`^${SECTION_SIGN}${SECTION_SIGN}([a-zA-Z_][a-zA-Z0-9_$]*)$`)
const RE_COMPONENT        = new RegExp(`^${AROBASE}${AROBASE}([\\w$]+)$`)
const RE_ROUTE_PARAM      = new RegExp(`^${ESPERLUETTE}([a-zA-Z_]\\w*)$`)
// noms dont l'ancienne lecture réécrivait aussi la forme écrite après deux points (`...$x`, `[1..§n]`)
const RE_TWO_DOTS        = new RegExp(`^[$${SECTION_SIGN}${AROBASE}]`)

type Place = 'reference' | 'shorthand' | 'property' | 'key' | 'bound' | 'label'

// ce que devient un nom du code : son écriture JavaScript, null s'il reste tel quel, false s'il revient à l'ancienne lecture
function rewrite(name: string, external: readonly string[], runes: { pending: boolean, signal: boolean }, expression = false): string | null | false {
  if (name[0] === '$') {
    // `$$$x` : l'ancienne lecture réécrit le `$$x` qui suit le premier `$` (`$µ.store.x`)
    const triple = /^\$\$\$([a-zA-Z_][a-zA-Z0-9_$]*)$/.exec(name)
    if (triple && expression) return external.includes(`$${triple[1]}`) ? false : `$µ.store.${triple[1]}`
    if (/^\${3,}[a-zA-Z_]/.test(name)) return false
    const store = RE_STORE.exec(name)
    if (store) return external.includes(`$${store[1]}`) ? false : `µ.store.${store[1]}`
    const variable = RE_DOLLAR.exec(name)
    if (variable) return external.includes(name) ? null : `$.${variable[1]}`
    // `$prénom` : l'ancienne lecture réécrit la partie ASCII du nom (`$pr`), la suite reste collée (`$.prénom`)
    const accented = /^\$([a-zA-Z_][a-zA-Z0-9_]*)([^\x00-\x7f][^$]*)$/.exec(name)
    if (accented && expression) return external.includes(`$${accented[1]}`) ? null : `$.${accented[1]}${accented[2]}`
    return /^[\w$]*$/.test(name) ? null : false
  }
  if (name[0] === 'µ') {
    // `µ$$x` dans une chaîne interpolée (hors chaîne, la pré-passe du transpileur l'a déjà réécrit) : `$x` s'il est importé,
    // sinon refusé ; `µ$x` refusé ; `µ$`, `µ$1` restent tels quels
    if (expression && name[1] === '$') {
      const singleton = /^µ\$\$([a-zA-Z0-9_]+)$/.exec(name)
      if (singleton) {
        if (external.includes(`$${singleton[1]}`)) return `$${singleton[1]}`
        throw new Error(t('transpiler.singleton-no-import', { name: singleton[1] }))
      }
      // `µ$x`, l'état universel, n'est déclaré que dans le <script> : le gabarit l'affichait en `µ$.x`, qui levait à l'affichage
      const universal = /^µ\$([a-zA-Z_][a-zA-Z0-9_$]*)$/.exec(name)
      if (universal) throw Object.assign(new Error(t('reader.expression-state-universal', { name: universal[1], place: '' })), { universalState: universal[1] })
      return null
    }
    const rune = RE_MU.exec(name)
    if (!rune) return name === 'µ' ? null : false
    const r = rune[1]
    if (SCRIPT_RUNES.has(r)) return false
    if (r === 'lang') return MU_LANG_OUT
    if (r === 'theme') return MU_THEME_OUT
    if (r === 'layout') return `(${external.includes('$layout') ? '$layout' : '$.layout'} || 'default')`
    if (r === 'pending' && runes.pending) return '_mjs_pnd'
    if (r === 'signal' && runes.signal) return '_mjs_sig'
    return `µ.${r}`
  }
  if (RE_LETTER.test(name[0])) {
    const reactive = RE_REACTIVE_CONTEXT.exec(name)
    if (reactive) return `_mjsThis._mjs_getRCtx('${reactive[1]}')`
    const context = RE_CONTEXT.exec(name)
    if (context) return `_mjsThis._mjs_getContext('${context[1]}')`
    const component = RE_COMPONENT.exec(name)
    if (component) return `_mjsThis.${component[1]}`
    const param = RE_ROUTE_PARAM.exec(name)
    return param ? `µ.url.params.${param[1]}` : false
  }
  return /[^\w$]/.test(name) ? false : null
}

// chaque nœud de l'arbre avec son parent, la clé qui y mène et s'il est dans un motif qui déclare (paramètre, `let`)
type Visitor = (n: any, parent: any, key: string, bound: boolean) => void

function bindsUnder(parent: any, key: string, bound: boolean): boolean {
  switch (parent.type) {
    case 'FunctionExpression': case 'ArrowFunctionExpression': case 'FunctionDeclaration': return key === 'params' || key === 'id'
    case 'ClassExpression': case 'ClassDeclaration': return key === 'id'
    case 'VariableDeclarator': return key === 'id'
    case 'CatchClause': return key === 'param'
    case 'ObjectPattern': case 'ArrayPattern': case 'RestElement': return bound
    case 'AssignmentPattern': return bound && key === 'left'
    case 'Property': return bound && key === 'value'
    default: return false
  }
}

function traverse(n: any, parent: any, key: string, bound: boolean, visit: Visitor): void {
  visit(n, parent, key, bound)
  for (const k of Object.keys(n)) {
    if (k === 'loc') continue
    const v = n[k]
    if (Array.isArray(v)) {
      for (const x of v) if (x && typeof x.type === 'string') traverse(x, n, k, bindsUnder(n, k, bound), visit)
    }
    else if (v && typeof v === 'object' && typeof v.type === 'string') traverse(v, n, k, bindsUnder(n, k, bound), visit)
  }
}

function placeOf(parent: any, key: string, bound: boolean): Place | null {
  if (parent.type === 'MemberExpression' && key === 'property' && !parent.computed) return 'property'
  if (parent.type === 'Property' && key === 'key' && !parent.computed) return parent.shorthand ? null : 'key'
  if (parent.type === 'Property' && key === 'value' && parent.shorthand) return bound ? 'bound' : 'shorthand'
  if ((parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') && key === 'key' && !parent.computed) return 'key'
  if (parent.type === 'MetaProperty') return 'key'
  if (key === 'label') return 'label'
  return bound ? 'bound' : 'reference'
}

// un fragment du gabarit que le générateur réécrit sans le compiler (liaison `:value={$x.y}`, corps d'un gestionnaire, valeur
// d'un `{const}` relue par un gestionnaire, attache) : quand il est du JavaScript, acorn le lit tel qu'écrit
// et ses raccourcis sont réécrits à leur place dans le texte, comme ceux d'une expression ; sinon (Civet ou CoffeeScript :
// `@x`, flèche `->`, appel sans parenthèses, mots `not`, `and`, `or`, `is`, `isnt`, `unless` que l'ancienne lecture traduisait
// aussi), le fragment est lu par Civet (dialectFragment, cf. dialectHandler, generator/utils.ts). Aucune compilation
// Civet ici : le fragment est compilé plus loin, avec les autres
export function fragmentByTree(text: string, external: readonly string[], runes: { pending: boolean, signal: boolean }, dialect = false): string | null {
  // code Civet ou CoffeeScript : une barre collée à ce qui la suit après un nom et une espace ouvre une expression régulière passée
  // en argument (`$v.replace /[$x-z]/g, ''`, regexInArgument), qu'acorn lirait en division et dont il réécrirait le dedans
  if (dialect && /[\w$]\s+\/(?!\s|=\s)/.test(text)) return reread('fragment : barre que Civet lit en expression régulière passée en argument')
  if (NON_CIVET_SHORTHANDS.test(text)) return reread('fragment : écriture réécrite avant Civet par l\'ancienne lecture (=:, :=, &$x refusé)')
  if (SHAPED_RUNES.test(text)) return reread('fragment : rune réécrite selon ce qui la suit')
  if (RE_LETTER.test(text)) return reread('fragment : lettre de déguisement écrite')
  const comments: acorn.Comment[] = []
  let ast: acorn.Program
  try {
    ast = acorn.parse(disguiseExpression(text), { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true, onComment: comments })
  }
  catch {
    return reread('fragment : pas du JavaScript (Civet, CoffeeScript)')
  }
  if (comments.length > 0) return reread('fragment : commentaire')
  const editions: [number, number, string][] = []
  let reason: string | null = null
  traverse(ast, null, '', false, (n, parent, key, bound) => {
    if (reason !== null || n.type !== 'Identifier' || parent === null) return
    if (DIALECT_WORDS.has(n.name)) {
      reason = 'fragment : mot que l\'ancienne lecture traduisait (not, and, or, is, isnt, unless)'
      return
    }
    const place = placeOf(parent, key, bound)
    const r     = place === null ? null : rewrite(n.name, external, runes)
    if (r === null) return
    const afterDot = text[n.start - 1] === '.' && (!RE_TWO_DOTS.test(n.name) || text[n.start - 2] !== '.')
    if (place === 'property') {
      if (!afterDot) reason = 'fragment : propriété écrite sans point devant'
    }
    else if (r === false || place !== 'reference' || afterDot) reason = `fragment : nom ${place === 'reference' ? 'rendu à l\'ancienne lecture' : 'hors d\'une lecture'}`
    else if ((n.name === 'µlayout' || n.name[0] === SECTION_SIGN) && ((parent.type === 'AssignmentExpression' && key === 'left') || parent.type === 'UpdateExpression')) reason = 'fragment : écriture de contexte ou de µlayout'
    else editions.push([n.start, n.end, r])
  })
  if (reason !== null) return reread(reason)
  editions.sort((a, b) => a[0] - b[0])
  let js     = ''
  let cursor = 0
  for (const [start, end, written] of editions) {
    js    += text.slice(cursor, start) + written
    cursor = end
  }
  js += text.slice(cursor)
  if (RE_LETTER.test(js)) return reread('fragment : lettre de déguisement restée dans la sortie')
  expressionCounters.fragments++
  return js
}

// les raisons de dialectFragment qui refusent un gestionnaire (generator/utils.ts), avec leur message ; un gestionnaire que Civet ne
// lit pas est une vraie faute de syntaxe (UNREADABLE_HANDLER)
export const HANDLER_REJECT = new Map<string, Parameters<typeof t>[0]>([
  ['fragment du dialecte : nom non situé', 'reader.expression-name-not-located'],
  ['fragment du dialecte : nom rendu à l\'ancienne lecture', 'reader.expression-name-not-read'],
  ['fragment du dialecte : écriture de contexte ou de µlayout', 'reader.expression-context-written'],
  ['fragment du dialecte : signe resté dans le texte', 'reader.expression-sign-no-name'],
  ['fragment du dialecte : raccourci à une place que le gabarit ne lit pas', 'reader.expression-shorthand-place'],
  ['fragment du dialecte : nom en clé', 'reader.expression-unreadable']
])

// `&$x` et `$x := v` refusés, `$x =: v` écrit `$x = µ.snap(v)`, avec les mots de l'ancienne lecture, quand le texte n'a ni chaîne
// ni commentaire (elle les cherchait dans le code seul) ; null : le texte revient à elle, avec sa raison
function rewrittenShorthands(text: string, external: readonly string[]): string | null {
  if (maskInertSameLength(text) !== text) return reread(t('reader.expression-shorthand-with-string'))
  const vault = /(?<![\w.])&\$([a-zA-Z_][a-zA-Z0-9_$]*)/.exec(text)
  if (vault) throw vaultRemovedError(vault[1])
  const rewritten = text.replace(/(?<![\w$]|(?<!\.)\.)\$([a-zA-Z0-9_]+)[ \t]*=:[ \t]*(.+?)(?=\n|;|$)/g, (_m, name, value) => `$${name} = µ.snap(${value})`)
  rejectDeclaration(rewritten, external)
  return NON_CIVET_SHORTHANDS.test(rewritten) ? reread(t('reader.expression-shorthand-place')) : rewritten
}

// `$x := v` refusé (`:=` déclare, un `$x` l'est déjà), sauf pour un singleton importé ; la valeur citée s'arrête au `;`, à la fin de
// la ligne ou à une fermante que l'expression n'ouvre pas
export function rejectDeclaration(text: string, external: readonly string[]): void {
  for (const m of text.matchAll(/(?<!\w|(?<!\.)\.)\$([a-zA-Z_][a-zA-Z0-9_$]*)[ \t]*:=/g)) {
    const varName = `$${m[1]}`
    if (external.includes(varName)) continue
    let preview = text.slice(m.index + m[0].length).match(/^[ \t]*([^\n;]*)/)?.[1]?.trim() || '...'
    // une fermante que l'expression n'ouvre pas (`[$x := 2]`, la liste qui l'entoure) n'est pas de la valeur
    while (/[\])}]$/.test(preview) && (preview.match(/[[({]/g)?.length ?? 0) < (preview.match(/[\])}]/g)?.length ?? 0)) preview = preview.slice(0, -1).trimEnd()
    throw new Error(t('lexer.symbol-declared-civet', { varName, preview }))
  }
}

// `$x =: v` d'un gestionnaire écrit `$x = µ.snap(v)`, lu dans le code seul (chaînes et commentaires masqués), sa valeur prise dans le
// texte écrit jusqu'au `;`, à la fin de la ligne ou du texte : une chaîne y reste entière (`$x =: "a"`) ; `&$x` et `$x :=` sont
// refusés avant (generator/utils.ts), un `a := v` reste à Civet ; null : un `=:` reste à une place que le gabarit ne lit pas
function handlerSnaps(text: string): string | null {
  const mask    = maskInertSameLength(text)
  let rewritten = ''
  let cursor    = 0
  for (const m of mask.matchAll(/(?<![\w$]|(?<!\.)\.)\$([a-zA-Z0-9_]+)[ \t]*=:/g)) {
    // les blancs qui suivent `=:` comptés dans le texte écrit : masquée, une chaîne n'est que des blancs
    let start = m.index + m[0].length
    while (text[start] === ' ' || text[start] === '\t') start++
    const end = start + (/\n|;/.exec(mask.slice(start))?.index ?? mask.length - start)
    if (m.index < cursor || end === start) continue
    rewritten += `${text.slice(cursor, m.index)}$${m[1]} = µ.snap(${text.slice(start, end)})`
    cursor     = end
  }
  rewritten += text.slice(cursor)
  return maskInertSameLength(rewritten).includes('=:') ? reread('fragment du dialecte : raccourci à une place que le gabarit ne lit pas') : rewritten
}

// une regex étendue (`///…///`), que le lot des gestionnaires lit en expression régulière et Civet seul en commentaire : remplacée, le
// temps de la lecture, par une regex de même longueur (par un gabarit, écrite sur plusieurs lignes) ; ses noms restent tels qu'écrits
function maskedHeregexes(text: string): string {
  return text.replace(/\/\/\/[\s\S]*?\/\/\/[a-z]*/g, (h) => h.includes('\n') ? `\`${h.slice(1, -1).replace(/[^\n]/g, 'x')}\`` : `/${'x'.repeat(h.length - 2)}/`)
}

// un gestionnaire du dialecte (Civet, CoffeeScript : `@x`, `->`, `not`, appel sans parenthèses, commentaire `#`), ses runes à forme,
// ses écritures de contexte et ses `unless` déjà réécrits dans le texte : lu par Civet dans la grammaire du lot des gestionnaires,
// ses noms situés par la carte et remplacés à leur place dans le texte écrit, comme l'ancienne lecture les écrivait (un nom après un
// point reste tel quel, `@x` devient `this.x`, un commentaire reste tel qu'écrit) ; une lettre de déguisement écrite, sans signe à
// déguiser, reste le nom écrit. Le texte rendu reste du dialecte, compilé plus loin avec les autres. null : le gestionnaire revient
// à l'ancienne lecture (illisible, nom qu'elle seule écrit, nom non situé, écriture de contexte qui reste)
export function dialectFragment(text: string, external: readonly string[], runes: { pending: boolean, signal: boolean }): string | null {
  if (NON_CIVET_SHORTHANDS.test(text)) {
    const rewritten = handlerSnaps(text)
    if (rewritten === null) return null
    text = rewritten
  }
  const hasLetters = RE_LETTER.test(text)
  const readable   = text.includes('///') ? maskedHeregexes(text) : text
  let c            = compileText(HANDLER_DIRECTIVE + disguiseExpression(readable), 'handler')
  // un `#` dans la partie calculée d'un gabarit (`${ a # b }`) : le lot des gestionnaires le laisse au code, Civet dans cette grammaire
  // y voit un commentaire qui avale la fin du gabarit ; relu comme le lot le lit
  if ((c.error || !c.ast) && /\$\{[^}`]*#/.test(readable)) c = compileText(DIRECTIVE + disguiseExpression(readable), 'handler')
  if (c.error || !c.ast || c.js === null || !c.trace) return reread(UNREADABLE_HANDLER)
  const starts = [0]
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1)
  // indice dans `texte` d'une position du JavaScript produit ; ligne 1 : la directive
  const locate = (loc: { line: number, column: number }): number | null => {
    const o = originalPositionFor(c.trace!, { line: loc.line, column: loc.column })
    if (o.line === null || o.line < 2 || o.line - 2 >= starts.length) return null
    let p = starts[o.line - 2] + o.column
    while (text[p] === ' ' || text[p] === '\t') p++
    return p
  }
  // chaque nom réécrit, à sa place dans le texte écrit (début → longueur, écriture)
  const names = new Map<number, [number, string]>()
  let reason: string | null = null
  traverse(c.ast, null, '', false, (n, parent, key, bound) => {
    if (reason !== null || parent === null) return
    // `@x` : `this.x`, comme l'ancienne lecture, qui réécrivait un `@` suivi d'une lettre (ni `@$x`, ni `@` seul, ni après un point)
    if (n.type === 'ThisExpression') {
      const p = locate(n.loc.start)
      if (p !== null && text[p] === '@' && /[a-zA-Z_]/.test(text[p + 1] ?? '') && !/[\w@]/.test(text[p - 1] ?? '') && (text[p - 1] !== '.' || text[p - 2] === '.')) names.set(p, [1, 'this.'])
      return
    }
    if (n.type !== 'Identifier') return
    // `µimport` est réécrit après, sur le texte rendu (rewriteMuImport), comme pour une expression ; une lettre écrite reste le nom écrit
    if (placeOf(parent, key, bound) === null || n.name === 'µimport' || (hasLetters && RE_LETTER.test(n.name[0]))) return
    // un nom sans signe de ModularJS en tête (`calculé`, `aµb`) reste tel qu'écrit, comme dans l'ancienne lecture
    if (!/^[$µ]/.test(n.name) && !RE_LETTER.test(n.name[0])) return
    // `$$$x`, `$prénom`, `µ$$X` lus comme dans une expression (l'état universel `µ$x` y est refusé)
    const r = rewrite(n.name, external, runes, true)
    if (r === null) return
    const p = locate(n.loc.start)
    if (p === null || !disguiseExpression(text.slice(p, p + n.name.length + 1)).startsWith(n.name)) {
      reason = 'fragment du dialecte : nom non situé'
      return
    }
    // l'ancienne lecture laissait un nom écrit après un point, jamais après deux (`...$x`, `[1..$n]`)
    if (text[p - 1] === '.' && (!RE_TWO_DOTS.test(n.name) || text[p - 2] !== '.')) return
    if (r === false) reason = 'fragment du dialecte : nom rendu à l\'ancienne lecture'
    else if ((n.name === 'µlayout' || n.name[0] === SECTION_SIGN) && ((parent.type === 'AssignmentExpression' && key === 'left') || parent.type === 'UpdateExpression')) reason = 'fragment du dialecte : écriture de contexte ou de µlayout'
    // réécrit en clé d'objet ou en étiquette (`{$x: 1}` → `{$.x: 1}`), le nom n'en serait plus une : refusé sur le texte écrit
    else if (r !== n.name && (placeOf(parent, key, bound) === 'key' || placeOf(parent, key, bound) === 'label')) reason = 'fragment du dialecte : nom en clé'
    else names.set(p, [n.name.length, r])
  })
  if (reason !== null) return reread(reason)
  let rewritten = ''
  let cursor    = 0
  for (const [start, [length, written]] of [...names].sort((a, b) => a[0] - b[0])) {
    rewritten += text.slice(cursor, start) + written
    cursor     = start + length
  }
  rewritten += text.slice(cursor)
  if (/(?<![.§])§|@@|(?<![\w.&)\]])&(?=[a-zA-Z_$])/.test(maskInertSameLength(rewritten))) return reread('fragment du dialecte : signe resté dans le texte')
  expressionCounters.fragments++
  return rewritten
}

// le JavaScript de l'expression, avant les retouches de fin du générateur (point-virgule, parenthèses autour), ou null
// quand elle revient à l'ancienne lecture ; `texte` : l'expression écrite, ses interpolations `#{…}` déjà converties
// ou `{ reecrit }` : le texte écrit, ses noms réécrits à la place que l'arbre leur trouve, que le générateur compile comme le
// texte de l'ancienne lecture (comparaison chaînée, nom en clé ou en paramètre, objet abrégé qui n'est pas un chemin, signe
// resté après un point, lettre de déguisement écrite, runes à forme déjà réécrites dans le texte : `runesWritten`) ; une
// expression illisible sans aucun raccourci y est rendue telle quelle, pour le message de Civet sur ce même texte
export function expressionByTree(text: string, external: readonly string[], runes: { pending: boolean, signal: boolean }, runesWritten = false): string | { rewritten: string } | null {
  if (NON_CIVET_SHORTHANDS.test(text)) {
    const rewritten = rewrittenShorthands(text, external)
    if (rewritten === null) return null
    text = rewritten
  }
  if (!runesWritten && SHAPED_RUNES.test(text)) return reread(t('reader.expression-rune-place'))
  const isntName = ISNT_AS_NAME.test(text)
  if (isntName && (text.match(/(?<![\w.$])isnt(?![\w$])/g) ?? []).length > 1) return reread(t('reader.expression-two-isnt'))
  // une lettre de déguisement écrite dans un texte sans aucun signe à déguiser reste le nom écrit (`Ꞩy`), lu par le texte réécrit
  const hasLetters = RE_LETTER.test(text)
  if (writtenReservedLetter(text)) return reread(t('reader.expression-letter-reserved-written'))
  const viaText   = runesWritten || hasLetters
  const disguised = disguiseExpression(text)
  const wrapped   = wrapper(disguised)
  const c         = compileText((isntName ? DIRECTIVE_ISNT_NAME : DIRECTIVE) + wrapped, 'expression')
  const opening   = wrapped.length === disguised.length ? 0 : 1
  if (c.error || !c.ast || c.js === null || !c.trace) {
    // un objet écrit comme corps de flèche (`(r) -> { ...r }`) : Civet y lit un bloc
    if (/(?:->|=>)\s*\{\s*\.\.\./.test(text)) return reread(t('reader.expression-object-arrow-body'))
    if (/[$§@µ]/.test(text) || disguiseExpression(text) !== text) return reread(t('reader.expression-unreadable'))
    expressionCounters.tree++
    return { rewritten: text }
  }
  const starts = [0]
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1)
  // indice dans `texte` d'une position du JavaScript produit ; ligne 1 : la directive, ligne 2 : la parenthèse ouvrante, sauf regex en tête
  const locate = (loc: { line: number, column: number }): number | null => {
    const o = originalPositionFor(c.trace, { line: loc.line, column: loc.column })
    if (o.line === null || o.line < 2 || o.line - 2 >= starts.length) return null
    let p = o.line === 2 ? o.column - opening : starts[o.line - 2] + o.column
    while (text[p] === ' ' || text[p] === '\t') p++
    return p
  }
  const editions: [number, number, string][] = []
  const places                               = new Set<number>()
  const dollars: any[]                       = []
  const leftSides                            = new Set<number>()
  // l'expression entière, sous ses parenthèses : la seule écriture de contexte lue par l'arbre
  const root  = (c.ast as any).body?.[0]?.expression
  // chaque nom réécrit, à sa place dans le texte écrit (début → longueur, écriture) ; `recompiler` : la raison de passer par
  // le texte réécrit
  const names = new Map<number, [number, string]>()
  let reason: string | null = null
  let recompiler: string | null = null
  let writesContext = false
  let faulty = ''
  traverse(c.ast, null, '', false, (n, parent, key, bound) => {
    if (reason !== null || n.type !== 'Identifier' || parent === null) return
    const place = placeOf(parent, key, bound)
    if (place === null) return
    // `µimport` est réécrit après l'arbre, sur le texte réécrit ; une lettre écrite reste le nom écrit
    if ((runesWritten && n.name === 'µimport') || (hasLetters && RE_LETTER.test(n.name[0]))) return
    // le paramètre `$` que Civet donne à une fonction abrégée (`&.prix > $min`, `.fait`) : `$.min`, réécrit dedans, y lirait
    // l'élément ; l'ancienne lecture, qui écrit `$.min` avant Civet, lui fait nommer ce paramètre `$1`
    if (n.name === '$') {
      dollars.push(n)
      return
    }
    if (n.name === 'isnt' && place === 'reference' && !isntName) {
      recompiler ??= '`isnt` (normalisé en `is not` par l\'ancienne lecture)'
      return
    }
    const r = rewrite(n.name, external, runes, true)
    if (r === null) return
    const p = locate(n.loc.start)
    if (p === null || !disguiseExpression(text.slice(p, p + n.name.length + 1)).startsWith(n.name)) {
      reason = t('reader.expression-name-not-located')
      return
    }
    // l'ancienne lecture laissait un nom écrit après un point (`obj.$x`, `a?.$x`, un `µx` après tout point), jamais après
    // deux (`...$liste`) : une propriété autrement écrite (`@$x`, `a::$x`) ou un nom lu après un point revient à elle
    const afterDot = text[p - 1] === '.' && (!RE_TWO_DOTS.test(n.name) || text[p - 2] !== '.')
    if (place === 'property') {
      // `@$x`, `a::$x` : l'ancienne lecture réécrivait le nom, Civet en fait une propriété (`this.$.x`)
      if (afterDot || r === null) return
      if (r === false) reason = t('reader.expression-property-no-dot')
      else {
        editions.push([n.start, n.end, r])
        names.set(p, [n.name.length, r])
      }
      return
    }
    // l'ancienne lecture laissait le nom écrit après un point (`[1..µmax]`)
    if (afterDot && place === 'reference') return
    faulty = text.slice(p, p + n.name.length)
    const singleton = r === false ? RE_STORE.exec(n.name) : null
    if (singleton && external.includes(`$${singleton[1]}`)) throw importedSingletonError(singleton[1])
    // un signe seul (`/§/.test($t)`) : déguisé, Civet lit la barre en division et la lettre en nom ; le texte réécrit garde
    // l'expression régulière écrite
    if (r === false && n.name.length === 1 && RE_LETTER.test(n.name)) {
      recompiler ??= 'signe seul que Civet lit autrement une fois déguisé'
      return
    }
    if (r === false) {
      reason = t('reader.expression-name-not-read')
      return
    }
    if (place === 'key' || place === 'bound' || place === 'label') {
      recompiler ??= `nom en ${place === 'key' ? 'clé' : place === 'bound' ? 'paramètre ou nom lié' : 'étiquette'}`
      names.set(p, [n.name.length, r])
      return
    }
    if (afterDot) {
      reason = t('reader.expression-name-after-dot')
      return
    }
    if (n.name === 'µlayout' && ((parent.type === 'AssignmentExpression' && key === 'left') || parent.type === 'UpdateExpression')) throw new Error(t('lexer.mu-layout-written'))
    if (n.name[0] === SECTION_SIGN && ((parent.type === 'AssignmentExpression' && key === 'left') || parent.type === 'UpdateExpression')) {
      // `§x = v`, `§§x = v`, toute l'expression : l'appel du setter, comme l'ancienne lecture (`this._mjs_setContext('x', v)`)
      const reactive = RE_REACTIVE_CONTEXT.exec(n.name)
      const simple   = RE_CONTEXT.exec(n.name)
      if (parent.type === 'AssignmentExpression' && parent.operator === '=' && root === parent && (reactive || simple)) {
        editions.push([parent.start, parent.right.start, `this.${reactive ? '_mjs_setRCtx' : '_mjs_setContext'}('${(reactive ?? simple)![1]}', `])
        editions.push([parent.right.end, parent.right.end, ')'])
        places.add(p)
        writesContext = true
        return
      }
      reason = t('reader.expression-context-written')
      return
    }
    // `$x |>= f` : Civet recopie la cible d'une affectation dans sa valeur (`$.x = f($.x)`, comme l'ancienne lecture) ; une
    // comparaison chaînée, elle, prend une variable `ref` sur un membre seulement
    if (places.has(p) && leftSides.has(p)) {
      editions.push([n.start, n.end, r as string])
      return
    }
    if (parent.type === 'AssignmentExpression' && key === 'left') leftSides.add(p)
    if (places.has(p)) {
      recompiler ??= 'nom recopié par Civet (lu deux fois : comparaison chaînée, affectation conditionnelle)'
      return
    }
    places.add(p)
    names.set(p, [n.name.length, r as string])
    if (place === 'shorthand') {
      if (!RE_PATH.test(r as string)) recompiler ??= 'objet abrégé dont la valeur n\'est pas un chemin'
      else editions.push([parent.start, parent.end, `${(r as string).slice((r as string).lastIndexOf('.') + 1)}: ${r}`])
      return
    }
    editions.push([n.start, n.end, r as string])
  })
  if (reason !== null) return reread(reason, faulty)
  // le texte écrit, chaque nom remplacé par son écriture : ce que l'ancienne lecture donnait à Civet (un commentaire reste tel
  // qu'écrit, elle en réécrivait aussi les noms) ; une écriture de contexte ou un signe de MJS resté dans le code sont refusés
  const byNames = (): { rewritten: string } | null => {
    if (writesContext) return reread(t('reader.expression-context-and-rewrite'))
    let rewritten = ''
    let cursor    = 0
    for (const [start, [length, written]] of [...names].sort((a, b) => a[0] - b[0])) {
      rewritten += text.slice(cursor, start) + written
      cursor     = start + length
    }
    rewritten += text.slice(cursor)
    if (/(?<![.§])§|@@/.test(maskInertSameLength(rewritten))) return reread(t('reader.expression-sign-no-name'))
    expressionCounters.tree++
    return { rewritten }
  }
  if (recompiler !== null || viaText) return byNames()   // rune à forme ou lettre de déguisement écrite
  // le `$` qu'une fonction abrégée (`&.prix`, `.fait`) reçoit de Civet : l'ancienne lecture, qui écrivait `$.x` avant Civet,
  // lui faisait nommer ce paramètre `$1` ; un `$` écrit dans l'expression (`$[$k]`) passe par le texte réécrit, où Civet nomme
  // ses paramètres comme sur celui de l'ancienne lecture
  if (dollars.length > 0) {
    if (/(?<![\w$])\$(?![\w$])|(?<![\w$])\$1(?![\w$])/.test(text)) return byNames()   // `$` écrit dans l'expression, que Civet donne aussi à une fonction abrégée
    if (editions.some((e) => /(?<![\w$])\$\./.test(e[2]))) for (const n of dollars) editions.push([n.start, n.end, '$1'])
  }
  // une lettre de déguisement restée dans le JavaScript produit : dans une chaîne, un gabarit de texte, une expression
  // régulière ou un commentaire, elle reprend son signe (l'ancienne lecture laissait ce texte tel quel) ; ailleurs, l'expression
  // revient à l'ancienne lecture
  if (RE_LETTER.test(c.js)) {
    const texts: [number, number][] = [...c.comments.map((k): [number, number] => [k.start, k.end]), ...editions.map((e): [number, number] => [e[0], e[1]])]
    traverse(c.ast, null, '', false, (n) => {
      if (n.type === 'Literal' || n.type === 'TemplateElement') texts.push([n.start, n.end])
    })
    for (const m of c.js.matchAll(new RegExp(RE_LETTER.source, 'g'))) {
      if (!texts.some(([start, end]) => m.index >= start && m.index < end)) return byNames()   // lettre de déguisement restée dans la sortie (propriété, raccourci nu)
    }
  }
  editions.sort((a, b) => a[0] - b[0])
  let js     = ''
  let cursor = 0
  for (const [start, end, written] of editions) {
    js    += c.js.slice(cursor, start) + written
    cursor = end
  }
  js += c.js.slice(cursor)
  if (RE_LETTER.test(js)) js = reusedSigns(js)
  if (RE_LETTER.test(js)) return reread(t('reader.expression-letter-reserved-left'))
  expressionCounters.tree++
  return js
}
