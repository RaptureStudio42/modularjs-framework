// les éléments SVG à majuscules (`linearGradient`, `clipPath`, `foreignObject`, `textPath`, `feGaussianBlur`, `animateTransform`…) sont créés avec leur
// casse SVG par la voie qui bâtit les éléments un par un (une branche de `{await}` qui a des mises à jour : un `{if}`, un `{for}`, une interpolation, un
// `@class`) : dans l'espace de noms SVG la casse compte, un `lineargradient` n'est qu'un élément inconnu (le dégradé ne peint rien, la découpe ne découpe
// pas, le HTML d'un `foreignObject` n'est pas mis en page). L'auteur qui écrit ces noms en minuscules obtient le même dessin, comme avec l'analyseur HTML
// du navigateur (table « adjust SVG tag names » du standard). Les éléments HTML et MathML gardent leur nom.
// Chaque dessin a son témoin, le même dessin à la racine du composant (lu par l'analyseur HTML du navigateur) : un témoin faux dirait que le test lui-même
// est faux, il arrête donc le cas aussitôt. La promesse est tenue par le test (`finir()`), pour que la branche d'attente existe avant l'arrivée.
// Les trois modes : développement, production en fichiers séparés, production en un seul fichier. Chromium réel. Le code émis est aussi lu directement.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { generateCreateFnBody, SVG_NS, MATH_NS } from '../src/generator/paths.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'

// les éléments SVG dont le nom porte des majuscules, avec leur écriture dans le standard : la table de l'analyseur HTML les rétablit depuis les minuscules
const NOMS_SVG = ['altGlyph', 'altGlyphDef', 'altGlyphItem', 'animateColor', 'animateMotion', 'animateTransform', 'clipPath', 'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite', 'feConvolveMatrix', 'feDiffuseLighting', 'feDisplacementMap', 'feDistantLight', 'feDropShadow', 'feFlood', 'feFuncA', 'feFuncB', 'feFuncG', 'feFuncR', 'feGaussianBlur', 'feImage', 'feMerge', 'feMergeNode', 'feMorphology', 'feOffset', 'fePointLight', 'feSpecularLighting', 'feSpotLight', 'feTile', 'feTurbulence', 'foreignObject', 'glyphRef', 'linearGradient', 'radialGradient', 'textPath']

// le contenu du dessin : un dégradé linéaire et un radial, une découpe, un filtre, un tracé et un texte posé dessus, une animation, du HTML dans un `foreignObject` ;
// `suffixe` distingue les identifiants du dessin de la branche et ceux du témoin (deux `url(#…)` de même nom dans une même ombre se confondraient)
const contenu = (suffixe: string, texte: string) => `<defs>
    <linearGradient id="g${suffixe}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="red"></stop><stop offset="1" stop-color="blue"></stop></linearGradient>
    <radialGradient id="r${suffixe}"><stop offset="0" stop-color="red"></stop><stop offset="1" stop-color="blue"></stop></radialGradient>
    <clipPath id="c${suffixe}"><rect x="0" y="0" width="50" height="25"></rect></clipPath>
    <filter id="f${suffixe}"><feGaussianBlur stdDeviation="1"></feGaussianBlur></filter>
    <path id="p${suffixe}" d="M0 90 L100 90"></path>
  </defs>
  <rect class="coupe" x="0" y="0" width="100" height="25" fill="green" clip-path="url(#c${suffixe})"></rect>
  <rect class="plein" x="0" y="30" width="100" height="15" fill="url(#g${suffixe})"></rect>
  <rect class="rad" x="0" y="50" width="30" height="20" fill="url(#r${suffixe})"></rect>
  <rect class="flou" x="35" y="50" width="20" height="20" fill="orange" filter="url(#f${suffixe})"></rect>
  <foreignObject class="fo" x="60" y="50" width="40" height="20"><div class="html">${texte}</div></foreignObject>
  <text x="0" y="90"><textPath href="#p${suffixe}">tp</textPath></text>
  <rect class="tourne" x="90" y="92" width="5" height="5"><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="2s" repeatCount="indefinite"></animateTransform></rect>`

const dessin = (classe: string, suffixe: string, texte: string) => `<svg class="${classe}" viewBox="0 0 100 100" width="100" height="100">
  ${contenu(suffixe, texte)}
</svg>`

// les noms de balises écrits en minuscules, comme un auteur qui ne se souvient pas des majuscules du SVG
const minuscules = (html: string) => html.replace(/<(\/?)([A-Za-z][A-Za-z0-9]*)/g, (_m, barre, nom) => '<' + barre + nom.toLowerCase())

const ENTETE = `<script>
  $on  = true
  $val = 'ok'
  fin  = null
  $p   = new Promise((res) -> fin = res)
  @finir    = -> fin('ok')
  @relancer = -> $p = new Promise((res) -> fin = res)
</script>
`

