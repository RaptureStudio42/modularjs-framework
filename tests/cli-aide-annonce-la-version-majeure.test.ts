// `mjs --help` annonçait « mjs — ModularJS V2 compiler » pour la 3.0.0, puis « V3 » pour la 4.0.0 : l'en-tête de l'aide
// nomme la version majeure du paquet (`package.json`), en français comme en anglais, et jamais une version d'avant

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { setMessagesLang, t } from '../src/messages/index.js'

const majeure = Number(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version.split('.')[0])

describe('cli — l\'en-tête de l\'aide', () => {
  afterEach(() => setMessagesLang('fr'))

  it('nomme la version majeure du paquet, jamais une version d\'avant, dans les deux langues', () => {
    for (const lang of ['fr', 'en']) {
      setMessagesLang(lang)
      const aide = t('cli.usage')
      assert.match(aide, new RegExp(`^\\s*mjs — ModularJS V${majeure} compiler`), lang)
      for (let v = 2; v < majeure; v++) assert.doesNotMatch(aide, new RegExp(`\\bV${v}\\b`), `${lang} : V${v}`)
    }
  })
})
