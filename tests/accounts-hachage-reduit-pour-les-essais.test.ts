// comptes (src/mjs-ws/accounts.ts) — `weakHashForTests: true`, pour les essais seulement : les secrets sont hachés à un coût réduit
// (scrypt N = 2^10, r = 8, p = 1), de quoi tenir une suite qui crée des comptes en rafale sur une machine chargée. Sans l'option, ou
// avec toute autre valeur que `true`, le coût reste celui de la production (N = 2^15, r = 8, p = 3). Sous l'option, un hachage déjà
// enregistré se vérifie tel quel et n'est jamais refait plus faible. Le paquet créé avec l'option le dit au démarrage, une fois,
// par son journal (`onLog`, sinon la console), en français ou en anglais
import assert from 'node:assert/strict'
import { accountsPackage, MemoryAccountsPersistAdapter } from '../src/mjs-ws/index.js'
import { setMessagesLang } from '../src/messages/index.js'
import { demarrer, connecter, requete } from './helpers/comptes-brut.js'

const PRODUCTION = /^\$scrypt\$ln=15,r=8,p=3\$[0-9a-f]{128}$/
const ESSAIS     = /^\$scrypt\$ln=10,r=8,p=1\$[0-9a-f]{128}$/

// un compte créé par un serveur aux options données, puis son hachage tel qu'enregistré
async function hachageDUnCompteNeuf(opts: Record<string, unknown>): Promise<string> {
  const persist            = new MemoryAccountsPersistAdapter()
  const { transport, app } = await demarrer({ persist, ...opts } as never)
  try {
    const r = await requete(await connecter(transport), 'account:create', { name: 'alice', secret: 'le-bon-secret' })
    assert.equal(r.e, undefined, r.p)
    return (await persist.load())[0].hash
  }
  finally {
    await app.stop()
  }
}

