// rune séparée de son symbole : `µ` puis `.setContext(…)` à la ligne suivante, `µ .emit`, `µ.` puis `toast` à la
// ligne suivante — écriture valide en Civet, Coffee et JS, mais invisible aux réécritures d'applyMjsSugarToScript
// (transpiler/index.ts) comme aux motifs de détection des modules du cœur (bundler/index.ts, scanRuntimeFeatures) :
// le code compilait puis plantait à l'exécution (`µ.setContext is not a function`, module du cœur jamais joint)
// refus à la compilation, toutes runes confondues, sur le source brut du dev lu comme le lit la réécriture
// alias `mjs` reconnu seulement s'il est configuré : sans lui, `mjs` reste un nom libre
// `firstLine` recale le numéro sur la ligne du fichier (startLine d'une section, cf. sections.ts)

import { t } from '../messages/index.js'
import { maskNonCode } from '../mask.js'

// maskNonCode vit désormais dans src/mask.ts (masqueur commun, réutilisé par les autres
// passes du transpileur) — réexportée ICI sous le même nom pour la compatibilité des
// importeurs existants.
export { maskNonCode }

const SPLIT_RUNE_RE: Record<string, RegExp> = {
  'µ': /(?<![\w$.])(µ)(?:\s+\.\s*|\.\s+)([A-Za-z_$][\w$]*)/,
  mjs: /(?<![\w$.])(µ|mjs)(?:\s+\.\s*|\.\s+)([A-Za-z_$][\w$]*)/
}

export function lintSplitRune(source: string, place: string, opts: { sigil?: string, firstLine?: number, lang?: string } = {}): void {
  if(!source) return
  const masked = maskNonCode(source, opts.lang)
  const m      = SPLIT_RUNE_RE[opts.sigil === 'mjs' ? 'mjs' : 'µ'].exec(masked)
  if(!m) return
  const line = (opts.firstLine ?? 1) + (masked.slice(0, m.index).match(/\n/g)?.length ?? 0)
  throw new Error(t('transpiler.rune-separee-du-symbole', { symbole: m[1], rune: m[2], lieu: place, ligne: line }))
}
