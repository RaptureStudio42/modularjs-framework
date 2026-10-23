// le journal de MJS-Server nomme le crochet fautif et dit ce qui s'est passé, un message par cas, en français comme en anglais :
// un rejet de hooks.onLeave ne sort pas sous « timer('hooks.onLeave') a rejeté », l'échéance du tour ne parle pas d'une minuterie
// applicative, l'erreur de spectatorView ne passe pas pour celle de def.view d'un siège. Les vraies minuteries applicatives
// (def.timers) et la vue d'un siège gardent leur message
import assert from 'node:assert/strict'
import { resolveGameDef, createGame } from '../src/mjs-server/index.js'
import { setMessagesLang } from '../src/messages/index.js'
import { sansChute } from './helpers/sans-chute-processus.js'

const tick = (ms = 0): Promise<void> => new Promise<void>(r => setTimeout(r, ms))

async function until(condition: () => boolean, label: string, limit = 3000): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > limit) throw new Error('délai dépassé : ' + label)
    await tick(5)
  }
}

function fakeApp(): any {
  return { send() {} }
}
function fakeClient(identityId: string): any {
  return { id: 'fake-' + identityId, identity: { id: identityId }, latency: null, meta: {}, send() {}, close() {} }
}

const boom = (): never => { throw new Error('boum-x') }

// une partie à `seats` sièges ; `erreurs` reçoit les messages de niveau error du journal
function partie(seats: number, hooks: Record<string, any>, extra: Record<string, any> = {}) {
  const erreurs: string[] = []
  const def = resolveGameDef('crochet', {
    seats,
    emptyTtl: 5000,
    state: () => ({ n: 0 }),
    view: (game: any) => ({ n: game.state.n }),
    moves: { inc: (game: any) => { game.state.n++ } },
    hooks,
    ...extra,
  }, (level, msg) => { if (level === 'error') erreurs.push(String(msg)) })
  const game = createGame(fakeApp(), def, () => {}, 'crochetg')
  return { game, erreurs }
}

// attend la première erreur du journal, détruit la partie et rend les messages
async function recoltee(game: any, erreurs: string[]): Promise<string[]> {
  try {
    await until(() => erreurs.length > 0, 'une erreur est journalisée')
    await tick(10)
    return erreurs.slice()
  } finally { game._destroy() }
}

// --- un scénario par cas : il déclenche l'erreur et rend ce que le journal en a dit -----------

// départ du joueur 2 (le joueur 1 reste), avec le crochet donné
async function depart(hooks: Record<string, any>, extra: Record<string, any> = {}): Promise<string[]> {
  const { game, erreurs } = partie(2, hooks, extra)
  const c1 = fakeClient('p1')
  const c2 = fakeClient('p2')
  game._createSeat(c1)
  game._createSeat(c2)
  game._leave(c2)
  return recoltee(game, erreurs)
}

// partie à un siège dont le tour expire au bout de 20 ms (armé par .next())
async function echeanceDuTour(hooks: Record<string, any>, extra: Record<string, any> = {}): Promise<string[]> {
  const { game, erreurs } = partie(1, hooks, { turns: { order: 'roundrobin', timeout: 20 }, ...extra })
  game._createSeat(fakeClient('p1'))
  game.next()
  return recoltee(game, erreurs)
}

async function ordreQuiLeveAuPassageAutomatique(): Promise<string[]> {
  let appels = 0
  const order = (game: any) => { if (appels++ > 0) throw new Error('boum-x'); return game.players[0] }
  return echeanceDuTour({}, { turns: { order, timeout: 20 } })
}

async function ordreQuiLeveAuDepart(): Promise<string[]> {
  let casse = false
  const order = (game: any) => { if (casse) throw new Error('boum-x'); return game.players.find(Boolean) }
  const { game, erreurs } = partie(2, { onLeave: boom }, { turns: { order } })
  const c1 = fakeClient('p1')
  game._createSeat(c1)
  game._createSeat(fakeClient('p2'))
  game.next()   // le tour est à p1, dont le départ déclenche le passage de tour
  casse = true
  assert.throws(() => game._leave(c1), /boum-x/)
  return recoltee(game, erreurs)
}