describe('MJS-WS — accounts.ts : coût de hachage réduit pour les essais (weakHashForTests)', function () {
  this.timeout(60000)

  it('sans l\'option, ou avec une autre valeur que true, un compte neuf est haché au coût de production', async () => {
    assert.match(await hachageDUnCompteNeuf({}), PRODUCTION)
    assert.match(await hachageDUnCompteNeuf({ weakHashForTests: false }), PRODUCTION)
    assert.match(await hachageDUnCompteNeuf({ weakHashForTests: 'true' }), PRODUCTION)
  })

  it('weakHashForTests: true — un compte neuf est haché au coût réduit, se connecte, et un mauvais secret est refusé', async () => {
    const persist                     = new MemoryAccountsPersistAdapter()
    const { transport, app, journal } = await demarrer({ persist, weakHashForTests: true } as never)
    try {
      const r = await requete(await connecter(transport), 'account:create', { name: 'alice', secret: 'le-bon-secret' })
      assert.equal(r.e, undefined, r.p)
      assert.match((await persist.load())[0].hash, ESSAIS)
      const login = await requete(await connecter(transport), 'account:login', { name: 'alice', secret: 'le-bon-secret' })
      assert.equal(login.e, undefined, login.p)
      const mauvais = await requete(await connecter(transport), 'account:login', { name: 'alice', secret: 'pas-le-bon' })
      assert.equal(mauvais.p, 'account-denied')
      const absent = await requete(await connecter(transport), 'account:login', { name: 'personne', secret: 'le-bon-secret' })
      assert.equal(absent.p, 'account-denied')
      assert.equal(journal.filter((l) => l.niveau === 'warn' && /weakHashForTests/.test(l.message)).length, 1, 'un avertissement par paquet, pas un par hachage')
    }
    finally {
      await app.stop()
    }
  })

  it('weakHashForTests: true — un compte haché au coût de production se connecte, et son hachage n\'est pas refait plus faible', async () => {
    const persist = new MemoryAccountsPersistAdapter()
    const prod    = await demarrer({ persist })
    try {
      const r = await requete(await connecter(prod.transport), 'account:create', { name: 'bob', secret: 'le-bon-secret' })
      assert.equal(r.e, undefined, r.p)
    }
    finally {
      await prod.app.stop()
    }
    const avant = (await persist.load())[0].hash
    assert.match(avant, PRODUCTION)
    const essai = await demarrer({ persist, weakHashForTests: true } as never)
    try {
      const login = await requete(await connecter(essai.transport), 'account:login', { name: 'bob', secret: 'le-bon-secret' })
      assert.equal(login.e, undefined, login.p)
      const mauvais = await requete(await connecter(essai.transport), 'account:login', { name: 'bob', secret: 'pas-le-bon' })
      assert.equal(mauvais.p, 'account-denied')
      assert.equal((await persist.load())[0].hash, avant, 'le hachage de production reste tel quel')
    }
    finally {
      await essai.app.stop()
    }
  })

  it('un compte haché au coût réduit, relu par un serveur de production, se connecte et son hachage passe au coût de production', async () => {
    const persist = new MemoryAccountsPersistAdapter()
    const essai   = await demarrer({ persist, weakHashForTests: true } as never)
    try {
      const r = await requete(await connecter(essai.transport), 'account:create', { name: 'carla', secret: 'le-bon-secret' })
      assert.equal(r.e, undefined, r.p)
    }
    finally {
      await essai.app.stop()
    }
    assert.match((await persist.load())[0].hash, ESSAIS)
    const prod = await demarrer({ persist })
    try {
      const login = await requete(await connecter(prod.transport), 'account:login', { name: 'carla', secret: 'le-bon-secret' })
      assert.equal(login.e, undefined, login.p)
      assert.match((await persist.load())[0].hash, PRODUCTION)
    }
    finally {
      await prod.app.stop()
    }
  })

  it('weakHashForTests: true — un avertissement au démarrage, une fois par paquet créé, par onLog, en français et en anglais ; sans l\'option, aucun', () => {
    const avertissements = (opts: Record<string, unknown>): string[] => {
      const vus: string[] = []
      accountsPackage({ secret: 'secret-des-essais', persist: new MemoryAccountsPersistAdapter(), onLog: (niveau: string, message: string) => { if (niveau === 'warn') vus.push(message) }, ...opts } as never)
      return vus
    }
    assert.deepEqual(avertissements({}), [])
    assert.deepEqual(avertissements({ weakHashForTests: false }), [])
    const fr = avertissements({ weakHashForTests: true })
    assert.equal(fr.length, 1, fr.join(' | '))
    assert.match(fr[0], /weakHashForTests/)
    assert.match(fr[0], /hachés à coût réduit/)
    assert.match(fr[0], /réservé aux tests, ne l'activez jamais en production/)
    setMessagesLang('en')
    try {
      const en = avertissements({ weakHashForTests: true })
      assert.equal(en.length, 1, en.join(' | '))
      assert.match(en[0], /hashed at reduced cost/)
      assert.match(en[0], /for tests only, never enable it in production/)
    }
    finally {
      setMessagesLang('fr')
    }
    assert.equal(avertissements({ weakHashForTests: true }).length + avertissements({ weakHashForTests: true }).length, 2, 'un avertissement par paquet créé')
  })

  it('weakHashForTests: true sans onLog — l\'avertissement part à la console, une fois', () => {
    const vus: string[] = []
    const warn = console.warn
    console.warn = (...a: unknown[]) => { vus.push(a.map(String).join(' ')) }
    try {
      accountsPackage({ secret: 'secret-des-essais', persist: new MemoryAccountsPersistAdapter(), weakHashForTests: true } as never)
    }
    finally {
      console.warn = warn
    }
    const lignes = vus.filter((l) => /weakHashForTests/.test(l))
    assert.equal(lignes.length, 1, vus.join(' | '))
    assert.match(lignes[0], /^\[mjs-ws:accounts\] /)
  })
})
