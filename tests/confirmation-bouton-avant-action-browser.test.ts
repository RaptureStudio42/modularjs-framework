// `@confirm` sur un `<button>` : la question passe AVANT l'action, et un refus l'empêche — dans un
// composant léger (`@lightDom`, sans shadow) comme dans un composant à shadow, et sur un bouton du
// HTML servi par le back (`mjs-confirm` + son propre écouteur). Défaut garanti absent : hors shadow,
// la confirmation n'écoutait qu'à la remontée, sur le document — le gestionnaire du composant léger
// (délégation en capture) ou l'écouteur du bouton avaient déjà joué : l'action partait au premier
// clic, la réponse à la question ne servait à rien. Un accord ne pose la question qu'une fois.
// Un vrai lien `:confirm` placé dans un `<pre>` pose aussi sa question au clic, et un refus le
// retient, construit en développement comme en production.
// Chromium : les phases de l'événement (capture, remontée) et le shadow fermé tels qu'un vrai
// navigateur les joue.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function chromiumPresent(): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright.chromium.executablePath())
  } catch {
    return false
  }
}

const SOURCES: Record<string, string> = {
  'suppr.mjs': '<script>\n$n = 3\n</script>\n<button class="b" :confirm="Vraiment ?" @click={$n--}>Supprimer</button>\n<p class="n">{$n}</p>\n'
}

// un vrai lien placé dans un exemple : il garde son mot de MJS
const EXEMPLE = '<pre><a class="l" href="/ailleurs" :confirm="Quitter ?">aller</a></pre>\n'

