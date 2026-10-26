// Libellés du framework hors modules cœur, surchargés par le projet dans ses textes racine (`mjs.toast.*`, `mjs.modal.*`,
// `mjs.router.*`, `mjs.fx.*`), page sans rendu serveur : le fichier de la langue arrive APRÈS le dessin (réseau lent). Ce qui est
// déjà affiché et qui dure prend la surcharge à son arrivée : le titre d'un toast visible, les boutons d'une modale ouverte, le
// panneau « Page introuvable » du routeur, le nom (`aria-label`) d'un texte caché par `*spoiler` et d'une barre de `*scrollprogress`,
// la commande de `*flipcard`, le texte de `*loader`, la bulle de `*guard`, le bandeau de `*offline`. Ce qui s'affiche après l'arrivée
// la prend aussi. Même chose à une bascule vers l'anglais, le fichier anglais retardé, pour un toast, une modale et une bulle ouverts
// pendant l'attente. Avant, seuls les modules cœur suivaient : le reste gardait le libellé du framework lu pendant l'attente.
// Aucun coût sans surcharge : l'arrivée d'un fichier qui ne surcharge aucun libellé du framework ne récrit rien, et celle d'un fichier
// qui ne surcharge que les toasts ne récrit que leur titre. Page qui démarre dans une autre langue que la langue par défaut (`?lang=en`),
// les deux fichiers retardés, dans un ordre puis dans l'autre : ce qui est affiché pendant l'attente porte le libellé anglais du framework,
// prend la surcharge anglaise à l'arrivée du fichier anglais, et l'arrivée du fichier français n'y écrit rien (avant, la recherche se faisait
// dans la langue par défaut : le toast gardait « Succès » ou prenait la surcharge française) ; sans surcharge, aucune des deux arrivées n'écrit.
// Chromium, Firefox et WebKit réels, développement et production (les témoins de coût en développement seulement).

import assert from 'node:assert/strict'
import { RUNTIME_LABELS } from '../src/runtime-labels.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { MOTEURS, lancer, construire, type Moteur, type Page } from './helpers/graine-page.js'

const HOME = `<vars>
  $n int 1..5
</vars>

<script>
  basculer = -> µlang = 'en'

  ouvrir = ->
    µ.modal.notify('bonjour', { type: 'success', duration: 0 })
    µ.modal.fire({ text: 'Question ?', showDenyButton: true, showCancelButton: true })

  µmount ->
    ouvrir()
    window.__ouvrir = ouvrir
</script>

<routes target="v">
/  fiche
</routes>

<button class="en" @click={basculer()}>EN</button>
<p class="spoiler" *spoiler>secret</p>
<div class="flip" *flipcard><div>recto</div><div>verso</div></div>
<div class="loader" *loader></div>
<div class="defile" *scrollprogress><p>texte</p></div>
<input class="garde" type="number" aria-label="nombre" value=!{$n} *guard(delay: 0, duration: 60s, fx: none)>
<div class="horsligne" *offline(delay: 0s)><p>zone</p></div>
<@view v>
`

const COMPOSANTS = { 'home.page': HOME, fiche: '<p class="fiche">fiche</p>\n' }
const RUNTIME    = ['hydrate', 'i18n', 'modal', 'router']

// une surcharge par libellé montré, en français et en anglais
const SURCHARGE = (l: string) => ({
  toast:  { success: 'PROJET-' + l + '-succes' },
  modal:  { ok: 'PROJET-' + l + '-ok', deny: 'PROJET-' + l + '-non', cancel: 'PROJET-' + l + '-annuler' },
  router: { notFound: 'PROJET-' + l + '-introuvable', noRoute: 'PROJET-' + l + '-aucune' },
  fx:     { spoiler: 'PROJET-' + l + '-cache', flip: 'PROJET-' + l + '-retourner', loading: 'PROJET-' + l + '-chargement', progress: 'PROJET-' + l + '-progression', range: 'PROJET-' + l + '-de {a} à {b}', offline: 'PROJET-' + l + '-horsligne' }
})
const yaml   = (o: Record<string, Record<string, string>>) => 'mjs:\n' + Object.entries(o).map(([g, t]) => '  ' + g + ':\n' + Object.entries(t).map(([k, v]) => '    ' + k + ': \'' + v + '\'\n').join('')).join('')
const RACINE = { fr: yaml(SURCHARGE('fr')), en: { mjs: SURCHARGE('en') } }

