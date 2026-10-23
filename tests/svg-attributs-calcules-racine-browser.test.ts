// un attribut CALCULÉ d'un élément SVG écrit en minuscules (`viewbox={$cadre}`, `gradientunits={$unites}`, `preserveaspectratio={$ratio}`) est posé comme celui qui est écrit avec
// sa casse SVG, à la racine du composant, dans un `{if}` de racine et dans une ligne de `{for}` : le gabarit cloné porte l'attribut vide, que l'analyseur HTML du navigateur a
// ajusté (`viewbox` devient `viewBox`), et la mise à jour le retrouve sous ce nom ; sans cela elle en crée un second, `viewbox`, que le dessin ignore (aucune mise à l'échelle,
// des dégradés qui gardent leurs unités par défaut). Même chose pour `definitionurl={$def}` sur un élément MathML, et pour `xlink:href={$cible}` d'un `<use>` : l'attribut reste
// dans l'espace de noms de XLink, c'est le seul que `<use>` lise.
// Chaque dessin a ses témoins : le même dessin écrit avec la bonne casse (`viewBox`, `preserveAspectRatio`, `gradientUnits`) et une icône en `href` (sans espace de noms) ;
// un témoin faux dirait que le test lui-même est faux. La valeur est lue à la création, puis après un changement de la variable : un seul attribut, celui du standard
// (`getAttribute('viewBox')`, `viewBox.baseVal`, jamais un `viewbox` de plus parmi les attributs de l'élément).
// Les autres écritures d'un attribut calculé (chaîne à accolades avec `$`, accolades sans `$`, valeur qui dépend de la ligne choisie) et la branche d'un `{await}` sont lues de même ;
// une icône écrite en chaîne (`xlink:href="#icone-{$lettre}"`) est déclarée vide dans le gabarit pour rester dans l'espace de noms de XLink.
// Les trois modes : développement, production en fichiers séparés, production en un seul fichier. Chromium réel. Le code émis est aussi lu directement.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'

const XLINK = 'http://www.w3.org/1999/xlink'

// les deux jeux de valeurs que prennent les attributs, avec ce que le standard en tire pour le ratio : l'alignement et le choix « meet / slice », et la boîte du rectangle
// (10 x 20) une fois mis à l'échelle dans un <svg> de 100 x 100 ; le carré `#a` (ou `#icone-a`) fait 20 de côté, `#b` (ou `#icone-b`) 30
type Jeu = { cadre: string, ratio: string, unites: string, cible: string, def: string, larg: number, haut: number, align: string, rect: string }

const AVANT: Jeu = { cadre: '0 0 10 20', ratio: 'none',           unites: 'userSpaceOnUse',    cible: '#a', def: 'http://exemple.test/a', larg: 10, haut: 20, align: '1/1', rect: '100x100' }
const APRES: Jeu = { cadre: '0 0 40 40', ratio: 'xMinYMin slice', unites: 'objectBoundingBox', cible: '#b', def: 'http://exemple.test/b', larg: 40, haut: 40, align: '2/2', rect: '25x50' }

// les expressions des valeurs dans le gabarit : à la racine ce sont des variables du composant, dans une ligne de `{for}` des champs de la ligne
type Expr = { cadre: string, ratio: string, unites: string, cible: string, def: string }

const RACINE: Expr = { cadre: '{$cadre}',   ratio: '{$ratio}',   unites: '{$unites}',   cible: '{$cible}',   def: '{$def}' }
const LIGNE:  Expr = { cadre: '{it.cadre}', ratio: '{it.ratio}', unites: '{it.unites}', cible: '{it.cible}', def: '{it.def}' }

const RECT   = '<rect class="r" x="0" y="0" width="10" height="20" fill="red"></rect>'
const STOPS  = '<stop offset="0" stop-color="red"></stop><stop offset="1" stop-color="blue"></stop>'
const SPRITE = '<svg class="sprite" width="0" height="0"><defs><rect id="a" width="20" height="20" fill="green"></rect><rect id="b" width="30" height="30" fill="blue"></rect><rect id="icone-a" width="20" height="20" fill="green"></rect><rect id="icone-b" width="30" height="30" fill="blue"></rect></defs></svg>'

