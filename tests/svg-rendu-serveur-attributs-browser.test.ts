// le rendu serveur d'un dessin SVG dont les attributs sont écrits en minuscules et calculés (`viewbox={$cadre}`, `preserveaspectratio={$ratio}`, `gradientunits={$unites}`, `xlink:href={$cible}`,
// `xml:lang={$langue}`) : le HTML du serveur porte l'attribut sous sa forme du standard (`viewBox`, `preserveAspectRatio`, `gradientUnits`, `xlink:href`), UNE seule fois ; le moteur du serveur
// (happy-dom) ne remet pas `viewbox` en `viewBox`, il garde le nom écrit : si le gabarit déclarait `viewbox=''` et que la mise à jour écrivait `viewBox`, la page porterait les deux, et
// le premier (vide) gagne au navigateur. Puis les quatre reprises de la page (`markers`, `positional`, `diff` adoptent le HTML du serveur, `replace` le refait) donnent un DOM juste :
// cadre, ratio et unités lus par le navigateur, icône dans l'espace de noms de XLink, langue dans celui de XML, aucun attribut en double (noms comparés sans la casse) ; puis les
// valeurs changent, l'icône et la langue disparaissent (`null`) et reviennent, et le dessin reste juste.
// Le dessin est joué à la racine du composant, dans un `{if}` (retiré puis refait) et dans les lignes d'un `{for}` avec clé.
// Chromium réel. Un test qui voit quelque chose : contre un `adjustAttr` neutralisé (les noms restent ceux de l'auteur) il est rouge.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, graves, VARIANTES } from './helpers/liaison-navigateur.js'
import type { Cible } from './helpers/liaison-navigateur.js'

const XLINK = 'http://www.w3.org/1999/xlink'
const XML   = 'http://www.w3.org/XML/1998/namespace'

// un jeu de valeurs et ce que le standard en tire : l'alignement et le choix « meet / slice » du ratio, la boîte du rectangle (10 x 20) une fois mis à l'échelle dans un <svg> de 100 x 100,
// les unités du dégradé ; `cible` et `langue` valent `null` quand l'attribut est retiré
type Jeu = { cadre: string, ratio: string, unites: string, cible: string | null, langue: string | null, n: string, larg: number, haut: number, align: string, rect: string }

const A: Jeu = { cadre: '0 0 10 20', ratio: 'none',           unites: 'userSpaceOnUse',    cible: '#a', langue: 'de', n: 'a', larg: 10, haut: 20, align: '1/1', rect: '100x100' }
const B: Jeu = { cadre: '0 0 40 40', ratio: 'xMinYMin slice', unites: 'objectBoundingBox', cible: '#b', langue: 'en', n: 'b', larg: 40, haut: 40, align: '2/2', rect: '25x50' }
const VIDE: Jeu = { ...A, cible: null, langue: null }

type Expr = { cadre: string, ratio: string, unites: string, cible: string, langue: string, n: string }

const RACINE: Expr = { cadre: '$cadre',   ratio: '$ratio',   unites: '$unites',   cible: '$cible',   langue: '$langue',   n: '$n' }
const LIGNE:  Expr = { cadre: 'it.cadre', ratio: 'it.ratio', unites: 'it.unites', cible: 'it.cible', langue: 'it.langue', n: 'it.n' }

const RECT   = '<rect class="r" x="0" y="0" width="10" height="20" fill="red"></rect>'
const STOPS  = '<stop offset="0" stop-color="red"></stop><stop offset="1" stop-color="blue"></stop>'
const SPRITE = '<svg class="sprite" width="0" height="0"><defs><rect id="a" width="20" height="20" fill="green"></rect><rect id="b" width="30" height="30" fill="blue"></rect><rect id="i-a" width="20" height="20" fill="green"></rect><rect id="i-b" width="30" height="30" fill="blue"></rect></defs></svg>'
const PRET   = '<i class="pret"></i>'

// le dessin : un <svg> au cadre et au ratio, un <svg> avec un dégradé, deux icônes (l'adresse seule, puis la chaîne à accolades) et un groupe qui porte une langue, tous écrits en minuscules
const dessin = (e: Expr) => `<div class="dessin">
  <svg class="cadre" viewbox={${e.cadre}} preserveaspectratio={${e.ratio}} width="100" height="100">${RECT}</svg>
  <svg class="contenu" width="100" height="100">
    <linearGradient class="gm" gradientunits={${e.unites}} x1="0" y1="0" x2="100" y2="0">${STOPS}</linearGradient>
    <use class="u" xlink:href={${e.cible}}></use>
    <use class="uc" xlink:href="#i-{${e.n}}"></use>
    <g class="l" xml:lang={${e.langue}}><text x="0" y="50">x</text></g>
  </svg>
</div>`

