// `mjs build` sans `--prod` : une construction en échec ne publie rien, et le registre des variables de thème
// (`.mjs-theme-vars.json`) suit la même règle que les feuilles de mise en page et les fragments de traduction à nom clair.
// Il était écrit avant l'émission des composants, donc même quand la construction échouait ensuite : l'atelier du thème
// lisait un registre que le manifeste servi ne connaissait pas encore.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const fautif    = '<script>\n  $x = [1, 2\n</script>\n<p>{$x}</p>\n'
const composant = (nom: string) => `<style>\n  :host\n    --mjs-${nom}: red\n  p\n    color: var(--mjs-${nom}, blue)\n</style>\n<p>a</p>\n`

async function construire(src: string, out: string): Promise<string[]> {
  const b = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), env: 'dev', keepFailedComponents: false })
  try {
    return (await b.compile()).errors.map(e => e.message)
  }
  finally {
    await b.close()
  }
}

describe('registre des variables de thème : rien d\'écrit tant que la construction n\'a pas réussi', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('premier build en échec : aucun registre ; build en échec ensuite : le registre du dernier build réussi, à l\'octet', async () => {
    const root     = mjsTmp('registre-theme-echec')
    const src      = join(root, 'src')
    const out      = join(root, 'out')
    const registre = join(out, '.mjs-theme-vars.json')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'a.mjs'), composant('alerte'))
    writeFileSync(join(src, 'b.mjs'), fautif)
    assert.equal((await construire(src, out)).length, 1)
    assert.equal(existsSync(registre), false, 'registre écrit par un premier build en échec')

    writeFileSync(join(src, 'b.mjs'), '<p>b</p>\n')
    assert.deepEqual(await construire(src, out), [])
    const servi = readFileSync(registre, 'utf-8')
    assert.ok(JSON.parse(servi).alerte, servi)

    writeFileSync(join(src, 'a.mjs'), composant('alarme'))
    writeFileSync(join(src, 'b.mjs'), fautif)
    assert.equal((await construire(src, out)).length, 1)
    assert.equal(readFileSync(registre, 'utf-8'), servi, 'registre réécrit par un build en échec')

    writeFileSync(join(src, 'b.mjs'), '<p>b corrigé</p>\n')
    assert.deepEqual(await construire(src, out), [])
    assert.ok(JSON.parse(readFileSync(registre, 'utf-8')).alarme, 'le build réussi publie le nouveau registre')
  })
})
