// transpiler/var-types — types et valeurs permises des variables : grammaire d'une règle, lignes
// d'un bloc <vars> (composant) ou <types> (fichier *.types.mjs), remplacement des règles nommées
// par leur définition, et forme compilée que lit le runtime (mjs_types.ts).
//
// Une règle dit ce que la variable accepte (liste blanche, AVANT le `!`) et ce qu'elle refuse
// (liste noire, APRÈS le `!`) ; la liste blanche peut être vide (`! 'admin' | 'root'` = tout sauf
// ces deux valeurs). Une plage de nombres dit toujours `int` ou `float` : `0..100` seul est refusé.
//
//   int 0..100 · float ..1 · string 3..20 /^[a-z]+$/ · bool · 'red' | 'green' · Percent
//   string[] 0..10 · int 0..10 | 'auto' · string 3..20 ! 'admin' | 'root' · int 0..100 ! 40..60
//
// Une règle d'objet ne s'écrit jamais entre accolades : son nom seul sur sa ligne (`Reward` dans un bloc <types>, `$user` dans
// <vars>), puis un champ par ligne en retrait (`id  int 1..`, `bass?  int -10..10`) ; une liste d'objets, ou un objet qui peut valoir
// null, passe par un type nommé (`Reward[]`, `Reward | null`). Un champ peut porter sa valeur de départ avant sa règle
// (`price = 0  int 0..`) : un champ absent la prend ; elle passe sa règle telle quelle, vérifiée au build. Un `{` qui ouvre un objet
// arrête la construction, et le message montre la forme à écrire.

import { t } from '../messages/index.js'
import { suggestKey } from '../bundler/config.js'
import { maskInertSameLength } from '../lexer/index.js'
import * as acorn from 'acorn'
import { lecturesLibres } from './minuteries.js'

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
  | { k: 'object', fields: FieldAst[] }
  | { k: 'union', alts: RuleAst[] }
  | { k: 'any' }
) & { not?: BlackItem[], name?: string, ownNot?: BlackItem[], strict?: true }

/** valeur de départ d'un champ : une valeur exacte, ou une liste vide */
export type DefaultValue = Lit | never[]

/** un champ d'objet ; `def` : sa valeur de départ (présente même à `null`), `defLine` : sa ligne, comptée depuis
 *  la première ligne de la règle */
export interface FieldAst {
  key:      string
  optional: boolean
  rule:     RuleAst
  def?:     DefaultValue
  defLine?: number
}

/** où se trouve la règle, pour citer la ligne dans un message */
export interface RuleWhere {
  bloc: string
  ligne: number
  /** le nom écrit en tête de la ligne (`$user`, `Reward`) : le refus d'un objet entre accolades montre la forme en retrait sous lui */
  nom?: string
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
    if ('|!{}:,[]?='.includes(c)) { toks.push({ t: 'op', v: c, s: c, i }); i++; continue }
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
  // la position du premier `{` d'un objet : la règle se lit jusqu'au bout, puis la construction s'arrête (cf. sansAccolades)
  private accolade = -1

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
    return this.sansAccolades(() => {
      // `$volume = 50 int 0..100` : la valeur de départ d'une variable s'écrit dans le <script>, celle d'un champ dans la forme en retrait
      if (this.isOp('=')) this.fail(t('types.detail-defaut-hors-champ'))
      const r = this.parseStrict(this.parseRule())
      const k = this.peek()
      if (k.t === 'op' && k.v === '=') this.fail(t('types.detail-defaut-hors-champ'))
      if (k.t !== 'end') this.fail(t('types.detail-jeton-seul', { jeton: k.s }))
      return r
    })
  }

  // une règle qui ouvre un objet entre accolades arrête la construction, lue jusqu'au bout ou non : le message montre la forme en
  // retrait à écrire quand la règle se lit (cf. accolades), sinon il la dit en mots
  private sansAccolades<T extends RuleAst | FieldAst>(lire: () => T): T {
    let r: T
    try {
      r = lire()
    }
    catch (e) {
      if (this.accolade < 0) throw e
      throw new Error(t('types.accolades-illisible', { bloc: this.where.bloc, ligne: this.where.ligne + linesBefore(this.src, this.accolade) }))
    }
    if (this.accolade >= 0) throw new Error(accolades(r, this.where, this.src, this.accolade))
    return r
  }

  /** un champ écrit seul (forme en retrait) : sa valeur de départ facultative, puis sa règle — `price = 0 int 0..` ; une valeur écrite
   *  après la règle est refusée, avec la forme à écrire */
  parseFieldAll(key: string, optional: boolean): FieldAst {
    return this.sansAccolades(() => {
      const f: FieldAst = { key, optional, rule: { k: 'any' } }
      if (this.isOp('=')) this.parseDefault(f)
      f.rule = this.parseStrict(this.parseRule())
      const k = this.peek()
      if (k.t === 'op' && k.v === '=' && !('def' in f)) this.fail(t('types.detail-defaut-avant-regle', { forme: `${fieldName(key, optional)} = ${this.src.slice(k.i + 1).trim()} ${this.src.slice(0, k.i).trim()}` }))
      if (k.t !== 'end') this.fail(t('types.detail-jeton-seul', { jeton: k.s }))
      return f
    })
  }

  // `= valeur` d'un champ : un nombre, un texte, true, false, null ou une liste vide
  private parseDefault(f: FieldAst): void {
    f.defLine = linesBefore(this.src, this.next().i)
    if (this.isOp('[')) {
      this.next()
      this.expectOp(']')
      f.def = []
      return
    }
    const v = this.parseLiteral()
    if (v === undefined) this.fail(t('types.detail-defaut-invalide', { jeton: this.peek().s }))
    f.def = v
  }

  // `strict` en fin de règle : ni conversion ni valeur ramenée, hors règle = refus
  private parseStrict(r: RuleAst): RuleAst {
    const k = this.peek()
    if (k.t !== 'id' || k.v !== 'strict') return r
    this.next()
    r.strict = true
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

  // un objet entre accolades : refusé (cf. sansAccolades), lu seulement pour montrer sa forme en retrait — une valeur de départ s'y
  // lit avant ou après la règle (`{ price = 0 int 0.. }`, `{ price = 0: int 0.. }`, `{ price: int 0.. = 0 }`)
  private parseObject(): RuleAst {
    if (this.accolade < 0) this.accolade = this.peek().i
    this.expectOp('{')
    const fields: FieldAst[] = []
    while (!this.isOp('}')) {
      const k = this.next()
      if (k.t !== 'id' && k.t !== 'str') return this.fail(t('types.detail-jeton-seul', { jeton: k.s }), k.i)
      const f: FieldAst = { key: k.v, optional: this.isOp('?'), rule: { k: 'any' } }
      if (f.optional) this.next()
      if (this.isOp('=')) this.parseDefault(f)
      if (!('def' in f) || this.isOp(':')) this.expectOp(':')
      if (this.isOp('=') && !('def' in f)) this.parseDefault(f)
      f.rule = this.parseStrict(this.parseRule())
      if (this.isOp('=') && !('def' in f)) this.parseDefault(f)
      fields.push(f)
      if (this.isOp(',')) this.next()
      else if (!this.isOp('}')) this.expectOp('}')
    }
    this.next()
    return { k: 'object', fields }
  }
}

// ----------------------------------------------------------------------------
// règle d'objet écrite entre accolades : refusée, avec la forme à écrire
// ----------------------------------------------------------------------------

interface Declarations { lignes: string[], noms: Set<string> }

const retrait = (lignes: string[]): string => lignes.map(l => '  ' + l).join('\n')

