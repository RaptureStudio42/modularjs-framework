// µ:unsub-stream — une connexion qui suit un flux s'en désabonne sans quitter de salon ni fermer la connexion : plus aucun
// delta. Rien de ce qu'elle attendait encore ne la réabonne ensuite (demande dont la garde asynchrone répond après coup,
// vérification en vol au départ d'un salon, flux rendu au retour dans le salon, flux écarté en silence par la garde) ; un
// second désabonnement ne change rien, un flux inconnu est refusé (µ:error, sans rien créer), et une nouvelle demande la
// réabonne. Avant, aucun message ne le permettait : `µ:unsub-stream` recevait « type inconnu », et la connexion restait
// abonnée jusqu'à son départ du salon ou sa déconnexion
import assert from 'node:assert/strict'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { t } from '../src/messages/index.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

async function connexion(transport: MemoryTransport): Promise<{ trames: any[]; envoyer: (t: string, p: unknown) => void }> {
  const ws = transport.connect({ url: 'ws://abonne/' })
  const trames: any[] = []
  ws.onmessage = (ev: any) => trames.push(JSON.parse(ev.data))
  const envoyer = (t: string, p: unknown) => ws.send(JSON.stringify({ t, p }))
  await tick()
  envoyer('µ:hello', { protocol: 1 })
  await tick(10)
  return { trames, envoyer }
}

// ce que la connexion a reçu depuis l'indice `depuis` : µ:error, et les trames du flux `nom` (`reset`, `add:clé`)
const recu = (trames: any[], depuis: number, nom: string): string[] => trames.slice(depuis)
  .map(f => f.t === 'µ:error' ? 'µ:error' : f.t === nom ? f.p.op + (f.p.key ? ':' + f.p.key : '') : '')
  .filter(Boolean)

async function banc() {
  const transport = new MemoryTransport()
  const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
  await app.listen()
  const c = await connexion(transport)
  return { app, ...c }
}

