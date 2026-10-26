// magasin `$$` : le paramètre d'un rappel appelé sur un objet du magasin (`forEach`, `map`, `filter`, `some`, `every`,
// `flatMap`, `find`, `findLast`, `findIndex`, `findLastIndex`, l'élément de `reduce` / `reduceRight`, le `forEach` d'une
// Map ou d'un Set, un rappel sur une copie) et la variable d'une boucle sur une copie qui garde les mêmes objets
// (`filter`, `slice`, `concat`, `toSorted`, `toReversed`, `Object.values`, `Object.entries`, `Array.from`, `[...l]`,
// `values()` d'une Map, la Map elle-même, une variable qui tient la copie), comme l'élément d'une copie
// (`$$l.filter(f)[0]`), écrivent par l'aide gardée : une clé `'__proto__'` venue de données ne pollue pas
// `Object.prototype`, l'avertissement nomme le segment en développement, et une écriture permise redessine la vue en
// prévenant la clé du store d'où viennent les objets. De même l'élément d'une copie atteint par `find`, `findLast`, `at`,
// `pop` ou `shift` (`$$l.filter(f).find(g)`, `copie.pop()`, `while (t = copie.shift())`), le rappel de `Array.from($$l, f)`,
// de `Array.prototype.forEach.call($$l, f)` et d'une méthode écrite en clé littérale (`$$l['forEach'](f)`). Civet, CoffeeScript et JavaScript, composant et module `.civet` /
// `.coffee` importé, développement et production. Témoins : un objet neuf fait dans le rappel, une copie profonde, une
// copie écrite elle-même, un rappel sur une liste hors du magasin et un rappel qui n'écrit rien ne changent rien

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { applyPathTracking } from '../src/generator/path-tracker.js'
import { mjsTmp } from './helpers/tmp.js'

const AIDES_CIVET = `export rappelModule = (s, k) ->
  $$liste.forEach((t) -> t[s][k] = 1)
  return

export copieModule = (s, k) ->
  for t of $$liste.filter((x) -> x.id > 0)
    t[s][k] = 1
  return

export cocherModule = ->
  $$liste.forEach((t) -> t.m = 9)
  return

export trouveModule = (s, k) ->
  $$liste.filter((x) -> x.id > 0).find((x) -> x.id == 1)[s][k] = 1
  return
`