async function spectatorViewQuiLeve(): Promise<string[]> {
  let casse = false
  const { game, erreurs } = partie(1, {}, { code: true, spectatorView: (g: any) => { if (casse) throw new Error('boum-x'); return { n: g.state.n } } })
  const joueur = fakeClient('p1')
  game._createSeat(joueur)
  game._addSpectator(fakeClient('spec'))
  await tick()   // la diffusion de l'arrivée est passée
  casse = true
  game._onMove(joueur, 'inc', {})
  return recoltee(game, erreurs)
}

async function viewDunSiegeQuiLeve(): Promise<string[]> {
  let casse = false
  const { game, erreurs } = partie(1, {}, { view: (g: any) => { if (casse) throw new Error('boum-x'); return { n: g.state.n } } })
  const joueur = fakeClient('p1')
  game._createSeat(joueur)
  await tick()
  casse = true
  game._onMove(joueur, 'inc', {})
  return recoltee(game, erreurs)
}

async function minuterieApplicativeQuiLeve(): Promise<string[]> {
  const { game, erreurs } = partie(1, {}, { timers: { rappel: boom } })
  game._createSeat(fakeClient('p1'))
  game.timer('rappel', 10)
  return recoltee(game, erreurs)
}

async function joinRejete(): Promise<string[]> {
  const { game, erreurs } = partie(2, { onJoin: () => Promise.reject(new Error('boum-x')) })
  game._createSeat(fakeClient('p1'))
  return recoltee(game, erreurs)
}

async function endRejete(): Promise<string[]> {
  const { game, erreurs } = partie(1, { onEnd: () => Promise.reject(new Error('boum-x')) })
  game._createSeat(fakeClient('p1'))
  game.end('fin')
  return recoltee(game, erreurs)
}

async function createRejete(): Promise<string[]> {
  const erreurs: string[] = []
  const def = resolveGameDef('crochet', {
    seats: 1, state: () => ({ n: 0 }), view: (game: any) => ({ n: game.state.n }), moves: {},
    hooks: { onCreate: () => Promise.reject(new Error('boum-x')) },
  }, (level, msg) => { if (level === 'error') erreurs.push(String(msg)) })
  const game = createGame(fakeApp(), def, () => {}, 'crochetg')
  return recoltee(game, erreurs)
}

interface Attendu { contient: string[]; sans: string[] }

