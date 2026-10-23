// Magasin `$$` — une écriture dont la cible passe par un élément TROUVÉ (`$$taches.find(f).fait = true`, `findLast`,
// `at`, `get` d'une Map), ou par une variable qui garde cet élément (`t = $$taches.find(f)` puis `t.fait = true`),
// prévient les lecteurs de la clé, comme l'écriture par le chemin (`$$taches[1].fait = true`). L'objet trouvé est
// évalué une seule fois par écriture (le prédicat n'est pas rappelé pour `+=` ou `++`), un `find` qui ne trouve
// rien lève la TypeError de JavaScript, celle de l'écriture, et la règle d'un magasin typé refuse une mauvaise valeur
// écrite par `find` comme par le chemin. Même suivi à travers `?.`, `||=`, `&&=`, `??=` / `?=` (variables de travail
// de Civet et de CoffeeScript), pour une variable CoffeeScript affectée une seule fois, en composant comme en module
// importé, et en construction de production. Une clé calculée entre l'élément et la cible se lit comme JavaScript la lit
// (`__proto__` mène au prototype, `constructor` à la fonction), et l'écriture les refuse, avec un avertissement ; par le chemin (`$$taches[0][k1][k2]`),
// elle est refusée, avec un avertissement ; un nom réassigné, un paramètre, une copie, la variable
// d'une boucle ne préviennent rien et écrivent là où JavaScript écrit. Un alias du magasin écrit dans l'objet qu'il
// tient, comme JavaScript (`sous := $$cfg.a` puis `$$cfg = autre`, `premier := $$liste[0]` puis `unshift`) ; jamais
// pris, il lève la TypeError de l'écriture. `delete` rend `true` ; l'objet relu par `++` est tenu par un paramètre
// local, aucune case partagée

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await pause(10)
}

async function construire(prefixe: string, fichiers: Record<string, string>): Promise<string> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(fichiers)) writeFileSync(join(srcDir, nom), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [])
  await bundler.close()
  const rang = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b))
  return files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
}

async function monter(code: string, balise: string, sel: string, avant?: (w: any) => void) {
  const window: any = new Window({ url: 'http://localhost/' })
  window.eval(`${code}\nglobalThis.µ = µ;`)
  avant?.(window)
  window.document.body.innerHTML = `<${balise}></${balise}>`
  const comp  = window.document.querySelector(balise)
  const texte = (s = sel) => comp._shadow?.querySelector(s)?.textContent
  await attendre(() => typeof texte() === 'string' && texte() !== '')
  return { window, comp, texte }
}

const AIDES = `export marque = (id) ->
  $$taches.find((x) -> x.id == id).fait = true

export cumule = (id) ->
  tm := $$taches.find((x) -> x.id == id)
  tm.n += 1
  tm.tags.push('m')

export optModule = (k) -> $$m.get(k)?.n = 9
`

const TACHES = `@import marque 'taches-aides.civet'
@import cumule 'taches-aides.civet'
@import optModule 'taches-aides.civet'

<script>
  $$taches = [{ id: 1, groupe: 'a', fait: false, n: 0, note: 'x', meta: { vu: false }, tags: [] }, { id: 2, groupe: 'a', fait: false, n: 0, note: 'y', meta: { vu: false }, tags: [] }, { id: 3, groupe: 'b', fait: false, n: 0, note: '', meta: { vu: false }, tags: [] }]
  $$m = new Map([['a', { n: 1, tags: [] }]])
  @parFind     = (id) -> $$taches.find((x) -> x.id == id).fait = true
  @parFindLast = -> $$taches.findLast((x) -> x.groupe == 'a').fait = true
  @parAt       = -> $$taches.at(-1).note = 'fin'
  @parGet      = -> $$m.get('a').n = 5
  @profond     = (id) -> $$taches.find((x) -> x.id == id).meta.vu = true
  @plus        = (id) -> $$taches.find((x) => (µ.__appels++, x.id == id)).n += 2
  @incr        = (id) -> $$taches.find((x) => (µ.__appels++, x.id == id)).n++
  @efface      = (id) -> delete $$taches.find((x) -> x.id == id).note
  @pousse      = (id) -> $$taches.find((x) -> x.id == id).tags.push('t')
  @champ       = (id, k) -> $$taches.find((x) -> x.id == id)[k] = 'calc'
  @absent      = -> $$taches.find((x) -> x.id == 99).fait = true
  @option      = (k) -> $$m.get(k)?.tags.push('o')
  @postfixe    = (id) -> µ.__ancien = $$taches.find((x) => (µ.__appels++, x.id == id)).n++
  @prefixe     = (id) -> µ.__nouveau = ++$$taches.find((x) => (µ.__appels++, x.id == id)).n
  @somme       = (id) -> µ.__somme = ($$taches.find((x) => (µ.__appels++, x.id == id)).n += 5)
  @sinon       = (id) -> $$taches.find((x) => (µ.__appels++, x.id == id)).note ||= (µ.__rhs++, 'defaut')
  @attendu     = (id) -> $$taches.find((x) -> x.id == id).n += await Promise.resolve(3)
  @variable    = (id) ->
    t1 = $$taches.find((x) -> x.id == id)
    t1.fait = true
    t1.n++
    t1.tags.push('v')
    delete t1.note
  @constante   = (id) ->
    t2 := $$taches.find((x) -> x.id == id)
    t2.meta.vu = true
  @optListe    = (id) -> $$taches.find((x) => (µ.__appels++, x.id == id)).tags?.push('l')
  @optAppel    = (k) -> $$m.get(k)?.tags.push?.('p')
  @optBase     = (k) -> $$vide?.get(k).tags.push('b')
  @viaModule   = (id) -> marque(id)
  @viaModule2  = (id) -> cumule(id)
  @viaModule3  = (k) -> optModule(k)
  @optEcrit    = (k) -> $$m.get(k)?.n = 9
  @optPlus     = (k) -> $$m.get(k)?.n += 2
  @optIncr     = (k) -> $$m.get(k)?.n++
  @optEfface   = (k) -> delete $$m.get(k)?.tags
  @optOu       = (k) -> $$m.get(k)?.note ||= 'd'
  @optDeux     = (id) -> $$taches.find((x) -> x.id == id)?.meta?.vu = true
  @optLu       = (k) -> µ.__lu = ($$m.get(k)?.n = 7)
  @cheminOpt   = -> $$taches[0]?.meta.vu = true
  @cheminEfface = -> delete $$taches[1]?.note
  @proto       = (k1, k2) -> $$taches.find((x) -> x.id == 1)[k1][k2] = 'pollue'
  @protoChemin = (k1, k2) -> $$taches[0][k1][k2] = 'pollue'
  @protoEfface = (k1, k2) -> delete $$taches.find((x) -> x.id == 1)[k1][k2]
  @protoPousse = (k1) -> $$taches.find((x) -> x.id == 1).tags[k1].push('x')
  @protoPlus   = (k1, k2) -> $$taches.find((x) -> x.id == 1)[k1][k2] += 1
  @protoOpt    = (k1) -> $$taches.find((x) -> x.id == 1)?.tags[k1]?.push('x')
  @protoVar    = (k1, k2) ->
    t6 := $$taches.find((x) -> x.id == 1)
    t6[k1][k2] = 'pollue'
  @absentVar   = ->
    t10 := $$taches.find((x) -> x.id == 99)
    t10.n = 1
  @imbrique    = (a, b) -> $$taches.find((x) => (µ.__appels++, x.id == a)).n += ($$taches.find((x) => (µ.__appels++, x.id == b)).n++)
  @tenu        = (id) ->
    t9 := $$taches.find((x) -> x.id == id)
    $$taches.unshift({ id: 0, groupe: 'z', fait: false, n: 0, note: '', meta: { vu: false }, tags: [] })
    await new Promise((r) -> setTimeout(r, 40))
    t9.fait = true
  @reassigne   = (id) ->
    t7 = $$taches.find((x) -> x.id == id)
    t7 = { fait: false }
    t7.fait = true
    µ.__t7 = t7
  @param       = (t8) -> t8.fait = true
  @copies      = ->
    c1 := $$taches.slice()
    c1.push({ id: 9 })
    c2 := $$taches.map((x) -> ({ ...x }))
    c2[0].fait = true
    c3 := $$taches.filter((x) -> x.id > 1)
    c3.splice(0, 1)
    µ.__copies = [c1.length, c2[0].fait, c3.length]
  @boucle      = ->
    for u of $$taches
      u.fait = true
</script>

<p class="etat">{JSON.stringify($$taches)}</p>
<p class="carte">{JSON.stringify([...$$m])}</p>
`

