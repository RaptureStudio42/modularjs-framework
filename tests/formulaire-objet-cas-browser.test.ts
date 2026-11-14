// L'objet formulaire d'un composant (la rune `µform(@)`) au navigateur réel, dans les cas limites : un `name` posé sur l'enveloppe
// <@@field> (le champ reste l'élément de saisie), deux envois rapprochés (l'objet suit l'envoi que la navigation fait vraiment), la remise
// à zéro d'une valeur de départ que sa règle refuse (le gabarit la montre), deux formulaires dans un composant (chacun n'agit que sur ses
// champs), le coût des écritures (un seul rafraîchissement par tour), une variable qui porte un nom de l'objet (annoncée en développement,
// lisible par `fields`), <@@field> dans un composant enfant et une liste multiple écrite par le code. Puis, sans l'objet, une appli dont la liste
// `runtime` omet `vault` : <@@field> s'y monte sans erreur. Développement, puis production en un seul fichier minifié.
// moteurs exigés : chromium firefox webkit

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { MOTEURS, moteurPresent } from './helpers/navigateurs-compiles.js'

const ECRIRE = (nom: string) => `  window.${nom} = (nb)->
    i = 0
    while i < nb
      $n = i % 90
      i++
    null
`

const SOURCES: Record<string, string> = {
  'env.mjs': `<vars>
  $nick string 3..20
  $code string 2..5
</vars>

<script>
  $form = µform(this)
</script>

<form id="fe" action="/env" method="post">
  <@@field name="nick" label="Pseudo"><input id="nick" name="nick" value=!{$nick}></@@field>
  <@@field name="code" label="Code"><input id="code" value=!{$code}></@@field>
</form>
<p id="etat">{JSON.stringify([$form.nick, $form.code, $form.valid])}</p>
`,
  'double.mjs': `<vars>
  $pseudo string 3..20
</vars>

<script>
  $form = µform(this)
</script>

<form id="fd" action="/double" method="post">
  <input id="pseudo" name="pseudo" value=!{$pseudo}>
</form>
<p id="etat">{JSON.stringify([$form.pseudo, $form.valid, $form.submitting])}</p>
`,
  'raz.mjs': `<vars>
  $nick string 3..20
</vars>

<script>
  $form = µform(this)
</script>

<input id="nick" name="nick" value=!{$nick}>
<button id="effacer" type="button" @click={$form.reset()}>Effacer</button>
<p id="echo">{$nick}</p>
<p id="etat">{JSON.stringify([$form.nick, $form.valid])}</p>
`,
  'deux.mjs': `<vars>
  $a string 3..10
  $b string 3..10
</vars>

<script>
  $form = µform(this)
</script>

<form id="fa" action="/fa" method="post">
  <@@field label="A"><input id="a" name="a" value=!{$a}></@@field>
  <button id="ea">A</button>
  <button id="ra" type="reset">RAZ A</button>
</form>
<form id="fb" action="/fb" method="post">
  <@@field label="B"><input id="b" name="b" value=!{$b}></@@field>
</form>
<p id="etat">{JSON.stringify([$form.a, $form.b, $form.valid, $a, $b])}</p>
`,
  'cout.mjs': `<vars>
  $n int 0..100
</vars>

<script>
  $n    = 5
  $form = µform(this)
${ECRIRE('__ecrire')}</script>

<input id="n" name="n" type="number" value=!{$n}>
<p id="etat">{JSON.stringify([$form.n, $form.valid])}</p>
`,
  'sans.mjs': `<vars>
  $n int 0..100
</vars>

<script>
  $n = 5
${ECRIRE('__ecrireSans')}</script>

<input id="n" name="n" type="number" value=!{$n}>
<p id="etat">{JSON.stringify([$n])}</p>
`,
  'masque.mjs': `<vars>
  $valid string 1..5
</vars>

<script>
  $form = µform(this)
</script>

<input id="valid" name="valid" value=!{$valid}>
<p id="etat">{JSON.stringify([typeof $form.valid, $form.fields.valid])}</p>
`,
  'parent.mjs': `<vars>
  $mel string 5..9
</vars>

<script>
  $form = µform(this)
</script>

<form id="fp" action="/fp" method="post">
  <@@field label="Mel"><input id="melp" name="mel" value=!{$mel}></@@field>
  <@enfant></@enfant>
</form>
<p id="etat">{JSON.stringify([$form.mel, $form.valid])}</p>
`,
  'enfant.mjs': `<vars>
  $mel string 3..30
</vars>

<script>
  $form = µform(this)
</script>

<@@field label="Mel"><input id="melc" name="mel" value=!{$mel}></@@field>
<p id="etat">{JSON.stringify([$form.mel, $form.valid])}</p>
`,
  'liste.mjs': `<vars>
  $tags string 1..5[] ..2 | null
</vars>

<script>
  $tags = null
  $form = µform(this)
  window.__tags = (v)-> $tags = v
</script>

<form id="fl" action="/fl" method="post">
  <select id="tags" name="tags[]" multiple value=!{$tags}><option>a</option><option>b</option><option>c</option></select>
</form>
<p id="etat">{JSON.stringify([$form.tags, $form.valid, $tags])}</p>
`,
}

