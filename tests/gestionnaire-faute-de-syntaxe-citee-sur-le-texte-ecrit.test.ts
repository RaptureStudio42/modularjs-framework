// une vraie faute de syntaxe dans un gestionnaire (`@click={$x = not}`) : le message cite l'erreur de Civet sur le texte écrit, à la
// place du gestionnaire dans son fichier (`main.mjs:5:25`) et avec le nom du composant, comme pour une expression ; aucun nom n'y est
// réécrit (`$.x`, `_mjsThis`, `!==`), en français et en anglais
import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { setMessagesLang } from '../src/messages/index.js'

const SCRIPT = '<script>\n$x = 1\n$y = 2\n</script>\n'

// le gestionnaire écrit à la ligne 5 (ou à partir d'elle), son texte à partir de la colonne 17 ; la ligne de la faute ; ce que le
// message ne cite plus
const CAS: { ecrit: string, ligne: number, colonnes: [number, number], jamais: string[] }[] = [
  { ecrit: '$x = not', ligne: 5, colonnes: [17, 25], jamais: ['$.x'] },
  { ecrit: '$x + * 2', ligne: 5, colonnes: [17, 25], jamais: ['$.x'] },
  { ecrit: 'µread $x + * 2', ligne: 5, colonnes: [17, 31], jamais: ['_mjsThis', 'main.inlines'] },
  { ecrit: 'isnt + 1', ligne: 5, colonnes: [17, 25], jamais: ['!=='] },
  { ecrit: '\n  $y = 1\n  $x = not\n', ligne: 7, colonnes: [1, 11], jamais: ['$.x', 'main.inlines'] }
]

async function message(ecrit: string): Promise<string> {
  try {
    await transpile(`${SCRIPT}<button @click={${ecrit}}>a</button>\n`, { moduleName: 'main' })
  }
  catch (e) {
    return String((e as Error).message)
  }
  return 'construit sans refus'
}

function place(m: string, ligne: number, [de, a]: [number, number]): void {
  const p = /main\.mjs:(\d+):(\d+)/.exec(m)
  assert.ok(p, `aucune place dans le fichier : ${m}`)
  assert.equal(Number(p[1]), ligne, m)
  assert.ok(Number(p[2]) >= de && Number(p[2]) <= a, `colonne hors du gestionnaire écrit : ${m}`)
}

describe('vraie faute de syntaxe dans un gestionnaire : l\'erreur de Civet sur le texte écrit, à sa place dans le fichier', function () {
  this.timeout(60000)
  afterEach(() => { setMessagesLang('fr') })

  CAS.forEach(({ ecrit, ligne, colonnes, jamais }) => {
    it(`${JSON.stringify(ecrit)} : faute citée sur le texte écrit, ligne ${ligne}`, async () => {
      setMessagesLang('fr')
      const m = await message(ecrit)
      assert.match(m, /handler inline : échec de compilation Civet dans « main »/)
      assert.match(m, /Failed to parse/)
      place(m, ligne, colonnes)
      for (const x of jamais) assert.ok(!m.includes(x), `« ${x} » cité : ${m}`)
    })
  })

  it('en anglais aussi', async () => {
    setMessagesLang('en')
    const m = await message('$x = not')
    assert.match(m, /inline handler: Civet compilation failed in "main"/)
    place(m, 5, [17, 25])
    assert.ok(!m.includes('$.x'), m)
  })
})
