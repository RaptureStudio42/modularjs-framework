// Un champ nombre lié (`<input type="number" value=!{$e}>`) dont la saisie est refusée par le navigateur
// (`validity.badInput` : « - », « 1e », « 3,5 » dans Firefox) a `value === ''` : la variable garde son ancienne
// valeur et le champ affiche pourtant la saisie. Le code remplace cette saisie refusée, MÊME en réécrivant la
// valeur que la variable a déjà, sauf pendant que la personne tape dans ce champ (il a le focus : sa frappe reste).
// Un champ valide n'est jamais réécrit par une écriture identique.
// Vu avec une vraie frappe, dans Chromium et Firefox.

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
  describe(`champ nombre lié, écriture du code à valeur identique (${nom})`, function () {
    this.timeout(120000)
    let present = false
    let script  = ''

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) {
        console.log(`  ℹ️  ${nom} non installé, test du champ nombre sauté. Activer : \`npx playwright install ${nom}\``)
        return
      }
      const root   = mjsTmp('champ-nombre-identique-' + nom)
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
        const page = await (await browser.newContext({ locale: 'fr-FR' })).newPage()
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
      return { value: el.value as string, mauvais: !!el.validity.badInput, modele: r.querySelector('b.e').textContent as string, valide: !!r.querySelector('form.f').checkValidity(), focus: r.activeElement === el }
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

    // « 3,5 » (le « 3 » laisse le modèle à 3) n'est refusé que par certains navigateurs : on ne teste que si le champ refuse la saisie
    for (const texte of ['3,5', '-']) {
      it(`« ${texte} » refusé, champ sans focus : le code qui réécrit la même valeur remplace la saisie`, async function () {
        if (!present) { this.skip(); return }
        await essai(async (page) => {
          await saisir(page, texte)
          if (!(await etat(page)).mauvais) return
          await quitter(page)
          assert.equal((await etat(page)).mauvais, true, 'la saisie refusée reste à la sortie')
          await clic(page, 'pareil')
          await page.waitForTimeout(80)
          const apres = await etat(page)
          assert.deepEqual({ value: apres.value, mauvais: apres.mauvais, valide: apres.valide }, { value: '3', mauvais: false, valide: true }, 'le champ affiche la valeur du code, le formulaire n\'est plus bloqué')
        })
      })

      it(`« ${texte} » refusé, champ avec focus : une écriture identique en minuterie laisse la frappe`, async function () {
        if (!present) { this.skip(); return }
        await essai(async (page) => {
          await saisir(page, texte)
          if (!(await etat(page)).mauvais) return
          await page.evaluate(() => setTimeout(() => ((document.querySelector('mjs-cs-page') as any)._shadow.querySelector('button.pareil') as HTMLElement).click(), 30))
          await page.waitForTimeout(150)
          const apres = await etat(page)
          assert.deepEqual({ mauvais: apres.mauvais, focus: apres.focus, modele: apres.modele }, { mauvais: true, focus: true, modele: apres.modele }, 'la saisie refusée reste, le champ garde le focus')
        })
      })

      it(`« ${texte} » refusé, champ sans focus : une autre valeur écrite par le code remplace la saisie`, async function () {
        if (!present) { this.skip(); return }
        await essai(async (page) => {
          await saisir(page, texte)
          if (!(await etat(page)).mauvais) return
          await quitter(page)
          await clic(page, 'autre')
          await page.waitForTimeout(80)
          const apres = await etat(page)
          assert.deepEqual({ value: apres.value, mauvais: apres.mauvais, modele: apres.modele }, { value: '9', mauvais: false, modele: '9' })
        })
      })
    }

    it('« - » refusé, champ avec focus : la frappe continue après une écriture identique (« -5 »)', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        await saisir(page, '-')
        await clic(page, 'pareil')
        await page.waitForTimeout(80)
        await page.keyboard.type('5', { delay: 30 })
        await page.waitForTimeout(80)
        const apres = await etat(page)
        assert.deepEqual({ value: apres.value, modele: apres.modele }, { value: '-5', modele: '-5' })
      })
    })

    it('champ valide : une écriture identique ne le réécrit pas (aucune écriture de value, curseur en place)', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        await saisir(page, '3')
        await page.evaluate(() => {
          const el = (document.querySelector('mjs-cs-page') as any)._shadow.querySelector('input.e')
          try { el.setSelectionRange(0, 0) } catch {}
          ;(window as any).__ecritures = 0
          const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') as PropertyDescriptor
          Object.defineProperty(el, 'value', { configurable: true, get() { return desc.get!.call(this) }, set(v) { (window as any).__ecritures++; desc.set!.call(this, v) } })
        })
        await quitter(page)
        await clic(page, 'pareil')
        await page.waitForTimeout(80)
        const ecritures = await page.evaluate(() => (window as any).__ecritures)
        const apres     = await etat(page)
        assert.deepEqual({ ecritures, value: apres.value, mauvais: apres.mauvais }, { ecritures: 0, value: '3', mauvais: false })
      })
    })
  })
}
