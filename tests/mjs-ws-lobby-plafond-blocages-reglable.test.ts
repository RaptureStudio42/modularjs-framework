// Paquet LOBBY — le plafond de blocages par identité, tous halls confondus, se règle : option `blockedMax` de
// lobbyPackage(), 256 par défaut (inchangé). Au-delà, un blocage neuf est refusé (`lobby-block-limit`) et rien de plus
// n’est gardé ; rebloquer une identité déjà bloquée ne compte pas ; les blocages d’un hall sont rendus quand la présence
// du bloqueur y part. Une valeur fausse (0, négatif, décimal, chaîne, infini, NaN, null) lève dès la construction, en
// clair, en français comme en anglais : sans ce contrôle, NaN (une variable d’environnement absente passée à Number())
// ou Infinity levaient la borne en silence, et 0 refusait tout blocage.
// Clients bruts (trames JSON à la main) sur MemoryTransport.
import assert from 'node:assert/strict'
import { mjsWs, lobbyPackage } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { setMessagesLang } from '../src/messages/index.js'
import type { MjsWsApp } from '../src/mjs-ws/index.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

interface Brut { trames: any[]; envoyer(o: unknown): void; fermer(): void }
interface Blocage { hall: string; identityId: string }

async function brut(transport: MemoryTransport): Promise<Brut> {
  const s: any = transport.connect({})
  const b: Brut = { trames: [], envoyer(o) { s.send(JSON.stringify(o)) }, fermer() { s.close() } }
  s.onmessage = (ev: any) => { b.trames.push(JSON.parse(ev.data)) }
  await tick()
  b.envoyer({ t: 'µ:hello', p: { protocol: 1 } })
  await attendre(b, m => m.t === 'µ:welcome')
  return b
}

async function attendre(b: Brut, pred: (m: any) => boolean, ms = 10000): Promise<any> {
  const t0 = Date.now()
  for (;;) {
    const i = b.trames.findIndex(pred)
    if (i >= 0) return b.trames.splice(i, 1)[0]
    if (Date.now() - t0 > ms) throw new Error('attente expirée')
    await tick(1)
  }
}

let idRequete = 0
async function requete(b: Brut, t: string, p: unknown): Promise<any> {
  const id = ++idRequete
  b.envoyer({ t, p, id })
  return attendre(b, m => m.t === 'µ:ack' && m.id === id)
}

// µ:join du salon du hall puis lobby:enter — rend l'identité vue par le hall
async function entrer(b: Brut, hall: string): Promise<string> {
  b.envoyer({ t: 'µ:join', p: { room: 'lobby:' + hall } })
  const ack = await requete(b, 'lobby:enter', { hall })
  assert.equal(ack.e, undefined, 'entrée acceptée dans ' + hall)
  return ack.p.me.id
}

async function demarrer(opts: { blockedMax?: number } = {}): Promise<{ transport: MemoryTransport; app: MjsWsApp; pkg: any }> {
  const transport = new MemoryTransport()
  const app       = mjsWs({ transport, heartbeat: 0, onLog: () => {}, limits: { rate: 100000, burst: 100000 } })
  const pkg: any  = lobbyPackage({ onLog: () => {}, ...opts })
  app.use(pkg)
  await app.listen()
  return { transport, app, pkg }
}

// n identités présentes dans chacun des halls donnés, une connexion chacune
async function presentes(transport: MemoryTransport, n: number, halls: string[]): Promise<string[]> {
  return Promise.all(Array.from({ length: n }, async () => {
    const c = await brut(transport)
    let id  = ''
    for (const hall of halls) id = await entrer(c, hall)
    return id
  }))
}

// blocages envoyés par lots (la file d'une connexion est bornée), chaque lot suivi d'un aller-retour sur la même
// connexion (trames traitées dans l'ordre) : rend les codes des refus reçus
async function bloquer(b: Brut, demandes: Blocage[]): Promise<string[]> {
  for (let i = 0; i < demandes.length; i += 100) {
    for (const p of demandes.slice(i, i + 100)) b.envoyer({ t: 'lobby:block', p })
    await requete(b, 'lobby:enter', { hall: demandes[i].hall })
  }
  const refus = b.trames.filter(m => m.t === 'µ:error').map(m => String(m.p?.message))
  b.trames.length = 0
  return refus
}

const dans = (hall: string, ids: string[]): Blocage[] => ids.map(identityId => ({ hall, identityId }))

// blocages gardés par cette identité, tous halls confondus (lus dans la présence riche)
function blocagesDe(pkg: any, id: string): number {
  let n = 0
  for (const membres of pkg._presence.values()) n += membres.get(id)?.blocked.size ?? 0
  return n
}

function bloque(pkg: any, hall: string, de: string, cible: string): boolean {
  return pkg._presence.get('lobby:' + hall)?.get(de)?.blocked.has(cible) === true
}

// valeur fausse → ce que le message en montre
const FAUSSES: [unknown, string][] = [[0, '0'], [-1, '-1'], [2.5, '2.5'], ['10', '"10"'], [Infinity, 'Infinity'], [NaN, 'NaN'], [null, 'null']]

