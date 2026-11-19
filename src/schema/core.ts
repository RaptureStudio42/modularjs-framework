// schema/core — « µschema » : registre de schémas binaires PUR, ZÉRO API node/navigateur (bundlé
// tel quel côté serveur ET côté client) — defineSchema/encode/decode + hash stable
// du registre + (dé)sérialisation JSON des définitions pour le voyage en trame µ:schema. Consommé
// par src/mjs-ws/schema.ts (intégration serveur), jamais l'inverse : ce fichier ne connaît NI
// MjsWsClient NI le protocole µ:, juste des octets.
//
// Enveloppe fil (cf. src/mjs-ws/transport.ts) : [u8 idSchéma][charge] — l'id est
// attribué à CHAQUE schéma dans l'ORDRE de déclaration (0, 1, 2…), jamais choisi à la main : deux
// process qui déclarent leurs schémas dans le MÊME ordre obtiennent les MÊMES ids (condition du
// hash stable ci-dessous). DataView partout, little-endian, offsets calculés en DEUX passes
// (mesure puis écriture) — jamais de réallocation de buffer en cours de route.
//
// Types de champ : 8 numériques (u8/i8/u16/i16/u32/i32/f32/f64), bool (1 octet, 0/1), str8/str16
// (préfixe de longueur EN OCTETS UTF-8, pas en caractères — u8 ou u16 — puis les octets), list(of)
// (compteur u16 puis `of` répété — v1 : `of` scalaire ou str UNIQUEMENT, jamais list(list(...)) ni
// un sous-schéma imbriqué, cf. validateType), bits([names]) (jusqu'à 8 booléens tassés dans 1 octet,
// bit i = names[i] — la valeur du champ est un SOUS-OBJET { nom: bool, ... }, cf. lireChamp).
//
// UTF-8 : TextEncoder/TextDecoder globaux (DÉCISION) plutôt qu'un
// codec maison : disponibles SANS import ni polyfill dans tout navigateur évergreen ET Node ≥ 11
// (ce n'est ni une API node ni une API DOM, juste un standard WHATWG des deux côtés) — un codec
// maison n'aurait fait gagner qu'une compatibilité IE11 hors de portée de ce framework (cible
// ES2022/Node18, cf. tsconfig.json/package.json). Si un jour un des deux côtés en manque, tranchée
// ici en UN seul endroit (utf8Encoder/utf8Decoder ci-dessous).
//
// Garde d'évolution AJOUT-SEUL : un schéma déjà déclaré est IMMUABLE (même champs, même ordre) —
// re-déclarer le MÊME nom avec une forme DIFFÉRENTE (champ ajouté/retiré/retypé/réordonné) lève
// clair (cf. defineSchema) ; re-déclarer à l'IDENTIQUE est un no-op silencieux (idempotent — un
// fichier serveur rechargé à chaud, cf. cli/ws.ts, ré-exécute son `app.schema(...)` sans planter).
// La définition retenue (`fields`) est une COPIE gelée de l'objet fourni à defineSchema, prise au
// moment de la déclaration (cf. clonerChamps) — muter l'objet appelant APRÈS coup ne change plus
// jamais le format encodé ni le hash. Un nom de champ qui ne survit pas à un objet ordinaire
// (ex. '__proto__') est refusé À LA DÉCLARATION (cf. validateFieldName), des deux côtés (ici et
// src/runtime/mjs_schema.ts) — accepté puis perdu au rechargement, il décalait silencieusement le
// décodage de tous les champs suivants.

import { t } from '../messages/index.js'

export type MjschemaScalar = 'u8' | 'i8' | 'u16' | 'i16' | 'u32' | 'i32' | 'f32' | 'f64' | 'bool' | 'str8' | 'str16'

export interface MjschemaListType { kind: 'list'; of: MjschemaScalar }
export interface MjschemaBitsType { kind: 'bits'; names: string[] }
export type MjschemaFieldType = MjschemaScalar | MjschemaListType | MjschemaBitsType
/** objet ORDONNÉ { fieldName: type, ... } — l'ordre des clés (Object.keys) EST l'ordre fil, cf. tête de fichier */
export type MjschemaFields = Record<string, MjschemaFieldType>

