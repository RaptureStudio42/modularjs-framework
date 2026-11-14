// L'objet formulaire (la rune `µform(@)`) au navigateur réel : le refus du serveur (422) vaut pour les champs que l'envoi a emportés,
// c'est-à-dire ses champs activés et nommés, quelle que soit leur valeur (une case décochée, un groupe radio sans choix, une liste à choix
// multiples vide, un champ dans une <datalist> en sont) — ni un champ désactivé (par son attribut ou par son <fieldset>), ni une saisie
// sans nom (celui de son enveloppe <@@field> ne part pas), ni un bouton autre que celui qui envoie ; le champ d'un autre
// composant rattaché par `form="…"` suit la même règle ; un envoi qui n'emporte plus aucun champ de l'objet (un {if} les a retirés)
// remplace le relevé du précédent, et son refus ne s'affiche pas.
// Développement, puis production en un seul fichier minifié.
// moteurs exigés : chromium firefox webkit

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { MOTEURS, moteurPresent } from './helpers/navigateurs-compiles.js'

const SOURCES: Record<string, string> = {
  // le composant à ombre, avec l'objet : un formulaire dont un seul champ part toujours (`v`), un formulaire dont un {if} retire les deux
  // champs, un enfant léger dont le champ se rattache au premier par `form="f1"`
  'pg.mjs': `<vars>
  $a string 0..20
  $b string 0..20
  $c string 0..20
  $m string 0..20
  $d string 0..20
  $e string 0..20
  $w string 0..20
  $g string 0..20
  $s string 0..20
  $v string 0..20
  $r string 0..20
</vars>

<script>
  $a    = 'aa'
  $b    = 'bb'
  $c    = 'cc'
  $m    = 'mm'
  $d    = 'dd'
  $e    = 'ee'
  $w    = 'ww'
  $g    = 'gg'
  $s    = 'ss'
  $v    = 'vv'
  $r    = 'rr'
  $show = true
  $form = µform(this)
</script>

<form id="f1" action="/k1" method="post">
  <input id="iv" name="v" value=!{$v}>
  <input id="ic" type="checkbox" name="c" value="oui">
  <input id="ir1" type="radio" name="r" value="1"><input id="ir2" type="radio" name="r" value="2">
  <select id="im" name="m" multiple><option value="x">x</option></select>
  <input id="id" name="d" value=!{$d} disabled>
  <fieldset disabled><input id="ie" name="e" value=!{$e}></fieldset>
  <@@field name="w" label="W"><input id="iw" value=!{$w}></@@field>
  <datalist id="dl"><input id="ig" name="g" value=!{$g}></datalist>
  <button id="b1">envoyer</button>
  <button id="bs" name="s" value="go">par s</button>
</form>
<form id="f2" action="/k2" method="post">{if $show}<input id="ia" name="a" value=!{$a}><input id="ib" name="b" value=!{$b}>{end}<button id="b2">envoyer</button></form>
<button id="tg" type="button" @click={$show = not $show}>bascule</button>
<mjs-ch mjs-light></mjs-ch>
<p id="etatp">{JSON.stringify([$form.a.error, $form.b.error, $form.c.error, $form.m.error, $form.d.error, $form.e.error, $form.w.error, $form.g.error, $form.s.error, $form.v.error, $form.r.error])}</p>
`,
  // enfant léger avec son objet : son champ se rattache au formulaire `f1` du parent
  'ch.mjs': `<vars>
  $f string 0..20
</vars>

<script>
  $f    = 'ff'
  $form = µform(this)
</script>

<input id="if" name="f" form="f1" value=!{$f}>
<p id="etatch">{JSON.stringify([$form.f.error])}</p>
`,
}

// chaque refus nomme tous les champs, son texte porte le numéro de l'envoi : un relevé périmé se voit
const NOMS: Record<string, string[]> = { '/k1': ['a', 'b', 'c', 'm', 'd', 'e', 'w', 'g', 's', 'v', 'f', 'r'], '/k2': ['a', 'b'] }
const TYPES: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.map': 'application/json', '.css': 'text/css' }

// les outils de la page : l'ombre d'un composant (une suite de balises, de l'extérieur vers l'intérieur), un élément dedans, son état
const OUTILS = `
  window.__r = (...hs) => { let r = document; for (const h of hs) { const e = r.querySelector(h); if (!e) return null; r = e._shadow || e.shadowRoot || e } return r }
  window.__q = (s, ...hs) => { const r = window.__r(...hs); return r && r.querySelector(s) }
  window.__etat = (...hs) => { const p = window.__q(...hs); try { return JSON.parse(p.textContent) } catch { return null } }
`