// ce que chaque affichage montre : le libellé du framework, puis la surcharge du projet
const FR = (RUNTIME_LABELS as any).fr
const EN = (RUNTIME_LABELS as any).en
const ATTENDU = (t: any, s: any, progression: string) => ({
  toast:       [t.toast.success, s.toast.success],
  ok:          [t.modal.ok, s.modal.ok],
  non:         [t.modal.deny, s.modal.deny],
  annuler:     [t.modal.cancel, s.modal.cancel],
  introuvable: [t.router.notFound, s.router.notFound],
  aucune:      [t.router.noRoute, s.router.noRoute],
  spoiler:     [t.fx.spoiler, s.fx.spoiler],
  flip:        [t.fx.flip, s.fx.flip],
  loader:      [t.fx.loading, s.fx.loading],
  progression: [progression, s.fx.progress],
  guard:       [t.fx.range.replace('{a}', '1').replace('{b}', '5'), s.fx.range.replace('{a}', '1').replace('{b}', '5')],
  offline:     [t.fx.offline, s.fx.offline]
}) as Record<string, [string, string]>
const ATTENDU_FR = ATTENDU(FR, SURCHARGE('fr'), 'Progression de la lecture')
const ATTENDU_EN = ATTENDU(EN, SURCHARGE('en'), 'Reading progress')

// les textes de la page : le premier toast et le dernier, la modale ouverte, le panneau du routeur, les effets ; et les fichiers de
// langue arrivés (une entrée de la chronologie des ressources ne paraît qu'à la fin de la réponse)
const LIRE = `(() => {
  const h = document.querySelector('mjs-home')._shadow
  const texte = (n) => n ? n.textContent : null
  const attr  = (n, a) => n ? n.getAttribute(a) : null
  const toasts = document.querySelectorAll('.mjs-toast-title')
  const arrive = (l) => performance.getEntriesByType('resource').some((e) => e.name.includes('/mjs_i18n-' + l + '-'))
  return {
    fr: arrive('fr'), en: arrive('en'),
    toast: texte(toasts[0]), dernier: texte(toasts[toasts.length - 1]),
    ok: texte(document.querySelector('.mjs-modal-confirm')), non: texte(document.querySelector('.mjs-modal-deny')), annuler: texte(document.querySelector('.mjs-modal-cancel')),
    introuvable: texte(h.querySelector('.mjs-route-error strong')), aucune: texte(h.querySelector('.mjs-route-error p')),
    spoiler: attr(h.querySelector('.spoiler'), 'aria-label'), flip: texte(h.querySelector('[mjs-fx-flipcard-turn]')),
    loader: texte(h.querySelector('[mjs-fx-loader-said]')), progression: attr(h.querySelector('[mjs-fx-layer="scrollprogress"]'), 'aria-label'),
    guard: texte(h.querySelector('[mjs-fx-guard-tip]')), offline: texte(h.querySelector('[mjs-fx-offline-band]'))
  }
})()`

// une valeur hors de la règle du champ (`$n int 1..5`) à sa sortie : ramenée, et la bulle de *guard dit la plage
const REFUSER = `(() => {
  const g = document.querySelector('mjs-home')._shadow.querySelector('input.garde')
  g.value = '9'
  g.dispatchEvent(new Event('change', { bubbles: true }))
})()`

