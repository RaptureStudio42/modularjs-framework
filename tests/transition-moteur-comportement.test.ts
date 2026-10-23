// comportement figé du moteur des transitions (µ._mjs_runTransition, mode css) : ce qu'il pose, dans quel
// ordre, ce qu'il rend ; le fichier est chargé sur un µ privé (source lue, new Function), le node est une
// doublure dont animate() est pilotée à la main (happy-dom n'a pas d'animation native)
// les mêmes cas tournent avant et après la réécriture du moteur : rien ici ne dépend du découpage interne

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { poserMessages } from './helpers/messages-stub.js'

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'runtime', 'mjs_easing.ts'), 'utf-8')

function charger() {
  const µ: any = { debug: false, warnings: [] as any[], Ticker: { add() {} }, _mjs_interpolatorSet: new WeakSet() }
  µ.warn = (...a: any[]) => { µ.warnings.push(a) }
  µ.log = () => {}
  poserMessages(µ)
  new Function('µ', SRC)(µ)
  return µ
}

// node doublure : chaque animate() rend une animation dont `finished` est pilotée (finir, annuler) et dont
// la progression se règle ; `journal` garde l'ordre exact des événements (animate, cancel)
function faireNode() {
  const journal: string[] = []
  const calls: any[] = []
  const node: any = { style: {}, calls, journal }
  node.animate = (keyframes: any, opts: any) => {
    let fin: () => void = () => {}
    let rejet: (e: any) => void = () => {}
    const finished = new Promise<void>((res, rej) => { fin = res; rejet = rej })
    finished.catch(() => {})
    const n = calls.length
    const anim: any = {
      keyframes, opts, finished, cancelled: false, progress: 0,
      effect: { getComputedTiming: () => ({ progress: anim.progress }) },
      cancel() {
        journal.push('cancel#' + n)
        if (anim.cancelled) return
        anim.cancelled = true
        rejet(Object.assign(new Error('cancelled'), { name: 'AbortError' }))
      },
      finir: () => fin()
    }
    journal.push('animate#' + n)
    calls.push(anim)
    return anim
  }
  return node
}

const vider = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
const css = (t: number, u: number) => ({ opacity: t, reste: u })

// joue une transition jusqu'au bout : la bidon finit, la vraie est posée, puis finit à son tour
async function lancer(µ: any, node: any, cfg: any, direction: string) {
  const p = µ._mjs_runTransition(node, cfg, direction)
  const n = node.calls.length
  node.calls[n - 1].finir()
  await vider()
  node.calls[n].finir()
  return p
}

