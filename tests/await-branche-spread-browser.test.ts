// `{...expr}` posé sur une balise d'une branche de `{await}` (attente, `{success}`, `{error}`, ou un `{if}` / un `{key}` qui s'y trouve) agit comme à la
// racine : les attributs sont posés à l'affichage de la branche, puis un `{...$attrs}` suit la variable quand elle change. Un étalement de la valeur de la
// branche (`{...v.attrs}` dans `{success v}`, `{...err.attrs}` dans `{error err}`) ne lit rien tant que la branche n'est pas affichée : avant l'arrivée de la
// promesse la valeur n'existe pas encore (`null`), et le composant entier tombait dès son montage. Même garde quand la promesse est remplacée, rejetée ou
// retirée puis qu'une variable change : la branche qui n'est plus affichée garde ses attributs, rien ne se lit, rien ne tombe.
// Un étalement qui lit un `{const}` de la branche suit les variables que ce `{const}` lit, comme `@class` et `@style` : `{const d = $dyn}` puis `{...d}`.
// Chaque cas a son témoin, le même étalement hors de `{await}` : un témoin faux dirait que le test lui-même est faux, il arrête donc le cas aussitôt.
// La promesse est tenue par le test (`finir()`), pour que la branche d'attente existe avant l'arrivée.
// Les trois modes : développement, production en fichiers séparés, production en un seul fichier. Chromium réel.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'

