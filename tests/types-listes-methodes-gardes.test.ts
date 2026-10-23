// Types — les méthodes d'une liste typée, ce que le contrôle défait ou lit de travers : un unshift refusé
// (ou ramené, en mode erreur) laisse la liste telle qu'avant ; l'indice de départ d'un splice se lit comme
// le fait la liste elle-même (partie entière, négatif compté depuis la fin, texte, vide) ; une liste de
// store typé garde la voie rapide — ses éléments reçus un par un ne la font pas revérifier en entier.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { makeMu, composant, appeler } from './helpers/types-runtime.js'

describe('types — unshift refusé ou ramené : la liste revient exactement à son état d’avant', () => {
  function messages(mode: 'warn' | 'error') {
    const µ  = makeMu(mode)
    const el = composant({ messages: '{ id: int, t: string }[]' })
    const a  = { id: 0, t: 'a' }
    const b  = { id: 1, t: 'b' }
    const l  = [a, b]
    µ._mjs_tset(el, 'messages', l)
    return { µ, el, reg: el._mjs_treg, l, a, b }
  }

  it('un élément refusé : rien n’est ajouté, les autres restent à leur place, le message nomme l’élément', () => {
    const m = messages('warn')
    assert.equal(appeler(m.µ, m.el, m.reg, m.l, 'unshift', { id: 'x', t: 'y' }), false)
    assert.equal(m.l.length, 2)
    assert.ok(m.l[0] === m.a && m.l[1] === m.b, 'les éléments d’avant, chacun à sa place')
    assert.ok(m.µ.warnings[0].startsWith('[ModularJS] $messages[0].id refuse \'x\''), m.µ.warnings.join(' | '))
    assert.equal(appeler(m.µ, m.el, m.reg, m.l, 'unshift', { id: 2, t: 'c' }), true, 'la liste reste utilisable')
    assert.deepEqual(m.l.map((o: any) => o.id), [2, 0, 1])
  })

  it('plusieurs éléments dont un refusé : aucun n’est ajouté', () => {
    const m = messages('warn')
    assert.equal(appeler(m.µ, m.el, m.reg, m.l, 'unshift', { id: 2, t: 'c' }, { id: 'x', t: 'y' }, { id: 4, t: 'e' }), false)
    assert.equal(m.l.length, 2)
    assert.ok(m.l[0] === m.a && m.l[1] === m.b, 'les éléments d’avant, chacun à sa place')
    assert.ok(m.µ.warnings[0].startsWith('[ModularJS] $messages[1].id refuse \'x\''), m.µ.warnings.join(' | '))
  })

  it('une valeur ramenée dans sa plage : écrite ramenée, et le message la nomme', () => {
    const µ  = makeMu('warn')
    const el = composant({ notes: 'int 0..100[]' })
    const l  = [5]
    µ._mjs_tset(el, 'notes', l)
    assert.equal(appeler(µ, el, el._mjs_treg, l, 'unshift', 150), true)
    assert.deepEqual(l, [100, 5])
    assert.ok(µ.warnings[0].startsWith('[ModularJS] $notes[0] : 150 ramené à 100'), µ.warnings.join(' | '))
  })

  it('mode erreur, une valeur ramenée : l’erreur part, la liste est telle qu’avant (un élément, ou plusieurs)', () => {
    const µ  = makeMu('error')
    const el = composant({ notes: 'int 0..100[]' })
    const l  = [5]
    µ._mjs_tset(el, 'notes', l)
    assert.throws(() => appeler(µ, el, el._mjs_treg, l, 'unshift', 150), /150/)
    assert.deepEqual(l, [5])
    assert.throws(() => appeler(µ, el, el._mjs_treg, l, 'unshift', 1, 2, 150), /150/)
    assert.deepEqual(l, [5])
  })
})

describe('types — splice : l’indice de départ se lit comme le fait la liste', () => {
  const DEPARTS: any[] = [0, 1, 2, 3, 7, -1, -2, -3, -9, 0.5, 1.5, 2.9, -0.5, -1.5, -2.9, '1', ' 2 ', '-1', '1.5', NaN, undefined, null, true, Infinity, -Infinity, 'abc']
  const GESTES: [number, string[]][] = [[0, ['x']], [1, ['x']], [2, ['x', 'y']]]

  it('un départ à virgule, négatif, texte, vide ou infini : la liste est celle qu’un tableau ordinaire donne', () => {
    const µ = makeMu('warn')
    for (const depart of DEPARTS) {
      for (const [retires, ajoutes] of GESTES) {
        const el  = composant({ tags: 'string[]' })
        const l: any[] = ['a', 'b', 'c']
        µ._mjs_tset(el, 'tags', l)
        const ref = l.slice()
        ref.splice(depart, retires, ...ajoutes)
        const geste = 'splice(' + String(depart) + ', ' + retires + ', ' + ajoutes.map((x) => "'" + x + "'").join(', ') + ')'
        µ.warnings.length = 0
        assert.equal(appeler(µ, el, el._mjs_treg, l, 'splice', depart, retires, ...ajoutes), true, geste + ' : gardé')
        assert.deepEqual(l, ref, geste + ' : la liste d’un tableau ordinaire')
        assert.deepEqual(µ.warnings, [], geste + ' : aucun message')
      }
    }
  })

  it('un ajout refusé à un départ à virgule : la liste revient exactement à son état d’avant', () => {
    const µ  = makeMu('warn')
    const el = composant({ tags: 'string[]' })
    const l: any[] = ['a', 'b', 'c']
    µ._mjs_tset(el, 'tags', l)
    assert.equal(appeler(µ, el, el._mjs_treg, l, 'splice', 1.5, 1, null), false)
    assert.deepEqual(l, ['a', 'b', 'c'])
    assert.ok(µ.warnings[0].startsWith('[ModularJS] $tags[1] refuse null'), µ.warnings.join(' | '))
  })
})

// une liste de store reçoit ses éléments un par un par `µ._mjs_storeDeepCall` : le store garde la voie
// rapide des méthodes, il ne recopie ni ne revérifie la liste entière à chaque élément reçu
const FLUX = [
  '<vars>',
  '  $$flux  { id: int, t: string }[]',
  '</vars>',
  '',
  '<script>',
  '$$flux = []',
  '@remplir = (n) ->',
  '  i = 0',
  '  while i < n',
  "    $$flux.push({ id: i, t: 'm' })",
  '    i++',
  '  return',
  '</script>',
  '',
  '<p class="n">{$$flux.length}</p>',
].join('\n')

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('types — une liste de store typé garde la voie rapide des méthodes', function () {
  this.timeout(120000)
  let window: any

  before(async () => {
    const root   = mjsTmp('types-listes-store')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'flux.mjs'), FLUX)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ; µ._typesMode = 'warn';`)
    window.µ.warn = () => {}
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  it('500 objets ajoutés un par un : autant d’inscriptions au registre que d’éléments, pas leur carré', async () => {
    window.document.body.innerHTML = '<mjs-flux></mjs-flux>'
    const comp = window.document.querySelector('mjs-flux')
    await attendre(() => !!comp._shadow?.querySelector('.n'))
    const Carte = window.WeakMap
    const set0  = Carte.prototype.set
    let n = 0
    Carte.prototype.set = function (this: any, k: any, v: any) { n++; return set0.call(this, k, v) }
    try {
      comp.remplir(500)
    }
    finally {
      Carte.prototype.set = set0
    }
    assert.equal(window.µ._mjs_storeRaw.flux.length, 500)
    assert.ok(n < 5000, 'inscriptions au registre : ' + n)
  })
})
