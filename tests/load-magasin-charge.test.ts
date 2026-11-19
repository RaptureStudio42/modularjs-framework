// µload(url, { refresh }) : le magasin qui se charge seul. Une adresse lue par trois composants part en UNE requête ; la donnée,
// l'attente et l'erreur se lisent dans le gabarit ; l'adresse qui change garde la donnée d'avant pendant l'attente, et la requête
// dépassée est annulée quand plus personne ne la lit ; un envoi réussi relit les clés de même chemin ; une clé vit tant qu'on la
// lit, puis cinq minutes dans un cache de cinquante clés ; `refresh` vaut false, un nombre de secondes, 'focus' ou 'online' ; le
// rendu serveur range la donnée dans `#__mjs_store`. Le module n'entre au cœur que si l'appli appelle µload.
// Méthode : le vrai Bundler (développement), le cœur et les composants dans happy-dom, `fetch` remplacé par un faux qui note
// chaque requête et ne répond que sur ordre du test ; l'heure (`Date.now`) et les minuteurs de plus d'une minute sont tenus par
// le test.

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

// le faux réseau, l'heure et les minuteurs longs, posés avant le cœur
const BANC = `
  globalThis.__req = [];
  globalThis.__avis = [];
  globalThis.__t = 1000000000000;
  Date.now = function() { return globalThis.__t; };
  globalThis.__longs = [];
  var __st = globalThis.setTimeout, __ct = globalThis.clearTimeout;
  globalThis.setTimeout = function(f, d) { if (d >= 60000) { var l = { f: f, d: d, vivant: true }; __longs.push(l); return -__longs.length; } return __st.apply(this, arguments); };
  globalThis.clearTimeout = function(id) { if (typeof id === 'number' && id < 0) { var l = __longs[-id - 1]; if (l) l.vivant = false; return; } return __ct.apply(this, arguments); };
  globalThis.__toutLong = function() { var n = 0; __longs.forEach(function(l) { if (l.vivant) { l.vivant = false; n++; l.f(); } }); return n; };
  globalThis.fetch = function(url, o) {
    return new Promise(function(res, rej) {
      var r = { url: String(url), method: (o && o.method) || 'GET', aborted: false };
      r.reply = function(status, body) { res(new Response(JSON.stringify(body), { status: status, headers: { 'content-type': 'application/json' } })); };
      r.html = function(status, text) { res(new Response(text, { status: status, headers: { 'content-type': 'text/html' } })); };
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

// les requêtes vues, `GET /api/me` ; `ouvertes` : celles qui attendent encore leur réponse (ni répondues ni annulées)
const requetes = (w: any, motif: string, ouvertes = false) => w.__req.filter((r: any) => (r.method + ' ' + r.url.replace('http://localhost', '')) === motif && (!ouvertes || (!r.repondue && !r.aborted)))
async function repondre(w: any, motif: string, status: number, body: any) {
  const r = requetes(w, motif, true)[0]
  assert.ok(r, 'aucune requête ouverte ' + motif + ' — vues : ' + w.__req.map((x: any) => x.method + ' ' + x.url).join(', '))
  r.repondue = true
  r.reply(status, body)
  await pause(60)
}
const ombre  = (el: any) => el._shadow
const texte  = (el: any, sel: string) => (ombre(el).querySelector(sel)?.textContent ?? '∅').trim()

const MOI = `<script>
  $me = µload('/api/me')
</script>
<p class="nom">{$me.data?.pseudo}</p><i class="att">{$me.pending}</i><b class="err">{$me.error?.message}</b>
`
const PAGE = `<script>
  $q       = ''
  $membres = µload("/api/members?q=#{encodeURIComponent($q)}")
  @chercher = (q) -> $q = q
</script>
<@moi></@moi><@moi></@moi><@moi></@moi>
<ul>{for m in ($membres.data or []) by id}<li>{m.pseudo}</li>{end}</ul>
<i class="encours">{$membres.pending}</i>
`

describe('µload — le magasin qui se charge seul', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('le module part au cœur avec µload (et µ.ajax avec lui), jamais sans', async () => {
    const avec = await construire('load-avec', { 'moi.mjs': MOI })
    assert.ok(/µ\.load = /.test(avec.coeur), 'µ.load absent du cœur d\'une appli qui appelle µload')
    assert.ok(/µ\.ajax = /.test(avec.coeur), 'µ.ajax absent du cœur d\'une appli qui appelle µload')
    const sans = await construire('load-sans', { 'moi.mjs': "<script>\n  $me = { pseudo: 'Ada' }\n</script>\n<p>{$me.pseudo}</p>\n" })
    assert.equal(/µ\.load = /.test(sans.coeur), false, 'µ.load au cœur d\'une appli qui ne l\'appelle pas')
  })

  it('la scène : une requête pour trois lecteurs, attente, donnée gardée quand l\'adresse change, envoi qui relit, erreur sans nouvel essai', async () => {
    const w    = await monter('load-scene', { 'moi.mjs': MOI, 'page.mjs': PAGE }, '<mjs-page></mjs-page>')
    const page = w.document.querySelector('mjs-page')
    const mois = () => Array.from(ombre(page).querySelectorAll('mjs-moi')) as any[]
    const liste = () => Array.from(ombre(page).querySelectorAll('li')).map((li: any) => li.textContent).join(',')
    assert.equal(mois().length, 3)
    assert.equal(requetes(w, 'GET /api/me').length, 1, 'trois lecteurs de /api/me = une seule requête')
    assert.deepEqual(mois().map((m) => texte(m, '.att')), ['true', 'true', 'true'])
    await repondre(w, 'GET /api/me', 200, { pseudo: 'Ada' })
    assert.deepEqual(mois().map((m) => texte(m, '.nom') + '/' + texte(m, '.att')), ['Ada/false', 'Ada/false', 'Ada/false'])
    await repondre(w, 'GET /api/members?q=', 200, [{ id: 1, pseudo: 'Ada' }, { id: 2, pseudo: 'Bob' }])
    assert.equal(liste(), 'Ada,Bob')
    // l'adresse change : la donnée d'avant reste, « en cours » vrai ; la requête dépassée est annulée
    page.chercher('b')
    await pause(30)
    assert.equal(requetes(w, 'GET /api/members?q=b').length, 1)
    assert.equal(liste(), 'Ada,Bob')
    assert.equal(texte(page, '.encours'), 'true')
    page.chercher('bo')
    await pause(60)
    assert.equal(requetes(w, 'GET /api/members?q=b')[0].aborted, true, 'la requête dépassée, que plus personne ne lit, est annulée')
    assert.equal(liste(), 'Ada,Bob')
    await repondre(w, 'GET /api/members?q=bo', 200, [{ id: 2, pseudo: 'Bob' }])
    assert.equal(liste(), 'Bob')
    assert.equal(texte(page, '.encours'), 'false')
    // un envoi réussi relit les clés de même chemin, et elles seules
    w.µ.ajax.patch('/api/me', { pseudo: 'Zoé' })
    await repondre(w, 'PATCH /api/me', 200, {})
    assert.equal(requetes(w, 'GET /api/me').length, 2, 'PATCH /api/me relit /api/me')
    assert.equal(requetes(w, 'GET /api/members?q=bo').length, 1, '/api/members n\'est pas sous /api/me')
    await repondre(w, 'GET /api/me', 200, { pseudo: 'Zoé' })
    assert.deepEqual(mois().map((m) => texte(m, '.nom')), ['Zoé', 'Zoé', 'Zoé'])
    w.µ.ajax.delete('/api/members/2')
    await repondre(w, 'DELETE /api/members/2', 200, {})
    assert.equal(requetes(w, 'GET /api/members?q=bo').length, 2, 'DELETE /api/members/2 relit /api/members?q=bo')
    assert.equal(requetes(w, 'GET /api/me').length, 2)
    await repondre(w, 'GET /api/members?q=bo', 200, [])
    // relire sur demande ; l'erreur garde la donnée, aucun nouvel essai
    const fin = w.µ.load.refresh('/api/me')
    assert.ok(fin && typeof fin.then === 'function', 'µload.refresh rend une promesse')
    assert.equal(requetes(w, 'GET /api/me').length, 3)
    await repondre(w, 'GET /api/me', 500, { message: 'panne' })
    assert.deepEqual(mois().map((m) => texte(m, '.err') + '/' + texte(m, '.nom')), ['panne/Zoé', 'panne/Zoé', 'panne/Zoé'])
    page.chercher('z')
    await pause(200)
    assert.equal(requetes(w, 'GET /api/me').length, 3, 'une erreur ne relance aucune requête')
    w.close()
  })

  it('mémoire : une clé vit tant qu\'on la lit, puis cinq minutes, dans un cache de cinquante clés', async () => {
    const w = await monter('load-memoire', { 'moi.mjs': MOI }, '<mjs-moi></mjs-moi>')
    await repondre(w, 'GET /api/me', 200, { pseudo: 'Ada' })
    w.document.querySelector('mjs-moi').remove()
    await pause(30)
    assert.equal(w.__longs.filter((l: any) => l.vivant && l.d === 300000).length, 1, 'plus lue, la clé reste cinq minutes')
    w.document.body.innerHTML = '<mjs-moi></mjs-moi>'
    await pause(80)
    assert.equal(requetes(w, 'GET /api/me').length, 1, 'rouverte dans les cinq minutes : la donnée gardée, sans requête')
    assert.equal(texte(w.document.querySelector('mjs-moi'), '.nom'), 'Ada')
    w.document.querySelector('mjs-moi').remove()
    await pause(30)
    w.__toutLong()
    w.document.body.innerHTML = '<mjs-moi></mjs-moi>'
    await pause(80)
    assert.equal(requetes(w, 'GET /api/me').length, 2, 'après cinq minutes sans lecteur, la clé est oubliée')
    // cinquante clés au plus : la plus ancienne qu'on ne lit plus part la première
    for (let i = 0; i < 51; i++) w.µ.load('/k/' + i)
    for (let i = 0; i < 51; i++) await repondre(w, 'GET /k/' + i, 200, { i })
    await pause(30)
    w.µ.load('/k/50')
    w.µ.load('/k/0')
    assert.equal(requetes(w, 'GET /k/50').length, 1, 'une clé récente reste')
    assert.equal(requetes(w, 'GET /k/0').length, 2, 'la 51e clé libre chasse la plus ancienne')
    w.close()
  })

  it('refresh : false par défaut, un nombre de secondes, \'focus\' après 30 s, \'online\' ; une valeur inconnue avertit', async () => {
    const src = (v: string, opt: string) => `<script>\n  $${v} = µload('/${v}'${opt})\n</script>\n<p class="v">{$${v}.data?.v}</p>\n`
    const w = await monter('load-refresh', { 'r-n.mjs': src('n', ', { refresh: 10 }'), 'r-f.mjs': src('f', ", { refresh: 'focus' }"), 'r-o.mjs': src('o', ", { refresh: 'online' }"), 'r-d.mjs': src('d', '') }, '<mjs-r-n></mjs-r-n><mjs-r-f></mjs-r-f><mjs-r-o></mjs-r-o><mjs-r-d></mjs-r-d>')
    for (const v of ['n', 'f', 'o', 'd']) await repondre(w, 'GET /' + v, 200, { v: 1 })
    const lire = (v: string) => w.document.querySelector('mjs-r-' + v)._state[v].data
    w.__t += 5000
    lire('n')
    assert.equal(requetes(w, 'GET /n').length, 1, 'lue avant dix secondes : pas relue')
    w.__t += 6000
    assert.equal(lire('n').v, 1)
    assert.equal(requetes(w, 'GET /n').length, 2, 'lue après dix secondes : relue en fond, la donnée reste')
    w.dispatchEvent(new w.Event('focus'))
    assert.equal(requetes(w, 'GET /f').length, 1, 'retour sur l\'onglet avant trente secondes : pas relue')
    w.__t += 30000
    w.dispatchEvent(new w.Event('focus'))
    assert.equal(requetes(w, 'GET /f').length, 2, 'retour sur l\'onglet après trente secondes : relue')
    w.dispatchEvent(new w.Event('online'))
    assert.equal(requetes(w, 'GET /o').length, 2, 'retour du réseau : relue')
    lire('d')
    assert.equal(requetes(w, 'GET /d').length, 1, 'sans refresh : jamais relue seule, même lue bien plus tard')
    w.µ.load('/x', { refresh: 'souvent' })
    w.µ.load('/y', { refrech: 5 })
    assert.equal(w.__avis.filter((a: string) => /souvent/.test(a)).length, 1, 'refresh inconnu : un avertissement — ' + w.__avis.join(' | '))
    assert.equal(w.__avis.filter((a: string) => /refrech/.test(a)).length, 1, 'option inconnue : un avertissement — ' + w.__avis.join(' | '))
    w.close()
  })

  it('rendu serveur : la donnée lue pendant le rendu part dans #__mjs_store, le rendu l\'attend', async () => {
    const root   = mjsTmp('load-ssr')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'moi.mjs'), `<script module>
  plusTard = (valeur, ms) -> new Promise((tenir) -> setTimeout((-> tenir(valeur)), ms))
