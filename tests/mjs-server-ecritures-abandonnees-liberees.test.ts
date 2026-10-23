// Ce que ce test garantit : un adaptateur de stockage ne retient pas, pour toujours, chaque écriture que le moteur a
// abandonnée. Les adaptateurs SQL et Redis gardaient dans leur liste d'écritures en vol (celle que flush() attend à l'arrêt)
// chaque promesse restée sans réponse : sous une panne muette, le moteur abandonne une écriture par partie toutes les 30 s
// et réessaie, soit 120 promesses retenues par heure et par partie, sans borne. Désormais chaque écriture n'est suivie que
// 30 s : passé ce délai l'adaptateur la lâche (le moteur en a fait autant), sa minuterie est retirée dès qu'elle répond, et
// flush() ne compte ni n'attend plus celles qui dorment depuis longtemps. Le pont n'a pas ce défaut : ses écritures sont
// bornées par son échéance globale (témoin). Les minuteries sont simulées : aucune vraie attente de 30 s.
import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { createServer } from 'node:http'
import { BridgePersistAdapter, createPersistEngine, RedisPersistAdapter, resolvePersistOption, SqlPersistAdapter } from '../src/mjs-server/index.js'

const DELAI = 30000

// les minuteries simulées ne font pas avancer les promesses : on les laisse se dérouler avant de regarder
const laisse = async () => { for (let i = 0; i < 10; i++) await new Promise<void>(r => setImmediate(r)) }
const avance = async (ms: number) => { mock.timers.tick(ms); await laisse() }
const muette = () => new Promise<void>(() => {})
const partie = (id: string): any => ({ id, n: 0, serialize() { return { id: this.id, n: this.n } }, _onMutate: null })
const mute   = (game: any, n: number) => { game.n = n; game._onMutate(game) }

// les avertissements d'un journal, rangés dans `warns`
const journal = (warns: string[]) => (niveau: string, msg: string) => { if (niveau === 'warn') warns.push(msg) }

// faux pilote SQL : le CREATE TABLE répond, l'INSERT d'un save() et le DELETE d'un remove() sont confiés à `ecriture`
const pilote = (ecriture: () => Promise<unknown>) => (sql: string) => /^(INSERT|DELETE)/i.test(sql) ? ecriture() : Promise.resolve([])

// faux client RESP posé à la place de la connexion : `send` répond comme on le décide, stop() compte les fermetures
function adaptateurRedis(send: () => Promise<unknown>) {
  const warns        = [] as string[]
  const adapter: any = new RedisPersistAdapter({ host: '127.0.0.1', port: 1, onLog: journal(warns) })
  const faux         = { ready: true, fermetures: 0, connect() {}, send, stop() { this.fermetures++ } }
  adapter._conn      = faux
  return { adapter, warns, faux }
}

// vingt minutes de panne muette : une partie qui mute toutes les 5 s, une écriture abandonnée et retentée toutes les 30 s
async function pannePendantVingtMinutes(adapter: any) {
  const engine = createPersistEngine(resolvePersistOption({ adapter, debounce: 100 })!, () => {})!
  const game   = partie('g-panne')
  engine.armGame(game)
  for (let s = 0; s < 1200; s += 5) { mute(game, s); await avance(5000) }
}