// le dessin dans le corps de `{success}` (la branche a une interpolation : elle est bâtie élément par élément), et dans un `{if}` de la branche
const dessins = (casse: 'camel' | 'minuscules'): Record<string, string> => {
  const ecrire = casse === 'camel' ? (html: string) => html : minuscules
  return {
    [`sv-corps-${casse}.mjs`]: ENTETE + ecrire(`{await $p}
  <i class="att">attente</i>
{success v}
  ${dessin('dessin', 'b', '{v}')}
{end}
${dessin('temoin', 't', '{$val}')}
`),
    [`sv-si-${casse}.mjs`]: ENTETE + ecrire(`{await $p}
  <i class="att">attente</i>
{success v}
  <svg class="dessin" viewBox="0 0 100 100" width="100" height="100">
    {if $on}
      ${contenu('b', '{v}')}
    {end}
  </svg>
{end}
${dessin('temoin', 't', '{$val}')}
`)
  }
}

const SOURCES: Record<string, string> = {
  ...dessins('camel'),
  ...dessins('minuscules'),
  // les éléments HTML et MathML qui portent le nom d'un élément SVG restent ce qu'ils sont : HTML en dehors d'un `<svg>` et sous un `<foreignObject>`, MathML dans un `<math>`
  'sv-html-math.mjs': ENTETE + `{await $p}
  <i class="att">attente</i>
{success v}
  <section class="coin"><lineargradient class="h1"></lineargradient><textpath class="h2"></textpath><div class="h3">{v}</div></section>
  <math class="formule"><mi class="m1">x</mi><mrow><mo class="m2">+</mo></mrow><lineargradient class="m3"></lineargradient></math>
  <svg viewBox="0 0 10 10" width="10" height="10"><foreignObject width="10" height="10"><div><clippath class="h4"></clippath></div></foreignObject></svg>
{end}
<section class="coin-t"><lineargradient class="h1"></lineargradient><textpath class="h2"></textpath><div class="h3">{$val}</div></section>
<math class="formule-t"><mi class="m1">x</mi><mrow><mo class="m2">+</mo></mrow><lineargradient class="m3"></lineargradient></math>
<svg class="temoin" viewBox="0 0 10 10" width="10" height="10"><foreignObject width="10" height="10"><div><clippath class="h4"></clippath></div></foreignObject></svg>
`
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

type Rapport = { noms: string, classes: string, degrade: boolean, radial: boolean, decoupe: string, html: boolean }

// ce qui doit sortir de la page : les noms des éléments, l'interface de ceux dont la casse compte, puis ce que le navigateur en fait : les dégradés peignent,
// la découpe coupe, le HTML du `foreignObject` est mis en page
const ATTENDU: Rapport = {
  noms:    'defs linearGradient stop stop radialGradient stop stop clipPath rect filter feGaussianBlur path rect rect rect rect foreignObject div text textPath rect animateTransform',
  classes: 'SVGLinearGradientElement SVGRadialGradientElement SVGClipPathElement SVGFEGaussianBlurElement SVGTextPathElement SVGAnimateTransformElement SVGForeignObjectElement',
  degrade: true,
  radial:  true,
  decoupe: 'dedans=true dehors=false',
  html:    true
}

// les éléments dont la lecture donne l'interface, par leur nom en minuscules
const LUS = ['lineargradient', 'radialgradient', 'clippath', 'fegaussianblur', 'textpath', 'animatetransform', 'foreignobject']

// la fonction tourne dans la page : un point d'un élément (en proportion de sa boîte) est-il pris par cet élément, et non par celui qui est dessous ?
const RAPPORT = ([balise, sel, lus]: [string, string, string[]]): Rapport | null => {
  const racine = (document.querySelector(balise) as any)._shadow
  const svg    = racine.querySelector(sel)
  if (!svg) return null
  const tous   = Array.from(svg.querySelectorAll('*')) as any[]
  const touche = (n: any, fx: number, fy: number): boolean => {
    if (!n) return false
    const r = n.getBoundingClientRect()
    return racine.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy) === n
  }
  const coupe  = svg.querySelector('.coupe')
  const html   = svg.querySelector('.html')
  const boite  = html ? html.getBoundingClientRect() : null
  return {
    noms:    tous.map((n) => n.localName).join(' '),
    classes: lus.map((bas) => { const n = tous.find((x) => x.localName.toLowerCase() === bas); return n ? n.constructor.name : 'absent' }).join(' '),
    degrade: touche(svg.querySelector('.plein'), 0.5, 0.5),
    radial:  touche(svg.querySelector('.rad'), 0.5, 0.5),
    decoupe: 'dedans=' + touche(coupe, 0.25, 0.5) + ' dehors=' + touche(coupe, 0.75, 0.5),
    html:    !!boite && boite.width > 0 && boite.height > 0
  }
}

