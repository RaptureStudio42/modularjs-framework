// une liste ou un objet GELÉ (Object.freeze) qui demande une conversion sous une règle du `<vars>` (`int[]`, champ `int`) : la variable reçoit
// la valeur convertie, sans erreur, et la valeur reçue reste intacte. Vrai navigateur : le bundle y est un module, donc en mode strict, où
// une écriture sur une valeur gelée lève (happy-dom évalue le code hors du mode strict, où la même écriture échoue en silence)
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'

const ENVS  = ['dev', 'prod'] as const
const NOTES = `<vars>
  $notes int[]
  $fiche
    nom  string
    age  int
</vars>
<script>
  $notes = [1]
  $fiche = { nom: 'Ada', age: 3 }
  @poser  = (l) -> $notes = l
  @ficher = (o) -> $fiche = o
</script>
<p class="n">{$notes.join(',')}</p><p class="f">{$fiche.nom} {$fiche.age}</p><p class="t">{typeof $notes[0]} {typeof $fiche.age}</p>
`

// le fichier de la sortie que demande une adresse de la page (le bundle, un morceau)
function fichier(sortie: string, chemin: string): string | null {
  const segs = chemin.split('/').filter(Boolean)
  for (let i = 0; i < segs.length; i++) {
    const f = join(sortie, ...segs.slice(i))
    if (existsSync(f) && statSync(f).isFile()) return f
  }
  return null
}

describe('types du <vars> : une valeur gelée à convertir, en mode strict — chromium', function () {
  this.timeout(120000)
  let browser: any
  before(async function () {
    const playwright: any = await import('playwright')
    browser = await playwright.chromium.launch()
  })
  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const env of ENVS) it(`${env} : liste et objet gelés convertis dans une copie, sans erreur, la valeur reçue intacte`, async () => {
    const dir = join(mjsTmp('types-valeur-figee'), env)
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src', 'notes.mjs'), NOTES)
    writeFileSync(join(dir, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'public/mjs', manifestPath: 'public/mjs/bundle.js', js: 'split' }))
    const found   = findConfig(dir)
    const bundler = new Bundler({ ...resolveBundlerOpts(found!.config, found!.configDir), env } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const ctx  = await browser.newContext()
    const page = await ctx.newPage()
    const erreurs: string[] = []
    page.on('pageerror', (e: any) => erreurs.push('page : ' + String(e.message).slice(0, 160)))
    await page.route('http://page.test/**', async (route: any) => {
      const url = new URL(route.request().url())
      if (url.pathname === '/') return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-notes></mjs-notes>\n<script type="module" src="/mjs/bundle.js"></script></body></html>' })
      const f = fichier(join(dir, 'public/mjs'), url.pathname) || fichier(join(dir, 'public'), url.pathname)
      if (!f) return route.fulfill({ status: 404, body: '' })
      return route.fulfill({ status: 200, contentType: f.endsWith('.json') ? 'application/json' : f.endsWith('.css') ? 'text/css' : 'text/javascript', body: readFileSync(f) })
    })
    try {
      await page.goto('http://page.test/')
      await page.waitForFunction(() => { const e: any = document.querySelector('mjs-notes'); return !!(e && e._shadow && e._shadow.querySelector('.t')) }, null, { timeout: 10000 })
      const vu = await page.evaluate(async () => {
        const el: any = document.querySelector('mjs-notes'), out: string[] = []
        const liste   = Object.freeze(['2', '3']), objet = Object.freeze({ nom: 'Bob', age: '7' })
        try { el.poser(liste); out.push('liste gelée : passe') } catch (e: any) { out.push('liste gelée : LÈVE ' + e.constructor.name) }
        try { el.ficher(objet); out.push('objet gelé : passe') } catch (e: any) { out.push('objet gelé : LÈVE ' + e.constructor.name) }
        await new Promise((r) => setTimeout(r, 80))
        const o = el._shadow
        out.push('écran : ' + o.querySelector('.n').textContent + ' / ' + o.querySelector('.f').textContent + ' / ' + o.querySelector('.t').textContent)
        out.push('reçu : ' + JSON.stringify(liste) + ' ' + JSON.stringify(objet) + ' gelés=' + (Object.isFrozen(liste) && Object.isFrozen(objet)))
        return out
      })
      assert.deepEqual(vu, ['liste gelée : passe', 'objet gelé : passe', 'écran : 2,3 / Bob 7 / number number', 'reçu : ["2","3"] {"nom":"Bob","age":"7"} gelés=true'])
      assert.deepEqual(erreurs, [])
    }
    finally {
      await ctx.close()
    }
  })
})
