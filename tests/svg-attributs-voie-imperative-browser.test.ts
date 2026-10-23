// les attributs des éléments SVG sont posés comme le fait l'analyseur HTML du navigateur par la voie qui bâtit les éléments un par un (une branche de `{await}`
// qui a des mises à jour : un `{if}`, un `{for}`, une interpolation, un `@class`) : un `viewbox` écrit en minuscules devient `viewBox` (table « adjust SVG
// attributes » du standard : `gradientunits`, `preserveaspectratio`, `stddeviation`, `pathlength`…), et `xlink:href`, `xml:lang`, `xmlns`, `xmlns:xlink`… sont
// posés dans leur espace de noms (table « adjust foreign attributes »). Sans cela un `viewbox` ne met pas le dessin à l'échelle, un dégradé garde ses unités par
// défaut et une icône `<use xlink:href>` ne montre rien : l'attribut sans espace de noms n'est pas celui que `<use>` lit.
// Les valeurs calculées (`viewbox={…}`) passent par le même chemin. Les éléments HTML (dont ceux d'un `<foreignObject>`) gardent leurs attributs tels quels ;
// un élément MathML rétablit `definitionURL`.
// Chaque dessin a son témoin, le même dessin à la racine du composant (lu par l'analyseur HTML du navigateur) : un témoin faux dirait que le test lui-même
// est faux, il arrête donc le cas aussitôt. La promesse est tenue par le test (`finir()`), pour que la branche d'attente existe avant l'arrivée.
// Les trois modes : développement, production en fichiers séparés, production en un seul fichier. Chromium réel. Le code émis est aussi lu directement.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { generateCreateFnBody, SVG_NS, MATH_NS } from '../src/generator/paths.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'

const XLINK = 'http://www.w3.org/1999/xlink'
const XML   = 'http://www.w3.org/XML/1998/namespace'
const XMLNS = 'http://www.w3.org/2000/xmlns/'

// la table « adjust SVG attributes » du standard HTML : les attributs SVG dont le nom porte des majuscules, que l'analyseur HTML rétablit depuis les minuscules
const ATTRIBUTS_SVG = ['attributeName', 'attributeType', 'baseFrequency', 'baseProfile', 'calcMode', 'clipPathUnits', 'diffuseConstant', 'edgeMode', 'filterUnits', 'glyphRef', 'gradientTransform', 'gradientUnits', 'kernelMatrix', 'kernelUnitLength', 'keyPoints', 'keySplines', 'keyTimes', 'lengthAdjust', 'limitingConeAngle', 'markerHeight', 'markerUnits', 'markerWidth', 'maskContentUnits', 'maskUnits', 'numOctaves', 'pathLength', 'patternContentUnits', 'patternTransform', 'patternUnits', 'pointsAtX', 'pointsAtY', 'pointsAtZ', 'preserveAlpha', 'preserveAspectRatio', 'primitiveUnits', 'refX', 'refY', 'repeatCount', 'repeatDur', 'requiredExtensions', 'requiredFeatures', 'specularConstant', 'specularExponent', 'spreadMethod', 'startOffset', 'stdDeviation', 'stitchTiles', 'surfaceScale', 'systemLanguage', 'tableValues', 'targetX', 'targetY', 'textLength', 'viewBox', 'viewTarget', 'xChannelSelector', 'yChannelSelector', 'zoomAndPan']

// la table « adjust foreign attributes » : nom qualifié (en minuscules) → espace de noms dans lequel l'analyseur HTML pose l'attribut
const ATTRIBUTS_ETRANGERS: Record<string, string> = {
  'xlink:actuate': XLINK, 'xlink:arcrole': XLINK, 'xlink:href': XLINK, 'xlink:role': XLINK, 'xlink:show': XLINK, 'xlink:title': XLINK, 'xlink:type': XLINK,
  'xml:lang': XML, 'xml:space': XML,
  'xmlns': XMLNS, 'xmlns:xlink': XMLNS
}

// les mêmes noms qualifiés, mais que l'analyseur laisse sans espace de noms : rien ne les ajuste
const ATTRIBUTS_LAISSES = ['xml:base', 'xml:id', 'xlink:foo', 'xmlns:foo', 'xml:foo']

const RECT  = '<rect class="r" x="0" y="0" width="10" height="20" fill="red"></rect>'
const STOPS = '<stop offset="0" stop-color="red"></stop><stop offset="1" stop-color="blue"></stop>'

