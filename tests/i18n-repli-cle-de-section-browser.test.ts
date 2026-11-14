// Le repli sur la langue par défaut d'une clé de section : la page est dans une autre langue que la langue par défaut, la section y est, mais pas la
// clé — le texte de la langue par défaut paraît. Le fragment de la langue par défaut n'est demandé qu'à ce moment, une fois par section, jamais quand
// rien ne manque ; le temps qu'il arrive, le texte suit la conduite d'un texte en route de son réglage (vide sous `wait` et `*loader`, barre sous
// `*skeleton`), jamais son nom en production ; sous `wait` et `*loader`, le premier rendu l'attend comme son propre fragment : caché, puis entier. Une clé absente des deux langues montre son nom. Le prérendu et le rendu serveur en anglais écrivent le
// même texte que le navigateur, sans rien redemander à la reprise. Changement de langue en cours de page, module à plusieurs sections. Chromium,
// Firefox et WebKit réels, un navigateur à la fois. Le français est la langue par défaut.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { MOTEURS, lancer, construire, relever, apresLeVide, type Options, type Page, type Releve, type Reseau, type Sonde } from './helpers/graine-page.js'

const HOME    = '@i18n \'accueil\'\n<h1 class="t">{µt(\'salut\')} / {µt(\'seulfr\')} / {µt(\'absente\')}</h1>\n'
const BASCULE = HOME + '<button class="en" @click={µlang = \'en\'}>en</button>\n'
const FICHE   = '@i18n \'fiche\'\n<h1 class="t">{µt(\'nom\')}</h1>\n'
const PAQUETS = '@i18n \'accueil\' \'fiche\'\n<h1 class="t">{µt(\'salut\')} / {µt(\'nom\')} / {µt(\'seulfr2\')} / {µt(\'absente\')}</h1>\n'
const SONDES: Sonde[] = [{ chemin: ['mjs-home'], sel: 'h1.t' }]
const TEXTES: Partial<Options> = {
  sections: {
    accueil: ['salut: Bonjour accueil\nseulfr: Section française\n', { salut: 'Hello home' }],
    fiche:   ['nom: Fiche\nseulfr2: Fiche seule\n', { nom: 'Card' }]
  }
}
const EN = 'Hello home / Section française / ⟦accueil.absente⟧'

// les fragments français demandés pendant le relevé
const fragmentsFr = (page: Page): string[] => page.requetes.filter(chemin => /\/i18n\/fr\/[^/]+\.json$/.test(chemin))

// les images où le module visible montre un emplacement vide
const vides = (r: Releve): string[] => apresLeVide(r.vus).filter(v => v !== '-' && !v.includes('[C]') && v.split('/').some(morceau => morceau.trim() === ''))

// le texte que le serveur a écrit dans la page, balises et repères retirés
const texteServeur = async (base: string): Promise<string> => {
  const html = await (await fetch(base + '/')).text()
  const h1   = /<h1[^>]*class="t[^"]*"[^>]*>([\s\S]*?)<\/h1>/.exec(html)
  assert.ok(h1, 'le serveur a écrit le titre du module')
  return h1![1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
}

// le changement de langue : le bouton du module, une fois la page en français
const basculer = async (page: any): Promise<void> => {
  await page.waitForTimeout(900)
  await page.evaluate('(function () { var h = document.querySelector("mjs-home"); (h._shadow || h.shadowRoot || h).querySelector("button.en").click() })()')
  await page.waitForTimeout(1600)
}

interface Cas { nom: string, options: Partial<Options>, adresse: string, attendu: string, fr: number, reseau?: Reseau, barre?: boolean, sansVide?: boolean, serveur?: boolean, bascule?: boolean, stable?: boolean }

