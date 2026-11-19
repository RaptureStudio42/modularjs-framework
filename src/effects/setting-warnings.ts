// les réglages d'un effet dont la forme est juste (la vérification du catalogue les accepte) mais qui ne donnent rien : une hauteur nulle ou
// négative pour *skeleton (`height: 0`, `height: -20`, `0px`, `-2em`), où la silhouette n'a aucune hauteur à se partager. Le build le dit,
// d'après les réglages écrits à la pose (un alias écrit `*skeleton.nom` compris) et ceux d'un alias du fichier d'effets de l'appli
// (`*squelette = *skeleton(height: 0)`, un alias d'alias compris) ; un réglage tenu par une variable ne dit rien : sa valeur n'est connue
// qu'à l'exécution

import { parse } from '../parser/index.js'
import { parseEffect, projectEffect } from './catalog.js'
import { t } from '../messages/index.js'
import { typedLine, type LintToggles } from '../diagnostics.js'

// une longueur nulle ou négative : `0`, `-20` (lus en nombres), `0px`, `0.0%`, `-2em`
const nonPositive = (v: unknown): boolean => typeof v === 'number' ? v <= 0 : typeof v === 'string' && /^(?:-|-?0*\.?0+(?:px|%|em|rem|vw|vh)$)/.test(v)

// effet par effet, les réglages vérifiés et la valeur qui ne donne rien
const CHECKS: Record<string, Record<string, (v: unknown) => boolean>> = {
  skeleton: { height: nonPositive },
}

const EFFECT_NAME = /\*([a-z][a-z0-9_-]*)/gi

// l'effet de la bibliothèque sous un nom écrit : lui-même, ou celui qu'un alias de l'appli règle, d'alias en alias
function libraryBase(name: string): string {
  let baseName = name.split('.')[0]
  const seen = new Set<string>()
  while (!seen.has(baseName)) {
    seen.add(baseName)
    const base = projectEffect(baseName)?.base
    if (!base) break
    baseName = base.split('.')[0]
  }
  return baseName
}

/** les avertissements du build pour les réglages écrits dans `html` qui passent la vérification mais ne donnent rien (cf. CHECKS) */
export function settingWarnings(html: string, lint?: LintToggles): string[] {
  if (![...html.matchAll(EFFECT_NAME)].some(m => Object.hasOwn(CHECKS, libraryBase(m[1])))) return []
  let root: any
  try {
    root = parse(html)
  }
  catch {
    return []
  }
  const out: string[] = []
  const check = (n: any) => {
    for (const a of n.attrs ?? []) {
      if (a.type !== 'static' || !/^\*[a-z]/i.test(a.name ?? '')) continue
      let p: any
      try {
        p = parseEffect(a.name.slice(1), a.val ?? '')
      }
      catch {
        continue
      }
      const name = libraryBase(String(p.base ?? a.name.slice(1)))
      for (const [setting, useless] of Object.entries(CHECKS[name] ?? {})) {
        if (!Object.hasOwn(p.fixed ?? {}, setting) || !useless(p.fixed[setting])) continue
        const line = typedLine('syntax', t('effects.height-no-effect', { tag: n.name ?? '', name: a.name.slice(1), value: String(p.fixed[setting]) }), lint)
        if (line !== null) out.push(line)
      }
    }
  }
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return
    if (n.type === 'tag') check(n)
    for (const c of n.children ?? []) walk(c)
    for (const b of n.branches ?? []) for (const c of b.children ?? []) walk(c)
  }
  walk(root)
  return out
}
