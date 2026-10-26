// `mjs --help` et le tableau des drapeaux de docs/32 disaient la production « minifiée » sans condition, alors
// qu'un `"minify": false` la laisse lisible (le bandeau de `mjs build --prod` dit alors « non minifié ») : la
// ligne `--prod` nomme cette exception, comme la ligne `--dev` nomme `"minify": true`.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { setMessagesLang, t } from '../src/messages/index.js'

describe('cli — la minification annoncée pour --prod', () => {
  afterEach(() => setMessagesLang('fr'))

  it('l\'aide de --prod nomme l\'exception "minify": false, dans les deux langues', () => {
    for (const lang of ['fr', 'en']) {
      setMessagesLang(lang)
      const ligne = t('cli.usage').split('\n').find((l) => l.trim().startsWith('--prod')) ?? ''
      assert.match(ligne, /"minify": false/, `${lang} : ${ligne}`)
    }
  })

  it('docs/32 : la ligne --prod du tableau des drapeaux nomme l\'exception "minify": false', () => {
    const ligne = readFileSync(new URL('../docs/32-cli-et-configuration.md', import.meta.url), 'utf8').split('\n').find((l) => l.startsWith('| `--prod` |')) ?? ''
    assert.match(ligne, /`"minify": false`/, ligne)
  })
})