</script>
<script>
  if µserver then window.fetch = (u) -> plusTard(new Response(JSON.stringify({ pseudo: 'Ada' }), { headers: { 'content-type': 'application/json' } }), 40)
  $me = µload('/api/me')
</script>
<p class="nom">{$me.data?.pseudo}</p>
`)
    const res: any = await renderToString({ sourceDir: srcDir, outputDir: join(root, 'out'), tag: 'mjs-moi', settleMs: 2000 } as any)
    assert.match(res.html, /Ada/, 'le rendu serveur attend la requête de µload')
    assert.match(res.sharedScript, /"__mjsLoad":\{"\/api\/me":\{"pseudo":"Ada"\}\}/, res.sharedScript)
    assert.deepEqual((res.warnings || []).filter((x: string) => /stabilis/i.test(x)), [])
  })
})

// une construction complète : le cœur, le manifeste et les fichiers de messages, tels qu'ils partent
async function construireTout(prefixe: string, sources: Record<string, string>, opts: Record<string, unknown>): Promise<{ coeur: string, manifeste: string, messages: string }> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  const manif  = join(opts.env === 'prod' ? outDir : root, 'bundle.js')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(sources)) writeFileSync(join(srcDir, nom), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: manif, ...opts } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir)
  const lire  = (f: string) => readFileSync(join(outDir, f), 'utf-8')
  const coeur = files.find((f) => f.startsWith('mjs_core') && f.endsWith('.js'))
  return { coeur: coeur ? lire(coeur) : '', manifeste: readFileSync(manif, 'utf-8'), messages: files.filter((f) => f.startsWith('mjs_err-')).map(lire).join('\n') }
}

// le composant rendu par le serveur, dont `fetch` (côté serveur seulement) rend `reponse`
const moiServeur = (reponse: string, url = '/api/me') => `<script>
  if µserver then window.fetch = (u) -> ${reponse}
  $me = µload('${url}')