const CIVET = `@import rappelModule 'garde-rappel-aides.civet'
@import copieModule 'garde-rappel-aides.civet'
@import cocherModule 'garde-rappel-aides.civet'
@import trouveModule 'garde-rappel-aides.civet'

<script>
  $$prefs = { a: { x: 1 }, b: { x: 2 } }
  $$liste = [{ id: 1, fait: false, vu: false, n: 0, m: 0 }, { id: 2, fait: false, vu: false, n: 0, m: 0 }]
  $$fiches = [{ meta: { n: 1 } }]
  $$carte = new Map([['a', { n: 1 }]])
  $$ensemble = new Set([{ n: 1 }])
  @rForEach = (s, k) ->
    $$liste.forEach((t) -> t[s][k] = 1)
    return
  @rMap = (s, k) ->
    $$liste.map((t) -> t[s][k] = 1)
    return
  @rFilter = (s, k) ->
    $$liste.filter((t) -> t[s][k] = 1)
    return
  @rSome = (s, k) ->
    $$liste.some((t) -> t[s][k] = 1)
    return
  @rEvery = (s, k) ->
    $$liste.every((t) -> t[s][k] = 1)
    return
  @rFlatMap = (s, k) ->
    $$liste.flatMap((t) -> t[s][k] = 1)
    return
  @rFind = (s, k) ->
    $$liste.find((t) -> t[s][k] = 1)
    return
  @rFindLast = (s, k) ->
    $$liste.findLast((t) -> t[s][k] = 1)
    return
  @rFindIndex = (s, k) ->
    $$liste.findIndex((t) -> t[s][k] = 1)
    return
  @rFindLastIndex = (s, k) ->
    $$liste.findLastIndex((t) -> t[s][k] = 1)
    return
  @rReduce = (s, k) ->
    $$liste.reduce(((acc, t) -> acc + (t[s][k] = 1)), 0)
    return
  @rReduceRight = (s, k) ->
    $$liste.reduceRight(((acc, t) -> acc + (t[s][k] = 1)), 0)
    return
  @rCarte = (s, k) ->
    $$carte.forEach((v) -> v[s][k] = 1)
    return
  @rEnsemble = (s, k) ->
    $$ensemble.forEach((v) -> v[s][k] = 1)
    return
  @rMotif = (s, k) ->
    $$fiches.forEach(({ meta }) -> meta[s][k] = 1)
    return
  @rSurCopie = (s, k) ->
    $$liste.filter((x) -> x.id > 0).forEach((t) -> t[s][k] = 1)
    return
  @cFilter = (s, k) ->
    for u of $$liste.filter((x) -> x.id > 0)
      u[s][k] = 1
    return
  @cSlice = (s, k) ->
    for u of $$liste.slice()
      u[s][k] = 1
    return
  @cConcat = (s, k) ->
    for u of $$liste.concat([])
      u[s][k] = 1
    return
  @cToSorted = (s, k) ->
    for u of $$liste.toSorted((a, b) -> a.id - b.id)
      u[s][k] = 1
    return
  @cToReversed = (s, k) ->
    for u of $$liste.toReversed()
      u[s][k] = 1
    return
  @cValues = (s, k) ->
    for p of Object.values($$prefs)
      p[s][k] = 1
    return
  @cEntries = (s, k) ->
    for [c, p] of Object.entries($$prefs)
      p[s][k] = 1
    return
  @cFrom = (s, k) ->
    for u of Array.from($$liste)
      u[s][k] = 1
    return
  @cSpread = (s, k) ->
    for u of [...$$liste]
      u[s][k] = 1
    return
  @cCarteValues = (s, k) ->
    for v of $$carte.values()
      v[s][k] = 1
    return
  @cCarte = (s, k) ->
    for [c, v] of $$carte
      v[s][k] = 1
    return
  @cVariable = (s, k) ->
    actives := $$liste.filter((x) -> x.id > 0)
    for u of actives
      u[s][k] = 1
    return
  @cIndice = (s, k) ->
    $$liste.filter((x) -> x.id > 0)[0][s][k] = 1
    return
  @mRappel = (s, k) -> rappelModule(s, k)
  @mCopie = (s, k) -> copieModule(s, k)
  @kFindCopie = (s, k) ->
    $$liste.filter((x) -> x.id > 0).find((x) -> x.id == 1)[s][k] = 1
    return
  @kFindVarCopie = (s, k) ->
    actives2 := $$liste.filter((x) -> x.id > 0)
    actives2.find((x) -> x.id == 1)[s][k] = 1
    return
  @kFindLastCopie = (s, k) ->
    $$liste.slice().findLast((x) -> x.id > 0)[s][k] = 1
    return
  @kAtCopie = (s, k) ->
    $$liste.slice().at(0)[s][k] = 1
    return
  @kPopCopie = (s, k) ->
    copie1 := [...$$liste]
    w1 := copie1.pop()
    w1[s][k] = 1
    return
  @kShiftCopie = (s, k) ->
    copie2 := $$liste.slice()
    copie2.shift()[s][k] = 1
    return
  @kValuesFind = (s, k) ->
    Object.values($$prefs).find((p) -> true)[s][k] = 1
    return
  @fFrom = (s, k) ->
    Array.from($$liste, (fm1) -> fm1[s][k] = 1)
    return
  @fProtoCall = (s, k) ->
    Array.prototype.forEach.call($$liste, (pc1) -> pc1[s][k] = 1)
    return
  @fCalcule = (s, k) ->
    $$liste['forEach']((ca1) -> ca1[s][k] = 1)
    return
  @mTrouve = (s, k) -> trouveModule(s, k)
  @ecrireTrouve = ->
    $$liste.filter((x) -> x.id == 2).find((x) -> true).n = 7
    return
  @ecrireDepile = ->
    c4 := $$liste.slice()
    c4.pop().m = 4
    return
  @ecrireFrom = ->
    Array.from($$liste, (fm2) -> fm2.vu = true)
    return
  @cocherRappel = ->
    $$liste.forEach((t) -> t.fait = true)
    return
  @cocherCopie = ->
    for u of $$liste.filter((x) -> x.id == 2)
      u.vu = true
    return
  @compterIndice = ->
    $$liste.slice()[0].n = 5
    return
  @cocherModule = -> cocherModule()
  @neuf = ->
    nouveaux := $$liste.map((t) -> ({ ...t, fait: 'neuf' }))
    nouveaux[0].vu = 'neuf'
    µ.__neuf = [nouveaux[0].fait, nouveaux[0].vu]
    return
  @rien = ->
    somme .= 0
    $$liste.forEach((t) -> somme += t.id)
    µ.__rien = somme
    return
  @local = ->
    autres := [{ x: 0 }]
    autres.forEach((t) -> t.x = 1)
    for w of autres.filter((y) -> true)
      w.x += 1
    µ.__local = autres[0].x
    return
  @profonde = ->
    for z of JSON.parse(JSON.stringify($$liste))
      z.fait = 'json'
    µ.__profonde = true
    return
  @copieEcrite = ->
    copie := $$liste.filter((x) -> x.id > 0)
    copie.push({ id: 9 })
    copie.splice(0, 1)
    µ.__copieEcrite = copie.length
    return
</script>

<p class="liste">{JSON.stringify($$liste)}</p>
`