const lire = (page: any, balise: string, sel: string): Promise<Rapport | null> => page.evaluate(RAPPORT, [balise, sel, LUS])

// un champ après l'autre : tous les écarts du dessin sont rendus ensemble
function comparer(ecarts: string[], quoi: string, lu: Rapport | null, attendu: Rapport) {
  if (!lu) { ecarts.push(`${quoi} : le dessin n'est pas dans la page`); return }
  for (const champ of Object.keys(attendu) as Array<keyof Rapport>) verifier(ecarts, `${quoi}, ${champ}`, lu[champ], attendu[champ])
}

for (const mode of ['dev-parents-avant', 'split', 'bundle'] as const) describe(`éléments SVG à majuscules dans une branche de {await} (${mode}, Chromium réel)`, function () {
  this.timeout(120000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright.chromium.executablePath())
    if (!present) { console.log('  ℹ️  chromium non installé, test des éléments SVG sauté. Activer : `npx playwright install chromium`'); return }
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

  for (const casse of ['camel', 'minuscules'] as const) {
    const ecriture = casse === 'camel' ? 'avec leurs majuscules' : 'écrits en minuscules par l\'auteur'

    it(`dans le corps de {success} : les éléments SVG ${ecriture} sont créés avec leur casse SVG et font leur travail, comme à la racine`, async function () {
      if (!present) { this.skip(); return }
      const B = `mjs-sv-corps-${casse}`
      await jouer(B, async (page, ecarts) => {
        verifier(ecarts, 'composant vivant, à la création', await vivant(page, B), true)
        assert.deepEqual(await lire(page, B, 'svg.temoin'), ATTENDU, 'le dessin hors de {await}, témoin, est faux : le test lui-même est à revoir')
        verifier(ecarts, 'avant l\'arrivée, le dessin de la branche', await lire(page, B, 'svg.dessin'), null)
        await regler(page, B, 'finir()')
        verifier(ecarts, 'composant vivant, après l\'arrivée', await vivant(page, B), true)
        comparer(ecarts, 'dessin de {success}', await lire(page, B, 'svg.dessin'), ATTENDU)
      })
    })

    it(`dans un {if} de {success} : les éléments SVG ${ecriture} sont créés avec leur casse SVG, aussi quand la branche se refait après une promesse remplacée`, async function () {
      if (!present) { this.skip(); return }
      const B = `mjs-sv-si-${casse}`
      await jouer(B, async (page, ecarts) => {
        assert.deepEqual(await lire(page, B, 'svg.temoin'), ATTENDU, 'le dessin hors de {await}, témoin, est faux : le test lui-même est à revoir')
        await regler(page, B, 'finir()')
        verifier(ecarts, 'composant vivant, après l\'arrivée', await vivant(page, B), true)
        comparer(ecarts, 'dessin du {if}, à l\'arrivée', await lire(page, B, 'svg.dessin'), ATTENDU)
        await regler(page, B, 'relancer()')
        verifier(ecarts, 'promesse remplacée, le dessin de la branche est retiré', await lire(page, B, 'svg.dessin'), null)
        await regler(page, B, 'finir()')
        verifier(ecarts, 'composant vivant, branche refaite', await vivant(page, B), true)
        comparer(ecarts, 'dessin du {if}, branche refaite', await lire(page, B, 'svg.dessin'), ATTENDU)
      })
    })
  }

  it('les éléments HTML et MathML qui portent un nom SVG gardent leur nom et leur espace de noms, comme à la racine', async function () {
    if (!present) { this.skip(); return }
    const B       = 'mjs-sv-html-math'
    const temoin  = ['.coin-t .h1', '.coin-t .h2', '.coin-t .h3', '.formule-t .m1', '.formule-t .m2', '.formule-t .m3', 'svg.temoin .h4']
    const branche = ['.coin .h1', '.coin .h2', '.coin .h3', '.formule .m1', '.formule .m2', '.formule .m3', 'svg:not(.temoin) .h4']
    const attendu = 'xhtml:lineargradient xhtml:textpath xhtml:div MathML:mi MathML:mo MathML:lineargradient xhtml:clippath'
    const lu      = (page: any, ombre: string[]): Promise<string> => page.evaluate(`(() => {
      const racine = document.querySelector('${B}')._shadow
      return ${JSON.stringify(ombre)}.map((sel) => { const n = racine.querySelector(sel); return n ? n.namespaceURI.split('/').pop() + ':' + n.localName : 'absent' }).join(' ')
    })()`)
    await jouer(B, async (page, ecarts) => {
      assert.equal(await lu(page, temoin), attendu, 'les éléments hors de {await}, témoins, sont faux : le test lui-même est à revoir')
      await regler(page, B, 'finir()')
      verifier(ecarts, 'composant vivant, après l\'arrivée', await vivant(page, B), true)
      verifier(ecarts, 'éléments de la branche', await lu(page, branche), attendu)
    })
  })
})

