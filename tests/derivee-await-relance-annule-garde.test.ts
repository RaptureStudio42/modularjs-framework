// `$resultats = await rechercher($q)` : une valeur dérivée qui attend. Quand `$q` change, la fonction est rappelée ; la demande
// d'avant est annulée (`µsignal`) ; `$resultats` garde sa valeur pendant l'attente, que `µpending($resultats)` dit ; une réponse
// arrivée après une demande plus neuve n'est jamais montrée ; l'erreur se lit par `µfailed($resultats)`, la valeur d'avant reste ;
// une autre écriture du composant ne rappelle rien ; le composant qui quitte la page annule sa demande et n'écrit plus rien. Le
// module n'entre au cœur que si une dérivée attend. Rendu serveur : la page attend la réponse, sa valeur part dans `#__mjs_store`
// avec le nombre de composants servis qui la lisent, et le composant de la page servie la reprend sans rappeler la fonction.
// Méthode : le vrai Bundler (développement), le cœur et les composants dans happy-dom, `fetch` remplacé par un faux qui note
// chaque requête et ne répond que sur ordre du test.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm, renderToString } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function construire(prefixe: string, sources: Record<string, string>): Promise<{ code: string, coeur: string }> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(sources)) writeFileSync(join(srcDir, nom), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
  const coeur = files.find((f) => f.startsWith('mjs_core'))
  return { code: ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n'), coeur: coeur ? readFileSync(join(outDir, coeur), 'utf-8') : '' }
}

// le faux réseau, posé avant le cœur : chaque requête attend `reply` (une réponse JSON) ou `fail` (un échec du réseau)
const BANC = `
  globalThis.__req = [];
  globalThis.__avis = [];
  globalThis.fetch = function(url, o) {
    return new Promise(function(res, rej) {
      var r = { url: String(url), aborted: false };
      r.reply = function(body) { res(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })); };
      r.fail  = function(message) { rej(new Error(message)); };
      if (o && o.signal) o.signal.addEventListener('abort', function() { r.aborted = true; rej(new DOMException('aborted', 'AbortError')); });
      __req.push(r);
    });
  };
`

async function monter(prefixe: string, sources: Record<string, string>, corps: string): Promise<any> {
  const { code } = await construire(prefixe, sources)
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  window.eval(BANC + code + '\nglobalThis.µ = µ;\nµ.warn = function(...a) { globalThis.__avis.push(a.map(String).join(" ")); };')
  window.document.body.innerHTML = corps
  await pause(150)
  return window
}

// les requêtes vues pour le texte `q` ; `ouvertes` : celles qui attendent encore (ni répondues, ni en échec, ni annulées)
const requetes = (w: any, q: string, ouvertes = false) => w.__req.filter((r: any) => r.url.replace('http://localhost', '') === '/api/search?q=' + q && (!ouvertes || (!r.fini && !r.aborted)))
async function repondre(w: any, q: string, corps: any, echec = false) {
  const r = requetes(w, q, true)[0]
  assert.ok(r, 'aucune requête ouverte pour « ' + q + ' » — vues : ' + w.__req.map((x: any) => x.url).join(', '))
  r.fini = true
  if (echec) r.fail(corps)
  else r.reply(corps)
  await pause(60)
}
const ombre = (el: any) => el._shadow
const texte = (el: any, sel: string) => (ombre(el).querySelector(sel)?.textContent ?? '∅').trim()
const liste = (el: any) => Array.from(ombre(el).querySelectorAll('li')).map((l: any) => l.textContent.trim()).join(',')
const vue   = (el: any) => ({ liste: liste(el), attente: texte(el, '.att'), erreur: texte(el, '.err') })

// `signal` : la fonction reçoit `µsignal`, la demande dépassée est annulée ; sans lui, elle va au bout et sa réponse est ignorée
const RECHERCHE = (signal: boolean) => `<script>
  $q         = ''
  $autre     = 0
  rechercher = (q, signal) -> fetch("/api/search?q=#{q}", { signal }).then((r) -> r.json())
  $resultats = await rechercher($q${signal ? ', µsignal' : ''})
  @chercher  = (q) -> $q = q
  @toucher   = -> $autre++
</script>
<ul>{for r in ($resultats or []) by id}<li>{r.pseudo}</li>{end}</ul>
<i class="att">{µpending($resultats)}</i><b class="err">{µfailed($resultats)?.message}</b><s class="autre">{$autre}</s>
`
const SOURCES = { 'avec-signal.mjs': RECHERCHE(true), 'sans-signal.mjs': RECHERCHE(false) }

