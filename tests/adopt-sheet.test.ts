// µ.adoptSheet(el, feuille) : colle une feuille de style dans l'ombre d'un composant pendant que la page tourne.
// L'ombre d'un composant est fermée et ModularJS remet à zéro ses feuilles quand le composant revient dans
// la page (connectedCallback) ou change de variante de mise en page : une feuille collée à la main y
// disparaissait. Celle-ci reste, passe APRÈS les feuilles du composant (elle peut les surcharger), n'est collée
// qu'une fois, se retire par la fonction rendue, et un texte CSS est accepté à la place d'une CSSStyleSheet.
// Une balise sans ombre (`mjs-light`) ou qui n'est pas un composant : rien n'est collé, la fonction rendue ne
// fait rien, aucune exception, et la console reçoit un avertissement qui nomme la balise et dit quoi faire à la place
// (écrire le style dans le <style> du composant, ou dans une feuille de la page), en français ou en anglais selon la
// page, une seule fois par nom de balise : cent composants légers du même nom n'en font qu'une ligne, deux noms en font deux.
// Chaque appel rend sa propre fonction de retrait : la feuille d'une balise ne part qu'avec la dernière (un compte par balise
// et par feuille). Une feuille que l'ombre refuse (non construite) ne lève rien, ne reçoit aucune marque et n'avertit pas.
// Une balise dont le composant n'est pas encore défini ne reçoit rien et n'avertit pas non plus : il aura son ombre à sa
// mise à niveau. L'exemple de la documentation (un parent et son enfant) est joué ici.
// Le runtime réel, bâti par le vrai Bundler (la page écrit `adoptSheet` : l'outil est détecté et embarqué),
// monté dans happy-dom ; le navigateur réel est dans adopt-sheet-browser.test.ts.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { RUNTIME_LABELS } from '../src/runtime-labels.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'

const pause    = (ms: number) => new Promise((r) => setTimeout(r, ms))
const attendre = async (cond: () => boolean, ms = 3000) => {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await pause(10)
}

// un composant qui appelle l'outil sur lui-même, avec un style à lui et une règle qui lit le thème embarqué
const HOTE = `<script>
@adopt  = (sheet) -> µ.adoptSheet(@, sheet)
@sombre = -> µtheme = 'dark'
@clair  = -> µtheme = 'light'
</script>
<p class="a">texte</p>
<p class="b">thème</p>
<style>
.a
  color: rgb(1, 2, 3)
.b
  color: $$fg
</style>
`

// le même composant, avec une variante de mise en page nommée : son changement réécrit les feuilles de l'ombre
const VARIE = HOTE + `<style name="compact">
.a
  color: rgb(4, 5, 6)
</style>
`

// l'exemple de la documentation : un parent colle un cadre dans son enfant tant que `$verified` est vrai, la fonction rendue est
// le nettoyage du reffet
const CADRE = `<script>
  $verified = false
  avatar    = null

  µeffect ->
    return unless $verified
    removeFrame = µ.adoptSheet(avatar, '.frame { border: 3px solid gold }')
    -> removeFrame()
</script>

<@avatar @this=!{avatar}/>
<button @click={$verified = not $verified}>Vérifier</button>
`

const AVATAR = `<p class="frame">avatar</p>
<style>
.frame
  border: 1px solid gray
</style>
`

let script      = ''
let scriptCoeur = ''
let scriptHote  = ''
let libelles    = ''

async function construire(): Promise<void> {
  const root   = mjsTmp('adopt-sheet')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hote.mjs'), HOTE)
  writeFileSync(join(srcDir, 'varie.mjs'), VARIE)
  writeFileSync(join(srcDir, 'cadre.mjs'), CADRE)
  writeFileSync(join(srcDir, 'avatar.mjs'), AVATAR)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
  const lire = (f: string) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))
  script      = ordre.map(lire).join('\n')
  // le runtime seul, puis le composant `hote` seul : pour une page où la balise est définie plus tard
  scriptCoeur = ordre.filter((f) => f.startsWith('mjs_')).map(lire).join('\n')
  scriptHote  = ordre.filter((f) => f.startsWith('hote')).map(lire).join('\n')
  // les libellés du manifeste, que le navigateur pose après le cœur : sans eux le message sort en français de secours
  libelles    = libellesDuManifeste(join(root, 'bundle.js'))
}

