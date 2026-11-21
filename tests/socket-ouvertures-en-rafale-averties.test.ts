// Une connexion µsocket qui s'ouvre plus de 20 fois en une seconde le dit une fois, en développement : un µeffect la ferme et la rouvre
// sans doute à chaque passage (ici un reffet dans le doute, dans un composant qui affiche l'état de la connexion : il passe à chaque
// changement d'état), ou un gestionnaire la rouvre en rafale. Un avertissement par connexion, jamais redit pour elle ; rien n'est bloqué,
// les connexions s'ouvrent comme avant. Une reconnexion ordinaire (le serveur coupe cinq fois, l'attente croît) ne dit rien. En
// production, rien n'est dit. Vrais composants compilés par le Bundler, en développement et en production, montés dans happy-dom ;
// faux WebSocket qui compte ses connexions par adresse et s'ouvre en différé.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const ADRESSE = 'ws://rafale.test/'

const COMPOSANTS: Record<string, string> = {
  // un reffet dans le doute (son code d'après coup rouvre la connexion), dans un composant qui affiche l'état : il rouvre la connexion à
  // chaque passage, borné à quarante passages
  'doute': ['<script>', '$go = 0', `@@sock = µsocket('${ADRESSE}doute', { reconnect: { backoff: [30], jitter: 0 } })`, '', 'reopen = ->', '  @@sock.close()', '  @@sock.connect()', '', 'µeffect ->', '  window.__n.doute++', '  return unless $go', '  return if window.__n.doute > 40', '  Promise.resolve().then(-> reopen())', '  return', '', '@go = -> $go++', '</script>', '<p>{$go} {@sock.state}</p>', ''].join('\n'),
  // une connexion que le serveur coupe : elle se rouvre seule, l'attente croît
  'reprises': ['<script>', `@@sock = µsocket('${ADRESSE}reprises', { reconnect: { backoff: [20, 40, 80, 160, 320], jitter: 0 } })`, 'window.__s.reprises = @@sock', '</script>', '<p>reprises</p>', ''].join('\n'),
  // deux connexions qu'un gestionnaire ferme et rouvre vingt-cinq fois d'affilée
  'rafale': ['<script>', `@@a = µsocket('${ADRESSE}rafale-a', { reconnect: { backoff: [30], jitter: 0 } })`, `@@b = µsocket('${ADRESSE}rafale-b', { reconnect: { backoff: [30], jitter: 0 } })`, '', 'burst = (s) ->', '  i = 0', '  while i < 25', '    s.close()', '    s.connect()', '    i++', '  return', '', '@rafaleA = -> burst(@@a)', '@rafaleB = -> burst(@@b)', '</script>', '<p>rafale</p>', ''].join('\n'),
}

const NOMS = Object.keys(COMPOSANTS)

// s'ouvre 30 ms après sa création et accueille aussitôt ; `couper(adresse)` : le serveur ferme la dernière connexion ouverte de l'adresse
const FAUX_WS = `globalThis.__ws = { n: {}, tous: [] };
globalThis.__ws.couper = (u) => {
  const l = globalThis.__ws.tous.filter((w) => w.url === u && w.readyState === 1), w = l[l.length - 1];
  if (w) { w.readyState = 3; w.onclose && w.onclose({ code: 1006 }) }
};
globalThis.WebSocket = class {
  constructor(u) {
    this.url = u; this.readyState = 0;
    const c = globalThis.__ws; c.n[u] = (c.n[u] || 0) + 1; c.tous.push(this);
    setTimeout(() => { if (this.readyState !== 0) return; this.readyState = 1; this.onopen && this.onopen({}); this.onmessage && this.onmessage({ data: JSON.stringify({ t: 'µ:welcome', p: {} }) }) }, 30);
  }
  send() {}
  close() { this.readyState = 3 }
  addEventListener() {}
  removeEventListener() {}
};`

