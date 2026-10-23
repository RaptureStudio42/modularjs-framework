// Ce que ce test garantit : l'arrêt du serveur de jeu rend la main même quand le stockage ne répond plus.
// Une écriture de sauvegarde restée sans réponse (requête SQL pendante, Redis qui accepte la connexion puis
// se tait) est abandonnée par le moteur au bout de 30 s, mais l'adaptateur la garde dans sa liste d'écritures
// en vol : flush(), appelé par stop() après la rafale finale, attendait toute cette liste, donc pour toujours.
// Désormais chaque écriture n'est suivie que 30 s depuis son départ, le moment où le moteur l'abandonne : passé
// ce délai, un avertissement dit combien d'écritures n'ont pas répondu et l'arrêt continue (l'adaptateur Redis
// ferme alors sa connexion), et une écriture que le moteur a déjà abandonnée ne fait plus attendre flush() une
// seconde fois. Une écriture lente qui répond avant 30 s reste attendue normalement, sans avertissement. Les
// minuteries sont simulées : aucune vraie attente de 30 s.
import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { createServer, type Server, type Socket } from 'node:net'
import { createPersistEngine, mjsServer, resolvePersistOption, RedisPersistAdapter, SqlPersistAdapter } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const DELAI = 30000

// les minuteries simulées ne font pas avancer les promesses : on les laisse se dérouler avant de regarder
const laisse = async () => { for (let i = 0; i < 10; i++) await new Promise<void>(r => setImmediate(r)) }
const avance = async (ms: number) => { mock.timers.tick(ms); await laisse() }
const muette = () => new Promise<void>(() => {})
const lente  = (ms: number) => () => new Promise<void>(r => setTimeout(r, ms))
const partie = (id: string): any => ({ id, n: 0, serialize() { return { n: this.n } }, _onMutate: null })
const mute   = (game: any, n: number) => { game.n = n; game._onMutate(game) }

// les avertissements d'un journal, rangés dans `warns`
const journal = (warns: string[]) => (niveau: string, msg: string) => { if (niveau === 'warn') warns.push(msg) }

// faux pilote SQL : le CREATE TABLE répond, l'INSERT d'un save() et le DELETE d'un remove() sont confiés à `ecriture`
const pilote = (ecriture: () => Promise<unknown>) => (sql: string) => /^(INSERT|DELETE)/i.test(sql) ? ecriture() : Promise.resolve([])

function moteur(adapter: any) {
  const warns  = []
  const engine = createPersistEngine(resolvePersistOption({ adapter, debounce: 20 })!, journal(warns))!
  return { engine, warns }
}

// faux client RESP posé à la place de la connexion : `send` répond comme on le décide, stop() compte les fermetures
function adaptateurRedis(send: () => Promise<unknown>) {
  const warns          = []
  const adapter: any   = new RedisPersistAdapter({ host: '127.0.0.1', port: 1, onLog: journal(warns) })
  const faux           = { ready: true, fermetures: 0, connect() {}, send, stop() { this.fermetures++ } }
  adapter._conn        = faux
  return { adapter, warns, faux }
}

// vérifie le texte de l'avertissement de flush() : il dit quel adaptateur, le délai et le nombre d'écritures sans réponse
function verifieAvertissement(msg: string, backend: string, nb: number) {
  assert.match(msg, new RegExp(`persist-${backend}`), 'nomme l\'adaptateur')
  assert.match(msg, /flush\(\)/, 'dit que c\'est flush() qui a renoncé')
  assert.match(msg, new RegExp(`(^|\\D)${nb}(\\D|$)`), `donne le nombre d'écritures sans réponse (${nb})`)
  assert.match(msg, /30 s/, 'donne le délai')
}

