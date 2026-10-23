// une liste `{for}` à clé qui se réordonne garde, derrière chaque ligne, le frère qu'un effet a posé à côté de sa
// balise : la copie de *reflect(blur: 2) (happy-dom n'a ni reflet natif ni -moz-element : l'effet copie la balise),
// la bulle d'un refus de *guard. La liste ne déplace que les nœuds de la ligne ; le frère se replace tout seul
// à côté de sa balise quand elle bouge, sans jamais se perdre, se doubler, ni se disputer la place avec le frère
// d'un autre effet posé sur la même balise.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const EFFET = '*reflect(blur: 2)'
const GARDE = 'type="number" min="1" max="10" aria-label="nombre" *guard(delay: 0, duration: 30s)'
const ID3   = '[{id: 1}, {id: 2}, {id: 3}]'

const COMPOSANTS: Record<string, string> = {
  'fx-ordre-cle':   `<script>\n$l = ${ID3}\n</script>\n<div class="p">{for r in $l by id}<p class="row" ${EFFET}>{r.id}</p>{end}</div>`,
  'fx-ordre-multi': `<script>\n$l = ${ID3}\n</script>\n<div class="p">{for r in $l by id}<p class="row" ${EFFET}>{r.id}</p><i class="suite">fin</i>{end}</div>`,
  'fx-ordre-queue': `<script>\n$l = ${ID3}\n</script>\n<div class="p">{for r in $l by id}<i class="tete">t</i><p class="row" ${EFFET}>{r.id}</p>{end}</div>`,
  'fx-ordre-garde': `<script>\n$l = ${ID3}\n</script>\n<div class="p">{for r in $l by id}<input class="row" ${GARDE}>{end}</div>`,
  'fx-ordre-deux':  `<script>\n$l = ${ID3}\n</script>\n<div class="p">{for r in $l by id}<input class="row" ${GARDE} ${EFFET}>{end}</div>`,
}

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms))

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const couche = (c: any) => c.getAttribute('mjs-fx-layer') ? 'calque' : c.hasAttribute('mjs-fx-guard-tip') ? 'bulle' : ''

// les balises d'un parent, groupées : chaque balise de ligne suivie des frères d'effet posés derrière elle, dans
// l'ordre alphabétique (deux effets sur la même balise : l'ordre entre leurs frères ne compte pas)
const groupes = (parent: any) => {
  const g: { tete: string, freres: string[] }[] = []
  for (const c of Array.from(parent.children) as any[]) {
    const l = couche(c)
    if (l) {
      if (g.length === 0) g.push({ tete: '^', freres: [] })
      g[g.length - 1].freres.push(l)
    }
    else g.push({ tete: c.getAttribute('data-nom') ?? (c.textContent || c.localName), freres: [] })
  }
  return g.map((x) => x.tete + '[' + x.freres.sort().join(',') + ']').join(' ')
}

