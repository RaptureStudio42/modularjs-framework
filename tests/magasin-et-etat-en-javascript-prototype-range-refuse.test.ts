// `µ.state` et `µ.Store` maniés en JavaScript (l'état ou le magasin tenu par une variable ordinaire) : un prototype qui y est rangé —
// `Array.prototype`, `Object.prototype`, `Map.prototype`, `Set.prototype`, le prototype d'une classe de l'appli, celui d'une classe qui
// hérite d'`Array`, là où mène une clé venue de données qui vaut `__proto__` — ne reçoit rien par leurs enveloppes : `push`, `unshift`,
// `splice` sur `Array.prototype` vide, `pop`, `shift`, `sort`, `reverse`, `fill`, `copyWithin` sur un garni, la copie d'une fonction du
// navigateur rangée dans le magasin appelée avec ce prototype pour `this` (`.call`), une affectation, `Object.assign`, `Object.defineProperty`,
// `__defineGetter__`, `delete`, une méthode remplacée, `Object.setPrototypeOf`, `Object.preventExtensions` ; rangé dans une liste puis
// retiré (`pop`, `shift`, `splice`), il sort par l'enveloppe, muré. Rien n'est écrit, un
// avertissement nomme le segment (développement) ; une définition, un changement de prototype et une fermeture aux ajouts lèvent leur
// TypeError, comme par l'enveloppe d'un composant. Un objet ordinaire et une vraie liste gardent toutes leurs écritures, et la vue d'un
// composant qui les lit, et lit le magasin `$$mag`, suit comme avant. Développement et production, avec et sans le réglage `proxy: false`

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const SOURCE = `<script>
  $$mag = { o: { a: 1 }, l: [1, 2] }
  etat = µ.state({ o: { a: 1 }, x: null, l: [1, 2] })
  boite = new µ.Store({ o: { a: 1 }, x: null, l: [1, 2] })
  @range = (n) ->
    Object.assign(etat.o, n)
    Object.assign(boite.data.o, n)
  @poser = (v) ->
    etat.x = v
    boite.data.x = v
  @lireEtat = -> etat
  @lireBoite = -> boite.data
</script>

<p class="vue">{etat.o.a} {etat.l.length} {boite.data.o.a} {boite.data.l.length} {$$mag.o.a} {$$mag.l.length}</p>
`

// les quatre constructions : [nom, production, réglages]
const VARIANTES: [string, boolean, Record<string, unknown>][] = [
  ['développement', false, {}],
  ['production', true, {}],
  ['développement, proxy: false', false, { proxy: false }],
  ['production, proxy: false', true, { proxy: false }]
]

// l'état ou le magasin tenu par le composant, lu en JavaScript
const FAMILLES: Record<string, (c: any) => any> = { 'µ.state': (c) => c.lireEtat(), 'µ.Store': (c) => c.lireBoite() }
const VIDES: Record<string, unknown[]>  = { push: [7], unshift: [7], splice: [0, 0, 7] }
const GARNIS: Record<string, unknown[]> = { pop: [], shift: [], sort: [], reverse: [], fill: [9], copyWithin: [0, 1] }
// les autres prototypes, tels que la page les donne
const PROTOS: Record<string, string> = {
  'Object.prototype':                            'Object.prototype',
  'Map.prototype':                               'Map.prototype',
  'Set.prototype':                               'Set.prototype',
  'prototype d\'une classe de l\'appli':         '(class Pt { m() { return 1 } }).prototype',
  'prototype d\'une classe qui hérite d\'Array': '(class Liste extends Array {}).prototype'
}
// les formes qui lèvent leur TypeError, dans l'ordre où elles sont jouées
const LEVENT = ['defineProperty TypeError', '__defineGetter__ TypeError', 'setPrototypeOf TypeError', 'preventExtensions TypeError']

