// un magasin ne garde pas de valeur qui attend : `$$x = await …` dans le script d'un composant est refusé à la construction, le
// message renvoie à µload(adresse) et au script d'un composant. Au premier niveau d'un fichier de module (`$$x = await …`,
// `µ$$x = await …`, `new µStore(… await …)`), la ligne n'est pas une valeur qui attend : elle tourne une fois, au chargement, et se
// construit (affichage : magasin-de-module-await-au-chargement-browser.test.ts). Écrire le magasin après un `await` dans une
// fonction (gestionnaire, aide d'un module) et citer `$$q` dans une valeur qui attend restent permis

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { refus, compile, erreursDeConstruction } from './helpers/derivee-await-refus.js'

const F    = 'f = (q) -> fetch("/api/m-#{q}").then((r) -> r.json())\n'
const VUE  = '<script>\n  @import µ$$feed \'mag.module.civet.mjs\'\n</script>\n<i>{µ$$feed}</i>\n'
const juste = (message: string) => {
  assert.match(message, /un magasin ne garde pas de valeur qui attend/, message)
  assert.match(message, /µload\(adresse\)/, message)
  assert.doesNotMatch(message, /bogue du bundler/, message)
}

describe('dérivée qui attend — dans un magasin : refusée dans le <script>, permise au premier niveau d\'un module', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('$$l = await … dans le script d\'un composant : refusé, nommé', async () => {
    const message = await refus(`<script>\n  $q = ''\n  ${F}  $$l = await f($q)\n</script>\n<i>{$$l}</i>\n`)
    juste(message)
    assert.match(message, /« \$\$l = await … »/, message)
  })

  for (const [nom, module] of [
    ['export µ$$feed = await …', `${F}export µ$$feed = await f(1)\n`],
    ['new µStore(… await …)', `${F}export µ$$feed = new µStore(liste: await f(1))\n`],
    ['$$liste = await …', `${F}$$liste = await f(1)\nexport µ$$feed = new µStore(n: 1)\n`],
  ] as Array<[string, string]>) {
    it('fichier de module, ' + nom + ' : une fois au chargement, la construction passe', async () => {
      const erreurs = await erreursDeConstruction('await-magasin-module', { 'mag.module.civet.mjs': module, 'vue.mjs': VUE })
      assert.equal(erreurs, '')
    })
  }

  it('écrire le magasin après un await dans une fonction, et citer $$q dans une valeur qui attend : permis', async () => {
    const js = await compile(`<script>\n  $$q = 'a'\n  ${F}  $vu = await f($$q)\n  @go = -> $$l = await f($$q)\n</script>\n<i>{$vu}{$$l}</i>\n`)
    assert.match(js, /µ\._mjs_setAwait\(_mjsThis, 'vu'/)
    const erreurs = await erreursDeConstruction('await-magasin-fonction', { 'mag.module.civet.mjs': `${F}export charger = -> $$liste = await f(1)\nexport µ$$feed = new µStore(n: 1)\n`, 'vue.mjs': VUE })
    assert.equal(erreurs, '')
  })
})
