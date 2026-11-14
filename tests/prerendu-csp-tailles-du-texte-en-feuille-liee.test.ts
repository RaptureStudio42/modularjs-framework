// une page prérendue en mode `csp` (`"csp": true`) porte le bloc :root de ses tailles du texte dans une feuille liée, jamais
// dans un `<style>` : le fragment cite un fichier `mjs_ssr_head-….css` par un `<link rel="stylesheet">`, et ce fichier, écrit
// dans le dossier de sortie, définit chaque variable de taille que lit la page

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { build, write } from './helpers/construction-cache.js'

function projet(prefix: string): string {
  const root = mjsTmp(prefix)
  const conf = { sourceDir: 'app', outputDir: 'public/m', manifestPath: 'public/m/bundle.js', urlPrefix: '/m', csp: true, css: 'split', render: { default: 'prerender', outDir: 'public/pages', routes: { '/': { component: 'mjs-ma-page', engine: 'happy-dom' } } } }
  write(join(root, 'mjs.config.json'), `${JSON.stringify(conf, null, 2)}\n`)
  write(join(root, 'app/ma-page.mjs'), '<h1 class="t">Titre</h1>\n<p class="p">petit</p>\n<style>\n  .t\n    font-size: 41.5px\n  .p\n    font-size: 12px\n</style>\n')
  return root
}

describe('page prérendue en mode csp — tailles du texte dans une feuille liée', function () {
  this.timeout(280_000)

  it('le fragment lie un fichier mjs_ssr_head-….css qui définit chaque variable lue, sans aucun <style>', () => {
    const root = projet('prerendu-csp-taille')
    const run  = build(root, ['--prod'])
    assert.equal(run.status, 0, run.out)
    const page = readFileSync(join(root, 'public/pages/index.html'), 'utf-8')
    const lien = /<link rel="stylesheet" href="\/m\/(mjs_ssr_head-[a-f0-9]{8}\.css)">/.exec(page)
    assert.ok(lien !== null, `lien vers la feuille des tailles attendu dans le fragment\n${page}`)
    const fichier = join(root, 'public/m', lien[1])
    assert.ok(existsSync(fichier), `${fichier} absent du dossier de sortie`)
    const css = readFileSync(fichier, 'utf-8')
    assert.ok(css.startsWith(':root{--mjs-fs-41_5:calc(') && css.includes('--mjs-fs-41_5:2.59375rem'), css)
    assert.ok(!/<style/i.test(page), `aucun <style> attendu dans le fragment\n${page}`)
  })
})
