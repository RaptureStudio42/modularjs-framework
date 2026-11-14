// L'objet formulaire (la rune `µform(@)`) au navigateur réel, quand le formulaire qui part est celui d'un autre composant que le
// propriétaire du champ : le champ d'un enfant léger glissé dans le formulaire de son parent, le champ d'un composant à ombre rattaché par
// `form="…"` au formulaire d'un enfant léger. Le refus du serveur (422) pour ce champ s'affiche toujours — par l'objet de son
// propriétaire, ou par les réponses de son formulaire sans objet —, le champ est touché par l'envoi, le `reset` de ce formulaire le remet à zéro ; un champ
// que le parent écrit dans un enfant léger est à cet enfant (le composant léger le plus proche) ; chaque formulaire garde ses réponses, la
// réponse à un autre formulaire ne les efface pas. Développement, puis production en un seul fichier minifié.
// moteurs exigés : chromium firefox webkit

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { MOTEURS, moteurPresent } from './helpers/navigateurs-compiles.js'

const SOURCES: Record<string, string> = {
  // le parent, à ombre, avec l'objet : son formulaire, deux formulaires qui portent chacun un enfant léger, un enfant léger qui écrit un
  // formulaire auquel le champ `y` du parent se rattache par `form="fl"`, un champ `t` écrit dans un enfant léger avec objet
  'par.mjs': `<vars>
  $x string 0..20
  $y string 3..10
  $t string 3..10
</vars>

<script>
  $x    = 'par'
  $y    = 'yyy'
  $t    = 'ttt'
  $form = µform(this)
</script>

<form id="fp" action="/kp" method="post">
  <@@field label="XP"><input id="xp" name="x" value=!{$x}></@@field>
  <button id="bp">p</button>
</form>
<form id="fq" action="/kq" method="post"><mjs-adr mjs-light></mjs-adr><button id="bq">q</button><button id="rq" type="reset">r</button></form>
<form id="fn" action="/kn" method="post"><mjs-adrn mjs-light></mjs-adrn><button id="bn">n</button></form>
<mjs-lf mjs-light></mjs-lf>
<@@field label="XF"><input id="xf" name="y" form="fl" value=!{$y}></@@field>
<mjs-cl1 mjs-light><@@field label="XT"><input id="xt" name="t" value=!{$t}></@@field></mjs-cl1>
<p id="etatp">{JSON.stringify([$form.x.error, $form.y.error, $form.y.touched, $form.t.error, $form.t.touched])}</p>
`,
  // enfant léger avec son objet : son champ part dans le formulaire du parent
  'adr.mjs': `<vars>
  $city string 2..20
</vars>

<script>
  $city = 'Paris'
  $form = µform(this)
</script>

<@@field label="CITY"><input id="city" name="city" value=!{$city}></@@field>
<p id="etatadr">{JSON.stringify([$form.city.error, $form.city.touched])}</p>
`,
  // enfant léger sans objet : son champ part dans le formulaire du parent
  'adrn.mjs': `<@@field label="CITY2"><input id="city2" name="city" value="Lyon"></@@field>
`,
  // enfant léger sans objet qui écrit un formulaire sans champ
  'lf.mjs': `<form id="fl" action="/kl" method="post"><button id="bl">l</button></form>
`,
  // enfant léger avec son objet : le parent écrit dedans un champ `t`
  'cl1.mjs': `<vars>
  $t string 3..10
</vars>

<script>
  $t    = 'cl1'
  $form = µform(this)
</script>

<p id="etatcl1">{JSON.stringify([$form.t.error, $form.t.touched])}</p>
`,
}

const REFUS: Record<string, object> = { '/kp': { x: 'P refuse', t: 'PT refuse' }, '/kq': { city: 'Ville inconnue' }, '/kn': { city: 'Ville inconnue N' }, '/kl': { y: 'Y refuse' } }
const TYPES: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.map': 'application/json', '.css': 'text/css' }

