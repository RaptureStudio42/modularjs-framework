// `µraw(liste, true)` ne coûte rien par ligne : un appel, une marque et une note pour toute la liste ; aucune marque posée ni cherchée
// pour une ligne — à la création, à la revue, quand une ligne sur dix change —, à 1 000 comme à 10 000 lignes. Marquer chaque ligne
// une à une : un appel et une marque par ligne, puis une recherche par ligne à sa première revue. Et la note ne retient rien : liste
// remplacée cent fois puis vidée, les listes et leurs lignes partent au ramasse-miettes (liens faibles, ramassage forcé).
// Des opérations comptées, aucun temps mesuré. MJS_COMPTES=<fichier> : les comptes y sont écrits en JSON

import assert from 'node:assert/strict'
import v8 from 'node:v8'
import { writeFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote, pause } from './helpers/coeur-monter.js'

// un ramasse-miettes complet, sans lancer node avec --expose-gc : le drapeau n'est levé que le temps de prendre la fonction
function collectGarbage(): void {
  v8.setFlagsFromString('--expose-gc')
  const gc = runInNewContext('gc')
  v8.setFlagsFromString('--no-expose-gc')
  gc()
}

const HOST = `<script lang="js">
  $data = µ.raw([]);
  $selected = -1;
  @fill = function(a) { $data = a; };
  @select = function(id) { $selected = id; };
</script>
<table><tbody>{for row in $data by id}<tr :class{$selected === row.id}="danger"><td class="id">{row.id}</td><td class="lab"><a @click={@select(row.id)}>{row.label}</a></td></tr>{end}</tbody></table>
`

type Mode   = 'rows' | 'list'
type Counts = { raw: number, mark: number, note: number, sought: number }

