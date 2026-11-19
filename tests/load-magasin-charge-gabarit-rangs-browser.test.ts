// µload en navigateur réel (Chromium, Firefox, WebKit), en développement et en production, contre un vrai serveur Node : le gabarit, racine
// comprise, qui appelle µload pendant 100 frappes est redessiné à chaque arrivée sans lire ses adresses — seule l'adresse affichée est
// relue, une fois, après un envoi, le cache borné à 50 adresses ; une dérivée qui lit la donnée de deux appels (`or`) se recalcule à chaque arrivée et lâche l'adresse qu'elle
// n'appelle plus ; le même appel fait pour chaque rang d'une liste (`map`) montre à chaque rang la donnée de sa propre adresse

import assert from 'node:assert/strict'
import http from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire } from './helpers/liaison-navigateur.js'
import type { Cible } from './helpers/liaison-navigateur.js'
import { playTogether } from './helpers/engines-together.js'

const RECH = `  $q = ''\n  @chercher = (q) -> $q = q\n  @envoyer  = (u) -> µ.ajax.patch(u, {})\n`
const SOURCES: Record<string, string> = {
  'tbloc.mjs':   `<script>\n${RECH}  $on = true\n</script>\n<b class="w">w</b>{if $on}<i class="v">{µload("/api/auto/tb?q=#{encodeURIComponent($q)}").data?.n}</i>{end}\n`,
  'tracine.mjs': `<script>\n${RECH}</script>\n<b class="w">w</b><i class="v">{µload("/api/auto/tr?q=#{encodeURIComponent($q)}").data?.n}</i>\n`,
  'dou.mjs':     `<script>\n  @envoyer = (u) -> µ.ajax.patch(u, {})\n  $m = µload('/api/h/oa').data?.n or µload('/api/h/ob').data?.n or 'att'\n</script>\n<b class="w">w</b><i class="v">{$m}</i>\n`,
  'dmap.mjs':    `<script>\n  $ids = [1, 2]\n  @poser = (l) -> $ids = l\n  @envoyer = (u) -> µ.ajax.patch(u, {})\n  $d = $ids.map((i) -> µload("/api/h/m/#{i}"))\n</script>\n<b class="w">w</b><i class="v">{$d.map((x) -> x.data?.n or 'att').join(',')}</i>\n`,
}
const BALISES = Object.keys(SOURCES).map((f) => 'mjs-' + f.replace('.mjs', ''))

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))
const memoireDisponible = () => Number(readFileSync('/proc/meminfo', 'utf-8').split('\n').find((l) => l.startsWith('MemAvailable:'))!.split(/\s+/)[1]) / 1048576

type Tenue = { motif: string, res: any, fermee: boolean }