// deux <svg> qui ne diffèrent que par l'écriture de leurs attributs : en minuscules, puis avec leur casse SVG
const vues = (e: Expr) => `<svg class="min" viewbox=${e.cadre} preserveaspectratio=${e.ratio} width="100" height="100">${RECT}</svg>
  <svg class="camel" viewBox=${e.cadre} preserveAspectRatio=${e.ratio} width="100" height="100">${RECT}</svg>`

// le contenu d'un <svg> : deux dégradés (unités en minuscules, puis avec leur casse SVG), deux icônes (`xlink:href`, puis `href` sans espace de noms)
const contenu = (e: Expr) => `<linearGradient class="gm" gradientunits=${e.unites} x1="0" y1="0" x2="100" y2="0">${STOPS}</linearGradient>
    <linearGradient class="gc" gradientUnits=${e.unites} x1="0" y1="0" x2="100" y2="0">${STOPS}</linearGradient>
    <use class="ux" xlink:href=${e.cible} x="0" y="0"></use>
    <use class="uh" href=${e.cible} x="40" y="0"></use>`

const formule = (e: Expr) => `<math class="formule"><mi class="mi" definitionurl=${e.def}>x</mi></math>`

// le dessin complet : les deux <svg> du cadre, un <svg> pour le contenu, une formule MathML
const dessin = (classe: string, e: Expr) => `<div class="${classe}">
  ${vues(e)}
  <svg class="contenu" width="100" height="100">
    ${contenu(e)}
  </svg>
  ${formule(e)}
</div>`

const VARIABLES = `  $on     = true
  $cadre  = '${AVANT.cadre}'
  $ratio  = '${AVANT.ratio}'
  $unites = '${AVANT.unites}'
  $cible  = '${AVANT.cible}'
  $def    = '${AVANT.def}'
  @changer = ->
    $cadre  = '${APRES.cadre}'
    $ratio  = '${APRES.ratio}'
    $unites = '${APRES.unites}'
    $cible  = '${APRES.cible}'
    $def    = '${APRES.def}'
  @basculer = -> $on = not $on`

// les lignes de `{for}` : la première prend les premières valeurs, la seconde les secondes ; `changer()` les échange, `ajouter()` en pose une troisième
const ligne = (id: number, j: Jeu) => ({ id, cadre: j.cadre, ratio: j.ratio, unites: j.unites, cible: j.cible, def: j.def })

const LIGNES = `  $liste = ${JSON.stringify([ligne(1, AVANT), ligne(2, APRES)])}
  @changer = -> $liste = ${JSON.stringify([ligne(1, APRES), ligne(2, AVANT)])}
  @ajouter = -> $liste = $liste.concat([${JSON.stringify(ligne(3, AVANT))}])`

// les champs d'une ligne de `sr-formes` : son cadre, sa largeur et sa hauteur, la lettre de son icône (`a` ou `b`) et l'adresse qui en découle
const champs = (id: number, j: Jeu) => ({ id, cadre: j.cadre, larg: j.larg, haut: j.haut, lettre: j.cible.slice(1), cible: j.cible })

const PRET = '<i class="pret"></i>'

