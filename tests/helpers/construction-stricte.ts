// composants courts construits par le vrai Bundler (production, un seul fichier, non minifié), joués en mode strict comme l'est un
// module : `codeStrict` rend le script prêt pour une page (happy-dom ou vrai navigateur), `monterStrict` le monte dans happy-dom,
// avertissements et erreurs de la console recueillis. `reglages` : ceux de la construction (`{ proxy: false }`)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler } from '../../src/bundler/index.js'
import { mjsTmp } from './tmp.js'

export async function codeStrict(prefixe: string, composants: Record<string, string>, reglages: Record<string, unknown> = {}): Promise<string> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, texte] of Object.entries(composants)) writeFileSync(join(srcDir, nom + '.mjs'), texte)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env: 'prod', js: 'bundle', minify: false, ...reglages } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [])
  return '"use strict";\n' + readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
}

// une balise par composant (`<mjs-nom>`), posées ensemble puis laissées se monter
export async function monterStrict(prefixe: string, composants: Record<string, string>, reglages: Record<string, unknown> = {}): Promise<{ window: any, console: string[] }> {
  const code        = await codeStrict(prefixe, composants, reglages)
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  const vus: string[] = []
  window.console.warn  = (...a: any[]) => { vus.push(a.map(String).join(' ')) }
  window.console.error = (...a: any[]) => { vus.push(a.map(String).join(' ')) }
  window.eval(code)
  window.document.body.innerHTML = Object.keys(composants).map((n) => `<mjs-${n}></mjs-${n}>`).join('')
  await new Promise((r) => setTimeout(r, 300))
  return { window, console: vus }
}