describe('µload : le gabarit prévenu sans lire, la dérivée recalculée à chaque arrivée, chaque rang sa donnée — navigateur réel, vrai serveur Node', function () {
  this.timeout(280000)
  const cibles: Record<string, Cible> = {}

  before(async () => {
    for (const mode of ['dev-parents-avant', 'split'] as const) cibles[mode] = await construire(mode, SOURCES, BALISES)
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const moteur of ['chromium', 'firefox', 'webkit'] as const) playTogether(describe(moteur, function () {
    // un serveur et ses relevés par moteur : les trois moteurs jouent ensemble, chacun ses requêtes tenues et sa page
    let srv: any = null
    let port     = 0
    let doc      = ''
    let racine   = ''
    const vus: string[]   = []
    const tenues: Tenue[] = []

    // répondre aux requêtes tenues que `filtre` retient (le corps nomme l'adresse lue)
    const repondre = async (filtre: (m: string) => boolean) => {
      for (const t of tenues.filter((x) => !x.fermee && !x.res.writableEnded && filtre(x.motif))) {
        t.res.writeHead(200, { 'content-type': 'application/json' })
        t.res.end(JSON.stringify({ n: t.motif.replace(/^[A-Z]+ /, '') }))
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
        // la frappe : réponse tout de suite
        if (chemin.startsWith('/api/auto/') || req.method !== 'GET') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ n: chemin + url.search })); return }
        res.on('close', () => { if (!res.writableEnded) t.fermee = true })
        tenues.push(t)
      })
      await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', () => ok()))
      port = srv.address().port
    })

    after(async () => { if (srv) { srv.closeAllConnections(); srv.close() } })

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

    // la page du composant ; `appeler` joue une méthode du composant, `lire` ses textes `.v`, `relues` les adresses lues après un envoi,
    // `etat` ce que le développement laisse voir (poignées lues par le composant, entrées, cache, rendus)
    async function ouvrir(mode: string, balise: string) {
      doc    = cibles[mode].document(balise, '')
      racine = cibles[mode].racine
      vus.length = 0
      tenues.length = 0
      const ctx  = await browser.newContext()
      const page = await ctx.newPage()
      const erreurs: string[] = []
      page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e)))
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' })
      const el = `document.querySelector('${balise}')`
      await page.waitForFunction(`!!(${el}?._shadow || ${el}?.shadowRoot)?.querySelector('.w')`, null, { timeout: 15000 })
      await page.evaluate(`(() => { window.__inv = 0; if (typeof µ === 'undefined' || !µ.Element) return; const p = µ.Element.prototype, f = p._mjs_invalidate; p._mjs_invalidate = function () { window.__inv++; return f.apply(this, arguments) } })()`)
      await pause(400)
      const appeler = async (methode: string, valeur: unknown, attente: number) => { await page.evaluate(`(${el}.${methode}(${JSON.stringify(valeur)}), null)`); await pause(attente) }
      const lire    = () => page.evaluate(`[...((${el}._shadow || ${el}.shadowRoot).querySelectorAll('.v'))].map((x) => x.textContent).join('|') || '(absente)'`)
      const etat    = () => page.evaluate(`({ ldH: ${el}._mjs_ldH ? ${el}._mjs_ldH.size : 0, entrees: typeof _mjsLdEntries !== 'undefined' ? _mjsLdEntries.size : null, libres: typeof _mjsLdFree !== 'undefined' ? _mjsLdFree.size : null, inv: window.__inv })`)
      const relues  = async (chemin: string) => {
        const n = vus.length
        await appeler('envoyer', chemin, 600)
        const apres = vus.slice(n).filter((m) => m.startsWith('GET'))
        await repondre(() => true)
        return apres
      }
      return { ctx, page, erreurs, appeler, lire, etat, relues }
    }

    for (const mode of ['dev-parents-avant', 'split'] as const) {
      const dev = mode !== 'split'
      for (const [balise, chemin] of [['mjs-tbloc', '/api/auto/tb'], ['mjs-tracine', '/api/auto/tr']]) {
        it(`le gabarit (${balise === 'mjs-tbloc' ? 'branche d\'un {if}' : 'liaison de la racine'}) : 100 frappes puis deux envois — redessiné à chaque arrivée, seule l'adresse affichée relue une fois par envoi, cache borné (${mode})`, async function () {
          if (!present) { this.skip(); return }
          const o = await ouvrir(mode, balise)
          try {
            for (let i = 1; i <= 100; i++) await o.appeler('chercher', 'k' + i, 20)
            await pause(1500)
            assert.equal(vus.filter((m) => m.startsWith('GET ' + chemin)).length, 101)
            assert.equal(await o.lire(), `${chemin}?q=k100`, 'le gabarit redessiné à l\'arrivée de la dernière donnée')
            const e1 = await o.etat()
            if (dev) {
              assert.equal(e1.ldH, 0, 'le composant ne lit aucune poignée de son gabarit')
              assert.ok(e1.entrees <= 51 && e1.libres <= 50, 'cache borné ' + JSON.stringify(e1))
              assert.ok(e1.inv <= 200, 'deux rendus par frappe au plus ' + JSON.stringify(e1))
            }
            for (const tour of [1, 2]) {
              const avant = (await o.etat()).inv
              assert.deepEqual(await o.relues(chemin), [`GET ${chemin}?q=k100`], `envoi nº ${tour} : seule l'adresse affichée est relue, une fois`)
              if (dev) assert.equal((await o.etat()).inv - avant, 1, `envoi nº ${tour} : un rendu, à l'arrivée`)
            }
            assert.equal(await o.lire(), `${chemin}?q=k100`)
            assert.deepEqual(o.erreurs, [])
          } finally {
            await o.ctx.close()
          }
        })
      }

      it(`une dérivée qui lit la donnée de deux appels (or) : recalculée à chaque arrivée, l'adresse qu'elle n'appelle plus lâchée (${mode})`, async function () {
        if (!present) { this.skip(); return }
        const o = await ouvrir(mode, 'mjs-dou')
        try {
          assert.deepEqual([...vus].sort(), ['GET /api/h/oa', 'GET /api/h/ob'])
          assert.equal(await o.lire(), 'att')
          await repondre((m) => m === 'GET /api/h/ob')
          assert.equal(await o.lire(), '/api/h/ob', 'la donnée de ob arrivée est affichée')
          await repondre((m) => m === 'GET /api/h/oa')
          assert.equal(await o.lire(), '/api/h/oa', 'la donnée de oa arrivée est affichée')
          assert.deepEqual(await o.relues('/api/h/ob'), [], 'ob, que la dérivée n\'appelle plus, n\'est plus relue')
          assert.deepEqual(await o.relues('/api/h/oa'), ['GET /api/h/oa'])
          assert.deepEqual(o.erreurs, [])
        } finally {
          await o.ctx.close()
        }
      })

      it(`le même appel pour chaque rang d'une liste (map) : chaque rang sa donnée — gardée au cache, sinon l'attente —, jamais celle d'un autre rang (${mode})`, async function () {
        if (!present) { this.skip(); return }
        const o = await ouvrir(mode, 'mjs-dmap')
        try {
          await repondre(() => true)
          assert.equal(await o.lire(), '/api/h/m/1,/api/h/m/2')
          await o.appeler('poser', [3, 2], 300)
          assert.equal(await o.lire(), 'att,/api/h/m/2', 'le rang de l\'id 3 attend, sans la donnée de l\'id 1')
          await repondre((m) => m === 'GET /api/h/m/3')
          assert.equal(await o.lire(), '/api/h/m/3,/api/h/m/2')
          const n = vus.length
          await o.appeler('poser', [2, 3], 300)
          assert.equal(await o.lire(), '/api/h/m/2,/api/h/m/3', 'rangs échangés : chacun sa donnée, gardée')
          assert.deepEqual(vus.slice(n), [])
          assert.deepEqual(await o.relues('/api/h/m/1'), [], 'l\'id 1, quitté, n\'est plus relu')
          assert.deepEqual(o.erreurs, [])
        } finally {
          await o.ctx.close()
        }
      })
    }
  }))
})
