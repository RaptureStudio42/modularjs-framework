// Le bouclier du cœur (un composant caché le temps de son arrivée, sa place gardée) dans deux cas limites de son apparition.
// Vrais navigateurs (Chromium, Firefox, WebKit), vrai build servi par HTTP, en développement et en production, en fichiers séparés
// et en fichier unique (`"js": "bundle"`).
//
// Une page qui n'affiche rien d'autre que la balise d'un composant arrivé plus tard (fichier séparé, servi en retard) : rien n'y
// est encore peint, mais la page a passé des images pendant l'attente, et la balise y a été stylée cachée. Elle reparaît avec son
// composant, sans attendre le délai de sa propre transition (`transition: opacity .3s, visibility 0s .3s`, le motif classique d'un
// fondu de sortie), avec ou sans `requestAnimationFrame`, et sans demander d'image.
//
// Un composant défini dans la même tâche que le cœur (fichier unique, avant toute image) : rien n'a pu être stylé avant son premier
// rendu, ni son contenu ni ce que la page glisse dans sa balise. Il sort du bouclier sans garder la coupure des transitions au-delà
// de ce rendu, qu'il ait un `µmount` ou qu'il reçoive le contenu de sa balise : la garder coûtait une passe de style de plus pour
// tout ce qu'il contient, sur des centaines de composants. Un composant à `µmount` ne la garde pas non plus en fichiers séparés.

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'

type Navigateur = 'chromium' | 'firefox' | 'webkit'
type Mode = 'split' | 'bundle'
type Env = 'dev' | 'prod'
interface Construction { base: string, server: Server }

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

