// un effet donné en objet `{ fx, s }` par une variable (`*delta(fx: $effet)`) : ses réglages passent les mêmes plages que s'ils étaient
// écrits par une variable sur la balise — un nombre ramené à la plage du catalogue, un texte hors de ses bornes de longueur écarté (valeur
// par défaut, message de développement). Le moteur ne connaît pas le catalogue : le constructeur lui donne la table des plages des effets
// qui peuvent être nommés, une seule fois, et seulement quand une page nomme un effet par une variable.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import * as catalogue from '../src/effects/catalog.js'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { scanCompiledFeatures } from '../src/bundler/features.js'
import { transpile } from '../src/transpiler/index.js'

const ICI    = dirname(fileURLToPath(import.meta.url))
const MOTEUR = readFileSync(join(ICI, '../src/runtime/mjs_fx.ts'), 'utf-8')
const plages = (noms: string[]) => (catalogue as any).fxRanges(noms)

const sansPrototype = (o: any): string => '{"__proto__":null' + Object.entries(o).map(([k, v]) => ',' + JSON.stringify(k) + ':' + (Array.isArray(v) ? JSON.stringify(v) : sansPrototype(v))).join('') + '}'

function moteur(table?: unknown) {
  const window: any = new Window({ url: 'http://localhost/' })
  const messages: string[] = []
  const µ: any = { _typesMode: 'warn', warn: (m: string) => { messages.push(String(m)) }, error: () => {}, _mjs_msg: (cle: string) => cle }
  window.eval(`globalThis.__charge = function(µ) {\n${MOTEUR}\n}`)
  window.__charge(µ)
  // la table telle que le cœur la porte : écrite par le constructeur (objets sans prototype)
  if (table) µ._mjs_fxRanges = window.eval('(' + sansPrototype(table) + ')')
  return { window, µ, messages }
}

// les réglages que reçoit l'effet `nom`, donné en objet par une variable (marqué par la règle `e`) et posé par le moteur
function pose(window: any, µ: any, nom: string, s: Record<string, unknown>) {
  let recus: unknown = null
  µ._mjs_fxDefs[nom] = { setup: (_el: unknown, r: unknown) => { recus = r; return null } }
  const el = window.document.body.appendChild(window.document.createElement('span'))
  µ._mjs_fxOnce({}, el, { fx: nom, s, byVar: true })
  return JSON.parse(JSON.stringify(recus))
}

// le cœur d'une page, non réduit
const signaux = async (source: string) => scanCompiledFeatures((await transpile(source, { moduleName: 'c' })).output)
const coeur   = async (source: string) => {
  const out     = mjsTmp('plages-coeur')
  const bundler = new Bundler({ outputDir: out, manifestPath: join(out, 'bundle.js'), env: 'prod', minify: false, i18n: { default: 'fr' } } as any)
  const chemin  = await bundler.bundleRuntime(await signaux(source))
  return chemin === 'mjs:core' ? (bundler as any).bundleVirtualSources.get('mjs_core') : readFileSync(join(out, basename(chemin)), 'utf-8')
}
const TABLE = /^µ\._mjs_fxRanges = (\{.*\});$/gm
// la table du moteur pour *count, telle que le constructeur la donne (le premier test la relit dans le catalogue)
const COUNT = { count: { pad: ['i', 1, 12, 'int 1..12'], prefix: ['p', 0, 8, 'string 0..8'] } }

