// `"effects": { "constructor": 1 }` (ou `toString`, `__proto__`) : un nom que tout objet hérite n'est pas un
// réglage connu. Le fichier de configuration dit « clé inconnue » comme pour n'importe quelle faute de
// frappe, au lieu d'une erreur interne (« permis.includes is not a function »).

import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { findConfig } from '../src/bundler/config.js'
import { setMessagesLang } from '../src/messages/index.js'

function configurer(prefixe: string, effects: string): string {
  const root = mjsTmp(prefixe)
  writeFileSync(join(root, 'mjs.config.json'), `{ "effects": ${effects} }\n`)
  return root
}

describe('config — des noms hérités par tout objet ne sont pas des réglages de effects', () => {
  beforeEach(() => setMessagesLang('fr'))
  afterEach(() => setMessagesLang('fr'))

  for (const nom of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
    it(`"${nom}" : clé inconnue, pas une erreur interne`, () => {
      const root = configurer('config-effects-' + nom, `{ "${nom}": 1 }`)
      assert.throws(() => findConfig(root), (e: any) => {
        assert.match(e.message, new RegExp(`clé « ${nom} » inconnue`), e.message)
        assert.doesNotMatch(e.message, /is not a function|syntaxe JSON/, e.message)
        return true
      })
    })
  }

  it('un vrai réglage et une vraie faute de frappe se comportent comme avant', () => {
    assert.doesNotThrow(() => findConfig(configurer('config-effects-ok', '{ "theme": "circle" }')))
    assert.throws(() => findConfig(configurer('config-effects-faute', '{ "them": "circle" }')), /clé « them » inconnue/)
  })
})
