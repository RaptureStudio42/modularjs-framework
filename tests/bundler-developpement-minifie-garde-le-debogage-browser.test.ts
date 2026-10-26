// En développement, `"minify": true` ne fait que minifier : les outils de débogage restent, et le build le dit
//
// Défaut : la minification d'un build de développement appliquait les règles de la production. La lecture de `µ.debug`
// du cœur partait (`µ.debug = true` tapé dans la console ne faisait plus rien) et la liste `pure` du niveau de production
// retirait les `console.log` et `console.warn` du bundle, celui du corps de `µ.log` compris : le `µ.log` de l'appli,
// ses avertissements et les valeurs de `µinspect` ne s'écrivaient plus, même au niveau 'log'. Le bandeau du build
// annonçait « non minifié » sur un fichier minifié.
//
// Navigateur réel (Chromium) : la même appli construite en développement minifié (fichiers séparés et fichier unique),
// en développement lisible et en production (témoins). Puis la CLI : le bandeau dit l'état réel de la minification.

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json' }

const SONDE = [
  '<script>',
  '$count = 0',
  'µinspect $count',
  'µmount ->',
  '  $count = 1',
  '  µ.log "sonde : µ.log de l appli"',
  '  µ.warn "sonde : µ.warn de l appli"',
  '</script>',
  '<p>compte {$count}</p>',
].join('\n')

// les variantes construites : options du Bundler
const VARIANTES: Record<string, Record<string, unknown>> = {
  'dev-minifie':         { minify: true },
  'dev-minifie-unique':  { minify: true, js: 'bundle' },
  // niveau muet en développement, rien de retiré en production : seul `µ.debug = true` peut rendre la parole à `µ.log`
  'dev-minifie-muet':    { minify: true, logLevel: { dev: 'silent', prod: 'log' } },
  'dev':                 {},
  'dev-muet':            { logLevel: { dev: 'silent', prod: 'log' } },
  'prod':                { env: 'prod' },
}

// le texte de la page, racines fantômes des composants comprises (`_shadow`), cherché dans le navigateur
const contient = (texte: string) => `(() => { let t = ''; const p = (n) => { const r = n._shadow || n.shadowRoot; if (r && r !== n) p(r); for (const c of n.childNodes) { if (c.nodeType === 3) t += c.textContent; else p(c) } }; p(document.body); return t.includes(${JSON.stringify(texte)}) })()`

// les bandeaux `// === mjs_xxx.ts ===` de la concaténation ne survivent pas à la minification
const estMinifie = (code: string) => !code.includes('// === mjs_element.ts ===') && !code.includes('µ.Element = class Element')

