// `await` écrit au premier niveau du script d'un composant hors d'une valeur dérivée (`$x =: await …`, `config = await …`,
// `$x += await …`, un `await` seul) : refusé à la construction par un message qui dit la forme juste, jamais « c'est un bogue du
// bundler ». Dans une fonction (`@charger = -> $moi = await f()`), `await` reste celui de JavaScript

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { refus, compile, erreursDeConstruction } from './helpers/derivee-await-refus.js'
import { getMessagesLang, setMessagesLang } from '../src/messages/index.js'

const SOURCE = (ligne: string) => `<script>\n  $q = ''\n  f = (q) -> fetch("/api/h-#{q}").then((r) -> r.json())\n${ligne}</script>\n<i>{$q}</i>\n`

describe('await hors d\'une valeur dérivée — un message clair', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('$x =: await f($q) : refusé, le message dit $x = await …', async () => {
    const message = await refus(SOURCE('  $x =: await f($q)\n'))
    assert.match(message, /« \$x =: await … »/, message)
    assert.match(message, /« \$x = await … »/, message)
  })

  for (const [nom, ligne, forme, exemple] of [
    ['config = await …', '  config = await f()\n', /« config = await … »/, /« \$config = await … »/],
    ['$x += await …', '  $x = 0\n  $x += await f()\n', /« \$x \+= await … »/, /« \$x = await … »/],
    ['un await seul', '  await f()\n', /« await … »/, /« \$valeur = await … »/],
  ] as Array<[string, string, RegExp, RegExp]>) {
    it(nom + ' : refusé, le message dit la forme juste', async () => {
      const message = await refus(SOURCE(ligne))
      assert.match(message, /au premier niveau du <script>/, message)
      assert.match(message, forme, message)
      assert.match(message, exemple, message)
      assert.match(message, /dans une fonction/, message)
    })
  }

  // sans nom, l'exemple est un texte du message : chaque langue écrit le sien
  it('un await seul, messages en anglais : l\'exemple est en anglais', async () => {
    const avant = getMessagesLang()
    setMessagesLang('en')
    try {
      const message = await refus(SOURCE('  await f()\n'))
      assert.match(message, /"\$value = await …"/, message)
    }
    finally { setMessagesLang(avant) }
  })

  it('la construction dit le message, jamais « c\'est un bogue du bundler »', async () => {
    const erreurs = await erreursDeConstruction('await-hors-derivee', { 'haut.mjs': SOURCE('  config = await f()\n') })
    assert.match(erreurs, /« config = await … »/, erreurs)
    assert.doesNotMatch(erreurs, /bogue du bundler/, erreurs)
  })

  it('dans une fonction, await reste celui de JavaScript', async () => {
    const js = await compile(SOURCE('  @charger = -> $moi = await f()\n'))
    assert.match(js, /this\.charger = async function/)
  })
})
