// hooks.onTurnTimeout, et le passage de tour automatique (qui appelle turns.order quand c'est une fonction de l'auteur),
// tournent dans la minuterie de tour : aucune requête n'attend leur réponse, une erreur qui en sortirait ferait tomber le
// processus du serveur. Elle est traitée comme celle d'une minuterie applicative (def.timers) : journalisée (error), la partie
// continue, ce que le crochet a changé avant de lever est diffusé, et une Promise rendue est attendue (son rejet est
// journalisé, la partie est marquée modifiée à sa fin)
import assert from 'node:assert/strict'
import { resolveGameDef, createGame } from '../src/mjs-server/index.js'
import { sansChute } from './helpers/sans-chute-processus.js'

function fakeAppCapture(): any {
  const envoyes: any[] = []
  return { send: (client: any, type: string, p: any) => envoyes.push({ client, type, p }), _envoyes: envoyes }
}
function fakeClient(identityId: string): any {
  return { id: 'fake-' + identityId, identity: { id: identityId }, latency: null, meta: {}, send() {}, close() {} }
}
const tick = (ms = 0): Promise<void> => new Promise<void>(r => setTimeout(r, ms))

async function until(condition: () => boolean, label: string, limit = 3000): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > limit) throw new Error('délai dépassé : ' + label)
    await tick(5)
  }
}

// une partie à un siège dont le tour expire au bout de 20 ms (armé par .next()) ; `erreurs` reçoit les messages de niveau
// error du journal, `vues()` le compteur n de chaque trame µgame:state envoyée au siège
function partie(hooks: Record<string, any>, extra: Record<string, any> = {}) {
  const app     = fakeAppCapture()
  const erreurs: string[] = []
  const def = resolveGameDef('tour', {
    seats: 1, state: () => ({ n: 0 }), view: (game: any) => ({ n: game.state.n }),
    moves: { inc: (game: any) => { game.state.n++ } },
    turns: { order: 'roundrobin', timeout: 20 }, hooks, ...extra,
  }, (level, msg) => { if (level === 'error') erreurs.push(String(msg)) })
  const game   = createGame(app, def, () => {}, 'tourg')
  const client = fakeClient('p1')
  game._createSeat(client)
  game.next()
  const vues = (): number[] => app._envoyes.filter((e: any) => e.type === 'µgame:state').map((e: any) => e.p.view.n)
  return { game, client, erreurs, vues }
}

