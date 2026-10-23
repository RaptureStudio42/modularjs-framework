// Un nom piégé venu du réseau (`__proto__`, `constructor`, `prototype` : un pair de présence, une clé de flux, une entité
// lissée par `µ.smooth`) n'est contrôlé qu'une fois côté navigateur, au plus près de l'état : par l'état réactif (µ.state)
// qui range ces données et refuse toujours ces trois noms. Le client temps réel et `µ.smooth` ne les vérifient plus
// eux-mêmes avant d'écrire (un même contrôle fait deux fois) ; la protection reste entière : rien n'atteint
// `Object.prototype`, aucun de ces noms n'entre dans l'état, et le refus est dit une fois par nom pendant le développement,
// par l'état. Un échantillon non fini (`1e309`) reste écarté par `µ.smooth`. Développement et production, vrai runtime.
// Faux WebSocket : les trames du serveur sont jouées à la main.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

const SOURCE = `<script lang="js">
  @ouvrir = function() { const s = µ.socket('wss://noms.test/ws', { reconnect: { enabled: false } }); s.connect(); window.__sock = s; return true; };
  @presence = function() { return window.__sock.presence('salon'); };
  @flux = function() { return window.__sock.stream('flux'); };
  @lisse = function(txt) { window.__lnr = µ.smooth(JSON.parse(txt), { delay: 0 }); return window.__lnr; };
</script>
<p class="etat">reseau</p>
`

async function construire(prefixe: string, prod: boolean): Promise<string> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'noms-reseau.mjs'), SOURCE)
  const opts: any = prod ? { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env: 'prod', js: 'bundle' } : { sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') }
  const bundler = new Bundler(opts)
  const stats   = await bundler.compile()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [])
  await bundler.close()
  if (prod) return readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
  const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b))
  return files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
}

const FAUX_WS = `window.__ws = []; window.WebSocket = class { constructor(url) { this.url = url; this.readyState = 0; window.__ws.push(this) } send() {} close() { this.readyState = 3 } };
window.WebSocket.CONNECTING = 0; window.WebSocket.OPEN = 1; window.WebSocket.CLOSING = 2; window.WebSocket.CLOSED = 3;`

async function monter(code: string, prod: boolean) {
  const window: any = new Window({ url: 'http://localhost/' })
  const traces: string[] = []
  const avis: string[] = []
  window.console.log  = (...a: any[]) => { traces.push(a.map(String).join(' ')) }
  window.console.warn = (...a: any[]) => { avis.push(a.map(String).join(' ')) }
  window.eval(FAUX_WS)
  window.eval(prod ? code : `${code}\nglobalThis.µ = µ;`)
  window.document.body.innerHTML = '<mjs-noms-reseau></mjs-noms-reseau>'
  const c   = window.document.querySelector('mjs-noms-reseau')
  const fin = Date.now() + 3000
  while (!c._shadow?.querySelector('.etat') && Date.now() < fin) await pause(10)
  c.ouvrir()
  const ws = window.__ws[window.__ws.length - 1]
  ws.readyState = 1
  ws.onopen && ws.onopen({})
  const recevoir = (texte: string) => { ws.onmessage && ws.onmessage({ data: texte }) }
  recevoir('{"t":"µ:welcome","p":{}}')
  return { window, c, recevoir, traces, avis }
}

// rien n'a atteint les prototypes et les fonctions de la page
function intacts(window: any): void {
  assert.equal(window.eval('({}).admin'), undefined, 'Object.prototype intact')
  assert.equal(window.eval('Object.admin'), undefined, 'Object intact')
  assert.equal(window.eval('Object.prototype.hasOwnProperty.call(Object.prototype, "x")'), false)
}

