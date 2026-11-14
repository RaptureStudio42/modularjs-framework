// Valeurs dérivées précises qui lisent une PROP, en navigateur réel (Chromium, Firefox, WebKit) : l'enfant reçoit `currencies={$liste}`,
// `allSteps={$etapes}` et `devise={$devise}` de son parent et calcule `$picked = ($currencies or []).find((c) -> c.key is $currency) or null`,
// `$curIdx = Math.max($allSteps.findIndex((st) -> st.key is $step), 0)`, une liste dérivée de `$step` relue par une autre valeur dérivée,
// et `$titre` de la seule prop simple. Pas à pas : le parent REMPLACE ses listes et change la prop simple, puis écrit un champ d'un objet de
// ses listes, puis l'enfant change `$currency` et `$step`. À chaque pas, les valeurs dérivées et l'écran de l'enfant sont ceux d'un calcul
// refait (la règle de l'horloge), en développement comme en production. Les cinq valeurs sont classées précises par le compilateur (un nœud
// du graphe des signaux chacune) ; une valeur qui lit un objet tenu par le parent repasse à l'horloge à son premier calcul, ses sources
// avec elle ; celle qui ne lit que la prop simple reste précise, sur le graphe, et suit le parent.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'

const SOURCES: Record<string, string> = {
  'rs-dp-parent.mjs': `<script>
  $liste  = [{ key: 'eur', label: 'Euro' }, { key: 'usd', label: 'Dollar' }]
  $etapes = [{ key: 'a' }, { key: 'b' }, { key: 'c' }]
  $devise = 'usd'

  @remplacer = ->
    $liste  = [{ key: 'usd', label: 'USD' }, { key: 'eur', label: 'EUR' }]
    $etapes = [{ key: 'c' }, { key: 'a' }, { key: 'b' }]
    $devise = 'eur'

  @ecrireChamp = ->
    $liste[0].label = 'Dollar US'
    $etapes[0].key  = 'b'
</script>

<@c-dp-choix currencies={$liste} allSteps={$etapes} devise={$devise}>
`,
  'c-dp-choix.mjs': `<script>
  $currencies = []
  $allSteps   = []
  $currency   = 'usd'
  $step       = 'b'
  $devise     = ''

  $picked = ($currencies or []).find((c) -> c.key is $currency) or null
  $curIdx = Math.max($allSteps.findIndex((st) -> st.key is $step), 0)
  $suite  = [{ key: 'a' }, ...(if $step is 'b' then [] else [{ key: 'm' }]), { key: 'b' }]
  $rang   = Math.max($suite.findIndex((st) -> st.key is $step), 0)
  $titre  = ['devise', $devise].join(' ')

  @choisir = ->
    $currency = 'eur'
    $step     = 'a'
</script>

<p class="vu">{$picked?.label or '-'}|{$curIdx}|{$rang}|{$titre}</p>
`,
}
const BALISE   = 'mjs-rs-dp-parent'
const DERIVEES = ['picked', 'curIdx', 'suite', 'rang', 'titre']

// chaque pas : son geste, puis ce que valent les dérivées de l'enfant et ce que montre son écran
const PAS: [string, string][] = [
  ['départ', ''],
  ['le parent remplace ses listes', `document.querySelector('${BALISE}').remplacer()`],
  ['le parent écrit un champ d\'un objet de ses listes', `document.querySelector('${BALISE}').ecrireChamp()`],
  ['l\'enfant change $currency et $step', `document.querySelector('${BALISE}')._shadow.querySelector('mjs-c-dp-choix').choisir()`],
]
const ATTENDU = [
  ['départ', 'Dollar / 1 / 1 / devise usd', 'Dollar|1|1|devise usd'],
  ['le parent remplace ses listes', 'USD / 2 / 1 / devise eur', 'USD|2|1|devise eur'],
  ['le parent écrit un champ d\'un objet de ses listes', 'Dollar US / 0 / 1 / devise eur', 'Dollar US|0|1|devise eur'],
  ['l\'enfant change $currency et $step', 'EUR / 1 / 0 / devise eur', 'EUR|1|0|devise eur'],
]

const lire = (page: any): Promise<[string, string]> => page.evaluate(`(() => {
  const e = document.querySelector('${BALISE}')._shadow.querySelector('mjs-c-dp-choix')
  const s = e._state
  return [(s.picked ? s.picked.label : '-') + ' / ' + s.curIdx + ' / ' + s.rang + ' / ' + s.titre, e._shadow.querySelector('.vu').textContent]
})()`)

// les valeurs dérivées de l'enfant qui ont un nœud du graphe des signaux (classées précises), et celles qui sont encore précises
const surLeGraphe = (page: any): Promise<[string[], string[]]> => page.evaluate(`(() => {
  const e = document.querySelector('${BALISE}')._shadow.querySelector('mjs-c-dp-choix')
  const v = (k) => e._mjs_computeds[k] || {}
  return [${JSON.stringify(DERIVEES)}.filter((k) => v(k)._mjs_n), ${JSON.stringify(DERIVEES)}.filter((k) => v(k)._mjs_n && v(k)._mjs_src)]
})()`)

const NAVIGATEURS = ['chromium', 'firefox', 'webkit'] as const
const MODES: Mode[] = ['dev-parents-avant', 'bundle']

const cibles = new Map<Mode, Promise<Cible>>()
const cible  = (mode: Mode) => {
  if (!cibles.has(mode)) cibles.set(mode, construire(mode, SOURCES, [BALISE]))
  return cibles.get(mode)!
}

for (const nav of NAVIGATEURS) for (const mode of MODES) describe(`valeur dérivée précise qui lit une prop : elle suit le parent qui remplace ou écrit la liste (${mode}, ${nav} réel)`, function () {
  this.timeout(180000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[nav].executablePath())
    if (!present) return
    browser = await playwright[nav].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  beforeEach(function () { if (!present) this.skip() })

  it('à chaque pas, les valeurs dérivées et l\'écran de l\'enfant sont ceux d\'un calcul refait', async () => {
    const o = await charger(browser, await cible(mode), BALISE)
    try {
      await o.page.waitForFunction(`!!document.querySelector('${BALISE}')?._shadow?.querySelector('mjs-c-dp-choix')?._shadow?.querySelector('.vu')`, null, { timeout: 10000 })
      const R: string[][] = []
      for (const [nom, geste] of PAS) {
        if (geste) await o.page.evaluate(geste)
        await o.page.waitForTimeout(150)
        R.push([nom, ...await lire(o.page)])
      }
      assert.deepEqual(R, ATTENDU)
      // la production raccourcit les noms internes du composant : le classement se lit en développement
      if (mode !== 'bundle') assert.deepEqual(await surLeGraphe(o.page), [DERIVEES, ['titre']], 'cinq valeurs classées précises ; celles qui lisent un objet tenu par le parent à l\'horloge, la prop simple sur le graphe')
      assert.deepEqual(graves(o), [], 'aucune erreur')
    }
    finally {
      await o.fermer()
    }
  })
})
