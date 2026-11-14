// L'objet formulaire d'un composant (la rune `µform(@)`) au navigateur réel : la valeur de départ d'un champ se prend quand sa saisie est
// là (un module du cœur dans <@@field>, qui arrive après le composant, reste propre jusqu'au premier geste ; un champ qu'un {if} ajoute
// prend son départ à son arrivée, et la remise à zéro le lui rend), les valeurs envoyées sont celles de l'envoi qui part vraiment (un
// formulaire `mjs-no-disable` dont l'envoi est annulé n'emporte rien), le refus du serveur n'agit que sur l'objet du composant dont le
// formulaire l'a reçu, et une variable qui masque un nom de l'objet est annoncée une fois par composant et par nom. En développement (les
// modules du cœur servis en retard), puis en production en un seul fichier minifié.
// moteurs exigés : chromium firefox webkit

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { MOTEURS, moteurPresent } from './helpers/navigateurs-compiles.js'

const SOURCES: Record<string, string> = {
  'coeur.mjs': `<vars>
  $qty  int 1..10
  $pays string 2..2
</vars>

<script>
  $qty  = 1
  $pays = 'fr'
  $form = µform(this)
  window.__coeur = -> JSON.stringify([$form.qty, $form.pays, $form.valid, $qty, $pays])
</script>

<form id="fc" action="/coeur" method="post">
  <@@field label="Quantité"><@@number id="qty" name="qty" value=!{$qty}></@@number></@@field>
  <@@field label="Pays"><@@select id="pays" name="pays" value=!{$pays}><@@option value="fr">France</@@option><@@option value="be">Belgique</@@option></@@select></@@field>
</form>
<p id="etat">{JSON.stringify([$form.qty, $form.pays, $form.valid, $qty, $pays])}</p>
`,
  'plus.mjs': `<vars>
  $qte int 1..10
  $nom string 3..20
</vars>

<script>
  $qte  = 3
  $nom  = 'Anne'
  $plus = false
  $form = µform(this)
  window.__plus = -> $plus = true
  window.__raz  = -> $form.reset()
</script>

<form id="fp" action="/plus" method="post">
  {if $plus}
    <@@field name="qte" label="Quantité"><input id="qte" type="number" value=!{$qte}></@@field>
    <@@field label="Nom"><input id="nom" name="nom" value=!{$nom}></@@field>
  {end}
  <button id="raz" type="reset">Effacer</button>
</form>
<p id="etat">{JSON.stringify([$form.qte, $form.nom, $form.valid, $qte, $nom])}</p>
`,
  'nd.mjs': `<vars>
  $pseudo string 3..20
</vars>

<script>
  $pseudo = 'bob'
  $form   = µform(this)
</script>

<form id="fnd" action="/nd" method="post" mjs-no-disable>
  <input id="pseudo" name="pseudo" value=!{$pseudo}>
  <button id="envoyer">Envoyer</button>
</form>
<p id="etat">{JSON.stringify([$form.pseudo, $form.valid])}</p>
`,
  'paire.mjs': `<vars>
  $nick string 3..20
</vars>

<script>
  $form = µform(this)
</script>

<form action="/paire" method="post">
  <@@field label="Pseudo"><input class="nick" name="nick" value=!{$nick}></@@field>
  <button class="envoyer">Envoyer</button>
</form>
<p id="etat">{JSON.stringify([$form.nick, $form.valid])}</p>
`,
  'noms.mjs': `<vars>
  $valid  string 3..10
  $fields string 3..10
</vars>

<script>
  $form = µform(this)
</script>

<p id="etat">{JSON.stringify([typeof $form.valid, $form.fields.valid.error])}</p>
`,
}

const PAGE  = '<mjs-coeur></mjs-coeur><mjs-plus></mjs-plus><mjs-nd></mjs-nd><mjs-paire></mjs-paire><mjs-paire></mjs-paire><mjs-noms></mjs-noms><mjs-noms></mjs-noms><mjs-noms></mjs-noms>'
const TYPES: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.map': 'application/json', '.css': 'text/css' }

