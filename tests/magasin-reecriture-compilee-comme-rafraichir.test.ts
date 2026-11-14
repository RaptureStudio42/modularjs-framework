// `µrefresh($$x)` fait pour un magasin ce que `µrefresh($x)` fait pour une
// variable : juste après un changement fait hors de MJS dans l'objet que tient la clé (`µread($$x).n += 1`), ce qui lit la clé se
// redessine, dans chaque composant qui la lit, et les valeurs dérivées qui la lisent se refont ; aucun reffet ne repart, ni d'un composant
// ni du fichier d'un magasin. Écrit dans une fonction, sans parenthèses, suivi d'une lecture, dans un gestionnaire ou dans le fichier
// d'un magasin ; `$$a = $$b` reste une écriture. Développement et production, avec et sans valeur dérivée ; happy-dom, Chromium,
// Firefox, WebKit

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const SOURCES = (derivee: boolean): Record<string, string> => ({
  // l'objet de `$$rtcfg` changé hors de MJS, puis `µrefresh($$rtcfg)` écrit de chaque façon ; `$$rtn = $$rtm`, une écriture
  'rt-mag.mjs': `<script>
@import µ$$rtmod 'rt-magmod.module.civet.mjs'
$$rtcfg = {n: 1}
$$rtm = 5
$$rtn = 0
${derivee ? '$d = $$rtcfg.n * 2\n' : ''}µeffect ->
  window.__rgE = (window.__rgE or 0) + 1
  window.__rgV = $$rtcfg.n
µeffect ->
  window.__rgN = (window.__rgN or 0) + 1
  window.__rgNV = $$rtn
relire = -> µrefresh($$rtcfg)
@brut = -> µread($$rtcfg).n += 1
@fonction = -> relire()
@paren = -> µrefresh $$rtcfg
@valeur = ->
  µrefresh($$rtcfg)
  window.__rgval = $$rtcfg.n
@copier = -> $$rtn = $$rtm
@module = -> µ$$rtmod.v
</script>
<p class="s">{$$rtcfg.n}</p>
<p class="d">{${derivee ? '$d' : '$$rtcfg.n * 2'}}</p>
<p class="n">{$$rtn}</p>
<button class="b" @click={µrefresh($$rtcfg)}>x</button>
`,
  // un autre composant qui lit la clé, avec son reffet
  'rt-lec.mjs': `<script>
${derivee ? '$e = $$rtcfg.n * 3\n' : ''}µeffect ->
  window.__rhE = (window.__rhE or 0) + 1
  window.__rhV = $$rtcfg.n
</script>
<p class="l">{$$rtcfg.n}</p>
<p class="e">{${derivee ? '$e' : '$$rtcfg.n * 3'}}</p>
`,
  // le fichier d'un magasin : son reffet suit la clé, sa fonction la signale
  'rt-magmod.module.civet.mjs': `export µ$$rtmod = { v: 0 }

µeffect ->
  window.__rmE = (window.__rmE or 0) + 1
  window.__rmV = $$rtcfg?.n

window.__rmToucher = -> µrefresh($$rtcfg)
`,
})

const SCENARIO = `(async () => {
  const pause    = (ms) => new Promise((r) => setTimeout(r, ms))
  const attendre = async (f) => { for (let i = 0; i < 300 && !f(); i++) await pause(10) }
  const racine   = (el) => el._shadow || el.shadowRoot || el
  const txt      = (el, c) => { const n = el && racine(el).querySelector('.' + c); return n ? n.textContent : '?' }
  const neuf     = async (tag, c) => { const el = document.createElement(tag); document.body.appendChild(el); await attendre(() => txt(el, c) !== '?'); return el }
  const r  = {}
  const g  = await neuf('mjs-rt-mag', 's')
  const h  = await neuf('mjs-rt-lec', 'l')
  await pause(50)
  const vu = () => txt(g, 's') + '/' + txt(g, 'd') + ' ' + txt(h, 'l') + '/' + txt(h, 'e')
  const e0 = window.__rgE, h0 = window.__rhE, m0 = window.__rmE
  const s  = ['départ ' + vu()]
  g.brut(); await pause(30); s.push('brut ' + vu())
  g.fonction(); await pause(30); s.push('fonction ' + vu())
  g.brut(); g.paren(); await pause(30); s.push('parenthèses ' + vu())
  g.brut(); g.valeur(); await pause(30); s.push('valeur ' + vu() + ' lue ' + window.__rgval)
  g.brut(); racine(g).querySelector('.b').click(); await pause(30); s.push('gestionnaire ' + vu())
  g.brut(); window.__rmToucher(); await pause(30); s.push('magasin ' + vu())
  s.push('reffets ' + (window.__rgE - e0) + ' ' + (window.__rhE - h0) + ' ' + (window.__rmE - m0))
  r.reecriture = s.join(' → ')
  const n0 = window.__rgN
  g.copier(); await pause(30)
  r.ecriture = 'n ' + txt(g, 'n') + ' reffet ' + (window.__rgN - n0)
  return r
})()`

