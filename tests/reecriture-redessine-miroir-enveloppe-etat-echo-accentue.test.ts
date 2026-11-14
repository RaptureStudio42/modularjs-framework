// `µrefresh($x)` redessine aussi un miroir (`µ.clone(…, { mirror: true })`), sans relancer d'effet ; le même objet réécrit par l'enveloppe de l'état
// (`Object.assign($, …)`) et l'écho d'une liaison `!{}` sur une variable au nom accentué restent muets : rien ne se redessine sur un changement que
// MJS n'a pas vu. Développement et production, avec et sans valeur dérivée dans l'appli ; happy-dom, Chromium, Firefox, WebKit

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const SOURCES: Record<string, string> = {
  // un objet changé hors de MJS, puis `µrefresh($o)` dans le miroir, puis dans l'original
  'rr-mir.mjs': `<script>
obj = {n: 1}
$o = obj
µeffect ->
  window.__rme = (window.__rme or 0) + 1
  window.__rmev = $o.n
@brut = -> obj.n += 1
@reaff = -> µrefresh($o)
@miroir = -> µ.clone(this, {mirror: true})
</script>
<p class="m">{$o.n}</p>
`,
  // le même objet réécrit par l'enveloppe de l'état : pour MJS, rien n'a changé
  'rr-etat.mjs': `<script>
obj = {n: 1}
$o = obj
µeffect ->
  window.__ree = (window.__ree or 0) + 1
  window.__reev = $o.n
@brut = -> obj.n += 1
@reaff = -> Object.assign($, {o: $o})
</script>
<p class="m">{$o.n}</p>
`,
  // l'enfant change par sa prop à sens unique l'objet qu'il reçoit aussi par la liaison, sous un nom accentué chez le parent
  'rr-annee.mjs': `<script>
$année = [{nom: 'a'}]
</script>

<@rr-enf items=!{$année} sel={$année[0]}>
<p class="etat">{$année[0].nom}</p>
`,
  'rr-enf.mjs': `<script>
@prendre = -> $sel.nom = $sel.nom + 'S'
@agir    = -> $items[0].nom = $items[0].nom + 'Z'
</script>
<p class="vu">{$sel ? $sel.nom : '-'}-{$items ? $items[0].nom : '-'}</p>
`,
}

// une unité qui porte une valeur dérivée : la précision n'entre au cœur de production qu'avec elle ; `µrefresh($x)` fait la même chose avec ou sans
const UNE_DERIVEE = '<script>\n  $a = 1\n  $double = $a * 2\n</script>\n<p>{$double}</p>\n'

const SCENARIO = `(async () => {
  const pause    = (ms) => new Promise((r) => setTimeout(r, ms))
  const attendre = async (f) => { for (let i = 0; i < 300 && !f(); i++) await pause(10) }
  const racine   = (el) => el._shadow || el.shadowRoot || el
  const txt      = (el, c) => { const n = el && racine(el).querySelector('.' + c); return n ? n.textContent : '?' }
  const neuf     = async (tag, c) => { const el = document.createElement(tag); document.body.appendChild(el); await attendre(() => txt(el, c) !== '?'); return el }
  const r = {}
  const m = await neuf('mjs-rr-mir', 'm')
  const c = m.miroir()
  document.body.appendChild(c)
  await attendre(() => txt(c, 'm') !== '?')
  await pause(50)
  const e0 = window.__rme
  m.brut(); await pause(50)
  const s = ['départ ' + txt(m, 'm') + ',' + txt(c, 'm')]
  c.reaff(); await pause(50)
  s.push('miroir ' + txt(m, 'm') + ',' + txt(c, 'm'))
  m.brut(); await pause(50); m.reaff(); await pause(50)
  s.push('original ' + txt(m, 'm') + ',' + txt(c, 'm'), 'effets ' + (window.__rme - e0))
  r.miroir = s.join(' → ')
  const t = await neuf('mjs-rr-etat', 'm')
  await pause(50)
  const f0 = window.__ree
  t.brut(); await pause(50)
  const u = ['départ ' + txt(t, 'm')]
  t.reaff(); await pause(50)
  u.push('enveloppe ' + txt(t, 'm'), 'effets ' + (window.__ree - f0))
  r.etat = u.join(' → ')
  const p = await neuf('mjs-rr-annee', 'etat')
  let k = null
  await attendre(() => (k = racine(p).querySelector('mjs-rr-enf')) && txt(k, 'vu') !== '?')
  await pause(50)
  k.agir(); await pause(50)
  k.prendre(); await pause(100)
  r.echo = 'parent ' + txt(p, 'etat') + ' enfant ' + txt(k, 'vu')
  return r
})()`

const ATTENDU = {
  // le miroir et l'original se redessinent tous deux, par l'un comme par l'autre ; aucun effet ne repart
  miroir: 'départ 1,1 → miroir 2,2 → original 3,3 → effets 0',
  // seul `µrefresh($x)` redessine : l'enveloppe ne fait rien
  etat: 'départ 1 → enveloppe 1 → effets 0',
  // le parent a vu la modification faite par la liaison (Z), pas celle faite par la prop à sens unique (S)
  echo: 'parent aZ enfant aZS-aZS',
}

async function construire(prod: boolean, derivee: boolean): Promise<string> {
  const root   = mjsTmp('reec-chemins')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, src] of Object.entries(derivee ? { ...SOURCES, 'une-derivee.mjs': UNE_DERIVEE } : SOURCES)) writeFileSync(join(srcDir, nom), src)
  // la précision des valeurs calculées est une option d'appli (`derived: "precise"`, mjs.config.json)
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

describe('`µrefresh($x)` redessine un miroir ; l\'enveloppe de l\'état qui réécrit le même objet et l\'écho d\'un nom accentué restent muets', function () {
  this.timeout(300000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const [prod, derivee] of [[false, false], [true, false], [false, true], [true, true]]) {
    describe(`${prod ? 'production' : 'développement'}, ${derivee ? 'avec' : 'sans'} valeur dérivée`, function () {
      let code: string
      before(async () => { code = await construire(prod, derivee) })

      it('happy-dom : miroir, enveloppe de l\'état et écho justes', async () => {
        const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
        window.eval(code)
        const r = await window.eval(SCENARIO)
        assert.deepEqual(JSON.parse(JSON.stringify(r)), ATTENDU)
        await window.happyDOM.close()
      })

      for (const moteur of ['chromium', 'firefox', 'webkit']) {
        it(`${moteur} : miroir, enveloppe de l'état et écho justes`, async function () {
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
