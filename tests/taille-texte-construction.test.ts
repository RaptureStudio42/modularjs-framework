// la taille du texte en px, adaptée à l'écran par la construction : une variable par valeur au-dessus du seuil, posée sur
// :root dans la feuille racine (adoptée par le document, importée par toutes les pages) dans les trois modes `css` ; la
// déclaration devient `font-size: var(--mjs-fs-<valeur>)`. `"responsiveFontSize": false` : rien ne change. Avec `--cache`
// et au rechargement à chaud de `mjs dev`, l'ensemble des valeurs est refait depuis tous les composants

import assert from 'node:assert/strict'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { build, write } from './helpers/construction-cache.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'

const BLOC = ':root{--mjs-fs-41_5:calc(1.384375rem + 1.6125vw);--mjs-fs-64:calc(1.525rem + 3.3vw)}@media (min-width:1200px){:root{--mjs-fs-41_5:2.59375rem;--mjs-fs-64:4rem}}'

// deux composants, une feuille `@css`, la feuille racine : 41.5px deux fois, 41.5px !important, 64px, 12px, 2rem, calc(), font:
function projet(prefix: string, css: string, reglage?: unknown): string {
  const root = mjsTmp(prefix)
  const conf = { sourceDir: 'app', outputDir: 'public/m', manifestPath: 'public/m/bundle.js', urlPrefix: '/m', stylesheetsDir: 'app/styles', css, ...(reglage === undefined ? {} : { responsiveFontSize: reglage }) }
  write(join(root, 'mjs.config.json'), `${JSON.stringify(conf, null, 2)}\n`)
  write(join(root, 'app/titre.mjs'), '<h1 class="t">Titre</h1>\n<p class="p">petit</p>\n<p class="r">rem</p>\n<p class="c">calc</p>\n<p class="f">raccourci</p>\n<style>\n  .t\n    font-size: 41.5px\n  .p\n    font-size: 12px\n  .r\n    font-size: 2rem\n  .c\n    font-size: calc(10px + 1vw)\n  .f\n    font: 30px serif\n</style>\n')
  write(join(root, 'app/carte.mjs'), '<p class="x">carte</p>\n<p class="y">grand</p>\n<p class="b">base</p>\n<style :css="base" lang="css">\n  .x { font-size: 41.5px !important; }\n  .y { font-size: 64px; }\n</style>\n')
  write(join(root, 'app/styles/base.scss'), '.b { font-size: 41.5px; }\n')
  write(join(root, 'app/styles/mjs_root.scss'), 'body { font-size: 12px; }\n.grand { font-size: 64px; }\n')
  return root
}

