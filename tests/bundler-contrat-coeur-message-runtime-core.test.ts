// Le refus « cœur incomplet » disait de nommer le module manquant « dans le tableau » `runtime` de mjs.config.json. Avec
// `"runtime": "core"`, il n'y a pas de tableau : le message dit alors quoi écrire à la place de "core".

import assert from 'node:assert/strict'
import { fr } from '../src/messages/fr.js'
import { en } from '../src/messages/en.js'

const message = (table: Record<string, any>, manquants: string[], core: boolean): string =>
  table['bundler.index.contrat-coeur-rompu']({ manquants: manquants.join(', '), nb: manquants.length, modules: 12, core })

describe('bundler — contrat du cœur rompu : le conseil suit la forme de `runtime`', () => {
  it('"runtime": "core" : aucun tableau à compléter, le message donne la liste à écrire', () => {
    const m = message(fr, ['µ.Store', 'µ.every'], true)
    assert.doesNotMatch(m, /dans le tableau/, m)
    assert.match(m, /"runtime": \["store", "every"\]/, m)
    const e = message(en, ['µ.Store', 'µ.every'], true)
    assert.doesNotMatch(e, /in the array/, e)
    assert.match(e, /"runtime": \["store", "every"\]/, e)
  })

  it('symbole interne et "runtime": "core" : remplacer "core" par la liste des modules dont vous vous servez', () => {
    const m = message(fr, ['_mjs_updList'], true)
    assert.doesNotMatch(m, /dans le tableau/, m)
    assert.match(m, /"core"/, m)
    const e = message(en, ['_mjs_updList'], true)
    assert.doesNotMatch(e, /in the array/, e)
    assert.match(e, /"core"/, e)
  })

  it('runtime en tableau : le conseil reste « nommez … dans le tableau »', () => {
    assert.match(message(fr, ['µ.Store'], false), /nommez 'store' dans le tableau/)
    assert.match(message(en, ['µ.Store'], false), /name 'store' in the array/)
  })
})
