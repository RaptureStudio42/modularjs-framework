// types dans un vrai navigateur, appli de production minifiée : un module .js.mjs importé reçoit µ comme un module .civet ou .coffee —
// µ.ajax.get, la forme appelable de µajax et son `type:` y marchent sans `window.µ` ; un nom lié par une déstructuration reste une
// donnée d'un verbe ; en développement (Chromium), le module .js.mjs garde l'import du cœur et marche. Chaque appli se construit avant les
// essais, chaque essai lit son propre résultat
// moteurs exigés : chromium, firefox, webkit

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { chromium, firefox, webkit, type Browser } from 'playwright'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const T_REWARD = '<types>\nReward\n  id     int 1..\n  title  string 1..80\n  price = 0 int 0..\n</types>'
const MODULES: Record<string, string> = {
  'app.types.mjs': T_REWARD,
  'brut.js.mjs':       "export function chargerBrut () {\n  return new Promise((ok, ko) => µ.ajax.get('/app/rewards', ok, ko))\n}",
  'appel.js.mjs':      "export async function chargerType () {\n  return await µajax('/app/rewards', { type: Reward[] })\n}",
  'boutique.mjs':  "<script>\n@import { chargerBrut } 'brut.js.mjs'\n@import { chargerType } 'appel.js.mjs'\nµmount ->\n  try\n    window.__brut = await chargerBrut()\n  catch e\n    window.__brut = 'rejet : ' + e.message\n  try\n    window.__type = await chargerType()\n  catch e\n    window.__type = 'rejet : ' + e.message\n  window.__fin = 1\n</script>\n<p>boutique</p>",
}
const LIE: Record<string, string> = {
  'app.types.mjs': T_REWARD,
  'boutique.mjs':  "<script>\nµmount ->\n  { type: Reward } = { type: 'cadeau' }\n  µajax.post '/app/kind', type: Reward, ((r) -> window.__verbe = r; window.__fin = 1), (-> window.__verbe = 'échec'; window.__fin = 1)\n</script>\n<p>boutique</p>",
}

interface Appli { erreurs: string[], origine: string, racine: string, serveur?: Server }

// une appli construite comme par `mjs build` (de production, sauf `dev`), et son serveur : les fichiers construits, `/app/rewards`, `/app/kind`
// (renvoie le corps reçu) et la page
async function appli(fichiers: Record<string, string>, o: { dev?: boolean } = {}): Promise<Appli> {
  const racine = mkdtempSync(join(tmpdir(), 'types-js-nav-'))
  const src    = join(racine, 'src')
  mkdirSync(src, { recursive: true })
  for (const [nom, texte] of Object.entries(fichiers)) writeFileSync(join(src, nom), texte + '\n')
  const b: any = new Bundler({ sourceDir: src, outputDir: join(racine, 'out'), manifestPath: join(racine, 'bundle.js'), minify: !o.dev } as any)
  b.envMode = o.dev ? 'dev' : 'prod'
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
    let corps = ''
    req.on('data', (d) => { corps += d })
    req.on('end', () => {
      const u = req.url ?? ''
      if (u.startsWith('/app/rewards')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('[{"id":"1","title":"a"}]'); return }
      if (u.startsWith('/app/kind')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ corps })); return }
      const f = join(racine, decodeURIComponent(u.split('?')[0]))
      if (u !== '/' && existsSync(f) && statSync(f).isFile()) { res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }); res.end(readFileSync(f)); return }
      if (u !== '/') { res.writeHead(404); res.end(); return }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<!doctype html><html><head><meta charset="utf-8"></head><body><mjs-boutique></mjs-boutique><script type="module" src="/bundle.js"></script></body></html>')
    })
  })
  await new Promise<void>(r => serveur.listen(0, '127.0.0.1', () => r()))
  return { erreurs, racine, serveur, origine: 'http://127.0.0.1:' + (serveur.address() as any).port }
}

// la page de l'appli ouverte, jusqu'à `__fin` : ses erreurs, et ce que `lire` relève
async function ouvrir(browser: Browser, a: Appli, lire: string[]): Promise<{ fautes: string[], etat: Record<string, unknown> }> {
  const page   = await browser.newPage()
  const fautes: string[] = []
  page.on('pageerror', (e: any) => fautes.push(String(e.message)))
  await page.goto(a.origine + '/')
  await page.waitForFunction(() => (window as any).__fin === 1, null, { timeout: 10000 }).catch(() => fautes.push('__fin jamais posé'))
  const etat = await page.evaluate((cles: string[]) => Object.fromEntries(cles.map(c => [c, (window as any)['__' + c]])), lire)
  await page.close()
  return { fautes, etat }
}

describe('types : module .js importé en production, nom lié par une déstructuration', function () {
  this.timeout(180000)
  const applis: Record<string, Appli> = {}

  before(async () => {
    applis.modules = await appli(MODULES)
    applis.lie     = await appli(LIE)
    applis.dev     = await appli(MODULES, { dev: true })
  })

  after(async () => {
    for (const a of Object.values(applis)) {
      a.serveur?.close()
      rmSync(a.racine, { recursive: true, force: true })
    }
    await terminateSharedWorkerPool()
  })

  describe('appli de développement (chromium)', function () {
    let browser: Browser

    before(async () => { browser = await chromium.launch() })
    after(async () => { await browser?.close() })

    it('un module .js.mjs qui nomme µ garde l\'import du cœur et marche : µ.ajax.get, la forme appelable et type:', async () => {
      assert.deepEqual(applis.dev.erreurs, [])
      const brut = (readdirSync(join(applis.dev.racine, 'out')) as string[]).filter(f => f.startsWith('brut.js-'))
      assert.equal(brut.length, 1, brut.join(', '))
      assert.match(readFileSync(join(applis.dev.racine, 'out', brut[0]), 'utf-8'), /^import \{ µ \} from '[^']*mjs_core-[^']*';/)
      const { fautes, etat } = await ouvrir(browser, applis.dev, ['brut', 'type'])
      assert.deepEqual(fautes, [])
      assert.deepEqual(etat, { brut: [{ id: '1', title: 'a' }], type: [{ id: 1, title: 'a', price: 0 }] })
    })
  })

  for (const [nom, moteur] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]] as const) {
    describe(`appli de production (${nom})`, function () {
      let browser: Browser

      before(async () => { browser = await moteur.launch() })
      after(async () => { await browser?.close() })

      it('un module .js.mjs qui écrit µ.ajax.get reçoit µ', async () => {
        assert.deepEqual(applis.modules.erreurs, [])
        const { fautes, etat } = await ouvrir(browser, applis.modules, ['brut'])
        assert.deepEqual(fautes, [])
        assert.deepEqual(etat, { brut: [{ id: '1', title: 'a' }] })
      })

      it('un module .js.mjs qui écrit la forme appelable et type: reçoit µ ; la réponse passe par la règle', async () => {
        assert.deepEqual(applis.modules.erreurs, [])
        const { fautes, etat } = await ouvrir(browser, applis.modules, ['type'])
        assert.deepEqual(fautes, [])
        assert.deepEqual(etat, { type: [{ id: 1, title: 'a', price: 0 }] })
      })

      it('un nom lié par une déstructuration reste une donnée du verbe, envoyée telle quelle', async () => {
        assert.deepEqual(applis.lie.erreurs, [])
        const { fautes, etat } = await ouvrir(browser, applis.lie, ['verbe'])
        assert.deepEqual(fautes, [])
        assert.ok(JSON.stringify(etat.verbe).includes('cadeau'), JSON.stringify(etat))
      })
    })
  }
})
