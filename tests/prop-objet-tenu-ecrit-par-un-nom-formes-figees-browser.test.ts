// dans Chromium, Firefox et WebKit, quatre réglages : une prop objet qui lit une clé du magasin et une variable, un rang calculé et des props
// étalées, une comparaison en tête d'un `&&` ou d'un `||` suivent l'écriture par un nom comme l'écriture directe
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const js  = (script: string[], gabarit: string) => ['<script lang="js">', ...script.map((l) => '  ' + l), '</script>', gabarit].join('\n')
const PAR = ['$o = { a: { b: { c: 0 } } };', '@nom = function(v) { const t = $o.a.b; t.c = v; };', '@direct = function(v) { $o.a.b.c = v; };', '@raf = function() { µrefresh($o); };']
const LISTE  = ['$list = [{ b: { c: 0 } }];', '@nom = function(v) { const t = $list[0].b; t.c = v; };', '@direct = function(v) { $list[0].b.c = v; };', '@raf = function() { µrefresh($list); };']
const FORMES: Array<[string, string, string[]]> = [['fa', '$list.length > 0 && $list[0]', LISTE], ['fb', '$n >= 0 && $o.a', PAR], ['fc', '$k === 1 || $o.a', PAR]]
const SOURCES: Record<string, string> = {
  ...Object.fromEntries(FORMES.map(([tag, e, par]) => [tag + '.mjs', js(['$n = 0;', '$k = 0;', ...par], `<@vn item={${e}}></@vn>`)])),
  'vn.mjs': js(['$item = null;'], "<em>{$item ? JSON.stringify($item) : '-'}</em>"),
  'mx.mjs': js(['$$s = { on: false, x: { n: 0 } };', ...PAR, '@nomS = function(v) { const t = $$s.x; t.n = v; };', '@rafS = function() { µrefresh($$s); };'], '<p>{$o.a.b.c}</p><@vn item={$$s.on ? $$s.x : $o.a}></@vn>'),
  'ix.mjs': js(['$rows = [{ x: { c: 0 } }, { x: { c: 0 } }];', '$i = 1;', '@nom = function(v) { const t = $rows[0].x; t.c = v; };', '@direct = function(v) { $rows[0].x.c = v; };', '@raf = function() { µrefresh($rows); };'], '<@vn item={$rows[$i - 1]}></@vn>'),
  'sp.mjs': js(['$p = { item: { b: { c: 0 } } };', '@nom = function(v) { const t = $p.item.b; t.c = v; };', '@direct = function(v) { $p.item.b.c = v; };', '@raf = function() { µrefresh($p); };'], '<@vn {...$p}></@vn>'),
}
const OUTILS   = "window.__ombre = (el) => el._shadow || el.shadowRoot || el; window.__tous = (r, tag, out = []) => { for (const e of Array.from(__ombre(r).querySelectorAll('*'))) { if (e.tagName === tag) out.push(e); if (e._shadow || e.shadowRoot) __tous(e, tag, out) } return out }; window.__txt = (el, sel = 'em') => __ombre(el).querySelector(sel)?.textContent ?? '?';"
const SCENARIO = (sans: boolean) => `(async () => {
  const tic = () => new Promise((r) => setTimeout(r, 30)), out = []
  const enf = (el) => __tous(el, 'MJS-VN').map((e) => __txt(e)).join(' / ')
  const mx = document.querySelector('mjs-mx'), ix = document.querySelector('mjs-ix'), sp = document.querySelector('mjs-sp')
  mx.nomS(1); ${sans ? 'mx.rafS();' : ''} await tic()
  mx.nom(5); ${sans ? 'mx.raf();' : ''} await tic(); out.push('magasin puis variable, nom(5) : ' + enf(mx))
  mx.direct(6); await tic(); out.push('magasin puis variable, direct(6) : ' + enf(mx))
  for (const [n, el] of [['rang calculé', ix], ['props étalées', sp], ...['fa', 'fb', 'fc'].map((t) => [t, document.querySelector('mjs-' + t)])]) { el.nom(5); ${sans ? 'el.raf();' : ''} await tic(); out.push(n + ', nom(5) : ' + enf(el)); el.direct(6); await tic(); out.push(n + ', direct(6) : ' + enf(el)) }
  return out
})()`
const ATTENDU = ['magasin puis variable, nom(5) : {"b":{"c":5}}', 'magasin puis variable, direct(6) : {"b":{"c":6}}', 'rang calculé, nom(5) : {"x":{"c":5}}', 'rang calculé, direct(6) : {"x":{"c":6}}', 'props étalées, nom(5) : {"b":{"c":5}}', 'props étalées, direct(6) : {"b":{"c":6}}', ...['fa', 'fb', 'fc'].flatMap((t) => [t + ', nom(5) : {"b":{"c":5}}', t + ', direct(6) : {"b":{"c":6}}'])]
const REGLAGES: Array<[string, any]> = [['développement', {}], ['production', { env: 'prod' }], ['production sans enveloppe', { env: 'prod', proxy: false }], ['développement sans enveloppe', { proxy: false }]]

async function construire(opts: any): Promise<string> {
  const root = mjsTmp('formes-figees-nav'), srcDir = join(root, 'src'), outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [f, s] of Object.entries(SOURCES)) writeFileSync(join(srcDir, f), s)
  const b  = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), minify: false, ...opts } as any)
  const st = await b.compile()
  await b.close()
  assert.deepEqual(st.errors.map((e: any) => e.message), [])
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  return [...files.filter((f) => f.startsWith('mjs_')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()].map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
}

describe('prop objet écrite par un nom : formes suivies, trois moteurs', function () {
  this.timeout(280000)
  after(async () => { await terminateSharedWorkerPool() })
  for (const [nom, opts] of REGLAGES) it(nom, async () => {
    const code = await construire(opts)
    const pw: any = await import('playwright')
    for (const moteur of ['chromium', 'firefox', 'webkit']) {
      const browser = await pw[moteur].launch(moteur === 'chromium' ? { args: ['--no-proxy-server'] } : {})
      try {
        const page = await browser.newPage()
        const err: string[] = []
        page.on('pageerror', (e: any) => err.push(String(e).slice(0, 150)))
        const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><mjs-mx></mjs-mx><mjs-ix></mjs-ix><mjs-sp></mjs-sp><mjs-fa></mjs-fa><mjs-fb></mjs-fb><mjs-fc></mjs-fc><script>${OUTILS}</script><script>${code}</script></body></html>`
        await page.route('http://mjs.test/**', (route: any) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }))
        await page.goto('http://mjs.test/')
        await page.waitForTimeout(150)
        const r = await page.evaluate(SCENARIO(opts.proxy === false))
        assert.deepEqual(err, [], `${moteur} : erreurs de la page`)
        assert.deepEqual(r, ATTENDU, `${moteur}, ${nom}`)
        await page.close()
      }
      finally {
        await browser.close()
      }
    }
  })
})