const ATTENDU = {
  // les deux composants et leurs valeurs dérivées suivent chaque `µrefresh($$rtcfg)`, jamais le changement seul ; aucun reffet ne repart
  reecriture: 'départ 1/2 1/3 → brut 1/2 1/3 → fonction 2/4 2/6 → parenthèses 3/6 3/9 → valeur 4/8 4/12 lue 4 → gestionnaire 5/10 5/15 → magasin 6/12 6/18 → reffets 0 0 0',
  // `$$rtn = $$rtm` écrit : l'écran suit et le reffet qui lit `$$rtn` repart
  ecriture: 'n 5 reffet 1',
}

async function construire(prod: boolean, derivee: boolean): Promise<string> {
  const root   = mjsTmp('mag-rafraichir')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, src] of Object.entries(SOURCES(derivee))) writeFileSync(join(srcDir, nom), src)
  const opts: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), derivedMode: 'precise' }
  if (prod) Object.assign(opts, { urlPrefix: '/out', env: 'prod', js: 'bundle' })
  const bundler = new Bundler(opts)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [])
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
  return prod
    ? readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
    : ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
}

describe('`µrefresh($$x)` redessine le magasin, en développement et en production, avec et sans valeur dérivée', function () {
  this.timeout(300000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const [prod, derivee] of [[false, false], [true, false], [false, true], [true, true]]) {
    describe(`${prod ? 'production' : 'développement'}, ${derivee ? 'avec' : 'sans'} valeur dérivée`, function () {
      let code: string
      before(async () => { code = await construire(prod, derivee) })

      // en production, les noms internes sont raccourcis : le rendu, plus bas, en répond
      if (!prod) {
        it('construction : chaque `µrefresh($$rtcfg)` appelle le rafraîchissement du magasin', () => {
          const n = code.split('µ._mjs_storeRefresh("rtcfg")').length - 1
          assert.ok(n >= 5, `fonction, parenthèses, valeur lue, gestionnaire et fichier du magasin : ${n} appel(s)`)
        })
      }

      it('happy-dom : écrans, valeurs dérivées et reffets justes', async () => {
        const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
        window.eval(code)
        const r = await window.eval(SCENARIO)
        assert.deepEqual(JSON.parse(JSON.stringify(r)), ATTENDU)
        await window.happyDOM.close()
      })

      for (const moteur of ['chromium', 'firefox', 'webkit']) {
        it(`${moteur} : écrans, valeurs dérivées et reffets justes`, async function () {
          const playwright: any = await import('playwright')
          if (!existsSync(playwright[moteur].executablePath())) return this.skip()
          const browser = await playwright[moteur].launch(moteur === 'chromium' ? { args: ['--no-proxy-server'] } : {})
          try {
            const page = await browser.newPage()
            const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>${code.replace(/<\/script/g, '<\\/script')}</script></body></html>`
            await page.route('http://mjs.test/**', (r: any) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }))
            await page.goto('http://mjs.test/')
            assert.deepEqual(await page.evaluate(SCENARIO), ATTENDU)
          }
          finally {
            await browser.close()
          }
        })
      }
    })
  }
})
