// Une variable du script porte le nom que le compilateur donnait autrefois à l'une de ses variables locales (`node`, `k`, `v`,
// `t`, `td`, `arr`, `refs`, `updateFn`…) : le rendu est le même qu'avec un nom que le compilateur n'écrit pas jamais. Le code émis
// autour des liaisons, des attributs, des blocs et des gestionnaires garde ses variables sous un nom réservé (préfixe `_mjs`) ;
// ce qu'il fournit EXPRÈS à l'auteur ne change pas (`e` et `el` dans un gestionnaire d'événement).
// Chaque nom se joue dans un composant qui porte toutes les formes du gabarit où le code de l'auteur est évalué (cf.
// helpers/noms-internes-formes.ts), à la racine, dans une ligne de `{for}` et dans la branche d'un `{await}` ; le rendu, avant et après
// une frappe dans chaque contrôle, est comparé à celui d'un composant dont la variable s'appelle `zz`. Chromium réel, en développement
// et en production en un seul fichier (où un `const` caché par une écriture de l'auteur casse la compilation).

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'
import { composant, ENFANT, FORMES, JOUER, LIRE } from './helpers/noms-internes-formes.js'

const TEMOIN = 'zz'

// les noms que le compilateur déclarait, avec ou sans préfixe, dans le code qui entoure le code de l'auteur
const NOMS = [
  'node', 'e', 'el', 'k', 'v', 'a', 'o', 'p', 'i', 'n', 'val', 'arr', 'hasIdl', 'ro', 'entries', 'entry', 't', 'td', 'prev', 'curr', 'idx', 'f', 'nd',
  'matches', 't_cfg', 'in_cfg', 'out_cfg', '_setup', '_', 'ref', 'refs', 'updateFn', '_f', '_n0'
]

// ce que le contrat donne EXPRÈS au code de l'auteur : `e` et `el` dans un gestionnaire d'élément, `e` dans un écouteur de `<@window>`
const CONTRAT: Record<string, string[]> = { e: ['f-evt-', 'f-evo-', 'f-glo-'], el: ['f-evt-', 'f-evo-'] }

const balise = (nom: string): string => 'mjs-n-' + (nom === TEMOIN ? 'temoin' : NOMS.indexOf(nom))
const fichier = (nom: string): string => balise(nom).replace('mjs-', '') + '.mjs'

const SOURCES: Record<string, string> = { 'c-fils.mjs': ENFANT }
for (const nom of [TEMOIN, ...NOMS]) SOURCES[fichier(nom)] = composant(nom)
const BALISES = [TEMOIN, ...NOMS].map(balise)

const cibles = new Map<Mode, Promise<Cible>>()
const cible  = (mode: Mode) => {
  if (!cibles.has(mode)) cibles.set(mode, construire(mode, SOURCES, BALISES))
  return cibles.get(mode)!
}

type Rendu = { avant: Record<string, any>, apres: Record<string, any>, graves: string[] }

// le composant monté, puis chaque contrôle touché, le bouton de lecture pressé : le rendu avant et après
async function jouer(browser: any, mode: Mode, nom: string): Promise<Rendu> {
  const b = balise(nom)
  const o = await charger(browser, await cible(mode), b)
  try {
    await o.page.waitForFunction(`(() => { const h = document.querySelector('${b}'); return !!(h && h._shadow && h._shadow.querySelector('.f-ref-attente') && h._shadow.querySelector('.f-ref-boucle')) })()`, null, { timeout: 20000 })
    await o.page.waitForTimeout(400)
    // le nom d'un groupe de radios (`mjs-grp-…`) est écrit d'après le texte de la variable liée : le nom sous test n'y compte pas
    const neutre = (texte: string) => JSON.parse(texte.split('mjs-grp-' + nom.replace(/[^a-zA-Z0-9_]/g, '-') + '-').join('mjs-grp-NOM-'))
    const avant = neutre(await o.page.evaluate(LIRE.replace('BALISE', b)))
    await o.page.evaluate(JOUER.replace('BALISE', b))
    await o.page.evaluate(`window.dispatchEvent(new Event('noms-internes'))`)
    await o.page.waitForTimeout(300)
    await o.page.evaluate(`document.querySelector('${b}')._shadow.querySelector('.lire').click()`)
    await o.page.waitForTimeout(300)
    const apres = neutre(await o.page.evaluate(LIRE.replace('BALISE', b)))
    return { avant, apres, graves: graves(o) }
  } finally {
    await o.fermer()
  }
}

