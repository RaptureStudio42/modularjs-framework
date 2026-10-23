// µ.easing.resolve('cubic-bezier(...)') devant un nombre illisible : seul NaN est refusé pour y1 et y2 (hors de [0, 1], et même infinis, ils passent comme en CSS)
// chargement du runtime : celui de easing-bezier.test.ts (module entier évalué, document et CSSStyleSheet posés sur globalThis le temps du test)

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Window } from 'happy-dom'
import { poserMessages } from './helpers/messages-stub.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const EASING_SRC = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_easing.ts'), 'utf-8')

describe('µ.easing.resolve(cubic-bezier) — nombres illisibles', function () {
  afterEach(() => {
    const g: any = globalThis
    delete g.document
    delete g.CSSStyleSheet
  })

  function load() {
    const win: any = new Window({ url: 'http://localhost/' })
    const g: any = globalThis
    g.document = win.document
    g.CSSStyleSheet = win.CSSStyleSheet
    const warns: string[] = []
    const µ: any = { log() {}, warn(m: any) { warns.push(String(m)) }, error() {}, anim: {}, _csp: false, debug: true }
    poserMessages(µ)
    new Function('µ', EASING_SRC)(µ)
    return { µ, warns }
  }

  // le motif lit des caractères [-\d.] : un tiret seul, un point seul, deux points ou un tiret au milieu donnent NaN
  const ILLISIBLES: [string, string][] = [
    ['cubic-bezier(0.2, -, 0.3, 1)', 'y1 réduit à un tiret'],
    ['cubic-bezier(0.2, ., 0.3, 1)', 'y1 réduit à un point'],
    ['cubic-bezier(0.2, 0.7, 0.3, 1.2.3)', 'y2 à deux points'],
    ['cubic-bezier(0.2, 0.7, 0.3, 1-2)', 'y2 avec un tiret au milieu']
  ]
  for (const [texte, quoi] of ILLISIBLES) {
    it(`resolve('${texte}') : ${quoi} — repli cubicOut + avertissement`, () => {
      const { µ, warns } = load()
      assert.equal(µ.easing.resolve(texte), µ.easing.cubicOut)
      assert.equal(warns.length, 1)
      assert.match(warns[0], /easing inconnu/)
    })
  }

  it('y1 et y2 hors de [0, 1], négatifs ou au-dessus (dépassement du ressort) : acceptés, sans avertissement', () => {
    const { µ, warns } = load()
    const fn = µ.easing.resolve('cubic-bezier(0.2, -0.5, 0.3, 1.5)')
    assert.equal(typeof fn, 'function')
    assert.notEqual(fn, µ.easing.cubicOut)
    assert.ok(Number.isFinite(fn(0.5)), 'une valeur finie en 0.5')
    assert.deepEqual(warns, [])
  })

  it('y1 infini (quatre cents chiffres) : seul NaN est refusé, la courbe est rendue', () => {
    const { µ, warns } = load()
    const fn = µ.easing.resolve('cubic-bezier(0.2, ' + '9'.repeat(400) + ', 0.3, 1)')
    assert.equal(typeof fn, 'function')
    assert.notEqual(fn, µ.easing.cubicOut)
    assert.deepEqual(warns, [])
  })
})