/** tableau homogène à compteur u16 — v1 : `of` scalaire/str SEULEMENT (pas list(list(...)), pas de sous-schéma, cf. validateType) */
export function list(of: MjschemaScalar): MjschemaListType { return { kind: 'list', of } }
/** jusqu'à 8 booléens tassés dans 1 octet (u8) — décodés en sous-objet { nom: bool, ... }, cf. lireChamp */
export function bits(names: string[]): MjschemaBitsType { return { kind: 'bits', names } }

export interface MjschemaDef {
  /** id u8 — attribué à la déclaration, dans l'ORDRE d'arrivée (0, 1, 2…), JAMAIS choisi à la main */
  readonly id: number
  readonly name: string
  readonly fields: MjschemaFields
  /** Object.keys(fields) figé AU MOMENT de la déclaration — c'est CET ordre qui fait foi sur le fil, jamais recalculé */
  readonly order: string[]
}

export interface MjschemaRegistry {
  readonly byName: Map<string, MjschemaDef>
  /** index = id — accès direct au décodage (cf. decode), jamais une recherche linéaire */
  readonly byId: MjschemaDef[]
}

export function createRegistry(): MjschemaRegistry { return { byName: new Map(), byId: [] } }

export function aSchema(registry: MjschemaRegistry, name: string): boolean { return registry.byName.has(name) }

// --- validation à la déclaration — type inconnu (avec suggestion) / forme de list()/bits() -----

const SCALARS: MjschemaScalar[] = ['u8', 'i8', 'u16', 'i16', 'u32', 'i32', 'f32', 'f64', 'bool', 'str8', 'str16']

// distance de Levenshtein — MAISON (pas de dépendance pour une suggestion de 11 candidats au plus,
// jamais appelée sur un chemin chaud : uniquement au boot, quand une déclaration est déjà en tort)
function distanceLevenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
  for (let i = 0; i <= m; i++) d[i][0] = i
  for (let j = 0; j <= n; j++) d[0][j] = j
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = a[i - 1] === b[j - 1] ? d[i - 1][j - 1] : 1 + Math.min(d[i - 1][j - 1], d[i - 1][j], d[i][j - 1])
  return d[m][n]
}

// plus proche type valide à distance ≤ 2, sinon aucune suggestion (mieux vaut se taire qu'une
// suggestion absurde — 'xyz' ne doit rien évoquer)
function suggestType(input: string): string | null {
  let best: string | null = null
  let minDistance = Infinity
  for (const candidate of SCALARS) {
    const d = distanceLevenshtein(input, candidate)
    if (d < minDistance) { minDistance = d; best = candidate }
  }
  return minDistance <= 2 ? best : null
}

function validateType(schemaName: string, fieldName: string, type: MjschemaFieldType): void {
  if (typeof type === 'string') {
    if ((SCALARS as string[]).includes(type)) return
    const suggestion = suggestType(type)
    throw new Error(t('schema.type-unknown', {
      schema: schemaName,
      field: fieldName,
      type,
      hint: suggestion ? t('schema.suggestion-type', { suggestion }) : '',
      valid: SCALARS.join(', '),
    }))
  }
  if (type.kind === 'list') {
    if (!(SCALARS as string[]).includes(type.of)) {
      throw new Error(t('schema.list-type-scalar', { schema: schemaName, field: fieldName, valid: SCALARS.join(', '), typeOf: type.of }))
    }
    return
  }
  if (type.kind === 'bits') {
    if (!Array.isArray(type.names) || type.names.length === 0) throw new Error(t('schema.bits-names-empty', { schema: schemaName, field: fieldName }))
    if (type.names.length > 8) throw new Error(t('schema.bits-too-many-names', { schema: schemaName, field: fieldName, count: type.names.length }))
    if (new Set(type.names).size !== type.names.length) throw new Error(t('schema.bits-names-duplicate', { schema: schemaName, field: fieldName }))
    // un nom de bits() devient une clé de l'objet décodé : même garde qu'un nom de champ (`__proto__` disparaissait)
    for (const n of type.names) validateFieldName(schemaName, n)
    return
  }
  throw new Error(t('schema.type-field-invalid', { schema: schemaName, field: fieldName }))
}

