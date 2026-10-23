// module cœur carousel (<@@carousel>) : cas limites — `change` n'est émis que si la vignette du
// centre change vraiment (une seule vignette, bout atteint sans boucle), un index non entier est
// arrondi au lieu de faire tomber le placement, un glissé horizontal du pavé tactile ne fait pas
// reculer le carrousel.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote, pause } from './helpers/coeur-monter.js'

describe('mjs-core-carousel — cas limites', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('une seule vignette, ou le bout atteint sans boucle : « suivant » n\'émet pas change', async () => {
    const { window, hote } = await monterHote([
      '<script>',
      '  $n = 0',
      '</script>',
      '<@@carousel id="c1" @change={$n++}><div>1</div></@@carousel>',
      '<@@carousel id="c2" loop="false" index="1" @change={$n++}><div>1</div><div>2</div></@@carousel>',
      '<p id="n">{$n}</p>',
    ].join('\n'), 'carousel-change')
    hote._shadow.querySelector('#c1')._shadow.querySelector('.next').click()
    hote._shadow.querySelector('#c2')._shadow.querySelector('.next').click()
    await pause(60)
    assert.equal(hote._shadow.querySelector('#n').textContent, '0')
    window.close()
  })

  it('index non entier : arrondi, les vignettes restent placées', async () => {
    const { window, hote, erreurs } = await monterHote('<@@carousel id="c" index={1.5}><div>1</div><div>2</div><div>3</div><div>4</div><div>5</div></@@carousel>', 'carousel-index')
    const items = [...hote._shadow.querySelector('#c').children]
    assert.deepEqual(items.map((d: any) => d.getAttribute('mjs-carousel-pos')), ['-2', '-1', '0', '1', '2'])
    assert.equal(erreurs.length, 0, erreurs.join(' | '))
    window.close()
  })

  it('molette : un glissé horizontal ne fait pas tourner, un cran vertical si', async () => {
    const { window, hote } = await monterHote('<script>\n  $i = 2\n</script>\n<@@carousel id="c" wheel index=!{$i}><div>1</div><div>2</div><div>3</div><div>4</div><div>5</div></@@carousel>\n<p id="i">{$i}</p>', 'carousel-molette')
    const c = hote._shadow.querySelector('#c')
    c.dispatchEvent(new window.WheelEvent('wheel', { deltaX: 120, deltaY: 0, bubbles: true, cancelable: true }))
    await pause(60)
    assert.equal(hote._shadow.querySelector('#i').textContent, '2', 'glissé horizontal : rien')
    c.dispatchEvent(new window.WheelEvent('wheel', { deltaX: 0, deltaY: 100, bubbles: true, cancelable: true }))
    await pause(60)
    assert.equal(hote._shadow.querySelector('#i').textContent, '3', 'cran vertical : la suivante')
    window.close()
  })
})
