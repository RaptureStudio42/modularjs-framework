// `@formAssociated` écrit deux fois dans un composant : la compilation passe (la directive n'a qu'un sens), mais un avertissement le dit,
// au vouvoiement, avec le nom du composant, dans la langue des messages du projet (français, ou anglais avec `lang: 'en'`) ; écrite une
// fois, aucun avertissement

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { setMessagesLang } from '../src/messages/index.js'

const avertissements = async (source: string) =>
  ((await transpile(source, { moduleName: 'essai-champ' })).data.sectionWarnings as string[]).filter((l) => l.includes('@formAssociated'))

describe('@formAssociated écrit deux fois', function () {
  this.timeout(60000)

  after(async () => { await terminateSharedWorkerPool() })
  afterEach(() => setMessagesLang('fr'))

  it('deux fois : un avertissement qui nomme le composant ; le composant reste associé au formulaire', async function () {
    const source = '@formAssociated\n@formAssociated\n\n<p>champ</p>\n'
    const vus    = await avertissements(source)
    assert.equal(vus.length, 1, JSON.stringify(vus))
    assert.match(vus[0], /essai-champ/)
    assert.match(vus[0], /deux fois|plusieurs fois/)
    assert.match((await transpile(source, { moduleName: 'essai-champ' })).output, /µ\._mjs_formClass\(/)
  })

  it('deux fois, messages en anglais : le même avertissement, en anglais, qui nomme le composant', async function () {
    setMessagesLang('en')
    const vus = await avertissements('@formAssociated\n@formAssociated\n\n<p>field</p>\n')
    assert.equal(vus.length, 1, JSON.stringify(vus))
    assert.match(vus[0], /essai-champ/)
    assert.match(vus[0], /@formAssociated is written more than once — one line is enough, remove the others\./)
  })

  it('une fois : aucun avertissement', async function () {
    assert.deepEqual(await avertissements('@formAssociated\n\n<p>champ</p>\n'), [])
  })
})
