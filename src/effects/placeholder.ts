// effects/placeholder — ce que le module fait en attendant ses textes traduits : la valeur de `@i18nPlaceholder`
// (une page) et de `i18n.placeholder` (la configuration), lues par la même fonction.
//
//   wait             le module reste caché, puis paraît d'un coup (défaut)
//   key              le nom de la clé à la place de chaque texte (pour déboguer)
//   *skeleton        des barres grises à la place de chaque texte ; le module est déjà là
//   *loader(bloom)   un indicateur de chargement affiché à la place du module, qui reste caché comme en wait
//
// Seuls les effets de la famille « chargement » du catalogue (src/effects/catalog.ts) sont permis. Leurs réglages sont
// ceux de l'effet, vérifiés comme partout ; `*skeleton` n'en garde qu'un, la couleur des barres (un texte ne scintille
// pas et ne s'arrondit pas : lines, shine, speed et radius n'y ont aucun sens).

import { EFFECTS, parseEffect, type EffectValue } from './catalog.js'
import { t } from '../messages/index.js'

export type PlaceholderMode = 'wait' | 'key' | '*skeleton' | '*loader'

export interface Placeholder {
  mode: PlaceholderMode
  /** les réglages écrits de l'effet (`*loader(bloom)` → `{ style: 'bloom' }`) ; null pour un mode sans effet ou un effet sans réglage */
  settings: Record<string, EffectValue> | null
}

/** où la valeur est écrite : le début du message qui la refuse, et la façon d'écrire la nouvelle valeur d'`auto` */
export interface PlaceholderPlace {
  where: string
  example: string
}

export const PLACEHOLDER_DIRECTIVE: PlaceholderPlace = { where: '[ModularJS] @i18nPlaceholder', example: '@i18nPlaceholder *skeleton' }
export const PLACEHOLDER_CONFIG: PlaceholderPlace    = { where: '[mjs.config.json] i18n.placeholder', example: '"placeholder": "*skeleton"' }

// les réglages de *skeleton qui ont un sens pour des barres de texte
const SKELETON_SETTINGS = ['color']

/** les valeurs permises, dans l'ordre où les messages les listent */
export function placeholderValues(): string[] {
  return ['wait', 'key', ...Object.keys(EFFECTS).filter(n => EFFECTS[n].family === 'loader').map(n => '*' + n)]
}

/** la valeur lue, ou une erreur de construction qui dit quoi écrire ; `raw` : ce qui est écrit, sans les guillemets de la configuration */
export function parsePlaceholder(raw: unknown, place: PlaceholderPlace): Placeholder {
  const validValues = placeholderValues().join(', ')
  const invalid = () => new Error(t('i18n.wait-invalid', { where: place.where, value: typeof raw === 'string' ? raw : JSON.stringify(raw), valid: validValues }))
  if (typeof raw !== 'string') throw invalid()
  const text = raw.trim()
  if (text === 'wait' || text === 'key') return { mode: text, settings: null }
  if (text === 'auto') throw new Error(t('i18n.wait-auto', { where: place.where, example: place.example }))
  const m = /^\*([a-z][a-z0-9-]*)(?:\(([\s\S]*)\))?$/.exec(text)
  if (!m || !placeholderValues().includes('*' + m[1])) throw invalid()
  const name = m[1]
  // les réglages vérifiés par le catalogue : nom inconnu, valeur hors plage, double écriture… les messages sont ceux des effets
  const r = parseEffect(name, m[2] ?? '')
  const variable = Object.values(r.dynamic)[0]
  if (variable !== undefined) throw new Error(t('i18n.wait-variable', { where: place.where, effect: name, value: variable }))
  if (name === 'skeleton') {
    for (const setting of Object.keys(r.fixed)) {
      if (!SKELETON_SETTINGS.includes(setting)) throw new Error(t('i18n.wait-setting-meaningless', { where: place.where, effect: name, setting: setting, valid: SKELETON_SETTINGS.join(', ') }))
    }
  }
  return { mode: ('*' + name) as PlaceholderMode, settings: Object.keys(r.fixed).length > 0 ? r.fixed : null }
}