const SOURCES: Record<string, string> = {
  // le dessin à la racine, puis un contenu de <svg> dans un `{if}` : le fragment du `{if}` est posé dans un <svg> qui est hors de lui
  'sr-racine.mjs': `<script>
${VARIABLES}
</script>
${SPRITE}
${dessin('dessin', RACINE)}
<div class="dans-svg">
  <svg class="si-dans-svg" width="100" height="100">
    {if $on}
      ${contenu(RACINE)}
    {end}
  </svg>
</div>
${PRET}
`,
  // le dessin entier dans un `{if}` de racine : il disparaît, puis revient avec les valeurs d'alors
  'sr-si.mjs': `<script>
${VARIABLES}
</script>
${SPRITE}
{if $on}
  ${dessin('dessin', RACINE)}
{end}
${PRET}
`,
  // le dessin dans chaque ligne d'un `{for}`, puis le contenu d'un <svg> répété par un `{for}` placé dans le <svg>
  'sr-pour.mjs': `<script>
${LIGNES}
</script>
${SPRITE}
<div class="lignes">
  {for it in $liste}
    ${dessin('ligne', LIGNE)}
  {end}
</div>
<svg class="pour-dans-svg" width="100" height="100">
  {for it in $liste}
    <g class="ligne-g">
      ${contenu(LIGNE)}
    </g>
  {end}
</svg>
${PRET}
`,
  // les autres écritures d'un attribut calculé : chaîne à accolades avec `$` (à la racine, puis dans une ligne), accolades sans `$` (champ de la ligne, seul puis mêlé à du
  // texte) et valeur qui dépend de la ligne choisie (`it.id === $sel ? … : …`) ; une icône dont l'adresse est écrite ainsi (`xlink:href="#icone-{$lettre}"`, un `#{` serait pris pour une interpolation Ruby) n'est pas déclarée
  // vide dans le gabarit de la racine : elle reste dans l'espace de noms de XLink
  'sr-formes.mjs': `<script>
  $larg   = ${AVANT.larg}
  $haut   = ${AVANT.haut}
  $sel    = 1
  $lettre = 'a'
  $liste  = ${JSON.stringify([champs(1, AVANT), champs(2, APRES)])}
  @changer = ->
    $larg   = ${APRES.larg}
    $haut   = ${APRES.haut}
    $sel    = 2
    $lettre = 'b'
    $liste  = ${JSON.stringify([champs(1, APRES), champs(2, AVANT)])}
</script>
${SPRITE}
<div class="racine">
  <svg class="t-dollar" viewbox="0 0 {$larg} {$haut}" width="100" height="100"></svg>
  <svg class="u-racine" width="100" height="100"><use class="ud" xlink:href="#icone-{$lettre}" x="0" y="0"></use></svg>
</div>
<div class="lignes">
  {for it in $liste}
    <div class="ligne">
      <svg class="f-pur" viewbox="{it.cadre}" width="100" height="100"></svg>
      <svg class="f-mixte" viewbox="0 0 {it.larg} {it.haut}" width="100" height="100"></svg>
      <svg class="f-dollar" viewbox="0 0 {it.larg} {$haut}" width="100" height="100"></svg>
      <svg class="f-filtre" width="100" height="100"><linearGradient class="gf" gradientunits={it.id === $sel ? 'userSpaceOnUse' : 'objectBoundingBox'}></linearGradient></svg>
      <svg class="u-ligne" width="100" height="100">
        <use class="up" xlink:href="{it.cible}" x="0" y="0"></use>
        <use class="um" xlink:href="#icone-{it.lettre}" x="0" y="0"></use>
        <use class="ud" xlink:href="#icone-{$lettre}" x="0" y="0"></use>
      </svg>
    </div>
  {end}
</div>
${PRET}
`,
  // les mêmes écritures dans la branche d'un {await} : le gabarit n'y déclare pas l'attribut (sauf celui de l'icône, pour son espace de noms), la mise à jour le crée
  'sr-await.mjs': `<script>
  $larg   = ${AVANT.larg}
  $haut   = ${AVANT.haut}
  $lettre = 'a'
  $unites = '${AVANT.unites}'
  $p      = Promise.resolve({ txt: 'ok' })
</script>
${SPRITE}
{await $p}
  <i class="att">attente</i>
{success v}
  <div class="branche">
    <svg class="a-dollar" viewbox="0 0 {$larg} {$haut}" width="100" height="100"></svg>
    <svg class="a-contenu" width="100" height="100">
      <linearGradient class="gd" gradientunits="{$unites}" x1="0" y1="0" x2="100" y2="0">${STOPS}</linearGradient>
      <use class="ud" xlink:href="#icone-{$lettre}" x="0" y="0"></use>
    </svg>
  </div>
{end}
${PRET}
`
}
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

// un appel sur le composant (`changer()`, `basculer()`…), puis le temps de la mise à jour
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

