// construit des sources `.mjs` en développement minifié (`minify: true` : noms internes raccourcis comme en production) pour le harnais
// des tests en navigateur réel (cf. liaison-navigateur.ts, `charger`) : les fichiers sont chargés en modules, le cœur d'abord — le code
// minifié importe ses liaisons sous des noms raccourcis, qu'un script mis bout à bout ne retrouverait pas
import { mkdirSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './tmp.js'
import type { Cible } from './liaison-navigateur.js'
import { Bundler } from '../../src/bundler/index.js'

export async function construireMinifie(prefixe: string, sources: Record<string, string>): Promise<Cible> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(sources)) writeFileSync(join(srcDir, nom), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), minify: true } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
  const rang   = (f: string) => /^mjs_core-/.test(f) ? 0 : f.startsWith('mjs_') ? 1 : 2
  const files  = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b) || a.localeCompare(b))
  const script = files.map((f) => `import '/out/${f}';`).join(' ')
  return { mode: 'dev-parents-avant', racine: root, document: (balise) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><${balise}></${balise}><script type="module">${script}</script></body></html>` }
}
