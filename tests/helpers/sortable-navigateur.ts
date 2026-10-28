// aides communes aux essais de `<@@sortable>` en vrai navigateur : une appli construite avec le vrai Bundler (développement : les fichiers
// bout à bout dans la page ; production : le build tel qu'il part, en modules servis sous /out), ouverte dans Chromium, Firefox ou WebKit

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { mjsTmp } from './tmp.js'
import { libellesDuManifeste } from './libelles-manifeste.js'
import { Bundler, terminateSharedWorkerPool } from '../../src/bundler/index.js'
import { stripEsm } from '../../src/server/renderToString.js'

export type Navigateur = 'chromium' | 'firefox' | 'webkit'

export const NAVIGATEURS: Navigateur[] = ['chromium', 'firefox', 'webkit']

export async function navigateurPresent(nom: Navigateur): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

export async function lancer(nom: Navigateur): Promise<any> {
  return (await import('playwright'))[nom].launch()
}

export const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function fermer(): Promise<void> {
  await terminateSharedWorkerPool()
}

export async function construire(etiquette: string, sources: Record<string, string>, prod: boolean): Promise<{ root: string, script: string }> {
  const root   = mjsTmp(etiquette + '-' + (prod ? 'prod' : 'dev'))
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [n, source] of Object.entries(sources)) writeFileSync(join(srcDir, n), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(prod ? outDir : root, 'bundle.js'), ...(prod ? { env: 'prod', js: 'split', urlPrefix: '/out' } : {}) } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  if (prod) return { root, script: '' }
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  // le cœur et ses parties (`mjs_…`) dans la portée commune ; chaque composant (un module du cœur, la page) dans un bloc à lui, comme au vrai
  // chargement où chaque fichier est un module : `<@@select>` sans `other` et la barre d'outils de `<@@editor>` déclarent chacun `told` au
  // niveau du module, et une seule portée les ferait se heurter (`SyntaxError`, la page ne démarre pas)
  const code  = (f: string) => { const c = stripEsm(readFileSync(join(outDir, f), 'utf-8')); return f.startsWith('mjs_') ? c : `{\n${c}\n}` }
  return { root, script: [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map(code).join('\n') + '\nglobalThis.µ = µ;\n' + libellesDuManifeste(join(root, 'bundle.js')) }
}

export type Options = { lang?: string, viewport?: { width: number, height: number }, reducedMotion?: boolean, listes?: number, script?: string }

