// `{for}` imbriqués sur cinq niveaux : la balise neuve d'un `<@element $tag>` (quand `$tag` change) et la copie d'un `*marquee` portent
// le rang de leur ligne à chaque niveau, et le gestionnaire posé dessus agit sur sa propre ligne, au cinquième niveau comme au premier.
// Sans les rangs des niveaux profonds, un clic sur la seconde ligne du cinquième niveau agissait sur la première. Navigateurs réels
// (Chromium, Firefox, WebKit), en développement et en production (noms raccourcis)
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'

const DONNEES = "[{ id: 1, b: [{ id: 2, c: [{ id: 3, d: [{ id: 4, f: [{ id: 5 }, { id: 6 }] }] }] }] }, { id: 7, b: [{ id: 8, c: [{ id: 9, d: [{ id: 10, f: [{ id: 11 }, { id: 12 }] }] }] }] }]"
const CHOIX   = "$sel = a.id + '-' + b.id + '-' + c.id + '-' + d.id + '-' + f.id"

const SOURCES: Record<string, string> = {
  'cinq-el.mjs': `<script>
$tag = 'section'
$sel = ''
$a   = ${DONNEES}
</script>
{for a in $a}{for b in a.b}{for c in b.c}{for d in c.d}{for f in d.f}<@element $tag class="l" data-k={f.id} role="button" tabindex="0" @click={${CHOIX}}>{f.id}</@element>{end}{end}{end}{end}{end}
<p class="vu">{$sel}</p>
<button class="changer" @click={$tag = 'article'}>c</button>
`,
  'cinq-mq.mjs': `<script>
$sel = ''
$a   = ${DONNEES}
</script>
<div class="bande" *marquee(speed: 900s)>{for a in $a}{for b in a.b}{for c in b.c}{for d in c.d}{for f in d.f}<button class="l" data-k={f.id} @click={${CHOIX}}>{f.id}</button>{end}{end}{end}{end}{end}</div>
<p class="vu">{$sel}</p>
`
}

// le texte de `.vu` après un clic sur la ligne `k` : dans l'ombre (balise neuve d'un `<@element>`), ou dans une copie du défilé
const CLIQUER = (hote: string, k: number, copie: boolean) => `(() => {
  const sh = document.querySelector('${hote}')._shadow
  const n  = sh.querySelector('${copie ? '[mjs-fx-marquee-copy] ' : ''}[data-k="${k}"]')
  if (!n) return 'absent'
  n.click()
  return 'ok'
})()`
const VU = (hote: string) => `document.querySelector('${hote}')._shadow.querySelector('.vu').textContent`

const NAVIGATEURS = (process.env.NAVIGATEUR ? [process.env.NAVIGATEUR] : ['chromium', 'firefox', 'webkit']) as Array<'chromium' | 'firefox' | 'webkit'>
const MODES: Mode[] = ['dev-parents-avant', 'bundle']
const HOTES = ['mjs-cinq-el', 'mjs-cinq-mq']
const cibles = new Map<Mode, Promise<Cible>>()
const cible  = (mode: Mode) => {
  if (!cibles.has(mode)) cibles.set(mode, construire(mode, SOURCES, HOTES))
  return cibles.get(mode)!
}

// clique la ligne `k` et rend ce que montre `.vu` (le choix de la ligne), ou ce qui a manqué
async function choisir(page: any, hote: string, k: number, copie = false): Promise<string> {
  await page.waitForFunction(`!!document.querySelector('${hote}')?._shadow?.querySelector('${copie ? '[mjs-fx-marquee-copy] ' : ''}[data-k="${k}"]')`, null, { timeout: 5000 }).catch(() => {})
  const r = await page.evaluate(CLIQUER(hote, k, copie))
  if (r !== 'ok') return r
  await page.waitForTimeout(100)
  return page.evaluate(VU(hote))
}

for (const nav of NAVIGATEURS) describe(`{for} imbriqués sur cinq niveaux : la balise neuve et la copie gardent le rang de chaque niveau (${nav} réel)`, function () {
  this.timeout(180000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[nav].executablePath())
    if (!present) { console.log(`  ℹ️  ${nav} non installé, test sauté. Activer : \`npx playwright install ${nav}\``); return }
    browser = await playwright[nav].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const mode of MODES) {
    it(`<@element $tag> au cinquième niveau (${mode}) : après le changement de balise, chaque ligne reçoit son clic`, async function () {
      if (!present) { this.skip(); return }
      const o = await charger(browser, await cible(mode), 'mjs-cinq-el')
      try {
        const vus = [await choisir(o.page, 'mjs-cinq-el', 6)]
        await o.page.evaluate(`document.querySelector('mjs-cinq-el')._shadow.querySelector('.changer').click()`)
        await o.page.waitForFunction(`document.querySelector('mjs-cinq-el')._shadow.querySelectorAll('article.l').length === 4`, null, { timeout: 3000 }).catch(() => {})
        vus.push(await o.page.evaluate(`Array.from(document.querySelector('mjs-cinq-el')._shadow.querySelectorAll('.l')).map((n) => n.localName).join(',')`))
        for (const k of [6, 5, 12, 11]) vus.push(await choisir(o.page, 'mjs-cinq-el', k))
        assert.deepEqual(vus, ['1-2-3-4-6', 'article,article,article,article', '1-2-3-4-6', '1-2-3-4-5', '7-8-9-10-12', '7-8-9-10-11'], 'le choix de chaque ligne, avant puis après le changement de balise')
        assert.deepEqual(graves(o), [], 'aucune erreur')
      } finally {
        await o.fermer()
      }
    })

    it(`*marquee autour de cinq niveaux (${mode}) : un clic dans une copie agit sur la ligne copiée`, async function () {
      if (!present) { this.skip(); return }
      const o = await charger(browser, await cible(mode), 'mjs-cinq-mq')
      try {
        const vus: string[] = []
        for (const k of [6, 5, 12, 11]) vus.push(await choisir(o.page, 'mjs-cinq-mq', k, true))
        assert.deepEqual(vus, ['1-2-3-4-6', '1-2-3-4-5', '7-8-9-10-12', '7-8-9-10-11'], 'le choix de chaque ligne copiée')
        assert.deepEqual(graves(o), [], 'aucune erreur')
      } finally {
        await o.fermer()
      }
    })
  }
})
