// cli/dev-lock — `acquireDevLock` : l'arrêt (SIGINT/SIGTERM/SIGHUP) doit rester BORNÉ même quand
// `onShutdown` ne rend jamais la main — un serveur HTTP fermé PROPREMENT par `onShutdown`
// (`server.close()`) n'appelle son callback qu'une fois TOUTES ses connexions closes, y compris une
// connexion keep-alive que le client ne referme jamais de lui-même : sans borne, `process.exit(0)`
// ne serait alors JAMAIS atteint, le process resterait accroché indéfiniment.
//
// Avant correctif : `shutdown()` faisait `await onShutdown?.()` nu, sans aucune limite de temps.
//
// Même idiome de test que tests/cli-dev-lock.test.ts (process.on/process.exit mockés — jamais
// touché le VRAI process de test). Le délai de grâce réel (20s) n'est pas configurable depuis
// l'extérieur : ce test l'observe donc en le laissant réellement s'écouler (~20s, une seule fois).

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { acquireDevLock } from '../src/cli/dev-lock.js'

class FakeProcessExit extends Error {
  constructor(public code: number) { super(`process.exit(${code})`) }
}

describe("cli/dev-lock — acquireDevLock : arrêt borné même si onShutdown ne finit jamais", function () {
  let originalOn: typeof process.on
  let originalExit: typeof process.exit

  beforeEach(() => {
    originalOn = process.on
    originalExit = process.exit
  })
  afterEach(() => {
    process.on = originalOn
    process.exit = originalExit
  })

  it("SIGINT avec un onShutdown qui ne rend JAMAIS la main : process.exit(0) est quand même atteint, borné (délai de grâce)", async function () {
    this.timeout(25000)
    const lockPath = join(mjsTmp('devlock-shutdown-borne'), '.mjs-dev.lock')
    const captured: Record<string, (...a: any[]) => any> = {}
    process.on = ((event: string, listener: (...a: any[]) => any) => {
      if (event === 'SIGINT' || event === 'SIGTERM' || event === 'SIGHUP') captured[event] = listener
      return process
    }) as any
    process.exit = ((code?: number) => { throw new FakeProcessExit(code ?? 0) }) as any

    // simule un `onShutdown` qui ferme un serveur HTTP dont une connexion garde son socket ouvert
    // (keep-alive) : sa promesse ne se règle JAMAIS d'elle-même.
    acquireDevLock(lockPath, () => new Promise(() => { /* jamais résolue */ }))
    assert.ok(captured.SIGINT, 'un listener SIGINT doit avoir été enregistré')

    const debut = Date.now()
    await assert.rejects(captured.SIGINT(), FakeProcessExit,
      "BUG confirmé si l'arrêt reste bloqué à vie : process.exit(0) doit être atteint malgré onShutdown qui ne finit jamais")
    const duree = Date.now() - debut
    // Borne large (le délai de grâce réel est de 20s) : vérifie que ce N'EST PAS un blocage à vie
    // (le test aurait alors dépassé this.timeout()) plutôt qu'un chiffre précis.
    assert.ok(duree < 22000, `arrêt borné attendu sous ~20s de délai de grâce, mesuré ${duree}ms`)
    assert.equal(existsSync(lockPath), false, 'le lock doit être libéré une fois le délai de grâce écoulé')
  })

  it("deux signaux rapprochés (double Ctrl+C, SIGINT puis SIGTERM) : un seul arrêt, onShutdown appelé une fois", async function () {
    const lockPath = join(mjsTmp('devlock-double-signal'), '.mjs-dev.lock')
    const captured: Record<string, (...a: any[]) => any> = {}
    process.on = ((event: string, listener: (...a: any[]) => any) => {
      if (event === 'SIGINT' || event === 'SIGTERM' || event === 'SIGHUP') captured[event] = listener
      return process
    }) as any
    process.exit = ((code?: number) => { throw new FakeProcessExit(code ?? 0) }) as any

    let appels = 0
    acquireDevLock(lockPath, () => { appels++; return new Promise(r => setTimeout(r, 100)) })
    const premier = captured.SIGINT()
    const second  = captured.SIGTERM()
    await assert.rejects(premier, FakeProcessExit)
    await second
    assert.equal(appels, 1, `onShutdown doit tourner une seule fois, appelé ${appels} fois`)
  })
})

