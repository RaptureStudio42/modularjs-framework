// La règle d'un réglage d'image d'effet (`*behind(image: …)`, une liste d'images…) dit d'où vient le fichier : l'adresse, µasset ou
// µimage, ou le chemin d'un fichier du dossier source — et d'un dossier de `assetDirs`, où le build cherche aussi (cf. le chapitre 35).
// Ce libellé sort en trois endroits : la faute d'un réglage image, l'aide de l'extension VS Code (effects.json, fabriqué par
// script/vscode-effects.mjs depuis ce même libellé) et le catalogue. Un seul texte par langue (src/messages) : le dire là, c'est le dire partout.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEffect } from '../src/effects/catalog.js'
import { t, setMessagesLang } from '../src/messages/index.js'

const ICI = dirname(fileURLToPath(import.meta.url))

describe('la règle d\'un réglage d\'image d\'effet — les dossiers de assetDirs y sont dits', () => {
  afterEach(() => { setMessagesLang('fr') })

  for (const lang of ['fr', 'en'] as const) {
    it(`${lang} : le libellé d'une image et celui d'une liste d'images citent assetDirs, sans perdre leurs exemples`, () => {
      setMessagesLang(lang)
      assert.match(t('effets.regle-image'), /assetDirs/)
      assert.match(t('effets.regle-image'), /\('photo\.jpg'\)$/)
      assert.match(t('effets.regle-images'), /assetDirs/)
      assert.match(t('effets.regle-images'), /\(\[a\.jpg, 'b\.jpg'\]\)$/)
    })

    it(`${lang} : la faute d'un réglage image montre ce libellé, assetDirs compris`, () => {
      setMessagesLang(lang)
      assert.throws(() => parseEffect('behind', "image: ''"), /assetDirs/)
    })
  }

  it('français : la phrase est celle de la décision (dossier source, ou dossier de assetDirs)', () => {
    assert.equal(t('effets.regle-image'), "une image : son adresse, µasset('…') ou µimage('…'), ou le chemin d'un fichier du dossier source ou d'un dossier de `assetDirs` ('photo.jpg')")
  })

  it('l\'extension VS Code : chaque réglage d\'image, seul ou en liste, porte la règle avec assetDirs', () => {
    const effets = JSON.parse(readFileSync(join(ICI, '../editors/vscode/effects.json'), 'utf-8'))
    const images: string[] = []
    const sans:   string[] = []
    for (const [nom, effet] of Object.entries<any>(effets)) {
      for (const [cle, reglage] of Object.entries<any>(effet.settings)) {
        if (!/^(une image :|une liste d'images :)/.test(reglage.rule)) continue
        images.push(`${nom}.${cle}`)
        if (!reglage.rule.includes('`assetDirs`')) sans.push(`${nom}.${cle}`)
      }
    }
    assert.ok(images.length >= 8, `des réglages d'image existent : ${images.length}`)
    assert.deepEqual(sans, [], 'aucune règle d\'image de l\'extension ne passe sous silence assetDirs')
  })
})
