// Ce que ce test garantit : l'arrêt du serveur de jeu rend la main quel que soit l'adaptateur de sauvegarde, même
// quand son flush() ne répond jamais. Le moteur attendait flush() sans borne : un adaptateur maison au flush() muet
// (ou l'adaptateur fichier sur un disque réseau gelé, dont les écritures ne reviennent jamais) retenait app.stop()
// pour toujours. Désormais le moteur borne flush() à 30 s (comme une écriture), prévient, puis l'arrêt continue ;
// l'adaptateur fichier ne suit chaque écriture que 30 s depuis son départ, le moment où le moteur l'abandonne : son
// flush() ne la fait pas attendre une seconde fois, et dit combien d'écritures n'ont pas répondu. Un flush() lent
// qui répond avant 30 s reste attendu normalement, sans avertissement. Les minuteries sont simulées : aucune vraie
// attente de 30 s.
import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createPersistEngine, mjsServer, resolvePersistOption, FilePersistAdapter } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { mjsTmp } from './helpers/tmp.js'

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

function moteur(adapter: any) {
  const warns  = []
  const engine = createPersistEngine(resolvePersistOption({ adapter, debounce: 20 })!, journal(warns))!
  return { engine, warns }
}

// un adaptateur maison : il répond à tout, sauf ce que `flush` en fait
const adaptateur = (flush?: () => void | Promise<void>, save: (...args: any[]) => void | Promise<void> = () => {}) => ({ load: async () => [], save, remove() {}, flush })

// l'avertissement du moteur : il dit que c'est flush() de l'adaptateur qui n'a pas répondu, et le délai
function verifieAvertissementMoteur(msg: string) {
  assert.match(msg, /flush\(\)/, 'dit que c\'est flush() qui n\'a pas répondu')
  assert.match(msg, /30 s/, 'donne le délai')
}

// l'avertissement de flush() de l'adaptateur fichier : quel adaptateur, le délai et le nombre d'écritures sans réponse
function verifieAvertissement(msg: string, backend: string, nb: number) {
  assert.match(msg, new RegExp(`persist-${backend}`), 'nomme l\'adaptateur')
  assert.match(msg, /flush\(\)/, 'dit que c\'est flush() qui a renoncé')
  assert.match(msg, new RegExp(`(^|\\D)${nb}(\\D|$)`), `donne le nombre d'écritures sans réponse (${nb})`)
  assert.match(msg, /30 s/, 'donne le délai')
}

