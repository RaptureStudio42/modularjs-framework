// Ce que ce test garantit : l'adaptateur fichier ne retient pas, pour toujours, chaque écriture que le moteur a abandonnée.
// Il gardait dans sa liste d'écritures en vol (celle que flush() attend à l'arrêt) chaque promesse restée sans réponse : sur
// un disque réseau gelé, le moteur abandonne une écriture par partie toutes les 30 s et réessaie, soit 120 promesses retenues
// par heure et par partie, sans borne. Désormais chaque écriture n'est suivie que 30 s depuis son départ (comme pour les
// adaptateurs SQL et Redis) : passé ce délai l'adaptateur la lâche (le moteur en a fait autant), sa minuterie est retirée dès
// qu'elle répond, et flush() ne compte ni n'attend plus celles qui dorment depuis longtemps. Les minuteries sont simulées :
// aucune vraie attente de 30 s.
import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createPersistEngine, FilePersistAdapter, resolvePersistOption } from '../src/mjs-server/index.js'
import { mjsTmp } from './helpers/tmp.js'

const DELAI = 30000

// les minuteries simulées ne font pas avancer les promesses : on les laisse se dérouler avant de regarder
const laisse = async () => { for (let i = 0; i < 10; i++) await new Promise<void>(r => setImmediate(r)) }
const avance = async (ms: number) => { mock.timers.tick(ms); await laisse() }
const muette = () => new Promise<void>(() => {})
const partie = (id: string): any => ({ id, n: 0, serialize() { return { id: this.id, n: this.n } }, _onMutate: null })
const mute   = (game: any, n: number) => { game.n = n; game._onMutate(game) }

// les avertissements d'un journal, rangés dans `warns`
const journal = (warns: string[]) => (niveau: string, msg: string) => { if (niveau === 'warn') warns.push(msg) }

// disque réseau gelé : le dossier ne répond plus, aucune écriture ne revient — `_ready` est la promesse du dossier, que toute
// écriture attend d'abord ; remplacée ici par une promesse muette
async function adaptateurGele() {
  const warns        = [] as string[]
  const adapter: any = new FilePersistAdapter({ dir: mjsTmp('fichier-liberees'), onLog: journal(warns) })
  await adapter._ready                     // le mkdir du constructeur est fini : il ne recrée pas le dossier après son balayage
  adapter._ready     = muette()
  return { adapter, warns }
}

// vingt minutes de panne muette : une partie qui mute toutes les 5 s, une écriture abandonnée et retentée toutes les 30 s
async function pannePendantVingtMinutes(adapter: any) {
  const engine = createPersistEngine(resolvePersistOption({ adapter, debounce: 100 })!, () => {})!
  const game   = partie('g-panne')
  engine.armGame(game)
  for (let s = 0; s < 1200; s += 5) { mute(game, s); await avance(5000) }
}