// ce que la page montre du conteneur `sel` (le `rang`-ième de la page), pour chacune des classes demandées : les attributs de l'élément, un par un (espace de noms, nom
// qualifié et valeur, dans l'ordre alphabétique ; la classe est laissée), et ce que le navigateur en fait (cadre, ratio, unités des dégradés, adresse et boîte des icônes) ;
// la fonction tourne dans la page, `null` quand le conteneur n'y est pas
const LIRE = ([balise, sel, rang, classes]: [string, string, number, string[]]): Rapport | null => {
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
    r[`${cle} : attributs`] = Array.from(n.attributes as ArrayLike<any>).filter((a: any) => a.name !== 'class').map((a: any) => `${a.namespaceURI ?? 'aucun'} | ${a.name} = ${a.value}`).sort()
    const nom = n.localName.toLowerCase()
    if (nom === 'svg') {
      r[`${cle} : viewBox.baseVal`]                = n.viewBox.baseVal ? n.viewBox.baseVal.width + 'x' + n.viewBox.baseVal.height : 'aucun'
      r[`${cle} : preserveAspectRatio.baseVal`]    = n.preserveAspectRatio.baseVal.align + '/' + n.preserveAspectRatio.baseVal.meetOrSlice
      r[`${cle} : boîte du rect`]                  = n.querySelector('.r') ? boite(n.querySelector('.r')) : 'absent'
    }
    if (nom === 'lineargradient') r[`${cle} : gradientUnits.baseVal`] = n.gradientUnits.baseVal
    if (nom === 'use') {
      r[`${cle} : href.baseVal`] = n.href.baseVal
      r[`${cle} : boîte`]        = boite(n)
    }
  }
  return r
}

const lire = (page: any, balise: string, sel: string, rang: number, classes: string[]): Promise<Rapport | null> => page.evaluate(LIRE, [balise, sel, rang, classes])

// un champ après l'autre : tous les écarts du dessin sont rendus ensemble
function comparer(ecarts: string[], quoi: string, lu: Rapport | null, attendu: Rapport) {
  if (!lu) { ecarts.push(`${quoi} : le dessin n'est pas dans la page`); return }
  for (const champ of Object.keys(attendu)) verifier(ecarts, `${quoi}, ${champ}`, lu[champ], attendu[champ])
}

const trie = (liste: string[]) => [...liste].sort()

// ce que le navigateur doit montrer de chaque élément, par classe : un <svg> sans autre attribut que sa taille et son cadre, un <svg> au cadre et au ratio, un dégradé (ses unités,
// avec ou sans ses quatre coordonnées), une icône `<use>` en `xlink:href` (dans l'espace de noms de XLink) ou en `href` (sans), vers le carré `#a` ou `#b`
const svg = (cle: string, cadre: string): Rapport => ({
  [`${cle} : attributs`]:       trie(['aucun | height = 100', 'aucun | width = 100', `aucun | viewBox = ${cadre}`]),
  [`${cle} : viewBox.baseVal`]: cadre.split(' ').slice(2).join('x')
})

const vue = (cle: string, j: Jeu): Rapport => ({
  [`${cle} : attributs`]:                   trie(['aucun | height = 100', 'aucun | width = 100', `aucun | preserveAspectRatio = ${j.ratio}`, `aucun | viewBox = ${j.cadre}`]),
  [`${cle} : viewBox.baseVal`]:             j.cadre.split(' ').slice(2).join('x'),
  [`${cle} : preserveAspectRatio.baseVal`]: j.align,
  [`${cle} : boîte du rect`]:               j.rect
})

const degrade = (cle: string, unites: string, avecPoints = false): Rapport => ({
  [`${cle} : attributs`]:             trie([`aucun | gradientUnits = ${unites}`, ...(avecPoints ? ['aucun | x1 = 0', 'aucun | x2 = 100', 'aucun | y1 = 0', 'aucun | y2 = 0'] : [])]),
  [`${cle} : gradientUnits.baseVal`]: unites === 'userSpaceOnUse' ? 1 : 2
})

