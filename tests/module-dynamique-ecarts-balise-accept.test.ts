// POURQUOI CE FICHIER EXISTE
// Trois écarts relevés à la relecture de la refonte de `<@module EXPR …>`, plus petits que les défauts
// de module-dynamique-await-liste-fuite-props.test.ts mais qui se trompaient en silence :
//  1. Attributs globaux dynamiques (`title`, `hidden`, `slot`, `is`, `lang`, `layout`) : un composant
//     écrit en dur les pose comme PROPS (`_set`), pas comme attributs ; `<@module>` doit faire pareil,
//     au montage et quand la variable change.
//  2. Un nom qui est à la fois une balise HTML et un composant du projet (`section`) : la balise
//     native reste atteignable ; le composant s'écrit par son nom complet (`mjs-section`).
//  3. La liste `accept` compare le nom TAPÉ, pas la balise créée : `accept="tuto-ca"` et
//     `accept="mjs-tuto-ca"` doivent valoir la même chose, quelle que soit la forme du nom passé à
//     `<@module>`.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterModule, pause } from './helpers/module-dynamique.js'

const CE = '<script lang="coffee">\n$titre = \'\'\n</script>\n<p class="v">E:{$titre}</p>\n'

describe('<@module> — attributs globaux, nom de balise, liste accept', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  describe('1. attributs globaux dynamiques : comme un composant écrit en dur', () => {
    const attributs = (el: any) => [...el.attributes].map((a: any) => a.name + '=' + a.value).sort()
    const hote = (balise: string) => `<script lang="coffee">\n$comp = 'mjs-ce'\n$t = 'T'\n@setT = (v) -> $t = v\n</script>\n${balise}\n`
    const GLOBALES = 'title={$t} hidden={$t === \'H\'} slot={$t} is={$t} lang={$t} layout={$t}'

    it('au montage et après un changement : les attributs de l\'élément sont ceux du composant écrit en dur', async () => {
      const dur = await monterModule({ hote: hote(`<mjs-ce ${GLOBALES}></mjs-ce>`), ce: CE })
      const mod = await monterModule({ hote: hote(`<@module $comp ${GLOBALES}></@module>`), ce: CE })
      assert.deepEqual(attributs(mod.hote._shadow.querySelector('mjs-ce')), attributs(dur.hote._shadow.querySelector('mjs-ce')), 'au montage')
      dur.hote.setT('H')
      mod.hote.setT('H')
      await pause(80)
      assert.deepEqual(attributs(mod.hote._shadow.querySelector('mjs-ce')), attributs(dur.hote._shadow.querySelector('mjs-ce')), 'après changement')
      assert.deepEqual(mod.erreurs(), [])
    })

    it('les attributs de la balise (class, style, id, data-*, aria-*) restent des attributs', async () => {
      const mod = await monterModule({ hote: hote('<@module $comp class={\'c\' + $t} id={\'i\' + $t} data-a={$t} aria-label={$t}></@module>'), ce: CE })
      const el  = () => mod.hote._shadow.querySelector('mjs-ce')
      assert.deepEqual(attributs(el()), ['aria-label=T', 'class=cT', 'data-a=T', 'id=iT'])
      mod.hote.setT('U')
      await pause(80)
      assert.deepEqual(attributs(el()), ['aria-label=U', 'class=cU', 'data-a=U', 'id=iU'])
    })
  })

  describe('2. un nom à la fois balise HTML et composant du projet', () => {
    const hote = (valeur: string) => `<script lang="coffee">\n$comp = '${valeur}'\n@choisir = (v) -> $comp = v\n</script>\n<@module $comp titre="x"></@module>\n`
    const SECTION = '<script lang="coffee">\n$titre = \'\'\n</script>\n<p class="v">S:{$titre}</p>\n'

    it('`section` : la balise native (un composant `section` existe pourtant)', async () => {
      const m = await monterModule({ hote: hote('section'), section: SECTION })
      const enfants = [...m.hote._shadow.children].map((n: any) => n.localName)
      assert.deepEqual(enfants, ['section'])
      assert.deepEqual(m.erreurs(), [])
    })

    it('`mjs-section` : le composant, par son nom complet', async () => {
      const m = await monterModule({ hote: hote('mjs-section'), section: SECTION })
      const enfants = [...m.hote._shadow.children].map((n: any) => n.localName)
      assert.deepEqual(enfants, ['mjs-section'])
      assert.equal(m.hote._shadow.querySelector('mjs-section')._shadow.querySelector('.v').textContent, 'S:x')
    })

    it('un composant au nom sans homonyme HTML garde son nom court (`tuto-ca`)', async () => {
      const m = await monterModule({ hote: hote('tuto-ca'), 'tuto-ca': CE })
      assert.deepEqual([...m.hote._shadow.children].map((n: any) => n.localName), ['mjs-tuto-ca'])
    })
  })

  describe('3. accept : le nom tapé ou la balise créée', () => {
    const hote = (accept: string) => `<script lang="coffee">\n$comp = null\n@choisir = (v) -> $comp = v\n</script>\n<@module $comp titre="x" accept="${accept}"></@module>\n`
    const enfants = (m: any) => [...m.hote._shadow.children].map((n: any) => n.localName)

    for(const [accept, nom] of [['tuto-ca', 'tuto-ca'], ['tuto-ca', 'mjs-tuto-ca'], ['mjs-tuto-ca', 'tuto-ca'], ['mjs-tuto-ca', 'mjs-tuto-ca']]) {
      it(`accept="${accept}" et nom passé « ${nom} » : le composant est créé`, async () => {
        const m = await monterModule({ hote: hote(accept), 'tuto-ca': CE })
        m.hote.choisir(nom)
        await pause(60)
        assert.deepEqual(enfants(m), ['mjs-tuto-ca'])
        assert.deepEqual(m.warns(), [])
      })
    }

    it('un nom hors de la liste reste refusé, avec un avertissement', async () => {
      const m = await monterModule({ hote: hote('tuto-ca'), 'tuto-ca': CE, 'tuto-cb': CE })
      m.hote.choisir('tuto-cb')
      await pause(60)
      assert.deepEqual(enfants(m).filter((n: string) => n.startsWith('mjs-')), [])
      assert.equal(m.warns().length, 1)
    })
  })
})