describe('MJS-Server — SqlPersistAdapter : les écritures abandonnées ne sont pas retenues pour toujours', function () {
  this.timeout(30000)
  beforeEach(() => { mock.timers.enable({ apis: ['setTimeout'] }) })
  afterEach(() => { mock.timers.reset() })

  it('vingt minutes de panne muette : la liste d\'écritures en vol ne grossit pas d\'une promesse par tentative du moteur', async () => {
    const adapter: any = new SqlPersistAdapter({ query: pilote(muette) as any, onLog: () => {} })
    await pannePendantVingtMinutes(adapter)
    assert.ok(adapter._inFlight.size <= 2, `${adapter._inFlight.size} écritures retenues après vingt minutes de panne (une tentative abandonnée toutes les 30 s) : la liste ne doit retenir que celle en cours`)
  })

  it('une écriture est suivie 30 s : à 29,999 s elle est encore attendue par flush(), à 30 s elle est lâchée', async () => {
    const adapter: any = new SqlPersistAdapter({ query: pilote(muette) as any, onLog: () => {} })
    for (let i = 0; i < 5; i++) void adapter.save('g-' + i, { id: 'g-' + i })
    await laisse()
    assert.equal(adapter._inFlight.size, 5, 'sanity : les cinq écritures sont en vol')

    await avance(DELAI - 1)
    assert.equal(adapter._inFlight.size, 5, 'trop tôt : flush() doit encore les attendre')
    await avance(1)
    assert.equal(adapter._inFlight.size, 0, 'passé 30 s, l\'adaptateur ne retient plus ces écritures')
  })

  it('flush() après une longue panne n\'attend que l\'écriture en cours et ne compte qu\'elle : pas les écritures abandonnées depuis longtemps', async () => {
    const warns        = [] as string[]
    const adapter: any = new SqlPersistAdapter({ query: pilote(muette) as any, onLog: journal(warns) })
    await pannePendantVingtMinutes(adapter)
    let rendu = false
    void adapter.flush().then(() => { rendu = true })
    await avance(DELAI)                      // au plus 30 s : l'écriture en cours est lâchée à son tour
    assert.equal(rendu, true, 'flush() rend la main')
    const comptes = warns.filter(w => /flush\(\)/.test(w)).map(w => Number(/(\d+) écriture/.exec(w)?.[1]))
    assert.ok(comptes.every(nb => nb <= 1), `flush() ne compte que l'écriture en cours, pas les quarante abandonnées : ${JSON.stringify(warns)}`)
  })

  it('flush() rend la main tout de suite quand toutes les écritures sont déjà lâchées : sans attente et sans avertissement', async () => {
    const warns        = [] as string[]
    const adapter: any = new SqlPersistAdapter({ query: pilote(muette) as any, onLog: journal(warns) })
    void adapter.save('g-a', { id: 'g-a' })
    await laisse()
    await avance(DELAI)                      // l'écriture est lâchée
    let rendu = false
    void adapter.flush().then(() => { rendu = true })
    await laisse()
    assert.equal(rendu, true, 'flush() ne doit pas attendre 30 s de plus une écriture lâchée depuis longtemps')
    assert.deepEqual(warns, [], 'aucun avertissement : rien n\'est attendu')
  })

  it('une écriture qui répond sort aussitôt de la liste et sa minuterie est retirée : aucune minuterie ne reste armée derrière une écriture qui a répondu', async () => {
    const armees       = new Set<unknown>()
    const retirees     = new Set<unknown>()
    const armer        = globalThis.setTimeout
    const retirer      = globalThis.clearTimeout
    globalThis.setTimeout   = ((fn: any, ms: any, ...args: any[]) => { const h = armer(fn, ms, ...args); armees.add(h); return h }) as any
    globalThis.clearTimeout = ((h: any) => { retirees.add(h); return retirer(h) }) as any
    try {
      const adapter: any = new SqlPersistAdapter({ query: pilote(() => Promise.resolve([])) as any, onLog: () => {} })
      await adapter.save('g-vite', { id: 'g-vite' })
      await adapter.save('g-vite', { id: 'g-vite' })
      assert.equal(adapter._inFlight.size, 0, 'une écriture qui a répondu n\'est plus en vol')
      const restantes = Array.from(armees).filter(h => !retirees.has(h)).length
      assert.equal(restantes, 0, `${restantes} minuterie(s) armée(s) derrière des écritures qui ont répondu`)
    } finally { globalThis.setTimeout = armer; globalThis.clearTimeout = retirer }
  })
})