const AIDES_COFFEE = `export rappelModuleC = (s, k) ->
  $$fliste.forEach (t) -> t[s][k] = 1
  return
export copieModuleC = (s, k) ->
  for t in $$fliste.filter((x) -> x.id > 0)
    t[s][k] = 1
  return
export cocherModuleC = ->
  $$fliste.forEach (t) -> t.m = 9
  return
export trouveModuleC = (s, k) ->
  $$fliste.slice().at(0)[s][k] = 1
  return
`

const COFFEE = `@import rappelModuleC 'garde-rappel-aides.coffee'
@import copieModuleC 'garde-rappel-aides.coffee'
@import cocherModuleC 'garde-rappel-aides.coffee'
@import trouveModuleC 'garde-rappel-aides.coffee'

<script lang="coffee">
$$fprefs = { a: { x: 1 }, b: { x: 2 } }
$$fliste = [{ id: 1, fait: false, vu: false, n: 0, m: 0 }, { id: 2, fait: false, vu: false, n: 0, m: 0 }]
$$fcarte = new Map([['a', { n: 1 }]])
$$fensemble = new Set([{ n: 1 }])
@rForEach = (s, k) ->
  $$fliste.forEach (t) -> t[s][k] = 1
  return
@rFleche = (s, k) ->
  $$fliste.forEach (t) => t[s][k] = 1
  return
@rMap = (s, k) ->
  $$fliste.map (t) -> t[s][k] = 1
  return
@rFilter = (s, k) ->
  $$fliste.filter (t) -> t[s][k] = 1
  return
@rSome = (s, k) ->
  $$fliste.some (t) -> t[s][k] = 1
  return
@rEvery = (s, k) ->
  $$fliste.every (t) -> t[s][k] = 1
  return
@rFlatMap = (s, k) ->
  $$fliste.flatMap (t) -> t[s][k] = 1
  return
@rFind = (s, k) ->
  $$fliste.find (t) -> t[s][k] = 1
  return
@rFindLast = (s, k) ->
  $$fliste.findLast (t) -> t[s][k] = 1
  return
@rFindIndex = (s, k) ->
  $$fliste.findIndex (t) -> t[s][k] = 1
  return
@rFindLastIndex = (s, k) ->
  $$fliste.findLastIndex (t) -> t[s][k] = 1
  return
@rReduce = (s, k) ->
  $$fliste.reduce(((acc, t) -> acc + (t[s][k] = 1)), 0)
  return
@rReduceRight = (s, k) ->
  $$fliste.reduceRight(((acc, t) -> acc + (t[s][k] = 1)), 0)
  return
@rCarte = (s, k) ->
  $$fcarte.forEach (v) -> v[s][k] = 1
  return
@rEnsemble = (s, k) ->
  $$fensemble.forEach (v) -> v[s][k] = 1
  return
@cFilter = (s, k) ->
  for t in $$fliste.filter((x) -> x.id > 0)
    t[s][k] = 1
  return
@cSlice = (s, k) ->
  for t in $$fliste.slice()
    t[s][k] = 1
  return
@cConcat = (s, k) ->
  for t in $$fliste.concat([])
    t[s][k] = 1
  return
@cToSorted = (s, k) ->
  for t in $$fliste.toSorted((a, b) -> a.id - b.id)
    t[s][k] = 1
  return
@cToReversed = (s, k) ->
  for t in $$fliste.toReversed()
    t[s][k] = 1
  return
@cValues = (s, k) ->
  for p in Object.values($$fprefs)
    p[s][k] = 1
  return
@cEntries = (s, k) ->
  for [c, p] in Object.entries($$fprefs)
    p[s][k] = 1
  return
@cFrom = (s, k) ->
  for t in Array.from($$fliste)
    t[s][k] = 1
  return
@cSpread = (s, k) ->
  for t in [$$fliste...]
    t[s][k] = 1
  return
@cCarteValues = (s, k) ->
  for v from $$fcarte.values()
    v[s][k] = 1
  return
@cCarte = (s, k) ->
  for [c, v] from $$fcarte
    v[s][k] = 1
  return
@cVariable = (s, k) ->
  actives = $$fliste.filter((x) -> x.id > 0)
  for t in actives
    t[s][k] = 1
  return
@cIndice = (s, k) ->
  $$fliste.filter((x) -> x.id > 0)[0][s][k] = 1
  return
@mRappel = (s, k) -> rappelModuleC(s, k)
@mCopie = (s, k) -> copieModuleC(s, k)
@kFindCopie = (s, k) ->
  $$fliste.filter((x) -> x.id > 0).find((x) -> x.id == 1)[s][k] = 1
  return
@kAtCopie = (s, k) ->
  $$fliste.slice().at(0)[s][k] = 1
  return
@kPopCopie = (s, k) ->
  copie1 = $$fliste.slice()
  w1 = copie1.pop()
  w1[s][k] = 1
  return
@fFrom = (s, k) ->
  Array.from $$fliste, (fm1) -> fm1[s][k] = 1
  return
@fProtoCall = (s, k) ->
  Array::forEach.call $$fliste, (pc1) -> pc1[s][k] = 1
  return
@fWhileShift = (s, k) ->
  copie3 = $$fliste.slice()
  while ws1 = copie3.shift()
    ws1[s][k] = 1
  return
@mTrouve = (s, k) -> trouveModuleC(s, k)
@ecrireTrouve = ->
  $$fliste.filter((x) -> x.id == 2).find((x) -> true).n = 7
  return
@ecrireDepile = ->
  c4 = $$fliste.slice()
  c4.pop().m = 4
  return
@ecrireFrom = ->
  Array.from $$fliste, (fm2) -> fm2.vu = true
  return
@cocherRappel = ->
  $$fliste.forEach (t) -> t.fait = true
  return
@cocherCopie = ->
  for t in $$fliste.filter((x) -> x.id == 2)
    t.vu = true
  return
@compterIndice = ->
  $$fliste.slice()[0].n = 5
  return
@cocherModule = -> cocherModuleC()
</script>

<p class="liste">{JSON.stringify($$fliste)}</p>
`

