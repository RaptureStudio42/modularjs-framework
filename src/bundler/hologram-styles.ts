// bundler/hologram-styles — *hologram : un seul module, mais le build n'embarque, des vingt-trois styles de carte, que
// ceux que les pages de l'appli écrivent (`*hologram(cosmos)`, `*hologram(style: 'shiny')`…), avec le moteur de carte seulement
// quand une carte est écrite. C'est un client de bundler/fx-sections.ts (le filtre de sections de tout fichier d'effet) : le fichier
// de l'effet garde ses étiquettes en NOMS DE STYLES de carte — un nom s'entend « le réglage `style` vaut ce nom » ; `cards` : à une
// carte au moins (un style que le fichier nomme, pas un style simple comme `gold`) : la feuille, le moteur de carte.
//
// Les styles écrits viennent du code compilé des pages (signaux `hologram_style:<nom>`, features.ts). Un style que le build
// ne sait pas lire (une variable, un effet choisi par une variable, une demande explicite `runtime: ['fx_hologram']`) : tous les
// styles. Aucune carte écrite : le style simple seul, sans la feuille ni le moteur de carte.
//
// Ce client ajoute au filtre une passe : les styles qui partagent une définition (`style('a b c', …)`) ne gardent, dans l'appel,
// que les noms demandés.

import { HOLOGRAM_STYLE_ANY, FX_ANY, fxSignal } from './features.js'
import { selectFxSections, fxDemand, fxWrittenValues, type FxClient } from './fx-sections.js'
import { t } from '../messages/index.js'

/** les styles de carte à embarquer : un ensemble de noms, ou `'all'` */
export type HologramStyles = ReadonlySet<string> | 'all'

/** le fichier de l'effet, tel que le bundler le lit */
export const HOLOGRAM_FILE = 'mjs_fx_hologram.ts'

// le premier argument d'un `style('a b c', …)` de la feuille : les noms qui partagent la définition
const REGEX_STYLE_CALL = /(?<![\w$.])style\('([a-z0-9 -]+)'/g

/** le client de fx-sections : les mots d'étiquette du fichier sont des styles de carte (un jeton `réglage=valeur` ou `effet.réglage` reste ce qu'il est : `zoom=spin`, `hologram.back`), et les appels `style('…')` suivent les styles demandés */
export const hologramClient: FxClient = {
  word: (word) => /[=.]/.test(word) ? [word] : [word === 'cards' ? 'style=*' : 'style=' + word],
  finish: (text, { demand, known }) => {
    const styles = fxWrittenValues(demand, 'style')
    if (styles === 'all') return text
    const names  = known.get('style') ?? new Set<string>()
    const wanted = new Set([...styles].filter((s) => names.has(s)))
    const written = new Set<string>()
    const out = text.replace(REGEX_STYLE_CALL, (m, list: string) => {
      const kept = list.split(' ').filter((n) => wanted.has(n))
      if (kept.length === 0) throw new Error(t('bundler.hologram-styles.appel-sans-style', { fichier: HOLOGRAM_FILE, noms: list }))
      for (const n of kept) written.add(n)
      return `style('${kept.join(' ')}'`
    })
    for (const s of wanted) if (!written.has(s)) throw new Error(t('bundler.hologram-styles.style-sans-section', { fichier: HOLOGRAM_FILE, style: s }))
    return out
  }
}

/**
 * Le fichier de l'effet réduit aux styles de carte demandés (et au moteur de carte, s'il y en a un) ; les marques des sections
 * ne sortent jamais. `'all'` : tout est gardé, le tour et le dos des zooms compris. Un fichier sans marque passe tel quel. Un nom qui n'est pas un style de carte du
 * fichier (`gold`, une faute) est ignoré ; un style de carte demandé sans section est une erreur de build : jamais un style
 * manquant en silence.
 */
export function selectHologramStyles(src: string, styles: HologramStyles): string {
  const used = new Set<string>(styles === 'all' ? [HOLOGRAM_STYLE_ANY, fxSignal('hologram', 'zoom', FX_ANY), fxSignal('hologram', 'back', FX_ANY)] : [...styles].map((s) => fxSignal('hologram', 'style', s)))
  return selectFxSections(HOLOGRAM_FILE, src, used, false, hologramClient)
}

/**
 * Les styles de carte à embarquer d'après les signaux du build : ceux que les pages écrivent ; tous quand un style vient
 * d'une variable ou d'une mention que le build ne sait pas lire, quand une variable peut choisir l'effet (`*delta(fx: $effet)`),
 * ou quand le projet demande l'effet au cœur (`runtime: ['fx_hologram']`).
 */
export function hologramStylesWanted(used: ReadonlySet<string>, forced: boolean): HologramStyles {
  const written = fxWrittenValues(fxDemand(HOLOGRAM_FILE, used, forced), 'style')
  return written === 'all' ? 'all' : written
}
