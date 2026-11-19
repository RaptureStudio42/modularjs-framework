// µinspect($x.chemin) dont le chemin mène à une Map ou un Set : un changement de ses entrées s'affiche (From/To), un contenu égal
// ne s'affiche pas — l'égalité compare les entrées, pas les seules clés propres (vides pour une Map et un Set)
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { lireRuntime } from './helpers/runtime-projete.js'

describe('µinspect($x.chemin) — chemin vers une Map ou un Set', () => {
  let sandbox: any

  before(() => {
    // même harnais que tests/inspect-chemin.test.ts : runtime chargé en bac à sable, µ.inspect ne touche jamais le DOM
    const initJs    = lireRuntime(resolvePath('src/runtime/mjs_init.ts'))
    const deepJs    = lireRuntime(resolvePath('src/runtime/mjs_deep.ts'))
    const elemJs    = lireRuntime(resolvePath('src/runtime/mjs_element.ts'))
    const runesJs   = readFileSync(resolvePath('src/runtime/mjs_runes.ts'), 'utf-8')
    const inspectJs = readFileSync(resolvePath('src/runtime/mjs_inspect.ts'), 'utf-8')
    const setup = `
      class HTMLElement {
        constructor() {}
        attachShadow(opts) { return { adoptedStyleSheets: [], appendChild() {} }; }
        addEventListener() {} removeEventListener() {} dispatchEvent() {}
        getAttribute() { return null }; setAttribute() {}
      }
      class CustomEvent { constructor(name, init) { this.type = name; Object.assign(this, init || {}); } }
      class CSSStyleSheet { replaceSync() {} }
      class Node { static ELEMENT_NODE = 1; static TEXT_NODE = 3; static COMMENT_NODE = 8; static DOCUMENT_FRAGMENT_NODE = 11; }
      const customElements = { get: () => null, define: () => {} };
      const document = { adoptedStyleSheets: [] };
      ${initJs.replace(/export\s*\{[^}]*\}/, '')}
      ${deepJs}
      ${elemJs}
      ${runesJs.replace(/^import[^;]*;?$/gm, '').replace(/export\s*\{[^}]*\}/, '')}
      ${inspectJs.replace(/^import[^;]*;?$/gm, '').replace(/export\s*\{[^}]*\}/, '')}
      class MjsInspectMapTest extends µ.Element {
        constructor() {
          super();
          this._mjs_var_bits = { x: 1 };
        }
      }
      return { µ, MjsInspectMapTest };
    `
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    sandbox = (new Function(setup))()
  })

  function groupes(avant: any, apres: any): string[] {
    const { µ, MjsInspectMapTest } = sandbox
    const el = new MjsInspectMapTest()
    µ.activeComponent = el
    µ.inspect('x', 'm')
    µ.activeComponent = null
    µ._set(el, 'x', { m: avant })
    const vus: string[] = []
    const garde = { log: console.log, group: console.group, groupEnd: console.groupEnd }
    console.log = () => {}
    console.group = (label: any) => { vus.push(String(label)) }
    console.groupEnd = () => {}
    try { µ._set(el, 'x', { m: apres }) }
    finally { Object.assign(console, garde) }
    return vus
  }

  it('Map dont une valeur change : From/To affichés', () => {
    const vus = groupes(new Map([['a', 1]]), new Map([['a', 2]]))
    assert.ok(vus.some((g) => g.includes('x.m')), `groupe attendu : ${JSON.stringify(vus)}`)
  })

  it('Set dont une valeur change : From/To affichés', () => {
    const vus = groupes(new Set([1]), new Set([2]))
    assert.ok(vus.some((g) => g.includes('x.m')), `groupe attendu : ${JSON.stringify(vus)}`)
  })

  it('Map au contenu égal (nouvelle identité) : rien d\'affiché', () => {
    assert.deepEqual(groupes(new Map([['a', { n: 1 }]]), new Map([['a', { n: 1 }]])), [])
  })
})
