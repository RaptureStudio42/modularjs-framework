// Deux lectures du code MJS par les passes de sucre (sigils.ts) :
//   - `µimport("l'outil.js")` dans un gestionnaire était réécrit entre apostrophes (`µasset('l'outil.js')`) :
//     la construction échouait sur une erreur de Civet sans rapport
//   - après la parenthèse d'une condition (`if (ok) /'/.test(s)`), le `/` était lu comme une division :
//     l'apostrophe de la regex ouvrait une fausse chaîne qui avalait la suite, un µtoggle placé après n'était
//     plus réécrit (« µtoggle is not defined » au montage)

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { ouvreUneRegex } from '../src/sigils.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote } from './helpers/coeur-monter.js'

describe('sigils — µimport avec une apostrophe dans un gestionnaire', () => {
  it('µimport("l\'outil.js") dans @click se construit et garde le chemin', async () => {
    const { output } = await transpile('<script>\n$a = 1\n</script>\n<button @click={µimport("l\'outil.js")}>x</button>', { moduleName: 'import-apostrophe' })
    assert.match(output, /l'outil\.js/)
  })

  it('témoin : µimport(\'outil.js\') reste réécrit', async () => {
    const { output } = await transpile("<button @click={µimport('outil.js')}>x</button>", { moduleName: 'import-temoin' })
    assert.match(output, /_mjs_import/)
  })
})

describe('sigils — regex après la parenthèse d\'une condition', function () {
  this.timeout(90000)
  after(async () => { await terminateSharedWorkerPool() })

  it('ouvreUneRegex : après if (…), while (…), for (…) oui ; après un appel ou un groupe non', () => {
    assert.equal(ouvreUneRegex('if (ok) '), true)
    assert.equal(ouvreUneRegex('x = 1\nwhile (a(b)) '), true)
    assert.equal(ouvreUneRegex('for (const c of l) '), true)
    assert.equal(ouvreUneRegex('f(ok) '), false)
    assert.equal(ouvreUneRegex('x = (a + b) '), false)
    assert.equal(ouvreUneRegex('motif(ok) '), false)
    assert.equal(ouvreUneRegex("x = (a + ')') "), false)
  })

  it('un µtoggle placé après `if (ok) /\'/.test(s)` est réécrit (lang="js", monté)', async () => {
    const { hote } = await monterHote('<script lang="js">\n$x = false\nconst s = "a\'b"\nconst ok = true\nif (ok) /\'/.test(s)\nµtoggle($x)\n</script>\n<p>{$x}</p>', 'regex-condition')
    assert.equal(hote._shadow.querySelector('p')?.textContent, 'true')
  })
})