describe('µraw(liste, true) — rien par ligne, rien de retenu', function () {
  this.timeout(300000)
  let window: any, host: any, µ: any
  const n: Counts = { raw: 0, mark: 0, note: 0, sought: 0 }
  const counts: Record<string, Record<string, Counts>> = {}
  const heap: Record<string, Record<string, number>>   = {}

  before(async () => {
    ({ window, hote: host } = await monterHote(HOST, 'raw-liste-comptes'))
    µ = window.µ
    // appels de µraw, marques posées (`µ._mjs_rawSet.add`), notes posées (`µ._mjs_rawRows.add`), marques cherchées pour autre chose
    // qu'une liste (`µ._mjs_rawSet.has` d'une ligne)
    const raw   = µ.raw
    µ.raw       = function(...x: any[]) { n.raw++; return raw.apply(this, x) }
    const marks = µ._mjs_rawSet
    const add   = marks.add
    const has   = marks.has
    marks.add   = function(x: any) { n.mark++; return add.call(this, x) }
    marks.has   = function(x: any) { if (!Array.isArray(x)) n.sought++; return has.call(this, x) }
    const notes = µ._mjs_rawRows
    if (notes) {
      const note = notes.add
      notes.add  = function(x: any) { n.note++; return note.call(this, x) }
    }
  })
  after(async () => {
    if (process.env.MJS_COMPTES) writeFileSync(process.env.MJS_COMPTES, JSON.stringify({ counts, heap }, null, 1) + '\n')
    await terminateSharedWorkerPool()
  })

  const tick  = async () => { await pause(0); await pause(0) }
  const shown = () => host._shadow.querySelectorAll('tbody > tr').length
  let nextId  = 1
  const item  = (mode: Mode, label: string) => mode === 'rows' ? µ.raw({ id: nextId++, label }) : { id: nextId++, label }
  const mark  = (mode: Mode, a: any[]) => mode === 'rows' ? µ.raw(a) : µ.raw(a, true)
  // un geste, et ce qu'il a coûté
  const count = async (f: () => void): Promise<Counts> => {
    n.raw = n.mark = n.note = n.sought = 0
    f()
    await tick()
    return { ...n }
  }
  // créer, revoir (les mêmes objets, tableau neuf), revoir encore, changer une ligne sur dix (objets neufs), vider
  const play = async (mode: Mode, size: number): Promise<Record<string, Counts>> => {
    const seen: Record<string, Counts> = {}
    let cur: any[] = []
    seen.create = await count(() => { cur = mark(mode, Array.from({ length: size }, (_, i) => item(mode, 'L' + i))); host.fill(cur) })
    assert.equal(shown(), size)
    seen.review  = await count(() => { cur = mark(mode, cur.slice()); host.fill(cur) })
    seen.review2 = await count(() => { cur = mark(mode, cur.slice()); host.fill(cur) })
    seen.update  = await count(() => { cur = mark(mode, cur.map((r, i) => i % 10 === 0 ? (mode === 'rows' ? µ.raw({ id: r.id, label: r.label + ' !!!' }) : { id: r.id, label: r.label + ' !!!' }) : r)); host.fill(cur) })
    assert.equal(host._shadow.querySelector('tbody > tr .lab').textContent, 'L0 !!!')
    seen.clear   = await count(() => { cur = mark(mode, []); host.fill(cur) })
    assert.equal(shown(), 0)
    return seen
  }

  for (const size of [1000, 10000]) {
    it(`${size} lignes, liste marquée avec \`true\` : un appel, une marque et une note par liste, rien par ligne`, async () => {
      const seen = counts['list-' + size] = await play('list', size)
      for (const [gesture, c] of Object.entries(seen)) assert.deepEqual(c, { raw: 1, mark: 1, note: 1, sought: 0 }, `${gesture}, ${size} lignes`)
    })

    it(`${size} lignes marquées une à une : un appel et une marque par ligne, une recherche par ligne à la première revue`, async () => {
      const seen = counts['rows-' + size] = await play('rows', size)
      assert.deepEqual(seen.create, { raw: size + 1, mark: size + 1, note: 0, sought: 0 }, 'créer')
      assert.deepEqual(seen.review, { raw: 1, mark: 1, note: 0, sought: size }, 'première revue')
      assert.deepEqual(seen.review2, { raw: 1, mark: 1, note: 0, sought: 0 }, 'seconde revue')
      assert.deepEqual(seen.update, { raw: size / 10 + 1, mark: size / 10 + 1, note: 0, sought: 0 }, 'une ligne sur dix')
      assert.deepEqual(seen.clear, { raw: 1, mark: 1, note: 0, sought: 0 }, 'vider')
    })
  }

  // objets encore en mémoire après ramassage ; les ramassages s'arrêtent dès que le compte attendu est atteint, vingt au plus
  const alive = async (refs: WeakRef<object>[], expected: number): Promise<number> => {
    let left = refs.length
    for (let i = 0; i < 20; i++) {
      await pause(10)
      collectGarbage()
      left = refs.filter((r) => r.deref() !== undefined).length
      if (left === expected) break
    }
    return left
  }
  // cent listes de cinquante lignes posées l'une après l'autre, puis la liste vidée : ce qui reste en mémoire à chaque étape
  const replace = async (mode: Mode): Promise<Record<string, number>> => {
    const lists: WeakRef<object>[] = []
    const rows: WeakRef<object>[]  = []
    let last: WeakRef<object>[]    = []
    for (let g = 0; g < 100; g++) {
      const a = Array.from({ length: 50 }, (_, i) => { const o = { id: i + 1, label: 'g' + g, load: new Array(20).fill(g) }; return mode === 'rows' ? µ.raw(o) : o })
      host.fill(mark(mode, a))
      await tick()
      last = a.map((r) => new WeakRef(r))
      if (g < 99) {
        lists.push(new WeakRef(a))
        rows.push(...last)
      }
    }
    assert.equal(shown(), 50)
    const seen: Record<string, number> = { lists: await alive(lists, 0), rows: await alive(rows, 0), displayed: await alive(last, 50) }
    host.fill(mark(mode, []))
    await tick()
    assert.equal(shown(), 0)
    seen.emptied = await alive(last, 0)
    return seen
  }

  it('liste remplacée cent fois puis vidée : ni les listes ni leurs lignes ne restent, rien de plus que ligne à ligne', async () => {
    const list = heap.list = await replace('list')
    const rows = heap.rows = await replace('rows')
    assert.equal(list.lists, 0, 'listes remplacées : encore en mémoire')
    assert.equal(list.rows, 0, 'lignes des listes remplacées : encore en mémoire')
    assert.equal(list.displayed, 50, 'témoin : la liste affichée reste tenue par ses lignes')
    assert.ok(list.emptied <= rows.emptied, `liste vidée : ${list.emptied} lignes encore en mémoire, contre ${rows.emptied} ligne à ligne`)
  })
})
