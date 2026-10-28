// deux effets d'une même balise qui dessinent dans le même pseudo-élément (`::before`, `::after`) : un seul des deux apparaît (le
// grain de *noise disparaît sous le reflet de *shine). Le build le dit, d'après les réglages écrits à la pose ; un réglage tenu par
// une variable, ou un effet qui ne choisit qu'à l'exécution, ne dit rien (au plus juste : aucun avertissement pour rien)

import { parse } from '../parser/index.js'
import { parseEffect } from './catalog.js'
import { t } from '../messages/index.js'
import { typedLine, type LintToggles } from '../diagnostics.js'

type Pseudo = 'before' | 'after'
type Reglages = Record<string, unknown>

// les pseudo-éléments de la balise que prend chaque effet, selon ses réglages fixes (`f`) et tenus par une variable (`d`), et les effets
// écrits sur la même balise (`noms`) ; null : on ne sait pas au build
const PSEUDOS: Record<string, (f: Reglages, d: Reglages, kids: any[], noms: string[]) => Pseudo[] | null> = {
  shine:     (f, d) => 'where' in d ? null : f.where === 'text' ? [] : ['after'],
  noise:     () => ['after'],
  underline: () => ['after'],
  unveil:    () => ['after'],
  tilt:      (f, d) => 'glare' in d ? null : f.glare === true ? ['after'] : [],
  spotlight: () => ['before', 'after'],
  // le dégradé posé avec *spotlight, qui garde ceux de la balise : il dessine dans les pseudo-éléments d'un calque
  border:    (f, d, _kids, noms) => noms.includes('spotlight') ? [] : 'style' in d ? null : (f.style ?? 'gradient') === 'gradient' ? ['before', 'after'] : [],
  iso:       () => ['before', 'after'],
  glitch:    () => ['before', 'after'],
  split:     () => ['before', 'after'],
  // breathe : la lueur du texte dans ::before, celle du cadre dans ::after
  neon:      (f, d) => 'breathe' in d || 'where' in d ? null : f.breathe !== true ? [] : f.where === 'box' ? ['after'] : f.where === 'both' ? ['before', 'after'] : ['before'],
  // sur un fond (aucune image dans la balise) : ::before ; des enfants que le build ne voit pas (bloc, expression) : on ne sait pas
  kenburns:  (_f, _d, kids) => kids.some(c => c.type !== 'tag' && c.type !== 'text' && c.type !== 'comment') ? null : kids.some(c => c.type === 'tag' && /^(img|picture)$/i.test(c.name ?? '')) ? [] : ['before'],
}

/** les effets de la table : ceux qui dessinent dans un pseudo-élément de leur balise (tenue d'accord avec leur code par un test) */
export const PSEUDO_EFFECTS: readonly string[] = Object.keys(PSEUDOS)

/** les avertissements du build pour les balises de `html` dont deux effets dessinent dans le même pseudo-élément */
export function pseudoClashWarnings(html: string, lint?: LintToggles): string[] {
  if (!/\s\*[a-z][\s\S]*\s\*[a-z]/i.test(html)) return []
  let root: any
  try {
    root = parse(html)
  }
  catch {
    return []
  }
  const out: string[] = []
  const check = (n: any) => {
    const fx = (n.attrs ?? []).filter((a: any) => a.type === 'static' && /^\*[a-z]/i.test(a.name ?? ''))
    if (fx.length < 2) return
    const pris: Record<Pseudo, string[]> = { before: [], after: [] }
    const lus: { a: any, p: any, nom: string }[] = []
    for (const a of fx) {
      let p: any
      try {
        p = parseEffect(a.name.slice(1), a.val ?? '')
      }
      catch {
        continue
      }
      lus.push({ a, p, nom: String(p.base ?? a.name.slice(1)).split('.')[0] })
    }
    const noms = lus.map(l => l.nom)
    for (const { a, p, nom } of lus) {
      if (!Object.hasOwn(PSEUDOS, nom)) continue
      for (const w of PSEUDOS[nom](p.fixed ?? {}, p.dynamic ?? {}, n.children ?? [], noms) ?? []) pris[w].push(a.name)
    }
    const doubles = (['before', 'after'] as Pseudo[]).filter(w => pris[w].length > 1)
    if (doubles.length === 0) return
    const liste = doubles.map(w => `::${w} (${pris[w].join(', ')})`).join(' ; ')
    const ligne = typedLine('collision', t('effets.pseudo-partage', { balise: n.name ?? '', liste }), lint)
    if (ligne !== null) out.push(ligne)
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
