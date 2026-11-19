// deux effets d'une même balise qui dessinent dans le même pseudo-élément (`::before`, `::after`) : un seul des deux apparaît (le
// grain de *noise disparaît sous le reflet de *shine). Le build le dit, d'après les réglages écrits à la pose ; un réglage tenu par
// une variable, ou un effet qui ne choisit qu'à l'exécution, ne dit rien (au plus juste : aucun avertissement pour rien)

import { parse } from '../parser/index.js'
import { parseEffect } from './catalog.js'
import { t } from '../messages/index.js'
import { typedLine, type LintToggles } from '../diagnostics.js'

type Pseudo = 'before' | 'after'
type Settings = Record<string, unknown>

// les pseudo-éléments de la balise que prend chaque effet, selon ses réglages fixes (`f`) et tenus par une variable (`d`), et les effets
// écrits sur la même balise (`noms`) ; null : on ne sait pas au build
const PSEUDOS: Record<string, (f: Settings, d: Settings, kids: any[], names: string[]) => Pseudo[] | null> = {
  shine:     (f, d) => 'where' in d ? null : f.where === 'text' ? [] : ['after'],
  noise:     () => ['after'],
  underline: () => ['after'],
  unveil:    () => ['after'],
  tilt:      (f, d) => 'glare' in d ? null : f.glare === true ? ['after'] : [],
  spotlight: () => ['before', 'after'],
  // le dégradé posé avec *spotlight, qui garde ceux de la balise : il dessine dans les pseudo-éléments d'un calque
  border:    (f, d, _kids, names) => names.includes('spotlight') ? [] : 'style' in d ? null : (f.style ?? 'gradient') === 'gradient' ? ['before', 'after'] : [],
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
    const taken: Record<Pseudo, string[]> = { before: [], after: [] }
    const reads: { a: any, p: any, name: string }[] = []
    for (const a of fx) {
      let p: any
      try {
        p = parseEffect(a.name.slice(1), a.val ?? '')
      }
      catch {
        continue
      }
      reads.push({ a, p, name: String(p.base ?? a.name.slice(1)).split('.')[0] })
    }
    const names = reads.map(l => l.name)
    for (const { a, p, name } of reads) {
      if (!Object.hasOwn(PSEUDOS, name)) continue
      for (const w of PSEUDOS[name](p.fixed ?? {}, p.dynamic ?? {}, n.children ?? [], names) ?? []) taken[w].push(a.name)
    }
    const doubles = (['before', 'after'] as Pseudo[]).filter(w => taken[w].length > 1)
    if (doubles.length === 0) return
    const list = doubles.map(w => `::${w} (${taken[w].join(', ')})`).join(' ; ')
    const line = typedLine('collision', t('effects.pseudo-shared', { tag: n.name ?? '', list: list }), lint)
    if (line !== null) out.push(line)
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
