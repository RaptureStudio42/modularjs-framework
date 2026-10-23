// Ce que ce test garantit : le délai d'une écriture de sauvegarde est cohérent entre le moteur et le pont, et le pont
// le compte avec une horloge monotone. Le moteur abandonne une écriture sans réponse au bout de 30 s en disant que c'est
// « le même que le pont » : vrai seulement par défaut, le pont rend son délai global (totalTimeoutMs) réglable. Désormais
// un adaptateur peut déclarer son propre délai (writeTimeoutMs, que le pont renseigne avec totalTimeoutMs) : le moteur
// l'attend aussi, plus une seconde de marge pour que le pont abandonne le premier, pour une écriture comme pour le
// flush() final de l'arrêt ; une valeur absente ou inutilisable garde les 30 s. Et l'échéance globale du pont se comptait
// avec l'heure murale : une correction de l'heure pendant l'attente entre deux essais faisait abandonner l'écriture sans
// second essai (heure qui avance) ou laissait réessayer après l'échéance (heure qui recule) ; elle suit maintenant
// performance.now(). L'horodatage signé des requêtes reste l'heure murale : c'est celui que le back compare à la sienne.
// Les minuteries et les horloges sont simulées : aucune vraie attente de 30 s.
import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { createServer, type Server } from 'node:http'
import { BridgePersistAdapter, createPersistEngine, resolvePersistOption } from '../src/mjs-server/index.js'

const DELAI = 30000

// les minuteries simulées ne font pas avancer les promesses : on les laisse se dérouler avant de regarder
const laisse = async () => { for (let i = 0; i < 10; i++) await new Promise<void>(r => setImmediate(r)) }
const muette = () => new Promise<void>(() => {})
const partie = (id: string): any => ({ id, n: 0, serialize() { return { n: this.n } }, _onMutate: null })
const mute   = (game: any, n: number) => { game.n = n; game._onMutate(game) }

function moteur(adapter: any) {
  const warns  = [] as string[]
  const engine = createPersistEngine(resolvePersistOption({ adapter, debounce: 100 })!, (niveau: string, msg: string) => { if (niveau === 'warn') warns.push(msg) })!
  return { engine, warns }
}

const MURALE_DEPART = 1_760_000_000_000   // une heure murale plausible, en ms depuis 1970
const UNE_HEURE     = 3_600_000

