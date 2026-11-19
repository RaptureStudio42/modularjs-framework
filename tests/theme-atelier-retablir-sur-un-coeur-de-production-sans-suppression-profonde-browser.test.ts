// L'atelier /__mjs/theme servi sur le cœur de PRODUCTION d'une application qui écrit en profondeur sans jamais supprimer : ce cœur ne
// porte pas la suppression profonde (`delete $o.a`), et l'atelier, compilé à la volée, l'appelle quand on rétablit une variable modifiée.
// La page l'apporte : une couleur modifiée puis rétablie, sans aucune erreur. Le registre des variables est celui d'une construction de
// développement de la même application (une construction de production n'en écrit pas).
// Le vrai serveur de développement (StaticServer sur le build de production), Chromium, Firefox et WebKit réels.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, existsSync, copyFileSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { StaticServer } from '../src/server/index.js'

// un composant et son thème, et un composant qui écrit en profondeur sans rien supprimer ; sa valeur dérivée garde au cœur de production la
// machinerie des valeurs dérivées, que l'atelier emploie et que sa page ne peut pas apporter
const HOTE = [
  '<theme>',
  '  $$ton: #ff0066',
  '</theme>',
  '<div class="bloc">Bonjour</div>',
  '<style>',
  '  .bloc',
  '    color: $$ton',
  '</style>',
  ''
].join('\n')
const PROFONDE = ['<script>', '$o = {a: 1}', '$n = 1', '$double = $n * 2', '@changer = -> $o.a = 2', '</script>', '<p>{$o.a} {$double}</p>', ''].join('\n')

describe('atelier /__mjs/theme sur un cœur de production sans suppression profonde', function () {
  this.timeout(240000)
  let serveur: StaticServer | null = null
  let base = ''

  before(async () => {
    const root   = mjsTmp('atelier-prod-sans-delete')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), HOTE)
    writeFileSync(join(srcDir, 'carte-profonde.mjs'), PROFONDE)
    const construire = async (outDir: string, plus: Record<string, unknown>): Promise<string> => {
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', defaultScriptLang: 'civet', lint: { a11y: false }, ...plus } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      return bundler.manifestPath
    }
    await construire(join(root, 'dev'), {})
    const outDir    = join(root, 'out')
    const manifeste = await construire(outDir, { env: 'prod', minify: false })
    const coeur     = (readdirSync(outDir, { recursive: true }) as string[]).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(outDir, f), 'utf-8')).join('\n')
    assert.match(coeur, /µ\._mjs_deepSet = function/, 'garde muette : ce cœur de production écrit en profondeur')
    assert.match(coeur, /_mjs_setComputed = function/, 'garde muette : il porte les valeurs dérivées')
    assert.doesNotMatch(coeur, /µ\._mjs_deepDelete = function/, 'garde muette : il ne porte pas la suppression profonde')
    assert.ok(existsSync(join(root, 'dev', '.mjs-theme-vars.json')), 'garde muette : la construction de développement écrit le registre')
    copyFileSync(join(root, 'dev', '.mjs-theme-vars.json'), join(outDir, '.mjs-theme-vars.json'))
    // `hmr` : le canal de l'aperçu en direct, sans lequel l'atelier n'offre aucune couleur à modifier
    serveur = new StaticServer({ rootDir: outDir, pathPrefix: '/out', port: 0, host: '127.0.0.1', hmr: true, manifestPath: manifeste, projectRoot: root })
    await serveur.start()
    base = `http://127.0.0.1:${(serveur.server!.address() as any).port}`
  })

  after(async () => {
    if (serveur) await serveur.stop()
    await terminateSharedWorkerPool()
  })

  for (const moteur of ['chromium', 'firefox', 'webkit'] as const) {
    it(`${moteur} : une couleur modifiée puis rétablie, sans aucune erreur`, async function () {
      const playwright: any = await import('playwright')
      if (!existsSync(playwright[moteur].executablePath())) this.skip()
      const navigateur = await playwright[moteur].launch()
      try {
        const page = await navigateur.newPage({ viewport: { width: 1280, height: 900 } })
        const erreurs: string[] = []
        page.on('pageerror', (e: any) => erreurs.push('page : ' + e.message))
        page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push('console : ' + m.text().slice(0, 200)) })
        await page.goto(base + '/__mjs/theme')
        // l'atelier a une coque fermée : on passe par la propriété `_shadow` du composant
        const compte = (sel: string) => page.evaluate(`document.querySelector('mjs-theme-viewer')?._shadow?.querySelectorAll(${JSON.stringify(sel)}).length ?? 0`)
        const attendre = (sel: string, n: number) => page.waitForFunction(`(document.querySelector('mjs-theme-viewer')?._shadow?.querySelectorAll(${JSON.stringify(sel)}).length ?? 0) === ${n}`, null, { timeout: 30000 }).catch(() => {})
        await attendre('input.swatch.live', 1)
        assert.deepEqual(erreurs, [], 'l\'atelier se monte sans erreur')
        assert.equal(await compte('input.swatch.live'), 1, 'garde muette : la couleur du thème se modifie en direct')
        await page.evaluate(`(() => { const c = document.querySelector('mjs-theme-viewer')._shadow.querySelector('input.swatch.live'); c.value = '#00ff00'; c.dispatchEvent(new Event('input', { bubbles: true })) })()`)
        await attendre('button.restore', 1)
        assert.equal(await compte('button.restore'), 1, 'garde muette : la couleur modifiée se rétablit par son bouton')
        await page.evaluate(`document.querySelector('mjs-theme-viewer')._shadow.querySelector('button.restore').click()`)
        await attendre('button.restore', 0)
        await page.waitForTimeout(200)
        assert.deepEqual(erreurs, [], 'rétablir ne lève aucune erreur')
        assert.equal(await compte('button.restore'), 0, 'la couleur est rétablie')
      }
      finally {
        await navigateur.close()
      }
    })
  }
})
