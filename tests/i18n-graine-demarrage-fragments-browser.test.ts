// La bascule du démarrage : la page rendue par le serveur dans une langue (le français), demandée dans une autre (`?lang=en`). Elle garde la langue
// du serveur, puis passe d'un seul coup à la voulue quand les textes dont elle a besoin sont là. Ce que garantit ce passage, dans Chromium, Firefox et
// WebKit réels (page prérendue, construite en développement comme en production) :
//
// 1. Un fragment qui ÉCHOUE (404) ne clôt pas la bascule : elle attend tous les autres, ceux d'une section déclarée par un module (`@i18n`), ceux du
//    module que le serveur n'a pas rendu (posé dans le slot de l'hôte) et ceux des modules créés pendant l'attente. Aucune image ne mêle deux langues,
//    et le module du slot, retenu jusqu'au passage, n'est jamais visible et vide. Le module dont le fragment a échoué garde le texte de la langue
//    par défaut.
// 2. Un fragment dont la requête ne répond JAMAIS retient la page dans la langue du serveur tant qu'elle pend : ni langue mêlée, ni texte qui disparaît.
// 3. Une section que le serveur a LUE sans qu'un module la déclare (`µt('/extra.nom')` sous un autre `@i18n`) est dans la graine : la bascule
//    l'assure elle aussi dans la langue voulue avant de passer. Aucune image ne mêle deux langues, le texte de cette section compris.
//
// Chaque fragment anglais est retardé, refusé ou laissé sans réponse par le serveur de la page ; le texte de chaque sonde est relevé à chaque image
// (`requestAnimationFrame`), depuis la première, et jusqu'à l'état final quand la page doit passer (une machine chargée le retarde bien au-delà
// des délais du serveur).

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { MOTEURS, lancer, construire, relever, apresLeVide, type Moteur, type Page, type Releve, type Reseau, type Sonde } from './helpers/graine-page.js'

// chaque image de la page est permise (`permis` : ce qu'une image des sondes peut montrer, morceau par morceau), la dernière est la finale
const parmi = (permis: (morceaux: string[]) => boolean, final: string) => (r: Releve) => {
  assert.equal(r.vus[r.vus.length - 1], final, 'état final : ' + r.etats.join(' /// '))
  assert.deepEqual(apresLeVide(r.vus).filter(v => !permis(v.split(' | '))), [], 'images hors de ce qui est permis : ' + r.etats.join(' /// '))
}

