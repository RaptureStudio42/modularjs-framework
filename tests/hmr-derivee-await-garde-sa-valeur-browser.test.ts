// `mjs dev` réel et trois navigateurs : un composant à valeur qui attend (`$resultats = await rechercher($q, µsignal)`) modifié se
// redessine seul, sans recharger la page, comme les autres ; son état reste (`$q`), la valeur affichée reste jusqu'à la réponse, et la
// demande se refait une fois (son code a pu changer), gabarit modifié comme fonction modifiée. Les requêtes sont tenues par le test

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const cliPath  = join(repoRoot, 'src', 'cli.ts')

const PREMIER_BUILD = /✅ \d+ fichiers en \d+ms/

function lancerDev(root: string, port: number): Promise<{ kill(): Promise<void> }> {
  return new Promise((resolve, reject) => {
    // la CLI en TypeScript, lue par tsx chargé dans Node
    const proc = spawn(process.execPath, ['--import', 'tsx', cliPath, 'dev', '--root', root, '--port', String(port)], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] })
    let sortie = ''
    let fini   = false
    const abandon = setTimeout(() => {
      if (fini) return
      fini = true
      proc.kill('SIGKILL')
      reject(new Error(`'mjs dev' n'a jamais fini son premier build.\n${sortie}`))
    }, 60000)
    proc.stdout!.on('data', (d) => {
      sortie += String(d)
      if (fini || !PREMIER_BUILD.test(sortie)) return
      fini = true
      clearTimeout(abandon)
      resolve({ kill: () => new Promise((done) => {
        proc.once('close', () => done())
        proc.kill('SIGINT')
        setTimeout(() => proc.kill('SIGKILL'), 5000)
      }) })
    })
    proc.stderr!.on('data', (d) => { sortie += String(d) })
    proc.on('error', (e) => { if (!fini) { fini = true; clearTimeout(abandon); reject(e) } })
  })
}

const source = (titre: string, v: number) => `<script>
$q = 'a'
rechercher = (q, signal) -> fetch("/api/s?q=#{q}&v=${v}", { signal }).then((r) -> r.json())
$resultats = await rechercher($q, µsignal)
@chercher = (q) -> $q = q
</script>

<h2 class="titre">${titre}</h2><b class="n">{JSON.stringify($resultats)}</b><i class="att">{µpending($resultats)}</i>
`

for (const nav of ['chromium', 'firefox', 'webkit'] as const) {
  describe('rechargement à chaud — composant à valeur qui attend (' + nav + ')', function () {
    this.timeout(180000)

    it('gabarit puis fonction modifiés : la page reste, l\'état et la valeur affichée restent, la demande se refait une fois', async function () {
      const playwright = await import('playwright')
      if (!existsSync(playwright[nav].executablePath())) { this.skip(); return }
      const root = mjsTmp('hmr-await-' + nav)
      const src  = join(root, 'src')
      mkdirSync(src, { recursive: true })
      writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js' }))
      writeFileSync(join(root, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/modularjs/bundle.js"></script></head><body><mjs-recherche></mjs-recherche></body></html>')
      const ecrire = (titre: string, v: number) => writeFileSync(join(src, 'recherche.mjs'), source(titre, v))
      ecrire('v1', 1)
      const port    = 22000 + Math.floor(Math.random() * 8000)
      const dev     = await lancerDev(root, port)
      const browser = await playwright[nav].launch()
      try {
        const page = await browser.newPage()
        const erreurs: string[] = []
        page.on('pageerror', (e: any) => erreurs.push(String(e).slice(0, 200)))
        page.on('console', (m: any) => { if (m.type() === 'error' || /recharge/.test(m.text())) erreurs.push('console ' + m.text().slice(0, 200)) })
        let vues: string[] = []
        let charges = 0
        const tenues: Record<string, any[]> = {}
        await page.route('**/api/s**', (route: any) => { const u = new URL(route.request().url()); const c = u.searchParams.get('q') + '/v' + u.searchParams.get('v'); vues.push(c); (tenues[c] ||= []).push(route) })
        page.on('load', () => charges++)
        const rep = async (c: string, corps: any) => { const r = (tenues[c] || []).shift(); assert.ok(r, 'rien de tenu pour ' + c + ' — vues : ' + vues.join(', ')); await r.fulfill({ contentType: 'application/json', body: JSON.stringify(corps) }); await page.waitForTimeout(200) }
        const ecran = () => page.evaluate(`(() => { const s = document.querySelector('mjs-recherche')?._shadow; return s ? ['titre', 'n', 'att'].map((c) => s.querySelector('.' + c)?.textContent ?? '∅').join(' ') : '∅' })()`)
        const titre = async (t: string) => { const fin = Date.now() + 20000; while (Date.now() < fin) { const v = await page.evaluate(`document.querySelector('mjs-recherche')?._shadow?.querySelector('.titre')?.textContent`).catch(() => null); if (v === t) { await page.waitForTimeout(400); return true } await page.waitForTimeout(60) } return false }
        await page.goto(`http://127.0.0.1:${port}/`)
        assert.ok(await titre('v1'))
        await rep('a/v1', ['r-a1'])
        await page.evaluate(`document.querySelector('mjs-recherche').chercher('b')`)
        await page.waitForTimeout(200)
        await rep('b/v1', ['r-b1'])
        assert.equal(await ecran(), 'v1 ["r-b1"] false')
        vues = []
        ecrire('v2', 1)
        assert.ok(await titre('v2'), 'le gabarit modifié se redessine')
        assert.equal(charges, 1, 'la page ne se recharge pas — ' + erreurs.join(' | '))
        assert.deepEqual(vues, ['b/v1'], 'la demande se refait une fois, avec l\'état gardé ($q = b)')
        assert.equal(await ecran(), 'v2 ["r-b1"] true', 'la valeur affichée reste pendant la demande')
        await rep('b/v1', ['r-b1x'])
        assert.equal(await ecran(), 'v2 ["r-b1x"] false')
        vues = []
        ecrire('v3', 2)
        assert.ok(await titre('v3'), 'la fonction modifiée se redessine')
        assert.equal(charges, 1, 'la page ne se recharge pas — ' + erreurs.join(' | '))
        assert.deepEqual(vues, ['b/v2'], 'la demande se refait une fois, avec le code neuf')
        await rep('b/v2', ['r-b2'])
        assert.equal(await ecran(), 'v3 ["r-b2"] false')
        vues = []
        await page.evaluate(`document.querySelector('mjs-recherche').chercher('c')`)
        await page.waitForTimeout(200)
        assert.deepEqual(vues, ['c/v2'], 'après l\'échange, une variable citée relance une demande, une seule')
        await rep('c/v2', ['r-c2'])
        assert.equal(await ecran(), 'v3 ["r-c2"] false')
        assert.deepEqual(erreurs, [], 'aucune erreur')
      }
      finally {
        await browser.close()
        await dev.kill()
      }
    })
  })
}
