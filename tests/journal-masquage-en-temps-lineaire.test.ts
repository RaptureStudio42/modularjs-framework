// le masquage des secrets du journal tournait sur 64 Kio AVANT la troncature, avec un motif de JWT qui repartait de chaque `eyJ` sur
// 4 096 caractères : un message hostile de 64 Kio (`eyJ-` répétés) bloquait `record()` 450 à 700 ms, contre 0,1 ms avant. Le texte
// est maintenant ramené à sa taille stockée (avec une marge pour un secret à cheval sur la coupe) avant d'être masqué, et chaque
// motif ne démarre qu'au début d'une suite de caractères : temps linéaire

import assert from 'node:assert/strict'
import { maskSecrets, createJournal } from '../src/server/journal.js'
import { mjsTmp } from './helpers/tmp.js'

// le meilleur de cinq essais, en millisecondes : une machine chargée ralentit un essai, pas les cinq
function meilleurTemps(f: () => void): number {
  let min = Infinity
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now()
    f()
    min = Math.min(min, performance.now() - t0)
  }
  return min
}

const HOSTILES: Record<string, string> = {
  'eyJ- répété':        'eyJ-'.repeat(16384),
  'eyJaaaa. répété':    'eyJaaaa.'.repeat(8192),
  'a@a. répété':        'a@a.'.repeat(16384),
  'a%40a. répété':      'a%40a.'.repeat(10922),
  '?aaaaa répété':      '?aaaaa'.repeat(10923),
  'Bearer + espaces':   ('Bearer ' + ' '.repeat(50)).repeat(1145),
  'Basic aB répété':    ('Basic ' + 'aB'.repeat(20) + ' ').repeat(1394),
  'Cookie: répété':     'Cookie:'.repeat(9362),
  'paires JSON':        '"password":"'.repeat(5041),
  'chemin à segments':  'https://x.fr/' + 'aB3-'.repeat(16380),
}

describe('journal — masquage des secrets en temps linéaire', function () {
  this.timeout(30000)

  for (const [nom, texte] of Object.entries(HOSTILES)) {
    it(`maskSecrets sur 64 Kio hostiles (${nom}) : moins de 25 ms`, () => {
      const ms = meilleurTemps(() => maskSecrets(texte))
      assert.ok(ms < 25, `${nom} : ${ms.toFixed(1)} ms`)
    })
  }

  it('record() d\'un message serveur hostile de 64 Kio : moins de 25 ms', () => {
    const journal = createJournal({ dir: mjsTmp('journal-lineaire') })
    try {
      let i = 0
      const ms = meilleurTemps(() => journal.record('server', { message: 'eyJ-'.repeat(16384) + (i++), pile: 'eyJ-'.repeat(16384), url: '/p?q=' + 'eyJ-'.repeat(512) }))
      assert.ok(ms < 25, `${ms.toFixed(1)} ms`)
    } finally {
      journal.close()
    }
  })

  it('un jeton à cheval sur la coupe du message stocké est masqué quand même', () => {
    const journal = createJournal({ dir: mjsTmp('journal-coupe') })
    try {
      const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJqZWFuQGV4ZW1wbGUuZnIifQ.c2lnbmF0dXJlLXNlY3JldGU'
      journal.record('server', { message: 'x'.repeat(2030) + ' ' + jwt })
      const [entree] = journal.list()
      assert.ok(entree.message.length <= 2048, String(entree.message.length))
      assert.ok(!entree.message.includes('eyJ'), entree.message.slice(2020))
    } finally {
      journal.close()
    }
  })
})
