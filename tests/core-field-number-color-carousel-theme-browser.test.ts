// Champ, nombre, pastille de couleur et carrousel du cœur (<@@field>, <@@number>, <@@color>, <@@carousel>) dans un
// navigateur réel : leurs variables de thème se règlent là où l'on veut.
// - `--mjs-field-error-color` et `--mjs-field-ok-color` (bordure du champ enveloppé et message, en erreur et au succès,
//   dans les deux modèles) ; `--mjs-number-width`, `-radius`, `-border`, `-accent`, `-step-bg` ; `--mjs-color-size`,
//   `-radius`, `-border`, `-line` ; `--mjs-carousel-shadow` et `-button` : chacune agit posée sur un ancêtre, dans le
//   bloc `<theme>` de l'application, sur `:root` ou sur la balise du module elle-même.
// - Sans aucune variable, les styles sont ceux de toujours (largeur, arrondi, bordures, couleurs, ombres) ;
//   `--mjs-accent` et `--mjs-border` du thème général restent lus par défaut.
// - Le build le sait : déclarer l'une de ces variables dans une application n'accuse pas les modules du cœur dans le
//   rappel `lint.themeShared`.
// Chromium et Firefox réels : de vrais focus, les styles calculés par le navigateur.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const VARIABLES = [
  '--mjs-field-error-color: purple',
  '--mjs-field-ok-color: orange',
  '--mjs-number-width: 280px',
  '--mjs-number-radius: 6px',
  '--mjs-number-border: green',
  '--mjs-number-accent: red',
  '--mjs-number-step-bg: yellow',
  '--mjs-color-size: 30px',
  '--mjs-color-radius: 50%',
  '--mjs-color-border: purple',
  '--mjs-color-line: 40px',
  '--mjs-carousel-shadow: 0 0 10px red',
  '--mjs-carousel-button: lime'
]

const VIGNETTES = '<div class="v">1</div><div class="v">2</div><div class="v">3</div><div class="v">4</div><div class="v">5</div>'

// les modules de chaque zone ; `extra` s'ajoute à la classe de chaque balise (la zone « sur la balise »)
const modules = (extra = '') => `
  <@@field class="f-mauvais${extra}" label="Courriel" ok-label="Valide"><input name="mauvais"></@@field>
  <@@field class="f-bon${extra}" label="Courriel" ok-label="Valide"><input name="bon"></@@field>
  <@@field class="g-mauvais${extra}" layout="float" label="Nom" icon="☺" ok-label="Valide"><input name="gmauvais"></@@field>
  <@@field class="g-bon${extra}" layout="float" label="Nom" icon="☺" ok-label="Valide"><input name="gbon"></@@field>
  <@@number class="n${extra}" value="5" min="0" max="10" big></@@number>
  <@@color class="c${extra}" value="#f472b6"></@@color>
  <@@color class="c-compact${extra}" value="#f472b6" compact></@@color>
  <@@color class="c-edit${extra}" value="#f472b6" editable></@@color>
  <@@carousel class="car${extra}">${VIGNETTES}</@@carousel>
  <@@carousel class="car-flat${extra}" layout="flat">${VIGNETTES}</@@carousel>`

const HOTE = `<div class="z-defaut">${modules()}</div>

<div class="z-ancetre">${modules()}</div>

<div class="z-balise">${modules(' sur-balise')}</div>

<div class="z-global">${modules()}</div>

<@zone-theme class="zt"></@zone-theme>

<style>
  .z-ancetre
    ${VARIABLES.join('\n    ')}

  .sur-balise
    ${VARIABLES.join('\n    ')}

  .z-global
    --mjs-accent: orange
    --mjs-border: purple
</style>
`

const ZONE_THEME = `<theme>
  ${VARIABLES.join('\n  ')}
</theme>

<div class="z-theme">${modules()}</div>
`

