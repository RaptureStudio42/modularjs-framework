// une page prérendue qu'un hôte pose dans sa propre page (Rails lit le fragment) affiche ses tailles du texte avant
// l'arrivée du JS : chaque variable `--mjs-fs-<valeur>` que lit le fragment y est définie ; `"responsiveFontSize": false`
// laisse le fragment sans variable ni bloc

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { build, write } from './helpers/construction-cache.js'

function projet(prefix: string, reglage?: unknown): string {
  const root = mjsTmp(prefix)
  const conf = { sourceDir: 'app', outputDir: 'public/m', manifestPath: 'public/m/bundle.js', urlPrefix: '/m', render: { default: 'prerender', outDir: 'public/pages', routes: { '/': { component: 'mjs-ma-page' } } }, ...(reglage === undefined ? {} : { responsiveFontSize: reglage }) }
  write(join(root, 'mjs.config.json'), `${JSON.stringify(conf, null, 2)}\n`)
  write(join(root, 'app/ma-page.mjs'), '<h1 class="t">Titre</h1>\n<p class="p">petit</p>\n<style>\n  .t\n    font-size: 41.5px\n  .p\n    font-size: 12px\n</style>\n')
  return root
}

describe('page prérendue — tailles du texte dans le fragment', function () {
  this.timeout(280_000)

  it('chaque variable de taille lue par le fragment y est définie', () => {
    const root = projet('prerendu-taille')
    const run  = build(root, ['--prod'])
    assert.equal(run.status, 0, run.out)
    const page = readFileSync(join(root, 'public/pages/index.html'), 'utf-8')
    const lues = [...new Set([...page.matchAll(/var\((--mjs-fs-[\w]+)\)/g)].map(m => m[1]))]
    assert.deepEqual(lues, ['--mjs-fs-41_5'], page)
    for (const nom of lues) assert.ok(page.includes(`${nom}:calc(`) && page.includes(`${nom}:2.59375rem`), `${nom} lue sans être définie dans le fragment\n${page}`)
  })

  it('"responsiveFontSize": false — ni variable ni bloc', () => {
    const root = projet('prerendu-taille-coupee', false)
    const run  = build(root, ['--prod'])
    assert.equal(run.status, 0, run.out)
    const page = readFileSync(join(root, 'public/pages/index.html'), 'utf-8')
    assert.ok(!page.includes('--mjs-fs-'), page)
    assert.match(page, /\.t\{font-size:41\.5px\}/)
  })
})
