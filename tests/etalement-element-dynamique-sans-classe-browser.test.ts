// `<@element $tag {...$x}>` sans classe écrite, seul étalement de l'appli : quand la balise change, les clés étalées passent sur la balise
// neuve ET leurs relevés la suivent, si bien qu'une clé qui quitte ensuite l'objet quitte aussi la balise neuve. En production, le code de
// la classe étalée est retiré de l'appli (aucune classe écrite ne l'appelle) : le relevé des clés ne doit pas partir avec lui. Navigateurs
// réels (Chromium, Firefox, WebKit), en développement et en production.

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { MOTEURS, moteurPresent } from './helpers/navigateurs-compiles.js'
import { construire, charger, graves, type Cible } from './helpers/liaison-navigateur.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { scanCompiledFeatures, SPREAD_CLASS } from '../src/bundler/features.js'

const BALISE  = 'mjs-et-elem'
const SOURCES: Record<string, string> = {
  'et-elem.mjs': `<script>
$x   = {title: 'e1', 'data-k': 'k1'}
$tag = 'section'
</script>
<@element $tag data-t="elem" {...$x}></@element>
<button class="tag" @click={$tag = 'article'}>g</button>
<button class="retirer" @click={$x = {}}>r</button>
`
}

// la balise `[data-t="elem"]` de l'ombre : son nom, ses attributs `title` et `data-k` (« - » s'il n'y est pas)
const lire = `(() => {
  const h  = document.querySelector('${BALISE}')
  const sh = h && (h._shadow || h.shadowRoot)
  const n  = sh && sh.querySelector('[data-t="elem"]')
  return n ? n.localName + ' ' + (n.getAttribute('title') ?? '-') + ' ' + (n.getAttribute('data-k') ?? '-') : null
})()`

const ETAPES: { clic: string | null, attendu: string }[] = [
  { clic: null, attendu: 'section e1 k1' },
  { clic: '.tag', attendu: 'article e1 k1' },
  { clic: '.retirer', attendu: 'article - -' }
]

describe('<@element $tag {...$x}> sans classe écrite : les relevés de l\'étalement suivent la balise neuve, navigateurs réels, développement et production', function () {
  this.timeout(240000)
  const cibles: Record<string, Cible> = {}

  before(async function () {
    this.timeout(300000)
    cibles['développement'] = await construire('dev-parents-avant', SOURCES, [BALISE])
    cibles['production']    = await construire('bundle', SOURCES, [BALISE])
  })

  after(async () => { await terminateSharedWorkerPool() })

  // le bloc de la classe étalée quitte l'appli de production quand aucune unité ne donne son signal : le code compilé de la carte ne doit
  // pas le donner, sinon ce test ne prouve plus rien
  it('le code compilé de cette appli ne réclame pas la classe étalée (son bloc est retiré en production)', () => {
    const out  = join(cibles['développement'].racine, 'out')
    const code = readdirSync(out).filter((f) => f.endsWith('.js') && !f.startsWith('mjs_') && f !== 'bundle.js').map((f) => readFileSync(join(out, f), 'utf-8')).join('\n')
    assert.ok(/_mjs_spk/.test(code), 'le code compilé de la carte ne relève plus les clés étalées : le témoin ne prouve plus rien')
    assert.ok(!scanCompiledFeatures(code).has(SPREAD_CLASS), 'le code compilé de la carte réclame la classe étalée : son bloc reste en production')
  })

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
        it(`${mode} : une clé qui quitte l'objet après le changement de balise quitte aussi la balise neuve`, async function () {
          const o = await charger(browser, cibles[mode], BALISE)
          try {
            for (const etape of ETAPES) {
              if (etape.clic) await o.page.evaluate(`document.querySelector('${BALISE}')._shadow.querySelector('${etape.clic}').click()`)
              await o.page.waitForFunction(`${lire} === ${JSON.stringify(etape.attendu)}`, null, { timeout: 5000 }).catch(() => {})
              assert.equal(await o.page.evaluate(lire), etape.attendu, `${mode}, ${etape.clic ? 'après le clic ' + etape.clic : 'premier rendu'} ; la page dit : ${[...o.erreurs, ...o.avis].join(' / ')}`)
            }
            assert.deepEqual(graves(o), [])
          }
          finally {
            await o.fermer()
          }
        })
      }
    })
  }
})