const SOURCES: Record<string, string> = {
  // la valeur de `{success}` étalée sur une balise de la branche ; la même donnée étalée à la racine sert de témoin
  'sp-succes.mjs': `<script>
  $val = { attrs: { 'data-x': 'a', title: 't' }, t: 'texte' }
  fin  = null
  $p   = new Promise((res) -> fin = res)
  @finir = -> fin($val)
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  <div class="ok" {...v.attrs}>{v.t}</div>
{end}
<u class="temoin" {...$val.attrs}>témoin</u>
`,
  // la valeur de `{error}` étalée : la promesse est rejetée par `finir()` avec une erreur qui porte les attributs
  'sp-erreur.mjs': `<script>
  $val = { attrs: { 'data-e': 'x', title: 'raté' } }
  fin  = null
  $p   = new Promise((res, rej) -> fin = rej)
  @finir = -> fin(Object.assign(new Error('non'), { attrs: { 'data-e': 'x', title: 'raté' } }))
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  <b class="ok">{v}</b>
{error err}
  <b class="ko" {...err.attrs}>{err.message}</b>
{end}
<u class="temoin" {...$val.attrs}>témoin</u>
`,
  // une variable étalée dans chaque branche, y compris celle d'attente : elle est suivie tant que la branche est affichée
  'sp-variable.mjs': `<script>
  $attrs = { 'data-a': '1', 'data-b': 'x' }
  fin    = null
  $p     = new Promise((res) -> fin = res)
  @attendre = -> $p = new Promise((res) -> fin = res)
  @finir    = -> fin('ok')
  @regler   = (a) -> $attrs = a
</script>
{await $p}
  <i class="att" {...$attrs}>attente</i>
{success v}
  <div class="ok" {...$attrs}>{v}</div>
{end}
<u class="temoin" {...$attrs}>témoin</u>
`,
  // la valeur de la branche et une variable, sur deux balises : la promesse est remplacée, rejetée (sans branche {error}) ou retirée pendant que la variable bouge
  'sp-perime.mjs': `<script>
  $extra = { 'data-e': 'e0' }
  fin    = null
  $p     = Promise.resolve({ attrs: { 'data-v': 'a' } })
  @attendre = -> $p = new Promise((res, rej) -> fin = [res, rej])
  @finir    = (x) -> fin[0](x)
  @rejeter  = -> $p = Promise.reject(new Error('non'))
  @vider    = -> $p = null
  @regler   = (a) -> $extra = a
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  <b class="ok" {...v.attrs}>{v.attrs['data-v']}</b>
  <s class="ex" {...$extra}>variable</s>
{end}
<u class="temoin" {...$extra}>témoin</u>
`,
  // {success} et {error} étalent chacune leur valeur et une variable : la promesse passe de l'une à l'autre
  'sp-perime-erreur.mjs': `<script>
  $extra = { 'data-e': 'e0' }
  fin    = null
  $p     = Promise.resolve({ attrs: { 'data-v': 'a' } })
  @attendre = -> $p = new Promise((res, rej) -> fin = [res, rej])
  @finir    = (x) -> fin[0](x)
  @refuser  = (m) -> fin[1](Object.assign(new Error(m), { attrs: { 'data-r': m } }))
  @regler   = (a) -> $extra = a
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  <b class="ok" {...v.attrs} {...$extra}>{v.attrs['data-v']}</b>
{error err}
  <b class="ko" {...err.attrs} {...$extra}>{err.message}</b>
{end}
<u class="temoin" {...$extra}>témoin</u>
`,
  // un {if} et un {key} placés dans {success} : ils prennent le contexte de la branche qui les enveloppe
  'sp-imbrique.mjs': `<script>
  $val = { ok: true, attrs: { 'data-x': 'a' } }
  fin  = null
  $p   = new Promise((res) -> fin = res)
  @finir = -> fin($val)
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  {if v.ok}
    <b class="dans-si" {...v.attrs}>si</b>
  {end}
  {key v}
    <b class="dans-key" {...v.attrs}>key</b>
  {end}
{end}
<u class="temoin" {...$val.attrs}>témoin</u>
`,
  // l'étalement lit un `{const}` de la branche qui lit une variable (`d`), ou la valeur de la branche ET la variable (`mixte`) : les attributs suivent la variable
  'sp-const.mjs': `<script>
  $dyn = { 'data-a': '1' }
  fin  = null
  $p   = new Promise((res, rej) -> fin = [res, rej])
  @attendre = -> $p = new Promise((res, rej) -> fin = [res, rej])
  @finir    = (x) -> fin[0](x)
  @refuser  = (m) -> fin[1](new Error(m))
  @regler   = (a) -> $dyn = a
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  {const d = $dyn}
  {const mixte = Object.assign({ 'data-n': v.n }, $dyn)}
  <b class="ok" {...d}>{v.n}</b>
  <s class="mix" {...mixte}>mixte</s>
{error err}
  <b class="ko">{err.message}</b>
{end}
<u class="temoin" {...$dyn}>témoin</u>
`,
  // le même étalement sur un composant enfant : ses props viennent de la valeur de la branche
  'sp-composant.mjs': `<script>
  $props = { nom: 'mjs', ver: '2.4' }
  fin    = null
  $p     = new Promise((res) -> fin = res)
  @finir = -> fin({ props: { nom: 'mjs', ver: '2.4' } })
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  <@c-sp-enfant {...v.props}></@c-sp-enfant>
{end}
<@c-sp-enfant class="hors" {...$props}></@c-sp-enfant>
<u class="temoin">témoin</u>
`,
  'c-sp-enfant.mjs': `<p class="vu">{$nom} {$ver}</p>
`
}
const BALISES = Object.keys(SOURCES).filter((f) => !f.startsWith('c-')).map((f) => 'mjs-' + f.replace('.mjs', ''))

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

// un appel sur le composant (`finir()`, `regler({…})`…), puis le temps de la mise à jour ; la méthode rend parfois une promesse
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

// les attributs d'une balise, en une ligne : `data-x=a title=t` ; `absente` quand elle n'est pas dans la page, `∅` pour un attribut qui manque
const attributs = (page: any, balise: string, sel: string, noms: string[]): Promise<string> => page.evaluate(`(() => {
  const n = document.querySelector('${balise}')._shadow.querySelector('${sel}')
  if (!n) return 'absente'
  return ${JSON.stringify(noms)}.map((a) => a + '=' + (n.hasAttribute(a) ? n.getAttribute(a) : '∅')).join(' ')
})()`)