// un nom de champ doit survivre à `{}[nom] = valeur` (objet ORDINAIRE) — sinon loadDefinitions
// (qui reconstruit `champs` avant de rappeler defineSchema, cf. plus bas) le PERD en silence :
// `__proto__` déclenche le setter hérité d'Object.prototype (qui tente de changer le PROTOTYPE de
// l'objet plutôt que d'y créer une propriété) au lieu de survivre comme un nom normal — décalage
// d'offset au décodage, jamais signalé. Sonde générique (pas une liste figée de noms interdits) :
// n'importe quel nom qui échouerait à ce test serait perdu de la même façon.
function validateFieldName(schemaName: string, fieldName: string): void {
  const probe: Record<string, unknown> = {}
  probe[fieldName] = 1
  if (!Object.prototype.hasOwnProperty.call(probe, fieldName)) {
    throw new Error(t('schema.name-field-invalid', { schema: schemaName, field: fieldName }))
  }
}

// --- garde AJOUT-SEUL — forme = noms + types + ORDRE, comparaison stricte ----------------------

function sameType(a: MjschemaFieldType, b: MjschemaFieldType): boolean {
  if (typeof a === 'string' || typeof b === 'string') return a === b
  if (a.kind !== b.kind) return false
  if (a.kind === 'list') return a.of === (b as MjschemaListType).of
  const bn = (b as MjschemaBitsType).names
  return a.names.length === bn.length && a.names.every((n, i) => n === bn[i])
}

function sameShape(a: MjschemaFields, b: MjschemaFields): boolean {
  const ka = Object.keys(a), kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  for (let i = 0; i < ka.length; i++) { if (ka[i] !== kb[i] || !sameType(a[ka[i]], b[kb[i]])) return false }
  return true
}

// bits(names) DOIT lui aussi passer par JSON.stringify (jamais une jointure '+' brute) — MÊME raison
// que le hash des noms de champs ci-dessous : bits(['a+b','c']) (2 sous-champs), bits(['a','b','c'])
// (3 sous-champs) et bits(['a','b+c']) donnaient AUPARAVANT le MÊME texte joint ('a+b+c') malgré des
// découpages/sémantiques différents — collision structurelle, MÊME famille de bug que les noms de
// champs (cf. hashRegistry).
function describeType(t: MjschemaFieldType): string {
  if (typeof t === 'string') return t
  return t.kind === 'list' ? `list(${t.of})` : `bits(${JSON.stringify(t.names)})`
}

function describeFields(fields: MjschemaFields): string {
  return '{ ' + Object.keys(fields).map(c => c + ': ' + describeType(fields[c])).join(', ') + ' }'
}

// copie PROFONDE + gel — `champs` (et les objets list()/bits() qu'il contient) est fourni par
// l'appelant, qui peut le muter APRÈS coup (objet littéral réutilisé, partagé, relu ailleurs) : sans
// clone, defineSchema stockait la RÉFÉRENCE telle quelle, une mutation externe changeait le format
// encodé/le hash EN SILENCE, sans jamais repasser par la garde ajout-seul ci-dessus. Base
// `Object.create(null)` (pas `{}`) : une clé nommée '__proto__' doit survivre TELLE QUELLE jusqu'à
// validateFieldName (qui la refusera avec une erreur claire) — un objet littéral normal la perdrait
// en silence PENDANT le clonage lui-même, avant même d'atteindre la garde.
function cloneType(type: MjschemaFieldType): MjschemaFieldType {
  if (typeof type === 'string') return type
  if (type.kind === 'list') return Object.freeze({ kind: 'list' as const, of: type.of })
  const names = Object.freeze([...type.names]) as string[]
  return Object.freeze({ kind: 'bits' as const, names })
}

function cloneFields(fields: MjschemaFields): MjschemaFields {
  const copy: MjschemaFields = Object.create(null)
  for (const c of Object.keys(fields)) copy[c] = cloneType(fields[c])
  return Object.freeze(copy)
}

