// La graine de traduction du document reçu est relue à chaque échange de page — pourquoi ce test existe.
//
// Le HTML prérendu d'une page porte une graine `<script id="__mjs_i18n">` : les sections de
// traduction dont la page a besoin. Elle n'était lue qu'UNE fois, au chargement du module i18n.
// Défaut d'origine : à l'arrivée par un lien interne (échange du contenu par UJS, sans rechargement),
// la graine du HTML reçu était ignorée et chaque section était redemandée par requête
// (`i18n/<langue>/<nom>.json`), niveau par niveau à mesure que les composants se montaient. Coût
// mesuré dans Chromium sur le build de production du site : doc 4 requêtes, accueil 14.
//
// Ce que le test garde : `µ._mjs_navI18nSeed(doc)` sème le cache des sections avec la graine du
// document REÇU (même fonction que la lecture du démarrage), appelée par UJS à chacun des quatre
// sites d'échange (clic, soumission, retour arrière rechargé du réseau, rafraîchissement de fond)
// juste avant l'application de la tête, donc avant le montage des composants d'arrivée. Choix :
//   - graine absente ou JSON abîmé : aucun effet, jamais d'exception ;
//   - graine d'une autre langue que l'affichée : rangée sous SA langue, le cache de la langue
//     affichée n'est pas touché, la bascule vers cette langue n'a plus rien à télécharger ;
//   - section déjà au cache : jamais remplacée (sa donnée sert des composants affichés ; une graine
//     d'un autre déploiement, onglet resté ouvert, ne mêle pas deux versions de textes en session) ;
//     une section absente du cache est semée, même venue d'un autre déploiement ;
//   - noms du prototype (`__proto__`, `constructor`) et données qui ne sont pas des objets :
//     ignorés, `Object.prototype` reste propre.
// Le parcours réel dans Chromium : i18n-graine-relue-a-la-navigation-browser.test.ts.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { projet } from './helpers/i18n-rendu-projet.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const UJS_SRC = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_ujs.ts'), 'utf-8')
const attendre = (ms = 80) => new Promise((r) => setTimeout(r, ms))

const PANIER = ["@i18n 'panier'", '<p class="t">{µt(\'resume\')}</p>'].join('\n')
const AILLEURS = ["@i18n 'ailleurs'", '<p class="t">{µt(\'resume\')}</p>'].join('\n')
const graine = (json: string) => `<script type="application/json" id="__mjs_i18n">${json}</script>`
const recu = (win: any, corps: string) => new win.DOMParser().parseFromString(`<html><head></head><body>${corps}</body></html>`, 'text/html')

// démarre l'appli sur une page SANS graine (arrivée par une page qui n'en a pas besoin)
async function demarre() {
  const p = await projet({ sources: { vue: PANIER, ailleurs: AILLEURS } })
  p.monte('vue')
  await attendre()
  p.requetes.length = 0
  return p
}