// garde le nœud d'une balise, pour relire plus tard ce qu'il est devenu une fois sa branche retirée de la page
const garder = (page: any, balise: string, sel: string): Promise<boolean> => page.evaluate(`(() => {
  window.__gardes = window.__gardes || {}
  const n = document.querySelector('${balise}')._shadow.querySelector('${sel}')
  window.__gardes['${sel}'] = n
  return !!n
})()`)

const gardeeLue = (page: any, sel: string, noms: string[]): Promise<string> => page.evaluate(`(() => {
  const n = window.__gardes['${sel}']
  if (!n) return 'absente'
  return ${JSON.stringify(noms)}.map((a) => a + '=' + (n.hasAttribute(a) ? n.getAttribute(a) : '∅')).join(' ')
})()`)

// chaque balise de `balises` après chaque geste, avec le composant vivant à chaque étape :
// [nom de l'étape, appel (ou null), attributs de chaque balise dans l'ordre de `balises`]
async function parcours(page: any, balise: string, balises: Array<[string, string[]]>, etapes: Array<[string, string | null, ...string[]]>, ecarts: string[]) {
  for (const [nom, appel, ...attendus] of etapes) {
    if (appel) await regler(page, balise, appel)
    verifier(ecarts, `composant vivant, ${nom}`, await vivant(page, balise), true)
    for (let i = 0; i < balises.length; i++) verifier(ecarts, `${balises[i][0]}, ${nom}`, await attributs(page, balise, balises[i][0], balises[i][1]), attendus[i])
  }
}

