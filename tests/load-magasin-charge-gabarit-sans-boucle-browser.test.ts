// µload en navigateur réel (Chromium, Firefox, WebKit), en développement et en production, contre un vrai serveur Node : le gabarit ne
// boucle jamais — une liste de 55 adresses fait 55 requêtes, même redessinée ; deux adresses en échec, une requête chacune, l'erreur
// affichée ; une adresse affichée est relue une fois après un envoi, jamais au redessin suivant, et un bloc fermé pendant l'envoi
// puis rouvert la relit une fois et montre la donnée fraîche ; un composant parti n'est plus prévenu ni gardé — ; `$p = µload(u).refresh()`
// reste une variable ; un appel fait dans une boucle ou une aide (même appelée une fois, même dans un `map`) attend sans la donnée d'une
// autre adresse, l'appel écrit dans une dérivée garde celle de la recherche d'avant.
// Le composant parti se compte sur une production non minifiée : la minification renomme la méthode de rendu que le test enveloppe

import assert from 'node:assert/strict'
import http from 'node:http'
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire } from './helpers/liaison-navigateur.js'
import { mjsTmp } from './helpers/tmp.js'

const N55 = Array.from({ length: 55 }, (_, i) => i + 1).join(', ')
const SOURCES: Record<string, string> = {
  'tfor.mjs':  `<script>\n  $l = [${N55}]\n</script>\n<b class="w">w</b><i class="k">{µload('/api/h/kick').data?.n or 'k'}</i>{for i in $l}<i class="v">{µload("/api/auto/f/#{i}").data?.n or 'att'}</i>{end}\n`,
  'terr.mjs':  `<b class="w">w</b><i class="v">{(if µload('/api/err/a').error then 'ea' else 'pa')}</i><i class="v">{(if µload('/api/err/b').error then 'eb' else 'pb')}</i>\n`,
  'tenv.mjs':  `<script>\n  @envoyer = (u) -> µ.ajax.patch(u, {})\n</script>\n<b class="w">w</b><i class="v">{µload('/api/compte/te').data?.n or 'att'}</i><i class="k">{µload('/api/h/kick2').data?.n or 'k'}</i>\n`,
  'pdep.mjs':  `<script>\n  $on = true\n  @basculer = (v) -> $on = v\n  @envoyer = (u) -> µ.ajax.patch(u, {})\n  $garde = µload('/api/h/dep')\n</script>\n<b class="w">w</b><i class="v">{$garde.data?.n or 'att'}</i>{if $on}<@c-dep></@c-dep>{end}\n`,
  'c-dep.mjs': `<i class="x">{µload('/api/h/dep').data?.n or 'att'}</i><i class="x">{µload('/api/h/dep0').data?.n or 'att'}</i>\n`,
  'dref.mjs':  `<script>\n  $p = µload('/api/auto/rf').refresh()\n</script>\n<b class="w">w</b><i class="v">{(if $p then 'p' else 'x')}</i>\n`,
  'tro.mjs':   `<script>\n  $on = true\n  @basculer = (v) -> $on = v\n  @envoyer = (u) -> µ.ajax.patch(u, {})\n</script>\n<b class="w">w</b>{if $on}<i class="v">{µload('/api/h/ro').data?.n or 'att'}</i>{end}\n`,
  'damap.mjs': `<script>\n  $ids = [1]\n  @poser = (l) -> $ids = l\n  fiche = (i) -> µload("/api/h/am/#{i}")\n  $d = $ids.map((i) -> fiche(i))\n</script>\n<b class="w">w</b><i class="v">{$d.map((x) -> x.data?.n or 'att').join(',')}</i>\n`,
  'daide.mjs': `<script>\n  $q = 'a'\n  @taper = (v) -> $q = v\n  aide = (q) -> µload("/api/h/ai?q=#{q}")\n  $r = aide($q)\n  $s = µload("/api/h/s?q=#{$q}")\n</script>\n<b class="w">w</b><i class="v">{$r.data?.n or 'att'}</i><i class="v">{$s.data?.n or 'att'}</i>\n`,
  'dmap1.mjs': `<script>\n  $ids = [1]\n  @poser = (l) -> $ids = l\n  $d = $ids.map((i) -> µload("/api/h/m1/#{i}"))\n</script>\n<b class="w">w</b><i class="v">{$d.map((x) -> x.data?.n or 'att').join(',')}</i>\n`,
}
const BALISES = Object.keys(SOURCES).filter((f) => !f.startsWith('c-')).map((f) => 'mjs-' + f.replace('.mjs', ''))

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))
const memoireDisponible = () => Number(readFileSync('/proc/meminfo', 'utf-8').split('\n').find((l) => l.startsWith('MemAvailable:'))!.split(/\s+/)[1]) / 1048576

