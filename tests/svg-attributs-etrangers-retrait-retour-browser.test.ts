// un attribut étranger CALCULÉ d'un élément SVG (`xlink:href={$cible}`, `xml:lang={$langue}`) qui perd sa valeur (`null`, `undefined`, `false`) puis la retrouve garde son espace de noms :
// la mise à jour du runtime le retire par son nom (`removeAttribute`), puis le recrée par `setAttribute`, qui le pose SANS espace de noms ; un `<use xlink:href>` qui n'est plus dans celui de
// XLink n'est plus lu (`href.baseVal` vide, boîte 0 x 0, l'icône disparaît pour de bon), un `xml:lang` qui n'est plus dans celui de XML ne donne plus sa langue (`:lang(de)` faux).
// Cas courant : une icône dont le nom arrive après coup (`xlink:href={$icone}` qui DÉMARRE à `undefined`) n'apparaît jamais.
// Chaque contexte joue la même suite d'états : valeur, `null`, retour, `undefined`, retour (ou : `undefined` au départ, valeur, `null`, retour) ; à chaque pas on lit l'attribut dans son espace de noms
// (`getAttributeNS`), la liste de tous les attributs de l'élément avec leur espace de noms (aucun `xlink:href` sans espace de noms ne doit traîner), `href.baseVal`, la boîte rendue et `:lang()`.
// Les contextes : la racine du composant, un `{if}` posé dans un <svg>, un `{if}` de racine qui porte tout le dessin (retiré puis refait), une ligne de `{for}` (liste remplacée, avec et sans clé, puis
// ligne modifiée sur place) et la branche d'un `{await}` (refaite par une nouvelle promesse). Les écritures : `xlink:href={$x}`, `xlink:href="{$x}"` (accolades seules entre guillemets) et
// `xlink:href="#i-{$n}"` (chaîne à accolades, qui passe par une valeur vide), `xml:lang={$x}`.
// Le filtre de sécurité reste celui de la mise à jour : une adresse `javascript:` ou `data:text/html` est refusée (l'attribut garde sa valeur d'avant, ou reste absent), un attribut déjà retiré ne revient pas.
// Les trois modes : développement, production en fichiers séparés, production en un seul fichier. Chromium réel. Le code émis est aussi lu directement.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'

const XLINK = 'http://www.w3.org/1999/xlink'
const XML   = 'http://www.w3.org/XML/1998/namespace'

// l'état des variables : l'adresse de l'icône, la langue, la lettre de l'icône écrite en chaîne (`#i-a`) ; `undefined` et `null` retirent l'attribut
type Etat = { cible: string | null | undefined, langue: string | null | undefined, n: string }

const A:    Etat = { cible: '#a', langue: 'de', n: 'a' }
const B:    Etat = { cible: '#b', langue: 'en', n: 'b' }
const VIDE: Etat = { cible: null, langue: null, n: '' }
const RIEN: Etat = { cible: undefined, langue: undefined, n: '' }

// la valeur telle qu'on l'écrit dans le script du composant
const lit = (v: string | null | undefined): string => v === undefined ? 'undefined' : v === null ? 'null' : `'${v}'`

const SPRITE = '<svg class="sprite" width="0" height="0"><defs><rect id="a" width="20" height="20" fill="green"></rect><rect id="b" width="30" height="30" fill="blue"></rect><rect id="i-a" width="20" height="20" fill="green"></rect><rect id="i-b" width="30" height="30" fill="blue"></rect></defs></svg>'
const PRET   = '<i class="pret"></i>'

// les expressions des valeurs dans le gabarit : à la racine ce sont des variables du composant, dans une ligne de `{for}` des champs de la ligne
type Expr = { cible: string, langue: string, n: string }

const RACINE: Expr = { cible: '$cible',   langue: '$langue',   n: '$n' }
const LIGNE:  Expr = { cible: 'it.cible', langue: 'it.langue', n: 'it.n' }