describe('dérivée qui attend — `$resultats = await rechercher($q)`', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('le module part au cœur avec une dérivée qui attend, jamais sans', async () => {
    const avec = await construire('await-derivee-avec', { 'avec-signal.mjs': RECHERCHE(true) })
    assert.ok(/_mjs_setAwait = /.test(avec.coeur), 'le module des dérivées qui attendent manque au cœur d\'une appli qui en écrit')
    const sans = await construire('await-derivee-sans', { 'simple.mjs': `<script>\n  $q = ''\n  $n = $q.length\n</script>\n<p>{$n}</p>\n` })
    assert.ok(!/_mjs_setAwait/.test(sans.coeur), 'le module des dérivées qui attendent part dans une appli qui n\'en écrit pas')
  })

  it('la scène : attente, réponse, relance quand $q change, demande d\'avant annulée, valeur gardée, erreur dite', async () => {
    const w  = await monter('await-derivee-scene', SOURCES, '<mjs-avec-signal></mjs-avec-signal>')
    const el = w.document.querySelector('mjs-avec-signal')
    assert.equal(requetes(w, '').length, 1, 'une demande au départ')
    assert.deepEqual(vue(el), { liste: '', attente: 'true', erreur: '' }, 'au départ : rien, en cours')
    await repondre(w, '', [{ id: 1, pseudo: 'Ann' }])
    assert.deepEqual(vue(el), { liste: 'Ann', attente: 'false', erreur: '' }, 'la réponse arrive')
    el.toucher()
    await pause(60)
    assert.equal(texte(el, '.autre'), '1')
    assert.equal(w.__req.length, 1, 'une écriture sans rapport ne rappelle pas la fonction')
    el.chercher('b')
    await pause(60)
    assert.equal(requetes(w, 'b', true).length, 1, '$q change : la fonction est rappelée')
    assert.deepEqual(vue(el), { liste: 'Ann', attente: 'true', erreur: '' }, 'pendant l\'attente, la valeur d\'avant reste')
    el.chercher('bo')
    await pause(60)
    assert.equal(requetes(w, 'b')[0].aborted, true, 'la demande dépassée est annulée')
    await repondre(w, 'bo', [{ id: 2, pseudo: 'Bob' }])
    assert.deepEqual(vue(el), { liste: 'Bob', attente: 'false', erreur: '' })
    el.chercher('x')
    await pause(60)
    await repondre(w, 'x', 'serveur en panne', true)
    assert.deepEqual(vue(el), { liste: 'Bob', attente: 'false', erreur: 'serveur en panne' }, 'l\'erreur se lit, la valeur d\'avant reste')
    el.chercher('y')
    await pause(60)
    await repondre(w, 'y', [{ id: 3, pseudo: 'Yan' }])
    assert.deepEqual(vue(el), { liste: 'Yan', attente: 'false', erreur: '' }, 'une réponse efface l\'erreur')
    assert.equal(w.__avis.length, 0, 'aucun avertissement — ' + w.__avis.join(' | '))
    w.close()
  })

  it('sans µsignal : la réponse arrivée après une demande plus neuve n\'est jamais montrée', async () => {
    const w  = await monter('await-derivee-retard', SOURCES, '<mjs-sans-signal></mjs-sans-signal>')
    const el = w.document.querySelector('mjs-sans-signal')
    await repondre(w, '', [{ id: 1, pseudo: 'Ann' }])
    el.chercher('a')
    await pause(60)
    el.chercher('ab')
    await pause(60)
    assert.equal(requetes(w, 'a')[0].aborted, false, 'sans µsignal, rien n\'est annulé')
    await repondre(w, 'ab', [{ id: 2, pseudo: 'Abel' }])
    assert.deepEqual(vue(el), { liste: 'Abel', attente: 'false', erreur: '' })
    await repondre(w, 'a', [{ id: 9, pseudo: 'Vieux' }])
    assert.deepEqual(vue(el), { liste: 'Abel', attente: 'false', erreur: '' }, 'la réponse dépassée, arrivée en dernier, n\'écrase rien')
    w.close()
  })

  it('le composant quitte la page pendant l\'attente : sa demande est annulée, une réponse tardive n\'écrit rien', async () => {
    const w   = await monter('await-derivee-depart', SOURCES, '<mjs-avec-signal></mjs-avec-signal><mjs-sans-signal></mjs-sans-signal>')
    const el1 = w.document.querySelector('mjs-avec-signal')
    const el2 = w.document.querySelector('mjs-sans-signal')
    await repondre(w, '', [{ id: 1, pseudo: 'Ann' }])
    await repondre(w, '', [{ id: 1, pseudo: 'Ann' }])
    el1.chercher('z')
    el2.chercher('t')
    await pause(60)
    el1.remove()
    el2.remove()
    await pause(60)
    assert.equal(requetes(w, 'z')[0].aborted, true, 'la demande du composant parti est annulée')
    await repondre(w, 't', [{ id: 4, pseudo: 'Tard' }])
    assert.equal(liste(el2), 'Ann', 'la réponse arrivée après le départ n\'écrit rien')
    assert.deepEqual(el2._state.resultats, [{ id: 1, pseudo: 'Ann' }])
    assert.equal(w.__avis.length, 0, 'aucun avertissement — ' + w.__avis.join(' | '))
    w.close()
  })

  it('rendu serveur : la page attend la réponse, sa valeur part dans #__mjs_store ; le navigateur la reprend sans rappeler la fonction', async () => {
    const SERVI = `<script module>
  plusTard = (valeur, ms) -> new Promise((tenir) -> setTimeout((-> tenir(valeur)), ms))
</script>
<script>
  $q         = 'ad'
  rechercher = (q) ->
    globalThis.__appels = (globalThis.__appels or 0) + 1
    plusTard([{ id: 1, pseudo: 'Ada' }], 40)
  $resultats = await rechercher($q)
</script>
<ul>{for r in ($resultats or []) by id}<li>{r.pseudo}</li>{end}</ul>
`
    const root   = mjsTmp('await-derivee-ssr')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'servi.mjs'), SERVI)
    const res: any = await renderToString({ sourceDir: srcDir, outputDir: join(root, 'out'), tag: 'mjs-servi', settleMs: 2000 } as any)
    assert.match(res.html, /Ada/, 'le rendu serveur attend la réponse de la dérivée')
    const balise = /id=["']?__mjs_store["']?[^>]*>([\s\S]*?)<\/script>/.exec(res.sharedScript)
    assert.ok(balise, res.sharedScript)
    const graine = JSON.parse(balise[1]).__mjsAwait
    assert.deepEqual(graine, { 'mjs-servi|resultats|["ad"]': { v: [{ id: 1, pseudo: 'Ada' }], n: 1 } }, res.sharedScript)
    assert.deepEqual((res.warnings || []).filter((x: string) => /stabilis/i.test(x)), [])
    // le navigateur : la balise du magasin est là avant le cœur, comme dans une page servie
    const { code } = await construire('await-derivee-reprise', { 'servi.mjs': SERVI })
    const w: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
    w.document.body.innerHTML = '<script id="__mjs_store" type="application/json">' + JSON.stringify({ __mjsAwait: graine }) + '</script>'
    w.eval(BANC + code + '\nglobalThis.µ = µ;\nµ.warn = function(...a) { globalThis.__avis.push(a.map(String).join(" ")); };')
    // la balise de la page servie (`mjs-ssr`) : seul un composant de la page servie reprend la valeur du serveur
    w.document.body.insertAdjacentHTML('beforeend', '<mjs-servi mjs-ssr></mjs-servi>')
    await pause(150)
    const el = w.document.querySelector('mjs-servi')
    assert.equal(liste(el), 'Ada', 'la valeur servie est montrée')
    assert.equal(w.__appels, undefined, 'la fonction n\'est pas rappelée au réveil')
    assert.equal(w.__avis.length, 0, 'aucun avertissement — ' + w.__avis.join(' | '))
    w.close()
  })
})