// le nom proposé pour un objet : celui de sa variable ou de son champ, capitale en tête (`challenge` → `Challenge`), sans le s final
// dans une liste (`items` → `Item`) ; un nom déjà proposé reçoit un numéro
function nomDeType(indice: string, liste: boolean, d: Declarations): string {
  let base = indice.replace(/^\$+/, '')
  if (!IDENT_RE.test(base)) base = 'Item'
  base = base[0].toUpperCase() + base.slice(1)
  if (liste && base.length > 1 && base.endsWith('s')) base = base.slice(0, -1)
  let nom = base
  for (let n = 2; d.noms.has(nom); n++) nom = base + n
  d.noms.add(nom)
  return nom
}

// les champs d'un objet en retrait, un par ligne (`id  int 1..`, `price = 0  int 0..`), un cran par niveau : un champ objet s'écrit
// sous son nom, un objet dans une liste ou une union devient un type nommé, déclaré dans `d`
function enRetrait(fields: FieldAst[], cran: number, d: Declarations): string[] {
  const pad = '  '.repeat(cran)
  return fields.flatMap(f => {
    const tete = pad + fieldName(f.key, f.optional) + ('def' in f ? ` = ${defaultText(f.def!)}` : '')
    if (f.rule.k === 'object' && !f.rule.strict) return [tete, ...enRetrait(f.rule.fields, cran + 1, d)]
    return [`${tete}  ${sansObjet(f.rule, f.key, d)}`]
  })
}

// le texte d'une règle où chaque objet devient un type nommé, déclaré dans `d` (son nom tiré de `indice`)
function sansObjet(rule: RuleAst, indice: string, d: Declarations): string {
  const nommer = (r: RuleAst, liste: boolean): void => {
    if (r.k === 'object') {
      const nom = nomDeType(indice, liste, d)
      d.lignes.push(...[nom, ...enRetrait(r.fields, 1, d)])
      r.name = nom
    }
    else if (r.k === 'array') nommer(r.of, true)
    else if (r.k === 'union') for (const a of r.alts) nommer(a, liste)
  }
  nommer(rule, false)
  return ruleText(rule, { names: true })
}

// le message d'une règle qui ouvre un objet entre accolades : la forme à écrire — l'objet en retrait sous le nom de sa ligne quand il
// est toute la règle ; sinon chaque objet devient un type nommé à déclarer, puis la ligne s'en sert
function accolades(x: RuleAst | FieldAst, where: RuleWhere, src: string, at: number): string {
  const ou    = { bloc: where.bloc, ligne: where.ligne + linesBefore(src, at) }
  const champ = 'key' in x ? x : undefined
  const rule  = champ ? champ.rule : x as RuleAst
  const tete  = champ ? fieldName(champ.key, champ.optional) : where.nom
  const d: Declarations = { lignes: [], noms: new Set() }
  const vide  = (r: RuleAst): boolean => r.k === 'object' ? r.fields.length === 0 || r.fields.some(f => vide(f.rule)) : r.k === 'array' ? vide(r.of) : r.k === 'union' && r.alts.some(vide)
  if (vide(rule)) return t('types.accolades-vide', ou)
  const depart = champ && 'def' in champ ? ` = ${defaultText(champ.def!)}` : ''
  const usage  = tete !== undefined && rule.k === 'object' && !rule.strict && depart === '' ? [tete, ...enRetrait(rule.fields, 1, d)] : [`${tete ?? ''}${depart}  ${sansObjet(rule, champ?.key ?? where.nom ?? where.bloc, d)}`.trim()]
  if (d.lignes.length === 0) return t('types.accolades', { ...ou, forme: retrait(usage) })
  return t('types.accolades-type', { ...ou, types: retrait(d.lignes), usage: retrait(usage) })
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

interface RawLine { code: string, line: number, indent: number }
interface RawEntry { head: string, rest: string, line: number, body?: RawLine[] }

const indentOf = (s: string): number => s.length - s.trimStart().length

// regroupe les lignes utiles en entrées : une entrée continue tant que ses accolades restent ouvertes ; `indented`
// (bloc <types>) : un nom seul sur sa ligne garde aussi, pour corps, les lignes plus en retrait qui le suivent
function entries(raw: string, startLine: number, bloc: string, indented = false): RawEntry[] {
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
    const e: RawEntry = { head: m[1], rest: m[2], line }
    if (indented && m[2].trim() === '') {
      const base = indentOf(code)
      const body: RawLine[] = []
      while (i + 1 < lines.length) {
        const suite = scanLine(lines[i + 1]).code
        if (suite.trim() !== '' && indentOf(suite) <= base) break
        i++
        if (suite.trim() !== '') body.push({ code: suite, line: startLine + i, indent: indentOf(suite) })
      }
      if (body.length > 0) e.body = body
    }
    out.push(e)
  }
  return out
}

/** les lignes d'un bloc <vars> : `$nom  règle` (variable ou prop) et `$$nom  règle` (store) ; un objet s'écrit en retrait sous sa
 *  variable, un champ par ligne, comme dans un bloc <types> */
export function parseVarsBlock(raw: string, startLine: number): VarRuleEntry[] {
  const out: VarRuleEntry[] = []
  const vus = new Set<string>()
  for (const e of entries(raw, startLine, '<vars>', true)) {
    if (e.head[0] !== '$') throw new Error(t('types.regle-nommee-dans-vars', { ligne: e.line, nom: e.head }))
    const store = e.head.startsWith('$$')
    const name  = e.head.slice(store ? 2 : 1)
    if (e.body) {
      if (vus.has(e.head)) throw new Error(t('types.double', { bloc: '<vars>', ligne: e.line, nom: e.head }))
      vus.add(e.head)
      out.push({ name, store, rule: indentedObject(e.body, '<vars>', e.line), line: e.line })
      continue
    }
    const rest  = e.rest.trim()
    if (rest.startsWith(':')) throw new Error(t('types.deux-points', { bloc: '<vars>', ligne: e.line, nom: e.head, regle: rest.slice(1).trim() }))
    if (rest === '') throw new Error(t('types.regle-manquante', { bloc: '<vars>', ligne: e.line, nom: e.head }))
    if (vus.has(e.head)) throw new Error(t('types.double', { bloc: '<vars>', ligne: e.line, nom: e.head }))
    vus.add(e.head)
    out.push({ name, store, rule: parseRule(rest, { bloc: '<vars>', ligne: e.line, nom: e.head }), line: e.line })
  }
  return out
}

// un champ écrit en retrait est lu seul : ses lignes se comptent ensuite depuis celle de la règle nommée
function shiftLines(r: RuleAst, n: number): void {
  if (r.k === 'ref') r.lineOffset = (r.lineOffset ?? 0) + n
  else if (r.k === 'array') shiftLines(r.of, n)
  else if (r.k === 'union') for (const a of r.alts) shiftLines(a, n)
  else if (r.k === 'object') {
    for (const f of r.fields) {
      shiftLines(f.rule, n)
      if ('def' in f) f.defLine = (f.defLine ?? 0) + n
    }
  }
}

