// Ce que ce test garantit : une écriture de sauvegarde abandonnée au bout de 30 s qui aboutit bien plus tard ne laisse
// jamais le stockage sur un état plus ancien que celui de la partie. Le moteur abandonne une écriture sans réponse et passe
// à la suivante ; mais un stockage lent, pas mort, finit par l'exécuter : un INSERT coincé 40 s arrivait APRÈS la
// sauvegarde suivante (30,1 s) et l'écrasait, un DELETE abandonné arrivait après la sauvegarde de la partie recréée sous
// le même identifiant et effaçait sa ligne, une sauvegarde abandonnée arrivait après le DELETE d'une partie finie et
// ressuscitait sa ligne. Désormais, quand une écriture abandonnée répond enfin et qu'une écriture plus récente avait
// abouti avant elle, le moteur réécrit l'état courant de la partie (ou renvoie la suppression d'une partie finie) et
// l'avertissement le dit. Aucune réécriture inutile : pas de réécriture quand rien de plus récent n'a abouti (un stockage
// qui répond en échec après 30 s ne déclenche aucune boucle), ni quand une sauvegarde est déjà programmée ; à l'arrêt,
// le moteur n'écrit plus, il prévient. Les minuteries sont simulées : aucune vraie attente de 30 s.
import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { createPersistEngine, resolvePersistOption, SqlPersistAdapter } from '../src/mjs-server/index.js'

const DELAI = 30000

// les minuteries simulées ne font pas avancer les promesses : on les laisse se dérouler avant de regarder
const laisse = async () => { for (let i = 0; i < 20; i++) await new Promise<void>(r => setImmediate(r)) }
const avance = async (ms: number) => { mock.timers.tick(ms); await laisse() }
const partie = (id: string): any => ({ id, n: 0, serialize() { return { id: this.id, n: this.n } }, _onMutate: null })
const mute   = (game: any, n: number) => { game.n = n; game._onMutate(game) }
const etat   = (id: string, n: number) => JSON.stringify({ id, n })

function moteur(adapter: any) {
  const warns  = [] as string[]
  const engine = createPersistEngine(resolvePersistOption({ adapter, debounce: 100 })!, (niveau: string, msg: string) => { if (niveau === 'warn') warns.push(msg) })!
  return { engine, warns }
}

// base simulée derrière le vrai SqlPersistAdapter : un INSERT pose sa ligne, un DELETE la retire, À L'INSTANT OÙ ils
// s'exécutent ; `lent.insert[n]` / `lent.delete[n]` fait attendre le n-ième INSERT / DELETE (en ms) avant son exécution,
// `echec` fait ÉCHOUER chaque INSERT après son attente (au lieu de poser sa ligne)
function baseSimulee(lent: { insert?: Record<number, number>; delete?: Record<number, number> } = {}, echec = false) {
  const lignes = new Map<string, string>()
  const ordre  = [] as string[]
  let inserts  = 0
  let deletes  = 0
  const query  = async (sql: string, params: unknown[]) => {
    if (/^CREATE/.test(sql)) return []
    const insert = /^INSERT/.test(sql)
    const rang   = insert ? ++inserts : ++deletes
    const attente = (insert ? lent.insert : lent.delete)?.[rang]
    if (attente) await new Promise<void>(r => setTimeout(r, attente))
    if (echec && insert) throw new Error('lock wait timeout exceeded')
    if (insert) { lignes.set(String(params[0]), String(params[1])); ordre.push('insert ' + params[1]) }
    else        { lignes.delete(String(params[0])); ordre.push('delete ' + params[0]) }
    return []
  }
  return { lignes, ordre, query, inserts: () => inserts, deletes: () => deletes }
}

