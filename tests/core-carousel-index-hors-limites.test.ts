// module cœur carousel (<@@carousel>) : sans boucle (loop="false"), un index hors du nombre de vignettes (écrit trop grand, négatif, ou
// une liste qui rétrécit sous un index lié) est ramené dans les bornes — la dernière, ou la première, vignette au centre, jamais une
// scène vide.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { attendre, monterHote, pause } from './helpers/coeur-monter.js'

const places = (el: any) => [...el.children].map((d: any) => d.getAttribute('mjs-carousel-pos') + '/' + d.style.getPropertyValue('--mjs-carousel-o'))

describe('mjs-core-carousel — index hors limites sans boucle', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('index="10" pour trois vignettes : la dernière au centre, visible ; « précédent » mène à l\'avant-dernière', async () => {
    const { window, hote } = await monterHote('<script>\n  $i = 10\n</script>\n<@@carousel id="c" index=!{$i} loop="false"><div>a</div><div>b</div><div>c</div></@@carousel>\n<p id="i">{$i}</p>', 'carousel-trop-grand')
    const c = hote._shadow.querySelector('#c')
    assert.deepEqual(places(c), ['-2/1', '-1/1', '0/1'])
    c._shadow.querySelector('.prev').click()
    await attendre(() => hote._shadow.querySelector('#i').textContent === '1')
    assert.equal(hote._shadow.querySelector('#i').textContent, '1')
    window.close()
  })

  it('index="-4" : la première au centre', async () => {
    const { window, hote } = await monterHote('<@@carousel id="c" index="-4" loop="false"><div>a</div><div>b</div><div>c</div></@@carousel>', 'carousel-negatif')
    assert.deepEqual(places(hote._shadow.querySelector('#c')), ['0/1', '1/1', '2/1'])
    window.close()
  })

  it('la liste rétrécit sous un index lié : la dernière qui reste vient au centre', async () => {
    const { window, hote } = await monterHote([
      '<script>',
      '  $l = [1, 2, 3, 4, 5]',
      '  $i = 4',
      '</script>',
      '<@@carousel id="c" index=!{$i} loop="false">{for n in $l}<div>{n}</div>{end}</@@carousel>',
      '<button id="b" @click={$l = [1, 2]}>moins</button>',
    ].join('\n'), 'carousel-retrecit')
    hote._shadow.querySelector('#b').click()
    const c = hote._shadow.querySelector('#c')
    await attendre(() => c.children.length === 2)
    await pause(60)
    assert.deepEqual(places(c), ['-1/1', '0/1'])
    window.close()
  })
})