// le contenu d'un <svg> : trois icônes (accolades sans guillemets, accolades entre guillemets, chaîne à accolades) et un groupe qui porte une langue
const contenu = (e: Expr) => `<use class="u" xlink:href={${e.cible}}></use>
    <use class="uq" xlink:href="{${e.cible}}"></use>
    <use class="uc" xlink:href="#i-{${e.n}}"></use>
    <g class="l" xml:lang={${e.langue}}><text x="0" y="50">x</text></g>`

const dessin = (e: Expr) => `<svg class="cadre" width="100" height="100">
    ${contenu(e)}
  </svg>`

// les variables du composant et les gestes qui les changent (la page appelle `vider()`, `valB()`…)
const variables = (depart: Etat) => `  $on     = true
  $cible  = ${lit(depart.cible)}
  $langue = ${lit(depart.langue)}
  $n      = ${lit(depart.n)}
  @valA = ->
    $cible  = '${A.cible}'
    $langue = '${A.langue}'
    $n      = '${A.n}'
  @valB = ->
    $cible  = '${B.cible}'
    $langue = '${B.langue}'
    $n      = '${B.n}'
  @vider = ->
    $cible  = null
    $langue = null
    $n      = ''
  @rien = ->
    $cible  = undefined
    $langue = undefined
    $n      = ''
  @poser = (v) -> $cible = v
  @basculer = -> $on = not $on`

// une ligne de `{for}` et une liste de deux lignes
const ligne = (id: number, e: Etat) => `{ id: ${id}, cible: ${lit(e.cible)}, langue: ${lit(e.langue)}, n: ${lit(e.n)} }`
const liste = (e1: Etat, e2: Etat) => `[${ligne(1, e1)}, ${ligne(2, e2)}]`

// les gestes d'un composant à lignes : chacun REMPLACE la liste (objets neufs) ; `muter*` écrit dans la première ligne sur place
const gestesLignes = (depart: [Etat, Etat]) => `  $liste = ${liste(...depart)}
  @valA  = -> $liste = ${liste(A, B)}
  @valB  = -> $liste = ${liste(B, A)}
  @vider = -> $liste = ${liste(VIDE, VIDE)}
  @rien  = -> $liste = ${liste(RIEN, RIEN)}
  @muterVide = ->
    $liste[0].cible  = null
    $liste[0].langue = null
    $liste[0].n      = ''
  @muterRetour = ->
    $liste[0].cible  = '${B.cible}'
    $liste[0].langue = '${B.langue}'
    $liste[0].n      = '${B.n}'`

type Depart = 'a' | 'u'
const DEPARTS: Record<Depart, Etat> = { a: A, u: RIEN }