// ce que le navigateur calcule pour les modules d'une zone
const MESURE = `window.__mesure = (racine) => {
  const cs  = (n, p) => getComputedStyle(n, p)
  const de  = (cls, sel) => racine.querySelector('.' + cls)._shadow.querySelector(sel)
  const px  = (v) => Math.round(parseFloat(v)) + 'px'
  const out = {}
  const champ = (cls) => racine.querySelector('.' + cls + ' input')
  out.champ = {
    erreur:         cs(champ('f-mauvais')).borderTopColor,
    erreurTexte:    cs(de('f-mauvais', '.error')).color,
    succes:         cs(champ('f-bon')).borderTopColor,
    succesTexte:    cs(de('f-bon', '.ok')).color,
    flottantErreur: cs(champ('g-mauvais')).borderTopColor,
    flottantSucces: cs(champ('g-bon')).borderTopColor
  }
  out.nombre = {
    w:           cs(de('n', '.field')).width,
    rayon:       cs(de('n', '.field')).borderTopLeftRadius,
    bord:        cs(de('n', '.field')).borderTopColor,
    traitMoins:  cs(de('n', '.step.less')).borderRightColor,
    traitPlus:   cs(de('n', '.step.more')).borderLeftColor,
    fondMoins:   cs(de('n', '.step.less')).backgroundColor,
    fondPlus:    cs(de('n', '.step.more')).backgroundColor,
    fondGrand:   cs(de('n', '.step.less.big')).backgroundColor,
    traitGrand:  cs(de('n', '.step.less.big')).borderRightColor
  }
  out.couleur = {
    w:         cs(de('c', '.swatch')).width,
    h:         cs(de('c', '.swatch')).height,
    rayon:     cs(de('c', '.swatch')).borderTopLeftRadius,
    bord:      cs(de('c', '.swatch')).borderTopColor,
    etai:      px(cs(racine.querySelector('.c'), '::before').height),
    ligne:     cs(de('c', '.code')).lineHeight,
    compact:   { w: cs(de('c-compact', '.swatch')).width, rayon: cs(de('c-compact', '.swatch')).borderTopLeftRadius, bord: cs(de('c-compact', '.swatch')).borderTopColor, etai: px(cs(racine.querySelector('.c-compact'), '::before').height) },
    selecteur: { w: cs(de('c-edit', '.picker')).width, h: cs(de('c-edit', '.picker')).height, rayon: cs(de('c-edit', '.picker')).borderTopLeftRadius, bord: cs(de('c-edit', '.picker')).borderTopColor }
  }
  const carrousel = (cls) => ({
    bouton: cs(de(cls, 'button.prev')).borderTopColor,
    fleche: cs(de(cls, 'button.next'), '::before').borderTopColor,
    ombre:  cs(racine.querySelector('.' + cls + ' .v')).boxShadow
  })
  out.carrousel     = carrousel('car')
  out.carrouselPlat = carrousel('car-flat')
  return out
}`

// les variables VARIABLES, telles que le navigateur les calcule
const AVEC_VARIABLES = {
  champ:   { erreur: 'rgb(128, 0, 128)', erreurTexte: 'rgb(128, 0, 128)', succes: 'rgb(255, 165, 0)', succesTexte: 'rgb(255, 165, 0)', flottantErreur: 'rgb(128, 0, 128)', flottantSucces: 'rgb(255, 165, 0)' },
  nombre:  { w: '280px', rayon: '6px', bord: 'rgb(0, 128, 0)', traitMoins: 'rgb(0, 128, 0)', traitPlus: 'rgb(0, 128, 0)', fondMoins: 'rgb(255, 255, 0)', fondPlus: 'rgb(255, 255, 0)', fondGrand: 'rgb(255, 255, 0)', traitGrand: 'rgb(0, 128, 0)' },
  couleur: {
    w: '30px', h: '30px', rayon: '50%', bord: 'rgb(128, 0, 128)', etai: '40px', ligne: '40px',
    compact:   { w: '30px', rayon: '50%', bord: 'rgb(128, 0, 128)', etai: '40px' },
    selecteur: { w: '30px', h: '30px', rayon: '50%', bord: 'rgb(128, 0, 128)' }
  }
}

