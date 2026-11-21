// Un µeffect qui appelle une méthode d'une connexion `µsocket` — connect(), close(), send(), request(), room(), presence(), stream(),
// destroy() suivi d'un nouveau µsocket(…) à la même adresse — ne suit pas l'état de la connexion : ces méthodes le lisent sans le faire
// suivre, et le reffet ne repart pas quand la connexion change d'état (connecting → open → fermée par le serveur → reconnecting → open).
// Sans cela, le reffet qui ferme puis rouvre la connexion (`close()` puis `connect()`, la forme d'une appli qui renouvelle sa connexion)
// repartait sur le changement d'état qu'il provoquait lui-même : une connexion de plus à chaque tour, sans fin — le reffet est borné ici
// à vingt tours, pour que le test échoue vite sans geler la page ; de même dans un composant qui affiche l'état de la connexion. Ce qui lit lui-même l'état reste suivi : un reffet qui lit
// `@@sock.state`, un autre `@@sock.connected`, le gabarit `{@sock.state}`, une valeur dérivée qui lit `@@sock.state`. Témoin : le même
// composant sans appel de méthode, dont la connexion change d'état elle aussi.
// Vrais composants compilés par le Bundler, en développement et en production, montés dans happy-dom ; faux WebSocket qui compte ses
// connexions par adresse, s'ouvre en différé et répond à chaque requête.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const ADRESSE = 'ws://fil.test/'
const OPTIONS = '{ reconnect: { backoff: [30], jitter: 0 } }'
const BORNE   = 20

// la forme d'une appli qui renouvelle sa connexion : connexion créée et écoutée au montage, puis close() et connect() dans le reffet qui
// lit `lecture` ; le gabarit ne montre pas l'état
const renouvelle = (nom: string, lecture: string) => [
  '<script>',
  '$go = 0',
  '',
  'recevoir = (p) -> window.__recu = p',
  '',
  'reopen = ->',
  '  @@sock.close()',
  '  @@sock.connect()',
  '',
  'µmount ->',
  `  @@sock = µsocket('${ADRESSE}${nom}', ${OPTIONS})`,
  `  window.__s['${nom}'] = @@sock`,
  "  @@sock.on('notif', recevoir)",
  '  return',
  '',
  'µeffect ->',
  `  window.__n['${nom}']++`,
  `  return unless ${lecture} and @@sock`,
  `  return if window.__n['${nom}'] > ${BORNE}`,
  '  reopen()',
  '  return',
  '',
  '@go    = -> $go++',
  '@renew = -> $$renew = ($$renew or 0) + 1',
  '</script>',
  '<p>{$go}</p>',
  ''
].join('\n')

// une méthode appelée par le reffet dès son passage au montage ; `script` : ce que le script fait de la connexion qu'il crée
const appelant = (nom: string, appel: string[], script: string[] = []) => [
  '<script>',
  '$go = 0',
  `@@sock = µsocket('${ADRESSE}${nom}', ${OPTIONS})`,
  `window.__s['${nom}'] = @@sock`,
  ...script,
  '',
  'µeffect ->',
  `  window.__n['${nom}']++`,
  `  window.__v['${nom}'] = $go`,
  `  return if window.__n['${nom}'] > ${BORNE}`,
  ...appel.map((l) => '  ' + l),
  '  return',
  '</script>',
  '<p>{$go}</p>',
  ''
].join('\n')

// connexion créée par le script, ouverte par la page ; `script` et `gabarit` : ce qui la lit
const lecteur = (nom: string, script: string[], gabarit: string) => [
  '<script>',
  `@@sock = µsocket('${ADRESSE}${nom}', ${OPTIONS})`,
  `window.__s['${nom}'] = @@sock`,
  ...script,
  '</script>',
  gabarit,
  ''
].join('\n')

