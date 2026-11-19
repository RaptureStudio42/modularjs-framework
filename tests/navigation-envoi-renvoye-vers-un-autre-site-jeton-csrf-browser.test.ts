// le jeton CSRF d'un envoi que votre serveur renvoie (303) : vers une page de votre site, il part une fois, vers votre serveur, et la page
// d'arrivée s'installe ; vers un autre site, le navigateur garde l'en-tête `X-CSRF-Token` en suivant le renvoi, et l'autre site le reçoit
// s'il accepte la requête préalable (OPTIONS) — limite écrite au chapitre de la navigation : `fetch` ne retire pas un en-tête au passage
// d'un renvoi et ne dit pas l'adresse d'arrivée sans le suivre — ; un site qui refuse la requête préalable ne le reçoit jamais ; un
// formulaire `:noUJS` part sans MJS, sans l'en-tête. Vrais serveurs, deux origines sur 127.0.0.1 ; développement et production,
// Chromium, Firefox et WebKit réels
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const TYPES: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css' }
const TIERS   = '<!doctype html><html><head><title>tiers</title></head><body><p id="tiers">page du tiers</p></body></html>'
const CORPS   = '<form method="post" action="ici"><button id="b-ici">a</button></form><form method="post" action="p303"><button id="b-ouvert">b</button></form>'
  + '<form method="post" action="p303s"><button id="b-ferme">c</button></form><form method="post" action="p303" mjs-no-ujs><button id="b-natif">d</button></form>'
const page    = (env: string, corps: string) => '<!doctype html><html><head><meta charset="utf-8"><meta name="csrf-token" content="JETON-SECRET"><title>site</title><script type="module" src="/m-' + env + '/bundle.js"></script></head><body>' + corps + '</body></html>'
const ecoute  = (s: Server) => new Promise<string>((ok) => s.listen(0, '127.0.0.1', () => ok('http://127.0.0.1:' + (s.address() as any).port)))
const ferme   = (s: Server | null) => s ? new Promise((ok) => { (s as any).closeAllConnections?.(); s.close(() => ok(null)) }) : null
const ENVS    = ['dev', 'prod'] as const

