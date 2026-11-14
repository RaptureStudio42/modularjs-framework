// module cœur <@@chart>, sans navigateur : les nombres du graphique (ici le tableau lu par les lecteurs d'écran) s'écrivent dans la langue
// entière de la page, région comprise, comme le navigateur les écrit : « 1.5 » en `de-CH`, alors que l'allemand écrit « 1,5 » ; `en-ZA`
// comme son format ; à chaud, quand µlang change, sans remonter le module
// une langue qu'Intl refuse se lit par son premier sous-tag, dans le graphique comme dans le champ nombre, sans erreur ; refusé lui aussi,
// c'est la langue du navigateur pour le graphique, la virgule du français pour le champ

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote, pause } from './helpers/coeur-monter.js'

const HOTE = [
  '<script>',
  '  $lignes = [{ x: \'Anvers\', v: 1.5 }]',
  '</script>',
  '<@@chart class="g" rows={$lignes} series={[{ key: \'v\' }]} shape="bar"></@@chart>',
  '<button class="de" @click={µlang = \'de\'}>de</button>',
  '<button class="dech" @click={µlang = \'de-CH\'}>de-CH</button>',
  '<button class="enza" @click={µlang = \'en-ZA\'}>en-ZA</button>',
].join('\n')

// étiquettes refusées par Intl : tiret final, sous-tags dans le désordre, espace final, ancienne étiquette, souligné, extension vide ; puis
// `de-CH`, juste, lue entière, et `1`, dont même le premier sous-tag est refusé. `navigateur` : le séparateur de la langue du navigateur
const MAL_ECRITES = (navigateur: string): [string, string, string][] => [
  ['en-', '1.5', '1.5'],
  ['zh-CN-Hans', '1.5', '1.5'],
  ['en-US ', '1.5', '1.5'],
  ['en-GB-oed', '1.5', '1.5'],
  ['es-ES_tradnl', '1,5', '1,5'],
  ['fr-FR-u', '1,5', '1,5'],
  ['de-CH', '1.5', '1.5'],
  ['1', `1${navigateur}5`, '1,5']
]

const HOTE_MAL_ECRITE = [
  '<script>',
  '  $lignes = [{ x: \'Anvers\', v: 1.5 }]',
  '  $n = 1.5',
  '</script>',
  '<@@chart class="g" rows={$lignes} series={[{ key: \'v\' }]} shape="bar"></@@chart>',
  '<@@number class="n" value=!{$n} step="0.1"></@@number>',
  ...MAL_ECRITES('').map(([lang], i) => `<button class="b${i}" @click={µlang = '${lang}'}>${i}</button>`),
].join('\n')

describe('mjs-core-chart — les nombres dans la langue entière de la page, région comprise', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('le tableau du graphique écrit « 1,5 » en `de`, « 1.5 » en `de-CH`, et `en-ZA` comme son format, à chaud', async () => {
    const { window, hote, erreurs } = await monterHote(HOTE, 'graphique-langue-entiere')
    const graphique = hote._shadow.querySelector('.g')
    const cellule   = () => graphique._shadow.querySelector('.sr td')?.textContent?.trim()
    const sep       = (lang: string) => new Intl.NumberFormat(lang).formatToParts(1.5).find((p) => p.type === 'decimal')?.value
    assert.equal(sep('de-CH'), '.', 'le format de de-CH écrit le point, celui de de la virgule')
    for (const [bouton, lang] of [['.de', 'de'], ['.dech', 'de-CH'], ['.enza', 'en-ZA']]) {
      hote._shadow.querySelector(bouton).click()
      await pause(80)
      assert.equal(cellule(), `1${sep(lang)}5`, lang)
    }
    assert.ok(hote._shadow.querySelector('.g') === graphique, 'même graphique, sans remonter le module')
    assert.deepEqual([...erreurs], [], 'aucune erreur')
    window.close()
  })

  it('une langue qu\'Intl refuse (« en- », « zh-CN-Hans », « en-US  »…) se lit par son premier sous-tag, dans le graphique et le champ nombre, sans erreur ; le graphique suit encore la langue d\'après', async () => {
    const { window, hote, erreurs } = await monterHote(HOTE_MAL_ECRITE, 'graphique-langue-mal-ecrite')
    const graphique = hote._shadow.querySelector('.g')
    const cellule   = () => graphique._shadow?.querySelector('.sr td')?.textContent?.trim() ?? 'graphique vide'
    const champ     = () => hote._shadow.querySelector('.n')?._shadow?.querySelector('input')?.value ?? 'champ vide'
    const lu: Record<string, [string, string]> = {}
    const voulu: Record<string, [string, string]> = {}
    for (const [lang, g, c] of MAL_ECRITES(new Intl.NumberFormat().formatToParts(1.5).find((p) => p.type === 'decimal')?.value ?? '')) voulu[lang] = [g, c]
    for (const [i, [lang]] of MAL_ECRITES('').entries()) {
      hote._shadow.querySelector('.b' + i).click()
      await pause(80)
      lu[lang] = [cellule(), champ()]
    }
    assert.deepEqual(lu, voulu, 'graphique puis champ, par langue')
    assert.ok(hote._shadow.querySelector('.g') === graphique, 'même graphique, sans remonter le module')
    assert.deepEqual([...erreurs].map((e: any) => String(e?.message ?? e).slice(0, 160)), [], 'aucune erreur')
    window.close()
  })
})
