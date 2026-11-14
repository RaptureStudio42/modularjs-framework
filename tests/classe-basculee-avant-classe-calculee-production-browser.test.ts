// Une classe basculée par `@class{…}` sur une balise qui a aussi une classe calculée (`class={…}`) reste au premier rendu, quel que
// soit l'ordre des deux attributs, dans les navigateurs réels (Chromium, Firefox, WebKit), en développement, en développement minifié
// et en production. Défaut garanti absent : le code minifié raccourcit le nom de la garde de chaque bascule, et la première écriture
// de la classe calculée, qui retrouvait les bascules actives par ce nom, ne les retrouvait plus — `<p @class{$on}="vif"
// class={$cls}>` rendait « base » au lieu de « base vif », et la classe ne revenait pas (la bascule garde sa dernière valeur, elle ne
// rejoue pas). Les mises à jour du premier rendu suivent les variables, pas l'ordre d'écriture : la classe écrite avant la bascule
// tombait de même.
// Le `className` EXACT est lu après chaque changement : plusieurs classes dans une bascule, bascule coupée au départ, classe
// calculée qui change ensuite, classe faite d'un texte et d'une valeur (`class="c {$cls}"`), lignes d'un `{for}` (bascule ordinaire, et bascule filtrée sur la ligne choisie), classe posée par
// un étalement (`{...$attrs}`) écrit après la bascule, balise d'un composant (à ombre, et léger par `@lightDom`), où la classe ne se
// pose qu'une fois le composant défini ; contre-cas : la classe calculée écrite avant la bascule.
// Rendu serveur : un jeton de la classe rendue au serveur que l'état ne redit pas tombe toujours à la reprise, la classe basculée
// reste ; le jeton d'une bascule fausse au départ, posé par le serveur, tombe aussi, que la bascule passe avant ou après la classe.

import assert from 'node:assert/strict'
import { MOTEURS, moteurPresent } from './helpers/navigateurs-compiles.js'
import { construire, charger, graves, VARIANTES, type Cible } from './helpers/liaison-navigateur.js'
import { construireMinifie } from './helpers/developpement-minifie.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const BALISE  = 'mjs-cl-ordre'
const SOURCES: Record<string, string> = {
  'cl-ordre.mjs': `<script>
$on = true
$off = false
$cls = 'base'
$sel = 1
$rows = [1, 2]
$attrs = {class: 'base'}
</script>
<p data-t="etale" :class{$on}="vif" {...$attrs}>e</p>
<p data-t="avant" :class{$on}="vif" class={$cls}>a</p>
<p data-t="deux" :class{$on}="un deux" class={$cls}>b</p>
<p data-t="faux" :class{$off}="vif" class={$cls}>c</p>
<p data-t="apres" class={$cls} :class{$on}="vif">d</p>
<p data-t="texte" :class{$on}="vif" class="c {$cls}">t</p>
<ul>{for r in $rows by r}<li data-t="ligne" :class{$on}="vif" class={$cls}><b data-t="choix" :class{r === $sel}="vif" class={$cls}>{r}</b></li>{end}</ul>
<@c-enfant data-t="comp" :class{$on}="vif" class={$cls}></@c-enfant>
<@c-enfant :lightDom data-t="compleger" :class{$on}="vif" class={$cls}></@c-enfant>
<button class="cls" @click={$cls = 'autre'}>c</button>
<button class="on" @click={$on = !$on}>o</button>
<button class="off" @click={$off = !$off}>f</button>
`,
  'c-enfant.mjs': `<script>
$x = 1
</script>
<i>{$x}</i>
`
}

