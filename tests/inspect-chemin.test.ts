// µinspect($x.chemin) — un chemin FIXE derrière le symbole suit $x
// ENTIER (comme µinspect($x)) mais filtre l'AFFICHAGE console à ce seul chemin — une simple
// portée de sortie, pas un changement de ce que la rune observe. Compilation : sigils.ts
// (cheminInspectPlat, MU_INSPECT_ARG_BODY/OUT) et generator/utils.ts (reecritOuRejetteRuneChemin)
// — cf. mu-inspect-suffixe-jamais-orphelin.test.ts / mu-inspect-minmax-suffixe-espace-ou-appel.
// test.ts pour la matrice exhaustive des formes acceptées/refusées ; ce fichier couvre le
// contrat bout en bout (compilation ET exécution runtime du filtre).

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { cleanJs } from '../src/generator/utils.js'

describe('µinspect($x.chemin) — compilation', () => {
  it('chemin à deux segments : µinspect($x.a.b) → µ.inspect(\'x\', \'a.b\')', () => {
    assert.equal(cleanJs('µinspect($x.a.b)'), "µ.inspect('x', 'a.b')")
  })

  it('forme nue : µinspect $x.a.b → µ.inspect(\'x\', \'a.b\')', () => {
    assert.equal(cleanJs('µinspect $x.a.b'), "µ.inspect('x', 'a.b')")
  })

  it("index littéral entier après un chemin : µinspect($x.items[0]) → µ.inspect('x', 'items.0')", () => {
    assert.equal(cleanJs('µinspect($x.items[0])'), "µ.inspect('x', 'items.0')")
  })

  it("index littéral chaîne seul : µinspect($x['cle']) → µ.inspect('x', 'cle')", () => {
    assert.equal(cleanJs("µinspect($x['cle'])"), "µ.inspect('x', 'cle')")
  })

  it('un appel derrière le chemin reste refusé : µinspect($x.f())', () => {
    assert.throws(() => cleanJs('µinspect($x.f())'), /µinspect/)
  })

  it('un index CALCULÉ reste refusé : µinspect($x[i])', () => {
    assert.throws(() => cleanJs('µinspect($x[i])'), /µinspect/)
  })

  it('un gabarit collé reste refusé : µinspect($x`t`)', () => {
    assert.throws(() => cleanJs('µinspect($x`t`)'), /µinspect/)
  })

  // même règle dans le <script> : la chaîne de l'index (`'cle'`) y coupait l'appel en morceaux avant
  // la réécriture, qui ne le reconnaissait plus — l'appel partait tel quel au runtime
  it("dans le <script> aussi : µinspect($x['cle']) → µ.inspect('x', 'cle') ; un appel reste refusé", async () => {
    const { transpile } = await import('../src/transpiler/index.js')
    const { output } = await transpile("<script>\n  $x = {cle: 1}\n  µinspect($x['cle'])\n  µinspect($x.a.b)\n</script>\n<p>{$x.cle}</p>\n", { moduleName: 'card' })
    assert.match(output, /µ\.inspect\('x', 'cle'\)/)
    assert.match(output, /µ\.inspect\('x', 'a\.b'\)/)
    await assert.rejects(transpile("<script>\n  $x = {}\n  µinspect($x.f())\n</script>\n<p>x</p>\n", { moduleName: 'card' }), /µinspect/)
  })
})