describe('réseau : un nom piégé n\'est contrôlé qu\'une fois, par l\'état qui range les données', function () {
  this.timeout(120000)
  const codes: Record<string, string> = {}

  before(async function () {
    this.timeout(240000)
    codes.dev  = await construire('noms-reseau', false)
    codes.prod = await construire('noms-reseau-prod', true)
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const mode of ['dev', 'prod']) {
    const dev = mode === 'dev'
    it(`${dev ? 'développement' : 'production'} : présence et flux — les trois noms écartés par l'état, prototypes intacts`, async () => {
      const m = await monter(codes[mode], !dev)
      const gens = m.c.presence()
      for (const id of ['__proto__', 'constructor', 'prototype', 'toString']) m.recevoir(JSON.stringify({ t: 'µ:presence', p: { room: 'salon', op: 'join', id, meta: { nom: id, admin: true } } }))
      assert.deepEqual(Object.keys(gens), ['toString'])
      m.recevoir('{"t":"µ:presence","p":{"room":"salon","op":"reset","peers":{"a":{},"__proto__":{"admin":true},"constructor":{"admin":true}}}}')
      assert.deepEqual(Object.keys(gens), ['a'])
      assert.equal(gens.admin, undefined, 'l\'état n\'hérite de rien')
      m.recevoir(JSON.stringify({ t: 'µ:presence', p: { room: 'salon', op: 'leave', id: 'constructor' } }))
      const flux = m.c.flux()
      let seq = 0
      for (const key of ['__proto__', 'constructor', 'prototype']) {
        m.recevoir(JSON.stringify({ t: 'flux', seq: ++seq, p: { op: 'add', key, value: { admin: true } } }))
        m.recevoir(JSON.stringify({ t: 'flux', seq: ++seq, p: { op: 'update', key, patch: { admin: true } } }))
        m.recevoir(JSON.stringify({ t: 'flux', seq: ++seq, p: { op: 'remove', key } }))
      }
      m.recevoir(`{"t":"flux","seq":${++seq},"p":{"op":"add","key":"__proto__","value":{"x":1}}}`)
      m.recevoir(`{"t":"flux","seq":${++seq},"p":{"op":"reset","values":{"b":{"v":1},"__proto__":{"admin":true},"constructor":{"admin":true}}}}`)
      m.recevoir(JSON.stringify({ t: 'flux', seq: ++seq, p: { op: 'add', key: 'toString', value: { v: 2 } } }))
      assert.deepEqual(Object.keys(flux).sort(), ['b', 'toString'])
      assert.equal(flux.admin, undefined)
      intacts(m.window)
      if (dev) {
        const refus = m.traces.filter((t) => t.includes('clé refusée'))
        assert.ok(refus.length > 0, 'le refus est dit pendant le développement')
        assert.deepEqual(refus.filter((t) => !t.startsWith('[ModularJS] ')), [], 'dit par l\'état, une seule fois par nom et par état : ' + JSON.stringify(refus))
        assert.equal(refus.length, 3 + 3, 'trois noms pour la présence, trois pour le flux : ' + JSON.stringify(refus))
      }
    })

    it(`${dev ? 'développement' : 'production'} : µ.smooth — les entités de ces noms n'entrent pas dans l'état, une valeur non finie reste écartée`, async () => {
      const m = await monter(codes[mode], !dev)
      const sm = m.c.lisse('{"a": {"x": 1}, "toString": {"x": 2}, "constructor": {"x": 3, "admin": true}, "__proto__": {"x": 4, "admin": true}, "prototype": {"x": 5}, "b": {"x": 1e309}}')
      await pause(400)
      assert.deepEqual(Object.keys(sm).sort(), ['a', 'toString'], 'les entités ordinaires sont lissées, l\'échantillon non fini écarté')
      assert.equal(sm.admin, undefined)
      intacts(m.window)
      if (dev) {
        const refus = m.traces.filter((t) => t.includes('clé refusée'))
        assert.deepEqual(refus.filter((t) => !t.startsWith('[ModularJS] ')), [], 'dit par l\'état qui reçoit les entités : ' + JSON.stringify(refus))
        assert.equal(refus.length, 3, 'une trace par nom : ' + JSON.stringify(refus))
        assert.equal(m.avis.filter((t) => t.includes('non fini')).length, 1, 'valeur non finie : un avertissement ' + JSON.stringify(m.avis))
      }
      sm.dispose()
    })
  }
})
