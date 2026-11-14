// rendu serveur (ssr:markers, ssr:positional) ou prérendu d'une page routée, puis reprise dans de vrais navigateurs : une
// vue ordinaire, une vue sous un {if} vrai, et `{if $user}<@view root>{else}<@login-form>{end}` faux puis vrai au
// chargement ; développement et production. Aucune exception, aucun message en console, aucune page en double, un seul
// montage ; la page que le serveur a écrite dans la vue est reprise telle quelle par le rendu serveur (le prérendu rebâtit
// la vue de la page) ; la vue cachée puis la connexion suivent comme sans rendu serveur

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './tmp.js'
import { ENGINES, parseEngines } from './engine-filter.js'
import { Bundler, terminateSharedWorkerPool } from '../../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../../src/bundler/config.js'
import { createRenderHandler } from '../../src/server/render-request.js'
import { prerenderPages } from '../../src/server/prerender.js'

type Env = 'dev' | 'prod'
interface Fait { pages: Record<string, string>, sortie: string }

const R = '<routes target="root">\n  /     page-a\n  /b    page-b\n</routes>\n\n'
const SOURCES: Record<string, string> = {
  'page-a.mjs':       '<script>\n$n = 0\nµmount ->\n  window.__montages = (window.__montages || 0) + 1\n</script>\n<p class="a">A{$n}</p>\n<button class="plus" @click={$n = $n + 1}>+</button>\n',
  'page-b.mjs':       '<p class="b">B</p>\n',
  'login-form.mjs':   '<div class="lf">connexion</div>\n',
  'temoin.page.mjs':  R + '<p class="t">t</p>\n<@view root>\n',
  'vrai.page.mjs':    R + '<script>\n$ok = true\n</script>\n<button class="off" @click={$ok = false}>off</button>\n{if $ok}\n  <@view root>\n{end}\n',
  'matrix.page.mjs':  R + '<script>\n$user = false\n</script>\n<button class="on" @click={$user = true}>on</button>\n{if $user}<@view root>{else}<@login-form>{end}\n',
  'matrixv.page.mjs': R + '<script>\n$user = true\n</script>\n<button class="off" @click={$user = false}>off</button>\n{if $user}<@view root>{else}<@login-form>{end}\n',
}
const PAGES: Record<string, string> = { '/temoin': 'mjs-temoin', '/vrai': 'mjs-vrai', '/matrix': 'mjs-matrix', '/matrixv': 'mjs-matrixv' }

// cherche et compte à travers les shadow roots ; `__garde` : le nœud est-il celui que le serveur a écrit (marqué avant le bundle)
const SONDE = [
  'window.__chercher = function(r, sel) { var x = r.querySelector(sel), i, e, s, y; if (x) return x; var all = r.querySelectorAll("*"); for (i = 0; i < all.length; i++) { e = all[i]; s = e._shadow || e.shadowRoot; y = s && window.__chercher(s, sel); if (y) return y; } return null; };',
  'window.__compte = function(r, sel) { var n = r.querySelectorAll(sel).length, all = r.querySelectorAll("*"), i, s; for (i = 0; i < all.length; i++) { s = all[i]._shadow || all[i].shadowRoot; if (s) n += window.__compte(s, sel); } return n; };',
  'window.__texte = function(sel) { var x = window.__chercher(document, sel); return x ? x.textContent : ""; };',
  'window.__garde = function(sel) { var x = window.__chercher(document, sel); return x ? (x.__srv === 1 ? "garde" : "neuf") : "absent"; };',
  'window.__clic = function(sel) { var x = window.__chercher(document, sel); if (x) x.click(); return !!x; };',
].join('\n')
const TAMPON = '(() => { const t = (r) => { const w = document.createTreeWalker(r, 5); let x; while ((x = w.nextNode())) { x.__srv = 1; if (x.shadowRoot) t(x.shadowRoot) } }; t(document.body); return 1 })()'

