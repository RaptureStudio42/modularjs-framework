// un enfant léger (`:lightDom`) sorti de son parent au moment où l'on retire ce parent (`p.remove(); zone2.append(c)`) garde
// ses références `:this` : la collecte des marques du parent ne prend que les siennes (parent léger ou à ombre, avec ses propres
// `:this`) ; un `{if}` qui retire ensuite une balise vide sa référence ; retiré pour de bon, tout est vidé — trouvé par le contrôle
// du lot V411-DEPLACE, trois moteurs, développement et production
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const SOURCES: Record<string, string> = {
  'fiche.mjs': `<script>
  el = null
  puce = null
  fixe = null
  $montre = true
  note = (quoi) -> window.__journal.push(quoi)
  etat = -> (if el then 'la' else 'vide') + '/' + (if puce then 'la' else 'vide') + '/' + (if fixe then 'la' else 'vide')
  @vu = -> etat()
  @cacher = -> $montre = false
  µeffect ->
    note('effet')
    -> note('fin-effet')
  µsleep -> note('sleep')
  µawake -> note('awake')
  µdestroy -> note('destroy:' + etat())
</script>

{if $montre}<b :this=!{el}>x</b><@puce :this=!{puce}></@puce>{end}
<span class="fixe" :this=!{fixe} :attach={(n) -> note('attache'); -> note('detache')}>y</span>
`,
  'simple.mjs': `<script>
  el = null
  puce = null
  fixe = null
  $montre = true
  @vu = -> (if el then 'la' else 'vide') + '/' + (if puce then 'la' else 'vide') + '/' + (if fixe then 'la' else 'vide')
  @cacher = -> $montre = false
</script>

{if $montre}<b :this=!{el}>x</b><@puce :this=!{puce}></@puce>{end}
<span class="fixe" :this=!{fixe}>y</span>
`,
  'puce.mjs': `<script>
  i = null
  @vu = -> if i then 'la' else 'vide'
</script>
<i :this=!{i}>p</i>
`,
  'parents.mjs': `<script>
  pi = null
  @vu = -> if pi then 'la' else 'vide'
</script>
<i :this=!{pi}>pp</i><@simple :lightDom></@simple>
`,
  'parentn.mjs': `<p>pp</p><@simple :lightDom></@simple>
`,
  'parentl.mjs': `<script>
  pi = null
  @vu = -> if pi then 'la' else 'vide'
</script>
<i :this=!{pi}>pp</i><@simple :lightDom></@simple>
`
}

async function scene() {
  const w: any = window
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const zone: any = document.getElementById('zone')
  const zone2: any = document.getElementById('zone2')
  const refs = (x: any) => x._mjs_attachments ? [...x._mjs_attachments].filter((t: any) => t._mjs_ref).length : 0
  const marques = (x: any) => [...x.querySelectorAll('*')].filter((e: any) => e._mjs_ref_td).length
  w.__journal = []
  zone.innerHTML = '<mjs-parentl id="pl" mjs-light></mjs-parentl><mjs-parents id="ps"></mjs-parents><mjs-parentn id="pn" mjs-light></mjs-parentn>'
  const enfant = (p: any) => (p._shadow || p.shadowRoot || p).querySelector('mjs-simple')
  const ids = ['pl', 'ps', 'pn']
  const pret = () => ids.every((id) => { const c = enfant(document.getElementById(id)); return c && typeof c.vu === 'function' && c.vu() === 'la/la/la' })
  for (let i = 0; i < 200 && !pret(); i++) await pause(20)
  await pause(60)
  const r: Record<string, unknown> = { pret: pret() }
  for (const id of ids) {
    const p: any = document.getElementById(id); const c: any = enfant(p)
    const avant = [c.vu(), refs(c), marques(c)]
    p.remove(); zone2.append(c)
    const synchro = marques(c)
    await Promise.resolve(); await Promise.resolve()
    const apresMicro = [c.isConnected, refs(c), marques(c)]
    await pause(60)
    c.cacher(); await pause(60)
    const ferme = [c.vu(), refs(c), marques(c)]
    c.remove(); await pause(60)
    r[id] = { avant, synchro, apresMicro, blocFerme: ferme, retire: [c.vu(), refs(c), marques(c)] }
  }
  return r
}

describe('enfant léger sorti d\'un parent retiré : ses références :this restent les siennes', function () {
  this.timeout(240000)
  const scripts: Record<string, string> = {}
  before(async () => {
    for (const env of ['dev', 'prod'] as const) {
      const root = mjsTmp('ctl-leger-' + env); const srcDir = join(root, 'src'); const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      for (const [f, s] of Object.entries(SOURCES)) writeFileSync(join(srcDir, f), s)
      const prod = env === 'prod'
      const opts: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(prod ? outDir : root, 'bundle.js') }
      if (prod) Object.assign(opts, { env: 'prod', js: 'bundle', minify: false })
      const bundler = new Bundler(opts); const stats = await bundler.compile(); await bundler.close()
      if (stats.errors.length) throw new Error(stats.errors.map((x: any) => x.message).join('\n'))
      if (prod) { scripts[env] = readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '') + '\nglobalThis.µ = µ;'; continue }
      const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
      const ordre = [...files.filter((f) => f.startsWith('mjs_')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
      scripts[env] = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    }
  })
  after(async () => { await terminateSharedWorkerPool() })
  for (const moteur of ['chromium', 'firefox', 'webkit'] as const) {
    for (const env of ['dev', 'prod'] as const) {
      it(`${moteur}, ${env}`, async function () {
        const playwright: any = await import('playwright')
        if (!existsSync(playwright[moteur].executablePath())) this.skip()
        const navigateur = await playwright[moteur].launch()
        try {
          const page = await navigateur.newPage(); const exceptions: string[] = []
          page.on('pageerror', (x: any) => exceptions.push(x.message))
          await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body><div id="zone"></div><div id="zone2"></div><script>${scripts[env]}</script></body></html>`, { waitUntil: 'load' })
          const vu = await page.evaluate(scene)
          assert.equal(vu.pret, true, JSON.stringify(vu))
          for (const id of ['pl', 'ps', 'pn']) {
            const r: any = vu[id]
            assert.equal(r.blocFerme[0], 'vide/vide/la', `${id} : le {if} fermé vide les références de ses balises — ${JSON.stringify(r)}`)
            assert.deepEqual(r.retire, ['vide/vide/vide', 0, 0], `${id} : retiré pour de bon, tout est vidé — ${JSON.stringify(r)}`)
          }
          assert.deepEqual(exceptions, [])
        }
        finally { await navigateur.close() }
      })
    }
  }
})
