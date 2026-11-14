// Une <@view> sous un {if} : le premier affichage attend la vue. Quand elle paraît, le routeur y montre la page de
// l'adresse en cours ; un {if} qui la cache ne casse rien et garde la route en cours ; quand elle revient, la page en
// cours revient avec elle, sans second montage. Cas couverts : condition vraie au chargement, fausse puis vraie, vue
// dans le {else}, vue cachée puis remontrée, navigation avant et arrière pendant que la vue est cachée, vue glissée
// dans le <slot> d'un composant de mise en page qui porte les routes, deux vues dont une seule sous un {if}. Aucune
// erreur ni aucun avertissement en console, en développement comme en production : une vue que cache un bloc n'est pas
// une faute, ni à la construction ni au chargement.
// Chromium, Firefox et WebKit réels, construction de développement et de production.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { ENGINES, parseEngines } from './helpers/engine-filter.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

type Env = 'dev' | 'prod'
interface Message { type: string, texte: string }

const ROUTES  = '<routes target="root">\n  /     page-a\n  /b    page-b\n</routes>\n\n'
const BOUTONS = '<button class="on" @click={$ok = true}>on</button>\n<button class="off" @click={$ok = false}>off</button>\n'
const etat    = (ok: boolean) => `<script>\n$ok = ${ok}\n</script>\n`
const SOURCES: Record<string, string> = {
  'page-a.mjs':         '<script>\n$n = 0\nµmount ->\n  window.__montages = (window.__montages || 0) + 1\n</script>\n<p class="a">A{$n}</p>\n<button class="plus" @click={$n = $n + 1}>+</button>\n',
  'page-b.mjs':         '<p class="b">B</p>\n',
  'side-a.mjs':         '<p class="sa">SA</p>\n',
  'side-b.mjs':         '<p class="sb">SB</p>\n',
  'vue-vrai.page.mjs':  ROUTES + etat(true) + BOUTONS + '{if $ok}\n  <@view root>\n{end}\n',
  'vue-faux.page.mjs':  ROUTES + etat(false) + BOUTONS + '{if $ok}\n  <@view root>\n{end}\n',
  'vue-sinon.page.mjs': ROUTES + etat(false) + BOUTONS + '{if $ok}\n  <p class="x">x</p>\n{else}\n  <@view root>\n{end}\n',
  'deux.page.mjs':      ROUTES + '<routes target="side">\n  /     side-a\n  /b    side-b\n</routes>\n\n' + etat(false) + BOUTONS + '{if $ok}\n  <@view root>\n{end}\n<@view side>\n',
  'attente.page.mjs':   ROUTES + etat(false) + BOUTONS + '{if $ok}\n  <@view root>\n    <p class="att">attente</p>\n  </@view>\n{end}\n',
  'contenu.page.mjs':   ROUTES + etat(true) + BOUTONS + '<@view root>\n  <p class="att">attente</p>\n</@view>\n',
  'cadre.page.mjs':     ROUTES + '<div class="cadre"><slot></slot></div>\n',
  'parent.mjs':         etat(true) + BOUTONS + '<mjs-cadre>\n  {if $ok}\n    <@view root>\n  {end}\n</mjs-cadre>\n',
  'parent-faux.mjs':    etat(false) + BOUTONS + '<mjs-cadre>\n  {if $ok}\n    <@view root>\n  {end}\n</mjs-cadre>\n',
}

// cherche à travers les shadow roots ; posé avant le bundle
const SONDE = [
  'window.__chercher = function(r, sel) { var x = r.querySelector(sel), i, e, s, y; if (x) return x; var all = r.querySelectorAll("*"); for (i = 0; i < all.length; i++) { e = all[i]; s = e._shadow || e.shadowRoot; y = s && window.__chercher(s, sel); if (y) return y; } return null; };',
  'window.__trouve = function(sel) { return !!window.__chercher(document, sel); };',
  'window.__texte = function(sel) { var x = window.__chercher(document, sel); return x ? x.textContent : ""; };',
  'window.__clic = function(sel) { var x = window.__chercher(document, sel); if (x) x.click(); return !!x; };',
].join('\n')

