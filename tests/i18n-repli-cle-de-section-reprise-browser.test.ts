// Le repli d'une clé de section sur la langue par défaut (le français), dans les cas de bord : une page rendue par le serveur en anglais où le
// navigateur seul lit une clé que l'anglais n'a pas (le serveur ne l'a pas lue, la graine ne porte pas le fragment français) — le texte reste en
// route jusqu'au fragment français, jamais son nom ; un changement de langue vers l'allemand pendant que le fragment français est en route — le texte
// paraît à son arrivée ; un fragment français en échec — la barre d'échec, aussitôt ; la reprise par hydratation (`markers`) d'une page en anglais —
// rien ne change ; un fragment français qui ne répond pas — au délai de secours, le module paraît, chaque texte manquant en barre ; un second module
// de la section ajouté après le démarrage (le fragment anglais déjà là), dont le premier rendu demande le fragment français — caché jusqu'à son
// arrivée sous `wait` et `*loader` (l'indicateur à sa place), barre puis texte sous `*skeleton`. Chromium, Firefox et WebKit réels, un navigateur à
// la fois.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { MOTEURS, lancer, construire, relever, apresLeVide, type Options, type Page, type Reseau, type Sonde } from './helpers/graine-page.js'

const HOME   = '@i18n \'accueil\'\n<h1 class="t">{µt(\'salut\')} / {µt(\'seulfr\')} / {µt(\'absente\')}</h1>\n'
// la clé que lit le navigateur dépend de l'adresse : le serveur lit `salut`, le navigateur (`?b=1`) lit `seulfr`
const CALCUL = '@i18n \'accueil\'\n<h1 class="t">{µt(\'salut\')} / {µt("accueil." + (location.search ? "seulfr" : "salut"))}</h1>\n'
const TROIS  = '@i18n \'accueil\'\n<h1 class="t">{µt(\'salut\')} / {µt(\'seulfr\')}</h1>\n<button class="de" @click={µlang = \'de\'}>de</button>\n'
const DE     = { racine: { titre: 'Titel', enfant: 'Kind' }, sections: { accueil: { salut: 'Hallo' }, fiche: { nom: 'Karte' }, extra: { nom: 'Extra' } } }
const SONDES: Sonde[] = [{ chemin: ['mjs-home'], sel: 'h1.t' }]
const SALUT  = '@i18n \'accueil\'\n<h1 class="t">{µt(\'salut\')}</h1>\n'
const AUTRE  = '@i18n \'accueil\'\n<h1 class="u">{µt(\'salut\')} / {µt(\'seulfr\')}</h1>\n'
// la page, le module ajouté après le démarrage, l'indicateur de `*loader` posé devant lui
const AJOUT: Sonde[] = [{ chemin: ['mjs-home'], sel: 'h1.t' }, { chemin: ['mjs-autre'], sel: 'h1.u' }, { chemin: [], sel: 'span[mjs-i18n-loader]' }]
const AJOUTE = 'Hello home / Section française'
const TEXTES: Partial<Options> = { sections: { accueil: ['salut: Bonjour accueil\nseulfr: Section française\n', { salut: 'Hello home' }] } }
const EN = 'Hello home / Section française / ⟦accueil.absente⟧'

const fragmentsFr = (page: Page): string[] => page.requetes.filter(chemin => /\/i18n\/fr\/[^/]+\.json$/.test(chemin))

const texteServeur = async (base: string): Promise<string> => {
  const html = await (await fetch(base + '/')).text()
  const h1   = /<h1[^>]*class="t[^"]*"[^>]*>([\s\S]*?)<\/h1>/.exec(html)
  assert.ok(h1, 'le serveur a écrit le titre du module')
  return h1![1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
}

// le passage à l'allemand, 600 ms après le chargement : le fragment français de secours est encore en route
const versAllemand = async (page: any): Promise<void> => {
  await page.waitForTimeout(600)
  await page.evaluate('(function () { var h = document.querySelector("mjs-home"); (h._shadow || h.shadowRoot || h).querySelector("button.de").click() })()')
  await page.waitForTimeout(2600)
}

