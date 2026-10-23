// harnais des modules cœur : un hôte `.mjs` compilé par le vrai Bundler (build de développement),
// puis monté dans happy-dom — le cœur, les modules `<@@nom>` qu'il appelle et l'hôte, dans cet ordre.
// Les appels à µ.error sont recueillis (texte seul) au lieu d'aller à la console.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler } from '../../src/bundler/index.js'
import { stripEsm } from '../../src/server/renderToString.js'
import { mjsTmp } from './tmp.js'

export async function attendre(cond: () => boolean, ms = 3000): Promise<void> {
  const fin = Date.now() + ms
  while(!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

export const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function monterHote(source: string, prefixe: string): Promise<{ window: any; hote: any; erreurs: string[] }> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hote.mjs'), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
  const code  = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  window.eval(`${code}\nglobalThis.µ = µ;\nglobalThis.__erreurs = [];\nµ.error = function(...a) { globalThis.__erreurs.push(a.map(String).join(' ')); };`)
  window.document.body.innerHTML = '<mjs-hote></mjs-hote>'
  const hote = window.document.querySelector('mjs-hote')
  await attendre(() => !!hote._shadow)
  await pause(120)
  return { window, hote, erreurs: window.eval('globalThis.__erreurs') }
}
