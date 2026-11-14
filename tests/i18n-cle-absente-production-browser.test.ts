// Une clé que ni la langue de la page ni la langue par défaut ne portent montre son nom, `⟦section.clé⟧`, en production comme en développement,
// sous `wait`, `*skeleton` et `*loader` ; une clé que seule la langue par défaut porte montre le texte de la langue par défaut ; un texte en route
// sous `*skeleton` reste une barre grise jusqu'à son arrivée. Le rendu serveur (prérendu, API du serveur, reprise par hydratation) écrit la même
// chose que le navigateur : la page du serveur et sa reprise ne diffèrent pas. Chromium, Firefox et WebKit réels, un navigateur à la fois.
//
// Le module lit une clé de sa section que les deux langues portent, une clé absente des deux (seule, avec une variable, puis calculée), une clé de
// sa section que seul le français porte, une clé racine que seul le français porte, et, à part, une clé racine absente des deux. Le français est la
// langue par défaut. Une page rendue par le serveur dans sa langue ne change pas à la reprise, le fichier de langue fût-il lent : ni vide, ni barre,
// ni nom remis, sur aucune sonde.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { MOTEURS, lancer, construire, relever, apresLeVide, type Options, type Page, type Releve, type Reseau, type Sonde } from './helpers/graine-page.js'

const HOME   = '@i18n \'accueil\'\n<script>\n  $suffixe = \'x\'\n</script>\n<h1 class="t">{µt(\'salut\')} / {µt(\'absente\')} / {µt(\'absente\', {n: 2})} / {µt(\'accueil.absente\' + $suffixe)} / {µt(\'seulfr\')} / {µt(\'/seulfr\')}</h1>\n<p class="r">{µt(\'/absente\')}</p>\n'
const SONDES: Sonde[] = [{ chemin: ['mjs-home'], sel: 'h1.t' }, { chemin: ['mjs-home'], sel: 'p.r' }]
const TEXTES: Partial<Options> = {
  sections: { accueil: ['salut: Bonjour accueil\nseulfr: Section française\n', { salut: 'Hello home' }] },
  racine:   { fr: 'seulfr: Racine française\n' }
}
// une clé calculée se lit telle quelle : le préfixe de la section ne s'ajoute qu'à une clé écrite en dur, il est ici dans la clé
const ABSENTES = '⟦accueil.absente⟧ / ⟦accueil.absente⟧ / ⟦accueil.absentex⟧'
const FR       = 'Bonjour accueil / ' + ABSENTES + ' / Section française / Racine française | ⟦absente⟧'
const EN       = 'Hello home / ' + ABSENTES + ' / Section française / Racine française | ⟦absente⟧'

// les images où le module visible montre un emplacement vide : le texte d'une clé rendu vide
const vides = (r: Releve): string[] => apresLeVide(r.vus).filter(v => v !== '-' && !v.includes('[C]') && v.split('/').some(morceau => morceau.trim() === ''))

// le texte que le serveur a écrit dans la page, balises et repères retirés
const texteServeur = async (base: string): Promise<string> => {
  const html = await (await fetch(base + '/')).text()
  const h1   = /<h1[^>]*class="t[^"]*"[^>]*>([\s\S]*?)<\/h1>/.exec(html)
  const p    = /<p[^>]*class="r[^"]*"[^>]*>([\s\S]*?)<\/p>/.exec(html)
  assert.ok(h1 && p, 'le serveur a écrit les textes du module')
  return [h1![1], p![1]].map(t => t.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()).join(' | ')
}

interface Cas { nom: string, options: Partial<Options>, adresses: Array<[string, string]>, serveur?: string, retard?: boolean, reseau?: Reseau }

