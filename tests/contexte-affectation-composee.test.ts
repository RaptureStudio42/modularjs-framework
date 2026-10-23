// `§total += 1` s'arrêtait sur un message obscur du compilateur (« Call expression ending with Call is not a
// valid left-hand side »). Une affectation composée sur un contexte s'écrit comme sur une variable : `§x += v`
// vaut `§x = §x + (v)` (de même `-=`, `*=`, `/=`, `%=`, `**=`), `§x ||= v` vaut `§x or (§x = v)` (de même
// `&&=`, `??=`), pour `§` comme pour `§§`.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tokenize } from '../src/lexer/index.js'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const LIRE  = (nom: string): string => `_mjsThis._mjs_getContext('${nom}')`
const ECRIRE = (nom: string, valeur: string): string => `_mjsThis._mjs_setContext('${nom}', ${valeur})`

describe('affectation composée sur un contexte', () => {
  it('`§total += 1` se lit `§total = §total + (1)`', () => {
    assert.equal(tokenize('§total += 1'), ECRIRE('total', `${LIRE('total')} + (1)`))
  })

  it('les autres opérateurs arithmétiques, la valeur entre parenthèses', () => {
    assert.equal(tokenize('§x *= a + b'), ECRIRE('x', `${LIRE('x')} * (a + b)`))
    assert.equal(tokenize('§x -= 2'), ECRIRE('x', `${LIRE('x')} - (2)`))
    assert.equal(tokenize('§x /= 2'), ECRIRE('x', `${LIRE('x')} / (2)`))
    assert.equal(tokenize('§x %= 2'), ECRIRE('x', `${LIRE('x')} % (2)`))
    assert.equal(tokenize('§x **= $n'), ECRIRE('x', `${LIRE('x')} ** ($.n)`))
  })

  it('les opérateurs logiques n\'écrivent que si besoin', () => {
    assert.equal(tokenize("§x ||= 'défaut'"), `${LIRE('x')} || ${ECRIRE('x', "'défaut'")}`)
    assert.equal(tokenize('§x &&= 0'), `${LIRE('x')} && ${ECRIRE('x', '0')}`)
    assert.equal(tokenize("§§theme ??= { mode: 'clair' }"), "((_c) => _c && typeof _c === 'object' && Object.keys(_c).join() === 'value' ? _c.value : _c)(_mjsThis._mjs_getRCtx('theme')) ?? _mjsThis._mjs_setRCtx('theme', { mode: 'clair' })")
  })

  it('un `if` postfixe et un commentaire de fin restent hors de la valeur', () => {
    assert.equal(tokenize('§total += 1 if $ok   # note'), `${ECRIRE('total', `${LIRE('total')} + (1)`)} if $.ok   # note`)
    assert.equal(tokenize('§total += 1   # note'), `${ECRIRE('total', `${LIRE('total')} + (1)`)}   # note`)
  })

  it('comparaisons et affectation simple inchangées', () => {
    assert.equal(tokenize('ok = §x == 1'), `ok = ${LIRE('x')} == 1`)
    assert.equal(tokenize('ok = §x <= 1'), `ok = ${LIRE('x')} <= 1`)
    assert.equal(tokenize('ok = §x != 1'), `ok = ${LIRE('x')} != 1`)
    assert.equal(tokenize('§x = 1'), ECRIRE('x', '1'))
  })

  describe('composant monté', function () {
    this.timeout(90000)
    let app: any

    before(async () => {
      const root   = mjsTmp('contexte-affectation-composee')
      const srcDir = join(root, 'src')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'ctx-compose.mjs'), [
        '<script>',
        '§total = 0',
        'plus = -> §total += 1',
        "§nom ||= 'premier'",
        "§nom ||= 'second'",
        '$lu = 0',
        '$lire = -> $lu = §total',
        '</script>',
        '<p class="v">{$lu}</p>',
        '<button class="plus" @click={plus()}>+</button>',
        '<button class="lire" @click={$lire()}>=</button>',
      ].join('\n'))
      writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
      app = await createHarness({ root })
    })
    after(async () => { if (app) await app.destroy() })

    it('deux clics sur `plus` : 2 ; `||=` garde la première valeur', async () => {
      const c = await app.mount('ctx-compose')
      try {
        await c.click('.plus')
        await c.click('.plus')
        await c.click('.lire')
        assert.equal(c.text('.v'), '2')
        assert.equal(c.el._mjs_getContext('nom'), 'premier')
      }
      finally { c.destroy() }
    })
  })
})
