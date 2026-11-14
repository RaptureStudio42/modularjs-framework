// Le bouclier du cœur face aux composants que le rendu crée lui-même, après le chargement : les lignes d'une liste, chacune avec son
// composant enfant. Vrais navigateurs (Chromium, Firefox, WebKit), vrai build servi par HTTP, en développement et en production, en
// fichier unique (`"js": "bundle"`), sous une racine légère (`mjs-light`) et sous une racine à ombre.
//
// Un composant cloné d'un gabarit n'a jamais été dans la page avant sa définition : il est mis à niveau à son insertion, avant tout
// calcul de style, rien n'a pu le styler caché ni lancer de transition sur lui. Il ne porte donc jamais `mjs-appearing` (réservé à la
// balise déjà dans la page quand sa définition arrive) ; le poser puis le retirer coûtait, pour mille lignes, mille écritures
// d'attribut, autant de relevés du guetteur d'attributs et une lecture de style de plus.
//
// Sa sortie du bouclier cherche un ancêtre encore caché dans l'arbre aplati. Une racine légère n'a pas d'ombre (`_shadow` est la
// balise elle-même) : ce qu'elle contient est son propre arbre, aucun `<slot>` n'y redistribue rien, et la remontée passe par elle
// sans fouiller son contenu — fouillé une fois par composant, il rendait la création de mille lignes quadratique.

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'

type Navigateur = 'chromium' | 'firefox' | 'webkit'
type Env = 'dev' | 'prod'
interface Construction { base: string, server: Server }

const LIGNES = 300

async function navigateurPresent(nom: Navigateur): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  }
  catch {
    return false
  }
}

const constructions = new Map<string, Promise<Construction>>()

async function bati(env: Env): Promise<Construction> {
  const root   = mjsTmp(`bouclier-composants-neufs-${env}`)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'liste.mjs'), [
    '<script lang="js">',
    '  function lignes(k) {',
    '    const a = new Array(k);',
    '    for (let i = 0; i < k; i++) a[i] = { id: i + 1, n: i };',
    '    return a;',
    '  }',
    '  $rows = [];',
    `  @creer = function() { $rows = lignes(${LIGNES}); };`,
    '</script>',
    '<button id="creer" @click={@creer()}>créer</button>',
    '<div class="liste">{for r in $rows by id}<div class="r"><@c-item n=!{r.n} lib={r.id}></@c-item></div>{end}</div>',
    '',
  ].join('\n'))
  writeFileSync(join(srcDir, 'c-item.mjs'), ['<p class="vu">{$lib}:{$n}</p>', ''].join('\n'))
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', urlPrefix: '/out', js: 'bundle', defaultScriptLang: 'js' }, null, 2))
  const found   = findConfig(root)!
  const bundler = new Bundler({ ...resolveBundlerOpts(found.config, found.configDir), env } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const tete  = '<meta charset="utf-8"><script type="module" src="/out/bundle.js"></script>'
  const pages: Record<string, string> = {
    '/legere': `<!doctype html><html><head>${tete}</head><body><mjs-liste mjs-light></mjs-liste></body></html>`,
    '/ombre': `<!doctype html><html><head>${tete}</head><body><mjs-liste></mjs-liste></body></html>`,
  }
  const server = createServer((req, res) => {
    const chemin = decodeURIComponent((req.url ?? '/').split('?')[0])
    if (pages[chemin]) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(pages[chemin])
      return
    }
    const fichier = join(root, normalize(chemin))
    if (!fichier.startsWith(outDir) || !existsSync(fichier) || !statSync(fichier).isFile()) { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'content-type': extname(fichier) === '.js' ? 'text/javascript; charset=utf-8' : 'application/json' })
    res.end(readFileSync(fichier))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  return { base: `http://127.0.0.1:${(server.address() as any).port}`, server }
}

function construction(env: Env): Promise<Construction> {
  if (!constructions.has(env)) constructions.set(env, bati(env))
  return constructions.get(env)!
}