describe('graine de traduction du document reçu — relue à chaque échange de page', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('graine valide : la section arrive dans le cache, le composant d\'arrivée s\'affiche juste sans aucune requête', async () => {
    const p = await demarre()
    const doc = recu(p.window, graine('{"lang":"fr","sections":{"fr":{"ailleurs":{"resume":"Texte venu de la graine"}}}}'))
    p.window.µ._mjs_navI18nSeed(doc)
    const el = p.monte('ailleurs')
    await attendre()
    assert.equal(el._shadow.querySelector('p.t').textContent.trim(), 'Texte venu de la graine')
    assert.deepEqual(p.requetes, [], 'aucune requête de section')
  })

  it('sans la graine (contre-épreuve) : la même section est demandée par une requête', async () => {
    const p = await demarre()
    const el = p.monte('ailleurs')
    await attendre()
    assert.equal(el._shadow.querySelector('p.t').textContent.trim(), 'Autre résumé')
    assert.equal(p.requetes.length, 1)
  })

  it('graine absente du document reçu : aucun effet, aucune exception', async () => {
    const p = await demarre()
    assert.doesNotThrow(() => p.window.µ._mjs_navI18nSeed(recu(p.window, '<p>rien</p>')))
    assert.doesNotThrow(() => p.window.µ._mjs_navI18nSeed(null))
    assert.equal(p.window.µ._i18nCache.size, 1, 'seule la section de départ est au cache')
  })

  for (const [nom, json] of [
    ['JSON abîmé', '{"lang":"fr","sections":{'],
    ['JSON qui n\'est pas un objet', '42'],
    ['sections absentes', '{"lang":"fr"}'],
    ['langue qui n\'est pas une chaîne', '{"lang":3,"sections":{"fr":{"ailleurs":{"resume":"x"}}}}'],
    ['sections d\'une langue qui ne sont pas un objet', '{"lang":"fr","sections":{"fr":"x"}}'],
    ['donnée de section nulle', '{"lang":"fr","sections":{"fr":{"ailleurs":null}}}'],
    ['donnée de section qui est une chaîne', '{"lang":"fr","sections":{"fr":{"ailleurs":"x"}}}']
  ]) {
    it(`graine mal formée (${nom}) : aucun effet, aucune exception`, async () => {
      const p = await demarre()
      assert.doesNotThrow(() => p.window.µ._mjs_navI18nSeed(recu(p.window, graine(json))))
      assert.equal(p.window.µ._i18nCache.has('fr/ailleurs'), false, 'rien de semé')
      const el = p.monte('ailleurs')
      await attendre()
      assert.equal(el._shadow.querySelector('p.t').textContent.trim(), 'Autre résumé', 'la section se télécharge comme avant')
    })
  }

  it('graine d\'une autre langue que l\'affichée : rangée sous sa langue, le cache de la langue affichée reste intact', async () => {
    const p = await demarre()
    const doc = recu(p.window, graine('{"lang":"en","sections":{"en":{"ailleurs":{"resume":"Seed text"}}}}'))
    p.window.µ._mjs_navI18nSeed(doc)
    assert.equal(p.window.µ._i18nCache.has('en/ailleurs'), true, 'rangée sous en')
    assert.equal(p.window.µ._i18nCache.has('fr/ailleurs'), false, 'la langue affichée (fr) n\'est pas polluée')
    const el = p.monte('ailleurs')
    await attendre()
    assert.equal(el._shadow.querySelector('p.t').textContent.trim(), 'Autre résumé', 'affichage en fr : le texte fr, téléchargé')
    p.requetes.length = 0
    p.window.µ.store.__mjsLang = 'en'
    await attendre(150)
    assert.equal(el._shadow.querySelector('p.t').textContent.trim(), 'Seed text', 'la bascule vers en sert la graine')
    assert.deepEqual(p.requetes.filter((u: string) => /\/en\/ailleurs/.test(u)), [], 'rien à télécharger pour en/ailleurs')
  })

  it('section déjà au cache : jamais remplacée (même graine plus récente, autre déploiement) ; une section absente du cache est semée', async () => {
    const p = await demarre()
    const doc = recu(p.window, graine('{"lang":"fr","sections":{"fr":{"panier":{"resume":"Version du nouveau déploiement"},"ailleurs":{"resume":"Nouvelle section"}}}}'))
    p.window.µ._mjs_navI18nSeed(doc)
    assert.equal(p.window.µ._mjs_i18nDictOf('fr').panier.resume, 'Résumé du panier', 'la section déjà là garde sa donnée')
    assert.equal(p.window.µ._i18nCache.get('fr/panier').data.resume, 'Résumé du panier')
    assert.equal(p.window.µ._mjs_i18nDictOf('fr').ailleurs.resume, 'Nouvelle section', 'la section absente est semée')
  })

  it('section dont la requête est en vol : la graine ne la remplace pas, la requête arrive et sert', async () => {
    const p = await projet({ sources: { vue: PANIER, ailleurs: AILLEURS } })
    p.monte('vue')
    await attendre()
    let ouvrir: () => void = () => {}
    const porte = new Promise<void>((r) => { ouvrir = r })
    const vrai = p.window.fetch
    p.window.fetch = async (u: string) => { await porte; return vrai(u) }
    const el = p.monte('ailleurs')
    await attendre()
    p.window.µ._mjs_navI18nSeed(recu(p.window, graine('{"lang":"fr","sections":{"fr":{"ailleurs":{"resume":"Graine tardive"}}}}')))
    ouvrir()
    await attendre()
    assert.equal(el._shadow.querySelector('p.t').textContent.trim(), 'Autre résumé')
  })

  it('noms du prototype et données hors objet : ignorés, Object.prototype reste propre', async () => {
    const p = await demarre()
    p.window.µ._mjs_navI18nSeed(recu(p.window, graine('{"lang":"fr","sections":{"__proto__":{"pollue":{"a":1}},"constructor":{"pollue":{"a":1}},"fr":{"__proto__":{"b":1},"constructor":{"c":1},"toString":{"d":1}}}}')))
    assert.equal(p.window.Object.prototype.pollue, undefined)
    assert.equal(({} as any).pollue, undefined)
    assert.equal(p.window.µ._i18nCache.has('constructor/pollue'), false)
    assert.equal(p.window.µ._i18nCache.has('fr/__proto__'), false)
    assert.equal(p.window.µ._i18nCache.has('fr/constructor'), false)
  })

  describe('branchement dans UJS', () => {
    const appels = [...UJS_SRC.matchAll(/\n\s*(if \(µ\._mjs_navI18nSeed\) \{ µ\._mjs_navI18nSeed\(doc\); \})\n\s*µ\._mjs_navPageFile\(doc\);\n\s*µ\._mjs_navApplyHead\(doc\);/g)]

    it('les quatre sites d\'échange appellent la graine juste avant le fichier de page (donc avant la tête), seulement si elle existe', () => {
      assert.equal(appels.length, 4, 'clic, soumission, retour arrière, rafraîchissement de fond')
      for (const m of appels) { assert.equal(m[1], 'if (µ._mjs_navI18nSeed) { µ._mjs_navI18nSeed(doc); }') }
      assert.equal((UJS_SRC.match(/_mjs_navI18nSeed\(doc\)/g) || []).length, 4, 'aucun appel ailleurs')
    })

    it('UJS ne dépend pas d\'i18n : la fonction n\'y est jamais définie', () => {
      assert.equal(/µ\._mjs_navI18nSeed\s*=/.test(UJS_SRC), false)
    })
  })
})
