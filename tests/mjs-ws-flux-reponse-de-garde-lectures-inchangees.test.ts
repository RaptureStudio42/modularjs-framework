// Gardes `canSubscribe` des flux : une réponse ne s'applique que si toutes les appartenances qu'elle a lues sont encore
// celles de la connexion, entrée comme sortie, et qu'elle vient de la dernière évaluation lancée ; sinon la garde est
// repassée et la connexion ne reçoit rien du flux en attendant. Cas qui y échappaient : la retenue levée par le retour
// dans le dernier salon quitté alors que la garde en exigeait un autre ; le refus d'une vérification daté d'avant l'entrée
// dans un autre salon qu'elle lit (flux perdu en silence) ; la garde asynchrone posée après coup, qui laissait passer les
// deltas jusqu'à sa réponse ; la demande de rejeu ou d'état dépassée par une vérification « oui », jamais servie (client
// figé) ; le µ:resync d'un client resté sur un flux détruit puis redéclaré (rien, ou un rejeu mêlé à l'ancien état)
import assert from 'node:assert/strict'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

async function connexion(transport: MemoryTransport): Promise<{ ws: any; trames: any[]; envoyer: (t: string, p: unknown) => void }> {
  const ws = transport.connect({ url: 'ws://abonne/' })
  const trames: any[] = []
  ws.onmessage = (ev: any) => trames.push(JSON.parse(ev.data))
  const envoyer = (t: string, p: unknown) => ws.send(JSON.stringify({ t, p }))
  await tick()
  envoyer('µ:hello', { protocol: 1 })
  await tick(10)
  return { ws, trames, envoyer }
}

// ce que la connexion a reçu du flux `nom` depuis l'indice `depuis` : µ:error, `reset`, `add:clé`
const recu = (trames: any[], depuis: number, nom: string): string[] => trames.slice(depuis)
  .filter(f => f.t === nom || f.t === 'µ:error')
  .map(f => f.t === 'µ:error' ? 'µ:error' : f.p.op + (f.p.key ? ':' + f.p.key : ''))