describe('développement minifié — les outils de débogage restent (navigateur réel)', function () {
  this.timeout(240000)

  let browser: Browser | null = null
  let server: Server | null = null
  let origin = ''
  let dist   = ''

  before(async () => {
    const root   = mjsTmp('dev-minifie-debogage')
    const srcDir = join(root, 'src')
    dist = join(root, 'dist')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'sonde-debug.mjs'), SONDE + '\n')
    for (const [nom, options] of Object.entries(VARIANTES)) {
      const sortie  = join(dist, nom)
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(sortie, 'assets'), manifestPath: join(sortie, 'assets', 'bundle.js'), urlPrefix: `/${nom}/assets`, ...options } as any)
      const stats   = await bundler.compile()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      await bundler.close()
      writeFileSync(join(sortie, 'index.html'), `<!doctype html><html lang="fr"><head><meta charset="utf-8"><script type="module" src="assets/bundle.js"></script></head><body><mjs-sonde-debug></mjs-sonde-debug></body></html>`)
    }
    server = createServer((req, res) => {
      const url     = (req.url ?? '').split('?')[0]
      const fichier = join(dist, url.endsWith('/') ? url + 'index.html' : url)
      if (!fichier.startsWith(dist) || !existsSync(fichier)) { res.writeHead(404); res.end('introuvable'); return }
      res.writeHead(200, { 'content-type': TYPES[extname(fichier)] ?? 'application/octet-stream' })
      res.end(readFileSync(fichier))
    })
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()))
    origin  = 'http://127.0.0.1:' + (server!.address() as any).port
    browser = await chromium.launch()
  })

  after(async () => {
    if (browser) await browser.close()
    if (server) await new Promise((resolve) => server!.close(() => resolve(null)))
    await terminateSharedWorkerPool()
  })

  // le cœur de la variante (fichiers séparés) ou son fichier unique
  function coeur(nom: string): string {
    const assets  = join(dist, nom, 'assets')
    const fichier = readdirSync(assets).find((f) => /^mjs_core-.*\.js$/.test(f)) ?? 'bundle.js'
    return readFileSync(join(assets, fichier), 'utf-8')
  }

  // la visite : le composant monté, puis `µ.debug = true` et un `µ.log` tapés dans la console ; rend ce que la console a reçu
  async function visite(nom: string): Promise<{ avant: string[], apres: string[], erreurs: string[], muExpose: boolean }> {
    const page = await browser!.newPage()
    const logs: string[]    = []
    const erreurs: string[] = []
    page.on('console', (m) => { logs.push(m.text()) })
    page.on('pageerror', (e) => { erreurs.push(String(e)) })
    await page.goto(`${origin}/${nom}/`)
    try { await page.waitForFunction(contient('compte 1'), undefined, { timeout: 15000 }) }
    catch { throw new Error(`le composant ne s'affiche pas — erreurs : ${erreurs.join(' | ')} — console : ${logs.join(' | ')}`) }
    const avant    = [...logs]
    const muExpose = await page.evaluate(() => typeof (window as any).µ === 'object')
    if (muExpose) await page.evaluate(() => { const µ = (window as any).µ; µ.debug = true; µ.log('sonde : µ.log de la console après µ.debug = true') })
    await page.close()
    return { avant, apres: logs.slice(avant.length), erreurs, muExpose }
  }

  const ecrit   = (logs: string[], texte: string) => logs.some((l) => l.includes(texte))
  const valeurs = (logs: string[]) => logs.filter((l) => /^%c(From|To)\s*:/.test(l))

  for (const nom of ['dev-minifie', 'dev-minifie-unique']) {
    it(`${nom} : le fichier est minifié, et le µ.log de l'appli, son avertissement, les valeurs de µinspect s'écrivent`, async () => {
      assert.ok(estMinifie(coeur(nom)), '`minify: true` minifie toujours')
      const { avant, erreurs, muExpose } = await visite(nom)
      assert.deepEqual(erreurs, [])
      assert.ok(muExpose, 'window.µ est exposé en développement')
      assert.ok(ecrit(avant, 'sonde : µ.log de l appli'), `AVANT le correctif : la liste pure de la production retirait le console.log du corps de µ.log — console : ${avant.join(' | ')}`)
      assert.ok(ecrit(avant, 'sonde : µ.warn de l appli'), `l'avertissement de l'appli s'écrit en développement — console : ${avant.join(' | ')}`)
      assert.deepEqual(valeurs(avant).map((l) => l.slice(-1)), ['0', '1'], `µinspect écrit l'ancienne et la nouvelle valeur — console : ${avant.join(' | ')}`)
    })
  }

  it('dev-minifie-muet : µ.debug = true tapé dans la console rend la parole à µ.log', async () => {
    assert.ok(estMinifie(coeur('dev-minifie-muet')))
    const { avant, apres, erreurs, muExpose } = await visite('dev-minifie-muet')
    assert.deepEqual(erreurs, [])
    assert.ok(muExpose)
    assert.equal(ecrit(avant, 'sonde : µ.log de l appli'), false, 'le niveau muet du développement fait taire µ.log')
    assert.ok(ecrit(apres, 'après µ.debug = true'), `AVANT le correctif : la lecture de µ.debug était retirée du cœur, la bascule restait sans effet — console : ${apres.join(' | ')}`)
  })

  it('témoin, développement lisible : les mêmes outils, la même bascule', async () => {
    assert.equal(estMinifie(coeur('dev')), false)
    const lisible = await visite('dev')
    assert.deepEqual(lisible.erreurs, [])
    assert.ok(ecrit(lisible.avant, 'sonde : µ.log de l appli') && ecrit(lisible.avant, 'sonde : µ.warn de l appli'))
    assert.deepEqual(valeurs(lisible.avant).map((l) => l.slice(-1)), ['0', '1'])
    const muet = await visite('dev-muet')
    assert.equal(ecrit(muet.avant, 'sonde : µ.log de l appli'), false)
    assert.ok(ecrit(muet.apres, 'après µ.debug = true'))
  })

  it('témoin, production : minifiée, ni window.µ, ni µ.log, ni avertissement, ni valeur de µinspect', async () => {
    assert.ok(estMinifie(coeur('prod')))
    assert.equal(coeur('prod').includes('MJS_DEBUG'), false, 'les lectures de µ.debug du cœur sont parties à la compilation')
    const { avant, erreurs, muExpose } = await visite('prod')
    assert.deepEqual(erreurs, [])
    assert.equal(muExpose, false)
    assert.equal(ecrit(avant, 'sonde : µ.log de l appli'), false)
    assert.equal(ecrit(avant, 'sonde : µ.warn de l appli'), false)
    assert.deepEqual(valeurs(avant), [])
  })
})

