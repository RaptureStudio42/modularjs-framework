// un `<!-- … -->` de plusieurs lignes qui cite une balise du langage, écrit dans une chaîne d'une interpolation, n'est pas un
// commentaire (chapitre 2, « Les commentaires ») : le DOM montre la chaîne telle que l'auteur l'a écrite, sans aucun caractère
// NUL ni jeton interne. Le masque du commentaire, rangé dans celui de l'interpolation, n'était jamais remis et le texte
// affichait un jeton interne. Chromium réel

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

describe('un `<!-- … -->` qui cite une balise dans une chaîne d\'interpolation : aucun jeton interne dans le DOM (Chromium)', function () {
  this.timeout(120000)

  it('le texte affiché est celui de l\'auteur, `<!-- … -->` compris, sans caractère NUL', async () => {
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
      // texte exact : un jeton interne ou un vrai commentaire posé dans le DOM le changerait
      assert.deepEqual(textes, ['x<!-- <@window>\n-->y', 'x<!-- <@w>\n-->y'])
    }
    finally {
      await browser.close()
    }
  })
})
