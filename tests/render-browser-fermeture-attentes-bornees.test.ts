// render-browser — les TROIS attentes de fermeture qui restaient non bornées dans `close()` et
// dans le rattrapage de `bootSlot()` : la promesse de navigateur mémoïsée (`browserPromise`) peut ne
// jamais se régler (sa résolution de moteur n'est PAS sous `borne`), `bundler.close()` termine le
// réservoir de travailleurs partagé (dont la terminaison peut ne jamais aboutir), et le
// `context.close()` de rattrapage d'un `bootSlot()` en échec n'était ni borné ni signalé (le contexte
// restait en vol à vie, sans le moindre message).
//
// Injections, toutes par le prototype partagé du module réellement chargé par le moteur — jamais un
// mock du module entier :
//   - résolution du moteur : `registerHooks` (résolution ESM en processus) détourne `playwright` vers
//     un module dont l'évaluation ne finit jamais, et l'instance FRAÎCHE du moteur
//     (`render-browser.ts?…`) repart donc d'un cache de résolution vierge ;
//   - `bundler.close()` : `Bundler.prototype.close`, même classe singleton que celle importée ici ;
//   - rattrapage de `bootSlot()` : `chromium.launch` remplacé (même harnais que
//     tests/render-browser-demarrage-borne.test.ts).
//
// Borne attendue = deux fois `render.browserPool.renderTimeoutMs`, réduit ici à 200 ms. La fermeture
// garde en plus un plancher de 10 s, abaissé ici (`closeFloorMs: 0`) : chaque test attend un abandon.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { registerHooks } from 'node:module'
import { chromium } from 'playwright'
import { mjsTmp } from './helpers/tmp.js'
import { createBrowserRenderer } from '../src/server/render-browser.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

function project(prefix: string): string {
  const root = mjsTmp(prefix)
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'simple.mjs'), '<p class="v">V1</p>\n')
  return root
}

const config = { sourceDir: 'src', outputDir: 'dist', render: { browserPool: { renderTimeoutMs: 200 } } } as any

// Attend l'arrivée d'un avertissement (borné) plutôt qu'un délai fixe : la borne de fermeture et
// celle du démarrage valent 400 ms ici, une marge large suffit.
async function attendreAvertissement(avertissements: string[], echeanceMs = 5000): Promise<void> {
  const echeance = Date.now() + echeanceMs
  while (avertissements.length === 0 && Date.now() < echeance) await new Promise(r => setTimeout(r, 25))
}

