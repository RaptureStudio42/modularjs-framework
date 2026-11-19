// `mjs dev` réel et trois navigateurs : seule la règle d'une variable dérivée change dans le <vars> (`$total int 0..200` devient
// `int 0..100`, `$total = $a * 2` inchangé). Les règles font partie de la nature du composant (hotNatureHash, bundler/transpile-msg.ts) :
// la page se recharge en entier, la valeur est calculée et jugée sous la nouvelle règle ; sortie de sa règle, le développement le dit une
// fois ; revenue dans sa règle, rien ; ressortie, de nouveau. La valeur affichée reste celle du calcul

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const cliPath  = join(repoRoot, 'src', 'cli.ts')

const FIRST_BUILD = /✅ \d+ fichiers en \d+ms/
const OUT_OF_RULE = /sort de sa règle|is outside its rule/

function startDev(root: string, port: number): Promise<{ kill(): Promise<void> }> {
  return new Promise((resolve, reject) => {
    // la CLI en TypeScript, lue par tsx chargé dans Node
    const proc = spawn(process.execPath, ['--import', 'tsx', cliPath, 'dev', '--root', root, '--port', String(port)], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    let done   = false
    const giveUp = setTimeout(() => {
      if (done) return
      done = true
      proc.kill('SIGKILL')
      reject(new Error(`'mjs dev' n'a jamais fini son premier build.\n${output}`))
    }, 60000)
    proc.stdout!.on('data', (d) => {
      output += String(d)
      if (done || !FIRST_BUILD.test(output)) return
      done = true
      clearTimeout(giveUp)
      resolve({ kill: () => new Promise((end) => {
        proc.once('close', () => end())
        proc.kill('SIGINT')
        setTimeout(() => proc.kill('SIGKILL'), 5000)
      }) })
    })
    proc.stderr!.on('data', (d) => { output += String(d) })
    proc.on('error', (e) => {
      if (done) return
      done = true
      clearTimeout(giveUp)
      reject(e)
    })
  })
}

const source = (rule: string) => `<vars>
  $total int ${rule}
</vars>

<script>
$a     = 80
$total = $a * 2
</script>

<b class="t">{$total}</b>
`

for (const engine of ['chromium', 'firefox', 'webkit'] as const) {
  describe('types — a derived value whose rule alone is edited under mjs dev is judged again under the new rule (' + engine + ')', function () {
    this.timeout(180000)

    it('rule tightened, loosened, tightened again: one warning each time the kept value leaves its rule, none in between', async function () {
      const playwright = await import('playwright')
      if (!existsSync(playwright[engine].executablePath())) { this.skip(); return }
      const root = mjsTmp('derived-hot-swap-' + engine)
      const src  = join(root, 'src')
      mkdirSync(src, { recursive: true })
      writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js' }))
      writeFileSync(join(root, 'index.html'), '<!doctype html><html lang="fr"><head><meta charset="utf-8"><script type="module" src="/modularjs/bundle.js"></script></head><body><mjs-total></mjs-total></body></html>')
      const write = (rule: string) => writeFileSync(join(src, 'total.mjs'), source(rule))
      write('0..200')
      const port    = 22000 + Math.floor(Math.random() * 8000)
      const dev     = await startDev(root, port)
      const browser = await playwright[engine].launch()
      try {
        const page = await browser.newPage()
        const errors: string[]   = []
        const warnings: string[] = []
        let loads = 0
        page.on('pageerror', (e: any) => errors.push(String(e).slice(0, 200)))
        page.on('console', (m: any) => {
          if (m.type() === 'error') errors.push('console ' + m.text().slice(0, 200))
          if (OUT_OF_RULE.test(m.text())) warnings.push(m.text())
        })
        page.on('load', () => loads++)
        const shown = () => page.evaluate(`document.querySelector('mjs-total')?._shadow?.querySelector('.t')?.textContent ?? '∅'`)
        // la règle modifiée prise par la page : rechargée (marque de la fenêtre perdue) ou échangée à chaud (l'instance porte un objet de
        // règles neuf), puis la valeur de nouveau affichée
        const edit = async (rule: string) => {
          await page.evaluate(`window.__before = 1; (window.__rules = new WeakSet()).add(document.querySelector('mjs-total')._mjs_types)`)
          write(rule)
          const end = Date.now() + 20000
          while (Date.now() < end) {
            if (await page.evaluate(`window.__before !== 1 || !window.__rules.has(document.querySelector('mjs-total')?._mjs_types)`).catch(() => false)) break
            await page.waitForTimeout(50)
          }
          while (Date.now() < end && await shown().catch(() => '∅') !== '160') await page.waitForTimeout(50)
          // le temps que l'avertissement atteigne la console
          await page.waitForTimeout(300)
        }
        await page.goto(`http://127.0.0.1:${port}/`)
        const end = Date.now() + 20000
        while (Date.now() < end && await shown() !== '160') await page.waitForTimeout(50)
        assert.equal(await shown(), '160')
        await page.waitForTimeout(300)
        assert.deepEqual(warnings, [], 'dans sa règle : rien à dire')
        await edit('0..100')
        assert.equal(warnings.length, 1, 'règle resserrée : un avertissement — ' + warnings.join(' | '))
        assert.ok(warnings[0].includes('$total') && warnings[0].includes('160') && warnings[0].includes('0..100'), warnings[0])
        await edit('0..200')
        assert.equal(warnings.length, 1, 'revenue dans sa règle : rien — ' + warnings.join(' | '))
        await edit('0..150')
        assert.equal(warnings.length, 2, 'ressortie : de nouveau — ' + warnings.join(' | '))
        assert.equal(await shown(), '160', 'la valeur affichée reste celle du calcul')
        // une règle changée recharge la page : si elle passe un jour à chaud, la valeur gardée doit être rejugée à la fin de l'échange
        // (_mjsHotRebuild, mjs_hotswap.ts, dans un bloc <derived-check>), sans quoi ce test le dira par ses avertissements
        // au moins un chargement par règle changée (Firefox en fait parfois un de plus)
        assert.ok(loads >= 4, `chaque règle changée recharge la page : ${loads} chargements — ` + errors.join(' | '))
        assert.deepEqual(errors, [], 'aucune erreur')
      }
      finally {
        await browser.close()
        await dev.kill()
      }
    })
  })
}