for (const mode of ['dev-parents-avant', 'split', 'bundle'] as const) describe(`{...expr} dans une branche de {await} (${mode}, Chromium réel)`, function () {
  this.timeout(120000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright.chromium.executablePath())
    if (!present) { console.log('  ℹ️  chromium non installé, test des branches de {await} sauté. Activer : `npx playwright install chromium`'); return }
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

  it('{success} : {...v.attrs} ne fait pas tomber le composant au montage, puis pose les attributs de la valeur à l\'arrivée de la promesse', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-sp-succes'
    await jouer(B, async (page, ecarts) => {
      verifier(ecarts, 'composant vivant, à la création', await vivant(page, B), true)
      if (await vivant(page, B)) {
        assert.equal(await attributs(page, B, '.temoin', ['data-x', 'title']), 'data-x=a title=t', 'le témoin hors de {await} est faux : le test lui-même est à revoir')
        verifier(ecarts, 'avant l\'arrivée, la branche {success}', await attributs(page, B, '.ok', ['data-x', 'title']), 'absente')
        verifier(ecarts, 'avant l\'arrivée, la branche d\'attente', await attributs(page, B, '.att', ['data-x']), 'data-x=∅')
      }
      await regler(page, B, 'finir()')
      verifier(ecarts, 'composant vivant, après l\'arrivée', await vivant(page, B), true)
      verifier(ecarts, 'attributs de la branche {success}', await attributs(page, B, '.ok', ['data-x', 'title']), 'data-x=a title=t')
    })
  })

  it('{error} : {...err.attrs} ne fait pas tomber le composant au montage, puis pose les attributs de l\'erreur au rejet de la promesse', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-sp-erreur'
    await jouer(B, async (page, ecarts) => {
      verifier(ecarts, 'composant vivant, à la création', await vivant(page, B), true)
      if (await vivant(page, B)) {
        assert.equal(await attributs(page, B, '.temoin', ['data-e', 'title']), 'data-e=x title=raté', 'le témoin hors de {await} est faux : le test lui-même est à revoir')
        verifier(ecarts, 'avant le rejet, la branche {error}', await attributs(page, B, '.ko', ['data-e']), 'absente')
      }
      await regler(page, B, 'finir()')
      verifier(ecarts, 'composant vivant, après le rejet', await vivant(page, B), true)
      verifier(ecarts, 'attributs de la branche {error}', await attributs(page, B, '.ko', ['data-e', 'title']), 'data-e=x title=raté')
    })
  })

  it('{...$attrs} dans la branche d\'attente et dans {success} : posé à l\'affichage de la branche, puis suit la variable', async function () {
    if (!present) { this.skip(); return }
    const B   = 'mjs-sp-variable'
    const AB  = ['data-a', 'data-b']
    const ent = (a: string, b: string) => `data-a=${a} data-b=${b}`
    await jouer(B, async (page, ecarts) => {
      await parcours(page, B, [['.temoin', AB], ['.att', AB], ['.ok', AB]], [
        ['à la création',               null,                                             ent('1', 'x'), ent('1', 'x'), 'absente'],
        ['attente, $attrs change',      'regler({ \'data-a\': \'2\', \'data-b\': \'y\' })', ent('2', 'y'), ent('2', 'y'), 'absente'],
        ['promesse réglée',             'finir()',                                        ent('2', 'y'), 'absente',     ent('2', 'y')],
        ['{success}, $attrs change',    'regler({ \'data-a\': \'3\', \'data-b\': \'z\' })', ent('3', 'z'), 'absente',     ent('3', 'z')],
        ['promesse remplacée',          'attendre()',                                     ent('3', 'z'), ent('3', 'z'), 'absente'],
        ['nouvelle attente, $attrs',    'regler({ \'data-a\': \'4\', \'data-b\': \'t\' })', ent('4', 't'), ent('4', 't'), 'absente'],
        ['nouvelle promesse réglée',    'finir()',                                        ent('4', 't'), 'absente',     ent('4', 't')]
      ], ecarts)
    })
  })

  it('{success} qui étale sa valeur et une variable : la promesse remplacée, puis la variable qui bouge, ne font pas tomber le composant et ne touchent pas la branche retirée', async function () {
    if (!present) { this.skip(); return }
    const B   = 'mjs-sp-perime'
    const OK  = ['data-v']
    const EX  = ['data-e']
    await jouer(B, async (page, ecarts) => {
      await parcours(page, B, [['.temoin', EX], ['.ok', OK], ['.ex', EX]], [
        ['à la création',              null,                                  'data-e=e0', 'data-v=a', 'data-e=e0']
      ], ecarts)
      await garder(page, B, '.ok')
      await garder(page, B, '.ex')
      await parcours(page, B, [['.temoin', EX], ['.ok', OK], ['.ex', EX]], [
        ['promesse remplacée',         'attendre()',                          'data-e=e0', 'absente',  'absente'],
        ['$extra change, en attente',  'regler({ \'data-e\': \'e1\' })',      'data-e=e1', 'absente',  'absente'],
        ['réglée avec data-v = b',     'finir({ attrs: { \'data-v\': \'b\' } })', 'data-e=e1', 'data-v=b', 'data-e=e1'],
        ['$extra change',              'regler({ \'data-e\': \'e2\' })',      'data-e=e2', 'data-v=b', 'data-e=e2']
      ], ecarts)
      verifier(ecarts, 'balise retirée, intacte après la promesse remplacée puis $extra', await gardeeLue(page, '.ex', EX), 'data-e=e0')
      verifier(ecarts, 'balise retirée, valeur d\'origine', await gardeeLue(page, '.ok', OK), 'data-v=a')
    })
  })

  it('{success} qui étale sa valeur et une variable : la promesse rejetée, sans branche {error}, ne fait pas tomber le composant', async function () {
    if (!present) { this.skip(); return }
    const B   = 'mjs-sp-perime'
    const OK  = ['data-v']
    const EX  = ['data-e']
    await jouer(B, async (page, ecarts) => {
      await garder(page, B, '.ex')
      await parcours(page, B, [['.temoin', EX], ['.ok', OK], ['.ex', EX]], [
        ['promesse rejetée',           'rejeter()',                           'data-e=e0', 'absente',  'absente'],
        ['$extra change après le rejet', 'regler({ \'data-e\': \'e1\' })',    'data-e=e1', 'absente',  'absente'],
        ['nouvelle promesse',          'attendre()',                          'data-e=e1', 'absente',  'absente'],
        ['réglée avec data-v = c',     'finir({ attrs: { \'data-v\': \'c\' } })', 'data-e=e1', 'data-v=c', 'data-e=e1']
      ], ecarts)
      verifier(ecarts, 'balise retirée, intacte après le rejet puis $extra', await gardeeLue(page, '.ex', EX), 'data-e=e0')
    })
  })

  it('{success} qui étale sa valeur et une variable : la promesse retirée, puis la variable qui bouge, ne font pas tomber le composant', async function () {
    if (!present) { this.skip(); return }
    const B   = 'mjs-sp-perime'
    const OK  = ['data-v']
    const EX  = ['data-e']
    await jouer(B, async (page, ecarts) => {
      await garder(page, B, '.ex')
      await parcours(page, B, [['.temoin', EX], ['.ok', OK], ['.ex', EX]], [
        ['promesse retirée',           'vider()',                             'data-e=e0', 'absente',  'absente'],
        ['$extra change, sans promesse', 'regler({ \'data-e\': \'e1\' })',    'data-e=e1', 'absente',  'absente'],
        ['nouvelle promesse',          'attendre()',                          'data-e=e1', 'absente',  'absente'],
        ['réglée avec data-v = d',     'finir({ attrs: { \'data-v\': \'d\' } })', 'data-e=e1', 'data-v=d', 'data-e=e1']
      ], ecarts)
      verifier(ecarts, 'balise retirée, intacte après la promesse retirée puis $extra', await gardeeLue(page, '.ex', EX), 'data-e=e0')
    })
  })

  it('{success} et {error} qui étalent leur valeur et une variable : le passage de l\'une à l\'autre, la variable qui bouge entre les deux, ne font pas tomber le composant', async function () {
    if (!present) { this.skip(); return }
    const B   = 'mjs-sp-perime-erreur'
    const EX  = ['data-e']
    const OK  = ['data-v', 'data-e']
    const KO  = ['data-r', 'data-e']
    await jouer(B, async (page, ecarts) => {
      await parcours(page, B, [['.temoin', EX], ['.ok', OK], ['.ko', KO]], [
        ['à la création',              null,                                  'data-e=e0', 'data-v=a data-e=e0', 'absente'],
        ['promesse remplacée',         'attendre()',                          'data-e=e0', 'absente',            'absente'],
        ['rejetée « non »',            'refuser(\'non\')',                    'data-e=e0', 'absente',            'data-r=non data-e=e0'],
        ['$extra change',              'regler({ \'data-e\': \'e1\' })',      'data-e=e1', 'absente',            'data-r=non data-e=e1'],
        ['promesse remplacée',         'attendre()',                          'data-e=e1', 'absente',            'absente'],
        ['réglée avec data-v = b',     'finir({ attrs: { \'data-v\': \'b\' } })', 'data-e=e1', 'data-v=b data-e=e1', 'absente'],
        ['$extra change',              'regler({ \'data-e\': \'e2\' })',      'data-e=e2', 'data-v=b data-e=e2', 'absente'],
        ['promesse remplacée',         'attendre()',                          'data-e=e2', 'absente',            'absente'],
        ['$extra change, en attente',  'regler({ \'data-e\': \'e3\' })',      'data-e=e3', 'absente',            'absente'],
        ['rejetée « autre »',          'refuser(\'autre\')',                  'data-e=e3', 'absente',            'data-r=autre data-e=e3']
      ], ecarts)
    })
  })

  it('{success} : {...d} où {const d = $dyn} suit la variable, avec la valeur de la branche pour un {const} qui lit les deux', async function () {
    if (!present) { this.skip(); return }
    const B  = 'mjs-sp-const'
    const A  = ['data-a']
    const NA = ['data-n', 'data-a']
    await jouer(B, async (page, ecarts) => {
      await parcours(page, B, [['.temoin', A], ['.ok', A], ['.mix', NA]], [
        ['à la création',              null,                                   'data-a=1', 'absente',  'absente'],
        ['réglée avec n = 7',          'finir({ n: 7 })',                      'data-a=1', 'data-a=1', 'data-n=7 data-a=1'],
        ['$dyn change',                'regler({ \'data-a\': \'2\' })',        'data-a=2', 'data-a=2', 'data-n=7 data-a=2'],
        ['promesse remplacée',         'attendre()',                           'data-a=2', 'absente',  'absente'],
        ['$dyn change, en attente',    'regler({ \'data-a\': \'3\' })',        'data-a=3', 'absente',  'absente'],
        ['réglée avec n = 9',          'finir({ n: 9 })',                      'data-a=3', 'data-a=3', 'data-n=9 data-a=3'],
        ['$dyn change',                'regler({ \'data-a\': \'4\' })',        'data-a=4', 'data-a=4', 'data-n=9 data-a=4'],
        ['promesse remplacée',         'attendre()',                           'data-a=4', 'absente',  'absente'],
        ['rejetée « non »',            'refuser(\'non\')',                     'data-a=4', 'absente',  'absente'],
        ['$dyn change, en erreur',     'regler({ \'data-a\': \'5\' })',        'data-a=5', 'absente',  'absente'],
        ['promesse remplacée',         'attendre()',                           'data-a=5', 'absente',  'absente'],
        ['réglée avec n = 5',          'finir({ n: 5 })',                      'data-a=5', 'data-a=5', 'data-n=5 data-a=5']
      ], ecarts)
    })
  })

  it('{if} et {key} dans {success} : {...v.attrs} posé à l\'affichage de la branche', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-sp-imbrique'
    await jouer(B, async (page, ecarts) => {
      verifier(ecarts, 'composant vivant, à la création', await vivant(page, B), true)
      await regler(page, B, 'finir()')
      verifier(ecarts, 'composant vivant, après l\'arrivée', await vivant(page, B), true)
      verifier(ecarts, '{if}', await attributs(page, B, '.dans-si', ['data-x']), 'data-x=a')
      verifier(ecarts, '{key}', await attributs(page, B, '.dans-key', ['data-x']), 'data-x=a')
    })
  })

  it('{success} : {...v.props} sur un composant enfant pose ses props à l\'arrivée de la promesse, sans faire tomber le parent au montage', async function () {
    if (!present) { this.skip(); return }
    const B   = 'mjs-sp-composant'
    const lu  = (page: any, sel: string): Promise<string> => page.evaluate(`(() => {
      const e = document.querySelector('${B}')._shadow.querySelector('${sel}')
      const v = e && e._shadow && e._shadow.querySelector('.vu')
      return v ? v.textContent : 'absent'
    })()`)
    await jouer(B, async (page, ecarts) => {
      verifier(ecarts, 'composant vivant, à la création', await vivant(page, B), true)
      if (await vivant(page, B)) assert.equal(await lu(page, '.hors'), 'mjs 2.4', 'le composant enfant hors de {await}, témoin, est faux : le test lui-même est à revoir')
      await regler(page, B, 'finir()')
      verifier(ecarts, 'composant vivant, après l\'arrivée', await vivant(page, B), true)
      verifier(ecarts, 'props de l\'enfant dans {success}', await lu(page, 'mjs-c-sp-enfant:not(.hors)'), 'mjs 2.4')
    })
  })
})
