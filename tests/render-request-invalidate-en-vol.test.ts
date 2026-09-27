// render-request — `invalidate()` (mode DÉVELOPPEMENT, cf. cli.ts : appelée après chaque
// recompilation réussie du watcher) ne doit JAMAIS interrompre une requête déjà EN VOL sur
// l'ANCIEN renderer au moment de l'appel : seules les NOUVELLES requêtes doivent partir sur le
// renderer recompilé, celles déjà lancées doivent aboutir normalement.
//
// Avec le moteur NAVIGATEUR (render.engine.request:'browser'), l'ancien BrowserRenderer.close()
// (render-browser.ts) fermait TOUS les emplacements de son pool, ACTIFS COMPRIS — la page en
// cours d'évaluation perdait son Chromium en plein `page.evaluate()` (« Target page, context or
// browser has been closed »), échec SYSTÉMATIQUE (pas une simple fenêtre étroite) dès qu'un rendu
// était en vol au moment de l'invalidation.
//
// Chromium réel (via Playwright) — même garde de disponibilité que tests/render-browser.test.ts :
// test skippé proprement si Chromium n'est pas installé.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { mjsTmp } from './helpers/tmp.js'
import { createRenderHandler } from '../src/server/render-request.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

async function isChromiumAvailable(): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright.chromium.executablePath())
  } catch {
    return false
  }
}

function project(prefix: string): string {
  const root = mjsTmp(prefix)
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'produit.mjs'), '<p class="v">V1</p>\n')
  return root
}

// composant à délai réel (pas juste statique) : garantit que le rendu est encore EN VOL (page.
// evaluate en cours) quand une invalidation arrive quelques ms plus tard — même patron que la
// rafale mesurée (produit.mjs avec une promesse qui ne se résout qu'après un vrai délai).
function projectAvecDelai(prefix: string, delaiMs: number): string {
  const root = mjsTmp(prefix)
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'produit.mjs'),
    '<script lang="coffee">\n' +
    `$p = new Promise (resolve) -> setTimeout((-> resolve('V1')), ${delaiMs})\n` +
    '</script>\n' +
    '<div class="wrap">\n{await $p}\n  <p class="pending">chargement…</p>\n{success val}\n  <p class="ok">{val}</p>\n{end}\n</div>\n')
  return root
}

// compte les process Chromium/chrome du système — utilisé en DELTA (avant/après), jamais en
// absolu : cette machine fait tourner plusieurs agents en parallèle, d'autres tests Playwright
// peuvent avoir leurs propres processus déjà ouverts, sans lien avec CE test.
function countChromiumProcesses(): number {
  try { return parseInt(execSync("pgrep -af 'chrome|chromium' | grep -v pgrep | wc -l").toString().trim(), 10) } catch { return -1 }
}