describe('MJS-Server — le moteur suit le délai de l\'adaptateur', function () {
  this.timeout(10000)
  beforeEach(() => { mock.timers.enable({ apis: ['setTimeout'] }) })
  afterEach(() => { mock.timers.reset() })
  const avance = async (ms: number) => { mock.timers.tick(ms); await laisse() }

  it('un adaptateur qui déclare 60 s : l\'écriture n\'est pas abandonnée à 30 s mais une seconde après son délai, et l\'avertissement donne ce délai', async () => {
    const adapter           = { load: async () => [], remove() {}, writeTimeoutMs: 60000, save: () => muette() }
    const { engine, warns } = moteur(adapter)
    const game              = partie('g-longue')
    engine.armGame(game)

    mute(game, 1)
    await avance(100)                      // l'écriture part, elle ne répondra jamais
    await avance(DELAI)                    // t = 30 100 : le délai par défaut est passé
    assert.deepEqual(warns, [], 'à 30 s l\'écriture est encore attendue : l\'adaptateur a déclaré 60 s')
    await avance(30999)                    // t = 61 099
    assert.deepEqual(warns, [], 'une milliseconde avant le délai de l\'adaptateur plus la marge')
    await avance(1)                        // t = 61 100
    assert.equal(warns.length, 1, `l'écriture est abandonnée : ${JSON.stringify(warns)}`)
    assert.match(warns[0], /g-longue/, 'l\'avertissement nomme la partie')
    assert.match(warns[0], /61 s/, 'l\'avertissement donne le délai réellement attendu')
  })

  it('le flush() final de l\'arrêt suit lui aussi le délai de l\'adaptateur', async () => {
    const adapter           = { load: async () => [], remove() {}, save() {}, writeTimeoutMs: 60000, flush: muette }
    const { engine, warns } = moteur(adapter)
    let rendu = false
    void engine.stop().then(() => { rendu = true })
    await laisse()

    await avance(DELAI)
    assert.equal(rendu, false, 'à 30 s flush() est encore attendu : l\'adaptateur a déclaré 60 s')
    await avance(30999)
    assert.equal(rendu, false, 'une milliseconde avant le délai de l\'adaptateur plus la marge')
    await avance(1)
    assert.equal(rendu, true, 'stop() rend la main une fois ce délai passé')
    assert.equal(warns.length, 1, `l'avertissement de flush() est donné : ${JSON.stringify(warns)}`)
    assert.match(warns[0], /61 s/, 'l\'avertissement donne le délai réellement attendu')
  })

  for (const [nom, valeur] of [['zéro', 0], ['négatif', -5], ['NaN', NaN], ['infini', Infinity], ['du texte', '60000']] as Array<[string, any]>) {
    it(`une valeur inutilisable (${nom}) garde les 30 s par défaut (témoin : vert aussi sans le correctif)`, async () => {
      const adapter           = { load: async () => [], remove() {}, writeTimeoutMs: valeur, save: () => muette() }
      const { engine, warns } = moteur(adapter)
      const game              = partie('g-defaut')
      engine.armGame(game)

      mute(game, 1)
      await avance(100)
      await avance(DELAI - 1)
      assert.deepEqual(warns, [], 'une milliseconde avant les 30 s')
      await avance(1)
      assert.equal(warns.length, 1, `l'écriture est abandonnée à 30 s : ${JSON.stringify(warns)}`)
      assert.match(warns[0], /30 s/, 'l\'avertissement donne 30 s')
    })
  }

  it('un délai déclaré énorme est ramené à ce que setTimeout accepte : Node ramènerait sinon la minuterie à 1 ms et l\'écriture serait abandonnée aussitôt', async () => {
    const armees: number[] = []
    const armer            = globalThis.setTimeout
    globalThis.setTimeout  = ((fn: any, ms: any, ...args: any[]) => { armees.push(ms); return armer(fn, ms, ...args) }) as any
    try {
      const adapter    = { load: async () => [], remove() {}, writeTimeoutMs: 1e12, save: () => muette() }
      const { engine } = moteur(adapter)
      const game       = partie('g-enorme')
      engine.armGame(game)

      mute(game, 1)
      await avance(100)                    // l'écriture part : sa minuterie d'abandon est armée
      assert.ok(armees.includes(2147483647), `la minuterie d'abandon est ramenée à 2^31 - 1 ms : ${JSON.stringify(armees)}`)
      assert.ok(armees.every(ms => ms <= 2147483647), `aucune minuterie au-delà de ce que Node accepte : ${JSON.stringify(armees)}`)
    } finally { globalThis.setTimeout = armer }
  })

  it('le pont déclare son délai global : 30 s par défaut, totalTimeoutMs quand il est réglé', () => {
    const defaut = new BridgePersistAdapter({ url: 'http://127.0.0.1:9/mjs-server/persist', secret: 's' })
    const regle  = new BridgePersistAdapter({ url: 'http://127.0.0.1:9/mjs-server/persist', secret: 's', totalTimeoutMs: 45000 })
    assert.equal((defaut as any).writeTimeoutMs, 30000, 'par défaut')
    assert.equal((regle as any).writeTimeoutMs, 45000, 'réglé')
  })

  it('un moteur dont l\'adaptateur est un pont réglé à 45 s attend ces 45 s, plus la marge : le délai du moteur suit celui du pont', async () => {
    const server: Server = createServer((_req, _res) => { /* accepte, ne répond jamais */ })
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()))
    const port = (server.address() as any).port
    try {
      const adapter           = new BridgePersistAdapter({ url: `http://127.0.0.1:${port}/mjs-server/persist`, secret: 's', timeoutMs: 600000, totalTimeoutMs: 45000, onLog: () => {} })
      const { engine, warns } = moteur(adapter)
      const game              = partie('g-pont')
      engine.armGame(game)

      mute(game, 1)
      await avance(100)                      // l'écriture part, le back ne répond jamais
      await avance(DELAI)                    // t = 30 100
      assert.deepEqual(warns, [], 'à 30 s le moteur attend encore : le pont est réglé à 45 s')
      await avance(15900)                    // t = 46 000
      assert.deepEqual(warns, [], 'le pont a encore 1 s de marge')
      await avance(100)                      // t = 46 100
      assert.equal(warns.length, 1, `le moteur abandonne : ${JSON.stringify(warns)}`)
      assert.match(warns[0], /g-pont/, 'l\'avertissement nomme la partie')
      assert.match(warns[0], /46 s/, 'l\'avertissement donne le délai réellement attendu')
    } finally {
      const brut: any = server
      brut.closeAllConnections?.()
      await new Promise<void>(r => server.close(() => r()))
    }
  })
})

