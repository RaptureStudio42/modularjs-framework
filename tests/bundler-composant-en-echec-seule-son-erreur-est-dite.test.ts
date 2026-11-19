// Un composant qui ne se compile pas ne fait dire que son erreur : sa vue `<@view main>` manque à la lecture des routes, mais
// la route qui la vise n'est pas refusée sur un autre fichier (le contrôle des routes attend une lecture complète), et les
// fichiers qui citent `<@fiche>` ne reçoivent pas « balise inconnue » : le composant existe, il est seulement en échec.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

async function construire(nom: string, fichiers: Record<string, string>, env: 'dev' | 'prod'): Promise<string[]> {
  const root = mjsTmp(nom)
  const src  = join(root, 'src')
  const out  = join(root, 'out')
  mkdirSync(src, { recursive: true })
  for (const [f, texte] of Object.entries(fichiers)) writeFileSync(join(src, f), texte)
  const b = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), env })
  const s = await b.compile()
  await b.close()
  return s.errors.map(e => e.message)
}

describe('composant en échec : seule son erreur est dite', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const env of ['dev', 'prod'] as const) {
    it(`${env} : la vue d'un composant en échec ne fait pas refuser la route d'un autre fichier`, async () => {
      const erreurs = await construire('echec-vue-route', {
        'menu.page.mjs':  '<routes target="main">\n  /a  a\n</routes>\n<p>menu</p>\n',
        'cadre.page.mjs': '<script>\n  $x = (\n</script>\n<@view main />\n',
        'a.mjs':          '<p>a</p>\n',
      }, env)
      assert.ok(erreurs.some(e => /cadre\.page\.mjs/.test(e)), 'l\'erreur du composant fautif est dite : ' + erreurs.join(' | '))
      assert.deepEqual(erreurs.filter(e => /menu\.page\.mjs/.test(e)), [], 'aucune erreur sur le fichier des routes')
    })

    it(`${env} : les fichiers qui citent un composant en échec ne reçoivent pas « balise inconnue »`, async () => {
      const erreurs = await construire('echec-balise-citee', {
        'fiche.mjs':  '<script>\n  $x = (\n</script>\n<p>fiche</p>\n',
        'liste.mjs':  '<@fiche />\n',
        'detail.mjs': '<div><@fiche /></div>\n',
      }, env)
      assert.ok(erreurs.some(e => /fiche\.mjs/.test(e)), 'l\'erreur du composant fautif est dite : ' + erreurs.join(' | '))
      assert.deepEqual(erreurs.filter(e => /liste\.mjs|detail\.mjs/.test(e)), [], 'aucune erreur sur les fichiers qui le citent')
    })
  }
})