// ce qui manque encore au dessin de la page : le toast tiré au montage, le panneau du routeur, le texte de *loader, le bandeau de *offline
const MANQUE = `(() => {
  const h = document.querySelector('mjs-home')?._shadow
  const manque = []
  if (!document.querySelector('.mjs-toast-title')) manque.push('toast')
  if (!h?.querySelector('.mjs-route-error')) manque.push('panneau du routeur')
  if (!h?.querySelector('[mjs-fx-loader-said]')?.textContent) manque.push('texte de *loader')
  if (!h?.querySelector('[mjs-fx-offline-band]')) manque.push('bandeau de *offline')
  return manque
})()`

// compte, à partir d'ici, les écritures dans chaque affichage qui dure (texte, ou le seul `aria-label` pour un attribut)
const COMPTES = ['toast', 'ok', 'non', 'annuler', 'introuvable', 'spoiler', 'flip', 'loader', 'progression', 'guard', 'offline']
const AUCUNE  = Object.fromEntries(COMPTES.map((k) => [k, 0]))
const COMPTER = `(() => {
  const h = document.querySelector('mjs-home')._shadow
  const w = window
  const texte = { childList: true, characterData: true, subtree: true }
  const nom   = { attributes: true, attributeFilter: ['aria-label'] }
  w.__ecrits = {}
  const suivre = (cle, n, o) => {
    if (!n) { w.__ecrits[cle] = 'absent'; return }
    w.__ecrits[cle] = 0
    new MutationObserver((l) => { w.__ecrits[cle] += l.length }).observe(n, o)
  }
  suivre('toast', document.querySelector('.mjs-toast-title'), texte)
  suivre('ok', document.querySelector('.mjs-modal-confirm'), texte)
  suivre('non', document.querySelector('.mjs-modal-deny'), texte)
  suivre('annuler', document.querySelector('.mjs-modal-cancel'), texte)
  suivre('introuvable', h.querySelector('.mjs-route-error'), texte)
  suivre('spoiler', h.querySelector('.spoiler'), nom)
  suivre('flip', h.querySelector('[mjs-fx-flipcard-turn]'), texte)
  suivre('loader', h.querySelector('[mjs-fx-loader-said]'), texte)
  suivre('progression', h.querySelector('[mjs-fx-layer="scrollprogress"]'), nom)
  suivre('guard', h.querySelector('[mjs-fx-guard-tip]'), texte)
  suivre('offline', h.querySelector('[mjs-fx-offline-band]'), texte)
})()`