describe('MJS-Server — RedisPersistAdapter : les écritures abandonnées ne sont pas retenues pour toujours', function () {
  this.timeout(30000)
  beforeEach(() => { mock.timers.enable({ apis: ['setTimeout'] }) })
  afterEach(() => { mock.timers.reset() })

  it('vingt minutes de panne muette : la liste d\'écritures en vol ne grossit pas d\'une promesse par tentative du moteur', async () => {
    const { adapter } = adaptateurRedis(muette)
    await pannePendantVingtMinutes(adapter)
    assert.ok(adapter._inFlight.size <= 2, `${adapter._inFlight.size} écritures retenues après vingt minutes de panne (une tentative abandonnée toutes les 30 s) : la liste ne doit retenir que celle en cours`)
  })

  it('une écriture est suivie 30 s : à 29,999 s elle est encore attendue par flush(), à 30 s elle est lâchée', async () => {
    const { adapter } = adaptateurRedis(muette)
    for (let i = 0; i < 5; i++) void adapter.save('g-' + i, { id: 'g-' + i })
    await laisse()
    assert.equal(adapter._inFlight.size, 5, 'sanity : les cinq écritures sont en vol')

    await avance(DELAI - 1)
    assert.equal(adapter._inFlight.size, 5, 'trop tôt : flush() doit encore les attendre')
    await avance(1)
    assert.equal(adapter._inFlight.size, 0, 'passé 30 s, l\'adaptateur ne retient plus ces écritures')
  })

  it('flush() après une longue panne n\'attend que l\'écriture en cours et ne compte qu\'elle, puis ferme la connexion', async () => {
    const { adapter, warns, faux } = adaptateurRedis(muette)
    await pannePendantVingtMinutes(adapter)
    let rendu = false
    void adapter.flush().then(() => { rendu = true })
    await avance(DELAI)                      // au plus 30 s : l'écriture en cours est lâchée à son tour
    assert.equal(rendu, true, 'flush() rend la main')
    assert.equal(faux.fermetures, 1, 'la connexion est fermée par flush()')
    const comptes = warns.filter(w => /flush\(\)/.test(w)).map(w => Number(/(\d+) écriture/.exec(w)?.[1]))
    assert.ok(comptes.every(nb => nb <= 1), `flush() ne compte que l'écriture en cours, pas les quarante abandonnées : ${JSON.stringify(warns)}`)
  })

  it('flush() ferme la connexion tout de suite quand toutes les écritures sont déjà lâchées : sans attente et sans avertissement', async () => {
    const { adapter, warns, faux } = adaptateurRedis(muette)
    void adapter.save('g-a', { id: 'g-a' })
    await laisse()
    await avance(DELAI)                      // l'écriture est lâchée
    let rendu = false
    void adapter.flush().then(() => { rendu = true })
    await laisse()
    assert.equal(rendu, true, 'flush() ne doit pas attendre 30 s de plus une écriture lâchée depuis longtemps')
    assert.equal(faux.fermetures, 1, 'la connexion est fermée par flush()')
    assert.deepEqual(warns, [], 'aucun avertissement : rien n\'est attendu')
  })
})

describe('MJS-Server — BridgePersistAdapter : ses écritures sont déjà bornées par l\'échéance globale (témoin : vert aussi sans le correctif)', function () {
  this.timeout(15000)

  it('contre un back qui ne répond jamais, aucune écriture n\'est retenue une fois l\'échéance globale passée', async () => {
    const server = createServer((_req, _res) => { /* accepte, ne répond jamais */ })
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()))
    const port = (server.address() as any).port
    try {
      const adapter: any = new BridgePersistAdapter({ url: `http://127.0.0.1:${port}/mjs-server/persist`, secret: 'peu-importe', timeoutMs: 50, totalTimeoutMs: 150, onLog: () => {} })
      for (let i = 0; i < 20; i++) void adapter.save('g-' + i, { id: 'g-' + i })
      assert.equal(adapter._inFlight.size, 20, 'sanity : les vingt écritures sont en vol')
      await new Promise<void>(r => setTimeout(r, 800))
      assert.equal(adapter._inFlight.size, 0, 'le pont ne retient plus rien : chaque écriture a fini par abandonner à son échéance')
    } finally {
      const brut: any = server
      brut.closeAllConnections?.()
      await new Promise<void>(r => server.close(() => r()))
    }
  })
})
