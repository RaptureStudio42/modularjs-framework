// les deux lignes que le manifeste d'un build pose pour tous les builds (libellés fr/en du framework
// + langue de repli) : un test qui charge le cœur et un module cœur sans passer par le manifeste
// les rejoue après le cœur, comme le fait le navigateur

import { readFileSync } from 'node:fs'

export function libellesDuManifeste(manifestPath: string): string {
  const lignes = readFileSync(manifestPath, 'utf-8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('µ._runtimeLabels'))
  if (lignes.length === 0) throw new Error(`aucun libellé du framework dans ${manifestPath}`)
  return lignes.join('\n')
}
