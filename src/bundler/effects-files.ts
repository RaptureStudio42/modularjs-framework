// bundler/effects-files — les fichiers `*.effects.mjs` : les effets de l'appli.
//
// Un fichier d'effets n'est pas un composant : il ne produit aucun custom element, seulement des
// effets, écrits dans un bloc <effects> et valables dans toute l'appli (cf. effects/project.ts).
// Chaque composant les reçoit au build (TranspileOpts.effectDefs) ; un effet réglé s'y résout, un
// effet CSS part avec le composant qui l'utilise. Un composant qui en utilise un dépend de ces
// fichiers — un effet changé le recompile (cf. CacheEntry.effectsDeps).

import { basename } from 'node:path'

import { extractSections } from '../transpiler/sections.js'
import { parseEffectsBlock, resolveProjectEffects } from '../effects/project.js'
import { withProjectEffects, type ProjectEffect } from '../effects/catalog.js'
import { t } from '../messages/index.js'

export function isEffectsFile(filePath: string): boolean {
  return basename(filePath, '.mjs').endsWith('.effects')
}

/** un fichier → ses effets, tels qu'écrits (résolus ensemble, cf. collectEffectDefs) ; `problems` : voir parseEffectsBlock — y est rangée aussi la faute d'un
 * fichier qui n'est pas que son bloc <effects> (du HTML, un <script>, un <style>… à côté) : le bloc se lit quand même, ses alias restent connus. Sans bloc, ou
 * avec plusieurs, rien à lire (ou on ne sait pas lequel) : la faute lève toujours */
export function readEffectsFile(source: string, filePath: string, problems?: Error[]): ReturnType<typeof parseEffectsBlock> {
  const fichier  = basename(filePath)
  const sections = extractSections(source)
  const impur    = (quoi: string) => new Error(t('bundler.effets-fichier-impur', { fichier, quoi }))
  if (sections.effects.length === 0) throw new Error(t('bundler.effets-fichier-sans-bloc', { fichier }))
  if (sections.effects.length > 1)   throw new Error(t('bundler.effets-fichier-multi', { fichier }))
  // un commentaire HTML (et le blanc autour) hors du bloc est toléré, comme dans un *.theme.mjs
  const autre = sections.html.replace(/<!--(?:-?>|[\s\S]*?--!?>)/g, '').trim() !== ''                    ? 'du HTML'
              : sections.script.raw.trim() !== '' || sections.module.raw.trim() !== ''           ? '<script>'
              : sections.style.raw.trim() !== '' || sections.layouts.length > 0                  ? '<style>'
              : sections.themes.length > 0                                                       ? '<theme>'
              : sections.vars                                                                    ? '<vars>'
              : sections.types.length > 0                                                        ? '<types>'
              : sections.routes.length > 0                                                       ? '<routes>'
              : ''
  if (autre) {
    if (!problems) throw impur(autre)
    problems.push(impur(autre))
  }
  const bloc = sections.effects[0]
  return parseEffectsBlock(bloc.raw, bloc.startLine, filePath, problems)
}

/** tous les effets de l'appli, résolus ; une faute cite son fichier. `problems` : les fautes y sont rangées au lieu d'arrêter la lecture (un nom défini deux fois, la première définition reste ; une
 * déclaration illisible, sautée ; un effet qui ne se résout pas, absent) — le bundler les rend avec les erreurs du build, sans que les composants qui
 * posent les autres alias butent sur un effet disparu */
export function collectEffectDefs(files: string[], read: (file: string) => string, warn?: (message: string) => void, problems?: Error[]): Record<string, ProjectEffect> {
  // lus sans les effets d'une compilation d'avant (transpile() les laisse posés) : l'exemple qu'une faute cite ne vient jamais d'une autre appli
  return withProjectEffects({}, () => resolveProjectEffects([...files].sort().map(f => readEffectsFile(read(f), f, problems)), warn, problems))
}

// le nombre d'usages, dans l'appli, à partir duquel un alias est écrit une seule fois dans une table du cœur (cf. Bundler.tableAliases) ;
// en dessous, chaque usage garde ses réglages écrits en clair, comme sans alias. Écrite une seule fois, la table fait maigrir le fichier brut
// à partir d'environ six usages (en production : plus lourd à cinq, plus léger à six, de plus en plus ensuite) ; compressée, elle fait gagner
// des octets quand les usages sont répartis sur plusieurs fichiers de composant, et en coûte quelques dizaines quand ils tiennent dans un seul
// fichier. C'est le seul endroit où le seuil s'écrit
export const ALIAS_TABLE_MIN_USES = 6

// `*nom` et `*effet.alias` écrits dans un source : le nombre de fois que chacun paraît (un nom, pas
// forcément un effet : le bundler ne garde que les alias qu'il connaît). Une lecture large — un `*nom` d'un
// commentaire compte aussi : au pire un alias passe dans la table pour un seul usage réel, jamais l'inverse
const USE_RE = /(?<![\w$.*)\]])\*([A-Za-z][\w-]*(?:\.[a-z][a-z0-9_]*)?)(?![\w-])/g

export function countEffectUses(source: string): Record<string, number> {
  const out: Record<string, number> = Object.create(null)
  if (!source.includes('*')) return out
  for (const m of source.matchAll(USE_RE)) out[m[1]] = (out[m[1]] ?? 0) + 1
  return out
}
