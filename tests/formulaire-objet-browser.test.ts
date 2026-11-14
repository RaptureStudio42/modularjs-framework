// L'objet formulaire d'un composant (la rune `µform(@)`) au navigateur réel, sur un vrai projet construit (développement, puis
// production en un seul fichier minifié) servi par un serveur local qui parle le protocole de navigation : un formulaire de trois
// champs typés et liés — l'erreur de chaque champ tirée de sa règle (même pendant que *guard retient la frappe), `touched` à la
// sortie du champ, `dirty` loin de la valeur de départ, `valid`, `submitting` pendant l'envoi, le refus du serveur (422, erreurs
// fondues par champ et montrées par <@@field>, oubliées quand le champ change), la remise à zéro, puis l'envoi accepté (303).
// Un formulaire sans l'objet, sur la même page : <@@field> montre l'erreur du serveur comme toujours.
// moteurs exigés : chromium firefox webkit

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { MOTEURS, moteurPresent } from './helpers/navigateurs-compiles.js'

const SOURCES: Record<string, string> = {
  'main.mjs': `<vars>
  $age   int 18..120
  $nick  string 3..20 ! 'admin' | 'root'
  $email string 3..60
</vars>

<script>
  $age   = 30
  $email = 'ann@exemple.fr'
  $form  = µform(this)
</script>

<form id="f" action="/inscription" method="post">
  <@@field label="Âge"><input id="age" name="age" type="number" value=!{$age}></@@field>
  <@@field label="Pseudo"><input id="nick" name="nick" value=!{$nick}></@@field>
  <input id="email" name="email" value=!{$email}>
  <button id="envoyer">Envoyer</button>
  <button id="effacer" type="button" @click={$form.reset()}>Effacer</button>
</form>
<p id="etat">{JSON.stringify([$form.age, $form.nick, $form.email, $form.valid, $form.submitting])}</p>
`,
  'sans.mjs': `<form id="g" action="/sans" method="post">
  <@@field label="Ville"><input id="ville" name="ville" value="Lyon"></@@field>
  <button id="envoyer2">Envoyer</button>
</form>
`,
  'merci.mjs': '<p id="merci">Merci</p>\n',
}

const TYPES: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.map': 'application/json', '.css': 'text/css' }

// les outils de la page : l'ombre d'un composant, un élément dedans, l'état écrit par le composant
const OUTILS = `
  window.__r = (t) => { const h = document.querySelector(t || 'mjs-main'); return h && (h._shadow || h.shadowRoot || h) }
  window.__q = (s, t) => { const r = window.__r(t); return r && r.querySelector(s) }
  window.__etat = () => { const p = window.__q('#etat'); try { return JSON.parse(p.textContent) } catch { return null } }
`

type Champ = { error: string, touched: boolean, dirty: boolean }
type Etat = [Champ, Champ, Champ, boolean, boolean]