describe("render-request — invalidate() n'interrompt jamais une requête déjà en vol", function () {
  after(async () => { await terminateSharedWorkerPool() })

  it('moteur navigateur : une requête en vol pendant invalidate() aboutit, jamais un 500', async function () {
    const chromiumReady = await isChromiumAvailable()
    if (!chromiumReady) { this.skip(); return }
    this.timeout(60000)
    const root = project('render-request-invalidate-browser')
    const handler = await createRenderHandler({
      sourceDir: 'src', outputDir: 'dist',
      render: { engine: { request: 'browser' }, routes: { '/': { component: 'mjs-produit', mode: 'ssr', settleMs: 500 } } },
    } as any, root, undefined, 'dev')
    try {
      // amorce le pool (1er lancement de Chromium) — hors mesure, pas le rendu « en vol » testé.
      const premier = await handler.handle('/', {})
      assert.equal(premier.status, 200)
      assert.match(premier.body, /V1/)

      const enVol = handler.handle('/', {})
      // laisse le rendu démarrer réellement (acquisition du slot + navigation Playwright) avant
      // d'invalider — même délai que la sonde ayant confirmé le défaut de façon systématique.
      await new Promise(r => setTimeout(r, 100))
      handler.invalidate()

      const resultat = await enVol
      assert.equal(resultat.status, 200, `BUG confirmé si la requête en vol échoue pendant invalidate() : ${resultat.body}`)
      assert.match(resultat.body, /V1/)

      // une requête postérieure à invalidate() doit aboutir aussi (nouveau renderer, sans lien
      // avec l'ancien qui achève sa fermeture en tâche de fond).
      const apres = await handler.handle('/', {})
      assert.equal(apres.status, 200)
    } finally {
      await handler.close()
    }
  })

  it('moteur happy-dom (par défaut) : une requête en vol pendant invalidate() aboutit, jamais un 500', async function () {
    this.timeout(20000)
    const root = project('render-request-invalidate-happydom')
    const handler = await createRenderHandler({
      sourceDir: 'src', outputDir: 'dist',
      render: { engine: { request: 'happy-dom' }, routes: { '/': { component: 'mjs-produit', mode: 'ssr' } } },
    } as any, root, undefined, 'dev')
    try {
      const premier = await handler.handle('/', {})
      assert.equal(premier.status, 200)

      const enVol = handler.handle('/', {})
      await new Promise(r => setTimeout(r, 20))
      handler.invalidate()

      const resultat = await enVol
      assert.equal(resultat.status, 200, `requête en vol pendant invalidate() (moteur happy-dom) : ${resultat.body}`)
      assert.match(resultat.body, /V1/)
    } finally {
      await handler.close()
    }
  })

  // Rafale — chaque `invalidate()` démémoïse le moteur navigateur : la requête suivante en crée un
  // NOUVEAU, dont l'emplacement est encore en train de DÉMARRER (createSlot/bootSlot) quand
  // l'invalidation SUIVANTE arrive assez vite pour fermer ce moteur pendant que son tout premier
  // rendu n'a pas fini d'acquérir son emplacement — l'ancien `close()` ne fermait le navigateur
  // qu'après avoir attendu les emplacements ACTIFS, jamais ceux encore en train de démarrer.
  // Mesuré : 15/60/150ms d'écart cassent 14 à 19 requêtes sur 20 (500 « browser.newContext: …
  // closed »), 250ms d'écart laisse le temps à chaque démarrage de finir avant l'invalidation
  // suivante (20/20, mais ne prouve rien sur le correctif). Les 3 écarts mesurés sont rejoués ici.
  for (const intervalMs of [15, 60, 150]) {
    it(`rafale de 20 invalidate() espacées de ${intervalMs}ms, chacune avec une requête en vol : jamais un 500, jamais de Chromium qui survit à close()`, async function () {
      const chromiumReady = await isChromiumAvailable()
      if (!chromiumReady) { this.skip(); return }
      this.timeout(90000)
      const root = projectAvecDelai(`render-request-invalidate-rafale-${intervalMs}`, 150)
      const handler = await createRenderHandler({
        sourceDir: 'src', outputDir: 'dist',
        render: { engine: { request: 'browser' }, routes: { '/': { component: 'mjs-produit', mode: 'ssr', settleMs: 300 } } },
      } as any, root, undefined, 'dev')

      const baseline = countChromiumProcesses()
      const enVol: Promise<any>[] = []
      for (let i = 0; i < 20; i++) {
        enVol.push(handler.handle('/', {}))
        // laisse chaque rendu VRAIMENT démarrer avant d'invalider — même patron que la mesure,
        // chevauchement VOLONTAIRE (jamais d'attente de la fin d'un cycle avant le suivant).
        await new Promise(r => setTimeout(r, intervalMs))
        handler.invalidate()
      }
      const results = await Promise.allSettled(enVol)

      const echecs = results
        .map((r, i) => ({ i, r }))
        .filter(({ r }) => r.status === 'rejected' || (r as PromiseFulfilledResult<any>).value.status !== 200)
      assert.deepEqual(
        echecs.map(({ i, r }) => ({ i, detail: r.status === 'rejected' ? String((r as PromiseRejectedResult).reason) : (r as PromiseFulfilledResult<any>).value.status })),
        [],
        "BUG confirmé si une requête en vol pendant la rafale d'invalidate() échoue (500) au lieu d'aboutir",
      )
      for (const r of results) assert.match((r as PromiseFulfilledResult<any>).value.body, /V1/)

      await handler.close()
      // aucun Chromium SUPPLÉMENTAIRE ne doit survivre à close() — poll bornée (l'arrêt d'un
      // process n'est pas forcément instantané), comparé au NIVEAU DE DÉPART (delta, jamais
      // l'absolu — cf. countChromiumProcesses).
      let restants = countChromiumProcesses()
      for (let attempt = 0; attempt < 10 && restants > baseline; attempt++) {
        await new Promise(r => setTimeout(r, 300))
        restants = countChromiumProcesses()
      }
      assert.ok(restants <= baseline, `aucun Chromium supplémentaire ne doit survivre à close() (avant=${baseline}, après=${restants})`)
    })
  }
})