async function construire(root: string): Promise<string> {
  const found   = findConfig(root)!
  const bundler = new Bundler(resolveBundlerOpts(found.config, found.configDir) as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return join(root, 'public/m')
}

// sorties de l'appli (le cœur a ses propres styles, hors de cette conversion)
const sorties = (out: string): Map<string, string> => new Map(readdirSync(out).filter(f => /\.(js|css)$/.test(f) && !/^mjs_core-/.test(f)).map(f => [f, readFileSync(join(out, f), 'utf-8')]))
const racine  = (out: string): string[] => [...sorties(out)].filter(([, code]) => code.includes('adoptedStyleSheets')).map(([, code]) => code)
const noms    = (texte: string): string[] => [...new Set([...texte.matchAll(/--mjs-fs-([\w]+)/g)].map(m => m[1]))].sort()

describe('taille du texte adaptée à l\'écran — construction', function () {
  this.timeout(300_000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const css of ['bundle', 'split', 'lazy'] as const) {
    it(`css: ${css} — une variable par valeur au-dessus du seuil sur :root de la feuille racine, le reste intact`, async () => {
      const out  = await construire(projet(`taille-texte-${css}`, css))
      const tout = [...sorties(out).values()].join('\n')
      assert.deepEqual(noms(tout), ['41_5', '64'])
      const feuilles = racine(out)
      assert.equal(feuilles.length, 1, 'une seule feuille racine')
      assert.equal(feuilles[0].split(BLOC).length, 2, `bloc :root attendu une fois\n${feuilles[0]}`)
      // déclarations converties : composant SASS, composant CSS (!important gardé), feuille @css, feuille racine
      assert.match(tout, /\.t\{font-size:var\(--mjs-fs-41_5\)\}/)
      assert.match(tout, /\.x \{ font-size: var\(--mjs-fs-41_5\) !important; \}/)
      assert.match(tout, /\.y \{ font-size: var\(--mjs-fs-64\); \}/)
      assert.match(tout, /\.b\{font-size:var\(--mjs-fs-41_5\)\}/)
      assert.match(tout, /\.grand\{font-size:var\(--mjs-fs-64\)\}/)
      // laissés tels quels : au seuil ou dessous, rem, calc(), raccourci font:
      for (const reste of ['.p{font-size:12px}', '.r{font-size:2rem}', '.c{font-size:calc(10px + 1vw)}', '.f{font:30px serif}', 'body{font-size:12px}']) assert.ok(tout.includes(reste), reste)
    })

    it(`css: ${css} — "responsiveFontSize": false : aucune variable, chaque taille écrite reste en px`, async () => {
      const out  = await construire(projet(`taille-texte-coupee-${css}`, css, false))
      const tout = [...sorties(out).values()].join('\n')
      assert.deepEqual(noms(tout), [])
      for (const reste of ['.t{font-size:41.5px}', '.x { font-size: 41.5px !important; }', '.y { font-size: 64px; }', '.b{font-size:41.5px}', '.grand{font-size:64px}']) assert.ok(tout.includes(reste), reste)
    })
  }

  it('mjs build : "responsiveFontSize": false passe de mjs.config.json à la construction, aucune variable', () => {
    const root = projet('taille-texte-coupee-cli', 'bundle', false)
    const run  = build(root, [])
    assert.equal(run.status, 0, run.out)
    const tout = [...sorties(join(root, 'public/m')).values()].join('\n')
    assert.deepEqual(noms(tout), [])
    assert.ok(tout.includes('.t{font-size:41.5px}'), tout)
  })

  it('--cache : une taille neuve dans un seul composant entre dans le bloc, celle d\'un composant repris reste, --cache=verifier sans alarme', () => {
    const root = mjsTmp('taille-texte-cache')
    write(join(root, 'mjs.config.json'), `${JSON.stringify({ sourceDir: 'app', outputDir: 'public/m', manifestPath: 'public/m/bundle.js', urlPrefix: '/m' }, null, 2)}\n`)
    write(join(root, 'app/a.mjs'), '<p class="a">a</p>\n<style>\n  .a\n    font-size: 30px\n</style>\n')
    write(join(root, 'app/b.mjs'), '<p class="b">b</p>\n<style>\n  .b\n    font-size: 40px\n</style>\n')
    mkdirSync(join(root, 'node_modules'))
    const out = join(root, 'public/m')
    const premier = build(root, ['--cache'])
    assert.equal(premier.status, 0, premier.out)
    assert.deepEqual(noms(racine(out).join('')), ['30', '40'])
    writeFileSync(join(root, 'app/b.mjs'), '<p class="b">b</p>\n<style>\n  .b\n    font-size: 50px\n</style>\n')
    const second = build(root, ['--cache'])
    assert.equal(second.status, 0, second.out)
    assert.equal(second.cold, 1, second.out)
    assert.ok(second.served >= 1, second.out)
    assert.deepEqual(noms(racine(out).join('')), ['30', '50'])
    writeFileSync(join(root, 'app/b.mjs'), '<p class="b">b</p>\n<style>\n  .b\n    font-size: 60px\n</style>\n')
    const verifie = build(root, ['--cache=verifier'])
    assert.equal(verifie.status, 0, verifie.out)
    assert.match(verifie.out, /^cache vérifié : \d+ fichiers identiques à l'octet$/m)
    assert.deepEqual(noms(racine(out).join('')), ['30', '60'])
  })

  it('mjs dev : une taille neuve au rechargement à chaud entre dans la feuille racine envoyée avec le composant', async () => {
    const root   = mjsTmp('taille-texte-chaud')
    const src    = join(root, 'src')
    const styles = join(root, 'styles')
    mkdirSync(src, { recursive: true })
    mkdirSync(styles, { recursive: true })
    const comp = (taille: string) => `<p class="t">titre</p>\n<style>\n  .t\n    font-size: ${taille}\n</style>\n`
    writeFileSync(join(src, 'comp.mjs'), comp('30px'))
    const b = new Bundler({ sourceDir: src, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js'), stylesheetsDir: styles })
    ;(b as any).cssOnlyTracking = true
    assert.equal((await b.compile()).errors.length, 0)
    writeFileSync(join(src, 'comp.mjs'), comp('50px'))
    const stats = await b.compile()
    await b.close()
    assert.equal(stats.errors.length, 0)
    assert.ok(stats.cssOnly, 'rechargement du CSS à chaud attendu')
    assert.match(Object.values(stats.cssOnly!.components).join(''), /font-size:var\(--mjs-fs-50\)/)
    assert.deepEqual(noms(stats.cssOnly!.root ?? ''), ['50'])
  })
})
