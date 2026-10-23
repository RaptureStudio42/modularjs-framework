// POURQUOI CE FICHIER EXISTE
// Pendant des défauts de module-dynamique-await-liste-fuite-props.test.ts, dans un vrai Chromium et en
// développement comme en production (noms de propriétés raccourcis, code minifié) : happy-dom ne dit
// pas si le raccourcissement des noms ou un vrai DOM change quelque chose.
//  1. `{success r}<@module $comp titre={r.nom}>` : promesse rejetée → la branche {error} s'affiche, sans
//     erreur de page ; promesse rejouée en succès → le titre revient.
//  2. `{for f in $l by k}<@module f.c titre={f.t}>` : un changement de composant dans une ligne, puis
//     ajout en tête, retrait, inversion, vidage, recréation — le DOM reste celui de la liste.
// Sauté, avec un message, quand Chromium n'est pas installé.

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const CE = '<script>\n$titre = \'\'\n</script>\n<p class="v">E:{$titre}</p>\n'
const CC = '<script>\n$titre = \'\'\n$n = 0\n@inc = -> $n++\n</script>\n<button class="i" @click={@inc()}>+</button><p class="v">C:{$titre}:{$n}</p>\n'
const CD = '<script>\n$titre = \'\'\n</script>\n<p class="v">D:{$titre}</p>\n'

const HOTE_AWAIT = '<script>\n$comp = \'mjs-ce\'\n$p = Promise.resolve({ nom: \'N1\' })\n@setP = (v) -> $p = v\n</script>\n{await $p}<i>...</i>{success r}<@module $comp titre={r.nom}></@module>{error err}<b>E</b>{end}\n'
const HOTE_LISTE = '<script>\n$l = [{ k: 2, c: \'mjs-cc\', t: \'b\' }]\n@set = (v) -> $l = v\n</script>\n{for f in $l by k}<@module f.c titre={f.t}></@module>{end}\n'

async function construire(env: 'dev' | 'prod', hote: string): Promise<{ root: string; outDir: string }> {
  const root   = mjsTmp(`moddyn-al-${env}`)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hote.mjs'), hote)
  writeFileSync(join(srcDir, 'ce.mjs'), CE)
  writeFileSync(join(srcDir, 'cc.mjs'), CC)
  writeFileSync(join(srcDir, 'cd.mjs'), CD)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env, js: 'split' })
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return { root, outDir }
}

