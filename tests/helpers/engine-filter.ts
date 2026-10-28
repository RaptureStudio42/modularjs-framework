// MJS_MOTEURS : les moteurs de Playwright que les tests lancent vraiment — `chromium`, `firefox`, `webkit` (plusieurs :
// séparés par une virgule ou une espace) ou `tous`, le défaut quand la variable manque. Les fichiers de test lancent
// leur navigateur eux-mêmes, chacun à sa façon (près de 500 fichiers) : la règle se pose donc une fois, ici, sur les
// lanceurs de Playwright. Le lancement d'un moteur écarté SAUTE le test ou le crochet en cours (mocha le compte
// « pending ») au lieu d'ouvrir le navigateur ; un crochet `before` sauté saute toute sa suite.
// Un fichier qui EXIGE d'autres moteurs le dit par une ligne `// moteurs exigés : firefox webkit` (ou `tous`) : ses
// lancements de ces moteurs passent toujours

import { readFileSync } from 'node:fs'
import { currentRunnable, currentTestFile, noteEngineSkip } from './test-trace.js'

export const ENGINES = ['chromium', 'firefox', 'webkit']

const DECLARATION = /^[ \t]*\/\/[ \t]*moteurs exigés[ \t]*:[ \t]*(.+)$/m

// liste de moteurs → ensemble ; null = tous ; un nom inconnu est refusé tout haut (un filtre muet ne jouerait rien)
export function parseEngines(value: string | undefined | null): Set<string> | null {
  const words = (value ?? '').toLowerCase().split(/[\s,]+/).filter(Boolean)
  if (!words.length || words.includes('tous')) return null
  for (const w of words) {
    if (!ENGINES.includes(w)) throw new Error(`MJS_MOTEURS : moteur inconnu « ${w} » (attendu : chromium, firefox, webkit ou tous)`)
  }
  return new Set(words)
}

// moteurs déclarés exigés par un source de test : undefined sans déclaration, null pour `tous`
export function declaredEngines(source: string): Set<string> | null | undefined {
  const m = DECLARATION.exec(source)
  return m ? parseEngines(m[1].replace(/\/\/.*$/, '')) : undefined
}

const declared = new Map<string, Set<string> | null | undefined>()

function declaredFor(file: string | undefined): Set<string> | null | undefined {
  if (!file) return undefined
  if (!declared.has(file)) {
    let found: Set<string> | null | undefined
    try { found = declaredEngines(readFileSync(file, 'utf-8')) } catch { found = undefined }
    declared.set(file, found)
  }
  return declared.get(file)
}

const skipped = new Map<string, number>()
let wanted: Set<string> | null = null

function guard(type: any, name: string): void {
  if (!type || type.__mjsEngineFilter) return
  type.__mjsEngineFilter = true
  for (const method of ['launch', 'launchPersistentContext', 'launchServer']) {
    const original = type[method]
    if (typeof original !== 'function') continue
    type[method] = function (this: unknown, ...args: any[]) {
      const own = declaredFor(currentTestFile())
      if (!wanted || wanted.has(name) || own === null || own?.has(name)) return original.apply(this, args)
      const runnable = currentRunnable()
      skipped.set(name, (skipped.get(name) ?? 0) + 1)
      if (runnable) {
        noteEngineSkip(runnable, name)
        try { runnable.skip() } catch (pending) { return Promise.reject(pending) }
      }
      return Promise.reject(new Error(`moteur ${name} écarté par MJS_MOTEURS=${process.env.MJS_MOTEURS} : lancé hors d'un test ou d'un crochet, rien à sauter`))
    }
  }
}

// pose le filtre si MJS_MOTEURS écarte un moteur ; sans Playwright installé, rien à garder
export async function installEngineFilter(env: Record<string, string | undefined> = process.env): Promise<void> {
  wanted = parseEngines(env.MJS_MOTEURS)
  if (!wanted) return
  let playwright: any
  try { playwright = await import('playwright') } catch { return }
  for (const name of ENGINES) guard(playwright[name] ?? playwright.default?.[name], name)
}

// une ligne de bilan pour la fin du passage, vide si rien n'a été écarté
export function engineFilterReport(): string {
  if (!wanted || !skipped.size) return ''
  const detail = [...skipped].map(([n, c]) => `${n} ${c}`).join(', ')
  return `MJS_MOTEURS=${process.env.MJS_MOTEURS} : ${[...skipped.values()].reduce((a, b) => a + b, 0)} lancement(s) écarté(s) (${detail}), tests ou crochets sautés — MJS_MOTEURS=tous pour les trois moteurs`
}
