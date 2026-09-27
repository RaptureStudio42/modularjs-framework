// render-browser — `close()` face à un emplacement de pool encore en train de DÉMARRER
// (`createSlot()`/`bootSlot()`, avant que le slot ne rejoigne `all[]`), face à une requête déjà EN
// FILE (pool saturé, `waiters`), et face à un double appel.
//
// Une requête déjà ACCEPTÉE par ce moteur (son `acquire()` a démarré AVANT tout `close()`) doit
// être servie jusqu'au bout par lui, que ce soit PENDANT qu'elle acquiert encore son emplacement
// (créé ou en file d'attente derrière un pool saturé) : avant correctif, `close()` ne comptait que
// les emplacements ACTIFS (`all[]`), jamais ceux en cours de création (`reserved`) ni les requêtes
// déjà en file (`waiters`, rejetées immédiatement) — un `close()` survenant dans ces fenêtres soit
// fermait le navigateur sous le pied de `bootSlot()`, soit rejetait une requête qui n'attendait
// pourtant qu'un emplacement déjà promis.
//
// Chromium réel (via Playwright), même garde de disponibilité que tests/render-browser.test.ts.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { mjsTmp } from './helpers/tmp.js'
import { createBrowserRenderer } from '../src/server/render-browser.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

async function isChromiumAvailable(): Promise<boolean> {
  try {
    return existsSync(chromium.executablePath())
  } catch {
    return false
  }
}

function project(prefix: string): string {
  const root = mjsTmp(prefix)
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'simple.mjs'), '<p class="v">V1</p>\n')
  return root
}