const constructions = new Map<Env, Promise<Map<string, Buffer>>>()

function construire(env: Env): Promise<Map<string, Buffer>> {
  let p = constructions.get(env)
  if (!p) {
    p = (async () => {
      const root = mjsTmp(`routeur-vue-sous-un-if-${env}`)
      const src  = join(root, 'src')
      const out  = join(root, 'out')
      mkdirSync(src, { recursive: true })
      for (const [f, c] of Object.entries(SOURCES)) writeFileSync(join(src, f), c)
      const bundler = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), js: 'split', env } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      assert.deepEqual(stats.errors.map((e: any) => String(e.message ?? e)), [], 'aucune erreur de construction')
      assert.deepEqual(stats.warnings.filter((w: string) => w.includes('<@view')), [], 'aucun avertissement de vue')
      const fichiers = new Map<string, Buffer>()
      for (const f of readdirSync(out, { recursive: true }).map(String)) if (/\.(js|json)$/.test(f)) fichiers.set(f, readFileSync(join(out, f)))
      return fichiers
    })()
    constructions.set(env, p)
  }
  return p
}

async function navigateurPresent(nom: string): Promise<boolean> {
  try {
    const playwright: any = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  }
  catch {
    return false
  }
}

const choisis = parseEngines(process.env.MJS_MOTEURS)