// les composants : un par contexte et par état de départ
function sources(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const d of ['a', 'u'] as const) {
    const dep = DEPARTS[d]
    const vars = variables(dep)
    out[`xl-racine-${d}.mjs`] = `<script>
${vars}
</script>
${SPRITE}
<div class="racine">
  ${dessin(RACINE)}
</div>
${PRET}
`
    out[`xl-si-svg-${d}.mjs`] = `<script>
${vars}
</script>
${SPRITE}
<svg class="cadre" width="100" height="100">
  {if $on}
    ${contenu(RACINE)}
  {end}
</svg>
${PRET}
`
    out[`xl-si-${d}.mjs`] = `<script>
${vars}
</script>
${SPRITE}
{if $on}
  <div class="racine">
    ${dessin(RACINE)}
  </div>
{end}
${PRET}
`
    out[`xl-await-${d}.mjs`] = `<script>
${vars}
  $p = Promise.resolve({ txt: 'ok' })
  @refaire = -> $p = Promise.resolve({ txt: 'ok' })
</script>
${SPRITE}
{await $p}
  <i class="att">attente</i>
{success v}
  <div class="racine">
    ${dessin(RACINE)}
  </div>
{end}
${PRET}
`
    const lignes = gestesLignes(d === 'a' ? [A, B] : [RIEN, RIEN])
    out[`xl-pour-${d}.mjs`] = `<script>
${lignes}
</script>
${SPRITE}
<div class="lignes">
  {for it in $liste by id}
    <div class="ligne">
      ${dessin(LIGNE)}
    </div>
  {end}
</div>
${PRET}
`
    out[`xl-pour-nu-${d}.mjs`] = `<script>
${lignes}
</script>
${SPRITE}
<div class="lignes">
  {for it in $liste}
    <div class="ligne">
      ${dessin(LIGNE)}
    </div>
  {end}
</div>
${PRET}
`
  }
  // le filtre de sécurité : une adresse dangereuse est refusée, à la racine comme dans une ligne
  out['xl-secu.mjs'] = `<script>
  $cible = '${A.cible}'
  $liste = [{ id: 1, cible: '${A.cible}' }]
  @poser = (v) ->
    $cible = v
    $liste = [{ id: 1, cible: v }]
</script>
${SPRITE}
<div class="racine">
  <svg class="cadre" width="100" height="100">
    <use class="u" xlink:href={$cible}></use>
    <use class="uq" xlink:href="{$cible}"></use>
    <a class="lien" xlink:href={$cible}><text x="0" y="50">x</text></a>
  </svg>
</div>
<div class="lignes">
  {for it in $liste by id}
    <div class="ligne">
      <svg class="cadre" width="100" height="100"><use class="u" xlink:href={it.cible}></use><a class="lien" xlink:href={it.cible}><text x="0" y="50">x</text></a></svg>
    </div>
  {end}
</div>
${PRET}
`
  return out
}

const SOURCES = sources()
const BALISES = Object.keys(SOURCES).map((f) => 'mjs-' + f.replace('.mjs', ''))

const cibles = new Map<Mode, Promise<Cible>>()
const cible  = (mode: Mode) => {
  if (!cibles.has(mode)) cibles.set(mode, construire(mode, SOURCES, BALISES))
  return cibles.get(mode)!
}

// le composant est monté quand sa dernière balise est dans l'ombre, ou quand il est tombé (la page montre alors un bandeau d'erreur) : le cas lit ensuite ce qui reste
const pret = async (page: any, balise: string) => {
  await page.waitForFunction(`(() => {
    const h = document.querySelector('${balise}')
    return !!h && (h.classList.contains('mjs-error') || !!(h._shadow && h._shadow.querySelector('.pret, .mjs-fatal-error')))
  })()`, null, { timeout: 10000 })
  await page.waitForTimeout(150)
}

// un appel sur le composant (`vider()`, `basculer()`…), puis le temps de la mise à jour ; l'argument est un texte JS déjà écrit
const regler = async (page: any, balise: string, appel: string) => {
  await page.evaluate(`(() => { document.querySelector('${balise}').${appel}; return null })()`)
  await page.waitForTimeout(200)
}

// le composant a survécu : un plantage vide son ombre, lui pose la classe `mjs-error` et y met un bandeau `mjs-fatal-error`
const vivant = (page: any, balise: string): Promise<boolean> => page.evaluate(`(() => {
  const h = document.querySelector('${balise}')
  return !h.classList.contains('mjs-error') && !h._shadow.querySelector('.mjs-fatal-error') && !!h._shadow.querySelector('.pret')
})()`)

type Rapport = Record<string, unknown>

// note un écart, sans arrêter le cas : tous les écarts d'un cas sont rendus ensemble
const verifier = (ecarts: string[], quoi: string, lu: unknown, attendu: unknown) => {
  if (JSON.stringify(lu) !== JSON.stringify(attendu)) ecarts.push(`${quoi} : attendu ${JSON.stringify(attendu)}, lu ${JSON.stringify(lu) ?? 'rien'}`)
}

