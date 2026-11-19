// Rechargement complet demandé par une fiche JSON de navigation (version du bundle changée, module illisible, module
// inconnu) : l'adresse visée est celle de la réponse, à défaut la clé `url` de la fiche. Comme les autres navigations
// complètes de MJS (µ._mjs_hardNav, µ._mjs_navHardReload), seule une adresse http(s) part : une `url` en `javascript:` ou
// en `data:` exécutait son code avec l'origine du site au lieu de naviguer. Une adresse http(s) part comme avant.
//
// Méthode : vrai bloc des helpers de navigation (marqueurs `extrait-test`), fenêtre simulée qui relève les départs
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { extractMarked } from './helpers/extract-marked.js'
import { poserMessages } from './helpers/messages-stub.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const UJS_SRC   = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_ujs.ts'), 'utf-8')

function monter() {
  const departs: string[] = [], avertis: string[] = []
  const doc: any = { getElementById: () => null, createElement: () => ({}) }
  const win: any = {
    history: { pushState() { throw new Error('aucune entrée ne doit être poussée') } },
    location: { origin: 'https://site.example', href: 'https://site.example/page', assign: (u: string) => departs.push(u) }
  }
  const µ: any = { paths: { produit: 'produit.js' }, version: 'v1', warn: (m: string) => avertis.push(m), error() {}, log() {} }
  poserMessages(µ)
  new Function('µ', 'document', 'window', extractMarked(UJS_SRC, 'helpers-navigation'))(µ, doc, win)
  return { µ, departs, avertis }
}

const CAS: [string, any][] = [
  ['version du bundle changée', { module: 'mjs-produit', props: {}, version: 'v2' }],
  ['module illisible', { module: 42, props: {} }],
  ['module inconnu', { module: 'mjs-inconnu', props: {} }]
]

describe('navigation — un rechargement complet demandé par une fiche JSON ne part que vers une adresse http(s)', () => {
  for (const [scene, fiche] of CAS) {
    for (const adresse of ['javascript:window.__joue = 1', 'data:text/html,<script>window.__joue = 1</script>']) {
      it(scene + ' : `' + adresse.split(':')[0] + ':` dans la fiche ne part jamais, un avertissement le dit', () => {
        const { µ, departs, avertis } = monter()
        µ._mjs_navApplyJson({ ...fiche, url: adresse }, '', {})
        assert.deepEqual(departs, [], 'adresse partie vers window.location.assign')
        assert.equal(avertis.length, 1, avertis.join('\n'))
        assert.ok(avertis[0].includes(adresse), avertis[0])
      })
    }

    it(scene + ' : une adresse http(s) part, comme avant', () => {
      const { µ, departs, avertis } = monter()
      µ._mjs_navApplyJson({ ...fiche, url: 'https://site.example/produits/42' }, '', {})
      assert.deepEqual(departs, ['https://site.example/produits/42'])
      assert.deepEqual(avertis, [])
    })
  }
})
