// µ.lockstep — un rejeu qui lève ne laisse plus un état faux en silence. Partie à deux joueurs : quand l'apply() de x seul lève au même
// ordre, en direct puis au rejeu de la reprise demandée, l'état de x restait faux (somme 33 contre 36 chez y) sans événement
// 'divergence' ni autre reprise, la console n'en disant que la première erreur. Maintenant, un rejeu qui lève est dit (µ.error) et la
// partie signalée (événement 'divergence', raison 'apply-threw'), une fois, sans boucle de reprises ; un rejeu qui passe ensuite permet
// de le dire de nouveau. Vrai serveur MJS-Server (MemoryTransport), vrais clients (µ.socket, sock.game, µ.det, µ.lockstep)
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

// une seule fabrique de WebSocket pour tout le fichier, reposée avant chaque test : chaque connexion `memory://<id>` relève ses trames
// sortantes
let transport: MemoryTransport
const sortants = new Map<string, any[]>()
function fabrique(url: string, protocols?: any): any {
  const ws: any = transport.connect({ url, protocols })
  const id      = url.replace('memory://', '')
  if (!sortants.has(id)) sortants.set(id, [])
  const envoyer = ws.send.bind(ws)
  ws.send = (d: any) => { sortants.get(id)!.push(JSON.parse(d)); return envoyer(d) }
  return ws
}
const resyncs = (id: string) => (sortants.get(id) || []).filter(m => m.t === 'µgame:resync').length

describe('µ.lockstep — un rejeu qui lève est dit et signalé', function () {
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

  // un joueur ; `regle.leve(o)` : vrai quand apply() doit lever pour cet ordre, après en avoir appliqué une partie
  async function joueur(id: string, code: any, regle: { leve: (o: any) => boolean }) {
    const erreurs: string[] = [], evenements: any[] = []
    const µ: any = { state: (i: any) => ({ ...i }), error: (...a: any[]) => { erreurs.push(a.map(String).join(' ')) }, warn: () => {}, log: () => {} }
    poserMessages(µ)
    new Function('µ', runtime)(µ)
    const sock = µ.socket('memory://' + id, { auth: () => ({ id }), reconnect: { enabled: false } })
    sock.connect()
    await attendre(() => sock.state === 'open', id + ' connecté')
    const partie = sock.game('rts', { code })
    partie.on('event', (e: any) => { evenements.push(e) })
    const etat: any = µ.lockstep(partie, {
      state0: () => ({ n: 0, somme: 0 }),
      apply: (s: any, o: any) => { s.n++; if (regle.leve(o)) throw new Error('défaut du jeu'); s.somme += o.p.dx },
      every: 0,
    })
    await attendre(() => partie.state.status === 'playing', id + ' assis')
    return { sock, partie, etat, erreurs, evenements }
  }
  const signalees = (j: any) => j.evenements.filter((e: any) => e.type === 'divergence' && e.p && e.p.reason === 'apply-threw')
  const rejeu     = (j: any) => j.erreurs.filter((e: string) => /pendant le rejeu de la reprise/.test(e))
  async function jouer(y: any, x: any, de: number, a: number) {
    for (let i = de; i <= a; i++) { y.partie.move('m', { dx: i }); await attendre(() => y.etat.n === i, 'y au coup ' + i) }
    await attendre(() => x.etat.n === a, { message: 'x au coup ' + a, delai: 3000 })
    await pause(150)
  }

  it('l\'apply() de x seul lève au même ordre, en direct puis au rejeu : l\'erreur du rejeu est dite et la partie signalée, une fois, sans boucle de reprises', async () => {
    const regle = { leve: (o: any) => o.p.dx === 3 }
    const x = await joueur('x', true, regle)
    const y = await joueur('y', x.partie.state.code, { leve: () => false })
    await jouer(y, x, 1, 8)
    assert.equal(y.etat.somme, 36)
    assert.equal(x.etat.somme, 33, 'état de x faux : le rejeu lève au même ordre')
    assert.equal(resyncs('x'), 1, 'une reprise, pas de boucle')
    assert.equal(signalees(x).length, 1, 'AVANT : aucun événement — ' + JSON.stringify(x.evenements))
    assert.equal(typeof signalees(x)[0].p.tick, 'number')
    assert.equal(rejeu(x).length, 1, 'AVANT : seule la première erreur dite — ' + JSON.stringify(x.erreurs))
    assert.match(rejeu(x)[0], /événement 'divergence', raison 'apply-threw'/)
    // la suite de la partie ne redit rien : rien n'a réparé l'état
    await jouer(y, x, 9, 12)
    assert.equal(signalees(x).length, 1)
    assert.equal(rejeu(x).length, 1)
    assert.deepEqual(y.evenements, [])
    assert.deepEqual(y.erreurs, [])
    x.sock.destroy(); y.sock.destroy()
  })

  it('un rejeu qui passe permet de le dire de nouveau : x lève d\'abord au rejeu, puis plus du tout, puis de nouveau au rejeu', async () => {
    const regle = { leve: (o: any) => o.p.dx === 3 }
    const x = await joueur('x', true, regle)
    const y = await joueur('y', x.partie.state.code, { leve: () => false })
    await jouer(y, x, 1, 4)
    assert.equal(signalees(x).length, 1, 'premier rejeu qui lève signalé')
    // le défaut corrigé, puis un défaut du direct seulement (le rejeu passe) : l'état est repris, juste
    let fois = 0
    regle.leve = (o: any) => o.p.dx === 6 && fois++ === 0
    await jouer(y, x, 5, 7)
    assert.equal(x.etat.somme, y.etat.somme, 'état repris par un rejeu qui passe')
    assert.equal(signalees(x).length, 1)
    // de nouveau un défaut qui lève au rejeu
    regle.leve = (o: any) => o.p.dx === 9
    await jouer(y, x, 8, 10)
    assert.equal(signalees(x).length, 2, 'signalé de nouveau : ' + JSON.stringify(x.evenements))
    assert.equal(rejeu(x).length, 2)
    x.sock.destroy(); y.sock.destroy()
  })
})
