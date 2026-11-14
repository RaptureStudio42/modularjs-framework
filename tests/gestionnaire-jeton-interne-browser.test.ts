// un commentaire de plusieurs lignes qui cite une balise du langage, écrit dans une chaîne d'une interpolation, sort du DOM
// comme le texte de l'auteur sans le commentaire (`xy`), sans aucun caractère NUL : le masque du commentaire, rangé dans celui
// de l'interpolation, n'était jamais remis et le texte affichait un jeton interne. Chromium réel

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

async function chromium(): Promise<any> {
  try {
    return (await import('playwright')).chromium
  }
  catch {
    return (await import('@playwright/test' as string)).chromium
  }
}

describe('commentaire qui cite une balise dans une chaîne d\'interpolation : aucun jeton interne dans le DOM (Chromium)', function () {
  this.timeout(120000)

  it('le texte affiché est celui de l\'auteur sans le commentaire, sans caractère NUL', async () => {
    const BT     = String.fromCharCode(96)
    const root   = mjsTmp('gestionnaire-jeton-interne')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'jt.mjs'), [
      '<script>',
      '$n = 0',
      '</script>',
      '<p class="a">{' + BT + 'x<!-- <@window>',
      '-->y' + BT + '}</p>',
      '<@window',
      '  @keydown={-> $n++}',
      '/>',
      '<p class="b">{"x<!-- <@w>',
      '-->y"}</p>',
      '',
    ].join('\n'))
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    await terminateSharedWorkerPool()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    const browser = await (await chromium()).launch()
    try {
      const page    = await browser.newPage()
      const erreurs = [] as string[]
      page.on('pageerror', (e: Error) => erreurs.push(e.message))
      await page.setContent('<!doctype html><html><body></body></html>')
      await page.addScriptTag({ content: code + '\nglobalThis.µ = µ;' })
      await page.evaluate(() => { document.body.innerHTML = '<mjs-jt></mjs-jt>' })
      // le composant rend dans son ombre
      await page.waitForFunction(() => (document.querySelector('mjs-jt') as any)?._shadow?.querySelector('p.b') != null)
      const textes = await page.evaluate(() => [...((document.querySelector('mjs-jt') as any)?._shadow?.querySelectorAll('p') ?? [])].map((p) => p.textContent ?? ''))
      assert.deepEqual(erreurs, [])
      assert.ok(textes.every((t) => !t.includes(String.fromCharCode(0))), 'caractère NUL dans le DOM : ' + JSON.stringify(textes))
      assert.deepEqual(textes, ['xy', 'xy'])
    }
    finally {
      await browser.close()
    }
  })
})
