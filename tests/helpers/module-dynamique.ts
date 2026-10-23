// harnais des tests de <@module> : des composants `.mjs` écrits en clair, compilés par le vrai Bundler
// (développement ou production), puis montés dans happy-dom. Les avertissements et erreurs émis par le
// framework sont recueillis (texte seul) au lieu d'aller à la console.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler } from '../../src/bundler/index.js'
import { stripEsm } from '../../src/server/renderToString.js'
import { mjsTmp } from './tmp.js'

export const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function attendre(cond: () => boolean, ms = 3000): Promise<void> {
  const fin = Date.now() + ms
  while(!cond() && Date.now() < fin) await pause(10)
}

export interface Monte {
  window:   any
  document: any
  hote:     any
  erreurs:  () => string[]
  warns:    () => string[]
}

// `sources` : nom de fichier sans extension → source ; `hote` est monté (`<mjs-hote>`)
export async function monterModule(sources: Record<string, string>, opts: { env?: 'dev' | 'prod'; prefixe?: string } = {}): Promise<Monte> {
  const root   = mjsTmp(opts.prefixe ?? 'moddyn')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for(const [nom, src] of Object.entries(sources)) writeFileSync(join(srcDir, `${nom}.mjs`), src)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), env: opts.env ?? 'dev' })
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
  const code  = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  window.eval(`${code}\nglobalThis.µ = µ;\nglobalThis.__erreurs = [];\nglobalThis.__warns = [];\nµ.error = function(...a) { globalThis.__erreurs.push(a.map(String).join(' ')); };\nµ.warn = function(...a) { globalThis.__warns.push(a.map(String).join(' ')); };`)
  window.document.body.innerHTML = '<mjs-hote></mjs-hote>'
  const hote = window.document.querySelector('mjs-hote')
  await attendre(() => !!hote._shadow)
  await pause(150)
  return { window, document: window.document, hote, erreurs: () => JSON.parse(window.eval('JSON.stringify(globalThis.__erreurs)')), warns: () => JSON.parse(window.eval('JSON.stringify(globalThis.__warns)')) }
}

// textes de chaque élément `sel` de l'ombre de `racine` (chaînes seulement, jamais un nœud)
export const textes = (racine: any, sel: string): string[] => [...racine._shadow.querySelectorAll(sel)].map((n: any) => n.textContent.trim())

// balises des composants montés (`mjs-*`) dans l'ombre de `racine`, dans l'ordre du document
export const balises = (racine: any): string[] => [...racine._shadow.querySelectorAll('*')].map((n: any) => n.localName).filter((n: string) => n.startsWith('mjs-'))