// un second module de la section, ajouté 1 500 ms après le chargement : le fragment anglais est déjà là, pas le fragment français
const ajouterAutre = async (page: any): Promise<void> => {
  await page.waitForTimeout(1500)
  await page.evaluate('document.body.appendChild(document.createElement("mjs-autre"))')
  await page.waitForTimeout(1500)
}

interface Cas { nom: string, options: Partial<Options>, adresse: string, attendu: string, fr: number, reseau?: Reseau, serveur?: string, scenario?: (page: any) => Promise<void>, barre?: boolean, stable?: boolean, attente?: number, sondes?: Sonde[], ajout?: 'cache' | 'loader' | 'barre' }

const CAS: Cas[] = [
  { nom: 'prérendu en anglais, clé lue par le navigateur seul', options: { env: 'prod', locales: ['fr', 'en'], langue: 'en', composants: { home: CALCUL } }, adresse: '/?b=1', attendu: 'Hello home / Section française', fr: 1, reseau: { racineEn: 1200 }, serveur: 'Hello home / Hello home' },
  { nom: 'prérendu en anglais, clé lue par le navigateur seul, *skeleton', options: { env: 'prod', placeholder: '*skeleton', locales: ['fr', 'en'], langue: 'en', composants: { home: CALCUL } }, adresse: '/?b=1', attendu: 'Hello home / Section française', fr: 1, reseau: { racineEn: 1200 }, barre: true },
  { nom: 'API du serveur en anglais, clé lue par le navigateur seul', options: { env: 'prod', api: true, store: { __mjsLang: 'en' }, composants: { home: CALCUL } }, adresse: '/?b=1', attendu: 'Hello home / Section française', fr: 1, reseau: { racineEn: 1200 }, serveur: 'Hello home / Hello home' },
  { nom: 'passage à l\'allemand pendant le fragment français de secours', options: { env: 'prod', sansRendu: true, de: DE, composants: { home: TROIS } }, adresse: '/?lang=en', attendu: 'Hallo / Section française', fr: 1, reseau: { retardFr: 1500 }, scenario: versAllemand },
  { nom: 'passage à l\'allemand pendant le fragment français de secours, *skeleton', options: { env: 'prod', placeholder: '*skeleton', sansRendu: true, de: DE, composants: { home: TROIS } }, adresse: '/?lang=en', attendu: 'Hallo / Section française', fr: 1, reseau: { retardFr: 1500 }, scenario: versAllemand },
  { nom: 'fragment français de secours en échec', options: { env: 'prod', sansRendu: true }, adresse: '/?lang=en', attendu: 'Hello home / ▒ / ▒', fr: 1, reseau: { echecFr: true }, stable: true },
  { nom: 'fragment français de secours en échec, *skeleton', options: { env: 'prod', placeholder: '*skeleton', sansRendu: true }, adresse: '/?lang=en', attendu: 'Hello home / ▒ / ▒', fr: 1, reseau: { echecFr: true } },
  { nom: 'fragment français de secours qui ne répond pas', options: { env: 'prod', sansRendu: true }, adresse: '/?lang=en', attendu: 'Hello home / ▒ / ▒', fr: 1, reseau: { retardFr: 9000 }, attente: 5000, stable: true },
  { nom: 'fragment français de secours qui ne répond pas, *loader', options: { env: 'prod', placeholder: '*loader', sansRendu: true }, adresse: '/?lang=en', attendu: 'Hello home / ▒ / ▒', fr: 1, reseau: { retardFr: 9000 }, attente: 5000, stable: true },
  { nom: 'module ajouté après le démarrage, fragment français de secours en route', options: { env: 'prod', sansRendu: true, composants: { home: SALUT, autre: AUTRE } }, adresse: '/?lang=en', attendu: 'Hello home | ' + AJOUTE + ' | -', fr: 1, reseau: { retardFr: 300 }, scenario: ajouterAutre, sondes: AJOUT, ajout: 'cache' },
  { nom: 'module ajouté après le démarrage, fragment français de secours en route, *loader', options: { env: 'prod', placeholder: '*loader', sansRendu: true, composants: { home: SALUT, autre: AUTRE } }, adresse: '/?lang=en', attendu: 'Hello home | ' + AJOUTE + ' | -', fr: 1, reseau: { retardFr: 300 }, scenario: ajouterAutre, sondes: AJOUT, ajout: 'loader' },
  { nom: 'module ajouté après le démarrage, fragment français de secours en route, *skeleton', options: { env: 'prod', placeholder: '*skeleton', sansRendu: true, composants: { home: SALUT, autre: AUTRE } }, adresse: '/?lang=en', attendu: 'Hello home | ' + AJOUTE + ' | -', fr: 1, reseau: { retardFr: 300 }, scenario: ajouterAutre, sondes: AJOUT, ajout: 'barre' },
  { nom: 'reprise par hydratation (markers) d\'une page en anglais', options: { env: 'prod', hydrate: true, store: { __mjsLang: 'en' } }, adresse: '/', attendu: EN, fr: 0, reseau: { racineEn: 1200 }, serveur: EN, stable: true }
]