describe('render-browser — attentes de fermeture bornées', function () {
  this.timeout(30000)

  const lancementOrigine = chromium.launch

  afterEach(() => { (chromium as any).launch = lancementOrigine })
  after(async () => { await terminateSharedWorkerPool() })

  it('résolution du moteur qui ne se règle jamais : close() rend la main et l’abandon est signalé', async () => {
    const hooks = registerHooks({
      resolve(specifier: string, contexte: any, suivant: any)
      {
        if (specifier === 'playwright') {
          return { url: 'data:text/javascript,await new Promise(() => {})', format: 'module', shortCircuit: true }
        }
        return suivant(specifier, contexte)
      }
    })
    const avertissements = []
    const origineWarn     = console.warn
    try {
      // instance FRAÎCHE : son cache de résolution de moteur (`cachedPlaywright`) est vierge, la
      // résolution détournée ci-dessus le laisse donc en vol POUR TOUJOURS — sans toucher au moteur
      // déjà résolu dans les autres tests de ce processus.
      const frais    = await import('../src/server/render-browser.ts?fermeture-attente-moteur')
      const renderer = await frais.createBrowserRenderer(config, { configDir: project('attente-moteur'), closeFloorMs: 0 })

      console.warn = (msg?: any) => { avertissements.push(String(msg)) }
      const rendu  = renderer.renderPage('mjs-simple', {}).catch((e: any) => e)
      await new Promise(r => setTimeout(r, 50))

      const debut   = Date.now()
      const verdict = await Promise.race([renderer.close().then(() => 'fermé'), new Promise(r => setTimeout(() => r('bloqué'), 5000))])
      assert.equal(verdict, 'fermé', 'close() ne doit jamais rester bloqué par une résolution de moteur qui ne se règle pas')
      assert.ok(Date.now() - debut < 5000, `close() doit rendre la main à sa borne, mesuré ${Date.now() - debut}ms`)
      await rendu

      await attendreAvertissement(avertissements)
      assert.ok(avertissements.length >= 1, 'une attente de navigateur abandonnée doit être signalée (console.warn), jamais silencieuse')
      assert.match(avertissements[0], /\[mjs-ssr-browser\].*abandonn/, 'le signalement doit dire l’abandon ET nommer l’attente')
      assert.match(avertissements[0], /navigateur|browser/)
    } finally {
      console.warn = origineWarn
      hooks.deregister()
    }
  })

  it('un navigateur qui n’arrive qu’APRÈS l’abandon de close() est refermé quand même (aucun Chromium orphelin)', async () => {
    delete (globalThis as any).__navigateurTardifFerme
    // moteur factice qui ne se résout qu'APRÈS la borne de fermeture (400 ms) : son lancement
    // aboutit vers 1,5 s, quand `close()` a déjà abandonné son attente.
    const moteurTardif = 'data:text/javascript,' + encodeURIComponent(
      'await new Promise(r => setTimeout(r, 1500))\n' +
      'export const chromium = {\n' +
      '  launch: async () => ({\n' +
      '    close: async () => { globalThis.__navigateurTardifFerme = true },\n' +
      '    newContext: async () => { throw new Error(\'jamais utilisé\') },\n' +
      '  }),\n' +
      '}\n')
    const hooks = registerHooks({
      resolve(specifier: string, contexte: any, suivant: any)
      {
        if (specifier === 'playwright') return { url: moteurTardif, format: 'module', shortCircuit: true }
        return suivant(specifier, contexte)
      }
    })
    const avertissements = []
    const origineWarn     = console.warn
    try {
      const frais    = await import('../src/server/render-browser.ts?fermeture-navigateur-tardif')
      const renderer = await frais.createBrowserRenderer(config, { configDir: project('navigateur-tardif'), closeFloorMs: 0 })

      console.warn = (msg?: any) => { avertissements.push(String(msg)) }
      await assert.rejects(renderer.renderPage('mjs-simple', {}), /démarr/)
      const verdict = await Promise.race([renderer.close().then(() => 'fermé'), new Promise(r => setTimeout(() => r('bloqué'), 5000))])
      assert.equal(verdict, 'fermé', 'close() rend la main à sa borne, sans attendre un moteur qui arrive trop tard')
      assert.ok(avertissements.some(m => /abandonn/.test(m)),
        'l’attente abandonnée à la borne doit être signalée AVANT que le moteur n’arrive (pas à son arrivée)')

      const echeance = Date.now() + 5000
      while (!(globalThis as any).__navigateurTardifFerme && Date.now() < echeance) await new Promise(r => setTimeout(r, 25))
      assert.equal((globalThis as any).__navigateurTardifFerme, true, 'le navigateur arrivé après l’abandon doit être refermé, jamais laissé vivant')
    } finally {
      console.warn = origineWarn
      hooks.deregister()
      delete (globalThis as any).__navigateurTardifFerme
    }
  })

  it('bundler.close() qui ne se règle jamais : close() rend la main et l’abandon est signalé', async () => {
    const renderer = await createBrowserRenderer(config, { configDir: project('fermeture-bundler'), closeFloorMs: 0 })

    const origineClose = Bundler.prototype.close
    let fermetureDemandee = false
    Bundler.prototype.close = function () { fermetureDemandee = true; return new Promise(() => { /* jamais réglée */ }) }
    const avertissements = []
    const origineWarn     = console.warn
    try {
      console.warn = (msg?: any) => { avertissements.push(String(msg)) }

      const debut   = Date.now()
      const verdict = await Promise.race([renderer.close().then(() => 'fermé'), new Promise(r => setTimeout(() => r('bloqué'), 5000))])
      assert.equal(verdict, 'fermé', 'close() ne doit jamais rester bloqué par un bundler dont la fermeture ne se règle pas')
      assert.ok(Date.now() - debut < 5000, `close() doit rendre la main à sa borne, mesuré ${Date.now() - debut}ms`)
      assert.equal(fermetureDemandee, true, 'la fermeture du bundler doit quand même être demandée')

      assert.ok(avertissements.length >= 1, 'une fermeture de bundler abandonnée doit être signalée (console.warn), jamais silencieuse')
      assert.match(avertissements[0], /\[mjs-ssr-browser\].*abandonn/)
      assert.match(avertissements[0], /bundler/)
    } finally {
      console.warn = origineWarn
      Bundler.prototype.close = origineClose
    }
  })

  it('contexte dont la fermeture de rattrapage (catch de bootSlot) ne se règle jamais : l’abandon est signalé', async () => {
    let fermetureDemandee = false
    const contexteMuet    = {
      // échoue APRÈS `newContext()` : le catch de `bootSlot()` prend la main et tente de refermer
      addInitScript: async () => { throw new Error('addInitScript factice') },
      close: () => { fermetureDemandee = true; return new Promise(() => { /* jamais réglée */ }) },
      route: async () => { /* no-op */ },
      newPage: async () => { throw new Error('jamais atteint') },
      on: () => { /* no-op */ },
    }
    ;(chromium as any).launch = async () => ({ newContext: async () => contexteMuet, close: async () => { /* no-op */ } })
    const renderer = await createBrowserRenderer(config, { configDir: project('fermeture-rattrapage'), closeFloorMs: 0 })

    const avertissements = []
    const origineWarn     = console.warn
    try {
      console.warn = (msg?: any) => { avertissements.push(String(msg)) }
      // le démarrage est borné (cf. tests/render-browser-demarrage-borne.test.ts) : le rendu échoue
      // à la borne de DÉMARRAGE, mais la fermeture de rattrapage restait, elle, sans borne ni signal
      await assert.rejects(renderer.renderPage('mjs-simple', {}), /démarr/)
      assert.equal(fermetureDemandee, true, 'le contexte dont une étape a échoué doit être refermé (close demandé)')

      await attendreAvertissement(avertissements)
      assert.ok(avertissements.length >= 1, 'une fermeture de contexte abandonnée doit être signalée (console.warn), jamais silencieuse')
      assert.match(avertissements[0], /\[mjs-ssr-browser\].*contexte/)
    } finally {
      console.warn = origineWarn
      await renderer.close().catch(() => { /* best-effort */ })
    }
  })
})
