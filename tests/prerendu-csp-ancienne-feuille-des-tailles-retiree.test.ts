// mode `csp` : la page prérendue lie le bloc :root de ses tailles du texte dans une feuille hachée `mjs_ssr_head-….css`. Quand le bloc
// change d'une construction à la suivante (une taille ajoutée dans un autre composant), le fragment lie la feuille neuve, et l'ancienne
// ne reste pas dans le dossier de sortie
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { build, write } from './helpers/construction-cache.js'

const PAGE  = '<h1 class="t">Titre</h1>\n<style>\n  .t\n    font-size: 41.5px\n</style>\n'
const autre = (taille: string): string => `<p class="x">autre</p>\n<style>\n  .x\n    font-size: ${taille}\n</style>\n`
const tetes = (dir: string): string[] => readdirSync(dir).filter((f) => /^mjs_ssr_head-[0-9a-f]+\.css$/.test(f)).sort()
const liee  = (page: string): string => (/href="\/m\/(mjs_ssr_head-[0-9a-f]+\.css)"/.exec(page) ?? [])[1] ?? ''

describe('page prérendue en mode csp — l\'ancienne feuille des tailles du texte retirée', function () {
  this.timeout(280_000)

  it('le bloc change entre deux constructions : seule la feuille neuve reste, liée par le fragment', () => {
    const root    = mjsTmp('prerendu-csp-ancienne-feuille')
    const conf    = { sourceDir: 'app', outputDir: 'public/m', manifestPath: 'public/m/bundle.js', urlPrefix: '/m', csp: true, css: 'split', render: { default: 'prerender', outDir: 'public/pages', routes: { '/': { component: 'mjs-ma-page', engine: 'happy-dom' } } } }
    const fichier = join(root, 'public/pages/index.html')
    const sortie  = join(root, 'public/m')
    write(join(root, 'mjs.config.json'), `${JSON.stringify(conf, null, 2)}\n`)
    write(join(root, 'app/ma-page.mjs'), PAGE)
    write(join(root, 'app/autre.mjs'), autre('12px'))
    const avant = build(root, ['--prod'])
    assert.equal(avant.status, 0, avant.out)
    const premiere = liee(readFileSync(fichier, 'utf-8'))
    assert.deepEqual(tetes(sortie), [premiere])
    write(join(root, 'app/autre.mjs'), autre('64px'))
    const apres = build(root, ['--prod'])
    assert.equal(apres.status, 0, apres.out)
    const seconde = liee(readFileSync(fichier, 'utf-8'))
    assert.notEqual(seconde, premiere, 'le bloc a changé : une autre feuille')
    assert.match(readFileSync(join(sortie, seconde), 'utf-8'), /--mjs-fs-64:calc\(/)
    assert.deepEqual(tetes(sortie), [seconde], 'l\'ancienne feuille ne reste pas')
  })
})
