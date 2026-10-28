// Le refus d'un flux nomme le flux : `µ:error { message, code: 'stream-denied', stream }`, comme le refus d'un salon
// nomme son salon. Une garde `canSubscribe` sans réponse dans son délai (`guardTimeout`, 5 s par défaut) n'était refusée
// que par un `µ:error { message }` anonyme : le client remplissait `lastError` sans savoir quel flux avait échoué. Même
// forme pour toutes les causes (garde qui refuse, garde trop lente, salon, flux fermé), demande neuve comme abonné déjà
// inscrit qui perd son flux parce qu'une garde posée après coup n'a pas répondu à temps (la règle commune des réponses :
// l'échéance compte comme un refus) ; la réponse arrivée après l'échéance ne rend rien. Horloge virtuelle
import assert from 'node:assert/strict'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { t } from '../src/messages/index.js'

// horloge virtuelle : Date.now, setTimeout, clearTimeout (posée le temps de ces tests, rendue ensuite)
let now = 1_700_000_000_000
const timers = new Map<number, { at: number; fn: () => void }>()
let nextTimer = 1
const vraies = { now: Date.now, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout }
function poserHorloge(): void {
  Date.now = () => now
  ;(globalThis as any).setTimeout = (fn: any, ms?: number, ...args: any[]) => {
    const id = nextTimer++
    timers.set(id, { at: now + Math.max(0, Number(ms) || 0), fn: () => fn(...args) })
    return { id, unref() { return this }, ref() { return this }, hasRef() { return false }, [Symbol.toPrimitive]() { return id } }
  }
  ;(globalThis as any).clearTimeout = (h: any) => { if (h == null) return; timers.delete(typeof h === 'object' ? h.id : Number(h)) }
}
function rendreHorloge(): void {
  Date.now = vraies.now
  globalThis.setTimeout = vraies.setTimeout
  globalThis.clearTimeout = vraies.clearTimeout
}
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r)) }
async function advance(ms: number) {
  const target = now + ms
  for (;;) {
    let best = -1, at = Infinity
    for (const [id, tm] of timers) if (tm.at <= target && tm.at < at) { at = tm.at; best = id }
    if (best < 0) break
    const tm = timers.get(best)!; timers.delete(best)
    if (tm.at > now) now = tm.at
    tm.fn()
    await flush()
  }
  now = target
  await flush()
}

async function banc(declarer: (app: any) => any, opts: any = {}) {
  timers.clear()
  const transport = new MemoryTransport()
  const app = mjsWs({ transport, heartbeat: 0, onLog: () => {}, ...opts })
  const flux = declarer(app)
  await app.listen()
  const ws = transport.connect({ url: 'ws://abonne/' })
  const trames: any[] = []
  ws.onmessage = (ev: any) => trames.push(JSON.parse(ev.data))
  const envoyer = async (type: string, p: unknown) => { ws.send(JSON.stringify({ t: type, p })); await flush() }
  await flush()
  await envoyer('µ:hello', { protocol: 1 })
  return { app, flux, trames, envoyer }
}
async function arreter(app: any) { const arret = app.stop().catch(() => {}); await advance(50); await arret }
const apres = (ms: number, v: boolean) => () => new Promise<boolean>(r => setTimeout(() => r(v), ms))
const erreurs = (trames: any[], depuis: number) => trames.slice(depuis).filter(f => f.t === 'µ:error').map(f => f.p)
const deltas = (trames: any[], depuis: number, nom: string) => trames.slice(depuis).filter(f => f.t === nom).map(f => f.p.op + (f.p.key ? ':' + f.p.key : ''))
const refus = (stream: string) => ({ message: t('ws.streams.acces-flux-refuse'), code: 'stream-denied', stream })
const refusEchu = (stream: string) => ({ message: t('ws.streams.garde-sans-reponse'), code: 'stream-denied', stream })

describe('MJS-WS — flux : le refus nomme le flux (µ:error code stream-denied)', function () {
  this.timeout(20000)
  before(poserHorloge)
  after(rendreHorloge)

  it('garde trop lente (6 s contre 5 s par défaut), demande neuve : le µ:error nomme le flux, la réponse tardive ne rend rien', async () => {
    const b = await banc(app => app.stream('partie', { canSubscribe: apres(6000, true) }))
    try {
      b.flux.add('a', 1)
      const depart = b.trames.length
      await b.envoyer('µ:sub-stream', { stream: 'partie' })
      await advance(4999)
      assert.deepEqual(b.trames.slice(depart), [], 'avant l’échéance : rien')
      await advance(1)
      assert.deepEqual(erreurs(b.trames, depart), [refusEchu('partie')])
      await advance(2000)
      b.flux.add('b', 2); await flush()
      assert.deepEqual(deltas(b.trames, depart, 'partie'), [], 'le « oui » arrivé à 6 s ne sert rien')
    } finally {
      await arreter(b.app)
    }
  })

  it('refus de la garde, flux réservé à un salon, flux fermé : même forme, chacun nommé', async () => {
    const b = await banc(app => {
      app.stream('garde', { canSubscribe: () => false })
      app.stream('garde-async', { canSubscribe: async () => false })
      app.stream('salon-x', { room: 'salon-x' })
      return app.stream('ferme')
    })
    try {
      const depart = b.trames.length
      for (const stream of ['garde', 'garde-async', 'salon-x', 'ferme']) await b.envoyer('µ:sub-stream', { stream })
      await b.envoyer('µ:resync', { stream: 'garde', from: 3 })
      assert.deepEqual(erreurs(b.trames, depart), [refus('garde'), refus('garde-async'), refus('salon-x'), refus('ferme'), refus('garde')])
    } finally {
      await arreter(b.app)
    }
  })

  it('abonné déjà inscrit, garde posée après coup trop lente : il perd le flux, le µ:error le nomme, rien ne le lui rend', async () => {
    const b = await banc(app => app.stream('partie', { public: true }))
    try {
      await b.envoyer('µ:sub-stream', { stream: 'partie' })
      b.flux.add('a', 1); await flush()
      const depart = b.trames.length
      b.app.stream('partie', { canSubscribe: apres(6000, true) })
      await flush()
      b.flux.add('b', 2); await flush()
      assert.deepEqual(b.trames.slice(depart), [], 'retenu pendant la vérification : rien du flux')
      await advance(5000)
      assert.deepEqual(erreurs(b.trames, depart), [refusEchu('partie')], 'à l’échéance : refusé, le flux nommé')
      await advance(2000)
      b.flux.add('c', 3); await flush()
      assert.deepEqual(deltas(b.trames, depart, 'partie'), [], 'ni le delta retenu, ni la suite, ni la réponse tardive')
      await b.envoyer('µ:sub-stream', { stream: 'partie' })
      await advance(5000)
      assert.deepEqual(erreurs(b.trames, depart), [refusEchu('partie'), refusEchu('partie')], 'redemandé : la garde est repassée, toujours trop lente')
    } finally {
      await arreter(b.app)
    }
  })

  it('garde qui répond dans son délai : servie, aucun µ:error', async () => {
    const b = await banc(app => app.stream('partie', { canSubscribe: apres(4000, true) }))
    try {
      b.flux.add('a', 1)
      const depart = b.trames.length
      await b.envoyer('µ:sub-stream', { stream: 'partie' })
      await advance(4000)
      assert.deepEqual(erreurs(b.trames, depart), [])
      assert.deepEqual(deltas(b.trames, depart, 'partie'), ['reset'])
    } finally {
      await arreter(b.app)
    }
  })
})
