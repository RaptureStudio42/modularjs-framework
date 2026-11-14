// composants piégés dans Chromium réel : un commentaire qui cite `<code>` ou `<pre>`, écrit dans une chaîne d'interpolation, une
// valeur d'attribut, une `<textarea>`, un contenu glissé ou le corps d'un gestionnaire, sort du DOM tel qu'écrit, sans aucun
// caractère NUL, ni dans le code des composants ni dans les cartes de source construites ; un `<pre>` cité dans un commentaire
// n'efface pas le balisage qui le suit

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { SCRIPT, PIEGES, HOTE, nuls, autour } from './helpers/composants-pieges.js'

async function chromium(): Promise<any> {
  try {
    return (await import('playwright')).chromium
  }
  catch {
    return (await import('@playwright/test' as string)).chromium
  }
}

// fichiers d'un dossier, à toute profondeur
function fichiers(dossier: string): string[] {
  return readdirSync(dossier, { withFileTypes: true }).flatMap((n) => n.isDirectory() ? fichiers(join(dossier, n.name)) : [join(dossier, n.name)])
}

describe('composants piégés : aucun jeton interne dans le DOM ni dans les cartes de source (Chromium)', function () {
  this.timeout(120000)

  it('chaque texte sort tel qu\'écrit, sans caractère NUL', async () => {
    const root   = mjsTmp('masques-pieges-dom')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), HOTE)
    for (const [nom, gabarit] of Object.entries(PIEGES)) writeFileSync(join(srcDir, nom + '.mjs'), SCRIPT + gabarit + '\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    await terminateSharedWorkerPool()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    // code des composants et cartes de source construites, cœur exclu
    for (const f of fichiers(root).filter((f) => /\.(js|map)$/.test(f) && !f.includes('mjs_core'))) {
      const contenu = readFileSync(f, 'utf-8')
      assert.equal(nuls(contenu), 0, f + ' : ' + autour(contenu))
    }
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    const noms  = Object.keys(PIEGES)
    const browser = await (await chromium()).launch()
    try {
      const page    = await browser.newPage()
      const erreurs = [] as string[]
      page.on('pageerror', (e: Error) => erreurs.push(e.message))
      await page.setContent('<!doctype html><html><head><title>t</title></head><body></body></html>')
      await page.addScriptTag({ content: code + '\nglobalThis.µ = µ;' })
      await page.evaluate((ns) => { document.body.innerHTML = ns.map((n) => '<mjs-' + n + '></mjs-' + n + '>').join('') }, noms)
      // les composants rendent dans leur ombre
      await page.waitForFunction((ns) => ns.every((n) => (document.querySelector('mjs-' + n) as any)?._shadow?.querySelector('*') != null), noms)
      await page.evaluate(() => (document.querySelector('mjs-gestionnaire') as any)._shadow.querySelector('.k').click())
      await page.waitForFunction(() => (document.querySelector('mjs-gestionnaire') as any)._shadow.querySelector('.k').textContent !== 'x')
      const vus = await page.evaluate((ns) => {
        const o = {} as Record<string, { html: string; texte: string; valeur: string; titre: string }>
        for (const n of ns) {
          const ombre = (document.querySelector('mjs-' + n) as any)?._shadow
          const k     = ombre?.querySelector('.k') ?? ombre?.querySelector('mjs-hote')?._shadow?.querySelector('.k')
          o[n] = { html: ombre?.innerHTML ?? '', texte: k?.textContent ?? 'absent', valeur: k?.value ?? '', titre: k?.getAttribute('title') ?? '' }
        }
        return { o, tete: [document.title, ...[...document.querySelectorAll('title')].map((t) => t.textContent ?? '')].join('|') }
      }, noms)
      for (const [n, v] of Object.entries(vus.o)) assert.equal(nuls(Object.values(v).join('|')), 0, n + ' : ' + autour(Object.values(v).join('|')))
      assert.equal(nuls(vus.tete), 0, 'tête du document : ' + autour(vus.tete))
      const ecrit = 'a<!-- <code>x</code> -->c'
      assert.deepEqual(
        [vus.o.chaine.texte, vus.o.chainepre.texte, vus.o.precite.texte, vus.o.textarea.valeur, vus.o.attribut.titre, vus.o.gestionnaire.texte, vus.o.glisse.texte],
        ['a<!-- voir <code>npm i</code> pour installer -->c', 'a<!-- <pre>x</pre> -->c', 'QQ visible ZZ', ecrit, ecrit, ecrit, ecrit],
      )
      assert.deepEqual(erreurs, [])
    }
    finally {
      await browser.close()
    }
  })
})