describe('MJS-WS — µ:unsub-stream : la connexion cesse de suivre un flux', function () {
  this.timeout(20000)

  it('flux public suivi : plus aucun delta après le désabonnement, sans aucune trame en retour', async () => {
    const b = await banc()
    try {
      const scores = b.app.stream('scores', { public: true })
      b.envoyer('µ:sub-stream', { stream: 'scores' }); await tick(10)
      scores.add('a', 1); await tick(10)
      assert.deepEqual(recu(b.trames, 0, 'scores'), ['reset', 'add:a'])
      const depart = b.trames.length
      b.envoyer('µ:unsub-stream', { stream: 'scores' }); await tick(10)
      scores.add('b', 2); scores.update('a', { v: 3 }); scores.reset({ c: 4 }); await tick(20)
      assert.deepEqual(b.trames.slice(depart), [], 'ni delta, ni µ:error')
    } finally {
      await b.app.stop()
    }
  })

  it('idempotent : un second désabonnement, ou celui d’un flux connu jamais suivi, ne renvoie rien', async () => {
    const b = await banc()
    try {
      const scores = b.app.stream('scores', { public: true })
      b.app.stream('ferme')
      b.app.stream('autre', { public: true })
      b.envoyer('µ:sub-stream', { stream: 'scores' }); await tick(10)
      const depart = b.trames.length
      b.envoyer('µ:unsub-stream', { stream: 'scores' }); await tick(10)
      b.envoyer('µ:unsub-stream', { stream: 'scores' }); await tick(10)
      b.envoyer('µ:unsub-stream', { stream: 'autre' }); await tick(10)
      b.envoyer('µ:unsub-stream', { stream: 'ferme' }); await tick(10)
      scores.add('b', 2); await tick(20)
      assert.deepEqual(b.trames.slice(depart), [])
    } finally {
      await b.app.stop()
    }
  })

  it('charge sans `stream` texte : ignorée en silence, comme µ:sub-stream', async () => {
    const b = await banc()
    try {
      const depart = b.trames.length
      b.envoyer('µ:unsub-stream', {}); await tick(10)
      b.envoyer('µ:unsub-stream', { stream: 42 }); await tick(10)
      b.envoyer('µ:unsub-stream', null); await tick(10)
      assert.deepEqual(b.trames.slice(depart), [])
    } finally {
      await b.app.stop()
    }
  })

  it('flux inconnu : refusé d’un µ:error, sans rien créer ; un nom trop long ne revient pas au client', async () => {
    const b = await banc()
    try {
      const depart = b.trames.length
      b.envoyer('µ:unsub-stream', { stream: 'jamais' }); await tick(10)
      const long = 'x'.repeat(300)
      b.envoyer('µ:unsub-stream', { stream: long }); await tick(10)
      const recues = b.trames.slice(depart)
      assert.deepEqual(recues.map(f => f.t), ['µ:error', 'µ:error'])
      assert.equal(recues[0].p.message, t('ws.streams.desabonnement-flux-inconnu'))
      assert.equal(recues[1].p.message, t('ws.streams.nom-trop-long', { max: 200 }))
      assert.ok(!JSON.stringify(recues).includes(long), 'le nom trop long n’est pas renvoyé')
      // rien n'a été créé : le flux reste inconnu (réponse honnête, état vide au seq 0)
      b.envoyer('µ:sub-stream', { stream: 'jamais' }); await tick(10)
      assert.deepEqual(b.trames.at(-1), { t: 'jamais', seq: 0, p: { op: 'reset', values: {} } })
    } finally {
      await b.app.stop()
    }
  })

  it('flux détruit puis désabonné : refusé comme un flux inconnu', async () => {
    const b = await banc()
    try {
      const scores = b.app.stream('scores', { public: true })
      b.envoyer('µ:sub-stream', { stream: 'scores' }); await tick(10)
      scores.destroy()
      const depart = b.trames.length
      b.envoyer('µ:unsub-stream', { stream: 'scores' }); await tick(10)
      assert.deepEqual(b.trames.slice(depart).map(f => f.t + ' ' + f.p.message), ['µ:error ' + t('ws.streams.desabonnement-flux-inconnu')])
    } finally {
      await b.app.stop()
    }
  })

  it('redemandé après le désabonnement : l’état complet, puis les deltas', async () => {
    const b = await banc()
    try {
      const scores = b.app.stream('scores', { public: true })
      b.envoyer('µ:sub-stream', { stream: 'scores' }); await tick(10)
      const avant = b.trames.length
      b.envoyer('µ:unsub-stream', { stream: 'scores' }); await tick(10)
      scores.add('a', 1); await tick(10)
      assert.deepEqual(b.trames.slice(avant), [], 'désabonnée : rien')
      const depart = b.trames.length
      b.envoyer('µ:sub-stream', { stream: 'scores' }); await tick(10)
      scores.add('b', 2); await tick(10)
      assert.deepEqual(recu(b.trames, depart, 'scores'), ['reset', 'add:b'])
      assert.deepEqual(b.trames[depart].p.values, { a: 1 })
    } finally {
      await b.app.stop()
    }
  })

  it('demande en attente d’une garde asynchrone : son « oui » après le désabonnement n’abonne pas', async () => {
    const b = await banc()
    try {
      const attentes: Array<(ok: boolean) => void> = []
      const reserve = b.app.stream('reserve', { canSubscribe: () => new Promise<boolean>(res => attentes.push(res)) })
      const depart = b.trames.length
      b.envoyer('µ:sub-stream', { stream: 'reserve' }); await tick(10)
      b.envoyer('µ:unsub-stream', { stream: 'reserve' }); await tick(10)
      attentes[0](true); await tick(10)
      reserve.add('a', 1); await tick(20)
      assert.deepEqual(b.trames.slice(depart), [], 'ni état, ni delta, ni µ:error')
    } finally {
      await b.app.stop()
    }
  })

  for (const reponse of [false, true]) {
    it(`redemande pendant la garde d’avant le désabonnement : seule la nouvelle compte (${reponse ? 'acceptée' : 'refusée'})`, async () => {
      const b = await banc()
      try {
        const attentes: Array<(ok: boolean) => void> = []
        const reserve = b.app.stream('reserve', { canSubscribe: () => new Promise<boolean>(res => attentes.push(res)) })
        reserve.add('avant', 1)
        const depart = b.trames.length
        b.envoyer('µ:sub-stream', { stream: 'reserve' }); await tick(10)
        b.envoyer('µ:unsub-stream', { stream: 'reserve' }); await tick(10)
        b.envoyer('µ:sub-stream', { stream: 'reserve' }); await tick(10)
        attentes[0](!reponse); await tick(10)
        assert.deepEqual(recu(b.trames, depart, 'reserve'), [], 'la réponse d’avant le désabonnement ne compte pas')
        attentes[1](reponse); await tick(10)
        reserve.add('apres', 2); await tick(20)
        assert.deepEqual(recu(b.trames, depart, 'reserve'), reponse ? ['reset', 'add:apres'] : ['µ:error'])
        if (!reponse) assert.equal(b.trames.at(-1).p.message, t('ws.streams.acces-flux-refuse'))
      } finally {
        await b.app.stop()
      }
    })
  }

  it('flux réservé à un salon : désabonnée hors du salon, elle n’est pas réabonnée à son retour', async () => {
    const b = await banc()
    try {
      const partie = b.app.stream('partie', { room: 'R1' })
      b.envoyer('µ:join', { room: 'R1' }); await tick(10)
      b.envoyer('µ:sub-stream', { stream: 'partie' }); await tick(10)
      partie.add('a', 1); await tick(10)
      assert.deepEqual(recu(b.trames, 0, 'partie'), ['reset', 'add:a'])
      const depart = b.trames.length
      b.envoyer('µ:leave', { room: 'R1' }); await tick(10)
      b.envoyer('µ:unsub-stream', { stream: 'partie' }); await tick(10)
      b.envoyer('µ:join', { room: 'R1' }); await tick(20)
      partie.add('b', 2); await tick(20)
      assert.deepEqual(recu(b.trames, depart, 'partie'), [], 'ni état complet au retour, ni delta')
    } finally {
      await b.app.stop()
    }
  })

  it('garde qui lit le salon : écartée en silence au départ puis désabonnée, l’entrée dans le salon ne lui rend rien', async () => {
    const b = await banc()
    try {
      const tribune = b.app.stream('tribune', { canSubscribe: (c: any) => b.app.room('R1').has(c) })
      b.envoyer('µ:join', { room: 'R1' }); await tick(10)
      b.envoyer('µ:sub-stream', { stream: 'tribune' }); await tick(10)
      tribune.add('a', 1); await tick(10)
      assert.deepEqual(recu(b.trames, 0, 'tribune'), ['reset', 'add:a'])
      const depart = b.trames.length
      b.envoyer('µ:leave', { room: 'R1' }); await tick(20)
      b.envoyer('µ:unsub-stream', { stream: 'tribune' }); await tick(10)
      b.envoyer('µ:join', { room: 'R1' }); await tick(20)
      tribune.add('b', 2); await tick(20)
      assert.deepEqual(recu(b.trames, depart, 'tribune'), [])
    } finally {
      await b.app.stop()
    }
  })

  it('vérification en vol au départ (garde asynchrone) : désabonnée pendant l’attente, ni son « oui » ni le retour ne la réabonnent', async () => {
    const b = await banc()
    try {
      let attendre = false
      const attentes: Array<(ok: boolean) => void> = []
      const tribune = b.app.stream('tribune', { canSubscribe: (c: any) => {
        const dedans = b.app.room('R1').has(c)
        return attendre ? new Promise<boolean>(res => attentes.push(res)) : Promise.resolve(dedans)
      } })
      b.envoyer('µ:join', { room: 'R1' }); await tick(10)
      b.envoyer('µ:sub-stream', { stream: 'tribune' }); await tick(10)
      tribune.add('a', 1); await tick(10)
      assert.deepEqual(recu(b.trames, 0, 'tribune'), ['reset', 'add:a'])
      attendre = true
      const depart = b.trames.length
      b.envoyer('µ:leave', { room: 'R1' }); await tick(20)
      assert.equal(attentes.length, 1, 'la vérification du départ attend sa réponse')
      b.envoyer('µ:unsub-stream', { stream: 'tribune' }); await tick(10)
      attentes[0](true); await tick(10)
      b.envoyer('µ:join', { room: 'R1' }); await tick(20)
      assert.equal(attentes.length, 1, 'le retour ne rappelle pas la garde')
      tribune.add('b', 2); await tick(20)
      assert.deepEqual(recu(b.trames, depart, 'tribune'), [])
    } finally {
      await b.app.stop()
    }
  })
})
