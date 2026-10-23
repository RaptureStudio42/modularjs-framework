// transpiler/var-types — types et valeurs permises des variables : grammaire d'une règle, lignes
// d'un bloc <vars> (composant) ou <types> (fichier *.types.mjs), remplacement des règles nommées
// par leur définition, et forme compilée que lit le runtime (mjs_types.ts).
//
// Une règle dit ce que la variable accepte (liste blanche, AVANT le `!`) et ce qu'elle refuse
// (liste noire, APRÈS le `!`) ; la liste blanche peut être vide (`! 'admin' | 'root'` = tout sauf
// ces deux valeurs). Une plage de nombres dit toujours `int` ou `float` : `0..100` seul est refusé.
//
//   int 0..100 · float ..1 · string 3..20 /^[a-z]+$/ · bool · 'red' | 'green' · Percent
//   string[] 0..10 · { volume: Percent, bass?: int -10..10 } · int 0..10 | 'auto'
//   string 3..20 ! 'admin' | 'root' · int 0..100 ! 40..60

import { t } from '../messages/index.js'
import { suggestKey } from '../bundler/config.js'
import { maskInertSameLength } from '../lexer/index.js'

export type Lit = string | number | boolean | null

/** un interdit : une valeur exacte, ou une plage de nombres */
export type BlackItem = { lit: Lit } | { min?: number, max?: number }

export type RuleAst = (
  | { k: 'int' | 'float', min?: number, max?: number }
  | { k: 'string', min?: number, max?: number, re?: { source: string, flags: string } }
  | { k: 'bool' }
  | { k: 'lit', values: Lit[] }
  | { k: 'ref', name: string, lineOffset?: number }
  | { k: 'array', of: RuleAst, min?: number, max?: number }
  | { k: 'object', fields: { key: string, optional: boolean, rule: RuleAst }[] }
  | { k: 'union', alts: RuleAst[] }
  | { k: 'any' }
) & { not?: BlackItem[], name?: string, ownNot?: BlackItem[] }

/** où se trouve la règle, pour citer la ligne dans un message */
export interface RuleWhere {
  bloc: string
  ligne: number
}

export interface VarRuleEntry {
  name:  string
  store: boolean
  rule:  RuleAst
  line:  number
}

export interface TypeDefEntry {
  name: string
  rule: RuleAst
  line: number
}

// les mots de la grammaire : jamais un nom de règle
const RESERVED = new Set(['int', 'float', 'string', 'bool', 'true', 'false', 'null', 'any'])
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

// ----------------------------------------------------------------------------
// lecture en jetons
// ----------------------------------------------------------------------------

type Tok =
  | { t: 'num', v: number, s: string, i: number }
  | { t: 'str', v: string, s: string, i: number }
  | { t: 're', source: string, flags: string, s: string, i: number }
  | { t: 'id', v: string, s: string, i: number }
  | { t: 'op', v: string, s: string, i: number }
  | { t: 'end', s: string, i: number }

const NUM_RE = /^-?(?:\d+(?:\.\d+)?|\.\d+)/

// `at` : la position du jeton fautif dans le texte de la règle — une règle d'objet écrite sur plusieurs
// lignes est citée à la ligne de sa faute, pas à celle de son nom
function fail(where: RuleWhere, texte: string, detail: string, at?: number): never {
  throw new Error(t('types.regle-invalide', { bloc: where.bloc, ligne: where.ligne + linesBefore(texte, at), texte: texte.trim(), detail }))
}

function linesBefore(texte: string, at?: number): number {
  return at === undefined ? 0 : (texte.slice(0, at).match(/\n/g)?.length ?? 0)
}

