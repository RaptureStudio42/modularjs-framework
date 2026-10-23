// la garde du contrat du cœur (bundler) refuse un build dont le cœur ne fournit pas ce que les composants appellent. Pour les quatre fonctions
// publiques que le cœur n'embarque qu'à la demande (`µ.Store`, `µ.interpolate`, `µ.Ticker`, `µ.every`), son message parlait de « symbole
// interne » et de « this.<nom> is not a function » : il nomme la fonction du cœur, le module qui la porte et ce qu'il faut faire, en
// français comme en anglais ; un symbole interne garde son explication

import assert from 'node:assert/strict'
import { fr } from '../src/messages/fr.js'
import { en } from '../src/messages/en.js'

const message = (table: Record<string, any>, manquants: string[]): string =>
  table['bundler.index.contrat-coeur-rompu']({ manquants: manquants.join(', '), nb: manquants.length, modules: 12 })

describe('bundler — contrat du cœur rompu : le message d\'une fonction publique', () => {
  it('µ.Store manquant : la fonction, son module, le réglage runtime — ni symbole interne ni this.<nom>', () => {
    for (const table of [fr, en]) {
      const m = message(table, ['µ.Store'])
      assert.match(m, /µ\.Store/, m)
      assert.match(m, /'store'/, m)
      assert.match(m, /'runtime'/, m)
      assert.doesNotMatch(m, /this\.<|interne|internal/, m)
    }
  })

  it('µ.Ticker et µ.every : chacun avec son module', () => {
    for (const table of [fr, en]) {
      const m = message(table, ['µ.Ticker', 'µ.every'])
      for (const mot of [/µ\.Ticker/, /µ\.every/, /'ticker'/, /'every'/]) assert.match(m, mot, m)
    }
  })

  it('un symbole interne garde son explication', () => {
    for (const table of [fr, en]) {
      const m = message(table, ['_mjs_updList'])
      assert.match(m, /_mjs_updList/, m)
      assert.match(m, /this\.</, m)
    }
  })

  it('les deux à la fois : chacun son explication', () => {
    for (const table of [fr, en]) {
      const m = message(table, ['_mjs_updList', 'µ.interpolate'])
      for (const mot of [/µ\.interpolate/, /'interpolate'/, /_mjs_updList/, /this\.</]) assert.match(m, mot, m)
    }
  })

  it('en français, au vouvoiement', () => {
    const m = message(fr, ['µ.Store', '_mjs_updList'])
    assert.match(m, /\b(vous|vos|votre)\b|ez\b/, m)
    assert.doesNotMatch(m, /\b(tu|ton|ta|tes|toi)\b/i, m)
  })
})