// les écarts entre deux rendus, une ligne chacun (forme, propriété, valeur attendue, valeur lue)
function ecarts(attendu: Record<string, any>, lu: Record<string, any>, quand: string): string[] {
  const sortie: string[] = []
  for (const cle of new Set([...Object.keys(attendu), ...Object.keys(lu)])) {
    if (JSON.stringify(attendu[cle]) !== JSON.stringify(lu[cle])) sortie.push(`${quand} ${cle} : attendu ${JSON.stringify(attendu[cle])}, lu ${JSON.stringify(lu[cle])}`)
  }
  return sortie
}

for (const mode of ['dev-parents-avant', 'bundle'] as const) describe(`variable de l'auteur portant un nom interne du compilateur (${mode}, Chromium réel)`, function () {
  this.timeout(300000)
  let browser: any = null
  let present = false
  let temoin: Promise<Rendu> | null = null

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright.chromium.executablePath())
    if (!present) { console.log('  ℹ️  chromium non installé, test des noms internes sauté. Activer : `npx playwright install chromium`'); return }
    browser = await playwright.chromium.launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('le composant se compile', async function () {
    if (!present) { this.skip(); return }
    await cible(mode)
  })

  it(`le témoin (variable nommée ${TEMOIN}) rend chaque forme sans erreur`, async function () {
    if (!present) { this.skip(); return }
    temoin = jouer(browser, mode, TEMOIN)
    const { avant, apres, graves: erreurs } = await temoin
    assert.deepEqual(erreurs, [], 'aucune erreur')
    for (const forme of FORMES) {
      for (const ctx of ['racine', 'boucle', 'attente'] as const) if (!forme.ctxs || forme.ctxs.includes(ctx)) assert.ok(apres[`f-${forme.id}-${ctx}`], `la forme ${forme.id} (${forme.titre}) est rendue dans le contexte ${ctx}`)
    }
    // quelques valeurs que le témoin doit montrer, pour qu'une égalité plus bas ne soit pas celle de deux rendus vides
    assert.match(apres['f-cls-racine'].classes, /\bon\b/)
    assert.equal(apres['f-ttl-boucle'].attrs.title, 'red')
    assert.equal(apres['f-txt-attente'].texte, 'red')
    assert.equal(apres['f-cmp-racine'].fils, 'red')
    assert.equal(apres['f-spr-boucle'].fils, 'sp')
    assert.equal(apres['f-att-attente'].att, 'oui')
    assert.equal(apres['f-inp-racine'].valeur, 'zz')
    assert.equal(apres['f-evo-g'].texte, 'red')
    assert.equal(apres['f-tro-g'].texte, 'red')
    assert.equal(avant['f-sel-racine'].valeur, 'b')
    assert.equal(avant['f-opn-attente'].ouvert, true)
    assert.equal(avant['f-mda-racine'].temps, 2)
    assert.match(apres.lu, /"<div>"/, 'la lecture des références (@this) montre un élément')
  })

  for (const nom of NOMS) it(`variable nommée ${nom} : même rendu que ${TEMOIN}, avant et après les frappes`, async function () {
    if (!present) { this.skip(); return }
    temoin ??= jouer(browser, mode, TEMOIN)
    const attendu = await temoin
    const lu      = await jouer(browser, mode, nom)
    const sauf    = CONTRAT[nom] ?? []
    const garde   = (rendu: Record<string, any>) => Object.fromEntries(Object.entries(rendu).filter(([cle]) => !sauf.some((s) => cle.startsWith(s))))
    const difference = [...ecarts(garde(attendu.avant), garde(lu.avant), 'avant'), ...ecarts(garde(attendu.apres), garde(lu.apres), 'après')]
    assert.equal(lu.graves.length, 0, 'aucune erreur : ' + lu.graves.join(' | '))
    assert.equal(difference.length, 0, `${difference.length} écart(s) avec le rendu du témoin :\n${difference.slice(0, 6).map((d) => d.slice(0, 400)).join('\n')}`)
  })
})
