// render-browser — démarrage d'un emplacement BORNÉ : un Chromium qui ne répond plus (lancement ou
// ouverture de page jamais réglés) ne doit retenir ni la requête ni `close()` à vie. La fermeture
// attend les emplacements en cours de démarrage : sans borne, un lancement bloqué la figeait pour
// toujours. Un lancement qui aboutit APRÈS l'abandon est refermé aussitôt (aucun navigateur orphelin)
// et, si CETTE fermeture ne se règle pas non plus, l'abandon est signalé (console.warn) plutôt que
// tu — même famille de borne pour la fermeture d'un contexte d'emplacement DÉJÀ enregistré
// (`teardownSlot`) : sans elle, `close()` attendait un drainage qui n'arrivait jamais.
//
// `chromium.launch` remplacé le temps du test (même module Playwright que celui du moteur) ; la
// borne vaut le double de `render.browserPool.renderTimeoutMs`, réduit ici à 200 ms. La fermeture
// garde en plus un plancher de 10 s : les tests qui attendent son ABANDON l'abaissent
// (`closeFloorMs: 0`), faute de quoi chacun durerait 10 s.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { mjsTmp } from './helpers/tmp.js'
import { createBrowserRenderer } from '../src/server/render-browser.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

function project(prefix: string): string {
  const root = mjsTmp(prefix)
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'simple.mjs'), '<p class="v">V1</p>\n')
  return root
}

const config = { sourceDir: 'src', outputDir: 'dist', render: { browserPool: { renderTimeoutMs: 200 } } } as any

