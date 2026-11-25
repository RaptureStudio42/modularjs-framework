// harnais de test (`createHarness`, `modularjs-framework/testing`) : sa page simulée (happy-dom) connaît `structuredClone`, comme le
// rendu serveur et le navigateur. happy-dom ne le donne pas : un composant qui l'appelait ne se montait pas dans les tests de l'appli
// (« structuredClone is not defined »). La copie est faite des objets de la page, et la fermeture du harnais ne laisse aucun port qui
// retiendrait Node

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const COPIE = `<script lang="coffee">
source = { liste: [1, 2], quand: new Date(5) }
copie = structuredClone(source)
copie.liste.push(3)
$rapport = 'liste ' + source.liste.length + '/' + copie.liste.length + ' ; tableau ' + (copie.liste instanceof Array) + ' ; date ' + (copie.quand instanceof Date)
</script>
<p class="rapport">{$rapport}</p>
`

describe('harnais de test : structuredClone comme au navigateur', function () {
  this.timeout(120000)

  let app: any = null
  after(async () => {
    if (app) await app.destroy()
    await terminateSharedWorkerPool()
  })

  it('un composant monté copie avec les objets de la page, et la fermeture ne laisse aucun port', async () => {
    const root   = mjsTmp('harnais-clone')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'tst-copie.mjs'), COPIE)
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
    const ports = () => process.getActiveResourcesInfo().filter(r => r === 'MessagePort').length
    const avant = ports()
    app = await createHarness({ root })
    const c = await app.mount('tst-copie')
    assert.equal(c.text('.rapport'), 'liste 2/3 ; tableau true ; date true')
    c.destroy()
    await app.destroy()
    app = null
    assert.equal(ports(), avant, 'aucun port de la copie ne retient Node')
  })
})