const icone = (cle: string, href: string, nom = 'xlink:href', ns = XLINK, x = 0): Rapport => ({
  [`${cle} : attributs`]:    trie([`${ns} | ${nom} = ${href}`, `aucun | x = ${x}`, 'aucun | y = 0']),
  [`${cle} : href.baseVal`]: href,
  [`${cle} : boîte`]:        href.endsWith('a') ? '20x20' : '30x30'
})

// ce que le navigateur doit montrer de chaque élément du dessin complet, pour un jeu de valeurs
const PARTIES: Record<string, (j: Jeu) => Rapport> = {
  min:   (j) => vue('min', j),
  camel: (j) => vue('camel', j),
  gm:    (j) => degrade('gm', j.unites, true),
  gc:    (j) => degrade('gc', j.unites, true),
  ux:    (j) => icone('ux', j.cible),
  uh:    (j) => icone('uh', j.cible, 'href', 'aucun', 40),
  mi:    (j) => ({ 'mi : attributs': [`aucun | definitionURL = ${j.def}`] })
}

const TOUTES  = ['min', 'camel', 'gm', 'gc', 'ux', 'uh', 'mi']
const CONTENU = ['gm', 'gc', 'ux', 'uh']

const attendu = (classes: string[], j: Jeu): Rapport => Object.assign({}, ...classes.map((c) => PARTIES[c](j)))

