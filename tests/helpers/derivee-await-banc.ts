// banc des valeurs dérivées qui attendent (`$x = await f($q)`), dans happy-dom : le vrai Bundler (développement), le cœur et les
// composants dans une fenêtre, `fetch` remplacé par un faux qui note chaque requête et ne répond que sur ordre du test ; les appels
// `µ.warn` et `µ.error` du cœur notés (`__avis`, `__erreurs`)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler } from '../../src/bundler/index.js'
import { stripEsm } from '../../src/server/renderToString.js'
import { mjsTmp } from './tmp.js'

export const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

// le code de la construction (cœur d'abord) et le texte de chaque unité compilée ; `env` : 'prod' pour la construction de production,
// sans minification (les unités se lisent l'une après l'autre dans la même fenêtre : les noms courts y seraient en double)
export async function construire(prefixe: string, sources: Record<string, string>, env?: 'dev' | 'prod'): Promise<{ code: string, unites: string }> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(sources)) writeFileSync(join(srcDir, nom), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), ...(env === 'prod' ? { env, minify: false } : {}) })
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
  return { code: ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n'), unites: files.filter((f) => !f.startsWith('mjs_')).map((f) => readFileSync(join(outDir, f), 'utf-8')).join('\n') }
}

// le faux réseau, posé avant le cœur : chaque requête attend `reply` (une réponse JSON) ou `fail` (un échec du réseau)
const BANC = `
  globalThis.__req = [];
  globalThis.__avis = [];
  globalThis.__erreurs = [];
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

// la fenêtre, le cœur et les composants chargés, puis `corps` posé dans la page
export async function monter(prefixe: string, sources: Record<string, string>, corps: string, env?: 'dev' | 'prod'): Promise<any> {
  const { code } = await construire(prefixe, sources, env)
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  window.eval(BANC + code + '\nglobalThis.µ = µ;\nµ.warn = function(...a) { globalThis.__avis.push(a.map(String).join(" ")); };\nµ.error = function(...a) { globalThis.__erreurs.push(a.map(String).join(" ")); };')
  window.document.body.innerHTML = corps
  await pause(150)
  return window
}

// les adresses demandées, dans l'ordre ; `depuis` : à partir de la requête de ce rang ; tableaux recopiés hors de la fenêtre (`deepEqual` compare aussi le prototype)
export const demandes = (w: any, depuis = 0) => Array.from(w.__req.slice(depuis), (r: any) => String(r.url))

// répond à la première requête encore ouverte de cette adresse
export async function repondre(w: any, url: string, corps: any, echec = false) {
  const r = w.__req.find((x: any) => x.url === url && !x.fini && !x.aborted)
  assert.ok(r, 'aucune requête ouverte pour « ' + url + ' » — vues : ' + demandes(w).join(', '))
  if (echec) r.fail(corps)
  else r.reply(corps)
  await pause(60)
}

// le texte de l'ombre d'un composant, commentaires et feuilles de style retirés
export const ecran = (el: any) => (el && el._shadow ? el._shadow.innerHTML : '∅').replace(/<!--.*?-->/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/\s+/g, ' ').trim()
export const texte = (el: any, sel: string) => (el._shadow.querySelector(sel)?.textContent ?? '∅').trim()