const JS = `<script lang="js">
$$jprefs = { a: { x: 1 }, b: { x: 2 } }
$$jliste = [{ id: 1, fait: false, vu: false, n: 0, m: 0 }, { id: 2, fait: false, vu: false, n: 0, m: 0 }]
$$jcarte = new Map([['a', { n: 1 }]])
$$jensemble = new Set([{ n: 1 }])
@rForEach = function(s, k) { $$jliste.forEach((t) => { t[s][k] = 1 }) }
@rFonction = function(s, k) { $$jliste.forEach(function (t) { t[s][k] = 1 }) }
@rMap = function(s, k) { $$jliste.map((t) => t[s][k] = 1) }
@rFilter = function(s, k) { $$jliste.filter((t) => t[s][k] = 1) }
@rSome = function(s, k) { $$jliste.some((t) => t[s][k] = 1) }
@rEvery = function(s, k) { $$jliste.every((t) => t[s][k] = 1) }
@rFlatMap = function(s, k) { $$jliste.flatMap((t) => t[s][k] = 1) }
@rFind = function(s, k) { $$jliste.find((t) => t[s][k] = 1) }
@rFindLast = function(s, k) { $$jliste.findLast((t) => t[s][k] = 1) }
@rFindIndex = function(s, k) { $$jliste.findIndex((t) => t[s][k] = 1) }
@rFindLastIndex = function(s, k) { $$jliste.findLastIndex((t) => t[s][k] = 1) }
@rReduce = function(s, k) { $$jliste.reduce((acc, t) => acc + (t[s][k] = 1), 0) }
@rReduceRight = function(s, k) { $$jliste.reduceRight((acc, t) => acc + (t[s][k] = 1), 0) }
@rCarte = function(s, k) { $$jcarte.forEach((v) => { v[s][k] = 1 }) }
@rEnsemble = function(s, k) { $$jensemble.forEach((v) => { v[s][k] = 1 }) }
@cFilter = function(s, k) { for (const t of $$jliste.filter((x) => x.id > 0)) t[s][k] = 1 }
@cSlice = function(s, k) { for (const t of $$jliste.slice()) t[s][k] = 1 }
@cConcat = function(s, k) { for (const t of $$jliste.concat([])) t[s][k] = 1 }
@cToSorted = function(s, k) { for (const t of $$jliste.toSorted((a, b) => a.id - b.id)) t[s][k] = 1 }
@cToReversed = function(s, k) { for (const t of $$jliste.toReversed()) t[s][k] = 1 }
@cValues = function(s, k) { for (const p of Object.values($$jprefs)) p[s][k] = 1 }
@cEntries = function(s, k) { for (const [c, p] of Object.entries($$jprefs)) p[s][k] = 1 }
@cFrom = function(s, k) { for (const t of Array.from($$jliste)) t[s][k] = 1 }
@cSpread = function(s, k) { for (const t of [...$$jliste]) t[s][k] = 1 }
@cCarteValues = function(s, k) { for (const v of $$jcarte.values()) v[s][k] = 1 }
@cCarte = function(s, k) { for (const [c, v] of $$jcarte) v[s][k] = 1 }
@cVariable = function(s, k) { const actives = $$jliste.filter((x) => x.id > 0); for (const t of actives) t[s][k] = 1 }
@cIndice = function(s, k) { $$jliste.filter((x) => x.id > 0)[0][s][k] = 1 }
@cocherRappel = function() { $$jliste.forEach((t) => { t.fait = true }) }
@cocherCopie = function() { for (const t of $$jliste.filter((x) => x.id == 2)) t.vu = true }
@compterIndice = function() { $$jliste.slice()[0].n = 5 }
@kFindCopie = function(s, k) { $$jliste.filter((x) => x.id > 0).find((x) => x.id == 1)[s][k] = 1 }
@kAtCopie = function(s, k) { $$jliste.slice().at(0)[s][k] = 1 }
@kPopCopie = function(s, k) { const copie1 = [...$$jliste]; const w1 = copie1.pop(); w1[s][k] = 1 }
@fFrom = function(s, k) { Array.from($$jliste, (fm1) => { fm1[s][k] = 1 }) }
@fProtoCall = function(s, k) { Array.prototype.forEach.call($$jliste, (pc1) => { pc1[s][k] = 1 }) }
@fCalcule = function(s, k) { $$jliste['forEach']((ca1) => { ca1[s][k] = 1 }) }
@fWhileShift = function(s, k) { const c = [...$$jliste]; let ws1; while ((ws1 = c.shift())) ws1[s][k] = 1 }
@ecrireTrouve = function() { $$jliste.filter((x) => x.id == 2).find((x) => true).n = 7 }
@ecrireDepile = function() { const c4 = $$jliste.slice(); c4.pop().m = 4 }
@ecrireFrom = function() { Array.from($$jliste, (fm2) => { fm2.vu = true }) }
</script>

<p class="liste">{JSON.stringify($$jliste)}</p>
`