describe('repli d\'une clé de section : reprise, changement de langue, échec (Chromium, Firefox, WebKit)', function () {
  this.timeout(600000)
  const pages: Record<string, Page> = {}

  before(async function () {
    for (const [i, c] of CAS.entries()) pages[c.nom] = await construire({ nom: 'repli-reprise-' + i, composants: { home: HOME }, ...TEXTES, ...c.options })
  })

  after(async function () {
    for (const page of Object.values(pages)) await page.fermer()
    await terminateSharedWorkerPool()
  })

  for (const c of CAS.filter(cas => cas.serveur)) {
    it(`${c.nom} : le texte du serveur`, async function () {
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
        it(c.nom, async function () {
          const page = pages[c.nom]
          page.poser(c.reseau ?? {})
          const r  = await relever(navigateur, page.base + c.adresse, c.sondes ?? SONDES, c.scenario ? { scenario: c.scenario } : { attente: c.attente ?? 3000 })
          const fr = fragmentsFr(page)
          assert.deepEqual(r.erreurs, [], `erreurs : ${r.erreurs.join(' | ')}`)
          assert.equal(r.vus[r.vus.length - 1], c.attendu, `état final : ${r.etats.join(' /// ')}`)
          assert.equal(fr.length, c.fr, `fragments français demandés : ${fr.join(', ')}`)
          assert.deepEqual(r.vus.filter(v => v.replace(/⟦accueil\.absente⟧/g, '').includes('⟦')), [], `jamais, en production, le nom d'un texte que la langue par défaut porte : ${r.etats.join(' /// ')}`)
          if (c.stable) assert.deepEqual(apresLeVide(r.vus).filter(v => v !== '-' && !v.includes('[C]') && v !== c.attendu), [], `aucun état intermédiaire visible : ${r.etats.join(' /// ')}`)
          if (c.barre) assert.ok(r.vus.some(v => v.split(' / ')[1] === '▒'), `une barre grise tant que le texte est en route : ${r.etats.join(' /// ')}`)
          if (c.ajout) {
            const vus      = r.vus.map(v => v.split(' | '))
            const visibles = vus.filter(v => v[1] !== '-' && !v[1].includes('[C]')).map(v => v[1])
            if (c.ajout === 'barre') assert.ok(visibles.includes('Hello home / ▒'), `le module ajouté : une barre grise le temps du fragment français : ${r.etats.join(' /// ')}`)
            else {
              assert.deepEqual(visibles.filter(v => v !== AJOUTE), [], `le module ajouté ne paraît qu'entier : ${r.etats.join(' /// ')}`)
              assert.ok(vus.some(v => v[1].includes('[C]') && (c.ajout === 'cache' || v[2] !== '-')), `le module ajouté reste caché le temps du fragment français, l'indicateur de *loader à sa place : ${r.etats.join(' /// ')}`)
            }
          }
        })
      }
    })
  }
})
