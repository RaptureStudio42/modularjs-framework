// Repère des feuilles partagées : une page de recherche rendue par le serveur (`<input value={$q}>`, `q` venu de
// l'adresse par le chargeur), reçue et réveillée dans un vrai navigateur. Une adresse forgée qui répète le
// repère puis porte une balise faisait passer la feuille en `<link>`, dont le guillemet fermait l'attribut :
// la balise de l'adresse devenait un élément et son script jouait chez le visiteur.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp, sweepRegistered } from './helpers/tmp.js'
import { startRenderServer } from '../src/server/render-server.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const CHARGEUR = `export default {
  props: {
    '/recherche': (params, req) -> { q: decodeURIComponent(String(req.url).split('q=')[1] or '') }
  }
}
`

const PAGE = `<script>
  $q = ''
  $n = 0
</script>

<input class="champ" value={$q}>
<p class="r">Résultats pour {$q}</p>
<button class="b" @click={$n++}>{$n}</button>
`

describe('recherche rendue par le serveur : une adresse forgée ne fait jouer aucun script chez le visiteur', function () {
  this.timeout(180000)
  let running: any
  before(async function () {
    const root = mjsTmp('repere-feuilles-forge')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'recherche.mjs'), PAGE)
    writeFileSync(join(root, 'serve.server.mjs'), CHARGEUR)
    const config = { sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', render: { routes: { '/recherche': { component: 'mjs-recherche', mode: 'ssr' } } } }
    running = await startRenderServer(config as any, root, { port: 0, host: '127.0.0.1' })
  })
  after(async () => {
    await running?.close()
    await terminateSharedWorkerPool()
    sweepRegistered()
  })

  for (const moteur of ['chromium', 'firefox'] as const) {
    describe(moteur, function () {
      let browser: any
      before(async function () {
        const playwright = await import('playwright')
        browser = await playwright[moteur].launch({ headless: true })
      })
      after(async () => { await browser?.close() })

      async function visiter(q: string) {
        const page              = await browser.newPage()
        const erreurs: string[] = []
        page.on('pageerror', (e: any) => erreurs.push(String(e?.message || e)))
        const rep = await page.goto(`http://127.0.0.1:${running.port}/recherche?q=${encodeURIComponent(q)}`)
        await page.waitForFunction(() => !!customElements.get('mjs-recherche'), undefined, { timeout: 20000 }).catch(() => {})
        await page.waitForTimeout(300)
        const clic = await page.evaluate(() => {
          const ombre: any  = document.querySelector('mjs-recherche')?.shadowRoot
          const bouton: any = ombre && ombre.querySelector('.b')
          if (!bouton) return null
          bouton.click()
          return new Promise(r => setTimeout(() => r(ombre.querySelector('.b').textContent), 100))
        })
        const etat = await page.evaluate(() => {
          const ombre: any = document.querySelector('mjs-recherche')?.shadowRoot
          return {
            xss:            (window as any).__xss ?? null,
            imagesDocument: document.querySelectorAll('img').length,
            imagesOmbre:    ombre ? ombre.querySelectorAll('img').length : -1,
            champ:          ombre && ombre.querySelector('.champ') ? ombre.querySelector('.champ').value : null,
            defini:         !!customElements.get('mjs-recherche'),
          }
        })
        await page.close()
        return { statut: rep.status(), erreurs, etat, clic }
      }

      it('témoin : la page servie se réveille (clic compté, aucune erreur de page)', async () => {
        const v = await visiter('chaussures')
        assert.equal(v.statut, 200)
        assert.equal(v.etat.defini, true, 'le composant ne se réveille pas')
        assert.equal(v.clic, '1', 'le clic n\'est pas compté')
        assert.equal(v.etat.champ, 'chaussures')
        assert.deepEqual(v.erreurs, [])
      })

      it('adresse forgée (repère des feuilles répété, puis une balise) : aucun script ne s\'exécute, aucune balise venue de l\'adresse', async () => {
        const v = await visiter('\u0000mjsf0\u0000'.repeat(20) + '<img src=x onerror=window.__xss=1>')
        assert.equal(v.statut, 200)
        assert.equal(v.etat.xss, null, 'le script porté par l\'adresse s\'est exécuté dans la page du visiteur : ' + JSON.stringify(v.etat))
        assert.equal(v.etat.imagesOmbre + v.etat.imagesDocument, 0, 'une balise <img> venue de l\'adresse est dans la page : ' + JSON.stringify(v.etat))
      })
    })
  }
})