describe('MJS-Server — stop() du moteur face à un flush() d\'adaptateur qui ne répond jamais', function () {
  this.timeout(10000)
  beforeEach(() => { mock.timers.enable({ apis: ['setTimeout'] }) })
  afterEach(() => { mock.timers.reset() })

  it('stop() rend la main au bout de 30 s et prévient : un flush() muet ne retient plus l\'arrêt', async () => {
    const { engine, warns } = moteur(adaptateur(muette))
    let rendu = false
    void engine.stop().then(() => { rendu = true })
    await laisse()

    await avance(DELAI - 1)
    assert.equal(rendu, false, 'trop tôt : flush() peut encore répondre')
    assert.deepEqual(warns, [], 'aucun avertissement avant le délai')

    await avance(1)
    assert.equal(rendu, true, 'passé 30 s, stop() doit rendre la main')
    assert.equal(warns.length, 1, `un seul avertissement attendu : ${JSON.stringify(warns)}`)
    verifieAvertissementMoteur(warns[0])
  })

  it('une écriture muette puis un flush() muet : l\'arrêt attend 30 s l\'écriture abandonnée, puis 30 s flush(), et prévient de chacun', async () => {
    const { engine, warns } = moteur(adaptateur(muette, muette))
    const game              = partie('g-sourde')
    engine.armGame(game)

    mute(game, 1)
    await avance(20)                         // le débounce échoit : l'écriture part, et ne répond jamais
    let rendu = false
    void engine.stop().then(() => { rendu = true })
    await laisse()

    await avance(DELAI)                      // le moteur abandonne l'écriture (30 s après son départ), puis appelle flush()
    assert.equal(warns.length, 1, `l'écriture abandonnée est signalée : ${JSON.stringify(warns)}`)
    assert.match(warns[0], /g-sourde/, 'l\'avertissement de l\'écriture nomme la partie')
    assert.equal(rendu, false, 'sanity : stop() attend encore flush()')

    await avance(DELAI - 1)
    assert.equal(rendu, false, 'trop tôt : flush() garde ses 30 s')
    await avance(1)
    assert.equal(rendu, true, 'stop() doit rendre la main 30 s après l\'abandon de l\'écriture')
    assert.equal(warns.length, 2, `flush() est signalé à son tour : ${JSON.stringify(warns)}`)
    verifieAvertissementMoteur(warns[1])
  })

  it('un flush() lent qui répond à 29 s est attendu normalement : stop() rend la main à 29 s, sans avertissement, et rien ne sonne plus après coup', async () => {
    const { engine, warns } = moteur(adaptateur(lente(DELAI - 1000)))
    let rendu = false
    void engine.stop().then(() => { rendu = true })
    await laisse()                           // flush() est parti, il répondra 29 s plus tard

    await avance(DELAI - 1000 - 1)
    assert.equal(rendu, false, 'sanity : flush() n\'a pas encore répondu, stop() l\'attend')
    await avance(1)
    assert.equal(rendu, true, 'flush() répond à 29 s : stop() rend la main aussitôt')

    await avance(DELAI * 2)                  // bien au-delà des 30 s de son départ : la minuterie du délai doit être retirée
    assert.deepEqual(warns, [], 'aucun avertissement : flush() a répondu à temps')
  })

  it('un adaptateur sans flush() : stop() rend la main tout de suite et ne laisse aucune minuterie armée derrière lui (témoin : vert aussi sans la borne)', async () => {
    const { engine, warns } = moteur(adaptateur())
    let rendu = false
    void engine.stop().then(() => { rendu = true })
    await laisse()
    assert.equal(rendu, true, 'rien à vidanger : aucune attente')

    await avance(DELAI * 2)
    assert.deepEqual(warns, [], 'la minuterie du délai ne doit plus sonner une fois stop() rendu')
  })

  it('un flush() qui échoue vite n\'est pas avalé par la borne : stop() rejette avec son erreur, comme avant, sans minuterie oubliée (témoin : vert aussi sans la borne)', async () => {
    const rejet = moteur(adaptateur(() => Promise.reject(new Error('disque plein'))))
    await assert.rejects(rejet.engine.stop(), /disque plein/, 'le rejet de flush() remonte à l\'appelant')
    const jete  = moteur(adaptateur(() => { throw new Error('flush cassé') }))
    await assert.rejects(jete.engine.stop(), /flush cassé/, 'le throw synchrone de flush() remonte lui aussi')

    await avance(DELAI * 2)
    assert.deepEqual(rejet.warns, [], 'aucune minuterie oubliée après le rejet')
    assert.deepEqual(jete.warns, [], 'aucune minuterie oubliée après le throw')
  })

  it('app.stop() rend la main : le serveur s\'arrête malgré un flush() muet, après un avertissement', async () => {
    const warns   = []
    const deFlush = () => warns.filter(w => /flush\(\)/.test(w))     // MJS-WS a ses propres avertissements, sans rapport
    const app     = mjsServer({ transport: new MemoryTransport(), heartbeat: 0, auth: (hello: any) => hello.auth, persist: { adapter: adaptateur(muette), debounce: 20 }, onLog: journal(warns) })
    await app.listen()
    let rendu = false
    void app.stop().then(() => { rendu = true })
    await laisse()

    await avance(DELAI - 1)
    assert.equal(rendu, false, 'trop tôt : app.stop() attend encore flush()')
    assert.deepEqual(deFlush(), [], 'aucun avertissement de flush() avant le délai')

    await avance(1)
    assert.equal(deFlush().length, 1, `le moteur prévient que flush() n'a pas répondu : ${JSON.stringify(warns)}`)
    verifieAvertissementMoteur(deFlush()[0])
    for (let i = 0; i < 5 && !rendu; i++) await avance(1000)     // l'arrêt de MJS-WS arme lui-même une courte minuterie, après flush()
    assert.equal(rendu, true, 'app.stop() doit rendre la main : le serveur s\'arrête malgré le flush() muet')
  })
})

// disque réseau gelé : le dossier ne répond plus, aucune écriture ne revient — `_ready` est la promesse du dossier,
// que toute écriture attend d'abord ; remplacée ici par `disque`, muette ou lente
async function adaptateurFichier(disque: Promise<void>) {
  const warns        = []
  const dir          = mjsTmp('flush-borne')
  const adapter: any = new FilePersistAdapter({ dir, onLog: journal(warns) })
  await adapter._ready                     // le mkdir du constructeur est fini : il ne recrée pas le dossier après son balayage
  adapter._ready     = disque
  return { adapter, warns, dir }
}