describe('µform(@) au navigateur réel — l’objet formulaire d’un composant', function () {
  this.timeout(240000)
  const dists: Record<string, string> = {}
  let server: Server | null = null
  let origin = ''
  let dist = ''
  const recus: string[] = []

  before(async () => {
    for (const mode of ['developpement', 'production']) {
      const root = mjsTmp('form-objet-' + mode)
      const src  = join(root, 'src')
      const out  = join(root, 'dist')
      mkdirSync(src, { recursive: true })
      for (const [nom, contenu] of Object.entries(SOURCES)) writeFileSync(join(src, nom), contenu)
      const prod    = mode === 'production' ? { forceMinify: true, minimalRuntime: true, js: 'bundle', env: 'prod' } : {}
      const bundler = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), urlPrefix: '/modularjs', runtime: ['ujs', 'ajax', 'vault'], ...prod } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      dists[mode] = out
    }
    server = createServer((req, res) => {
      const url  = new URL(req.url || '/', 'http://x')
      const nav  = !!req.headers['x-mjs-nav']
      const page = (corps: string) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end('<!doctype html><html lang="fr"><head><meta charset="utf-8"><script type="module" src="/modularjs/bundle.js"></script></head><body>' + corps + '</body></html>') }
      const fiche = (statut: number, module: string, props: object) => { res.writeHead(statut, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify({ module, props, url: url.pathname, title: null })) }
      if (req.method === 'POST') {
        let corps = ''
        req.on('data', (d) => { corps += d })
        req.on('end', () => setTimeout(() => {
          const champs = new URLSearchParams(corps)
          recus.push(url.pathname + ' ' + corps)
          if (url.pathname === '/sans') return fiche(422, 'mjs-sans', { errors: { ville: 'Ville inconnue' } })
          if (champs.get('nick') === 'bob') return fiche(422, 'mjs-main', { errors: { nick: 'Ce pseudo est déjà pris' } })
          res.writeHead(303, { location: '/merci' })
          res.end()
        }, 600))
        return
      }
      if (url.pathname === '/') return page('<mjs-main></mjs-main><mjs-sans></mjs-sans>')
      if (url.pathname === '/merci') return nav ? fiche(200, 'mjs-merci', {}) : page('<mjs-merci></mjs-merci>')
      const m       = /^\/modularjs\/(.+)$/.exec(url.pathname)
      const fichier = m ? join(dist, normalize(decodeURIComponent(m[1])).replace(/^(\.\.[/\\])+/, '')) : ''
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
    for (const mode of ['developpement', 'production']) {
      it(`${nom}, ${mode}`, async function () {
        if (!await moteurPresent(nom)) this.skip()
        dist = dists[mode]
        recus.length = 0
        const playwright: any = await import('playwright')
        const browser = await playwright[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
        try {
          const p = await browser.newPage()
          const erreurs: string[] = []
          p.on('pageerror', (e: any) => erreurs.push(String(e)))
          // la console du navigateur signale chaque réponse 422 attendue (« Failed to load resource ») : seules les autres erreurs comptent
          p.on('console', (m: any) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) erreurs.push('console : ' + m.text()) })
          await p.addInitScript(OUTILS)
          await p.goto(origin + '/')
          const etat    = (): Promise<Etat> => p.evaluate(() => (window as any).__etat())
          const attendre = async (fn: string, quoi: string) => {
            try { await p.waitForFunction(fn, null, { timeout: 8000 }) }
            catch { assert.fail(quoi + ' — état : ' + JSON.stringify(await etat()) + ' — erreurs : ' + erreurs.join(' | ')) }
          }
          const marque = (id: string) => p.evaluate((id: string) => { const c = (window as any).__q('#' + id); return [c.getAttribute('mjs-field'), c.getAttribute('aria-invalid'), c.value] }, id)
          // de vrais gestes (l'ombre des composants est fermée : l'élément est pris par la page) : un clic dans le champ, la frappe,
          // puis un clic hors de lui, le champ quitté. `force` : WebKit ne voit pas l'intérieur d'une ombre fermée au point du clic et
          // croit que l'hôte le prend — le clic part quand même au bon endroit
          const cliquer = async (id: string) => (await p.evaluateHandle((id: string) => (window as any).__q('#' + id), id)).asElement().click({ timeout: 5000, force: true })
          const taper   = async (id: string, texte: string) => {
            await cliquer(id)
            await p.keyboard.type(texte)
          }
          const sortir  = () => cliquer('etat')
          await attendre('window.__etat() !== null', 'le composant n’affiche pas son état')

          // au départ : le pseudo, sans valeur, est obligatoire ; rien n'est touché ni modifié ; <@@field> ne montre rien
          let e = await etat()
          assert.deepEqual(e, [{ error: '', touched: false, dirty: false }, { error: 'Ce champ est obligatoire', touched: false, dirty: false }, { error: '', touched: false, dirty: false }, false, false])
          assert.deepEqual(await marque('nick'), [null, null, ''])

          // la frappe que *guard retient (« bo ») a déjà son erreur ; le champ n'est pas encore touché, mais modifié
          await taper('nick', 'bo')
          await attendre('window.__etat()[1].error === "Saisissez de 3 à 20 caractères"', 'l’erreur de la frappe retenue manque')
          e = await etat()
          assert.deepEqual(e[1], { error: 'Saisissez de 3 à 20 caractères', touched: false, dirty: true })
          assert.equal(e[3], false)
          await p.keyboard.type('b')
          await attendre('window.__etat()[3] === true', 'le formulaire ne devient pas valide')
          await sortir()
          await attendre('window.__etat()[1].touched === true', 'le pseudo quitté n’est pas touché')
          assert.deepEqual((await etat())[1], { error: '', touched: true, dirty: true })

          // l'âge hors plage : erreur pendant la frappe, ramené à la borne à la sortie (*guard), touché et modifié
          await cliquer('age')
          await p.keyboard.press('ControlOrMeta+A')
          await p.keyboard.type('150')
          await attendre('window.__etat()[0].error === "Saisissez un nombre entier de 18 à 120"', 'l’erreur de l’âge manque')
          assert.equal((await etat())[3], false)
          await sortir()
          await attendre('window.__etat()[0].touched === true && window.__etat()[0].error === ""', 'l’âge n’est pas ramené')
          e = await etat()
          assert.deepEqual(e[0], { error: '', touched: true, dirty: true })
          assert.equal((await marque('age'))[2], '120')
          assert.equal(e[3], true)

          // refus du serveur : en cours d'envoi, puis l'erreur fondue au pseudo, montrée par <@@field> ; les autres restent bons
          await p.evaluate(() => (window as any).__q('#envoyer').click())
          await attendre('window.__etat()[4] === true', 'submitting ne passe pas à true pendant l’envoi')
          await attendre('window.__etat()[4] === false && window.__etat()[1].error !== ""', 'le refus du serveur n’arrive pas')
          e = await etat()
          assert.deepEqual(e, [{ error: '', touched: true, dirty: true }, { error: 'Ce pseudo est déjà pris', touched: true, dirty: true }, { error: '', touched: true, dirty: false }, false, false])
          await attendre('window.__q("#nick").getAttribute("mjs-field") === "error"', '<@@field> ne montre pas l’erreur du serveur')
          assert.deepEqual(await marque('nick'), ['error', 'true', 'bob'])
          assert.equal(await p.evaluate(() => (window as any).__r().querySelectorAll('mjs-core-field')[1]._shadow.querySelector('.error').textContent), 'Ce pseudo est déjà pris')
          assert.equal(recus[0], '/inscription age=120&nick=bob&email=ann%40exemple.fr')

          // le pseudo change : l'erreur du serveur ne vaut plus, celle de la règle reprend
          await taper('nick', 'by')
          await attendre('window.__etat()[1].error === "" && window.__etat()[3] === true', 'l’erreur du serveur reste après la correction')
          await attendre('window.__q("#nick").getAttribute("mjs-field") !== "error"', '<@@field> garde l’erreur du serveur')

          // remise à zéro : valeurs de départ (variables et champs), rien de touché ni de modifié, l'erreur de départ revient
          await p.evaluate(() => (window as any).__q('#effacer').click())
          await attendre('window.__etat()[1].touched === false && window.__etat()[0].dirty === false', 'la remise à zéro ne prend pas')
          e = await etat()
          assert.deepEqual(e, [{ error: '', touched: false, dirty: false }, { error: 'Ce champ est obligatoire', touched: false, dirty: false }, { error: '', touched: false, dirty: false }, false, false])
          assert.deepEqual([(await marque('age'))[2], (await marque('nick'))[2], (await marque('email'))[2]], ['30', '', 'ann@exemple.fr'])

          // le formulaire sans l'objet, sur la même page : <@@field> montre l'erreur du serveur comme toujours
          await p.evaluate(() => (window as any).__q('#envoyer2', 'mjs-sans').click())
          await attendre('window.__q("#ville", "mjs-sans").getAttribute("mjs-field") === "error"', '<@@field> sans objet ne montre plus l’erreur du serveur')

          // envoi accepté : 303, la page suivante se monte
          await taper('nick', 'carl')
          await attendre('window.__etat()[3] === true', 'le formulaire rempli n’est pas valide')
          await p.evaluate(() => (window as any).__q('#envoyer').click())
          await attendre('!!window.__q("#merci", "mjs-merci")', 'la page suivante ne se monte pas après le 303')
          assert.equal(recus[recus.length - 1], '/inscription age=30&nick=carl&email=ann%40exemple.fr')
          assert.deepEqual(erreurs, [])
        }
        finally {
          await browser.close()
        }
      })
    }
  }
})
