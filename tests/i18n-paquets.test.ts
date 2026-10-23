// Plusieurs paquets de textes par module (`@i18n 'accueil' 'onglets-admin'`) — pourquoi ce test existe.
//
// Besoin d'origine : une page dont les blocs arrivent en deux temps, d'abord la page et ses textes, puis chaque bloc
// enfant qui demande ses propres textes — l'accueil « sautait » à l'arrivée de chaque paquet. Un module peut maintenant
// demander aussi les paquets de ses enfants : tout arrive d'un coup.
//
// Ce que le test garde, sur la fenêtre happy-dom (les images réellement peintes sont relevées dans
// i18n-paquets-browser.test.ts) : les paquets sont demandés EN MÊME TEMPS ; l'attente du module (mode `wait`, avec le
// masquage de la page qui attend ses textes) attend TOUS ses paquets ; un enfant qui déclare l'un d'eux le trouve déjà
// chargé (aucune requête de plus, aucune seconde attente) ; une clé relative se cherche dans les paquets du module dans
// l'ordre écrit, le premier qui la porte gagne ; une bascule de langue recharge tous les paquets ; le rendu serveur lit
// et sème les paquets en plus ; un paquet qui n'existe pas se comporte comme avec une seule section.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { renderToString } from '../src/server/renderToString.js'
import * as features from '../src/bundler/features.js'
import { transpile } from '../src/transpiler/index.js'
import { projet } from './helpers/i18n-rendu-projet.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'

const attendre = (ms = 40) => new Promise((r) => setTimeout(r, ms))

const PAGE  = (entete: string) => [entete, '<script>', '  $n = 7', '  $ouvert = true', '</script>', '', '<p class="t">{µt(\'resume\')}</p>', '<p class="n">{$n}</p>', '{if $ouvert}<@enfantpaq></@enfantpaq>{end}'].join('\n')
const ENFANT = ["@i18n 'ailleurs'", '@i18nPlaceholder *skeleton', '<script>', '  $m = 9', '</script>', '', '<p class="u">{µt(\'resume\')}</p>', '<p class="m">{$m}</p>'].join('\n')

const lire = (el: any, c = 'p.t') => el._shadow.querySelector(c)?.textContent.trim() ?? null

// nom du fragment de chaque section dans une langue : lu dans le fichier de langue du build, comme le fait le navigateur
function table(p: any, lang: string): Record<string, string> {
  const f = readdirSync(p.outDir).find((x: string) => x.startsWith(`mjs_i18n-${lang}-`))!
  return JSON.parse(readFileSync(join(p.outDir, f), 'utf-8').replace(/^export default /, '').replace(/;\s*$/, '')).sections
}

const estFragment = (u: string) => /\/i18n\/[^/]+\/[^/]+\.json$/.test(u)
const dernier    = (u: string) => u.split('/').pop()!.replace(/\.json$/, '')

// journal des requêtes de fragments NOTÉES À L'APPEL (une requête retenue y figure déjà) et retenue de sections choisies
// (`lang/section`) jusqu'à l'appel de `ouvre()` : l'attente dure aussi longtemps que le test le décide
function banc(p: any) {
  const appels: string[] = []
  const tenus = new Set<string>()
  const origine = p.window.fetch
  let ouvrir: () => void = () => {}
  let ouverte = new Promise<void>((r) => { ouvrir = r })
  p.window.fetch = async (url: string) => {
    appels.push(url)
    if (tenus.has(url.split('/').slice(-2).join('/').replace(/\.json$/, ''))) await ouverte
    return origine(url)
  }
  return {
    fragments: () => appels.filter(estFragment),
    retient(couples: string[]) {
      tenus.clear()
      for (const c of couples) { const [lang, section] = c.split('/'); tenus.add(`${lang}/${table(p, lang)[section]}`) }
      ouverte = new Promise<void>((r) => { ouvrir = r })
    },
    ouvre: () => ouvrir(),
  }
}