const CAS: Cas[] = [
  { nom: 'sans rendu serveur, production, wait', options: { env: 'prod', sansRendu: true }, adresses: [['/?lang=en', EN], ['/', FR]] },
  { nom: 'sans rendu serveur, production, *skeleton', options: { env: 'prod', placeholder: '*skeleton', sansRendu: true }, adresses: [['/?lang=en', EN]], retard: true },
  { nom: 'sans rendu serveur, production, *loader', options: { env: 'prod', placeholder: '*loader', sansRendu: true }, adresses: [['/?lang=en', EN]] },
  { nom: 'sans rendu serveur, développement, wait', options: { env: 'dev', sansRendu: true }, adresses: [['/?lang=en', EN]] },
  { nom: 'prérendu, production', options: { env: 'prod' }, adresses: [['/', FR], ['/?lang=en', EN]], serveur: FR, reseau: { racineFr: 1500 } },
  { nom: 'prérendu, développement', options: { env: 'dev' }, adresses: [['/', FR]], serveur: FR, reseau: { racineFr: 1500 } },
  { nom: 'API du serveur, production, page en anglais', options: { env: 'prod', api: true, store: { __mjsLang: 'en' } }, adresses: [['/', EN]], serveur: EN, reseau: { racineEn: 1500 } },
  // l'anglais n'a pas de fragment pour la section : le serveur sert le français en repli, la graine le porte sous la langue par défaut
  { nom: 'API du serveur, production, page en anglais sans fragment anglais de la section', options: { env: 'prod', api: true, store: { __mjsLang: 'en' }, sections: { accueil: ['salut: Bonjour accueil\nseulfr: Section française\n', null] } }, adresses: [['/', FR]], serveur: FR, reseau: { racineEn: 1500 } },
  { nom: 'reprise par hydratation, production', options: { env: 'prod', hydrate: true }, adresses: [['/', FR]], serveur: FR, reseau: { racineFr: 1500 } }
]

describe('clé absente des deux langues : son nom, en production comme en développement (Chromium, Firefox, WebKit)', function () {
  this.timeout(600000)
  const pages: Record<string, Page> = {}

  before(async function () {
    for (const [i, c] of CAS.entries()) pages[c.nom] = await construire({ nom: 'cle-absente-' + i, composants: { home: HOME }, ...TEXTES, ...c.options })
  })

  after(async function () {
    for (const page of Object.values(pages)) await page.fermer()
    await terminateSharedWorkerPool()
  })

  for (const c of CAS.filter(cas => cas.serveur)) {
    it(`${c.nom} : le serveur écrit ce que le navigateur montrera`, async function () {
      assert.equal(await texteServeur(pages[c.nom].base), c.serveur)
    })
  }

  for (const m of MOTEURS) {
    describe(m, function () {
      let navigateur: any = null

      before(async function () {
        navigateur = await lancer(m)
        if (!navigateur) { console.log(`  ℹ️  ${m} non installé : tests sautés`); this.skip() }
      })

      after(async function () {
        if (navigateur) await navigateur.close()
      })

      for (const c of CAS) {
        for (const [adresse, attendu] of c.adresses) {
          it(`${c.nom}, ${adresse}`, async function () {
            const page = pages[c.nom]
            page.poser(c.retard ? { retards: { accueil: 700 } } : (c.reseau ?? {}))
            const r = await relever(navigateur, page.base + adresse, SONDES)
            assert.deepEqual(r.erreurs, [], `erreurs : ${r.erreurs.join(' | ')}`)
            assert.equal(r.vus[r.vus.length - 1], attendu, `état final : ${r.etats.join(' /// ')}`)
            // page sans rendu serveur en anglais : ce que l'anglais n'a pas attend le fragment français, vide sous wait et *loader le temps qu'il arrive
            if (!(c.options.sansRendu && adresse.includes('lang=en'))) assert.deepEqual(vides(r), [], `jamais un emplacement vide dans le module visible : ${r.etats.join(' /// ')}`)
            // page du serveur déjà dans sa langue : rien ne change entre elle et l'état final, toutes sondes comprises
            if (c.serveur && adresse === '/') assert.deepEqual(apresLeVide(r.vus).filter(v => v !== attendu && !v.split(' | ').includes('-')), [], `la reprise ne change rien à la page du serveur : ${r.etats.join(' /// ')}`)
            if (c.retard) assert.ok(r.vus.some(v => v.split(' / ')[1] === '▒'), `une barre grise tant que le texte est en route : ${r.etats.join(' /// ')}`)
          })
        }
      }
    })
  }
})