</script>
<p class="nom">{$me.data?.pseudo}</p><i class="att">{$me.pending}</i><b class="err">{$me.error?.message}</b>
`

async function rendreServeur(prefixe: string, source: string, settleMs: number): Promise<any> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'moi.mjs'), source)
  return renderToString({ sourceDir: srcDir, outputDir: join(root, 'out'), tag: 'mjs-moi', settleMs } as any)
}

describe('µload — réponses, rendu serveur, options, chemins, gabarit, morceaux joints', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('une réponse qui n\'est pas du JSON (page de connexion) pose error, jamais data', async () => {
    const w = await monter('load-pas-json', { 'moi.mjs': MOI }, '<mjs-moi></mjs-moi>')
    const r = requetes(w, 'GET /api/me', true)[0]
    r.repondue = true
    r.html(200, '<html><body>Connexion</body></html>')
    await pause(80)
    const el = w.document.querySelector('mjs-moi')
    assert.equal(el._state.me.data, undefined, 'la page reçue n\'est pas une donnée')
    assert.match(String(el._state.me.error?.message), /n'est pas du JSON/)
    assert.match(texte(el, '.err'), /n'est pas du JSON/)
    assert.equal(texte(el, '.att'), 'false')
    w.close()
  })

  it('options : une chaîne ou un nombre à la place de l\'objet avertit une fois, clairement, et compte pour false', async () => {
    const w = await monter('load-options', { 'moi.mjs': MOI }, '<mjs-moi></mjs-moi>')
    w.µ.load('/a', 'focus')
    w.µ.load('/a', 'focus')
    w.µ.load('/b', 30)
    const avis = w.__avis.join(' | ')
    assert.equal(w.__avis.filter((a: string) => /focus/.test(a) && /\{ refresh/.test(a)).length, 1, avis)
    assert.equal(w.__avis.filter((a: string) => /30/.test(a) && /\{ refresh/.test(a)).length, 1, avis)
    assert.equal(w.__avis.filter((a: string) => /option « [0-9]/.test(a)).length, 0, avis)
    w.close()
  })

  it('refresh : chaque lecteur garde sa règle, un autre appel de la même adresse ne la change pas', async () => {
    const src = (v: string, opt: string) => `<script>\n  $${v} = µload('/r'${opt})\n</script>\n<p>{$${v}.data?.v}</p>\n`
    const w = await monter('load-regle', { 'r-n.mjs': src('n', ', { refresh: 10 }'), 'r-o.mjs': src('o', ", { refresh: 'online' }") }, '<mjs-r-n></mjs-r-n><mjs-r-o></mjs-r-o>')
    await repondre(w, 'GET /r', 200, { v: 1 })
    w.__t += 11000
    assert.equal(w.document.querySelector('mjs-r-o')._state.o.data.v, 1)
    assert.equal(requetes(w, 'GET /r').length, 1, 'le lecteur de \'online\' ne relit pas au bout de dix secondes')
    assert.equal(w.document.querySelector('mjs-r-n')._state.n.data.v, 1)
    assert.equal(requetes(w, 'GET /r').length, 2, 'le lecteur de dix secondes relit, même après un appel avec \'online\'')
    w.close()
  })

  it('après un envoi : la barre finale ne compte pas, et la racine n\'est relue que par un envoi à la racine', async () => {
    const lit = (u: string) => `<script>\n  $d = µload('${u}')\n</script>\n<p>{$d.data?.v}</p>\n`
    const w = await monter('load-chemins', { 'barre.mjs': lit('/api/me/'), 'racine.mjs': lit('/') }, '<mjs-barre></mjs-barre><mjs-racine></mjs-racine>')
    await repondre(w, 'GET /api/me/', 200, { v: 1 })
    await repondre(w, 'GET /', 200, { v: 1 })
    w.µ.ajax.patch('/api/me', { v: 2 }, () => {})
    await repondre(w, 'PATCH /api/me', 200, {})
    assert.equal(requetes(w, 'GET /api/me/').length, 2, '/api/me/ relu après PATCH /api/me')
    assert.equal(requetes(w, 'GET /').length, 1, '/ n\'est pas relu par un envoi à /api/me')
    w.µ.ajax.post('/', {}, () => {})
    await repondre(w, 'POST /', 200, {})
    assert.equal(requetes(w, 'GET /').length, 2, '/ relu par un envoi à /')
    w.close()
  })

  it('µload écrit dans le gabarit : l\'appel marche comme dans un bloc (chaque adresse son magasin, requête dépassée non annulée, l\'adresse affichée relue une fois après un envoi) et le développement le dit', async () => {
    const DIRECT = `<script>\n  $q = 'a'\n  @poser = (q) -> $q = q\n</script>\n<p class="v">{µload("/api/d?q=#{$q}").data?.v}</p>\n`
    const w = await monter('load-gabarit', { 'direct.mjs': DIRECT }, '<mjs-direct></mjs-direct>')
    const el = w.document.querySelector('mjs-direct')
    await repondre(w, 'GET /api/d?q=a', 200, { v: 'a' })
    el.poser('b')
    await pause(60)
    assert.notEqual(texte(el, '.v'), 'a', 'chaque adresse son magasin : la donnée de /api/d?q=a ne s\'affiche pas pour /api/d?q=b')
    el.poser('c')
    await pause(60)
    // tableau recopié dans ce royaume : celui de la fenêtre n'a pas le même prototype
    assert.deepEqual([...w.__req.filter((r: any) => r.aborted).map((r: any) => r.url)], [], 'requête dépassée non annulée')
    await repondre(w, 'GET /api/d?q=c', 200, { v: 'c' })
    assert.equal(texte(el, '.v'), 'c')
    const depuis = w.__req.length
    w.µ.ajax.patch('/api/d', {}, () => {})
    await repondre(w, 'PATCH /api/d', 200, {})
    assert.deepEqual(lues(w, depuis), ['/api/d?q=c'], 'l\'adresse affichée est relue une fois après un envoi')
    await repondre(w, 'GET /api/d?q=c', 200, { v: 'c2' })
    assert.equal(texte(el, '.v'), 'c2')
    assert.deepEqual(lues(w, depuis), ['/api/d?q=c'], 'jamais de boucle')
    const avis = [...w.__avis].filter((a: string) => /µload/.test(a))
    assert.equal(avis.length, 1, avis.join('\n'))
    assert.ok(avis[0].includes('µload("/api/d?q=a") appelé dans le gabarit de <mjs-direct>'), avis[0])
    w.close()
  })

  it('rendu serveur : un échec (réseau, réponse qui n\'est pas du JSON) ne s\'écrit jamais dans la page ni dans #__mjs_store', async () => {
    const echecs: Array<[string, string]> = [
      ['reseau', 'Promise.reject(new TypeError(\'connect ECONNREFUSED 127.0.0.1:80\'))'],
      ['page', 'Promise.resolve(new Response(\'<html><body>Connexion</body></html>\', { headers: { \'content-type\': \'text/html\' } }))'],
    ]
    for (const [nom, reponse] of echecs) {
      const res = await rendreServeur('load-ssr-' + nom, moiServeur(reponse), 1500)
      assert.doesNotMatch(res.html, /ECONNREFUSED|Connexion|JSON/, nom + ' : ' + res.html)
      assert.doesNotMatch(String(res.sharedScript), /__mjsLoad/, nom + ' : ' + res.sharedScript)
      assert.match(res.html, /class="att">(?:<!--[^>]*-->)?true</, nom + ' : la page part en attente, le client refera la requête — ' + res.html)
    }
  })

  it('rendu serveur trop long : l\'avertissement nomme µload et l\'adresse attendue', async () => {
    const res = await rendreServeur('load-ssr-lent', moiServeur('new Promise(->)', '/api/lent'), 300)
    assert.ok((res.warnings || []).some((x: string) => /µload/.test(x) && x.includes('/api/lent')), (res.warnings || []).join('\n'))
  })

  it('une appli sans µload : ni son manifeste de développement ni ses fichiers de messages ne portent un texte de µload ; avec µload, si', async () => {
    const SANS = { 'nu.mjs': "<script>\n  $s = 'x'\n</script>\n<p>{$s}</p>\n" }
    const prod = { env: 'prod', js: 'split', urlPrefix: '/out', logLevel: 'warn' }
    assert.doesNotMatch((await construireTout('load-id-dev', SANS, {})).manifeste, /loadOption|loadRefresh|loadPlace|notJson/)
    assert.doesNotMatch((await construireTout('load-id-prod', SANS, prod)).messages, /loadOption|loadRefresh|loadPlace|notJson/)
    assert.match((await construireTout('load-id-dev-avec', { 'moi.mjs': MOI }, {})).manifeste, /loadOption/)
    const avec = await construireTout('load-id-prod-avec', { 'moi.mjs': MOI }, prod)
    assert.match(avec.messages, /loadOption/)
    assert.doesNotMatch(avec.messages, /loadPlace/, 'les messages du développement seul ne partent pas dans les fichiers de production')
  })

  it('morceaux joints seulement s\'ils servent : l\'écoute de focus / online si l\'appli les écrit, ce que lit le rendu serveur si la construction rend côté serveur ; la reprise toujours', async () => {
    const prod  = { env: 'prod', js: 'split', urlPrefix: '/out' }
    const nu    = await construireTout('load-m-nu', { 'moi.mjs': MOI }, prod)
    assert.doesNotMatch(nu.coeur, /visibilitychange/, 'sans focus ni online : aucune écoute')
    assert.doesNotMatch(nu.coeur, /_ssrLoad/, 'construction qui ne rend pas côté serveur : rien de ce que lit le rendu serveur')
    assert.match(nu.coeur, /__mjsLoad/, 'la reprise d\'une page rendue par un serveur part dans tout client')
    const focus = await construireTout('load-m-focus', { 'moi.mjs': MOI.replace("µload('/api/me')", "µload('/api/me', { refresh: 'focus' })") }, prod)
    assert.match(focus.coeur, /visibilitychange/)
    const ssr   = await construireTout('load-m-ssr', { 'moi.mjs': MOI }, { ...prod, render: { default: 'ssr' } })
    assert.match(ssr.coeur, /_ssrLoad/)
  })
})

// µload écrit hors du script (le gabarit, racine comprise, un µeffect, une aide du gabarit, une ligne de {for}) : rien ne lâche ses adresses
const LIEUX = `<script>
  $q   = 'a'
  $ids = [1, 2]
  $n   = '-'
  $z   = 0
  $me  = µload('/api/me')
  $m   = µload("/api/m?q=#{$q}")
  µeffect -> $n = µload("/api/e?q=#{$q}").data?.v or '-'
  @aide    = (q) -> µload("/api/h?q=#{q}")
  @poser   = (q) -> $q = q
  @charger = -> $z = µload('/api/z')
  µmount -> µload('/api/w')