function tokenize(src: string, where: RuleWhere): Tok[] {
  const toks: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue }
    if (c === '#') break
    if (src.startsWith('..', i)) { toks.push({ t: 'op', v: '..', s: '..', i }); i += 2; continue }
    const num = NUM_RE.exec(src.slice(i))
    if (num) {
      toks.push({ t: 'num', v: Number(num[0]), s: num[0], i })
      i += num[0].length
      continue
    }
    if (c === "'" || c === '"') {
      let j = i + 1
      let v = ''
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\n') break
        if (src[j] === '\\' && j + 1 < src.length) {
          const e = src[j + 1]
          v += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e
          j += 2
          continue
        }
        v += src[j]
        j++
      }
      if (src[j] !== c) fail(where, src, t('types.detail-chaine-non-fermee', { texte: src.slice(i, j) }), i)
      toks.push({ t: 'str', v, s: src.slice(i, j + 1), i })
      i = j + 1
      continue
    }
    if (c === '/') {
      let j = i + 1
      let classe = false
      while (j < src.length && src[j] !== '\n' && (classe || src[j] !== '/')) {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === '[') classe = true
        else if (src[j] === ']') classe = false
        j++
      }
      if (src[j] !== '/') fail(where, src, t('types.detail-forme-non-fermee', { texte: src.slice(i, j) }), i)
      const source = src.slice(i + 1, j)
      let k = j + 1
      while (k < src.length && /[a-z]/.test(src[k])) k++
      const flags = src.slice(j + 1, k)
      const texte = src.slice(i, k)
      // vide, elle ne contraint rien, et `//` émis tel quel ouvrirait un commentaire dans le JS
      if (source === '') fail(where, src, t('types.detail-forme-vide', { texte }), i)
      if (/[gy]/.test(flags)) fail(where, src, t('types.detail-forme-drapeau', { texte, drapeau: flags.replace(/[^gy]/g, '') }), i)
      try {
        new RegExp(source, flags)
      }
      catch (e: any) {
        fail(where, src, t('types.detail-forme-invalide', { texte, erreur: e.message }), i)
      }
      toks.push({ t: 're', source, flags, s: texte, i })
      i = k
      continue
    }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))
    if (id) {
      toks.push({ t: 'id', v: id[0], s: id[0], i })
      i += id[0].length
      continue
    }
    if ('|!{}:,[]?'.includes(c)) { toks.push({ t: 'op', v: c, s: c, i }); i++; continue }
    fail(where, src, t('types.detail-caractere', { car: c }), i)
  }
  toks.push({ t: 'end', s: '', i: src.length })
  return toks
}

// ----------------------------------------------------------------------------
// analyse
// ----------------------------------------------------------------------------

class RuleParser {
  private toks: Tok[]
  private pos = 0

  constructor(private src: string, private where: RuleWhere) {
    this.toks = tokenize(src, where)
  }

  private peek(): Tok { return this.toks[this.pos] }
  private next(): Tok { return this.toks[this.pos++] }
  private isOp(v: string): boolean { const k = this.peek(); return k.t === 'op' && k.v === v }
  private fail(detail: string, at: number = this.peek().i): never { return fail(this.where, this.src, detail, at) }

  private expectOp(v: string): void {
    const k = this.next()
    if (k.t === 'op' && k.v === v) return
    if (k.t === 'end') this.fail(t('types.detail-fin', { attendu: v }), k.i)
    this.fail(t('types.detail-jeton', { jeton: k.s, attendu: v }), k.i)
  }

  parseAll(): RuleAst {
    const r = this.parseRule()
    const k = this.peek()
    if (k.t !== 'end') this.fail(t('types.detail-jeton-seul', { jeton: k.s }))
    return r
  }

  // règle = [liste blanche] ['!' liste noire]
  private parseRule(): RuleAst {
    const r: RuleAst = this.isOp('!') ? { k: 'any' } : this.parseWhite()
    if (this.isOp('!')) {
      this.next()
      const items: BlackItem[] = [this.parseBlackItem()]
      while (this.isOp('|')) {
        this.next()
        items.push(this.parseBlackItem())
      }
      if (r.k === 'array' || r.k === 'object') this.fail(t('types.detail-interdits-conteneur'))
      r.not = items
    }
    return r
  }

  private parseWhite(): RuleAst {
    const alts: RuleAst[] = [this.parseAlt()]
    while (this.isOp('|')) {
      this.next()
      alts.push(this.parseAlt())
    }
    // les valeurs exactes se regroupent en une seule liste, à la place de la première
    const merged: RuleAst[] = []
    let lits: Lit[] | null = null
    for (const a of alts) {
      if (a.k === 'lit') {
        if (lits) lits.push(...a.values)
        else {
          lits = [...a.values]
          merged.push({ k: 'lit', values: lits })
        }
      }
      else merged.push(a)
    }
    return merged.length === 1 ? merged[0] : { k: 'union', alts: merged }
  }