const COMPOSANTS: Record<string, string> = {
  // a. close() et connect() dans un reffet qui lit une variable, puis dans un reffet qui lit une clé du magasin
  'variable': renouvelle('variable', '$go'),
  'magasin':  renouvelle('magasin', '$$renew'),
  // a. le même appel dans un composant qui affiche l'état de la connexion : son gabarit suit cet état
  'voyant':   ['<script>', '$go = 0', `@@sock = µsocket('${ADRESSE}voyant', ${OPTIONS})`, '', 'µeffect ->', "  window.__n['voyant']++", '  return unless $go', `  return if window.__n['voyant'] > ${BORNE}`, '  @@sock.close()', '  @@sock.connect()', '  return', '', '@go = -> $go++', '</script>', '<p>{$go} {@sock.state}</p>', ''].join('\n'),
  // b. une méthode par reffet, appelée au montage ; destroy() remplace la connexion que le script a ouverte
  'connect':  appelant('connect', ['@@sock.connect()']),
  'send':     appelant('send', ["@@sock.send('ping', { n: 1 })"]),
  'request':  appelant('request', ["window.__r = @@sock.request('ask', { n: 1 }, { waitForOpen: true })"]),
  'room':     appelant('room', ["@@sock.room('salle')"]),
  'presence': appelant('presence', ["@@sock.presence('salle')"]),
  'stream':   appelant('stream', ["@@sock.stream('flux')"]),
  'destroy':  appelant('destroy', ['@@sock.destroy()', `@@sock = µsocket('${ADRESSE}destroy', ${OPTIONS})`, '@@sock.connect()', "window.__s['destroy'] = @@sock"], ['@@sock.connect()']),
  // d. témoin : le même composant sans appel dans le reffet ; sa connexion est ouverte par la page
  'temoin':   appelant('temoin', []),
  // c. ce qui lit lui-même l'état
  'lit-etat':     lecteur('lit-etat', ["window.__v['lit-etat'] = []", '', 'µeffect ->', "  window.__n['lit-etat']++", "  window.__v['lit-etat'].push(@@sock.state)", '  return'], '<p>lit</p>'),
  'lit-connecte': lecteur('lit-connecte', ["window.__v['lit-connecte'] = []", '', 'µeffect ->', "  window.__n['lit-connecte']++", "  window.__v['lit-connecte'].push(@@sock.connected)", '  return'], '<p>lit</p>'),
  'gabarit':      lecteur('gabarit', [], '<p>{@sock.state}</p>'),
  'derivee':      lecteur('derivee', ["$suffixe = ''", '$etat    = @@sock.state + $suffixe'], '<p>{$etat}</p>'),
}

const NOMS     = Object.keys(COMPOSANTS)
const CORPS    = NOMS.map((n) => `<mjs-fil-${n}></mjs-fil-${n}>`).join('')
const ECRITS   = ['variable', 'voyant']
// connexions ouvertes par la page après le montage (sans effet sur celle qu'une méthode a déjà ouverte)
const OUVERTS  = ['connect', 'send', 'request', 'room', 'presence', 'stream', 'destroy', 'temoin', 'lit-etat', 'lit-connecte', 'gabarit', 'derivee']
// connexions que le serveur ferme en cours de route ; celles de la forme a. restent ouvertes
const COUPEES  = ['connect', 'send', 'request', 'room', 'presence', 'stream', 'destroy', 'temoin', 'lit-etat', 'lit-connecte', 'gabarit', 'derivee']
const AFFICHES = ['gabarit', 'derivee']

// s'ouvre 30 ms après sa création et accueille aussitôt ; répond à toute trame qui porte un numéro ; `couper(adresse)` : le serveur
// ferme la dernière connexion ouverte de l'adresse
const FAUX_WS = `globalThis.__ws = { n: {}, tous: [] };
globalThis.__ws.couper = (u) => {
  const l = globalThis.__ws.tous.filter((w) => w.url === u && w.readyState === 1), w = l[l.length - 1];
  if (w) { w.readyState = 3; w.onclose && w.onclose({ code: 1006 }) }
};
globalThis.WebSocket = class {
  constructor(u) {
    this.url = u; this.readyState = 0;
    const c = globalThis.__ws; c.n[u] = (c.n[u] || 0) + 1; c.tous.push(this);
    setTimeout(() => { if (this.readyState !== 0) return; this.readyState = 1; this.onopen && this.onopen({}); this.recevoir({ t: 'µ:welcome', p: {} }) }, 30);
  }
  recevoir(m) { this.onmessage && this.onmessage({ data: JSON.stringify(m) }) }
  send(d) {
    if (typeof d !== 'string') return;
    const m = JSON.parse(d);
    if (m.id != null) setTimeout(() => { if (this.readyState === 1) this.recevoir({ t: 'µ:ack', id: m.id, p: { ok: 1 } }) }, 0);
  }
  close() { this.readyState = 3 }
  addEventListener() {}
  removeEventListener() {}
};`

const SCENARIO = `(async () => {
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const el    = (n) => document.querySelector('mjs-fil-' + n);
  const textes = {};
  for (const n of ${JSON.stringify(AFFICHES)}) {
    const e = el(n)._shadow || el(n), s = textes[n] = [e.textContent.trim()];
    new MutationObserver(() => { const t = e.textContent.trim(); if (s[s.length - 1] !== t) s.push(t) }).observe(e, { childList: true, characterData: true, subtree: true });
  }
  for (const n of ${JSON.stringify(ECRITS)}) el(n).go();
  el('magasin').renew();
  for (const n of ${JSON.stringify(OUVERTS)}) window.__s[n].connect();
  await pause(100);
  for (const n of ${JSON.stringify(COUPEES)}) window.__ws.couper('${ADRESSE}' + n);
  await pause(200);
  let requete = 'absente';
  if (window.__r && typeof window.__r.then === 'function') requete = await Promise.race([window.__r.then(() => 'tenue', (e) => 'rejetée : ' + (e && e.code)), pause(50).then(() => 'en attente')]);
  const etats = {};
  for (const n in window.__s) etats[n] = window.__s[n].state;
  return { passages: { ...window.__n }, fils: { ...window.__ws.n }, etats, vus: window.__v, textes, requete };
})()`

