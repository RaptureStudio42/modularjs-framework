// cli/package-files — les fichiers du paquet mjs LUI-MÊME (son package.json, sa doc), retrouvés depuis le module qui les
// demande. Deux profondeurs possibles : `src/cli/*.ts` (dev, lancé par tsx) est à deux niveaux de la racine du paquet,
// `dist/cli.js` et ses morceaux `dist/chunk-*.js` (build esbuild, `--format=esm` garde `import.meta.url`) à un seul — le
// premier candidat qui existe gagne, et le package.json doit être celui de modularjs-framework (jamais celui d'un dossier
// voisin trouvé par hasard)

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CANDIDATES = ['../', '../../']

/** version du paquet mjs installé, `null` si son package.json est illisible ou sans version */
export function ownPackageVersion(): string | null {
  for (const base of CANDIDATES) {
    try {
      const pkg = JSON.parse(readFileSync(new URL(base + 'package.json', import.meta.url), 'utf-8'))
      if (pkg.name !== 'modularjs-framework') continue
      return typeof pkg.version === 'string' && pkg.version !== '' ? pkg.version : null
    }
    catch { /* candidat suivant */ }
  }
  return null
}

/** dossier `docs/` du paquet (celui qui porte llms.txt), `null` s'il n'est pas livré */
export function ownDocsDir(): string | null {
  for (const base of CANDIDATES) {
    const dir = fileURLToPath(new URL(base + 'docs/', import.meta.url))
    if (existsSync(dir + 'llms.txt')) return dir
  }
  return null
}
