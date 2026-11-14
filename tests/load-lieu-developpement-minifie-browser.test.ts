// µload écrit dans le gabarit avertit avec son lieu en développement minifié (`minify: true`) comme en développement : le suivi du
// chargement enveloppe les passes du rendu en les lisant par leur champ, que le minifieur raccourcit comme le reste. Défaut garanti
// absent : cherchées par le texte de leur nom, les passes n'étaient plus trouvées dans le code minifié, et l'avertissement ne venait pas.
// Chromium seul : le défaut tient à la minification, pas au moteur.

import assert from 'node:assert/strict'
import { construire, charger, type Cible } from './helpers/liaison-navigateur.js'
import { construireMinifie } from './helpers/developpement-minifie.js'
import { moteurPresent } from './helpers/navigateurs-compiles.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const BALISE  = 'mjs-lieu-min'
const SOURCES = { 'lieu-min.mjs': `<script>\n$l = [1]\n</script>\n<ul>{for m in $l}<li>{µload('/api/u/' + m).data?.n}</li>{end}</ul>\n` }

describe('µload dans le gabarit, développement minifié : l\'avertissement du lieu, comme en développement', function () {
  this.timeout(180000)
  const cibles: Record<string, Cible> = {}

  before(async function () {
    this.timeout(240000)
    if (!(await moteurPresent('chromium'))) this.skip()
    cibles['développement']         = await construire('dev-parents-avant', SOURCES, [BALISE])
    cibles['développement minifié'] = await construireMinifie('load-lieu-minifie', SOURCES)
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const mode of ['développement', 'développement minifié']) {
    it(`${mode} : µload dans une ligne de {for} avertit une fois, avec le lieu, l'adresse et le composant`, async function () {
      const playwright: any = await import('playwright')
      const browser = await playwright.chromium.launch()
      try {
        const o = await charger(browser, cibles[mode], BALISE)
        try {
          const lieux = () => o.avis.filter((a) => /µload/.test(a))
          for (let i = 0; i < 50 && lieux().length === 0; i++) await o.page.waitForTimeout(100)
          await o.page.waitForTimeout(200)
          assert.equal(lieux().length, 1, `${mode} : ${o.avis.join(' / ')}`)
          assert.ok(/ligne de \{for\}/.test(lieux()[0]) && lieux()[0].includes('/api/u/1') && lieux()[0].includes('<mjs-lieu-min>'), lieux()[0])
        }
        finally {
          await o.fermer()
        }
      }
      finally {
        await browser.close()
      }
    })
  }
})