// les outils de la page : l'ombre d'un composant (une suite de balises, de l'extérieur vers l'intérieur), un élément dedans, son état, et
// ce que le <@@field> qui enveloppe un champ montre (son marquage, son message d'erreur)
const OUTILS = `
  window.__r = (...hs) => { let r = document; for (const h of hs) { const e = r.querySelector(h); if (!e) return null; r = e._shadow || e.shadowRoot || e } return r }
  window.__q = (s, ...hs) => { const r = window.__r(...hs); return r && r.querySelector(s) }
  window.__etat = (...hs) => { const p = window.__q(...hs); try { return JSON.parse(p.textContent) } catch { return null } }
  window.__champ = (...l) => { const c = window.__q(...l); if (!c) return null; const sh = c.parentNode._shadow || c.parentNode.shadowRoot; const er = sh && sh.querySelector('.error'); return [c.getAttribute('mjs-field'), er ? er.textContent.trim() : ''] }
`

async function construire(mode: string): Promise<string> {
  const root = mjsTmp('form-croise-' + mode)
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

describe('µform(@) au navigateur réel — le champ envoyé par le formulaire d’un autre composant', function () {
  this.timeout(300000)
  const dists: Record<string, string> = {}
  let server: Server | null = null
  let origin = ''
  let mode   = ''

  before(async () => {
    for (const m of ['developpement', 'production']) dists[m] = await construire(m)
    server = createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://x')
      if (req.method === 'POST') {
        req.resume()
        req.on('end', () => {
          res.writeHead(422, { 'content-type': 'application/json', 'cache-control': 'no-store' })
          res.end(JSON.stringify({ module: 'mjs-par', props: { errors: REFUS[url.pathname] || { z: 'refus' } }, url: url.pathname, title: null }))
        })
        return
      }
      if (url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        res.end('<!doctype html><html lang="fr"><head><meta charset="utf-8"><script type="module" src="/modularjs/bundle.js"></script></head><body><mjs-par></mjs-par></body></html>')
        return
      }
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

  for (const nom of MOTEURS) {
    for (const m of ['developpement', 'production']) {
      it(`${nom}, ${m}`, async function () {
        if (!await moteurPresent(nom)) this.skip()
        mode = m
        const playwright: any = await import('playwright')
        const browser = await playwright[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
        try {
          const p = await browser.newPage()
          const erreurs: string[] = []
          p.on('pageerror', (e: any) => erreurs.push(String(e)))
          // la console signale chaque réponse 422 attendue (« Failed to load resource ») : seules les autres erreurs comptent
          p.on('console', (c: any) => { if (c.type() === 'error' && !/Failed to load resource/.test(c.text())) erreurs.push('console : ' + c.text()) })
          await p.addInitScript(OUTILS)
          await p.goto(origin + '/')
          const etat    = (...l: string[]): Promise<any> => p.evaluate((x: string[]) => (window as any).__etat(...x), l)
          const champ   = (...l: string[]): Promise<any> => p.evaluate((x: string[]) => (window as any).__champ(...x), l)
          // de vrais gestes (l'ombre des composants est fermée : l'élément est pris par la page) ; `force` : WebKit ne voit pas l'intérieur
          // d'une ombre fermée au point du clic
          const cliquer = async (...l: string[]) => (await p.evaluateHandle((x: string[]) => (window as any).__q(...x), l)).asElement().click({ timeout: 5000, force: true })
          const echecs: string[] = []
          const montre  = async (attendu: string[], ...l: string[]) => {
            try { await p.waitForFunction((x: any) => { const c = (window as any).__champ(...x.l); return !!c && c[0] === x.a[0] && c[1] === x.a[1] }, { l, a: attendu }, { timeout: 8000 }) }
            catch { echecs.push(l.join(' < ') + ' devait montrer ' + JSON.stringify(attendu) + ', montre ' + JSON.stringify(await champ(...l)) + (erreurs.length ? ' — erreurs : ' + erreurs.join(' | ') : '')) }
          }
          const vaut    = (titre: string, lu: any, attendu: any) => { if (JSON.stringify(lu) !== JSON.stringify(attendu)) echecs.push(titre + ' : ' + JSON.stringify(lu) + ' au lieu de ' + JSON.stringify(attendu)) }
          await p.waitForFunction(() => { const w = window as any; return w.__etat('#etatp', 'mjs-par') !== null && w.__etat('#etatadr', 'mjs-par') !== null && w.__etat('#etatcl1', 'mjs-par') !== null && !!w.__q('#city2', 'mjs-par') && !!w.__q('#bl', 'mjs-par') }, null, { timeout: 15000 })
          await p.waitForTimeout(300)
          vaut('départ : objet du parent', await etat('#etatp', 'mjs-par'), ['', '', false, '', false])

          // 1. le formulaire du parent emporte le champ de l'enfant léger avec objet : le refus s'affiche sur ce champ, l'objet de l'enfant le
          // prend et le champ est touché ; le parent n'a pas de champ `city`
          await cliquer('#bq', 'mjs-par')
          await montre(['error', 'Ville inconnue'], '#city', 'mjs-par')
          vaut('formulaire du parent, champ de l’enfant léger avec objet : objet de l’enfant', await etat('#etatadr', 'mjs-par'), ['Ville inconnue', true])
          vaut('formulaire du parent, champ de l’enfant léger avec objet : objet du parent', await etat('#etatp', 'mjs-par'), ['', '', false, '', false])

          // 2. le formulaire du parent emporte le champ d'un enfant léger sans objet : le refus de ce formulaire s'y affiche, comme sans objet ;
          // le champ de l'enfant avec objet, que cet envoi n'a pas emporté, garde le refus de son formulaire (chaque formulaire ses réponses)
          await cliquer('#bn', 'mjs-par')
          await montre(['error', 'Ville inconnue N'], '#city2', 'mjs-par')
          await montre(['error', 'Ville inconnue'], '#city', 'mjs-par')
          vaut('formulaire du parent, champ de l’enfant léger sans objet : objet de l’autre enfant', await etat('#etatadr', 'mjs-par'), ['Ville inconnue', true])

          // 3. le formulaire d'un enfant léger sans objet emporte, par `form="fl"`, un champ du parent à ombre : le refus s'affiche, l'objet du
          // parent le prend et le champ est touché
          await cliquer('#bl', 'mjs-par')
          await montre(['error', 'Y refuse'], '#xf', 'mjs-par')
          vaut('formulaire de l’enfant, champ du parent par form= : objet du parent', await etat('#etatp', 'mjs-par'), ['', 'Y refuse', true, '', false])

          // 4. le champ `t` que le parent écrit dans l'enfant léger avec objet est à cet enfant : le quitter touche son objet, pas celui du
          // parent
          await cliquer('#xt', 'mjs-par')
          await cliquer('#xp', 'mjs-par')
          await p.waitForTimeout(200)
          vaut('champ écrit par le parent dans l’enfant léger, quitté : objet de l’enfant', await etat('#etatcl1', 'mjs-par'), ['', true])
          vaut('champ écrit par le parent dans l’enfant léger, quitté : objet du parent', await etat('#etatp', 'mjs-par'), ['', 'Y refuse', true, '', false])

          // 5. le refus du formulaire du parent, qui nomme aussi `t` : ce formulaire n'emporte aucun champ `t` (celui que le parent écrit dans
          // l'enfant léger est à cet enfant, hors du formulaire) — ni la variable `$t` du parent, ni l'objet de l'enfant ne le prennent, et le
          // champ `t` passe au succès ; le champ `y`, rattaché par `form="fl"` au formulaire de l'enfant, garde le refus de celui-ci
          await cliquer('#bp', 'mjs-par')
          await montre(['error', 'P refuse'], '#xp', 'mjs-par')
          await montre(['ok', ''], '#xt', 'mjs-par')
          vaut('refus du parent : objet du parent', await etat('#etatp', 'mjs-par'), ['P refuse', 'Y refuse', true, '', false])
          vaut('refus du parent : objet de l’enfant léger qui porte le champ t', await etat('#etatcl1', 'mjs-par'), ['', true])

          // 6. le `reset` du formulaire du parent remet à zéro le champ de l'enfant léger qu'il porte : plus touché
          await cliquer('#rq', 'mjs-par')
          await p.waitForTimeout(300)
          vaut('reset du formulaire du parent : objet de l’enfant léger', await etat('#etatadr', 'mjs-par'), ['', false])

          assert.deepEqual(erreurs, [])
          assert.deepEqual(echecs, [])
        }
        finally {
          await browser.close()
        }
      })
    }
  }
})