async function construire(env: 'dev' | 'prod'): Promise<string> {
  const root   = mjsTmp('socket-sans-suivi-' + env)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, texte] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, 'fil-' + nom + '.mjs'), texte)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env, js: 'bundle' } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
}

type Jeu = { montage: Record<string, number>, passages: Record<string, number>, fils: Record<string, number>, etats: Record<string, string>, vus: Record<string, unknown[]>, textes: Record<string, string[]>, requete: string, alertes: string[] }

async function jouer(code: string): Promise<Jeu> {
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  const alertes: string[] = []
  window.console.warn  = (...a: unknown[]) => { alertes.push(a.map(String).join(' ')) }
  window.console.error = (...a: unknown[]) => { alertes.push(a.map(String).join(' ')) }
  try {
    window.__n = Object.fromEntries(NOMS.map((n) => [n, 0]))
    window.__s = {}
    window.__v = {}
    window.eval(FAUX_WS)
    window.eval(code)
    window.document.body.innerHTML = CORPS
    const fin = Date.now() + 5000
    while (NOMS.some((n) => !window.document.querySelector('mjs-fil-' + n)?._mjs_is_mounted) && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
    await new Promise((r) => setTimeout(r, 30))
    const montage = { ...window.__n }
    const r = await window.eval(SCENARIO)
    return JSON.parse(JSON.stringify({ montage, ...r, alertes }))
  }
  finally {
    await window.happyDOM.close()
  }
}

after(async () => { await terminateSharedWorkerPool() })

for (const env of ['dev', 'prod'] as const) {
  describe(`méthodes d'une connexion µsocket appelées par un µeffect (${env === 'dev' ? 'développement' : 'production'}) : l'état de la connexion n'est pas suivi`, function () {
    this.timeout(240000)
    let jeu: Jeu
    before(async () => {
      jeu = await jouer(await construire(env))
    })

    it('au montage, chaque reffet passe une fois', () => {
      for (const n of NOMS.filter((n) => !AFFICHES.includes(n))) assert.equal(jeu.montage[n], 1, n + ' : ' + JSON.stringify(jeu.montage))
    })

    it('a. close() puis connect() dans un reffet qui lit une variable, dans un reffet qui lit une clé du magasin, dans un composant qui affiche l\'état : un passage et une connexion de plus, pas davantage', () => {
      for (const n of ['variable', 'magasin']) {
        assert.equal(jeu.passages[n], 2, n + ' : passages du reffet ' + JSON.stringify(jeu.passages))
        assert.equal(jeu.fils[ADRESSE + n], 2, n + ' : connexions créées ' + JSON.stringify(jeu.fils))
        assert.equal(jeu.etats[n], 'open', n + ' : état final')
      }
      assert.equal(jeu.passages.voyant, 2, 'voyant : passages du reffet ' + JSON.stringify(jeu.passages))
      assert.equal(jeu.fils[ADRESSE + 'voyant'], 1, 'voyant : connexions créées ' + JSON.stringify(jeu.fils))
    })

    it('b. connect(), send(), request(), room(), presence(), stream(), destroy() suivi de µsocket, appelés au montage : le reffet ne repasse pas pendant que la connexion change d\'état', () => {
      const fils: Record<string, number> = { connect: 2, send: 2, request: 2, room: 2, presence: 2, stream: 2, destroy: 3 }
      for (const n in fils) {
        assert.equal(jeu.passages[n], 1, n + ' : passages du reffet ' + JSON.stringify(jeu.passages))
        assert.equal(jeu.fils[ADRESSE + n], fils[n], n + ' : connexions créées ' + JSON.stringify(jeu.fils))
        assert.equal(jeu.etats[n], 'open', n + ' : état final')
      }
      assert.equal(jeu.requete, 'tenue', 'la requête a reçu sa réponse')
    })

    it('c. un reffet qui lit lui-même l\'état de la connexion repart à chaque changement d\'état', () => {
      assert.deepEqual(jeu.vus['lit-etat'], ['closed', 'connecting', 'open', 'reconnecting', 'open'])
      assert.deepEqual(jeu.vus['lit-connecte'], [false, false, true, false, true])
    })

    it('c. le gabarit qui affiche l\'état et une valeur dérivée qui le lit suivent la connexion', () => {
      assert.deepEqual(jeu.textes.gabarit, ['closed', 'connecting', 'open', 'reconnecting', 'open'])
      assert.deepEqual(jeu.textes.derivee, ['closed', 'connecting', 'open', 'reconnecting', 'open'])
    })

    it('d. témoin sans appel de méthode : un passage au montage, sa connexion fermée par le serveur puis rouverte', () => {
      assert.equal(jeu.passages.temoin, 1, 'passages du témoin')
      assert.equal(jeu.fils[ADRESSE + 'temoin'], 2, 'connexions du témoin')
      assert.equal(jeu.etats.temoin, 'open', 'état final du témoin')
    })

    it('aucun avertissement ni erreur en console', () => {
      assert.deepEqual(jeu.alertes, [])
    })
  })
}