/**
 * Déclare (ou ré-affirme à l'identique) un schéma nommé — champs ORDONNÉ, cf. tête de fichier.
 * Ré-affirmation IDENTIQUE (même champs, même types, même ordre) = no-op silencieux, id inchangé
 * (idempotent — un entry rechargé à chaud ré-exécute ses `app.schema(...)` sans planter, cf.
 * cli/ws.ts). Ré-affirmation DIFFÉRENTE = throw clair (garde AJOUT-SEUL, cf. tête de fichier) :
 * fais évoluer le protocole en déclarant un NOUVEAU nom, jamais en mutant un schéma existant.
 * `champs` est copié PROFONDÉMENT et gelé AVANT toute validation/stockage (cf. clonerChamps) — la
 * définition retenue dans le registre est désormais IMMUABLE, indépendante de l'objet appelant.
 */
export function defineSchema(registry: MjschemaRegistry, name: string, inputFields: MjschemaFields): MjschemaDef {
  const fields = cloneFields(inputFields)
  const order  = Object.freeze(Object.keys(fields)) as string[]
  for (const c of order) {
    validateFieldName(name, c)
    validateType(name, c, fields[c])
  }

  const existing = registry.byName.get(name)
  if (existing) {
    if (!sameShape(existing.fields, fields)) {
      throw new Error(t('schema.shape-different', { name, old: describeFields(existing.fields), newName: describeFields(fields) }))
    }
    return existing
  }

  if (registry.byId.length >= 256) throw new Error(t('schema.registry-full', { name }))
  const def: MjschemaDef = { id: registry.byId.length, name: name, fields: fields, order: order }
  registry.byName.set(name, def)
  registry.byId.push(def)
  return def
}

// --- encodage/décodage bas niveau — DataView little-endian, deux passes (mesure puis écriture) --

const utf8Encoder = new TextEncoder()
const utf8Decoder = new TextDecoder('utf-8')

/** taille FIXE en octets d'un scalaire, ou `null` pour str8/str16 (taille variable, dépend de la valeur) */
function fixedScalarSize(t: MjschemaScalar): number | null {
  switch (t) {
    case 'u8': case 'i8': case 'bool': return 1
    case 'u16': case 'i16': return 2
    case 'u32': case 'i32': case 'f32': return 4
    case 'f64': return 8
    default: return null
  }
}

// propriété lue sur l'objet à encoder — jamais celle qu'Object.prototype prête à tout objet : `toString` ou
// `constructor` absents de l'objet étaient lus comme des valeurs (drapeau de bits() vrai, « function Object() … »
// envoyé en chaîne). Un getter posé par une classe reste lu
function readKey(o: unknown, key: string): unknown {
  if (o == null) return undefined
  if (key in Object.prototype && !Object.prototype.hasOwnProperty.call(o, key)) return undefined
  return (o as Record<string, unknown>)[key]
}

// plage de chaque entier : une valeur hors plage arrivait repliée sans un mot (u8 300 → 44, u32 -1 → 4294967295),
// et une donnée en `codec: 'auto'` dépendait alors du transport. Une fraction reste tronquée vers zéro
const RANGES: Partial<Record<MjschemaScalar, [number, number]>> = {
  u8: [0, 255], i8: [-128, 127], u16: [0, 65535], i16: [-32768, 32767], u32: [0, 4294967295], i32: [-2147483648, 2147483647],
}

function checkRange(schemaName: string, field: string, index: number, scalarType: MjschemaScalar, value: unknown): void {
  const range = RANGES[scalarType]
  if (!range) return
  const n = Math.trunc(numOr0(value))
  // un nombre infini ou NaN est hors plage comme 300 en u8 (numOr0 le ramènerait à 0 sans un mot) ; une valeur absente ou qui
  // n'est pas un nombre vaut toujours 0
  if (n < range[0] || n > range[1] || Math.abs(Number(value)) === Infinity || Number.isNaN(value)) {
    throw new Error(t('schema.value-out-of-range', { schema: schemaName, field: index >= 0 ? `${field}[${index}]` : field, type: scalarType, value: String(value), min: range[0], max: range[1] }))
  }
}

// octets UTF-8 des chaînes du message : encodés UNE fois à la mesure, recopiés tels quels à l'écriture (les deux
// passes parcourent les champs dans le même ordre) — chaque chaîne était encodée deux fois
interface EncodedStrings { encoded: Uint8Array[]; i: number }