</script>
<i class="t">{µload("/api/t?q=#{$q}").data?.v}</i><i class="h">{@aide($q).data?.v}</i><s>{$n}</s>
<div>{for id in $ids}<b class="r">{µload("/api/u/#{id}").data?.v}</b>{end}</div>
`

describe('µload — texte de l\'erreur en production, reprise d\'une route sans mode, appels hors de la racine du script', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('réponse qui n\'est pas du JSON : le texte de error part au manifeste de production, dans les deux langues, seulement avec µload', async () => {
    const prod = { env: 'prod', js: 'split', urlPrefix: '/out' }
    const avec = await construireTout('load-texte-prod', { 'moi.mjs': MOI }, prod)
    assert.match(avec.manifeste, /la réponse de \{url\} n'est pas du JSON/, 'texte français au manifeste de production')
    assert.match(avec.manifeste, /the response from \{url\} is not JSON/, 'texte anglais au manifeste de production')
    assert.doesNotMatch(avec.coeur, /loadNotJson/, 'le cœur ne lit plus la table des messages de la console pour ce texte')
    const sans = await construireTout('load-texte-prod-sans', { 'nu.mjs': "<script>\n  $s = 'x'\n</script>\n<p>{$s}</p>\n" }, prod)
    assert.doesNotMatch(sans.manifeste, /pas du JSON|not JSON/)
  })

  it('ce que lit le rendu serveur : joint quand une route sans mode est prérendue (mode de repli), absent quand tout est en csr', async () => {
    const prod   = { env: 'prod', js: 'split', urlPrefix: '/out' }
    const routes = { '/': { component: 'mjs-moi' } }
    const repli  = await construireTout('load-repli', { 'moi.mjs': MOI }, { ...prod, render: { routes } })
    assert.match(repli.coeur, /_ssrLoad/, 'route sans mode ni render.default : prérendue, le morceau du rendu serveur part au cœur')
    const dev    = await construireTout('load-repli-dev', { 'moi.mjs': MOI }, { render: { routes } })
    assert.match(dev.coeur + dev.manifeste, /_ssrLoad/, 'de même en développement')
    const csr    = await construireTout('load-csr', { 'moi.mjs': MOI }, { ...prod, render: { default: 'csr', routes } })
    assert.doesNotMatch(csr.coeur, /_ssrLoad/, 'tout en csr : aucune page rendue côté serveur par cette construction')
  })

  it('développement : µload dans le gabarit (racine comprise), un µeffect, une aide du gabarit ou une ligne de {for} avertit une fois, avec le lieu et où l\'écrire ; jamais à la racine du script, dans une dérivée, µmount ni un gestionnaire', async () => {
    const w  = await monter('load-lieux', { 'lieux.mjs': LIEUX }, '<mjs-lieux></mjs-lieux>')
    const el = w.document.querySelector('mjs-lieux')
    const lieux = () => [...w.__avis].filter((a: string) => /µload/.test(a))
    const vus = lieux()
    assert.equal(vus.length, 4, vus.join('\n'))
    assert.ok(vus.some((a: string) => a.includes('µload("/api/t?q=a") appelé dans le gabarit de <mjs-lieux>')), vus.join('\n'))
    assert.ok(vus.some((a: string) => /µeffect/.test(a) && a.includes('/api/e?q=a')), vus.join('\n'))
    assert.ok(vus.some((a: string) => /aide appelée par le gabarit/.test(a) && a.includes('/api/h?q=a')), vus.join('\n'))
    assert.ok(vus.some((a: string) => /ligne de \{for\}/.test(a) && a.includes('/api/u/1')), vus.join('\n'))
    for (const a of vus) {
      assert.ok(a.includes('<mjs-lieux>'), a)
      assert.match(a, /l'appel n'est pas suivi — ses requêtes dépassées ne sont pas annulées\. /, a)
      assert.match(a, /Écrivez l'appel dans une dérivée du script/, a)
    }
    el.poser('b')
    await pause(80)
    el.charger()
    await pause(80)
    assert.equal(lieux().length, 4, 'un avertissement par lieu et par composant, aucun pour le gestionnaire — ' + lieux().join('\n'))
    w.close()
  })
})

// dans le gabarit, µload n'est suivi nulle part : à la racine (une liaison hors de tout bloc) comme dans un bloc — branche d'un {if}, d'un
// {key} ou d'un {await}, condition d'un {if}, liste d'un {for} —, le composant peut lire ses adresses jusqu'à son départ, et le développement
// dit d'écrire l'appel dans une dérivée du script, qui lâche l'adresse qu'elle quitte. Une passe des blocs ne refait aucune liaison
const EN_BLOC: Record<string, string> = {
  'si.mjs':      `<script>\n  $q  = ''\n  $on = true\n  @chercher = (q) -> $q = q\n  @basculer = (v) -> $on = v\n</script>\n{if $on}<i class="v">{µload("/api/si?q=#{$q}").data?.n}</i>{end}\n`,
  'cle.mjs':     `<script>\n  $q = ''\n  $k = 1\n  @chercher = (q) -> $q = q\n  @cle      = (k) -> $k = k\n</script>\n{key $k}<i class="v">{µload("/api/k/#{$k}?q=#{$q}").data?.n}</i>{end}\n`,
  'attente.mjs': `<script>\n  $q = ''\n  $p = 1\n  @chercher = (q) -> $q = q\n</script>\n{await $p}<i>att</i>{success v}<i class="v">{µload("/api/aw?q=#{$q}").data?.n}</i>{end}\n`,
  'cond.mjs':    `<script>\n  $q = ''\n  @chercher = (q) -> $q = q\n</script>\n{if µload("/api/c?q=#{$q}").data?.ok}<b class="v">oui</b>{end}\n`,
  'liste.mjs':   `<script>\n  $q     = ''\n  $autre = [1, 2]\n  @chercher = (q) -> $q = q\n</script>\n<ul>{for m in (µload("/api/l?q=#{$q}").data or [])}<li>{m}</li>{end}</ul>{for x in $autre}<u>{x}</u>{end}\n`,
  'racine.mjs':  `<script>\n  $q  = ''\n  $on = true\n  @chercher = (q) -> $q = q\n  @basculer = (v) -> $on = v\n</script>\n{if $on}<s>x</s>{end}<i class="v">{µload("/api/r?q=#{$q}").data?.n}</i>\n`,
  'parent.mjs':  `<script>\n  $q  = ''\n  $on = true\n  @chercher = (q) -> $q = q\n  @basculer = (v) -> $on = v\n</script>\n{if $on}<@enfant></@enfant>{end}\n`,
  'enfant.mjs':  `<script>\n  $q  = ''\n  $me = µload('/api/me')\n  @chercher = (q) -> $q = q\n  µmount -> µload('/api/w')\n</script>\n<i class="v">{$me.data?.pseudo}{µload("/api/e?q=#{$q}").data?.n}</i>\n`,
  'derivee.mjs': `<script>\n  $q     = ''\n  $on    = true\n  $autre = [1, 2]\n  $l     = µload("/api/dl?q=#{$q}")\n  $c     = µload("/api/dc?q=#{$q}")\n  @chercher = (q) -> $q = q\n  @basculer = (v) -> $on = v\n</script>\n{if $c.data?.ok}<b class="ok">oui</b>{end}<ul>{for m in ($l.data or [])}<li>{m}</li>{end}</ul>{for x in $autre}<u>{x}</u>{end}{if $on}<i class="v">{$l.data?.length}</i>{end}\n`,
}

// une liaison de la racine qui lève quand la page le demande (`__casse`), à côté d'un {if} qu'on bascule
const PIEGE = `<script>
  $on = true
  @basculer = (v) -> $on = v
  @piege    = ->
    if globalThis.__casse
      globalThis.__levees++
      JSON.parse('{boom')
    else
      ''
