// Page qui démarre dans une autre langue que la langue par défaut (`?lang=en`, défaut `fr`, `urlParam`), sans rendu serveur : les fichiers
// des deux langues arrivent après le dessin, dans un ordre ou dans l'autre (`µ._i18nImport`). Un libellé du framework écrit pendant
// l'attente dans un affichage qui dure (un toast, `µ._mjs_labelKeep`) et celui qu'un module cœur lit pendant l'attente suivent la langue
// VOULUE : le libellé anglais du framework pendant l'attente, puis la surcharge anglaise du projet à l'arrivée du fichier anglais. Avant, la
// recherche se faisait dans la langue par défaut et l'arrivée de n'importe quel fichier vidait la liste des lecteurs : le toast gardait
// « Succès » ou prenait la surcharge française, jamais l'anglaise. L'arrivée du fichier français (pas la langue voulue) ne récrit rien, ni
// celle d'un fichier anglais qui ne surcharge pas le groupe lu. Les lecteurs d'une langue partent quand son fichier est servi ou qu'il
// échoue (au démarrage comme à une bascule) : une arrivée plus tardive de ce fichier ne récrit plus rien. Vrais mjs_init, magasin et
// mjs_i18n, dans happy-dom.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Window } from 'happy-dom'
import { RUNTIME_LABELS } from '../src/runtime-labels.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const source    = (f: string) => readFileSync(join(__dirname, '..', 'src', 'runtime', f), 'utf-8')
const sansEsm   = (s: string) => s.replace(/^\s*import\s+[^;]+;\s*$/gm, '').replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
const INIT      = sansEsm(source('mjs_init.ts'))
const STORE     = source('mjs_store_globals.ts')
const I18N      = source('mjs_i18n.ts')

const FR = (RUNTIME_LABELS as any).fr
const EN = (RUNTIME_LABELS as any).en

type Fichier = { root: Record<string, unknown>, sections: Record<string, string> }
const fichier   = (toast?: string, core?: string): Fichier => ({ root: { titre: 'x', mjs: { ...(toast ? { toast: { success: toast } } : {}), ...(core ? { core: { chartEmpty: core } } : {}) } }, sections: {} })
const SURCHARGE = { fr: fichier('PROJET-fr-succes', 'PROJET-fr-vide'), en: fichier('PROJET-en-succes', 'PROJET-en-vide'), de: fichier('PROJET-de-succes', 'PROJET-de-vide') }

// la page `?lang=en` : mjs_init, le magasin, les réglages du manifeste, puis mjs_i18n ; chaque fichier de langue attend `servir[langue]()`, et les
// `echecs[langue]` premiers chargements d'une langue échouent
function monter(fichiers: Record<string, Fichier>, echecs: Record<string, number> = {}) {
  const window: any = new Window({ url: 'http://localhost/?lang=en' })
  window.eval(INIT + '\nglobalThis.µ = µ;')
  const µ = window.µ
  µ.error = () => {}
  // le magasin ne lit de l'état réactif que la fabrique (`µ.state`), posée par le cœur complet
  if (typeof µ.state !== 'function') µ.state = (o: any) => o
  window.eval(STORE)
  µ._runtimeLabels     = RUNTIME_LABELS
  µ._runtimeLabelsLang = 'fr'
  µ._i18nData          = { dev: false, default: 'fr', placeholder: 'wait', persist: false, detect: false, urlParam: true, prefix: '/i18n', langs: Object.keys(fichiers), files: Object.fromEntries(Object.keys(fichiers).map((l) => [l, '/' + l + '.js'])) }
  const servir: Record<string, () => void> = {}
  const charges: string[] = []
  µ._i18nImport = (url: string) => {
    const lang = url.slice(1, -3)
    charges.push(lang)
    return new Promise((resolve, reject) => {
      servir[lang] = () => { if ((echecs[lang] ?? 0) > 0) { echecs[lang]--; reject(new Error('réseau coupé')) } else resolve({ default: fichiers[lang] }) }
    })
  }
  window.eval(I18N)
  return { µ, servir, charges }
}

const attendre = (): Promise<void> => new Promise((r) => setTimeout(r, 10))

// un toast affiché : son titre écrit par `µ._mjs_labelKeep`, chaque écriture relevée
function toast(µ: any): string[] {
  const vus: string[] = []
  µ._mjs_labelKeep(() => { vus.push(µ._mjs_label('toast', 'success')) })
  return vus
}

// un module cœur (doublure) qui lit son libellé à chaque rendu ; un rendu demandé (`_mjs_invalidate`) se fait à la microtâche suivante
function coeur(µ: any): { vus: string[], rendus: number } {
  const c: any = { vus: [], rendus: 0, isConnected: true }
  const rendre = () => {
    µ.activeComponent = c
    try { c.vus.push(µ._mjs_label('core', 'chartEmpty')) }
    finally { µ.activeComponent = null }
  }
  c._mjs_invalidate = () => { c.rendus++; queueMicrotask(rendre) }
  rendre()
  return c
}

