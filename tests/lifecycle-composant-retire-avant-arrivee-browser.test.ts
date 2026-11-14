// composant retiré avant que sa connexion ne joue (le `µawake` d'un parent l'enlève), gardé hors de la page plus d'une
// microtâche, puis remis : au retrait ni `µawake` ni `µsleep` (il n'est pas arrivé) ; resté dehors, il est détruit comme
// tout composant qui quitte la page, ses props reçues (le nettoyage interne, puis `µdestroy`) ; à sa vraie arrivée `µawake`
// puis un seul `µmount`, après le rendu, la référence `@this` posée. Chromium, Firefox et WebKit réels, build de
// développement et de production servi par HTTP

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'

type Navigateur = 'chromium' | 'firefox' | 'webkit'
type Env        = 'dev' | 'prod'
interface Construction { base: string, server: Server }

async function navigateurPresent(nom: Navigateur): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  }
  catch {
    return false
  }
}

// l'enfant note chaque hook avec sa prop ; `µmount` dit si la référence `@this` est posée et si son ombre est rendue ;
// le parent retire son enfant depuis son `µawake` quand la page le demande, et le garde de côté
const SOURCES: Record<string, string> = {
  'app.page.mjs':       '<@enfant-suivi qui="pre"></@enfant-suivi>\n<@parent-retire></@parent-retire>\n',
  'enfant-suivi.mjs':   "<script>\n  $qui = '?'\n  boite = null\n  µawake -> window.__k.push('awake:' + $qui)\n  µsleep -> window.__k.push('sleep:' + $qui)\n  µmount -> window.__k.push('mount:' + $qui + ':' + (if boite then 'ref' else 'SANSREF') + ':' + (if @@_shadow and @@_shadow.querySelector('.qui') then 'rendu' else 'NONRENDU'))\n  µdestroy -> window.__k.push('destroy:' + $qui)\n</script>\n<b class=\"qui\" :this=!{boite}>{$qui}</b>\n",
  'parent-retire.mjs':  "<script>\n  µawake ->\n    k = @@querySelector('mjs-enfant-suivi')\n    return unless k and window.__retirer\n    window.__retirer = null\n    k.remove()\n    window.__orphelin = k\n</script>\n<slot></slot>\n"
}

const constructions = new Map<Env, Promise<Construction>>()

async function bati(env: Env): Promise<Construction> {
  const root   = mjsTmp('composant-retire-avant-arrivee-' + env)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, code] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), code)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', urlPrefix: '/out' }, null, 2))
  const found   = findConfig(root)!
  const bundler = new Bundler({ ...resolveBundlerOpts(found.config, found.configDir), env } as any)
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  await bundler.close()
  const server = createServer((req, res) => {
    const chemin = decodeURIComponent((req.url ?? '/').split('?')[0])
    if (chemin === '/app') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/out/bundle.js"></script></head><body><mjs-app></mjs-app></body></html>')
      return
    }
    const fichier = join(root, normalize(chemin))
    if (!fichier.startsWith(outDir) || !existsSync(fichier) || !statSync(fichier).isFile()) { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'content-type': extname(fichier) === '.js' ? 'text/javascript; charset=utf-8' : 'application/json' })
    res.end(readFileSync(fichier))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  return { base: `http://127.0.0.1:${(server.address() as any).port}`, server }
}

describe('composant retiré avant son arrivée puis remis : ni réveil ni sommeil au retrait, détruit s\'il reste dehors, un seul µmount à la vraie arrivée — dans de vrais navigateurs', function () {
  for (const env of ['dev', 'prod'] as const) {
    for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
      describe(`build ${env} — ${nom}`, function () {
        this.timeout(120000)
        let browser: any = null
        let c: Construction

        before(async function () {
          if (!await navigateurPresent(nom)) { console.log(`  ℹ️  ${nom} non installé : test sauté. Activer : \`npx playwright install ${nom}\``); this.skip() }
          if (!constructions.has(env)) constructions.set(env, bati(env))
          c       = await constructions.get(env)!
          browser = await (await import('playwright'))[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
        })

        after(async function () {
          if (browser) await browser.close()
        })

        it('retiré par le µawake de son parent, gardé hors de la page, puis remis : µawake puis un µmount, la référence posée', async () => {
          const contexte   = await browser.newContext()
          const exceptions = [] as string[]
          try {
            const page = await contexte.newPage()
            page.on('pageerror', (e: any) => exceptions.push(String(e)))
            await page.addInitScript(() => { (window as any).__k = [] })
            await page.goto(c.base + '/app')
            await page.waitForFunction(() => (window as any).__k.includes('mount:pre:ref:rendu'), null, { timeout: 10000 })
            const r = await page.evaluate(async () => {
              const w     = window as any
              const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
              const m     = document.createElement('mjs-parent-retire')
              const k     = document.createElement('mjs-enfant-suivi') as any
              w.__k       = []
              w.__retirer = true
              k.setAttribute('qui', 'k')
              // nettoyage interne inscrit avant l'arrivée (nom interne lisible en développement seulement)
              const interne = typeof k._mjs_onDestroy === 'function'
              if (interne) k._mjs_onDestroy(() => w.__k.push('nettoyage'))
              m.appendChild(k)
              document.body.appendChild(m)
              await pause(200)
              const retire = w.__k.slice()
              const garde  = w.__orphelin === k && !k.isConnected
              document.body.appendChild(w.__orphelin)
              await pause(300)
              return { interne, garde, retire, remis: w.__k.slice(retire.length), texte: k._shadow ? k._shadow.textContent.trim() : null }
            })
            assert.ok(r.garde, `le parent a retiré l'enfant avant son arrivée ${JSON.stringify(r)}`)
            assert.deepEqual(r.retire, r.interne ? ['nettoyage', 'destroy:k'] : ['destroy:k'], 'ni µawake ni µsleep au retrait ; resté dehors, µdestroy avec ses props (AVANT : rien, ou destroy:? avec les props par défaut)')
            assert.deepEqual(r.remis, ['awake:k', 'mount:k:ref:rendu'], 'AVANT : un µmount avant µawake, sans la référence @this, puis un second µmount')
            assert.equal(r.texte, 'k')
            assert.deepEqual(exceptions, [])
          }
          finally { await contexte.close() }
        })
      })
    }
  }

  after(async function () {
    for (const k of constructions.values()) {
      const s = await k
      s.server.closeAllConnections()
      await new Promise(resolve => s.server.close(() => resolve(null)))
    }
    constructions.clear()
    await terminateSharedWorkerPool()
  })
})