// après le chargement et une tâche : les `mjs-appearing` posés sur les composants des lignes (guetteur dans la racine), et les
// recherches de `<slot>` faites dans la racine, le temps de créer les lignes, jusqu'à ce que chacune soit sortie du bouclier
async function creer(page: any, n: number) {
  return page.evaluate(async (n: number) => {
    const racine = document.querySelector('mjs-liste') as any
    const ombre  = racine.hasAttribute('mjs-light') ? racine : null
    const r      = { marques: 0, fouilles: 0, lignes: 0, vu: '', restes: 0, tours: 0 }
    // l'ombre de la racine qui en a une est fermée : elle se lit sur `_shadow`, et le guetteur s'y pose (il ne traverse pas les ombres)
    const dedans = ombre || racine._shadow
    new MutationObserver((l) => {
      for (const m of l) if ((m.target as Element).localName === 'mjs-c-item' && (m.target as Element).hasAttribute('mjs-appearing')) r.marques++
    }).observe(dedans, { attributes: true, attributeFilter: ['mjs-appearing'], subtree: true })
    const qsa = Element.prototype.querySelectorAll
    Element.prototype.querySelectorAll = function(this: Element, s: string) {
      if (this === ombre && s === 'slot') r.fouilles++
      return qsa.call(this, s)
    } as any
    const vider = () => new Promise<void>((ok) => { const c = new MessageChannel(); c.port1.onmessage = () => ok(); c.port2.postMessage(0) })
    const items  = () => dedans.querySelectorAll('mjs-c-item')
    dedans.querySelector('#creer').click()
    const tout = () => { const l = items(); return l.length === n && Array.from(l).every((e: any) => !e.hasAttribute('mjs-loading')) }
    while (!tout() && r.tours < 4000) { await vider(); r.tours++ }
    await new Promise((ok) => setTimeout(ok, 50))
    Element.prototype.querySelectorAll = qsa
    const l = items()
    r.lignes = l.length
    const sept = l[7] as any
    r.vu     = sept ? (sept._shadow || sept).textContent.trim() : '(absent)'
    r.restes = Array.from(l).filter((e: any) => e.hasAttribute('mjs-loading') || e.hasAttribute('mjs-appearing')).length
    return r
  }, n)
}

describe('bouclier du cœur : les composants que le rendu crée après le chargement — dans de vrais navigateurs', function () {
  for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
    describe(`bouclier, composants neufs — ${nom} réel`, function () {
      this.timeout(120000)
      let browser: any = null

      before(async function () {
        if (!await navigateurPresent(nom)) { console.log(`  ℹ️  ${nom} non installé : test sauté. Activer : \`npx playwright install ${nom}\``); this.skip() }
        browser = await (await import('playwright'))[nom].launch()
      })

      after(async function () {
        if (browser) await browser.close()
      })

      for (const env of ['prod', 'dev'] as const) for (const racine of ['legere', 'ombre'] as const) {
        it(`${env}, racine ${racine === 'legere' ? 'légère (`mjs-light`)' : 'à ombre'} — ${LIGNES} lignes créées après le chargement : aucun composant ne porte \`mjs-appearing\`${racine === 'legere' ? ', et leur sortie du bouclier ne fouille pas la racine' : ''}`, async () => {
          const c       = await construction(env)
          const page    = await browser.newPage()
          const erreurs: string[] = []
          page.on('pageerror', (e: any) => erreurs.push(String(e)))
          try {
            await page.goto(c.base + '/' + racine, { waitUntil: 'load' })
            await page.waitForFunction(() => { const r: any = document.querySelector('mjs-liste'); return !!r && !!(r.hasAttribute('mjs-light') ? r : r._shadow)?.querySelector('#creer') && !r.hasAttribute('mjs-loading') }, null, { timeout: 20000, polling: 50 })
            // une tâche passée depuis l'arrivée du cœur : ce qui serait monté maintenant pourrait avoir été stylé avant
            await page.waitForTimeout(100)
            const r: any = await creer(page, LIGNES)
            console.log(`      ${nom} ${env} ${racine} — ${JSON.stringify(r)}`)
            assert.equal(r.lignes, LIGNES, 'toutes les lignes sont là')
            assert.equal(r.vu, '8:7', 'le composant de la huitième ligne affiche ses props')
            assert.equal(r.restes, 0, 'ni `mjs-loading` ni `mjs-appearing` ne reste')
            assert.equal(r.marques, 0, 'aucun composant créé par le rendu ne porte `mjs-appearing`')
            if (racine === 'legere') assert.equal(r.fouilles, 0, 'la sortie du bouclier ne cherche aucun `<slot>` dans le contenu de la racine légère')
            assert.deepEqual(erreurs, [], 'aucune erreur dans la page')
          }
          finally { await page.close() }
        })
      }
    })
  }

  after(async function () {
    for (const p of constructions.values()) {
      const k = await p
      await new Promise(resolve => k.server.close(() => resolve(null)))
    }
    constructions.clear()
    await terminateSharedWorkerPool()
  })
})
