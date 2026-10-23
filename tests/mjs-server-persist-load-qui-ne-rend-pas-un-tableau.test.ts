// persist.ts::loadAtBoot — un `load()` d'adaptateur maison qui ne rend pas un tableau ({}, null, une chaîne…) ne casse plus
// `app.listen()` : un seul avertissement clair, démarrage sans restauration, comme un `load()` qui échoue. Avant, `listen()` levait
// une TypeError (« not iterable »), ou une chaîne était parcourue caractère par caractère (un avertissement par caractère)
import assert from 'node:assert/strict'
import { mjsServer } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { t } from '../src/messages/index.js'

const cas: Array<[string, unknown, string]> = [
  ['un objet', { game1: {} }, 'object'],
  ['null', null, 'null'],
  ['undefined', undefined, 'undefined'],
  ['une chaîne', 'abc', 'string'],
]

describe('MJS-Server — persist : load() qui ne rend pas un tableau', () => {
  for (const [nom, rendu, recu] of cas) {
    it(`load() rend ${nom} : app.listen() aboutit, un seul avertissement clair, aucune partie restaurée`, async () => {
      const journal: Array<[string, string]> = []
      const adaptateur = { load: async () => rendu as any, save() {}, remove() {} }
      const app = mjsServer({ transport: new MemoryTransport(), heartbeat: 0, persist: adaptateur, onLog: (niveau: string, message: string) => { journal.push([niveau, message]) } })
      app.game('duel', { seats: 2, state: () => ({}), moves: {}, view: (g: any) => g.state })
      await app.listen()
      try {
        const avertissements = journal.filter(([niveau]) => niveau === 'warn' || niveau === 'error')
        assert.deepEqual(avertissements, [['warn', t('serveur.persist-load-pas-un-tableau', { recu })]])
      }
      finally {
        await app.stop()
      }
    })
  }
})