const CAS: Cas[] = [
  { nom: 'sans rendu serveur, production, wait', options: { env: 'prod', sansRendu: true }, adresse: '/?lang=en', attendu: EN, fr: 1, reseau: { retardFr: 400 }, stable: true },
  { nom: 'sans rendu serveur, production, *skeleton', options: { env: 'prod', placeholder: '*skeleton', sansRendu: true }, adresse: '/?lang=en', attendu: EN, fr: 1, reseau: { retardFr: 400 }, barre: true },
  { nom: 'sans rendu serveur, production, *loader', options: { env: 'prod', placeholder: '*loader', sansRendu: true }, adresse: '/?lang=en', attendu: EN, fr: 1, reseau: { retardFr: 400 }, stable: true },
  { nom: 'sans rendu serveur, développement, wait', options: { env: 'dev', sansRendu: true }, adresse: '/?lang=en', attendu: EN, fr: 1, stable: true },
  { nom: 'rien ne manque : aucun fragment français', options: { env: 'prod', sansRendu: true, composants: { home: FICHE } }, adresse: '/?lang=en', attendu: 'Card', fr: 0 },
  { nom: 'module à plusieurs sections : un fragment français par section', options: { env: 'prod', sansRendu: true, composants: { home: PAQUETS } }, adresse: '/?lang=en', attendu: 'Hello home / Card / Fiche seule / ⟦accueil.absente⟧', fr: 2, stable: true },
  { nom: 'changement de langue en cours de page, du français à l\'anglais', options: { env: 'prod', sansRendu: true, composants: { home: BASCULE } }, adresse: '/', attendu: EN, fr: 1, sansVide: true, bascule: true },
  { nom: 'prérendu en anglais', options: { env: 'prod', locales: ['fr', 'en'], langue: 'en' }, adresse: '/', attendu: EN, fr: 0, sansVide: true, serveur: true },
  { nom: 'API du serveur, page en anglais', options: { env: 'prod', api: true, store: { __mjsLang: 'en' } }, adresse: '/', attendu: EN, fr: 0, sansVide: true, serveur: true }
]

describe('repli d\'une clé de section sur la langue par défaut (Chromium, Firefox, WebKit)', function () {
  this.timeout(600000)
  const pages: Record<string, Page> = {}

  before(async function () {
    for (const [i, c] of CAS.entries()) pages[c.nom] = await construire({ nom: 'repli-section-' + i, composants: { home: HOME }, ...TEXTES, ...c.options })
  })

  after(async function () {
    for (const page of Object.values(pages)) await page.fermer()
    await terminateSharedWorkerPool()
  })

  for (const c of CAS.filter(cas => cas.serveur)) {
    it(`${c.nom} : le serveur écrit ce que le navigateur montrera`, async function () {
      assert.equal(await texteServeur(pages[c.nom].base), c.attendu)
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
        it(c.nom, async function () {
          const page = pages[c.nom]
          page.poser(c.reseau ?? {})
          const r = await relever(navigateur, page.base + c.adresse, SONDES, c.bascule ? { scenario: basculer } : {})
          const fr = fragmentsFr(page)
          assert.deepEqual(r.erreurs, [], `erreurs : ${r.erreurs.join(' | ')}`)
          assert.equal(r.vus[r.vus.length - 1], c.attendu, `état final : ${r.etats.join(' /// ')}`)
          assert.equal(fr.length, c.fr, `fragments français demandés : ${fr.join(', ')}`)
          assert.equal(new Set(fr).size, fr.length, `chaque fragment français une seule fois : ${fr.join(', ')}`)
          if (c.options.env === 'prod') assert.deepEqual(r.vus.filter(v => v.replace(/⟦accueil\.absente⟧/g, '').includes('⟦')), [], `jamais, en production, le nom d'un texte que la langue par défaut porte : ${r.etats.join(' /// ')}`)
          if (c.sansVide) assert.deepEqual(vides(r), [], `jamais un emplacement vide dans le module visible : ${r.etats.join(' /// ')}`)
          // le module visible ne montre que son état final : aucun texte vide, aucune barre, aucun nom avant le texte de secours
          if (c.stable) assert.deepEqual(apresLeVide(r.vus).filter(v => v !== '-' && !v.includes('[C]') && v !== c.attendu), [], `aucun état intermédiaire visible : ${r.etats.join(' /// ')}`)
          if (c.barre) assert.ok(r.vus.some(v => v.split(' / ')[1] === '▒'), `une barre grise le temps du fragment français : ${r.etats.join(' /// ')}`)
        })
      }
    })
  }
})