describe("render-browser — close() pendant qu'un emplacement démarre, et double close()", () => {
  let chromiumReady = false

  before(async function () {
    this.timeout(10000)
    chromiumReady = await isChromiumAvailable()
    if (!chromiumReady) {
      console.log('  ℹ️  Chromium non installé, tests render-browser-close-pendant-demarrage skippés. Activer : `npx playwright install chromium`')
    }
  })

  after(async () => { await terminateSharedWorkerPool() })

  it("une requête déjà acceptée aboutit même si close() survient PENDANT la création de son emplacement (jamais un navigateur fermé sous elle)", async function () {
    if (!chromiumReady) { this.skip(); return }
    this.timeout(60000)
    const root = project('close-pendant-demarrage')

    // sonde jetable, uniquement pour récupérer le PROTOTYPE partagé (même technique que
    // tests/browser-bootslot-cleanup.test.ts) — patché sur `newPage` (dernière étape de
    // `bootSlot()`, cf. render-browser.ts) pour figer une création EN COURS (reserved=1,
    // all=[]) exactement dans la fenêtre que `close()` doit désormais attendre.
    const probeBrowser = await chromium.launch({ headless: true })
    const probeCtx = await probeBrowser.newContext()
    const ContextProto = Object.getPrototypeOf(probeCtx)
    await probeCtx.close()
    await probeBrowser.close()

    const originalNewPage = ContextProto.newPage
    let signalerDemarrage: () => void
    const demarrageSignale = new Promise<void>(r => { signalerDemarrage = r })
    let debloquer: () => void
    const porte = new Promise<void>(r => { debloquer = r })
    let intercepte = false
    ContextProto.newPage = function (...args: any[]) {
      if (!intercepte) {
        intercepte = true
        signalerDemarrage()
        return porte.then(() => originalNewPage.apply(this, args))
      }
      return originalNewPage.apply(this, args)
    }

    try {
      const renderer = await createBrowserRenderer({ sourceDir: 'src', outputDir: 'dist' } as any, { configDir: root })
      try {
        const enCours = renderer.renderPage('mjs-simple', {})
        await demarrageSignale   // bootSlot() est maintenant bloqué DANS newPage() : reserved=1, all=[]

        const fermeture = renderer.close()
        // laisse une chance à close() d'entrer dans son attente (drainedWaiters) avant de
        // débloquer la création — sans ce court délai, le test ne prouverait rien de plus qu'un
        // enchaînement synchrone fortuit.
        await new Promise(r => setTimeout(r, 50))
        debloquer!()

        const resultat = await enCours
        assert.match(resultat.html, /V1/, "BUG confirmé si la requête déjà acceptée échoue au lieu d'aboutir")

        await fermeture   // borné par this.timeout() : si close() ne finissait jamais, mocha le signale
      } finally {
        await renderer.close().catch(() => {})
      }
    } finally {
      ContextProto.newPage = originalNewPage
    }
  })

  it("une requête déjà EN FILE (pool saturé) au moment de close() est quand même servie, jamais rejetée", async function () {
    if (!chromiumReady) { this.skip(); return }
    this.timeout(30000)
    const root = mjsTmp('close-requete-en-file')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'lente.mjs'),
      '<script lang="coffee">\n$p = new Promise (resolve) -> setTimeout((-> resolve(\'V1\')), 300)\n</script>\n' +
      '<div class="wrap">\n{await $p}\n  <p class="pending">chargement…</p>\n{success val}\n  <p class="ok">{val}</p>\n{end}\n</div>\n')

    const renderer = await createBrowserRenderer(
      { sourceDir: 'src', outputDir: 'dist', render: { browserPool: { size: 1 } } } as any,
      { configDir: root },
    )
    try {
      const premiere = renderer.renderPage('mjs-lente', {})   // occupe le SEUL emplacement (poolSize:1)
      const enFile = renderer.renderPage('mjs-lente', {})     // pool saturé dès l'appel : part en file (waiters)
      // laisse `enFile` VRAIMENT rejoindre `waiters` avant de fermer (son `acquire()` s'exécute de
      // façon synchrone jusqu'à sa mise en file, mais laisse une marge sans dépendre du micro-tick exact).
      await new Promise(r => setTimeout(r, 30))

      const fermeture = renderer.close()   // ne doit ni arracher `premiere`, ni rejeter `enFile`

      const [resultatPremiere, resultatEnFile] = await Promise.all([premiere, enFile])
      assert.match(resultatPremiere.html, /V1/, 'BUG confirmé si la requête déjà active est arrachée par close()')
      assert.match(resultatEnFile.html, /V1/, "BUG confirmé si la requête déjà EN FILE est rejetée par close() au lieu d'être servie jusqu'au bout")

      await fermeture   // borné par this.timeout() : si close() ne finissait jamais, mocha le signale
    } finally {
      await renderer.close().catch(() => {})
    }
  })

  it("close() appelé deux fois EN PARALLÈLE pendant qu'un rendu reste actif indéfiniment : les deux finissent, bornés par renderTimeoutMs, aucun blocage", async function () {
    if (!chromiumReady) { this.skip(); return }
    this.timeout(30000)
    const root = mjsTmp('close-deux-fois-actif')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'ok.mjs'), '<p class="ok">OK</p>\n')
    writeFileSync(join(root, 'src', 'bloque.mjs'),
      '<script lang="coffee">\n$p = new Promise (resolve) -> # jamais résolue : simule un rendu qui ne finit jamais\n</script>\n' +
      '<div class="wrap">\n{await $p}\n  <p class="pending">chargement…</p>\n{success val}\n  <p class="ok">{val}</p>\n{end}\n</div>\n')

    const renderTimeoutMs = 800
    const renderer = await createBrowserRenderer(
      { sourceDir: 'src', outputDir: 'dist', render: { browserPool: { size: 1, renderTimeoutMs } } } as any,
      { configDir: root },
    )
    try {
      await renderer.renderPage('mjs-ok', {})   // amorce le pool (poolSize:1 → le même emplacement sera réutilisé)
      const bloque = renderer.renderPage('mjs-bloque', {})
      bloque.catch(() => {})
      // laisse le rendu VRAIMENT démarrer (acquisition + navigation) avant de fermer.
      await new Promise(r => setTimeout(r, 150))

      const debut = Date.now()
      await Promise.all([renderer.close(), renderer.close()])
      const duree = Date.now() - debut
      assert.ok(duree < renderTimeoutMs + 10000,
        `close() double doit rester borné par renderTimeoutMs(${renderTimeoutMs}ms) + marge généreuse, mesuré ${duree}ms`)
    } finally {
      await renderer.close().catch(() => {})
    }
  })

  it("close() appelé deux fois sans rendu actif (puis une 3e fois après coup) : jamais d'exception", async function () {
    if (!chromiumReady) { this.skip(); return }
    this.timeout(30000)
    const root = project('close-deux-fois-simple')
    const renderer = await createBrowserRenderer({ sourceDir: 'src', outputDir: 'dist' } as any, { configDir: root })
    const premier = await renderer.renderPage('mjs-simple', {})
    assert.match(premier.html, /V1/)

    await Promise.all([renderer.close(), renderer.close()])
    await renderer.close()
  })
})