// rendu serveur : le HTML du serveur reçoit un jeton que l'état de la page ne redit pas (`motif` remplacé par `remplace`)
const ATTENTE = `<button class="cls" @click={$cls = 'autre'}>c</button>\n`
const CAS_SSR = [
  { balise: 'mjs-cl-serveur', motif: /class=(["'])(socle vif|vif socle)\1/, remplace: 'class=$1$2 perime$1', reprise: 'socle vif', apresClic: 'autre vif' },
  { balise: 'mjs-cl-serveur-faux', motif: /class=(["'])socle\1/, remplace: 'class=$1socle vif$1', reprise: 'socle', apresClic: 'autre' },
  { balise: 'mjs-cl-serveur-faux-classe-avant', motif: /class=(["'])socle\1/, remplace: 'class=$1socle vif$1', reprise: 'socle', apresClic: 'autre' }
]
const SOURCES_SSR: Record<string, string> = {
  'cl-serveur.mjs': `<script>\n$on = true\n$cls = 'socle'\n</script>\n<p data-t="srv" :class{$on}="vif" class={$cls}>s</p>\n${ATTENTE}`,
  'cl-serveur-faux.mjs': `<script>\n$off = false\n$cls = 'socle'\n</script>\n<p data-t="srv" :class{$off}="vif" class={$cls}>s</p>\n${ATTENTE}`,
  'cl-serveur-faux-classe-avant.mjs': `<script>\n$off = false\n$cls = 'socle'\n</script>\n<p data-t="srv" class={$cls} :class{$off}="vif">s</p>\n${ATTENTE}`
}

// chaque balise `[data-t]` de l'ombre : son className exact, les lignes d'un `{for}` jointes par « | »
const lire = (balise: string) => `(() => {
  const h  = document.querySelector('${balise}')
  const sh = h && (h._shadow || h.shadowRoot)
  if (!sh) return null
  const lu = {}
  for (const n of sh.querySelectorAll('[data-t]')) lu[n.dataset.t] = (n.dataset.t in lu ? lu[n.dataset.t] + '|' : '') + n.className
  return lu
})()`

// attend que la page montre l'état voulu (l'attente cède au bout de cinq secondes, la lecture dit alors ce qui reste)
const attendre = (page: any, balise: string, attendu: Record<string, string>) => page.waitForFunction(`(() => {
  const lu  = ${lire(balise)}
  const att = ${JSON.stringify(attendu)}
  return !!lu && Object.keys(att).every((k) => lu[k] === att[k])
})()`, null, { timeout: 5000 }).catch(() => {})

const cliquer = (page: any, balise: string, sel: string) => page.evaluate(`document.querySelector('${balise}')._shadow.querySelector('${sel}').click()`)

const ETAPES: { clic: string | null, attendu: Record<string, string> }[] = [
  { clic: null, attendu: { etale: 'base vif', avant: 'base vif', deux: 'base un deux', faux: 'base', apres: 'base vif', ligne: 'base vif|base vif', choix: 'base vif|base', texte: 'c base vif', comp: 'base vif', compleger: 'base vif' } },
  { clic: '.cls', attendu: { etale: 'base vif', avant: 'autre vif', deux: 'autre un deux', faux: 'autre', apres: 'autre vif', texte: 'c autre vif', ligne: 'autre vif|autre vif', choix: 'autre vif|autre', comp: 'autre vif', compleger: 'autre vif' } },
  { clic: '.on', attendu: { etale: 'base', avant: 'autre', deux: 'autre', faux: 'autre', apres: 'autre', texte: 'c autre', ligne: 'autre|autre', choix: 'autre vif|autre', comp: 'autre', compleger: 'autre' } },
  { clic: '.off', attendu: { etale: 'base', avant: 'autre', deux: 'autre', faux: 'autre vif', apres: 'autre', texte: 'c autre', ligne: 'autre|autre', choix: 'autre vif|autre', comp: 'autre', compleger: 'autre' } },
  { clic: '.on', attendu: { etale: 'base vif', avant: 'autre vif', deux: 'autre un deux', faux: 'autre vif', apres: 'autre vif', texte: 'c autre vif', ligne: 'autre vif|autre vif', choix: 'autre vif|autre', comp: 'autre vif', compleger: 'autre vif' } }
]

describe('classe basculée et classe calculée sur la même balise, navigateurs réels : le className exact en développement et en production', function () {
  this.timeout(240000)
  const cibles: Record<string, Cible> = {}
  let serveur: Cible | null = null

  before(async function () {
    this.timeout(300000)
    cibles['développement']         = await construire('dev-parents-avant', SOURCES, [BALISE])
    cibles['développement minifié'] = await construireMinifie('classe-ordre-minifie', SOURCES)
    cibles['production']            = await construire('bundle', SOURCES, [BALISE])
    serveur                         = await construire('ssr', SOURCES_SSR, CAS_SSR.map((c) => c.balise))
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const moteur of MOTEURS) {
    describe(moteur, function () {
      let browser: any = null

      before(async function () {
        if (!(await moteurPresent(moteur))) {
          console.log(`  ℹ️  ${moteur} non installé, tests sautés. Activer : \`npx playwright install ${moteur}\``)
          this.skip()
        }
        const playwright: any = await import('playwright')
        browser = await playwright[moteur].launch()
      })

      after(async () => { if (browser) await browser.close() })

      for (const mode of ['développement', 'développement minifié', 'production']) {
        it(`${mode} : la bascule reste au premier rendu et après chaque changement, quel que soit l'ordre, balise de composant comprise`, async function () {
          const o = await charger(browser, cibles[mode], BALISE)
          try {
            for (const etape of ETAPES) {
              if (etape.clic) await cliquer(o.page, BALISE, etape.clic)
              await attendre(o.page, BALISE, etape.attendu)
              assert.deepEqual(await o.page.evaluate(lire(BALISE)), etape.attendu, `${mode}, ${etape.clic ? 'après le clic ' + etape.clic : 'premier rendu'} ; la page dit : ${[...o.erreurs, ...o.avis].join(' / ')}`)
            }
            assert.deepEqual(graves(o), [])
          }
          finally {
            await o.fermer()
          }
        })
      }

      it('rendu serveur : un jeton que l\'état ne redit pas tombe à la reprise (celui d\'une bascule fausse aussi, avant ou après la classe), la classe basculée reste', async function () {
        for (const cas of CAS_SSR) {
          for (const variante of VARIANTES.ssr) {
            const page0  = serveur!.document(cas.balise, variante)
            const perime: Cible = { ...serveur!, document: (b, v) => serveur!.document(b, v).replace(cas.motif, cas.remplace) }
            assert.match(page0, cas.motif, `${cas.balise}, ${variante} : la classe rendue au serveur`)
            assert.notEqual(perime.document(cas.balise, variante), page0, `${cas.balise}, ${variante} : jeton périmé posé dans le HTML du serveur`)
            const o = await charger(browser, perime, cas.balise, variante)
            try {
              await attendre(o.page, cas.balise, { srv: cas.reprise })
              assert.deepEqual(await o.page.evaluate(lire(cas.balise)), { srv: cas.reprise }, `${cas.balise}, ${variante} : reprise du rendu serveur`)
              await cliquer(o.page, cas.balise, '.cls')
              await attendre(o.page, cas.balise, { srv: cas.apresClic })
              assert.deepEqual(await o.page.evaluate(lire(cas.balise)), { srv: cas.apresClic }, `${cas.balise}, ${variante} : la classe calculée change`)
              assert.deepEqual(graves(o), [], `${cas.balise}, ${variante}`)
            }
            finally {
              await o.fermer()
            }
          }
        }
      })
    })
  }
})
