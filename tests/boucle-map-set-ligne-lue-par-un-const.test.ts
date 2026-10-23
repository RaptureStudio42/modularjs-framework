// `{for}` sur une Map ou un Set : un gestionnaire de la ligne qui ne lisait la variable de ligne qu'à travers un `{const}` de la
// ligne (`{const lab = v[0]}` puis `@click={… lab}`) levait « Cannot read properties of undefined » au clic et ne faisait rien :
// la collection n'était changée en liste que si le gestionnaire nommait lui-même la variable. Elle l'est désormais dès que ce qui
// est recréé avant le gestionnaire la lit ; un gestionnaire qui ne la lit d'aucune façon ne porte toujours pas la conversion

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const SOURCES: Record<string, string> = {
  'ligne-lue-par-un-const': [
    '<script>',
    '$m = new Map([["x", 1], ["y", 2]])',
    '$s = new Set(["p", "q"])',
    '</script>',
    '{for k, v in $m}{const lab = v[0].toUpperCase()}<button class="m{k}" @click={globalThis.__mc = lab}>{lab}</button>{end}',
    '{for i, v in $s}{const up = v.toUpperCase()}<button class="s{i}" @click={globalThis.__sc = up}>{up}</button>{end}',
    '{for k, v in $m}{const paire = v}{const cle = paire[0]}<button class="c{k}" @click={globalThis.__cc = cle}>{cle}</button>{end}',
  ].join('\n'),
}

describe('{for} sur une Map ou un Set : variable de ligne lue par un {const} du gestionnaire (happy-dom)', function () {
  this.timeout(120000)
  let app: any
  before(async () => {
    const root = mjsTmp('boucle-map-set-const')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }))
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(root, 'src', `${nom}.mjs`), source + '\n')
    app = await createHarness({ root })
  })
  after(async () => {
    await app?.destroy()
    await terminateSharedWorkerPool()
  })

  it('le gestionnaire reçoit le {const} calculé sur la ligne, Map, Set et {const} qui en lit un autre', async () => {
    const m = await app.mount('ligne-lue-par-un-const')
    const w = app.window
    assert.equal(m.find('.m1').textContent, 'Y')
    await m.click('.m1')
    assert.equal(w.__mc, 'Y')
    await m.click('.s1')
    assert.equal(w.__sc, 'Q')
    await m.click('.c1')
    assert.equal(w.__cc, 'y')
  })

  it('gestionnaire qui ne lit la ligne d\'aucune façon : aucune conversion émise', async () => {
    const src = '<script>\n$jours = ["a", "b"]\nchoisir = (e) -> e\n</script>\n{for i, jour in $jours}{const haut = jour.toUpperCase()}<button @click={choisir(e)}>{haut}</button>{end}'
    const { output } = await transpile(src, { moduleName: 'boucle-sans-lecture' }) as any
    assert.equal(/Array\.from\(_mjs_ra_/.test(output), false)
  })
})
