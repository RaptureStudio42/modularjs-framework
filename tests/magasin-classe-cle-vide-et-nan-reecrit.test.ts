// `µ.Store` (new µStore) : la clé vide `''` prévient ses lecteurs comme toute autre clé, même écrite plus bas (`data[''].a.b`) ;
// réécrire `NaN` sur une clé qui vaut déjà `NaN` ne change rien, aucun avis ne part (`NaN !== NaN` prévenait à chaque écriture)
import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote, pause } from './helpers/coeur-monter.js'

const SOURCE = [
  '<script lang="coffee">',
  '@box = new µStore({\'\': \'a\', n: NaN})',
  '@obj = new µStore({\'\': {a: {b: 1}}})',
  '</script>',
  '<p class="v">{@box.data[\'\']}</p><p class="b">{@obj.data[\'\'].a.b}</p><p class="n">{@box.data.n}</p>',
].join('\n')

describe('µ.Store : clé vide prévenue, NaN réécrit sans avis', function () {
  this.timeout(40000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const [mode, reglages] of [['développement', {}], ['production', { env: 'prod', minify: false }]] as const) {
    it(`${mode} : la clé vide redessine ses lecteurs, à la racine et plus bas`, async () => {
      const { hote, erreurs } = await monterHote(SOURCE, 'classe-cle-vide', reglages)
      const texte = (c: string) => hote._shadow.querySelector(c).textContent.trim()
      assert.equal(texte('.v'), 'a')
      hote.box.data[''] = 'b'
      await pause(30)
      assert.equal(texte('.v'), 'b', 'la clé vide écrite à la racine')
      hote.obj.data[''].a.b = 2
      await pause(30)
      assert.equal(texte('.b'), '2', 'un objet rangé sous la clé vide, écrit plus bas')
      assert.equal(erreurs.length, 0, erreurs.join('\n'))
    })

    it(`${mode} : trois écritures de NaN sur NaN : aucun avis`, async () => {
      const { hote, erreurs } = await monterHote(SOURCE, 'classe-nan', reglages)
      const avis    = [] as unknown[]
      const notifie = hote.box._mjs_notify
      assert.equal(typeof notifie, 'function')
      hote.box._mjs_notify = function(this: any, ...a: any[]) { avis.push(a[0]); return notifie.apply(this, a) }
      hote.box.data.n = NaN
      hote.box.data.n = NaN
      hote.box.data.n = NaN
      await pause(30)
      hote.box._mjs_notify = notifie
      assert.deepEqual(avis.filter((k) => k === 'n'), [])
      assert.equal(erreurs.length, 0, erreurs.join('\n'))
    })
  }
})