// sans l'objet, liste `runtime` sans `vault`
const SOURCES_V: Record<string, string> = {
  'champ.mjs': `<form id="g" action="/g" method="post">
  <@@field label="Ville"><input id="ville" name="ville" value="Lyon"></@@field>
</form>
`,
  'liste2.mjs': `<vars>
  $tags string 1..5[] ..2 | null
</vars>

<script>
  $tags = null
</script>

<select id="tags" name="tags[]" multiple value=!{$tags}><option>a</option><option>b</option><option>c</option></select>
<p id="etat">{JSON.stringify([$tags])}</p>
`,
}

const PAGE   = '<mjs-env></mjs-env><mjs-double></mjs-double><mjs-raz></mjs-raz><mjs-deux></mjs-deux><mjs-cout></mjs-cout><mjs-sans></mjs-sans><mjs-masque></mjs-masque><mjs-parent></mjs-parent><mjs-liste></mjs-liste>'
const PAGE_V = '<mjs-champ></mjs-champ><mjs-liste2></mjs-liste2>'
const TYPES: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.map': 'application/json', '.css': 'text/css' }

// les outils de la page : l'ombre d'un composant (une suite de balises, de l'extérieur vers l'intérieur), un élément dedans, son état
const OUTILS = `
  window.__r = (...hs) => { let r = document; for (const h of hs) { const e = r.querySelector(h); if (!e) return null; r = e._shadow || e.shadowRoot || e } return r }
  window.__q = (s, ...hs) => { const r = window.__r(...hs); return r && r.querySelector(s) }
  window.__etat = (...hs) => { const p = window.__q('#etat', ...hs); try { return JSON.parse(p.textContent) } catch { return null } }
`

async function construire(nom: string, sources: Record<string, string>, mode: string, prefixe: string, runtime: string[]): Promise<string> {
  const root = mjsTmp(nom + '-' + mode)
  const src  = join(root, 'src')
  const out  = join(root, 'dist')
  mkdirSync(src, { recursive: true })
  for (const [fichier, contenu] of Object.entries(sources)) writeFileSync(join(src, fichier), contenu)
  const prod    = mode === 'production' ? { forceMinify: true, minimalRuntime: true, js: 'bundle', env: 'prod' } : {}
  const bundler = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), urlPrefix: prefixe, runtime, ...prod } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return out
}

