// Les messages anglais du serveur de jeu (clés `serveur.*`) sont entièrement en anglais : plusieurs mêlaient des mots français
// (« partie ended », « partie not found », « (partie, joueur, p) => result », « missing coup », « (coup, contexte) => result »), y
// compris dans des refus envoyés aux joueurs. L'indice d'un `limits` mal formé nomme ses trois clés, en français comme en anglais.
// Le refus d'un instantané de restauration mal formé, rendu avec les valeurs que le serveur lui passe vraiment, est en anglais aussi
// (il recevait « une chaîne non vide », « un tableau », « … ou null »).
import assert from 'node:assert/strict'
import { en } from '../src/messages/en.js'
import { fr } from '../src/messages/fr.js'
import { setMessagesLang, getMessagesLang } from '../src/messages/index.js'
import { restoreGame } from '../src/mjs-server/game.js'

// variables de modèle neutres : un modèle qui les reçoit n'y ajoute aucun mot
const vars = new Proxy({}, { get: () => 'X' }) as any

const texteDe = (entree: unknown) => typeof entree === 'function' ? (entree as any)(vars) : String(entree)

// mots français courants et mots du jeu (sans accent : les accents sont cherchés à part)
const MOTS = /\b(vous|votre|vos|est|une|pas|n'a|le|la|les|des|du|dans|avec|pour|sur|ou|ne|aux|mais|attendu|partie|parties|joueur|joueurs|raison|coup|coups|contexte|evenement|resultat|fenetre|fenetreMs|nombre|doit|chaine|objet|tableau|fonction|valeur|serveur|siege|sieges|inconnu|inconnue)\b/i
const ACCENTS = /[àâäçéèêëîïôöùûüœ]/i

describe('messages — serveur de jeu en anglais', () => {
  it('aucun message anglais `serveur.*` ne contient de mot français ni d accent', () => {
    const fautifs: string[] = []
    for (const [cle, entree] of Object.entries(en)) {
      if (!cle.startsWith('serveur.')) continue
      const texte = texteDe(entree)
      if (MOTS.test(texte) || ACCENTS.test(texte)) fautifs.push(cle + ' → ' + texte)
    }
    assert.deepEqual(fautifs, [])
  })

  it('un `limits` mal formé : le message nomme moves, moveIntervalMs et moveWaitMs, en français comme en anglais', () => {
    for (const table of [fr, en] as Array<Record<string, unknown>>) {
      const texte = texteDe(table['serveur.game-limits-invalide'])
      for (const cle of ['moves', 'moveIntervalMs', 'moveWaitMs']) assert.match(texte, new RegExp('\\b' + cle + '\\?'), texte)
    }
  })

  it('un instantané de restauration mal formé : le refus, rendu avec les vraies valeurs du serveur, est en anglais (et reste en français en français)', () => {
    const base = { id: 'game1', type: 'duo', journal: [], seats: [], timers: [] }
    const casses = [{ ...base, id: '' }, { ...base, type: '' }, { ...base, journal: null }, { ...base, seats: 'x' }, { ...base, timers: {} }, { ...base, seats: [{ seat: 0 }] }, { ...base, timers: [{ name: 'rappel' }] }, 'pas un objet']
    const refusDe = (casse: unknown) => {
      try { restoreGame({} as any, {} as any, () => {}, casse as any) }
      catch (e: any) { return String(e?.message ?? e) }
      return 'aucun refus'
    }
    const avant = getMessagesLang()
    try {
      setMessagesLang('en')
      const fautifs: string[] = []
      for (const casse of casses) {
        const texte = refusDe(casse)
        assert.match(texte, /restoreGame\(\): invalid field '.+' \(expected .+\)/, texte)
        if (MOTS.test(texte) || ACCENTS.test(texte)) fautifs.push(texte)
      }
      assert.deepEqual(fautifs, [])
      assert.match(refusDe(casses[0]), /\(expected a non-empty string\)/)
      setMessagesLang('fr')
      assert.match(refusDe(casses[0]), /\(attendu une chaîne non vide\)/)
      assert.match(refusDe(casses[5]), /\(attendu \{seat:number, id:string\} ou null\)/)
    }
    finally {
      setMessagesLang(avant)
    }
  })
})