// le corps en retrait d'une règle d'objet écrite sans accolades : un champ par ligne, `nom  [= valeur]  règle`
// (`nom?` : facultatif) ; un nom seul suivi de lignes plus en retrait est un objet à son tour. `top` : la ligne
// de la règle nommée, d'où se comptent les lignes de ses champs
function indentedObject(body: RawLine[], bloc: string, top: number): RuleAst {
  const fields: FieldAst[] = []
  for (let i = 0; i < body.length; i++) {
    const l = body[i]
    let j = i
    while (j + 1 < body.length && body[j + 1].indent > l.indent) j++
    // la clé : un nom simple, ou entre guillemets (`'prénom'`, `"created-at"`) ; un nom simple collé à un autre caractère n'est ni
    // l'un ni l'autre : le message montre la clé entière, entre guillemets
    const m = /^\s*(?:([A-Za-z_][A-Za-z0-9_]*)|'([^'\\\n]*)'|"([^"\\\n]*)")(\?)?(.*)$/s.exec(l.code)
    if (!m) throw new Error(t('types.ligne-invalide', { bloc, ligne: l.line, texte: l.code.trim() }))
    if (m[1] !== undefined && m[4] === undefined && /^[^\s:=]/.test(m[5])) {
      const cle = /^\s*(\S+?)\??(?:\s|$)/.exec(l.code)![1]
      throw new Error(t('types.cle-entre-guillemets', { bloc, ligne: l.line, cle, forme: `'${cle}'` + l.code.trim().slice(cle.length) }))
    }
    const key  = m[1] ?? m[2] ?? m[3]
    const rest = m[5].trim()
    const ou   = { bloc, ligne: l.line }
    if (key === '__proto__') throw new Error(t('types.regle-invalide', { ...ou, texte: l.code.trim(), detail: t('types.detail-cle-reservee', { cle: key }) }))
    if (fields.some(f => f.key === key)) throw new Error(t('types.regle-invalide', { ...ou, texte: l.code.trim(), detail: t('types.detail-cle-double', { cle: key }) }))
    if (rest.startsWith(':')) throw new Error(t('types.deux-points', { ...ou, nom: key, regle: rest.slice(1).trim() }))
    let f: FieldAst
    if (j > i) {
      if (rest !== '') throw new Error(t('types.retrait-apres-regle', { ...ou, cle: key }))
      f = { key, optional: m[4] === '?', rule: indentedObject(body.slice(i + 1, j + 1), bloc, top) }
    }
    else {
      if (rest === '') throw new Error(t('types.regle-manquante', { ...ou, nom: key }))
      f = new RuleParser(rest, ou).parseFieldAll(key, m[4] === '?')
      shiftLines(f.rule, l.line - top)
      if ('def' in f) f.defLine = l.line - top
    }
    fields.push(f)
    i = j
  }
  return { k: 'object', fields }
}

/** les lignes d'un bloc <types> : `Nom  règle`, une règle nommée par ligne ; une règle d'objet peut aussi s'écrire
 *  sans accolades, son nom seul sur sa ligne et un champ par ligne en retrait */
export function parseTypesBlock(raw: string, startLine: number): TypeDefEntry[] {
  const out: TypeDefEntry[] = []
  const vus = new Set<string>()
  for (const e of entries(raw, startLine, '<types>', true)) {
    if (e.head[0] === '$') throw new Error(t('types.variable-dans-types', { ligne: e.line, nom: e.head }))
    if (RESERVED.has(e.head)) throw new Error(t('types.mot-reserve', { ligne: e.line, nom: e.head }))
    if (e.body) {
      if (vus.has(e.head)) throw new Error(t('types.double', { bloc: '<types>', ligne: e.line, nom: e.head }))
      vus.add(e.head)
      out.push({ name: e.head, rule: indentedObject(e.body, '<types>', e.line), line: e.line })
      continue
    }
    const rest = e.rest.trim()
    if (rest.startsWith(':')) throw new Error(t('types.deux-points', { bloc: '<types>', ligne: e.line, nom: e.head, regle: rest.slice(1).trim() }))
    if (rest === '') throw new Error(t('types.regle-manquante', { bloc: '<types>', ligne: e.line, nom: e.head }))
    if (vus.has(e.head)) throw new Error(t('types.double', { bloc: '<types>', ligne: e.line, nom: e.head }))
    vus.add(e.head)
    out.push({ name: e.head, rule: parseRule(rest, { bloc: '<types>', ligne: e.line, nom: e.head }), line: e.line })
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
  const r = resolveRuleSans(rule, defs, where, chaine, own)
  // `strict` porte sur la règle de sa ligne, nommée ou non
  if (rule.strict) r.strict = true
  return r
}

function resolveRuleSans(rule: RuleAst, defs: Record<string, RuleAst>, where: RuleWhere, chaine: string[], own: boolean): RuleAst {
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
      return avec({ k: 'object', fields: rule.fields.map(f => resolveField(f, resolveRule(f.rule, defs, where, chaine, own), where, own)) })
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

// un champ résolu, avec sa valeur de départ : elle passe sa règle telle quelle (ni conversion, ni borne, rien
// d'interdit), sinon le build s'arrête sur sa ligne
function resolveField(f: FieldAst, rule: RuleAst, where: RuleWhere, own: boolean): FieldAst {
  const out: FieldAst = { key: f.key, optional: f.optional, rule }
  if (!('def' in f)) return out
  if (!defaultPasses(rule, f.def!)) throw new Error(t('types.defaut-refuse', { bloc: where.bloc, ligne: own ? where.ligne + (f.defLine ?? 0) : where.ligne, cle: f.key, valeur: defaultText(f.def!), regle: ruleText(rule) }))
  out.def     = f.def
  out.defLine = f.defLine
  return out
}

function inRange(r: { min?: number, max?: number }, n: number): boolean {
  return (r.min === undefined || n >= r.min) && (r.max === undefined || n <= r.max)
}

// la valeur de départ passe-t-elle la règle (résolue) telle quelle ?
function defaultPasses(r: RuleAst, v: DefaultValue): boolean {
  if (r.not && r.not.some(b => 'lit' in b ? b.lit === v : typeof v === 'number' && inRange(b, v))) return false
  switch (r.k) {
    case 'any':    return true
    case 'int':    return typeof v === 'number' && Number.isInteger(v) && inRange(r, v)
    case 'float':  return typeof v === 'number' && inRange(r, v)
    case 'string': return typeof v === 'string' && inRange(r, [...v].length) && (!r.re || new RegExp(r.re.source, r.re.flags).test(v))
    case 'bool':   return typeof v === 'boolean'
    case 'lit':    return !Array.isArray(v) && r.values.includes(v)
    case 'union':  return r.alts.some(a => defaultPasses(a, v))
    case 'array':  return Array.isArray(v) && inRange(r, v.length)
    default:       return false
  }
}

function defaultText(v: DefaultValue): string {
  return Array.isArray(v) ? '[]' : litText(v)
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
// le nom d'un champ tel qu'il s'écrit (`price`, `'prénom'`, `note?`)
function fieldName(key: string, optional: boolean): string {
  return (IDENT_RE.test(key) ? key : litText(key)) + (optional ? '?' : '')
}

export function ruleText(rule: RuleAst, opts: { names?: boolean, sorted?: boolean } = {}): string {
  const s = ruleTextSans(rule, opts)
  return rule.strict ? `${s} strict` : s
}

function ruleTextSans(rule: RuleAst, opts: { names?: boolean, sorted?: boolean }): string {
  const tri   = (xs: string[]): string[] => opts.sorted ? [...xs].sort() : xs
  // un objet nommé s'écrit par son nom, sauf dans le texte trié, qui compare deux règles de magasin par leur forme
  const nomme = !!(rule.name && (opts.names || (rule.k === 'object' && !opts.sorted)))
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
      // un objet en retrait (texte trié) : la liste se dit d'abord, ses champs suivent
      s = et.startsWith('\n') ? '[]' + rangeText(rule) + et : (alts && !(opts.names && el.name) ? `(${et})` : et) + '[]' + rangeText(rule)
      break
    }
    // un objet sans nom s'écrit en retrait, un champ par ligne, sous la ligne qui le cite (son texte commence par une fin de ligne)
    case 'object': s = champsTexte(rule.fields, opts, 1); break
  }
  // une règle nommée résolue affiche les interdits de son usage ; les siens sont dans sa définition
  const not = nomme && rule.k !== 'ref' ? rule.ownNot : rule.not
  if (not) {
    const items = tri(not.map(b => 'lit' in b ? litText(b.lit) : `${b.min ?? ''}..${b.max ?? ''}`)).join(' | ')
    s = s === '' ? `! ${items}` : `${s} ! ${items}`
  }
  return s
}

// les champs d'une règle d'objet, en retrait sous la ligne qui la cite : `\n  id  int 1..`, `\n  price = 0  int 0..` (forme que lit un
// bloc <types>) ; un champ objet sans nom, sous le sien, un cran plus loin. Le texte trié, qui compare deux règles de magasin, garde
// la valeur de départ entre ses marques (cf. storeRuleShown)
function champsTexte(fields: FieldAst[], opts: { names?: boolean, sorted?: boolean }, cran: number): string {
  const pad    = '  '.repeat(cran)
  const lignes = fields.map(f => {
    const tete = pad + fieldName(f.key, f.optional) + ('def' in f && !opts.sorted ? ` = ${defaultText(f.def!)}` : '')
    const fin  = 'def' in f && opts.sorted ? DEPART_A + defaultText(f.def!) + DEPART_B : ''
    return (f.rule.k === 'object' && !f.rule.name ? tete + champsTexte(f.rule.fields, opts, cran + 1) : `${tete}  ${ruleText(f.rule, opts)}`) + fin
  })
  return (opts.sorted ? lignes.sort() : lignes).map(l => '\n' + l).join('')
}

// ----------------------------------------------------------------------------
// forme compilée (runtime mjs_types.ts)
// ----------------------------------------------------------------------------
//   t : 'i' int · 'f' float · 's' string · 'b' bool · 'l' valeurs · 'a' liste · 'o' objet · 'u' choix · '*' tout
//   a/b : bornes (valeur, longueur ou nombre d'éléments) · r : forme · v : valeurs permises
//   e : règle des éléments · f : règles des champs · o : champs facultatifs · z : valeurs de départ des champs · u : choix
//   n : interdits (valeur exacte, ou plage { a, b }) · d : texte de la règle (développement ; une production qui signale ses refus ne garde que le nom d'une règle nommée)

const CODES: Record<string, string> = { int: 'i', float: 'f', string: 's', bool: 'b', lit: 'l', array: 'a', object: 'o', union: 'u', any: '*' }

function jsKey(k: string): string {
  return IDENT_RE.test(k) ? k : JSON.stringify(k)
}

function jsLit(v: Lit): string {
  return JSON.stringify(v)
}

// le nom d'une règle nommée, listes comprises (`Reward`, `Reward[]`) : le seul texte d'une règle que garde une production qui signale
// ses refus ; rien pour une règle écrite sur place
function ruleName(rule: RuleAst): string | undefined {
  let r = rule, n = 0
  while (r.k === 'array') {
    r = r.of
    n++
  }
  return r.k === 'ref' ? r.name + '[]'.repeat(n) : undefined
}

/** la règle (résolue) en littéral JS ; `withText` ajoute le texte de chaque règle, pour les messages — `'names'` (production qui
 *  signale ses refus, `typesReport`) : `displayText` seul, le nom de la règle nommée, à son sommet */
export function emitRuntimeRule(rule: RuleAst, withText: boolean | 'names', displayText?: string): string {
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
    const z = rule.fields.filter(f => 'def' in f).map(f => `${jsKey(f.key)}:${JSON.stringify(f.def)}`)
    if (z.length > 0) parts.push(`_mjs_z:{${z.join(',')}}`)
  }
  if (rule.k === 'union') parts.push(`u:[${rule.alts.map(a => emitRuntimeRule(a, withText)).join(',')}]`)
  if (rule.not) parts.push(`n:[${rule.not.map(b => 'lit' in b ? jsLit(b.lit) : `{${[b.min !== undefined ? `a:${b.min}` : '', b.max !== undefined ? `b:${b.max}` : ''].filter(Boolean).join(',')}}`).join(',')}]`)
  if (rule.strict) parts.push('_mjs_tstrict:1')
  const d = withText === true ? displayText ?? ruleText(rule, { names: true }) : withText === 'names' ? displayText : undefined
  if (d !== undefined) parts.push(`d:${JSON.stringify(d)}`)
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
  /** variables et props dont la règle n'admet que des valeurs simples (chaîne, nombre, booléen, valeur exacte) */
  simples: string[]
}

