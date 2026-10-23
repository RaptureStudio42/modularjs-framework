// bundler/fx-sections — un fichier d'effet porte, en plus de ce qui sert à son défaut, des SECTIONS MARQUÉES que le build n'embarque
// que si une page de l'appli écrit ce qui les demande : un réglage, un réglage et sa valeur, ou l'effet lui-même. Ce qui sert au défaut
// d'un effet (ce qu'il fait sans réglage) n'est dans aucune section : il part toujours. Tel quel, le fichier porte tout et marche seul
// (tests, éditeur) ; ici il est filtré, et les marques ne sortent jamais. Un fichier sans marque passe tel quel.
// Le tri n'est que pour le poids de la PRODUCTION. Le build de développement envoie chaque fichier d'effet en entier (Bundler.effectSource
// passe `forced` : seules les marques sont ôtées) : le panneau d'inspection allume n'importe quel réglage d'un effet posé, écrit ou non.
//
// Les marques : une ligne `// @@ <étiquette>` jusqu'à la ligne `// @@` suivante (les sections s'emboîtent : la section de dedans
// n'est gardée que si celle de dehors l'est), ou `// @@ <étiquette>` en fin de ligne pour cette ligne seule.
// Une étiquette est une suite de jetons séparés par des espaces ; la section est gardée dès qu'UN jeton est demandé :
//   réglage             le réglage est écrit, avec n'importe quelle valeur             `on`, `range`
//   réglage=a,b         le réglage est écrit avec l'une de ces valeurs                 `on=hover`, `once=false`
//   réglage=*           ... avec une valeur que ce fichier nomme ailleurs derrière ce même réglage (`style=*` : un style de
//                       carte écrit, pas un style simple que le fichier ne nomme nulle part)
//   effet.réglage       comme les trois précédents, sur cet effet seulement            `iris.start`, `iris.origin=pointer`
//   *effet              l'effet est écrit, avec ou sans réglage                        `*pixelate`, `*typewriter`
//   dev                 la section du développement (l'avertissement de l'effet) : `dev` n'est le réglage d'aucun effet, aucune page ne la demande ;
//                       seul le fichier entier la porte (développement, demande explicite du fichier, effet choisi par une variable)  `dev`
//   effet.dev           la même, dans un fichier dont le client lit un mot seul autrement (un mot seul y est un style de carte)        `hologram.dev`
// Un réglage s'entend « écrit » par une page : `*fade(on: hover)`, `*fade(on: $survol)` (valeur que le build ne sait pas lire :
// toutes les valeurs sont demandées), `@in=*fade(…)`, `*delta(fx: *fade(…))`, un effet réglé une fois dans un `*.effects.mjs`
// (compilé en pose de l'effet qu'il règle). Le réglage par défaut d'un effet n'est pas « écrit » : ce que fait un effet quand on
// n'écrit rien reste hors section, ou la section nomme l'effet (`*typewriter`) quand ce défaut ne sert qu'à lui.
//
// Les signaux viennent des poses compilées (features.ts : `<effet>_<réglage>:<valeur>`, `use:<effet>`). Tout est gardé quand le
// build ne sait pas lire : un effet choisi par une variable (`*delta(fx: $effet)`), une demande explicite (`runtime: ['fx_nom']`),
// une valeur de réglage qui vient d'une variable (pour ce réglage), une mention de l'effet qui n'est pas une pose reconnue.
//
// Un fichier dont les mots d'étiquette ont leur vocabulaire (`*hologram` : des styles de carte) passe par un client (FxClient).

import { EFFECTS } from '../effects/catalog.js'
import { FX_NAMED, FX_ANY, fxUseSignal } from './features.js'
import { t } from '../messages/index.js'

/** un fichier dont les étiquettes ont leur vocabulaire et sa passe de finition (cf. hologram-styles.ts) */
export type FxClient = {
  /** un mot d'étiquette → les jetons génériques qu'il dit ; sans cette fonction, un mot est un jeton */
  word?: (word: string) => string[]
  /** le texte filtré, repris une dernière fois ; `known` : les valeurs que le fichier nomme, par réglage */
  finish?: (text: string, ctx: { demand: FxDemand, known: ReadonlyMap<string, ReadonlySet<string>> }) => string
}

/** ce que les pages écrivent des effets qu'un fichier porte */
export type FxDemand = {
  /** tout est demandé : demande explicite, effet choisi par une variable */
  all: boolean
  /** les effets du fichier (`transition` : toutes les transitions) */
  effects: string[]
  /** les effets du fichier que les pages écrivent */
  used: Set<string>
  /** réglage → valeurs écrites, sur l'un des effets du fichier (`*` : une valeur que le build ne sait pas lire) */
  values: Map<string, Set<string>>
  /** `effet.réglage` → valeurs écrites */
  byEffect: Map<string, Set<string>>
}

type Token = { effect?: string, setting?: string, values?: string[], star?: boolean }
type Line = { text: string, kind: 'plain' | 'open' | 'close' | 'trail', tokens: Token[] }

const LABEL         = '[A-Za-z0-9 ._=,*-]+'
const REGEX_BLOCK   = new RegExp('^\\s*// @@(?: (' + LABEL + '))?\\s*$')
const REGEX_TRAIL   = new RegExp('^(.*\\S)\\s+// @@ (' + LABEL + ')$')
const REGEX_TOKEN   = /^(?:\*([a-z][a-z0-9-]*)|(?:([a-z][a-z0-9-]*)\.)?([a-z][a-zA-Z0-9]*)(?:=(\*|[A-Za-z0-9.-]+(?:,[A-Za-z0-9.-]+)*))?)$/

