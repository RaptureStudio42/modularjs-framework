// une page d'un projet écrit en JavaScript (`defaultScriptLang: 'js'`, avec ou sans gabarit en écriture `js`) monte des modules du cœur
// écrits en Civet : l'interrupteur, le champ nombre et la liste déroulante s'affichent et répondent au geste comme dans un projet
// Civet, la variable liée de la page comprise. Build RÉEL de développement, servi fichier par fichier dans Chromium

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const PAGE = `<script>
  $actif = false
  $n     = 3
  $choix = 'b'
</script>
<@@switch checked=!{$actif}>Lumière</@@switch>
<@@number value=!{$n}></@@number>
<@@select value=!{$choix}><@@option value="a">Alpha</@@option><@@option value="b">Bêta</@@option></@@select>
<p><span class="actif">{$actif}</span> <span class="n">{$n}</span> <span class="choix">{$choix}</span></p>
`

// l'ombre d'un module du cœur posé dans la page
const OMBRE = (nom: string) => `document.querySelector('mjs-vitrine')._shadow.querySelector('mjs-core-${nom}')._shadow`
// un texte de la page elle-même
const TEXTE = (classe: string) => `document.querySelector('mjs-vitrine')._shadow.querySelector('.${classe}').textContent`

// le projet Civet en témoin : la même page s'y comporte ainsi
const LANGUES: Array<[string, Record<string, string>]> = [
  ['Civet (témoin)', {}],
  ['js', { defaultScriptLang: 'js' }]
]

// build de développement de la page, ses fichiers par nom
async function construire(nom: string, langues: Record<string, string>): Promise<Map<string, Buffer>> {
  const root   = mjsTmp(`modules-coeur-appli-js-browser-${nom.replace(/\W+/g, '-')}`)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'vitrine.mjs'), PAGE)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', js: 'split', env: 'dev', ...langues } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.deepEqual(stats.errors.map((e: any) => String(e.message).split('\n')[0]), [], `projet ${nom} : aucune erreur de construction`)
  const fichiers = new Map<string, Buffer>()
  for (const f of readdirSync(outDir)) if (/\.(js|json)$/.test(f)) fichiers.set(f, readFileSync(join(outDir, f)))
  return fichiers
}

describe('modules du cœur dans une page écrite en JavaScript — rendu et gestes dans Chromium', function () {
  this.timeout(120000)
  let playwright: any
  let navigateur: any

  before(async function () {
    playwright = await import('playwright')
    if (!existsSync(playwright.chromium.executablePath())) this.skip()
    navigateur = await playwright.chromium.launch()
  })

  after(async () => {
    if (navigateur) await navigateur.close()
    await terminateSharedWorkerPool()
  })

  for (const [nom, langues] of LANGUES) {
    it(`projet ${nom} : <@@switch>, <@@number> et <@@select> s'affichent, l'interrupteur et le bouton + écrivent la variable de la page`, async () => {
      const fichiers = await construire(nom, langues)
      const page     = await navigateur.newPage()
      const fautes: string[] = []
      page.on('pageerror', (e: any) => fautes.push(String(e.message)))
      page.on('console', (m: any) => { if (m.type() === 'error') fautes.push(m.text()) })
      try {
        await page.route('http://coeur-js.test/**', async (route: any) => {
          const url = new URL(route.request().url())
          if (!url.pathname.startsWith('/out/')) {
            await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><body><mjs-vitrine></mjs-vitrine><script type="module" src="/out/bundle.js"></script></body>' })
            return
          }
          const corps = fichiers.get(url.pathname.slice(5))
          if (!corps) { await route.fulfill({ status: 404, body: '' }); return }
          await route.fulfill({ status: 200, contentType: url.pathname.endsWith('.json') ? 'application/json' : 'text/javascript', body: corps })
        })
        await page.goto('http://coeur-js.test/')
        await page.waitForFunction(`(() => { try { return !!${OMBRE('switch')}.querySelector('input[role=switch]') && !!${OMBRE('number')}.querySelector('input[role=spinbutton]') && !!${OMBRE('select')}.querySelector('.select-label') } catch { return false } })()`, null, { timeout: 30000 })
        await page.waitForTimeout(150)

        // le rendu : chaque module montre l'état que la page lui donne
        assert.equal(await page.evaluate(`${OMBRE('switch')}.querySelector('input[role=switch]').checked`), false, 'l\'interrupteur part éteint')
        assert.equal(await page.evaluate(`${OMBRE('number')}.querySelector('input[role=spinbutton]').value`), '3', 'le champ nombre montre 3')
        assert.equal(await page.evaluate(`${OMBRE('select')}.querySelector('.select-label').textContent.trim()`), 'Bêta', 'la liste montre l\'option choisie par la page')

        // les gestes : les gestionnaires du module tournent et la liaison remonte à la page
        await page.evaluate(`${OMBRE('switch')}.querySelector('input[role=switch]').click()`)
        await page.waitForFunction(`${TEXTE('actif')} === 'true'`, null, { timeout: 5000 })
        await page.evaluate(`${OMBRE('number')}.querySelector('.step.more').click()`)
        await page.waitForFunction(`${TEXTE('n')} === '4'`, null, { timeout: 5000 })
        assert.equal(await page.evaluate(`${OMBRE('number')}.querySelector('input[role=spinbutton]').value`), '4', 'le champ nombre montre 4 après le bouton +')
        assert.equal(await page.evaluate(TEXTE('choix')), 'b', 'la page garde son choix')
        assert.deepEqual(fautes, [], 'aucune erreur dans la page')
      }
      finally {
        await page.close()
      }
    })
  }
})