async function bati(mode: Mode, env: Env): Promise<Construction> {
  const root   = mjsTmp(`bouclier-apparition-${mode}-${env}`)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'seul.mjs'), ['<p class="s">seul</p>', ''].join('\n'))
  writeFileSync(join(srcDir, 'monte.mjs'), ['<script>', '  µmount ->', '    @_vu = 1', '</script>', '<p class="m">monté</p>', ''].join('\n'))
  writeFileSync(join(srcDir, 'recoit.mjs'), ['<p class="r">reçoit</p>', '<slot></slot>', ''].join('\n'))
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', urlPrefix: '/out', js: mode }, null, 2))
  const found   = findConfig(root)!
  const bundler = new Bundler({ ...resolveBundlerOpts(found.config, found.configDir), env } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const tete  = '<meta charset="utf-8"><script type="module" src="/out/bundle.js"></script>'
  const fondu = '<style>mjs-seul{display:block;transition:opacity .3s,visibility 0s .3s}</style>'
  const pages: Record<string, string> = {
    '/seul': `<!doctype html><html><head>${tete}${fondu}</head><body><mjs-seul></mjs-seul></body></html>`,
    '/tache': `<!doctype html><html><head>${tete}</head><body><mjs-monte></mjs-monte><mjs-recoit><b>glissé</b></mjs-recoit></body></html>`,
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
    const envoyer = () => {
      res.writeHead(200, { 'content-type': extname(fichier) === '.js' ? 'text/javascript; charset=utf-8' : 'application/json' })
      res.end(readFileSync(fichier))
    }
    // en fichiers séparés, `seul` arrive bien après la page, qui passe des images sans rien peindre
    if (/\/seul-[^/]*\.js$/.test(chemin)) setTimeout(envoyer, 300)
    else envoyer()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  return { base: `http://127.0.0.1:${(server.address() as any).port}`, server }
}

function construction(mode: Mode, env: Env): Promise<Construction> {
  const cle = mode + '-' + env
  if (!constructions.has(cle)) constructions.set(cle, bati(mode, env))
  return constructions.get(cle)!
}

// relevé sans `requestAnimationFrame` (toutes les 8 ms) : la visibilité de la balise à chaque changement, l'instant de sa
// définition, et chaque transition lancée sur elle
const SONDE_SEUL = () => {
  const w  = window as any
  const t0 = performance.now()
  w.__tl   = []
  w.__tr   = []
  document.addEventListener('transitionrun', (e: any) => w.__tr.push(e.target.localName + ' : ' + e.propertyName), true)
  customElements.whenDefined('mjs-seul').then(() => { w.__defini = Math.round(performance.now() - t0) })
  let vu = false
  const id = setInterval(() => {
    const h = document.querySelector('mjs-seul')
    const v = !!h && h.getClientRects().length > 0 && h.checkVisibility({ visibilityProperty: true })
    if (v !== vu) {
      vu = v
      w.__tl.push([Math.round(performance.now() - t0), v])
    }
    if (performance.now() - t0 > 4000) clearInterval(id)
  }, 8)
}

// les valeurs que `mjs-loading` quitte sur chaque balise suivie, dans l'ordre (la dernière : celle du retrait)
const SONDE_TACHE = () => {
  const w = window as any
  w.__quitte = { 'mjs-monte': [], 'mjs-recoit': [] }
  new MutationObserver((l) => {
    for (const r of l) {
      const n = (r.target as Element).localName
      if (w.__quitte[n]) w.__quitte[n].push(r.oldValue)
    }
  }).observe(document, { attributes: true, attributeFilter: ['mjs-loading'], attributeOldValue: true, subtree: true })
}

// aucun rappel d'image ne vient jamais (onglet en arrière-plan) et chaque demande est comptée ; ou plus de `requestAnimationFrame`
const IMAGES: Record<string, string> = {
  'avec requestAnimationFrame': '',
  'requestAnimationFrame suspendu': 'window.__images = 0; window.requestAnimationFrame = function () { return ++window.__images }',
  'sans requestAnimationFrame': 'window.__images = 0; delete window.requestAnimationFrame; window.requestAnimationFrame = undefined',
}

describe('bouclier du cœur : apparition d\'une balise seule dans sa page, et sortie sans coupure gardée — dans de vrais navigateurs', function () {
  for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
    describe(`bouclier, apparition — ${nom} réel`, function () {
      this.timeout(120000)
      let browser: any = null

      before(async function () {
        if (!await navigateurPresent(nom)) { console.log(`  ℹ️  ${nom} non installé : test sauté. Activer : \`npx playwright install ${nom}\``); this.skip() }
        browser = await (await import('playwright'))[nom].launch()
      })

      after(async function () {
        if (browser) await browser.close()
      })

      for (const env of ['prod', 'dev'] as const) for (const mode of ['split', 'bundle'] as const) {
        for (const [images, init] of Object.entries(IMAGES)) {
          it(`${env}, "js": "${mode}", ${images} — page sans autre contenu : la balise en \`transition: opacity .3s, visibility 0s .3s\` reparaît avec son composant, sans le délai de sa transition`, async () => {
            const c      = await construction(mode, env)
            const page   = await browser.newPage()
            const erreurs: string[] = []
            page.on('pageerror', (e: any) => erreurs.push(String(e)))
            if (init) await page.addInitScript(init)
            await page.addInitScript(SONDE_SEUL)
            try {
              await page.goto(c.base + '/seul', { waitUntil: 'load' })
              await page.waitForFunction(() => (window as any).__defini !== undefined, null, { timeout: 20000, polling: 50 })
              // le retard à mesurer serait de 300 ms : on attend au-delà
              await page.waitForTimeout(600)
              const r: any = await page.evaluate(() => {
                const w: any = window
                const restes = Array.from(document.querySelectorAll('*')).filter((e) => e.hasAttribute('mjs-loading') || e.hasAttribute('mjs-appearing')).length
                return { tl: w.__tl, defini: w.__defini, tr: w.__tr, images: w.__images, restes }
              })
              console.log(`      ${nom} ${env} ${mode} ${images} — défini à ${r.defini} ms, visibilité ${JSON.stringify(r.tl)}, transitions ${JSON.stringify(r.tr)}`)
              const dernier = r.tl[r.tl.length - 1]
              assert.ok(dernier && dernier[1] === true, 'la balise finit par se voir')
              assert.ok(dernier[0] - r.defini < 200, `la balise reparaît avec son composant (vue pour de bon ${dernier[0] - r.defini} ms après sa définition)`)
              assert.ok(!r.tr.includes('mjs-seul : visibility'), 'aucune transition de visibilité ne se lance sur la balise')
              assert.equal(r.restes, 0, 'ni `mjs-loading` ni `mjs-appearing` ne reste')
              if (init) assert.equal(r.images, 0, 'aucune image n\'est demandée')
              assert.deepEqual(erreurs, [], 'aucune erreur dans la page')
            }
            finally { await page.close() }
          })
        }

        it(`${env}, "js": "${mode}" — un composant à \`µmount\`${mode === 'bundle' ? ', et un composant qui reçoit le contenu de sa balise, définis dans la même tâche que le cœur,' : ''} sort du bouclier sans garder la coupure des transitions`, async () => {
          const c    = await construction(mode, env)
          const page = await browser.newPage()
          await page.addInitScript(SONDE_TACHE)
          try {
            await page.goto(c.base + '/tache', { waitUntil: 'load' })
            await page.waitForFunction(() => !!customElements.get('mjs-monte') && !!customElements.get('mjs-recoit') && !document.querySelector('[mjs-loading]'), null, { timeout: 20000, polling: 50 })
            await page.waitForTimeout(100)
            const quitte: any = await page.evaluate(() => (window as any).__quitte)
            console.log(`      ${nom} ${env} ${mode} — valeurs quittées par mjs-loading : ${JSON.stringify(quitte)}`)
            assert.ok(quitte['mjs-monte'].length > 0, 'le composant à µmount est passé par le bouclier')
            assert.ok(!quitte['mjs-monte'].includes('out'), 'le composant à µmount ne garde pas la coupure au-delà de son premier rendu')
            if (mode === 'bundle') assert.ok(!quitte['mjs-recoit'].includes('out'), 'le composant qui reçoit le contenu de sa balise ne garde pas la coupure au-delà de son premier rendu')
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
