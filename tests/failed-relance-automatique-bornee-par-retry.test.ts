// Un repli qui relance seul le composant (`µfailed (err, reset) -> setTimeout(reset, 10)`) sur un composant qui
// replante après son premier rendu (donnée arrivée en différé, minuterie) : les relances restent bornées par `retry`,
// quelle que soit la période du plantage. Défauts garantis absents : le compte de réessais repartait de zéro dès la
// fin du premier rendu de l'instance neuve, avant qu'elle replante — le composant était reconstruit sans fin (des
// dizaines de fois par seconde) ; puis, effacé après deux secondes vécues sans replanter, il laissait reconstruire
// sans fin un composant qui replantait au-delà (une fois toutes les 2,3 s, requête relancée à chaque montage). Seul un
// reset voulu par l'utilisateur (pendant un geste) peut faire repartir le compte de zéro ; une relance par le code
// jamais, que le navigateur connaisse `navigator.userActivation` ou non.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

const BOUCLE = [
  '<script>',
  'window.__n = (window.__n or 0) + 1',
  '$boom = false',
  '$x = null',
  'setTimeout((=> $boom = true), 5)',
  'µfailed (err, reset)->',
  '  setTimeout(reset, 10)',
  '  \'<p class="fb">oups</p>\'',
  '</script>',
  '{if $boom}<i>{$x.crash}</i>{end}',
  '<p class="ok">ok</p>',
].join('\n')

const LENTE = BOUCLE.replace('window.__n', 'window.__m').replace('window.__n', 'window.__m').replace('), 5)', '), 2300)')

describe('<@failed> — une relance automatique reste bornée par retry', function () {
  this.timeout(60000)
  let app: any

  before(async () => {
    const root = mjsTmp('failed-relance-bornee')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'tst-frb-boucle.mjs'), BOUCLE)
    writeFileSync(join(root, 'src', 'tst-frb-lente.mjs'), LENTE)
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }))
    app = await createHarness({ root })
    app.window.console.error = () => {}
  })

  after(async () => {
    if (app) await app.destroy()
  })

  it('plantage 5 ms après chaque montage, repli qui relance seul : une construction de plus que retry, pas davantage', async () => {
    app.window.__n = 0
    const c = await app.mount('tst-frb-boucle')
    await pause(800)
    const apres800 = app.window.__n
    await pause(400)
    assert.equal(apres800 <= 2, true, 'constructions en 800 ms : ' + apres800)
    assert.equal(app.window.__n, apres800, 'plus aucune construction ensuite')
    c.destroy()
  })

  it('plantage 2,3 s après chaque montage, repli qui relance seul : une construction de plus que retry, pas davantage', async () => {
    app.window.__m = 0
    Object.defineProperty(app.window.navigator, 'userActivation', { configurable: true, value: { isActive: false } })
    const c = await app.mount('tst-frb-lente')
    await pause(7600)
    assert.equal(app.window.__m <= 2, true, 'constructions en 7,6 s : ' + app.window.__m)
    c.destroy()
    delete app.window.navigator.userActivation
  })
})
