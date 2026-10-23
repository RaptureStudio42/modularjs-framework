// Un champ nombre lié dans les deux sens (`<input type="number" value=!{$n}>`, `value.number=!{$n}`)
// se tape comme n'importe quel champ : « 1 », « . », « 5 » donne 1.5. Au pas « 1. », le navigateur ne
// rend pas de valeur (« 1. » n'est pas un nombre complet : `value` vaut '' et `validity.badInput`
// est vrai) ; la conversion en nombre en faisait 0, qui repartait dans le champ et effaçait la
// frappe — on finissait avec 5. Le pas incomplet (« 1. », « - », « 1e ») n'écrit plus rien : ni le
// modèle, ni le champ. Vraie frappe au clavier dans Chromium et Firefox.

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

const SOURCES: Record<string, string> = {
  'cn-page.mjs': `<script>
  $n = 0
  $m = 0
  $i = 0
  $t = 0
  $e = 3
  $rows = [{id: 1, v: 0}]
</script>
<input class="a" aria-label="a" type="number" step="any" value=!{$n}>
<input class="b" aria-label="b" type="number" step="any" value.number=!{$m}>
<input class="c" aria-label="c" type="number" step="any" value.int=!{$i}>
<input class="d" aria-label="d" type="text" value.number=!{$t}>
<input class="e" aria-label="e" type="number" step="any" value=!{$e}>
<ul>{for r in $rows by id}<li><input class="r" aria-label="r" type="number" step="any" value=!{r.v}></li>{end}</ul>
<button class="s" @click={$n = 7; $e = 9}>poser</button>
<p class="mod"><b class="n">{$n}</b>|<b class="tn">{typeof $n}</b>|<b class="m">{$m}</b>|<b class="tm">{typeof $m}</b>|<b class="i">{$i}</b>|<b class="t">{$t}</b>|<b class="e">{$e}</b>|<b class="rv">{$rows[0].v}</b></p>
`
}

