// une valeur dérivée qui attend, vue à l'écran dans de vrais navigateurs (Chromium, Firefox), en développement et en production
// (`bundle`, `split`) : l'enfant demande avec sa prop (jamais `fiche-undefined`) ; `{$resultats.length}` lu avant la réponse ne tue
// pas le composant (en développement un message dit quoi écrire, en production rien) et l'écran se fait à la réponse ; une erreur
// laisse la valeur d'avant et se lit par `µfailed($resultats)`. Les requêtes sont tenues par le test (`page.route`)

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'

const PORTE = `<script>
  $id        = 1
  $q         = ''
  rechercher = (q, signal) -> fetch("/api/s?q=r-#{q}", { signal }).then((r) -> if r.ok then r.json() else throw new Error('statut ' + r.status))
  $resultats = await rechercher($q, µsignal)
  @chercher  = (q) -> $q = q
  double     = (v) -> v * 2
  $vu        = ''
  µeffect ->
    {length} = $resultats
    $vu = [...$resultats].length + ':' + (v for v in $resultats.map(double)).length + ':' + (v for v in $resultats).length + ':' + (if length then 'oui' else 'non')
</script>
<u class="vu">{$vu}</u><i class="n">{$resultats.length}</i><b class="err">{µfailed($resultats)?.message}</b>
<@c-fiche id={$id}></@c-fiche>
`
const FICHE = `<script>
  charger = (id, signal) -> fetch("/api/s?q=fiche-#{id}", { signal }).then((r) -> r.json())
  $fiche  = await charger($id, µsignal)
</script>
<i class="f">{$fiche and $fiche.nom}</i>
`
const B     = 'mjs-porte'
const LIRE  = `(() => { const e = document.querySelector('${B}'); const s = e && e._shadow; if (!s) return '∅'; const f = s.querySelector('mjs-c-fiche'); return [s.querySelector('.mjs-fatal-error') ? 'FATAL' : '', s.querySelector('.n')?.textContent, s.querySelector('.err')?.textContent, f && f._shadow ? f._shadow.querySelector('.f')?.textContent : '∅', s.querySelector('.vu')?.textContent].map((x) => (x ?? '∅').trim()).join('|') })()`

for (const nav of ['chromium', 'firefox', 'webkit'] as const) {
  describe('dérivée qui attend à l\'écran — props, lecture trop tôt, erreur (' + nav + ')', function () {
    this.timeout(180000)
    let browser: any = null

    before(async function () {
      const playwright = await import('playwright')
      if (!existsSync(playwright[nav].executablePath())) { console.log('  ℹ️  ' + nav + ' non installé, test sauté'); return }
      browser = await playwright[nav].launch()
    })

    after(async () => {
      if (browser) await browser.close()
      await terminateSharedWorkerPool()
    })

    for (const mode of ['dev-parents-avant', 'bundle', 'split'] as const) {
      it(mode, async function () {
        if (!browser) { this.skip(); return }
        const o = await charger(browser, await construire(mode, { 'porte.mjs': PORTE, 'c-fiche.mjs': FICHE }, [B]), B)
        try {
          const p = o.page
          const vues: string[] = []
          const tenues: Record<string, any> = {}
          await p.route('**/api/s**', (route: any) => { const q = new URL(route.request().url()).searchParams.get('q') ?? ''; vues.push(q); tenues[q] = route })
          o.erreurs.length = 0
          o.avis.length = 0
          await p.reload({ waitUntil: 'load' })
          await p.waitForTimeout(600)
          assert.ok(!vues.includes('fiche-undefined'), 'jamais « fiche-undefined » — ' + vues.join(','))
          // la page peut monter ses composants deux fois au démarrage (vu en `split`, en `bundle`, et dans Firefox machine chargée), la
          // première demande de chacun coupée : défaut à part, connu aussi sans valeur qui attend ; une ou deux demandes chacun, jamais plus
          const fois = (q: string) => vues.filter((v) => v === q).length
          assert.ok(fois('fiche-1') >= 1 && fois('fiche-1') <= 2, 'l\'enfant demande avec sa prop — ' + vues.join(','))
          assert.ok(fois('r-') >= 1 && fois('r-') <= 2, 'le parent demande — ' + vues.join(','))
          assert.equal(await p.evaluate(LIRE), '||||0:0:0:non', 'le composant vit pendant l\'attente, décomposition, boucles et étalement lus vides')
          await tenues['r-'].fulfill({ contentType: 'application/json', body: JSON.stringify([{ id: 1 }, { id: 2 }]) })
          await tenues['fiche-1'].fulfill({ contentType: 'application/json', body: JSON.stringify({ nom: 'Un' }) })
          await p.waitForFunction(LIRE + " === '|2||Un|2:2:2:oui'", null, { timeout: 5000 }).catch(() => {})
          assert.equal(await p.evaluate(LIRE), '|2||Un|2:2:2:oui', 'les réponses arrivées, l\'écran se fait')
          await p.evaluate(`document.querySelector('${B}').chercher('x')`)
          await p.waitForTimeout(200)
          await tenues['r-x'].fulfill({ status: 500, contentType: 'application/json', body: '"panne"' })
          await p.waitForFunction(LIRE + " === '|2|statut 500|Un|2:2:2:oui'", null, { timeout: 5000 }).catch(() => {})
          assert.equal(await p.evaluate(LIRE), '|2|statut 500|Un|2:2:2:oui', 'l\'erreur se lit, la valeur d\'avant reste')
          // l'aide coupe les textes de la console à 200 caractères : le début du message suffit
          const dit = o.avis.filter((a) => /lit \$resultats avant sa première réponse/.test(a))
          if (mode === 'dev-parents-avant') assert.ok(dit.length >= 1, 'en développement, un message dit quoi écrire — ' + o.avis.join(' | '))
          else assert.equal(dit.length, 0, 'en production, aucun message — ' + o.avis.join(' | '))
          // WebKit dit « due to access control checks » d'une demande coupée par son signal (montage double au démarrage) : pas une erreur
          assert.deepEqual(graves(o).filter((g: string) => !/due to access control checks/.test(g)), [], 'aucune erreur')
        } finally {
          await o.fermer()
        }
      })
    }
  })
}
