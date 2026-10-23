// un effet nommé par une variable (`*delta(fx: $effet)`, le `fx` de *guard, de *offline), en nom seul ou en objet `{ fx, s }` : seul un
// effet qui se joue une fois s'y nomme, comme écrit en clair (`*delta(fx: *scramble(20))`, vérifié à la compilation). Un effet continu
// présent dans l'appli (`*magnet`, `*particles`, `*smoke`, `*matrix`, `*tilt`) est écarté : valeur par défaut, message de développement,
// et son fichier n'est pas demandé — ses nombres ne passeraient aucune plage (`{ fx: 'magnet', s: { strength: 5000 } }` tirait la balise de
// 4 800 px). La table des plages que le constructeur donne au moteur porte une entrée pour chaque effet qui se nomme, même sans plage ;
// un effet CSS de l'appli (fichier *.effects.mjs) se joue une fois : sa définition le dit au moteur.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { parseEffect } from '../src/effects/catalog.js'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { scanCompiledFeatures } from '../src/bundler/features.js'
import { transpile } from '../src/transpiler/index.js'

const ICI    = dirname(fileURLToPath(import.meta.url))
const MOTEUR = readFileSync(join(ICI, '../src/runtime/mjs_fx.ts'), 'utf-8')
const REGLE  = parseEffect('delta', 'fx: $v').spec.fx
const TABLE  = /^µ\._mjs_fxRanges = (\{.*\});$/m
const CONTINUS = ['magnet', 'particles', 'smoke', 'matrix', 'tilt']

// le cœur d'une page qui nomme un effet par une variable, non réduit : la table des plages telle que le constructeur l'émet
async function tableEmise(): Promise<string> {
  const out     = mjsTmp('nomme-joue-une-fois')
  const bundler = new Bundler({ outputDir: out, manifestPath: join(out, 'bundle.js'), env: 'prod', minify: false, i18n: { default: 'fr' } } as any)
  const signaux = scanCompiledFeatures((await transpile('<script>\n$fx = \'none\'\n</script>\n<span *delta(fx: $fx)>x</span>\n', { moduleName: 'c' })).output)
  const chemin  = await bundler.bundleRuntime(signaux)
  const coeur   = chemin === 'mjs:core' ? (bundler as any).bundleVirtualSources.get('mjs_core') : readFileSync(join(out, basename(chemin)), 'utf-8')
  const vue     = TABLE.exec(coeur)
  assert.ok(vue, 'la table des plages est émise pour une page qui nomme un effet par une variable')
  return vue![1]
}

// le moteur seul dans happy-dom, la table émise posée comme le cœur la porte ; chaque effet nommé a sa définition (son code est là)
function moteur(table: string) {
  const window: any = new Window({ url: 'http://localhost/' })
  const messages: string[] = []
  const demandes: string[] = []
  const µ: any = { _typesMode: 'warn', warn: (m: string) => { messages.push(String(m)) }, error: () => {}, _mjs_msg: (cle: string) => cle }
  window.eval(`globalThis.__charge = function(µ) {\n${MOTEUR}\n}`)
  window.__charge(µ)
  µ._mjs_fxRanges = window.eval('(' + table + ')')
  for (const n of [...CONTINUS, 'sparkles', 'spin', 'count']) µ._mjs_fxDefs[n] = { setup: () => null }
  // un fichier d'effet au manifeste : sa demande est relevée
  µ.paths = { mjs_fx_magnet: 'x', mjs_fx_scramble: 'x' }
  µ.pathOf = (k: string) => '/' + k + '.js'
  µ._mjs_fxImport = (url: string) => { demandes.push(url); return Promise.resolve() }
  return { window, µ, messages, demandes }
}

const norme = (µ: any, v: unknown) => JSON.parse(JSON.stringify(µ._mjs_fxNorm(v, REGLE)))

