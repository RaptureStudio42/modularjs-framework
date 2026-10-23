// µ.interp (mjs_interp.ts) fait tourner une boucle d'images et s'abonne aux événements de la partie. Appelé dans un
// composant, seul un `stop()` écrit à la main l'arrêtait : un composant détruit sans lui laissait la boucle tourner à
// chaque image et gardait ses écouteurs de partie à vie. Il est désormais rattaché au composant qui l'appelle, comme
// µevery : sa destruction coupe la boucle et les abonnements ; remis dans la page, il repart à son montage ; arrêté à
// la main, il reste arrêté. Hors composant, rien ne change : `stop()` reste le seul arrêt.
// Le composant est réduit à ses deux files (destruction, montage), celles de mjs_lifecycle.ts ; les images sont
// tirées à la main par un requestAnimationFrame factice.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(join(__dirname, '../src/runtime/mjs_interp.ts'), 'utf8')

function partie(): any {
  const ecouteurs: Record<string, Set<() => void>> = { state: new Set(), start: new Set() }
  return {
    state: { entites: { a: { x: 0 } } },
    ecouteurs,
    on(nom: string, fn: () => void) { ecouteurs[nom].add(fn); return () => { ecouteurs[nom].delete(fn) } },
    abonnes() { return ecouteurs.state.size + ecouteurs.start.size },
  }
}

function composant(): any {
  return {
    _mjs_destroy_cbs: null as any,
    _mjs_mount_cbs: null as any,
    _mjs_onDestroy(fn: () => void) { (this._mjs_destroy_cbs ||= []).push(fn); return fn },
    detruire() { const cbs = this._mjs_destroy_cbs || []; this._mjs_destroy_cbs = null; for (const f of cbs) f() },
    monter() { const cbs = this._mjs_mount_cbs || []; this._mjs_mount_cbs = null; for (const f of cbs) f.call(this) },
  }
}

function charger(comp: any): any {
  const µ: any = { state: (i: any) => ({ ...i }), warn() {}, error() {} }
  Object.defineProperty(µ, 'activeComponent', { get: () => comp })
  new Function('µ', SRC)(µ)
  return µ
}

describe('µ.interp — arrêté avec le composant qui l\'appelle', () => {
  let file: Map<number, () => void>
  let suivant = 1
  const avant: any = {}
  // une image : chaque rappel en attente est tiré une fois ; la boucle vit si elle en redemande un
  const image = (): void => { const fns = [...file.values()]; file.clear(); for (const f of fns) f() }

  beforeEach(() => {
    file = new Map()
    for (const k of ['requestAnimationFrame', 'cancelAnimationFrame']) avant[k] = { a: k in globalThis, v: (globalThis as any)[k] }
    ;(globalThis as any).requestAnimationFrame = (fn: () => void) => { file.set(suivant, fn); return suivant++ }
    ;(globalThis as any).cancelAnimationFrame = (id: number) => { file.delete(id) }
  })

  afterEach(() => {
    for (const k of ['requestAnimationFrame', 'cancelAnimationFrame']) {
      if (avant[k].a) (globalThis as any)[k] = avant[k].v
      else delete (globalThis as any)[k]
    }
  })

  it('la destruction du composant coupe la boucle et les abonnements', () => {
    const comp = composant()
    const p    = partie()
    charger(comp).interp(p, { fields: ['entites'] })
    assert.equal(p.abonnes(), 2, 'abonné à « state » et « start »')
    image()
    assert.equal(file.size, 1, 'la boucle tourne')
    comp.detruire()
    image()
    assert.equal(file.size, 0, 'plus aucune image demandée après la destruction')
    assert.equal(p.abonnes(), 0, 'plus aucun écouteur sur la partie')
  })

  it('remis dans la page, il repart à son montage et suit de nouveau la partie', () => {
    const comp = composant()
    const p    = partie()
    const vue  = charger(comp).interp(p, { fields: ['entites'] })
    comp.detruire()
    p.state.entites = { a: { x: 7 } }
    comp.monter()
    assert.equal(p.abonnes(), 2, 'de nouveau abonné')
    for (const f of p.ecouteurs.state) f()
    image()
    assert.equal(file.size, 1, 'la boucle tourne de nouveau')
    assert.equal(vue.entites.a.x, 7, 'le miroir montre l\'état courant de la partie')
    comp.detruire()
    assert.equal(p.abonnes(), 0, 'une seconde destruction coupe aussi')
  })

  it('arrêté à la main, il reste arrêté : ni la destruction ni le montage ne le relancent', () => {
    const comp = composant()
    const p    = partie()
    const vue  = charger(comp).interp(p, { fields: ['entites'] })
    vue.stop()
    comp.detruire()
    comp.monter()
    image()
    assert.equal(p.abonnes(), 0)
    assert.equal(file.size, 0)
  })

  it('hors composant : rien n\'est rattaché, stop() arrête', () => {
    const p   = partie()
    const vue = charger(null).interp(p, { fields: ['entites'] })
    image()
    assert.equal(file.size, 1)
    vue.stop()
    image()
    assert.equal(file.size, 0)
    assert.equal(p.abonnes(), 0)
  })
})
