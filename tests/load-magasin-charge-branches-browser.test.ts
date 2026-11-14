// µload écrit dans le gabarit, en navigateur réel (Chromium, Firefox, WebKit), en développement et en production, contre un vrai serveur
// Node qui tient chaque réponse jusqu'à l'ordre du test et note les requêtes que le navigateur annule (connexion fermée avant la réponse) :
// une passe des blocs ne refait aucune liaison — la liaison de la racine qui lève : son erreur n'est jamais tue, son adresse est relue une fois
// après un envoi, et
// 50 liaisons à µload coûtent à une bascule voisine ce que coûte une page sans µload qui affiche les mêmes textes ; dans le gabarit, racine
// comprise, le développement dit d'écrire l'appel dans une dérivée du script, qui annule les requêtes dépassées et ne laisse relire que
// l'adresse du moment ; dans une dérivée, un appel ne montre jamais la donnée d'un autre (deux adresses dans un ternaire), et l'adresse
// qu'elle n'appelle plus est lâchée

import assert from 'node:assert/strict'
import http from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire } from './helpers/liaison-navigateur.js'
import type { Cible } from './helpers/liaison-navigateur.js'

const l50 = (f: (i: number) => string) => Array.from({ length: 50 }, (_, i) => f(i)).join('\n')

const SOURCES: Record<string, string> = {
  'piege.mjs': `<script>
  $on = true
  @basculer = (v) -> $on = v
  @envoyer  = (u) -> µ.ajax.patch(u, {})
  @relire   = (u) -> µload(u).refresh()
  @piege    = ->
    if window.__casse
      window.__levees++
      JSON.parse('{boom')
    else
      ''
</script>
<b class="w">w</b>{if $on}<s>x</s>{end}<i class="v">{@piege() + (µload("/api/eh").data?.n or '')}</i>
`,
  'liste.mjs': `<script>
  $q     = ''
  $autre = [1, 2]
  @chercher = (q) -> $q = q
</script>
<b class="w">w</b>{for m in (µload("/api/df?q=#{encodeURIComponent($q)}").data?.l or [])}<i class="v">{m}</i>{end}{for x in $autre}<u>{x}</u>{end}
`,
  'derivee.mjs': `<script>
  $q     = ''
  $autre = [1, 2]
  $l     = µload("/api/dl?q=#{encodeURIComponent($q)}")
  @chercher = (q) -> $q = q
  @envoyer  = (u) -> µ.ajax.patch(u, {})
</script>
<b class="w">w</b>{for m in ($l.data?.l or [])}<i class="v">{m}</i>{end}{for x in $autre}<u>{x}</u>{end}
`,
  'c50.mjs': `<script>
  $on = true
  @basculer = (v) -> $on = v
</script>
<b class="w">w</b>{if $on}<s>x</s>{end}
${l50((i) => `<i>{µload("/api/c/${i}").data?.n}</i>`)}
`,
  'ternaire.mjs': `<script>
  $on = true
  @basculer = (v) -> $on = v
  @envoyer  = (u) -> µ.ajax.patch(u, {})
</script>
<b class="w">w</b><i class="v">{(if $on then 'A:' + (µload("/api/ta").data?.n or 'att') else 'B:' + (µload("/api/tb").data?.n or 'att'))}</i>
`,
  'tderivee.mjs': `<script>
  $on = true
  $m  = if $on then µload("/api/da") else µload("/api/db")
  @basculer = (v) -> $on = v
  @envoyer  = (u) -> µ.ajax.patch(u, {})
</script>
<b class="w">w</b><i class="v">{(if $on then 'A:' else 'B:') + ($m.data?.n or 'att')}</i>
`,
  'arret.mjs': `<script>
  $on = true
  $q  = ''
  @basculer = (v) -> $on = v
  @chercher = (q) -> $q = q
  @envoyer  = (u) -> µ.ajax.patch(u, {})
</script>
<b class="w">w</b><i class="v">{(if $on then µload("/api/tn?q=#{$q}").data?.n or 'att' else 'off')}</i>
`,
  'p50.mjs': `<script>
  $on = true
  $d  = Object.fromEntries(Array.from({ length: 50 }, (_, i) -> ["c#{i}", { n: "/api/c/#{i}" }]))
  @basculer = (v) -> $on = v
</script>
<b class="w">w</b>{if $on}<s>x</s>{end}
${l50((i) => `<i>{$d["c${i}"]?.n}</i>`)}
`,
  'simple.mjs': `<script>
  $q = ''
  @chercher = (q) -> $q = q
</script>
<b class="w">w</b><i class="v">{µload("/api/gs?q=#{$q}").data?.n}</i>
`,
  'ou.mjs': `<b class="w">w</b><i class="v">{µload("/api/oa").data?.n or µload("/api/ob").data?.n or 'att'}</i>
`,
}
const BALISES = Object.keys(SOURCES).map((f) => 'mjs-' + f.replace('.mjs', ''))

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))
const memoireDisponible = () => Number(readFileSync('/proc/meminfo', 'utf-8').split('\n').find((l) => l.startsWith('MemAvailable:'))!.split(/\s+/)[1]) / 1048576

