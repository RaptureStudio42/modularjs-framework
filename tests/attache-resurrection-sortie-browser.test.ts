// Une balise qui sort (`@out=*fade(…)`) a déjà fait tourner le nettoyage de son attache `@attach` quand
// sa sortie commence. Si le bloc se rouvre PENDANT la sortie, la balise est ressuscitée — la même, pas
// une neuve : l'attache doit être reposée, une seule fois, et la sortie interrompue ne la retire pas.
// Le nettoyage remet la marque de pose de la balise à zéro (`_mjs_att`) : sans cela, la balise
// ressuscitée se croit encore attachée et reste sans son attache. Vraie animation de sortie dans Chromium
// et Firefox (la reprise d'une sortie en cours : happy-dom ne la joue pas).

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

// une sortie de 2 s : le temps de rouvrir le bloc en pleine sortie, même sur une machine chargée
const SOURCES: Record<string, string> = {
  'ar-page.mjs': `<script>
  $show  = true
  $items = [1]
  log = (what) -> (globalThis.__journal ||= []).push(what)
  mark = (label) -> (node) ->
    log('attache ' + label)
    -> log('nettoyage ' + label)
</script>
{if $show}<div class="b" @out=*fade(duration: 2s) @attach={mark('bloc')}>b</div>{end}
<ul>{for it in $items by it}<li class="l" @out=*fade(duration: 2s) @attach={mark('ligne')}>{it}</li>{end}</ul>
`
}

for (const nom of ['chromium', 'firefox'] as const) {
  describe(`@attach d'une balise ressuscitée pendant @out (${nom} réel)`, function () {
    this.timeout(120000)
    let present = false
    let script  = ''

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) {
        console.log(`  ℹ️  ${nom} non installé, test de la résurrection sautée. Activer : \`npx playwright install ${nom}\``)
        return
      }
      const root   = mjsTmp('attache-resurrection-browser-' + nom)
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

    async function essai(fn: (page: any) => Promise<void>) {
      const lanceur = (await import('playwright'))[nom]
      const browser = await lanceur.launch()
      try {
        const page = await browser.newPage()
        const erreurs: string[] = []
        page.on('pageerror', (e: any) => erreurs.push(String(e)))
        await page.route('http://t.test/**', (route: any) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body><mjs-ar-page></mjs-ar-page><script>${script}</script></body></html>` }))
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(() => !!(document.querySelector('mjs-ar-page') as any)?._shadow?.querySelector('.b'))
        await page.waitForTimeout(150)
        await fn(page)
        assert.deepEqual(erreurs, [], 'aucune erreur de page')
      } finally {
        await browser.close()
      }
    }

    const journal  = (page: any): Promise<string[]> => page.evaluate(() => [...((window as any).__journal ?? [])])
    const efface   = (page: any) => page.evaluate(() => { (window as any).__journal = [] })
    const pose     = (page: any, cle: string, valeur: any) => page.evaluate(([c, v]: [string, any]) => (document.querySelector('mjs-ar-page') as any)._set(c, v), [cle, valeur])
    const combien  = (page: any, sel: string): Promise<number> => page.evaluate((s: string) => (document.querySelector('mjs-ar-page') as any)._shadow.querySelectorAll(s).length, sel)
    const attendre = async (page: any, cond: () => Promise<boolean>, ms = 8000) => {
      const fin = Date.now() + ms
      while (!(await cond()) && Date.now() < fin) await page.waitForTimeout(40)
    }

    it('un bloc {if} rouvert pendant sa sortie : la balise reprend son attache, une fois, et la sortie ne la retire pas', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        assert.ok((await journal(page)).includes('attache bloc'), 'posée au montage')
        await efface(page)
        await pose(page, 'show', false)
        await attendre(page, async () => (await journal(page)).includes('nettoyage bloc'))
        assert.deepEqual(await journal(page), ['nettoyage bloc'], 'la sortie commence : le nettoyage a tourné')
        assert.equal(await combien(page, '.b'), 1, 'la balise sort encore (fondu en cours)')
        await efface(page)
        await pose(page, 'show', true)
        await attendre(page, async () => (await journal(page)).includes('attache bloc'))
        assert.deepEqual(await journal(page), ['attache bloc'], 'ressuscitée : l\'attache est reposée, une fois')
        assert.equal(await combien(page, '.b'), 1, 'une seule balise')
        // la sortie interrompue ne retire plus la balise, ni ne rejoue le nettoyage
        await page.waitForTimeout(2600)
        assert.equal(await combien(page, '.b'), 1, 'la balise ressuscitée reste')
        assert.deepEqual(await journal(page), ['attache bloc'], 'aucun nettoyage de plus')
        await efface(page)
        await pose(page, 'show', false)
        await attendre(page, async () => (await journal(page)).includes('nettoyage bloc'))
        assert.deepEqual(await journal(page), ['nettoyage bloc'], 'refermée pour de bon : l\'attache reposée est nettoyée')
      })
    })

    it('une ligne de {for} retirée puis remise pendant sa sortie : même chose', async function () {
      if (!present) { this.skip(); return }
      await essai(async (page) => {
        assert.ok((await journal(page)).includes('attache ligne'), 'posée au montage')
        await efface(page)
        await pose(page, 'items', [])
        await attendre(page, async () => (await journal(page)).includes('nettoyage ligne'))
        assert.deepEqual(await journal(page), ['nettoyage ligne'], 'la sortie de la ligne commence : le nettoyage a tourné')
        await efface(page)
        await pose(page, 'items', [1])
        await attendre(page, async () => (await journal(page)).includes('attache ligne'))
        assert.deepEqual(await journal(page), ['attache ligne'], 'ligne remise : l\'attache est reposée, une fois')
        await page.waitForTimeout(2600)
        assert.equal(await combien(page, 'li.l'), 1, 'une seule ligne, la ressuscitée')
        assert.deepEqual(await journal(page), ['attache ligne'], 'aucun nettoyage de plus')
      })
    })
  })
}