  private parseLiteral(): Lit | undefined {
    const k = this.peek()
    if (k.t === 'str') { this.next(); return k.v }
    if (k.t === 'num') { this.next(); return k.v }
    if (k.t === 'id' && (k.v === 'true' || k.v === 'false' || k.v === 'null')) {
      this.next()
      return k.v === 'null' ? null : k.v === 'true'
    }
    return undefined
  }

  private parseBlackItem(): BlackItem {
    const k = this.peek()
    if (k.t === 'num' && this.toks[this.pos + 1].t === 'op' && (this.toks[this.pos + 1] as any).v === '..') return this.parseRange()
    if (k.t === 'op' && k.v === '..') return this.parseRange()
    const lit = this.parseLiteral()
    if (lit !== undefined) return { lit }
    if (k.t === 'end') this.fail(t('types.detail-interdits-vides'))
    return this.fail(t('types.detail-interdit-invalide', { jeton: k.s }))
  }

  // plage : [nombre] '..' [nombre], au moins une borne
  private parseRange(): { min?: number, max?: number } {
    const r: { min?: number, max?: number } = {}
    const at = this.peek().i
    let k = this.peek()
    if (k.t === 'num') { this.next(); r.min = k.v }
    this.expectOp('..')
    k = this.peek()
    if (k.t === 'num') { this.next(); r.max = k.v }
    if (r.min === undefined && r.max === undefined) this.fail(t('types.detail-plage-vide'), at)
    if (r.min !== undefined && r.max !== undefined && r.min > r.max) this.fail(t('types.detail-bornes-inversees', { plage: `${r.min}..${r.max}` }), at)
    return r
  }

  private startsRange(): boolean {
    const k = this.peek()
    return (k.t === 'op' && k.v === '..') || (k.t === 'num' && this.toks[this.pos + 1].t === 'op' && (this.toks[this.pos + 1] as any).v === '..')
  }

  private parseAlt(): RuleAst {
    const k = this.peek()
    // une plage nue : ni entier ni nombre à virgule annoncé
    if (this.startsRange()) {
      const debut = this.pos
      this.parseRange()
      const plage = this.toks.slice(debut, this.pos).map(x => x.s).join('')
      this.fail(t('types.detail-plage-sans-type', { plage }), this.toks[debut].i)
    }
    let r: RuleAst
    const lit = this.parseLiteral()
    if (lit !== undefined) return { k: 'lit', values: [lit] }
    if (k.t === 'op' && k.v === '{') r = this.parseObject()
    else if (k.t === 'id') {
      this.next()
      if (k.v === 'int' || k.v === 'float' || k.v === 'string') r = this.parseModifiers(k.v)
      else if (k.v === 'bool') {
        if (this.startsRange()) this.fail(t('types.detail-plage-hors-nombre', { type: 'bool' }))
        r = { k: 'bool' }
      }
      else if (k.v === 'any') r = { k: 'any' }
      else {
        r = { k: 'ref', name: k.v }
        const lignes = linesBefore(this.src, k.i)
        if (lignes > 0) r.lineOffset = lignes
      }
    }
    else if (k.t === 'end') return this.fail(t('types.detail-fin-regle'))
    else return this.fail(t('types.detail-jeton-seul', { jeton: k.s }))
    // suffixes : `[]` puis, facultative, la plage du nombre d'éléments
    while (this.isOp('[')) {
      this.next()
      this.expectOp(']')
      const a: RuleAst = { k: 'array', of: r }
      if (this.startsRange()) Object.assign(a, this.checkedRange('count'))
      r = a
    }
    if (this.peek().t === 're') this.fail(t('types.detail-forme-hors-string', { texte: this.peek().s }))
    if (this.startsRange()) {
      // une règle nommée porte sa plage dans sa définition ; un type mal écrit (`strin`) en est une pour le lecteur
      if (r.k === 'ref') this.fail(t('types.detail-plage-regle-nommee', { nom: r.name }))
      if (r.k === 'any') this.fail(t('types.detail-plage-hors-nombre', { type: 'any' }))
      this.fail(t('types.detail-deux-plages'))
    }
    return r
  }