for (const mode of ['dev-parents-avant', 'split', 'bundle'] as const) describe(`attributs calculés des éléments SVG, à la racine, dans un {if} et dans un {for} (${mode}, Chromium réel)`, function () {
  this.timeout(120000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright.chromium.executablePath())
    if (!present) { console.log('  ℹ️  chromium non installé, test des attributs SVG calculés sauté. Activer : `npx playwright install chromium`'); return }
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

  it('à la racine : viewbox, preserveaspectratio, gradientunits, definitionurl et xlink:href calculés, à la création puis après changement des variables', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-sr-racine'
    await jouer(B, async (page, ecarts) => {
      comparer(ecarts, 'dessin, à la création', await lire(page, B, '.dessin', 0, TOUTES), attendu(TOUTES, AVANT))
      await regler(page, B, 'changer()')
      comparer(ecarts, 'dessin, après changement', await lire(page, B, '.dessin', 0, TOUTES), attendu(TOUTES, APRES))
    })
  })

  it('dans un {if} placé dans un <svg> : dégradés et icônes calculés, à la création puis après changement', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-sr-racine'
    await jouer(B, async (page, ecarts) => {
      comparer(ecarts, 'contenu du {if}, à la création', await lire(page, B, '.dans-svg', 0, CONTENU), attendu(CONTENU, AVANT))
      await regler(page, B, 'changer()')
      comparer(ecarts, 'contenu du {if}, après changement', await lire(page, B, '.dans-svg', 0, CONTENU), attendu(CONTENU, APRES))
      await regler(page, B, 'basculer()')
      verifier(ecarts, 'contenu du {if} retiré', await lire(page, B, '.dans-svg', 0, CONTENU), {})
      await regler(page, B, 'basculer()')
      comparer(ecarts, 'contenu du {if}, branche refaite', await lire(page, B, '.dans-svg', 0, CONTENU), attendu(CONTENU, APRES))
    })
  })

  it('dans un {if} de racine : le dessin entier, à la création, après changement, retiré puis refait', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-sr-si'
    await jouer(B, async (page, ecarts) => {
      comparer(ecarts, 'dessin du {if}, à la création', await lire(page, B, '.dessin', 0, TOUTES), attendu(TOUTES, AVANT))
      await regler(page, B, 'changer()')
      comparer(ecarts, 'dessin du {if}, après changement', await lire(page, B, '.dessin', 0, TOUTES), attendu(TOUTES, APRES))
      await regler(page, B, 'basculer()')
      verifier(ecarts, 'dessin du {if} retiré', await lire(page, B, '.dessin', 0, TOUTES), null)
      await regler(page, B, 'basculer()')
      comparer(ecarts, 'dessin du {if}, branche refaite', await lire(page, B, '.dessin', 0, TOUTES), attendu(TOUTES, APRES))
    })
  })

  it('dans une ligne de {for} : le dessin de chaque ligne, à la création, après changement et pour une ligne ajoutée', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-sr-pour'
    await jouer(B, async (page, ecarts) => {
      comparer(ecarts, 'première ligne, à la création', await lire(page, B, '.lignes .ligne', 0, TOUTES), attendu(TOUTES, AVANT))
      comparer(ecarts, 'seconde ligne, à la création', await lire(page, B, '.lignes .ligne', 1, TOUTES), attendu(TOUTES, APRES))
      await regler(page, B, 'changer()')
      comparer(ecarts, 'première ligne, après changement', await lire(page, B, '.lignes .ligne', 0, TOUTES), attendu(TOUTES, APRES))
      comparer(ecarts, 'seconde ligne, après changement', await lire(page, B, '.lignes .ligne', 1, TOUTES), attendu(TOUTES, AVANT))
      await regler(page, B, 'ajouter()')
      comparer(ecarts, 'ligne ajoutée', await lire(page, B, '.lignes .ligne', 2, TOUTES), attendu(TOUTES, AVANT))
      comparer(ecarts, 'première ligne, après l\'ajout', await lire(page, B, '.lignes .ligne', 0, TOUTES), attendu(TOUTES, APRES))
    })
  })

  it('dans un {for} placé dans un <svg> : dégradés et icônes de chaque ligne, à la création, après changement et pour une ligne ajoutée', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-sr-pour'
    await jouer(B, async (page, ecarts) => {
      comparer(ecarts, 'première ligne du <svg>, à la création', await lire(page, B, '.pour-dans-svg .ligne-g', 0, CONTENU), attendu(CONTENU, AVANT))
      comparer(ecarts, 'seconde ligne du <svg>, à la création', await lire(page, B, '.pour-dans-svg .ligne-g', 1, CONTENU), attendu(CONTENU, APRES))
      await regler(page, B, 'changer()')
      comparer(ecarts, 'première ligne du <svg>, après changement', await lire(page, B, '.pour-dans-svg .ligne-g', 0, CONTENU), attendu(CONTENU, APRES))
      comparer(ecarts, 'seconde ligne du <svg>, après changement', await lire(page, B, '.pour-dans-svg .ligne-g', 1, CONTENU), attendu(CONTENU, AVANT))
      await regler(page, B, 'ajouter()')
      comparer(ecarts, 'ligne ajoutée du <svg>', await lire(page, B, '.pour-dans-svg .ligne-g', 2, CONTENU), attendu(CONTENU, AVANT))
    })
  })

  it('les autres écritures (chaîne à accolades, champ de la ligne, valeur qui dépend de la ligne choisie) : un seul attribut viewBox ou gradientUnits, à la création et après changement', async function () {
    if (!present) { this.skip(); return }
    const B       = 'mjs-sr-formes'
    const CLASSES = ['f-pur', 'f-mixte', 'f-dollar', 'gf', 'up', 'um', 'ud']
    // une ligne : son cadre, sa largeur et sa hauteur, sa lettre ; `haut` et `lettre` sont les variables du composant, `choisie` dit si la ligne est celle du choix
    const ligneAttendue = (j: Jeu, haut: number, lettre: string, choisie: boolean): Rapport => Object.assign({},
      svg('f-pur', j.cadre), svg('f-mixte', `0 0 ${j.larg} ${j.haut}`), svg('f-dollar', `0 0 ${j.larg} ${haut}`), degrade('gf', choisie ? 'userSpaceOnUse' : 'objectBoundingBox'),
      icone('up', j.cible), icone('um', '#icone-' + j.cible.slice(1)), icone('ud', '#icone-' + lettre)
    )
    await jouer(B, async (page, ecarts) => {
      comparer(ecarts, 'chaîne avec $, à la racine, à la création', await lire(page, B, '.racine', 0, ['t-dollar', 'ud']), Object.assign({}, svg('t-dollar', `0 0 ${AVANT.larg} ${AVANT.haut}`), icone('ud', '#icone-a')))
      comparer(ecarts, 'première ligne, à la création', await lire(page, B, '.lignes .ligne', 0, CLASSES), ligneAttendue(AVANT, AVANT.haut, 'a', true))
      comparer(ecarts, 'seconde ligne, à la création', await lire(page, B, '.lignes .ligne', 1, CLASSES), ligneAttendue(APRES, AVANT.haut, 'a', false))
      await regler(page, B, 'changer()')
      comparer(ecarts, 'chaîne avec $, à la racine, après changement', await lire(page, B, '.racine', 0, ['t-dollar', 'ud']), Object.assign({}, svg('t-dollar', `0 0 ${APRES.larg} ${APRES.haut}`), icone('ud', '#icone-b')))
      comparer(ecarts, 'première ligne, après changement', await lire(page, B, '.lignes .ligne', 0, CLASSES), ligneAttendue(APRES, APRES.haut, 'b', false))
      comparer(ecarts, 'seconde ligne, après changement', await lire(page, B, '.lignes .ligne', 1, CLASSES), ligneAttendue(AVANT, APRES.haut, 'b', true))
    })
  })

  it('dans la branche d\'un {await} : chaîne à accolades avec $ sur un <svg>, un dégradé et une icône, à la création', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-sr-await'
    await jouer(B, async (page, ecarts) => {
      comparer(ecarts, 'branche, à la création', await lire(page, B, '.branche', 0, ['a-dollar', 'gd', 'ud']), Object.assign({}, svg('a-dollar', `0 0 ${AVANT.larg} ${AVANT.haut}`), degrade('gd', AVANT.unites, true), icone('ud', '#icone-a')))
    })
  })
})