const SCENARIO = `(async () => {
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const el    = (n) => document.querySelector('mjs-rafale-' + n);
  const dites = (u) => window.__alertes.filter((a) => a.includes(u)).length;
  const R = {};
  el('doute').go();
  await pause(900);
  R.doute = { alertes: dites('${ADRESSE}doute'), fils: window.__ws.n['${ADRESSE}doute'] || 0, passages: window.__n.doute };
  const s = window.__s.reprises, u = '${ADRESSE}reprises';
  s.connect();
  for (let k = 0; k < 5; k++) {
    for (let t = 0; t < 200 && s.state !== 'open'; t++) await pause(10);
    window.__ws.couper(u);
  }
  for (let t = 0; t < 200 && s.state !== 'open'; t++) await pause(10);
  R.reprises = { alertes: dites(u), fils: window.__ws.n[u] || 0, etat: s.state };
  el('rafale').rafaleA();
  el('rafale').rafaleB();
  el('rafale').rafaleA();
  await pause(50);
  R.rafale = { a: dites('${ADRESSE}rafale-a'), b: dites('${ADRESSE}rafale-b'), filsA: window.__ws.n['${ADRESSE}rafale-a'] || 0, filsB: window.__ws.n['${ADRESSE}rafale-b'] || 0 };
  R.texte  = window.__alertes.find((a) => a.includes('${ADRESSE}rafale-a')) || '';
  R.toutes = window.__alertes.slice();
  return R;
})()`

async function construire(env: 'dev' | 'prod'): Promise<string> {
  const root   = mjsTmp('socket-rafale-' + env)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, texte] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, 'rafale-' + nom + '.mjs'), texte)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env, js: 'bundle' } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
}

async function jouer(code: string): Promise<any> {
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  window.document.documentElement.lang = 'fr'
  window.__alertes = []
  window.console.warn  = (...a: unknown[]) => { window.__alertes.push(a.map(String).join(' ')) }
  window.console.error = (...a: unknown[]) => { window.__alertes.push(a.map(String).join(' ')) }
  try {
    window.__n = { doute: 0 }
    window.__s = {}
    window.eval(FAUX_WS)
    window.eval(code)
    window.document.body.innerHTML = NOMS.map((n) => `<mjs-rafale-${n}></mjs-rafale-${n}>`).join('')
    const fin = Date.now() + 5000
    while (NOMS.some((n) => !window.document.querySelector('mjs-rafale-' + n)?._mjs_is_mounted) && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
    await new Promise((r) => setTimeout(r, 30))
    return JSON.parse(JSON.stringify(await window.eval(SCENARIO)))
  }
  finally {
    await window.happyDOM.close()
  }
}

after(async () => { await terminateSharedWorkerPool() })

for (const env of ['dev', 'prod'] as const) {
  const dev = env === 'dev'
  describe(`connexion µsocket ouverte plus de 20 fois en une seconde (${dev ? 'développement' : 'production'})`, function () {
    this.timeout(240000)
    let jeu: any
    before(async () => {
      jeu = await jouer(await construire(env))
    })

    it(dev ? 'le reffet dans le doute qui rouvre la connexion à chaque passage : un avertissement, la connexion s\'ouvre comme avant' : 'le reffet dans le doute qui rouvre la connexion à chaque passage : aucun avertissement, la connexion s\'ouvre comme avant', () => {
      assert.ok(jeu.doute.fils > 20, 'connexions ouvertes par le reffet : ' + JSON.stringify(jeu.doute))
      assert.equal(jeu.doute.alertes, dev ? 1 : 0, 'avertissements : ' + JSON.stringify(jeu.toutes))
    })

    it('une reconnexion ordinaire (le serveur coupe cinq fois, l\'attente croît) : aucun avertissement', () => {
      assert.equal(jeu.reprises.fils, 6, 'connexions : ' + JSON.stringify(jeu.reprises))
      assert.equal(jeu.reprises.etat, 'open')
      assert.equal(jeu.reprises.alertes, 0, 'avertissements : ' + JSON.stringify(jeu.toutes))
    })

    it(dev ? 'vingt-cinq close() puis connect() d\'affilée dans un gestionnaire : un avertissement par connexion, jamais redit' : 'vingt-cinq close() puis connect() d\'affilée dans un gestionnaire : aucun avertissement', () => {
      assert.deepEqual([jeu.rafale.filsA, jeu.rafale.filsB], [50, 25], 'connexions ouvertes')
      assert.deepEqual([jeu.rafale.a, jeu.rafale.b], dev ? [1, 1] : [0, 0], 'avertissements : ' + JSON.stringify(jeu.toutes))
      if (dev) assert.ok(jeu.texte.includes('la connexion s\'est ouverte plus de 20 fois en une seconde'), jeu.texte)
    })

    it('aucun autre avertissement ni erreur en console', () => {
      assert.equal(jeu.toutes.length, dev ? 3 : 0, JSON.stringify(jeu.toutes))
    })
  })
}
