// Ce que ce test garantit : les secondes que disent les avertissements d'une écriture sans réponse (sauvegarde, suppression, arrêt)
// sont arrondies au dixième, avec la virgule décimale en français — le délai d'un adaptateur plus la marge du moteur donnait
// « 1.001 s ». Un compte rond s'écrit sans décimale (« 30 s »).
import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { t, setMessagesLang } from '../src/messages/index.js'
import { createPersistEngine, resolvePersistOption } from '../src/mjs-server/index.js'

const CLES = ['serveur.persist-save-sans-reponse', 'serveur.persist-remove-sans-reponse', 'serveur.persist-flush-sans-reponse']

describe('messages — secondes des écritures sans réponse', () => {
  afterEach(() => setMessagesLang('fr'))

  it('en français : arrondi au dixième, virgule décimale, compte rond sans décimale', () => {
    setMessagesLang('fr')
    for (const cle of CLES) {
      assert.match(t(cle, { id: 'g', delai: 1.001 }), / en 1 s /, `${cle} : 1.001 devient 1`)
      assert.match(t(cle, { id: 'g', delai: 30.25 }), / en 30,3 s /, `${cle} : 30.25 devient 30,3 (virgule)`)
      assert.match(t(cle, { id: 'g', delai: 30 }), / en 30 s /, `${cle} : 30 reste 30`)
      assert.ok(!/\d\.\d/.test(t(cle, { id: 'g', delai: 1.001 })), `${cle} : aucun point décimal`)
    }
  })

  it('en anglais : arrondi au dixième, point décimal', () => {
    setMessagesLang('en')
    for (const cle of CLES) {
      assert.match(t(cle, { id: 'g', delai: 1.001 }), / within 1 s /, `${cle} : 1.001 becomes 1`)
      assert.match(t(cle, { id: 'g', delai: 30.25 }), / within 30\.3 s /, `${cle} : 30.25 becomes 30.3`)
    }
  })

  it("le moteur : un délai de 1,001 s (1 ms de l'adaptateur plus la marge du moteur) est annoncé « 1 s »", async () => {
    mock.timers.enable({ apis: ['setTimeout'] })
    try {
      const warns  = [] as string[]
      const adapter = { load: async () => [], remove() {}, writeTimeoutMs: 1, save: () => new Promise<void>(() => {}) }
      const engine = createPersistEngine(resolvePersistOption({ adapter, debounce: 100 })!, (niveau: string, msg: string) => { if (niveau === 'warn') warns.push(msg) })!
      const game: any = { id: 'g', n: 0, serialize() { return { id: 'g' } }, _onMutate: null }
      engine.armGame(game)
      game._onMutate(game)
      mock.timers.tick(100)
      for (let i = 0; i < 20; i++) await new Promise<void>(r => setImmediate(r))
      mock.timers.tick(1001)
      for (let i = 0; i < 20; i++) await new Promise<void>(r => setImmediate(r))
      assert.equal(warns.length, 1, `un avertissement : ${JSON.stringify(warns)}`)
      assert.match(warns[0], / en 1 s /, warns[0])
    } finally { mock.timers.reset() }
  })
})
