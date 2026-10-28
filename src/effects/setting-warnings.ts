// les réglages d'un effet dont la forme est juste (la vérification du catalogue les accepte) mais qui ne donnent rien : une hauteur nulle ou
// négative pour *skeleton (`height: 0`, `height: -20`, `0px`, `-2em`), où la silhouette n'a aucune hauteur à se partager. Le build le dit,
// d'après les réglages écrits à la pose (un alias écrit `*skeleton.nom` compris) ; un réglage tenu par une variable ne dit rien : sa valeur
// n'est connue qu'à l'exécution

import { parse } from '../parser/index.js'
import { parseEffect } from './catalog.js'
import { t } from '../messages/index.js'
import { typedLine, type LintToggles } from '../diagnostics.js'

// une longueur nulle ou négative : `0`, `-20` (lus en nombres), `0px`, `0.0%`, `-2em`
const nonPositive = (v: unknown): boolean => typeof v === 'number' ? v <= 0 : typeof v === 'string' && /^(?:-|-?0*\.?0+(?:px|%|em|rem|vw|vh)$)/.test(v)

// effet par effet, les réglages vérifiés et la valeur qui ne donne rien
const CHECKS: Record<string, Record<string, (v: unknown) => boolean>> = {
  skeleton: { height: nonPositive },
}

const NAMED = new RegExp('\\*(?:' + Object.keys(CHECKS).join('|') + ')\\b')

/** les avertissements du build pour les réglages écrits dans `html` qui passent la vérification mais ne donnent rien (cf. CHECKS) */
export function settingWarnings(html: string, lint?: LintToggles): string[] {
  if (!NAMED.test(html)) return []
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
      const nom = String(p.base ?? a.name.slice(1)).split('.')[0]
      for (const [reglage, vain] of Object.entries(CHECKS[nom] ?? {})) {
        if (!Object.hasOwn(p.fixed ?? {}, reglage) || !vain(p.fixed[reglage])) continue
        const ligne = typedLine('syntax', t('effets.hauteur-sans-effet', { balise: n.name ?? '', nom: a.name.slice(1), valeur: String(p.fixed[reglage]) }), lint)
        if (ligne !== null) out.push(ligne)
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
