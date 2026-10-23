// pas de flash d'intro sur les transitions css : en recochant une case, l'élément ne doit jamais être peint dans son état naturel
// une image AVANT que l'animation ne démarre (texte blanc, échelle 1 avant un départ à l'échelle 0). Le navigateur ne tient le node
// qu'au premier affichage de l'animation : le moteur pose donc d'abord une animation d'attente (image de départ seule, durée = délai,
// remplissage conservé), puis la vraie. L'animation native manque à happy-dom : le node est une doublure dont animate() est notée ;
// les valeurs lues dans de vrais navigateurs sont dans transition-moteur-navigateur-browser.test.ts

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

function faireNode() {
  const calls: any[] = []
  const node: any = { style: {}, calls }
  node.animate = (keyframes: any, opts: any) => {
    let fin: () => void = () => {}
    const finished = new Promise<void>((res) => { fin = res })
    const anim: any = { keyframes, opts, finished, finir: () => fin(), cancel() {}, effect: { getComputedTiming: () => ({ progress: 0 }) } }
    calls.push(anim)
    return anim
  }
  return node
}

describe('régression : pas de flash d\'intro sur les transitions css', function () {
  const cfg = (delay: number) => ({ css: (t: number, u: number) => ({ opacity: t, reste: u }), delay, duration: 200, easing: 'linear' })

  it('l\'image de départ (t1) est posée tout de suite, deux fois, en animation d\'attente de la durée du délai avec remplissage', function () {
    const µ = charger()
    const node = faireNode()
    µ._mjs_runTransition(node, cfg(70), 'in')
    assert.equal(node.calls.length, 1, 'rien d\'autre que l\'attente avant la fin de celle-ci')
    assert.deepEqual(node.calls[0].keyframes, [{ opacity: 0, reste: 1 }, { opacity: 0, reste: 1 }])
    assert.deepEqual(node.calls[0].opts, { duration: 70, fill: 'forwards' })
  })

  it('la vraie animation vient après, sans délai (porté par l\'attente), et part de la même image', async function () {
    const µ = charger()
    const node = faireNode()
    µ._mjs_runTransition(node, cfg(70), 'in')
    node.calls[0].finir()
    for (let i = 0; i < 8; i++) await Promise.resolve()
    assert.equal(node.calls.length, 2)
    assert.deepEqual(node.calls[1].opts, { duration: 200, fill: 'forwards' })
    assert.equal('delay' in node.calls[1].opts, false)
    assert.deepEqual(node.calls[1].keyframes[0], { opacity: 0, reste: 1, offset: 0 })
  })

  it('une sortie est tenue à 1 dès le départ', function () {
    const µ = charger()
    const node = faireNode()
    µ._mjs_runTransition(node, cfg(0), 'out')
    assert.deepEqual(node.calls[0].keyframes[0], { opacity: 1, reste: 0 })
    assert.deepEqual(node.calls[0].opts, { duration: 0, fill: 'forwards' })
  })
})
