// L'atelier /__mjs/theme dans une application qui n'emploie ni mutation profonde, ni liste, ni bloc {if}, ni crochet
// de vie : le cœur que l'application sert ne porte pas ces fonctions, et l'atelier, compilé à la volée par le serveur
// de développement, les appelle. Chaque ligne du registre se déplie, sans aucune erreur dans la page.
// Le vrai serveur de développement (StaticServer sur le build de l'application), Chromium et Firefox réels.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'
import { StaticServer } from '../src/server/index.js'

// aucune mutation profonde, aucune liste, aucun {if}, aucun événement : un composant statique et son thème
const HOTE = [
  '<theme>',
  '  $$gap:   12px',
  '  $$ton:   #ff0066',
  '  $$trait: 2px',
  '</theme>',
  '<div class="bloc">Bonjour</div>',
  '<style>',
  '  .bloc',
  '    gap: $$gap',
  '    color: $$ton',
  '    border: var(--mjs-trait, 1px) solid',
  '    padding: var(--mjs-marge, 4px)',
  '</style>',
  ''
].join('\n')

for (const nom of ['chromium', 'firefox'] as const) describe(`atelier /__mjs/theme dans une application sans mutation profonde (${nom} réel)`, function () {
  this.timeout(180000)
  let present = false
  let browser: any
  let serveur: StaticServer | null = null
  let base = ''

  before(async () => {
    const playwright = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) return
    const root   = mjsTmp('atelier-sans-deep')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), HOTE)
    // le registre ne lit que les variables des modules joints au cœur, et l'application du test n'en emploie aucun : 'all' les joint tous, pour que le registre ait au moins dix lignes à déplier
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', urlPrefix: '/out', defaultScriptLang: 'civet', lint: { a11y: false }, runtime: 'all' }))
    const found = findConfig(root)
    assert.ok(found, 'mjs.config.json doit être trouvé')
    const bundler = new Bundler(resolveBundlerOpts(found!.config, found!.configDir) as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    serveur = new StaticServer({ rootDir: join(root, 'out'), pathPrefix: '/out', port: 0, host: '127.0.0.1', manifestPath: bundler.manifestPath, projectRoot: root })
    await serveur.start()
    base    = `http://127.0.0.1:${(serveur.server!.address() as any).port}`
    browser = await playwright[nom].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    if (serveur) await serveur.stop()
    await terminateSharedWorkerPool()
  })

  it('toutes les lignes se déplient, sans aucune erreur', async function () {
    if (!present) return this.skip()
    const page    = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    const erreurs: string[] = []
    page.on('pageerror', (e: any) => erreurs.push('page : ' + e.message))
    page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push('console : ' + m.text().slice(0, 200)) })
    await page.goto(base + '/__mjs/theme')
    // l'atelier a une coque fermée : on passe par la propriété `_shadow` du composant
    const lignes = () => page.evaluate(`document.querySelector('mjs-theme-viewer')?._shadow?.querySelectorAll('.variable').length ?? 0`)
    await page.waitForFunction(`(document.querySelector('mjs-theme-viewer')?._shadow?.querySelectorAll('.variable').length ?? 0) > 0`, null, { timeout: 30000 }).catch(() => {})
    assert.deepEqual(erreurs, [], 'l\'atelier se monte sans erreur')
    const total = await lignes()
    assert.ok(total >= 10, `le registre est affiché : ${total} lignes`)
    // on clique chaque ligne dont le détail est encore fermé, comme l'utilisateur qui déplie tout
    for (let i = 0; i < total; i++) {
      await page.evaluate(`(() => { const l = document.querySelector('mjs-theme-viewer')._shadow.querySelectorAll('.variable')[${i}]; if (!l.querySelector('.detail')) l.querySelector('.nom').click() })()`)
      await page.waitForTimeout(30)
    }
    await page.waitForTimeout(400)
    const details = await page.evaluate(`document.querySelector('mjs-theme-viewer')._shadow.querySelectorAll('.variable .detail').length`)
    assert.deepEqual(erreurs, [], 'aucune ligne ne lève d\'erreur au dépliage')
    assert.equal(details, total, 'chaque ligne a déplié son détail')
    await page.close()
  })
})
