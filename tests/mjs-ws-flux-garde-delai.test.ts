// Délai de garde des flux (`guardTimeout`) : une garde `canSubscribe` asynchrone qui ne répond jamais (appel au back perdu)
// laissait la connexion sans réponse — une demande n'avait ni état ni µ:error, une connexion abonnée retenue par une
// nouvelle évaluation ou par la vérification d'un départ ne recevait plus aucun delta, sans erreur, jusqu'à sa
// déconnexion. À l'échéance (5 s par défaut, réglable par flux), la garde compte comme un refus, appliqué par la règle
// commune des réponses de garde : µ:error clair là où un refus en reçoit un, un avertissement dans onLog. Une garde qui
// répond à temps est servie et son échéance tombe ; la course des réponses dans le désordre reste fermée (seule compte la
// dernière évaluation lancée). Horloge virtuelle : aucun test n'attend l'horloge réelle
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
    for (const [id, t] of timers) if (t.at <= target && t.at < at) { at = t.at; best = id }
    if (best < 0) break
    const t = timers.get(best)!; timers.delete(best)
    if (t.at > now) now = t.at
    t.fn()
    await flush()
  }
  now = target
  await flush()
}

async function banc(declarer: (app: any) => any) {
  timers.clear()
  const transport = new MemoryTransport()
  const journal: string[] = []
  const app = mjsWs({ transport, heartbeat: 0, onLog: (niveau: string, msg: string) => { journal.push(niveau + ' ' + msg) } })
  const flux = declarer(app)
  await app.listen()
  const ws = transport.connect({ url: 'ws://abonne/' })
  const trames: any[] = []
  ws.onmessage = (ev: any) => trames.push(JSON.parse(ev.data))
  const envoyer = async (t: string, p: unknown) => { ws.send(JSON.stringify({ t, p })); await flush() }
  await flush()
  await envoyer('µ:hello', { protocol: 1 })
  return { app, flux, journal, trames, envoyer, fermer: async () => { ws.close(); await flush() } }
}

async function arreter(app: any) {
  const arret = app.stop().catch(() => {})
  await advance(50)
  await arret
}

// ce que la connexion a reçu depuis l'indice `depuis` : µ:error, et les trames des flux (`reset`, `add:clé`)
const recu = (trames: any[], depuis: number): string[] => trames.slice(depuis)
  .map(f => f.t === 'µ:error' ? 'µ:error' : f.p && f.p.op ? f.p.op + (f.p.key ? ':' + f.p.key : '') : '')
  .filter(Boolean)
const jamais = () => new Promise<boolean>(() => {})
const delaiDepasse = () => t('ws.streams.garde-sans-reponse')