</script>
{if $on}<s>x</s>{end}<i class="v">{@piege() + (µload("/api/eh").data?.n or '')}</i>
`

// les adresses lues (GET) depuis la requête nº `depuis`
const lues = (w: any, depuis: number) => [...w.__req.slice(depuis).filter((r: any) => r.method === 'GET').map((r: any) => r.url.replace('http://localhost', ''))]
// les adresses dont la requête a été annulée
const annulees = (w: any) => [...w.__req.filter((r: any) => r.aborted).map((r: any) => r.url.replace('http://localhost', ''))]

// le cœur évalué sur une page qui porte déjà `avant` (la balise #__mjs_store d'un rendu serveur), puis le composant posé
async function monterSur(prefixe: string, sources: Record<string, string>, avant: string, corps: string): Promise<any> {
  const { code } = await construire(prefixe, sources)
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  window.document.body.innerHTML = avant
  window.eval(BANC + code + '\nglobalThis.µ = µ;\nµ.warn = function(...a) { globalThis.__avis.push(a.map(String).join(" ")); };')
  window.document.body.insertAdjacentHTML('beforeend', corps)
  await pause(150)
  return window
}

describe('µload — dans le gabarit, la racine ; dans un bloc, l\'avertissement qui dit d\'écrire une dérivée ; la reprise du rendu serveur dans tout client', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('une liaison de la racine qui lève, puis la bascule d\'un {if} voisin : toute erreur levée est dite ; l\'adresse affichée est relue une fois après un envoi, le gabarit est redessiné à son arrivée', async () => {
    const w  = await monter('load-piege', { 'piege.mjs': PIEGE }, '<mjs-piege></mjs-piege>')
    const el = w.document.querySelector('mjs-piege')
    const dites: string[] = []
    w.µ.error = function (...a: any[]) { dites.push(a.map(String).join(' ')) }
    await repondre(w, 'GET /api/eh', 200, { n: 'eh' })
    assert.equal(texte(el, '.v'), 'eh')
    w.__casse  = true
    w.__levees = 0
    el.basculer(false)
    await pause(60)
    assert.equal(w.__levees, dites.length, `toute erreur levée par une liaison est dite : ${w.__levees} levée(s), ${dites.length} dite(s)`)
    assert.equal(texte(el, '.v'), 'eh')
    assert.deepEqual(await envoyer(w, ['/api/eh']), ['/api/eh'], 'l\'adresse affichée est relue une fois après un envoi')
    // sa donnée redessine le composant, la liaison lève à son tour ordinaire, et l'erreur est dite
    await repondre(w, 'GET /api/eh', 200, { n: 'eh2' })
    assert.equal(w.__levees, 1)
    assert.equal(dites.length, 1, dites.join('\n'))
    assert.match(dites[0], /Crash intercepted in mjs-piege/)
    const avis = [...w.__avis].filter((a: string) => /µload/.test(a))
    assert.equal(avis.length, 1, 'le gabarit averti, une fois — ' + avis.join('\n'))
    assert.ok(avis[0].includes('µload("/api/eh") appelé dans le gabarit de <mjs-piege>'), avis[0])
    w.close()
  })

  it('dans le gabarit, racine comprise (branche d\'un {if}, d\'un {key} ou d\'un {await}, condition d\'un {if}, liste d\'un {for}, liaison hors de tout bloc) : le développement avertit, une fois par composant, d\'écrire l\'appel dans une dérivée ; dans une dérivée, ni pour le script ou le µmount d\'un enfant que la branche crée, jamais', async () => {
    const noms = Object.keys(EN_BLOC).map((f) => f.replace('.mjs', ''))
    const w    = await monter('load-en-bloc', EN_BLOC, noms.map((n) => `<mjs-${n}></mjs-${n}>`).join(''))
    const avis = () => [...w.__avis].filter((a: string) => /µload/.test(a))
    const de   = (n: string) => avis().filter((a: string) => a.includes(`<mjs-${n}>`))
    for (const [n, url] of [['si', '/api/si?q='], ['cle', '/api/k/1?q='], ['attente', '/api/aw?q='], ['cond', '/api/c?q='], ['liste', '/api/l?q='], ['racine', '/api/r?q='], ['enfant', '/api/e?q=']]) {
      const vus = de(n)
      assert.equal(vus.length, 1, n + ' — ' + avis().join('\n'))
      assert.ok(vus[0].includes(`µload("${url}") appelé dans le gabarit de <mjs-${n}>`), vus[0])
      assert.match(vus[0], /l'appel n'est pas suivi — ses requêtes dépassées ne sont pas annulées\. /, vus[0])
      assert.match(vus[0], /Écrivez l'appel dans une dérivée du script \(\$membres = µload\(…\)/, vus[0])
    }
    for (const n of ['derivee', 'parent']) assert.deepEqual(de(n), [], n)
    // frappe, bascules (l'enfant recréé par la branche), clé qui change : toujours un avertissement par composant, aucun ailleurs
    for (const n of noms) {
      const el = w.document.querySelector('mjs-' + n)
      for (const q of ['a', 'ab']) {
        el.chercher(q)
        await pause(20)
      }
      if (el.basculer) {
        el.basculer(false)
        await pause(20)
        el.basculer(true)
        await pause(20)
      }
      if (el.cle) {
        el.cle(2)
        await pause(20)
      }
    }
    assert.equal(avis().length, 7, avis().join('\n'))
    w.close()
  })

  it('écrite dans une dérivée, à côté d\'un autre {for} de racine : la frappe annule les requêtes dépassées de la condition et de la liste, et un envoi ne relit que l\'adresse du moment', async () => {
    const w  = await monter('load-derivee', { 'derivee.mjs': EN_BLOC['derivee.mjs'] }, '<mjs-derivee></mjs-derivee>')
    const el = w.document.querySelector('mjs-derivee')
    await repondre(w, 'GET /api/dl?q=', 200, ['x'])
    await repondre(w, 'GET /api/dc?q=', 200, { ok: true })
    assert.equal(texte(el, '.ok') + '|' + texte(el, 'li') + '|' + texte(el, '.v'), 'oui|x|1')
    for (const q of ['c', 'ca', 'cat']) {
      el.chercher(q)
      await pause(30)
    }
    assert.deepEqual(annulees(w).sort(), ['/api/dc?q=c', '/api/dc?q=ca', '/api/dl?q=c', '/api/dl?q=ca'])
    await repondre(w, 'GET /api/dl?q=cat', 200, ['z', 'zz'])
    await repondre(w, 'GET /api/dc?q=cat', 200, { ok: false })
    el.basculer(false)
    await pause(30)
    el.basculer(true)
    await pause(30)
    assert.equal(texte(el, '.ok') + '|' + texte(el, '.v'), '∅|2')
    const avant = w.__req.length
    for (const chemin of ['/api/dl', '/api/dc']) {
      w.µ.ajax.patch(chemin, {}, () => {})
      await repondre(w, 'PATCH ' + chemin, 200, {})
    }
    assert.deepEqual(lues(w, avant), ['/api/dl?q=cat', '/api/dc?q=cat'], 'seules les adresses du moment sont relues')
    assert.deepEqual([...w.__avis].filter((a: string) => /µload/.test(a)), [])
    w.close()
  })

  it('50 liaisons de la racine qui appellent µload, 400 bascules d\'un {if} voisin : aucun appel de µload ni aucune requête, comme une page qui n\'en a pas', async () => {
    const l50 = (f: (i: number) => string) => Array.from({ length: 50 }, (_, i) => f(i)).join('')
    const C50 = `<script>\n  $on = true\n  @basculer = (v) -> $on = v\n</script>\n{if $on}<s>x</s>{end}${l50((i) => `<i>{µload("/api/c/${i}").data?.n}</i>`)}\n`
    const w   = await monter('load-c50', { 'c50.mjs': C50 }, '<mjs-c50></mjs-c50>')
    const el  = w.document.querySelector('mjs-c50')
    assert.equal(w.__req.length, 50)
    const f = w.µ.load
    let appels = 0
    w.µ.load = function (this: any, ...a: any[]) { appels++; return f.apply(this, a) }
    w.µ.load.refresh = f.refresh
    let cachee = 0
    for (let i = 0; i < 400; i++) {
      el.basculer(i % 2 === 1)
      await pause(0)
      if (i % 2 === 0 && !ombre(el).querySelector('s')) cachee++
    }
    w.µ.load = f
    assert.equal(cachee, 200, 'chaque bascule s\'est rendue')
    assert.equal(appels, 0, 'une bascule voisine ne refait aucune liaison à µload')
    assert.equal(w.__req.length, 50, 'aucune requête de plus')
    assert.equal([...w.__avis].filter((a: string) => /µload/.test(a) && a.includes('appelé dans le gabarit de <mjs-c50>')).length, 1, 'cinquante appels du gabarit, un avertissement')
    w.close()
  })

  it('la documentation ne promet rien de plus : dans le gabarit, racine comprise, une dérivée', () => {
    const doc = readFileSync(new URL('../docs/14-stores.md', import.meta.url), 'utf-8')
    const µload = doc.slice(doc.indexOf('## 3. Le magasin qui se charge seul'), doc.indexOf('## Sous le capot'))
    assert.doesNotMatch(µload, /suit ce qui s'affiche|lâche(nt)? de même|lâche ses adresses/)
    assert.doesNotMatch(µload, /liaison de la racine|à la racine (?:de son|du) gabarit/, 'la racine du gabarit n\'est plus une place permise')
    assert.match(µload, /\*\*Dans le gabarit\*\* — une liaison, à la racine comme dans un bloc/)
    assert.match(µload, /relue une fois après un envoi qui la touche, tout de suite, jamais au redessin suivant ; l'adresse d'un bloc fermé qu'il n'a pas encore lâchée \(voir \*\*Mémoire\*\*\) est relue de même, et le bloc rouvert montre la donnée fraîche/)
    assert.match(µload, /la garde jusqu'au rendu complet suivant du composant, puis la laisse/)
    assert.match(µload, /seulement pour un appel écrit directement dans l'expression d'une variable ou d'une dérivée du script[^\n]*la frappe dans une recherche[^\n]*Un appel fait dans une fonction — une aide[^\n]*ne montre jamais la donnée d'une autre adresse/)
    assert.doesNotMatch(µload, /n'est pas relue? après un envoi/)
    assert.match(µload, /le composant est prévenu de l'arrivée de la donnée et se redessine, mais il ne lit pas le magasin/)
    assert.match(µload, /\$membres = µload\(/)
    assert.match(µload, /`µload` s'écrit dans le `<script>` d'un composant — une variable, une dérivée, un gestionnaire d'événement, `µmount` — ou dans un module/)
    assert.match(µload, /\*\*Le même appel pour chaque rang\*\*[^\n]*jamais la donnée d'un autre rang/)
    assert.match(µload, /\*\*Une valeur qui lit la donnée\*\*[^\n]*est une dérivée : elle se recalcule à chaque arrivée d'une réponse qu'elle a lue, même vide/)
    const aide = readFileSync(new URL('../docs/22-aide-memoire.md', import.meta.url), 'utf-8')
    assert.match(aide, /s'écrit dans le script \(variable, dérivée, gestionnaire, `µmount`\) ou dans un module/)
    assert.match(aide, /une adresse affichée est relue une fois après un envoi \(bloc fermé pas encore lâché compris\), jamais au redessin/)
    assert.match(aide, /fait dans une aide, une flèche, une boucle ou le gabarit, jamais celle d'une autre adresse/)
  })

  it('client construit sans bloc render ni hydrate, page rendue par un serveur : la donnée rangée entre au cache, sans requête, et ne reste pas dans $$', async () => {
    const AVEC$$ = `<script>\n  $me = µload('/api/me')\n</script>\n<p class="nom">{$me.data?.pseudo}</p><i class="att">{$me.pending}</i><b class="autre">{$$autre}</b>\n`
    const balise = '<script type="application/json" id="__mjs_store">{"__mjsLoad":{"/api/me":{"pseudo":"Srv"}},"autre":"a"}</script>'
    const w  = await monterSur('load-reprise-nu', { 'moi.mjs': AVEC$$ }, balise, '<mjs-moi></mjs-moi>')
    const el = w.document.querySelector('mjs-moi')
    assert.deepEqual(lues(w, 0), [], 'aucune requête du client')
    assert.equal(texte(el, '.nom') + '|' + texte(el, '.att'), 'Srv|false')
    assert.equal(texte(el, '.autre'), 'a', 'le reste du magasin $$ est lu')
    assert.equal(Object.prototype.hasOwnProperty.call(w.µ._mjs_storeRaw, '__mjsLoad'), false, 'la donnée de µload ne reste pas dans $$')
    w.close()
  })
})

// un appel ne montre jamais la donnée d'un autre : la donnée d'avant, gardée pendant l'attente, est celle du même appel écrit (la même
// occurrence de `µload(` dans le code) dont l'adresse change ; passer d'un appel à un autre (ternaire, `or`) dans une dérivée montre le
// magasin de la nouvelle adresse, sa donnée gardée par le cache si elle a déjà été lue, sinon `pending` sans donnée. Une dérivée qui finit
// son calcul sans lever lâche les adresses qu'elle n'a plus appelées ; celle qui lève ne lâche rien. Écrit dans le gabarit, racine comprise
// (ternaire, `or`, liaison qui cesse d'appeler), l'appel marche comme dans un bloc, et le développement avertit
const BASCULE = '  $on = true\n  @basculer = (v) -> $on = v\n'
const APPELS: Record<string, string> = {
  'lien.mjs':  `<script>\n${BASCULE}</script>\n<i class="v">{(if $on then 'A:' + (µload('/api/ta').data?.n or 'att') else 'B:' + (µload('/api/tb').data?.n or 'att'))}</i>\n`,
  'deriv.mjs': `<script>\n${BASCULE}  $m = if $on then µload('/api/da') else µload('/api/db')\n</script>\n<i class="v">{(if $on then 'A:' else 'B:') + ($m.data?.n or 'att')}</i>\n`,
  'ou.mjs':    `<i class="v">{µload('/api/oa').data?.n or µload('/api/ob').data?.n or 'att'}</i>\n`,
  'arret.mjs': `<script>\n${BASCULE}  $q = ''\n  @chercher = (q) -> $q = q\n</script>\n<i class="v">{(if $on then µload("/api/tn?q=#{$q}").data?.n or 'att' else 'off')}</i>\n`,
  'leve.mjs':  `<script>\n  $k = 0\n  $m = if $k > 0 then JSON.parse('{boom') else µload('/api/dk')\n  @casser = (k) -> $k = k\n</script>\n<i class="v">{$m.data?.n or 'att'}</i>\n`,
}

// un envoi à chacun des chemins, puis les adresses relues
async function envoyer(w: any, chemins: string[]): Promise<string[]> {
  const depuis = w.__req.length
  for (const chemin of chemins) {
    w.µ.ajax.patch(chemin, {}, () => {})
    await repondre(w, 'PATCH ' + chemin, 200, {})
  }
  return lues(w, depuis)
}

// le gabarit, racine comprise : une liaison simple, un ternaire entre deux appels, un `or`, une liaison qui cesse d'appeler
const GABARIT: Record<string, string> = {
  'simple.mjs': `<script>\n  $q = ''\n  @chercher = (q) -> $q = q\n</script>\n<i class="v">{µload("/api/gs?q=#{$q}").data?.n}</i>\n`,
  'lien.mjs':   APPELS['lien.mjs'],
  'ou.mjs':     APPELS['ou.mjs'],
  'arret.mjs':  APPELS['arret.mjs'],
}

describe('µload — un appel ne montre jamais la donnée d\'un autre ; une dérivée lâche les adresses qu\'elle n\'appelle plus ; le gabarit avertit', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const [nom, lieu, a, b] of [['deriv', 'une dérivée', '/api/da', '/api/db']]) {
    it(`deux adresses dans un ternaire, ${lieu} : à la bascule, le magasin de la nouvelle adresse, jamais la donnée de l'autre ; l'adresse quittée n'est plus lue`, async () => {
      const w  = await monter('load-' + nom, { [nom + '.mjs']: APPELS[nom + '.mjs'] }, `<mjs-${nom}></mjs-${nom}>`)
      const el = w.document.querySelector('mjs-' + nom)
      await repondre(w, 'GET ' + a, 200, { n: 'a' })
      assert.equal(texte(el, '.v'), 'A:a')
      el.basculer(false)
      await pause(60)
      assert.equal(texte(el, '.v'), 'B:att', 'la donnée de A ne s\'affiche jamais sous B')
      // retour à A avant la réponse de B : A revient du cache, sans requête ; la requête de B, que plus rien ne lit, est annulée
      const avant = w.__req.length
      el.basculer(true)
      await pause(60)
      assert.equal(texte(el, '.v'), 'A:a')
      assert.deepEqual(lues(w, avant), [])
      assert.deepEqual(annulees(w), [b])
      el.basculer(false)
      await pause(60)
      assert.equal(texte(el, '.v'), 'B:att')
      await repondre(w, 'GET ' + b, 200, { n: 'b' })
      assert.equal(texte(el, '.v'), 'B:b')
      el.basculer(true)
      await pause(60)
      assert.equal(texte(el, '.v'), 'A:a', 'A, déjà lue, revient du cache')
      assert.deepEqual(await envoyer(w, [b, a]), [a], 'seule l\'adresse affichée est relue après un envoi')
      w.close()
    })
  }

  it('µload écrit à la racine du gabarit (liaison simple, ternaire entre deux appels, `or`, liaison qui cesse d\'appeler) : le développement avertit, une fois par composant, avec l\'adresse et la règle ; aucune production ne l\'emporte', async () => {
    const noms = Object.keys(GABARIT).map((f) => f.replace('.mjs', ''))
    const w    = await monter('load-gabarit-avis', GABARIT, noms.map((n) => `<mjs-${n}></mjs-${n}>`).join(''))
    const avis = () => [...w.__avis].filter((a: string) => /µload/.test(a))
    const de   = (n: string) => avis().filter((a: string) => a.includes(`<mjs-${n}>`))
    for (const [n, url] of [['simple', '/api/gs?q='], ['lien', '/api/ta'], ['ou', '/api/oa'], ['arret', '/api/tn?q=']]) {
      const vus = de(n)
      assert.equal(vus.length, 1, n + ' — ' + avis().join('\n'))
      assert.ok(vus[0].includes(`µload("${url}") appelé dans le gabarit de <mjs-${n}>`), vus[0])
      assert.match(vus[0], /l'appel n'est pas suivi — ses requêtes dépassées ne sont pas annulées\. /, vus[0])
      assert.match(vus[0], /Écrivez l'appel dans une dérivée du script \(\$membres = µload\(…\), l'adresse peut lire des \$\), puis lisez-la dans le gabarit/, vus[0])
    }
    // frappe, bascules (l'autre branche du ternaire, la liaison qui cesse d'appeler puis reprend) : toujours un avertissement par composant
    for (const n of noms) {
      const el = w.document.querySelector('mjs-' + n)
      if (el.chercher) {
        for (const q of ['a', 'ab']) {
          el.chercher(q)
          await pause(20)
        }
      }
      if (el.basculer) {
        el.basculer(false)
        await pause(20)
        el.basculer(true)
        await pause(20)
      }
    }
    assert.equal(avis().length, 4, avis().join('\n'))
    w.close()
    // production, minifiée ou non, au niveau de console qui garde les avertissements : ni l'avertissement ni le code qui surveille, au cœur
    // comme au manifeste ; `_mjsLdIn` en mot entier : `__mjsLdInv`, le relais de `_mjs_invalidate`, reste au cœur
    for (const [i, extra] of [{}, { minify: false }].entries()) {
      const b = await construireTout('load-gabarit-prod-' + i, GABARIT, { env: 'prod', js: 'split', urlPrefix: '/out', logLevel: 'log', ...extra })
      assert.doesNotMatch((b.coeur + b.manifeste).replace(/^[ \t]*\/\/.*$/gm, ''), /loadPlace|_mjsLdOutside|_mjsLdWatch|_mjsLdIn\b|_mjsLdWrap/, JSON.stringify(extra))
    }
  })

  it('une dérivée qui lève ne lâche rien : l\'adresse affichée reste relue après un envoi', async () => {
    const w  = await monter('load-leve', { 'leve.mjs': APPELS['leve.mjs'] }, '<mjs-leve></mjs-leve>')
    const el = w.document.querySelector('mjs-leve')
    const dites: string[] = []
    w.µ.error = function (...a: any[]) { dites.push(a.map(String).join(' ')) }
    await repondre(w, 'GET /api/dk', 200, { n: 'dk' })
    assert.equal(texte(el, '.v'), 'dk')
    el.casser(1)
    await pause(60)
    assert.ok(dites.length > 0, 'l\'erreur est dite')
    assert.deepEqual(await envoyer(w, ['/api/dk']), ['/api/dk'], 'l\'adresse reste lue')
    w.close()
  })

  it('la documentation dit la règle : le même appel écrit garde sa donnée, deux appels font deux magasins, les adresses plus appelées sont lâchées, aucune production n\'emporte la surveillance', () => {
    const doc   = readFileSync(new URL('../docs/14-stores.md', import.meta.url), 'utf-8')
    const µload = doc.slice(doc.indexOf('## 3. Le magasin qui se charge seul'), doc.indexOf('## Sous le capot'))
    assert.match(µload, /même occurrence de `µload\(`/)
    assert.match(µload, /jamais la donnée de l'autre appel/)
    assert.match(µload, /lâche les adresses qu'elle n'a plus appelées/)
    assert.match(µload, /Un calcul qui lève une erreur ne lâche rien/)
    assert.match(µload, /Aucune construction de production n'emporte cet avertissement ni le code qui le surveille, minifiée ou non/)
    assert.doesNotMatch(µload, /En production, ni l'avertissement ni le code qui le surveille ne partent/)
  })

  it('aucune construction de production n\'emporte le code qui surveille les appels écrits hors de la racine : minifiée ou non, à tout niveau de console', async () => {
    const prod = { env: 'prod', js: 'split', urlPrefix: '/out' }
    const veille = /_mjs_safeRenderStruct'|loadPlace|_mjsLdWatch|_mjsLdOutside|_mjs_ldB/
    for (const [i, extra] of [{}, { minify: false }, { logLevel: 'log' }, { minify: false, logLevel: 'log' }].entries()) {
      const b = await construireTout('load-veille-' + i, { 'moi.mjs': MOI }, { ...prod, ...extra })
      assert.match(b.coeur, /µ\.load = |\.load=/, JSON.stringify(extra) + ' : µload est au cœur')
      // le code, sans les commentaires qu'une construction non minifiée garde
      assert.doesNotMatch(b.coeur.replace(/^[ \t]*\/\/.*$/gm, ''), veille, JSON.stringify(extra) + ' : le code qui surveille ne part pas en production')
    }
    const dev = await construireTout('load-veille-dev', { 'moi.mjs': MOI }, {})
    assert.match(dev.coeur + dev.manifeste, veille, 'le développement le garde')
  })
})

// le gabarit, racine comprise, qui appelle µload pendant la frappe d'une recherche ; une dérivée qui lit la donnée de deux appels (`or`) ; le
// même appel fait pour chaque rang d'une liste (`map`)
const RANGS: Record<string, string> = {
  'fbloc.mjs':   `<script>\n  $q  = ''\n  $on = true\n  @chercher = (q) -> $q = q\n</script>\n{if $on}<i class="v">{µload("/api/fb?q=#{$q}").data?.n}</i>{end}\n`,
  'fracine.mjs': `<script>\n  $q = ''\n  @chercher = (q) -> $q = q\n</script>\n<i class="v">{µload("/api/fr?q=#{$q}").data?.n}</i>\n`,
  'dou.mjs':     `<script>\n  $m = µload('/api/oa').data?.n or µload('/api/ob').data?.n or 'att'\n</script>\n<i class="v">{$m}</i>\n`,
  'dmap.mjs':    `<script>\n  $ids = [1, 2]\n  @poser = (l) -> $ids = l\n  $d = $ids.map((i) -> µload("/api/m/#{i}"))\n</script>\n<i class="v">{$d.map((x) -> x.data?.n or 'att').join(',')}</i>\n`,
}

// les rendus du composant (`_mjs_invalidate`), comptés depuis l'appel
function compterRendus(w: any): () => number {
  const p = w.µ.Element.prototype, f = p._mjs_invalidate
  let n = 0
  p._mjs_invalidate = function (this: any, ...a: any[]) { n++; return f.apply(this, a) }
  return () => n
}

describe('µload — le gabarit prévenu à l\'arrivée sans lire, une dérivée recalculée à chaque arrivée, chaque rang sa donnée', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const [nom, chemin] of [['fbloc', '/api/fb'], ['fracine', '/api/fr']]) {
    it(`le gabarit (${nom === 'fbloc' ? 'branche d\'un {if}' : 'liaison de la racine'}) : 100 frappes puis deux envois — redessiné à chaque arrivée, il ne lit rien, seule l'adresse affichée est relue, une fois par envoi, le cache borné à 50 adresses`, async () => {
      const w  = await monter('load-' + nom, { [nom + '.mjs']: RANGS[nom + '.mjs'] }, `<mjs-${nom}></mjs-${nom}>`)
      const el = w.document.querySelector('mjs-' + nom)
      await repondre(w, `GET ${chemin}?q=`, 200, { n: 'q=' })
      assert.equal(texte(el, '.v'), 'q=')
      const rendus = compterRendus(w)
      for (let i = 1; i <= 100; i++) {
        el.chercher('k' + i)
        await pause(0)
        for (const r of requetes(w, `GET ${chemin}?q=k${i}`, true)) {
          r.repondue = true
          r.reply(200, { n: 'k' + i })
        }
        await pause(15)
      }
      await pause(100)
      assert.equal(texte(el, '.v'), 'k100', 'la frappe faite dans la passe d\'une variable : le gabarit redessiné à l\'arrivée de la donnée')
      assert.ok(rendus() <= 200, 'deux rendus par frappe au plus — ' + rendus())
      assert.ok(!el._mjs_ldH || el._mjs_ldH.size === 0, 'le composant ne lit aucune poignée de son gabarit — ' + (el._mjs_ldH && el._mjs_ldH.size))
      assert.ok(w._mjsLdEntries.size <= 51 && w._mjsLdFree.size <= 50, `cache borné : ${w._mjsLdEntries.size} entrées, ${w._mjsLdFree.size} au cache`)
      for (const tour of [1, 2]) {
        const avant = rendus()
        assert.deepEqual(await envoyer(w, [chemin]), [chemin + '?q=k100'], `envoi nº ${tour} : seule l'adresse affichée est relue, une fois`)
        await repondre(w, `GET ${chemin}?q=k100`, 200, { n: 'k100-' + tour })
        assert.equal(rendus() - avant, 1, `envoi nº ${tour} : un rendu, à l'arrivée`)
        assert.equal(texte(el, '.v'), 'k100-' + tour)
      }
      w.close()
    })
  }

  it('une dérivée qui lit la donnée de deux appels (`or`) : recalculée à chaque arrivée, même vide ; l\'adresse qu\'elle n\'appelle plus est lâchée', async () => {
    const w  = await monter('load-dou', { 'dou.mjs': RANGS['dou.mjs'] }, '<mjs-dou></mjs-dou>')
    const el = w.document.querySelector('mjs-dou')
    assert.deepEqual(lues(w, 0), ['/api/oa', '/api/ob'])
    assert.equal(texte(el, '.v'), 'att')
    await repondre(w, 'GET /api/ob', 200, {})
    assert.equal(texte(el, '.v'), 'att')
    // la donnée vide a été lue : un envoi relit l'adresse, et la dérivée se recalcule à son arrivée
    const depuis = w.__req.length
    w.µ.ajax.patch('/api/ob', {}, () => {})
    await repondre(w, 'PATCH /api/ob', 200, {})
    assert.deepEqual(lues(w, depuis), ['/api/ob'])
    await repondre(w, 'GET /api/ob', 200, { n: 'b' })
    assert.equal(texte(el, '.v'), 'b', 'la donnée de ob arrivée est affichée')
    await repondre(w, 'GET /api/oa', 200, { n: 'a' })
    assert.equal(texte(el, '.v'), 'a', 'la donnée de oa arrivée est affichée')
    assert.deepEqual(await envoyer(w, ['/api/ob']), [], 'ob, que la dérivée n\'appelle plus, n\'est plus relue')
    assert.deepEqual(await envoyer(w, ['/api/oa']), ['/api/oa'])
    w.close()
  })

  it('le même appel pour chaque rang d\'une liste (`map`) : chaque rang montre la donnée de sa propre adresse — gardée au cache, sinon l\'attente —, jamais celle d\'un autre rang', async () => {
    const w  = await monter('load-dmap', { 'dmap.mjs': RANGS['dmap.mjs'] }, '<mjs-dmap></mjs-dmap>')
    const el = w.document.querySelector('mjs-dmap')
    await repondre(w, 'GET /api/m/1', 200, { n: '1' })
    await repondre(w, 'GET /api/m/2', 200, { n: '2' })
    assert.equal(texte(el, '.v'), '1,2')
    el.poser([3, 2])
    await pause(60)
    assert.equal(texte(el, '.v'), 'att,2', 'le rang de l\'id 3 attend, sans la donnée de l\'id 1')
    await repondre(w, 'GET /api/m/3', 200, { n: '3' })
    assert.equal(texte(el, '.v'), '3,2')
    const avant = w.__req.length
    el.poser([2, 3])
    await pause(60)
    assert.equal(texte(el, '.v'), '2,3', 'rangs échangés : chacun sa donnée, gardée')
    assert.deepEqual(lues(w, avant), [])
    assert.deepEqual(await envoyer(w, ['/api/m/1']), [], 'l\'id 1, quitté, n\'est plus relu')
    // une liste d'un seul rang qui en prend deux
    el.poser([5])
    await pause(60)
    await repondre(w, 'GET /api/m/5', 200, { n: '5' })
    assert.equal(texte(el, '.v'), '5')
    el.poser([6, 3])
    await pause(60)
    assert.equal(texte(el, '.v'), 'att,3', 'le rang de l\'id 6 attend, sans la donnée de l\'id 5')
    w.close()
  })
})

