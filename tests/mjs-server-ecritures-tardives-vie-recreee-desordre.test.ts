// Ce que ce test garantit : le rattrapage d'une écriture de sauvegarde abandonnée (sans réponse au bout de 30 s) qui répond bien plus tard.
//   - Un identifiant recréé : la sauvegarde tardive de l'ANCIENNE partie, arrivée après le DELETE de sa fin et avant la 1re sauvegarde de la
//     partie recréée, remettait l'ancienne ligne dans le stockage (une ligne fantôme que le prochain démarrage restaurait). Le moteur
//     compte désormais les vies d'un identifiant : une sauvegarde tardive d'une autre vie est rattrapée en réécrivant l'état de la partie vivante.
//   - Un stockage qui exécute dans le désordre : une écriture abandonnée peut s'exécuter APRÈS une plus récente déjà lancée, même
//     sans réponse de celle-ci. Le moteur réécrit dès qu'une écriture de rang supérieur a été LANCÉE, pas seulement quand elle a abouti ;
//     une réécriture faite pour rattraper n'en déclenche pas d'autre à son tour (aucune boucle : quelques écritures par scénario).
//   - Les garde-fous de ce rattrapage : la suppression renvoyée d'une partie finie attend derrière celle encore en vol, un journal qui lève
//     ne la fait pas perdre, les avertissements nomment la bonne opération, une écriture qui ÉCHOUE ne compte pas comme abouti, et le rang
//     d'une écriture est pris quand elle part (pas quand elle est programmée).
// Les minuteries sont simulées : aucune vraie attente de 30 s.
import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { createPersistEngine, resolvePersistOption } from '../src/mjs-server/index.js'

const DELAI = 30000

// les minuteries simulées ne font pas avancer les promesses : on les laisse se dérouler avant de regarder
const laisse = async () => { for (let i = 0; i < 20; i++) await new Promise<void>(r => setImmediate(r)) }
const avance = async (ms: number) => { mock.timers.tick(ms); await laisse() }
const partie = (id: string): any => ({ id, n: 0, serialize() { return { id: this.id, n: this.n } }, _onMutate: null })
const mute   = (game: any, n: number) => { game.n = n; game._onMutate(game) }

function moteur(adapter: any, surLog?: (msg: string) => void) {
  const warns  = [] as string[]
  const engine = createPersistEngine(resolvePersistOption({ adapter, debounce: 100 })!, (niveau: string, msg: string) => {
    if (niveau !== 'warn') return
    warns.push(msg)
    surLog?.(msg)
  })!
  return { engine, warns }
}

type Ecriture = { op: string; id: string; n: number; execute: () => void; repond: () => void; echoue: () => void; aboutit: () => void }

// stockage à écritures pilotées : chaque save()/remove() rend une promesse que le test fait répondre ou échouer quand il veut ;
// l'EXÉCUTION (la ligne posée ou retirée) et la RÉPONSE sont deux gestes distincts, `aboutit` fait les deux
function stockage() {
  const lignes    = new Map<string, string>()
  const ecritures = [] as Ecriture[]
  const fabrique  = (op: string, id: string, n: number, effet: () => void) => new Promise<void>((resolve, reject) => {
    const e: Ecriture = { op, id, n, execute: effet, repond: () => resolve(), echoue: () => reject(new Error('refusée')), aboutit: () => { effet(); resolve() } }
    ecritures.push(e)
  })
  const adapter = {
    load: async () => [],
    save:   (id: string, data: any) => fabrique('save', id, data.n, () => { lignes.set(id, String(data.n)) }),
    remove: (id: string) => fabrique('remove', id, 0, () => { lignes.delete(id) }),
  }
  return { adapter, lignes, ecritures }
}

