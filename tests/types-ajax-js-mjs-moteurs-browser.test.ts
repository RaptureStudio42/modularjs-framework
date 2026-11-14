// un module .js.mjs (module MJS écrit en JavaScript) dans un vrai navigateur, appli de production minifiée : importé pour son seul
// effet (`@import 'effets.js.mjs'`) ou par ses noms, il reçoit µ — µ.ajax.get et la forme appelable de µajax avec `type:` y marchent,
// le composant qui l'importe se monte. Chaque appli se construit avant les essais, chaque essai lit son propre résultat
// moteurs exigés : chromium, firefox, webkit

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { chromium, firefox, webkit, type Browser } from 'playwright'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const T_REWARD = '<types>\nReward\n  id     int 1..\n  title  string 1..80\n  price = 0 int 0..\n</types>'
const EFFETS: Record<string, string> = {
  'app.types.mjs': T_REWARD,
  'effets.js.mjs':  "µ.ajax.get('/app/rewards', function (r) { window.__effet = r; window.__fin = (window.__fin || 0) + 1 }, function () { window.__effet = 'échec'; window.__fin = (window.__fin || 0) + 1 })",
  'effets2.js.mjs': "µajax('/app/rewards', { type: Reward[] }).then(r => { window.__effet2 = r }, e => { window.__effet2 = 'rejet : ' + e.message }).finally(() => { window.__fin = (window.__fin || 0) + 1 })",
  'boutique.mjs':   "<script>\n@import 'effets.js.mjs'\n@import 'effets2.js.mjs'\nµmount ->\n  window.__monte = 1\n</script>\n<p>boutique</p>",
}
const NOMS: Record<string, string> = {
  'charger.js.mjs': "export function charger () {\n  return new Promise((ok, ko) => µ.ajax.get('/app/rewards', ok, ko))\n}",
  'boutique.mjs':   "<script>\n@import { charger } 'charger.js.mjs'\nµmount ->\n  try\n    window.__charge = await charger()\n  catch e\n    window.__charge = 'rejet : ' + e.message\n</script>\n<p>boutique</p>",
}

interface Appli { erreurs: string[], origine: string, racine: string, serveur?: Server }

// une appli construite comme par `mjs build --prod` (minifiée), et son serveur : les fichiers construits, `/app/rewards` et la page
async function appli(fichiers: Record<string, string>): Promise<Appli> {
  const racine = mkdtempSync(join(tmpdir(), 'types-js-mjs-nav-'))
  const src    = join(racine, 'src')
  mkdirSync(src, { recursive: true })
  for (const [nom, texte] of Object.entries(fichiers)) writeFileSync(join(src, nom), texte + '\n')
  const b: any = new Bundler({ sourceDir: src, outputDir: join(racine, 'out'), manifestPath: join(racine, 'bundle.js'), minify: true } as any)
  b.envMode = 'prod'
  const journal = [console.log, console.warn, console.error]
  console.log = console.warn = console.error = () => {}
  let erreurs: string[] = []
  try {
    const st: any = await b.compile()
    erreurs = (st.errors ?? []).map((e: any) => String(e?.message ?? e))
  }
  catch (e) {
    erreurs = [String(e)]
  }
  finally {
    [console.log, console.warn, console.error] = journal
  }
  const serveur = createServer((req, res) => {
    const u = req.url ?? ''
    if (u.startsWith('/app/rewards')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('[{"id":"1","title":"a"}]'); return }
    const f = join(racine, decodeURIComponent(u.split('?')[0]))
    if (u !== '/' && existsSync(f) && statSync(f).isFile()) { res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }); res.end(readFileSync(f)); return }
    if (u !== '/') { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end('<!doctype html><html><head><meta charset="utf-8"></head><body><mjs-boutique></mjs-boutique><script type="module" src="/bundle.js"></script></body></html>')
  })
  await new Promise<void>(r => serveur.listen(0, '127.0.0.1', () => r()))
  return { erreurs, racine, serveur, origine: 'http://127.0.0.1:' + (serveur.address() as any).port }
}

// la page de l'appli ouverte, jusqu'à ce que `pret` réponde : ses erreurs, et ce que `lire` relève
async function ouvrir(browser: Browser, a: Appli, lire: string[], pret: string): Promise<{ fautes: string[], etat: Record<string, unknown> }> {
  const page   = await browser.newPage()
  const fautes: string[] = []
  page.on('pageerror', (e: any) => fautes.push(String(e.message)))
  page.on('console', (m: any) => { if (m.type() === 'error') fautes.push('console : ' + m.text()) })
  await page.goto(a.origine + '/')
  await page.waitForFunction(pret, null, { timeout: 10000 }).catch(() => fautes.push('jamais prêt : ' + pret))
  const etat = await page.evaluate((cles: string[]) => Object.fromEntries(cles.map(c => [c, (window as any)['__' + c]])), lire)
  await page.close()
  return { fautes, etat }
}

describe('types : module .js.mjs, en production minifiée', function () {
  this.timeout(180000)
  const applis: Record<string, Appli> = {}

  before(async () => {
    applis.effets = await appli(EFFETS)
    applis.noms   = await appli(NOMS)
  })

  after(async () => {
    for (const a of Object.values(applis)) {
      a.serveur?.close()
      rmSync(a.racine, { recursive: true, force: true })
    }
    await terminateSharedWorkerPool()
  })

  for (const [nom, moteur] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]] as const) {
    describe(`appli de production (${nom})`, function () {
      let browser: Browser

      before(async () => { browser = await moteur.launch() })
      after(async () => { await browser?.close() })

      it('un module .js.mjs importé pour son seul effet reçoit µ : µ.ajax.get et la forme appelable marchent, le composant se monte', async () => {
        assert.deepEqual(applis.effets.erreurs, [])
        const { fautes, etat } = await ouvrir(browser, applis.effets, ['effet', 'effet2', 'monte'], 'window.__fin === 2 && window.__monte === 1')
        assert.deepEqual(fautes, [])
        assert.deepEqual(etat, { effet: [{ id: '1', title: 'a' }], effet2: [{ id: 1, title: 'a', price: 0 }], monte: 1 })
      })

      it('un module .js.mjs importé par ses noms reçoit µ et marche', async () => {
        assert.deepEqual(applis.noms.erreurs, [])
        const { fautes, etat } = await ouvrir(browser, applis.noms, ['charge'], 'window.__charge !== undefined')
        assert.deepEqual(fautes, [])
        assert.deepEqual(etat, { charge: [{ id: '1', title: 'a' }] })
      })
    })
  }
})