// ce que la page montre du conteneur `sel` (le `rang`-ième de la page), pour chacune des classes présentes : les attributs de l'élément, un par un (espace de noms, nom qualifié et valeur ;
// la classe est laissée), la valeur lue dans l'espace de noms voulu, et ce que le navigateur en fait (adresse et boîte d'une icône, langues d'un groupe) ; `null` quand le conteneur n'y est pas
const LIRE = ([balise, sel, rang, classes, xlink, xml]: [string, string, number, string[], string, string]): Rapport | null => {
  const cont = (document.querySelector(balise) as any)._shadow.querySelectorAll(sel)[rang]
  if (!cont) return null
  const boite = (n: any): string => {
    const r = n.getBoundingClientRect()
    return Math.round(r.width) + 'x' + Math.round(r.height)
  }
  const r: Rapport = {}
  for (const cle of classes) {
    const n = cont.querySelector('.' + cle)
    if (!n) continue
    const attributs = Array.from(n.attributes as ArrayLike<any>).filter((a: any) => a.name !== 'class').map((a: any) => `${a.namespaceURI ?? 'aucun'} | ${a.name} = ${a.value}`).sort()
    if (n.localName === 'use') {
      r[cle] = { attributs, ns: n.getAttributeNS(xlink, 'href'), href: n.href.baseVal, boite: boite(n) }
    } else if (n.localName === 'a') {
      r[cle] = { attributs, ns: n.getAttributeNS(xlink, 'href'), href: n.href.baseVal }
    } else {
      r[cle] = { attributs, ns: n.getAttributeNS(xml, 'lang'), de: n.matches(':lang(de)'), en: n.matches(':lang(en)') }
    }
  }
  return r
}

const TOUTES = ['u', 'uq', 'uc', 'l']

const lire = (page: any, balise: string, sel: string, rang: number, classes: string[] = TOUTES): Promise<Rapport | null> => page.evaluate(LIRE, [balise, sel, rang, classes, XLINK, XML])

// ce que le navigateur doit montrer d'une icône pour une adresse (`null` : pas d'attribut) : l'attribut dans l'espace de noms de XLink, rien d'autre, l'adresse lue, la boîte du carré visé
const icone = (v: string | null): Rapport => ({
  attributs: v === null ? [] : [`${XLINK} | xlink:href = ${v}`],
  ns:        v,
  href:      v ?? '',
  boite:     v !== null && v.endsWith('a') ? '20x20' : v !== null && v.endsWith('b') ? '30x30' : '0x0'
})

// le lien <a> : mêmes lectures, sans boîte
const lien = (v: string | null): Rapport => ({
  attributs: v === null ? [] : [`${XLINK} | xlink:href = ${v}`],
  ns:        v,
  href:      v ?? ''
})

const langue = (l: string | null): Rapport => ({
  attributs: l === null ? [] : [`${XML} | xml:lang = ${l}`],
  ns:        l,
  de:        l === 'de',
  en:        l === 'en'
})

const attendu = (e: Etat): Rapport => ({ u: icone(e.cible ?? null), uq: icone(e.cible ?? null), uc: icone('#i-' + e.n), l: langue(e.langue ?? null) })

// un champ après l'autre : tous les écarts du dessin sont rendus ensemble
function comparer(ecarts: string[], quoi: string, lu: Rapport | null, voulu: Rapport) {
  if (!lu) { ecarts.push(`${quoi} : le dessin n'est pas dans la page`); return }
  for (const champ of Object.keys(voulu)) verifier(ecarts, `${quoi}, ${champ}`, lu[champ], voulu[champ])
}

// les suites d'états d'un contexte : le geste qui y mène et l'état attendu après (le geste `null` est la création)
type Pas = { geste: string | null, etat: Etat, nom: string }

const SUITE: Record<Depart, Pas[]> = {
  a: [
    { geste: null,       etat: A,    nom: 'à la création' },
    { geste: 'vider()',  etat: VIDE, nom: 'après null' },
    { geste: 'valB()',   etat: B,    nom: 'au retour' },
    { geste: 'rien()',   etat: VIDE, nom: 'après undefined' },
    { geste: 'valA()',   etat: A,    nom: 'au second retour' }
  ],
  u: [
    { geste: null,       etat: VIDE, nom: 'à la création (undefined)' },
    { geste: 'valB()',   etat: B,    nom: 'à la première valeur' },
    { geste: 'vider()',  etat: VIDE, nom: 'après null' },
    { geste: 'valA()',   etat: A,    nom: 'au retour' }
  ]
}

