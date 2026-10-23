// un effet nommé par une variable (`*delta(fx: $effet)`), en nom seul ou en objet `{ fx, s }` : son nom est celui d'un effet de
// l'appli — sa définition (propre à la table des effets, jamais un nom hérité d'Object : `constructor`) ou son fichier au manifeste.
// Un nom inconnu est écarté (valeur par défaut, message de développement), qu'il vienne seul ou dans l'objet. Les réglages d'un effet
// donné en objet passent le filtre des valeurs CSS (cf. effets-objet-variable-reglages-css-filtres-browser) : une courbe, une
// zone, une plage, une longueur données en texte n'y font jamais charger une adresse ; écrites par une variable sur un réglage
// direct, le moteur les laisse à l'effet, qui les relit.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { parseEffect } from '../src/effects/catalog.js'

const ICI    = dirname(fileURLToPath(import.meta.url))
const MOTEUR = readFileSync(join(ICI, '../src/runtime/mjs_fx.ts'), 'utf-8')

function moteur() {
  const window: any = new Window({ url: 'http://localhost/' })
  const messages: string[] = []
  const µ: any = {
    _typesMode: 'warn',
    warn: (m: string) => { messages.push(String(m)) },
    error: () => {},
    _mjs_msg: (cle: string, vars: Record<string, string> | null, texte: string) => cle + ' ' + texte.replace(/\{(\w+)\}/g, (_m, n) => String(vars?.[n] ?? ''))
  }
  window.eval(`globalThis.__charge = function(µ) {\n${MOTEUR}\n}`)
  window.__charge(µ)
  // un effet de l'appli, déjà là
  µ._mjs_fxDefs.glitch = { setup: () => null }
  return { window, µ, messages }
}

const REGLE = parseEffect('delta', 'fx: $v').spec.fx
// relu en JSON : les objets rendus viennent de la fenêtre de happy-dom (un autre Object), une valeur écartée y devient null
const norme = (µ: any, v: unknown) => JSON.parse(JSON.stringify(µ._mjs_fxNorm(v, REGLE)))

describe('effets — le nom d\'un effet tenu par une variable est vérifié, seul ou en objet', () => {
  it('la règle envoyée au moteur est celle d\'un effet', () => {
    assert.equal(REGLE[0], 'e')
  })

  it('un nom hérité d\'Object (`constructor`) n\'est pas un effet : écarté seul comme en objet', () => {
    const { µ } = moteur()
    assert.deepEqual(norme(µ, 'constructor'), [null, -1])
    assert.deepEqual(norme(µ, '*constructor'), [null, -1])
    assert.deepEqual(norme(µ, { fx: 'constructor', s: {} }), [null, -1])
    assert.equal(µ._mjs_fxNeed('constructor'), null)
  })

  it('un nom inconnu (ni défini, ni au manifeste) donné en objet est écarté, comme seul', () => {
    const { µ } = moteur()
    assert.deepEqual(norme(µ, 'inconnu'), [null, -1])
    assert.deepEqual(norme(µ, { fx: 'inconnu', s: { size: 3 } }), [null, -1])
    assert.deepEqual(norme(µ, { fx: 'toString' }), [null, -1])
    assert.deepEqual(norme(µ, { fx: 'glitch) url(x', s: {} }), [null, -1])
  })

  it('un effet de l\'appli passe, seul ou en objet (ses réglages gardés, marqué pour le filtre des valeurs CSS)', () => {
    const { µ } = moteur()
    assert.deepEqual(norme(µ, 'glitch'), [{ fx: 'glitch', s: {} }, 0])
    assert.deepEqual(norme(µ, '*glitch'), [{ fx: 'glitch', s: {} }, 0])
    assert.deepEqual(norme(µ, { fx: 'glitch', s: { strength: 5 } }), [{ fx: 'glitch', s: { strength: 5 }, byVar: true }, 0])
    assert.deepEqual(norme(µ, 'none'), ['none', 0])
  })

  it('un effet dont le fichier est au manifeste passe aussi (son fichier part tout de suite)', () => {
    const { µ } = moteur()
    const demandes: string[] = []
    µ.paths  = { mjs_fx_scramble: 'x' }
    µ.pathOf = (k: string) => '/' + k + '.js'
    µ._mjs_fxImport = (url: string) => { demandes.push(url); return Promise.resolve() }
    assert.deepEqual(norme(µ, { fx: 'scramble', s: { speed: 40 } }), [{ fx: 'scramble', s: { speed: 40 }, byVar: true }, 0])
    assert.deepEqual(demandes, ['/mjs_fx_scramble.js'])
  })

  it('par le chemin d\'une variable : l\'effet écarté prend la valeur par défaut, avec le message de développement', () => {
    const { window, µ, messages } = moteur()
    const el = window.document.body.appendChild(window.document.createElement('span'))
    const s  = µ._mjs_fxSettings(el, 'delta', {}, { fx: { fx: 'constructor', s: {} } }, { fx: REGLE })
    assert.equal(s.fx, undefined)
    assert.equal(messages.length, 1, messages.join('\n'))
    assert.match(messages[0], /^fxRefused /)
  })
})

describe('effets — ce qui passe d\'une courbe, d\'une zone, d\'une plage, d\'une longueur tenues par une variable', () => {
  const MAL = 'ease) , url(http://evil.test/x.png'

  it('sur un réglage direct (règle `x`) : le moteur les laisse à l\'effet, qui les relit', () => {
    const { µ } = moteur()
    for (const [nom, cle] of [['fade', 'easing'], ['fade', 'zone'], ['fade', 'range'], ['fly', 'distance']]) {
      const sp = parseEffect(nom, cle + ': $v').spec[cle]
      assert.equal(sp[0], 'x', nom + '.' + cle)
      assert.deepEqual(JSON.parse(JSON.stringify(µ._mjs_fxNorm(MAL, sp))), [MAL, 0], nom + '.' + cle)
    }
  })

  it('dans un effet donné en objet : une valeur qui ferait charger une adresse est écartée, une valeur juste passe', () => {
    const { window, µ, messages } = moteur()
    let vu: any = null
    µ._mjs_fxDefs.essai = { setup: (_el: any, s: any) => { vu = s; return null } }
    const el = window.document.body.appendChild(window.document.createElement('span'))
    µ._mjs_fxOnce(null, el, { fx: 'essai', s: { easing: MAL, zone: 'top) url(x', range: '0px 20px; color: red', distance: '1px) url(x' }, byVar: true })
    // `on: 'load'` : l'effet imbriqué se joue une fois, à la pose
    assert.deepEqual(JSON.parse(JSON.stringify(vu)), { on: 'load' }, JSON.stringify(vu))
    assert.equal(messages.length, 4, messages.join('\n'))
    vu = null
    µ._mjs_fxClear(el)
    const justes = { easing: 'cubic-bezier(.2, 0, .2, 1)', zone: '70% 40%', range: '0px 300px', distance: '40px' }
    µ._mjs_fxOnce(null, el, { fx: 'essai', s: justes, byVar: true })
    assert.deepEqual(JSON.parse(JSON.stringify(vu)), { on: 'load', ...justes })
  })
})
