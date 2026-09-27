// Régression — µ.easing.bezier(x1, y1, x2, y2) (mjs_easing.ts) : docs/10-transitions.md promet
// « dans les DEUX cas [chaîne CSS via resolve(), ou appel direct de bezier()], x1/x2 hors de
// l'intervalle [0, 1] retombe sur cubicOut, avec un avertissement en mode debug ». Le repli
// n'existait QUE côté resolve() (qui filtre AVANT d'appeler bezier()) : un appel DIRECT de
// µ.easing.bezier() avec des x hors [0,1] ignorait le garde-fou et rendait une courbe non
// monotone en x (la dichotomie interne suppose x croissant avec le paramètre s), sans avertir.
// Même mécanisme de chargement que easing-bezier.test.ts (cf. son en-tête).

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Window } from 'happy-dom'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RUNTIME_DIR = join(__dirname, '..', 'src', 'runtime')
const EASING_SRC = readFileSync(join(RUNTIME_DIR, 'mjs_easing.ts'), 'utf-8')

function load(win: any) {
  const g: any = globalThis
  g.document = win.document
  g.CSSStyleSheet = win.CSSStyleSheet
  const warns: string[] = []
  const µ: any = { log() {}, warn(m: any) { warns.push(String(m)) }, error() {}, anim: {}, _csp: false, debug: true }
  new Function('µ', EASING_SRC)(µ)
  return { µ, warns }
}

describe('µ.easing.bezier(x1, y1, x2, y2) appelé DIRECTEMENT — x1/x2 hors [0, 1]', function () {
  afterEach(() => {
    const g: any = globalThis
    delete g.document
    delete g.CSSStyleSheet
  })

  it('x1 hors [0,1] (bezier(-5, 0, 5, 1)) : repli sur cubicOut, avertissement en mode debug', () => {
    const win: any = new Window({ url: 'http://localhost/' })
    const { µ, warns } = load(win)
    const fn = µ.easing.bezier(-5, 0, 5, 1)
    assert.equal(fn, µ.easing.cubicOut, 'doit rendre LA MÊME fonction que cubicOut, pas juste une valeur proche')
    assert.equal(fn(0.5), µ.easing.cubicOut(0.5))
    assert.equal(warns.length, 1)
    assert.match(warns[0], /cubic-bezier/)
  })

  it('x2 hors [0,1] (bezier(0.5, 0, 5, 1)) : même repli', () => {
    const win: any = new Window({ url: 'http://localhost/' })
    const { µ, warns } = load(win)
    const fn = µ.easing.bezier(0.5, 0, 5, 1)
    assert.equal(fn, µ.easing.cubicOut)
    assert.equal(warns.length, 1)
  })

  it('x1/x2 DANS [0,1] : comportement inchangé, pas de repli, pas d\'avertissement', () => {
    const win: any = new Window({ url: 'http://localhost/' })
    const { µ, warns } = load(win)
    const fn = µ.easing.bezier(0.42, 0, 1, 1)
    assert.notEqual(fn, µ.easing.cubicOut)
    assert.ok(Math.abs(fn(0.5) - 0.3153) < 0.01, `attendu ≈ 0.3153, reçu ${fn(0.5)}`)
    assert.equal(warns.length, 0)
  })

  it('hors mode debug (µ.debug=false) : repli identique, mais silencieux (même politique que resolve())', () => {
    const win: any = new Window({ url: 'http://localhost/' })
    const g: any = globalThis
    g.document = win.document
    g.CSSStyleSheet = win.CSSStyleSheet
    const warns: string[] = []
    const µ: any = { log() {}, warn(m: any) { warns.push(String(m)) }, error() {}, anim: {}, _csp: false, debug: false }
    new Function('µ', EASING_SRC)(µ)
    const fn = µ.easing.bezier(-5, 0, 5, 1)
    assert.equal(fn, µ.easing.cubicOut)
    assert.equal(warns.length, 0, "hors debug, resolve() n'avertit pas non plus — même politique ici")
  })

  it("resolve('cubic-bezier(-5, 0, 5, 1)') : chemin déjà correct, INCHANGÉ par ce correctif", () => {
    const win: any = new Window({ url: 'http://localhost/' })
    const { µ, warns } = load(win)
    const fn = µ.easing.resolve('cubic-bezier(-5, 0, 5, 1)')
    assert.equal(fn, µ.easing.cubicOut)
    assert.equal(warns.length, 1)
  })
})