const lit = (v: string | null) => v === null ? 'null' : `'${v}'`

// les variables d'un jeu, à la racine
const pose = (j: Jeu, marge: string) => [`$cadre  = ${lit(j.cadre)}`, `$ratio  = ${lit(j.ratio)}`, `$unites = ${lit(j.unites)}`, `$cible  = ${lit(j.cible)}`, `$langue = ${lit(j.langue)}`, `$n      = ${lit(j.n)}`].map((l) => marge + l).join('\n')

const VARIABLES = `  $on = true
${pose(A, '  ')}
  @changer = ->
${pose(B, '    ')}
  @vider = ->
    $cible  = null
    $langue = null
  @retour = ->
${pose(A, '    ')}
  @basculer = -> $on = not $on`

const ligne = (id: number, j: Jeu) => `{ id: ${id}, cadre: ${lit(j.cadre)}, ratio: ${lit(j.ratio)}, unites: ${lit(j.unites)}, cible: ${lit(j.cible)}, langue: ${lit(j.langue)}, n: ${lit(j.n)} }`
const liste = (j1: Jeu, j2: Jeu) => `[${ligne(1, j1)}, ${ligne(2, j2)}]`

const SOURCES: Record<string, string> = {
  'sv-racine.mjs': `<script>
${VARIABLES}
</script>
${SPRITE}
${dessin(RACINE)}
${PRET}
`,
  'sv-si.mjs': `<script>
${VARIABLES}
</script>
${SPRITE}
{if $on}
  ${dessin(RACINE)}
{end}
${PRET}
`,
  'sv-pour.mjs': `<script>
  $liste = ${liste(A, B)}
  @changer = -> $liste = ${liste(B, A)}
  @retour  = -> $liste = ${liste(A, B)}
  @vider   = -> $liste = ${liste(VIDE, VIDE)}
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
}
const BALISES = Object.keys(SOURCES).map((f) => 'mjs-' + f.replace('.mjs', ''))

let cible_: Promise<Cible> | null = null
const cible = () => cible_ ??= construire('ssr', SOURCES, BALISES)

// le composant est monté quand sa dernière balise est dans l'ombre, ou quand il est tombé (la page montre alors un bandeau d'erreur) : le cas lit ensuite ce qui reste
const pret = async (page: any, balise: string) => {
  await page.waitForFunction(`(() => {
    const h = document.querySelector('${balise}')
    return !!h && (h.classList.contains('mjs-error') || !!(h._shadow && h._shadow.querySelector('.pret, .mjs-fatal-error')))
  })()`, null, { timeout: 10000 })
  await page.waitForTimeout(300)
}

const regler = async (page: any, balise: string, appel: string) => {
  await page.evaluate(`(() => { document.querySelector('${balise}').${appel}; return null })()`)
  await page.waitForTimeout(250)
}

const vivant = (page: any, balise: string): Promise<boolean> => page.evaluate(`(() => {
  const h = document.querySelector('${balise}')
  return !h.classList.contains('mjs-error') && !h._shadow.querySelector('.mjs-fatal-error') && !!h._shadow.querySelector('.pret')
})()`)

type Rapport = Record<string, unknown>

const verifier = (ecarts: string[], quoi: string, lu: unknown, attendu: unknown) => {
  if (JSON.stringify(lu) !== JSON.stringify(attendu)) ecarts.push(`${quoi} : attendu ${JSON.stringify(attendu)}, lu ${JSON.stringify(lu) ?? 'rien'}`)
}

// ce que la page montre du dessin `sel` (le `rang`-ième de la page) : pour chaque élément, ses attributs un par un (espace de noms, nom qualifié, valeur ; la classe est laissée), ce que le
// navigateur en fait, et les éléments qui portent deux attributs de même nom (comparé sans la casse) ; `null` quand le dessin n'y est pas
const LIRE = ([balise, sel, rang, xlink, xml]: [string, string, number, string, string]): Rapport | null => {
  const cont = (document.querySelector(balise) as any)._shadow.querySelectorAll(sel)[rang]
  if (!cont) return null
  const boite = (n: any): string => {
    const r = n.getBoundingClientRect()
    return Math.round(r.width) + 'x' + Math.round(r.height)
  }
  const attrs = (n: any): string[] => Array.from(n.attributes as ArrayLike<any>).filter((a: any) => a.name !== 'class').map((a: any) => `${a.namespaceURI ?? 'aucun'} | ${a.name} = ${a.value}`).sort()
  const cadre = cont.querySelector('.cadre')
  const gm    = cont.querySelector('.gm')
  const u     = cont.querySelector('.u')
  const uc    = cont.querySelector('.uc')
  const l     = cont.querySelector('.l')
  const doublons: string[] = []
  for (const n of Array.from(cont.querySelectorAll('*')) as any[]) {
    const noms = n.getAttributeNames().map((x: string) => x.toLowerCase())
    if (new Set(noms).size !== noms.length) doublons.push(n.localName + ' : ' + n.getAttributeNames().join(' '))
  }
  return {
    cadre:    { attributs: attrs(cadre), viewBox: cadre.viewBox.baseVal.width + 'x' + cadre.viewBox.baseVal.height, ratio: cadre.preserveAspectRatio.baseVal.align + '/' + cadre.preserveAspectRatio.baseVal.meetOrSlice, rect: boite(cadre.querySelector('.r')) },
    degrade:  { attributs: attrs(gm), unites: gm.gradientUnits.baseVal },
    icone:    { attributs: attrs(u), ns: u.getAttributeNS(xlink, 'href'), href: u.href.baseVal, boite: boite(u) },
    chaine:   { attributs: attrs(uc), ns: uc.getAttributeNS(xlink, 'href'), href: uc.href.baseVal, boite: boite(uc) },
    langue:   { attributs: attrs(l), ns: l.getAttributeNS(xml, 'lang'), de: l.matches(':lang(de)'), en: l.matches(':lang(en)') },
    doublons
  }
}

const lire = (page: any, balise: string, sel: string, rang: number): Promise<Rapport | null> => page.evaluate(LIRE, [balise, sel, rang, XLINK, XML])

const trie = (liste: string[]) => [...liste].sort()

// ce que le navigateur doit montrer d'un dessin pour un jeu
const attendu = (j: Jeu): Rapport => ({
  cadre:   {
    attributs: trie(['aucun | height = 100', 'aucun | width = 100', `aucun | preserveAspectRatio = ${j.ratio}`, `aucun | viewBox = ${j.cadre}`]),
    viewBox:   j.cadre.split(' ').slice(2).join('x'),
    ratio:     j.align,
    rect:      j.rect
  },
  degrade: {
    attributs: trie([`aucun | gradientUnits = ${j.unites}`, 'aucun | x1 = 0', 'aucun | x2 = 100', 'aucun | y1 = 0', 'aucun | y2 = 0']),
    unites:    j.unites === 'userSpaceOnUse' ? 1 : 2
  },
  icone:   icone(j.cible),
  chaine:  icone('#i-' + j.n),
  langue:  {
    attributs: j.langue === null ? [] : [`${XML} | xml:lang = ${j.langue}`],
    ns:        j.langue,
    de:        j.langue === 'de',
    en:        j.langue === 'en'
  },
  doublons: []
})

// une icône : l'attribut dans l'espace de noms de XLink et rien d'autre, l'adresse lue, la boîte du carré visé (20 de côté pour `a`, 30 pour `b`, rien pour une adresse sans carré)
function icone(v: string | null): Rapport {
  return {
    attributs: v === null ? [] : [`${XLINK} | xlink:href = ${v}`],
    ns:        v,
    href:      v ?? '',
    boite:     v !== null && v.endsWith('a') ? '20x20' : v !== null && v.endsWith('b') ? '30x30' : '0x0'
  }
}

function comparer(ecarts: string[], quoi: string, lu: Rapport | null, voulu: Rapport) {
  if (!lu) { ecarts.push(`${quoi} : le dessin n'est pas dans la page`); return }
  for (const champ of Object.keys(voulu)) verifier(ecarts, `${quoi}, ${champ}`, lu[champ], voulu[champ])
}

