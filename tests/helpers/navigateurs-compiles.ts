// compile des sources `.mjs` en un script de page (runtime d'abord) et ouvre une page par moteur de Playwright, pour
// les tests de comportement au navigateur réel sur Chromium, Firefox et WebKit
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './tmp.js'
import { Bundler } from '../../src/bundler/index.js'
import { stripEsm } from '../../src/server/renderToString.js'

export type Moteur = 'chromium' | 'firefox' | 'webkit'
export const MOTEURS: Moteur[] = ['chromium', 'firefox', 'webkit']

export async function moteurPresent(nom: Moteur): Promise<boolean> {
  try {
    const playwright: any = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

export async function compilerScript(nom: string, sources: Record<string, string>): Promise<string> {
  const root   = mjsTmp(nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [fichier, source] of Object.entries(sources)) writeFileSync(join(srcDir, fichier), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const ordre = [...files.filter((f) => f.startsWith('mjs_')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
  return ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
}

// cherche dans la page et dans toutes les ombres des composants (`_shadow`), en partant d'une balise
export const OUTILS_PAGE = `
  window.__ordre = []
  window.__note = (x) => window.__ordre.push(x)
  window.__trouve = (depart, sel) => {
    const file = [depart]
    while (file.length) {
      const r = file.shift()
      const hit = r.querySelector(sel)
      if (hit) return hit
      for (const el of r.querySelectorAll('*')) if (el._shadow && el._shadow !== el) file.push(el._shadow)
      if (r._shadow && r._shadow !== r && !file.includes(r._shadow)) file.push(r._shadow)
    }
    return null
  }
  window.__clic = (hote, sel) => { window.__ordre = []; window.__trouve(document.querySelector(hote), sel).click(); return window.__ordre.slice() }
`

// une page servie à une vraie adresse (`http://mjs.test/`, un lien y navigue), le script compilé dedans
export async function ouvrirPage(nom: Moteur, corps: string, script: string): Promise<{ browser: any, page: any, erreurs: string[] }> {
  const playwright: any = await import('playwright')
  const browser = await playwright[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
  const page    = await browser.newPage()
  const erreurs: string[] = []
  page.on('pageerror', (e: any) => erreurs.push(String(e)))
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>${corps}<script>${OUTILS_PAGE}</script><script>${script}</script></body></html>`
  await page.route('http://mjs.test/**', (route: any) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }))
  await page.goto('http://mjs.test/')
  return { browser, page, erreurs }
}
