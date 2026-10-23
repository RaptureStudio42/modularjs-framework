// un réglage de TEXTE tenu par une variable (le suffixe de *count, les caractères de *scramble, le message de *offline…) va dans le
// texte de la page — `textContent`, un nœud texte, une toile — ou sert de sélecteur, d'adresse, de nom : rien n'y charge une adresse.
// Une parenthèse seule (« Bravo :) »), `url(`, une barre oblique inverse y restent du texte : la valeur passe telle quelle. Une
// couleur, une liste de couleurs, une valeur CSS gardent le filtre qui leur refuse toute adresse ; la découpe de *hologram (`zone`,
// posée telle quelle dans `clip-path`, qui accepte `url(…)`) le prend aussi. Le compilateur et le moteur disent la même chose : la
// règle qu'émet le catalogue est celle qu'applique le moteur, et le panneau d'inspection reçoit la même.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { parseEffect, devCatalog } from '../src/effects/catalog.js'

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

// la règle que le compilateur donne au moteur pour `*nom(réglage: $v)`
const regle = (nom: string, reglage: string) => parseEffect(nom, reglage + ': $v').spec[reglage]

// la règle appliquée ; ses tableaux, nés dans la fenêtre happy-dom, recopiés ici pour être comparés
function norme(µ: any, v: unknown, sp: unknown[]) {
  const r = µ._mjs_fxNorm(v, sp)
  return [Array.isArray(r[0]) ? [...r[0]] : r[0], r[1]]
}

const TEXTES  = ['Bravo :)', '3-2 :)', 'a\\b', '(', 'voir url(http://evil.test/x.png)', 'a;b{c}']
const ADRESSE = 'url(http://evil.test/x.png)'

describe('effets — un réglage de texte tenu par une variable reste du texte', () => {
  it('le suffixe et le préfixe de *count et de *delta, les caractères de *scramble et de *lang, le texte de *offline et de *guard passent tels quels', () => {
    const { µ } = moteur()
    for (const [nom, reglage] of [['count', 'suffix'], ['count', 'prefix'], ['delta', 'suffix'], ['scramble', 'chars'], ['lang', 'chars'], ['offline', 'text'], ['guard', 'text']]) {
      const sp = regle(nom, reglage)
      // un texte borné en longueur (`string 0..8`) n'est écarté que hors de ses bornes, jamais pour son contenu
      for (const v of TEXTES) {
        const n    = [...v].length
        const hors = sp.length > 3 && ((sp[1] !== null && n < (sp[1] as number)) || (sp[2] !== null && n > (sp[2] as number)))
        assert.deepEqual(norme(µ, v, sp), hors ? [undefined, -1] : [v, 0], `*${nom}(${reglage}: ${v})`)
      }
    }
  })

  it('par le chemin d\'une variable (µ._mjs_fxSettings) : « Bravo :) » et « a\\b » arrivent à l\'effet, sans message', () => {
    const { window, µ, messages } = moteur()
    const el = window.document.body.appendChild(window.document.createElement('span'))
    const s  = µ._mjs_fxSettings(el, 'count', { to: 10 }, { suffix: 'Bravo :)', prefix: 'a\\b' }, { suffix: regle('count', 'suffix'), prefix: regle('count', 'prefix') })
    assert.equal(s.suffix, 'Bravo :)')
    assert.equal(s.prefix, 'a\\b')
    assert.equal(s.to, 10)
    const c = µ._mjs_fxSettings(el, 'scramble', {}, { chars: '(:\\)' }, { chars: regle('scramble', 'chars') })
    assert.equal(c.chars, '(:\\)')
    assert.deepEqual(messages, [])
  })

  it('une couleur, une liste de couleurs, une valeur CSS refusent toujours une adresse', () => {
    const { µ } = moteur()
    assert.deepEqual(norme(µ, ADRESSE, regle('glitch', 'color')), [undefined, -1])
    assert.deepEqual(norme(µ, ['red', ADRESSE], regle('gradient', 'colors')), [undefined, -1])
    assert.deepEqual(norme(µ, 'red, ' + ADRESSE, regle('gradient', 'colors')), [undefined, -1])
    assert.deepEqual(norme(µ, ADRESSE, regle('filter', 'shadow')), [undefined, -1])
    assert.deepEqual(norme(µ, '0 0 1px red) ' + ADRESSE + ' drop-shadow(0 0 1px red', regle('filter', 'shadow')), [undefined, -1])
    assert.deepEqual(norme(µ, '0 0 4px rgba(0, 0, 0, .5)', regle('filter', 'shadow')), ['0 0 4px rgba(0, 0, 0, .5)', 0])
    // l'axe de *weight va dans le CSS (font-variation-settings) : un texte, mais une valeur CSS
    assert.deepEqual(norme(µ, 'w\\67ht', regle('weight', 'axis')), [undefined, -1])
    assert.deepEqual(norme(µ, 'wght', regle('weight', 'axis')), ['wght', 0])
  })

  it('la découpe de *hologram (zone, posée dans clip-path) refuse une adresse ; ses formes passent', () => {
    const { µ } = moteur()
    const sp = regle('hologram', 'zone')
    for (const v of ['url(http://evil.test/x.svg#c)', 'inset(1px) url(http://evil.test/x.svg#c)', 'inset(1px)) url(http://evil.test/x.svg#c', 'inset(1px', 'inset(1px) \\75rl(http://evil.test/x.svg#c)']) {
      assert.deepEqual(norme(µ, v, sp), [undefined, -1], v)
    }
    for (const v of ['inset(10% 8% 53% 8%)', 'polygon(8% 16%, 92% 16%, 92% 47%)', 'circle(30% at 50% 40%)', 'ellipse(30% 20% at 50% 40%)', "path('M 10 10 H 90 V 60 Z')"]) {
      assert.deepEqual(norme(µ, v, sp), [v, 0], v)
    }
  })

  it('le panneau d\'inspection reçoit les mêmes règles que le moteur', () => {
    const cat = devCatalog(['count', 'scramble', 'filter', 'weight', 'hologram'])
    for (const [nom, reglage] of [['count', 'suffix'], ['scramble', 'chars'], ['filter', 'shadow'], ['weight', 'axis'], ['hologram', 'zone']]) {
      assert.deepEqual(cat[nom].s[reglage][0], regle(nom, reglage), `*${nom} ${reglage}`)
    }
    assert.notEqual(regle('count', 'suffix')[0], regle('filter', 'shadow')[0], 'un texte et une valeur CSS n\'ont pas la même règle')
  })
})
