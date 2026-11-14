// `<@element $tag>` dans un bloc qui RECRÉE son contenu : un `{key}` dont la clé change, un `{await}` qui repasse par l'attente puis le
// succès, une ligne de `{for}` retirée puis remise. Le repère neuf prend la balise voulue tout
// de suite, sans attendre que `$tag` change. Navigateurs réels (Chromium, Firefox, WebKit), en développement et en production.

import assert from 'node:assert/strict'
import { MOTEURS, moteurPresent } from './helpers/navigateurs-compiles.js'
import { construire, charger, graves, type Cible } from './helpers/liaison-navigateur.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const SOURCES: Record<string, string> = {
  'cle-el.mjs': `<script>
$tag = 'section'
$k   = 1
</script>
{key $k}<@element $tag data-t="el">k</@element>{end}
<button class="refaire" @click={$k++}>r</button>
<button class="changer" @click={$tag = 'article'}>c</button>
`,
  'attente-el.mjs': `<script>
$tag = 'section'
$p   = Promise.resolve(1)
</script>
{await $p}<i>…</i>{success v}<@element $tag data-t="el">{v}</@element>{end}
<button class="refaire" @click={$p = Promise.resolve(2)}>r</button>
<button class="changer" @click={$tag = 'article'}>c</button>
`,
  'ligne-el.mjs': `<script>
$tag   = 'section'
$items = [1]
</script>
{for x in $items}<@element $tag data-t="el">{x}</@element>{end}
<button class="refaire" @click={$items = if $items.length then [] else [1]}>r</button>
<button class="changer" @click={$tag = 'article'}>c</button>
`
}

// les balises des repères `<@element>` de l'ombre de l'hôte, dans l'ordre (« - » : aucune ; « /masqué » : masquée par la garde)
const lire = (hote: string) => `(() => {
  const h  = document.querySelector('${hote}')
  const sh = h && (h._shadow || h.shadowRoot)
  if (!sh) return null
  const l = Array.from(sh.querySelectorAll('[data-t="el"]')).map((n) => n.localName + (n.style.display === 'none' ? '/masqué' : ''))
  return l.length ? l.join(',') : '-'
})()`

type Scene = { hote: string, etapes: { clic: string | null, attendu: string }[] }

const SCENES: Record<string, Scene> = {
  '{key} dont la clé change': {
    hote: 'mjs-cle-el',
    etapes: [
      { clic: null, attendu: 'section' },
      { clic: '.refaire', attendu: 'section' },
      { clic: '.changer', attendu: 'article' },
      { clic: '.refaire', attendu: 'article' }
    ]
  },
  '{await} relancé': {
    hote: 'mjs-attente-el',
    etapes: [
      { clic: null, attendu: 'section' },
      { clic: '.refaire', attendu: 'section' },
      { clic: '.changer', attendu: 'article' },
      { clic: '.refaire', attendu: 'article' }
    ]
  },
  'ligne de {for} retirée puis remise': {
    hote: 'mjs-ligne-el',
    etapes: [
      { clic: null, attendu: 'section' },
      { clic: '.refaire', attendu: '-' },
      { clic: '.refaire', attendu: 'section' },
      { clic: '.changer', attendu: 'article' },
      { clic: '.refaire', attendu: '-' },
      { clic: '.refaire', attendu: 'article' }
    ]
  }
}

describe('<@element $tag> dans un {key}, un {await} ou une ligne de {for} recréés : la balise voulue tout de suite, navigateurs réels, développement et production', function () {
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
