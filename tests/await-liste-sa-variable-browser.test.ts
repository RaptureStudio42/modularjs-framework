// une liste placée dans `{success}` suit SA propre variable : `{await $page}{success p}{for x in $liste}<li>{x.nom}</li>{end}{end}` se refait quand `$liste`
// change après l'arrivée de la promesse (liste remplacée, modifiée en place, vidée, ou filtrée par une autre variable que lit l'itérable), comme la même liste
// hors de `{await}` ; les lignes qui ne lisent pas la liste n'y changent rien
// chaque cas a son témoin, la même liste à la racine : un témoin faux dirait que le test lui-même est faux, il arrête donc le cas aussitôt
// la promesse est tenue par le test (`finir()`), pour que la branche d'attente existe avant l'arrivée
// les trois modes : développement, production en fichiers séparés, production en un seul fichier ; Chromium réel

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'

const SOURCES: Record<string, string> = {
  // la liste de `{success}` : l'itérable lit `$liste` et `$filtre`, les lignes ne lisent aucune variable ; une clé, par `id`
  'al-cle.mjs': `<script>
  $liste  = [{ id: 1, nom: 'a' }, { id: 2, nom: 'b' }]
  $filtre = ''
  fin     = null
  $p      = new Promise((res) -> fin = res)
  visibles = (l, f) -> l.filter((y) -> y.nom.includes(f))

  @finir    = -> fin('ok')
  @relancer = -> $p = new Promise((res) -> fin = res)
  @poser    = (l) -> $liste = l
  @ajouter  = (x) -> $liste.push(x)
  @filtrer  = (f) -> $filtre = f
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  <ul class="dans">
    {for x in visibles($liste, $filtre) by id}<li>{x.nom}</li>{end}
  </ul>
{end}
<ul class="hors">
  {for x in visibles($liste, $filtre) by id}<li>{x.nom}</li>{end}
</ul>
`,
  // la forme de la consigne : branche `{success p}`, liste sans clé
  'al-sans-cle.mjs': `<script>
  $liste = [{ nom: 'a' }, { nom: 'b' }]
  fin    = null
  $page  = new Promise((res) -> fin = res)

  @finir = -> fin('ok')
  @poser = (l) -> $liste = l
</script>
{await $page}
  <i class="att">attente</i>
{success p}
  <ul class="dans">{for x in $liste}<li>{x.nom}</li>{end}</ul>
{end}
<ul class="hors">{for x in $liste}<li>{x.nom}</li>{end}</ul>
`,
  // la liste de `{success}` suit sa variable ET une autre lue par ses lignes : l'une et l'autre la refont
  'al-lignes.mjs': `<script>
  $liste   = [{ id: 1, nom: 'a' }]
  $suffixe = '!'
  fin      = null
  $p       = new Promise((res) -> fin = res)

  @finir    = -> fin('ok')
  @poser    = (l) -> $liste = l
  @suffixer = (s) -> $suffixe = s
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  <ul class="dans">{for x in $liste by id}<li>{x.nom}{$suffixe}</li>{end}</ul>
{end}
<ul class="hors">{for x in $liste by id}<li>{x.nom}{$suffixe}</li>{end}</ul>
`,
  // la liste de `{success}` lit la valeur de la branche et `$liste` : seule la variable la refait ; la valeur reste celle de la promesse
  'al-valeur.mjs': `<script>
  $liste = [{ id: 1, nom: 'a' }]
  fin    = null
  $p     = new Promise((res) -> fin = res)
  zed    = [{ id: 9, nom: 'z' }]
  ajoutes = (l, base) -> base.concat(l)

  @finir = -> fin(zed)
  @poser = (l) -> $liste = l
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  <ul class="dans">{for x in ajoutes($liste, v) by id}<li>{x.nom}</li>{end}</ul>
{end}
<ul class="hors">{for x in ajoutes($liste, zed) by id}<li>{x.nom}</li>{end}</ul>
`
}
const BALISES = Object.keys(SOURCES).map((f) => 'mjs-' + f.replace('.mjs', ''))

const cibles = new Map<Mode, Promise<Cible>>()
const cible  = (mode: Mode) => {
  if (!cibles.has(mode)) cibles.set(mode, construire(mode, SOURCES, BALISES))
  return cibles.get(mode)!
}

