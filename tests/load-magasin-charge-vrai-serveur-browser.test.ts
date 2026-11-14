// µload en navigateur réel (Chromium, Firefox, WebKit), en développement et en production, contre un vrai serveur Node qui compte
// les requêtes : le texte de `error` d'une réponse qui n'est pas du JSON est le même en production qu'en développement ; la page
// d'une route sans `mode` (prérendue par défaut) rendue par le serveur repart avec sa donnée, sans requête, dans un client construit
// normalement, comme dans un client construit sans bloc `render` ni `hydrate` (le serveur rend par l'API) ; µload écrit dans le gabarit (racine comprise), un µeffect, une aide du gabarit ou une ligne de `{for}` avertit en développement, jamais en production.

import assert from 'node:assert/strict'
import http from 'node:http'
import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer, stripEsm } from '../src/server/renderToString.js'
import { construire } from './helpers/liaison-navigateur.js'
import type { Cible } from './helpers/liaison-navigateur.js'
import { mjsTmp } from './helpers/tmp.js'

const SOURCES: Record<string, string> = {
  'pasjson.mjs': `<script>
  $p = µload('/api/pasjson')
</script>
<p class="d">{JSON.stringify($p.data)}</p><b class="e">{$p.error?.message}</b><i class="p">{$p.pending}</i>
`,
  'lieux.mjs': `<script>
  $q   = 'a'
  $ids = [1, 2]
  $n   = '-'
  $me  = µload('/api/me')
  $m   = µload("/api/m?q=#{$q}")
  µeffect -> $n = µload("/api/e?q=#{$q}").data?.v or '-'
  @aide = (q) -> µload("/api/h?q=#{q}")
</script>
<i class="t">{µload("/api/t?q=#{$q}").data?.v}</i><i class="h">{@aide($q).data?.v}</i><s class="n">{$n}</s>
<div>{for id in $ids}<b class="r">{µload("/api/u/#{id}").data?.v}</b>{end}</div>
`,
}
const TEXTE_PAS_JSON = 'µload : la réponse de /api/pasjson n\'est pas du JSON.'

const memoireDisponible = () => Number(readFileSync('/proc/meminfo', 'utf-8').split('\n').find((l) => l.startsWith('MemAvailable:'))!.split(/\s+/)[1]) / 1048576

