// l'avertissement des effets qui dessinent dans le même pseudo-élément d'une balise (`::before`, `::after`, src/effects/pseudo-clash.ts)
// tient sa table à la main : elle reste d'accord avec le code des effets. Chaque effet du catalogue dont le CSS dessine dans un
// pseudo-élément de SA balise (`[mjs-fx~="nom"]…::before`, pas celui d'un calque ou d'un enfant) est dans la table, et la table ne
// nomme aucun effet qui n'y dessine pas. Un effet neuf, ou un effet qui change de pseudo-élément, sans la table : ce test rougit.

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EFFECTS } from '../src/effects/catalog.js'
import { PSEUDO_EFFECTS } from '../src/effects/pseudo-clash.js'

const ICI     = dirname(fileURLToPath(import.meta.url))
const RUNTIME = join(ICI, '../src/runtime')
const CODE    = readdirSync(RUNTIME).filter((f) => /^mjs_fx.*\.ts$/.test(f)).map((f) => readFileSync(join(RUNTIME, f), 'utf-8')).join('\n')

// le sélecteur de la balise de l'effet, ses autres attributs et pseudo-classes (`:not(…)`, `:where(…)`) collés, puis le pseudo-élément
const surLaBalise = (nom: string): RegExp => new RegExp('\\[mjs-fx~="?' + nom + '"?\\](?:\\[[^\\]]*\\]|:(?!:?(?:before|after)\\b)[a-z-]+(?:\\((?:[^()]|\\([^()]*\\))*\\))?)*::?(?:before|after)\\b')

describe('effets — la table des pseudo-éléments de l\'avertissement suit le code des effets', () => {
  const dessinent = Object.keys(EFFECTS).filter((nom) => surLaBalise(nom).test(CODE)).sort()

  it('le relevé trouve les effets connus (garde du relevé lui-même)', () => {
    for (const nom of ['shine', 'glitch', 'kenburns']) assert.ok(dessinent.includes(nom), nom)
    assert.ok(!dessinent.includes('count'), 'count dessine dans les pseudo-éléments de ses cartes, pas de sa balise')
  })

  it('chaque effet qui dessine dans un pseudo-élément de sa balise est dans la table, et rien d\'autre', () => {
    assert.deepEqual([...PSEUDO_EFFECTS].sort(), dessinent)
  })
})
