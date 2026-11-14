// µload en navigateur réel (Chromium, Firefox, WebKit), en développement et en production : la frappe d'une recherche écrite dans un
// `<script lang="ts">` garde la liste d'avant pendant l'attente, comme en Civet ; un `switch`, un `try` ou un `do` écrits dans
// l'expression de la dérivée la gardent aussi, comme l'appel direct et `µderived` ; une appli dont le seul µload est dans un script
// TypeScript se rend

import assert from 'node:assert/strict'
import http from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, type Cible } from './helpers/liaison-navigateur.js'

const RECHERCHE = [
  `<script>\n  $q = 'a'\n  $m = 'a'\n  @taper = (v) -> $q = v`,
  `  $a = (switch $m\n    when 'a' then µload("/api/h/sw?q=#{$q}")\n    else null)?.data?.n or 'att'`,
  `  $b = (try µload("/api/h/tr?q=#{$q}") catch then null)?.data?.n or 'att'`,
  `  $c = (do\n    u = "/api/h/do?q=#{$q}"\n    µload(u))?.data?.n or 'att'`,
  `  $d = µload("/api/h/di?q=#{$q}").data?.n or 'att'`,
  `  µderived $e = µload("/api/h/de?q=#{$q}"), $q\n</script>`,
  `<b class="w">w</b><i class="v">{$a}</i><i class="v">{$b}</i><i class="v">{$c}</i><i class="v">{$d}</i><i class="v">{$e.data?.n or 'att'}</i>\n`,
].join('\n')
const TTS     = `<script lang="ts">\n  $q = 'a'\n  $r = µload(\`/api/h/ts?q=\${$q}\`)\n</script>\n<b class="w">w</b><input class="q" aria-label="q" value=!{$q}><i class="v">{$r.data?.n || 'att'}</i>\n`
const TCV     = `<script>\n  $q = 'a'\n  $r = µload("/api/h/cv?q=#{$q}")\n</script>\n<b class="w">w</b><input class="q" aria-label="q" value=!{$q}><i class="v">{$r.data?.n or 'att'}</i>\n`
const SOURCES: Record<string, string> = { 'trech.mjs': RECHERCHE, 'tts.mjs': TTS, 'tcv.mjs': TCV }
const TS_SEUL: Record<string, string> = { 'tts.mjs': TTS }
const balises = (sources: Record<string, string>) => Object.keys(sources).map((f) => 'mjs-' + f.replace('.mjs', ''))

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))
const memoireDisponible = () => Number(readFileSync('/proc/meminfo', 'utf-8').split('\n').find((l) => l.startsWith('MemAvailable:'))!.split(/\s+/)[1]) / 1048576

type Tenue = { motif: string, res: any }