describe('MJS-Server — FilePersistAdapter.flush() face à des écritures qui ne reviennent jamais (disque réseau gelé)', function () {
  this.timeout(10000)
  beforeEach(() => { mock.timers.enable({ apis: ['setTimeout'] }) })
  afterEach(() => { mock.timers.reset() })

  it('flush() rend la main au bout de 30 s et prévient : une écriture qui ne revient jamais ne retient plus l\'arrêt', async () => {
    const { adapter, warns } = await adaptateurFichier(muette())
    void adapter.save('g-gelee', { id: 'g-gelee' } as any)
    await laisse()                           // l'écriture attend le disque, qui ne répondra jamais
    let rendu = false
    void adapter.flush().then(() => { rendu = true })

    await avance(DELAI - 1)
    assert.equal(rendu, false, 'trop tôt : flush() attend encore une écriture qui pourrait revenir')
    assert.deepEqual(warns, [], 'aucun avertissement avant le délai')

    await avance(1)
    assert.equal(rendu, true, 'passé 30 s, flush() doit rendre la main')
    assert.equal(warns.length, 1, `un seul avertissement attendu : ${JSON.stringify(warns)}`)
    verifieAvertissement(warns[0], 'file', 1)
  })

  it('trois écritures gelées : un seul avertissement, qui les compte toutes', async () => {
    const { adapter, warns } = await adaptateurFichier(muette())
    void adapter.save('g-a', { id: 'g-a' } as any)
    void adapter.save('g-b', { id: 'g-b' } as any)
    void adapter.save('g-c', { id: 'g-c' } as any)
    await laisse()
    let rendu = false
    void adapter.flush().then(() => { rendu = true })

    await avance(DELAI)
    assert.equal(rendu, true, 'flush() rend la main passé 30 s')
    assert.equal(warns.length, 1, `un seul avertissement pour tout le lot : ${JSON.stringify(warns)}`)
    verifieAvertissement(warns[0], 'file', 3)
  })

  it('une écriture lente dont le disque répond à 29 s est attendue jusqu\'au bout : flush() rend la main une fois le fichier écrit, sans avertissement, et rien ne sonne plus après coup', async () => {
    const { adapter, warns, dir } = await adaptateurFichier(lente(DELAI - 1000)())
    void adapter.save('g-lente', { id: 'g-lente' } as any)
    await laisse()                           // l'écriture attend le disque, qui répondra 29 s plus tard
    let rendu = false
    const fini = adapter.flush().then(() => { rendu = true })

    await avance(DELAI - 1000 - 1)
    assert.equal(rendu, false, 'sanity : le disque n\'a pas encore répondu, flush() attend')
    mock.timers.tick(1)                      // le disque répond : la vraie écriture part
    await fini                               // jusqu'à la fin réelle de l'écriture
    assert.equal(rendu, true, 'flush() rend la main une fois l\'écriture finie')
    assert.ok(existsSync(join(dir, 'g-lente.json')), 'le fichier est écrit : flush() a bien attendu l\'écriture')

    await avance(DELAI * 2)                  // bien au-delà des 30 s de son départ : la minuterie du délai doit être retirée
    assert.deepEqual(warns, [], 'aucun avertissement : l\'écriture a abouti à temps')
  })

  it('une écriture réelle sur un vrai dossier : flush() l\'attend, le fichier est là, aucune minuterie ne sonne ensuite (témoin : vert aussi sans la borne)', async () => {
    const warns   = []
    const dir     = mjsTmp('flush-borne-reel')
    const adapter = new FilePersistAdapter({ dir, onLog: journal(warns) })
    void adapter.save('g-reelle', { id: 'g-reelle' } as any)
    await adapter.flush()
    assert.ok(existsSync(join(dir, 'g-reelle.json')), 'flush() rend la main une fois le fichier écrit')

    await avance(DELAI * 2)
    assert.deepEqual(warns, [], 'la minuterie du délai ne doit plus sonner une fois flush() rendu')
  })

  it('sans écriture en vol, flush() rend la main tout de suite et ne laisse aucune minuterie armée derrière lui (témoin : vert aussi sans la borne)', async () => {
    const { adapter, warns } = await adaptateurFichier(muette())
    let rendu = false
    void adapter.flush().then(() => { rendu = true })
    await laisse()
    assert.equal(rendu, true, 'rien en vol : aucune attente')

    await avance(DELAI * 2)
    assert.deepEqual(warns, [], 'la minuterie du délai ne doit plus sonner une fois flush() rendu')
  })

  it('stop() du moteur rend la main dès que le moteur abandonne l\'écriture gelée, 30 s après son départ : l\'adaptateur fichier ne la fait pas attendre une seconde fois', async () => {
    const { adapter, warns: warnsAdaptateur } = await adaptateurFichier(muette())
    const { engine, warns }                   = moteur(adapter)
    const game                                = partie('g-gelee')
    engine.armGame(game)

    mute(game, 1)
    await avance(20)                         // le débounce échoit : l'écriture part, et ne revient jamais
    let rendu = false
    void engine.stop().then(() => { rendu = true })
    await laisse()

    await avance(DELAI - 1)
    assert.equal(rendu, false, 'trop tôt : l\'écriture peut encore revenir')
    assert.deepEqual(warns, [], 'aucun avertissement avant le délai')
    await avance(1)                          // le moteur abandonne l'écriture, l'adaptateur la lâche au même instant : flush() n'a plus rien à attendre
    assert.equal(rendu, true, 'stop() doit rendre la main dès l\'abandon de l\'écriture')
    assert.equal(warns.length, 1, `le moteur prévient qu'il abandonne l'écriture : ${JSON.stringify(warns)}`)
    assert.match(warns[0], /g-gelee/, 'l\'avertissement du moteur nomme la partie')
    assert.equal(adapter._inFlight.size, 0, 'l\'adaptateur ne retient plus l\'écriture abandonnée')
    assert.deepEqual(warnsAdaptateur, [], 'flush() n\'a rien attendu : aucun avertissement de l\'adaptateur')
  })
})