// ---------------------------------------------------------------------------------------------
// le bandeau de `mjs build` dit si le fichier est minifié — sous-processus réel, comme tests/cli-env-commande.test.ts

/** Projet jetable : un composant, et le mjs.config.json demandé. */
function projet(etiquette: string, config: Record<string, unknown>): string {
  const root = mjsTmp(etiquette)
  mkdirSync(join(root, 'app', 'modularjs'), { recursive: true })
  writeFileSync(join(root, 'app', 'modularjs', 'hello.mjs'), '<p>hi</p>\n')
  writeFileSync(join(root, 'mjs.config.json'), `${JSON.stringify(config, null, 2)}\n`)
  return root
}

/** `mjs build` sur un projet jetable : le bandeau, et l'état du mjs_core-*.js écrit. */
function build(root: string, flags: string[] = []): { bandeau: string, minifie: boolean } {
  const r = spawnSync('npx', ['tsx', 'src/cli.ts', 'build', '--root', root, ...flags], { cwd: repoRoot, encoding: 'utf-8', timeout: 120000 })
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`)
  const outDir  = join(root, 'public', 'modularjs')
  const fichier = readdirSync(outDir).find((f) => /^mjs_core-/.test(f))
  assert.ok(fichier, `aucun mjs_core-*.js dans ${outDir}`)
  const bandeau = (r.stdout ?? '').split('\n').find((l) => /Build de (DÉVELOPPEMENT|PRODUCTION)/.test(l)) ?? ''
  return { bandeau, minifie: estMinifie(readFileSync(join(outDir, fichier!), 'utf-8')) }
}

describe('cli.ts — le bandeau du build dit si le fichier est minifié', function () {
  this.timeout(240000)

  it('développement avec `"minify": true` : « minifié », et il l\'est', () => {
    const { bandeau, minifie } = build(projet('bandeau-dev-minifie', { minify: true }))
    assert.ok(minifie)
    assert.match(bandeau, /Build de DÉVELOPPEMENT \([^)]*\) — minifié,/, `AVANT le correctif : « non minifié » sur un fichier minifié — ${bandeau}`)
  })

  it('production avec `"minify": false` : « non minifié », et il ne l\'est pas', () => {
    const { bandeau, minifie } = build(projet('bandeau-prod-lisible', { minify: false }), ['--prod'])
    assert.equal(minifie, false)
    assert.match(bandeau, /Build de PRODUCTION \([^)]*\) — non minifié,/, `AVANT le correctif : « minifié » sur un fichier lisible — ${bandeau}`)
  })

  it('témoins, sans la clé : le développement « non minifié », la production « minifié »', () => {
    const dev = build(projet('bandeau-dev', {}))
    assert.equal(dev.minifie, false)
    assert.match(dev.bandeau, /Build de DÉVELOPPEMENT \([^)]*\) — non minifié,/)
    const prod = build(projet('bandeau-prod', {}), ['--prod'])
    assert.ok(prod.minifie)
    assert.match(prod.bandeau, /Build de PRODUCTION \([^)]*\) — minifié,/)
  })
})