describe('MJS-WS — flux : délai de garde (guardTimeout)', function () {
  this.timeout(20000)
  before(poserHorloge)
  after(rendreHorloge)

  it('garde qui ne répond jamais : refus à l’échéance par défaut (5 s), µ:error clair, un avertissement dans onLog', async () => {
    const b = await banc(app => app.stream('partie', { canSubscribe: jamais }))
    try {
      const depart = b.trames.length
      await b.envoyer('µ:sub-stream', { stream: 'partie' })
      await advance(4999)
      assert.deepEqual(b.trames.slice(depart), [], 'avant l’échéance : rien')
      await advance(1)
      assert.deepEqual(b.trames.slice(depart), [{ t: 'µ:error', p: { message: delaiDepasse(), code: 'stream-denied', stream: 'partie' } }])
      assert.ok(b.journal.some(l => l.startsWith('warn ') && l.includes("'partie'") && l.includes('guardTimeout')), b.journal.join('\n'))
      b.flux.add('a', 1); await flush()
      assert.equal(b.trames.length, depart + 1, 'rien du flux ensuite')
    } finally {
      await arreter(b.app)
    }
  })

  it('abonnée retenue par une évaluation sans réponse : refusée à l’échéance, plus figée — redemandé, le flux est servi', async () => {
    const plan = ['oui', 'jamais', 'jamais', 'oui']
    const b = await banc(app => app.stream('partie', { canSubscribe: () => plan.shift() === 'jamais' ? jamais() : Promise.resolve(true) }))
    try {
      await b.envoyer('µ:sub-stream', { stream: 'partie' })
      b.flux.add('a', 1); await flush()
      const depart = b.trames.length
      await b.envoyer('µ:sub-stream', { stream: 'partie' })   // la garde ne répond pas : les deltas passent encore
      b.flux.add('b', 2); await flush()
      await advance(1000)
      await b.envoyer('µ:sub-stream', { stream: 'partie' })   // la précédente attend toujours : la connexion est retenue
      b.flux.add('c', 3); await flush()
      await advance(4000)                                       // échéance de la première, dépassée : ignorée
      b.flux.add('d', 4); await flush()
      assert.deepEqual(recu(b.trames, depart), ['add:b'], 'retenue : rien du flux')
      await advance(1000)                                       // échéance de la dernière : refus
      assert.deepEqual(recu(b.trames, depart), ['add:b', 'µ:error'])
      assert.equal(b.trames.at(-1).p.message, delaiDepasse())
      b.flux.add('e', 5); await flush()
      await b.envoyer('µ:sub-stream', { stream: 'partie' })
      b.flux.add('f', 6); await flush()
      assert.deepEqual(recu(b.trames, depart), ['add:b', 'µ:error', 'reset', 'add:f'])
      assert.deepEqual(Object.keys(b.trames.at(-2).p.values), ['a', 'b', 'c', 'd', 'e'])
    } finally {
      await arreter(b.app)
    }
  })

  it('guardTimeout réglé sur le flux : refus à son terme, pas avant', async () => {
    const b = await banc(app => app.stream('partie', { canSubscribe: jamais, guardTimeout: 1000 }))
    try {
      const depart = b.trames.length
      await b.envoyer('µ:resync', { stream: 'partie', from: 0 })
      await advance(999)
      assert.deepEqual(b.trames.slice(depart), [])
      await advance(1)
      assert.deepEqual(b.trames.slice(depart), [{ t: 'µ:error', p: { message: delaiDepasse(), code: 'stream-denied', stream: 'partie' } }])
    } finally {
      await arreter(b.app)
    }
  })

  it('garde qui répond avant l’échéance : servie, son échéance tombe, aucun refus ensuite', async () => {
    let repondre!: (ok: boolean) => void
    const b = await banc(app => app.stream('partie', { canSubscribe: () => new Promise<boolean>(res => { repondre = res }) }))
    try {
      const base = timers.size
      const depart = b.trames.length
      await b.envoyer('µ:sub-stream', { stream: 'partie' })
      await advance(4000)
      repondre(true); await flush()
      assert.equal(timers.size, base, 'aucune minuterie ne reste')
      await advance(10000)
      b.flux.add('a', 1); await flush()
      assert.deepEqual(recu(b.trames, depart), ['reset', 'add:a'])
    } finally {
      await arreter(b.app)
    }
  })

  describe('la course des demandes répondues dans le désordre reste fermée', () => {
    async function course() {
      const attentes: Array<(ok: boolean) => void> = []
      const b = await banc(app => app.stream('reserve', { canSubscribe: () => new Promise<boolean>(res => attentes.push(res)) }))
      b.flux.add('avant', 1)
      const depart = b.trames.length
      await b.envoyer('µ:resync', { stream: 'reserve', from: 0 })
      await advance(1000)
      await b.envoyer('µ:sub-stream', { stream: 'reserve' })
      await advance(4000)   // échéance de la plus ancienne, dépassée par la récente : ignorée
      assert.deepEqual(recu(b.trames, depart), [])
      return { ...b, attentes, depart }
    }

    it('l’ancienne arrive à échéance puis dit « oui » en retard, la récente refuse : son µ:error seul, rien du flux', async () => {
      const b = await course()
      try {
        b.attentes[0](true); await flush()
        await advance(500)
        b.attentes[1](false); await flush()
        b.flux.add('apres', 2); await flush()
        assert.deepEqual(recu(b.trames, b.depart), ['µ:error'])
        assert.equal(b.trames.at(-1).p.message, t('ws.streams.acces-flux-refuse'))
      } finally {
        await arreter(b.app)
      }
    })

    it('la récente arrive à échéance, l’ancienne dit « oui » ensuite : le µ:error du délai seul, rien du flux', async () => {
      const b = await course()
      try {
        await advance(1000)
        assert.deepEqual(recu(b.trames, b.depart), ['µ:error'])
        assert.equal(b.trames.at(-1).p.message, delaiDepasse())
        b.attentes[0](true); b.attentes[1](true); await flush()
        b.flux.add('apres', 2); await flush()
        assert.deepEqual(recu(b.trames, b.depart), ['µ:error'])
      } finally {
        await arreter(b.app)
      }
    })

    it('l’ancienne arrive à échéance, la récente accepte : servie, sans µ:error', async () => {
      const b = await course()
      try {
        b.attentes[1](true); await flush()
        b.attentes[0](false); await flush()
        b.flux.add('apres', 2); await flush()
        assert.deepEqual(recu(b.trames, b.depart), ['reset', 'add:apres'])
      } finally {
        await arreter(b.app)
      }
    })
  })

  it('destroy() pendant la garde : l’échéance tombe avec le flux, rien n’est envoyé', async () => {
    const b = await banc(app => app.stream('partie', { canSubscribe: jamais }))
    try {
      const base = timers.size
      const depart = b.trames.length
      await b.envoyer('µ:sub-stream', { stream: 'partie' })
      b.flux.destroy()
      assert.equal(timers.size, base, 'aucune minuterie ne reste')
      await advance(10000)
      assert.deepEqual(b.trames.slice(depart), [])
    } finally {
      await arreter(b.app)
    }
  })

  it('déconnexion pendant la garde : l’échéance tombe avec la connexion', async () => {
    const b = await banc(app => app.stream('partie', { canSubscribe: jamais }))
    try {
      const base = timers.size
      await b.envoyer('µ:sub-stream', { stream: 'partie' })
      await b.fermer()
      assert.equal(timers.size, base, 'aucune minuterie ne reste')
    } finally {
      await arreter(b.app)
    }
  })

  it('vérification au départ d’un salon sans réponse : à l’échéance, écartée en silence hors du salon ; revenue, la garde repassée la sert', async () => {
    let attendre = false
    const b = await banc(app => app.stream('tribune', { canSubscribe: (c: any) => {
      const dedans = app.room('R1').has(c)
      return attendre ? jamais() : Promise.resolve(dedans)
    } }))
    try {
      await b.envoyer('µ:join', { room: 'R1' })
      await b.envoyer('µ:sub-stream', { stream: 'tribune' })
      b.flux.add('a', 1); await flush()
      attendre = true
      const depart = b.trames.length
      await b.envoyer('µ:leave', { room: 'R1' })   // vérification lancée : la connexion est retenue
      b.flux.add('b', 2); await flush()
      await advance(5000)
      assert.deepEqual(recu(b.trames, depart), [], 'hors du salon lu : écartée en silence')
      attendre = false
      await b.envoyer('µ:join', { room: 'R1' })
      await advance(2000)
      b.flux.add('c', 3); await flush()
      assert.deepEqual(recu(b.trames, depart), ['reset', 'add:c'])
      assert.deepEqual(Object.keys(b.trames.at(-2).p.values), ['a', 'b'])
    } finally {
      await arreter(b.app)
    }
  })

  it('réglage invalide : refusé à la déclaration ; une valeur au-delà de ce qu’une minuterie tient est bornée', async () => {
    const b = await banc(() => null)
    try {
      for (const v of [0, -1, 1.5, NaN, Infinity, '5000', null]) {
        assert.throws(() => b.app.stream('x', { canSubscribe: () => true, guardTimeout: v }), /guardTimeout/, String(v))
      }
      const partie = b.app.stream('partie', { canSubscribe: jamais, guardTimeout: 1e12 })
      const depart = b.trames.length
      await b.envoyer('µ:sub-stream', { stream: 'partie' })
      await advance(10000)
      assert.deepEqual(b.trames.slice(depart), [], 'une minuterie trop longue ne part pas tout de suite')
      partie.destroy()
    } finally {
      await arreter(b.app)
    }
  })
})