describe('effets — une variable ne nomme qu\'un effet qui se joue une fois', function () {
  this.timeout(120000)
  let table = ''
  before(async () => { table = await tableEmise() })
  after(async () => { await terminateSharedWorkerPool() })

  it('la table émise : une entrée pour chaque effet qui se nomme, même sans plage ; aucune pour un effet continu', () => {
    const t = new Function('return ' + table)()
    for (const n of ['count', 'scramble', 'sparkles', 'spin', 'cycle', 'rainbow']) assert.ok(Object.prototype.hasOwnProperty.call(t, n), n + ' se joue une fois : il est dans la table')
    for (const n of ['spin', 'cycle', 'rainbow']) assert.equal(Object.getPrototypeOf(t[n]), null, n + ' : une entrée sans plage, sans prototype')
    for (const n of [...CONTINUS, 'neon', 'crossfade']) assert.equal(Object.prototype.hasOwnProperty.call(t, n), false, n + ' ne se joue pas une fois : il n\'est pas dans la table')
  })

  it('un effet continu de l\'appli, en objet ou en nom seul, est écarté ; son fichier n\'est pas demandé', () => {
    const { µ, demandes } = moteur(table)
    assert.deepEqual(norme(µ, { fx: 'magnet', s: { strength: 5000 } }), [null, -1])
    assert.deepEqual(norme(µ, { fx: 'particles', s: { count: 1e6 } }), [null, -1])
    for (const n of CONTINUS) {
      assert.deepEqual(norme(µ, { fx: n, s: {} }), [null, -1], n + ' en objet')
      assert.deepEqual(norme(µ, n), [null, -1], n + ' seul')
      assert.deepEqual(norme(µ, '*' + n), [null, -1], '*' + n + ' seul')
    }
    delete µ._mjs_fxDefs.magnet
    assert.deepEqual(norme(µ, { fx: 'magnet', s: { strength: 5000 } }), [null, -1])
    assert.deepEqual(demandes, [], 'aucun fichier demandé pour un effet écarté')
  })

  it('un effet qui se joue une fois passe, avec ou sans plage ; son fichier part s\'il n\'est pas là ; none passe', () => {
    const { µ, demandes } = moteur(table)
    assert.deepEqual(norme(µ, { fx: 'sparkles', s: { count: 3 } }), [{ fx: 'sparkles', s: { count: 3 }, byVar: true }, 0])
    assert.deepEqual(norme(µ, 'spin'), [{ fx: 'spin', s: {} }, 0])
    assert.deepEqual(norme(µ, { fx: 'count', s: { pad: 99 } }), [{ fx: 'count', s: { pad: 99 }, byVar: true }, 0])
    assert.deepEqual(norme(µ, { fx: 'scramble', s: {} }), [{ fx: 'scramble', s: {}, byVar: true }, 0])
    assert.deepEqual(demandes, ['/mjs_fx_scramble.js'])
    assert.deepEqual(norme(µ, 'none'), ['none', 0])
  })

  it('un effet CSS de l\'appli se joue une fois : nommé par une variable, il passe, absent de la table', () => {
    const { µ } = moteur(table)
    µ._mjs_fxDefs.halo = { params: [['color', '#0ff']], setup: () => null }
    assert.deepEqual(norme(µ, { fx: 'halo', s: { color: 'red' } }), [{ fx: 'halo', s: { color: 'red' }, byVar: true }, 0])
    assert.deepEqual(norme(µ, 'halo'), [{ fx: 'halo', s: {} }, 0])
    assert.deepEqual(norme(µ, { fx: 'constructor', s: {} }), [null, -1])
  })

  it('par le chemin d\'une variable : `*delta` garde son effet par défaut, avec le message de développement', () => {
    const { window, µ, messages } = moteur(table)
    const el = window.document.body.appendChild(window.document.createElement('span'))
    const s  = µ._mjs_fxSettings(el, 'delta', {}, { fx: { fx: 'magnet', s: { strength: 5000 } } }, { fx: REGLE })
    assert.equal(s.fx, undefined)
    assert.deepEqual(messages, ['fxRefused'])
  })
})