describe('render-browser — démarrage d’un emplacement borné', function () {
  this.timeout(30000)
  const lancementOrigine = chromium.launch

  afterEach(() => { (chromium as any).launch = lancementOrigine })
  after(async () => { await terminateSharedWorkerPool() })

  it('lancement de Chromium qui ne répond jamais : le rendu échoue avec un message clair et close() se termine', async () => {
    ;(chromium as any).launch = () => new Promise(() => { /* jamais réglée */ })
    const renderer = await createBrowserRenderer(config, { configDir: project('demarrage-jamais') })

    const debut = Date.now()
    await assert.rejects(renderer.renderPage('mjs-simple', {}), /démarr/)
    assert.ok(Date.now() - debut < 5000, `le rendu doit échouer à la borne, mesuré ${Date.now() - debut}ms`)

    const fermeture = renderer.close().then(() => 'fermé')
    const verdict   = await Promise.race([fermeture, new Promise(r => setTimeout(() => r('bloqué'), 5000))])
    assert.equal(verdict, 'fermé', 'close() ne doit jamais rester bloqué par un lancement qui ne répond pas')
  })

  it('close() appelé PENDANT un lancement bloqué : se termine quand même', async () => {
    ;(chromium as any).launch = () => new Promise(() => { /* jamais réglée */ })
    const renderer = await createBrowserRenderer(config, { configDir: project('demarrage-jamais-close') })
    const rendu = renderer.renderPage('mjs-simple', {}).catch((e: any) => e)
    await new Promise(r => setTimeout(r, 50))

    const fermeture = renderer.close().then(() => 'fermé')
    const verdict   = await Promise.race([fermeture, new Promise(r => setTimeout(() => r('bloqué'), 5000))])
    assert.equal(verdict, 'fermé')
    assert.match(String((await rendu)?.message), /démarr/)
  })

  it('navigateur lancé puis devenu muet (sa fermeture ne répond jamais) : close() se termine quand même', async () => {
    let fermetureDemandee = false
    const navigateurMuet  = {
      newContext: async () => { throw new Error('contexte impossible') },
      close: () => { fermetureDemandee = true; return new Promise(() => { /* jamais réglée */ }) },
    }
    ;(chromium as any).launch = async () => navigateurMuet
    const renderer = await createBrowserRenderer(config, { configDir: project('fermeture-muette'), closeFloorMs: 0 })
    await assert.rejects(renderer.renderPage('mjs-simple', {}), /contexte impossible/)

    const fermeture = renderer.close().then(() => 'fermé')
    const verdict   = await Promise.race([fermeture, new Promise(r => setTimeout(() => r('bloqué'), 5000))])
    assert.equal(verdict, 'fermé', 'close() ne doit jamais attendre à vie la fermeture d’un navigateur muet')
    assert.equal(fermetureDemandee, true, 'la fermeture du navigateur doit quand même être demandée')
  })

  // un seul navigateur muet = UN avertissement, qui dit la vraie cause (sa fermeture) : l'attente
  // du navigateur et sa fermeture étaient bornées l'une DANS l'autre, les deux minuteurs sonnaient,
  // et le premier message accusait à tort un lancement bloqué alors que le lancement avait réussi
  it('navigateur lancé puis devenu muet : un seul avertissement, sur la fermeture', async () => {
    const navigateurMuet = {
      newContext: async () => { throw new Error('contexte impossible') },
      close: () => new Promise(() => { /* jamais réglée */ }),
    }
    ;(chromium as any).launch = async () => navigateurMuet
    const renderer = await createBrowserRenderer(config, { configDir: project('fermeture-muette-un-avertissement'), closeFloorMs: 0 })
    await assert.rejects(renderer.renderPage('mjs-simple', {}), /contexte impossible/)
    const avertissements: string[] = []
    const origine                  = console.warn
    console.warn = (msg?: any) => { avertissements.push(String(msg)) }
    try {
      await renderer.close()
      await new Promise(r => setTimeout(r, 600))   // un second minuteur éventuel a le temps de sonner
    } finally {
      console.warn = origine
    }
    assert.equal(avertissements.length, 1, `un seul avertissement attendu, reçu :\n${avertissements.join('\n')}`)
    assert.match(avertissements[0], /fermeture du navigateur/)
  })

  it('un lancement qui aboutit après l’abandon est refermé aussitôt', async () => {
    let ferme = false
    const navigateurTardif = { close: async () => { ferme = true }, newContext: async () => { throw new Error('jamais utilisé') } }
    ;(chromium as any).launch = () => new Promise(r => setTimeout(() => r(navigateurTardif), 800))
    const renderer = await createBrowserRenderer(config, { configDir: project('demarrage-tardif') })

    await assert.rejects(renderer.renderPage('mjs-simple', {}), /démarr/)
    await new Promise(r => setTimeout(r, 1000))
    assert.equal(ferme, true, 'le navigateur lancé trop tard doit être refermé, jamais laissé vivant')
    await renderer.close()
  })

  it('un lancement qui aboutit après l’abandon et dont la fermeture ne répond jamais : l’abandon est SIGNALÉ, jamais muet', async () => {
    let fermetureDemandee = false
    const navigateurMuet  = {
      close: () => { fermetureDemandee = true; return new Promise(() => { /* jamais réglée */ }) },
      newContext: async () => { throw new Error('jamais utilisé') },
    }
    ;(chromium as any).launch = () => new Promise(r => setTimeout(() => r(navigateurMuet), 800))
    const renderer = await createBrowserRenderer(config, { configDir: project('demarrage-tardif-muet'), closeFloorMs: 0 })
    const avertissements: string[] = []
    const origine                  = console.warn
    console.warn = (msg?: any) => { avertissements.push(String(msg)) }
    try {
      // le rendu abandonne à la borne (400 ms) ; le lancement n'arrive qu'à ~800 ms, sa fermeture
      // bornée (400 ms) est donc abandonnée vers 1200 ms — on l'ATTEND plutôt qu'un délai fixe.
      await assert.rejects(renderer.renderPage('mjs-simple', {}), /démarr/)
      const echeance = Date.now() + 5000
      while (avertissements.length === 0 && Date.now() < echeance) await new Promise(r => setTimeout(r, 25))

      assert.equal(fermetureDemandee, true, 'la fermeture du navigateur tardif doit quand même être demandée')
      assert.ok(avertissements.length >= 1, 'une fermeture abandonnée doit être signalée (console.warn), jamais silencieuse')
      assert.match(avertissements[0], /\[mjs-ssr-browser\].*(abouti|abandonnée)/)
    } finally {
      await renderer.close().catch(() => { /* best-effort */ })
      console.warn = origine
    }
  })

  it('emplacement DÉJÀ enregistré (donc dans `all`) dont la fermeture de contexte ne répond jamais : close() rend la main à la borne', async () => {
    let fermetureDemandee = false
    const pageFactice     = {
      // échoue APRÈS la création de l'emplacement : celui-ci est enregistré (`all`) et remis en
      // `idle` — le cas de `teardownSlot`, que le test du navigateur muet ci-dessus n'exerçait pas
      // (son `newContext` en échec ne laissait AUCUN emplacement enregistré).
      goto: async () => { throw new Error('goto factice') },
      on: () => { /* no-op : aucun écouteur pageerror à recevoir */ },
      off: () => { /* no-op */ },
    }
    const contexteMuet = {
      addInitScript: async () => { /* no-op */ },
      route: async () => { /* no-op */ },
      newPage: async () => pageFactice,
      on: () => { /* no-op */ },
      close: () => { fermetureDemandee = true; return new Promise(() => { /* jamais réglée */ }) },
    }
    ;(chromium as any).launch = async () => ({ newContext: async () => contexteMuet, close: async () => { /* no-op */ } })
    const renderer = await createBrowserRenderer(config, { configDir: project('emplacement-deja-enregistre'), closeFloorMs: 0 })

    await assert.rejects(renderer.renderPage('mjs-simple', {}), /goto factice/)

    const fermeture = renderer.close().then(() => 'fermé')
    const verdict   = await Promise.race([fermeture, new Promise(r => setTimeout(() => r('bloqué'), 5000))])
    assert.equal(verdict, 'fermé', 'close() ne doit jamais attendre à vie la fermeture d’un contexte d’emplacement déjà enregistré')
    assert.equal(fermetureDemandee, true, 'la fermeture du contexte doit quand même être demandée')
  })

  // un rendu réglé très bas (200 ms ici) ne raccourcit plus la fermeture : elle garde un plancher
  // de 10 s. Un navigateur qui met une seconde à se refermer est attendu jusqu'au bout, sans
  // avertissement — avant, la fermeture était abandonnée à 400 ms et Chromium restait vivant.
  it('rendu réglé bas : la fermeture garde son plancher, un navigateur lent à se refermer est attendu', async () => {
    let ferme = false
    const navigateurLent = {
      newContext: async () => { throw new Error('contexte impossible') },
      close: () => new Promise<void>(r => setTimeout(() => { ferme = true; r() }, 1000)),
    }
    ;(chromium as any).launch = async () => navigateurLent
    const renderer = await createBrowserRenderer(config, { configDir: project('fermeture-plancher') })
    await assert.rejects(renderer.renderPage('mjs-simple', {}), /contexte impossible/)
    const avertissements: string[] = []
    const origine                  = console.warn
    console.warn = (msg?: any) => { avertissements.push(String(msg)) }
    try {
      await renderer.close()
    } finally {
      console.warn = origine
    }
    assert.equal(ferme, true, 'close() doit attendre la fermeture réelle du navigateur (1 s), pas l’abandonner à 400 ms')
    assert.deepEqual(avertissements, [], 'aucun abandon à signaler : la fermeture a abouti')
  })
})