describe('plusieurs paquets par module — exécution', function () {
  this.timeout(90000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of [false, true]) {
    const env = prod ? 'production' : 'développement'

    it(`${env} : les paquets sont demandés en même temps, avant que le premier n'arrive`, async () => {
      const p = await projet({ prod, sources: { pagepaq: PAGE("@i18n 'panier' 'ailleurs'\n@i18nPlaceholder wait"), enfantpaq: ENFANT } })
      const b = banc(p)
      b.retient(['fr/panier', 'fr/ailleurs'])
      p.monte('pagepaq')
      await attendre()
      const demandes = b.fragments().map(dernier).sort()
      assert.deepEqual(demandes, [table(p, 'fr').ailleurs, table(p, 'fr').panier].sort(), 'les deux paquets sont déjà en route, aucun n\'a répondu')
      b.ouvre()
    })

    it(`${env} : l'attente du module attend TOUS ses paquets (mode wait) : masqué, gelé, puis montré d'un coup`, async () => {
      const p = await projet({ prod, sources: { pagepaq: PAGE("@i18n 'panier' 'ailleurs'\n@i18nPlaceholder wait"), enfantpaq: ENFANT } })
      const b = banc(p)
      b.retient(['fr/ailleurs'])
      const el = p.monte('pagepaq')
      await attendre(120)
      assert.equal(b.fragments().length, 2, 'les deux paquets sont demandés, le second est retenu')
      assert.equal(el.hasAttribute('mjs-loading'), true, 'caché tant qu\'un paquet manque')
      assert.equal(lire(el), '', 'gelé : aucun texte rendu, même celui du paquet déjà là')
      assert.equal(lire(el, 'p.n'), '', 'gelé : rien rendu du tout')
      b.ouvre()
      await attendre(150)
      assert.equal(el.hasAttribute('mjs-loading'), false, 'montré une fois tous les paquets arrivés')
      assert.equal(lire(el), 'Résumé du panier')
      assert.equal(lire(el, 'p.n'), '7')
    })

    it(`${env} : la section écrite en premier arrive après la seconde : même attente`, async () => {
      const p = await projet({ prod, sources: { pagepaq: PAGE("@i18n 'panier' 'ailleurs'\n@i18nPlaceholder wait"), enfantpaq: ENFANT } })
      const b = banc(p)
      b.retient(['fr/panier'])
      const el = p.monte('pagepaq')
      await attendre(120)
      assert.equal(el.hasAttribute('mjs-loading'), true)
      assert.equal(lire(el), '')
      b.ouvre()
      await attendre(150)
      assert.equal(el.hasAttribute('mjs-loading'), false)
      assert.equal(lire(el), 'Résumé du panier')
    })

    it(`${env} : un enfant qui déclare l'un des paquets le trouve déjà chargé — aucune requête de plus, rendu sans seconde attente`, async () => {
      const p = await projet({ prod, sources: { pagepaq: PAGE("@i18n 'panier' 'ailleurs'\n@i18nPlaceholder wait"), enfantpaq: ENFANT } })
      const b = banc(p)
      b.retient(['fr/panier', 'fr/ailleurs'])
      const el = p.monte('pagepaq')
      await attendre()
      assertAbsent(el._shadow.querySelector('mjs-enfantpaq'), 'la page est gelée : l\'enfant n\'existe pas encore')
      b.ouvre()
      await attendre(150)
      const enfant = el._shadow.querySelector('mjs-enfantpaq')
      assert.ok(enfant, 'l\'enfant est créé au rendu de la page')
      assert.equal(b.fragments().length, 2, 'aucune requête pour l\'enfant : son paquet était déjà là')
      assert.equal(enfant.hasAttribute('mjs-loading'), false, 'montré')
      assert.equal(!enfant._mjs_i18n_hold, true, 'jamais gelé')
      assert.equal(lire(enfant, 'p.u'), 'Autre résumé')
      assert.equal(lire(enfant, 'p.m'), '9')
    })

    it(`${env} : mode wait demandé par la config seule, la directive à plusieurs paquets suffit à attendre les deux`, async () => {
      const p = await projet({ prod, i18n: { placeholder: 'wait' }, sources: { pagepaq: PAGE("@i18n 'panier' 'ailleurs'"), enfantpaq: ENFANT } })
      const b = banc(p)
      b.retient(['fr/ailleurs'])
      const el = p.monte('pagepaq')
      await attendre(120)
      assert.equal(el.hasAttribute('mjs-loading'), true)
      b.ouvre()
      await attendre(150)
      assert.equal(el.hasAttribute('mjs-loading'), false)
      assert.equal(lire(el), 'Résumé du panier')
    })

    it(`${env} : mode *skeleton : rien n'est caché, chaque texte paraît à l'arrivée de son paquet`, async () => {
      const p = await projet({ prod, sources: { pagepaq: PAGE("@i18n 'panier' 'ailleurs'\n@i18nPlaceholder *skeleton"), enfantpaq: ENFANT } })
      const b = banc(p)
      b.retient(['fr/ailleurs'])
      const el = p.monte('pagepaq')
      await attendre(120)
      assert.equal(el.hasAttribute('mjs-loading'), false, '*skeleton : rendu tout de suite')
      assert.equal(lire(el), 'Résumé du panier', 'le texte du paquet arrivé est déjà là')
      assert.equal(lire(el, 'p.n'), '7')
      const enfant = el._shadow.querySelector('mjs-enfantpaq')
      assert.equal(lire(enfant, 'p.u'), prod ? '' : '⟦ailleurs.resume⟧', 'le paquet en route : le repère du mode')
      b.ouvre()
      await attendre(150)
      assert.equal(lire(enfant, 'p.u'), 'Autre résumé')
      assert.equal(b.fragments().length, 2)
    })

    // un module qui lit une clé de l'un de SES paquets, encore en route, ne prévient pas les autres modules à l'arrivée : seuls les
    // modules qui lisent une section qu'ils ne déclarent pas se rendent à nouveau (une vague par section), jamais ceux d'à côté
    it(`${env} : mode *skeleton : la lecture d'un paquet en plus, encore en route, ne fait pas rendre une seconde fois les autres modules à son arrivée`, async () => {
      const p = await projet({ prod, sources: {
        ma: ["@i18n 'ailleurs' 'panier'", '@i18nPlaceholder *skeleton', "<p class=\"t\">{µt('seul_fr')}</p>"].join('\n'),
        mu: ['@i18nPlaceholder *skeleton', "<p class=\"u\">{µt('/titre')}</p>"].join('\n'),
      } })
      for (let i = 0; i < 3; i++) p.monte('mu')
      await attendre(150)
      const etrangers = [...p.document.body.querySelectorAll('mjs-mu')]
      assert.equal(etrangers.length, 3)
      for (const e of etrangers) assert.equal(lire(e, 'p.u'), 'Bienvenue', 'les modules étrangers sont rendus avant la page')
      let lectures = 0
      const lire0 = p.window.µ.t
      p.window.µ.t = (cle: string, ...reste: unknown[]) => { if (cle === 'titre') lectures++; return lire0(cle, ...reste) }
      const b = banc(p)
      b.retient(['fr/panier'])
      const el = p.monte('ma')
      await attendre(120)
      lectures = 0
      b.ouvre()
      await attendre(200)
      assert.equal(lire(el), 'Seulement en français', 'le texte du paquet en plus paraît à son arrivée')
      assert.equal(lectures, 0, 'aucun module étranger ne se rend à nouveau : le paquet est celui du module qui le lit')
    })

    it(`${env} : la lecture d'une clé relative cherche dans les paquets dans l'ordre écrit ; une clé absente de tous donne le repère du premier`, async () => {
      const sources = {
        premier: ["@i18n 'panier' 'ailleurs'", "<p class=\"a\">{µt('resume')}</p>", "<p class=\"b\">{µt('seul_fr')}</p>", "<p class=\"c\">{µt('inconnue')}</p>", "<p class=\"d\">{µt('/nav.fermer')}</p>"].join('\n'),
        inverse: ["@i18n 'ailleurs' 'panier'", "<p class=\"a\">{µt('resume')}</p>", "<p class=\"b\">{µt('seul_fr')}</p>", "<p class=\"c\">{µt('inconnue')}</p>"].join('\n'),
      }
      const p = await projet({ prod, sources })
      const un = p.monte('premier')
      const deux = p.monte('inverse')
      await attendre(150)
      assert.equal(lire(un, 'p.a'), 'Résumé du panier', 'la clé est dans les deux paquets : le premier écrit gagne')
      assert.equal(lire(deux, 'p.a'), 'Autre résumé', 'ordre inversé : l\'autre gagne')
      assert.equal(lire(un, 'p.b'), 'Seulement en français', 'clé portée par le seul paquet panier')
      assert.equal(lire(deux, 'p.b'), 'Seulement en français', 'trouvée dans le second paquet quand le premier ne la porte pas')
      assert.equal(lire(un, 'p.c'), prod ? '' : '⟦panier.inconnue⟧', 'absente de tous : le repère nomme le premier paquet')
      assert.equal(lire(deux, 'p.c'), prod ? '' : '⟦ailleurs.inconnue⟧')
      assert.equal(lire(un, 'p.d'), 'Fermer', 'chemin absolu : racine, jamais cherché dans les paquets')
    })

    it(`${env} : bascule de langue : tous les paquets du module sont rechargés dans la nouvelle langue, les textes changent d'un coup`, async () => {
      const p = await projet({ prod, sources: { pagepaq: PAGE("@i18n 'panier' 'ailleurs'\n@i18nPlaceholder wait"), enfantpaq: ENFANT } })
      const b = banc(p)
      const el = p.monte('pagepaq')
      await attendre(150)
      const enfant = el._shadow.querySelector('mjs-enfantpaq')
      assert.equal(lire(el), 'Résumé du panier')
      assert.equal(lire(enfant, 'p.u'), 'Autre résumé')
      const avant = b.fragments().length
      b.retient(['en/panier', 'en/ailleurs'])
      p.window.µ.store.__mjsLang = 'en'
      await attendre(100)
      const demandes = b.fragments().slice(avant).map((u: string) => u.split('/').slice(-2).join('/')).sort()
      assert.deepEqual(demandes, [`en/${table(p, 'en').ailleurs}.json`, `en/${table(p, 'en').panier}.json`].sort(), 'les deux paquets en anglais sont demandés ensemble')
      assert.equal(lire(el), 'Résumé du panier', 'tant que la langue cible n\'est pas complète, l\'ancienne reste affichée')
      assert.equal(lire(enfant, 'p.u'), 'Autre résumé')
      b.ouvre()
      await attendre(150)
      assert.equal(lire(el), 'Cart summary')
      assert.equal(lire(enfant, 'p.u'), 'Other summary')
    })

    it(`${env} : un paquet qui échoue (404) : l'erreur est criée comme avant, le module se rend avec ce qu'il a, sans rester caché`, async () => {
      const erreurs: string[] = []
      const p = await projet({ prod, retardFragments: 30, fragmentsEnEchec: ['ailleurs'], sources: { pagepaq: PAGE("@i18n 'panier' 'ailleurs'\n@i18nPlaceholder wait"), enfantpaq: ENFANT } })
      p.window.µ.error = (...a: unknown[]) => { erreurs.push(String(a[0])) }
      const el = p.monte('pagepaq')
      await attendre(300)
      assert.equal(el.hasAttribute('mjs-loading'), false, 'la panne lève la retenue avec le gel')
      assert.equal(lire(el), 'Résumé du panier', 'le paquet arrivé sert')
      assert.equal(lire(el, 'p.n'), '7')
      assert.equal(erreurs.filter((e) => /ailleurs/.test(e)).length >= 1, true, 'l\'échec est signalé')
      const enfant = el._shadow.querySelector('mjs-enfantpaq')
      assert.equal(lire(enfant, 'p.u'), prod ? '' : '⟦ailleurs.resume⟧', 'l\'enfant rend le repère de son paquet absent')
    })

    it(`${env} : graine du rendu serveur complète : aucune requête, rien de gelé ; graine à un seul paquet : une requête, pour l'autre`, async () => {
      const complete = await projet({ prod, graine: { lang: 'fr', sections: { fr: ['panier', 'ailleurs'] } }, sources: { pagepaq: PAGE("@i18n 'panier' 'ailleurs'\n@i18nPlaceholder wait"), enfantpaq: ENFANT } })
      const bc = banc(complete)
      const el = complete.monte('pagepaq')
      await attendre()
      assert.equal(bc.fragments().length, 0, 'tout est dans la graine')
      assert.equal(el.hasAttribute('mjs-loading'), false)
      assert.equal(lire(el), 'Résumé du panier')
      const moitie = await projet({ prod, graine: { lang: 'fr', sections: { fr: ['panier'] } }, sources: { pagepaq: PAGE("@i18n 'panier' 'ailleurs'\n@i18nPlaceholder wait"), enfantpaq: ENFANT } })
      const bm = banc(moitie)
      bm.retient(['fr/ailleurs'])
      const el2 = moitie.monte('pagepaq')
      await attendre(100)
      assert.deepEqual(bm.fragments().map(dernier), [table(moitie, 'fr').ailleurs], 'seul le paquet absent de la graine est demandé')
      assert.equal(el2.hasAttribute('mjs-loading'), true, 'le module attend celui-là')
      bm.ouvre()
      await attendre(150)
      assert.equal(el2.hasAttribute('mjs-loading'), false)
      assert.equal(lire(el2), 'Résumé du panier')
    })
  }

  it('un paquet qui n\'existe pas : même comportement qu\'avec une seule section inconnue — aucune requête, aucune erreur, le repère de la clé', async () => {
    const erreurs: string[] = []
    const p = await projet({ sources: {
      seule: ["@i18n 'nexistepas'", '@i18nPlaceholder wait', "<p class=\"t\">{µt('resume')}</p>"].join('\n'),
      double: ["@i18n 'panier' 'nexistepas'", '@i18nPlaceholder wait', "<p class=\"t\">{µt('resume')}</p>", "<p class=\"u\">{µt('autre')}</p>"].join('\n'),
    } })
    p.window.µ.error = (...a: unknown[]) => { erreurs.push(String(a[0])) }
    const b = banc(p)
    const seule = p.monte('seule')
    await attendre(120)
    assert.deepEqual(b.fragments(), [], 'une section inconnue ne demande rien')
    assert.equal(seule.hasAttribute('mjs-loading'), false, 'rien à attendre : jamais caché pour toujours')
    assert.equal(lire(seule), '⟦nexistepas.resume⟧')
    const double = p.monte('double')
    await attendre(150)
    assert.deepEqual(b.fragments().map(dernier), [table(p, 'fr').panier], 'seul le paquet connu est demandé')
    assert.equal(double.hasAttribute('mjs-loading'), false)
    assert.equal(lire(double), 'Résumé du panier', 'le paquet connu sert')
    assert.equal(lire(double, 'p.u'), '⟦panier.autre⟧', 'la clé absente de tous donne le repère du premier')
    assert.deepEqual(erreurs, [], 'aucune erreur de plus que pour une section inconnue seule')
  })

  it('signal de construction : seul un module à plusieurs paquets le pose', async () => {
    const multi = (await transpile("@i18n 'a' 'b'\n<p>{µt('x')}</p>", { moduleName: 'mjs-signal-multi' })).output
    const seul  = (await transpile("@i18n 'a'\n<p>{µt('x')}</p>", { moduleName: 'mjs-signal-seul' })).output
    const rien  = (await transpile('<p>{1 + 1}</p>', { moduleName: 'mjs-signal-rien' })).output
    const signal = features.I18N_PAQUETS
    assert.equal(typeof signal, 'string', 'le signal est publié par le module des signaux')
    assert.equal(features.scanCompiledFeatures(multi).has(signal), true)
    assert.equal(features.scanCompiledFeatures(seul).has(signal), false)
    assert.equal(features.scanCompiledFeatures(rien).has(signal), false)
  })

  it('le cœur construit ne porte le code des paquets multiples que si un module en écrit', async () => {
    const sans = await projet({ sources: { pagepaq: PAGE("@i18n 'panier'"), enfantpaq: ENFANT } })
    const avec = await projet({ sources: { pagepaq: PAGE("@i18n 'panier' 'ailleurs'"), enfantpaq: ENFANT } })
    const coeur = (p: any) => readFileSync(join(p.outDir, readdirSync(p.outDir).find((f: string) => /^mjs_core-/.test(f))!), 'utf-8')
    assert.equal(coeur(sans).includes('i18n-paquets'), false, 'aucun module à plusieurs paquets : le bloc est retiré du cœur')
    assert.equal(coeur(avec).includes('i18n-paquets'), true, 'un module à plusieurs paquets : le bloc est dans le cœur')
  })
})

