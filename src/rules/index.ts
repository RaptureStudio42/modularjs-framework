// rules — les règles du bloc <vars> hors du navigateur (serveur, `.server.mjs`, script Node) : une règle écrite comme dans <vars>
// devient un schéma standard (Standard Schema v1, `~standard`, `vendor: 'mjs'`), contrôlé par le même code que chaque écriture
// d'une variable (src/runtime/mjs_types.ts) et décrit par les mêmes messages (src/runtime/mjs_rules.ts) : les deux fichiers du
// navigateur, chargés une fois dans un `µ` à part, sans DOM ni réseau. Un formulaire reçu se contrôle donc au serveur par des règles
// écrites comme celles de ses champs, avec les mêmes messages ; le serveur ne lit pas les composants : ces règles s'écrivent ici.
//
//   rule('int 18..120')                                   un schéma
//   rules({ age: 'int 18..120', nick: 'Nick' }, opts)     un schéma par nom, et `~standard` : celui de l'objet qui les réunit
//   opts.types : les règles nommées citées ({ Nick: "string 3..20 ! 'admin'" }, comme un bloc <types>) ; un objet, en retrait, un
//                champ par ligne ({ User: 'name  string\nage = 18  int 0..' }) — un texte d'une ligne est une règle : un objet
//                d'un seul champ commence par une fin de ligne ({ Cart: '\nquantity  int 1..99' })
//   opts.lang  : la langue des messages ('fr' par défaut, 'en' ; une autre : l'anglais)
// `validate` reçoit une valeur, ou un formulaire (FormData, URLSearchParams) qu'il lit le long des règles : plusieurs valeurs d'un
// champ de liste en liste (`tags` ou `tags[]`), case cochée en booléen, champ vide d'une règle qui accepte null en null, `adr.city`
// dans l'objet `adr` ; une liste d'objets ou de listes, qu'un formulaire ne peut pas porter, y est refusée par un message qui le dit.

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { parseRule, parseTypesBlock, resolveRule, emitRuntimeRule, type RuleAst } from '../transpiler/var-types.js'

/** un refus : son message et le chemin de la valeur refusée dans celle qu'on a contrôlée (`['tags', 2]`) */
export interface RuleIssue {
  readonly message: string
  readonly path: ReadonlyArray<PropertyKey>
}

export type RuleResult<T = unknown> = { readonly value: T, readonly issues?: undefined } | { readonly issues: ReadonlyArray<RuleIssue> }

/** l'interface Standard Schema v1 (https://standardschema.dev) */
export interface RuleSchema<T = unknown> {
  readonly '~standard': {
    readonly version: 1
    readonly vendor: 'mjs'
    /** une valeur ; pour l'objet qui réunit les règles, un formulaire aussi (FormData, URLSearchParams) */
    readonly validate: (value: unknown) => RuleResult<T>
  }
}

export type RuleSet = { readonly [name: string]: RuleSchema } & RuleSchema<Record<string, unknown>>

export interface RulesOptions {
  /** règles nommées citées par les règles, comme dans un bloc <types> */
  types?: Record<string, string>
  /** langue des messages : 'fr' (défaut), 'en' ; une autre : l'anglais */
  lang?: string
}

// le dossier des fichiers du navigateur : src/rules/ → src/runtime/ (développement), dist/ → src/runtime/ (paquet)
function runtimeDir(): string {
  const candidates = [fileURLToPath(new URL('../runtime/', import.meta.url)), fileURLToPath(new URL('../src/runtime/', import.meta.url))]
  return candidates.find(c => existsSync(join(c, 'mjs_rules.ts'))) ?? candidates[0]
}

// les langues dont mjs_rules.ts a les messages
const LANGS = ['fr', 'en']

// un `µ` par langue de LANGS (deux au plus : une langue demandée hors de LANGS prend l'anglais, jamais une entrée de plus), réduit à ce
// que lisent les deux fichiers : aucune donnée réactive, aucun store, aucun message de développement
const MUS = new Map<string, any>()

function muFor(lang: string): any {
  let µ = MUS.get(lang)
  if (µ) return µ
  µ = { _mjs_toRaw: (v: unknown) => v, _mjs_interpolatorSet: new WeakSet(), _mjs_storeRaw: {}, _mjs_labelLang: () => lang, _runtimeLabelsLang: 'en' }
  const dir = runtimeDir()
  for (const file of ['mjs_types.ts', 'mjs_rules.ts']) new Function('µ', readFileSync(join(dir, file), 'utf-8'))(µ)
  MUS.set(lang, µ)
  return µ
}

// la règle compilée comme le fait le build (forme courte que lit mjs_types.ts), ses règles nommées remplacées
function compiled(text: string, name: string, opts: RulesOptions): unknown {
  const defs: Record<string, RuleAst> = {}
  for (const [k, v] of Object.entries(opts.types ?? {})) defs[k] = typeRule(k, v)
  const where = { block: name, line: 1 }
  return new Function(`return ${emitRuntimeRule(resolveRule(parseRule(text, where), defs, where), false)}`)()
}

// une règle nommée de `opts.types` : sur une ligne, ou un objet en retrait, un champ par ligne, lu comme dans un bloc <types>
function typeRule(name: string, text: string): RuleAst {
  if (!text.includes('\n')) return parseRule(text, { block: '<types>', line: 1, name })
  return parseTypesBlock(`${name}\n${text.split('\n').map(l => '  ' + l).join('\n')}`, 0)[0].rule
}

// 'fr-CA' → 'fr' ; une langue hors de LANGS → 'en'
function langOf(opts: RulesOptions): string {
  const lang = String(opts.lang ?? 'fr').toLowerCase().split('-')[0]
  return LANGS.includes(lang) ? lang : 'en'
}

/** une règle écrite comme dans <vars> (`'int 18..120'`, `"string 3..20 ! 'admin'"`), en schéma standard */
export function rule(text: string, opts: RulesOptions = {}): RuleSchema {
  return muFor(langOf(opts)).rules({ _mjs_types: { v: compiled(text, 'rule()', opts) } }).v
}

/** plusieurs règles nommées : un schéma par nom, et `~standard`, celui de l'objet qui les réunit (chaque nom y est obligatoire) */
export function rules(texts: Record<string, string>, opts: RulesOptions = {}): RuleSet {
  const table: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(texts)) table[k] = compiled(v, 'rules()', opts)
  return muFor(langOf(opts)).rules({ _mjs_types: table })
}
