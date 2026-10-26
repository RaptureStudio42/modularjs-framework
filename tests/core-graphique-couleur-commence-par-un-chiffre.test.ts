// module cœur <@@chart> : une seule règle pour la couleur d'une série, à la construction, au rendu serveur et au navigateur. Un nombre, en
// toute écriture (`'1e-7'`, `'-1e-7'`, `'.5e1'`), ou un mot qui commence par un chiffre (`'0x10'`, `'12px'`, `'3abc'`) n'est jamais une
// couleur : la construction le refuse quand il est écrit dans la page, le rendu serveur (sans `CSS.supports`) donne à la série sa teinte du
// thème, comme le navigateur. Avant, le serveur écrivait `1e-7` comme couleur de l'auteur, que le navigateur refusait à la reprise, et
// `'0x10'` passait la construction. Un mot préfixé par un moteur (`-webkit-link`) reste laissé au navigateur. Chromium, Firefox et WebKit
// réels confirment qu'aucun d'eux ne lit ces valeurs comme une couleur.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { navigateurPresent, NAVIGATEURS } from './helpers/sortable-navigateur.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { unknownColor } from '../src/bundler/core-chart.js'
import { createSSRRenderer } from '../src/server/renderToString.js'

const REFUSEES  = ['1e-7', '-1e-7', '.5e1', '+1e2', '0x10', '-0x10', '12px', '3abc', '1.5em']
const ACCEPTEES = ['tomato', '#1e3', 'rgb(1 2 3)', 'var(--e1)']

const HOTE = `<script>
  $lignes = [{ x: 'a', a: 1, b: 2, c: 3, d: 4, e: 5 }, { x: 'b', a: 2, b: 3, c: 4, d: 5, e: 6 }]
  $series = [{ key: 'a', color: '1e-7' }, { key: 'b', color: '0x10' }, { key: 'c', color: '12px' }, { key: 'd', color: '-1e-7' }, { key: 'e', color: 'tomato' }]
</script>
<@@chart rows={$lignes} series={$series} shape="bar"></@@chart>
`

describe('<@@chart> : une couleur qui commence par un chiffre n\'en est pas une, à la construction, au serveur et au navigateur', function () {
  this.timeout(240000)

  after(async () => { await terminateSharedWorkerPool() })

  it('à la construction : un nombre en toute écriture et un mot qui commence par un chiffre sont refusés ; une vraie couleur et un mot préfixé par un moteur passent', () => {
    for (const valeur of REFUSEES) assert.equal(unknownColor(valeur), true, `« ${valeur} » est refusée`)
    for (const valeur of [...ACCEPTEES, '-webkit-link']) assert.equal(unknownColor(valeur), false, `« ${valeur} » n'est pas refusée`)
  })

  it('au rendu serveur : ces séries prennent leur teinte du thème, la vraie couleur reste celle de l\'auteur', async () => {
    const root   = mjsTmp('graphique-couleur-chiffre')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'gc-ssr.mjs'), HOTE)
    const renderer = await createSSRRenderer({ sourceDir: srcDir, outputDir: join(root, 'out'), bundlerOpts: { runtime: ['hydrate'] } } as any)
    let html = ''
    try { html = (await renderer.renderToString('mjs-gc-ssr', { ssrMode: 'markers' } as any)).html }
    finally { await renderer.close() }
    // la couleur de l'auteur s'écrit dans l'attribut style de chaque pièce (la feuille du module, elle, porte les teintes du thème)
    const ecrites = [...html.matchAll(/style="([^"]*)"/g)].flatMap((m) => [...m[1].matchAll(/--mjs-chart-tone:\s*([^;]+)/g)].map((t) => t[1].trim()))
    assert.ok(ecrites.length > 0, 'la vraie couleur est écrite')
    assert.deepEqual([...new Set(ecrites)], ['tomato'], 'seule la vraie couleur est écrite comme couleur de l\'auteur')
    for (const teinte of [1, 2, 3, 4]) assert.match(html, new RegExp(`class="[^"]*\\btone-${teinte}\\b`), `une série refusée prend la teinte ${teinte}`)
  })

  for (const nom of NAVIGATEURS) it(`${nom} réel : aucune de ces valeurs n'est une couleur, les vraies couleurs le sont`, async function () {
    if (!(await navigateurPresent(nom))) this.skip()
    const browser = await (await import('playwright'))[nom].launch()
    try {
      const page = await browser.newPage()
      const lu   = await page.evaluate((liste: string[]) => liste.map((v) => CSS.supports('color', v)), [...REFUSEES, ...ACCEPTEES])
      assert.deepEqual(lu, [...REFUSEES.map(() => false), ...ACCEPTEES.map(() => true)])
    }
    finally { await browser.close() }
  })
})
