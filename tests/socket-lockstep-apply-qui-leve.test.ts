// µ.lockstep — un apply() qui lève (un défaut du jeu). L'exception laissait le tick à moitié joué et l'arrêtait là : le tick suivant
// n'était plus jamais appliqué (partie figée chez ce joueur), et seule une trace technique le disait. L'erreur est maintenant dite
// (µ.error, une fois, au vouvoiement), la suite du tick est jouée, et en direct l'état est repris du serveur (µgame:resync) : un
// apply() qui n'a levé qu'une fois chez un seul joueur le laisse de nouveau égal aux autres. Un apply() qui lève chez tous au même
// ordre (déterministe) laisse le même état chez tous, sans boucle de reprises : une par ordre qui lève, aucune pour les autres (le
// plafond des reprises : socket-lockstep-reprises-bornees.test.ts) ; son rejeu, qui lève aussi, est dit une fois — rien ne dit à un
// joueur que les autres lèvent comme lui (socket-lockstep-rejeu-qui-leve.test.ts). Vrai serveur MJS-Server (MemoryTransport), vrais
// clients (µ.socket, sock.game, µ.det, µ.lockstep)
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsServer } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { poserMessages } from './helpers/messages-stub.js'
import { attendre } from './helpers/attendre.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const runtime   = ['mjs_socket.ts', 'mjs_game.ts', 'mjs_det.ts', 'mjs_lockstep.ts'].map(f => readFileSync(join(__dirname, '../src/runtime/' + f), 'utf8')).join('\n')
const pause     = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

// une seule fabrique de WebSocket pour tout le fichier, reposée avant chaque test : chaque connexion `memory://<id>` relève ses trames sortantes
let transport: MemoryTransport
const sortants = new Map<string, any[]>()
function fabrique(url: string, protocols?: any): any {
  const ws: any = transport.connect({ url, protocols })
  const id      = url.replace('memory://', '')
  const envoyer = ws.send.bind(ws)
  ws.send = (d: any) => { if (!sortants.has(id)) sortants.set(id, []); sortants.get(id)!.push(JSON.parse(d)); return envoyer(d) }
  return ws
}
const resyncs = (id: string) => (sortants.get(id) || []).filter(m => m.t === 'µgame:resync').length

describe('µ.lockstep — un apply() qui lève', function () {
  this.timeout(20000)
  let app: any = null
  beforeEach(async () => {
    ;(globalThis as any).WebSocket = fabrique
    transport = new MemoryTransport()
    sortants.clear()
    app = mjsServer({ transport, heartbeat: 0, auth: (hello: any) => hello.auth, onLog: () => {} } as any)
    app.game('rts', { mode: 'lockstep', seats: 2, code: true, tick: 30, seatTtl: 3000, emptyTtl: 5000, moves: {} })
    await app.listen()
  })
  afterEach(async () => { await app.stop() })

  // un joueur ; `leve(o)` : vrai quand apply() doit lever pour cet ordre, après en avoir appliqué la moitié
  async function joueur(id: string, code: any, leve: (o: any) => boolean) {
    const erreurs: string[] = []
    const µ: any = { state: (i: any) => ({ ...i }), error: (...a: any[]) => { erreurs.push(a.map(String).join(' ')) }, warn: () => {}, log: () => {} }
    poserMessages(µ)
    new Function('µ', runtime)(µ)
    const sock = µ.socket('memory://' + id, { auth: () => ({ id }), reconnect: { enabled: false } })
    sock.connect()
    await attendre(() => sock.state === 'open', id + ' connecté')
    const partie = sock.game('rts', { code })
    const etat: any = µ.lockstep(partie, {
      state0: () => ({ n: 0, somme: 0 }),
      apply: (s: any, o: any) => { s.n++; if (leve(o)) throw new Error('défaut du jeu'); s.somme += etat.rng.int(1, 1000) + o.p.dx },
      every: 0,
    })
    await attendre(() => partie.state.status === 'playing', id + ' assis')
    return { sock, partie, etat, erreurs }
  }
  const vue = (etat: any) => JSON.stringify({ n: etat.n, somme: etat.somme })

  it('apply() lève une fois chez un seul joueur : l\'erreur est dite, la partie continue et son état redevient celui des autres', async () => {
    let fois = 0
    const x = await joueur('x', true, (o: any) => o.p.dx === 3 && fois++ === 0)
    const y = await joueur('y', x.partie.state.code, () => false)
    for (const dx of [1, 2, 3, 4, 5]) { x.partie.move('m', { dx }); await pause(40) }
    await attendre(() => y.etat.n === 5, 'y a joué les 5 ordres')
    await attendre(() => vue(x.etat) === vue(y.etat), () => 'x égal à y (x ' + vue(x.etat) + ', y ' + vue(y.etat) + ', erreurs ' + JSON.stringify(x.erreurs) + ')')
    assert.equal(x.erreurs.length, 1, 'une erreur dite : ' + JSON.stringify(x.erreurs))
    assert.match(x.erreurs[0], /apply\(\) a levé une erreur au tick \d+/)
    assert.match(x.erreurs[0], /corrigez apply\(\)/)
    assert.equal(resyncs('x'), 1, 'état repris du serveur une fois')
    // la partie continue : un ordre de plus, joué partout
    y.partie.move('m', { dx: 10 })
    await attendre(() => x.etat.n === 6 && vue(x.etat) === vue(y.etat), () => 'ordre suivant joué par x (x ' + vue(x.etat) + ', y ' + vue(y.etat) + ')')
    assert.deepEqual(y.erreurs, [])
    x.sock.destroy(); y.sock.destroy()
  })

  it('apply() lève chez tous au même ordre : même état chez tous, la partie continue, aucune boucle de reprises', async () => {
    const leve = (o: any) => o.p.dx === 13
    const x = await joueur('x', true, leve)
    const y = await joueur('y', x.partie.state.code, leve)
    for (const dx of [1, 13, 2, 13, 3]) { x.partie.move('m', { dx }); await pause(40) }
    await attendre(() => x.etat.n === 5 && y.etat.n === 5, () => 'les 5 ordres comptés partout (x ' + vue(x.etat) + ', y ' + vue(y.etat) + ')')
    await pause(150)
    assert.equal(vue(x.etat), vue(y.etat))
    assert.equal(x.erreurs.filter(e => /apply\(\) a levé une erreur au tick \d+ :/.test(e)).length, 1, 'le défaut dit une fois : ' + JSON.stringify(x.erreurs))
    assert.equal(x.erreurs.filter(e => /pendant le rejeu de la reprise/.test(e)).length, 1, 'le rejeu qui lève dit une fois : ' + JSON.stringify(x.erreurs))
    assert.equal(x.erreurs.length, 2, JSON.stringify(x.erreurs))
    assert.ok(resyncs('x') <= 2 && resyncs('y') <= 2, 'au plus une reprise par ordre qui lève (deux ici), aucune pour les autres : ' + resyncs('x') + ' / ' + resyncs('y'))
    x.sock.destroy(); y.sock.destroy()
  })
})