const AIDES_COFFEE = `export marqueC = (id) ->
  t = $$liste.find((x) -> x.id == id)
  t.fait = true
export optionC = (k) -> $$carte.get(k)?.tags.push('m')
export sinonC = (id) -> $$liste.find((x) -> x.id == id).note ||= 'module'
export optEcritC = (k) -> $$carte.get(k)?.n = 9
`

const COFFEE = `@import marqueC 'liste-aides.coffee'
@import optionC 'liste-aides.coffee'
@import sinonC 'liste-aides.coffee'
@import optEcritC 'liste-aides.coffee'

<script lang="coffee">
$$liste = [{ id: 1, fait: false, n: 0, note: 'x', meta: { vu: false }, tags: [] }, { id: 2, fait: false, n: 0, note: '', meta: { vu: false }, tags: [] }]
$$carte = new Map([['a', { n: 1, tags: [] }]])
$$obj = { a: { b: 1 } }
@direct = (id) -> $$liste.find((x) -> x.id == id).fait = true
@optEcrit = (k) -> $$carte.get(k)?.n = 9
@optPlus = (k) -> $$carte.get(k)?.n += 2
@optIncr = (k) -> $$carte.get(k)?.n++
@optEfface = (k) -> delete $$carte.get(k)?.tags
@optPousse = (k) -> $$carte.get(k)?.tags.push('o')
@ouEgal = (id) -> $$liste.find((x) -> x.id == id).note ||= 'ou'
@etEgal = (id) -> $$liste.find((x) -> x.id == id).note &&= 'et'
@nulEgal = (id) -> $$liste.find((x) -> x.id == id).meta.absent ?= 'nul'
@cheminOu = -> $$obj.a.c ||= 'chemin'
@variable = (id) ->
  t = $$liste.find((x) -> x.id == id)
  t.n += 1
  t.tags.push('v')
  delete t.note
@alias = ->
  sous = $$obj.a
  sous.b = 5
@proto = (k1, k2) -> $$liste.find((x) -> x.id == 1)[k1][k2] = 'pollue'
@absent = -> $$liste.find((x) -> x.id == 99).fait = true
@viaModule = (id) -> marqueC(id)
@viaModuleOpt = (k) -> optionC(k)
@viaModuleOu = (id) -> sinonC(id)
@viaModuleEcrit = (k) -> optEcritC(k)
@reassigne = (id) ->
  w = $$liste.find((x) -> x.id == id)
  w = { fait: false }
  w.fait = true
  µ.__w = w
@param = (p) -> p.fait = true
@copies = ->
  c = $$liste.slice()
  c.push({ id: 9 })
  d = $$liste.map((x) -> Object.assign({}, x))
  d[0].fait = true
  e = $$liste.filter((x) -> x.id > 1)
  e.splice(0, 1)
  µ.__copies = [c.length, d[0].fait, e.length]
@boucle = ->
  for u in $$liste
    u.fait = true
  return
</script>

<p class="liste">{JSON.stringify($$liste)}</p>
<p class="carte">{JSON.stringify([...$$carte])}</p>
<p class="obj">{JSON.stringify($$obj)}</p>
`

const FLUX = `<vars>
  $$flux { id: int 0..100, tags: string[] }[]
</vars>

<script>
  $$flux = [{ id: 0, tags: [] }, { id: 1, tags: [] }]
  @parFind   = -> $$flux.find((f) -> f.id == 1).id = 'zz'
  @parChemin = -> $$flux[1].id = 'zz'
</script>

<p class="v">{$$flux[1].id}</p>
`

const EFFET = `<script>
  $$compteurs = [{ id: 1, n: 0 }]
  µeffect -> $$compteurs.find((c) -> c.id == 1).n += 1
</script>

<p class="n">{$$compteurs[0].n}</p>
`