describe('MJS-Server — SqlPersistAdapter.flush() face à une écriture qui ne répond jamais', function () {
  this.timeout(10000)
  beforeEach(() => { mock.timers.enable({ apis: ['setTimeout'] }) })
  afterEach(() => { mock.timers.reset() })

  it('flush() rend la main au bout de 30 s et prévient : une écriture muette ne retient plus l\'arrêt', async () => {
    const warns   = []
    const adapter = new SqlPersistAdapter({ query: pilote(muette), onLog: journal(warns) })
    void adapter.save('g-muette', { id: 'g-muette' } as any)
    await laisse()                           // l'INSERT est parti, il ne répondra jamais
    let rendu = false
    void adapter.flush().then(() => { rendu = true })

    await avance(DELAI - 1)
    assert.equal(rendu, false, 'trop tôt : flush() attend encore une écriture qui pourrait répondre')
    assert.deepEqual(warns, [], 'aucun avertissement avant le délai')

    await avance(1)
    assert.equal(rendu, true, 'passé 30 s, flush() doit rendre la main')
    assert.equal(warns.length, 1, `un seul avertissement attendu : ${JSON.stringify(warns)}`)
    verifieAvertissement(warns[0], 'sql', 1)
  })

  it('trois écritures muettes (deux save, un remove) : un seul avertissement, qui les compte toutes', async () => {
    const warns   = []
    const adapter = new SqlPersistAdapter({ query: pilote(muette), onLog: journal(warns) })
    void adapter.save('g-a', { id: 'g-a' } as any)
    void adapter.remove('g-b')
    void adapter.save('g-c', { id: 'g-c' } as any)
    await laisse()
    let rendu = false
    void adapter.flush().then(() => { rendu = true })

    await avance(DELAI)
    assert.equal(rendu, true, 'flush() rend la main passé 30 s')
    assert.equal(warns.length, 1, `un seul avertissement pour tout le lot : ${JSON.stringify(warns)}`)
    verifieAvertissement(warns[0], 'sql', 3)
  })

  it('une écriture lente qui répond à 29 s est attendue normalement : flush() rend la main à 29 s, sans avertissement, et rien ne sonne plus après coup', async () => {
    const warns   = []
    const adapter = new SqlPersistAdapter({ query: pilote(lente(DELAI - 1000)), onLog: journal(warns) })
    void adapter.save('g-lente', { id: 'g-lente' } as any)
    await laisse()                           // l'INSERT est parti, il répondra 29 s plus tard
    let rendu = false
    void adapter.flush().then(() => { rendu = true })

    await avance(DELAI - 1000 - 1)
    assert.equal(rendu, false, 'sanity : l\'écriture n\'a pas encore répondu, flush() l\'attend')
    await avance(1)
    assert.equal(rendu, true, 'l\'écriture répond à 29 s : flush() rend la main aussitôt')

    await avance(DELAI * 2)                  // bien au-delà des 30 s de son départ : la minuterie du délai doit être retirée
    assert.deepEqual(warns, [], 'aucun avertissement : l\'écriture a répondu à temps')
  })

  it('sans écriture en vol, flush() rend la main tout de suite et ne laisse aucune minuterie armée derrière lui', async () => {
    const warns   = []
    const adapter = new SqlPersistAdapter({ query: pilote(() => Promise.resolve([])), onLog: journal(warns) })
    void adapter.save('g-vite', { id: 'g-vite' } as any)
    await laisse()                           // l'écriture a répondu
    let rendu = false
    void adapter.flush().then(() => { rendu = true })
    await laisse()
    assert.equal(rendu, true, 'rien en vol : aucune attente')

    await avance(DELAI * 2)
    assert.deepEqual(warns, [], 'la minuterie du délai ne doit plus sonner une fois flush() rendu')
  })

  it('stop() du moteur rend la main dès que le moteur abandonne l\'écriture muette, 30 s après son départ : l\'adaptateur ne la fait pas attendre une seconde fois (tout le stockage SQL est sourd)', async () => {
    const adapter           = new SqlPersistAdapter({ query: pilote(muette), onLog: () => {} })
    const { engine, warns } = moteur(adapter)
    const game              = partie('g-sourde')
    engine.armGame(game)

    mute(game, 1)
    await avance(20)                         // le débounce échoit : l'écriture part, et ne répond jamais
    let rendu = false
    void engine.stop().then(() => { rendu = true })
    await laisse()

    await avance(DELAI - 1)
    assert.equal(rendu, false, 'trop tôt : l\'écriture peut encore répondre')
    assert.deepEqual(warns, [], 'aucun avertissement avant le délai')
    await avance(1)                          // le moteur abandonne l'écriture, l'adaptateur la lâche au même instant : flush() n'a plus rien à attendre
    assert.equal(rendu, true, 'stop() doit rendre la main dès l\'abandon de l\'écriture')
    assert.equal(warns.length, 1, `le moteur prévient qu'il abandonne l'écriture : ${JSON.stringify(warns)}`)
    assert.match(warns[0], /g-sourde/, 'l\'avertissement du moteur nomme la partie')
    assert.equal((adapter as any)._inFlight.size, 0, 'l\'adaptateur ne retient plus l\'écriture abandonnée')
  })
})

