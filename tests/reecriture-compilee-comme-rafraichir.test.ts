// `µrefresh($x)` redessine ce qui affiche `$x` et refait les valeurs dérivées qui le lisent, sans relancer d'effet ni prévenir le parent
// lié, en développement comme en production, avec ou sans valeur dérivée dans l'appli — dans une fonction, sans parenthèses, suivi d'une
// lecture, dans un gestionnaire, dans un `µeffect`, dans un enfant sur sa liaison ; `$x = $y` reste une écriture ; un magasin se signale
// par `µrefresh($$x)`. `$x = $x`, la variable écrite avec sa propre valeur, est refusé, jusque dans la passe d'écriture. Happy-dom,
// Chromium, Firefox, WebKit

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { transformReactiveWrites } from '../src/generator/transform-reactive.js'
import { mjsTmp } from './helpers/tmp.js'

const REFRESH = "µ._mjs_refresh(_mjsThis, 'o')"

describe('`$x = $x` refusé par la passe d\'écriture', function () {
  it('la variable écrite avec sa propre valeur, parenthèses comprises, lue ou non : refusée, avec la forme écrite à situer', () => {
    for (const src of ['$.o = $.o;\n', '$.o = ($.o);\n', 'f = function() { return $.o = $.o; };\n']) {
      assert.throws(() => transformReactiveWrites(src), (e: any) => /« \$o = \$o » est refusé/.test(e.message) && typeof e.mjsSelfWrite === 'string', src.trim())
    }
  })

  it('toute autre écriture reste une écriture', () => {
    for (const src of ['$.o = $.p;\n', '$.o = $.o.n;\n', '$.o = $.o || 1;\n', '$.o += $.o;\n', '$[k] = $[k];\n']) {
      const out = transformReactiveWrites(src)
      assert.ok(!out.includes('_mjs_refresh'), `${src.trim()} : ${out.trim()}`)
      assert.ok(out.includes('µ._set('), `${src.trim()} : ${out.trim()}`)
    }
  })
})

const SOURCES = (derivee: boolean): Record<string, string> => ({
  // un objet changé hors de MJS, puis `µrefresh($o)` écrit de chaque façon ; `$a = $b`, une écriture
  'rt-tout.mjs': `<script>
obj = {n: 1}
$o = obj
$t = 0
$a = 1
$b = 2
${derivee ? '$double = $o.n * 2\n' : ''}µeffect ->
  window.__rte = (window.__rte or 0) + 1
  window.__rtv = $o.n
µeffect ->
  window.__rta = (window.__rta or 0) + 1
  window.__rtav = $a
µeffect ->
  if $t > 0
    obj.n += 10
    µrefresh($o)
relire = -> µrefresh($o)
@brut = -> obj.n += 1
@fonction = -> relire()
@paren = -> µrefresh $o
@valeur = ->
  µrefresh($o)
  window.__rtval = $o.n
@lancer = -> $t = $t + 1
@copier = -> $a = $b
</script>
<p class="m">{$o.n}</p>
<p class="d">{${derivee ? '$double' : '$o.n * 2'}}</p>
<p class="a">{$a}</p>
<button class="b" @click={µrefresh($o)}>x</button>
`,
  // un magasin dont l'objet change hors de MJS
  'rt-mag.mjs': `<script>
$$rtcfg = {n: 1}
@brut = -> µread($$rtcfg).n += 1
@reaff = -> µrefresh($$rtcfg)
</script>
<p class="s">{$$rtcfg.n}</p>
`,
  // l'enfant réécrit l'objet qu'il reçoit par la liaison : il se redessine, le parent n'est pas prévenu
  'rt-par.mjs': `<script>
pobj = {n: 1}
$v = pobj
µeffect ->
  window.__rtp = (window.__rtp or 0) + 1
  window.__rtpv = $v.n
@brut = -> pobj.n += 1
</script>

<@rt-enf val=!{$v}>
<p class="pv">{$v.n}</p>
`,
  'rt-enf.mjs': `<script>
@reaff = -> µrefresh($val)
</script>
<p class="ev">{$val ? $val.n : '-'}</p>
`,
})

