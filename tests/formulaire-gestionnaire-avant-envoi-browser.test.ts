// Un formulaire d'un composant suit l'ordre d'un lien : la question de `@confirm` d'abord, puis le
// gestionnaire `@submit` du composant, puis l'envoi par la couche de navigation (UJS) — un
// `@submit.prevent` (ou `e.preventDefault()`) retient l'envoi. Défaut garanti absent : la navigation
// prenait la soumission en CAPTURE sur le shadow root, AVANT le gestionnaire du composant, et la
// requête était déjà partie quand `.prevent` arrivait ; seule parade, `@noUJS`. Même défaut pour un
// composant léger posé dans un composant à shadow. Côté page (composant léger posé dans le document),
// un envoi lancé par le code (`requestSubmit()`, sans clic) posait la question de `@confirm` APRÈS le
// gestionnaire : un refus n'empêchait pas son code.
// Gardes : un formulaire simple reste envoyé par la navigation (sans rechargement), `.stop` ne
// coupe pas l'envoi, un formulaire que son gestionnaire retire de la page part quand même.
// Chromium et pas happy-dom : dans un vrai navigateur, un écouteur du document ne voit jamais
// l'intérieur d'un shadow fermé — c'est ce qui oblige la navigation à lire la soumission depuis le
// shadow root, et happy-dom ne le reproduit pas.

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
  'inscription.mjs': [
    '<script>',
    '$n      = 0',
    '$ouvert = true',
    '</script>',
    '<form class="prevent" action="/inscription" method="post" @submit.prevent={$n++}><button>ok</button></form>',
    '<form class="simple" action="/envoi" method="post"><button>ok</button></form>',
    '<form class="stop" action="/stop" method="post" @submit.stop={$n++}><button>ok</button></form>',
    '<p class="n">{$n}</p>',
    '{if $ouvert}<form class="ferme" action="/ferme" method="post" @submit={$ouvert = false}><button>ok</button></form>{end}',
    '<@interne @lightDom/>'
  ].join('\n') + '\n',
  'interne.mjs': '<script>\n$m = 0\n</script>\n<form class="leger" action="/leger" method="post" @submit.prevent={$m++}><button>ok</button></form>\n<p class="m">{$m}</p>\n',
  'question.mjs': '<script>\n$k = 0\n</script>\n<form class="question" action="/question" method="post" @confirm="Sûr ?" @submit={$k++}><button>ok</button></form>\n<p class="k">{$k}</p>\n'
}

describe('formulaire d\'un composant : la question, le gestionnaire, puis l\'envoi (Chromium réel)', function () {
  this.timeout(60000)
  let present = false
  let script  = ''

  before(async function () {
    present = await chromiumPresent()
    if (!present) {
      console.log('  ℹ️  Chromium non installé, test des formulaires sauté. Activer : `npx playwright install chromium`')
      return
    }
    const root   = mjsTmp('formulaire-avant-envoi')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const ordre = [...files].sort((a, b) => rang(a) - rang(b))
    script = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })

  after(async () => { await terminateSharedWorkerPool() })

  it('.prevent retient l\'envoi, composant léger compris ; formulaire simple, .stop, formulaire retiré : envoyés ; @confirm refusé : ni gestionnaire ni envoi', async function () {
    if (!present) { this.skip(); return }
    const { chromium } = await import('playwright')
    const html    = `<!doctype html><html><head><meta charset="utf-8"></head><body><mjs-inscription></mjs-inscription><mjs-question mjs-light></mjs-question><script>${script}</script></body></html>`
    const browser = await chromium.launch()
    try {
      const page   = await browser.newPage()
      const envois: string[] = []
      await page.route('http://mjs.test/**', (route) => {
        const req = route.request()
        if (req.method() === 'POST') {
          envois.push(new URL(req.url()).pathname + (req.isNavigationRequest() ? ' (rechargement)' : ''))
          return route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: 'ok' })
        }
        return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html })
      })
      await page.goto('http://mjs.test/')
      await page.waitForFunction(() => !!(document.querySelector('mjs-inscription') as any)?._shadow?.querySelector('mjs-interne .leger') && !!document.querySelector('mjs-question .question'))
      await page.evaluate(() => { (window as any).__temoin = 'page d\'origine' })
      // soumission par son bouton, comme un vrai clic ; `requestSubmit` : sans clic (la touche Entrée
      // d'un champ, un envoi par le code) — seule la soumission passe alors par la navigation
      const envoyer = (selecteur: string, sansClic = false) => page.evaluate(([sel, direct]) => {
        const hote: any = document.querySelector('mjs-inscription')
        const form: any = sel === '.question' ? document.querySelector('mjs-question .question') : hote._shadow.querySelector(sel)
        if (direct) form.requestSubmit()
        else form.querySelector('button').click()
      }, [selecteur, sansClic] as const)
      const lire = (sel: string) => page.evaluate((s) => {
        const hote: any = document.querySelector('mjs-inscription')
        return s === '.k' ? document.querySelector('mjs-question .k')!.textContent : hote._shadow.querySelector(s).textContent
      }, sel)
      // ce qui est parti pendant un cas, cas par cas
      const partis = async (geste: () => Promise<unknown>) => {
        envois.length = 0
        await geste()
        await page.waitForTimeout(150)
        return envois.slice()
      }

      assert.deepEqual(await partis(() => envoyer('.prevent')), [], 'formulaire .prevent : rien ne doit partir')
      assert.equal(await lire('.n'), '1', 'le gestionnaire .prevent a joué')

      assert.deepEqual(await partis(() => envoyer('.simple')), ['/envoi'], 'formulaire simple : envoyé par la navigation, sans rechargement')

      assert.deepEqual(await partis(() => envoyer('.stop')), ['/stop'], 'formulaire .stop : envoyé quand même')
      assert.equal(await lire('.n'), '2', 'le gestionnaire .stop a joué')

      assert.deepEqual(await partis(() => envoyer('mjs-interne .leger')), [], 'composant léger imbriqué : son .prevent retient l\'envoi')
      assert.equal(await lire('mjs-interne .m'), '1', 'le gestionnaire du composant léger a joué')

      assert.deepEqual(await partis(() => envoyer('.ferme')), ['/ferme'], 'formulaire retiré par son gestionnaire : envoyé quand même')
      assert.equal(await page.evaluate(() => (document.querySelector('mjs-inscription') as any)._shadow.querySelector('.ferme') === null), true, 'le formulaire s\'est bien fermé')

      await page.evaluate(() => { (window as any).µ.confirm = () => false })
      assert.deepEqual(await partis(() => envoyer('.question', true)), [], '@confirm refusé : rien ne part')
      assert.equal(await lire('.k'), '0', '@confirm refusé : le gestionnaire ne doit pas jouer (la question vient avant lui)')
      assert.deepEqual(await partis(() => envoyer('.question')), [], '@confirm refusé, par le bouton : rien ne part')
      assert.equal(await lire('.k'), '0', '@confirm refusé, par le bouton : le gestionnaire ne joue pas')
      assert.equal(await page.evaluate(() => (window as any).__temoin), 'page d\'origine', 'aucun rechargement de page')
    } finally {
      await browser.close()
    }
  })
})