describe('MJS-Server — hooks.onTurnTimeout qui lève : le serveur ne tombe pas', function () {
  this.timeout(8000)

  it('une erreur levée par le crochet est journalisée, jamais remontée au processus', async () => {
    await sansChute(async () => {
      const { game, erreurs } = partie({ onTurnTimeout: () => { throw new Error('boum-tour') } })
      try {
        await until(() => erreurs.length > 0, 'l\'erreur du crochet est journalisée')
        assert.ok(erreurs.some(m => m.includes('onTurnTimeout') && m.includes('boum-tour')), `le journal doit nommer le crochet et l'erreur, reçu : ${JSON.stringify(erreurs)}`)
        assert.equal(game._destroyed, false, 'la partie vit toujours')
      } finally { game._destroy() }
    })
  })

  it('une promesse rejetée par le crochet est journalisée, jamais un rejet non géré', async () => {
    await sansChute(async () => {
      const { game, erreurs } = partie({ onTurnTimeout: () => Promise.reject(new Error('boum-promesse')) })
      try {
        await until(() => erreurs.length > 0, 'le rejet du crochet est journalisé')
        assert.ok(erreurs.some(m => m.includes('onTurnTimeout') && m.includes('boum-promesse')), `le journal doit nommer le crochet et l'erreur, reçu : ${JSON.stringify(erreurs)}`)
        await tick(20)   // laisse passer une éventuelle remontée tardive au processus
      } finally { game._destroy() }
    })
  })

  it('la partie reste jouable après l\'erreur du crochet', async () => {
    await sansChute(async () => {
      const { game, client, erreurs, vues } = partie({ onTurnTimeout: () => { throw new Error('boum-tour') } })
      try {
        await until(() => erreurs.length > 0, 'l\'erreur du crochet est journalisée')
        game._onMove(client, 'inc', {})
        await until(() => vues()[vues().length - 1] === 1, 'le coup joué après l\'erreur est diffusé')
      } finally { game._destroy() }
    })
  })

  it('ce que le crochet a changé avant de lever est diffusé', async () => {
    await sansChute(async () => {
      const { game, vues } = partie({ onTurnTimeout: (game: any) => { game.state.n++; throw new Error('boum-tour') } })
      try {
        await until(() => vues()[vues().length - 1] === 1, 'la vue n = 1 est diffusée malgré le throw')
      } finally { game._destroy() }
    })
  })

  it('une promesse rendue est attendue : l\'état changé après l\'attente est diffusé à sa fin', async () => {
    await sansChute(async () => {
      const { game, vues } = partie({ onTurnTimeout: (game: any) => (new Promise<void>(resolve => setTimeout(resolve, 40))).then(() => { game.state.n++ }) })
      try {
        await until(() => vues()[vues().length - 1] === 1, 'la vue n = 1 est diffusée après la résolution de la promesse')
      } finally { game._destroy() }
    })
  })

  it('une promesse rejetée après avoir changé l\'état : rejet journalisé, changement diffusé', async () => {
    await sansChute(async () => {
      const { game, erreurs, vues } = partie({
        onTurnTimeout: (game: any) => new Promise<void>((_resolve, reject) => setTimeout(() => { game.state.n++; reject(new Error('boum-apres-attente')) }, 40)),
      })
      try {
        await until(() => vues()[vues().length - 1] === 1 && erreurs.length > 0, 'la vue n = 1 est diffusée et le rejet journalisé')
        assert.ok(erreurs.some(m => m.includes('boum-apres-attente')), `le rejet doit être journalisé, reçu : ${JSON.stringify(erreurs)}`)
      } finally { game._destroy() }
    })
  })

  it('témoin : un crochet qui ne lève pas change l\'état sans rien journaliser', async () => {
    await sansChute(async () => {
      const { game, erreurs, vues } = partie({ onTurnTimeout: (game: any) => { game.state.n++ } })
      try {
        await until(() => vues()[vues().length - 1] === 1, 'la vue n = 1 est diffusée')
        assert.deepEqual(erreurs, [], 'aucune erreur n\'est journalisée')
      } finally { game._destroy() }
    })
  })

  it('témoin : le crochet reste appelé en méthode de hooks (this = hooks)', async () => {
    await sansChute(async () => {
      let vu = ''
      const hooks: Record<string, any> = { onTurnTimeout(this: any) { vu = this === hooks ? 'hooks' : 'autre' } }
      const { game } = partie(hooks)
      try {
        await until(() => vu !== '', 'le crochet est appelé')
        assert.equal(vu, 'hooks')
      } finally { game._destroy() }
    })
  })

  it('turns.order (fonction) qui lève au passage de tour automatique : journalisé, le serveur ne tombe pas', async () => {
    await sansChute(async () => {
      let appels = 0
      const order = (game: any) => { if (appels++ > 0) throw new Error('boum-ordre'); return game.players[0] }
      const { game, erreurs } = partie({}, { turns: { order, timeout: 20 } })
      try {
        await until(() => erreurs.length > 0, 'l\'erreur de turns.order est journalisée')
        assert.ok(erreurs.some(m => m.includes('boum-ordre')), `le journal doit porter l'erreur, reçu : ${JSON.stringify(erreurs)}`)
        assert.equal(game._destroyed, false, 'la partie vit toujours')
      } finally { game._destroy() }
    })
  })
})
