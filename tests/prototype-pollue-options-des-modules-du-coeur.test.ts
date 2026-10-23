// Un prototype pollué (`Object.prototype.html = …`, posé par exemple par `$$prefs[section][champ] = v` avec une
// section venue de données qui vaut `'__proto__'`) ne doit pas devenir une option des modules du cœur : une option
// que l'appelant n'a pas donnée vaut l'absence d'option, jamais la valeur héritée. Avant le correctif, la modale
// posait ce HTML (`µ.modal.fire({ title, text })`), le toast devenait un lien et chargeait une image d'un tiers,
// `µ.ajax` envoyait les clés polluées comme en-têtes et un corps sur un GET, `µ.socket` demandait un sous-protocole
// et envoyait une identité au serveur que l'appli n'avait jamais données
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const BALISE = 'mjs-options-propres'
const SOURCE = `<script>
  @ouvrir = -> µ.modal.fire({ title: 'Info', text: 'Bonjour' })
  @fermer = -> µ.modal.close()
  @notifier = -> µ.modal.notify('Salut')
  @charger = -> µ.ajax.get('/donnees', (-> null), (-> null))
  @envoyerOctets = -> µ.ajax.binary('/octets', { headers: { 'X-Appli': 'oui' } })
  @brancher = -> µ.socket('ws://localhost/canal')
</script>
<p class="pret">pret</p>
`
const CHARGE = '<img src="x" onerror="window.__xss = 1">'

async function construire(prefixe: string, prod: boolean): Promise<string> {
  const root = mjsTmp(prefixe), srcDir = join(root, 'src'), outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'options-propres.mjs'), SOURCE)
  const opts: any = prod ? { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env: 'prod', js: 'bundle' } : { sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') }
  const bundler = new Bundler(opts)
  const stats = await bundler.compile()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [])
  await bundler.close()
  if (prod) return readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
  const rang = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b))
  return files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
}

