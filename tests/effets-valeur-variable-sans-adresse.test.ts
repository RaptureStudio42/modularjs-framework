// une valeur d'effet tenue par une variable (une couleur, une liste de couleurs, une valeur CSS) peut venir d'une donnée de
// l'utilisateur : elle ne doit jamais faire charger une adresse à la page. `url(`, `image(`, `image-set(`, `@import`, un
// échappement (`\`, qui écrirait `url(` autrement), une parenthèse en trop ou qui manque, `;`, `{`, `}` : la valeur est
// refusée, l'effet garde sa valeur par défaut, et un message le dit en développement. Une couleur, une ombre, une liste de
// couleurs ordinaires passent comme avant.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'

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
  return { window, µ, messages }
}

// la règle appliquée ; ses tableaux, nés dans la fenêtre happy-dom, recopiés ici pour être comparés
function norme(µ: any, v: unknown, sp: unknown[]) {
  const r = µ._mjs_fxNorm(v, sp)
  return [Array.isArray(r[0]) ? [...r[0]] : r[0], r[1]]
}

const COULEUR  = ['c', 'une couleur']
const COULEURS = ['k', 'des couleurs']
const CSS      = ['s', 'une valeur CSS']

describe('effets — une valeur tenue par une variable ne charge jamais une adresse', () => {
  it('une couleur qui charge une adresse est refusée, sous toutes ses formes', () => {
    const { µ } = moteur()
    for (const v of ['url(http://evil.test/c.png)', 'URL(http://evil.test/c.png)', 'image(http://evil.test/c.png)', 'image-set("http://evil.test/c.png" 1x)', '-webkit-image-set(url(http://evil.test/c.png) 1x)', 'u\\72l(http://evil.test/c.png)', 'red) url(http://evil.test/c.png', 'red;background:url(http://evil.test/c.png)', '@import "http://evil.test/c.css"', 'rgb(1, 2, 3', 'red)']) {
      assert.deepEqual(norme(µ, v, COULEUR), [undefined, -1], v)
    }
  })

  it('une liste de couleurs dont une seule charge une adresse est refusée entière (écrite en liste ou en texte)', () => {
    const { µ } = moteur()
    assert.deepEqual(norme(µ, ['red', 'url(http://evil.test/c.png)'], COULEURS), [undefined, -1])
    assert.deepEqual(norme(µ, ['red', 'blue) , url(http://evil.test/g.png'], COULEURS), [undefined, -1])
    assert.deepEqual(norme(µ, 'red, image-set("http://evil.test/g.png" 1x)', COULEURS), [undefined, -1])
  })

  it('une valeur CSS (une ombre) qui ferme sa fonction pour en ajouter une est refusée', () => {
    const { µ } = moteur()
    for (const v of ['0 0 1px red) url(https://ailleurs.test/f.svg#x', '0 0 1px red) url(https://ailleurs.test/f.svg#x) drop-shadow(0 0 1px red', '0 0 1px u\\rl(https://ailleurs.test/f.svg#x)', '0 0 1px red}', '0 0 1px rgba(0, 0, 0']) {
      assert.deepEqual(norme(µ, v, CSS), [undefined, -1], v)
    }
  })

  it('les valeurs ordinaires passent comme avant', () => {
    const { µ } = moteur()
    for (const v of ['red', '#ff0000', 'rgb(255 0 0 / 50%)', 'hsl(10, 50%, 50%)', 'var(--marque)', 'color-mix(in srgb, red 40%, blue)', 'transparent']) {
      assert.deepEqual(norme(µ, v, COULEUR), [v, 0], v)
    }
    assert.deepEqual(norme(µ, ['red', 'rgb(0, 0, 255)', 'gold'], COULEURS), [['red', 'rgb(0, 0, 255)', 'gold'], 0])
    assert.deepEqual(norme(µ, 'red, rgb(0, 0, 255), gold', COULEURS), [['red', 'rgb(0, 0, 255)', 'gold'], 0])
    for (const v of ['0 0 4px rgba(0, 0, 0, .5)', 'calc(1px + (2px * 3))', '0 2px 8px var(--ombre)']) {
      assert.deepEqual(norme(µ, v, CSS), [v, 0], v)
    }
  })

  it('par le chemin d\'une variable (µ._mjs_fxSettings) : la valeur refusée laisse la valeur par défaut, et un message le dit', () => {
    const { window, µ, messages } = moteur()
    const el = window.document.body.appendChild(window.document.createElement('div'))
    const s  = µ._mjs_fxSettings(el, 'confetti', { count: 30 }, { colors: ['url(http://evil.test/c.png)'] }, { colors: COULEURS })
    assert.equal('colors' in s, false, 'aucune couleur gardée : l\'effet prend les siennes')
    assert.equal(s.count, 30)
    assert.ok(messages.some((m) => m.startsWith('fxRefused') && m.includes('colors')), 'le message de refus : ' + JSON.stringify(messages))
    const g = µ._mjs_fxSettings(el, 'gradient', {}, { colors: ['red', 'blue) , url(http://evil.test/g.png'] }, { colors: COULEURS })
    assert.equal('colors' in g, false)
    const f = µ._mjs_fxSettings(el, 'filter', {}, { shadow: '0 0 1px red) url(https://ailleurs.test/f.svg#x' }, { shadow: CSS })
    assert.equal('shadow' in f, false)
  })
})