// un alias du magasin écrit dans l'OBJET qu'il tient (déclaration Civet, `let w` puis `w = …`, variable affectée une
// seule fois, variable qui garde un élément trouvé), comme JavaScript ; gardes de prudence ; `delete` rend `true`
const REGLE = `<script>
  $$liste = [{ id: 1, fait: false }, { id: 2, fait: false }]
  $$cfg = { a: { b: 0 } }
  $$taches = [{ id: 1, note: 'x', meta: { vu: false }, tags: [] }]
  $$m = new Map([['a', { n: 1, tags: [] }]])
  $$vieux = 1
  $$a = [{ id: 1, get n() { $$b.find((x) -> x.id == 1).n += 0; return this._n }, set n(v) { this._n = v }, _n: 1 }]
  $$b = [{ id: 1, n: 5 }]
  @apresCle = ->
    sous := $$cfg.a
    $$cfg = { a: { b: 100 } }
    sous.b = 1
    µ.__ancien = sous
  @apresUnshift = ->
    premier := $$liste[0]
    $$liste.unshift({ id: 0, fait: false })
    premier.fait = true
  @sansValeur = (c) ->
    let s1
    if c
      s1 = $$cfg.a
    s1.b = 7
  @sansValeurApres = ->
    let w
    w = $$cfg.a
    $$cfg = { a: { b: 200 } }
    w.b = 2
    µ.__ancien = w
  @bloc = (c) ->
    if c
      t = $$liste.find((x) -> x.id == 1)
    t.vu = true
  @parIndice = (i) ->
    it := $$liste[i]
    it.fait = true
  @caseLocale = -> µ.__v = $$a.find((x) -> x.id == 1).n++
  @virgule = -> $$taches.find((x) -> x.id == 1)[(0, 'meta')].vu = 'virgule'
  @litteral = -> $$taches.find((x) -> x.id == 1)['meta'].lu = true
  @effaceFind = -> µ.__d = delete $$taches.find((x) -> x.id == 1).note
  @effaceOpt = (k) -> µ.__d = delete $$m.get(k)?.tags
  @effaceChemin = -> µ.__d = delete $$taches[0].meta.vu
  @effaceAlias = ->
    s2 := $$taches[0]
    µ.__d = delete s2.tags
  @effaceRacine = -> µ.__d = delete $$vieux
  @absentReserve = (k1) -> $$taches.find((x) -> x.id == 99)[k1].x = 1
  @reserveClair = -> $$taches.find((x) -> x.id == 1).constructor.pollueC = 'pollue'
  @reserveProto = -> $$taches.find((x) -> x.id == 1).__proto__.pollueP = 'pollue'
  @memeFonction = ->
    let h
    [1].forEach (x) -> h = $$cfg.a
    h.b = 4
  @autres = ->
    let w2
    µ.__w2 = (w2 = $$cfg.a, w2 = { b: 0 }, w2.b = 3, w2)
  @seconde = ->
    var w3
    if (w3 = $$cfg.a)
      var w3
      w3.b = 6
</script>

<p class="etat">{JSON.stringify($$liste)} {JSON.stringify($$cfg)} {JSON.stringify($$taches)}</p>
`

const REGLE_COFFEE = `<script lang="coffee">
$$liste = [{ id: 1, fait: false }, { id: 2, fait: false }]
$$cfg = { a: { b: 0 } }
$$carte = new Map([['a', { n: 1, tags: [] }]])
@apresCle = ->
  sous = $$cfg.a
  $$cfg = { a: { b: 100 } }
  sous.b = 1
  µ.__ancien = sous
@apresUnshift = ->
  premier = $$liste[0]
  $$liste.unshift({ id: 0, fait: false })
  premier.fait = true
@cond = (c) ->
  sous2 = $$cfg.a if c
  sous2.b = 7
@retour = (c) ->
  if c
    sous3 = $$cfg.a
    return
  sous3.b = 8
@rappel = (k) ->
  [1].forEach (x) -> $$carte.get(k)?.n = 50 + x
  $$carte.get(k)?.n = 60
@effaceOpt = -> µ.__d = delete $$cfg?.a.b
@effaceAlias = ->
  s5 = $$cfg.a
  µ.__d = delete s5.b
@aliasA = ->
  s = $$cfg.a
  s.b = 1
@aliasB = (s) -> s.b = 2
@boucleUne = ->
  for x in [1]
    u1 = $$liste[0]
    u1.fait = true
  return
</script>

<p class="etat">{JSON.stringify($$liste)} {JSON.stringify($$cfg)} {JSON.stringify([...$$carte])}</p>
`

let codeTaches = ''
let codeRegle  = ''
let codeRegleC = ''
let codeFlux   = ''
let codeEffet  = ''
let codeCoffee = ''
let codeProd   = ''

// construction de production d'un seul tenant (noms internes raccourcis, `µ` hors de window), prête à évaluer
async function construireProd(prefixe: string, fichiers: Record<string, string>): Promise<string> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(fichiers)) writeFileSync(join(srcDir, nom), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env: 'prod', js: 'bundle' })
  const stats   = await bundler.compile()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [])
  await bundler.close()
  return readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
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

// état affiché d'une tâche, relu dans le JSON du rendu
function tache(texte: () => string | undefined, id: number): any {
  return JSON.parse(texte() ?? '[]').find((t: any) => t.id === id)
}

