// Une attache `:attach={f(_node)}` qui appelle une fonction du <script>, dans un vrai navigateur (Chromium, Firefox, WebKit) :
// la forme d'un verrou qui publie son état dans un magasin (`$$ui.locked = true`, nettoyage `-> $$ui.locked = false`) se pose une
// fois, ce qu'écrit la fonction n'étant pas une lecture (elle se relançait sur sa propre écriture jusqu'au garde-fou des 10 000
// rendus) ; celle d'un bouton « haut de page » dont l'attache lit `$shown` est rejouée à chaque changement de `$shown`, après le
// nettoyage du passage d'avant, autant de fois que la même attache écrite en méthode (`:attach={@hook(_node)}`)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const VERROU = '<script>\n$$ui = { locked: false }\npublish = (node) ->\n  globalThis.__publie = (globalThis.__publie or 0) + 1\n  $$ui.locked = true\n  -> $$ui.locked = false\n</script>\n<div class="verrou" :attach={publish(_node)}>{if $$ui.locked}L{else}O{end}</div>\n'
// `cle` : f pour la fonction, m pour la méthode
const haut   = (nom: string, cle: string) => `<script>\n$shown = false\n${nom} = (node) ->\n  globalThis.__pose.${cle}++\n  node.dataset.vu = String($shown)\n  -> globalThis.__net.${cle}++\n</script>\n<div class="haut" :attach={${nom}(_node)}>{$shown}</div>\n<button class="bascule" @click={$shown = not $shown}>b</button>\n`

async function moteur(nom: string): Promise<any> {
  try {
    return (await import('playwright') as any)[nom]
  }
  catch {
    return (await import('@playwright/test' as string) as any)[nom]
  }
}

describe('attache qui appelle une fonction du <script> : ce qu\'elle écrit ne la relance pas, ce qu\'elle lit la rejoue (navigateur)', function () {
  this.timeout(180000)

  let code = ''

  before(async () => {
    const root   = mjsTmp('attache-fonction-ecrit-lit')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'verrou.mjs'), VERROU)
    writeFileSync(join(srcDir, 'haut.mjs'), haut('hook', 'f'))
    writeFileSync(join(srcDir, 'haut-methode.mjs'), haut('@hook', 'm'))
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    await terminateSharedWorkerPool()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    code = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  })

  for (const nom of ['chromium', 'firefox', 'webkit']) {
    it(`${nom} : le verrou publie une fois, le bouton « haut » est rejoué à chacune des six bascules, comme la méthode`, async () => {
      const browser = await (await moteur(nom)).launch()
      try {
        const page    = await browser.newPage()
        const erreurs = [] as string[]
        page.on('pageerror', (e: Error) => erreurs.push(e.message))
        await page.setContent('<!doctype html><html><body></body></html>')
        await page.addScriptTag({ content: 'globalThis.__pose = { f: 0, m: 0 };\nglobalThis.__net = { f: 0, m: 0 };\n' + code + '\nglobalThis.µ = µ;' })
        await page.evaluate(() => { document.body.innerHTML = '<mjs-verrou></mjs-verrou><mjs-haut></mjs-haut><mjs-haut-methode></mjs-haut-methode>' })
        await page.waitForFunction(() => ((document.querySelector('mjs-verrou') as any)?._shadow?.querySelector('.verrou')?.textContent ?? '').trim() === 'L')
        for (const balise of ['mjs-haut', 'mjs-haut-methode']) {
          await page.waitForFunction((b) => (document.querySelector(b) as any)?._shadow?.querySelector('.bascule') != null, balise)
          for (let i = 0; i < 6; i++) {
            await page.evaluate((b) => (document.querySelector(b) as any)._shadow.querySelector('.bascule').click(), balise)
            await page.waitForFunction(([b, n]) => ((document.querySelector(b as string) as any)._shadow.querySelector('.haut').textContent ?? '').trim() === String((n as number) % 2 === 0), [balise, i], { timeout: 5000 })
          }
        }
        await new Promise((r) => setTimeout(r, 200))
        const passages = await page.evaluate(() => ({ publie: (globalThis as any).__publie, pose: (globalThis as any).__pose, net: (globalThis as any).__net, vu: (document.querySelector('mjs-haut') as any)._shadow.querySelector('.haut').dataset.vu }))
        assert.equal(passages.publie, 1)
        assert.ok(passages.pose.f >= 7, `rejouée à chaque bascule : ${JSON.stringify(passages)}`)
        assert.equal(passages.pose.f - passages.net.f, 1, `chaque passage nettoie le précédent : ${JSON.stringify(passages)}`)
        assert.deepEqual(passages.pose.f, passages.pose.m)
        assert.deepEqual(passages.net.f, passages.net.m)
        assert.equal(passages.vu, 'false')
        assert.deepEqual(erreurs, [])
      }
      finally {
        await browser.close()
      }
    })
  }
})