describe('µload : recherche dans un script TypeScript, switch / try / do dans l\'expression — navigateur réel, dev et production', function () {
  this.timeout(280000)
  let srv: any = null
  let port     = 0
  let doc      = ''
  let racine   = ''
  let seq      = 0
  const vus: string[]   = []
  const tenues: Tenue[] = []
  const cibles: Record<string, Cible> = {}
  const seuls: Record<string, Cible>  = {}
  // répond aux GET tenus de `/api/h/` : `{ n: '<adresse>#<rang>' }`
  const repondre = async () => {
    for (const t of tenues.filter((x) => !x.res.writableEnded)) {
      t.res.writeHead(200, { 'content-type': 'application/json' })
      t.res.end(JSON.stringify({ n: t.motif + '#' + (++seq) }))
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
      if (!chemin.startsWith('/api/h/')) { res.writeHead(404); res.end(); return }
      vus.push(chemin + url.search)
      tenues.push({ motif: chemin + url.search, res })
    })
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', () => ok()))
    port = srv.address().port
    for (const mode of ['dev-parents-avant', 'split'] as const) {
      cibles[mode] = await construire(mode, SOURCES, balises(SOURCES))
      seuls[mode]  = await construire(mode, TS_SEUL, balises(TS_SEUL))
    }
  })
  after(async () => { await terminateSharedWorkerPool(); if (srv) { srv.closeAllConnections(); srv.close() } })

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

    async function ouvrir(cible: Cible, balise: string) {
      doc    = cible.document(balise, '')
      racine = cible.racine
      vus.length    = 0
      tenues.length = 0
      const ctx  = await browser.newContext()
      const page = await ctx.newPage()
      const erreurs: string[] = []
      page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e)))
      page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push(m.text().slice(0, 200)) })
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' })
      const el = `document.querySelector('${balise}')`
      try {
        await page.waitForFunction(`!!(${el}?._shadow || ${el}?.shadowRoot)?.querySelector('.w')`, null, { timeout: 8000 })
      }
      catch {
        await ctx.close()
        assert.fail(`${balise} jamais rendu : ${JSON.stringify(erreurs.slice(0, 2))}`)
      }
      const lire   = (): Promise<string[]> => page.evaluate(`[...((${el}._shadow || ${el}.shadowRoot).querySelectorAll('.v'))].map((x) => x.textContent)`)
      const saisir = async (v: string) => {
        await page.evaluate(`(() => { const i = (${el}._shadow || ${el}.shadowRoot).querySelector('input.q'); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input', { bubbles: true })) })()`)
        await pause(300)
      }
      const taper  = async (v: string) => { await page.evaluate(`(${el}.taper(${JSON.stringify(v)}), null)`); await pause(400) }
      return { ctx, erreurs, lire, saisir, taper }
    }

    for (const mode of ['dev-parents-avant', 'split'] as const) {
      it(`switch, try, do, appel direct et µderived gardent la donnée d'avant pendant la frappe (${mode})`, async function () {
        if (!present) this.skip()
        const o = await ouvrir(cibles[mode], 'mjs-trech')
        try {
          await pause(300)
          await repondre()
          const avant = await o.lire()
          await o.taper('ab')
          const attente = await o.lire()
          await repondre()
          const apres = await o.lire()
          const noms  = ['(switch …)?.data', '(try …)?.data', '(do …)?.data', 'appel direct', 'µderived']
          assert.deepEqual(avant.map((x) => /q=a#/.test(x)), [true, true, true, true, true], 'au départ : ' + avant.join(' | '))
          assert.deepEqual(attente.map((x, i) => noms[i] + (/q=a#/.test(x) ? ' : donnée d\'avant' : ' : ' + x)), noms.map((n) => n + ' : donnée d\'avant'))
          assert.ok(apres.every((x) => /q=ab#/.test(x)), 'après l\'arrivée : ' + apres.join(' | '))
          assert.deepEqual(o.erreurs, [])
        }
        finally {
          await o.ctx.close()
        }
      })

      for (const [cas, balise, seul] of [['script TypeScript', 'mjs-tts', false], ['script Civet', 'mjs-tcv', false], ['appli dont le seul µload est dans un script TypeScript', 'mjs-tts', true]] as const) {
        it(`${cas} : la frappe d'une recherche garde la liste d'avant (${mode})`, async function () {
          if (!present) this.skip()
          const o = await ouvrir(seul ? seuls[mode] : cibles[mode], balise)
          try {
            await pause(300)
            assert.equal(vus.length, 1, 'requêtes au départ : ' + vus.join(', '))
            await repondre()
            const avant = (await o.lire())[0]
            await o.saisir('ab')
            const attente = (await o.lire())[0]
            await repondre()
            const apres = (await o.lire())[0]
            assert.ok(/q=a#/.test(avant) && /q=a#/.test(attente) && /q=ab#/.test(apres), `${avant} → ${attente} → ${apres} (attendu : la liste d'avant pendant l'attente)`)
            assert.deepEqual(o.erreurs, [])
          }
          finally {
            await o.ctx.close()
          }
        })
      }
    }
  })
})