// les textes des lignes d'une liste (`.dans` ou `.hors`), séparés par des virgules ; `absente` quand la liste n'est pas dans la page
const lignes = (page: any, balise: string, liste: string): Promise<string> => page.evaluate(`(() => {
  const ul = document.querySelector('${balise}')._shadow.querySelector('ul.${liste}')
  return ul ? Array.from(ul.querySelectorAll('li')).map((n) => n.textContent).join(',') : 'absente'
})()`)

// le composant est prêt quand son témoin est dans l'ombre
const pret = async (page: any, balise: string) => {
  await page.waitForFunction(`!!document.querySelector('${balise}')?._shadow?.querySelector('ul.hors')`, null, { timeout: 10000 })
  await page.waitForTimeout(150)
}

// un appel sur le composant (`finir()`, `poser([…])`…), puis le temps de la mise à jour ; la méthode rend parfois une promesse
// (`relancer()` rend celle qu'elle pose) et `evaluate` l'attendrait : rien n'est rendu à la page
const regler = async (page: any, balise: string, appel: string) => {
  await page.evaluate(`(() => { document.querySelector('${balise}').${appel}; return null })()`)
  await page.waitForTimeout(200)
}

// note un écart, sans arrêter le cas : tous les écarts d'un cas sont rendus ensemble
const verifier = (ecarts: string[], quoi: string, lu: unknown, attendu: unknown) => {
  if (lu !== attendu) ecarts.push(`${quoi} : attendu ${JSON.stringify(attendu)}, lu ${JSON.stringify(lu)}`)
}

// la liste de `{success}` répond comme son témoin après chaque geste : le témoin est lu d'abord, faux il arrête le cas
async function suivre(page: any, balise: string, etapes: Array<[string, string | null, string]>, ecarts: string[]) {
  for (const [nom, appel, attendu] of etapes) {
    if (appel) await regler(page, balise, appel)
    assert.equal(await lignes(page, balise, 'hors'), attendu, `le témoin hors de {await} est faux (${nom}) : le test lui-même est à revoir`)
    verifier(ecarts, `liste de {success}, ${nom}`, await lignes(page, balise, 'dans'), attendu)
  }
}