// une page neuve avec `n` composants, montés ; `leger` : la balise sans ombre (`mjs-light`), posée comme le fait le code
// généré (le drapeau transitoire `µ._mjs_lightNext`, juste avant le createElement : l'attribut arrive trop tard) ;
// `lang` : la langue de la page, qui choisit celle des messages de la console (`erreurs` et `avertissements` les recueillent)
async function monter(n = 1, leger = false, tag = 'mjs-hote', lang = ''): Promise<{ window: any, hotes: any[], erreurs: string[], avertissements: string[] }> {
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  if (lang) window.document.documentElement.setAttribute('lang', lang)
  // le fichier d'une variante (`varie.compact.css`) : servi ici, sans serveur
  window.fetch = async () => ({ ok: true, text: async () => '.a { color: rgb(4, 5, 6) }' })
  window.eval(`${script}\nglobalThis.µ = µ;\nglobalThis.__erreurs = [];\nglobalThis.__avertissements = [];\nµ.error = function(...a) { globalThis.__erreurs.push(a.map(String).join(' ')); };\nµ.warn = function(...a) { globalThis.__avertissements.push(a.map(String).join(' ')); };`)
  window.eval(libelles)
  if (leger) {
    window.µ._mjs_lightNext = tag
    window.document.body.appendChild(window.document.createElement(tag))
  }
  else window.document.body.innerHTML = Array.from({ length: n }, () => `<${tag}></${tag}>`).join('')
  const hotes = [...window.document.querySelectorAll(tag)]
  await attendre(() => hotes.every((h: any) => !!(h._shadow === h ? h : h._shadow)?.querySelector('.a')))
  await pause(80)
  return { window, hotes, erreurs: window.eval('globalThis.__erreurs'), avertissements: window.eval('globalThis.__avertissements') }
}

const feuilles = (hote: any): any[] => [...hote._shadow.adoptedStyleSheets]
const combien  = (hote: any, f: any): number => feuilles(hote).filter((s) => s === f).length

// ce que la console reçoit pour une balise sans ombre : le préfixe, puis le texte de la table dans la langue de la page
const sansOmbre = (lang: 'fr' | 'en', tag: string): string => '[ModularJS] ' + String((RUNTIME_LABELS[lang].err as any).adoptSheetNoShadow).replace('{tag}', tag)

// sort le composant de la page puis le remet : le framework rejoue l'adoption de ses feuilles
async function retirerPuisRemettre(hote: any): Promise<void> {
  const parent = hote.parentNode
  hote.remove()
  await pause(30)
  parent.appendChild(hote)
  await pause(120)
}