describe('MJS-Server — FilePersistAdapter : les écritures abandonnées ne sont pas retenues pour toujours', function () {
  this.timeout(30000)
  beforeEach(() => { mock.timers.enable({ apis: ['setTimeout'] }) })
  afterEach(() => { mock.timers.reset() })

  it('vingt minutes de panne muette : la liste d\'écritures en vol ne grossit pas d\'une promesse par tentative du moteur', async () => {
    const { adapter } = await adaptateurGele()
    await pannePendantVingtMinutes(adapter)
    assert.ok(adapter._inFlight.size <= 2, `${adapter._inFlight.size} écritures retenues après vingt minutes de panne (une tentative abandonnée toutes les 30 s) : la liste ne doit retenir que celle en cours`)
  })

  it('une écriture est suivie 30 s : à 29,999 s elle est encore attendue par flush(), à 30 s elle est lâchée', async () => {
    const { adapter } = await adaptateurGele()
    for (let i = 0; i < 5; i++) void adapter.save('g-' + i, { id: 'g-' + i })
    await laisse()
    assert.equal(adapter._inFlight.size, 5, 'sanity : les cinq écritures sont en vol')

    await avance(DELAI - 1)
    assert.equal(adapter._inFlight.size, 5, 'trop tôt : flush() doit encore les attendre')
    await avance(1)
    assert.equal(adapter._inFlight.size, 0, 'passé 30 s, l\'adaptateur ne retient plus ces écritures')
  })

  it('flush() après une longue panne n\'attend que l\'écriture en cours et ne compte qu\'elle : pas les écritures abandonnées depuis longtemps', async () => {
    const { adapter, warns } = await adaptateurGele()
    await pannePendantVingtMinutes(adapter)
    let rendu = false
    void adapter.flush().then(() => { rendu = true })
    await avance(DELAI)                      // au plus 30 s : l'écriture en cours est lâchée à son tour
    assert.equal(rendu, true, 'flush() rend la main')
    const comptes = warns.filter(w => /flush\(\)/.test(w)).map(w => Number(/(\d+) écriture/.exec(w)?.[1]))
    assert.ok(comptes.every(nb => nb <= 1), `flush() ne compte que l'écriture en cours, pas les quarante abandonnées : ${JSON.stringify(warns)}`)
  })

  it('flush() rend la main tout de suite quand toutes les écritures sont déjà lâchées : sans attente et sans avertissement', async () => {
    const { adapter, warns } = await adaptateurGele()
    void adapter.save('g-a', { id: 'g-a' })
    await laisse()
    await avance(DELAI)                      // l'écriture est lâchée
    let rendu = false
    void adapter.flush().then(() => { rendu = true })
    await laisse()
    assert.equal(rendu, true, 'flush() ne doit pas attendre 30 s de plus une écriture lâchée depuis longtemps')
    assert.deepEqual(warns, [], 'aucun avertissement : rien n\'est attendu')
  })

  it('chaque écriture est attendue 30 s depuis SON départ, pas 30 s depuis l\'appel de flush() : une écriture vieille de 28 s n\'est attendue que 2 s de plus, puis comptée', async () => {
    const { adapter, warns } = await adaptateurGele()
    void adapter.save('g-vieille', { id: 'g-vieille' })
    await laisse()
    await avance(DELAI - 2000)               // l'écriture a 28 s
    let rendu = false
    void adapter.flush().then(() => { rendu = true })
    await avance(1999)
    assert.equal(rendu, false, 'sanity : à 29,999 s l\'écriture peut encore répondre, flush() l\'attend')
    await avance(1)
    assert.equal(rendu, true, 'à 30 s depuis le départ de l\'écriture, flush() rend la main (et non 30 s après son propre appel)')
    assert.equal(warns.length, 1, `l'écriture sans réponse est comptée : ${JSON.stringify(warns)}`)
    assert.match(warns[0], /(^|\D)1(\D|$)/, 'l\'avertissement compte une écriture')
  })
})

describe('MJS-Server — FilePersistAdapter : une écriture qui répond sort de la liste', function () {
  this.timeout(15000)

  it('sur un vrai dossier, save() puis remove() : la liste est vide dès qu\'ils ont fini et aucune minuterie ne reste armée derrière eux', async () => {
    const armees       = new Set<unknown>()
    const retirees     = new Set<unknown>()
    const armer        = globalThis.setTimeout
    const retirer      = globalThis.clearTimeout
    globalThis.setTimeout   = ((fn: any, ms: any, ...args: any[]) => { const h = armer(fn, ms, ...args); armees.add(h); return h }) as any
    globalThis.clearTimeout = ((h: any) => { retirees.add(h); return retirer(h) }) as any
    try {
      const dir          = mjsTmp('fichier-liberees-reel')
      const adapter: any = new FilePersistAdapter({ dir, onLog: () => {} })
      await adapter.save('g-vite', { id: 'g-vite' })
      assert.ok(existsSync(join(dir, 'g-vite.json')), 'sanity : le fichier est écrit')
      await adapter.save('g-vite', { id: 'g-vite' })
      await adapter.remove('g-vite')
      assert.ok(!existsSync(join(dir, 'g-vite.json')), 'sanity : le fichier est retiré')
      assert.equal(adapter._inFlight.size, 0, 'une écriture qui a répondu n\'est plus en vol')
      const restantes = Array.from(armees).filter(h => !retirees.has(h)).length
      assert.equal(restantes, 0, `${restantes} minuterie(s) armée(s) derrière des écritures qui ont répondu`)
    } finally { globalThis.setTimeout = armer; globalThis.clearTimeout = retirer }
  })
})
