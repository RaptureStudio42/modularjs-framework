// Un mot de MJS (`:preload`, `:method`, `:noUJS`, `:html`…) qui reçoit une valeur qu'il ne prend pas, un gestionnaire entre accolades
// compris (`:preload={@noter(e)}`), est refusé à la construction : le message donne la forme du mot et renvoie à µmount pour écouter un
// événement de ce nom. Le signe `:` ne sert qu'aux mots de MJS ; un événement s'écoute avec `@` (`@choix={…}`)

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { setMessagesLang } from '../src/messages/index.js'

const source = (balise: string) => `<script>\n  @noter = (e)-> console.log(e)\n</script>\n\n${balise}\n`

// [balise, attribut cité, mot, forme donnée]
const CAS: [string, string, string, string][] = [
  ['<@enfant :preload={@noter(e)}>', ':preload={@noter(e)}', 'preload', ':preload="hover"'],
  ['<a href="/x" :preload={@noter(e)}>x</a>', ':preload={@noter(e)}', 'preload', ':preload="hover"'],
  ['<a href="/x" :preload="bientot">x</a>', ':preload="bientot"', 'preload', ':preload="hover"'],
  ['<a href="/x" :method={@noter(e)}>x</a>', ':method={@noter(e)}', 'method', ':method="…"'],
  ['<p :html={@noter(e)}>x</p>', ':html={@noter(e)}', 'html', ':html=!{…}'],
  ['<@enfant :emit={@noter(e)}>', ':emit={@noter(e)}', 'emit', ':emit.x={…}'],
  ['<input type="checkbox" aria-label="a" :group={@noter(e)}>', ':group={@noter(e)}', 'group', ':group.x=!{…}'],
]

describe('un mot de MJS ne reçoit pas de gestionnaire : refus, jamais l\'écoute d\'un événement', () => {
  afterEach(() => setMessagesLang('fr'))

  for (const [balise, ecrit, mot, forme] of CAS) it(`${balise} : refus qui donne la forme du mot et renvoie à µmount`, async () => {
    await assert.rejects(() => transpile(source(balise), { moduleName: 'mjs-mot-gestionnaire' }), (e: any) => {
      for (const attendu of [`« ${ecrit} »`, forme, 'µmount', `addEventListener('${mot}'`]) assert.ok(e.message.includes(attendu), `« ${attendu} » attendu dans : ${e.message}`)
      return true
    })
  })

  it('en anglais aussi', async () => {
    setMessagesLang('en')
    await assert.rejects(() => transpile(source('<@enfant :preload={@noter(e)}>'), { moduleName: 'mjs-mot-gestionnaire-en' }), (e: any) => {
      assert.ok(e.message.includes('"preload" is a MJS word') && e.message.includes(':preload="hover"') && e.message.includes('µmount'), e.message)
      return true
    })
  })

  it('un événement s\'écoute toujours avec @ : @choix={…} sur un composant', async () => {
    const { output } = await transpile(source('<@enfant @choix={@noter(e)}>'), { moduleName: 'mjs-mot-gestionnaire-evenement' })
    assert.match(output, /"choix":\{/)
  })
})