const CAS: Array<{ nom: string; lancer: () => Promise<string[]>; fr: Attendu; en: Attendu }> = [
  {
    nom: 'hooks.onLeave rejeté : le crochet est nommé, pas une minuterie',
    lancer: () => depart({ onLeave: () => Promise.reject(new Error('boum-x')) }),
    fr: { contient: ['hooks.onLeave', 'a rejeté', 'boum-x'], sans: ['timer('] },
    en: { contient: ['hooks.onLeave', 'rejected', 'boum-x'], sans: ['timer('] },
  },
  {
    nom: 'hooks.onTurnTimeout levé à l\'échéance du tour',
    lancer: () => echeanceDuTour({ onTurnTimeout: boom }),
    fr: { contient: ['hooks.onTurnTimeout', 'a levé', 'boum-x'], sans: ['timer('] },
    en: { contient: ['hooks.onTurnTimeout', 'threw', 'boum-x'], sans: ['timer('] },
  },
  {
    nom: 'hooks.onTurnTimeout rejeté à l\'échéance du tour',
    lancer: () => echeanceDuTour({ onTurnTimeout: () => Promise.reject(new Error('boum-x')) }),
    fr: { contient: ['hooks.onTurnTimeout', 'a rejeté', 'boum-x'], sans: ['timer('] },
    en: { contient: ['hooks.onTurnTimeout', 'rejected', 'boum-x'], sans: ['timer('] },
  },
  {
    nom: 'turns.order levé au passage de tour automatique : ni minuterie, ni nom interne',
    lancer: ordreQuiLeveAuPassageAutomatique,
    fr: { contient: ['turns.order', 'a levé', 'boum-x'], sans: ['timer(', 'µturn'] },
    en: { contient: ['turns.order', 'threw', 'boum-x'], sans: ['timer(', 'µturn'] },
  },
  {
    nom: 'turns.order levé au départ du joueur dont c\'est le tour (2e erreur du départ)',
    lancer: ordreQuiLeveAuDepart,
    fr: { contient: ['turns.order', 'a levé', 'boum-x'], sans: ['timer('] },
    en: { contient: ['turns.order', 'threw', 'boum-x'], sans: ['timer('] },
  },
  {
    nom: 'spectatorView levé : il s\'agit des spectateurs, pas d\'un siège',
    lancer: spectatorViewQuiLeve,
    fr: { contient: ['spectatorView', 'a levé', 'boum-x', 'spectateurs'], sans: ['ce siège', 'def.view a levé'] },
    en: { contient: ['spectatorView', 'threw', 'boum-x', 'spectators'], sans: ['this seat', 'def.view threw'] },
  },
  {
    nom: 'témoin : def.view d\'un siège garde son message',
    lancer: viewDunSiegeQuiLeve,
    fr: { contient: ['def.view', 'a levé', 'ce siège', 'boum-x'], sans: ['spectatorView'] },
    en: { contient: ['def.view', 'threw', 'this seat', 'boum-x'], sans: ['spectatorView'] },
  },
  {
    nom: 'témoin : une minuterie applicative (def.timers) garde son message',
    lancer: minuterieApplicativeQuiLeve,
    fr: { contient: ['timer(\'rappel\')', 'a levé', 'boum-x'], sans: [] },
    en: { contient: ['timer(\'rappel\')', 'threw', 'boum-x'], sans: [] },
  },
  {
    nom: 'hooks.onJoin rejeté : le joueur est refusé',
    lancer: joinRejete,
    fr: { contient: ['hooks.onJoin', 'a rejeté', 'refusé', 'boum-x'], sans: ['timer('] },
    en: { contient: ['hooks.onJoin', 'rejected', 'refused', 'boum-x'], sans: ['timer('] },
  },
  {
    nom: 'hooks.onEnd rejeté : la fin de partie a eu lieu',
    lancer: endRejete,
    fr: { contient: ['hooks.onEnd', 'a rejeté', 'boum-x'], sans: ['timer('] },
    en: { contient: ['hooks.onEnd', 'rejected', 'boum-x'], sans: ['timer('] },
  },
  {
    nom: 'hooks.onCreate rejeté : la partie est créée quand même',
    lancer: createRejete,
    fr: { contient: ['hooks.onCreate', 'a rejeté', 'boum-x'], sans: ['timer('] },
    en: { contient: ['hooks.onCreate', 'rejected', 'boum-x'], sans: ['timer('] },
  },
]

for (const lang of ['fr', 'en'] as const) {
  describe(`MJS-Server — le journal nomme le crochet fautif et dit ce qui s'est passé (${lang})`, function () {
    this.timeout(8000)
    beforeEach(() => setMessagesLang(lang))
    afterEach(() => setMessagesLang('fr'))

    for (const cas of CAS) {
      it(cas.nom, async () => {
        let messages: string[] = []
        await sansChute(async () => { messages = await cas.lancer() })
        const texte = messages.join('\n')
        for (const attendu of cas[lang].contient) assert.ok(texte.includes(attendu), `« ${attendu} » manque dans le journal : ${JSON.stringify(messages)}`)
        for (const interdit of cas[lang].sans) assert.ok(!texte.includes(interdit), `« ${interdit} » ne devrait pas figurer dans le journal : ${JSON.stringify(messages)}`)
      })
    }
  })
}
