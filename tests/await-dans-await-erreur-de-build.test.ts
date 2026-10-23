// un `{await}` placé dans une branche d'un autre `{await}` (attente, `{success}`, `{error}`, ou un `{if}` de cette branche) est refusé à la construction, comme celui d'un `{for}` :
// le message cite la ligne de l'`{await}` intérieur et dit quoi faire (le sortir dans un sous-composant que la branche affiche), en français (vouvoiement) et en anglais
// il se compilait en un `<span class="mjs-error">[Await imbriqué non supporté]</span>` visible des visiteurs, sans la moindre erreur de construction
// les `{await}` permis (à la racine, dans un `{if}` de la racine) se compilent toujours, et celui d'un `{for}` garde son message

import assert from 'node:assert/strict'
import { setMessagesLang } from '../src/messages/index.js'
import { transpile } from '../src/transpiler/index.js'

const HAUT = ['<script>', '  $p  = Promise.resolve(1)', '  $q  = Promise.resolve(2)', '  $on = true', '  $l  = [1, 2]', '</script>']

const INTERIEUR = ['  {await $q}', '    <i>attente 2</i>', '  {success w}', '    <u>{w}</u>', '  {end}']

const DANS_SUCCES = ['{await $p}', '  <i>attente</i>', '{success v}', ...INTERIEUR, '{end}']
const DANS_ATTENTE = ['{await $p}', ...INTERIEUR, '{success v}', '  <b>{v}</b>', '{end}']
const DANS_ERREUR = ['{await $p}', '  <i>attente</i>', '{success v}', '  <b>{v}</b>', '{error err}', ...INTERIEUR, '{end}']
const DANS_SI = ['{await $p}', '  <i>attente</i>', '{success v}', '  {if $on}', ...INTERIEUR.map((l) => '  ' + l), '  {end}', '{end}']
const A_LA_RACINE = ['{await $p}', '  <i>attente</i>', '{success v}', '  <b>{v}</b>', '{end}', ...INTERIEUR.map((l) => l.slice(2))]
const DANS_SI_RACINE = ['{if $on}', ...INTERIEUR, '{end}']
const DANS_POUR = ['{for n in $l}', ...INTERIEUR, '{end}']

// le message de la construction d'un gabarit, ou null quand il se compile
async function refus(corps: string[]): Promise<string | null> {
  try { await transpile([...HAUT, ...corps].join('\n') + '\n', { moduleName: 'imbrique' }) }
  catch (e: any) { return String(e.message ?? e) }
  return null
}

// la ligne du fichier où s'ouvre le premier `{await $q}` du gabarit
const ligneDe = (corps: string[]) => HAUT.length + 1 + corps.findIndex((l) => l.trim() === '{await $q}')

describe('un {await} dans une branche d\'un autre {await} : erreur de construction', () => {
  afterEach(() => setMessagesLang('fr'))

  const REFUSES: Array<[string, string[]]> = [
    ['la branche {success}', DANS_SUCCES],
    ['la branche d\'attente', DANS_ATTENTE],
    ['la branche {error}', DANS_ERREUR],
    ['un {if} de la branche {success}', DANS_SI]
  ]

  for (const [lieu, corps] of REFUSES) {
    it(`dans ${lieu} : refusé, la ligne et la consigne en français`, async () => {
      const message = await refus(corps)
      assert.notEqual(message, null, 'le gabarit se compilait sans erreur')
      const ligne = ligneDe(corps)
      assert.match(message!, new RegExp(`\\{await\\} \\(ligne ${ligne}\\) : un \\{await\\} imbriqué dans la branche d'un autre \\{await\\} n'est pas supporté`))
      assert.match(message!, /déplacez-le dans un sous-composant que cette branche affiche/)
    })
  }

  it('en anglais : « line », la consigne en anglais', async () => {
    setMessagesLang('en')
    const message = await refus(DANS_SUCCES)
    assert.notEqual(message, null, 'le gabarit se compilait sans erreur')
    assert.match(message!, new RegExp(`\\{await\\} \\(line ${ligneDe(DANS_SUCCES)}\\): an \\{await\\} nested inside a branch of another \\{await\\} is not supported`))
    assert.match(message!, /move it into a child component that this branch displays/)
  })

  it('les {await} permis se compilent : l\'un après l\'autre à la racine, et dans un {if} de la racine', async () => {
    assert.equal(await refus(A_LA_RACINE), null)
    assert.equal(await refus(DANS_SI_RACINE), null)
  })

  it('dans un {for} : le refus garde son message', async () => {
    const message = await refus(DANS_POUR)
    assert.notEqual(message, null, 'le gabarit se compilait sans erreur')
    assert.match(message!, new RegExp(`\\{await\\} \\(ligne ${ligneDe(DANS_POUR)}\\) : un \\{await\\} imbriqué dans un \\{for\\} n'est pas supporté`))
  })
})