// le code émis : le nom que la mise à jour d'un attribut calculé passe au runtime est celui que le navigateur a posé dans le gabarit
describe('attributs calculés des éléments SVG : les noms que le code émis passe aux mises à jour', function () {
  this.timeout(60000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  // les noms des mises à jour (`this._mjs_updAttr('a1', 'nom', …)` à la racine, `µ._mjs_updAttrNode(n, 'nom', …)` dans une ligne), une fois chacun et dans l'ordre alphabétique :
  // l'ordre des effets dépend des variables, et une même mise à jour est émise plusieurs fois (à la création de la branche, dans l'effet, pour chaque valeur d'un choix)
  const noms = async (gabarit: string): Promise<string[]> => {
    const { output } = await transpile(`<script>\n$x = 'a'\n$liste = [{ v: 'a', id: 1 }]\n</script>\n${gabarit}\n`, { moduleName: 'emis' })
    return [...new Set([...String(output).matchAll(/_mjs_updAttr(?:Node)?\([\w'$]+, '([^']*)'/g)].map((m) => m[1]))].sort()
  }

  it('à la racine, un élément SVG reçoit le nom du standard : viewbox, preserveaspectratio, gradientunits, xlink:href', async function () {
    assert.deepEqual(await noms('<svg viewbox={$x} preserveaspectratio={$x}><linearGradient gradientunits={$x}></linearGradient><use xlink:href={$x}></use></svg>'), ['gradientUnits', 'preserveAspectRatio', 'viewBox', 'xlink:href'])
  })

  it('le gabarit déclare l\'attribut sous ce même nom : le rendu serveur ne met pas `viewbox` en `viewBox`, il garderait les deux ; une icône écrite en chaîne y est déclarée dans l\'espace de noms de XLink', async function () {
    const { output } = await transpile('<script>\n$x = \'a\'\n</script>\n<svg viewbox={$x}><use xlink:href="#icone-{$x}"></use></svg>\n', { moduleName: 'emis' })
    const gabarit = String(output).match(/_mjs_cloneTpl\("([^"]*)"\)/)?.[1] ?? ''
    assert.match(gabarit, /<svg viewBox=''/)
    assert.doesNotMatch(gabarit, /viewbox=/)
    assert.match(gabarit, /<use xlink:href=''>/)
  })

  it('dans une ligne de {for} : mêmes noms, pour les trois écritures (accolades, chaîne à accolades, valeur filtrée)', async function () {
    assert.deepEqual(await noms('{for it in $liste}<svg viewbox={it.v}><use xlink:href={it.v}></use></svg>{end}'), ['viewBox', 'xlink:href'])
    assert.deepEqual(await noms('{for it in $liste}<svg viewbox="{it.v}" preserveaspectratio="a {it.v} b"></svg>{end}'), ['preserveAspectRatio', 'viewBox'])
    assert.deepEqual(await noms('{for it in $liste}<svg viewbox="0 0 {$x} {it.v}"></svg>{end}'), ['viewBox'])
    assert.deepEqual(await noms('{for it in $liste}<svg><linearGradient gradientunits={it.id === $x ? \'userSpaceOnUse\' : \'objectBoundingBox\'}></linearGradient></svg>{end}'), ['gradientUnits'])
  })

  it('un nom écrit avec d\'autres majuscules ou un attribut étranger en majuscules reçoit le nom du standard', async function () {
    for (const ecrit of ['Viewbox', 'VIEWBOX', 'ViewBox']) assert.deepEqual(await noms(`<svg ${ecrit}={$x}></svg>`), ['viewBox'], ecrit)
    for (const ecrit of ['XLINK:HREF', 'Xlink:Href']) assert.deepEqual(await noms(`<svg><use ${ecrit}={$x}></use></svg>`), ['xlink:href'], ecrit)
  })

  it('un nom déjà écrit avec sa casse SVG ou sans majuscule dans le standard ne change pas', async function () {
    assert.deepEqual(await noms('<svg viewBox={$x} preserveAspectRatio={$x} width={$x}><linearGradient gradientUnits={$x} x1={$x}></linearGradient><use href={$x} xlink:href={$x}></use></svg>'), ['gradientUnits', 'href', 'preserveAspectRatio', 'viewBox', 'width', 'x1', 'xlink:href'])
  })

  it('un élément HTML garde le nom écrit, dans un <svg> aussi quand il est sous un <foreignObject>', async function () {
    assert.deepEqual(await noms('<div viewbox={$x} gradientunits={$x} xlink:href={$x}></div>'), ['gradientunits', 'viewbox', 'xlink:href'])
    assert.deepEqual(await noms('<svg><foreignObject><div viewbox={$x} xlink:href={$x}></div></foreignObject></svg>'), ['viewbox', 'xlink:href'])
    assert.deepEqual(await noms('<svg><foreignObject>{if $x}<div viewbox={$x}></div>{end}{for it in $liste}<p xlink:href={it.v}></p>{end}</foreignObject></svg>'), ['viewbox', 'xlink:href'])
    assert.deepEqual(await noms('{for it in $liste}<div viewbox={it.v} xlink:href="{it.v}"></div>{end}'), ['viewbox', 'xlink:href'])
  })

  it('un élément MathML rétablit definitionURL, un élément HTML garde definitionurl', async function () {
    assert.deepEqual(await noms('<math><mi definitionurl={$x}>x</mi></math>'), ['definitionURL'])
    assert.deepEqual(await noms('<math definitionurl={$x}></math>'), ['definitionURL'])
    assert.deepEqual(await noms('{for it in $liste}<math><mi definitionurl={it.v}>x</mi></math>{end}'), ['definitionURL'])
    assert.deepEqual(await noms('<div definitionurl={$x}></div>'), ['definitionurl'])
  })

  it('l\'élément <svg> lui-même est SVG, même posé dans du HTML ; un contenu de {if} ou de {for} placé dans un <svg> l\'est aussi', async function () {
    assert.deepEqual(await noms('<div><svg viewbox={$x}></svg></div>'), ['viewBox'])
    assert.deepEqual(await noms('<svg>{if $x}<use xlink:href={$x}></use>{end}</svg>'), ['xlink:href'])
    assert.deepEqual(await noms('<svg>{for it in $liste}<use xlink:href={it.v}></use>{end}</svg>'), ['xlink:href'])
  })
})
