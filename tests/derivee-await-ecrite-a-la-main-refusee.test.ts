// une valeur dérivée qui attend (`$r = await f($q)`) ne s'écrit pas à la main ailleurs : la réponse suivante écraserait la valeur
// écrite sans un mot. Refusé à la construction (méthode, gestionnaire du gabarit, valeur de départ, `+=`, `++`), le message dit
// pourquoi et quoi écrire. Changer son contenu (`$r.push(…)`) et écrire une autre variable restent permis

import assert from 'node:assert/strict'
import { refus, compile } from './helpers/derivee-await-refus.js'

const SOURCE = (avant: string, apres: string, gabarit = '<i>{($r or []).length}</i>') => `<script>\n  $q = ''\n  f = (q) -> fetch("/api/e-#{q}").then((r) -> r.json())\n${avant}  $r = await f($q)\n${apres}</script>\n${gabarit}\n`

describe('dérivée qui attend — écrite à la main ailleurs : refusée', function () {
  this.timeout(60000)

  for (const [nom, source] of [
    ['une méthode qui écrit $r = []', SOURCE('', '  @vider = -> $r = []\n')],
    ['une valeur de départ écrite avant', SOURCE('  $r = []\n', '')],
    ['un gestionnaire du gabarit', SOURCE('', '', '<b @click={$r = []}>vider</b>')],
    ['$r += …', SOURCE('', '  @plus = -> $r += 1\n')],
    ['$r++', SOURCE('', '  @plus = -> $r++\n')],
  ] as Array<[string, string]>) {
    it(nom + ' : refusé, le message dit pourquoi et quoi écrire', async () => {
      const message = await refus(source)
      assert.match(message, /\$r est écrite à la main/, message)
      assert.match(message, /écraserait sans un mot/, message)
      assert.match(message, /changez une variable \$ qu'elle cite/, message)
      assert.match(message, /\(\$r or \[\]\)/, message)
    })
  }

  it('changer son contenu et écrire une autre variable restent permis', async () => {
    const js = await compile(SOURCE('', '  @ajouter = (x) -> $r.push(x)\n  @chercher = (q) -> $q = q\n'))
    assert.match(js, /µ\._mjs_setAwait\(_mjsThis, 'r'/)
  })
})