for (const mode of ['dev-parents-avant', 'split', 'bundle'] as const) describe(`liste de {success} qui suit sa propre variable (${mode}, Chromium réel)`, function () {
  this.timeout(120000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright.chromium.executablePath())
    if (!present) { console.log('  ℹ️  chromium non installé, test de la liste de {success} sauté. Activer : `npx playwright install chromium`'); return }
    browser = await playwright.chromium.launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  // ouvre le composant, joue le scénario, puis exige qu'aucune erreur n'ait été dite par la page
  const jouer = async (balise: string, scenario: (page: any) => Promise<void>) => {
    const o = await charger(browser, await cible(mode), balise)
    try {
      await pret(o.page, balise)
      await scenario(o.page)
      assert.deepEqual(graves(o), [], 'aucune erreur')
    } finally {
      await o.fermer()
    }
  }

  it('les composants se compilent', async function () {
    if (!present) { this.skip(); return }
    await cible(mode)
  })

  it('liste remplacée, modifiée en place, filtrée par une autre variable de l\'itérable puis vidée : celle de {success} répond comme son témoin', async function () {
    if (!present) { this.skip(); return }
    const B      = 'mjs-al-cle'
    const ecarts = [] as string[]
    await jouer(B, async (page) => {
      assert.equal(await lignes(page, B, 'dans'), 'absente', 'avant l\'arrivée, la liste de {success} n\'est pas là')
      await regler(page, B, 'finir()')
      await suivre(page, B, [
        ['à l\'arrivée de la promesse',  null,                                                   'a,b'],
        ['liste remplacée',              'poser([{ id: 3, nom: \'c\' }, { id: 1, nom: \'a\' }])', 'c,a'],
        ['ligne ajoutée en place',       'ajouter({ id: 4, nom: \'d\' })',                       'c,a,d'],
        ['filtre posé',                  'filtrer(\'a\')',                                       'a'],
        ['filtre levé',                  'filtrer(\'\')',                                        'c,a,d'],
        ['liste vidée',                  'poser([])',                                            ''],
        ['liste rendue',                 'poser([{ id: 7, nom: \'g\' }])',                        'g']
      ], ecarts)
    })
    assert.deepEqual(ecarts, [])
  })

  it('liste sans clé, branche {success p} : la forme de la consigne suit $liste', async function () {
    if (!present) { this.skip(); return }
    const B      = 'mjs-al-sans-cle'
    const ecarts = [] as string[]
    await jouer(B, async (page) => {
      await regler(page, B, 'finir()')
      await suivre(page, B, [
        ['à l\'arrivée de la promesse', null,                                                            'a,b'],
        ['liste remplacée',             'poser([{ nom: \'x\' }, { nom: \'y\' }, { nom: \'z\' }])',         'x,y,z'],
        ['liste raccourcie',            'poser([{ nom: \'z\' }])',                                       'z'],
        ['liste vidée',                 'poser([])',                                                     '']
      ], ecarts)
    })
    assert.deepEqual(ecarts, [])
  })

  it('branche créée après un changement de la liste : elle porte la liste du moment, puis suit', async function () {
    if (!present) { this.skip(); return }
    const B      = 'mjs-al-cle'
    const ecarts = [] as string[]
    await jouer(B, async (page) => {
      await regler(page, B, 'poser([{ id: 5, nom: \'e\' }])')
      await regler(page, B, 'finir()')
      await suivre(page, B, [
        ['branche créée après le changement', null,                                              'e'],
        ['liste remplacée après la création', 'poser([{ id: 6, nom: \'f\' }, { id: 5, nom: \'e\' }])', 'f,e']
      ], ecarts)
    })
    assert.deepEqual(ecarts, [])
  })

  it('promesse remplacée : la liste change pendant l\'attente sans rien casser, puis la branche rendue porte la liste du moment', async function () {
    if (!present) { this.skip(); return }
    const B      = 'mjs-al-cle'
    const ecarts = [] as string[]
    await jouer(B, async (page) => {
      await regler(page, B, 'finir()')
      await suivre(page, B, [['première arrivée', null, 'a,b']], ecarts)
      await regler(page, B, 'relancer()')
      verifier(ecarts, 'promesse remplacée, liste de {success}', await lignes(page, B, 'dans'), 'absente')
      await regler(page, B, 'poser([{ id: 8, nom: \'h\' }])')
      assert.equal(await lignes(page, B, 'hors'), 'h', 'le témoin hors de {await} est faux : le test lui-même est à revoir')
      verifier(ecarts, 'liste changée pendant l\'attente, liste de {success}', await lignes(page, B, 'dans'), 'absente')
      await regler(page, B, 'finir()')
      await suivre(page, B, [
        ['seconde arrivée',            null,                                                   'h'],
        ['liste remplacée ensuite',    'poser([{ id: 9, nom: \'i\' }, { id: 8, nom: \'h\' }])', 'i,h']
      ], ecarts)
    })
    assert.deepEqual(ecarts, [])
  })

  it('la liste suit sa variable ET celle que lisent ses lignes', async function () {
    if (!present) { this.skip(); return }
    const B      = 'mjs-al-lignes'
    const ecarts = [] as string[]
    await jouer(B, async (page) => {
      await regler(page, B, 'finir()')
      await suivre(page, B, [
        ['à l\'arrivée de la promesse',  null,                                                       'a!'],
        ['liste remplacée',              'poser([{ id: 2, nom: \'b\' }, { id: 1, nom: \'a\' }])',       'b!,a!'],
        ['suffixe changé (lu par les lignes)', 'suffixer(\'?\')',                                    'b?,a?'],
        ['liste remplacée, suffixe gardé',     'poser([{ id: 3, nom: \'c\' }])',                     'c?']
      ], ecarts)
    })
    assert.deepEqual(ecarts, [])
  })

  it('l\'itérable lit la valeur de la branche et $liste : $liste refait la liste, la valeur de la promesse reste', async function () {
    if (!present) { this.skip(); return }
    const B      = 'mjs-al-valeur'
    const ecarts = [] as string[]
    await jouer(B, async (page) => {
      await regler(page, B, 'finir()')
      await suivre(page, B, [
        ['à l\'arrivée de la promesse', null,                                     'z,a'],
        ['liste remplacée',             'poser([{ id: 4, nom: \'d\' }])',          'z,d']
      ], ecarts)
    })
    assert.deepEqual(ecarts, [])
  })
})
