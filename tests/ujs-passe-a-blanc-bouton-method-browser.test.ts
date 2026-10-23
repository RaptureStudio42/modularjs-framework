// Envoi d'un formulaire dont un écouteur de la page coupe la propagation : la passe à blanc de MJS lit le champ
// `_method` comme `FormData` le fera ensuite — d'abord les champs du formulaire, puis, s'il n'y en a pas, le bouton
// qui envoie (`e.submitter`) ; un autre bouton nommé `_method`, qui n'envoie pas, n'est jamais envoyé.
// Chromium, Firefox et WebKit réels (vrai clic de souris).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

type Navigateur = 'chromium' | 'firefox' | 'webkit'

async function navigateurPresent(nom: Navigateur): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const FORMS = [
  '<form class="seul" action="/envoi" method="post"><input name="q" value="a"><button class="b" type="submit" name="_method" value="delete">supprimer</button></form>',
  '<form class="champ" action="/envoi" method="post"><input type="hidden" name="_method" value="put"><button class="b" type="submit" name="_method" value="delete">supprimer</button></form>',
  '<form class="autre" action="/envoi" method="post"><button class="muet" type="submit" name="_method" value="delete">supprimer</button><button class="b" type="submit">envoyer</button></form>',
  '<form class="sans" action="/envoi" method="post"><input name="q" value="a"><button class="b" type="submit">envoyer</button></form>'
].join('\n')

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`UJS : passe à blanc et bouton d'envoi nommé _method (${nom} réel)`, function () {
  this.timeout(180000)
  let present = false
  let navigateur: any
  let script = ''

  before(async () => {
    present = await navigateurPresent(nom)
    if (!present) {
      console.log('  ℹ️  ' + nom + ' non installé, test sauté. Activer : `npx playwright install ' + nom + '`')
      return
    }
    const root   = mjsTmp('ujs-passe-a-blanc-bouton-method')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), FORMS + '\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const ordre = [...files.filter((f) => f.startsWith('mjs_')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
    script = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    const playwright = await import('playwright')
    navigateur = await playwright[nom].launch()
  })

  after(async () => {
    if (navigateur) await navigateur.close()
    await terminateSharedWorkerPool()
  })

  // clique le bouton `.b` (ou `bouton`) du formulaire `classe`, la propagation coupée en capture sur le document : rend ce que la
  // passe à blanc a lu comme `_method`
  async function lecture(classe: string, bouton = '.b') {
    const page = await navigateur.newPage()
    const lus: any[] = []
    await page.exposeFunction('__lire', (v: any) => { lus.push(v) })
    const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><mjs-hote mjs-light></mjs-hote><script>${script}</script></body></html>`
    await page.route('http://mjs.test/**', (route: any) => {
      if (route.request().method() !== 'GET') return route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: 'ok' })
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html })
    })
    await page.goto('http://mjs.test/')
    await page.waitForFunction(() => !!document.querySelector('mjs-hote .b'))
    await page.evaluate(() => {
      const w: any = window
      w.µ.config.confirm = false
      const o = w.µ._mjs_ujsMethodField
      w.µ._mjs_ujsMethodField = function (...args: any[]) { const r = o.apply(this, args); w.__lire(r); return r }
      document.addEventListener('submit', (e) => e.stopPropagation(), true)
    })
    await page.click(`mjs-hote form.${classe} ${bouton}`)
    await page.waitForTimeout(400)
    await page.close()
    return lus
  }

  it('aucun autre champ `_method` : la passe à blanc lit le bouton qui envoie', async function () {
    if (!present) { this.skip(); return }
    assert.deepEqual(await lecture('seul'), ['delete'])
  })

  it('un champ `_method` existe : il garde la priorité sur le bouton', async function () {
    if (!present) { this.skip(); return }
    assert.deepEqual(await lecture('champ'), ['put'])
  })

  it('un bouton `_method` qui n\'envoie pas n\'est pas lu', async function () {
    if (!present) { this.skip(); return }
    assert.deepEqual(await lecture('autre'), [null])
  })

  it('aucun `_method` nulle part : rien n\'est lu', async function () {
    if (!present) { this.skip(); return }
    assert.deepEqual(await lecture('sans'), [null])
  })
})