async function servir(root: string, outDir: string): Promise<{ url: string; server: Server }> {
  const html   = '<!doctype html><html><head><meta charset="utf-8"></head><body><mjs-hote></mjs-hote><script type="module" src="/out/bundle.js"></script></body></html>'
  const server = createServer((req, res) => {
    const chemin = decodeURIComponent((req.url ?? '/').split('?')[0])
    if(chemin === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(html)
      return
    }
    const fichier = join(root, normalize(chemin))
    if(!fichier.startsWith(outDir) || !existsSync(fichier) || !statSync(fichier).isFile()) {
      res.writeHead(404)
      res.end()
      return
    }
    res.writeHead(200, { 'content-type': extname(fichier) === '.js' ? 'text/javascript; charset=utf-8' : 'application/octet-stream' })
    res.end(readFileSync(fichier))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  return { url: `http://127.0.0.1:${(server.address() as any).port}/`, server }
}

async function chromiumDisponible(): Promise<any> {
  try {
    const playwright = await import('playwright')
    if(!existsSync(playwright.chromium.executablePath())) return null
    return await playwright.chromium.launch()
  }
  catch {
    return null
  }
}

// résumé du DOM de l'hôte : un texte par enfant (composant et son contenu)
const RESUME = () => {
  const h: any = document.querySelector('mjs-hote')
  return [...h._shadow.children].filter((n: any) => n.localName !== 'style').map((n: any) => n.localName + '|' + (n._shadow && n._shadow.querySelector('.v') ? n._shadow.querySelector('.v').textContent : n.textContent))
}

describe('<@module> dans {await} et dans {for} — Chromium, développement et production', function () {
  this.timeout(180000)
  let browser: any = null

  before(async function () {
    this.timeout(30000)
    browser = await chromiumDisponible()
    if(!browser) console.log('  ℹ️  Chromium non installé : montages sautés. Activer : `npx playwright install chromium`')
  })

  after(async () => {
    if(browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for(const env of ['dev', 'prod'] as const) {
    describe(`build ${env}`, () => {
      async function ouvrir(hote: string, pret: () => boolean) {
        const { root, outDir } = await construire(env, hote)
        const { url, server }  = await servir(root, outDir)
        const page             = await browser.newPage()
        const erreurs: string[] = []
        page.on('pageerror', (e: Error) => erreurs.push(e.message))
        page.on('console', (m: any) => { if(m.type() === 'error') erreurs.push(m.text()) })
        await page.goto(url, { waitUntil: 'load' })
        await page.waitForFunction(pret, null, { timeout: 10000 }).catch(() => {})
        await page.waitForTimeout(150)
        const fermer = async () => { await page.close(); await new Promise(resolve => server.close(() => resolve(null))) }
        return { page, erreurs, fermer }
      }

      it('{await} : succès → rejet → succès, sans erreur de page', async function () {
        if(!browser) return this.skip()
        const { page, erreurs, fermer } = await ouvrir(HOTE_AWAIT, () => !!(document.querySelector('mjs-hote') as any)?._shadow?.querySelector('mjs-ce'))
        try {
          assert.deepEqual(await page.evaluate(RESUME), ['mjs-ce|E:N1'])
          await page.evaluate(() => { (document.querySelector('mjs-hote') as any).setP(Promise.reject(new Error('boum'))) })
          await page.waitForTimeout(200)
          assert.deepEqual(await page.evaluate(RESUME), ['b|E'], `erreurs de page : ${erreurs.join(' / ') || 'aucune'}`)
          await page.evaluate(() => { (document.querySelector('mjs-hote') as any).setP(Promise.resolve({ nom: 'N2' })) })
          await page.waitForTimeout(200)
          assert.deepEqual(await page.evaluate(RESUME), ['mjs-ce|E:N2'])
          assert.deepEqual(erreurs, [])
        }
        finally { await fermer() }
      })

      it('{for} à clé : changement de composant, ajout en tête, retrait, inversion, vidage, recréation', async function () {
        if(!browser) return this.skip()
        const { page, erreurs, fermer } = await ouvrir(HOTE_LISTE, () => !!(document.querySelector('mjs-hote') as any)?._shadow?.querySelector('mjs-cc'))
        const pose = async (liste: any[]) => {
          await page.evaluate((l: any[]) => { (document.querySelector('mjs-hote') as any).set(l) }, liste)
          await page.waitForTimeout(120)
        }
        try {
          assert.deepEqual(await page.evaluate(RESUME), ['mjs-cc|C:b:0'])
          await pose([{ k: 2, c: 'mjs-cd', t: 'b' }])
          assert.deepEqual(await page.evaluate(RESUME), ['mjs-cd|D:b'])
          await pose([{ k: 1, c: 'mjs-cc', t: 'a' }, { k: 2, c: 'mjs-cd', t: 'b' }])
          assert.deepEqual(await page.evaluate(RESUME), ['mjs-cc|C:a:0', 'mjs-cd|D:b'])
          await pose([{ k: 0, c: 'mjs-cd', t: 'z' }, { k: 1, c: 'mjs-cc', t: 'a' }, { k: 2, c: 'mjs-cd', t: 'b' }])
          assert.deepEqual(await page.evaluate(RESUME), ['mjs-cd|D:z', 'mjs-cc|C:a:0', 'mjs-cd|D:b'])
          await pose([{ k: 0, c: 'mjs-cd', t: 'z' }, { k: 2, c: 'mjs-cd', t: 'b' }])
          assert.deepEqual(await page.evaluate(RESUME), ['mjs-cd|D:z', 'mjs-cd|D:b'])
          await pose([{ k: 2, c: 'mjs-cd', t: 'b' }, { k: 0, c: 'mjs-cd', t: 'z' }])
          assert.deepEqual(await page.evaluate(RESUME), ['mjs-cd|D:b', 'mjs-cd|D:z'])
          await pose([])
          assert.deepEqual(await page.evaluate(RESUME), [])
          await pose([{ k: 2, c: 'mjs-cc', t: 'b' }, { k: 0, c: 'mjs-cd', t: 'z' }])
          assert.deepEqual(await page.evaluate(RESUME), ['mjs-cc|C:b:0', 'mjs-cd|D:z'])
          assert.deepEqual(erreurs, [])
        }
        finally { await fermer() }
      })
    })
  }
})