// le dessin : deux <svg> qui ne diffèrent que par l'écriture de leurs attributs (en minuscules, comme l'analyseur HTML les accepte, puis avec leur casse SVG),
// puis un sprite : deux dégradés aux unités en espace utilisateur (`gradientunits` puis `gradientUnits`), une icône référencée en `xlink:href` puis une autre
// en `href`, un texte en `xml:lang`. `sfx` distingue les identifiants du dessin de la branche et ceux du témoin (deux `url(#…)` de même nom dans une même
// ombre se confondraient) ; la langue du texte n'est pas celle du document (`fr`), pour que `:lang()` ne réponde pas par héritage
const sprite = (sfx: string, texte: string, attr: (nom: string, defaut: string) => string) => `<defs>
      <linearGradient id="gm${sfx}" gradientunits${attr('unites', '="userSpaceOnUse"')} x1="0" y1="0" x2="100" y2="0">${STOPS}</linearGradient>
      <linearGradient id="gc${sfx}" gradientUnits${attr('unites', '="userSpaceOnUse"')} x1="0" y1="0" x2="100" y2="0">${STOPS}</linearGradient>
      <rect id="a${sfx}" width="20" height="20" fill="green"></rect>
    </defs>
    <use class="ux" xlink:href${attr('cible', `="#a${sfx}"`)} x="0" y="0"></use>
    <use class="uh" href${attr('cible', `="#a${sfx}"`)} x="40" y="0"></use>
    <text class="tx" xml:lang${attr('langue', '="de"')} x="0" y="90">${texte}</text>`

// les attributs écrits en dur, ou calculés : `calcule` donne l'écriture `={…}` d'une clé (`v.cadre` dans la branche, `$cadre` pour le témoin)
const dur = (_nom: string, defaut: string) => defaut

const dessin = (classe: string, sfx: string, texte: string, calcule: ((nom: string) => string) | null, avecSi: boolean) => {
  const attr = calcule ? (nom: string, _defaut: string) => '=' + calcule(nom) : dur
  const si   = (contenu: string) => avecSi ? `{if $on}\n      ${contenu}\n    {end}` : contenu
  const vb   = calcule ? calcule('cadre') : '"0 0 10 20"'
  const par  = calcule ? calcule('ratio') : '"none"'
  return `<div class="${classe}">
  <svg class="min" viewbox=${vb} preserveaspectratio=${par} width="100" height="100">
    ${si(RECT)}
  </svg>
  <svg class="camel" viewBox=${vb} preserveAspectRatio=${par} width="100" height="100">
    ${si(RECT)}
  </svg>
  <svg class="sprite" viewBox="0 0 100 100" width="100" height="100" xmlns="${SVG_NS}" xmlns:xlink="${XLINK}">
    ${si(sprite(sfx, texte, attr))}
  </svg>
</div>`
}

// une icône dont les valeurs calculées sont absentes (`null`, `undefined`) : aucun attribut ne doit rester, pas même celui que la pose a déclaré dans son espace de noms
const vide = (classe: string, v: string) => `<div class="${classe}"><svg><use class="vide" xlink:href={${v}} xml:lang={${v}}></use></svg></div>`

const ENTETE = `<script>
  $on     = true
  $val    = 'ok'
  $cadre  = '0 0 10 20'
  $ratio  = 'none'
  $unites = 'userSpaceOnUse'
  $cible  = '#at'
  $langue = 'de'
  $rien   = null
  fin     = null
  $p      = new Promise((res) -> fin = res)
  @finir    = -> fin({ cadre: '0 0 10 20', ratio: 'none', unites: 'userSpaceOnUse', cible: '#ab', langue: 'de', txt: 'ok' })
  @relancer = -> $p = new Promise((res) -> fin = res)
</script>
`

const SOURCE = (branche: string, temoin: string) => ENTETE + `{await $p}
  <i class="att">attente</i>
{success v}
  ${branche}
{end}
${temoin}
`

// tous les attributs des trois tables, sur un seul élément : la liste de l'élément de la branche doit être celle du témoin
const TOUS = [...ATTRIBUTS_SVG.map((n) => n.toLowerCase()), ...Object.keys(ATTRIBUTS_ETRANGERS)].map((nom, i) => `${nom}="v${i}"`).join(' ')