describe('@confirm sur un bouton (Chromium réel) — la question passe avant l\'action', function () {
  this.timeout(60000)
  let present = false
  let script  = ''
  const exemples: Record<'dev' | 'prod', string> = { dev: '', prod: '' }

  before(async function () {
    present = await chromiumPresent()
    if (!present) {
      console.log('  ℹ️  Chromium non installé, test de @confirm sur un bouton sauté. Activer : `npx playwright install chromium`')
      return
    }
    const root   = mjsTmp('confirm-bouton')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const ordre = [...files.filter((f) => f.startsWith('mjs_')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
    script = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    for (const mode of ['dev', 'prod'] as const) {
      const base = mjsTmp(`confirm-lien-exemple-${mode}`)
      const src  = join(base, 'src')
      const out  = join(base, 'out')
      mkdirSync(src, { recursive: true })
      writeFileSync(join(src, 'exemple.mjs'), EXEMPLE)
      // production : un seul fichier, le manifeste
      const manifeste = join(out, 'bundle.js')
      const construit = new Bundler({ sourceDir: src, outputDir: out, manifestPath: mode === 'prod' ? manifeste : join(base, 'bundle.js'), ...mode === 'prod' && { env: 'prod', js: 'bundle' } } as any)
      const bilan     = await construit.compile()
      await construit.close()
      assert.equal(bilan.errors.length, 0, bilan.errors.map((e: any) => e.message).join('\n'))
      const fichiers = readdirSync(out).filter((f) => f.endsWith('.js'))
      const rangs    = [...fichiers.filter((f) => f.startsWith('mjs_')).sort(), ...fichiers.filter((f) => !f.startsWith('mjs_')).sort()]
      exemples[mode] = mode === 'prod' ? stripEsm(readFileSync(manifeste, 'utf-8')) : rangs.map((f) => stripEsm(readFileSync(join(out, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    }
  })

  after(async () => { await terminateSharedWorkerPool() })

  it('refus : ni le composant léger, ni le composant à shadow, ni l\'écouteur du bouton servi ne jouent ; accord : chacun joue une fois, une seule question', async function () {
    if (!present) { this.skip(); return }
    const { chromium } = await import('playwright')
    const corps   = '<mjs-suppr class="ombre"></mjs-suppr><mjs-suppr class="leger" mjs-light></mjs-suppr><button class="servi" mjs-confirm="Page ?">servi</button><p class="p">3</p>'
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage()
      await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body>${corps}<script>${script}</script></body></html>`, { waitUntil: 'load' })
      await page.waitForFunction(() => !!document.querySelector('mjs-suppr.leger .b') && !!(document.querySelector('mjs-suppr.ombre') as any)?._shadow?.querySelector('.b'))
      await page.evaluate(() => {
        const w: any       = window
        w.µ.config.confirm = false
        w.__questions      = []
        w.__reponse        = false
        window.confirm     = (m?: string) => { w.__questions.push(m); return w.__reponse }
        // écouteur propre du bouton servi par le back : décompte à côté de lui
        const p = document.querySelector('.p')!
        document.querySelector('.servi')!.addEventListener('click', () => { p.textContent = String(Number(p.textContent) - 1) })
      })
      const cliquerTout = (reponse: boolean) => page.evaluate((r) => {
        const w: any  = window
        w.__questions = []
        w.__reponse   = r
        ;(document.querySelector('mjs-suppr.ombre') as any)._shadow.querySelector('.b').click()
        ;(document.querySelector('mjs-suppr.leger .b') as HTMLElement).click()
        ;(document.querySelector('.servi') as HTMLElement).click()
      }, reponse)
      const lire = () => page.evaluate(() => ({
        questions: (window as any).__questions.length,
        ombre:     (document.querySelector('mjs-suppr.ombre') as any)._shadow.querySelector('.n').textContent,
        leger:     document.querySelector('mjs-suppr.leger .n')!.textContent,
        servi:     document.querySelector('.p')!.textContent
      }))

      await cliquerTout(false)
      await page.waitForTimeout(50)
      assert.deepEqual(await lire(), { questions: 3, ombre: '3', leger: '3', servi: '3' }, 'refus : une question par bouton, aucune action')

      await cliquerTout(true)
      await page.waitForTimeout(50)
      assert.deepEqual(await lire(), { questions: 3, ombre: '2', leger: '2', servi: '2' }, 'accord : une seule question par bouton, chaque action une fois')
    } finally {
      await browser.close()
    }
  })

  for (const mode of ['dev', 'prod'] as const) {
    it(`un vrai lien :confirm placé dans un <pre> pose sa question au clic ; refus : la page reste (construit en ${mode === 'dev' ? 'développement' : 'production'})`, async function () {
      if (!present) { this.skip(); return }
      const { chromium } = await import('playwright')
      const browser = await chromium.launch({ args: ['--no-proxy-server'] })
      try {
        const page     = await browser.newPage()
        const requetes: string[] = []
        page.on('request', (r: any) => requetes.push(r.method() + ' ' + r.url()))
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() === 'http://t.test/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body><mjs-exemple mjs-light></mjs-exemple><script>${exemples[mode]}</script></body></html>` })
          return route.fulfill({ contentType: 'text/html', body: '<!doctype html><p>AILLEURS</p>' })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForSelector('mjs-exemple pre a.l')

        // refus dans la modale maison : la question posée, aucune requête, la page reste
        await page.click('mjs-exemple pre a.l')
        await page.waitForSelector('.mjs-modal-box', { timeout: 5000 })
        assert.match(await page.textContent('.mjs-modal-box') ?? '', /Quitter \?/)
        await page.click('.mjs-modal-cancel')
        await page.waitForSelector('.mjs-modal-box', { state: 'detached', timeout: 5000 })
        await page.waitForTimeout(300)
        assert.deepEqual(requetes.filter((r) => r.includes('/ailleurs')), [], 'refus : aucune requête vers le lien')
        assert.equal(page.url(), 'http://t.test/')

        // témoin, accord : le lien part (le refus retient un vrai lien)
        await page.click('mjs-exemple pre a.l')
        await page.waitForSelector('.mjs-modal-box', { timeout: 5000 })
        await Promise.all([page.waitForRequest('http://t.test/ailleurs', { timeout: 5000 }), page.click('.mjs-modal-confirm')])
      } finally {
        await browser.close()
      }
    })
  }
})
