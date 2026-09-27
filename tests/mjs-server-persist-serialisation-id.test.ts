// Régression — persist.ts (createPersistEngine) : une sauvegarde qui lève une erreur SYNCHRONE ne
// doit jamais faire planter le moteur (stop() ne doit jamais rejeter, un timer ne doit jamais
// devenir un uncaughtException) ; stop() doit attendre une sauvegarde déjà EN VOL, pas seulement
// celles encore en attente ; deux sauvegardes rapprochées de la même partie ne doivent JAMAIS se
// chevaucher (sinon l'ordre de complétion réseau/disque peut inverser l'écriture finale) ; un
// remove() doit toujours passer APRÈS une sauvegarde déjà en vol et annuler celle qui restait en
// attente, pour qu'aucun ancien état ne ressuscite une partie supprimée.
import assert from 'node:assert/strict'
import { createPersistEngine } from '../src/mjs-server/index.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

describe('mjs-server/persist — sauvegardes sérialisées par id de partie', () => {
  it("une exception SYNCHRONE levée par adapter.save() ne fait pas rejeter stop() — capturée comme un rejet, un warn est émis", async () => {
    const warns: string[] = []
    const adapter: any = { async load() { return [] }, save() { throw new Error('boom-save-synchrone') }, remove() {} }
    const engine = createPersistEngine({ adapter, debounce: 0, snapshotEvery: 0 } as any, (level: string, msg: string) => { if (level === 'warn') warns.push(msg) })!
    const game: any = { id: 'g-sync', serialize: () => ({ state: 'x' }), _onMutate: null }
    engine.armGame(game)

    game._onMutate(game)
    await tick(20)   // laisse le débounce (0ms) déclencher runSave()

    await assert.doesNotReject(engine.stop(), 'stop() doit rester résolue même si adapter.save() lève de façon synchrone')
    assert.ok(warns.some(w => /save/.test(w)), `un warn doit signaler le save() cassé, reçu : ${JSON.stringify(warns)}`)
  })

  it('une exception SYNCHRONE levée par adapter.remove() ne fait pas rejeter stop()', async () => {
    const warns: string[] = []
    const adapter: any = { async load() { return [] }, save() {}, remove() { throw new Error('boom-remove-synchrone') } }
    const engine = createPersistEngine({ adapter, debounce: 0, snapshotEvery: 0 } as any, (level: string, msg: string) => { if (level === 'warn') warns.push(msg) })!
    const game: any = { id: 'g-sync-rm', serialize: () => ({ state: 'x' }), _onMutate: null }
    engine.armGame(game)

    engine.forgetGame('g-sync-rm')
    await tick(20)

    await assert.doesNotReject(engine.stop())
    assert.ok(warns.some(w => /remove/.test(w)), `un warn doit signaler le remove() cassé, reçu : ${JSON.stringify(warns)}`)
  })

  it('stop() attend une sauvegarde déjà EN VOL avant de résoudre (pas seulement les débounces encore en attente)', async () => {
    let saveTermine = false
    const adapter: any = {
      async load() { return [] },
      save() { return new Promise<void>((resolve) => { setTimeout(() => { saveTermine = true; resolve() }, 30) }) },
      remove() {},
    }
    const engine = createPersistEngine({ adapter, debounce: 0, snapshotEvery: 0 } as any, () => {})!
    const game: any = { id: 'g-envol', serialize: () => ({ state: 'v1' }), _onMutate: null }
    engine.armGame(game)

    game._onMutate(game)
    await tick(15)   // laisse le débounce (0ms) déclencher runSave() : le save (30ms) est maintenant EN VOL

    assert.equal(saveTermine, false, 'sanity : le save est encore en vol au moment de stop()')
    await engine.stop()
    assert.equal(saveTermine, true, 'BUG si faux : stop() a résolu avant la fin du save déjà en vol — perte possible au shutdown')
  })

  it("deux sauvegardes rapprochées de la MÊME partie ne se chevauchent jamais — l'état final écrit est le DERNIER programmé, même si le back répond dans le désordre", async () => {
    const résolveurs: Array<() => void> = []
    const écrits: string[] = []
    let enVol = 0
    let maxEnVolSimultane = 0
    const adapter: any = {
      async load() { return [] },
      save(_id: string, data: any) {
        enVol++
        maxEnVolSimultane = Math.max(maxEnVolSimultane, enVol)
        return new Promise<void>((resolve) => { résolveurs.push(() => { enVol--; écrits.push(data.state); resolve() }) })
      },
      remove() {},
    }
    const engine = createPersistEngine({ adapter, debounce: 0, snapshotEvery: 0 } as any, () => {})!
    const game: any = { id: 'g-ordre', serialize: () => ({ state: 'A' }), _onMutate: null }
    engine.armGame(game)

    game._onMutate(game)
    await tick(10)   // save('A') démarre, reste EN VOL (résolveurs[0] jamais encore appelé)

    game.serialize = () => ({ state: 'B' })
    game._onMutate(game)
    await tick(10)   // 'B' programmé — NE DOIT PAS démarrer tant que 'A' est en vol

    game.serialize = () => ({ state: 'C' })
    game._onMutate(game)
    await tick(10)   // 'C' remplace 'B' dans l'attente coalescée (un seul maillon en attente, pas un par mutation)

    assert.equal(résolveurs.length, 1, "un seul save réellement EN VOL — 'B' et 'C' ne doivent pas avoir démarré pendant que 'A' tournait encore")

    résolveurs[0]()   // termine A
    await tick(10)

    assert.equal(résolveurs.length, 2, "le save coalescé (dernier état programmé = 'C') démarre seulement APRÈS la fin de 'A'")
    résolveurs[1]()   // termine le save coalescé
    await tick(5)

    assert.deepEqual(écrits, ['A', 'C'], "l'état final écrit est le DERNIER programmé ('C') — 'B' a été coalescé, jamais écrit séparément")
    assert.equal(maxEnVolSimultane, 1, 'jamais 2 sauvegardes en vol simultanément pour la même partie')
  })

  it("un remove() passe APRÈS une sauvegarde déjà en vol et annule celle restée en attente — aucun ancien état ne ressuscite la partie supprimée", async () => {
    let résoudreA: () => void = () => {}
    const appelsSave: string[] = []
    const appelsRemove: string[] = []
    const adapter: any = {
      async load() { return [] },
      save(_id: string, data: any) {
        appelsSave.push(data.state)
        return new Promise<void>((resolve) => { résoudreA = resolve })
      },
      remove(id: string) { appelsRemove.push(id) },
    }
    const engine = createPersistEngine({ adapter, debounce: 0, snapshotEvery: 0 } as any, () => {})!
    const game: any = { id: 'g-remove', serialize: () => ({ state: 'A' }), _onMutate: null }
    engine.armGame(game)

    game._onMutate(game)
    await tick(10)   // save('A') démarre, EN VOL

    game.serialize = () => ({ state: 'B' })
    game._onMutate(game)
    await tick(10)   // 'B' programmé, en ATTENTE derrière 'A' (toujours en vol)

    engine.forgetGame('g-remove')   // suppression demandée PENDANT que 'A' est en vol
    await tick(10)

    assert.equal(appelsRemove.length, 0, "sanity : remove() ne doit pas encore être parti — 'A' est toujours en vol")
    résoudreA()   // 'A' se termine enfin
    await tick(10)

    assert.deepEqual(appelsSave, ['A'], "save('B') ne doit JAMAIS être appelé — annulé par le remove")
    assert.deepEqual(appelsRemove, ['g-remove'], 'remove() doit partir UNE FOIS, après la fin du save en vol')
  })

  it("une partie RECRÉÉE avec le même id pendant qu'un ancien save est en vol n'est jamais effacée par le remove tardif de sa vie précédente", async () => {
    const store = new Map<string, string>()
    let débloquerAncienSave: () => void = () => {}
    const adapter: any = {
      async load() { return [] },
      save(id: string, data: any) {
        if (data.state === 'etat-1') return new Promise<void>((resolve) => { débloquerAncienSave = () => { store.set(id, data.state); resolve() } })
        store.set(id, data.state)
        return undefined
      },
      remove(id: string) { store.delete(id) },
    }
    const engine = createPersistEngine({ adapter, debounce: 0, snapshotEvery: 0 } as any, () => {})!

    // 1. arme game1 (id g1), déclenche un save LENT qui reste EN VOL
    const game1: any = { id: 'g1', serialize: () => ({ state: 'etat-1' }), _onMutate: null }
    engine.armGame(game1)
    game1._onMutate(game1)
    await tick(10)   // le save('etat-1') a démarré, reste bloqué (en vol)

    // 2. pendant que ce save est EN VOL, la partie est oubliée (détruite)
    engine.forgetGame('g1')

    // 3. IMMÉDIATEMENT, une NOUVELLE partie avec le MÊME id est armée (partie recréée)
    const game2: any = { id: 'g1', serialize: () => ({ state: 'etat-2-nouveau' }), _onMutate: null }
    engine.armGame(game2)
    game2._onMutate(game2)
    await tick(10)   // le save('etat-2-nouveau') n'a rien qui le bloque — mais ne doit PAS dépasser le remove hérité de l'ancienne vie

    // 4. le vieux save (celui de game1) se termine ENFIN
    débloquerAncienSave()
    await tick(10)

    assert.equal(store.get('g1'), 'etat-2-nouveau', "la partie recréée est VIVANTE — elle ne doit jamais finir effacée par le remove de sa vie précédente")
  })

  it("id recréé PLUSIEURS FOIS de suite (armGame/forgetGame répétés) : l'état final est celui de la DERNIÈRE vie, jamais une vie antérieure", async () => {
    const store = new Map<string, string>()
    const adapter: any = {
      async load() { return [] },
      save(id: string, data: any) { store.set(id, data.state); return undefined },
      remove(id: string) { store.delete(id) },
    }
    const engine = createPersistEngine({ adapter, debounce: 0, snapshotEvery: 0 } as any, () => {})!

    for (let vie = 1; vie <= 4; vie++) {
      const game: any = { id: 'g-cycle', serialize: () => ({ state: `vie-${vie}` }), _onMutate: null }
      engine.armGame(game)
      game._onMutate(game)
      await tick(5)
      if (vie < 4) engine.forgetGame('g-cycle')   // la dernière vie reste vivante — pas de forget
    }
    await tick(10)

    assert.equal(store.get('g-cycle'), 'vie-4', "l'état final doit être celui de la DERNIÈRE vie armée")
  })

  it('forgetGame() sans aucun save en vol (remove immédiat) continue de fonctionner normalement', async () => {
    const appelsRemove: string[] = []
    const adapter: any = { async load() { return [] }, save() {}, remove(id: string) { appelsRemove.push(id) } }
    const engine = createPersistEngine({ adapter, debounce: 0, snapshotEvery: 0 } as any, () => {})!
    const game: any = { id: 'g-remove-seul', serialize: () => ({ state: 'x' }), _onMutate: null }
    engine.armGame(game)

    engine.forgetGame('g-remove-seul')
    await tick(10)

    assert.deepEqual(appelsRemove, ['g-remove-seul'])
  })
})
