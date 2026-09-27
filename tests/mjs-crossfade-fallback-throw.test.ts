// Régression — animations/crossfade.ts : un élément SANS homologue (pas de send/receive
// apparié) retombe sur `defaults.fallback(node, params, isIntro)`, appelé depuis le rappel du
// double `requestAnimationFrame` (`__defer`) SANS try/catch. Un throw synchrone dans cette
// fonction de repli — fournie par l'application — sortait du callback rAF sans jamais atteindre
// `resolve`/`reject` (un callback rAF qui lève est simplement avalé, jamais remonté à
// l'appelant) : la promesse du handler `@in`/`@out` restait EN ATTENTE À VIE, ce qui gelait le
// `Promise.all(transitions)` d'un groupe d'outro entier (nœuds fantômes, jamais retirés du DOM).
//
// Fix : try/catch autour du corps du callback différé — transition terminée (résolue), erreur
// rapportée par le canal d'avertissement du fichier (µ.warn, même convention que mjs_easing.ts
// pour un hook utilisateur qui lève).
//
// Même mécanisme de chargement que crossfade-sampleandrun-rejection.test.ts (cf. son en-tête) :
// `crossfade.ts` n'est pas un module ESM autonome, son contenu EST la valeur assignée à
// `µ.anim.crossfade` par le bundler — on reproduit ce branchement avec `new Function`.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

;(globalThis as any).µ = (globalThis as any).µ || {}
const µ: any = (globalThis as any).µ
µ.debug = µ.debug ?? false
µ.warn = µ.warn || (() => {})
µ.log = µ.log || (() => {})
µ.error = µ.error || (() => {})
µ.Ticker = µ.Ticker || { add() {} }
µ._mjs_interpolatorSet = µ._mjs_interpolatorSet || new WeakSet()
await import('../src/runtime/mjs_easing.js') // µ.easing réel (µ.easing.resolve)

const crossfadeSrc = readFileSync(join(process.cwd(), 'src/runtime/animations/crossfade.ts'), 'utf-8')
new Function('µ', `µ.anim = µ.anim || {}; µ.anim.crossfade = ${crossfadeSrc.trim()};`)(µ)

let uid = 0

describe('crossfade — fonction de repli (defaults.fallback) qui LÈVE synchronement', function () {
  // Portée PAR TEST (pas au chargement du module) : `crossfade.ts` (`__defer`, 2 rAF) lit
  // `requestAnimationFrame` sur `globalThis` au moment de l'APPEL — même précaution que
  // crossfade-sampleandrun-rejection.test.ts (cf. son en-tête, robuste à l'ordre des fichiers).
  let __prevRaf: any
  beforeEach(() => {
    __prevRaf = (globalThis as any).requestAnimationFrame
    ;(globalThis as any).requestAnimationFrame = (cb: any) => { Promise.resolve().then(() => cb(0)); return 1 }
  })
  afterEach(() => {
    ;(globalThis as any).requestAnimationFrame = __prevRaf
  })

  function withTimeout<T>(p: Promise<T>, ms: number): Promise<'RESOLVED' | 'REJECTED' | 'TIMEOUT'> {
    const t = new Promise<'TIMEOUT'>((resolve) => setTimeout(() => resolve('TIMEOUT'), ms))
    return Promise.race([p.then(() => 'RESOLVED' as const, () => 'REJECTED' as const), t])
  }

  it('fallback qui THROW : la transition se résout quand même (AVANT le fix : en attente à vie), erreur tracée par µ.warn', async function () {
    const name = `xfThrow${++uid}`
    const warnCalls: any[] = []
    µ.warn = (...a: any[]) => warnCalls.push(a)
    µ.anim.crossfade(name, {
      fallback: (_node: any, _params: any, _isIntro: boolean) => { throw new Error('repli en échec') },
    })
    // clé JAMAIS reçue par XReceive → pas de counterpart → chemin fallback
    const { outro } = µ.anim[`${name}Send`]({ key: `k${uid}` })
    const node: any = { style: {} }

    const r = await withTimeout(outro(node), 1000)
    assert.equal(r, 'RESOLVED', 'AVANT le fix : ni resolve ni reject — la promesse restait en attente à vie')
    assert.equal(warnCalls.length, 1, "l'échec du fallback doit être rapporté, pas juste avalé")
    assert.match(String(warnCalls[0][0]), /repli/)
  })

  it('fallback qui NE lève PAS (chemin heureux, sans .css) : comportement inchangé, résout vite', async function () {
    const name = `xfOk${++uid}`
    µ.anim.crossfade(name, { fallback: (_node: any, _params: any, _isIntro: boolean) => ({}) })
    const { intro } = µ.anim[`${name}Receive`]({ key: `k${uid}` })
    const node: any = { style: {} }
    const r = await withTimeout(intro(node), 1000)
    assert.equal(r, 'RESOLVED')
  })

  it('aucune fonction de repli fournie (defaults.fallback absent) : résout toujours, comportement inchangé', async function () {
    const name = `xfNone${++uid}`
    µ.anim.crossfade(name, {})
    const { outro } = µ.anim[`${name}Send`]({ key: `k${uid}` })
    const node: any = { style: {} }
    const r = await withTimeout(outro(node), 1000)
    assert.equal(r, 'RESOLVED')
  })
})
