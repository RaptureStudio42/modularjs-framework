// Sur une balise, `@nom` écoute toujours l'événement « nom » : seul un nom (jusqu'au premier `.`, `{` ou `=`) qui est EXACTEMENT un mot
// de MJS est l'ancienne écriture de ce mot, refusée avec la nouvelle dans le message. Un événement dont le nom commence par un mot
// (`@in:fade`, `@size:x`, `@title-change`, `@open-menu`) s'écoute comme les autres, sa forme nue renvoie à `@nom={…}` ; `:in:fade`,
// qui n'est pas un mot de MJS, reste refusé, jamais lu en silence comme l'écoute d'un événement
import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

const TETE = '<script>\n$x = 0\n</script>\n'

const sortie = async (gabarit: string): Promise<string> => (await transpile(TETE + gabarit + '\n', { moduleName: 'evenementMot' })).output

// le message de l'erreur levée par la construction, '' si elle passe
async function refus(gabarit: string): Promise<string> {
  try {
    await sortie(gabarit)
    return ''
  }
  catch (e: any) {
    return String(e?.message ?? e)
  }
}

describe('un événement dont le nom commence par un mot de MJS', function () {
  this.timeout(60000)

  describe('s\'écoute comme tout événement', () => {
    const CAS: [string, string][] = [
      ['in:fade', '<p @in:fade={$x++}>a</p>'],
      ['out:fade', '<p @out:fade={-> $x++}>a</p>'],
      ['transition:fade', '<p @transition:fade={$x++}>a</p>'],
      ['size:x', '<p @size:x={$x++}>a</p>'],
      ['title-change', '<p @title-change={$x++}>a</p>'],
      ['open-menu', '<p @open-menu={$x++}>a</p>'],
    ]
    for (const [evenement, gabarit] of CAS) {
      it(`@${evenement}={…}`, async () => {
        const code = await sortie(gabarit)
        assert.ok(code.includes(`"${evenement}":{`), `écouteur de « ${evenement} » attendu :\n${code}`)
      })
    }
  })

  it('la forme nue `@in:fade` renvoie à `@in:fade={…}`, jamais à `:in:fade`', async () => {
    const message = await refus('<p @in:fade>a</p>')
    assert.ok(message.includes('écrivez « @in:fade={…} »'), message || 'aucune erreur')
  })

  describe('l\'ancienne écriture d\'un mot reste refusée, avec la bonne écriture', () => {
    const CAS: [string, string][] = [
      ['<p @in=*fly>a</p>', ':in=*fly'],
      ['<p @in.global=*fade>a</p>', ':in.global=*fade'],
      ['<p @title="x">a</p>', ':title="x"'],
      ['<details @open={$x}>a</details>', ':open={$x}'],
    ]
    for (const [gabarit, juste] of CAS) {
      it(gabarit, async () => {
        const message = await refus(gabarit)
        assert.ok(message.includes(`écrivez « ${juste} »`), message || 'aucune erreur')
      })
    }
  })

  it('`:in:fade` n\'est pas un mot de MJS : refusé', async () => {
    const message = await refus('<p :in:fade={$x++}>a</p>')
    assert.ok(message.includes('« :in:fade » n\'est pas un mot de MJS'), message || 'aucune erreur')
  })
})
