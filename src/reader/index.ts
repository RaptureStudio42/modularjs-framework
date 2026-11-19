// reader — le lecteur unique d'un fichier .mjs : un seul arbre pour tout le fichier
// le gabarit, les sections et les directives de racine sont lus ici ; chaque morceau de code (script, expression
// `{…}`, gestionnaire `@click={…}`) est lu par le vrai Civet puis par acorn (reader/code.ts), avec la position de
// chaque nœud dans le fichier. Le compilateur lit le gabarit d'un composant par ce lecteur (option `gabarit`,
// parser/index.ts : readViaTree) ; l'outil script/compare-lecteur.ts compare ses passes à celles d'aujourd'hui sur
// tout un corpus.

import { AT_RESERVED_NAMES, Scanner, extractBalanced, extractSettings } from '../parser/index.js'
import { SIGN_RE } from '../parser/mjs-words.js'
import { opensHashBlock } from '../lexer/index.js'
import { sectionBounds, type SectionBound } from '../transpiler/sections.js'
import { readCode } from './code.js'
import { reservedLettersOf, reservedLetterMessage } from './disguise.js'
import { lineStarts, locate } from './positions.js'
import type { TagAttr, Tag, Block, Branch, Code, Diagnostic, File, TagShape, ModeCode, Node, Script, Section, Style } from './types.js'

export * from './types.js'
export { lineStarts, locate, positionOf, formatPosition } from './positions.js'
export { disguise, reveal, RESERVED_LETTERS } from './disguise.js'
export { codeCounters, clearCodeCache, toFile } from './code.js'

export interface ReadOptions {
  file?: string                      // chemin, repris dans chaque position (`fichier:ligne:colonne`)
  lang?: string                       // langue d'un script sans `lang`, ou d'un module (civet par défaut)
  module?: boolean                      // fichier sans gabarit, un seul script ; par défaut : `.civet` et `*.server.mjs`
  // le gabarit seul, tel que le compilateur le prépare (sections retirées, directives lues, partiels versés) : ni
  // section ni directive, le texte lu tel quel (positions de ce texte), le code découpé par la lecture du compilateur
  // (extractBalanced) sans être compilé
  template?: boolean
  // gabarit seul : son code est du Civet ou du CoffeeScript (`languages.template` hors `js`), où une regex se passe aussi sans
  // parenthèses (`$v.replace /}/g, ''`) — la lecture du compilateur la lit alors de même (Scanner.dialecte)
  dialect?: boolean
  // false : sections et directives lues comme d'habitude, le code découpé sans être compilé (relevés qui ne lisent que
  // les balises et leurs attributs, transpiler/template-tree.ts) ; seule une accolade que la découpe faite main ne ferme
  // pas essaie encore ses fins par Civet (codeEnd)
  compiler?: boolean
  // false : une ligne de racine en `@` est un texte, jamais une directive (relevés des balises, transpiler/template-tree.ts) ; le
  // compilateur ne prend pour directive que ses mots (`@import`, `@persist`…), une ligne de prose `@nom <@@img …>` reste du gabarit
  directives?: boolean
  // gabarit seul, ses partiels pas encore versés (le compilateur y cherche les `<@include>`) : `<@include x>` n'a pas
  // d'enfants, comme dans un fichier entier
  partial?: boolean
}

