// µload en navigateur réel (Chromium, Firefox, WebKit), en développement et en production, puis la reprise d'une page rendue
// par le serveur (`markers` et `replace`). La scène : trois composants lisent `/api/me` = une requête ; l'attente, la donnée et
// l'erreur suivies par le gabarit ; la recherche qui change garde la liste d'avant, annule la requête dépassée ; un PATCH réussi
// relit `/api/me` ; µload.refresh relit ; une erreur garde la donnée, sans nouvel essai. Rendu serveur : le client démarre avec
// la donnée de `#__mjs_store`, sans aucune requête. Le faux serveur ne répond aux requêtes de `/api/` que sur ordre du test.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer, stripEsm } from '../src/server/renderToString.js'
import { construire } from './helpers/liaison-navigateur.js'
import type { Cible } from './helpers/liaison-navigateur.js'
import { mjsTmp } from './helpers/tmp.js'
import { playTogether } from './helpers/engines-together.js'

const SOURCES: Record<string, string> = {
  'moi.mjs': `<script>
  if µserver then window.fetch = (u) -> Promise.resolve(new Response(JSON.stringify({ pseudo: 'Ada' }), { headers: { 'content-type': 'application/json' } }))
  $me = µload('/api/me')
</script>
<p class="nom">{$me.data?.pseudo}</p><i class="att">{$me.pending}</i><b class="err">{$me.error?.message}</b>
`,
  'page.mjs': `<script>
  $q       = ''
  $membres = µload("/api/members?q=#{encodeURIComponent($q)}")
  @chercher = (q) -> $q = q
  @renommer = (pseudo) -> µ.ajax.patch('/api/me', { pseudo })
  @relire   = -> µload.refresh('/api/me')
</script>
<@moi></@moi><@moi></@moi><@moi></@moi>
<ul>{for m in ($membres.data or []) by id}<li>{m.pseudo}</li>{end}</ul>
<i class="encours">{$membres.pending}</i>
`,
}