// deux lignes qui changent ensemble : la seconde prend l'état que la première quittait
const SUITE_LIGNES: Record<Depart, Array<{ geste: string | null, etats: [Etat, Etat], nom: string }>> = {
  a: [
    { geste: null,       etats: [A, B],       nom: 'à la création' },
    { geste: 'vider()',  etats: [VIDE, VIDE], nom: 'après null' },
    { geste: 'valB()',   etats: [B, A],       nom: 'au retour' },
    { geste: 'rien()',   etats: [VIDE, VIDE], nom: 'après undefined' },
    { geste: 'valA()',   etats: [A, B],       nom: 'au second retour' }
  ],
  u: [
    { geste: null,       etats: [VIDE, VIDE], nom: 'à la création (undefined)' },
    { geste: 'valB()',   etats: [B, A],       nom: 'à la première valeur' },
    { geste: 'vider()',  etats: [VIDE, VIDE], nom: 'après null' },
    { geste: 'valA()',   etats: [A, B],       nom: 'au retour' }
  ]
}

for (const mode of ['dev-parents-avant', 'split', 'bundle'] as const) describe(`attributs étrangers calculés d'un SVG qui perdent leur valeur puis la retrouvent (${mode}, Chromium réel)`, function () {
  this.timeout(120000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright.chromium.executablePath())
    if (!present) { console.log('  ℹ️  chromium non installé, test des attributs étrangers SVG sauté. Activer : `npx playwright install chromium`'); return }
    browser = await playwright.chromium.launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  // ouvre le composant, joue le scénario, puis exige qu'aucun écart n'ait été noté et qu'aucune erreur n'ait été dite par la page
  const jouer = async (balise: string, scenario: (page: any, ecarts: string[]) => Promise<void>) => {
    const o      = await charger(browser, await cible(mode), balise)
    const ecarts = [] as string[]
    try {
      await pret(o.page, balise)
      verifier(ecarts, 'composant vivant, à la création', await vivant(o.page, balise), true)
      await scenario(o.page, ecarts)
      verifier(ecarts, 'composant vivant, à la fin', await vivant(o.page, balise), true)
      assert.deepEqual([...ecarts, ...graves(o).map((g) => `erreur de la page : ${g}`)], [])
    } finally {
      await o.fermer()
    }
  }

  it('les composants se compilent', async function () {
    if (!present) { this.skip(); return }
    await cible(mode)
  })

  for (const d of ['a', 'u'] as const) {
    const depart = d === 'a' ? 'départ à une valeur' : 'départ à undefined'

    it(`à la racine du composant, ${depart} : valeur, null, retour, undefined, retour`, async function () {
      if (!present) { this.skip(); return }
      const balise = `mjs-xl-racine-${d}`
      await jouer(balise, async (page, ecarts) => {
        for (const pas of SUITE[d]) {
          if (pas.geste) await regler(page, balise, pas.geste)
          comparer(ecarts, `racine, ${pas.nom}`, await lire(page, balise, '.cadre', 0), attendu(pas.etat))
        }
      })
    })

    it(`dans un {if} posé dans un <svg>, ${depart} : mêmes états, puis la branche retirée et refaite`, async function () {
      if (!present) { this.skip(); return }
      const balise = `mjs-xl-si-svg-${d}`
      await jouer(balise, async (page, ecarts) => {
        for (const pas of SUITE[d]) {
          if (pas.geste) await regler(page, balise, pas.geste)
          comparer(ecarts, `{if} dans le <svg>, ${pas.nom}`, await lire(page, balise, '.cadre', 0), attendu(pas.etat))
        }
        const dernier = SUITE[d][SUITE[d].length - 1].etat
        await regler(page, balise, 'basculer()')
        verifier(ecarts, '{if} dans le <svg> retiré', await lire(page, balise, '.cadre', 0), {})
        await regler(page, balise, 'basculer()')
        comparer(ecarts, '{if} dans le <svg>, branche refaite', await lire(page, balise, '.cadre', 0), attendu(dernier))
      })
    })

    it(`dans un {if} de racine qui porte le dessin entier, ${depart} : mêmes états, puis le dessin retiré et refait`, async function () {
      if (!present) { this.skip(); return }
      const balise = `mjs-xl-si-${d}`
      await jouer(balise, async (page, ecarts) => {
        for (const pas of SUITE[d]) {
          if (pas.geste) await regler(page, balise, pas.geste)
          comparer(ecarts, `{if} de racine, ${pas.nom}`, await lire(page, balise, '.cadre', 0), attendu(pas.etat))
        }
        const dernier = SUITE[d][SUITE[d].length - 1].etat
        await regler(page, balise, 'basculer()')
        verifier(ecarts, '{if} de racine retiré', await lire(page, balise, '.cadre', 0), null)
        await regler(page, balise, 'basculer()')
        comparer(ecarts, '{if} de racine, branche refaite', await lire(page, balise, '.cadre', 0), attendu(dernier))
      })
    })

    // le contenu d'une branche `{await}` est un instantané : il ne suit pas les variables, une nouvelle promesse le refait avec leurs valeurs d'alors
    it(`dans la branche d'un {await}, ${depart} : mêmes états, la branche refaite par une nouvelle promesse après chaque geste`, async function () {
      if (!present) { this.skip(); return }
      const balise = `mjs-xl-await-${d}`
      await jouer(balise, async (page, ecarts) => {
        for (const pas of SUITE[d]) {
          if (pas.geste) {
            await regler(page, balise, pas.geste)
            await regler(page, balise, 'refaire()')
          }
          comparer(ecarts, `{await}, ${pas.nom}`, await lire(page, balise, '.cadre', 0), attendu(pas.etat))
        }
      })
    })

    for (const [cle, titre] of [['pour', 'avec clé (`by id`)'], ['pour-nu', 'sans clé']] as const) {
      it(`dans les lignes d'un {for} ${titre}, ${depart} : liste remplacée, valeur, null, retour, undefined, retour`, async function () {
        if (!present) { this.skip(); return }
        const balise = `mjs-xl-${cle}-${d}`
        await jouer(balise, async (page, ecarts) => {
          for (const pas of SUITE_LIGNES[d]) {
            if (pas.geste) await regler(page, balise, pas.geste)
            comparer(ecarts, `première ligne, ${pas.nom}`, await lire(page, balise, '.ligne', 0), attendu(pas.etats[0]))
            comparer(ecarts, `seconde ligne, ${pas.nom}`, await lire(page, balise, '.ligne', 1), attendu(pas.etats[1]))
          }
        })
      })
    }
  }

  it('dans une ligne de {for} modifiée sur place : null puis retour, la seconde ligne reste telle quelle', async function () {
    if (!present) { this.skip(); return }
    const balise = 'mjs-xl-pour-a'
    await jouer(balise, async (page, ecarts) => {
      comparer(ecarts, 'première ligne, à la création', await lire(page, balise, '.ligne', 0), attendu(A))
      await regler(page, balise, 'muterVide()')
      comparer(ecarts, 'première ligne, après null sur place', await lire(page, balise, '.ligne', 0), attendu(VIDE))
      comparer(ecarts, 'seconde ligne, après null sur place', await lire(page, balise, '.ligne', 1), attendu(B))
      await regler(page, balise, 'muterRetour()')
      comparer(ecarts, 'première ligne, au retour sur place', await lire(page, balise, '.ligne', 0), attendu(B))
      comparer(ecarts, 'seconde ligne, au retour sur place', await lire(page, balise, '.ligne', 1), attendu(B))
    })
  })

  // des adresses que le filtre refuse : un schéma de script, des majuscules et une tabulation pour se cacher, un document HTML, un fichier local
  const DANGER = ['javascript:window.__pwn = 1', '  JaVa\tScRiPt:window.__pwn = 2', 'vbscript:x', 'data:text/html,<script>window.__pwn = 3</script>', 'file:///etc/passwd']

  // ce que la racine et la première ligne montrent quand l'adresse posée est `v` (`null` : pas d'attribut) : le <use>, le <use> en accolades entre guillemets et le lien <a> à la racine, le <use> et le lien dans la ligne
  const racine = (v: string | null): Rapport => ({ u: icone(v), uq: icone(v), lien: lien(v) })
  const ligne1 = (v: string | null): Rapport => ({ u: icone(v), lien: lien(v) })

  it('le filtre de sécurité, attribut présent : une adresse dangereuse est refusée, l\'attribut garde sa valeur d\'avant dans l\'espace de noms de XLink', async function () {
    if (!present) { this.skip(); return }
    const balise = 'mjs-xl-secu'
    await jouer(balise, async (page, ecarts) => {
      comparer(ecarts, 'racine, à la création', await lire(page, balise, '.racine', 0, ['u', 'uq', 'lien']), racine('#a'))
      for (const danger of DANGER) {
        await regler(page, balise, `poser(${JSON.stringify(danger)})`)
        comparer(ecarts, `racine, après ${JSON.stringify(danger)}`, await lire(page, balise, '.racine', 0, ['u', 'uq', 'lien']), racine('#a'))
        comparer(ecarts, `ligne, après ${JSON.stringify(danger)}`, await lire(page, balise, '.ligne', 0, ['u', 'lien']), ligne1('#a'))
      }
      await regler(page, balise, 'poser(\'#b\')')
      comparer(ecarts, 'racine, valeur sûre après les refus', await lire(page, balise, '.racine', 0, ['u', 'uq', 'lien']), racine('#b'))
      comparer(ecarts, 'ligne, valeur sûre après les refus', await lire(page, balise, '.ligne', 0, ['u', 'lien']), ligne1('#b'))
    })
  })

  it('le filtre de sécurité, attribut retiré : une adresse dangereuse ne le ramène pas, la valeur sûre qui suit le pose dans l\'espace de noms de XLink', async function () {
    if (!present) { this.skip(); return }
    const balise = 'mjs-xl-secu'
    await jouer(balise, async (page, ecarts) => {
      await regler(page, balise, 'poser(null)')
      comparer(ecarts, 'racine, après null', await lire(page, balise, '.racine', 0, ['u', 'uq', 'lien']), racine(null))
      comparer(ecarts, 'ligne, après null', await lire(page, balise, '.ligne', 0, ['u', 'lien']), ligne1(null))
      for (const danger of DANGER) {
        await regler(page, balise, `poser(${JSON.stringify(danger)})`)
        comparer(ecarts, `racine, après null puis ${JSON.stringify(danger)}`, await lire(page, balise, '.racine', 0, ['u', 'uq', 'lien']), racine(null))
        comparer(ecarts, `ligne, après null puis ${JSON.stringify(danger)}`, await lire(page, balise, '.ligne', 0, ['u', 'lien']), ligne1(null))
      }
      await regler(page, balise, 'poser(\'#b\')')
      comparer(ecarts, 'racine, valeur sûre après les refus', await lire(page, balise, '.racine', 0, ['u', 'uq', 'lien']), racine('#b'))
      comparer(ecarts, 'ligne, valeur sûre après les refus', await lire(page, balise, '.ligne', 0, ['u', 'lien']), ligne1('#b'))
    })
  })
})