describe('envoi renvoyé (303) : le jeton CSRF vers votre site, vers un autre site, avec :noUJS', function () {
  this.timeout(280000)
  const dists: Record<string, string> = {}

  before(async () => {
    for (const env of ENVS) {
      const racine = mjsTmp('renvoi-jeton-' + env)
      const src    = join(racine, 'src')
      dists[env]   = join(racine, 'dist')
      mkdirSync(src, { recursive: true })
      writeFileSync(join(src, 'temoin.mjs'), '<i class="temoin">témoin</i>\n')
      const opts: any = { sourceDir: src, outputDir: dists[env], manifestPath: join(dists[env], 'bundle.js'), urlPrefix: '/m-' + env, runtime: ['ujs', 'router', 'ajax', 'vault'] }
      if (env === 'prod') Object.assign(opts, { env: 'prod', js: 'bundle' })
      const bundler = new Bundler(opts)
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    }
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
    describe(nom, function () {
      let browser: any = null, site: Server | null = null, tiers: Server | null = null, origine = '', ailleurs = ''
      const vuSite: string[]  = []
      const vuTiers: string[] = []
      const trace = (req: any) => req.method + ' ' + req.url + (req.headers['x-csrf-token'] ? ' jeton=' + req.headers['x-csrf-token'] : '')

      before(async function () {
        const playwright: any = await import('playwright')
        if (!existsSync(playwright[nom].executablePath())) return this.skip()
        browser = await playwright[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
        // `/piege` accepte toute requête préalable (un site qui veut lire les en-têtes), `/strict` n'en accepte aucune
        tiers = createServer((req, res) => {
          vuTiers.push(trace(req))
          const cors = req.url === '/piege' ? { 'access-control-allow-origin': '*', 'access-control-allow-headers': String(req.headers['access-control-request-headers'] || '*'), 'access-control-allow-methods': 'GET, POST, OPTIONS' } : {}
          if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return }
          req.resume()
          res.writeHead(200, { ...cors, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
          res.end(TIERS)
        })
        ailleurs = await ecoute(tiers)
        const renvoi = (res: any, ou: string) => { res.writeHead(303, { location: ou, 'cache-control': 'no-store' }); res.end() }
        site = createServer((req, res) => {
          const p = new URL(req.url || '/', 'http://x').pathname
          const m = /^\/(dev|prod)\/(\w+)$/.exec(p)
          const f = /^\/m-(dev|prod)\/(.+)$/.exec(p)
          if (m) vuSite.push(trace(req))
          if (m && m[2] === 'accueil') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(page(m[1], '<mjs-temoin mjs-light></mjs-temoin>' + CORPS)); return }
          if (m && m[2] === 'merci') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(page(m[1], '<p id="merci">merci</p>')); return }
          if (m && m[2] === 'ici') { req.resume(); renvoi(res, '/' + m[1] + '/merci'); return }
          if (m && m[2] === 'p303') { req.resume(); renvoi(res, ailleurs + '/piege'); return }
          if (m && m[2] === 'p303s') { req.resume(); renvoi(res, ailleurs + '/strict'); return }
          const fichier = f ? join(dists[f[1]], normalize(decodeURIComponent(f[2])).replace(/^(\.\.[/\\])+/, '')) : ''
          if (!fichier || !existsSync(fichier) || !statSync(fichier).isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('introuvable'); return }
          res.writeHead(200, { 'content-type': TYPES[extname(fichier)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
          res.end(readFileSync(fichier))
        })
        origine = await ecoute(site)
      })

      after(async () => {
        if (browser) await browser.close()
        await ferme(site)
        await ferme(tiers)
      })

      // la page du site, MJS prêt ; le bouton cliqué ; ce que chaque serveur a vu ensuite
      async function envoyer(env: string, bouton: string, arrivee: string | null) {
        const p = await browser.newPage({ viewport: { width: 800, height: 600 } })
        try {
          await p.goto(origine + '/' + env + '/accueil')
          await p.waitForFunction(() => history.scrollRestoration === 'manual' && !!customElements.get('mjs-temoin'), null, { timeout: 15000 })
          vuSite.length = vuTiers.length = 0
          await p.click(bouton)
          if (arrivee) await p.waitForSelector(arrivee, { timeout: 15000 })
          else await p.waitForTimeout(2000)
          return { ou: await p.evaluate(() => location.origin), site: [...vuSite], tiers: [...vuTiers] }
        } finally {
          await p.close()
        }
      }

      for (const env of ENVS) {
        it(`${env} : vers une page de votre site, le jeton part une fois, vers votre serveur, et la page d'arrivée s'installe`, async () => {
          const v = await envoyer(env, '#b-ici', '#merci')
          assert.equal(v.ou, origine)
          assert.deepEqual(v.site.filter((x) => x.startsWith('POST')), [`POST /${env}/ici jeton=JETON-SECRET`])
          assert.deepEqual(v.tiers, [])
        })

        it(`${env} : vers un autre site qui accepte la requête préalable, il reçoit le jeton (limite écrite) ; l'envoi part une fois`, async () => {
          const v = await envoyer(env, '#b-ouvert', '#tiers')
          assert.equal(v.ou, ailleurs)
          assert.deepEqual(v.site.filter((x) => x.startsWith('POST')), [`POST /${env}/p303 jeton=JETON-SECRET`])
          assert.ok(v.tiers.some((x) => x.includes('jeton=JETON-SECRET')), 'le tiers n\'a pas reçu le jeton : ' + v.tiers.join(' ; '))
        })

        it(`${env} : vers un autre site qui refuse la requête préalable, il ne reçoit jamais le jeton`, async () => {
          const v = await envoyer(env, '#b-ferme', null)
          assert.deepEqual(v.site.filter((x) => x.startsWith('POST')), [`POST /${env}/p303s jeton=JETON-SECRET`])
          assert.ok(!v.tiers.some((x) => x.includes('jeton=')), 'le tiers a reçu le jeton : ' + v.tiers.join(' ; '))
        })

        it(`${env} : un formulaire :noUJS part sans MJS, l'autre site ne reçoit pas l'en-tête`, async () => {
          const v = await envoyer(env, '#b-natif', '#tiers')
          assert.equal(v.ou, ailleurs)
          assert.deepEqual(v.site.filter((x) => x.startsWith('POST')), [`POST /${env}/p303`])
          assert.ok(!v.tiers.some((x) => x.includes('jeton=')), 'le tiers a reçu le jeton : ' + v.tiers.join(' ; '))
        })
      }
    })
  }
})
