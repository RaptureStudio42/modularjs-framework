// MJS-Server : une sauvegarde invalide (restoreGame) nomme le champ fautif ; à la racine, ce nom était le mot français « racine », même
// dans le message anglais. Il suit la langue des messages : « racine » en français, « root » en anglais

import assert from 'node:assert/strict'
import { setMessagesLang, getMessagesLang } from '../src/messages/index.js'
import { restoreGame } from '../src/mjs-server/game.js'

function messageEn(lang: 'fr' | 'en'): string {
  const avant = getMessagesLang()
  setMessagesLang(lang)
  try {
    restoreGame({} as any, {} as any, () => {}, null as any)
  }
  catch (e: any) {
    return String(e.message)
  }
  finally {
    setMessagesLang(avant)
  }
  throw new Error('aucune erreur levée')
}

describe('MJS-Server — sauvegarde invalide : le champ racine suit la langue des messages', () => {
  it('anglais : root', () => {
    const m = messageEn('en')
    assert.match(m, /'root'/)
    assert.doesNotMatch(m, /racine/)
  })

  it('français : racine', () => {
    assert.match(messageEn('fr'), /'racine'/)
  })
})
