// Un visiteur sans compte accueilli d'une adresse au banc est réduit au paquet comptes (se connecter, créer un compte). Le
// filtre laissait pourtant passer tout type qui commence par `account:` — le préfixe n'est qu'une convention de nommage — et
// donc les `serve('account:…')` écrits par l'appli elle-même : un « mot de passe oublié » qui envoie un courriel restait
// ouvert à l'abuseur mis au banc. Seules les trames du paquet comptes passent
import assert from 'node:assert/strict'
import { mjsWs, accountsPackage, accountsAuth } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const SECRET = 'secret-de-test-du-banc-des-comptes-assez-long'
const IP     = '10.0.0.9'
const tick   = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

class TransportAvecAdresse extends MemoryTransport {
  onConnection(handler: Parameters<MemoryTransport['onConnection']>[0]): void {
    super.onConnection((conn) => { (conn.remoteInfo as any).address = conn.remoteInfo.headers?.['x-ip']; handler(conn) })
  }
}

interface Poste { trames: any[]; ferme: boolean; envoyer: (o: unknown) => void; brut: (s: string) => void }

async function arriver(transport: MemoryTransport, ip: string): Promise<{ poste: Poste; accueil: any }> {
  const ws = transport.connect({ headers: { 'x-ip': ip } })
  const poste: Poste = { trames: [], ferme: false, envoyer: (o) => ws.send(JSON.stringify(o)), brut: (s) => ws.send(s) }
  ws.onmessage = (ev: any) => poste.trames.push(JSON.parse(ev.data))
  ws.onclose   = () => { poste.ferme = true }
  await tick()
  poste.envoyer({ t: 'µ:hello', p: { protocol: 1 } })
  return { poste, accueil: await attendre(poste, f => f.t === 'µ:welcome' || f.t === 'µ:denied') }
}

async function attendre(poste: Poste, pred: (f: any) => boolean, ms = 10000): Promise<any> {
  const debut = Date.now()
  for (;;) {
    const i = poste.trames.findIndex(pred)
    if (i >= 0) return poste.trames.splice(i, 1)[0]
    if (Date.now() - debut > ms) throw new Error('trame attendue jamais reçue')
    await tick(1)
  }
}

let numero = 0
async function requete(poste: Poste, t: string, p: unknown): Promise<any> {
  const id = ++numero
  poste.envoyer({ t, p, id })
  return attendre(poste, f => f.t === 'µ:ack' && f.id === id)
}

describe('MJS-WS — mise au banc d’un anonyme : seules les trames du paquet comptes lui restent ouvertes', function () {
  this.timeout(30000)

  it('un serve(\'account:…\') de l’appli est refusé au banc ; account:create et account:login du paquet passent', async () => {
    const transport = new TransportAvecAdresse()
    const app = mjsWs({ transport, heartbeat: 0, auth: accountsAuth(SECRET), ban: { by: 'account' }, onLog: () => {} })
    app.use(accountsPackage({ secret: SECRET, onLog: () => {} }))
    let courriels = 0
    app.serve('account:mot-de-passe-oublie', () => { courriels++; return { envoye: true } })
    await app.listen()
    try {
      for (let k = 0; k < 3; k++) {
        const { poste } = await arriver(transport, IP)
        for (let i = 0; i < 51; i++) poste.brut('{pas du json')
        for (let i = 0; i < 300 && !poste.ferme; i++) await tick(2)
        assert.ok(poste.ferme, 'expulsé')
      }
      const { poste, accueil } = await arriver(transport, IP)
      assert.equal(accueil.t, 'µ:welcome', 'anonyme accueilli au banc, réduit au paquet comptes')
      for (let i = 0; i < 3; i++) {
        const oubli = await requete(poste, 'account:mot-de-passe-oublie', { email: 'victime@exemple.fr' })
        assert.equal(oubli.e, true, 'trame de l’appli refusée')
        assert.match(String(oubli.p), /mise au banc/)
      }
      assert.equal(courriels, 0, 'aucun courriel envoyé')
      const creation = await requete(poste, 'account:create', { name: 'nouvelle', secret: 'motdepasse-nouvelle' })
      assert.equal(typeof creation.p?.token, 'string', 'account:create du paquet servi : ' + JSON.stringify(creation))
      const connexion = await requete(poste, 'account:login', { name: 'nouvelle', secret: 'motdepasse-nouvelle' })
      assert.equal(typeof connexion.p?.token, 'string', 'account:login du paquet servi : ' + JSON.stringify(connexion))
    }
    finally {
      await app.stop()
    }
  })
})