describe('magasin $$ : une écriture par find(), findLast(), at(), get() prévient les lecteurs', function () {
  this.timeout(120000)

  before(async function () {
    this.timeout(180000)
    codeTaches = await construire('store-find-taches', { 'taches-aides.civet': AIDES, 'taches-find.mjs': TACHES })
    codeFlux   = await construire('store-find-flux', { 'flux-find.mjs': FLUX })
    codeEffet  = await construire('store-find-effet', { 'effet-find.mjs': EFFET })
    codeCoffee = await construire('store-find-coffee', { 'liste-aides.coffee': AIDES_COFFEE, 'liste-coffee.mjs': COFFEE })
    codeRegle  = await construire('store-regle-civet', { 'regle-civet.mjs': REGLE })
    codeRegleC = await construire('store-regle-coffee', { 'regle-coffee.mjs': REGLE_COFFEE })
    codeProd   = await construireProd('store-find-prod', { 'taches-aides.civet': AIDES, 'taches-find.mjs': TACHES, 'liste-aides.coffee': AIDES_COFFEE, 'liste-coffee.mjs': COFFEE, 'regle-civet.mjs': REGLE, 'regle-coffee.mjs': REGLE_COFFEE })
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  async function taches(avant?: (w: any) => void) {
    return monter(codeTaches, 'mjs-taches-find', '.etat', (w) => {
      w.µ.__appels = 0
      w.µ.__rhs    = 0
      avant?.(w)
    })
  }

  const cas: [string, string, (t: () => string | undefined, c: () => string | undefined) => void][] = [
    ['find', 'parFind(2)', (t) => assert.equal(tache(t, 2).fait, true)],
    ['findLast', 'parFindLast()', (t) => assert.equal(tache(t, 2).fait, true)],
    ['at(-1)', 'parAt()', (t) => assert.equal(tache(t, 3).note, 'fin')],
    ['get d\'une Map', 'parGet()', (_t, c) => assert.equal(c(), '[["a",{"n":5,"tags":[]}]]')],
    ['cible profonde', 'profond(1)', (t) => assert.equal(tache(t, 1).meta.vu, true)],
    ['delete', 'efface(1)', (t) => assert.equal('note' in tache(t, 1), false)],
    ['push sur une liste de l\'élément', 'pousse(2)', (t) => assert.deepEqual(tache(t, 2).tags, ['t'])],
    ['clé calculée', 'champ(3, \'libelle\')', (t) => assert.equal(tache(t, 3).libelle, 'calc')],
    ['chaîne optionnelle sur get()', 'option(\'a\')', (_t, c) => assert.equal(c(), '[["a",{"n":1,"tags":["o"]}]]')],
    ['variable qui garde l\'élément (let)', 'variable(2)', (t) => {
      const e = tache(t, 2)
      assert.equal(e.fait, true)
      assert.equal(e.n, 1)
      assert.deepEqual(e.tags, ['v'])
      assert.equal('note' in e, false)
    }],
    ['variable qui garde l\'élément (const)', 'constante(3)', (t) => assert.equal(tache(t, 3).meta.vu, true)],
    ['module .civet importé', 'viaModule(1)', (t) => assert.equal(tache(t, 1).fait, true)],
    ['module .civet importé, variable', 'viaModule2(3)', (t) => {
      assert.equal(tache(t, 3).n, 1)
      assert.deepEqual(tache(t, 3).tags, ['m'])
    }],
    ['module .civet importé, `?.`', 'viaModule3(\'a\')', (_t, c) => assert.equal(c(), '[["a",{"n":9,"tags":[]}]]')],
    ['`?.` puis =', 'optEcrit(\'a\')', (_t, c) => assert.equal(c(), '[["a",{"n":9,"tags":[]}]]')],
    ['`?.` puis +=', 'optPlus(\'a\')', (_t, c) => assert.equal(c(), '[["a",{"n":3,"tags":[]}]]')],
    ['`?.` puis ++', 'optIncr(\'a\')', (_t, c) => assert.equal(c(), '[["a",{"n":2,"tags":[]}]]')],
    ['`?.` puis delete', 'optEfface(\'a\')', (_t, c) => assert.equal(c(), '[["a",{"n":1}]]')],
    ['`?.` puis ||=', 'optOu(\'a\')', (_t, c) => assert.equal(c(), '[["a",{"n":1,"tags":[],"note":"d"}]]')],
    ['deux `?.` sur l\'élément trouvé', 'optDeux(2)', (t) => assert.equal(tache(t, 2).meta.vu, true)],
    ['chemin du magasin puis `?.`', 'cheminOpt()', (t) => assert.equal(tache(t, 1).meta.vu, true)],
    ['chemin du magasin, delete par `?.`', 'cheminEfface()', (t) => assert.equal('note' in tache(t, 2), false)],
  ]

  for (const [nom, appel, verifie] of cas) {
    it(`${nom} : ${appel} redessine`, async () => {
      const { window, comp, texte } = await taches()
      try {
        const carte = () => comp._shadow?.querySelector('.carte')?.textContent
        comp[appel.slice(0, appel.indexOf('('))](...JSON.parse(`[${appel.slice(appel.indexOf('(') + 1, -1).replace(/'/g, '"')}]`))
        await pause(60)
        verifie(texte, carte)
      }
      finally {
        window.close()
      }
    })
  }

  it('+= et ++ : le prédicat n\'est appelé qu\'une fois par écriture, et l\'écran suit', async () => {
    const { window, comp, texte } = await taches()
    try {
      comp.plus(1)
      await pause(40)
      assert.equal(window.µ.__appels, 1, 'find évalué une seule fois pour +=')
      assert.equal(tache(texte, 1).n, 2)
      window.µ.__appels = 0
      comp.incr(1)
      await pause(40)
      assert.equal(window.µ.__appels, 1, 'find évalué une seule fois pour ++')
      assert.equal(tache(texte, 1).n, 3)
    }
    finally {
      window.close()
    }
  })

  it('valeur lue : n++ rend l\'ancienne valeur, ++n la nouvelle, (n += 5) la somme ; ||= n\'évalue pas sa droite', async () => {
    const { window, comp, texte } = await taches()
    try {
      comp.postfixe(1)
      assert.equal(window.µ.__ancien, 0)
      comp.prefixe(1)
      assert.equal(window.µ.__nouveau, 2)
      comp.somme(1)
      assert.equal(window.µ.__somme, 7)
      assert.equal(window.µ.__appels, 3, 'un seul appel du prédicat par écriture')
      comp.sinon(1)
      assert.equal(window.µ.__rhs, 0, 'note déjà remplie : la valeur de droite n\'est pas évaluée')
      comp.sinon(3)
      assert.equal(window.µ.__rhs, 1)
      await pause(60)
      assert.equal(tache(texte, 1).n, 7)
      assert.equal(tache(texte, 3).note, 'defaut')
    }
    finally {
      window.close()
    }
  })

  it('+= avec await à droite : compile et redessine', async () => {
    const { window, comp, texte } = await taches()
    try {
      await comp.attendu(2)
      await pause(60)
      assert.equal(tache(texte, 2).n, 3)
    }
    finally {
      window.close()
    }
  })

  it('chaînes optionnelles : `?.` sur la liste de l\'élément, sur l\'appel, sur la clé du magasin', async () => {
    const { window, comp, texte } = await taches()
    try {
      const carte = () => comp._shadow?.querySelector('.carte')?.textContent
      assert.equal(comp.optListe(1), 1, 'push rend la nouvelle longueur')
      assert.equal(window.µ.__appels, 1, 'élément cherché une seule fois')
      assert.equal(comp.optAppel('a'), 1)
      assert.equal(comp.optAppel('zz'), undefined)
      assert.equal(comp.optBase('a'), undefined, 'clé absente du magasin : la chaîne s\'arrête, sans erreur')
      await pause(60)
      assert.deepEqual(tache(texte, 1).tags, ['l'])
      assert.equal(carte(), '[["a",{"n":1,"tags":["p"]}]]')
    }
    finally {
      window.close()
    }
  })

  it('find qui ne trouve rien : la TypeError de l\'écriture, comme sans MJS, pas un silence', async () => {
    const { window, comp } = await taches()
    try {
      const ecriture = (cle: string) => (e: any) => e?.name === 'TypeError' && /Cannot set propert/.test(e.message) && e.message.includes(`'${cle}'`)
      assert.throws(() => comp.absent(), ecriture('fait'))
      assert.throws(() => comp.absentVar(), ecriture('n'))
      assert.equal(comp.option('zz'), undefined, 'chaîne optionnelle : élément absent, rien n\'est écrit ni levé')
      assert.equal(comp.optEcrit('zz'), undefined)
      assert.equal(comp.optEfface('zz'), true, 'delete par `?.` sur un élément absent : true, comme en JavaScript')
    }
    finally {
      window.close()
    }
  })

  it('`?.` puis = : la valeur écrite est rendue', async () => {
    const { window, comp } = await taches()
    try {
      comp.optLu('a')
      assert.equal(window.µ.__lu, 7)
    }
    finally {
      window.close()
    }
  })

  it('n += (m++) sur deux éléments trouvés : chaque écriture vise son objet, chaque prédicat passe une fois', async () => {
    const { window, comp, texte } = await taches()
    try {
      comp.incr(2)
      window.µ.__appels = 0
      comp.imbrique(1, 2)
      // find(1) passe un élément, find(2) deux : un prédicat rappelé ferait plus de 3
      assert.equal(window.µ.__appels, 3)
      await pause(60)
      assert.equal(tache(texte, 1).n, 1)
      assert.equal(tache(texte, 2).n, 2)
    }
    finally {
      window.close()
    }
  })

  it('variable qui garde l\'élément, puis unshift : l\'écriture va à l\'objet tenu et redessine', async () => {
    const { window, comp, texte } = await taches()
    try {
      await comp.tenu(2)
      await pause(60)
      const liste = JSON.parse(texte() ?? '[]')
      assert.equal(liste.length, 4)
      assert.equal(tache(texte, 2).fait, true)
      assert.equal(tache(texte, 0).fait, false, 'le nouvel élément de rang 0 n\'est pas touché')
    }
    finally {
      window.close()
    }
  })

  it('clé calculée entre l\'élément trouvé et la cible : le prototype et la fonction où mènent __proto__ et constructor sont refusés, comme par le chemin', async () => {
    // [forme, arguments, objet visé, segment que nomme l'avertissement]
    const formes: [string, string[], string, string][] = [['proto', ['__proto__', 'pollueA'], 'Object.prototype', '__proto__'], ['proto', ['constructor', 'pollueB'], 'Object', 'constructor'], ['protoVar', ['__proto__', 'pollueC'], 'Object.prototype', '__proto__'], ['protoPlus', ['__proto__', 'pollueD'], 'Object.prototype', '__proto__']]
    for (const [methode, args, cible, seg] of formes) {
      const messages: string[] = []
      const { window, comp } = await taches()
      try {
        window.µ.warn = (m: string) => messages.push(m)
        comp[methode](...args)
        assert.equal(window.eval(`Object.prototype.hasOwnProperty.call(${cible}, '${args[1]}')`), false, `${methode}(${args}) : ${cible} intact`)
        assert.equal(messages.length, 1, `${methode}(${args}) : un avertissement`)
        assert.match(messages[0], new RegExp(`segment « ${seg} »`))
      }
      finally {
        window.eval(`delete ${cible}.${args[1]}`)
        window.close()
      }
    }
    // par le chemin, chaque clé passe le refus d'un nom réservé : rien n'est écrit, l'avertissement nomme le segment
    const messages: string[] = []
    const { window, comp } = await taches()
    try {
      window.µ.warn = (m: string) => messages.push(m)
      comp.protoChemin('__proto__', 'pollueE')
      assert.equal(window.eval('Object.prototype.hasOwnProperty.call(Object.prototype, \'pollueE\')'), false, 'protoChemin : Object.prototype intact')
      assert.equal(messages.length, 1)
      assert.match(messages[0], /segment « __proto__ »/)
    }
    finally {
      window.eval('delete Object.prototype.pollueE')
      window.close()
    }
  })

  it('clé calculée : delete et méthode refusent le prototype atteint ; une clé permise écrit et redessine', async () => {
    const messages: string[] = []
    const { window, comp, texte } = await taches((w) => w.eval('Object.defineProperty(Object.prototype, "__temoin", { value: 1, configurable: true, writable: true })'))
    try {
      window.µ.warn = (m: string) => messages.push(m)
      comp.protoEfface('__proto__', '__temoin')
      assert.equal(window.eval('Object.prototype.hasOwnProperty("__temoin")'), true, 'delete : le témoin d\'Object.prototype reste')
      comp.protoPousse('__proto__')
      assert.equal(window.eval('Array.prototype.length'), 0, 'push : Array.prototype ne reçoit rien')
      assert.equal(comp.protoOpt('__proto__'), undefined, 'push par `?.` : refusé, `undefined`')
      assert.equal(window.eval('Array.prototype.length'), 0)
      assert.equal(messages.length, 3)
      assert.ok(messages.every((m) => /segment « __proto__ »/.test(m)), JSON.stringify(messages))
      comp.proto('meta', 'vu')
      await pause(60)
      assert.equal(tache(texte, 1).meta.vu, 'pollue')
    }
    finally {
      window.eval('delete Object.prototype.__temoin; Array.prototype.length = 0')
      window.close()
    }
  })

  it('nom réassigné, paramètre, copies (slice, map, filter), variable de boucle : aucune notification, l\'écriture va là où JavaScript l\'envoie', async () => {
    const { window, comp } = await taches()
    try {
      const raw = window.µ._mjs_storeRaw
      assert.deepEqual(prevenues(window, () => comp.reassigne(2)), [])
      assert.equal(window.µ.__t7.fait, true)
      assert.equal(raw.taches[1].fait, false)
      assert.deepEqual(prevenues(window, () => comp.copies()), [])
      assert.deepEqual([...window.µ.__copies], [4, true, 1])
      assert.equal(raw.taches.length, 3)
      assert.equal(raw.taches[0].fait, false, 'copie : la liste du magasin n\'est pas écrite')
      assert.deepEqual(prevenues(window, () => comp.param(raw.taches[0])), [])
      assert.equal(raw.taches[0].fait, true, 'paramètre : l\'objet reçu est écrit tel quel')
      assert.deepEqual(prevenues(window, () => comp.boucle()), [])
      assert.equal(raw.taches[2].fait, true, 'variable de boucle : l\'élément est écrit tel quel')
    }
    finally {
      window.close()
    }
  })

  it('magasin typé : la règle refuse une mauvaise valeur écrite par find, comme par le chemin', async () => {
    for (const methode of ['parFind', 'parChemin']) {
      const messages: string[] = []
      const { window, comp, texte } = await monter(codeFlux, 'mjs-flux-find', '.v', (w) => {
        w.µ._typesMode = 'warn'
        w.µ.warn = (m: string) => messages.push(m)
      })
      try {
        comp[methode]()
        await pause(60)
        assert.equal(window.µ._mjs_storeRaw.flux[1].id, 1, `${methode} : la valeur d'avant reste`)
        assert.equal(texte(), '1')
        assert.ok(messages.some((m) => m.includes("$$flux[1].id refuse 'zz'")), `${methode} : ${messages.join(' | ')}`)
      }
      finally {
        window.close()
      }
    }
  })

  it('µeffect qui cumule par find (+= 1) : passe une fois au montage, sans se relancer sur sa propre écriture', async () => {
    const { window, texte } = await monter(codeEffet, 'mjs-effet-find', '.n')
    try {
      await pause(120)
      assert.equal(window.µ._mjs_storeRaw.compteurs[0].n, 1)
      assert.equal(texte(), '1')
    }
    finally {
      window.close()
    }
  })

  // composant `lang="coffee"` et module `.coffee` : CoffeeScript écrit `?.`, `||=`, `&&=`, `?=` par une variable de
  // travail (`ref`, `base`), et une variable par `var t;` puis `t = …`
  async function coffee() {
    return monter(codeCoffee, 'mjs-liste-coffee', '.liste')
  }

  const element = (t: () => string | undefined, id: number) => tache(t, id)
  const casCoffee: [string, string, (t: () => string | undefined, c: () => string | undefined, o: () => string | undefined) => void][] = [
    ['find direct', 'direct(2)', (t) => assert.equal(element(t, 2).fait, true)],
    ['`?.` puis =', 'optEcrit(\'a\')', (_t, c) => assert.equal(c(), '[["a",{"n":9,"tags":[]}]]')],
    ['`?.` puis +=', 'optPlus(\'a\')', (_t, c) => assert.equal(c(), '[["a",{"n":3,"tags":[]}]]')],
    ['`?.` puis ++', 'optIncr(\'a\')', (_t, c) => assert.equal(c(), '[["a",{"n":2,"tags":[]}]]')],
    ['`?.` puis delete', 'optEfface(\'a\')', (_t, c) => assert.equal(c(), '[["a",{"n":1}]]')],
    ['`?.` puis méthode', 'optPousse(\'a\')', (_t, c) => assert.equal(c(), '[["a",{"n":1,"tags":["o"]}]]')],
    ['||=', 'ouEgal(2)', (t) => assert.equal(element(t, 2).note, 'ou')],
    ['&&=', 'etEgal(1)', (t) => assert.equal(element(t, 1).note, 'et')],
    ['?=', 'nulEgal(1)', (t) => assert.equal(element(t, 1).meta.absent, 'nul')],
    ['||= sur un chemin du magasin', 'cheminOu()', (_t, _c, o) => assert.equal(o(), '{"a":{"b":1,"c":"chemin"}}')],
    ['variable affectée une seule fois', 'variable(2)', (t) => {
      const e = element(t, 2)
      assert.equal(e.n, 1)
      assert.deepEqual(e.tags, ['v'])
      assert.equal('note' in e, false)
    }],
    ['alias d\'un chemin', 'alias()', (_t, _c, o) => assert.equal(o(), '{"a":{"b":5}}')],
    ['module .coffee importé, variable', 'viaModule(1)', (t) => assert.equal(element(t, 1).fait, true)],
    ['module .coffee importé, `?.` puis méthode', 'viaModuleOpt(\'a\')', (_t, c) => assert.equal(c(), '[["a",{"n":1,"tags":["m"]}]]')],
    ['module .coffee importé, ||=', 'viaModuleOu(2)', (t) => assert.equal(element(t, 2).note, 'module')],
    ['module .coffee importé, `?.` puis =', 'viaModuleEcrit(\'a\')', (_t, c) => assert.equal(c(), '[["a",{"n":9,"tags":[]}]]')],
  ]

  for (const [nom, appel, verifie] of casCoffee) {
    it(`CoffeeScript, ${nom} : ${appel} redessine`, async () => {
      const { window, comp, texte } = await coffee()
      try {
        const carte = () => comp._shadow?.querySelector('.carte')?.textContent
        const objet = () => comp._shadow?.querySelector('.obj')?.textContent
        comp[appel.slice(0, appel.indexOf('('))](...JSON.parse(`[${appel.slice(appel.indexOf('(') + 1, -1).replace(/'/g, '"')}]`))
        await pause(60)
        verifie(texte, carte, objet)
      }
      finally {
        window.close()
      }
    })
  }

  it('CoffeeScript : élément absent, la TypeError de l\'écriture ; clé calculée __proto__ : le prototype atteint est refusé', async () => {
    const messages: string[] = []
    const { window, comp } = await coffee()
    try {
      window.µ.warn = (m: string) => messages.push(m)
      assert.throws(() => comp.absent(), (e: any) => e?.name === 'TypeError' && /Cannot set propert/.test(e.message))
      assert.equal(comp.optEcrit('zz'), undefined)
      comp.proto('__proto__', 'pollueF')
      assert.equal(window.eval('Object.prototype.hasOwnProperty("pollueF")'), false)
      assert.equal(messages.length, 1)
      assert.match(messages[0], /segment « __proto__ »/)
    }
    finally {
      window.eval('delete Object.prototype.pollueF')
      window.close()
    }
  })

  it('CoffeeScript : nom réassigné, paramètre, copies, variable de boucle : aucune notification, l\'écriture va là où JavaScript l\'envoie', async () => {
    const { window, comp } = await coffee()
    try {
      const raw = window.µ._mjs_storeRaw
      assert.deepEqual(prevenues(window, () => comp.reassigne(2)), [])
      assert.equal(window.µ.__w.fait, true)
      assert.equal(raw.liste[1].fait, false)
      assert.deepEqual(prevenues(window, () => comp.copies()), [])
      assert.deepEqual([...window.µ.__copies], [3, true, 0])
      assert.equal(raw.liste.length, 2)
      assert.equal(raw.liste[0].fait, false, 'copie : la liste du magasin n\'est pas écrite')
      assert.deepEqual(prevenues(window, () => comp.param(raw.liste[0])), [])
      assert.equal(raw.liste[0].fait, true)
      assert.deepEqual(prevenues(window, () => comp.boucle()), [])
      assert.equal(raw.liste[1].fait, true)
    }
    finally {
      window.close()
    }
  })

  const j = (v: any) => JSON.stringify(v)

  async function regle(code = codeRegle, balise = 'mjs-regle-civet') {
    return monter(code, balise, '.etat')
  }

  it('alias du magasin, Civet : il écrit dans l\'objet qu\'il tient, comme JavaScript, puis prévient la clé ; jamais pris, la TypeError', async () => {
    const { window, comp, texte } = await regle()
    try {
      const raw = window.µ._mjs_storeRaw
      comp.apresCle()
      assert.equal(j(raw.cfg), '{"a":{"b":100}}', 'sous := $$cfg.a puis $$cfg = autre : la nouvelle valeur reste')
      assert.deepEqual({ ...window.µ.__ancien }, { b: 1 }, 'l\'ancien objet est écrit')
      comp.sansValeurApres()
      assert.equal(j(raw.cfg), '{"a":{"b":200}}', 'let w puis w = $$cfg.a : la nouvelle valeur reste')
      assert.deepEqual({ ...window.µ.__ancien }, { b: 2 })
      assert.throws(() => comp.sansValeur(false), /TypeError: Cannot set properties of undefined \(setting 'b'\)/)
      assert.equal(j(raw.cfg), '{"a":{"b":200}}', 'alias jamais pris : rien d\'écrit')
      assert.deepEqual(prevenues(window, () => comp.sansValeur(true)), ['cfg'])
      assert.equal(j(raw.cfg), '{"a":{"b":7}}')
      comp.apresUnshift()
      assert.equal(j(raw.liste.map((x: any) => [x.id, x.fait])), '[[0,false],[1,true],[2,false]]', 'l\'ancien premier est coché, pas le nouveau')
      assert.deepEqual(prevenues(window, () => comp.parIndice(2)), ['liste'], 'it := $$liste[i] : l\'objet tenu, la clé prévenue')
      assert.throws(() => comp.bloc(false), /TypeError: Cannot set properties of undefined \(setting 'vu'\)/)
      assert.deepEqual(prevenues(window, () => comp.bloc(true)), ['liste'], 'première apparition dans un bloc : suivie')
      await pause(60)
      assert.match(texte()!, /^\[\{"id":0,"fait":false\},\{"id":1,"fait":true,"vu":true\},\{"id":2,"fait":true\}\] \{"a":\{"b":7\}\}/)
    }
    finally {
      window.close()
    }
  })

  it('alias du magasin, CoffeeScript : il écrit dans l\'objet qu\'il tient ; affectation conditionnelle ou return anticipé non pris, la TypeError', async () => {
    const { window, comp, texte } = await regle(codeRegleC, 'mjs-regle-coffee')
    try {
      const raw = window.µ._mjs_storeRaw
      comp.apresCle()
      assert.equal(j(raw.cfg), '{"a":{"b":100}}')
      assert.deepEqual({ ...window.µ.__ancien }, { b: 1 })
      comp.apresUnshift()
      assert.equal(j(raw.liste.map((x: any) => [x.id, x.fait])), '[[0,false],[1,true],[2,false]]')
      assert.throws(() => comp.cond(false), /TypeError: Cannot set properties of undefined \(setting 'b'\)/)
      assert.throws(() => comp.retour(false), /TypeError: Cannot set properties of undefined \(setting 'b'\)/)
      assert.equal(j(raw.cfg), '{"a":{"b":100}}')
      assert.deepEqual(prevenues(window, () => comp.cond(true)), ['cfg'])
      assert.equal(j(raw.cfg), '{"a":{"b":7}}')
      comp.rappel('a')
      await pause(60)
      assert.match(texte()!, /\[\["a",\{"n":60,"tags":\[\]\}\]\]$/, 'variable de travail redéclarée dans un rappel : l\'écriture de la méthode redessine')
    }
    finally {
      window.close()
    }
  })

  it('gardes de prudence : paramètre homonyme, boucle, affectation dans une autre fonction, autre valeur, seconde déclaration — rien de prévenu, l\'écriture va où JavaScript l\'envoie', async () => {
    const c = await regle()
    try {
      const raw = c.window.µ._mjs_storeRaw
      assert.deepEqual(prevenues(c.window, () => c.comp.memeFonction()), [])
      assert.equal(raw.cfg.a.b, 4)
      assert.deepEqual(prevenues(c.window, () => c.comp.autres()), [])
      assert.equal(c.window.µ.__w2.b, 3)
      assert.equal(raw.cfg.a.b, 4)
      assert.deepEqual(prevenues(c.window, () => c.comp.seconde()), [])
      assert.equal(raw.cfg.a.b, 6)
    }
    finally {
      c.window.close()
    }
    const k = await regle(codeRegleC, 'mjs-regle-coffee')
    try {
      const raw = k.window.µ._mjs_storeRaw
      const recu = { b: 0 }
      assert.deepEqual(prevenues(k.window, () => k.comp.aliasB(recu)), [])
      assert.equal(recu.b, 2, 'paramètre homonyme : l\'objet reçu est écrit')
      assert.deepEqual(prevenues(k.window, () => k.comp.aliasA()), [])
      assert.equal(raw.cfg.a.b, 1)
      assert.deepEqual(prevenues(k.window, () => k.comp.boucleUne()), [])
      assert.equal(raw.liste[0].fait, true)
    }
    finally {
      k.window.close()
    }
  })

  it('noms réservés écrits en clair après l\'élément (constructor, __proto__) : la fonction et le prototype atteints sont refusés ; élément absent et clé réservée : la TypeError de la lecture', async () => {
    const avis: string[] = []
    const { window, comp } = await monter(codeRegle, 'mjs-regle-civet', '.etat', (w) => { w.µ.warn = (m: string) => avis.push(m) })
    try {
      comp.reserveClair()
      comp.reserveProto()
      assert.equal(window.eval('Object.hasOwnProperty("pollueC")'), false, 'constructor : Object intact')
      assert.equal(window.eval('Object.prototype.hasOwnProperty("pollueP")'), false, '__proto__ : Object.prototype intact')
      window.eval('delete Object.pollueC; delete Object.prototype.pollueP')
      assert.deepEqual(avis.map((m) => (m.match(/segment « (\w+) »/) || [])[1]), ['constructor', '__proto__'])
      avis.length = 0
      assert.throws(() => comp.absentReserve('__proto__'), /TypeError: Cannot read properties of undefined \(reading '__proto__'\)/)
      const natif = window.eval('(() => { try { const o = undefined; return o[[\'__proto__\']] } catch (e) { return e.message } })()')
      assert.throws(() => comp.absentReserve(['__proto__']), (e: any) => e.name === 'TypeError' && e.message === natif)
    }
    finally {
      window.close()
    }
  })

  it('delete rend true comme JavaScript : par find, par `?.`, par un alias, par le chemin, à la racine', async () => {
    const { window, comp } = await regle()
    try {
      const raw = window.µ._mjs_storeRaw
      for (const [appel, faire, efface] of [
        ['find', () => comp.effaceFind(), () => !('note' in raw.taches[0])],
        ['?. présent', () => comp.effaceOpt('a'), () => !('tags' in raw.m.get('a'))],
        ['?. absent', () => comp.effaceOpt('zz'), () => true],
        ['chemin', () => comp.effaceChemin(), () => !('vu' in raw.taches[0].meta)],
        ['alias', () => comp.effaceAlias(), () => !('tags' in raw.taches[0])],
        ['racine', () => comp.effaceRacine(), () => !('vieux' in raw)],
      ] as [string, () => void, () => boolean][]) {
        window.µ.__d = 'pas rendu'
        faire()
        assert.equal(window.µ.__d, true, appel)
        assert.equal(efface(), true, `${appel} : supprimé`)
      }
    }
    finally {
      window.close()
    }
    const k = await regle(codeRegleC, 'mjs-regle-coffee')
    try {
      for (const m of ['effaceOpt', 'effaceAlias']) {
        k.window.µ.__d = 'pas rendu'
        k.comp[m]()
        assert.equal(k.window.µ.__d, true, `CoffeeScript ${m}`)
      }
      assert.equal(j(k.window.µ._mjs_storeRaw.cfg), '{"a":{}}')
    }
    finally {
      k.window.close()
    }
  })

  it('objet de `++` évalué une fois dans une variable locale : un accesseur qui écrit par find pendant la lecture ne détourne pas l\'écriture ; clé à virgule écrite comme en JavaScript', async () => {
    const { window, comp } = await regle()
    try {
      const raw = window.µ._mjs_storeRaw
      comp.caseLocale()
      assert.equal(window.µ.__v, 1)
      assert.equal(raw.a[0]._n, 2, 'l\'élément trouvé reçoit l\'incrément')
      assert.deepEqual({ ...raw.b[0] }, { id: 1, n: 5 }, 'l\'autre élément n\'est pas touché')
      assert.equal('_mjs_storeObj' in window.µ, false, 'aucune case partagée')
      comp.virgule()
      assert.equal(raw.taches[0].meta.vu, 'virgule')
      comp.litteral()
      assert.equal(raw.taches[0].meta.lu, true)
      assert.doesNotMatch(codeRegle, /_mjs_storeObj/)
      const litteral = codeRegle.slice(codeRegle.indexOf('this.litteral'), codeRegle.indexOf('this.effaceFind'))
      assert.doesNotMatch(litteral, /_mjs_storeAt/, 'clé littérale permise : aucune navigation gardée')
    }
    finally {
      window.close()
    }
  })

  it('construction de production (noms raccourcis) : find, variable, `?.`, ||=, modules .civet et .coffee redessinent', async () => {
    const window: any = new Window({ url: 'http://localhost/' })
    try {
      window.eval(codeProd)
      window.document.body.innerHTML = '<mjs-taches-find></mjs-taches-find><mjs-liste-coffee></mjs-liste-coffee>'
      const civet = window.document.querySelector('mjs-taches-find')
      const cof   = window.document.querySelector('mjs-liste-coffee')
      const lu    = (c: any, s: string) => c._shadow?.querySelector(s)?.textContent
      await attendre(() => !!lu(civet, '.etat') && !!lu(cof, '.liste'))
      civet.parFind(2)
      civet.variable(3)
      civet.optEcrit('a')
      civet.viaModule(1)
      cof.optPousse('a')
      cof.ouEgal(2)
      cof.variable(1)
      cof.viaModuleEcrit('a')
      civet.proto('meta', 'vu')
      civet.proto('__proto__', 'pollueProd')
      civet.proto(['constructor'], 'pollueProdC')
      await pause(80)
      const etat = () => lu(civet, '.etat')
      assert.equal(tache(etat, 2).fait, true)
      assert.equal(tache(etat, 3).fait, true)
      assert.equal(tache(etat, 1).fait, true)
      assert.equal(lu(civet, '.carte'), '[["a",{"n":9,"tags":[]}]]')
      const liste = () => lu(cof, '.liste')
      assert.equal(tache(liste, 2).note, 'ou')
      assert.equal(tache(liste, 1).n, 1)
      assert.equal(lu(cof, '.carte'), '[["a",{"n":9,"tags":["o"]}]]')
      assert.equal(tache(etat, 1).meta.vu, 'pollue', 'clé permise')
      assert.equal(window.eval('Object.prototype.hasOwnProperty("pollueProd")'), false, '__proto__ : le prototype atteint est refusé')
      assert.equal(window.eval('Object.hasOwnProperty("pollueProdC")'), false, 'constructor : la fonction atteinte est refusée')
      window.eval('delete Object.prototype.pollueProd; delete Object.pollueProdC')
    }
    finally {
      window.close()
    }
    // alias du magasin en production : une fenêtre par composant, leurs clés du magasin se recouvrent
    for (const balise of ['mjs-regle-civet', 'mjs-regle-coffee']) {
      const w: any = new Window({ url: 'http://localhost/' })
      try {
        w.eval(codeProd)
        w.document.body.innerHTML = `<${balise}></${balise}>`
        const c = w.document.querySelector(balise)
        await attendre(() => !!c._shadow?.querySelector('.etat')?.textContent)
        c.apresUnshift()
        await pause(80)
        assert.match(c._shadow.querySelector('.etat').textContent, /^\[\{"id":0,"fait":false\},\{"id":1,"fait":true\},\{"id":2,"fait":false\}\]/, balise)
        assert.throws(() => (balise === 'mjs-regle-civet' ? c.sansValeur(false) : c.cond(false)), /Cannot set properties of undefined/)
      }
      finally {
        w.close()
      }
    }
  })
})
