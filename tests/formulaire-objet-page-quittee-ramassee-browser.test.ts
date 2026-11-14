// L'objet formulaire d'un composant (la rune `µform(@)`) ne garde aucune page quittée : après un envoi refusé par le serveur (422), ou un
// envoi annulé par l'application, la page quittée puis sortie du cache de pages (douze autres pages après elle) est ramassée tout entière
// — le composant léger qui porte l'objet, son voisin ordinaire, le composant léger dont le formulaire les contient —, comme les composants
// retirés de la page affichée après un envoi annulé. Le refus reste lu par son champ : le relevé de l'envoi est pris. Le ramassage se
// force par le protocole des outils de développement de Chromium, seul moteur qui l'offre. En développement, puis en production en un
// seul fichier minifié.
// moteurs exigés : chromium

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { moteurPresent } from './helpers/navigateurs-compiles.js'

const SOURCES: Record<string, string> = {
  'lfo.mjs': `<vars>
  $u string 2..20
</vars>

<script>
  $u    = 'uuu'
  $form = µform(this)
</script>

<input id="xfo" name="u" aria-label="Nom" value=!{$u}>
<p id="etat">{JSON.stringify([$form.u.error, $form.u.touched])}</p>
`,
  'ord.mjs': `<script>
  $o = 'ooo'
</script>

<p id="etato">{$o}</p>
`,
  'pb.mjs': `<form id="fb" action="/kb" method="post"><mjs-lfo mjs-light></mjs-lfo><mjs-ord></mjs-ord><button id="bb">b</button></form>
`,
  'pn.mjs': `<p id="pn">page</p>
`,
}
const TYPES: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.map': 'application/json', '.css': 'text/css' }

// les outils de la page : l'arbre d'un composant (une suite de balises, de l'extérieur vers l'intérieur), un élément dedans, l'état du
// champ (son erreur, touché ou non) ; aucun ne garde de nœud
const OUTILS = `
  window.__r = (...hs) => { let r = document; for (const h of hs) { const e = r.querySelector(h); if (!e) return null; r = e._shadow || e.shadowRoot || e } return r }
  window.__q = (s, ...hs) => { const r = window.__r(...hs); return r && r.querySelector(s) }
  window.__etat = () => { const p = window.__q('#etat', 'mjs-pb', 'mjs-lfo'); return p ? p.textContent : null }
`

// le geste sur le formulaire (`refus` : l'envoi part et le serveur le refuse ; `annule` : l'application l'annule), puis la page quittée,
// ou ses composants retirés de la page affichée (`retire`)
const CAS = [
  { mode: 'developpement', geste: 'refus', titre: 'envoi refusé (422), page quittée' },
  { mode: 'production', geste: 'refus', titre: 'envoi refusé (422), page quittée' },
  { mode: 'developpement', geste: 'annule', titre: 'envoi annulé par l’application, page quittée' },
  { mode: 'developpement', geste: 'retire', titre: 'envoi annulé par l’application, composants retirés de la page affichée' },
]

async function construire(mode: string): Promise<string> {
  const root = mjsTmp('form-page-quittee-' + mode)
  const src  = join(root, 'src')
  const out  = join(root, 'dist')
  mkdirSync(src, { recursive: true })
  for (const [fichier, contenu] of Object.entries(SOURCES)) writeFileSync(join(src, fichier), contenu)
  const prod    = mode === 'production' ? { forceMinify: true, minimalRuntime: true, js: 'bundle', env: 'prod' } : {}
  const bundler = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), urlPrefix: '/modularjs', runtime: ['ujs', 'ajax', 'vault'], ...prod } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return out
}