describe('MJS-Server — pont de persistance : l\'échéance globale suit l\'horloge monotone', function () {
  this.timeout(15000)
  let monotone = 0        // performance.now() simulé, en ms
  let saut     = 0        // écart de l'heure murale (Date.now()) par rapport à l'horloge qui avance
  const murale0 = Date.now
  const perf0   = performance.now

  beforeEach(() => {
    monotone = 5000
    saut     = 0
    mock.timers.enable({ apis: ['setTimeout'] })
    Date.now        = () => MURALE_DEPART + monotone + saut
    performance.now = () => monotone
  })
  afterEach(() => {
    Date.now        = murale0
    performance.now = perf0
    mock.timers.reset()
  })

  const avance = async (ms: number) => { monotone += ms; mock.timers.tick(ms); await laisse() }

  // le temps réel (pas la minuterie simulée) laisse les requêtes du pont aller et venir : on regarde par tours de boucle
  const attendre = async (condition: () => boolean) => { for (let i = 0; i < 400 && !condition(); i++) await new Promise<void>(r => setImmediate(r)) }

  // un back qui répond `statut(n)` à sa n-ième requête (avec `corps`) après avoir lancé `surRequete(n)` ; `echec` est résolue à la
  // première tentative échouée du pont
  async function bancPont(statut: (n: number) => number, options: { totalTimeoutMs?: number; surRequete?: (n: number) => void; corps?: string } = {}) {
    const etat     = { requetes: 0 }
    const server   = createServer((req, res) => { req.resume(); req.on('end', () => { etat.requetes++; options.surRequete?.(etat.requetes); res.writeHead(statut(etat.requetes)); res.end(options.corps ?? '{}') }) })
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()))
    const port     = (server.address() as any).port
    const warns    = [] as string[]
    let premier: () => void = () => {}
    const echec    = new Promise<void>(r => { premier = r })
    const adapter  = new BridgePersistAdapter({ url: `http://127.0.0.1:${port}/mjs-server/persist`, secret: 'secret-horloge', totalTimeoutMs: options.totalTimeoutMs, onLog: (niveau: string, msg: string) => { if (niveau === 'warn') { warns.push(msg); if (warns.length === 1) premier() } } })
    const fermer   = async () => { const brut: any = server; brut.closeAllConnections?.(); await new Promise<void>(r => server.close(() => r())) }
    return { etat, warns, adapter, echec, fermer }
  }

  it('l\'heure murale avance d\'une heure pendant l\'attente entre deux essais : le second essai part quand même', async () => {
    const banc = await bancPont(n => n === 1 ? 500 : 200)
    try {
      const fini = banc.adapter.save('g-horloge', { id: 'g-horloge' } as any)
      await banc.echec                       // le 1er essai a échoué (HTTP 500) : le pont attend 2 s avant le suivant
      await laisse()
      saut = UNE_HEURE                       // l'heure murale saute d'une heure
      await avance(2000)                     // les 2 s d'attente passent : 28 s de budget restent
      await fini
      assert.equal(banc.etat.requetes, 2, 'le 2e essai doit partir : le budget compté en temps réel n\'est pas épuisé')
      assert.equal(banc.warns.length, 1, `seul le 1er essai a échoué : ${JSON.stringify(banc.warns)}`)
    } finally { await banc.fermer() }
  })

  it('l\'heure murale avance d\'une heure PENDANT un essai : le temps d\'attente avant le suivant est calculé sur le temps réel, le second essai part', async () => {
    const banc = await bancPont(n => n === 1 ? 500 : 200, { surRequete: n => { if (n === 1) saut = UNE_HEURE } })
    try {
      const fini = banc.adapter.save('g-horloge', { id: 'g-horloge' } as any)
      await banc.echec                       // le 1er essai a échoué, l'heure murale a sauté pendant qu'il était en vol
      await laisse()
      await avance(2000)                     // les 2 s d'attente passent
      await fini
      assert.equal(banc.etat.requetes, 2, 'le 2e essai doit partir : il reste 28 s de budget')
    } finally { await banc.fermer() }
  })

  it('load() : l\'heure murale avance d\'une heure pendant l\'attente entre deux essais, le second essai part et rend les parties', async () => {
    const corps = JSON.stringify({ ok: true, games: [{ id: 'g-1', data: { id: 'g-1', type: 'x' } }] })
    const banc  = await bancPont(n => n === 1 ? 500 : 200, { corps })
    try {
      const lues = banc.adapter.load()
      await banc.echec                       // le 1er essai a échoué (HTTP 500)
      await laisse()
      saut = UNE_HEURE
      await avance(2000)
      const rows = await lues
      assert.equal(rows.length, 1, 'le 2e essai doit partir et rendre les parties : load() ne se replie pas sur []')
      assert.equal(rows[0].id, 'g-1')
    } finally { await banc.fermer() }
  })

  it('l\'heure murale recule d\'une heure pendant l\'attente entre deux essais : l\'échéance épuisée coupe quand même les essais', async () => {
    const banc = await bancPont(() => 500, { totalTimeoutMs: 1000 })
    try {
      void banc.adapter.save('g-horloge', { id: 'g-horloge' } as any)
      await banc.echec                       // le 1er essai a échoué : le pont attend 1 s (tout ce qui reste de son budget)
      await laisse()
      saut = -UNE_HEURE                      // l'heure murale recule d'une heure
      await avance(1000)                     // le budget d'une seconde est épuisé
      await avance(5000)                     // et bien après : une attente plus longue que ce budget ne doit pas non plus laisser repartir le pont
      await attendre(() => banc.etat.requetes >= 2)
      assert.equal(banc.etat.requetes, 1, 'aucun 2e essai : l\'échéance globale est passée, quoi que dise l\'heure murale')
    } finally { await banc.fermer() }
  })

  it('load() : l\'heure murale recule d\'une heure pendant l\'attente entre deux essais, l\'échéance épuisée coupe quand même les essais et load() rend []', async () => {
    const banc = await bancPont(() => 500, { totalTimeoutMs: 1000 })
    try {
      const lues = banc.adapter.load()
      await banc.echec                       // le 1er essai a échoué : le pont attend 1 s (tout ce qui reste de son budget)
      await laisse()
      saut = -UNE_HEURE
      await avance(1000)
      await avance(5000)
      await attendre(() => banc.etat.requetes >= 2)
      assert.equal(banc.etat.requetes, 1, 'aucun 2e essai : l\'échéance globale est passée, quoi que dise l\'heure murale')
      assert.deepEqual(await lues, [], 'load() se replie sur []')
    } finally { await banc.fermer() }
  })

  it('l\'horodatage signé de la requête reste l\'heure murale (celle que le back compare à la sienne)', async () => {
    let horodatage = ''
    const server   = createServer((req, res) => { horodatage = String(req.headers['x-mjs-ws-timestamp']); req.resume(); req.on('end', () => { res.writeHead(200); res.end('{}') }) })
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()))
    const port     = (server.address() as any).port
    try {
      const adapter = new BridgePersistAdapter({ url: `http://127.0.0.1:${port}/mjs-server/persist`, secret: 'secret-horloge', onLog: () => {} })
      saut = UNE_HEURE
      await adapter.save('g-horloge', { id: 'g-horloge' } as any)
      assert.equal(horodatage, String(Math.floor((MURALE_DEPART + monotone + UNE_HEURE) / 1000)), 'l\'horodatage signé est l\'heure murale, en secondes')
    } finally {
      const brut: any = server
      brut.closeAllConnections?.()
      await new Promise<void>(r => server.close(() => r()))
    }
  })
})