// les défauts de toujours, sans aucune variable posée : dans une application, --mjs-border vaut #d0d0d0 ; le nombre mesuré porte `big`,
// d'où 240px (160px sans `big`), et la largeur posée par VARIABLES (280px) diffère des deux
const DEFAUTS = {
  champ:   { erreur: 'rgb(229, 72, 77)', erreurTexte: 'rgb(229, 72, 77)', succes: 'rgb(46, 158, 91)', succesTexte: 'rgb(46, 158, 91)', flottantErreur: 'rgb(229, 72, 77)', flottantSucces: 'rgb(46, 158, 91)' },
  nombre:  { w: '240px', rayon: '999px', bord: 'rgb(208, 208, 208)', traitMoins: 'rgb(208, 208, 208)', traitPlus: 'rgb(208, 208, 208)', fondMoins: 'rgba(0, 0, 0, 0)', fondPlus: 'rgba(0, 0, 0, 0)', fondGrand: 'rgba(0, 0, 0, 0)', traitGrand: 'rgb(208, 208, 208)' }
}

let construit: Promise<string> | null = null

// le build et le script concaténé, une seule fois pour les deux navigateurs
function construire(): Promise<string> {
  construit ??= (async () => {
    const root   = mjsTmp('champ-nombre-couleur-carrousel-theme')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), HOTE)
    writeFileSync(join(srcDir, 'zone-theme.mjs'), ZONE_THEME)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const order = [...files.filter((f) => f.startsWith('mjs_core')), ...files.filter((f) => f.startsWith('mjs_') && !f.startsWith('mjs_core')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
    return order.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })()
  return construit
}