// param renommé t → scalarType (E2b4) : `t` collisionnait avec l'import du traducteur de messages
function measureScalar(scalarType: MjschemaScalar, value: unknown, strings: EncodedStrings, schemaName: string, field: string, index = -1): number {
  const fixed = fixedScalarSize(scalarType)
  if (fixed != null) {
    checkRange(schemaName, field, index, scalarType, value)
    return fixed
  }
  const encoded = utf8Encoder.encode(String(value ?? ''))
  const max = scalarType === 'str8' ? 255 : 65535
  if (encoded.byteLength > max) throw new Error(t('schema.string-too-long', { type: scalarType, bytes: encoded.byteLength, max }))
  strings.encoded.push(encoded)
  return (scalarType === 'str8' ? 1 : 2) + encoded.byteLength
}

function measureField(type: MjschemaFieldType, value: unknown, strings: EncodedStrings, schemaName: string, field: string): number {
  if (typeof type === 'string') return measureScalar(type, value, strings, schemaName, field)
  if (type.kind === 'bits') return 1
  // list — 2 (compteur u16) + chaque élément mesuré comme le scalaire `of`
  const arr = Array.isArray(value) ? value : []
  if (arr.length > 65535) throw new Error(t('schema.list-too-long', { of: type.of, n: arr.length }))
  let total = 2
  for (let i = 0; i < arr.length; i++) total += measureScalar(type.of, arr[i], strings, schemaName, field, i)
  return total
}

// nombre fini par défaut — une valeur absente/non numérique s'encode en 0 plutôt que de faire
// planter l'envoi (même politique de tolérance que le reste de MJS-WS, cf. core.ts sendRaw : un
// bug de FORME de la charge applicative n'est jamais laissé faire tomber le process)
function numOr0(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0 }

// un champ flottant écrit tout nombre, `Infinity`, `-Infinity` et `NaN` compris (IEEE les sait) ; une valeur absente ou qui n'est pas un
// nombre vaut 0, comme ailleurs
function toFloat(v: unknown): number { return typeof v === 'number' ? v : numOr0(v) }

function writeScalar(view: DataView, offset: number, t: MjschemaScalar, value: unknown, strings: EncodedStrings): number {
  switch (t) {
    case 'u8':   view.setUint8(offset, numOr0(value) & 0xFF); return offset + 1
    case 'i8':   view.setInt8(offset, numOr0(value)); return offset + 1
    case 'bool': view.setUint8(offset, value ? 1 : 0); return offset + 1
    case 'u16':  view.setUint16(offset, numOr0(value), true); return offset + 2
    case 'i16':  view.setInt16(offset, numOr0(value), true); return offset + 2
    case 'u32':  view.setUint32(offset, numOr0(value), true); return offset + 4
    case 'i32':  view.setInt32(offset, numOr0(value), true); return offset + 4
    case 'f32':  view.setFloat32(offset, toFloat(value), true); return offset + 4
    case 'f64':  view.setFloat64(offset, toFloat(value), true); return offset + 8
    case 'str8': case 'str16': {
      const encoded = strings.encoded[strings.i++]
      if (t === 'str8') { view.setUint8(offset, encoded.byteLength); offset += 1 }
      else { view.setUint16(offset, encoded.byteLength, true); offset += 2 }
      new Uint8Array(view.buffer, view.byteOffset + offset, encoded.byteLength).set(encoded)
      return offset + encoded.byteLength
    }
  }
}

function writeField(view: DataView, offset: number, type: MjschemaFieldType, value: unknown, strings: EncodedStrings): number {
  if (typeof type === 'string') return writeScalar(view, offset, type, value, strings)
  if (type.kind === 'bits') {
    let byte = 0
    for (let i = 0; i < type.names.length; i++) if (readKey(value, type.names[i])) byte |= (1 << i)
    view.setUint8(offset, byte)
    return offset + 1
  }
  const arr = Array.isArray(value) ? value : []
  view.setUint16(offset, arr.length, true)
  offset += 2
  for (const v of arr) offset = writeScalar(view, offset, type.of, v, strings)
  return offset
}

