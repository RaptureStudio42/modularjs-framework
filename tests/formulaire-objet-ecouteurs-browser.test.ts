// L'objet formulaire (la rune `µform(@)`) au navigateur réel : le composant léger qui écoute l'arbre qui le contient (l'ombre de son
// parent, la page) y retire ses écouteurs à sa destruction — leur nombre ne grandit pas au fil des bascules d'un `{if}` — et les y repose
// s'il revient dans la page ; le `reset` d'un formulaire ne rafraîchit que les objets dont il remet des champs à zéro ; un refus du
// serveur ne vaut que pour les champs que l'envoi a emportés, même dans l'objet du composant qui a écrit le formulaire. Développement,
// puis production en un seul fichier minifié.
// moteurs exigés : chromium firefox webkit

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { MOTEURS, moteurPresent } from './helpers/navigateurs-compiles.js'

const SOURCES: Record<string, string> = {
  // le parent, à ombre, avec l'objet : son formulaire n'emporte que `x` (le champ `y` est hors de tout formulaire), un formulaire porte
  // l'enfant léger `adr`, un autre l'enfant léger `adr2` qu'un {if} retire et remet
  'par.mjs': `<vars>
  $x string 3..10
  $y string 3..10
</vars>

<script>
  $x      = 'par'
  $y      = 'yyy'
  $montre = true
  $form   = µform(this)
  window.__bascule = -> $montre = !$montre
</script>

<form id="fp" action="/kp" method="post"><input id="xp" name="x" value=!{$x}><button id="bp">p</button></form>
<input id="xy" name="y" value=!{$y}>
<form id="fq" action="/kq" method="post"><mjs-adr mjs-light></mjs-adr><button id="rq" type="reset">r</button></form>
<form id="fs" action="/ks" method="post">{if $montre}<mjs-adr2 mjs-light></mjs-adr2>{end}<button id="bs">s</button></form>
<p id="etatp">{window.__tick('p') + JSON.stringify([$form.x.error, $form.y.error, $form.x.touched, $form.y.touched])}</p>
`,
  'adr.mjs': `<vars>
  $city string 2..20
</vars>

<script>
  $city = 'Paris'
  $form = µform(this)
</script>

<input id="city" name="city" value=!{$city}>
<p id="etatadr">{window.__tick('adr') + JSON.stringify([$form.city.error, $form.city.touched])}</p>
`,
  'adr2.mjs': `<vars>
  $c2 string 2..20
</vars>

<script>
  $c2   = 'Nice'
  $form = µform(this)
</script>

<input id="c2" name="c2" value=!{$c2}>
<p id="etatadr2">{window.__tick('adr2') + JSON.stringify([$form.c2.error, $form.c2.touched])}</p>
`,
  // un composant léger posé dans la page, sans objet : son formulaire porte l'enfant léger `ldoc` qu'un {if} retire et remet
  'lpar.mjs': `<script>
  $montre = true
  window.__bascule2 = -> $montre = !$montre
</script>

<form id="fd" action="/kd" method="post">{if $montre}<mjs-ldoc mjs-light></mjs-ldoc>{end}<button id="bd">d</button></form>
`,
  'ldoc.mjs': `<vars>
  $u string 2..20
</vars>

<script>
  $u    = 'uuu'
  $form = µform(this)
</script>

<input id="xu" name="u" value=!{$u}>
<p id="etatldoc">{window.__tick('ldoc') + JSON.stringify([$form.u.error, $form.u.touched])}</p>
`,
}

const REFUS: Record<string, object> = { '/kp': { x: 'P refuse', y: 'Y refuse' }, '/kq': { city: 'Ville inconnue' }, '/ks': { c2: 'C2 refuse' }, '/kd': { u: 'U refuse' } }
const TYPES: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.map': 'application/json', '.css': 'text/css' }

// les outils de la page : l'ombre d'un composant (une suite de balises, de l'extérieur vers l'intérieur), un élément dedans, son état ; le
// compte des rafraîchissements de chaque état ; les écouteurs `submit` et `reset` vivants, posés sur la page ou sur une ombre (un même
// écouteur posé deux fois n'en fait qu'un, comme pour le navigateur)
const OUTILS = `
  window.__r = (...hs) => { let r = document; for (const h of hs) { const e = r.querySelector(h); if (!e) return null; r = e._shadow || e.shadowRoot || e } return r }
  window.__q = (s, ...hs) => { const r = window.__r(...hs); return r && r.querySelector(s) }
  window.__etat = (...hs) => { const p = window.__q(...hs); try { return JSON.parse(p.textContent) } catch { return null } }
  window.__ticks = {}
  window.__tick = (k) => { window.__ticks[k] = (window.__ticks[k] || 0) + 1; return '' }
  { const A = EventTarget.prototype.addEventListener, D = EventTarget.prototype.removeEventListener, vifs = new Map()
    const lab = (t) => t === document ? 'page' : (t && t.nodeType === 11) ? 'ombre' : null
    const cle = (ty, o) => ty + (o === true || (o && o.capture) ? ' capture' : '')
    EventTarget.prototype.addEventListener = function (ty, fn, o) { if (fn && (ty === 'submit' || ty === 'reset') && lab(this)) { let m = vifs.get(this); if (!m) vifs.set(this, m = new Map()); const k = cle(ty, o); if (!m.has(k)) m.set(k, new Set()); m.get(k).add(fn) } return A.call(this, ty, fn, o) }
    EventTarget.prototype.removeEventListener = function (ty, fn, o) { const m = vifs.get(this), k = cle(ty, o); if (m && m.has(k)) m.get(k).delete(fn); return D.call(this, ty, fn, o) }
    window.__ecoute = () => { const r = {}; for (const [t, m] of vifs) for (const [k, s] of m) { const n = lab(t) + ' ' + k; r[n] = (r[n] || 0) + s.size } return Object.fromEntries(Object.entries(r).sort()) } }
`