const SOURCES: Record<string, string> = {
  // le dessin dans le corps de `{success}` (la branche a une interpolation : elle est bâtie élément par élément)
  'sa-corps.mjs': SOURCE(dessin('dessin', 'b', '{v.txt}', null, false), dessin('temoin', 't', '{$val}', null, false)),
  // le contenu des <svg> dans un `{if}` de la branche : le fragment du `{if}` vit dans un <svg> qui est hors de lui
  'sa-si.mjs': SOURCE(dessin('dessin', 'b', '{v.txt}', null, true), dessin('temoin', 't', '{$val}', null, false)),
  // les attributs calculés : le témoin les lit dans des variables du composant, la branche dans la valeur de la promesse
  'sa-dyn.mjs': SOURCE(dessin('dessin', 'b', '{v.txt}', (n) => `{v.${n}}`, false) + '\n  ' + vide('dessin-vide', 'v.rien'), dessin('temoin', 't', '{$val}', (n) => `{$${n}}`, false) + '\n' + vide('temoin-vide', '$rien')),
  // les éléments HTML (hors d'un <svg>, puis sous un <foreignObject>) gardent leurs attributs, un élément MathML rétablit `definitionURL`
  'sa-html-math.mjs': SOURCE(`<section class="coin" viewbox="0 0 1 1" gradientunits="x" xlink:href="#h" xml:lang="de" xmlns="http://www.w3.org/1999/xhtml">{v.txt}</section>
  <math class="formule"><mi class="m1" definitionurl="http://exemple.test/x">x</mi></math>
  <svg viewBox="0 0 10 10" width="10" height="10"><foreignObject width="10" height="10"><div class="h4" viewbox="0 0 1 1" xlink:href="#b" xml:lang="de"></div></foreignObject></svg>`,
  `<section class="coin-t" viewbox="0 0 1 1" gradientunits="x" xlink:href="#h" xml:lang="de" xmlns="http://www.w3.org/1999/xhtml">{$val}</section>
<math class="formule-t"><mi class="m1" definitionurl="http://exemple.test/x">x</mi></math>
<svg class="temoin" viewBox="0 0 10 10" width="10" height="10"><foreignObject width="10" height="10"><div class="h4" viewbox="0 0 1 1" xlink:href="#b" xml:lang="de"></div></foreignObject></svg>`),
  // tous les attributs des trois tables sur un seul élément
  'sa-table.mjs': SOURCE(`<svg class="dessin"><g class="tout" ${TOUS}>{v.txt}</g></svg>`, `<svg class="temoin"><g class="tout" ${TOUS}>{$val}</g></svg>`)
}
const BALISES = Object.keys(SOURCES).map((f) => 'mjs-' + f.replace('.mjs', ''))

const cibles = new Map<Mode, Promise<Cible>>()
const cible  = (mode: Mode) => {
  if (!cibles.has(mode)) cibles.set(mode, construire(mode, SOURCES, BALISES))
  return cibles.get(mode)!
}

// le composant est monté quand son témoin est dans l'ombre, ou quand il est tombé (la page montre alors un bandeau d'erreur) : le cas lit ensuite ce qui reste
const pret = async (page: any, balise: string) => {
  await page.waitForFunction(`(() => {
    const h = document.querySelector('${balise}')
    return !!h && (h.classList.contains('mjs-error') || !!(h._shadow && h._shadow.querySelector('.temoin, .mjs-fatal-error')))
  })()`, null, { timeout: 10000 })
  await page.waitForTimeout(150)
}

// un appel sur le composant (`finir()`, `relancer()`…), puis le temps de la mise à jour
const regler = async (page: any, balise: string, appel: string) => {
  await page.evaluate(`(() => { document.querySelector('${balise}').${appel}; return null })()`)
  await page.waitForTimeout(200)
}

// note un écart, sans arrêter le cas : tous les écarts d'un cas sont rendus ensemble
const verifier = (ecarts: string[], quoi: string, lu: unknown, attendu: unknown) => {
  if (lu !== attendu) ecarts.push(`${quoi} : attendu ${JSON.stringify(attendu)}, lu ${JSON.stringify(lu) ?? 'rien'}`)
}

// le composant a survécu : un plantage vide son ombre, lui pose la classe `mjs-error` et y met un bandeau `mjs-fatal-error`
const vivant = (page: any, balise: string): Promise<boolean> => page.evaluate(`(() => {
  const h = document.querySelector('${balise}')
  return !h.classList.contains('mjs-error') && !h._shadow.querySelector('.mjs-fatal-error') && !!h._shadow.querySelector('.temoin')
})()`)

type Rapport = Record<string, unknown>