// ouvre la page `tag` dans un contexte neuf ; `fn` s'exécute, puis le contexte se ferme et aucune erreur de page ne doit rester
export async function essayer(browser: any, built: { root: string, script: string }, prod: boolean, tag: string, fn: (page: any, tag: string) => Promise<void>, opts: Options = {}): Promise<void> {
  const context = await browser.newContext({ viewport: opts.viewport ?? { width: 800, height: 600 }, ...(opts.reducedMotion ? { reducedMotion: 'reduce' } : {}) })
  try {
    const page = await context.newPage()
    page.setDefaultTimeout(5000)
    page.setDefaultNavigationTimeout(30000)
    const erreurs: string[] = []
    const avis: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e)))
    page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') avis.push(m.text().slice(0, 300)) })
    await page.addInitScript('window.__name = function (f) { return f };')
    if (opts.script) await page.addInitScript(opts.script)
    const charge = prod ? '<script type="module" src="/out/bundle.js"></script>' : `<script>${built.script}</script>`
    await page.route('http://t.test/**', (route: any) => {
      const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
      if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="${opts.lang ?? 'fr'}"><head><meta charset="utf-8"></head><body style="margin:0"><${tag}></${tag}>${charge}</body></html>` })
      const fichier = join(built.root, normalize(chemin))
      if (prod && chemin.startsWith('/out/') && existsSync(fichier)) return route.fulfill({ contentType: chemin.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json', body: readFileSync(fichier) })
      return route.fulfill({ status: 404, body: '' })
    })
    await page.goto('http://t.test/', { waitUntil: 'load' })
    try {
      await page.waitForFunction(([t, n]: any) => { const ls = (document.querySelector(t) as any)?._shadow?.querySelectorAll('mjs-core-sortable'); return !!ls && ls.length >= n && [...ls].every((l: any) => l._shadow?.querySelector('slot')) }, [tag, opts.listes ?? 1], { timeout: 15000 })
    } catch {
      throw new Error(`la page ${tag} ne démarre pas : ${erreurs.join(' | ') || 'aucune erreur de page'} / console : ${avis.join(' | ')}`)
    }
    await page.waitForTimeout(250)
    try {
      await fn(page, tag)
    } catch (e: any) {
      e.message += ` / erreurs de page : ${erreurs.join(' | ') || 'aucune'} / console : ${avis.join(' | ') || 'rien'}`
      throw e
    }
    assert.deepEqual(erreurs, [], 'aucune erreur de page')
  } finally {
    await context.close()
  }
}

export const STYLE = `<style>
  :host
    display: block
  .cols
    display: flex
    gap: 60px
  .la
    width: 220px
  .lb
    width: 220px
  .ligne
    display: flex
    align-items: center
    gap: 8px
    box-sizing: border-box
    height: 44px
    margin-bottom: 6px
    padding: 0 10px
    border: 1px solid #999
    background: #fff
  .t
    flex: 1
  .large
    width: 2400px
    height: 1px
</style>`

export const lignes = (page: any, tag: string) => page.evaluate((t: string) => [...(document.querySelector(t) as any)._shadow.querySelectorAll('.ligne')].map((n: any) => ({ id: n.dataset.id as string, etat: n.getAttribute('mjs-sortable') as string | null, dy: n.style.getPropertyValue('--mjs-sortable-dy') as string, style: n.getAttribute('style') as string | null })), tag) as Promise<Array<{ id: string, etat: string | null, dy: string, style: string | null }>>
export const marquees = async (page: any, tag: string) => (await lignes(page, tag)).filter((l) => l.etat !== null || l.dy !== '' || l.style !== null).map((l) => l.id + ':' + (l.etat ?? '-'))
// les marques du geste partent à l'image qui suit sa fin : on attend cette image (WebKit sans tête la fait parfois attendre plus d'une demi-seconde)
export async function repos(page: any, tag: string, message: string): Promise<void> {
  let restes = await marquees(page, tag)
  for (let i = 0; i < 40 && restes.length > 0; i++) {
    await page.waitForTimeout(100)
    restes = await marquees(page, tag)
  }
  assert.deepEqual(restes, [], message)
}
export const texte = (page: any, tag: string, cls: string) => page.evaluate(([t, c]: string[]) => (document.querySelector(t) as any)._shadow.querySelector('p.' + c).textContent as string, [tag, cls]) as Promise<string>
export const sorts = async (page: any, tag: string) => { const s = await texte(page, tag, 'sorts'); return s === '' ? [] : s.split('|').map((x) => JSON.parse(x)) }
export const centre = (page: any, tag: string, q: string) => page.evaluate(([t, s]: string[]) => { const r = (document.querySelector(t) as any)._shadow.querySelector(s).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } }, [tag, q]) as Promise<{ x: number, y: number }>
export const actif = (page: any, tag: string) => page.evaluate((t: string) => { const a = (document.querySelector(t) as any)._shadow.activeElement; return a ? (a.dataset?.id ?? a.className ?? a.tagName) : null }, tag) as Promise<string | null>
export const focaliser = (page: any, tag: string, q: string) => page.evaluate(([t, s]: string[]) => (document.querySelector(t) as any)._shadow.querySelector(s).focus(), [tag, q])
export const style = (page: any, tag: string, q: string, prop: string) => page.evaluate(([t, s, p]: string[]) => getComputedStyle((document.querySelector(t) as any)._shadow.querySelector(s)).getPropertyValue(p), [tag, q, prop]) as Promise<string>