/** garde de bornes EXPLICITE — la lecture ne doit JAMAIS dépasser la fenêtre LOGIQUE de la trame
 *  (`vue.byteLength`, cf. decode() : DataView construite avec byteOffset/byteLength EXPLICITES),
 *  jamais le buffer sous-jacent qui peut être plus grand si `bytes` est une VUE d'un buffer partagé
 *  — sinon `new Uint8Array(vue.buffer, ...)` (str8/str16, ci-dessous) lirait des octets VOISINS hors
 *  trame (fuite heap : son propre contrôle de borne porte sur le buffer ENTIER, pas sur la fenêtre).
 *  Appelée avant TOUTE lecture qui avance offset (scalaire à taille fixe, préfixe + octets str8/
 *  str16, élément de list) — trame VALIDE : jamais déclenchée, un comparateur de plus sur le chemin
 *  nominal, byte-identique par ailleurs. */
function boundRead(offset: number, size: number, view: DataView): void {
  if (offset + size > view.byteLength) throw new RangeError(t('schema.decode-outside-bounds'))
}

function readScalar(view: DataView, offset: number, t: MjschemaScalar): [unknown, number] {
  switch (t) {
    case 'u8':   boundRead(offset, 1, view); return [view.getUint8(offset), offset + 1]
    case 'i8':   boundRead(offset, 1, view); return [view.getInt8(offset), offset + 1]
    case 'bool': boundRead(offset, 1, view); return [view.getUint8(offset) !== 0, offset + 1]
    case 'u16':  boundRead(offset, 2, view); return [view.getUint16(offset, true), offset + 2]
    case 'i16':  boundRead(offset, 2, view); return [view.getInt16(offset, true), offset + 2]
    case 'u32':  boundRead(offset, 4, view); return [view.getUint32(offset, true), offset + 4]
    case 'i32':  boundRead(offset, 4, view); return [view.getInt32(offset, true), offset + 4]
    case 'f32':  boundRead(offset, 4, view); return [view.getFloat32(offset, true), offset + 4]
    case 'f64':  boundRead(offset, 8, view); return [view.getFloat64(offset, true), offset + 8]
    case 'str8': case 'str16': {
      let len: number
      if (t === 'str8') { boundRead(offset, 1, view); len = view.getUint8(offset); offset += 1 }
      else { boundRead(offset, 2, view); len = view.getUint16(offset, true); offset += 2 }
      boundRead(offset, len, view)
      const encoded = new Uint8Array(view.buffer, view.byteOffset + offset, len)
      return [utf8Decoder.decode(encoded), offset + len]
    }
  }
}

function readField(view: DataView, offset: number, type: MjschemaFieldType): [unknown, number] {
  if (typeof type === 'string') return readScalar(view, offset, type)
  if (type.kind === 'bits') {
    boundRead(offset, 1, view)
    const byte = view.getUint8(offset)
    const out: Record<string, boolean> = {}
    for (let i = 0; i < type.names.length; i++) out[type.names[i]] = !!(byte & (1 << i))
    return [out, offset + 1]
  }
  boundRead(offset, 2, view)
  const n = view.getUint16(offset, true)
  offset += 2
  const out: unknown[] = []
  for (let i = 0; i < n; i++) { const [v, next] = readScalar(view, offset, type.of); out.push(v); offset = next }
  return [out, offset]
}

// --- API haut niveau — encode(nom, objet) / decode(bytes), enveloppe [u8 id][charge] -----------

/** `objet` est lu champ par champ selon l'ORDRE déclaré (def.order) — un champ absent/mal typé
 *  s'encode en valeur zéro plutôt que de lever (cf. numOr0) : SEULES les erreurs STRUCTURELLES
 *  (schéma inconnu, chaîne/list trop longue pour son préfixe, entier hors de la plage de son type)
 *  font throw. */
export function encode(registry: MjschemaRegistry, name: string, data: Record<string, unknown> | null | undefined): Uint8Array {
  const def = registry.byName.get(name)
  if (!def) throw new Error(t('schema.encode-schema-unknown', { name }))
  const o = data ?? {}
  const strings: EncodedStrings = { encoded: [], i: 0 }
  let size = 1   // octet id
  for (const c of def.order) size += measureField(def.fields[c], readKey(o, c), strings, name, c)
  const buffer = new ArrayBuffer(size)
  const view = new DataView(buffer)
  view.setUint8(0, def.id)
  let offset = 1
  for (const c of def.order) offset = writeField(view, offset, def.fields[c], readKey(o, c), strings)
  return new Uint8Array(buffer)
}