// les outils de la page : l'ombre d'un composant (une suite de balises, de l'extérieur vers l'intérieur ; `balise@1` : la deuxième), un
// élément dedans, son état
const OUTILS = `
  window.__r = (...hs) => { let r = document; for (const h of hs) { const m = /^(.+)@(\\d+)$/.exec(h); const e = m ? r.querySelectorAll(m[1])[+m[2]] : r.querySelector(h); if (!e) return null; r = e._shadow || e.shadowRoot || e } return r }
  window.__q = (s, ...hs) => { const r = window.__r(...hs); return r && r.querySelector(s) }
  window.__etat = (...hs) => { const p = window.__q('#etat', ...hs); try { return JSON.parse(p.textContent) } catch { return null } }
`

async function construire(sources: Record<string, string>, mode: string): Promise<string> {
  const root = mjsTmp('form-depart-' + mode)
  const src  = join(root, 'src')
  const out  = join(root, 'dist')
  mkdirSync(src, { recursive: true })
  for (const [fichier, contenu] of Object.entries(sources)) writeFileSync(join(src, fichier), contenu)
  const prod    = mode === 'production' ? { forceMinify: true, minimalRuntime: true, js: 'bundle', env: 'prod' } : {}
  const bundler = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), urlPrefix: '/modularjs', runtime: ['ujs', 'ajax', 'vault'], ...prod } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return out
}

