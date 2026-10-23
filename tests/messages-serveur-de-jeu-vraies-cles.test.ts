// Deux refus d'une définition de jeu lockstep nomment les clés que le serveur lit vraiment, en français comme en anglais :
// un `lockstepJournal` qui n'est pas un objet cite ses trois clés (maxTicks, maxBytes, maxOrderBytes), pas la seule maxTicks ;
// un `onDivergence` qui n'est pas une fonction décrit l'objet reçu avec sa vraie clé `reason` (le français écrivait `raison`).
import assert from 'node:assert/strict'
import { setMessagesLang, getMessagesLang } from '../src/messages/index.js'
import { resolveGameDef } from '../src/mjs-server/index.js'

const base = { mode: 'lockstep', seats: 1, tick: 1, moves: {} }

// texte du refus de la définition, dans la langue demandée
function refus(lang: 'fr' | 'en', ajout: Record<string, unknown>): string {
  const avant = getMessagesLang()
  try {
    setMessagesLang(lang)
    resolveGameDef('essai', { ...base, ...ajout } as any)
  }
  catch (e: any) {
    return String(e?.message ?? e)
  }
  finally {
    setMessagesLang(avant)
  }
  return 'aucun refus'
}

describe('messages — refus d une définition de jeu lockstep : les vraies clés', () => {
  for (const lang of ['fr', 'en'] as const) {
    it(`lockstepJournal qui n'est pas un objet : les trois clés acceptées sont citées (${lang})`, () => {
      for (const valeur of ['x', [], null, 3]) {
        const texte = refus(lang, { lockstepJournal: valeur })
        assert.match(texte, /lockstepJournal/, texte)
        for (const cle of ['maxTicks', 'maxBytes', 'maxOrderBytes']) assert.match(texte, new RegExp('\\b' + cle + '\\b'), texte)
      }
    })

    it(`onDivergence qui n'est pas une fonction : l'objet reçu est décrit avec sa clé reason (${lang})`, () => {
      const texte = refus(lang, { onDivergence: 'x' })
      assert.match(texte, /\{tick, suspects, reason\}/, texte)
      assert.doesNotMatch(texte, /raison/, texte)
    })
  }
})