  private checkedRange(kind: 'int' | 'float' | 'count'): { min?: number, max?: number } {
    const at = this.peek().i
    const r  = this.parseRange()
    const bornes = [r.min, r.max].filter((b): b is number => b !== undefined)
    if (kind === 'int' && bornes.some(b => !Number.isInteger(b))) this.fail(t('types.detail-bornes-entieres'), at)
    if (kind === 'count' && bornes.some(b => !Number.isInteger(b) || b < 0)) this.fail(t('types.detail-longueur'), at)
    return r
  }

  private parseModifiers(base: 'int' | 'float' | 'string'): RuleAst {
    const r: any = { k: base }
    let plage = false
    for (;;) {
      if (this.startsRange()) {
        if (plage) this.fail(t('types.detail-deux-plages'))
        plage = true
        Object.assign(r, this.checkedRange(base === 'string' ? 'count' : base))
        continue
      }
      const k = this.peek()
      if (k.t === 're') {
        if (base !== 'string') this.fail(t('types.detail-forme-hors-string', { texte: k.s }))
        if (r.re) this.fail(t('types.detail-deux-formes'))
        this.next()
        r.re = { source: k.source, flags: k.flags }
        continue
      }
      return r
    }
  }

  private parseObject(): RuleAst {
    this.expectOp('{')
    const fields: { key: string, optional: boolean, rule: RuleAst }[] = []
    while (!this.isOp('}')) {
      const k = this.next()
      let key: string
      if (k.t === 'id') key = k.v
      else if (k.t === 'str') key = k.v
      else if (k.t === 'end') return this.fail(t('types.detail-accolade'), k.i)
      else return this.fail(t('types.detail-cle', { jeton: k.s }), k.i)
      // `__proto__` écrit en clé d'objet poserait le prototype de la règle compilée, jamais un champ
      if (key === '__proto__') this.fail(t('types.detail-cle-reservee', { cle: key }), k.i)
      const optional = this.isOp('?')
      if (optional) this.next()
      this.expectOp(':')
      if (fields.some(f => f.key === key)) this.fail(t('types.detail-cle-double', { cle: key }), k.i)
      fields.push({ key, optional, rule: this.parseRule() })
      if (this.isOp(',')) { this.next(); continue }
      if (this.peek().t === 'end') this.fail(t('types.detail-accolade'))
      if (!this.isOp('}')) this.fail(t('types.detail-jeton', { jeton: this.peek().s, attendu: ', ou }' }))
    }
    this.next()
    return { k: 'object', fields }
  }
}

/** une règle, écrite seule — lève une erreur de compilation qui cite le bloc et la ligne */
export function parseRule(text: string, where: RuleWhere): RuleAst {
  return new RuleParser(text, where).parseAll()
}

// ----------------------------------------------------------------------------
// lignes d'un bloc
// ----------------------------------------------------------------------------

// commentaire `#` retiré (hors chaîne et hors forme /…/) ; profondeur d'accolades de la ligne
function scanLine(line: string): { code: string, depth: number } {
  let depth = 0
  let i = 0
  while (i < line.length) {
    const c = line[i]
    if (c === '#') return { code: line.slice(0, i), depth }
    if (c === "'" || c === '"' || c === '/') {
      // la classe `[…]` d'une forme /…/ peut porter `/`, `#` ou une accolade, comme au tokenize
      let j = i + 1
      let classe = false
      while (j < line.length && (classe || line[j] !== c)) {
        if (line[j] === '\\') { j += 2; continue }
        if (c === '/' && line[j] === '[') classe = true
        else if (c === '/' && line[j] === ']') classe = false
        j++
      }
      i = j + 1
      continue
    }
    if (c === '{') depth++
    else if (c === '}') depth--
    i++
  }
  return { code: line, depth }
}

interface RawEntry { head: string, rest: string, line: number }