function fichier(sortie: string, chemin: string): string | null {
  const segs = chemin.split('/').filter(Boolean)
  for (let i = 0; i < segs.length; i++) {
    const f = join(sortie, ...segs.slice(i))
    if (existsSync(f) && statSync(f).isFile()) return f
  }
  return null
}

const faits = new Map<string, Promise<Fait>>()

function construire(mode: string, env: Env): Promise<Fait> {
  const k = mode + '-' + env
  if (!faits.has(k)) faits.set(k, (async () => {
    const dir    = mjsTmp('routeur-vue-serveur-' + mode.replace(':', '-') + '-' + env)
    const CONFIG: any = { sourceDir: 'src', outputDir: 'public/mjs', js: 'split', render: { default: mode, routes: Object.fromEntries(Object.entries(PAGES).map(([r, c]) => [r, { component: c }])) } }
    if (mode === 'prerender') CONFIG.render.engine = { prerender: 'happy-dom' }
    mkdirSync(join(dir, 'src'), { recursive: true })
    for (const [n, s] of Object.entries(SOURCES)) writeFileSync(join(dir, 'src', n), s)
    writeFileSync(join(dir, 'mjs.config.json'), JSON.stringify(CONFIG))
    const found = findConfig(dir)!
    const b     = new Bundler({ ...resolveBundlerOpts(found.config, found.configDir), env } as any)
    const st    = await b.compile()
    await b.close()
    assert.deepEqual(st.errors.map((e: any) => String(e.message ?? e)), [], 'aucune erreur de construction')
    assert.deepEqual(st.warnings.filter((w: string) => w.includes('<@view')), [], 'aucun avertissement de vue')
    if (mode === 'prerender') {
      const rapport = await prerenderPages(found.config, found.configDir, () => {}, { env })
      assert.equal(rapport.generated.length, Object.keys(PAGES).length, JSON.stringify(rapport.skipped))
    }
    const h: any    = await createRenderHandler(CONFIG, dir, undefined, env)
    const pages: Record<string, string> = {}
    const script    = '<script type="module" src="/mjs/bundle.js"></script>'
    for (const r of Object.keys(PAGES)) {
      const body = String(((await h.handle(r, {})) as any).body || '')
      pages[r] = body.includes('<html') ? (body.includes('bundle.js') ? body : body.replace('</body>', script + '</body>')) : `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${body}\n${script}</body></html>`
    }
    if (typeof h.close === 'function') await h.close()
    return { pages, sortie: join(dir, 'public/mjs') }
  })())
  return faits.get(k)!
}