describe('MJS-WS — lobby : le plafond de blocages par identité se règle (blockedMax)', function () {
  this.timeout(60000)

  afterEach(() => setMessagesLang('fr'))

  it('blockedMax: 3 — le 4e blocage neuf est refusé (lobby-block-limit), rien de plus n’est gardé ; rebloquer ne compte pas', async () => {
    const { transport, app, pkg } = await demarrer({ blockedMax: 3 })
    try {
      const bloqueur         = await brut(transport)
      const moi              = await entrer(bloqueur, 'a')
      const [c1, c2, c3, c4] = await presentes(transport, 4, ['a'])
      // c1 rebloqué avant le plafond : compté une fois
      assert.deepEqual(await bloquer(bloqueur, dans('a', [c1, c1, c2, c3])), [])
      assert.equal(blocagesDe(pkg, moi), 3)
      assert.equal(pkg._blockedCount.get(moi), 3)
      // c4, neuf : refusé ; c2, déjà bloqué : rejoué sans refus ni compte de plus
      assert.deepEqual(await bloquer(bloqueur, dans('a', [c4, c2])), ['lobby-block-limit'])
      assert.equal(bloque(pkg, 'a', moi, c4), false, 'le blocage refusé n’est pas gardé')
      assert.equal(blocagesDe(pkg, moi), 3)
      assert.equal(pkg._blockedCount.get(moi), 3)
    } finally {
      await app.stop()
    }
  })

  it('blockedMax: 3 vaut tous halls confondus, et le compte se libère quand la présence du bloqueur part', async () => {
    const { transport, app, pkg } = await demarrer({ blockedMax: 3 })
    try {
      const bloqueur             = await brut(transport)
      const moi                  = await entrer(bloqueur, 'a')
      await entrer(bloqueur, 'b')
      const [c1, c2, c3, c4, c5] = await presentes(transport, 5, ['a', 'b'])
      // deux blocages dans a, un dans b : le plafond est atteint, un 4e dans b est refusé
      assert.deepEqual(await bloquer(bloqueur, [...dans('a', [c1, c2]), ...dans('b', [c3, c4])]), ['lobby-block-limit'])
      assert.equal(pkg._blockedCount.get(moi), 3)
      // le bloqueur quitte le hall a : ses deux blocages de a sont rendus, celui de b reste
      bloqueur.envoyer({ t: 'µ:leave', p: { room: 'lobby:a' } })
      await requete(bloqueur, 'lobby:enter', { hall: 'b' })
      assert.equal(pkg._presence.get('lobby:a')?.has(moi) === true, false, 'présence partie du hall a')
      assert.equal(pkg._blockedCount.get(moi), 1)
      assert.deepEqual(await bloquer(bloqueur, dans('b', [c4, c5, c1])), ['lobby-block-limit'])
      assert.equal(blocagesDe(pkg, moi), 3)
      assert.equal(pkg._blockedCount.get(moi), 3)
      // déconnecté, il ne garde plus rien
      bloqueur.fermer()
      for (let i = 0; i < 1000 && pkg._blockedCount.has(moi); i++) await tick(2)
      assert.equal(pkg._blockedCount.has(moi), false)
    } finally {
      await app.stop()
    }
  })

  it('sans blockedMax, le plafond reste 256', async () => {
    const { transport, app, pkg } = await demarrer()
    try {
      const halls    = ['h0', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7']
      const bloqueur = await brut(transport)
      let moi        = ''
      for (const hall of halls) moi = await entrer(bloqueur, hall)
      // 33 identités présentes dans les 8 halls : 264 blocages possibles, 257 demandés
      const cibles   = await presentes(transport, 33, halls)
      const demandes = halls.flatMap(hall => dans(hall, cibles)).slice(0, 257)
      assert.deepEqual(await bloquer(bloqueur, demandes), ['lobby-block-limit'])
      assert.equal(blocagesDe(pkg, moi), 256)
      assert.equal(pkg._blockedCount.get(moi), 256)
    } finally {
      await app.stop()
    }
  })

  it('blockedMax faux — 0, -1, 2.5, la chaîne « 10 », Infinity, NaN, null : lobbyPackage() lève dès la construction, en clair, en français comme en anglais', () => {
    setMessagesLang('fr')
    for (const [v, vu] of FAUSSES) assert.throws(() => lobbyPackage({ blockedMax: v as number }), (err: unknown) => err instanceof Error && err.message.includes('blockedMax') && err.message.includes(vu) && err.message.includes('entier ≥ 1'), 'blockedMax ' + vu)
    setMessagesLang('en')
    for (const [v, vu] of FAUSSES) assert.throws(() => lobbyPackage({ blockedMax: v as number }), (err: unknown) => err instanceof Error && err.message.includes('blockedMax') && err.message.includes(vu) && err.message.includes('integer ≥ 1'), 'blockedMax ' + vu)
  })

  it('blockedMax entier ≥ 1, ou absent : accepté', () => {
    for (const v of [1, 3, 256, 100000]) assert.doesNotThrow(() => lobbyPackage({ blockedMax: v }))
    assert.doesNotThrow(() => lobbyPackage({ blockedMax: undefined }))
    assert.doesNotThrow(() => lobbyPackage())
  })
})