async function construire(mode: string): Promise<string> {
  const root = mjsTmp('form-releve-' + mode)
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

describe('µform(@) au navigateur réel — le refus vaut pour ce que le navigateur envoie', function () {
  this.timeout(300000)
  const dists: Record<string, string> = {}
  let server: Server | null = null
  let origin = ''
  let mode   = ''
  let envois = 0

  before(async () => {
    for (const m of ['developpement', 'production']) dists[m] = await construire(m)
    server = createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://x')
      if (req.method === 'POST') {
        req.resume()
        req.on('end', () => {
          const n      = ++envois
          const errors = Object.fromEntries((NOMS[url.pathname] || ['z']).map(k => [k, k.toUpperCase() + '#' + n]))
          res.writeHead(422, { 'content-type': 'application/json', 'cache-control': 'no-store' })
          res.end(JSON.stringify({ module: 'mjs-pg', props: { errors }, url: url.pathname, title: null }))
        })
        return
      }
      if (url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        res.end('<!doctype html><html lang="fr"><head><meta charset="utf-8"><script type="module" src="/modularjs/bundle.js"></script></head><body><mjs-pg></mjs-pg></body></html>')
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
        mode   = m
        envois = 0
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
          const echecs: string[] = []
          const vaut    = (titre: string, lu: any, attendu: any) => { if (JSON.stringify(lu) !== JSON.stringify(attendu)) echecs.push(titre + ' : ' + JSON.stringify(lu) + ' au lieu de ' + JSON.stringify(attendu)) }
          // de vrais gestes (l'ombre du composant est fermée : l'élément est pris par la page) ; `force` : WebKit ne voit pas l'intérieur
          // d'une ombre fermée au point du clic
          const cliquer = async (s: string) => (await p.evaluateHandle((x: string) => (window as any).__q(x, 'mjs-pg'), s)).asElement().click({ timeout: 5000, force: true })
          // un envoi : le clic, la requête reçue par le serveur, puis le temps d'afficher le refus ; rend le numéro de l'envoi
          const envoyer = async (s: string) => {
            const n0 = envois
            await cliquer(s)
            for (let i = 0; i < 50 && envois === n0; i++) await p.waitForTimeout(100)
            await p.waitForTimeout(600)
            return envois
          }
          const attendre = async (titre: string, sel: string, attendu: any) => {
            try { await p.waitForFunction((x: any) => JSON.stringify((window as any).__etat(x.s, 'mjs-pg')) === JSON.stringify(x.a), { s: sel, a: attendu }, { timeout: 5000 }) }
            catch {}
            vaut(titre, await etat(sel, 'mjs-pg'), attendu)
          }
          await p.waitForFunction(() => { const w = window as any; return w.__etat('#etatp', 'mjs-pg') !== null && w.__etat('#etatch', 'mjs-pg') !== null }, null, { timeout: 15000 })
          await p.waitForTimeout(300)
          vaut('départ', await etat('#etatp', 'mjs-pg'), ['', '', '', '', '', '', '', '', '', '', ''])

          // 1. le second formulaire emporte `a` et `b` : leur refus s'affiche
          let n = await envoyer('#b2')
          await attendre('second formulaire, ses deux champs', '#etatp', ['A#' + n, 'B#' + n, '', '', '', '', '', '', '', '', ''])

          // 2. un {if} retire ses deux champs : l'envoi suivant n'emporte plus aucun champ de l'objet, son refus ne s'affiche pas (le relevé
          // vide remplace celui de l'envoi d'avant)
          await cliquer('#tg')
          await p.waitForTimeout(300)
          n = await envoyer('#b2')
          vaut('second formulaire, champs retirés par le {if} (envoi ' + n + ')', await etat('#etatp', 'mjs-pg'), ['', '', '', '', '', '', '', '', '', '', ''])

          // 3. le premier formulaire, par son bouton sans nom : `v`, la case obligatoire décochée `c`, la liste vide `m`, le groupe radio sans
          // choix `r` et le champ `g` d'une <datalist> (le navigateur l'envoie) sont emportés, leur refus s'affiche ; ni le champ désactivé,
          // ni celui d'un <fieldset disabled>, ni la saisie sans nom dans <@@field name="w">, ni le bouton nommé qui n'envoie pas ; le champ
          // de l'enfant rattaché par `form="f1"` part, son objet prend le refus
          n = await envoyer('#b1')
          await attendre('premier formulaire, bouton sans nom', '#etatp', ['', '', 'C#' + n, 'M#' + n, '', '', '', 'G#' + n, '', 'V#' + n, 'R#' + n])
          await attendre('premier formulaire, bouton sans nom : enfant par form=', '#etatch', ['F#' + n])

          // 4. la case cochée, l'option choisie, le champ de l'enfant désactivé, l'envoi par le bouton nommé `s` : `c`, `m`, `r`, `g`, `s`
          // et `v` sont emportés, le champ de l'enfant ne l'est plus et son refus ne s'affiche pas
          await cliquer('#ic')
          await p.evaluate(() => { const w = window as any; w.__q('#im', 'mjs-pg').options[0].selected = true; w.__q('#if', 'mjs-pg').disabled = true })
          n = await envoyer('#bs')
          await attendre('premier formulaire, bouton nommé', '#etatp', ['', '', 'C#' + n, 'M#' + n, '', '', '', 'G#' + n, 'S#' + n, 'V#' + n, 'R#' + n])
          vaut('premier formulaire, bouton nommé : enfant désactivé', await etat('#etatch', 'mjs-pg'), [''])

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
