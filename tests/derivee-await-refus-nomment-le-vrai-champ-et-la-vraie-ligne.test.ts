// les refus autour d'une valeur qui attend nomment le champ lié tel qu'écrit (`:group=!{$r}`, `files=!{$r}`, `:open`, `:text`) et
// ne citent jamais une ligne fausse : la ligne se cherche sur le code, chaînes et commentaires masqués (commentaires HTML compris),
// au bon endroit (une valeur écrite sur deux lignes : la ligne de son `await` ; un `µsignal` permis plus haut ne compte pas) ;
// `?=`, `export µ$$feed = await …` et `µpending` mal écrit ont la leur. En anglais, des phrases d'anglais courant

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { setMessagesLang } from '../src/messages/index.js'
import { refus } from './helpers/derivee-await-refus.js'

// le script `lignes` (à partir de la ligne 2 du fichier), puis le gabarit
const composant = (lignes: string[], gabarit: string, lang = '') => `<script${lang ? ` lang="${lang}"` : ''}>\n${lignes.map((l) => '  ' + l).join('\n')}\n</script>\n${gabarit}\n`
const ATTEND    = ['$q = 1', 'f = (q) -> Promise.resolve([q])', '$r = await f($q)']

describe('dérivée qui attend — les refus nomment le vrai champ et la vraie ligne', function () {
  this.timeout(60000)
  after(async () => {
    setMessagesLang('fr')
    await terminateSharedWorkerPool()
  })

  const champs: Array<[string, string, string]> = [
    ['radio', '<input type="radio" value="a" :group=!{$r}>', ':group'],
    ['case à cocher', '<input type="checkbox" value="a" :group=!{$r}>', ':group'],
    ['fichiers', '<input type="file" files=!{$r}>', 'files'],
    ['détails', '<details :open=!{$r}><summary>s</summary></details>', ':open'],
    ['texte modifiable', '<div contenteditable :text=!{$r}></div>', ':text']
  ]
  for (const [nom, gabarit, champ] of champs) {
    it('champ lié nommé tel qu\'écrit : ' + nom, async () => {
      const message = await refus(composant(ATTEND, gabarit))
      assert.ok(message.includes(`'refus.mjs', ligne 6 : « ${champ}=!{$r} »`), message)
      assert.ok(message.includes(`« ${champ}=!{$saisie} »`), message)
    })
  }

  const lignes: Array<[string, string, string]> = [
    ['un commentaire du script plus haut', composant(['$q = 1', 'f = (q) -> Promise.resolve([q])', '# exemple : $r = []', '$r = await f($q)', '@vider = -> $r = []'], '<i>{$r}</i>'), '\'refus.mjs\', ligne 6 : $r est écrite à la main'],
    ['une chaîne plus haut', composant(['$q = 1', 'f = (q) -> Promise.resolve([q])', 'aide = \'videz par $r = []\'', '$r = await f($q)', '@vider = -> $r = []'], '<i>{$r}</i>'), '\'refus.mjs\', ligne 6 : $r est écrite à la main'],
    ['un commentaire HTML avant le script', '<!-- $r = [] -->\n' + composant([...ATTEND, '@vider = -> $r = []'], '<i>{$r}</i>'), '\'refus.mjs\', ligne 6 : $r est écrite à la main'],
    ['la valeur écrite sur deux lignes, écrite à la main plus bas', composant(['$q = 1', 'f = (q) -> Promise.resolve([q])', '$r =', '  await f($q)', '@vider = -> $r = []'], '<i>{$r}</i>'), '\'refus.mjs\', ligne 6 : $r est écrite à la main'],
    ['la valeur qui se cite, sur deux lignes : la ligne de son await', composant(['$page = 1', 'f = (p, r) -> Promise.resolve(r)', '$r =', '  await f($page, $r)'], '<i>{$r}</i>'), '\'refus.mjs\', ligne 5 : « $r = await … »'],
    ['un µsignal permis plus haut, seul sur sa ligne', composant(['f = (q) -> Promise.resolve([q])', '$q = \'\'', '$r = await f(', '  $q,', '  µsignal', ')', '@x = -> fetch(\'/x\', { signal: µsignal })'], '<i>{$r}</i>'), '\'refus.mjs\', ligne 8 : « µsignal »'],
    ['µsignal cité dans un commentaire plus haut', composant(['f = (q) -> Promise.resolve([q])', '# µsignal coupe la demande', '@x = -> fetch(\'/x\', { signal: µsignal })'], '<i>x</i>'), '\'refus.mjs\', ligne 4 : « µsignal »'],
    ['un magasin cité dans un commentaire plus haut', composant(['f = (q) -> Promise.resolve([q])', '$q = \'\'', '# ancien : $$l = await f(1)', '$$l = await f($q)'], '<i>{$$l}</i>'), '\'refus.mjs\', ligne 5 : « $$l = await … »'],
    ['µpending d\'une variable ordinaire, cité dans un commentaire plus haut', composant(['# µpending($n) se lit dans le gabarit', '$n = 0'], '<i>{µpending($n)}</i>'), '\'refus.mjs\', ligne 5 : « µpending($n) »'],
    ['?= dans une méthode', composant([...ATTEND, '@init = -> $r ?= []'], '<i>{$r}</i>'), '\'refus.mjs\', ligne 5 : $r est écrite à la main'],
    ['export µ$$feed = await … dans un composant', composant(['f = (q) -> Promise.resolve([q])', 'export µ$$feed = await f(1)'], '<i>x</i>'), '\'refus.mjs\', ligne 3 : « µ$$feed = await … »'],
    ['µpending mal écrit', composant(ATTEND, '<i>{µpending()}</i>'), '\'refus.mjs\', ligne 6 : « µpending() »']
  ]
  for (const [nom, source, attendu] of lignes) {
    it('la vraie ligne : ' + nom, async () => {
      const message = await refus(source)
      assert.ok(message.includes(attendu), message)
    })
  }

  it('en anglais, des phrases d\'anglais courant', async () => {
    setMessagesLang('en')
    try {
      const messages = [
        await refus(composant([...ATTEND, '@vider = -> $r = []'], '<i>{$r}</i>')),
        await refus(composant(ATTEND, '<input value=!{$r}>')),
        await refus(composant(['f = -> Promise.resolve(1)', '$x =: await f()'], '<i>{$x}</i>')),
        await refus(composant(['$n = 1'], '<i>{µpending($n)}</i>')),
        await refus(composant(['$q = 1', 'f = (q, s) -> Promise.resolve(q)', '@go = -> f($q, µsignal)'], '<i>x</i>')),
        await refus(composant(ATTEND, '<i>{µpending()}</i>'))
      ]
      for (const m of messages) assert.doesNotMatch(m, /without a word|request leaves|it leaves once|waits for no answer|is worth nothing|read the waiting|reads the waiting|is written by hand/, m)
      assert.match(messages[0], /silently overwrite/, messages[0])
    }
    finally {
      setMessagesLang('fr')
    }
  })
})