type Tenue = { motif: string, res: any, fermee: boolean }

describe('µload dans le gabarit : la racine sans seconde passe, un bloc averti, navigateur réel, vrai serveur Node', function () {
  this.timeout(240000)
  let srv: any = null
  let port     = 0
  let doc      = ''
  let racine   = ''
  const vus: string[]    = []
  const fermes: string[] = []
  const tenues: Tenue[]  = []
  const cibles: Record<string, Cible> = {}

  // les requêtes qui attendent encore leur réponse ; répondre à celles que `filtre` retient (le corps nomme l'adresse lue)
  const ouvertes = () => tenues.filter((t) => !t.fermee && !t.res.writableEnded).map((t) => t.motif)
  const repondre = async (filtre: (m: string) => boolean) => {
    for (const t of tenues.filter((x) => !x.fermee && !x.res.writableEnded && filtre(x.motif))) {
      const n = t.motif.replace(/^[A-Z]+ /, '')
      t.res.writeHead(200, { 'content-type': 'application/json' })
      t.res.end(JSON.stringify({ n, l: [n] }))
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
      // les 50 liaisons : réponse tout de suite
      if (chemin.startsWith('/api/c/')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ n: chemin })); return }
      res.on('close', () => { if (!res.writableEnded) { t.fermee = true; fermes.push(t.motif) } })
      tenues.push(t)
    })
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', () => ok()))
    port = srv.address().port
    for (const mode of ['dev-parents-avant', 'split'] as const) cibles[mode] = await construire(mode, SOURCES, BALISES)
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

    // la page du composant, ses erreurs et ses avertissements ; `appeler` joue une méthode du composant, `lire` ses textes `.v`
    async function ouvrir(mode: string, balise: string) {
      doc    = cibles[mode].document(balise, '')
      racine = cibles[mode].racine
      vus.length = 0
      fermes.length = 0
      tenues.length = 0
      const ctx  = await browser.newContext()
      const page = await ctx.newPage()
      const erreurs: string[] = []
      const avis: string[]    = []
      page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e)))
      page.on('console', (m: any) => { if (m.type() === 'warning' || m.type() === 'error') avis.push(m.text()) })
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' })
      const el = `document.querySelector('${balise}')`
      await page.waitForFunction(`!!(${el}?._shadow || ${el}?.shadowRoot)?.querySelector('.w')`, null, { timeout: 15000 })
      await pause(400)
      const appeler = async (methode: string, valeur: string | number | boolean, attente: number) => { await page.evaluate(`(${el}.${methode}(${JSON.stringify(valeur)}), null)`); await pause(attente) }
      const lire    = () => page.evaluate(`[...((${el}._shadow || ${el}.shadowRoot).querySelectorAll('.v'))].map((x) => x.textContent).join('|') || '(absente)'`)
      // les adresses lues (GET) après un envoi au chemin
      const relues  = async (chemin: string) => {
        const n = vus.length
        await appeler('envoyer', chemin, 200)
        await repondre((m) => m.startsWith('PATCH'))
        const apres = vus.slice(n).filter((m) => !m.startsWith('PATCH'))
        await repondre(() => true)
        return apres
      }
      return { ctx, page, el, erreurs, avis, appeler, lire, relues }
    }

    for (const mode of ['dev-parents-avant', 'split'] as const) {
      it(`une liaison de la racine qui lève, puis la bascule d'un {if} voisin : toute erreur levée est dite ; l'adresse affichée est relue une fois après un envoi, le gabarit est redessiné à son arrivée (${mode})`, async function () {
        if (!present) { this.skip(); return }
        const o = await ouvrir(mode, 'mjs-piege')
        try {
          await repondre(() => true)
          assert.equal(await o.lire(), '/api/eh')
          const dites = () => o.avis.filter((a) => /Crash intercepted/.test(a)).length
          await o.page.evaluate('window.__casse = true; window.__levees = 0')
          await o.appeler('basculer', false, 300)
          assert.equal(await o.page.evaluate('window.__levees'), dites(), 'toute erreur levée par une liaison est dite')
          assert.equal(await o.lire(), '/api/eh')
          // l'adresse affichée est relue une fois : sa donnée redessine le composant, la liaison lève à son tour ordinaire, et l'erreur est dite
          assert.deepEqual(await o.relues('/api/eh'), ['GET /api/eh'], 'l\'adresse affichée est relue une fois après un envoi')
          assert.equal(await o.page.evaluate('window.__levees'), 1)
          assert.equal(dites(), 1, o.avis.join('\n'))
        } finally {
          await o.ctx.close()
        }
      })

      it(`un bloc du gabarit : le développement dit d'écrire une dérivée, la production se tait ; écrite dans une dérivée à côté d'un autre {for}, la frappe annule les requêtes dépassées (${mode})`, async function () {
        if (!present) { this.skip(); return }
        let o = await ouvrir(mode, 'mjs-liste')
        try {
          const avis = o.avis.filter((a) => /µload/.test(a))
          if (mode === 'split') assert.deepEqual(avis, [])
          else {
            assert.equal(avis.length, 1, avis.join('\n'))
            assert.match(avis[0], /µload\("\/api\/df\?q="\) appelé dans le gabarit de <mjs-liste>/)
            assert.match(avis[0], /Écrivez l'appel dans une dérivée du script \(\$membres = µload\(…\)/)
          }
        } finally {
          await o.ctx.close()
        }
        o = await ouvrir(mode, 'mjs-derivee')
        try {
          assert.deepEqual(vus, ['GET /api/dl?q='])
          await repondre(() => true)
          const f0 = fermes.length
          for (const q of ['c', 'ca', 'cat']) await o.appeler('chercher', q, 40)
          await pause(400)
          assert.deepEqual(fermes.slice(f0), ['GET /api/dl?q=c', 'GET /api/dl?q=ca'], 'les requêtes dépassées sont annulées')
          assert.deepEqual(ouvertes(), ['GET /api/dl?q=cat'])
          await repondre(() => true)
          assert.equal(await o.lire(), '/api/dl?q=cat')
          assert.deepEqual(await o.relues('/api/dl'), ['GET /api/dl?q=cat'], 'seule l\'adresse du moment est relue')
          assert.deepEqual(o.avis.filter((a) => /µload/.test(a)), [])
          assert.deepEqual(o.erreurs, [])
        } finally {
          await o.ctx.close()
        }
      })

      it(`un appel ne montre jamais la donnée d'un autre (ternaire d'une dérivée) ; la dérivée lâche l'adresse qu'elle n'appelle plus (${mode})`, async function () {
        if (!present) { this.skip(); return }
        for (const [balise, a, b] of [['mjs-tderivee', '/api/da', '/api/db']]) {
          const o = await ouvrir(mode, balise)
          try {
            await repondre(() => true)
            assert.equal(await o.lire(), 'A:' + a)
            await o.appeler('basculer', false, 300)
            assert.equal(await o.lire(), 'B:att', balise + ' : la donnée de A ne s\'affiche jamais sous B')
            assert.deepEqual(ouvertes(), ['GET ' + b])
            const f0 = fermes.length
            await o.appeler('basculer', true, 300)
            assert.equal(await o.lire(), 'A:' + a, balise + ' : A, déjà lue, revient du cache')
            assert.deepEqual(fermes.slice(f0), ['GET ' + b], balise + ' : la requête de B, que plus rien ne lit, est annulée')
            await o.appeler('basculer', false, 300)
            await repondre(() => true)
            assert.equal(await o.lire(), 'B:' + b)
            await o.appeler('basculer', true, 300)
            assert.equal(await o.lire(), 'A:' + a)
            assert.deepEqual(await o.relues(b), [], balise + ' : l\'adresse quittée n\'est plus relue après un envoi')
            assert.deepEqual(await o.relues(a), ['GET ' + a])
            assert.deepEqual(o.erreurs, [])
          } finally {
            await o.ctx.close()
          }
        }
      })

      it(`le gabarit, racine comprise (liaison simple, ternaire entre deux appels, or, liaison qui cesse d'appeler, liaison qui lève, 50 liaisons) : le développement avertit une fois par composant, la production se tait (${mode})`, async function () {
        if (!present) { this.skip(); return }
        for (const [balise, url] of [['mjs-simple', '/api/gs?q='], ['mjs-ternaire', '/api/ta'], ['mjs-ou', '/api/oa'], ['mjs-arret', '/api/tn?q='], ['mjs-piege', '/api/eh'], ['mjs-c50', '/api/c/']]) {
          const o = await ouvrir(mode, balise)
          try {
            await repondre(() => true)
            if (balise === 'mjs-simple') for (const q of ['a', 'ab']) await o.appeler('chercher', q, 100)
            if (balise === 'mjs-ternaire' || balise === 'mjs-arret') {
              await o.appeler('basculer', false, 200)
              await o.appeler('basculer', true, 200)
            }
            await repondre(() => true)
            const avis = o.avis.filter((a) => /µload/.test(a))
            if (mode === 'split') assert.deepEqual(avis, [], balise + ' : la production se tait')
            else {
              assert.equal(avis.length, 1, balise + ' — ' + avis.join('\n'))
              assert.ok(avis[0].includes(`µload("${url}`) && avis[0].includes(`appelé dans le gabarit de <${balise}>`), avis[0])
              assert.match(avis[0], /Écrivez l'appel dans une dérivée du script \(\$membres = µload\(…\)/)
            }
            assert.deepEqual(o.erreurs, [])
          } finally {
            await o.ctx.close()
          }
        }
      })

      it(`50 liaisons de la racine à µload, 400 bascules d'un {if} voisin : aucune requête, aucun appel de µload, le temps d'une page sans µload (${mode})`, async function () {
        if (!present) { this.skip(); return }
        const mesures: Record<string, number[]> = { 'mjs-c50': [], 'mjs-p50': [] }
        // A/B côte à côte (ABBA) : la machine peut être chargée, les temps sont rapportés, pas jugés
        for (const balise of ['mjs-c50', 'mjs-p50', 'mjs-p50', 'mjs-c50']) {
          const o = await ouvrir(mode, balise)
          try {
            const avant = vus.length
            const r: any = await o.page.evaluate(`(async () => {
              const el = ${o.el}, ch = new MessageChannel(), tour = () => new Promise((ok) => { ch.port1.onmessage = () => ok(null); ch.port2.postMessage(0) })
              const m = globalThis.µ, f = m && m.load
              let appels = 0
              if (f) { m.load = function () { appels++; return f.apply(this, arguments) }; m.load.refresh = f.refresh }
              const t0 = performance.now()
              for (let i = 0; i < 400; i++) { el.basculer(i % 2 === 1); await tour() }
              const ms = performance.now() - t0
              if (f) m.load = f
              return { ms, appels: f ? appels : null, s: !!(el._shadow || el.shadowRoot).querySelector('s') }
            })()`)
            mesures[balise].push(Math.round(r.ms))
            assert.equal(r.s, true, 'les bascules se sont rendues')
            assert.deepEqual(vus.slice(avant), [], 'aucune requête pendant les bascules')
            // µ n'est global qu'en développement : le compte des appels s'y lit
            if (balise === 'mjs-c50' && mode !== 'split') assert.equal(r.appels, 0, 'une bascule voisine ne refait aucune liaison à µload')
            assert.deepEqual(o.erreurs, [])
          } finally {
            await o.ctx.close()
          }
        }
        console.log(`    ${moteur} ${mode} — 400 bascules, ms (A/B/B/A) : 50 liaisons µload ${mesures['mjs-c50'].join(', ')} · page sans µload ${mesures['mjs-p50'].join(', ')}`)
      })
    }
  })
})
