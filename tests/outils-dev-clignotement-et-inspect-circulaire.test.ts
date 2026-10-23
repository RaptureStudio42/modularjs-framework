// outils de développement : « clignoter au rendu » rend le contour d'origine même après deux rendus rapprochés ;
// µinspect($x.chemin) sur une valeur qui se référence elle-même ne lève plus et voit toujours les changements
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const lire = (f: string) => readFileSync(join(__dirname, '../src/runtime/' + f), 'utf8')
const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

describe('mjs_debug — clignoter au rendu', function() {
  this.timeout(5000)

  it('deux rendus à 10 ms d écart : contour et transition d origine rendus', async () => {
    class FauxComposant { style: any = { outline: '1px dotted red', transition: 'opacity 1s' }; _mjs_runEffectsV2() { return 'rendu' } }
    const µ: any = { debug: false, Element: FauxComposant }
    new Function('µ', 'window', lire('mjs_debug.ts'))(µ, {})
    µ.debugMode = true
    const el: any = new FauxComposant()
    assert.equal(el._mjs_runEffectsV2(null, true), 'rendu')
    await tick(10)
    el._mjs_runEffectsV2(null, true)
    assert.equal(el.style.outline, '2px solid rgba(0, 255, 0, 0.9)')
    await tick(800)
    assert.equal(el.style.outline, '1px dotted red', 'le contour vert reste collé')
    assert.equal(el.style.transition, 'opacity 1s', 'la transition du composant est perdue')
  })
})

describe('mjs_inspect — valeur qui se référence elle-même', function() {
  it('µinspect($x.arbre) : l affichage ne lève pas et voit le changement suivant', () => {
    const µ: any = { activeComponent: null, warn: () => {}, _mjs_msg: (_k: any, _v: any, d: string) => d, _mjs_snap: (v: any) => v }
    new Function('µ', lire('mjs_inspect.ts'))(µ)
    const el: any = { _state: {} }
    µ.activeComponent = el
    µ.inspect('x', 'arbre')
    const noeud: any = { nom: 'racine', enfants: [] }
    noeud.enfants.push({ nom: 'fils', parent: noeud })
    el._state.x = { arbre: noeud }
    const groupes: string[] = []
    const log = console.log, group = console.group, end = console.groupEnd, warn = console.warn
    console.log = () => {}; console.group = (t: any) => { groupes.push(String(t)) }; console.groupEnd = () => {}; console.warn = () => {}
    let err: any = null
    try {
      µ._mjs_inspectAffiche(el, 'x', undefined)
      noeud.enfants[0].nom = 'autre fils'
      µ._mjs_inspectAffiche(el, 'x', undefined)
      µ._mjs_inspectAffiche(el, 'x', undefined)
    }
    catch (e) { err = e }
    finally { console.log = log; console.group = group; console.groupEnd = end; console.warn = warn }
    assert.equal(err, null, 'exception : ' + (err && err.message))
    assert.equal(groupes.length, 2, 'affichages : ' + JSON.stringify(groupes))
  })
})