describe('routeur : une <@view> sous un {if} — dans de vrais navigateurs', function () {
  for (const nom of ENGINES) {
    if (choisis && !choisis.has(nom)) continue
    for (const env of ['dev', 'prod'] as const) {
      describe(`vue sous un {if} — ${nom}, ${env}`, function () {
        this.timeout(120000)
        let browser: any = null
        let fichiers: Map<string, Buffer>

        before(async function () {
          if (!await navigateurPresent(nom)) { console.log(`  ℹ️  ${nom} non installé : test sauté. Activer : \`npx playwright install ${nom}\``); this.skip() }
          fichiers = await construire(env)
          browser  = await (await import('playwright') as any)[nom].launch()
        })

        after(async function () {
          if (browser) await browser.close()
        })

        // ouvre la page qui porte `<mjs-tag>`, adresse `#/`, et attend ses boutons
        async function ouvrir(tag: string) {
          const page = await browser.newPage()
          const messages: Message[] = []
          const exceptions: string[] = []
          page.on('console', (m: any) => { const t = m.type(); if ((t === 'error' || t === 'warning') && m.text().includes('[Router]')) messages.push({ type: t, texte: m.text() }) })
          page.on('pageerror', (e: any) => exceptions.push(String(e.message)))
          await page.addInitScript({ content: SONDE })
          await page.route('http://localhost/**', async (route: any) => {
            const u = new URL(route.request().url())
            if (u.pathname.startsWith('/out/')) {
              const f = fichiers.get(u.pathname.slice(5))
              await route.fulfill(f ? { status: 200, contentType: u.pathname.endsWith('.json') ? 'application/json' : 'text/javascript', body: f } : { status: 404, body: '' })
              return
            }
            await route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-${tag}></mjs-${tag}><script type="module" src="/out/bundle.js"></script></body></html>` })
          })
          await page.goto(`http://localhost/?t=${tag}#/`, { waitUntil: 'load' })
          const attendre = async (expr: string, ms = 2500): Promise<boolean> => {
            try { await page.waitForFunction(expr, null, { timeout: ms }); return true }
            catch { return false }
          }
          const clic = async (sel: string) => { assert.equal(await page.evaluate(`__clic(${JSON.stringify(sel)})`), true, `bouton ${sel}`) }
          assert.ok(await attendre("__trouve('.on')", 8000), 'le composant routé a monté')
          return { page, messages, exceptions, attendre, clic }
        }

        it('condition vraie au chargement : la page de la route paraît dans la vue, sans message', async () => {
          const o = await ouvrir('vue-vrai')
          try {
            assert.ok(await o.attendre("__texte('.a') === 'A0'"), 'AVANT : « <@view root> introuvable dans le DOM », vue vide au premier affichage')
            await o.page.waitForTimeout(400)
            assert.deepEqual(o.messages, [])
            assert.deepEqual(o.exceptions, [])
          }
          finally { await o.page.close() }
        })

        it('condition fausse au chargement, puis vraie : la page paraît avec la vue', async () => {
          const o = await ouvrir('vue-faux')
          try {
            await o.page.waitForTimeout(500)
            assert.equal(await o.page.evaluate("__trouve('metamjs-view')"), false)
            assert.deepEqual(o.messages, [])
            await o.clic('.on')
            assert.ok(await o.attendre("__texte('.a') === 'A0'"), 'la vue paraît avec la page de la route')
            assert.deepEqual(o.messages, [])
            assert.deepEqual(o.exceptions, [])
          }
          finally { await o.page.close() }
        })

        it('vue dans le {else} : la page paraît au chargement, la vue cachée puis rendue la ramène', async () => {
          const o = await ouvrir('vue-sinon')
          try {
            assert.ok(await o.attendre("__texte('.a') === 'A0'"), 'page de la route au premier affichage')
            await o.clic('.on')
            assert.ok(await o.attendre("!__trouve('metamjs-view') && __trouve('.x')"), 'vue cachée')
            await o.clic('.off')
            assert.ok(await o.attendre("__texte('.a') === 'A0'"), 'la vue revient avec la page')
            assert.deepEqual(o.messages, [])
            assert.deepEqual(o.exceptions, [])
          }
          finally { await o.page.close() }
        })

        it('vue cachée puis remontrée : la même page revient, avec son état, sans second montage', async () => {
          const o = await ouvrir('vue-vrai')
          try {
            assert.ok(await o.attendre("__texte('.a') === 'A0'"), 'page de la route au premier affichage')
            await o.clic('.plus')
            await o.clic('.plus')
            assert.ok(await o.attendre("__texte('.a') === 'A2'"))
            await o.clic('.off')
            assert.ok(await o.attendre("!__trouve('metamjs-view')"), 'vue cachée')
            await o.page.waitForTimeout(400)
            await o.clic('.on')
            assert.ok(await o.attendre("__texte('.a') === 'A2'"), 'la page revient avec son état')
            await o.clic('.plus')
            assert.ok(await o.attendre("__texte('.a') === 'A3'"), 'la page revenue réagit')
            assert.equal(await o.page.evaluate('window.__montages'), 1, 'un seul montage')
            assert.deepEqual(o.messages, [])
            assert.deepEqual(o.exceptions, [])
          }
          finally { await o.page.close() }
        })

        it('navigation avant et arrière pendant que la vue est cachée : la vue rendue montre la page de l\'adresse en cours', async () => {
          const o = await ouvrir('vue-vrai')
          try {
            assert.ok(await o.attendre("__texte('.a') === 'A0'"), 'page de la route au premier affichage')
            await o.clic('.plus')
            assert.ok(await o.attendre("__texte('.a') === 'A1'"))
            await o.clic('.off')
            assert.ok(await o.attendre("!__trouve('metamjs-view')"), 'vue cachée')
            await o.page.evaluate("location.hash = '#/b'")
            assert.ok(await o.attendre("location.hash === '#/b'"))
            await o.page.waitForTimeout(300)
            await o.clic('.on')
            assert.ok(await o.attendre("__trouve('.b') && !__trouve('.a')"), 'page de /b')
            await o.clic('.off')
            assert.ok(await o.attendre("!__trouve('metamjs-view')"), 'vue cachée')
            await o.page.evaluate('history.back()')
            assert.ok(await o.attendre("location.hash === '#/'"), 'retour arrière')
            await o.page.waitForTimeout(300)
            await o.clic('.on')
            assert.ok(await o.attendre("__texte('.a') === 'A1' && !__trouve('.b')"), 'page de / gardée, avec son état')
            assert.equal(await o.page.evaluate('window.__montages'), 1, 'un seul montage')
            assert.deepEqual(o.messages, [])
            assert.deepEqual(o.exceptions, [])
          }
          finally { await o.page.close() }
        })

        it('composant de mise en page : la vue glissée dans son <slot> sous un {if}, vrai puis faux au chargement', async () => {
          for (const tag of ['parent', 'parent-faux']) {
            const o = await ouvrir(tag)
            try {
              if (tag === 'parent') {
                assert.ok(await o.attendre("__texte('.a') === 'A0'"), `${tag} : page de la route au premier affichage`)
                await o.page.waitForTimeout(400)
                assert.deepEqual(o.messages, [])
              }
              else {
                await o.page.waitForTimeout(500)
                assert.equal(await o.page.evaluate("__trouve('metamjs-view')"), false)
                assert.deepEqual(o.messages, [])
                await o.clic('.on')
                assert.ok(await o.attendre("__texte('.a') === 'A0'"), `${tag} : la vue paraît avec la page de la route`)
              }
              await o.clic('.off')
              assert.ok(await o.attendre("!__trouve('metamjs-view')"), `${tag} : vue cachée`)
              await o.page.evaluate("location.hash = '#/b'")
              assert.ok(await o.attendre("location.hash === '#/b'"))
              await o.page.waitForTimeout(300)
              await o.clic('.on')
              assert.ok(await o.attendre("__trouve('.b') && !__trouve('.a')"), `${tag} : page de /b`)
              assert.deepEqual(o.messages, [])
              assert.deepEqual(o.exceptions, [])
            }
            finally { await o.page.close() }
          }
        })

        it('vue avec contenu, sous un {if} et hors de tout bloc : le contenu attend, la page de la route le remplace', async () => {
          const o = await ouvrir('attente')
          try {
            await o.page.waitForTimeout(300)
            assert.equal(await o.page.evaluate("__trouve('metamjs-view')"), false)
            await o.clic('.on')
            assert.ok(await o.attendre("__texte('.a') === 'A0' && !__trouve('.att')"), 'AVANT : « BLOC NON FERMÉ » à la construction ; la page remplace le contenu d\'attente')
            assert.deepEqual(o.messages, [])
            assert.deepEqual(o.exceptions, [])
          }
          finally { await o.page.close() }
          const p = await ouvrir('contenu')
          try {
            assert.ok(await p.attendre("__texte('.a') === 'A0' && !__trouve('.att')"), 'AVANT : « BALISE FERMANTE ORPHELINE » ; hors de tout bloc, la page dès le premier affichage')
            assert.deepEqual(p.messages, [])
            assert.deepEqual(p.exceptions, [])
          }
          finally { await p.page.close() }
        })

        it('deux vues, l\'une sous un {if} : l\'autre est servie dès le chargement, la première quand elle paraît', async () => {
          const o = await ouvrir('deux')
          try {
            assert.ok(await o.attendre("__trouve('.sa')"), 'la vue hors du {if} est servie')
            await o.page.waitForTimeout(500)
            assert.equal(await o.page.evaluate("__trouve('.a')"), false)
            assert.deepEqual(o.messages, [])
            await o.clic('.on')
            assert.ok(await o.attendre("__texte('.a') === 'A0' && __trouve('.sa')"), 'les deux vues servies')
            await o.page.evaluate("location.hash = '#/b'")
            assert.ok(await o.attendre("__trouve('.b') && __trouve('.sb') && !__trouve('.a') && !__trouve('.sa')"), 'les deux vues suivent la navigation')
            assert.deepEqual(o.messages, [])
            assert.deepEqual(o.exceptions, [])
          }
          finally { await o.page.close() }
        })
      })
    }
  }

  after(async function () {
    constructions.clear()
    await terminateSharedWorkerPool()
  })
})