const SCENARIO = `(async () => {
  const pause    = (ms) => new Promise((r) => setTimeout(r, ms))
  const attendre = async (f) => { for (let i = 0; i < 300 && !f(); i++) await pause(10) }
  const racine   = (el) => el._shadow || el.shadowRoot || el
  const txt      = (el, c) => { const n = el && racine(el).querySelector('.' + c); return n ? n.textContent : '?' }
  const neuf     = async (tag, c) => { const el = document.createElement(tag); document.body.appendChild(el); await attendre(() => txt(el, c) !== '?'); return el }
  const r  = {}
  const m  = await neuf('mjs-rt-tout', 'm')
  await pause(50)
  const vu = () => txt(m, 'm') + '/' + txt(m, 'd')
  const e0 = window.__rte
  const s  = ['départ ' + vu()]
  m.brut(); await pause(30); s.push('brut ' + vu())
  m.fonction(); await pause(30); s.push('fonction ' + vu())
  m.brut(); m.paren(); await pause(30); s.push('sans parenthèses ' + vu())
  m.brut(); m.valeur(); await pause(30); s.push('valeur ' + vu() + ' lue ' + window.__rtval)
  m.brut(); racine(m).querySelector('.b').click(); await pause(30); s.push('gestionnaire ' + vu())
  m.lancer(); await pause(50); s.push('µeffect ' + vu(), 'effets ' + (window.__rte - e0))
  r.reecriture = s.join(' → ')
  const a0 = window.__rta
  m.copier(); await pause(30)
  r.ecriture = 'a ' + txt(m, 'a') + ' effets ' + (window.__rta - a0)
  const g = await neuf('mjs-rt-mag', 's')
  await pause(50)
  g.brut(); await pause(30)
  const g1 = txt(g, 's')
  g.reaff(); await pause(30)
  r.magasin = 'départ ' + g1 + ' → magasin ' + txt(g, 's')
  const p = await neuf('mjs-rt-par', 'pv')
  let k = null
  await attendre(() => (k = racine(p).querySelector('mjs-rt-enf')) && txt(k, 'ev') !== '?')
  await pause(50)
  const p0 = window.__rtp
  p.brut(); await pause(30)
  k.reaff(); await pause(50)
  r.parent = 'parent ' + txt(p, 'pv') + ' enfant ' + txt(k, 'ev') + ' effets ' + (window.__rtp - p0)
  return r
})()`

const ATTENDU = {
  // l'écran et la valeur dérivée suivent chaque `µrefresh($o)`, jamais le changement seul ; l'effet qui lit `$o` ne repart pas
  reecriture: 'départ 1/2 → brut 1/2 → fonction 2/4 → sans parenthèses 3/6 → valeur 4/8 lue 4 → gestionnaire 5/10 → µeffect 15/30 → effets 0',
  // `$a = $b` écrit : l'écran suit et l'effet qui lit `$a` repart
  ecriture: 'a 2 effets 1',
  magasin: 'départ 1 → magasin 2',
  parent: 'parent 1 enfant 2 effets 0',
}

async function construire(prod: boolean, derivee: boolean): Promise<string> {
  const root   = mjsTmp('reec-rafraichir')
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

describe('`µrefresh($x)` redessine, en développement et en production, avec et sans valeur dérivée', function () {
  this.timeout(300000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const [prod, derivee] of [[false, false], [true, false], [false, true], [true, true]]) {
    describe(`${prod ? 'production' : 'développement'}, ${derivee ? 'avec' : 'sans'} valeur dérivée`, function () {
      let code: string
      before(async () => { code = await construire(prod, derivee) })

      // en production, les noms internes sont raccourcis : le rendu, plus bas, en répond
      if (!prod) {
        it('construction : `µrefresh($o)` appelle le rafraîchissement', () => {
          assert.ok(code.includes(REFRESH), 'le composant appelle µ._mjs_refresh')
          assert.ok(!code.includes("µ._set(_mjsThis, 'o', $.o)"), 'aucune écriture de $o par elle-même')
        })
      }

      it('happy-dom : écran, valeurs, effets, magasin et parent justes', async () => {
        const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
        window.eval(code)
        const r = await window.eval(SCENARIO)
        assert.deepEqual(JSON.parse(JSON.stringify(r)), ATTENDU)
        await window.happyDOM.close()
      })

      for (const moteur of ['chromium', 'firefox', 'webkit']) {
        it(`${moteur} : écran, valeurs, effets, magasin et parent justes`, async function () {
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