for (const nom of ['chromium', 'firefox'] as const) describe(`champ, nombre, pastille de couleur, carrousel : variables de thème (${nom} réel)`, function () {
  this.timeout(180000)
  let present = false
  let browser: any
  let script  = ''
  let page: any

  const attendre = (ms = 150) => page.waitForTimeout(ms)

  // la page toute fraîche, puis une réponse du serveur : « mauvais » et « gmauvais » refusés, les autres champs nommés au succès
  async function recharger() {
    await page.setContent(`<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-hote></mjs-hote><script>${script}</script></body></html>`, { waitUntil: 'load' })
    await page.waitForFunction(() => {
      const h: any    = document.querySelector('mjs-hote')
      const zt: any   = h?._shadow?.querySelector('.zt')
      const pret      = (racine: any, sel: string, piece: string) => !!racine?.querySelector(sel)?._shadow?.querySelector(piece)
      return pret(h?._shadow, '.z-defaut .f-mauvais', '.field') && pret(h?._shadow, '.z-defaut .car-flat', '.carousel') && pret(h?._shadow, '.z-defaut .c-edit', '.picker') && pret(h?._shadow, '.z-balise .g-bon', '.field') && pret(h?._shadow, '.z-ancetre .c-edit', '.picker') && pret(zt?._shadow, '.z-theme .c-edit', '.picker') && pret(zt?._shadow, '.z-theme .car-flat', '.carousel') && pret(h?._shadow, '.z-global .c-edit', '.picker')
    })
    await page.evaluate(`window.__q = (s) => document.querySelector('mjs-hote')._shadow.querySelector(s)`)
    await page.evaluate(MESURE)
    await page.evaluate(`µ._mjs_resMerge({ errors: { mauvais: ['Invalide'], gmauvais: ['Invalide'] } })`)
    await attendre(700)
  }

  // les bordures glissent en quelques dixièmes de seconde, et une machine chargée les retarde : on relève jusqu'à ce que
  // les valeurs données dans `attendu` (un morceau de l'arbre du relevé) soient celles du navigateur, 3 s au plus ; sans
  // `attendu`, jusqu'à deux relevés identiques à la suite. Le dernier relevé est rendu : l'assertion qui suit dit ce qui diffère
  const extrait = (releve: any, modele: any): any => (modele && typeof modele === 'object') ? Object.fromEntries(Object.keys(modele).map((k) => [k, extrait(releve?.[k], modele[k])])) : releve

  async function mesurer(racine: string, attendu?: any) {
    let vu = await page.evaluate(`__mesure(${racine})`)
    for (let i = 0; i < 30; i++) {
      if (attendu && JSON.stringify(extrait(vu, attendu)) === JSON.stringify(attendu)) break
      await attendre(100)
      const suivant = await page.evaluate(`__mesure(${racine})`)
      if (!attendu && JSON.stringify(suivant) === JSON.stringify(vu)) break
      vu = suivant
    }
    return vu
  }

  // le nombre focalisé : sa bordure prend la couleur d'accent (relevée jusqu'à la couleur attendue, 3 s au plus) ; il rend ensuite le focus, pour les relevés qui suivent
  async function bordureFocus(racine: string, attendue: string) {
    const entree  = `${racine}.querySelector('.n')._shadow.querySelector('.input')`
    const bordure = `getComputedStyle(${racine}.querySelector('.n')._shadow.querySelector('.field')).borderTopColor`
    await page.evaluate(`${entree}.focus()`)
    let vu = await page.evaluate(bordure)
    for (let i = 0; i < 30 && vu !== attendue; i++) {
      await attendre(100)
      vu = await page.evaluate(bordure)
    }
    await page.evaluate(`${entree}.blur()`)
    return vu
  }

  // la valeur qu'un navigateur calcule pour une déclaration écrite à la main (aucune chaîne en dur)
  const calculee = (propriete: string, valeur: string) => page.evaluate(`(() => { const d = document.createElement('div'); document.body.appendChild(d); d.style.setProperty('${propriete}', '${valeur}'); const v = getComputedStyle(d).getPropertyValue('${propriete}'); d.remove(); return v })()`)

  const zone = (classe: string) => `__q('.${classe}')`

  before(async () => {
    try {
      const playwright = await import('playwright')
      present = existsSync(playwright[nom].executablePath())
      if (!present) return
      script  = await construire()
      browser = await playwright[nom].launch()
      page    = await browser.newPage({ viewport: { width: 1300, height: 1400 } })
      await page.addInitScript('window.__name = (f) => f')
    } catch (e) { present = false; throw e }
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  beforeEach(async function () {
    if (!present) { this.skip(); return }
    await recharger()
  })

  // la ligne de code de la pastille, l'étai qui la réserve (au pixel entier : une hauteur de boîte est arrondie par la mise en page) et l'ombre du carrousel, comme le navigateur les calcule par défaut
  async function defautsCalcules() {
    const ligne = await calculee('line-height', 'calc(.9rem * 1.4)')
    const etai  = Math.round(parseFloat(ligne)) + 'px'
    const ombre = await calculee('box-shadow', '0 0 50px rgba(0, 0, 0, .5)')
    return {
      couleur: {
        w: '16px', h: '16px', rayon: '4px', bord: 'rgb(208, 208, 208)', etai, ligne,
        compact:   { w: '16px', rayon: '4px', bord: 'rgb(208, 208, 208)', etai },
        selecteur: { w: '16px', h: '16px', rayon: '4px', bord: 'rgb(208, 208, 208)' }
      },
      carrousel: { bouton: 'rgb(255, 255, 255)', fleche: 'rgb(255, 255, 255)', ombre }
    }
  }

  async function avecVariables() {
    const ombre = await calculee('box-shadow', '0 0 10px red')
    return { carrousel: { bouton: 'rgb(0, 255, 0)', fleche: 'rgb(0, 255, 0)', ombre } }
  }

  it('sans aucune variable : les styles de toujours (bordures d\'état, largeur, arrondi, pastille, ombre, flèches), dans chaque modèle', async function () {
    if (!present) { this.skip(); return }
    const m = await mesurer(zone('z-defaut'), { champ: DEFAUTS.champ, nombre: DEFAUTS.nombre })
    const d = await defautsCalcules()
    assert.deepEqual(m.champ, DEFAUTS.champ, 'champ : bordure et message, en erreur et au succès, modèle normal et flottant')
    assert.deepEqual(m.nombre, DEFAUTS.nombre, 'nombre : largeur, arrondi, bordure, boutons du petit et du grand pas')
    assert.deepEqual(m.couleur, d.couleur, 'pastille de couleur : lecture seule, compacte, en édition')
    assert.deepEqual(m.carrousel, d.carrousel, 'carrousel en éventail')
    assert.deepEqual(m.carrouselPlat, d.carrousel, 'carrousel à plat')
    assert.equal(await bordureFocus(zone('z-defaut'), 'rgb(59, 130, 246)'), 'rgb(59, 130, 246)', 'nombre focalisé : l\'accent bleu de toujours')
  })

  it('posées sur un ancêtre des modules : elles agissent, sur le champ, le nombre, la pastille et le carrousel', async function () {
    if (!present) { this.skip(); return }
    const m = await mesurer(zone('z-ancetre'), { champ: AVEC_VARIABLES.champ, nombre: AVEC_VARIABLES.nombre })
    const a = await avecVariables()
    assert.deepEqual(m.champ, AVEC_VARIABLES.champ)
    assert.deepEqual(m.nombre, AVEC_VARIABLES.nombre)
    assert.deepEqual(m.couleur, AVEC_VARIABLES.couleur)
    assert.deepEqual(m.carrousel, a.carrousel)
    assert.deepEqual(m.carrouselPlat, a.carrousel)
    assert.equal(await bordureFocus(zone('z-ancetre'), 'rgb(255, 0, 0)'), 'rgb(255, 0, 0)', 'nombre focalisé : --mjs-number-accent')
  })

  it('posées dans le bloc <theme> de l\'application (un composant qui contient les modules) : elles agissent', async function () {
    if (!present) { this.skip(); return }
    const racine = `__q('.zt')._shadow.querySelector('.z-theme')`
    const m = await mesurer(racine, { champ: AVEC_VARIABLES.champ, nombre: AVEC_VARIABLES.nombre })
    const a = await avecVariables()
    assert.deepEqual(m.champ, AVEC_VARIABLES.champ)
    assert.deepEqual(m.nombre, AVEC_VARIABLES.nombre)
    assert.deepEqual(m.couleur, AVEC_VARIABLES.couleur)
    assert.deepEqual(m.carrousel, a.carrousel)
    assert.deepEqual(m.carrouselPlat, a.carrousel)
    assert.equal(await bordureFocus(racine, 'rgb(255, 0, 0)'), 'rgb(255, 0, 0)', 'nombre focalisé : --mjs-number-accent')
  })

  it('posées sur :root : toutes agissent, et chacune seule agit seule', async function () {
    if (!present) { this.skip(); return }
    await page.addStyleTag({ content: ':root { --mjs-field-error-color: purple; --mjs-number-accent: red }' })
    await attendre(500)
    let m = await mesurer(zone('z-defaut'), { champ: { erreur: 'rgb(128, 0, 128)', erreurTexte: 'rgb(128, 0, 128)', flottantErreur: 'rgb(128, 0, 128)', succes: DEFAUTS.champ.succes } })
    assert.equal(m.champ.erreur, 'rgb(128, 0, 128)', 'le rouge d\'erreur du champ passe au violet')
    assert.equal(m.champ.erreurTexte, 'rgb(128, 0, 128)')
    assert.equal(m.champ.flottantErreur, 'rgb(128, 0, 128)')
    assert.equal(m.champ.succes, DEFAUTS.champ.succes, 'le vert du succès ne bouge pas')
    assert.equal(m.nombre.w, '240px', 'le reste des défauts ne bouge pas')
    assert.equal(await bordureFocus(zone('z-defaut'), 'rgb(255, 0, 0)'), 'rgb(255, 0, 0)', 'nombre focalisé : l\'accent posé sur :root')
    await page.addStyleTag({ content: ':root { ' + VARIABLES.join('; ') + ' }' })
    await attendre(500)
    m = await mesurer(zone('z-defaut'), { champ: AVEC_VARIABLES.champ, nombre: AVEC_VARIABLES.nombre })
    const a = await avecVariables()
    assert.deepEqual(m.champ, AVEC_VARIABLES.champ)
    assert.deepEqual(m.nombre, AVEC_VARIABLES.nombre)
    assert.deepEqual(m.couleur, AVEC_VARIABLES.couleur)
    assert.deepEqual(m.carrousel, a.carrousel)
    assert.deepEqual(m.carrouselPlat, a.carrousel)
  })

  it('posées sur la balise du module elle-même : elles agissent encore', async function () {
    if (!present) { this.skip(); return }
    const m = await mesurer(zone('z-balise'), { champ: AVEC_VARIABLES.champ, nombre: AVEC_VARIABLES.nombre })
    const a = await avecVariables()
    assert.deepEqual(m.champ, AVEC_VARIABLES.champ)
    assert.deepEqual(m.nombre, AVEC_VARIABLES.nombre)
    assert.deepEqual(m.couleur, AVEC_VARIABLES.couleur)
    assert.deepEqual(m.carrousel, a.carrousel)
    assert.deepEqual(m.carrouselPlat, a.carrousel)
    assert.equal(await bordureFocus(zone('z-balise'), 'rgb(255, 0, 0)'), 'rgb(255, 0, 0)', 'nombre focalisé : --mjs-number-accent')
  })

  it('--mjs-accent et --mjs-border (le thème général) sont toujours lus par défaut : bordure du nombre et de la pastille, accent du nombre focalisé', async function () {
    if (!present) { this.skip(); return }
    const m = await mesurer(zone('z-global'), { nombre: { bord: 'rgb(128, 0, 128)' } })
    assert.equal(m.nombre.bord, 'rgb(128, 0, 128)', 'bordure violette du nombre')
    assert.equal(m.nombre.traitMoins, 'rgb(128, 0, 128)')
    assert.equal(m.nombre.traitGrand, 'rgb(128, 0, 128)')
    assert.equal(m.couleur.bord, 'rgb(128, 0, 128)', 'bordure violette de la pastille')
    assert.equal(m.couleur.selecteur.bord, 'rgb(128, 0, 128)', 'et du sélecteur')
    assert.equal(m.nombre.w, '240px', 'le reste des défauts ne bouge pas')
    assert.equal(await bordureFocus(zone('z-global'), 'rgb(255, 165, 0)'), 'rgb(255, 165, 0)', 'nombre focalisé : accent orange')
  })
})

// les variables de thème du champ, du nombre, de la pastille et du carrousel se lisent là où elles servent
// (`var(--nom, défaut)`) : les modules n'en déclarent aucune sur leur balise, si bien qu'une valeur venue d'un
// ancêtre ou du bloc <theme> de l'application passe. Le build le sait : déclarer l'une d'elles dans une
// application n'accuse pas les modules du cœur dans le rappel `lint.themeShared`.
describe('modules cœur champ, nombre, pastille de couleur, carrousel — variables de thème et lint.themeShared', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  async function construireProjet(theme: string[]): Promise<string[]> {
    const root = mjsTmp('champ-nombre-theme-shared')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), [
      '<theme>',
      ...theme.map((l) => '  ' + l),
      '</theme>',
      '<@@field label="Courriel"><input name="email"></@@field>',
      '<@@field layout="float" label="Nom" icon="☺"><input name="nom"></@@field>',
      '<@@number name="quantite" value="3"></@@number>',
      '<@@color value="#f472b6"></@@color>',
      '<@@carousel><div>1</div><div>2</div></@@carousel>'
    ].join('\n'))
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js') })
    const stats = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    return stats.warnings.filter((w) => w.endsWith('[lint.themeShared]'))
  }

  it('toutes ces variables déclarées dans le <theme> de l\'application : aucune ligne themeShared ne cite un module du cœur', async () => {
    const lignes = await construireProjet(VARIABLES)
    assert.deepEqual(lignes.filter((w) => /core-(field|number|color|carousel)/.test(w)), [], `les modules du cœur ne déclarent aucune de ces variables : ${lignes.join('\n')}`)
  })
})