// regroupe les lignes utiles en entrées : une entrée continue tant que ses accolades restent ouvertes
function entries(raw: string, startLine: number, bloc: string): RawEntry[] {
  const out: RawEntry[] = []
  const lines = raw.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const first = scanLine(lines[i])
    if (first.code.trim() === '') continue
    const line = startLine + i
    let code  = first.code
    let depth = first.depth
    while (depth > 0 && i + 1 < lines.length) {
      i++
      const suite = scanLine(lines[i])
      code  += '\n' + suite.code
      depth += suite.depth
    }
    const m = /^\s*(\$\$?[A-Za-z_][A-Za-z0-9_]*|[A-Za-z_][A-Za-z0-9_]*)(.*)$/s.exec(code)
    if (!m) throw new Error(t('types.ligne-invalide', { bloc, ligne: line, texte: code.trim() }))
    out.push({ head: m[1], rest: m[2], line })
  }
  return out
}

/** les lignes d'un bloc <vars> : `$nom  règle` (variable ou prop) et `$$nom  règle` (store) */
export function parseVarsBlock(raw: string, startLine: number): VarRuleEntry[] {
  const out: VarRuleEntry[] = []
  const vus = new Set<string>()
  for (const e of entries(raw, startLine, '<vars>')) {
    if (e.head[0] !== '$') throw new Error(t('types.regle-nommee-dans-vars', { ligne: e.line, nom: e.head }))
    const store = e.head.startsWith('$$')
    const name  = e.head.slice(store ? 2 : 1)
    const rest  = e.rest.trim()
    if (rest.startsWith(':')) throw new Error(t('types.deux-points', { bloc: '<vars>', ligne: e.line, nom: e.head, regle: rest.slice(1).trim() }))
    if (rest === '') throw new Error(t('types.regle-manquante', { bloc: '<vars>', ligne: e.line, nom: e.head }))
    if (vus.has(e.head)) throw new Error(t('types.double', { bloc: '<vars>', ligne: e.line, nom: e.head }))
    vus.add(e.head)
    out.push({ name, store, rule: parseRule(rest, { bloc: '<vars>', ligne: e.line }), line: e.line })
  }
  return out
}

/** les lignes d'un bloc <types> : `Nom  règle`, une règle nommée par ligne */
export function parseTypesBlock(raw: string, startLine: number): TypeDefEntry[] {
  const out: TypeDefEntry[] = []
  const vus = new Set<string>()
  for (const e of entries(raw, startLine, '<types>')) {
    if (e.head[0] === '$') throw new Error(t('types.variable-dans-types', { ligne: e.line, nom: e.head }))
    if (RESERVED.has(e.head)) throw new Error(t('types.mot-reserve', { ligne: e.line, nom: e.head }))
    const rest = e.rest.trim()
    if (rest.startsWith(':')) throw new Error(t('types.deux-points', { bloc: '<types>', ligne: e.line, nom: e.head, regle: rest.slice(1).trim() }))
    if (rest === '') throw new Error(t('types.regle-manquante', { bloc: '<types>', ligne: e.line, nom: e.head }))
    if (vus.has(e.head)) throw new Error(t('types.double', { bloc: '<types>', ligne: e.line, nom: e.head }))
    vus.add(e.head)
    out.push({ name: e.head, rule: parseRule(rest, { bloc: '<types>', ligne: e.line }), line: e.line })
  }
  return out
}

// ----------------------------------------------------------------------------
// règles nommées
// ----------------------------------------------------------------------------

/** remplace chaque règle nommée par sa définition (copie), en gardant son nom pour les messages ;
 *  les interdits écrits à l'usage s'ajoutent à ceux de la définition, et restent dans son texte
 *  affiché (`Percent ! 50`). `own` : la règle vient du texte que cite `where` (une règle nommée
 *  y garde sa ligne), pas d'une définition lue ailleurs */
