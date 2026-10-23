// `mjs --help` annonçait « mjs — ModularJS V2 compiler » pour la 3.0.0 : l'en-tête de l'aide nomme la V3, en
// français comme en anglais.

import assert from 'node:assert/strict'
import { setMessagesLang, t } from '../src/messages/index.js'

describe('cli — l\'en-tête de l\'aide', () => {
  afterEach(() => setMessagesLang('fr'))

  it('nomme ModularJS V3, jamais la V2, dans les deux langues', () => {
    for (const lang of ['fr', 'en']) {
      setMessagesLang(lang)
      const aide = t('cli.usage')
      assert.match(aide, /^\s*mjs — ModularJS V3 compiler/, lang)
      assert.doesNotMatch(aide, /\bV2\b/, lang)
    }
  })
})