// ce que le navigateur fait des attributs du dessin : le cadre et le ratio mettent le dessin à l'échelle (la boîte du rectangle), les dégradés prennent leurs
// unités, les icônes se résolvent, le texte prend sa langue, le <svg> garde ses déclarations d'espaces de noms
const ATTENDU: Rapport = {
  'min : attribut viewBox':                        '0 0 10 20',
  'min : viewBox.baseVal':                         '10x20',
  'min : preserveAspectRatio.baseVal.align':       1,
  'min : boîte du rect':                           '100x100',
  'camel : attribut viewBox':                      '0 0 10 20',
  'camel : viewBox.baseVal':                       '10x20',
  'camel : preserveAspectRatio.baseVal.align':     1,
  'camel : boîte du rect':                         '100x100',
  'dégradé en minuscules : attribut gradientUnits': 'userSpaceOnUse',
  'dégradé en minuscules : gradientUnits.baseVal': 1,
  'dégradé casse SVG : attribut gradientUnits':    'userSpaceOnUse',
  'dégradé casse SVG : gradientUnits.baseVal':     1,
  'use xlink:href : href.baseVal':                 '#a',
  'use xlink:href : attribut de l\'espace xlink':  '#a',
  'use xlink:href : boîte':                        '20x20',
  'use href : href.baseVal':                       '#a',
  'use href : boîte':                              '20x20',
  'texte xml:lang : attribut de l\'espace xml':    'de',
  'texte xml:lang : :lang(de)':                    true,
  'svg xmlns:xlink : attribut de l\'espace xmlns': XLINK,
  'svg xmlns : attribut de l\'espace xmlns':       SVG_NS
}

// la fonction tourne dans la page : le dessin du conteneur `sel`, lu champ par champ ; `absent` quand l'élément n'y est pas
const RAPPORT = ([balise, sel]: [string, string]): Rapport | null => {
  const racine = (document.querySelector(balise) as any)._shadow
  const cont   = racine.querySelector(sel)
  if (!cont) return null
  const XLINK_NS = 'http://www.w3.org/1999/xlink'
  const XML_NS   = 'http://www.w3.org/XML/1998/namespace'
  const XMLNS_NS = 'http://www.w3.org/2000/xmlns/'
  const boite    = (n: any): string => {
    const r = n.getBoundingClientRect()
    return Math.round(r.width) + 'x' + Math.round(r.height)
  }
  // la cible d'une icône sans le dernier caractère : le dessin et son témoin ne diffèrent que par ce suffixe
  const sans     = (v: string | null): string | null => v === null ? null : v.slice(0, -1)
  const un       = (n: any, f: (x: any) => unknown): unknown => n ? f(n) : 'absent'
  const r: Rapport = {}
  for (const cle of ['min', 'camel']) {
    const svg = cont.querySelector('.' + cle)
    r[`${cle} : attribut viewBox`]                  = un(svg, (s) => s.getAttribute('viewBox'))
    r[`${cle} : viewBox.baseVal`]                   = un(svg, (s) => s.viewBox.baseVal ? s.viewBox.baseVal.width + 'x' + s.viewBox.baseVal.height : 'aucun')
    r[`${cle} : preserveAspectRatio.baseVal.align`] = un(svg, (s) => s.preserveAspectRatio.baseVal.align)
    r[`${cle} : boîte du rect`]                     = un(svg, (s) => s.querySelector('.r') ? boite(s.querySelector('.r')) : 'absent')
  }
  const gm = cont.querySelector('[id^="gm"]')
  const gc = cont.querySelector('[id^="gc"]')
  r['dégradé en minuscules : attribut gradientUnits'] = un(gm, (g) => g.getAttribute('gradientUnits'))
  r['dégradé en minuscules : gradientUnits.baseVal']  = un(gm, (g) => g.gradientUnits.baseVal)
  r['dégradé casse SVG : attribut gradientUnits']     = un(gc, (g) => g.getAttribute('gradientUnits'))
  r['dégradé casse SVG : gradientUnits.baseVal']      = un(gc, (g) => g.gradientUnits.baseVal)
  const ux = cont.querySelector('.ux')
  const uh = cont.querySelector('.uh')
  r['use xlink:href : href.baseVal']                = un(ux, (u) => sans(u.href.baseVal))
  r['use xlink:href : attribut de l\'espace xlink'] = un(ux, (u) => sans(u.getAttributeNS(XLINK_NS, 'href')))
  r['use xlink:href : boîte']                       = un(ux, boite)
  r['use href : href.baseVal']                      = un(uh, (u) => sans(u.href.baseVal))
  r['use href : boîte']                             = un(uh, boite)
  const tx = cont.querySelector('.tx')
  r['texte xml:lang : attribut de l\'espace xml'] = un(tx, (t) => t.getAttributeNS(XML_NS, 'lang'))
  r['texte xml:lang : :lang(de)']                 = un(tx, (t) => t.matches(':lang(de)'))
  const sp = cont.querySelector('.sprite')
  r['svg xmlns:xlink : attribut de l\'espace xmlns'] = un(sp, (s) => s.getAttributeNS(XMLNS_NS, 'xlink'))
  r['svg xmlns : attribut de l\'espace xmlns']       = un(sp, (s) => s.getAttributeNS(XMLNS_NS, 'xmlns'))
  return r
}