describe('libellés du framework (toasts, modale, routeur, effets) : une surcharge du projet arrivée après le dessin se voit (Chromium, Firefox, WebKit)', function () {
  this.timeout(600000)
  const navigateurs: Partial<Record<Moteur, any>> = {}

  before(async function () {
    for (const m of MOTEURS) navigateurs[m] = await lancer(m)
    if (!navigateurs.chromium) { console.log('  ℹ️  Chromium non installé : test sauté'); this.skip() }
  })

  after(async function () {
    for (const m of MOTEURS) if (navigateurs[m]) await navigateurs[m].close()
    await terminateSharedWorkerPool()
  })

  // la page sur une adresse sans route (`recherche` : la langue voulue, `?lang=en`), dans un contexte neuf, le navigateur hors ligne pour
  // *offline (le réseau, lui, répond), une fois dessinée ; ses erreurs relevées. Sans attendre l'événement `load` : Firefox et WebKit le
  // retardent jusqu'à l'arrivée du fichier de langue
  const ouvrir = async (m: Moteur, page: Page, recherche = '') => {
    const ctx = await navigateurs[m].newContext()
    await ctx.addInitScript(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }) })
    const p       = await ctx.newPage()
    const erreurs: string[] = []
    p.on('pageerror', (e: any) => erreurs.push(String(e)))
    await p.goto(page.base + '/' + recherche + '#/introuvable', { waitUntil: 'domcontentloaded' })
    try {
      await p.waitForFunction(MANQUE + '.length === 0', null, { timeout: 30000 })
    }
    catch {
      throw new Error('page non dessinée au bout de 30 s, il manque : ' + (await p.evaluate(MANQUE)).join(', '))
    }
    await p.waitForTimeout(300)
    return { ctx, p, erreurs }
  }

  // l'arrivée du fichier de la langue `l`, puis le temps que la page le reçoive
  const arriver = async (p: any, l: string) => {
    await p.waitForFunction((x: string) => performance.getEntriesByType('resource').some((e) => e.name.includes('/mjs_i18n-' + x + '-')), l, { timeout: 30000 })
    await p.waitForTimeout(400)
  }

  // les affichages dont le texte n'est pas celui attendu
  const ecarts = (vus: Record<string, any>, attendu: Record<string, [string, string]>, i: 0 | 1, cles = Object.keys(attendu)) =>
    cles.filter((k) => vus[k] !== attendu[k][i]).map((k) => `${k} : « ${vus[k]} » au lieu de « ${attendu[k][i]} »`)

  for (const env of ['dev', 'prod'] as const) {
    describe(`sans rendu serveur (${env})`, function () {
      const pages: Record<string, Page> = {}

      before(async function () {
        pages.home = await construire({ nom: 'libelles-framework-' + env, composants: COMPOSANTS, env, sansRendu: true, runtime: RUNTIME, racine: RACINE })
        // une première visite par moteur : le premier dessin d'un moteur froid (WebKit) peut dépasser le retard du fichier de langue
        for (const m of MOTEURS) {
          if (!navigateurs[m]) continue
          pages.home.poser({})
          const o = await ouvrir(m, pages.home)
          await o.ctx.close()
        }
        if (env === 'dev') {
          pages.sans  = await construire({ nom: 'libelles-framework-sans-' + env, composants: COMPOSANTS, env, sansRendu: true, runtime: RUNTIME })
          pages.toast = await construire({ nom: 'libelles-framework-toast-' + env, composants: COMPOSANTS, env, sansRendu: true, runtime: RUNTIME, racine: { fr: yaml({ toast: { success: 'PROJET-fr-succes' } }) } })
        }
      })

      after(async function () {
        for (const page of Object.values(pages)) await page.fermer()
      })

      for (const m of MOTEURS) {
        it(`${m} : démarrage, fichier français retardé — ce qui est affiché prend la surcharge à son arrivée, ce qui s'affiche ensuite aussi`, async function () {
          if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
          pages.home.poser({ racineFr: 5000 })
          const { ctx, p, erreurs } = await ouvrir(m, pages.home)
          try {
            await p.evaluate(REFUSER)
            await p.waitForTimeout(300)
            const avant = await p.evaluate(LIRE) as Record<string, any>
            await arriver(p, 'fr')
            const apres = await p.evaluate(LIRE) as Record<string, any>
            await p.evaluate('void window.__ouvrir()')
            await p.evaluate(REFUSER)
            await p.waitForTimeout(300)
            const neufs = await p.evaluate(LIRE) as Record<string, any>
            assert.deepEqual(erreurs, [], `erreurs : ${erreurs.join(' | ')}`)
            assert.ok(!avant.fr && apres.fr, `le fichier français arrive entre les deux relevés (arrivé au premier : ${avant.fr}, au second : ${apres.fr})`)
            assert.deepEqual(ecarts(avant, ATTENDU_FR, 0), [], 'avant l\'arrivée du fichier : le libellé du framework')
            assert.deepEqual(ecarts({ ...neufs, toast: neufs.dernier }, ATTENDU_FR, 1, ['toast', 'ok', 'non', 'annuler', 'guard']), [], 'ce qui s\'affiche après l\'arrivée prend la surcharge')
            assert.deepEqual(ecarts(apres, ATTENDU_FR, 1), [], 'à l\'arrivée du fichier : ce qui est affiché prend la surcharge')
          } finally {
            await ctx.close()
          }
        })

        it(`${m} : bascule vers l'anglais, fichier anglais retardé — le toast, la modale et la bulle ouverts pendant l'attente prennent la surcharge anglaise`, async function () {
          if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
          pages.home.poser({ racineEn: 5000 })
          const { ctx, p, erreurs } = await ouvrir(m, pages.home)
          const cles = ['toast', 'ok', 'non', 'annuler', 'guard']
          try {
            await arriver(p, 'fr')
            await p.evaluate(() => { (document.querySelector('mjs-home') as any)._shadow.querySelector('button.en').click() })
            await p.waitForTimeout(100)
            await p.evaluate('void window.__ouvrir()')
            await p.evaluate(REFUSER)
            await p.waitForTimeout(300)
            const avant = await p.evaluate(LIRE) as Record<string, any>
            await arriver(p, 'en')
            const apres = await p.evaluate(LIRE) as Record<string, any>
            assert.deepEqual(erreurs, [], `erreurs : ${erreurs.join(' | ')}`)
            assert.ok(!avant.en && apres.en, `le fichier anglais arrive entre les deux relevés (arrivé au premier : ${avant.en}, au second : ${apres.en})`)
            assert.deepEqual(ecarts({ ...avant, toast: avant.dernier }, ATTENDU_EN, 0, cles), [], 'avant l\'arrivée du fichier : le libellé anglais du framework')
            assert.deepEqual(ecarts({ ...apres, toast: apres.dernier }, ATTENDU_EN, 1, cles), [], 'à l\'arrivée du fichier : la surcharge anglaise')
          } finally {
            await ctx.close()
          }
        })

        for (const premier of ['en', 'fr'] as const) {
          const second = premier === 'en' ? 'fr' : 'en'
          it(`${m} : démarrage dans la langue voulue (?lang=en), fichier ${premier === 'en' ? 'anglais' : 'français'} arrivé le premier — le libellé anglais du framework pendant l'attente, la surcharge anglaise à l'arrivée du fichier anglais, rien à celle du français`, async function () {
            if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
            pages.home.poser(premier === 'en' ? { racineEn: 4000, racineFr: 7000 } : { racineFr: 4000, racineEn: 7000 })
            const { ctx, p, erreurs } = await ouvrir(m, pages.home, '?lang=en')
            try {
              await p.evaluate(REFUSER)
              await p.waitForTimeout(300)
              const avant = await p.evaluate(LIRE) as Record<string, any>
              await p.evaluate(COMPTER)
              await arriver(p, premier)
              const ecrits = await p.evaluate(() => ({ ...(window as any).__ecrits })) as Record<string, number | string>
              const milieu = await p.evaluate(LIRE) as Record<string, any>
              await arriver(p, second)
              const apres = await p.evaluate(LIRE) as Record<string, any>
              assert.deepEqual(erreurs, [], `erreurs : ${erreurs.join(' | ')}`)
              assert.ok(!avant.fr && !avant.en && milieu[premier] && !milieu[second] && apres[second], `les deux fichiers arrivent l'un après l'autre entre les relevés (avant : ${avant.fr}/${avant.en}, milieu : ${milieu.fr}/${milieu.en}, après : ${apres.fr}/${apres.en})`)
              assert.deepEqual(ecarts(avant, ATTENDU_EN, 0), [], 'pendant l\'attente : le libellé anglais du framework')
              if (premier === 'fr') assert.deepEqual(ecrits, AUCUNE, 'l\'arrivée du fichier français n\'écrit rien')
              assert.deepEqual(ecarts(milieu, ATTENDU_EN, premier === 'en' ? 1 : 0), [], `à l'arrivée du premier fichier (${premier})`)
              assert.deepEqual(ecarts(apres, ATTENDU_EN, 1), [], 'à la fin : la surcharge anglaise')
            } finally {
              await ctx.close()
            }
          })
        }

        if (env === 'dev') {
          it(`${m} : démarrage dans la langue voulue (?lang=en), projet sans surcharge — le libellé anglais du framework, aucune des deux arrivées n'écrit`, async function () {
            if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
            pages.sans.poser({ racineFr: 4000, racineEn: 7000 })
            const { ctx, p, erreurs } = await ouvrir(m, pages.sans, '?lang=en')
            try {
              await p.evaluate(REFUSER)
              await p.waitForTimeout(300)
              await p.evaluate(COMPTER)
              const avant = await p.evaluate(LIRE) as Record<string, any>
              await arriver(p, 'fr')
              await arriver(p, 'en')
              const ecrits = await p.evaluate(() => ({ ...(window as any).__ecrits })) as Record<string, number | string>
              const vus    = await p.evaluate(LIRE) as Record<string, any>
              assert.deepEqual(erreurs, [], `erreurs : ${erreurs.join(' | ')}`)
              assert.ok(!avant.fr && !avant.en && vus.fr && vus.en, `les deux fichiers arrivent pendant le comptage (au début : ${avant.fr}/${avant.en}, à la fin : ${vus.fr}/${vus.en})`)
              assert.deepEqual(ecarts(vus, ATTENDU_EN, 0), [], 'le libellé anglais du framework')
              assert.deepEqual(ecrits, AUCUNE, 'aucune écriture aux arrivées')
            } finally {
              await ctx.close()
            }
          })

          // l'arrivée du fichier français, retardé, pendant que l'on compte les écritures dans les affichages déjà là
          const compter = async (page: Page) => {
            page.poser({ racineFr: 5000 })
            const o = await ouvrir(m, page)
            await o.p.evaluate(REFUSER)
            await o.p.waitForTimeout(300)
            await o.p.evaluate(COMPTER)
            const avant = await o.p.evaluate(LIRE) as Record<string, any>
            await arriver(o.p, 'fr')
            const ecrits = await o.p.evaluate(() => ({ ...(window as any).__ecrits })) as Record<string, number | string>
            const vus    = await o.p.evaluate(LIRE) as Record<string, any>
            assert.ok(!avant.fr && vus.fr, `le fichier français arrive pendant le comptage (arrivé au début : ${avant.fr}, à la fin : ${vus.fr})`)
            return { ...o, ecrits, vus }
          }

          it(`${m} : projet sans surcharge — l'arrivée du fichier ne récrit aucun affichage`, async function () {
            if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
            const { ctx, p, erreurs, ecrits } = await compter(pages.sans)
            try {
              assert.deepEqual(ecrits, AUCUNE, 'aucune écriture à l\'arrivée')
              // témoin : une écriture faite à la main est bien comptée
              await p.evaluate(() => { (document.querySelector('.mjs-toast-title') as any).textContent = 'x' })
              await p.waitForTimeout(50)
              assert.equal(await p.evaluate(() => (window as any).__ecrits.toast), 1, 'le compteur voit les écritures')
              assert.deepEqual(erreurs, [], `erreurs : ${erreurs.join(' | ')}`)
            } finally {
              await ctx.close()
            }
          })

          it(`${m} : surcharge des seuls toasts — l'arrivée du fichier ne récrit que le titre du toast`, async function () {
            if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
            const { ctx, erreurs, ecrits, vus } = await compter(pages.toast)
            try {
              assert.equal(vus.toast, 'PROJET-fr-succes', 'le titre du toast prend la surcharge')
              assert.ok((ecrits.toast as number) > 0, 'le titre du toast est récrit')
              assert.deepEqual({ ...ecrits, toast: 0 }, AUCUNE, 'rien d\'autre n\'est récrit')
              assert.deepEqual(erreurs, [], `erreurs : ${erreurs.join(' | ')}`)
            } finally {
              await ctx.close()
            }
          })
        }
      }
    })
  }
})
