// le cœur d'une appli sans transition, sans liaison filtrée, sans <@view> et sans état partagé (`runtime: 'core'`) ne porte pas leur
// code : ses listes à clé, ses blocs {if}/{else} et {key} marchent comme avant, au navigateur réel, dans les trois moteurs

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { MOTEURS, moteurPresent, ouvrirPage } from './helpers/navigateurs-compiles.js'

const SOURCE = `<script>
$items = [{ id: 1, n: 'a' }, { id: 2, n: 'b' }, { id: 3, n: 'c' }]
$on = true
$k = 1
melanger = ->
  $items = [{ id: 3, n: 'c' }, { id: 1, n: 'a' }, { id: 4, n: 'd' }]
basculer = -> $on = not $on
changer = -> $k = 2
</script>
<ul>{for it in $items by id}<li>{it.n}</li>{end}</ul>
{if $on}<p class="si">oui</p>{else}<p class="sinon">non</p>{end}
{key $k}<span class="cle">{$k}</span>{end}
<button class="b1" @click={melanger()}>1</button><button class="b2" @click={basculer()}>2</button><button class="b3" @click={changer()}>3</button>`

async function compiler(): Promise<{ script: string; coeur: string }> {
  const root   = mjsTmp('coeur-allege')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hote.mjs'), SOURCE + '\n')
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), runtime: 'core' } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const ordre = [...files.filter((f) => f.startsWith('mjs_')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
  const coeur = readFileSync(join(outDir, files.find((f) => /^mjs_core-/.test(f))!), 'utf-8')
  return { script: ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;', coeur }
}

describe('cœur allégé — listes, blocs et clés au navigateur réel', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const moteur of MOTEURS) {
    it(`${moteur} : {for} à clé, {if}/{else}, {key}`, async function () {
      if (!(await moteurPresent(moteur))) this.skip()
      const { script, coeur } = await compiler()
      assert.equal(coeur.includes('prototype._mjs_tryReviveDying = function'), false, 'le cœur testé est bien le cœur allégé')
      const { browser, page, erreurs } = await ouvrirPage(moteur, '<mjs-hote></mjs-hote>', script)
      try {
        const lis = () => page.evaluate(() => [...(document.querySelector('mjs-hote') as any)._shadow.querySelectorAll('li')].map((li: any) => li.textContent).join())
        const clic = (sel: string) => page.evaluate((s: string) => (document.querySelector('mjs-hote') as any)._shadow.querySelector(s).click(), sel)
        const voit = (sel: string) => page.evaluate((s: string) => !!(document.querySelector('mjs-hote') as any)._shadow.querySelector(s), sel)
        await page.waitForFunction(() => !!(document.querySelector('mjs-hote') as any)?._shadow?.querySelector('li'))
        assert.equal(await lis(), 'a,b,c')
        await clic('.b1')
        await page.waitForFunction(() => [...(document.querySelector('mjs-hote') as any)._shadow.querySelectorAll('li')].map((li: any) => li.textContent).join() === 'c,a,d')
        await clic('.b2')
        await page.waitForFunction(() => !!(document.querySelector('mjs-hote') as any)._shadow.querySelector('.sinon'))
        assert.equal(await voit('.si'), false)
        await clic('.b2')
        await page.waitForFunction(() => !!(document.querySelector('mjs-hote') as any)._shadow.querySelector('.si'))
        assert.equal(await voit('.sinon'), false)
        await clic('.b3')
        await page.waitForFunction(() => (document.querySelector('mjs-hote') as any)._shadow.querySelector('.cle')?.textContent === '2')
        assert.equal(await lis(), 'c,a,d')
        assert.deepEqual(erreurs, [])
      }
      finally {
        await browser.close()
      }
    })
  }
})
