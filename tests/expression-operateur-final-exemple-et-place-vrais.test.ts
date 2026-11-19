// une expression du gabarit qui finit par un opérateur (`{if $a ==}`, `{$a +}`) : refusée, avec un exemple tiré de l'expression écrite
// (jamais « $a + 1 » pour une comparaison) et sa place vraie : le fichier, la ligne et la colonne où elle est écrite, tête d'un bloc
// `{if …}` ou `{elsif …}` comprise ; une place qui ne se retrouve pas n'est pas citée (jamais le repère interne `refus.expr:1:2`)
import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { refus } from './helpers/derivee-await-refus.js'

const S = '<script>\n  $a = 1\n  $b = 0\n  $l = [1]\n</script>\n'

describe('expression qui finit par un opérateur : l\'exemple et la place vrais', function () {
  this.timeout(200000)
  after(async () => { await terminateSharedWorkerPool() })

  it('{if $a ==} : l\'exemple de la comparaison, la place de la tête du bloc', async () => {
    const msg = await refus(S + '<p>a</p>\n{if $a ==}<i>x</i>{end}\n')
    assert.ok(msg.includes('« $a == » — refus.mjs:7:5 —'), msg)
    assert.ok(msg.includes('complétez-la (« $a == … »)'), msg)
    assert.ok(!msg.includes('$a + 1'), msg)
  })

  it('{elsif $a ==} : la place de la tête du bloc', async () => {
    const msg = await refus(S + '{if $b}<i>x</i>\n{elsif $a ==}<i>y</i>{end}\n')
    assert.ok(msg.includes('« $a == » — refus.mjs:7:8 —'), msg)
  })

  it('{$a +} : la place et l\'exemple tiré de l\'expression', async () => {
    const msg = await refus(S + '<i>{$a +}</i>\n')
    assert.ok(msg.includes('« $a + » — refus.mjs:6:5 —'), msg)
    assert.ok(msg.includes('complétez-la (« $a + … »)'), msg)
  })

  it('une place qui ne se retrouve pas : aucun repère interne cité', async () => {
    const msg = await refus(S + '{for x in $l ==}<i>{x}</i>{end}\n')
    assert.match(msg, /finit par l'opérateur « == »/, msg)
    assert.ok(!msg.includes('.expr:'), msg)
  })
})
