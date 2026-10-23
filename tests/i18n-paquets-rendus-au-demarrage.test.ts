// Un module à plusieurs sections (`@i18n 'ailleurs' 'panier'`) n'est rendu que le nombre de fois nécessaire au démarrage.
//
// Au démarrage, un composant monté avant la fin du chargement du fichier de langue est mis en file, puis rejoué : s'il n'a
// pas ses textes, il est rendu à nouveau — sauf quand une de ses sections est encore en route, dont l'arrivée le rendra de
// toute façon (un rendu de plus n'afficherait que les mêmes repères). Cette règle regardait la première section seule : un
// module dont la première section est déjà là (semée par le rendu serveur) et dont une autre est encore en route se rendait
// une fois de trop, pour rien.
//
// Méthode de tests/i18n-composant-traduit-rendu-sans-doublon.test.ts : chaque évaluation du gabarit passe par `compte`, qui la
// note dans `globalThis.__rendus` ; le fichier de langue est retenu jusqu'à ce que le composant soit monté.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { projet } from './helpers/i18n-rendu-projet.js'

const attendre = (ms = 80) => new Promise((r) => setTimeout(r, ms))

const SCRIPT = ['<script>', 'compte = (v) ->', '  globalThis.__rendus = (globalThis.__rendus or 0) + 1', '  v', '</script>']

// `resume` est dans les deux sections (la première écrite gagne), `seul_fr` seulement dans `panier`
const MODULE = (sections: string, wait = false, seulFr = true) => [`@i18n ${sections}`, '@i18nPlaceholder ' + (wait ? 'wait' : '*skeleton'), ...SCRIPT, '<p class="t">{compte(µt(\'resume\'))}</p>', ...(seulFr ? ['<p class="f">{µt(\'seul_fr\')}</p>'] : [])].join('\n')

const lire = (el: any, c: string) => el._shadow.querySelector(c).textContent.trim()

// monte le composant pendant que le fichier de langue est encore en route, puis le laisse arriver
async function demarrage(opts: { prod?: boolean, graine?: Record<string, string[]>, wait?: boolean, sections?: string, seulFr?: boolean }) {
  let ouvrir: () => void = () => {}
  const porte = new Promise<void>((r) => { ouvrir = r })
  const graine = opts.graine ? { lang: 'fr', sections: opts.graine } : undefined
  const p = await projet({ prod: opts.prod, graine, porteLangue: porte, sources: { vue: MODULE(opts.sections ?? "'ailleurs' 'panier'", opts.wait, opts.seulFr) } })
  const el = p.monte('vue')
  await attendre()
  ouvrir()
  await attendre(200)
  return { p, el, rendus: p.window.__rendus as number }
}

describe('module à plusieurs sections — nombre de rendus au démarrage', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of [false, true]) {
    const env = prod ? 'production' : 'développement'

    it(`${env} : la première section est semée, la seconde à télécharger : 2 rendus (la graine, puis l'arrivée), jamais 3`, async () => {
      const { p, el, rendus } = await demarrage({ prod, graine: { fr: ['ailleurs'] } })
      assert.equal(lire(el, 'p.t'), 'Autre résumé')
      assert.equal(lire(el, 'p.f'), 'Seulement en français', 'le texte de la seconde section est arrivé')
      assert.equal(p.requetes.filter((u: string) => /\/i18n\/fr\//.test(u)).length, 1, 'une seule requête : celle de la seconde section')
      assert.equal(rendus, 2)
    })

    it(`${env} : la seconde section est semée, la première à télécharger : 2 rendus (la graine, puis l'arrivée)`, async () => {
      const { el, rendus } = await demarrage({ prod, graine: { fr: ['panier'] } })
      assert.equal(lire(el, 'p.t'), 'Autre résumé')
      assert.equal(lire(el, 'p.f'), 'Seulement en français')
      assert.equal(rendus, 2)
    })

    it(`${env} : les deux sections sont semées : 1 rendu, aucune requête`, async () => {
      const { p, el, rendus } = await demarrage({ prod, graine: { fr: ['ailleurs', 'panier'] } })
      assert.equal(lire(el, 'p.t'), 'Autre résumé')
      assert.equal(lire(el, 'p.f'), 'Seulement en français')
      assert.equal(p.requetes.filter((u: string) => /\/i18n\/fr\//.test(u)).length, 0)
      assert.equal(rendus, 1)
    })

    it(`${env} : aucune graine, les deux sections à télécharger : un rendu en attente, puis les textes (2 rendus ou 3 si les paquets n'arrivent pas ensemble)`, async () => {
      const { el, rendus } = await demarrage({ prod })
      assert.equal(lire(el, 'p.t'), 'Autre résumé')
      assert.equal(lire(el, 'p.f'), 'Seulement en français')
      assert.ok(rendus >= 2 && rendus <= 3, `rendus : ${rendus}`)
    })

    it(`${env} : mode wait, la première section est semée : un seul rendu, avec tous les textes`, async () => {
      const { el, rendus } = await demarrage({ prod, wait: true, graine: { fr: ['ailleurs'] } })
      assert.equal(lire(el, 'p.t'), 'Autre résumé')
      assert.equal(lire(el, 'p.f'), 'Seulement en français')
      assert.equal(rendus, 1)
    })

    it(`${env} : un module à une seule section se rend comme avant (graine de la section : 1 rendu)`, async () => {
      const { el, rendus } = await demarrage({ prod, sections: "'ailleurs'", seulFr: false, graine: { fr: ['ailleurs'] } })
      assert.equal(lire(el, 'p.t'), 'Autre résumé')
      assert.equal(rendus, 1)
    })
  }
})
