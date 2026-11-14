// construction sur place : quand seul le bloc :root des tailles du texte change (une taille ajoutée dans un autre composant,
// corps rendu de la page identique), le fragment prérendu est récrit avec le bloc neuf ; le bloc d'avant ne reste jamais sur le
// disque

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { build, write } from './helpers/construction-cache.js'

const PAGE = '<h1 class="t">Titre</h1>\n<style>\n  .t\n    font-size: 41.5px\n</style>\n'

// le composant qui n'est pas dans la page, avec sa taille du texte
const autre = (taille: string): string => `<p class="x">autre</p>\n<style>\n  .x\n    font-size: ${taille}\n</style>\n`

// le fragment sans sa ligne d'en-tête, sans ses liens de démarrage ni le bloc des tailles : ce que le rendu a produit
const corps = (page: string): string => page.replace(/^[^\n]*\n/, '').replace(/<!-- mjs:demarrage -->\n[^]*?<!-- \/mjs:demarrage -->\n/, '').replace(/<style data-mjs-font-sizes>[^<]*<\/style>\n/, '')

describe('page prérendue — bloc des tailles du texte récrit quand lui seul change', function () {
  this.timeout(280_000)

  it('une taille ajoutée dans un autre composant : le fragment reçoit le bloc neuf, son corps est inchangé', () => {
    const root    = mjsTmp('prerendu-bloc-recrit')
    const conf    = { sourceDir: 'app', outputDir: 'public/m', manifestPath: 'public/m/bundle.js', urlPrefix: '/m', render: { default: 'prerender', outDir: 'public/pages', routes: { '/': { component: 'mjs-ma-page', engine: 'happy-dom' } } } }
    const fichier = join(root, 'public/pages/index.html')
    write(join(root, 'mjs.config.json'), `${JSON.stringify(conf, null, 2)}\n`)
    write(join(root, 'app/ma-page.mjs'), PAGE)
    write(join(root, 'app/autre.mjs'), autre('12px'))
    const avant = build(root, ['--prod'])
    assert.equal(avant.status, 0, avant.out)
    const page1 = readFileSync(fichier, 'utf-8')
    assert.ok(page1.includes('--mjs-fs-41_5:calc(') && !page1.includes('--mjs-fs-64'), `bloc de la seule taille de la page attendu\n${page1}`)
    write(join(root, 'app/autre.mjs'), autre('64px'))
    const apres = build(root, ['--prod'])
    assert.equal(apres.status, 0, apres.out)
    const page2 = readFileSync(fichier, 'utf-8')
    assert.equal(corps(page2), corps(page1), 'le corps rendu de la page ne change pas')
    assert.ok(page2.includes('--mjs-fs-41_5:calc(') && page2.includes('--mjs-fs-64:calc('), `bloc neuf attendu dans le fragment\n${page2}`)
  })
})