const RAPPELS = ['rForEach', 'rMap', 'rFilter', 'rSome', 'rEvery', 'rFlatMap', 'rFind', 'rFindLast', 'rFindIndex', 'rFindLastIndex', 'rReduce', 'rReduceRight', 'rCarte', 'rEnsemble']
const COPIES  = ['cFilter', 'cSlice', 'cConcat', 'cToSorted', 'cToReversed', 'cValues', 'cEntries', 'cFrom', 'cSpread', 'cCarteValues', 'cCarte', 'cVariable', 'cIndice']

// langue, balise, méthodes qui écrivent par une clé venue de données
const FORMES: [string, string, string[]][] = [
  ['Civet', 'mjs-garde-rappel-civet', [...RAPPELS, 'rMotif', 'rSurCopie', ...COPIES, 'mRappel', 'mCopie', 'kFindCopie', 'kFindVarCopie', 'kFindLastCopie', 'kAtCopie', 'kPopCopie', 'kShiftCopie', 'kValuesFind', 'fFrom', 'fProtoCall', 'fCalcule', 'mTrouve']],
  ['CoffeeScript', 'mjs-garde-rappel-coffee', [...RAPPELS, 'rFleche', ...COPIES, 'mRappel', 'mCopie', 'kFindCopie', 'kAtCopie', 'kPopCopie', 'fFrom', 'fProtoCall', 'fWhileShift', 'mTrouve']],
  ['JS', 'mjs-garde-rappel-js', [...RAPPELS, 'rFonction', ...COPIES, 'kFindCopie', 'kAtCopie', 'kPopCopie', 'fFrom', 'fProtoCall', 'fCalcule', 'fWhileShift']],
]

