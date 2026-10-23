// Dans un gestionnaire du gabarit (`@click={§total += 1}`), une affectation composée, un incrément ou un décrément
// sur un contexte s'arrêtaient sur un message obscur du compilateur : le contexte était lu, puis l'opérateur
// s'appliquait à la lecture (`this._mjs_getContext('total') += 1`). Ils s'écrivent comme dans le `<script>` :
// `§x += v` vaut `§x = §x + (v)` (de même `-=`, `*=`, `|=`, `&=`, `<<=`…), `§x ||= v` vaut `§x || (§x = v)`,
// `§x++` et `++§x` valent `§x += 1`, `§x--` et `--§x` valent `§x -= 1`, pour `§` comme pour `§§`.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanJs } from '../src/generator/utils.js'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const LIRE   = (nom: string): string => `this._mjs_getContext('${nom}')`
const ECRIRE = (nom: string, valeur: string): string => `this._mjs_setContext('${nom}', ${valeur})`

describe('affectation composée sur un contexte, dans un gestionnaire du gabarit', () => {
  it('opérateurs arithmétiques et bit à bit, la valeur entre parenthèses', () => {
    assert.equal(cleanJs('§total += 1', []), ECRIRE('total', `${LIRE('total')} + (1)`))
    assert.equal(cleanJs('§x *= $n', []), ECRIRE('x', `${LIRE('x')} * ($.n)`))
    assert.equal(cleanJs('§x -= 2', []), ECRIRE('x', `${LIRE('x')} - (2)`))
    assert.equal(cleanJs('§x **= 2', []), ECRIRE('x', `${LIRE('x')} ** (2)`))
    assert.equal(cleanJs('§f |= 4', []), ECRIRE('f', `${LIRE('f')} | (4)`))
    assert.equal(cleanJs('§f &= 6', []), ECRIRE('f', `${LIRE('f')} & (6)`))
    assert.equal(cleanJs('§f ^= 3', []), ECRIRE('f', `${LIRE('f')} ^ (3)`))
    assert.equal(cleanJs('§f <<= 2', []), ECRIRE('f', `${LIRE('f')} << (2)`))
    assert.equal(cleanJs('§f >>= 1', []), ECRIRE('f', `${LIRE('f')} >> (1)`))
    assert.equal(cleanJs('§f >>>= 1', []), ECRIRE('f', `${LIRE('f')} >>> (1)`))
    assert.equal(cleanJs('§x+=1', []), ECRIRE('x', `${LIRE('x')} + (1)`))
  })

  it('les opérateurs logiques n\'écrivent que si besoin', () => {
    assert.equal(cleanJs("§x ||= 'défaut'", []), `${LIRE('x')} || ${ECRIRE('x', "'défaut'")}`)
    assert.equal(cleanJs('§x &&= 0', []), `${LIRE('x')} && ${ECRIRE('x', '0')}`)
    assert.equal(cleanJs('§§theme ??= 1', []), "((_c) => _c && typeof _c === 'object' && Object.keys(_c).join() === 'value' ? _c.value : _c)(this._mjs_getRCtx('theme')) ?? this._mjs_setRCtx('theme', 1)")
  })

  it('incrément et décrément, avant ou après le nom', () => {
    assert.equal(cleanJs('§n++', []), ECRIRE('n', `${LIRE('n')} + 1`))
    assert.equal(cleanJs('++§n', []), ECRIRE('n', `${LIRE('n')} + 1`))
    assert.equal(cleanJs('§n--', []), ECRIRE('n', `${LIRE('n')} - 1`))
    assert.equal(cleanJs('--§n', []), ECRIRE('n', `${LIRE('n')} - 1`))
    assert.equal(cleanJs('§§total++', []), "this._mjs_setRCtx('total', ((_c) => _c && typeof _c === 'object' && Object.keys(_c).join() === 'value' ? _c.value : _c)(this._mjs_getRCtx('total')) + 1)")
    assert.equal(cleanJs('§§total += 2', []), "this._mjs_setRCtx('total', ((_c) => _c && typeof _c === 'object' && Object.keys(_c).join() === 'value' ? _c.value : _c)(this._mjs_getRCtx('total')) + (2))")
  })

  it('un `if` postfixe et une deuxième instruction restent hors de la valeur', () => {
    assert.equal(cleanJs('§total += 1 if $ok', []), `${ECRIRE('total', `${LIRE('total')} + (1)`)} if $.ok`)
    assert.equal(cleanJs('§x += 1; §y -= 2', []), `${ECRIRE('x', `${LIRE('x')} + (1)`)}; ${ECRIRE('y', `${LIRE('y')} - (2)`)}`)
  })

  it('témoins : chaînes, comparaisons et affectation simple inchangées', () => {
    assert.equal(cleanJs("$s = '§x++ et §y += 1'", []), "$.s = '§x++ et §y += 1'")
    assert.equal(cleanJs('ok = §x >= 1', []), `ok = ${LIRE('x')} >= 1`)
    assert.equal(cleanJs('ok = §x <= 1', []), `ok = ${LIRE('x')} <= 1`)
    assert.equal(cleanJs('ok = §x != 1', []), `ok = ${LIRE('x')} != 1`)
    assert.equal(cleanJs('ok = §x == 1', []), `ok = ${LIRE('x')} == 1`)
    assert.equal(cleanJs('§x = 1', []), ECRIRE('x', '1'))
  })

  describe('composant monté', function () {
    this.timeout(90000)
    let app: any

    before(async () => {
      const root   = mjsTmp('contexte-compose-gestionnaire')
      const srcDir = join(root, 'src')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'ctx-gestionnaire.mjs'), [
        '<script>',
        '§total = 0',
        '§f = 1',
        '$lu = 0',
        '$lire = -> $lu = §total * 100 + §f',
        '</script>',
        '<p class="v">{$lu}</p>',
        '<button class="plus" @click={§total += 2}>+</button>',
        '<button class="incr" @click={§total++}>++</button>',
        '<button class="decr" @click={--§total}>--</button>',
        '<button class="drapeau" @click={§f |= 4}>|</button>',
        '<button class="lire" @click={$lire()}>=</button>',
      ].join('\n'))
      writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
      app = await createHarness({ root })
    })
    after(async () => { if (app) await app.destroy() })

    it('`+= 2`, `++`, `--` et `|= 4` écrivent le contexte du composant', async () => {
      const c = await app.mount('ctx-gestionnaire')
      try {
        await c.click('.plus')
        await c.click('.incr')
        await c.click('.incr')
        await c.click('.decr')
        await c.click('.drapeau')
        await c.click('.lire')
        assert.equal(c.text('.v'), String(3 * 100 + 5))
      }
      finally { c.destroy() }
    })
  })
})