describe('µform(@) au navigateur réel — le départ des champs, l’envoi qui part, le refus du bon composant', function () {
  this.timeout(300000)
  const dists: Record<string, string> = {}
  let server: Server | null = null
  let origin = ''
  let mode   = ''
  const recus: string[] = []

  before(async () => {
    for (const m of ['developpement', 'production']) dists[m] = await construire(SOURCES, m)
    server = createServer((req, res) => {
      const url   = new URL(req.url || '/', 'http://x')
      const fiche = (statut: number, module: string, props: object) => { res.writeHead(statut, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify({ module, props, url: url.pathname, title: null })) }
      if (req.method === 'POST') {
        let corps = ''
        req.on('data', (d) => { corps += d })
        req.on('end', () => {
          recus.push(url.pathname + ' ' + corps)
          if (url.pathname === '/nd') return setTimeout(() => fiche(422, 'mjs-nd', { errors: { pseudo: 'Pris: ' + new URLSearchParams(corps).get('pseudo') } }), 600)
          if (url.pathname === '/paire') return setTimeout(() => fiche(422, 'mjs-paire', { errors: { nick: 'Pseudo pris' } }), 200)
          fiche(422, 'mjs-plus', { errors: {} })
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
      // en développement, les modules du cœur arrivent après le composant qui les écrit (comme sur un réseau lent)
      const retard = mode === 'developpement' && /number|select|option/.test(m![1]) ? 500 : 0
      setTimeout(() => {
        res.writeHead(200, { 'content-type': TYPES[extname(fichier)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
        res.end(readFileSync(fichier))
      }, retard)
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
        recus.length = 0
        const playwright: any = await import('playwright')
        const browser = await playwright[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
        try {
          const p = await browser.newPage()
          const erreurs: string[] = []
          const avis: string[]    = []
          p.on('pageerror', (e: any) => erreurs.push(String(e)))
          // la console signale chaque réponse 422 attendue (« Failed to load resource ») : seules les autres erreurs comptent
          p.on('console', (c: any) => {
            if (c.type() === 'warning') avis.push(c.text())
            if (c.type() === 'error' && !/Failed to load resource/.test(c.text())) erreurs.push('console : ' + c.text())
          })
          await p.addInitScript(OUTILS)
          await p.goto(origin + '/')
          const etat     = (...hs: string[]): Promise<any> => p.evaluate((l: string[]) => (window as any).__etat(...l), hs)
          const attendre = async (fn: string, quoi: string) => {
            try { await p.waitForFunction(fn, null, { timeout: 8000 }) }
            catch { assert.fail(quoi + ' — erreurs : ' + erreurs.join(' | ')) }
          }
          // de vrais gestes (l'ombre des composants est fermée : l'élément est pris par la page) ; `force` : WebKit ne voit pas l'intérieur
          // d'une ombre fermée au point du clic
          const cliquer  = async (s: string, ...hs: string[]) => (await p.evaluateHandle((l: string[]) => (window as any).__q(...l), [s, ...hs])).asElement().click({ timeout: 5000, force: true })
          const taper    = async (texte: string, s: string, ...hs: string[]) => {
            await cliquer(s, ...hs)
            await p.keyboard.type(texte)
          }
          const vider    = async (s: string, ...hs: string[]) => {
            await cliquer(s, ...hs)
            await p.keyboard.press('ControlOrMeta+A')
            await p.keyboard.press('Backspace')
          }
          // chaque cas joué à part, ses échecs relevés : un cas qui échoue n'empêche pas les suivants de dire les leurs
          const echecs: string[] = []
          const cas = async (titre: string, hote: string, corps: () => Promise<void>) => {
            try {
              await attendre(`window.__etat('${hote}') !== null`, hote + ' n’affiche pas son état')
              await corps()
            }
            catch (e: any) { echecs.push(titre + ' : ' + String(e && e.message || e).split('\n')[0]) }
          }
          const propre = { error: '', touched: false, dirty: false }

          // 1. <@@number> et <@@select> dans <@@field> : propres jusqu'au premier geste, même quand le module arrive après le composant (l'objet
          // lu en direct, comme le code d'un gestionnaire le lit)
          await cas('1. modules du cœur dans <@@field>', 'mjs-coeur', async () => {
            const direct = async () => JSON.parse(await p.evaluate('window.__coeur()') as string)
            await attendre('!!customElements.get("mjs-core-number") && !!customElements.get("mjs-core-select") && !!window.__q(\'input[type="hidden"][name="qty"]\', "mjs-coeur")', 'les modules du cœur ne sont pas montés')
            await p.waitForTimeout(400)
            assert.deepEqual(await direct(), [propre, propre, true, 1, 'fr'], 'sans geste')
            await p.waitForTimeout(1200)
            assert.deepEqual(await direct(), [propre, propre, true, 1, 'fr'], 'sans geste, plus tard')
            assert.deepEqual((await etat('mjs-coeur')).slice(0, 3), [propre, propre, true], 'sans geste, le gabarit')
            await cliquer('.input', 'mjs-coeur', 'mjs-core-number')
            await p.keyboard.press('ArrowUp')
            await p.keyboard.press('Tab')
            await attendre('(() => { const e = JSON.parse(window.__coeur()); return e[0].dirty === true && e[0].touched === true && e[3] === 2 && e[1].dirty === false && e[1].touched === false })()', 'le geste sur le module n’est pas suivi')
          })

          // 2. un champ qu'un {if} ajoute prend son départ à son arrivée ; la remise à zéro (native, puis par l'objet) le lui rend
          await cas('2. champ ajouté par {if}, remise à zéro', 'mjs-plus', async () => {
            await p.evaluate(() => (window as any).__plus())
            await attendre('!!window.__q("#qte", "mjs-plus") && !!window.__q("#nom", "mjs-plus")', 'les champs ajoutés manquent')
            await p.waitForTimeout(300)
            assert.deepEqual(await etat('mjs-plus'), [propre, propre, true, 3, 'Anne'], 'à l’arrivée des champs')
            await vider('#qte', 'mjs-plus')
            await p.keyboard.type('5')
            await p.keyboard.press('Tab')
            await attendre('(() => { const e = window.__etat("mjs-plus"); return e && e[0].dirty === true && e[3] === 5 })()', 'la saisie de la quantité n’est pas suivie')
            await cliquer('#raz', 'mjs-plus')
            await p.waitForTimeout(400)
            assert.deepEqual(await p.evaluate(() => [(window as any).__q('#qte', 'mjs-plus').value, (window as any).__q('#nom', 'mjs-plus').value]), ['3', 'Anne'], 'saisies après le reset natif')
            assert.deepEqual(await etat('mjs-plus'), [propre, propre, true, 3, 'Anne'], 'après le reset natif')
            await taper('x', '#nom', 'mjs-plus')
            await attendre('(() => { const e = window.__etat("mjs-plus"); return e && e[1].dirty === true })()', 'la saisie du nom n’est pas suivie')
            await p.evaluate(() => (window as any).__raz())
            await p.waitForTimeout(300)
            assert.deepEqual(await etat('mjs-plus'), [propre, propre, true, 3, 'Anne'], 'après $form.reset()')
          })

          // 3. mjs-no-disable : un envoi annulé n'emporte rien, le refus de l'envoi parti ne vaut que pour sa valeur
          await cas('3. mjs-no-disable, envoi annulé', 'mjs-nd', async () => {
            await p.evaluate(() => (window as any).__q('#fnd', 'mjs-nd').addEventListener('submit', (e: Event) => { if ((window as any).__bloque) e.preventDefault() }))
            const n0 = recus.length
            await cliquer('#envoyer', 'mjs-nd')
            await p.waitForTimeout(150)
            await taper('x', '#pseudo', 'mjs-nd')
            await p.evaluate(() => { (window as any).__bloque = true; (window as any).__q('#fnd', 'mjs-nd').requestSubmit(); (window as any).__bloque = false })
            await p.waitForTimeout(1000)
            assert.deepEqual(recus.slice(n0), ['/nd pseudo=bob'], 'envois reçus')
            assert.deepEqual(await etat('mjs-nd'), [{ error: '', touched: true, dirty: true }, true], 'le refus de « bob » vaut pour « bobx »')
            await vider('#pseudo', 'mjs-nd')
            await p.keyboard.type('eve')
            await cliquer('#envoyer', 'mjs-nd')
            await attendre('(() => { const e = window.__etat("mjs-nd"); return e && e[0].error === "Pris: eve" && e[1] === false })()', 'le refus de « eve », envoyé, ne s’affiche pas')
          })

          // 4. deux composants avec l'objet : le refus du premier n'agit pas sur le second, qui n'a rien envoyé
          await cas('4. deux composants avec l’objet', 'mjs-paire@1', async () => {
            await taper('zed', '.nick', 'mjs-paire@1')
            await p.keyboard.press('Tab')
            await taper('bob', '.nick', 'mjs-paire@0')
            await cliquer('.envoyer', 'mjs-paire@0')
            await attendre('(() => { const e = window.__etat("mjs-paire@0"); return e && e[0].error === "Pseudo pris" && e[1] === false })()', 'le refus du premier ne s’affiche pas')
            await p.waitForTimeout(300)
            assert.deepEqual(await etat('mjs-paire@1'), [{ error: '', touched: true, dirty: true }, true], 'le second')
            const marque = await p.evaluate(() => (window as any).__q('.nick', 'mjs-paire@1').getAttribute('mjs-field'))
            assert.ok(marque !== 'error', '<@@field> du second montre le refus du premier')
          })

          // 5. une variable qui masque un nom de l'objet : annoncée une fois par composant et par nom (trois instances, deux noms)
          await cas('5. nom masqué', 'mjs-noms', async () => {
            const dits = avis.filter(t => /µform/.test(t))
            assert.equal(dits.length, m === 'developpement' ? 2 : 0, dits.join(' | '))
          })

          assert.deepEqual(echecs, [], echecs.join('\n'))
          assert.deepEqual(erreurs, [], erreurs.join('\n'))
        }
        finally {
          await browser.close()
        }
      })
    }
  }
})