describe('MJS-WS — flux : une réponse de garde ne s’applique que sur des lectures inchangées', function () {
  this.timeout(20000)

  it('garde asynchrone : second départ, retour dans un autre salon que celui qu’elle lit — rien du flux', async () => {
    const transport = new MemoryTransport()
    const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
    const attentes: Array<() => void> = []
    const flux = app.stream('partie-flux', { canSubscribe: (c) => { const ok = app.room('partie').has(c); return new Promise<boolean>(r => attentes.push(() => r(ok))) } })
    await app.listen()
    try {
      const c = await connexion(transport)
      c.envoyer('µ:join', { room: 'partie' }); c.envoyer('µ:join', { room: 'hall' }); await tick(10)
      c.envoyer('µ:sub-stream', { stream: 'partie-flux' }); await tick(10)
      attentes.shift()!(); await tick(10)
      const depart = c.trames.length
      c.envoyer('µ:leave', { room: 'partie' }); await tick(10)
      c.envoyer('µ:leave', { room: 'hall' }); await tick(10)
      c.envoyer('µ:join', { room: 'hall' }); await tick(10)
      flux.add('secret', 1); await tick(20)
      assert.deepEqual(recu(c.trames, depart, 'partie-flux'), [], 'de retour dans le hall, toujours hors de « partie » : rien')
      while (attentes.length) { attentes.shift()!(); await tick(10) }
      flux.add('apres', 2); await tick(20)
      assert.ok(!recu(c.trames, depart, 'partie-flux').some(x => x.startsWith('add')), 'refusée : aucun delta, ni rejeu')
    } finally {
      await app.stop()
    }
  })

  it('garde synchrone sur deux salons, jetons épuisés : deux départs, retour dans un seul — rien du flux, puis le refus', async () => {
    const transport = new MemoryTransport()
    const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
    const flux = app.stream('duo', { canSubscribe: (c) => app.room('R1').has(c) && app.room('R2').has(c) })
    await app.listen()
    try {
      const c = await connexion(transport)
      c.envoyer('µ:join', { room: 'R1' }); c.envoyer('µ:join', { room: 'R2' }); await tick(10)
      c.envoyer('µ:sub-stream', { stream: 'duo' }); await tick(10)
      c.envoyer('µ:leave', { room: 'R1' }); await tick(10)
      c.envoyer('µ:join', { room: 'R1' }); await tick(10)
      const depart = c.trames.length
      c.envoyer('µ:leave', { room: 'R2' }); await tick(10)
      c.envoyer('µ:leave', { room: 'R1' }); await tick(10)
      c.envoyer('µ:join', { room: 'R1' }); await tick(10)
      flux.add('secret', 1); await tick(20)
      assert.deepEqual(recu(c.trames, depart, 'duo'), [], 'dans R1 seulement, la garde exige R1 et R2 : rien')
      await tick(1100)
      flux.add('apres', 2); await tick(20)
      assert.deepEqual(recu(c.trames, depart, 'duo'), ['µ:error'], 'la vérification différée refuse : le µ:error seul')
    } finally {
      await app.stop()
    }
  })

  it('vérification au départ refusée, la connexion entrée avant la réponse dans un autre salon lu : la garde est repassée, le flux tenu', async () => {
    const transport = new MemoryTransport()
    const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
    const attentes: Array<() => void> = []
    const flux = app.stream('match', { canSubscribe: (c) => { const ok = app.room('tribune').has(c) || app.room('vestiaire').has(c); return new Promise<boolean>(r => attentes.push(() => r(ok))) } })
    await app.listen()
    try {
      const c = await connexion(transport)
      c.envoyer('µ:join', { room: 'vestiaire' }); await tick(10)
      c.envoyer('µ:sub-stream', { stream: 'match' }); await tick(10)
      attentes.shift()!(); await tick(10)
      const depart = c.trames.length
      c.envoyer('µ:leave', { room: 'vestiaire' }); await tick(10)
      c.envoyer('µ:join', { room: 'tribune' }); await tick(10)
      attentes.shift()!(); await tick(10)
      flux.add('but', 1); await tick(10)
      while (attentes.length) { attentes.shift()!(); await tick(10) }
      await tick(1200)
      flux.add('but-2', 2); await tick(20)
      assert.deepEqual(recu(c.trames, depart, 'match'), ['add:but', 'add:but-2'], 'dans « tribune », elle a le droit : les deltas, sans µ:error')
    } finally {
      await app.stop()
    }
  })

  it('vérification au départ qui refuse, la connexion hors de tout salon lu ; entrée ensuite dans un autre salon lu : le flux rendu', async () => {
    const transport = new MemoryTransport()
    const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
    const attentes: Array<() => void> = []
    const flux = app.stream('match', { canSubscribe: (c) => { const ok = app.room('tribune').has(c) || app.room('vestiaire').has(c); return new Promise<boolean>(r => attentes.push(() => r(ok))) } })
    await app.listen()
    try {
      const c = await connexion(transport)
      c.envoyer('µ:join', { room: 'vestiaire' }); await tick(10)
      c.envoyer('µ:sub-stream', { stream: 'match' }); await tick(10)
      attentes.shift()!(); await tick(10)
      const depart = c.trames.length
      c.envoyer('µ:leave', { room: 'vestiaire' }); await tick(10)
      attentes.shift()!(); await tick(10)
      flux.add('hors', 1); await tick(10)
      assert.deepEqual(recu(c.trames, depart, 'match'), [], 'hors des deux salons : écartée, en silence')
      c.envoyer('µ:join', { room: 'tribune' }); await tick(10)
      while (attentes.length) { attentes.shift()!(); await tick(10) }
      flux.add('dedans', 2); await tick(20)
      assert.deepEqual(recu(c.trames, depart, 'match'), ['reset', 'add:dedans'], 'entrée dans « tribune », que le refus a lu : l’état complet puis les deltas')
    } finally {
      await app.stop()
    }
  })

  for (const accepte of [false, true]) {
    it(`garde asynchrone posée après coup ${accepte ? 'qui accepte : rien avant sa réponse, puis le rejeu' : 'qui refuse : rien avant sa réponse, puis le µ:error'}`, async () => {
      const transport = new MemoryTransport()
      const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
      const flux = app.stream('cartes', { public: true })
      await app.listen()
      try {
        const c = await connexion(transport)
        c.envoyer('µ:sub-stream', { stream: 'cartes' }); await tick(10)
        const depart = c.trames.length
        let repondre: (v: boolean) => void = () => {}
        app.stream('cartes', { canSubscribe: () => new Promise<boolean>(r => { repondre = r }) })
        await tick(10)
        flux.add('main-adverse', 1); await tick(10)
        assert.deepEqual(recu(c.trames, depart, 'cartes'), [], 'avant la réponse : rien')
        repondre(accepte); await tick(10)
        flux.add('apres', 2); await tick(10)
        assert.deepEqual(recu(c.trames, depart, 'cartes'), accepte ? ['add:main-adverse', 'add:apres'] : ['µ:error'])
      } finally {
        await app.stop()
      }
    })
  }

  for (const demande of ['µ:resync', 'µ:sub-stream'] as const) {
    it(`${demande} en attente, dépassé par la vérification du départ qui accepte : servi quand même, le client recalé`, async () => {
      const transport = new MemoryTransport()
      const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
      const attentes: Array<(v: boolean) => void> = []
      const S = app.stream('S', { canSubscribe: (c) => { app.room('R1').has(c); return new Promise<boolean>(r => attentes.push(r)) } })
      await app.listen()
      try {
        const c = await connexion(transport)
        // client du framework (runtime/mjs_socket.ts) : un trou → un seul µ:resync, puis plus rien jusqu'au rattrapage
        const cl = { lastSeq: 0, resyncing: false, store: new Map<string, unknown>(), etats: 0 }
        const ecoute = (ev: any) => {
          const f = JSON.parse(ev.data)
          if (f.t !== 'S') return
          const p = f.p
          if (p.op === 'reset') { cl.etats++; cl.resyncing = false; cl.lastSeq = f.seq ?? 0; cl.store = new Map(Object.entries(p.values)); return }
          if (cl.lastSeq && f.seq <= cl.lastSeq) return
          if (cl.lastSeq && f.seq > cl.lastSeq + 1) { if (!cl.resyncing) { cl.resyncing = true; c.envoyer('µ:resync', { stream: 'S', from: cl.lastSeq }) } return }
          cl.resyncing = false; cl.lastSeq = f.seq
          if (p.op === 'add') cl.store.set(p.key, p.value)
        }
        c.ws.onmessage = ecoute
        c.envoyer('µ:join', { room: 'R1' }); await tick(10)
        c.envoyer('µ:sub-stream', { stream: 'S' }); await tick(10); attentes.shift()!(true); await tick(10)
        S.add('a', 1); await tick(10); S.add('b', 2); await tick(10)
        if (demande === 'µ:resync') {
          // une trame perdue (en grappe : un delta appliqué malgré un trou) ; la suivante révèle le trou, le client redemande
          c.ws.onmessage = () => {}; S.add('perdu', 3); await tick(10); c.ws.onmessage = ecoute
          S.add('revele', 4); await tick(10)
          assert.equal(cl.resyncing, true, 'le client attend son rejeu')
        }
        else {
          c.envoyer('µ:sub-stream', { stream: 'S' }); await tick(10)
        }
        c.envoyer('µ:leave', { room: 'R1' }); await tick(10)
        assert.equal(attentes.length, 2, 'la demande et la vérification du départ attendent')
        const verif = attentes.pop()!, attendue = attentes.pop()!
        const etats = cl.etats
        verif(true); await tick(10)
        if (demande === 'µ:sub-stream') assert.equal(cl.etats, etats + 1, 'l’état complet demandé')
        attendue(true); await tick(10)
        for (let i = 0; i < 3; i++) { S.add('b' + i, i); await tick(10) }
        assert.equal(cl.resyncing, false, 'le client n’est pas figé')
        assert.deepEqual([...cl.store.keys()].sort(), Object.keys(S.snapshot()).sort(), 'l’état du client est celui du serveur')
      } finally {
        await app.stop()
      }
    })
  }

  for (const deltas of [1, 3]) {
    it(`flux détruit puis redéclaré, ${deltas} delta(s) depuis : le µ:resync d’un client de l’ancien flux reçoit l’état complet`, async () => {
      const transport = new MemoryTransport()
      const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
      let F = app.stream('F', { public: true })
      await app.listen()
      try {
        const c = await connexion(transport)
        c.envoyer('µ:sub-stream', { stream: 'F' }); await tick(10)
        F.add('ancien', 1); await tick(10)
        const vu = c.trames.filter(f => f.t === 'F').at(-1).seq
        F.destroy()
        F = app.stream('F', { public: true })
        for (let i = 1; i <= deltas; i++) F.add('neuf' + i, i)
        await tick(10)
        const depart = c.trames.length
        c.envoyer('µ:resync', { stream: 'F', from: vu }); await tick(10)
        const recues = c.trames.slice(depart).filter(f => f.t === 'F')
        assert.deepEqual(recues.map(f => f.p.op), ['reset'], 'l’état complet, jamais rien ni un rejeu sur l’ancien état')
        assert.deepEqual(Object.keys(recues[0].p.values).sort(), Object.keys(F.snapshot()).sort())
      } finally {
        await app.stop()
      }
    })
  }
})