describe('µload en navigateur réel, vrai serveur Node', function () {
  this.timeout(240000)
  let srv: any = null
  let port     = 0
  let doc      = ''
  let racine   = ''
  const vus: string[] = []
  const cibles: Record<string, Cible> = {}
  const reprises: Record<string, { doc: string, racine: string }> = {}

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
      vus.push(req.method + ' ' + chemin + url.search)
      if (chemin === '/api/pasjson') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html><body>Connexion</body></html>'); return }
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
      res.end(JSON.stringify(chemin === '/api/me' ? { pseudo: 'Srv' } : { v: chemin + url.search }))
    })
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', () => ok()))
    port = srv.address().port
    for (const mode of ['dev-parents-avant', 'split'] as const) cibles[mode] = await construire(mode, SOURCES, ['mjs-pasjson', 'mjs-lieux'])
    // la page d'une route sans mode : rendue par un vrai rendu serveur, le client construit à part, normalement, avec la config de l'appli
    const moi    = `<script>\n  $me = µload('http://127.0.0.1:${port}/api/me')\n</script>\n<p class="nom">{$me.data?.pseudo}</p><i class="att">{$me.pending}</i>\n`
    const sroot  = mjsTmp('load-reprise-srv')
    mkdirSync(join(sroot, 'src'), { recursive: true })
    writeFileSync(join(sroot, 'src', 'moi.mjs'), moi)
    const renderer = await createSSRRenderer({ sourceDir: join(sroot, 'src'), outputDir: join(sroot, 'out'), bundlerOpts: { runtime: ['hydrate', 'ajax', 'vault'] } } as any)
    const rendu: any = await renderer.renderToString('mjs-moi', { ssrMode: 'replace' } as any)
    await renderer.close()
    assert.match(String(rendu.sharedScript), /"__mjsLoad":\{"http:\/\/127\.0\.0\.1:\d+\/api\/me":\{"pseudo":"Srv"\}\}/, 'le rendu serveur range la donnée')
    // `nu` : le client d'un serveur qui rend par l'API, construit en production sans bloc render ni hydrate
    for (const env of ['dev', 'prod', 'nu']) {
      const root = mjsTmp('load-reprise-' + env)
      const src  = join(root, 'src')
      const out  = join(root, 'out')
      mkdirSync(src, { recursive: true })
      writeFileSync(join(src, 'moi.mjs'), moi)
      const b  = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(env === 'dev' ? root : out, 'bundle.js'), ...(env === 'nu' ? {} : { render: { routes: { '/': { component: 'mjs-moi' } } } }), ...(env === 'dev' ? {} : { env: 'prod', js: 'split', urlPrefix: '/out' }) } as any)
      const st = await b.compile()
      await b.close()
      assert.equal(st.errors.length, 0, st.errors.map((e: any) => e.message).join('\n'))
      const files  = readdirSync(out).filter((f) => f.endsWith('.js') && f !== 'bundle.js').sort((a, c) => Number(!a.startsWith('mjs_')) - Number(!c.startsWith('mjs_')))
      const client = env !== 'dev' ? '<script type="module" src="/out/bundle.js"></script>' : '<script>' + files.map((f, i) => stripEsm(readFileSync(join(out, f), 'utf-8')) + (i === 0 ? '\nglobalThis.µ = µ;' : '')).join('\n') + '</script>'
      reprises[env] = { racine: root, doc: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${rendu.html}${rendu.sharedScript}${client}</body></html>` }
    }
    vus.length = 0
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

    // la page servie, ses erreurs et ses avertissements de console
    async function ouvrir(document: string, dossier: string) {
      doc    = document
      racine = dossier
      vus.length = 0
      const ctx  = await browser.newContext()
      const page = await ctx.newPage()
      const erreurs: string[] = []
      const avis: string[]    = []
      page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e)))
      page.on('console', (m: any) => { if (m.type() === 'warning') avis.push(m.text()) })
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' })
      return { page, ctx, erreurs, avis }
    }

    for (const mode of ['dev-parents-avant', 'split'] as const) it(`réponse qui n'est pas du JSON : le même texte de error qu'en développement (${mode})`, async function () {
      if (!present) { this.skip(); return }
      const o = await ouvrir(cibles[mode].document('mjs-pasjson', ''), cibles[mode].racine)
      try {
        const lire = `(() => { const r = document.querySelector('mjs-pasjson')?._shadow; return r ? r.querySelector('.d').textContent + '|' + r.querySelector('.e').textContent + '|' + r.querySelector('.p').textContent : '' })()`
        await o.page.waitForFunction(`${lire}.endsWith('|false')`, null, { timeout: 15000 }).catch(() => {})
        assert.equal(await o.page.evaluate(lire), '|' + TEXTE_PAS_JSON + '|false')
        assert.deepEqual(vus, ['GET /api/pasjson'])
        assert.deepEqual(o.erreurs, [])
      } finally {
        await o.ctx.close()
      }
    })

    for (const env of ['dev', 'prod', 'nu']) it(`route sans mode rendue par le serveur : le client repart avec la donnée, sans requête (${env})`, async function () {
      if (!present) { this.skip(); return }
      const o = await ouvrir(reprises[env].doc, reprises[env].racine)
      try {
        const ombre = `(document.querySelector('mjs-moi')._shadow || document.querySelector('mjs-moi').shadowRoot)`
        // `_mjs_is_mounted` porte un autre nom en production : l'attente lit le texte rendu
        await o.page.waitForFunction(`(() => { const m = document.querySelector('mjs-moi'); const r = m && (m._shadow || m.shadowRoot); return !!r && r.querySelector('.nom')?.textContent === 'Srv' })()`, null, { timeout: 15000 }).catch(() => {})
        await o.page.waitForTimeout(800)
        assert.equal(await o.page.evaluate(`${ombre}.querySelector('.nom').textContent + '|' + ${ombre}.querySelector('.att').textContent`), 'Srv|false')
        assert.deepEqual(vus, [], 'aucune requête du client')
        if (env === 'dev') assert.equal(await o.page.evaluate(`Object.getOwnPropertyNames(µ.store || {}).includes('__mjsLoad')`), false, 'la donnée de µload ne reste pas dans le magasin $$')
        assert.deepEqual(o.erreurs, [])
      } finally {
        await o.ctx.close()
      }
    })

    for (const mode of ['dev-parents-avant', 'split'] as const) it(`µload dans le gabarit (racine comprise), un µeffect, une aide du gabarit, une ligne de {for} : averti en développement seulement (${mode})`, async function () {
      if (!present) { this.skip(); return }
      const o = await ouvrir(cibles[mode].document('mjs-lieux', ''), cibles[mode].racine)
      try {
        await o.page.waitForFunction(`(document.querySelector('mjs-lieux')?._shadow?.querySelectorAll('.r') || []).length === 2`, null, { timeout: 15000 }).catch(() => {})
        await o.page.waitForTimeout(600)
        const lieux = o.avis.filter((a) => /µload/.test(a))
        if (mode === 'split') assert.deepEqual(lieux, [], 'aucun avertissement en production')
        else {
          assert.equal(lieux.length, 4, lieux.join('\n'))
          for (const lieu of [/µload\("\/api\/t\?q=a"\) appelé dans le gabarit de/, /µeffect/, /aide appelée par le gabarit/, /ligne de \{for\}/]) assert.ok(lieux.some((a) => lieu.test(a) && a.includes('<mjs-lieux>') && /dérivée du script/.test(a)), lieu + ' — ' + lieux.join('\n'))
        }
        assert.equal(await o.page.evaluate(`Array.from(document.querySelector('mjs-lieux')._shadow.querySelectorAll('.r')).map((x) => x.textContent).join(',')`), '/api/u/1,/api/u/2', 'la page se rend quand même')
        assert.deepEqual(o.erreurs, [])
      } finally {
        await o.ctx.close()
      }
    })
  })
})
