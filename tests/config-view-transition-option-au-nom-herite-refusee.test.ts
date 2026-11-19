// `viewTransition` : une option qui porte le nom d'une clé héritée de tout objet (`constructor`, `toString`, `hasOwnProperty`) est
// refusée comme toute clé inconnue, au lieu de passer sans rien faire
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { findConfig } from '../src/bundler/config.js'
import { setMessagesLang } from '../src/messages/index.js'

describe('config — viewTransition : une option au nom hérité est refusée', () => {
  afterEach(() => setMessagesLang('fr'))

  for (const cle of ['constructor', 'toString', 'hasOwnProperty']) {
    it(`fade={ ${cle}: 1 } : refusée, la clé est nommée`, () => {
      const root = mjsTmp('config-vt-nom-herite')
      writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ viewTransition: `fade={ ${cle}: 1 }` }))
      setMessagesLang('fr')
      assert.throws(() => findConfig(root), (e: any) => {
        assert.match(e.message, /viewTransition invalide/)
        assert.ok(e.message.includes(`clé inconnue '${cle}'`), e.message)
        return true
      })
    })
  }
})