// production en un seul fichier, ou développement (tout le JavaScript, le cœur d'abord)
async function construire(nom: string, prod: boolean, opts: Record<string, unknown>): Promise<string> {
  const root   = mjsTmp('mur-magasin-' + nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'mm-mur.mjs'), SOURCE)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(prod ? outDir : root, 'bundle.js'), ...(prod ? { env: 'prod', js: 'bundle', urlPrefix: '/out' } : {}), ...opts } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [])
  if (prod) return readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
  const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b) || a.localeCompare(b))
  return files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;\n'
}

// une page neuve : un prototype écrit par une scène rouge ne gâte pas la suivante ; `strict` : le code lu en mode strict, comme un
// module de la page (une variable non déclarée y lève)
async function monter(code: string, prod: boolean, strict = false) {
  const window: any = new Window({ url: 'http://localhost/' })
  const avis: string[] = []
  window.eval(strict ? '\'use strict\';\n' + code : code)
  // production : `µ` n'est pas exposé, l'avertissement n'est pas lu
  if (!prod) window.µ.warn = (m: string) => avis.push(String(m))
  window.document.body.innerHTML = '<mjs-mm-mur></mjs-mm-mur>'
  const c   = window.document.querySelector('mjs-mm-mur')
  const vue = () => c._shadow?.querySelector('.vue')?.textContent
  const fin = Date.now() + 3000
  while (!vue() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
  return { window, c, vue, avis }
}

// Array.prototype rangé : chaque méthode qui modifie une liste, sur le prototype vide ou garni, puis la copie de `[].push` rangée dans
// l'état ou le magasin, appelée avec ce prototype pour `this` ; écarts à « rien d'écrit, aucune erreur, un avertissement »
async function listes(code: string, prod: boolean, famille: string): Promise<string[]> {
  const m = await monter(code, prod)
  try {
    const AP: any   = m.window.Array.prototype
    const indices   = () => Object.getOwnPropertyNames(AP).filter((k) => k !== '' && Number.isInteger(+k))
    const etat      = () => indices().map((k) => k + '=' + AP[k]).join(',') + ' len=' + AP.length
    const nettoie   = () => {
      for (const k of indices()) delete AP[k]
      AP.length = 0
    }
    const lit       = () => FAMILLES[famille](m.c)
    const ecarts: string[] = []
    const jouer = (nom: string, garni: boolean, f: () => void) => {
      nettoie()
      if (garni) AP.push('b', 'a')
      const avant = etat()
      m.avis.length = 0
      let erreur = ''
      try {
        f()
      }
      catch (e: any) {
        erreur = ' ' + e.name
      }
      const apres = etat()
      nettoie()
      if (apres !== avant || erreur) ecarts.push(`${famille} : ${nom} → ${apres}${erreur}`)
      if (!prod && !(m.avis.length && m.avis.every((a) => a.includes('segment « __proto__ »')))) ecarts.push(`${famille} : ${nom}, avertissements ${JSON.stringify(m.avis)}`)
    }
    m.c.range({ pousse: AP.push })
    m.c.poser(AP)
    for (const [meth, a] of Object.entries(VIDES)) jouer(meth + ' sur Array.prototype vide', false, () => lit().x[meth](...a))
    for (const [meth, a] of Object.entries(GARNIS)) jouer(meth + ' sur Array.prototype garni', true, () => lit().x[meth](...a))
    jouer('copie de [].push lue de l\'objet rangé, .call(Array.prototype lu au même endroit, 7)', false, () => lit().o.pousse.call(lit().x, 7))
    return ecarts
  }
  finally {
    m.window.close()
  }
}

// un autre prototype rangé : chaque forme d'écriture par l'enveloppe ; ce qui a changé sur le prototype de la page, les formes qui ont levé
async function autres(code: string, prod: boolean, famille: string, nom: string): Promise<string[]> {
  const m = await monter(code, prod)
  try {
    const P: any = m.window.eval(PROTOS[nom])
    const m0 = P.m, get0 = P.get, add0 = P.add, proto0 = Object.getPrototypeOf(P)
    const leve: string[] = []
    const tente = (quoi: string, g: (t: any) => void) => {
      try {
        g(FAMILLES[famille](m.c).x)
      }
      catch (e: any) {
        leve.push(quoi + ' ' + e.name)
      }
    }
    m.c.poser(P)
    m.avis.length = 0
    tente('affectation', (t) => { t.polluK = 1 })
    tente('Object.assign', (t) => { Object.assign(t, { polluA: 1 }) })
    tente('defineProperty', (t) => { Object.defineProperty(t, 'polluD', { value: 1, configurable: true }) })
    tente('push', (t) => { if (typeof t.push === 'function') t.push(7) })
    tente('delete', (t) => { delete t.m })
    tente('méthode remplacée', (t) => {
      if (get0 !== undefined) t.get = 1
      if (add0 !== undefined) t.add = 1
    })
    tente('__defineGetter__', (t) => { t.__defineGetter__('polluG', () => 1) })
    tente('setPrototypeOf', (t) => { Object.setPrototypeOf(t, null) })
    tente('preventExtensions', (t) => { Object.preventExtensions(t) })
    const ecrit  = ['polluK', 'polluA', 'polluD', 'polluG', '0', 'length'].filter((k) => Object.prototype.hasOwnProperty.call(P, k))
    const vu     = [...ecrit, P.m !== m0 ? 'm retirée' : '', P.get !== get0 ? 'get remplacée' : '', P.add !== add0 ? 'add remplacée' : '', Object.getPrototypeOf(P) !== proto0 ? 'prototype changé' : '', Object.isExtensible(P) ? '' : 'fermé aux ajouts'].filter(Boolean)
    const ecarts: string[] = []
    if (vu.length) ecarts.push(`${famille} : ${nom} → ${vu.join(', ')}`)
    if (leve.join(', ') !== LEVENT.join(', ')) ecarts.push(`${famille} : ${nom}, levé : ${leve.join(', ') || 'rien'}`)
    if (!prod && !(m.avis.length && m.avis.every((a) => a.includes('segment « __proto__ »')))) ecarts.push(`${famille} : ${nom}, avertissements ${JSON.stringify(m.avis)}`)
    return ecarts
  }
  finally {
    m.window.close()
  }
}

// un objet ordinaire et une vraie liste de l'état et du magasin, un prototype rangé à côté : chaque écriture faite, la vue suit, rien
// n'est dit ; le magasin `$$mag` lu par la vue garde ses valeurs
async function permis(code: string, prod: boolean): Promise<string[]> {
  const m = await monter(code, prod)
  try {
    const ecarts: string[] = []
    const depart = m.vue()
    if (depart !== '1 2 1 2 1 2') ecarts.push(`vue au départ : ${depart}`)
    m.c.poser(m.window.Array.prototype)
    m.avis.length = 0
    for (const famille of Object.keys(FAMILLES)) {
      const d = FAMILLES[famille](m.c)
      d.o.a = 5
      Object.assign(d.o, { b: 1 })
      Object.defineProperty(d.o, 'c', { value: 1, configurable: true, writable: true, enumerable: true })
      d.o.d = 1
      delete d.o.d
      d.l.push(3)
      d.l.unshift(0)
      d.l.splice(1, 1)
      d.l.reverse()
      d.l.sort()
      d.l.fill(4, 0, 1)
      d.l.copyWithin(1, 0, 1)
      d.l.pop()
      d.l.shift()
      d.l.push(5, 6)
      const o = JSON.stringify(d.o), l = JSON.stringify(d.l)
      if (o !== '{"a":5,"b":1,"c":1}' || l !== '[4,5,6]') ecarts.push(`${famille} : ${o} ${l}`)
    }
    const fin = Date.now() + 2000
    while (m.vue() !== '5 3 5 3 1 2' && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
    if (m.vue() !== '5 3 5 3 1 2') ecarts.push(`vue après : ${m.vue()}`)
    if (!prod && m.avis.length) ecarts.push(`avertissements ${JSON.stringify(m.avis)}`)
    if (m.window.Array.prototype.length) ecarts.push('Array.prototype touché')
    return ecarts
  }
  finally {
    m.window.close()
  }
}

// un prototype rangé dans une liste de l'état ou du magasin, puis retiré (`pop`, `shift`, `splice`) : il sort par l'enveloppe, muré, comme
// l'élément retiré d'une liste d'un composant ; écarts à « rien d'écrit, aucune erreur, un avertissement »
const RETIRES: [string, string, (l: any) => void][] = [
  ['pop', 'Array.prototype', (l) => { l.pop().push(7) }],
  ['shift', 'Object.prototype', (l) => { l.shift().polluK = 1 }],
  ['splice', 'Object.prototype', (l) => { l.splice(0, 1)[0].polluK = 1 }]
]

async function retires(code: string, prod: boolean): Promise<string[]> {
  const m = await monter(code, prod, true)
  try {
    const ecarts: string[] = []
    for (const famille of Object.keys(FAMILLES)) {
      for (const [meth, nom, f] of RETIRES) {
        const P: any = m.window.eval(nom)
        const d      = FAMILLES[famille](m.c)
        d.l = m.window.eval('[' + nom + ']')
        m.avis.length = 0
        let erreur = ''
        try {
          f(d.l)
        }
        catch (e: any) {
          erreur = ' ' + e.name + ' ' + e.message
        }
        const ecrit = ['polluK', '0'].filter((k) => Object.prototype.hasOwnProperty.call(P, k))
        for (const k of ecrit) delete P[k]
        if (nom === 'Array.prototype') P.length = 0
        if (ecrit.length || erreur) ecarts.push(`${famille} : ${meth} d'une liste qui range ${nom} → ${ecrit.join(', ') || 'rien d\'écrit'}${erreur}`)
        if (!prod && !(m.avis.length && m.avis.every((a) => a.includes('segment « __proto__ »')))) ecarts.push(`${famille} : ${meth}, avertissements ${JSON.stringify(m.avis)}`)
      }
    }
    return ecarts
  }
  finally {
    m.window.close()
  }
}

describe('µ.state et µ.Store maniés en JavaScript : rien ne s\'écrit dans un prototype qui y est rangé, comme par l\'enveloppe d\'un composant', function () {
  this.timeout(240000)
  const codes: Record<string, string> = {}

  before(async function () {
    this.timeout(240000)
    for (const [nom, prod, opts] of VARIANTES) codes[nom] = await construire(nom.replace(/\W+/g, '-'), prod, opts)
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const [nom, prod] of VARIANTES) {
    it(`${nom} : Array.prototype rangé ne reçoit rien (push, unshift, splice, pop, shift, sort, reverse, fill, copyWithin, copie de [].push appelée avec lui pour this)`, async () => {
      const ecarts: string[] = []
      for (const famille of Object.keys(FAMILLES)) ecarts.push(...await listes(codes[nom], prod, famille))
      assert.deepEqual(ecarts, [])
    })

    it(`${nom} : Object.prototype, Map.prototype, Set.prototype et le prototype d'une classe rangés ne reçoivent rien (affectation, Object.assign, defineProperty, push, delete, méthode remplacée, __defineGetter__, setPrototypeOf, preventExtensions)`, async () => {
      const ecarts: string[] = []
      for (const famille of Object.keys(FAMILLES)) {
        for (const p of Object.keys(PROTOS)) ecarts.push(...await autres(codes[nom], prod, famille, p))
      }
      assert.deepEqual(ecarts, [])
    })

    it(`${nom} : un prototype rangé dans une liste puis retiré (pop, shift, splice) sort muré, code lu en mode strict`, async () => {
      assert.deepEqual(await retires(codes[nom], prod), [])
    })

    it(`${nom} : un objet ordinaire et une vraie liste gardent toutes leurs écritures, la vue qui les lit suit, le magasin $$mag garde ses valeurs`, async () => {
      assert.deepEqual(await permis(codes[nom], prod), [])
    })
  }
})