describe('µform(@) au navigateur réel — le dernier envoi ne garde pas la page quittée', function () {
  this.timeout(120000)
  const dists: Record<string, string> = {}
  let server: Server | null = null
  let origin = ''
  let mode   = ''
  let envois = 0

  before(async () => {
    for (const m of ['developpement', 'production']) dists[m] = await construire(m)
    server = createServer((req, res) => {
      const url   = new URL(req.url || '/', 'http://x')
      const page  = (corps: string) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end('<!doctype html><html lang="fr"><head><meta charset="utf-8"><script type="module" src="/modularjs/bundle.js"></script></head><body>' + corps + '</body></html>') }
      const fiche = (statut: number, module: string, props: object) => { res.writeHead(statut, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify({ module, props, url: url.pathname, title: null })) }
      if (req.method === 'POST') {
        req.resume()
        req.on('end', () => {
          envois++
          fiche(422, 'mjs-pb', { errors: { u: 'refus' } })
        })
        return
      }
      if (url.pathname === '/b') return page('<mjs-pb mjs-light></mjs-pb>')
      if (/^\/p\/\d+$/.test(url.pathname)) return req.headers['x-mjs-nav'] ? fiche(200, 'mjs-pn', {}) : page('<mjs-pn></mjs-pn>')
      const m       = /^\/modularjs\/(.+)$/.exec(url.pathname)
      const fichier = m ? join(dists[mode], normalize(decodeURIComponent(m[1])).replace(/^(\.\.[/\\])+/, '')) : ''
      if (!fichier || !existsSync(fichier) || !statSync(fichier).isFile()) { res.writeHead(404); res.end('introuvable'); return }
      res.writeHead(200, { 'content-type': TYPES[extname(fichier)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
      res.end(readFileSync(fichier))
    })
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', () => resolve()))
    origin = 'http://127.0.0.1:' + (server!.address() as any).port
  })

  after(async () => {
    if (server) await new Promise(resolve => server!.close(() => resolve(null)))
    await terminateSharedWorkerPool()
  })

  for (const c of CAS) {
    it(`${c.titre}, ${c.mode}`, async function () {
      if (!await moteurPresent('chromium')) this.skip()
      mode   = c.mode
      envois = 0
      const playwright: any = await import('playwright')
      const browser = await playwright.chromium.launch({ args: ['--no-proxy-server'] })
      try {
        const p = await browser.newPage()
        const erreurs: string[] = []
        p.on('pageerror', (e: any) => erreurs.push(String(e)))
        // la console signale la réponse 422 attendue (« Failed to load resource ») : seules les autres erreurs comptent
        p.on('console', (m: any) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) erreurs.push('console : ' + m.text()) })
        await p.addInitScript(OUTILS)
        const attendre = async (fn: string, quoi: string) => {
          try { await p.waitForFunction(fn, null, { timeout: 10000 }) }
          catch { assert.fail(quoi + ' — erreurs : ' + erreurs.join(' | ')) }
        }
        await p.goto(origin + '/b')
        await attendre(`window.__etat() !== null && !!window.__q('#etato', 'mjs-pb', 'mjs-ord')`, 'la page n’affiche pas ses composants')
        // les départs des champs et l'écoute du formulaire du parent, un cran après le premier rendu
        await p.waitForTimeout(500)
        // les témoins, des références faibles : elles ne retiennent rien
        await p.evaluate(`window.__wr = [window.__q('mjs-lfo', 'mjs-pb'), window.__q('mjs-ord', 'mjs-pb'), document.querySelector('mjs-pb')].map(e => new WeakRef(e)), 0`)
        if (c.geste !== 'refus') await p.evaluate(`window.__q('#fb', 'mjs-pb').addEventListener('submit', e => e.preventDefault()), 0`)
        const h = await p.evaluateHandle(`window.__q('#bb', 'mjs-pb')`)
        await h.asElement().click({ timeout: 5000, force: true })
        await h.dispose()
        if (c.geste === 'refus') await attendre(`window.__etat() === '["refus",true]'`, 'le refus du serveur n’est pas lu par son champ')
        else {
          await attendre(`window.__etat() === '["",true]'`, 'l’envoi tenté ne touche pas le champ')
          await p.waitForTimeout(300)
          assert.equal(envois, 0, 'l’envoi annulé est parti')
        }
        // retirés, puis un clic ailleurs : le navigateur garde de lui-même le dernier bouton cliqué (celui de l'envoi), et par lui tout son
        // arbre, jusqu'au clic suivant — une référence à lui, sans rapport avec l'objet formulaire
        if (c.geste === 'retire') {
          await p.evaluate(`document.querySelector('mjs-pb').remove(); document.body.insertAdjacentHTML('beforeend', '<p id="ailleurs">ailleurs</p>'), 0`)
          await p.click('#ailleurs', { timeout: 5000, force: true })
        }
        else {
          for (let i = 1; i <= 12; i++) {
            const href = '/p/' + i
            await p.evaluate(`(() => { document.getElementById('va')?.remove(); const a = document.createElement('a'); a.id = 'va'; a.href = '${href}'; a.textContent = 'aller'; document.body.appendChild(a) })(), 0`)
            await p.click('#va', { timeout: 5000, force: true })
            await attendre(`location.pathname === '${href}'`, 'la page ' + href + ' n’arrive pas')
            await p.waitForTimeout(250)
          }
        }
        // le ramassage forcé, répété le temps de la destruction différée des composants
        const s = await p.context().newCDPSession(p)
        let retenus: boolean[] = []
        for (let i = 0; i < 16; i++) {
          await p.waitForTimeout(250)
          await s.send('HeapProfiler.collectGarbage')
          await s.send('HeapProfiler.collectGarbage')
          retenus = await p.evaluate('window.__wr.map(w => !!w.deref())') as boolean[]
          if (!retenus.some(Boolean)) break
        }
        await s.detach()
        assert.deepEqual(retenus, [false, false, false], 'gardés après le ramassage [léger avec µform, ordinaire, parent léger] : ' + JSON.stringify(retenus) + ' — erreurs : ' + erreurs.join(' | '))
        assert.deepEqual(erreurs, [])
      }
      finally {
        await browser.close()
      }
    })
  }
})
