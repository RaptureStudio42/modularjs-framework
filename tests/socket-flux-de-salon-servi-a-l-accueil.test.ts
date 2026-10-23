// Le vrai client du framework (runtime/mjs_socket.ts) contre le vrai serveur : un flux réservé à un salon (`room`) ou gardé
// par l'appartenance au salon (garde synchrone), ouvert avant que la connexion ne soit prête (connexion paresseuse, le cas
// courant), n'était jamais servi. Au µ:welcome, le client envoyait ses demandes de flux avant ses µ:join : lue hors du
// salon, la demande était refusée sur-le-champ (un µ:error, puis plus rien). Même chose après une reconnexion sans
// reprise. Le client entre désormais dans ses salons avant de redemander ses flux
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')
const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

describe('µ.socket — flux de salon servi à l’accueil, à la première connexion comme après une reconnexion', function () {
  this.timeout(10000)
  const vraiWebSocket = (globalThis as any).WebSocket
  after(() => { (globalThis as any).WebSocket = vraiWebSocket })

  const cas: Array<[string, (app: any) => any]> = [
    ['flux réservé au salon (room)', () => ({ room: 'partie' })],
    ['garde synchrone qui lit le salon', (app) => ({ canSubscribe: (c: any) => app.room('partie').has(c) })],
  ]
  for (const [nom, optsDe] of cas) {
    it(nom, async () => {
      const transport = new MemoryTransport()
      const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
      const partie = app.stream('partie', optsDe(app))
      await app.listen()
      const envois: string[] = []
      let courant: any = null
      // pont entre le WebSocket du navigateur et le transport mémoire du serveur
      class WS {
        static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3
        readyState = 0; onopen: any; onmessage: any; onclose: any; onerror: any; w: any
        constructor(url: string) {
          // le test garde la connexion que la page vient d'ouvrir
          // eslint-disable-next-line @typescript-eslint/no-this-alias
          courant = this
          const w = transport.connect({ url })
          this.w = w
          w.onopen = () => { this.readyState = 1; this.onopen && this.onopen({}) }
          w.onmessage = (ev: any) => this.onmessage && this.onmessage({ data: ev.data })
          w.onclose = () => { this.readyState = 3; this.onclose && this.onclose({ code: 1006 }) }
        }
        send(d: string) { const m = JSON.parse(d); if (m.t === 'µ:join' || m.t === 'µ:sub-stream' || m.t === 'µ:resync') envois.push(m.t); this.w.send(d) }
        close() { this.readyState = 3; this.w.close() }
      }
      ;(globalThis as any).WebSocket = WS
      const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
      new Function('µ', src)(µ)
      const sock = µ.socket('ws://partie/', { reconnect: { backoff: [20], jitter: 0 } })
      try {
        sock.room('partie')                    // la vue de la partie entre dans le salon…
        const etat = sock.stream('partie')     // … et suit son flux, avant que la connexion ne soit prête
        await tick(50)
        partie.add('coup-1', 1)
        await tick(20)
        assert.deepEqual(envois, ['µ:join', 'µ:sub-stream'], 'le salon d’abord, puis le flux')
        assert.deepEqual(Object.keys(etat), ['coup-1'], 'première connexion : le flux est servi')
        envois.length = 0
        courant.w.close()                      // coupure réseau : reconnexion sans reprise de session
        await tick(10)
        partie.add('coup-pendant-la-coupure', 2)
        await tick(300)
        partie.add('coup-2', 3)
        await tick(30)
        assert.deepEqual(envois, ['µ:join', 'µ:resync'], 'à la reconnexion aussi, le salon d’abord')
        assert.deepEqual(Object.keys(etat), ['coup-1', 'coup-pendant-la-coupure', 'coup-2'], 'après la reconnexion : le flux est rattrapé')
      } finally {
        sock.close()
        await app.stop()
      }
    })
  }
})
