// L'objet formulaire (la rune `µform(@)`) au navigateur réel, entre composants imbriqués qui nomment leurs champs pareil : un champ
// appartient au composant dont le gabarit l'a écrit. Un parent avec l'objet ne prend ni la saisie ni les erreurs d'un enfant, léger
// (`mjs-light`) ou à ombre, avec ou sans objet ; le <@@field> d'un enfant ou d'un petit-enfant sans objet montre le refus de son propre
// formulaire (la réponse rangée sous ce formulaire, comme sans objet), celui d'un enfant avec objet lit son objet, jamais celui d'un
// ancêtre. Chaque formulaire a ses réponses : le <@@field> d'un autre formulaire garde ce qu'il montrait (il ne passe pas au succès sur la
// réponse du voisin), un objet garde le refus de son formulaire quand un autre formulaire est refusé, et deux instances d'un composant
// gardent chacune les leurs, même `id` compris. Développement, puis production en un seul fichier minifié.
// moteurs exigés : chromium firefox webkit

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { MOTEURS, moteurPresent } from './helpers/navigateurs-compiles.js'

// un formulaire refusé par le serveur (`act`), son champ `x` et son bouton
const FORM = (id: string, act: string, champ: string) => `<form id="f${id}" action="${act}" method="post">
  ${champ}
  <button id="b${id}">${id}</button>
</form>
`

const SOURCES: Record<string, string> = {
  // le parent : l'objet, une variable `$x` ; deux enfants légers AVANT son propre formulaire (le premier champ `x` de son arbre est le
  // leur), puis des enfants à ombre
  'par.mjs': `<vars>
  $x string 0..20
</vars>

<script>
  $x    = 'par'
  $form = µform(this)
</script>

<mjs-leg mjs-light></mjs-leg>
<mjs-lobj mjs-light></mjs-lobj>
` + FORM('p', '/kp', '<@@field label="XP"><input id="xp" name="x" value=!{$x}></@@field>') + `<@sobj></@sobj>
<@oobj></@oobj>
<mjs-mid mjs-light></mjs-mid>
<p id="etatp">{JSON.stringify([$form.x.error, $form.x.touched, $form.x.dirty])}</p>
`,
  // enfant léger sans objet
  'leg.mjs': FORM('l', '/kl', '<@@field label="XL"><input id="xl" name="x" value="leg"></@@field>'),
  // enfant léger avec son objet, mêmes noms
  'lobj.mjs': `<vars>
  $x string 3..10
</vars>

<script>
  $x    = 'lobj'
  $form = µform(this)
</script>

` + FORM('lo', '/klo', '<@@field label="XLO"><input id="xlo" name="x" value=!{$x}></@@field>') + `<p id="etatlo">{JSON.stringify([$form.x.error, $form.x.touched])}</p>
`,
  // enfant à ombre sans objet : le name posé sur l'enveloppe
  'sobj.mjs': FORM('s', '/ks', '<@@field name="x" label="XS"><input id="xs" value="sobj"></@@field>'),
  // enfant à ombre avec son objet, mêmes noms
  'oobj.mjs': `<vars>
  $x string 3..10
</vars>

<script>
  $x    = 'oobj'
  $form = µform(this)
</script>

` + FORM('o', '/ko', '<@@field label="XO"><input id="xo" name="x" value=!{$x}></@@field>') + `<p id="etato">{JSON.stringify([$form.x.error])}</p>
`,
  // un léger sans objet qui porte un petit-enfant à ombre sans objet
  'mid.mjs': `<@pet></@pet>
`,
  'pet.mjs': FORM('pe', '/kpe', '<@@field name="x" label="XPE"><input id="xpe" value="pet"></@@field>'),
}

const REFUS: Record<string, string> = { '/kp': 'P refuse', '/kl': 'L refuse', '/klo': 'LO refuse', '/ks': 'S refuse', '/ko': 'O refuse', '/kpe': 'PE refuse' }
const PAGE  = '<mjs-par></mjs-par><mjs-sobj id="dehors"></mjs-sobj>'
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
  const root = mjsTmp('form-proprio-' + mode)
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

