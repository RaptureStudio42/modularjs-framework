// un gestionnaire que ModularJS refuse de lire (une rune écrite en clé, `@click={µread: 1}` ; un caractère réservé par ModularJS écrit
// à côté de `§`, `@@` ou `&`) : le refus cite le nom du composant et la place du gestionnaire dans son fichier (`main.mjs:5:17`),
// comme celui d'une expression, en français et en anglais
import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { setMessagesLang, t } from '../src/messages/index.js'
import { RESERVED_LETTERS } from '../src/reader/disguise.js'

const SCRIPT = '<script>\n$x = 1\n$z = 2\n</script>\n'

// gestionnaire écrit à la ligne 5, son accolade à la colonne 16 → raison du refus en français
const CAS: [string, RegExp][] = [
  ['<button @click={µread: 1}>a</button>', /rune écrite en clé d'objet/],
  [`<button @click={$x = ${RESERVED_LETTERS['§']}y + §z}>a</button>`, /caractère réservé par ModularJS/]
]

async function refus(gabarit: string): Promise<string> {
  try {
    await transpile(SCRIPT + gabarit + '\n', { moduleName: 'main' })
  }
  catch (e) {
    return String((e as Error).message)
  }
  return 'construit sans refus'
}

describe('refus d\'un gestionnaire : le nom du composant et la place du gestionnaire dans son fichier', function () {
  this.timeout(60000)
  afterEach(() => { setMessagesLang('fr') })

  CAS.forEach(([gabarit, raison]) => {
    it(`${gabarit} : refusé à main.mjs:5:17`, async () => {
      setMessagesLang('fr')
      const m = await refus(gabarit)
      assert.ok(m.includes('main.mjs:5:17'), m)
      assert.ok(m.includes(t('generator.hint-in-module', { moduleName: 'main' })), m)
      assert.match(m, raison)
    })

    it(`${gabarit} : en anglais aussi`, async () => {
      setMessagesLang('en')
      const m = await refus(gabarit)
      assert.ok(m.includes('main.mjs:5:17'), m)
      assert.ok(m.includes(t('generator.hint-in-module', { moduleName: 'main' })), m)
      assert.match(m, /cannot read it/)
    })
  })
})