export function resolveRule(rule: RuleAst, defs: Record<string, RuleAst>, where: RuleWhere, chaine: string[] = [], own = true): RuleAst {
  const not = rule.not ? rule.not.map(b => ({ ...b })) : undefined
  const avec = (r: RuleAst): RuleAst => { if (not) r.not = [...(r.not ?? []), ...not]; return r }
  switch (rule.k) {
    case 'ref': {
      const ligne = own ? where.ligne + (rule.lineOffset ?? 0) : where.ligne
      const def = Object.prototype.hasOwnProperty.call(defs, rule.name) ? defs[rule.name] : undefined
      if (!def) {
        const suggestion = suggestKey(rule.name, Object.keys(defs))
        if (suggestion) throw new Error(t('types.regle-inconnue-suggestion', { bloc: where.bloc, ligne, nom: rule.name, suggestion }))
        throw new Error(t('types.regle-inconnue', { bloc: where.bloc, ligne, nom: rule.name }))
      }
      if (chaine.includes(rule.name)) throw new Error(t('types.regle-boucle', { bloc: where.bloc, ligne, chaine: [...chaine, rule.name].join(' → ') }))
      const r = resolveRule(def, defs, where, [...chaine, rule.name], false)
      r.name = rule.name
      if (not) r.ownNot = not.map(b => ({ ...b }))
      else delete r.ownNot
      if ((r.k === 'array' || r.k === 'object') && not) throw new Error(t('types.regle-invalide', { bloc: where.bloc, ligne, texte: ruleText(rule), detail: t('types.detail-interdits-conteneur') }))
      return avec(r)
    }
    case 'array':
      return avec({ k: 'array', of: resolveRule(rule.of, defs, where, chaine, own), ...bornes(rule) })
    case 'object':
      return avec({ k: 'object', fields: rule.fields.map(f => ({ key: f.key, optional: f.optional, rule: resolveRule(f.rule, defs, where, chaine, own) })) })
    case 'union':
      return avec({ k: 'union', alts: rule.alts.map(a => resolveRule(a, defs, where, chaine, own)) })
    case 'lit':
      return avec({ k: 'lit', values: [...rule.values] })
    case 'string':
      return avec({ k: 'string', ...bornes(rule), ...(rule.re ? { re: { ...rule.re } } : {}) })
    case 'int':
    case 'float':
      return avec({ k: rule.k, ...bornes(rule) })
    default:
      return avec({ k: rule.k } as RuleAst)
  }
}

function bornes(r: { min?: number, max?: number }): { min?: number, max?: number } {
  const o: { min?: number, max?: number } = {}
  if (r.min !== undefined) o.min = r.min
  if (r.max !== undefined) o.max = r.max
  return o
}

/** noms des règles nommées citées par une règle (non résolue) */
export function ruleRefs(rule: RuleAst, out: Set<string> = new Set()): Set<string> {
  if (rule.k === 'ref') out.add(rule.name)
  else if (rule.k === 'array') ruleRefs(rule.of, out)
  else if (rule.k === 'object') for (const f of rule.fields) ruleRefs(f.rule, out)
  else if (rule.k === 'union') for (const a of rule.alts) ruleRefs(a, out)
  return out
}

// ----------------------------------------------------------------------------
// texte canonique
// ----------------------------------------------------------------------------