describe('éléments SVG à majuscules : la table du standard, lue par le navigateur et par le code émis', function () {
  this.timeout(120000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright.chromium.executablePath())
    if (!present) { console.log('  ℹ️  chromium non installé, test de la table des noms SVG sauté. Activer : `npx playwright install chromium`'); return }
    browser = await playwright.chromium.launch()
  })

  after(async () => {
    if (browser) await browser.close()
  })

  // les noms de balises que la fonction crée : [espace de noms, nom] pour chaque `createElementNS`, ['', nom] pour chaque `createElement`
  const creations = (html: string, foreignNsRoot?: string): string[] => {
    const { body } = generateCreateFnBody(html, { forceImperative: true, foreignNsRoot })
    return [...body.matchAll(/document\.createElement(NS)?\(([^)]*)\)/g)].map((m) => {
      const args = JSON.parse('[' + m[2] + ']') as string[]
      return m[1] ? args[0].split('/').pop() + ':' + args[1] : ':' + args[0]
    })
  }

  it('l\'analyseur HTML du navigateur rétablit la casse de chacun des noms de la table (le navigateur fait foi)', async function () {
    if (!present) { this.skip(); return }
    const ctx  = await browser.newContext()
    const page = await ctx.newPage()
    try {
      await page.setContent('<!doctype html><svg id="s"></svg>')
      const lus = await page.evaluate((noms: string[]) => noms.map((n) => {
        const svg = document.getElementById('s') as any
        svg.innerHTML = '<' + n.toLowerCase() + '></' + n.toLowerCase() + '>'
        return svg.firstChild.localName
      }), NOMS_SVG)
      const ecarts = NOMS_SVG.filter((n, i) => lus[i] !== n).map((n) => `${n.toLowerCase()} lu ${lus[NOMS_SVG.indexOf(n)]}`)
      assert.deepEqual(ecarts, [], 'la liste du test est celle du navigateur')
    } finally {
      await ctx.close()
    }
  })

  it('le code émis crée chaque élément de la table avec sa casse SVG, écrit en minuscules ou avec ses majuscules', function () {
    const ecarts: string[] = []
    for (const nom of NOMS_SVG) {
      for (const ecrit of [nom.toLowerCase(), nom]) {
        const lu = creations(`<svg><${ecrit}></${ecrit}></svg>`).join(' ')
        if (lu !== `svg:svg svg:${nom}`) ecarts.push(`<${ecrit}> lu ${lu.split(' ').pop()}`)
      }
    }
    assert.equal(ecarts.length, 0, `${ecarts.length} écritures sur ${NOMS_SVG.length * 2} créées sans la casse SVG : ${ecarts.slice(0, 5).join(', ')}…`)
  })

  it('le code émis rétablit la casse SVG d\'un élément posé dans un <svg> qui vit hors du fragment, d\'un descendant de <g> et d\'un <foreignObject>', function () {
    assert.equal(creations('<lineargradient></lineargradient><clippath></clippath>', SVG_NS).join(' '), 'svg:linearGradient svg:clipPath')
    assert.equal(creations('<g><textpath></textpath><circle></circle></g>', SVG_NS).join(' '), 'svg:g svg:textPath svg:circle')
    assert.equal(creations('<svg><g><foreignobject></foreignobject></g></svg>').join(' '), 'svg:svg svg:g svg:foreignObject')
    assert.equal(creations('<svg><foreignObject><div></div></foreignObject></svg>').join(' '), 'svg:svg svg:foreignObject :div')
  })

  it('le code émis ne change rien pour HTML et MathML : même nom, même espace de noms', function () {
    assert.equal(creations('<div><lineargradient></lineargradient><clippath></clippath><foreignobject></foreignobject></div>').join(' '), ':div :lineargradient :clippath :foreignobject')
    assert.equal(creations('<math><lineargradient></lineargradient><mi></mi></math>').join(' '), 'MathML:math MathML:lineargradient MathML:mi')
    assert.equal(creations('<lineargradient></lineargradient>', MATH_NS).join(' '), 'MathML:lineargradient')
    assert.equal(creations('<svg><foreignObject><clippath></clippath><div><textpath></textpath></div></foreignObject></svg>').join(' ').split(' ').slice(2).join(' '), ':clippath :div :textpath', 'sous un <foreignObject> les éléments sont HTML')
    assert.equal(creations('<span><svg><circle></circle></svg></span>').join(' '), ':span svg:svg svg:circle')
  })
})