describe('libellés du framework et du cœur : page démarrée dans une autre langue que la langue par défaut (?lang=en), surcharge du projet', function () {
  for (const ordre of [['en', 'fr'], ['fr', 'en']]) {
    it(`fichier ${ordre[0] === 'en' ? 'anglais' : 'français'} d'abord : pendant l'attente le libellé anglais du framework, la surcharge anglaise à l'arrivée du fichier anglais, rien à celle du français`, async function () {
      const { µ, servir } = monter({ fr: SURCHARGE.fr, en: SURCHARGE.en })
      const titres = toast(µ)
      const module = coeur(µ)
      assert.deepEqual(titres, [EN.toast.success], 'le toast tiré pendant l\'attente : le libellé anglais du framework')
      assert.deepEqual(module.vus, [EN.core.chartEmpty], 'le module cœur dessiné pendant l\'attente : le libellé anglais du framework')
      for (const l of ordre) {
        servir[l]()
        await attendre()
        const servi = ordre.indexOf('en') <= ordre.indexOf(l)
        assert.deepEqual(titres, servi ? [EN.toast.success, 'PROJET-en-succes'] : [EN.toast.success], `toast, à l'arrivée du fichier « ${l} »`)
        assert.equal(module.rendus, servi ? 1 : 0, `rendus du module cœur, à l'arrivée du fichier « ${l} »`)
        assert.equal(module.vus[module.vus.length - 1], servi ? 'PROJET-en-vide' : EN.core.chartEmpty, `module cœur, à l'arrivée du fichier « ${l} »`)
      }
      assert.equal(µ._mjs_i18nBooted, true, 'démarré')
      assert.equal(µ._mjs_storeRaw.__mjsLang, 'en')
      assert.equal(µ._mjs_label('toast', 'success'), 'PROJET-en-succes', 'un toast tiré après le démarrage')
      assert.ok(!titres.includes('PROJET-fr-succes') && !titres.includes(FR.toast.success), 'jamais le français')
    })
  }

  it('fichier anglais sans surcharge du toast ni du cœur : le libellé anglais du framework reste, aucune arrivée ne récrit', async function () {
    const { µ, servir } = monter({ fr: SURCHARGE.fr, en: fichier() })
    const titres = toast(µ)
    const module = coeur(µ)
    servir.fr()
    await attendre()
    servir.en()
    await attendre()
    assert.equal(µ._mjs_i18nBooted, true, 'démarré')
    assert.deepEqual(titres, [EN.toast.success])
    assert.deepEqual(module.vus, [EN.core.chartEmpty])
    assert.equal(module.rendus, 0)
  })

  it('pas de fuite : la langue voulue servie, une nouvelle arrivée de son fichier ne récrit plus rien', async function () {
    const { µ, servir } = monter({ fr: SURCHARGE.fr, en: SURCHARGE.en })
    const titres = toast(µ)
    const module = coeur(µ)
    servir.en()
    servir.fr()
    await attendre()
    µ._i18nLang('en', fichier('PROJET-en-encore', 'PROJET-en-encore'))
    await attendre()
    assert.deepEqual(titres, [EN.toast.success, 'PROJET-en-succes'])
    assert.equal(module.rendus, 1)
  })

  it('pas de fuite : le fichier anglais en échec au démarrage, rechargé plus tard à une bascule, ne récrit pas ce qui l\'attendait', async function () {
    const { µ, servir, charges } = monter({ fr: SURCHARGE.fr, en: SURCHARGE.en }, { en: 1 })
    const titres = toast(µ)
    const module = coeur(µ)
    servir.en()
    servir.fr()
    await attendre()
    assert.equal(µ._mjs_i18nBooted, true, 'le démarrage ne gèle pas')
    µ._storeSet('__mjsLang', 'fr')
    await attendre()
    µ._storeSet('__mjsLang', 'en')
    await attendre()
    servir.en()
    await attendre()
    assert.deepEqual(charges.filter((c) => c === 'en').length, 2, 'le fichier anglais est redemandé')
    assert.equal(µ._mjs_label('toast', 'success'), 'PROJET-en-succes', 'la bascule aboutit')
    assert.deepEqual(titres, [EN.toast.success])
    assert.equal(module.rendus, 0)
  })

  it('pas de fuite : un fichier en échec pendant une bascule, la bascule rejouée plus tard ne récrit pas le toast tiré pendant la première', async function () {
    const { µ, servir } = monter({ fr: SURCHARGE.fr, en: SURCHARGE.en, de: SURCHARGE.de }, { de: 1 })
    servir.en()
    servir.fr()
    await attendre()
    µ._storeSet('__mjsLang', 'de')
    const titres = toast(µ)
    servir.de()
    await attendre()
    assert.equal(µ._mjs_storeRaw.__mjsLang, 'en', 'bascule annulée')
    µ._storeSet('__mjsLang', 'de')
    await attendre()
    servir.de()
    await attendre()
    assert.equal(µ._mjs_label('toast', 'success'), 'PROJET-de-succes', 'la bascule rejouée aboutit')
    assert.equal(titres.length, 1, 'le toast de la première bascule n\'est pas récrit : ' + titres.join(' / '))
  })
})