// le gabarit ne boucle jamais : une liste de plus de 50 adresses, des adresses en échec, une adresse affichée après un envoi, un composant
// parti ; `µload(u).refresh()` rangé hors dérivée ; le même appel dans une fonction de rang ou une boucle, seul dans son calcul
const N55 = Array.from({ length: 55 }, (_, i) => i + 1).join(', ')
const SANS_BOUCLE: Record<string, string> = {
  'gfor.mjs':     `<script>\n  $l = [${N55}]\n</script>\n{for i in $l}<i class="v">{µload("/api/gf/#{i}").data?.n or 'att'}</i>{end}\n`,
  'gerr.mjs':     `<i class="v">{(if µload('/api/ge/a').error then 'ea' else 'pa')}</i><i class="v">{(if µload('/api/ge/b').error then 'eb' else 'pb')}</i>\n`,
  'genv.mjs':     `<i class="v">{µload('/api/gv').data?.n or 'att'}</i>\n`,
  'gbloc.mjs':    `<script>\n  $on = true\n  @basculer = (v) -> $on = v\n</script>\n{if $on}<i class="v">{µload('/api/gb').data?.n or 'att'}</i>{end}\n`,
  'gparti.mjs':   `<script>\n  $on = true\n  $garde = µload('/api/gp/lu')\n  @basculer = (v) -> $on = v\n</script>\n<b class="g">{$garde.data?.n}</b>{if $on}<@c-gparti></@c-gparti>{end}\n`,
  'c-gparti.mjs': `<i class="x">{µload('/api/gp/lu').data?.n or 'att'}</i><i class="x">{µload('/api/gp/seul').data?.n or 'att'}</i>\n`,
  'dref.mjs':     `<script>\n  $p = µload('/api/rf').refresh()\n  $n = µload('/api/rn').data?.n or 0\n  $e = µload('/api/re').error\n</script>\n<i class="v">{(if $p then 'p' else 'x')}</i><i class="v">{$n}</i><i class="v">{(if $e then 'e' else 'ok')}</i>\n`,
  'drang.mjs':    `<script>\n  $ids = [1]\n  $q   = 'x'\n  @poser    = (l) -> $ids = l\n  @chercher = (q) -> $q = q\n  aide = (q) -> µload("/api/r3?q=#{q}")\n  fiche = (i) -> µload("/api/r5/#{i}")\n  $d = $ids.map((i) -> µload("/api/r1/#{i}"))\n  $e = (µload("/api/r2/#{i}") for i in $ids)\n  $h = aide($q)\n  $s = µload("/api/r4?q=#{$q}")\n  $f = $ids.map((i) -> fiche(i))\n</script>\n<i class="v">{$d.map((x) -> x.data?.n or 'att').join(',')}</i><i class="v">{$e.map((x) -> x.data?.n or 'att').join(',')}</i><i class="v">{$h.data?.n or 'att'}</i><i class="v">{$s.data?.n or 'att'}</i><i class="v">{$f.map((x) -> x.data?.n or 'att').join(',')}</i>\n`,
}
const textes = (el: any, sel = '.v') => [...ombre(el).querySelectorAll(sel)].map((x: any) => x.textContent).join('|')

