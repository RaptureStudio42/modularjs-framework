// refus à la construction autour des valeurs dérivées qui attendent (`$x = await f($q)`) : le message d'une compilation refusée
// (transpile, développement), le texte d'une compilation acceptée, ou les erreurs d'une construction entière (le vrai Bundler),
// pour les fichiers de module

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler } from '../../src/bundler/index.js'
import { transpile } from '../../src/transpiler/index.js'
import { mjsTmp } from './tmp.js'

const OPTIONS = { moduleName: 'refus', defaultScriptLang: 'civet', templateLang: 'civet', devWarnings: true } as any

// le message de la compilation refusée de `source` ; échoue si elle passe
export async function refus(source: string): Promise<string> {
  let message: string | null = null
  try {
    await transpile(source, OPTIONS)
  }
  catch (e: any) {
    message = String(e.message)
  }
  assert.ok(message !== null, 'la compilation devait être refusée :\n' + source)
  return message
}

// le texte compilé de `source` ; échoue si elle est refusée
export async function compile(source: string): Promise<string> {
  return (await transpile(source, OPTIONS)).output
}

// les messages d'erreur de la construction de `sources` ; vide : construite sans erreur
export async function erreursDeConstruction(prefixe: string, sources: Record<string, string>): Promise<string> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(sources)) writeFileSync(join(srcDir, nom), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  await bundler.close()
  return stats.errors.map((e: any) => String(e.message)).join('\n')
}
