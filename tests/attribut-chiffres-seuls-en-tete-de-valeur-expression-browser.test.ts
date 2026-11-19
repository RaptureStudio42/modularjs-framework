// des chiffres seuls entre accolades en tête d'une valeur d'attribut (`tabindex="{0}"`, `colspan="{2}"`) sont une expression : la règle
// du quantifieur d'une expression régulière les gardait en texte, et le navigateur recevait `{0}` (aucun ordre de tabulation) et `{2}`
// (une seule colonne). Le quantifieur, écrit juste après un caractère (`pattern="\d{2}"`, `pattern="a{2,3}"`), reste du texte.
// Vraie construction (développement et production, un seul fichier), dans Chromium, Firefox et WebKit
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const SOURCE = '<table><tr><td class="c" tabindex="{0}" colspan="{2}">c</td></tr></table>\n<input class="d" aria-label="deux chiffres" pattern="\\d{2}">\n<input class="a" aria-label="deux ou trois a" pattern="a{2,3}">\n'

describe('attribut : des chiffres seuls en tête de valeur sont une expression, le quantifieur reste du texte', function () {
  this.timeout(200000)
  const codes: Record<string, string> = {}

  before(async () => {
    for (const env of ['dev', 'prod']) {
      const root = mjsTmp('attribut-chiffres-seuls-' + env)
      const src  = join(root, 'src')
      const out  = join(root, 'out')
      mkdirSync(src, { recursive: true })
      writeFileSync(join(src, 'chiffres-seuls.mjs'), SOURCE)
      const bundler = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), urlPrefix: '/out', env, js: 'bundle', minify: false } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      assert.deepEqual(stats.errors.map((e: any) => e.message), [])
      codes[env] = '"use strict";\n' + readFileSync(join(out, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
    }
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const moteur of ['chromium', 'firefox', 'webkit'] as const) {
    it(`${moteur} : tabindex 0 et colspan 2, les motifs gardés, en développement et en production`, async function () {
      const playwright: any = await import('playwright')
      if (!existsSync(playwright[moteur].executablePath())) this.skip()
      const navigateur = await playwright[moteur].launch()
      try {
        for (const env of ['dev', 'prod']) {
          const page = await navigateur.newPage()
          await page.setContent('<!doctype html><html><head></head><body></body></html>')
          await page.addScriptTag({ content: codes[env] })
          const vu = await page.evaluate(async () => {
            document.body.innerHTML = '<mjs-chiffres-seuls></mjs-chiffres-seuls>'
            const hote: any = document.querySelector('mjs-chiffres-seuls')
            const ombre = () => hote._shadow || hote.shadowRoot || hote
            for (let i = 0; i < 100 && !ombre().querySelector('input.a')?.getAttribute('pattern'); i++) await new Promise((r) => setTimeout(r, 20))
            const td: any = ombre().querySelector('td.c')
            if (!td) return ombre().innerHTML
            return [td.getAttribute('tabindex'), td.tabIndex, td.getAttribute('colspan'), td.colSpan, ombre().querySelector('input.d').getAttribute('pattern'), ombre().querySelector('input.a').getAttribute('pattern')]
          })
          await page.close()
          assert.deepEqual(vu, ['0', 0, '2', 2, '\\d{2}', 'a{2,3}'], env)
        }
      }
      finally { await navigateur.close() }
    })
  }
})