const FICHIERS: Record<string, string> = {
  'garde-rappel-aides.civet': AIDES_CIVET,
  'garde-rappel-aides.coffee': AIDES_COFFEE,
  'garde-rappel-civet.mjs': CIVET,
  'garde-rappel-coffee.mjs': COFFEE,
  'garde-rappel-js.mjs': JS,
}

async function construire(prefixe: string, prod: boolean): Promise<{ code: string, emis: string }> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(FICHIERS)) writeFileSync(join(srcDir, nom), source)
  const opts: any = prod ? { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env: 'prod', js: 'bundle' } : { sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') }
  const bundler = new Bundler(opts)
  const stats   = await bundler.compile()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [])
  await bundler.close()
  if (prod) return { code: readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, ''), emis: '' }
  const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b))
  const emis  = files.filter((f) => f.startsWith('garde-rappel')).map((f) => readFileSync(join(outDir, f), 'utf-8')).join('\n')
  return { code: files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n'), emis }
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function monter(code: string, prod: boolean) {
  const window: any = new Window({ url: 'http://localhost/' })
  const avis: string[] = []
  window.eval(prod ? code : `${code}\nglobalThis.µ = µ;`)
  if (!prod) window.µ.warn = (m: string) => avis.push(String(m))
  window.document.body.innerHTML = FORMES.map(([, b]) => `<${b}></${b}>`).join('')
  const q   = (b: string) => window.document.querySelector(b)
  const vue = (b: string) => q(b)._shadow?.querySelector('.liste')?.textContent
  const fin = Date.now() + 3000
  while (!FORMES.every(([, b]) => vue(b) !== undefined) && Date.now() < fin) await pause(10)
  await pause(60)
  return { window, q, vue, avis }
}

// clés du magasin prévenues pendant `faire` (espion posé sur l'aide qui prévient une clé)
function prevenues(window: any, faire: () => void): string[] {
  const vues: string[] = []
  const avant = window.µ._mjs_storeNotifyKey
  window.µ._mjs_storeNotifyKey = function (k: string) {
    vues.push(k)
    return avant.call(this, k)
  }
  try {
    faire()
  }
  finally {
    window.µ._mjs_storeNotifyKey = avant
  }
  return vues
}

describe('magasin $$ : le paramètre d\'un rappel et la variable d\'une boucle sur une copie refusent le prototype', function () {
  this.timeout(240000)
  const builds: Record<string, { code: string, emis: string }> = {}

  before(async function () {
    this.timeout(240000)
    builds.dev  = await construire('garde-rappel', false)
    builds.prod = await construire('garde-rappel-prod', true)
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const mode of ['dev', 'prod']) {
    const prod = mode === 'prod'

    it(`${mode} : aucune forme n'écrit dans Object.prototype`, async () => {
      const { window, q, avis } = await monter(builds[mode].code, prod)
      const pollue  = (p: string) => window.eval(`Object.prototype.hasOwnProperty(${JSON.stringify(p)})`)
      const releves: string[] = []
      const fautes: string[]  = []
      try {
        for (const [langue, balise, methodes] of FORMES) {
          for (const m of methodes) {
            const k = `pollu_${langue}_${m}`
            const n = avis.length
            let leve = ''
            try {
              q(balise)[m]('__proto__', k)
            }
            catch (e: any) {
              leve = ` · lève ${String(e?.message).slice(0, 60)}`
            }
            const o = pollue(k)
            releves.push(`${langue} ${m} : Object.prototype=${o} avis=${avis.length - n}${leve}`)
            if (o || leve) fautes.push(`${langue} ${m}`)
            if (!prod && avis.length === n) fautes.push(`${langue} ${m} (sans avertissement)`)
          }
        }
      }
      finally {
        console.log(`      ${mode}\n        ${releves.join('\n        ')}`)
        window.eval(`for (const p of Object.getOwnPropertyNames(Object.prototype)) if (p.startsWith('pollu_')) delete Object.prototype[p]`)
        window.close()
      }
      assert.deepEqual(fautes, [])
    })

    it(`${mode} : une écriture par le paramètre d'un rappel, par la variable d'une boucle sur une copie ou par l'élément d'une copie redessine la vue`, async () => {
      const { window, q, vue } = await monter(builds[mode].code, prod)
      try {
        for (const [, balise] of FORMES) {
          q(balise).cocherRappel()
          q(balise).cocherCopie()
          q(balise).compterIndice()
          q(balise).cocherModule?.()
        }
        await pause(60)
        assert.equal(vue('mjs-garde-rappel-civet'), '[{"id":1,"fait":true,"vu":false,"n":5,"m":9},{"id":2,"fait":true,"vu":true,"n":0,"m":9}]')
        assert.equal(vue('mjs-garde-rappel-coffee'), '[{"id":1,"fait":true,"vu":false,"n":5,"m":9},{"id":2,"fait":true,"vu":true,"n":0,"m":9}]')
        assert.equal(vue('mjs-garde-rappel-js'), '[{"id":1,"fait":true,"vu":false,"n":5,"m":0},{"id":2,"fait":true,"vu":true,"n":0,"m":0}]')
      }
      finally {
        window.close()
      }
    })

    it(`${mode} : une écriture par l'élément d'une copie atteint par find ou pop, ou par le rappel d'Array.from, redessine la vue`, async () => {
      const { window, q, vue } = await monter(builds[mode].code, prod)
      try {
        for (const [, balise] of FORMES) {
          q(balise).ecrireTrouve()
          q(balise).ecrireDepile()
          q(balise).ecrireFrom()
        }
        await pause(60)
        const attendu = '[{"id":1,"fait":false,"vu":true,"n":0,"m":0},{"id":2,"fait":false,"vu":true,"n":7,"m":4}]'
        assert.deepEqual(FORMES.map(([, b]) => vue(b)), [attendu, attendu, attendu])
      }
      finally {
        window.close()
      }
    })
  }

  it('dev : l\'élément d\'une copie atteint par find ou pop, et le rappel d\'Array.from, préviennent la clé du store', async () => {
    const { window, q } = await monter(builds.dev.code, false)
    try {
      for (const [b, cle] of [['mjs-garde-rappel-civet', 'liste'], ['mjs-garde-rappel-coffee', 'fliste'], ['mjs-garde-rappel-js', 'jliste']]) {
        const c = q(b)
        assert.deepEqual([prevenues(window, () => c.ecrireTrouve()), prevenues(window, () => c.ecrireDepile()), prevenues(window, () => c.ecrireFrom())], [[cle], [cle], [cle, cle]], b)
      }
    }
    finally {
      window.close()
    }
  })

  it('dev : chaque écriture prévient la clé du store d\'où viennent les objets', async () => {
    const { window, q } = await monter(builds.dev.code, false)
    try {
      const c = q('mjs-garde-rappel-civet'), f = q('mjs-garde-rappel-coffee'), j = q('mjs-garde-rappel-js')
      assert.deepEqual(prevenues(window, () => c.cocherRappel()), ['liste', 'liste'])
      assert.deepEqual(prevenues(window, () => c.cocherCopie()), ['liste'])
      assert.deepEqual(prevenues(window, () => c.compterIndice()), ['liste'])
      assert.deepEqual(prevenues(window, () => c.cocherModule()), ['liste', 'liste'])
      assert.deepEqual(prevenues(window, () => f.cocherRappel()), ['fliste', 'fliste'])
      assert.deepEqual(prevenues(window, () => f.cocherCopie()), ['fliste'])
      assert.deepEqual(prevenues(window, () => f.compterIndice()), ['fliste'])
      assert.deepEqual(prevenues(window, () => f.cocherModule()), ['fliste', 'fliste'])
      assert.deepEqual(prevenues(window, () => j.cocherRappel()), ['jliste', 'jliste'])
      assert.deepEqual(prevenues(window, () => j.cocherCopie()), ['jliste'])
      assert.deepEqual(prevenues(window, () => j.compterIndice()), ['jliste'])
    }
    finally {
      window.close()
    }
  })

  it('témoins, dev : objet neuf fait dans le rappel, copie profonde, copie écrite elle-même, liste hors du magasin, rappel qui n\'écrit rien — aucune clé prévenue, le magasin intact', async () => {
    const { window, q } = await monter(builds.dev.code, false)
    try {
      const c   = q('mjs-garde-rappel-civet')
      const raw = window.µ._mjs_storeRaw
      const avant = JSON.stringify(raw.liste)
      assert.deepEqual(prevenues(window, () => c.neuf()), [])
      assert.deepEqual([...window.µ.__neuf], ['neuf', 'neuf'])
      assert.deepEqual(prevenues(window, () => c.rien()), [])
      assert.equal(window.µ.__rien, 3)
      assert.deepEqual(prevenues(window, () => c.local()), [])
      assert.equal(window.µ.__local, 2)
      assert.deepEqual(prevenues(window, () => c.profonde()), [])
      assert.equal(window.µ.__profonde, true)
      assert.deepEqual(prevenues(window, () => c.copieEcrite()), [])
      assert.equal(window.µ.__copieEcrite, 2)
      assert.equal(JSON.stringify(raw.liste), avant)
    }
    finally {
      window.close()
    }
  })

  it('témoins, compilation : ces formes restent telles qu\'écrites', () => {
    const temoins = [
      'µ.store.liste.forEach((t) => { µ.__vu = t.id })',
      '[{ x: 0 }].forEach((t) => { t.x = 1 }); for (const u of [{ x: 0 }].filter((y) => y)) u.x = 1',
      'const n = µ.store.liste.map((t) => ({ ...t, x: 1 })); n[0].x = 2; µ.store.liste.flatMap((t) => [{ ...t }])[0].x = 3',
      'structuredClone(µ.store.liste).forEach((t) => { t.x = 1 }); for (const t of JSON.parse(JSON.stringify(µ.store.liste))) t.x = 1',
      'const c = µ.store.liste.slice(); c.push(1); c[0] = 2; c.length = 0; Object.values(µ.store.prefs).push(3)',
      'const marquer = (t) => { t.fait = true }; marquer(µ.store.liste[0]); µ.store.liste.forEach(marquer)',
    ]
    for (const js of temoins) assert.equal(applyPathTracking(js), js)
  })

  it('compilation : le paramètre d\'un rappel est suivi dans son rappel, pas un autre paramètre du même nom', () => {
    const js  = 'µ.store.liste.forEach((t) => { t.fait = true }); [{ x: 0 }].forEach((t) => { t.x = 1 })'
    const out = applyPathTracking(js)
    assert.match(out, /µ\._mjs_storeSetOn\("liste", t, "fait", true\)/)
    assert.match(out, /\(t\) => \{ t\.x = 1 \}/)
  })

  it('dev : code émis — aucune écriture par une clé venue de données ne reste nue, chacune passe par l\'aide gardée', () => {
    const emis   = builds.dev.emis
    const nues   = emis.split('\n').filter((l) => /\[k\] = 1/.test(l)).map((l) => l.trim().slice(0, 170))
    const gardes = emis.split('_mjs_storeSetOn(').length - 1
    const formes = FORMES.reduce((n, [, , m]) => n + m.filter((x) => !/^m[A-Z]/.test(x)).length, 0)
    assert.deepEqual(nues, [])
    assert.ok(gardes >= formes, `${gardes} écritures gardées pour ${formes} formes`)
  })
})
