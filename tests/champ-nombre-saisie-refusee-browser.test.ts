// Un champ nombre lié (`<input type="number" value=!{$n}>`) se comporte comme un champ natif : une saisie que
// le navigateur refuse (`validity.badInput` : « - », « 1e », « 1,5 » dans Firefox) reste dans le champ quand on
// le quitte, la validation native bloque l'envoi, et le modèle n'est jamais écrit par cette saisie. Seule une
// écriture du code (la même valeur ou une autre) remplace la saisie refusée.
// Vu avec une vraie frappe, dans Chromium et Firefox, en français et en anglais.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function navigateurPresent(nom: 'chromium' | 'firefox'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const SOURCE = `<script>
  $e = 3
</script>
<form class="f"><input class="e" aria-label="e" type="number" step="any" value=!{$e}></form>
<input class="x" aria-label="x" type="text">
<button class="pareil" @click={$e = 3}>pareil</button>
<button class="autre" @click={$e = 9}>autre</button>
<p class="mod"><b class="e">{$e}</b></p>
`

for (const nom of ['chromium', 'firefox'] as const) {
  for (const locale of ['fr-FR', 'en-US']) {
    describe(`champ nombre lié, saisie refusée (${nom}, ${locale})`, function () {
      this.timeout(120000)
      let present = false
      let script  = ''

      before(async function () {
        present = await navigateurPresent(nom)
        if (!present) {
          console.log(`  ℹ️  ${nom} non installé, test du champ nombre sauté. Activer : \`npx playwright install ${nom}\``)
          return
        }
        const root   = mjsTmp('champ-nombre-refus-' + nom)
        const srcDir = join(root, 'src')
        const outDir = join(root, 'out')
        mkdirSync(srcDir, { recursive: true })
        writeFileSync(join(srcDir, 'cs-page.mjs'), SOURCE)
        const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
        const stats   = await bundler.compile()
        await bundler.close()
        assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
        const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
        const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
        script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
      })

      after(async () => { await terminateSharedWorkerPool() })

      async function essai(fn: (page: any) => Promise<void>) {
        const lanceur = (await import('playwright'))[nom]
        const browser = await lanceur.launch()
        try {
          const page = await (await browser.newContext({ locale })).newPage()
          const erreurs: string[] = []
          page.on('pageerror', (e: any) => erreurs.push(String(e)))
          await page.route('http://t.test/**', (route: any) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body><mjs-cs-page></mjs-cs-page><script>${script}</script></body></html>` }))
          await page.goto('http://t.test/', { waitUntil: 'load' })
          await page.waitForFunction(() => !!(document.querySelector('mjs-cs-page') as any)?._shadow?.querySelector('input.e'))
          await page.waitForTimeout(100)
          await fn(page)
          assert.deepEqual(erreurs, [], 'aucune erreur de page')
        } finally {
          await browser.close()
        }
      }

      const etat = (page: any) => page.evaluate(() => {
        const r  = (document.querySelector('mjs-cs-page') as any)._shadow
        const el = r.querySelector('input.e')
        return { value: el.value as string, mauvais: !!el.validity.badInput, modele: r.querySelector('b.e').textContent as string, valide: !!r.querySelector('form.f').checkValidity() }
      })
      const clic = (page: any, classe: string) => page.evaluate((c: string) => ((document.querySelector('mjs-cs-page') as any)._shadow.querySelector('button.' + c) as HTMLElement).click(), classe)
      async function saisir(page: any, texte: string) {
        await page.evaluate(() => (document.querySelector('mjs-cs-page') as any)._shadow.querySelector('input.e').focus())
        await page.keyboard.press('Control+A')
        await page.keyboard.type(texte, { delay: 30 })
        await page.waitForTimeout(60)
      }
      async function quitter(page: any) {
        await page.keyboard.press('Tab')
        await page.waitForTimeout(100)
      }

      // « 1,5 » n'est refusé que par certains navigateurs : on ne teste la garde que si le champ le refuse
      for (const texte of ['1,5', '-', '1e']) {
        it(`« ${texte} » refusé : reste dans le champ à la sortie, la validation bloque, le modèle ne bouge pas`, async function () {
          if (!present) { this.skip(); return }
          await essai(async (page) => {
            await saisir(page, texte)
            const avant = await etat(page)
            if (!avant.mauvais) return
            await quitter(page)
            const apres = await etat(page)
            assert.equal(apres.mauvais, true, 'la saisie refusée reste dans le champ à la sortie')
            assert.equal(apres.valide, false, 'le formulaire reste invalide : l\'envoi est bloqué')
            assert.equal(apres.modele, avant.modele, 'le modèle garde ce que la frappe valide lui a donné (« 1 » avant la virgule), la sortie n\'y écrit rien')
          })
        })

        it(`« ${texte} » refusé : une écriture du code (une autre valeur) le remplace`, async function () {
          if (!present) { this.skip(); return }
          await essai(async (page) => {
            await saisir(page, texte)
            if (!(await etat(page)).mauvais) return
            await quitter(page)
            await clic(page, 'autre')
            await page.waitForTimeout(80)
            const apres = await etat(page)
            assert.deepEqual({ value: apres.value, mauvais: apres.mauvais, modele: apres.modele }, { value: '9', mauvais: false, modele: '9' }, 'la valeur du code remplace la saisie refusée')
          })
        })
      }

      it('« - » refusé : le code qui réécrit la même valeur ne relance pas la liaison (rien n\'a changé), le champ garde la saisie', async function () {
        if (!present) { this.skip(); return }
        await essai(async (page) => {
          await saisir(page, '-')
          assert.equal((await etat(page)).mauvais, true, 'après « - »')
          await clic(page, 'pareil')
          await page.waitForTimeout(80)
          await quitter(page)
          const apres = await etat(page)
          assert.deepEqual({ mauvais: apres.mauvais, modele: apres.modele }, { mauvais: true, modele: '3' }, 'comme un champ natif : la saisie refusée reste, le modèle n\'a pas bougé')
        })
      })
    })
  }
}