describe('MJS-Server — RedisPersistAdapter.flush() face à une écriture qui ne répond jamais', function () {
  this.timeout(10000)
  beforeEach(() => { mock.timers.enable({ apis: ['setTimeout'] }) })
  afterEach(() => { mock.timers.reset() })

  it('flush() rend la main au bout de 30 s, prévient, puis ferme la connexion', async () => {
    const { adapter, warns, faux } = adaptateurRedis(muette)
    void adapter.save('g-muette', { id: 'g-muette' } as any)
    await laisse()                           // HSET est parti, il ne répondra jamais
    let rendu = false
    void adapter.flush().then(() => { rendu = true })

    await avance(DELAI - 1)
    assert.equal(rendu, false, 'trop tôt : flush() attend encore une écriture qui pourrait répondre')
    assert.equal(faux.fermetures, 0, 'trop tôt : la connexion reste ouverte tant qu\'une écriture peut encore répondre')
    assert.deepEqual(warns, [], 'aucun avertissement avant le délai')

    await avance(1)
    assert.equal(rendu, true, 'passé 30 s, flush() doit rendre la main')
    assert.equal(faux.fermetures, 1, 'la connexion est fermée une fois, après la course')
    assert.equal(warns.length, 1, `un seul avertissement attendu : ${JSON.stringify(warns)}`)
    verifieAvertissement(warns[0], 'redis', 1)
  })

  it('une écriture lente qui répond à 29 s est attendue normalement : la connexion se ferme à 29 s, sans avertissement, et rien ne sonne plus après coup', async () => {
    const { adapter, warns, faux } = adaptateurRedis(lente(DELAI - 1000))
    void adapter.save('g-lente', { id: 'g-lente' } as any)
    await laisse()                           // HSET est parti, il répondra 29 s plus tard
    let rendu = false
    void adapter.flush().then(() => { rendu = true })

    await avance(DELAI - 1000 - 1)
    assert.equal(rendu, false, 'sanity : l\'écriture n\'a pas encore répondu, flush() l\'attend')
    assert.equal(faux.fermetures, 0, 'la connexion reste ouverte tant que l\'écriture peut répondre')
    await avance(1)
    assert.equal(rendu, true, 'l\'écriture répond à 29 s : flush() rend la main aussitôt')
    assert.equal(faux.fermetures, 1, 'puis la connexion est fermée')

    await avance(DELAI * 2)
    assert.deepEqual(warns, [], 'aucun avertissement : l\'écriture a répondu à temps')
    assert.equal(faux.fermetures, 1, 'la connexion n\'est pas fermée une seconde fois par une minuterie oubliée')
  })

  it('sans écriture en vol, flush() ferme la connexion tout de suite et ne laisse aucune minuterie armée derrière lui', async () => {
    const { adapter, warns, faux } = adaptateurRedis(() => Promise.resolve('OK'))
    void adapter.save('g-vite', { id: 'g-vite' } as any)
    await laisse()                           // l'écriture a répondu
    let rendu = false
    void adapter.flush().then(() => { rendu = true })
    await laisse()
    assert.equal(rendu, true, 'rien en vol : aucune attente')
    assert.equal(faux.fermetures, 1, 'la connexion est fermée par flush(), comme avant')

    await avance(DELAI * 2)
    assert.deepEqual(warns, [], 'la minuterie du délai ne doit plus sonner une fois flush() rendu')
  })

  it('stop() du moteur rend la main dès que le moteur abandonne l\'écriture muette, 30 s après son départ, et la connexion est fermée', async () => {
    const { adapter, faux } = adaptateurRedis(muette)
    const { engine, warns } = moteur(adapter)
    const game              = partie('g-sourde')
    engine.armGame(game)

    mute(game, 1)
    await avance(20)                         // le débounce échoit : HSET part, et ne répond jamais
    let rendu = false
    void engine.stop().then(() => { rendu = true })
    await laisse()

    await avance(DELAI - 1)
    assert.equal(rendu, false, 'trop tôt : l\'écriture peut encore répondre')
    assert.equal(faux.fermetures, 0, 'sanity : la connexion reste ouverte tant que l\'écriture peut répondre')
    await avance(1)                          // le moteur abandonne l'écriture, l'adaptateur la lâche au même instant : flush() n'a plus rien à attendre
    assert.equal(rendu, true, 'stop() doit rendre la main dès l\'abandon de l\'écriture')
    assert.equal(faux.fermetures, 1, 'la connexion Redis est fermée avant de rendre la main')
    assert.equal(warns.length, 1, `le moteur prévient qu'il abandonne l'écriture : ${JSON.stringify(warns)}`)
    assert.equal((adapter as any)._inFlight.size, 0, 'l\'adaptateur ne retient plus l\'écriture abandonnée')
  })

  it('avec un vrai serveur qui accepte la connexion puis se tait : flush() rend la main à 30 s et la connexion est vraiment fermée', async () => {
    const warns                 = []
    const sockets: Socket[]     = []
    let commandeVue: () => void = () => {}
    const commande              = new Promise<void>(r => { commandeVue = r })
    let fermee: () => void      = () => {}
    const fermeture             = new Promise<void>(r => { fermee = r })
    const server: Server        = createServer((socket: Socket) => {
      sockets.push(socket)
      socket.on('data', (chunk: Buffer) => { if (chunk.toString('utf8').indexOf('HSET') !== -1) commandeVue() })   // la commande arrive, aucune réponse ne repart
      socket.on('close', () => fermee())
      socket.on('error', () => {})
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
    const port = (server.address() as any).port
    try {
      const adapter = new RedisPersistAdapter({ host: '127.0.0.1', port, onLog: journal(warns) })
      void adapter.save('g-muette', { id: 'g-muette' } as any)
      await commande                         // le serveur a reçu HSET : l'écriture est bien en vol, sans réponse
      let rendu = false
      void adapter.flush().then(() => { rendu = true })

      await avance(DELAI - 1)
      assert.equal(rendu, false, 'trop tôt : flush() attend encore')
      await avance(1)
      assert.equal(rendu, true, 'passé 30 s, flush() doit rendre la main')
      assert.ok(warns.some(w => /flush\(\)/.test(w)), `l'avertissement de flush() est donné : ${JSON.stringify(warns)}`)
      await fermeture                        // le serveur voit la connexion se fermer pour de bon
    } finally {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })
})

describe('MJS-Server — app.stop() quand le stockage ne répond plus', function () {
  this.timeout(10000)
  beforeEach(() => { mock.timers.enable({ apis: ['setTimeout'] }) })
  afterEach(() => { mock.timers.reset() })

  it('app.stop() rend la main une fois les 30 s de flush() écoulées : le serveur s\'arrête malgré une écriture muette', async () => {
    const warns   = []
    const adapter = new SqlPersistAdapter({ query: pilote(muette), onLog: journal(warns) })
    const app     = mjsServer({ transport: new MemoryTransport(), heartbeat: 0, auth: (hello: any) => hello.auth, persist: { adapter, debounce: 20 }, onLog: () => {} })
    await app.listen()
    void adapter.save('g-sourde', { id: 'g-sourde' } as any)
    await laisse()                           // l'écriture est en vol : celle qu'un moteur lassé d'attendre abandonne en la laissant dans la liste de l'adaptateur
    let rendu = false
    void app.stop().then(() => { rendu = true })
    await laisse()

    await avance(DELAI - 1)
    assert.equal(rendu, false, 'trop tôt : app.stop() attend encore flush()')
    assert.deepEqual(warns, [], 'aucun avertissement avant le délai')

    await avance(1)
    assert.equal(warns.length, 1, `flush() prévient qu'il renonce : ${JSON.stringify(warns)}`)
    verifieAvertissement(warns[0], 'sql', 1)
    for (let i = 0; i < 5 && !rendu; i++) await avance(1000)     // l'arrêt de MJS-WS arme lui-même une courte minuterie, après flush()
    assert.equal(rendu, true, 'app.stop() doit rendre la main : le serveur s\'arrête malgré le stockage muet')
  })
})
