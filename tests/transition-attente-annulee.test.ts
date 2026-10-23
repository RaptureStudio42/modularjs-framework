// l'animation d'attente (anti-flash) épingle l'image de départ avec un remplissage conservé : si elle n'est pas annulée au moment où
// la vraie animation démarre, elle reste posée et, la vraie une fois libérée, le nœud retombe sur l'image de départ (intro invisible
// pour toujours). Ces cas exigent l'annulation de l'attente AVANT la création de la vraie animation, et la libération de tout à la fin

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { poserMessages } from './helpers/messages-stub.js'

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'runtime', 'mjs_easing.ts'), 'utf-8')

function charger() {
  const µ: any = { debug: false, Ticker: { add() {} }, _mjs_interpolatorSet: new WeakSet(), warn() {}, log() {} }
  poserMessages(µ)
  new Function('µ', SRC)(µ)
  return µ
}

// doublure : chaque animation note si les précédentes étaient déjà annulées au moment où elle est créée
function faireNode() {
  const calls: any[] = []
  const node: any = { style: {}, calls }
  node.animate = (keyframes: any, opts: any) => {
    let fin: () => void = () => {}
    let rejet: (e: any) => void = () => {}
    const finished = new Promise<void>((res, rej) => { fin = res; rejet = rej })
    finished.catch(() => {})
    const anim: any = {
      keyframes, opts, finished, cancelled: false, precedentesAnnulees: calls.map((a) => a.cancelled),
      effect: { getComputedTiming: () => ({ progress: 0 }) },
      cancel() { anim.cancelled = true; rejet(new Error('cancelled')) },
      finir: () => fin()
    }
    calls.push(anim)
    return anim
  }
  return node
}

const vider = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
const css = (t: number, u: number) => ({ opacity: t, reste: u })

describe('transition css : l\'animation d\'attente est annulée quand la vraie démarre', function () {
  it('intro : l\'attente est annulée avant que la vraie animation ne soit créée', async function () {
    const µ = charger()
    const node = faireNode()
    µ._mjs_runTransition(node, { css, delay: 40, duration: 100, easing: 'linear' }, 'in')
    assert.equal(node.calls.length, 1)
    assert.equal(node.calls[0].cancelled, false, 'tant que le retard court, l\'attente tient l\'image de départ')
    node.calls[0].finir()
    await vider()
    assert.equal(node.calls.length, 2)
    assert.equal(node.calls[0].cancelled, true, 'l\'attente est annulée une fois la vraie posée')
    assert.deepEqual(node.calls[1].precedentesAnnulees, [true], 'et elle l\'était déjà à la création de la vraie')
  })

  it('intro menée au bout : plus aucune animation posée, le nœud retrouve son état naturel', async function () {
    const µ = charger()
    const node = faireNode()
    const p = µ._mjs_runTransition(node, { css, duration: 100, easing: 'linear' }, 'in')
    node.calls[0].finir()
    await vider()
    node.calls[1].finir()
    assert.equal(await p, 'in')
    assert.deepEqual(node.calls.map((a: any) => a.cancelled), [true, true])
  })

  it('sortie : l\'attente est annulée, seule la vraie reste posée jusqu\'au crochet de libération', async function () {
    const µ = charger()
    const node = faireNode()
    const p = µ._mjs_runTransition(node, { css, duration: 100, easing: 'linear' }, 'out')
    node.calls[0].finir()
    await vider()
    assert.deepEqual(node.calls[1].precedentesAnnulees, [true])
    node.calls[1].finir()
    assert.equal(await p, 'out')
    assert.deepEqual(node.calls.map((a: any) => a.cancelled), [true, false])
    node._mjs_pendingFillRelease()
    assert.deepEqual(node.calls.map((a: any) => a.cancelled), [true, true])
  })
})