for (const nom of ['chromium', 'firefox'] as const) {
  describe(`champ nombre lié (${nom} réel) — vraie frappe`, function () {
    this.timeout(120000)
    let present = false
    let script  = ''

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) {
        console.log(`  ℹ️  ${nom} non installé, test du champ nombre sauté. Activer : \`npx playwright install ${nom}\``)
        return
      }
      const root   = mjsTmp('champ-nombre-browser-' + nom)
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      for (const [n, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, n), source)
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
      const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
      script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    })

    after(async () => { await terminateSharedWorkerPool() })

    async function essai(fn: (page: any, erreurs: string[]) => Promise<void>) {
      const lanceur = (await import('playwright'))[nom]
      const browser = await lanceur.launch()
      try {
        const page = await browser.newPage()
        const erreurs: string[] = []
        page.on('pageerror', (e: any) => erreurs.push(String(e)))
        await page.route('http://t.test/**', (route: any) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body><mjs-cn-page></mjs-cn-page><script>${script}</script></body></html>` }))
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(() => !!(document.querySelector('mjs-cn-page') as any)?._shadow?.querySelector('input.a'))
        await page.waitForTimeout(100)
        await fn(page, erreurs)
        assert.deepEqual(erreurs, [], 'aucune erreur de page')
      } finally {
        await browser.close()
      }
    }

    // l'état du champ après chaque touche : `value`, et `mauvais` (le texte tapé n'est pas encore un nombre : le champ garde la frappe)
    const etat = (page: any, classe: string) => page.evaluate((c: string) => {
      const el = (document.querySelector('mjs-cn-page') as any)._shadow.querySelector('input.' + c)
      return { value: el.value as string, mauvais: !!el.validity.badInput }
    }, classe)
    const modele = (page: any, classe: string) => page.evaluate((c: string) => (document.querySelector('mjs-cn-page') as any)._shadow.querySelector('b.' + c).textContent as string, classe)

    // le pas « 1. » : Chromium ne rend pas de valeur (frappe incomplète, `mauvais`), Firefox rend « 1 » ; dans les deux
    // cas le champ n'a pas été réécrit (« 0 » ou '' sans frappe sont l'ancien défaut)
    const intact = (e: { value: string, mauvais: boolean }) => e.mauvais ? e.value === '' : e.value === '1'

    // sélectionne tout le champ puis tape les touches une à une ; rend l'état après chaque touche
    async function frappe(page: any, classe: string, touches: string[]) {
      await page.evaluate((c: string) => (document.querySelector('mjs-cn-page') as any)._shadow.querySelector('input.' + c).focus(), classe)
      await page.keyboard.press('Control+A')
      const suite: { value: string, mauvais: boolean }[] = []
      for (const t of touches) {
        await page.keyboard.type(t)
        await page.waitForTimeout(40)
        suite.push({ ...(await etat(page, classe)) })
      }
      return suite
    }

    it('value=!{$n} sur type="number" : « 1 », « . », « 5 » donne 1.5, le modèle vaut 1.5 (un nombre) et « 1. » n\'écrit pas 0', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        const suite = await frappe(page, 'a', ['1', '.', '5'])
        assert.deepEqual(suite[0], { value: '1', mauvais: false }, 'après « 1 »')
        assert.equal(await modele(page, 'n'), '1.5', 'le modèle vaut 1.5')
        assert.equal(await modele(page, 'tn'), 'number', 'et reste un nombre')
        assert.ok(intact(suite[1]), `après « 1. » : la frappe reste dans le champ, rien n'y est écrit, surtout pas « 0 » (${JSON.stringify(suite[1])})`)
        assert.deepEqual(suite[2], { value: '1.5', mauvais: false }, 'après « 1.5 » : le champ affiche 1.5')
        await page.keyboard.type('2')
        await page.waitForTimeout(40)
        assert.equal((await etat(page, 'a')).value, '1.52', 'la frappe continue')
        assert.equal(await modele(page, 'n'), '1.52')
      })
    })

    it('value.number=!{$m} sur type="number" : même frappe, même résultat', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        const suite = await frappe(page, 'b', ['1', '.', '5'])
        assert.ok(intact(suite[1]), `après « 1. » : la frappe reste dans le champ (${JSON.stringify(suite[1])})`)
        assert.deepEqual(suite[2], { value: '1.5', mauvais: false }, 'après « 1.5 » : le champ affiche 1.5')
        assert.equal(await modele(page, 'm'), '1.5', 'le modèle vaut 1.5')
        assert.equal(await modele(page, 'tm'), 'number', 'et reste un nombre')
      })
    })

    it('value.int=!{$i} sur type="number" : « 1. » n\'efface pas la frappe, le modèle garde 1', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        const suite = await frappe(page, 'c', ['1', '.', '5'])
        assert.ok(intact(suite[1]), `après « 1. » : la frappe reste dans le champ (${JSON.stringify(suite[1])})`)
        assert.deepEqual(suite[2], { value: '1.5', mauvais: false }, 'après « 1.5 » : le champ garde ce qui est tapé')
        assert.equal(await modele(page, 'i'), '1', 'le modèle est l\'entier 1')
      })
    })

    it('un signe moins seul : le modèle ne passe pas à 0, « - » puis « 5 » donne -5', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        assert.equal(await modele(page, 'e'), '3', 'départ : 3')
        const suite = await frappe(page, 'e', ['-', '5'])
        assert.deepEqual(suite[0], { value: '', mauvais: true }, 'après « - » : la frappe reste dans le champ')
        assert.equal(await modele(page, 'e'), '-5', 'le modèle vaut -5')
        assert.deepEqual(suite[1], { value: '-5', mauvais: false }, 'le champ affiche -5')
      })
    })

    it('un champ texte avec value.number garde ce qui est tapé (« 1. » est lu 1, le modèle ne bouge pas, le champ non plus)', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        const suite = await frappe(page, 'd', ['1', '.', '5'])
        assert.deepEqual(suite.map((s) => s.value), ['1', '1.', '1.5'])
        assert.equal(await modele(page, 't'), '1.5')
      })
    })

    it('une ligne de {for} : value=!{r.v} se tape de la même façon', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        const suite = await frappe(page, 'r', ['1', '.', '5'])
        assert.ok(intact(suite[1]), `après « 1. » : la frappe reste dans le champ (${JSON.stringify(suite[1])})`)
        assert.deepEqual(suite[2], { value: '1.5', mauvais: false }, 'après « 1.5 » : le champ affiche 1.5')
        assert.equal(await modele(page, 'rv'), '1.5', 'la ligne vaut 1.5')
      })
    })

    it('le modèle écrit dans le champ : une valeur posée par le code remplace la frappe', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        await frappe(page, 'a', ['1', '.'])
        await page.evaluate(() => ((document.querySelector('mjs-cn-page') as any)._shadow.querySelector('button.s') as HTMLElement).click())
        await page.waitForTimeout(60)
        assert.equal((await etat(page, 'a')).value, '7', 'le champ lié suit le modèle')
        assert.equal((await etat(page, 'e')).value, '9', 'l\'autre aussi')
      })
    })
  })
}
