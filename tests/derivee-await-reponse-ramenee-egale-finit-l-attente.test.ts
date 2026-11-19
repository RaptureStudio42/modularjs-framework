// une réponse que le type du <vars> ramène sur la valeur déjà affichée (`$r int 0..100` montre 100, la réponse suivante vaut 300) :
// l'écriture ne change rien, mais l'attente finit aussi à l'écran — les lecteurs de `µpending($r)` et de `µfailed($r)` sont prévenus
// dans tous les cas. Développement et production (happy-dom, faux fetch tenu par le test)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { repondre, texte, pause } from './helpers/derivee-await-banc.js'

const BANC = `
  globalThis.__req = []; globalThis.__avis = []; globalThis.__erreurs = [];
  globalThis.fetch = function(url, o) {
    return new Promise(function(res, rej) {
      var r = { url: String(url).replace('http://localhost', ''), aborted: false, fini: false };
      r.reply = function(body) { r.fini = true; res(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })); };
      r.fail  = function(message) { r.fini = true; rej(new Error(message)); };
      if (o && o.signal) o.signal.addEventListener('abort', function() { r.aborted = true; rej(new DOMException('aborted', 'AbortError')); });
      __req.push(r);
    });
  };
`

async function monter(prefixe: string, sources: Record<string, string>, corps: string, prod: boolean): Promise<any> {
  const root   = mjsTmp(prefixe + (prod ? '-p' : '-d'))
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [n, s] of Object.entries(sources)) writeFileSync(join(srcDir, n), s)
  const opts  = prod ? { forceMinify: true, minimalRuntime: true, js: 'bundle', env: 'prod', manifestPath: join(outDir, 'bundle.js') } : { manifestPath: join(root, 'bundle.js') }
  const b     = new Bundler({ sourceDir: srcDir, outputDir: outDir, ...opts } as any)
  const stats = await b.compile()
  await b.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  let code: string
  if (prod) code = stripEsm(readFileSync(join(outDir, 'bundle.js'), 'utf-8'))
  else {
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    code = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))].map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  }
  const w: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  w.eval(BANC + code + '\nvar __m = globalThis.µ || (typeof µ !== "undefined" ? µ : null); globalThis.µ = __m; __m.warn = function(...a) { globalThis.__avis.push(a.map(String).join(" ")); }; __m.error = function(...a) { globalThis.__erreurs.push(a.map(String).join(" ")); };')
  // le mode des types que le manifeste pose dans une vraie page de développement
  if (!prod) w.µ._typesMode = 'warn'
  w.document.body.innerHTML = corps
  await pause(150)
  return w
}

const TYPEE = `<vars>
  $r int 0..100
</vars>
<script>
  $q = 0
  f  = (q) -> fetch("/api/e-#{q}").then((r) -> r.json())
  $r = await f($q)
  @chercher = (q) -> $q = q
</script>
<b class="v">{$r}</b><i class="att">{µpending($r)}</i><u class="err">{µfailed($r)?.message}</u>
`
const vu = (el: any) => texte(el, '.v') + '|' + texte(el, '.att') + '|' + (texte(el, '.err') !== '∅' && texte(el, '.err') ? 'erreur' : '')

describe('dérivée qui attend — réponse ramenée par le type sur la valeur affichée', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of [false, true]) {
    it((prod ? 'production' : 'développement') + ' : 100, puis 300 ramené à 100 — l\'attente finit à l\'écran', async () => {
      const w  = await monter('await-ramenee', { 'typee.mjs': TYPEE }, '<mjs-typee></mjs-typee>', prod)
      const el = w.document.querySelector('mjs-typee')
      await repondre(w, '/api/e-0', 100)
      assert.equal(vu(el), '100|false|')
      el.chercher(1)
      await pause(60)
      assert.equal(vu(el), '100|true|', 'l\'attente se voit')
      await repondre(w, '/api/e-1', 300)
      // en production, les noms internes du cœur sont raccourcis : l'écran seul se lit
      if (!prod) assert.equal(w.µ._mjs_awPending(el, 'r'), false, 'µpending($r) vaut faux')
      assert.equal(vu(el), '100|false|', 'l\'écran montre l\'attente finie')
      assert.deepEqual(Array.from(w.__erreurs), [], 'aucune erreur')
      w.close()
    })
  }
})
