// Le compte de composants assemblés dans un fichier de page ou de groupe s'accorde : « 1 composant assemblé »,
// « 3 composants assemblés » — jamais « 1 composants assemblés »
import assert from 'node:assert/strict'
import { t, setMessagesLang } from '../src/messages/index.js'

describe('messages — accord du compte de composants assemblés', function () {
  afterEach(() => {
    setMessagesLang('fr')
  })

  for (const cle of ['bundler.startup.fichier-de-page', 'bundler.groupes.fichier-de-groupe'] as const) {
    it(`${cle} : singulier pour un, pluriel au-delà (fr)`, function () {
      setMessagesLang('fr')
      const un    = t(cle, { page: 'accueil', groupe: 'carte', fichier: 'f.js', nb: 1 })
      const trois = t(cle, { page: 'accueil', groupe: 'carte', fichier: 'f.js', nb: 3 })
      assert.match(un, /\(1 composant assemblé\)/)
      assert.match(trois, /\(3 composants assemblés\)/)
    })

    it(`${cle} : singulier pour un, pluriel au-delà (en)`, function () {
      setMessagesLang('en')
      const un    = t(cle, { page: 'home', groupe: 'card', fichier: 'f.js', nb: 1 })
      const trois = t(cle, { page: 'home', groupe: 'card', fichier: 'f.js', nb: 3 })
      assert.match(un, /\(1 component assembled\)/)
      assert.match(trois, /\(3 components assembled\)/)
    })
  }
})
