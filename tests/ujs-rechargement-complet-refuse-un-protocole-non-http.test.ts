// Rechargement complet de repli (réponse `X-MJS-Reload`, page impossible à installer) : comme la
// navigation complète de repli, il ne part que vers une adresse http(s). Une destination `javascript:`
// ou `data:` exécuterait du code au lieu de naviguer : elle est refusée, avec un avertissement.
//
// Méthode : bloc des aides de navigation de mjs_ujs.ts sur une fenêtre simulée qui relève
// `location.assign` et `location.reload`.

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { extractMarked } from './helpers/extract-marked.js'
import { poserMessages } from './helpers/messages-stub.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const UJS_SRC = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_ujs.ts'), 'utf-8')

function monter() {
  const appels: any[] = []
  const avert: string[] = []
  const win: any = { location: { href: 'http://localhost/a', origin: 'http://localhost', pathname: '/a', search: '', hash: '', assign(u: string) { appels.push(['assign', u]) }, reload() { appels.push(['reload']) } }, history: { pushState() {}, replaceState() {} } }
  const µ: any = { warn: (m: string) => avert.push(String(m)), error() {}, log() {}, pageCache: new Map(), _mjs_navSeq: 0 }
  poserMessages(µ)
  new Function('µ', 'document', 'window', extractMarked(UJS_SRC, 'helpers-navigation'))(µ, {}, win)
  return { µ, appels, avert }
}

describe('mjs_ujs — le rechargement complet refuse un protocole non http(s)', function () {
  for (const dest of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>']) {
    it(dest.split(':')[0] + ': refusé, ni assign ni reload, un avertissement', function () {
      const { µ, appels, avert } = monter()
      µ._mjs_navHardReload(dest)
      assert.deepEqual(appels, [], 'AVANT : location.assign(' + dest + ')')
      assert.equal(avert.length, 1)
      assert.match(avert[0], /http/)
    })
  }

  it('adresse http de la même origine : assign, comme avant', function () {
    const { µ, appels, avert } = monter()
    µ._mjs_navHardReload('/b')
    assert.deepEqual(appels, [['assign', 'http://localhost/b']])
    assert.deepEqual(avert, [])
  })

  it('même document : reload, comme avant', function () {
    const { µ, appels } = monter()
    µ._mjs_navHardReload('/a')
    assert.deepEqual(appels, [['reload']])
  })
})