describe('{for} à clé — un frère d\'effet suit sa balise quand la liste se réordonne', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('for-reordonne-freres')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, src] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), src)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  async function monter(tag: string) {
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const comp = window.document.querySelector(tag)
    await attendre(() => (comp._shadow?.querySelectorAll('.p .row:not([mjs-fx-layer])').length ?? 0) === 3)
    await pause(60)
    return comp
  }

  const poser   = async (comp: any, ids: number[]) => {
    comp._set('l', ids.map((id) => ({ id })))
    await pause(100)
  }
  const parent  = (comp: any) => comp._shadow.querySelector('.p')
  const actifs  = (comp: any) => comp._shadow.querySelectorAll('[mjs-fx]').length
  const copies  = (comp: any) => comp._shadow.querySelectorAll('[mjs-fx-layer]').length
  const ranger  = (comp: any) => {
    const noms = ['un', 'deux', 'trois']
    Array.from(comp._shadow.querySelectorAll('.row:not([mjs-fx-layer])')).forEach((c: any, i: number) => c.setAttribute('data-nom', noms[i]))
  }

  it('au départ : chaque ligne est suivie de sa copie', async () => {
    const comp = await monter('mjs-fx-ordre-cle')
    assert.equal(groupes(parent(comp)), '1[calque] 2[calque] 3[calque]')
  })

  it('les lignes inversées : chaque copie suit sa ligne, aucune ne reste groupée derrière', async () => {
    const comp = await monter('mjs-fx-ordre-cle')
    await poser(comp, [3, 2, 1])
    assert.equal(groupes(parent(comp)), '3[calque] 2[calque] 1[calque]')
    assert.equal(copies(comp), 3, 'trois copies, ni perdue ni en double')
    assert.equal(actifs(comp), 3, 'un effet par ligne')
  })

  it('chaque copie est celle de sa ligne : la même copie qu\'avant, juste derrière sa ligne', async () => {
    const comp = await monter('mjs-fx-ordre-cle')
    const avant = new Map<string, any>()
    for (const l of Array.from(comp._shadow.querySelectorAll('.row:not([mjs-fx-layer])')) as any[]) avant.set(l.textContent, l.nextElementSibling)
    await poser(comp, [2, 3, 1])
    const lignes = Array.from(comp._shadow.querySelectorAll('.row:not([mjs-fx-layer])')) as any[]
    assert.equal(lignes.map((l) => l.textContent).join(','), '2,3,1')
    for (const l of lignes) {
      assert.ok(l.nextElementSibling === avant.get(l.textContent), 'la copie de la ligne ' + l.textContent + ' est celle d\'avant, et elle la suit')
    }
  })

  it('une ligne déplacée seule, un ajout en tête, des permutations successives : l\'ordre est toujours juste', async () => {
    const comp = await monter('mjs-fx-ordre-cle')
    const cas: Array<[number[], string]> = [
      [[2, 3, 1], '2[calque] 3[calque] 1[calque]'],
      [[1, 3, 2], '1[calque] 3[calque] 2[calque]'],
      [[3, 1, 2], '3[calque] 1[calque] 2[calque]'],
      [[4, 3, 1, 2], '4[calque] 3[calque] 1[calque] 2[calque]'],
      [[1, 2, 3, 4], '1[calque] 2[calque] 3[calque] 4[calque]'],
    ]
    for (const [ids, attendu] of cas) {
      await poser(comp, ids)
      assert.equal(groupes(parent(comp)), attendu, 'ordre ' + ids.join(','))
    }
    assert.equal(copies(comp), 4, 'quatre copies, ni perdue ni en double')
    assert.equal(actifs(comp), 4, 'un effet par ligne')
  })

  it('après un réordonnancement : une ligne retirée emporte sa copie, une liste vidée emporte tout', async () => {
    const comp = await monter('mjs-fx-ordre-cle')
    await poser(comp, [3, 2, 1])
    await poser(comp, [3, 1])
    assert.equal(groupes(parent(comp)), '3[calque] 1[calque]', 'la ligne 2 est partie avec sa copie')
    await poser(comp, [])
    assert.equal(parent(comp).children.length, 0, 'liste vide : plus aucune balise')
    assert.equal(actifs(comp), 0, 'plus aucun effet actif')
    await poser(comp, [2, 1])
    assert.equal(groupes(parent(comp)), '2[calque] 1[calque]', 'rouverte : une seule copie par ligne')
  })

  it('lignes à deux balises, l\'effet sur la première : la copie reste entre les deux, la ligne entière bouge', async () => {
    const comp = await monter('mjs-fx-ordre-multi')
    await poser(comp, [3, 2, 1])
    const noms = Array.from(parent(comp).children).map((c: any) => couche(c) || c.localName + '.' + c.getAttribute('class')).join(' ')
    assert.equal(noms, ['p.row calque i.suite', 'p.row calque i.suite', 'p.row calque i.suite'].join(' '))
    assert.equal(Array.from(comp._shadow.querySelectorAll('.row:not([mjs-fx-layer])')).map((c: any) => c.textContent).join(','), '3,2,1')
  })

  it('lignes à deux balises, l\'effet sur la dernière : la copie quitte la ligne avec elle, derrière sa balise', async () => {
    const comp = await monter('mjs-fx-ordre-queue')
    await poser(comp, [3, 2, 1])
    const noms = Array.from(parent(comp).children).map((c: any) => couche(c) || c.localName + '.' + c.getAttribute('class')).join(' ')
    assert.equal(noms, ['i.tete p.row calque', 'i.tete p.row calque', 'i.tete p.row calque'].join(' '))
    assert.equal(Array.from(comp._shadow.querySelectorAll('.row:not([mjs-fx-layer])')).map((c: any) => c.textContent).join(','), '3,2,1')
  })

  it('*guard : la bulle du refus suit son champ quand la liste se réordonne', async () => {
    const comp = await monter('mjs-fx-ordre-garde')
    ranger(comp)
    const premier = comp._shadow.querySelector('.row:not([mjs-fx-layer])')
    premier.value = '99'
    premier.dispatchEvent(new window.Event('input', { bubbles: true, composed: true }))
    assert.equal(groupes(parent(comp)), 'un[bulle] deux[] trois[]', 'une valeur refusée : une bulle derrière le premier champ')
    await poser(comp, [2, 3, 1])
    assert.equal(groupes(parent(comp)), 'deux[] trois[] un[bulle]', 'le premier champ passe en dernier, sa bulle avec lui')
    await poser(comp, [1, 2, 3])
    assert.equal(groupes(parent(comp)), 'un[bulle] deux[] trois[]', 'et revient en tête avec elle')
    assert.equal(comp._shadow.querySelectorAll('[mjs-fx-guard-tip]').length, 1, 'une seule bulle')
  })

  it('deux effets qui posent un frère sur la même balise (*guard et *reflect) : chacun reste juste derrière elle, sans se disputer la place', async () => {
    const comp = await monter('mjs-fx-ordre-deux')
    ranger(comp)
    const premier = comp._shadow.querySelector('.row:not([mjs-fx-layer])')
    premier.value = '99'
    premier.dispatchEvent(new window.Event('input', { bubbles: true, composed: true }))
    assert.equal(groupes(parent(comp)), 'un[bulle,calque] deux[calque] trois[calque]', 'au départ')
    await poser(comp, [2, 3, 1])
    assert.equal(groupes(parent(comp)), 'deux[calque] trois[calque] un[bulle,calque]', 'la copie et la bulle ont suivi leur champ')
    await poser(comp, [3, 1, 2])
    assert.equal(groupes(parent(comp)), 'trois[calque] un[bulle,calque] deux[calque]', 'une seconde permutation, sans boucle')
    assert.equal(copies(comp), 3, 'trois copies')
  })
})
