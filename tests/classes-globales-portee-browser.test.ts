// Classes globales en navigateur réel — la portée de la classe vaut pour tout son corps : la même suite de lectures et d'écritures
// faites dehors (`µ.App.x`, méthode détachée, état écrit dedans puis lu dehors et l'inverse, paramètre qui cache le membre, rune µ dans
// une méthode, une classe qui en cite une autre) rend le même résultat en développement, en développement minifié, en production (un
// fichier, fichiers séparés) et au rendu du serveur, dans Chromium, Firefox et WebKit
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'
import { SOURCES, ATTENDU } from './helpers/classes-globales-portee.js'

const LIRE = `document.querySelector('mjs-p-home')?._shadow?.querySelector('.r')?.textContent ?? ''`
const PRET = `(document.querySelector('mjs-p-home')?._shadow?.querySelector('.r')?.textContent ?? '').length > 2`

// le développement minifié : la page charge le manifeste comme en production
async function construireMinifie(): Promise<Cible> {
  const root   = mjsTmp('classes-portee-min')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
  const b     = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), minify: true, urlPrefix: '/out' })
  const stats = await b.compile()
  await b.close()
  if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
  return { mode: 'bundle', racine: root, document: (balise) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><${balise}></${balise}><script type="module" src="/out/bundle.js"></script></body></html>` }
}

describe('classes globales en navigateur : la portée de la classe, sans `@`', function () {
  this.timeout(180000)
  const cibles: Record<string, Cible> = {}

  before(async () => {
    for (const mode of ['dev-parents-avant', 'bundle', 'split', 'ssr'] as Mode[]) cibles[mode] = await construire(mode, SOURCES, ['mjs-p-home'])
    cibles['dev-minifie'] = await construireMinifie()
  })

  after(async () => { await terminateSharedWorkerPool() })

  it('rendu du serveur : le composant lit la classe', () => {
    const html = cibles.ssr.document('mjs-p-home', 'markers')
    for (const texte of ['HEARTWORK — LOVE, DEEPER.', 'Carte Heartwork', 'texte NAME Heartwork', 'contact@heartwork.test']) assert.ok(html.includes(texte), `${texte} dans le rendu du serveur`)
  })

  for (const nom of ['chromium', 'firefox', 'webkit']) it(`${nom} : développement, développement minifié, production, rendu du serveur`, async function () {
    const playwright: any = await import('playwright')
    const browser = await playwright[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
    const ecarts: string[] = []
    try {
      for (const [mode, variante] of [['dev-parents-avant', ''], ['dev-minifie', ''], ['bundle', ''], ['split', ''], ['ssr', 'markers']]) {
        const o = await charger(browser, cibles[mode], 'mjs-p-home', variante)
        try {
          await o.page.waitForFunction(PRET, null, { timeout: 15000 }).catch(() => undefined)
          const vu = await o.page.evaluate(LIRE)
          if (vu !== JSON.stringify(ATTENDU)) ecarts.push(`${mode} ${vu} ${o.erreurs.join(' | ')}`)
        }
        finally {
          await o.fermer()
        }
      }
    }
    finally {
      await browser.close()
    }
    assert.deepEqual(ecarts, [])
  })
})
