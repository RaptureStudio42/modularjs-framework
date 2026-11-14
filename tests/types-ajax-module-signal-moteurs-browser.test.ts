// types dans un vrai navigateur, appli de production construite : un module .coffee importé appelle la forme appelable de µajax, avec
// et sans `type:`, et le composant reçoit une réponse refusée ; le signal d'un refus porte l'adresse réelle de la page et celle de la
// requête, coupées avant `?` et `#` (un jeton y figure), jamais la valeur, et part même quand le gestionnaire de l'appli lève
// moteurs exigés : chromium, firefox, webkit

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { chromium, firefox, webkit, type Browser } from 'playwright'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const FICHIERS: Record<string, string> = {
  'app.types.mjs':  '<types>\nReward\n  id     int 1..\n  title  string 1..80\n  price = 0 int 0..\n</types>',
  'charger.coffee.mjs': "export charger = -> await µajax '/app/rewards'\nexport chargerType = -> await µajax '/app/rewards', type: Reward[]",
  'boutique.mjs':   "<vars>\n$v int 0..10\n</vars>\n<script>\n@import { charger chargerType } 'charger.coffee.mjs'\nµmount ->\n  µtypes.onError (e) ->\n    window.__vus.push e.path\n    throw new Error('gestionnaire qui lève')\n  try\n    $v = 'abc'\n  catch e\n    window.__leve = e.message\n  window.__brut  = await charger()\n  window.__type  = await chargerType()\n  window.__refus = await µajax '/app/refus?token=abc', type: Reward[], typeError: (e) -> []\n  window.__fin   = 1\n</script>\n<p>{$v}</p>",
}

describe('types : module .coffee, signal à l\'adresse réelle, gestionnaire qui lève', function () {
  this.timeout(120000)
  let racine  = ''
  let serveur: Server
  let origine = ''
  const recus: string[] = []

  before(async () => {
    racine = mkdtempSync(join(tmpdir(), 'types-nav-'))
    const src = join(racine, 'src')
    mkdirSync(src, { recursive: true })
    for (const [nom, texte] of Object.entries(FICHIERS)) writeFileSync(join(src, nom), texte + '\n')
    const b: any = new Bundler({ sourceDir: src, outputDir: join(racine, 'out'), manifestPath: join(racine, 'bundle.js'), minify: false, typesReport: '/errors/types' } as any)
    b.envMode = 'prod'
    const journal = [console.log, console.warn, console.error]
    console.log = console.warn = console.error = () => {}
    let st: any
    try {
      st = await b.compile()
    }
    finally {
      [console.log, console.warn, console.error] = journal
    }
    assert.deepEqual((st.errors ?? []).map((e: any) => String(e?.message ?? e)), [])
    serveur = createServer((req, res) => {
      let corps = ''
      req.on('data', (d) => { corps += d })
      req.on('end', () => {
        const u = req.url ?? ''
        if (u.startsWith('/errors/types')) { recus.push(corps); res.writeHead(204); res.end(); return }
        if (u.startsWith('/app/refus')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('[{"id":"x","title":"a"}]'); return }
        if (u.startsWith('/app/rewards')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('[{"id":"1","title":"a"}]'); return }
        const f = join(racine, decodeURIComponent(u.split('?')[0]))
        if (!u.startsWith('/users/') && existsSync(f) && statSync(f).isFile()) { res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }); res.end(readFileSync(f)); return }
        if (!u.startsWith('/users/')) { res.writeHead(404); res.end(); return }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end('<!doctype html><html><head><meta charset="utf-8"></head><body><mjs-boutique></mjs-boutique><script type="module" src="/bundle.js"></script></body></html>')
      })
    })
    await new Promise<void>(r => serveur.listen(0, '127.0.0.1', () => r()))
    origine = 'http://127.0.0.1:' + (serveur.address() as any).port
  })

  after(async () => {
    serveur?.close()
    await terminateSharedWorkerPool()
    if (racine) rmSync(racine, { recursive: true, force: true })
  })

  for (const [nom, moteur] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]] as const) {
    describe(`appli de production (${nom})`, function () {
      let browser: Browser

      before(async () => { browser = await moteur.launch() })
      after(async () => { await browser?.close() })

      it('le module appelle µajax ; le signal porte l\'adresse réelle de la page et celle de la requête refusée, coupées avant `?` et `#`, jamais la donnée ; le gestionnaire qui lève ne l\'empêche pas', async () => {
        const avant  = recus.length
        const page   = await browser.newPage()
        const fautes: string[] = []
        page.on('pageerror', (e: any) => fautes.push(String(e.message)))
        await page.addInitScript(() => { (window as any).__vus = [] })
        await page.goto(origine + '/users/jean.dupont@exemple.fr/boutique?token=abc#haut')
        await page.waitForFunction(() => (window as any).__fin === 1, null, { timeout: 10000 }).catch(() => fautes.push('__fin jamais posé'))
        await page.waitForTimeout(500)
        const etat = await page.evaluate(() => ({ vus: (window as any).__vus, leve: (window as any).__leve, brut: (window as any).__brut, type: (window as any).__type, refus: (window as any).__refus }))
        await page.close()
        assert.deepEqual(fautes, [])
        assert.deepEqual(etat, { vus: ['$v'], leve: 'gestionnaire qui lève', brut: [{ id: '1', title: 'a' }], type: [{ id: 1, title: 'a', price: 0 }], refus: [] })
        const PAGE = '/users/jean.dupont@exemple.fr/boutique'
        assert.deepEqual(recus.slice(avant).map(c => JSON.parse(c)), [{ path: '$v', component: 'mjs-boutique', page: PAGE, type: 'string' }, { path: '[0].id', rule: 'Reward[]', component: 'mjs-boutique', page: PAGE, url: '/app/refus', type: 'string' }])
        assert.ok(recus.slice(avant).every(c => !/token|haut|"x"|"abc"/.test(c)), 'ni ce qui suit ? ou #, ni la valeur')
      })
    })
  }
})