describe('µform(@) au navigateur réel — un champ appartient au composant qui l’a écrit', function () {
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
          res.end(JSON.stringify({ module: 'mjs-par', props: { errors: { x: REFUS[url.pathname] || 'refus' } }, url: url.pathname, title: null }))
        })
        return
      }
      if (url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        res.end('<!doctype html><html lang="fr"><head><meta charset="utf-8"><script type="module" src="/modularjs/bundle.js"></script></head><body>' + PAGE + '</body></html>')
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
          const montre  = async (texte: string, ...l: string[]) => {
            try { await p.waitForFunction((x: any) => { const c = (window as any).__champ(...x.l); return !!c && c[0] === 'error' && c[1] === x.t }, { l, t: texte }, { timeout: 8000 }) }
            catch { echecs.push(l.join(' < ') + ' devait montrer « ' + texte + ' », montre ' + JSON.stringify(await champ(...l)) + (erreurs.length ? ' — erreurs : ' + erreurs.join(' | ') : '')) }
          }
          const vaut    = (titre: string, lu: any, attendu: any) => { if (JSON.stringify(lu) !== JSON.stringify(attendu)) echecs.push(titre + ' : ' + JSON.stringify(lu) + ' au lieu de ' + JSON.stringify(attendu)) }
          const echecs: string[] = []
          await p.waitForFunction(() => { const w = window as any; return w.__etat('#etatp', 'mjs-par') !== null && w.__etat('#etatlo', 'mjs-par') !== null && w.__etat('#etato', 'mjs-par', 'mjs-oobj') !== null && !!w.__q('#xpe', 'mjs-par', 'mjs-mid', 'mjs-pet') && !!w.__q('#xs', 'mjs-sobj#dehors') }, null, { timeout: 15000 })
          await p.waitForTimeout(300)

          // 1. la frappe dans l'enfant léger sans objet (le premier champ `x` de l'arbre du parent) : le parent n'a rien de modifié
          await cliquer('#xl', 'mjs-par')
          await p.keyboard.type('z')
          await p.waitForTimeout(200)
          vaut('frappe chez l’enfant léger : x du parent', await etat('#etatp', 'mjs-par'), ['', false, false])

          // 2. le refus du seul formulaire de l'enfant léger sans objet : rien chez le parent, ni erreur ni champ touché, son <@@field> reste
          // neutre (la réponse se range sous le formulaire qui l'a reçue : aucune n'est venue au sien) ; celui de l'enfant montre le refus ;
          // l'enfant léger avec objet, dont le formulaire n'est pas parti, ne le prend pas et son <@@field> reste neutre
          await cliquer('#bl', 'mjs-par')
          await montre('L refuse', '#xl', 'mjs-par')
          await p.waitForTimeout(200)
          vaut('refus de l’enfant léger : x du parent', await etat('#etatp', 'mjs-par'), ['', false, false])
          vaut('refus de l’enfant léger : <@@field> du parent', await champ('#xp', 'mjs-par'), [null, ''])
          vaut('refus de l’enfant léger : objet de l’enfant léger avec objet', await etat('#etatlo', 'mjs-par'), ['', false])
          vaut('refus de l’enfant léger : <@@field> de l’enfant léger avec objet', await champ('#xlo', 'mjs-par'), [null, ''])

          // 3. le refus du formulaire d'un enfant à ombre sans objet : son <@@field name="x"> le montre ; l'autre instance du même composant,
          // dehors, dont le formulaire porte le même id, garde ses réponses (deux instances gardent chacune les leurs) : son <@@field> reste neutre
          await cliquer('#bs', 'mjs-par', 'mjs-sobj')
          await montre('S refuse', '#xs', 'mjs-par', 'mjs-sobj')
          await p.waitForTimeout(200)
          vaut('refus de l’enfant à ombre : <@@field> de l’autre instance, dehors', await champ('#xs', 'mjs-sobj#dehors'), [null, ''])
          vaut('refus de l’enfant à ombre : x du parent', await etat('#etatp', 'mjs-par'), ['', false, false])

          // 4. le refus du formulaire d'un petit-enfant sans objet, sous un léger sans objet : son <@@field> le montre
          await cliquer('#bpe', 'mjs-par', 'mjs-mid', 'mjs-pet')
          await montre('PE refuse', '#xpe', 'mjs-par', 'mjs-mid', 'mjs-pet')
          vaut('refus du petit-enfant : x du parent', await etat('#etatp', 'mjs-par'), ['', false, false])

          // 5. le refus du formulaire d'un enfant à ombre avec son objet, mêmes noms : pour son objet, pas pour celui du parent, dont le
          // <@@field> reste neutre
          await cliquer('#bo', 'mjs-par', 'mjs-oobj')
          await montre('O refuse', '#xo', 'mjs-par', 'mjs-oobj')
          await p.waitForTimeout(200)
          vaut('refus de l’enfant à ombre avec objet : son objet', await etat('#etato', 'mjs-par', 'mjs-oobj'), ['O refuse'])
          vaut('refus de l’enfant à ombre avec objet : x du parent', await etat('#etatp', 'mjs-par'), ['', false, false])
          vaut('refus de l’enfant à ombre avec objet : <@@field> du parent', await champ('#xp', 'mjs-par'), [null, ''])

          // 6. le refus du formulaire de l'enfant léger avec son objet : pour son objet, pas pour celui du parent, dont le <@@field> reste neutre
          await cliquer('#blo', 'mjs-par')
          await montre('LO refuse', '#xlo', 'mjs-par')
          await p.waitForTimeout(200)
          vaut('refus de l’enfant léger avec objet : son objet', await etat('#etatlo', 'mjs-par'), ['LO refuse', true])
          vaut('refus de l’enfant léger avec objet : x du parent', await etat('#etatp', 'mjs-par'), ['', false, false])
          vaut('refus de l’enfant léger avec objet : <@@field> du parent', await champ('#xp', 'mjs-par'), [null, ''])

          // 7. le formulaire du parent : sa frappe le modifie, son refus est pour lui seul — ni l'objet de l'enfant léger, ni celui de
          // l'enfant à ombre ne le prennent, et il n'efface pas le refus que chacun a reçu pour son propre formulaire : leurs objets et le
          // <@@field> de l'enfant léger avec objet le montrent encore
          await cliquer('#xp', 'mjs-par')
          await p.keyboard.type('q')
          await p.waitForTimeout(200)
          vaut('frappe chez le parent : x du parent', await etat('#etatp', 'mjs-par'), ['', false, true])
          await cliquer('#bp', 'mjs-par')
          await montre('P refuse', '#xp', 'mjs-par')
          await p.waitForTimeout(200)
          vaut('refus du parent : x du parent', await etat('#etatp', 'mjs-par'), ['P refuse', true, true])
          vaut('refus du parent : objet de l’enfant léger', await etat('#etatlo', 'mjs-par'), ['LO refuse', true])
          vaut('refus du parent : objet de l’enfant à ombre', await etat('#etato', 'mjs-par', 'mjs-oobj'), ['O refuse'])
          vaut('refus du parent : <@@field> de l’enfant léger avec objet', await champ('#xlo', 'mjs-par'), ['error', 'LO refuse'])

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