describe('plusieurs paquets par module — rendu serveur', function () {
  this.timeout(90000)
  after(async () => { await terminateSharedWorkerPool() })

  function appli(nom: string): string {
    const root = mjsTmp(nom)
    const srcDir = join(root, 'app')
    mkdirSync(join(srcDir, 'i18n', 'fr'), { recursive: true })
    mkdirSync(join(srcDir, 'i18n', 'en'), { recursive: true })
    writeFileSync(join(srcDir, 'i18n', 'fr.yml'), 'titre: Bienvenue\n')
    writeFileSync(join(srcDir, 'i18n', 'en.json'), JSON.stringify({ titre: 'Welcome' }))
    writeFileSync(join(srcDir, 'i18n', 'fr', 'panier.yml'), 'resume: Résumé du panier\n')
    writeFileSync(join(srcDir, 'i18n', 'en', 'panier.json'), JSON.stringify({ resume: 'Cart summary' }))
    writeFileSync(join(srcDir, 'i18n', 'fr', 'ailleurs.yml'), 'resume: Autre résumé\n')
    writeFileSync(join(srcDir, 'i18n', 'en', 'ailleurs.json'), JSON.stringify({ resume: 'Other summary' }))
    writeFileSync(join(srcDir, 'ssrpaq.mjs'), PAGE("@i18n 'panier' 'ailleurs'"))
    writeFileSync(join(srcDir, 'enfantpaq.mjs'), ENFANT)
    return srcDir
  }

  it('les paquets en plus sont lus sur le disque et semés dans la page, même quand la page ne lit que ses propres clés', async () => {
    const srcDir = appli('i18n-paquets-ssr')
    // une page qui ne lit que son premier paquet : le second n'est demandé que par la directive
    writeFileSync(join(srcDir, 'ssrseul.mjs'), ["@i18n 'panier' 'ailleurs'", "<p class=\"t\">{µt('resume')}</p>"].join('\n'))
    const res = await renderToString({ sourceDir: srcDir, tag: 'mjs-ssrseul', i18n: { default: 'fr' } })
    assert.match(res.html, /Résumé du panier/)
    const m = (res.sharedScript ?? '').match(/id="__mjs_i18n">([\s\S]*?)<\/script>/)
    assert.ok(m, `graine introuvable : ${res.sharedScript}`)
    const graine = JSON.parse(m![1])
    assert.deepEqual(Object.keys(graine.sections.fr).sort(), ['ailleurs', 'panier'], 'les deux paquets sont semés')
    assert.equal(graine.sections.fr.ailleurs.resume, 'Autre résumé')
  })

  it('page et enfant aux paquets distincts : tous les textes sortent au premier rendu serveur, dans la langue demandée', async () => {
    const srcDir = appli('i18n-paquets-ssr-enfant')
    const fr = await renderToString({ sourceDir: srcDir, tag: 'mjs-ssrpaq', i18n: { default: 'fr' } })
    assert.match(fr.html, /Résumé du panier/)
    assert.match(fr.html, /Autre résumé/)
    assert.doesNotMatch(fr.html, /⟦/)
    const en = await renderToString({ sourceDir: srcDir, tag: 'mjs-ssrpaq', i18n: { default: 'fr' }, store: { __mjsLang: 'en' } })
    assert.match(en.html, /Cart summary/)
    assert.match(en.html, /Other summary/)
    assert.doesNotMatch(en.html, /⟦/)
    const graine = JSON.parse((en.sharedScript ?? '').match(/id="__mjs_i18n">([\s\S]*?)<\/script>/)![1])
    assert.equal(graine.lang, 'en')
    assert.deepEqual(Object.keys(graine.sections.en).sort(), ['ailleurs', 'panier'])
  })
})