describe('µ._mjs_runTransition (mode css) : comportement figé', function () {
  let µ: any
  beforeEach(function () { µ = charger() })

  it('intro : une animation d\'épinglage (frame de départ x2, durée du délai), puis la vraie (61 images), état tenu, rendu à la fin', async function () {
    const node = faireNode()
    const cfg = { css, duration: 300, easing: 'linear' }
    const p = µ._mjs_runTransition(node, cfg, 'in')
    assert.equal(node.calls.length, 1, 'seule la bidon est posée tout de suite')
    const bidon = node.calls[0]
    assert.deepEqual(bidon.keyframes, [{ opacity: 0, reste: 1 }, { opacity: 0, reste: 1 }])
    assert.strictEqual(bidon.keyframes[0], bidon.keyframes[1], 'la même image deux fois')
    assert.deepEqual(bidon.opts, { duration: 0, fill: 'forwards' })
    const etat = node._mjs_transition_state
    assert.equal(etat.direction, 'in')
    assert.equal(etat.t1, 0)
    assert.equal(etat.delta, 1)
    assert.equal(etat.aborted, false)
    assert.equal(etat.inDelay, true)
    assert.strictEqual(etat.anim, bidon)
    assert.strictEqual(etat.easing, µ.easing.linear)
    bidon.finir()
    await vider()
    assert.equal(bidon.cancelled, true, 'la bidon est libérée avant la vraie')
    assert.equal(node.calls.length, 2)
    const reelle = node.calls[1]
    assert.equal(reelle.keyframes.length, 61)
    reelle.keyframes.forEach((f: any, i: number) => {
      assert.equal(f.offset, i / 60)
      assert.equal(f.opacity, i / 60)
      assert.equal(f.reste, 1 - i / 60)
    })
    assert.deepEqual(Object.keys(reelle.opts).sort(), ['duration', 'fill'])
    assert.equal(reelle.opts.duration, 300)
    assert.equal(reelle.opts.fill, 'forwards')
    assert.equal(etat.inDelay, false)
    assert.strictEqual(etat.anim, reelle)
    assert.strictEqual(node._mjs_transition_state, etat)
    reelle.finir()
    assert.equal(await p, 'in')
    assert.equal(reelle.cancelled, true, 'une intro libère son remplissage tout de suite')
    assert.equal(node._mjs_transition_state, null)
    assert.equal(node._mjs_pendingFillRelease, undefined)
    assert.deepEqual(node.journal, ['animate#0', 'cancel#0', 'animate#1', 'cancel#1'])
  })

  it('sortie : de 1 vers 0, remplissage gardé jusqu\'au crochet de libération', async function () {
    const node = faireNode()
    const p = µ._mjs_runTransition(node, { css, easing: 'linear' }, 'out')
    assert.deepEqual(node.calls[0].keyframes[0], { opacity: 1, reste: 0 })
    node.calls[0].finir()
    await vider()
    const reelle = node.calls[1]
    assert.equal(reelle.opts.duration, 400, 'durée par défaut')
    assert.equal(reelle.keyframes[0].opacity, 1)
    assert.equal(reelle.keyframes[60].opacity, 0)
    assert.equal(reelle.keyframes[30].opacity, 0.5)
    reelle.finir()
    assert.equal(await p, 'out')
    assert.equal(reelle.cancelled, false)
    assert.equal(node._mjs_transition_state, null)
    assert.equal(typeof node._mjs_pendingFillRelease, 'function')
    node._mjs_pendingFillRelease()
    assert.equal(reelle.cancelled, true)
    assert.equal(node._mjs_pendingFillRelease, null)
  })

  it('easing absent : le repli du résolveur ; easing en chaîne ou en fonction : résolu', async function () {
    const a = faireNode()
    await lancer(µ, a, { css }, 'in')
    const ref = µ.easing.resolve(undefined)
    assert.equal(a.calls[1].keyframes[15].opacity, ref(15 / 60))
    const b = faireNode()
    await lancer(µ, b, { css, easing: 'ease-in' }, 'in')
    assert.equal(b.calls[1].keyframes[15].opacity, µ.easing.cubicIn(15 / 60))
    const c = faireNode()
    await lancer(µ, c, { css, easing: (t: number) => t * t }, 'in')
    assert.equal(c.calls[1].keyframes[30].opacity, 0.25)
  })

  it('délai : porté par la bidon (jamais par la vraie) ; négatif ramené à 0', async function () {
    const a = faireNode()
    const pa = µ._mjs_runTransition(a, { css, delay: 120, duration: 200, easing: 'linear' }, 'in')
    assert.deepEqual(a.calls[0].opts, { duration: 120, fill: 'forwards' })
    a.calls[0].finir()
    await vider()
    assert.equal('delay' in a.calls[1].opts, false)
    assert.equal(a.calls[1].opts.duration, 200)
    a.calls[1].finir()
    await pa
    const b = faireNode()
    µ._mjs_runTransition(b, { css, delay: -50 }, 'in')
    assert.equal(b.calls[0].opts.duration, 0)
  })

  it('nombre d\'images : absent 60 ; 5 donne 6 images ; 0 et négatif donnent 1 (2 images) ; NaN et texte donnent 60', async function () {
    const attendu: Array<[any, number]> = [[undefined, 61], [5, 6], [0, 2], [-3, 2], [NaN, 61], ['abc', 61], [Infinity, 61], ['4', 5]]
    for (const [steps, n] of attendu) {
      const node = faireNode()
      await lancer(µ, node, { css, steps, easing: 'linear' }, 'in')
      assert.equal(node.calls[1].keyframes.length, n, 'steps = ' + String(steps))
      const k = node.calls[1].keyframes
      assert.equal(k[0].offset, 0)
      assert.equal(k[k.length - 1].offset, 1)
    }
  })

  it('intro coupée par une sortie : durée proportionnelle à la distance, départ à la valeur courante', async function () {
    const node = faireNode()
    const cfg = { css, duration: 400, easing: 'linear' }
    const p1 = µ._mjs_runTransition(node, cfg, 'in')
    node.calls[0].finir()
    await vider()
    const reelle1 = node.calls[1]
    reelle1.progress = 0.25
    const p2 = µ._mjs_runTransition(node, cfg, 'out')
    assert.equal(reelle1.cancelled, true)
    assert.equal(await p1, 'in', 'la promesse de l\'ancienne se rend')
    assert.deepEqual(node.journal.slice(-2), ['cancel#1', 'animate#2'], 'annulation puis nouvelle bidon')
    const bidon2 = node.calls[2]
    assert.deepEqual(bidon2.keyframes[0], { opacity: 0.25, reste: 0.75 })
    const etat = node._mjs_transition_state
    assert.equal(etat.direction, 'out')
    assert.equal(etat.t1, 0.25)
    assert.equal(etat.delta, -0.25)
    bidon2.finir()
    await vider()
    const reelle2 = node.calls[3]
    assert.equal(reelle2.opts.duration, 100)
    assert.equal(reelle2.keyframes[0].opacity, 0.25)
    assert.equal(reelle2.keyframes[60].opacity, 0)
    assert.equal(reelle2.keyframes[30].opacity, 0.125)
    reelle2.finir()
    assert.equal(await p2, 'out')
  })

  it('l\'ancienne animation est annulée AVANT que la fabrique de la nouvelle ne lise le node', async function () {
    const node = faireNode()
    const ordre: string[] = []
    const fabrique: any = function (n: any) {
      ordre.push('fabrique:' + n.journal.join('|'))
      return { css, easing: 'linear' }
    }
    µ._mjs_runTransition(node, fabrique, 'in')
    node.calls[0].finir()
    await vider()
    node.calls[1].progress = 0.5
    µ._mjs_runTransition(node, fabrique, 'out')
    assert.equal(ordre.length, 2, 'la fabrique css est rappelée à chaque fois (pas de cache)')
    assert.ok(ordre[1].endsWith('cancel#1'), 'annulation faite avant la lecture : ' + ordre[1])
    assert.equal(node.calls[2].keyframes[0].opacity, 0.5)
  })

  it('sortie coupée par une intro : repart de la valeur courante vers 1', async function () {
    const node = faireNode()
    const cfg = { css, duration: 200, easing: 'linear' }
    µ._mjs_runTransition(node, cfg, 'out')
    node.calls[0].finir()
    await vider()
    node.calls[1].progress = 0.5
    const p2 = µ._mjs_runTransition(node, cfg, 'in')
    const etat = node._mjs_transition_state
    assert.equal(etat.t1, 0.5)
    assert.equal(etat.delta, 0.5)
    node.calls[2].finir()
    await vider()
    assert.equal(node.calls[3].opts.duration, 100)
    assert.equal(node.calls[3].keyframes[0].opacity, 0.5)
    assert.equal(node.calls[3].keyframes[60].opacity, 1)
    node.calls[3].finir()
    assert.equal(await p2, 'in')
  })

  it('coupure pendant le délai : la valeur reste celle de départ (la bidon n\'est pas du progrès)', async function () {
    const node = faireNode()
    const cfg = { css, delay: 200, easing: 'linear' }
    const p1 = µ._mjs_runTransition(node, cfg, 'in')
    node.calls[0].progress = 0.9
    assert.equal(node._mjs_transition_state.tValue(), 0)
    const p2 = µ._mjs_runTransition(node, cfg, 'out')
    assert.equal(node.calls[0].cancelled, true)
    assert.equal(await p1, 'in', 'la promesse coupée pendant le délai se rend aussi')
    assert.equal(await p2, undefined, 'déjà à la cible (0) : rien à jouer')
    assert.equal(node.calls.length, 1)
    assert.equal(node._mjs_transition_state, null)
  })

  it('déjà à la cible : rien posé, promesse rendue sans valeur', async function () {
    const node = faireNode()
    const cfg = { css, easing: 'linear' }
    µ._mjs_runTransition(node, cfg, 'in')
    node.calls[0].finir()
    await vider()
    node.calls[1].progress = 1
    const p = µ._mjs_runTransition(node, cfg, 'in')
    assert.equal(await p, undefined)
    assert.equal(node.calls.length, 2)
    assert.equal(node._mjs_transition_state, null)
  })

  it('progression absente (null) : lue comme terminée', async function () {
    const node = faireNode()
    const cfg = { css, easing: 'linear' }
    µ._mjs_runTransition(node, cfg, 'in')
    node.calls[0].finir()
    await vider()
    node.calls[1].effect = { getComputedTiming: () => ({ progress: null }) }
    assert.equal(node._mjs_transition_state.tValue(), 1)
    node.calls[1].effect = {}
    assert.equal(node._mjs_transition_state.tValue(), 1)
  })

  it('abort() pendant le passage bidon vers vraie : la vraie n\'est jamais posée, la promesse se rend', async function () {
    const node = faireNode()
    const p = µ._mjs_runTransition(node, { css }, 'in')
    const etat = node._mjs_transition_state
    node.calls[0].finir()
    etat.abort()
    assert.equal(etat.aborted, true)
    assert.equal(etat.anim, null)
    assert.equal(node._mjs_transition_state, null)
    assert.equal(await p, 'in')
    assert.equal(node.calls.length, 1)
  })

  it('animation vraie annulée de l\'extérieur : la promesse se rend, l\'état reste posé', async function () {
    const node = faireNode()
    const p = µ._mjs_runTransition(node, { css }, 'out')
    node.calls[0].finir()
    await vider()
    const etat = node._mjs_transition_state
    node.calls[1].cancel()
    assert.equal(await p, 'out')
    assert.strictEqual(node._mjs_transition_state, etat)
    assert.equal(node._mjs_pendingFillRelease, undefined)
  })

  it('abort() d\'un état déjà remplacé n\'efface pas l\'état du successeur', async function () {
    const node = faireNode()
    µ._mjs_runTransition(node, { css }, 'in')
    const ancien = node._mjs_transition_state
    µ._mjs_runTransition(node, { css }, 'out')
    const nouveau = node._mjs_transition_state
    assert.notStrictEqual(ancien, nouveau)
    ancien.abort()
    assert.strictEqual(node._mjs_transition_state, nouveau)
  })

  it('css() qui lève : avertissement, promesse rendue avec la direction, rien posé sur le node', async function () {
    const node = faireNode()
    const cfg = { css: () => { throw new Error('boum') } }
    const r = await µ._mjs_runTransition(node, cfg, 'in')
    assert.equal(r, 'in')
    assert.equal(node.calls.length, 0)
    assert.equal(node._mjs_transition_state, undefined)
    assert.equal(µ.warnings.length, 1)
    assert.match(String(µ.warnings[0][0]), /^\[mjs-tx\] /)
    assert.match(String(µ.warnings[0][0]), /cfg\.css\(\) a levé \(transition in #\d+\)/)
    assert.equal(µ.warnings[0][1].message, 'boum')
  })

  it('css() qui lève à une image du milieu : même traitement, aucune animation posée', async function () {
    const node = faireNode()
    let n = 0
    const r = await µ._mjs_runTransition(node, { css: (t: number) => { if (++n > 5) throw new Error('mi-course'); return { opacity: t } } }, 'out')
    assert.equal(r, 'out')
    assert.equal(node.calls.length, 0)
    assert.equal(µ.warnings.length, 1)
  })

  it('fabrique : appelée avec le node, sa cfg jouée ; qui lève : avertissement et promesse rendue ; qui rend rien : promesse sans valeur', async function () {
    const node = faireNode()
    let vu: any = null
    const fabrique: any = function (n: any) { vu = n; return { css, easing: 'linear' } }
    await lancer(µ, node, fabrique, 'in')
    assert.strictEqual(vu, node)
    assert.equal(node.calls[1].keyframes.length, 61)

    const b = faireNode()
    const leve: any = function () { throw new Error('setup') }
    assert.equal(await µ._mjs_runTransition(b, leve, 'out'), 'out')
    assert.equal(b.calls.length, 0)
    assert.match(String(µ.warnings[0][0]), /setup\(\) a levé \(transition out #\d+\)/)
    assert.equal(µ.warnings[0][1].message, 'setup')

    const c = faireNode()
    assert.equal(await µ._mjs_runTransition(c, function () {}, 'in'), undefined)
    assert.equal(await µ._mjs_runTransition(c, function () { return { duration: 5 } }, 'in'), undefined)
    assert.equal(await µ._mjs_runTransition(c, null, 'in'), undefined)
    assert.equal(await µ._mjs_runTransition(c, undefined, 'out'), undefined)
    assert.equal(c.calls.length, 0)
  })

  it('l\'état de départ d\'une direction vient du cas neutre : intro depuis 0, sortie depuis 1', function () {
    const a = faireNode()
    µ._mjs_runTransition(a, { css }, 'in')
    assert.equal(a._mjs_transition_state.t1, 0)
    const b = faireNode()
    µ._mjs_runTransition(b, { css }, 'out')
    assert.equal(b._mjs_transition_state.t1, 1)
  })

  it('une transition dont la fabrique rend un tick ne passe pas par l\'animation du navigateur', function () {
    const g: any = globalThis
    const avant = [g.requestAnimationFrame, g.cancelAnimationFrame]
    const file: any[] = []
    g.requestAnimationFrame = (cb: any) => { file.push(cb); return file.length }
    g.cancelAnimationFrame = () => {}
    try {
      const node = faireNode()
      const fabrique: any = function () { return { tick() {}, duration: 100 } }
      µ._mjs_runTransition(node, fabrique, 'in')
      assert.equal(node.calls.length, 0)
      assert.equal(file.length, 1)
      assert.ok(node._mjs_tick_cfgs.has(fabrique), 'cfg à tick gardée par fabrique')
      node._mjs_transition_state.abort()
    }
    finally {
      g.requestAnimationFrame = avant[0]
      g.cancelAnimationFrame = avant[1]
    }
  })

  it('un node en mode partagé part vers le @keyframes partagé, pas vers l\'animation du navigateur', function () {
    const node = faireNode()
    node._mjs_anim_mode = 'shared'
    const appels: any[] = []
    µ.anim._mjs_runShared = (n: any, nom: string, builder: any, opts: any) => { appels.push({ nom, opts, kf: builder() }); return Promise.resolve() }
    µ._mjs_runTransition(node, { css, duration: 90, delay: 5, steps: 4, easing: 'linear' }, 'in')
    assert.equal(node.calls.length, 0)
    assert.equal(appels.length, 1)
    assert.match(appels[0].nom, /^_kf_[0-9a-z]+$/)
    assert.deepEqual(appels[0].opts, { duration: 90, delay: 5, direction: 'in' })
    assert.deepEqual(appels[0].kf.map((f: any) => f.offset), [0, 0.25, 0.5, 0.75, 1])
    assert.deepEqual(appels[0].kf.map((f: any) => f.opacity), [0, 0.25, 0.5, 0.75, 1])
  })
})

describe('µ._mjs_fixPosition : cas sans navigateur', function () {
  let µ: any
  const g: any = globalThis
  function charge(computed: any) {
    g.window = { getComputedStyle: () => computed }
    µ = charger()
  }
  afterEach(function () { delete g.window })

  it('sans offsetParent ni rectangle : rectangle de la balise, origine (0, 0)', function () {
    charge({ position: 'relative', width: '80px', height: '20px' })
    const node: any = { nodeType: 1, style: {}, offsetParent: null, offsetLeft: 99, offsetTop: 99, getBoundingClientRect: () => ({ left: 31.5, top: 12.25 }) }
    µ._mjs_fixPosition(node)
    assert.deepEqual(node.style, { position: 'absolute', margin: '0', width: '80px', height: '20px', left: '31.5px', top: '12.25px' })
    assert.equal(node._mjs_posFixed, true)
  })

  it('avec rectangle et sans offsetParent : le rectangle donné, origine (0, 0)', function () {
    charge({ position: 'static', width: '10px', height: '5px' })
    const node: any = { nodeType: 1, style: {}, offsetParent: null, getBoundingClientRect: () => ({ left: 1, top: 1 }) }
    µ._mjs_fixPosition(node, { left: 40, top: 70 })
    assert.equal(node.style.left, '40px')
    assert.equal(node.style.top, '70px')
  })

  it('absolu ou fixe, node absent, sans style, nœud texte : rien posé', function () {
    for (const position of ['absolute', 'fixed']) {
      charge({ position, width: '1px', height: '1px' })
      const node: any = { nodeType: 1, style: {} }
      µ._mjs_fixPosition(node)
      assert.deepEqual(node.style, {})
      assert.equal(node._mjs_posFixed, undefined)
    }
    charge({ position: 'static' })
    µ._mjs_fixPosition(null)
    µ._mjs_fixPosition({ nodeType: 3, style: {} })
    const sansStyle: any = { nodeType: 1 }
    µ._mjs_fixPosition(sansStyle)
    assert.equal(sansStyle._mjs_posFixed, undefined)
  })

  it('retrait : les six propriétés enlevées dans l\'ordre, drapeau remis à faux ; sans drapeau, rien', function () {
    charge({ position: 'static' })
    const enleves: string[] = []
    const node: any = { _mjs_posFixed: true, style: { removeProperty: (n: string) => { enleves.push(n) } } }
    µ._mjs_unfixPosition(node)
    assert.deepEqual(enleves, ['position', 'margin', 'width', 'height', 'left', 'top'])
    assert.equal(node._mjs_posFixed, false)
    enleves.length = 0
    µ._mjs_unfixPosition(node)
    µ._mjs_unfixPosition(null)
    assert.deepEqual(enleves, [])
  })
})

describe('µ._mjs_whenLayouted : une intro attend la mise en page', function () {
  const g: any = globalThis
  let µ: any
  let images: Array<() => void>
  let vraiRaf: any
  let vraiMicro: any

  beforeEach(function () {
    images = []
    vraiRaf = g.requestAnimationFrame
    vraiMicro = g.queueMicrotask
    g.requestAnimationFrame = (f: () => void) => { images.push(f) }
    µ = charger()
  })
  afterEach(function () {
    g.requestAnimationFrame = vraiRaf
    g.queueMicrotask = vraiMicro
  })

  // joue les images en attente, une génération à la fois
  const jouerImage = () => { const f = images.splice(0); f.forEach((x) => x()) }

  it('nœud déjà connecté : jamais tout de suite, au plus tôt après la micro-tâche, une seule fois', async function () {
    const appels: number[] = []
    µ._mjs_whenLayouted({ isConnected: true }, () => { appels.push(1) })
    assert.deepEqual(appels, [], 'pas de départ synchrone')
    await vider()
    assert.deepEqual(appels, [1])
    assert.equal(images.length, 0, 'aucune image demandée')
  })

  it('nœud détaché : fn n\'est pas appelée, elle part à l\'image qui suit sa connexion, une seule fois', async function () {
    const noeud = { isConnected: false }
    const appels: string[] = []
    µ._mjs_whenLayouted(noeud, () => { appels.push('fn') })
    await vider()
    assert.deepEqual(appels, [], 'rien avant la connexion (micro-tâche)')
    assert.equal(images.length, 1)
    for (let i = 0; i < 5; i++) jouerImage()
    assert.deepEqual(appels, [], 'rien tant que le nœud est détaché')
    assert.equal(images.length, 1, 'une seule relance en attente')
    noeud.isConnected = true
    assert.deepEqual(appels, [], 'pas d\'appel avant l\'image suivante')
    jouerImage()
    assert.deepEqual(appels, ['fn'])
    jouerImage()
    assert.deepEqual(appels, ['fn'], 'une seule fois')
  })

  it('jamais connecté : 30 images au plus, puis abandon sans appel', async function () {
    const noeud = { isConnected: false }
    let n = 0
    let demandees = 0
    g.requestAnimationFrame = (f: () => void) => { demandees++; images.push(f) }
    µ._mjs_whenLayouted(noeud, () => { n++ })
    await vider()
    for (let i = 0; i < 60; i++) jouerImage()
    assert.equal(n, 0, 'fn jamais appelée sur un nœud détaché')
    assert.equal(demandees, 30, 'trente images demandées, pas une de plus')
    assert.equal(images.length, 0)
  })

  it('connecté à la toute dernière image : fn part ; plus tard, jamais', async function () {
    const noeud = { isConnected: false }
    let n = 0
    µ._mjs_whenLayouted(noeud, () => { n++ })
    await vider()
    for (let i = 0; i < 29; i++) jouerImage()
    assert.equal(n, 0)
    noeud.isConnected = true
    jouerImage()
    assert.equal(n, 1, 'la 30e image appelle fn')
    assert.equal(images.length, 0)
  })

  it('essai déjà avancé (attempts > 0) : pas de micro-tâche, départ immédiat si connecté', function () {
    const appels: number[] = []
    µ._mjs_whenLayouted({ isConnected: true }, () => { appels.push(1) }, 5)
    assert.deepEqual(appels, [1])
    µ._mjs_whenLayouted({ isConnected: true }, () => { appels.push(2) }, 30)
    assert.deepEqual(appels, [1, 2])
    µ._mjs_whenLayouted({ isConnected: false }, () => { appels.push(3) }, 30)
    assert.deepEqual(appels, [1, 2], 'au plafond, détaché : abandon')
    assert.equal(images.length, 0)
  })

  it('sans queueMicrotask : le chemin immédiat sert, jamais avant la connexion', function () {
    g.queueMicrotask = undefined
    const noeud = { isConnected: false }
    const appels: number[] = []
    µ._mjs_whenLayouted(noeud, () => { appels.push(1) })
    assert.deepEqual(appels, [])
    assert.equal(images.length, 1)
    noeud.isConnected = true
    jouerImage()
    assert.deepEqual(appels, [1])
    µ._mjs_whenLayouted({ isConnected: true }, () => { appels.push(2) })
    assert.deepEqual(appels, [1, 2])
  })
})

describe('µ._mjs_fixPosition : ancre et bordure', function () {
  const g: any = globalThis
  let µ: any
  afterEach(function () { delete g.window })

  const noeud = (ancre: any): any => ({ nodeType: 1, style: {}, offsetParent: ancre, offsetLeft: 111, offsetTop: 222, getBoundingClientRect: () => ({ left: 100, top: 200 }) })
  const ancre = { clientLeft: 3, clientTop: 5, getBoundingClientRect: () => ({ left: 10, top: 20 }) }

  beforeEach(function () {
    g.window = { getComputedStyle: () => ({ position: 'static', width: '8px', height: '9px' }) }
    µ = charger()
  })

  it('rectangle donné et ancre : position relative au bord de remplissage (bordure gauche et haute retranchées)', function () {
    const n = noeud(ancre)
    µ._mjs_fixPosition(n, { left: 50, top: 70 })
    assert.equal(n.style.left, (50 - 10 - 3) + 'px')
    assert.equal(n.style.top, (70 - 20 - 5) + 'px')
  })

  it('sans rectangle donné, avec ancre : la boîte de mise en page (offsetLeft, offsetTop) fait foi', function () {
    const n = noeud(ancre)
    µ._mjs_fixPosition(n)
    assert.equal(n.style.left, '111px')
    assert.equal(n.style.top, '222px')
  })
})

describe('µ.anim._mjs_acquireKeyframes : texte et cache des images clés', function () {
  const g: any = globalThis
  let µ: any
  let regles: string[]
  let vraiSheet: any

  beforeEach(function () {
    regles = []
    vraiSheet = g.CSSStyleSheet
    g.CSSStyleSheet = class {
      cssRules: any[] = []
      replaceSync() {}
      insertRule(t: string, i: number) { regles.push(t); this.cssRules.splice(i, 0, { name: /@keyframes (\S+)/.exec(t)![1], cssText: t }) }
      deleteRule(i: number) { this.cssRules.splice(i, 1) }
    }
    µ = charger()
    µ._csp = true
  })
  afterEach(function () { g.CSSStyleSheet = vraiSheet })

  it('décalages sur deux décimales et propriétés en kebab-case, toutes les majuscules converties', function () {
    const racine: any = { adoptedStyleSheets: [] }
    const nom = µ.anim._mjs_acquireKeyframes('kf-test', () => [
      { offset: 0, opacity: 0, backgroundColor: 'red' },
      { offset: 1 / 3, borderTopLeftRadius: '4px' },
      { offset: 0.125, opacity: 0.5 },
      { offset: 1, opacity: 1 }
    ], racine)
    assert.equal(nom, 'kf-test')
    assert.deepEqual(regles, ['@keyframes kf-test { 0.00% { opacity: 0; background-color: red } 33.33% { border-top-left-radius: 4px } 12.50% { opacity: 0.5 } 100.00% { opacity: 1 } }'])
  })

  it('cache : un second appel ne reconstruit pas la règle ; elle part au dernier relâchement', function () {
    const racine: any = { adoptedStyleSheets: [] }
    let constructions = 0
    const fab = () => { constructions++; return [{ offset: 0, opacity: 0 }, { offset: 1, opacity: 1 }] }
    µ.anim._mjs_acquireKeyframes('kf-cache', fab, racine)
    µ.anim._mjs_acquireKeyframes('kf-cache', fab, racine)
    assert.equal(constructions, 1)
    assert.equal(regles.length, 1)
    const feuille = racine.adoptedStyleSheets[0]
    µ.anim._mjs_releaseKeyframes('kf-cache', racine)
    assert.equal(feuille.cssRules.length, 1, 'encore une référence')
    µ.anim._mjs_releaseKeyframes('kf-cache', racine)
    assert.equal(feuille.cssRules.length, 0, 'plus aucune référence : règle retirée')
    µ.anim._mjs_acquireKeyframes('kf-cache', fab, racine)
    assert.equal(constructions, 2, 'après retrait, reconstruite')
  })
})