// le relevé d'une page qui doit passer : jusqu'à son état final (20 s au plus ; au-delà, l'assertion montre où elle en est restée), `duree` ms
// en tout au moins, et 500 ms encore après le passage pour voir que rien ne bouge ensuite. Un délai fixe ne suffit pas : sur une machine
// chargée, la page passe après sa fin, et le test rougissait sans défaut
const jusquA = (final: string, duree = 2500) => async (page: any) => {
  const debut = Date.now()
  await page.waitForFunction((f: string) => { const vus = (window as any).__vus; return vus.length > 0 && vus[vus.length - 1] === f }, final, { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(Math.max(500, duree - (Date.now() - debut)))
}

describe('graine : la bascule du démarrage attend tous ses fragments, échec compris, et la section lue sans déclaration (Chromium, Firefox, WebKit)', function () {
  this.timeout(300000)
  const navigateurs: Partial<Record<Moteur, any>> = {}

  before(async function () {
    for (const m of MOTEURS) navigateurs[m] = await lancer(m)
    if (!navigateurs.chromium) { console.log('  ℹ️  Chromium non installé : test sauté'); this.skip() }
  })

  after(async function () {
    for (const m of MOTEURS) if (navigateurs[m]) await navigateurs[m].close()
    await terminateSharedWorkerPool()
  })

  // ---- 1. un fragment qui échoue ----

  // l'hôte (accueil, une fiche enfant) et un module posé à la main dans son slot, que le serveur ne rend pas : sa section `extra` n'est lue par personne
  const COMPOSANTS_ECHEC = {
    home:          '@i18n \'accueil\'\n<h1 class="t">{µt(\'salut\')} / {µt(\'/titre\')}</h1>\n<mjs-kid-section></mjs-kid-section>\n<slot></slot>\n',
    'kid-section': '@i18n \'fiche\'\n<i class="ks">{µt(\'nom\')}</i>\n',
    extra:         '@i18n \'extra\'\n<i class="kx">{µt(\'nom\')}</i>\n'
  }
  const SONDES_ECHEC: Sonde[] = [{ chemin: ['mjs-home'], sel: 'h1.t' }, { chemin: ['mjs-home', 'mjs-kid-section'], sel: 'i.ks' }, { chemin: ['mjs-home', 'light:mjs-extra'], sel: 'i.kx' }]
  const AVEC_EXTRA = (page: string) => page.replace('</mjs-home>', '<mjs-extra></mjs-extra></mjs-home>')

  const FR_H1 = 'Bonjour accueil / Titre'
  const EN_H1 = 'Hello home / Title'
  // la page du serveur : la fiche est là, ou pas encore définie (son fichier arrive : rien à lire), le module du slot, que le serveur n'a pas rendu, absent
  // ou caché ; puis la page voulue : la fiche, dont le fragment a échoué, garde le texte français, et le module du slot paraît rendu dans la langue
  // voulue — jamais le titre dans une langue et la fiche ou le module dans l'autre, jamais le module visible et vide
  const PERMIS_ECHEC = ([titre, fiche, module]: string[]) => (titre === FR_H1 && ['Fiche', '-'].includes(fiche) && ['-', ' [C]'].includes(module)) || (titre === EN_H1 && fiche === 'Fiche' && [' [C]', 'Extra'].includes(module))

  const CAS_ECHEC: Array<{ nom: string, reseau: Reseau }> = [
    { nom: 'la fiche en 404 aussitôt, l\'accueil à 700 ms et le module du slot à 900 ms : la page passe une fois, quand tout est là', reseau: { racineEn: 100, retards: { accueil: 700, extra: 900 }, echecs: ['fiche'] } },
    { nom: 'la fiche en 404, tout le reste rapide (100 ms) : la page ne passe pas avant les autres fragments', reseau: { racineEn: 100, retards: { accueil: 100, extra: 100 }, echecs: ['fiche'] } }
  ]

  for (const env of ['prod', 'dev'] as const) {
    describe(`un fragment qui échoue (${env})`, function () {
      let page: Page | null = null

      before(async function () {
        page = await construire({ nom: 'echec-' + env, composants: COMPOSANTS_ECHEC, env, html: AVEC_EXTRA })
      })

      after(async function () {
        if (page) await page.fermer()
      })

      for (const cas of CAS_ECHEC) {
        for (const m of MOTEURS) {
          it(`${cas.nom} — ${m}`, async function () {
            if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
            page!.poser(cas.reseau)
            const r = await relever(navigateurs[m], page!.base + '/?lang=en', SONDES_ECHEC, { scenario: jusquA(`${EN_H1} | Fiche | Extra`) })
            assert.deepEqual(r.erreurs, [], `erreurs : ${r.erreurs.join(' | ')}`)
            parmi(PERMIS_ECHEC, `${EN_H1} | Fiche | Extra`)(r)
          })
        }
      }
    })
  }

  // deux modules que l'hôte crée pendant l'attente des textes anglais (à 500 ms, avant l'arrivée de l'accueil à 800 ms) : le serveur ne les a pas rendus, leurs
  // sections ne sont pas dans la graine. L'une échoue aussitôt, l'autre arrive tard (900 ms après qu'elle est demandée) : la bascule les attend toutes deux
  const COMPOSANTS_TARDIFS = {
    home:          '@i18n \'accueil\'\n<script>\n  $late = false\n  setTimeout((-> $late = true), 500) unless µserver\n</script>\n<h1 class="t">{µt(\'salut\')} / {µt(\'/titre\')}</h1>\n{if $late}<mjs-kid-section></mjs-kid-section><mjs-extra></mjs-extra>{end}\n',
    'kid-section': COMPOSANTS_ECHEC['kid-section'],
    extra:         COMPOSANTS_ECHEC.extra
  }
  const SONDES_TARDIFS: Sonde[] = [{ chemin: ['mjs-home'], sel: 'h1.t' }, { chemin: ['mjs-home', 'mjs-kid-section'], sel: 'i.ks' }, { chemin: ['mjs-home', 'mjs-extra'], sel: 'i.kx' }]
  // avant le passage : la langue du serveur, les deux modules absents, cachés ou, une fois leurs textes français là, rendus en français ; après : la page voulue
  // d'un coup, avec la fiche en français (son fragment a échoué) et le module lent rendu en anglais, jamais encore en français
  const PERMIS_TARDIFS = ([titre, fiche, module]: string[]) => (titre === FR_H1 && ['-', ' [C]', 'Fiche'].includes(fiche) && ['-', ' [C]', 'Supplément'].includes(module)) || (titre === EN_H1 && fiche === 'Fiche' && module === 'Extra')

  for (const [env, moteurs] of [['prod', MOTEURS], ['dev', ['chromium'] as Moteur[]]] as Array<[ 'prod' | 'dev', Moteur[] ]>) {
    describe(`deux modules créés pendant l'attente, l'un en échec, l'autre lent (${env})`, function () {
      let page: Page | null = null

      before(async function () {
        page = await construire({ nom: 'tardifs-' + env, composants: COMPOSANTS_TARDIFS, env })
      })

      after(async function () {
        if (page) await page.fermer()
      })

      for (const m of moteurs) {
        it(`la page ne passe pas avant le module lent, qui paraît avec elle en anglais — ${m}`, async function () {
          if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
          page!.poser({ racineEn: 100, retards: { accueil: 800, extra: 900 }, echecs: ['fiche'] })
          const r = await relever(navigateurs[m], page!.base + '/?lang=en', SONDES_TARDIFS, { scenario: jusquA(`${EN_H1} | Fiche | Extra`, 3400) })
          assert.deepEqual(r.erreurs, [], `erreurs : ${r.erreurs.join(' | ')}`)
          parmi(PERMIS_TARDIFS, `${EN_H1} | Fiche | Extra`)(r)
        })
      }
    })
  }

  // une requête qui ne répond pas retient la page dans la langue du serveur tant qu'elle pend, comme une bascule de `µlang` : ni langue mêlée, ni texte qui
  // disparaît (le délai de secours de `wait` ne vaut que pour un module retenu, ici aucun : la fiche est dans la graine)
  describe('un fragment qui ne répond jamais (prod)', function () {
    let page: Page | null = null

    before(async function () {
      page = await construire({ nom: 'pendu', composants: COMPOSANTS_ECHEC, env: 'prod' })
    })

    after(async function () {
      if (page) await page.fermer()
    })

    for (const m of MOTEURS) {
      it(`la fiche anglaise ne répond pas : la page reste en français, rien ne disparaît — ${m}`, async function () {
        if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
        page!.poser({ racineEn: 100, retards: { accueil: 100 }, pendus: ['fiche'] })
        const r = await relever(navigateurs[m], page!.base + '/?lang=en', SONDES_ECHEC.slice(0, 2), { attente: 2600 })
        assert.deepEqual(r.erreurs, [], `erreurs : ${r.erreurs.join(' | ')}`)
        parmi(([titre, fiche]) => titre === FR_H1 && fiche === 'Fiche', `${FR_H1} | Fiche`)(r)
      })
    }
  })

  // ---- 3. une section lue par le serveur sans qu'un module la déclare ----

  // l'accueil lit `extra.nom` sans déclarer `extra` : le serveur la lit, elle entre dans la graine, personne n'en demande la version anglaise
  const COMPOSANTS_LUE = {
    home:          '@i18n \'accueil\'\n<h1 class="t">{µt(\'salut\')} / {µt(\'/extra.nom\')}</h1>\n<mjs-kid-section></mjs-kid-section>\n',
    'kid-section': '@i18n \'fiche\'\n<i class="ks">{µt(\'nom\')}</i>\n'
  }
  const SONDES_LUE: Sonde[] = [{ chemin: ['mjs-home'], sel: 'h1.t' }, { chemin: ['mjs-home', 'mjs-kid-section'], sel: 'i.ks' }]
  const FR_LUE = 'Bonjour accueil / Supplément'
  const EN_LUE = 'Hello home / Extra'
  // le titre lit `extra.nom` : il ne passe à l'anglais qu'avec la fiche (« Card »), jamais avec son texte de `extra` encore français
  const PERMIS_LUE = ([titre, fiche]: string[]) => (titre === FR_LUE && ['Fiche', '-'].includes(fiche)) || (titre === EN_LUE && fiche === 'Card')

  for (const [env, attente, moteurs] of [['prod', 'wait', MOTEURS], ['prod', '*skeleton', MOTEURS], ['dev', 'wait', ['chromium'] as Moteur[]]] as Array<[ 'prod' | 'dev', string, Moteur[] ]>) {
    describe(`une section lue sans déclaration (${env}, ${attente})`, function () {
      let page: Page | null = null

      before(async function () {
        page = await construire({ nom: 'lue-' + env + '-' + attente.replace(/\W/g, ''), composants: COMPOSANTS_LUE, env, placeholder: attente })
      })

      after(async function () {
        if (page) await page.fermer()
      })

      for (const m of moteurs) {
        it(`les fragments anglais à 200 ms, celui de la section lue à 700 ms : la page passe d'un coup, le texte de cette section avec elle — ${m}`, async function () {
          if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
          page!.poser({ racineEn: 200, retards: { accueil: 200, fiche: 200, extra: 700 } })
          const r = await relever(navigateurs[m], page!.base + '/?lang=en', SONDES_LUE, { scenario: jusquA(`${EN_LUE} | Card`) })
          assert.deepEqual(r.erreurs, [], `erreurs : ${r.erreurs.join(' | ')}`)
          parmi(PERMIS_LUE, `${EN_LUE} | Card`)(r)
        })
      }
    })
  }
})