const lire = (page: any, balise: string, sel: string): Promise<Rapport | null> => page.evaluate(RAPPORT, [balise, sel])

// un champ après l'autre : tous les écarts du dessin sont rendus ensemble ; `champs` restreint la comparaison à une partie du rapport
function comparer(ecarts: string[], quoi: string, lu: Rapport | null, attendu: Rapport, champs?: (cle: string) => boolean) {
  if (!lu) { ecarts.push(`${quoi} : le dessin n'est pas dans la page`); return }
  for (const champ of Object.keys(attendu)) {
    if (!champs || champs(champ)) verifier(ecarts, `${quoi}, ${champ}`, lu[champ], attendu[champ])
  }
}

// les attributs d'un élément, un par un : espace de noms, nom qualifié et valeur ; l'ordre ne compte pas, et la classe est laissée (le dessin et son témoin n'ont pas la même)
const DESCRIPTION = ([balise, sel]: [string, string]): string[] | null => {
  const n = (document.querySelector(balise) as any)._shadow.querySelector(sel)
  return n ? Array.from(n.attributes as ArrayLike<any>).filter((a: any) => a.name !== 'class').map((a: any) => `${a.namespaceURI ?? 'aucun'} | ${a.name} = ${a.value}`).sort() : null
}

const attributs = (page: any, balise: string, sel: string): Promise<string[] | null> => page.evaluate(DESCRIPTION, [balise, sel])

// les attributs de l'élément de la branche, comparés à ceux de son témoin : ce qui manque, ce qui est de trop
function memesAttributs(ecarts: string[], quoi: string, branche: string[] | null, temoin: string[] | null) {
  if (!branche) { ecarts.push(`${quoi} : l'élément n'est pas dans la page`); return }
  if (!temoin) { ecarts.push(`${quoi} : le témoin n'est pas dans la page`); return }
  const manque = temoin.filter((a) => !branche.includes(a))
  const trop   = branche.filter((a) => !temoin.includes(a))
  if (manque.length) ecarts.push(`${quoi} : ${manque.length} attributs manquent (${manque.slice(0, 4).join(' ; ')}${manque.length > 4 ? '…' : ''})`)
  if (trop.length)   ecarts.push(`${quoi} : ${trop.length} attributs de trop (${trop.slice(0, 4).join(' ; ')}${trop.length > 4 ? '…' : ''})`)
}