type Tenue = { motif: string, res: any, fermee: boolean }
type Cible = { racine: string, document: (balise: string, variante: string) => string }

// production non minifiée, en morceaux : les noms internes restent lisibles
async function construireLisible(): Promise<Cible> {
  const root   = mjsTmp('load-sans-boucle-lisible')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), env: 'prod', js: 'split', urlPrefix: '/out', minify: false } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
  return { racine: root, document: (balise) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><${balise}></${balise}><script type="module" src="/out/bundle.js"></script></body></html>` }
}

describe('µload : le gabarit ne boucle jamais et relit une fois après un envoi, refresh() rangé reste une variable, la donnée d\'avant seulement pour l\'appel écrit dans une dérivée — navigateur réel, vrai serveur Node', function () {
  this.timeout(280000)
  let srv: any = null
  let port     = 0
  let doc      = ''
  let racine   = ''
  const vus: string[]   = []
  const tenues: Tenue[] = []
  const cibles: Record<string, Cible> = {}

  let compte   = 0

  // répondre aux requêtes tenues que `filtre` retient (le corps nomme l'adresse lue, suivie de `suite`)
  const repondre = async (filtre: (m: string) => boolean, suite = '') => {
    for (const t of tenues.filter((x) => !x.fermee && !x.res.writableEnded && filtre(x.motif))) {
      t.res.writeHead(200, { 'content-type': 'application/json' })
      t.res.end(JSON.stringify({ n: t.motif.replace(/^[A-Z]+ /, '') + suite }))
    }
    await pause(300)
  }

  before(async () => {
    srv = http.createServer((req, res) => {
      const url    = new URL(req.url!, 'http://x')
      const chemin = decodeURIComponent(url.pathname)
      if (chemin === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(doc); return }
      if (chemin.startsWith('/out/')) {
        const f = join(racine, normalize(chemin))
        if (existsSync(f)) { res.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json' }); res.end(readFileSync(f)); return }
        res.writeHead(404); res.end(); return
      }
      if (!chemin.startsWith('/api/')) { res.writeHead(404); res.end(); return }
      const t: Tenue = { motif: req.method + ' ' + chemin + url.search, res, fermee: false }
      vus.push(t.motif)
      req.resume()
      // deux échecs, l'un après l'autre
      if (chemin.startsWith('/api/err/')) { setTimeout(() => { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"e":1}') }, chemin.endsWith('/b') ? 150 : 30); return }
      // servie tout de suite, numérotée : la donnée relue se distingue de celle d'avant
      if (chemin.startsWith('/api/compte/') && req.method === 'GET') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ n: chemin + '#' + ++compte })); return }
      if (chemin.startsWith('/api/auto/') || req.method !== 'GET') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ n: chemin + url.search })); return }
      res.on('close', () => { if (!res.writableEnded) t.fermee = true })
      tenues.push(t)
    })
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', () => ok()))
    port = srv.address().port
    for (const mode of ['dev-parents-avant', 'split'] as const) cibles[mode] = await construire(mode, SOURCES, BALISES)
    cibles.lisible = await construireLisible()
  })

  after(async () => {
    await terminateSharedWorkerPool()
    if (srv) { srv.closeAllConnections(); srv.close() }
  })

  for (const moteur of ['chromium', 'firefox', 'webkit'] as const) describe(moteur, function () {
    let browser: any = null
    let present      = false

    before(async function () {
      const playwright = await import('playwright')
      present = existsSync(playwright[moteur].executablePath())
      if (!present) { console.log(`  ℹ️  ${moteur} non installé, sauté. Activer : \`npx playwright install ${moteur}\``); return }
      assert.ok(memoireDisponible() >= 6, 'mémoire disponible sous 6 Go : navigateur non lancé')
      browser = await playwright[moteur].launch(moteur === 'chromium' ? { args: ['--no-proxy-server'] } : moteur === 'firefox' ? { firefoxUserPrefs: { 'network.proxy.type': 0 } } : {})
    })

    after(async () => { if (browser) await browser.close() })

    // la page du composant ; `appeler` joue une méthode du composant, `lire` ses textes, `get` compte les requêtes GET d'un motif
    async function ouvrir(mode: string, balise: string) {
      doc    = cibles[mode].document(balise, '')
      racine = cibles[mode].racine
      vus.length = 0
      tenues.length = 0
      compte = 0
      const ctx  = await browser.newContext()
      const page = await ctx.newPage()
      const erreurs: string[] = []
      page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e)))
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' })
      const el = `document.querySelector('${balise}')`
      await page.waitForFunction(`!!(${el}?._shadow || ${el}?.shadowRoot)?.querySelector('.w')`, null, { timeout: 15000 })
      const appeler = async (methode: string, valeur: unknown, attente: number) => { await page.evaluate(`(${el}.${methode}(${JSON.stringify(valeur)}), null)`); await pause(attente) }
      const lire    = (sur = el, sel = '.v') => page.evaluate(`[...((${sur}._shadow || ${sur}.shadowRoot).querySelectorAll('${sel}'))].map((x) => x.textContent).join('|') || '(absente)'`)
      const get     = (re: RegExp) => vus.filter((m) => m.startsWith('GET') && re.test(m)).length
      return { ctx, page, el, erreurs, appeler, lire, get }
    }

    for (const mode of ['dev-parents-avant', 'split'] as const) {
      it(`le gabarit, une liste de 55 adresses ({for}) : 55 requêtes, même redessinée par l'arrivée d'une autre adresse (${mode})`, async function () {
        if (!present) { this.skip(); return }
        const o = await ouvrir(mode, 'mjs-tfor')
        try {
          await pause(2000)
          const g1 = o.get(/\/api\/auto\/f\//)
          await repondre((m) => m === 'GET /api/h/kick')
          await pause(1200)
          const g2 = o.get(/\/api\/auto\/f\//)
          assert.deepEqual([g1, g2], [55, 55], 'une requête par adresse affichée')
          assert.equal((await o.lire()).split('|').filter((x: string) => x === 'att').length, 0, 'chaque rang sa donnée')
          assert.equal(await o.lire(o.el, '.k'), '/api/h/kick')
          assert.deepEqual(o.erreurs, [])
        } finally {
          await o.ctx.close()
        }
      })

      it(`le gabarit, deux adresses en échec : une requête chacune, l'erreur affichée, rien de redemandé (${mode})`, async function () {
        if (!present) { this.skip(); return }
        const o = await ouvrir(mode, 'mjs-terr')
        try {
          await pause(1200)
          const g1 = o.get(/\/api\/err\//)
          await pause(800)
          assert.deepEqual([g1, o.get(/\/api\/err\//)], [2, 2])
          assert.equal(await o.lire(), 'ea|eb')
          assert.deepEqual(o.erreurs, [])
        } finally {
          await o.ctx.close()
        }
      })

      it(`le gabarit : une adresse affichée est relue une fois après un envoi, jamais au redessin suivant (${mode})`, async function () {
        if (!present) { this.skip(); return }
        const o = await ouvrir(mode, 'mjs-tenv')
        try {
          await pause(400)
          assert.equal(await o.lire(), '/api/compte/te#1')
          const n = vus.length
          await o.appeler('envoyer', '/api/compte/te', 400)
          await repondre((m) => m === 'GET /api/h/kick2')
          await pause(300)
          assert.equal(await o.lire(o.el, '.k'), '/api/h/kick2', 'redessiné par l\'arrivée d\'une autre adresse')
          assert.deepEqual(vus.slice(n).filter((m) => m.startsWith('GET')), ['GET /api/compte/te'], 'relue une fois, jamais au redessin')
          assert.equal(await o.lire(), '/api/compte/te#2', 'la donnée fraîche affichée')
          assert.deepEqual(o.erreurs, [])
        } finally {
          await o.ctx.close()
        }
      })

      it(`\`$p = µload(u).refresh()\` rangé : deux requêtes au plus, jamais de boucle (${mode})`, async function () {
        if (!present) { this.skip(); return }
        const o = await ouvrir(mode, 'mjs-dref')
        try {
          // la requête de µload, annulée aussitôt par refresh(), ne quitte pas toujours le navigateur (Firefox, WebKit) : une ou deux
          await pause(1200)
          const g1 = o.get(/\/api\/auto\/rf/)
          await pause(800)
          assert.ok(g1 >= 1 && g1 <= 2 && o.get(/\/api\/auto\/rf/) === g1, 'requêtes : ' + g1 + ' puis ' + o.get(/\/api\/auto\/rf/))
          assert.equal(await o.lire(), 'p')
          assert.deepEqual(o.erreurs, [])
        } finally {
          await o.ctx.close()
        }
      })

      it(`le gabarit : un bloc fermé pendant un envoi, rouvert sans autre arrivée, relit son adresse une fois et montre la donnée fraîche (${mode})`, async function () {
        if (!present) { this.skip(); return }
        const o = await ouvrir(mode, 'mjs-tro')
        try {
          await repondre((m) => m === 'GET /api/h/ro')
          assert.equal(await o.lire(), '/api/h/ro')
          await o.appeler('basculer', false, 300)
          const n = vus.length
          await o.appeler('envoyer', '/api/h/ro', 400)
          await o.appeler('basculer', true, 400)
          assert.deepEqual(vus.slice(n).filter((m) => m.startsWith('GET')), ['GET /api/h/ro'], 'relue une fois')
          await repondre((m) => m === 'GET /api/h/ro', ' frais')
          assert.equal(await o.lire(), '/api/h/ro frais', 'rouvert, il montre la donnée fraîche')
          await pause(600)
          assert.deepEqual(vus.slice(n).filter((m) => m.startsWith('GET')), ['GET /api/h/ro'], 'jamais de boucle')
          assert.deepEqual(o.erreurs, [])
        } finally {
          await o.ctx.close()
        }
      })

      it(`une aide appelée dans un map d'un seul rang : l'id qui change attend sans la donnée d'avant (${mode})`, async function () {
        if (!present) { this.skip(); return }
        const o = await ouvrir(mode, 'mjs-damap')
        try {
          await repondre((m) => m === 'GET /api/h/am/1')
          assert.equal(await o.lire(), '/api/h/am/1')
          await o.appeler('poser', [3], 300)
          assert.equal(await o.lire(), 'att', 'le rang de l\'id 3 attend, sans la donnée de l\'id 1')
          await repondre((m) => m === 'GET /api/h/am/3')
          assert.equal(await o.lire(), '/api/h/am/3')
          assert.deepEqual(o.erreurs, [])
        } finally {
          await o.ctx.close()
        }
      })

      it(`la frappe d'une recherche : l'appel écrit dans la dérivée garde la donnée d'avant, l'aide appelée une fois attend (${mode})`, async function () {
        if (!present) { this.skip(); return }
        const o = await ouvrir(mode, 'mjs-daide')
        try {
          const cherche = (m: string) => m.startsWith('GET /api/h/ai') || m.startsWith('GET /api/h/s?')
          await repondre(cherche)
          assert.equal(await o.lire(), '/api/h/ai?q=a|/api/h/s?q=a')
          await o.appeler('taper', 'ab', 300)
          assert.equal(await o.lire(), 'att|/api/h/s?q=a', 'l\'aide attend, la dérivée garde la liste d\'avant')
          await repondre(cherche)
          assert.equal(await o.lire(), '/api/h/ai?q=ab|/api/h/s?q=ab')
          assert.deepEqual(o.erreurs, [])
        } finally {
          await o.ctx.close()
        }
      })

      it(`le même appel dans un map d'un seul rang : l'id qui change attend sans la donnée d'avant (${mode})`, async function () {
        if (!present) { this.skip(); return }
        const o = await ouvrir(mode, 'mjs-dmap1')
        try {
          await repondre((m) => m === 'GET /api/h/m1/1')
          assert.equal(await o.lire(), '/api/h/m1/1')
          await o.appeler('poser', [3], 300)
          assert.equal(await o.lire(), 'att', 'le rang de l\'id 3 attend, sans la donnée de l\'id 1')
          await repondre((m) => m === 'GET /api/h/m1/3')
          assert.equal(await o.lire(), '/api/h/m1/3')
          assert.deepEqual(o.erreurs, [])
        } finally {
          await o.ctx.close()
        }
      })
    }

    for (const mode of ['dev-parents-avant', 'lisible'] as const) {
      it(`un composant parti avant la réponse n'est plus prévenu ni gardé, ni à l'arrivée ni après l'envoi suivant (${mode === 'lisible' ? 'production non minifiée' : mode})`, async function () {
        if (!present) { this.skip(); return }
        const o = await ouvrir(mode, 'mjs-pdep')
        try {
          const enfant = `${o.el}._shadow.querySelector('mjs-c-dep')`
          assert.ok(await o.page.evaluate(`(() => { const k = ${enfant}; window.__k = k; k.__n = 0; const f = k._mjs_invalidate; k._mjs_invalidate = function () { k.__n++; return f.apply(this, arguments) }; return k.isConnected })()`), 'enfant monté')
          await o.appeler('basculer', false, 400)
          const tient = () => o.page.evaluate(`typeof _mjsLdEntries === 'undefined' ? 'invisible' : ['/api/h/dep', '/api/h/dep0'].filter((u) => { const e = _mjsLdEntries.get(u); return !!(e && e.o && e.o.has(window.__k)) }).join()`)
          const t1 = await tient()
          await repondre((m) => m === 'GET /api/h/dep' || m === 'GET /api/h/dep0')
          await o.appeler('envoyer', '/api/h/dep', 400)
          assert.deepEqual(vus.filter((m) => m === 'GET /api/h/dep').length, 2, 'le parent, qui lit l\'adresse, la relit')
          await repondre((m) => m === 'GET /api/h/dep')
          assert.equal(await o.lire(), '/api/h/dep')
          assert.equal(await o.page.evaluate('window.__k.isConnected + "," + window.__k.__n'), 'false,0', 'composant parti prévenu après son départ')
          if (mode !== 'lisible') assert.equal(t1, '', 'les entrées lâchent le composant à son départ')
          assert.deepEqual(o.erreurs, [])
        } finally {
          await o.ctx.close()
        }
      })
    }
  })
})
