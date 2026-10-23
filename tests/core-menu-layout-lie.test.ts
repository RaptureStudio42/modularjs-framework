// module cœur menu (<@@menu layout={…}>) : le modèle lié change, le slot est rendu à neuf — les
// entrées ajoutées ensuite doivent quand même recevoir leur place (--mjs-menu-i, --mjs-menu-n) ;
// l'écoute du slot posée au montage restait sur l'ancien.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote, pause } from './helpers/coeur-monter.js'

describe('mjs-core-menu — modèle lié, entrées ajoutées ensuite', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('après un changement de modèle, une entrée ajoutée reçoit sa place', async () => {
    const { window, hote } = await monterHote([
      '<script>',
      '  $lay   = \'drawer\'',
      '  $items = [1, 2]',
      '</script>',
      '<@@menu id="m" layout={$lay}>{for x in $items}<a href="#">{x}</a>{end}</@@menu>',
      '<button id="rond" @click={$lay = \'\'}>r</button>',
      '<button id="plus" @click={$items = [...$items, 3]}>+</button>',
    ].join('\n'), 'menu-layout-lie')
    hote._shadow.querySelector('#rond').click()
    await pause(80)
    hote._shadow.querySelector('#plus').click()
    await pause(120)
    const m = hote._shadow.querySelector('#m')
    assert.deepEqual([...m.children].map((c: any) => c.style.getPropertyValue('--mjs-menu-i') + '/' + c.style.getPropertyValue('--mjs-menu-n')), ['0/3', '1/3', '2/3'])
    window.close()
  })
})
