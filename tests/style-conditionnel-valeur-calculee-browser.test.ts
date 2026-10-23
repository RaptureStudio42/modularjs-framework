// `@style.<prop>{condition}={valeur}` : la valeur calculée, écrite entre accolades sans guillemets, est posée quand la condition est vraie, retirée quand elle est fausse, et suit
// la condition comme la valeur. Le découpage s'arrêtait au premier blanc : `@style.color{$on}={$on ? 'red' : 'blue'}` donnait la valeur `{$on` et des attributs parasites,
// sans un mot, y compris à la racine. Chaque cas a son témoin, la même valeur écrite entre guillemets (`="{…}"`), qui marchait : un témoin faux dirait que le test lui-même
// est faux, il arrête donc le cas aussitôt.
// `@class{condition}` avec une condition qui contient des espaces et des guillemets (`$mot === 'oui' and $on`, `$mot === "oui" ? $on : false`) est jouée dans les mêmes lieux :
// à la racine, dans un `{if}`, dans une ligne de `{for}`, dans la branche `{success}` d'un `{await}`.
// Les trois modes : développement, production en fichiers séparés, production en un seul fichier. Chromium réel.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'

const R = 'rgb(255, 0, 0)'
const V = 'rgb(0, 128, 0)'

const SOURCES: Record<string, string> = {
  // à la racine : la valeur suit la condition (`litteral`) ou une autre variable (`vif`) ; `quote` est le témoin, la même valeur entre guillemets
  'sc-racine.mjs': `<script>
  $on  = true
  $vif = true
  $n   = 3
  $mot = 'oui'
  @basculer = -> $on = not $on
  @changer  = -> $vif = not $vif
  @compter  = (k) -> $n = k
  @dire     = (m) -> $mot = m
</script>
<p class="litteral" @style.color{$on}={$on ? 'red' : 'blue'}>a</p>
<p class="vif" @style.color{$on}={$vif ? '${R}' : "${V}"}>b</p>
<p class="quote" @style.color{$on}="{$vif ? '${R}' : '${V}'}">c</p>
<p class="largeur" @style.width{$on}={$n + 1}px>d</p>
<p class="cl-a" @class{$mot === 'oui' and $on}="actif">e</p>
<p class="cl-b" @class{$mot === "oui" ? $on : false}="actif">f</p>
<u class="temoin">témoin</u>
`,
  // dans un {if} : la balise naît avec l'état du moment
  'sc-si.mjs': `<script>
  $si  = true
  $on  = true
  $vif = true
  $mot = 'oui'
  @montrer  = (v) -> $si = v
  @basculer = -> $on = not $on
  @changer  = -> $vif = not $vif
</script>
{if $si}
  <p class="dans-si" @style.color{$on}={$vif ? '${R}' : "${V}"} @class{$mot === 'oui' and $on}="actif">si</p>
{end}
<u class="temoin">témoin</u>
`,
  // dans une ligne de {for} : la condition et la valeur lisent la ligne ; la classe lit la ligne et une variable
  'sc-pour.mjs': `<script>
  $on   = true
  $rows = [{ id: 1, nom: 'a', on: true, couleur: 'rgb(1, 2, 3)' }, { id: 2, nom: 'b', on: false, couleur: 'rgb(4, 5, 6)' }]
  @regler   = (r) -> $rows = r
  @basculer = -> $on = not $on
</script>
{for r in $rows by id}
  <li class="ligne" @style.color{r.on}={r.on ? r.couleur : 'inherit'} @class{r.nom === 'a' and $on}="actif">{r.nom}</li>
{end}
<u class="temoin">témoin</u>
`,
  // dans la branche {success v} : la valeur de la branche, une variable, les deux ; la promesse est tenue par le test
  'sc-succes.mjs': `<script>
  $on  = true
  $vif = true
  fin  = null
  $p   = new Promise((res) -> fin = res)
  @finir    = (v) -> fin(v)
  @attendre = -> $p = new Promise((res) -> fin = res)
  @basculer = -> $on = not $on
  @changer  = -> $vif = not $vif
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  <p class="dans-succes" @style.color{v.on}={v.on ? v.couleur : 'inherit'} @class{v.nom === 'a' and $on}="actif">ok</p>
  <p class="mixte" @style.color{$on}={$vif ? v.couleur : "${V}"}>mixte</p>
{end}
<u class="temoin">témoin</u>
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

// un appel sur le composant (`basculer()`, `regler([…])`…), puis le temps de la mise à jour ; la méthode rend parfois une promesse
// (`attendre()` rend celle qu'elle pose) et `evaluate` l'attendrait : rien n'est rendu à la page
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

type Quoi = 'color' | 'width' | 'actif'

// ce que la page dit d'une balise : la couleur ou la largeur posée (`∅` quand rien n'est posé), ou la présence de la classe `actif` (`oui` / `non`) ; `absente` quand la balise n'est pas dans l'ombre
const lire = (page: any, balise: string, sel: string, quoi: Quoi): Promise<string> => page.evaluate(`(() => {
  const n = document.querySelector('${balise}')._shadow.querySelector('${sel}')
  if (!n) return 'absente'
  if ('${quoi}' === 'actif') return n.classList.contains('actif') ? 'oui' : 'non'
  return n.style['${quoi}'] || '∅'
})()`)

// chaque étape : [nom, appel (ou null), ce que dit chaque colonne dans l'ordre de `colonnes`] ; le composant est vivant à chaque étape
async function parcours(page: any, balise: string, colonnes: Array<[string, Quoi]>, etapes: Array<[string, string | null, ...string[]]>, ecarts: string[]) {
  for (const [nom, appel, ...attendus] of etapes) {
    if (appel) await regler(page, balise, appel)
    verifier(ecarts, `composant vivant, ${nom}`, await vivant(page, balise), true)
    for (let i = 0; i < colonnes.length; i++) verifier(ecarts, `${colonnes[i][0]} (${colonnes[i][1]}), ${nom}`, await lire(page, balise, colonnes[i][0], colonnes[i][1]), attendus[i])
  }
}

for (const mode of ['dev-parents-avant', 'split', 'bundle'] as const) describe(`@style.<prop>{condition}={valeur} et @class{condition} à espaces et guillemets (${mode}, Chromium réel)`, function () {
  this.timeout(120000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright.chromium.executablePath())
    if (!present) { console.log('  ℹ️  chromium non installé, test du style conditionnel sauté. Activer : `npx playwright install chromium`'); return }
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

  it('à la racine : la valeur est posée, retirée et suit la condition comme la valeur ; la largeur mêlée de texte aussi', async function () {
    if (!present) { this.skip(); return }
    const C = 'mjs-sc-racine'
    await jouer(C, async (page, ecarts) => {
      verifier(ecarts, 'composant vivant, à la création', await vivant(page, C), true)
      if (await vivant(page, C)) assert.equal(await lire(page, C, '.quote', 'color'), R, 'le témoin entre guillemets est faux : le test lui-même est à revoir')
      await parcours(page, C, [['.litteral', 'color'], ['.vif', 'color'], ['.quote', 'color'], ['.largeur', 'width']], [
        ['à la création',                      null,              'red', R, R, '4px'],
        ['la valeur change ($vif)',            'changer()',       'red', V, V, '4px'],
        ['la largeur change ($n)',             'compter(9)',      'red', V, V, '10px'],
        ['la condition tombe ($on)',           'basculer()',      '∅', '∅', '∅', '∅'],
        ['la valeur change, condition fausse', 'changer()',       '∅', '∅', '∅', '∅'],
        ['la condition revient',               'basculer()',      'red', R, R, '10px']
      ], ecarts)
    })
  })

  it('à la racine : @class{condition} à espaces et guillemets suit ses variables', async function () {
    if (!present) { this.skip(); return }
    const C = 'mjs-sc-racine'
    await jouer(C, async (page, ecarts) => {
      await parcours(page, C, [['.cl-a', 'actif'], ['.cl-b', 'actif']], [
        ['à la création',                null,            'oui', 'oui'],
        ['$mot change',                  'dire(\'non\')', 'non', 'non'],
        ['$mot revient',                 'dire(\'oui\')', 'oui', 'oui'],
        ['$on tombe',                    'basculer()',    'non', 'non'],
        ['$on revient',                  'basculer()',    'oui', 'oui']
      ], ecarts)
    })
  })

  it('dans un {if} : la balise naît avec l\'état du moment, la valeur et la classe le suivent', async function () {
    if (!present) { this.skip(); return }
    const C = 'mjs-sc-si'
    await jouer(C, async (page, ecarts) => {
      await parcours(page, C, [['.dans-si', 'color'], ['.dans-si', 'actif']], [
        ['à la création',                 null,                R, 'oui'],
        ['la valeur change',              'changer()',         V, 'oui'],
        ['le {if} se ferme',              'montrer(false)',    'absente', 'absente'],
        ['$on tombe pendant ce temps',    'basculer()',        'absente', 'absente'],
        ['le {if} s\'ouvre',              'montrer(true)',     '∅', 'non'],
        ['$on revient',                   'basculer()',        V, 'oui'],
        ['la valeur revient',             'changer()',         R, 'oui']
      ], ecarts)
    })
  })

  it('dans une ligne de {for} : chaque ligne lit sa condition et sa valeur, la classe lit la ligne et une variable', async function () {
    if (!present) { this.skip(); return }
    const C  = 'mjs-sc-pour'
    const L1 = 'li.ligne:nth-of-type(1)'
    const L2 = 'li.ligne:nth-of-type(2)'
    const L3 = 'li.ligne:nth-of-type(3)'
    await jouer(C, async (page, ecarts) => {
      await parcours(page, C, [[L1, 'color'], [L1, 'actif'], [L2, 'color'], [L2, 'actif'], [L3, 'color']], [
        ['à la création',                  null,
          'rgb(1, 2, 3)', 'oui', '∅', 'non', 'absente'],
        ['les lignes sont remplacées',     'regler([{ id: 1, nom: \'a\', on: true, couleur: \'rgb(7, 8, 9)\' }, { id: 2, nom: \'b\', on: true, couleur: \'rgb(4, 5, 6)\' }])',
          'rgb(7, 8, 9)', 'oui', 'rgb(4, 5, 6)', 'non', 'absente'],
        ['$on tombe',                      'basculer()',
          'rgb(7, 8, 9)', 'non', 'rgb(4, 5, 6)', 'non', 'absente'],
        ['une ligne s\'ajoute',            'regler([{ id: 1, nom: \'a\', on: false, couleur: \'rgb(7, 8, 9)\' }, { id: 2, nom: \'b\', on: true, couleur: \'rgb(4, 5, 6)\' }, { id: 3, nom: \'a\', on: true, couleur: \'rgb(10, 11, 12)\' }])',
          '∅', 'non', 'rgb(4, 5, 6)', 'non', 'rgb(10, 11, 12)'],
        ['$on revient',                    'basculer()',
          '∅', 'oui', 'rgb(4, 5, 6)', 'non', 'rgb(10, 11, 12)']
      ], ecarts)
      verifier(ecarts, 'classe de la troisième ligne, $on revenu', await lire(page, C, L3, 'actif'), 'oui')
    })
  })

  it('dans {success v} : la valeur de la branche, une variable, ou les deux ; la branche retirée puis revenue repart de l\'état du moment', async function () {
    if (!present) { this.skip(); return }
    const C  = 'mjs-sc-succes'
    const OK = '.dans-succes'
    const MX = '.mixte'
    await jouer(C, async (page, ecarts) => {
      await parcours(page, C, [[OK, 'color'], [OK, 'actif'], [MX, 'color']], [
        ['à la création',                   null,                                                                  'absente', 'absente', 'absente'],
        ['promesse tenue',                  'finir({ on: true, couleur: \'rgb(1, 2, 3)\', nom: \'a\' })',          'rgb(1, 2, 3)', 'oui', 'rgb(1, 2, 3)'],
        ['$vif change',                     'changer()',                                                           'rgb(1, 2, 3)', 'oui', V],
        ['$on tombe',                       'basculer()',                                                          'rgb(1, 2, 3)', 'non', '∅'],
        ['$on revient',                     'basculer()',                                                          'rgb(1, 2, 3)', 'oui', V],
        ['promesse remplacée',              'attendre()',                                                          'absente', 'absente', 'absente'],
        ['réglée avec la condition fausse', 'finir({ on: false, couleur: \'rgb(4, 5, 6)\', nom: \'a\' })',         '∅', 'oui', V]
      ], ecarts)
    })
  })
})