describe('µ.adoptSheet — une feuille collée dans l\'ombre d\'un composant', function () {
  this.timeout(60000)
  before(construire)
  after(async () => { await terminateSharedWorkerPool() })

  it('l\'outil est détecté à l\'usage : la page qui écrit adoptSheet le reçoit', async () => {
    const { window } = await monter()
    assert.equal(typeof window.µ.adoptSheet, 'function')
  })

  it('une CSSStyleSheet est collée dans l\'ombre, APRÈS les feuilles du composant (elle peut les surcharger)', async () => {
    const { window, hotes: [hote] } = await monter()
    const avant = feuilles(hote)
    assert.ok(avant.length >= 1, 'le composant a ses propres feuilles')
    const f = new window.CSSStyleSheet()
    f.replaceSync('.a { color: rgb(9, 9, 9) }')
    hote.adopt(f)
    const apres = feuilles(hote)
    assert.equal(apres.length, avant.length + 1, 'une feuille de plus')
    assert.deepEqual(apres.slice(0, avant.length), avant, 'celles du composant d\'abord, dans leur ordre')
    assert.equal(apres[apres.length - 1], f, 'la nôtre en dernier')
  })

  it('un texte CSS est accepté : une feuille construite, collée en dernier', async () => {
    const { window, hotes: [hote] } = await monter()
    const avant = feuilles(hote).length
    hote.adopt('.a { color: rgb(9, 9, 9) }')
    const apres = feuilles(hote)
    assert.equal(apres.length, avant + 1)
    const f = apres[apres.length - 1]
    assert.ok(f instanceof window.CSSStyleSheet)
    assert.equal(f.cssRules.length, 1)
    assert.equal(f.cssRules[0].selectorText, '.a')
  })

  it('le témoin : une feuille collée à la main, sans l\'outil, disparaît quand le composant revient dans la page', async () => {
    const { window, hotes: [hote] } = await monter()
    const brute = new window.CSSStyleSheet()
    brute.replaceSync('.a { color: rgb(9, 9, 9) }')
    hote._shadow.adoptedStyleSheets = [...hote._shadow.adoptedStyleSheets, brute]
    assert.equal(combien(hote, brute), 1)
    await retirerPuisRemettre(hote)
    assert.equal(combien(hote, brute), 0, 'remise à zéro par le framework : c\'est le défaut que l\'outil corrige')
  })

  it('composant retiré de la page puis remis : la feuille est toujours là, toujours en dernier', async () => {
    const { window, hotes: [hote] } = await monter()
    const f = new window.CSSStyleSheet()
    f.replaceSync('.a { color: rgb(9, 9, 9) }')
    hote.adopt(f)
    await retirerPuisRemettre(hote)
    let l = feuilles(hote)
    assert.equal(combien(hote, f), 1, 'une seule fois')
    assert.equal(l[l.length - 1], f, 'en dernier, après les feuilles du composant que le framework vient de reposer')
    await retirerPuisRemettre(hote)
    l = feuilles(hote)
    assert.equal(combien(hote, f), 1, 'une seule fois, après un deuxième aller-retour')
    assert.equal(l[l.length - 1], f)
  })

  it('un texte CSS survit aussi au retrait puis à la remise', async () => {
    const { hotes: [hote] } = await monter()
    hote.adopt('.a { color: rgb(9, 9, 9) }')
    const f = feuilles(hote).pop()
    await retirerPuisRemettre(hote)
    assert.equal(combien(hote, f), 1)
    assert.equal(feuilles(hote).pop(), f)
  })

  it('appelé deux fois avec la même feuille : collée une seule fois', async () => {
    const { window, hotes: [hote] } = await monter()
    const avant = feuilles(hote).length
    const f = new window.CSSStyleSheet()
    f.replaceSync('.a { color: rgb(9, 9, 9) }')
    hote.adopt(f)
    hote.adopt(f)
    assert.equal(feuilles(hote).length, avant + 1)
    assert.equal(combien(hote, f), 1)
  })

  it('appelé deux fois avec le même texte : une seule feuille, la même', async () => {
    const { hotes: [hote] } = await monter()
    const avant = feuilles(hote).length
    hote.adopt('.a { color: rgb(9, 9, 9) }')
    const f = feuilles(hote).pop()
    hote.adopt('.a { color: rgb(9, 9, 9) }')
    assert.equal(feuilles(hote).length, avant + 1)
    assert.equal(feuilles(hote).pop(), f)
  })

  it('deux textes différents : deux feuilles, dans l\'ordre des appels', async () => {
    const { hotes: [hote] } = await monter()
    const avant = feuilles(hote).length
    hote.adopt('.a { color: rgb(1, 1, 1) }')
    hote.adopt('.a { color: rgb(2, 2, 2) }')
    const l = feuilles(hote)
    assert.equal(l.length, avant + 2)
    assert.match(l[avant].cssRules[0].cssText, /rgb\(1, 1, 1\)/)
    assert.match(l[avant + 1].cssRules[0].cssText, /rgb\(2, 2, 2\)/)
  })

  it('la fonction rendue retire la feuille ; la rappeler ne fait rien ; la retirée ne revient pas à la remise', async () => {
    const { window, hotes: [hote] } = await monter()
    const avant = feuilles(hote)
    const f = new window.CSSStyleSheet()
    f.replaceSync('.a { color: rgb(9, 9, 9) }')
    const retire = hote.adopt(f)
    assert.equal(typeof retire, 'function')
    assert.equal(combien(hote, f), 1)
    retire()
    assert.deepEqual(feuilles(hote), avant, 'les feuilles du composant sont intactes')
    assert.doesNotThrow(() => retire())
    assert.deepEqual(feuilles(hote), avant)
    await retirerPuisRemettre(hote)
    assert.equal(combien(hote, f), 0)
  })

  it('retirer un texte CSS : sa feuille part, une feuille collée après elle reste', async () => {
    const { hotes: [hote] } = await monter()
    const retire1 = hote.adopt('.a { color: rgb(1, 1, 1) }')
    hote.adopt('.a { color: rgb(2, 2, 2) }')
    const [f1, f2] = feuilles(hote).slice(-2)
    retire1()
    assert.equal(combien(hote, f1), 0)
    assert.equal(feuilles(hote).pop(), f2)
  })

  it('une feuille partagée entre deux composants : en retirer une ne touche pas l\'autre', async () => {
    const { window, hotes: [a, b] } = await monter(2)
    const f = new window.CSSStyleSheet()
    f.replaceSync('.a { color: rgb(9, 9, 9) }')
    const retireA = a.adopt(f)
    b.adopt(f)
    assert.equal(combien(a, f), 1)
    assert.equal(combien(b, f), 1)
    retireA()
    assert.equal(combien(a, f), 0)
    assert.equal(combien(b, f), 1, 'la feuille reste chez l\'autre')
    await retirerPuisRemettre(b)
    assert.equal(combien(b, f), 1, 'et y survit à la remise')
  })

  it('un composant ne reçoit pas la feuille collée chez un autre', async () => {
    const { hotes: [a, b] } = await monter(2)
    const avantB = feuilles(b)
    a.adopt('.a { color: rgb(9, 9, 9) }')
    assert.deepEqual(feuilles(b), avantB)
  })

  it('un changement de thème (µtheme, attribut, thème de l\'appli réécrit) : la feuille reste, en dernier', async () => {
    const { window, hotes: [hote] } = await monter()
    hote.adopt('.b { color: rgb(9, 9, 9) }')
    const f = feuilles(hote).pop()
    const avant = feuilles(hote)
    hote.sombre()
    await attendre(() => window.document.documentElement.getAttribute('data-mjs-theme') === 'dark')
    assert.equal(window.document.documentElement.getAttribute('data-mjs-theme'), 'dark', 'le thème a bien changé')
    await pause(60)
    assert.deepEqual(feuilles(hote), avant, 'la liste du composant n\'a pas bougé')
    hote.setAttribute('theme', 'dark')
    window.µ._themeCss = ':where([theme=\'dark\']) { --mjs-fg: #eee }'
    window.µ._themeAdopt()
    hote.clair()
    await pause(60)
    assert.equal(combien(hote, f), 1)
    assert.equal(feuilles(hote).pop(), f)
  })

  it('une remise à zéro explicite des feuilles (_mjs_applyLayout, ce que fait un changement de variante) : la feuille reste, en dernier', async () => {
    const { window, hotes: [hote] } = await monter()
    const f = new window.CSSStyleSheet()
    f.replaceSync('.a { color: rgb(9, 9, 9) }')
    hote.adopt(f)
    await hote._mjs_applyLayout('default')
    await hote._mjs_applyLayout('default')
    assert.equal(combien(hote, f), 1)
    assert.equal(feuilles(hote).pop(), f)
  })

  it('un changement de variante de mise en page (la queue de _mjs_applyLayout, qui réécrit aussi les feuilles) : la feuille reste, en dernier, après celle de la variante', async () => {
    const { hotes: [hote] } = await monter(1, false, 'mjs-varie')
    const propres = feuilles(hote)
    hote.adopt('.a { color: rgb(9, 9, 9) }')
    const f = feuilles(hote).pop()
    await hote._mjs_applyLayout('compact')
    let l = feuilles(hote)
    assert.equal(l.length, propres.length + 2, 'celles du composant, la variante, la nôtre')
    assert.match(l[l.length - 2].cssRules[0].cssText, /rgb\(4, 5, 6\)/, 'la feuille de la variante vient juste avant la nôtre')
    assert.equal(l[l.length - 1], f, 'la nôtre reste en dernier : elle peut surcharger la variante')
    await hote._mjs_applyLayout('default')
    l = feuilles(hote)
    assert.equal(l.length, propres.length + 1, 'la variante est partie, la nôtre est restée')
    assert.equal(l[l.length - 1], f)
  })

  it('balise sans ombre (mjs-light) : rien n\'est collé, la fonction rendue ne fait rien, aucune exception ni erreur', async () => {
    const { window, hotes: [hote], erreurs } = await monter(1, true)
    assert.equal(hote._mjs_isLight, true, 'la balise est bien légère')
    const docAvant = window.document.adoptedStyleSheets.length
    const styles   = window.document.querySelectorAll('style').length
    let retire: any
    assert.doesNotThrow(() => { retire = hote.adopt('.a { color: rgb(9, 9, 9) }') })
    assert.equal(typeof retire, 'function')
    assert.equal(window.document.adoptedStyleSheets.length, docAvant, 'rien dans les feuilles du document')
    assert.equal(window.document.querySelectorAll('style').length, styles, 'aucune balise <style> de plus')
    assert.doesNotThrow(() => retire())
    assert.deepEqual([...erreurs], [])
  })

  it('ce qui n\'est pas un composant ModularJS, ou une feuille illisible : fonction rendue, rien de collé, aucune exception', async () => {
    const { window, hotes: [hote], erreurs } = await monter()
    const µ = window.µ
    const avant = feuilles(hote)
    for (const el of [window.document.createElement('div'), window.document.body, window.document, null, undefined, 'mjs-hote', 42, {}]) {
      let retire: any
      assert.doesNotThrow(() => { retire = µ.adoptSheet(el, '.a { color: red }') })
      assert.equal(typeof retire, 'function')
      assert.doesNotThrow(() => retire())
    }
    for (const feuille of [undefined, null, 42, {}, [], true]) {
      let retire: any
      assert.doesNotThrow(() => { retire = hote.adopt(feuille) })
      assert.equal(typeof retire, 'function')
      assert.doesNotThrow(() => retire())
    }
    assert.deepEqual(feuilles(hote), avant, 'rien n\'a été collé')
    assert.equal(feuilles(hote).every((s) => !s._mjs_keep || avant.includes(s)), true)
    assert.deepEqual([...erreurs], [])
  })

  it('le même texte demandé deux fois sur la balise : la feuille ne part qu\'au dernier retrait', async () => {
    const { hotes: [hote] } = await monter()
    const avant   = feuilles(hote)
    const retireA = hote.adopt('.a { color: rgb(9, 9, 9) }')
    const retireB = hote.adopt('.a { color: rgb(9, 9, 9) }')
    const f       = feuilles(hote).pop()
    assert.equal(feuilles(hote).length, avant.length + 1, 'une seule feuille pour les deux appels')
    retireA()
    assert.equal(combien(hote, f), 1, 'le deuxième appel la tient encore')
    await retirerPuisRemettre(hote)
    assert.equal(combien(hote, f), 1, 'et elle survit à la remise')
    retireB()
    assert.equal(combien(hote, f), 0, 'le dernier retrait la retire')
    assert.deepEqual(feuilles(hote), avant)
  })

  it('la même CSSStyleSheet demandée deux fois sur la balise : la feuille ne part qu\'au dernier retrait', async () => {
    const { window, hotes: [hote] } = await monter()
    const f = new window.CSSStyleSheet()
    f.replaceSync('.a { color: rgb(9, 9, 9) }')
    const retireA = hote.adopt(f)
    const retireB = hote.adopt(f)
    assert.equal(combien(hote, f), 1)
    retireB()
    assert.equal(combien(hote, f), 1, 'le premier appel la tient encore')
    retireA()
    assert.equal(combien(hote, f), 0)
  })

  it('une fonction de retrait rappelée ne rend qu\'un seul appel : elle ne retire pas la feuille de l\'autre', async () => {
    const { hotes: [hote] } = await monter()
    const retireA = hote.adopt('.a { color: rgb(9, 9, 9) }')
    const retireB = hote.adopt('.a { color: rgb(9, 9, 9) }')
    const f       = feuilles(hote).pop()
    retireA()
    retireA()
    retireA()
    assert.equal(combien(hote, f), 1, 'rappeler la même fonction ne compte pas deux fois')
    retireB()
    assert.equal(combien(hote, f), 0)
  })

  it('la feuille retirée puis demandée de nouveau est collée de nouveau, avec un compte neuf', async () => {
    const { hotes: [hote] } = await monter()
    const avant   = feuilles(hote)
    const retire1 = hote.adopt('.a { color: rgb(9, 9, 9) }')
    retire1()
    assert.deepEqual(feuilles(hote), avant)
    const retire2 = hote.adopt('.a { color: rgb(9, 9, 9) }')
    retire1()
    assert.equal(feuilles(hote).length, avant.length + 1, 'l\'ancienne fonction ne retire pas la feuille neuve')
    retire2()
    assert.deepEqual(feuilles(hote), avant)
  })

  it('le compte est par balise : la même CSSStyleSheet sur deux balises, deux appels sur l\'une', async () => {
    const { window, hotes: [a, b] } = await monter(2)
    const f = new window.CSSStyleSheet()
    f.replaceSync('.a { color: rgb(9, 9, 9) }')
    const retireA1 = a.adopt(f)
    const retireA2 = a.adopt(f)
    const retireB  = b.adopt(f)
    retireA1()
    assert.equal(combien(a, f), 1)
    assert.equal(combien(b, f), 1)
    retireB()
    assert.equal(combien(b, f), 0)
    assert.equal(combien(a, f), 1, 'le retrait de l\'autre balise ne touche pas le compte de celle-ci')
    retireA2()
    assert.equal(combien(a, f), 0)
  })

  it('une feuille que l\'ombre refuse (non construite) : aucune exception, fonction rendue, rien de collé, aucune marque posée sur la feuille, aucun avertissement', async () => {
    const { window, hotes: [hote], avertissements } = await monter()
    const refusee = new window.CSSStyleSheet()
    refusee.replaceSync('.a { color: red }')
    // l'ombre refuse cette feuille-là, comme le font les trois navigateurs pour une feuille d'un <style> du document
    let liste = hote._shadow.adoptedStyleSheets
    Object.defineProperty(hote._shadow, 'adoptedStyleSheets', {
      configurable: true,
      get: () => liste,
      set: (v: any[]) => {
        if (v.includes(refusee)) throw new window.DOMException('Sheet needs to be constructed by JavaScript', 'NotAllowedError')
        liste = v
      }
    })
    const avant = Object.getOwnPropertyNames(refusee)
    let retire: any
    assert.doesNotThrow(() => { retire = hote.adopt(refusee) })
    assert.equal(typeof retire, 'function')
    assert.doesNotThrow(() => retire())
    assert.deepEqual(Object.getOwnPropertyNames(refusee), avant, 'la feuille refusée n\'a reçu aucune marque')
    assert.equal(combien(hote, refusee), 0)
    // l'outil reste utilisable après le refus
    hote.adopt('.a { color: rgb(9, 9, 9) }')
    assert.equal(feuilles(hote).pop().cssRules.length, 1)
    assert.deepEqual([...avertissements], [], 'le composant a son ombre : rien à dire, la feuille refusée garde son silence')
  })

  it('une balise dont le composant n\'est pas encore défini : rien n\'est collé et rien n\'est dit ; une fois défini (whenDefined), l\'appel colle', async () => {
    const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
    window.eval(`${scriptCoeur}\nglobalThis.µ = µ;\nglobalThis.__avertissements = [];\nµ.warn = function(...a) { globalThis.__avertissements.push(a.map(String).join(' ')); };`)
    window.eval(libelles)
    window.document.body.innerHTML = '<mjs-hote></mjs-hote>'
    const hote = window.document.querySelector('mjs-hote')
    assert.equal(window.customElements.get('mjs-hote'), undefined, 'le composant n\'est pas encore défini')
    let avantMiseANiveau: any
    assert.doesNotThrow(() => { avantMiseANiveau = window.µ.adoptSheet(hote, '.a { color: rgb(9, 9, 9) }') })
    assert.equal(typeof avantMiseANiveau, 'function')
    assert.doesNotThrow(() => avantMiseANiveau())
    assert.deepEqual([...window.eval('globalThis.__avertissements')], [], 'il aura son ombre à sa mise à niveau : ce n\'est pas une balise sans ombre')
    window.eval(scriptHote)
    await window.customElements.whenDefined('mjs-hote')
    await attendre(() => !!hote._shadow?.querySelector('.a'))
    await pause(80)
    const propres = feuilles(hote)
    assert.ok(propres.length >= 1, 'le composant a été mis à niveau avec ses feuilles')
    assert.equal(propres.some((s) => s._mjs_keep), false, 'l\'appel d\'avant la mise à niveau n\'a rien laissé')
    window.µ.adoptSheet(hote, '.a { color: rgb(9, 9, 9) }')
    assert.equal(feuilles(hote).length, propres.length + 1, 'après whenDefined, l\'appel colle')
    assert.deepEqual([...window.eval('globalThis.__avertissements')], [], 'et sans rien dire')
  })

  it('l\'exemple de la documentation : le parent colle un cadre dans son enfant tant que $verified est vrai, et le retire quand il retombe', async () => {
    const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
    window.eval(`${script}\nglobalThis.µ = µ;`)
    window.document.body.innerHTML = '<mjs-cadre></mjs-cadre>'
    const parent = window.document.querySelector('mjs-cadre')
    await attendre(() => !!parent._shadow?.querySelector('mjs-avatar')?._shadow?.querySelector('.frame'))
    await pause(80)
    const avatar  = parent._shadow.querySelector('mjs-avatar')
    const propres = feuilles(avatar)
    const cadre   = () => feuilles(avatar).filter((s) => s.cssRules.length === 1 && /3px solid gold/.test(s.cssRules[0].cssText))
    assert.equal(cadre().length, 0, 'pas vérifié : pas de cadre')
    parent._shadow.querySelector('button').click()
    await pause(80)
    assert.equal(cadre().length, 1, 'vérifié : le cadre est collé dans l\'enfant')
    assert.equal(feuilles(avatar).length, propres.length + 1)
    await retirerPuisRemettre(avatar)
    assert.equal(cadre().length, 1, 'il survit à la sortie et à la remise de l\'enfant')
    parent._shadow.querySelector('button').click()
    await pause(80)
    assert.equal(cadre().length, 0, 'plus vérifié : le nettoyage du reffet retire le cadre')
    assert.equal(feuilles(avatar).length, propres.length)
  })

  describe('une balise sans ombre avertit : la console la nomme et dit quoi faire à la place, une seule fois par nom de balise', () => {
    const CSS = '.a { color: rgb(9, 9, 9) }'

    // ajoute `n` composants légers de la balise `tag` à la page : le drapeau `_mjs_lightNext` se pose juste avant chaque createElement
    async function ajouterLegers(window: any, tag: string, n: number): Promise<any[]> {
      const els: any[] = []
      for (let i = 0; i < n; i++) {
        window.µ._mjs_lightNext = tag
        els.push(window.document.body.appendChild(window.document.createElement(tag)))
      }
      await attendre(() => els.every((e) => !!e._shadow?.querySelector('.a')))
      for (const e of els) assert.equal(e._mjs_isLight, true, 'la balise ajoutée est légère')
      return els
    }

    it('composant mjs-light, page en français : un avertissement qui nomme la balise, dit pourquoi la feuille n\'est pas collée et quoi faire', async () => {
      const { hotes: [hote], avertissements } = await monter(1, true)
      assert.equal(hote._mjs_isLight, true, 'la balise est bien légère')
      assert.deepEqual([...avertissements], [], 'rien tant que l\'outil n\'est pas appelé')
      hote.adopt(CSS)
      assert.deepEqual([...avertissements], [sansOmbre('fr', 'mjs-hote')])
      const texte = avertissements[0]
      assert.match(texte, /^\[ModularJS\] µ\.adoptSheet : /, 'l\'outil est nommé')
      assert.match(texte, /<mjs-hote>/, 'la balise est nommée')
      assert.match(texte, /n'est pas collée/)
      assert.match(texte, /n'a pas d'ombre/, 'la cause : pas d\'ombre')
      assert.match(texte, /<style> du composant/, 'quoi faire : le <style> du composant')
      assert.match(texte, /feuille de la page/, 'ou une feuille de la page')
      assert.match(texte, /les feuilles de la page s'appliquent déjà/, 'et pourquoi cela suffit')
    })

    it('composant mjs-light, page en anglais : le même avertissement, en anglais', async () => {
      const { hotes: [hote], avertissements } = await monter(1, true, 'mjs-hote', 'en')
      hote.adopt(CSS)
      assert.deepEqual([...avertissements], [sansOmbre('en', 'mjs-hote')])
      const texte = avertissements[0]
      assert.match(texte, /^\[ModularJS\] µ\.adoptSheet: /)
      assert.match(texte, /<mjs-hote>/)
      assert.match(texte, /is not attached/)
      assert.match(texte, /has no shadow/)
      assert.match(texte, /<style> of the component/)
      assert.match(texte, /stylesheet of the page/)
      assert.match(texte, /the page's stylesheets already apply/)
      assert.doesNotMatch(texte, /[àâäçéèêëîïôöùûüœ]/i)
    })

    it('une seule fois : rappeler l\'outil sur la même balise (même texte, autre texte, CSSStyleSheet) ou sa fonction rendue ne répète rien', async () => {
      const { window, hotes: [hote], avertissements } = await monter(1, true)
      const f = new window.CSSStyleSheet()
      f.replaceSync(CSS)
      const retire = hote.adopt(CSS)
      hote.adopt(CSS)
      hote.adopt('.a { color: red }')
      hote.adopt(f)
      retire()
      for (let i = 0; i < 50; i++) hote.adopt(CSS)()
      assert.equal(avertissements.length, 1)
    })

    it('deux balises du même nom (deux composants légers) : une seule ligne, chacune eût-elle rappelé l\'outil', async () => {
      const { window, hotes: [a], avertissements } = await monter(1, true)
      const [b] = await ajouterLegers(window, 'mjs-hote', 1)
      assert.notEqual(a, b, 'deux balises distinctes')
      for (const hote of [a, b, a, b]) hote.adopt(CSS)
      assert.deepEqual([...avertissements], [sansOmbre('fr', 'mjs-hote')])
    })

    it('pas de rafale : vingt-cinq composants légers du même nom qui appellent l\'outil deux fois chacun, une seule ligne', async () => {
      const { window, hotes: [a], avertissements } = await monter(1, true)
      const autres = await ajouterLegers(window, 'mjs-hote', 24)
      for (let tour = 0; tour < 2; tour++) for (const hote of [a, ...autres]) hote.adopt(CSS)
      assert.deepEqual([...avertissements], [sansOmbre('fr', 'mjs-hote')])
    })

    it('deux noms de balise différents : deux lignes, une par nom, dans l\'ordre des premiers appels', async () => {
      const { window, hotes: [a], avertissements } = await monter(1, true)
      const [b] = await ajouterLegers(window, 'mjs-varie', 1)
      for (const hote of [a, b, a, b]) hote.adopt(CSS)
      assert.deepEqual([...avertissements], [sansOmbre('fr', 'mjs-hote'), sansOmbre('fr', 'mjs-varie')])
    })

    it('une balise qui n\'est pas un composant ModularJS : le même avertissement, au nom de la balise, une fois par nom de balise', async () => {
      const { window, avertissements } = await monter()
      const µ  = window.µ
      const un = window.document.createElement('div')
      µ.adoptSheet(un, CSS)
      µ.adoptSheet(un, CSS)
      assert.deepEqual([...avertissements], [sansOmbre('fr', 'div')])
      for (let i = 0; i < 100; i++) µ.adoptSheet(window.document.createElement('div'), CSS)
      assert.deepEqual([...avertissements], [sansOmbre('fr', 'div')], 'cent autres div : même nom, rien de plus')
      µ.adoptSheet(window.document.body, CSS)
      // un élément personnalisé défini hors de ModularJS n'est pas un composant non plus
      window.customElements.define('x-tiers', class extends window.HTMLElement {})
      µ.adoptSheet(window.document.createElement('x-tiers'), CSS)
      µ.adoptSheet(window.document.createElement('x-tiers'), CSS)
      assert.deepEqual([...avertissements], [sansOmbre('fr', 'div'), sansOmbre('fr', 'body'), sansOmbre('fr', 'x-tiers')])
    })

    it('un nom de balise personnalisée pas encore défini ne consomme pas l\'avertissement : défini ensuite, il le reçoit, une fois', async () => {
      const { window, avertissements } = await monter()
      const µ = window.µ
      µ.adoptSheet(window.document.createElement('x-plus-tard'), CSS)
      assert.deepEqual([...avertissements], [], 'pas encore défini : rien à dire')
      window.customElements.define('x-plus-tard', class extends window.HTMLElement {})
      µ.adoptSheet(window.document.createElement('x-plus-tard'), CSS)
      µ.adoptSheet(window.document.createElement('x-plus-tard'), CSS)
      assert.deepEqual([...avertissements], [sansOmbre('fr', 'x-plus-tard')])
    })

    it('ce qui n\'est pas une balise (null, undefined, un texte, un nombre, un objet, le document) : rien à nommer, aucun avertissement', async () => {
      const { window, avertissements } = await monter()
      for (const valeur of [null, undefined, 'mjs-hote', 42, {}, [], window.document]) window.µ.adoptSheet(valeur, CSS)
      assert.deepEqual([...avertissements], [])
    })

    it('composant à ombre : la feuille est collée et rien n\'est dit', async () => {
      const { hotes: [hote], avertissements } = await monter()
      const avant = feuilles(hote).length
      hote.adopt(CSS)
      hote.adopt(CSS)
      assert.equal(feuilles(hote).length, avant + 1)
      assert.deepEqual([...avertissements], [])
    })
  })
})
