// les refus autour d'une valeur qui attend citent la ligne du fichier où la forme refusée est écrite, comme les autres refus de la
// construction ; la forme est citée telle qu'écrite (`x := await …`), le conseil suit la langue du script (`($r or [])` en Civet,
// `($r || [])` en JavaScript) et le refus d'un champ lié nomme le champ (`value=!{$r}`)

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { refus } from './helpers/derivee-await-refus.js'

// le script `lignes` (à partir de la ligne 2 du fichier), puis le gabarit
const composant = (lignes: string[], gabarit: string, lang = '') => `<script${lang ? ` lang="${lang}"` : ''}>\n${lignes.map((l) => '  ' + l).join('\n')}\n</script>\n${gabarit}\n`

describe('dérivée qui attend — les refus citent la ligne et la forme écrite', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  const cas: Array<[string, string, RegExp[]]> = [
    ['await hors d\'une valeur qui attend', composant(['f = -> Promise.resolve(1)', 'config = await f()'], '<i>{config}</i>'), [/'refus\.mjs', ligne 3 : « config = await … »/]],
    ['x := await …, cité tel qu\'écrit', composant(['f = -> Promise.resolve(1)', 'x := await f()'], '<i>{x}</i>'), [/'refus\.mjs', ligne 3 : « x := await … »/]],
    ['$x =: await …', composant(['f = -> Promise.resolve(1)', '$x =: await f()'], '<i>{$x}</i>'), [/'refus\.mjs', ligne 3 : « \$x =: await … »/]],
    ['magasin dans le <script>', composant(['$q = 1', 'f = (q) -> Promise.resolve(q)', '$$l = await f($q)'], '<i>{$$l}</i>'), [/'refus\.mjs', ligne 4 : « \$\$l = await … »/]],
    ['valeur qui se cite', composant(['$page = 1', 'f = (p, r) -> Promise.resolve(r)', '$r = await f($page, $r)'], '<i>{$r}</i>'), [/'refus\.mjs', ligne 4 : « \$r = await … »/]],
    ['µsignal hors de son expression', composant(['$q = 1', 'f = (q, s) -> Promise.resolve(q)', '$r = await f($q, µsignal)', '@go = -> f($q, µsignal)'], '<i>{$r}</i>'), [/'refus\.mjs', ligne 5 : « µsignal »/]],
    ['µpending sur une variable ordinaire', composant(['$n = 1'], '<i>{µpending($n)}</i>'), [/'refus\.mjs', ligne 4 : « µpending\(\$n\) »/]],
    ['écrite à la main, Civet', composant(['$q = 1', 'f = (q) -> Promise.resolve([q])', '$r = await f($q)'], '<button @click={$r = []}>x</button>'), [/'refus\.mjs', ligne 6 : \$r est écrite à la main/, /« \(\$r or \[\]\) »/]],
    ['écrite à la main, JavaScript', composant(['$q = 1', 'const f = (q) => Promise.resolve([q])', '$r = await f($q)'], '<button @click={$r = []}>x</button>', 'js'), [/'refus\.mjs', ligne 6 : \$r est écrite à la main/, /« \(\$r \|\| \[\]\) »/]],
    ['champ lié value', composant(['$q = 1', 'f = (q) -> Promise.resolve(q)', '$r = await f($q)'], '<input value=!{$r}>'), [/'refus\.mjs', ligne 6 : « value=!\{\$r\} »/]],
    ['champ lié checked', composant(['$q = 1', 'f = (q) -> Promise.resolve(q)', '$r = await f($q)'], '<input type="checkbox" checked=!{$r}>'), [/'refus\.mjs', ligne 6 : « checked=!\{\$r\} »/]],
  ]

  for (const [nom, source, attendus] of cas) {
    it(nom, async () => {
      const message = await refus(source)
      for (const attendu of attendus) assert.match(message, attendu, message)
      assert.doesNotMatch(message, /bogue du bundler/, message)
    })
  }

  it('le conseil en JavaScript ne propose pas « or »', async () => {
    const message = await refus(composant(['$q = 1', 'const f = (q) => Promise.resolve([q])', '$r = await f($q)'], '<button @click={$r = []}>x</button>', 'js'))
    assert.doesNotMatch(message, / or \[\]/, message)
  })
})