// rendu serveur de <mjs-moi> : la page porte le fragment, la balise de l'état global et le script du cœur
async function construireSsr(): Promise<Record<string, string>> {
  const root   = mjsTmp('load-ssr-nav')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'moi.mjs'), SOURCES['moi.mjs'])
  const renderer = await createSSRRenderer({ sourceDir: srcDir, outputDir: outDir, bundlerOpts: { runtime: ['hydrate', 'ajax', 'vault'] } } as any)
  const rendus: Record<string, string> = {}
  for (const mode of ['markers', 'replace']) {
    const r: any = await renderer.renderToString('mjs-moi', { ssrMode: mode } as any)
    rendus[mode] = r.html + r.sharedScript + r.hydrateScript
  }
  await renderer.close()
  const files  = readdirSync(outDir).filter((f) => f.endsWith('.js') && f !== 'bundle.js').sort((a, b) => Number(!a.startsWith('mjs_core')) - Number(!b.startsWith('mjs_core')))
  const script = files.map((f, i) => stripEsm(readFileSync(join(outDir, f), 'utf-8')) + (i === 0 ? '\nglobalThis.µ = µ;' : '')).join('\n')
  for (const mode of Object.keys(rendus)) rendus[mode] = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${rendus[mode]}<script>${script}</script></body></html>`
  return rendus
}

type Banc = { page: any, ctx: any, vues: string[], erreurs: string[], repondre: (motif: string, status: number, corps: any) => Promise<void> }

// une page servie par un faux serveur : le document, les fichiers de `out/`, et `/api/…` qui attend l'ordre du test
async function ouvrir(browser: any, document: string, racine: string): Promise<Banc> {
  const ctx  = await browser.newContext()
  const page = await ctx.newPage()
  const vues: string[]    = []
  const erreurs: string[] = []
  const attente = new Map<string, Array<(r: { status: number, corps: any }) => void>>()
  page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e)))
  await page.addInitScript(`window.__abandons = []; const __f = window.fetch; window.fetch = function (u, o) { if (o && o.signal) o.signal.addEventListener('abort', () => window.__abandons.push(String(u))); return __f.apply(this, arguments) }`)
  await page.route('http://load.test/**', async (route: any) => {
    const url    = new URL(route.request().url())
    const chemin = decodeURIComponent(url.pathname)
    if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: document })
    if (chemin.startsWith('/api/')) {
      const motif = route.request().method() + ' ' + chemin + url.search
      vues.push(motif)
      const r = await new Promise<{ status: number, corps: any }>((ok) => { if (!attente.has(motif)) attente.set(motif, []); attente.get(motif)!.push(ok) })
      return route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.corps) }).catch(() => {})
    }
    const fichier = join(racine, normalize(chemin))
    if (chemin.startsWith('/out/') && existsSync(fichier)) return route.fulfill({ contentType: chemin.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json', body: readFileSync(fichier) })
    return route.fulfill({ status: 404, body: '' })
  })
  const repondre = async (motif: string, status: number, corps: any) => {
    for (let i = 0; i < 100 && !(attente.get(motif) || []).length; i++) await page.waitForTimeout(20)
    const file = attente.get(motif) || []
    assert.ok(file.length, 'aucune requête en attente ' + motif + ' — vues : ' + vues.join(', '))
    file.shift()!({ status, corps })
    await page.waitForTimeout(120)
  }
  await page.goto('http://load.test/', { waitUntil: 'load' })
  return { page, ctx, vues, erreurs, repondre }
}

const lirePage = (page: any) => page.evaluate(`(() => {
  const p = document.querySelector('mjs-page')._shadow
  const t = (r, s) => (r.querySelector(s) || {}).textContent
  const mois = Array.from(p.querySelectorAll('mjs-moi')).map((m) => t(m._shadow, '.nom') + '/' + t(m._shadow, '.att') + '/' + t(m._shadow, '.err'))
  return { mois: mois.join(' '), liste: Array.from(p.querySelectorAll('li')).map((li) => li.textContent).join(','), encours: t(p, '.encours') }
})()`)
const compter = (b: Banc, motif: string) => b.vues.filter((v) => v === motif).length

for (const moteur of ['chromium', 'firefox', 'webkit'] as const) playTogether(describe(`µload en navigateur réel (${moteur})`, function () {
  this.timeout(240000)
  let browser: any = null
  let present = false
  const cibles = new Map<string, Promise<Cible>>()
  const cible  = (mode: 'dev-parents-avant' | 'split') => { if (!cibles.has(mode)) cibles.set(mode, construire(mode, SOURCES, ['mjs-page'])); return cibles.get(mode)! }

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[moteur].executablePath())
    if (!present) { console.log(`  ℹ️  ${moteur} non installé, µload sauté. Activer : \`npx playwright install ${moteur}\``); return }
    browser = await playwright[moteur].launch(moteur === 'chromium' ? { args: ['--no-proxy-server'] } : {})
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const mode of ['dev-parents-avant', 'split'] as const) it(`la scène de /api/me et de la recherche (${mode})`, async function () {
    if (!present) { this.skip(); return }
    const c = await cible(mode)
    const b = await ouvrir(browser, c.document('mjs-page', ''), c.racine)
    try {
      await b.page.waitForFunction(`document.querySelector('mjs-page')?._shadow?.querySelectorAll('mjs-moi').length === 3`, null, { timeout: 10000 })
      await b.page.waitForTimeout(200)
      assert.equal(compter(b, 'GET /api/me'), 1, 'trois lecteurs de /api/me = une requête')
      assert.equal((await lirePage(b.page)).mois, '/true/ /true/ /true/')
      await b.repondre('GET /api/me', 200, { pseudo: 'Ada' })
      assert.equal((await lirePage(b.page)).mois, 'Ada/false/ Ada/false/ Ada/false/')
      await b.repondre('GET /api/members?q=', 200, [{ id: 1, pseudo: 'Ada' }, { id: 2, pseudo: 'Bob' }])
      assert.equal((await lirePage(b.page)).liste, 'Ada,Bob')
      await b.page.evaluate(`document.querySelector('mjs-page').chercher('b')`)
      await b.page.waitForTimeout(120)
      let vu = await lirePage(b.page)
      assert.equal(vu.liste + '|' + vu.encours, 'Ada,Bob|true', 'la liste d\'avant reste pendant l\'attente')
      await b.page.evaluate(`document.querySelector('mjs-page').chercher('bo')`)
      await b.page.waitForTimeout(200)
      assert.deepEqual(await b.page.evaluate('window.__abandons.map((u) => u.replace(location.origin, ""))'), ['/api/members?q=b'], 'la requête dépassée est annulée')
      await b.repondre('GET /api/members?q=bo', 200, [{ id: 2, pseudo: 'Bob' }])
      vu = await lirePage(b.page)
      assert.equal(vu.liste + '|' + vu.encours, 'Bob|false')
      // `, null` : evaluate attendrait sinon la promesse de l'envoi, dont la réponse ne vient qu'à l'étape suivante ; `µ` n'est pas une globale de la page en production
      await b.page.evaluate(`(document.querySelector('mjs-page').renommer('Zoé'), null)`)
      await b.repondre('PATCH /api/me', 200, {})
      assert.equal(compter(b, 'GET /api/me'), 2, 'le PATCH réussi relit /api/me')
      await b.repondre('GET /api/me', 200, { pseudo: 'Zoé' })
      assert.equal((await lirePage(b.page)).mois, 'Zoé/false/ Zoé/false/ Zoé/false/')
      await b.page.evaluate(`(document.querySelector('mjs-page').relire(), null)`)
      await b.repondre('GET /api/me', 500, { message: 'panne' })
      assert.equal((await lirePage(b.page)).mois, 'Zoé/false/panne Zoé/false/panne Zoé/false/panne', 'l\'erreur est posée, la donnée gardée')
      await b.page.waitForTimeout(300)
      assert.equal(compter(b, 'GET /api/me'), 3, 'aucun nouvel essai après l\'erreur')
      assert.deepEqual(b.erreurs, [])
    } finally {
      await b.ctx.close()
    }
  })

  for (const ssr of ['markers', 'replace']) it(`rendu serveur (${ssr}) : le client démarre avec la donnée, sans requête`, async function () {
    if (!present) { this.skip(); return }
    const docs = await (cibles.get('ssr' as any) || (cibles.set('ssr' as any, construireSsr() as any), cibles.get('ssr' as any)!)) as any as Record<string, string>
    assert.match(docs[ssr], /"__mjsLoad":\{"\/api\/me":\{"pseudo":"Ada"\}\}/, 'la donnée du serveur voyage dans #__mjs_store')
    const b = await ouvrir(browser, docs[ssr], '')
    try {
      await b.page.waitForFunction(`!!document.querySelector('mjs-moi')?._mjs_is_mounted`, null, { timeout: 10000 })
      await b.page.waitForTimeout(300)
      assert.equal(await b.page.evaluate(`document.querySelector('mjs-moi')._shadow.querySelector('.nom').textContent`), 'Ada')
      assert.deepEqual(b.vues, [], 'aucune requête au démarrage du client')
      assert.equal(await b.page.evaluate(`Object.keys(µ.store || {}).join(',')`), '', 'la donnée de µload ne reste pas dans le magasin $$')
      assert.deepEqual(b.erreurs, [])
    } finally {
      await b.ctx.close()
    }
  })
}))