// 2e Ctrl+C : plus d'une seconde après le premier, l'utilisateur insiste → on cesse d'attendre et
// on sort aussitôt. Sous la seconde, c'est le MÊME Ctrl+C reçu deux fois (relayé par `npm run` ou
// par tsx en lancement depuis les sources) : ignoré. Un arrêt qui dure plus d'une seconde dit
// comment couper tout de suite, une seule fois.
describe('cli/dev-lock — acquireDevLock : un 2e Ctrl+C force l’arrêt', function () {
  let originalOn: typeof process.on
  let originalExit: typeof process.exit
  let originalWarn: typeof console.warn
  let avertissements: string[]
  let captured: Record<string, (...a: any[]) => any>
  const pause = (ms: number) => new Promise(r => setTimeout(r, ms))
  const indices = () => avertissements.filter(m => /Ctrl\+C (à nouveau|again)/.test(m)).length

  beforeEach(() => {
    originalOn     = process.on
    originalExit   = process.exit
    originalWarn   = console.warn
    avertissements = []
    captured       = {}
    process.on = ((event: string, listener: (...a: any[]) => any) => {
      if (event === 'SIGINT' || event === 'SIGTERM' || event === 'SIGHUP') captured[event] = listener
      return process
    }) as any
    process.exit = ((code?: number) => { throw new FakeProcessExit(code ?? 0) }) as any
    console.warn = (m?: any) => { avertissements.push(String(m)) }
  })
  afterEach(() => {
    process.on   = originalOn
    process.exit = originalExit
    console.warn = originalWarn
  })

  it("2e signal plus d'une seconde après le premier : l'attente est coupée, sortie aussitôt, lock libéré", async function () {
    this.timeout(8000)
    const lockPath = join(mjsTmp('devlock-second-signal-force'), '.mjs-dev.lock')
    // page encore en vol : ne se termine jamais d'elle-même ; `liberer` sert seulement à ne laisser
    // aucun arrêt en attente si le test échoue (son minuteur de 20 s appellerait sinon le VRAI
    // process.exit, restauré entre-temps, et tuerait le lanceur de tests en code 0)
    let liberer!: () => void
    acquireDevLock(lockPath, () => new Promise<void>(r => { liberer = r }))
    const debut   = Date.now()
    const premier = captured.SIGINT().then(() => 'fini', (e: any) => e instanceof FakeProcessExit ? 'sorti' : Promise.reject(e))
    await pause(1200)
    captured.SIGINT()
    const verdict = await Promise.race([premier, pause(3000).then(() => 'bloqué')])
    if (verdict === 'bloqué') { liberer(); await premier }
    assert.equal(verdict, 'sorti', "le 2e signal doit couper l'attente : l'arrêt est resté bloqué sur la page en vol")
    const duree = Date.now() - debut
    assert.ok(duree < 3000, `sortie attendue juste après le 2e signal (≈1,2 s), mesuré ${duree}ms`)
    assert.equal(existsSync(lockPath), false, 'le lock doit être libéré même sur un arrêt forcé')
  })

  it("2e signal sous la seconde (le même Ctrl+C reçu deux fois) : ignoré, l'arrêt ordonné va au bout", async function () {
    const lockPath = join(mjsTmp('devlock-second-signal-doublon'), '.mjs-dev.lock')
    let fini = false
    acquireDevLock(lockPath, () => new Promise<void>(r => setTimeout(() => { fini = true; r() }, 600)))
    const premier = captured.SIGINT()
    await pause(50)
    captured.SIGINT()
    await assert.rejects(premier, FakeProcessExit)
    assert.equal(fini, true, "le doublon ne doit rien forcer : l'arrêt ordonné finit son travail")
  })

  it("arrêt qui dure plus d'une seconde : un indice dit comment couper tout de suite, une seule fois ; arrêt rapide : aucun indice", async function () {
    this.timeout(8000)
    acquireDevLock(join(mjsTmp('devlock-indice-rapide'), '.mjs-dev.lock'), () => Promise.resolve())
    await assert.rejects(captured.SIGINT(), FakeProcessExit)
    await pause(1200)
    assert.equal(indices(), 0, `arrêt rapide : aucun indice attendu, reçu ${JSON.stringify(avertissements)}`)

    acquireDevLock(join(mjsTmp('devlock-indice-lent'), '.mjs-dev.lock'), () => new Promise(r => setTimeout(r, 1600)))
    await assert.rejects(captured.SIGINT(), FakeProcessExit)
    assert.equal(indices(), 1, `arrêt lent : un indice attendu, reçu ${JSON.stringify(avertissements)}`)
  })
})