// le code émis : l'écriture d'un attribut étranger calculé d'un élément SVG pose et retire dans l'espace de noms, ailleurs rien ne change
describe('attributs étrangers calculés d\'un SVG : le code émis pose et retire dans l\'espace de noms', function () {
  this.timeout(60000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  const emis = async (gabarit: string): Promise<string> => {
    const { output } = await transpile(`<script>\n$x = 'a'\n$liste = [{ v: 'a', id: 1 }]\n</script>\n${gabarit}\n`, { moduleName: 'emis' })
    return String(output)
  }

  // le jumeau de nœud : la lecture, le retrait et la recherche se font par le nom qualifié (le rendu serveur garde `xml:lang` sans espace de noms), seule la création pose dans l'espace de noms
  const POSE_XLINK = `setAttributeNS('${XLINK}', `
  const POSE_XML   = `setAttributeNS('${XML}', `

  it('à la racine, dans un {if} et dans une ligne de {for} : xlink:href et xml:lang calculés passent par setAttributeNS', async function () {
    for (const gabarit of [
      '<svg><use xlink:href={$x}></use></svg>',
      '<svg><use xlink:href="{$x}"></use></svg>',
      '<svg><use xlink:href="#i-{$x}"></use></svg>',
      '<svg>{if $x}<use xlink:href={$x}></use>{end}</svg>',
      '{for it in $liste}<svg><use xlink:href={it.v}></use></svg>{end}',
      '{for it in $liste}<svg><use xlink:href="{it.v}"></use></svg>{end}',
      '{for it in $liste}<svg><use xlink:href="#i-{it.v}"></use></svg>{end}',
      '{for it in $liste}<svg><use xlink:href="#i-{$x}"></use></svg>{end}',
      '{for it in $liste}<svg><use xlink:href={it.id === $x ? it.v : \'#a\'}></use></svg>{end}'
    ]) assert.ok((await emis(gabarit)).includes(POSE_XLINK), gabarit)
    for (const gabarit of [
      '<svg><g xml:lang={$x}></g></svg>',
      '<svg xml:lang={$x}></svg>',
      '{for it in $liste}<svg><g xml:lang={it.v}></g></svg>{end}'
    ]) assert.ok((await emis(gabarit)).includes(POSE_XML), gabarit)
  })

  it('l\'écriture passe encore par µ._mjs_updAttrNode, donc par le même filtre de sécurité, avec le nom qualifié', async function () {
    assert.match(await emis('<svg><use xlink:href={$x}></use></svg>'), /const _mjs_j = _mjs_node && \{[^]*?\}; µ\._mjs_updAttrNode\(_mjs_j, 'xlink:href', \$\.x\)/)
    assert.match(await emis('{for it in $liste}<svg><use xlink:href={it.v}></use></svg>{end}'), /const _mjs_j = \w+ && \{[^]*?\}; µ\._mjs_updAttrNode\(_mjs_j, 'xlink:href', it\.v\)/)
  })

  it('un attribut sans espace de noms ne change pas : href, un élément HTML, un élément sous <foreignObject>, un composant', async function () {
    for (const gabarit of [
      '<svg><use href={$x}></use></svg>',
      '<div xlink:href={$x} xml:lang={$x}></div>',
      '<svg><foreignObject><div xlink:href={$x} xml:lang={$x}></div></foreignObject></svg>',
      '<a href={$x}>x</a>',
      '{for it in $liste}<div xlink:href={it.v}></div>{end}',
      '{for it in $liste}<svg><use href={it.v}></use></svg>{end}'
    ]) assert.ok(!(await emis(gabarit)).includes('setAttributeNS'), gabarit)
  })

  it('la branche d\'un {await} ne change pas : son contenu est un instantané, l\'attribut est déclaré dans l\'espace de noms à la création', async function () {
    const code = await emis('{await $x}{success v}<svg><use xlink:href={v}></use></svg>{end}')
    assert.match(code, /setAttributeNS\("http:\/\/www\.w3\.org\/1999\/xlink", "xlink:href", ''\);\s*µ\._mjs_updAttrNode\(\w+, "xlink:href", \(v\)\);/)
  })
})
