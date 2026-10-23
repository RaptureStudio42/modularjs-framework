// {for} — ce que la liste affiche selon sa collection et ses clés. Un Set ou une Map n'affichait rien, sans un mot (la Map donne ses
// paires [clé, valeur], comme `for…of`). Avec des clés `by` en double, les lignes après le doublon recevaient un index décalé, et
// « supprimer » (`splice(i, 1)`) retirait l'élément caché au lieu de celui cliqué. La clé implicite d'un objet venait d'un compteur
// propre à chaque composant : deux composants qui affichent des objets communs donnaient la même clé à deux objets, et la ligne de
// l'un était réutilisée pour l'autre. Une clé `by` qui est un objet devenait « [object Object] » : une seule ligne affichée (un
// objet qui s'écrit lui-même, date ou tableau, reste reconnu par sa valeur). Enfin
// la clé de chaque élément était lue deux fois par passe.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const SOURCES: Record<string, string> = {
  'iter.mjs': `<script>
  $s = new Set(['a', 'b'])
  $m = new Map([['k1', 'x'], ['k2', 'y']])
</script>
<div class="s">{for v in $s}<i>{v}</i>{end}</div><div class="m">{for p in $m}<b>{p[0]}={p[1]}</b>{end}</div>
`,
  'doublons.mjs': `<script>
  $items = [{id: 1, n: 'a'}, {id: 1, n: 'b'}, {id: 2, n: 'c'}]
</script>
<div class="l">{for i, it in $items by id}<button class={'del ' + it.n} @click={$items.splice(i, 1)}>{it.n}:{i}</button>{end}</div>
`,
  'liste-impl.mjs': `<script>
  $list = []
</script>
<div class="l">{for it in $list}<p class="row">{it.n}</p>{end}</div>
`,
  'cle-objet.mjs': `<script>
  $items = []
</script>
<div class="l">{for it in $items by owner}<p>{it.n}</p>{end}</div>
`,
  'cles.mjs': `<script>
  $items = []
</script>
<div class="l">{for it in $items by id}<p>{it.n}</p>{end}</div>
`,
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('{for} — collections Set et Map, clés en double, clé implicite, clé objet, lecture des clés', function () {
  this.timeout(60000)
  let w: any
  const avertissements: string[] = []

  before(async () => {
    const root   = mjsTmp('for-collections-cles')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [f, s] of Object.entries(SOURCES)) writeFileSync(join(srcDir, f), s)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
    const code  = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    w = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
    w.console.warn = (...a: any[]) => avertissements.push(a.map(String).join(' '))
    w.console.error = (...a: any[]) => avertissements.push('erreur : ' + a.map(String).join(' '))
    w.eval(`${code}\nglobalThis.µ = µ;`)
  })

  after(async () => {
    w?.close?.()
    await terminateSharedWorkerPool()
  })

  beforeEach(() => { avertissements.length = 0 })

  async function monter(nom: string): Promise<any> {
    w.document.body.innerHTML = `<mjs-${nom}></mjs-${nom}>`
    const c = w.document.querySelector(`mjs-${nom}`)
    await pause(80)
    return c
  }

  it('un Set affiche ses éléments, une Map ses paires [clé, valeur]', async () => {
    const c = await monter('iter')
    assert.deepEqual([...c._shadow.querySelectorAll('.s i')].map((n: any) => n.textContent), ['a', 'b'])
    assert.deepEqual([...c._shadow.querySelectorAll('.m b')].map((n: any) => n.textContent), ['k1=x', 'k2=y'])
    // Set et Map de la page (même domaine que le composant)
    c._set('s', new w.Set(['c', 'a', 'b']))
    c._set('m', new w.Map([['k2', 'z']]))
    await pause(60)
    assert.deepEqual([...c._shadow.querySelectorAll('.s i')].map((n: any) => n.textContent), ['c', 'a', 'b'])
    assert.deepEqual([...c._shadow.querySelectorAll('.m b')].map((n: any) => n.textContent), ['k2=z'])
    assert.deepEqual(avertissements, [])
  })

  it('clés en double : chaque ligne reçoit son vrai rang, « supprimer » retire l\'élément cliqué', async () => {
    const c    = await monter('doublons')
    const lire = () => [...c._shadow.querySelectorAll('button')].map((b: any) => b.textContent)
    assert.deepEqual(lire(), ['a:0', 'c:2'])
    c._shadow.querySelector('button.c').click()
    await pause(80)
    assert.deepEqual(Array.from(c._state.items, (x: any) => x.n), ['a', 'b'])
    assert.deepEqual(lire(), ['a:0'])
  })

  it('clé implicite d\'un objet : unique pour toute la page, la ligne suit sa donnée', async () => {
    w.document.body.innerHTML = '<mjs-liste-impl id="p"></mjs-liste-impl><mjs-liste-impl id="q"></mjs-liste-impl>'
    const p = w.document.getElementById('p')
    const q = w.document.getElementById('q')
    await pause(80)
    const A = { n: 'A' }
    const B = { n: 'B' }
    p._set('list', [A, B])
    await pause(50)
    const N = { n: 'N' }
    q._set('list', [A, N])
    await pause(50)
    const tatouages = [A, B, N].map((o: any) => o._mjsId)
    assert.equal(new Set(tatouages).size, 3, `tatouages : ${tatouages}`)
    const lignesQ = () => [...q._shadow.querySelectorAll('.row')]
    const ligneA  = lignesQ().find((r: any) => r.textContent === 'A')
    q._set('list', [N, A])
    await pause(50)
    assert.deepEqual(lignesQ().map((r: any) => r.textContent), ['N', 'A'])
    assert.equal(ligneA.textContent, 'A')
  })

  it('clé `by` objet : chaque objet distinct garde sa ligne, aucun avertissement de doublon', async () => {
    const c  = await monter('cle-objet')
    const o1 = { nom: 'x' }
    const o2 = { nom: 'y' }
    const o3 = { nom: 'z' }
    c._set('items', [{ owner: o1, n: 'a' }, { owner: o2, n: 'b' }, { owner: o3, n: 'c' }])
    await pause(60)
    const lire = () => [...c._shadow.querySelectorAll('p')]
    assert.deepEqual(lire().map((n: any) => n.textContent), ['a', 'b', 'c'])
    const ligneB = lire()[1]
    c._set('items', [{ owner: o2, n: 'b2' }, { owner: o1, n: 'a' }])
    await pause(60)
    assert.deepEqual(lire().map((n: any) => n.textContent), ['b2', 'a'])
    assert.ok(lire()[0] === ligneB, 'la ligne de o2 est réutilisée')
    assert.deepEqual(avertissements, [])
  })

  it('clé `by` qui s\'écrit elle-même (date, tableau) : reconnue par sa valeur, comme avant', async () => {
    const c    = await monter('cle-objet')
    const lire = () => [...c._shadow.querySelectorAll('p')]
    c._set('items', [{ owner: new Date(1000), n: 'd' }, { owner: [1, 2], n: 't' }])
    await pause(60)
    const [ligneD, ligneT] = lire()
    // objets neufs, mêmes valeurs : les lignes sont reprises
    c._set('items', [{ owner: [1, 2], n: 't2' }, { owner: new Date(1000), n: 'd2' }])
    await pause(60)
    assert.deepEqual(lire().map((n: any) => n.textContent), ['t2', 'd2'])
    assert.ok(lire()[0] === ligneT, 'la ligne de t est reprise')
    assert.ok(lire()[1] === ligneD, 'la ligne de d est reprise')
    assert.deepEqual(avertissements, [])
  })

  it('la clé de chaque élément est lue une seule fois par passe', async () => {
    const c = await monter('cles')
    w.globalThis.__k = 0
    const arr = Array.from({ length: 100 }, (_: any, i: number) => ({ get id() { w.globalThis.__k++; return i }, n: 'x' + i }))
    c._set('items', arr)
    await pause(40)
    const creation = w.globalThis.__k
    w.globalThis.__k = 0
    c._state.items[5].n = 'y'
    await pause(40)
    const maj = w.globalThis.__k
    w.globalThis.__k = 0
    const a = c._state.items.slice()
    const t = a[1]
    a[1]  = a[98]
    a[98] = t
    c._set('items', a)
    await pause(40)
    const echange = w.globalThis.__k
    assert.deepEqual({ creation, maj, echange }, { creation: 100, maj: 100, echange: 100 })
    assert.equal(c._shadow.querySelectorAll('p')[5].textContent, 'y')
    assert.equal(c._shadow.querySelectorAll('p')[1].textContent, 'x98')
  })
})
