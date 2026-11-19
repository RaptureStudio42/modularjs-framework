// un mjs.config.json qui commence par une marque d'ordre des octets (BOM, qu'ajoutent certains éditeurs) se lit comme le même fichier
// sans elle ; ailleurs qu'en tête, elle reste une erreur de syntaxe JSON
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { findConfig } from '../src/bundler/config.js'
import { setMessagesLang } from '../src/messages/index.js'

const BOM = String.fromCharCode(0xfeff)

describe('config — mjs.config.json avec une marque d\'ordre en tête', () => {
  afterEach(() => setMessagesLang('fr'))

  it('marque en tête : le fichier est lu, ses réglages comptent', () => {
    const root = mjsTmp('config-bom-en-tete')
    writeFileSync(join(root, 'mjs.config.json'), BOM + '{"minify": false, "lang": "fr"}')
    const lu = findConfig(root)
    assert.equal(lu?.config.minify, false)
    assert.equal(lu?.config.lang, 'fr')
  })

  it('marque au milieu : toujours une erreur de syntaxe JSON', () => {
    const root = mjsTmp('config-bom-au-milieu')
    writeFileSync(join(root, 'mjs.config.json'), '{"minify": ' + BOM + 'false}')
    setMessagesLang('fr')
    assert.throws(() => findConfig(root), /erreur de syntaxe JSON/)
  })
})