for (const mode of ['dev-parents-avant', 'split', 'bundle'] as const) describe(`attributs des éléments SVG dans une branche de {await} (${mode}, Chromium réel)`, function () {
  this.timeout(120000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright.chromium.executablePath())
    if (!present) { console.log('  ℹ️  chromium non installé, test des attributs SVG sauté. Activer : `npx playwright install chromium`'); return }
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
      await scenario(o.page, ecarts)
      assert.deepEqual([...ecarts, ...graves(o).map((g) => `erreur de la page : ${g}`)], [])
    } finally {
      await o.fermer()
    }
  }

  it('les composants se compilent', async function () {
    if (!present) { this.skip(); return }
    await cible(mode)
  })

  it('dans le corps de {success} : viewbox, gradientunits, xlink:href, xml:lang, xmlns… sont posés comme à la racine', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-sa-corps'
    await jouer(B, async (page, ecarts) => {
      verifier(ecarts, 'composant vivant, à la création', await vivant(page, B), true)
      assert.deepEqual(await lire(page, B, '.temoin'), ATTENDU, 'le dessin hors de {await}, témoin, est faux : le test lui-même est à revoir')
      verifier(ecarts, 'avant l\'arrivée, le dessin de la branche', await lire(page, B, '.dessin'), null)
      await regler(page, B, 'finir()')
      verifier(ecarts, 'composant vivant, après l\'arrivée', await vivant(page, B), true)
      comparer(ecarts, 'dessin de {success}', await lire(page, B, '.dessin'), ATTENDU)
    })
  })

  it('dans un {if} de {success} : les attributs du fragment posé dans un <svg> qui est hors de lui sont ajustés, aussi quand la branche se refait après une promesse remplacée', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-sa-si'
    await jouer(B, async (page, ecarts) => {
      assert.deepEqual(await lire(page, B, '.temoin'), ATTENDU, 'le dessin hors de {await}, témoin, est faux : le test lui-même est à revoir')
      await regler(page, B, 'finir()')
      verifier(ecarts, 'composant vivant, après l\'arrivée', await vivant(page, B), true)
      comparer(ecarts, 'dessin du {if}, à l\'arrivée', await lire(page, B, '.dessin'), ATTENDU)
      await regler(page, B, 'relancer()')
      verifier(ecarts, 'promesse remplacée, le dessin de la branche est retiré', await lire(page, B, '.dessin'), null)
      await regler(page, B, 'finir()')
      verifier(ecarts, 'composant vivant, branche refaite', await vivant(page, B), true)
      comparer(ecarts, 'dessin du {if}, branche refaite', await lire(page, B, '.dessin'), ATTENDU)
    })
  })

  it('attributs calculés dans {success} (viewbox={…}, xlink:href={…}, xml:lang={…}) : posés sous le nom et dans l\'espace de noms que donne l\'analyseur HTML', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-sa-dyn'
    await jouer(B, async (page, ecarts) => {
      // à la racine, un attribut calculé écrit en minuscules (`viewbox={…}`, `gradientunits={…}`) n'est pas juste non plus : le gabarit en porte un exemplaire vide, que la mise à jour ne retrouve pas sous le nom en minuscules, et elle en crée un second ; ce défaut n'est pas celui de la branche, le témoin n'est lu que sur ce que la racine tient
      const temoin = await lire(page, B, '.temoin')
      const sain   = (cle: string) => !cle.startsWith('min :') && !cle.startsWith('dégradé en minuscules')
      comparer(ecarts, 'témoin à la racine', temoin, ATTENDU, sain)
      assert.deepEqual(await attributs(page, B, '.temoin-vide .vide'), [], 'l\'icône aux valeurs absentes, témoin, a des attributs : le test lui-même est à revoir')
      await regler(page, B, 'finir()')
      verifier(ecarts, 'composant vivant, après l\'arrivée', await vivant(page, B), true)
      comparer(ecarts, 'dessin de {success}', await lire(page, B, '.dessin'), ATTENDU)
      memesAttributs(ecarts, 'icône aux valeurs calculées absentes', await attributs(page, B, '.dessin-vide .vide'), [])
    })
  })

  it('les éléments HTML gardent leurs attributs tels quels, un élément MathML rétablit definitionURL, comme à la racine', async function () {
    if (!present) { this.skip(); return }
    const B     = 'mjs-sa-html-math'
    const paires: Array<[string, string, string]> = [
      ['élément HTML', '.coin', '.coin-t'],
      ['élément HTML sous un <foreignObject>', 'svg:not(.temoin) .h4', 'svg.temoin .h4'],
      ['élément MathML', '.formule .m1', '.formule-t .m1']
    ]
    await jouer(B, async (page, ecarts) => {
      for (const [quoi, , sel] of paires) assert.ok(await attributs(page, B, sel), `${quoi}, témoin : absent de la page`)
      await regler(page, B, 'finir()')
      verifier(ecarts, 'composant vivant, après l\'arrivée', await vivant(page, B), true)
      for (const [quoi, selBranche, selTemoin] of paires) memesAttributs(ecarts, quoi, await attributs(page, B, selBranche), await attributs(page, B, selTemoin))
    })
  })

  it('les trois tables, sur un seul élément : ni attribut manquant ni attribut de trop par rapport à la racine', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-sa-table'
    await jouer(B, async (page, ecarts) => {
      const temoin = await attributs(page, B, '.temoin .tout')
      assert.equal(temoin?.length, ATTRIBUTS_SVG.length + Object.keys(ATTRIBUTS_ETRANGERS).length, 'le témoin n\'a pas tous les attributs : le test lui-même est à revoir')
      await regler(page, B, 'finir()')
      verifier(ecarts, 'composant vivant, après l\'arrivée', await vivant(page, B), true)
      memesAttributs(ecarts, 'élément aux attributs des trois tables', await attributs(page, B, '.dessin .tout'), temoin)
    })
  })
})