// règle qui n'admet que des valeurs simples : rien ne peut les modifier en place
function regleSimple(r: RuleAst): boolean {
  if (r.k === 'union') return r.alts.every(regleSimple)
  return r.k === 'int' || r.k === 'float' || r.k === 'string' || r.k === 'bool' || r.k === 'lit'
}

/** le bloc <vars> lu, ses règles nommées remplacées par leur définition, puis compilé ; le texte
 *  affiché d'une variable est celui de sa ligne (`Percent`, pas sa définition) */
export function compileVars(section: { raw: string, startLine: number } | null, defs: Record<string, RuleAst>, withText: boolean | 'names'): CompiledVars {
  const out: CompiledVars = { names: [], storeNames: [], vars: [], stores: [], storeTypes: {}, usesNamedTypes: false, simples: [] }
  if (!section) return out
  for (const e of parseVarsBlock(section.raw, section.startLine)) {
    if (ruleRefs(e.rule).size > 0) out.usesNamedTypes = true
    const resolved = resolveRule(e.rule, defs, { bloc: '<vars>', ligne: e.line })
    const js       = `${jsKey(e.name)}:${emitRuntimeRule(resolved, withText, withText === 'names' ? ruleName(e.rule) : ruleText(e.rule, { names: true }))}`
    if (e.store) {
      out.stores.push(js)
      out.storeNames.push(e.name)
      out.storeTypes[e.name] = ruleText(resolved, { sorted: true })
    }
    else {
      out.vars.push(js)
      out.names.push(e.name)
      if (regleSimple(resolved)) out.simples.push(e.name)
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

// ----------------------------------------------------------------------------
// réponse d'un appel µajax : `type: Reward[]`
// ----------------------------------------------------------------------------

// un appel par verbe (`µajax.get`, `µajax.post`…), et le `type: Nom` ou `type: Nom[]` de ses arguments ; une fonction passée en
// argument (`->`, `=>`, `function`) clôt ses arguments de premier niveau : son corps n'en est pas
const AJAX_VERB_RE      = /(?<![\w$])(?:µ|mjs)\s*\.?\s*ajax\s*\.\s*(get|post|put|patch|delete|binary)\b/g
const AJAX_VERB_TYPE_RE = /(?<![\w$.])type\s*:\s*([A-Za-z_][A-Za-z0-9_]*)((?:\s*\[\s*\])*)(?![\w$.(\[])/g
const AJAX_VERB_FIN_RE  = /[-=]>|(?<![\w$.])function(?![\w$])/
const AJAX_VERB_CLE_RE  = /(?<![\w$.])type\s*:\s*/g
// une clé lue dans les options d'un appel (`data:`, `type:` ; ni `::` ni `:=`), un ouvrant, un fermant, `,`, `;`, ou une fin de ligne
// suivie du retrait de la ligne d'après (lignes vides passées)
const OPTION_TOKEN_RE = /\n(?:[ \t]*\n)*[ \t]*|[([{]|[)\]}]|[,;]|(?<![\w$.])([A-Za-z_$][\w$]*)[ \t]*:(?![:=])/g
// la valeur d'un `type:` : un nom de règle, puis `[]` pour une liste
const AJAX_TYPE_VALUE_RE = /([ \t]*)([A-Za-z_][A-Za-z0-9_]*)((?:\s*\[\s*\])*)(?![\w$.(\[])/y

/** les positions, dans `masked`, des clés `type` du PREMIER niveau des options d'un appel `µajax url, options` lu de `from` (juste
 *  après `µajax`) à `fin` (la fin de sa dernière ligne) : sur la ligne de l'appel, ou sur une ligne au retrait des options ; jamais
 *  dans `data:` ni un autre objet imbriqué (`data: type: x` compris), un rappel, ou une ligne plus en retrait */
function optionTypeKeys(masked: string, from: number, fin: number): number[] {
  const out: number[] = []
  const lead = /^[ \t]*/.exec(masked.slice(from, fin))![0].length
  // profondeur des arguments : 1 pour `µajax(url, …)`, 0 pour `µajax url, …` ; `niveau` : celle des clés des options, un cran plus
  // bas quand elles sont entre accolades (un `{` qui suit la virgule d'un argument)
  const base   = masked[from + lead] === '(' ? 1 : 0
  let pile     = 0
  let niveau   = base
  let apresCle = false
  let colonne  = -2
  let ligne    = -2
  let attente  = false
  OPTION_TOKEN_RE.lastIndex = from + lead
  for (let m = OPTION_TOKEN_RE.exec(masked); m !== null && m.index < fin; m = OPTION_TOKEN_RE.exec(masked)) {
    const c = m[0][0]
    if (c === '\n') {
      // la première ligne suivante donne le retrait des clés des options, sauf si la ligne d'avant finit par `clé:` (sa valeur suit,
      // en retrait) ; une ligne à ce retrait commence une nouvelle clé
      ligne = m[0].length - m[0].lastIndexOf('\n') - 1
      if (colonne === -2) colonne = attente ? -1 : ligne
      if (ligne === colonne && pile === niveau) apresCle = false
      attente = false
      continue
    }
    attente = false
    if (c === '(' || c === '[' || c === '{') {
      if (c === '{' && pile === base && niveau === base && /,\s*$/.test(masked.slice(from, m.index))) niveau = base + 1
      pile++
      continue
    }
    if (c === ')' || c === ']' || c === '}') {
      if (--pile < niveau) break
      continue
    }
    if (pile !== niveau) continue
    if (c === ';') break
    if (c === ',') {
      apresCle = false
      continue
    }
    if (m[1] === 'type' && !apresCle && (ligne === -2 || ligne === colonne)) out.push(m.index)
    apresCle = true
    attente  = /^[ \t]*(?:\n|$)/.test(masked.slice(OPTION_TOKEN_RE.lastIndex, fin))
  }
  return out
}

// la valeur écrite d'une clé, depuis `debut` : jusqu'à la virgule, au point-virgule, à la fin de ligne ou au crochet fermant de son niveau
function valeurDeCle(texte: string, debut: number): string {
  let p = 0
  let i = debut
  for (; i < texte.length; i++) {
    const c = texte[i]
    if ('([{'.includes(c)) p++
    else if (')]}'.includes(c) && p-- === 0) break
    else if (p === 0 && (c === ',' || c === ';' || c === '\n')) break
  }
  return texte.slice(debut, i).trim()
}

// les clés des options de la forme appelable que lit le runtime (mjs_ajax.ts : _request et le schéma ; mjs_types_ajax.ts) : une liste
// fermée. Une autre clé n'est lue par aucun appel : un ancien nom (`onError:`, `onTypeError:`, une autre casse de `error:` ou de
// `typeError:`) perdrait son gestionnaire sans rien dire, une clé mal écrite son réglage — la construction s'arrête, et le message dit
// la clé à écrire. Lues sur l'objet tel que le langage l'a rangé (ajaxOptionsSurLArbre) ; un objet d'options que la construction ne
// lit pas (une variable) est averti en développement (mjs_ajax.ts)
const AJAX_OPTION_KEYS = ['method', 'data', 'headers', 'timeout', 'signal', 'success', 'error', 'always', 'schema', 'codec', 'schemaUrl', 'type', 'typeError']

/** le code d'un <script> où le `type: Reward` ou `type: Reward[]` d'un appel `µajax url, options` devient la règle nommée compilée,
 *  `µ._mjs_tajax({…})` : la réponse passera une fois par elle, à son arrivée (mjs_types.ts). Seule la clé `type` du premier niveau
 *  des options de cette forme contrôle la réponse : dans `data:`, un objet imbriqué, un rappel ou un appel par verbe (`µajax.post
 *  '/x', {type: kind}, f`), `type:` est une donnée, envoyée telle quelle — sauf, dans les arguments de premier niveau d'un appel par
 *  verbe, `type: Nom[]`, qui n'en est pas une, et `type: Nom` d'un type déclaré que rien ne lie autour de l'appel (un nom de règle
 *  cité dans une expression aussi : `type: [Nom]`, `type: Nom.id`) : ils arrêtent le build et montrent la forme à écrire ; de même
 *  `type: Nom[]` après un rappel. Un nom inconnu suivi de `[]`, ou proche d'un nom déclaré,
 *  arrête le build avec une suggestion ; un autre nom reste une valeur JavaScript. Les lignes ne bougent pas. `used` : une règle
 *  nommée est citée, le composant dépend des fichiers *.types.mjs. `component` : la balise du composant, que la µTypeError d'une
 *  réponse refusée nomme ; `aLier` (rendu) : les `type: Nom` de verbe d'un type déclaré, que checkAjaxVerbNames vérifie sur le code compilé du fichier ; `bloc` : ce que nomment ses messages, avec la ligne (`<script>`, ou le fichier d'un module : `charger.coffee`) */
export function compileAjaxTypes(code: string, defs: Record<string, RuleAst>, withText: boolean | 'names', startLine: number, component?: string, bloc = '<script>', marquer = false): { code: string, used: boolean, aLier: AjaxVerbName[] } {
  if (!/ajax/.test(code)) return { code, used: false, aLier: [] }
  if (!/type\s*:/.test(code)) return { code, used: false, aLier: [] }
  const masked = maskInertSameLength(code)
  const lines  = masked.split('\n')
  const starts: number[] = []
  const cles   = new Set<number>()
  const edits: { a: number, b: number, text: string }[] = []
  lines.reduce((n, l) => { starts.push(n); return n + l.length + 1 }, 0)
  // un appel par verbe garde ses données, comme en 3.1.0 ; `type: Nom[]`, qui ne peut pas en être une, et `type: Nom` d'un type
  // déclaré que rien ne lie autour de l'appel (`Nom is not defined` à l'exécution) arrêtent le build et montrent
  // la forme appelable à écrire. Seuls ses arguments de premier niveau comptent : le corps d'un rappel se lit pour lui-même
  const aLier: AjaxVerbName[] = []
  const apres: { at: number, ligne: number, type: string, verbe: string }[] = []
  for (let i = 0; i < lines.length; i++) {
    for (const verbe of lines[i].matchAll(AJAX_VERB_RE)) {
      let j = i
      while (j + 1 < lines.length && (lines[j + 1].trim() === '' || indentOf(lines[j + 1]) > indentOf(lines[i]))) j++
      const suite = masked.slice(starts[i] + verbe.index! + verbe[0].length, starts[j] + lines[j].length)
      const fin   = AJAX_VERB_FIN_RE.exec(suite)
      const zone  = fin ? suite.slice(0, fin.index) : suite
      // le même passage, tel qu'écrit : le texte masqué n'a plus ce qu'il y a entre guillemets (`Reward['id']` y devient `Reward[    ]`)
      const base  = starts[i] + verbe.index! + verbe[0].length
      const brut  = code.slice(base, base + zone.length)
      for (const m of zone.matchAll(AJAX_VERB_TYPE_RE)) {
        // la valeur entière, telle qu'écrite : un nom suivi d'autre chose (`Reward?.id`, `Reward or 1`, `Reward?`, `Reward['id']`) est une
        // expression, lue plus bas et citée telle quelle
        const cleEcrite = /^type\s*:\s*/.exec(brut.slice(m.index!))
        if (!/^[A-Za-z_][A-Za-z0-9_]*(?:\s*\[\s*\])*$/.test(valeurDeCle(brut, m.index! + (cleEcrite ? cleEcrite[0].length : m[0].length)))) continue
        const paires = (m[2].match(/\[/g) ?? []).length
        const ligne  = startLine + i + (zone.slice(0, m.index).match(/\n/g)?.length ?? 0)
        if (paires === 0 && !Object.prototype.hasOwnProperty.call(defs, m[1])) continue
        // un type déclaré écrit seul est une donnée si une liaison de ce nom englobe l'appel : le code compilé le dira (cf. checkAjaxVerbNames)
        if (paires === 0) {
          aLier.push({ nom: m[1], ligne, verbe: verbe[1], bloc })
          continue
        }
        throw new Error(t('types.ajax-verbe', { bloc, ligne, type: m[1] + '[]'.repeat(paires), verbe: verbe[1] }))
      }
      // un nom de règle cité dans une expression (`type: [Reward]`, `type: Reward.id`) : une donnée seulement si une liaison l'englobe,
      // comme `type: Reward` ; `Nom` et `Nom[]` se lisent plus haut
      for (const m of zone.matchAll(AJAX_VERB_CLE_RE)) {
        const masque = valeurDeCle(zone, m.index! + m[0].length)
        const debut  = zone.indexOf(masque, m.index! + m[0].length)
        // une valeur toute entre guillemets (`"#{Reward}"`) est vide dans le texte masqué, où la clé avale ses espaces : elle se lit
        // telle qu'écrite, juste après la clé écrite
        const cle    = /^type\s*:\s*/.exec(brut.slice(m.index!))
        const ecrit  = masque.trim() === '' ? valeurDeCle(brut, m.index! + (cle ? cle[0].length : m[0].length)) : debut === -1 ? masque : brut.slice(debut, debut + masque.length)
        if (/^[A-Za-z_][A-Za-z0-9_]*(?:\s*\[\s*\])*$/.test(ecrit)) continue
        const ligne  = startLine + i + (zone.slice(0, m.index).match(/\n/g)?.length ?? 0)
        // les noms du code, et ceux d'une interpolation (`"#{Reward}"`, `` `${Reward}` ``), que le texte masqué n'a plus
        const noms   = [masque, ...[...ecrit.matchAll(/#\{([^}]*)\}|\$\{([^}]*)\}/g)].map(x => x[1] ?? x[2])]
        for (const n of noms.flatMap(s => [...s.matchAll(/(?<![\w$.])[A-Za-z_][A-Za-z0-9_]*(?![\w$]|\s*:)/g)])) {
          if (Object.prototype.hasOwnProperty.call(defs, n[0])) aLier.push({ nom: n[0], ligne, verbe: verbe[1], bloc, ecrit })
        }
      }
      // `type: Nom[]` après un rappel n'est pas une donnée non plus : refusé plus bas, sauf s'il est l'option d'une forme appelable
      // écrite dans le rappel
      if (fin) {
        const debut = starts[i] + verbe.index! + verbe[0].length + fin.index
        for (const m of suite.slice(fin.index).matchAll(AJAX_VERB_TYPE_RE)) {
          const paires = (m[2].match(/\[/g) ?? []).length
          if (paires === 0) continue
          const at = debut + m.index!
          apres.push({ at, ligne: startLine + (masked.slice(0, at).match(/\n/g)?.length ?? 0), type: m[1] + '[]'.repeat(paires), verbe: verbe[1] })
        }
      }
    }
  }
  // l'appel se lit sur le code (le texte masqué n'a plus l'adresse entre guillemets qui le suit), hors d'un texte ou d'un commentaire
  for (const appel of code.matchAll(AJAX_CALLABLE_RE)) {
    if (masked.slice(appel.index!, appel.index! + appel[0].length) !== appel[0]) continue
    let i = 0
    while (i + 1 < starts.length && starts[i + 1] <= appel.index!) i++
    let j = i
    while (j + 1 < lines.length && (lines[j + 1].trim() === '' || indentOf(lines[j + 1]) > indentOf(lines[i]))) j++
    for (const k of optionTypeKeys(masked, appel.index! + appel[0].length, starts[j] + lines[j].length)) cles.add(k)
  }
  for (const a of apres) {
    if (!cles.has(a.at)) throw new Error(t('types.ajax-verbe', { bloc, ligne: a.ligne, type: a.type, verbe: a.verbe }))
  }
  for (const k of [...cles].sort((x, y) => x - y)) {
    AJAX_TYPE_VALUE_RE.lastIndex = masked.indexOf(':', k) + 1
    const m = AJAX_TYPE_VALUE_RE.exec(masked)
    if (!m) continue
    const nom = m[2]
    if (!Object.prototype.hasOwnProperty.call(defs, nom) && m[3] === '' && !suggestKey(nom, Object.keys(defs))) continue
    let rule: RuleAst = { k: 'ref', name: nom }
    for (let n = (m[3].match(/\[/g) ?? []).length; n > 0; n--) rule = { k: 'array', of: rule }
    const ligne = startLine + (masked.slice(0, k).match(/\n/g)?.length ?? 0)
    const regle = emitRuntimeRule(resolveRule(rule, defs, { bloc, ligne }), withText, ruleText(rule, { names: true }))
    // dans la chaîne de compilation (`marquer`), la valeur écrite part avec la règle, en dernier argument : sur l'arbre du code compilé,
    // ajaxOptionsSurLArbre la retire, ou rend
    // la donnée écrite si le langage a rangé ce `type:` ailleurs qu'au premier niveau des options (dans `data:`)
    edits.push({ a: m.index + m[1].length, b: m.index + m[0].length, text: marquer ? `µ._mjs_tajax(${regle}, ${component ? JSON.stringify(component) : 'undefined'}, ${JSON.stringify(MARQUE_TAJAX + code.slice(m.index + m[1].length, m.index + m[0].length).trim())})` : `µ._mjs_tajax(${regle}${component ? ', ' + JSON.stringify(component) : ''})` })
  }
  let out = code
  for (const e of edits.reverse()) out = out.slice(0, e.a) + e.text + out.slice(e.b)
  return { code: out, used: edits.length > 0, aLier }
}

/** un `type: Nom` d'un verbe, où `Nom` est un type déclaré : une donnée si une liaison de ce nom englobe l'appel (sinon l'appel
 *  lèverait « Nom is not defined »), ce que checkAjaxVerbNames lit sur le code compilé ; `ecrit` : la valeur écrite quand le nom est
 *  cité dans une expression (`[Reward]`, `Reward.id`) */
export interface AjaxVerbName { nom: string, ligne: number, verbe: string, bloc: string, ecrit?: string }

// µajax s'appelle directement (décision du 04/11) : la forme appelable n'entre au cœur que si la construction voit un appel direct —
// `µajax(…)`, `µajax '/url', …` (écrits `µ._mjs_ajax(`), `µajax?(…)`, `µajax?.(…)`, les mêmes par `µ.ajax`. Pris comme valeur —
// passé en argument, rangé (`f = µajax`), décomposé (`{ ajax } = µ`, `{ ajax: r } = µ`), `µ['ajax']`, `.call`, `.bind`, `.apply` —,
// il arrête la construction (checkAjaxVerbNames). Restent permis, sans la forme appelable : un verbe appelé (`µajax.get(…)`), un
// membre lu ou écrit (`µ.ajax.error = …`), `typeof µajax`. Un appel que l'arbre ne montre pas (`µ[k]`) est averti en développement
const AJAX_PAR_FONCTION = new Set(['call', 'bind', 'apply'])
const muNoeud = (n: any): boolean => n != null && ((n.type === 'Identifier' && n.name === 'µ') || (n.type === 'MemberExpression' && !n.computed && n.property.type === 'Identifier' && n.property.name === 'µ'))
const nomDeCle = (k: any, calcule: boolean): string | null => !calcule ? (k.type === 'Identifier' ? k.name : typeof k.value === 'string' ? k.value : null) : k.type === 'Literal' && typeof k.value === 'string' ? k.value : k.type === 'TemplateLiteral' && k.expressions.length === 0 ? k.quasis[0].value.cooked : null
// `µajax` seulement testé — `µajax?` (`typeof µ.ajax !== "undefined" && µ.ajax !== null`), `if µajax`, `µ.ajax and µ.ajax.get(…)`,
// `µ.ajax ? … : …`, `!µ.ajax` : une garde d'existence, permise comme `typeof µajax`, jamais un appel
const gardeAjax = (n: any, p: any): boolean => p != null && ((/^(?:If|While|DoWhile|For)Statement$|^ConditionalExpression$/.test(p.type) && p.test === n) || (p.type === 'LogicalExpression' && p.operator === '&&' && p.left === n) || (p.type === 'UnaryExpression' && p.operator === '!') || (p.type === 'BinaryExpression' && /^[!=]==?$/.test(p.operator)))
/** les mentions de `ajax` sous µ dans un code compilé : `appel`, µ.ajax appelé lui-même ; `valeur`, la première prise comme valeur
 *  (sa forme, pour le message), null sans elle */
export function mentionsAjax(js: string): { appel: boolean, valeur: string | null } {
  const r = { appel: false, valeur: null as string | null }
  if (!/ajax/.test(js) || !/µ/.test(js)) return r
  let ast: any
  try {
    ast = acorn.parse(js.replace(/(\b(?:from|import)\s+)(?:µ|mjs)\.?asset\((['"`])[^'"`]*\2\)/g, "$1''"), { ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true, allowImportExportEverywhere: true, allowHashBang: true })
  }
  catch {
    return r
  }
  const poser = (forme: string): void => { if (r.valeur === null) r.valeur = forme }
  const visiter = (n: any, p: any): void => {
    if (n.type === 'MemberExpression' && muNoeud(n.object) && nomDeCle(n.property, n.computed) === 'ajax') {
      if (n.computed) poser("µ['ajax']")
      else if (p?.type === 'CallExpression' && p.callee === n) r.appel = true
      else if (p?.type === 'MemberExpression' && p.object === n) {
        const m = nomDeCle(p.property, p.computed)
        if (m !== null && AJAX_PAR_FONCTION.has(m)) poser('µajax.' + m)
      }
      else if (!(p?.type === 'UnaryExpression' && p.operator === 'typeof') && !gardeAjax(n, p)) poser(p?.type === 'CallExpression' ? 'µajax passé en argument' : 'µajax')
    }
    if (n.type === 'ObjectPattern' && p && n.properties.some((x: any) => x.type === 'Property' && nomDeCle(x.key, x.computed) === 'ajax') && ((p.type === 'VariableDeclarator' && p.id === n && muNoeud(p.init)) || ((p.type === 'AssignmentExpression' || p.type === 'AssignmentPattern') && p.left === n && muNoeud(p.right)))) poser('{ ajax } = µ')
    for (const k of Object.keys(n)) {
      const v = n[k]
      if (Array.isArray(v)) { for (const x of v) if (x && typeof x.type === 'string') visiter(x, n) }
      else if (v && typeof v === 'object' && typeof v.type === 'string') visiter(v, n)
    }
  }
  visiter(ast, null)
  return r
}

// la marque de la valeur écrite d'un `type:` réécrit (cf. compileAjaxTypes, ajaxOptionsSurLArbre)
const MARQUE_TAJAX = '§'
const appelDe = (n: any, nom: string): boolean => n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && !n.callee.computed && n.callee.property.type === 'Identifier' && n.callee.property.name === nom && muNoeud(n.callee.object)
/** la forme appelable lue sur l'arbre du code compilé : ses options telles que le langage les a rangées (objets implicites de
 *  CoffeeScript et de Civet, raccourcis, clés entre guillemets). Une clé qu'elle ne lit pas arrête le build — un ancien nom avec le bon
 *  nom, une autre avec la liste ; un `type:` réécrit que le langage a rangé ailleurs qu'au premier niveau des options (`data: kind:
 *  'a', type: Reward`) redevient la donnée écrite (une règle en `[]`, qui n'est pas une donnée, arrête le build) ; la valeur écrite
 *  qu'emporte chaque réécriture est effacée. Chaque retouche garde la longueur du texte : les positions de la carte restent justes.
 *  `enTexte` reçoit la position de chaque `_mjs_ajax` écrit dans une chaîne, une regex ou le texte d'un gabarit (cf.
 *  placesDesAjaxEnTexte), lu sur ce même arbre */
export function ajaxOptionsSurLArbre(js: string, enTexte?: number[]): string {
  if (!/_mjs_t?ajax|µ\s*\.\s*ajax/.test(js)) return js
  let ast: any
  try {
    ast = acorn.parse(js.replace(/(\b(?:from|import)\s+)(?:µ|mjs)\.?asset\((['"`])[^'"`]*\2\)/g, (m: string, a: string) => a + "''" + ' '.repeat(m.length - a.length - 2)), { ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true, allowImportExportEverywhere: true, allowHashBang: true })
  }
  catch {
    return js
  }
  const places = new Set<any>()
  const tajax: any[] = []
  const visiter = (n: any): void => {
    if (enTexte && (n.type === 'Literal' || n.type === 'TemplateElement') && (n.type === 'Literal' ? n.raw : n.value.raw)?.includes('_mjs_ajax')) {
      for (let i = js.indexOf('_mjs_ajax', n.start); i >= 0 && i < n.end; i = js.indexOf('_mjs_ajax', i + 9)) if (!/[\w$]/.test((js[i - 1] ?? '') + (js[i + 9] ?? ''))) enTexte.push(i)
    }
    if (appelDe(n, '_mjs_tajax')) tajax.push(n)
    if ((appelDe(n, '_mjs_ajax') || appelDe(n, 'ajax')) && n.arguments[1]?.type === 'ObjectExpression') {
      for (const q of n.arguments[1].properties) {
        if (q.type !== 'Property' || q.computed) continue
        const cle = q.key.type === 'Identifier' ? q.key.name : typeof q.key.value === 'string' ? q.key.value : null
        if (cle === null) continue
        if (!AJAX_OPTION_KEYS.includes(cle)) throw new Error(t(/^(?:on)?(?:type)?error$/i.test(cle) ? 'types.ajax-ancien-nom' : 'types.ajax-cle-inconnue', { cle, cles: AJAX_OPTION_KEYS.join(', ') }))
        if (cle === 'type' && appelDe(q.value, '_mjs_tajax')) places.add(q.value)
      }
    }
    for (const k of Object.keys(n)) {
      const v = n[k]
      if (Array.isArray(v)) { for (const x of v) if (x && typeof x.type === 'string') visiter(x) }
      else if (v && typeof v === 'object' && typeof v.type === 'string') visiter(v)
    }
  }
  visiter(ast)
  let out = js
  for (const n of tajax) {
    const marque = n.arguments[2]
    if (!marque || marque.type !== 'Literal' || typeof marque.value !== 'string' || !marque.value.startsWith(MARQUE_TAJAX)) continue
    const ecrit = marque.value.slice(MARQUE_TAJAX.length)
    let a: number, texte: string
    if (places.has(n)) {
      // au premier niveau des options : la règle reste, la valeur écrite (et le composant absent d'un module) s'efface
      a     = n.arguments[1].type === 'Literal' && typeof n.arguments[1].value === 'string' ? n.arguments[1].end : n.arguments[0].end
      texte = ' '.repeat(marque.end - a)
    }
    else {
      if (!/^[A-Za-z_$][\w$]*$/.test(ecrit)) throw new Error(t('types.ajax-type-imbrique', { type: ecrit }))
      a     = n.start
      texte = ecrit + ' '.repeat(n.end - n.start - ecrit.length)
      out   = out.slice(0, a) + texte + out.slice(n.end)
      continue
    }
    out = out.slice(0, a) + texte + out.slice(marque.end)
  }
  return out
}

/** le build s'arrête sur le premier `type: Nom` d'un verbe (cf. compileAjaxTypes) dont une lecture, sur le code compilé du fichier,
 *  n'est liée par aucune portée qui l'englobe (cf. lecturesLibres) : une liaison faite dans une autre fonction, dans un rappel ou dans
 *  la boucle d'une autre fonction ne compte pas, un nom seulement écrit (`console.log Reward`) non plus ; le message dit la forme
 *  appelable, et où lier le nom pour garder une donnée */
export function checkAjaxVerbNames(js: string, aLier: AjaxVerbName[]): void {
  // µajax pris comme valeur arrête le build, le message montre l'appel direct à écrire (cf. mentionsAjax)
  const valeur = mentionsAjax(js).valeur
  if (valeur !== null) throw new Error(t('types.ajax-valeur', { forme: valeur }))
  if (aLier.length === 0) return
  // un composant pas encore résolu importe ses fichiers par `µ.asset('…')` : un chemin vide en tient lieu, pour la lecture seule
  const ast    = acorn.parse(js.replace(/(\b(?:from|import)\s+)(?:µ|mjs)\.?asset\((['"`])[^'"`]*\2\)/g, "$1''"), { ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true, allowImportExportEverywhere: true, allowHashBang: true })
  // une lecture dans la valeur d'une clé `type:` (`type: Reward`, `type: [Reward]`, `type: Reward.id`)
  const libres = new Set(lecturesLibres(ast, new Set(aLier.map(a => a.nom))).filter(l => l.ancetres.some((p, i) => p.type === 'Property' && !p.computed && (p.key.name ?? p.key.value) === 'type' && (l.ancetres[i + 1] ?? l.noeud) === p.value)).map(l => l.nom))
  const libre  = aLier.find(a => libres.has(a.nom))
  if (libre) throw new Error(t('types.ajax-verbe-nom', { bloc: libre.bloc, ligne: libre.ligne, type: libre.nom, verbe: libre.verbe, ecrit: libre.ecrit ?? libre.nom }))
}

// la valeur de départ d'un champ dans le texte trié d'une règle (cf. compileVars, comparaison des règles d'un magasin), entre deux
// marques qu'aucun texte de règle n'écrit ; storeRuleShown la dit en mots
const DEPART_A = String.fromCharCode(1)
const DEPART_B = String.fromCharCode(2)

/** le texte trié d'une règle de magasin tel qu'un message le montre : chaque valeur de départ dite en mots, après son champ */
export function storeRuleShown(text: string): string {
  return text.replace(new RegExp(`${DEPART_A}([^${DEPART_B}]*)${DEPART_B}`, 'g'), (_, valeur: string) => ` (${t('types.valeur-depart', { valeur })})`)
}

// `µajax` appelé lui-même : suivi d'une parenthèse, ou d'un espace puis de ce qui commence une valeur (pas d'un mot d'opérateur)
const AJAX_CALLABLE_RE = /(?<![\w$.])µ\.?ajax(?=\s*\(|[ \t]+(?!(?:and|or|is|isnt|not|in|of|instanceof|then|else|if|unless|when|for|while|until|by)\b)['"`\w$@[{])/g

/** le code d'un <script> où la forme appelable de µajax (`µajax '/app/rewards', type: Reward[]`, `µajax(url, options)`) appelle
 *  µ._mjs_ajax : un GET, ou la méthode de ses options, dont la promesse rend le corps (mjs_ajax.ts, bloc gardé pour la seule appli qui
 *  l'écrit). `µajax.get` et les autres verbes, `µajax` nommé sans être appelé, un texte ou un commentaire ne bougent pas ;
 *  `reecrits` reçoit ce texte et la position de chaque réécriture, s'il y en a (`premiere` : la ligne du fichier de sa première
 *  ligne, cf. placesDesAjaxEnTexte) */
export function compileAjaxCall(code: string, reecrits?: ReecritAjax[], premiere = 1): string {
  if (!/µ\.?ajax/.test(code)) return code
  const masked = maskInertSameLength(code)
  let fait: ReecritAjax | null = null
  return code.replace(AJAX_CALLABLE_RE, (m: string, at: number) => {
    if (masked.slice(at, at + m.length) !== m) return m
    if (reecrits) (fait ??= reecrits[reecrits.push({ code, reecritures: [], premiere }) - 1]).reecritures.push(at)
    return 'µ._mjs_ajax'
  })
}

/** un texte réécrit par compileAjaxCall : `code`, le texte avant réécriture ; `reecritures`, la position de chacune ; `premiere`, la
 *  ligne du fichier de sa première ligne */
export interface ReecritAjax { code: string, reecritures: number[], premiere: number }

/** un `µajax` que compileAjaxCall a réécrit dans un texte que le masque fait main ne voit pas — regex étendue `///…///` sur
 *  plusieurs lignes, chaîne écrite dans une interpolation `#{…}`, chaîne sur plusieurs lignes — et que le langage range dans une
 *  chaîne, une regex ou le texte d'un gabarit (`enTexte`, cf. ajaxOptionsSurLArbre) : sa place `fichier:ligne:colonne`. Le rang
 *  de son `_mjs_ajax` parmi ceux du code compilé `js` est celui de sa réécriture quand `js` en compte autant que les textes de
 *  `blocs` et que la carte (`ligneDe`) ne le dément pas — un appel à la ligne de sa réécriture, un texte commencé au plus tard à
 *  la sienne : rangés dans l'ordre où `js` les écrit, sinon dans celui des lignes que la carte en donne (CoffeeScript écrit une
 *  propriété de classe après les méthodes) ; la colonne est celle du même `µajax` (même rang sur sa ligne) dans la ligne écrite,
 *  `ecrites` (le texte lu a pu perdre un retrait commun). Sinon, la ligne où la carte situe le texte, ou le fichier seul — rien
 *  quand cette ligne écrit elle-même `_mjs_ajax` : le texte de l'auteur, pas une réécriture */
export function placesDesAjaxEnTexte(js: string, enTexte: number[], blocs: ReecritAjax[], fichier: string, ecrites: () => string[], ligneDe: (offset: number) => number | null): string[] {
  const tous   = [...js.matchAll(/(?<![\w$])_mjs_ajax(?![\w$])/g)].map(m => m.index)
  const faits  = blocs.flatMap(b => b.reecritures.map(at => ({ b, at, ligne: b.premiere + (b.code.slice(0, at).match(/\n/g)?.length ?? 0) })))
  const textes = new Set(enTexte)
  const lues   = new Map<number, number | null>()
  const lue    = (p: number): number | null => {
    if (!lues.has(p)) lues.set(p, ligneDe(p))
    return lues.get(p)!
  }
  const juste  = (ordre: number[]): boolean => ordre.every((p, k) => {
    const ligne = lue(p)
    return ligne === null || (textes.has(p) ? ligne <= faits[k].ligne : ligne === faits[k].ligne)
  })
  let ordre = tous.length === faits.length ? tous : null
  if (ordre && !juste(ordre)) {
    ordre = [...tous].sort((a, c) => (lue(a) ?? 0) - (lue(c) ?? 0))
    if (!juste(ordre)) ordre = null
  }
  return enTexte.flatMap(p => {
    if (ordre === null) {
      const ligne = lue(p)
      if (ligne !== null && /(?<![\w$])_mjs_ajax(?![\w$])/.test(ecrites()[ligne - 1] ?? '')) return []
      return [ligne === null ? fichier : `${fichier}:${ligne}`]
    }
    const { b, at, ligne } = faits[ordre.indexOf(p)]
    const avant            = b.code.slice(0, at)
    const debut            = avant.lastIndexOf('\n') + 1
    const rang             = (b.code.slice(debut, at).match(/µ\.?ajax/g) ?? []).length
    const ecrite           = [...(ecrites()[ligne - 1] ?? '').matchAll(/µ\.?ajax/g)][rang]
    return [`${fichier}:${ligne}:${(ecrite ? ecrite.index : at - debut) + 1}`]
  })
}
