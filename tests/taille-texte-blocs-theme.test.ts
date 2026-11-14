// une déclaration `font-size` en px au-dessus du seuil dans un bloc <theme> se convertit comme dans un <style>, et sa taille entre
// dans le bloc :root de la feuille racine : <theme> d'un composant (thème par défaut et thème nommé), fichier de thème du document
// (`*.theme.mjs`, CSS porté par le manifeste). `"responsiveFontSize": false` : les tailles restent écrites, aucune variable

import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { write } from './helpers/construction-cache.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'

function projet(prefix: string, reglage?: unknown): string {
  const root = mjsTmp(prefix)
  const conf = { sourceDir: 'app', outputDir: 'public/m', manifestPath: 'public/m/bundle.js', urlPrefix: '/m', stylesheetsDir: 'app/styles', ...(reglage === undefined ? {} : { responsiveFontSize: reglage }) }
  write(join(root, 'mjs.config.json'), `${JSON.stringify(conf, null, 2)}\n`)
  write(join(root, 'app/carte.mjs'), '<p>carte</p>\n<theme>\n  font-size: 30px\n</theme>\n<theme name="grand">\n  font-size: 41.5px\n</theme>\n')
  write(join(root, 'app/themes/sombre.theme.mjs'), '<theme>\n  font-size: 64px\n</theme>\n')
  return root
}

async function construire(root: string): Promise<Map<string, string>> {
  const found   = findConfig(root)!
  const bundler = new Bundler(resolveBundlerOpts(found.config, found.configDir) as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const out = join(root, 'public/m')
  // sorties de l'appli (le cœur a ses propres styles, hors de cette conversion)
  return new Map(readdirSync(out).filter(f => /\.js$/.test(f) && !/^mjs_core-/.test(f)).map(f => [f, readFileSync(join(out, f), 'utf-8')]))
}

const variables = (code: string): string[] => [...code.matchAll(/(--mjs-fs-[\w]+):calc\(/g)].map(m => m[1]).sort()

describe('taille du texte adaptée à l\'écran — blocs <theme>', function () {
  this.timeout(300_000)
  after(async () => { await terminateSharedWorkerPool() })

  it('<theme> d\'un composant (défaut et nommé), fichier de thème : var(--mjs-fs-…) et chaque variable dans le bloc :root', async () => {
    const sorties  = await construire(projet('taille-texte-theme'))
    const carte    = [...sorties.values()].find(code => code.includes('mjs-carte') && code.includes('font-size'))
    assert.ok(carte !== undefined, [...sorties.keys()].join(', '))
    assert.match(carte, /\{font-size:var\(--mjs-fs-30\)\}/)
    assert.match(carte, /\{font-size:var\(--mjs-fs-41_5\)\}/)
    assert.doesNotMatch(carte, /font-size:(?:30|41\.5)px/)
    const manifeste = sorties.get('bundle.js')!
    assert.match(manifeste, /\{font-size:var\(--mjs-fs-64\)\}/)
    assert.doesNotMatch(manifeste, /font-size:64px/)
    const feuilles = [...sorties.values()].filter(code => code.includes('adoptedStyleSheets'))
    assert.equal(feuilles.length, 1, 'une seule feuille racine')
    assert.deepEqual(variables(feuilles[0]), ['--mjs-fs-30', '--mjs-fs-41_5', '--mjs-fs-64'])
  })

  it('"responsiveFontSize": false : les tailles restent écrites, aucune variable', async () => {
    const sorties = await construire(projet('taille-texte-theme-coupee', false))
    const tout    = [...sorties.values()].join('\n')
    assert.ok(!tout.includes('--mjs-fs-'), 'aucune variable de taille attendue')
    assert.match(tout, /font-size:30px/)
    assert.match(tout, /font-size:41\.5px/)
    assert.match(tout, /font-size:64px/)
  })
})
