// Types — une méthode appelée sur une liste typée (push, unshift, splice, pop, shift, sort, reverse)
// ne contrôle que ce qu'elle change : les éléments ajoutés et le nombre d'éléments. La liste entière
// n'est ni recopiée ni revérifiée à chaque appel — un fil de messages typé qui en reçoit deux mille
// un par un ne gèle plus la page. Mêmes règles qu'avant : conversions écrites, refus défait (la
// liste revient exactement à son état d'avant), messages de développement qui nomment l'élément.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const LISTES = [
  '<vars>',
  '  $notes     int 0..100[]',
  '  $messages  { id: int, t: string }[]',
  '  $tags      string[] 1..3',
  '</vars>',
  '',
  '<script>',
  '$notes    = []',
  '$messages = []',
  "$tags     = ['a']",
  '@remplir = (n) ->',
  '  i = 0',
  '  while i < n',
  "    $messages.push({ id: i, t: 'm' })",
  '    i++',
  '  return',
  '@noter = (n) ->',
  '  i = 0',
  '  while i < n',
  '    $notes.push(i % 101)',
  '    i++',
  '  return',
  '@noter1 = (v) -> $notes.push(v)',
  '@ajouter = (m) -> $messages.push(m)',
  '@devant = (m) -> $messages.unshift(m)',
  '@renommer = (k, v) -> $messages[k].id = v',
  "@remplacer = -> $tags.splice(0, 1, 'b', 7)",
  "@inserer = -> $tags.splice(1, 0, 'x', 'y')",
  "@couper = -> $tags.splice(0, 5)",
  '@retirer = -> $tags.pop()',
  '@premier = -> $tags.shift()',
  '@trier = -> $tags.sort()',
  '@inverser = -> $tags.reverse()',
  "@vider = -> $tags = ['a']",
  '</script>',
  '',
  '<p class="n">{$messages.length}</p>',
].join('\n')

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('types — méthodes d\'une liste typée : seul ce qui change est contrôlé', function () {
  this.timeout(120000)
  let window: any
  const dits: string[] = []

  before(async () => {
    const root   = mjsTmp('types-listes-methodes')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'listes.mjs'), LISTES)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ; µ._typesMode = 'warn';`)
    window.µ.warn = (...a: any[]) => { dits.push(a.join(' ')) }
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  async function monter() {
    window.document.body.innerHTML = '<mjs-listes></mjs-listes>'
    const comp = window.document.querySelector('mjs-listes')
    await attendre(() => !!comp._shadow?.querySelector('.n'))
    dits.length = 0
    return comp
  }

  const brut = (comp: any, k: string) => [...window.µ._mjs_toRaw(comp._state[k])]

  it('1 500 objets ajoutés un par un : autant d\'inscriptions au registre que d\'éléments, pas leur carré', async () => {
    const comp  = await monter()
    const Carte = window.WeakMap
    const set0  = Carte.prototype.set
    let n = 0
    Carte.prototype.set = function (this: any, k: any, v: any) { n++; return set0.call(this, k, v) }
    const t0 = Date.now()
    try {
      comp.remplir(1500)
    }
    finally {
      Carte.prototype.set = set0
    }
    const ms = Date.now() - t0
    assert.equal(brut(comp, 'messages').length, 1500)
    assert.ok(n < 15000, 'inscriptions au registre : ' + n)
    assert.ok(ms < 3000, 'durée : ' + ms + ' ms')
  })

  it('4 000 notes ajoutées une par une : une fraction de seconde', async () => {
    const comp = await monter()
    const t0   = Date.now()
    comp.noter(4000)
    const ms   = Date.now() - t0
    assert.equal(brut(comp, 'notes').length, 4000)
    assert.ok(ms < 1500, 'durée : ' + ms + ' ms')
  })

  it('push : chaque élément ajouté est converti ; un élément refusé défait l\'ajout et le message le nomme', async () => {
    const comp = await monter()
    comp.remplir(2)
    comp.noter1('42')
    assert.deepEqual(brut(comp, 'notes'), [42])
    comp.ajouter({ id: '7', t: 5 })
    assert.deepEqual(brut(comp, 'messages')[2], { id: 7, t: '5' })
    comp.ajouter({ id: 'x', t: 'y' })
    assert.equal(brut(comp, 'messages').length, 3, 'l\'élément refusé n\'est pas ajouté')
    assert.ok(dits.some((d) => d.includes("$messages[3].id refuse 'x'")), dits.join('\n'))
    comp.noter1(150)
    assert.deepEqual(brut(comp, 'notes'), [42, 100], 'ramené dans sa plage')
    assert.ok(dits.some((d) => d.includes('$notes[1] : 150 ramené à 100')), dits.join('\n'))
  })

  it('un objet ajouté par push suit sa règle ensuite : une écriture dans un de ses champs est contrôlée', async () => {
    const comp = await monter()
    comp.remplir(3)
    comp.renommer(2, '12')
    assert.equal(brut(comp, 'messages')[2].id, 12, 'converti')
    comp.renommer(2, 'zz')
    assert.equal(brut(comp, 'messages')[2].id, 12, 'refusé')
    assert.ok(dits.some((d) => d.includes("$messages[2].id refuse 'zz'")), dits.join('\n'))
  })

  it('unshift : les éléments décalés gardent un chemin juste dans les messages', async () => {
    const comp = await monter()
    comp.remplir(3)
    comp.devant({ id: 99, t: 'neuf' })
    comp.devant({ id: 98, t: 'neuf' })
    comp.renommer(4, 'zz')
    assert.ok(dits.some((d) => d.includes("$messages[4].id refuse 'zz'")), dits.join('\n'))
    comp.renommer(0, 'yy')
    assert.ok(dits.some((d) => d.includes("$messages[0].id refuse 'yy'")), dits.join('\n'))
  })

  it('splice : ajouts convertis ; trop d\'éléments ou trop peu, la liste revient exactement à son état d\'avant', async () => {
    const comp = await monter()
    comp.vider()
    comp.remplacer()
    assert.deepEqual(brut(comp, 'tags'), ['b', '7'])
    comp.inserer()
    assert.deepEqual(brut(comp, 'tags'), ['b', '7'], 'quatre éléments : au-delà de 3')
    comp.couper()
    assert.deepEqual(brut(comp, 'tags'), ['b', '7'], 'zéro élément : en deçà de 1')
  })

  it('pop, shift : en deçà du minimum, l\'élément retiré revient à sa place', async () => {
    const comp = await monter()
    comp.vider()
    comp.retirer()
    assert.deepEqual(brut(comp, 'tags'), ['a'])
    comp.premier()
    assert.deepEqual(brut(comp, 'tags'), ['a'])
    comp.remplacer()
    comp.premier()
    assert.deepEqual(brut(comp, 'tags'), ['7'])
  })

  it('sort, reverse : mêmes éléments, rien à refuser', async () => {
    const comp = await monter()
    comp.vider()
    comp.remplacer()
    comp.trier()
    assert.deepEqual(brut(comp, 'tags'), ['7', 'b'])
    comp.inverser()
    assert.deepEqual(brut(comp, 'tags'), ['b', '7'])
  })

  it('mode erreur : une valeur ramenée arrête l\'ajout — l\'erreur part, la liste reste telle qu\'avant', async () => {
    const comp = await monter()
    comp.noter1(5)
    window.µ._typesMode = 'error'
    try {
      assert.throws(() => comp.noter1(150), /150/)
    }
    finally {
      window.µ._typesMode = 'warn'
    }
    assert.deepEqual(brut(comp, 'notes'), [5])
  })
})