// les valeurs polluées sont des chaînes : un objet posé sur le prototype se retrouve sous ses propres clés, sans fin,
// dans tout parcours `for…in` d'un objet qui descend dans ses valeurs
// faux WebSocket et faux fetch, dans le realm de la page : ils notent ce que le runtime leur passe
const FAUX_RESEAU = `
  window.__ws = [];
  window.__envois = [];
  window.WebSocket = function(url, protocols) { this.url = url; this.protocols = protocols; this.readyState = 0; this.sent = []; this.l = {}; window.__ws.push(this); };
  WebSocket.CONNECTING = 0; WebSocket.OPEN = 1; WebSocket.CLOSING = 2; WebSocket.CLOSED = 3;
  WebSocket.prototype.send = function(m) { this.sent.push(m); };
  WebSocket.prototype.close = function() { this.readyState = 3; };
  WebSocket.prototype.addEventListener = function(t, f) { (this.l[t] = this.l[t] || []).push(f); };
  WebSocket.prototype.removeEventListener = function() {};
  window.__ouvrirWs = function(ws) { ws.readyState = 1; var e = { type: 'open' }; if (ws.onopen) ws.onopen(e); (ws.l.open || []).forEach(function(f) { f(e); }); };
  window.fetch = function(url, o) {
    window.__envois.push({ url: String(url), method: o && o.method, cles: Object.keys((o && o.headers) || {}), corps: o && o.body });
    return Promise.resolve({ status: 204, ok: true, url: String(url), headers: { get: function() { return null; } }, text: function() { return Promise.resolve(''); }, json: function() { return Promise.resolve(null); }, arrayBuffer: function() { return Promise.resolve(new ArrayBuffer(0)); } });
  };
`
const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('prototype pollué : les modules du cœur ne lisent que les options propres de leur appelant', function () {
  this.timeout(180000)
  const codes: Record<string, string> = {}
  before(async function () {
    this.timeout(240000)
    codes.dev = await construire('options-propres-dev', false)
    codes.prod = await construire('options-propres-prod', true)
  })
  after(async () => { await terminateSharedWorkerPool() })

  for (const mode of ['dev', 'prod']) {
    describe(mode === 'dev' ? 'développement' : 'production', function () {
      let window: any, c: any
      const polluer = (cles: Record<string, any>) => window.eval(Object.keys(cles).map((k) => `Object.prototype[${JSON.stringify(k)}] = ${JSON.stringify(cles[k])};`).join('\n'))
      const nettoyer = (cles: Record<string, any>) => window.eval(Object.keys(cles).map((k) => `delete Object.prototype[${JSON.stringify(k)}];`).join('\n'))
      const sous = async (cles: Record<string, any>, f: () => Promise<void>) => {
        polluer(cles)
        try { await f() } finally { nettoyer(cles) }
      }

      beforeEach(async () => {
        window = new Window({ url: 'http://localhost/' })
        window.eval(FAUX_RESEAU)
        window.eval(codes[mode])
        window.document.body.innerHTML = `<${BALISE}></${BALISE}>`
        c = window.document.querySelector(BALISE)
        const fin = Date.now() + 5000
        while (!c._shadow?.querySelector('.pret') && Date.now() < fin) await attendre(10)
        assert.equal(!!c._shadow?.querySelector('.pret'), true, 'composant monté')
      })
      afterEach(async () => { await window.happyDOM.close() })

      it('µ.modal.fire({ title, text }) : aucun HTML hérité', async () => {
        await sous({ html: CHARGE }, async () => {
          c.ouvrir()
          await attendre(20)
          const contenu = window.document.querySelector('.mjs-modal-content')
          assert.equal(!!contenu, true, 'la modale est ouverte')
          assert.equal(contenu.innerHTML, 'Bonjour', 'le texte de l\'appelant, posé en texte')
          c.fermer()
        })
      })

      it('µ.modal.notify(message) : ni lien ni image hérités', async () => {
        await sous({ href: 'https://tiers.example/piege', icon: 'https://tiers.example/pixel.gif' }, async () => {
          c.notifier()
          await attendre(20)
          const toast = window.document.querySelector('.mjs-toast')
          assert.equal(!!toast, true, 'le toast est affiché')
          assert.equal(!!toast.querySelector('.mjs-toast-action'), false, 'le toast n\'est pas devenu un lien')
          assert.equal(!!toast.querySelector('img'), false, 'aucune image d\'un tiers')
        })
      })

      it('µ.ajax.get : ni en-tête ni corps hérités', async () => {
        await sous({ headers: 'X-Piege', data: 'piege' }, async () => {
          c.charger()
          await attendre(20)
          const e = window.__envois[0]
          assert.ok(e, 'la requête est partie')
          assert.equal(e.method, 'GET')
          assert.deepEqual(Array.from(e.cles as string[]).filter((k: string) => k !== 'Accept' && k !== 'X-Requested-With'), [], 'aucun en-tête hérité')
          assert.equal(e.corps, undefined, 'aucun corps sur un GET')
        })
      })

      it('µ.ajax.binary avec ses en-têtes : seuls les siens partent', async () => {
        await sous({ 'X-Glisse': 'oui' }, async () => {
          c.envoyerOctets()
          await attendre(20)
          const e = window.__envois[0]
          assert.ok(e, 'la requête est partie')
          assert.deepEqual(Array.from(e.cles as string[]).filter((k: string) => k !== 'Accept' && k !== 'X-Requested-With'), ['X-Appli'], 'les en-têtes de l\'appelant, rien d\'autre')
        })
      })

      it('µ.socket(adresse) : ni sous-protocole ni identité hérités', async () => {
        await sous({ protocols: 'piege', auth: 'jeton-du-tiers' }, async () => {
          const s = c.brancher()
          s.connect()
          await attendre(20)
          const ws = window.__ws[0]
          assert.ok(ws, 'la connexion est ouverte')
          assert.equal(ws.protocols, undefined, 'aucun sous-protocole hérité')
          window.__ouvrirWs(ws)
          await attendre(20)
          const bonjour = ws.sent.map((m: string) => JSON.parse(m)).find((m: any) => m.t === 'µ:hello')
          assert.ok(bonjour, 'le µ:hello est parti')
          assert.equal(bonjour.p.auth, undefined, 'aucune identité héritée envoyée au serveur')
        })
      })
    })
  }
})
