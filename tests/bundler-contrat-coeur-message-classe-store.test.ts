// Quand le cœur produit ne contient pas `µ.Store`, la garde du contrat refuse le build. Son message appelait `µ.Store` « fonction »
// et annonçait une vue arrêtée sur « une fonction qui n'existe pas » : `µ.Store` est une classe (`new µ.Store(…)`), l'erreur du
// navigateur serait « µ.Store is not a constructor », et `µ.Ticker` est un objet. Chacun est nommé pour ce qu'il est, avec l'erreur
// que la première vue rencontrerait, en français comme en anglais.

import assert from 'node:assert/strict'
import { fr } from '../src/messages/fr.js'
import { en } from '../src/messages/en.js'

const message = (table: Record<string, any>, manquants: string[]): string =>
  table['bundler.index.contrat-coeur-rompu']({ manquants: manquants.join(', '), nb: manquants.length, modules: 12 })

describe('bundler — contrat du cœur rompu : µ.Store nommé comme une classe', () => {
  it('µ.Store : une classe, « is not a constructor », jamais « fonction »', () => {
    const m = message(fr, ['µ.Store'])
    assert.match(m, /classe µ\.Store/, m)
    assert.match(m, /µ\.Store is not a constructor/, m)
    assert.doesNotMatch(m, /fonction/, m)
    const e = message(en, ['µ.Store'])
    assert.match(e, /class µ\.Store/, e)
    assert.match(e, /µ\.Store is not a constructor/, e)
    assert.doesNotMatch(e, /function/, e)
  })

  it('µ.Ticker un objet, µ.every une fonction, chacun avec son erreur', () => {
    const m = message(fr, ['µ.Ticker', 'µ.every'])
    for (const mot of [/objet µ\.Ticker/, /fonction µ\.every/, /µ\.every is not a function/, /'ticker'/, /'every'/]) assert.match(m, mot, m)
    const e = message(en, ['µ.Ticker', 'µ.every'])
    for (const mot of [/object µ\.Ticker/, /function µ\.every/, /µ\.every is not a function/, /'ticker'/, /'every'/]) assert.match(e, mot, e)
  })
})