function litText(v: Lit): string {
  if (typeof v === 'string') return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`
  return String(v)
}

function rangeText(r: { min?: number, max?: number }): string {
  if (r.min === undefined && r.max === undefined) return ''
  return ` ${r.min ?? ''}..${r.max ?? ''}`
}

/** la règle réécrite sous une forme unique ; `names` : une règle nommée s'écrit par son nom (et les
 *  interdits écrits à son usage) ; `sorted` : valeurs, champs, interdits et alternatives d'une union de valeurs
 *  exactes dans l'ordre alphabétique — deux règles qui ne diffèrent que par leur ordre ont le même texte (les
 *  alternatives d'une union de types gardent leur ordre écrit : il décide de la conversion) */
export function ruleText(rule: RuleAst, opts: { names?: boolean, sorted?: boolean } = {}): string {
  const tri   = (xs: string[]): string[] => opts.sorted ? [...xs].sort() : xs
  const nomme = !!(opts.names && rule.name)
  let s: string
  if (nomme) s = rule.name!
  else switch (rule.k) {
    case 'int':
    case 'float':  s = rule.k + rangeText(rule); break
    case 'string': s = 'string' + rangeText(rule) + (rule.re ? ` /${rule.re.source}/${rule.re.flags}` : ''); break
    case 'bool':   s = 'bool'; break
    // seule avec ses interdits (`! 'admin'`), elle ne s'écrit pas ; ailleurs (`any | int`), si
    case 'any':    s = rule.not ? '' : 'any'; break
    case 'ref':    s = rule.name; break
    case 'lit':    s = tri(rule.values.map(litText)).join(' | '); break
    // des valeurs exactes seules ne convertissent rien : leur ordre ne change rien à l'exécution, et se range.
    // Jamais celui de types qui convertissent : `int | string` et `string | int` diffèrent, la première règle
    // qui sait convertir gagne
    case 'union': {
      const alts = rule.alts.map(a => ruleText(a, opts))
      s = (rule.alts.every(a => a.k === 'lit') ? tri(alts) : alts).join(' | ')
      break
    }
    // une union en élément s'écrit entre parenthèses : sans elles, `(int | string)[]` se lirait `int | string[]`
    case 'array': {
      const el   = rule.of
      const alts = el.k === 'union' || (el.k === 'lit' && el.values.length > 1)
      const et   = ruleText(el, opts)
      s = (alts && !(opts.names && el.name) ? `(${et})` : et) + '[]' + rangeText(rule)
      break
    }
    case 'object': s = rule.fields.length === 0 ? '{}' : `{ ${tri(rule.fields.map(f => `${IDENT_RE.test(f.key) ? f.key : litText(f.key)}${f.optional ? '?' : ''}: ${ruleText(f.rule, opts)}`)).join(', ')} }`; break
  }
  // une règle nommée résolue affiche les interdits de son usage ; les siens sont dans sa définition
  const not = nomme && rule.k !== 'ref' ? rule.ownNot : rule.not
  if (not) {
    const items = tri(not.map(b => 'lit' in b ? litText(b.lit) : `${b.min ?? ''}..${b.max ?? ''}`)).join(' | ')
    s = s === '' ? `! ${items}` : `${s} ! ${items}`
  }
  return s
}

// ----------------------------------------------------------------------------
// forme compilée (runtime mjs_types.ts)
// ----------------------------------------------------------------------------
//   t : 'i' int · 'f' float · 's' string · 'b' bool · 'l' valeurs · 'a' liste · 'o' objet · 'u' choix · '*' tout
//   a/b : bornes (valeur, longueur ou nombre d'éléments) · r : forme · v : valeurs permises
//   e : règle des éléments · f : règles des champs · o : champs facultatifs · u : choix
//   n : interdits (valeur exacte, ou plage { a, b }) · d : texte de la règle (développement seulement)

const CODES: Record<string, string> = { int: 'i', float: 'f', string: 's', bool: 'b', lit: 'l', array: 'a', object: 'o', union: 'u', any: '*' }

function jsKey(k: string): string {
  return IDENT_RE.test(k) ? k : JSON.stringify(k)
}

function jsLit(v: Lit): string {
  return JSON.stringify(v)
}

/** la règle (résolue) en littéral JS ; `withText` ajoute le texte de chaque règle, pour les messages */
export function emitRuntimeRule(rule: RuleAst, withText: boolean, displayText?: string): string {
  if (rule.k === 'ref') throw new Error(`règle nommée non résolue : ${rule.name}`)
  const parts: string[] = [`t:'${CODES[rule.k]}'`]
  if ('min' in rule && rule.min !== undefined) parts.push(`a:${rule.min}`)
  if ('max' in rule && rule.max !== undefined) parts.push(`b:${rule.max}`)
  // une fin de ligne (LF ou CR derrière un antislash, U+2028, U+2029) est permise par `new RegExp`, pas dans un littéral
  if (rule.k === 'string' && rule.re) parts.push(/[\n\r\u2028\u2029]/.test(rule.re.source) ? `r:new RegExp(${JSON.stringify(rule.re.source)},${JSON.stringify(rule.re.flags)})` : `r:/${rule.re.source}/${rule.re.flags}`)
  if (rule.k === 'lit') parts.push(`v:[${rule.values.map(jsLit).join(',')}]`)
  if (rule.k === 'array') parts.push(`e:${emitRuntimeRule(rule.of, withText)}`)
  if (rule.k === 'object') {
    parts.push(`f:{${rule.fields.map(f => `${jsKey(f.key)}:${emitRuntimeRule(f.rule, withText)}`).join(',')}}`)
    const opt = rule.fields.filter(f => f.optional).map(f => JSON.stringify(f.key))
    if (opt.length > 0) parts.push(`o:[${opt.join(',')}]`)
  }
  if (rule.k === 'union') parts.push(`u:[${rule.alts.map(a => emitRuntimeRule(a, withText)).join(',')}]`)
  if (rule.not) parts.push(`n:[${rule.not.map(b => 'lit' in b ? jsLit(b.lit) : `{${[b.min !== undefined ? `a:${b.min}` : '', b.max !== undefined ? `b:${b.max}` : ''].filter(Boolean).join(',')}}`).join(',')}]`)
  if (withText) parts.push(`d:${JSON.stringify(displayText ?? ruleText(rule, { names: true }))}`)
  return `{${parts.join(',')}}`
}

// ----------------------------------------------------------------------------
// bloc <vars> d'un composant → règles compilées
// ----------------------------------------------------------------------------

export interface CompiledVars {
  /** noms des variables et props (sans `$`), puis des stores (sans `$$`) */
  names: string[]
  storeNames: string[]
  /** `nom:{…}` des variables et props, dans l'ordre du bloc */
  vars: string[]
  /** `nom:{…}` des stores */
  stores: string[]
  /** texte canonique de la règle de chaque store : le build refuse deux règles différentes */
  storeTypes: Record<string, string>
  /** une règle nommée est citée : le composant dépend des fichiers *.types.mjs */
  usesNamedTypes: boolean
}

/** le bloc <vars> lu, ses règles nommées remplacées par leur définition, puis compilé ; le texte
 *  affiché d'une variable est celui de sa ligne (`Percent`, pas sa définition) */
export function compileVars(section: { raw: string, startLine: number } | null, defs: Record<string, RuleAst>, withText: boolean): CompiledVars {
  const out: CompiledVars = { names: [], storeNames: [], vars: [], stores: [], storeTypes: {}, usesNamedTypes: false }
  if (!section) return out
  for (const e of parseVarsBlock(section.raw, section.startLine)) {
    if (ruleRefs(e.rule).size > 0) out.usesNamedTypes = true
    const resolved = resolveRule(e.rule, defs, { bloc: '<vars>', ligne: e.line })
    const js       = `${jsKey(e.name)}:${emitRuntimeRule(resolved, withText, ruleText(e.rule, { names: true }))}`
    if (e.store) {
      out.stores.push(js)
      out.storeNames.push(e.name)
      out.storeTypes[e.name] = ruleText(resolved, { sorted: true })
    }
    else {
      out.vars.push(js)
      out.names.push(e.name)
    }
  }
  return out
}

// les runes qui rendent une valeur animée, et l'écriture de leurs bornes
const RESSORTS: Record<string, string> = {
  spring:      'µspring(valeur, raideur, amortissement, min, max)',
  interpolate: 'µinterpolate(valeur, durée, min, max)',
}

/** une variable du <vars> qui reçoit un ressort (µspring, µinterpolate) : il a déjà ses propres
 *  bornes, une règle ferait doublon — refusé au build, avec l'endroit où poser les bornes, et la
 *  ligne de l'écriture. `blocs` : le code du composant (<script module>, <script> : `code`, leurs
 *  commentaires et chaînes ne comptent pas ; puis le HTML), chacun avec sa première ligne dans le fichier */
export function checkRessorts(compiled: CompiledVars, blocs: { text: string, startLine: number, code: boolean }[]): void {
  if (compiled.names.length === 0 && compiled.storeNames.length === 0) return
  // sans aucun ressort écrit, rien à chercher : le cas de presque tous les composants
  if (!blocs.some(b => /µ\.?(?:spring|interpolate)\b/.test(b.text))) return
  const noms = [...compiled.names.map(n => '\\$' + n), ...compiled.storeNames.map(n => '\\$\\$' + n)]
  const re   = new RegExp(`(?<![\\w$])(${noms.join('|')})\\s*:?=(?!=)\\s*µ\\.?(spring|interpolate)\\b`)
  for (const b of blocs) {
    const m = re.exec(b.code ? maskInertSameLength(b.text) : b.text)
    if (m) throw new Error(t('types.ressort', { nom: m[1], rune: 'µ' + m[2], signature: RESSORTS[m[2]], ligne: b.startLine + (b.text.slice(0, m.index).match(/\n/g)?.length ?? 0) }))
  }
}