describe('µ.inspect(clé, chemin) — exécution (filtre From/To par chemin)', () => {
  let sandbox: any

  before(() => {
    // Même harnais que le describe « µ.inspect From/To » de regressions.test.ts : runtime
    // chargé en sandbox (pas de vrai DOM/happy-dom nécessaire, µ.inspect ne touche jamais le
    // DOM) — mjs_deep.ts pour simuler les mutations profondes ($obj.a = v, $obj.a.b = v)
    // compilées par le path-tracker.
    const initJs = readFileSync(resolvePath('src/runtime/mjs_init.ts'), 'utf-8')
    const deepJs = readFileSync(resolvePath('src/runtime/mjs_deep.ts'), 'utf-8')
    const elemJs = readFileSync(resolvePath('src/runtime/mjs_element.ts'), 'utf-8')
    const runesJs = readFileSync(resolvePath('src/runtime/mjs_runes.ts'), 'utf-8')
    const rareRunesJs = readFileSync(resolvePath('src/runtime/mjs_rare_runes.ts'), 'utf-8')
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
      ${rareRunesJs.replace(/^import[^;]*;?$/gm, '').replace(/export\s*\{[^}]*\}/, '')}
      class MjsInspectCheminTest extends µ.Element {
        constructor() {
          super();
          this._mjs_var_bits = { x: 1 };
        }
      }
      return { µ, MjsInspectCheminTest };
    `
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    sandbox = (new Function(setup))()
  })

  // Helper : remplace console.log/group/groupEnd pendant un appel, capture les arguments
  // transmis. Restaure à la fin. Copie du helper jumeau de regressions.test.ts (fichier
  // autonome, pas de duplication d'infra partagée entre suites).
  function captureConsole(fn: () => void) {
    const logs: any[][] = []
    const groups: string[] = []
    const origLog = console.log
    const origGroup = console.group
    const origGroupEnd = console.groupEnd
    console.log = (...args: any[]) => { logs.push(args) }
    console.group = (label: any) => { groups.push(String(label)) }
    console.groupEnd = () => {}
    try { fn() } finally {
      console.log = origLog
      console.group = origGroup
      console.groupEnd = origGroupEnd
    }
    return { logs, groups }
  }

  it('µinspect($x) seul (sans chemin) : comportement inchangé, affiche tout', () => {
    const { µ, MjsInspectCheminTest } = sandbox
    const el = new MjsInspectCheminTest()
    µ.activeComponent = el
    µ.inspect('x')
    µ.activeComponent = null
    µ._set(el, 'x', { foo: 1, bar: 2 }) // init
    const { groups, logs } = captureConsole(() => µ._set(el, 'x', { foo: 1, bar: 99 }))
    assert.ok(groups.some((g: string) => g === '🔍 [MJS Inspect] x'), `groupe attendu: ${JSON.stringify(groups)}`)
    assert.ok(logs.length > 0, 'From/To attendus')
  })

  it("µinspect($x.foo) : n'affiche RIEN quand $x.bar change (chemin non affecté)", () => {
    const { µ, MjsInspectCheminTest } = sandbox
    const el = new MjsInspectCheminTest()
    µ.activeComponent = el
    µ.inspect('x', 'foo')
    µ.activeComponent = null
    µ._set(el, 'x', { foo: 1, bar: 2 }) // init
    const { groups, logs } = captureConsole(() => µ._mjs_deepSet(el, ['x', 'bar'], 99))
    assert.equal(groups.length, 0, `aucun groupe attendu, vu: ${JSON.stringify(groups)}`)
    assert.equal(logs.length, 0, `aucun log attendu, vu: ${JSON.stringify(logs)}`)
  })

  it('µinspect($x.foo) : affiche From/To quand $x.foo change directement', () => {
    const { µ, MjsInspectCheminTest } = sandbox
    const el = new MjsInspectCheminTest()
    µ.activeComponent = el
    µ.inspect('x', 'foo')
    µ.activeComponent = null
    µ._set(el, 'x', { foo: 1, bar: 2 }) // init
    const { groups, logs } = captureConsole(() => µ._mjs_deepSet(el, ['x', 'foo'], 99))
    assert.ok(groups.some((g: string) => g.includes('x.foo')), `groupe attendu: ${JSON.stringify(groups)}`)
    const allLogs = logs.flat().join(' ')
    assert.match(allLogs, /From/)
    assert.match(allLogs, /To/)
    assert.ok(logs.some((args: any[]) => args.includes(1)), `oldValue 1 attendue: ${JSON.stringify(logs)}`)
    assert.ok(logs.some((args: any[]) => args.includes(99)), 'newValue 99 attendue')
  })

  it('µinspect($x.foo.deep) : affiche From/To quand $x.foo.deep change (mutation 2 niveaux sous $x)', () => {
    const { µ, MjsInspectCheminTest } = sandbox
    const el = new MjsInspectCheminTest()
    µ.activeComponent = el
    µ.inspect('x', 'foo.deep')
    µ.activeComponent = null
    µ._set(el, 'x', { foo: { deep: 1 }, bar: 2 }) // init — mémorise before=1 pour 'foo.deep'
    const { groups, logs } = captureConsole(() => µ._mjs_deepSet(el, ['x', 'foo', 'deep'], 99))
    assert.ok(groups.some((g: string) => g.includes('x.foo.deep')), `groupe attendu: ${JSON.stringify(groups)}`)
    const allLogs = logs.flat().join(' ')
    assert.match(allLogs, /From/)
    assert.match(allLogs, /To/)
    assert.ok(logs.some((args: any[]) => args.includes(1)), `oldValue 1 attendue: ${JSON.stringify(logs)}`)
    assert.ok(logs.some((args: any[]) => args.includes(99)), 'newValue 99 attendue')
  })

  it('µinspect($x.foo) : affiche From/To quand $x entier est remplacé avec un AUTRE foo', () => {
    const { µ, MjsInspectCheminTest } = sandbox
    const el = new MjsInspectCheminTest()
    µ.activeComponent = el
    µ.inspect('x', 'foo')
    µ.activeComponent = null
    µ._set(el, 'x', { foo: 1, bar: 2 }) // init
    const { groups, logs } = captureConsole(() => µ._set(el, 'x', { foo: 99, bar: 2 }))
    assert.ok(groups.some((g: string) => g.includes('x.foo')), `groupe attendu: ${JSON.stringify(groups)}`)
    assert.ok(logs.some((args: any[]) => args.includes(1)), `oldValue 1 attendue: ${JSON.stringify(logs)}`)
    assert.ok(logs.some((args: any[]) => args.includes(99)), 'newValue 99 attendue')
  })

  it("µinspect($x) ET µinspect($x.foo) sur la même clé : le mode « tout » l'emporte", () => {
    const { µ, MjsInspectCheminTest } = sandbox
    const el = new MjsInspectCheminTest()
    µ.activeComponent = el
    µ.inspect('x', 'foo')
    µ.inspect('x') // sans chemin, posé APRÈS — doit l'emporter malgré l'ordre
    µ.activeComponent = null
    µ._set(el, 'x', { foo: 1, bar: 2 }) // init
    const { groups } = captureConsole(() => µ._mjs_deepSet(el, ['x', 'bar'], 99))
    // mode "tout" : affiche même si SEUL bar (hors chemin 'foo') a changé
    assert.ok(groups.some((g: string) => g === '🔍 [MJS Inspect] x'), `groupe "tout" attendu: ${JSON.stringify(groups)}`)
  })
})