// stockage à écritures pilotées : chaque save()/remove() rend une promesse que le test fait aboutir ou échouer quand il veut,
// la ligne n'étant posée ou retirée qu'à cet instant
function stockage() {
  const lignes    = new Map<string, string>()
  const ecritures = [] as Array<{ op: string; id: string; n: number; aboutit: () => void; echoue: (e: Error) => void }>
  const adapter   = {
    load: async () => [],
    save:   (id: string, data: any) => new Promise<void>((resolve, reject) => { ecritures.push({ op: 'save', id, n: data.n, aboutit: () => { lignes.set(id, String(data.n)); resolve() }, echoue: reject }) }),
    remove: (id: string) => new Promise<void>((resolve, reject) => { ecritures.push({ op: 'remove', id, n: 0, aboutit: () => { lignes.delete(id); resolve() }, echoue: reject }) }),
  }
  return { adapter, lignes, ecritures }
}

describe('MJS-Server — sauvegarde : une écriture abandonnée qui aboutit bien plus tard', function () {
  this.timeout(30000)
  beforeEach(() => { mock.timers.enable({ apis: ['setTimeout'] }) })
  afterEach(() => { mock.timers.reset() })

  it('un INSERT coincé 40 s aboutit après la sauvegarde suivante : la base finit sur l\'état le plus récent', async () => {
    const base       = baseSimulee({ insert: { 1: 40000 } })
    const adapter    = new SqlPersistAdapter({ query: base.query, onLog: () => {} })
    const { engine } = moteur(adapter)
    const game       = partie('g-lente')
    engine.armGame(game)

    mute(game, 1)
    await avance(100)                        // la 1re écriture part : son INSERT reste coincé 40 s
    mute(game, 2)
    await avance(100)                        // la 2e attend derrière la 1re
    await avance(DELAI - 100)                // t = 30 100 : la 1re est abandonnée, la 2e part et passe
    assert.equal(base.lignes.get('g-lente'), etat('g-lente', 2), 'sanity : la 2e écriture est passée')

    await avance(10000)                      // t = 40 100 : l'INSERT coincé s'exécute enfin, par-dessus la 2e
    assert.equal(base.lignes.get('g-lente'), etat('g-lente', 2), `la base doit finir sur l'état le plus récent (ordre d'exécution : ${base.ordre.join(' ; ')})`)
    assert.equal(base.inserts(), 3, 'une seule réécriture')
  })

  it('les avertissements disent l\'abandon, puis que l\'état courant est réécrit quand l\'écriture abandonnée finit par répondre', async () => {
    const base               = baseSimulee({ insert: { 1: 40000 } })
    const adapter            = new SqlPersistAdapter({ query: base.query, onLog: () => {} })
    const { engine, warns }  = moteur(adapter)
    const game               = partie('g-lente')
    engine.armGame(game)

    mute(game, 1)
    await avance(100)
    mute(game, 2)
    await avance(100)
    await avance(DELAI - 100)                // t = 30 100 : la 1re est abandonnée
    assert.equal(warns.length, 1, `l'abandon est signalé : ${JSON.stringify(warns)}`)
    assert.match(warns[0], /g-lente/, 'l\'avertissement d\'abandon nomme la partie')
    assert.match(warns[0], /réécrit/, 'l\'avertissement d\'abandon prévient que l\'état courant sera réécrit si l\'écriture aboutit')

    await avance(10000)                      // t = 40 100 : elle aboutit enfin
    assert.equal(warns.length, 2, `la réponse tardive est signalée : ${JSON.stringify(warns)}`)
    assert.match(warns[1], /g-lente/, 'l\'avertissement nomme la partie')
    assert.match(warns[1], /réécrit/, 'l\'avertissement dit que l\'état courant est réécrit')
  })

  it('un DELETE abandonné aboutit après la sauvegarde de la partie recréée sous le même identifiant : sa ligne n\'est pas effacée', async () => {
    const base                 = baseSimulee({ delete: { 1: 40000 } })
    const adapter              = new SqlPersistAdapter({ query: base.query, onLog: () => {} })
    const { engine, warns }    = moteur(adapter)
    const vieille              = partie('salon-7')
    engine.armGame(vieille)

    mute(vieille, 1)
    await avance(100)                        // la partie est sauvée
    engine.forgetGame('salon-7')             // elle se termine : son DELETE reste coincé 40 s
    await avance(1000)
    const neuve                = partie('salon-7')
    engine.armGame(neuve)                    // recréée sous le même identifiant : elle attend derrière le DELETE
    mute(neuve, 42)
    await avance(DELAI)                      // le DELETE est abandonné, la partie neuve se sauvegarde
    assert.equal(base.lignes.get('salon-7'), etat('salon-7', 42), 'sanity : la partie recréée est sauvée')

    await avance(10000)                      // le DELETE abandonné s'exécute enfin
    assert.equal(base.lignes.get('salon-7'), etat('salon-7', 42), `la partie recréée ne doit pas être effacée (ordre d'exécution : ${base.ordre.join(' ; ')})`)
    assert.ok(warns.some(w => /salon-7/.test(w) && /réécrit/.test(w) && /suppress/.test(w)), `la réponse tardive du DELETE est signalée : ${JSON.stringify(warns)}`)
  })

  it('une sauvegarde abandonnée aboutit après le DELETE de la partie finie : sa ligne ne reste pas, la suppression est renvoyée', async () => {
    const base                 = baseSimulee({ insert: { 1: 40000 } })
    const adapter              = new SqlPersistAdapter({ query: base.query, onLog: () => {} })
    const { engine, warns }    = moteur(adapter)
    const game                 = partie('g-finie')
    engine.armGame(game)

    mute(game, 1)
    await avance(100)                        // la sauvegarde part : son INSERT reste coincé 40 s
    engine.forgetGame('g-finie')             // la partie se termine : son DELETE attend derrière la sauvegarde
    await avance(DELAI)                      // la sauvegarde est abandonnée, le DELETE passe
    assert.equal(base.deletes(), 1, 'sanity : le DELETE de la partie finie est passé')

    await avance(10000)                      // l'INSERT abandonné s'exécute enfin : il pose une ligne pour une partie qui n'existe plus
    assert.equal(base.lignes.has('g-finie'), false, `la ligne d'une partie finie ne doit pas rester (ordre d'exécution : ${base.ordre.join(' ; ')})`)
    assert.ok(warns.some(w => /g-finie/.test(w) && /suppress/.test(w) && /fin de la partie/.test(w)), `la réponse tardive est signalée : ${JSON.stringify(warns)}`)
  })

  it('la suppression renvoyée d\'une partie finie est chaînée : la partie recréée sous le même identifiant juste après attend derrière elle', async () => {
    const { adapter, lignes, ecritures } = stockage()
    const { engine }                     = moteur(adapter)
    const game                           = partie('g-finie')
    engine.armGame(game)

    mute(game, 1)
    await avance(100)                        // la sauvegarde part (1re écriture) et ne répond pas
    engine.forgetGame('g-finie')             // la partie se termine : son remove attend derrière
    await avance(DELAI)                      // la sauvegarde est abandonnée, le remove part (2e écriture)
    assert.equal(ecritures[1].op, 'remove', 'sanity : le remove de la partie finie est parti')
    ecritures[1].aboutit()
    await laisse()
    ecritures[0].aboutit()                   // la sauvegarde abandonnée aboutit enfin : elle ressuscite la ligne, la suppression est renvoyée
    await laisse()
    assert.equal(ecritures.length, 3, 'sanity : la suppression est renvoyée')
    assert.equal(ecritures[2].op, 'remove', 'sanity : c\'est bien une suppression')

    const neuve = partie('g-finie')
    engine.armGame(neuve)                    // recréée sous le même identifiant, pendant que la suppression renvoyée est en vol
    mute(neuve, 7)
    await avance(100)
    assert.equal(ecritures.length, 3, 'la sauvegarde de la partie recréée attend derrière la suppression renvoyée')
    ecritures[2].aboutit()
    await laisse()
    assert.equal(ecritures.length, 4, 'une fois la suppression finie, la partie recréée se sauvegarde')
    ecritures[3].aboutit()
    await laisse()
    assert.equal(lignes.get('g-finie'), '7', 'la partie recréée n\'est pas effacée par la suppression renvoyée')
  })

  it('un journal qui lève sur l\'avertissement de réponse tardive ne fait pas perdre la réécriture et ne laisse aucun rejet non géré', async () => {
    const rejets: unknown[] = []
    const surRejet          = (e: unknown) => { rejets.push(e) }
    process.on('unhandledRejection', surRejet)
    try {
      const { adapter, lignes, ecritures } = stockage()
      const engine = createPersistEngine(resolvePersistOption({ adapter, debounce: 100 })!, (_niveau: string, msg: string) => { if (/fini par répondre/.test(msg)) throw new Error('journal cassé') })!
      const game   = partie('g-journal')
      engine.armGame(game)

      mute(game, 1)
      await avance(100)
      mute(game, 2)
      await avance(100)
      await avance(DELAI - 100)              // la 1re est abandonnée, la 2e part et passe
      ecritures[1].aboutit()
      await laisse()
      ecritures[0].aboutit()                 // la 1re aboutit enfin, par-dessus la 2e : l'avertissement lève
      await laisse()
      assert.deepEqual(rejets, [], 'l\'erreur du journal ne devient pas un rejet non géré')
      assert.equal(ecritures.length, 3, 'la réécriture est partie malgré le journal cassé')
      ecritures[2].aboutit()
      await laisse()
      assert.equal(lignes.get('g-journal'), '2', 'la base finit sur l\'état le plus récent')
    } finally { process.off('unhandledRejection', surRejet) }
  })

  it('une écriture abandonnée est refaite une seconde après ; sa réponse tardive, du même état que la plus récente, ne déclenche aucune réécriture', async () => {
    const base                 = baseSimulee({ insert: { 1: 40000 } })
    const adapter              = new SqlPersistAdapter({ query: base.query, onLog: () => {} })
    const { engine, warns }    = moteur(adapter)
    const game                 = partie('g-seule')
    engine.armGame(game)

    mute(game, 1)
    await avance(100)                        // la seule écriture part : son INSERT reste coincé 40 s
    await avance(DELAI)                      // elle est abandonnée
    await avance(10000)                      // refaite une seconde après (et aboutie), puis elle aboutit à son tour : même état
    assert.equal(base.lignes.get('g-seule'), etat('g-seule', 1))
    assert.equal(base.inserts(), 2, 'l\'écriture sans réponse est refaite une fois, sa réponse tardive ne réécrit rien')
    assert.equal(warns.length, 1, `seul l'abandon est signalé : ${JSON.stringify(warns)}`)
  })

  it('un stockage qui répond en ÉCHEC après 35 s ne déclenche aucune boucle de réécriture : quelques écritures en dix minutes, pas une de plus à chaque réponse', async () => {
    const base                 = baseSimulee({ insert: { 1: 35000, 2: 35000, 3: 35000, 4: 35000, 5: 35000, 6: 35000 } }, true)
    const adapter              = new SqlPersistAdapter({ query: base.query, onLog: () => {} })
    const { engine }           = moteur(adapter)
    const game                 = partie('g-panne')
    engine.armGame(game)

    mute(game, 1)
    await avance(100)                        // la 1re écriture part, elle répondra en échec à 35 s
    mute(game, 2)
    await avance(100)                        // la 2e attend derrière la 1re
    for (let s = 0; s < 600; s++) await avance(1000)
    assert.ok(base.inserts() <= 6, `${base.inserts()} écritures en dix minutes : une écriture abandonnée qui répond en échec ne doit pas relancer une écriture de plus à chaque réponse, sans fin`)
  })

  it('une sauvegarde déjà programmée n\'est pas doublée : la réponse tardive tombe pendant le débounce de la mutation suivante', async () => {
    const { adapter, lignes, ecritures } = stockage()
    const { engine, warns }              = moteur(adapter)
    const game                           = partie('g-programmee')
    engine.armGame(game)

    mute(game, 1)
    await avance(100)                        // 1re écriture en vol
    mute(game, 2)
    await avance(100)                        // la 2e attend derrière
    await avance(DELAI - 100)                // la 1re est abandonnée, la 2e part
    ecritures[1].aboutit()
    await laisse()
    await avance(9950)                       // t = 40 050
    mute(game, 3)                            // une sauvegarde est programmée (débounce : t = 40 150)
    ecritures[0].aboutit()                   // la 1re aboutit enfin, par-dessus la 2e
    await laisse()
    assert.equal(ecritures.length, 2, 'la sauvegarde déjà programmée suffit : aucune réécriture en plus')
    assert.equal(warns.filter(w => /fini par répondre/.test(w)).length, 0, `aucun avertissement n'annonce une réécriture qui n'a pas lieu : ${JSON.stringify(warns)}`)

    await avance(100)                        // le débounce échoit
    assert.equal(ecritures.length, 3, 'la sauvegarde programmée part')
    ecritures[2].aboutit()
    await laisse()
    assert.equal(lignes.get('g-programmee'), '3', 'la base finit sur le dernier état')
  })

  it('une sauvegarde déjà en attente derrière l\'écriture en vol n\'est pas doublée non plus', async () => {
    const { adapter, lignes, ecritures } = stockage()
    const { engine, warns }              = moteur(adapter)
    const game                           = partie('g-coalescee')
    engine.armGame(game)

    mute(game, 1)
    await avance(100)                        // 1re écriture en vol
    mute(game, 2)
    await avance(100)                        // la 2e attend derrière
    await avance(DELAI - 100)                // la 1re est abandonnée, la 2e part
    ecritures[1].aboutit()
    await laisse()
    mute(game, 3)
    await avance(100)                        // la 3e part (la chaîne est libre) et reste en vol
    assert.equal(ecritures.length, 3, 'sanity : la 3e écriture est en vol')
    mute(game, 4)
    await avance(100)                        // la 4e attend derrière la 3e
    ecritures[0].aboutit()                   // la 1re aboutit enfin : une sauvegarde est déjà en attente derrière la 3e
    await laisse()
    assert.equal(ecritures.length, 3, 'rien de plus : la sauvegarde en attente portera le dernier état')
    assert.equal(warns.filter(w => /fini par répondre/.test(w)).length, 0, `aucun avertissement n'annonce une réécriture qui n'a pas lieu : ${JSON.stringify(warns)}`)

    ecritures[2].aboutit()
    await laisse()
    assert.equal(ecritures.length, 4, 'la 4e part derrière la 3e')
    ecritures[3].aboutit()
    await laisse()
    assert.equal(lignes.get('g-coalescee'), '4', 'la base finit sur le dernier état')
  })

  it('pendant l\'arrêt, la sauvegarde abandonnée d\'une partie finie qui aboutit ne renvoie aucune suppression : l\'arrêt prévient', async () => {
    const { adapter, ecritures } = stockage()
    const { engine, warns }      = moteur(adapter)
    const game                   = partie('g-finie-arret')
    engine.armGame(game)

    mute(game, 1)
    await avance(100)                        // la sauvegarde part (1re écriture) et ne répond pas
    engine.forgetGame('g-finie-arret')       // la partie se termine : son remove attend derrière
    await avance(DELAI)                      // la sauvegarde est abandonnée, le remove part (2e écriture)
    ecritures[1].aboutit()
    await laisse()
    let rendu = false
    void engine.stop().then(() => { rendu = true })
    await laisse()
    assert.equal(rendu, true, 'sanity : rien n\'attend plus, stop() rend la main')
    const avant = warns.length

    ecritures[0].aboutit()                   // la sauvegarde abandonnée aboutit enfin, après l'arrêt : elle recrée la ligne
    await laisse()
    assert.equal(ecritures.length, 2, 'aucune suppression ne repart une fois l\'arrêt lancé')
    assert.equal(warns.length, avant + 1, `l'arrêt prévient : ${JSON.stringify(warns)}`)
    assert.match(warns[avant], /g-finie-arret/, 'l\'avertissement nomme la partie')
    assert.match(warns[avant], /arrêt/, 'l\'avertissement parle de l\'arrêt')
  })

  it('une sauvegarde qui répond à temps pour une partie finie entre-temps ne renvoie aucune suppression de plus (témoin : vert aussi sans le correctif)', async () => {
    const { adapter, ecritures } = stockage()
    const { engine, warns }      = moteur(adapter)
    const game                   = partie('g-fin-normale')
    engine.armGame(game)

    mute(game, 1)
    await avance(100)                        // la sauvegarde part (1re écriture)
    engine.forgetGame('g-fin-normale')       // la partie se termine : son remove attend derrière
    ecritures[0].aboutit()                   // la sauvegarde répond à temps
    await laisse()
    assert.equal(ecritures.length, 2, 'sanity : le remove part')
    ecritures[1].aboutit()
    await laisse()
    await avance(DELAI * 2)
    assert.equal(ecritures.length, 2, 'rien de plus : la sauvegarde n\'a pas été abandonnée, aucune ligne fantôme à craindre')
    assert.deepEqual(warns, [], 'aucun avertissement')
  })

  it('pendant l\'arrêt, une écriture abandonnée qui aboutit n\'en lance aucune nouvelle : l\'arrêt prévient que le stockage a pu être remplacé', async () => {
    const { adapter, lignes, ecritures } = stockage()
    const { engine, warns }              = moteur(adapter)
    const game                           = partie('g-arret')
    engine.armGame(game)

    mute(game, 1)
    await avance(100)
    mute(game, 2)
    await avance(100)
    await avance(DELAI - 100)                // la 1re est abandonnée, la 2e part
    ecritures[1].aboutit()
    await laisse()
    let rendu = false
    void engine.stop().then(() => { rendu = true })
    await laisse()
    assert.equal(rendu, true, 'sanity : rien n\'attend plus, stop() rend la main')
    const avant = warns.length

    ecritures[0].aboutit()                   // la 1re aboutit enfin, après l'arrêt : elle remplace l'état le plus récent
    await laisse()
    assert.equal(ecritures.length, 2, 'l\'arrêt est fini : aucune écriture ne repart')
    assert.equal(lignes.get('g-arret'), '1', 'sanity : le stockage a bien été remplacé, c\'est la limite de l\'arrêt')
    assert.equal(warns.length, avant + 1, `l'arrêt prévient : ${JSON.stringify(warns)}`)
    assert.match(warns[avant], /g-arret/, 'l\'avertissement nomme la partie')
    assert.match(warns[avant], /arrêt/, 'l\'avertissement parle de l\'arrêt')
  })

  it('une écriture abandonnée qui échoue enfin est traitée comme une réponse tardive, sans aucun rejet non géré', async () => {
    const rejets: unknown[] = []
    const surRejet          = (e: unknown) => { rejets.push(e) }
    process.on('unhandledRejection', surRejet)
    try {
      const { adapter, lignes, ecritures } = stockage()
      const { engine, warns }              = moteur(adapter)
      const game                           = partie('g-echec-tardif')
      engine.armGame(game)

      mute(game, 1)
      await avance(100)
      mute(game, 2)
      await avance(100)
      await avance(DELAI - 100)              // la 1re est abandonnée, la 2e part et passe
      ecritures[1].aboutit()
      await laisse()
      ecritures[0].echoue(new Error('réponse bien trop tardive, et en erreur'))
      await laisse()
      assert.deepEqual(rejets, [], 'le rejet tardif d\'une écriture abandonnée reste intercepté')
      assert.equal(ecritures.length, 3, 'en doute sur ce que le stockage a reçu, l\'état courant est réécrit')
      ecritures[2].aboutit()
      await laisse()
      assert.equal(lignes.get('g-echec-tardif'), '2')
      assert.ok(warns.some(w => /g-echec-tardif/.test(w) && /réécrit/.test(w)), `la réponse tardive est signalée : ${JSON.stringify(warns)}`)
    } finally { process.off('unhandledRejection', surRejet) }
  })
})