// trois rendus complets du composant, comme trois arrivées d'autres réponses
async function redessiner(el: any) {
  for (let i = 0; i < 3; i++) {
    el._mjs_invalidate('_awaits_')
    await pause(40)
  }
}

describe('µload — le gabarit ne boucle jamais ; refresh() rangé reste une variable ; un rang sans la donnée d\'avant', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('le gabarit, une liste de 55 adresses ({for}) : une requête par adresse, même redessiné ; aucune adresse affichée évincée ni redemandée', async () => {
    const w  = await monter('load-gfor', { 'gfor.mjs': SANS_BOUCLE['gfor.mjs'] }, '<mjs-gfor></mjs-gfor>')
    const el = w.document.querySelector('mjs-gfor')
    const gf = () => w.__req.filter((r: any) => /\/api\/gf\//.test(r.url)).length
    assert.equal(gf(), 55)
    for (let i = 1; i <= 55; i++) {
      const r = requetes(w, 'GET /api/gf/' + i, true)[0]
      r.repondue = true
      r.reply(200, { n: 'n' + i })
      await pause(2)
    }
    await pause(100)
    await redessiner(el)
    assert.equal(gf(), 55, 'une requête par adresse affichée — vues : ' + gf())
    const vus = textes(el).split('|')
    assert.equal(vus.length, 55)
    assert.equal(vus.filter((x: string) => x === 'att').length, 0, 'chaque rang sa donnée')
    assert.equal(vus[0] + ' ' + vus[54], 'n1 n55')
    assert.equal(w._mjsLdEntries.size, 55, 'les 55 adresses affichées restent')
    w.close()
  })

  it('le gabarit, deux adresses en échec : une requête chacune, l\'erreur reste affichée — ni redemandée au redessin, ni en boucle — jusqu\'au départ du composant', async () => {
    const w  = await monter('load-gerr', { 'gerr.mjs': SANS_BOUCLE['gerr.mjs'] }, '<mjs-gerr></mjs-gerr>')
    const el = w.document.querySelector('mjs-gerr')
    await repondre(w, 'GET /api/ge/a', 500, { e: 1 })
    await redessiner(el)
    await repondre(w, 'GET /api/ge/b', 500, { e: 1 })
    await redessiner(el)
    assert.deepEqual(lues(w, 0), ['/api/ge/a', '/api/ge/b'])
    assert.equal(textes(el), 'ea|eb')
    el.remove()
    await pause(60)
    assert.ok(!w._mjsLdEntries.has('/api/ge/a') && !w._mjsLdEntries.has('/api/ge/b'), 'les adresses en échec partent avec le composant')
    w.document.body.insertAdjacentHTML('beforeend', '<mjs-gerr></mjs-gerr>')
    await pause(100)
    assert.deepEqual(lues(w, 0), ['/api/ge/a', '/api/ge/b', '/api/ge/a', '/api/ge/b'], 'un composant neuf redemande')
    w.close()
  })

  it('le gabarit : une adresse affichée est relue une fois après un envoi, jamais au redessin suivant ; un bloc fermé pas encore lâché aussi, et rouvert il montre la donnée fraîche ; lâché, il la relit à sa réouverture', async () => {
    const w  = await monter('load-genv', { 'genv.mjs': SANS_BOUCLE['genv.mjs'], 'gbloc.mjs': SANS_BOUCLE['gbloc.mjs'] }, '<mjs-genv></mjs-genv><mjs-gbloc></mjs-gbloc>')
    const el = w.document.querySelector('mjs-genv')
    const bl = w.document.querySelector('mjs-gbloc')
    await repondre(w, 'GET /api/gv', 200, { n: 'v1' })
    await repondre(w, 'GET /api/gb', 200, { n: 'b1' })
    assert.deepEqual(await envoyer(w, ['/api/gv']), ['/api/gv'], 'affichée, relue une fois après l\'envoi')
    await repondre(w, 'GET /api/gv', 200, { n: 'v2' })
    await redessiner(el)
    assert.deepEqual(lues(w, 0), ['/api/gv', '/api/gb', '/api/gv'], 'redessiné ensuite, le gabarit ne la relit plus')
    assert.equal(textes(el), 'v2')
    // bloc fermé, pas encore lâché (aucun rendu complet depuis) : relu une fois par l'envoi ; rouvert, il montre la donnée fraîche sans requête
    bl.basculer(false)
    await pause(60)
    assert.deepEqual(await envoyer(w, ['/api/gb']), ['/api/gb'], 'fermé mais pas encore lâché, relu une fois')
    await repondre(w, 'GET /api/gb', 200, { n: 'b2' })
    bl.basculer(true)
    await pause(60)
    assert.equal(textes(bl), 'b2')
    // bloc fermé puis lâché (un rendu complet est passé) : l'envoi ne le relit pas, sa réouverture si, une fois
    bl.basculer(false)
    await pause(60)
    await redessiner(bl)
    assert.deepEqual(await envoyer(w, ['/api/gb']), [], 'lâché, il n\'est pas relu tout de suite')
    bl.basculer(true)
    await pause(60)
    assert.deepEqual(lues(w, 0).filter((u: string) => u === '/api/gb'), ['/api/gb', '/api/gb', '/api/gb'], 'rouvert, relu une fois')
    await repondre(w, 'GET /api/gb', 200, { n: 'b3' })
    assert.equal(textes(bl), 'b3')
    await redessiner(bl)
    assert.equal(lues(w, 0).length, 5, 'jamais de boucle')
    w.close()
  })

  it('un composant parti avant la réponse n\'est plus prévenu ni gardé : ni à l\'arrivée, ni après l\'envoi suivant', async () => {
    const w      = await monter('load-gparti', { 'gparti.mjs': SANS_BOUCLE['gparti.mjs'], 'c-gparti.mjs': SANS_BOUCLE['c-gparti.mjs'] }, '<mjs-gparti></mjs-gparti>')
    const el     = w.document.querySelector('mjs-gparti')
    const enfant = ombre(el).querySelector('mjs-c-gparti')
    assert.ok(!!enfant && enfant.isConnected, 'enfant monté')
    let n   = 0
    const f = enfant._mjs_invalidate
    enfant._mjs_invalidate = function (this: any, ...a: any[]) { n++; return f.apply(this, a) }
    el.basculer(false)
    await pause(60)
    assert.ok(!enfant.isConnected, 'enfant parti')
    const tient = (u: string) => { const e = w._mjsLdEntries.get(u); return !!(e && e.o && e.o.has(enfant)) }
    assert.ok(!tient('/api/gp/lu') && !tient('/api/gp/seul'), 'les entrées lâchent le composant à son départ')
    await repondre(w, 'GET /api/gp/lu', 200, { n: 'lu' })
    await repondre(w, 'GET /api/gp/seul', 200, { n: 'seul' })
    assert.deepEqual(await envoyer(w, ['/api/gp/lu']), ['/api/gp/lu'], 'le parent, qui lit l\'adresse, la relit')
    await repondre(w, 'GET /api/gp/lu', 200, { n: 'lu2' })
    assert.equal(texte(el, '.g'), 'lu2')
    assert.equal(n, 0, 'composant parti prévenu ' + n + ' fois')
    w.close()
  })

  it('`$p = µload(u).refresh()` reste une variable : deux requêtes, jamais de boucle ; seules `.data`, `.pending`, `.error` font une dérivée', async () => {
    const { code } = await construire('load-dref-code', { 'dref.mjs': SANS_BOUCLE['dref.mjs'] })
    assert.doesNotMatch(code, /_mjs_setComputed\(_mjsThis, 'p'/, 'refresh() ne fait pas une dérivée')
    assert.match(code, /_mjs_setComputed\(_mjsThis, 'n'/)
    assert.match(code, /_mjs_setComputed\(_mjsThis, 'e'/)
    const w  = await monter('load-dref', { 'dref.mjs': SANS_BOUCLE['dref.mjs'] }, '<mjs-dref></mjs-dref>')
    const el = w.document.querySelector('mjs-dref')
    const rf = () => lues(w, 0).filter((u: string) => u === '/api/rf').length
    assert.equal(rf(), 2, 'µload puis refresh() : deux requêtes — vues : ' + rf())
    await repondre(w, 'GET /api/rf', 200, { n: 1 })
    await repondre(w, 'GET /api/rn', 200, { n: 7 })
    await repondre(w, 'GET /api/re', 500, { e: 1 })
    await redessiner(el)
    assert.equal(rf(), 2, 'aucune boucle — vues : ' + rf())
    assert.equal(textes(el), 'p|7|e')
    w.close()
  })

  it('la donnée d\'avant n\'est gardée que pour un appel écrit dans l\'expression d\'une dérivée (la frappe d\'une recherche) : fait dans une boucle, une fonction de rang ou une aide — même appelée une fois, même dans un `map` —, l\'appel attend sans la donnée d\'une autre adresse', async () => {
    const w  = await monter('load-drang', { 'drang.mjs': SANS_BOUCLE['drang.mjs'] }, '<mjs-drang></mjs-drang>')
    const el = w.document.querySelector('mjs-drang')
    await repondre(w, 'GET /api/r1/1', 200, { n: 'a1' })
    await repondre(w, 'GET /api/r2/1', 200, { n: 'b1' })
    await repondre(w, 'GET /api/r3?q=x', 200, { n: 'cx' })
    await repondre(w, 'GET /api/r4?q=x', 200, { n: 'sx' })
    await repondre(w, 'GET /api/r5/1', 200, { n: 'f1' })
    assert.equal(textes(el), 'a1|b1|cx|sx|f1')
    el.poser([3])
    el.chercher('y')
    await pause(60)
    assert.equal(textes(el), 'att|att|att|sx|att', 'boucle, fonction de rang, aide (seule ou dans un map) : l\'attente ; l\'appel écrit dans la dérivée garde la donnée de la recherche d\'avant')
    await repondre(w, 'GET /api/r1/3', 200, { n: 'a3' })
    await repondre(w, 'GET /api/r2/3', 200, { n: 'b3' })
    await repondre(w, 'GET /api/r3?q=y', 200, { n: 'cy' })
    await repondre(w, 'GET /api/r4?q=y', 200, { n: 'sy' })
    await repondre(w, 'GET /api/r5/3', 200, { n: 'f3' })
    assert.equal(textes(el), 'a3|b3|cy|sy|f3')
    w.close()
  })

  it('le repère du compilateur : sans `*` seulement pour un appel écrit dans l\'expression d\'une dérivée, hors de toute fonction et de toute boucle', async () => {
    const { loadSites } = await import('../src/transpiler/load-sites.js')
    const js = [
      "µ._mjs_setComputed(_mjsThis, 's', () => (µ.load(`/api/s?q=${$.q}`)))",
      "µ._mjs_setComputed(_mjsThis, 't', () => ($.on ? µ.load('/a').data?.n : 'off'))",
      "let aide = function(q) { return µ.load(`/api/ai?q=${q}`) }",
      "µ._mjs_setComputed(_mjsThis, 'd', () => ($.ids.map((i) => µ.load(`/m/${i}`))))",
      "µ._mjs_setComputed(_mjsThis, 'f', () => ((() => { const r = []; for (const i of $.ids) r.push(µ.load(`/f/${i}`)); return r })()))",
      "µ._mjs_setComputed(_mjsThis, 'g', () => ((function() { return µ.load('/g') })()))",
      "this.envoyer = function(u) { return µ.load(u).refresh() }",
    ].join('\n')
    const sites = [...loadSites(js, 'essai').code.matchAll(/,null,'(\*?)[0-9a-f]{4}\.\d+'/g)].map((m) => m[1] || '=')
    assert.deepEqual(sites, ['=', '=', '*', '*', '*', '*', '*'])
  })
})