/** `bytes` peut être une VUE (sous-tableau) d'un buffer plus grand — DataView construite avec
 *  byteOffset/byteLength explicites, jamais `bytes.buffer` seul (piège : verrait tout le buffer
 *  sous-jacent, pas la seule tranche reçue). */
export function decode(registry: MjschemaRegistry, bytes: Uint8Array): { name: string; data: Record<string, unknown> } {
  if (bytes.byteLength < 1) throw new Error(t('schema.decode-frame-empty'))
  const id = bytes[0]
  const def = registry.byId[id]
  if (!def) throw new Error(t('schema.decode-id-unknown', { id }))
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 1
  const data: Record<string, unknown> = {}
  for (const c of def.order) { const [v, next] = readField(view, offset, def.fields[c]); data[c] = v; offset = next }
  return { name: def.name, data }
}

// --- hash stable du registre — FNV-1a 32 bits, hex (PAS de crypto : juste un désaccord détectable,
// pas une preuve d'intégrité) — dépend des noms + types + ORDRE de déclaration, cf. tête de fichier --

function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(16).padStart(8, '0')
}

// FNV-1a hashé sur une sérialisation JSON (jamais une concaténation brute par ':'/'='/','/'|') — un
// nom de SCHÉMA ou de CHAMP peut contenir N'IMPORTE QUEL caractère, y compris ceux utilisés comme
// séparateurs ci-dessous : { 'b=u8,c': 'u8' } (1 champ) et { b: 'u8', c: 'u8' } (2 champs) donnaient
// AUPARAVANT le MÊME texte concaténé ('b=u8,c=u8') malgré des trames de 2 et 3 octets — collision
// structurelle qui trompait la vérification de compatibilité client/serveur (deux schémas
// DIFFÉRENTS jugés identiques). JSON.stringify échappe nativement guillemets/antislashs DANS chaque
// chaîne, ce qui rend deux structures différentes TOUJOURS distinguables dans le texte haché — DOIT
// rester caractère pour caractère identique à src/runtime/mjs_schema.ts::mjschemaHashRegistry (cf.
// son propre commentaire), sous peine de hash divergents entre client et serveur pour des schémas
// pourtant identiques (le serveur pousserait alors µ:schema à CHAQUE hello, sans raison réelle).
export function hashRegistry(registry: MjschemaRegistry): string {
  const parts = registry.byId.map(def => JSON.stringify([def.name, def.order.map(c => [c, describeType(def.fields[c])])]))
  return fnv1a(parts.join('|'))
}

// --- voyage en trame µ:schema — définitions JSON-safe (list()/bits() sont déjà des objets inertes,
// jamais des fonctions embarquées) + rechargement côté récepteur (loadDefinitions RE-décrit un
// registre via defineSchema — mêmes gardes, mêmes ids dans le MÊME ordre puisque `schemas` est déjà
// dans l'ordre d'origine, cf. serializeDefinitions) ------------------------------------------

export interface MjschemaDefinitionsJSON {
  hash: string
  schemas: Array<{ name: string; fields: Array<[string, MjschemaFieldType]> }>
}

export function serializeDefinitions(registry: MjschemaRegistry): MjschemaDefinitionsJSON {
  return {
    hash: hashRegistry(registry),
    schemas: registry.byId.map(def => ({ name: def.name, fields: def.order.map((c): [string, MjschemaFieldType] => [c, def.fields[c]]) })),
  }
}

export function loadDefinitions(json: MjschemaDefinitionsJSON): MjschemaRegistry {
  const registry = createRegistry()
  for (const s of json.schemas) {
    // Object.create(null) (pas `{}`) — l'affectation `champs[c] = t` juste en dessous ne doit
    // JAMAIS activer le setter '__proto__' hérité d'Object.prototype : sur un objet littéral
    // normal, un champ nommé '__proto__' reçu du réseau serait perdu ICI même, en silence, AVANT
    // d'atteindre la garde de defineSchema (validateFieldName, cf. son commentaire) — `t` (une string
    // comme 'u8') n'est pas un prototype valide, le setter magique ignore alors l'affectation sans
    // lever la moindre erreur.
    const fields: MjschemaFields = Object.create(null)
    for (const [c, t] of s.fields) fields[c] = t
    defineSchema(registry, s.name, fields)
  }
  return registry
}