async function construire(mode: string): Promise<string> {
  const root = mjsTmp('form-ecouteurs-' + mode)
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

describe('µform(@) au navigateur réel — écouteurs du composant léger, reset et refus limités à ce que le formulaire emporte', function () {
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
        res.end('<!doctype html><html lang="fr"><head><meta charset="utf-8"><script type="module" src="/modularjs/bundle.js"></script></head><body><mjs-par></mjs-par><mjs-lpar mjs-light></mjs-lpar></body></html>')
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
          const ev      = (js: string): Promise<any> => p.evaluate(js)
          const etat    = (...l: string[]): Promise<any> => p.evaluate((x: string[]) => (window as any).__etat(...x), l)
          // de vrais gestes (l'ombre des composants est fermée : l'élément est pris par la page) ; `force` : WebKit ne voit pas l'intérieur
          // d'une ombre fermée au point du clic
          const cliquer = async (...l: string[]) => (await p.evaluateHandle((x: string[]) => (window as any).__q(...x), l)).asElement().click({ timeout: 5000, force: true })
          const echecs: string[] = []
          const vaut    = (titre: string, lu: any, attendu: any) => { if (JSON.stringify(lu) !== JSON.stringify(attendu)) echecs.push(titre + ' : ' + JSON.stringify(lu) + ' au lieu de ' + JSON.stringify(attendu) + (erreurs.length ? ' — erreurs : ' + erreurs.join(' | ') : '')) }
          const attend  = async (titre: string, l: string[], attendu: any) => {
            try { await p.waitForFunction((x: any) => JSON.stringify((window as any).__etat(...x.l)) === JSON.stringify(x.a), { l, a: attendu }, { timeout: 8000 }) }
            catch { vaut(titre, await etat(...l), attendu) }
          }
          const tous    = () => p.waitForFunction(() => { const w = window as any; return w.__etat('#etatp', 'mjs-par') !== null && w.__etat('#etatadr', 'mjs-par') !== null && w.__etat('#etatadr2', 'mjs-par') !== null && w.__etat('#etatldoc', 'mjs-lpar') !== null }, null, { timeout: 15000 })
          await tous()
          await p.waitForTimeout(400)
          const depart = await ev('window.__ecoute()')

          // 1. six bascules de l'enfant léger posé dans l'ombre du parent, six de celui posé dans la page : autant d'écouteurs qu'au départ
          for (let i = 0; i < 6; i++) {
            await ev('window.__bascule(), window.__bascule2()')
            await p.waitForTimeout(300)
          }
          await tous()
          await p.waitForTimeout(300)
          vaut('écouteurs submit et reset après six bascules', await ev('window.__ecoute()'), depart)

          // 2. le `reset` du formulaire qui porte l'enfant léger `adr` remet son champ à zéro, sans rafraîchir l'objet du parent ni celui de
          // l'autre enfant léger, qui n'y ont aucun champ
          const avant = JSON.parse(await ev('JSON.stringify(window.__ticks)'))
          await cliquer('#rq', 'mjs-par')
          await p.waitForTimeout(400)
          const apres = JSON.parse(await ev('JSON.stringify(window.__ticks)'))
          vaut('reset d’un formulaire : rafraîchissements de l’objet du parent et de l’autre enfant léger', [apres.p - avant.p, apres.adr2 - avant.adr2], [0, 0])
          vaut('reset d’un formulaire : objet de l’enfant léger qu’il porte', await etat('#etatadr', 'mjs-par'), ['', false])

          // 3. le formulaire du parent n'emporte que `x` : le refus qui nomme aussi `y`, un champ hors de ce formulaire, ne vaut pas pour `y`
          await cliquer('#bp', 'mjs-par')
          await attend('refus du formulaire du parent : objet du parent', ['#etatp', 'mjs-par'], ['P refuse', '', true, false])

          // 4. l'enfant léger de la page retiré, puis remis après sa destruction : ses écouteurs reviennent, une fois, et le formulaire qui
          // l'entoure l'emporte encore
          await ev('(() => { const e = window.__q("mjs-ldoc", "mjs-lpar"), f = e.parentNode; e.remove(); setTimeout(() => f.insertBefore(e, f.firstChild), 200) })()')
          await p.waitForTimeout(700)
          vaut('écouteurs après le retour de l’enfant léger dans la page', await ev('window.__ecoute()'), depart)
          await cliquer('#bd', 'mjs-lpar')
          await attend('refus du formulaire qui porte l’enfant léger revenu', ['#etatldoc', 'mjs-lpar'], ['U refuse', true])

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