describe('attributs des éléments SVG : les tables du standard, lues par le navigateur et par le code émis', function () {
  this.timeout(120000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright.chromium.executablePath())
    if (!present) { console.log('  ℹ️  chromium non installé, test des tables d\'attributs sauté. Activer : `npx playwright install chromium`'); return }
    browser = await playwright.chromium.launch()
  })

  after(async () => {
    if (browser) await browser.close()
  })

  // les attributs que la fonction pose, dans l'ordre : `nom=valeur` pour un `setAttribute`, `espace de noms | nom=valeur` pour un `setAttributeNS`, `calculé nom`
  // pour une valeur calculée (la fonction du runtime qui la pose reçoit le nom)
  const poses = (html: string, foreignNsRoot?: string): string[] => {
    const { body } = generateCreateFnBody(html, { forceImperative: true, foreignNsRoot })
    const lus: string[] = []
    const valeur = (ecrit: string): string => ecrit === '\'\'' ? '' : JSON.parse(ecrit)
    for (const ligne of body.split('\n')) {
      let m: RegExpMatchArray | null
      if ((m = ligne.match(/^\w+\.setAttributeNS\(("[^"]*"), ("[^"]*"), ("[^"]*"|'')\);$/))) lus.push(`${JSON.parse(m[1])} | ${JSON.parse(m[2])}=${valeur(m[3])}`)
      else if ((m = ligne.match(/^\w+\.setAttribute\(("[^"]*"), ("[^"]*"|'')\);$/))) lus.push(`${JSON.parse(m[1])}=${valeur(m[2])}`)
      else if ((m = ligne.match(/^µ\._mjs_updAttrNode\(\w+, ("[^"]*"), .*\);$/))) lus.push(`calculé ${JSON.parse(m[1])}`)
    }
    return lus
  }

  it('l\'analyseur HTML du navigateur ajuste chacun des attributs des trois tables, et rien d\'autre (le navigateur fait foi)', async function () {
    if (!present) { this.skip(); return }
    const ctx  = await browser.newContext()
    const page = await ctx.newPage()
    try {
      await page.setContent('<!doctype html><svg id="s"></svg><math id="m"></math><div id="h"></div>')
      await page.evaluate('window.__name = (f) => f')
      const noms = [...ATTRIBUTS_SVG.map((n) => n.toLowerCase()), ...Object.keys(ATTRIBUTS_ETRANGERS), ...ATTRIBUTS_LAISSES, 'definitionurl']
      const lus = await page.evaluate((entrees: string[]) => entrees.map((nom) => {
        const lire = (id: string, balise: string): string => {
          const hote = document.getElementById(id) as any
          hote.innerHTML = '<' + balise + ' ' + nom + '="1"></' + balise + '>'
          const a = hote.firstChild.attributes[0]
          return (a.namespaceURI ?? 'aucun') + ' | ' + a.name
        }
        return [nom, lire('s', 'g'), lire('m', 'mi'), lire('h', 'span')]
      }), noms)
      const attendu = (nom: string): string[] => {
        const camel = ATTRIBUTS_SVG.find((n) => n.toLowerCase() === nom)
        const aucun = (n: string) => `aucun | ${n}`
        if (camel) return [aucun(camel), aucun(nom), aucun(nom)]
        if (ATTRIBUTS_ETRANGERS[nom]) return [`${ATTRIBUTS_ETRANGERS[nom]} | ${nom}`, `${ATTRIBUTS_ETRANGERS[nom]} | ${nom}`, aucun(nom)]
        if (nom === 'definitionurl') return [aucun(nom), aucun('definitionURL'), aucun(nom)]
        return [aucun(nom), aucun(nom), aucun(nom)]
      }
      const ecarts = (lus as string[][]).filter(([nom, ...trois]) => trois.join(' / ') !== attendu(nom).join(' / ')).map(([nom, ...trois]) => `${nom} : lu ${trois.join(' / ')}, attendu ${attendu(nom).join(' / ')}`)
      assert.deepEqual(ecarts, [], 'les listes du test sont celles du navigateur')
    } finally {
      await ctx.close()
    }
  })

  it('le code émis pose chaque attribut de la table SVG avec sa casse, écrit en minuscules ou avec ses majuscules, sur un élément SVG et sur le <svg> lui-même', function () {
    const ecarts: string[] = []
    for (const nom of ATTRIBUTS_SVG) {
      for (const ecrit of [nom.toLowerCase(), nom]) {
        const lu = poses(`<svg><g ${ecrit}="1"></g></svg>`).join(' ')
        if (lu !== `${nom}=1`) ecarts.push(`<g ${ecrit}> lu ${lu || 'rien'}`)
        const racine = poses(`<svg ${ecrit}="1"></svg>`).join(' ')
        if (racine !== `${nom}=1`) ecarts.push(`<svg ${ecrit}> lu ${racine || 'rien'}`)
      }
    }
    assert.equal(ecarts.length, 0, `${ecarts.length} écritures sur ${ATTRIBUTS_SVG.length * 4} posées sans la casse SVG : ${ecarts.slice(0, 5).join(', ')}…`)
  })

  it('le code émis pose les attributs étrangers (xlink, xml, xmlns) dans leur espace de noms, écrits en minuscules ou en majuscules', function () {
    const ecarts: string[] = []
    for (const [nom, ns] of Object.entries(ATTRIBUTS_ETRANGERS)) {
      for (const ecrit of [nom, nom.toUpperCase()]) {
        const lu = poses(`<svg><use ${ecrit}="1"></use></svg>`).join(' ')
        if (lu !== `${ns} | ${nom}=1`) ecarts.push(`<use ${ecrit}> lu ${lu || 'rien'}`)
      }
    }
    assert.equal(ecarts.length, 0, `${ecarts.length} écritures sur ${Object.keys(ATTRIBUTS_ETRANGERS).length * 2} posées sans leur espace de noms : ${ecarts.slice(0, 5).join(', ')}…`)
    // ce que l'analyseur laisse sans espace de noms reste un attribut ordinaire
    for (const nom of ATTRIBUTS_LAISSES) assert.equal(poses(`<svg><use ${nom}="1"></use></svg>`).join(' '), `${nom}=1`, `${nom} reste sans espace de noms`)
    // un attribut sans valeur (`<svg xmlns>`) est posé de même
    assert.equal(poses('<svg xmlns></svg>').join(' '), `${XMLNS} | xmlns=`)
  })

  it('le code émis ajuste aussi les attributs calculés : le nom passe par la table, et celui qui a un espace de noms y est déclaré avant que sa valeur ne soit posée', function () {
    assert.equal(poses('<svg viewbox=\'${a}\' preserveAspectRatio="${b}"></svg>').join(' '), 'calculé viewBox calculé preserveAspectRatio')
    assert.equal(poses('<svg><use xlink:href=\'${a}\' href=\'${b}\'></use><text xml:lang=\'${c}\'>x</text></svg>').join(' '), `${XLINK} | xlink:href= calculé xlink:href calculé href ${XML} | xml:lang= calculé xml:lang`)
    assert.equal(poses('<div viewbox=\'${a}\' xlink:href=\'${b}\'></div>').join(' '), 'calculé viewbox calculé xlink:href', 'un élément HTML garde le nom écrit et reste sans espace de noms')
  })

  it('le code émis ne change rien pour HTML (dont le contenu d\'un <foreignObject>) ni pour MathML, sauf definitionurl', function () {
    const html = 'viewbox="1" gradientunits="1" xlink:href="#a" xml:lang="de" xmlns="x" preserveAspectRatio="none"'
    const garde = 'viewbox=1 gradientunits=1 xlink:href=#a xml:lang=de xmlns=x preserveAspectRatio=none'
    assert.equal(poses(`<div ${html}></div>`).join(' '), garde)
    assert.equal(poses(`<svg><foreignObject><div ${html}></div></foreignObject></svg>`).join(' '), garde)
    assert.equal(poses(`<math><mi definitionurl="x" viewbox="1" xlink:href="#a"></mi></math>`).join(' '), 'definitionURL=x viewbox=1 xlink:href=#a')
    assert.equal(poses('<mi definitionurl="x" DefinitionURL="y"></mi>', MATH_NS).join(' '), 'definitionURL=x definitionURL=y')
  })

  it('le code émis ajuste les attributs d\'un élément posé dans un <svg> ou un <math> qui vit hors du fragment', function () {
    assert.equal(poses('<use xlink:href="#a" viewbox="0 0 1 1"></use><g><text xml:lang="de" lengthadjust="spacing"></text></g>', SVG_NS).join(' '), `${XLINK} | xlink:href=#a viewBox=0 0 1 1 ${XML} | xml:lang=de lengthAdjust=spacing`)
    assert.equal(poses('<mi definitionurl="x" viewbox="1"></mi>', MATH_NS).join(' '), 'definitionURL=x viewbox=1')
  })
})