describe('µform(@) au navigateur réel — les cas limites de l’objet formulaire', function () {
  this.timeout(300000)
  const dists: Record<string, string> = {}
  let server: Server | null = null
  let origin = ''
  let mode   = ''
  const recus: string[] = []

  before(async () => {
    for (const m of ['developpement', 'production']) {
      dists[m]        = await construire('form-cas', SOURCES, m, '/modularjs', ['ujs', 'ajax', 'vault'])
      dists[m + '-v'] = await construire('form-cas-v', SOURCES_V, m, '/v/modularjs', ['ujs', 'ajax'])
    }
    server = createServer((req, res) => {
      const url   = new URL(req.url || '/', 'http://x')
      const page  = (corps: string, prefixe: string) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end('<!doctype html><html lang="fr"><head><meta charset="utf-8"><script type="module" src="' + prefixe + '/bundle.js"></script></head><body>' + corps + '</body></html>') }
      const fiche = (statut: number, module: string, props: object) => { res.writeHead(statut, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify({ module, props, url: url.pathname, title: null })) }
      if (req.method === 'POST') {
        let corps = ''
        req.on('data', (d) => { corps += d })
        req.on('end', () => {
          recus.push(url.pathname + ' ' + corps)
          if (url.pathname === '/double') return setTimeout(() => fiche(422, 'mjs-double', { errors: { pseudo: 'Pseudo refusé' } }), 600)
          if (url.pathname === '/fa') return setTimeout(() => fiche(422, 'mjs-deux', { errors: { a: 'A refusé' } }), 200)
          fiche(422, 'mjs-env', { errors: {} })
        })
        return
      }
      if (url.pathname === '/') return page(PAGE, '/modularjs')
      if (url.pathname === '/v/') return page(PAGE_V, '/v/modularjs')
      const m       = /^(\/v)?\/modularjs\/(.+)$/.exec(url.pathname)
      const dist    = m ? dists[mode + (m[1] ? '-v' : '')] : ''
      const fichier = m ? join(dist, normalize(decodeURIComponent(m[2])).replace(/^(\.\.[/\\])+/, '')) : ''
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
          const etat     = (h: string, ...hs: string[]): Promise<any> => p.evaluate((l: string[]) => (window as any).__etat(...l), [h, ...hs])
          const attendre = async (fn: string, quoi: string) => {
            try { await p.waitForFunction(fn, null, { timeout: 8000 }) }
            catch { assert.fail(quoi + ' — erreurs : ' + erreurs.join(' | ')) }
          }
          const lire     = (s: string, ...hs: string[]): Promise<[string | null, string]> => p.evaluate((l: string[]) => { const c = (window as any).__q(...l); return [c.getAttribute('mjs-field'), c.value] }, [s, ...hs])
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

          // 1. un name sur l'enveloppe : le champ reste la saisie — sa frappe, son erreur, `dirty` ; vidé, il redevient obligatoire
          await cas('1. enveloppe nommée', 'mjs-env', async () => {
            await taper('bo', '#nick', 'mjs-env')
            await attendre('window.__etat("mjs-env")[0].error === "Saisissez de 3 à 20 caractères"', 'la frappe sous une enveloppe nommée est ignorée')
            assert.deepEqual((await etat('mjs-env'))[0], { error: 'Saisissez de 3 à 20 caractères', touched: false, dirty: true })
            await p.keyboard.type('bby')
            await attendre('window.__etat("mjs-env")[0].error === ""', 'le pseudo rempli garde une erreur')
            await vider('#nick', 'mjs-env')
            await attendre('window.__etat("mjs-env")[0].error === "Ce champ est obligatoire"', 'le pseudo vidé n’est pas obligatoire')
            assert.equal((await etat('mjs-env'))[2], false)
            await cliquer('#etat', 'mjs-env')
            await attendre('window.__q("#nick", "mjs-env").getAttribute("mjs-field") === "error"', '<@@field> ne montre pas le pseudo vidé en erreur')
            // une saisie sans name dans une enveloppe nommée : le nom de l'enveloppe la désigne, quittée elle est touchée
            await taper('a', '#code', 'mjs-env')
            await cliquer('#etat', 'mjs-env')
            await attendre('window.__etat("mjs-env")[1].touched === true', 'la saisie de l’enveloppe nommée n’est pas touchée')
            assert.deepEqual((await etat('mjs-env'))[1], { error: 'Saisissez de 2 à 5 caractères', touched: true, dirty: true })
            assert.equal((await lire('#code', 'mjs-env'))[0], 'error')
          })

          // 2. deux envois rapprochés : un seul part (« bob ») ; l'erreur du serveur vaut pour « bob », jamais pour « bobx », pas envoyé
          await cas('2. deux envois', 'mjs-double', async () => {
            await taper('bob', '#pseudo', 'mjs-double')
            await p.evaluate(() => (window as any).__q('#fd', 'mjs-double').requestSubmit())
            await attendre('window.__etat("mjs-double")[2] === true', 'submitting ne passe pas à true')
            await taper('x', '#pseudo', 'mjs-double')
            await p.evaluate(() => (window as any).__q('#fd', 'mjs-double').requestSubmit())
            await attendre('window.__etat("mjs-double")[2] === false', 'la réponse du serveur n’arrive pas')
            await p.waitForTimeout(300)
            assert.deepEqual(recus, ['/double pseudo=bob'])
            assert.deepEqual((await etat('mjs-double'))[0], { error: '', touched: true, dirty: true })
            await p.keyboard.press('Backspace')
            await attendre('window.__etat("mjs-double")[0].error === "Pseudo refusé"', 'l’erreur du serveur ne vaut pas pour la valeur envoyée')
          })

          // 3. remise à zéro d'une valeur de départ que sa règle refuse : la variable la reprend, le gabarit la montre
          await cas('3. remise à zéro refusée', 'mjs-raz', async () => {
            await taper('bobby', '#nick', 'mjs-raz')
            await attendre('window.__q("#echo", "mjs-raz").textContent === "bobby"', 'la frappe n’arrive pas à la variable')
            const avisAvant = avis.length
            await cliquer('#effacer', 'mjs-raz')
            await attendre('window.__etat("mjs-raz")[0].dirty === false', 'la remise à zéro ne prend pas')
            await attendre('window.__q("#echo", "mjs-raz").textContent === ""', 'le gabarit garde la valeur d’avant la remise à zéro')
            assert.deepEqual(await etat('mjs-raz'), [{ error: 'Ce champ est obligatoire', touched: false, dirty: false }, false])
            assert.equal((await lire('#nick', 'mjs-raz'))[1], '')
            assert.deepEqual(avis.slice(avisAvant).filter(a => /refuse/.test(a)), [])
          })

          // 4. deux formulaires : envoyer A ne touche pas B ; le reset de A laisse B
          await cas('4. deux formulaires', 'mjs-deux', async () => {
            await taper('aaaa', '#a', 'mjs-deux')
            await cliquer('#ea', 'mjs-deux')
            await attendre('window.__etat("mjs-deux")[0].error === "A refusé"', 'le refus de A n’arrive pas')
            assert.deepEqual((await etat('mjs-deux'))[1], { error: 'Ce champ est obligatoire', touched: false, dirty: false })
            assert.notEqual((await lire('#b', 'mjs-deux'))[0], 'error')
            await taper('bbbb', '#b', 'mjs-deux')
            await taper('x', '#a', 'mjs-deux')
            await cliquer('#ra', 'mjs-deux')
            await attendre('window.__etat("mjs-deux")[0].dirty === false && window.__q("#a", "mjs-deux").value === ""', 'le reset de A ne prend pas')
            const e4 = await etat('mjs-deux')
            assert.deepEqual([e4[1], e4[4], (await lire('#b', 'mjs-deux'))[1]], [{ error: '', touched: true, dirty: true }, 'bbbb', 'bbbb'])
          })

          // 5. mille écritures d'une variable suivie : un seul rafraîchissement de l'objet (une microtâche de plus qu'un composant sans lui)
          await cas('5. coût', 'mjs-cout', async () => {
            const microtaches = await p.evaluate(async () => {
              const w: any = window
              const q      = w.queueMicrotask
              const compte = (f: string) => {
                let n = 0
                w.queueMicrotask = (cb: any) => { n++; return q(cb) }
                try { w[f](1000) }
                finally { w.queueMicrotask = q }
                return n
              }
              const sans = compte('__ecrireSans')
              await new Promise(r => setTimeout(r, 20))
              const avec = compte('__ecrire')
              await new Promise(r => setTimeout(r, 20))
              return [sans, avec]
            })
            assert.ok(microtaches[1] - microtaches[0] <= 1, 'microtâches sans / avec l’objet : ' + microtaches.join(' / '))
            if (process.env.MJS_FORM_MESURE) {
              // mesure A/B côte à côte (ABBA), cent mille écritures, microtâches comprises : rapportée, jamais exigée
              const ms = await p.evaluate(async () => {
                const w: any   = window
                const tour     = async (f: string) => { const t0 = performance.now(); w[f](100000); await new Promise(r => setTimeout(r, 0)); return performance.now() - t0 }
                const r: any   = { sans: [], avec: [] }
                for (let i = 0; i < 10; i++) {
                  r.sans.push(await tour('__ecrireSans'))
                  r.avec.push(await tour('__ecrire'))
                  r.avec.push(await tour('__ecrire'))
                  r.sans.push(await tour('__ecrireSans'))
                }
                const med = (l: number[]) => l.sort((a, b) => a - b)[l.length >> 1]
                return { sans: med(r.sans), avec: med(r.avec) }
              })
              console.log(`      mesure ${nom} ${m} : sans l’objet ${ms.sans.toFixed(1)} ms, avec ${ms.avec.toFixed(1)} ms (médianes de 20)`)
            }
          })

          // 6. une variable qui porte un nom de l'objet : annoncée en développement, lisible par `fields`
          await cas('6. nom gardé', 'mjs-masque', async () => {
            assert.deepEqual(await etat('mjs-masque'), ['boolean', { error: 'Ce champ est obligatoire', touched: false, dirty: false }])
            const masque = avis.filter(a => a.includes('$valid') && a.includes('fields.valid'))
            assert.equal(masque.length, m === 'developpement' ? 1 : 0, avis.join(' | '))
          })

          // 7. <@@field> dans un composant enfant qui a son objet : il suit la règle de l'enfant, pas celle du parent
          await cas('7. composant enfant', 'mjs-parent', async () => {
            await taper('abcd', '#melc', 'mjs-parent', 'mjs-enfant')
            await cliquer('#etat', 'mjs-parent', 'mjs-enfant')
            await attendre('window.__etat("mjs-parent", "mjs-enfant")[0].touched === true', 'le champ de l’enfant n’est pas touché')
            assert.deepEqual(await etat('mjs-parent', 'mjs-enfant'), [{ error: '', touched: true, dirty: true }, true])
            assert.notEqual((await lire('#melc', 'mjs-parent', 'mjs-enfant'))[0], 'error')
            assert.deepEqual((await etat('mjs-parent'))[0], { error: 'Ce champ est obligatoire', touched: false, dirty: false })
          })

          // 8. une liste multiple liée, écrite par le code : l'objet suit sa variable
          await cas('8. liste multiple', 'mjs-liste', async () => {
            await p.evaluate(() => (window as any).__tags(['a', 'b']))
            await attendre('window.__etat("mjs-liste")[0].dirty === true', 'l’objet ne suit pas la liste multiple')
            assert.deepEqual(await etat('mjs-liste'), [{ error: '', touched: false, dirty: true }, true, ['a', 'b']])
            assert.deepEqual(erreurs, [])
          })

          // sans l'objet, liste `runtime` sans `vault` : <@@field> se monte sans erreur
          await p.goto(origin + '/v/')
          await cas('sans vault', 'mjs-liste2', async () => {
            await attendre('!!window.__q(".field", "mjs-champ", "mjs-core-field")', '<@@field> ne se monte pas sans vault')
            await attendre('window.__etat("mjs-liste2") !== null', 'la liste sans objet n’affiche pas son état')
            await p.waitForTimeout(200)
            assert.deepEqual(erreurs, [])
          })

          assert.deepEqual(echecs, [])
        }
        finally {
          await browser.close()
        }
      })
    }
  }
})