describe('MJS-Server — écritures tardives : identifiant recréé, stockage dans le désordre', function () {
  this.timeout(30000)
  beforeEach(() => { mock.timers.enable({ apis: ['setTimeout'] }) })
  afterEach(() => { mock.timers.reset() })

  it('identifiant recréé : la sauvegarde tardive de l\'ancienne partie ne laisse pas sa ligne, l\'état de la partie vivante est réécrit', async () => {
    const { adapter, lignes, ecritures } = stockage()
    const { engine }                     = moteur(adapter)
    const vieille                        = partie('salon')
    engine.armGame(vieille)
    mute(vieille, 1)
    await avance(100)                        // la sauvegarde de la vieille partie part et reste coincée
    engine.forgetGame('salon')               // la partie se termine : son remove attend derrière
    const neuve = partie('salon')
    engine.armGame(neuve)                    // recréée sous le même identifiant, elle ne mute pas encore
    await avance(DELAI)                      // la sauvegarde est abandonnée, le remove part
    assert.equal(ecritures[1].op, 'remove', 'sanity : le remove de la vieille partie est parti')
    ecritures[1].aboutit()                   // le DELETE passe : la ligne est absente
    await laisse()
    ecritures[0].aboutit()                   // la sauvegarde de la VIEILLE partie arrive tard : la ligne revient
    await laisse()
    assert.equal(lignes.get('salon'), '1', 'sanity : la sauvegarde tardive a bien remis l\'ancienne ligne')
    assert.equal(ecritures.length, 3, 'une écriture de rattrapage est partie')
    assert.equal(ecritures[2].op, 'save', 'c\'est l\'état de la partie vivante qui est réécrit')
    ecritures[2].aboutit()
    await laisse()
    assert.equal(lignes.get('salon'), '0', 'la ligne est celle de la partie vivante, plus l\'ancienne')
  })

  it('stockage dans le désordre : une écriture abandonnée qui s\'exécute après la plus récente (lancée, sans réponse) est rattrapée', async () => {
    const { adapter, lignes, ecritures } = stockage()
    const { engine }                     = moteur(adapter)
    const game                           = partie('g')
    engine.armGame(game)
    mute(game, 1)
    await avance(100)                        // 1re écriture, coincée
    mute(game, 2)
    await avance(100)                        // la 2e attend derrière
    await avance(DELAI)                      // la 1re est abandonnée, la 2e part
    assert.equal(ecritures[1].n, 2, 'sanity : la 2e écriture est partie')
    ecritures[1].execute()                   // elle s'exécute, sans que sa réponse arrive
    await laisse()
    assert.equal(lignes.get('g'), '2')
    ecritures[0].aboutit()                   // la 1re s'exécute enfin, par-dessus, et répond
    await laisse()
    assert.equal(lignes.get('g'), '1', 'sanity : l\'écriture tardive a remplacé l\'état plus récent')
    assert.equal(ecritures.length, 2, 'sanity : la réécriture attend derrière la 2e écriture, toujours en vol (une écriture à la fois par partie)')
    await avance(DELAI)                      // la 2e, toujours muette, est abandonnée à son tour : la réécriture part
    assert.equal(ecritures.length, 3, 'une écriture de rattrapage est partie, la plus récente n\'ayant jamais répondu')
    ecritures[2].aboutit()
    await laisse()
    assert.equal(lignes.get('g'), '2', 'la ligne finit sur l\'état le plus récent')
  })

  it('un stockage qui répond toujours après 35 s : vingt minutes, quelques écritures et pas une boucle de réécriture (témoin : vert aussi sans le correctif)', async () => {
    let saves = 0
    const adapter = {
      load: async () => [],
      remove() {},
      save: () => { saves++; return new Promise<void>(resolve => { setTimeout(resolve, 35000) }) },
    }
    const { engine } = moteur(adapter)
    const game       = partie('g-lent')
    engine.armGame(game)
    mute(game, 1)
    await avance(100)
    mute(game, 2)
    await avance(100)
    for (let s = 0; s < 1200; s++) await avance(1000)
    assert.ok(saves <= 6, `${saves} écritures en vingt minutes : une écriture de rattrapage ne doit pas en déclencher une autre sans fin`)
  })

  it('une partie finie dont la suppression est encore en vol : la suppression renvoyée par la sauvegarde tardive attend derrière elle', async () => {
    const { adapter, ecritures } = stockage()
    const { engine }             = moteur(adapter)
    const game                   = partie('g')
    engine.armGame(game)
    mute(game, 1)
    await avance(100)
    engine.forgetGame('g')
    await avance(DELAI)                      // sauvegarde abandonnée, le DELETE part et reste en vol
    assert.equal(ecritures.length, 2, 'sanity : sauvegarde et DELETE')
    ecritures[0].aboutit()                   // la sauvegarde répond pendant que le DELETE est en vol
    await laisse()
    assert.equal(ecritures.length, 2, 'la suppression renvoyée attend derrière le DELETE en vol')
    ecritures[1].aboutit()
    await laisse()
    assert.equal(ecritures.length, 3, 'une fois le DELETE fini, la suppression est renvoyée')
    assert.equal(ecritures[2].op, 'remove')
  })

  it('un journal qui lève sur l\'avertissement « après la fin de la partie » ne fait pas perdre la suppression renvoyée', async () => {
    const { adapter, ecritures } = stockage()
    const { engine }             = moteur(adapter, msg => { if (/fin de la partie/.test(msg)) throw new Error('journal en panne') })
    const game                   = partie('g')
    engine.armGame(game)
    mute(game, 1)
    await avance(100)
    engine.forgetGame('g')
    await avance(DELAI)
    ecritures[1].aboutit()
    await laisse()
    ecritures[0].aboutit()                   // la sauvegarde abandonnée recrée la ligne : l'avertissement lève
    await laisse()
    assert.equal(ecritures.length, 3, 'la suppression est renvoyée malgré le journal')
    assert.equal(ecritures[2].op, 'remove')
  })

  it('les avertissements nomment la bonne opération : une sauvegarde tardive dit save, une suppression tardive dit remove', async () => {
    // sauvegarde tardive : la 1re écriture abandonnée répond alors que la 2e est lancée
    const s1 = stockage()
    const m1 = moteur(s1.adapter)
    const g1 = partie('g')
    m1.engine.armGame(g1)
    mute(g1, 1)
    await avance(100)
    mute(g1, 2)
    await avance(100)
    await avance(DELAI)
    s1.ecritures[0].aboutit()
    await laisse()
    assert.ok(m1.warns.some(w => w.includes('persist.save(\'g\')') && /l'écriture abandonnée a fini par répondre/.test(w)), `avertissement de sauvegarde tardive : ${JSON.stringify(m1.warns)}`)
    assert.ok(!m1.warns.some(w => /la suppression abandonnée a fini par répondre/.test(w)), 'aucun avertissement de suppression tardive')

    // suppression tardive : le DELETE abandonné répond après la sauvegarde de la partie recréée
    const s2 = stockage()
    const m2 = moteur(s2.adapter)
    const v2 = partie('h')
    m2.engine.armGame(v2)
    mute(v2, 1)
    await avance(100)
    s2.ecritures[0].aboutit()                // la 1re sauvegarde aboutit
    await laisse()
    m2.engine.forgetGame('h')                // la partie finit : son DELETE part et reste coincé
    await laisse()
    const n2 = partie('h')
    m2.engine.armGame(n2)
    mute(n2, 5)
    await avance(100)
    await avance(DELAI)                      // le DELETE est abandonné, la sauvegarde de la partie recréée part
    s2.ecritures[2].aboutit()
    await laisse()
    s2.ecritures[1].aboutit()                // le DELETE abandonné s'exécute enfin et efface la ligne de la partie recréée
    await laisse()
    assert.ok(m2.warns.some(w => w.includes('persist.remove(\'h\')') && /la suppression abandonnée a fini par répondre/.test(w)), `avertissement de suppression tardive : ${JSON.stringify(m2.warns)}`)
  })

  it('une écriture qui ÉCHOUE ne compte pas comme abouti : la tardive d\'une réécriture de rattrapage ne relance rien à cause d\'elle', async () => {
    const { adapter, lignes, ecritures } = stockage()
    const { engine }                     = moteur(adapter)
    const game                           = partie('g')
    engine.armGame(game)
    mute(game, 1)
    await avance(100)                        // 1re écriture, coincée
    mute(game, 2)
    await avance(100)
    await avance(DELAI)                      // la 1re est abandonnée, la 2e part
    ecritures[1].aboutit()                   // la 2e abouti à temps
    await laisse()
    ecritures[0].aboutit()                   // la 1re répond tard : réécriture de rattrapage (3e écriture)
    await laisse()
    assert.equal(ecritures.length, 3, 'sanity : la réécriture est partie')
    await avance(DELAI)                      // la réécriture est abandonnée à son tour
    mute(game, 3)
    await avance(100)                        // une nouvelle mutation : 4e écriture
    assert.equal(ecritures.length, 4, 'sanity : la 4e écriture est partie')
    ecritures[3].echoue()                    // elle est refusée tout de suite
    await laisse()
    ecritures[2].aboutit()                   // la réécriture répond enfin
    await laisse()
    assert.equal(ecritures.length, 4, 'une écriture refusée n\'est pas un état plus récent écrit : aucune écriture de plus')
    assert.equal(lignes.get('g'), '2')
  })

  it('le rang d\'une écriture est pris quand elle part : la partie recréée qui a muté avant le départ du DELETE est rattrapée si ce DELETE efface sa ligne', async () => {
    const { adapter, lignes, ecritures } = stockage()
    const { engine }                     = moteur(adapter)
    const vieille                        = partie('g')
    engine.armGame(vieille)
    mute(vieille, 1)
    await avance(100)                        // 1re sauvegarde (vieille partie), coincée
    engine.forgetGame('g')                   // son DELETE attend derrière
    const neuve = partie('g')
    engine.armGame(neuve)
    mute(neuve, 5)
    await avance(100)                        // la partie recréée programme sa sauvegarde AVANT que le DELETE ne parte
    await avance(DELAI)                      // 1re abandonnée : le DELETE part
    assert.equal(ecritures[1].op, 'remove', 'sanity : le DELETE est parti')
    await avance(DELAI)                      // le DELETE est abandonné : la sauvegarde de la partie recréée part
    assert.equal(ecritures[2].n, 5, 'sanity : la sauvegarde de la partie recréée est partie')
    ecritures[2].aboutit()
    await laisse()
    assert.equal(lignes.get('g'), '5')
    ecritures[1].aboutit()                   // le DELETE abandonné s'exécute enfin : il efface la ligne
    await laisse()
    assert.equal(lignes.has('g'), false, 'sanity : le DELETE tardif a bien effacé la ligne')
    assert.equal(ecritures.length, 4, 'le DELETE tardif est postérieur à la sauvegarde : l\'état est réécrit')
    ecritures[3].aboutit()
    await laisse()
    assert.equal(lignes.get('g'), '5', 'la ligne de la partie recréée est restaurée')
  })
})