describe('effets — un effet donné en objet par une variable : les plages du catalogue', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('la table : les nombres bornés et les textes bornés en longueur, sous la règle qu\'une variable écrite sur la balise reçoit', () => {
    const t = plages(['count', 'glitch', 'neon'])
    assert.deepEqual(t.count.pad, COUNT.count.pad)
    assert.deepEqual(t.count.prefix, COUNT.count.prefix)
    assert.deepEqual(t.count.pad, ['i', 1, 12, 'int 1..12'])
    assert.deepEqual(t.count.prefix, ['p', 0, 8, 'string 0..8'])
    assert.deepEqual(t.glitch.strength, ['i', 0, 40, 'int 0..40'])
    assert.deepEqual(Object.keys(t.count).sort(), ['decimal', 'pad', 'prefix', 'separator', 'suffix'], 'ni un temps, ni une couleur, ni un choix : seulement des plages')
    assert.equal(t.neon, undefined, '*neon ne se joue pas une fois : aucun réglage `fx` ne le nomme')
    for (const [nom, k] of [['count', 'pad'], ['count', 'prefix'], ['glitch', 'strength']]) assert.deepEqual(t[nom][k], catalogue.parseEffect(nom, k + ': $v').spec[k], nom + '.' + k)
  })

  it('un nombre hors de la plage est ramené, un texte trop long écarté, avec le message de développement ; le reste passe', () => {
    const { window, µ, messages } = moteur(COUNT)
    assert.deepEqual(pose(window, µ, 'count', { pad: 99, prefix: 'x'.repeat(9), suffix: ' €' }), { on: 'load', pad: 12, suffix: ' €' })
    assert.deepEqual(messages, ['fxBrought', 'fxRefused'])
  })

  it('un nombre donné en texte se lit comme écrit par une variable sur la balise ; ce qui n\'est pas un nombre est écarté', () => {
    const { window, µ } = moteur(COUNT)
    assert.deepEqual(pose(window, µ, 'count', { pad: '5' }), { on: 'load', pad: 5 })
    assert.deepEqual(pose(window, µ, 'count', { pad: 'beaucoup' }), { on: 'load' })
  })

  it('sans table (aucune page ne nomme un effet par une variable) : le filtre des valeurs CSS seul, comme avant', () => {
    const { window, µ } = moteur()
    assert.deepEqual(pose(window, µ, 'count', { pad: 99, prefix: 'x'.repeat(9) }), { on: 'load', pad: 99, prefix: 'x'.repeat(9) })
  })

  it('une clé héritée d\'Object (`constructor`) n\'est pas une plage : un texte y passe toujours le filtre des valeurs CSS', () => {
    const { window, µ } = moteur(COUNT)
    assert.deepEqual(pose(window, µ, 'count', JSON.parse('{"constructor": "url(x)", "pad": 2}')), { on: 'load', pad: 2 })
    assert.deepEqual(pose(window, µ, 'count', JSON.parse('{"constructor": "red", "toString": 3}')), { on: 'load', constructor: 'red', toString: 3 })
  })

  it('le constructeur émet la table une seule fois, et seulement quand une page nomme un effet par une variable', async () => {
    const nomme = await coeur('<script>\n$fx = \'none\'\n</script>\n<span *delta(fx: $fx)>x</span>\n')
    const vues  = [...nomme.matchAll(TABLE)]
    assert.equal(vues.length, 1)
    const table = JSON.parse(vues[0][1])
    assert.deepEqual(table.count.pad, ['i', 1, 12, 'int 1..12'])
    // chaque objet de la table est sans prototype : un nom hérité d'Object n'y est pas une plage
    const lue = new Function('return ' + vues[0][1])()
    assert.equal(Object.getPrototypeOf(lue), null)
    assert.equal(Object.getPrototypeOf(lue.count), null)
    assert.equal(lue.count.constructor, undefined)
    assert.ok(nomme.indexOf('// === mjs_fx.ts ===') < vues[0].index!, 'après le moteur')
    assert.equal([...(await coeur('<span *delta(fx: *count(pad: 3))>x</span>\n')).matchAll(TABLE)].length, 0, 'un effet écrit en clair est vérifié à la compilation')
    assert.equal([...(await coeur('<h1 *neon>x</h1>\n')).matchAll(TABLE)].length, 0, 'sans effet nommé')
  })
})
