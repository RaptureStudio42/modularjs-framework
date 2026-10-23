// un µimage(…) resté tel quel dans le réglage image d'un effet (chemin sans guillemets, variable) arrête le build :
// le message donne la règle des réglages d'image — le chemin entre guillemets, que le build change lui-même en
// µimage —, puis µimage(…, largeurs) en option ; en français et en anglais.

import assert from 'node:assert/strict'
import { parseEffect } from '../src/effects/catalog.js'
import { setMessagesLang } from '../src/messages/index.js'

const message = (lang: string, reglages: string): string => {
  setMessagesLang(lang)
  try {
    parseEffect('ink', reglages)
  }
  catch (e: any) {
    return String(e.message)
  }
  finally {
    setMessagesLang('fr')
  }
  return ''
}

describe('effets — le message d\'un µimage(…) non remplacé au build', () => {
  it('en français : le chemin entre guillemets d\'abord, µimage avec des largeurs en option', () => {
    const m = message('fr', 'image: µimage(photo.png)')
    assert.match(m, /image — µimage\(photo\.png\) n'a pas été remplacé au build/)
    assert.match(m, /écrivez le chemin de l'image entre guillemets, image: 'chemin\.png'/)
    assert.match(m, /µimage\('chemin\.png', 480, 960\) reste possible pour choisir les largeurs des variantes/)
    assert.ok(m.indexOf('image: \'chemin.png\'') < m.indexOf('µimage(\'chemin.png\''), m)
    assert.doesNotMatch(m, /l'appel s'écrit µimage\('chemin\.png'\) ou/)
  })

  it('en anglais : le même conseil', () => {
    const m = message('en', 'image: µimage($chemin)')
    assert.match(m, /image — µimage\(\$chemin\) was not replaced at build time/)
    assert.match(m, /write the image path in quotes, image: 'path\.png'/)
    assert.match(m, /µimage\('path\.png', 480, 960\) remains available to choose the variant widths/)
    assert.ok(m.indexOf('image: \'path.png\'') < m.indexOf('µimage(\'path.png\''), m)
    assert.doesNotMatch(m, /the call is written µimage\('path\.png'\) or/)
  })
})
