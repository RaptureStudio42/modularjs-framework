// `<@element $tag>` garde SA balise : un composant léger (`:lightDom`) placé avant lui rend son contenu dans la même ombre, avec ses propres
// repères `<@element>` numérotés depuis zéro, comme ceux du parent ; la recherche du repère du parent ne prend jamais celui de l'enfant. Et
// un `{if}` refermé puis rouvert repose la balise voulue sur le repère neuf de sa branche, sans attendre que `$tag` change. Navigateurs réels
// (Chromium, Firefox, WebKit), en développement et en production.

import assert from 'node:assert/strict'
import { MOTEURS, moteurPresent } from './helpers/navigateurs-compiles.js'
import { construire, charger, graves, type Cible } from './helpers/liaison-navigateur.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const SOURCES: Record<string, string> = {
  // l'enfant léger : sa balise reste un `div`, son repère garde donc `mjs-el="0"`
  'leger-el.mjs': `<script>
$t = 'div'
</script>
<@element $t data-t="enfant">e</@element>
`,
  // le parent pose sa balise après le premier rendu de l'enfant
  'apres-leger.mjs': `<script>
$tag = null
</script>
<@leger-el :lightDom/>
<@element $tag data-t="parent">p</@element>
<button class="montrer" @click={$tag = 'section'}>m</button>
`,
  // la branche refermée puis rouverte, sans enfant léger
  'branche-el.mjs': `<script>
$tag = 'section'
$ok  = true
</script>
{if $ok}<@element $tag data-t="parent">b</@element>{end}
<button class="basculer" @click={$ok = !$ok}>b</button>
<button class="changer" @click={$tag = 'article'}>c</button>
`,
  // les deux : l'enfant léger avant la branche rouverte
  'leger-branche.mjs': `<script>
$tag = 'section'
$ok  = true
</script>
<@leger-el :lightDom/>
{if $ok}<@element $tag data-t="parent">b</@element>{end}
<button class="basculer" @click={$ok = !$ok}>b</button>
<button class="changer" @click={$tag = 'article'}>c</button>
`
}

// la balise de l'enfant et celle du parent dans l'ombre de l'hôte (« - » : absente ; « /masqué » : masquée par la garde)
const lire = (hote: string) => `(() => {
  const h  = document.querySelector('${hote}')
  const sh = h && (h._shadow || h.shadowRoot)
  if (!sh) return null
  const dire = (n) => n ? n.localName + (n.style.display === 'none' ? '/masqué' : '') : '-'
  return 'enfant=' + dire(sh.querySelector('[data-t="enfant"]')) + ' parent=' + dire(sh.querySelector('[data-t="parent"]'))
})()`

type Scene = { hote: string, etapes: { clic: string | null, attendu: string }[] }

const SCENES: Record<string, Scene> = {
  'enfant léger avant le parent': {
    hote: 'mjs-apres-leger',
    etapes: [
      { clic: null, attendu: 'enfant=div parent=div/masqué' },
      { clic: '.montrer', attendu: 'enfant=div parent=section' }
    ]
  },
  'branche refermée puis rouverte': {
    hote: 'mjs-branche-el',
    etapes: [
      { clic: null, attendu: 'enfant=- parent=section' },
      { clic: '.basculer', attendu: 'enfant=- parent=-' },
      { clic: '.basculer', attendu: 'enfant=- parent=section' },
      { clic: '.changer', attendu: 'enfant=- parent=article' },
      { clic: '.basculer', attendu: 'enfant=- parent=-' },
      { clic: '.basculer', attendu: 'enfant=- parent=article' }
    ]
  },
  'enfant léger avant la branche rouverte': {
    hote: 'mjs-leger-branche',
    etapes: [
      { clic: null, attendu: 'enfant=div parent=section' },
      { clic: '.basculer', attendu: 'enfant=div parent=-' },
      { clic: '.basculer', attendu: 'enfant=div parent=section' },
      { clic: '.changer', attendu: 'enfant=div parent=article' }
    ]
  }
}

describe('<@element $tag> : le repère du parent après un enfant léger, la balise reposée quand son {if} se rouvre, navigateurs réels, développement et production', function () {
  this.timeout(240000)
  const cibles: Record<string, Cible> = {}
  const hotes = Object.values(SCENES).map((s) => s.hote)

  before(async function () {
    this.timeout(300000)
    cibles['développement'] = await construire('dev-enfants-avant', SOURCES, hotes)
    cibles['production']    = await construire('bundle', SOURCES, hotes)
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

      for (const mode of ['développement', 'production']) {
        for (const [nom, scene] of Object.entries(SCENES)) {
          it(`${mode}, ${nom}`, async function () {
            const o = await charger(browser, cibles[mode], scene.hote)
            try {
              for (const etape of scene.etapes) {
                if (etape.clic) await o.page.evaluate(`document.querySelector('${scene.hote}')._shadow.querySelector('${etape.clic}').click()`)
                await o.page.waitForFunction(`${lire(scene.hote)} === ${JSON.stringify(etape.attendu)}`, null, { timeout: 3000 }).catch(() => {})
                assert.equal(await o.page.evaluate(lire(scene.hote)), etape.attendu, `${mode}, ${etape.clic ? 'après le clic ' + etape.clic : 'premier rendu'} ; la page dit : ${[...o.erreurs, ...o.avis].join(' / ')}`)
              }
              assert.deepEqual(graves(o), [])
            }
            finally {
              await o.fermer()
            }
          })
        }
      }
    })
  }
})
