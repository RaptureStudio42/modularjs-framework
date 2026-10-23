// `§n++`, `§n--`, et les affectations `|=`, `&=`, `^=`, `<<=`, `>>=`, `>>>=` sur un contexte s'arrêtaient sur un message
// obscur du compilateur (« Call expression ending with Call is not a valid left-hand side »). Ils s'écrivent comme sur
// une variable : `§n++` et `++§n` valent `§n += 1`, `§n--` et `--§n` valent `§n -= 1`, `§f |= v` vaut `§f = §f | (v)`,
// pour `§` comme pour `§§`.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tokenize } from '../src/lexer/index.js'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const LIRE   = (nom: string): string => `_mjsThis._mjs_getContext('${nom}')`
const ECRIRE = (nom: string, valeur: string): string => `_mjsThis._mjs_setContext('${nom}', ${valeur})`

describe('incrément et opérateurs bit à bit sur un contexte', () => {
  it('`§n++`, `++§n`, `§n--`, `--§n`', () => {
    assert.equal(tokenize('§n++'), ECRIRE('n', `${LIRE('n')} + 1`))
    assert.equal(tokenize('++§n'), ECRIRE('n', `${LIRE('n')} + 1`))
    assert.equal(tokenize('§n--'), ECRIRE('n', `${LIRE('n')} - 1`))
    assert.equal(tokenize('--§n'), ECRIRE('n', `${LIRE('n')} - 1`))
    assert.equal(tokenize('§§total++'), "_mjsThis._mjs_setRCtx('total', ((_c) => _c && typeof _c === 'object' && Object.keys(_c).join() === 'value' ? _c.value : _c)(_mjsThis._mjs_getRCtx('total')) + 1)")
  })

  it('opérateurs bit à bit, la valeur entre parenthèses', () => {
    assert.equal(tokenize('§f |= a'), ECRIRE('f', `${LIRE('f')} | (a)`))
    assert.equal(tokenize('§f &= 6'), ECRIRE('f', `${LIRE('f')} & (6)`))
    assert.equal(tokenize('§f ^= 3'), ECRIRE('f', `${LIRE('f')} ^ (3)`))
    assert.equal(tokenize('§f <<= 2'), ECRIRE('f', `${LIRE('f')} << (2)`))
    assert.equal(tokenize('§f >>= 1'), ECRIRE('f', `${LIRE('f')} >> (1)`))
    assert.equal(tokenize('§f >>>= 1'), ECRIRE('f', `${LIRE('f')} >>> (1)`))
  })

  it('témoins : comparaisons, chaînes et `|>` inchangés', () => {
    assert.equal(tokenize('ok = §n >= 1'), `ok = ${LIRE('n')} >= 1`)
    assert.equal(tokenize('ok = §n <= 1'), `ok = ${LIRE('n')} <= 1`)
    assert.equal(tokenize("s = '§n++'"), "s = '§n++'")
    assert.equal(tokenize('x = §n |> f'), `x = ${LIRE('n')} |> f`)
  })

  describe('composant monté', function () {
    this.timeout(90000)
    let app: any

    before(async () => {
      const root   = mjsTmp('contexte-increment')
      const srcDir = join(root, 'src')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'ctx-increment.mjs'), [
        '<script>',
        '§n = 0',
        '§f = 1',
        'plus = -> §n++',
        'moins = -> --§n',
        'drapeau = -> §f |= 4',
        '$lu = 0',
        '$lire = -> $lu = §n * 100 + §f',
        '</script>',
        '<p class="v">{$lu}</p>',
        '<button class="plus" @click={plus()}>+</button>',
        '<button class="moins" @click={moins()}>-</button>',
        '<button class="drapeau" @click={drapeau()}>|</button>',
        '<button class="lire" @click={$lire()}>=</button>',
      ].join('\n'))
      writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
      app = await createHarness({ root })
    })
    after(async () => { if (app) await app.destroy() })

    it('trois `+`, un `-`, un `|= 4` : n = 2, f = 5', async () => {
      const c = await app.mount('ctx-increment')
      try {
        await c.click('.plus')
        await c.click('.plus')
        await c.click('.plus')
        await c.click('.moins')
        await c.click('.drapeau')
        await c.click('.lire')
        assert.equal(c.text('.v'), '205')
      }
      finally { c.destroy() }
    })
  })
})