export function decrireRepriseServeur(titre: string, modes: string[]): void {
  const choisis = parseEngines(process.env.MJS_MOTEURS)
  describe(titre, function () {
    for (const nom of ENGINES) {
      if (choisis && !choisis.has(nom)) continue
      for (const mode of modes) {
        for (const env of ['dev', 'prod'] as const) {
          describe(`${nom}, ${mode}, ${env}`, function () {
            this.timeout(60000)
            let browser: any = null

            before(async function () {
              await construire(mode, env)
              browser = await (await import('playwright') as any)[nom].launch()
            })

            after(async function () {
              if (browser) await browser.close()
            })

            for (const chemin of Object.keys(PAGES)) {
              it(chemin, async () => {
                const fait = await construire(mode, env)
                const page = await browser.newPage()
                const messages: string[] = []
                const exceptions: string[] = []
                page.on('console', (m: any) => { const t = m.type(); if (t === 'error' || t === 'warning') messages.push(t + ' : ' + m.text().slice(0, 300)) })
                page.on('pageerror', (e: any) => exceptions.push(String(e.message).slice(0, 300)))
                let lacher: () => void = () => {}
                const retenu = new Promise<void>((r) => { lacher = r })
                await page.addInitScript({ content: SONDE })
                // le bundle attend que la page du serveur soit marquée
                await page.route('http://ssr.test/**', async (route: any) => {
                  const url = new URL(route.request().url())
                  if (url.pathname === chemin) return route.fulfill({ status: 200, contentType: 'text/html', body: fait.pages[chemin] })
                  const f = fichier(fait.sortie, url.pathname)
                  if (!f) return route.fulfill({ status: 404, body: '' })
                  if (url.pathname.endsWith('/bundle.js')) await retenu
                  return route.fulfill({ status: 200, contentType: f.endsWith('.json') ? 'application/json' : f.endsWith('.css') ? 'text/css' : 'text/javascript', body: readFileSync(f) })
                })
                const attendre = async (expr: string, ms = 4000): Promise<boolean> => {
                  try { await page.waitForFunction(expr, null, { timeout: ms }); return true }
                  catch { return false }
                }
                const compte = (sel: string) => page.evaluate(`__compte(document, ${JSON.stringify(sel)})`)
                try {
                  const html      = fait.pages[chemin]
                  const vueServie = chemin !== '/matrix'
                  assert.equal(/class="a"/.test(html), vueServie, 'la page de la route dans le HTML du serveur')
                  assert.equal(/class="lf"/.test(html), !vueServie, 'le formulaire dans le HTML du serveur')
                  await page.goto('http://ssr.test' + chemin, { waitUntil: 'commit' })
                  await page.waitForFunction(() => document.readyState !== 'loading', null, { timeout: 15000 })
                  await page.evaluate(TAMPON)
                  lacher()
                  if (vueServie) {
                    assert.ok(await attendre('(window.__montages || 0) >= 1'), 'la page de la route a monté')
                    await page.waitForTimeout(400)
                    assert.equal(await compte('.a'), 1, 'une seule page')
                    assert.equal(await compte('metamjs-view'), 1, 'une seule vue')
                    if (mode !== 'prerender') assert.equal(await page.evaluate('__garde(".a")'), 'garde', 'la page du serveur est reprise telle quelle')
                    assert.equal(await page.evaluate('window.__montages'), 1, 'un seul montage')
                    assert.equal(await page.evaluate('__clic(".plus")'), true)
                    assert.ok(await attendre("__texte('.a') === 'A1'"), 'la page reprise réagit')
                    // vue ordinaire : la page du serveur, partie à la navigation, revient avec son état, sans second montage
                    if (chemin === '/temoin') {
                      await page.evaluate("location.hash = '#/b'")
                      assert.ok(await attendre("__compte(document, '.b') === 1 && __compte(document, '.a') === 0"), 'la page de /b')
                      await page.evaluate("location.hash = '#/'")
                      assert.ok(await attendre("__texte('.a') === 'A1' && __compte(document, '.b') === 0"), 'AVANT : page neuve, état perdu ; le retour rend la page avec son état')
                      if (mode !== 'prerender') assert.equal(await page.evaluate('__garde(".a")'), 'garde', 'la page du serveur, pas une neuve')
                      assert.equal(await page.evaluate('window.__montages'), 1, 'un seul montage')
                    }
                  }
                  else {
                    assert.ok(await attendre("__compte(document, '.lf') === 1 && __compte(document, '.on') === 1"), 'le formulaire')
                    await page.waitForTimeout(400)
                    assert.equal(await compte('.a'), 0)
                    assert.equal(await page.evaluate('__clic(".on")'), true)
                    assert.ok(await attendre("__texte('.a') === 'A0' && __compte(document, '.a') === 1 && __compte(document, '.lf') === 0"), 'connexion : la page de la route paraît')
                  }
                  if (chemin === '/vrai' || chemin === '/matrixv') {
                    assert.equal(await page.evaluate('__clic(".off")'), true)
                    assert.ok(await attendre(`__compte(document, '.a') === 0 && __compte(document, 'metamjs-view') === 0 && __compte(document, '.lf') === ${chemin === '/matrixv' ? 1 : 0}`), 'la vue cachée')
                  }
                  assert.deepEqual(exceptions, [])
                  assert.deepEqual(messages, [])
                }
                finally { await page.close() }
              })
            }
          })
        }
      }
    }

    after(async function () {
      faits.clear()
      await terminateSharedWorkerPool()
    })
  })
}