const VOID_TAGS      = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
// comme l'extraction des sections du compilateur (transpiler/sections.ts) : `<theme-toggle>`, `<effects-demo>`, `<vars/>` sont des
// balises du gabarit, pas des sections
const RAW_TAGS    = /^<(script|style|(?:theme|routes|vars|types|effects)(?=[\s>]))\b/i
const TAG         = /^<(@@?[a-zA-Z0-9-]+|[a-zA-Z][a-zA-Z0-9-]*)/
const CLOSING_TAG = /^<\/([a-zA-Z0-9\-@]+)\s*>/
const ATTR_NAME   = /^[a-zA-Z0-9:@\-._]+/
const EFFECT      = /^\*([A-Za-z][\w-]*(?:\.[\w.-]*)?)/
// lues depuis un indice, sur le texte entier (readAt) : jamais une tranche, qui coupait 60 blancs autour du `=` d'un attribut, une
// valeur nue de plus de 500 signes ou une directive de racine de plus de 200
const EQUALS     = /\s*=\s*/y
const BARE_VALUE = /(?:[^\s>/]|\/(?!>))+/y
const DIRECTIVE  = /@([A-Za-z]\w*)[^\n]*/y
// classe ou style conditionnels, avec le signe des mots de MJS (`:class{…}=…`, `:style.prop{…}=…`)
const CLASS_WORD = new RegExp('^' + SIGN_RE + String.raw`(class|style\.[a-zA-Z0-9-]+)\{`)
// `{await.keep …}` : un {await} dont l'option s'écrit sur le mot du bloc (cf. parser/index.ts, AWAIT_KEEP) ; son expression commence après le mot
const BLOCKS       = /^(if|elsif|for|await(?:\.keep)?|success|error|key|const)\s+/
const GESTURE_ATTR = /^@(?!class|style|in\b|out\b|transition|title)/
// éléments HTML à texte brut (cf. server/prerender.ts) : le navigateur ne lit aucune balise dans leur contenu
const RAW_TEXT = new Set(['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext'])
// un commentaire HTML : jusqu'à `-->` ou `--!>`, `<!-->` et `<!--->` refermés d'emblée (comme le navigateur)
const COMMENT = /<!--(?:-?>|[\s\S]*?--!?>)/y
// dans un <textarea> ou un <title>, une balise écrite est un texte, jusqu'à son `>`
const TEXT_TAG   = /<\/?[^<>]*>?/y
const READ_LANGS = new Set(['civet', 'coffee'])
// CHOIX — `}` essayées au plus quand la découpe faite main d'une région de code échoue
const END_ATTEMPTS = 50
// gabarit seul : où le compilateur commence la lecture d'une accolade (parser/index.ts, extractBalanced) — après le mot d'un bloc
// et ses blancs, après `{const nom =` ; `{/if}` et ses pareils, qu'il refuse sans les lire
const BLOCK_KEYWORD = /\{(?:await(?:\.keep)?|success|error|if|elsif|key|for)\s+|\{const\s+(?:[a-zA-Z_$][a-zA-Z0-9_$]*\s*=(?![=>])\s*)?/y
const SLASH_CLOSING = /\{\/(?:if|for|each|await|key)\}/y
// une ouvrante de section comme les cherche le compilateur, où qu'elle soit : un fichier qui n'en a aucune n'a aucune section
const SECTION_OPENING = /<(?:script|style|theme|routes|vars|types|effects)/

// ---------------------------------------------------------------- découpe des régions de code du gabarit

// fin d'une chaîne qui commence en i (guillemet compris) ; les interpolations `#{…}` et `${…}` sont des régions de code
function stringEnd(src: string, i: number): number {
  const q = src[i]
  if (src.startsWith(q + q + q, i)) {
    const e = src.indexOf(q + q + q, i + 3)
    return e < 0 ? -1 : e + 3
  }
  i++
  while (i < src.length) {
    const c = src[i]
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === q) return i + 1
    if ((q === '"' && c === '#' && src[i + 1] === '{') || (q === '`' && c === '$' && src[i + 1] === '{')) {
      const e = regionEnd(src, i + 2, '}')
      if (e < 0) return -1
      i = e + 1
      continue
    }
    i++
  }
  return -1
}

// indice du caractère fermant (`}` ou `)`) d'une région de code qui commence en i ; -1 si elle ne se referme pas
// découpe faite main du fichier entier : le contenu est ensuite lu par le vrai Civet, qui refuse une découpe fausse (jamais
// en silence) ; le gabarit seul, dont le code n'est pas compilé ici, est découpé par la lecture du compilateur (compiledEnd)
export function regionEnd(src: string, i: number, closing: '}' | ')'): number {
  const opening = closing === '}' ? '{' : '('
  let depth = 0
  while (i < src.length) {
    const c = src[i]
    if (c === '\'' || c === '"' || c === '`') {
      const e = stringEnd(src, i)
      if (e < 0) return -1
      i = e
      continue
    }
    if (opensHashBlock(src, i)) {
      const e = src.indexOf('###', i + 3)
      if (e < 0) return -1
      i = e + 3
      continue
    }
    // commentaire de ligne : jusqu'à la fin de la ligne, ou jusqu'au fermant de la région (`{$x // note}`, comme le lecteur d'aujourd'hui)
    if ((c === '#' && /[ \t#]/.test(src[i + 1] ?? ' ')) || (c === '/' && src[i + 1] === '/')) {
      while (i < src.length && src[i] !== '\n' && !(src[i] === closing && depth === 0)) i++
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2)
      if (e < 0) return -1
      i = e + 2
      continue
    }
    if (c === opening) depth++
    else if (c === closing) {
      if (depth === 0) return i
      depth--
    }
    i++
  }
  return -1
}

function shapeOf(name: string): TagShape {
  const low = name.toLowerCase()
  if (name.startsWith('@@')) return 'core'
  if (name.startsWith('@')) return AT_RESERVED_NAMES.includes(name.slice(1)) ? 'reserved' : 'project'
  if (low.startsWith('mjs-core-')) return 'core-literal'
  if (low.startsWith('mjs-')) return 'mjs'
  return 'html'
}

// le nom d'une balise dans le gabarit compilé (`<@x>` → `mjs-x`, `<@@x>` → `mjs-core-x`, `<@view>` → `metamjs-view`,
// `<@slot>` → `slot`) : une fermante referme sa balise sous l'un ou l'autre nom, casse comprise, comme le compilateur
function compiledName(name: string): string {
  if (name === '@view') return 'metamjs-view'
  if (name === '@slot') return 'slot'
  if (name.startsWith('@@')) return 'mjs-core-' + name.slice(2)
  if (name.startsWith('@')) return AT_RESERVED_NAMES.includes(name.slice(1)) ? name : 'mjs-' + name.slice(name.startsWith('@mjs-') ? 5 : 1)
  return name
}

// un code découpé sans être compilé (gabarit lu pour le compilateur)
function uncompiledCode(start: number, end: number, mode: ModeCode): Code {
  return { kind: 'code', mode, start, end, js: null, ast: null, comments: [], texts: [], names: [], directives: [], error: null, map: null }
}

// ---------------------------------------------------------------- le fichier

// une regex collante (drapeau `y`) lue à l'indice i du texte entier
function readAt(re: RegExp, text: string, i: number): RegExpExecArray | null {
  re.lastIndex = i
  return re.exec(text)
}

// lit un fichier .mjs (ou un module `.civet`, `*.server.mjs`) en un arbre ; ne lève jamais : chaque faute de lecture
// est un diagnostic, à sa position
export function readFile(text: string, options: ReadOptions = {}): File {
  const template   = options.template === true
  const src        = template ? text : text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const path       = options.file ?? 'inline.mjs'
  const lang       = options.lang ?? 'civet'
  const file: File = { kind: 'file', path, source: src, lineStarts: lineStarts(src), start: 0, end: src.length, children: [], codes: [], diagnostics: [] }
  const fault      = (message: string, start: number, quote?: Diagnostic['quote']): void => {
    const { line, column } = locate(file.lineStarts, start)
    const d: Diagnostic = { message, start, line, column, position: `${path}:${line}:${column}` }
    if (quote !== undefined) d.quote = quote
    file.diagnostics.push(d)
  }
  if (!template) for (const i of reservedLettersOf(src)) fault(reservedLetterMessage(src[i]), i)
  // le texte où se lit le code : le fichier, ou le gabarit relu sans les sections que le compilateur lit hors de la lecture (plus bas)
  let codeText = src
  const code = (start: number, end: number, mode: ModeCode, codeLang?: string): Code => {
    if (template || options.compiler === false) {
      const piece = uncompiledCode(start, end, mode)
      file.codes.push(piece)
      return piece
    }
    const read = readCode(codeText, start, end, mode, path, mode !== 'script', codeLang)
    file.codes.push(read)
    if (read.error) {
      const what = mode === 'script' ? 'ce script' : mode === 'handler' ? 'ce gestionnaire' : 'cette expression'
      fault(read.js === null ? `Civet ne lit pas ${what} : ${read.error.message}` : `le JavaScript produit pour ${what} ne se lit pas : ${read.error.message}`, read.error.start)
    }
    return read
  }
  if (!template && (options.module ?? /\.(civet|civet\.mjs|server\.mjs)$/.test(path))) {
    const script: Script = { kind: 'script', start: 0, end: src.length, lang, module: true, attrs: '', body: { start: 0, end: src.length }, code: null, unread: null }
    script.code = code(0, src.length, 'script', lang)
    file.children.push(script)
    return file
  }
  const readItems = { bounds: null as ReadBounds | null }
  const already   = file.diagnostics.length
  const read      = (text: string): SectionBound[] => readTemplate(text, file, lang, template, options.dialect === true, options.directives !== false, fault, code, options.partial === true, readItems)
  // une section que le compilateur lit là où le lecteur ne s'arrête pas (dans une valeur d'attribut, une expression `{…}`, un
  // <![CDATA[) : il la retire du gabarit avant de le lire ; le gabarit est relu sans elle, blanchie à longueur égale, la première
  // manquée d'abord (une section manquée peut n'être que la suite d'une autre, lue de travers avant elle)
  const blanked: SectionBound[] = []
  for (let missed = read(src); ;) {
    const first = missed.find(b => !blanked.includes(b))
    if (first === undefined) break
    blanked.push(first)
    file.children.length    = 0
    file.codes.length       = 0
    file.diagnostics.length = already
    codeText                = withoutSections(src, blanked)
    missed                  = read(codeText)
  }
  return file
}

type Open = File | Tag | Block

// les sections que le compilateur lit dans un fichier (sectionBounds), par position de leur `<`, et ses blocs <@head> / <@failed>
interface ReadBounds {
  sections: Map<number, SectionBound>
  blocks:    Array<[number, number]>
}

// le texte où chaque section donnée est blanchie à longueur égale, sauts de ligne gardés
function withoutSections(src: string, sections: SectionBound[]): string {
  let out = ''
  let cur = 0
  for (const s of [...sections].sort((a, b) => a.start - b.start)) {
    if (s.start < cur) continue
    out += src.slice(cur, s.start) + src.slice(s.start, s.end).replace(/[^\n]/g, ' ')
    cur  = s.end
  }
  return out + src.slice(cur)
}

// lit le gabarit de `src` dans `fichier` ; rend les sections que le compilateur lit et que cette lecture n'a pas posées (dans une valeur
// d'attribut, une expression `{…}`, un <![CDATA[), hors de celles qu'une autre contient (un <script module> écrit dans un <script>,
// lu avec lui). `readCache` : les sections du compilateur, cherchées une fois dans le texte reçu par readFile
function readTemplate(src: string, file: File, lang: string, template: boolean, dialect: boolean, directives: boolean, fault: (message: string, start: number, quote?: Diagnostic['quote']) => void, code: (start: number, end: number, mode: ModeCode, codeLang?: string) => Code, partial: boolean, readCache: { bounds: ReadBounds | null }): SectionBound[] {
  const stack: Open[] = [file]                // éléments et blocs ouverts
  // le guillemet d'une valeur d'attribut jamais refermé (readValue) : la balise qui le porte n'est jamais terminée
  let endlessQuote: Diagnostic['quote']
  // la fin du dernier texte lu jusqu'au prochain `<` ou `{` : une fermante dont le nom ne commence pas par une lettre (`</3>`,
  // `</-a>`) écrite là est lue dans ce texte, comme le compilateur lit la suite de caractères d'un texte (TEXT_RUN_RE), et part
  // telle quelle dans le gabarit compilé, où le navigateur en fait un commentaire (aucune balise, aucun texte affiché) ; en tête
  // d'un nœud, elle reste une fermante
  let textEnd = -1
  // les éléments à texte brut ouverts hors d'un dessin (RAW_TEXT) : une balise écrite dans leur contenu n'en est pas une
  // pour le navigateur, un guillemet jamais refermé dans ses attributs non plus
  const rawTexts  = new Set<Tag>()
  const inRawText = (): boolean => stack.some((o) => o.kind === 'tag' && rawTexts.has(o))
  const lists     = new Map<Tag, Node[]>()        // la liste où chaque balise qui peut être rendue vide a été posée
  const open      = (): Open => stack[stack.length - 1]
  const children  = (): Node[] => {
    const o = open()
    return o.kind === 'block' ? o.branches[o.branches.length - 1].children : o.children
  }
  const set = <N extends Node>(n: N): N => {
    children().push(n)
    return n
  }
  const atLineStart = (i: number): boolean => /^[ \t]*$/.test(src.slice(src.lastIndexOf('\n', i - 1) + 1, i))
  // fin d'une balise ouvrante de section (guillemets sautés)
  const openingEnd = (i: number): number => {
    let q = ''
    for (; i < src.length; i++) {
      const c = src[i]
      if (q) {
        if (c === q) q = ''
      }
      else if (c === '"' || c === '\'') q = c
      else if (c === '>') return i
    }
    return -1
  }
  // le contenu étranger qui entoure la position (`svg`, `math`), null en HTML : un <foreignObject> rouvre du HTML
  const foreign = (): string | null => {
    for (let k = stack.length - 1; k > 0; k--) {
      const o = stack[k]
      if (o.kind !== 'tag') continue
      const low = o.name.toLowerCase()
      if (low === 'svg' || low === 'math') return low
      if (low === 'foreignobject') return null
    }
    return null
  }
  // une balise raccourci (`<@x>`, `<@@x>`) ; dans le fichier brut, toute balise `@` (les macros `<@window>`, `<@body>` s'y
  // écrivent sans fermante, le compilateur les lit avant le gabarit)
  const shorthand = (n: Open): n is Tag => n.kind === 'tag' && (template ? n.shape === 'project' || n.shape === 'core' : n.name.startsWith('@'))
  // une balise rendue vide en `a` (la fermante d'un ancêtre, un jeton de bloc, la fin du texte) : son contenu revient à la
  // liste qui la porte, juste après elle. Les balises sont rendues vides du haut de la pile vers le bas, et celle du
  // dessus est toujours le dernier enfant de celle du dessous : le contenu de chacune attend, puis le tout est versé d'un
  // coup dans la liste qui porte la plus basse (verser), chaque nœud déplacé une seule fois. Recopié à chaque niveau, le
  // contenu de 20 000 balises raccourci non refermées remplissait le tas
  const wait: Node[][] = []
  let carrier: Node[] | null = null
  const clear = (n: Tag, a: number): void => {
    carrier = lists.get(n)!
    lists.delete(n)
    wait.push(n.children)
    n.children  = []
    n.empty     = true
    n.emptiedAt = a
  }
  // à la première balise qui n'est pas rendue vide, et à la fin de chaque balayage ; les anciennes listes, vidées, ne
  // gardent plus rien
  const flush = (): void => {
    for (let k = wait.length - 1; k >= 0; k--) {
      for (const n of wait[k]) carrier!.push(n)
      wait[k].length = 0
    }
    wait.length = 0
    carrier = null
  }
  // balise raccourci jamais refermée : rendue vide
  const emptyShorthand = (n: Open, a: number): boolean => {
    if (!shorthand(n)) return false
    clear(n, a)
    return true
  }
  const closesNode = (n: Open, written: string): boolean => n.kind === 'tag' && (written === n.name || written === compiledName(n.name))
  const notClosedBefore = (n: Block, closing: string): string => `le bloc {${n.name}} n'est pas refermé avant </${closing}> : ajoutez {end}`
  // gabarit seul : la fin d'une région de code, lue par le compilateur lui-même (extractBalanced, ou extractSettings pour
  // les réglages d'un effet) depuis le caractère où il la commence : regex, chaînes, commentaires `#`, `###`, `//` et
  // `/* */` compris, la regex d'une tête de bloc (`{if /}/.test($s)}`) comme l'accolade d'un commentaire
  // (`{$a ### } ###}`) ; l'indice du fermant, -1 s'il manque (le parseur en donne le message, cf. readViaTree)
  const compilerScanner = template ? new Scanner(src, 1, dialect) : null
  const compiledEnd     = (i: number, settings = false): number => {
    const reader = compilerScanner!
    reader.pos = i
    try {
      if (settings) extractSettings(reader)
      else extractBalanced(reader, '}')
    }
    catch {
      return -1
    }
    return reader.pos - 1
  }
  // gabarit seul : fin d'une accolade du texte qui s'ouvre en i, lue depuis là où le compilateur commence la sienne
  const braceEnd = (i: number, raw: boolean): number => {
    if (raw) return compiledEnd(i + 2)
    SLASH_CLOSING.lastIndex = i
    const f = SLASH_CLOSING.exec(src)
    if (f) return i + f[0].length - 1
    BLOCK_KEYWORD.lastIndex = i
    const m = BLOCK_KEYWORD.exec(src)
    return compiledEnd(i + (m ? m[0].length : 1))
  }
  // fin d'une région de code `{…}` qui commence en i : dans le gabarit seul, celle du compilateur ; ailleurs la découpe
  // faite main, et quand elle échoue, chaque `}` qui suit est essayée dans l'ordre et la première dont Civet lit le
  // contenu est retenue (regex d'un appel sans parenthèses : `@click={ $v = $v.replace /'/g, '' }`) ; aucune : la faute
  // de la découpe faite main
  const codeEnd = (i: number, mode: ModeCode): number => {
    if (template) return compiledEnd(i)
    const e = regionEnd(src, i, '}')
    if (e >= 0) return e
    let k = i
    for (let n = 0; n < END_ATTEMPTS; n++) {
      k = src.indexOf('}', k)
      if (k < 0) break
      if (!readCode(src, i, k, mode, file.path).error) return k
      k++
    }
    return -1
  }
  // les sections du fichier et ses blocs <@head> / <@failed>, lus par le compilateur (sectionBounds) dans le texte reçu par
  // readFile, cherchés à la première ouvrante de section brute
  const bounds = (): ReadBounds => {
    if (readCache.bounds === null) {
      const b = sectionBounds(src, lang)
      readCache.bounds = { sections: new Map(b.sections.map(x => [x.start, x])), blocks: b.blocks }
    }
    return readCache.bounds
  }
  // les sections posées par cette lecture, par position
  const placed = new Set<number>()
  // contenu de la section brute `nom` ouverte en i et fin de sa fermante : celles du compilateur ; dans un bloc <@head> / <@failed>,
  // qu'il émet tel quel, un <script> ou un <style> se lit jusqu'à sa première fermante exacte dans le bloc, et n'est qu'une balise
  // s'il est auto-fermé (`<script src="…" />`) ou jamais refermé dans le bloc (undefined) ; ailleurs, une section que le compilateur
  // ne lit pas (il refuse alors le fichier) se lit jusqu'au premier `</nom` ; null : jamais refermée
  const readSection = (i: number, name: string): { body: SectionBound['body'], end: number } | null | undefined => {
    const closes = openingEnd(i)
    if (closes < 0) return null
    const section = bounds().sections.get(i)
    if (section !== undefined) return section
    const block = bounds().blocks.find(([a, b]) => a < i && i < b)
    if (block !== undefined && (name === 'script' || name === 'style')) {
      const e = src.slice(0, block[1]).toLowerCase().indexOf(`</${name}>`, closes)
      return src[closes - 1] === '/' || e < 0 ? undefined : { body: { start: closes + 1, end: e }, end: e + name.length + 3 }
    }
    const e = src.toLowerCase().indexOf('</' + name, closes)
    return e < 0 ? null : { body: { start: closes + 1, end: e }, end: src.indexOf('>', e) + 1 || src.length }
  }
  // la ligne de i ne porte avant lui que des blancs et des commentaires HTML entiers (un commentaire ouvert sur une ligne d'avant
  // compris), comme le masque des relevés d'avant les blanchissait
  const afterComments = (i: number): boolean => {
    let k = i
    for (;;) {
      while (k > 0 && (src[k - 1] === ' ' || src[k - 1] === '\t')) k--
      if (k === 0 || src[k - 1] === '\n') return true
      if (!src.startsWith('-->', k - 3) && !src.startsWith('--!>', k - 4)) return false
      const o = src.lastIndexOf('<!--', k - 4)
      if (o < 0) return false
      k = o
    }
  }
  // dans un bloc <@head> / <@failed>, que le compilateur émet tel quel, une section hors de la tête de ligne : un <script> ou un
  // <style> partout, une autre section après des commentaires HTML posés avant elle sur sa ligne ; lue comme en tête de ligne
  // (readSection), une balise si elle n'est jamais refermée ; undefined hors d'un bloc
  const blockSection = (i: number, name: string): ReturnType<typeof readSection> => {
    if (!bounds().blocks.some(([a, b]) => a < i && i < b)) return undefined
    if (name !== 'script' && name !== 'style' && !afterComments(i)) return undefined
    return readSection(i, name) ?? undefined
  }
  // fin d'un commentaire HTML ouvert en i, comme le compilateur la lit : il retire les sections avant de lire le gabarit, une section
  // de plusieurs lignes y laisse un commentaire de même hauteur (`<!--`, ses sauts de ligne, `-->`), une section d'une ligne rien ; la
  // fin de la première section de plusieurs lignes qui suit i quand elle s'ouvre avant `avant` (le premier `-->` du texte, ou sa fin),
  // undefined sinon (refermé à ce `-->` ; sans lui, le compilateur refuse le gabarit)
  const openCommentEnd = (i: number, before: number): number | undefined => {
    for (const s of bounds().sections.values()) {
      const jump = s.start > i ? src.indexOf('\n', s.start) : -1
      if (jump >= 0 && jump < s.end) return s.start < before ? s.end : undefined
    }
    return undefined
  }
  // la fin de ce commentaire (openCommentEnd) tant que la lecture est dedans, -1 hors de lui : les sections qu'il couvre restent
  // des sections pour le compilateur, lues comme telles, le texte entre elles est le commentaire
  // depuis i, le texte n'est fait que de blancs et de commentaires HTML entiers ; lu d'un trait, commentaire après commentaire (une regex à
  // étoile sur cette alternative essayait chaque découpe : 28 commentaires suivis d'une balise ne rendaient plus la main)
  const onlyComments = (i: number): boolean => {
    for (;;) {
      while (i < src.length && /\s/.test(src[i])) i++
      if (i >= src.length) return true
      COMMENT.lastIndex = i
      const read = COMMENT.exec(src)
      if (read === null) return false
      i += read[0].length
    }
  }
  let commentUntil = -1
  let loneText: string | null = null
  let i = 0

  while (i < src.length) {
    if (i < commentUntil && !(src[i] === '<' && bounds().sections.has(i) && RAW_TAGS.test(src.slice(i, i + 20)))) {
      // le commentaire jusqu'à la prochaine section du texte (une section blanchie, relue sans elle, n'y est plus) ou jusqu'à sa fin
      let end = commentUntil
      for (const s of bounds().sections.values()) {
        if (s.start <= i || src[s.start] !== '<') continue
        end = Math.min(end, s.start)
        break
      }
      set({ kind: 'htmlComment', start: i, end })
      i = end
      continue
    }
    const rest = src[i] === '<' || src[i] === '{' || src[i] === '@' ? src.slice(i, i + 200) : ''
    let m: RegExpExecArray | null
    // section brute (script, style, theme, routes, vars, types, effects), à toute profondeur : en tête de ligne, et partout où le
    // compilateur en ouvre une (après un commentaire HTML posé avant elle sur sa ligne, qu'il retire d'abord, après un séparateur
    // U+2028 / U+2029, fin de ligne pour ses expressions, dans un <textarea> ou un <title>) ; refermée où le compilateur la referme
    // (readSection) ; dans un bloc <@head> / <@failed>, aussi hors de la tête de ligne (blockSection) ; undefined : une balise
    const read = !template && rest.startsWith('<') && (m = RAW_TAGS.exec(rest)) ? ((loneText === null && atLineStart(i)) || bounds().sections.has(i) ? readSection(i, m[1].toLowerCase()) : loneText === null ? blockSection(i, m[1].toLowerCase()) : undefined) : undefined
    if (read !== undefined) {
      const name = m![1].toLowerCase()
      if (read === null) {
        fault(`la section <${name}> n'est jamais refermée : ajoutez </${name}>`, i)
        break
      }
      placed.add(i)
      const attrs   = src.slice(i + m![0].length, read.body.start - 1).trim()
      const body    = { start: read.body.start, end: read.body.end }
      const nodeEnd = read.end
      if (name === 'script') {
        const l = /\blang\s*=\s*["']?(\w+)/.exec(attrs)
        const script: Script = { kind: 'script', start: i, end: nodeEnd, lang: l ? l[1].toLowerCase() : lang, module: /\bmodule\b/.test(attrs), attrs, body, code: null, unread: null }
        if (READ_LANGS.has(script.lang)) script.code = code(body.start, body.end, 'script', script.lang)
        else script.unread = `langue ${script.lang} : aucun lecteur`
        set(script)
      }
      else if (name === 'style') {
        const l = /\blang\s*=\s*["']?(\w+)/.exec(attrs)
        set({ kind: 'style', start: i, end: nodeEnd, lang: l ? l[1].toLowerCase() : 'css', attrs, body } satisfies Style)
      }
      else set({ kind: 'section', start: i, end: nodeEnd, name, attrs, body } satisfies Section)
      i = nodeEnd
      continue
    }
    // directive de racine en tête de ligne (`@import …`, `@i18n …`), hors de tout élément
    if (!template && directives && loneText === null && rest.startsWith('@') && stack.length === 1 && atLineStart(i) && (m = readAt(DIRECTIVE, src, i))) {
      const end = i + m[0].length
      set({ kind: 'directive', start: i, end, name: '@' + m[1] })
      i = end
      continue
    }
    if (rest.startsWith('<!--')) {
      COMMENT.lastIndex = i
      const read = COMMENT.exec(src)
      // dans un <textarea> ou un <title>, un commentaire est un texte, sans passer la fermante ; jamais refermé : `<!--` seul
      if (loneText !== null) {
        const end = read === null || read[0].toLowerCase().includes('</' + loneText) ? i + 4 : i + read[0].length
        set({ kind: 'text', start: i, end })
        i = end
        continue
      }
      // refermé où le compilateur le referme (openCommentEnd) : à une section de plusieurs lignes ouverte avant le premier
      // `-->` du texte, ou jamais refermé (un `<!--` cité dans un <script> du gabarit qui n'est pas une section, texte brut pour le
      // navigateur, que le compilateur laisse à son gabarit, compris) ; la lecture continue après lui
      const closesAt = !template ? openCommentEnd(i, read === null ? src.length : i + read[0].length) : undefined
      if (closesAt !== undefined) {
        commentUntil = closesAt
        continue
      }
      if (read === null) {
        fault('ce commentaire HTML n\'est jamais refermé : ajoutez -->', i)
        set({ kind: 'htmlComment', start: i, end: src.length })
        break
      }
      set({ kind: 'htmlComment', start: i, end: i + read[0].length })
      i += read[0].length
      continue
    }
    // `<![CDATA[…]]>` dans un <svg> ou un <math> : un texte, jusqu'à `]]>` ; ailleurs, un texte comme un autre
    if (rest.startsWith('<![CDATA[') && loneText === null && foreign() !== null) {
      const e = src.indexOf(']]>', i + 9)
      if (e < 0) {
        fault('cette section <![CDATA[ n\'est jamais refermée : ajoutez ]]>', i)
        set({ kind: 'text', start: i, end: src.length })
        break
      }
      set({ kind: 'text', start: i, end: e + 3 })
      i = e + 3
      continue
    }
    // dans un <textarea> ou un <title>, une balise autre que sa fermante est un texte, jusqu'à son `>`
    if (loneText !== null && rest.startsWith('<') && /^<\/?[a-zA-Z@]/.test(rest) && !new RegExp(`^</${loneText}[\\s/>]`, 'i').test(rest)) {
      TEXT_TAG.lastIndex = i
      const end = i + TEXT_TAG.exec(src)![0].length
      set({ kind: 'text', start: i, end })
      i = end
      continue
    }
    if (rest.startsWith('</') && (m = CLOSING_TAG.exec(rest)) && (i !== textEnd || /^[a-zA-Z@]/.test(m[1]))) {
      const written = m[1]
      const end     = i + m[0].length
      // remonte jusqu'à l'élément de ce nom : une balise raccourci restée ouverte dedans est rendue vide, une autre balise
      // est refermée par cette fermante (`closedByAncestor`), un bloc est une faute
      let k = stack.length - 1
      while (k > 0 && !closesNode(stack[k], written)) k--
      if (k === 0) fault(`la balise fermante </${written}> ne ferme aucune balise ouverte`, i)
      else {
        for (let j = stack.length - 1; j > k; j--) {
          const o = stack[j]
          if (emptyShorthand(o, i)) continue
          flush()
          if (o.kind === 'block') fault(notClosedBefore(o, written), o.start)
          else {
            const b = o as Tag
            b.closedByAncestor = i
            b.end = i
          }
        }
        flush()
        stack[k].end = end
        stack.length = k
      }
      loneText = null
      i = end
      continue
    }
    if (loneText === null && rest.startsWith('<') && (m = TAG.exec(rest))) {
      const tag: Tag = { kind: 'tag', start: i, end: i, name: m[1], shape: shapeOf(m[1]), attrs: [], children: [], selfClosing: false, empty: false, openingEnd: i, closedByAncestor: null, emptiedAt: null }
      const end = readAttrs(i + m[0].length, tag)
      if (end < 0) {
        fault(`la balise <${m[1]}> n'est jamais refermée (« > » manquant)`, i, endlessQuote)
        break
      }
      if (m[1] === '@slot' || shorthand(tag)) lists.set(tag, children())
      set(tag)
      tag.end = tag.openingEnd = end
      const low = m[1].toLowerCase()
      if (!tag.selfClosing && !VOID_TAGS.has(low) && ((template && !partial) || low !== '@include')) {
        stack.push(tag)
        if ((low === 'textarea' || low === 'title') && foreign() === null) loneText = low
        if (RAW_TEXT.has(low) && foreign() === null) rawTexts.add(tag)
      }
      i = end
      continue
    }
    if (rest.startsWith('{')) {
      const raw  = rest.startsWith('{{')
      const from = i + (raw ? 2 : 1)
      const e    = template ? braceEnd(i, raw) : raw ? regionEnd(src, from, '}') : codeEnd(from, 'expression')
      if (e < 0) {
        fault('cette accolade n\'est jamais refermée', i)
        break
      }
      if (raw && src[e + 1] !== '}') fault('le HTML calculé `{{…}}` se referme par deux accolades : `}}`', i)
      const end = e + 1 + (raw && src[e + 1] === '}' ? 1 : 0)
      readBlock(i, from, e, raw, end)
      i = end
      continue
    }
    // texte jusqu'au prochain `<` ou `{` (hors du gabarit seul : ou début de ligne, une directive peut y commencer)
    let j = i + 1
    while (j < src.length && src[j] !== '<' && src[j] !== '{' && (template || !(src[j] === '@' && src[j - 1] === '\n'))) j++
    textEnd = j
    set({ kind: 'text', start: i, end: j })
    i = j
  }
  // fin du texte : une balise raccourci restée ouverte est rendue vide, un `<@slot>` suivi dans le texte de blancs et de
  // commentaires seulement aussi (comme `<@slot/>`) — un jeton refusé après lui le laisse ouvert, comme le compilateur ; un bloc
  // ouvert est une faute, et dans le gabarit toute autre balise ouverte
  for (let k = stack.length - 1; k > 0; k--) {
    const n = stack[k]
    if (emptyShorthand(n, src.length)) continue
    flush()
    if (n.kind === 'tag' && n.name === '@slot' && onlyComments(n.openingEnd)) {
      clear(n, src.length)
      continue
    }
    n.end = src.length
    if (n.kind === 'block') fault(`le bloc {${n.name}} n'est jamais refermé : ajoutez {end}`, n.start)
    else if (template) fault(`la balise <${(n as Tag).name}> n'est jamais refermée : ajoutez </${(n as Tag).name}>`, n.start)
  }
  flush()
  if (template || (readCache.bounds === null && !SECTION_OPENING.test(src))) return []
  const all = [...bounds().sections.values()]
  return all.filter(b => !placed.has(b.start) && !all.some(a => a.start < b.start && b.end <= a.end))

  // un bloc `{…}` : bloc de contrôle, branche, fin, étalement ou expression ; le mot du bloc est collé à l'accolade
  // (`{if $a}`), `{else}` et `{end}` s'écrivent seuls, comme le compilateur les lit (`{ if $a}` est une expression)
  function readBlock(start: number, from: number, e: number, raw: boolean, end: number): void {
    const body = src.slice(from, e)
    const head = { start: from, end: e }
    let m: RegExpExecArray | null
    if (!raw && body.startsWith('...')) {
      fault('un étalement `{...x}` pose des attributs : il s\'écrit dans une balise ouvrante', start)
      set({ kind: 'spread', start, end, code: code(from + 3, e, 'expression') })
      return
    }
    const closeShorthands = (): void => {
      while (shorthand(open()) && emptyShorthand(open(), start)) stack.pop()
      flush()
    }
    // une branche du bloc ouvert ; `blocs` : les blocs qui la portent ({elsif} et {else} : {if} ; {success} et {error} : {await})
    const branchOf = (kind: Branch['kind'], blocks: string[]): Branch | null => {
      closeShorthands()
      const o = open()
      if (o.kind !== 'block' || !blocks.includes(o.name)) {
        fault(`{${kind}} est écrit hors d'un bloc {${blocks[0]}}`, start)
        return null
      }
      const branch: Branch = { kind, start, head, children: [], code: null }
      o.branches.push(branch)
      return branch
    }
    if (!raw && body === 'else') {
      branchOf('else', ['if'])
      return
    }
    // `{success}` et `{error}` sans nom : une branche au niveau d'un {await} (balises raccourci ouvertes rendues vides),
    // ailleurs l'affichage d'une variable de ce nom
    if (!raw && (body === 'success' || body === 'error')) {
      let k = stack.length - 1
      while (k > 0 && shorthand(stack[k])) k--
      const o = stack[k]
      if (o.kind === 'block' && o.name === 'await') {
        branchOf(body, ['await'])
        return
      }
    }
    if (!raw && body === 'end') {
      closeShorthands()
      const o = open()
      if (o.kind !== 'block') {
        fault('{end} ne ferme aucun bloc ouvert', start)
        return
      }
      o.end = end
      stack.pop()
      return
    }
    const newBlock = (name: string): Block => ({ kind: 'block', start, end, name, disposition: null, variables: null, branches: [{ kind: 'then', start, head, children: [], code: null }], code: null, key: null, head })
    if (!raw && body.startsWith('?')) {
      const block = set(newBlock('if'))
      block.disposition = body.slice(1).trim()
      stack.push(block)
      return
    }
    if (!raw && (m = BLOCKS.exec(body))) {
      const keyword = m[1] === 'await.keep' ? 'await' : m[1]
      const expr    = from + m[0].length
      if (keyword === 'elsif' || keyword === 'success' || keyword === 'error') {
        const branch = branchOf(keyword, keyword === 'elsif' ? ['if'] : ['await'])
        if (branch && keyword === 'elsif') branch.code = code(expr, e, 'expression')
        return
      }
      const block = set(newBlock(keyword))
      if (keyword === 'const') {
        // `{const nom = valeur}` : une déclaration, sans branches ni {end}
        const c         = /^([a-zA-Z_$][\w$]*)\s*=\s*/.exec(src.slice(expr, e))
        block.branches  = []
        block.variables = c ? c[1] : null
        if (c) block.code = code(expr + c[0].length, e, 'expression')
        return
      }
      if (keyword === 'for') {
        // `{for x, i in liste by clé}` (ou `key=clé`) : la liste et la clé sont du code, les noms sont lus à part
        const f = /^([\s\S]*?)\s+(?:in|of)\s+([\s\S]*)$/.exec(src.slice(expr, e))
        if (f) {
          block.variables = f[1].trim()
          let list = f[2]
          const key = /\s+(?:key\s*=\s*|by\s+)([\s\S]*)$/.exec(list)
          if (key) list = list.slice(0, key.index)
          const dl = e - f[2].length
          block.code = code(dl, dl + list.length, 'expression')
          if (key) block.key = code(e - key[1].length, e, 'expression')
        }
        else fault('{for} attend « in » ou « of » : {for x in $liste}', start)
      }
      else if (keyword === 'await') {
        const s = /\s+\*skeleton(?:\([\s\S]*\))?$/.exec(src.slice(expr, e))
        block.code = code(expr, s ? expr + s.index : e, 'expression')
      }
      else block.code = code(expr, e, 'expression')
      stack.push(block)
      return
    }
    set({ kind: 'expression', start, end, raw, code: body.trim() === '' ? null : code(from, e, 'expression') })
  }

  // attributs d'une balise ouvrante, depuis i ; rend l'indice qui suit `>` (ou -1)
  function readAttrs(i: number, tag: Tag): number {
    const attr = (kind: TagAttr['kind'], name: string | null, start: number): TagAttr => ({ kind, name, start, end: start, value: null, code: null, interpolations: [], settings: null })
    while (i < src.length) {
      while (/\s/.test(src[i] ?? '')) i++
      if (src.startsWith('/>', i)) {
        tag.selfClosing = true
        return i + 2
      }
      if (src[i] === '>') return i + 1
      const rest = src.slice(i, i + 200)
      let m: RegExpExecArray | null
      if (src[i] === '{') {
        const isSpread = src.startsWith('{...', i)
        const e        = codeEnd(i + (template && isSpread ? 4 : 1), 'expression')
        if (e < 0) return -1
        const a = attr(isSpread ? 'spread' : 'expression', null, i)
        a.code  = code(i + (isSpread ? 4 : 1), e, 'expression')
        a.end   = e + 1
        tag.attrs.push(a)
        i = e + 1
        continue
      }
      if ((m = EFFECT.exec(rest))) {
        const a = attr('effect', m[1], i)
        i += m[0].length
        if (src[i] === '(') {
          const e = template ? compiledEnd(i + 1, true) : regionEnd(src, i + 1, ')')
          if (e < 0) return -1
          a.settings = { start: i + 1, end: e }
          i = e + 1
        }
        a.end = i
        tag.attrs.push(a)
        continue
      }
      if ((m = CLASS_WORD.exec(rest))) {
        const e = template ? compiledEnd(i + m[0].length) : regionEnd(src, i + m[0].length, '}')
        if (e < 0) return -1
        const a = attr('class', m[0].slice(0, -1), i)
        i = readValue(e + 1, a)
        tag.attrs.push(a)
        continue
      }
      if ((m = ATTR_NAME.exec(rest))) {
        const a = attr(GESTURE_ATTR.test(m[0]) ? 'gesture' : 'attribute', m[0], i)
        i = readValue(i + m[0].length, a)
        tag.attrs.push(a)
        continue
      }
      i++
    }
    return -1
  }

  // la valeur d'un attribut, depuis i : code `{…}`, HTML calculé `{{…}}`, texte entre guillemets (ses `{…}` sont du
  // code), effet, ou valeur nue ; rend l'indice qui suit la valeur
  function readValue(i: number, a: TagAttr): number {
    const eg = readAt(EQUALS, src, i)
    if (!eg) {
      a.end = i
      return i
    }
    i += eg[0].length
    let m: RegExpExecArray | null
    if (template && src[i] === '{') {
      // comme le compilateur (parseAttrs) : la valeur est une accolade lue depuis la première, `{{…}}` compris
      const e = compiledEnd(i + 1)
      if (e < 0) return src.length
      const raw = src[i + 1] === '{' && src[e - 1] === '}'
      a.value   = raw ? 'raw' : 'code'
      a.code    = raw ? code(i + 2, e - 1, 'expression') : code(i + 1, e, a.kind === 'gesture' ? 'handler' : 'expression')
      i         = e + 1
    }
    else if (src.startsWith('{{', i)) {
      const e = regionEnd(src, i + 2, '}')
      if (e < 0 || src[e + 1] !== '}') return src.length
      a.value = 'raw'
      a.code  = code(i + 2, e, 'expression')
      i       = e + 2
    }
    else if (src[i] === '{') {
      const mode = a.kind === 'gesture' ? 'handler' : 'expression'
      const e    = codeEnd(i + 1, mode)
      if (e < 0) return src.length
      a.value = 'code'
      a.code  = code(i + 1, e, mode)
      i       = e + 1
    }
    else if ((src[i] === '"' || src[i] === '\'') && (src.indexOf(src[i], i + 1) >= 0 || !inRawText())) {
      const e = src.indexOf(src[i], i + 1)
      if (e < 0) {
        // jamais refermé : comme le navigateur, la valeur court jusqu'au bout du texte, et la balise n'est jamais terminée ;
        // dans le contenu d'un élément à texte brut, la valeur est lue nue (plus bas), comme le compilateur la lit
        endlessQuote = { start: i, attr: a.start }
        return src.length
      }
      a.value = 'text'
      for (let k = i + 1; k < e; k++) {
        if (src[k] !== '{') continue
        const f = regionEnd(src, k + 1, '}')
        if (f < 0 || f > e) break
        a.interpolations.push({ start: k, end: f + 1, code: src.slice(k + 1, f).trim() === '' ? null : code(k + 1, f, 'expression') })
        k = f
      }
      i = e + 1
    }
    else if ((m = EFFECT.exec(src.slice(i, i + 200)))) {
      i += m[0].length
      if (src[i] === '(') {
        const e = template ? compiledEnd(i + 1, true) : regionEnd(src, i + 1, ')')
        i = e < 0 ? src.length : e + 1
      }
      a.value = 'effect'
    }
    else if ((m = readAt(BARE_VALUE, src, i))) {
      a.value = 'bare'
      i += m[0].length
    }
    a.end = i
    return i
  }
}

// ---------------------------------------------------------------- parcours

// visite chaque nœud de l'arbre, parent avant enfants, branches des blocs comprises ; sans appel par niveau (listes d'enfants
// en attente, la dernière empilée lue d'abord) : un gabarit imbriqué sur des milliers de niveaux n'épuise pas la pile ici
export function traverse(root: Node, visit: (n: Node) => void): void {
  const lists: Node[][] = [[root]]
  const ranks: number[] = [0]
  while (lists.length > 0) {
    const top = lists.length - 1
    if (ranks[top] >= lists[top].length) {
      lists.pop()
      ranks.pop()
      continue
    }
    const node = lists[top][ranks[top]++]
    visit(node)
    if (node.kind === 'block') for (let b = node.branches.length - 1; b >= 0; b--) ranks[lists.push(node.branches[b].children) - 1] = 0
    if ('children' in node) ranks[lists.push(node.children) - 1] = 0
  }
}