// le HTML du serveur : le document avant le premier <script> (le texte de reprise et le runtime viennent après)
const serveur = (cible: Cible, balise: string, variante: string): string => {
  const doc = cible.document(balise, variante)
  return doc.slice(doc.indexOf('<body>') + 6, doc.indexOf('<script'))
}

// les balises ouvrantes du HTML du serveur, avec les noms de leurs attributs
function balises(html: string): Array<{ balise: string, noms: string[] }> {
  const out: Array<{ balise: string, noms: string[] }> = []
  for (const m of html.matchAll(/<([A-Za-z][\w-]*)((?:\s+[^\s=>/]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/g)) {
    const noms = [...m[2].matchAll(/\s+([^\s=>/]+)/g)].map((x) => x[1])
    out.push({ balise: m[1], noms })
  }
  return out
}

// les noms d'attributs que le HTML du serveur ne doit jamais porter : ceux qui ne sont pas dans la casse du standard
const MINUSCULES = ['viewbox', 'preserveaspectratio', 'gradientunits']

describe('rendu serveur d\'un dessin SVG aux attributs minuscules et calculés (Chromium réel)', function () {
  this.timeout(120000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright.chromium.executablePath())
    if (!present) { console.log('  ℹ️  chromium non installé, test du rendu serveur SVG sauté. Activer : `npx playwright install chromium`'); return }
    browser = await playwright.chromium.launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('les composants se rendent et se compilent', async function () {
    if (!present) { this.skip(); return }
    await cible()
  })

  for (const variante of VARIANTES.ssr) {
    it(`le HTML du serveur porte viewBox, preserveAspectRatio, gradientUnits, xlink:href et xml:lang sous leur forme du standard, une seule fois (${variante})`, async function () {
      if (!present) { this.skip(); return }
      const c = await cible()
      for (const balise of BALISES) {
        const html = serveur(c, balise, variante)
        const lignes = balise === 'mjs-sv-pour' ? [A, B] : [A]
        // les attributs du standard, avec leur valeur de départ
        for (const j of lignes) {
          assert.ok(html.includes(`viewBox="${j.cadre}"`), `${balise} : viewBox="${j.cadre}" absent du HTML du serveur`)
          assert.ok(html.includes(`preserveAspectRatio="${j.ratio}"`), `${balise} : preserveAspectRatio="${j.ratio}" absent du HTML du serveur`)
          assert.ok(html.includes(`gradientUnits="${j.unites}"`), `${balise} : gradientUnits="${j.unites}" absent du HTML du serveur`)
          assert.ok(html.includes(`xlink:href="${j.cible}"`), `${balise} : xlink:href="${j.cible}" absent du HTML du serveur`)
          assert.ok(html.includes(`xlink:href="#i-${j.n}"`), `${balise} : xlink:href="#i-${j.n}" absent du HTML du serveur`)
          assert.ok(html.includes(`xml:lang="${j.langue}"`), `${balise} : xml:lang="${j.langue}" absent du HTML du serveur`)
        }
        // l'analyse des balises voit bien les attributs du dessin : une icône `xlink:href` par icône écrite (deux par dessin), un `viewBox` par <svg> au cadre
        const toutes = balises(html)
        assert.equal(toutes.filter((b) => b.noms.includes('xlink:href')).length, 2 * lignes.length, `${balise} : les balises <use> à xlink:href ne sont pas toutes vues`)
        assert.equal(toutes.filter((b) => b.noms.includes('viewBox')).length, lignes.length, `${balise} : les balises <svg> à viewBox ne sont pas toutes vues`)
        // jamais la forme minuscule, et jamais deux attributs de même nom sur une balise
        for (const b of toutes) {
          const bas = b.noms.map((n) => n.toLowerCase())
          assert.deepEqual(b.noms.filter((n) => MINUSCULES.includes(n)), [], `${balise} : <${b.balise}> porte un attribut en minuscules (${b.noms.join(' ')})`)
          assert.equal(new Set(bas).size, bas.length, `${balise} : <${b.balise}> porte deux attributs de même nom (${b.noms.join(' ')})`)
        }
      }
    })

    // ouvre le composant à la reprise, joue le scénario, puis exige qu'aucun écart n'ait été noté et qu'aucune erreur n'ait été dite par la page
    const jouer = async (balise: string, scenario: (page: any, ecarts: string[]) => Promise<void>) => {
      const o      = await charger(browser, await cible(), balise, variante)
      const ecarts = [] as string[]
      try {
        await pret(o.page, balise)
        verifier(ecarts, 'composant vivant', await vivant(o.page, balise), true)
        await scenario(o.page, ecarts)
        assert.deepEqual([...ecarts, ...graves(o).map((g) => `erreur de la page : ${g}`)], [])
      } finally {
        await o.fermer()
      }
    }

    it(`après la reprise (${variante}) : à la racine, le dessin est juste, puis change`, async function () {
      if (!present) { this.skip(); return }
      const balise = 'mjs-sv-racine'
      await jouer(balise, async (page, ecarts) => {
        comparer(ecarts, 'à la reprise', await lire(page, balise, '.dessin', 0), attendu(A))
        await regler(page, balise, 'changer()')
        comparer(ecarts, 'après changement', await lire(page, balise, '.dessin', 0), attendu(B))
      })
    })

    it(`après la reprise (${variante}) : dans un {if}, le dessin est juste, puis change, est retiré et refait`, async function () {
      if (!present) { this.skip(); return }
      const balise = 'mjs-sv-si'
      await jouer(balise, async (page, ecarts) => {
        comparer(ecarts, 'à la reprise', await lire(page, balise, '.dessin', 0), attendu(A))
        await regler(page, balise, 'changer()')
        comparer(ecarts, 'après changement', await lire(page, balise, '.dessin', 0), attendu(B))
        await regler(page, balise, 'basculer()')
        verifier(ecarts, 'dessin retiré', await lire(page, balise, '.dessin', 0), null)
        await regler(page, balise, 'basculer()')
        comparer(ecarts, 'dessin refait', await lire(page, balise, '.dessin', 0), attendu(B))
      })
    })

    it(`après la reprise (${variante}) : dans les lignes d'un {for}, chaque dessin est juste, puis les lignes échangent leurs valeurs`, async function () {
      if (!present) { this.skip(); return }
      const balise = 'mjs-sv-pour'
      await jouer(balise, async (page, ecarts) => {
        comparer(ecarts, 'première ligne, à la reprise', await lire(page, balise, '.ligne', 0), attendu(A))
        comparer(ecarts, 'seconde ligne, à la reprise', await lire(page, balise, '.ligne', 1), attendu(B))
        await regler(page, balise, 'changer()')
        comparer(ecarts, 'première ligne, après changement', await lire(page, balise, '.ligne', 0), attendu(B))
        comparer(ecarts, 'seconde ligne, après changement', await lire(page, balise, '.ligne', 1), attendu(A))
      })
    })

    // l'icône et la langue qui perdent leur valeur (`null`) puis la retrouvent, sur les nœuds que la reprise a adoptés (ou refaits, en `replace`) : l'espace de noms revient avec elles
    it(`après la reprise (${variante}) : à la racine, l'icône et la langue retirées (null) puis revenues`, async function () {
      if (!present) { this.skip(); return }
      const balise = 'mjs-sv-racine'
      await jouer(balise, async (page, ecarts) => {
        await regler(page, balise, 'vider()')
        comparer(ecarts, 'après null', await lire(page, balise, '.dessin', 0), attendu(VIDE))
        await regler(page, balise, 'changer()')
        comparer(ecarts, 'valeurs changées', await lire(page, balise, '.dessin', 0), attendu(B))
        await regler(page, balise, 'vider()')
        await regler(page, balise, 'retour()')
        comparer(ecarts, 'au retour', await lire(page, balise, '.dessin', 0), attendu(A))
      })
    })

    it(`après la reprise (${variante}) : dans un {if}, l'icône et la langue retirées (null) puis revenues, le dessin retiré entre-temps`, async function () {
      if (!present) { this.skip(); return }
      const balise = 'mjs-sv-si'
      await jouer(balise, async (page, ecarts) => {
        await regler(page, balise, 'vider()')
        comparer(ecarts, 'après null', await lire(page, balise, '.dessin', 0), attendu(VIDE))
        await regler(page, balise, 'retour()')
        comparer(ecarts, 'au retour', await lire(page, balise, '.dessin', 0), attendu(A))
        await regler(page, balise, 'basculer()')
        await regler(page, balise, 'vider()')
        await regler(page, balise, 'basculer()')
        comparer(ecarts, 'dessin refait, sans icône ni langue', await lire(page, balise, '.dessin', 0), attendu(VIDE))
        await regler(page, balise, 'retour()')
        comparer(ecarts, 'dessin refait, au retour', await lire(page, balise, '.dessin', 0), attendu(A))
      })
    })

    it(`après la reprise (${variante}) : dans les lignes d'un {for}, l'icône et la langue retirées (null) puis revenues`, async function () {
      if (!present) { this.skip(); return }
      const balise = 'mjs-sv-pour'
      await jouer(balise, async (page, ecarts) => {
        await regler(page, balise, 'vider()')
        comparer(ecarts, 'première ligne, après null', await lire(page, balise, '.ligne', 0), attendu(VIDE))
        comparer(ecarts, 'seconde ligne, après null', await lire(page, balise, '.ligne', 1), attendu(VIDE))
        await regler(page, balise, 'retour()')
        comparer(ecarts, 'première ligne, au retour', await lire(page, balise, '.ligne', 0), attendu(A))
        comparer(ecarts, 'seconde ligne, au retour', await lire(page, balise, '.ligne', 1), attendu(B))
      })
    })
  }
})
