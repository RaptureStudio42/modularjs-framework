// un attribut dont le nom commence par « on » et dont la valeur est calculée (`one={$x}`) : le filtre des attributs du runtime refuse
// tout nom `on` suivi d'une lettre (un étalement qui porte `one` ne le pose pas), il resterait absent ; le refus de la construction est
// donc juste. Son message ne propose `@nom={…}` que pour un événement de la liste du navigateur (`onclick`, `onfullscreenchange`) ; hors
// de la liste, un vrai événement (`onsearch`, `onwebkitfullscreenchange`) ou non (`one`), les deux voies, sans nom d'événement
// (jamais `@e={…}` pour `one`) : « @…={…} » si c'est un événement, un nom `data-…` sinon
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createHarness } from '../src/testing/index.js'
import { refus } from './helpers/derivee-await-refus.js'
import { mjsTmp } from './helpers/tmp.js'

const avec = (balise: string) => `<script>\n  $x = 1\n</script>\n${balise}\n`

describe('attribut on… calculé : @nom proposé pour un vrai événement seulement', function () {
  this.timeout(200000)
  after(async () => { await terminateSharedWorkerPool() })

  it('one={$x} : refusé, aucun @e={…}, les deux voies', async () => {
    const msg = await refus(avec('<i one={$x}>x</i>'))
    assert.match(msg, /<i one=…>/, msg)
    assert.ok(!msg.includes('@e={'), msg)
    assert.ok(msg.includes('si c\'est un événement, écrivez-le « @…={…} »') && msg.includes('« data-one »'), msg)
  })

  it('onsearch={$x}, un vrai événement hors de la liste : les deux voies, « @…={…} » d\'abord', async () => {
    const msg = await refus(avec('<input onsearch={$x}>'))
    assert.ok(msg.includes('si c\'est un événement, écrivez-le « @…={…} »') && msg.includes('« data-onsearch »'), msg)
  })

  it('onwebkitfullscreenchange={$x} : les deux voies', async () => {
    const msg = await refus(avec('<i onwebkitfullscreenchange={$x}>x</i>'))
    assert.ok(msg.includes('si c\'est un événement, écrivez-le « @…={…} »') && msg.includes('« data-onwebkitfullscreenchange »'), msg)
  })

  it('onfullscreenchange={$x} : un vrai événement, @fullscreenchange={…} proposé', async () => {
    const msg = await refus(avec('<i onfullscreenchange={$x}>x</i>'))
    assert.ok(msg.includes('« @fullscreenchange={…} »'), msg)
  })

  it('onclick={$x} : @click={…} proposé', async () => {
    const msg = await refus(avec('<i onclick={$x}>x</i>'))
    assert.ok(msg.includes('« @click={…} »'), msg)
  })

  it('la scène : un étalement qui porte one ne le pose pas, data-x posé', async () => {
    const root = mjsTmp('attribut-one-etale')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'one-etale.mjs'), `<p class="e" {...$o}>e</p>\n<script>\n  $o = { one: '1', 'data-x': 'x' }\n</script>\n`)
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
    const app = await createHarness({ root })
    try {
      const c = await app.mount('one-etale')
      await c.tick()
      assert.deepEqual([c.find('.e').getAttribute('one'), c.find('.e').getAttribute('data-x')], [null, 'x'])
      c.destroy()
    }
    finally { await app.destroy() }
  })
})