/** les effets qu'un fichier runtime porte : le sien, ou toutes les transitions pour `mjs_fx_transition.ts` */
export function fxEffectsOf(file: string): string[] {
  const key = file.replace(/^mjs_|\.ts$/g, '')
  return Object.keys(EFFECTS).filter((n) => (EFFECTS[n].transition ? 'fx_transition' : 'fx_' + n.replace(/-/g, '_')) === key)
}

const add = (map: Map<string, Set<string>>, key: string, value: string) => {
  const set = map.get(key)
  if (set) set.add(value)
  else map.set(key, new Set([value]))
}

/** ce que les signaux du build disent des effets d'un fichier ; `forced` : le projet demande le fichier au cœur (`runtime: ['fx_nom']`) */
export function fxDemand(file: string, used: ReadonlySet<string>, forced: boolean): FxDemand {
  const effects = fxEffectsOf(file)
  const demand: FxDemand = { all: forced || used.has(FX_NAMED), effects, used: new Set(), values: new Map(), byEffect: new Map() }
  for (const e of effects) {
    if (used.has(fxUseSignal(e))) demand.used.add(e)
    const prefix = e + '_'
    for (const s of used) {
      const colon = s.indexOf(':')
      if (colon < 0 || !s.startsWith(prefix)) continue
      const setting = s.slice(prefix.length, colon)
      const value   = s.slice(colon + 1)
      add(demand.values, setting, value)
      add(demand.byEffect, e + '.' + setting, value)
    }
  }
  return demand
}

/** les valeurs d'un réglage que les pages écrivent : un ensemble de mots, ou `'all'` (une valeur illisible, ou tout demandé) */
export function fxWrittenValues(demand: FxDemand, setting: string): ReadonlySet<string> | 'all' {
  const values = demand.values.get(setting)
  return demand.all || values?.has(FX_ANY) ? 'all' : values ?? new Set()
}

function token(word: string, file: string): Token {
  const m = REGEX_TOKEN.exec(word)
  if (!m) throw new Error(t('bundler.fx-sections.etiquette-illisible', { fichier: file, jeton: word }))
  if (m[1]) return { effect: m[1], star: true }
  return { effect: m[2], setting: m[3], values: m[4] ? m[4].split(',') : undefined }
}

function parse(src: string, file: string, client?: FxClient): Line[] {
  const tokens = (label: string) => label.split(' ').flatMap((w) => client?.word ? client.word(w) : [w]).map((w) => token(w, file))
  return src.split('\n').map((text): Line => {
    const b = REGEX_BLOCK.exec(text)
    if (b) return b[1] ? { text, kind: 'open', tokens: tokens(b[1]) } : { text, kind: 'close', tokens: [] }
    const l = REGEX_TRAIL.exec(text)
    if (l) return { text: l[1], kind: 'trail', tokens: tokens(l[2]) }
    return { text, kind: 'plain', tokens: [] }
  })
}

function holds(tok: Token, demand: FxDemand, known: ReadonlyMap<string, ReadonlySet<string>>): boolean {
  if (demand.all) return true
  if (tok.star) return demand.used.has(tok.effect!)
  const written = tok.effect ? demand.byEffect.get(tok.effect + '.' + tok.setting) : demand.values.get(tok.setting!)
  if (!written) return false
  if (!tok.values || written.has(FX_ANY)) return true
  if (tok.values[0] === FX_ANY) return [...written].some((v) => known.get(tok.setting!)?.has(v))
  return tok.values.some((v) => written.has(v))
}

/**
 * Le fichier de l'effet réduit aux sections que les pages demandent ; les marques des sections ne sortent jamais. Un fichier sans
 * marque passe tel quel. Une marque mal fermée, ou une étiquette illisible, est une erreur de build : jamais une section manquante
 * ou retenue en silence. `file` : le nom du fichier runtime (`mjs_fx_<nom>.ts`), `used` : les signaux de toutes les pages, `forced` : tout est
 * gardé (demande explicite `runtime: ['fx_nom']`, ou build de développement).
 */
export function selectFxSections(file: string, src: string, used: ReadonlySet<string>, forced: boolean, client?: FxClient): string {
  if (!src.includes('// @@')) return src
  const lines  = parse(src, file, client)
  const demand = fxDemand(file, used, forced)
  // les valeurs que le fichier nomme, par réglage (pour `réglage=*`)
  const known = new Map<string, Set<string>>()
  for (const l of lines) for (const k of l.tokens) for (const v of k.values ?? []) if (v !== FX_ANY) add(known, k.setting!, v)
  const ok  = (tokens: Token[]) => tokens.some((k) => holds(k, demand, known))
  const out: string[] = []
  const pile: boolean[] = [true]
  for (const l of lines) {
    const inside = pile[pile.length - 1]
    if (l.kind === 'open') pile.push(inside && ok(l.tokens))
    else if (l.kind === 'close') {
      if (pile.length === 1) throw new Error(t('bundler.fx-sections.section-sans-ouverture', { fichier: file }))
      pile.pop()
    }
    else if (inside && (l.kind === 'plain' || ok(l.tokens))) out.push(l.text)
  }
  if (pile.length !== 1) throw new Error(t('bundler.fx-sections.section-non-fermee', { fichier: file }))
  const text = out.join('\n')
  return client?.finish ? client.finish(text, { demand, known }) : text
}
